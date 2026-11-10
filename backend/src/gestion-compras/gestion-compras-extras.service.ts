import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { MailingsService } from '../mailings/mailings.service';
import { plantillaQuiebreStock } from '../correos/correos.templates';
import { esRolAdmin, permisosEfectivos } from '../auth/permisos';

/* ============================================================================
   Gestión de compras: proveedores por producto y quiebres de stock (2026-11-06)
   ----------------------------------------------------------------------------
   Pedidos de Ariel:
   · "Añadimos el listado de proveedores y se puede ir seleccionando por
     producto más de un proveedor. Luego esta selección la llevamos a una nueva
     pestaña en este mismo módulo llamada «Consolidado Compras»."
   · "Agregar un botón para declaración de quiebre de stock: se debe
     seleccionar el producto y adjuntar el documento de respaldo (opcional).
     Una vez se declare, se debe notificar al vendedor mediante alerta y popup.
     Adicionalmente esto se debe ir a una pestaña con los productos con quiebre
     de stock y, cuando se despache, se elimine de ese repositorio."

   PROVEEDORES POR PRODUCTO (gestion_compras_proveedores): por cada producto de
   «Por comprar» —identificado por su `clave`, la misma con que el resumen
   agrupa— los proveedores elegidos. El «Consolidado Compras» lo arma la
   pantalla agrupando esos productos por proveedor.

   QUIEBRES DE STOCK (quiebres_stock): al declarar se guardan las cotizaciones
   que tienen ese producto por despachar y se avisa a su vendedor (tipo
   `quiebre_stock`: campana + ventana flotante). El quiebre desaparece de la
   pestaña cuando ninguna de esas cotizaciones tiene ya unidades por despachar
   de ese producto (se despachó, se cerró o dejó de estar adjudicada); también
   se puede quitar a mano. Esa revisión la hace el resumen cada vez que se
   calcula COMPLETO (sin filtro de fecha), para no dar por despachado lo que
   solo quedó fuera del filtro.

   El respaldo (opcional) va al bucket PRIVADO `quiebres-stock` y se entrega
   con URL firmada. Tablas y bucket: migración
   20261106_gestion_compras_proveedores_quiebres.

   (2026-11-09) Pedido de Ariel: «que le llegue por correo y notificación y en
   ambas que le permita descargar el archivo de respaldo». Además de la
   campana, cada vendedor avisado recibe UN correo con todas sus cotizaciones
   afectadas y el respaldo adjunto; el aviso de la campana lleva
   `tiene_respaldo`/`file_name` y el vendedor lo baja por
   GET /quiebres-stock/:id/respaldo (sin el módulo Gestión de compras: basta
   ser vendedor o dueño de una cotización afectada).
============================================================================ */

const MIGRACION = 'Falta aplicar la migración 20261106_gestion_compras_proveedores_quiebres.sql en Supabase.';
const BUCKET = 'quiebres-stock';
export const MAX_BYTES_RESPALDO = 15 * 1024 * 1024;
const EXTENSIONES = ['pdf', 'png', 'jpg', 'jpeg', 'webp', 'doc', 'docx', 'xls', 'xlsx', 'msg', 'eml'];
const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;
const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const TIPO_QUIEBRE = 'quiebre_stock';

const texto = (v: any, max: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const correo = (v: any) => String(v ?? '').trim().toLowerCase();
const fechaCorta = (iso: any) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  return m ? `${m[3]}-${m[2]}-${m[1]}` : '';
};

/* El nombre del archivo llega de multer en latin1: se pasa a UTF-8 cuando corresponde. */
function nombreArchivo(original: any): string {
  const crudo = String(original || 'respaldo');
  let nombre = crudo;
  try {
    const utf8 = Buffer.from(crudo, 'latin1').toString('utf8');
    if (!utf8.includes('�')) nombre = utf8;
  } catch { /* se deja como vino */ }
  return nombre.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-').trim().slice(0, 160) || 'respaldo';
}

export type CotizacionAfectada = {
  id: number;
  codigo: string | null;
  cliente: string;
  vendedor: string;
  vendedor_correo: string;
  pendiente: number;
};

