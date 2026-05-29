import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

@Injectable()
export class LicitacionesService {
  constructor(private supabase: SupabaseService) {}

  async findAll(filters?: { estado?: string; creado_por?: string; id_licitacion?: string; exclude_id?: string }) {
    let query = this.supabase.getClient()
      .from('licitaciones')
      .select('*')
      .range(0, 20000)
      .order('id', { ascending: false });

    if (filters?.estado) query = query.eq('estado', filters.estado);
    if (filters?.creado_por) query = query.eq('creado_por', filters.creado_por);
    if (filters?.id_licitacion) query = query.eq('id_licitacion', filters.id_licitacion);
    if (filters?.exclude_id) query = query.neq('id', Number(filters.exclude_id));

    const { data, error } = await query;
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  // Detecta una columna inexistente a partir del error de Postgres
  // (código 42703 / "column ... does not exist"). Devuelve el nombre de la
  // columna o null si el error es de otro tipo.
  private columnaFaltante(error: any): string | null {
    const msg = [error?.message, error?.details, error?.hint]
      .filter(Boolean)
      .join(' ');
    if (error?.code !== '42703' && !/does not exist/i.test(msg)) return null;
    const m = msg.match(/column\s+["']?([\w.]+)["']?\s+does not exist/i);
    if (!m) return null;
    const partes = m[1].split('.');
    return partes[partes.length - 1];
  }

  async findAllWithFields(fields: string) {
    const ejecutar = (sel: string) =>
      this.supabase.getClient()
        .from('licitaciones')
        .select(sel)
        .range(0, 20000)
        .order('id', { ascending: false });

    let { data, error } = await ejecutar(fields);

    // Tolerar columnas inexistentes: si el frontend pide una columna que aún
    // no existe (migración sin aplicar), la quitamos del select y reintentamos
    // en lugar de romper toda la pantalla que consume este endpoint.
    const omitidas: string[] = [];
    let intentos = 0;
    while (error && fields && fields !== '*' && intentos < 10) {
      const faltante = this.columnaFaltante(error);
      if (!faltante) break;
      omitidas.push(faltante);
      const restantes = fields
        .split(',')
        .map((f) => f.trim())
        .filter((f) => f && !omitidas.includes(f));
      if (restantes.length === 0) break;
      ({ data, error } = await ejecutar(restantes.join(',')));
      intentos++;
    }

    if (error) throw new BadRequestException(error.message);

    // Reponer las columnas omitidas como null para no romper el frontend.
    if (omitidas.length > 0) {
      return (data || []).map((row: any) => {
        const out: any = { ...row };
        for (const col of omitidas) if (!(col in out)) out[col] = null;
        return out;
      });
    }
    return data;
  }

  async findOne(id: number) {
    const { data, error } = await this.supabase.getClient()
      .from('licitaciones')
      .select('*')
      .eq('id', id)
      .single();
    if (error) throw new NotFoundException('Licitación no encontrada');
    return data;
  }

  async getNextId() {
    // max(id) + 1. Si la tabla está vacía → 1.
    const { data, error } = await this.supabase.getClient()
      .from('licitaciones')
      .select('id')
      .order('id', { ascending: false })
      .limit(1);
    if (error) throw new BadRequestException(error.message);
    const maxId = Array.isArray(data) && data.length > 0 ? Number(data[0].id) || 0 : 0;
    return { next: maxId + 1 };
  }

  async create(body: Record<string, any>) {
    const { data, error } = await this.supabase.getClient()
      .from('licitaciones')
      .insert([body])
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async update(id: number, body: Record<string, any>) {
    const { data, error } = await this.supabase.getClient()
      .from('licitaciones')
      .update(body)
      .eq('id', id)
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async remove(id: number) {
    const { error } = await this.supabase.getClient()
      .from('licitaciones')
      .delete()
      .eq('id', id);
    if (error) throw new BadRequestException(error.message);
    return { deleted: true };
  }

  // Items
  async getItems(licitacionId: number) {
    const { data, error } = await this.supabase.getClient()
      .from('items_licitacion')
      .select('*')
      .eq('licitacion_id', licitacionId)
      .order('orden', { ascending: true });
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async upsertItems(items: any[]) {
    const { data, error } = await this.supabase.getClient()
      .from('items_licitacion')
      .upsert(items)
      .select();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async insertItems(items: any[]) {
    const { data, error } = await this.supabase.getClient()
      .from('items_licitacion')
      .insert(items)
      .select();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async updateItem(itemId: number, body: Record<string, any>) {
    const { data, error } = await this.supabase.getClient()
      .from('items_licitacion')
      .update(body)
      .eq('id', itemId)
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async deleteItem(itemId: number) {
    const { error } = await this.supabase.getClient()
      .from('items_licitacion')
      .delete()
      .eq('id', itemId);
    if (error) throw new BadRequestException(error.message);
    return { deleted: true };
  }

  // Documentos
  async getDocumentos(licitacionId: number) {
    const { data, error } = await this.supabase.getClient()
      .from('licitacion_documentos')
      .select('*')
      .eq('licitacion_id', licitacionId)
      .order('created_at', { ascending: false });
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async getDocumentosByFilter(filter: Record<string, any>, fields?: string) {
    const buildQuery = (selectFields: string) => {
      // range(0, 50000) — sin esto, Supabase trunca a 1000 filas y los
      // documentos viejos "desaparecen" en pantallas que filtran por OC
      // (ej: Listar Cotizaciones, Ventas, Trazabilidad).
      let query = this.supabase.getClient()
        .from('licitacion_documentos')
        .select(selectFields)
        .range(0, 50000);

      for (const [key, value] of Object.entries(filter)) {
        if (key === 'licitacion_ids') {
          query = query.in('licitacion_id', value as number[]);
        } else if (Array.isArray(value)) {
          // Permite { tipo: ['orden_compra', 'factura_boleta'] } → IN
          query = query.in(key, value as any[]);
        } else {
          query = query.eq(key, value);
        }
      }
      return query;
    };

    const { data, error } = await buildQuery(fields || '*');

    // If the query fails due to missing column (e.g. fecha_oc), retry without it
    if (error) {
      const msg = [error.message, (error as any).details, (error as any).hint]
        .filter(Boolean).join(' ').toLowerCase();

      if (fields && msg.includes('fecha_oc')) {
        const fallbackFields = fields
          .split(',')
          .map((f) => f.trim())
          .filter((f) => f !== 'fecha_oc')
          .join(',');

        const { data: fallbackData, error: fallbackError } = await buildQuery(fallbackFields);
        if (fallbackError) throw new BadRequestException(fallbackError.message);
        return (fallbackData || []).map((d: any) => ({ ...d, fecha_oc: null }));
      }

      throw new BadRequestException(error.message);
    }

    return data;
  }

  async createDocumento(body: Record<string, any>) {
    let inserted: any = null;
    const { data, error } = await this.supabase.getClient()
      .from('licitacion_documentos')
      .insert([body])
      .select('id')
      .single();

    if (error) {
      // If it fails due to missing column (fecha_oc / fecha_factura), retry without it
      const msg = [error.message, (error as any).details, (error as any).hint]
        .filter(Boolean).join(' ').toLowerCase();
      const bodyWithout = { ...body };
      let removed = false;
      if (msg.includes('fecha_oc')) { delete bodyWithout.fecha_oc; removed = true; }
      if (msg.includes('fecha_factura')) { delete bodyWithout.fecha_factura; removed = true; }
      if (msg.includes('pagada')) { delete bodyWithout.pagada; removed = true; }
      if (msg.includes('fecha_pago')) { delete bodyWithout.fecha_pago; removed = true; }
      if (msg.includes('forma_pago')) { delete bodyWithout.forma_pago; removed = true; }
      if (msg.includes('empresa_despacho')) { delete bodyWithout.empresa_despacho; removed = true; }
      if (msg.includes('n_seguimiento')) { delete bodyWithout.n_seguimiento; removed = true; }
      if (removed) {
        const { data: d2, error: e2 } = await this.supabase.getClient()
          .from('licitacion_documentos')
          .insert([bodyWithout])
          .select('id')
          .single();
        if (e2) throw new BadRequestException(e2.message);
        inserted = d2;
      } else {
        throw new BadRequestException(error.message);
      }
    } else {
      inserted = data;
    }

    // Hook: aviso de correo pendiente al vendedor. No bloquea la subida.
    try {
      await this.notificarCorreoPendiente(inserted?.id, body);
    } catch (e: any) {
      console.error('[LicitacionesService] notificarCorreoPendiente falló:', e?.message || e);
    }

    return inserted;
  }

  // Crea una notificación para que el vendedor envíe un correo al cliente:
  //  - primera OC de la cotización → correo de agradecimiento
  //  - cualquier guía de despacho  → envío de guía al cliente
  private async notificarCorreoPendiente(docId: number, body: Record<string, any>) {
    const log = (m: string) => console.log(`[correos-hook] ${m}`);
    if (!docId) {
      log('sin docId — no se notifica');
      return;
    }
    const tipo = String(body?.tipo || '');
    const licitacionId = Number(body?.licitacion_id);
    if (!licitacionId) {
      log('sin licitacion_id — no se notifica');
      return;
    }

    let tipoCorreo: 'oc_agradecimiento' | 'guia_despacho_enviar' | null = null;
    if (tipo === 'orden_compra') {
      // Solo la PRIMERA orden de compra de la cotización.
      const { count } = await this.supabase.getClient()
        .from('licitacion_documentos')
        .select('id', { count: 'exact', head: true })
        .eq('licitacion_id', licitacionId)
        .eq('tipo', 'orden_compra');
      if ((count || 0) > 1) {
        log(`OC no es la primera (count=${count}) lic=${licitacionId} — no se notifica`);
        return;
      }
      tipoCorreo = 'oc_agradecimiento';
    } else if (tipo === 'guia_despacho') {
      // Toda guía de despacho dispara el aviso, tenga o no N° de seguimiento.
      tipoCorreo = 'guia_despacho_enviar';
    } else {
      log(`tipo "${tipo}" no dispara correo — no se notifica`);
      return;
    }

    const { data: lic } = await this.supabase.getClient()
      .from('licitaciones')
      .select('id, nombre_entidad, vendedor_correo, creado_por')
      .eq('id', licitacionId)
      .maybeSingle();
    if (!lic) {
      log(`cotización ${licitacionId} no encontrada — no se notifica`);
      return;
    }

    const destinatario = String(lic.vendedor_correo || lic.creado_por || '')
      .trim()
      .toLowerCase();
    if (!destinatario) {
      log(`cotización ${licitacionId} sin vendedor/creado_por — no se notifica`);
      return;
    }

    const numero = String(body?.numero || '').trim();
    const cliente = String(lic.nombre_entidad || 'el cliente').trim();
    const mensaje =
      tipoCorreo === 'oc_agradecimiento'
        ? `Se cargó la primera orden de compra${numero ? ` ${numero}` : ''} de ${cliente}. Envía el correo de agradecimiento.`
        : `Se cargó la guía de despacho${numero ? ` ${numero}` : ''} de ${cliente}. Envía la guía al cliente.`;

    const { error } = await this.supabase.getClient()
      .from('notificaciones')
      .insert([
        {
          user_email: destinatario,
          tipo: tipoCorreo,
          mensaje,
          link: `/detalle/${licitacionId}`,
          metadata: {
            licitacion_id: licitacionId,
            documento_id: docId,
            tipo_correo: tipoCorreo,
            numero,
          },
        },
      ]);
    if (error) {
      console.error('[correos-hook] ERROR insertando notificación:', error.message);
    } else {
      log(`notificación ${tipoCorreo} creada para ${destinatario} (lic=${licitacionId}, doc=${docId})`);
    }
  }

  async updateDocumento(docId: number, body: Record<string, any>) {
    const { data, error } = await this.supabase.getClient()
      .from('licitacion_documentos')
      .update(body)
      .eq('id', docId)
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async deleteDocumento(docId: number) {
    const { error } = await this.supabase.getClient()
      .from('licitacion_documentos')
      .delete()
      .eq('id', docId);
    if (error) throw new BadRequestException(error.message);
    return { deleted: true };
  }

  // Storage
  async uploadDocFile(bucket: string, path: string, file: Buffer, contentType: string) {
    const { error } = await this.supabase.getClient()
      .storage.from(bucket)
      .upload(path, file, { contentType, upsert: true });
    if (error) throw new BadRequestException(error.message);
    return { path };
  }

  async getSignedUrl(bucket: string, path: string, expiresIn = 3600) {
    const { data, error } = await this.supabase.getClient()
      .storage.from(bucket)
      .createSignedUrl(path, expiresIn);
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async removeFile(bucket: string, path: string) {
    const { error } = await this.supabase.getClient()
      .storage.from(bucket)
      .remove([path]);
    if (error) throw new BadRequestException(error.message);
    return { removed: true };
  }
}
