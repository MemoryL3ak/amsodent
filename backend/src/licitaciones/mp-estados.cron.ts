import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { LicitacionesService } from './licitaciones.service';
import { MpExploracionCron } from './mp-exploracion.cron';
import { MpOrdenesService } from './mp-ordenes.service';
import { MpAdjudicacionesService } from './mp-adjudicaciones.service';

/* ============================================================================
   Cambio automático de estado según Mercado Público (pedido 2026-09-17)
   ----------------------------------------------------------------------------
   Dos veces al día (9:00 y 15:00 de Chile) revisa las cotizaciones con
   código de Mercado Público que siguen abiertas en el sistema y, cuando
   ChileCompra ya publicó un desenlace CONCLUYENTE, aplica el cambio solo:

     · Adjudicada a nuestro RUT      → Adjudicada (con fecha_adjudicada)
     · Adjudicada a otro proveedor   → Perdida
     · Desierta / Revocada           → Descartada

   Cada cambio deja su registro en el historial de la cotización (vía
   aplicarEstadoMp) y una notificación en la campanita del dueño de la
   cotización. Los procesos sin desenlace o que la API no publica se dejan
   tal cual; los errores (cuota del ticket, timeouts de MP) se reintentan
   solos en la siguiente pasada porque la cotización sigue abierta.

   El diagnóstico manual de Análisis Mercado Público sigue existiendo para
   revisar a demanda; este cron usa exactamente el mismo motor.

   Interruptores:
     MP_ESTADOS_AUTO=off   → apagado (ej. backend local de desarrollo)
     MP_ESTADOS_HORAS=9,15 → horas de Chile en que corre
     MP_ESTADOS_LOTE=120   → cuántas se consultan por tanda
     MP_ESTADOS_MAX=0      → tope de cotizaciones por pasada; 0 = todas

   Cada pasada recorre TODAS las cotizaciones abiertas con código de Mercado
   Público, en tandas, y al final reintenta las que la API dejó sin responder
   —la v2 de Compra Ágil devuelve 504 con frecuencia—. Si se agota la cuota
   diaria del ticket, corta y sigue en la pasada siguiente.
============================================================================ */

const ZONA = 'America/Santiago';

const HORAS = String(process.env.MP_ESTADOS_HORAS || '9,15')
  .split(',')
  .map((h) => Number(String(h).trim()))
  .filter((h) => Number.isInteger(h) && h >= 0 && h <= 23);

/* Tamano de cada tanda de consultas. No es un tope: la pasada recorre TODAS
   las candidatas en tandas de este tamano. */
/* (2026-10-15) 24 y no 120: la tanda es la unidad en que la pasada puede
   reaccionar (cortar si la API está caída, parar si se acabó la cuota). A
   30 s por consulta fallida, una tanda de 120 eran 60 minutos a ciegas. */
const LOTE = Math.max(5, Math.min(500, Number(process.env.MP_ESTADOS_LOTE || process.env.MP_ESTADOS_LIMITE) || 24));

/* (2026-10-15) Candidatas "recientes": cerraron en Mercado Público hace menos
   de 45 días (o siguen abiertas). Son las que pueden cambiar y se consultan
   TODAS en cada pasada. Las antiguas se recorren en círculo, de a
   MP_ESTADOS_ANTIGUAS por pasada. */
const RECIENTE_MS = 45 * 864e5;
const ANTIGUAS_POR_PASADA = Math.max(0, Math.trunc(Number(process.env.MP_ESTADOS_ANTIGUAS) || 120));

/* Tope de cotizaciones por pasada. 0 = sin tope, que es lo correcto: si una
   cotizacion sigue abierta hay que preguntar por ella. Existe solo por si la
   cuota del ticket resulta mas chica de lo que aguanta esto y hay que frenarlo
   en caliente desde Railway, sin desplegar. */
const MAX_POR_PASADA = Math.max(0, Math.trunc(Number(process.env.MP_ESTADOS_MAX) || 0));

