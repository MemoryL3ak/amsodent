// Helpers de formato (CLP y fechas) sin depender de Intl, que puede no estar
// completo en el runtime Hermes de todas las plataformas.

export function fmtCLP(v?: number | string | null): string {
  const n = Math.round(Number(v ?? 0));
  if (!isFinite(n)) return '$0';
  const sign = n < 0 ? '-' : '';
  const digits = Math.abs(n).toString();
  const conMiles = digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${sign}$${conMiles}`;
}

// "2026-07-28..." → "28-07-2026". Devuelve "—" si no hay fecha.
export function fmtFecha(iso?: string | null): string {
  const s = String(iso ?? '').trim();
  if (!s) return '—';
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return s;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

export function fmtFechaHora(iso?: string | null): string {
  const s = String(iso ?? '').trim();
  if (!s) return '—';
  const d = new Date(s);
  if (isNaN(d.getTime())) return fmtFecha(s);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${dd}-${mm}-${d.getFullYear()} ${hh}:${mi}`;
}

// Cierre del portal de compras: "DD-MM-YYYY", "DD/MM/YY", con hora opcional
// "HH:mm". Año de 2 dígitos → 2000+YY. Sin hora se asume 23:59 (vigente todo
// el día). Misma lógica que LicitacionesDisponibles.jsx del web.
export function parseCierre(raw?: string | null): Date | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  const m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4}|\d{2})(?:[ T](\d{1,2}):(\d{2}))?/);
  if (m) {
    const anio = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    const hora = m[4] != null ? Number(m[4]) : 23;
    const min = m[5] != null ? Number(m[5]) : 59;
    const d = new Date(anio, Number(m[2]) - 1, Number(m[1]), hora, min, 0, 0);
    return isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

export function cierreVigente(raw?: string | null): boolean {
  const c = parseCierre(raw);
  if (!c) return true; // sin dato interpretable no se bloquea
  return c.getTime() >= Date.now();
}
