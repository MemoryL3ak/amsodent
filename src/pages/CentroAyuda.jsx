// Centro de Ayuda (/ayuda) — visible para todos los usuarios autenticados.
// Manual visual de la plataforma (filtrado según el rol/permisos del usuario),
// guía de inicio para nuevos ingresos y DamarIA como asistente de ayuda.
// El contenido vive en src/data/manualAyuda.jsx; la base de conocimiento que
// usa DamarIA, en backend/src/ia/ayuda-conocimiento.ts.
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  Briefcase, Truck, PackageSearch, BarChart3, Trophy, Headphones, Wrench,
  Shield, Inbox, ClipboardList, FilePlus, FileText, Users, CalendarDays,
  Package, Boxes, Megaphone, CreditCard, Wallet, Landmark, MapPin, Banknote,
  KeyRound, Globe, LayoutDashboard, Scale, Target, SlidersHorizontal, Percent,
  Mail, MessagesSquare, Bell, CalendarCheck, Clock, UserCircle2, UserCog,
  Activity, Search, Send, Sparkles, BookOpen, Rocket, GraduationCap,
  ChevronRight, LifeBuoy, Download,
} from "lucide-react";
import { api } from "../lib/api";
import { supabase } from "../lib/supabase";
import { permisosFallback, esAdminRol } from "../constants/modulos";
import { SunflowerIcon } from "../components/DamarIAWidget";
import {
  FLUJO_NEGOCIO, CHECKLIST_INICIO, GRUPOS_MANUAL, GLOSARIO, FAQ,
} from "../data/manualAyuda";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3001/api";

const ICONOS = {
  Briefcase, Truck, PackageSearch, BarChart3, Trophy, Headphones, Wrench,
  Shield, Inbox, ClipboardList, FilePlus, FileText, Users, CalendarDays,
  Package, Boxes, Megaphone, CreditCard, Wallet, Landmark, MapPin, Banknote,
  KeyRound, Globe, LayoutDashboard, Scale, Target, SlidersHorizontal, Percent,
  Mail, MessagesSquare, Bell, CalendarCheck, Clock, UserCircle2, UserCog,
  Activity,
};

const ROLE_LABELS = {
  admin: "Administrador",
  administrador: "Administrador",
  jefe_ventas: "Jefe de Ventas",
  jefe_ventas_especial: "Jefe de Ventas Especial",
  ventas: "Ventas",
  ventas_especial: "Ventas Especial",
  contabilidad: "Contabilidad",
};

function Icono({ nombre, size = 16, ...rest }) {
  const Cmp = ICONOS[nombre] || FileText;
  return <Cmp size={size} {...rest} />;
}

// ¿El usuario puede ver este módulo del manual?
function puedeVer(mod, ctx) {
  const a = mod.acceso || { tipo: "todos" };
  if (ctx.esAdmin) return true;
  switch (a.tipo) {
    case "todos": return true;
    case "admin": return false;
    case "modulo": return ctx.permisos.includes(a.key);
    case "algunModulo": return (a.keys || []).some((k) => ctx.permisos.includes(k));
    case "roles": return (a.roles || []).includes(ctx.rolNorm);
    default: return true;
  }
}

// Markdown ligero (mismo espíritu que el widget de DamarIA): **negrita**,
// listas con "-" y pasos "1.". Suficiente para respuestas de ayuda.
function RenderTexto({ texto }) {
  const lineas = String(texto || "").split("\n");
  const bold = (s) =>
    s.split(/(\*\*[^*]+\*\*)/g).map((p, i) =>
      p.startsWith("**") && p.endsWith("**")
        ? <strong key={i}>{p.slice(2, -2)}</strong>
        : <span key={i}>{p}</span>
    );
  return (
    <div className="ayuda-md">
      {lineas.map((l, i) => {
        const t = l.trim();
        if (!t) return <div key={i} style={{ height: 6 }} />;
        if (/^[-•]\s+/.test(t)) {
          return (
            <div key={i} className="ayuda-md-li">
              <span className="ayuda-md-dot" />
              <span>{bold(t.replace(/^[-•]\s+/, ""))}</span>
            </div>
          );
        }
        const num = t.match(/^(\d+)[.)]\s+(.*)$/);
        if (num) {
          return (
            <div key={i} className="ayuda-md-li">
              <span className="ayuda-md-num">{num[1]}</span>
              <span>{bold(num[2])}</span>
            </div>
          );
        }
        return <p key={i}>{bold(t)}</p>;
      })}
    </div>
  );
}

