import { useCallback, useEffect, useRef, useState } from "react";
import {
  Truck,
  LogOut,
  MapPin,
  Navigation,
  CheckCircle2,
  XCircle,
  Loader2,
  Eye,
  EyeOff,
  KeyRound,
  AlertTriangle,
  Radio,
  Package,
  Camera,
} from "lucide-react";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3001/api";
const TOKEN_KEY = "portal_chofer_token";
const CHOFER_KEY = "portal_chofer_data";
const TEAL = "#1e9295";
const TEAL_LIGHT = "#28aeb1";
const LOGO = "https://amsodentmedical.cl/wp-content/uploads/2025/12/Amsodent-1.png";
// Precisión máxima aceptable (metros). Por encima descartamos la lectura para
// no plotear posiciones de WiFi/IP (cientos de metros). GPS de celular ~5-30m.
const PRECISION_MAX_M = 150;

const ESTADO_COLOR = {
  Asignado: { c: "#1d4ed8", b: "#dbeafe" },
  "En ruta": { c: "#0d9488", b: "#ccfbf1" },
  Entregado: { c: "#15803d", b: "#dcfce7" },
  "No entregado": { c: "#b91c1c", b: "#fee2e2" },
  Cancelado: { c: "#64748b", b: "#f1f5f9" },
};

async function apiRequest(path, options = {}) {
  const token = localStorage.getItem(TOKEN_KEY) || "";
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${API_URL}${path}`, { ...options, headers });
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = null; }
  if (!res.ok) {
    const err = new Error((body && (body.message || body.error)) || `Error ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return body;
}

// Subida multipart (FormData): NO fijamos Content-Type para que el navegador
// agregue el boundary correcto.
async function apiUpload(path, formData) {
  const token = localStorage.getItem(TOKEN_KEY) || "";
  const headers = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${API_URL}${path}`, { method: "POST", body: formData, headers });
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = null; }
  if (!res.ok) {
    const err = new Error((body && (body.message || body.error)) || `Error ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return body;
}

function fmtPrecision(m) {
  if (m == null) return "";
  return m >= 1000 ? `${(m / 1000).toFixed(m >= 10000 ? 0 : 1)} km` : `${m} m`;
}

// ── Navegación al destino del viaje ─────────────────────────────────────
function destinoTexto(v) {
  return [v?.destino_direccion, v?.destino_comuna].filter(Boolean).join(", ");
}
function tieneCoords(v) {
  return v?.destino_lat != null && v?.destino_lng != null;
}
function tieneDestino(v) {
  return tieneCoords(v) || destinoTexto(v).length > 0;
}
// Google Maps: abre direcciones hacia el destino (coords si existen, si no la dirección).
function urlGoogleMaps(v) {
  const dest = tieneCoords(v) ? `${v.destino_lat},${v.destino_lng}` : destinoTexto(v);
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(dest)}`;
}
// Waze: navega al destino.
function urlWaze(v) {
  if (tieneCoords(v)) return `https://waze.com/ul?ll=${v.destino_lat},${v.destino_lng}&navigate=yes`;
  return `https://waze.com/ul?q=${encodeURIComponent(destinoTexto(v))}&navigate=yes`;
}

function formatearRutVisual(v) {
  const limpio = String(v || "").replace(/[^0-9kK]/g, "").toLowerCase();
  if (!limpio) return "";
  const cuerpo = limpio.slice(0, -1);
  const dv = limpio.slice(-1).toUpperCase();
  const conPuntos = cuerpo.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return cuerpo ? `${conPuntos}-${dv}` : dv;
}

export default function PortalChofer() {
  const [paso, setPaso] = useState(() => (localStorage.getItem(TOKEN_KEY) ? "portal" : "login"));
  const [chofer, setChofer] = useState(() => {
    try { return JSON.parse(localStorage.getItem(CHOFER_KEY) || "null"); } catch { return null; }
  });

  function cerrarSesion() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(CHOFER_KEY);
    setChofer(null);
    setPaso("login");
  }

  function onLogin(token, ch) {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(CHOFER_KEY, JSON.stringify(ch));
    setChofer(ch);
    setPaso(ch.debe_cambiar_clave ? "cambiar_clave" : "portal");
  }

  if (paso === "login") return <Login onLogin={onLogin} />;
  if (paso === "cambiar_clave") return <CambiarClave onListo={() => setPaso("portal")} onSalir={cerrarSesion} />;
  return <Portal chofer={chofer} onSalir={cerrarSesion} />;
}

