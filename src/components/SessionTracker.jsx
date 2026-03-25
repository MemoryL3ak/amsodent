import { useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { useNavigate } from "react-router-dom";
import Toast from "./Toast";

const IDLE_LOGOUT_MS = 15 * 60 * 1000; // 15 min
const IDLE_WARN_MS = 14 * 60 * 1000;   // aviso a los 14 min
const TICK_MS = 5 * 1000;             // cada 5s calculo activo/idle local
const FLUSH_MS = 15 * 1000;           // heartbeat a BD cada 15s
const ACTIVE_GRACE_MS = 60 * 1000;    // actividad reciente <= 60s => "activo"

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

  // registrar actividad del usuario
  useEffect(() => {
    const touch = () => {
      lastActivityRef.current = Date.now();
      warnedRef.current = false;
      if (toast) setToast(null);
    };
    const events = ["mousemove", "mousedown", "keydown", "scroll", "touchstart"];
    events.forEach((e) => window.addEventListener(e, touch, { passive: true }));
    document.addEventListener("visibilitychange", touch);

    return () => {
      events.forEach((e) => window.removeEventListener(e, touch));
      document.removeEventListener("visibilitychange", touch);
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

      // reset relojes
      lastTickRef.current = Date.now();
      lastFlushRef.current = Date.now();
      lastActivityRef.current = Date.now();

      const nowIso = new Date().toISOString();

      // ✅ Reusar session_id de este navegador si existe y sigue abierta
      const stored = localStorage.getItem(LS_KEY);
      if (stored) {
        const { data: srow, error: eCheck } = await supabase
          .from("user_sessions")
          .select("id, ended_at")
          .eq("id", stored)
          .eq("user_id", user.id)
          .maybeSingle();

        if (!eCheck && srow?.id && !srow.ended_at) {
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

      // ✅ mantener user_activity_daily (opcional: si ya no lo usarás, puedes quitarlo)
      await supabase
        .from("user_activity_daily")
        .upsert(
          [
            {
              user_id,
              day,
              active_seconds: 0,
              idle_seconds: 0,
              last_seen_at: nowIso,
            },
          ],
          { onConflict: "user_id,day" }
        );

      if (activeSec > 0 || idleSec > 0) {
        const { data: row } = await supabase
          .from("user_activity_daily")
          .select("active_seconds, idle_seconds")
          .eq("user_id", user_id)
          .eq("day", day)
          .single();

        await supabase
          .from("user_activity_daily")
          .update({
            active_seconds: (row?.active_seconds || 0) + activeSec,
            idle_seconds: (row?.idle_seconds || 0) + idleSec,
            last_seen_at: nowIso,
          })
          .eq("user_id", user_id)
          .eq("day", day);
      } else {
        await supabase
          .from("user_activity_daily")
          .update({ last_seen_at: nowIso })
          .eq("user_id", user_id)
          .eq("day", day);
      }
    }

    async function endSessionBestEffort() {
      const session_id = sessionIdRef.current;
      if (!session_id) return;
      const nowIso = new Date().toISOString();

      await supabase
        .from("user_sessions")
        .update({ ended_at: nowIso })
        .eq("id", session_id);
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

    // ✅ cuando se va a background, best-effort
    const onVisibility = async () => {
      if (document.visibilityState === "hidden") {
        try {
          await flush(Date.now());
          await endSessionBestEffort();
        } catch {
          // ignore
        }
      }
    };

    // ✅ al cerrar pestaña, best-effort
    const onBeforeUnload = async () => {
      try {
        await flush(Date.now());
        await endSessionBestEffort();
      } catch {
        // ignore
      }
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
