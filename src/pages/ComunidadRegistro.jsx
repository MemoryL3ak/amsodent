import { useState } from "react";
import {
  CheckCircle2,
  Mail,
  Phone,
  User,
  ShieldCheck,
  GraduationCap,
  Building2,
  Stethoscope,
  MapPin,
  Megaphone,
  HeartHandshake,
  ArrowRight,
} from "lucide-react";
import { ESPECIALIDADES } from "./SorteoRegistro";
import { Campo, Opcion, EVT_STYLES } from "./EventoRegistro";

/* ============================================================
   Portal PÚBLICO de la Comunidad Amsodent (/comunidad).
   Es el destino del QR: la persona escanea, llena sus datos
   (estudiante con su año, o dentista con su especialidad) y
   recibe el correo de bienvenida a la Familia Amsodent.
   Reutiliza el diseño evt-* del formulario de eventos.
   El registro llega a POST /comunidad/registrar (sin auth).
============================================================ */

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3001/api";
const AMSODENT_LOGO = "/logo_superior_ficha.png";

// Evento vigente del QR: Amsodent participa como auspiciador y este
// formulario captura a quienes visitan el stand. Al cambiar de evento,
// actualizar aquí (y el espejo EVENTO_QR en comunidad.service.ts).
const EVENTO_QR = {
  key: "congreso-adeo-uv-2026",
  badge: "Congreso ADEO Chile 2026",
  lugar: "Universidad de Valparaíso",
};

export const ANIOS_ESTUDIO = [
  "1° año",
  "2° año",
  "3° año",
  "4° año",
  "5° año",
  "6° año",
  "Interno/a",
  "Egresado/a",
];

const COMO_CONOCISTE = [
  "Instagram",
  "Recomendación de un colega",
  "Evento Amsodent",
  "Mercado Público",
  "Sitio web",
  "Otro",
];

