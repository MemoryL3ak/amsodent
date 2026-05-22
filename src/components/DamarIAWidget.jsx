import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Sparkles,
  Send,
  Loader2,
  Database,
  Code2,
  Table2,
  ChevronDown,
  AlertCircle,
  BarChart3,
  X,
  RotateCcw,
  Download,
} from "lucide-react";
import { api } from "../lib/api";

// DamarIA — asistente de IA flotante (popup inferior derecho). Solo admin.

/* ── Paleta ──────────────────────────────────────────────────────────── */
const VIOLETA = "#7c3aed";
const VIOLETA_OSC = "#6d28d9";
const INK = "#0f172a";
const MUTED = "#64748b";
const FAINT = "#94a3b8";
const LINE = "#e8edf2";

const PALETA = [
  "#7c3aed", "#0e7d83", "#2563eb", "#db2777", "#ea580c",
  "#16a34a", "#0891b2", "#9333ea", "#dc2626", "#ca8a04",
];

const EJEMPLOS = [
  "¿Cuántas cotizaciones hay por estado?",
  "Top 10 productos más cotizados",
  "Monto adjudicado por vendedor este año",
  "Cotizaciones por tipo de compra",
];

/* ── Helpers ─────────────────────────────────────────────────────────── */
function fmtNum(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v ?? "");
  return n.toLocaleString("es-CL", { maximumFractionDigits: 2 });
}

function fmtCelda(v) {
  if (v == null || v === "") return "—";
  if (typeof v === "number") return fmtNum(v);
  if (typeof v === "boolean") return v ? "Sí" : "No";
  return String(v);
}

function truncar(s, n = 16) {
  const t = String(s ?? "");
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
}

function arcoDonut(cx, cy, r, rInt, a0, a1) {
  const p = (a, rad) => [cx + rad * Math.cos(a), cy + rad * Math.sin(a)];
  const grande = a1 - a0 > Math.PI ? 1 : 0;
  const [x0, y0] = p(a0, r);
  const [x1, y1] = p(a1, r);
  const [x2, y2] = p(a1, rInt);
  const [x3, y3] = p(a0, rInt);
  return `M ${x0} ${y0} A ${r} ${r} 0 ${grande} 1 ${x1} ${y1} L ${x2} ${y2} A ${rInt} ${rInt} 0 ${grande} 0 ${x3} ${y3} Z`;
}

// Render de markdown ligero: **negrita**, listas con guiones, saltos de línea.
function inlineMd(texto) {
  return String(texto)
    .split(/(\*\*[^*]+\*\*)/g)
    .map((p, i) => {
      const m = p.match(/^\*\*([^*]+)\*\*$/);
      return m ? <strong key={i}>{m[1]}</strong> : <span key={i}>{p}</span>;
    });
}

// Exporta los datos de una respuesta de DamarIA a un archivo Excel.
async function exportarExcel(datos) {
  if (!Array.isArray(datos) || datos.length === 0) return;
  try {
    const XLSX = await import("xlsx");
    const ws = XLSX.utils.json_to_sheet(datos);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "DamarIA");
    const fecha = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `damaria-${fecha}.xlsx`);
  } catch (e) {
    console.error("No se pudo exportar:", e);
  }
}

