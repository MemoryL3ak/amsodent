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

  async create(body: Record<string, any>) {
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
