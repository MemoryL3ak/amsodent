import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import { api } from "../lib/api";

/* ============================================================
   Sección "Tráfico" del Monitoreo del Sistema.
   ─ Columnas apiladas por intervalo: OK / avisos (4xx) / errores.
   ─ Latencia p50 / p95 con crosshair.
   ─ Top endpoints y usuarios más activos.
   Datos agregados en SQL (fn monitor_trafico) vía /monitor/trafico.
   Colores de estado fijos (semáforo) + 2 series de latencia,
   paleta validada para daltonismo; identidad siempre con
   icono/etiqueta, nunca solo color.
============================================================ */

const C = {
  ok: "#0ca30c",       // estado: bien
  warn: "#fab219",     // estado: aviso
  err: "#d03b3b",      // estado: crítico
  p50: "#2a78d6",      // serie 1
  p95: "#eb6834",      // serie 2
  grid: "var(--border, #e1e0d9)",
  ink: "var(--text, #0b0b0b)",
  muted: "var(--text-muted, #898781)",
};

const RANGOS = [
  { horas: 1, label: "1 h" },
  { horas: 6, label: "6 h" },
  { horas: 24, label: "24 h" },
  { horas: 168, label: "7 días" },
];

const fmtN = (v) => Number(v || 0).toLocaleString("es-CL");
const fmtMs = (v) => (v == null ? "—" : v >= 1000 ? `${(v / 1000).toFixed(1)} s` : `${Math.round(v)} ms`);

function fmtBucket(iso, horas) {
  const d = new Date(iso);
  if (horas <= 6) return d.toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit" });
  if (horas <= 24) return d.toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString("es-CL", { day: "2-digit", month: "2-digit" }) + " " +
    d.toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit" });
}

// Ticks "limpios" para el eje Y.
function ticksY(max, n = 3) {
  if (!max || max <= 0) return [0];
  const paso = Math.pow(10, Math.floor(Math.log10(max / n)));
  const mult = [1, 2, 5, 10].find((m) => (max / (paso * m)) <= n + 0.5) || 10;
  const t = [];
  for (let v = 0; v <= max; v += paso * mult) t.push(v);
  return t;
}

// Rect con solo las esquinas SUPERIORES redondeadas (data-end de una columna).
function topRoundedRect(x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h);
  return `M${x},${y + h} L${x},${y + rr} Q${x},${y} ${x + rr},${y} L${x + w - rr},${y} Q${x + w},${y} ${x + w},${y + rr} L${x + w},${y + h} Z`;
}