function RenderTexto({ texto }) {
  const lineas = String(texto || "").split("\n");
  const bloques = [];
  let listaActual = null;
  lineas.forEach((ln) => {
    const bullet = ln.match(/^\s*[-*•]\s+(.*)/);
    if (bullet) {
      if (!listaActual) {
        listaActual = [];
        bloques.push({ tipo: "lista", items: listaActual });
      }
      listaActual.push(bullet[1]);
    } else {
      listaActual = null;
      const esEncabezado = /^#{1,6}\s/.test(ln);
      const limpio = ln.replace(/^#{1,6}\s+/, "");
      if (limpio.trim() === "") bloques.push({ tipo: "espacio" });
      else bloques.push({ tipo: "parrafo", texto: limpio, encabezado: esEncabezado });
    }
  });
  return (
    <div>
      {bloques.map((b, i) => {
        if (b.tipo === "espacio") return <div key={i} style={{ height: 6 }} />;
        if (b.tipo === "lista")
          return (
            <ul
              key={i}
              style={{ margin: "5px 0", paddingLeft: 17, display: "flex", flexDirection: "column", gap: 3 }}
            >
              {b.items.map((it, j) => (
                <li key={j}>{inlineMd(it)}</li>
              ))}
            </ul>
          );
        return (
          <div key={i} style={{ marginBottom: 3, fontWeight: b.encabezado ? 800 : undefined }}>
            {inlineMd(b.texto)}
          </div>
        );
      })}
    </div>
  );
}

/* ── Widget principal ────────────────────────────────────────────────── */
export default function DamarIAWidget() {
  const [abierto, setAbierto] = useState(false);
  const [estado, setEstado] = useState(null);
  const [mensajes, setMensajes] = useState([]);
  const [pregunta, setPregunta] = useState("");
  const [cargando, setCargando] = useState(false);
  const listaRef = useRef(null);

  useEffect(() => {
    if (!abierto || estado) return;
    (async () => {
      try {
        const r = await api.get("/ia/estado");
        setEstado(r || { configurada: false });
      } catch {
        setEstado({ configurada: false });
      }
    })();
  }, [abierto, estado]);

  useEffect(() => {
    const el = listaRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [mensajes, cargando, abierto]);

  async function enviar(preguntaTexto) {
    const p = String(preguntaTexto ?? pregunta).trim();
    if (!p || cargando) return;
    setPregunta("");
    const base = Date.now();
    setMensajes((m) => [...m, { id: base, rol: "user", texto: p }]);
    setCargando(true);
    try {
      const r = await api.post("/ia/consultar", { pregunta: p });
      setMensajes((m) => [...m, { id: base + 1, rol: "ia", respuesta: r }]);
    } catch (e) {
      setMensajes((m) => [
        ...m,
        { id: base + 1, rol: "ia", error: e?.message || "DamarIA no pudo responder." },
      ]);
    } finally {
      setCargando(false);
    }
  }

  return createPortal(
    <>
      <style>{ESTILOS}</style>

      {/* Botón flotante */}
      {!abierto && (
        <button
          type="button"
          className="dm-fab"
          onClick={() => setAbierto(true)}
          title="Abrir DamarIA"
          style={fab}
        >
          <Sparkles size={24} color="#fff" />
        </button>
      )}

      {/* Panel */}
      {abierto && (
        <div style={panel} className="dm-panel">
          {/* Header */}
          <div style={header}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={avatarHeader}>
                <Sparkles size={18} color="#fff" />
              </div>
              <div>
                <div style={{ fontSize: 14.5, fontWeight: 800, lineHeight: 1.1 }}>DamarIA</div>
                <div style={{ fontSize: 11, opacity: 0.85 }}>Asistente de análisis</div>
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
              {mensajes.length > 0 && (
                <button
                  type="button"
                  onClick={() => setMensajes([])}
                  title="Nueva conversación"
                  style={btnCerrar}
                >
                  <RotateCcw size={16} />
                </button>
              )}
              <button
                type="button"
                onClick={() => setAbierto(false)}
                title="Cerrar"
                style={btnCerrar}
              >
                <X size={18} />
              </button>
            </div>
          </div>

          {/* Cuerpo */}
          {estado && !estado.configurada ? (
            <DamarIANoConfig />
          ) : (
            <>
              <div ref={listaRef} className="dm-scroll" style={zonaChat}>
                {!estado ? (
                  <div style={{ display: "flex", justifyContent: "center", padding: 40 }}>
                    <Loader2 size={24} style={{ animation: "dm-spin 1s linear infinite", color: VIOLETA }} />
                  </div>
                ) : mensajes.length === 0 ? (
                  <Bienvenida onEjemplo={(t) => enviar(t)} cargando={cargando} />
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                    {mensajes.map((m) =>
                      m.rol === "user" ? (
                        <MensajeUsuario key={m.id} texto={m.texto} />
                      ) : (
                        <MensajeDamarIA key={m.id} mensaje={m} />
                      ),
                    )}
                    {cargando && <Pensando />}
                  </div>
                )}
              </div>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  enviar();
                }}
                style={barraInput}
              >
                <input
                  className="dm-input"
                  value={pregunta}
                  onChange={(e) => setPregunta(e.target.value)}
                  placeholder="Pregúntale algo a DamarIA…"
                  disabled={cargando || !estado}
                  style={input}
                />
                <button
                  type="submit"
                  disabled={cargando || !pregunta.trim() || !estado}
                  style={{
                    ...btnEnviar,
                    opacity: cargando || !pregunta.trim() || !estado ? 0.55 : 1,
                    cursor: cargando || !pregunta.trim() ? "default" : "pointer",
                  }}
                >
                  {cargando ? (
                    <Loader2 size={17} style={{ animation: "dm-spin 1s linear infinite" }} />
                  ) : (
                    <Send size={17} />
                  )}
                </button>
              </form>
            </>
          )}
        </div>
      )}
    </>,
    document.body,
  );
}

