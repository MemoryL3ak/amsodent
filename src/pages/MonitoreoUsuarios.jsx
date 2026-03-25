import { useEffect, useMemo, useState } from "react";
import Select from "react-select";
import { supabase } from "../lib/supabase";

const ACTIVE_GRACE_MS = 60 * 1000;
// Para “online real” (evita sesiones zombie en UI)
const HEARTBEAT_ONLINE_SEC = 30;

const selectStyles = {
  control: (base, state) => ({
    ...base,
    minHeight: "36px",
    height: "36px",
    borderRadius: "var(--radius)",
    borderColor: state.isFocused ? "var(--primary)" : "var(--border-strong)",
    backgroundColor: "var(--surface)",
    boxShadow: state.isFocused ? "0 0 0 2px rgba(40,174,177,.15)" : "none",
    fontSize: "13.5px",
    fontFamily: "var(--font)",
    ":hover": { borderColor: "var(--primary)" },
  }),
  valueContainer: (base) => ({ ...base, padding: "0 10px" }),
  indicatorsContainer: (base) => ({ ...base, height: "36px" }),
  indicatorSeparator: () => ({ display: "none" }),
  multiValue: (base) => ({ ...base, backgroundColor: "rgba(40,174,177,0.12)", borderRadius: "4px" }),
  multiValueLabel: (base) => ({ ...base, fontSize: "12px", color: "var(--primary-dark)" }),
  multiValueRemove: (base) => ({ ...base, ":hover": { backgroundColor: "rgba(40,174,177,0.25)", color: "var(--primary-dark)" } }),
  placeholder: (base) => ({ ...base, color: "var(--text-muted)", fontFamily: "var(--font)" }),
  singleValue: (base) => ({ ...base, fontFamily: "var(--font)", color: "var(--text)" }),
  menu: (base) => ({ ...base, zIndex: 50, fontSize: "13.5px" }),
  menuPortal: (base) => ({ ...base, zIndex: 99999 }),
};

// Si tienes RPC que cierra sesiones stale (recomendado)
const STALE_SESSION_SEC = 45;

// ✅ Ventana laboral (local)
const WORK_START = "09:00:00";
const WORK_END = "19:00:00";

function hoyLocalISO() {
  // YYYY-MM-DD en zona local
  return new Date().toLocaleDateString("en-CA");
}

