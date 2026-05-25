import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Plus,
  Send,
  Mic,
  Image as ImageIcon,
  FileText,
  ClipboardList,
  X,
  Trash2,
  Play,
  Pause,
  Loader2,
  Download,
  MessageSquare,
  AlertCircle,
  Check,
  Users,
  Hash,
  Search,
  CornerUpLeft,
  MoreVertical,
  CheckSquare,
  Square,
  UserPlus,
  Settings2,
  ChevronRight,
  Pencil,
} from "lucide-react";
import { supabase } from "../lib/supabase";
import { api } from "../lib/api";
import useAuth from "../hooks/useAuth";

/* ── Paleta profesional ──────────────────────────────────────────────── */
const TEAL = "#0f766e";
const TEAL_DEEP = "#0b5d57";
const TEAL_DARKER = "#083e3a";
const TEAL_LIGHT = "#14b8a6";
const TEAL_SOFT = "#ccfbf1";
const TEAL_SOFTER = "#e6fffb";
const INK = "#0f172a";
const TEXT = "#1e293b";
const MUTED = "#64748b";
const FAINT = "#94a3b8";
const BORDER = "#e2e8f0";
const BORDER_SOFT = "#eef1f5";
const SURFACE = "#ffffff";
const BG_CHAT = "#f4f7fa";
const BG_SIDEBAR = "#fafbfc";

/* ── Helpers ─────────────────────────────────────────────────────────── */
const AVATAR_GRADIENTS = [
  ["#0f766e", "#14b8a6"],
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

function hash(s) {
  let h = 0;
  const t = String(s || "?");
  for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) % AVATAR_GRADIENTS.length;
  return h;
}

function avatarFondo(txt) {
  const [a, b] = AVATAR_GRADIENTS[hash(txt)];
  return `linear-gradient(135deg, ${a}, ${b})`;
}

function avatarTexto(txt) {
  return AVATAR_GRADIENTS[hash(txt)][0];
}

function inicial(nombre, email) {
  const base = (nombre || email || "?").trim();
  return base.charAt(0).toUpperCase() || "?";
}

function primerNombre(nombre, email) {
  const base = (nombre || "").trim();
  if (base) return base.split(/\s+/)[0];
  return (email || "").split("@")[0] || "Usuario";
}

function fmtHora(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit" });
}

function etiquetaDia(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const hoy = new Date();
  const ayer = new Date();
  ayer.setDate(hoy.getDate() - 1);
  if (d.toDateString() === hoy.toDateString()) return "Hoy";
  if (d.toDateString() === ayer.toDateString()) return "Ayer";
  return d.toLocaleDateString("es-CL", { weekday: "long", day: "numeric", month: "long" });
}

function mismoDia(a, b) {
  return new Date(a).toDateString() === new Date(b).toDateString();
}