/* ── Figuras del manual (ilustraciones hechas con el design system) ────── */

const TONO = {
  success: { bg: "var(--success-bg)", fg: "var(--success)" },
  warning: { bg: "var(--warning-bg)", fg: "var(--warning)" },
  danger: { bg: "var(--danger-bg)", fg: "var(--danger)" },
  primary: { bg: "var(--primary-light)", fg: "var(--primary-dark)" },
  neutral: { bg: "var(--neutral-bg)", fg: "var(--text-soft)" },
};

function FiguraFlujo({ pasos }) {
  return (
    <div className="ayuda-figura">
      <div className="ayuda-fig-flujo">
        {pasos.map((p, i) => (
          <div key={i} className="ayuda-fig-flujo-item">
            <span className="ayuda-fig-flujo-nodo">{p}</span>
            {i < pasos.length - 1 && <ChevronRight size={14} className="ayuda-fig-flecha" />}
          </div>
        ))}
      </div>
    </div>
  );
}

function FiguraKpis({ items }) {
  return (
    <div className="ayuda-figura">
      <div className="ayuda-fig-kpis">
        {items.map((k, i) => {
          const t = TONO[k.tone] || TONO.neutral;
          return (
            <div key={i} className="ayuda-fig-kpi" style={{ borderTopColor: t.fg }}>
              <span className="ayuda-fig-kpi-label">{k.label}</span>
              <span className="ayuda-fig-kpi-valor" style={{ color: t.fg }}>—</span>
            </div>
          );
        })}
      </div>
      <div className="ayuda-fig-pie">Los KPIs reales se abren con clic y muestran sus filas.</div>
    </div>
  );
}

