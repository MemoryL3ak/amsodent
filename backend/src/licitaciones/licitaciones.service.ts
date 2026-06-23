import { Injectable, BadRequestException, NotFoundException, Logger } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { MailingsService } from '../mailings/mailings.service';

@Injectable()
export class LicitacionesService {
  private readonly logger = new Logger('Licitaciones');
  // Aprobador "dueño" del flujo: si él mismo aprueba, no se le notifica.
  private static readonly JEREMIAS = 'jer.consorcio@gmail.com';

  constructor(
    private supabase: SupabaseService,
    private mailings: MailingsService,
  ) {}

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
    if (!error) return data;

    // Tolerar columnas aún no migradas (ej. fecha_publicacion_resultados):
    // reintentamos quitando la columna que falta para no romper la creación.
    const msg = [error.message, (error as any).details, (error as any).hint]
      .filter(Boolean).join(' ').toLowerCase();
    const bodyWithout = { ...body };
    let removed = false;
    if (msg.includes('fecha_publicacion_resultados')) { delete bodyWithout.fecha_publicacion_resultados; removed = true; }
    if (removed) {
      const { data: d2, error: e2 } = await this.supabase.getClient()
        .from('licitaciones')
        .insert([bodyWithout])
        .select()
        .single();
      if (e2) throw new BadRequestException(e2.message);
      return d2;
    }
    throw new BadRequestException(error.message);
  }

  async update(id: number, body: Record<string, any>, aprobadorEmail?: string) {
    const client = this.supabase.getClient();

    // Bandera (no es columna): notificar al cliente que su cotización se editó.
    const notificarCliente = body?.notificar_cliente_cotizacion === true;
    if ('notificar_cliente_cotizacion' in body) delete body.notificar_cliente_cotizacion;

    // Estado previo para detectar una aprobación (Pendiente Aprobación → otro).
    let estadoPrevio: string | null = null;
    try {
      const { data: prev } = await client
        .from('licitaciones')
        .select('estado')
        .eq('id', id)
        .single();
      estadoPrevio = prev?.estado || null;
    } catch { /* no bloquear el update */ }

    const ejecutar = (payload: Record<string, any>) =>
      client.from('licitaciones').update(payload).eq('id', id).select().single();

    // Tolerar columnas aún no migradas (motivo_descarte, comentario_descarte, etc.):
    // si la columna no existe, se quita del payload y se reintenta.
    const payload = { ...body };
    let res = await ejecutar(payload);
    let intentos = 0;
    while (res.error && intentos < 6) {
      const msg = [res.error.message, (res.error as any).details, (res.error as any).hint]
        .filter(Boolean)
        .join(' ');
      const falt = this.columnaFaltante(res.error);
      const m2 = msg.match(/'([\w.]+)' column/i) || msg.match(/column\s+["']?([\w.]+)["']?/i);
      const col = falt || (m2 ? m2[1].split('.').pop() : null);
      if (!col || !(col in payload)) break;
      delete payload[col];
      res = await ejecutar(payload);
      intentos++;
    }
    const { data, error } = res;
    if (error) throw new BadRequestException(error.message);

    // Punto 18: si un usuario distinto a Jeremías aprueba (la cotización deja de
    // estar "Pendiente Aprobación"), se le notifica por correo con el detalle.
    try {
      const aprobada =
        estadoPrevio === 'Pendiente Aprobación' &&
        body?.estado &&
        body.estado !== 'Pendiente Aprobación';
      if (aprobada) await this.notificarAprobacion(data, aprobadorEmail);
    } catch (e: any) {
      this.logger.warn(`no se pudo notificar aprobación: ${e?.message || e}`);
    }

    // Punto 11: si la cotización proviene de una solicitud del cliente y se
    // editó desde la plataforma, avisamos al cliente (hilo + correo).
    if (notificarCliente) {
      try {
        await this.notificarClienteCotizacion(id, aprobadorEmail);
      } catch (e: any) {
        this.logger.warn(`no se pudo notificar al cliente: ${e?.message || e}`);
      }
    }
    return data;
  }

  // Avisa al cliente que la cotización vinculada a su solicitud fue modificada:
  // deja un mensaje en el hilo (lo ve en su portal) y le envía un correo.
  private async notificarClienteCotizacion(licId: number, autorEmail?: string) {
    const client = this.supabase.getClient();
    const { data: sol } = await client
      .from('stock_solicitudes_cotizacion')
      .select('id, rut, razon_social, contacto_email, licitacion_id')
      .eq('licitacion_id', licId)
      .maybeSingle();
    if (!sol) return; // la cotización no proviene de una solicitud del cliente

    const texto =
      'Hemos actualizado la cotización asociada a su solicitud. Ingrese a su portal para ver el detalle y, si lo necesita, solicitar cambios.';

    // Mensaje en el hilo bidireccional (queda sin leer para el cliente).
    await client.from('stock_cotizacion_mensajes').insert({
      solicitud_id: sol.id,
      autor_tipo: 'equipo',
      autor_email: autorEmail || null,
      autor_nombre: 'Equipo Amsodent',
      mensaje: texto,
      leido_cliente: false,
      leido_equipo: true,
    });

    // Correo al contacto de la solicitud.
    const para = String(sol.contacto_email || '').trim().toLowerCase();
    if (para) {
      const cliente = sol.razon_social || 'cliente';
      await this.mailings.enviarUno({
        para,
        asunto: 'Amsodent · Actualización de su cotización',
        cuerpoHtml:
          `<p>Estimados ${cliente},</p>` +
          `<p>${texto}</p>` +
          `<p>Saludos,<br/>Equipo Amsodent</p>`,
      });
    }
  }

  private async notificarAprobacion(lic: any, aprobadorEmail?: string) {
    const client = this.supabase.getClient();
    const aprob = String(aprobadorEmail || '').trim().toLowerCase();
    // Si aprueba el propio Jeremías (o no hay aprobador identificado), no se notifica.
    if (!aprob || aprob === LicitacionesService.JEREMIAS) return;

    let aprobadorNombre = aprobadorEmail || 'Usuario';
    try {
      const { data } = await client
        .from('profiles')
        .select('nombre')
        .ilike('email', aprob)
        .maybeSingle();
      if (data?.nombre) aprobadorNombre = data.nombre;
    } catch { /* sin nombre */ }

    const nombreCot = lic.nombre || lic.nombre_entidad || `#${lic.id}`;
    const idCot = lic.id_licitacion || lic.id;
    const monto = Number(lic.total_con_iva || lic.monto || 0);
    const montoTxt = `$${monto.toLocaleString('es-CL')}`;
    const vendedor = lic.vendedor_nombre || lic.creado_por || '—';

    const asunto = `✅ Cotización aprobada por ${aprobadorNombre}: ${nombreCot}`;
    const html =
      `<p>La cotización <strong>${nombreCot}</strong> (ID ${idCot}) fue <strong>aprobada</strong> por ` +
      `<strong>${aprobadorNombre}</strong> (${aprobadorEmail}).</p>` +
      `<ul>` +
      `<li>Entidad / cliente: ${lic.nombre_entidad || '—'}</li>` +
      `<li>Tipo de compra: ${lic.tipo_compra || '—'}</li>` +
      `<li>Monto total (con IVA): ${montoTxt}</li>` +
      `<li>Vendedor: ${vendedor}</li>` +
      `<li>Estado actual: ${lic.estado || '—'}</li>` +
      `</ul>`;
    const mensaje = `${aprobadorNombre} aprobó la cotización "${nombreCot}" (ID ${idCot}).`;

    try {
      await client.from('notificaciones').insert([
        {
          user_email: LicitacionesService.JEREMIAS,
          tipo: 'cotizacion_aprobada',
          mensaje,
          link: `/detalle/${lic.id}`,
          metadata: { licitacion_id: lic.id, aprobador_email: aprobadorEmail, aprobador_nombre: aprobadorNombre },
        },
      ]);
    } catch (e: any) {
      this.logger.warn(`no se pudo crear notificación de aprobación: ${e?.message || e}`);
    }
    await this.mailings.enviarUno({ para: LicitacionesService.JEREMIAS, asunto, cuerpoHtml: html });
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

  // Items de varias licitaciones a la vez (para agregaciones tipo "ventas por
  // categoría" en el panel). Trocea licitacion_ids para no desbordar headers.
  async getItemsByFilter(licitacionIds: number[], fields?: string) {
    const ids = Array.isArray(licitacionIds) ? licitacionIds : [];
    if (!ids.length) return [];
    const CHUNK = 150;
    const chunks: number[][] = [];
    for (let i = 0; i < ids.length; i += CHUNK) chunks.push(ids.slice(i, i + CHUNK));

    const ejecutar = (sel: string) =>
      Promise.all(
        chunks.map((chunk) =>
          this.supabase.getClient()
            .from('items_licitacion')
            .select(sel)
            .in('licitacion_id', chunk)
            .range(0, 50000),
        ),
      );

    let sel = fields || '*';
    let resultados = await ejecutar(sel);

    // Tolerar columnas inexistentes (p. ej. costo/cantidad sin migrar): se quitan
    // del select y se reintenta, en vez de romper la consulta completa.
    const omitidas: string[] = [];
    let intentos = 0;
    while (fields && sel !== '*' && intentos < 10) {
      const err = resultados.find((r) => r.error)?.error;
      if (!err) break;
      const faltante = this.columnaFaltante(err);
      if (!faltante) break;
      omitidas.push(faltante);
      const restantes = fields
        .split(',')
        .map((f) => f.trim())
        .filter((f) => f && !omitidas.includes(f));
      if (restantes.length === 0) break;
      sel = restantes.join(',');
      resultados = await ejecutar(sel);
      intentos++;
    }

    const merged: any[] = [];
    for (const { data, error } of resultados) {
      if (error) throw new BadRequestException(error.message);
      if (data) merged.push(...(data as any[]));
    }

    // Reponer las columnas omitidas como null para no romper el frontend.
    if (omitidas.length > 0) {
      return merged.map((row: any) => {
        const out: any = { ...row };
        for (const col of omitidas) if (!(col in out)) out[col] = null;
        return out;
      });
    }
    return merged;
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
    // Troceamos licitacion_ids en lotes: un IN(...) con cientos de IDs genera
    // una URL/headers gigante que desborda el límite de undici
    // (UND_ERR_HEADERS_OVERFLOW → "TypeError: fetch failed"). Con ~2000+
    // licitaciones la consulta sin trocear falla por completo.
    const CHUNK = 150;
    const ids = Array.isArray(filter?.licitacion_ids)
      ? (filter.licitacion_ids as any[])
      : null;

    const buildQuery = (selectFields: string, idsChunk: any[] | null) => {
      // range(0, 50000) — sin esto, Supabase trunca a 1000 filas y los
      // documentos viejos "desaparecen" en pantallas que filtran por OC
      // (ej: Listar Cotizaciones, Ventas, Trazabilidad).
      let query = this.supabase.getClient()
        .from('licitacion_documentos')
        .select(selectFields)
        .range(0, 50000);

      for (const [key, value] of Object.entries(filter)) {
        if (key === 'licitacion_ids') {
          query = query.in('licitacion_id', (idsChunk ?? value) as any[]);
        } else if (Array.isArray(value)) {
          // Permite { tipo: ['orden_compra', 'factura_boleta'] } → IN
          query = query.in(key, value as any[]);
        } else {
          query = query.eq(key, value);
        }
      }
      return query;
    };

    // Ejecuta la consulta troceando licitacion_ids cuando hay muchos IDs.
    // Los lotes corren en paralelo para no penalizar el tiempo de respuesta.
    const runAll = async (selectFields: string) => {
      if (!ids || ids.length <= CHUNK) {
        return await buildQuery(selectFields, ids);
      }
      const chunks: any[][] = [];
      for (let i = 0; i < ids.length; i += CHUNK) chunks.push(ids.slice(i, i + CHUNK));
      const results = await Promise.all(chunks.map((c) => buildQuery(selectFields, c)));
      const merged: any[] = [];
      for (const { data, error } of results) {
        if (error) return { data: null as any, error };
        if (data) merged.push(...(data as any[]));
      }
      return { data: merged, error: null as any };
    };

    const { data, error } = await runAll(fields || '*');

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

        const { data: fallbackData, error: fallbackError } = await runAll(fallbackFields);
        if (fallbackError) throw new BadRequestException(fallbackError.message);
        return (fallbackData || []).map((d: any) => ({ ...d, fecha_oc: null }));
      }

      throw new BadRequestException(error.message);
    }

    return data;
  }

  async createDocumento(body: Record<string, any>) {
    let inserted: any = null;

    // Despacho interno → correlativo automático AMSO0000001 (cuando no se
    // ingresó un N° de seguimiento manual). Aplica a guía de despacho (pública)
    // e información de despacho (cliente particular).
    if (
      (body.tipo === 'guia_despacho' || body.tipo === 'info_despacho') &&
      String(body.empresa_despacho || '').trim().toLowerCase() === 'despacho interno' &&
      !String(body.n_seguimiento || '').trim()
    ) {
      try {
        const { data: corr, error: corrErr } = await this.supabase.getClient()
          .rpc('siguiente_correlativo_despacho');
        if (!corrErr && corr) body.n_seguimiento = corr;
      } catch {
        // si falla la secuencia, el documento se guarda sin correlativo
      }
    }

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
      if (msg.includes('url')) { delete bodyWithout.url; removed = true; }
      if (msg.includes('guias_ids')) { delete bodyWithout.guias_ids; removed = true; }
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

    let tipoCorreo:
      | 'oc_agradecimiento'
      | 'guia_despacho_enviar'
      | 'info_despacho_agradecimiento'
      | null = null;
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
    } else if (tipo === 'info_despacho') {
      // Cliente particular: al cargar la info de despacho, agradecimiento con
      // los datos del despacho.
      tipoCorreo = 'info_despacho_agradecimiento';
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
        : tipoCorreo === 'info_despacho_agradecimiento'
          ? `Se cargó la información de despacho de ${cliente}. Envía el correo de agradecimiento al cliente.`
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
    const intentar = (payload: Record<string, any>) =>
      this.supabase.getClient()
        .from('licitacion_documentos')
        .update(payload)
        .eq('id', docId)
        .select()
        .single();

    let { data, error } = await intentar(body);

    // Si falla por una columna opcional aún no migrada (dias_atraso_pago,
    // columnas de factoring), la quitamos del payload y reintentamos.
    if (error) {
      const msg = [error.message, (error as any).details, (error as any).hint]
        .filter(Boolean).join(' ').toLowerCase();
      const opcionales = [
        'dias_atraso_pago',
        'factoring_empresa',
        'factoring_comision_pct',
        'factoring_vencimiento',
      ];
      const aQuitar = opcionales.filter((c) => msg.includes(c));
      if (aQuitar.length) {
        const limpio = { ...body };
        aQuitar.forEach((c) => delete limpio[c]);
        ({ data, error } = await intentar(limpio));
      }
    }

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