function fmtTamano(bytes) {
  const n = Number(bytes || 0);
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function fmtDuracion(seg) {
  const s = Math.max(0, Math.round(Number(seg) || 0));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

function resumenMensaje(m) {
  if (!m) return "";
  if (m.tipo === "imagen") return "📷 Imagen";
  if (m.tipo === "pdf") return "📄 " + (m.adjunto_nombre || "PDF");
  if (m.tipo === "audio") return "🎤 Nota de voz";
  if (m.tipo === "licitacion") return `📋 Licitación ${m.licitacion_id || ""}`.trim();
  return (m.texto || "").slice(0, 200);
}

/* ── Componente principal ────────────────────────────────────────────── */
export default function ChatEquipo({ onLicitacionRegistrada }) {
  const { user, perfil } = useAuth();

  const yo = useMemo(
    () => ({
      email: String(perfil?.email || user?.email || "").trim().toLowerCase(),
      nombre: perfil?.nombre || perfil?.email || user?.email || "Yo",
    }),
    [perfil, user],
  );

  const esAdmin = (perfil?.rol || "").toString().trim().toLowerCase() === "admin";

  // Salas
  const [salas, setSalas] = useState([]);
  const [salaActivaId, setSalaActivaId] = useState(null);
  const [cargandoSalas, setCargandoSalas] = useState(true);
  const [miembrosPorSala, setMiembrosPorSala] = useState({}); // {salaId: [emails]}
  const [perfiles, setPerfiles] = useState([]);
  const [modalNuevaSala, setModalNuevaSala] = useState(false);
  const [modalMiembros, setModalMiembros] = useState(null); // sala
  const [sidebarAbierto, setSidebarAbierto] = useState(true);

  // Mensajes y chat
  const [mensajes, setMensajes] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [avisoSala, setAvisoSala] = useState(null); // { nombre, salaId }
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [menuAbierto, setMenuAbierto] = useState(false);
  const [modalLicitacion, setModalLicitacion] = useState(null); // null | { mensajeBase: m | null }
  const [visorImagen, setVisorImagen] = useState(null);
  const [respondiendoA, setRespondiendoA] = useState(null);
  const [menuMensajeId, setMenuMensajeId] = useState(null);
  const [editandoMensajeId, setEditandoMensajeId] = useState(null);
  const [confirmacion, setConfirmacion] = useState(null); // { titulo, mensaje, onConfirmar, peligro }
  const [menuSalaId, setMenuSalaId] = useState(null);

  // Grabación de audio
  const [grabando, setGrabando] = useState(false);
  const [pausado, setPausado] = useState(false);
  const [segGrabacion, setSegGrabacion] = useState(0);
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const timerRef = useRef(null);
  const inicioSegmentoRef = useRef(0);
  const tiempoAcumuladoRef = useRef(0);
  const duracionFinalRef = useRef(0);
  const cancelarGrabRef = useRef(false);

  const listaRef = useRef(null);
  const inputImagen = useRef(null);
  const inputPdf = useRef(null);
  const textareaRef = useRef(null);

  const salaActiva = useMemo(
    () => salas.find((s) => s.id === salaActivaId) || null,
    [salas, salaActivaId],
  );

  const agregarMensaje = useCallback((m) => {
    if (!m?.id) return;
    setMensajes((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
  }, []);

  /* ── Cargar salas, perfiles, miembros ─────────────────────────────── */
  useEffect(() => {
    if (!yo.email) return;
    let activo = true;
    (async () => {
      setCargandoSalas(true);
      // Salas en las que el usuario es miembro
      const { data: miembrosYo } = await supabase
        .from("chat_sala_miembros")
        .select("sala_id")
        .eq("email", yo.email);

      const ids = (miembrosYo || []).map((m) => m.sala_id);
      let salasData = [];
      if (ids.length > 0) {
        const { data } = await supabase
          .from("chat_salas")
          .select("*")
          .in("id", ids)
          .order("es_general", { ascending: false })
          .order("nombre", { ascending: true });
        salasData = data || [];
      }
      // Miembros de cada sala
      const { data: miembrosTodos } = await supabase
        .from("chat_sala_miembros")
        .select("sala_id, email")
        .in("sala_id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);
      const mapaMiembros = {};
      (miembrosTodos || []).forEach((m) => {
        if (!mapaMiembros[m.sala_id]) mapaMiembros[m.sala_id] = [];
        mapaMiembros[m.sala_id].push(m.email);
      });

      // Perfiles para el picker
      const { data: pf } = await supabase
        .from("profiles")
        .select("id, email, nombre, rol")
        .order("nombre", { ascending: true });

      if (!activo) return;
      setSalas(salasData);
      setMiembrosPorSala(mapaMiembros);
      setPerfiles(pf || []);
      const general = salasData.find((s) => s.es_general) || salasData[0];
      setSalaActivaId(general?.id || null);
      setCargandoSalas(false);
    })();
    return () => {
      activo = false;
    };
  }, [yo.email]);

  /* ── Cargar mensajes al cambiar sala ──────────────────────────────── */
  useEffect(() => {
    if (!salaActivaId) {
      setMensajes([]);
      setCargando(false);
      return;
    }
    let activo = true;
    setRespondiendoA(null);
    setMenuMensajeId(null);
    (async () => {
      setCargando(true);
      const { data, error: e } = await supabase
        .from("chat_mensajes")
        .select("*")
        .eq("sala_id", salaActivaId)
        .order("created_at", { ascending: true })
        .limit(300);
      if (!activo) return;
      if (e) setError(e.message || "No se pudo cargar el chat.");
      else {
        setMensajes(data || []);
        setError("");
      }
      setCargando(false);
    })();
    return () => {
      activo = false;
    };
  }, [salaActivaId]);

  /* ── Suscripción en tiempo real (filtrada por sala) ───────────────── */
  useEffect(() => {
    if (!salaActivaId) return undefined;
    const filtro = `sala_id=eq.${salaActivaId}`;
    const canal = supabase
      .channel(`chat_sala_${salaActivaId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "chat_mensajes", filter: filtro },
        (payload) => {
          if (payload?.new) agregarMensaje(payload.new);
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "chat_mensajes", filter: filtro },
        (payload) => {
          if (!payload?.new) return;
          setMensajes((prev) =>
            prev.map((x) => (x.id === payload.new.id ? { ...x, ...payload.new } : x)),
          );
        },
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "chat_mensajes" },
        (payload) => {
          const id = payload?.old?.id;
          if (!id) return;
          setMensajes((prev) => prev.filter((x) => x.id !== id));
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(canal);
    };
  }, [salaActivaId, agregarMensaje]);

  /* ── Suscripción realtime: me agregaron / removieron de una sala ──── */
  useEffect(() => {
    if (!yo.email) return undefined;
    const emailFiltro = `email=eq.${yo.email}`;
    const canal = supabase
      .channel(`chat_miembros_${yo.email}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "chat_sala_miembros", filter: emailFiltro },
        async (payload) => {
          const salaId = payload?.new?.sala_id;
          if (!salaId) return;
          // Si la sala ya está en mi lista (ej. yo la creé), solo refrescar miembros.
          if (salas.some((s) => s.id === salaId)) {
            const { data: miembros } = await supabase
              .from("chat_sala_miembros")
              .select("email")
              .eq("sala_id", salaId);
            setMiembrosPorSala((prev) => ({
              ...prev,
              [salaId]: (miembros || []).map((m) => m.email),
            }));
            return;
          }
          // Si es una sala nueva: traerla, sumarla a la lista y avisar.
          const { data: sala } = await supabase
            .from("chat_salas")
            .select("*")
            .eq("id", salaId)
            .maybeSingle();
          if (!sala) return;
          const { data: miembros } = await supabase
            .from("chat_sala_miembros")
            .select("email")
            .eq("sala_id", salaId);
          setSalas((prev) => {
            if (prev.some((s) => s.id === sala.id)) return prev;
            return [...prev, sala].sort((a, b) => {
              if (a.es_general !== b.es_general) return a.es_general ? -1 : 1;
              return (a.nombre || "").localeCompare(b.nombre || "");
            });
          });
          setMiembrosPorSala((prev) => ({
            ...prev,
            [sala.id]: (miembros || []).map((m) => m.email),
          }));
          setAvisoSala({ nombre: sala.nombre, salaId: sala.id });
          // Notificación nativa del navegador si el permiso ya fue concedido.
          try {
            if (typeof Notification !== "undefined" && Notification.permission === "granted") {
              new Notification("Te agregaron a una sala de chat", {
                body: sala.nombre || "Nueva sala disponible",
                icon: "/favicon.ico",
                tag: `chat-sala-${sala.id}`,
              });
            }
          } catch {
            // ignorar fallas de notificaciones
          }
        },
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "chat_sala_miembros", filter: emailFiltro },
        (payload) => {
          const salaId = payload?.old?.sala_id;
          if (!salaId) return;
          setSalas((prev) => prev.filter((s) => s.id !== salaId));
          setMiembrosPorSala((prev) => {
            const copia = { ...prev };
            delete copia[salaId];
            return copia;
          });
          setSalaActivaId((actual) => {
            if (actual !== salaId) return actual;
            // si la sala activa se cerró para mí, saltar a la general u otra.
            const otra = salas.find((s) => s.id !== salaId);
            return otra?.id || null;
          });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(canal);
    };
  }, [yo.email, salas]);

  // Pedir permiso de notificación una sola vez al montar (no bloquea si lo deniegan)
  useEffect(() => {
    try {
      if (typeof Notification !== "undefined" && Notification.permission === "default") {
        Notification.requestPermission().catch(() => {});
      }
    } catch {
      // ignorar
    }
  }, []);

  // Auto-scroll al fondo
  useEffect(() => {
    const el = listaRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [mensajes, cargando]);

  // Limpieza del timer de grabación
  useEffect(() => () => clearInterval(timerRef.current), []);

  /* ── Publicar mensaje ─────────────────────────────────────────────── */
  async function publicar(campos) {
    if (!salaActivaId) throw new Error("Selecciona una sala primero.");
    const fila = {
      autor_email: yo.email,
      autor_nombre: yo.nombre,
      tipo: "texto",
      sala_id: salaActivaId,
      ...campos,
    };
    if (respondiendoA && !campos.responde_a_id) {
      fila.responde_a_id = respondiendoA.id;
      fila.responde_a_autor =
        primerNombre(respondiendoA.autor_nombre, respondiendoA.autor_email);
      fila.responde_a_texto = resumenMensaje(respondiendoA);
      fila.responde_a_tipo = respondiendoA.tipo;
    }
    const { data, error: e } = await supabase
      .from("chat_mensajes")
      .insert(fila)
      .select()
      .single();
    if (e) throw e;
    agregarMensaje(data);
    setRespondiendoA(null);
    return data;
  }

  async function enviarTexto() {
    const t = texto.trim();
    if (!t || enviando) return;
    setError("");
    const editId = editandoMensajeId;
    setTexto("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
    setEnviando(true);
    try {
      if (editId) {
        const { data, error: e } = await supabase
          .from("chat_mensajes")
          .update({ texto: t, editado_at: new Date().toISOString() })
          .eq("id", editId)
          .select()
          .single();
        if (e) throw e;
        if (data) {
          setMensajes((prev) => prev.map((x) => (x.id === editId ? { ...x, ...data } : x)));
        }
        setEditandoMensajeId(null);
      } else {
        await publicar({ tipo: "texto", texto: t });
      }
    } catch (e) {
      setError(e?.message || "No se pudo enviar el mensaje.");
      setTexto(t);
    } finally {
      setEnviando(false);
    }
  }

  async function subirArchivo(file) {
    const ext = (file.name?.split(".").pop() || "bin").toLowerCase();
    const path = `${yo.email || "anon"}/${crypto.randomUUID()}.${ext}`;
    const { error: e } = await supabase.storage
      .from("chat-adjuntos")
      .upload(path, file, {
        contentType: file.type || "application/octet-stream",
        upsert: false,
      });
    if (e) throw e;
    const { data } = supabase.storage.from("chat-adjuntos").getPublicUrl(path);
    return data.publicUrl;
  }

  async function enviarArchivo(file, tipo) {
    if (!file || enviando) return;
    setError("");
    setEnviando(true);
    try {
      const url = await subirArchivo(file);
      await publicar({
        tipo,
        adjunto_url: url,
        adjunto_nombre: file.name || (tipo === "pdf" ? "documento.pdf" : "archivo"),
        adjunto_mime: file.type || "",
        adjunto_tamano: file.size || 0,
      });
    } catch (e) {
      setError(e?.message || "No se pudo enviar el archivo.");
    } finally {
      setEnviando(false);
    }
  }

  async function enviarAudio(blob, duracion) {
    setError("");
    setEnviando(true);
    try {
      const file = new File([blob], "nota-de-voz.webm", {
        type: blob.type || "audio/webm",
      });
      const url = await subirArchivo(file);
      await publicar({
        tipo: "audio",
        adjunto_url: url,
        adjunto_mime: file.type,
        adjunto_tamano: file.size,
        audio_duracion: duracion,
      });
    } catch (e) {
      setError(e?.message || "No se pudo enviar la nota de voz.");
    } finally {
      setEnviando(false);
    }
  }

  async function registrarLicitacion({ id_cotizacion, estado, observaciones }) {
    const reg = await api.post("/bitacora-cotizaciones", {
      id_cotizacion,
      estado,
      observaciones,
    });
    await publicar({
      tipo: "licitacion",
      texto: observaciones || null,
      licitacion_id: id_cotizacion,
      licitacion_estado: estado,
      bitacora_id: reg?.id || null,
    });
    onLicitacionRegistrada?.();
  }

  /* ── Acciones sobre un mensaje ────────────────────────────────────── */
  function responderMensaje(m) {
    setEditandoMensajeId(null);
    setRespondiendoA(m);
    setMenuMensajeId(null);
    setTimeout(() => textareaRef.current?.focus(), 0);
  }

  function crearLicitacionDesdeMensaje(m) {
    setMenuMensajeId(null);
    setModalLicitacion({ mensajeBase: m });
  }

  function editarMensaje(m) {
    if (m.tipo !== "texto") {
      setError("Solo los mensajes de texto se pueden editar.");
      setMenuMensajeId(null);
      return;
    }
    setRespondiendoA(null);
    setEditandoMensajeId(m.id);
    setTexto(m.texto || "");
    setMenuMensajeId(null);
    setTimeout(() => {
      const ta = textareaRef.current;
      if (ta) {
        ta.focus();
        ta.style.height = "auto";
        ta.style.height = Math.min(ta.scrollHeight, 120) + "px";
        ta.setSelectionRange(ta.value.length, ta.value.length);
      }
    }, 0);
  }

  function cancelarEdicion() {
    setEditandoMensajeId(null);
    setTexto("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  }

  function eliminarMensaje(m) {
    setMenuMensajeId(null);
    setConfirmacion({
      titulo: "Eliminar mensaje",
      mensaje: "Esta acción no se puede deshacer. El mensaje se borrará para todos.",
      etiquetaConfirmar: "Eliminar",
      peligro: true,
      onConfirmar: async () => {
        const { error: e } = await supabase
          .from("chat_mensajes")
          .delete()
          .eq("id", m.id);
        if (e) throw e;
        setMensajes((prev) => prev.filter((x) => x.id !== m.id));
      },
    });
  }

  function limpiarTodasSalas() {
    setConfirmacion({
      titulo: "¿Vaciar TODAS las salas?",
      mensaje:
        "Esta acción borra TODOS los mensajes de TODAS las salas (incluida la sala General) para TODOS los miembros. Las salas y la lista de miembros se mantienen — solo se elimina el historial. Esta acción no se puede deshacer.",
      etiquetaConfirmar: "Sí, vaciar todo",
      peligro: true,
      onConfirmar: async () => {
        await api.post("/chat/limpiar-todas-salas", {});
        setMensajes([]);
      },
    });
  }

  function eliminarSala(sala) {
    setConfirmacion({
      titulo: `Eliminar sala "${sala.nombre}"`,
      mensaje:
        "Se eliminará la sala y todos sus mensajes para todos los miembros. Esta acción no se puede deshacer.",
      etiquetaConfirmar: "Eliminar sala",
      peligro: true,
      onConfirmar: async () => {
        const { error: e } = await supabase
          .from("chat_salas")
          .delete()
          .eq("id", sala.id);
        if (e) throw e;
        setSalas((prev) => prev.filter((s) => s.id !== sala.id));
        setMiembrosPorSala((prev) => {
          const copia = { ...prev };
          delete copia[sala.id];
          return copia;
        });
        if (salaActivaId === sala.id) {
          const general = salas.find((s) => s.es_general && s.id !== sala.id);
          setSalaActivaId(general?.id || null);
        }
        setModalMiembros(null);
      },
    });
  }

  /* ── Crear sala ───────────────────────────────────────────────────── */
  async function crearSala({ nombre, descripcion, miembros }) {
    const todos = Array.from(
      new Set([yo.email.toLowerCase(), ...miembros.map((e) => e.toLowerCase())]),
    ).filter(Boolean);

    const { data: sala, error: e } = await supabase
      .from("chat_salas")
      .insert({
        nombre: nombre.trim(),
        descripcion: descripcion?.trim() || null,
        creada_por: yo.email,
        es_general: false,
      })
      .select()
      .single();
    if (e) throw e;

    const filasMiembros = todos.map((email) => ({ sala_id: sala.id, email }));
    const { error: em } = await supabase
      .from("chat_sala_miembros")
      .insert(filasMiembros);
    if (em) throw em;

    setSalas((prev) => [...prev, sala].sort((a, b) => {
      if (a.es_general !== b.es_general) return a.es_general ? -1 : 1;
      return a.nombre.localeCompare(b.nombre);
    }));
    setMiembrosPorSala((prev) => ({ ...prev, [sala.id]: todos }));
    setSalaActivaId(sala.id);
  }

  async function agregarMiembrosSala(salaId, nuevos) {
    const existentes = new Set((miembrosPorSala[salaId] || []).map((e) => e.toLowerCase()));
    const filas = nuevos
      .filter((e) => !existentes.has(e.toLowerCase()))
      .map((email) => ({ sala_id: salaId, email: email.toLowerCase() }));
    if (filas.length === 0) return;
    const { error: e } = await supabase
      .from("chat_sala_miembros")
      .insert(filas);
    if (e) throw e;
    setMiembrosPorSala((prev) => ({
      ...prev,
      [salaId]: [...(prev[salaId] || []), ...filas.map((f) => f.email)],
    }));
  }

  /* ── Grabación de audio ───────────────────────────────────────────── */
  function arrancarTimerGrab() {
    clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setSegGrabacion(
        Math.round(
          tiempoAcumuladoRef.current + (Date.now() - inicioSegmentoRef.current) / 1000,
        ),
      );
    }, 250);
  }

  async function iniciarGrabacion() {
    if (grabando || enviando) return;
    setMenuAbierto(false);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      chunksRef.current = [];
      cancelarGrabRef.current = false;
      mr.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        clearInterval(timerRef.current);
        setGrabando(false);
        setPausado(false);
        setSegGrabacion(0);
        const chunks = chunksRef.current;
        chunksRef.current = [];
        if (cancelarGrabRef.current) return;
        const blob = new Blob(chunks, { type: "audio/webm" });
        if (blob.size > 0) await enviarAudio(blob, duracionFinalRef.current);
      };
      mediaRecorderRef.current = mr;
      tiempoAcumuladoRef.current = 0;
      inicioSegmentoRef.current = Date.now();
      mr.start();
      setGrabando(true);
      setPausado(false);
      setSegGrabacion(0);
      arrancarTimerGrab();
    } catch {
      setError("No se pudo acceder al micrófono. Revisa los permisos del navegador.");
    }
  }

  function pausarGrabacion() {
    const mr = mediaRecorderRef.current;
    if (!mr || mr.state !== "recording") return;
    mr.pause();
    tiempoAcumuladoRef.current += (Date.now() - inicioSegmentoRef.current) / 1000;
    clearInterval(timerRef.current);
    setSegGrabacion(Math.round(tiempoAcumuladoRef.current));
    setPausado(true);
  }

  function reanudarGrabacion() {
    const mr = mediaRecorderRef.current;
    if (!mr || mr.state !== "paused") return;
    inicioSegmentoRef.current = Date.now();
    mr.resume();
    setPausado(false);
    arrancarTimerGrab();
  }

  function terminarGrabacion(enviar) {
    const mr = mediaRecorderRef.current;
    if (!mr || mr.state === "inactive") return;
    cancelarGrabRef.current = !enviar;
    if (mr.state === "recording") {
      tiempoAcumuladoRef.current += (Date.now() - inicioSegmentoRef.current) / 1000;
    }
    duracionFinalRef.current = Math.round(tiempoAcumuladoRef.current);
    clearInterval(timerRef.current);
    mr.stop();
  }

  /* ── Render ───────────────────────────────────────────────────────── */
  const miembrosActivos = miembrosPorSala[salaActivaId] || [];

  return (
    <div style={contenedor}>
      <style>{ESTILOS}</style>

      {/* Sidebar de salas */}
      <aside
        style={{
          ...sidebarSalas,
          width: sidebarAbierto ? 260 : 0,
          borderRight: sidebarAbierto ? `1px solid ${BORDER}` : "none",
        }}
      >
        {sidebarAbierto && (
          <>
            <div style={sidebarHeader}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                <div style={iconoSidebar}>
                  <MessageSquare size={15} color="#fff" strokeWidth={2.4} />
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 800, fontSize: 13.5, color: INK, letterSpacing: "-.01em" }}>
                    Salas
                  </div>
                  <div style={{ fontSize: 10.5, color: FAINT, fontWeight: 600, letterSpacing: ".03em", textTransform: "uppercase" }}>
                    {salas.length} {salas.length === 1 ? "canal" : "canales"}
                  </div>
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                {esAdmin && (
                  <button
                    type="button"
                    onClick={limpiarTodasSalas}
                    title="Vaciar todas las salas (solo admin)"
                    style={{
                      width: 30,
                      height: 30,
                      borderRadius: 9,
                      border: "1px solid #fecaca",
                      background: "#fff",
                      color: "#dc2626",
                      cursor: "pointer",
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      transition: "background .14s ease",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = "#fee2e2";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = "#fff";
                    }}
                  >
                    <Trash2 size={14} strokeWidth={2.2} />
                  </button>
                )}
                <button
                  type="button"
                  className="ch-iconbtn ch-btn-nueva"
                  onClick={() => setModalNuevaSala(true)}
                  title="Nueva sala"
                  style={btnNuevaSala}
                >
                  <Plus size={15} strokeWidth={2.6} />
                </button>
              </div>
            </div>

            <div className="ch-scroll" style={listaSalas}>
              {cargandoSalas ? (
                <div style={{ padding: 18, display: "flex", justifyContent: "center" }}>
                  <Loader2 size={18} style={{ animation: "ch-spin 1s linear infinite", color: TEAL }} />
                </div>
              ) : salas.length === 0 ? (
                <div style={{ padding: "14px 16px", fontSize: 12.5, color: FAINT, lineHeight: 1.5 }}>
                  No estás en ninguna sala todavía. Crea una con el botón de arriba.
                </div>
              ) : (
                salas.map((s) => {
                  const activa = s.id === salaActivaId;
                  const cantidad = (miembrosPorSala[s.id] || []).length;
                  const esCreadorSala =
                    (s.creada_por || "").toLowerCase() === yo.email.toLowerCase();
                  const puedeEliminar = esCreadorSala && !s.es_general;
                  return (
                    <div
                      key={s.id}
                      onClick={() => setSalaActivaId(s.id)}
                      className={`ch-sala${activa ? " ch-sala--activa" : ""}`}
                      style={{
                        ...salaItem,
                        background: activa
                          ? `linear-gradient(135deg, ${TEAL_SOFTER}, ${TEAL_SOFT})`
                          : "transparent",
                        boxShadow: activa
                          ? `inset 3px 0 0 ${TEAL}, 0 1px 2px rgba(15,118,110,.08)`
                          : "none",
                        position: "relative",
                      }}
                    >
                      <span
                        style={{
                          ...salaIcono,
                          background: activa
                            ? `linear-gradient(135deg, ${TEAL}, ${TEAL_LIGHT})`
                            : "#eef2f5",
                          color: activa ? "#fff" : MUTED,
                          boxShadow: activa
                            ? `0 3px 8px -2px ${TEAL}66`
                            : "0 1px 2px rgba(16,24,40,.04)",
                        }}
                      >
                        <Hash size={14} strokeWidth={2.6} />
                      </span>
                      <span style={{ minWidth: 0, flex: 1, textAlign: "left" }}>
                        <span
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                            fontSize: 13.5,
                            fontWeight: activa ? 800 : 600,
                            color: activa ? TEAL_DARKER : TEXT,
                            letterSpacing: "-.005em",
                          }}
                        >
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>
                            {s.nombre}
                          </span>
                          {s.es_general && <span style={pillGeneral}>General</span>}
                        </span>
                        <span
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 4,
                            fontSize: 11,
                            color: activa ? TEAL : FAINT,
                            marginTop: 2,
                            fontWeight: activa ? 600 : 500,
                          }}
                        >
                          <Users size={10} strokeWidth={2.4} />
                          {cantidad} {cantidad === 1 ? "miembro" : "miembros"}
                        </span>
                      </span>
                      {puedeEliminar && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setMenuSalaId(menuSalaId === s.id ? null : s.id);
                          }}
                          title="Acciones de la sala"
                          style={{
                            width: 26,
                            height: 26,
                            borderRadius: 7,
                            border: "none",
                            background: menuSalaId === s.id ? "#e2e8f0" : "transparent",
                            color: MUTED,
                            cursor: "pointer",
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            flexShrink: 0,
                          }}
                        >
                          <MoreVertical size={14} />
                        </button>
                      )}
                      {menuSalaId === s.id && (
                        <>
                          <div
                            onClick={(e) => {
                              e.stopPropagation();
                              setMenuSalaId(null);
                            }}
                            style={{ position: "fixed", inset: 0, zIndex: 30 }}
                          />
                          <div
                            onClick={(e) => e.stopPropagation()}
                            className="ch-menu"
                            style={{
                              position: "absolute",
                              top: "100%",
                              right: 6,
                              marginTop: 4,
                              zIndex: 31,
                              background: "#fff",
                              borderRadius: 10,
                              border: `1px solid ${BORDER}`,
                              boxShadow: "0 14px 32px -10px rgba(16,24,40,.28)",
                              padding: 5,
                              minWidth: 180,
                            }}
                          >
                            <button
                              type="button"
                              className="ch-opcion"
                              onClick={(e) => {
                                e.stopPropagation();
                                setMenuSalaId(null);
                                setModalMiembros(s);
                              }}
                              style={opcionMenuMini}
                            >
                              <UserPlus size={15} style={{ color: TEAL, flexShrink: 0 }} />
                              <span style={{ fontSize: 13, fontWeight: 600, color: INK }}>
                                Gestionar miembros
                              </span>
                            </button>
                            <div style={{ height: 1, background: BORDER_SOFT, margin: "4px 6px" }} />
                            <button
                              type="button"
                              className="ch-opcion"
                              onClick={(e) => {
                                e.stopPropagation();
                                setMenuSalaId(null);
                                eliminarSala(s);
                              }}
                              style={opcionMenuMini}
                            >
                              <Trash2 size={15} style={{ color: "#dc2626", flexShrink: 0 }} />
                              <span style={{ fontSize: 13, fontWeight: 600, color: "#dc2626" }}>
                                Eliminar sala
                              </span>
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </>
        )}
      </aside>

      {/* Panel principal del chat */}
      <div style={panelChat}>
        {/* Encabezado del chat */}
        <div style={chatHeader}>
          <button
            type="button"
            className="ch-iconbtn"
            onClick={() => setSidebarAbierto((v) => !v)}
            title={sidebarAbierto ? "Ocultar salas" : "Mostrar salas"}
            style={{
              ...btnCircularSm,
              background: "#eef1f5",
              color: MUTED,
            }}
          >
            {sidebarAbierto ? <ChevronRight size={17} style={{ transform: "rotate(180deg)" }} /> : <ChevronRight size={17} />}
          </button>
          <div style={avatarHeader}>
            <Hash size={18} color="#fff" strokeWidth={2.6} />
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: INK, letterSpacing: "-.01em", display: "flex", alignItems: "center", gap: 8 }}>
              {salaActiva?.nombre || "Sala"}
              {salaActiva?.es_general && <span style={pillGeneralHeader}>General</span>}
            </div>
            <div style={{ fontSize: 12, color: MUTED, display: "flex", alignItems: "center", gap: 6 }}>
              <Users size={11} />
              {miembrosActivos.length} {miembrosActivos.length === 1 ? "miembro" : "miembros"}
              {salaActiva?.descripcion && <span style={{ color: FAINT }}>· {salaActiva.descripcion}</span>}
            </div>
          </div>
          {salaActiva && (
            <button
              type="button"
              className="ch-iconbtn"
              onClick={() => setModalMiembros(salaActiva)}
              title="Miembros de la sala"
              style={{
                ...btnCircularSm,
                background: "#eef1f5",
                color: MUTED,
              }}
            >
              <UserPlus size={17} />
            </button>
          )}
        </div>

        {/* Zona de mensajes */}
        <div ref={listaRef} className="ch-scroll" style={zonaMensajes}>
          {cargando ? (
            <div style={cajaCentro}>
              <Loader2 size={26} style={{ animation: "ch-spin 1s linear infinite", color: TEAL }} />
            </div>
          ) : error && mensajes.length === 0 ? (
            <div style={{ ...cajaCentro, color: "#b91c1c", fontSize: 13.5, gap: 8 }}>
              <AlertCircle size={18} /> {error}
            </div>
          ) : mensajes.length === 0 ? (
            <div className="ch-fade-up" style={{ ...cajaCentro, flexDirection: "column", color: FAINT }}>
              <div className="ch-float" style={emblemaVacio}>
                <div style={emblemaInner}>
                  <MessageSquare size={28} strokeWidth={2.2} style={{ color: TEAL }} />
                </div>
              </div>
              <p style={{ margin: 0, fontSize: 15.5, fontWeight: 800, color: TEXT, letterSpacing: "-.01em" }}>
                Conversa con tu equipo
              </p>
              <p style={{ margin: "6px 0 0", fontSize: 12.5, color: MUTED, maxWidth: 280, textAlign: "center", lineHeight: 1.55 }}>
                Aún no hay mensajes en <strong style={{ color: TEAL_DEEP }}>{salaActiva?.nombre || "esta sala"}</strong>.
                Comparte avances, OCs y guías de despacho con el equipo.
              </p>
            </div>
          ) : (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 2,
                paddingBottom: 6,
                maxWidth: 860,
                width: "100%",
                margin: "0 auto",
              }}
            >
              {mensajes.map((m, i) => {
                const prev = mensajes[i - 1];
                const nuevoDia = !prev || !mismoDia(prev.created_at, m.created_at);
                const esMio = (m.autor_email || "").toLowerCase() === yo.email;
                const mismoAutorQuePrev =
                  prev &&
                  !nuevoDia &&
                  prev.tipo !== "licitacion" &&
                  prev.tipo !== "sistema" &&
                  (prev.autor_email || "").toLowerCase() === (m.autor_email || "").toLowerCase();
                return (
                  <div key={m.id}>
                    {nuevoDia && <SeparadorDia iso={m.created_at} />}
                    <BurbujaMensaje
                      m={m}
                      esMio={esMio}
                      mostrarAutor={!mismoAutorQuePrev && !esMio}
                      apilado={mismoAutorQuePrev}
                      onVerImagen={setVisorImagen}
                      onAbrirMenu={() => setMenuMensajeId(m.id)}
                      menuAbierto={menuMensajeId === m.id}
                      onCerrarMenu={() => setMenuMensajeId(null)}
                      onResponder={() => responderMensaje(m)}
                      onCrearLicitacion={() => crearLicitacionDesdeMensaje(m)}
                      onEditar={() => editarMensaje(m)}
                      onEliminar={() => eliminarMensaje(m)}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Aviso: te agregaron a una sala nueva */}
        {avisoSala && (
          <div style={avisoNuevaSala}>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: 24,
                height: 24,
                borderRadius: "50%",
                background: "rgba(255,255,255,.2)",
                flexShrink: 0,
              }}
            >
              <MessageSquare size={13} />
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, lineHeight: 1.2 }}>
                Te agregaron a una nueva sala
              </div>
              <div style={{ fontSize: 11.5, opacity: 0.92, marginTop: 1 }}>
                {avisoSala.nombre || "Nueva sala"}
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                setSalaActivaId(avisoSala.salaId);
                setAvisoSala(null);
              }}
              style={{
                background: "rgba(255,255,255,.18)",
                color: "#fff",
                border: "none",
                padding: "5px 10px",
                borderRadius: 7,
                fontSize: 12,
                fontWeight: 700,
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              Abrir
            </button>
            <button
              type="button"
              onClick={() => setAvisoSala(null)}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                color: "inherit",
                display: "inline-flex",
                padding: 2,
              }}
            >
              <X size={14} />
            </button>
          </div>
        )}

        {/* Aviso de error puntual */}
        {error && mensajes.length > 0 && (
          <div style={avisoError}>
            <AlertCircle size={14} /> {error}
            <button
              type="button"
              onClick={() => setError("")}
              style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", color: "inherit", display: "inline-flex" }}
            >
              <X size={14} />
            </button>
          </div>
        )}

        {/* Preview de respuesta */}
        {respondiendoA && !editandoMensajeId && (
          <div style={previewRespuesta}>
            <div style={{ width: 3, alignSelf: "stretch", background: TEAL, borderRadius: 3 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 11.5, fontWeight: 700, color: TEAL_DEEP, marginBottom: 2 }}>
                Respondiendo a {primerNombre(respondiendoA.autor_nombre, respondiendoA.autor_email)}
              </div>
              <div
                style={{
                  fontSize: 12.5,
                  color: MUTED,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {resumenMensaje(respondiendoA)}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setRespondiendoA(null)}
              title="Cancelar respuesta"
              style={{
                background: "transparent",
                border: "none",
                cursor: "pointer",
                color: MUTED,
                display: "inline-flex",
                padding: 4,
                borderRadius: 6,
              }}
            >
              <X size={16} />
            </button>
          </div>
        )}

        {/* Indicador de edición */}
        {editandoMensajeId && (
          <div style={{ ...previewRespuesta, background: "#fef3c7", borderBottomColor: "#fde68a" }}>
            <div style={{ width: 3, alignSelf: "stretch", background: "#b45309", borderRadius: 3 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 11.5, fontWeight: 700, color: "#92400e", marginBottom: 2, display: "inline-flex", alignItems: "center", gap: 5 }}>
                <Pencil size={11} /> Editando mensaje
              </div>
              <div style={{ fontSize: 12, color: "#78350f" }}>
                Presiona <kbd style={{ background: "#fff", padding: "1px 5px", borderRadius: 4, fontSize: 11, border: "1px solid #fde68a" }}>Esc</kbd> para cancelar.
              </div>
            </div>
            <button
              type="button"
              onClick={cancelarEdicion}
              title="Cancelar edición"
              style={{
                background: "transparent",
                border: "none",
                cursor: "pointer",
                color: "#92400e",
                display: "inline-flex",
                padding: 4,
                borderRadius: 6,
              }}
            >
              <X size={16} />
            </button>
          </div>
        )}

        {/* Composer */}
        {grabando ? (
          <div style={composer}>
            <button
              type="button"
              className="ch-iconbtn"
              onClick={() => terminarGrabacion(false)}
              title="Cancelar"
              style={{ ...btnCircular, color: "#dc2626" }}
            >
              <Trash2 size={20} />
            </button>
            <div
              style={{
                ...zonaGrabacion,
                background: pausado ? "#fff7ed" : "#fef2f2",
                borderColor: pausado ? "#fed7aa" : "#fecaca",
              }}
            >
              <span className={pausado ? "ch-rec-dot-pausa" : "ch-rec-dot"} />
              <span
                style={{
                  fontWeight: 700,
                  color: pausado ? "#b45309" : "#dc2626",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {fmtDuracion(segGrabacion)}
              </span>
              <span style={{ color: MUTED, fontSize: 13 }}>
                {pausado ? "Grabación en pausa" : "Grabando nota de voz…"}
              </span>
            </div>
            <button
              type="button"
              className="ch-iconbtn"
              onClick={pausado ? reanudarGrabacion : pausarGrabacion}
              title={pausado ? "Reanudar" : "Pausar"}
              style={{ ...btnCircular, background: "#eef1f4", color: MUTED }}
            >
              {pausado ? <Play size={19} style={{ marginLeft: 2 }} /> : <Pause size={19} />}
            </button>
            <button
              type="button"
              onClick={() => terminarGrabacion(true)}
              title="Enviar nota de voz"
              style={{ ...btnCircular, background: TEAL, color: "#fff" }}
            >
              <Send size={18} />
            </button>
          </div>
        ) : (
          <div style={composer}>
            {/* Botón + */}
            <div style={{ position: "relative" }}>
              <button
                type="button"
                className="ch-iconbtn"
                onClick={() => setMenuAbierto((v) => !v)}
                title="Adjuntar"
                style={{
                  ...btnCircular,
                  background: menuAbierto ? TEAL : "#eef1f4",
                  color: menuAbierto ? "#fff" : MUTED,
                  transform: menuAbierto ? "rotate(45deg)" : "none",
                  transition: "transform .18s ease, background .15s ease, color .15s ease",
                }}
              >
                <Plus size={22} />
              </button>
              {menuAbierto && (
                <>
                  <div style={capaCierre} onClick={() => setMenuAbierto(false)} />
                  <div style={menuMas} className="ch-menu">
                    <OpcionMenu
                      icono={ClipboardList}
                      color="#0f766e"
                      label="Registrar licitación"
                      sub="Avisar una licitación tomada"
                      onClick={() => {
                        setMenuAbierto(false);
                        setModalLicitacion({ mensajeBase: null });
                      }}
                    />
                    <OpcionMenu
                      icono={ImageIcon}
                      color="#7c3aed"
                      label="Imagen o foto"
                      sub="JPG, PNG, etc."
                      onClick={() => {
                        setMenuAbierto(false);
                        inputImagen.current?.click();
                      }}
                    />
                    <OpcionMenu
                      icono={FileText}
                      color="#dc2626"
                      label="Documento PDF"
                      sub="Adjuntar un archivo PDF"
                      onClick={() => {
                        setMenuAbierto(false);
                        inputPdf.current?.click();
                      }}
                    />
                  </div>
                </>
              )}
            </div>

            {/* Input de texto */}
            <textarea
              ref={textareaRef}
              className="ch-input ch-scroll"
              value={texto}
              rows={1}
              placeholder={
                editandoMensajeId
                  ? "Editar mensaje…"
                  : respondiendoA
                    ? `Responder a ${primerNombre(respondiendoA.autor_nombre, respondiendoA.autor_email)}…`
                    : `Escribe en ${salaActiva?.nombre || "la sala"}…`
              }
              disabled={enviando || !salaActivaId}
              onChange={(e) => {
                setTexto(e.target.value);
                e.target.style.height = "auto";
                e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px";
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  enviarTexto();
                }
                if (e.key === "Escape") {
                  if (editandoMensajeId) {
                    e.preventDefault();
                    cancelarEdicion();
                  } else if (respondiendoA) {
                    e.preventDefault();
                    setRespondiendoA(null);
                  }
                }
              }}
              style={inputTexto}
            />

            {/* Mic o Enviar */}
            {texto.trim() ? (
              <button
                type="button"
                onClick={enviarTexto}
                disabled={enviando}
                title="Enviar"
                style={{ ...btnCircular, background: TEAL, color: "#fff" }}
              >
                {enviando ? (
                  <Loader2 size={18} style={{ animation: "ch-spin 1s linear infinite" }} />
                ) : (
                  <Send size={18} />
                )}
              </button>
            ) : (
              <button
                type="button"
                className="ch-iconbtn"
                onClick={iniciarGrabacion}
                disabled={enviando || !salaActivaId}
                title="Grabar nota de voz"
                style={{ ...btnCircular, background: "#eef1f4", color: MUTED }}
              >
                <Mic size={20} />
              </button>
            )}
          </div>
        )}
      </div>

      {/* Inputs ocultos */}
      <input
        ref={inputImagen}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) enviarArchivo(f, "imagen");
        }}
      />
      <input
        ref={inputPdf}
        type="file"
        accept="application/pdf"
        style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) enviarArchivo(f, "pdf");
        }}
      />

      {modalLicitacion && (
        <ModalLicitacion
          mensajeBase={modalLicitacion.mensajeBase}
          onCerrar={() => setModalLicitacion(null)}
          onRegistrar={registrarLicitacion}
        />
      )}
      {modalNuevaSala && (
        <ModalNuevaSala
          perfiles={perfiles}
          yoEmail={yo.email}
          onCerrar={() => setModalNuevaSala(false)}
          onCrear={crearSala}
        />
      )}
      {modalMiembros && (
        <ModalMiembros
          sala={modalMiembros}
          miembros={miembrosPorSala[modalMiembros.id] || []}
          perfiles={perfiles}
          yoEmail={yo.email}
          onCerrar={() => setModalMiembros(null)}
          onAgregar={(nuevos) => agregarMiembrosSala(modalMiembros.id, nuevos)}
          onEliminarSala={() => eliminarSala(modalMiembros)}
        />
      )}
      {confirmacion && (
        <ModalConfirmacion
          {...confirmacion}
          onCerrar={() => setConfirmacion(null)}
        />
      )}
      {visorImagen && <VisorImagen url={visorImagen} onCerrar={() => setVisorImagen(null)} />}
    </div>
  );
}