export default function MonitorTrafico() {
  const [horas, setHoras] = useState(24);
  const [data, setData] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let vivo = true;
    setCargando(true);
    const cargar = () =>
      api.get(`/monitor/trafico?horas=${horas}`)
        .then((d) => { if (vivo) { setData(d); setError(null); } })
        .catch((e) => { if (vivo) setError(e?.message || "No se pudo cargar el tráfico."); })
        .finally(() => { if (vivo) setCargando(false); });
    cargar();
    const t = setInterval(cargar, 60_000);
    return () => { vivo = false; clearInterval(t); };
  }, [horas]);

  const buckets = data?.buckets || [];
  const totales = useMemo(() => buckets.reduce(
    (a, b) => ({ ok: a.ok + Number(b.ok || 0), avisos: a.avisos + Number(b.avisos || 0), errores: a.errores + Number(b.errores || 0) }),
    { ok: 0, avisos: 0, errores: 0 },
  ), [buckets]);

  return (
    <div className="mtr-seccion">
      {/* Fila de filtros: el rango escopa TODO lo de abajo */}
      <div className="mtr-filtros">
        <span className="mtr-titulo">Tráfico</span>
        <div className="mtr-rangos" role="group" aria-label="Rango de tiempo">
          {RANGOS.map((r) => (
            <button key={r.horas} onClick={() => setHoras(r.horas)}
              className={"mtr-rango" + (horas === r.horas ? " mtr-rango-activo" : "")}>
              {r.label}
            </button>
          ))}
        </div>
        <span className="mtr-resumen">
          {fmtN(totales.ok + totales.avisos + totales.errores)} eventos
          {totales.errores > 0 ? ` · ${fmtN(totales.errores)} errores` : ""}
        </span>
      </div>

      {error ? (
        <div className="mtr-error">
          {error.includes("monitor_trafico")
            ? "Falta aplicar la migración 20260807_monitor_trafico_fn.sql en Supabase para ver los gráficos de tráfico."
            : error}
        </div>
      ) : (
        <div className="mtr-grid" style={{ opacity: cargando && data ? 0.55 : 1 }}>
          <div className="mtr-card mtr-card-ancha">
            <div className="mtr-card-titulo">Requests por intervalo</div>
            <GraficoColumnas buckets={buckets} horas={horas} />
            <div className="mtr-leyenda">
              <span><CheckCircle2 size={12} style={{ color: C.ok }} /> OK</span>
              <span><AlertTriangle size={12} style={{ color: C.warn }} /> Avisos (4xx)</span>
              <span><XCircle size={12} style={{ color: C.err }} /> Errores</span>
            </div>
          </div>

          <div className="mtr-card">
            <div className="mtr-card-titulo">Latencia del backend</div>
            <GraficoLatencia buckets={buckets} horas={horas} />
            <div className="mtr-leyenda">
              <span><i className="mtr-linea" style={{ background: C.p50 }} /> p50 (mediana)</span>
              <span><i className="mtr-linea" style={{ background: C.p95 }} /> p95</span>
            </div>
          </div>

          <div className="mtr-card">
            <div className="mtr-card-titulo">Endpoints más usados</div>
            <TopRutas rutas={data?.rutas || []} />
          </div>

          <div className="mtr-card">
            <div className="mtr-card-titulo">Usuarios más activos</div>
            <TopUsuarios usuarios={data?.usuarios || []} />
          </div>
        </div>
      )}

      <style>{`
        .mtr-seccion { margin-bottom: 16px; }
        .mtr-filtros { display: flex; align-items: center; gap: 12px; margin-bottom: 10px; flex-wrap: wrap; }
        .mtr-titulo { font-size: 14px; font-weight: 800; }
        .mtr-rangos { display: inline-flex; border: 1px solid var(--border); border-radius: 9px; overflow: hidden; background: var(--surface, #fff); }
        .mtr-rango { border: 0; background: transparent; padding: 5px 13px; font-size: 12.5px; cursor: pointer; color: var(--text-muted); font-weight: 600; }
        .mtr-rango + .mtr-rango { border-left: 1px solid var(--border); }
        .mtr-rango-activo { background: var(--primary, #1e9295); color: #fff; }
        .mtr-resumen { font-size: 12px; color: var(--text-muted); margin-left: auto; }
        .mtr-error { border: 1px solid #fcd34d; background: #fffbeb; border-radius: 10px; padding: 12px 16px; font-size: 13px; }
        .mtr-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 12px; transition: opacity .2s; }
        .mtr-card { background: var(--surface, #fff); border: 1px solid var(--border); border-radius: 12px; padding: 13px 15px; min-width: 0; }
        .mtr-card-ancha { grid-column: 1 / -1; }
        @media (min-width: 1100px) { .mtr-card-ancha { grid-column: span 2; } }
        .mtr-card-titulo { font-size: 12.5px; font-weight: 700; margin-bottom: 8px; }
        .mtr-leyenda { display: flex; gap: 14px; margin-top: 6px; font-size: 11.5px; color: var(--text-muted); }
        .mtr-leyenda span { display: inline-flex; align-items: center; gap: 5px; }
        .mtr-linea { display: inline-block; width: 14px; height: 2px; border-radius: 2px; }
        .mtr-tooltip {
          position: absolute; pointer-events: none; z-index: 5;
          background: var(--surface, #fff); border: 1px solid var(--border); border-radius: 8px;
          box-shadow: 0 4px 14px rgba(0,0,0,.12); padding: 8px 11px; font-size: 12px; min-width: 130px;
        }
        .mtr-tooltip-hora { color: var(--text-muted); font-size: 11px; margin-bottom: 4px; }
        .mtr-tooltip-fila { display: flex; align-items: center; gap: 6px; line-height: 1.7; }
        .mtr-tooltip-fila b { font-variant-numeric: tabular-nums; }
        .mtr-tooltip-fila .mtr-linea { width: 10px; }
        .mtr-vacio { color: var(--text-muted); font-size: 12.5px; padding: 24px 0; text-align: center; }
        .mtr-barra-fila { margin-bottom: 9px; min-width: 0; }
        .mtr-barra-meta { display: flex; justify-content: space-between; gap: 8px; font-size: 12px; margin-bottom: 3px; }
        .mtr-barra-nombre { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .mtr-barra-sub { font-size: 11px; color: var(--text-muted); display: inline-flex; align-items: center; gap: 4px; }
        .mtr-barra-pista { height: 10px; border-radius: 0 4px 4px 0; background: #eaf1fb; overflow: hidden; }
        .mtr-barra-valor { height: 100%; background: #2a78d6; border-radius: 0 4px 4px 0; }
      `}</style>
    </div>
  );
}

