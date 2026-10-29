import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import {
  Gift,
  CheckCircle2,
  Sparkles,
  Mail,
  User,
  ShieldCheck,
  GraduationCap,
  Trophy,
  CalendarX2,
  SearchX,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { oscurecer, aclarar } from "../lib/qrCustom";

/* ============================================================
   Formulario público del sorteo (destino del QR): /sorteo/<slug>.
   (2026-10-29) Sorteos múltiples: el sorteo se carga por su slug y
   pinta la página con sus colores; /sorteo sin slug abre el sorteo
   abierto más reciente (para los QR antiguos). Pide nombre, correo,
   si es estudiante de la universidad y en qué año va.
============================================================ */

// Exportado: lo reutilizan los portales de eventos y comunidad.
export const ESPECIALIDADES = [
  "Odontología general",
  "Ortodoncia",
  "Endodoncia",
  "Periodoncia",
  "Cirugía maxilofacial",
  "Implantología",
  "Odontopediatría",
  "Rehabilitación oral",
  "Estomatología / Patología oral",
  "Aún no tengo especialidad",
  "Otra",
];

// Espejo de ANIOS en backend/src/sorteo/sorteo.service.ts.
export const ANIOS = ["1° año", "2° año", "3° año", "4° año", "5° año", "6° año", "Otro"];

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3001/api";
const AMSODENT_LOGO = "/logo_superior_ficha.png";

// Variables de color de la página a partir del color del sorteo.
function temaDe(color, acento) {
  const c = /^#[0-9a-f]{6}$/i.test(color || "") ? color : "#28aeb1";
  const a = /^#[0-9a-f]{6}$/i.test(acento || "") ? acento : "#f59e0b";
  return {
    "--sorteo-primary": c,
    "--sorteo-primary-dark": oscurecer(c, 0.22),
    "--sorteo-primary-deep": oscurecer(c, 0.5),
    "--sorteo-primary-mid": aclarar(c, 0.65),
    "--sorteo-primary-light": aclarar(c, 0.88),
    "--sorteo-gold": a,
    "--sorteo-gold-soft": aclarar(a, 0.7),
  };
}

export default function SorteoRegistro() {
  const { slug } = useParams();
  const [sorteo, setSorteo] = useState(null);
  const [estado, setEstado] = useState("cargando"); // cargando | listo | no_existe | error
  const [mensaje, setMensaje] = useState("");
  const [intento, setIntento] = useState(0);

  const [form, setForm] = useState({
    nombre: "",
    email: "",
    es_estudiante: "", // "si" | "no"
    anio: "",
    acepta_uso_datos: false,
    acepta_comunicaciones: false,
  });
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState("");
  const [exito, setExito] = useState(false);
  const [nombreRegistrado, setNombreRegistrado] = useState("");

  useEffect(() => {
    let vivo = true;
    setEstado("cargando");
    setMensaje("");
    const destino = slug ? encodeURIComponent(slug) : "activo";
    fetch(`${API_URL}/sorteo/publico/${destino}`)
      .then(async (r) => {
        const body = await r.json().catch(() => ({}));
        if (!vivo) return;
        if (r.ok) {
          setSorteo(body);
          setEstado("listo");
        } else {
          setMensaje(body?.message || "");
          setEstado(r.status === 404 ? "no_existe" : "error");
        }
      })
      .catch(() => {
        if (vivo) setEstado("error");
      });
    return () => {
      vivo = false;
    };
  }, [slug, intento]);

  useEffect(() => {
    document.title = sorteo?.titulo ? `${sorteo.titulo} · Amsodent` : "Sorteo · Amsodent";
  }, [sorteo?.titulo]);

  const tema = useMemo(() => temaDe(sorteo?.color, sorteo?.color_acento), [sorteo?.color, sorteo?.color_acento]);

  const set = (k) => (e) => {
    const v = e?.target?.type === "checkbox" ? e.target.checked : e?.target?.value ?? e;
    setForm((p) => ({ ...p, [k]: v }));
    if (error) setError("");
  };

  async function submit(e) {
    e.preventDefault();
    if (enviando || !sorteo) return;
    setError("");

    if (!form.nombre.trim()) return setError("Ingresa tu nombre.");
    if (!form.email.trim()) return setError("Ingresa tu correo electrónico.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim()))
      return setError("El correo electrónico no es válido.");
    if (!form.es_estudiante) return setError("Cuéntanos si eres estudiante.");
    if (form.es_estudiante === "si" && !form.anio) return setError("Indícanos en qué año vas.");
    if (!form.acepta_uso_datos) return setError("Debes autorizar el uso de tus datos para participar.");

    setEnviando(true);
    try {
      const res = await fetch(`${API_URL}/sorteo/registrar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: sorteo.slug,
          nombre: form.nombre.trim(),
          email: form.email.trim(),
          es_estudiante: form.es_estudiante === "si",
          anio: form.es_estudiante === "si" ? form.anio : null,
          acepta_uso_datos: form.acepta_uso_datos,
          acepta_comunicaciones: form.acepta_comunicaciones,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body?.message || "No pudimos registrar tus datos. Intenta nuevamente.");
        setEnviando(false);
        return;
      }

      setNombreRegistrado(form.nombre.trim().split(" ")[0]);
      setExito(true);
    } catch {
      setError("No se pudo conectar con el servidor. Verifica tu conexión.");
    } finally {
      setEnviando(false);
    }
  }

  let contenido;
  if (estado === "cargando") {
    contenido = (
      <EstadoCard icono={<Loader2 size={40} className="sorteo-girando" />} titulo="Cargando sorteo…" />
    );
  } else if (estado === "no_existe") {
    contenido = (
      <EstadoCard
        icono={<SearchX size={44} />}
        titulo="Este sorteo no existe"
        texto={mensaje || "Revisa el enlace o vuelve a escanear el código QR."}
      />
    );
  } else if (estado === "error") {
    contenido = (
      <EstadoCard
        icono={<RefreshCw size={40} />}
        titulo="No pudimos cargar el sorteo"
        texto="Revisa tu conexión e inténtalo de nuevo."
        accion={
          <button type="button" className="sorteo-submit" onClick={() => setIntento((n) => n + 1)}>
            <RefreshCw size={16} /> Reintentar
          </button>
        }
      />
    );
  } else if (!sorteo?.activo) {
    contenido = (
      <EstadoCard
        icono={<CalendarX2 size={44} />}
        titulo="Inscripciones cerradas"
        texto={`Las inscripciones de «${sorteo?.titulo}» ya cerraron. ¡Gracias por tu interés!`}
      />
    );
  } else if (exito) {
    contenido = <SuccessCard nombre={nombreRegistrado} sorteo={sorteo} />;
  } else {
    contenido = (
      <FormCard sorteo={sorteo} form={form} set={set} submit={submit} error={error} enviando={enviando} />
    );
  }

  return (
    <div className="sorteo-page" style={tema}>
      <BackgroundFX />
      <header className="sorteo-topbar">
        <div className="sorteo-logo-wrap">
          <img src={AMSODENT_LOGO} alt="AMSODENT" className="sorteo-logo" />
        </div>
      </header>

      <main className="sorteo-main">{contenido}</main>

      <footer className="sorteo-footer">
        <span>© {new Date().getFullYear()} AMSODENT · Todos los derechos reservados</span>
      </footer>

      <style>{STYLES}</style>
    </div>
  );
}

/* ──────────────────────────── SUB-COMPONENTES ──────────────────────────── */

// "Universidad Viña del Mar" → "¿Eres estudiante de la Universidad Viña del Mar?";
// "UVM" → "¿Eres estudiante de UVM?"; sin universidad → "de la universidad".
function preguntaEstudiante(universidad) {
  const u = String(universidad || "").trim();
  if (!u) return "¿Eres estudiante de la universidad?";
  return /^universidad(\s|$)/i.test(u) ? `¿Eres estudiante de la ${u}?` : `¿Eres estudiante de ${u}?`;
}

function FormCard({ sorteo, form, set, submit, error, enviando }) {
  const universidad = sorteo.universidad || "";
  return (
    <form onSubmit={submit} className="sorteo-card" noValidate>
      <div className="sorteo-hero">
        <div className="sorteo-hero-badge">
          <Gift size={16} />
          <span>SORTEO{universidad ? ` · ${universidad.toUpperCase()}` : ""}</span>
        </div>
        <h1 className="sorteo-title">{sorteo.titulo}</h1>
        <p className="sorteo-sub">
          {sorteo.subtitulo || "Déjanos tus datos y quedarás automáticamente participando por nuestro sorteo."}
        </p>
        {sorteo.premio && (
          <div className="sorteo-premio">
            <span className="sorteo-premio-icon">
              <Trophy size={18} />
            </span>
            <span>
              <small>Premio</small>
              <strong>{sorteo.premio}</strong>
            </span>
          </div>
        )}
      </div>

      <div className="sorteo-fields">
        <Field icon={<User size={16} />} label="Nombre completo" required>
          <input
            type="text"
            value={form.nombre}
            onChange={set("nombre")}
            placeholder="Juan Pérez"
            autoComplete="name"
            required
          />
        </Field>

        <Field icon={<Mail size={16} />} label="Correo electrónico" required>
          <input
            type="email"
            value={form.email}
            onChange={set("email")}
            placeholder="tu@correo.cl"
            autoComplete="email"
            inputMode="email"
            required
          />
        </Field>

        <Field
          icon={<GraduationCap size={16} />}
          label={preguntaEstudiante(universidad)}
          required
        >
          <div className="sorteo-choices">
            <ChoiceChip selected={form.es_estudiante === "si"} onClick={() => set("es_estudiante")("si")} label="Sí" />
            <ChoiceChip selected={form.es_estudiante === "no"} onClick={() => set("es_estudiante")("no")} label="No" />
          </div>
        </Field>

        {form.es_estudiante === "si" && (
          <Field label="¿En qué año vas?" required>
            <div className="sorteo-choices sorteo-choices-anios">
              {ANIOS.map((a) => (
                <ChoiceChip key={a} selected={form.anio === a} onClick={() => set("anio")(a)} label={a} />
              ))}
            </div>
          </Field>
        )}

        <div className="sorteo-legal">
          <label className="sorteo-check">
            <input type="checkbox" checked={form.acepta_uso_datos} onChange={set("acepta_uso_datos")} />
            <span className="sorteo-check-box">{form.acepta_uso_datos && <CheckCircle2 size={14} />}</span>
            <span className="sorteo-check-text">
              <strong>Autorizo a AMSODENT</strong> a tratar mis datos personales para la participación en
              este sorteo, conforme a la Ley N° 19.628 sobre Protección de Datos Personales.{" "}
              <span className="sorteo-required">*</span>
            </span>
          </label>

          <label className="sorteo-check">
            <input
              type="checkbox"
              checked={form.acepta_comunicaciones}
              onChange={set("acepta_comunicaciones")}
            />
            <span className="sorteo-check-box">{form.acepta_comunicaciones && <CheckCircle2 size={14} />}</span>
            <span className="sorteo-check-text">
              Acepto recibir novedades, promociones y comunicaciones comerciales de AMSODENT.{" "}
              <em>(opcional)</em>
            </span>
          </label>
        </div>

        {error && (
          <div className="sorteo-error" role="alert">
            {error}
          </div>
        )}

        <button type="submit" className={`sorteo-submit ${enviando ? "is-loading" : ""}`} disabled={enviando}>
          {enviando ? (
            <>
              <span className="sorteo-spinner" />
              Registrando…
            </>
          ) : (
            <>
              <Sparkles size={18} />
              ¡Quiero participar!
            </>
          )}
        </button>

        <div className="sorteo-trust">
          <ShieldCheck size={14} />
          <span>Tus datos están protegidos y jamás se comparten con terceros.</span>
        </div>
      </div>
    </form>
  );
}

function Field({ icon, label, required, children }) {
  return (
    <label className="sorteo-field">
      <span className="sorteo-field-label">
        {icon && <span className="sorteo-field-icon">{icon}</span>}
        {label}
        {required && <span className="sorteo-required"> *</span>}
      </span>
      {children}
    </label>
  );
}

function ChoiceChip({ selected, onClick, label }) {
  return (
    <button type="button" className={`sorteo-chip ${selected ? "is-selected" : ""}`} onClick={onClick}>
      {selected && <CheckCircle2 size={15} />}
      {label}
    </button>
  );
}

function EstadoCard({ icono, titulo, texto, accion }) {
  return (
    <div className="sorteo-card sorteo-estado">
      <div className="sorteo-estado-icon">{icono}</div>
      <h1 className="sorteo-title">{titulo}</h1>
      {texto && <p className="sorteo-sub">{texto}</p>}
      {accion && <div style={{ marginTop: 18 }}>{accion}</div>}
    </div>
  );
}

function SuccessCard({ nombre, sorteo }) {
  return (
    <div className="sorteo-card sorteo-success">
      <Confetti />
      <div className="sorteo-success-icon">
        <CheckCircle2 size={56} />
      </div>
      <h1 className="sorteo-title">
        ¡Estás dentro{nombre ? `, ${nombre}` : ""}! <span className="sorteo-wave">🎉</span>
      </h1>
      <p className="sorteo-sub">
        Tu registro fue recibido y ya estás participando
        {sorteo?.premio ? ` por ${sorteo.premio}` : " por el sorteo"}. Te contactaremos por correo
        electrónico si resultas ganador.
      </p>
      <div className="sorteo-success-meta">
        <Sparkles size={14} />
        <span>¡Mucha suerte de parte del equipo AMSODENT!</span>
      </div>
    </div>
  );
}

// Pseudoaleatorio determinista (nada impuro en el render): bastante
// irregular para burbujas y confeti, y el mismo en cada render.
export const azar = (i, k = 0) => {
  const x = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453;
  return x - Math.floor(x);
};

function BackgroundFX() {
  const circles = useMemo(() => {
    return Array.from({ length: 14 }).map((_, i) => ({
      left: `${azar(i, 1) * 100}%`,
      delay: `${azar(i, 2) * 18}s`,
      size: 16 + azar(i, 3) * 36,
      duration: 16 + azar(i, 4) * 14,
    }));
  }, []);
  return (
    <div className="sorteo-bg" aria-hidden>
      <div className="sorteo-bg-gradient" />
      <div className="sorteo-bg-grid" />
      {circles.map((c, i) => (
        <span
          key={i}
          className="sorteo-bubble"
          style={{
            left: c.left,
            width: c.size,
            height: c.size,
            animationDelay: c.delay,
            animationDuration: `${c.duration}s`,
          }}
        />
      ))}
    </div>
  );
}

function Confetti() {
  const pieces = useMemo(() => {
    const colors = [
      "var(--sorteo-primary)",
      "var(--sorteo-primary-dark)",
      "var(--sorteo-primary-mid)",
      "var(--sorteo-gold)",
      "var(--sorteo-gold-soft)",
      "#fb7185",
    ];
    return Array.from({ length: 60 }).map((_, i) => ({
      left: `${azar(i, 1) * 100}%`,
      delay: `${azar(i, 5) * 0.6}s`,
      duration: `${1.6 + azar(i, 6) * 1.8}s`,
      color: colors[i % colors.length],
      rotate: `${azar(i, 7) * 360}deg`,
    }));
  }, []);
  return (
    <div className="sorteo-confetti" aria-hidden>
      {pieces.map((p, i) => (
        <span
          key={i}
          style={{
            left: p.left,
            background: p.color,
            animationDelay: p.delay,
            animationDuration: p.duration,
            transform: `rotate(${p.rotate})`,
          }}
        />
      ))}
    </div>
  );
}

/* ──────────────────────────────── ESTILOS ──────────────────────────────── */

const STYLES = `
.sorteo-page {
  --sorteo-primary:      #28aeb1;
  --sorteo-primary-dark: #1e9295;
  --sorteo-primary-deep: #0f5758;
  --sorteo-primary-mid:  #b2e4e5;
  --sorteo-primary-light:#e8f7f7;
  --sorteo-gold:         #f59e0b;
  --sorteo-gold-soft:    #fde68a;
  --sorteo-coral:        #fb7185;
  --sorteo-text:         #1a1d23;
  --sorteo-muted:        #6b7280;
  --sorteo-border:       #e5e7eb;
  --sorteo-surface:      #ffffff;
  --sorteo-error:        #dc2626;
  --sorteo-success:      #10b981;
  --sorteo-halo:         color-mix(in srgb, var(--sorteo-primary) 18%, transparent);
  --sorteo-sombra:       color-mix(in srgb, var(--sorteo-primary) 55%, transparent);
}

.sorteo-page {
  min-height: 100dvh;
  position: relative;
  font-family: "Inter", system-ui, -apple-system, "Segoe UI", sans-serif;
  color: var(--sorteo-text);
  display: flex;
  flex-direction: column;
  overflow-x: hidden;
  isolation: isolate;
}

/* ---------- Fondo animado ---------- */
.sorteo-bg { position: fixed; inset: 0; z-index: -1; overflow: hidden; }
.sorteo-bg-gradient {
  position: absolute;
  inset: 0;
  background:
    radial-gradient(1400px 900px at 0% 0%, rgba(255,255,255,.85) 0%, color-mix(in srgb, var(--sorteo-primary-light) 55%, transparent) 22%, rgba(255,255,255,.2) 45%, transparent 70%),
    radial-gradient(900px 600px at 100% 100%, color-mix(in srgb, var(--sorteo-primary-deep) 60%, transparent) 0%, transparent 55%),
    linear-gradient(135deg, var(--sorteo-primary) 0%, var(--sorteo-primary-dark) 100%);
}
.sorteo-bg-grid {
  position: absolute;
  inset: 0;
  background-image:
    linear-gradient(rgba(255,255,255,.06) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255,255,255,.06) 1px, transparent 1px);
  background-size: 42px 42px;
  mask-image: radial-gradient(circle at center, #000 40%, transparent 75%);
}
.sorteo-bubble {
  position: absolute;
  bottom: -60px;
  border-radius: 50%;
  background: rgba(255,255,255,.14);
  backdrop-filter: blur(6px);
  animation: sorteo-bubble-up linear infinite;
  box-shadow: 0 0 22px rgba(255,255,255,.2);
}
@keyframes sorteo-bubble-up {
  0%   { transform: translateY(0) scale(1); opacity: 0; }
  12%  { opacity: 1; }
  100% { transform: translateY(-120vh) scale(.4); opacity: 0; }
}

/* ---------- Layout ---------- */
.sorteo-topbar { padding: 28px 20px 8px; display: flex; justify-content: center; }
.sorteo-logo-wrap {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 10px 30px;
  animation: sorteo-logo-in .7s cubic-bezier(.16,1,.3,1) both;
}
.sorteo-logo { position: relative; z-index: 1; height: 72px; width: auto; display: block; }
@keyframes sorteo-logo-in {
  from { opacity: 0; transform: translateY(-14px) scale(.94); }
  to   { opacity: 1; transform: translateY(0) scale(1); }
}
.sorteo-main { flex: 1; display: flex; align-items: flex-start; justify-content: center; padding: 24px 16px 40px; }
.sorteo-footer { text-align: center; padding: 14px 16px 22px; color: rgba(255,255,255,.78); font-size: 12px; letter-spacing: .02em; }

/* ---------- Card ---------- */
.sorteo-card {
  position: relative;
  width: 100%;
  max-width: 520px;
  background: rgba(255,255,255,.96);
  backdrop-filter: blur(18px);
  border-radius: 24px;
  padding: 28px 26px 26px;
  box-shadow: 0 32px 80px -20px rgba(15,23,42,.55), 0 2px 0 rgba(255,255,255,.6) inset;
  border: 1px solid rgba(255,255,255,.6);
  animation: sorteo-card-in .55s cubic-bezier(.16,1,.3,1) both;
}
@keyframes sorteo-card-in {
  from { opacity: 0; transform: translateY(24px) scale(.98); }
  to   { opacity: 1; transform: translateY(0) scale(1); }
}
.sorteo-card::before {
  content: "";
  position: absolute;
  inset: -1px;
  border-radius: 24px;
  padding: 1px;
  background: linear-gradient(135deg, var(--sorteo-sombra), color-mix(in srgb, var(--sorteo-gold) 45%, transparent), var(--sorteo-sombra));
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  -webkit-mask-composite: xor;
          mask-composite: exclude;
  pointer-events: none;
}

/* ---------- Hero ---------- */
.sorteo-hero { text-align: center; margin-bottom: 22px; }
.sorteo-hero-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 100%;
  padding: 6px 12px;
  border-radius: 999px;
  background: linear-gradient(135deg, var(--sorteo-primary-dark), var(--sorteo-primary));
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: .12em;
  box-shadow: 0 8px 24px -6px var(--sorteo-sombra);
  animation: sorteo-pulse 2.4s ease-in-out infinite;
}
.sorteo-hero-badge span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
@keyframes sorteo-pulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.04); } }
.sorteo-title { margin: 12px 0 6px; font-size: 26px; font-weight: 800; letter-spacing: -.02em; line-height: 1.15; overflow-wrap: anywhere; }
.sorteo-wave { display: inline-block; animation: sorteo-wave 1.2s ease-in-out infinite; transform-origin: 70% 70%; }
@keyframes sorteo-wave {
  0%,100% { transform: rotate(0); }
  20%     { transform: rotate(14deg); }
  40%     { transform: rotate(-10deg); }
  60%     { transform: rotate(6deg); }
}
.sorteo-sub { margin: 0; color: var(--sorteo-muted); font-size: 14px; line-height: 1.5; }

/* Premio */
.sorteo-premio {
  margin: 16px auto 0;
  display: inline-flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px 10px 12px;
  border-radius: 16px;
  text-align: left;
  background: linear-gradient(135deg, var(--sorteo-gold-soft), #fff 70%);
  border: 1px solid color-mix(in srgb, var(--sorteo-gold) 45%, transparent);
  box-shadow: 0 10px 24px -14px var(--sorteo-gold);
  max-width: 100%;
}
.sorteo-premio-icon {
  width: 38px; height: 38px; flex: 0 0 38px;
  border-radius: 12px;
  display: inline-flex; align-items: center; justify-content: center;
  background: linear-gradient(135deg, var(--sorteo-gold), color-mix(in srgb, var(--sorteo-gold) 70%, #000));
  color: #fff;
}
.sorteo-premio small { display: block; font-size: 10.5px; letter-spacing: .12em; font-weight: 700; color: var(--sorteo-muted); }
.sorteo-premio strong { font-size: 14.5px; line-height: 1.3; }

/* ---------- Fields ---------- */
.sorteo-fields { display: flex; flex-direction: column; gap: 14px; }
.sorteo-field { display: flex; flex-direction: column; gap: 6px; }
.sorteo-field-label {
  display: inline-flex; align-items: center; gap: 6px;
  font-size: 12.5px; font-weight: 600; color: var(--sorteo-text); letter-spacing: .01em;
}
.sorteo-field-icon { display: inline-flex; color: var(--sorteo-primary); }
.sorteo-required { color: var(--sorteo-coral); font-weight: 700; }

.sorteo-field input[type="text"],
.sorteo-field input[type="email"] {
  height: 46px;
  border: 1.5px solid var(--sorteo-border);
  border-radius: 12px;
  padding: 0 14px;
  font-size: 15px;
  color: var(--sorteo-text);
  background: #fff;
  transition: border-color .18s, box-shadow .18s;
  outline: none;
  width: 100%;
}
.sorteo-field input:focus { border-color: var(--sorteo-primary); box-shadow: 0 0 0 4px var(--sorteo-halo); }

/* ---------- Chips ---------- */
.sorteo-choices { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.sorteo-choices-anios { grid-template-columns: repeat(auto-fill, minmax(96px, 1fr)); }
.sorteo-chip {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  height: 46px;
  border-radius: 12px;
  border: 1.5px solid var(--sorteo-border);
  background: #fff;
  color: var(--sorteo-text);
  font-weight: 600;
  font-size: 14.5px;
  cursor: pointer;
  transition: all .18s;
  font-family: inherit;
}
.sorteo-chip:hover { border-color: var(--sorteo-primary); transform: translateY(-1px); }
.sorteo-chip.is-selected {
  border-color: var(--sorteo-primary);
  background: linear-gradient(135deg, var(--sorteo-primary), var(--sorteo-primary-dark));
  color: #fff;
  box-shadow: 0 10px 24px -10px var(--sorteo-sombra);
}

/* ---------- Checks legales ---------- */
.sorteo-legal {
  display: flex; flex-direction: column; gap: 10px;
  margin-top: 4px; padding: 14px;
  border-radius: 14px;
  background: linear-gradient(135deg, #f8fafc, #f1f5f9);
  border: 1px solid var(--sorteo-border);
}
.sorteo-check { display: grid; grid-template-columns: 22px 1fr; gap: 10px; align-items: flex-start; cursor: pointer; line-height: 1.45; }
.sorteo-check input { display: none; }
.sorteo-check-box {
  width: 20px; height: 20px; margin-top: 1px;
  border-radius: 6px;
  border: 1.5px solid var(--sorteo-border);
  background: #fff;
  display: inline-flex; align-items: center; justify-content: center;
  color: #fff;
  transition: all .18s;
}
.sorteo-check input:checked + .sorteo-check-box {
  background: linear-gradient(135deg, var(--sorteo-primary), var(--sorteo-primary-dark));
  border-color: transparent;
}
.sorteo-check-text { font-size: 12.5px; color: var(--sorteo-muted); }
.sorteo-check-text strong { color: var(--sorteo-text); }

/* ---------- Error ---------- */
.sorteo-error {
  background: #fef2f2; border: 1px solid #fecaca; color: var(--sorteo-error);
  padding: 10px 12px; border-radius: 10px; font-size: 13px; font-weight: 500;
  animation: sorteo-shake .4s ease-in-out;
}
@keyframes sorteo-shake { 0%,100% { transform: translateX(0); } 25% { transform: translateX(-4px); } 75% { transform: translateX(4px); } }

/* ---------- Submit ---------- */
.sorteo-submit {
  position: relative;
  height: 52px;
  border: none;
  border-radius: 14px;
  cursor: pointer;
  background: linear-gradient(135deg, var(--sorteo-primary-dark), var(--sorteo-primary) 55%, var(--sorteo-gold));
  background-size: 200% 100%;
  color: #fff;
  font-size: 16px;
  font-weight: 700;
  letter-spacing: .01em;
  display: inline-flex; align-items: center; justify-content: center; gap: 8px;
  box-shadow: 0 18px 40px -14px var(--sorteo-sombra);
  transition: transform .18s, box-shadow .18s, background-position .6s;
  margin-top: 6px;
  overflow: hidden;
  font-family: inherit;
  padding: 0 22px;
}
.sorteo-submit:hover:not(:disabled) { background-position: 100% 0; transform: translateY(-2px); }
.sorteo-submit:active:not(:disabled) { transform: translateY(0); }
.sorteo-submit:disabled { opacity: .75; cursor: not-allowed; }
.sorteo-submit::after {
  content: "";
  position: absolute; inset: 0;
  background: linear-gradient(120deg, transparent 30%, rgba(255,255,255,.3) 50%, transparent 70%);
  transform: translateX(-100%);
  animation: sorteo-shine 3.2s ease-in-out infinite;
}
@keyframes sorteo-shine { 0%,60% { transform: translateX(-100%); } 100% { transform: translateX(100%); } }
.sorteo-spinner {
  width: 16px; height: 16px; border-radius: 50%;
  border: 2px solid rgba(255,255,255,.4); border-top-color: #fff;
  animation: sorteo-spin .7s linear infinite;
}
@keyframes sorteo-spin { to { transform: rotate(360deg); } }
.sorteo-girando { animation: sorteo-spin 1s linear infinite; }

/* ---------- Trust ---------- */
.sorteo-trust { display: flex; align-items: center; gap: 6px; justify-content: center; color: var(--sorteo-muted); font-size: 12px; margin-top: 4px; }

/* ---------- Estados (cargando / no existe / cerrado) ---------- */
.sorteo-estado { text-align: center; padding: 38px 28px 32px; }
.sorteo-estado-icon {
  display: inline-flex; padding: 16px; border-radius: 50%;
  background: var(--sorteo-primary-light); color: var(--sorteo-primary-dark);
  margin-bottom: 8px;
}

/* ---------- Éxito ---------- */
.sorteo-success { text-align: center; padding: 38px 28px 32px; overflow: hidden; }
.sorteo-success-icon {
  display: inline-flex; padding: 14px; border-radius: 50%;
  background: linear-gradient(135deg, #d1fae5, #a7f3d0); color: var(--sorteo-success);
  margin-bottom: 14px;
  animation: sorteo-pop .6s cubic-bezier(.25,1.4,.45,1) both;
}
@keyframes sorteo-pop { 0% { transform: scale(.2); opacity: 0; } 70% { transform: scale(1.08); opacity: 1; } 100% { transform: scale(1); } }
.sorteo-success-meta {
  margin-top: 16px; display: inline-flex; gap: 6px; align-items: center;
  padding: 8px 14px; border-radius: 999px;
  background: var(--sorteo-primary-light); color: var(--sorteo-primary-dark);
  font-size: 12.5px; font-weight: 600;
}

/* ---------- Confetti ---------- */
.sorteo-confetti { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }
.sorteo-confetti span { position: absolute; top: -12px; width: 8px; height: 14px; border-radius: 2px; animation: sorteo-fall linear forwards; }
@keyframes sorteo-fall { to { transform: translateY(520px) rotate(720deg); opacity: 0; } }

/* ---------- Responsive ---------- */
@media (max-width: 520px) {
  .sorteo-card { padding: 22px 18px; border-radius: 20px; }
  .sorteo-title { font-size: 22px; }
  .sorteo-logo { height: 58px; }
  .sorteo-choices-anios { grid-template-columns: repeat(3, 1fr); }
}
`;
