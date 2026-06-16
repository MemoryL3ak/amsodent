import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import useAuth from "../hooks/useAuth";
import { Target, ClipboardList, TrendingUp, Users, Pencil, Check, X } from "lucide-react";

// Estados que NO cuentan como cotización "ingresada" para la meta del equipo.
const ESTADOS_NO_CUENTAN = ["Descartada", "Desierta"];
const META_DEFECTO = 900;

function mesActualISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function toDateISO(value) {
  if (!value) return "";
  const s = String(value);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

function nombreMes(periodo) {
  if (!periodo) return "";
  const [y, m] = periodo.split("-").map(Number);
  const d = new Date(y, (m || 1) - 1, 1);
  const txt = d.toLocaleDateString("es-CL", { month: "long", year: "numeric" });
  return txt.charAt(0).toUpperCase() + txt.slice(1);
}

function fmtPct(value) {
  if (!Number.isFinite(Number(value))) return "0%";
  return `${Number(value).toFixed(1)}%`;
}

function semaforo(pct) {
  if (pct >= 100) return { emoji: "🟢", color: "#16a34a", label: "Meta cumplida" };
  if (pct >= 70) return { emoji: "🟡", color: "#d97706", label: "En camino" };
  return { emoji: "🔴", color: "#dc2626", label: "Bajo lo esperado" };
}

function KpiCard({ title, value, subtitle, color, icon: Icon, children }) {
  return (
    <div style={{
      background: "var(--surface)",
      borderRadius: "var(--radius-lg)",
      border: "1px solid var(--border)",
      borderTop: `3px solid ${color}`,
      padding: "18px 20px",
      boxShadow: "var(--shadow-sm)",
    }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: "10px" }}>
        <div style={{ fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.12em", color: "var(--text-muted)", fontWeight: 600 }}>
          {title}
        </div>
        {Icon && (
          <div style={{
            width: "30px", height: "30px", borderRadius: "8px",
            background: `${color}18`,
            display: "flex", alignItems: "center", justifyContent: "center",
            color, flexShrink: 0,
          }}>
            <Icon size={15} />
          </div>
        )}
      </div>
      {children ? children : (
        <>
          <div style={{ fontSize: "26px", fontWeight: 700, color: "var(--text)", lineHeight: 1, marginBottom: "6px" }}>
            {value}
          </div>
          {subtitle ? <div style={{ fontSize: "12px", color: "var(--text-muted)" }}>{subtitle}</div> : null}
        </>
      )}
    </div>
  );
}

export default function CotizacionesPorVendedor() {
  const { rol, cargando } = useAuth();
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");
  const [licitaciones, setLicitaciones] = useState([]);
  const [usuariosMap, setUsuariosMap] = useState({});
  const [periodo, setPeriodo] = useState(mesActualISO());

  // Meta del equipo (mensual, customizable)
  const [meta, setMeta] = useState(META_DEFECTO);
  const [editandoMeta, setEditandoMeta] = useState(false);
  const [metaInput, setMetaInput] = useState(String(META_DEFECTO));
  const [guardandoMeta, setGuardandoMeta] = useState(false);

  const rolNorm = (rol || "").toString().trim().toLowerCase();
  const esAdmin = rolNorm === "admin" || rolNorm === "administrador";
  const esJefeVentas =
    rolNorm === "jefe_ventas" ||
    rolNorm === "jefe ventas" ||
    rolNorm === "jefe-ventas" ||
    rolNorm === "jefe de ventas" ||
    rolNorm === "jefe_ventas_especial";
  const puedeVer = esAdmin || esJefeVentas;

  // Cargar cotizaciones + perfiles (una vez)
  useEffect(() => {
    if (cargando) return;
    if (!puedeVer) {
      setLoading(false);
      setErrorMsg("Acceso restringido: este reporte es solo para administradores y jefatura de ventas.");
      return;
    }

    let mounted = true;

    async function cargar() {
      setLoading(true);
      setErrorMsg("");
      try {
        const lics = await api.get(
          "/licitaciones/with-fields?fields=id,id_licitacion,fecha,estado,creado_por,tipo_cliente,tipo_compra,region"
        );
        const rows = lics || [];

        const emails = Array.from(
          new Set(rows.map((l) => (l.creado_por || "").trim().toLowerCase()).filter(Boolean))
        );

        let mapa = {};
        if (emails.length > 0) {
          try {
            const perfiles = await api.post("/usuarios/profiles/by-emails", { emails });
            (perfiles || []).forEach((p) => {
              const email = (p?.email || "").trim().toLowerCase();
              if (email) mapa[email] = (p?.nombre || "").trim();
            });
          } catch (e) {
            console.error("Error profiles:", e);
          }
        }

        if (!mounted) return;
        setLicitaciones(rows);
        setUsuariosMap(mapa);
      } catch (e) {
        console.error("Error cargando cotizaciones por vendedor:", e);
        if (mounted) {
          setErrorMsg("No se pudieron cargar las cotizaciones.");
          setLicitaciones([]);
          setUsuariosMap({});
        }
      } finally {
        if (mounted) setLoading(false);
      }
    }

    cargar();
    return () => { mounted = false; };
  }, [cargando, puedeVer]);

  // Meta del equipo = suma de la "Meta (cantidad)" de cada vendedor definida en
  // la sección Metas (no se ingresa a mano). Metas guarda el periodo como 'YYYY-MM-01'.
  useEffect(() => {
    if (cargando || !puedeVer || !periodo) return;
    let mounted = true;
    (async () => {
      try {
        const rows = await api.get(`/metas/canal-partes?periodo=${periodo}-01`);
        if (!mounted) return;
        const total = (rows || []).reduce((acc, r) => acc + Number(r?.meta_cantidad || 0), 0);
        setMeta(total);
      } catch (e) {
        console.error("Error cargando meta del equipo:", e);
        if (mounted) setMeta(0);
      }
    })();
    return () => { mounted = false; };
  }, [cargando, puedeVer, periodo]);

  async function guardarMeta() {
    const valor = Math.max(0, Math.round(Number(metaInput) || 0));
    setGuardandoMeta(true);
    try {
      await api.post("/metas/cotizaciones-equipo", { periodo, meta: valor });
      setMeta(valor);
      setEditandoMeta(false);
    } catch (e) {
      console.error("Error guardando meta:", e);
      alert("No se pudo guardar la meta. Intenta nuevamente.");
    } finally {
      setGuardandoMeta(false);
    }
  }

  // Cotizaciones ingresadas en el periodo (por fecha de creación = `fecha`)
  const cotizacionesPeriodo = useMemo(() => {
    return licitaciones.filter((l) => {
      const f = toDateISO(l.fecha);
      return f && f.slice(0, 7) === periodo;
    });
  }, [licitaciones, periodo]);

  // Agrupación por vendedor
  const resumenVendedores = useMemo(() => {
    const m = new Map();
    cotizacionesPeriodo.forEach((l) => {
      const email = (l.creado_por || "").trim().toLowerCase() || "__sin_creador__";
      const nombre = (usuariosMap[email] || "").trim() ||
        (email === "__sin_creador__" ? "Sin asignar" : email);
      const row = m.get(email) || {
        email, nombre,
        ingresadas: 0,   // cuentan para meta (excluye descartadas/desiertas)
        total: 0,        // todas, incluidas las que no cuentan
        adjudicadas: 0,
        pendientes: 0,
        perdidas: 0,
        noCuentan: 0,
      };
      row.total += 1;
      const estado = (l.estado || "").trim();
      const cuenta = !ESTADOS_NO_CUENTAN.includes(estado);
      if (cuenta) row.ingresadas += 1; else row.noCuentan += 1;

      if (estado === "Adjudicada") row.adjudicadas += 1;
      else if (estado === "Perdida") row.perdidas += 1;
      else if (estado === "En espera" || estado === "Pendiente Aprobación") row.pendientes += 1;

      m.set(email, row);
    });
    return Array.from(m.values()).sort(
      (a, b) => b.ingresadas - a.ingresadas || b.total - a.total || a.nombre.localeCompare(b.nombre)
    );
  }, [cotizacionesPeriodo, usuariosMap]);

  const totales = useMemo(() => {
    const ingresadas = resumenVendedores.reduce((acc, r) => acc + r.ingresadas, 0);
    const total = resumenVendedores.reduce((acc, r) => acc + r.total, 0);
    const adjudicadas = resumenVendedores.reduce((acc, r) => acc + r.adjudicadas, 0);
    const pendientes = resumenVendedores.reduce((acc, r) => acc + r.pendientes, 0);
    const perdidas = resumenVendedores.reduce((acc, r) => acc + r.perdidas, 0);
    const noCuentan = resumenVendedores.reduce((acc, r) => acc + r.noCuentan, 0);
    const pctMeta = meta > 0 ? (ingresadas / meta) * 100 : 0;
    const faltan = Math.max(0, meta - ingresadas);
    return { ingresadas, total, adjudicadas, pendientes, perdidas, noCuentan, pctMeta, faltan };
  }, [resumenVendedores, meta]);

  const sem = semaforo(totales.pctMeta);
  const maxIngresadas = useMemo(
    () => Math.max(1, ...resumenVendedores.map((r) => r.ingresadas)),
    [resumenVendedores]
  );

  if (!cargando && !puedeVer) {
    return (
      <div className="page">
        <div className="surface">
          <div className="surface-body" style={{ color: "var(--danger)" }}>
            Acceso restringido: este reporte es solo para administradores y jefatura de ventas.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      {/* HEADER */}
      <div className="surface" style={{ marginBottom: "20px" }}>
        <div className="surface-body">
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-start", justifyContent: "space-between", gap: "20px" }}>
            <div>
              <div style={{ fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.15em", color: "var(--primary)", fontWeight: 600, marginBottom: "6px" }}>
                Reporte
              </div>
              <h1 className="page-title" style={{ marginBottom: "4px" }}>Cotizaciones por Vendedor</h1>
              <p style={{ fontSize: "13px", color: "var(--text-muted)", margin: 0 }}>
                Detalle de cotizaciones ingresadas por vendedor y avance del equipo frente a la meta mensual.
              </p>
            </div>

            <div className="field" style={{ minWidth: "220px" }}>
              <label className="field-label">Periodo (mes)</label>
              <input
                type="month"
                className="input"
                value={periodo}
                onChange={(e) => setPeriodo(e.target.value || mesActualISO())}
              />
            </div>
          </div>

          <div style={{ marginTop: "12px" }}>
            <span style={{
              display: "inline-flex", alignItems: "center", borderRadius: "999px",
              border: "1px solid var(--border)", background: "var(--bg)",
              padding: "3px 12px", fontSize: "12px", color: "var(--text-muted)",
            }}>
              {nombreMes(periodo)} · No cuentan para la meta los estados Descartada y Desierta
            </span>
          </div>
        </div>
      </div>

      {errorMsg ? (
        <div style={{ marginBottom: "16px", borderRadius: "var(--radius)", border: "1px solid #fecaca", background: "#fef2f2", color: "#b91c1c", padding: "12px 16px", fontSize: "13px" }}>
          {errorMsg}
        </div>
      ) : null}

      {loading ? (
        <div className="surface">
          <div className="surface-body" style={{ color: "var(--text-muted)" }}>
            Cargando cotizaciones…
          </div>
        </div>
      ) : (
        <>
          {/* KPI CARDS */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "16px", marginBottom: "20px" }}>
            {/* Meta del equipo = suma de "Meta (cantidad)" por vendedor (sección Metas) */}
            <KpiCard title="Meta del Equipo" color="#6366f1" icon={Target}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <div style={{ fontSize: "26px", fontWeight: 700, color: "var(--text)", lineHeight: 1 }}>
                  {meta.toLocaleString("es-CL")}
                </div>
              </div>
              <div style={{ fontSize: "12px", color: "var(--text-muted)", marginTop: "6px" }}>
                Suma de metas por vendedor · {nombreMes(periodo)}
              </div>
            </KpiCard>

            <KpiCard
              title="Ingresadas"
              value={totales.ingresadas.toLocaleString("es-CL")}
              subtitle={`${totales.total.toLocaleString("es-CL")} en total · ${totales.noCuentan} no cuentan`}
              color="#0891b2"
              icon={ClipboardList}
            />

            <KpiCard title="Avance de Meta" color={sem.color} icon={TrendingUp}>
              <div style={{ fontSize: "26px", fontWeight: 700, color: sem.color, lineHeight: 1, marginBottom: "6px" }}>
                {sem.emoji} {fmtPct(totales.pctMeta)}
              </div>
              <div style={{ fontSize: "12px", color: "var(--text-muted)" }}>{sem.label}</div>
            </KpiCard>

            <KpiCard
              title={totales.faltan > 0 ? "Faltan para la meta" : "Meta superada en"}
              value={(totales.faltan > 0
                ? totales.faltan
                : totales.ingresadas - meta
              ).toLocaleString("es-CL")}
              subtitle={totales.faltan > 0 ? "cotizaciones por ingresar" : "cotizaciones sobre la meta"}
              color={totales.faltan > 0 ? "#d97706" : "#16a34a"}
              icon={Target}
            />
          </div>

          {/* BARRA DE AVANCE DEL EQUIPO */}
          <div className="surface" style={{ marginBottom: "20px" }}>
            <div className="surface-body">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "10px" }}>
                <h3 className="surface-title" style={{ margin: 0 }}>Avance del Equipo</h3>
                <span style={{ fontSize: "13px", color: "var(--text-muted)" }}>
                  {totales.ingresadas.toLocaleString("es-CL")} / {meta.toLocaleString("es-CL")} ({fmtPct(totales.pctMeta)})
                </span>
              </div>
              <div style={{ position: "relative", height: "28px", borderRadius: "8px", background: "var(--bg)", border: "1px solid var(--border)", overflow: "hidden" }}>
                <div style={{
                  position: "absolute", top: 0, left: 0, bottom: 0,
                  width: `${Math.min(100, totales.pctMeta)}%`,
                  background: sem.color, opacity: 0.85,
                  transition: "width 0.4s ease",
                }} />
                <div style={{
                  position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: "12px", fontWeight: 600, color: "var(--text)",
                }}>
                  {sem.emoji} {fmtPct(totales.pctMeta)} · {sem.label}
                </div>
              </div>
            </div>
          </div>

          {/* TABLA DETALLE POR VENDEDOR */}
          <div className="surface">
            <div className="surface-header">
              <div>
                <h3 className="surface-title">Detalle por Vendedor</h3>
                <p style={{ fontSize: "12px", color: "var(--text-muted)", margin: 0 }}>
                  Cotizaciones ingresadas por cada vendedor y su aporte a la meta del equipo.
                </p>
              </div>
              <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>
                {resumenVendedores.length} vendedor(es)
              </span>
            </div>
            <div className="table-wrap" style={{ boxShadow: "none", border: "none", borderRadius: 0 }}>
              <div className="table-scroll">
                <table className="data-table" style={{ minWidth: "920px" }}>
                  <thead>
                    <tr>
                      <th>Vendedor</th>
                      <th style={{ textAlign: "right" }}>Ingresadas</th>
                      <th style={{ textAlign: "right" }}>Adj.</th>
                      <th style={{ textAlign: "right" }}>Pend.</th>
                      <th style={{ textAlign: "right" }}>Perd.</th>
                      <th style={{ textAlign: "right" }}>No cuentan</th>
                      <th style={{ textAlign: "right" }}>% del equipo</th>
                      <th style={{ minWidth: "160px" }}>Aporte a la meta</th>
                    </tr>
                  </thead>
                  <tbody>
                    {resumenVendedores.map((r) => {
                      const pctEquipo = totales.ingresadas > 0 ? (r.ingresadas / totales.ingresadas) * 100 : 0;
                      const pctMeta = meta > 0 ? (r.ingresadas / meta) * 100 : 0;
                      const pctBarra = (r.ingresadas / maxIngresadas) * 100;
                      return (
                        <tr key={r.email}>
                          <td>
                            <div style={{ fontWeight: 600, color: "var(--text)" }}>{r.nombre}</div>
                            <div style={{ fontSize: "12px", color: "var(--text-muted)" }}>
                              {r.email === "__sin_creador__" ? "-" : r.email}
                            </div>
                          </td>
                          <td style={{ textAlign: "right", fontWeight: 700, color: "#0e7490" }}>{r.ingresadas}</td>
                          <td style={{ textAlign: "right", color: "#15803d" }}>{r.adjudicadas}</td>
                          <td style={{ textAlign: "right" }}>{r.pendientes}</td>
                          <td style={{ textAlign: "right", color: "#b91c1c" }}>{r.perdidas}</td>
                          <td style={{ textAlign: "right", color: "var(--text-muted)" }}>{r.noCuentan}</td>
                          <td style={{ textAlign: "right" }}>{fmtPct(pctEquipo)}</td>
                          <td>
                            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                              <div style={{ position: "relative", height: "12px", flex: 1, borderRadius: "6px", background: "var(--bg)", border: "1px solid var(--border)", overflow: "hidden" }}>
                                <div style={{ position: "absolute", top: 0, left: 0, bottom: 0, width: `${pctBarra}%`, background: "var(--primary)", opacity: 0.7 }} />
                              </div>
                              <span style={{ fontSize: "11px", color: "var(--text-muted)", whiteSpace: "nowrap", width: "44px", textAlign: "right" }}>
                                {fmtPct(pctMeta)}
                              </span>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                    {resumenVendedores.length === 0 && (
                      <tr>
                        <td colSpan={8} style={{ textAlign: "center", padding: "40px 0", color: "var(--text-muted)" }}>
                          No hay cotizaciones ingresadas en {nombreMes(periodo)}.
                        </td>
                      </tr>
                    )}
                  </tbody>
                  {resumenVendedores.length > 0 && (
                    <tfoot>
                      <tr style={{ fontWeight: 700, borderTop: "2px solid var(--border)" }}>
                        <td>Total equipo</td>
                        <td style={{ textAlign: "right", color: "#0e7490" }}>{totales.ingresadas}</td>
                        <td style={{ textAlign: "right", color: "#15803d" }}>{totales.adjudicadas}</td>
                        <td style={{ textAlign: "right" }}>{totales.pendientes}</td>
                        <td style={{ textAlign: "right", color: "#b91c1c" }}>{totales.perdidas}</td>
                        <td style={{ textAlign: "right", color: "var(--text-muted)" }}>{totales.noCuentan}</td>
                        <td style={{ textAlign: "right" }}>100%</td>
                        <td style={{ color: sem.color }}>{sem.emoji} {fmtPct(totales.pctMeta)} de la meta</td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
