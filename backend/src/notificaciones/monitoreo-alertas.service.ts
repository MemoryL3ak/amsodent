import { BadRequestException, Injectable } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

/* ── Monitoreo de alertas (2026-10-07) ───────────────────────────────────────
   Pedido de Ariel: "generar un módulo para monitorear las alertas que recibe
   cada vendedor y el cumplimiento de cada alerta".
   Las alertas son las notificaciones de la campana (tabla `notificaciones`:
   user_email, tipo, mensaje, link, metadata, leida_at, creado_at). La tabla no
   guarda si se cumplió: se evalúa contra el dato de negocio que la resuelve.
     · cierre_proximo → la cotización quedó postulada (si el cierre pasó sin
       postular: incumplida).
     · resultados_publicados → la cotización tiene resultado (Adjudicada,
       Perdida, Descartada, Cancelada o Desierta).
     · aprobacion_peso → ya no está «Pendiente Aprobación Peso».
     · equivalencias_pendientes → cada cotización tiene su alternativa (hija) o
       ya tiene resultado.
     · cobranza_accion → cada factura quedó pagada o tiene una gestión de
       cobranza registrada después del aviso.
     · factoring_por_vencer / factoring_vencido / factura_vencida → factura pagada.
     · oc_agradecimiento / guia_despacho_enviar / info_despacho_agradecimiento →
       el correo se envió (el aviso se marca leído al enviarlo; también si se
       descartó, por eso dice «enviado o descartado»).
     · el resto (mp_estado_auto, mp_adjudicada, cotizacion_aprobada, chat,
       portal…) son informativas: solo cuenta si se leyó.
   Estados: cumplida · pendiente · incumplida · informativa. */

export type EstadoAlerta = 'cumplida' | 'pendiente' | 'incumplida' | 'informativa';
const CERRADOS = ['adjudicada', 'perdida', 'descartada', 'cancelada', 'desierta'];
const TIPOS_CORREO = ['oc_agradecimiento', 'guia_despacho_enviar', 'info_despacho_agradecimiento', 'factura_enviar'];
const TIPOS_FACTURA = ['factoring_por_vencer', 'factoring_vencido', 'factura_vencida'];
const MAX_DIAS = 366;

const num = (v: any) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : null);

@Injectable()
export class MonitoreoAlertasService {
  constructor(private supabase: SupabaseService) {}

  private async todas(tabla: string, columnas: string, filtro: (q: any) => any) {
    const db = this.supabase.getClient();
    const out: any[] = [];
    for (let desde = 0; desde < 100000; desde += 1000) {
      const { data, error } = await filtro(db.from(tabla).select(columnas)).range(desde, desde + 999);
      if (error) throw new BadRequestException(`${tabla}: ${error.message}`);
      out.push(...(data || []));
      if (!data || data.length < 1000) break;
    }
    return out;
  }

  private async porIds(tabla: string, columnas: string, campo: string, ids: (number | string)[]) {
    const db = this.supabase.getClient();
    const out: any[] = [];
    const unicos = [...new Set(ids)];
    for (let i = 0; i < unicos.length; i += 300) {
      const { data, error } = await db.from(tabla).select(columnas).in(campo, unicos.slice(i, i + 300));
      if (error) {
        // Tablas opcionales (p. ej. cobranza_gestiones): sin ellas se evalúa con lo demás.
        if (/does not exist|schema cache/i.test(error.message)) return out;
        throw new BadRequestException(`${tabla}: ${error.message}`);
      }
      out.push(...(data || []));
    }
    return out;
  }

