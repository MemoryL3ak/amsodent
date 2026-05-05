// Cálculo de días hábiles en Chile, omitiendo sábados, domingos y feriados.
//
// La lista canónica viene del backend (GET /feriados/:year), que a su vez
// consulta api.boostr.cl y cachea en la tabla `feriados`. Acá mantenemos
// un fallback hardcodeado por si la API y la DB están caídas el día que
// el usuario abre la app.

import { api } from "../lib/api";

// Fallback hardcodeado — sólo se usa si no se pudo cargar nada del backend.
const FALLBACK_FERIADOS = {
  2026: [
    "2026-01-01", "2026-04-03", "2026-04-04", "2026-05-01", "2026-05-21",
    "2026-06-21", "2026-06-29", "2026-07-16", "2026-08-15", "2026-09-18",
    "2026-09-19", "2026-10-12", "2026-10-31", "2026-11-01", "2026-12-08",
    "2026-12-25",
  ],
  2027: [
    "2027-01-01", "2027-03-26", "2027-03-27", "2027-05-01", "2027-05-21",
    "2027-06-21", "2027-06-28", "2027-07-16", "2027-08-15", "2027-09-17",
    "2027-09-18", "2027-09-19", "2027-10-11", "2027-10-31", "2027-11-01",
    "2027-12-08", "2027-12-25",
  ],
};

// Cache mutable: año → Set<YYYY-MM-DD>. Se hidrata desde la API al iniciar
// la app (cargarFeriadosParaAnios) y queda disponible para todos los
// componentes mientras la app esté abierta.
const feriadosPorAnio = new Map();

function setFeriadosParaAnio(year, fechas) {
  const set = new Set(
    (fechas || [])
      .map((f) => String(f).slice(0, 10))
      .filter((f) => /^\d{4}-\d{2}-\d{2}$/.test(f))
  );
  feriadosPorAnio.set(Number(year), set);
}

// Hidratar con el fallback de entrada — si después la API responde, la
// reemplaza con datos frescos.
Object.entries(FALLBACK_FERIADOS).forEach(([year, fechas]) => {
  setFeriadosParaAnio(Number(year), fechas);
});

function getFeriadosSetParaAnio(year) {
  return feriadosPorAnio.get(Number(year)) || new Set();
}

// Carga feriados desde el backend para los años indicados. Si el backend
// no responde, mantiene lo que ya estuviera en cache (fallback hardcodeado
// o lo último que respondió alguna vez).
export async function cargarFeriadosParaAnios(years) {
  const arr = Array.isArray(years) ? years : [years];
  const tareas = arr
    .filter((y) => Number.isFinite(Number(y)))
    .map(async (y) => {
      try {
        const resp = await api.get(`/feriados/${Number(y)}`);
        const lista = (resp?.feriados || []).map((row) => row?.fecha).filter(Boolean);
        if (lista.length > 0) setFeriadosParaAnio(y, lista);
      } catch {
        // Silencioso: si falla, ya tenemos el fallback.
      }
    });
  await Promise.all(tareas);
}

function toIsoDate(value) {
  if (!value) return "";
  if (typeof value === "string") {
    const m = value.match(/^(\d{4}-\d{2}-\d{2})/);
    if (m) return m[1];
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? "" : value.toISOString().slice(0, 10);
  }
  return "";
}

export function esDiaHabilCL(fechaIso) {
  const iso = toIsoDate(fechaIso);
  if (!iso) return false;
  const d = new Date(`${iso}T00:00:00Z`);
  const dow = d.getUTCDay(); // 0 = domingo, 6 = sábado
  if (dow === 0 || dow === 6) return false;
  const year = Number(iso.slice(0, 4));
  if (getFeriadosSetParaAnio(year).has(iso)) return false;
  return true;
}

// Suma `n` días hábiles a `fechaIso`. Devuelve la fecha resultante en formato YYYY-MM-DD.
// Si n=0 y la fecha base es hábil, devuelve la misma fecha; si no es hábil, salta al siguiente hábil.
export function sumarDiasHabilesCL(fechaIso, n) {
  const baseIso = toIsoDate(fechaIso);
  if (!baseIso) return "";
  const d = new Date(`${baseIso}T00:00:00Z`);
  let restantes = Math.max(0, Math.floor(Number(n || 0)));
  while (restantes > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (esDiaHabilCL(d)) restantes -= 1;
  }
  return d.toISOString().slice(0, 10);
}

// Cuenta los días hábiles transcurridos estrictamente entre `desdeIso` y `hastaIso` (sin incluir el inicio).
// Útil para saber cuántos hábiles ya pasaron desde la OC.
export function diasHabilesEntreCL(desdeIso, hastaIso) {
  const desde = toIsoDate(desdeIso);
  const hasta = toIsoDate(hastaIso);
  if (!desde || !hasta) return 0;
  if (hasta < desde) return -diasHabilesEntreCL(hastaIso, desdeIso);

  let cuenta = 0;
  const d = new Date(`${desde}T00:00:00Z`);
  const hastaDate = new Date(`${hasta}T00:00:00Z`);
  while (d.getTime() < hastaDate.getTime()) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (esDiaHabilCL(d)) cuenta += 1;
  }
  return cuenta;
}

// Estado del SLA OC → Guía: `n` días hábiles desde la fecha de la OC.
// Devuelve { vence, diasRestantes, estado } donde estado ∈ "ok" | "vence_hoy" | "por_vencer" | "vencido".
export function calcularSLAGuiaDespacho(fechaOcIso, hoyIso, diasHabiles = 3) {
  const oc = toIsoDate(fechaOcIso);
  const hoy = toIsoDate(hoyIso) || new Date().toISOString().slice(0, 10);
  if (!oc) return { vence: "", diasRestantes: null, estado: "ok" };

  const vence = sumarDiasHabilesCL(oc, diasHabiles);
  const restantes = diasHabilesEntreCL(hoy, vence);

  let estado;
  if (vence < hoy) estado = "vencido";
  else if (vence === hoy) estado = "vence_hoy";
  else if (restantes <= 1) estado = "por_vencer";
  else estado = "ok";

  return { vence, diasRestantes: restantes, estado };
}
