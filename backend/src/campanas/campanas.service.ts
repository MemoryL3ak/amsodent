import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

@Injectable()
export class CampanasService {
  constructor(private supabase: SupabaseService) {}

  async findAll() {
    const client = this.supabase.getClient();

    const { data: campanas, error: e1 } = await client
      .from('product_campaigns')
      .select('*') // incluye lista_precios cuando la migración 20260904 está aplicada
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
      .select('*')
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
        // Lista de precios asociada (1..3). Requiere la migración
        // 20260904_campanas_lista_precios.sql; default 1 (comportamiento histórico).
        lista_precios: [1, 2, 3].includes(Number(body.lista_precios)) ? Number(body.lista_precios) : 1,
        created_by: userId,
      }])
      .select('id')
      .single();
    let campanaFila: any = campana;
    if (e1) {
      // Migración aún no aplicada: se crea sin la columna (comportamiento histórico).
      if (/lista_precios/i.test(e1.message)) {
        const { data: c2, error: e1b } = await client
          .from('product_campaigns')
          .insert([{ nombre: body.nombre, start_date: body.start_date, end_date: body.end_date, created_by: userId }])
          .select('id')
          .single();
        if (e1b) throw new BadRequestException(e1b.message);
        campanaFila = c2;
      } else {
        throw new BadRequestException(e1.message);
      }
    }
    if (!campanaFila?.id) throw new BadRequestException('No se pudo crear la campaña.');

    if (body.items?.length > 0) {
      const payloadItems = body.items.map((it: any) => ({
        campaign_id: campanaFila.id,
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

    return campanaFila;
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
