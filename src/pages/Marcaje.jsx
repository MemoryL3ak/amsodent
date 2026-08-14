import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import useAuth from "../hooks/useAuth";
import Toast from "../components/Toast";
import {
  Clock,
  MapPin,
  LogIn,
  LogOut,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  ShieldCheck,
} from "lucide-react";

// Paleta acorde a la plataforma
const TEAL = "#25b7bd";
const TEAL_OSC = "#178a8f";
const TEAL_DEEP = "#0e6e74";
const ROJO = "#dc2626";
const VERDE = "#16a34a";
const AMBAR = "#d97706";

function fmtHora(d) {
  return new Date(d).toLocaleTimeString("es-CL", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function fmtFechaLarga(d) {
  return new Date(d).toLocaleDateString("es-CL", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function fmtHoraCorta(d) {
  return new Date(d).toLocaleTimeString("es-CL", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function Marcaje() {
  const { user, perfil, cargando: cargandoAuth } = useAuth();

  const [reloj, setReloj] = useState(new Date());
  // Permiso de ubicación: granted | prompt | denied | desconocido | nosoporte.
  // Solo se consulta el ESTADO del permiso — el GPS no se enciende hasta el
  // instante del marcaje: la DT (Res. Ex. N° 38, Dictamen Ord. N° 2927/58)
  // prohíbe el seguimiento continuo durante la jornada.
  const [permisoGeo, setPermisoGeo] = useState("desconocido");

  const [tipoSiguiente, setTipoSiguiente] = useState("entrada"); // entrada | salida
  const [marcando, setMarcando] = useState(false);
  const [faseMarcaje, setFaseMarcaje] = useState(null); // null | ubicando | registrando
  const [exito, setExito] = useState(null); // marcaje recién creado
  const [toast, setToast] = useState(null);

  const [historial, setHistorial] = useState([]);

  // Reloj en vivo
  useEffect(() => {
    const t = setInterval(() => setReloj(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // Consultar el estado del permiso de ubicación (no activa el GPS).
  useEffect(() => {
    if (!("geolocation" in navigator)) {
      setPermisoGeo("nosoporte");
      return undefined;
    }
    let status = null;
    const onChange = () => setPermisoGeo(status?.state || "desconocido");
    if (navigator.permissions?.query) {
      navigator.permissions
        .query({ name: "geolocation" })
        .then((st) => {
          status = st;
          setPermisoGeo(st.state); // granted | prompt | denied
          st.addEventListener?.("change", onChange);
        })
        .catch(() => setPermisoGeo("desconocido"));
    }
    return () => status?.removeEventListener?.("change", onChange);
  }, []);

  // Cargar último marcaje del día para decidir si toca entrada o salida.
  async function cargarUltimo() {
    try {
      const res = await api.get("/marcajes/me/ultimo");
      const tipo = res?.tipo;
      setTipoSiguiente(tipo === "entrada" ? "salida" : "entrada");
    } catch (e) {
      console.error(e);
      setTipoSiguiente("entrada");
    }
  }

  async function cargarHistorial() {
    try {
      const desde = new Date();
      desde.setDate(desde.getDate() - 14);
      const desdeStr = desde.toISOString().slice(0, 10);
      const data = await api.get(`/marcajes/me?desde=${desdeStr}`);
      setHistorial(data || []);
    } catch (e) {
      console.error(e);
    }
  }

  useEffect(() => {
    if (cargandoAuth || !user) return;
    cargarUltimo();
    cargarHistorial();
  }, [cargandoAuth, user?.id]);

  // Captura puntual de coordenadas en el instante del marcaje. maximumAge: 0
  // exige una lectura fresca del GPS — nunca se reutiliza una posición previa.
  function obtenerUbicacionPuntual() {
    return new Promise((resolve, reject) => {
      if (!("geolocation" in navigator)) {
        reject(new Error("Este navegador no soporta geolocalización."));
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) =>
          resolve({
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
          }),
        (err) =>
          reject(
            new Error(
              err?.code === 1
                ? "Permiso de ubicación denegado. Habilítalo en el navegador para poder marcar."
                : "No se pudo obtener tu ubicación. Inténtalo de nuevo.",
            ),
          ),
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
      );
    });
  }

  async function marcar() {
    if (marcando) return;
    setMarcando(true);
    setFaseMarcaje("ubicando");
    setToast(null);
    try {
      const ubicacion = await obtenerUbicacionPuntual();
      setFaseMarcaje("registrando");
      const data = await api.post("/marcajes", {
        tipo: tipoSiguiente,
        latitud: ubicacion.lat,
        longitud: ubicacion.lng,
        accuracy_m: ubicacion.accuracy,
      });
      setExito(data);
      setToast({
        type: "success",
        message:
          tipoSiguiente === "entrada"
            ? "¡Buen día! Entrada registrada."
            : "Salida registrada. Hasta pronto.",
      });
      setTipoSiguiente(tipoSiguiente === "entrada" ? "salida" : "entrada");
      cargarHistorial();
      // El comprobante se cierra solo (o con un clic en el fondo).
      setTimeout(() => setExito(null), 7000);
    } catch (e) {
      console.error(e);
      setToast({
        type: "error",
        message: e?.message || "No se pudo registrar el marcaje.",
      });
    } finally {
      setMarcando(false);
      setFaseMarcaje(null);
    }
  }

  const nombre = perfil?.nombre || user?.email || "";
  const geoBloqueada = permisoGeo === "denied" || permisoGeo === "nosoporte";
  const esEntrada = tipoSiguiente === "entrada";
  const colorAccion = esEntrada ? VERDE : TEAL;
  const colorAccionOsc = esEntrada ? "#15803d" : TEAL_OSC;
  const TextoBoton = esEntrada ? "Marcar Entrada" : "Marcar Salida";
  const IconoBoton = esEntrada ? LogIn : LogOut;

  const saludo = useMemo(() => {
    const h = reloj.getHours();
    if (h < 6) return "Buena madrugada";
    if (h < 12) return "Buenos días";
    if (h < 19) return "Buenas tardes";
    return "Buenas noches";
  }, [reloj.getHours()]);

  if (cargandoAuth) {
    return (
      <div className="page" style={{ padding: 24 }}>
        <p>Cargando…</p>
      </div>
    );
  }

  return (
    <div
      style={{
        minHeight: "calc(100vh - 64px)",
        background:
          "radial-gradient(circle at 20% 0%, #e8f7f7 0%, transparent 50%), radial-gradient(circle at 80% 100%, #d4f0f1 0%, transparent 55%), #f8fafc",
        padding: "24px 16px",
        position: "relative",
      }}
    >
      <style>{ESTILOS_MARCAJE}</style>

      {toast && (
        <Toast
          type={toast.type}
          message={toast.message}
          onClose={() => setToast(null)}
        />
      )}

      {/* Overlay de éxito — comprobante del marcaje: además de la hora, deja a
          la vista la ubicación consignada, como exige la normativa de la DT. */}
      {exito && (
        <div className="mk-overlay" onClick={() => setExito(null)}>
          <div className="mk-success-card" onClick={(e) => e.stopPropagation()}>
            <div className="mk-check">
              <CheckCircle2 size={56} strokeWidth={2.5} />
            </div>
            <div style={{ fontSize: 22, fontWeight: 800, color: "#0f172a", marginTop: 14 }}>
              {exito.tipo === "entrada" ? "Entrada registrada" : "Salida registrada"}
            </div>
            <div style={{ fontSize: 14, color: "#64748b", marginTop: 4 }}>
              {fmtFechaLarga(exito.marcado_at || new Date())} ·{" "}
              {fmtHora(exito.marcado_at || new Date())}
            </div>
            {(exito.direccion || exito.latitud != null) && (
              <div
                style={{
                  marginTop: 12,
                  padding: "10px 14px",
                  borderRadius: 12,
                  background: "#f8fafc",
                  border: "1px solid #e2e8f0",
                  maxWidth: 340,
                  textAlign: "left",
                  display: "flex",
                  gap: 8,
                  alignItems: "flex-start",
                }}
              >
                <MapPin size={15} style={{ color: TEAL, flexShrink: 0, marginTop: 2 }} />
                <div style={{ minWidth: 0 }}>
                  {exito.direccion && (
                    <div style={{ fontSize: 13, fontWeight: 600, color: "#0f172a", lineHeight: 1.35, wordBreak: "break-word" }}>
                      {exito.direccion}
                    </div>
                  )}
                  {exito.latitud != null && exito.longitud != null && (
                    <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 3, fontFamily: "ui-monospace, SFMono-Regular, monospace" }}>
                      {Number(exito.latitud).toFixed(5)}, {Number(exito.longitud).toFixed(5)}
                      {exito.accuracy_m != null && <> · ±{Math.round(exito.accuracy_m)}m</>}
                      {exito.distancia_m != null && <> · a {exito.distancia_m}m de la oficina</>}
                    </div>
                  )}
                </div>
              </div>
            )}
            {exito.fuera_de_radio && (
              <div
                style={{
                  marginTop: 14,
                  padding: "8px 14px",
                  borderRadius: 999,
                  background: "#fef3c7",
                  color: "#92400e",
                  fontSize: 12.5,
                  fontWeight: 600,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <AlertTriangle size={13} /> Marcaje fuera del radio de la oficina
              </div>
            )}
          </div>
        </div>
      )}

      <div
        style={{
          maxWidth: 720,
          margin: "0 auto",
          display: "flex",
          flexDirection: "column",
          gap: 22,
        }}
      >
        {/* Header con reloj */}
        <div
          style={{
            background: "#fff",
            borderRadius: 22,
            padding: "26px 28px",
            boxShadow:
              "0 12px 28px -16px rgba(15,23,42,.18), 0 4px 10px -4px rgba(37,183,189,.12)",
            border: "1px solid #e7eef0",
            position: "relative",
            overflow: "hidden",
          }}
        >
          {/* deco */}
          <div
            style={{
              position: "absolute",
              top: -60,
              right: -60,
              width: 200,
              height: 200,
              borderRadius: "50%",
              background: `radial-gradient(circle, ${TEAL}28, transparent 70%)`,
              pointerEvents: "none",
            }}
          />
          <div
            style={{
              fontSize: 12,
              textTransform: "uppercase",
              letterSpacing: ".15em",
              color: TEAL_DEEP,
              fontWeight: 700,
            }}
          >
            Marcaje de asistencia
          </div>
          <h1
            style={{
              fontSize: 24,
              fontWeight: 800,
              color: "#0f172a",
              margin: "6px 0 2px",
              letterSpacing: "-.02em",
            }}
          >
            {saludo}, {nombre.split(" ")[0]} 👋
          </h1>
          <div style={{ fontSize: 13.5, color: "#64748b", textTransform: "capitalize" }}>
            {fmtFechaLarga(reloj)}
          </div>

          <div
            style={{
              marginTop: 18,
              display: "flex",
              alignItems: "baseline",
              gap: 10,
              fontFamily: "ui-monospace, SFMono-Regular, monospace",
            }}
          >
            <div
              style={{
                fontSize: 60,
                fontWeight: 800,
                color: TEAL_DEEP,
                lineHeight: 1,
                letterSpacing: "-.04em",
              }}
            >
              {fmtHora(reloj)}
            </div>
            <Clock size={20} style={{ color: TEAL, opacity: 0.55 }} />
          </div>
        </div>

        {/* Privacidad de ubicación: la coordenada se captura SOLO al marcar.
            Aquí no se muestra (ni se pide) la posición por adelantado. */}
        <div
          style={{
            background: "#fff",
            borderRadius: 18,
            padding: "16px 20px",
            border: `1.5px solid ${geoBloqueada ? "#fecaca" : "#bae6e8"}`,
            display: "flex",
            alignItems: "center",
            gap: 14,
          }}
        >
          <div
            style={{
              width: 42,
              height: 42,
              borderRadius: 12,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: geoBloqueada ? "#fee2e2" : "#e8f7f7",
              color: geoBloqueada ? ROJO : TEAL_DEEP,
              flexShrink: 0,
            }}
          >
            {geoBloqueada ? <AlertTriangle size={20} /> : <ShieldCheck size={20} />}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#0f172a" }}>
              {geoBloqueada
                ? permisoGeo === "nosoporte"
                  ? "Este navegador no soporta geolocalización"
                  : "Permiso de ubicación denegado"
                : "Tu ubicación se captura solo al marcar"}
            </div>
            <div style={{ fontSize: 12, color: "#64748b", marginTop: 2, lineHeight: 1.45 }}>
              {geoBloqueada
                ? "Para registrar tu marcaje necesitamos la ubicación en el momento del clic. Habilita el permiso de ubicación en tu navegador."
                : "Según la normativa de la Dirección del Trabajo, el GPS se consulta únicamente en el instante en que marcas entrada o salida. No hay seguimiento durante tu jornada."}
            </div>
          </div>
        </div>

        {/* Botón gigante de marcaje */}
        <div
          style={{
            background: "#fff",
            borderRadius: 22,
            padding: "32px 24px",
            border: "1px solid #e7eef0",
            boxShadow:
              "0 12px 28px -16px rgba(15,23,42,.15), 0 4px 10px -4px rgba(37,183,189,.1)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 16,
          }}
        >
          <div
            style={{
              fontSize: 11.5,
              textTransform: "uppercase",
              letterSpacing: ".18em",
              color: "#64748b",
              fontWeight: 700,
            }}
          >
            Próximo marcaje
          </div>

          <button
            type="button"
            onClick={marcar}
            disabled={marcando || geoBloqueada}
            className="mk-big-btn"
            style={{
              width: 230,
              height: 230,
              borderRadius: "50%",
              border: "none",
              background: `radial-gradient(circle at 30% 25%, ${colorAccion} 0%, ${colorAccionOsc} 70%)`,
              color: "#fff",
              cursor: marcando || geoBloqueada ? "not-allowed" : "pointer",
              opacity: marcando || geoBloqueada ? 0.65 : 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              boxShadow: `0 20px 50px -12px ${colorAccion}80, 0 8px 20px -10px ${colorAccionOsc}aa, inset 0 -8px 14px -6px rgba(0,0,0,.2), inset 0 4px 14px -2px rgba(255,255,255,.25)`,
              position: "relative",
              overflow: "hidden",
              transition: "transform .2s cubic-bezier(.4, 0, .2, 1), box-shadow .2s",
            }}
          >
            {/* anillo pulsante */}
            {!marcando && !geoBloqueada && (
              <span
                className="mk-pulse-ring"
                style={{
                  position: "absolute",
                  inset: 0,
                  borderRadius: "50%",
                  border: `3px solid ${colorAccion}`,
                  pointerEvents: "none",
                }}
              />
            )}
            {marcando ? (
              <Loader2 size={64} className="mk-spin" strokeWidth={2.2} />
            ) : (
              <IconoBoton size={64} strokeWidth={2.2} />
            )}
            <div style={{ fontSize: 17, fontWeight: 800, letterSpacing: ".02em", textAlign: "center", padding: "0 16px" }}>
              {marcando
                ? faseMarcaje === "ubicando"
                  ? "Obteniendo ubicación…"
                  : "Registrando…"
                : TextoBoton}
            </div>
          </button>

          <div
            style={{
              fontSize: 12.5,
              color: "#64748b",
              textAlign: "center",
              maxWidth: 360,
              lineHeight: 1.5,
            }}
          >
            {esEntrada
              ? "Toca el botón para registrar tu hora de entrada. En ese instante se captura tu ubicación para validar el marcaje."
              : "Toca el botón para registrar tu hora de salida. Buen trabajo hoy."}
          </div>
        </div>

        {/* Historial */}
        <div
          style={{
            background: "#fff",
            borderRadius: 18,
            border: "1px solid #e7eef0",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              padding: "14px 18px",
              borderBottom: "1px solid #eef2f5",
              fontSize: 12.5,
              fontWeight: 800,
              textTransform: "uppercase",
              letterSpacing: ".12em",
              color: TEAL_DEEP,
              background: "linear-gradient(180deg, #fafdfd 0%, #ffffff 100%)",
            }}
          >
            Mis últimos marcajes
          </div>
          {historial.length === 0 ? (
            <div style={{ padding: 24, fontSize: 13, color: "#64748b", textAlign: "center" }}>
              Aún no tienes marcajes en los últimos 14 días.
            </div>
          ) : (
            <div style={{ maxHeight: 320, overflowY: "auto" }}>
              {historial.map((m) => (
                <div
                  key={m.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "12px 18px",
                    borderBottom: "1px solid #f1f5f9",
                    fontSize: 13,
                  }}
                >
                  <div
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 10,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      background: m.tipo === "entrada" ? "#dcfce7" : "#e0f2fe",
                      color: m.tipo === "entrada" ? "#15803d" : "#0369a1",
                      flexShrink: 0,
                    }}
                  >
                    {m.tipo === "entrada" ? <LogIn size={17} /> : <LogOut size={17} />}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, color: "#0f172a", textTransform: "capitalize" }}>
                      {m.tipo}{" "}
                      {m.fuera_de_radio && (
                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 4,
                            background: "#fef3c7",
                            color: "#92400e",
                            fontSize: 10.5,
                            fontWeight: 700,
                            padding: "2px 6px",
                            borderRadius: 999,
                            marginLeft: 6,
                          }}
                        >
                          <AlertTriangle size={10} /> Fuera de radio
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 11.5, color: "#94a3b8" }}>
                      {new Date(m.marcado_at).toLocaleDateString("es-CL", {
                        weekday: "short",
                        day: "numeric",
                        month: "short",
                      })}{" "}
                      · {fmtHoraCorta(m.marcado_at)}
                      {m.distancia_m != null && ` · ${m.distancia_m}m de la oficina`}
                    </div>
                    {m.direccion && (
                      <div
                        style={{
                          fontSize: 11.5,
                          color: "#475569",
                          marginTop: 3,
                          display: "flex",
                          alignItems: "flex-start",
                          gap: 4,
                          lineHeight: 1.3,
                        }}
                      >
                        <MapPin size={11} style={{ color: TEAL, flexShrink: 0, marginTop: 1 }} />
                        <span style={{ wordBreak: "break-word" }}>{m.direccion}</span>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const ESTILOS_MARCAJE = `
@keyframes mk-spin { to { transform: rotate(360deg); } }
.mk-spin { animation: mk-spin 1s linear infinite; }

@keyframes mk-pulse-ring {
  0%   { transform: scale(1); opacity: .55; }
  80%  { transform: scale(1.18); opacity: 0; }
  100% { transform: scale(1.18); opacity: 0; }
}
.mk-pulse-ring { animation: mk-pulse-ring 2s cubic-bezier(.4, 0, .2, 1) infinite; }

.mk-big-btn:not(:disabled):hover { transform: translateY(-2px) scale(1.02); }
.mk-big-btn:not(:disabled):active { transform: scale(.97); }

@keyframes mk-overlay-in { from { opacity: 0; } to { opacity: 1; } }
@keyframes mk-success-pop {
  from { opacity: 0; transform: scale(.85) translateY(20px); }
  to   { opacity: 1; transform: none; }
}
.mk-overlay {
  position: fixed; inset: 0; background: rgba(15,23,42,.55);
  backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
  z-index: 10000; display: flex; align-items: center; justify-content: center;
  animation: mk-overlay-in .2s ease;
}
.mk-success-card {
  background: #fff; padding: 38px 56px; border-radius: 24px;
  text-align: center; box-shadow: 0 32px 80px -16px rgba(15,23,42,.45);
  animation: mk-success-pop .35s cubic-bezier(.4, 0, .2, 1);
}
@keyframes mk-check-pop {
  0%   { transform: scale(0); opacity: 0; }
  60%  { transform: scale(1.15); opacity: 1; }
  100% { transform: scale(1); }
}
.mk-check {
  width: 88px; height: 88px; margin: 0 auto;
  border-radius: 50%;
  background: radial-gradient(circle at 30% 25%, #4ade80 0%, #16a34a 100%);
  color: #fff; display: flex; align-items: center; justify-content: center;
  box-shadow: 0 12px 28px -8px rgba(22,163,74,.55);
  animation: mk-check-pop .45s cubic-bezier(.4, 0, .2, 1);
}
`;