function formatearFechaHora(ts) {
  if (!ts) return null;
  const d = new Date(ts);
  return d.toLocaleString("es-CL", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function fmtHMS(seg) {
  const s = Math.max(0, Number(seg || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return `${String(h).padStart(2, "0")}h ${String(m).padStart(
    2,
    "0"
  )}m ${String(ss).padStart(2, "0")}s`;
}

function fmtHace(seg) {
  const s = Math.max(0, Number(seg || 0));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const ss = s % 60;
  if (m < 60) return `${m}m ${ss}s`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${h}h ${mm}m ${ss}s`;
}

function statusFromIdleNowSec(idleNowSec) {
  if (idleNowSec == null) return { label: "Offline", tone: "red" };
  if (idleNowSec * 1000 <= ACTIVE_GRACE_MS) return { label: "Activo", tone: "green" };
  return { label: "Ausente", tone: "yellow" };
}

function Badge({ tone, children }) {
  const color =
    tone === "green"  ? { text: "#15803d", bg: "#f0fdf4", border: "#bbf7d0", dot: "#22c55e" } :
    tone === "yellow" ? { text: "#92400e", bg: "#fffbeb", border: "#fde68a", dot: "#eab308" } :
                        { text: "#b91c1c", bg: "#fef2f2", border: "#fecaca", dot: "#ef4444" };

  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: "6px",
      padding: "2px 10px", borderRadius: "999px", border: `1px solid ${color.border}`,
      background: color.bg, color: color.text, fontSize: "12px", fontWeight: 600,
    }}>
      <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: color.dot, flexShrink: 0 }} />
      {children}
    </span>
  );
}

// ✅ bounds de la ventana laboral en zona LOCAL (09:00–19:00)
function workBoundsLocal(dayISO) {
  const start = new Date(`${dayISO}T${WORK_START}`); // local
  const end = new Date(`${dayISO}T${WORK_END}`); // local
  return { start, end };
}

function dayRangeISO(fromISO, toISO) {
  if (!fromISO || !toISO) return [];
  const start = new Date(`${fromISO}T00:00:00`);
  const end = new Date(`${toISO}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return [];

  const days = [];
  const dir = start.getTime() <= end.getTime() ? 1 : -1;
  const cur = new Date(start);

  while (true) {
    days.push(cur.toLocaleDateString("en-CA"));
    if (cur.toDateString() === end.toDateString()) break;
    cur.setDate(cur.getDate() + dir);
  }

  return dir === 1 ? days : days.reverse();
}

export default function MonitoreoUsuarios() {
  const [fechaDesde, setFechaDesde] = useState(hoyLocalISO());
  const [fechaHasta, setFechaHasta] = useState(hoyLocalISO());
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(Date.now());

  const [profiles, setProfiles] = useState([]);

  // presence global (lo publica PresenceTracker)
  const [presenceMap, setPresenceMap] = useState(new Map());

  // heartbeat BD (sesión abierta => last_seen reciente)
  const [heartbeatMap, setHeartbeatMap] = useState(new Map()); // user_id => last_seen_at (open session)

  // last_seen del día seleccionado (user_activity_daily)
  const [dailyLastSeenMap, setDailyLastSeenMap] = useState(new Map()); // user_id => last_seen_at (selected day)

  // conectado del día seleccionado (segundos) dentro de 09–19 y cortando zombies con last_seen_at
  const [onlineDayMap, setOnlineDayMap] = useState(new Map()); // user_id => seconds (work window)

  const [filtroVendedor, setFiltroVendedor] = useState([]);

  const range = useMemo(() => {
    const today = hoyLocalISO();
    let from = fechaDesde || today;
    let to = fechaHasta || from;
    if (from > to) {
      const tmp = from;
      from = to;
      to = tmp;
    }
    return {
      from,
      to,
      days: dayRangeISO(from, to),
      isSingleDay: from === to,
    };
  }, [fechaDesde, fechaHasta]);

  // ticker UI
  useEffect(() => {
    const t = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // cargar profiles
  useEffect(() => {
    let mounted = true;

    async function cargarProfiles() {
      setLoading(true);
      try {
        const { data, error } = await supabase
          .from("profiles")
          .select("id, nombre, email, rol")
          .order("nombre", { ascending: true });

        if (error) throw error;
        if (mounted) setProfiles(data || []);
      } catch (e) {
        console.error("Error cargando profiles:", e);
        if (mounted) setProfiles([]);
      } finally {
        if (mounted) setLoading(false);
      }
    }

    cargarProfiles();
    return () => {
      mounted = false;
    };
  }, []);

  // leer presence global (evento)
  useEffect(() => {
    const syncFromGlobal = () => {
      const state = window.__presenceState || {};
      const m = new Map();

      for (const [userId, metas] of Object.entries(state)) {
        if (!Array.isArray(metas) || metas.length === 0) continue;
        const meta = metas[metas.length - 1];
        m.set(userId, {
          user_id: userId,
          nombre: meta?.nombre || meta?.email || "Usuario",
          email: meta?.email || null,
          last_activity_at: meta?.last_activity_at || null,
          started_at: meta?.started_at || null,
        });
      }

      setPresenceMap(m);
    };

    window.addEventListener("presence:usuarios:state", syncFromGlobal);
    syncFromGlobal();
    return () => window.removeEventListener("presence:usuarios:state", syncFromGlobal);
  }, []);

  // heartbeat BD + cierre de zombies
  useEffect(() => {
    let mounted = true;

    async function cargarHeartbeat() {
      try {
        // Si existe tu RPC, cierra sesiones stale server-side
        try {
          await supabase.rpc("fn_close_stale_sessions", { p_stale_seconds: STALE_SESSION_SEC });
        } catch (e) {
          // si no existe o falla, no bloqueamos
        }

        const { data, error } = await supabase
          .from("user_sessions")
          .select("user_id, last_seen_at")
          .is("ended_at", null)
          .order("last_seen_at", { ascending: false })
          .limit(500);

        if (error) throw error;

        const m = new Map();
        (data || []).forEach((r) => {
          if (!m.has(r.user_id) && r.last_seen_at) m.set(r.user_id, r.last_seen_at);
        });

        if (mounted) setHeartbeatMap(m);
      } catch (e) {
        console.error("Error cargando heartbeat:", e);
        if (mounted) setHeartbeatMap(new Map());
      }
    }

    cargarHeartbeat();
    const t = setInterval(cargarHeartbeat, 5_000);
    return () => {
      mounted = false;
      clearInterval(t);
    };
  }, []);

  // last_seen DEL RANGO seleccionado (para textos)
  useEffect(() => {
    let mounted = true;

    async function cargarDailyLastSeen() {
      try {
        const { data, error } = await supabase
          .from("user_activity_daily")
          .select("user_id, day, last_seen_at")
          .gte("day", range.from)
          .lte("day", range.to)
          .limit(5000);

        if (error) throw error;

        const m = new Map();
        (data || []).forEach((r) => {
          if (!r.user_id || !r.last_seen_at) return;
          const prev = m.get(r.user_id);
          if (!prev || new Date(r.last_seen_at) > new Date(prev)) {
            m.set(r.user_id, r.last_seen_at);
          }
        });

        if (mounted) setDailyLastSeenMap(m);
      } catch (e) {
        console.error("Error cargando user_activity_daily:", e);
        if (mounted) setDailyLastSeenMap(new Map());
      }
    }

    cargarDailyLastSeen();
    const t = setInterval(cargarDailyLastSeen, 15_000);
    return () => {
      mounted = false;
      clearInterval(t);
    };
  }, [range.from, range.to]);

  // ✅ Conectado dentro de 09:00–19:00 (local), cortando sesiones abiertas por last_seen_at (no usar now)
  useEffect(() => {
    let mounted = true;

    async function cargarOnlineVentana() {
      try {
        const rangeStart = new Date(`${range.from}T00:00:00`);
        const rangeEnd = new Date(`${range.to}T23:59:59`);
        const startIso = rangeStart.toISOString();
        const endIso = rangeEnd.toISOString();

        const { data, error } = await supabase
          .from("user_sessions")
          .select("user_id, started_at, ended_at, last_seen_at")
          // sesiones que intersectan la ventana [start, end)
          .lt("started_at", endIso)
          .or(`ended_at.is.null,ended_at.gte.${startIso}`)
          .order("started_at", { ascending: false })
          .limit(8000);

        if (error) throw error;

        const acc = new Map();

        (data || []).forEach((s) => {
          if (!s.user_id || !s.started_at) return;

          const sStart = new Date(s.started_at);

          // fin efectivo:
          // - ended_at si existe
          // - si no, last_seen_at (no "now")
          // - si no hay last_seen_at => no sumar
          let effectiveEnd = null;

          if (s.ended_at) effectiveEnd = new Date(s.ended_at);
          else if (s.last_seen_at) effectiveEnd = new Date(s.last_seen_at);
          else return;

          range.days.forEach((dayISO) => {
            const { start, end } = workBoundsLocal(dayISO);
            const from = new Date(Math.max(sStart.getTime(), start.getTime()));
            const to = new Date(Math.min(effectiveEnd.getTime(), end.getTime()));

            const diffSec = Math.max(0, Math.floor((to.getTime() - from.getTime()) / 1000));
            if (diffSec <= 0) return;

            acc.set(s.user_id, (acc.get(s.user_id) || 0) + diffSec);
          });
        });

        if (mounted) setOnlineDayMap(acc);
      } catch (e) {
        console.error("Error calculando conectado (09–19):", e);
        if (mounted) setOnlineDayMap(new Map());
      }
    }

    cargarOnlineVentana();
    const t = setInterval(cargarOnlineVentana, 15_000);
    return () => {
      mounted = false;
      clearInterval(t);
    };
  }, [range.from, range.to, range.days]);

  // ✅ Ventana “observable” SOLO 09:00–19:00 (rango)
  const windowSeconds = useMemo(() => {
    const now = new Date();
    let total = 0;

    range.days.forEach((dayISO) => {
      const { start, end } = workBoundsLocal(dayISO);
      const dayStart = start.getTime();
      const dayEnd = end.getTime();
      const nowMs = now.getTime();

      if (nowMs <= dayStart) return;
      if (nowMs >= dayEnd) {
        total += Math.max(0, Math.floor((dayEnd - dayStart) / 1000));
        return;
      }

      total += Math.max(0, Math.floor((nowMs - dayStart) / 1000));
    });

    return total;
  }, [range.days, tick]);

  const todayISO = hoyLocalISO();

  // online real = presence filtrado por heartbeat + fallback a heartbeat aunque no haya presence
  const onlinePresenceReal = useMemo(() => {
    const nowMs = Date.now();
    const arr = Array.from(presenceMap.values());
    const onlineIds = new Set();
    const result = [];

    arr.forEach((u) => {
      const hb = heartbeatMap.get(u.user_id);
      if (hb) {
        const ageSec = Math.floor((nowMs - new Date(hb).getTime()) / 1000);
        if (ageSec > HEARTBEAT_ONLINE_SEC) return;
      }
      onlineIds.add(u.user_id);
      result.push(u);
    });

    heartbeatMap.forEach((lastSeen, userId) => {
      if (onlineIds.has(userId)) return;
      const ageSec = Math.floor((nowMs - new Date(lastSeen).getTime()) / 1000);
      if (ageSec > HEARTBEAT_ONLINE_SEC) return;
      const profile = profiles.find((p) => p.id === userId);
      if (!profile) return;
      result.push({
        user_id: userId,
        nombre: profile.nombre || profile.email || "Usuario",
        email: profile.email || null,
        last_activity_at: null,
        started_at: null,
      });
      onlineIds.add(userId);
    });

    return result;
  }, [presenceMap, heartbeatMap, profiles, tick]);

  // ONLINE enriquecido (09–19)
  const onlineEnriched = useMemo(() => {
    const nowMs = Date.now();

    return onlinePresenceReal.map((u) => {
      const lastActMs = u.last_activity_at ? new Date(u.last_activity_at).getTime() : null;
      const idleNowSec = lastActMs ? Math.floor((nowMs - lastActMs) / 1000) : null;
      const st = statusFromIdleNowSec(idleNowSec);

      const connected = onlineDayMap.get(u.user_id) || 0;
      const disconnected = Math.max(0, windowSeconds - connected);

      return {
        ...u,
        status: st,
        idle_now_seconds: idleNowSec ?? 0,
        connected_day_seconds: connected,
        disconnected_day_seconds: disconnected,
      };
    });
  }, [onlinePresenceReal, onlineDayMap, windowSeconds, tick]);

  // OFFLINE = profiles - onlineEnriched
  const offlineUsers = useMemo(() => {
    const onlineIds = new Set(onlineEnriched.map((x) => x.user_id));

    return profiles
      .filter((p) => !onlineIds.has(p.id))
      .map((p) => {
        const lastSeenDay = dailyLastSeenMap.get(p.id) || null;

        const connected = onlineDayMap.get(p.id) || 0;
        const disconnected = Math.max(0, windowSeconds - connected);

        // “desconectado desde” solo tiene sentido para HOY (y dentro de ventana)
        let disconnectedSinceSec = null;
        if (range.isSingleDay && range.from === todayISO && lastSeenDay) {
          const last = new Date(lastSeenDay);
          const { start } = workBoundsLocal(range.from);

          // si last_seen fue antes de las 09:00, contar desde las 09:00
          const base = last.getTime() < start.getTime() ? start : last;

          disconnectedSinceSec = Math.max(0, Math.floor((Date.now() - base.getTime()) / 1000));
        }

        return {
          user_id: p.id,
          nombre: p.nombre || p.email || "Usuario",
          email: p.email || null,
          last_seen_day: lastSeenDay,
          disconnected_since_seconds: disconnectedSinceSec,
          connected_day_seconds: connected,
          disconnected_day_seconds: disconnected,
        };
      });
  }, [
    profiles,
    onlineEnriched,
    dailyLastSeenMap,
    onlineDayMap,
    windowSeconds,
    range.from,
    range.isSingleDay,
    todayISO,
    tick,
  ]);

  const offlineLastSeenText = (u) => {
    if (!u.last_seen_day) return `Última actividad (día): Sin registros`;
    return `Última actividad (día): ${formatearFechaHora(u.last_seen_day)}`;
  };

  const offlineSinceText = (u) => {
    if (!range.isSingleDay || range.from !== todayISO) return offlineLastSeenText(u);
    if (!u.last_seen_day) return "Desconectado desde: Sin registros hoy";
    return `Desconectado desde: ${fmtHace(u.disconnected_since_seconds)}`;
  };

  const vendedores = useMemo(() => {
    return profiles.filter((p) => ["ventas", "jefe_ventas"].includes(p.rol));
  }, [profiles]);

  const onlineFiltered = useMemo(() => {
    if (!filtroVendedor.length) return onlineEnriched;
    return onlineEnriched.filter((u) => filtroVendedor.includes(u.user_id));
  }, [onlineEnriched, filtroVendedor]);

  const offlineFiltered = useMemo(() => {
    if (!filtroVendedor.length) return offlineUsers;
    return offlineUsers.filter((u) => filtroVendedor.includes(u.user_id));
  }, [offlineUsers, filtroVendedor]);

  return (
    <div className="page">
      {/* PAGE HEADER */}
      <div className="page-header" style={{ flexWrap: "wrap", gap: "12px" }}>
        <div>
          <h1 className="page-title">Monitoreo</h1>
          <div style={{ fontSize: "13px", color: "var(--text-muted)", marginTop: "2px" }}>
            <span style={{ color: "#22c55e" }}>●</span> Activo ≤ 60s · <span style={{ color: "#eab308" }}>●</span> Ausente &gt; 60s · <span style={{ color: "#ef4444" }}>●</span> Offline
          </div>
          <div style={{ fontSize: "12px", color: "var(--text-muted)", marginTop: "2px" }}>
            Ventana: <strong>09:00-19:00</strong> · Rango: <strong style={{ color: "var(--primary-dark)" }}>{range.from}{range.to !== range.from ? ` - ${range.to}` : ""}</strong>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "flex-end", gap: "12px", flexWrap: "wrap" }}>
          <div className="field" style={{ margin: 0 }}>
            <label className="field-label">Desde</label>
            <input type="date" className="input" value={fechaDesde} onChange={(e) => setFechaDesde(e.target.value)} />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label className="field-label">Hasta</label>
            <input type="date" className="input" value={fechaHasta} onChange={(e) => setFechaHasta(e.target.value)} />
          </div>
          <div className="field" style={{ margin: 0, minWidth: "220px" }}>
            <label className="field-label">Vendedor</label>
            <Select
              isMulti
              isClearable
              options={vendedores.map((v) => ({ value: v.id, label: v.nombre || v.email }))}
              value={vendedores.filter((v) => filtroVendedor.includes(v.id)).map((v) => ({ value: v.id, label: v.nombre || v.email }))}
              onChange={(vals) => setFiltroVendedor((vals || []).map((v) => v.value))}
              placeholder="Todos"
              styles={selectStyles}
              menuPortalTarget={document.body}
            />
          </div>
        </div>
      </div>

      {loading ? (
        <div className="surface" style={{ padding: "40px 24px", color: "var(--text-muted)" }}>Cargando…</div>
      ) : (
        <>
          {/* EN LÍNEA */}
          <div className="surface" style={{ marginBottom: "20px" }}>
            <div className="surface-header">
              <h3 className="surface-title">
                En línea (Presence) <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>({onlineFiltered.length})</span>
              </h3>
            </div>
            <div className="surface-body" style={{ padding: 0 }}>
              {onlineFiltered.length === 0 ? (
                <div style={{ padding: "24px", color: "var(--text-muted)", fontSize: "13px" }}>No hay usuarios en línea.</div>
              ) : (
                onlineFiltered.map((u, i) => (
                  <div key={u.user_id} style={{
                    display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px",
                    padding: "14px 24px",
                    borderTop: i > 0 ? "1px solid var(--border)" : "none",
                  }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                        <span style={{ fontWeight: 600, fontSize: "14px", color: "var(--text)" }}>{u.nombre}</span>
                        <Badge tone={u.status.tone}>{u.status.label}</Badge>
                      </div>
                      <div style={{ fontSize: "12px", color: "var(--text-muted)", marginTop: "2px" }}>{u.email || ""}</div>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: "40px", flexWrap: "wrap", justifyContent: "flex-end" }}>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontSize: "11px", color: "var(--text-muted)" }}>Inactivo ahora</div>
                        <div style={{ fontWeight: 600, fontSize: "14px", color: "var(--text)" }}>{fmtHace(u.idle_now_seconds)}</div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontSize: "11px", color: "var(--text-muted)" }}>Conectado (09–19)</div>
                        <div style={{ fontWeight: 600, fontSize: "14px", color: "var(--primary-dark)" }}>{fmtHMS(u.connected_day_seconds)}</div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontSize: "11px", color: "var(--text-muted)" }}>Desconectado (09–19)</div>
                        <div style={{ fontWeight: 600, fontSize: "14px", color: "var(--text)" }}>{fmtHMS(u.disconnected_day_seconds)}</div>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* FUERA DE LÍNEA */}
          <div className="surface">
            <div className="surface-header">
              <h3 className="surface-title">
                Fuera de línea <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>({offlineFiltered.length})</span>
              </h3>
            </div>
            <div className="surface-body" style={{ padding: 0 }}>
              {offlineFiltered.length === 0 ? (
                <div style={{ padding: "24px", color: "var(--text-muted)", fontSize: "13px" }}>Todos están conectados.</div>
              ) : (
                offlineFiltered.map((u, i) => (
                  <div key={u.user_id} style={{
                    display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px",
                    padding: "14px 24px",
                    borderTop: i > 0 ? "1px solid var(--border)" : "none",
                  }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                        <span style={{ fontWeight: 600, fontSize: "14px", color: "var(--text)" }}>{u.nombre}</span>
                        <Badge tone="red">Offline</Badge>
                      </div>
                      <div style={{ fontSize: "12px", color: "var(--text-muted)", marginTop: "2px" }}>{u.email || ""}</div>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: "40px", flexWrap: "wrap", justifyContent: "flex-end" }}>
                      <div style={{ fontSize: "12px", color: "var(--text-muted)", textAlign: "right" }}>{offlineSinceText(u)}</div>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontSize: "11px", color: "var(--text-muted)" }}>Conectado (09–19)</div>
                        <div style={{ fontWeight: 600, fontSize: "14px", color: "var(--primary-dark)" }}>{fmtHMS(u.connected_day_seconds)}</div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontSize: "11px", color: "var(--text-muted)" }}>Desconectado (09–19)</div>
                        <div style={{ fontWeight: 600, fontSize: "14px", color: "var(--text)" }}>{fmtHMS(u.disconnected_day_seconds)}</div>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div style={{ display: "none" }}>{tick}</div>
        </>
      )}
    </div>
  );
}