/* ── Columnas apiladas OK/avisos/errores ─────────────────────────── */
function GraficoColumnas({ buckets, horas }) {
  const [hover, setHover] = useState(null); // { i, x }
  const ref = useRef(null);
  const W = 900, H = 190, padL = 42, padB = 20, padT = 8;
  const plotW = W - padL - 6, plotH = H - padT - padB;

  const max = Math.max(1, ...buckets.map((b) => Number(b.ok || 0) + Number(b.avisos || 0) + Number(b.errores || 0)));
  const yTicks = ticksY(max);
  const n = buckets.length || 1;
  const banda = plotW / n;
  const ancho = Math.min(24, Math.max(2, banda - 2));

  if (!buckets.length) return <div className="mtr-vacio">Sin tráfico en este período.</div>;

  const yDe = (v) => padT + plotH - (v / max) * plotH;

  return (
    <div style={{ position: "relative" }} ref={ref}
      onMouseLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", display: "block" }}
        onMouseMove={(e) => {
          const r = ref.current.getBoundingClientRect();
          const px = ((e.clientX - r.left) / r.width) * W;
          const i = Math.max(0, Math.min(n - 1, Math.floor((px - padL) / banda)));
          setHover({ i, x: (e.clientX - r.left) });
        }}>
        {yTicks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={W - 6} y1={yDe(t)} y2={yDe(t)} stroke={C.grid} strokeWidth="1" />
            <text x={padL - 7} y={yDe(t) + 3.5} textAnchor="end" fontSize="10" fill={C.muted}>{fmtN(t)}</text>
          </g>
        ))}
        {buckets.map((b, i) => {
          const x = padL + i * banda + (banda - ancho) / 2;
          const partes = [
            { v: Number(b.ok || 0), color: C.ok },
            { v: Number(b.avisos || 0), color: C.warn },
            { v: Number(b.errores || 0), color: C.err },
          ].filter((p) => p.v > 0);
          let acum = 0;
          const rects = [];
          partes.forEach((p, j) => {
            const y0 = yDe(acum + p.v), y1 = yDe(acum);
            const alto = Math.max(1, y1 - y0 - (j < partes.length - 1 ? 2 : 0)); // gap 2px entre segmentos
            const esTope = j === partes.length - 1;
            rects.push(esTope
              ? <path key={j} d={topRoundedRect(x, y0, ancho, alto, 4)} fill={p.color} />
              : <rect key={j} x={x} y={y0} width={ancho} height={alto} fill={p.color} />);
            acum += p.v;
          });
          return <g key={b.bucket} opacity={hover && hover.i !== i ? 0.75 : 1}>{rects}</g>;
        })}
        {/* etiquetas de tiempo: inicio · medio · fin */}
        {[0, Math.floor((n - 1) / 2), n - 1].filter((v, i, a) => a.indexOf(v) === i).map((i) => (
          <text key={i} x={padL + i * banda + banda / 2} y={H - 5} textAnchor="middle" fontSize="10" fill={C.muted}>
            {fmtBucket(buckets[i].bucket, horas)}
          </text>
        ))}
      </svg>
      {hover && buckets[hover.i] && (
        <div className="mtr-tooltip" style={{ left: Math.min(hover.x + 14, (ref.current?.clientWidth || 300) - 160), top: 0 }}>
          <div className="mtr-tooltip-hora">{fmtBucket(buckets[hover.i].bucket, horas)}</div>
          <div className="mtr-tooltip-fila"><i className="mtr-linea" style={{ background: C.ok }} /><b>{fmtN(buckets[hover.i].ok)}</b> OK</div>
          <div className="mtr-tooltip-fila"><i className="mtr-linea" style={{ background: C.warn }} /><b>{fmtN(buckets[hover.i].avisos)}</b> avisos</div>
          <div className="mtr-tooltip-fila"><i className="mtr-linea" style={{ background: C.err }} /><b>{fmtN(buckets[hover.i].errores)}</b> errores</div>
        </div>
      )}
    </div>
  );
}