/* ── Login ──────────────────────────────────────────────────────────── */
function Login({ onLogin }) {
  const [rut, setRut] = useState("");
  const [password, setPassword] = useState("");
  const [verClave, setVerClave] = useState(false);
  const [error, setError] = useState("");
  const [cargando, setCargando] = useState(false);
  const [recuperar, setRecuperar] = useState(false);

  async function entrar(e) {
    e.preventDefault();
    setError(""); setCargando(true);
    try {
      const r = await apiRequest("/choferes/login", { method: "POST", body: JSON.stringify({ rut, password }) });
      onLogin(r.token, r.chofer);
    } catch (e2) {
      setError(e2?.message || "No se pudo iniciar sesión.");
    } finally {
      setCargando(false);
    }
  }

  if (recuperar) return <Recuperar onVolver={() => setRecuperar(false)} />;

  return (
    <Shell>
      <Marca />
      <form onSubmit={entrar} className="chofer-fade" style={card}>
        <h2 style={{ margin: "0 0 4px", fontSize: 20, fontWeight: 800, color: "#0f172a" }}>Bienvenido</h2>
        <p style={{ margin: "0 0 18px", fontSize: 13.5, color: "#64748b" }}>Ingresa con tu RUT y clave para ver tus viajes.</p>
        <Label>RUT
          <input style={input} value={formatearRutVisual(rut)} onChange={(e) => setRut(e.target.value)} placeholder="12.345.678-9" inputMode="text" />
        </Label>
        <Label>Contraseña
          <div style={{ position: "relative" }}>
            <input style={{ ...input, paddingRight: 44 }} type={verClave ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Su contraseña" />
            <button type="button" onClick={() => setVerClave((v) => !v)} style={ojo} tabIndex={-1}>{verClave ? <EyeOff size={16} /> : <Eye size={16} />}</button>
          </div>
        </Label>
        {error && <ErrorBox>{error}</ErrorBox>}
        <button type="submit" style={btnPrim} disabled={cargando}>
          {cargando ? <Loader2 size={16} style={spin} /> : null} {cargando ? "Ingresando…" : "Ingresar"}
        </button>
        <button type="button" onClick={() => setRecuperar(true)} style={linkBtn}>¿Olvidó su contraseña?</button>
      </form>
    </Shell>
  );
}

/* ── Recuperar clave ────────────────────────────────────────────────── */
function Recuperar({ onVolver }) {
  const [rut, setRut] = useState("");
  const [email, setEmail] = useState("");
  const [telefono, setTelefono] = useState("");
  const [mensaje, setMensaje] = useState("");
  const [error, setError] = useState("");
  const [enviado, setEnviado] = useState(false);
  const [cargando, setCargando] = useState(false);

  async function enviar(e) {
    e.preventDefault();
    setError(""); setCargando(true);
    try {
      await apiRequest("/choferes/recuperacion", {
        method: "POST",
        body: JSON.stringify({ rut, contacto_email: email, contacto_telefono: telefono, mensaje }),
      });
      setEnviado(true);
    } catch (e2) {
      setError(e2?.message || "No se pudo enviar la solicitud.");
    } finally {
      setCargando(false);
    }
  }

  return (
    <Shell>
      <Marca />
      <div className="chofer-fade" style={card}>
        {enviado ? (
          <>
            <CheckCircle2 size={40} style={{ color: "#15803d", margin: "0 auto 10px", display: "block" }} />
            <h2 style={{ margin: "0 0 6px", fontSize: 18, fontWeight: 800, textAlign: "center" }}>Solicitud enviada</h2>
            <p style={{ margin: "0 0 18px", fontSize: 13.5, color: "#64748b", textAlign: "center" }}>El equipo de Amsodent te contactará para restablecer tu clave.</p>
            <button type="button" onClick={onVolver} style={btnPrim}>Volver al inicio</button>
          </>
        ) : (
          <form onSubmit={enviar}>
            <h2 style={{ margin: "0 0 4px", fontSize: 18, fontWeight: 800 }}>Recuperar contraseña</h2>
            <p style={{ margin: "0 0 16px", fontSize: 13, color: "#64748b" }}>Déjanos tus datos y te ayudaremos a restablecer tu acceso.</p>
            <Label>RUT<input style={input} value={formatearRutVisual(rut)} onChange={(e) => setRut(e.target.value)} placeholder="12.345.678-9" /></Label>
            <Label>Correo<input style={input} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="correo@correo.cl" /></Label>
            <Label>Teléfono<input style={input} value={telefono} onChange={(e) => setTelefono(e.target.value)} placeholder="+56 9 ..." /></Label>
            <Label>Mensaje (opcional)<textarea style={{ ...input, minHeight: 60, resize: "vertical" }} value={mensaje} onChange={(e) => setMensaje(e.target.value)} /></Label>
            {error && <ErrorBox>{error}</ErrorBox>}
            <button type="submit" style={btnPrim} disabled={cargando}>{cargando ? "Enviando…" : "Enviar solicitud"}</button>
            <button type="button" onClick={onVolver} style={linkBtn}>Volver</button>
          </form>
        )}
      </div>
    </Shell>
  );
}

/* ── Cambio de clave obligatorio ────────────────────────────────────── */
function CambiarClave({ onListo, onSalir }) {
  const [p1, setP1] = useState("");
  const [p2, setP2] = useState("");
  const [error, setError] = useState("");
  const [cargando, setCargando] = useState(false);

  async function guardar(e) {
    e.preventDefault();
    if (p1.length < 6) { setError("La clave debe tener al menos 6 caracteres."); return; }
    if (p1 !== p2) { setError("Las claves no coinciden."); return; }
    setError(""); setCargando(true);
    try {
      await apiRequest("/choferes/cambiar-clave", { method: "POST", body: JSON.stringify({ password_nueva: p1 }) });
      const ch = JSON.parse(localStorage.getItem(CHOFER_KEY) || "{}");
      localStorage.setItem(CHOFER_KEY, JSON.stringify({ ...ch, debe_cambiar_clave: false }));
      onListo();
    } catch (e2) {
      setError(e2?.message || "No se pudo cambiar la clave.");
    } finally {
      setCargando(false);
    }
  }

  return (
    <Shell>
      <Marca />
      <form onSubmit={guardar} className="chofer-fade" style={card}>
        <h2 style={{ margin: "0 0 4px", fontSize: 18, fontWeight: 800 }}>Crea tu nueva contraseña</h2>
        <p style={{ margin: "0 0 16px", fontSize: 13, color: "#64748b" }}>Por seguridad, define una clave propia antes de continuar.</p>
        <Label>Nueva contraseña<input style={input} type="password" value={p1} onChange={(e) => setP1(e.target.value)} /></Label>
        <Label>Repite la contraseña<input style={input} type="password" value={p2} onChange={(e) => setP2(e.target.value)} /></Label>
        {error && <ErrorBox>{error}</ErrorBox>}
        <button type="submit" style={btnPrim} disabled={cargando}>{cargando ? "Guardando…" : "Guardar y continuar"}</button>
        <button type="button" onClick={onSalir} style={linkBtn}>Cerrar sesión</button>
      </form>
    </Shell>
  );
}

/* ── Portal (viajes + GPS) ──────────────────────────────────────────── */
function Portal({ chofer, onSalir }) {
  const [viajes, setViajes] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [aviso, setAviso] = useState("");
  const [compartiendo, setCompartiendo] = useState(false);
  const [gpsError, setGpsError] = useState("");
  const [precision, setPrecision] = useState(null); // metros de la última lectura aceptada
  const [subiendoId, setSubiendoId] = useState(null); // viaje cuya foto se está subiendo

  const lastPosRef = useRef(null);
  const wakeLockRef = useRef(null);
  const viajeActivoRef = useRef(null);

  const cargar = useCallback(async () => {
    try {
      const r = await apiRequest("/choferes/mis-viajes");
      const lista = Array.isArray(r) ? r : [];
      setViajes(lista);
      const activo = lista.find((v) => v.estado === "En ruta") || lista.find((v) => v.estado === "Asignado");
      viajeActivoRef.current = activo?.id || null;
    } catch (e) {
      if (e?.status === 401) { onSalir(); return; }
      setAviso(e?.message || "No se pudieron cargar tus viajes.");
    } finally {
      setCargando(false);
    }
  }, [onSalir]);

  useEffect(() => { cargar(); }, [cargar]);

  const enviarPosicion = useCallback(async (pos) => {
    if (!pos) return;
    const { latitude, longitude, accuracy, speed, heading } = pos.coords;
    try {
      await apiRequest("/choferes/posicion", {
        method: "POST",
        body: JSON.stringify({
          lat: latitude, lng: longitude,
          precision_m: accuracy ?? null,
          velocidad: speed ?? null,
          rumbo: heading ?? null,
          viaje_id: viajeActivoRef.current,
        }),
      });
    } catch { /* reintenta en el próximo ciclo */ }
  }, []);

  // Procesa una lectura GPS: muestra la precisión y siempre envía la mejor
  // ubicación disponible. Si la precisión es mala (típico de WiFi/IP en desktop,
  // ~decenas de km) la marcamos como "aproximada", pero NO la bloqueamos: en el
  // celular del chofer el GPS da una lectura exacta.
  const aceptarFix = useCallback((pos) => {
    const acc = pos?.coords?.accuracy;
    setPrecision(acc != null ? Math.round(acc) : null);
    lastPosRef.current = pos;
    setGpsError("");
    enviarPosicion(pos);
    return true;
  }, [enviarPosicion]);

  const manejarErrorGeo = useCallback((err) => {
    if (err?.code === 1) setGpsError("Permiso de ubicación denegado. Permítelo desde el ícono de candado/ubicación del navegador y vuelve a intentar.");
    else if (err?.code === 2) setGpsError("No pudimos obtener tu ubicación. Enciende el GPS/ubicación del dispositivo e inténtalo de nuevo.");
    else if (err?.code === 3) setGpsError("La ubicación tardó demasiado en responder. Intenta nuevamente.");
    else setGpsError("No se pudo acceder a la ubicación.");
  }, []);

  // Activa/desactiva la ubicación. El primer pedido de permiso se dispara DENTRO
  // del gesto del usuario: si la llamada ocurre en un efecto diferido, varios
  // navegadores (sobre todo iOS) no muestran el popup de permiso.
  function toggleUbicacion() {
    if (compartiendo) { setCompartiendo(false); return; }
    if (!("geolocation" in navigator)) {
      setGpsError("Tu dispositivo no permite geolocalización.");
      return;
    }
    if (typeof window !== "undefined" && window.isSecureContext === false) {
      setGpsError("La ubicación requiere una conexión segura (HTTPS). Abre el portal con https:// o desde localhost (no por IP en http).");
      return;
    }
    setGpsError("Solicitando permiso de ubicación…");
    navigator.geolocation.getCurrentPosition(
      (pos) => { setCompartiendo(true); aceptarFix(pos); },
      (err) => { manejarErrorGeo(err); },
      { enableHighAccuracy: true, timeout: 27000, maximumAge: 0 },
    );
  }

  // Ciclo de vida del tracking atado SOLO a `compartiendo`: al activarse monta
  // watchPosition + envío periódico + wake lock; al desactivarse (o al salir)
  // se limpia. Así nunca se "apaga solo" por un re-render o re-montaje.
  useEffect(() => {
    if (!compartiendo) return undefined;
    if (!("geolocation" in navigator)) {
      setGpsError("Tu dispositivo no permite geolocalización.");
      setCompartiendo(false);
      return undefined;
    }
    setGpsError("");

    // Mismo enfoque que seven-backend: watchPosition (dispara en cada cambio)
    // + sondeo cada 5s como respaldo. enableHighAccuracy fuerza el GPS en celular.
    const opts = { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 };
    const watchId = navigator.geolocation.watchPosition((pos) => aceptarFix(pos), manejarErrorGeo, opts);
    const intervalId = setInterval(() => {
      navigator.geolocation.getCurrentPosition((p) => aceptarFix(p), () => {}, opts);
    }, 5000);

    // Wake lock (que la pantalla no se bloquee mientras conduce).
    let cancelado = false;
    navigator.wakeLock
      ?.request("screen")
      .then((wl) => { if (cancelado) { try { wl.release(); } catch { /* */ } } else wakeLockRef.current = wl; })
      .catch(() => {});

    return () => {
      cancelado = true;
      navigator.geolocation.clearWatch(watchId);
      clearInterval(intervalId);
      try { wakeLockRef.current?.release(); } catch { /* */ }
      wakeLockRef.current = null;
      // Avisar al backend que dejamos de compartir → el mapa pasa a "desconectado".
      apiRequest("/choferes/presencia/detener", { method: "POST" }).catch(() => {});
    };
  }, [compartiendo, enviarPosicion, manejarErrorGeo, aceptarFix]);

  // Re-adquiere el wake lock al volver a primer plano.
  useEffect(() => {
    function onVis() {
      if (document.visibilityState === "visible" && compartiendo && !wakeLockRef.current) {
        navigator.wakeLock?.request("screen").then((wl) => { wakeLockRef.current = wl; }).catch(() => {});
      }
    }
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [compartiendo]);

  // Auto-activa el envío de ubicación cuando hay un viaje en ruta.
  useEffect(() => {
    if (viajes.some((v) => v.estado === "En ruta")) setCompartiendo(true);
  }, [viajes]);

  async function cambiarEstado(viaje, estado) {
    const pos = lastPosRef.current;
    try {
      await apiRequest(`/choferes/mis-viajes/${viaje.id}/estado`, {
        method: "PUT",
        body: JSON.stringify({
          estado,
          lat: pos?.coords?.latitude ?? null,
          lng: pos?.coords?.longitude ?? null,
        }),
      });
      cargar();
    } catch (e) {
      setAviso(e?.message || "No se pudo actualizar el viaje.");
    }
  }

  // El chofer sube una foto del despacho (respaldo de entrega).
  async function subirFoto(viaje, file) {
    if (!file) return;
    if (!String(file.type || "").startsWith("image/")) {
      setAviso("El archivo debe ser una imagen.");
      return;
    }
    setSubiendoId(viaje.id);
    setAviso("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      await apiUpload(`/choferes/mis-viajes/${viaje.id}/foto`, fd);
      await cargar();
    } catch (e) {
      setAviso(e?.message || "No se pudo subir la foto.");
    } finally {
      setSubiendoId(null);
    }
  }

  const activos = viajes.filter((v) => v.estado === "Asignado" || v.estado === "En ruta");
  const cerrados = viajes.filter((v) => v.estado !== "Asignado" && v.estado !== "En ruta");
  const porIniciar = viajes.filter((v) => v.estado === "Asignado").length;
  const enRuta = viajes.filter((v) => v.estado === "En ruta").length;
  const entregados = viajes.filter((v) => v.estado === "Entregado").length;
  const resumen = [
    { n: porIniciar, l: "Por iniciar", c: "#1d4ed8" },
    { n: enRuta, l: "En ruta", c: "#0d9488" },
    { n: entregados, l: "Entregados", c: "#15803d" },
  ];

  return (
    <div style={{ minHeight: "100vh", background: "#f1f5f9" }}>
      <Estilos />
      <header style={{ position: "relative", overflow: "hidden", background: `linear-gradient(135deg, ${TEAL} 0%, ${TEAL_LIGHT} 100%)`, color: "#fff", padding: "16px 18px 32px" }}>
        <div aria-hidden style={{ position: "absolute", top: -70, right: -50, width: 200, height: 200, borderRadius: "50%", background: "rgba(255,255,255,.12)", pointerEvents: "none" }} />
        <div aria-hidden style={{ position: "absolute", bottom: -90, left: -40, width: 200, height: 200, borderRadius: "50%", background: "rgba(255,255,255,.08)", pointerEvents: "none" }} />
        <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ background: "#fff", borderRadius: 11, padding: "7px 12px", display: "inline-flex", alignItems: "center", boxShadow: "0 6px 14px rgba(15,23,42,.16)" }}>
              <img src={LOGO} alt="Amsodent Medical" style={{ height: 22, width: "auto", display: "block" }} />
            </span>
            <div>
              <div style={{ fontWeight: 800, fontSize: 15 }}>Portal de Despachos</div>
              <div style={{ fontSize: 12, opacity: 0.92 }}>{chofer?.nombre}</div>
            </div>
          </div>
          <button onClick={onSalir} className="chofer-btn" style={{ background: "rgba(255,255,255,.18)", border: "none", color: "#fff", borderRadius: 10, padding: "8px 12px", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6, fontWeight: 600, fontSize: 13 }}>
            <LogOut size={15} /> Salir
          </button>
        </div>
      </header>

      <div style={{ maxWidth: 640, margin: "0 auto", padding: "0 14px 40px" }}>
        {/* Resumen (se solapa sobre el header) */}
        <div className="chofer-fade" style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10, marginTop: -20, marginBottom: 14 }}>
          {resumen.map((r) => (
            <div key={r.l} className="chofer-card" style={{ background: "#fff", borderRadius: 14, padding: "12px 10px", textAlign: "center", border: "1px solid #e2e8f0", boxShadow: "0 8px 20px rgba(15,23,42,.06)" }}>
              <div style={{ fontSize: 24, fontWeight: 800, color: r.c, lineHeight: 1 }}>{r.n}</div>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: ".04em", marginTop: 4 }}>{r.l}</div>
            </div>
          ))}
        </div>

        {/* Barra de ubicación */}
        <div className="chofer-card" style={{ background: compartiendo ? "linear-gradient(135deg, #ecfdf5, #f0fdfa)" : "#fff", borderRadius: 14, padding: "12px 14px", marginBottom: 14, border: `1px solid ${compartiendo ? "#a7f3d0" : "#e2e8f0"}`, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
            <span style={{ position: "relative", width: 38, height: 38, borderRadius: 10, display: "inline-flex", alignItems: "center", justifyContent: "center", background: compartiendo ? "#dcfce7" : "#f1f5f9", color: compartiendo ? "#15803d" : "#64748b" }}>
              {compartiendo && <span aria-hidden style={{ position: "absolute", inset: 0, borderRadius: 10, border: "2px solid #15803d", animation: "chofer-pulse 1.8s ease-out infinite" }} />}
              <Radio size={18} />
            </span>
            <div>
              <div style={{ fontWeight: 700, fontSize: 13.5, color: "#0f172a" }}>{compartiendo ? "Compartiendo ubicación" : "Ubicación detenida"}</div>
              <div style={{ fontSize: 12, color: precision != null && precision > PRECISION_MAX_M ? "#b45309" : "#64748b" }}>
                {compartiendo
                  ? precision != null
                    ? `Enviando tu posición · precisión ±${fmtPrecision(precision)}${precision > PRECISION_MAX_M ? " (usa un celular con GPS para mayor exactitud)" : ""}`
                    : "Obteniendo tu ubicación…"
                  : "Actívala para que puedan rastrear tu despacho."}
              </div>
            </div>
          </div>
          <button onClick={toggleUbicacion} className="chofer-btn" style={{ ...btnSmall, background: compartiendo ? "#fee2e2" : `linear-gradient(135deg, ${TEAL}, ${TEAL_LIGHT})`, color: compartiendo ? "#b91c1c" : "#fff" }}>
            {compartiendo ? "Detener" : "Activar"}
          </button>
        </div>
        {gpsError && <div style={{ ...errBox, marginBottom: 14, display: "flex", gap: 8, alignItems: "center" }}><AlertTriangle size={16} /> {gpsError}</div>}
        {aviso && <div style={{ ...errBox, marginBottom: 14 }}>{aviso}</div>}

        {cargando ? (
          <p style={{ textAlign: "center", color: "#64748b" }}>Cargando tus viajes…</p>
        ) : (
          <>
            <SeccionViajes titulo="Viajes activos" viajes={activos} onCambiar={cambiarEstado} onSubirFoto={subirFoto} subiendoId={subiendoId} vacio="No tienes viajes pendientes." />
            {cerrados.length > 0 && <SeccionViajes titulo="Historial reciente" viajes={cerrados} onCambiar={cambiarEstado} onSubirFoto={subirFoto} subiendoId={subiendoId} soloLectura />}
          </>
        )}
      </div>
    </div>
  );
}

