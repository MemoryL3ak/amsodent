import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { createHash } from 'crypto';
import { SupabaseService } from '../supabase/supabase.service';
import { ProductosService } from './productos.service';
import { PreciosCambiosService } from './precios-cambios.service';
import { CAMPOS, Campo, NOMBRE_CAMPO, Pedido, Plan, ProductoPrecio, brutoDeNeto, lista3Efectiva, planificar, resumenDePlan } from './precios-sheet.logica';
import { ClienteGoogleSheet, ClienteSheet, LibroLeido, anotarEnBitacora, aplicarPlan, credencialesDeServicio, explicarErrorGoogle, idDelSheet, leerLibro, urlDelSheet } from './precios-sheet.google';
import { rolProceso } from '../rol-proceso';

/* ── Precios → Google Sheet (2026-11-12) ─────────────────────────────────────
   Pedido de Ariel (punto 7 del lote del 2026-11-09): «manejar desde la
   plataforma la actualización de precios; la actualización se envía a un
   Google Sheet […] y desde la plataforma se pueden dar permisos».

   Una sola dirección: la plataforma escribe, el Sheet «Lista de Precios» se
   lee. Todo cambio de costo o de lista de precios ya deja una fila en
   `productos_precio_cambios` (al editar el producto, en una carga masiva, al
   deshacer una carga y desde la pantalla «Actualización de precios»); esa
   tabla es la COLA: cada fila nace `pendiente` y este servicio la lleva al
   Sheet, escribiendo el valor VIGENTE del producto (no el del cambio: si un
   precio cambió dos veces queda el último).

   · Se envía a los pocos segundos del cambio (en el proceso que lo recibió) y,
     por si Google falla o el proceso se reinicia, el worker repasa la cola
     cada 5 minutos. Hasta 8 intentos por fila; después queda en «error» hasta
     que alguien pulse «Reintentar ahora».
   · «Nivelar» compara TODOS los productos con SKU contra el Sheet y deja el
     Sheet igual a la plataforma. Siempre en dos pasos: Simular → Enviar; la
     huella de la simulación amarra el envío a lo que se mostró.
   · Sin la migración 20261112_precios_sheet no hay cola: la pantalla lo dice.
   · Sin GOOGLE_SERVICE_ACCOUNT_JSON (backend local) no se puede leer ni
     escribir el Sheet: los cambios quedan pendientes. */

const TABLA = 'productos_precio_cambios';
const MAX_INTENTOS = 8;
const MAX_POR_GUARDADO = 80;
const COLUMNAS_PRODUCTO = 'id, sku, nombre, categoria, marca, formato, estado, costo, lista1, lista2, lista3';
const NOMBRE_ORIGEN: Record<string, string> = { edicion: 'Edición', carga_masiva: 'Carga masiva', reversion: 'Carga deshecha', nivelacion: 'Nivelación' };
const noExiste = (error: any) => /does not exist|schema cache|PGRST20[45]|42P01|42703/i.test(`${error?.code || ''} ${error?.message || ''}`);

