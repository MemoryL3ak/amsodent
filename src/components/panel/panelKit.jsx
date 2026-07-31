// panelKit.jsx
// Helpers y componentes de presentación compartidos por los sub-paneles
// (Cliente Particular y Entidad Pública). Reutilizan el mismo lenguaje visual
// del Panel de Indicadores para mantener coherencia.
import { TrendingUp, TrendingDown, Minus } from "lucide-react";

/* ── Formato ──────────────────────────────────────────────────────────── */
export function fmtCLP(v) { return `$${Number(v || 0).toLocaleString("es-CL")}`; }
export function fmtNum(v) { return Number(v || 0).toLocaleString("es-CL"); }
export function fmtPct(v) { return Number.isFinite(Number(v)) ? `${Number(v).toFixed(1)}%` : "—"; }
export function clamp(v, a, b) { return Math.min(b, Math.max(a, Number(v || 0))); }

/* ── Fechas / periodos ────────────────────────────────────────────────── */
export function inicioMesISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}
export function mesDe(value) { return value ? String(value).slice(0, 7) : ""; } // 'YYYY-MM'
export function toDateISO(value) {
  if (!value) return "";
  const s = String(value);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
}
export function addMesKey(key, delta) {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
export function labelMesCorto(key) {
  const [y, m] = key.split("-").map(Number);
  const s = new Date(y, m - 1, 1).toLocaleDateString("es-CL", { month: "short" });
  return s.charAt(0).toUpperCase() + s.slice(1, 3);
}
export function labelMesLargo(key) {
  const [y, m] = key.split("-").map(Number);
  const s = new Date(y, m - 1, 1).toLocaleDateString("es-CL", { month: "long", year: "numeric" });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/* ── Delta (vs mes anterior) ──────────────────────────────────────────── */
export function Delta({ actual, prev, unidadPp = false }) {
  let val = null;
  if (unidadPp) val = (actual ?? 0) - (prev ?? 0);
  else if (prev) val = ((actual - prev) / Math.abs(prev)) * 100;
  if (val == null || !Number.isFinite(val)) {
    return <span style={{ fontSize: 11, color: "var(--text-muted)" }}>sin base previa</span>;
  }
  const sube = val > 0.05;
  const baja = val < -0.05;
  const color = sube ? "#16a34a" : baja ? "#dc2626" : "var(--text-muted)";
  const Icon = sube ? TrendingUp : baja ? TrendingDown : Minus;
  const txt = unidadPp ? `${val > 0 ? "+" : ""}${val.toFixed(1)} pp` : `${val > 0 ? "+" : ""}${val.toFixed(1)}%`;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, fontWeight: 600, color }}>
      <Icon size={13} /> {txt} <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>vs. mes anterior</span>
    </span>
  );
}

/* ── Tarjeta KPI ──────────────────────────────────────────────────────── */
export function KpiCard({ icon: Icon, color, label, sub, value, delta }) {
  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderTop: `3px solid ${color}`, borderRadius: "var(--radius-lg)", padding: "16px 18px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <span style={{ width: 30, height: 30, borderRadius: 8, background: `${color}18`, color, display: "grid", placeItems: "center", flexShrink: 0 }}>
          <Icon size={16} />
        </span>
        <div style={{ lineHeight: 1.15 }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".04em", color: "var(--text-muted)" }}>{label}</div>
          {sub ? <div style={{ fontSize: 10, color: "var(--text-muted)" }}>{sub}</div> : null}
        </div>
      </div>
      <div style={{ fontSize: 24, fontWeight: 800, color: "var(--text)", lineHeight: 1.1 }}>{value}</div>
      {delta ? <div style={{ marginTop: 6 }}>{delta}</div> : null}
    </div>
  );
}

/* ── Línea SVG (evolución) ────────────────────────────────────────────── */
export function LineChart({ data, max, color = "#28aeb1", valueKey = "valor", height = 150 }) {
  const W = 320, H = 140, padX = 10, padY = 16;
  const n = data.length;
  const stepX = n > 1 ? (W - padX * 2) / (n - 1) : 0;
  const safeMax = Math.max(1, max);
  const y = (v) => H - padY - (v / safeMax) * (H - padY * 2);
  const pts = data.map((d, i) => [padX + i * stepX, y(d[valueKey] || 0)]);
  const path = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  const area = pts.length
    ? `${path} L${pts[pts.length - 1][0].toFixed(1)},${H - padY} L${pts[0][0].toFixed(1)},${H - padY} Z`
    : "";
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height }}>
        {area && <path d={area} fill={`${color}1f`} />}
        {path && <path d={path} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />}
        {pts.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r="3" fill={color} />)}
      </svg>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
        {data.map((d) => (
          <span key={d.label} style={{ fontSize: 10.5, color: "var(--text-muted)", flex: 1, textAlign: "center" }}>{d.label}</span>
        ))}
      </div>
    </div>
  );
}