/* ── Subcomponentes ──────────────────────────────────────────────────── */

function Bienvenida({ onEjemplo, cargando }) {
  return (
    <div style={{ textAlign: "center", padding: "14px 4px" }}>
      <div style={{ ...avatarHeader, width: 52, height: 52, borderRadius: 16, margin: "0 auto 12px" }}>
        <Sparkles size={26} color="#fff" />
      </div>
      <h2 style={{ margin: "0 0 6px", fontSize: 16, fontWeight: 800, color: INK }}>
        Hola, soy DamarIA
      </h2>
      <p style={{ margin: "0 auto 16px", fontSize: 12.5, color: MUTED, lineHeight: 1.55 }}>
        Pregúntame sobre cotizaciones, productos, ventas o clientes. Te respondo con un
        resumen y un gráfico.
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
        {EJEMPLOS.map((ej) => (
          <button
            key={ej}
            type="button"
            className="dm-ejemplo"
            disabled={cargando}
            onClick={() => onEjemplo(ej)}
            style={chipEjemplo}
          >
            <BarChart3 size={14} style={{ color: VIOLETA, flexShrink: 0 }} />
            {ej}
          </button>
        ))}
      </div>
    </div>
  );
}

function MensajeUsuario({ texto }) {
  return (
    <div style={{ display: "flex", justifyContent: "flex-end" }}>
      <div
        style={{
          background: `linear-gradient(135deg, ${VIOLETA}, ${VIOLETA_OSC})`,
          color: "#fff",
          padding: "9px 13px",
          borderRadius: 14,
          borderBottomRightRadius: 4,
          fontSize: 13,
          fontWeight: 500,
          maxWidth: "85%",
          boxShadow: "0 4px 12px -4px rgba(124,58,237,.5)",
        }}
      >
        {texto}
      </div>
    </div>
  );
}

function Pensando() {
  return (
    <div style={{ display: "flex", gap: 9, alignItems: "center" }}>
      <div style={avatarIA}>
        <Sparkles size={15} color="#fff" />
      </div>
      <div
        style={{
          background: "#fff",
          border: `1px solid ${LINE}`,
          borderRadius: 12,
          padding: "9px 13px",
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          color: MUTED,
          fontSize: 12.5,
        }}
      >
        <Loader2 size={14} style={{ animation: "dm-spin 1s linear infinite", color: VIOLETA }} />
        Analizando…
      </div>
    </div>
  );
}

function MensajeDamarIA({ mensaje }) {
  return (
    <div style={{ display: "flex", gap: 9, alignItems: "flex-start", animation: "dm-in .2s ease" }}>
      <div style={avatarIA}>
        <Sparkles size={15} color="#fff" />
      </div>
      <div
        style={{
          flex: 1,
          minWidth: 0,
          background: "#fff",
          border: `1px solid ${LINE}`,
          borderRadius: 12,
          borderTopLeftRadius: 4,
          padding: 13,
          boxShadow: "0 1px 2px rgba(16,24,40,.05)",
        }}
      >
        {mensaje.error ? (
          <div style={{ display: "flex", alignItems: "flex-start", gap: 7, color: "#b91c1c", fontSize: 12.5, lineHeight: 1.5 }}>
            <AlertCircle size={15} style={{ flexShrink: 0, marginTop: 1 }} /> {mensaje.error}
          </div>
        ) : (
          <RespuestaDamarIA respuesta={mensaje.respuesta} />
        )}
      </div>
    </div>
  );
}