/* ── Líneas p50/p95 con crosshair ────────────────────────────────── */
function GraficoLatencia({ buckets, horas }) {
  const [hover, setHover] = useState(null);
  const ref = useRef(null);
  const W = 440, H = 190, padL = 44, padB = 20, padT = 8, padR = 34;
  const plotW = W - padL - padR, plotH = H - padT - padB;

  const conDatos = buckets.filter((b) => b.p95 != null);
  if (!conDatos.length) return <div className="mtr-vacio">Sin requests con latencia en este período.</div>;

  const max = Math.max(50, ...conDatos.map((b) => Number(b.p95)));
  const yTicks = ticksY(max);
  const n = buckets.length;
  const xDe = (i) => padL + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const yDe = (v) => padT + plotH - (v / max) * plotH;

  // Polilíneas con cortes donde no hay datos.
  const puntos = (campo) => {
    const segs = [];
    let seg = [];
    buckets.forEach((b, i) => {
      if (b[campo] == null) { if (seg.length) segs.push(seg); seg = []; return; }
      seg.push([xDe(i), yDe(Number(b[campo]))]);
    });
    if (seg.length) segs.push(seg);
    return segs;
  };

  const ultimo = [...buckets].reverse().find((b) => b.p95 != null);
  const iUltimo = buckets.lastIndexOf(ultimo);

  return (
    <div style={{ position: "relative" }} ref={ref} onMouseLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", display: "block" }}
        onMouseMove={(e) => {
          const r = ref.current.getBoundingClientRect();
          const px = ((e.clientX - r.left) / r.width) * W;
          let mejor = 0, dist = Infinity;
          buckets.forEach((b, i) => {
            const d = Math.abs(xDe(i) - px);
            if (d < dist) { dist = d; mejor = i; }
          });
          setHover({ i: mejor, x: (xDe(mejor) / W) * r.width });
        }}>
        {yTicks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={W - padR} y1={yDe(t)} y2={yDe(t)} stroke={C.grid} strokeWidth="1" />
            <text x={padL - 7} y={yDe(t) + 3.5} textAnchor="end" fontSize="10" fill={C.muted}>{fmtN(t)}</text>
          </g>
        ))}
        {hover != null && (
          <line x1={xDe(hover.i)} x2={xDe(hover.i)} y1={padT} y2={padT + plotH} stroke={C.muted} strokeWidth="1" />
        )}
        {[["p95", C.p95], ["p50", C.p50]].map(([campo, color]) =>
          puntos(campo).map((seg, k) => (
            <polyline key={campo + k} points={seg.map((p) => p.join(",")).join(" ")}
              fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          )),
        )}
        {/* marcador + etiqueta directa al final de cada línea */}
        {ultimo && [["p95", C.p95], ["p50", C.p50]].map(([campo, color]) => (
          ultimo[campo] != null && (
            <g key={campo}>
              <circle cx={xDe(iUltimo)} cy={yDe(Number(ultimo[campo]))} r="4" fill={color} stroke="var(--surface, #fff)" strokeWidth="2" />
              <text x={xDe(iUltimo) + 8} y={yDe(Number(ultimo[campo])) + 3.5} fontSize="10" fontWeight="700" fill={C.muted}>{campo}</text>
            </g>
          )
        ))}
        {[0, n - 1].filter((v, i, a) => a.indexOf(v) === i).map((i) => (
          <text key={i} x={xDe(i)} y={H - 5} textAnchor={i === 0 ? "start" : "end"} fontSize="10" fill={C.muted}>
            {fmtBucket(buckets[i].bucket, horas)}
          </text>
        ))}
      </svg>
      {hover != null && buckets[hover.i] && (
        <div className="mtr-tooltip" style={{ left: Math.min(hover.x + 12, (ref.current?.clientWidth || 300) - 150), top: 0 }}>
          <div className="mtr-tooltip-hora">{fmtBucket(buckets[hover.i].bucket, horas)}</div>
          <div className="mtr-tooltip-fila"><i className="mtr-linea" style={{ background: C.p95 }} /><b>{fmtMs(buckets[hover.i].p95)}</b> p95</div>
          <div className="mtr-tooltip-fila"><i className="mtr-linea" style={{ background: C.p50 }} /><b>{fmtMs(buckets[hover.i].p50)}</b> p50</div>
        </div>
      )}
    </div>
  );
}