function FiguraTabla({ titulo, cols, rows }) {
  return (
    <div className="ayuda-figura">
      {titulo && <div className="ayuda-fig-titulo">{titulo}</div>}
      <div className="table-wrap" style={{ boxShadow: "none" }}>
        <table className="data-table" style={{ fontSize: 12.5 }}>
          <thead>
            <tr>{cols.map((c, i) => <th key={i}>{c}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FiguraChips({ titulo, items }) {
  return (
    <div className="ayuda-figura">
      {titulo && <div className="ayuda-fig-titulo">{titulo}</div>}
      <div className="ayuda-fig-chips">
        {items.map((c, i) => {
          const t = TONO[c.tone] || TONO.neutral;
          return (
            <span key={i} className="ayuda-fig-chip" style={{ background: t.bg, color: t.fg }}>
              {c.t}
            </span>
          );
        })}
      </div>
    </div>
  );
}

// El árbol documental del Detalle de Cotización.
function FiguraArbolDocs() {
  const Nodo = ({ children, tone = "primary", nivel = 0 }) => {
    const t = TONO[tone];
    return (
      <div className="ayuda-fig-arbol-fila" style={{ paddingLeft: nivel * 26 }}>
        {nivel > 0 && <span className="ayuda-fig-arbol-codo" />}
        <span className="ayuda-fig-chip" style={{ background: t.bg, color: t.fg }}>{children}</span>
      </div>
    );
  };
  return (
    <div className="ayuda-figura">
      <div className="ayuda-fig-titulo">El árbol de documentos (montos en neto)</div>
      <Nodo tone="primary">Orden de Compra del cliente</Nodo>
      <Nodo tone="neutral" nivel={1}>Guía de despacho (empresa + N° seguimiento)</Nodo>
      <Nodo tone="neutral" nivel={1}>Factura / Boleta</Nodo>
      <Nodo tone="success" nivel={2}>Comprobante de pago · Webpay · Efectivo</Nodo>
      <Nodo tone="danger" nivel={2}>Nota de crédito (resta del saldo)</Nodo>
    </div>
  );
}

function FiguraReglaOro() {
  return (
    <div className="ayuda-figura ayuda-fig-regla">
      <Sparkles size={16} style={{ color: "var(--primary-dark)", flexShrink: 0 }} />
      <div>
        <strong>Regla de oro:</strong> sin documento no hay adjudicada. Pública = OC ·
        Particular = boleta/efectivo. <strong>Adjudicado</strong> = Σ OC (neto) ·{" "}
        <strong>Ventas</strong> = Σ guías de despacho (neto).
      </div>
    </div>
  );
}

function FiguraFormula() {
  return (
    <div className="ayuda-figura">
      <div className="ayuda-fig-titulo">La fórmula</div>
      <div className="ayuda-fig-formula">
        Comisión = ( <em>Full venta</em> + <em>Full productividad</em> ) × <em>×Margen</em> × <em>×Conversión</em>
      </div>
      <div className="ayuda-fig-pie">
        Cada métrica cae en un tramo ("Desde") de las 4 tablas del canal del vendedor.
      </div>
    </div>
  );
}

function Figura({ figura }) {
  if (!figura) return null;
  switch (figura.tipo) {
    case "flujo": return <FiguraFlujo pasos={figura.pasos} />;
    case "kpis": return <FiguraKpis items={figura.items} />;
    case "tabla": return <FiguraTabla titulo={figura.titulo} cols={figura.cols} rows={figura.rows} />;
    case "chips": return <FiguraChips titulo={figura.titulo} items={figura.items} />;
    case "arbol-docs": return <FiguraArbolDocs />;
    case "regla-oro": return <FiguraReglaOro />;
    case "formula": return <FiguraFormula />;
    default: return null;
  }
}

/* ── Sección de un módulo del manual ───────────────────────────────────── */

function SeccionModulo({ mod }) {
  const esRutaReal = typeof mod.ruta === "string" && mod.ruta.startsWith("/") && !mod.ruta.includes(":") && !mod.ruta.includes("·");
  return (
    <section id={`ayuda-${mod.id}`} className="surface ayuda-seccion">
      <div className="ayuda-seccion-head">
        <span className="ayuda-seccion-icono"><Icono nombre={mod.icono} size={18} /></span>
        <div style={{ minWidth: 0 }}>
          <h3 className="ayuda-seccion-titulo">{mod.titulo}</h3>
          <div className="ayuda-seccion-meta">
            {esRutaReal ? (
              <Link to={mod.ruta} className="ayuda-ruta-chip">{mod.ruta}</Link>
            ) : (
              <span className="ayuda-ruta-chip ayuda-ruta-chip-plana">{mod.ruta}</span>
            )}
            <span className="ayuda-quien">{mod.quien}</span>
          </div>
        </div>
      </div>

      {mod.resumen && <p className="ayuda-resumen">{mod.resumen}</p>}
      {(mod.queEs || []).map((p, i) => <p key={i} className="ayuda-parrafo">{p}</p>)}

      {mod.funciones?.length > 0 && (
        <ul className="ayuda-lista">
          {mod.funciones.map((f, i) => <li key={i}>{f}</li>)}
        </ul>
      )}

      {mod.pasos?.length > 0 && (
        <div className="ayuda-pasos">
          {mod.pasos.map((p, i) => (
            <div key={i} className="ayuda-paso">
              <span className="ayuda-paso-n">{i + 1}</span>
              <div><strong>{p.t}.</strong> {p.d}</div>
            </div>
          ))}
        </div>
      )}

      <Figura figura={mod.figura} />

      {mod.tips?.length > 0 && (
        <div className="ayuda-tips">
          {mod.tips.map((t, i) => (
            <div key={i} className="ayuda-tip">
              <Sparkles size={13} style={{ flexShrink: 0, marginTop: 2 }} />
              <span>{t}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/* ── Chat de DamarIA (guía de la plataforma) ───────────────────────────── */

const SUGERENCIAS_INICIALES = [
  "¿Cómo creo una cotización desde Mercado Público?",
  "¿Por qué mi adjudicada no aparece en el panel?",
  "¿Cómo se calcula mi comisión?",
];

function ChatAyuda({ perfil, permisos, rolNorm }) {
  const [mensajes, setMensajes] = useState([]);
  const [texto, setTexto] = useState("");
  const [cargando, setCargando] = useState(false);
  const [sugerencias, setSugerencias] = useState(SUGERENCIAS_INICIALES);
  const scrollRef = useRef(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [mensajes, cargando]);

  async function enviar(preguntaDirecta) {
    const pregunta = String(preguntaDirecta ?? texto).trim();
    if (!pregunta || cargando) return;
    setTexto("");
    setSugerencias([]);
    setCargando(true);
    setMensajes((m) => [...m, { role: "user", texto: pregunta }, { role: "assistant", texto: "" }]);

    // Historial: pares previos completos (sin el par en curso).
    const historial = [];
    for (const m of mensajes) {
      if (m.texto) historial.push({ role: m.role, content: m.texto });
    }

    try {
      const { data } = await supabase.auth.getSession();
      const token = data?.session?.access_token || "";
      const res = await fetch(`${API_URL}/ia/ayuda`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          pregunta,
          historial: historial.slice(-8),
          usuario: perfil?.nombre || "",
          rol: rolNorm,
          modulos: permisos,
        }),
      });
      if (!res.ok || !res.body) {
        let msg = "DamarIA no pudo responder. Inténtalo de nuevo.";
        try { msg = (await res.json())?.message || msg; } catch { /* sin json */ }
        throw new Error(msg);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      const actualizarUltimo = (fn) =>
        setMensajes((m) => {
          const copia = [...m];
          copia[copia.length - 1] = fn(copia[copia.length - 1]);
          return copia;
        });

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const eventos = buffer.split("\n\n");
        buffer = eventos.pop() || "";
        for (const ev of eventos) {
          const linea = ev.split("\n").find((l) => l.startsWith("data: "));
          if (!linea) continue;
          let evt;
          try { evt = JSON.parse(linea.slice(6)); } catch { continue; }
          if (evt.tipo === "delta") {
            actualizarUltimo((u) => ({ ...u, texto: (u.texto || "") + evt.texto }));
          } else if (evt.tipo === "done") {
            actualizarUltimo((u) => ({ ...u, texto: evt.texto || u.texto }));
            if (Array.isArray(evt.sugerencias) && evt.sugerencias.length) {
              setSugerencias(evt.sugerencias.slice(0, 3));
            }
          } else if (evt.tipo === "error") {
            actualizarUltimo((u) => ({ ...u, texto: evt.mensaje, esError: true }));
          }
        }
      }
    } catch (e) {
      setMensajes((m) => {
        const copia = [...m];
        copia[copia.length - 1] = {
          role: "assistant",
          texto: e?.message || "DamarIA no pudo responder. Inténtalo de nuevo.",
          esError: true,
        };
        return copia;
      });
    } finally {
      setCargando(false);
    }
  }

  const nombreCorto = (perfil?.nombre || "").split(" ")[0];

  return (
    <div className="ayuda-chat surface">
      <div className="ayuda-chat-head">
        <span className="ayuda-chat-girasol"><SunflowerIcon size={20} /></span>
        <div>
          <div className="ayuda-chat-marca">
            Damar<span>IA</span>
          </div>
          <div className="ayuda-chat-sub">Tu guía de la plataforma</div>
        </div>
      </div>

      <div className="ayuda-chat-scroll" ref={scrollRef}>
        {mensajes.length === 0 && (
          <div className="ayuda-chat-burbuja ayuda-chat-ia">
            <RenderTexto
              texto={`¡Hola${nombreCorto ? ` ${nombreCorto}` : ""}! 🌻 Soy **DamarIA**. Pregúntame lo que quieras sobre cómo usar la plataforma: flujos, botones, estados, reglas… Te respondo según tu rol.`}
            />
          </div>
        )}
        {mensajes.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="ayuda-chat-burbuja ayuda-chat-user">{m.texto}</div>
          ) : (
            <div
              key={i}
              className={`ayuda-chat-burbuja ayuda-chat-ia${m.esError ? " ayuda-chat-error" : ""}`}
            >
              {m.texto ? <RenderTexto texto={m.texto} /> : <span className="ayuda-chat-pensando">Pensando…</span>}
            </div>
          )
        )}
      </div>

      {sugerencias.length > 0 && (
        <div className="ayuda-chat-sugerencias">
          {sugerencias.map((s, i) => (
            <button key={i} type="button" onClick={() => enviar(s)} disabled={cargando}>
              {s}
            </button>
          ))}
        </div>
      )}

      <form
        className="ayuda-chat-form"
        onSubmit={(e) => { e.preventDefault(); enviar(); }}
      >
        <input
          className="input"
          placeholder="¿Cómo hago…?"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          maxLength={1000}
        />
        <button className="btn btn-primary ayuda-chat-enviar" type="submit" disabled={cargando || !texto.trim()}>
          <Send size={15} />
        </button>
      </form>
    </div>
  );
}

/* ── Página ────────────────────────────────────────────────────────────── */

export default function CentroAyuda() {
  const [perfil, setPerfil] = useState(null);
  const [tab, setTab] = useState("inicio");
  const [busqueda, setBusqueda] = useState("");
  const [generandoPDF, setGenerandoPDF] = useState(false);

  useEffect(() => {
    let vivo = true;
    api.get("/auth/profile")
      .then((p) => { if (vivo) setPerfil(p || null); })
      .catch(() => { if (vivo) setPerfil(null); });
    return () => { vivo = false; };
  }, []);

  const rolNorm = String(perfil?.rol || "").trim().toLowerCase();
  const esAdmin = esAdminRol(rolNorm);
  const permisos = useMemo(
    () => (Array.isArray(perfil?.permisos) ? perfil.permisos : permisosFallback(perfil?.rol)),
    [perfil]
  );
  const ctx = { esAdmin, permisos, rolNorm };

  // Grupos y módulos visibles para este usuario.
  const gruposVisibles = useMemo(() => {
    return GRUPOS_MANUAL
      .map((g) => ({ ...g, modulos: g.modulos.filter((m) => puedeVer(m, ctx)) }))
      .filter((g) => g.modulos.length > 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [esAdmin, permisos.join(","), rolNorm]);

  // Búsqueda sobre el manual visible.
  const q = busqueda.trim().toLowerCase();
  const gruposFiltrados = useMemo(() => {
    if (!q) return gruposVisibles;
    const coincide = (m) => {
      const bolsa = [
        m.titulo, m.resumen, m.quien, m.ruta,
        ...(m.queEs || []), ...(m.funciones || []), ...(m.tips || []),
        ...(m.pasos || []).map((p) => `${p.t} ${p.d}`),
      ].join(" ").toLowerCase();
      return bolsa.includes(q);
    };
    return gruposVisibles
      .map((g) => ({ ...g, modulos: g.modulos.filter(coincide) }))
      .filter((g) => g.modulos.length > 0);
  }, [q, gruposVisibles]);

  const totalResultados = gruposFiltrados.reduce((a, g) => a + g.modulos.length, 0);

  function irASeccion(id) {
    setTab("manual");
    setBusqueda("");
    // Espera al render de la pestaña manual antes de desplazar.
    setTimeout(() => {
      document.getElementById(`ayuda-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 60);
  }

  const rolLabel = ROLE_LABELS[rolNorm] || (perfil?.rol || "");
  const nombreCorto = (perfil?.nombre || "").split(" ")[0];

  // Exporta el manual (filtrado por el rol) como PDF con el diseño de marca.
  // La librería se carga bajo demanda para no engordar el bundle inicial.
  async function exportarPDF() {
    if (generandoPDF) return;
    setGenerandoPDF(true);
    try {
      const { descargarManualPDF } = await import("../lib/manualPDF");
      await descargarManualPDF({
        grupos: gruposVisibles,
        flujo: FLUJO_NEGOCIO,
        glosario: GLOSARIO,
        faq: FAQ,
        rolLabel,
        nombre: perfil?.nombre || "",
      });
    } catch (e) {
      console.error("No se pudo generar el PDF del manual:", e);
    } finally {
      setGenerandoPDF(false);
    }
  }

  return (
    <div className="page vista-compacta ayuda-page">
      {/* Hero */}
      <div className="ayuda-hero">
        <div className="ayuda-hero-texto">
          <div className="ayuda-hero-kicker"><LifeBuoy size={14} /> Centro de Ayuda</div>
          <h1>¿Cómo funciona la plataforma?</h1>
          <p>
            El manual completo de Amsodent{rolLabel ? <> — adaptado a tu rol de <strong>{rolLabel}</strong></> : ""}.
            Busca, recorre el flujo, o pregúntale directo a DamarIA.
          </p>
          <div className="ayuda-hero-acciones">
            <div className="ayuda-buscador">
              <Search size={16} />
              <input
                placeholder="Buscar en el manual… (ej: margen, guía de despacho, toma)"
                value={busqueda}
                onChange={(e) => {
                  setBusqueda(e.target.value);
                  if (e.target.value.trim()) setTab("manual");
                }}
              />
            </div>
            <button
              type="button"
              className="ayuda-btn-pdf"
              onClick={exportarPDF}
              disabled={generandoPDF}
              title="Descarga el manual completo de tu perfil, con diseño de marca"
            >
              <Download size={15} />
              {generandoPDF ? "Generando…" : "Manual en PDF"}
            </button>
          </div>
        </div>
      </div>

      <div className="ayuda-layout">
        <div className="ayuda-contenido">
          <div className="segmentado ayuda-tabs">
            <button className={tab === "inicio" ? "activo" : ""} onClick={() => setTab("inicio")}>
              <Rocket size={14} /> Guía de inicio
            </button>
            <button className={tab === "manual" ? "activo" : ""} onClick={() => setTab("manual")}>
              <BookOpen size={14} /> Manual por módulo
            </button>
            <button className={tab === "glosario" ? "activo" : ""} onClick={() => setTab("glosario")}>
              <GraduationCap size={14} /> Glosario y FAQ
            </button>
          </div>

          {/* ── Guía de inicio ── */}
          {tab === "inicio" && (
            <>
              <section className="surface ayuda-seccion">
                <h3 className="ayuda-seccion-titulo" style={{ marginBottom: 6 }}>
                  {nombreCorto ? `Bienvenid@, ${nombreCorto}` : "Bienvenid@ a Amsodent"} 👋
                </h3>
                <p className="ayuda-parrafo">
                  Esta plataforma administra todo el ciclo comercial de Amsodent: desde detectar una
                  licitación en Mercado Público hasta cobrar la factura y pagar la comisión. Tu menú
                  lateral muestra solo los módulos de tu rol{rolLabel ? <> (<strong>{rolLabel}</strong>)</> : ""} —
                  y esta guía también.
                </p>
              </section>

              <section className="surface ayuda-seccion">
                <h3 className="ayuda-seccion-titulo">El ciclo de una venta, en 8 pasos</h3>
                <p className="ayuda-parrafo" style={{ marginTop: 4 }}>
                  Haz clic en cualquier paso para ir a su capítulo del manual.
                </p>
                <div className="ayuda-flujo-grande">
                  {FLUJO_NEGOCIO.map((p) => (
                    <button key={p.n} type="button" className="ayuda-flujo-paso" onClick={() => irASeccion(p.id)}>
                      <span className="ayuda-flujo-n">{p.n}</span>
                      <div>
                        <div className="ayuda-flujo-titulo">{p.titulo}</div>
                        <div className="ayuda-flujo-detalle">{p.detalle}</div>
                      </div>
                    </button>
                  ))}
                </div>
              </section>

              <section className="surface ayuda-seccion">
                <h3 className="ayuda-seccion-titulo">Tu primera semana</h3>
                <div className="ayuda-pasos" style={{ marginTop: 10 }}>
                  {CHECKLIST_INICIO.map((c, i) => (
                    <div key={i} className="ayuda-paso">
                      <span className="ayuda-paso-n">{i + 1}</span>
                      <div><strong>{c.t}.</strong> {c.d}</div>
                    </div>
                  ))}
                </div>
              </section>

              <section className="surface ayuda-seccion">
                <h3 className="ayuda-seccion-titulo">Tus módulos</h3>
                <p className="ayuda-parrafo" style={{ marginTop: 4 }}>
                  Esto es lo que tu rol puede ver y usar hoy:
                </p>
                <div className="ayuda-mis-modulos">
                  {gruposVisibles.map((g) => (
                    <div key={g.id} className="ayuda-mis-grupo">
                      <div className="ayuda-mis-grupo-titulo">
                        <Icono nombre={g.icono} size={13} /> {g.titulo}
                      </div>
                      <div className="ayuda-fig-chips">
                        {g.modulos.map((m) => (
                          <button key={m.id} type="button" className="ayuda-fig-chip ayuda-chip-boton" onClick={() => irASeccion(m.id)}>
                            {m.titulo}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            </>
          )}

          {/* ── Manual por módulo ── */}
          {tab === "manual" && (
            <div className="ayuda-manual">
              <nav className="ayuda-indice">
                {gruposFiltrados.map((g) => (
                  <div key={g.id} className="ayuda-indice-grupo">
                    <div className="ayuda-indice-titulo">
                      <Icono nombre={g.icono} size={13} /> {g.titulo}
                    </div>
                    {g.modulos.map((m) => (
                      <button key={m.id} type="button" onClick={() => irASeccion(m.id)}>
                        {m.titulo}
                      </button>
                    ))}
                  </div>
                ))}
              </nav>
              <div className="ayuda-manual-cuerpo">
                {q && (
                  <div className="ayuda-resultado-buscar">
                    {totalResultados > 0
                      ? `${totalResultados} módulo${totalResultados === 1 ? "" : "s"} para "${busqueda.trim()}"`
                      : `Sin resultados para "${busqueda.trim()}" — pregúntale a DamarIA 🌻`}
                  </div>
                )}
                {gruposFiltrados.map((g) => (
                  <div key={g.id}>
                    <div className="ayuda-grupo-cabecera">
                      <Icono nombre={g.icono} size={15} /> {g.titulo}
                    </div>
                    {g.modulos.map((m) => <SeccionModulo key={m.id} mod={m} />)}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Glosario y FAQ ── */}
          {tab === "glosario" && (
            <>
              <section className="surface ayuda-seccion">
                <h3 className="ayuda-seccion-titulo">Glosario</h3>
                <div className="ayuda-glosario">
                  {GLOSARIO.map((g, i) => (
                    <div key={i} className="ayuda-glosario-item">
                      <div className="ayuda-glosario-termino">{g.t}</div>
                      <div className="ayuda-glosario-def">{g.d}</div>
                    </div>
                  ))}
                </div>
              </section>
              <section className="surface ayuda-seccion">
                <h3 className="ayuda-seccion-titulo">Preguntas frecuentes</h3>
                <div className="ayuda-faq">
                  {FAQ.map((f, i) => (
                    <details key={i} className="ayuda-faq-item">
                      <summary>{f.q}</summary>
                      <p>{f.a}</p>
                    </details>
                  ))}
                </div>
              </section>
            </>
          )}
        </div>

        {/* DamarIA, siempre a mano */}
        <aside className="ayuda-lateral">
          <ChatAyuda perfil={perfil} permisos={permisos} rolNorm={rolNorm} />
        </aside>
      </div>
    </div>
  );
}
