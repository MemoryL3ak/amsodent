import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

@Injectable()
export class CampanasService {
  constructor(private supabase: SupabaseService) {}

  async findAll() {
    const client = this.supabase.getClient();

    const { data: campanas, error: e1 } = await client
      .from('product_campaigns')
      .select('id,nombre,start_date,end_date,created_at,created_by')
      .order('created_at', { ascending: false });
    if (e1) throw new BadRequestException(e1.message);

    const ids = (campanas || []).map((x) => x.id);
    let countsMap = new Map<number, number>();
    if (ids.length > 0) {
      const { data: items, error: e2 } = await client
        .from('product_campaign_items')
        .select('campaign_id')
        .in('campaign_id', ids);
      if (e2) throw new BadRequestException(e2.message);
      (items || []).forEach((it) => {
        countsMap.set(it.campaign_id, (countsMap.get(it.campaign_id) || 0) + 1);
      });
    }

    const creatorIds = (campanas || []).map((x) => x.created_by).filter(Boolean);
    let creatorsMap = new Map<string, any>();
    if (creatorIds.length > 0) {
      const uniqueIds = [...new Set(creatorIds)];
      const { data: profiles } = await client
        .from('profiles')
        .select('id,nombre,email')
        .in('id', uniqueIds);
      (profiles || []).forEach((p) => creatorsMap.set(p.id, p));
    }

    return (campanas || []).map((x) => {
      const p = x.created_by ? creatorsMap.get(x.created_by) : null;
      return {
        ...x,
        items_count: countsMap.get(x.id) || 0,
        creador_nombre: p?.nombre || p?.email || '—',
      };
    });
  }

  async findOne(id: number) {
    const client = this.supabase.getClient();

    const { data: campana, error: e1 } = await client
      .from('product_campaigns')
      .select('id,nombre,start_date,end_date')
      .eq('id', id)
      .single();
    if (e1) throw new NotFoundException('Campaña no encontrada');

    const { data: items, error: e2 } = await client
      .from('product_campaign_items')
      .select('id,campaign_id,sku,producto,precio_unitario,precio_campania')
      .eq('campaign_id', id)
      .order('created_at', { ascending: true });
    if (e2) throw new BadRequestException(e2.message);

    return { ...campana, items: items || [] };
  }

  async create(body: any, userId: string | null) {
    const client = this.supabase.getClient();

    const { data: campana, error: e1 } = await client
      .from('product_campaigns')
      .insert([{
        nombre: body.nombre,
        start_date: body.start_date,
        end_date: body.end_date,
        created_by: userId,
      }])
      .select('id')
      .single();
    if (e1) throw new BadRequestException(e1.message);

    if (body.items?.length > 0) {
      const payloadItems = body.items.map((it: any) => ({
        campaign_id: campana.id,
        sku: String(it.sku),
        producto: String(it.producto || ''),
        precio_unitario: Number(it.precio_unitario || 0),
        precio_campania: Number(it.precio_campania || 0),
      }));

      const { error: e2 } = await client
        .from('product_campaign_items')
        .insert(payloadItems);
      if (e2) throw new BadRequestException(e2.message);
    }

    return campana;
  }

  async update(id: number, body: any) {
    const client = this.supabase.getClient();

    const { error: e1 } = await client
      .from('product_campaigns')
      .update({
        nombre: body.nombre,
        start_date: body.start_date,
        end_date: body.end_date,
      })
      .eq('id', id);
    if (e1) throw new BadRequestException(e1.message);

    if (body.items) {
      for (const it of body.items) {
        const payload = {
          campaign_id: id,
          sku: String(it.sku),
          producto: String(it.producto || ''),
          precio_unitario: Number(it.precio_unitario || 0),
          precio_campania: Number(it.precio_campania || 0),
        };

        if (it.id_item) {
          const { error } = await client
            .from('product_campaign_items')
            .update(payload)
            .eq('id', it.id_item);
          if (error) throw new BadRequestException(error.message);
        } else {
          const { error } = await client
            .from('product_campaign_items')
            .insert([payload]);
          if (error) throw new BadRequestException(error.message);
        }
      }
    }

    return { updated: true };
  }

  async deleteItem(itemId: number) {
    const { error } = await this.supabase
      .getClient()
      .from('product_campaign_items')
      .delete()
      .eq('id', itemId);
    if (error) throw new BadRequestException(error.message);
    return { deleted: true };
  }
}