@Injectable()
export class GestionComprasExtrasService {
  private readonly logger = new Logger(GestionComprasExtrasService.name);

  constructor(
    private supabase: SupabaseService,
    private mailings: MailingsService,
  ) {}

  private get db() {
    return this.supabase.getClient();
  }

  private sinTabla(error: any): boolean {
    return /(schema cache|does not exist|not find|PGRST205|42P01)/i.test(`${error?.code} ${error?.message}`);
  }

  private fallo(error: any): never {
    if (this.sinTabla(error)) throw new BadRequestException(MIGRACION);
    throw new BadRequestException(String(error?.message || 'No se pudo guardar.'));
  }

  /* ------------------------------------------------------------ proveedores */

  /* Listado de proveedores para elegir (lo mínimo: Gestión de compras no exige el módulo Proveedores). */
  async proveedores(): Promise<{ id: number; razon_social: string; rut: string; marcas: string[] }[]> {
    const { data, error } = await this.db.from('proveedores').select('*').order('razon_social', { ascending: true }).range(0, 1999);
    if (error) {
      this.logger.warn(`Gestión de compras: no se pudieron leer los proveedores: ${error.message}`);
      return [];
    }
    return ((data || []) as any[]).map((p) => ({
      id: Number(p.id),
      razon_social: String(p.razon_social || ''),
      rut: String(p.rut || ''),
      marcas: Array.isArray(p.marcas) ? p.marcas.map((m: any) => String(m)) : [],
    }));
  }

  /* Proveedores elegidos por producto: clave → ids. `listo: false` = falta la migración. */
  async asignaciones(): Promise<{ listo: boolean; porClave: Map<string, number[]> }> {
    const porClave = new Map<string, number[]>();
    const { data, error } = await this.db.from('gestion_compras_proveedores').select('clave, proveedor_id').order('id', { ascending: true }).range(0, 9999);
    if (error) {
      if (!this.sinTabla(error)) this.logger.warn(`Gestión de compras: no se pudieron leer los proveedores por producto: ${error.message}`);
      return { listo: false, porClave };
    }
    for (const f of (data || []) as any[]) {
      const k = String(f.clave || '');
      porClave.set(k, [...(porClave.get(k) || []), Number(f.proveedor_id)]);
    }
    return { listo: true, porClave };
  }

  /* Deja EXACTAMENTE estos proveedores para el producto (los que sobran se quitan). */
  async asignar(body: any, email: string) {
    const clave = texto(body?.clave, 300);
    if (!clave) throw new BadRequestException('Falta el producto.');
    const pedidos: number[] = [...new Set<number>((Array.isArray(body?.proveedor_ids) ? body.proveedor_ids : []).map((n: any) => Number(n)).filter((n: number) => Number.isInteger(n) && n > 0))];
    if (pedidos.length > 30) throw new BadRequestException('Son demasiados proveedores para un producto (máximo 30).');
    if (pedidos.length) {
      const { data: existen, error: e0 } = await this.db.from('proveedores').select('id').in('id', pedidos);
      if (e0) throw new BadRequestException(e0.message);
      const validos = new Set(((existen || []) as any[]).map((p) => Number(p.id)));
      const faltan = pedidos.filter((id) => !validos.has(id));
      if (faltan.length) throw new BadRequestException('Uno de los proveedores elegidos ya no existe: actualiza la página.');
    }
    const { data: actuales, error } = await this.db.from('gestion_compras_proveedores').select('id, proveedor_id').eq('clave', clave);
    if (error) this.fallo(error);
    const ya = new Map<number, number>(((actuales || []) as any[]).map((f) => [Number(f.proveedor_id), Number(f.id)]));
    const quitar = [...ya.entries()].filter(([prov]) => !pedidos.includes(prov)).map(([, id]) => id);
    const agregar = pedidos.filter((prov) => !ya.has(prov));
    if (quitar.length) {
      const { error: e1 } = await this.db.from('gestion_compras_proveedores').delete().in('id', quitar);
      if (e1) this.fallo(e1);
    }
    if (agregar.length) {
      const productoId = Number(body?.producto_id) > 0 ? Number(body.producto_id) : null;
      const filas = agregar.map((proveedor_id) => ({ clave, sku: texto(body?.sku, 80) || null, producto: texto(body?.producto, 300) || null, producto_id: productoId, proveedor_id, usuario_email: email || null }));
      const { error: e2 } = await this.db.from('gestion_compras_proveedores').insert(filas);
      if (e2) this.fallo(e2);
    }
    return { clave, proveedor_ids: pedidos };
  }

