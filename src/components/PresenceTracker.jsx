import { useEffect, useRef } from "react";
import { supabase } from "../lib/supabase";

export default function PresenceTracker() {
  const channelRef = useRef(null);
  const trackTimerRef = useRef(null);
  const syncTimerRef = useRef(null);
  const lastActivityRef = useRef(Date.now());

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
      window.__presenceChannel = null;

      try {
        if (ch) {
          // best-effort para avisar "me fui"
          await ch.untrack();
          supabase.removeChannel(ch);
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

      await cleanup();

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

      channel
        .on("presence", { event: "sync" }, sync)
        .on("presence", { event: "join" }, sync)
        .on("presence", { event: "leave" }, sync)
        .subscribe((status) => {
          if (status === "SUBSCRIBED") {
            track();
            trackTimerRef.current = setInterval(track, 5000);

            sync();
            // “watchdog” para refrescar UI aunque algún evento no dispare
            syncTimerRef.current = setInterval(sync, 2000);
          }
        });
    };

    // cerrar presence al irse / esconder pestaña (best-effort)
    const onVisibility = async () => {
      if (document.visibilityState === "hidden") {
        // no matamos el canal siempre (en móviles puede volver),
        // pero sí intentamos untrack para que Presence quite rápido al usuario
        try {
          const ch = channelRef.current;
          if (ch) await ch.untrack();
        } catch {}
      }
    };

    const onBeforeUnload = async () => {
      try {
        const ch = channelRef.current;
        if (ch) await ch.untrack();
      } catch {}
    };

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("beforeunload", onBeforeUnload);

    start();

    const { data: sub } = supabase.auth.onAuthStateChange(async (_evt, session) => {
      if (!session) await cleanup();
      else start();
    });

    return () => {
      stopped = true;
      events.forEach((e) => window.removeEventListener(e, touch));
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("beforeunload", onBeforeUnload);
      sub?.subscription?.unsubscribe?.();
      cleanup();
    };
  }, []);

  return null;
}