const trozos = <T>(lista: T[], n: number): T[][] => {
  const partes: T[][] = [];
  for (let i = 0; i < lista.length; i += n) partes.push(lista.slice(i, i + n));
  return partes;
};
const fechaChile = (d: Date | string) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Santiago', dateStyle: 'short', timeStyle: 'short' }).format(new Date(d));
const numero = (v: any): number | null => (v === undefined || v === null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

export type ResultadoEnvio = {
  estado: 'ok' | 'vacio' | 'sin_configurar' | 'sin_migracion' | 'error';
  cambios: number;
  celdas: number;
  agregados: number;
  omitidos: number;
  mensaje: string;
};

type FilaCola = { id: number; producto_id: number; sku: string | null; nombre: string | null; campo: Campo; anterior: number | null; nuevo: number | null; origen: string; usuario_email: string | null; created_at: string; sheet_intentos: number };
type CambioPedido = { id: number; costo?: number; lista1?: number; lista2?: number; lista3?: number };

@Injectable()
export class PreciosSheetService implements OnModuleInit {
  private readonly logger = new Logger(PreciosSheetService.name);
  private cliente: ClienteSheet | null = null;
  /* Las escrituras al Sheet van de a una (cola del proceso). */
  private serie: Promise<any> = Promise.resolve();
  private temporizador: NodeJS.Timeout | null = null;
  private accesoVisto: { en: number; valor: any } | null = null;

  constructor(
    private supabase: SupabaseService,
    private productos: ProductosService,
    private preciosCambios: PreciosCambiosService,
  ) {}

  onModuleInit() {
    // Cada cambio de precio registrado despierta el envío (sin dependencia circular).
    this.preciosCambios.alRegistrar(() => this.despertar());
  }

  private get db() {
    return this.supabase.getClient();
  }

  /* Para las pruebas: un libro en memoria en vez de Google. */
  usarCliente(cliente: ClienteSheet | null) {
    this.cliente = cliente;
  }

  private clienteSheet(): ClienteSheet {
    if (!this.cliente) this.cliente = new ClienteGoogleSheet();
    return this.cliente;
  }

  private hayAcceso() {
    return this.cliente != null || credencialesDeServicio() != null;
  }

  private enSerie<T>(fn: () => Promise<T>): Promise<T> {
    const r = this.serie.then(fn);
    this.serie = r.catch(() => undefined);
    return r;
  }

  /* ── Productos ─────────────────────────────────────────────────────────── */
  private async productosPorId(ids: number[]): Promise<Map<number, ProductoPrecio>> {
    const mapa = new Map<number, ProductoPrecio>();
    for (const parte of trozos([...new Set(ids)], 200)) {
      const { data, error } = await this.db.from('productos').select(COLUMNAS_PRODUCTO).in('id', parte);
      if (error) throw new Error(error.message);
      for (const p of (data || []) as any[]) mapa.set(Number(p.id), p as ProductoPrecio);
    }
    return mapa;
  }

  /* Catálogo con SKU, paginado de a 1000 y sin contar (regla: nada pesado en producción). */
  private async productosConSku(columnas = COLUMNAS_PRODUCTO): Promise<any[]> {
    const todos: any[] = [];
    for (let desde = 0; desde < 40000; desde += 1000) {
      const { data, error } = await this.db.from('productos').select(columnas).not('sku', 'is', null).neq('sku', '').order('id', { ascending: true }).range(desde, desde + 999);
      if (error) throw new BadRequestException(error.message);
      todos.push(...((data || []) as any[]));
      if ((data || []).length < 1000) break;
    }
    return todos;
  }

  /* Lista liviana para la pantalla de actualización de precios. */
  async productosParaEditar(verCostos: boolean) {
    const filas = await this.productosConSku('id, sku, nombre, categoria, marca, estado, costo, lista1, lista2, lista3, precio_actualizado_at');
    return filas.map((p) => ({ ...p, costo: verCostos ? p.costo : undefined, lista3_calculada: lista3Efectiva(p) }));
  }

  /* ── Estado (para la pantalla) ─────────────────────────────────────────── */
  private async revisarAcceso(forzar = false) {
    if (!forzar && this.accesoVisto && Date.now() - this.accesoVisto.en < 60_000) return this.accesoVisto.valor;
    let valor: any;
    const cuenta = credencialesDeServicio()?.email || null;
    if (!this.hayAcceso()) {
      valor = { ok: false, error: 'Falta GOOGLE_SERVICE_ACCOUNT_JSON en este servidor: no se puede leer ni escribir el Sheet.' };
    } else {
      try {
        const libro = await leerLibro(this.clienteSheet(), true);
        const plan = planificar([], libro.pestanas, { borrarVacios: false, agregarFaltantes: false });
        valor = {
          ok: true,
          titulo: libro.titulo,
          pestanas: libro.pestanas.filter((p) => p.tipo === 'categoria').length,
          consolidado: libro.pestanas.some((p) => p.tipo === 'consolidado'),
          bitacora: libro.hayBitacora,
          pestanas_con_problema: plan.pestanasConProblema,
        };
      } catch (e: any) {
        valor = { ok: false, error: explicarErrorGoogle(e, cuenta) };
      }
    }
    this.accesoVisto = { en: Date.now(), valor };
    return valor;
  }

  async estado(forzar = false) {
    const cuenta = credencialesDeServicio()?.email || null;
    const [acceso, pend, err, ultimoError, envio] = await Promise.all([
      this.revisarAcceso(forzar),
      this.db.from(TABLA).select('id').in('sheet_estado', ['pendiente', 'enviando']).limit(1001),
      this.db.from(TABLA).select('id').eq('sheet_estado', 'error').limit(1001),
      this.db.from(TABLA).select('sheet_error, sheet_at').eq('sheet_estado', 'error').order('id', { ascending: false }).limit(1),
      this.db.from('precios_sheet_envios').select('id, tipo, usuario_email, productos, celdas, agregados, omitidos, estado, error, created_at').order('id', { ascending: false }).limit(1),
    ]);
    const migracion = !pend.error && !envio.error;
    return {
      sheet_id: idDelSheet(),
      sheet_url: urlDelSheet(),
      cuenta,
      configurado: this.hayAcceso(),
      acceso,
      migracion,
      error_migracion: migracion ? null : 'Falta aplicar la migración 20261112_precios_sheet.sql: sin ella los cambios de precio no se envían al Sheet.',
      pendientes: (pend.data || []).length,
      errores: (err.data || []).length,
      ultimo_error: ((ultimoError.data || []) as any[])[0]?.sheet_error || null,
      ultimo_envio: ((envio.data || []) as any[])[0] || null,
      proceso: rolProceso(),
    };
  }

  /* ── Cola: cambios de precio → Sheet ───────────────────────────────────── */
  despertar(ms = 3000) {
    if (!this.hayAcceso()) return;
    if (this.temporizador) clearTimeout(this.temporizador);
    this.temporizador = setTimeout(() => {
      this.temporizador = null;
      void this.enviarPendientes().catch((e) => this.logger.warn(`Envío al Sheet: ${e?.message || e}`));
    }, ms);
    this.temporizador.unref?.();
  }

  enviarPendientes(): Promise<ResultadoEnvio> {
    return this.enSerie(() => this.drenar());
  }

  private async marcar(ids: number[], valores: Record<string, any>) {
    for (const parte of trozos(ids, 200)) {
      const { error } = await this.db.from(TABLA).update(valores).in('id', parte);
      if (error) this.logger.warn(`Cola del Sheet (marcar ${valores.sheet_estado}): ${error.message}`);
    }
  }

  private async marcarError(filas: FilaCola[], mensaje: string) {
    const porIntentos = new Map<number, number[]>();
    for (const f of filas) {
      const n = Number(f.sheet_intentos) || 0;
      porIntentos.set(n, [...(porIntentos.get(n) || []), f.id]);
    }
    for (const [n, ids] of porIntentos) {
      await this.marcar(ids, { sheet_estado: 'error', sheet_error: mensaje.slice(0, 500), sheet_intentos: n + 1, sheet_at: new Date().toISOString() });
    }
  }

  private async anotarEnvio(fila: Record<string, any>) {
    try {
      const { error } = await this.db.from('precios_sheet_envios').insert(fila);
      if (error && !noExiste(error)) this.logger.warn(`Registro de envíos al Sheet: ${error.message}`);
    } catch (e: any) {
      this.logger.warn(`Registro de envíos al Sheet: ${e?.message || e}`);
    }
  }

  private async drenar(): Promise<ResultadoEnvio> {
    const nada = (estado: ResultadoEnvio['estado'], mensaje: string): ResultadoEnvio => ({ estado, cambios: 0, celdas: 0, agregados: 0, omitidos: 0, mensaje });
    if (!this.hayAcceso()) return nada('sin_configurar', 'Falta GOOGLE_SERVICE_ACCOUNT_JSON en este servidor: los cambios quedan pendientes.');

    // Filas que quedaron «enviando» en un proceso que se cayó: vuelven a la cola.
    const hace10 = new Date(Date.now() - 10 * 60_000).toISOString();
    const liberar = await this.db.from(TABLA).update({ sheet_estado: 'pendiente' }).eq('sheet_estado', 'enviando').lt('sheet_at', hace10);
    if (liberar.error) {
      return noExiste(liberar.error) ? nada('sin_migracion', 'Falta aplicar la migración 20261112_precios_sheet.sql.') : nada('error', liberar.error.message);
    }

    const { data, error } = await this.db
      .from(TABLA)
      .select('id, producto_id, sku, nombre, campo, anterior, nuevo, origen, usuario_email, created_at, sheet_intentos')
      .in('sheet_estado', ['pendiente', 'error'])
      .lt('sheet_intentos', MAX_INTENTOS)
      .order('id', { ascending: true })
      .limit(1000);
    if (error) return noExiste(error) ? nada('sin_migracion', 'Falta aplicar la migración 20261112_precios_sheet.sql.') : nada('error', error.message);
    const candidatas = (data || []) as any[] as FilaCola[];
    if (!candidatas.length) return nada('vacio', 'No hay cambios de precio pendientes de enviar.');

    // Reclamo atómico: si otro proceso (web / worker) ya tomó una fila, no vuelve en la respuesta.
    const mias = new Set<number>();
    const ahora = new Date().toISOString();
    for (const parte of trozos(candidatas.map((f) => f.id), 200)) {
      const r = await this.db.from(TABLA).update({ sheet_estado: 'enviando', sheet_at: ahora }).in('id', parte).in('sheet_estado', ['pendiente', 'error']).select('id');
      for (const f of (r.data || []) as any[]) mias.add(Number(f.id));
    }
    const filas = candidatas.filter((f) => mias.has(f.id));
    if (!filas.length) return nada('vacio', 'Otro proceso ya está enviando los cambios pendientes.');

    const cuenta = credencialesDeServicio()?.email || null;
    try {
      const productos = await this.productosPorId(filas.map((f) => Number(f.producto_id)));
      const camposDe = new Map<number, Set<Campo>>();
      for (const f of filas) {
        if (!productos.has(Number(f.producto_id))) continue;
        const s = camposDe.get(Number(f.producto_id)) || new Set<Campo>();
        s.add(f.campo);
        camposDe.set(Number(f.producto_id), s);
      }
      const pedidos: Pedido[] = [...camposDe].map(([id, campos]) => ({ producto: productos.get(id)!, campos: [...campos] }));

      const cliente = this.clienteSheet();
      const libro = await leerLibro(cliente);
      const plan = planificar(pedidos, libro.pestanas, { borrarVacios: true, agregarFaltantes: true });
      await aplicarPlan(cliente, plan, libro);
      this.accesoVisto = null;

      const omitido = new Map(plan.omitidos.map((o) => [o.producto_id, o]));
      const enviadas: number[] = [];
      const porMotivo = new Map<string, number[]>();
      const reintentar: FilaCola[] = [];
      const bitacora: any[][] = [];
      for (const f of filas) {
        const id = Number(f.producto_id);
        const o = productos.has(id) ? omitido.get(id) : { motivo: 'El producto ya no existe en la plataforma.', reintentable: false };
        if (o?.reintentable) {
          reintentar.push(f);
          continue;
        }
        if (o) porMotivo.set(o.motivo, [...(porMotivo.get(o.motivo) || []), f.id]);
        else enviadas.push(f.id);
        const nuevo = numero(f.nuevo);
        bitacora.push([
          fechaChile(f.created_at),
          f.sku || '',
          f.nombre || '',
          NOMBRE_CAMPO[f.campo] || f.campo,
          numero(f.anterior) ?? '',
          nuevo ?? '',
          f.campo === 'costo' || !nuevo ? '' : brutoDeNeto(nuevo),
          f.usuario_email || '',
          NOMBRE_ORIGEN[f.origen] || f.origen || '',
          o ? `No se escribió: ${o.motivo}` : plan.destino.get(id) || '',
        ]);
      }
      try {
        await anotarEnBitacora(cliente, libro.hayBitacora, bitacora);
      } catch (e: any) {
        this.logger.warn(`Bitácora del Sheet: ${explicarErrorGoogle(e, cuenta)}`);
      }

      const fin = new Date().toISOString();
      await this.marcar(enviadas, { sheet_estado: 'enviado', sheet_error: null, sheet_at: fin });
      for (const [motivo, ids] of porMotivo) await this.marcar(ids, { sheet_estado: 'omitido', sheet_error: motivo.slice(0, 500), sheet_at: fin });
      if (reintentar.length) {
        const motivo = omitido.get(Number(reintentar[0].producto_id))?.motivo || 'El Sheet cambió de estructura.';
        await this.marcarError(reintentar, motivo);
      }

      const resumen = resumenDePlan(plan);
      const sinEscribir = porMotivo.size ? [...porMotivo.values()].reduce((a, b) => a + b.length, 0) : 0;
      const resultado: ResultadoEnvio = {
        estado: 'ok',
        cambios: filas.length,
        celdas: resumen.celdas,
        agregados: resumen.agregados,
        omitidos: sinEscribir + reintentar.length,
        mensaje: `${filas.length} cambio(s) de precio procesados: ${resumen.celdas} celda(s) escritas en el Sheet${resumen.agregados ? `, ${resumen.agregados} producto(s) agregados` : ''}${sinEscribir + reintentar.length ? `, ${sinEscribir + reintentar.length} sin escribir` : ''}.`,
      };
      await this.anotarEnvio({ tipo: 'cambios', usuario_email: null, productos: pedidos.length, celdas: resumen.celdas, agregados: resumen.agregados, omitidos: resultado.omitidos, estado: 'ok', detalle: resumen });
      if (resumen.celdas || resumen.agregados) this.logger.log(`Sheet de precios: ${resultado.mensaje}`);
      // Página llena: queda más en la cola.
      if (candidatas.length >= 1000) this.despertar(1000);
      return resultado;
    } catch (e: any) {
      const mensaje = explicarErrorGoogle(e, cuenta);
      this.logger.warn(`Sheet de precios: ${mensaje}`);
      this.accesoVisto = null;
      await this.marcarError(filas, mensaje);
      await this.anotarEnvio({ tipo: 'cambios', usuario_email: null, productos: 0, celdas: 0, agregados: 0, omitidos: 0, estado: 'error', error: mensaje.slice(0, 500) });
      return { estado: 'error', cambios: filas.length, celdas: 0, agregados: 0, omitidos: 0, mensaje };
    }
  }

  /* «Reintentar ahora»: los que agotaron sus intentos vuelven a la cola. */
  async reintentar() {
    const { error } = await this.db.from(TABLA).update({ sheet_estado: 'pendiente', sheet_intentos: 0 }).eq('sheet_estado', 'error');
    if (error) throw new BadRequestException(noExiste(error) ? 'Falta aplicar la migración 20261112_precios_sheet.sql.' : error.message);
    return this.enviarPendientes();
  }

  /* ── Nivelación: el Sheet queda igual a la plataforma ──────────────────── */
  private huella(plan: Plan) {
    const h = createHash('sha1');
    for (const e of plan.escrituras) h.update(`${e.rango}=${e.valor};`);
    for (const n of plan.nuevas) h.update(`+${n.pestana}:${n.fila}:${n.valores[0]};`);
    return h.digest('hex').slice(0, 16);
  }

  private async leerLibroOExplicar(): Promise<{ cliente: ClienteSheet; libro: LibroLeido }> {
    if (!this.hayAcceso()) throw new BadRequestException('Falta GOOGLE_SERVICE_ACCOUNT_JSON en este servidor: no se puede leer el Sheet.');
    const cliente = this.clienteSheet();
    try {
      return { cliente, libro: await leerLibro(cliente) };
    } catch (e: any) {
      throw new BadRequestException(explicarErrorGoogle(e, credencialesDeServicio()?.email || null));
    }
  }

  async nivelar(opciones: { campos?: string[]; agregar?: boolean; simular: boolean; huella?: string; usuario?: string | null; verCostos: boolean }) {
    let campos = CAMPOS.filter((c) => !opciones.campos?.length || opciones.campos.includes(c));
    if (!opciones.verCostos) campos = campos.filter((c) => c !== 'costo');
    if (!campos.length) throw new BadRequestException('Elige al menos un precio para nivelar.');
    const agregar = opciones.agregar !== false;

    return this.enSerie(async () => {
      const productos = (await this.productosConSku()) as ProductoPrecio[];
      const { cliente, libro } = await this.leerLibroOExplicar();
      const plan = planificar(productos.map((producto) => ({ producto, campos: [...campos] })), libro.pestanas, { borrarVacios: false, agregarFaltantes: agregar, seguirLista3: false });
      const resumen = resumenDePlan(plan);
      const huella = this.huella(plan);
      const nombre = new Map(productos.map((p) => [Number(p.id), p.nombre || '']));

      if (opciones.simular) {
        return {
          simulacion: true,
          huella,
          campos,
          revisados: productos.length,
          resumen,
          detalle: plan.escrituras.slice(0, 6000).map((e) => ({ sku: e.sku, nombre: nombre.get(e.producto_id) || '', pestana: e.pestana, fila: e.fila, campo: e.campo, antes_neto: e.antes_neto, ahora_neto: e.ahora_neto, valor: e.valor })),
          nuevas: plan.nuevas.map((n) => ({ sku: n.valores[0], nombre: n.producto.nombre || '', pestana: n.pestana, fila: n.fila })),
          omitidos: plan.omitidos.slice(0, 2000),
        };
      }

      if (!opciones.huella || opciones.huella !== huella) {
        throw new ConflictException('El Sheet o los precios cambiaron desde la simulación. Vuelve a simular antes de enviar.');
      }
      const usuario = String(opciones.usuario || '').trim().toLowerCase() || null;
      try {
        await aplicarPlan(cliente, plan, libro);
      } catch (e: any) {
        const mensaje = explicarErrorGoogle(e, credencialesDeServicio()?.email || null);
        await this.anotarEnvio({ tipo: 'nivelacion', usuario_email: usuario, productos: 0, celdas: 0, agregados: 0, omitidos: 0, estado: 'error', error: mensaje.slice(0, 500) });
        throw new BadRequestException(`${mensaje} Si alcanzó a escribir una parte, vuelve a simular: solo quedará lo que falta.`);
      }
      this.accesoVisto = null;
      const fecha = fechaChile(new Date());
      const bitacora: any[][] = [
        ...plan.escrituras.map((e) => [fecha, e.sku, nombre.get(e.producto_id) || '', NOMBRE_CAMPO[e.campo], e.antes_neto ?? '', e.ahora_neto ?? '', e.campo === 'costo' ? '' : e.valor, usuario || '', NOMBRE_ORIGEN.nivelacion, `«${e.pestana}» fila ${e.fila}`]),
        ...plan.nuevas.map((n) => [fecha, n.valores[0], n.producto.nombre || '', 'Producto agregado', '', '', '', usuario || '', NOMBRE_ORIGEN.nivelacion, `«${n.pestana}» fila ${n.fila}`]),
      ];
      let avisoBitacora: string | null = null;
      try {
        await anotarEnBitacora(cliente, libro.hayBitacora, bitacora);
      } catch (e: any) {
        avisoBitacora = `Los precios quedaron escritos, pero no se pudo anotar la bitácora: ${explicarErrorGoogle(e, null)}`;
        this.logger.warn(avisoBitacora);
      }
      await this.anotarEnvio({ tipo: 'nivelacion', usuario_email: usuario, productos: resumen.productos, celdas: resumen.celdas, agregados: resumen.agregados, omitidos: resumen.omitidos, estado: 'ok', detalle: resumen });
      return { ok: true, resumen, aviso: avisoBitacora };
    });
  }

  /* ── Actualización de precios desde la plataforma ──────────────────────── */
  private normalizarCambios(entrada: any, verCostos: boolean): CambioPedido[] {
    const lista = Array.isArray(entrada) ? entrada : [];
    if (!lista.length) throw new BadRequestException('No hay precios que actualizar.');
    if (lista.length > MAX_POR_GUARDADO) throw new BadRequestException(`Se pueden actualizar hasta ${MAX_POR_GUARDADO} productos por vez. Para más, usa la carga masiva de Productos (también llega al Sheet).`);
    const salida: CambioPedido[] = [];
    const vistos = new Set<number>();
    for (const c of lista) {
      const id = Number(c?.id);
      if (!Number.isInteger(id) || id <= 0 || vistos.has(id)) continue;
      vistos.add(id);
      const cambio: CambioPedido = { id };
      for (const campo of CAMPOS) {
        if (c?.[campo] === undefined || c?.[campo] === null || c?.[campo] === '') continue;
        const n = Number(c[campo]);
        if (!Number.isFinite(n) || n < 0) throw new BadRequestException(`El valor de ${NOMBRE_CAMPO[campo]} no es un número válido.`);
        if (campo === 'costo' && !verCostos) throw new ForbiddenException('Tu perfil no permite cambiar el costo (falta «Ver el costo de los productos»).');
        cambio[campo] = campo === 'costo' ? Math.round(n * 100) / 100 : Math.round(n);
      }
      salida.push(cambio);
    }
    return salida;
  }

  /* Qué cambia de verdad respecto de lo guardado. */
  private diferencias(cambios: CambioPedido[], productos: Map<number, ProductoPrecio>) {
    const lista: { producto: ProductoPrecio; cuerpo: Record<string, number>; cambios: { campo: Campo; antes: number | null; ahora: number }[] }[] = [];
    for (const c of cambios) {
      const producto = productos.get(c.id);
      if (!producto) continue;
      const cuerpo: Record<string, number> = {};
      const detalle: { campo: Campo; antes: number | null; ahora: number }[] = [];
      for (const campo of CAMPOS) {
        const ahora = c[campo];
        if (ahora === undefined) continue;
        const antes = numero(producto[campo]);
        if ((antes ?? 0) === ahora) continue;
        cuerpo[campo] = ahora;
        detalle.push({ campo, antes, ahora });
      }
      if (detalle.length) lista.push({ producto, cuerpo, cambios: detalle });
    }
    return lista;
  }

  async simularPrecios(entrada: any, verCostos: boolean) {
    const cambios = this.normalizarCambios(entrada, verCostos);
    const productos = await this.productosPorId(cambios.map((c) => c.id));
    const difs = this.diferencias(cambios, productos);
    let sheet: { disponible: boolean; error?: string } = { disponible: false, error: 'Falta GOOGLE_SERVICE_ACCOUNT_JSON en este servidor: no se pudo revisar el Sheet.' };
    let plan: Plan | null = null;
    if (difs.length && this.hayAcceso()) {
      try {
        const libro = await leerLibro(this.clienteSheet());
        const pedidos: Pedido[] = difs.map((d) => ({ producto: { ...d.producto, ...d.cuerpo }, campos: d.cambios.map((x) => x.campo) }));
        plan = planificar(pedidos, libro.pestanas, { borrarVacios: true, agregarFaltantes: true });
        sheet = { disponible: true };
      } catch (e: any) {
        sheet = { disponible: false, error: explicarErrorGoogle(e, credencialesDeServicio()?.email || null) };
      }
    } else if (!difs.length) {
      sheet = { disponible: this.hayAcceso() };
    }
    const omitido = new Map((plan?.omitidos || []).map((o) => [o.producto_id, o.motivo]));
    const celdas = new Map<number, number>();
    for (const e of plan?.escrituras || []) celdas.set(e.producto_id, (celdas.get(e.producto_id) || 0) + 1);
    return {
      simulacion: true,
      recibidos: cambios.length,
      con_cambios: difs.length,
      sheet,
      resumen: plan ? resumenDePlan(plan) : null,
      productos: difs.map((d) => {
        const id = Number(d.producto.id);
        const destino = plan?.destino.get(id) || null;
        return {
          id,
          sku: d.producto.sku,
          nombre: d.producto.nombre,
          cambios: d.cambios,
          sheet: !plan ? null : omitido.has(id) ? { escribe: false, texto: omitido.get(id) } : { escribe: true, texto: celdas.get(id) ? `${celdas.get(id)} celda(s) en ${destino}` : destino?.startsWith('Agregado') ? destino : `Ya está igual en ${destino}` },
        };
      }),
    };
  }

  async guardarPrecios(entrada: any, usuario: string | null, verCostos: boolean) {
    const cambios = this.normalizarCambios(entrada, verCostos);
    const productos = await this.productosPorId(cambios.map((c) => c.id));
    const difs = this.diferencias(cambios, productos);
    if (!difs.length) return { guardados: 0, errores: [], sheet: null, mensaje: 'Los precios ya estaban así: no hubo nada que guardar.' };

    const errores: { id: number; sku: string | null; mensaje: string }[] = [];
    let guardados = 0;
    // De a 3: cada guardado también actualiza el precio en Bsale.
    for (const parte of trozos(difs, 3)) {
      await Promise.all(
        parte.map(async (d) => {
          try {
            await this.productos.update(Number(d.producto.id), { ...d.cuerpo }, usuario);
            guardados++;
          } catch (e: any) {
            errores.push({ id: Number(d.producto.id), sku: d.producto.sku, mensaje: String(e?.message || e).slice(0, 200) });
          }
        }),
      );
    }
    // El historial se anota en segundo plano: se le da un momento y se envía.
    await new Promise((r) => setTimeout(r, 1200));
    let sheet: ResultadoEnvio | null = null;
    try {
      sheet = await this.enviarPendientes();
    } catch (e: any) {
      sheet = { estado: 'error', cambios: 0, celdas: 0, agregados: 0, omitidos: 0, mensaje: String(e?.message || e) };
    }
    return { guardados, errores, sheet, mensaje: `${guardados} producto(s) actualizados${errores.length ? `, ${errores.length} con error` : ''}.` };
  }

  /* ── Historial ─────────────────────────────────────────────────────────── */
  async cambios(limite: number, verCostos: boolean) {
    const n = Math.max(1, Math.min(Number(limite) || 200, 500));
    let q = this.db.from(TABLA).select('id, producto_id, sku, nombre, campo, anterior, nuevo, origen, usuario_email, created_at, sheet_estado, sheet_at, sheet_error, sheet_intentos');
    if (!verCostos) q = q.neq('campo', 'costo');
    const { data, error } = await q.order('id', { ascending: false }).limit(n);
    if (error) return { listo: false, cambios: [] };
    return { listo: true, cambios: data || [] };
  }

  async envios() {
    const { data, error } = await this.db
      .from('precios_sheet_envios')
      .select('id, tipo, usuario_email, productos, celdas, agregados, omitidos, estado, error, created_at')
      .order('id', { ascending: false })
      .limit(40);
    if (error) return { listo: false, envios: [] };
    return { listo: true, envios: data || [] };
  }
}
