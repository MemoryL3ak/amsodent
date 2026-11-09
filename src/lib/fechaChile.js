// Fechas con hora en horario de Chile.
//
// Los timestamps de la base llegan en UTC («2026-11-06T12:59:07+00:00»).
// Cortar el texto con slice(11, 16) muestra la hora UTC —3 o 4 horas
// adelantada según la época del año— y, pasadas las 21:00, hasta el día
// siguiente. Esto convierte a America/Santiago cuando el valor trae zona
// horaria y deja tal cual las fechas sin hora («2026-11-06») y los
// timestamps sin zona, que ya vienen en hora local por convención.

const FORMATO = new Intl.DateTimeFormat("es-CL", {
  timeZone: "America/Santiago",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const CON_ZONA = /(Z|[+-]\d{2}:?\d{2})$/i;

/** «DD-MM-YYYY · HH:MM» en hora de Chile. Sin hora si el valor es solo fecha;
    con `ocultarMedianoche` tampoco la muestra cuando queda en 00:00. */
export function fmtFechaHoraChile(valor, { ocultarMedianoche = false } = {}) {
  const s = String(valor || "").trim();
  if (!s) return "—";

  let fecha = s.slice(0, 10);
  let hora = s.length > 10 ? s.slice(11, 16) : "";

  if (s.length > 10 && CON_ZONA.test(s)) {
    const d = new Date(s);
    if (!Number.isNaN(d.getTime())) {
      const p = Object.fromEntries(FORMATO.formatToParts(d).map((x) => [x.type, x.value]));
      fecha = `${p.year}-${p.month}-${p.day}`;
      // Algunos motores devuelven «24» para la medianoche con hour12:false.
      hora = `${p.hour === "24" ? "00" : p.hour}:${p.minute}`;
    }
  }

  const [y, m, d] = fecha.split("-");
  if (!y || !m || !d) return s;
  const sinHora = !hora || (ocultarMedianoche && hora === "00:00");
  return `${d}-${m}-${y}${sinHora ? "" : ` · ${hora}`}`;
}
