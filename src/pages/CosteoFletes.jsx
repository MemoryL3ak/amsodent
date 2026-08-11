// CosteoFletes.jsx
// Submódulo de Logística: costeo de fletes de las cotizaciones ADJUDICADAS.
// - Trae las adjudicadas con sus OC, guías de despacho y N° de seguimiento,
//   agrupadas OC → guías (una OC puede tener muchas guías; una guía tiene un
//   solo N° de seguimiento).
// - Cruza el cobro real de cada envío (archivos de Starken / Blue) por N° de
//   seguimiento y calcula la diferencia entre el flete estimado y la suma de
//   los cobros de las guías de cada OC.
// - Subsección "Sin match": seguimientos de los archivos cargados que no
//   cruzan con ninguna guía. Subsección "Análisis": costeos cerrados.
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { Truck, Upload, Search, X, FileSpreadsheet, CircleDollarSign, Link2, Trash2, Lock, Unlock, BarChart3, AlertTriangle, Eye, ExternalLink } from "lucide-react";
import TarifasFlete from "../components/TarifasFlete";
import useAuth from "../hooks/useAuth";

const fmtCLP = (v) => `$${Math.round(Number(v || 0)).toLocaleString("es-CL")}`;
const fmtFecha = (v) => {
  if (!v) return "";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("es-CL", { day: "2-digit", month: "2-digit", year: "numeric" });
};

const EMPRESAS_COBRO = ["Starken", "Blue"];
const SEGMENTOS = ["Todas", "Starken", "Blue", "Despacho interno", "Sin guía"];

// Las guías guardan "Blue Express" / "Despacho interno" en empresa_despacho;
// los cobros usan "Starken" / "Blue". Se normaliza para cruzar y segmentar.
const normEmpresa = (v) => {
  const s = String(v || "").toLowerCase();
  if (s.includes("blue")) return "Blue";
  if (s.includes("starken")) return "Starken";
  if (s.includes("interno")) return "Despacho interno";
  return String(v || "").trim();
};

const badgeEmpresa = (empresa) => ({
  fontSize: 10, fontWeight: 700, padding: "1px 7px", borderRadius: 999,
  background: empresa === "Starken" ? "#fee2e2" : empresa === "Blue" ? "#dbeafe" : "#e5e7eb",
  color: empresa === "Starken" ? "#b91c1c" : empresa === "Blue" ? "#1e40af" : "#4b5563",
});