/* ── Top endpoints (barras horizontales, un solo tono) ───────────── */
function TopRutas({ rutas }) {
  if (!rutas.length) return <div className="mtr-vacio">Sin requests registradas aún.</div>;
  const max = Math.max(...rutas.map((r) => Number(r.total)));
  return (
    <div>
      {rutas.slice(0, 8).map((r) => (
        <div key={`${r.metodo} ${r.ruta}`} className="mtr-barra-fila">
          <div className="mtr-barra-meta">
            <span className="mtr-barra-nombre" title={`${r.metodo} ${r.ruta}`}>
              <b style={{ fontSize: 11, color: "var(--text-muted)" }}>{r.metodo}</b> {r.ruta}
            </span>
            <span style={{ whiteSpace: "nowrap" }}>
              <b>{fmtN(r.total)}</b>
              <span className="mtr-barra-sub" style={{ marginLeft: 7 }}>
                {fmtMs(r.prom_ms)} prom · {fmtMs(r.p95_ms)} p95
                {Number(r.errores) > 0 && (
                  <span style={{ color: "#b91c1c", display: "inline-flex", alignItems: "center", gap: 2 }}>
                    <AlertTriangle size={10} /> {fmtN(r.errores)}
                  </span>
                )}
              </span>
            </span>
          </div>
          <div className="mtr-barra-pista">
            <div className="mtr-barra-valor" style={{ width: `${Math.max(1, (Number(r.total) / max) * 100)}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

/* ── Usuarios más activos ────────────────────────────────────────── */
function TopUsuarios({ usuarios }) {
  if (!usuarios.length) return <div className="mtr-vacio">Sin actividad de usuarios aún.</div>;
  const max = Math.max(...usuarios.map((u) => Number(u.total)));
  return (
    <div>
      {usuarios.map((u) => (
        <div key={u.usuario_email} className="mtr-barra-fila">
          <div className="mtr-barra-meta">
            <span className="mtr-barra-nombre" title={u.usuario_email}>{u.usuario_email}</span>
            <span style={{ whiteSpace: "nowrap" }}>
              <b>{fmtN(u.total)}</b>
              {Number(u.errores) > 0 && (
                <span className="mtr-barra-sub" style={{ marginLeft: 7, color: "#b91c1c" }}>
                  <AlertTriangle size={10} /> {fmtN(u.errores)}
                </span>
              )}
            </span>
          </div>
          <div className="mtr-barra-pista">
            <div className="mtr-barra-valor" style={{ width: `${Math.max(1, (Number(u.total) / max) * 100)}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}
