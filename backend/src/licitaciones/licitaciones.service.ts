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

  /* ===========================================================
     LICITACIONES DISPONIBLES (listado para tomar/cargar)
  =========================================================== */
  async listarDisponibles() {
    const { data, error } = await this.supabase.getClient()
      .from('licitaciones_disponibles')
      .select('*')
      .order('cargada', { ascending: true })
      .order('created_at', { ascending: false });
    if (error) throw new BadRequestException(error.message);
    return data || [];
  }

  // Carga masiva desde xlsx. Inserta solo las que no existan (dedup por
  // id_licitacion, case-insensitive). Devuelve cuántas se insertaron / omitieron.
  async bulkDisponibles(rows: { id_licitacion?: string; nombre?: string }[], subidaPor: string) {
    const vistos = new Set<string>();
    const limpias: { id_licitacion: string; nombre: string }[] = [];
    for (const r of rows || []) {
      const idl = String(r?.id_licitacion || '').trim();
      if (!idl) continue;
      const key = idl.toLowerCase();
      if (vistos.has(key)) continue;
      vistos.add(key);
      limpias.push({ id_licitacion: idl, nombre: String(r?.nombre || '').trim() });
    }
    if (!limpias.length) return { insertados: 0, duplicados: 0, total: 0 };

    const { data: existentes, error: errSel } = await this.supabase.getClient()
      .from('licitaciones_disponibles')
      .select('id_licitacion');
    if (errSel) throw new BadRequestException(errSel.message);
    const setExist = new Set((existentes || []).map((e: any) => String(e.id_licitacion || '').trim().toLowerCase()));

    const nuevas = limpias.filter((l) => !setExist.has(l.id_licitacion.toLowerCase()));
    const duplicados = limpias.length - nuevas.length;
    if (nuevas.length) {
      const filas = nuevas.map((n) => ({ ...n, subida_por: subidaPor }));
      const { error } = await this.supabase.getClient()
        .from('licitaciones_disponibles')
        .insert(filas);
      if (error) throw new BadRequestException(error.message);
    }
    return { insertados: nuevas.length, duplicados, total: limpias.length };
  }

  async marcarDisponibleCargada(id: number, cargadaPor: string) {
    const { data, error } = await this.supabase.getClient()
      .from('licitaciones_disponibles')
      .update({ cargada: true, cargada_por: cargadaPor, cargada_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async desmarcarDisponible(id: number) {
    const { data, error } = await this.supabase.getClient()
      .from('licitaciones_disponibles')
      .update({ cargada: false, cargada_por: null, cargada_at: null })
      .eq('id', id)
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async eliminarDisponible(id: number) {
    const { error } = await this.supabase.getClient()
      .from('licitaciones_disponibles')
      .delete()
      .eq('id', id);
    if (error) throw new BadRequestException(error.message);
    return { deleted: true };
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

  // ── Bloqueo por mora (cobranza) ─────────────────────────────────────────
  // Umbral de días de atraso a partir del cual no se puede cotizar.
  private umbralMora(tipoCliente?: string): number {
    return (tipoCliente || '').toLowerCase().includes('particular') ? 60 : 120;
  }

  private plazoDeCondicion(cond?: string): number {
    const c = (cond || '').toString().toLowerCase();
    const m = c.match(/(\d+)/);
    if (m) return Number(m[1]);
    if (c.includes('contado')) return 0;
    return 30;
  }

  private diasDesdeFecha(fechaIso?: string): number | null {
    if (!fechaIso) return null;
    const f = new Date(`${String(fechaIso).slice(0, 10)}T00:00:00`);
    if (Number.isNaN(f.getTime())) return null;
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    return Math.floor((hoy.getTime() - f.getTime()) / (1000 * 60 * 60 * 24));
  }

  // Mora (días de atraso máximo + monto vencido) por RUT. Recorre las
  // cotizaciones adjudicadas de cada rut y sus facturas NO pagadas.
  async moraPorRuts(ruts: string[]): Promise<Record<string, { diasAtrasoMax: number; montoVencido: number; facturasVencidas: number }>> {
    const limpios = Array.from(new Set((ruts || []).map((r) => String(r || '').trim()).filter(Boolean)));
    const out: Record<string, { diasAtrasoMax: number; montoVencido: number; facturasVencidas: number }> = {};
    limpios.forEach((r) => { out[r] = { diasAtrasoMax: 0, montoVencido: 0, facturasVencidas: 0 }; });
    if (!limpios.length) return out;

    // 1) Cotizaciones adjudicadas de esos ruts (en chunks para no desbordar).
    const condById: Record<number, string> = {};
    const rutById: Record<number, string> = {};
    const ids: number[] = [];
    const CHUNK = 100;
    for (let i = 0; i < limpios.length; i += CHUNK) {
      const grupo = limpios.slice(i, i + CHUNK);
      const { data: lics } = await this.supabase.getClient()
        .from('licitaciones')
        .select('id, rut_entidad, condicion_venta, estado')
        .in('rut_entidad', grupo)
        .range(0, 20000);
      (lics || []).forEach((l: any) => {
        if (String(l.estado) !== 'Adjudicada') return;
        ids.push(l.id);
        condById[l.id] = l.condicion_venta;
        rutById[l.id] = String(l.rut_entidad || '').trim();
      });
    }
    if (!ids.length) return out;

    // 2) Facturas no pagadas de esas cotizaciones.
    const docs = await this.getDocumentosByFilter(
      { licitacion_ids: ids, tipo: ['factura', 'factura_boleta'] },
      'licitacion_id,fecha_factura,pagada,monto',
    );
    (docs || []).forEach((d: any) => {
      if (d.pagada) return;
      const rut = rutById[d.licitacion_id];
      if (!rut || !out[rut]) return;
      const dias = this.diasDesdeFecha(d.fecha_factura);
      if (dias == null) return;
      const atraso = dias - this.plazoDeCondicion(condById[d.licitacion_id]);
      if (atraso > 0) {
        out[rut].facturasVencidas += 1;
        out[rut].montoVencido += Number(d.monto || 0);
        if (atraso > out[rut].diasAtrasoMax) out[rut].diasAtrasoMax = atraso;
      }
    });
    return out;
  }

  // ¿El cliente (rut) está habilitado para cotizar? Considera la mora y el
  // override manual del admin (clientes.cobranza_desbloqueado).
  async estadoBloqueoCliente(rut: string, tipoCliente?: string) {
    const r = String(rut || '').trim();
    const umbral = this.umbralMora(tipoCliente);
    if (!r) return { rut: r, diasAtrasoMax: 0, montoVencido: 0, umbral, bloqueado: false, desbloqueado: false };
    const mora = (await this.moraPorRuts([r]))[r] || { diasAtrasoMax: 0, montoVencido: 0, facturasVencidas: 0 };
    // Override manual del admin: 'bloqueado' | 'desbloqueado' | null (automático).
    let override: 'bloqueado' | 'desbloqueado' | null = null;
    try {
      const { data: cli } = await this.supabase.getClient()
        .from('clientes')
        .select('cobranza_override')
        .eq('rut', r)
        .maybeSingle();
      const v = (cli?.cobranza_override || '').toString().trim().toLowerCase();
      if (v === 'bloqueado' || v === 'desbloqueado') override = v;
    } catch { /* columna sin migrar */ }
    // Compatibilidad con el override anterior (booleano cobranza_desbloqueado).
    if (!override) {
      try {
        const { data: cli2 } = await this.supabase.getClient()
          .from('clientes')
          .select('cobranza_desbloqueado')
          .eq('rut', r)
          .maybeSingle();
        if (cli2?.cobranza_desbloqueado) override = 'desbloqueado';
      } catch { /* columna sin migrar */ }
    }
    const autoBloqueado = mora.diasAtrasoMax >= umbral;
    let bloqueado: boolean;
    if (override === 'desbloqueado') bloqueado = false;
    else if (override === 'bloqueado') bloqueado = true;
    else bloqueado = autoBloqueado;
    return {
      rut: r,
      diasAtrasoMax: mora.diasAtrasoMax,
      montoVencido: mora.montoVencido,
      umbral,
      bloqueado,
      autoBloqueado,
      override, // null = automático
      desbloqueado: override === 'desbloqueado',
    };
  }

  async create(body: Record<string, any>) {
    // Bloqueo por mora: no permitir cotizar a clientes con atraso ≥ umbral
    // (120 días mercado público / 60 días cliente particular), salvo override
    // manual del admin.
    const rutEntidad = String(body?.rut_entidad || '').trim();
    if (rutEntidad) {
      const estado = await this.estadoBloqueoCliente(rutEntidad, body?.tipo_cliente);
      if (estado.bloqueado) {
        throw new BadRequestException(
          `Cliente bloqueado por deuda: ${estado.diasAtrasoMax} días de atraso (máximo permitido ${estado.umbral}). Regulariza en Cobranza o solicita desbloqueo a un administrador.`,
        );
      }
    }

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

    // Los campos de fecha/timestamp vacíos ("") rompen Postgres
    // ("invalid input syntax for type timestamp"). Se normalizan a null.
    const CAMPOS_FECHA = ['fecha_hora_cierre', 'fecha_adjudicada', 'fecha_publicacion_resultados', 'fecha'];
    for (const campo of CAMPOS_FECHA) {
      if (campo in body && (body[campo] === '' || body[campo] === undefined)) body[campo] = null;
    }

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