export default function CosteoFletes() {
  // La pestaña "Tarifas" (administración del tarifario, reajuste y despacho
  // interno) es SOLO para administradores; el backend también lo exige.
  const { rol } = useAuth();
  const esAdmin = ["admin", "administrador"].includes(String(rol || "").trim().toLowerCase());
  const [loading, setLoading] = useState(true);
  const [lics, setLics] = useState([]); // adjudicadas
  const [docs, setDocs] = useState([]); // OCs + guías de las adjudicadas
  const [cobros, setCobros] = useState([]); // fletes_cobros (Starken/Blue)
  const [cierres, setCierres] = useState([]); // fletes_cierres (costeos cerrados)
  const [vista, setVista] = useState("costeo"); // costeo | analisis | sinmatch
  const [segmento, setSegmento] = useState("Todas");
  const [filtroCruce, setFiltroCruce] = useState("todos"); // todos | con | sin
  const [busqueda, setBusqueda] = useState("");
  const [fechaDesde, setFechaDesde] = useState("");
  const [fechaHasta, setFechaHasta] = useState("");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [toast, setToast] = useState(null);
  const [reload, setReload] = useState(0);
  const [cerrando, setCerrando] = useState(null); // id de la cotización en cierre/reapertura
  const [preview, setPreview] = useState(null); // fila para la vista previa de la cotización
  const [asignando, setAsignando] = useState(null); // cobro sin match a asignar a una cotización

  useEffect(() => {
    let activo = true;
    (async () => {
      setLoading(true);
      try {
        const data = await api.get(
          "/licitaciones/with-fields?fields=id,id_licitacion,nombre,nombre_entidad,rut_entidad,fecha,fecha_adjudicada,estado,tipo_cliente,flete_estimado,total_con_iva,total_sin_iva"
        );
        const adjudicadas = (data || []).filter((l) => l.estado === "Adjudicada");
        const ids = adjudicadas.map((l) => Number(l.id)).filter(Boolean);
        let docsRows = [];
        if (ids.length) {
          docsRows = await api.post("/licitaciones/documentos/filter", {
            filter: { licitacion_ids: ids, tipo: ["orden_compra", "guia_despacho"] },
            fields: "id,licitacion_id,tipo,numero,monto,fecha_oc,empresa_despacho,n_seguimiento,deriva_de_id,created_at",
          }) || [];
        }
        const cobrosRows = await api.get("/fletes/cobros").catch((e) => {
          console.error("Error cargando cobros (¿migración aplicada?):", e);
          return [];
        });
        const cierresRows = await api.get("/fletes/cierres").catch(() => []);
        if (!activo) return;
        setLics(adjudicadas);
        setDocs(docsRows);
        setCobros(Array.isArray(cobrosRows) ? cobrosRows : []);
        setCierres(Array.isArray(cierresRows) ? cierresRows : []);
      } catch (e) {
        console.error("Error cargando costeo de fletes:", e);
        if (activo) { setLics([]); setDocs([]); setCobros([]); setCierres([]); }
      } finally {
        if (activo) setLoading(false);
      }
    })();
    return () => { activo = false; };
  }, [reload]);

  // Cobro real por (empresa, n° seguimiento).
  const cobroPorSeguimiento = useMemo(() => {
    const m = new Map();
    cobros.forEach((c) => {
      const n = String(c.n_seguimiento || "").trim();
      if (n) m.set(`${c.empresa}|${n}`, Number(c.monto || 0));
    });
    return m;
  }, [cobros]);

  const cierrePorLic = useMemo(() => {
    const m = new Map();
    cierres.forEach((c) => m.set(Number(c.licitacion_id), c));
    return m;
  }, [cierres]);

  // Una fila por cotización adjudicada, con grupos OC → guías → seguimiento.
  const filas = useMemo(() => {
    const docsPorLic = new Map();
    docs.forEach((d) => {
      const lid = String(d.licitacion_id);
      if (!docsPorLic.has(lid)) docsPorLic.set(lid, []);
      docsPorLic.get(lid).push(d);
    });
    return lics.map((l) => {
      const dd = docsPorLic.get(String(l.id)) || [];
      const ocs = dd.filter((d) => d.tipo === "orden_compra");
      const guias = dd.filter((d) => d.tipo === "guia_despacho");
      const fleteEstimado = Number(l.flete_estimado || 0);
      // Cruce: por cada guía con courier + n° seguimiento, buscar el cobro real.
      const envios = guias.map((g) => {
        const empresa = normEmpresa(g.empresa_despacho);
        const n = String(g.n_seguimiento || "").trim();
        const esCourier = EMPRESAS_COBRO.includes(empresa);
        const cobro = esCourier && n ? cobroPorSeguimiento.get(`${empresa}|${n}`) : undefined;
        return { ...g, empresa, n, cobro: cobro != null ? cobro : null, cruzado: cobro != null };
      });
      // Agrupación OC → guías (deriva_de_id) + grupo de guías sin OC.
      const ocIds = new Set(ocs.map((o) => Number(o.id)));
      const grupos = ocs.map((oc) => {
        const guiasOc = envios.filter((e) => Number(e.deriva_de_id) === Number(oc.id));
        const cobroOc = guiasOc.reduce((acc, e) => acc + (e.cobro || 0), 0);
        const cruzadosOc = guiasOc.filter((e) => e.cruzado).length;
        return {
          oc, guias: guiasOc, cobro: cobroOc, cruzados: cruzadosOc,
          // Diferencia por OC: flete estimado − Σ cobros de las guías de esa OC.
          dif: cruzadosOc > 0 ? fleteEstimado - cobroOc : null,
        };
      });
      const sinOc = envios.filter((e) => !e.deriva_de_id || !ocIds.has(Number(e.deriva_de_id)));
      if (sinOc.length) {
        const cobroSin = sinOc.reduce((acc, e) => acc + (e.cobro || 0), 0);
        const cruzadosSin = sinOc.filter((e) => e.cruzado).length;
        grupos.push({ oc: null, guias: sinOc, cobro: cobroSin, cruzados: cruzadosSin, dif: cruzadosSin > 0 ? fleteEstimado - cobroSin : null });
      }
      if (!grupos.length) grupos.push({ oc: null, guias: [], cobro: 0, cruzados: 0, dif: null });

      const empresas = [...new Set(envios.map((e) => e.empresa).filter(Boolean))];
      const cobroReal = envios.reduce((acc, e) => acc + (e.cobro || 0), 0);
      const enviosCourier = envios.filter((e) => EMPRESAS_COBRO.includes(e.empresa));
      const cruzados = enviosCourier.filter((e) => e.cruzado).length;
      const dif = cruzados > 0 ? fleteEstimado - cobroReal : null; // estimado − real (negativo = sobrecosto)
      const cierre = cierrePorLic.get(Number(l.id)) || null;
      return {
        id: l.id,
        codigo: l.id_licitacion || l.nombre || `Cot. ${l.id}`,
        cliente: l.nombre_entidad || l.rut_entidad || "—",
        fecha: l.fecha_adjudicada || l.fecha,
        ocs, guias: envios, grupos, empresas,
        fleteEstimado, cobroReal, dif,
        cruzados, totalCourier: enviosCourier.length,
        cierre,
      };
    }).sort((a, b) => String(b.fecha || "").localeCompare(String(a.fecha || "")));
  }, [lics, docs, cobroPorSeguimiento, cierrePorLic]);

  const enRangoFecha = (fecha) => {
    const f = String(fecha || "").slice(0, 10);
    if (fechaDesde && (!f || f < fechaDesde)) return false;
    if (fechaHasta && (!f || f > fechaHasta)) return false;
    return true;
  };

  const filtradas = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return filas.filter((f) => {
      if (!enRangoFecha(f.fecha)) return false;
      if (segmento === "Sin guía") {
        if (f.guias.length > 0) return false;
      } else if (segmento !== "Todas") {
        if (!f.empresas.includes(segmento)) return false;
      }
      // Filtro de cruce: con match = al menos una guía con cobro del courier.
      if (filtroCruce === "con" && f.cruzados === 0) return false;
      if (filtroCruce === "sin" && f.cruzados > 0) return false;
      if (!q) return true;
      return (
        String(f.codigo).toLowerCase().includes(q) ||
        String(f.cliente).toLowerCase().includes(q) ||
        f.guias.some((g) => g.n.toLowerCase().includes(q) || String(g.numero || "").toLowerCase().includes(q)) ||
        f.ocs.some((o) => String(o.numero || "").toLowerCase().includes(q))
      );
    });
  }, [filas, segmento, filtroCruce, busqueda, fechaDesde, fechaHasta]);

  const abiertas = useMemo(() => filtradas.filter((f) => !f.cierre), [filtradas]);
  const cerradas = useMemo(() => filtradas.filter((f) => f.cierre), [filtradas]);

  // Seguimientos de los archivos cargados que no cruzan con ninguna guía.
  const cobrosSinMatch = useMemo(() => {
    const claves = new Set();
    filas.forEach((f) => f.guias.forEach((g) => {
      if (g.n && EMPRESAS_COBRO.includes(g.empresa)) claves.add(`${g.empresa}|${g.n}`);
    }));
    return cobros
      .filter((c) => !claves.has(`${c.empresa}|${String(c.n_seguimiento || "").trim()}`))
      .sort((a, b) => String(a.empresa).localeCompare(String(b.empresa)) || String(a.n_seguimiento).localeCompare(String(b.n_seguimiento)));
  }, [filas, cobros]);

  const kpis = useMemo(() => {
    const base = abiertas;
    const conCourier = base.filter((f) => f.totalCourier > 0);
    const cruzadas = conCourier.filter((f) => f.cruzados > 0);
    return {
      adjudicadas: base.length,
      estimado: base.reduce((acc, f) => acc + f.fleteEstimado, 0),
      cobrado: base.reduce((acc, f) => acc + f.cobroReal, 0),
      dif: cruzadas.reduce((acc, f) => acc + (f.dif || 0), 0),
      cruzadas: cruzadas.length,
      conCourier: conCourier.length,
    };
  }, [abiertas]);

  const kpisCerradas = useMemo(() => ({
    total: cerradas.length,
    estimado: cerradas.reduce((acc, f) => acc + Number(f.cierre?.flete_estimado || 0), 0),
    cobrado: cerradas.reduce((acc, f) => acc + Number(f.cierre?.cobro_real || 0), 0),
    dif: cerradas.reduce((acc, f) => acc + Number(f.cierre?.diferencia || 0), 0),
  }), [cerradas]);

  async function limpiarCobros(empresa) {
    try {
      await api.delete(`/fletes/cobros?empresa=${encodeURIComponent(empresa)}`);
      setToast({ type: "success", message: `Cobros de ${empresa} eliminados.` });
      setReload((r) => r + 1);
    } catch (e) {
      console.error(e);
      setToast({ type: "error", message: `No se pudieron eliminar los cobros de ${empresa}.` });
    }
  }

  async function cerrarCosteo(f) {
    setCerrando(f.id);
    try {
      await api.post("/fletes/cierres", {
        licitacion_id: Number(f.id),
        flete_estimado: f.fleteEstimado,
        cobro_real: f.cobroReal,
        diferencia: f.fleteEstimado - f.cobroReal,
      });
      setToast({ type: "success", message: `Conciliación de ${f.codigo} cerrada. La encuentras en Análisis.` });
      setReload((r) => r + 1);
    } catch (e) {
      console.error(e);
      setToast({ type: "error", message: e?.message || "No se pudo cerrar la conciliación. ¿Está aplicada la migración de cierres?" });
    } finally {
      setCerrando(null);
    }
  }

  async function reabrirCosteo(f) {
    setCerrando(f.id);
    try {
      await api.delete(`/fletes/cierres/${f.id}`);
      setToast({ type: "success", message: `Conciliación de ${f.codigo} reabierta.` });
      setReload((r) => r + 1);
    } catch (e) {
      console.error(e);
      setToast({ type: "error", message: "No se pudo reabrir la conciliación." });
    } finally {
      setCerrando(null);
    }
  }

  const cobrosPorEmpresa = useMemo(() => {
    const m = { Starken: 0, Blue: 0 };
    cobros.forEach((c) => { if (m[c.empresa] != null) m[c.empresa] += 1; });
    return m;
  }, [cobros]);

  const TABS = [
    { key: "costeo", label: `Conciliación (${abiertas.length})`, icon: Truck },
    { key: "analisis", label: `Análisis (${cerradas.length})`, icon: BarChart3 },
    { key: "sinmatch", label: `Sin match (${cobrosSinMatch.length})`, icon: AlertTriangle },
    ...(esAdmin ? [{ key: "tarifas", label: "Tarifas", icon: CircleDollarSign }] : []),
  ];

  return (
    <div className="page">
      <div className="page-header" style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div>
          <h1 className="page-title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Truck size={20} /> Fletes
          </h1>
          <p className="page-subtitle">
            Cotizaciones adjudicadas: OC → guías → N° de seguimiento. Flete estimado vs. cobro real de Starken y Blue.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {EMPRESAS_COBRO.map((emp) => (
            cobrosPorEmpresa[emp] > 0 && (
              <button key={emp} className="btn btn-sm btn-ghost" onClick={() => limpiarCobros(emp)}
                title={`Eliminar los ${cobrosPorEmpresa[emp]} cobros cargados de ${emp}`}
                style={{ display: "inline-flex", alignItems: "center", gap: 5, color: "var(--danger)", fontSize: 12 }}>
                <Trash2 size={13} /> {emp}: {cobrosPorEmpresa[emp]}
              </button>
            )
          ))}
          <button className="btn btn-primary" onClick={() => setUploadOpen(true)} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <Upload size={15} /> Cargar cobros (Starken / Blue)
          </button>
        </div>
      </div>

      {/* KPIs (conciliaciones abiertas con los filtros aplicados) */}
      <div className="stats-row stats-5">
        <div className="stat-card">
          <div className="stat-label">En conciliación</div>
          <div className="stat-value">{kpis.adjudicadas.toLocaleString("es-CL")}</div>
          <div className="stat-sub">cotizaciones abiertas</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Flete estimado</div>
          <div className="stat-value" style={{ color: "var(--primary-dark)" }}>{fmtCLP(kpis.estimado)}</div>
          <div className="stat-sub">Σ de las abiertas</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Cobro real</div>
          <div className="stat-value" style={{ color: "#b45309" }}>{fmtCLP(kpis.cobrado)}</div>
          <div className="stat-sub">Σ cobros cruzados</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Diferencia</div>
          <div className="stat-value" style={{ color: kpis.dif >= 0 ? "#15803d" : "#dc2626" }}>{fmtCLP(kpis.dif)}</div>
          <div className="stat-sub">estimado − real (cruzadas)</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Cruzadas</div>
          <div className="stat-value" style={{ color: "#6366f1" }}>{kpis.cruzadas}/{kpis.conCourier}</div>
          <div className="stat-sub">con cobro del courier</div>
        </div>
      </div>

      {/* Subsecciones */}
      <div style={{ display: "flex", gap: 6, marginTop: 4, flexWrap: "wrap" }}>
        {TABS.map((t) => (
          <button key={t.key} type="button" onClick={() => setVista(t.key)}
            style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              fontSize: 13, fontWeight: 700, padding: "7px 14px", borderRadius: 9, cursor: "pointer",
              background: vista === t.key ? "var(--primary)" : "var(--surface)",
              color: vista === t.key ? "#fff" : "var(--text-muted)",
              border: `1px solid ${vista === t.key ? "var(--primary)" : "var(--border)"}`,
            }}>
            <t.icon size={14} /> {t.label}
          </button>
        ))}
      </div>

      {/* Filtros: búsqueda + rango de fechas + segmento por empresa de despacho */}
      {vista !== "sinmatch" && vista !== "tarifas" && (
        <div className="filter-bar" style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end", marginTop: 10 }}>
          <div className="filter-field" style={{ flex: 2, minWidth: 220 }}>
            <label className="filter-label">Buscar</label>
            <div style={{ position: "relative" }}>
              <Search size={15} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)" }} />
              <input className="input" style={{ paddingLeft: 32 }} placeholder="Cotización, cliente, N° seguimiento, guía u OC…" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
            </div>
          </div>
          <div className="filter-field">
            <label className="filter-label">Desde</label>
            <input type="date" className="input" value={fechaDesde} onChange={(e) => setFechaDesde(e.target.value)} />
          </div>
          <div className="filter-field">
            <label className="filter-label">Hasta</label>
            <input type="date" className="input" value={fechaHasta} onChange={(e) => setFechaHasta(e.target.value)} />
          </div>
          {(fechaDesde || fechaHasta) && (
            <button className="btn btn-sm btn-ghost" onClick={() => { setFechaDesde(""); setFechaHasta(""); }} style={{ fontSize: 12 }}>
              Limpiar fechas
            </button>
          )}
          <div className="filter-field">
            <label className="filter-label">Cruce</label>
            <select className="input" value={filtroCruce} onChange={(e) => setFiltroCruce(e.target.value)} style={{ minWidth: 130 }}>
              <option value="todos">Todos</option>
              <option value="con">Con match</option>
              <option value="sin">Sin match</option>
            </select>
          </div>
          <div className="filter-field">
            <label className="filter-label">Empresa de despacho</label>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {SEGMENTOS.map((s) => (
                <button key={s} type="button" onClick={() => setSegmento(s)}
                  style={{
                    fontSize: 12.5, fontWeight: 700, padding: "6px 12px", borderRadius: 999, cursor: "pointer",
                    background: segmento === s ? "var(--primary)" : "var(--surface)",
                    color: segmento === s ? "#fff" : "var(--text-muted)",
                    border: `1px solid ${segmento === s ? "var(--primary)" : "var(--border)"}`,
                  }}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Vista: Costeo (abiertas) ── */}
      {vista === "costeo" && (
        <div className="surface" style={{ marginTop: 14, overflowX: "auto" }}>
          {loading ? (
            <div style={{ padding: "36px 24px", color: "var(--text-muted)" }}>Cargando adjudicadas…</div>
          ) : abiertas.length === 0 ? (
            <div style={{ padding: "36px 24px", color: "var(--text-muted)" }}>Sin cotizaciones para el filtro.</div>
          ) : (
            <TablaCosteo filas={abiertas} onPreview={setPreview} accion={(f) => (
              <button className="btn btn-sm btn-secondary" disabled={cerrando === f.id} onClick={() => cerrarCosteo(f)}
                title="Cerrar la conciliación y moverla a Análisis"
                style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12 }}>
                <Lock size={12} /> {cerrando === f.id ? "…" : "Cerrar"}
              </button>
            )} />
          )}
        </div>
      )}

      {/* ── Vista: Análisis (cerradas) ── */}
      {vista === "analisis" && (
        <>
          <div className="stats-row" style={{ marginTop: 14 }}>
            <div className="stat-card">
              <div className="stat-label">Cerradas</div>
              <div className="stat-value">{kpisCerradas.total.toLocaleString("es-CL")}</div>
              <div className="stat-sub">conciliaciones en análisis</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Flete estimado</div>
              <div className="stat-value" style={{ color: "var(--primary-dark)" }}>{fmtCLP(kpisCerradas.estimado)}</div>
              <div className="stat-sub">Σ al cierre</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Cobro real</div>
              <div className="stat-value" style={{ color: "#b45309" }}>{fmtCLP(kpisCerradas.cobrado)}</div>
              <div className="stat-sub">Σ al cierre</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Diferencia</div>
              <div className="stat-value" style={{ color: kpisCerradas.dif >= 0 ? "#15803d" : "#dc2626" }}>{fmtCLP(kpisCerradas.dif)}</div>
              <div className="stat-sub">estimado − real</div>
            </div>
          </div>
          <div className="surface" style={{ marginTop: 14, overflowX: "auto" }}>
            {loading ? (
              <div style={{ padding: "36px 24px", color: "var(--text-muted)" }}>Cargando…</div>
            ) : cerradas.length === 0 ? (
              <div style={{ padding: "36px 24px", color: "var(--text-muted)" }}>
                Sin conciliaciones cerradas. Usa el botón "Cerrar" en la vista de Conciliación para traerlas aquí.
              </div>
            ) : (
              <table className="data-table" style={{ width: "100%", minWidth: 1080 }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left" }}>Cotización</th>
                    <th style={{ textAlign: "left" }}>Cliente</th>
                    <th style={{ textAlign: "left" }}>Cerrado</th>
                    <th style={{ textAlign: "right" }}>Flete estimado</th>
                    <th style={{ textAlign: "right" }}>Cobro real</th>
                    <th style={{ textAlign: "right" }}>Diferencia</th>
                    <th style={{ textAlign: "right" }}>Desviación</th>
                    <th style={{ textAlign: "center" }}></th>
                  </tr>
                </thead>
                <tbody>
                  {cerradas.map((f) => {
                    const c = f.cierre;
                    const est = Number(c.flete_estimado || 0);
                    const real = Number(c.cobro_real || 0);
                    const dif = Number(c.diferencia || 0);
                    const pct = est > 0 ? (dif / est) * 100 : null;
                    return (
                      <tr key={f.id}>
                        <td style={{ whiteSpace: "nowrap" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                            <Link to={`/detalle/${f.id}`} className="table-link" title="Ir a la cotización" style={{ fontWeight: 600 }}>
                              {f.codigo}
                            </Link>
                            <button className="btn btn-sm btn-ghost" onClick={() => setPreview(f)} title="Vista previa de la cotización" style={{ padding: 4 }}>
                              <Eye size={13} />
                            </button>
                          </div>
                          <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{fmtFecha(f.fecha)}</div>
                        </td>
                        <td style={{ maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12.5 }} title={f.cliente}>{f.cliente}</td>
                        <td style={{ fontSize: 12, whiteSpace: "nowrap" }}>
                          <div>{fmtFecha(c.created_at)}</div>
                          <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{c.cerrado_por || ""}</div>
                        </td>
                        <td style={{ textAlign: "right", fontWeight: 600 }}>{fmtCLP(est)}</td>
                        <td style={{ textAlign: "right", fontWeight: 600 }}>{fmtCLP(real)}</td>
                        <td style={{ textAlign: "right", fontWeight: 700, color: dif >= 0 ? "#15803d" : "#dc2626" }}>{fmtCLP(dif)}</td>
                        <td style={{ textAlign: "right", fontWeight: 600, color: dif >= 0 ? "#15803d" : "#dc2626" }}>
                          {pct == null ? "—" : `${pct >= 0 ? "" : "−"}${Math.abs(pct).toFixed(1)}%`}
                        </td>
                        <td style={{ textAlign: "center" }}>
                          <button className="btn btn-sm btn-ghost" disabled={cerrando === f.id} onClick={() => reabrirCosteo(f)}
                            title="Reabrir la conciliación (vuelve a la vista de Conciliación)"
                            style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12 }}>
                            <Unlock size={12} /> Reabrir
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {/* ── Vista: Sin match ── */}
      {vista === "sinmatch" && (
        <div className="surface" style={{ marginTop: 14, overflowX: "auto" }}>
          <div style={{ padding: "14px 18px 0", fontSize: 12.5, color: "var(--text-muted)" }}>
            N° de seguimiento presentes en los archivos de cobro cargados que no cruzan con ninguna guía de despacho de las adjudicadas.
          </div>
          {loading ? (
            <div style={{ padding: "36px 24px", color: "var(--text-muted)" }}>Cargando…</div>
          ) : cobrosSinMatch.length === 0 ? (
            <div style={{ padding: "36px 24px", color: "var(--text-muted)" }}>Todos los cobros cargados cruzan con una guía. 🎉</div>
          ) : (
            <table className="data-table" style={{ width: "100%", minWidth: 760 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left" }}>Empresa</th>
                  <th style={{ textAlign: "left" }}>N° Seguimiento</th>
                  <th style={{ textAlign: "right" }}>Monto cobrado</th>
                  <th style={{ textAlign: "left" }}>Referencia (archivo)</th>
                  <th style={{ textAlign: "left" }}>Archivo</th>
                  <th style={{ textAlign: "left" }}>Cargado</th>
                  <th style={{ textAlign: "center" }}>Acción</th>
                </tr>
              </thead>
              <tbody>
                {cobrosSinMatch.map((c) => (
                  <tr key={`${c.empresa}|${c.n_seguimiento}`}>
                    <td><span style={badgeEmpresa(c.empresa)}>{c.empresa}</span></td>
                    <td style={{ fontWeight: 600, whiteSpace: "nowrap" }}>{c.n_seguimiento}</td>
                    <td style={{ textAlign: "right", fontWeight: 600 }}>{fmtCLP(c.monto)}</td>
                    <td style={{ fontSize: 12, maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                      title={c.detalle ? Object.entries(c.detalle).map(([k, v]) => `${k}: ${v}`).join(" · ") : ""}>
                      {c.detalle ? Object.values(c.detalle).filter(Boolean).slice(0, 2).join(" · ") : <span style={{ color: "var(--text-muted)" }}>—</span>}
                    </td>
                    <td style={{ fontSize: 12, maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={c.archivo}>{c.archivo || "—"}</td>
                    <td style={{ fontSize: 12, whiteSpace: "nowrap" }}>{fmtFecha(c.created_at)}</td>
                    <td style={{ textAlign: "center" }}>
                      <button className="btn btn-sm btn-secondary" onClick={() => setAsignando(c)}
                        title="Asignar este cobro a la guía de una cotización"
                        style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12 }}>
                        <Link2 size={12} /> Asignar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={2} style={{ fontWeight: 700 }}>Total sin match</td>
                  <td style={{ textAlign: "right", fontWeight: 700 }}>{fmtCLP(cobrosSinMatch.reduce((acc, c) => acc + Number(c.monto || 0), 0))}</td>
                  <td colSpan={4}></td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      )}

      {/* ── Vista: Tarifas (administración del tarifario por courier) ── */}
      {vista === "tarifas" && <TarifasFlete onToast={setToast} />}

      {preview && (
        <ModalVistaCotizacion fila={preview} onClose={() => setPreview(null)} />
      )}

      {asignando && (
        <ModalAsignarCobro
          cobro={asignando}
          filas={filas}
          onClose={() => setAsignando(null)}
          onToast={setToast}
          onDone={(codigo) => {
            setAsignando(null);
            setToast({ type: "success", message: `Cobro ${asignando.n_seguimiento} asignado a la cotización ${codigo}.` });
            setReload((r) => r + 1);
          }}
        />
      )}

      {uploadOpen && (
        <ModalCargarCobros
          onClose={() => setUploadOpen(false)}
          onDone={(res) => {
            setUploadOpen(false);
            setToast({ type: "success", message: `Se cargaron ${res.insertados} cobros de ${res.empresa}.` });
            setReload((r) => r + 1);
          }}
          onToast={setToast}
        />
      )}

      {toast && (
        <div onClick={() => setToast(null)}
          style={{
            position: "fixed", bottom: 22, right: 22, zIndex: 12000, cursor: "pointer",
            background: toast.type === "error" ? "#fef2f2" : "#f0fdf4",
            border: `1px solid ${toast.type === "error" ? "#fecaca" : "#bbf7d0"}`,
            color: toast.type === "error" ? "#b91c1c" : "#15803d",
            padding: "12px 16px", borderRadius: 10, fontSize: 13, fontWeight: 600, boxShadow: "var(--shadow-lg)", maxWidth: 380,
          }}>
          {toast.message}
        </div>
      )}
    </div>
  );
}

/* ── Tabla de costeo: agrupación OC → guías/seguimientos ─────────────────
   Cada fila es un grupo: la OC con TODAS las guías (y sus N° de seguimiento)
   asociadas a ella vía deriva_de_id. Las guías sin OC van en su propio grupo.
   Las celdas de la cotización (código, cliente, flete estimado, cruce y
   acciones) se comparten entre los grupos con rowSpan. ─────────────────── */
function TablaCosteo({ filas, accion, onPreview }) {
  return (
    <table className="data-table" style={{ width: "100%", minWidth: 1360 }}>
      <thead>
        <tr>
          <th style={{ textAlign: "left" }}>Cotización</th>
          <th style={{ textAlign: "left" }}>Cliente</th>
          <th style={{ textAlign: "left" }}>OC</th>
          <th style={{ textAlign: "left" }}>Guía / Empresa</th>
          <th style={{ textAlign: "left" }}>N° Seguimiento</th>
          <th style={{ textAlign: "right" }}>Flete estimado</th>
          <th style={{ textAlign: "right" }}>Cobro guía</th>
          <th style={{ textAlign: "right" }}>Σ Cobro OC</th>
          <th style={{ textAlign: "right" }}>Diferencia OC</th>
          <th style={{ textAlign: "center" }}>Cruce</th>
          <th style={{ textAlign: "center" }}>Acciones</th>
        </tr>
      </thead>
      <tbody>
        {filas.map((f) => f.grupos.map((g, gi) => (
          <tr key={`${f.id}-${gi}`} style={gi > 0 ? { borderTop: "1px dashed var(--border)" } : undefined}>
            {gi === 0 && (
              <>
                <td rowSpan={f.grupos.length} style={{ whiteSpace: "nowrap", verticalAlign: "top" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <Link to={`/detalle/${f.id}`} className="table-link" title="Ir a la cotización" style={{ fontWeight: 600 }}>
                      {f.codigo}
                    </Link>
                    <button className="btn btn-sm btn-ghost" onClick={() => onPreview?.(f)} title="Vista previa de la cotización" style={{ padding: 4 }}>
                      <Eye size={13} />
                    </button>
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{fmtFecha(f.fecha)}</div>
                </td>
                <td rowSpan={f.grupos.length} style={{ maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12.5, verticalAlign: "top" }} title={f.cliente}>
                  {f.cliente}
                </td>
              </>
            )}
            <td style={{ fontSize: 12.5, whiteSpace: "nowrap", verticalAlign: "top" }}>
              {g.oc ? (
                <div title={fmtCLP(g.oc.monto)}>
                  <div style={{ fontWeight: 600 }}>{g.oc.numero || "S/N"}</div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{fmtCLP(g.oc.monto)} · {g.guias.length} guía{g.guias.length === 1 ? "" : "s"}</div>
                </div>
              ) : g.guias.length ? (
                <span style={{ color: "#b45309", fontSize: 11.5, fontWeight: 600 }}>Guías sin OC</span>
              ) : (
                <span style={{ color: "var(--text-muted)" }}>—</span>
              )}
            </td>
            <td style={{ fontSize: 12.5, whiteSpace: "nowrap", verticalAlign: "top" }}>
              {g.guias.length === 0 ? <span style={{ color: "var(--text-muted)" }}>Sin guía</span> : g.guias.map((gg, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  <span>{gg.numero || "S/N"}</span>
                  <span style={badgeEmpresa(gg.empresa)}>{gg.empresa || "—"}</span>
                </div>
              ))}
            </td>
            <td style={{ fontSize: 12.5, whiteSpace: "nowrap", verticalAlign: "top" }}>
              {g.guias.length === 0 ? <span style={{ color: "var(--text-muted)" }}>—</span> : g.guias.map((gg, i) => (
                <div key={i}>{gg.n || <span style={{ color: "var(--text-muted)" }}>—</span>}</div>
              ))}
            </td>
            {gi === 0 && (
              <td rowSpan={f.grupos.length} style={{ textAlign: "right", fontWeight: 600, verticalAlign: "top" }}>
                {fmtCLP(f.fleteEstimado)}
              </td>
            )}
            <td style={{ fontSize: 12.5, whiteSpace: "nowrap", textAlign: "right", verticalAlign: "top" }}>
              {g.guias.length === 0 ? <span style={{ color: "var(--text-muted)" }}>—</span> : g.guias.map((gg, i) => (
                <div key={i}>{gg.cobro != null ? fmtCLP(gg.cobro) : <span style={{ color: "var(--text-muted)" }}>—</span>}</div>
              ))}
            </td>
            <td style={{ textAlign: "right", fontWeight: 600, verticalAlign: "top" }}>
              {g.cruzados > 0 ? fmtCLP(g.cobro) : <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>—</span>}
            </td>
            <td style={{ textAlign: "right", fontWeight: 700, verticalAlign: "top", color: g.dif == null ? "var(--text-muted)" : g.dif >= 0 ? "#15803d" : "#dc2626" }}>
              {g.dif == null ? "—" : fmtCLP(g.dif)}
            </td>
            {gi === 0 && (
              <>
                <td rowSpan={f.grupos.length} style={{ textAlign: "center", verticalAlign: "top" }}>
                  {f.totalCourier === 0 ? (
                    <span style={{ fontSize: 11, color: "var(--text-muted)" }}>N/A</span>
                  ) : f.cruzados === f.totalCourier ? (
                    <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 999, background: "#dcfce7", color: "#15803d" }}>Cruzada</span>
                  ) : f.cruzados > 0 ? (
                    <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 999, background: "#fef9c3", color: "#a16207" }}>{f.cruzados}/{f.totalCourier}</span>
                  ) : (
                    <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 999, background: "#fee2e2", color: "#b91c1c" }}>Sin cobro</span>
                  )}
                </td>
                <td rowSpan={f.grupos.length} style={{ textAlign: "center", verticalAlign: "top", whiteSpace: "nowrap" }}>
                  {accion?.(f)}
                </td>
              </>
            )}
          </tr>
        )))}
      </tbody>
    </table>
  );
}

/* ── Modal: vista previa de la cotización (sin salir del costeo) ────────── */
function ModalVistaCotizacion({ fila, onClose }) {
  const [lic, setLic] = useState(null);
  const [items, setItems] = useState([]);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    let activo = true;
    (async () => {
      setCargando(true);
      try {
        const [licData, itemsData] = await Promise.all([
          api.get(`/licitaciones/${fila.id}`),
          api.get(`/licitaciones/${fila.id}/items`).catch(() => []),
        ]);
        if (!activo) return;
        setLic(licData || null);
        setItems(Array.isArray(itemsData) ? itemsData : []);
      } catch (e) {
        console.error("Error cargando vista previa:", e);
        if (activo) { setLic(null); setItems([]); }
      } finally {
        if (activo) setCargando(false);
      }
    })();
    return () => { activo = false; };
  }, [fila.id]);

  const Dato = ({ label, children }) => (
    <div>
      <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".04em", color: "var(--text-muted)" }}>{label}</div>
      <div style={{ fontSize: 13, color: "var(--text)", marginTop: 1 }}>{children || "—"}</div>
    </div>
  );

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.55)", zIndex: 12000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
    >
      <div style={{ width: 760, maxWidth: "100%", maxHeight: "88vh", display: "flex", flexDirection: "column", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-lg)", padding: 22 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4, gap: 8 }}>
          <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}>
            <Eye size={17} /> Cotización {fila.codigo}
          </h3>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <Link to={`/detalle/${fila.id}`} className="btn btn-sm btn-primary" style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12 }}>
              <ExternalLink size={13} /> Ir a la cotización
            </Link>
            <button className="btn btn-ghost" onClick={onClose} style={{ padding: 6 }}><X size={18} /></button>
          </div>
        </div>

        {cargando ? (
          <div style={{ padding: "36px 0", color: "var(--text-muted)" }}>Cargando cotización…</div>
        ) : !lic ? (
          <div style={{ padding: "36px 0", color: "var(--danger)" }}>No se pudo cargar la cotización.</div>
        ) : (
          <div style={{ overflowY: "auto" }}>
            {/* Datos generales */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, padding: "10px 0 14px", borderBottom: "1px solid var(--border)" }}>
              <Dato label="Cliente">{lic.nombre_entidad}</Dato>
              <Dato label="RUT">{lic.rut_entidad}</Dato>
              <Dato label="Estado">
                <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 999, background: "#dcfce7", color: "#15803d" }}>{lic.estado || "—"}</span>
              </Dato>
              <Dato label="Fecha">{fmtFecha(lic.fecha)}</Dato>
              <Dato label="Adjudicada">{fmtFecha(lic.fecha_adjudicada)}</Dato>
              <Dato label="Vendedor">{lic.vendedor_nombre || lic.creado_por}</Dato>
              <Dato label="Condición de venta">{lic.condicion_venta}</Dato>
              <Dato label="Flete estimado">{fmtCLP(lic.flete_estimado)}</Dato>
              <Dato label="Total neto">{fmtCLP(lic.total_sin_iva)}</Dato>
              <Dato label="Total con IVA">{fmtCLP(lic.total_con_iva)}</Dato>
            </div>

            {/* OCs y guías (agrupadas), tal como en el costeo */}
            <div style={{ padding: "12px 0", borderBottom: "1px solid var(--border)" }}>
              <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8, color: "var(--text)" }}>Órdenes de compra y despachos</div>
              {fila.grupos.every((g) => !g.oc && g.guias.length === 0) ? (
                <div style={{ fontSize: 12.5, color: "var(--text-muted)" }}>Sin OC ni guías cargadas.</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {fila.grupos.map((g, gi) => (
                    <div key={gi} style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "8px 12px", fontSize: 12.5 }}>
                      <div style={{ fontWeight: 600, marginBottom: g.guias.length ? 4 : 0 }}>
                        {g.oc ? <>OC {g.oc.numero || "S/N"} · {fmtCLP(g.oc.monto)}</> : <span style={{ color: "#b45309" }}>Guías sin OC</span>}
                      </div>
                      {g.guias.map((gg, i) => (
                        <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, padding: "2px 0", color: "var(--text)" }}>
                          <span>Guía {gg.numero || "S/N"}</span>
                          <span style={badgeEmpresa(gg.empresa)}>{gg.empresa || "—"}</span>
                          {gg.n && <span style={{ color: "var(--text-muted)" }}>· Seg. {gg.n}</span>}
                          {gg.cobro != null && <span style={{ fontWeight: 600 }}>· {fmtCLP(gg.cobro)}</span>}
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Ítems */}
            <div style={{ padding: "12px 0 0" }}>
              <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8, color: "var(--text)" }}>
                Ítems ({items.length})
              </div>
              {items.length === 0 ? (
                <div style={{ fontSize: 12.5, color: "var(--text-muted)" }}>Sin ítems cargados.</div>
              ) : (
                <div style={{ border: "1px solid var(--border)", borderRadius: 8, overflowX: "auto" }}>
                  <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
                    <thead>
                      <tr style={{ color: "var(--text-muted)", textAlign: "left", background: "var(--bg)" }}>
                        <th style={{ padding: "6px 10px" }}>SKU</th>
                        <th style={{ padding: "6px 10px" }}>Producto</th>
                        <th style={{ padding: "6px 10px", textAlign: "right" }}>Cant.</th>
                        <th style={{ padding: "6px 10px", textAlign: "right" }}>V. unitario</th>
                        <th style={{ padding: "6px 10px", textAlign: "right" }}>Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((it, i) => (
                        <tr key={i} style={{ borderTop: "1px solid var(--border)" }}>
                          <td style={{ padding: "5px 10px", whiteSpace: "nowrap" }}>{it.sku || "—"}</td>
                          <td style={{ padding: "5px 10px" }}>{it.producto || "—"}</td>
                          <td style={{ padding: "5px 10px", textAlign: "right" }}>{Number(it.cantidad || 0).toLocaleString("es-CL")}</td>
                          <td style={{ padding: "5px 10px", textAlign: "right" }}>{fmtCLP(it.valor_unitario)}</td>
                          <td style={{ padding: "5px 10px", textAlign: "right", fontWeight: 600 }}>{fmtCLP(it.total)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Modal: asignar un cobro sin match a la guía de una cotización ──────
   El cobro no cruzó porque ninguna guía tiene ese N° de seguimiento. Asignar
   = escribir el N° de seguimiento (y la empresa) en la guía elegida, así el
   cruce queda permanente y el cobro sale de "Sin match". ─────────────── */
function ModalAsignarCobro({ cobro, filas, onClose, onToast, onDone }) {
  const [busqueda, setBusqueda] = useState("");
  const [licSel, setLicSel] = useState(null); // fila de la cotización elegida
  const [guiaSel, setGuiaSel] = useState(null); // id de la guía elegida
  const [guardando, setGuardando] = useState(false);

  const candidatas = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    const base = q
      ? filas.filter((f) =>
          String(f.codigo).toLowerCase().includes(q) ||
          String(f.cliente).toLowerCase().includes(q))
      : filas;
    return base.slice(0, 8);
  }, [filas, busqueda]);

  const guiaElegida = licSel?.guias.find((g) => Number(g.id) === Number(guiaSel)) || null;

  async function asignar() {
    if (!guiaSel) return;
    setGuardando(true);
    try {
      await api.put(`/licitaciones/documentos/${guiaSel}`, {
        n_seguimiento: String(cobro.n_seguimiento).trim(),
        // La guía guarda el nombre completo del courier ("Blue Express").
        empresa_despacho: cobro.empresa === "Blue" ? "Blue Express" : cobro.empresa,
      });
      onDone?.(licSel?.codigo || "");
    } catch (e) {
      console.error(e);
      onToast?.({ type: "error", message: e?.message || "No se pudo asignar el cobro a la guía." });
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.55)", zIndex: 12000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
    >
      <div style={{ width: 560, maxWidth: "100%", maxHeight: "88vh", display: "flex", flexDirection: "column", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-lg)", padding: 22 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}>
            <Link2 size={17} /> Asignar cobro a una cotización
          </h3>
          <button className="btn btn-ghost" onClick={onClose} style={{ padding: 6 }}><X size={18} /></button>
        </div>
        <p style={{ fontSize: 12.5, color: "var(--text-muted)", marginTop: 2, marginBottom: 12 }}>
          Cobro <span style={badgeEmpresa(cobro.empresa)}>{cobro.empresa}</span> · Seg. <strong>{cobro.n_seguimiento}</strong> · {fmtCLP(cobro.monto)}.
          Elige la cotización y la guía de despacho a la que corresponde: el N° de seguimiento quedará
          registrado en esa guía y el cruce será permanente.
        </p>

        {/* Paso 1: cotización */}
        <div className="field" style={{ marginBottom: 10 }}>
          <label className="field-label">Cotización</label>
          {licSel ? (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, border: "1px solid var(--border)", borderRadius: 8, padding: "8px 12px" }}>
              <div style={{ fontSize: 13 }}>
                <strong>{licSel.codigo}</strong>
                <span style={{ color: "var(--text-muted)" }}> · {licSel.cliente}</span>
              </div>
              <button className="btn btn-sm btn-ghost" onClick={() => { setLicSel(null); setGuiaSel(null); }} style={{ fontSize: 12 }}>Cambiar</button>
            </div>
          ) : (
            <>
              <div style={{ position: "relative" }}>
                <Search size={15} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)" }} />
                <input className="input" style={{ paddingLeft: 32 }} placeholder="Buscar por código o cliente…" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} autoFocus />
              </div>
              <div style={{ marginTop: 6, border: "1px solid var(--border)", borderRadius: 8, maxHeight: 190, overflowY: "auto" }}>
                {candidatas.length === 0 ? (
                  <div style={{ padding: "12px 14px", fontSize: 12.5, color: "var(--text-muted)" }}>Sin cotizaciones adjudicadas para la búsqueda.</div>
                ) : candidatas.map((f) => (
                  <div key={f.id} onClick={() => { setLicSel(f); setGuiaSel(null); }}
                    style={{ padding: "8px 12px", borderBottom: "1px solid var(--border)", cursor: "pointer", fontSize: 12.5 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                      <strong>{f.codigo}</strong>
                      <span style={{ color: "var(--text-muted)", fontSize: 11 }}>{fmtFecha(f.fecha)} · {f.guias.length} guía{f.guias.length === 1 ? "" : "s"}</span>
                    </div>
                    <div style={{ color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.cliente}</div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Paso 2: guía de esa cotización */}
        {licSel && (
          <div className="field" style={{ marginBottom: 10 }}>
            <label className="field-label">Guía de despacho</label>
            {licSel.guias.length === 0 ? (
              <div style={{ fontSize: 12.5, color: "#b45309", border: "1px solid #fde68a", background: "#fef3c7", borderRadius: 8, padding: "10px 12px" }}>
                Esta cotización no tiene guías de despacho cargadas. Carga primero la guía en el detalle de la cotización y vuelve a asignar el cobro.
              </div>
            ) : (
              <div style={{ border: "1px solid var(--border)", borderRadius: 8, maxHeight: 170, overflowY: "auto" }}>
                {licSel.guias.map((g) => (
                  <label key={g.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderBottom: "1px solid var(--border)", cursor: "pointer", fontSize: 12.5 }}>
                    <input type="radio" name="guia" checked={Number(guiaSel) === Number(g.id)} onChange={() => setGuiaSel(g.id)} />
                    <span style={{ fontWeight: 600 }}>Guía {g.numero || "S/N"}</span>
                    <span style={badgeEmpresa(g.empresa)}>{g.empresa || "—"}</span>
                    {g.n
                      ? <span style={{ color: "#b45309", fontSize: 11 }}>Seg. actual: {g.n} (se reemplazará)</span>
                      : <span style={{ color: "var(--text-muted)", fontSize: 11 }}>Sin N° de seguimiento</span>}
                  </label>
                ))}
              </div>
            )}
          </div>
        )}

        {guiaElegida?.n && (
          <p style={{ fontSize: 12, color: "#b45309", margin: "0 0 10px" }}>
            ⚠ La guía seleccionada ya tiene el seguimiento <strong>{guiaElegida.n}</strong>; al asignar se reemplazará por <strong>{cobro.n_seguimiento}</strong>.
          </p>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: "auto" }}>
          <button className="btn btn-secondary" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" onClick={asignar} disabled={guardando || !guiaSel}
            style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <Link2 size={14} /> {guardando ? "Asignando…" : "Asignar cobro"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Modal: cargar archivo de cobros Starken / Blue ────────────────────── */
// Monto por posición de columna según courier:
//  - Blue:    columna Y (el monto del despacho viene ahí).
//  - Starken: columna M trae el monto bruto → se calcula el neto (÷ 1,19).
// El N° de seguimiento se detecta por encabezado ("OS" en Starken, o el que
// contenga "seguimiento" / "envio" / "orden de flete" / "guia").
const COL_MONTO_IDX = { Blue: 24, Starken: 12 }; // Y = 24, M = 12 (base 0)
const COL_MONTO_LABEL = { Blue: "Y", Starken: "M (neto = M ÷ 1,19)" };

function ModalCargarCobros({ onClose, onDone, onToast }) {
  const inputRef = useRef(null);
  const [empresa, setEmpresa] = useState("Starken");
  const [nombreArchivo, setNombreArchivo] = useState("");
  const [rawRows, setRawRows] = useState(null); // filas crudas (arrays) del archivo
  const [filas, setFilas] = useState([]);
  const [colInfo, setColInfo] = useState(null); // {seg, monto}
  const [parsing, setParsing] = useState(false);
  const [enviando, setEnviando] = useState(false);

  const normKey = (k) =>
    String(k || "")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();

  // Índice de la columna de N° de seguimiento dentro de la fila de encabezados.
  // Starken: la trae en la columna A como "Nro Orden" (u "OS" en formatos
  // antiguos). Blue y genéricos: por nombre de encabezado.
  function detectarColSeguimiento(headers, emp) {
    const hs = headers.map((h, idx) => ({ idx, raw: h, norm: normKey(h) }));
    if (emp === "Starken") {
      const seg =
        hs.find((h) => h.norm === "os") ||
        hs.find((h) => ["nro orden", "n orden", "no orden", "numero orden", "num orden"].includes(h.norm)) ||
        hs.find((h) => h.norm.startsWith("nro orden") || h.norm.startsWith("numero de orden")) ||
        hs.find((h) => h.norm.includes("orden") && !h.norm.includes("compra")) ||
        hs.find((h) => h.norm.includes("seguimiento"));
      return seg || null;
    }
    const seg =
      hs.find((h) => h.norm === "os") ||
      hs.find((h) => h.norm.includes("seguimiento")) ||
      hs.find((h) => h.norm.includes("orden") && h.norm.includes("flete")) ||
      hs.find((h) => h.norm.includes("envio")) ||
      hs.find((h) => h.norm.includes("guia"));
    return seg || null;
  }

  const parseMonto = (v) => {
    if (typeof v === "number") return v;
    // "7983.19" (decimal punto) o "7.983" (miles) — si hay una sola puntuación
    // con 2 decimales se asume decimal; si no, se limpian separadores de miles.
    // Se descarta cualquier texto acompañante ("$", "CLP", espacios…).
    const s = String(v || "").trim().replace(/[^\d.,-]/g, "");
    if (!s) return 0;
    if (/^\d+[.,]\d{1,2}$/.test(s)) return Number(s.replace(",", "."));
    const limpio = s.replace(/[.,](?=\d{3}(\D|$))/g, "").replace(",", ".");
    const n = Number(limpio);
    return Number.isFinite(n) ? n : 0;
  };

  async function manejarArchivo(file) {
    if (!file) return;
    setNombreArchivo(file.name);
    // Sugerir empresa por el nombre del archivo.
    if (/blue/i.test(file.name)) setEmpresa("Blue");
    else if (/starken|cobro/i.test(file.name)) setEmpresa("Starken");
    setParsing(true);
    try {
      const XLSX = await import("xlsx");
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array", raw: false });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      // header:1 → matriz de filas; permite leer el monto por posición de columna.
      const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: false });
      if (!matrix.length) { setRawRows(null); setFilas([]); setColInfo(null); onToast?.({ type: "error", message: "El archivo no tiene filas." }); return; }
      // Si el rango de la hoja no parte en la columna A, los índices de la
      // matriz quedan corridos: se guarda el offset para que "columna M/Y"
      // siempre sea la columna real de la planilla.
      let colOffset = 0;
      try {
        colOffset = XLSX.utils.decode_range(sheet["!ref"] || "A1").s.c || 0;
      } catch { /* rango ilegible: se asume A */ }
      setRawRows({ matrix, colOffset });
    } catch (e) {
      console.error(e);
      onToast?.({ type: "error", message: "No se pudo leer el archivo. ¿Es un xlsx/csv válido?" });
      setRawRows(null);
      setFilas([]);
    } finally {
      setParsing(false);
    }
  }

  // Recalcula las filas cuando cambia el archivo o la empresa seleccionada
  // (el monto se lee de una columna distinta según el courier).
  useEffect(() => {
    if (!rawRows) { setFilas([]); setColInfo(null); return; }
    const { matrix, colOffset } = rawRows;
    // Fila de encabezados: la primera (entre las 10 iniciales) donde se
    // detecte la columna de N° de seguimiento.
    let headerIdx = -1;
    let segCol = null;
    for (let i = 0; i < Math.min(matrix.length, 10); i++) {
      const cand = detectarColSeguimiento(matrix[i] || [], empresa);
      if (cand) { headerIdx = i; segCol = cand; break; }
    }
    // Starken, último recurso: el N° de seguimiento va en la columna A —
    // se toma la primera fila con encabezado no vacío como cabecera.
    if ((headerIdx < 0 || !segCol) && empresa === "Starken") {
      const i = matrix.findIndex((r) => String(r?.[0] || "").trim());
      if (i >= 0) { headerIdx = i; segCol = { idx: 0, raw: String(matrix[i][0]).trim() || "columna A" }; }
    }
    if (headerIdx < 0 || !segCol) {
      setFilas([]);
      setColInfo(null);
      onToast?.({ type: "error", message: "No se detectó la columna de N° de seguimiento. Revisa el archivo." });
      return;
    }
    const headers = matrix[headerIdx] || [];
    const montoIdx = Math.max(0, COL_MONTO_IDX[empresa] - (colOffset || 0));
    const esStarken = empresa === "Starken";

    // Extrae las filas usando una columna de monto dada. `dividir` = el valor
    // viene bruto y hay que llevarlo a neto (÷ 1,19).
    const construir = (idxMonto, dividir) => {
      const out = [];
      for (let i = headerIdx + 1; i < matrix.length; i++) {
        const row = matrix[i] || [];
        const n = String(row[segCol.idx] || "").trim();
        const base = parseMonto(row[idxMonto]);
        const monto = dividir ? Math.round(base / 1.19) : Math.round(base);
        if (!n || !(monto > 0)) continue;
        // Detalle liviano de referencia (si las columnas existen).
        const detalle = {};
        headers.forEach((h, idx) => {
          const nk = normKey(h);
          if (nk.includes("referencia") || nk.includes("destinatario") || nk === "descripcion destino" || nk.includes("fecha entrega") || nk.startsWith("estado")) {
            const v = String(row[idx] || "").trim();
            if (v) detalle[nk.replace(/\s+/g, "_")] = v;
          }
        });
        out.push({ n_seguimiento: n, monto, detalle: Object.keys(detalle).length ? detalle : null });
      }
      return out;
    };

    // 1) Columna fija del courier (Starken: M bruto → neto; Blue: Y tal cual).
    let norm = construir(montoIdx, esStarken);
    let etiquetaMonto = `columna ${COL_MONTO_LABEL[empresa]}`;

    // 2) Respaldo: si la columna fija viene vacía en este formato de archivo,
    //    se busca el monto por nombre de encabezado. Si el encabezado ya es
    //    neto ("NETO_SUMA"…), no se divide.
    if (!norm.length) {
      const hs = headers.map((h, idx) => ({ idx, raw: h, norm: normKey(h) }));
      const cand =
        hs.find((h) => h.norm.startsWith("neto suma")) ||
        hs.find((h) => h.norm.startsWith("neto")) ||
        hs.find((h) => h.norm.startsWith("total")) ||
        hs.find((h) => h.norm.startsWith("monto")) ||
        hs.find((h) => h.norm.startsWith("valor") && !h.norm.includes("declarado")) ||
        hs.find((h) => h.norm.startsWith("flete"));
      if (cand && cand.idx !== montoIdx) {
        const yaEsNeto = cand.norm.startsWith("neto");
        const alt = construir(cand.idx, esStarken && !yaEsNeto);
        if (alt.length) {
          norm = alt;
          etiquetaMonto = `${cand.raw}${esStarken && !yaEsNeto ? " (neto = ÷ 1,19)" : ""}`;
        }
      }
    }

    setFilas(norm);
    setColInfo({ seg: String(segCol.raw || `col ${segCol.idx + 1}`), monto: etiquetaMonto });
    if (!norm.length) {
      // Diagnóstico: mostrar qué se leyó en la columna esperada de la primera
      // fila de datos, para saber por qué no validó.
      const primeraFila = matrix[headerIdx + 1] || [];
      const muestra = String(primeraFila[montoIdx] ?? "").trim() || "(vacío)";
      onToast?.({
        type: "error",
        message: `No se encontraron filas válidas (seguimiento + monto > 0). En la columna ${COL_MONTO_LABEL[empresa].split(" ")[0]} de la primera fila se leyó: "${muestra}".`,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawRows, empresa]);

  async function enviar() {
    if (!filas.length) return;
    setEnviando(true);
    try {
      const res = await api.post("/fletes/cobros/bulk", { empresa, archivo: nombreArchivo, rows: filas });
      onDone?.({ ...(res || { insertados: 0 }), empresa });
    } catch (e) {
      console.error(e);
      onToast?.({ type: "error", message: e?.message || "No se pudo subir el archivo. ¿Está aplicada la migración?" });
    } finally {
      setEnviando(false);
    }
  }

  const totalArchivo = filas.reduce((acc, f) => acc + f.monto, 0);

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.55)", zIndex: 12000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
    >
      <div style={{ width: 560, maxWidth: "100%", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-lg)", padding: 22 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}>
            <FileSpreadsheet size={18} /> Cargar cobros de flete
          </h3>
          <button className="btn btn-ghost" onClick={onClose} style={{ padding: 6 }}><X size={18} /></button>
        </div>
        <p style={{ fontSize: 12.5, color: "var(--text-muted)", marginTop: 2, marginBottom: 14 }}>
          Sube el detalle de cobro de <strong>Starken</strong> (monto bruto en la columna M, se calcula el neto)
          o <strong>Blue</strong> (monto en la columna Y). El cruce con las cotizaciones se hace por N° de
          seguimiento. Recargar un archivo actualiza los montos ya cargados.
        </p>

        <div className="field" style={{ marginBottom: 12 }}>
          <label className="field-label">Empresa</label>
          <select className="input" value={empresa} onChange={(e) => setEmpresa(e.target.value)} style={{ maxWidth: 220 }}>
            <option value="Starken">Starken</option>
            <option value="Blue">Blue</option>
          </select>
        </div>

        <div
          onClick={() => inputRef.current?.click()}
          style={{ border: "2px dashed var(--border)", borderRadius: 10, padding: "22px 16px", textAlign: "center", cursor: "pointer", background: "var(--bg)" }}
        >
          <Upload size={22} style={{ color: "var(--text-muted)" }} />
          <div style={{ fontSize: 13, marginTop: 6 }}>
            {nombreArchivo ? <strong>{nombreArchivo}</strong> : "Haz clic para elegir un archivo .xlsx / .xls / .csv"}
          </div>
          <input ref={inputRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: "none" }} onChange={(e) => manejarArchivo(e.target.files?.[0])} />
        </div>

        {parsing && <p style={{ fontSize: 12.5, marginTop: 10 }}>Leyendo archivo…</p>}
        {!parsing && filas.length > 0 && (
          <div style={{ marginTop: 12, fontSize: 12.5, color: "var(--text)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <Link2 size={14} style={{ color: "var(--primary-dark)" }} />
              <span><strong>{filas.length}</strong> envío(s) detectado(s) · Total neto {fmtCLP(totalArchivo)}</span>
            </div>
            {colInfo && (
              <div style={{ marginTop: 6, fontSize: 11.5, color: "var(--text-muted)" }}>
                Columnas usadas → seguimiento: <strong>{colInfo.seg}</strong> · monto: <strong>{colInfo.monto}</strong>
              </div>
            )}
            <div style={{ marginTop: 8, maxHeight: 120, overflow: "auto", border: "1px solid var(--border)", borderRadius: 8 }}>
              <table style={{ width: "100%", fontSize: 11.5, borderCollapse: "collapse" }}>
                <thead><tr style={{ color: "var(--text-muted)", textAlign: "left" }}>
                  <th style={{ padding: "4px 8px" }}>N° Seguimiento</th><th style={{ padding: "4px 8px", textAlign: "right" }}>Monto neto</th>
                </tr></thead>
                <tbody>
                  {filas.slice(0, 6).map((f, i) => (
                    <tr key={i} style={{ borderTop: "1px solid var(--border)" }}>
                      <td style={{ padding: "3px 8px" }}>{f.n_seguimiento}</td>
                      <td style={{ padding: "3px 8px", textAlign: "right" }}>{fmtCLP(f.monto)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 18 }}>
          <button className="btn btn-secondary" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" onClick={enviar} disabled={enviando || parsing || filas.length === 0} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <CircleDollarSign size={15} /> {enviando ? "Subiendo…" : `Cargar ${filas.length || ""} cobro(s)`}
          </button>
        </div>
      </div>
    </div>
  );
}
