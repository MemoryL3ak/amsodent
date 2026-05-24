import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Inbox,
  Send,
  Search,
  Paperclip,
  RefreshCw,
  Mail,
  MailOpen,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Download,
  ChevronLeft,
  Unplug,
  X,
  PenSquare,
  Reply,
  Check,
  Star,
  Trash2,
  Archive,
  Tag,
  AlertOctagon,
  FileText,
  Plus,
  MoreVertical,
  RotateCcw,
  ShieldX,
  FileSignature,
  ImagePlus,
  Smile,
} from "lucide-react";
import { api } from "../lib/api";
import { supabase } from "../lib/supabase";
import ConfirmModal from "../components/ConfirmModal";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3001/api";

/* ── Paleta ──────────────────────────────────────────────────────────── */
const TEAL = "#0e7d83";
const TEAL_SOFT = "#e8f5f5";
const INK = "#0f172a";
const TXT = "#334155";
const MUTED = "#64748b";
const FAINT = "#94a3b8";
const LINE = "#e8edf2";
const LINE_SOFT = "#f1f4f7";

/* ── Helpers ─────────────────────────────────────────────────────────── */
const AVATAR_GRADIENTS = [
  ["#0e7d83", "#19b3b0"],
  ["#0369a1", "#0ea5e9"],
  ["#6d28d9", "#a855f7"],
  ["#be185d", "#f0609b"],
  ["#c2410c", "#fb923c"],
  ["#15803d", "#34d399"],
  ["#1d4ed8", "#60a5fa"],
  ["#a21caf", "#e879f9"],
  ["#0f766e", "#2dd4bf"],
  ["#9a3412", "#f59e0b"],
];

function avatarFondo(txt) {
  const s = String(txt || "?");
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % AVATAR_GRADIENTS.length;
  const [a, b] = AVATAR_GRADIENTS[h];
  return `linear-gradient(135deg, ${a}, ${b})`;
}

function inicial(nombre, email) {
  const base = (nombre || email || "?").trim();
  return base.charAt(0).toUpperCase() || "?";
}

function fmtFecha(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const ahora = new Date();
  const mismoDia = d.toDateString() === ahora.toDateString();
  if (mismoDia) return d.toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit" });
  if (d.getFullYear() === ahora.getFullYear())
    return d.toLocaleDateString("es-CL", { day: "numeric", month: "short" });
  return d.toLocaleDateString("es-CL");
}

function fmtFechaLarga(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return (
    d.toLocaleDateString("es-CL", { day: "numeric", month: "long", year: "numeric" }) +
    " · " +
    d.toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit" })
  );
}

