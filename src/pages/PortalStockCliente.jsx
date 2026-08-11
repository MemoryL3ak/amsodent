import { Fragment, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  ShieldCheck,
  UserCog,
  FileText,
  Database,
  Lock,
  LogOut,
  Plus,
  Trash2,
  Save,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  ExternalLink,
  FileSpreadsheet,
  Send,
  X,
  Activity,
  Zap,
  HelpCircle,
  FileDown,
  Printer,
  Search,
  Phone,
  Mail,
  MapPin,
  Instagram,
  MessageCircle,
  Globe,
  Eye,
  EyeOff,
  KeyRound,
  Upload,
  Download,
} from "lucide-react";

import { descargarCSV, descargarReportePDF } from "../lib/reporteStock";
import { generarPDFcotizacion } from "../utils/generarPDFcotizacion";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3001/api";
const TOKEN_KEY = "portal_stock_token";
const CLIENTE_KEY = "portal_stock_cliente";
// Pasos pendientes tras el login (cambiar clave temporal / aceptar acuerdo),
// para retomar el flujo correcto si el cliente recarga la página.
const PENDIENTE_KEY = "portal_stock_pendiente";

const TEAL = "#0f766e";
const TEAL_LIGHT = "#25b7bd";

function safeJSON(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

async function apiRequest(path, options = {}) {
  const token = localStorage.getItem(TOKEN_KEY) || "";
  const headers = { ...(options.headers || {}) };
  if (!options.skipJson) headers["Content-Type"] = "application/json";
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${API_URL}${path}`, { ...options, headers });
  const text = await res.text();
  const body = text ? safeJSON(text) : null;
  if (!res.ok) {
    const err = new Error((body && (body.message || body.error)) || `Error ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return body;
}

function formatearRutVisual(input) {
  const limpio = String(input || "").replace(/[^0-9kK]/g, "");
  if (!limpio) return "";
  const cuerpo = limpio.slice(0, -1);
  const dv = limpio.slice(-1).toUpperCase();
  const conPuntos = cuerpo.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return cuerpo ? `${conPuntos}-${dv}` : dv;
}

// Formatea un teléfono chileno como "+56 9 1234 5678" (o "+56 2 2854 0000"
// para fijos). Acepta que el usuario teclee con o sin el prefijo 56.
function formatearTelefonoCL(input) {
  let d = String(input || "").replace(/\D/g, "");
  if (d.startsWith("56")) d = d.slice(2);
  d = d.slice(0, 9);
  if (!d) return "";
  if (d.length <= 1) return `+56 ${d}`;
  if (d.length <= 5) return `+56 ${d[0]} ${d.slice(1)}`;
  return `+56 ${d[0]} ${d.slice(1, 5)} ${d.slice(5)}`;
}

// Calcula el color del semáforo según los dos umbrales declarados por el
// cliente para cada producto:
//   - Rojo (crítico): stock actual ≤ stock crítico
//   - Amarillo (bajo): stock actual ≤ stock bajo (debe ser > crítico)
//   - Verde: por sobre el umbral de stock bajo.
// Si el umbral "bajo" no se declara, se usa el respaldo de 1.5×crítico.
function semaforoColor(actual, critico, bajo) {
  const a = Number(actual) || 0;
  const c = Number(critico) || 0;
  if (c <= 0) return "verde";
  if (a <= c) return "rojo";
  const b = bajo == null || bajo === "" ? NaN : Number(bajo);
  const umbralBajo = Number.isFinite(b) && b > c ? b : c * 1.5;
  if (a <= umbralBajo) return "amarillo";
  return "verde";
}

// Formato de moneda chilena (sin decimales) para precios y totales.
function fmtMoneda(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v === 0) return "—";
  return v.toLocaleString("es-CL", {
    style: "currency",
    currency: "CLP",
    maximumFractionDigits: 0,
  });
}

// Precio en pesos (entero). Los precios CLP no llevan decimales, así que se
// toman solo los dígitos: "19.900" → 19900. Evita que Number("19.900") se
// interprete como 19,9 (el punto de miles como decimal) y descuadre el total.
function parsePrecio(v) {
  if (v == null || v === "") return 0;
  const soloDigitos = String(v).replace(/[^\d]/g, "");
  return soloDigitos ? Number(soloDigitos) : 0;
}
// Muestra el precio con separador de miles CL para el input ("19.900").
function fmtPrecioInput(v) {
  const n = parsePrecio(v);
  return n ? n.toLocaleString("es-CL") : "";
}

const SEMAFORO_BADGES = {
  verde: { bg: "#dcfce7", color: "#15803d", icono: CheckCircle2, label: "OK" },
  amarillo: { bg: "#fef3c7", color: "#b45309", icono: AlertTriangle, label: "Bajo" },
  rojo: { bg: "#fee2e2", color: "#b91c1c", icono: AlertCircle, label: "Crítico" },
};

