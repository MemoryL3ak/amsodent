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