function RespuestaDamarIA({ respuesta }) {
  const { resumen, grafico, sql, datos } = respuesta || {};
  const hayDatos = Array.isArray(datos) && datos.length > 0;
  return (
    <div>
      <div style={{ fontSize: 13, lineHeight: 1.6, color: INK }}>
        <RenderTexto texto={resumen || "Sin respuesta."} />
      </div>

      {grafico && hayDatos && (
        <div style={{ marginTop: 12 }}>
          {grafico.titulo && (
            <div style={{ fontSize: 11.5, fontWeight: 700, color: MUTED, marginBottom: 5 }}>
              {grafico.titulo}
            </div>
          )}
          <Grafico grafico={grafico} datos={datos} />
        </div>
      )}

      {hayDatos && (
        <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
          <button
            type="button"
            className="dm-export"
            onClick={() => exportarExcel(datos)}
            style={btnExportar}
          >
            <Download size={13} /> Exportar a Excel
          </button>
          <Colapsable titulo={`Datos (${datos.length} fila${datos.length === 1 ? "" : "s"})`} icono={Table2}>
            <TablaDatos datos={datos} />
          </Colapsable>
          {sql && (
            <Colapsable titulo="Consulta SQL" icono={Code2}>
              <pre style={bloqueSql}>{sql}</pre>
            </Colapsable>
          )}
        </div>
      )}
    </div>
  );
}

function Colapsable({ titulo, icono: Icono, children }) {
  const [abierto, setAbierto] = useState(false);
  return (
    <div style={{ border: `1px solid ${LINE}`, borderRadius: 9, overflow: "hidden" }}>
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 7,
          width: "100%",
          padding: "7px 10px",
          background: abierto ? "#f8fafc" : "#fff",
          border: "none",
          cursor: "pointer",
          fontSize: 11.5,
          fontWeight: 600,
          color: "#475569",
        }}
      >
        <Icono size={13} style={{ color: VIOLETA }} />
        <span style={{ flex: 1, textAlign: "left" }}>{titulo}</span>
        <ChevronDown
          size={14}
          style={{ transform: abierto ? "rotate(180deg)" : "none", transition: "transform .15s ease" }}
        />
      </button>
      {abierto && <div style={{ borderTop: `1px solid ${LINE}` }}>{children}</div>}
    </div>
  );
}

