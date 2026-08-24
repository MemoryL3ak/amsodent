import { Injectable, BadRequestException, NotFoundException, Logger } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

@Injectable()
export class ProductosService {
  private readonly logger = new Logger(ProductosService.name);

  constructor(private supabase: SupabaseService) {}

  async findAll() {
    const { data, error } = await this.supabase
      .getClient()
      .from('productos')
      .select('*')
      .range(0, 20000)
      .order('id', { ascending: true });
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  // Campos de precio: cualquier cambio en ellos estampa precio_actualizado_at.
  private static readonly CAMPOS_PRECIO = ['costo', 'lista1', 'lista2', 'lista3'];

  // ¿El body trae algún precio distinto al actual? (compara numéricamente;
  // los campos ausentes en el body no cuentan como cambio).
  private static cambioDePrecio(body: Record<string, any>, actual: Record<string, any> | null): boolean {
    for (const campo of ProductosService.CAMPOS_PRECIO) {
      if (body?.[campo] === undefined || body?.[campo] === null) continue;
      const nuevo = Number(body[campo]) || 0;
      const previo = Number(actual?.[campo]) || 0;
      if (nuevo !== previo) return true;
    }
    return false;
  }

  // Campos cuyo llenado define una ficha técnica "completa".
  private static readonly CAMPOS_FICHA = [
    'presentacion',
    'descripcion',
    'composicion',
    'uso_indicaciones',
    'beneficios',
    'modo_uso',
    'almacenamiento',
    'datos_clave',
  ];

  // Listado liviano para la grilla de administración: trae solo las columnas
  // visibles + un booleano `ficha_completa` calculado en el servidor. Así se
  // evita transferir los textos largos de la ficha técnica (descripción,
  // composición, etc.), que es lo que hacía pesada la carga del catálogo.
  async findAllList() {
    const sel = [
      'id',
      'sku',
      'sku_marca',
      'nombre',
      'marca',
      'categoria',
      'formato',
      'estado',
      'costo',
      'lista1',
      'lista2',
      'lista3',
      'precio_actualizado_at',
      // Datos de flete: la grilla filtra por productos con/sin peso y medidas.
      'peso',
      'largo',
      'ancho',
      'alto',
      ...ProductosService.CAMPOS_FICHA,
    ].join(', ');

    const { data, error } = await this.supabase
      .getClient()
      .from('productos')
      .select(sel)
      .range(0, 20000)
      .order('id', { ascending: true });
    if (error) throw new BadRequestException(error.message);

    return (data || []).map((p: any) => ({
      id: p.id,
      sku: p.sku,
      sku_marca: p.sku_marca,
      // `descripcion` sirve de respaldo cuando no hay nombre (igual que el front).
      nombre: (p.nombre?.trim() || p.descripcion?.trim() || ''),
      marca: p.marca,
      categoria: p.categoria,
      formato: p.formato,
      estado: p.estado,
      lista1: p.lista1,
      lista2: p.lista2,
      lista3: p.lista3,
      precio_actualizado_at: p.precio_actualizado_at,
      peso: p.peso,
      largo: p.largo,
      ancho: p.ancho,
      alto: p.alto,
      ficha_completa: ProductosService.CAMPOS_FICHA.every(
        (k) => String(p?.[k] ?? '').trim().length > 0,
      ),
    }));
  }

  async findOne(id: number) {
    const { data, error } = await this.supabase
      .getClient()
      .from('productos')
      .select('*')
      .eq('id', id)
      .single();
    if (error) throw new NotFoundException('Producto no encontrado');
    return data;
  }

  // ── Normalización de marca ────────────────────────────────────────────
  // Recorta y colapsa espacios.
  private normalizarTexto(s: any): string {
    return String(s ?? '').trim().replace(/\s+/g, ' ');
  }

  // Devuelve la forma canónica de una marca: si ya existe una marca igual
  // (ignorando mayúsculas/espacios) reutiliza la variante más usada; si no,
  // deja la forma recortada. Evita crear duplicados como "solventum" vs
  // "SOLVENTUM" al crear/editar un producto.
  private async marcaCanonica(marca: any): Promise<string> {
    const limpia = this.normalizarTexto(marca);
    if (!limpia) return limpia;
    const patron = limpia.replace(/[%_\\]/g, (m) => `\\${m}`);
    const { data } = await this.supabase
      .getClient()
      .from('productos')
      .select('marca')
      .ilike('marca', patron)
      .range(0, 50000);
    const clave = limpia.toLowerCase();
    const conteo = new Map<string, number>();
    for (const r of data || []) {
      const f = this.normalizarTexto((r as any).marca);
      if (f && f.toLowerCase() === clave) conteo.set(f, (conteo.get(f) || 0) + 1);
    }
    let mejor = limpia;
    let mejorN = 0;
    for (const [f, n] of conteo) if (n > mejorN) { mejor = f; mejorN = n; }
    return mejor;
  }

  // Mapa clave(minúsculas) → forma canónica para todas las marcas existentes.
  // Se usa en la carga masiva para no consultar una vez por fila.
  private async mapaMarcasCanonicas(): Promise<Map<string, string>> {
    const { data } = await this.supabase
      .getClient()
      .from('productos')
      .select('marca')
      .range(0, 50000);
    const porClave = new Map<string, Map<string, number>>();
    for (const r of data || []) {
      const f = this.normalizarTexto((r as any).marca);
      if (!f) continue;
      const k = f.toLowerCase();
      if (!porClave.has(k)) porClave.set(k, new Map());
      const m = porClave.get(k)!;
      m.set(f, (m.get(f) || 0) + 1);
    }
    const canon = new Map<string, string>();
    for (const [k, formas] of porClave) {
      let mejor = '';
      let mejorN = -1;
      for (const [f, n] of formas) if (n > mejorN) { mejor = f; mejorN = n; }
      canon.set(k, mejor);
    }
    return canon;
  }

  async create(body: Record<string, any>) {
    if (body && body.marca != null) {
      body = { ...body, marca: await this.marcaCanonica(body.marca) };
    }
    if (ProductosService.cambioDePrecio(body || {}, null)) {
      body = { ...body, precio_actualizado_at: new Date().toISOString() };
    }
    const { data, error } = await this.supabase
      .getClient()
      .from('productos')
      .insert([body])
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  // Carga masiva: upsert por SKU. Solo aplica para filas con sku no vacío. Los campos
  // ausentes (null/undefined) no sobrescriben los valores existentes — el frontend filtra
  // las celdas vacías antes de mandar para no pisar datos por error.
  async bulkUpsert(
    rows: Record<string, any>[],
    meta?: { archivo?: string; email?: string },
  ) {
    if (!Array.isArray(rows) || rows.length === 0) {
      return { creados: 0, actualizados: 0, ignorados: 0, errores: [] as string[] };
    }

    const validRows = rows.filter((r) => r && typeof r.sku === 'string' && r.sku.trim());
    const ignorados = rows.length - validRows.length;

    if (validRows.length === 0) {
      return { creados: 0, actualizados: 0, ignorados, errores: ['Ninguna fila trae SKU válido'] };
    }

    const skus = Array.from(new Set(validRows.map((r) => r.sku.trim())));

    // Productos existentes para clasificar creados vs actualizados. Se trae la
    // fila COMPLETA (no solo los precios) porque de ahí sale la foto del
    // "antes" que permite deshacer la carga.
    const { data: existentes, error: errFetch } = await this.supabase
      .getClient()
      .from('productos')
      .select('*')
      .in('sku', skus);
    if (errFetch) throw new BadRequestException(errFetch.message);

    const mapaSkuId = new Map<string, number>();
    const mapaSkuPrecios = new Map<string, Record<string, any>>();
    (existentes || []).forEach((p: any) => {
      mapaSkuId.set(p.sku, p.id);
      mapaSkuPrecios.set(p.sku, p);
    });

    // Detalle para el historial: qué se tocó y con qué valores previos.
    const auditoria: {
      producto_id: number | null;
      sku: string;
      accion: 'creado' | 'actualizado';
      antes: Record<string, any> | null;
      despues: Record<string, any>;
    }[] = [];

    // Mapa de marcas canónicas para no duplicar variantes al importar.
    const canonMarcas = await this.mapaMarcasCanonicas();

    let creados = 0;
    let actualizados = 0;
    const errores: string[] = [];

    // Procesamos en batches pequeños para no sobrecargar la conexión.
    const BATCH = 50;
    for (let i = 0; i < validRows.length; i += BATCH) {
      const slice = validRows.slice(i, i + BATCH);

      // Separamos: filas existentes (UPDATE individual) vs nuevas (INSERT bulk).
      const aInsertar: Record<string, any>[] = [];
      const aActualizar: { id: number; body: Record<string, any>; sku: string }[] = [];

      for (const row of slice) {
        const sku = row.sku.trim();
        const id = mapaSkuId.get(sku);
        // Limpiamos campos vacíos/null para no sobrescribir.
        const limpio: Record<string, any> = {};
        for (const [k, v] of Object.entries(row)) {
          if (v === undefined || v === null) continue;
          if (typeof v === 'string' && v.trim() === '') continue;
          limpio[k] = v;
        }
        // Unifica la marca con la canónica existente (o con la primera forma
        // vista en este import, para que las marcas nuevas no se dupliquen).
        if (typeof limpio.marca === 'string') {
          const limpia = this.normalizarTexto(limpio.marca);
          const k = limpia.toLowerCase();
          if (!canonMarcas.has(k)) canonMarcas.set(k, limpia);
          limpio.marca = canonMarcas.get(k) || limpia;
        }
        // Volumen (cm³) derivado cuando el archivo trae las tres dimensiones,
        // igual que el formulario de edición de producto.
        const alto = Number(limpio.alto) || 0;
        const largo = Number(limpio.largo) || 0;
        const ancho = Number(limpio.ancho) || 0;
        if (alto > 0 && largo > 0 && ancho > 0) {
          limpio.metro_cubico = Math.round(alto * largo * ancho * 100) / 100;
        }
        if (ProductosService.cambioDePrecio(limpio, mapaSkuPrecios.get(sku) || null)) {
          limpio.precio_actualizado_at = new Date().toISOString();
        }
        if (id) aActualizar.push({ id, body: limpio, sku });
        else aInsertar.push({ ...limpio, sku });
      }

      if (aInsertar.length > 0) {
        const { data, error } = await this.supabase
          .getClient()
          .from('productos')
          .insert(aInsertar)
          .select();
        if (error) errores.push(`Insert batch ${i}: ${error.message}`);
        else {
          creados += (data || []).length;
          for (const p of data || []) {
            // Creado por esta carga: deshacerlo es borrarlo, por eso no hay
            // "antes" que guardar.
            auditoria.push({ producto_id: p.id, sku: p.sku, accion: 'creado', antes: null, despues: {} });
          }
        }
      }

      for (const { id, body, sku } of aActualizar) {
        const { error } = await this.supabase
          .getClient()
          .from('productos')
          .update(body)
          .eq('id', id);
        if (error) errores.push(`Update id=${id}: ${error.message}`);
        else {
          actualizados += 1;
          // El "antes" se limita a las claves que esta carga escribió: son las
          // únicas que hay que restaurar si se deshace. `previo` puede no traer
          // una clave (columna nueva) — se guarda null y al revertir se vacía.
          const previo = mapaSkuPrecios.get(sku) || {};
          const antes: Record<string, any> = {};
          for (const k of Object.keys(body)) antes[k] = previo[k] ?? null;
          auditoria.push({ producto_id: id, sku, accion: 'actualizado', antes, despues: body });
        }
      }
    }

    const carga = await this.registrarCarga(
      { archivo: meta?.archivo, email: meta?.email, total_filas: rows.length, creados, actualizados, ignorados, errores },
      auditoria,
    );

    return { creados, actualizados, ignorados, errores, carga_id: carga?.id ?? null };
  }

  /* ── Historial de cargas masivas ─────────────────────────────────────────
     Registrar el historial NUNCA debe hacer fallar una importación que ya se
     aplicó: si la migración no está puesta o el insert falla, se avisa por log
     y la carga se reporta igual (solo se pierde la posibilidad de deshacerla).
  */
  private async registrarCarga(
    cab: {
      archivo?: string; email?: string; total_filas: number;
      creados: number; actualizados: number; ignorados: number; errores: string[];
    },
    items: { producto_id: number | null; sku: string; accion: string; antes: any; despues: any }[],
  ) {
    try {
      const client = this.supabase.getClient();
      const { data: carga, error } = await client
        .from('producto_cargas')
        .insert([{
          archivo: cab.archivo || null,
          realizada_por: cab.email || null,
          total_filas: cab.total_filas,
          creados: cab.creados,
          actualizados: cab.actualizados,
          ignorados: cab.ignorados,
          errores: cab.errores,
        }])
        .select()
        .single();
      if (error) throw new Error(error.message);

      // El detalle puede ser de miles de filas: se inserta por lotes.
      const BATCH = 500;
      for (let i = 0; i < items.length; i += BATCH) {
        const slice = items.slice(i, i + BATCH).map((it) => ({ ...it, carga_id: carga.id }));
        const { error: errItems } = await client.from('producto_carga_items').insert(slice);
        if (errItems) throw new Error(errItems.message);
      }
      return carga;
    } catch (e: any) {
      this.logger.warn(
        `No se pudo registrar el historial de la carga masiva (¿falta la migración 20260809_producto_cargas.sql?): ${e?.message || e}`,
      );
      return null;
    }
  }

  async listarCargas() {
    const { data, error } = await this.supabase
      .getClient()
      .from('producto_cargas')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) throw new BadRequestException(this.faltaMigracion(error));
    return data || [];
  }

  async detalleCarga(id: number) {
    const client = this.supabase.getClient();
    const { data: carga, error } = await client
      .from('producto_cargas').select('*').eq('id', id).single();
    if (error) throw new BadRequestException(this.faltaMigracion(error));
    const { data: items, error: errItems } = await client
      .from('producto_carga_items')
      .select('*')
      .eq('carga_id', id)
      .order('id', { ascending: true })
      .limit(2000);
    if (errItems) throw new BadRequestException(this.faltaMigracion(errItems));
    return { ...carga, items: items || [] };
  }

  /**
   * Devuelve el catálogo al estado ANTERIOR a la carga `id`.
   *
   * Deshace esa carga y todas las posteriores, de la más nueva a la más
   * antigua. El orden importa: si dos cargas tocaron el mismo producto,
   * revertir de atrás hacia adelante deja el valor original; hacerlo al revés
   * dejaría el valor intermedio.
   */
  async revertirHasta(id: number, email: string) {
    const client = this.supabase.getClient();

    const { data: objetivo, error: errObj } = await client
      .from('producto_cargas').select('*').eq('id', id).single();
    if (errObj) throw new BadRequestException(this.faltaMigracion(errObj));
    if (objetivo.estado === 'revertida') {
      throw new BadRequestException('Esta carga ya fue revertida.');
    }

    // Todas las cargas aplicadas desde la elegida en adelante, más nuevas
    // primero.
    const { data: cargas, error: errCargas } = await client
      .from('producto_cargas')
      .select('*')
      .gte('id', id)
      .eq('estado', 'aplicada')
      .order('id', { ascending: false });
    if (errCargas) throw new BadRequestException(this.faltaMigracion(errCargas));

    let productosBorrados = 0;
    let productosRestaurados = 0;
    const errores: string[] = [];

    for (const carga of cargas || []) {
      const { data: items, error: errItems } = await client
        .from('producto_carga_items').select('*').eq('carga_id', carga.id);
      if (errItems) { errores.push(`Carga ${carga.id}: ${errItems.message}`); continue; }

      for (const it of items || []) {
        if (!it.producto_id) continue;
        if (it.accion === 'creado') {
          // Lo creó esta carga: se borra. Si ya no existe, el delete no hace
          // nada y tampoco es un error.
          const { error } = await client.from('productos').delete().eq('id', it.producto_id);
          if (error) errores.push(`No se pudo borrar el producto ${it.sku}: ${error.message}`);
          else productosBorrados += 1;
        } else {
          const antes = it.antes || {};
          if (Object.keys(antes).length === 0) continue;
          const { error } = await client.from('productos').update(antes).eq('id', it.producto_id);
          if (error) errores.push(`No se pudo restaurar el producto ${it.sku}: ${error.message}`);
          else productosRestaurados += 1;
        }
      }

      const { error: errEstado } = await client
        .from('producto_cargas')
        .update({
          estado: 'revertida',
          revertida_por: email || null,
          revertida_at: new Date().toISOString(),
          revertida_junto_a: id,
        })
        .eq('id', carga.id);
      if (errEstado) errores.push(`Carga ${carga.id}: ${errEstado.message}`);
    }

    return {
      revertidas: (cargas || []).length,
      productos_borrados: productosBorrados,
      productos_restaurados: productosRestaurados,
      errores,
    };
  }

  private faltaMigracion(error: any) {
    const msg = String(error?.message || '');
    return /producto_carga|does not exist|relation/i.test(msg)
      ? 'Falta aplicar la migración 20260809_producto_cargas.sql en Supabase.'
      : msg;
  }

  async update(id: number, body: Record<string, any>) {
    if (body && body.marca != null) {
      body = { ...body, marca: await this.marcaCanonica(body.marca) };
    }
    // Estampar la fecha de actualización de precio SOLO si algún precio cambió
    // de verdad (editar otros campos del producto no la mueve).
    if (body && ProductosService.CAMPOS_PRECIO.some((k) => body[k] !== undefined && body[k] !== null)) {
      const { data: actual } = await this.supabase
        .getClient()
        .from('productos')
        .select(ProductosService.CAMPOS_PRECIO.join(', '))
        .eq('id', id)
        .maybeSingle();
      if (ProductosService.cambioDePrecio(body, actual as any)) {
        body = { ...body, precio_actualizado_at: new Date().toISOString() };
      }
    }
    const { data, error } = await this.supabase
      .getClient()
      .from('productos')
      .update(body)
      .eq('id', id)
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async remove(id: number) {
    const { error } = await this.supabase
      .getClient()
      .from('productos')
      .delete()
      .eq('id', id);
    if (error) throw new BadRequestException(error.message);
    return { deleted: true };
  }

  async uploadImage(file: Express.Multer.File, sku: string) {
    const ext = file.originalname.split('.').pop()?.toLowerCase() || 'jpg';
    const safeSku = (sku || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9_-]/g, '_');
    const fileName = safeSku
      ? `productos/${safeSku}.${ext}`
      : `productos/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

    const { error } = await this.supabase
      .getClient()
      .storage.from('product-images')
      .upload(fileName, file.buffer, {
        contentType: file.mimetype || 'image/jpeg',
        upsert: true,
      });
    if (error) throw new BadRequestException(error.message);
    return { path: fileName };
  }

  async getCampaignPrices() {
    const hoy = new Date().toISOString().slice(0, 10);
    const { data, error } = await this.supabase
      .getClient()
      .from('product_campaign_items')
      .select('sku, precio_campania, product_campaigns!inner(start_date, end_date, created_at)')
      .lte('product_campaigns.start_date', hoy)
      .gte('product_campaigns.end_date', hoy)
      .order('created_at', { foreignTable: 'product_campaigns', ascending: false });
    if (error) throw new BadRequestException(error.message);
    return data;
  }
}
