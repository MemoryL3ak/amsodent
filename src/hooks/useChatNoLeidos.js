// Cuenta los mensajes de chat sin leer en TODAS las salas del usuario, en
// tiempo real, sin depender de que la página del Chat Grupal esté abierta.
// Sirve para mostrar un badge de "mensajes pendientes" en el sidebar y,
// además, AVISA cuando llega un mensaje nuevo:
//  - Pestaña oculta/minimizada → notificación del sistema (Web Notifications).
//  - Pestaña visible pero fuera del Chat Grupal → aviso flotante in-app
//    (estado `aviso` que renderiza SidebarLayout).
//  - Dentro del Chat Grupal con la pestaña visible → no se avisa (la página
//    ya muestra sus propios badges por sala).
//
// Mecánica del conteo:
//  - Al montar: suma, por cada sala donde el usuario es miembro, los mensajes
//    posteriores a su leido_hasta que no escribió él mismo.
//  - INSERT en chat_mensajes (de otra persona, en una sala mía) → incrementa.
//  - UPDATE de mi fila en chat_sala_miembros (leído_hasta = now) → esa sala
//    queda en 0 (es lo que hace la página del chat al abrir/leer una sala).
//  - INSERT/DELETE de mi membresía → mantiene el set de salas al día.
import { useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";

const RUTA_CHAT = "/bitacora-cotizaciones";
const AVISO_MS = 7000;

function resumenMensaje(m) {
  if (!m) return "";
  if (m.tipo === "imagen") return "📷 Imagen";
  if (m.tipo === "pdf") return "📄 " + (m.adjunto_nombre || "PDF");
  if (m.tipo === "audio") return "🎤 Nota de voz";
  if (m.tipo === "licitacion") return `📋 Licitación ${m.licitacion_id || ""}`.trim();
  return (m.texto || "").slice(0, 140);
}

export default function useChatNoLeidos(email) {
  const correo = String(email || "").trim().toLowerCase();
  const [total, setTotal] = useState(0);
  const [aviso, setAviso] = useState(null); // { id, autor, resumen }
  const porSalaRef = useRef({}); // { salaId: count }
  const misSalasRef = useRef(new Set());
  const timerAvisoRef = useRef(null);

  function cerrarAviso() {
    clearTimeout(timerAvisoRef.current);
    setAviso(null);
  }

  // Pedir permiso de notificación una vez (silencioso; si el navegador lo
  // ignora por falta de gesto del usuario, el aviso flotante in-app cubre el
  // caso de pestaña visible y el permiso se termina pidiendo al abrir el chat).
  useEffect(() => {
    try {
      if (typeof Notification !== "undefined" && Notification.permission === "default") {
        Notification.requestPermission().catch(() => {});
      }
    } catch {
      // ignorar
    }
  }, []);

  useEffect(() => () => clearTimeout(timerAvisoRef.current), []);

  useEffect(() => {
    if (!correo) {
      porSalaRef.current = {};
      misSalasRef.current = new Set();
      setTotal(0);
      return undefined;
    }

    let activo = true;
    const recomputar = () => {
      if (!activo) return;
      const t = Object.values(porSalaRef.current).reduce((a, b) => a + (b || 0), 0);
      setTotal(t);
    };

    // Aviso activo por mensaje nuevo. Se decide acá (y no en ChatEquipo)
    // porque este hook vive en el SidebarLayout: está montado en TODA la app.
    const avisar = (m) => {
      if (!activo) return;
      const visible = typeof document === "undefined" || document.visibilityState === "visible";
      const enChat = window.location?.pathname?.startsWith(RUTA_CHAT);
      if (visible && enChat) return; // ya está mirando el chat

      const autor = m.autor_nombre || m.autor_email || "Mensaje nuevo";
      const resumen = resumenMensaje(m) || "Nuevo mensaje en el chat";

      if (!visible) {
        // Pestaña en segundo plano → notificación del sistema. Un tag por
        // sala hace que mensajes seguidos reemplacen el aviso en vez de apilarse.
        try {
          if (typeof Notification !== "undefined" && Notification.permission === "granted") {
            const n = new Notification(`💬 ${autor}`, {
              body: resumen,
              icon: "/favicon.ico",
              tag: `chat-msg-${m.sala_id}`,
            });
            n.onclick = () => {
              try {
                window.focus();
              } catch {
                // ignorar
              }
              // SidebarLayout escucha este evento y navega al Chat Grupal
              // respetando el guard de cambios sin guardar.
              window.dispatchEvent(new CustomEvent("chat:abrir"));
              n.close();
            };
          }
        } catch {
          // ignorar fallas de notificaciones
        }
        return;
      }

      // Visible pero en otra página → aviso flotante (si llegan varios
      // seguidos, el último reemplaza al anterior y reinicia el timer).
      setAviso({ id: m.id, autor, resumen });
      clearTimeout(timerAvisoRef.current);
      timerAvisoRef.current = setTimeout(() => setAviso(null), AVISO_MS);
    };

    (async () => {
      const { data: miembros } = await supabase
        .from("chat_sala_miembros")
        .select("sala_id, leido_hasta")
        .eq("email", correo);
      const ids = (miembros || []).map((m) => m.sala_id);
      misSalasRef.current = new Set(ids);
      const mapaLeido = {};
      (miembros || []).forEach((m) => {
        mapaLeido[m.sala_id] = m.leido_hasta || new Date(0).toISOString();
      });

      const conteo = {};
      await Promise.all(
        ids.map(async (salaId) => {
          const desde = mapaLeido[salaId] || new Date(0).toISOString();
          const { count } = await supabase
            .from("chat_mensajes")
            .select("id", { count: "exact", head: true })
            .eq("sala_id", salaId)
            .gt("created_at", desde)
            .neq("autor_email", correo);
          conteo[salaId] = count || 0;
        }),
      );
      if (!activo) return;
      porSalaRef.current = conteo;
      recomputar();
    })();

    const canalMsg = supabase
      .channel(`sidebar_chat_no_leidos_${correo}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "chat_mensajes" },
        (payload) => {
          const m = payload?.new;
          if (!m?.sala_id) return;
          if ((m.autor_email || "").toLowerCase() === correo) return;
          if (!misSalasRef.current.has(m.sala_id)) return;
          porSalaRef.current[m.sala_id] = (porSalaRef.current[m.sala_id] || 0) + 1;
          recomputar();
          avisar(m);
        },
      )
      .subscribe();

    const filtroEmail = `email=eq.${correo}`;
    const canalMiembros = supabase
      .channel(`sidebar_chat_membresia_${correo}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "chat_sala_miembros", filter: filtroEmail },
        (payload) => {
          const salaId = payload?.new?.sala_id;
          if (!salaId) return;
          // El único UPDATE de esta fila es bumpear leido_hasta al leer la sala.
          porSalaRef.current[salaId] = 0;
          recomputar();
        },
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "chat_sala_miembros", filter: filtroEmail },
        (payload) => {
          const salaId = payload?.new?.sala_id;
          if (salaId) misSalasRef.current.add(salaId);
        },
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "chat_sala_miembros", filter: filtroEmail },
        (payload) => {
          const salaId = payload?.old?.sala_id;
          if (!salaId) return;
          misSalasRef.current.delete(salaId);
          delete porSalaRef.current[salaId];
          recomputar();
        },
      )
      .subscribe();

    return () => {
      activo = false;
      supabase.removeChannel(canalMsg);
      supabase.removeChannel(canalMiembros);
    };
  }, [correo]);

  return { total, aviso, cerrarAviso };
}