@Injectable()
export class MpEstadosCron implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('MpEstadosCron');
  private timer: NodeJS.Timeout | null = null;
  private corriendo = false;
  private ultima = '';
  /* Desde dónde arranca la próxima pasada. Solo importa cuando una pasada se
     corta a la mitad porque se agotó la cuota del ticket: sin esto la
     siguiente volvería a empezar por las mismas y las del final no se
     revisarían nunca — que es exactamente el defecto que este cron tenía. El
     valor inicial depende del día para que un reinicio del servidor tampoco
     deje siempre fuera a las mismas. */
  private cursor = Math.floor(Date.now() / (12 * 3600_000));

  constructor(
    private readonly supabase: SupabaseService,
    private readonly licitaciones: LicitacionesService,
    private readonly exploracion: MpExploracionCron,
    private readonly ordenes: MpOrdenesService,
    private readonly adjudicaciones: MpAdjudicacionesService,
  ) {}

  /* (2026-10-02) A las 15:00 esta pasada comparte hora con la exploración de
     oportunidades. Juntas serían 12 + 6 conexiones contra una API que colapsa
     cerca de 24, así que una espera a la otra. Cede esta: la exploración dura
     ~4 minutos y su listado es lo que el equipo espera ver a las 15:00; que
     los estados se actualicen unos minutos después no cambia nada. */
  private async cederPasoALaExploracion(hora: number) {
    const exp = this.exploracion.estado();
    if (!exp.activa || !exp.horarios.includes(`${String(hora).padStart(2, '0')}:00`)) return;
    const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));
    // Los dos crones despiertan en el mismo minuto: se le da tiempo a la
    // exploración para que alcance a marcarse como corriendo.
    await espera(100_000);
    const tope = Date.now() + 30 * 60_000;
    while (this.exploracion.estado().corriendo && Date.now() < tope) await espera(30_000);
    if (this.exploracion.estado().corriendo) {
      this.log.warn('La exploración lleva 30 min corriendo; el cambio de estados parte igual.');
    }
  }

  onModuleInit() {
    if (String(process.env.MP_ESTADOS_AUTO || '').toLowerCase() === 'off') {
      this.log.log('Cambio automático de estados MP DESACTIVADO (MP_ESTADOS_AUTO=off).');
      return;
    }
    if (!HORAS.length) {
      this.log.warn('MP_ESTADOS_HORAS sin horas válidas: no se programó el cambio automático de estados.');
      return;
    }
    this.log.log(
      `Cambio automático de estados MP activo: ${HORAS.map((h) => `${String(h).padStart(2, '0')}:00`).join(' y ')} (${ZONA}), 
` +
      `tandas de ${LOTE}, ${MAX_POR_PASADA ? `tope ${MAX_POR_PASADA} por pasada` : 'sin tope (todas las abiertas)'}.`,
    );
    this.timer = setInterval(() => void this.revisar(), 60_000);
    this.timer.unref?.();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private ahoraEnChile() {
    const partes = new Intl.DateTimeFormat('en-CA', {
      timeZone: ZONA,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(new Date());
    const v = (t: string) => partes.find((p) => p.type === t)?.value || '';
    return { fecha: `${v('year')}-${v('month')}-${v('day')}`, hora: Number(v('hour')), minuto: Number(v('minute')) };
  }

  private async revisar() {
    if (this.corriendo) return;
    const { fecha, hora, minuto } = this.ahoraEnChile();
    if (!HORAS.includes(hora)) return;
    if (minuto > 4) return;
    const marca = `${fecha}@${hora}`;
    if (this.ultima === marca) return;
    this.ultima = marca;
    this.corriendo = true;
    try {
      await this.cederPasoALaExploracion(hora);
      await this.correr();
    } catch (e: any) {
      this.log.warn(`Pasada fallida: ${String(e?.message || e).slice(0, 160)}`);
    } finally {
      this.corriendo = false;
    }
  }

  /** Una pasada: recorre TODAS las candidatas en tandas, aplica lo concluyente
      de cada tanda y al final reintenta las que la API dejó sin responder. */
  async correr() {
    /* Primero la lista de candidatas (sin gastar consultas a Mercado Público) y
       después se recorren ESOS ids. Paginar por posición no sirve: cada
       cotización que se cierra durante la pasada sale del filtro de "abiertas"
       y corre la lista, con lo que se saltarían filas. */
    const lista = await this.licitaciones.diagnosticoMpCotizaciones({ soloCandidatas: true });
    const todas: number[] = ((lista as any).ids || []).slice();
    const objetivo = MAX_POR_PASADA ? todas.slice(0, MAX_POR_PASADA) : todas;
    if (!objetivo.length) {
      this.log.log('No hay cotizaciones abiertas con código de Mercado Público.');
      return { revisadas: 0, candidatas: 0, aplicados: 0, con_error: 0, cuota_agotada: false };
    }
    /* Primero lo que se resuelve con evidencia propia: una cotización con
       orden de compra cargada ya está ganada, sin preguntarle a nadie. Lo que
       se cierra acá no se consulta después. */
    const porOc = await this.adjudicarPorOrdenDeCompra(objetivo);
    const resueltosPorOc = new Set(porOc.ids);
    /* (2026-10-15) Segunda evidencia propia, y hoy la más confiable: las OC
       que Mercado Público emitió a nuestro código de proveedor (API v1, que
       responde en segundos). Adjudica sin esperar a la ficha de la Compra
       Ágil, cuya API pasa horas devolviendo 504. */
    let porOcMp: any = null;
    try {
      porOcMp = await this.ordenes.barrer({ dias: 5 });
    } catch (e: any) {
      this.log.warn(`Barrido de OC de Mercado Público fallido: ${String(e?.message || e).slice(0, 160)}`);
    }
    for (const a of porOcMp?.adjudicadas || []) resueltosPorOc.add(Number(a.licitacion_id));
    for (const d of porOcMp?.descartadas || []) resueltosPorOc.add(Number(d.id));
    /* (2026-10-15) Y el acumulado: procesos ya ganados con otras versiones
       todavía abiertas (madre o -2 "En espera" junto a la -1 adjudicada).
       Solo base de datos, no gasta API. */
    try {
      const limpieza = await this.adjudicaciones.limpiarVersionesAdjudicadas({ dias: 180 });
      for (const d of limpieza.descartadas) resueltosPorOc.add(Number(d.id));
      if (limpieza.descartadas.length) this.log.log(`Versiones no adjudicadas descartadas: ${limpieza.descartadas.length} en ${limpieza.procesos} proceso(s).`);
    } catch (e: any) {
      this.log.warn(`Limpieza de versiones fallida: ${String(e?.message || e).slice(0, 160)}`);
    }
    const pendientes = objetivo.filter((id) => !resueltosPorOc.has(id));
    if (!pendientes.length) {
      this.log.log(`Pasada completa: ${porOc.aplicados} adjudicada(s) por OC cargada, nada que consultar.`);
      return { revisadas: 0, candidatas: objetivo.length, aplicados: porOc.aplicados, con_error: 0, cuota_agotada: false };
    }

    /* (2026-10-15) Primero lo que puede haber cambiado: las que cerraron en
       Mercado Público hace poco, de la más reciente a la más antigua (las que
       aún no cierran y las sin fecha van al final de ese grupo). Las cerradas
       hace más de 45 días —la mayoría nunca tendrá un desenlace publicado— se
       recorren en círculo, de a ANTIGUAS_POR_PASADA, para que no se coman la
       pasada con una API que tarda 30 s en fallar. */
    const cierreDe = new Map<number, number>();
    for (const d of ((lista as any).detalle || []) as Array<{ id: number; cierre: string | null }>) {
      cierreDe.set(Number(d.id), d?.cierre ? Date.parse(d.cierre) : NaN);
    }
    const ahora = Date.now();
    const cierre = (id: number) => cierreDe.get(id) ?? NaN;
    const clave = (id: number) => { const c = cierre(id); return !Number.isFinite(c) ? -2 : c > ahora ? -1 : c; };
    const esReciente = (id: number) => !Number.isFinite(cierre(id)) || ahora - cierre(id) < RECIENTE_MS;
    const recientes = pendientes.filter(esReciente).sort((a, b) => clave(b) - clave(a));
    const antiguas = pendientes.filter((id) => !esReciente(id)).sort((a, b) => clave(b) - clave(a));
    const inicio = antiguas.length ? this.cursor % antiguas.length : 0;
    const vueltaAntiguas = inicio ? [...antiguas.slice(inicio), ...antiguas.slice(0, inicio)] : antiguas;
    const orden = [...recientes, ...vueltaAntiguas.slice(0, ANTIGUAS_POR_PASADA)];
    this.log.log(
      `Pasada iniciada: ${orden.length} de ${pendientes.length} candidatas ` +
      `(${recientes.length} recientes + ${Math.min(antiguas.length, ANTIGUAS_POR_PASADA)} antiguas desde la posición ${inicio}) en tandas de ${LOTE}` +
      `${porOc.aplicados ? ` · ${porOc.aplicados} adjudicada(s) por OC cargada` : ''}` +
      `${porOcMp?.adjudicadas?.length ? ` · ${porOcMp.adjudicadas.length} por OC emitida en Mercado Público` : ''}.`,
    );

    let revisadas = 0;
    let aplicados = porOc.aplicados + (porOcMp?.adjudicadas?.length || 0);
    let conError = 0;
    let sinCuota = false;
    let apiCaida = false;
    let tandasSecas = 0;
    const fallidas: number[] = [];
    // El cursor recorre las ANTIGUAS: lo consumido de ellas en esta pasada.
    const avanzarCursor = (consumidas: number) => {
      const deAntiguas = Math.max(0, consumidas - recientes.length);
      this.cursor = antiguas.length ? (inicio + deAntiguas) % antiguas.length : 0;
    };

    for (let i = 0; i < orden.length; i += LOTE) {
      const ids = orden.slice(i, i + LOTE);
      const diag = await this.licitaciones.diagnosticoMpCotizaciones({ ids, limite: ids.length });
      revisadas += diag.revisadas;
      conError += diag.con_error;
      for (const f of (diag.filas || []) as any[]) {
        if (f.error && f.id) fallidas.push(f.id);
      }
      aplicados += await this.aplicarYNotificar(diag.filas || []);
      // Sin cuota del ticket no sirve seguir: la próxima pasada sigue desde acá.
      if ((diag.filas || []).some((f: any) => /cuota/i.test(String(f.error || '')))) {
        sinCuota = true;
        avanzarCursor(i + ids.length);
        break;
      }
      /* (2026-10-15) API caída: dos tandas seguidas sin UNA sola respuesta
         (la v2 de Compra Ágil pasa horas devolviendo 504). Seguir solo
         alargaría la pasada —a 30 s por consulta, 1.000 candidatas son 8
         horas— y bloquearía la siguiente. Se corta y se retoma más tarde. */
      tandasSecas = diag.revisadas > 0 && diag.con_error >= diag.revisadas ? tandasSecas + 1 : 0;
      if (tandasSecas >= 2) {
        apiCaida = true;
        avanzarCursor(i + ids.length);
        break;
      }
    }
    if (!sinCuota && !apiCaida) avanzarCursor(orden.length);

    /* Segunda vuelta para las que fallaron por culpa de la API (504, timeouts:
       la v2 de Compra Ágil los da a menudo). Sin esto, una cotización ya
       resuelta en ChileCompra se quedaba sin actualizar hasta la pasada
       siguiente por un error ajeno. No se hace con la API caída. */
    if (!sinCuota && !apiCaida && fallidas.length) {
      let rescatados = 0;
      let siguenFallando = 0;
      for (let i = 0; i < fallidas.length; i += LOTE) {
        const ids = fallidas.slice(i, i + LOTE);
        const reintento = await this.licitaciones.diagnosticoMpCotizaciones({ ids, limite: ids.length });
        siguenFallando += reintento.con_error;
        rescatados += await this.aplicarYNotificar(reintento.filas || []);
      }
      aplicados += rescatados;
      this.log.log(
        `Reintento de ${fallidas.length} sin respuesta: ${siguenFallando} volvieron a fallar · ${rescatados} cambio(s) rescatado(s).`,
      );
    }

    this.log.log(
      `Pasada ${sinCuota || apiCaida ? 'CORTADA' : 'completa'}: ${revisadas} de ${orden.length} consultadas · ` +
      `${aplicados} cambio(s) de estado · ${conError} sin respuesta de Mercado Público` +
      `${sinCuota ? ` · CUOTA DIARIA AGOTADA, la próxima sigue desde la ${this.cursor}` : ''}` +
      `${apiCaida ? ' · API DE COMPRA ÁGIL CAÍDA: se retoma en la próxima pasada' : ''}.`,
    );
    return { revisadas, candidatas: objetivo.length, aplicados, con_error: conError, cuota_agotada: sinCuota, api_caida: apiCaida, oc_mercado_publico: porOcMp };
  }

  /* ── Adjudicadas por evidencia propia (2026-09-25) ───────────────────────
     Si a una cotización ya se le cargó una orden de compra, la ganamos. Es un
     hecho nuestro, no una opinión de ChileCompra: la OC está en la mano, con
     su número y su monto.

     Hasta ahora el cron solo sabía preguntarle a Mercado Público, y la API v2
     de Compra Ágil se cae seguido: 1463-326-COT26 devolvió 504 en seis
     intentos seguidos mientras su OC 1463-386-AG26 llevaba días cargada en
     Trazabilidad. Esperar a que conteste una API para reconocer algo que ya
     sabemos no tiene sentido.

     Corre ANTES del barrido y descuenta lo que resuelve, así además ahorra
     consultas. La fecha de adjudicación es la de la OC, no la de hoy: importa
     para las metas y para los reportes por período. */
  private async adjudicarPorOrdenDeCompra(candidatos: number[]): Promise<{ aplicados: number; ids: number[] }> {
    if (!candidatos.length) return { aplicados: 0, ids: [] };
    const client = this.supabase.getClient();

    // Primera OC de cada cotización, en tandas para no armar un IN gigante.
    const primeraOc = new Map<number, { numero: string; fecha: string | null }>();
    for (let i = 0; i < candidatos.length; i += 300) {
      const trozo = candidatos.slice(i, i + 300);
      const { data, error } = await client
        .from('licitacion_documentos')
        .select('licitacion_id, numero, fecha_oc, created_at')
        .eq('tipo', 'orden_compra')
        .in('licitacion_id', trozo)
        .order('id', { ascending: true });
      if (error) {
        this.log.warn(`No se pudieron leer las OC para adjudicar: ${error.message}`);
        return { aplicados: 0, ids: [] };
      }
      for (const d of data || []) {
        const lic = Number((d as any).licitacion_id);
        if (primeraOc.has(lic)) continue;
        const fecha = String((d as any).fecha_oc || (d as any).created_at || '').slice(0, 10);
        primeraOc.set(lic, {
          numero: String((d as any).numero || '').trim(),
          fecha: /^\d{4}-\d{2}-\d{2}$/.test(fecha) ? fecha : null,
        });
      }
    }
    if (!primeraOc.size) return { aplicados: 0, ids: [] };

    const cambios = [...primeraOc.entries()].map(([id, oc]) => ({
      id,
      estado: 'Adjudicada',
      fecha: oc.fecha,
    }));
    const r = await this.licitaciones.aplicarEstadoMp(
      { cambios },
      'automático (orden de compra cargada)',
    );
    if (r.errores.length) this.log.warn(`Errores al adjudicar por OC: ${r.errores.join(' · ')}`);

    // Mismo aviso que el resto de los cambios automáticos.
    await this.avisarCambios(
      r.ids.map((id) => ({
        id,
        sugerencia: 'Adjudicada',
        motivo: `Tiene cargada la orden de compra ${primeraOc.get(id)?.numero || ''}.`.trim(),
      })),
      r.ids,
    );

    this.log.log(`Adjudicadas por OC cargada: ${r.aplicados} de ${primeraOc.size} candidatas con orden de compra.`);
    return { aplicados: r.aplicados, ids: r.ids };
  }
  /** Aplica los desenlaces concluyentes de un lote y avisa a cada vendedor. */
  private async aplicarYNotificar(filas: any[]): Promise<number> {
    const aplicables = (filas || []).filter((f: any) => f.discrepancia && f.sugerencia && f.id);
    if (!aplicables.length) return 0;

    const r = await this.licitaciones.aplicarEstadoMp(
      { cambios: aplicables.map((f: any) => ({ id: f.id, estado: f.sugerencia })) },
      'automático (Mercado Público)',
    );
    if (r.errores.length) this.log.warn(`Errores al aplicar: ${r.errores.join(' · ')}`);
    await this.avisarCambios(aplicables, r.ids);
    return r.aplicados;
  }

  /** Notificación en la campanita al dueño de cada cotización cambiada. */
  private async avisarCambios(aplicables: any[], idsAplicados: number[]) {
    if (!idsAplicados.length) return;
    const client = this.supabase.getClient();
    const { data: duenos } = await client
      .from('licitaciones')
      .select('id, id_licitacion, nombre_entidad, vendedor_correo, creado_por')
      .in('id', idsAplicados);
    for (const f of aplicables) {
      if (!idsAplicados.includes(f.id)) continue;
      const lic = (duenos || []).find((l: any) => l.id === f.id);
      const destinatario = String(lic?.vendedor_correo || lic?.creado_por || '').trim().toLowerCase();
      if (!destinatario) continue;
      const { error } = await client.from('notificaciones').insert([{
        user_email: destinatario,
        tipo: 'mp_estado_auto',
        mensaje: `${lic?.id_licitacion || `#${f.id}`} (${lic?.nombre_entidad || 'cliente'}): estado actualizado automáticamente a "${f.sugerencia}". ${String(f.motivo || '').trim()}`,
        link: `/detalle/${f.id}`,
        metadata: { licitacion_id: f.id, estado: f.sugerencia, origen: 'mp_estados_cron' },
      }]);
      if (error) this.log.warn(`Sin notificación para #${f.id}: ${error.message}`);
    }
  }
}
