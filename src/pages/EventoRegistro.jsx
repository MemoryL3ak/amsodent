import { useState } from "react";
import {
  CalendarCheck,
  CheckCircle2,
  Mail,
  Phone,
  User,
  ShieldCheck,
  GraduationCap,
  Building2,
  Stethoscope,
  ChevronDown,
  ArrowRight,
} from "lucide-react";
import { ESPECIALIDADES } from "./SorteoRegistro";

/* ============================================================
   Portal PÚBLICO de inscripción al evento AMSODENT (/evento).
   Diseño propio (clases evt-*): fondo oscuro del hero del login,
   tarjeta blanca con franja de marca, logo a color adentro e
   iconos dentro de los campos. Paleta 100% teal corporativa.
   El registro llega a POST /eventos/registrar (sin auth) y el
   backend envía el correo de confirmación.
============================================================ */

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3001/api";
// Logo local en alta resolución (1046×350). El del sitio web (Amsodent-1.png)
// mide 186×63 y se pixelea en pantallas retina.
const AMSODENT_LOGO = "/logo_superior_ficha.png";

// Dos eventos con formularios separados: /evento (Santiago) y /evento-vina
// (Viña del Mar). La clave viaja en el registro para distinguir las
// inscripciones. "/evento-brasil" quedó como alias del de Viña del Mar.
const EVENTOS_INFO = {
  santiago: { badge: "Evento Santiago", titulo: <>Inscríbete a nuestro <span>evento en Santiago</span></> },
  vina: { badge: "Evento Viña del Mar", titulo: <>Inscríbete a nuestro <span>evento en Viña del Mar</span></> },
};