  /* Alta rápida de un proveedor desde Gestión de compras (solo lo esencial; el resto se completa en Proveedores). */
  async crearProveedor(body: any, email: string) {
    const razon = texto(body?.razon_social, 160);
    if (razon.length < 2) throw new BadRequestException('Escribe la razón social del proveedor.');
    const { data: repetidos } = await this.db.from('proveedores').select('id, razon_social').ilike('razon_social', razon.replace(/[%_\\]/g, (c) => `\\${c}`)).limit(1);
    const repetido = ((repetidos || []) as any[])[0];
    if (repetido) return { id: Number(repetido.id), razon_social: String(repetido.razon_social || ''), rut: '', marcas: [], existia: true };
    const { data, error } = await this.db.from('proveedores').insert({ razon_social: razon, rut: texto(body?.rut, 20) || null, creado_por: email || null }).select('id, razon_social, rut').single();
    if (error) throw new BadRequestException(error.message);
    return { id: Number(data.id), razon_social: String(data.razon_social || ''), rut: String(data.rut || ''), marcas: [], existia: false };
  }

  /* --------------------------------------------------------------- quiebres */

  private vistaQuiebre(q: any) {
    return {
      id: Number(q.id),
      clave: String(q.clave || ''),
      sku: q.sku || '',
      producto: q.producto || '',
      producto_id: q.producto_id == null ? null : Number(q.producto_id),
      motivo: q.motivo || '',
      fecha_estimada: q.fecha_estimada ? String(q.fecha_estimada).slice(0, 10) : null,
      cotizaciones: (Array.isArray(q.cotizaciones) ? q.cotizaciones : []) as CotizacionAfectada[],
      tiene_respaldo: !!q.storage_path,
      file_name: q.file_name || null,
      declarado_por: q.declarado_por || '',
      created_at: q.created_at,
    };
  }

  /* Quiebres activos, del más nuevo al más antiguo. `listo: false` = falta la migración. */
  async quiebresActivos(): Promise<{ listo: boolean; quiebres: ReturnType<GestionComprasExtrasService['vistaQuiebre']>[] }> {
    const { data, error } = await this.db.from('quiebres_stock').select('*').eq('estado', 'activo').order('id', { ascending: false }).range(0, 999);
    if (error) {
      if (!this.sinTabla(error)) this.logger.warn(`Gestión de compras: no se pudieron leer los quiebres de stock: ${error.message}`);
      return { listo: false, quiebres: [] };
    }
    return { listo: true, quiebres: ((data || []) as any[]).map((q) => this.vistaQuiebre(q)) };
  }

