import { api } from "./api";

/* ============================================================
   Cola del robot de Mercado Público (2026-10-21)
   ------------------------------------------------------------
   Las pantallas ya no consultan Mercado Público dentro de la
   request: ENCOLAN trabajos (sincronizar, revisar estados,
   confirmar postulaciones) y el robot del backend (proceso
   worker) los procesa. Aquí está lo común para seguir el avance
   de un lote y para avisar cómo está el robot.
============================================================ */

/** Estado del robot + avance de un lote (o del lote activo más reciente,
 *  opcionalmente de un tipo: ficha | estado | postulacion). */
export function estadoCola(lote, tipo) {
  const qp = new URLSearchParams();
  if (lote) qp.set("lote", lote);
  if (tipo) qp.set("tipo", tipo);
  const qs = qp.toString();
  return api.get(`/mercado-publico/cola/estado${qs ? `?${qs}` : ""}`);
}

/** Los trabajos de un lote con su resultado (tablas de diagnóstico). */
export function trabajosDeLote(lote) {
  return api.get(`/mercado-publico/cola/lote/${encodeURIComponent(lote)}`);
}

/** Cancela lo pendiente de un lote (lo que ya está en curso termina solo). */
export function cancelarLote(lote) {
  return api.post("/mercado-publico/cola/cancelar", { lote });
}

/** ¿El lote terminó? (no queda nada pendiente ni en curso) */
export function loteTerminado(resumen) {
  if (!resumen?.lote) return true;
  return (Number(resumen.pendientes) || 0) + (Number(resumen.en_curso) || 0) === 0;
}

function esperar(ms, signal) {
  return new Promise((resolve) => {
    if (signal?.aborted) { resolve(); return; }
    const t = setTimeout(resolve, ms);
    signal?.addEventListener?.("abort", () => { clearTimeout(t); resolve(); }, { once: true });
  });
}

/** Sigue el avance de un lote hasta que termine (o hasta abortar el signal).
 *  `onTick(resumen, robot, estadoCompleto)` se llama en cada consulta.
 *  Devuelve el último estado leído. */
export async function seguirLote(lote, { onTick, intervaloMs = 4000, signal } = {}) {
  let ultimo = null;
  for (;;) {
    ultimo = await estadoCola(lote);
    try { onTick?.(ultimo?.lote, ultimo?.robot, ultimo); } catch (e) { console.error(e); }
    if (loteTerminado(ultimo?.lote) || signal?.aborted) return ultimo;
    await esperar(intervaloMs, signal);
    if (signal?.aborted) return ultimo;
  }
}

function hora(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit" });
}

/** Aviso para la pantalla cuando el robot no puede avanzar (o null si todo bien). */
export function avisoRobot(robot) {
  if (!robot) return null;
  if (!robot.activo) {
    return "El robot de Mercado Público no está activo: los trabajos quedan en cola y se procesarán cuando arranque.";
  }
  if (robot.cuota_agotada_hasta) {
    return `Cuota diaria de la API de Mercado Público agotada: el robot retoma mañana (${hora(robot.cuota_agotada_hasta)}).`;
  }
  if (robot.api_caida_hasta) {
    return `Mercado Público no está respondiendo: el robot reintenta a las ${hora(robot.api_caida_hasta)}.`;
  }
  return null;
}

/** Progreso normalizado de un lote para barras y textos. */
export function progresoDeLote(resumen, inicioMs) {
  const total = Number(resumen?.total) || 0;
  const hechos = Number(resumen?.hechos) || 0;
  const errores = Number(resumen?.errores) || 0;
  const cancelados = Number(resumen?.cancelados) || 0;
  const hechas = hechos + errores + cancelados;
  const restantes = Math.max(0, total - hechas);
  const transcurrido = inicioMs ? Math.max(0, Date.now() - inicioMs) : 0;
  // Hace falta una muestra mínima para estimar: con 1 ficha en 3 minutos la
  // regla de tres da «quedan 11 h», una cifra tan precisa como inventada.
  const MUESTRA_MINIMA = 10;
  const etaMs = hechos >= MUESTRA_MINIMA && transcurrido > 0 ? (transcurrido / hechas) * restantes : null;
  return {
    total,
    hechas,
    restantes,
    etaMs,
    transcurrido,
    guardadas: Number(resumen?.guardadas) || 0,
    finalizadas: Number(resumen?.finalizadas) || 0,
    errores,
    cancelados,
    sinRespuesta: Number(resumen?.sin_respuesta) || 0,
    conPostulacion: Number(resumen?.con_postulacion) || 0,
    sinDato: Number(resumen?.sin_dato) || 0,
    conDiscrepancia: Number(resumen?.con_discrepancia) || 0,
  };
}