export default function EventoRegistro({ evento = "santiago" }) {
  const info = EVENTOS_INFO[evento] || EVENTOS_INFO.santiago;
  const [form, setForm] = useState({
    nombre: "",
    apellido: "",
    telefono: "+56 ", // prefijo de Chile precargado

    correo: "",
    especialidad: "",
    es_profesor: "",          // "si" | "no"
    universidad: "",
    confirma_asistencia: "",  // "si" | "no"
  });
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState("");
  const [exito, setExito] = useState(false);
  const [nombreRegistrado, setNombreRegistrado] = useState("");

  const set = (k) => (e) => {
    const v = e?.target?.value ?? e;
    setForm((p) => ({ ...p, [k]: v }));
    if (error) setError("");
  };

  async function submit(e) {
    e.preventDefault();
    if (enviando) return;
    setError("");

    if (!form.nombre.trim()) return setError("Ingresa tu nombre.");
    if (!form.apellido.trim()) return setError("Ingresa tu apellido.");
    if ((form.telefono.match(/\d/g) || []).length < 8)
      return setError("Ingresa un teléfono válido (mínimo 8 dígitos).");
    if (!form.correo.trim()) return setError("Ingresa tu correo electrónico.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.correo.trim()))
      return setError("El correo electrónico no es válido.");
    if (!form.especialidad) return setError("Selecciona tu especialidad.");
    if (form.es_profesor === "")
      return setError("Cuéntanos si eres profesor(a) universitario.");
    if (form.es_profesor === "si" && !form.universidad.trim())
      return setError("Indícanos la universidad donde das clases.");
    if (form.confirma_asistencia === "")
      return setError("Confírmanos si asistirás al evento.");

    setEnviando(true);
    try {
      const res = await fetch(`${API_URL}/eventos/registrar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          evento,
          nombre: form.nombre.trim(),
          apellido: form.apellido.trim(),
          telefono: form.telefono.trim(),
          correo: form.correo.trim(),
          especialidad: form.especialidad,
          es_profesor: form.es_profesor === "si",
          universidad: form.es_profesor === "si" ? form.universidad.trim() : null,
          confirma_asistencia: form.confirma_asistencia === "si",
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
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch {
      setError("No se pudo conectar con el servidor. Verifica tu conexión.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="evt-page">
      <main className="evt-main">
        {!exito ? (
          <form onSubmit={submit} className="evt-card" noValidate>
            <div className="evt-head">
              <img src={AMSODENT_LOGO} alt="AMSODENT" className="evt-logo" />
              <div className="evt-badge">
                <CalendarCheck size={13} />
                <span>{info.badge}</span>
              </div>
              <h1 className="evt-title">{info.titulo}</h1>
              <p className="evt-sub">
                Completa tus datos y recibirás la confirmación de tu inscripción en tu correo.
              </p>
            </div>

            <div className="evt-divider" />

            <div className="evt-fields">
              <div className="evt-grid2">
                <Campo label="Nombre" icon={<User size={16} />}>
                  <input
                    type="text"
                    value={form.nombre}
                    onChange={set("nombre")}
                    placeholder="Juan"
                    autoComplete="given-name"
                    required
                  />
                </Campo>
                <Campo label="Apellido" icon={<User size={16} />}>
                  <input
                    type="text"
                    value={form.apellido}
                    onChange={set("apellido")}
                    placeholder="Pérez"
                    autoComplete="family-name"
                    required
                  />
                </Campo>
              </div>

              <div className="evt-grid2">
                <Campo label="Teléfono" icon={<Phone size={16} />}>
                  <input
                    type="tel"
                    value={form.telefono}
                    onChange={set("telefono")}
                    placeholder="+56 9 1234 5678"
                    autoComplete="tel"
                    required
                  />
                </Campo>
                <Campo label="Correo electrónico" icon={<Mail size={16} />}>
                  <input
                    type="email"
                    value={form.correo}
                    onChange={set("correo")}
                    placeholder="tu@correo.cl"
                    autoComplete="email"
                    required
                  />
                </Campo>
              </div>

              <Campo label="Especialidad" icon={<Stethoscope size={16} />} select>
                <select value={form.especialidad} onChange={set("especialidad")} required>
                  <option value="" disabled>
                    Selecciona una opción…
                  </option>
                  {ESPECIALIDADES.map((esp) => (
                    <option key={esp} value={esp}>
                      {esp}
                    </option>
                  ))}
                </select>
              </Campo>

              <div className="evt-field">
                <span className="evt-label">
                  <GraduationCap size={14} className="evt-label-ic" />
                  ¿Eres profesor(a) universitario? <span className="evt-req">*</span>
                </span>
                <div className="evt-seg">
                  <Opcion selected={form.es_profesor === "si"} onClick={() => set("es_profesor")("si")} label="Sí" />
                  <Opcion selected={form.es_profesor === "no"} onClick={() => set("es_profesor")("no")} label="No" />
                </div>
              </div>

              {form.es_profesor === "si" && (
                <Campo label="Universidad donde das clases" icon={<Building2 size={16} />}>
                  <input
                    type="text"
                    value={form.universidad}
                    onChange={set("universidad")}
                    placeholder="Ej: Universidad de Chile"
                    required
                  />
                </Campo>
              )}

              <div className="evt-field">
                <span className="evt-label">
                  <CalendarCheck size={14} className="evt-label-ic" />
                  ¿Confirmas tu asistencia? <span className="evt-req">*</span>
                </span>
                <div className="evt-seg">
                  <Opcion
                    selected={form.confirma_asistencia === "si"}
                    onClick={() => set("confirma_asistencia")("si")}
                    label="Sí, asistiré"
                  />
                  <Opcion
                    selected={form.confirma_asistencia === "no"}
                    onClick={() => set("confirma_asistencia")("no")}
                    label="Aún no lo sé"
                  />
                </div>
              </div>

              {error && (
                <div className="evt-error" role="alert">
                  {error}
                </div>
              )}

              <button type="submit" className="evt-submit" disabled={enviando}>
                {enviando ? (
                  <>
                    <span className="evt-spinner" />
                    Inscribiendo…
                  </>
                ) : (
                  <>
                    Inscribirme al evento
                    <ArrowRight size={17} />
                  </>
                )}
              </button>

              <div className="evt-trust">
                <ShieldCheck size={13} />
                <span>Tus datos están protegidos y solo se usan para este evento.</span>
              </div>
            </div>
          </form>
        ) : (
          <div className="evt-card evt-success">
            <img src={AMSODENT_LOGO} alt="AMSODENT" className="evt-logo" />
            <div className="evt-success-icon">
              <CheckCircle2 size={46} />
            </div>
            <h1 className="evt-title">
              ¡Inscripción lista{nombreRegistrado ? `, ${nombreRegistrado}` : ""}!
            </h1>
            <p className="evt-sub">
              Tu cupo quedó reservado. Te enviamos un correo con la confirmación —
              si no lo ves, revisa tu carpeta de spam.
            </p>
            <div className="evt-success-meta">Nos vemos en el evento · Equipo AMSODENT</div>
          </div>
        )}
      </main>

      <footer className="evt-footer">
        © {new Date().getFullYear()} AMSODENT · Todos los derechos reservados
      </footer>

      <style>{EVT_STYLES}</style>
    </div>
  );
}

/* Campo de texto/select con icono DENTRO del input.
   Exportado: lo reutiliza el formulario público de Comunidad (/comunidad). */
export function Campo({ label, icon, select, optional, children }) {
  return (
    <label className="evt-field">
      <span className="evt-label">
        {label} {optional ? null : <span className="evt-req">*</span>}
      </span>
      <span className={`evt-inputwrap ${select ? "is-select" : ""}`}>
        <span className="evt-input-ic">{icon}</span>
        {children}
        {select && <ChevronDown size={15} className="evt-select-chevron" aria-hidden />}
      </span>
    </label>
  );
}

export function Opcion({ selected, onClick, label }) {
  return (
    <button type="button" className={`evt-opt ${selected ? "is-on" : ""}`} onClick={onClick}>
      {selected && <CheckCircle2 size={14} />}
      {label}
    </button>
  );
}

/* ─────────────────────────────── ESTILOS ───────────────────────────────
   Exportados: también los usa el formulario público de Comunidad. */
export const EVT_STYLES = `
.evt-page {
  --evt-teal:       #28aeb1;
  --evt-teal-dark:  #1e9295;
  --evt-teal-soft:  #e6f6f6;
  --evt-ink:        #101828;
  --evt-muted:      #667085;
  --evt-border:     #e4e7ec;
  --evt-field-bg:   #f8fafc;

  min-height: 100dvh;
  display: flex;
  flex-direction: column;
  font-family: "Inter", system-ui, -apple-system, "Segoe UI", sans-serif;
  color: var(--evt-ink);
  background:
    radial-gradient(ellipse 70% 55% at 10% 95%, rgba(40,174,177,.20) 0%, transparent 62%),
    radial-gradient(ellipse 55% 45% at 90% 4%, rgba(40,174,177,.14) 0%, transparent 58%),
    linear-gradient(150deg, #0d2d35 0%, #0f3740 50%, #0a2830 100%);
}
.evt-page::before {
  content: "";
  position: fixed;
  inset: 0;
  background-image: radial-gradient(circle, rgba(40,174,177,.10) 1px, transparent 1px);
  background-size: 26px 26px;
  pointer-events: none;
}

.evt-main {
  flex: 1;
  display: flex;
  justify-content: center;
  align-items: flex-start;
  padding: 44px 16px 24px;
  position: relative;
  z-index: 1;
}

.evt-card {
  position: relative;
  width: 100%;
  max-width: 580px;
  background: #ffffff;
  border-radius: 20px;
  box-shadow: 0 30px 70px rgba(0, 0, 0, .40), 0 0 0 1px rgba(255, 255, 255, .06);
  padding: 36px 42px 32px;
  overflow: hidden;
  animation: evt-in .5s cubic-bezier(.16, 1, .3, 1) both;
}
/* Franja de marca en el borde superior de la tarjeta. */
.evt-card::before {
  content: "";
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 5px;
  background: linear-gradient(90deg, #28aeb1 0%, #6fd0d2 50%, #1e9295 100%);
}
@keyframes evt-in {
  from { opacity: 0; transform: translateY(16px); }
  to   { opacity: 1; transform: translateY(0); }
}

.evt-head { text-align: center; padding-top: 6px; }
.evt-logo {
  width: auto;
  max-width: 185px;
  height: auto;
  margin: 0 auto 18px;
  display: block;
}
.evt-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: var(--evt-teal-soft);
  border: 1px solid rgba(40, 174, 177, .35);
  color: var(--evt-teal-dark);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: .09em;
  text-transform: uppercase;
  border-radius: 999px;
  padding: 6px 14px;
  margin-bottom: 14px;
}
.evt-title {
  margin: 0 0 8px;
  font-size: 26px;
  font-weight: 800;
  letter-spacing: -.02em;
  line-height: 1.2;
}
.evt-title span { color: var(--evt-teal-dark); }
.evt-sub {
  margin: 0 auto;
  max-width: 400px;
  font-size: 14px;
  line-height: 1.6;
  color: var(--evt-muted);
}

.evt-divider {
  height: 1px;
  background: linear-gradient(90deg, transparent, var(--evt-border) 20%, var(--evt-border) 80%, transparent);
  margin: 24px 0 22px;
}

.evt-fields { display: flex; flex-direction: column; gap: 16px; }
.evt-grid2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}

.evt-field { display: flex; flex-direction: column; gap: 7px; }
.evt-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: .02em;
  color: #344054;
}
.evt-label-ic { color: var(--evt-teal-dark); }
.evt-req { color: #e11d48; font-weight: 700; }

/* Input con icono adentro */
.evt-inputwrap { position: relative; display: block; }
.evt-input-ic {
  position: absolute;
  left: 14px;
  top: 50%;
  transform: translateY(-50%);
  color: #98a2b3;
  display: inline-flex;
  pointer-events: none;
  transition: color .15s;
}
.evt-inputwrap:focus-within .evt-input-ic { color: var(--evt-teal-dark); }

.evt-inputwrap input,
.evt-inputwrap select {
  width: 100%;
  height: 46px;
  border: 1.5px solid var(--evt-border);
  border-radius: 12px;
  padding: 0 14px 0 42px;
  font-size: 14px;
  color: var(--evt-ink);
  background: var(--evt-field-bg);
  outline: none;
  transition: border-color .15s, box-shadow .15s, background .15s;
  font-family: inherit;
}
.evt-inputwrap input::placeholder { color: #98a2b3; }
.evt-inputwrap input:focus,
.evt-inputwrap select:focus {
  border-color: var(--evt-teal);
  background: #fff;
  box-shadow: 0 0 0 4px rgba(40, 174, 177, .14);
}

.evt-inputwrap select {
  appearance: none;
  -webkit-appearance: none;
  padding-right: 38px;
  cursor: pointer;
}
.evt-inputwrap select:invalid { color: #98a2b3; }
.evt-select-chevron {
  position: absolute;
  right: 14px;
  top: 50%;
  transform: translateY(-50%);
  color: #98a2b3;
  pointer-events: none;
}

.evt-seg {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
.evt-opt {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  height: 46px;
  border: 1.5px solid var(--evt-border);
  border-radius: 12px;
  background: var(--evt-field-bg);
  font-size: 14px;
  font-weight: 600;
  color: #475467;
  cursor: pointer;
  transition: all .15s;
  font-family: inherit;
}
.evt-opt:hover { border-color: var(--evt-teal); color: var(--evt-teal-dark); background: #fff; }
.evt-opt.is-on {
  background: var(--evt-teal-dark);
  border-color: var(--evt-teal-dark);
  color: #fff;
  box-shadow: 0 6px 16px rgba(30, 146, 149, .30);
}

.evt-error {
  background: #fef2f2;
  border: 1px solid #fecaca;
  color: #b91c1c;
  border-radius: 12px;
  padding: 11px 14px;
  font-size: 13px;
}

.evt-submit {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 9px;
  height: 50px;
  border: none;
  border-radius: 13px;
  background: linear-gradient(135deg, var(--evt-teal) 0%, var(--evt-teal-dark) 100%);
  color: #fff;
  font-size: 15px;
  font-weight: 700;
  letter-spacing: .01em;
  cursor: pointer;
  font-family: inherit;
  transition: transform .15s, box-shadow .15s, opacity .15s;
  box-shadow: 0 12px 26px rgba(30, 146, 149, .38);
  margin-top: 6px;
}
.evt-submit:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 16px 32px rgba(30, 146, 149, .45); }
.evt-submit:active:not(:disabled) { transform: translateY(0); }
.evt-submit:disabled { opacity: .75; cursor: default; }
.evt-spinner {
  width: 16px;
  height: 16px;
  border: 2px solid rgba(255, 255, 255, .4);
  border-top-color: #fff;
  border-radius: 50%;
  animation: evt-spin .7s linear infinite;
}
@keyframes evt-spin { to { transform: rotate(360deg); } }

.evt-trust {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  font-size: 12px;
  color: var(--evt-muted);
  margin-top: 2px;
}

.evt-success { text-align: center; }
.evt-success-icon {
  width: 88px;
  height: 88px;
  border-radius: 50%;
  background: var(--evt-teal-soft);
  color: var(--evt-teal-dark);
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 10px auto 20px;
  box-shadow: 0 0 0 10px rgba(40, 174, 177, .08);
}
.evt-success-meta {
  margin-top: 20px;
  font-size: 13px;
  font-weight: 700;
  color: var(--evt-teal-dark);
  letter-spacing: .02em;
}

.evt-footer {
  text-align: center;
  padding: 18px 16px 24px;
  font-size: 12px;
  color: rgba(255, 255, 255, .45);
  position: relative;
  z-index: 1;
}

/* ───────── Responsive (teléfono) ───────── */
@media (max-width: 600px) {
  .evt-main { padding: 22px 14px 12px; }
  .evt-card { padding: 28px 22px 26px; border-radius: 18px; }
  .evt-grid2 { grid-template-columns: 1fr; gap: 16px; }
  .evt-logo { max-width: 158px; margin-bottom: 16px; }
  .evt-title { font-size: 22px; }
  .evt-sub { font-size: 13.5px; }
  .evt-divider { margin: 20px 0 18px; }
  /* 16px evita el auto-zoom de iOS al enfocar inputs */
  .evt-inputwrap input, .evt-inputwrap select { font-size: 16px; height: 48px; }
  .evt-opt { height: 48px; font-size: 14.5px; }
  .evt-submit { height: 52px; width: 100%; }
}
`;