  async monitoreo(q: { desde?: string; hasta?: string }) {
    const hoy = new Date();
    const hasta = /^\d{4}-\d{2}-\d{2}$/.test(String(q?.hasta || '')) ? String(q.hasta) : hoy.toISOString().slice(0, 10);
    const desde = /^\d{4}-\d{2}-\d{2}$/.test(String(q?.desde || '')) ? String(q.desde) : new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
    if (desde > hasta) throw new BadRequestException('La fecha de inicio no puede ser posterior a la de término.');
    if ((Date.parse(hasta) - Date.parse(desde)) / 864e5 > MAX_DIAS) throw new BadRequestException('El período no puede ser mayor a un año.');

    const notifs = await this.todas('notificaciones', 'id, user_email, tipo, mensaje, link, metadata, leida_at, creado_at',
      (x) => x.gte('creado_at', `${desde}T00:00:00`).lte('creado_at', `${hasta}T23:59:59.999`).order('creado_at', { ascending: false }));

    // Qué hay que mirar para decidir el cumplimiento.
    const licIds: number[] = [];
    const facturaIds: number[] = [];
    for (const n of notifs) {
      const m = n.metadata || {};
      if (num(m.licitacion_id)) licIds.push(num(m.licitacion_id) as number);
      for (const id of Array.isArray(m.licitacion_ids) ? m.licitacion_ids : []) if (num(id)) licIds.push(Number(id));
      for (const it of Array.isArray(m.items) ? m.items : []) {
        if (num(it?.factura_id)) facturaIds.push(Number(it.factura_id));
        if (num(it?.licitacion_id)) licIds.push(Number(it.licitacion_id));
      }
      if (TIPOS_FACTURA.includes(n.tipo) && num(m.documento_id)) facturaIds.push(Number(m.documento_id));
    }
    const lics = new Map<number, any>();
    for (const l of await this.porIds('licitaciones', 'id, id_licitacion, nombre_entidad, estado, postulada, fecha_hora_cierre', 'id', licIds)) lics.set(Number(l.id), l);
    const conHija = new Set<number>();
    for (const h of await this.porIds('licitaciones', 'id, madre_id', 'madre_id', [...new Set(notifs.filter((n) => n.tipo === 'equivalencias_pendientes').flatMap((n) => (n.metadata?.licitacion_ids || []).map(Number)))])) {
      conHija.add(Number(h.madre_id));
    }
    const facturas = new Map<number, any>();
    for (const f of await this.porIds('licitacion_documentos', 'id, pagada, fecha_pago', 'id', facturaIds)) facturas.set(Number(f.id), f);
    const gestiones = new Map<string, string[]>();
    for (const g of await this.porIds('cobranza_gestiones', 'documento_id, created_at', 'documento_id', facturaIds.map(String))) {
      const k = String(g.documento_id);
      if (!gestiones.has(k)) gestiones.set(k, []);
      (gestiones.get(k) as string[]).push(String(g.created_at || ''));
    }
    const perfiles = new Map<string, any>();
    for (const p of await this.todas('profiles', 'email, nombre, rol', (x) => x)) if (p.email) perfiles.set(String(p.email).toLowerCase(), p);

    const ahora = Date.now();
    const evaluar = (n: any): { estado: EstadoAlerta; detalle: string } => {
      const m = n.metadata || {};
      const lic = lics.get(Number(m.licitacion_id));
      const estadoLic = String(lic?.estado || '').trim();
      switch (n.tipo) {
        case 'cierre_proximo':
          if (!lic) return { estado: 'pendiente', detalle: 'La cotización ya no existe.' };
          if (lic.postulada) return { estado: 'cumplida', detalle: 'Postulada.' };
          if (CERRADOS.includes(estadoLic.toLowerCase())) return { estado: 'cumplida', detalle: `Cerrada: ${estadoLic}.` };
          if (lic.fecha_hora_cierre && Date.parse(lic.fecha_hora_cierre) < ahora) return { estado: 'incumplida', detalle: 'Cerró sin marcarse postulada.' };
          return { estado: 'pendiente', detalle: 'Aún no se marca postulada.' };
        case 'resultados_publicados':
          if (!lic) return { estado: 'pendiente', detalle: 'La cotización ya no existe.' };
          return CERRADOS.includes(estadoLic.toLowerCase())
            ? { estado: 'cumplida', detalle: `Resultado registrado: ${estadoLic}.` }
            : { estado: 'pendiente', detalle: `Sigue «${estadoLic || 'sin estado'}»: falta registrar el resultado.` };
        case 'aprobacion_peso':
          if (!lic) return { estado: 'pendiente', detalle: 'La cotización ya no existe.' };
          return /pendiente aprobaci[oó]n peso/i.test(estadoLic)
            ? { estado: 'pendiente', detalle: 'Sigue «Pendiente Aprobación Peso».' }
            : { estado: 'cumplida', detalle: `Resuelta: ${estadoLic || 'sin estado'}.` };
        case 'equivalencias_pendientes': {
          const ids: number[] = (m.licitacion_ids || []).map(Number).filter(Boolean);
          if (!ids.length) return { estado: 'informativa', detalle: '' };
          const listas = ids.filter((id) => conHija.has(id) || CERRADOS.includes(String(lics.get(id)?.estado || '').toLowerCase()));
          return listas.length === ids.length
            ? { estado: 'cumplida', detalle: `Las ${ids.length} cotizaciones tienen alternativa o resultado.` }
            : { estado: 'pendiente', detalle: `${listas.length} de ${ids.length} cotizaciones con alternativa o resultado.` };
        }
        case 'cobranza_accion': {
          const items = Array.isArray(m.items) ? m.items : [];
          if (!items.length) return { estado: 'informativa', detalle: '' };
          const hechas = items.filter((it: any) => {
            const f = facturas.get(Number(it.factura_id));
            if (f?.pagada) return true;
            return (gestiones.get(String(it.factura_id)) || []).some((c) => c >= String(n.creado_at || ''));
          }).length;
          return hechas === items.length
            ? { estado: 'cumplida', detalle: `${items.length === 1 ? 'La factura quedó pagada o gestionada' : `Las ${items.length} facturas quedaron pagadas o gestionadas`}.` }
            : { estado: 'pendiente', detalle: `${hechas} de ${items.length} facturas pagadas o con gestión registrada después del aviso.` };
        }
        default:
          if (TIPOS_FACTURA.includes(n.tipo)) {
            const f = facturas.get(Number(m.documento_id));
            if (!f) return { estado: n.leida_at ? 'cumplida' : 'pendiente', detalle: n.leida_at ? 'Leída.' : 'Sin leer.' };
            return f.pagada ? { estado: 'cumplida', detalle: `Factura pagada${f.fecha_pago ? ` el ${String(f.fecha_pago).slice(0, 10)}` : ''}.` } : { estado: 'pendiente', detalle: 'La factura sigue impaga.' };
          }
          if (TIPOS_CORREO.includes(n.tipo)) {
            return n.leida_at ? { estado: 'cumplida', detalle: 'Correo enviado o descartado.' } : { estado: 'pendiente', detalle: 'Falta enviar el correo.' };
          }
          return { estado: 'informativa', detalle: n.leida_at ? 'Leída.' : 'Sin leer.' };
      }
    };

    const alertas = notifs.map((n) => {
      const e = evaluar(n);
      const email = String(n.user_email || '').toLowerCase();
      const lic = lics.get(Number(n.metadata?.licitacion_id));
      return {
        id: n.id, email, nombre: perfiles.get(email)?.nombre || null, rol: perfiles.get(email)?.rol || null,
        tipo: n.tipo, mensaje: n.mensaje, link: n.link || null, creado_at: n.creado_at, leida_at: n.leida_at,
        horas_lectura: n.leida_at ? Math.max(0, (Date.parse(n.leida_at) - Date.parse(n.creado_at)) / 36e5) : null,
        licitacion_id: num(n.metadata?.licitacion_id), cliente: lic?.nombre_entidad || null,
        estado: e.estado, detalle: e.detalle,
      };
    });

    const resumir = (lista: typeof alertas) => {
      const acc = lista.filter((a) => a.estado !== 'informativa');
      const leidas = lista.filter((a) => a.leida_at);
      const horas = leidas.map((a) => a.horas_lectura as number).sort((a, b) => a - b);
      return {
        total: lista.length,
        leidas: leidas.length,
        sin_leer: lista.length - leidas.length,
        accionables: acc.length,
        cumplidas: acc.filter((a) => a.estado === 'cumplida').length,
        pendientes: acc.filter((a) => a.estado === 'pendiente').length,
        incumplidas: acc.filter((a) => a.estado === 'incumplida').length,
        pct_cumplimiento: acc.length ? Math.round((acc.filter((a) => a.estado === 'cumplida').length / acc.length) * 1000) / 10 : null,
        pct_lectura: lista.length ? Math.round((leidas.length / lista.length) * 1000) / 10 : null,
        mediana_horas_lectura: horas.length ? Math.round(horas[Math.floor(horas.length / 2)] * 10) / 10 : null,
      };
    };
    const agrupar = (clave: (a: any) => string) => {
      const g = new Map<string, any[]>();
      for (const a of alertas) { const k = clave(a); if (!g.has(k)) g.set(k, []); (g.get(k) as any[]).push(a); }
      return g;
    };
    const porUsuario = [...agrupar((a) => a.email).entries()].map(([email, l]) => ({ email, nombre: l[0].nombre, rol: l[0].rol, ...resumir(l) }))
      .sort((a, b) => b.total - a.total);
    const porTipo = [...agrupar((a) => a.tipo).entries()].map(([tipo, l]) => ({ tipo, ...resumir(l) })).sort((a, b) => b.total - a.total);
    return { desde, hasta, resumen: resumir(alertas), por_usuario: porUsuario, por_tipo: porTipo, alertas: alertas.slice(0, 5000), truncadas: alertas.length > 5000 };
  }
}