/* ── Forma de embudo (trapecios apilados que se estrechan) ────────────── */
// onStageClick(stage): opcional — hace cada etapa cliqueable (ver detalle).
export function FunnelShape({ stages, onStageClick }) {
  const n = stages.length;
  const wTop = 100, wBot = 34; // anchos (%) del tope y del fondo del embudo
  const widths = [];
  for (let i = 0; i <= n; i++) widths.push(wTop - (wTop - wBot) * (i / n));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3, maxWidth: 440, margin: "0 auto", width: "100%" }}>
      {stages.map((s, i) => {
        const wt = widths[i], wb = widths[i + 1];
        const clip = `polygon(${(50 - wt / 2).toFixed(2)}% 0%, ${(50 + wt / 2).toFixed(2)}% 0%, ${(50 + wb / 2).toFixed(2)}% 100%, ${(50 - wb / 2).toFixed(2)}% 100%)`;
        return (
          <div
            key={s.label}
            title={onStageClick ? `${s.label}: ${fmtNum(s.value)} · clic para ver el detalle` : `${s.label}: ${fmtNum(s.value)}`}
            onClick={onStageClick ? () => onStageClick(s) : undefined}
            style={{
              height: 60, background: s.color, clipPath: clip, WebkitClipPath: clip,
              display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
              color: "#fff", textAlign: "center",
              cursor: onStageClick ? "pointer" : "default",
            }}
          >
            <div style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: ".3px", textTransform: "uppercase", opacity: .95 }}>{s.label}</div>
            <div style={{ fontSize: 22, fontWeight: 800, lineHeight: 1.05 }}>{fmtNum(s.value)}</div>
          </div>
        );
      })}
    </div>
  );
}

/* ── Barras horizontales por categoría (p. ej. motivos de pérdida/descarte) ─ */
// items: [{ label, value, color? }]. Ordena tú la lista antes de pasarla.
export function HBarList({ items, color = "#28aeb1", fmt = fmtNum, emptyText = "Sin registros en el período." }) {
  const list = items || [];
  if (!list.length) {
    return <div style={{ fontSize: 12.5, color: "var(--text-muted)", padding: "10px 2px" }}>{emptyText}</div>;
  }
  const max = Math.max(1, ...list.map((i) => i.value || 0));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {list.map((it) => (
        <div key={it.label}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", fontSize: 12, marginBottom: 4, gap: 8 }}>
            <span title={it.label} style={{ color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.label}</span>
            <strong style={{ color: it.color || color, flexShrink: 0 }}>{fmt(it.value || 0)}</strong>
          </div>
          <div style={{ height: 11, borderRadius: 6, background: "var(--bg)", overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${clamp(((it.value || 0) / max) * 100, (it.value || 0) > 0 ? 6 : 0, 100)}%`, background: it.color || color, borderRadius: 6, transition: "width .3s" }} />
          </div>
        </div>
      ))}
    </div>
  );
}

/* ── Barras verticales (montos por mes) ───────────────────────────────── */
// Valor compacto para la etiqueta sobre cada barra ($4,2M · $850k · 12).
export function fmtCompacto(v, esMoneda = false) {
  const n = Number(v || 0);
  const abs = Math.abs(n);
  const pre = esMoneda ? "$" : "";
  if (abs >= 1_000_000_000) return `${pre}${(n / 1_000_000_000).toLocaleString("es-CL", { maximumFractionDigits: 1 })}MM`;
  if (abs >= 1_000_000) return `${pre}${(n / 1_000_000).toLocaleString("es-CL", { maximumFractionDigits: 1 })}M`;
  if (abs >= 10_000) return `${pre}${Math.round(n / 1_000).toLocaleString("es-CL")}k`;
  return `${pre}${n.toLocaleString("es-CL")}`;
}

export function BarChart({ data, max, color = "#28aeb1", valueKey = "valor", fmt = fmtNum, height = 150 }) {
  const safeMax = Math.max(1, max);
  // Si el formato entrega moneda ("$…"), la etiqueta usa la versión compacta.
  const esMoneda = String(fmt(1000)).trim().startsWith("$");
  return (
    <div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 8, height, padding: "0 2px" }}>
        {data.map((d) => {
          const v = d[valueKey] || 0;
          const h = clamp((v / safeMax) * 100, v > 0 ? 4 : 0, 100);
          return (
            <div key={d.label} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", height: "100%" }} title={fmt(v)}>
              <div style={{ fontSize: 10, fontWeight: 700, color: v > 0 ? "var(--text)" : "var(--text-muted)", marginBottom: 2, whiteSpace: "nowrap" }}>
                {fmtCompacto(v, esMoneda)}
              </div>
              <div style={{ width: "70%", maxWidth: 34, height: `${h}%`, background: color, borderRadius: "5px 5px 0 0", minHeight: v > 0 ? 3 : 0, transition: "height .3s" }} />
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
        {data.map((d) => (
          <span key={d.label} style={{ flex: 1, fontSize: 10.5, color: "var(--text-muted)", textAlign: "center" }}>{d.label}</span>
        ))}
      </div>
    </div>
  );
}