  /* Declara el quiebre de un producto y avisa a los vendedores de las cotizaciones afectadas. */
  async declarar(
    body: any,
    file: Express.Multer.File | undefined,
    email: string,
    afectadas: CotizacionAfectada[],
    producto: { clave: string; sku: string; producto: string; producto_id: number | null },
  ) {
    if (!afectadas.length) throw new BadRequestException('Ese producto no tiene unidades por despachar en ninguna cotización adjudicada: no hay a quién avisar.');
    const { data: previos, error: e0 } = await this.db.from('quiebres_stock').select('id').eq('estado', 'activo').eq('clave', producto.clave).limit(1);
    if (e0) this.fallo(e0);
    if ((previos || []).length) throw new BadRequestException('Ese producto ya tiene un quiebre de stock declarado. Quítalo primero si quieres declararlo de nuevo.');

    const fecha = RE_FECHA.test(String(body?.fecha_estimada || '')) ? String(body.fecha_estimada) : null;
    const motivo = texto(body?.motivo, 400);
    let respaldo: Record<string, any> = {};
    if (file?.buffer?.length) {
      if (file.size > MAX_BYTES_RESPALDO) throw new BadRequestException('El respaldo supera los 15 MB.');
      const nombre = nombreArchivo(file.originalname);
      const ext = (nombre.split('.').pop() || '').toLowerCase();
      if (!EXTENSIONES.includes(ext)) throw new BadRequestException(`El respaldo debe ser PDF, imagen, Word, Excel o correo (${EXTENSIONES.join(', ')}).`);
      const ruta = `${new Date().toISOString().slice(0, 7)}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error: eSubida } = await this.db.storage.from(BUCKET).upload(ruta, file.buffer, { contentType: file.mimetype || 'application/octet-stream', upsert: false });
      if (eSubida) throw new BadRequestException(/bucket/i.test(String(eSubida.message)) ? MIGRACION : `No se pudo subir el respaldo: ${eSubida.message}`);
      respaldo = { bucket: BUCKET, storage_path: ruta, file_name: nombre, mime_type: file.mimetype || null, size_bytes: file.size };
    }
    const { data, error } = await this.db
      .from('quiebres_stock')
      .insert({ clave: producto.clave, sku: producto.sku || null, producto: producto.producto, producto_id: producto.producto_id, motivo: motivo || null, fecha_estimada: fecha, cotizaciones: afectadas, declarado_por: email || null, ...respaldo })
      .select('*')
      .single();
    if (error) {
      if (respaldo.storage_path) await this.db.storage.from(BUCKET).remove([respaldo.storage_path]).then(() => undefined, () => undefined);
      this.fallo(error);
    }
    const vista = this.vistaQuiebre(data);
    const avisados = await this.avisar(vista, email);
    const adjunto = respaldo.storage_path && file?.buffer?.length
      ? { filename: String(respaldo.file_name), content: file.buffer, contentType: file.mimetype || undefined }
      : null;
    const correos = await this.avisarPorCorreo(vista, email, adjunto);
    this.logger.log(
      `Quiebre de stock declarado por ${email}: ${producto.sku || producto.producto} · ${afectadas.length} cotización(es) · ` +
        `${avisados} aviso(s) · ${correos.enviados} correo(s)${correos.fallidos ? ` (${correos.fallidos} no salieron)` : ''}`,
    );
    return { quiebre: vista, avisados, correos: correos.enviados, correos_fallidos: correos.fallidos };
  }

  /* Vendedores a avisar: correo válido y distinto de quien declara (no se avisa a sí mismo). */
  private destinatarios(q: ReturnType<GestionComprasExtrasService['vistaQuiebre']>, declaradoPor: string) {
    return q.cotizaciones.filter((c) => RE_EMAIL.test(correo(c.vendedor_correo)) && correo(c.vendedor_correo) !== correo(declaradoPor));
  }

  /* (2026-11-09) UN correo por vendedor con todas sus cotizaciones afectadas y
     el respaldo adjunto. Se envían en paralelo (cada uno con su propio tope de
     tiempo en el SMTP). Nunca lanza: si un correo no sale, la campana ya quedó. */
  private async avisarPorCorreo(
    q: ReturnType<GestionComprasExtrasService['vistaQuiebre']>,
    declaradoPor: string,
    adjunto: { filename: string; content: Buffer; contentType?: string } | null,
  ): Promise<{ enviados: number; fallidos: number }> {
    const porVendedor = new Map<string, { nombre: string; cotizaciones: CotizacionAfectada[] }>();
    for (const c of this.destinatarios(q, declaradoPor)) {
      const para = correo(c.vendedor_correo);
      const e = porVendedor.get(para) || { nombre: '', cotizaciones: [] };
      // `vendedor` cae al correo cuando no hay nombre: en ese caso el saludo va sin nombre.
      if (!e.nombre && c.vendedor && !RE_EMAIL.test(c.vendedor)) e.nombre = String(c.vendedor).trim();
      e.cotizaciones.push(c);
      porVendedor.set(para, e);
    }
    if (!porVendedor.size) return { enviados: 0, fallidos: 0 };

    const quien = correo(declaradoPor);
    let quienNombre = '';
    if (quien) {
      try {
        const { data: p } = await this.db.from('profiles').select('nombre').ilike('email', quien).maybeSingle();
        quienNombre = String((p as any)?.nombre || '').trim();
      } catch { /* sin nombre: va el correo */ }
    }
    const base = String(process.env.APP_PUBLIC_URL || process.env.PUBLIC_APP_URL || process.env.FRONTEND_URL || '')
      .trim()
      .replace(/\/+$/, '');

    const resultados = await Promise.allSettled(
      [...porVendedor.entries()].map(([para, v]) => {
        const plantilla = plantillaQuiebreStock({
          vendedorNombre: v.nombre || null,
          producto: q.producto,
          sku: q.sku || null,
          motivo: q.motivo || null,
          fechaEstimada: q.fecha_estimada ? fechaCorta(q.fecha_estimada) : null,
          declaradoPorNombre: quienNombre || quien || 'Compras',
          declaradoPorCorreo: quienNombre && quien ? quien : null,
          cotizaciones: v.cotizaciones.map((c) => ({ id: c.id, codigo: c.codigo, cliente: c.cliente, pendiente: c.pendiente, enlace: base ? `${base}/detalle/${c.id}` : null })),
          respaldoNombre: adjunto?.filename || null,
        });
        return this.mailings
          .enviarUno({
            para,
            asunto: plantilla.asunto,
            cuerpoHtml: plantilla.html,
            // Si el vendedor responde, le llega a quien declaró el quiebre.
            replyTo: RE_EMAIL.test(quien) ? quien : undefined,
            attachments: adjunto ? [adjunto] : undefined,
          })
          .catch((e: any) => {
            this.logger.warn(`Quiebre de stock ${q.id}: el correo a ${para} no salió (la campana sí quedó): ${e?.message || e}`);
            throw e;
          });
      }),
    );
    const enviados = resultados.filter((r) => r.status === 'fulfilled').length;
    return { enviados, fallidos: resultados.length - enviados };
  }

  /* Un aviso por (vendedor, cotización). Quien declara no se avisa a sí mismo. Nunca lanza. */
  private async avisar(q: ReturnType<GestionComprasExtrasService['vistaQuiebre']>, declaradoPor: string): Promise<number> {
    try {
      const filas = this.destinatarios(q, declaradoPor)
        .map((c) => ({
          user_email: correo(c.vendedor_correo),
          tipo: TIPO_QUIEBRE,
          mensaje:
            `Quiebre de stock: «${q.producto}»${q.sku ? ` (${q.sku})` : ''} no está disponible. Afecta tu cotización #${c.id}${c.cliente ? ` de ${c.cliente}` : ''}: ` +
            `${Number(c.pendiente).toLocaleString('es-CL')} unidad${Number(c.pendiente) === 1 ? '' : 'es'} por despachar.` +
            (q.fecha_estimada ? ` Reposición estimada: ${fechaCorta(q.fecha_estimada)}.` : '') +
            (q.motivo ? ` ${q.motivo}` : ''),
          link: `/detalle/${c.id}`,
          metadata: {
            licitacion_id: c.id, id_licitacion: c.codigo, quiebre_id: q.id, sku: q.sku || null, producto: q.producto, pendiente: c.pendiente,
            fecha_estimada: q.fecha_estimada, cliente: c.cliente, declarado_por: declaradoPor,
            // (2026-11-09) La campana y la ventana flotante muestran «Descargar respaldo».
            tiene_respaldo: q.tiene_respaldo, file_name: q.file_name,
          },
        }));
      if (!filas.length) return 0;
      const { error } = await this.db.from('notificaciones').insert(filas);
      if (error) throw new Error(error.message);
      return filas.length;
    } catch (e: any) {
      this.logger.warn(`No se pudo avisar el quiebre de stock ${q.id}: ${e?.message || e}`);
      return 0;
    }
  }

  /* URL firmada (10 min) del respaldo de un quiebre. */
  async urlRespaldo(id: number) {
    const { data, error } = await this.db.from('quiebres_stock').select('id, bucket, storage_path, file_name').eq('id', id).maybeSingle();
    if (error) this.fallo(error);
    if (!data?.storage_path) throw new NotFoundException('Ese quiebre no tiene documento de respaldo.');
    const firmada = await this.db.storage.from(data.bucket || BUCKET).createSignedUrl(String(data.storage_path), 600, { download: data.file_name || true });
    if (firmada.error || !firmada.data?.signedUrl) throw new BadRequestException('No se pudo generar el enlace del respaldo.');
    return { url: firmada.data.signedUrl, file_name: data.file_name || null };
  }

  /* (2026-11-09) El mismo respaldo, para quien recibió el aviso (campana o
     ventana flotante) sin tener el módulo Gestión de compras. Puede bajarlo:
     el vendedor avisado de una cotización afectada, el dueño ACTUAL de alguna
     de ellas (si se reasignó después), un admin o quien tenga `gestion_compras`. */
  async urlRespaldoAvisado(id: number, user: { id?: string; email?: string } | null | undefined) {
    const { data, error } = await this.db.from('quiebres_stock').select('id, cotizaciones').eq('id', id).maybeSingle();
    if (error) this.fallo(error);
    if (!data) throw new NotFoundException('Ese quiebre de stock ya no existe.');
    const yo = correo(user?.email);
    const cots = (Array.isArray(data.cotizaciones) ? data.cotizaciones : []) as CotizacionAfectada[];
    let puede = !!yo && cots.some((c) => correo(c?.vendedor_correo) === yo);
    if (!puede && yo) {
      const ids = cots.map((c) => Number(c?.id)).filter((n) => Number.isInteger(n) && n > 0);
      if (ids.length) {
        const { data: lics } = await this.db.from('licitaciones').select('vendedor_correo, creado_por').in('id', ids);
        puede = ((lics || []) as any[]).some((l) => (correo(l.vendedor_correo) || correo(l.creado_por)) === yo);
      }
    }
    if (!puede) puede = await this.tieneGestionCompras(user?.id);
    if (!puede) throw new ForbiddenException('El respaldo de este quiebre de stock es para los vendedores de las cotizaciones afectadas.');
    return this.urlRespaldo(id);
  }

  /* Mismo cálculo que GestionComprasGuard: admin o módulo `gestion_compras` en los permisos efectivos. */
  private async tieneGestionCompras(userId?: string): Promise<boolean> {
    if (!userId) return false;
    const { data: perfil } = await this.db.from('profiles').select('rol, permission_profile_id').eq('id', userId).maybeSingle();
    const rol = String(perfil?.rol || '').trim().toLowerCase();
    if (esRolAdmin(rol)) return true;
    let permisosPerfil: any = null;
    if (perfil?.permission_profile_id) {
      const { data: asignado } = await this.db.from('permission_profiles').select('permisos').eq('id', perfil.permission_profile_id).maybeSingle();
      permisosPerfil = asignado?.permisos ?? null;
    }
    return permisosEfectivos(rol, permisosPerfil).includes('gestion_compras');
  }

  /* Saca el quiebre de la pestaña. `resolucion`: 'despachado' (automático) o 'manual'. */
  async resolver(ids: number[], resolucion: 'despachado' | 'manual', email: string | null): Promise<number> {
    const lista = [...new Set(ids.map(Number).filter((n) => n > 0))];
    if (!lista.length) return 0;
    const { data, error } = await this.db
      .from('quiebres_stock')
      .update({ estado: 'resuelto', resuelto_at: new Date().toISOString(), resuelto_por: email, resolucion })
      .in('id', lista)
      .eq('estado', 'activo')
      .select('id');
    if (error) {
      if (resolucion === 'manual') this.fallo(error);
      this.logger.warn(`No se pudieron cerrar los quiebres despachados: ${error.message}`);
      return 0;
    }
    return (data || []).length;
  }
}