function fmtTamano(bytes) {
  const n = Number(bytes || 0);
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function GoogleG({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}

/* ── Componente principal ────────────────────────────────────────────── */
export default function Buzon() {
  const [estado, setEstado] = useState(null); // {disponible, puedeConectar, correoEnvio, motivo}
  const [conectando, setConectando] = useState(false);
  const [aviso, setAviso] = useState(null); // {tipo:'ok'|'error', texto}
  const [carpeta, setCarpeta] = useState("recibidos");
  const [qActiva, setQActiva] = useState("");
  const [busquedaInput, setBusquedaInput] = useState("");
  const [soloNoLeidos, setSoloNoLeidos] = useState(false);

  const [mensajes, setMensajes] = useState([]);
  const [nextPageToken, setNextPageToken] = useState(null);
  const [cargandoLista, setCargandoLista] = useState(false);
  const [cargandoMas, setCargandoMas] = useState(false);
  const [errorLista, setErrorLista] = useState("");

  const [seleccionadoId, setSeleccionadoId] = useState(null);
  const [mensaje, setMensaje] = useState(null);
  const [cargandoMsg, setCargandoMsg] = useState(false);

  const [componer, setComponer] = useState(null); // null | {para, asunto, cuerpo}
  const [confirmDesconectar, setConfirmDesconectar] = useState(false);

  // Etiquetas custom y conteos por carpeta.
  const [etiquetas, setEtiquetas] = useState([]);
  const [conteos, setConteos] = useState(null); // {recibidos, destacados, ...}
  const [labelActivaId, setLabelActivaId] = useState(null); // null si carpeta sistema
  const [modalNuevaCarpeta, setModalNuevaCarpeta] = useState(false);
  const [menuEtiquetaId, setMenuEtiquetaId] = useState(null);
  const [confirmEliminarEtiqueta, setConfirmEliminarEtiqueta] = useState(null);
  const [popoverEtiquetas, setPopoverEtiquetas] = useState(false);

  const [modalFirma, setModalFirma] = useState(false);

  const peticionRef = useRef(0);

  const cargarEstado = useCallback(async () => {
    try {
      const r = await api.get("/correos/buzon/estado");
      setEstado(r || { disponible: false, motivo: "No disponible." });
    } catch (e) {
      setEstado({ disponible: false, motivo: e?.message || "No disponible." });
    }
  }, []);

  // Estado del buzón al montar + resultado del retorno de Google (OAuth).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const conectado = params.get("correo_conectado");
    const errorParam = params.get("correo_error");
    if (conectado) {
      setAviso({ tipo: "ok", texto: `Cuenta conectada: ${conectado}` });
    } else if (errorParam) {
      setAviso({ tipo: "error", texto: errorParam });
    }
    if (conectado || errorParam) {
      window.history.replaceState({}, "", window.location.pathname);
    }
    cargarEstado();
  }, [cargarEstado]);

  async function conectarCorreo() {
    setConectando(true);
    setAviso(null);
    try {
      const r = await api.get("/correos/oauth/iniciar");
      if (r?.url) {
        window.location.href = r.url;
        return;
      }
      throw new Error("No se pudo obtener el enlace de conexión.");
    } catch (e) {
      setAviso({ tipo: "error", texto: e?.message || "No se pudo iniciar la conexión." });
      setConectando(false);
    }
  }

  function desconectarCorreo() {
    setConfirmDesconectar(true);
  }

  async function ejecutarDesconectar() {
    setConfirmDesconectar(false);
    try {
      await api.post("/correos/oauth/desconectar", {});
      setEstado(null);
      setMensajes([]);
      setSeleccionadoId(null);
      setMensaje(null);
      await cargarEstado();
      setAviso({ tipo: "ok", texto: "Cuenta de correo desconectada." });
    } catch (e) {
      setAviso({ tipo: "error", texto: e?.message || "No se pudo desconectar la cuenta." });
    }
  }

  const cargarBandeja = useCallback(
    async (pageToken) => {
      const esMas = Boolean(pageToken);
      const ticket = ++peticionRef.current;
      esMas ? setCargandoMas(true) : setCargandoLista(true);
      setErrorLista("");
      try {
        const partes = [];
        if (qActiva.trim()) partes.push(qActiva.trim());
        if (soloNoLeidos) partes.push("is:unread");
        const q = partes.join(" ");
        const params = new URLSearchParams();
        if (labelActivaId) params.set("labelId", labelActivaId);
        else params.set("carpeta", carpeta);
        if (q) params.set("q", q);
        if (pageToken) params.set("pageToken", pageToken);
        const r = await api.get(`/correos/buzon?${params.toString()}`);
        if (ticket !== peticionRef.current) return; // respuesta obsoleta
        const lista = Array.isArray(r?.mensajes) ? r.mensajes : [];
        setMensajes((prev) => (esMas ? [...prev, ...lista] : lista));
        setNextPageToken(r?.nextPageToken || null);
      } catch (e) {
        if (ticket === peticionRef.current) {
          setErrorLista(e?.message || "No se pudo cargar el buzón.");
          if (!esMas) setMensajes([]);
        }
      } finally {
        if (ticket === peticionRef.current) {
          esMas ? setCargandoMas(false) : setCargandoLista(false);
        }
      }
    },
    [carpeta, labelActivaId, qActiva, soloNoLeidos],
  );

  const cargarEtiquetas = useCallback(async () => {
    try {
      const r = await api.get("/correos/buzon/etiquetas");
      setEtiquetas(Array.isArray(r) ? r : []);
    } catch {
      // silencioso
    }
  }, []);

  const cargarConteos = useCallback(async () => {
    try {
      const r = await api.get("/correos/buzon/conteos");
      setConteos(r || null);
    } catch {
      // silencioso
    }
  }, []);

  // Recargar lista cuando cambian carpeta / búsqueda / filtro / etiqueta.
  useEffect(() => {
    if (estado?.disponible) {
      setSeleccionadoId(null);
      setMensaje(null);
      cargarBandeja();
    }
  }, [estado?.disponible, cargarBandeja]);

  // Cargar etiquetas y conteos al estar disponible el buzón.
  useEffect(() => {
    if (estado?.disponible) {
      cargarEtiquetas();
      cargarConteos();
    }
  }, [estado?.disponible, cargarEtiquetas, cargarConteos]);

  // Cambiar carpeta del sistema (limpia label custom).
  function cambiarCarpeta(c) {
    setCarpeta(c);
    setLabelActivaId(null);
    setSeleccionadoId(null);
    setMensaje(null);
  }

  function abrirEtiqueta(labelId) {
    setLabelActivaId(labelId);
    setSeleccionadoId(null);
    setMensaje(null);
  }

  // Acciones sobre el mensaje actualmente abierto/seleccionado.
  async function accionMensaje(accion, messageId) {
    const id = messageId || seleccionadoId;
    if (!id) return;
    try {
      await api.post(`/correos/buzon/mensaje/${encodeURIComponent(id)}/accion`, {
        accion,
      });
      // Actualización optimista en la lista local.
      setMensajes((prev) => {
        if (accion === "archivar" || accion === "mover-papelera") {
          if (carpeta === "recibidos" || labelActivaId) {
            return prev.filter((m) => m.id !== id);
          }
        }
        if (accion === "restaurar") {
          if (carpeta === "papelera") return prev.filter((m) => m.id !== id);
        }
        if (accion === "marcar-no-spam") {
          if (carpeta === "spam") return prev.filter((m) => m.id !== id);
        }
        return prev.map((m) => {
          if (m.id !== id) return m;
          if (accion === "marcar-leido") return { ...m, leido: true };
          if (accion === "marcar-no-leido") return { ...m, leido: false };
          if (accion === "destacar") return { ...m, destacado: true };
          if (accion === "quitar-destacado") return { ...m, destacado: false };
          return m;
        });
      });
      if (accion === "archivar" || accion === "mover-papelera" || accion === "marcar-no-spam") {
        setSeleccionadoId(null);
        setMensaje(null);
        setAviso({
          tipo: "ok",
          texto:
            accion === "archivar"
              ? "Mensaje archivado."
              : accion === "marcar-no-spam"
                ? "Mensaje movido a Recibidos."
                : "Mensaje movido a la Papelera.",
        });
      }
      cargarConteos();
    } catch (e) {
      setAviso({ tipo: "error", texto: e?.message || "No se pudo ejecutar la acción." });
    }
  }

  async function aplicarEtiqueta(labelId) {
    const id = seleccionadoId;
    if (!id) return;
    try {
      await api.post(
        `/correos/buzon/mensaje/${encodeURIComponent(id)}/etiqueta/${encodeURIComponent(labelId)}/aplicar`,
        {},
      );
      setMensaje((prev) =>
        prev ? { ...prev, labelIds: Array.from(new Set([...(prev.labelIds || []), labelId])) } : prev,
      );
      setMensajes((prev) =>
        prev.map((m) =>
          m.id === id
            ? { ...m, labelIds: Array.from(new Set([...(m.labelIds || []), labelId])) }
            : m,
        ),
      );
      cargarEtiquetas();
    } catch (e) {
      setAviso({ tipo: "error", texto: e?.message || "No se pudo aplicar la carpeta." });
    }
  }

  async function quitarEtiqueta(labelId) {
    const id = seleccionadoId;
    if (!id) return;
    try {
      await api.post(
        `/correos/buzon/mensaje/${encodeURIComponent(id)}/etiqueta/${encodeURIComponent(labelId)}/quitar`,
        {},
      );
      setMensaje((prev) =>
        prev
          ? { ...prev, labelIds: (prev.labelIds || []).filter((x) => x !== labelId) }
          : prev,
      );
      setMensajes((prev) =>
        prev.map((m) =>
          m.id === id ? { ...m, labelIds: (m.labelIds || []).filter((x) => x !== labelId) } : m,
        ),
      );
      cargarEtiquetas();
    } catch (e) {
      setAviso({ tipo: "error", texto: e?.message || "No se pudo quitar la carpeta." });
    }
  }

  async function crearCarpeta(nombre) {
    const r = await api.post("/correos/buzon/etiquetas", { nombre });
    setEtiquetas((prev) =>
      [...prev, r].sort((a, b) => String(a.name).localeCompare(String(b.name))),
    );
    setModalNuevaCarpeta(false);
    setAviso({ tipo: "ok", texto: `Carpeta "${r.name}" creada.` });
  }

  async function eliminarCarpeta(labelId) {
    try {
      await api.post(`/correos/buzon/etiquetas/${encodeURIComponent(labelId)}/eliminar`, {});
      setEtiquetas((prev) => prev.filter((e) => e.id !== labelId));
      if (labelActivaId === labelId) {
        setLabelActivaId(null);
        setCarpeta("recibidos");
      }
      setAviso({ tipo: "ok", texto: "Carpeta eliminada." });
    } catch (e) {
      setAviso({ tipo: "error", texto: e?.message || "No se pudo eliminar la carpeta." });
    } finally {
      setConfirmEliminarEtiqueta(null);
    }
  }

  async function abrirMensaje(id) {
    setSeleccionadoId(id);
    setMensaje(null);
    setCargandoMsg(true);
    try {
      const r = await api.get(`/correos/buzon/mensaje/${encodeURIComponent(id)}`);
      setMensaje(r);
      setMensajes((prev) => prev.map((m) => (m.id === id ? { ...m, leido: true } : m)));
    } catch (e) {
      setMensaje({ error: e?.message || "No se pudo abrir el mensaje." });
    } finally {
      setCargandoMsg(false);
    }
  }

  async function descargarAdjunto(messageId, att) {
    try {
      const { data } = await supabase.auth.getSession();
      const token = data?.session?.access_token || "";
      const url =
        `${API_URL}/correos/buzon/mensaje/${encodeURIComponent(messageId)}` +
        `/adjunto/${encodeURIComponent(att.attachmentId)}` +
        `?nombre=${encodeURIComponent(att.filename || "adjunto")}` +
        `&tipo=${encodeURIComponent(att.mimeType || "application/octet-stream")}`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error("Error al descargar");
      const blob = await res.blob();
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objUrl;
      a.download = att.filename || "adjunto";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objUrl);
    } catch {
      // descarga fallida — silencioso
    }
  }

  function aplicarBusqueda(e) {
    e?.preventDefault();
    setQActiva(busquedaInput);
  }

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <div className="page">
      <style>{ESTILOS}</style>

      <div
        className="page-header"
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        <div>
          <h1 className="page-title">Mi Correo</h1>
          {estado?.correoEnvio ? (
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                marginTop: 7,
                padding: "5px 12px 5px 9px",
                background: "#eef6f6",
                border: "1px solid #d6ebec",
                borderRadius: 999,
                fontSize: 12.5,
                color: "#0e6a6f",
                fontWeight: 600,
              }}
            >
              <span
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: "50%",
                  background: "#16a34a",
                  boxShadow: "0 0 0 3px rgba(22,163,74,.18)",
                }}
              />
              {estado.correoEnvio}
            </div>
          ) : (
            <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 5 }}>
              Tu bandeja de entrada y el envío de correos a clientes
            </div>
          )}
        </div>

        {estado?.disponible && (
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button
              type="button"
              className="bz-primary"
              onClick={() => setComponer({ para: "", asunto: "", cuerpo: "" })}
              style={btnPrimary}
            >
              <PenSquare size={15} />
              Redactar
            </button>
            <button
              type="button"
              onClick={() => setModalFirma(true)}
              title="Editar mi firma de correo"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 7,
                height: 38,
                padding: "0 13px",
                borderRadius: 10,
                border: `1px solid ${TEAL}`,
                background: TEAL_SOFT,
                color: TEAL,
                fontWeight: 700,
                fontSize: 12.5,
                cursor: "pointer",
                transition: "background .14s ease, transform .14s ease",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = TEAL;
                e.currentTarget.style.color = "#fff";
                e.currentTarget.style.transform = "translateY(-1px)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = TEAL_SOFT;
                e.currentTarget.style.color = TEAL;
                e.currentTarget.style.transform = "translateY(0)";
              }}
            >
              <FileSignature size={15} strokeWidth={2.2} />
              Mi firma
            </button>
            <button
              type="button"
              className="bz-ghost bz-iconbtn"
              onClick={() => cargarBandeja()}
              disabled={cargandoLista}
              title="Actualizar bandeja"
              style={btnIcono}
            >
              <RefreshCw
                size={16}
                style={cargandoLista ? { animation: "bz-spin 1s linear infinite" } : undefined}
              />
            </button>
            <button
              type="button"
              className="bz-ghost bz-danger"
              onClick={desconectarCorreo}
              title="Desconectar esta cuenta de correo"
              style={btnIcono}
            >
              <Unplug size={16} />
            </button>
          </div>
        )}
      </div>

      {aviso && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            margin: "0 0 14px",
            padding: "11px 14px",
            borderRadius: 12,
            fontSize: 13.5,
            border: "1px solid",
            background: aviso.tipo === "ok" ? "#ecfdf5" : "#fef2f2",
            borderColor: aviso.tipo === "ok" ? "#a7f3d0" : "#fecaca",
            color: aviso.tipo === "ok" ? "#047857" : "#b91c1c",
            animation: "bz-fade .2s ease",
          }}
        >
          {aviso.tipo === "ok" ? <CheckCircle2 size={17} /> : <AlertCircle size={17} />}
          <span style={{ flex: 1, fontWeight: 500 }}>{aviso.texto}</span>
          <button
            type="button"
            onClick={() => setAviso(null)}
            style={{
              background: "transparent",
              border: "none",
              cursor: "pointer",
              color: "inherit",
              display: "inline-flex",
              padding: 0,
              opacity: 0.7,
            }}
          >
            <X size={15} />
          </button>
        </div>
      )}

      {!estado ? (
        <div style={{ ...cardGrande, ...cajaCentro, minHeight: 360 }}>
          <Loader2 size={28} style={{ animation: "bz-spin 1s linear infinite", color: TEAL }} />
        </div>
      ) : !estado.disponible ? (
        <BuzonConectar
          onConectar={conectarCorreo}
          conectando={conectando}
          aviso={!estado.puedeConectar ? estado.motivo : null}
        />
      ) : (
        <div style={split}>
          {/* Panel sidebar: carpetas del sistema + etiquetas custom */}
          <SidebarCarpetas
            carpeta={carpeta}
            labelActivaId={labelActivaId}
            conteos={conteos}
            etiquetas={etiquetas}
            onCarpeta={cambiarCarpeta}
            onEtiqueta={abrirEtiqueta}
            onNuevaCarpeta={() => setModalNuevaCarpeta(true)}
            onEliminarEtiqueta={(e) => setConfirmEliminarEtiqueta(e)}
            menuEtiquetaId={menuEtiquetaId}
            setMenuEtiquetaId={setMenuEtiquetaId}
          />

          {/* Panel central: lista */}
          <div style={panelLista}>
            {/* Toolbar */}
            <div
              style={{
                padding: 14,
                borderBottom: `1px solid ${LINE}`,
                display: "flex",
                flexDirection: "column",
                gap: 11,
              }}
            >
              <form onSubmit={aplicarBusqueda} style={{ position: "relative" }}>
                <Search
                  size={15}
                  style={{
                    position: "absolute",
                    left: 12,
                    top: "50%",
                    transform: "translateY(-50%)",
                    color: FAINT,
                  }}
                />
                <input
                  className="bz-input"
                  type="text"
                  value={busquedaInput}
                  onChange={(e) => setBusquedaInput(e.target.value)}
                  placeholder="Buscar en el correo…"
                  style={{
                    width: "100%",
                    height: 38,
                    padding: "0 12px 0 35px",
                    borderRadius: 9,
                    border: `1px solid ${LINE}`,
                    fontSize: 13,
                    color: INK,
                    outline: "none",
                    boxSizing: "border-box",
                    background: "#f8fafb",
                  }}
                />
              </form>

              <div
                style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}
              >
                <button
                  type="button"
                  className="bz-chip"
                  onClick={() => setSoloNoLeidos((v) => !v)}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 7,
                    padding: "5px 11px",
                    borderRadius: 999,
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: "pointer",
                    border: "1px solid",
                    borderColor: soloNoLeidos ? TEAL : "#dde3e9",
                    background: soloNoLeidos ? TEAL_SOFT : "#fff",
                    color: soloNoLeidos ? TEAL : MUTED,
                  }}
                >
                  <span
                    style={{
                      width: 7,
                      height: 7,
                      borderRadius: "50%",
                      background: soloNoLeidos ? TEAL : "#cbd5e1",
                    }}
                  />
                  Solo no leídos
                </button>
                {!cargandoLista && !errorLista && mensajes.length > 0 && (
                  <span style={{ fontSize: 11.5, color: FAINT, fontWeight: 500 }}>
                    {mensajes.length} {mensajes.length === 1 ? "correo" : "correos"}
                  </span>
                )}
              </div>
            </div>

            {/* Lista */}
            <div className="bz-scroll" style={{ overflowY: "auto", flex: 1 }}>
              {cargandoLista ? (
                <SkeletonLista />
              ) : errorLista ? (
                <EstadoVacio
                  icono={AlertCircle}
                  color="#dc2626"
                  fondo="#fef2f2"
                  titulo="No se pudo cargar"
                  texto={errorLista}
                />
              ) : mensajes.length === 0 ? (
                <EstadoVacio
                  icono={Mail}
                  titulo="Sin correos"
                  texto={
                    soloNoLeidos
                      ? "No tienes correos sin leer."
                      : qActiva
                        ? "Ningún correo coincide con tu búsqueda."
                        : "Esta carpeta está vacía."
                  }
                />
              ) : (
                <>
                  {mensajes.map((m) => (
                    <MensajeItem
                      key={m.id}
                      m={m}
                      carpeta={carpeta}
                      activo={m.id === seleccionadoId}
                      onClick={() => abrirMensaje(m.id)}
                    />
                  ))}
                  {nextPageToken && (
                    <div style={{ padding: "14px 16px", textAlign: "center" }}>
                      <button
                        type="button"
                        className="bz-ghost"
                        onClick={() => cargarBandeja(nextPageToken)}
                        disabled={cargandoMas}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 7,
                          height: 36,
                          padding: "0 18px",
                          borderRadius: 9,
                          border: `1px solid ${LINE}`,
                          background: "#fff",
                          color: TXT,
                          fontWeight: 600,
                          fontSize: 12.5,
                          cursor: cargandoMas ? "default" : "pointer",
                        }}
                      >
                        {cargandoMas && (
                          <Loader2 size={14} style={{ animation: "bz-spin 1s linear infinite" }} />
                        )}
                        {cargandoMas ? "Cargando…" : "Cargar más correos"}
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Panel derecho: lectura */}
          <div style={panelLectura}>
            {!seleccionadoId ? (
              <div
                style={{
                  ...cajaCentro,
                  flexDirection: "column",
                  color: FAINT,
                  padding: 32,
                  textAlign: "center",
                }}
              >
                <div
                  style={{
                    width: 84,
                    height: 84,
                    borderRadius: 24,
                    background: "#f1f5f7",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    marginBottom: 16,
                  }}
                >
                  <MailOpen size={40} style={{ color: "#b6c2cf" }} />
                </div>
                <p style={{ margin: 0, fontSize: 15, fontWeight: 700, color: "#64748b" }}>
                  Selecciona un correo
                </p>
                <p style={{ margin: "5px 0 0", fontSize: 13, color: FAINT }}>
                  Elige un mensaje de la lista para leerlo aquí.
                </p>
              </div>
            ) : cargandoMsg ? (
              <div style={cajaCentro}>
                <Loader2 size={28} style={{ animation: "bz-spin 1s linear infinite", color: TEAL }} />
              </div>
            ) : mensaje?.error ? (
              <div style={{ ...cajaCentro, color: "#b91c1c", fontSize: 14, padding: 32 }}>
                {mensaje.error}
              </div>
            ) : mensaje ? (
              <LecturaMensaje
                mensaje={mensaje}
                carpeta={carpeta}
                etiquetas={etiquetas}
                popoverEtiquetas={popoverEtiquetas}
                setPopoverEtiquetas={setPopoverEtiquetas}
                onAccion={accionMensaje}
                onAplicarEtiqueta={aplicarEtiqueta}
                onQuitarEtiqueta={quitarEtiqueta}
                onCerrar={() => {
                  setSeleccionadoId(null);
                  setMensaje(null);
                }}
                onDescargar={descargarAdjunto}
                onResponder={(m) =>
                  setComponer({
                    para: m.de || "",
                    asunto: /^re:/i.test((m.asunto || "").trim())
                      ? m.asunto
                      : `Re: ${m.asunto || ""}`,
                    cuerpo: "",
                  })
                }
              />
            ) : null}
          </div>
        </div>
      )}

      {componer && (
        <ComponerCorreo
          valoresIniciales={componer}
          de={estado?.correoEnvio || ""}
          onCerrar={() => setComponer(null)}
          onEnviado={(dest) => {
            setComponer(null);
            setAviso({ tipo: "ok", texto: `Correo enviado a ${dest}.` });
            cargarBandeja();
          }}
        />
      )}

      <ConfirmModal
        open={confirmDesconectar}
        title="¿Desconectar tu cuenta de correo?"
        message="Dejarás de ver tu bandeja aquí y los correos a clientes saldrán desde la cuenta compartida."
        confirmText="Desconectar"
        cancelText="Cancelar"
        confirmTone="warning"
        onConfirm={ejecutarDesconectar}
        onCancel={() => setConfirmDesconectar(false)}
      />

      <ConfirmModal
        open={confirmEliminarEtiqueta !== null}
        title={`¿Eliminar la carpeta "${confirmEliminarEtiqueta?.name || ""}"?`}
        message="Los correos no se borran — solo se quita la etiqueta. Esta acción no se puede deshacer."
        confirmText="Eliminar carpeta"
        cancelText="Cancelar"
        confirmTone="danger"
        onConfirm={() => eliminarCarpeta(confirmEliminarEtiqueta.id)}
        onCancel={() => setConfirmEliminarEtiqueta(null)}
      />

      {modalNuevaCarpeta && (
        <ModalNuevaCarpeta
          onCerrar={() => setModalNuevaCarpeta(false)}
          onCrear={crearCarpeta}
        />
      )}

      {modalFirma && (
        <ModalFirma onCerrar={() => setModalFirma(false)} setAviso={setAviso} />
      )}
    </div>
  );
}

