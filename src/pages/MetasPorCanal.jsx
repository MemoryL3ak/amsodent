import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import useAuth from "../hooks/useAuth";
import MonthCalendarPicker from "../components/MonthCalendarPicker";

const CANALES_ASIGNACION = [
  { value: "vendedor_terreno", label: "Vendedor Terreno" },
  { value: "vendedor_tienda_terreno", label: "Vendedor Tienda/Terreno" },
  { value: "vendedor_terreno_mercado_publico", label: "Vendedor Terreno/Mercado Publico" },
  { value: "vendedor_mercado_publico", label: "Vendedor Mercado Publico" },
  { value: "pagina_web", label: "Pagina Web" },
  { value: "vendedor_tienda", label: "Vendedor Tienda" },
  { value: "vendedor_freelance", label: "Vendedor Freelance" },
];

const CANALES_RESUMEN = [
  { value: "vendedor_terreno", label: "Vendedor Terreno" },
  { value: "vendedor_mercado_publico", label: "Vendedor Mercado Publico" },
  { value: "pagina_web", label: "Pagina Web" },
  { value: "vendedor_tienda", label: "Vendedor Tienda" },
  { value: "vendedor_freelance", label: "Vendedor Freelance" },
];

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function monthStartISO() {
  const d = new Date();
  d.setDate(1);
  return d.toISOString().slice(0, 10);
}

function monthEndISO(start) {
  const base = start ? new Date(`${start}T00:00:00`) : new Date();
  if (Number.isNaN(base.getTime())) return todayISO();
  const y = base.getUTCFullYear();
  const m = base.getUTCMonth();
  return new Date(Date.UTC(y, m + 1, 0)).toISOString().slice(0, 10);
}

