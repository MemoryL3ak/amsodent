import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

@Injectable()
export class ProductosService {
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
  async bulkUpsert(rows: Record<string, any>[]) {
    if (!Array.isArray(rows) || rows.length === 0) {
      return { creados: 0, actualizados: 0, ignorados: 0, errores: [] as string[] };
    }

    const validRows = rows.filter((r) => r && typeof r.sku === 'string' && r.sku.trim());
    const ignorados = rows.length - validRows.length;

    if (validRows.length === 0) {
      return { creados: 0, actualizados: 0, ignorados, errores: ['Ninguna fila trae SKU válido'] };
    }

    const skus = Array.from(new Set(validRows.map((r) => r.sku.trim())));

    // Productos existentes para clasificar creados vs actualizados.
    const { data: existentes, error: errFetch } = await this.supabase
      .getClient()
      .from('productos')
      .select('id, sku')
      .in('sku', skus);
    if (errFetch) throw new BadRequestException(errFetch.message);

    const mapaSkuId = new Map<string, number>();
    (existentes || []).forEach((p: any) => mapaSkuId.set(p.sku, p.id));

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
      const aActualizar: { id: number; body: Record<string, any> }[] = [];

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
        if (id) aActualizar.push({ id, body: limpio });
        else aInsertar.push({ ...limpio, sku });
      }

      if (aInsertar.length > 0) {
        const { data, error } = await this.supabase
          .getClient()
          .from('productos')
          .insert(aInsertar)
          .select();
        if (error) errores.push(`Insert batch ${i}: ${error.message}`);
        else creados += (data || []).length;
      }

      for (const { id, body } of aActualizar) {
        const { error } = await this.supabase
          .getClient()
          .from('productos')
          .update(body)
          .eq('id', id);
        if (error) errores.push(`Update id=${id}: ${error.message}`);
        else actualizados += 1;
      }
    }

    return { creados, actualizados, ignorados, errores };
  }

  async update(id: number, body: Record<string, any>) {
    if (body && body.marca != null) {
      body = { ...body, marca: await this.marcaCanonica(body.marca) };
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
