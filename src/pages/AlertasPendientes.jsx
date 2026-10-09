import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { BellRing, ExternalLink, RefreshCw } from "lucide-react";
import { api } from "../lib/api";
import DropdownSelect from "../components/ui/DropdownSelect";
import BotonLimpiarFiltros from "../components/BotonLimpiarFiltros";
import { etiquetaTipo } from "../lib/tiposAlerta";

/* ── Alertas pendientes por vendedor (2026-10-09) ───────────────────────────
   Pedido de Ariel: "módulo alertas pendientes por vendedor". Mismo origen que
   Monitoreo de Alertas (/monitoreo-alertas, que evalúa el cumplimiento de
   cada aviso contra el dato de negocio), pero mirado al revés: por persona y
   SOLO lo que sigue pendiente o incumplido, con el mensaje y el enlace para
   resolverlo. Lo cumplido y lo informativo no aparece. */

const PERIODOS = [
  { value: "30", label: "Últimos 30 días" },
  { value: "90", label: "Últimos 90 días" },
  { value: "180", label: "Últimos 6 meses" },
  { value: "365", label: "Último año" },
];
const ESTADOS = {
  pendiente: { texto: "Pendiente", color: "#b45309", bg: "#fef3c7" },
  incumplida: { texto: "Incumplida", color: "#b91c1c", bg: "#fee2e2" },
};
const pastilla = (e) => ({ display: "inline-block", fontSize: 11, fontWeight: 700, padding: "1px 8px", borderRadius: 999, whiteSpace: "nowrap", color: ESTADOS[e]?.color, background: ESTADOS[e]?.bg });
const hace = (iso) => {
  const d = Math.floor((Date.now() - Date.parse(iso)) / 864e5);
  if (!Number.isFinite(d)) return "—";
  return d <= 0 ? "hoy" : d === 1 ? "ayer" : `hace ${d} días`;
};
const fechaDesde = (dias) => {
  const d = new Date();
  d.setDate(d.getDate() - Number(dias));
  return d.toISOString().slice(0, 10);
};

