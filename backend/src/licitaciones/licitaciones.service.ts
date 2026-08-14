import { Injectable, BadRequestException, NotFoundException, Logger } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { MailingsService } from '../mailings/mailings.service';
import { ChatService } from '../chat/chat.service';

@Injectable()
export class LicitacionesService {
  private readonly logger = new Logger('Licitaciones');
  // Aprobador "dueño" del flujo: si él mismo aprueba, no se le notifica.
  private static readonly JEREMIAS = 'jer.consorcio@gmail.com';

  constructor(
    private supabase: SupabaseService,
    private mailings: MailingsService,
    private chat: ChatService,
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
    // Antes de listar se cierran las que ya vencieron. Va acá, y no solo en un
    // proceso programado, para que el listado nunca muestre como pendiente algo
    // a lo que ya no se puede postular, aunque el servidor haya estado caído a
    // la hora del cierre.
    await this.cerrarVencidas().catch(() => null);
    const client = this.supabase.getClient();
    const { data, error } = await client
      .from('licitaciones_disponibles')
      .select('*')
      .order('cargada', { ascending: true })
      .order('created_at', { ascending: false });
    if (error) throw new BadRequestException(error.message);
    const filas = data || [];
    if (!filas.length) return filas;

    /* ¿Ya postulamos? — respuesta inmediata cruzando con NUESTRAS cotizaciones.
       Es la que sirve mientras el proceso está abierto: Mercado Público no
       publica los oferentes hasta que el comprador selecciona proveedor
       (verificado el 2026-08-11: los procesos en «Publicada» y en «Cerrada»
       devuelven la lista de cotizantes vacía), así que preguntarle a la API
       antes de eso no responde nada. Que exista una cotización nuestra con ese
       código sí es un hecho, y se sabe al instante y sin gastar cuota.
       La confirmación oficial contra la API llega después, con el botón de
       revisar, y queda guardada en `datos.postulamos`. */
    const codigos = filas
      .map((f: any) => String(f.id_licitacion || '').trim())
      .filter(Boolean);
    const propias = new Map<string, any>();
    const TANDA = 200;
    for (let i = 0; i < codigos.length; i += TANDA) {
      const { data: lics } = await client
        .from('licitaciones')
        .select('id, id_licitacion, nombre, estado, vendedor_nombre, creado_por, created_at, total_con_iva')
        .in('id_licitacion', codigos.slice(i, i + TANDA));
      for (const l of lics || []) {
        const k = String(l.id_licitacion || '').trim().toLowerCase();
        // Si hubiera más de una, manda la más reciente.
        const prev = propias.get(k);
        if (!prev || String(l.created_at) > String(prev.created_at)) propias.set(k, l);
      }
    }

    return filas.map((f: any) => ({
      ...f,
      cotizacion_propia: propias.get(String(f.id_licitacion || '').trim().toLowerCase()) || null,
    }));
  }

  // Se recuerda cuándo se hizo la última pasada: el listado se pide muchas
  // veces por minuto y no tiene sentido recorrerlo entero en cada una.
  private ultimoCierreVencidas = 0;

  /**
   * Cierra las postulaciones cuyo plazo ya pasó y libera su reserva.
   *
   * Liberar la reserva importa tanto como cerrarla: cada persona puede tener
   * como máximo 3 postulaciones tomadas a la vez, y una que vencía se quedaba
   * ocupando el cupo indefinidamente porque nadie la iba a cargar ya.
   */
  async cerrarVencidas(forzar = false) {
    const CADA_MS = 2 * 60 * 1000;
    if (!forzar && Date.now() - this.ultimoCierreVencidas < CADA_MS) return { revisadas: 0, cerradas: 0 };
    this.ultimoCierreVencidas = Date.now();

    const client = this.supabase.getClient();
    const { data, error } = await client
      .from('licitaciones_disponibles')
      .select('id, datos, tomada_por, cerrada')
      .eq('cerrada', false)
      .eq('cargada', false);
    if (error) {
      // La columna puede no existir todavía: la migración se aplica a mano.
      if (/cerrada|column|schema cache/i.test(error.message)) return { revisadas: 0, cerradas: 0, sin_migracion: true };
      throw new BadRequestException(error.message);
    }

    const vencidas = (data || []).filter((r: any) =>
      LicitacionesService.postulacionVencida(r?.datos?.cierre),
    );
    if (!vencidas.length) return { revisadas: (data || []).length, cerradas: 0 };

    const ahora = new Date().toISOString();
    // En tandas: un `.in()` con cientos de ids arma una URL desmedida.
    let cerradas = 0;
    const TANDA = 200;
    for (let i = 0; i < vencidas.length; i += TANDA) {
      const ids = vencidas.slice(i, i + TANDA).map((r: any) => r.id);
      const { error: errUp } = await client
        .from('licitaciones_disponibles')
        .update({ cerrada: true, cerrada_at: ahora, tomada_por: null, tomada_at: null })
        .in('id', ids);
      if (errUp) throw new BadRequestException(errUp.message);
      cerradas += ids.length;
    }
    return { revisadas: (data || []).length, cerradas };
  }