/* ── Subcomponentes ──────────────────────────────────────────────────── */

function SeparadorDia({ iso }) {
  return (
    <div style={{ display: "flex", justifyContent: "center", margin: "12px 0 8px" }}>
      <span
        style={{
          background: "rgba(255,255,255,.96)",
          color: "#475569",
          fontSize: 11.5,
          fontWeight: 700,
          padding: "4px 13px",
          borderRadius: 999,
          boxShadow: "0 1px 3px rgba(16,24,40,.10)",
          textTransform: "capitalize",
          border: `1px solid ${BORDER_SOFT}`,
        }}
      >
        {etiquetaDia(iso)}
      </span>
    </div>
  );
}

function OpcionMenu({ icono: Icono, color, label, sub, onClick }) {
  return (
    <button type="button" className="ch-opcion" onClick={onClick} style={opcionMenu}>
      <span
        style={{
          width: 38,
          height: 38,
          borderRadius: 11,
          background: `${color}1a`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        <Icono size={19} style={{ color }} />
      </span>
      <span style={{ textAlign: "left" }}>
        <span style={{ display: "block", fontSize: 13.5, fontWeight: 700, color: INK }}>
          {label}
        </span>
        <span style={{ display: "block", fontSize: 11.5, color: FAINT }}>{sub}</span>
      </span>
    </button>
  );
}

function BurbujaMensaje({
  m,
  esMio,
  mostrarAutor,
  apilado,
  onVerImagen,
  onAbrirMenu,
  menuAbierto,
  onCerrarMenu,
  onResponder,
  onCrearLicitacion,
  onEditar,
  onEliminar,
}) {
  if (m.tipo === "licitacion") {
    return (
      <TarjetaLicitacion
        m={m}
        esMio={esMio}
        onAbrirMenu={onAbrirMenu}
        menuAbierto={menuAbierto}
        onCerrarMenu={onCerrarMenu}
        onResponder={onResponder}
        onEliminar={onEliminar}
      />
    );
  }

  const esImagen = m.tipo === "imagen";
  const fondo = avatarFondo(m.autor_email || m.autor_nombre);
  const burbujaBg = esImagen ? "#fff" : esMio ? TEAL : "#ffffff";
  const burbujaColor = esMio && !esImagen ? "#fff" : TEXT;

  return (
    <div
      className="ch-msg"
      style={{
        display: "flex",
        gap: 8,
        justifyContent: esMio ? "flex-end" : "flex-start",
        padding: `${apilado ? 1 : 3}px 2px`,
        alignItems: "flex-end",
        position: "relative",
      }}
    >
      {!esMio && (
        <div style={{ width: 30, flexShrink: 0 }}>
          {mostrarAutor && (
            <div
              style={{
                width: 30,
                height: 30,
                borderRadius: "50%",
                background: fondo,
                color: "#fff",
                fontWeight: 700,
                fontSize: 12.5,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                boxShadow: "0 1px 3px rgba(16,24,40,.22)",
              }}
            >
              {inicial(m.autor_nombre, m.autor_email)}
            </div>
          )}
        </div>
      )}

      <div
        className="ch-bubble"
        style={{
          maxWidth: "66%",
          background: burbujaBg,
          color: burbujaColor,
          borderRadius: 16,
          borderBottomRightRadius: esMio ? 5 : 16,
          borderBottomLeftRadius: esMio ? 16 : 5,
          padding: esImagen ? 3 : "7px 11px 6px",
          boxShadow: esMio
            ? "0 2px 6px -2px rgba(15,118,110,.45)"
            : "0 1px 2px rgba(16,24,40,.06), 0 1px 3px rgba(16,24,40,.06)",
          minWidth: esImagen ? 0 : 80,
          position: "relative",
        }}
      >
        {/* Botón de acciones del mensaje */}
        <button
          type="button"
          className="ch-msg-action"
          onClick={onAbrirMenu}
          title="Acciones"
          style={{
            ...botonAcciones,
            background: "#ffffff",
            color: esMio ? "#178a8f" : "#475569",
            right: esMio ? -10 : "auto",
            left: esMio ? "auto" : -10,
            top: -10,
          }}
        >
          <MoreVertical size={15} strokeWidth={2.4} />
        </button>

        {menuAbierto && (
          <MenuAccionesMensaje
            esMio={esMio}
            tipo={m.tipo}
            onResponder={onResponder}
            onCrearLicitacion={onCrearLicitacion}
            onEditar={onEditar}
            onEliminar={onEliminar}
            onCerrar={onCerrarMenu}
          />
        )}

        {mostrarAutor && !esMio && !esImagen && (
          <div
            style={{
              fontSize: 12,
              fontWeight: 800,
              color: avatarTexto(m.autor_email || m.autor_nombre),
              marginBottom: 3,
              paddingRight: 22,
            }}
          >
            {primerNombre(m.autor_nombre, m.autor_email)}
          </div>
        )}

        {/* Quote de respuesta */}
        {m.responde_a_id && (
          <div
            style={{
              background: esMio ? "rgba(255,255,255,.16)" : "#f1f5f9",
              borderLeft: `3px solid ${esMio ? "rgba(255,255,255,.6)" : TEAL}`,
              borderRadius: 8,
              padding: "5px 8px",
              marginBottom: 5,
              fontSize: 12,
            }}
          >
            <div
              style={{
                fontWeight: 700,
                color: esMio ? "rgba(255,255,255,.95)" : TEAL_DEEP,
                marginBottom: 1,
              }}
            >
              {m.responde_a_autor || "Mensaje"}
            </div>
            <div
              style={{
                color: esMio ? "rgba(255,255,255,.85)" : MUTED,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                maxWidth: 280,
              }}
            >
              {m.responde_a_texto || "—"}
            </div>
          </div>
        )}

        <ContenidoMensaje m={m} esMio={esMio} onVerImagen={onVerImagen} />

        {!esImagen && (
          <div
            style={{
              fontSize: 10.5,
              color: esMio ? "rgba(255,255,255,.7)" : FAINT,
              textAlign: "right",
              marginTop: 2,
              display: "flex",
              gap: 5,
              justifyContent: "flex-end",
              alignItems: "center",
            }}
          >
            {m.editado_at && (
              <span style={{ fontStyle: "italic", opacity: 0.8 }}>editado</span>
            )}
            <span>{fmtHora(m.created_at)}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function MenuAccionesMensaje({ esMio, tipo, onResponder, onCrearLicitacion, onEditar, onEliminar, onCerrar }) {
  return (
    <>
      <div
        onClick={onCerrar}
        style={{ position: "fixed", inset: 0, zIndex: 30 }}
      />
      <div
        className="ch-menu"
        style={{
          position: "absolute",
          top: 28,
          [esMio ? "right" : "left"]: 4,
          zIndex: 31,
          background: "#fff",
          borderRadius: 11,
          border: `1px solid ${BORDER}`,
          boxShadow: "0 14px 32px -10px rgba(16,24,40,.28)",
          padding: 5,
          minWidth: 210,
        }}
      >
        <button
          type="button"
          className="ch-opcion"
          onClick={onResponder}
          style={opcionMenuMini}
        >
          <CornerUpLeft size={15} style={{ color: TEAL, flexShrink: 0 }} />
          <span style={{ fontSize: 13, fontWeight: 600, color: INK }}>Responder</span>
        </button>
        {tipo !== "licitacion" && (
          <button
            type="button"
            className="ch-opcion"
            onClick={onCrearLicitacion}
            style={opcionMenuMini}
          >
            <ClipboardList size={15} style={{ color: TEAL, flexShrink: 0 }} />
            <span style={{ fontSize: 13, fontWeight: 600, color: INK }}>Crear licitación</span>
          </button>
        )}
        {esMio && tipo === "texto" && onEditar && (
          <button
            type="button"
            className="ch-opcion"
            onClick={onEditar}
            style={opcionMenuMini}
          >
            <Pencil size={15} style={{ color: "#b45309", flexShrink: 0 }} />
            <span style={{ fontSize: 13, fontWeight: 600, color: INK }}>Editar mensaje</span>
          </button>
        )}
        {esMio && onEliminar && (
          <>
            <div style={{ height: 1, background: BORDER_SOFT, margin: "4px 6px" }} />
            <button
              type="button"
              className="ch-opcion"
              onClick={onEliminar}
              style={opcionMenuMini}
            >
              <Trash2 size={15} style={{ color: "#dc2626", flexShrink: 0 }} />
              <span style={{ fontSize: 13, fontWeight: 600, color: "#dc2626" }}>Eliminar mensaje</span>
            </button>
          </>
        )}
      </div>
    </>
  );
}

function ContenidoMensaje({ m, esMio, onVerImagen }) {
  if (m.tipo === "imagen") {
    return (
      <div
        style={{
          position: "relative",
          borderRadius: 13,
          overflow: "hidden",
          lineHeight: 0,
          maxWidth: 300,
        }}
      >
        <img
          src={m.adjunto_url}
          alt={m.adjunto_nombre || "imagen"}
          onClick={() => onVerImagen(m.adjunto_url)}
          style={{
            display: "block",
            width: "100%",
            maxHeight: 340,
            objectFit: "cover",
            cursor: "zoom-in",
          }}
        />
        <div
          style={{
            position: "absolute",
            right: 7,
            bottom: 7,
            background: "rgba(15,23,42,.55)",
            color: "#fff",
            fontSize: 10.5,
            fontWeight: 600,
            padding: "2px 8px",
            borderRadius: 999,
          }}
        >
          {fmtHora(m.created_at)}
        </div>
      </div>
    );
  }

  if (m.tipo === "pdf") {
    return (
      <a
        href={m.adjunto_url}
        target="_blank"
        rel="noreferrer"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          textDecoration: "none",
          color: "inherit",
          padding: "2px 0",
        }}
      >
        <span
          style={{
            width: 40,
            height: 40,
            borderRadius: 10,
            background: esMio ? "rgba(255,255,255,.18)" : "#fee2e2",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <FileText size={20} style={{ color: esMio ? "#fff" : "#dc2626" }} />
        </span>
        <span style={{ minWidth: 0 }}>
          <span
            style={{
              display: "block",
              fontWeight: 700,
              fontSize: 13,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              maxWidth: 180,
            }}
          >
            {m.adjunto_nombre || "Documento.pdf"}
          </span>
          <span
            style={{
              display: "block",
              fontSize: 11,
              color: esMio ? "rgba(255,255,255,.7)" : FAINT,
            }}
          >
            PDF · {fmtTamano(m.adjunto_tamano)}
          </span>
        </span>
        <Download size={16} style={{ flexShrink: 0, opacity: 0.8 }} />
      </a>
    );
  }

  if (m.tipo === "audio") {
    return <ReproductorAudio url={m.adjunto_url} duracion={m.audio_duracion} esMio={esMio} />;
  }

  if (m.tipo === "sistema") {
    return (
      <div style={{ fontSize: 12.5, fontStyle: "italic", color: esMio ? "#fff" : MUTED }}>
        {m.texto}
      </div>
    );
  }

  return (
    <div style={{ fontSize: 13.5, lineHeight: 1.45, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
      {m.texto}
    </div>
  );
}

/* Tarjeta de licitación: ahora compacta. */
function TarjetaLicitacion({ m, esMio, onAbrirMenu, menuAbierto, onCerrarMenu, onResponder, onEliminar }) {
  const estado = m.licitacion_estado || "Pendiente";
  const ingresada = estado === "Ingresada";
  return (
    <div className="ch-msg" style={{ display: "flex", justifyContent: "center", padding: "5px 4px" }}>
      <div
        style={{
          width: "100%",
          maxWidth: 340,
          borderRadius: 12,
          background: "#fff",
          border: `1px solid ${BORDER}`,
          padding: "9px 12px",
          boxShadow: "0 2px 6px -2px rgba(15,118,110,.18), 0 1px 2px rgba(16,24,40,.06)",
          position: "relative",
        }}
      >
        <button
          type="button"
          className="ch-msg-action"
          onClick={onAbrirMenu}
          title="Acciones"
          style={{
            ...botonAcciones,
            background: "#ffffff",
            color: "#475569",
            right: -10,
            top: -10,
          }}
        >
          <MoreVertical size={15} strokeWidth={2.4} />
        </button>
        {menuAbierto && (
          <MenuAccionesMensaje
            esMio={esMio}
            tipo="licitacion"
            onResponder={onResponder}
            onCrearLicitacion={onCerrarMenu /* ya es una licitación */}
            onEliminar={onEliminar}
            onCerrar={onCerrarMenu}
          />
        )}

        <div style={{ display: "flex", alignItems: "center", gap: 8, paddingRight: 26 }}>
          <span
            style={{
              width: 30,
              height: 30,
              borderRadius: 8,
              background: ingresada ? "#dcfce7" : "#fef3c7",
              color: ingresada ? "#15803d" : "#b45309",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            {ingresada ? <Check size={15} strokeWidth={2.8} /> : <ClipboardList size={15} />}
          </span>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div
              style={{
                fontSize: 10.5,
                fontWeight: 700,
                letterSpacing: ".06em",
                textTransform: "uppercase",
                color: ingresada ? "#15803d" : "#b45309",
              }}
            >
              Licitación · {estado}
            </div>
            <div
              style={{
                fontSize: 14.5,
                fontWeight: 800,
                color: INK,
                letterSpacing: "-.01em",
                wordBreak: "break-word",
                lineHeight: 1.2,
                marginTop: 1,
              }}
            >
              {m.licitacion_id || "—"}
            </div>
          </div>
        </div>
        {m.texto && (
          <div
            style={{
              marginTop: 6,
              fontSize: 12,
              lineHeight: 1.45,
              color: TEXT,
              background: "#f8fafc",
              border: `1px solid ${BORDER_SOFT}`,
              borderRadius: 7,
              padding: "5px 8px",
              maxHeight: 60,
              overflow: "hidden",
              display: "-webkit-box",
              WebkitLineClamp: 3,
              WebkitBoxOrient: "vertical",
            }}
          >
            {m.texto}
          </div>
        )}
        <div style={{ fontSize: 10.5, color: FAINT, marginTop: 6 }}>
          {primerNombre(m.autor_nombre, m.autor_email)} · {fmtHora(m.created_at)}
        </div>
      </div>
    </div>
  );
}

function ReproductorAudio({ url, duracion, esMio }) {
  const audioRef = useRef(null);
  const [reproduciendo, setReproduciendo] = useState(false);
  const [progreso, setProgreso] = useState(0);
  const [actual, setActual] = useState(0);

  function toggle() {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) a.play();
    else a.pause();
  }

  const colorBase = esMio ? "rgba(255,255,255,.35)" : "#cbd5e1";
  const colorActivo = esMio ? "#fff" : TEAL;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 210, padding: "2px 0" }}>
      <audio
        ref={audioRef}
        src={url}
        preload="metadata"
        onPlay={() => setReproduciendo(true)}
        onPause={() => setReproduciendo(false)}
        onEnded={() => {
          setReproduciendo(false);
          setProgreso(0);
          setActual(0);
        }}
        onTimeUpdate={(e) => {
          const a = e.target;
          if (a.duration && Number.isFinite(a.duration)) {
            setProgreso(a.currentTime / a.duration);
            setActual(a.currentTime);
          } else {
            setActual(a.currentTime);
          }
        }}
      />
      <button
        type="button"
        onClick={toggle}
        style={{
          width: 34,
          height: 34,
          borderRadius: "50%",
          border: "none",
          background: esMio ? "rgba(255,255,255,.22)" : TEAL,
          color: "#fff",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        {reproduciendo ? <Pause size={16} /> : <Play size={16} style={{ marginLeft: 2 }} />}
      </button>
      <div style={{ flex: 1, minWidth: 90 }}>
        <div style={{ height: 4, background: colorBase, borderRadius: 3, overflow: "hidden" }}>
          <div
            style={{
              width: `${Math.min(100, progreso * 100)}%`,
              height: "100%",
              background: colorActivo,
              transition: "width .1s linear",
            }}
          />
        </div>
      </div>
      <span
        style={{
          fontSize: 11,
          fontVariantNumeric: "tabular-nums",
          color: esMio ? "rgba(255,255,255,.85)" : MUTED,
          flexShrink: 0,
        }}
      >
        {fmtDuracion(reproduciendo || actual > 0 ? actual : duracion || 0)}
      </span>
    </div>
  );
}

function ModalLicitacion({ mensajeBase, onCerrar, onRegistrar }) {
  const [id, setId] = useState("");
  const [id2, setId2] = useState("");
  const [estado, setEstado] = useState("Pendiente");
  const [obs, setObs] = useState(mensajeBase ? resumenMensaje(mensajeBase).slice(0, 500) : "");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  async function guardar() {
    const primero = id.trim();
    const segundo = id2.trim();
    if (!primero) {
      setError("Ingresa el ID de la licitación.");
      return;
    }
    if (segundo && segundo === primero) {
      setError("Los dos IDs deben ser distintos.");
      return;
    }
    setGuardando(true);
    setError("");
    try {
      await onRegistrar({
        id_cotizacion: primero,
        estado,
        observaciones: obs.trim() || null,
      });
      if (segundo) {
        await onRegistrar({
          id_cotizacion: segundo,
          estado,
          observaciones: obs.trim() || null,
        });
      }
      onCerrar();
    } catch (e) {
      setError(e?.message || "No se pudo registrar la licitación.");
      setGuardando(false);
    }
  }

  return createPortal(
    <div
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !guardando) onCerrar();
      }}
      style={overlayModal}
    >
      <div style={cajaModal} className="ch-pop">
        <div style={headerModal}>
          <div style={{ display: "flex", alignItems: "center", gap: 9, fontWeight: 700, fontSize: 15 }}>
            <ClipboardList size={18} /> Registrar licitación tomada
          </div>
          <button
            type="button"
            onClick={() => !guardando && onCerrar()}
            style={{ background: "rgba(255,255,255,.15)", border: "none", color: "#fff", cursor: "pointer", padding: 5, borderRadius: 8, display: "inline-flex" }}
          >
            <X size={17} />
          </button>
        </div>

        <div style={{ padding: 20 }}>
          {mensajeBase && (
            <div style={previewBase}>
              <div style={{ fontSize: 10.5, fontWeight: 700, color: TEAL_DEEP, marginBottom: 3, letterSpacing: ".04em", textTransform: "uppercase" }}>
                Basado en este mensaje
              </div>
              <div style={{ fontSize: 12.5, color: TEXT, lineHeight: 1.45 }}>
                <strong>{primerNombre(mensajeBase.autor_nombre, mensajeBase.autor_email)}:</strong>{" "}
                {resumenMensaje(mensajeBase) || "—"}
              </div>
            </div>
          )}

          <p style={{ margin: "0 0 16px", fontSize: 12.5, color: MUTED, lineHeight: 1.55 }}>
            Esto registra la licitación en la bitácora y avisa al equipo con una
            tarjeta en el chat.
          </p>

          <CampoModal etiqueta="ID de licitación / cotización">
            <input
              autoFocus
              type="text"
              value={id}
              onChange={(e) => setId(e.target.value)}
              placeholder="Ej: 1234-56-LR23"
              disabled={guardando}
              style={inputModal}
              className="ch-input-modal"
            />
          </CampoModal>

          <CampoModal etiqueta="Segundo ID (opcional)">
            <input
              type="text"
              value={id2}
              onChange={(e) => setId2(e.target.value)}
              placeholder="Otra licitación a registrar junto a la anterior"
              disabled={guardando}
              style={inputModal}
              className="ch-input-modal"
            />
            <p style={{ margin: "6px 2px 0", fontSize: 11.5, color: MUTED, lineHeight: 1.45 }}>
              Si lo completas, se registran 2 licitaciones y se publican 2 tarjetas en el chat.
            </p>
          </CampoModal>

          <CampoModal etiqueta="Estado">
            <div style={{ display: "flex", gap: 8 }}>
              {["Pendiente", "Ingresada"].map((op) => {
                const activo = estado === op;
                const ing = op === "Ingresada";
                return (
                  <button
                    key={op}
                    type="button"
                    onClick={() => setEstado(op)}
                    disabled={guardando}
                    style={{
                      flex: 1,
                      padding: "9px 10px",
                      borderRadius: 10,
                      border: "1.5px solid",
                      borderColor: activo ? (ing ? "#15803d" : "#b45309") : "#e2e8f0",
                      background: activo ? (ing ? "#dcfce7" : "#fef3c7") : "#fff",
                      color: activo ? (ing ? "#15803d" : "#92400e") : MUTED,
                      fontWeight: 700,
                      fontSize: 13,
                      cursor: "pointer",
                    }}
                  >
                    {op}
                  </button>
                );
              })}
            </div>
          </CampoModal>

          <CampoModal etiqueta="Observación (opcional)">
            <textarea
              value={obs}
              onChange={(e) => setObs(e.target.value)}
              placeholder="Nota para el equipo…"
              rows={3}
              disabled={guardando}
              style={{ ...inputModal, height: "auto", minHeight: 70, resize: "vertical", fontFamily: "inherit" }}
              className="ch-input-modal"
            />
          </CampoModal>

          {error && (
            <div style={errorModal}>
              <AlertCircle size={15} /> {error}
            </div>
          )}
        </div>

        <div style={footerModal}>
          <button
            type="button"
            onClick={() => !guardando && onCerrar()}
            disabled={guardando}
            style={btnSecundario}
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={guardar}
            disabled={guardando}
            className="ch-primary"
            style={btnPrincipal}
          >
            {guardando ? (
              <Loader2 size={15} style={{ animation: "ch-spin 1s linear infinite" }} />
            ) : (
              <ClipboardList size={15} />
            )}
            {guardando ? "Registrando…" : "Registrar y avisar"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function ModalNuevaSala({ perfiles, yoEmail, onCerrar, onCrear }) {
  const [nombre, setNombre] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [seleccionados, setSeleccionados] = useState([]);
  const [busqueda, setBusqueda] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  const perfilesFiltrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return perfiles
      .filter((p) => p.email && p.email.toLowerCase() !== yoEmail)
      .filter((p) => {
        if (!q) return true;
        return (
          (p.nombre || "").toLowerCase().includes(q) ||
          (p.email || "").toLowerCase().includes(q)
        );
      });
  }, [perfiles, busqueda, yoEmail]);

  function toggle(email) {
    setSeleccionados((prev) =>
      prev.includes(email) ? prev.filter((e) => e !== email) : [...prev, email],
    );
  }

  async function guardar() {
    if (!nombre.trim()) {
      setError("Ingresa el nombre de la sala.");
      return;
    }
    if (seleccionados.length === 0) {
      setError("Selecciona al menos un miembro.");
      return;
    }
    setGuardando(true);
    setError("");
    try {
      await onCrear({
        nombre: nombre.trim(),
        descripcion: descripcion.trim(),
        miembros: seleccionados,
      });
      onCerrar();
    } catch (e) {
      setError(e?.message || "No se pudo crear la sala.");
      setGuardando(false);
    }
  }

  return createPortal(
    <div
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !guardando) onCerrar();
      }}
      style={overlayModal}
    >
      <div style={{ ...cajaModal, width: 520 }} className="ch-pop">
        <div style={headerModal}>
          <div style={{ display: "flex", alignItems: "center", gap: 9, fontWeight: 700, fontSize: 15 }}>
            <Hash size={18} /> Nueva sala de grupo
          </div>
          <button
            type="button"
            onClick={() => !guardando && onCerrar()}
            style={{ background: "rgba(255,255,255,.15)", border: "none", color: "#fff", cursor: "pointer", padding: 5, borderRadius: 8, display: "inline-flex" }}
          >
            <X size={17} />
          </button>
        </div>

        <div style={{ padding: 20 }}>
          <CampoModal etiqueta="Nombre">
            <input
              autoFocus
              type="text"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              placeholder="Ej: Clínica Dental Las Condes"
              disabled={guardando}
              style={inputModal}
              className="ch-input-modal"
            />
          </CampoModal>

          <CampoModal etiqueta="Descripción (opcional)">
            <input
              type="text"
              value={descripcion}
              onChange={(e) => setDescripcion(e.target.value)}
              placeholder="Tema o propósito de la sala"
              disabled={guardando}
              style={inputModal}
              className="ch-input-modal"
            />
          </CampoModal>

          <CampoModal etiqueta={`Miembros (${seleccionados.length} seleccionados)`}>
            <div style={{ position: "relative", marginBottom: 8 }}>
              <Search size={15} style={{ position: "absolute", left: 11, top: 12, color: FAINT }} />
              <input
                type="text"
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                placeholder="Buscar por nombre o email…"
                disabled={guardando}
                style={{ ...inputModal, paddingLeft: 34 }}
                className="ch-input-modal"
              />
            </div>
            <div className="ch-scroll" style={listaMiembros}>
              {perfilesFiltrados.length === 0 ? (
                <div style={{ padding: 14, fontSize: 12.5, color: FAINT, textAlign: "center" }}>
                  No hay perfiles que coincidan.
                </div>
              ) : (
                perfilesFiltrados.map((p) => {
                  const sel = seleccionados.includes(p.email.toLowerCase());
                  return (
                    <button
                      key={p.email}
                      type="button"
                      onClick={() => toggle(p.email.toLowerCase())}
                      className="ch-opcion"
                      style={{
                        ...itemMiembro,
                        background: sel ? TEAL_SOFT : "transparent",
                      }}
                    >
                      <span
                        style={{
                          width: 32,
                          height: 32,
                          borderRadius: "50%",
                          background: avatarFondo(p.email),
                          color: "#fff",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontWeight: 700,
                          fontSize: 12,
                          flexShrink: 0,
                        }}
                      >
                        {inicial(p.nombre, p.email)}
                      </span>
                      <span style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
                        <span style={{ display: "block", fontSize: 13, fontWeight: 700, color: INK, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {p.nombre || p.email}
                        </span>
                        <span style={{ display: "block", fontSize: 11, color: FAINT, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {p.email}
                        </span>
                      </span>
                      {sel ? (
                        <CheckSquare size={18} style={{ color: TEAL }} />
                      ) : (
                        <Square size={18} style={{ color: "#cbd5e1" }} />
                      )}
                    </button>
                  );
                })
              )}
            </div>
          </CampoModal>

          {error && (
            <div style={errorModal}>
              <AlertCircle size={15} /> {error}
            </div>
          )}
        </div>

        <div style={footerModal}>
          <button
            type="button"
            onClick={() => !guardando && onCerrar()}
            disabled={guardando}
            style={btnSecundario}
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={guardar}
            disabled={guardando}
            className="ch-primary"
            style={btnPrincipal}
          >
            {guardando ? (
              <Loader2 size={15} style={{ animation: "ch-spin 1s linear infinite" }} />
            ) : (
              <Plus size={15} />
            )}
            {guardando ? "Creando…" : "Crear sala"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function ModalMiembros({ sala, miembros, perfiles, yoEmail, onCerrar, onAgregar, onEliminarSala }) {
  const [busqueda, setBusqueda] = useState("");
  const [seleccionados, setSeleccionados] = useState([]);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const setMiembros = useMemo(() => new Set(miembros.map((e) => e.toLowerCase())), [miembros]);
  const esCreador = (sala.creada_por || "").toLowerCase() === yoEmail.toLowerCase();

  const perfilesFiltrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return perfiles
      .filter((p) => p.email && !setMiembros.has(p.email.toLowerCase()))
      .filter((p) => {
        if (!q) return true;
        return (
          (p.nombre || "").toLowerCase().includes(q) ||
          (p.email || "").toLowerCase().includes(q)
        );
      });
  }, [perfiles, busqueda, setMiembros]);

  function toggle(email) {
    setSeleccionados((prev) =>
      prev.includes(email) ? prev.filter((e) => e !== email) : [...prev, email],
    );
  }

  async function guardar() {
    if (seleccionados.length === 0) {
      onCerrar();
      return;
    }
    setGuardando(true);
    setError("");
    try {
      await onAgregar(seleccionados);
      onCerrar();
    } catch (e) {
      setError(e?.message || "No se pudieron agregar los miembros.");
      setGuardando(false);
    }
  }

  const miembrosActuales = useMemo(() => {
    return perfiles
      .filter((p) => p.email && setMiembros.has(p.email.toLowerCase()))
      .sort((a, b) => (a.nombre || a.email).localeCompare(b.nombre || b.email));
  }, [perfiles, setMiembros]);

  return createPortal(
    <div
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !guardando) onCerrar();
      }}
      style={overlayModal}
    >
      <div style={{ ...cajaModal, width: 520 }} className="ch-pop">
        <div style={headerModal}>
          <div style={{ display: "flex", alignItems: "center", gap: 9, fontWeight: 700, fontSize: 15 }}>
            <Users size={18} /> Miembros de #{sala.nombre}
          </div>
          <button
            type="button"
            onClick={() => !guardando && onCerrar()}
            style={{ background: "rgba(255,255,255,.15)", border: "none", color: "#fff", cursor: "pointer", padding: 5, borderRadius: 8, display: "inline-flex" }}
          >
            <X size={17} />
          </button>
        </div>

        <div style={{ padding: 20 }}>
          <CampoModal etiqueta={`Miembros actuales (${miembrosActuales.length})`}>
            <div className="ch-scroll" style={{ ...listaMiembros, maxHeight: 150 }}>
              {miembrosActuales.length === 0 ? (
                <div style={{ padding: 12, fontSize: 12.5, color: FAINT, textAlign: "center" }}>
                  Sin miembros.
                </div>
              ) : (
                miembrosActuales.map((p) => (
                  <div key={p.email} style={{ ...itemMiembro, cursor: "default" }}>
                    <span
                      style={{
                        width: 32,
                        height: 32,
                        borderRadius: "50%",
                        background: avatarFondo(p.email),
                        color: "#fff",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontWeight: 700,
                        fontSize: 12,
                        flexShrink: 0,
                      }}
                    >
                      {inicial(p.nombre, p.email)}
                    </span>
                    <span style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
                      <span style={{ display: "block", fontSize: 13, fontWeight: 700, color: INK, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {p.nombre || p.email}
                      </span>
                      <span style={{ display: "block", fontSize: 11, color: FAINT, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {p.email}
                      </span>
                    </span>
                  </div>
                ))
              )}
            </div>
          </CampoModal>

          {esCreador && (
            <CampoModal etiqueta={`Agregar miembros (${seleccionados.length} seleccionados)`}>
              <div style={{ position: "relative", marginBottom: 8 }}>
                <Search size={15} style={{ position: "absolute", left: 11, top: 12, color: FAINT }} />
                <input
                  type="text"
                  value={busqueda}
                  onChange={(e) => setBusqueda(e.target.value)}
                  placeholder="Buscar por nombre o email…"
                  disabled={guardando}
                  style={{ ...inputModal, paddingLeft: 34 }}
                  className="ch-input-modal"
                />
              </div>
              <div className="ch-scroll" style={listaMiembros}>
                {perfilesFiltrados.length === 0 ? (
                  <div style={{ padding: 14, fontSize: 12.5, color: FAINT, textAlign: "center" }}>
                    No hay perfiles disponibles.
                  </div>
                ) : (
                  perfilesFiltrados.map((p) => {
                    const sel = seleccionados.includes(p.email.toLowerCase());
                    return (
                      <button
                        key={p.email}
                        type="button"
                        onClick={() => toggle(p.email.toLowerCase())}
                        className="ch-opcion"
                        style={{
                          ...itemMiembro,
                          background: sel ? TEAL_SOFT : "transparent",
                        }}
                      >
                        <span
                          style={{
                            width: 32,
                            height: 32,
                            borderRadius: "50%",
                            background: avatarFondo(p.email),
                            color: "#fff",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontWeight: 700,
                            fontSize: 12,
                            flexShrink: 0,
                          }}
                        >
                          {inicial(p.nombre, p.email)}
                        </span>
                        <span style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
                          <span style={{ display: "block", fontSize: 13, fontWeight: 700, color: INK, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {p.nombre || p.email}
                          </span>
                          <span style={{ display: "block", fontSize: 11, color: FAINT, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {p.email}
                          </span>
                        </span>
                        {sel ? (
                          <CheckSquare size={18} style={{ color: TEAL }} />
                        ) : (
                          <Square size={18} style={{ color: "#cbd5e1" }} />
                        )}
                      </button>
                    );
                  })
                )}
              </div>
            </CampoModal>
          )}

          {!esCreador && (
            <div style={{ fontSize: 12, color: MUTED, padding: "6px 2px" }}>
              Solo el creador de la sala puede agregar nuevos miembros.
            </div>
          )}

          {error && (
            <div style={errorModal}>
              <AlertCircle size={15} /> {error}
            </div>
          )}
        </div>

        <div style={footerModal}>
          {esCreador && !sala.es_general && (
            <button
              type="button"
              onClick={onEliminarSala}
              disabled={guardando}
              style={btnPeligro}
              title="Eliminar la sala completa"
            >
              <Trash2 size={14} />
              Eliminar sala
            </button>
          )}
          <button
            type="button"
            onClick={() => !guardando && onCerrar()}
            disabled={guardando}
            style={{ ...btnSecundario, marginLeft: esCreador && !sala.es_general ? "auto" : 0 }}
          >
            Cerrar
          </button>
          {esCreador && (
            <button
              type="button"
              onClick={guardar}
              disabled={guardando || seleccionados.length === 0}
              className="ch-primary"
              style={btnPrincipal}
            >
              {guardando ? (
                <Loader2 size={15} style={{ animation: "ch-spin 1s linear infinite" }} />
              ) : (
                <UserPlus size={15} />
              )}
              {guardando ? "Agregando…" : "Agregar"}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function ModalConfirmacion({ titulo, mensaje, etiquetaConfirmar = "Confirmar", peligro = false, onConfirmar, onCerrar }) {
  const [procesando, setProcesando] = useState(false);
  const [error, setError] = useState("");

  async function ejecutar() {
    setProcesando(true);
    setError("");
    try {
      await onConfirmar();
      onCerrar();
    } catch (e) {
      setError(e?.message || "No se pudo completar la acción.");
      setProcesando(false);
    }
  }

  const color = peligro ? "#dc2626" : TEAL;
  const colorBg = peligro ? "#fee2e2" : TEAL_SOFT;

  return createPortal(
    <div
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !procesando) onCerrar();
      }}
      style={overlayModal}
    >
      <div style={{ ...cajaModal, width: 420 }} className="ch-pop">
        <div style={{ padding: "20px 22px 8px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
            <div
              style={{
                width: 40,
                height: 40,
                borderRadius: 11,
                background: colorBg,
                color,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <AlertCircle size={20} />
            </div>
            <div style={{ fontSize: 15.5, fontWeight: 800, color: INK }}>{titulo}</div>
          </div>
          <p style={{ margin: 0, fontSize: 13, color: MUTED, lineHeight: 1.55 }}>{mensaje}</p>
          {error && (
            <div style={{ ...errorModal, marginTop: 12 }}>
              <AlertCircle size={15} /> {error}
            </div>
          )}
        </div>
        <div style={footerModal}>
          <button
            type="button"
            onClick={() => !procesando && onCerrar()}
            disabled={procesando}
            style={btnSecundario}
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={ejecutar}
            disabled={procesando}
            style={peligro ? btnPeligroPrincipal : btnPrincipal}
          >
            {procesando ? (
              <Loader2 size={15} style={{ animation: "ch-spin 1s linear infinite" }} />
            ) : peligro ? (
              <Trash2 size={14} />
            ) : (
              <Check size={14} />
            )}
            {procesando ? "Procesando…" : etiquetaConfirmar}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function CampoModal({ etiqueta, children }) {
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

function VisorImagen({ url, onCerrar }) {
  return createPortal(
    <div onClick={onCerrar} style={overlayVisor}>
      <button
        type="button"
        onClick={onCerrar}
        style={{
          position: "absolute",
          top: 20,
          right: 24,
          background: "rgba(255,255,255,.15)",
          border: "none",
          color: "#fff",
          borderRadius: 10,
          padding: 8,
          cursor: "pointer",
          display: "inline-flex",
        }}
      >
        <X size={22} />
      </button>
      <img
        src={url}
        alt="adjunto"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: "92vw", maxHeight: "88vh", borderRadius: 12, boxShadow: "0 20px 60px rgba(0,0,0,.5)" }}
      />
    </div>,
    document.body,
  );
}

/* ── Estilos ─────────────────────────────────────────────────────────── */
const ESTILOS = `
  @keyframes ch-spin { to { transform: rotate(360deg); } }
  @keyframes ch-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
  @keyframes ch-pop { from { opacity: 0; transform: scale(.96) translateY(8px); } to { opacity: 1; transform: none; } }
  @keyframes ch-pulse { 0%,100% { opacity: 1; } 50% { opacity: .3; } }
  @keyframes ch-float { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-3px); } }
  @keyframes ch-fade-up { from { opacity: 0; transform: translateY(10px) scale(.98); } to { opacity: 1; transform: none; } }
  .ch-msg { animation: ch-in .18s ease; }
  .ch-msg .ch-msg-action { opacity: 0; transform: scale(.85); transition: opacity .16s ease, transform .16s ease, box-shadow .16s ease; }
  .ch-msg:hover .ch-msg-action { opacity: 1; transform: scale(1); }
  .ch-msg-action:hover { transform: scale(1.1) !important; box-shadow: 0 4px 12px rgba(15,23,42,.25) !important; }
  .ch-menu { animation: ch-pop .15s ease; }
  .ch-pop { animation: ch-pop .18s ease; }
  .ch-fade-up { animation: ch-fade-up .35s ease; }
  .ch-float { animation: ch-float 3.5s ease-in-out infinite; }
  .ch-iconbtn { transition: background .14s ease, color .14s ease, transform .14s ease, box-shadow .14s ease; }
  .ch-input:focus { outline: none; border-color: #0f766e; box-shadow: 0 0 0 3px rgba(15,118,110,.10); }
  .ch-input-modal { transition: border-color .15s ease, box-shadow .15s ease; }
  .ch-input-modal:focus { outline: none; border-color: #0f766e; box-shadow: 0 0 0 3px rgba(15,118,110,.14); }
  .ch-opcion { transition: background .12s ease; }
  .ch-opcion:hover { background: #f1f5f9; }
  .ch-sala { transition: background .18s ease, transform .14s ease; }
  .ch-sala:hover:not(.ch-sala--activa) { background: #eef2f5 !important; transform: translateX(2px); }
  .ch-sala--activa { transform: translateX(0); }
  .ch-btn-nueva:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 6px 14px -3px rgba(15,118,110,.55), inset 0 1px 0 rgba(255,255,255,.25) !important; }
  .ch-primary { transition: background .14s ease, transform .14s ease, box-shadow .14s ease; }
  .ch-primary:hover:not(:disabled) { background: #0b5d57; transform: translateY(-1px); box-shadow: 0 6px 14px -4px rgba(15,118,110,.45); }
  .ch-primary:disabled { opacity: .7; cursor: default; }
  .ch-rec-dot { width: 11px; height: 11px; border-radius: 50%; background: #dc2626; animation: ch-pulse 1s infinite; }
  .ch-rec-dot-pausa { width: 11px; height: 11px; border-radius: 50%; background: #f59e0b; }
  .ch-scroll::-webkit-scrollbar { width: 10px; }
  .ch-scroll::-webkit-scrollbar-thumb { background: #cdd5db; border-radius: 8px; border: 2.5px solid transparent; background-clip: padding-box; }
  .ch-scroll::-webkit-scrollbar-thumb:hover { background: #9aa7b2; background-clip: padding-box; }
  .ch-bubble { transition: transform .14s ease, box-shadow .14s ease; }
`;

const contenedor = {
  display: "flex",
  flexDirection: "row",
  height: "calc(100vh - 230px)",
  minHeight: 480,
  background: SURFACE,
  border: `1px solid ${BORDER}`,
  borderRadius: 18,
  overflow: "hidden",
  boxShadow:
    "0 1px 2px rgba(16,24,40,.04), 0 12px 36px -16px rgba(16,24,40,.12), 0 24px 60px -24px rgba(15,118,110,.10)",
};

const sidebarSalas = {
  display: "flex",
  flexDirection: "column",
  background: BG_SIDEBAR,
  flexShrink: 0,
  overflow: "hidden",
  transition: "width .2s ease",
};

const sidebarHeader = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 10,
  padding: "13px 14px",
  borderBottom: `1px solid ${BORDER}`,
  background: "linear-gradient(180deg, #ffffff 0%, #fbfcfd 100%)",
  flexShrink: 0,
  position: "relative",
};

const iconoSidebar = {
  width: 30,
  height: 30,
  borderRadius: 9,
  background: `linear-gradient(135deg, ${TEAL}, ${TEAL_LIGHT})`,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  boxShadow: `0 4px 10px -3px ${TEAL}77, inset 0 1px 0 rgba(255,255,255,.2)`,
  flexShrink: 0,
};

const btnNuevaSala = {
  width: 30,
  height: 30,
  borderRadius: 9,
  border: "none",
  background: `linear-gradient(135deg, ${TEAL}, ${TEAL_LIGHT})`,
  color: "#fff",
  cursor: "pointer",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  boxShadow: `0 4px 10px -3px ${TEAL}88, inset 0 1px 0 rgba(255,255,255,.2)`,
  flexShrink: 0,
};

const listaSalas = {
  flex: 1,
  overflowY: "auto",
  padding: "8px 7px",
  display: "flex",
  flexDirection: "column",
  gap: 2,
};

const salaItem = {
  display: "flex",
  alignItems: "center",
  gap: 11,
  padding: "9px 11px",
  borderRadius: 10,
  border: "none",
  cursor: "pointer",
  width: "100%",
  textAlign: "left",
  transition: "background .18s ease, transform .14s ease",
};

const salaIcono = {
  width: 32,
  height: 32,
  borderRadius: 9,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  flexShrink: 0,
  transition: "all .2s ease",
};

const pillGeneral = {
  display: "inline-flex",
  alignItems: "center",
  fontSize: 9,
  fontWeight: 800,
  letterSpacing: ".06em",
  textTransform: "uppercase",
  color: TEAL_DARKER,
  background: "rgba(15,118,110,.10)",
  border: "1px solid rgba(15,118,110,.18)",
  padding: "2px 7px",
  borderRadius: 999,
  flexShrink: 0,
};

const pillGeneralHeader = {
  display: "inline-flex",
  alignItems: "center",
  fontSize: 9,
  fontWeight: 800,
  letterSpacing: ".06em",
  textTransform: "uppercase",
  color: TEAL_DARKER,
  background: "rgba(15,118,110,.10)",
  border: "1px solid rgba(15,118,110,.18)",
  padding: "2px 8px",
  borderRadius: 999,
};

const panelChat = {
  flex: 1,
  display: "flex",
  flexDirection: "column",
  minWidth: 0,
};

const chatHeader = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  padding: "12px 18px",
  borderBottom: `1px solid ${BORDER}`,
  background: "linear-gradient(180deg, #ffffff 0%, #fbfcfd 100%)",
  flexShrink: 0,
  position: "relative",
};

const avatarHeader = {
  width: 40,
  height: 40,
  borderRadius: 11,
  background: `linear-gradient(135deg, ${TEAL}, ${TEAL_LIGHT})`,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  flexShrink: 0,
  boxShadow: `0 6px 16px -4px ${TEAL}99, inset 0 1px 0 rgba(255,255,255,.25)`,
};

const zonaMensajes = {
  flex: 1,
  overflowY: "auto",
  padding: "16px 22px 18px",
  background: BG_CHAT,
  backgroundImage: `
    radial-gradient(circle at 18% 8%, rgba(15,118,110,.06), transparent 42%),
    radial-gradient(circle at 82% 92%, rgba(20,184,166,.05), transparent 42%),
    radial-gradient(circle at 50% 50%, rgba(255,255,255,.4), transparent 60%)
  `,
};

const composer = {
  display: "flex",
  alignItems: "flex-end",
  gap: 8,
  padding: "12px 14px",
  borderTop: `1px solid ${BORDER}`,
  background: "linear-gradient(180deg, #fbfcfd 0%, #ffffff 100%)",
  boxShadow: "0 -2px 8px -4px rgba(16,24,40,.05)",
};

const btnCircular = {
  width: 42,
  height: 42,
  borderRadius: "50%",
  border: "none",
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  flexShrink: 0,
};

const btnCircularSm = {
  width: 34,
  height: 34,
  borderRadius: "50%",
  border: "none",
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  flexShrink: 0,
};

const inputTexto = {
  flex: 1,
  resize: "none",
  border: `1px solid ${BORDER}`,
  borderRadius: 22,
  padding: "10px 16px",
  fontSize: 13.5,
  lineHeight: 1.4,
  color: INK,
  background: "#f6f8fa",
  fontFamily: "inherit",
  maxHeight: 120,
  boxSizing: "border-box",
};

const zonaGrabacion = {
  flex: 1,
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "0 14px",
  height: 42,
  background: "#fef2f2",
  border: "1px solid #fecaca",
  borderRadius: 22,
};

const capaCierre = {
  position: "fixed",
  inset: 0,
  zIndex: 40,
};

const menuMas = {
  position: "absolute",
  bottom: 52,
  left: 0,
  zIndex: 41,
  width: 250,
  background: "#fff",
  borderRadius: 14,
  border: `1px solid ${BORDER}`,
  boxShadow: "0 16px 40px -8px rgba(16,24,40,.3)",
  padding: 6,
};

const opcionMenu = {
  display: "flex",
  alignItems: "center",
  gap: 11,
  width: "100%",
  padding: "9px 10px",
  borderRadius: 10,
  border: "none",
  background: "transparent",
  cursor: "pointer",
};

const opcionMenuMini = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  width: "100%",
  padding: "8px 10px",
  borderRadius: 8,
  border: "none",
  background: "transparent",
  cursor: "pointer",
  textAlign: "left",
  whiteSpace: "nowrap",
};

const cajaCentro = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  height: "100%",
  minHeight: 200,
};

const emblemaVacio = {
  width: 88,
  height: 88,
  borderRadius: 26,
  background: `linear-gradient(135deg, ${TEAL_SOFTER}, ${TEAL_SOFT})`,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  marginBottom: 16,
  boxShadow: `0 16px 32px -12px ${TEAL}33, 0 4px 10px -4px rgba(16,24,40,.06)`,
  border: `1px solid rgba(255,255,255,.6)`,
  position: "relative",
};

const emblemaInner = {
  width: 60,
  height: 60,
  borderRadius: 18,
  background: "rgba(255,255,255,.95)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  boxShadow: `inset 0 1px 0 rgba(255,255,255,.9), 0 2px 6px -2px ${TEAL}33`,
};

const avisoError = {
  display: "flex",
  alignItems: "center",
  gap: 7,
  padding: "8px 14px",
  background: "#fef2f2",
  color: "#b91c1c",
  fontSize: 12.5,
  borderTop: "1px solid #fecaca",
};

const avisoNuevaSala = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "10px 14px",
  background: `linear-gradient(135deg, ${TEAL_DEEP}, ${TEAL})`,
  color: "#fff",
  borderTop: `1px solid ${TEAL}`,
  animation: "ch-fade-up .35s ease",
};

const previewRespuesta = {
  display: "flex",
  alignItems: "stretch",
  gap: 10,
  padding: "8px 14px",
  background: "#f8fafc",
  borderTop: `1px solid ${BORDER}`,
  borderBottom: `1px solid ${BORDER_SOFT}`,
};

const previewBase = {
  background: TEAL_SOFT,
  borderLeft: `3px solid ${TEAL}`,
  borderRadius: 8,
  padding: "8px 11px",
  marginBottom: 14,
};

const botonAcciones = {
  position: "absolute",
  width: 26,
  height: 26,
  borderRadius: 999,
  border: "1px solid #e3e7ec",
  cursor: "pointer",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 2,
  boxShadow: "0 2px 8px rgba(15,23,42,.18)",
  transition: "transform .15s ease, box-shadow .15s ease, background .15s ease",
};

const overlayModal = {
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
};

const cajaModal = {
  width: 460,
  maxWidth: "100%",
  background: "#fff",
  borderRadius: 16,
  overflow: "hidden",
  boxShadow: "0 28px 70px rgba(15,23,42,.4)",
};

const headerModal = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "14px 18px",
  background: `linear-gradient(135deg, ${TEAL}, ${TEAL_LIGHT})`,
  color: "#fff",
};

const footerModal = {
  display: "flex",
  justifyContent: "flex-end",
  gap: 10,
  padding: "13px 18px",
  borderTop: `1px solid ${BORDER}`,
  background: "#fbfcfd",
};

const inputModal = {
  width: "100%",
  height: 40,
  padding: "0 12px",
  borderRadius: 9,
  border: `1px solid ${BORDER}`,
  fontSize: 14,
  color: INK,
  boxSizing: "border-box",
  background: "#f8fafb",
};

const errorModal = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "9px 12px",
  background: "#fef2f2",
  border: "1px solid #fecaca",
  color: "#b91c1c",
  borderRadius: 9,
  fontSize: 13,
};

const btnSecundario = {
  height: 40,
  padding: "0 16px",
  borderRadius: 9,
  border: `1px solid ${BORDER}`,
  background: "#fff",
  color: "#334155",
  fontWeight: 600,
  fontSize: 13,
  cursor: "pointer",
};

const btnPrincipal = {
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
};

const btnPeligro = {
  height: 36,
  padding: "0 13px",
  borderRadius: 9,
  border: "1px solid #fecaca",
  background: "#fff",
  color: "#b91c1c",
  fontWeight: 700,
  fontSize: 12.5,
  cursor: "pointer",
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
};

const btnPeligroPrincipal = {
  height: 40,
  padding: "0 18px",
  borderRadius: 9,
  border: "none",
  background: "#dc2626",
  color: "#fff",
  fontWeight: 700,
  fontSize: 13,
  cursor: "pointer",
  display: "inline-flex",
  alignItems: "center",
  gap: 7,
};

const listaMiembros = {
  maxHeight: 240,
  overflowY: "auto",
  border: `1px solid ${BORDER}`,
  borderRadius: 9,
  background: "#fff",
  padding: 4,
  display: "flex",
  flexDirection: "column",
  gap: 2,
};

const itemMiembro = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  width: "100%",
  padding: "6px 9px",
  borderRadius: 8,
  border: "none",
  background: "transparent",
  cursor: "pointer",
};

const overlayVisor = {
  position: "fixed",
  inset: 0,
  background: "rgba(8,12,20,.92)",
  zIndex: 12000,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "zoom-out",
};