function TablaDatos({ datos }) {
  const filas = datos.slice(0, 60);
  const columnas = datos.length > 0 ? Object.keys(datos[0]) : [];
  return (
    <div style={{ overflowX: "auto", maxHeight: 260, overflowY: "auto" }} className="dm-scroll">
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11.5 }}>
        <thead>
          <tr>
            {columnas.map((c) => (
              <th
                key={c}
                style={{
                  textAlign: "left",
                  padding: "6px 9px",
                  position: "sticky",
                  top: 0,
                  background: "#f1f5f9",
                  color: "#475569",
                  fontWeight: 700,
                  whiteSpace: "nowrap",
                  borderBottom: `1px solid ${LINE}`,
                }}
              >
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {filas.map((f, i) => (
            <tr key={i} style={{ borderBottom: "1px solid #f1f4f7" }}>
              {columnas.map((c) => (
                <td key={c} style={{ padding: "5px 9px", color: "#334155", whiteSpace: "nowrap" }}>
                  {fmtCelda(f[c])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {datos.length > filas.length && (
        <div style={{ padding: "7px 9px", fontSize: 11, color: FAINT }}>
          Mostrando {filas.length} de {datos.length} filas.
        </div>
      )}
    </div>
  );
}

/* ── Gráficos ────────────────────────────────────────────────────────── */

function Grafico({ grafico, datos }) {
  const campoY = grafico.camposY?.[0];
  const campoX = grafico.campoX;
  if (!campoX || !campoY || !datos?.length) return null;
  if (!(campoX in datos[0]) || !(campoY in datos[0])) return null;
  const props = { datos, campoX, campoY };
  if (grafico.tipo === "linea") return <GraficoLineas {...props} />;
  if (grafico.tipo === "torta") return <GraficoTorta {...props} />;
  return <GraficoBarras {...props} />;
}

function GraficoBarras({ datos, campoX, campoY }) {
  const filas = datos.slice(0, 20);
  const valores = filas.map((f) => Number(f[campoY]) || 0);
  const max = Math.max(...valores, 1);
  const W = 720, H = 300, padL = 10, padR = 10, padT = 22, padB = 78;
  const areaW = W - padL - padR;
  const areaH = H - padT - padB;
  const n = filas.length;
  const slot = areaW / Math.max(n, 1);
  const barW = Math.min(slot * 0.6, 52);
  const rotar = n > 5;

  return (
    <div style={cajaGrafico}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block" }}>
        <defs>
          <linearGradient id="dm-bar" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#8b5cf6" />
            <stop offset="100%" stopColor="#6d28d9" />
          </linearGradient>
        </defs>
        {[0, 0.25, 0.5, 0.75, 1].map((t) => {
          const y = padT + areaH - t * areaH;
          return (
            <g key={t}>
              <line x1={padL} y1={y} x2={W - padR} y2={y} stroke="#eef1f4" strokeWidth="1" />
              <text x={padL} y={y - 3} fontSize="10" fill="#94a3b8">
                {fmtNum(Math.round(max * t))}
              </text>
            </g>
          );
        })}
        {filas.map((f, i) => {
          const v = Number(f[campoY]) || 0;
          const h = Math.max(2, (v / max) * areaH);
          const x = padL + slot * i + (slot - barW) / 2;
          const y = padT + areaH - h;
          const lx = x + barW / 2;
          return (
            <g key={i}>
              <rect x={x} y={y} width={barW} height={h} rx={5} fill="url(#dm-bar)" />
              <text x={lx} y={y - 6} textAnchor="middle" fontSize="11" fontWeight="700" fill={INK}>
                {fmtNum(v)}
              </text>
              <text
                x={lx}
                y={padT + areaH + 15}
                textAnchor={rotar ? "end" : "middle"}
                fontSize="11"
                fill="#64748b"
                transform={rotar ? `rotate(-34 ${lx} ${padT + areaH + 15})` : undefined}
              >
                {truncar(f[campoX], rotar ? 20 : 11)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function GraficoLineas({ datos, campoX, campoY }) {
  const filas = datos.slice(0, 40);
  const valores = filas.map((f) => Number(f[campoY]) || 0);
  const max = Math.max(...valores, 1);
  const min = Math.min(...valores, 0);
  const rango = max - min || 1;
  const W = 720, H = 290, padL = 10, padR = 14, padT = 22, padB = 56;
  const areaW = W - padL - padR;
  const areaH = H - padT - padB;
  const n = filas.length;
  const px = (i) => padL + (n <= 1 ? areaW / 2 : (areaW * i) / (n - 1));
  const py = (v) => padT + areaH - ((v - min) / rango) * areaH;
  const puntos = filas.map((f, i) => ({
    x: px(i),
    y: py(Number(f[campoY]) || 0),
    et: f[campoX],
  }));
  const linea = puntos.map((p) => `${p.x},${p.y}`).join(" ");
  const area = `${padL},${padT + areaH} ${linea} ${puntos[puntos.length - 1]?.x || padL},${padT + areaH}`;
  const paso = Math.ceil(n / 7);

  return (
    <div style={cajaGrafico}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block" }}>
        <defs>
          <linearGradient id="dm-line" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(124,58,237,.28)" />
            <stop offset="100%" stopColor="rgba(124,58,237,0)" />
          </linearGradient>
        </defs>
        {[0, 0.5, 1].map((t) => {
          const y = padT + areaH - t * areaH;
          return <line key={t} x1={padL} y1={y} x2={W - padR} y2={y} stroke="#eef1f4" strokeWidth="1" />;
        })}
        <polygon points={area} fill="url(#dm-line)" />
        <polyline
          points={linea}
          fill="none"
          stroke={VIOLETA}
          strokeWidth="2.5"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {puntos.map((p, i) => (
          <g key={i}>
            <circle cx={p.x} cy={p.y} r={3.5} fill="#fff" stroke={VIOLETA} strokeWidth="2" />
            {i % paso === 0 && (
              <text x={p.x} y={padT + areaH + 16} textAnchor="middle" fontSize="10" fill="#64748b">
                {truncar(p.et, 11)}
              </text>
            )}
          </g>
        ))}
      </svg>
    </div>
  );
}

function GraficoTorta({ datos, campoX, campoY }) {
  const filas = datos
    .slice(0, 10)
    .map((f) => ({ etiqueta: String(f[campoX] ?? "—"), valor: Math.max(0, Number(f[campoY]) || 0) }))
    .filter((f) => f.valor > 0);
  const total = filas.reduce((a, f) => a + f.valor, 0) || 1;
  const cx = 110, cy = 110, r = 100, rInt = 58;
  let ang = -Math.PI / 2;
  const segs = filas.map((f, i) => {
    const a0 = ang;
    const a1 = ang + (f.valor / total) * Math.PI * 2;
    ang = a1;
    return { ...f, a0, a1, color: PALETA[i % PALETA.length], pct: f.valor / total };
  });

  return (
    <div style={{ ...cajaGrafico, display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
      <svg viewBox="0 0 220 220" width="150" height="150" style={{ flexShrink: 0 }}>
        {segs.length === 1 ? (
          <circle cx={cx} cy={cy} r={(r + rInt) / 2} fill="none" stroke={segs[0].color} strokeWidth={r - rInt} />
        ) : (
          segs.map((s, i) => <path key={i} d={arcoDonut(cx, cy, r, rInt, s.a0, s.a1)} fill={s.color} />)
        )}
      </svg>
      <div style={{ flex: 1, minWidth: 150, display: "flex", flexDirection: "column", gap: 6 }}>
        {segs.map((s, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 11.5 }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: s.color, flexShrink: 0 }} />
            <span style={{ flex: 1, color: "#334155", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {s.etiqueta}
            </span>
            <span style={{ fontWeight: 700, color: INK }}>{fmtNum(s.valor)}</span>
            <span style={{ color: FAINT, width: 38, textAlign: "right" }}>
              {(s.pct * 100).toFixed(1)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function DamarIANoConfig() {
  return (
    <div style={{ padding: "26px 22px", textAlign: "center", overflowY: "auto" }}>
      <div style={{ ...avatarHeader, width: 56, height: 56, borderRadius: 17, margin: "0 auto 14px" }}>
        <Database size={26} color="#fff" />
      </div>
      <h2 style={{ margin: "0 0 7px", fontSize: 15.5, fontWeight: 800, color: INK }}>
        DamarIA no está configurada
      </h2>
      <p style={{ margin: "0 0 14px", fontSize: 12.5, color: MUTED, lineHeight: 1.6 }}>
        Falta cargar una API key de Anthropic en el servidor.
      </p>
      <div
        style={{
          textAlign: "left",
          background: "#faf8ff",
          border: "1px solid #e9d5ff",
          borderRadius: 11,
          padding: "12px 14px",
          fontSize: 12,
          color: "#4b5563",
          lineHeight: 1.65,
        }}
      >
        <strong style={{ color: VIOLETA }}>Pasos:</strong>
        <ol style={{ margin: "5px 0 0", paddingLeft: 18 }}>
          <li>Crea una API key en console.anthropic.com.</li>
          <li>Pégala en backend/.env (ANTHROPIC_API_KEY=).</li>
          <li>Reinicia el backend.</li>
        </ol>
      </div>
    </div>
  );
}

/* ── Estilos ─────────────────────────────────────────────────────────── */
const ESTILOS = `
  @keyframes dm-spin { to { transform: rotate(360deg); } }
  @keyframes dm-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
  @keyframes dm-panel-in { from { opacity: 0; transform: translateY(20px) scale(.97); } to { opacity: 1; transform: none; } }
  @keyframes dm-fab-in { from { opacity: 0; transform: scale(.6); } to { opacity: 1; transform: none; } }
  .dm-fab { animation: dm-fab-in .2s ease; transition: transform .14s ease, box-shadow .14s ease; }
  .dm-fab:hover { transform: translateY(-3px) scale(1.04); box-shadow: 0 14px 32px -8px rgba(124,58,237,.7); }
  .dm-panel { animation: dm-panel-in .2s ease; }
  .dm-input:focus { outline: none; border-color: #7c3aed; box-shadow: 0 0 0 3px rgba(124,58,237,.13); background: #fff; }
  .dm-ejemplo { transition: border-color .14s ease, background .14s ease; }
  .dm-ejemplo:hover:not(:disabled) { border-color: #7c3aed; background: #faf8ff; }
  .dm-export { transition: background .14s ease, border-color .14s ease; }
  .dm-export:hover { background: #f3e8ff; border-color: #c084fc; }
  .dm-scroll::-webkit-scrollbar { width: 8px; height: 8px; }
  .dm-scroll::-webkit-scrollbar-thumb { background: #d8d5e4; border-radius: 6px; border: 2px solid transparent; background-clip: padding-box; }
`;

const fab = {
  position: "fixed",
  bottom: 26,
  right: 26,
  width: 58,
  height: 58,
  borderRadius: "50%",
  border: "none",
  background: `linear-gradient(135deg, #8b5cf6, #6d28d9)`,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
  zIndex: 11500,
  boxShadow: "0 10px 26px -6px rgba(124,58,237,.6)",
};

const panel = {
  position: "fixed",
  bottom: 26,
  right: 26,
  width: "min(404px, calc(100vw - 32px))",
  height: "min(640px, calc(100vh - 110px))",
  background: "#fff",
  borderRadius: 18,
  overflow: "hidden",
  display: "flex",
  flexDirection: "column",
  zIndex: 11500,
  boxShadow: "0 24px 64px -12px rgba(15,23,42,.42), 0 0 0 1px rgba(15,23,42,.06)",
};

const header = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "13px 15px",
  background: `linear-gradient(135deg, ${VIOLETA}, ${VIOLETA_OSC})`,
  color: "#fff",
  flexShrink: 0,
};

const avatarHeader = {
  width: 36,
  height: 36,
  borderRadius: 11,
  background: "rgba(255,255,255,.18)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  flexShrink: 0,
};

const avatarIA = {
  width: 30,
  height: 30,
  borderRadius: 9,
  background: "linear-gradient(135deg, #8b5cf6, #6d28d9)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  flexShrink: 0,
  boxShadow: "0 4px 9px -3px rgba(124,58,237,.55)",
};

const btnCerrar = {
  background: "rgba(255,255,255,.16)",
  border: "none",
  color: "#fff",
  width: 30,
  height: 30,
  borderRadius: 9,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
};

const zonaChat = {
  flex: 1,
  overflowY: "auto",
  padding: "14px 13px",
  background: "#f7f7fb",
};

const barraInput = {
  display: "flex",
  gap: 8,
  padding: "11px 12px",
  borderTop: `1px solid ${LINE}`,
  background: "#fff",
  flexShrink: 0,
};

const input = {
  flex: 1,
  height: 40,
  padding: "0 14px",
  borderRadius: 20,
  border: `1px solid ${LINE}`,
  fontSize: 13,
  color: INK,
  background: "#f6f7f9",
  outline: "none",
  boxSizing: "border-box",
  transition: "border-color .14s ease, box-shadow .14s ease, background .14s ease",
};

const btnEnviar = {
  width: 40,
  height: 40,
  borderRadius: "50%",
  border: "none",
  background: `linear-gradient(135deg, ${VIOLETA}, ${VIOLETA_OSC})`,
  color: "#fff",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  flexShrink: 0,
};

const chipEjemplo = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  width: "100%",
  padding: "10px 12px",
  borderRadius: 10,
  border: `1px solid ${LINE}`,
  background: "#fff",
  cursor: "pointer",
  fontSize: 12.5,
  fontWeight: 500,
  color: "#334155",
  textAlign: "left",
};

const btnExportar = {
  display: "inline-flex",
  alignItems: "center",
  gap: 7,
  alignSelf: "flex-start",
  padding: "7px 12px",
  borderRadius: 9,
  border: "1px solid #d8b4fe",
  background: "#faf8ff",
  color: VIOLETA,
  fontSize: 12,
  fontWeight: 700,
  cursor: "pointer",
};

const cajaGrafico = {
  background: "#fff",
  border: `1px solid ${LINE}`,
  borderRadius: 10,
  padding: 10,
};

const bloqueSql = {
  margin: 0,
  padding: "10px 12px",
  background: "#0f172a",
  color: "#e2e8f0",
  fontSize: 11,
  lineHeight: 1.55,
  overflowX: "auto",
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
};