export default function ComunidadRegistro() {
  const [form, setForm] = useState({
    nombre: "",
    apellido: "",
    telefono: "+56 ", // prefijo de Chile precargado
    correo: "",
    perfil: "", // "estudiante" | "dentista"
    anio_estudio: "",
    universidad: "",
    especialidad: "",
    ciudad: "",
    como_conociste: "",
    acepta_datos: false,
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
    if (!form.perfil) return setError("Cuéntanos si eres estudiante o dentista.");
    if (form.perfil === "estudiante" && !form.anio_estudio)
      return setError("Selecciona en qué año de la carrera estás.");
    if (form.perfil === "dentista" && !form.especialidad)
      return setError("Selecciona tu especialidad.");
    if (!form.acepta_datos)
      return setError("Debes aceptar el tratamiento de tus datos personales para registrarte.");

    setEnviando(true);
    try {
      const res = await fetch(`${API_URL}/comunidad/registrar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nombre: form.nombre.trim(),
          apellido: form.apellido.trim(),
          telefono: form.telefono.trim(),
          correo: form.correo.trim(),
          perfil: form.perfil,
          anio_estudio: form.perfil === "estudiante" ? form.anio_estudio : null,
          universidad: form.perfil === "estudiante" ? form.universidad.trim() || null : null,
          especialidad: form.perfil === "dentista" ? form.especialidad : null,
          ciudad: form.ciudad.trim() || null,
          como_conociste: form.como_conociste || null,
          origen: EVENTO_QR.key,
          acepta_datos: form.acepta_datos === true,
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
                <HeartHandshake size={13} />
                <span>{EVENTO_QR.badge} · {EVENTO_QR.lugar}</span>
              </div>
              <h1 className="evt-title">
                Súmate a la <span>Familia Amsodent</span>
              </h1>
              <p className="evt-sub">
                Como auspiciadores del Congreso ADEO Chile 2026, queremos
                invitarte a ser parte de nuestra comunidad: beneficios,
                invitaciones y novedades pensadas para tu desarrollo profesional.
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

              <div className="evt-field">
                <span className="evt-label">
                  <Stethoscope size={14} className="evt-label-ic" />
                  ¿Cuál es tu perfil? <span className="evt-req">*</span>
                </span>
                <div className="evt-seg">
                  <Opcion
                    selected={form.perfil === "estudiante"}
                    onClick={() => set("perfil")("estudiante")}
                    label="Estudiante"
                  />
                  <Opcion
                    selected={form.perfil === "dentista"}
                    onClick={() => set("perfil")("dentista")}
                    label="Dentista"
                  />
                </div>
              </div>

              {form.perfil === "estudiante" && (
                <>
                  <Campo label="¿En qué año estás?" icon={<GraduationCap size={16} />} select>
                    <select value={form.anio_estudio} onChange={set("anio_estudio")} required>
                      <option value="" disabled>
                        Selecciona tu año…
                      </option>
                      {ANIOS_ESTUDIO.map((a) => (
                        <option key={a} value={a}>
                          {a}
                        </option>
                      ))}
                    </select>
                  </Campo>
                  <Campo label="Universidad" icon={<Building2 size={16} />} optional>
                    <input
                      type="text"
                      value={form.universidad}
                      onChange={set("universidad")}
                      placeholder="Ej: Universidad de Chile (opcional)"
                    />
                  </Campo>
                </>
              )}

              {form.perfil === "dentista" && (
                <Campo label="Tu especialidad" icon={<Stethoscope size={16} />} select>
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
              )}

              <div className="evt-grid2">
                <Campo label="Ciudad" icon={<MapPin size={16} />} optional>
                  <input
                    type="text"
                    value={form.ciudad}
                    onChange={set("ciudad")}
                    placeholder="Ej: Santiago (opcional)"
                  />
                </Campo>
                <Campo label="¿Cómo nos conociste?" icon={<Megaphone size={16} />} select optional>
                  <select value={form.como_conociste} onChange={set("como_conociste")}>
                    <option value="">Opcional…</option>
                    {COMO_CONOCISTE.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </Campo>
              </div>

              <label className="evt-consent">
                <input
                  type="checkbox"
                  checked={form.acepta_datos}
                  onChange={(e) => set("acepta_datos")(e.target.checked)}
                  required
                />
                <span>
                  Acepto que Amsodent Medical trate mis datos personales para
                  gestionar mi registro y enviarme comunicaciones de la
                  comunidad, conforme a la Ley N° 19.628 sobre protección de la
                  vida privada. <span className="evt-req">*</span>
                </span>
              </label>

              {error && (
                <div className="evt-error" role="alert">
                  {error}
                </div>
              )}

              <button type="submit" className="evt-submit" disabled={enviando}>
                {enviando ? (
                  <>
                    <span className="evt-spinner" />
                    Registrando…
                  </>
                ) : (
                  <>
                    Unirme a la comunidad
                    <ArrowRight size={17} />
                  </>
                )}
              </button>

              <div className="evt-trust">
                <ShieldCheck size={13} />
                <span>Tus datos están protegidos y solo se usan para la comunidad Amsodent.</span>
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
              ¡Bienvenid@ a la Familia{nombreRegistrado ? `, ${nombreRegistrado}` : ""}!
            </h1>
            <p className="evt-sub">
              Ya eres parte de la comunidad Amsodent — te enviamos un correo de
              bienvenida (si no lo ves, revisa tu carpeta de spam).
            </p>
            <div className="evt-success-meta">¡Disfruta el congreso! · Equipo AMSODENT</div>
          </div>
        )}
      </main>

      <footer className="evt-footer">
        © {new Date().getFullYear()} AMSODENT · Todos los derechos reservados
      </footer>

      <style>{EVT_STYLES}</style>
      {/* Estilos propios de este formulario (consentimiento de datos). */}
      <style>{`
.evt-consent {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  background: var(--evt-field-bg);
  border: 1.5px solid var(--evt-border);
  border-radius: 12px;
  padding: 12px 14px;
  cursor: pointer;
}
.evt-consent input[type="checkbox"] {
  width: 17px;
  height: 17px;
  margin-top: 1px;
  flex-shrink: 0;
  accent-color: var(--evt-teal-dark);
  cursor: pointer;
}
.evt-consent span {
  font-size: 12px;
  line-height: 1.55;
  color: var(--evt-muted);
}
      `}</style>
    </div>
  );
}