function ModalNuevaCarpeta({ onCerrar, onCrear }) {
  const [nombre, setNombre] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  async function guardar(e) {
    e?.preventDefault();
    const n = nombre.trim();
    if (!n) {
      setError("Ingresa un nombre.");
      return;
    }
    setGuardando(true);
    setError("");
    try {
      await onCrear(n);
    } catch (err) {
      setError(err?.message || "No se pudo crear la carpeta.");
      setGuardando(false);
    }
  }

  return createPortal(
    <div
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !guardando) onCerrar();
      }}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15,23,42,.5)",
        backdropFilter: "blur(3px)",
        WebkitBackdropFilter: "blur(3px)",
        zIndex: 11000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
    >
      <form
        onSubmit={guardar}
        style={{
          width: 440,
          maxWidth: "100%",
          background: "#fff",
          borderRadius: 16,
          overflow: "hidden",
          boxShadow: "0 24px 60px -12px rgba(15,23,42,.30)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "14px 18px",
            background: `linear-gradient(135deg, ${TEAL}, #14b8a6)`,
            color: "#fff",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 9, fontWeight: 700, fontSize: 15 }}>
            <Tag size={18} /> Nueva carpeta
          </div>
          <button
            type="button"
            onClick={() => !guardando && onCerrar()}
            style={{
              background: "rgba(255,255,255,.15)",
              border: "none",
              color: "#fff",
              cursor: "pointer",
              padding: 5,
              borderRadius: 8,
              display: "inline-flex",
            }}
          >
            <X size={17} />
          </button>
        </div>
        <div style={{ padding: 20 }}>
          <label
            style={{
              display: "block",
              fontSize: 11,
              fontWeight: 700,
              color: FAINT,
              textTransform: "uppercase",
              letterSpacing: ".05em",
              marginBottom: 6,
            }}
          >
            Nombre
          </label>
          <input
            autoFocus
            type="text"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            placeholder="Ej: Clientes VIP, Urgentes…"
            disabled={guardando}
            className="bz-input"
            style={{
              width: "100%",
              height: 40,
              padding: "0 12px",
              borderRadius: 9,
              border: `1px solid ${LINE}`,
              fontSize: 14,
              color: INK,
              boxSizing: "border-box",
              background: "#f8fafb",
            }}
          />
          {error && (
            <div
              style={{
                marginTop: 12,
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "9px 12px",
                background: "#fef2f2",
                border: "1px solid #fecaca",
                color: "#b91c1c",
                borderRadius: 9,
                fontSize: 13,
              }}
            >
              <AlertCircle size={15} /> {error}
            </div>
          )}
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 10,
            padding: "13px 18px",
            borderTop: `1px solid ${LINE}`,
            background: "#fbfcfd",
          }}
        >
          <button
            type="button"
            onClick={() => !guardando && onCerrar()}
            disabled={guardando}
            style={{
              height: 40,
              padding: "0 16px",
              borderRadius: 9,
              border: `1px solid ${LINE}`,
              background: "#fff",
              color: "#334155",
              fontWeight: 600,
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={guardando}
            style={{
              height: 40,
              padding: "0 18px",
              borderRadius: 9,
              border: "none",
              background: TEAL,
              color: "#fff",
              fontWeight: 700,
              fontSize: 13,
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: 7,
            }}
          >
            {guardando ? (
              <Loader2 size={15} style={{ animation: "bz-spin 1s linear infinite" }} />
            ) : (
              <Plus size={15} />
            )}
            {guardando ? "Creando…" : "Crear carpeta"}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
}

/* ── Subcomponentes ─────────────────────────────────────────────────── */

function SidebarCarpetas({
  carpeta,
  labelActivaId,
  conteos,
  etiquetas,
  onCarpeta,
  onEtiqueta,
  onNuevaCarpeta,
  onEliminarEtiqueta,
  menuEtiquetaId,
  setMenuEtiquetaId,
}) {
  const sistema = [
    { id: "recibidos", label: "Recibidos", icon: Inbox, badgeKey: "unread" },
    { id: "destacados", label: "Destacados", icon: Star, badgeKey: null },
    { id: "enviados", label: "Enviados", icon: Send, badgeKey: null },
    { id: "spam", label: "Spam", icon: AlertOctagon, badgeKey: "unread" },
    { id: "papelera", label: "Papelera", icon: Trash2, badgeKey: null },
  ];

  return (
    <div style={panelSidebar}>
      <div
        style={{
          padding: "13px 14px",
          borderBottom: `1px solid ${LINE}`,
          fontSize: 11,
          fontWeight: 800,
          color: FAINT,
          letterSpacing: ".08em",
          textTransform: "uppercase",
          background: "#fff",
        }}
      >
        Carpetas
      </div>
      <div className="bz-scroll" style={{ flex: 1, overflowY: "auto", padding: "8px 8px 16px" }}>
        {sistema.map((it) => {
          const Icono = it.icon;
          const activa = !labelActivaId && carpeta === it.id;
          const count = conteos?.[it.id];
          const badge = it.badgeKey === "unread" ? count?.unread : null;
          return (
            <button
              key={it.id}
              type="button"
              className="bz-sidebar-item"
              onClick={() => onCarpeta(it.id)}
              style={{
                ...sidebarItem,
                background: activa ? TEAL_SOFT : "transparent",
                color: activa ? TEAL : TXT,
                boxShadow: activa ? `inset 3px 0 0 ${TEAL}` : "none",
              }}
            >
              <Icono size={15} strokeWidth={activa ? 2.4 : 2} />
              <span style={{ flex: 1, textAlign: "left", fontWeight: activa ? 700 : 600 }}>
                {it.label}
              </span>
              {Boolean(badge) && (
                <span
                  style={{
                    fontSize: 10.5,
                    fontWeight: 800,
                    color: activa ? TEAL : MUTED,
                    background: activa ? "#fff" : "#eef2f5",
                    padding: "1px 7px",
                    borderRadius: 999,
                    minWidth: 18,
                    textAlign: "center",
                  }}
                >
                  {badge}
                </span>
              )}
            </button>
          );
        })}

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "16px 10px 6px",
          }}
        >
          <span
            style={{
              fontSize: 11,
              fontWeight: 800,
              color: FAINT,
              letterSpacing: ".08em",
              textTransform: "uppercase",
            }}
          >
            Mis carpetas
          </span>
          <button
            type="button"
            onClick={onNuevaCarpeta}
            title="Nueva carpeta"
            style={{
              width: 22,
              height: 22,
              borderRadius: 6,
              border: "none",
              background: TEAL,
              color: "#fff",
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Plus size={13} strokeWidth={2.6} />
          </button>
        </div>

        {etiquetas.length === 0 ? (
          <div style={{ padding: "6px 11px", fontSize: 11.5, color: FAINT, lineHeight: 1.5 }}>
            Crea carpetas para organizar tus correos.
          </div>
        ) : (
          etiquetas.map((e) => {
            const activa = labelActivaId === e.id;
            return (
              <div
                key={e.id}
                className="bz-sidebar-item"
                onClick={() => onEtiqueta(e.id)}
                style={{
                  ...sidebarItem,
                  background: activa ? TEAL_SOFT : "transparent",
                  color: activa ? TEAL : TXT,
                  boxShadow: activa ? `inset 3px 0 0 ${TEAL}` : "none",
                  position: "relative",
                  cursor: "pointer",
                }}
              >
                <Tag size={15} strokeWidth={activa ? 2.4 : 2} />
                <span
                  style={{
                    flex: 1,
                    textAlign: "left",
                    fontWeight: activa ? 700 : 600,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    minWidth: 0,
                  }}
                  title={e.name}
                >
                  {e.name}
                </span>
                {e.unread > 0 && (
                  <span
                    style={{
                      fontSize: 10.5,
                      fontWeight: 800,
                      color: activa ? TEAL : MUTED,
                      background: activa ? "#fff" : "#eef2f5",
                      padding: "1px 7px",
                      borderRadius: 999,
                    }}
                  >
                    {e.unread}
                  </span>
                )}
                <button
                  type="button"
                  onClick={(ev) => {
                    ev.stopPropagation();
                    setMenuEtiquetaId(menuEtiquetaId === e.id ? null : e.id);
                  }}
                  title="Acciones"
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: 5,
                    border: "none",
                    background: "transparent",
                    color: MUTED,
                    cursor: "pointer",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <MoreVertical size={13} />
                </button>
                {menuEtiquetaId === e.id && (
                  <>
                    <div
                      onClick={(ev) => {
                        ev.stopPropagation();
                        setMenuEtiquetaId(null);
                      }}
                      style={{ position: "fixed", inset: 0, zIndex: 100 }}
                    />
                    <div
                      onClick={(ev) => ev.stopPropagation()}
                      style={{
                        position: "absolute",
                        right: 6,
                        top: 32,
                        zIndex: 101,
                        background: "#fff",
                        borderRadius: 9,
                        border: `1px solid ${LINE}`,
                        boxShadow: "0 12px 28px -8px rgba(16,24,40,.22)",
                        padding: 4,
                        minWidth: 150,
                      }}
                    >
                      <button
                        type="button"
                        onClick={(ev) => {
                          ev.stopPropagation();
                          setMenuEtiquetaId(null);
                          onEliminarEtiqueta(e);
                        }}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          width: "100%",
                          padding: "7px 9px",
                          borderRadius: 6,
                          border: "none",
                          background: "transparent",
                          color: "#dc2626",
                          fontSize: 12.5,
                          fontWeight: 600,
                          cursor: "pointer",
                          textAlign: "left",
                        }}
                      >
                        <Trash2 size={13} />
                        Eliminar carpeta
                      </button>
                    </div>
                  </>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function SegControl({ carpeta, onChange }) {
  const items = [
    { id: "recibidos", label: "Recibidos", icon: Inbox },
    { id: "enviados", label: "Enviados", icon: Send },
  ];
  return (
    <div style={{ display: "flex", background: "#eef1f4", borderRadius: 10, padding: 3, gap: 3 }}>
      {items.map((it) => {
        const activo = carpeta === it.id;
        const Icon = it.icon;
        return (
          <button
            key={it.id}
            type="button"
            className="bz-seg"
            onClick={() => onChange(it.id)}
            style={{
              flex: 1,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              padding: "8px 10px",
              borderRadius: 8,
              border: "none",
              cursor: "pointer",
              fontSize: 12.5,
              fontWeight: 700,
              background: activo ? "#fff" : "transparent",
              color: activo ? TEAL : MUTED,
              boxShadow: activo
                ? "0 1px 2px rgba(16,24,40,.12), 0 0 0 1px rgba(16,24,40,.04)"
                : "none",
            }}
          >
            <Icon size={14} /> {it.label}
          </button>
        );
      })}
    </div>
  );
}

function EstadoVacio({ icono: Icono, titulo, texto, color = "#b6c2cf", fondo = "#f1f5f7" }) {
  return (
    <div style={{ padding: "52px 28px", textAlign: "center" }}>
      <div
        style={{
          width: 60,
          height: 60,
          borderRadius: 18,
          background: fondo,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          margin: "0 auto 14px",
        }}
      >
        <Icono size={28} style={{ color }} />
      </div>
      <div style={{ fontSize: 14, fontWeight: 700, color: "#64748b" }}>{titulo}</div>
      <div style={{ fontSize: 12.5, color: FAINT, marginTop: 4, lineHeight: 1.5 }}>{texto}</div>
    </div>
  );
}

function SkeletonLista() {
  return (
    <div>
      {Array.from({ length: 7 }).map((_, i) => (
        <div
          key={i}
          style={{
            display: "flex",
            gap: 11,
            padding: "13px 14px",
            borderBottom: `1px solid ${LINE_SOFT}`,
          }}
        >
          <div className="bz-skel" style={{ width: 40, height: 40, borderRadius: "50%" }} />
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8, paddingTop: 4 }}>
            <div className="bz-skel" style={{ height: 10, width: `${48 + ((i * 13) % 34)}%` }} />
            <div className="bz-skel" style={{ height: 9, width: `${62 + ((i * 7) % 26)}%` }} />
            <div className="bz-skel" style={{ height: 8, width: `${38 + ((i * 11) % 30)}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function MensajeItem({ m, carpeta, activo, onClick }) {
  const noLeido = !m.leido && carpeta === "recibidos";
  const quien =
    carpeta === "enviados" ? `Para: ${m.para || "—"}` : m.deNombre || m.de || "—";
  const fondo = avatarFondo(carpeta === "enviados" ? m.para : m.de);
  return (
    <div
      className={`bz-row ${activo ? "is-active" : ""}`}
      onClick={onClick}
      style={{
        display: "flex",
        gap: 11,
        padding: "13px 14px 13px 13px",
        borderBottom: `1px solid ${LINE_SOFT}`,
        cursor: "pointer",
        position: "relative",
      }}
    >
      {activo && (
        <span
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: 3,
            background: TEAL,
            borderRadius: "0 3px 3px 0",
          }}
        />
      )}
      <div
        style={{
          width: 40,
          height: 40,
          borderRadius: "50%",
          background: fondo,
          color: "#fff",
          fontWeight: 700,
          fontSize: 15,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
          boxShadow: "0 2px 5px -1px rgba(16,24,40,.25)",
        }}
      >
        {inicial(carpeta === "enviados" ? m.para : m.deNombre, m.de)}
      </div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
          <span
            style={{
              fontWeight: noLeido ? 800 : 600,
              fontSize: 13.5,
              color: noLeido ? INK : "#1e293b",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {quien}
          </span>
          <span
            style={{
              fontSize: 11,
              color: noLeido ? TEAL : FAINT,
              fontWeight: noLeido ? 700 : 500,
              whiteSpace: "nowrap",
              flexShrink: 0,
            }}
          >
            {fmtFecha(m.fecha)}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 3 }}>
          {noLeido && (
            <span
              style={{ width: 7, height: 7, borderRadius: "50%", background: TEAL, flexShrink: 0 }}
            />
          )}
          <span
            style={{
              fontWeight: noLeido ? 700 : 600,
              fontSize: 12.5,
              color: noLeido ? INK : "#475569",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {m.asunto || "(sin asunto)"}
          </span>
        </div>
        <div
          style={{
            fontSize: 12,
            color: FAINT,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            marginTop: 3,
          }}
        >
          {m.snippet || "Sin vista previa"}
        </div>
      </div>
    </div>
  );
}

function LecturaMensaje({
  mensaje,
  carpeta,
  etiquetas,
  popoverEtiquetas,
  setPopoverEtiquetas,
  onAccion,
  onAplicarEtiqueta,
  onQuitarEtiqueta,
  onCerrar,
  onDescargar,
  onResponder,
}) {
  const fondo = avatarFondo(mensaje.de);
  const esSpam = (mensaje.labelIds || []).includes("SPAM");
  const esPapelera = (mensaje.labelIds || []).includes("TRASH");
  const enInbox = (mensaje.labelIds || []).includes("INBOX");
  const labelsAplicadas = new Set(mensaje.labelIds || []);
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        animation: "bz-fade .2s ease",
      }}
    >
      {/* Encabezado */}
      <div style={{ padding: "14px 22px 16px", borderBottom: `1px solid ${LINE}` }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 14,
            gap: 6,
          }}
        >
          <button
            type="button"
            className="bz-ghost"
            onClick={onCerrar}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              height: 32,
              padding: "0 10px 0 7px",
              borderRadius: 8,
              background: "transparent",
              border: "none",
              color: MUTED,
              fontSize: 12.5,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            <ChevronLeft size={15} /> Volver
          </button>

          {/* Barra de acciones tipo Gmail */}
          <div style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
            <AccionBtn
              icon={mensaje.destacado ? Star : Star}
              title={mensaje.destacado ? "Quitar destacado" : "Destacar"}
              onClick={() =>
                onAccion?.(mensaje.destacado ? "quitar-destacado" : "destacar", mensaje.id)
              }
              activo={mensaje.destacado}
              activoColor="#f59e0b"
            />
            <AccionBtn
              icon={MailOpen}
              title="Marcar como no leído"
              onClick={() => onAccion?.("marcar-no-leido", mensaje.id)}
            />
            {!esPapelera && enInbox && !esSpam && (
              <AccionBtn
                icon={Archive}
                title="Archivar"
                onClick={() => onAccion?.("archivar", mensaje.id)}
              />
            )}
            {esSpam ? (
              <AccionBtn
                icon={ShieldX}
                title="No es spam"
                onClick={() => onAccion?.("marcar-no-spam", mensaje.id)}
              />
            ) : esPapelera ? (
              <AccionBtn
                icon={RotateCcw}
                title="Restaurar"
                onClick={() => onAccion?.("restaurar", mensaje.id)}
              />
            ) : null}
            {!esPapelera && (
              <AccionBtn
                icon={Trash2}
                title="Mover a la papelera"
                onClick={() => onAccion?.("mover-papelera", mensaje.id)}
                hoverColor="#dc2626"
              />
            )}
            <div style={{ position: "relative" }}>
              <AccionBtn
                icon={Tag}
                title="Aplicar carpeta"
                onClick={() => setPopoverEtiquetas?.((v) => !v)}
                activo={popoverEtiquetas}
              />
              {popoverEtiquetas && (
                <>
                  <div
                    onClick={() => setPopoverEtiquetas?.(false)}
                    style={{ position: "fixed", inset: 0, zIndex: 50 }}
                  />
                  <div
                    style={{
                      position: "absolute",
                      top: 38,
                      right: 0,
                      zIndex: 51,
                      width: 240,
                      maxHeight: 320,
                      overflowY: "auto",
                      background: "#fff",
                      borderRadius: 10,
                      border: `1px solid ${LINE}`,
                      boxShadow: "0 16px 36px -10px rgba(16,24,40,.28)",
                      padding: 6,
                    }}
                  >
                    <div
                      style={{
                        padding: "6px 8px 8px",
                        fontSize: 11,
                        fontWeight: 800,
                        color: FAINT,
                        textTransform: "uppercase",
                        letterSpacing: ".05em",
                      }}
                    >
                      Mover a carpeta
                    </div>
                    {etiquetas.length === 0 ? (
                      <div style={{ padding: "8px 10px", fontSize: 12, color: FAINT }}>
                        Crea una carpeta primero desde la barra lateral.
                      </div>
                    ) : (
                      etiquetas.map((e) => {
                        const aplicada = labelsAplicadas.has(e.id);
                        return (
                          <button
                            key={e.id}
                            type="button"
                            onClick={() => {
                              if (aplicada) onQuitarEtiqueta?.(e.id);
                              else onAplicarEtiqueta?.(e.id);
                            }}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 9,
                              width: "100%",
                              padding: "7px 9px",
                              borderRadius: 7,
                              border: "none",
                              background: aplicada ? TEAL_SOFT : "transparent",
                              color: aplicada ? TEAL : INK,
                              cursor: "pointer",
                              fontSize: 12.5,
                              fontWeight: 600,
                              textAlign: "left",
                            }}
                          >
                            {aplicada ? <Check size={14} /> : <Tag size={14} />}
                            <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {e.name}
                            </span>
                          </button>
                        );
                      })
                    )}
                  </div>
                </>
              )}
            </div>
            <button
              type="button"
              className="bz-primary"
              onClick={() => onResponder?.(mensaje)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                height: 32,
                padding: "0 12px",
                background: TEAL,
                color: "#fff",
                border: "none",
                borderRadius: 8,
                fontSize: 12.5,
                fontWeight: 700,
                cursor: "pointer",
                marginLeft: 4,
              }}
            >
              <Reply size={14} /> Responder
            </button>
          </div>
        </div>

        <h2
          style={{
            margin: "0 0 14px",
            fontSize: 19,
            fontWeight: 800,
            color: INK,
            letterSpacing: "-.01em",
            lineHeight: 1.3,
          }}
        >
          {mensaje.asunto || "(sin asunto)"}
        </h2>

        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: "50%",
              background: fondo,
              color: "#fff",
              fontWeight: 700,
              fontSize: 17,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
              boxShadow: "0 2px 6px -1px rgba(16,24,40,.28)",
            }}
          >
            {inicial(mensaje.deNombre, mensaje.de)}
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: INK }}>
              {mensaje.deNombre || mensaje.de}
            </div>
            <div style={{ fontSize: 12, color: MUTED, marginTop: 1 }}>
              {mensaje.de !== mensaje.deNombre ? `${mensaje.de} · ` : ""}
              para {mensaje.para || "—"}
            </div>
          </div>
          <div
            style={{
              fontSize: 11.5,
              color: FAINT,
              whiteSpace: "nowrap",
              textAlign: "right",
              flexShrink: 0,
            }}
          >
            {fmtFechaLarga(mensaje.fecha)}
          </div>
        </div>
      </div>

      {/* Cuerpo */}
      <div style={{ flex: 1, overflow: "hidden", background: "#fff" }}>
        <iframe
          title="Contenido del correo"
          srcDoc={
            mensaje.cuerpoHtml ||
            "<p style='font-family:sans-serif;color:#64748b;padding:20px;'>(Sin contenido)</p>"
          }
          sandbox=""
          style={{ width: "100%", height: "100%", border: "none", background: "#fff" }}
        />
      </div>

      {/* Adjuntos */}
      {Array.isArray(mensaje.adjuntos) && mensaje.adjuntos.length > 0 && (
        <div style={{ padding: "14px 22px", borderTop: `1px solid ${LINE}`, background: "#fbfcfd" }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: MUTED,
              marginBottom: 9,
              textTransform: "uppercase",
              letterSpacing: ".05em",
              display: "flex",
              alignItems: "center",
              gap: 5,
            }}
          >
            <Paperclip size={12} />
            {mensaje.adjuntos.length} adjunto{mensaje.adjuntos.length === 1 ? "" : "s"}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {mensaje.adjuntos.map((a) => (
              <button
                key={a.attachmentId}
                type="button"
                className="bz-att"
                onClick={() => onDescargar(mensaje.id, a)}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 9,
                  padding: "8px 12px",
                  borderRadius: 10,
                  border: `1px solid ${LINE}`,
                  background: "#fff",
                  cursor: "pointer",
                  fontSize: 12.5,
                  color: TXT,
                  maxWidth: 260,
                }}
                title={`Descargar ${a.filename}`}
              >
                <span
                  style={{
                    width: 30,
                    height: 30,
                    borderRadius: 8,
                    background: TEAL_SOFT,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  <Download size={14} style={{ color: TEAL }} />
                </span>
                <span style={{ minWidth: 0 }}>
                  <span
                    style={{
                      display: "block",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      fontWeight: 600,
                    }}
                  >
                    {a.filename}
                  </span>
                  <span style={{ display: "block", color: FAINT, fontSize: 11, marginTop: 1 }}>
                    {fmtTamano(a.size)}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function BuzonConectar({ onConectar, conectando, aviso }) {
  const bullets = [
    "Envía correos a tus clientes desde tu propia casilla",
    "Lee y responde tu bandeja sin salir del sistema",
    "Las respuestas de tus clientes te llegan directo a ti",
  ];
  return (
    <div style={cardGrande}>
      <div style={{ maxWidth: 520, margin: "0 auto", padding: "54px 28px", textAlign: "center" }}>
        <div
          style={{
            width: 78,
            height: 78,
            borderRadius: 22,
            margin: "0 auto 20px",
            background: `linear-gradient(135deg, ${TEAL}, #1aa7ad)`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: "0 14px 30px -10px rgba(14,125,131,.6)",
          }}
        >
          <Mail size={36} color="#fff" />
        </div>
        <h2
          style={{
            margin: "0 0 8px",
            fontSize: 21,
            fontWeight: 800,
            color: INK,
            letterSpacing: "-.01em",
          }}
        >
          Conecta tu cuenta de correo
        </h2>
        <p style={{ margin: "0 auto 24px", maxWidth: 420, fontSize: 14, color: MUTED, lineHeight: 1.65 }}>
          Vincula tu cuenta de Google —da igual si es Gmail o tu correo corporativo{" "}
          <strong style={{ color: TXT }}>@amsodentmedical.cl</strong>.
        </p>

        <div
          style={{
            display: "inline-flex",
            flexDirection: "column",
            gap: 11,
            textAlign: "left",
            margin: "0 0 28px",
          }}
        >
          {bullets.map((b, i) => (
            <div
              key={i}
              style={{ display: "flex", alignItems: "center", gap: 11, fontSize: 13, color: TXT }}
            >
              <span
                style={{
                  width: 21,
                  height: 21,
                  borderRadius: "50%",
                  background: TEAL_SOFT,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                <Check size={12} color={TEAL} strokeWidth={3} />
              </span>
              {b}
            </div>
          ))}
        </div>

        <div>
          <button
            type="button"
            className="bz-google"
            onClick={onConectar}
            disabled={conectando}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 11,
              height: 48,
              padding: "0 24px",
              borderRadius: 12,
              border: "1px solid #dadce0",
              background: "#fff",
              color: "#3c4043",
              fontWeight: 600,
              fontSize: 14.5,
              cursor: conectando ? "default" : "pointer",
            }}
          >
            {conectando ? (
              <Loader2 size={19} style={{ animation: "bz-spin 1s linear infinite", color: TEAL }} />
            ) : (
              <GoogleG size={20} />
            )}
            {conectando ? "Abriendo Google…" : "Continuar con Google"}
          </button>
        </div>
        <p style={{ margin: "20px auto 0", maxWidth: 390, fontSize: 11.5, color: FAINT, lineHeight: 1.6 }}>
          Te llevamos a la pantalla oficial de Google para autorizar el acceso. Solo tú puedes ver y
          enviar desde tu correo.
        </p>

        {aviso && (
          <div
            style={{
              marginTop: 22,
              padding: "11px 14px",
              borderRadius: 10,
              background: "#fef3c7",
              border: "1px solid #fcd34d",
              color: "#92400e",
              fontSize: 12.5,
              lineHeight: 1.5,
              textAlign: "left",
              display: "flex",
              gap: 9,
              alignItems: "flex-start",
            }}
          >
            <AlertCircle size={16} style={{ color: "#d97706", flexShrink: 0, marginTop: 1 }} />
            <span>
              <strong>Heads up:</strong> {aviso}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function BuzonNoDisponible({ motivo }) {
  return (
    <div style={cardGrande}>
      <div style={{ maxWidth: 480, margin: "0 auto", padding: "54px 28px", textAlign: "center" }}>
        <div
          style={{
            width: 70,
            height: 70,
            borderRadius: 20,
            background: "#fef3c7",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            margin: "0 auto 18px",
          }}
        >
          <AlertCircle size={32} style={{ color: "#d97706" }} />
        </div>
        <h2 style={{ margin: "0 0 8px", fontSize: 18, fontWeight: 800, color: INK }}>
          Buzón no disponible todavía
        </h2>
        <p style={{ margin: "0 auto", maxWidth: 420, fontSize: 13.5, color: MUTED, lineHeight: 1.65 }}>
          {motivo || "El buzón aún no está configurado."}
        </p>
      </div>
    </div>
  );
}

function InputDestinatario({ value, onChange, destinatarios, disabled }) {
  const [abierto, setAbierto] = useState(false);
  const [foco, setFoco] = useState(-1);
  const inputRef = useRef(null);

  const sugerencias = useMemo(() => {
    const q = String(value || "").trim().toLowerCase();
    if (!q) return destinatarios.slice(0, 8);
    return destinatarios
      .filter(
        (d) =>
          d.email.toLowerCase().includes(q) ||
          (d.nombre || "").toLowerCase().includes(q),
      )
      .slice(0, 8);
  }, [value, destinatarios]);

  function seleccionar(d) {
    onChange(d.email);
    setAbierto(false);
    setFoco(-1);
  }

  return (
    <div style={{ position: "relative" }}>
      <input
        ref={inputRef}
        className="bz-input"
        type="email"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setAbierto(true);
          setFoco(-1);
        }}
        onFocus={() => setAbierto(true)}
        onBlur={() => setTimeout(() => setAbierto(false), 150)}
        onKeyDown={(e) => {
          if (!abierto || sugerencias.length === 0) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setFoco((f) => (f + 1) % sugerencias.length);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setFoco((f) => (f - 1 + sugerencias.length) % sugerencias.length);
          } else if (e.key === "Enter" && foco >= 0) {
            e.preventDefault();
            seleccionar(sugerencias[foco]);
          } else if (e.key === "Escape") {
            setAbierto(false);
          }
        }}
        placeholder="correo@destinatario.cl"
        style={cmpInput}
        disabled={disabled}
      />
      {abierto && sugerencias.length > 0 && (
        <SugerenciasDest sugerencias={sugerencias} foco={foco} onSeleccionar={seleccionar} />
      )}
    </div>
  );
}

function InputCC({ value, onChange, destinatarios, disabled }) {
  const [texto, setTexto] = useState("");
  const [abierto, setAbierto] = useState(false);
  const [foco, setFoco] = useState(-1);

  const yaSeleccionados = useMemo(
    () => new Set(value.map((c) => c.email.toLowerCase())),
    [value],
  );

  const sugerencias = useMemo(() => {
    const q = texto.trim().toLowerCase();
    const base = destinatarios.filter((d) => !yaSeleccionados.has(d.email.toLowerCase()));
    if (!q) return base.slice(0, 8);
    return base
      .filter(
        (d) =>
          d.email.toLowerCase().includes(q) ||
          (d.nombre || "").toLowerCase().includes(q),
      )
      .slice(0, 8);
  }, [texto, destinatarios, yaSeleccionados]);

  function agregar(d) {
    if (yaSeleccionados.has(d.email.toLowerCase())) return;
    onChange([...value, d]);
    setTexto("");
    setFoco(-1);
  }

  function agregarPorTexto() {
    const t = texto.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)) return;
    if (yaSeleccionados.has(t.toLowerCase())) {
      setTexto("");
      return;
    }
    onChange([...value, { email: t, nombre: "" }]);
    setTexto("");
    setFoco(-1);
  }

  function quitar(email) {
    onChange(value.filter((c) => c.email.toLowerCase() !== email.toLowerCase()));
  }

  return (
    <div style={{ position: "relative" }}>
      <div
        style={{
          ...cmpInput,
          display: "flex",
          flexWrap: "wrap",
          gap: 6,
          padding: "8px 10px",
          minHeight: 40,
          height: "auto",
          cursor: "text",
          alignItems: "center",
        }}
        onClick={() => {
          const i = document.getElementById("bz-cc-input");
          i?.focus();
        }}
      >
        {value.map((c) => (
          <span
            key={c.email}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "3px 4px 3px 9px",
              borderRadius: 999,
              background: TEAL_SOFT,
              color: TEAL,
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            {c.nombre ? `${c.nombre} ` : ""}<span style={{ opacity: c.nombre ? 0.75 : 1 }}>&lt;{c.email}&gt;</span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                quitar(c.email);
              }}
              style={{
                width: 18,
                height: 18,
                borderRadius: "50%",
                border: "none",
                background: "rgba(14,125,131,.15)",
                color: TEAL,
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
              }}
              disabled={disabled}
            >
              <X size={11} strokeWidth={2.5} />
            </button>
          </span>
        ))}
        <input
          id="bz-cc-input"
          className="bz-input"
          type="text"
          value={texto}
          onChange={(e) => {
            setTexto(e.target.value);
            setAbierto(true);
            setFoco(-1);
          }}
          onFocus={() => setAbierto(true)}
          onBlur={() => setTimeout(() => setAbierto(false), 150)}
          onKeyDown={(e) => {
            if (e.key === "Backspace" && !texto && value.length > 0) {
              onChange(value.slice(0, -1));
              return;
            }
            if (!abierto || sugerencias.length === 0) {
              if (e.key === "Enter" || e.key === "," || e.key === " ") {
                if (texto.trim()) {
                  e.preventDefault();
                  agregarPorTexto();
                }
              }
              return;
            }
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setFoco((f) => (f + 1) % sugerencias.length);
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setFoco((f) => (f - 1 + sugerencias.length) % sugerencias.length);
            } else if (e.key === "Enter") {
              e.preventDefault();
              if (foco >= 0) agregar(sugerencias[foco]);
              else agregarPorTexto();
            } else if (e.key === "Escape") {
              setAbierto(false);
            } else if (e.key === ",") {
              e.preventDefault();
              agregarPorTexto();
            }
          }}
          placeholder={value.length === 0 ? "Escribe para buscar usuarios o pega un correo…" : ""}
          style={{
            border: "none",
            background: "transparent",
            outline: "none",
            flex: 1,
            minWidth: 120,
            height: 24,
            padding: 0,
            fontSize: 13,
            color: INK,
            boxShadow: "none",
          }}
          disabled={disabled}
        />
      </div>
      {abierto && sugerencias.length > 0 && (
        <SugerenciasDest sugerencias={sugerencias} foco={foco} onSeleccionar={agregar} />
      )}
    </div>
  );
}

function SugerenciasDest({ sugerencias, foco, onSeleccionar }) {
  return (
    <div
      style={{
        position: "absolute",
        top: "100%",
        left: 0,
        right: 0,
        marginTop: 4,
        background: "#fff",
        borderRadius: 9,
        border: "1px solid #e8edf2",
        boxShadow: "0 14px 32px -10px rgba(16,24,40,.22)",
        zIndex: 20,
        padding: 4,
        maxHeight: 280,
        overflowY: "auto",
      }}
    >
      {sugerencias.map((d, i) => {
        const activo = i === foco;
        return (
          <button
            key={d.email}
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              onSeleccionar(d);
            }}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 9,
              width: "100%",
              padding: "7px 9px",
              borderRadius: 7,
              border: "none",
              background: activo ? TEAL_SOFT : "transparent",
              cursor: "pointer",
              textAlign: "left",
            }}
          >
            <span
              style={{
                width: 28,
                height: 28,
                borderRadius: "50%",
                background: avatarFondo(d.email),
                color: "#fff",
                fontWeight: 700,
                fontSize: 11,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              {inicial(d.nombre, d.email)}
            </span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: "block", fontSize: 12.5, fontWeight: 600, color: INK, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {d.nombre || d.email}
              </span>
              <span style={{ display: "block", fontSize: 11, color: MUTED, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {d.email}
              </span>
            </span>
            {d.origen === "plataforma" && (
              <span style={{ fontSize: 9.5, fontWeight: 700, color: TEAL, background: TEAL_SOFT, padding: "2px 7px", borderRadius: 999 }}>
                EQUIPO
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function CampoCC({ etiqueta, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label
        style={{
          display: "block",
          fontSize: 11,
          fontWeight: 700,
          color: FAINT,
          textTransform: "uppercase",
          letterSpacing: ".05em",
          marginBottom: 6,
        }}
      >
        {etiqueta}
      </label>
      {children}
    </div>
  );
}

function ModalFirma({ onCerrar, setAviso }) {
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const [firma, setFirma] = useState(null); // {html, personalizada, campos}
  const [cargo, setCargo] = useState("");
  const [celular, setCelular] = useState("");

  useEffect(() => {
    (async () => {
      setCargando(true);
      try {
        const r = await api.get("/correos/firma");
        setFirma(r);
        setCargo(r?.campos?.cargo || "");
        setCelular(r?.campos?.celular || "");
      } catch (e) {
        setError(e?.message || "No se pudo cargar la firma.");
      } finally {
        setCargando(false);
      }
    })();
  }, []);

  async function guardar() {
    setGuardando(true);
    setError("");
    try {
      const r = await api.post("/correos/firma/campos", { cargo, celular });
      setFirma(r);
      setAviso?.({ tipo: "ok", texto: "Firma actualizada." });
      onCerrar();
    } catch (e) {
      setError(e?.message || "No se pudo guardar la firma.");
    } finally {
      setGuardando(false);
    }
  }

  async function restablecer() {
    setGuardando(true);
    setError("");
    try {
      const r = await api.post("/correos/firma/reset", {});
      setFirma(r);
      setCargo(r?.campos?.cargo || "");
      setCelular(r?.campos?.celular || "");
      setAviso?.({ tipo: "ok", texto: "Firma restablecida al diseño por defecto." });
    } catch (e) {
      setError(e?.message || "No se pudo restablecer la firma.");
    } finally {
      setGuardando(false);
    }
  }

  const previewHtml = firma?.html || "";

  return createPortal(
    <div
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !guardando) onCerrar();
      }}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15,23,42,.5)",
        backdropFilter: "blur(3px)",
        WebkitBackdropFilter: "blur(3px)",
        zIndex: 11000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
    >
      <div
        style={{
          width: 880,
          maxWidth: "100%",
          maxHeight: "92vh",
          background: "#fff",
          borderRadius: 18,
          overflow: "hidden",
          boxShadow: "0 28px 70px -16px rgba(15,23,42,.45), 0 12px 28px -10px rgba(15,118,110,.15)",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "16px 22px",
            background: `linear-gradient(135deg, ${TEAL}, #14b8a6)`,
            color: "#fff",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <FileSignature size={20} />
            <div>
              <div style={{ fontWeight: 800, fontSize: 16, letterSpacing: "-.01em" }}>Mi firma de correo</div>
              <div style={{ fontSize: 12, opacity: 0.92 }}>
                Se anexa automáticamente al final de cada correo que envíes desde el buzón.
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => !guardando && onCerrar()}
            style={{
              background: "rgba(255,255,255,.15)",
              border: "none",
              color: "#fff",
              cursor: "pointer",
              padding: 6,
              borderRadius: 9,
              display: "inline-flex",
            }}
          >
            <X size={18} />
          </button>
        </div>

        {cargando ? (
          <div style={{ padding: 40, display: "flex", justifyContent: "center" }}>
            <Loader2 size={26} style={{ animation: "bz-spin 1s linear infinite", color: TEAL }} />
          </div>
        ) : (
          <div style={{ flex: 1, overflow: "hidden", display: "flex" }}>
            {/* Panel izquierdo: editor */}
            <div
              style={{
                width: 380,
                flexShrink: 0,
                borderRight: `1px solid ${LINE}`,
                padding: 20,
                overflowY: "auto",
                background: "#fafbfc",
              }}
            >
              <p style={{ margin: "0 0 16px", fontSize: 12.5, color: MUTED, lineHeight: 1.55 }}>
                Personaliza los datos de tu firma. La plantilla se genera automáticamente con
                un diseño profesional.
              </p>
              <CampoFirma etiqueta="Nombre">
                <input
                  type="text"
                  value={firma?.campos?.nombre || ""}
                  disabled
                  style={{ ...inputFirma, background: "#f1f5f9", color: MUTED }}
                />
                <span style={{ fontSize: 11, color: FAINT, marginTop: 4, display: "block" }}>
                  Tu nombre se toma de tu perfil.
                </span>
              </CampoFirma>
              <CampoFirma etiqueta="Cargo / Rol">
                <input
                  type="text"
                  value={cargo}
                  onChange={(e) => setCargo(e.target.value)}
                  placeholder="Ej: Asesor Comercial Senior"
                  maxLength={120}
                  style={inputFirma}
                />
              </CampoFirma>
              <CampoFirma etiqueta="Teléfono / Celular">
                <input
                  type="text"
                  value={celular}
                  onChange={(e) => setCelular(e.target.value)}
                  placeholder="+56 9 1234 5678"
                  maxLength={60}
                  style={inputFirma}
                />
              </CampoFirma>
              <CampoFirma etiqueta="Correo">
                <input
                  type="text"
                  value={firma?.campos?.email || ""}
                  disabled
                  style={{ ...inputFirma, background: "#f1f5f9", color: MUTED }}
                />
                <span style={{ fontSize: 11, color: FAINT, marginTop: 4, display: "block" }}>
                  Tu correo se toma de tu cuenta conectada.
                </span>
              </CampoFirma>

              {error && (
                <div
                  style={{
                    marginTop: 14,
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "9px 12px",
                    background: "#fef2f2",
                    border: "1px solid #fecaca",
                    color: "#b91c1c",
                    borderRadius: 9,
                    fontSize: 13,
                  }}
                >
                  <AlertCircle size={15} /> {error}
                </div>
              )}
            </div>

            {/* Panel derecho: preview */}
            <div style={{ flex: 1, overflowY: "auto", padding: 24, background: "#f4f7fa" }}>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 800,
                  color: FAINT,
                  letterSpacing: ".05em",
                  textTransform: "uppercase",
                  marginBottom: 10,
                }}
              >
                Vista previa
              </div>
              <div
                style={{
                  background: "#fff",
                  borderRadius: 12,
                  border: `1px solid ${LINE}`,
                  padding: 24,
                  boxShadow: "0 4px 12px -4px rgba(16,24,40,.08)",
                  minHeight: 260,
                }}
                dangerouslySetInnerHTML={{ __html: previewHtml }}
              />
              <div style={{ fontSize: 11.5, color: FAINT, marginTop: 12, lineHeight: 1.5 }}>
                Así se verá tu firma al final de los correos que envíes.
              </div>
            </div>
          </div>
        )}

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "14px 22px",
            borderTop: `1px solid ${LINE}`,
            background: "#fbfcfd",
          }}
        >
          <button
            type="button"
            onClick={restablecer}
            disabled={guardando || cargando}
            style={{
              height: 38,
              padding: "0 14px",
              borderRadius: 9,
              border: `1px solid ${LINE}`,
              background: "#fff",
              color: MUTED,
              fontWeight: 600,
              fontSize: 12.5,
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: 7,
            }}
          >
            <RotateCcw size={14} />
            Restablecer al diseño por defecto
          </button>
          <div style={{ flex: 1 }} />
          <button
            type="button"
            onClick={() => !guardando && onCerrar()}
            disabled={guardando}
            style={{
              height: 40,
              padding: "0 16px",
              borderRadius: 9,
              border: `1px solid ${LINE}`,
              background: "#fff",
              color: "#334155",
              fontWeight: 600,
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={guardar}
            disabled={guardando || cargando}
            style={{
              height: 40,
              padding: "0 20px",
              borderRadius: 9,
              border: "none",
              background: `linear-gradient(135deg, ${TEAL}, #14b8a6)`,
              color: "#fff",
              fontWeight: 700,
              fontSize: 13,
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: 7,
              boxShadow: `0 4px 12px -4px ${TEAL}88`,
            }}
          >
            {guardando ? (
              <Loader2 size={15} style={{ animation: "bz-spin 1s linear infinite" }} />
            ) : (
              <Check size={15} />
            )}
            {guardando ? "Guardando…" : "Guardar firma"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function CampoFirma({ etiqueta, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label
        style={{
          display: "block",
          fontSize: 10.5,
          fontWeight: 800,
          color: FAINT,
          textTransform: "uppercase",
          letterSpacing: ".06em",
          marginBottom: 6,
        }}
      >
        {etiqueta}
      </label>
      {children}
    </div>
  );
}

const inputFirma = {
  width: "100%",
  height: 38,
  padding: "0 12px",
  borderRadius: 9,
  border: "1px solid #e2e8f0",
  fontSize: 13,
  color: "#0f172a",
  boxSizing: "border-box",
  background: "#fff",
  outline: "none",
  transition: "border-color .14s ease, box-shadow .14s ease",
};

function AccionBtn({ icon: Icono, title, onClick, activo, activoColor, hoverColor }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      style={{
        width: 32,
        height: 32,
        borderRadius: 8,
        border: "none",
        background: activo ? TEAL_SOFT : "transparent",
        color: activo ? activoColor || TEAL : MUTED,
        cursor: "pointer",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        transition: "background .14s ease, color .14s ease",
      }}
      onMouseEnter={(e) => {
        if (!activo) {
          e.currentTarget.style.background = "#f1f5f9";
          if (hoverColor) e.currentTarget.style.color = hoverColor;
        }
      }}
      onMouseLeave={(e) => {
        if (!activo) {
          e.currentTarget.style.background = "transparent";
          e.currentTarget.style.color = MUTED;
        }
      }}
    >
      <Icono size={16} strokeWidth={2.2} fill={activo && Icono === Star ? activoColor : "none"} />
    </button>
  );
}

function ComponerCorreo({ valoresIniciales, de, onCerrar, onEnviado }) {
  const [para, setPara] = useState(valoresIniciales?.para || "");
  const [cc, setCc] = useState([]); // [{ email, nombre }]
  const [mostrarCc, setMostrarCc] = useState(false);
  const [asunto, setAsunto] = useState(valoresIniciales?.asunto || "");
  const [cuerpo, setCuerpo] = useState(valoresIniciales?.cuerpo || "");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState("");

  // Lista de destinatarios sugeridos (perfiles + recientes) y firma.
  const [destinatarios, setDestinatarios] = useState([]);
  const [firmaHtml, setFirmaHtml] = useState("");
  const [mostrarFirma, setMostrarFirma] = useState(true);

  // Adjuntos (PDF, imágenes, lo que sea — van como attachments del correo).
  const [adjuntos, setAdjuntos] = useState([]); // [{ url, nombre, mime, size }]
  const [subiendoArch, setSubiendoArch] = useState(false);
  const [mostrarEmojiPicker, setMostrarEmojiPicker] = useState(false);
  const inputArchRef = useRef(null);
  const textareaCuerpoRef = useRef(null);

  // Sube cualquier archivo y devuelve la URL pública.
  async function subirArchivo(file) {
    const ext = (file.name?.split(".").pop() || "bin").toLowerCase();
    const path = `correos/${crypto.randomUUID()}.${ext}`;
    const { error: e } = await supabase.storage
      .from("chat-adjuntos")
      .upload(path, file, { contentType: file.type, upsert: false });
    if (e) throw e;
    const { data } = supabase.storage.from("chat-adjuntos").getPublicUrl(path);
    return data.publicUrl;
  }

  // Adjuntar archivo (PDF, imagen, lo que sea) — va como attachment real.
  async function agregarAdjunto(file) {
    if (!file) return;
    if (file.size > 25 * 1024 * 1024) {
      setError("El archivo es demasiado grande (máx. 25 MB).");
      return;
    }
    setError("");
    setSubiendoArch(true);
    try {
      const url = await subirArchivo(file);
      setAdjuntos((prev) => [
        ...prev,
        { url, nombre: file.name || "adjunto", mime: file.type || "", size: file.size || 0 },
      ]);
    } catch (e) {
      setError(e?.message || "No se pudo subir el archivo.");
    } finally {
      setSubiendoArch(false);
    }
  }

  function quitarAdjunto(idx) {
    setAdjuntos((prev) => prev.filter((_, i) => i !== idx));
  }

  // Inserta un emoji en la posición del cursor del textarea (o al final).
  function insertarEmoji(emoji) {
    const ta = textareaCuerpoRef.current;
    if (!ta) {
      setCuerpo((prev) => prev + emoji);
      return;
    }
    const inicio = ta.selectionStart ?? cuerpo.length;
    const fin = ta.selectionEnd ?? cuerpo.length;
    const nuevo = cuerpo.slice(0, inicio) + emoji + cuerpo.slice(fin);
    setCuerpo(nuevo);
    requestAnimationFrame(() => {
      ta.focus();
      const pos = inicio + emoji.length;
      ta.setSelectionRange(pos, pos);
    });
  }

  // Versión estática de la firma para el preview en el composer: quitamos el
  // bloque <style> con @keyframes para que las animaciones no se reapliquen
  // en cada keystroke (el correo enviado sí incluye el HTML completo).
  const firmaPreviewHtml = useMemo(
    () => (firmaHtml || "").replace(/<style[\s\S]*?<\/style>/gi, ""),
    [firmaHtml],
  );

  // Memoizamos el bloque entero para que no se reconstruya el DOM al tipear.
  const previewFirmaJsx = useMemo(() => {
    if (!firmaPreviewHtml || !mostrarFirma) return null;
    return (
      <div
        style={{
          marginTop: 14,
          padding: 14,
          border: `1px dashed ${LINE}`,
          borderRadius: 9,
          background: "#fafbfc",
          position: "relative",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 10,
          }}
        >
          <span
            style={{
              fontSize: 10.5,
              fontWeight: 800,
              color: FAINT,
              letterSpacing: ".06em",
              textTransform: "uppercase",
            }}
          >
            Tu firma · se adjunta al final del correo
          </span>
          <button
            type="button"
            onClick={() => setMostrarFirma(false)}
            title="Ocultar firma (igual se envía)"
            style={{
              background: "transparent",
              border: "none",
              color: MUTED,
              cursor: "pointer",
              padding: 0,
              fontSize: 11.5,
              fontWeight: 700,
            }}
          >
            Ocultar
          </button>
        </div>
        <div
          style={{ pointerEvents: "none", maxHeight: 280, overflow: "hidden" }}
          dangerouslySetInnerHTML={{ __html: firmaPreviewHtml }}
        />
      </div>
    );
  }, [firmaPreviewHtml, mostrarFirma]);

  useEffect(() => {
    (async () => {
      try {
        const r = await api.get("/correos/buzon/destinatarios");
        setDestinatarios(Array.isArray(r) ? r : []);
      } catch {
        /* silencioso */
      }
      try {
        const f = await api.get("/correos/firma");
        setFirmaHtml(f?.html || "");
      } catch {
        /* silencioso */
      }
    })();
  }, []);

  async function enviar() {
    setError("");
    const dest = para.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(dest)) {
      setError("Ingresa un correo de destinatario válido.");
      return;
    }
    if (!asunto.trim()) {
      setError("El asunto no puede estar vacío.");
      return;
    }
    if (!cuerpo.trim()) {
      setError("El correo no puede ir vacío.");
      return;
    }
    setEnviando(true);
    try {
      await api.post("/correos/buzon/enviar", {
        para: dest,
        cc: cc.map((c) => c.email),
        asunto: asunto.trim(),
        cuerpo,
        adjuntos: adjuntos.map((a) => ({ url: a.url, nombre: a.nombre, mime: a.mime })),
      });
      onEnviado?.(dest);
    } catch (e) {
      setError(e?.message || "No se pudo enviar el correo.");
      setEnviando(false);
    }
  }

  return createPortal(
    <div
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !enviando) onCerrar?.();
      }}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15,23,42,.5)",
        backdropFilter: "blur(3px)",
        WebkitBackdropFilter: "blur(3px)",
        zIndex: 11000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
    >
      <div
        style={{
          width: 640,
          maxWidth: "100%",
          maxHeight: "92vh",
          background: "#fff",
          borderRadius: 16,
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 28px 70px rgba(15,23,42,.4)",
          animation: "bz-pop .18s ease",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "15px 20px",
            background: `linear-gradient(135deg, ${TEAL}, #11969c)`,
            color: "#fff",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 9, fontWeight: 700, fontSize: 15 }}>
            <PenSquare size={18} /> Redactar correo
          </div>
          <button
            type="button"
            onClick={() => !enviando && onCerrar?.()}
            style={{
              background: "rgba(255,255,255,.15)",
              border: "none",
              color: "#fff",
              cursor: enviando ? "default" : "pointer",
              padding: 5,
              borderRadius: 8,
              display: "inline-flex",
            }}
            title="Cerrar"
          >
            <X size={17} />
          </button>
        </div>

        {/* Cuerpo */}
        <div className="bz-scroll" style={{ padding: 20, overflowY: "auto" }}>
          <CampoCC etiqueta="De · tu cuenta">
            <div style={cmpReadonly}>
              <span
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: "50%",
                  background: avatarFondo(de),
                  color: "#fff",
                  fontWeight: 700,
                  fontSize: 12,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                {inicial("", de)}
              </span>
              <span style={{ fontWeight: 600, color: INK }}>{de || "Tu cuenta de correo"}</span>
            </div>
          </CampoCC>
          <CampoCC
            etiqueta={
              <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span>Para · destinatario</span>
                {!mostrarCc && (
                  <button
                    type="button"
                    onClick={() => setMostrarCc(true)}
                    style={{
                      background: "transparent",
                      border: "none",
                      color: TEAL,
                      fontSize: 11.5,
                      fontWeight: 700,
                      cursor: "pointer",
                      padding: 0,
                      textTransform: "none",
                      letterSpacing: 0,
                    }}
                  >
                    + Añadir CC
                  </button>
                )}
              </span>
            }
          >
            <InputDestinatario
              value={para}
              onChange={setPara}
              destinatarios={destinatarios}
              disabled={enviando}
            />
          </CampoCC>

          {mostrarCc && (
            <CampoCC
              etiqueta={
                <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span>CC · copiar a</span>
                  <button
                    type="button"
                    onClick={() => {
                      setMostrarCc(false);
                      setCc([]);
                    }}
                    style={{
                      background: "transparent",
                      border: "none",
                      color: MUTED,
                      fontSize: 11.5,
                      fontWeight: 700,
                      cursor: "pointer",
                      padding: 0,
                      textTransform: "none",
                      letterSpacing: 0,
                    }}
                  >
                    × Quitar CC
                  </button>
                </span>
              }
            >
              <InputCC value={cc} onChange={setCc} destinatarios={destinatarios} disabled={enviando} />
            </CampoCC>
          )}

          <CampoCC etiqueta="Asunto">
            <input
              className="bz-input"
              type="text"
              value={asunto}
              onChange={(e) => setAsunto(e.target.value)}
              placeholder="Asunto del correo"
              style={cmpInput}
              disabled={enviando}
            />
          </CampoCC>
          <CampoCC etiqueta="Mensaje">
            <textarea
              ref={textareaCuerpoRef}
              className="bz-input"
              value={cuerpo}
              onChange={(e) => setCuerpo(e.target.value)}
              rows={10}
              placeholder="Escribe tu mensaje…"
              style={{
                ...cmpInput,
                height: "auto",
                resize: "vertical",
                minHeight: 180,
                padding: "11px 12px",
                fontFamily: "inherit",
                lineHeight: 1.6,
              }}
              disabled={enviando}
            />

            {/* Toolbar con emoji + adjuntar archivo */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, flexWrap: "wrap", position: "relative" }}>
              <button
                type="button"
                onClick={() => setMostrarEmojiPicker((v) => !v)}
                disabled={enviando}
                style={{
                  ...btnToolbarComposer,
                  background: mostrarEmojiPicker ? TEAL_SOFT : "#fff",
                }}
                title="Insertar emoji"
              >
                <Smile size={15} strokeWidth={2.2} />
                Emoji
              </button>
              <button
                type="button"
                onClick={() => inputArchRef.current?.click()}
                disabled={enviando || subiendoArch}
                style={btnToolbarComposer}
                title="Adjuntar archivo (PDF, imagen, lo que sea)"
              >
                {subiendoArch ? (
                  <Loader2 size={13} style={{ animation: "bz-spin 1s linear infinite" }} />
                ) : (
                  <Paperclip size={14} strokeWidth={2.2} />
                )}
                {subiendoArch ? "Subiendo…" : "Adjuntar archivo"}
              </button>
              <span style={{ fontSize: 11, color: FAINT }}>
                PDF, imágenes, documentos — máx 25&nbsp;MB
              </span>
              {mostrarEmojiPicker && (
                <EmojiPicker
                  onSeleccionar={insertarEmoji}
                  onCerrar={() => setMostrarEmojiPicker(false)}
                />
              )}
            </div>
            <input
              ref={inputArchRef}
              type="file"
              style={{ display: "none" }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) agregarAdjunto(f);
              }}
            />

            {/* Adjuntos (van como archivos adjuntos del correo, no inline) */}
            {adjuntos.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 7, marginTop: 12 }}>
                {adjuntos.map((a, idx) => (
                  <div
                    key={a.url}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "8px 11px",
                      borderRadius: 9,
                      border: `1px solid ${LINE}`,
                      background: "#fff",
                    }}
                  >
                    <span
                      style={{
                        width: 32,
                        height: 32,
                        borderRadius: 8,
                        background: (a.mime || "").includes("pdf") ? "#fee2e2" : TEAL_SOFT,
                        color: (a.mime || "").includes("pdf") ? "#dc2626" : TEAL,
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                      }}
                    >
                      <Paperclip size={15} strokeWidth={2.2} />
                    </span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span
                        style={{
                          display: "block",
                          fontSize: 12.5,
                          fontWeight: 700,
                          color: INK,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {a.nombre}
                      </span>
                      <span style={{ display: "block", fontSize: 11, color: MUTED }}>
                        {(a.mime || "archivo")} · {fmtTamano(a.size)}
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() => quitarAdjunto(idx)}
                      disabled={enviando}
                      style={{
                        width: 26,
                        height: 26,
                        borderRadius: 7,
                        border: "none",
                        background: "transparent",
                        color: MUTED,
                        cursor: "pointer",
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                      title="Quitar adjunto"
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {previewFirmaJsx}
            {firmaHtml && !mostrarFirma && (
              <button
                type="button"
                onClick={() => setMostrarFirma(true)}
                style={{
                  marginTop: 8,
                  background: "transparent",
                  border: "none",
                  color: TEAL,
                  fontSize: 11.5,
                  fontWeight: 700,
                  cursor: "pointer",
                  padding: "4px 0",
                }}
              >
                Mostrar firma
              </button>
            )}
          </CampoCC>
          {error && (
            <div style={cmpError}>
              <AlertCircle size={15} style={{ flexShrink: 0 }} />
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 10,
            padding: "13px 20px",
            borderTop: `1px solid ${LINE}`,
            background: "#fbfcfd",
          }}
        >
          <button
            type="button"
            className="bz-ghost"
            onClick={() => !enviando && onCerrar?.()}
            disabled={enviando}
            style={{
              height: 40,
              padding: "0 18px",
              borderRadius: 9,
              border: `1px solid ${LINE}`,
              background: "#fff",
              color: TXT,
              fontWeight: 600,
              fontSize: 13,
              cursor: enviando ? "default" : "pointer",
            }}
          >
            Cancelar
          </button>
          <button
            type="button"
            className="bz-primary"
            onClick={enviar}
            disabled={enviando}
            style={{
              height: 40,
              padding: "0 20px",
              borderRadius: 9,
              border: "none",
              background: TEAL,
              color: "#fff",
              fontWeight: 700,
              fontSize: 13,
              cursor: enviando ? "default" : "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: 7,
            }}
          >
            {enviando ? (
              <Loader2 size={15} style={{ animation: "bz-spin 1s linear infinite" }} />
            ) : (
              <Send size={15} />
            )}
            {enviando ? "Enviando…" : "Enviar correo"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// Selector de emojis: popover con categorías. Inserta el emoji elegido
// en la posición del cursor del textarea.
const EMOJI_CATEGORIAS = [
  {
    nombre: "Sonrisas",
    icono: "😀",
    items: ["😀","😃","😄","😁","😆","😅","🤣","😂","🙂","🙃","😉","😊","😇","🥰","😍","🤩","😘","😗","😚","😙","🥲","😋","😛","😜","🤪","😝","🤗","🤭","🫢","🤫","🤔","🫡","🤐","🤨","😐","😑","😶","🫥","😏","😒","🙄","😬","😮‍💨","🤥","😔","😪","🤤","😴","😷","🤒","🤕","🤢","🤮","🥵","🥶","😵","🤯","🤠","🥳","😎","🤓","🧐","😕","🫤","😟","🙁","😮","😯","😲","😳","🥺","😦","😧","😨","😰","😥","😢","😭","😱","😖","😣","😞","😓","😩","😫","🥱","😤","😡","😠","🤬"],
  },
  {
    nombre: "Gestos",
    icono: "👍",
    items: ["👋","🤚","🖐️","✋","🖖","🫱","🫲","🫳","🫴","👌","🤌","🤏","✌️","🤞","🫰","🤟","🤘","🤙","👈","👉","👆","🖕","👇","☝️","🫵","👍","👎","✊","👊","🤛","🤜","👏","🙌","🫶","👐","🤲","🤝","🙏","✍️","💪","🦾","🦵","🦶","👂","🦻","👃","🧠","🫀","🫁","🦷","🦴","👀","👁️","👅","👄","🫦"],
  },
  {
    nombre: "Corazones",
    icono: "❤️",
    items: ["❤️","🧡","💛","💚","💙","💜","🖤","🤍","🤎","💔","❣️","💕","💞","💓","💗","💖","💘","💝","💟","♥️","💌","💋","💐","🌹","🌷","🌸","🌺","🌻","🌼","🌞","🌝","🌚","🌜","🌛","✨","💫","⭐","🌟"],
  },
  {
    nombre: "Trabajo",
    icono: "💼",
    items: ["📧","📨","📩","📤","📥","📦","📫","📬","📭","📪","📮","✉️","💼","📁","📂","🗂️","📅","📆","🗓️","📇","📋","📑","📊","📈","📉","📌","📍","📎","🖇️","📐","📏","✂️","🗃️","🗄️","🗑️","🔒","🔓","🔏","🔐","🔑","🗝️","🖊️","🖋️","✒️","✏️","📝","📓","📔","📒","📕","📗","📘","📙","📚","📖","🔖","🏷️","💰","🪙","💴","💵","💶","💷","💸","💳","🧾","💹","💱","💲","🏦","🏢","🏬","🖥️","💻","⌨️","🖱️","🖨️","📱","☎️","📞","📟","📠","💾","💽","💿","📀"],
  },
  {
    nombre: "Símbolos",
    icono: "✅",
    items: ["✅","❌","⭕","🚫","⚠️","❗","❓","❕","❔","💯","🔔","🔕","✔️","➕","➖","➗","✖️","🟰","💲","💱","🔝","🔚","🔙","🔛","🔜","✳️","❇️","✴️","🔷","🔶","🔸","🔹","♠️","♥️","♦️","♣️","🔆","🔅","ℹ️","🆗","🆕","🆒","🆓","🆖","🆙","🆚","🔥","💥","💣","💢","💦","💨","🕳️","💤","🎉","🎊","🎈","🎁","🎀"],
  },
];

function EmojiPicker({ onSeleccionar, onCerrar }) {
  const [catActiva, setCatActiva] = useState(0);
  const cat = EMOJI_CATEGORIAS[catActiva];
  return (
    <>
      <div
        onClick={onCerrar}
        style={{ position: "fixed", inset: 0, zIndex: 50 }}
      />
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "absolute",
          top: 38,
          left: 0,
          zIndex: 51,
          width: 320,
          background: "#fff",
          borderRadius: 12,
          border: `1px solid ${LINE}`,
          boxShadow: "0 18px 36px -8px rgba(16,24,40,.25)",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          animation: "bz-pop .15s ease",
        }}
      >
        {/* Tabs de categorías */}
        <div
          style={{
            display: "flex",
            gap: 2,
            padding: "6px 6px 0",
            borderBottom: `1px solid ${LINE}`,
            background: "#fafbfc",
          }}
        >
          {EMOJI_CATEGORIAS.map((c, i) => {
            const activa = i === catActiva;
            return (
              <button
                key={c.nombre}
                type="button"
                onClick={() => setCatActiva(i)}
                title={c.nombre}
                style={{
                  flex: 1,
                  height: 34,
                  border: "none",
                  background: activa ? "#fff" : "transparent",
                  borderRadius: "8px 8px 0 0",
                  fontSize: 16,
                  cursor: "pointer",
                  borderBottom: activa ? `2px solid ${TEAL}` : "2px solid transparent",
                  filter: activa ? "none" : "grayscale(0.5) opacity(0.6)",
                  transition: "all .14s ease",
                }}
              >
                {c.icono}
              </button>
            );
          })}
        </div>
        {/* Grid de emojis */}
        <div
          className="bz-scroll"
          style={{
            padding: 8,
            display: "grid",
            gridTemplateColumns: "repeat(8, 1fr)",
            gap: 2,
            maxHeight: 240,
            overflowY: "auto",
          }}
        >
          {cat.items.map((e, i) => (
            <button
              key={`${cat.nombre}-${i}`}
              type="button"
              onClick={() => onSeleccionar(e)}
              style={{
                width: 32,
                height: 32,
                border: "none",
                background: "transparent",
                borderRadius: 6,
                fontSize: 20,
                cursor: "pointer",
                padding: 0,
                lineHeight: 1,
                transition: "background .12s ease, transform .12s ease",
              }}
              onMouseEnter={(ev) => {
                ev.currentTarget.style.background = TEAL_SOFT;
                ev.currentTarget.style.transform = "scale(1.18)";
              }}
              onMouseLeave={(ev) => {
                ev.currentTarget.style.background = "transparent";
                ev.currentTarget.style.transform = "scale(1)";
              }}
            >
              {e}
            </button>
          ))}
        </div>
        <div
          style={{
            padding: "6px 11px",
            borderTop: `1px solid ${LINE}`,
            background: "#fbfcfd",
            fontSize: 11,
            color: FAINT,
            textAlign: "center",
          }}
        >
          {cat.nombre} · {cat.items.length} emojis
        </div>
      </div>
    </>
  );
}


/* ── Estilos ────────────────────────────────────────────────────────── */
const ESTILOS = `
  @keyframes bz-spin { to { transform: rotate(360deg); } }
  @keyframes bz-fade { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
  @keyframes bz-pop { from { opacity: 0; transform: scale(.97) translateY(6px); } to { opacity: 1; transform: none; } }
  @keyframes bz-shimmer { 0% { background-position: -450px 0; } 100% { background-position: 450px 0; } }
  .bz-row { transition: background .14s ease; }
  .bz-row:hover { background: #f6f8fa; }
  .bz-row.is-active { background: #e8f5f5; }
  .bz-row.is-active:hover { background: #e0f0f0; }
  .bz-input { transition: border-color .15s ease, box-shadow .15s ease, background .15s ease; }
  .bz-input:focus { border-color: #0e7d83; box-shadow: 0 0 0 3px rgba(14,125,131,.13); background: #fff; }
  .bz-primary { transition: background .14s ease, transform .05s ease, box-shadow .14s ease; box-shadow: 0 2px 8px -2px rgba(14,125,131,.5); }
  .bz-primary:hover:not(:disabled) { background: #0b6a6f; }
  .bz-primary:active:not(:disabled) { transform: translateY(1px); }
  .bz-primary:disabled { opacity: .65; cursor: default; }
  .bz-ghost { transition: background .14s ease, border-color .14s ease, color .14s ease; }
  .bz-ghost:hover:not(:disabled) { background: #f1f5f9; }
  .bz-danger:hover:not(:disabled) { background: #fef2f2; border-color: #fecaca; color: #dc2626; }
  .bz-chip { transition: all .14s ease; }
  .bz-seg { transition: color .14s ease; }
  .bz-att { transition: transform .12s ease, box-shadow .12s ease, border-color .12s ease; }
  .bz-att:hover { transform: translateY(-2px); box-shadow: 0 6px 16px -6px rgba(16,24,40,.25); border-color: #0e7d83; }
  .bz-google { transition: box-shadow .15s ease, background .15s ease; }
  .bz-google:hover:not(:disabled) { box-shadow: 0 6px 18px -6px rgba(16,24,40,.28); background: #fafafa; }
  .bz-iconbtn { transition: background .14s ease, color .14s ease; }
  .bz-skel { background: linear-gradient(90deg, #edf0f3 25%, #f6f8fa 50%, #edf0f3 75%); background-size: 900px 100%; animation: bz-shimmer 1.5s infinite linear; }
  .bz-scroll::-webkit-scrollbar { width: 9px; }
  .bz-scroll::-webkit-scrollbar-thumb { background: #dde3e9; border-radius: 6px; border: 2px solid #fff; }
  .bz-scroll::-webkit-scrollbar-thumb:hover { background: #cbd5e1; }
`;

const cardGrande = {
  background: "#fff",
  border: `1px solid ${LINE}`,
  borderRadius: 16,
  boxShadow: "0 1px 2px rgba(16,24,40,.04), 0 12px 32px -16px rgba(16,24,40,.16)",
};

const split = {
  display: "flex",
  background: "#fff",
  border: `1px solid ${LINE}`,
  borderRadius: 16,
  boxShadow: "0 1px 2px rgba(16,24,40,.04), 0 12px 32px -16px rgba(16,24,40,.16)",
  overflow: "hidden",
  height: "calc(100vh - 210px)",
  minHeight: 480,
};

const panelSidebar = {
  width: 220,
  flexShrink: 0,
  borderRight: `1px solid ${LINE}`,
  display: "flex",
  flexDirection: "column",
  background: "#fafbfc",
};

const sidebarItem = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  width: "100%",
  padding: "8px 11px",
  borderRadius: 8,
  border: "none",
  background: "transparent",
  cursor: "pointer",
  fontSize: 13,
  marginBottom: 1,
  transition: "background .14s ease",
};

const panelLista = {
  width: 380,
  flexShrink: 0,
  borderRight: `1px solid ${LINE}`,
  display: "flex",
  flexDirection: "column",
  background: "#fff",
};

const panelLectura = {
  flex: 1,
  minWidth: 0,
  display: "flex",
  flexDirection: "column",
  background: "#fff",
};

const cajaCentro = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  height: "100%",
  minHeight: 200,
};

const btnPrimary = {
  display: "inline-flex",
  alignItems: "center",
  gap: 7,
  height: 38,
  padding: "0 16px",
  borderRadius: 9,
  border: "none",
  background: TEAL,
  color: "#fff",
  fontWeight: 700,
  fontSize: 13,
  cursor: "pointer",
};

const btnIcono = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 38,
  height: 38,
  borderRadius: 9,
  border: `1px solid ${LINE}`,
  background: "#fff",
  color: MUTED,
  cursor: "pointer",
};

const cmpInput = {
  width: "100%",
  height: 40,
  padding: "0 12px",
  borderRadius: 9,
  border: `1px solid ${LINE}`,
  fontSize: 14,
  color: INK,
  outline: "none",
  boxSizing: "border-box",
  background: "#f8fafb",
};

const cmpReadonly = {
  width: "100%",
  padding: "8px 11px",
  borderRadius: 9,
  border: `1px solid ${LINE}`,
  background: "#f1f5f7",
  fontSize: 13.5,
  boxSizing: "border-box",
  display: "flex",
  alignItems: "center",
  gap: 9,
};

const btnToolbarComposer = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  height: 32,
  padding: "0 11px",
  borderRadius: 8,
  border: `1px solid ${LINE}`,
  background: "#fff",
  color: TEAL,
  fontSize: 12,
  fontWeight: 700,
  cursor: "pointer",
  transition: "background .14s ease, transform .14s ease",
};

const cmpError = {
  marginTop: 4,
  padding: "10px 12px",
  background: "#fef2f2",
  border: "1px solid #fecaca",
  color: "#b91c1c",
  borderRadius: 9,
  fontSize: 13,
  display: "flex",
  alignItems: "center",
  gap: 8,
};