  // Carga masiva desde xlsx. Inserta solo las que no existan (dedup por
  // id_licitacion, case-insensitive). Guarda las columnas adicionales del
  // archivo (organismo, región, monto, cierre, etc.) en `datos` para
  // prellenar luego la cotización. Devuelve cuántas se insertaron / omitieron.
  // Determina si una fecha de cierre del portal ya pasó. Acepta "DD-MM-YYYY",
  // "DD/MM/YYYY" (con hora opcional), ISO y timestamps. Si no se puede
  // interpretar, se considera NO vencida (no bloquear por falta de dato).
  private static postulacionVencida(cierreRaw: any): boolean {
    const s = String(cierreRaw ?? '').trim();
    if (!s) return false;
    let cierre: Date | null = null;
    // "DD-MM-YYYY[ HH:mm]" o "DD-MM-YY HH:mm" (año de 2 dígitos, formato
    // actual del portal). Sin hora se asume 23:59 (vigente todo el día).
    const m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4}|\d{2})(?:[ T](\d{1,2}):(\d{2}))?/);
    if (m) {
      const anio = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
      const hh = m[4] != null ? Number(m[4]) : 23;
      const mi = m[5] != null ? Number(m[5]) : 59;
      cierre = new Date(anio, Number(m[2]) - 1, Number(m[1]), hh, mi);
    } else {
      const d = new Date(s);
      cierre = isNaN(d.getTime()) ? null : d;
    }
    if (!cierre) return false;
    return cierre.getTime() < Date.now();
  }

  async bulkDisponibles(rows: any[], subidaPor: string, origen: 'listado' | 'exploracion' = 'listado') {
    const vistos = new Set<string>();
    const limpias: any[] = [];
    for (const r of rows || []) {
      const idl = String(r?.id_licitacion || '').trim();
      if (!idl) continue;
      const key = idl.toLowerCase();
      if (vistos.has(key)) continue;
      vistos.add(key);
      const val = (x: any) => (String(x ?? '').trim() || null);
      // Trae TODAS las columnas: si el frontend ya mandó un objeto `datos`
      // (parser nuevo, con columnas conocidas + extras), se usa tal cual
      // limpiando vacíos; si no, se reconstruye desde los campos planos
      // (compatibilidad con la versión anterior del parser).
      let datos: Record<string, any>;
      if (r?.datos && typeof r.datos === 'object') {
        datos = {};
        for (const [k, v] of Object.entries(r.datos)) datos[k] = val(v);
      } else {
        datos = {
          descripcion: val(r?.descripcion),
          organismo: val(r?.organismo),
          tipo: val(r?.tipo),
          region: val(r?.region),
          monto: val(r?.monto),
          cierre: val(r?.cierre),
          publicacion: val(r?.publicacion),
          url_ficha: val(r?.url_ficha),
          lineas_negocio: val(r?.lineas_negocio),
        };
      }
      limpias.push({ id_licitacion: idl, nombre: String(r?.nombre || '').trim(), datos });
    }
    if (!limpias.length) return { insertados: 0, duplicados: 0, total: 0 };

    // Se trae también el origen: una fila que existe como toma del Explorador
    // ('exploracion') no se ve en el Listado, así que agregarla al Listado no
    // debe quedar en "duplicado silencioso": se PROMUEVE cambiándole el origen
    // (conserva quién la tomó, su estado y su historial).
    let existentes: any[] = [];
    {
      const r1 = await this.supabase.getClient()
        .from('licitaciones_disponibles')
        .select('id, id_licitacion, origen');
      if (r1.error) {
        const msg = [r1.error.message, (r1.error as any).code].filter(Boolean).join(' ').toLowerCase();
        if (!msg.includes('origen') && !msg.includes('42703')) throw new BadRequestException(r1.error.message);
        // Columna `origen` sin migrar: se sigue como antes (todo es Listado).
        const r2 = await this.supabase.getClient().from('licitaciones_disponibles').select('id, id_licitacion');
        if (r2.error) throw new BadRequestException(r2.error.message);
        existentes = r2.data || [];
      } else {
        existentes = r1.data || [];
      }
    }
    const porCodigo = new Map(
      existentes.map((e: any) => [String(e.id_licitacion || '').trim().toLowerCase(), e]),
    );

    const nuevas = limpias.filter((l) => !porCodigo.has(l.id_licitacion.toLowerCase()));
    // Promoción exploración → listado (nunca al revés: subir el xlsx no debe
    // esconderle al Listado una fila que ya estaba ahí).
    const promover = origen === 'listado'
      ? limpias.filter((l) => porCodigo.get(l.id_licitacion.toLowerCase())?.origen === 'exploracion')
      : [];
    const duplicados = limpias.length - nuevas.length - promover.length;

    if (promover.length) {
      const { error: errProm } = await this.supabase.getClient()
        .from('licitaciones_disponibles')
        .update({ origen: 'listado' })
        .in('id', promover.map((l) => porCodigo.get(l.id_licitacion.toLowerCase())!.id));
      if (errProm) throw new BadRequestException(errProm.message);
    }

    if (nuevas.length) {
      const filas = nuevas.map((n) => ({ ...n, subida_por: subidaPor, origen }));
      let { error } = await this.supabase.getClient()
        .from('licitaciones_disponibles')
        .insert(filas);
      // Tolerar columnas aún no migradas (`datos`, `origen`): reintenta sin ellas.
      if (error) {
        const msg = [error.message, (error as any).details, (error as any).hint, (error as any).code]
          .filter(Boolean).join(' ').toLowerCase();
        if (msg.includes('origen')) {
          const sinOrigen = filas.map(({ origen: _o, ...rest }) => rest);
          ({ error } = await this.supabase.getClient().from('licitaciones_disponibles').insert(sinOrigen));
        } else if (msg.includes('datos') || msg.includes('42703')) {
          const sinDatos = filas.map(({ datos, ...rest }) => rest);
          ({ error } = await this.supabase.getClient().from('licitaciones_disponibles').insert(sinDatos));
        }
      }
      if (error) throw new BadRequestException(error.message);
    }
    return { insertados: nuevas.length + promover.length, duplicados, total: limpias.length };
  }

  // Borra TODO el listado de postulaciones disponibles (solo admin, desde el
  // frontend). Útil para reemplazar el listado del día completo. Las tomas del
  // Explorador NO se tocan: viven en otra vista y reemplazar el listado del
  // día no es motivo para soltarle la toma a alguien.
  async eliminarTodasDisponibles() {
    let { error } = await this.supabase.getClient()
      .from('licitaciones_disponibles')
      .delete()
      .gt('id', 0)
      .neq('origen', 'exploracion');
    if (error && /origen|42703/i.test([error.message, (error as any).code].join(' '))) {
      // Columna sin migrar: no existen tomas de exploración, borrar todo.
      ({ error } = await this.supabase.getClient().from('licitaciones_disponibles').delete().gt('id', 0));
    }
    if (error) throw new BadRequestException(error.message);
    return { deleted: true };
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

  // "Tomar" / liberar una postulación (reserva temporal por usuario). Cada
  // usuario puede tener como máximo 3 postulaciones tomadas y pendientes.
  async tomarDisponible(id: number, email: string, tomar: boolean) {
    const client = this.supabase.getClient();
    const correo = (email || '').trim().toLowerCase();
    if (!correo) throw new BadRequestException('Sesión sin usuario válido.');

    if (!tomar) {
      // Liberar: solo si la tomó este usuario.
      const { data, error } = await client
        .from('licitaciones_disponibles')
        .update({ tomada_por: null, tomada_at: null })
        .eq('id', id)
        .ilike('tomada_por', correo)
        .select()
        .maybeSingle();
      if (error) throw new BadRequestException(error.message);
      return data;
    }

    // Tomar: no debe estar tomada por otro.
    // Se intenta traer `datos` para validar la vigencia por fecha de cierre; si la
    // columna aún no está migrada (42703), se omite esa validación.
    let row: any;
    {
      const r1 = await client
        .from('licitaciones_disponibles')
        .select('tomada_por, cargada, datos')
        .eq('id', id)
        .single();
      if (r1.error) {
        const msg = [r1.error.message, (r1.error as any).code].filter(Boolean).join(' ').toLowerCase();
        if (msg.includes('datos') || msg.includes('42703')) {
          const r2 = await client
            .from('licitaciones_disponibles')
            .select('tomada_por, cargada')
            .eq('id', id)
            .single();
          if (r2.error) throw new BadRequestException(r2.error.message);
          row = r2.data;
        } else {
          throw new BadRequestException(r1.error.message);
        }
      } else {
        row = r1.data;
      }
    }
    const dueno = (row?.tomada_por || '').trim().toLowerCase();
    if (dueno && dueno !== correo) {
      throw new BadRequestException(`Esta postulación ya fue tomada por ${row.tomada_por}.`);
    }

    // No se puede tomar una postulación vencida (fuera de la fecha de cierre).
    if (row?.datos && LicitacionesService.postulacionVencida(row.datos.cierre)) {
      throw new BadRequestException('Esta postulación está vencida (fuera de la fecha de cierre) y no se puede tomar.');
    }

    // Límite: máx. 3 tomadas pendientes por usuario (excluyendo esta).
    const { count, error: errCount } = await client
      .from('licitaciones_disponibles')
      .select('id', { count: 'exact', head: true })
      .ilike('tomada_por', correo)
      .eq('cargada', false)
      .neq('id', id);
    if (errCount) throw new BadRequestException(errCount.message);
    if ((count || 0) >= 3) {
      throw new BadRequestException('Ya tienes 3 postulaciones tomadas. Crea la cotización de alguna para liberar un cupo.');
    }

    const { data, error } = await client
      .from('licitaciones_disponibles')
      .update({ tomada_por: correo, tomada_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);

    // Aviso al equipo, sin bloquear la toma: si el chat falla, la postulación
    // igual quedó tomada y el error solo se registra en el log.
    void this.avisarTomaEnChat(data, correo).catch((e) =>
      this.logger.warn(`Aviso de toma no enviado: ${String(e?.message || e)}`),
    );
    return data;
  }

  /* Publica en la sala General (y al grupo de WhatsApp, si el puente está
     configurado) que alguien tomó una postulación. El equipo se enteraba
     recién al mirar el listado; con 3 cupos por persona y cierres el mismo
     día, saber al tiro quién está en qué evita tomas repetidas de facto. */
  private async avisarTomaEnChat(row: any, correo: string) {
    const client = this.supabase.getClient();

    // Nombre del que toma: del perfil; si no hay, la parte local del correo.
    let nombre = '';
    try {
      const { data: perfil } = await client
        .from('profiles')
        .select('nombre')
        .ilike('email', correo)
        .maybeSingle();
      nombre = String(perfil?.nombre || '').trim();
    } catch { /* sin perfil no se cae el aviso */ }
    if (!nombre) nombre = correo.split('@')[0];

    const codigo = String(row?.id_licitacion || '').trim();
    const titulo = String(row?.nombre || '').trim();
    const cierre = String(row?.datos?.cierre || '').trim();
    const partes = [`📌 ${nombre} tomó la postulación ${codigo}`];
    if (titulo) partes.push(`«${titulo.slice(0, 120)}»`);
    if (cierre) partes.push(`(cierra ${cierre})`);
    const texto = partes.join(' ');

    const { data: sala } = await client
      .from('chat_salas')
      .select('id')
      .eq('es_general', true)
      .maybeSingle();
    if (sala?.id) {
      await client.from('chat_mensajes').insert([{
        sala_id: sala.id,
        autor_email: 'avisos@amsodent',
        autor_nombre: 'Avisos',
        tipo: 'texto',
        texto,
      }]);
    }

    // El espejo en WhatsApp sigue el mismo camino que un mensaje escrito en la
    // General. Si el puente no está configurado, enviarWhatsApp lo dice y ya.
    await this.chat.enviarWhatsApp({ autor: 'Avisos', texto });
  }

  async eliminarDisponible(id: number) {
    const { error } = await this.supabase.getClient()
      .from('licitaciones_disponibles')
      .delete()
      .eq('id', id);
    if (error) throw new BadRequestException(error.message);
    return { deleted: true };
  }

  /* ===========================================================
     FICHA EN VIVO DESDE MERCADO PÚBLICO
     Dos APIs según el tipo de proceso (mismo ticket, env
     MERCADO_PUBLICO_TICKET — nunca llega al frontend):
     - Códigos ...-COTxx  → API Compra Ágil v2 (api2.mercadopublico.cl)
     - Resto (LE/LP/LQ/LR/L1/CO…) → API Licitaciones v1
       (api.mercadopublico.cl/servicios/v1/publico/licitaciones.json)
     Ambas respuestas se normalizan a una "ficha" común que el
     frontend solo renderiza: { fuente, codigo, nombre, descripcion,
     estado, tono, chips[], secciones[{titulo, filas[[k,v]]}],
     productos[], url_acta }.
  =========================================================== */

  private static fmtFechaMP(v: any): string {
    if (!v) return '';
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return String(v);
    return d.toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' });
  }

  private static fmtMontoMP(n: any, moneda = ''): string {
    const num = Number(n);
    if (!Number.isFinite(num) || num <= 0) return '';
    return `$${Math.round(num).toLocaleString('es-CL')}${moneda ? ` ${moneda}` : ''}`;
  }

  private mpTicket(): string {
    const ticket = (process.env.MERCADO_PUBLICO_TICKET || '').trim();
    if (!ticket) {
      throw new BadRequestException(
        'MERCADO_PUBLICO_TICKET no está configurado en el servidor; agrega el ticket de la API de ChileCompra.',
      );
    }
    return ticket;
  }

  /**
   * Mercado Público es LENTO: medido el 2026-08-11 contra la API v2, una
   * consulta cualquiera tarda entre 12 y 29 segundos. El timeout estaba en
   * 20 s, o sea POR DEBAJO del tiempo normal de respuesta: casi toda consulta
   * con resultados se abortaba sola. De ahí venían los «error» que aparecían
   * junto a cada palabra clave, con el mensaje opaco «The operation was
   * aborted due to timeout».
   *
   * El techo real no es nuestro: su propio gateway corta a los ~29,5 s y
   * devuelve 504. Se espera hasta 35 s para alcanzar a VER ese 504 —con 20 s
   * abortábamos antes y nunca sabíamos si había sido ellos o la red— sin
   * quedarnos colgados si la conexión se muere sin respuesta.
   */
  private static readonly MP_TIMEOUT_MS = 35000;

  private async mpFetch(
    url: string,
    headers: Record<string, string> = {},
    timeoutMs = LicitacionesService.MP_TIMEOUT_MS,
  ): Promise<any> {
    let res: globalThis.Response;
    try {
      res = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
    } catch (e: any) {
      throw new BadRequestException(
        `No se pudo consultar Mercado Público: ${String(e?.message || e).slice(0, 120)}`,
      );
    }
    const json: any = await res.json().catch(() => null);
    if (res.status === 429) {
      throw new BadRequestException(
        'Se agotó la cuota diaria del ticket de Mercado Público; se restablece al día siguiente.',
      );
    }
    return { res, json };
  }

  async mercadoPublicoDetalle(codigo: string) {
    const ticket = this.mpTicket();
    const cod = String(codigo || '').trim();
    if (!/^[A-Za-z0-9-]{3,40}$/.test(cod)) {
      throw new BadRequestException('Código de proceso inválido.');
    }
    return /-COT\w*$/i.test(cod)
      ? this.fichaCompraAgil(cod, ticket)
      : this.fichaLicitacion(cod, ticket);
  }

  /* ===========================================================
     ¿YA POSTULAMOS A ESTE PROCESO?
     -----------------------------------------------------------
     Mercado Público publica los oferentes de una Compra Ágil en
     `proveedores_cotizando`, con su RUT. Buscando ahí el RUT de
     la empresa se sabe con certeza si la postulación ya se envió,
     sin depender de que alguien la haya marcado en el sistema.

     Solo sirve para Compra Ágil: la API v1 de licitaciones
     publica únicamente a los ADJUDICADOS, así que mientras el
     proceso no se resuelva no hay forma de saber quién ofertó.
     Eso se informa como «no se puede saber», que es distinto de
     «no postulamos».

     El resultado se guarda en la columna `datos` (jsonb) de la
     postulación, para no repetir la consulta ni gastar cuota de
     más: una vez que se postuló, eso ya no cambia.
  =========================================================== */
  private rutEmpresaMp(): string {
    const rut = String(process.env.MP_RUT_EMPRESA || '').replace(/[^0-9kK]/g, '').toUpperCase();
    if (!rut) {
      throw new BadRequestException(
        'Falta configurar MP_RUT_EMPRESA en el servidor: sin el RUT de la empresa no se puede saber si la oferta es nuestra.',
      );
    }
    return rut;
  }

  /** Consulta un proceso y devuelve qué se sabe de nuestra participación. */
  private async consultarPostulacion(codigo: string, ticket: string, rutEmpresa: string) {
    if (!/-COT\w*$/i.test(codigo)) {
      return {
        postulamos: null as boolean | null,
        nota: 'La API de licitaciones solo publica a los adjudicados: hasta que se resuelva no se puede saber quién ofertó.',
      };
    }
    const { res, json } = await this.mpFetch(
      `https://api2.mercadopublico.cl/v2/compra-agil/${encodeURIComponent(codigo)}`,
      { ticket },
    );
    if (res.status === 404) {
      return { postulamos: null as boolean | null, nota: 'El proceso no existe en Mercado Público.' };
    }
    if (!res.ok || json?.success !== 'OK') {
      const err = json?.errors?.[0]?.mensaje;
      if (!err && res.status >= 502 && res.status <= 504) {
        throw new Error('Mercado Público tardó demasiado y cortó la consulta');
      }
      throw new Error(err || `HTTP ${res.status}`);
    }
    const p = json.payload || {};
    const cotizantes: any[] = Array.isArray(p.proveedores_cotizando) ? p.proveedores_cotizando : [];
    const norm = (r: unknown) => String(r || '').replace(/[^0-9kK]/g, '').toUpperCase();
    const nuestra = cotizantes.find((c) => norm(c?.rut_proveedor) === rutEmpresa) || null;
    // Sin cotizantes publicados todavía no se puede afirmar que no postulamos:
    // los procesos abiertos suelen no mostrar las ofertas hasta el cierre.
    if (!cotizantes.length) {
      return {
        postulamos: null as boolean | null,
        estado_mp: p?.estado?.glosa || null,
        nota: 'Mercado Público aún no publica las ofertas de este proceso.',
      };
    }
    return {
      postulamos: !!nuestra,
      monto: nuestra ? Number(nuestra.monto_total) || null : null,
      ofertas: cotizantes.length,
      estado_mp: p?.estado?.glosa || null,
      seleccionados: cotizantes.some((c) => c?.seleccion?.proveedor_seleccionado === true),
    };
  }

  /**
   * Revisa un lote de postulaciones del listado y anota en cada una si la
   * oferta ya fue enviada. `ids` limita a filas concretas; sin `ids` toma las
   * que aún no se han revisado y siguen abiertas.
   */
  async verificarPostulaciones(body?: { ids?: number[]; lote?: number; revisarTodas?: boolean }) {
    const ticket = this.mpTicket();
    const rutEmpresa = this.rutEmpresaMp();
    const client = this.supabase.getClient();

    const ids = Array.isArray(body?.ids) ? body!.ids!.map(Number).filter(Number.isFinite) : null;
    let query = client
      .from('licitaciones_disponibles')
      .select('id, id_licitacion, datos')
      .order('created_at', { ascending: false })
      .limit(1000);
    if (ids?.length) query = query.in('id', ids);
    const { data, error } = await query;
    if (error) throw new BadRequestException(error.message);

    const candidatas = (data || []).filter((r: any) => {
      if (ids?.length) return true; // explícitas: se revisan aunque ya tengan dato
      // Ya se confirmó que postulamos: no cambia, no se vuelve a preguntar.
      if (r?.datos?.postulamos === true) return false;
      if (body?.revisarTodas) return true;
      // Sin marca previa, o marcada como «no se pudo saber».
      return r?.datos?.postulamos == null;
    });

    const lote = Math.max(1, Math.min(200, Number(body?.lote) || 24));
    const aRevisar = candidatas.slice(0, lote);

    const CONCURRENCIA = 12; // el mismo techo medido para esta API
    let revisadas = 0;
    let conPostulacion = 0;
    let sinDato = 0;
    const errores: string[] = [];

    for (let i = 0; i < aRevisar.length; i += CONCURRENCIA) {
      await Promise.all(aRevisar.slice(i, i + CONCURRENCIA).map(async (row: any) => {
        const codigo = String(row.id_licitacion || '').trim();
        revisadas += 1;
        let resultado: any;
        try {
          resultado = await this.consultarPostulacion(codigo, ticket, rutEmpresa);
        } catch (e: any) {
          errores.push(`${codigo}: ${String(e?.message || e).slice(0, 120)}`);
          return;
        }
        if (resultado.postulamos === true) conPostulacion += 1;
        else if (resultado.postulamos == null) sinDato += 1;
        const datos = {
          ...(row.datos || {}),
          postulamos: resultado.postulamos,
          postulamos_at: new Date().toISOString(),
          postulamos_monto: resultado.monto ?? null,
          postulamos_ofertas: resultado.ofertas ?? null,
          postulamos_nota: resultado.nota ?? null,
        };
        const { error: errUp } = await client
          .from('licitaciones_disponibles')
          .update({ datos })
          .eq('id', row.id);
        if (errUp) errores.push(`${codigo}: ${errUp.message.slice(0, 120)}`);
      }));
    }

    return {
      revisadas,
      con_postulacion: conPostulacion,
      sin_dato: sinDato,
      restantes: Math.max(0, candidatas.length - revisadas),
      errores,
    };
  }

  // ── Buscador (sección "Explorar Mercado Público") ───────────────────────
  // - fuente 'agil': búsqueda server-side de la API v2 (keyword q, región,
  //   estado, paginación real).
  // - fuente 'licitaciones': la API v1 NO busca por keyword; se descarga el
  //   listado de licitaciones ACTIVAS (1 request), se cachea 10 minutos en
  //   memoria (cuida la cuota diaria del ticket) y se filtra/pagina aquí.
  private static readonly ESTADOS_V1: Record<number, string> = {
    5: 'Publicada', 6: 'Cerrada', 7: 'Desierta', 8: 'Adjudicada', 18: 'Revocada', 19: 'Suspendida',
  };
  // key: 'activas' o el día consultado (DDMMYYYY), para no mezclar listados.
  private mpCacheActivas: { data: any[]; ts: number; key: string } | null = null;

  /* ── Match de keywords contra Compra Ágil ─────────────────────────────
     Tres mañas de la búsqueda de la API v2, todas medidas contra la API real:

     · Une las palabras de una frase con O, no con Y (2026-08-12: "Lidocaína 2"
       devuelve 1.469 procesos porque el "2" calza solo, y una remodelación de
       Carabineros terminó dentro de una búsqueda dental)... SALVO que cada
       palabra lleve "+" adelante: "+insumos +dentales" exige AMBAS y devuelve
       21 contra los 1.302 del O implícito (2026-08-13). Las comillas no
       sirven: responden HTTP 500.
     · NO normaliza tildes del lado de la consulta (sí del texto): "lidocaína"
       devuelve 0 y "lidocaina" devuelve 3. Toda palabra acentuada del catálogo
       devolvía cero hasta que se les quitó la tilde al enviarlas.
     · El "+" no es un Y perfecto (2 de 21 llegaron sin ambas palabras), así
       que lo que VUELVE igual se verifica: todas las palabras significativas
       deben aparecer en nombre+descripción — el mismo criterio que ya usaba
       la fuente de licitaciones (v1). */
  private static readonly STOP_MP = new Set([
    'de', 'del', 'la', 'las', 'el', 'los', 'lo', 'y', 'o', 'u', 'a', 'e',
    'en', 'con', 'para', 'por', 'al', 'un', 'una', 'unos', 'unas',
  ]);

  private static normTexto(s: any): string {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  }

  /** Palabras que discriminan, reducidas a su raíz singular. */
  private static palabrasSignificativas(kw: string): string[] {
    return LicitacionesService.normTexto(kw)
      .split(/\s+/)
      .filter((w) => w.length >= 3 && !LicitacionesService.STOP_MP.has(w))
      .map((w) =>
        w.endsWith('es') && w.length > 4 && !/[aeiou]es$/.test(w) ? w.slice(0, -2)
        : w.endsWith('s') && w.length > 3 ? w.slice(0, -1)
        : w,
      );
  }

  /** ¿El texto contiene TODAS las palabras significativas del término? */
  private static calzaTermino(kw: string, texto: string): boolean {
    const sig = LicitacionesService.palabrasSignificativas(kw);
    if (!sig.length) return true; // término sin palabras útiles: no se filtra
    const t = LicitacionesService.normTexto(texto);
    return sig.every((w) => t.includes(w));
  }

  /** El término como se envía a la API: solo sus palabras con contenido, SIN
   *  tildes (con tilde la API devuelve 0), y si son varias, cada una con "+"
   *  adelante para que la API exija TODAS en vez de unirlas con O. */
  private static terminoParaApi(kw: string): string {
    const utiles = LicitacionesService.normTexto(kw)
      .split(/\s+/)
      .filter((w) => w.length >= 3 && !LicitacionesService.STOP_MP.has(w));
    // Sin palabras útiles se envía tal cual (sin tildes): mejor ruido visible
    // que un término que desaparece en silencio.
    if (!utiles.length) return LicitacionesService.normTexto(kw).trim() || String(kw || '').trim();
    return utiles.length === 1 ? utiles[0] : utiles.map((w) => `+${w}`).join(' ');
  }

  private static mapItemAgil(it: any) {
    const tipo = LicitacionesService.tipoProceso(it?.codigo || '');
    return {
      codigo: it?.codigo || '',
      tipo_sigla: tipo.sigla,
      tipo_label: tipo.label,
      tipo_familia: tipo.familia,
      nombre: it?.nombre || '',
      estado: it?.estado?.glosa || it?.estado?.codigo || '',
      estado_codigo: it?.estado?.codigo || '',
      convocatoria: it?.convocatoria?.descripcion || '',
      organismo: it?.institucion?.organismo_comprador || '',
      region: it?.institucion?.nombre_region || '',
      monto_clp: it?.montos?.monto_disponible_clp ?? null,
      fecha_publicacion: it?.fechas?.fecha_publicacion || null,
      fecha_cierre: it?.fechas?.fecha_cierre || null,
      ofertas: it?.resumen?.total_ofertas_recibidas ?? null,
    };
  }

  async mercadoPublicoBuscar(params: {
    fuente?: string;
    q?: string;
    region?: string;
    estado?: string;
    desde?: string;
    hasta?: string;
    pagina?: string | number;
    tamano?: string | number;
  }) {
    const ticket = this.mpTicket();
    const fuente = params?.fuente === 'licitaciones' ? 'licitaciones'
      : params?.fuente === 'todas' ? 'todas'
      : 'agil';

    // Varias keywords separadas por coma → una consulta por keyword. El tope NO
    // es de la API (que acepta un término por llamada): es nuestro, para acotar
    // cuántas llamadas gasta una sola búsqueda de la cuota diaria del ticket.
    // Cada keyword se expande a singular/plural, así que el gasto real es ~2×.
    // Lo que sobra se informa en la respuesta: antes se descartaba en silencio y
    // el usuario creía haber buscado términos que nunca se enviaron.
    //
    // Se recorta por CANTIDAD de palabras, nunca por largo del texto. Antes
    // había un slice(0, 300) sobre la cadena completa, aplicado ANTES de
    // separarla por comas: con el catálogo de 80 términos —1.566 caracteres—
    // solo pasaban 16, la última partida a la mitad («Cepillo pró», que además
    // se consultaba así), y las otras 65 se perdían sin aviso. El tope de 80
    // nunca alcanzaba a aplicarse y `ignoradas` siempre iba vacío, así que la
    // búsqueda decía haber mirado todo el catálogo cuando había visto la quinta
    // parte.
    const MAX_KEYWORDS = 80;
    const MAX_LARGO_TERMINO = 80;
    const solicitadas = String(params?.q || '')
      .split(',')
      .map((s) => s.trim().slice(0, MAX_LARGO_TERMINO))
      .filter(Boolean);
    const keywords = solicitadas.slice(0, MAX_KEYWORDS);
    const ignoradas = solicitadas.slice(MAX_KEYWORDS);
    const pagina = Math.max(1, Number(params?.pagina) || 1);
    const tamano = Math.min(50, Math.max(10, Number(params?.tamano) || 15));
    // Rango por fecha de publicación (YYYY-MM-DD), igual que el portal.
    const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;
    const pubDesde = RE_FECHA.test(String(params?.desde || '')) ? String(params!.desde) : '';
    const pubHasta = RE_FECHA.test(String(params?.hasta || '')) ? String(params!.hasta) : '';

    // Fuente combinada: una sola búsqueda sobre las DOS APIs. Compra Ágil gasta
    // una consulta por palabra; Licitaciones es una sola llamada cacheada que se
    // filtra en memoria, así que sumarla casi no encarece la búsqueda.
    //
    // Los filtros de región, estado y rango de fechas solo afectan a Compra
    // Ágil: la API de licitaciones no los soporta (ver buscarLicitacionesV1).
    if (fuente === 'todas') {
      const [agil, lics] = await Promise.all([
        this.mercadoPublicoBuscar({ ...params, fuente: 'agil' }),
        // Si la v1 falla (suele ser por peticiones seguidas), no se pierde la
        // búsqueda completa: se devuelve lo de Compra Ágil y se avisa aparte.
        this.buscarLicitacionesV1(keywords, pubDesde, ticket)
          .catch((e) => ({ items: [] as any[], actualizado: null, error: String(e?.message || e) } as any)),
      ]);
      const items = [...(agil?.items || []), ...(lics?.items || [])];
      return {
        fuente: 'todas',
        items,
        paginacion: { numero_pagina: 1, total_paginas: 1, total_resultados: items.length },
        por_keyword: agil?.por_keyword,
        ...(agil?.ignoradas ? { ignoradas: agil.ignoradas, max_keywords: MAX_KEYWORDS } : {}),
        conteo_fuente: {
          compra_agil: (agil?.items || []).length,
          licitaciones: (lics?.items || []).length,
        },
        ...(lics?.error ? { error_licitaciones: lics.error } : {}),
        actualizado: lics?.actualizado || undefined,
      };
    }

    if (fuente === 'agil') {
      // La API v2 busca por palabra COMPLETA ("dental" NO encuentra
      // "DENTALES"), a diferencia del buscador del portal que calza ambas.
      // Para obtener los mismos resultados, cada keyword se consulta también
      // con su variante singular/plural. Las frases cambian de número TODAS
      // sus palabras ("insumos dentales" → "insumo dental"); las formas
      // mixtas ("INSUMO DENTALES") no se cubren, pero suelen caer igual por
      // las keywords de una sola palabra del catálogo.
      const varPalabra = (w: string): string | null => {
        if (w.length < 3) return null;
        if (w.endsWith('es') && !/[aeiouáéíóú]es$/.test(w)) return w.slice(0, -2); // dentales → dental
        if (w.endsWith('s')) return w.slice(0, -1); // resinas → resina
        if (/[aeiouáéíóú]$/.test(w)) return `${w}s`; // resina → resinas
        return `${w}es`; // dental → dentales
      };
      const varianteDe = (kw: string): string | null => {
        const k = kw.toLowerCase();
        if (k.length < 3) return null;
        if (!/\s/.test(k)) return varPalabra(k);
        const v = k.split(/\s+/).map((w) => varPalabra(w) ?? w).join(' ');
        return v === k ? null : v;
      };
      // Cada término recuerda de QUÉ palabra del catálogo salió: los match se
      // reportan con la palabra original ("Insumos dentales"), nunca con la
      // variante interna ("insumo dental") que nadie escribió.
      const terminos: { t: string; base: string }[] = [];
      const yaEsta = (s: string) => terminos.some((x) => x.t.toLowerCase() === s.toLowerCase());
      for (const kw of keywords) {
        if (!yaEsta(kw)) terminos.push({ t: kw, base: kw });
        const v = varianteDe(kw);
        if (v && !yaEsta(v)) terminos.push({ t: v, base: kw });
      }

      const buildQp = (kw: string, tam: number, pag: number) => {
        const qp = new URLSearchParams();
        if (kw) qp.set('q', kw);
        const region = Number(params?.region);
        if (Number.isFinite(region) && region >= 1 && region <= 16) qp.set('region', String(region));
        const estado = String(params?.estado || '').trim();
        if (estado) qp.set('estado', estado);
        if (pubDesde) qp.set('publicado_desde', pubDesde);
        if (pubHasta) qp.set('publicado_hasta', pubHasta);
        qp.set('tamano_pagina', String(tam));
        qp.set('numero_pagina', String(pag));
        qp.set('ordenar_por', 'FechaPublicacion');
        return qp;
      };

      // Un solo término (o ninguno): paginación real de la API.
      if (terminos.length <= 1) {
        const { res, json } = await this.mpFetch(
          `https://api2.mercadopublico.cl/v2/compra-agil?${buildQp(terminos[0]?.t || '', tamano, pagina).toString()}`,
          { ticket },
        );
        if (!res.ok || json?.success !== 'OK' || !json?.payload) {
          const err = json?.errors?.[0];
          throw new BadRequestException(
            `Mercado Público respondió ${err?.codigo || res.status}: ${err?.mensaje || 'error desconocido.'}`,
          );
        }
        const pg = json.payload?.paginacion || {};
        return {
          fuente,
          items: (json.payload?.items || []).map(LicitacionesService.mapItemAgil),
          paginacion: {
            numero_pagina: pg?.numero_pagina ?? pagina,
            total_paginas: pg?.total_paginas ?? 1,
            total_resultados: pg?.total_resultados ?? 0,
          },
        };
      }

      // Varios términos: una consulta por término EN PARALELO, combinadas sin
      // duplicados y ordenadas por fecha de publicación. Cada término consume
      // 1 consulta de la cuota diaria.
      //
      // Medido el 2026-08-11 (ver MP_TIMEOUT_MS): el gateway de Mercado Público
      // CORTA SOLO a los ~29,5 s devolviendo 504, y su latencia depende del
      // tamaño de página. Con 6 consultas en paralelo, pidiendo 30 resultados
      // fallaron las 6 de 6; pidiendo 10, respondieron 4 de 6 en 23-26 s. Y no
      // se puede bajar más: `tamano_pagina` < 10 lo rechaza con HTTP 400.
      // Por eso se pide el mínimo... pero se RECORREN las páginas que hagan
      // falta: quedarse con la primera dejaba fuera 55 de los 65 procesos de
      // "dental" (2026-08-13). Con el "+" del Y-lógico los totales por término
      // son chicos y honestos, así que casi todos caben en 1-2 páginas; el
      // tope de 10 páginas (100 procesos) es un freno para términos que aun
      // así exploten — si se alcanza, `traidos` < `total` lo delata en el
      // detalle por palabra.
      const TAM_MULTI = 10;
      const MAX_PAGINAS_TERMINO = 10;
      const pedirTermino = async (kw: string, tam: number) => {
        const q = LicitacionesService.terminoParaApi(kw);
        const crudos: any[] = [];
        let total = 0;
        let paginas = 1;
        for (let pag = 1; pag <= paginas; pag++) {
          const { res, json } = await this.mpFetch(
            `https://api2.mercadopublico.cl/v2/compra-agil?${buildQp(q, tam, pag).toString()}`,
            { ticket },
          );
          if (!res.ok || json?.success !== 'OK' || !json?.payload) {
            // Una página posterior caída no bota el término: se devuelve lo ya
            // traído y `traidos` < `total` deja constancia de que faltó.
            if (pag > 1) break;
            const err = json?.errors?.[0];
            // 502/503/504 son el gateway de ellos rindiéndose, no un problema de
            // la palabra buscada: conviene decirlo con todas sus letras para no
            // mandar a nadie a revisar una keyword que está bien.
            if (!err?.mensaje && res.status >= 502 && res.status <= 504) {
              throw new Error('Mercado Público tardó demasiado y cortó la consulta');
            }
            throw new Error(err?.mensaje || `HTTP ${res.status}`);
          }
          total = Number(json.payload?.paginacion?.total_resultados || 0);
          paginas = Math.min(MAX_PAGINAS_TERMINO, Number(json.payload?.paginacion?.total_paginas || 1));
          crudos.push(...(json.payload?.items || []).map(LicitacionesService.mapItemAgil));
        }
        // Lo que vuelve se verifica contra el nombre y la descripción: deben
        // estar TODAS las palabras significativas, como en la fuente v1.
        return {
          total,
          items: crudos.filter((it: any) =>
            LicitacionesService.calzaTermino(kw, `${it.nombre} ${it.convocatoria}`),
          ),
        };
      };

      const consultarTermino = async ({ t, base }: { t: string; base: string }) => {
        try {
          return { q: t, base, ...(await pedirTermino(t, TAM_MULTI)) };
        } catch (e1: any) {
          const msg1 = String(e1?.message || e1);
          // Sin cuota no sirve reintentar: solo gastaría otra llamada.
          if (/cuota/i.test(msg1)) {
            return { q: t, base, total: 0, items: [] as any[], error: msg1.slice(0, 140) };
          }
          // Un reintento, con los mismos parámetros: ya se está pidiendo la
          // página mínima que acepta la API, así que no hay nada más chico a
          // lo que bajar. El corte de ellos es intermitente —el mismo término
          // que falla vuelve a responder al rato— y una segunda pasada recupera
          // la mayoría.
          try {
            return { q: t, base, ...(await pedirTermino(t, TAM_MULTI)) };
          } catch (e2: any) {
            return { q: t, base, total: 0, items: [] as any[], error: String(e2?.message || e2).slice(0, 140) };
          }
        }
      };

      // En tandas y no todas a la vez: con decenas de términos, un Promise.all
      // plano abría más de cien conexiones simultáneas contra Mercado Público y
      // la API empezaba a rechazarlas. Tampoco conviene subirlo: a 12 en
      // paralelo la latencia se pega a los 29,4 s, justo contra el corte del
      // gateway, y empiezan a caer consultas que a 6 sí responden.
      const CONCURRENCIA = 6;
      const porKeyword: Awaited<ReturnType<typeof consultarTermino>>[] = [];
      for (let i = 0; i < terminos.length; i += CONCURRENCIA) {
        porKeyword.push(...await Promise.all(terminos.slice(i, i + CONCURRENCIA).map(consultarTermino)));
      }
      /* Cada resultado dice QUÉ palabra del catálogo lo trajo
         (`match_keywords`, siempre la base — no la variante interna). Además
         de mostrarse en la pantalla, es la trazabilidad que faltaba cuando un
         proceso raro aparecía en la búsqueda y nadie podía decir por cuál
         palabra entró. Un proceso traído por varias palabras las acumula. */
      const porCodigo = new Map<string, any>();
      for (const r of porKeyword) {
        for (const it of r.items) {
          if (!it.codigo) continue;
          const prev = porCodigo.get(it.codigo);
          if (prev) {
            if (!prev.match_keywords.includes(r.base)) prev.match_keywords.push(r.base);
          } else {
            porCodigo.set(it.codigo, { ...it, match_keywords: [r.base] });
          }
        }
      }
      const combinados = [...porCodigo.values()];
      combinados.sort((a, b) => String(b.fecha_publicacion || '').localeCompare(String(a.fecha_publicacion || '')));
      return {
        fuente,
        items: combinados,
        paginacion: { numero_pagina: 1, total_paginas: 1, total_resultados: combinados.length },
        por_keyword: porKeyword.map(({ q: kw, total, items, error }) => ({
          q: kw,
          total,
          traidos: items.length,
          ...(error ? { error } : {}),
        })),
        ...(ignoradas.length ? { ignoradas, max_keywords: MAX_KEYWORDS } : {}),
      };
    }

    const { items: filtradas, actualizado } = await this.buscarLicitacionesV1(keywords, pubDesde, ticket);
    // Acá la "página" es solo un recorte en memoria (la llamada v1 ya trajo el
    // listado completo), así que se acepta un tamaño grande: la exploración
    // pide 1000 para llevarse TODO en una consulta. Con el tope de 50 —que es
    // de Compra Ágil, donde la página sí viaja a la API— la búsqueda manual se
    // quedaba con la primera página (15) mientras la automática guardaba las
    // 67, y los contadores quedaban contradictorios.
    const tamLic = Math.min(1000, Math.max(10, Number(params?.tamano) || 15));
    const total = filtradas.length;
    const desde = (pagina - 1) * tamLic;
    return {
      fuente,
      items: filtradas.slice(desde, desde + tamLic),
      paginacion: {
        numero_pagina: pagina,
        total_paginas: Math.max(1, Math.ceil(total / tamLic)),
        total_resultados: total,
      },
      actualizado,
    };
  }

  /**
   * Licitaciones LE/LP/LQ… (API v1) con caché de 10 minutos.
   *
   * Esta API es mucho más pobre que la v2 de Compra Ágil: el listado solo
   * devuelve CodigoExterno, Nombre, CodigoEstado y FechaCierre — no trae
   * organismo, región, monto ni fecha de publicación. Y de los filtros solo
   * acepta dos (verificado contra la API):
   *   · estado=activas   → las abiertas (`region` se ignora, y otros estados
   *                        responden "parámetros no válidos")
   *   · fecha=DDMMYYYY   → publicadas ESE día exacto, sin rangos
   *
   * El filtro por palabra lo hacemos nosotros en memoria, así que no cuesta
   * consultas: da igual buscar con 3 palabras o con 80.
   */
  private async buscarLicitacionesV1(keywords: string[], pubDesde: string, ticket: string) {
    const CACHE_MS = 10 * 60 * 1000;
    const diaExacto = pubDesde ? pubDesde.split('-').reverse().join('') : '';
    const cacheKey = diaExacto || 'activas';
    if (!this.mpCacheActivas || this.mpCacheActivas.key !== cacheKey || Date.now() - this.mpCacheActivas.ts > CACHE_MS) {
      const filtro = diaExacto ? `fecha=${encodeURIComponent(diaExacto)}` : 'estado=activas';
      const { res, json } = await this.mpFetch(
        `https://api.mercadopublico.cl/servicios/v1/publico/licitaciones.json?${filtro}&ticket=${encodeURIComponent(ticket)}`,
      );
      if (!res.ok || !Array.isArray(json?.Listado)) {
        throw new BadRequestException(
          `Mercado Público respondió ${res.status}: ${String(json?.Mensaje || 'no se pudo obtener el listado de licitaciones.').slice(0, 160)}`,
        );
      }
      this.mpCacheActivas = { data: json.Listado, ts: Date.now(), key: cacheKey };
    }
    const norm = (s: any) =>
      String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    // Una licitación entra si calza con CUALQUIERA de las palabras. Para las
    // frases se exige que estén TODAS sus palabras (en cualquier orden): el
    // título "COMPRA DE INSUMOS DENTALES" calza con "insumos dentales" aunque
    // no aparezca esa secuencia literal. Se recuerda ADEMÁS con cuáles calzó
    // (`match_keywords`), para que la pantalla pueda decirlo.
    const defs = keywords
      .map((kw) => ({ kw, palabras: norm(kw).split(/\s+/).filter(Boolean) }))
      .filter((d) => d.palabras.length);
    const conMatch = this.mpCacheActivas.data
      .map((l: any) => {
        const texto = `${norm(l?.Nombre)} ${norm(l?.CodigoExterno)}`;
        const matched = defs.filter((d) => d.palabras.every((w) => texto.includes(w))).map((d) => d.kw);
        return { l, matched };
      })
      .filter((x: any) => !defs.length || x.matched.length);
    const items = conMatch.map(({ l, matched }: any) => ({
      match_keywords: matched,
      codigo: l?.CodigoExterno || '',
      ...(({ sigla, label, familia }) => ({ tipo_sigla: sigla, tipo_label: label, tipo_familia: familia }))(
        LicitacionesService.tipoProceso(l?.CodigoExterno || ''),
      ),
      nombre: l?.Nombre || '',
      estado: LicitacionesService.ESTADOS_V1[Number(l?.CodigoEstado)] || `Estado ${l?.CodigoEstado ?? '?'}`,
      estado_codigo: String(l?.CodigoEstado ?? ''),
      convocatoria: '',
      organismo: '',
      region: '',
      monto_clp: null,
      fecha_publicacion: null,
      fecha_cierre: l?.FechaCierre || null,
      ofertas: null,
    }));
    return { items, actualizado: new Date(this.mpCacheActivas.ts).toISOString() };
  }

  /**
   * Tipo de proceso deducido del sufijo del código externo de Mercado Público
   * (formato `<organismo>-<correlativo>-<sufijo><año>`, ej. 4329-4-LE26).
   *
   * Solo se mapean los sufijos que aparecen efectivamente en los listados; si
   * llega uno desconocido se devuelve el sufijo tal cual en vez de inventar una
   * glosa, para que se note y se pueda agregar.
   */
  static tipoProceso(codigo: string): { sigla: string; label: string; familia: 'compra_agil' | 'licitacion' } {
    const m = String(codigo || '').trim().toUpperCase().match(/-([A-Z]+\d?)\d{2}$/);
    const sigla = m ? m[1] : '';
    const TABLA: Record<string, string> = {
      COT: 'Compra Ágil',
      L1: 'Pública < 100 UTM',
      LE: 'Pública 100-1.000 UTM',
      LP: 'Pública 1.000-2.000 UTM',
      LQ: 'Pública 2.000-5.000 UTM',
      LR: 'Pública > 5.000 UTM',
      LS: 'Pública servicios especializados',
      E2: 'Privada < 100 UTM',
      CO: 'Privada 100-1.000 UTM',
      B2: 'Privada 1.000-2.000 UTM',
      H2: 'Privada 2.000-5.000 UTM',
      I2: 'Privada > 5.000 UTM',
    };
    return {
      sigla,
      label: TABLA[sigla] || sigla || 'Sin clasificar',
      familia: sigla === 'COT' ? 'compra_agil' : 'licitacion',
    };
  }

  // ── Compra Ágil (API v2) ────────────────────────────────────────────────
  private async fichaCompraAgil(cod: string, ticket: string) {
    const { res, json } = await this.mpFetch(
      `https://api2.mercadopublico.cl/v2/compra-agil/${encodeURIComponent(cod)}`,
      { ticket },
    );
    if (res.status === 404) {
      throw new NotFoundException('Mercado Público no tiene una Compra Ágil con ese código.');
    }
    if (!res.ok || json?.success !== 'OK' || !json?.payload) {
      const err = json?.errors?.[0];
      throw new BadRequestException(
        `Mercado Público respondió ${err?.codigo || res.status}: ${err?.mensaje || 'error desconocido.'}`,
      );
    }
    const d: any = json.payload;
    const f = LicitacionesService.fmtFechaMP;
    const estadoCod = String(d?.estado?.codigo || '');
    const tono = estadoCod === 'publicada' ? 'green'
      : estadoCod === 'proveedor_seleccionado' ? 'blue'
      : estadoCod === 'cerrada' ? 'amber'
      : estadoCod ? 'red' : 'gray';
    const ocEmitida = d?.orden_compra?.id_orden_compra != null;
    const filtrar = (filas: any[][]) => filas.filter(([, v]) => String(v ?? '').trim() !== '');

    const secciones = [
      {
        titulo: 'Organismo comprador',
        filas: filtrar([
          ['Organismo', d?.institucion?.organismo_comprador],
          ['Unidad de compra', d?.institucion?.unidad_compra],
          ['RUT', d?.institucion?.rut],
          ['Región', d?.institucion?.nombre_region],
        ]),
      },
      {
        titulo: 'Fechas',
        filas: filtrar([
          ['Publicación', f(d?.fechas?.fecha_publicacion)],
          ['Cierre vigente', f(d?.fechas?.fecha_cierre)],
          ['Cierre 1er llamado', f(d?.convocatoria?.fecha_cierre_primer_llamado)],
          ['Cierre 2º llamado', f(d?.convocatoria?.fecha_cierre_segundo_llamado)],
          ['Cancelación', f(d?.fechas?.fecha_cancelacion)],
        ]),
      },
      {
        titulo: 'Presupuesto y entrega',
        filas: filtrar([
          ['Tipo de presupuesto', d?.presupuesto?.tipo_presupuesto],
          ['Monto disponible', LicitacionesService.fmtMontoMP(d?.presupuesto?.monto_disponible_clp ?? d?.presupuesto?.presupuesto_estimado, d?.presupuesto?.moneda || 'CLP')],
          ['Dirección de entrega', d?.entrega?.direccion_entrega],
          ['Plazo de entrega', d?.entrega?.plazo_entrega_dias != null ? `${d.entrega.plazo_entrega_dias} días` : ''],
        ]),
      },
      {
        titulo: 'Resumen',
        filas: filtrar([
          ['Ofertas recibidas', d?.resumen?.total_ofertas_recibidas],
          ['Motivo cancelación', d?.motivos?.motivo_cancelacion],
          ['Motivo desierta', d?.motivos?.motivo_desierta],
        ]),
      },
    ].filter((s) => s.filas.length > 0);

    return {
      fuente: 'API Compra Ágil v2',
      codigo: d?.codigo || cod,
      nombre: d?.nombre || '',
      descripcion: d?.descripcion || '',
      estado: d?.estado?.glosa || estadoCod || 'Sin estado',
      tono,
      chips: [
        d?.convocatoria?.descripcion,
        ocEmitida ? `OC emitida · id ${d.orden_compra.id_orden_compra}` : 'Sin OC emitida',
      ].filter(Boolean),
      secciones,
      productos: (d?.productos_solicitados || []).map((p: any) => ({
        codigo: p?.codigo_producto ?? '',
        nombre: p?.nombre || '',
        descripcion: p?.descripcion || '',
        cantidad: p?.cantidad ?? '',
        unidad: p?.unidad_medida || '',
        adjudicacion: null,
      })),
      url_acta: null,
    };
  }

  // ── Licitaciones LE/LP/LQ/LR (API v1) ───────────────────────────────────
  private async fichaLicitacion(cod: string, ticket: string) {
    const { res, json } = await this.mpFetch(
      `https://api.mercadopublico.cl/servicios/v1/publico/licitaciones.json?codigo=${encodeURIComponent(cod)}&ticket=${encodeURIComponent(ticket)}`,
    );
    if (!res.ok || !json) {
      throw new BadRequestException(
        `Mercado Público respondió ${res.status}: ${String(json?.Mensaje || json?.mensaje || 'error desconocido.').slice(0, 160)}`,
      );
    }
    const l: any = json?.Listado?.[0];
    if (!l) {
      throw new NotFoundException(
        `Mercado Público no encontró una licitación con el código ${cod}.`,
      );
    }
    const f = LicitacionesService.fmtFechaMP;
    const fe = l?.Fechas || {};
    const comprador = l?.Comprador || {};
    const codigoEstado = Number(l?.CodigoEstado);
    // Estados API v1: 5 publicada, 6 cerrada, 7 desierta, 8 adjudicada,
    // 18 revocada, 19 suspendida.
    const tono = codigoEstado === 5 ? 'green'
      : codigoEstado === 8 ? 'blue'
      : codigoEstado === 6 ? 'amber'
      : [7, 18, 19].includes(codigoEstado) ? 'red' : 'gray';
    const filtrar = (filas: any[][]) => filas.filter(([, v]) => String(v ?? '').trim() !== '');

    const secciones = [
      {
        titulo: 'Organismo demandante',
        filas: filtrar([
          ['Razón social', comprador?.NombreOrganismo],
          ['Unidad de compra', comprador?.NombreUnidad],
          ['RUT', comprador?.RutUnidad],
          ['Dirección', comprador?.DireccionUnidad],
          ['Comuna', comprador?.ComunaUnidad],
          ['Región', comprador?.RegionUnidad],
        ]),
      },
      {
        titulo: 'Etapas y plazos',
        filas: filtrar([
          ['Publicación', f(fe?.FechaPublicacion)],
          ['Cierre recepción de ofertas', f(fe?.FechaCierre)],
          ['Inicio de preguntas', f(fe?.FechaInicio)],
          ['Fin de preguntas', f(fe?.FechaFinal)],
          ['Publicación de respuestas', f(fe?.FechaPubRespuestas)],
          ['Apertura técnica', f(fe?.FechaActoAperturaTecnica)],
          ['Apertura económica', f(fe?.FechaActoAperturaEconomica)],
          ['Adjudicación', f(fe?.FechaAdjudicacion)],
          ['Adjudicación (estimada)', f(fe?.FechaEstimadaAdjudicacion)],
          ['Firma de contrato (estimada)', f(fe?.FechaEstimadaFirma)],
        ]),
      },
      {
        titulo: 'Montos y contrato',
        filas: filtrar([
          ['Monto estimado', LicitacionesService.fmtMontoMP(l?.MontoEstimado, l?.Moneda)],
          ['Fuente de financiamiento', l?.FuenteFinanciamiento],
          ['Duración del contrato', l?.TiempoDuracionContrato],
          ['Responsable de pago', [l?.NombreResponsablePago, l?.EmailResponsablePago].filter(Boolean).join(' · ')],
          ['Responsable del contrato', [l?.NombreResponsableContrato, l?.EmailResponsableContrato, l?.FonoResponsableContrato].filter(Boolean).join(' · ')],
        ]),
      },
      ...(l?.Adjudicacion ? [{
        titulo: 'Adjudicación',
        filas: filtrar([
          ['Fecha', f(l.Adjudicacion?.Fecha)],
          ['N° de oferentes', l.Adjudicacion?.NumeroOferentes],
          ['N° resolución', l.Adjudicacion?.Numero],
        ]),
      }] : []),
    ].filter((s) => s.filas.length > 0);

    const items: any[] = l?.Items?.Listado || [];
    return {
      fuente: 'API Licitaciones v1',
      codigo: l?.CodigoExterno || cod,
      nombre: l?.Nombre || '',
      descripcion: l?.Descripcion || '',
      estado: l?.Estado || (codigoEstado ? `Estado ${codigoEstado}` : 'Sin estado'),
      tono,
      chips: [
        l?.Tipo ? `Tipo ${l.Tipo}` : null,
        l?.CantidadReclamos != null ? `${l.CantidadReclamos} reclamos del organismo` : null,
      ].filter(Boolean),
      secciones,
      productos: items.map((it: any) => ({
        codigo: it?.CodigoProducto ?? '',
        nombre: it?.NombreProducto || it?.Categoria || '',
        descripcion: it?.Descripcion || '',
        cantidad: it?.Cantidad ?? '',
        unidad: it?.UnidadMedida || '',
        adjudicacion: it?.Adjudicacion
          ? [
              it.Adjudicacion?.NombreProveedor,
              it.Adjudicacion?.CantidadAdjudicada != null ? `${it.Adjudicacion.CantidadAdjudicada} adjudicadas` : null,
              LicitacionesService.fmtMontoMP(it.Adjudicacion?.MontoUnitario) ? `${LicitacionesService.fmtMontoMP(it.Adjudicacion.MontoUnitario)} c/u` : null,
            ].filter(Boolean).join(' · ')
          : null,
      })),
      url_acta: l?.Adjudicacion?.UrlActa || null,
    };
  }

  // Marca / desmarca una postulación como "No Aplica" (descartada por el equipo).
  async noAplicaDisponible(id: number, email: string, noAplica: boolean) {
    const correo = (email || '').trim().toLowerCase();
    const patch = noAplica
      ? { no_aplica: true, no_aplica_por: correo, no_aplica_at: new Date().toISOString() }
      : { no_aplica: false, no_aplica_por: null, no_aplica_at: null };
    const { data, error } = await this.supabase.getClient()
      .from('licitaciones_disponibles')
      .update(patch)
      .eq('id', id)
      .select()
      .single();
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

  // Cotizaciones hijas (alternativas por equivalencias) de una madre.
  async getHijas(madreId: number) {
    const { data, error } = await this.supabase.getClient()
      .from('licitaciones')
      .select('id,id_licitacion,estado,fecha,creado_por')
      .eq('madre_id', madreId)
      .order('id', { ascending: true });
    if (error) {
      // madre_id aún no migrado: sin hijas.
      return [];
    }
    return data || [];
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
    if (msg.includes('sucursal')) { delete bodyWithout.sucursal; removed = true; }
    if (msg.includes('jerarquia')) { delete bodyWithout.jerarquia; removed = true; }
    if (msg.includes('madre_id')) { delete bodyWithout.madre_id; removed = true; }
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

  /* Al escribir ítems se toleran columnas aún sin migrar (ej. `costo`,
     20260813): se quita la columna del payload y se reintenta, para que
     guardar una cotización no dependa de que la migración ya esté aplicada.
     El dato omitido se pierde solo hasta que se aplique la migración. */
  private async escribirItemsTolerante<T>(
    ejecutar: (items: any[]) => Promise<{ data: T; error: any }>,
    items: any[],
  ): Promise<T> {
    let payloads = items.map((it) => ({ ...it }));
    let { data, error } = await ejecutar(payloads);
    let intentos = 0;
    while (error && intentos < 5) {
      const col = this.columnaFaltante(error);
      if (!col || !payloads.some((p) => col in p)) break;
      payloads = payloads.map((p) => {
        const { [col]: _omitida, ...resto } = p;
        return resto;
      });
      ({ data, error } = await ejecutar(payloads));
      intentos++;
    }
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async upsertItems(items: any[]) {
    return this.escribirItemsTolerante(
      async (pl) => this.supabase.getClient().from('items_licitacion').upsert(pl).select(),
      items,
    );
  }

  async insertItems(items: any[]) {
    return this.escribirItemsTolerante(
      async (pl) => this.supabase.getClient().from('items_licitacion').insert(pl).select(),
      items,
    );
  }

  async updateItem(itemId: number, body: Record<string, any>) {
    return this.escribirItemsTolerante(
      async (pl) =>
        this.supabase.getClient().from('items_licitacion').update(pl[0]).eq('id', itemId).select().single(),
      [body],
    );
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

  /* ── Palabras clave y búsquedas guardadas de Explorar Mercado Público ────
     El catálogo vivía como constante en el frontend: agregar un término exigía
     desplegar. Ahora se administra desde la pantalla.
  */
  private faltaMigracionMp(error: any) {
    const msg = String(error?.message || '');
    return /mp_keywords|mp_busquedas|does not exist|schema cache/i.test(msg)
      ? 'Falta aplicar la migración 20260810_mp_keywords_busquedas.sql en Supabase.'
      : msg;
  }

  async listarKeywordsMp() {
    const client = this.supabase.getClient();
    const [kw, bus] = await Promise.all([
      client.from('mp_keywords').select('*').eq('activa', true).order('texto', { ascending: true }),
      client.from('mp_busquedas').select('*').order('nombre', { ascending: true }),
    ]);
    if (kw.error) throw new BadRequestException(this.faltaMigracionMp(kw.error));
    if (bus.error) throw new BadRequestException(this.faltaMigracionMp(bus.error));
    return { keywords: kw.data || [], busquedas: bus.data || [] };
  }

  /* ── Exploración automática ─────────────────────────────────────────────
     La búsqueda completa consulta ~90 términos (~4 min de API y otra tanta
     cuota), así que ejecutarla a demanda quedó restringido y el resultado se
     genera solo dos veces al día y se guarda en `mp_exploracion` (una fila).
     Abrir la pestaña «Explorar» lee esa fila: instantáneo y sin gastar cuota. */

  /** Quiénes pueden lanzar la búsqueda manual (consume cuota de la API). */
  static exploradoresMp(): string[] {
    return String(process.env.MP_EXPLORAR_EMAILS || 'beroiza.ariel@gmail.com')
      .toLowerCase()
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }

  /** Última exploración guardada (o null si nunca ha corrido). */
  async exploracionGuardada() {
    const { data, error } = await this.supabase.getClient()
      .from('mp_exploracion')
      .select('resultado, actualizado_at, motivo')
      .eq('id', 1)
      .maybeSingle();
    if (error) {
      if (/does not exist|schema cache/i.test(error.message)) {
        throw new BadRequestException('Falta aplicar la migración 20260812_mp_exploracion.sql en Supabase.');
      }
      throw new BadRequestException(error.message);
    }
    if (!data) return null;
    return { ...(data.resultado as any), actualizado_at: data.actualizado_at, motivo: data.motivo };
  }

  /** Corre la búsqueda con TODO el catálogo activo y guarda el resultado. */
  async explorarYGuardar(motivo: string) {
    const client = this.supabase.getClient();
    const { data: kws, error } = await client
      .from('mp_keywords')
      .select('texto')
      .eq('activa', true)
      .order('texto', { ascending: true });
    if (error) throw new BadRequestException(this.faltaMigracionMp(error));
    const palabras = (kws || []).map((k: any) => String(k.texto || '').trim()).filter(Boolean);
    if (!palabras.length) return { guardado: false, motivo: 'catálogo de palabras clave vacío' };

    // Mismos parámetros con que explora la pantalla: ambas fuentes y solo
    // procesos publicados (los demás no se pueden postular).
    const resultado = await this.mercadoPublicoBuscar({
      q: palabras.join(','),
      fuente: 'todas',
      estado: 'publicada',
    });

    const { error: errUp } = await client
      .from('mp_exploracion')
      .upsert([{ id: 1, resultado, actualizado_at: new Date().toISOString(), motivo }]);
    if (errUp) {
      if (/does not exist|schema cache/i.test(errUp.message)) {
        throw new BadRequestException('Falta aplicar la migración 20260812_mp_exploracion.sql en Supabase.');
      }
      throw new BadRequestException(errUp.message);
    }
    return {
      guardado: true,
      items: (resultado?.items || []).length,
      palabras: palabras.length,
    };
  }

  async crearKeywordMp(texto: string, email: string) {
    const limpio = String(texto || '').trim().slice(0, 120);
    if (!limpio) throw new BadRequestException('La palabra clave no puede ir vacía.');
    const { data, error } = await this.supabase.getClient()
      .from('mp_keywords')
      .insert([{ texto: limpio, creada_por: email || null }])
      .select()
      .single();
    if (error) {
      // El índice único es sobre lower(texto): avisar en vez de fallar feo.
      if (/duplicate|unique/i.test(error.message)) {
        throw new BadRequestException(`"${limpio}" ya está en el catálogo.`);
      }
      throw new BadRequestException(this.faltaMigracionMp(error));
    }
    return data;
  }

  async eliminarKeywordMp(id: number) {
    const { error } = await this.supabase.getClient().from('mp_keywords').delete().eq('id', id);
    if (error) throw new BadRequestException(this.faltaMigracionMp(error));
    return { eliminada: true };
  }

  async guardarBusquedaMp(nombre: string, keywords: string[], email: string) {
    const limpio = String(nombre || '').trim().slice(0, 80);
    if (!limpio) throw new BadRequestException('Ponle un nombre a la búsqueda.');
    const kws = (Array.isArray(keywords) ? keywords : [])
      .map((k) => String(k || '').trim())
      .filter(Boolean)
      .slice(0, 8); // mismo tope que la API
    if (!kws.length) throw new BadRequestException('Elige al menos una palabra clave.');
    // Upsert por nombre: volver a guardar con el mismo nombre la actualiza.
    const { data, error } = await this.supabase.getClient()
      .from('mp_busquedas')
      .upsert([{ nombre: limpio, keywords: kws, creada_por: email || null }], { onConflict: 'nombre' })
      .select()
      .single();
    if (error) throw new BadRequestException(this.faltaMigracionMp(error));
    return data;
  }

  async eliminarBusquedaMp(id: number) {
    const { error } = await this.supabase.getClient().from('mp_busquedas').delete().eq('id', id);
    if (error) throw new BadRequestException(this.faltaMigracionMp(error));
    return { eliminada: true };
  }
}