export default function AlertasPendientes() {
  const [periodo, setPeriodo] = useState("90");
  const [datos, setDatos] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState("");
  const [persona, setPersona] = useState("");
  const [tipo, setTipo] = useState("");

  const cargar = useCallback(async () => {
    setCargando(true);
    setError("");
    try {
      setDatos(await api.get(`/monitoreo-alertas?desde=${fechaDesde(periodo)}`));
    } catch (e) {
      setError(e?.message || "No se pudieron cargar las alertas.");
    } finally {
      setCargando(false);
    }
  }, [periodo]);
  useEffect(() => { cargar(); }, [cargar]);

  // Solo lo que sigue pendiente o incumplido, agrupado por persona.
  const grupos = useMemo(() => {
    const pend = (datos?.alertas || []).filter((a) => a.estado === "pendiente" || a.estado === "incumplida");
    const m = new Map();
    for (const a of pend) {
      const k = String(a.email || "").toLowerCase() || "(sin persona)";
      if (!m.has(k)) m.set(k, { email: k, nombre: a.nombre || null, rol: a.rol || null, pendientes: 0, incumplidas: 0, lista: [] });
      const g = m.get(k);
      if (a.estado === "incumplida") g.incumplidas += 1; else g.pendientes += 1;
      g.lista.push(a);
    }
    for (const g of m.values()) g.lista.sort((a, b) => (a.estado === b.estado ? String(b.creado_at).localeCompare(String(a.creado_at)) : a.estado === "incumplida" ? -1 : 1));
    return [...m.values()].sort((a, b) => (b.incumplidas + b.pendientes) - (a.incumplidas + a.pendientes) || String(a.nombre || a.email).localeCompare(String(b.nombre || b.email), "es"));
  }, [datos]);

  const tipos = useMemo(() => {
    const c = new Map();
    for (const g of grupos) for (const a of g.lista) c.set(a.tipo, (c.get(a.tipo) || 0) + 1);
    return [...c.entries()].sort((a, b) => b[1] - a[1]);
  }, [grupos]);

  const visibles = useMemo(
    () => grupos
      .filter((g) => !persona || g.email === persona)
      .map((g) => ({ ...g, lista: tipo ? g.lista.filter((a) => a.tipo === tipo) : g.lista }))
      .filter((g) => g.lista.length > 0),
    [grupos, persona, tipo],
  );
  const kpis = useMemo(() => ({
    personas: grupos.length,
    pendientes: grupos.reduce((a, g) => a + g.pendientes, 0),
    incumplidas: grupos.reduce((a, g) => a + g.incumplidas, 0),
  }), [grupos]);
  const hayFiltros = !!persona || !!tipo;

  return (
    <div className="page alertas-pendientes">
      <div className="page-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 className="page-title" style={{ display: "inline-flex", alignItems: "center", gap: 8 }}><BellRing size={22} /> Alertas pendientes por vendedor</h1>
          <p className="page-subtitle">Lo que cada persona todavía tiene por resolver: avisos que siguen pendientes o ya se incumplieron. Lo cumplido no aparece.</p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <DropdownSelect value={periodo} onChange={setPeriodo} options={PERIODOS} minWidth={170} />
          <button type="button" className="btn btn-secondary btn-sm" onClick={cargar} disabled={cargando} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <RefreshCw size={13} className={cargando ? "girando" : undefined} /> Actualizar
          </button>
        </div>
      </div>

      {error && <div className="surface" style={{ padding: "10px 14px", color: "#b91c1c", marginBottom: 12 }}>{error}</div>}

      <div className="stats-row stats-3" style={{ marginBottom: 12 }}>
        <div className="stat-card">
          <div className="stat-label">Personas con pendientes</div>
          <div className="stat-value">{kpis.personas.toLocaleString("es-CL")}</div>
          <div className="stat-sub">en el período elegido</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Alertas pendientes</div>
          <div className="stat-value" style={{ color: kpis.pendientes ? "#b45309" : undefined }}>{kpis.pendientes.toLocaleString("es-CL")}</div>
          <div className="stat-sub">todavía se pueden resolver</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Incumplidas</div>
          <div className="stat-value" style={{ color: kpis.incumplidas ? "#b91c1c" : undefined }}>{kpis.incumplidas.toLocaleString("es-CL")}</div>
          <div className="stat-sub">p. ej. cerró sin postular</div>
        </div>
      </div>

      <div className="filter-bar" style={{ alignItems: "flex-end", marginBottom: 12 }}>
        <div className="filter-field" style={{ flex: "1 1 220px", minWidth: 0 }}>
          <label className="filter-label">Persona</label>
          <DropdownSelect
            value={persona}
            onChange={setPersona}
            minWidth={240}
            options={[{ value: "", label: "Todas las personas" }, ...grupos.map((g) => ({ value: g.email, label: g.nombre || g.email, detalle: `${g.pendientes + g.incumplidas} pendientes` }))]}
          />
        </div>
        <div className="filter-field" style={{ flex: "1 1 220px", minWidth: 0 }}>
          <label className="filter-label">Tipo</label>
          <DropdownSelect
            value={tipo}
            onChange={setTipo}
            minWidth={260}
            options={[{ value: "", label: "Todos los tipos" }, ...tipos.map(([t, n]) => ({ value: t, label: etiquetaTipo(t), detalle: `${n} pendientes` }))]}
          />
        </div>
        <BotonLimpiarFiltros hay={hayFiltros} onLimpiar={() => { setPersona(""); setTipo(""); }} />
      </div>

      {!datos && <div className="surface" style={{ padding: 24, textAlign: "center", color: "var(--text-muted)" }}>{cargando ? "Cargando…" : "—"}</div>}
      {datos && visibles.length === 0 && (
        <div className="surface sin-pendientes" style={{ padding: 24, textAlign: "center", color: "var(--text-muted)" }}>
          {grupos.length === 0 ? "Nadie tiene alertas pendientes en el período. 🎉" : "Ningún pendiente calza con el filtro."}
        </div>
      )}
      {visibles.map((g) => (
        <div className="surface grupo-persona" key={g.email} style={{ marginBottom: 12 }}>
          <div className="surface-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <h3 className="surface-title" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              {g.nombre || g.email}
              {g.rol && <span style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 500 }}>{g.rol}</span>}
            </h3>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {g.pendientes > 0 && <span style={pastilla("pendiente")}>{g.pendientes} pendiente{g.pendientes === 1 ? "" : "s"}</span>}
              {g.incumplidas > 0 && <span style={pastilla("incumplida")}>{g.incumplidas} incumplida{g.incumplidas === 1 ? "" : "s"}</span>}
            </div>
          </div>
          <div className="table-scroll">
            <table className="data-table tabla-compacta tabla-texto tabla-pendientes-persona" style={{ width: "100%", minWidth: 720 }}>
              <thead>
                <tr>
                  <th>Tipo</th>
                  <th>Alerta</th>
                  <th>Cliente / cotización</th>
                  <th style={{ whiteSpace: "nowrap" }}>Hace</th>
                  <th>Estado</th>
                  <th style={{ textAlign: "right" }}>Ir</th>
                </tr>
              </thead>
              <tbody>
                {g.lista.map((a) => (
                  <tr key={a.id}>
                    <td style={{ whiteSpace: "nowrap", fontWeight: 600 }}>{etiquetaTipo(a.tipo)}</td>
                    <td style={{ whiteSpace: "normal", overflowWrap: "anywhere", maxWidth: 480 }}>
                      {a.mensaje}
                      {a.detalle && <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{a.detalle}</div>}
                    </td>
                    <td style={{ whiteSpace: "normal", overflowWrap: "anywhere" }}>
                      {a.licitacion_id ? <Link to={`/detalle/${a.licitacion_id}`} className="table-link">#{a.licitacion_id}</Link> : null}
                      {a.cliente ? <div style={{ fontSize: 11.5 }}>{a.cliente}</div> : null}
                    </td>
                    <td style={{ whiteSpace: "nowrap" }} title={String(a.creado_at || "").replace("T", " ").slice(0, 16)}>{hace(a.creado_at)}</td>
                    <td><span style={pastilla(a.estado)}>{ESTADOS[a.estado]?.texto || a.estado}</span></td>
                    <td style={{ textAlign: "right" }}>
                      {a.link ? <Link to={a.link} className="btn btn-ghost btn-sm" title="Ir a resolverla" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><ExternalLink size={13} /></Link> : <span style={{ color: "var(--text-muted)" }}>—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}
