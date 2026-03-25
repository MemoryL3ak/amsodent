import { useEffect, useRef } from "react";
import { supabase } from "../lib/supabase";

const DEFAULT_IDLE_MS = 15 * 60 * 1000; // ✅ 15 minutos de inactividad

export function useAutoLogout({
  idleMs = DEFAULT_IDLE_MS,
  onLogout, // opcional: callback (ej: navigate("/login"))
} = {}) {
  const timerRef = useRef(null);
  const lastActivityRef = useRef(Date.now());
  const channelRef = useRef(null);

  const clearTimer = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const broadcast = (type, payload) => {
    try {
      channelRef.current?.send({
        type: "broadcast",
        event: type,
        payload,
      });
    } catch {
      // ignore
    }
  };

  const doLogout = async (reason = "idle") => {
    clearTimer();

    // avisa a otras pestañas
    broadcast("force_logout", { reason, at: Date.now() });

    try {
      // ✅ Cerrar sesión en BD antes de hacer signOut
      // Esto asegura que el tiempo de conexión no siga contando después del logout
      const sessionId = localStorage.getItem("lici_session_id");
      if (sessionId) {
        const nowIso = new Date().toISOString();
        await supabase
          .from("user_sessions")
          .update({ 
            ended_at: nowIso, 
            forced_logout: true 
          })
          .eq("id", sessionId);
        localStorage.removeItem("lici_session_id");
      }
      
      await supabase.auth.signOut();
    } finally {
      if (typeof onLogout === "function") onLogout(reason);
    }
  };

  const schedule = () => {
    clearTimer();
    const now = Date.now();
    const elapsed = now - lastActivityRef.current;
    const remaining = Math.max(0, idleMs - elapsed);

    timerRef.current = setTimeout(() => {
      // doble check por si hubo actividad justo antes
      const now2 = Date.now();
      if (now2 - lastActivityRef.current >= idleMs) {
        doLogout("idle");
      } else {
        schedule();
      }
    }, remaining);
  };

  const markActivity = () => {
    lastActivityRef.current = Date.now();
    schedule();
    // avisa a otras pestañas para que no se deslogueen si hay actividad aquí
    broadcast("activity", { at: lastActivityRef.current });
  };

  useEffect(() => {
    let unsubAuth = null;
    let mounted = true;

    // canal para sincronizar actividad/logout entre pestañas
    channelRef.current = supabase.channel("idle-logout");

    channelRef.current.on("broadcast", { event: "activity" }, (msg) => {
      // otra pestaña tuvo actividad => reinicia temporizador aquí también
      if (!mounted) return;
      const at = msg?.payload?.at ?? Date.now();
      lastActivityRef.current = at;
      schedule();
    });

    channelRef.current.on("broadcast", { event: "force_logout" }, async () => {
      if (!mounted) return;
      clearTimer();
      
      // ✅ Cerrar sesión en BD antes de hacer signOut
      const sessionId = localStorage.getItem("lici_session_id");
      if (sessionId) {
        const nowIso = new Date().toISOString();
        await supabase
          .from("user_sessions")
          .update({ 
            ended_at: nowIso, 
            forced_logout: true 
          })
          .eq("id", sessionId);
        localStorage.removeItem("lici_session_id");
      }
      
      await supabase.auth.signOut();
      if (typeof onLogout === "function") onLogout("forced");
    });

    channelRef.current.subscribe();

    const events = [
      "mousemove",
      "mousedown",
      "keydown",
      "touchstart",
      "scroll",
      "wheel",
    ];

    // throttle suave: máximo 1 update cada 2s
    let lastEmit = 0;
    const handler = () => {
      const now = Date.now();
      if (now - lastEmit < 2000) return;
      lastEmit = now;
      markActivity();
    };

    events.forEach((ev) =>
      window.addEventListener(ev, handler, { passive: true })
    );

    // iniciar sólo si hay sesión
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!mounted) return;
      if (data?.session) {
        lastActivityRef.current = Date.now();
        schedule();
      }
    })();

    // si cambia sesión, resetea / detiene
    const { data: authListener } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        if (!mounted) return;
        if (session) {
          lastActivityRef.current = Date.now();
          schedule();
        } else {
          clearTimer();
        }
      }
    );
    unsubAuth = authListener?.subscription?.unsubscribe;

    return () => {
      mounted = false;
      clearTimer();
      events.forEach((ev) => window.removeEventListener(ev, handler));
      try {
        if (unsubAuth) unsubAuth();
      } catch {}
      try {
        channelRef.current?.unsubscribe();
      } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idleMs]);
}