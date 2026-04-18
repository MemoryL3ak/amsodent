import { useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { useNavigate } from "react-router-dom";
import Toast from "./Toast";

const IDLE_LOGOUT_MS = 15 * 60 * 1000; // 15 min
const IDLE_WARN_MS = 14 * 60 * 1000;   // aviso a los 14 min
const TICK_MS = 5 * 1000;             // cada 5s calculo activo/idle local
const FLUSH_MS = 15 * 1000;           // heartbeat a BD cada 15s
const ACTIVE_GRACE_MS = 60 * 1000;    // actividad reciente <= 60s => "activo"
const STALE_SESSION_SEC = 45;          // umbral para cerrar sesiones zombie server-side

const LS_KEY = "lici_session_id";

export default function SessionTracker() {
  const navigate = useNavigate();

  const sessionIdRef = useRef(null);
  const userIdRef = useRef(null);

  const lastActivityRef = useRef(Date.now());
  const activeAccRef = useRef(0);
  const idleAccRef = useRef(0);

  const lastTickRef = useRef(Date.now());
  const lastFlushRef = useRef(Date.now());
  const warnedRef = useRef(false);
  const [toast, setToast] = useState(null);

  // registrar actividad del usuario (solo interacciones reales, NO visibilitychange)
  useEffect(() => {
    const touch = () => {
      lastActivityRef.current = Date.now();
      warnedRef.current = false;
      if (toast) setToast(null);
    };
    const events = ["mousemove", "mousedown", "keydown", "scroll", "touchstart"];
    events.forEach((e) => window.addEventListener(e, touch, { passive: true }));

    return () => {
      events.forEach((e) => window.removeEventListener(e, touch));
    };
  }, []);

  useEffect(() => {
    let tickInterval = null;
    let stopped = false;

    async function start() {
      const { data: auth } = await supabase.auth.getUser();
      const user = auth?.user;
      if (!user) return;

      userIdRef.current = user.id;

      // ✅ Limpiar sesiones zombie server-side al arrancar
      try {
        await supabase.rpc("fn_close_stale_sessions", { p_stale_seconds: STALE_SESSION_SEC });
      } catch { /* RPC puede no existir aún */ }

      // reset relojes
      lastTickRef.current = Date.now();
      lastFlushRef.current = Date.now();
      lastActivityRef.current = Date.now();

      const nowIso = new Date().toISOString();

      // ✅ Reusar session_id de este navegador si existe, sigue abierta y es reciente
      const stored = localStorage.getItem(LS_KEY);
      if (stored) {
        const { data: srow, error: eCheck } = await supabase
          .from("user_sessions")
          .select("id, ended_at, last_seen_at")
          .eq("id", stored)
          .eq("user_id", user.id)
          .maybeSingle();

        const isRecent = srow?.last_seen_at &&
          (Date.now() - new Date(srow.last_seen_at).getTime()) < IDLE_LOGOUT_MS;

        if (!eCheck && srow?.id && !srow.ended_at && isRecent) {
          sessionIdRef.current = srow.id;

          await supabase
            .from("user_sessions")
            .update({
              last_seen_at: nowIso,
              last_activity_at: nowIso,
              forced_logout: false,
            })
            .eq("id", srow.id);

          // loop
          tickInterval = setInterval(loopTick, TICK_MS);
          return;
        }

        // Sesión vieja o cerrada: cerrarla si quedó abierta y limpiar
        if (!eCheck && srow?.id && !srow.ended_at && !isRecent) {
          await supabase
            .from("user_sessions")
            .update({ ended_at: srow.last_seen_at || nowIso })
            .eq("id", srow.id);
        }
        localStorage.removeItem(LS_KEY);
      }

      // ✅ si no hay session reusable, crear nueva
      const { data: ins, error } = await supabase
        .from("user_sessions")
        .insert([
          {
            user_id: user.id,
            started_at: nowIso,
            forced_logout: false,
            last_seen_at: nowIso,
            last_activity_at: nowIso,
          },
        ])
        .select("id")
        .single();

      if (error) {
        console.error("No se pudo crear user_sessions:", error);
        return;
      }

      sessionIdRef.current = ins.id;
      localStorage.setItem(LS_KEY, ins.id);

      tickInterval = setInterval(loopTick, TICK_MS);
    }

    async function loopTick() {
      if (stopped) return;

      const now = Date.now();
      const dt = now - lastTickRef.current;
      lastTickRef.current = now;

      const idleFor = now - lastActivityRef.current;

      if (
        !warnedRef.current &&
        idleFor >= IDLE_WARN_MS &&
        idleFor < IDLE_LOGOUT_MS &&
        document.visibilityState !== "hidden"
      ) {
        warnedRef.current = true;
        setToast({
          type: "error",
          message: "Llevas 14 minutos de inactividad. Se cerrará sesión en 1 minuto.",
        });
      }

      // auto-logout por inactividad
      if (idleFor >= IDLE_LOGOUT_MS) {
        await flush(now);
        await forceLogout();
        return;
      }

      // acumular activo vs idle localmente
      if (idleFor <= ACTIVE_GRACE_MS) activeAccRef.current += dt;
      else idleAccRef.current += dt;

      // flush a BD
      if (now - lastFlushRef.current >= FLUSH_MS) {
        lastFlushRef.current = now;
        await flush(now);
      }
    }

    async function flush(nowMs) {
      const user_id = userIdRef.current;
      const session_id = sessionIdRef.current;
      if (!user_id || !session_id) return;

      const activeSec = Math.floor(activeAccRef.current / 1000);
      const idleSec = Math.floor(idleAccRef.current / 1000);

      // reset acumuladores
      activeAccRef.current = 0;
      idleAccRef.current = 0;

      const nowIso = new Date(nowMs).toISOString();
      const day = new Date(nowMs).toISOString().slice(0, 10);

      // ✅ update sesión (heartbeat)
      const { error: eUpd } = await supabase
        .from("user_sessions")
        .update({
          last_seen_at: nowIso,
          last_activity_at: new Date(lastActivityRef.current).toISOString(),
          ended_at: null,       // si algún cleanup la cerró, la reabre mientras haya heartbeat
          forced_logout: false,
        })
        .eq("id", session_id);

      if (eUpd) console.error("user_sessions update error:", eUpd);

      // ✅ user_activity_daily con incremento atómico (evita race condition multi-tab)
      try {
        await supabase.rpc("fn_upsert_activity_daily", {
          p_user_id: user_id,
          p_day: day,
          p_active_seconds: activeSec,
          p_idle_seconds: idleSec,
          p_last_seen_at: nowIso,
        });
      } catch (e) {
        // Fallback si el RPC no existe aún: upsert directo (puede perder datos en multi-tab)
        await supabase
          .from("user_activity_daily")
          .upsert(
            [{
              user_id,
              day,
              active_seconds: activeSec,
              idle_seconds: idleSec,
              last_seen_at: nowIso,
            }],
            { onConflict: "user_id,day" }
          );
      }
    }

    async function forceLogout() {
      const session_id = sessionIdRef.current;
      const nowIso = new Date().toISOString();

      if (session_id) {
        await supabase
          .from("user_sessions")
          .update({ ended_at: nowIso, forced_logout: true })
          .eq("id", session_id);
      }

      localStorage.removeItem(LS_KEY);
      await supabase.auth.signOut();
      navigate("/login", { replace: true });
    }

    // ✅ solo flush al ir a background (no cerrar sesión, se reabre automáticamente al volver)
    const onVisibility = async () => {
      if (document.visibilityState === "hidden") {
        try { await flush(Date.now()); } catch { /* ignore */ }
      }
    };

    // ✅ al cerrar pestaña: flush + close con fetch keepalive (más confiable que async en beforeunload)
    const onBeforeUnload = () => {
      const session_id = sessionIdRef.current;
      if (!session_id) return;

      // flush acumuladores locales antes de cerrar
      try { flush(Date.now()); } catch { /* ignore */ }

      // Cerrar sesión con fetch keepalive (sobrevive al cierre de tab)
      const nowIso = new Date().toISOString();
      try {
        const url = `${supabase.supabaseUrl}/rest/v1/user_sessions?id=eq.${session_id}`;
        const body = JSON.stringify({ ended_at: nowIso });
        // Obtener token de sesión actual para RLS
        const sessionToken = supabase.auth.session?.()?.access_token
          || supabase.supabaseKey;
        fetch(url, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            "apikey": supabase.supabaseKey,
            "Authorization": `Bearer ${sessionToken}`,
            "Prefer": "return=minimal",
          },
          body,
          keepalive: true,
        });
      } catch { /* best effort */ }
    };

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("beforeunload", onBeforeUnload);

    start();

    return () => {
      stopped = true;
      if (tickInterval) clearInterval(tickInterval);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [navigate]);

  return toast ? <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} /> : null;
}
