import { useEffect, useRef } from "react";
import { supabase } from "../lib/supabase";

export default function PresenceTracker() {
  const channelRef = useRef(null);
  const trackTimerRef = useRef(null);
  const syncTimerRef = useRef(null);
  const lastActivityRef = useRef(Date.now());
  const trackFnRef = useRef(null);
  // Serializa start/cleanup para que nunca se solapen dos operaciones sobre el
  // canal de presencia (evita el error "cannot add presence callbacks after
  // joining a channel" cuando montaje + onAuthStateChange disparan a la vez).
  const opRef = useRef(Promise.resolve());

  useEffect(() => {
    let stopped = false;

    const touch = () => {
      lastActivityRef.current = Date.now();
    };

    const events = ["mousemove", "mousedown", "keydown", "scroll", "touchstart", "wheel"];
    events.forEach((e) => window.addEventListener(e, touch, { passive: true }));

    const publish = (stateObj) => {
      window.__presenceState = stateObj || {};
      window.dispatchEvent(new Event("presence:usuarios:state"));
    };

    const cleanup = async () => {
      if (trackTimerRef.current) {
        clearInterval(trackTimerRef.current);
        trackTimerRef.current = null;
      }
      if (syncTimerRef.current) {
        clearInterval(syncTimerRef.current);
        syncTimerRef.current = null;
      }

      const ch = channelRef.current;
      channelRef.current = null;
      trackFnRef.current = null;
      window.__presenceChannel = null;

      try {
        if (ch) {
          // best-effort para avisar "me fui"
          try { await ch.untrack(); } catch {}
          // IMPORTANTE: esperar a que el canal se elimine de verdad antes de
          // crear uno nuevo con el mismo topic; si no, supabase-js reutiliza el
          // canal ya unido y .on("presence") lanza error.
          await supabase.removeChannel(ch);
        }
      } catch {
        // best effort
      }

      publish({});
    };

    const start = async () => {
      const { data } = await supabase.auth.getSession();
      const session = data?.session;
      const user = session?.user;
      if (!user || stopped) return;

      // Cierra (y espera) cualquier canal previo ANTES de crear uno nuevo.
      await cleanup();
      if (stopped) return;

      // Perfil
      let nombre = null;
      let email = user.email || null;
      try {
        const { data: prof } = await supabase
          .from("profiles")
          .select("nombre, email")
          .eq("id", user.id)
          .maybeSingle();
        nombre = prof?.nombre || null;
        email = prof?.email || email;
      } catch {}

      if (stopped) return;

      const startedAtIso = new Date().toISOString();

      const channel = supabase.channel("presence:usuarios", {
        config: { presence: { key: user.id } },
      });

      channelRef.current = channel;
      window.__presenceChannel = channel;

      const sync = () => {
        if (stopped) return;
        publish(channel.presenceState());
      };

      const track = async () => {
        try {
          await channel.track({
            user_id: user.id,
            nombre: nombre || email || "Usuario",
            email,
            started_at: startedAtIso,
            last_activity_at: new Date(lastActivityRef.current).toISOString(),
          });
        } catch {
          // best effort
        }
      };
      trackFnRef.current = track;

      // Las callbacks de presence se registran SIEMPRE antes de subscribe().
      channel
        .on("presence", { event: "sync" }, sync)
        .on("presence", { event: "join" }, sync)
        .on("presence", { event: "leave" }, sync)
        .subscribe((status) => {
          if (status === "SUBSCRIBED") {
            track();
            trackTimerRef.current = setInterval(track, 5000);

            sync();
            // "watchdog" para refrescar UI aunque algún evento no dispare
            syncTimerRef.current = setInterval(sync, 2000);
          }
        });
    };

    // Encola operaciones para garantizar que se ejecuten de a una (sin carreras).
    const enqueue = (fn) => {
      opRef.current = opRef.current.then(fn, fn).catch(() => {});
      return opRef.current;
    };

    // cerrar/reabrir presence según visibilidad de la pestaña
    const onVisibility = () => {
      const ch = channelRef.current;
      if (!ch) return;

      if (document.visibilityState === "hidden") {
        // Untrack para que Presence quite rápido al usuario
        ch.untrack().catch(() => {});
      } else {
        // Re-track inmediato al volver a la pestaña
        trackFnRef.current?.();
      }
    };

    const onBeforeUnload = () => {
      try {
        const ch = channelRef.current;
        if (ch) ch.untrack();
      } catch {}
    };

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("beforeunload", onBeforeUnload);

    enqueue(start);

    const { data: sub } = supabase.auth.onAuthStateChange((_evt, session) => {
      enqueue(session ? start : cleanup);
    });

    return () => {
      stopped = true;
      events.forEach((e) => window.removeEventListener(e, touch));
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("beforeunload", onBeforeUnload);
      sub?.subscription?.unsubscribe?.();
      enqueue(cleanup);
    };
  }, []);

  return null;
}