export default function PortalStockCliente() {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY) || "");
  const [cliente, setCliente] = useState(() => safeJSON(localStorage.getItem(CLIENTE_KEY)));
  const [toast, setToast] = useState(null);

  // Pantallas:
  //   'login'         → cliente ingresa RUT + contraseña
  //   'cambiar_clave' → primer ingreso: debe cambiar la clave temporal
  //   'acuerdo'       → aún no acepta el acuerdo de confidencialidad
  //   'declaracion'   → ya autenticado, trabajando con su stock
  const [paso, setPaso] = useState(() => {
    if (!token) return "login";
    const p = safeJSON(localStorage.getItem(PENDIENTE_KEY)) || {};
    // Si al reabrir el portal quedó un cambio de clave a medias (primer ingreso
    // interrumpido), NO saltamos directo a esa pantalla: pedimos iniciar sesión
    // de nuevo. Evita que el portal parezca "atrapado" en la clave sin pasar por
    // el login (y que un token viejo impida completar el cambio).
    if (p.cambiar) return "login";
    if (p.acuerdo) return "acuerdo";
    return "declaracion";
  });

  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(null), 3800);
      return () => clearTimeout(t);
    }
  }, [toast]);

  // Guarda la sesión y enruta según los pasos pendientes (cambiar clave o
  // aceptar acuerdo). El token se persiste de inmediato porque las pantallas
  // de cambio de clave/acuerdo son llamadas autenticadas.
  function iniciarSesion(tok, cli) {
    const pendiente = {
      cambiar: !!cli?.debe_cambiar_clave,
      acuerdo: !!cli?.requiere_acuerdo,
    };
    localStorage.setItem(TOKEN_KEY, tok);
    localStorage.setItem(CLIENTE_KEY, JSON.stringify(cli));
    localStorage.setItem(PENDIENTE_KEY, JSON.stringify(pendiente));
    setToken(tok);
    setCliente(cli);
    if (pendiente.cambiar) setPaso("cambiar_clave");
    else if (pendiente.acuerdo) setPaso("acuerdo");
    else {
      localStorage.removeItem(PENDIENTE_KEY);
      setPaso("declaracion");
    }
  }

  // Avanza tras completar el cambio de clave obligatorio.
  function claveCambiada() {
    const p = safeJSON(localStorage.getItem(PENDIENTE_KEY)) || {};
    p.cambiar = false;
    localStorage.setItem(PENDIENTE_KEY, JSON.stringify(p));
    if (p.acuerdo) setPaso("acuerdo");
    else {
      localStorage.removeItem(PENDIENTE_KEY);
      setPaso("declaracion");
    }
  }

  // Avanza tras aceptar el acuerdo de confidencialidad.
  function acuerdoAceptado() {
    localStorage.removeItem(PENDIENTE_KEY);
    setPaso("declaracion");
  }

  function cerrarSesion() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(CLIENTE_KEY);
    localStorage.removeItem(PENDIENTE_KEY);
    setToken("");
    setCliente(null);
    setPaso("login");
  }

  return (
    <div style={styles.root}>
      <Estilos />

      <div style={styles.fondo} aria-hidden />
      <div style={styles.fondoPattern} aria-hidden />

      <div style={styles.shell}>
        {/* Header solo cuando el cliente ya está identificado */}
        {paso === "declaracion" && (
          <header style={styles.header} data-portal-header>
            <div style={styles.brand}>
              <img
                src="https://amsodentmedical.cl/wp-content/uploads/2025/12/Amsodent-1.png"
                alt="Amsodent"
                style={styles.brandLogo}
              />
              <span style={styles.brandDivider} aria-hidden />
              <div style={styles.brandTextWrap}>
                <div style={styles.brandEyebrow}>Portal del Cliente</div>
                <div style={styles.brandTitle}>Gestión de Stock</div>
              </div>
            </div>

            {token && cliente && (
              <button onClick={cerrarSesion} style={styles.btnGhost} title="Cerrar sesión">
                <LogOut size={14} /> Cerrar sesión
              </button>
            )}
          </header>
        )}

        <main style={styles.main} data-portal-main>
          {paso === "login" && (
            <div style={styles.loginViewport}>
              <PantallaLogin onLogin={iniciarSesion} setToast={setToast} />
            </div>
          )}
          {paso === "cambiar_clave" && (
            <div style={styles.loginViewport}>
              <PantallaCambiarClave
                cliente={cliente}
                onListo={claveCambiada}
                onVolver={cerrarSesion}
                setToast={setToast}
              />
            </div>
          )}
          {paso === "acuerdo" && cliente && (
            <div style={styles.loginViewport}>
              <PantallaAcuerdo
                cliente={cliente}
                onAceptar={acuerdoAceptado}
                onVolver={cerrarSesion}
                setToast={setToast}
              />
            </div>
          )}
          {paso === "declaracion" && token && cliente && (
            <PantallaDeclaracion cliente={cliente} setToast={setToast} />
          )}
        </main>

        {paso === "declaracion" && <FooterContacto />}
        {paso !== "declaracion" && (
          <footer style={styles.footer}>
            <div style={styles.footerInner}>
              <div style={styles.footerBrand}>
                <span>© {new Date().getFullYear()} Amsodent · Portal seguro</span>
              </div>
              <div style={styles.footerLinks}>
                <span style={styles.footerLink}>
                  <ShieldCheck size={12} /> Conexión cifrada
                </span>
                <a
                  href="https://www.amsodentmedical.cl"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={styles.footerLink}
                >
                  amsodentmedical.cl <ExternalLink size={11} />
                </a>
              </div>
            </div>
          </footer>
        )}
      </div>

      {toast && <ToastFlotante toast={toast} onClose={() => setToast(null)} />}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────
   PASO 2 — Acuerdo de confidencialidad (+ razón social si es 1er ingreso)
   ────────────────────────────────────────────────────────────────────── */
function PantallaAcuerdo({ cliente, onAceptar, onVolver, setToast }) {
  const [aceptado, setAceptado] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState("");

  async function continuar() {
    setError("");
    if (!aceptado) {
      setError("Debe aceptar el acuerdo para continuar.");
      return;
    }
    setEnviando(true);
    try {
      await apiRequest("/stock-clientes/aceptar-acuerdo", {
        method: "POST",
        body: JSON.stringify({}),
      });
      onAceptar();
    } catch (e) {
      setError(e?.message || "No pudimos completar el ingreso.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div style={styles.acuerdoWrap} className="anim-fade-up">
      <div style={{ display: "flex", justifyContent: "center", marginBottom: 22 }}>
        <div style={styles.brandMark} className="anim-chip">
          <img
            src="https://amsodentmedical.cl/wp-content/uploads/2025/12/Amsodent-1.png"
            alt="Amsodent Medical"
            style={styles.brandMarkLogo}
          />
          <span style={styles.brandMarkDivider} aria-hidden />
          <div style={styles.brandMarkInfo}>
            <span style={styles.brandMarkEyebrow}>Portal del Cliente</span>
            <span style={styles.brandMarkSub}>Acuerdo de confidencialidad</span>
          </div>
        </div>
      </div>

      <div style={styles.acuerdoCard}>
        <div style={styles.acuerdoIcon}>
          <ShieldCheck size={28} />
        </div>
        <h1 style={styles.acuerdoTitulo}>Acuerdo de Confidencialidad</h1>
        <p style={styles.acuerdoSub}>
          Antes de continuar, le pedimos leer y aceptar las condiciones de
          uso de su información. Esta aceptación se solicita una sola vez.
        </p>

        {/* Identidad confirmada contra el maestro de clientes */}
        <div style={styles.identidadConfirmada}>
          <div style={styles.identidadEmpresa}>{cliente?.razon_social}</div>
          <div style={styles.identidadRut}>{cliente?.rut_formateado}</div>
        </div>

        <div style={styles.acuerdoLista}>
          <BloqueAcuerdo
            icono={UserCog}
            titulo="Uso Exclusivo"
            texto="Los datos proporcionados se utilizan únicamente para el análisis de rotación y la generación de sus alertas de stock."
          />
          <BloqueAcuerdo
            icono={FileText}
            titulo="Secreto Profesional"
            texto="Garantizamos por contrato la no divulgación de sus cifras de compra o marcas estratégicas a terceros."
          />
          <BloqueAcuerdo
            icono={Database}
            titulo="Integridad de Datos"
            texto={`Protocolos de seguridad para asegurar que su "receta" operativa permanezca privada y protegida.`}
          />
        </div>

        <label style={styles.checkboxRow}>
          <input
            type="checkbox"
            checked={aceptado}
            onChange={(e) => setAceptado(e.target.checked)}
            style={styles.checkbox}
          />
          <span>
            <strong>Estoy de acuerdo</strong> con los términos descritos y autorizo
            el tratamiento de mis datos para los fines indicados.
          </span>
        </label>

        {error && <div style={styles.errorBox}>{error}</div>}

        <div style={{ display: "flex", gap: 10, marginTop: 6 }}>
          <button
            type="button"
            onClick={onVolver}
            style={styles.btnGhostFlat}
            disabled={enviando}
          >
            Volver
          </button>
          <button
            type="button"
            onClick={continuar}
            disabled={!aceptado || enviando}
            style={{
              ...styles.btnPrimario,
              flex: 1,
              opacity: aceptado && !enviando ? 1 : 0.55,
              cursor: aceptado && !enviando ? "pointer" : "not-allowed",
            }}
          >
            {enviando ? "Ingresando…" : "Continuar al portal"}
          </button>
        </div>
      </div>
    </div>
  );
}

function BloqueAcuerdo({ icono: Icon, titulo, texto }) {
  return (
    <div style={styles.acuerdoBloque}>
      <div style={styles.acuerdoBloqueIcono}>
        <Icon size={20} />
      </div>
      <div>
        <div style={styles.acuerdoBloqueTitulo}>{titulo}</div>
        <div style={styles.acuerdoBloqueTexto}>{texto}</div>
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────
   PASO 1 — Login: cliente ingresa RUT + contraseña
   ────────────────────────────────────────────────────────────────────── */
function PantallaLogin({ onLogin, setToast }) {
  const [rut, setRut] = useState("");
  const [password, setPassword] = useState("");
  const [verClave, setVerClave] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState("");
  const [mostrarRecuperar, setMostrarRecuperar] = useState(false);

  async function continuar(e) {
    e?.preventDefault?.();
    setError("");

    const rutLimpio = String(rut || "").replace(/[^0-9kK]/g, "").toLowerCase();
    if (!rutLimpio) {
      setError("Debe ingresar su RUT.");
      return;
    }
    if (!password) {
      setError("Debe ingresar su contraseña.");
      return;
    }

    setEnviando(true);
    try {
      const res = await apiRequest("/stock-clientes/login", {
        method: "POST",
        body: JSON.stringify({ rut: rutLimpio, password }),
      });
      if (res?.token) {
        onLogin(res.token, res.cliente);
      } else {
        setError("No pudimos iniciar la sesión.");
      }
    } catch (e) {
      setError(e?.message || "No pudimos iniciar la sesión.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div style={styles.loginGrid} className="anim-fade-up" data-portal-grid>
      {/* Orbes decorativos flotantes */}
      <div className="login-orb login-orb-a" aria-hidden />
      <div className="login-orb login-orb-b" aria-hidden />
      <div className="login-orb login-orb-c" aria-hidden />

      {/* Columna izquierda: pitch */}
      <section style={styles.loginPitch}>
        <div style={styles.brandMark} className="anim-chip">
          <img
            src="https://amsodentmedical.cl/wp-content/uploads/2025/12/Amsodent-1.png"
            alt="Amsodent Medical"
            style={styles.brandMarkLogo}
          />
          <span style={styles.brandMarkDivider} aria-hidden />
          <div style={styles.brandMarkInfo}>
            <span style={styles.brandMarkEyebrow}>Portal del Cliente</span>
            <span style={styles.brandMarkSub}>Gestión de Stock</span>
          </div>
        </div>
        <h1 style={styles.loginHero}>
          Su stock,{" "}
          <span style={styles.loginHeroAccent} className="hero-shine">
            al día
          </span>
          <br />
          con un par de clicks.
        </h1>
        <p style={styles.loginHeroSub}>
          Declare el inventario de su empresa y le avisamos cuando un producto
          se acerca al mínimo. Sin correos cruzados, sin demoras.
        </p>

        <ul style={styles.featuresList}>
          <FeatureItem
            icono={Activity}
            titulo="Semáforo en tiempo real"
            texto="Verde, amarillo o rojo según los umbrales que usted define."
            delay={0}
          />
          <FeatureItem
            icono={Zap}
            titulo="Alertas automáticas"
            texto="Cuando un producto cae bajo su mínimo, nuestro equipo lo sabe."
            delay={100}
          />
          <FeatureItem
            icono={FileSpreadsheet}
            titulo="Solicite cotización"
            texto="Pida reposiciones desde el mismo portal, con respuesta rápida."
            delay={200}
          />
        </ul>

        <div style={styles.loginAyuda} className="anim-ayuda">
          <HelpCircle size={14} />
          <span>
            Su empresa debe estar registrada en nuestros sistemas para acceder.
          </span>
        </div>
      </section>

      {/* Columna derecha: formulario */}
      <section style={styles.loginFormCol}>
        <div style={styles.loginCard} className="login-card-float">
          <div style={styles.loginCardGlow} aria-hidden />
          <div style={styles.acuerdoIcon} className="anim-icon-pop">
            <Lock size={22} />
          </div>
          <h2 style={styles.loginTitulo}>Acceso del cliente</h2>
          <p style={styles.loginSub}>
            Ingrese el RUT de su empresa y su contraseña para continuar.
          </p>

          <form onSubmit={continuar} style={styles.form}>
            <label style={styles.label}>
              RUT
              <input
                type="text"
                inputMode="text"
                autoComplete="username"
                placeholder="12.345.678-9"
                value={formatearRutVisual(rut)}
                onChange={(e) => setRut(e.target.value)}
                style={styles.input}
                disabled={enviando}
                autoFocus
              />
            </label>

            <label style={styles.label}>
              Contraseña
              <div style={{ position: "relative" }}>
                <input
                  type={verClave ? "text" : "password"}
                  autoComplete="current-password"
                  placeholder="Su contraseña"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  style={{ ...styles.input, paddingRight: 44 }}
                  disabled={enviando}
                />
                <button
                  type="button"
                  onClick={() => setVerClave((v) => !v)}
                  aria-label={verClave ? "Ocultar contraseña" : "Mostrar contraseña"}
                  style={styles.verClaveBtn}
                  tabIndex={-1}
                >
                  {verClave ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </label>

            {error && <div style={styles.errorBox}>{error}</div>}

            <button
              type="submit"
              style={{ ...styles.btnPrimario, marginTop: 6 }}
              disabled={enviando}
              className="btn-guardar-shine"
            >
              {enviando ? "Ingresando…" : "Ingresar"}
            </button>

            <button
              type="button"
              onClick={() => setMostrarRecuperar(true)}
              style={styles.linkRecuperar}
              disabled={enviando}
            >
              ¿Olvidó su contraseña?
            </button>
          </form>

          {mostrarRecuperar && (
            <ModalRecuperar
              rutInicial={rut}
              onCerrar={() => setMostrarRecuperar(false)}
              setToast={setToast}
            />
          )}

          <div style={styles.loginPie}>
            <ShieldCheck size={12} /> Conexión cifrada · Acuerdo de
            confidencialidad
          </div>
        </div>
      </section>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────
   PASO 1.5 — Cambio obligatorio de clave (primer ingreso / clave temporal)
   ────────────────────────────────────────────────────────────────────── */
// Política de contraseña del portal: mínimo 8 caracteres, con al menos una
// mayúscula, una minúscula y un número. Debe coincidir con la validación del
// backend (stock-clientes.service: validarPasswordPortal).
const REGLAS_CLAVE = [
  { test: (s) => s.length >= 8, label: "Al menos 8 caracteres" },
  { test: (s) => /[A-Z]/.test(s), label: "Una letra mayúscula" },
  { test: (s) => /[a-z]/.test(s), label: "Una letra minúscula" },
  { test: (s) => /[0-9]/.test(s), label: "Un número" },
];
function claveCumplePolitica(s) {
  return REGLAS_CLAVE.every((r) => r.test(String(s || "")));
}

function PantallaCambiarClave({ cliente, onListo, onVolver, setToast }) {
  const [clave, setClave] = useState("");
  const [confirmar, setConfirmar] = useState("");
  const [ver, setVer] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState("");

  async function guardar(e) {
    e?.preventDefault?.();
    setError("");
    if (!claveCumplePolitica(clave)) {
      setError("La contraseña no cumple los requisitos de seguridad indicados.");
      return;
    }
    if (clave !== confirmar) {
      setError("Las contraseñas no coinciden.");
      return;
    }
    setEnviando(true);
    try {
      await apiRequest("/stock-clientes/cambiar-clave", {
        method: "POST",
        body: JSON.stringify({ password_nueva: clave }),
      });
      setToast({
        type: "success",
        titulo: "Contraseña actualizada",
        mensaje: "Su nueva contraseña quedó guardada.",
      });
      onListo();
    } catch (e) {
      setError(e?.message || "No pudimos actualizar la contraseña.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div style={styles.acuerdoWrap} className="anim-fade-up">
      <div style={{ display: "flex", justifyContent: "center", marginBottom: 22 }}>
        <div style={styles.brandMark} className="anim-chip">
          <img
            src="https://amsodentmedical.cl/wp-content/uploads/2025/12/Amsodent-1.png"
            alt="Amsodent Medical"
            style={styles.brandMarkLogo}
          />
          <span style={styles.brandMarkDivider} aria-hidden />
          <div style={styles.brandMarkInfo}>
            <span style={styles.brandMarkEyebrow}>Portal del Cliente</span>
            <span style={styles.brandMarkSub}>Seguridad de su cuenta</span>
          </div>
        </div>
      </div>

      <div style={{ ...styles.acuerdoCard, maxWidth: 460 }}>
        <div style={styles.acuerdoIcon}>
          <KeyRound size={26} />
        </div>
        <h1 style={styles.acuerdoTitulo}>Cree su nueva contraseña</h1>
        <p style={styles.acuerdoSub}>
          Por su seguridad, debe reemplazar la contraseña temporal que le
          entregamos por una de su elección antes de continuar.
        </p>

        <form onSubmit={guardar} style={{ ...styles.form, marginTop: 4 }}>
          <label style={styles.label}>
            Nueva contraseña
            <div style={{ position: "relative" }}>
              <input
                type={ver ? "text" : "password"}
                autoComplete="new-password"
                placeholder="Mínimo 8 caracteres"
                value={clave}
                onChange={(e) => setClave(e.target.value)}
                style={{ ...styles.input, paddingRight: 44 }}
                disabled={enviando}
                autoFocus
              />
              <button
                type="button"
                onClick={() => setVer((v) => !v)}
                aria-label={ver ? "Ocultar contraseña" : "Mostrar contraseña"}
                style={styles.verClaveBtn}
                tabIndex={-1}
              >
                {ver ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </label>

          {/* Requisitos de seguridad — se marcan en verde a medida que se cumplen */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: "6px 14px",
              padding: "12px 14px",
              background: "#f8fafc",
              border: "1px solid #e2e8f0",
              borderRadius: 12,
              marginTop: -2,
            }}
          >
            {REGLAS_CLAVE.map((r) => {
              const ok = r.test(clave);
              return (
                <div
                  key={r.label}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 7,
                    fontSize: 12.5,
                    color: ok ? "#15803d" : "#94a3b8",
                    fontWeight: ok ? 600 : 500,
                    transition: "color .15s ease",
                  }}
                >
                  {ok ? (
                    <CheckCircle2 size={15} />
                  ) : (
                    <span
                      style={{
                        width: 13,
                        height: 13,
                        borderRadius: "50%",
                        border: "2px solid #cbd5e1",
                        flexShrink: 0,
                      }}
                    />
                  )}
                  {r.label}
                </div>
              );
            })}
          </div>

          <label style={styles.label}>
            Repita la contraseña
            <input
              type={ver ? "text" : "password"}
              autoComplete="new-password"
              placeholder="Repita la nueva contraseña"
              value={confirmar}
              onChange={(e) => setConfirmar(e.target.value)}
              style={styles.input}
              disabled={enviando}
            />
          </label>

          {error && <div style={styles.errorBox}>{error}</div>}

          <button
            type="submit"
            style={{ ...styles.btnPrimario, marginTop: 6 }}
            disabled={enviando}
            className="btn-guardar-shine"
          >
            {enviando ? "Guardando…" : "Guardar y continuar"}
          </button>

          {onVolver && (
            <button
              type="button"
              onClick={onVolver}
              disabled={enviando}
              style={{
                background: "none",
                border: "none",
                color: TEAL,
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
                marginTop: 2,
              }}
            >
              Volver al inicio de sesión
            </button>
          )}
        </form>
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────
   Modal — Solicitud de recuperación de clave (contacto con soporte)
   ────────────────────────────────────────────────────────────────────── */
function ModalRecuperar({ rutInicial, onCerrar, setToast }) {
  const [rut, setRut] = useState(rutInicial || "");
  const [nombre, setNombre] = useState("");
  const [email, setEmail] = useState("");
  const [telefono, setTelefono] = useState("");
  const [mensaje, setMensaje] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState("");

  async function enviar(e) {
    e?.preventDefault?.();
    setError("");
    const rutLimpio = String(rut || "").replace(/[^0-9kK]/g, "").toLowerCase();
    if (!rutLimpio) {
      setError("Indique su RUT.");
      return;
    }
    if (!email.trim() && !telefono.trim()) {
      setError("Indique un correo o teléfono para poder responderle.");
      return;
    }
    setEnviando(true);
    try {
      await apiRequest("/stock-clientes/recuperacion", {
        method: "POST",
        body: JSON.stringify({
          rut: rutLimpio,
          contacto_nombre: nombre.trim(),
          contacto_email: email.trim(),
          contacto_telefono: telefono.trim(),
          mensaje: mensaje.trim(),
        }),
      });
      onCerrar();
      setToast({
        type: "success",
        titulo: "Solicitud enviada",
        mensaje:
          "Recibimos su solicitud. Nuestro equipo de soporte se contactará para restablecer su clave.",
      });
    } catch (e) {
      setError(e?.message || "No pudimos enviar su solicitud.");
    } finally {
      setEnviando(false);
    }
  }

  // Se renderiza con portal al <body> para que el overlay (position: fixed)
  // cubra el viewport completo y NO quede confinado/recortado por la tarjeta
  // de login, que tiene transform (animación cardFloat) + overflow:hidden.
  return createPortal(
    <div style={styles.modalOverlay} onClick={onCerrar}>
      <div
        style={styles.modalRecuperar}
        className="anim-fade-up"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onCerrar}
          style={styles.modalCerrar}
          aria-label="Cerrar"
        >
          <X size={18} />
        </button>

        <div style={styles.acuerdoIcon}>
          <HelpCircle size={22} />
        </div>
        <h2 style={styles.loginTitulo}>Recuperar contraseña</h2>
        <p style={styles.loginSub}>
          Déjenos sus datos y nuestro equipo de soporte le ayudará a restablecer
          su acceso.
        </p>

        <form onSubmit={enviar} style={styles.form}>
          <label style={styles.label}>
            RUT
            <input
              type="text"
              placeholder="12.345.678-9"
              value={formatearRutVisual(rut)}
              onChange={(e) => setRut(e.target.value)}
              style={styles.input}
              disabled={enviando}
            />
          </label>
          <label style={styles.label}>
            Nombre de contacto
            <input
              type="text"
              placeholder="Su nombre"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              style={styles.input}
              disabled={enviando}
            />
          </label>
          <label style={styles.label}>
            Correo
            <input
              type="email"
              placeholder="correo@empresa.cl"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={styles.input}
              disabled={enviando}
            />
          </label>
          <label style={styles.label}>
            Teléfono
            <input
              type="tel"
              placeholder="+56 9 1234 5678"
              value={telefono}
              onChange={(e) => setTelefono(formatearTelefonoCL(e.target.value))}
              style={styles.input}
              disabled={enviando}
            />
          </label>
          <label style={styles.label}>
            Mensaje (opcional)
            <textarea
              placeholder="Cuéntenos brevemente su situación…"
              value={mensaje}
              onChange={(e) => setMensaje(e.target.value)}
              style={{ ...styles.input, minHeight: 70, resize: "vertical" }}
              disabled={enviando}
            />
          </label>

          {error && <div style={styles.errorBox}>{error}</div>}

          <button
            type="submit"
            style={{ ...styles.btnPrimario, marginTop: 4 }}
            disabled={enviando}
          >
            {enviando ? "Enviando…" : "Enviar solicitud"}
          </button>
        </form>
      </div>
    </div>,
    document.body,
  );
}

function BrandPortalCliente() {
  return (
    <div style={styles.loginBrand} className="anim-brand">
      <img
        src="https://amsodentmedical.cl/wp-content/uploads/2025/12/Amsodent-1.png"
        alt="Amsodent Medical"
        style={styles.loginBrandLogo}
      />
      <div style={styles.loginBrandEyebrow}>Portal del Cliente</div>
    </div>
  );
}

function FeatureItem({ icono: Icono, titulo, texto, delay = 0 }) {
  return (
    <li
      className="feature-item"
      style={{ ...styles.featureItem, animationDelay: `${delay}ms` }}
    >
      <span style={styles.featureIcono}>
        <Icono size={18} />
      </span>
      {/* minWidth 0: sin esto el bloque de texto no baja de su ancho mínimo
          natural y empuja la lista fuera de la pantalla. */}
      <div style={{ minWidth: 0 }}>
        <div style={styles.featureTitulo}>{titulo}</div>
        <div style={styles.featureTexto}>{texto}</div>
      </div>
    </li>
  );
}

/* ──────────────────────────────────────────────────────────────────────
   PASO 3 — Declaración de productos + semáforo
   ────────────────────────────────────────────────────────────────────── */
function PantallaDeclaracion({ cliente, setToast }) {
  const [tab, setTab] = useState("declaracion"); // "declaracion" | "solicitudes"
  const [items, setItems] = useState([]);
  // Copia del último estado guardado/cargado, para "Cancelar cambios".
  const [baseline, setBaseline] = useState([]);
  const [historial, setHistorial] = useState([]);
  const [solicitudes, setSolicitudes] = useState([]);
  const [cotizacionesHist, setCotizacionesHist] = useState([]); // cotizaciones del sistema por RUT
  const [cargando, setCargando] = useState(true);
  const [cargandoSolicitudes, setCargandoSolicitudes] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [mostrarSolicitud, setMostrarSolicitud] = useState(false);
  const [mostrarCargaMasiva, setMostrarCargaMasiva] = useState(false);
  // Sucursales (catálogos por dirección). Las gestiona el administrador; aquí
  // solo se seleccionan.
  const [sucursales, setSucursales] = useState([]);
  const [sucursalId, setSucursalId] = useState(null);
  const [mostrarSucursales, setMostrarSucursales] = useState(false);

  // Ubicaciones del cliente (bodega/caja/estante), gestionadas por él.
  const [ubicaciones, setUbicaciones] = useState([]);
  const [mostrarUbicaciones, setMostrarUbicaciones] = useState(false);

  async function cargarUbicaciones() {
    try {
      const data = await apiRequest("/stock-clientes/mis-ubicaciones");
      setUbicaciones(Array.isArray(data) ? data : []);
    } catch { /* */ }
  }

  const sucursalActual = useMemo(
    () => sucursales.find((s) => String(s.id) === String(sucursalId)) || null,
    [sucursales, sucursalId],
  );

  async function cargarSucursales(preferirId) {
    try {
      const data = await apiRequest("/stock-clientes/mis-sucursales");
      const lista = Array.isArray(data) ? data : [];
      setSucursales(lista);
      setSucursalId((prev) => {
        const elegido = preferirId ?? prev;
        if (elegido && lista.some((s) => String(s.id) === String(elegido))) return elegido;
        return lista[0]?.id ?? null;
      });
      return lista;
    } catch {
      return [];
    }
  }

  async function cargarSolicitudes() {
    setCargandoSolicitudes(true);
    try {
      const [data, hist] = await Promise.all([
        apiRequest("/stock-clientes/mis-solicitudes"),
        apiRequest("/stock-clientes/mis-cotizaciones").catch(() => []),
      ]);
      setSolicitudes(Array.isArray(data) ? data : []);
      setCotizacionesHist(Array.isArray(hist) ? hist : []);
    } catch {
      // silencioso — no rompe la UI
    } finally {
      setCargandoSolicitudes(false);
    }
  }

  // Cargar sucursales + ubicaciones al montar.
  useEffect(() => {
    cargarSucursales();
    cargarUbicaciones();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cargar catálogo + declaraciones de la sucursal activa.
  useEffect(() => {
    if (!sucursalId) return;
    let cancel = false;
    async function cargar() {
      setCargando(true);
      try {
        const qs = `?sucursal_id=${sucursalId}`;
        const [productos, decls, solics, cots] = await Promise.all([
          apiRequest(`/stock-clientes/mis-productos${qs}`),
          apiRequest(`/stock-clientes/mis-declaraciones${qs}`),
          apiRequest("/stock-clientes/mis-solicitudes").catch(() => []),
          apiRequest("/stock-clientes/mis-cotizaciones").catch(() => []),
        ]);
        if (cancel) return;
        setSolicitudes(Array.isArray(solics) ? solics : []);
        setCotizacionesHist(Array.isArray(cots) ? cots : []);
        const lista = Array.isArray(productos) ? productos : [];
        if (lista.length === 0) {
          const vacio = [crearItemVacio()];
          setItems(vacio);
          setBaseline(vacio.map((o) => ({ ...o })));
        } else {
          const mapeados = lista.map((p) => ({
            nombre: p.nombre,
            sku: p.sku || "",
            marca: p.marca || "",
            unidad: p.unidad || "",
            stock_actual: p.stock_actual ?? "",
            stock_bajo: p.stock_alerta ?? "",
            stock_minimo: p.stock_minimo ?? "",
            // El backend puede devolver el precio como numérico "19900.00";
            // se normaliza a entero de pesos para que el estado siempre tenga
            // dígitos limpios (evita que "19900.00" se lea como 1.990.000).
            precio_unitario:
              p.precio_unitario == null || p.precio_unitario === ""
                ? ""
                : String(Math.round(Number(p.precio_unitario))),
            ubicacion_id: p.ubicacion_id ?? "",
          }));
          setItems(mapeados);
          setBaseline(mapeados.map((o) => ({ ...o })));
        }
        setHistorial(Array.isArray(decls) ? decls : []);
      } catch (e) {
        if (!cancel) {
          setToast({ type: "error", mensaje: e?.message || "No pudimos cargar sus productos." });
          setItems([crearItemVacio()]);
        }
      } finally {
        if (!cancel) setCargando(false);
      }
    }
    cargar();
    return () => {
      cancel = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sucursalId]);

  function crearItemVacio() {
    return {
      nombre: "",
      sku: "",
      marca: "",
      unidad: "",
      stock_actual: "",
      stock_bajo: "",
      stock_minimo: "",
      precio_unitario: "",
      ubicacion_id: "",
    };
  }

  function actualizarItem(idx, campo, valor) {
    setItems((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], [campo]: valor };
      return next;
    });
  }

  function agregarItem() {
    setItems((prev) => [...prev, crearItemVacio()]);
  }

  function eliminarItem(idx) {
    setItems((prev) => (prev.length === 1 ? [crearItemVacio()] : prev.filter((_, i) => i !== idx)));
  }

  // Descarta los cambios no guardados y vuelve al último estado guardado.
  function revertirCambios() {
    setItems(baseline.length ? baseline.map((o) => ({ ...o })) : [crearItemVacio()]);
  }

  // Carga masiva: incorpora a la tabla los productos leídos de un archivo.
  // Si `reemplazar` es true sustituye la lista; si no, los agrega al final
  // (descartando las filas vacías actuales). El cliente revisa y luego guarda.
  function cargarMasivo(filasNuevas, reemplazar) {
    const nuevas = (filasNuevas || []).map((f) => ({ ...crearItemVacio(), ...f }));
    if (nuevas.length === 0) return;
    setItems((prev) => {
      if (reemplazar) return nuevas;
      const actuales = prev.filter(
        (it) => String(it.nombre || "").trim() || String(it.sku || "").trim(),
      );
      const combinadas = [...actuales, ...nuevas];
      return combinadas.length ? combinadas : [crearItemVacio()];
    });
    setMostrarCargaMasiva(false);
    setToast({
      type: "success",
      titulo: "Productos cargados",
      mensaje: `Se agregaron ${nuevas.length} producto${nuevas.length === 1 ? "" : "s"} a la tabla. Revise y presione "Guardar stock".`,
    });
  }

  // Hay cambios pendientes si la tabla difiere del último estado guardado.
  const hayCambios = useMemo(
    () => JSON.stringify(items) !== JSON.stringify(baseline),
    [items, baseline],
  );

  const { totales, itemsCriticos, itemsBajos } = useMemo(() => {
    const tot = { total: 0, verdes: 0, amarillos: 0, rojos: 0, valor: 0 };
    const criticos = [];
    const bajos = [];
    for (const it of items) {
      if (!String(it.nombre || "").trim()) continue;
      const s = semaforoColor(it.stock_actual, it.stock_minimo, it.stock_bajo);
      tot.total += 1;
      tot.valor +=
        (Number(it.stock_actual) || 0) * parsePrecio(it.precio_unitario);
      if (s === "rojo") {
        tot.rojos += 1;
        criticos.push(it);
      } else if (s === "amarillo") {
        tot.amarillos += 1;
        bajos.push(it);
      } else {
        tot.verdes += 1;
      }
    }
    return { totales: tot, itemsCriticos: criticos, itemsBajos: bajos };
  }, [items]);

  async function guardar() {
    const limpios = items
      .map((it) => {
        const minimo = Number(it.stock_minimo) || 0;
        // El cliente declara el umbral de stock bajo (amarillo) por producto.
        const bajoNum = Number(it.stock_bajo);
        const stock_alerta =
          Number.isFinite(bajoNum) && bajoNum > 0 ? bajoNum : null;
        // Precio como entero de pesos (sin separadores), nunca 19,9 por miles.
        const precioNum = parsePrecio(it.precio_unitario);
        const precio_unitario = precioNum > 0 ? precioNum : null;
        return {
          nombre: String(it.nombre || "").trim(),
          sku: String(it.sku || "").trim() || undefined,
          marca: String(it.marca || "").trim() || undefined,
          unidad: String(it.unidad || "").trim() || undefined,
          stock_actual: Number(it.stock_actual) || 0,
          stock_minimo: minimo,
          stock_alerta,
          precio_unitario,
          ubicacion_id: it.ubicacion_id ? Number(it.ubicacion_id) : null,
        };
      })
      .filter((it) => it.nombre.length > 0);

    if (limpios.length === 0) {
      setToast({ type: "warning", mensaje: "Agregue al menos un producto antes de guardar." });
      return;
    }

    setGuardando(true);
    try {
      const res = await apiRequest("/stock-clientes/declaracion", {
        method: "POST",
        body: JSON.stringify({ items: limpios, sucursal_id: sucursalId }),
      });
      const decl = res?.declaracion;
      const totalAlertas = (decl?.total_rojos || 0) + (decl?.total_amarillos || 0);
      const tieneAlerta = totalAlertas > 0;
      setToast({
        type: tieneAlerta ? "warning" : "success",
        titulo: "Declaración guardada",
        mensaje: tieneAlerta
          ? `Avisaremos al equipo: ${totalAlertas} producto${totalAlertas === 1 ? "" : "s"} requieren atención.`
          : "Todos sus productos están por sobre el mínimo declarado.",
      });
      // El estado guardado pasa a ser la nueva línea base para "Cancelar cambios".
      setBaseline(items.map((o) => ({ ...o })));
      // refresca el historial
      const decls = await apiRequest("/stock-clientes/mis-declaraciones").catch(() => []);
      setHistorial(Array.isArray(decls) ? decls : []);
    } catch (e) {
      setToast({ type: "error", mensaje: e?.message || "No pudimos guardar la declaración." });
    } finally {
      setGuardando(false);
    }
  }

  // Productos en estado bajo o crítico, para el reporte exportable.
  function filasReporte() {
    return items
      .filter((it) => String(it.nombre || "").trim())
      .map((it) => ({
        ...it,
        sem: semaforoColor(it.stock_actual, it.stock_minimo, it.stock_bajo),
      }))
      .filter((r) => r.sem === "rojo" || r.sem === "amarillo");
  }

  function exportarCSV() {
    const filas = filasReporte();
    if (filas.length === 0) {
      setToast({
        type: "warning",
        mensaje: "No hay productos en estado bajo o crítico para exportar.",
      });
      return;
    }
    const headers = [
      "Producto",
      "Marca",
      "Formato",
      "Stock actual",
      "Stock bajo",
      "Stock crítico",
      "Precio unitario",
      "Total",
      "Estado",
    ];
    const rows = filas.map((r) => [
      r.nombre,
      r.marca || "",
      r.unidad || "",
      Number(r.stock_actual) || 0,
      r.stock_bajo || "",
      r.stock_minimo || "",
      parsePrecio(r.precio_unitario),
      (Number(r.stock_actual) || 0) * parsePrecio(r.precio_unitario),
      r.sem === "rojo" ? "Crítico" : "Bajo",
    ]);
    const fecha = new Date().toISOString().slice(0, 10);
    descargarCSV(`reporte-stock-${fecha}.csv`, headers, rows);
  }

  async function imprimirReporte() {
    const filas = filasReporte();
    if (filas.length === 0) {
      setToast({
        type: "warning",
        mensaje: "No hay productos en estado bajo o crítico para exportar.",
      });
      return;
    }
    const nCriticos = filas.filter((r) => r.sem === "rojo").length;
    const nBajos = filas.filter((r) => r.sem === "amarillo").length;
    const valorAlerta = filas.reduce(
      (acc, r) =>
        acc + (Number(r.stock_actual) || 0) * parsePrecio(r.precio_unitario),
      0,
    );
    const fecha = new Date().toISOString().slice(0, 10);
    const ok = await descargarReportePDF({
      filename: `reporte-stock-${fecha}.pdf`,
      titulo: "Reporte de stock bajo y crítico",
      subtitulo: "Productos que requieren reposición",
      meta: [
        { label: "Cliente", valor: cliente.razon_social || "" },
        { label: "RUT", valor: cliente.rut_formateado || "" },
        { label: "Productos en alerta", valor: String(filas.length) },
      ],
      resumen: [
        { label: "Crítico", valor: nCriticos, tono: "rojo" },
        { label: "Bajo", valor: nBajos, tono: "amarillo" },
        { label: "Valor en alerta", valor: fmtMoneda(valorAlerta), tono: "neutro" },
      ],
      headers: [
        "Producto",
        "Marca",
        "Formato",
        "Stock actual",
        "Stock bajo",
        "Stock crítico",
        "Total",
        "Estado",
      ],
      aligns: [
        "left",
        "left",
        "left",
        "right",
        "right",
        "right",
        "right",
        "center",
      ],
      rows: filas.map((r) => [
        r.nombre,
        r.marca || "—",
        r.unidad || "—",
        Number(r.stock_actual) || 0,
        r.stock_bajo || "—",
        r.stock_minimo || "—",
        fmtMoneda((Number(r.stock_actual) || 0) * parsePrecio(r.precio_unitario)),
        r.sem === "rojo" ? "Crítico" : "Bajo",
      ]),
    });
    if (!ok) {
      setToast({
        type: "error",
        mensaje: "No pudimos generar el PDF. Intente nuevamente.",
      });
    }
  }

  if (cargando) {
    return (
      <div style={{ textAlign: "center", padding: 60, color: "#475569" }}>
        Cargando sus productos…
      </div>
    );
  }

  const tieneCritico = totales.rojos > 0;
  const tieneBajo = totales.amarillos > 0;
  const nombreCliente = cliente.razon_social || cliente.rut_formateado;
  // Si el nombre viene en MAYÚSCULAS (como suele venir de los maestros),
  // lo bajamos a minúsculas para que el `text-transform: capitalize` del CSS
  // produzca un Title Case legible.
  const nombreClienteDisplay =
    nombreCliente === nombreCliente.toUpperCase()
      ? nombreCliente.toLowerCase()
      : nombreCliente;
  const iniciales = getIniciales(nombreCliente);

  // Mensaje de estado contextual según el semáforo agregado.
  const estadoInfo = tieneCritico
    ? {
        tono: "rojo",
        titulo: `${totales.rojos} producto(s) en estado crítico`,
        mensaje:
          "Coordinaremos su reposición a la brevedad. Al guardar, alertaremos a nuestro equipo.",
      }
    : tieneBajo
      ? {
          tono: "amarillo",
          titulo: `${totales.amarillos} producto(s) acercándose al mínimo`,
          mensaje:
            "Conviene reponer en los próximos días. Nuestro equipo recibirá un aviso al guardar.",
        }
      : totales.total > 0
        ? {
            tono: "verde",
            titulo: "Stock al día",
            mensaje: "Todos sus productos están por sobre el mínimo declarado.",
          }
        : null;

  return (
    <div style={styles.declWrap} className="anim-fade-up">
      {/* Hero card del cliente */}
      <div style={styles.heroCard} className="hero-card">
        <div style={styles.heroGlow} aria-hidden />

        <div style={styles.heroTop}>
          <div style={styles.heroLeft}>
            <div style={styles.avatarRing}>
              <div style={styles.avatar}>{iniciales}</div>
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={styles.heroNombre}>{nombreClienteDisplay}</div>
              <div style={styles.heroMeta}>
                <span style={styles.heroRut}>{cliente.rut_formateado}</span>
                {historial[0]?.fecha && (
                  <>
                    <span style={styles.heroDivider} />
                    <span style={styles.heroUltimaInline}>
                      Última declaración: {fmtFechaHora(historial[0].fecha)}
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>

          <div style={styles.kpiRow}>
            <MetricCard label="Productos" valor={totales.total} tono="neutro" />
            <MetricCard label="OK" valor={totales.verdes} tono="verde" />
            <MetricCard label="Bajo" valor={totales.amarillos} tono="amarillo" />
            <MetricCard
              label="Crítico"
              valor={totales.rojos}
              tono="rojo"
              pulse={tieneCritico}
            />
          </div>
        </div>

        {tab === "declaracion" && estadoInfo && (
          <EstadoBanner
            info={estadoInfo}
            criticos={itemsCriticos}
            bajos={itemsBajos}
          />
        )}
      </div>

      {/* Tabs */}
      <TabNavigator
        tab={tab}
        onChange={setTab}
        contadorSolicitudes={solicitudes.length}
      />

      {tab === "solicitudes" ? (
        <PanelMisSolicitudes
          solicitudes={solicitudes}
          cotizacionesHist={cotizacionesHist}
          cargando={cargandoSolicitudes}
          onSolicitarNueva={() => setMostrarSolicitud(true)}
        />
      ) : (
      /* Listado de productos */
      <div style={styles.declCard}>
        <div style={styles.declCardHeader}>
          <div>
            <div style={styles.declTitulo}>Inventario Clínica</div>
            <div style={styles.declSub}>
              Declare su stock actual y los umbrales de stock bajo y crítico. El
              semáforo se calcula automáticamente.
            </div>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <ExportarControl
              onCSV={exportarCSV}
              onImprimir={imprimirReporte}
              disabled={itemsCriticos.length + itemsBajos.length === 0}
            />
            <button
              onClick={() => setMostrarCargaMasiva(true)}
              style={styles.btnSecundarioOutline}
              className="btn-hover"
              title="Cargar varios productos desde un archivo Excel o CSV"
            >
              <Upload size={15} /> Carga masiva
            </button>
            <button onClick={agregarItem} style={styles.btnSecundarioOutline} className="btn-hover">
              <Plus size={15} /> Agregar producto
            </button>
          </div>
        </div>

        {/* Selector de sucursal (catálogo por dirección) */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "0 0 14px", borderBottom: "1px solid #eef2f7", marginBottom: 14 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: "#334155" }}>Sucursal:</span>
          <select
            value={sucursalId ?? ""}
            onChange={(e) => setSucursalId(e.target.value || null)}
            style={{ height: 38, padding: "0 12px", border: "1px solid #cbd5e1", borderRadius: 8, fontSize: 13.5, minWidth: 220, background: "#fff", cursor: "pointer" }}
          >
            {sucursales.map((s) => (
              <option key={s.id} value={s.id}>
                {s.nombre}{s.direccion ? ` — ${s.direccion}` : ""}
              </option>
            ))}
          </select>
          {sucursalActual?.comuna && (
            <span style={{ fontSize: 12, color: "#64748b" }}>{sucursalActual.comuna}</span>
          )}
          <button onClick={() => setMostrarUbicaciones(true)} style={styles.btnSecundarioOutline} className="btn-hover" title="Crear o editar tus ubicaciones (bodega, caja, etc.)">
            <MapPin size={15} /> Gestionar ubicaciones
          </button>
        </div>

        <div style={styles.tablaWrap}>
          <table style={styles.tabla}>
            <thead>
              <tr>
                <th style={{ ...styles.th, minWidth: 78 }} title="Código o SKU del producto (opcional).">SKU</th>
                <th style={{ ...styles.th, minWidth: 150 }}>Producto</th>
                <th style={{ ...styles.th, minWidth: 88 }}>Marca</th>
                <th style={{ ...styles.th, minWidth: 64 }}>Formato</th>
                <th style={{ ...styles.th, minWidth: 110 }} title="Ubicación física del producto (bodega, caja, estante). Gestiona tu lista con «Gestionar ubicaciones».">Ubicación</th>
                <th style={{ ...styles.th, minWidth: 60, textAlign: "right" }}>
                  Stock actual
                </th>
                <th
                  style={{ ...styles.th, minWidth: 60, textAlign: "right" }}
                  title="Si el stock actual queda en o por debajo de este valor, se marca como bajo (amarillo)."
                >
                  Stock bajo
                </th>
                <th
                  style={{ ...styles.th, minWidth: 60, textAlign: "right" }}
                  title="Si el stock actual queda en o por debajo de este valor, se marca como crítico (rojo)."
                >
                  Stock crítico
                </th>
                <th
                  style={{ ...styles.th, minWidth: 76, textAlign: "right" }}
                  title="Precio unitario de referencia para valorizar su inventario."
                >
                  Precio unit.
                </th>
                <th
                  style={{ ...styles.th, minWidth: 72, textAlign: "right" }}
                  title="Stock actual × precio unitario."
                >
                  Total
                </th>
                <th style={{ ...styles.th, minWidth: 76, textAlign: "center" }}>Semáforo</th>
                <th style={{ ...styles.th, width: 34 }} />
              </tr>
            </thead>
            <tbody>
              {items.map((it, idx) => {
                const sem = semaforoColor(it.stock_actual, it.stock_minimo, it.stock_bajo);
                const badge = SEMAFORO_BADGES[sem];
                const Icono = badge.icono;
                const tieneNombre = String(it.nombre || "").trim();
                const borderColor =
                  !tieneNombre
                    ? "transparent"
                    : sem === "rojo"
                      ? "#ef4444"
                      : sem === "amarillo"
                        ? "#f59e0b"
                        : "#22c55e";
                // Tinte sutil del lado izquierdo de la fila según el semáforo
                const tinteFila = !tieneNombre
                  ? "transparent"
                  : sem === "rojo"
                    ? "linear-gradient(90deg, rgba(254,226,226,0.45) 0%, rgba(255,255,255,0) 32%)"
                    : sem === "amarillo"
                      ? "linear-gradient(90deg, rgba(254,243,199,0.45) 0%, rgba(255,255,255,0) 32%)"
                      : "linear-gradient(90deg, rgba(220,252,231,0.32) 0%, rgba(255,255,255,0) 32%)";
                return (
                  <tr
                    key={idx}
                    className="row-hover"
                    style={{
                      ...styles.tr,
                      boxShadow: `inset 4px 0 0 ${borderColor}`,
                      background: tinteFila,
                    }}
                  >
                    <td style={styles.td}>
                      <input
                        type="text"
                        value={it.sku}
                        onChange={(e) => actualizarItem(idx, "sku", e.target.value)}
                        placeholder="Código…"
                        style={styles.cellInput}
                      />
                    </td>
                    <td style={styles.td}>
                      <input
                        type="text"
                        value={it.nombre}
                        onChange={(e) => actualizarItem(idx, "nombre", e.target.value)}
                        placeholder="Ej: Resina compuesta A2"
                        style={styles.cellInput}
                      />
                    </td>
                    <td style={styles.td}>
                      <input
                        type="text"
                        value={it.marca}
                        onChange={(e) => actualizarItem(idx, "marca", e.target.value)}
                        placeholder="Ej: 3M, Kerr…"
                        style={styles.cellInput}
                      />
                    </td>
                    <td style={styles.td}>
                      <input
                        type="text"
                        value={it.unidad}
                        onChange={(e) => actualizarItem(idx, "unidad", e.target.value)}
                        placeholder="Ej: caja, frasco, set…"
                        style={styles.cellInput}
                      />
                    </td>
                    <td style={styles.td}>
                      <select
                        value={it.ubicacion_id ?? ""}
                        onChange={(e) => actualizarItem(idx, "ubicacion_id", e.target.value)}
                        style={{ ...styles.cellInput, cursor: "pointer" }}
                      >
                        <option value="">—</option>
                        {ubicaciones.map((u) => (
                          <option key={u.id} value={u.id}>{u.nombre}</option>
                        ))}
                      </select>
                    </td>
                    <td style={styles.td}>
                      <input
                        type="number"
                        min="0"
                        step="any"
                        value={it.stock_actual}
                        onChange={(e) => actualizarItem(idx, "stock_actual", e.target.value)}
                        placeholder="0"
                        style={{ ...styles.cellInput, textAlign: "right" }}
                      />
                    </td>
                    <td style={styles.td}>
                      <input
                        type="number"
                        min="0"
                        step="any"
                        value={it.stock_bajo}
                        onChange={(e) => actualizarItem(idx, "stock_bajo", e.target.value)}
                        placeholder="0"
                        style={{ ...styles.cellInput, textAlign: "right" }}
                      />
                    </td>
                    <td style={styles.td}>
                      <input
                        type="number"
                        min="0"
                        step="any"
                        value={it.stock_minimo}
                        onChange={(e) => actualizarItem(idx, "stock_minimo", e.target.value)}
                        placeholder="0"
                        style={{ ...styles.cellInput, textAlign: "right" }}
                      />
                    </td>
                    <td style={styles.td}>
                      <input
                        type="text"
                        inputMode="numeric"
                        // Precio en pesos enteros: se muestra con separador de
                        // miles ("19.900") y se guarda solo con dígitos (19900),
                        // evitando que "19.900" se lea como 19,9.
                        value={fmtPrecioInput(it.precio_unitario)}
                        onChange={(e) => actualizarItem(idx, "precio_unitario", e.target.value.replace(/[^\d]/g, ""))}
                        placeholder="0"
                        style={{ ...styles.cellInput, textAlign: "right" }}
                      />
                    </td>
                    <td
                      style={{
                        ...styles.td,
                        textAlign: "right",
                        fontWeight: 700,
                        color: "#0f172a",
                        fontVariantNumeric: "tabular-nums",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {fmtMoneda(
                        (Number(it.stock_actual) || 0) *
                          parsePrecio(it.precio_unitario),
                      )}
                    </td>
                    <td style={{ ...styles.td, textAlign: "center" }}>
                      {tieneNombre ? (
                        <span
                          className={sem === "rojo" ? "badge-pulse" : ""}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 6,
                            padding: "5px 12px",
                            borderRadius: 999,
                            background: badge.bg,
                            color: badge.color,
                            fontSize: 12,
                            fontWeight: 700,
                            border: `1px solid ${badge.color}25`,
                          }}
                        >
                          <Icono size={13} />
                          {badge.label}
                        </span>
                      ) : (
                        <span style={{ color: "#cbd5e1", fontSize: 12 }}>—</span>
                      )}
                    </td>
                    <td style={{ ...styles.td, textAlign: "center" }}>
                      <button
                        type="button"
                        onClick={() => eliminarItem(idx)}
                        style={styles.btnEliminar}
                        title="Eliminar fila"
                        className="btn-eliminar"
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div style={styles.declFooter}>
          <div style={styles.declLeyenda}>
            <span style={{ ...styles.leyendaItem, color: "#15803d" }}>
              <span style={{ ...styles.dot, background: "#22c55e" }} />
              Stock OK
            </span>
            <span style={{ ...styles.leyendaItem, color: "#b45309" }}>
              <span style={{ ...styles.dot, background: "#f59e0b" }} />
              Stock bajo
            </span>
            <span style={{ ...styles.leyendaItem, color: "#b91c1c" }}>
              <span style={{ ...styles.dot, background: "#ef4444" }} />
              Stock crítico
            </span>
            {totales.valor > 0 && (
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  paddingLeft: 14,
                  marginLeft: 4,
                  borderLeft: "1px solid #e2e8f0",
                  fontSize: 12.5,
                  color: "#475569",
                }}
              >
                Valor inventario:{" "}
                <strong style={{ color: "#0f172a" }}>
                  {fmtMoneda(totales.valor)}
                </strong>
              </span>
            )}
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              onClick={() => setMostrarSolicitud(true)}
              style={styles.btnSecundarioOutline}
              className="btn-hover"
            >
              <FileSpreadsheet size={15} />
              Solicitar cotización
            </button>
            {hayCambios && (
              <button
                onClick={revertirCambios}
                disabled={guardando}
                style={styles.btnSecundario}
                className="btn-hover"
                title="Descartar los cambios no guardados"
              >
                <X size={15} />
                Cancelar cambios
              </button>
            )}
            <button
              onClick={guardar}
              disabled={guardando}
              style={styles.btnPrimarioCompacto}
              className="btn-guardar-shine"
            >
              <Save size={15} />
              {guardando ? "Guardando…" : "Guardar stock"}
            </button>
          </div>
        </div>
      </div>
      )}

      {mostrarCargaMasiva && (
        <ModalCargaMasivaStock
          onCerrar={() => setMostrarCargaMasiva(false)}
          onCargar={cargarMasivo}
          setToast={setToast}
        />
      )}

      {mostrarUbicaciones && (
        <ModalUbicaciones
          ubicaciones={ubicaciones}
          apiRequest={apiRequest}
          onCerrar={() => setMostrarUbicaciones(false)}
          onCambio={cargarUbicaciones}
          setToast={setToast}
        />
      )}

      {mostrarSolicitud && (
        <ModalSolicitudCotizacion
          cliente={cliente}
          productos={items}
          sucursalId={sucursalId}
          onCerrar={() => setMostrarSolicitud(false)}
          onEnviado={(resumen) => {
            setMostrarSolicitud(false);
            setToast({
              type: "success",
              titulo: "Solicitud enviada",
              mensaje: `Recibimos su solicitud por ${resumen.items} producto${resumen.items === 1 ? "" : "s"}. Nuestro equipo se contactará a la brevedad.`,
            });
            cargarSolicitudes();
            setTab("solicitudes");
          }}
          setToast={setToast}
        />
      )}
    </div>
  );
}

function TabNavigator({ tab, onChange, contadorSolicitudes }) {
  const opciones = [
    { id: "declaracion", label: "Gestión de Stock", icono: Database },
    { id: "solicitudes", label: "Mis cotizaciones", icono: FileSpreadsheet },
  ];
  return (
    <div style={tabStyles.contenedor}>
      {opciones.map((o) => {
        const activa = tab === o.id;
        const Icono = o.icono;
        const mostrarBadge = o.id === "solicitudes" && contadorSolicitudes > 0;
        return (
          <button
            key={o.id}
            type="button"
            onClick={() => onChange(o.id)}
            style={{
              ...tabStyles.boton,
              ...(activa ? tabStyles.botonActivo : {}),
            }}
          >
            <Icono size={15} />
            <span>{o.label}</span>
            {mostrarBadge && (
              <span
                style={{
                  ...tabStyles.badge,
                  background: activa ? "#fff" : TEAL,
                  color: activa ? TEAL : "#fff",
                }}
              >
                {contadorSolicitudes}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

const tabStyles = {
  contenedor: {
    display: "inline-flex",
    background: "#fff",
    padding: 4,
    borderRadius: 14,
    border: "1px solid #e2e8f0",
    boxShadow: "0 2px 8px rgba(15,23,42,0.04)",
    gap: 2,
    alignSelf: "flex-start",
  },
  boton: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    padding: "9px 16px",
    background: "transparent",
    color: "#64748b",
    border: "none",
    borderRadius: 10,
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
    transition: "background .15s ease, color .15s ease",
  },
  botonActivo: {
    background: `linear-gradient(135deg, ${TEAL}, ${TEAL_LIGHT})`,
    color: "#fff",
    boxShadow: "0 6px 14px rgba(15,118,110,0.22)",
  },
  badge: {
    fontSize: 11,
    fontWeight: 800,
    padding: "1px 7px",
    borderRadius: 999,
    minWidth: 18,
    textAlign: "center",
    lineHeight: 1.5,
  },
};

// Historial de cotizaciones del sistema principal a nombre del cliente (por RUT).
// Cada fila se expande para ver los productos y descargar el PDF.
function HistorialCotizacionesCliente({ cotizaciones }) {
  const [expandidaId, setExpandidaId] = useState(null);
  const [detalles, setDetalles] = useState({}); // { [id]: { datos } }
  const [cargandoId, setCargandoId] = useState(null);
  const [pdfId, setPdfId] = useState(null);
  const [errorId, setErrorId] = useState(null);

  const fmtF = (iso) => {
    if (!iso) return "—";
    const s = String(iso).slice(0, 10);
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? `${m[3]}-${m[2]}-${m[1]}` : s;
  };
  const colorEstado = (e) => {
    const t = (e || "").toLowerCase();
    if (t.includes("adjud")) return { bg: "#dcfce7", fg: "#15803d" };
    if (t.includes("perd") || t.includes("descart")) return { bg: "#fee2e2", fg: "#b91c1c" };
    if (t.includes("espera") || t.includes("pendiente")) return { bg: "#fef9c3", fg: "#a16207" };
    return { bg: "#e2e8f0", fg: "#334155" };
  };

  async function cargarDetalle(id) {
    if (detalles[id]) return detalles[id];
    setCargandoId(id);
    setErrorId(null);
    try {
      const r = await apiRequest(`/stock-clientes/mis-cotizaciones/${id}`);
      setDetalles((prev) => ({ ...prev, [id]: r }));
      return r;
    } catch {
      setErrorId(id);
      return null;
    } finally {
      setCargandoId(null);
    }
  }

  function toggle(id) {
    const abrir = expandidaId !== id;
    setExpandidaId(abrir ? id : null);
    if (abrir) cargarDetalle(id);
  }

  async function descargarPDF(id) {
    setPdfId(id);
    try {
      const det = detalles[id] || (await cargarDetalle(id));
      if (det?.datos) await generarPDFcotizacion(det.datos);
    } catch {
      setErrorId(id);
    } finally {
      setPdfId(null);
    }
  }

  return (
    <div style={histStyles.card}>
      <div style={histStyles.header}>
        <div>
          <div style={histStyles.titulo}>Cotizaciones de Amsodent</div>
          <div style={histStyles.sub}>
            Todas las cotizaciones que nuestro equipo ha registrado a nombre de su institución.
            Haga clic en una para ver sus productos y descargar el PDF.
          </div>
        </div>
        <span style={histStyles.pill}>{cotizaciones.length}</span>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={histStyles.table}>
          <thead>
            <tr>
              <th style={{ ...histStyles.th, width: 28 }} />
              <th style={histStyles.th}>N° cotización</th>
              <th style={histStyles.th}>Descripción</th>
              <th style={{ ...histStyles.th, whiteSpace: "nowrap" }}>Fecha</th>
              <th style={histStyles.th}>Estado</th>
              <th style={{ ...histStyles.th, textAlign: "right", whiteSpace: "nowrap" }}>Monto con IVA</th>
            </tr>
          </thead>
          <tbody>
            {cotizaciones.map((c) => {
              const col = colorEstado(c.estado);
              const abierta = expandidaId === c.id;
              const det = detalles[c.id];
              const items = det?.datos?.items || [];
              return (
                <Fragment key={c.id}>
                  <tr
                    onClick={() => toggle(c.id)}
                    style={{ cursor: "pointer", background: abierta ? "rgba(40,174,177,.06)" : undefined }}
                  >
                    <td style={{ ...histStyles.td, color: "#0f766e", textAlign: "center" }}>{abierta ? "▾" : "▸"}</td>
                    <td style={{ ...histStyles.td, fontWeight: 700, whiteSpace: "nowrap", fontFamily: "ui-monospace, monospace" }}>{c.id_licitacion || `#${c.id}`}</td>
                    <td style={histStyles.td}>{c.nombre || c.nombre_entidad || "—"}</td>
                    <td style={{ ...histStyles.td, whiteSpace: "nowrap" }}>{fmtF(c.fecha)}</td>
                    <td style={histStyles.td}>
                      <span style={{ display: "inline-block", padding: "2px 9px", borderRadius: 999, fontSize: 11, fontWeight: 700, background: col.bg, color: col.fg }}>
                        {c.estado || "—"}
                      </span>
                    </td>
                    <td style={{ ...histStyles.td, textAlign: "right", fontWeight: 700, whiteSpace: "nowrap" }}>{fmtMoneda(c.total_con_iva)}</td>
                  </tr>
                  {abierta && (
                    <tr>
                      <td colSpan={6} style={{ padding: "0 12px 14px", background: "rgba(40,174,177,.04)" }}>
                        {cargandoId === c.id && !det ? (
                          <div style={{ padding: 14, fontSize: 12.5, color: "#64748b" }}>Cargando detalle…</div>
                        ) : errorId === c.id && !det ? (
                          <div style={{ padding: 14, fontSize: 12.5, color: "#b91c1c" }}>No se pudo cargar el detalle.</div>
                        ) : (
                          <div style={{ paddingTop: 12 }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 8 }}>
                              <div style={{ fontSize: 12, fontWeight: 700, color: "#0f172a" }}>
                                Productos ({items.length})
                              </div>
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); descargarPDF(c.id); }}
                                disabled={pdfId === c.id}
                                style={histStyles.btnPdf}
                                className="btn-hover"
                              >
                                {pdfId === c.id ? "Generando…" : "⬇ Descargar PDF"}
                              </button>
                            </div>
                            {items.length === 0 ? (
                              <div style={{ fontSize: 12.5, color: "#64748b", padding: "6px 0" }}>Sin productos registrados.</div>
                            ) : (
                              <div style={{ overflowX: "auto" }}>
                                <table style={histStyles.table}>
                                  <thead>
                                    <tr>
                                      <th style={histStyles.th}>SKU</th>
                                      <th style={histStyles.th}>Producto</th>
                                      <th style={histStyles.th}>Formato</th>
                                      <th style={{ ...histStyles.th, textAlign: "right" }}>Cant.</th>
                                      <th style={{ ...histStyles.th, textAlign: "right" }}>P. Unit.</th>
                                      <th style={{ ...histStyles.th, textAlign: "right" }}>Total</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {items.map((it, i) => (
                                      <tr key={i}>
                                        <td style={{ ...histStyles.td, whiteSpace: "nowrap", fontFamily: "ui-monospace, monospace", fontSize: 12 }}>{it.sku || "—"}</td>
                                        <td style={histStyles.td}>{it.producto || "—"}</td>
                                        <td style={histStyles.td}>{it.formato || "—"}</td>
                                        <td style={{ ...histStyles.td, textAlign: "right", whiteSpace: "nowrap" }}>{it.cantidad}</td>
                                        <td style={{ ...histStyles.td, textAlign: "right", whiteSpace: "nowrap" }}>${it.precio_unitario}</td>
                                        <td style={{ ...histStyles.td, textAlign: "right", whiteSpace: "nowrap", fontWeight: 600 }}>${it.total}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const histStyles = {
  card: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 16, boxShadow: "0 10px 30px rgba(15,23,42,.06)", padding: "16px 18px", marginBottom: 6 },
  header: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 12 },
  titulo: { fontSize: 14, fontWeight: 700, color: "#0f172a" },
  sub: { fontSize: 12, color: "#64748b", marginTop: 2, maxWidth: 560 },
  pill: { flex: "none", padding: "3px 10px", fontSize: 11, fontWeight: 700, background: "rgba(40,174,177,.12)", color: "#0f5f61", borderRadius: 999, border: "1px solid rgba(40,174,177,.25)" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 620 },
  th: { textAlign: "left", fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".05em", color: "#64748b", padding: "8px 12px", borderBottom: "1px solid #e2e8f0", whiteSpace: "nowrap" },
  td: { padding: "10px 12px", borderBottom: "1px solid #f1f5f9", color: "#334155", verticalAlign: "top" },
  btnPdf: { display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 13px", borderRadius: 9, fontSize: 12.5, fontWeight: 700, cursor: "pointer", border: "1px solid rgba(40,174,177,.35)", background: "#fff", color: "#0f5f61" },
};

function PanelMisSolicitudes({ solicitudes, cotizacionesHist = [], cargando, onSolicitarNueva }) {
  const [expandidaId, setExpandidaId] = useState(null);

  if (cargando) {
    return (
      <div style={{ textAlign: "center", padding: 40, color: "#64748b", fontSize: 13 }}>
        Cargando sus cotizaciones…
      </div>
    );
  }

  const haySol = solicitudes && solicitudes.length > 0;
  const hayHist = cotizacionesHist && cotizacionesHist.length > 0;

  if (!haySol && !hayHist) {
    return (
      <div style={solStyles.vacioCard}>
        <div style={solStyles.vacioIcono}>
          <FileSpreadsheet size={28} />
        </div>
        <div style={solStyles.vacioTitulo}>Aún no hay cotizaciones</div>
        <div style={solStyles.vacioMensaje}>
          Cuando solicite una cotización desde la sección "Gestión de Stock" —o
          nuestro equipo genere una a su nombre— aparecerá aquí con su estado de
          seguimiento.
        </div>
        <button
          type="button"
          onClick={onSolicitarNueva}
          style={solStyles.btnPrimario}
          className="btn-hover"
        >
          <FileSpreadsheet size={14} /> Solicitar mi primera cotización
        </button>
      </div>
    );
  }

  return (
    <div style={solStyles.lista}>
      {hayHist && <HistorialCotizacionesCliente cotizaciones={cotizacionesHist} />}

      {haySol && (
        <div style={{ fontSize: 12, fontWeight: 700, color: "#0f766e", textTransform: "uppercase", letterSpacing: ".06em", margin: "6px 2px 0" }}>
          Solicitudes de cotización de stock
        </div>
      )}

      {(solicitudes || []).map((s) => {
        const expandida = expandidaId === s.id;
        const items = Array.isArray(s.items) ? s.items : [];
        const estado = ESTADOS_SOLICITUD[s.estado] || ESTADOS_SOLICITUD.pendiente;
        return (
          <div key={s.id} style={solStyles.card}>
            <button
              type="button"
              onClick={() => setExpandidaId(expandida ? null : s.id)}
              style={solStyles.cardHeader}
            >
              <div style={solStyles.cardHeaderIzq}>
                <span
                  style={{
                    ...solStyles.estadoBadge,
                    background: estado.bg,
                    color: estado.color,
                    border: `1px solid ${estado.borde}`,
                  }}
                >
                  {estado.label}
                </span>
                <div style={{ minWidth: 0 }}>
                  <div style={solStyles.cardTitulo}>
                    Solicitud #{s.id}
                    <span style={solStyles.cardSeparador}>·</span>
                    <span style={solStyles.cardFecha}>
                      {fmtFechaHora(s.created_at)}
                    </span>
                  </div>
                  <div style={solStyles.cardSub}>
                    {items.length} producto{items.length === 1 ? "" : "s"} solicitado
                    {items.length === 1 ? "" : "s"}
                  </div>
                </div>
              </div>
              <ChevronIcon abierto={expandida} />
            </button>

            {expandida && (
              <div style={solStyles.cardBody}>
                {items.length > 0 && (
                  <div style={solStyles.tablaWrap}>
                    <table style={solStyles.tabla}>
                      <thead>
                        <tr>
                          <th style={solStyles.th}>Producto</th>
                          <th style={{ ...solStyles.th, textAlign: "right" }}>
                            Cantidad
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {items.map((it, idx) => {
                          const unidad = it.unidad ? ` ${it.unidad}` : "";
                          return (
                            <tr key={idx}>
                              <td style={solStyles.td}>{it.nombre}</td>
                              <td
                                style={{
                                  ...solStyles.td,
                                  textAlign: "right",
                                  fontWeight: 700,
                                  fontVariantNumeric: "tabular-nums",
                                }}
                              >
                                {it.cantidad}
                                {unidad}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

                {s.nota && (
                  <div style={solStyles.notaBloque}>
                    <div style={solStyles.notaLabel}>Su comentario</div>
                    <div style={solStyles.notaTexto}>{s.nota}</div>
                  </div>
                )}

                {(s.contacto_email || s.contacto_telefono) && (
                  <div style={solStyles.contacto}>
                    {s.contacto_email && (
                      <span>
                        <strong>Correo:</strong> {s.contacto_email}
                      </span>
                    )}
                    {s.contacto_telefono && (
                      <span>
                        <strong>Tel:</strong> {s.contacto_telefono}
                      </span>
                    )}
                  </div>
                )}

                {s.estado === "respondida" && s.respondida_at && !s.cotizacion && (
                  <div style={solStyles.respondidaInfo}>
                    Respondida el {fmtFechaHora(s.respondida_at)}
                  </div>
                )}

                {s.cotizacion && <CotizacionGenerada solicitud={s} />}

                <HiloMensajesCliente solicitudId={s.id} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* Bloque "cotización generada" + descarga de PDF en el portal del cliente. */
function CotizacionGenerada({ solicitud }) {
  const [descargando, setDescargando] = useState(false);
  const [error, setError] = useState("");
  const cot = solicitud.cotizacion || {};

  const ESTADO_LABEL = {
    "En espera": "En preparación",
    "Pendiente Aprobación": "En revisión interna",
    Adjudicada: "Aceptada / Adjudicada",
    Perdida: "No concretada",
    Desierta: "No concretada",
    Descartada: "Descartada",
    Cancelada: "Cancelada",
  };
  const estadoTxt = ESTADO_LABEL[cot.estado] || cot.estado || "En proceso";

  async function descargar() {
    setDescargando(true);
    setError("");
    try {
      const r = await apiRequest(`/stock-clientes/mis-solicitudes/${solicitud.id}/cotizacion`);
      if (!r?.datos) throw new Error("La cotización aún no está disponible.");
      await generarPDFcotizacion(r.datos);
    } catch (e) {
      setError(e?.message || "No se pudo descargar la cotización.");
    } finally {
      setDescargando(false);
    }
  }

  return (
    <div style={{ marginTop: 12, padding: "12px 14px", background: "#ecfdf5", border: "1px solid #a7f3d0", borderRadius: 12 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: "#065f46" }}>
            ✅ Se generó una cotización basada en su solicitud
          </div>
          <div style={{ fontSize: 12, color: "#047857", marginTop: 2 }}>
            N° {cot.id_licitacion || `#${cot.id}`} · Estado: <strong>{estadoTxt}</strong>
          </div>
        </div>
        <button
          type="button"
          onClick={descargar}
          disabled={descargando}
          style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 14px", background: "#047857", color: "#fff", border: "none", borderRadius: 999, fontSize: 12.5, fontWeight: 600, cursor: descargando ? "wait" : "pointer" }}
        >
          <FileDown size={14} /> {descargando ? "Generando…" : "Descargar PDF"}
        </button>
      </div>
      {error && <div style={{ fontSize: 11.5, color: "#b91c1c", marginTop: 6 }}>{error}</div>}
    </div>
  );
}

/* Hilo de mensajes (lado cliente) ligado a su solicitud/cotización. */
function HiloMensajesCliente({ solicitudId }) {
  const [mensajes, setMensajes] = useState([]);
  const [texto, setTexto] = useState("");
  const [cargando, setCargando] = useState(true);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState("");

  async function cargar() {
    setCargando(true);
    try {
      const data = await apiRequest(`/stock-clientes/mis-solicitudes/${solicitudId}/mensajes`);
      setMensajes(Array.isArray(data) ? data : []);
    } catch { /* */ } finally { setCargando(false); }
  }
  useEffect(() => { cargar(); /* eslint-disable-next-line */ }, [solicitudId]);

  async function enviar(e) {
    e?.preventDefault?.();
    const t = texto.trim();
    if (!t || enviando) return;
    setEnviando(true);
    setError("");
    try {
      await apiRequest(`/stock-clientes/mis-solicitudes/${solicitudId}/mensajes`, {
        method: "POST",
        body: JSON.stringify({ mensaje: t }),
      });
      setTexto("");
      await cargar();
    } catch (err) {
      setError(err?.message || "No se pudo enviar el mensaje.");
    } finally { setEnviando(false); }
  }

  return (
    <div style={{ marginTop: 12, border: "1px solid #e2e8f0", borderRadius: 12, padding: 12 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 8, display: "flex", alignItems: "center", gap: 5 }}>
        <MessageCircle size={12} /> Comunicación con Amsodent
      </div>
      <div style={{ maxHeight: 220, overflowY: "auto", display: "flex", flexDirection: "column", gap: 6, marginBottom: 8 }}>
        {cargando ? (
          <div style={{ fontSize: 12, color: "#94a3b8" }}>Cargando…</div>
        ) : mensajes.length === 0 ? (
          <div style={{ fontSize: 12, color: "#94a3b8" }}>¿Necesita una modificación o tiene dudas? Escríbanos aquí.</div>
        ) : mensajes.map((m) => {
          const mio = m.autor_tipo === "cliente";
          return (
            <div key={m.id} style={{ alignSelf: mio ? "flex-end" : "flex-start", maxWidth: "85%", background: mio ? "#dbeafe" : "#f1f5f9", borderRadius: 10, padding: "6px 10px" }}>
              <div style={{ fontSize: 13, color: "#0f172a", whiteSpace: "pre-wrap" }}>{m.mensaje}</div>
              <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 2 }}>{mio ? "Usted" : (m.autor_nombre || "Amsodent")} · {fmtFechaHora(m.created_at)}</div>
            </div>
          );
        })}
      </div>
      <form onSubmit={enviar} style={{ display: "flex", gap: 6 }}>
        <input
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="Escriba un mensaje o solicite una modificación…"
          style={{ flex: 1, height: 36, padding: "0 10px", border: "1px solid #cbd5e1", borderRadius: 8, fontSize: 13, outline: "none" }}
        />
        <button type="submit" disabled={enviando || !texto.trim()} style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "0 14px", background: "#0ea5a4", color: "#fff", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
          <Send size={13} /> Enviar
        </button>
      </form>
      {error && <div style={{ fontSize: 11.5, color: "#b91c1c", marginTop: 6 }}>{error}</div>}
    </div>
  );
}

const ESTADOS_SOLICITUD = {
  pendiente: {
    label: "Pendiente",
    color: "#b45309",
    bg: "#fef3c7",
    borde: "rgba(245,158,11,0.30)",
  },
  respondida: {
    label: "Respondida",
    color: "#15803d",
    bg: "#dcfce7",
    borde: "rgba(34,197,94,0.30)",
  },
  cancelada: {
    label: "Cancelada",
    color: "#64748b",
    bg: "#f1f5f9",
    borde: "rgba(100,116,139,0.30)",
  },
};

function ChevronIcon({ abierto }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#94a3b8"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{
        transform: abierto ? "rotate(180deg)" : "none",
        transition: "transform .2s ease",
        flexShrink: 0,
      }}
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

const solStyles = {
  lista: { display: "flex", flexDirection: "column", gap: 12 },
  card: {
    background: "#fff",
    border: "1px solid #e2e8f0",
    borderRadius: 14,
    overflow: "hidden",
    boxShadow: "0 2px 8px rgba(15,23,42,0.04)",
  },
  cardHeader: {
    width: "100%",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "14px 18px",
    background: "transparent",
    border: "none",
    cursor: "pointer",
    gap: 14,
    textAlign: "left",
  },
  cardHeaderIzq: {
    display: "flex",
    alignItems: "center",
    gap: 14,
    minWidth: 0,
    flex: 1,
  },
  estadoBadge: {
    display: "inline-block",
    padding: "4px 12px",
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    flexShrink: 0,
  },
  cardTitulo: {
    fontSize: 14,
    fontWeight: 700,
    color: "#0f172a",
    display: "flex",
    alignItems: "center",
    gap: 6,
    flexWrap: "wrap",
  },
  cardSeparador: { color: "#cbd5e1", fontWeight: 400 },
  cardFecha: { fontSize: 12.5, fontWeight: 500, color: "#64748b" },
  cardSub: { fontSize: 12, color: "#94a3b8", marginTop: 2 },

  cardBody: {
    padding: "0 18px 18px",
    display: "flex",
    flexDirection: "column",
    gap: 12,
  },
  tablaWrap: {
    border: "1px solid #f1f5f9",
    borderRadius: 10,
    overflow: "hidden",
  },
  tabla: { width: "100%", borderCollapse: "collapse" },
  th: {
    textAlign: "left",
    padding: "9px 12px",
    fontSize: 10.5,
    fontWeight: 700,
    color: "#64748b",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    background: "#f8fafc",
    borderBottom: "1px solid #f1f5f9",
  },
  td: {
    padding: "9px 12px",
    borderBottom: "1px solid #f8fafc",
    fontSize: 13,
    color: "#0f172a",
  },
  notaBloque: {
    padding: 12,
    background: "#f8fafc",
    borderRadius: 10,
    border: "1px solid #f1f5f9",
  },
  notaLabel: {
    fontSize: 10.5,
    fontWeight: 700,
    color: "#64748b",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  notaTexto: {
    fontSize: 13,
    color: "#334155",
    lineHeight: 1.5,
    whiteSpace: "pre-wrap",
  },
  contacto: {
    display: "flex",
    gap: 16,
    flexWrap: "wrap",
    fontSize: 12.5,
    color: "#475569",
  },
  respondidaInfo: {
    fontSize: 12,
    color: "#15803d",
    fontWeight: 600,
    background: "#dcfce7",
    padding: "8px 12px",
    borderRadius: 8,
    border: "1px solid rgba(34,197,94,0.20)",
  },
  vacioCard: {
    background: "#fff",
    border: "1px dashed #cbd5e1",
    borderRadius: 14,
    padding: "40px 24px",
    textAlign: "center",
  },
  vacioIcono: {
    width: 60,
    height: 60,
    borderRadius: "50%",
    background: "#f0fdfa",
    color: TEAL,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
  },
  vacioTitulo: {
    fontSize: 16,
    fontWeight: 700,
    color: "#0f172a",
    marginBottom: 6,
  },
  vacioMensaje: {
    fontSize: 13,
    color: "#64748b",
    maxWidth: 380,
    margin: "0 auto 18px",
    lineHeight: 1.5,
  },
  btnPrimario: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    background: `linear-gradient(135deg, ${TEAL}, ${TEAL_LIGHT})`,
    color: "#fff",
    border: "none",
    padding: "10px 20px",
    borderRadius: 999,
    fontSize: 13.5,
    fontWeight: 600,
    cursor: "pointer",
    boxShadow: "0 8px 18px rgba(15,118,110,0.22)",
  },
};

// Modal para que el cliente arme una solicitud de cotización a partir de
// sus productos declarados. Cada producto trae una cantidad sugerida igual
// a (stock_minimo - stock_actual) si está negativo, o cero. El cliente
// ajusta, agrega contacto opcional y un comentario, y envía. El backend
// envía correo + campana a los destinatarios configurados.
// Buscador sobre el catálogo PERSONAL del cliente (sus productos declarados).
// Filtra en memoria por nombre, marca o SKU. Permite agregar a la cotización
// cualquiera de sus productos, no solo los que están bajos o críticos.
function BuscadorMiCatalogo({ productos, onAgregar }) {
  const [q, setQ] = useState("");
  const [abierto, setAbierto] = useState(false);

  const disponibles = useMemo(
    () => (productos || []).filter((p) => String(p.nombre || "").trim().length > 0),
    [productos],
  );

  const resultados = useMemo(() => {
    const term = q.trim().toLowerCase();
    const base = term.length < 1
      ? disponibles
      : disponibles.filter((p) =>
          [p.nombre, p.marca, p.sku]
            .filter(Boolean)
            .some((v) => String(v).toLowerCase().includes(term)),
        );
    return base.slice(0, 30);
  }, [q, disponibles]);

  if (disponibles.length === 0) return null;

  return (
    <div style={{ position: "relative" }}>
      <label style={{ ...modalStyles.label, marginBottom: 4 }}>
        Agregar de mi catálogo
      </label>
      <div style={{ position: "relative" }}>
        <Search
          size={15}
          style={{
            position: "absolute",
            left: 12,
            top: "50%",
            transform: "translateY(-50%)",
            color: "#94a3b8",
            pointerEvents: "none",
          }}
        />
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => setAbierto(true)}
          onBlur={() => setTimeout(() => setAbierto(false), 150)}
          placeholder="Buscar entre mis productos declarados…"
          style={{ ...modalStyles.input, paddingLeft: 36 }}
          autoComplete="off"
        />
      </div>
      {abierto && resultados.length > 0 && (
        <div style={modalStyles.catalogoDropdown}>
          {resultados.map((p, idx) => (
            <button
              type="button"
              key={`${p.nombre}-${idx}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onAgregar(p);
                setQ("");
                setAbierto(false);
              }}
              style={modalStyles.catalogoItem}
            >
              <span style={{ fontWeight: 600, color: "#0f172a", fontSize: 13 }}>
                {p.nombre}
              </span>
              <span style={{ fontSize: 11, color: "#94a3b8", marginTop: 1 }}>
                {[p.marca, p.sku, p.unidad].filter(Boolean).join(" · ") || "Mi catálogo"}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Buscador con autocompletado sobre el catálogo Amsodent. Debounce de 300ms.
function BuscadorCatalogo({ onAgregar }) {
  const [q, setQ] = useState("");
  const [resultados, setResultados] = useState([]);
  const [cargando, setCargando] = useState(false);
  const [abierto, setAbierto] = useState(false);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setResultados([]);
      setCargando(false);
      return;
    }
    setCargando(true);
    const t = setTimeout(async () => {
      try {
        const data = await apiRequest(
          `/stock-clientes/catalogo?q=${encodeURIComponent(term)}`,
        );
        setResultados(Array.isArray(data) ? data : []);
        setAbierto(true);
      } catch {
        setResultados([]);
      } finally {
        setCargando(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  return (
    <div style={{ position: "relative" }}>
      <label style={{ ...modalStyles.label, marginBottom: 4 }}>
        Buscar en catálogo Amsodent{" "}
        <span style={modalStyles.opt}>(opcional)</span>
      </label>
      <div style={{ position: "relative" }}>
        <Search
          size={15}
          style={{
            position: "absolute",
            left: 12,
            top: "50%",
            transform: "translateY(-50%)",
            color: "#94a3b8",
            pointerEvents: "none",
          }}
        />
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => resultados.length > 0 && setAbierto(true)}
          onBlur={() => setTimeout(() => setAbierto(false), 150)}
          placeholder="Buscar por nombre, SKU o marca…"
          style={{ ...modalStyles.input, paddingLeft: 36 }}
          autoComplete="off"
        />
      </div>
      {abierto && (cargando || resultados.length > 0) && (
        <div style={modalStyles.catalogoDropdown}>
          {cargando ? (
            <div style={modalStyles.catalogoVacio}>Buscando…</div>
          ) : (
            resultados.map((p, idx) => (
              <button
                type="button"
                key={`${p.sku || ""}-${idx}`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onAgregar(p);
                  setQ("");
                  setResultados([]);
                  setAbierto(false);
                }}
                style={modalStyles.catalogoItem}
              >
                <span style={{ fontWeight: 600, color: "#0f172a", fontSize: 13 }}>
                  {p.nombre}
                </span>
                <span style={{ fontSize: 11, color: "#94a3b8", marginTop: 1 }}>
                  {[p.marca, p.sku].filter(Boolean).join(" · ") || "Catálogo"}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

/* Gestión de ubicaciones del cliente (bodega, caja, estante, etc.). */
function ModalUbicaciones({ ubicaciones, apiRequest, onCerrar, onCambio, setToast }) {
  const [lista, setLista] = useState(ubicaciones || []);
  const [form, setForm] = useState({ nombre: "" });
  const [editId, setEditId] = useState(null);
  const [guardando, setGuardando] = useState(false);

  const inputStyle = { width: "100%", height: 38, padding: "0 10px", border: "1px solid #cbd5e1", borderRadius: 8, fontSize: 13.5, outline: "none", boxSizing: "border-box" };

  async function recargar() {
    await onCambio?.();
    try {
      const l = await apiRequest("/stock-clientes/mis-ubicaciones");
      if (Array.isArray(l)) setLista(l);
    } catch { /* */ }
  }

  async function guardar(e) {
    e?.preventDefault?.();
    const nombre = form.nombre.trim();
    if (!nombre) { setToast({ type: "warning", mensaje: "Ingrese el nombre de la ubicación." }); return; }
    setGuardando(true);
    try {
      if (editId) {
        await apiRequest(`/stock-clientes/ubicaciones/${editId}`, { method: "PUT", body: JSON.stringify({ nombre }) });
      } else {
        await apiRequest(`/stock-clientes/ubicaciones`, { method: "POST", body: JSON.stringify({ nombre }) });
      }
      setForm({ nombre: "" });
      setEditId(null);
      await recargar();
      setToast({ type: "success", mensaje: editId ? "Ubicación actualizada." : "Ubicación creada." });
    } catch (err) {
      setToast({ type: "error", mensaje: err?.message || "No se pudo guardar la ubicación." });
    } finally {
      setGuardando(false);
    }
  }

  function editar(u) {
    setEditId(u.id);
    setForm({ nombre: u.nombre || "" });
  }

  async function eliminar(u) {
    try {
      await apiRequest(`/stock-clientes/ubicaciones/${u.id}`, { method: "DELETE" });
      if (editId === u.id) { setEditId(null); setForm({ nombre: "" }); }
      await recargar();
    } catch (err) {
      setToast({ type: "error", mensaje: err?.message || "No se pudo eliminar la ubicación." });
    }
  }

  return createPortal(
    <div onClick={(e) => { if (e.target === e.currentTarget) onCerrar(); }} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.55)", zIndex: 11000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div style={{ width: 460, maxWidth: "100%", maxHeight: "90vh", overflow: "auto", background: "#fff", borderRadius: 14, boxShadow: "0 20px 50px rgba(0,0,0,.3)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 20px", borderBottom: "1px solid #e2e8f0" }}>
          <strong style={{ fontSize: 16 }}>Ubicaciones</strong>
          <button type="button" onClick={onCerrar} style={{ background: "none", border: "none", cursor: "pointer", color: "#64748b" }}><X size={18} /></button>
        </div>
        <div style={{ padding: 20 }}>
          <p style={{ fontSize: 12.5, color: "#64748b", marginTop: 0 }}>
            Define tus ubicaciones (bodega, caja, estante…) y luego asígnalas a cada producto en la tabla de stock.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 18 }}>
            {lista.length === 0 ? (
              <div style={{ fontSize: 13, color: "#94a3b8" }}>Aún no hay ubicaciones.</div>
            ) : lista.map((u) => (
              <div key={u.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "8px 12px", border: "1px solid #e2e8f0", borderRadius: 10 }}>
                <div style={{ fontSize: 13.5, fontWeight: 600, color: "#0f172a", minWidth: 0 }}>{u.nombre}</div>
                <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                  <button type="button" onClick={() => editar(u)} style={{ border: "1px solid #cbd5e1", background: "#fff", borderRadius: 8, padding: "4px 10px", fontSize: 12, cursor: "pointer" }}>Editar</button>
                  <button type="button" onClick={() => eliminar(u)} style={{ border: "1px solid #fecaca", background: "#fff", color: "#dc2626", borderRadius: 8, padding: "4px 10px", fontSize: 12, cursor: "pointer" }}><Trash2 size={13} /></button>
                </div>
              </div>
            ))}
          </div>

          <form onSubmit={guardar} style={{ borderTop: "1px solid #eef2f7", paddingTop: 16, display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#334155" }}>{editId ? "Editar ubicación" : "Nueva ubicación"}</div>
            <input value={form.nombre} onChange={(e) => setForm({ nombre: e.target.value })} placeholder="Nombre (ej: Bodega central, Caja 3, Estante A)" style={inputStyle} />
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              {editId && (
                <button type="button" onClick={() => { setEditId(null); setForm({ nombre: "" }); }} style={{ border: "1px solid #cbd5e1", background: "#fff", borderRadius: 8, padding: "8px 14px", fontSize: 13, cursor: "pointer" }}>Cancelar</button>
              )}
              <button type="submit" disabled={guardando} style={{ border: "none", background: "#0ea5a4", color: "#fff", borderRadius: 8, padding: "8px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                {guardando ? "Guardando…" : editId ? "Guardar cambios" : "Agregar ubicación"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function ModalSolicitudCotizacion({
  cliente,
  productos,
  sucursalId,
  onCerrar,
  onEnviado,
  setToast,
}) {
  const productosBase = useMemo(() => {
    return (productos || [])
      .filter((p) => String(p.nombre || "").trim().length > 0)
      .map((p) => {
        const minimo = Number(p.stock_minimo) || 0;
        const actual = Number(p.stock_actual) || 0;
        const sem = semaforoColor(actual, minimo, p.stock_bajo);
        const referencia = Number(p.stock_bajo) > 0 ? Number(p.stock_bajo) : minimo * 1.5;
        const sugerida = Math.max(0, Math.ceil(referencia - actual));
        return {
          nombre: String(p.nombre).trim(),
          marca: p.marca || "",
          unidad: p.unidad || "",
          stock_actual: actual,
          stock_minimo: minimo,
          sem,
          origen: "declarado",
          incluir: true,
          cantidad: sugerida > 0 ? sugerida : 1,
        };
      })
      // Solo mostramos los productos en estado bajo o crítico; el resto se puede
      // agregar manualmente desde el buscador del catálogo.
      .filter((p) => p.sem === "rojo" || p.sem === "amarillo");
  }, [productos]);

  const [filas, setFilas] = useState(productosBase);
  const [nota, setNota] = useState("");
  const [contactoNombre, setContactoNombre] = useState("");
  const [contactoEmail, setContactoEmail] = useState(cliente?.email || "");
  const [contactoTel, setContactoTel] = useState("");
  const [enviando, setEnviando] = useState(false);

  function toggleIncluir(idx) {
    setFilas((prev) =>
      prev.map((f, i) => (i === idx ? { ...f, incluir: !f.incluir } : f)),
    );
  }
  function cambiarCantidad(idx, valor) {
    setFilas((prev) =>
      prev.map((f, i) => (i === idx ? { ...f, cantidad: valor } : f)),
    );
  }
  function cambiarNombre(idx, valor) {
    setFilas((prev) =>
      prev.map((f, i) => (i === idx ? { ...f, nombre: valor } : f)),
    );
  }
  function quitarFila(idx) {
    setFilas((prev) => prev.filter((_, i) => i !== idx));
  }
  function agregarManual() {
    setFilas((prev) => [
      ...prev,
      {
        nombre: "",
        marca: "",
        unidad: "",
        stock_actual: null,
        stock_minimo: null,
        origen: "manual",
        editable: true,
        incluir: true,
        cantidad: 1,
      },
    ]);
  }
  // Agrega un producto desde el catálogo PERSONAL del cliente (sus productos
  // declarados, incluso los que están en verde y no se preseleccionan).
  function agregarMiCatalogo(prod) {
    setFilas((prev) => {
      const existe = prev.some(
        (f) =>
          f.nombre.trim().toLowerCase() ===
          String(prod.nombre || "").trim().toLowerCase(),
      );
      if (existe) {
        setToast({ type: "warning", mensaje: "Ese producto ya está en la lista." });
        return prev;
      }
      const actual = Number(prod.stock_actual) || 0;
      const minimo = Number(prod.stock_minimo) || 0;
      const sem = semaforoColor(actual, minimo, prod.stock_bajo);
      const referencia =
        Number(prod.stock_bajo) > 0 ? Number(prod.stock_bajo) : minimo * 1.5;
      const sugerida = Math.max(0, Math.ceil(referencia - actual));
      return [
        ...prev,
        {
          nombre: String(prod.nombre || "").trim(),
          marca: prod.marca || "",
          unidad: prod.unidad || "",
          stock_actual: actual,
          stock_minimo: minimo,
          sem,
          origen: "mi_catalogo",
          incluir: true,
          cantidad: sugerida > 0 ? sugerida : 1,
        },
      ];
    });
  }
  function agregarDelCatalogo(prod) {
    setFilas((prev) => {
      // Evita duplicar un producto ya presente (por nombre).
      const existe = prev.some(
        (f) =>
          f.nombre.trim().toLowerCase() ===
          String(prod.nombre || "").trim().toLowerCase(),
      );
      if (existe) {
        setToast({
          type: "warning",
          mensaje: "Ese producto ya está en la lista.",
        });
        return prev;
      }
      return [
        ...prev,
        {
          nombre: String(prod.nombre || "").trim(),
          marca: prod.marca || "",
          unidad: "",
          stock_actual: null,
          stock_minimo: null,
          origen: "catalogo",
          incluir: true,
          cantidad: 1,
        },
      ];
    });
  }

  const itemsListos = filas
    .filter(
      (f) => f.incluir && Number(f.cantidad) > 0 && String(f.nombre || "").trim(),
    )
    .map((f) => ({
      nombre: f.nombre.trim(),
      unidad: f.unidad || undefined,
      cantidad: Number(f.cantidad) || 0,
    }));

  async function enviar() {
    if (!contactoNombre.trim()) {
      setToast({
        type: "warning",
        mensaje: "Indique el nombre de quien solicita la cotización.",
      });
      return;
    }
    if (itemsListos.length === 0) {
      setToast({
        type: "warning",
        mensaje: "Marque al menos un producto con cantidad mayor a cero.",
      });
      return;
    }
    setEnviando(true);
    try {
      const res = await apiRequest("/stock-clientes/solicitud-cotizacion", {
        method: "POST",
        body: JSON.stringify({
          items: itemsListos,
          nota: nota.trim() || undefined,
          contacto_nombre: contactoNombre.trim() || undefined,
          contacto_email: contactoEmail.trim() || undefined,
          contacto_telefono: contactoTel.trim() || undefined,
          sucursal_id: sucursalId ?? undefined,
        }),
      });
      onEnviado?.({ items: itemsListos.length, id: res?.solicitud?.id });
    } catch (e) {
      setToast({
        type: "error",
        mensaje: e?.message || "No pudimos enviar la solicitud.",
      });
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div style={modalStyles.overlay} onClick={onCerrar}>
      <div style={modalStyles.card} onClick={(e) => e.stopPropagation()}>
        <div style={modalStyles.header}>
          <div style={modalStyles.headerIcono}>
            <FileSpreadsheet size={20} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={modalStyles.eyebrow}>Cotización</div>
            <div style={modalStyles.titulo}>Solicitar cotización</div>
            <div style={modalStyles.sub}>
              Preseleccionamos sus productos bajos o críticos. Agregue otros desde
              su catálogo y, si lo necesita, búsquelos en el catálogo Amsodent.
            </div>
          </div>
          <button onClick={onCerrar} style={modalStyles.btnCerrar} title="Cerrar">
            <X size={18} />
          </button>
        </div>

        <div style={modalStyles.body}>
          <div style={{ display: "grid", gap: 10 }}>
            <BuscadorMiCatalogo productos={productos} onAgregar={agregarMiCatalogo} />
            <BuscadorCatalogo onAgregar={agregarDelCatalogo} />
          </div>

          <div style={modalStyles.listaHeader}>
            <span style={modalStyles.listaTitulo}>
              Productos a cotizar
              {itemsListos.length > 0 && (
                <span style={modalStyles.listaConteo}>{itemsListos.length}</span>
              )}
            </span>
            <button
              type="button"
              onClick={agregarManual}
              style={modalStyles.btnAgregarFila}
            >
              <Plus size={14} /> Agregar producto
            </button>
          </div>

          <div style={modalStyles.tablaWrap}>
            {filas.length === 0 ? (
              <div style={modalStyles.vacioInterno}>
                No hay productos en estado bajo o crítico. Búsquelos en el
                catálogo o use “Agregar producto” para incluirlos manualmente.
              </div>
            ) : (
              <table style={modalStyles.tabla}>
                <thead>
                  <tr>
                    <th style={modalStyles.th}> </th>
                    <th style={{ ...modalStyles.th, textAlign: "left" }}>
                      Producto
                    </th>
                    <th style={{ ...modalStyles.th, textAlign: "right" }}>
                      Cantidad
                    </th>
                    <th style={{ ...modalStyles.th, width: 36 }} />
                  </tr>
                </thead>
                <tbody>
                  {filas.map((f, idx) => (
                    <tr
                      key={idx}
                      style={{
                        opacity: f.incluir ? 1 : 0.45,
                        transition: "opacity .15s ease",
                      }}
                    >
                      <td style={{ ...modalStyles.td, width: 40 }}>
                        <input
                          type="checkbox"
                          checked={f.incluir}
                          onChange={() => toggleIncluir(idx)}
                          style={{ width: 16, height: 16, cursor: "pointer" }}
                        />
                      </td>
                      <td style={modalStyles.td}>
                        {f.editable ? (
                          <input
                            type="text"
                            value={f.nombre}
                            onChange={(e) => cambiarNombre(idx, e.target.value)}
                            placeholder="Nombre del producto"
                            autoFocus
                            style={{
                              ...modalStyles.input,
                              padding: "8px 10px",
                              fontSize: 13,
                            }}
                          />
                        ) : (
                          <>
                            <div
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 7,
                                flexWrap: "wrap",
                              }}
                            >
                              <span style={{ fontWeight: 600, color: "#0f172a" }}>
                                {f.nombre}
                              </span>
                              {f.sem === "rojo" && (
                                <span style={{ ...modalStyles.estadoChip, background: "#fee2e2", color: "#b91c1c" }}>
                                  Crítico
                                </span>
                              )}
                              {f.sem === "amarillo" && (
                                <span style={{ ...modalStyles.estadoChip, background: "#fef3c7", color: "#b45309" }}>
                                  Bajo
                                </span>
                              )}
                            </div>
                            <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>
                              {f.origen === "catalogo"
                                ? `Catálogo Amsodent${f.marca ? ` · ${f.marca}` : ""}`
                                : f.origen === "mi_catalogo"
                                  ? `Mi catálogo · stock actual: ${f.stock_actual}`
                                  : `Stock actual: ${f.stock_actual}`}
                            </div>
                          </>
                        )}
                      </td>
                      <td style={{ ...modalStyles.td, textAlign: "right" }}>
                        <input
                          type="number"
                          min="0"
                          step="any"
                          value={f.cantidad}
                          onChange={(e) => cambiarCantidad(idx, e.target.value)}
                          disabled={!f.incluir}
                          style={modalStyles.inputCantidad}
                        />
                      </td>
                      <td style={{ ...modalStyles.td, textAlign: "center" }}>
                        {f.origen !== "declarado" && (
                          <button
                            type="button"
                            onClick={() => quitarFila(idx)}
                            title="Quitar producto"
                            style={modalStyles.btnQuitar}
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div style={modalStyles.grid}>
            <label style={{ ...modalStyles.label, gridColumn: "1 / -1" }}>
              Nombre de quien solicita
              <input
                type="text"
                value={contactoNombre}
                onChange={(e) => setContactoNombre(e.target.value)}
                placeholder="Ej: María Pérez"
                style={modalStyles.input}
              />
            </label>
            <label style={modalStyles.label}>
              Correo de contacto <span style={modalStyles.opt}>(opcional)</span>
              <input
                type="email"
                value={contactoEmail}
                onChange={(e) => setContactoEmail(e.target.value)}
                placeholder="contacto@empresa.cl"
                style={modalStyles.input}
              />
            </label>
            <label style={modalStyles.label}>
              Teléfono <span style={modalStyles.opt}>(opcional)</span>
              <input
                type="tel"
                value={contactoTel}
                onChange={(e) => setContactoTel(formatearTelefonoCL(e.target.value))}
                placeholder="+56 9 1234 5678"
                style={modalStyles.input}
              />
            </label>
          </div>

          <label style={modalStyles.label}>
            Comentario <span style={modalStyles.opt}>(opcional)</span>
            <textarea
              value={nota}
              onChange={(e) => setNota(e.target.value)}
              rows={3}
              placeholder="Plazo deseado, observaciones, etc."
              style={{ ...modalStyles.input, resize: "vertical", fontFamily: "inherit" }}
            />
          </label>
        </div>

        <div style={modalStyles.footer}>
          <div style={modalStyles.resumen}>
            {itemsListos.length === 0 ? (
              <span style={{ color: "#94a3b8" }}>
                Seleccione al menos un producto
              </span>
            ) : (
              <span>
                <strong style={{ color: "#0f172a" }}>{itemsListos.length}</strong>{" "}
                producto{itemsListos.length === 1 ? "" : "s"} listo
                {itemsListos.length === 1 ? "" : "s"} para enviar
              </span>
            )}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              onClick={onCerrar}
              style={modalStyles.btnGhost}
              disabled={enviando}
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={enviar}
              disabled={enviando || itemsListos.length === 0}
              style={modalStyles.btnEnviar}
              className="btn-guardar-shine"
            >
              <Send size={14} />
              {enviando ? "Enviando…" : "Enviar solicitud"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────
   Modal — Carga masiva de productos al stock
   Lee un archivo .xlsx/.xls/.csv y llena la tabla en memoria. El cliente
   revisa y luego presiona "Guardar stock" (misma carga de siempre).
   ────────────────────────────────────────────────────────────────────── */
// Encabezados aceptados → campo interno. Se normalizan (minúsculas, sin tildes).
const CARGA_ALIASES = {
  sku: "sku", codigo: "sku", code: "sku",
  producto: "nombre", nombre: "nombre", "nombre del producto": "nombre", descripcion: "nombre",
  marca: "marca",
  unidad: "unidad", "unidad de medida": "unidad", um: "unidad",
  "stock actual": "stock_actual", stock_actual: "stock_actual", actual: "stock_actual", stock: "stock_actual", cantidad: "stock_actual",
  "stock bajo": "stock_bajo", stock_bajo: "stock_bajo", bajo: "stock_bajo",
  "stock critico": "stock_minimo", stock_critico: "stock_minimo", critico: "stock_minimo",
  "stock minimo": "stock_minimo", minimo: "stock_minimo", "stock mínimo": "stock_minimo",
  precio: "precio_unitario", "precio unitario": "precio_unitario", precio_unitario: "precio_unitario", valor: "precio_unitario",
};
const CARGA_COLUMNAS = ["sku", "producto", "marca", "unidad", "stock_actual", "stock_bajo", "stock_critico", "precio"];

function normalizarEncabezado(k) {
  return String(k || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

// Parsea un número en formato chileno ("$12.500", "1.234,5") → 12500 / 1234.5.
function parsearNumeroCarga(v) {
  if (v == null || v === "") return "";
  const limpio = String(v).replace(/[^\d.,-]/g, "");
  if (limpio === "") return "";
  const n = Number(limpio.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : "";
}

function ModalCargaMasivaStock({ onCerrar, onCargar, setToast }) {
  const [archivo, setArchivo] = useState(null);
  const [filas, setFilas] = useState([]);
  const [omitidas, setOmitidas] = useState(0);
  const [parsing, setParsing] = useState(false);
  const [reemplazar, setReemplazar] = useState(false);

  async function manejarArchivo(file) {
    if (!file) return;
    setArchivo(file);
    setParsing(true);
    setFilas([]);
    setOmitidas(0);
    try {
      const XLSX = await import("xlsx");
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const raw = XLSX.utils.sheet_to_json(sheet, { defval: "", raw: false });
      let sinNombre = 0;
      const numericos = ["stock_actual", "stock_bajo", "stock_minimo", "precio_unitario"];
      const parsed = raw.map((row) => {
        const item = {
          sku: "", nombre: "", marca: "", unidad: "",
          stock_actual: "", stock_bajo: "", stock_minimo: "", precio_unitario: "",
        };
        for (const [k, v] of Object.entries(row)) {
          const campo = CARGA_ALIASES[normalizarEncabezado(k)];
          if (!campo) continue;
          if (numericos.includes(campo)) item[campo] = parsearNumeroCarga(v);
          else item[campo] = typeof v === "string" ? v.trim() : v ?? "";
        }
        return item;
      });
      const validas = parsed.filter((it) => {
        const ok = String(it.nombre || "").trim().length > 0;
        if (!ok) sinNombre += 1;
        return ok;
      });
      setFilas(validas);
      setOmitidas(sinNombre);
      if (validas.length === 0) {
        setToast({
          type: "warning",
          mensaje: "No se encontraron productos con nombre. Revise que el archivo tenga la columna \"producto\".",
        });
      }
    } catch (e) {
      console.error(e);
      setToast({ type: "error", mensaje: "No se pudo leer el archivo. ¿Es un .xlsx, .xls o .csv válido?" });
      setFilas([]);
      setOmitidas(0);
    } finally {
      setParsing(false);
    }
  }

  async function descargarPlantilla() {
    try {
      const XLSX = await import("xlsx");
      const ejemplo = [
        {
          sku: "EJ-001", producto: "Resina compuesta A2", marca: "3M", unidad: "caja",
          stock_actual: 12, stock_bajo: 6, stock_critico: 3, precio: 18900,
        },
      ];
      const ws = XLSX.utils.json_to_sheet(ejemplo, { header: CARGA_COLUMNAS });
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Stock");
      XLSX.writeFile(wb, "plantilla_stock.xlsx");
    } catch (e) {
      console.error(e);
      setToast({ type: "error", mensaje: "No se pudo generar la plantilla." });
    }
  }

  return (
    <div style={modalStyles.overlay} onClick={onCerrar}>
      <div style={{ ...modalStyles.card, maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
        <div style={modalStyles.header}>
          <div style={modalStyles.headerIcono}>
            <Upload size={20} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={modalStyles.eyebrow}>Stock</div>
            <div style={modalStyles.titulo}>Carga masiva de productos</div>
            <div style={modalStyles.sub}>
              Suba un archivo Excel o CSV. Los productos se cargan en la tabla
              para que los revise y luego presione “Guardar stock”.
            </div>
          </div>
          <button onClick={onCerrar} style={modalStyles.btnCerrar} title="Cerrar">
            <X size={18} />
          </button>
        </div>

        <div style={modalStyles.body}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
            <span style={{ fontSize: 12.5, color: "#64748b" }}>
              Columnas: SKU, producto, marca, unidad, stock_actual, stock_bajo,
              stock_critico, precio.
            </span>
            <button type="button" onClick={descargarPlantilla} style={cargaStyles.btnPlantilla}>
              <Download size={14} /> Descargar plantilla
            </button>
          </div>

          <label style={cargaStyles.dropzone}>
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={(e) => manejarArchivo(e.target.files?.[0])}
              style={{ display: "none" }}
            />
            <FileSpreadsheet size={26} style={{ color: TEAL }} />
            <span style={{ fontWeight: 600, color: "#0f172a", fontSize: 13.5 }}>
              {archivo ? archivo.name : "Haga clic para elegir un archivo"}
            </span>
            <span style={{ fontSize: 11.5, color: "#94a3b8" }}>.xlsx, .xls o .csv</span>
          </label>

          {parsing && (
            <div style={{ marginTop: 14, fontSize: 13, color: "#64748b", textAlign: "center" }}>
              Leyendo archivo…
            </div>
          )}

          {!parsing && filas.length > 0 && (
            <div style={cargaStyles.resumen}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#15803d", fontWeight: 700, fontSize: 14 }}>
                <CheckCircle2 size={17} />
                {filas.length} producto{filas.length === 1 ? "" : "s"} listo{filas.length === 1 ? "" : "s"} para cargar
              </div>
              {omitidas > 0 && (
                <div style={{ display: "flex", alignItems: "center", gap: 7, color: "#b45309", fontSize: 12.5, marginTop: 6 }}>
                  <AlertTriangle size={14} />
                  {omitidas} fila{omitidas === 1 ? "" : "s"} sin nombre de producto se omitirá{omitidas === 1 ? "" : "n"}.
                </div>
              )}
              <label style={cargaStyles.checkbox}>
                <input
                  type="checkbox"
                  checked={reemplazar}
                  onChange={(e) => setReemplazar(e.target.checked)}
                  style={{ width: 15, height: 15, cursor: "pointer" }}
                />
                Reemplazar los productos actuales de la tabla (si no, se agregan al final).
              </label>
            </div>
          )}
        </div>

        <div style={modalStyles.footer}>
          <div style={modalStyles.resumen}>
            {filas.length > 0 && (
              <span>
                <strong style={{ color: "#0f172a" }}>{filas.length}</strong> para cargar
              </span>
            )}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" onClick={onCerrar} style={modalStyles.btnGhost}>
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => onCargar(filas, reemplazar)}
              disabled={filas.length === 0 || parsing}
              style={{
                ...modalStyles.btnEnviar,
                opacity: filas.length === 0 || parsing ? 0.5 : 1,
                cursor: filas.length === 0 || parsing ? "not-allowed" : "pointer",
              }}
              className="btn-guardar-shine"
            >
              <Upload size={14} />
              Cargar a la tabla
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const cargaStyles = {
  btnPlantilla: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    background: "#fff",
    color: TEAL,
    border: `1.5px solid ${TEAL}30`,
    fontSize: 12.5,
    fontWeight: 600,
    padding: "7px 13px",
    borderRadius: 999,
    cursor: "pointer",
  },
  dropzone: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    padding: "26px 18px",
    border: "2px dashed #cbd5e1",
    borderRadius: 14,
    cursor: "pointer",
    background: "#f8fafc",
    textAlign: "center",
    transition: "border-color .15s ease, background .15s ease",
  },
  resumen: {
    marginTop: 16,
    padding: "14px 16px",
    background: "#f0fdf4",
    border: "1px solid #bbf7d0",
    borderRadius: 12,
  },
  checkbox: {
    display: "flex",
    alignItems: "center",
    gap: 9,
    marginTop: 12,
    fontSize: 12.5,
    color: "#475569",
    cursor: "pointer",
    lineHeight: 1.4,
  },
};

const modalStyles = {
  overlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(15,23,42,0.55)",
    backdropFilter: "blur(4px)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
    zIndex: 10000,
    animation: "stockFadeUp .25s ease-out",
  },
  card: {
    background: "#fff",
    borderRadius: 18,
    maxWidth: 720,
    width: "100%",
    maxHeight: "90vh",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    boxShadow: "0 30px 80px rgba(15,23,42,0.30)",
    border: "1px solid #e2e8f0",
  },
  header: {
    display: "flex",
    gap: 14,
    alignItems: "flex-start",
    padding: "20px 22px 16px",
    borderBottom: "1px solid #f1f5f9",
    background: "linear-gradient(135deg, #ffffff 0%, #f0fdfa 100%)",
  },
  headerIcono: {
    width: 44,
    height: 44,
    borderRadius: 12,
    background: `linear-gradient(135deg, ${TEAL}, ${TEAL_LIGHT})`,
    color: "#fff",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    boxShadow: "0 8px 20px rgba(15,118,110,0.22)",
  },
  eyebrow: {
    fontSize: 10.5,
    color: "#64748b",
    textTransform: "uppercase",
    letterSpacing: 1.2,
    fontWeight: 700,
  },
  titulo: { fontSize: 19, fontWeight: 800, color: "#0f172a", marginTop: 2 },
  sub: { fontSize: 12.5, color: "#64748b", marginTop: 4, lineHeight: 1.5 },
  btnCerrar: {
    border: "none",
    background: "transparent",
    cursor: "pointer",
    color: "#94a3b8",
    padding: 6,
    borderRadius: 6,
    transition: "color .15s, background .15s",
  },
  body: { padding: 22, overflowY: "auto", flex: 1, display: "flex", flexDirection: "column", gap: 16 },
  vacio: {
    padding: 32,
    textAlign: "center",
    color: "#64748b",
    fontSize: 13,
    background: "#f8fafc",
    borderRadius: 12,
    border: "1px dashed #cbd5e1",
  },
  tablaWrap: {
    border: "1px solid #e2e8f0",
    borderRadius: 12,
    overflow: "hidden",
    minHeight: 160,
    maxHeight: "46vh",
    overflowY: "auto",
  },
  listaHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: -4,
  },
  listaTitulo: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    fontSize: 11,
    fontWeight: 700,
    color: "#64748b",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  listaConteo: {
    background: "#e7f8f8",
    color: TEAL,
    fontSize: 11,
    fontWeight: 800,
    padding: "1px 8px",
    borderRadius: 999,
  },
  btnAgregarFila: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "7px 14px",
    background: "#f0fdfa",
    color: TEAL,
    border: `1px solid ${TEAL}33`,
    borderRadius: 999,
    fontSize: 12.5,
    fontWeight: 700,
    cursor: "pointer",
  },
  vacioInterno: {
    padding: "34px 24px",
    textAlign: "center",
    color: "#94a3b8",
    fontSize: 12.5,
    lineHeight: 1.6,
  },
  tabla: { width: "100%", borderCollapse: "collapse" },
  th: {
    fontSize: 10.5,
    fontWeight: 700,
    color: "#64748b",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    padding: "10px 14px",
    background: "#f8fafc",
    borderBottom: "1px solid #e2e8f0",
    textAlign: "center",
  },
  td: {
    padding: "10px 14px",
    borderBottom: "1px solid #f1f5f9",
    fontSize: 13,
    color: "#0f172a",
    verticalAlign: "middle",
  },
  inputCantidad: {
    width: 96,
    padding: "7px 10px",
    border: "1px solid #cbd5e1",
    borderRadius: 8,
    fontSize: 13,
    textAlign: "right",
    outline: "none",
  },
  btnQuitar: {
    border: "none",
    background: "transparent",
    color: "#cbd5e1",
    cursor: "pointer",
    padding: 4,
    borderRadius: 6,
    display: "inline-flex",
  },
  estadoChip: {
    padding: "1px 8px",
    borderRadius: 999,
    fontSize: 10,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  catalogoDropdown: {
    position: "absolute",
    top: "calc(100% + 4px)",
    left: 0,
    right: 0,
    background: "#fff",
    border: "1px solid #e2e8f0",
    borderRadius: 10,
    boxShadow: "0 12px 28px rgba(15,23,42,0.14)",
    maxHeight: 240,
    overflowY: "auto",
    zIndex: 80,
    padding: 4,
  },
  catalogoItem: {
    display: "flex",
    flexDirection: "column",
    width: "100%",
    textAlign: "left",
    padding: "8px 10px",
    border: "none",
    background: "transparent",
    cursor: "pointer",
    borderRadius: 6,
  },
  catalogoVacio: {
    padding: "10px 12px",
    fontSize: 12.5,
    color: "#94a3b8",
    textAlign: "center",
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 12,
  },
  label: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    fontSize: 11,
    color: "#64748b",
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  opt: { textTransform: "none", color: "#94a3b8", fontWeight: 400 },
  input: {
    width: "100%",
    padding: "10px 12px",
    border: "1.5px solid #e2e8f0",
    borderRadius: 10,
    fontSize: 13.5,
    color: "#0f172a",
    outline: "none",
    boxSizing: "border-box",
  },
  footer: {
    padding: "14px 22px",
    borderTop: "1px solid #f1f5f9",
    background: "#f8fafc",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    flexWrap: "wrap",
  },
  resumen: { fontSize: 12.5, color: "#64748b" },
  btnGhost: {
    padding: "10px 18px",
    border: "1px solid #cbd5e1",
    background: "#fff",
    color: "#475569",
    fontSize: 13,
    fontWeight: 600,
    borderRadius: 999,
    cursor: "pointer",
  },
  btnEnviar: {
    display: "inline-flex",
    alignItems: "center",
    gap: 7,
    padding: "10px 22px",
    background: `linear-gradient(135deg, ${TEAL}, ${TEAL_LIGHT})`,
    color: "#fff",
    border: "none",
    fontSize: 13.5,
    fontWeight: 700,
    borderRadius: 999,
    cursor: "pointer",
    boxShadow: "0 10px 22px rgba(15,118,110,0.28)",
  },
};

// Control de exportación del reporte de productos en estado bajo/crítico.
// Menú compacto con dos opciones: descargar CSV o imprimir/PDF.
function ExportarControl({ onCSV, onImprimir, disabled }) {
  const [abierto, setAbierto] = useState(false);

  useEffect(() => {
    if (!abierto) return;
    const cerrar = () => setAbierto(false);
    window.addEventListener("click", cerrar);
    return () => window.removeEventListener("click", cerrar);
  }, [abierto]);

  return (
    <div style={{ position: "relative" }} onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        disabled={disabled}
        style={{
          ...exportStyles.boton,
          opacity: disabled ? 0.5 : 1,
          cursor: disabled ? "not-allowed" : "pointer",
        }}
        title={
          disabled
            ? "No hay productos en estado bajo o crítico para exportar."
            : "Exportar reporte de productos en alerta"
        }
      >
        <FileDown size={14} /> Exportar
      </button>
      {abierto && !disabled && (
        <div style={exportStyles.menu}>
          <button
            type="button"
            style={exportStyles.opcion}
            onClick={() => {
              setAbierto(false);
              onImprimir();
            }}
          >
            <Printer size={14} /> Descargar PDF
          </button>
          <button
            type="button"
            style={exportStyles.opcion}
            onClick={() => {
              setAbierto(false);
              onCSV();
            }}
          >
            <FileSpreadsheet size={14} /> Descargar Excel (CSV)
          </button>
        </div>
      )}
    </div>
  );
}

const exportStyles = {
  boton: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "9px 14px",
    background: "#fff",
    color: "#475569",
    border: "1px solid #cbd5e1",
    borderRadius: 999,
    fontSize: 13,
    fontWeight: 600,
  },
  menu: {
    position: "absolute",
    top: "calc(100% + 6px)",
    right: 0,
    background: "#fff",
    border: "1px solid #e2e8f0",
    borderRadius: 10,
    boxShadow: "0 12px 28px rgba(15,23,42,0.14)",
    padding: 6,
    zIndex: 60,
    minWidth: 210,
  },
  opcion: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    width: "100%",
    textAlign: "left",
    padding: "9px 12px",
    background: "transparent",
    border: "none",
    borderRadius: 8,
    fontSize: 13,
    color: "#334155",
    fontWeight: 500,
    cursor: "pointer",
  },
};

function EstadoBanner({ info, criticos = [], bajos = [] }) {
  const tonoMap = {
    verde: {
      bg: "rgba(34,197,94,0.08)",
      border: "rgba(34,197,94,0.22)",
      color: "#15803d",
      icono: CheckCircle2,
    },
    amarillo: {
      bg: "rgba(245,158,11,0.10)",
      border: "rgba(245,158,11,0.25)",
      color: "#b45309",
      icono: AlertTriangle,
    },
    rojo: {
      bg: "rgba(239,68,68,0.08)",
      border: "rgba(239,68,68,0.22)",
      color: "#b91c1c",
      icono: AlertCircle,
    },
  };
  const cfg = tonoMap[info.tono];
  const Icono = cfg.icono;
  const tieneProblemas = criticos.length > 0 || bajos.length > 0;

  return (
    <div
      style={{
        marginTop: 18,
        padding: "14px 16px",
        background: cfg.bg,
        border: `1px solid ${cfg.border}`,
        borderRadius: 12,
        display: "flex",
        gap: 12,
        alignItems: "flex-start",
        color: cfg.color,
        position: "relative",
        zIndex: 1,
      }}
    >
      <Icono size={20} style={{ flexShrink: 0, marginTop: 1 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 700 }}>{info.titulo}</div>
        <div style={{ fontSize: 12.5, marginTop: 2, opacity: 0.85, lineHeight: 1.45 }}>
          {info.mensaje}
        </div>

        {tieneProblemas && (
          <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
            {criticos.length > 0 && (
              <ListaProductosBanner
                etiqueta="Críticos"
                productos={criticos}
                color="#b91c1c"
                bg="#fee2e2"
                borde="rgba(239,68,68,0.30)"
              />
            )}
            {bajos.length > 0 && (
              <ListaProductosBanner
                etiqueta="Bajos"
                productos={bajos}
                color="#b45309"
                bg="#fef3c7"
                borde="rgba(245,158,11,0.30)"
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ListaProductosBanner({ etiqueta, productos, color, bg, borde }) {
  const MAX_VISIBLES = 6;
  const visibles = productos.slice(0, MAX_VISIBLES);
  const extra = productos.length - visibles.length;

  return (
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
      <span
        style={{
          fontSize: 10.5,
          fontWeight: 800,
          color,
          textTransform: "uppercase",
          letterSpacing: 0.7,
          marginRight: 2,
        }}
      >
        {etiqueta}:
      </span>
      {visibles.map((p, idx) => {
        const actual = p.stock_actual || 0;
        const unidad = p.unidad ? ` ${p.unidad}` : "";
        return (
          <span
            key={idx}
            title={`Stock actual declarado: ${actual}${unidad}`}
            style={{
              display: "inline-block",
              padding: "3px 12px",
              background: bg,
              color,
              border: `1px solid ${borde}`,
              borderRadius: 999,
              fontSize: 12,
              fontWeight: 600,
              lineHeight: 1.6,
              maxWidth: 260,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {p.nombre}
            <span style={{ opacity: 0.45, margin: "0 6px" }}>·</span>
            <span style={{ fontWeight: 700 }}>
              {actual}
              {unidad}
            </span>
          </span>
        );
      })}
      {extra > 0 && (
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            color,
            opacity: 0.75,
            padding: "3px 6px",
          }}
        >
          +{extra} más
        </span>
      )}
    </div>
  );
}

function MetricCard({ label, valor, tono, pulse }) {
  const tonoMap = {
    neutro: {
      bg: "rgba(255,255,255,0.7)",
      color: "#0f172a",
      borde: "rgba(15,118,110,0.10)",
      icono: PackageMini,
      iconoColor: "#0f766e",
    },
    verde: {
      bg: "rgba(220,252,231,0.85)",
      color: "#15803d",
      borde: "rgba(34,197,94,0.22)",
      icono: CheckMini,
      iconoColor: "#22c55e",
    },
    amarillo: {
      bg: "rgba(254,243,199,0.85)",
      color: "#b45309",
      borde: "rgba(245,158,11,0.25)",
      icono: WarnMini,
      iconoColor: "#f59e0b",
    },
    rojo: {
      bg: "rgba(254,226,226,0.85)",
      color: "#b91c1c",
      borde: "rgba(239,68,68,0.25)",
      icono: AlertMini,
      iconoColor: "#ef4444",
    },
  };
  const cfg = tonoMap[tono] || tonoMap.neutro;
  const Icono = cfg.icono;
  return (
    <div
      className={pulse ? "metric-pulse" : ""}
      style={{
        ...styles.metricCard,
        background: cfg.bg,
        color: cfg.color,
        border: `1px solid ${cfg.borde}`,
      }}
    >
      <div style={styles.metricIconoWrap}>
        <Icono color={cfg.iconoColor} />
      </div>
      <div style={styles.metricValor}>{valor}</div>
      <div style={styles.metricLabel}>{label}</div>
    </div>
  );
}

// Iconos mini SVG inline — más livianos que lucide para chips chicos.
function PackageMini({ color }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16.5 9.4 7.5 4.21" />
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
      <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
    </svg>
  );
}
function CheckMini({ color }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}
function WarnMini({ color }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}
function AlertMini({ color }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );
}

function getIniciales(nombre) {
  const s = String(nombre || "").trim();
  if (!s) return "?";
  const parts = s.split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/* ──────────────────────────────────────────────────────────────────────
   Footer enriquecido con contactos y RRSS — solo visible dentro del portal
   ya autenticado, sin saturar el login ni la pantalla de acuerdo.
   ────────────────────────────────────────────────────────────────────── */
function FooterContacto() {
  const anio = new Date().getFullYear();
  return (
    <footer style={stylesFooter.wrap}>
      <div style={stylesFooter.inner} data-portal-footer>
        <span style={stylesFooter.copy}>© {anio} Amsodent Medical</span>

        <span style={stylesFooter.contactos}>
          <a href="tel:+56228540000" style={stylesFooter.item}>
            <Phone size={12} /> +56 2 2854 0000
          </a>
          <span style={stylesFooter.sep} />
          <a
            href="mailto:contacto@amsodentmedical.cl"
            style={stylesFooter.item}
          >
            <Mail size={12} /> contacto@amsodentmedical.cl
          </a>
        </span>

        <span style={stylesFooter.acciones}>
          <a
            href="https://www.instagram.com/amsodentmedical"
            target="_blank"
            rel="noopener noreferrer"
            style={stylesFooter.iconBtn}
            data-social
            title="Instagram"
          >
            <Instagram size={13} />
          </a>
          <a
            href="https://wa.me/56228540000"
            target="_blank"
            rel="noopener noreferrer"
            style={stylesFooter.iconBtn}
            data-social
            title="WhatsApp"
          >
            <MessageCircle size={13} />
          </a>
          <a
            href="https://www.amsodentmedical.cl"
            target="_blank"
            rel="noopener noreferrer"
            style={stylesFooter.iconBtn}
            data-social
            title="Sitio web"
          >
            <Globe size={13} />
          </a>
        </span>
      </div>
    </footer>
  );
}

const stylesFooter = {
  wrap: {
    borderTop: "1px solid rgba(15,118,110,0.10)",
    background: "rgba(255,255,255,0.70)",
    backdropFilter: "blur(8px)",
  },
  inner: {
    maxWidth: 1200,
    margin: "0 auto",
    padding: "8px 24px",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 16,
    flexWrap: "wrap",
    fontSize: 11.5,
    color: "#64748b",
  },
  copy: { fontWeight: 500 },
  contactos: {
    display: "inline-flex",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap",
  },
  item: {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    color: "#475569",
    textDecoration: "none",
    fontWeight: 500,
  },
  sep: {
    width: 1,
    height: 12,
    background: "rgba(15,118,110,0.18)",
  },
  acciones: {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
  },
  iconBtn: {
    width: 24,
    height: 24,
    borderRadius: 7,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    background: "#ffffff",
    border: "1px solid rgba(15,118,110,0.14)",
    color: TEAL,
    textDecoration: "none",
    transition: "transform .15s ease, box-shadow .15s ease",
  },
};

function ToastFlotante({ toast, onClose }) {
  const cfg =
    toast.type === "error"
      ? { color: "#b91c1c", bg: "#fee2e2", icono: AlertCircle }
      : toast.type === "warning"
        ? { color: "#b45309", bg: "#fef3c7", icono: AlertTriangle }
        : { color: "#15803d", bg: "#dcfce7", icono: CheckCircle2 };
  const Icono = cfg.icono;
  const titulo =
    toast.titulo ||
    (toast.type === "error"
      ? "Hubo un problema"
      : toast.type === "warning"
        ? "Aviso"
        : "Listo");

  return (
    <div className="anim-toast" style={styles.toast}>
      <div style={{ ...styles.toastBarra, background: cfg.color }} />
      <div style={{ ...styles.toastIcono, background: cfg.bg, color: cfg.color }}>
        <Icono size={20} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={styles.toastTitulo}>{titulo}</div>
        {toast.mensaje && (
          <div style={styles.toastMensaje}>{toast.mensaje}</div>
        )}
      </div>
      <button
        type="button"
        onClick={onClose}
        style={styles.toastCerrar}
        title="Cerrar"
        aria-label="Cerrar notificación"
      >
        ×
      </button>
    </div>
  );
}

function fmtFechaHora(iso) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleString("es-CL", { dateStyle: "short", timeStyle: "short" });
  } catch {
    return String(iso);
  }
}

/* ──────────────────────────────────────────────────────────────────────
   Estilos
   ────────────────────────────────────────────────────────────────────── */
const styles = {
  root: {
    minHeight: "100vh",
    fontFamily: '"Jost", system-ui, -apple-system, Arial, sans-serif',
    color: "#0f172a",
    position: "relative",
    overflow: "hidden",
  },
  fondo: {
    position: "fixed",
    inset: 0,
    background: "linear-gradient(135deg, #f0fdfa 0%, #ecfeff 50%, #f0f9ff 100%)",
    zIndex: 0,
  },
  fondoPattern: {
    position: "fixed",
    inset: 0,
    background:
      "radial-gradient(circle at 20% 30%, rgba(15,118,110,0.08) 0%, transparent 40%), radial-gradient(circle at 80% 70%, rgba(37,183,189,0.10) 0%, transparent 50%)",
    zIndex: 0,
    pointerEvents: "none",
  },
  shell: {
    position: "relative",
    zIndex: 1,
    minHeight: "100vh",
    display: "flex",
    flexDirection: "column",
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "16px 32px",
    borderBottom: "1px solid rgba(15,118,110,0.10)",
    background: "rgba(255,255,255,0.82)",
    backdropFilter: "blur(12px)",
    WebkitBackdropFilter: "blur(12px)",
    position: "sticky",
    top: 0,
    zIndex: 50,
  },
  brand: { display: "flex", alignItems: "center", gap: 16 },
  brandLogo: { height: 42, width: "auto", display: "block" },
  brandDivider: {
    width: 1,
    height: 32,
    background:
      "linear-gradient(180deg, rgba(15,118,110,0) 0%, rgba(15,118,110,0.32) 50%, rgba(15,118,110,0) 100%)",
    flexShrink: 0,
  },
  brandTextWrap: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
    lineHeight: 1.15,
  },
  brandEyebrow: {
    fontSize: 10.5,
    color: "#64748b",
    textTransform: "uppercase",
    letterSpacing: 1.4,
    fontWeight: 700,
  },
  brandTitle: {
    fontSize: 16,
    fontWeight: 700,
    color: TEAL,
    letterSpacing: -0.2,
  },
  btnGhost: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    border: "1px solid rgba(15,118,110,0.2)",
    background: "#fff",
    color: TEAL,
    fontSize: 13,
    fontWeight: 500,
    padding: "8px 14px",
    borderRadius: 8,
    cursor: "pointer",
  },
  btnGhostFlat: {
    border: "1px solid #cbd5e1",
    background: "#fff",
    color: "#475569",
    fontSize: 14,
    fontWeight: 500,
    padding: "11px 18px",
    borderRadius: 10,
    cursor: "pointer",
  },
  main: { flex: 1, padding: "32px 24px 60px", maxWidth: 1200, margin: "0 auto", width: "100%" },
  footer: {
    borderTop: "1px solid rgba(15,118,110,0.08)",
    padding: "16px 28px",
    background: "rgba(255,255,255,0.7)",
    backdropFilter: "blur(8px)",
  },
  footerInner: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 12,
    color: "#475569",
    fontSize: 12,
  },
  footerBrand: { display: "flex", alignItems: "center", gap: 8 },
  footerLinks: { display: "flex", gap: 18 },
  footerLink: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    color: "#64748b",
    textDecoration: "none",
  },

  // Acuerdo
  acuerdoWrap: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    paddingTop: 20,
    width: "100%",
  },
  acuerdoCard: {
    background: "#fff",
    borderRadius: 18,
    boxShadow: "0 20px 50px rgba(15,118,110,0.10)",
    border: "1px solid rgba(15,118,110,0.08)",
    padding: "36px 40px",
    maxWidth: 620,
    width: "100%",
    textAlign: "center",
  },
  acuerdoIcon: {
    width: 64,
    height: 64,
    margin: "0 auto 18px",
    borderRadius: 18,
    background: `linear-gradient(135deg, ${TEAL}, ${TEAL_LIGHT})`,
    color: "#fff",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    boxShadow: "0 10px 25px rgba(15,118,110,0.30)",
  },
  acuerdoTitulo: { fontSize: 24, fontWeight: 700, color: "#0f172a", margin: "0 0 8px" },
  acuerdoSub: {
    color: "#475569",
    fontSize: 14,
    lineHeight: 1.55,
    margin: "0 0 22px",
  },
  identidadConfirmada: {
    padding: "14px 18px",
    background: "#f0fdfa",
    border: `1px solid ${TEAL_LIGHT}30`,
    borderRadius: 12,
    marginBottom: 20,
    textAlign: "center",
  },
  identidadEmpresa: {
    fontSize: 16,
    fontWeight: 800,
    color: "#0f172a",
    lineHeight: 1.2,
  },
  identidadRut: {
    fontSize: 12,
    color: TEAL,
    fontWeight: 600,
    marginTop: 4,
    fontVariantNumeric: "tabular-nums",
  },
  acuerdoLista: {
    display: "flex",
    flexDirection: "column",
    gap: 14,
    margin: "0 0 24px",
    textAlign: "left",
  },
  acuerdoBloque: {
    display: "flex",
    gap: 14,
    padding: "14px 16px",
    background: "#f8fafc",
    borderRadius: 12,
    border: "1px solid #e2e8f0",
  },
  acuerdoBloqueIcono: {
    width: 38,
    height: 38,
    borderRadius: 10,
    background: "#ecfeff",
    color: TEAL,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  acuerdoBloqueTitulo: { fontSize: 14, fontWeight: 600, color: "#0f172a", marginBottom: 2 },
  acuerdoBloqueTexto: { fontSize: 13, color: "#475569", lineHeight: 1.5 },
  checkboxRow: {
    display: "flex",
    alignItems: "flex-start",
    gap: 12,
    padding: "14px 16px",
    background: "#f0fdfa",
    border: `1px solid ${TEAL_LIGHT}50`,
    borderRadius: 12,
    margin: "0 0 18px",
    fontSize: 13,
    color: "#0f172a",
    lineHeight: 1.5,
    textAlign: "left",
    cursor: "pointer",
  },
  checkbox: { width: 18, height: 18, accentColor: TEAL, marginTop: 2, flexShrink: 0, cursor: "pointer" },
  btnPrimario: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    background: `linear-gradient(135deg, ${TEAL}, ${TEAL_LIGHT})`,
    color: "#fff",
    border: "none",
    fontSize: 15,
    fontWeight: 600,
    padding: "13px 28px",
    borderRadius: 10,
    cursor: "pointer",
    width: "100%",
    boxShadow: "0 10px 22px rgba(15,118,110,0.28)",
  },
  btnSecundarioOutline: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    background: "#fff",
    color: TEAL,
    border: `1.5px solid ${TEAL}30`,
    fontSize: 13.5,
    fontWeight: 600,
    padding: "9px 18px",
    borderRadius: 999,
    cursor: "pointer",
    transition: "border-color .15s ease, background .15s ease, transform .15s ease",
  },
  btnPrimarioCompacto: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    background: `linear-gradient(135deg, ${TEAL}, ${TEAL_LIGHT})`,
    color: "#fff",
    border: "none",
    fontSize: 13.5,
    fontWeight: 600,
    padding: "10px 20px",
    borderRadius: 999,
    cursor: "pointer",
    boxShadow: "0 8px 18px rgba(15,118,110,0.26)",
  },
  btnSecundario: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    background: TEAL,
    color: "#fff",
    border: "none",
    fontSize: 13,
    fontWeight: 500,
    padding: "9px 14px",
    borderRadius: 8,
    cursor: "pointer",
  },
  btnEliminar: {
    border: "none",
    background: "transparent",
    color: "#94a3b8",
    cursor: "pointer",
    padding: 6,
    borderRadius: 6,
  },

  // Brand mark fijo en la esquina superior izquierda (login/acuerdo)
  loginBrandFixed: {
    position: "absolute",
    top: 28,
    left: 32,
    display: "flex",
    alignItems: "center",
    gap: 12,
    zIndex: 5,
  },
  loginBrandFixedLogo: {
    height: 36,
    width: "auto",
    display: "block",
  },
  loginBrandFixedEyebrow: {
    fontSize: 10.5,
    color: "#64748b",
    textTransform: "uppercase",
    letterSpacing: 1.4,
    fontWeight: 700,
    paddingLeft: 12,
    borderLeft: "1px solid rgba(15,118,110,0.18)",
  },

  // Wrapper que centra verticalmente el login + acuerdo
  loginViewport: {
    minHeight: "calc(100vh - 110px)", // descuenta header (no presente aquí) + footer aprox
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    padding: "20px 0 40px",
    gap: 28,
    width: "100%",
  },
  loginBrand: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 6,
  },
  loginBrandLogo: {
    height: 44,
    width: "auto",
    display: "block",
  },
  loginBrandEyebrow: {
    fontSize: 10.5,
    color: "#64748b",
    textTransform: "uppercase",
    letterSpacing: 1.4,
    fontWeight: 700,
  },

  // Login (layout 2 columnas)
  loginGrid: {
    display: "grid",
    gridTemplateColumns: "1.1fr 1fr",
    gap: 48,
    alignItems: "center",
    maxWidth: 1080,
    margin: "0 auto",
    paddingTop: 8,
  },
  loginPitch: {
    color: "#0f172a",
    minWidth: 0,
  },
  brandMark: {
    display: "inline-flex",
    alignItems: "center",
    gap: 16,
    marginBottom: 26,
  },
  brandMarkLogo: {
    height: 52,
    width: "auto",
    display: "block",
    flexShrink: 0,
  },
  brandMarkDivider: {
    width: 1,
    height: 36,
    background:
      "linear-gradient(180deg, rgba(15,118,110,0) 0%, rgba(15,118,110,0.35) 50%, rgba(15,118,110,0) 100%)",
    flexShrink: 0,
  },
  brandMarkInfo: {
    display: "flex",
    flexDirection: "column",
    gap: 3,
    lineHeight: 1.2,
  },
  brandMarkEyebrow: {
    fontSize: 11,
    fontWeight: 800,
    color: TEAL,
    textTransform: "uppercase",
    letterSpacing: 1.4,
  },
  brandMarkSub: {
    fontSize: 12.5,
    color: "#64748b",
    fontWeight: 500,
  },
  loginHero: {
    fontSize: 38,
    fontWeight: 800,
    color: "#0f172a",
    lineHeight: 1.1,
    margin: "0 0 16px",
    letterSpacing: -0.5,
  },
  // El gradiente animado vive enteramente en la clase `.hero-shine` para
  // que el shine pueda animarse. Solo dejamos display:inline-block acá.
  loginHeroAccent: {
    display: "inline-block",
  },
  loginHeroSub: {
    fontSize: 15,
    color: "#475569",
    lineHeight: 1.55,
    margin: "0 0 28px",
    maxWidth: 460,
  },
  featuresList: {
    listStyle: "none",
    padding: 0,
    margin: "0 0 24px",
    display: "flex",
    flexDirection: "column",
    gap: 16,
  },
  featureItem: {
    display: "flex",
    gap: 14,
    alignItems: "flex-start",
  },
  featureIcono: {
    width: 38,
    height: 38,
    borderRadius: 10,
    background: "rgba(15,118,110,0.10)",
    color: TEAL,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  featureTitulo: {
    fontSize: 14,
    fontWeight: 700,
    color: "#0f172a",
    marginBottom: 2,
  },
  featureTexto: {
    fontSize: 13,
    color: "#64748b",
    lineHeight: 1.45,
  },
  loginAyuda: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    padding: "10px 14px",
    background: "rgba(15,118,110,0.06)",
    border: "1px dashed rgba(15,118,110,0.20)",
    borderRadius: 10,
    fontSize: 12.5,
    color: "#475569",
    lineHeight: 1.4,
  },
  loginFormCol: {
    display: "flex",
    justifyContent: "center",
    minWidth: 0,
  },
  loginCard: {
    background: "#fff",
    borderRadius: 20,
    boxShadow:
      "0 30px 60px rgba(15,118,110,0.12), 0 4px 10px rgba(15,118,110,0.04)",
    border: "1px solid rgba(15,118,110,0.08)",
    padding: "38px 42px",
    maxWidth: 440,
    width: "100%",
    textAlign: "center",
    position: "relative",
    overflow: "hidden",
  },
  loginCardGlow: {
    position: "absolute",
    top: -80,
    left: "50%",
    transform: "translateX(-50%)",
    width: 280,
    height: 280,
    background:
      "radial-gradient(circle, rgba(37,183,189,0.18) 0%, transparent 70%)",
    pointerEvents: "none",
    filter: "blur(2px)",
  },
  loginTitulo: { fontSize: 22, fontWeight: 700, margin: "0 0 6px" },
  loginSub: { fontSize: 13, color: "#64748b", lineHeight: 1.5, margin: "0 0 22px" },
  loginPie: {
    marginTop: 18,
    paddingTop: 14,
    borderTop: "1px solid #f1f5f9",
    fontSize: 11,
    color: "#94a3b8",
    fontWeight: 500,
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    justifyContent: "center",
    width: "100%",
  },
  form: { display: "flex", flexDirection: "column", gap: 14, textAlign: "left" },
  label: { fontSize: 12, color: "#64748b", fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.4 },
  opt: { textTransform: "none", color: "#94a3b8", fontWeight: 400 },
  input: {
    width: "100%",
    marginTop: 6,
    padding: "11px 14px",
    border: "1.5px solid #e2e8f0",
    borderRadius: 10,
    fontSize: 14,
    color: "#0f172a",
    outline: "none",
    boxSizing: "border-box",
    transition: "border .15s, box-shadow .15s",
  },
  errorBox: {
    padding: "10px 12px",
    background: "#fee2e2",
    color: "#991b1b",
    border: "1px solid #fecaca",
    borderRadius: 8,
    fontSize: 13,
  },
  verClaveBtn: {
    position: "absolute",
    right: 8,
    top: "50%",
    transform: "translateY(-50%)",
    background: "transparent",
    border: "none",
    color: "#94a3b8",
    cursor: "pointer",
    padding: 6,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
  },
  linkRecuperar: {
    background: "transparent",
    border: "none",
    color: TEAL,
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
    marginTop: 2,
    padding: 4,
    alignSelf: "center",
  },
  modalOverlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(15,23,42,0.72)",
    backdropFilter: "blur(6px)",
    WebkitBackdropFilter: "blur(6px)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
    zIndex: 1000,
  },
  modalRecuperar: {
    position: "relative",
    width: "100%",
    maxWidth: 440,
    maxHeight: "90vh",
    overflowY: "auto",
    scrollbarWidth: "thin",
    background: "#fff",
    borderRadius: 18,
    padding: "26px 24px 22px",
    boxShadow: "0 24px 60px rgba(15,23,42,0.28)",
    textAlign: "center",
  },
  modalCerrar: {
    position: "absolute",
    top: 14,
    right: 14,
    background: "#f1f5f9",
    border: "none",
    borderRadius: 9,
    width: 32,
    height: 32,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    color: "#64748b",
    cursor: "pointer",
  },

  // Declaración
  declWrap: { display: "flex", flexDirection: "column", gap: 22 },

  // Hero card del cliente
  heroCard: {
    position: "relative",
    background:
      "linear-gradient(135deg, #ffffff 0%, #f0fdfa 60%, #ecfeff 100%)",
    borderRadius: 20,
    border: "1px solid rgba(15,118,110,0.10)",
    boxShadow:
      "0 18px 44px rgba(15,118,110,0.08), 0 2px 6px rgba(15,118,110,0.04)",
    padding: "22px 26px",
    overflow: "hidden",
    transition: "box-shadow .25s ease, transform .25s ease",
  },
  heroGlow: {
    position: "absolute",
    top: -140,
    right: -120,
    width: 340,
    height: 340,
    borderRadius: "50%",
    background:
      "radial-gradient(circle, rgba(37,183,189,0.18) 0%, transparent 65%)",
    pointerEvents: "none",
    filter: "blur(2px)",
  },
  heroTop: {
    position: "relative",
    zIndex: 1,
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 22,
  },
  heroLeft: { display: "flex", gap: 16, alignItems: "center", minWidth: 0, flex: 1 },
  avatarRing: {
    width: 64,
    height: 64,
    borderRadius: "50%",
    background: `linear-gradient(135deg, ${TEAL} 0%, ${TEAL_LIGHT} 100%)`,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    boxShadow:
      "0 10px 24px rgba(15,118,110,0.22), inset 0 0 0 1px rgba(255,255,255,0.18)",
  },
  avatar: {
    width: "100%",
    height: "100%",
    borderRadius: "50%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 20,
    fontWeight: 700,
    color: "#fff",
    letterSpacing: 0.5,
    textShadow: "0 1px 2px rgba(0,0,0,0.10)",
  },
  heroEyebrow: {
    fontSize: 10.5,
    color: "#64748b",
    textTransform: "uppercase",
    letterSpacing: 1.2,
    fontWeight: 700,
    marginBottom: 3,
  },
  heroNombre: {
    fontSize: 22,
    fontWeight: 700,
    color: "#0f172a",
    lineHeight: 1.15,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    textTransform: "capitalize",
    letterSpacing: -0.2,
  },
  heroMeta: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    marginTop: 6,
    flexWrap: "wrap",
  },
  heroRut: {
    fontSize: 13,
    color: "#475569",
    fontWeight: 600,
    fontVariantNumeric: "tabular-nums",
  },
  heroDivider: {
    width: 3,
    height: 3,
    borderRadius: "50%",
    background: "#cbd5e1",
  },
  heroUltimaInline: { fontSize: 12, color: "#64748b" },

  // KPIs en el hero
  kpiRow: { display: "flex", gap: 8, flexWrap: "wrap" },
  metricCard: {
    position: "relative",
    minWidth: 76,
    padding: "10px 14px 9px",
    borderRadius: 12,
    textAlign: "center",
    backdropFilter: "blur(8px)",
    transition: "transform .2s ease, box-shadow .2s ease",
    cursor: "default",
  },
  metricIconoWrap: {
    position: "absolute",
    top: 8,
    right: 8,
    opacity: 0.55,
  },
  metricValor: {
    fontSize: 22,
    fontWeight: 800,
    lineHeight: 1,
    marginTop: 6,
    fontVariantNumeric: "tabular-nums",
  },
  metricLabel: {
    fontSize: 10,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginTop: 5,
    opacity: 0.8,
  },

  declCard: {
    background: "#fff",
    borderRadius: 18,
    border: "1px solid #e2e8f0",
    boxShadow: "0 10px 30px rgba(15,23,42,0.05)",
    overflow: "hidden",
  },
  declCardHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "18px 22px",
    borderBottom: "1px solid #f1f5f9",
    gap: 12,
    flexWrap: "wrap",
  },
  declTitulo: { fontSize: 16, fontWeight: 700, color: "#0f172a" },
  declSub: { fontSize: 12, color: "#64748b", marginTop: 2 },

  tablaWrap: { overflowX: "auto" },
  tabla: { width: "100%", borderCollapse: "collapse", minWidth: 720 },
  th: {
    textAlign: "left",
    padding: "10px 8px",
    fontSize: 10,
    fontWeight: 700,
    color: "#64748b",
    textTransform: "uppercase",
    letterSpacing: 0.4,
    background: "linear-gradient(180deg, #f8fafc 0%, #f1f5f9 100%)",
    borderBottom: "1px solid #e2e8f0",
  },
  tr: {
    transition: "background .15s ease, transform .15s ease",
  },
  td: {
    padding: "9px 8px",
    borderBottom: "1px solid #f1f5f9",
    fontSize: 13,
    color: "#0f172a",
    verticalAlign: "middle",
  },
  cellInput: {
    width: "100%",
    border: "1px solid transparent",
    background: "transparent",
    padding: "6px 7px",
    fontSize: 13,
    color: "#0f172a",
    borderRadius: 8,
    outline: "none",
    transition: "background .15s ease, border-color .15s ease, box-shadow .15s ease",
  },

  declFooter: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "16px 22px",
    background: "#f8fafc",
    borderTop: "1px solid #e2e8f0",
    gap: 16,
    flexWrap: "wrap",
  },
  declLeyenda: {
    display: "flex",
    flexWrap: "wrap",
    gap: 14,
    fontSize: 12,
    fontWeight: 500,
  },
  leyendaItem: { display: "inline-flex", alignItems: "center", gap: 6 },
  dot: { width: 10, height: 10, borderRadius: "50%", display: "inline-block" },

  histToggle: {
    width: "100%",
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "16px 22px",
    background: "transparent",
    border: "none",
    cursor: "pointer",
    color: "#0f172a",
    fontSize: 14,
    fontWeight: 600,
  },

  toast: {
    position: "fixed",
    bottom: 24,
    right: 24,
    background: "#ffffff",
    borderRadius: 14,
    boxShadow: "0 20px 50px rgba(15,23,42,0.18), 0 2px 8px rgba(15,23,42,0.06)",
    border: "1px solid #e2e8f0",
    minWidth: 320,
    maxWidth: 420,
    zIndex: 9999,
    display: "flex",
    alignItems: "stretch",
    overflow: "hidden",
    padding: "14px 14px 14px 12px",
    gap: 12,
  },
  toastBarra: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    width: 4,
  },
  toastIcono: {
    width: 38,
    height: 38,
    borderRadius: 10,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    marginLeft: 4,
  },
  toastTitulo: {
    fontSize: 13.5,
    fontWeight: 700,
    color: "#0f172a",
    lineHeight: 1.3,
  },
  toastMensaje: {
    fontSize: 12.5,
    color: "#475569",
    lineHeight: 1.45,
    marginTop: 3,
  },
  toastCerrar: {
    border: "none",
    background: "transparent",
    color: "#94a3b8",
    fontSize: 22,
    lineHeight: 1,
    cursor: "pointer",
    padding: "0 4px",
    marginLeft: 4,
    alignSelf: "flex-start",
    transition: "color .15s ease",
  },
};

function Estilos() {
  return (
    <style>{`
      .anim-fade-up {
        animation: stockFadeUp .5s cubic-bezier(.4, 0, .2, 1);
      }
      @keyframes stockFadeUp {
        from { opacity: 0; transform: translateY(14px); }
        to   { opacity: 1; transform: translateY(0); }
      }

      @keyframes stockPing {
        0%, 100% { transform: scale(1); opacity: .9; }
        50%      { transform: scale(1.6); opacity: .35; }
      }

      .hero-card:hover {
        transform: translateY(-2px);
        box-shadow: 0 26px 60px rgba(15,118,110,0.14), 0 4px 10px rgba(15,118,110,0.06);
      }

      .metric-pulse {
        animation: metricPulseRed 2.2s ease-in-out infinite;
      }
      @keyframes metricPulseRed {
        0%, 100% { box-shadow: 0 0 0 0 rgba(239,68,68,.0), inset 0 0 0 1px rgba(239,68,68,.0); }
        50%      { box-shadow: 0 0 0 6px rgba(239,68,68,.10), inset 0 0 0 1px rgba(239,68,68,.20); }
      }

      .metric-pulse,
      [class*="metricCard"]:hover {
        transform: translateY(-1px);
      }

      .badge-pulse {
        animation: badgePulse 1.8s ease-in-out infinite;
      }
      @keyframes badgePulse {
        0%, 100% { box-shadow: 0 0 0 0 rgba(239,68,68,0); }
        50%      { box-shadow: 0 0 0 6px rgba(239,68,68,.18); }
      }

      .row-hover {
        transition: filter .18s ease;
      }
      .row-hover:hover {
        filter: brightness(.985);
      }
      .row-hover:hover input {
        background: rgba(255,255,255,0.55);
      }
      .row-hover:hover .btn-eliminar {
        opacity: 1;
      }
      .row-hover input:hover:not(:focus) {
        background: rgba(255,255,255,0.85);
        border-color: #e2e8f0 !important;
      }
      .btn-eliminar {
        opacity: .35;
        transition: opacity .15s ease, color .15s ease, background .15s ease;
      }
      .btn-eliminar:hover {
        opacity: 1;
        color: #dc2626 !important;
        background: #fee2e2 !important;
      }

      .btn-hover {
        transition: transform .15s ease, box-shadow .15s ease, background .15s ease;
      }
      .btn-hover:hover {
        transform: translateY(-1px);
        box-shadow: 0 6px 18px rgba(15,118,110,.30);
      }

      .btn-guardar-shine {
        position: relative;
        overflow: hidden;
        transition: transform .15s ease, box-shadow .25s ease;
      }
      .btn-guardar-shine::before {
        content: '';
        position: absolute;
        top: 0;
        left: -120%;
        width: 60%;
        height: 100%;
        background: linear-gradient(120deg, transparent 0%, rgba(255,255,255,.35) 50%, transparent 100%);
        transition: left .6s cubic-bezier(.4, 0, .2, 1);
        pointer-events: none;
      }
      .btn-guardar-shine:hover {
        transform: translateY(-1px);
        box-shadow: 0 16px 32px rgba(15,118,110,.38);
      }
      .btn-guardar-shine:hover::before {
        left: 130%;
      }
      .btn-guardar-shine:disabled {
        opacity: .7;
        cursor: progress;
      }

      input:focus {
        border-color: ${TEAL_LIGHT} !important;
        box-shadow: 0 0 0 3px rgba(37,183,189,0.18);
      }

      @media (max-width: 900px) {
        [data-portal-grid] {
          grid-template-columns: 1fr !important;
          gap: 28px !important;
        }
        [data-portal-footer] {
          justify-content: center;
          gap: 10px !important;
          text-align: center;
        }
      }

      @media (max-width: 640px) {
        [data-portal-header] { padding: 12px 16px !important; }
        [data-portal-main] { padding: 18px 14px 44px !important; }
      }

      a[data-social]:hover {
        transform: translateY(-2px);
        box-shadow: 0 8px 16px rgba(15,118,110,0.18) !important;
      }

      /* ── Orbes decorativos flotantes ───────────────────────────── */
      /* Los orbes se colocan a propósito fuera de la rejilla (right: -100px);
         sin recortar aquí ensanchaban la página y el portal se desplazaba
         de lado en cualquier pantalla. */
      [data-portal-grid] { position: relative; overflow: hidden; }
      .login-orb {
        position: absolute;
        border-radius: 50%;
        pointer-events: none;
        filter: blur(60px);
        z-index: 0;
      }
      .login-orb-a {
        top: -80px;
        right: -100px;
        width: 380px;
        height: 380px;
        background: radial-gradient(circle, rgba(37,183,189,.85) 0%, rgba(37,183,189,.10) 60%, transparent 80%);
        animation: orbFloatA 14s ease-in-out infinite;
      }
      .login-orb-b {
        bottom: -120px;
        left: -80px;
        width: 340px;
        height: 340px;
        background: radial-gradient(circle, rgba(45,212,191,.70) 0%, rgba(45,212,191,.10) 60%, transparent 80%);
        animation: orbFloatB 18s ease-in-out infinite;
      }
      .login-orb-c {
        top: 35%;
        left: 38%;
        width: 240px;
        height: 240px;
        background: radial-gradient(circle, rgba(15,118,110,.50) 0%, rgba(15,118,110,.06) 60%, transparent 80%);
        animation: orbPulse 8s ease-in-out infinite;
      }
      @keyframes orbFloatA {
        0%, 100% { transform: translate(0, 0) scale(1); }
        50%      { transform: translate(-30px, 30px) scale(1.08); }
      }
      @keyframes orbFloatB {
        0%, 100% { transform: translate(0, 0) scale(1); }
        50%      { transform: translate(40px, -20px) scale(1.12); }
      }
      @keyframes orbPulse {
        0%, 100% { transform: scale(1); opacity: .25; }
        50%      { transform: scale(1.18); opacity: .45; }
      }

      /* Aseguramos que el contenido quede por encima de los orbes */
      .login-orb ~ section { position: relative; z-index: 1; }

      /* ── Feature items: aparecen en cascada y hacen lift al hover ── */
      .feature-item {
        opacity: 0;
        transform: translateX(-12px);
        animation: featureSlideIn .55s cubic-bezier(.4, 0, .2, 1) forwards;
        transition: transform .25s ease;
        /* El margen negativo hacía que el área de hover sobresaliera 4px de la
           lista y dejaba a la página desbordada de forma permanente. Con solo
           el relleno el resaltado se ve igual y nada se sale. */
        padding: 4px;
        border-radius: 10px;
      }
      .feature-item:hover {
        transform: translateX(4px);
      }
      @keyframes featureSlideIn {
        from { opacity: 0; transform: translateX(-12px); }
        to   { opacity: 1; transform: translateX(0); }
      }

      /* ── Chip y caja de ayuda: aparecen con leve delay ── */
      .anim-chip {
        animation: chipPop .5s cubic-bezier(.4, 0, .2, 1);
      }
      @keyframes chipPop {
        from { opacity: 0; transform: scale(.92); }
        to   { opacity: 1; transform: scale(1); }
      }
      .anim-ayuda {
        opacity: 0;
        animation: fadeUp .5s cubic-bezier(.4, 0, .2, 1) forwards;
        animation-delay: 400ms;
      }
      @keyframes fadeUp {
        from { opacity: 0; transform: translateY(8px); }
        to   { opacity: 1; transform: translateY(0); }
      }

      /* ── Card del login: flotación sutil + entrada con bounce ── */
      .login-card-float {
        animation: cardEnter .65s cubic-bezier(.34, 1.56, .64, 1),
                   cardFloat 6s ease-in-out 1s infinite;
      }
      @keyframes cardEnter {
        from { opacity: 0; transform: translateY(20px) scale(.96); }
        to   { opacity: 1; transform: translateY(0) scale(1); }
      }
      @keyframes cardFloat {
        0%, 100% { transform: translateY(0); }
        50%      { transform: translateY(-6px); }
      }

      /* ── Brand (logo arriba del login): fade-down al cargar ── */
      .anim-brand {
        animation: brandFadeDown .55s cubic-bezier(.4, 0, .2, 1);
      }
      @keyframes brandFadeDown {
        from { opacity: 0; transform: translateY(-12px); }
        to   { opacity: 1; transform: translateY(0); }
      }

      /* ── Icono del candado: pop al cargar ── */
      .anim-icon-pop {
        animation: iconPop .7s cubic-bezier(.34, 1.56, .64, 1) .3s both;
      }
      @keyframes iconPop {
        from { opacity: 0; transform: scale(.4) rotate(-15deg); }
        to   { opacity: 1; transform: scale(1) rotate(0); }
      }

      /* ── Shine sobre "al día" ──
         El stop "highlight" del medio usa un cian luminoso (no blanco) para
         que nunca se confunda con el fondo claro y el texto siga siendo
         legible mientras la onda pasa. */
      .hero-shine {
        display: inline-block;
        background: linear-gradient(
          110deg,
          ${TEAL} 0%,
          ${TEAL_LIGHT} 30%,
          #5eead4 50%,
          ${TEAL_LIGHT} 70%,
          ${TEAL} 100%
        );
        background-size: 220% 100%;
        background-clip: text;
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        color: ${TEAL};
        animation: heroShine 5s linear infinite;
      }
      @keyframes heroShine {
        0%   { background-position: 200% 0; }
        100% { background-position: -100% 0; }
      }


      .anim-toast {
        animation: toastSlideIn .35s cubic-bezier(.4, 0, .2, 1);
      }
      @keyframes toastSlideIn {
        from { opacity: 0; transform: translateY(20px) scale(.96); }
        to   { opacity: 1; transform: translateY(0) scale(1); }
      }
    `}</style>
  );
}
