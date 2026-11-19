import { useCallback, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import "./e360.css";

/* ============================================================================
   Evaluación 360° — piezas compartidas
   ----------------------------------------------------------------------------
   Constantes del dominio (relaciones, plantillas de competencias, unidades de
   los objetivos), formato de números y los componentes chicos que usan el
   panel de RR.HH., el formulario del evaluador y el informe.
============================================================================ */

// La relación se lee DESDE EL EVALUADO. Los colores son la paleta categórica
// validada (separación para daltonismo); el nombre va siempre junto al color.
export const RELACIONES = [
  { key: "auto", label: "Autoevaluación", corto: "Auto", color: "#2a78d6", comoEvaluador: "Tu autoevaluación" },
  { key: "jefatura", label: "Jefatura", corto: "Jefatura", color: "#1baf7a", comoEvaluador: "Evalúas a alguien de tu equipo" },
  { key: "par", label: "Pares", corto: "Pares", color: "#eda100", comoEvaluador: "Evalúas a un par" },
  { key: "reporte", label: "Equipo a cargo", corto: "Equipo", color: "#e87ba4", comoEvaluador: "Evalúas a tu jefatura" },
  { key: "otro", label: "Otros evaluadores", corto: "Otros", color: "#6250d6", comoEvaluador: "Evalúas como cliente interno" },
];
export const REL = Object.fromEntries(RELACIONES.map((r) => [r.key, r]));
// Grupos que solo existen en el informe.
export const COLOR_GRUPO = { ...Object.fromEntries(RELACIONES.map((r) => [r.key, r.color])), combinado: "#6250d6", otros: "#eb6834" };
// El amarillo es el único tono donde el texto encima va oscuro.
export const TEXTO_OSCURO_SOBRE = new Set(["#eda100"]);

export const ESTADOS_CICLO = {
  borrador: "Borrador",
  activo: "En curso",
  cerrado: "Cerrado",
  publicado: "Publicado",
};
export const FLUJO = ["borrador", "activo", "cerrado", "publicado"];
export const ESTADOS_FORM = { pendiente: "Pendiente", en_progreso: "En progreso", enviada: "Enviada" };

export const UNIDADES = [
  { value: "porcentaje", label: "Porcentaje (%)", detalle: "Ej: 95 % de pedidos sin error" },
  { value: "numero", label: "Número", detalle: "Ej: 12 visitas al mes" },
  { value: "monto", label: "Monto ($)", detalle: "Ej: ventas netas del período" },
  { value: "si_no", label: "Sí / No", detalle: "Se cumple o no se cumple" },
];

// ── Formato ────────────────────────────────────────────────────────────────
export const fmtFecha = (v) => {
  if (!v) return "—";
  const d = new Date(String(v).length <= 10 ? `${v}T00:00:00` : v);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("es-CL", { day: "2-digit", month: "short", year: "numeric" });
};
export const fmtNota = (v, dec = 1) =>
  v === null || v === undefined || Number.isNaN(Number(v)) ? "—" : Number(v).toLocaleString("es-CL", { minimumFractionDigits: dec, maximumFractionDigits: dec });
export const fmtPct = (v, dec = 0) =>
  v === null || v === undefined || Number.isNaN(Number(v)) ? "—" : `${Number(v).toLocaleString("es-CL", { maximumFractionDigits: dec })} %`;
export const fmtValorObjetivo = (v, unidad) => {
  if (v === null || v === undefined || v === "") return "—";
  const n = Number(v);
  if (unidad === "si_no") return n >= 1 ? "Sí" : "No";
  if (unidad === "monto") return `$${Math.round(n).toLocaleString("es-CL")}`;
  if (unidad === "porcentaje") return `${n.toLocaleString("es-CL", { maximumFractionDigits: 2 })} %`;
  return n.toLocaleString("es-CL", { maximumFractionDigits: 2 });
};
export const iniciales = (nombre) =>
  String(nombre || "?").trim().split(/\s+/).slice(0, 2).map((p) => p[0] || "").join("").toUpperCase() || "?";
// Nombre y primer apellido: para chips donde el nombre completo no cabe.
export const nombreCorto = (nombre) => String(nombre || "").trim().split(/\s+/).slice(0, 2).join(" ");
export const nombreCompleto = (e) => `${e?.nombre || ""} ${e?.apellidos || ""}`.trim() || "—";
export const diasPara = (fecha) => {
  if (!fecha) return null;
  const f = new Date(`${String(fecha).slice(0, 10)}T00:00:00`);
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  return Math.round((f - hoy) / 86400000);
};

// ── Color de una nota: un solo tono, más oscuro = más alto ──────────────────
const RAMPA = ["#e8f7f7", "#b2e4e5", "#7fd0d2", "#28aeb1", "#1e9295", "#0e6e74"];
const aRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
export function colorNota(valor, max = 5) {
  if (valor === null || valor === undefined) return null;
  const t = Math.min(1, Math.max(0, (Number(valor) - 1) / Math.max(1, max - 1)));
  const pos = t * (RAMPA.length - 1);
  const i = Math.min(RAMPA.length - 2, Math.floor(pos));
  const a = aRgb(RAMPA[i]);
  const b = aRgb(RAMPA[i + 1]);
  const mezcla = a.map((c, k) => Math.round(c + (b[k] - c) * (pos - i)));
  return { fondo: `rgb(${mezcla.join(",")})`, texto: t >= 0.72 ? "#ffffff" : "#083b3f" };
}

// Nivel de desempeño → tono (rojo, ámbar, teal, verde) según su posición.
export const tonoNivel = (nivel) => {
  if (!nivel) return 2;
  const r = nivel.total > 1 ? nivel.indice / (nivel.total - 1) : 1;
  return r < 0.25 ? 0 : r < 0.5 ? 1 : r < 0.75 ? 2 : 3;
};

// ── Plantillas de competencias ──────────────────────────────────────────────
const c = (nombre, categoria, descripcion, relaciones = null) => ({ nombre, categoria, descripcion, peso: 1, relaciones });
const BASE = [
  c("Calidad del trabajo", "Resultados", "Entrega trabajos completos y prolijos, sin errores que obliguen a rehacerlos."),
  c("Cumplimiento de plazos y compromisos", "Resultados", "Hace lo que dijo que haría, cuando dijo que lo haría, y avisa a tiempo si algo se atrasa."),
  c("Trabajo en equipo", "Colaboración", "Coopera, comparte información y ayuda a que el equipo logre sus metas."),
  c("Comunicación", "Colaboración", "Se expresa con claridad, escucha y mantiene informadas a las personas que lo necesitan."),
  c("Orientación al cliente", "Colaboración", "Entiende lo que necesita el cliente —externo o interno— y responde con rapidez y buen trato."),
  c("Iniciativa y autonomía", "Actitud", "Propone mejoras y resuelve sin esperar que le digan cada paso."),
  c("Adaptación y aprendizaje", "Actitud", "Incorpora cambios y herramientas nuevas, y aprende de sus errores."),
  c("Compromiso", "Actitud", "Cuida los recursos y la imagen de la empresa y actúa de acuerdo con sus valores."),
];
const LIDERAZGO = [
  c("Dirección y claridad de objetivos", "Liderazgo", "Deja claro qué se espera de cada persona y cuáles son las prioridades.", ["reporte"]),
  c("Retroalimentación y desarrollo", "Liderazgo", "Reconoce lo que se hace bien, corrige con respeto y ayuda a su equipo a crecer.", ["reporte"]),
  c("Delegación y confianza", "Liderazgo", "Entrega responsabilidades con el respaldo y la autonomía necesarios.", ["reporte"]),
  c("Trato y respeto", "Liderazgo", "Trata a todas las personas con respeto y de forma justa, también bajo presión.", ["reporte"]),
  c("Toma de decisiones", "Liderazgo", "Decide a tiempo, con información, y se hace cargo del resultado.", ["reporte", "jefatura"]),
];
const COMERCIAL = [
  c("Cumplimiento de metas de venta", "Resultados", "Alcanza las metas de venta y de margen comprometidas para el período."),
  c("Gestión de cartera y seguimiento", "Resultados", "Mantiene su cartera al día: visitas, llamadas, cotizaciones y cobranza con seguimiento."),
  c("Conocimiento de productos", "Resultados", "Domina el catálogo y asesora al cliente con criterio técnico."),
  c("Orientación al cliente", "Colaboración", "Responde con rapidez, resuelve problemas y cuida la relación de largo plazo."),
  c("Trabajo con bodega, despacho y facturación", "Colaboración", "Coordina con las otras áreas entregando la información completa y a tiempo."),
  c("Orden en los registros", "Actitud", "Deja en la plataforma cotizaciones, bitácora y documentos completos y correctos."),
  c("Iniciativa comercial", "Actitud", "Busca clientes y oportunidades nuevas sin esperar que se las asignen."),
];
const PREGUNTAS_BASE = [
  { texto: "¿Qué es lo que mejor hace y debería seguir haciendo?", obligatoria: true },
  { texto: "¿Qué le recomendarías cambiar o mejorar?", obligatoria: true },
  { texto: "¿Algo más que quieras agregar?", obligatoria: false },
];
export const PLANTILLAS = [
  {
    key: "integral",
    nombre: "Integral 360°",
    detalle: "8 competencias para todos + 5 de liderazgo que responde el equipo a cargo",
    competencias: [...BASE, ...LIDERAZGO],
    preguntas: PREGUNTAS_BASE,
  },
  { key: "general", nombre: "General", detalle: "8 competencias transversales, iguales para todos", competencias: BASE, preguntas: PREGUNTAS_BASE },
  { key: "comercial", nombre: "Equipo comercial", detalle: "7 competencias pensadas para ejecutivos de venta", competencias: COMERCIAL, preguntas: PREGUNTAS_BASE },
  { key: "vacia", nombre: "En blanco", detalle: "Parto de cero y armo mi propio instrumento", competencias: [], preguntas: [] },
];

export const ETIQUETAS_ESCALA = {
  3: ["Bajo lo esperado", "Cumple lo esperado", "Sobre lo esperado"],
  4: ["Insuficiente", "En desarrollo", "Cumple lo esperado", "Destacado"],
  5: ["Insuficiente", "En desarrollo", "Cumple lo esperado", "Destacado", "Sobresaliente"],
};
export const etiquetasEscala = (max) =>
  ETIQUETAS_ESCALA[max] || Array.from({ length: max }, (_, i) => (i === 0 ? "Muy bajo" : i === max - 1 ? "Excelente" : String(i + 1)));

export function configDesdePlantilla(key) {
  const p = PLANTILLAS.find((x) => x.key === key) || PLANTILLAS[0];
  return {
    escala: { max: 5, etiquetas: etiquetasEscala(5), permitir_na: true },
    competencias: p.competencias.map((x, i) => ({ ...x, id: `c${i + 1}` })),
    preguntas: p.preguntas.map((x, i) => ({ ...x, id: `p${i + 1}` })),
    pesos_relacion: { auto: 10, jefatura: 35, par: 25, reporte: 20, otro: 10 },
    peso_competencias: 70,
    peso_objetivos: 30,
    anonimo: true,
    min_anonimato: 3,
    comentario_obligatorio_hasta: 0,
    jefatura_ve_resultados: false,
    max_pares: 3,
    niveles: [
      { desde: 0, etiqueta: "Insuficiente" },
      { desde: 50, etiqueta: "En desarrollo" },
      { desde: 65, etiqueta: "Cumple lo esperado" },
      { desde: 80, etiqueta: "Destacado" },
      { desde: 90, etiqueta: "Sobresaliente" },
    ],
  };
}

// ── Componentes chicos ──────────────────────────────────────────────────────
export function Modal({ titulo, sub, ancho = 640, marca = false, onClose, children, pie }) {
  return createPortal(
    <div className="e360-velo" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div className="e360-modal" style={{ maxWidth: ancho }} role="dialog" aria-modal="true" aria-label={typeof titulo === "string" ? titulo : undefined}>
        <div className={`e360-modal-cab${marca ? " marca" : ""}`}>
          <div style={{ minWidth: 0 }}>
            <div className="e360-modal-titulo">{titulo}</div>
            {sub && <div className="e360-modal-sub">{sub}</div>}
          </div>
          <button type="button" className="e360-x" onClick={onClose} aria-label="Cerrar"><X size={17} /></button>
        </div>
        <div className="e360-modal-cuerpo">{children}</div>
        {pie && <div className="e360-modal-pie">{pie}</div>}
      </div>
    </div>,
    document.body,
  );
}

export function Campo({ label, ayuda, children, style }) {
  return (
    <div className="e360-campo" style={style}>
      {label && <label>{label}</label>}
      {children}
      {ayuda && <div className="e360-ayuda">{ayuda}</div>}
    </div>
  );
}

export function Interruptor({ checked, onChange, titulo, detalle, disabled }) {
  return (
    <label className="e360-interruptor" style={disabled ? { cursor: "not-allowed" } : undefined}>
      <input type="checkbox" checked={Boolean(checked)} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="riel" />
      <span>
        <b>{titulo}</b>
        {detalle && <small>{detalle}</small>}
      </span>
    </label>
  );
}

export function Persona({ nombre, cargo }) {
  return (
    <div className="e360-persona">
      <span className="e360-avatar">{iniciales(nombre)}</span>
      <div style={{ minWidth: 0 }}>
        <div className="e360-persona-nombre">{nombre || "—"}</div>
        {cargo && <div className="e360-persona-cargo">{cargo}</div>}
      </div>
    </div>
  );
}

export function RelChip({ relacion, etiqueta, n }) {
  const color = COLOR_GRUPO[relacion] || "#94a3b8";
  return (
    <span className="e360-rel">
      <i style={{ background: color }} />
      {etiqueta || REL[relacion]?.label || relacion}
      {n != null && <span style={{ fontWeight: 400, color: "var(--e360-ink-3)" }}>· {n}</span>}
    </span>
  );
}

export const PillEstado = ({ estado, etiquetas = ESTADOS_CICLO }) => (
  <span className={`e360-pill ${estado}`}>{etiquetas[estado] || estado}</span>
);

export const NivelPill = ({ nivel }) =>
  nivel ? <span className={`e360-nivel t${tonoNivel(nivel)}`}>{nivel.etiqueta}</span> : <span style={{ color: "var(--e360-ink-3)" }}>—</span>;

export function Avance({ hechos, total, fina }) {
  const pct = total > 0 ? Math.round((hechos / total) * 100) : 0;
  return (
    <div className="e360-avance" title={`${hechos} de ${total}`}>
      <div className={`e360-barra${fina ? " fina" : ""}`}><i style={{ width: `${pct}%` }} /></div>
      <span>{hechos}/{total}</span>
    </div>
  );
}

// Celda de nota con fondo de la rampa. El número siempre va escrito.
export function Calor({ valor, max = 5, titulo, dec = 1, ...rest }) {
  const col = colorNota(valor, max);
  if (!col) return <span className="e360-calor vacia" title={titulo}>—</span>;
  return (
    <span className="e360-calor" style={{ background: col.fondo, color: col.texto }} title={titulo} {...rest}>
      {fmtNota(valor, dec)}
    </span>
  );
}

// Tooltip flotante que sigue al puntero (para gráficos y celdas).
export function useTooltip() {
  const [tip, setTip] = useState(null);
  const mostrar = useCallback((e, contenido) => {
    const x = Math.min(e.clientX + 14, window.innerWidth - 270);
    const y = Math.min(e.clientY + 14, window.innerHeight - 130);
    setTip({ x, y, contenido });
  }, []);
  const ocultar = useCallback(() => setTip(null), []);
  const nodo = tip
    ? createPortal(<div className="e360-tooltip" style={{ left: tip.x, top: tip.y }}>{tip.contenido}</div>, document.body)
    : null;
  return { mostrar, ocultar, nodo };
}

/* Radar de competencias: «cómo te ves» contra «cómo te ven».
   Dos series como máximo (identidad por color + leyenda con nombre); la tabla
   de al lado lleva los mismos números. */
export function Radar({ ejes, max = 5, series }) {
  const { mostrar, ocultar, nodo } = useTooltip();
  const ancho = 460;
  const alto = 330;
  const cx = ancho / 2;
  const cy = alto / 2 + 2;
  const radio = 104;
  const n = ejes.length;
  const angulo = (i) => -Math.PI / 2 + (i * 2 * Math.PI) / n;
  const punto = (i, valor) => {
    const r = (Math.max(0, valor) / max) * radio;
    return [cx + r * Math.cos(angulo(i)), cy + r * Math.sin(angulo(i))];
  };
  const partir = (texto) => {
    const palabras = String(texto).split(/\s+/);
    const lineas = [""];
    for (const p of palabras) {
      const ultima = lineas[lineas.length - 1];
      if ((ultima + " " + p).trim().length <= 17 || !ultima) lineas[lineas.length - 1] = (ultima + " " + p).trim();
      else lineas.push(p);
    }
    if (lineas.length > 2) return [lineas[0], `${lineas[1].slice(0, 15)}…`];
    return lineas;
  };

  return (
    <div>
      <svg className="e360-radar" viewBox={`0 0 ${ancho} ${alto}`} width="100%" style={{ maxWidth: ancho, display: "block", margin: "0 auto" }} role="img"
        aria-label="Radar de competencias: autoevaluación contra la evaluación de los demás">
        {/* Anillos y ejes: líneas finas y continuas, un tono sobre el fondo. */}
        {Array.from({ length: max }, (_, k) => k + 1).map((nivel) => (
          <polygon key={nivel} fill="none" stroke={nivel === max ? "#cbd5e1" : "#e7ecf1"} strokeWidth="1"
            points={ejes.map((_, i) => punto(i, nivel).join(",")).join(" ")} />
        ))}
        {ejes.map((e, i) => {
          const [x, y] = punto(i, max);
          return <line key={e.id} x1={cx} y1={cy} x2={x} y2={y} stroke="#e7ecf1" strokeWidth="1" />;
        })}
        {[1, max].map((nivel) => (
          <text key={nivel} x={cx + 4} y={cy - (nivel / max) * radio + 3} fontSize="9.5" fill="#94a3b8">{nivel}</text>
        ))}

        {series.map((s) => {
          const pts = ejes.map((e, i) => (e[s.campo] === null || e[s.campo] === undefined ? null : punto(i, e[s.campo])));
          const completa = pts.every(Boolean);
          // Si a la serie le falta algún eje (una competencia que ese grupo no
          // responde) se unen solo los ejes vecinos que sí tiene, sin relleno:
          // una cuerda que saltara el hueco dibujaría un valor que no existe.
          const tramos = pts
            .map((p, i) => [p, pts[(i + 1) % pts.length]])
            .filter(([a, b]) => a && b)
            .map(([a, b]) => `M${a.join(",")}L${b.join(",")}`)
            .join("");
          return (
            <g key={s.campo}>
              {completa ? (
                <polygon points={pts.map((p) => p.join(",")).join(" ")} fill={s.color} fillOpacity={s.relleno ?? 0.1}
                  stroke={s.color} strokeWidth="2" strokeLinejoin="round" />
              ) : (
                <path d={tramos} fill="none" stroke={s.color} strokeWidth="2" strokeLinecap="round" />
              )}
              {pts.map((p, i) => p && <circle key={i} cx={p[0]} cy={p[1]} r="4" fill={s.color} stroke="#fff" strokeWidth="2" />)}
            </g>
          );
        })}

        {ejes.map((e, i) => {
          const a = angulo(i);
          const [x, y] = [cx + (radio + 14) * Math.cos(a), cy + (radio + 14) * Math.sin(a)];
          const ancla = Math.abs(Math.cos(a)) < 0.2 ? "middle" : Math.cos(a) > 0 ? "start" : "end";
          const lineas = partir(e.nombre);
          const subir = Math.sin(a) < -0.5 ? -(lineas.length - 1) * 11 : Math.abs(Math.sin(a)) <= 0.5 ? -((lineas.length - 1) * 11) / 2 : 6;
          return (
            <g key={e.id}>
              <text x={x} y={y + subir} textAnchor={ancla} fontSize="10.5" fontWeight="600" fill="#475569">
                {lineas.map((l, k) => <tspan key={k} x={x} dy={k === 0 ? 3 : 11}>{l}</tspan>)}
              </text>
              {/* Zona de puntero generosa: el eje completo, no el punto. */}
              <line x1={cx} y1={cy} x2={cx + (radio + 30) * Math.cos(a)} y2={cy + (radio + 30) * Math.sin(a)}
                stroke="transparent" strokeWidth="26" style={{ cursor: "default" }}
                onMouseMove={(ev) => mostrar(ev, (
                  <>
                    <b>{e.nombre}</b>
                    {series.map((s) => (
                      <div className="fila" key={s.campo}>
                        <span><i style={{ background: s.color }} />{s.nombre}</span>
                        <span>{fmtNota(e[s.campo])}</span>
                      </div>
                    ))}
                  </>
                ))}
                onMouseLeave={ocultar} />
            </g>
          );
        })}
      </svg>
      <div className="e360-leyenda" style={{ justifyContent: "center", marginTop: 4 }}>
        {series.map((s) => (
          <span className="e360-rel" key={s.campo}><i style={{ background: s.color }} />{s.nombre}</span>
        ))}
      </div>
      {nodo}
    </div>
  );
}