function toDateISO(value) {
  if (!value) return "";
  const s = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

function monthTitle(start) {
  const base = start ? new Date(`${start}T00:00:00`) : new Date();
  if (Number.isNaN(base.getTime())) return "Mes actual";
  return base.toLocaleDateString("es-CL", { month: "long", year: "numeric" });
}

function fmtCLP(value) {
  return `$${Number(value || 0).toLocaleString("es-CL")}`;
}

function fmtPct(value) {
  if (!Number.isFinite(Number(value))) return "0%";
  return `${Number(value).toFixed(1)}%`;
}

function colorCumplimiento(pct) {
  if (pct >= 100) return "#15803d";
  if (pct >= 70)  return "#0d9488";
  if (pct >= 40)  return "#b45309";
  return "#dc2626";
}

function normalizeCanal(value) {
  const raw = (value || "").toString().trim();
  const v = raw === "vendedor_terreno_mercado" ? "vendedor_terreno_mercado_publico" : raw;
  return CANALES_ASIGNACION.some((c) => c.value === v) ? v : "";
}

function canalLabel(value) {
  return (
    CANALES_ASIGNACION.find((c) => c.value === value)?.label ||
    CANALES_RESUMEN.find((c) => c.value === value)?.label ||
    "Sin canal"
  );
}

function isMissingMontoColumnError(error) {
  const code = (error?.code || "").toString().toUpperCase();
  const msg = [error?.message, error?.details, error?.hint].filter(Boolean).join(" ").toLowerCase();
  return code === "42703" || code === "PGRST204" || (msg.includes("monto") && msg.includes("column"));
}

function isMissingFechaOcColumnError(error) {
  const code = (error?.code || "").toString().toUpperCase();
  const msg = [error?.message, error?.details, error?.hint].filter(Boolean).join(" ").toLowerCase();
  return code === "42703" || code === "PGRST204" || (msg.includes("fecha_oc") && msg.includes("column"));
}

function isMissingAsignacionTableError(error) {
  const code = (error?.code || "").toString().toUpperCase();
  const msg = [error?.message, error?.details, error?.hint].filter(Boolean).join(" ").toLowerCase();
  return code === "42P01" || msg.includes("vendedor_metas_canal_mensuales");
}

function isMissingMetasTableError(error) {
  const code = (error?.code || "").toString().toUpperCase();
  const msg = [error?.message, error?.details, error?.hint].filter(Boolean).join(" ").toLowerCase();
  return code === "42P01" || msg.includes("vendedor_metas_mensuales");
}

function isMissingMetaDetalleTableError(error) {
  const code = (error?.code || "").toString().toUpperCase();
  const msg = [error?.message, error?.details, error?.hint].filter(Boolean).join(" ").toLowerCase();
  return code === "42P01" || msg.includes("vendedor_metas_canal_partes_mensuales");
}

function splitBaseCanales(canal) {
  const c = normalizeCanal(canal);
  if (c === "vendedor_tienda_terreno") return ["vendedor_tienda", "vendedor_terreno"];
  if (c === "vendedor_terreno_mercado_publico") return ["vendedor_terreno", "vendedor_mercado_publico"];
  return [];
}

export default function MetasPorCanal() {
  const { rol, cargando } = useAuth();
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");
  const [metasErrorMsg, setMetasErrorMsg] = useState("");
  const [metasInfoMsg, setMetasInfoMsg] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [metaPeriodo, setMetaPeriodo] = useState(monthStartISO());
  const [filtroVendedor, setFiltroVendedor] = useState("");

  const [licitaciones, setLicitaciones] = useState([]);
  const [ocs, setOcs] = useState([]);
  const [usuariosMap, setUsuariosMap] = useState({});
  const [canalPorVendedorMap, setCanalPorVendedorMap] = useState({});
  const [canalPorVendedorDraftMap, setCanalPorVendedorDraftMap] = useState({});
  const [metasVendedorMap, setMetasVendedorMap] = useState({});
  const [metasDetalleVendedorMap, setMetasDetalleVendedorMap] = useState({});

  const rolNorm = (rol || "").toString().trim().toLowerCase();
  const esAdmin = rolNorm === "admin" || rolNorm === "administrador";

  useEffect(() => {
    if (cargando) return;
    if (!esAdmin) {
      setLoading(false);
      setErrorMsg("Acceso restringido: esta seccion es solo para administradores.");
      return;
    }

    let mounted = true;

    async function cargarBase() {
      setLoading(true);
      setErrorMsg("");
      try {
        const lics = await api.get("/licitaciones/with-fields?fields=id,creado_por");

        const rows = lics || [];
        const ids = rows.map((l) => Number(l?.id)).filter((n) => Number.isFinite(n));
        let docsOcRows = [];

        if (ids.length > 0) {
          try {
            docsOcRows = await api.post("/licitaciones/documentos/filter", {
              filter: { licitacion_ids: ids, tipo: "orden_compra" },
              fields: "licitacion_id,monto,fecha_oc,created_at",
            }) || [];
          } catch (errDocsOc) {
            if (isMissingFechaOcColumnError(errDocsOc)) {
              try {
                const docsOcNoFecha = await api.post("/licitaciones/documentos/filter", {
                  filter: { licitacion_ids: ids, tipo: "orden_compra" },
                  fields: "licitacion_id,monto,created_at",
                });
                docsOcRows = (docsOcNoFecha || []).map((d) => ({ ...d, fecha_oc: null }));
              } catch (errDocsOcNoFecha) {
                if (!isMissingMontoColumnError(errDocsOcNoFecha)) throw errDocsOcNoFecha;
              }
            } else if (!isMissingMontoColumnError(errDocsOc)) {
              throw errDocsOc;
            }
          }
        }

        const allProfiles = await api.get("/usuarios/profiles");

        const mapa = {};
        (allProfiles || []).filter((p) => ["ventas", "jefe_ventas"].includes(p?.rol)).forEach((p) => {
          const email = (p?.email || "").trim().toLowerCase();
          if (email) mapa[email] = (p?.nombre || "").trim() || email;
        });

        if (!mounted) return;
        setLicitaciones(rows);
        setOcs(docsOcRows);
        setUsuariosMap(mapa);
      } catch (e) {
        console.error("Error cargando metas por canal:", e);
        if (!mounted) return;
        setErrorMsg("No se pudo cargar la seccion de metas por canal.");
        setLicitaciones([]);
        setOcs([]);
        setUsuariosMap({});
      } finally {
        if (mounted) setLoading(false);
      }
    }

    cargarBase();
    return () => {
      mounted = false;
    };
  }, [cargando, esAdmin]);

  useEffect(() => {
    if (cargando || !esAdmin) return;
    let mounted = true;

    async function cargarAsignacionesYMetas() {
      setMetasErrorMsg("");
      setMetasInfoMsg("");

      let asigData = null, metasData = null, detalleData = null;
      let asigError = null, metasError = null, detalleError = null;

      try {
        [asigData, metasData, detalleData] = await Promise.all([
          api.get(`/metas/canal?periodo=${metaPeriodo}`).catch((e) => { asigError = e; return null; }),
          api.get(`/metas/mensuales?periodo=${metaPeriodo}`).catch((e) => { metasError = e; return null; }),
          api.get(`/metas/canal-partes?periodo=${metaPeriodo}`).catch((e) => { detalleError = e; return null; }),
        ]);
      } catch (e) {
        // handled individually
      }

      if (!mounted) return;

      if (asigError) {
        if (isMissingAsignacionTableError(asigError)) {
          setMetasErrorMsg("Falta la tabla vendedor_metas_canal_mensuales. Ejecuta la migracion.");
        } else {
          setMetasErrorMsg("No se pudieron cargar las asignaciones de canal.");
        }
        setCanalPorVendedorMap({});
        setCanalPorVendedorDraftMap({});
        return;
      }

      if (metasError) {
        if (isMissingMetasTableError(metasError)) {
          setMetasErrorMsg("Falta la tabla vendedor_metas_mensuales. Define primero las metas por vendedor.");
        } else {
          setMetasErrorMsg("No se pudieron cargar las metas por vendedor del periodo.");
        }
        setMetasVendedorMap({});
        setMetasDetalleVendedorMap({});
        return;
      }

      const canales = {};
      (asigData || []).forEach((row) => {
        const email = (row?.vendedor_email || "").trim().toLowerCase();
        if (email) canales[email] = normalizeCanal(row?.canal);
      });

      const metas = {};
      (metasData || []).forEach((row) => {
        const email = (row?.vendedor_email || "").trim().toLowerCase();
        if (email) metas[email] = Math.max(0, Number(row?.meta_neto || 0));
      });

      const detalle = {};
      if (!detalleError) {
        (detalleData || []).forEach((row) => {
          const email = (row?.vendedor_email || "").trim().toLowerCase();
          const canalBase = normalizeCanal(row?.canal_base);
          if (!email || !canalBase) return;
          detalle[email] = detalle[email] || {};
          detalle[email][canalBase] = Math.max(0, Number(row?.meta_neto || 0));
        });
      } else if (!isMissingMetaDetalleTableError(detalleError)) {
        console.error("Error cargando detalle de metas por canal:", detalleError);
      }

      setCanalPorVendedorMap(canales);
      setCanalPorVendedorDraftMap(canales);
      setMetasVendedorMap(metas);
      setMetasDetalleVendedorMap(detalle);
    }

    cargarAsignacionesYMetas();
    return () => {
      mounted = false;
    };
  }, [cargando, esAdmin, metaPeriodo]);

  const opcionesVendedores = useMemo(() => {
    const correos = new Set([
      ...Object.keys(usuariosMap),
      ...licitaciones.map((l) => (l?.creado_por || "").trim().toLowerCase()).filter(Boolean),
      ...Object.keys(canalPorVendedorMap),
      ...Object.keys(canalPorVendedorDraftMap),
      ...Object.keys(metasVendedorMap),
      ...Object.keys(metasDetalleVendedorMap),
    ]);
    return Array.from(correos)
      .filter(Boolean)
      .map((email) => ({ value: email, label: usuariosMap[email] || email }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [usuariosMap, licitaciones, canalPorVendedorMap, canalPorVendedorDraftMap, metasVendedorMap, metasDetalleVendedorMap]);

  const rowsVendedor = useMemo(() => {
    const finPeriodo = monthEndISO(metaPeriodo);
    const licById = new Map();

    licitaciones.forEach((l) => {
      const id = Number(l?.id || 0);
      const email = (l?.creado_por || "").trim().toLowerCase();
      if (id && email) licById.set(id, email);
    });

    // Fecha de adjudicación por licitación = fecha de creación de la primera OC
    const primeraOcPorLic = new Map();
    (ocs || []).forEach((doc) => {
      const licId = Number(doc?.licitacion_id || 0);
      if (!licId) return;
      const fechaDoc = toDateISO(doc?.fecha_oc) || toDateISO(doc?.created_at);
      if (!fechaDoc) return;
      const actual = primeraOcPorLic.get(licId);
      if (!actual || fechaDoc < actual) primeraOcPorLic.set(licId, fechaDoc);
    });

    const avanceNetoPorVendedor = {};
    (ocs || []).forEach((doc) => {
      const licId = Number(doc?.licitacion_id || 0);
      const email = licById.get(licId);
      if (!email) return;
      if (filtroVendedor && filtroVendedor !== email) return;
      const fechaAdj = primeraOcPorLic.get(licId);
      if (!fechaAdj || fechaAdj < metaPeriodo || fechaAdj > finPeriodo) return;
      avanceNetoPorVendedor[email] = Number(avanceNetoPorVendedor[email] || 0) + Number(doc?.monto || 0);
    });

    return opcionesVendedores
      .filter((v) => !filtroVendedor || v.value === filtroVendedor)
      .map((v) => {
        const canal = normalizeCanal(canalPorVendedorDraftMap[v.value] || canalPorVendedorMap[v.value] || "");
        const metaNeto = Math.max(0, Number(metasVendedorMap[v.value] || 0));
        const avanceNeto = Number(avanceNetoPorVendedor[v.value] || 0);
        const metaDetalle = metasDetalleVendedorMap[v.value] || {};
        return { email: v.value, nombre: v.label, canal, metaNeto, avanceNeto, metaDetalle };
      })
      .sort((a, b) => a.nombre.localeCompare(b.nombre));
  }, [metaPeriodo, licitaciones, ocs, opcionesVendedores, filtroVendedor, canalPorVendedorDraftMap, canalPorVendedorMap, metasVendedorMap, metasDetalleVendedorMap]);

  const consolidadoCanales = useMemo(() => {
    const map = new Map(
      CANALES_RESUMEN.map((c) => [c.value, { canal: c.value, metaNeto: 0, avanceNeto: 0, personas: 0 }])
    );

    rowsVendedor.forEach((r) => {
      const detalle = r.metaDetalle || {};
      const detalleEntries = Object.entries(detalle)
        .map(([canal, meta]) => [normalizeCanal(canal), Math.max(0, Number(meta || 0))])
        .filter(([canal, meta]) => Boolean(canal) && meta > 0 && map.has(canal));

      const totalDetalleMeta = detalleEntries.reduce((acc, [, meta]) => acc + meta, 0);
      if (totalDetalleMeta > 0) {
        detalleEntries.forEach(([canal, meta]) => {
          const row = map.get(canal);
          row.metaNeto += meta;
          row.avanceNeto += Number(r.avanceNeto || 0) * (meta / totalDetalleMeta);
          row.personas += 1;
        });
        return;
      }

      if (r.canal && map.has(r.canal)) {
        const row = map.get(r.canal);
        row.metaNeto += Number(r.metaNeto || 0);
        row.avanceNeto += Number(r.avanceNeto || 0);
        row.personas += 1;
        return;
      }

      const splitBases = splitBaseCanales(r.canal);
      if (splitBases.length > 0) {
        const metaParte = Number(r.metaNeto || 0) / splitBases.length;
        const avanceParte = Number(r.avanceNeto || 0) / splitBases.length;
        splitBases.forEach((base) => {
          if (!map.has(base)) return;
          const row = map.get(base);
          row.metaNeto += metaParte;
          row.avanceNeto += avanceParte;
          row.personas += 1;
        });
      }
    });

    return Array.from(map.values()).map((r) => ({
      ...r,
      brechaNeto: Math.max(0, r.metaNeto - r.avanceNeto),
      pctCumplimiento: r.metaNeto > 0 ? (r.avanceNeto / r.metaNeto) * 100 : 0,
    }));
  }, [rowsVendedor]);

  const resumen = useMemo(() => {
    const metaNetaTotal = consolidadoCanales.reduce((acc, c) => acc + Number(c.metaNeto || 0), 0);
    const avanceNetoTotal = consolidadoCanales.reduce((acc, c) => acc + Number(c.avanceNeto || 0), 0);
    return {
      metaNetaTotal,
      avanceNetoTotal,
      brechaNetaTotal: Math.max(0, metaNetaTotal - avanceNetoTotal),
      pctCumplimientoTotal: metaNetaTotal > 0 ? (avanceNetoTotal / metaNetaTotal) * 100 : 0,
    };
  }, [consolidadoCanales]);

  async function guardar() {
    if (!esAdmin || guardando) return;
    setGuardando(true);
    setMetasErrorMsg("");
    setMetasInfoMsg("");
    try {
      const entries = Object.entries(canalPorVendedorDraftMap).map(([email, canal]) => ({
        email: String(email || "").trim().toLowerCase(),
        canal: normalizeCanal(canal),
      }));

      const upserts = entries
        .filter((x) => x.email && x.canal)
        .map((x) => ({ vendedor_email: x.email, periodo: metaPeriodo, canal: x.canal, meta_neto: 0 }));

      const deletions = entries.filter((x) => x.email && !x.canal).map((x) => x.email);

      if (deletions.length > 0) {
        await api.delete(`/metas/canal?periodo=${metaPeriodo}`);
      }

      if (upserts.length > 0) {
        await api.post("/metas/canal", { rows: upserts });
      }

      const finalMap = {};
      upserts.forEach((row) => {
        finalMap[row.vendedor_email] = row.canal;
      });
      setCanalPorVendedorMap(finalMap);
      setCanalPorVendedorDraftMap(finalMap);
      setMetasInfoMsg("Asignaciones por canal guardadas correctamente.");
    } catch (e) {
      console.error("Error guardando metas por canal:", e);
      if (isMissingAsignacionTableError(e)) {
        setMetasErrorMsg("Falta la tabla vendedor_metas_canal_mensuales. Ejecuta la migracion.");
      } else {
        setMetasErrorMsg("No se pudo guardar la configuracion de canales.");
      }
    } finally {
      setGuardando(false);
    }
  }

  if (!cargando && !esAdmin) {
    return (
      <div className="page">
        <div style={{ padding: "12px 16px", borderRadius: "var(--radius)", border: "1px solid #fecaca", background: "#fef2f2", color: "#b91c1c", fontSize: "13px" }}>
          Acceso restringido: esta sección es solo para administradores.
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      {/* PAGE HEADER */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Meta por Canal y Meta Global</h1>
          <p style={{ fontSize: "13px", color: "var(--text-muted)", margin: 0 }}>
            Meta por canal calculada automáticamente desde la meta de cada vendedor asignado.
          </p>
          <p style={{ fontSize: "12px", color: "var(--primary-dark)", margin: "4px 0 0" }}>
            Periodo: {monthTitle(metaPeriodo)} ({metaPeriodo} a {monthEndISO(metaPeriodo)})
          </p>
        </div>
        <div className="page-actions">
          <button
            type="button"
            onClick={guardar}
            disabled={guardando}
            className="btn btn-primary"
            style={{ opacity: guardando ? 0.6 : 1, cursor: guardando ? "not-allowed" : "pointer" }}
          >
            {guardando ? "Guardando…" : "Guardar configuracion"}
          </button>
        </div>
      </div>

      {errorMsg     ? <div style={{ marginBottom: "16px", padding: "12px 16px", borderRadius: "var(--radius)", border: "1px solid #fecaca",  background: "#fef2f2", color: "#b91c1c",  fontSize: "13px" }}>{errorMsg}</div>     : null}
      {metasErrorMsg ? <div style={{ marginBottom: "16px", padding: "12px 16px", borderRadius: "var(--radius)", border: "1px solid #fde68a",  background: "#fffbeb", color: "#92400e",  fontSize: "13px" }}>{metasErrorMsg}</div> : null}
      {metasInfoMsg  ? <div style={{ marginBottom: "16px", padding: "12px 16px", borderRadius: "var(--radius)", border: "1px solid #bbf7d0",  background: "#f0fdf4", color: "#15803d",  fontSize: "13px" }}>{metasInfoMsg}</div>  : null}

      {loading ? (
        <div className="surface" style={{ padding: "40px 24px", color: "var(--text-muted)" }}>Cargando metas por canal…</div>
      ) : (
        <>
          {/* TABLA RESUMEN POR CANAL */}
          <div className="surface" style={{ marginBottom: "20px" }}>
            <div className="surface-header">
              <h3 className="surface-title">Resumen por Canal</h3>
            </div>
            <div className="table-wrap" style={{ boxShadow: "none", border: "none", borderRadius: 0 }}>
              <div className="table-scroll">
                <table className="data-table" style={{ minWidth: "700px" }}>
                  <thead>
                    <tr>
                      <th>Canal</th>
                      <th style={{ textAlign: "right" }}>Meta Neta Canal</th>
                      <th style={{ textAlign: "right" }}>Avance OC Neto</th>
                      <th style={{ textAlign: "right" }}>Cumplimiento</th>
                      <th style={{ textAlign: "right" }}>Brecha</th>
                    </tr>
                  </thead>
                  <tbody>
                    {consolidadoCanales.map((c) => (
                      <tr key={c.canal}>
                        <td>
                          <div style={{ fontWeight: 600, fontSize: "13px", color: "var(--text)" }}>{canalLabel(c.canal)}</div>
                          <div style={{ fontSize: "11px", color: "var(--text-muted)" }}>{c.personas} vendedor(es)</div>
                        </td>
                        <td style={{ textAlign: "right", fontWeight: 600 }}>{fmtCLP(c.metaNeto)}</td>
                        <td style={{ textAlign: "right", fontWeight: 600 }}>{fmtCLP(c.avanceNeto)}</td>
                        <td style={{ textAlign: "right" }}>
                          <span style={{
                            display: "inline-flex", alignItems: "center", padding: "2px 10px",
                            borderRadius: "999px", fontSize: "12px", fontWeight: 600, border: "1px solid",
                            color: colorCumplimiento(c.pctCumplimiento),
                            borderColor: `${colorCumplimiento(c.pctCumplimiento)}40`,
                            background: `${colorCumplimiento(c.pctCumplimiento)}12`,
                          }}>
                            {fmtPct(c.pctCumplimiento)}
                          </span>
                        </td>
                        <td style={{ textAlign: "right", color: "var(--text-muted)" }}>{fmtCLP(c.brechaNeto)}</td>
                      </tr>
                    ))}
                    <tr style={{ background: "var(--bg)", fontWeight: 700 }}>
                      <td style={{ fontWeight: 700 }}>Meta Global</td>
                      <td style={{ textAlign: "right", fontWeight: 700 }}>{fmtCLP(resumen.metaNetaTotal)}</td>
                      <td style={{ textAlign: "right", fontWeight: 700 }}>{fmtCLP(resumen.avanceNetoTotal)}</td>
                      <td style={{ textAlign: "right" }}>
                        <span style={{
                          display: "inline-flex", alignItems: "center", padding: "2px 10px",
                          borderRadius: "999px", fontSize: "12px", fontWeight: 600, border: "1px solid",
                          color: colorCumplimiento(resumen.pctCumplimientoTotal),
                          borderColor: `${colorCumplimiento(resumen.pctCumplimientoTotal)}40`,
                          background: `${colorCumplimiento(resumen.pctCumplimientoTotal)}12`,
                        }}>
                          {fmtPct(resumen.pctCumplimientoTotal)}
                        </span>
                      </td>
                      <td style={{ textAlign: "right", fontWeight: 700 }}>{fmtCLP(resumen.brechaNetaTotal)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* TABLA ASIGNACIÓN DE VENDEDORES */}
          <div className="surface">
            <div className="surface-header" style={{ flexWrap: "wrap", gap: "16px" }}>
              <h3 className="surface-title">Asignación de Vendedores a Canal</h3>
              <div style={{ display: "flex", alignItems: "flex-end", gap: "12px", flexWrap: "wrap" }}>
                <div className="field" style={{ margin: 0 }}>
                  <label className="field-label">Mes de evaluación</label>
                  <MonthCalendarPicker value={metaPeriodo} onChange={setMetaPeriodo} />
                </div>
                <div className="field" style={{ margin: 0 }}>
                  <label className="field-label">Vendedor</label>
                  <select
                    className="input"
                    value={filtroVendedor}
                    onChange={(e) => setFiltroVendedor(e.target.value)}
                    style={{ minWidth: "160px" }}
                  >
                    <option value="">Todos</option>
                    {opcionesVendedores.map((op) => (
                      <option key={op.value} value={op.value}>{op.label}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
            <div className="table-wrap" style={{ boxShadow: "none", border: "none", borderRadius: 0 }}>
              <div className="table-scroll">
                <table className="data-table" style={{ minWidth: "900px" }}>
                  <thead>
                    <tr>
                      <th>Vendedor</th>
                      <th>Canal</th>
                      <th style={{ textAlign: "right" }}>Meta</th>
                      <th style={{ textAlign: "right" }}>Avance</th>
                      <th style={{ textAlign: "right" }}>Cumplimiento</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rowsVendedor.map((r) => {
                      const pct = r.metaNeto > 0 ? (r.avanceNeto / r.metaNeto) * 100 : 0;
                      return (
                        <tr key={r.email}>
                          <td>
                            <div style={{ fontWeight: 600, fontSize: "13px", color: "var(--text)" }}>{r.nombre}</div>
                            <div style={{ fontSize: "11px", color: "var(--text-muted)" }}>{r.email}</div>
                          </td>
                          <td>
                            <select
                              className="input"
                              value={r.canal}
                              onChange={(e) => {
                                const canal = normalizeCanal(e.target.value);
                                setCanalPorVendedorDraftMap((prev) => ({ ...prev, [r.email]: canal }));
                              }}
                              style={{ minWidth: "220px" }}
                            >
                              <option value="">Sin canal</option>
                              {CANALES_ASIGNACION.map((c) => (
                                <option key={c.value} value={c.value}>{c.label}</option>
                              ))}
                            </select>
                          </td>
                          <td style={{ textAlign: "right", fontWeight: 600 }}>{fmtCLP(r.metaNeto)}</td>
                          <td style={{ textAlign: "right", fontWeight: 600 }}>{fmtCLP(r.avanceNeto)}</td>
                          <td style={{ textAlign: "right" }}>
                            <span style={{
                              display: "inline-flex", alignItems: "center", padding: "2px 10px",
                              borderRadius: "999px", fontSize: "12px", fontWeight: 600, border: "1px solid",
                              color: colorCumplimiento(pct),
                              borderColor: `${colorCumplimiento(pct)}40`,
                              background: `${colorCumplimiento(pct)}12`,
                            }}>
                              {fmtPct(pct)}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                    {rowsVendedor.length === 0 && (
                      <tr>
                        <td colSpan={5} style={{ textAlign: "center", padding: "40px 0", color: "var(--text-muted)" }}>
                          No hay vendedores para el periodo o filtro seleccionado.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", padding: "16px 24px", borderTop: "1px solid var(--border)" }}>
              <button
                type="button"
                onClick={guardar}
                disabled={guardando}
                className="btn btn-primary"
                style={{ opacity: guardando ? 0.6 : 1, cursor: guardando ? "not-allowed" : "pointer" }}
              >
                {guardando ? "Guardando…" : "Guardar configuracion"}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