function SeccionViajes({ titulo, viajes, onCambiar, onSubirFoto, subiendoId, soloLectura, vacio }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <h3 style={{ fontSize: 12, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".05em", color: "#94a3b8", margin: "0 0 8px" }}>{titulo}</h3>
      {viajes.length === 0 ? (
        <div style={{ background: "#fff", borderRadius: 12, padding: 20, textAlign: "center", color: "#94a3b8", fontSize: 13, border: "1px solid #e2e8f0" }}>{vacio || "Sin registros."}</div>
      ) : viajes.map((v) => {
        const col = ESTADO_COLOR[v.estado] || ESTADO_COLOR.Asignado;
        return (
          <div key={v.id} className="chofer-card chofer-fade" style={{ background: "#fff", borderRadius: 12, padding: 14, marginBottom: 10, border: "1px solid #e2e8f0", borderLeft: `4px solid ${col.c}` }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
              <div>
                {v.numero_amso && <div style={{ fontWeight: 800, color: TEAL, fontSize: 15 }}>{v.numero_amso}</div>}
                <div style={{ fontWeight: 600, color: "#0f172a", fontSize: 14 }}>{v.titulo || "Viaje"}</div>
              </div>
              <span style={{ fontSize: 11.5, fontWeight: 700, padding: "3px 10px", borderRadius: 999, color: col.c, background: col.b }}>{v.estado}</span>
            </div>
            {/* Destino + cómo llegar */}
            <div style={{ marginTop: 10, background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 10, padding: "10px 12px" }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                <MapPin size={16} style={{ color: TEAL, flexShrink: 0, marginTop: 1 }} />
                <div style={{ lineHeight: 1.35 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#0f172a" }}>
                    {v.destino_direccion || (tieneCoords(v) ? "Ubicación de destino" : "Sin dirección registrada")}
                  </div>
                  {v.destino_comuna && <div style={{ fontSize: 12.5, color: "#64748b" }}>{v.destino_comuna}</div>}
                </div>
              </div>
              {tieneDestino(v) && (
                <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                  <a href={urlGoogleMaps(v)} target="_blank" rel="noreferrer" className="chofer-btn" style={{ ...btnSmall, flex: 1, justifyContent: "center", background: "#fff", color: TEAL, border: `1.5px solid ${TEAL}40`, textDecoration: "none" }}>
                    <MapPin size={14} /> Google Maps
                  </a>
                  <a href={urlWaze(v)} target="_blank" rel="noreferrer" className="chofer-btn" style={{ ...btnSmall, flex: 1, justifyContent: "center", background: "#33ccff", color: "#06283d", textDecoration: "none" }}>
                    <Navigation size={14} /> Waze
                  </a>
                </div>
              )}
            </div>
            {(v.bultos || v.detalle_carga) && (
              <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 13, color: "#0f172a", marginTop: 8, background: "#f0fdfa", border: "1px solid #ccfbf1", borderRadius: 8, padding: "8px 10px", fontWeight: 600 }}>
                <Package size={15} style={{ color: TEAL, flexShrink: 0 }} />
                <span>{v.bultos ? `${v.bultos} ${v.bultos === 1 ? "caja" : "cajas"}` : "Carga"}{v.detalle_carga ? ` · ${v.detalle_carga}` : ""}</span>
              </div>
            )}
            {v.receptor_nombre && <div style={{ fontSize: 12.5, color: "#64748b", marginTop: 4 }}>Recibe: {v.receptor_nombre}</div>}
            {v.notas && <div style={{ fontSize: 12.5, color: "#64748b", marginTop: 4, background: "#f8fafc", borderRadius: 8, padding: "6px 10px" }}>{v.notas}</div>}

            {/* Fotos del despacho */}
            {((v.fotos?.length || 0) > 0 || !soloLectura) && (
              <div style={{ marginTop: 10 }}>
                <div style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".04em", color: "#94a3b8", marginBottom: 6, display: "flex", alignItems: "center", gap: 6 }}>
                  <Camera size={13} /> Foto del despacho
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {(v.fotos || []).map((f) => (
                    <a key={f.id} href={f.url} target="_blank" rel="noreferrer" title={f.nombre || "Foto"} style={{ display: "block", width: 64, height: 64, borderRadius: 10, overflow: "hidden", border: "1px solid #e2e8f0" }}>
                      <img src={f.url} alt={f.nombre || "Foto del despacho"} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                    </a>
                  ))}
                  {!soloLectura && (
                    <label className="chofer-btn" style={{ width: 64, height: 64, borderRadius: 10, border: "1.5px dashed #cbd5e1", display: "inline-flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2, cursor: subiendoId === v.id ? "default" : "pointer", color: TEAL, background: "#f8fafc", fontSize: 10, fontWeight: 800, textAlign: "center" }}>
                      {subiendoId === v.id ? (
                        <Loader2 size={18} className="chofer-spin" />
                      ) : (
                        <><Camera size={18} /><span>Agregar</span></>
                      )}
                      <input
                        type="file"
                        accept="image/*"
                        capture="environment"
                        style={{ display: "none" }}
                        disabled={subiendoId === v.id}
                        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; onSubirFoto?.(v, f); }}
                      />
                    </label>
                  )}
                </div>
                {!soloLectura && (v.fotos?.length || 0) === 0 && (
                  <div style={{ fontSize: 11.5, color: "#b45309", marginTop: 6 }}>
                    Sube una foto del despacho para poder marcarlo como entregado.
                  </div>
                )}
              </div>
            )}

            {!soloLectura && (
              <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                {v.estado === "Asignado" && (
                  <button onClick={() => onCambiar(v, "En ruta")} className="chofer-btn" style={{ ...btnSmall, background: `linear-gradient(135deg, ${TEAL}, ${TEAL_LIGHT})`, color: "#fff" }}>
                    <Navigation size={14} /> Iniciar ruta
                  </button>
                )}
                {(v.estado === "Asignado" || v.estado === "En ruta") && (
                  <>
                    <button
                      onClick={() => onCambiar(v, "Entregado")}
                      disabled={(v.fotos?.length || 0) === 0}
                      className="chofer-btn"
                      title={(v.fotos?.length || 0) === 0 ? "Sube una foto del despacho primero" : "Marcar como entregado"}
                      style={{ ...btnSmall, background: "#dcfce7", color: "#15803d", opacity: (v.fotos?.length || 0) === 0 ? 0.5 : 1, cursor: (v.fotos?.length || 0) === 0 ? "not-allowed" : "pointer" }}
                    >
                      <CheckCircle2 size={14} /> Entregado
                    </button>
                    <button onClick={() => onCambiar(v, "No entregado")} className="chofer-btn" style={{ ...btnSmall, background: "#fee2e2", color: "#b91c1c" }}>
                      <XCircle size={14} /> No entregado
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ── UI helpers ─────────────────────────────────────────────────────── */
function Shell({ children }) {
  return (
    <div style={{ position: "relative", minHeight: "100vh", background: "linear-gradient(160deg, #e8f7f7 0%, #f1f5f9 55%, #eef2f6 100%)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 18, overflow: "hidden" }}>
      <Estilos />
      {/* Orbes decorativos suaves */}
      <div aria-hidden style={{ position: "absolute", top: -120, right: -80, width: 320, height: 320, borderRadius: "50%", background: "radial-gradient(circle, rgba(40,174,177,.18) 0%, transparent 70%)", pointerEvents: "none" }} />
      <div aria-hidden style={{ position: "absolute", bottom: -140, left: -100, width: 360, height: 360, borderRadius: "50%", background: "radial-gradient(circle, rgba(30,146,149,.14) 0%, transparent 70%)", pointerEvents: "none" }} />
      <div style={{ width: "100%", maxWidth: 400, position: "relative", zIndex: 1 }}>{children}</div>
    </div>
  );
}
function Marca() {
  return (
    <div style={{ textAlign: "center", marginBottom: 20 }}>
      <img src={LOGO} alt="Amsodent Medical" style={{ width: 188, maxWidth: "66%", height: "auto", display: "inline-block" }} />
      <div style={{ marginTop: 12 }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "#fff", border: "1px solid #d4ecec", color: TEAL, fontSize: 11, fontWeight: 800, letterSpacing: ".09em", textTransform: "uppercase", padding: "5px 13px", borderRadius: 999, boxShadow: "0 6px 16px rgba(30,146,149,.12)" }}>
          <Truck size={13} /> Portal de Despachos
        </span>
      </div>
    </div>
  );
}
function Label({ children }) {
  const [head, ...rest] = Array.isArray(children) ? children : [children];
  return (
    <label style={{ display: "block", fontSize: 12.5, fontWeight: 600, color: "#64748b", marginBottom: 12 }}>
      <span style={{ display: "block", marginBottom: 4 }}>{head}</span>
      {rest}
    </label>
  );
}
function ErrorBox({ children }) { return <div style={{ ...errBox, marginBottom: 12 }}>{children}</div>; }

const card = { background: "#fff", borderRadius: 16, padding: "26px 24px", boxShadow: "0 24px 60px rgba(15,23,42,.12)" };
const input = { width: "100%", boxSizing: "border-box", padding: "11px 14px", border: "1.5px solid #e2e8f0", borderRadius: 10, fontSize: 14, color: "#0f172a", outline: "none" };
const btnPrim = { width: "100%", padding: "12px 16px", border: "none", borderRadius: 10, background: `linear-gradient(135deg, ${TEAL}, ${TEAL_LIGHT})`, color: "#fff", fontWeight: 700, fontSize: 14, cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6 };
const btnSmall = { border: "none", borderRadius: 9, padding: "9px 14px", fontWeight: 700, fontSize: 13, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6 };
const linkBtn = { width: "100%", background: "none", border: "none", color: TEAL, fontWeight: 600, fontSize: 13, cursor: "pointer", marginTop: 12, padding: 4 };
const ojo = { position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: "#94a3b8", cursor: "pointer", padding: 4 };
const errBox = { padding: "10px 12px", background: "#fee2e2", color: "#991b1b", border: "1px solid #fecaca", borderRadius: 8, fontSize: 13 };
const spin = { animation: "chofer-spin 1s linear infinite" };

// Keyframes y clases reutilizables (la página vive fuera del layout principal).
function Estilos() {
  return (
    <style>{`
      @keyframes chofer-spin { to { transform: rotate(360deg); } }
      @keyframes chofer-pulse { 0%,100% { transform: scale(1); opacity: .85; } 50% { transform: scale(2.1); opacity: 0; } }
      @keyframes chofer-fade { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
      .chofer-card { transition: transform .15s ease, box-shadow .15s ease; }
      .chofer-card:hover { transform: translateY(-2px); box-shadow: 0 12px 26px rgba(15,23,42,.10); }
      .chofer-fade { animation: chofer-fade .4s cubic-bezier(.4,0,.2,1) both; }
      .chofer-btn { transition: filter .15s ease, transform .1s ease; }
      .chofer-btn:hover { filter: brightness(1.05); }
      .chofer-btn:active { transform: scale(.97); }
    `}</style>
  );
}
