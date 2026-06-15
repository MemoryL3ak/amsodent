import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { Link } from "react-router-dom";
import useAuth from "../hooks/useAuth";
import Toast from "../components/Toast";
import DateFilter from "../components/DateFilter";
import { Eye, AlertTriangle, Save } from "lucide-react";

function fmtCLP(value) {
  return `$${Number(value || 0).toLocaleString("es-CL")}`;
}

function fmtDateCL(d) {
  if (!d) return "—";
  return new Date(`${String(d).slice(0, 10)}T00:00:00`).toLocaleDateString("es-CL");
}

// Días restantes hasta una fecha (negativo = ya vencida).
function diasHasta(fechaIso) {
  if (!fechaIso) return null;
  const f = new Date(`${String(fechaIso).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(f.getTime())) return null;
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  return Math.round((f.getTime() - hoy.getTime()) / (1000 * 60 * 60 * 24));
}

// Semáforo del plazo de factoring por días restantes.
function semaforoPlazo(dias) {
  if (dias == null) return { color: "#6b7280", bg: "#f3f4f6", label: "Sin plazo" };
  if (dias < 0) return { color: "#dc2626", bg: "#fee2e2", label: `Vencido (${Math.abs(dias)}d)` };
  if (dias <= 5) return { color: "#b45309", bg: "#fef3c7", label: `Por vencer (${dias}d)` };
  if (dias <= 15) return { color: "#0d9488", bg: "#ccfbf1", label: `${dias}d restantes` };
  return { color: "#1d4ed8", bg: "#dbeafe", label: `${dias}d restantes` };
}

function esClienteParticular(lic) {
  return (lic?.tipo_cliente || "").toString().toLowerCase().includes("particular");
}

export default function Factoring() {
  const { rol, cargando } = useAuth();
  const rolNorm = (rol ?? "").toString().trim().toLowerCase();
  const esAdmin = rolNorm === "admin" || rolNorm === "administrador";
  const puedeVer = esAdmin || rolNorm === "jefe_ventas_especial";

  const [licMap, setLicMap] = useState({});
  const [facturas, setFacturas] = useState([]);
  const [draftMap, setDraftMap] = useState({}); // docId -> { empresa, comision, vencimiento }
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);
  const [savingId, setSavingId] = useState(null);

  // Filtros
  const [filtroEmpresa, setFiltroEmpresa] = useState("");
  const [filtroEntidad, setFiltroEntidad] = useState("");
  const [filtroPlazo, setFiltroPlazo] = useState("todas");

  useEffect(() => {
    if (cargando || !puedeVer) {
      if (!cargando) setLoading(false);
      return;
    }
    let mounted = true;

    async function load() {
      setLoading(true);
      try {
        const lics = await api.get(
          "/licitaciones/with-fields?fields=id,id_licitacion,nombre_entidad,total_con_iva,comuna,tipo_compra,tipo_cliente,condicion_venta,estado"
        );
        const rows = (lics || []).filter((l) => l.estado === "Adjudicada");
        const mapa = {};
        rows.forEach((l) => { mapa[l.id] = l; });

        const ids = rows.map((l) => l.id);
        let facturasFactoring = [];
        if (ids.length > 0) {
          const docs = await api.post("/licitaciones/documentos/filter", {
            filter: { licitacion_ids: ids, tipo: ["factura", "factura_boleta"] },
            fields: "*",
          });
          // Solo las facturas pagadas por factoring (forma_pago === 'factoring').
          facturasFactoring = (docs || []).filter((d) => (d.forma_pago || "") === "factoring");
        }

        if (!mounted) return;
        setLicMap(mapa);
        setFacturas(facturasFactoring);
        // Sembramos el draft con los valores guardados.
        const draft = {};
        facturasFactoring.forEach((f) => {
          draft[f.id] = {
            empresa: f.factoring_empresa || "",
            comision: f.factoring_comision_pct != null ? String(f.factoring_comision_pct) : "",
            vencimiento: f.factoring_vencimiento ? String(f.factoring_vencimiento).slice(0, 10) : "",
          };
        });
        setDraftMap(draft);
      } catch (e) {
        console.error(e);
        if (mounted) setToast({ type: "error", message: "Error cargando facturas de factoring." });
      } finally {
        if (mounted) setLoading(false);
      }
    }

    load();
    return () => { mounted = false; };
  }, [cargando, puedeVer]);

  function montoFactura(f) {
    const lic = licMap[f.licitacion_id] || {};
    return Number(f.monto) || Number(lic.total_con_iva) || 0;
  }

  function setDraft(docId, campo, valor) {
    setDraftMap((prev) => ({ ...prev, [docId]: { ...(prev[docId] || {}), [campo]: valor } }));
  }

  async function guardarFila(f) {
    const d = draftMap[f.id] || {};
    const comisionNum = d.comision === "" || d.comision == null ? null : Number(d.comision);
    if (comisionNum != null && (Number.isNaN(comisionNum) || comisionNum < 0 || comisionNum > 100)) {
      setToast({ type: "error", message: "La comisión debe ser un porcentaje entre 0 y 100." });
      return;
    }
    setSavingId(f.id);
    try {
      await api.put(`/licitaciones/documentos/${f.id}`, {
        factoring_empresa: d.empresa?.trim() || null,
        factoring_comision_pct: comisionNum,
        factoring_vencimiento: d.vencimiento || null,
      });
      setFacturas((prev) =>
        prev.map((x) =>
          x.id === f.id
            ? {
                ...x,
                factoring_empresa: d.empresa?.trim() || null,
                factoring_comision_pct: comisionNum,
                factoring_vencimiento: d.vencimiento || null,
              }
            : x
        )
      );
      setToast({ type: "success", message: "Datos de factoring guardados." });
    } catch (e) {
      console.error(e);
      setToast({ type: "error", message: "No se pudieron guardar los datos." });
    } finally {
      setSavingId(null);
    }
  }

  async function abrirDocumento(doc) {
    if (!doc?.bucket || !doc?.storage_path) return;
    try {
      const data = await api.get(
        `/licitaciones/storage/signed-url?bucket=${encodeURIComponent(doc.bucket)}&path=${encodeURIComponent(doc.storage_path)}`
      );
      if (data?.signedUrl) window.open(data.signedUrl, "_blank", "noopener,noreferrer");
      else setToast({ type: "error", message: "No se pudo abrir el documento." });
    } catch {
      setToast({ type: "error", message: "No se pudo abrir el documento." });
    }
  }

  const empresasUnicas = useMemo(() => {
    const set = new Set();
    facturas.forEach((f) => { const e = (f.factoring_empresa || "").trim(); if (e) set.add(e); });
    return [...set].sort();
  }, [facturas]);

  const facturasFiltradas = useMemo(() => {
    return facturas.filter((f) => {
      const lic = licMap[f.licitacion_id] || {};
      if (filtroEntidad && !(lic.nombre_entidad || "").toLowerCase().includes(filtroEntidad.toLowerCase())) return false;
      if (filtroEmpresa && (f.factoring_empresa || "") !== filtroEmpresa) return false;
      if (filtroPlazo !== "todas") {
        const dias = diasHasta(f.factoring_vencimiento);
        if (filtroPlazo === "sin_plazo" && dias != null) return false;
        if (filtroPlazo === "vencidas" && !(dias != null && dias < 0)) return false;
        if (filtroPlazo === "por_vencer" && !(dias != null && dias >= 0 && dias <= 5)) return false;
        if (filtroPlazo === "vigentes" && !(dias != null && dias > 5)) return false;
      }
      return true;
    });
  }, [facturas, licMap, filtroEntidad, filtroEmpresa, filtroPlazo]);

  const stats = useMemo(() => {
    let count = 0, monto = 0, comision = 0, vencidas = 0;
    facturas.forEach((f) => {
      count++;
      const m = montoFactura(f);
      monto += m;
      const pct = Number(f.factoring_comision_pct);
      if (Number.isFinite(pct)) comision += Math.round((m * pct) / 100);
      const dias = diasHasta(f.factoring_vencimiento);
      if (dias != null && dias < 0) vencidas++;
    });
    return { count, monto, comision, vencidas };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [facturas, licMap]);

  if (!cargando && !puedeVer) {
    return (
      <div className="page">
        <div className="surface">
          <div className="surface-body" style={{ color: "var(--danger)" }}>
            Acceso restringido: el módulo de Factoring es para administración y jefatura de ventas especial.
          </div>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="page">
        <div className="page-header"><h1 className="page-title">Factoring</h1></div>
        <p style={{ color: "var(--text-muted)", fontSize: 13, marginTop: 16 }}>Cargando…</p>
      </div>
    );
  }

  return (
    <div className="page">
      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}

      <div className="page-header">
        <div>
          <h1 className="page-title">Factoring</h1>
          <p className="page-subtitle">
            {facturasFiltradas.length} factura{facturasFiltradas.length !== 1 ? "s" : ""} pagada
            {facturasFiltradas.length !== 1 ? "s" : ""} por factoring
          </p>
        </div>
      </div>

      {/* Stats */}
      <div className="stats-row">
        <div className="stat-card">
          <div className="stat-label">Facturas</div>
          <div className="stat-value" style={{ color: "#7c3aed" }}>{stats.count}</div>
          <div className="stat-sub">pagadas por factoring</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Monto facturas</div>
          <div className="stat-money" style={{ color: "#7c3aed" }}>{fmtCLP(stats.monto)}</div>
          <div className="stat-sub">total · con IVA</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Comisión total</div>
          <div className="stat-money" style={{ color: "#b45309" }}>{fmtCLP(stats.comision)}</div>
          <div className="stat-sub">según % registrado</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Plazos vencidos</div>
          <div className="stat-value" style={{ color: "var(--danger)" }}>{stats.vencidas}</div>
          <div className="stat-sub">fecha de pago factoring pasada</div>
        </div>
      </div>

      {/* Filtros */}
      <div className="filter-bar">
        <div className="filter-field">
          <label className="filter-label">Entidad</label>
          <input
            type="text"
            className="input"
            placeholder="Buscar entidad..."
            value={filtroEntidad}
            onChange={(e) => setFiltroEntidad(e.target.value)}
          />
        </div>
        <div className="filter-field">
          <label className="filter-label">Empresa de factoring</label>
          <select className="input" value={filtroEmpresa} onChange={(e) => setFiltroEmpresa(e.target.value)}>
            <option value="">Todas</option>
            {empresasUnicas.map((e) => (
              <option key={e} value={e}>{e}</option>
            ))}
          </select>
        </div>
        <div className="filter-field">
          <label className="filter-label">Plazo</label>
          <select className="input" value={filtroPlazo} onChange={(e) => setFiltroPlazo(e.target.value)}>
            <option value="todas">Todos</option>
            <option value="vigentes">Vigentes</option>
            <option value="por_vencer">Por vencer (≤5d)</option>
            <option value="vencidas">Vencidos</option>
            <option value="sin_plazo">Sin plazo</option>
          </select>
        </div>
      </div>

      {/* Tabla */}
      <div
        className="table-wrap"
        style={{
          boxShadow: "0 1px 3px rgba(15, 23, 42, 0.04), 0 0 0 1px rgba(15, 23, 42, 0.04)",
          borderRadius: 10,
          overflow: "hidden",
        }}
      >
        <div className="table-scroll" style={{ maxHeight: "calc(100vh - 360px)" }}>
          <table className="data-table" style={{ minWidth: "1080px" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left" }}>Cotización / Cliente</th>
                <th style={{ textAlign: "left" }}>Factura</th>
                <th style={{ textAlign: "right" }}>Monto</th>
                <th style={{ textAlign: "left" }}>Empresa factoring</th>
                <th style={{ textAlign: "right" }}>Comisión %</th>
                <th style={{ textAlign: "right" }}>Comisión $</th>
                <th style={{ textAlign: "left" }}>Plazo (vencimiento)</th>
                <th style={{ textAlign: "right" }}>Acción</th>
              </tr>
            </thead>
            <tbody>
              {facturasFiltradas.length === 0 ? (
                <tr>
                  <td colSpan="8" style={{ textAlign: "center", padding: "60px 0", color: "var(--text-muted)" }}>
                    No hay facturas pagadas por factoring. Marca una factura con forma de pago «Factoring» en Seguimiento de Pagos.
                  </td>
                </tr>
              ) : (
                facturasFiltradas.map((f) => {
                  const lic = licMap[f.licitacion_id] || {};
                  const particular = esClienteParticular(lic);
                  const d = draftMap[f.id] || {};
                  const monto = montoFactura(f);
                  const pctNum = Number(d.comision);
                  const comisionMonto = Number.isFinite(pctNum) && d.comision !== ""
                    ? Math.round((monto * pctNum) / 100)
                    : 0;
                  const dias = diasHasta(d.vencimiento);
                  const sem = semaforoPlazo(dias);
                  return (
                    <tr key={f.id}>
                      <td style={{ verticalAlign: "middle" }}>
                        <Link to={`/detalle/${lic.id}`} className="table-link" style={{ fontWeight: 600 }}>
                          #{lic.id}
                        </Link>
                        {lic.id_licitacion && (
                          <span style={{ color: "var(--text-muted)", fontSize: "11px", marginLeft: 6 }}>{lic.id_licitacion}</span>
                        )}
                        <div style={{ fontWeight: 500, fontSize: "13px", color: "#1f2937", marginTop: 2 }}>
                          {lic.nombre_entidad || "—"}
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 3 }}>
                          <span style={{
                            display: "inline-block", padding: "1px 8px", borderRadius: "999px",
                            fontSize: "10px", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".4px",
                            color: particular ? "#6d28d9" : "#0369a1",
                            background: particular ? "#ede9fe" : "#e0f2fe",
                          }}>
                            {particular ? "Particular" : "Pública"}
                          </span>
                          {lic.comuna && <span style={{ color: "var(--text-muted)", fontSize: "11px" }}>{lic.comuna}</span>}
                        </div>
                      </td>
                      <td style={{ verticalAlign: "middle" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <span style={{ fontWeight: 500, color: "#1f2937" }}>{f.numero || "S/N"}</span>
                          <button
                            type="button"
                            onClick={() => abrirDocumento(f)}
                            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--primary)", padding: 0 }}
                            title="Ver PDF"
                          >
                            <Eye size={13} />
                          </button>
                        </div>
                      </td>
                      <td style={{ verticalAlign: "middle", textAlign: "right", fontWeight: 600, whiteSpace: "nowrap" }}>
                        {fmtCLP(monto)}
                      </td>
                      <td style={{ verticalAlign: "middle" }}>
                        <input
                          type="text"
                          className="input"
                          placeholder="Empresa…"
                          value={d.empresa || ""}
                          onChange={(e) => setDraft(f.id, "empresa", e.target.value)}
                          style={{ width: "100%", minWidth: 140 }}
                        />
                      </td>
                      <td style={{ verticalAlign: "middle", textAlign: "right" }}>
                        <input
                          type="text"
                          inputMode="decimal"
                          className="input"
                          placeholder="0"
                          value={d.comision ?? ""}
                          onChange={(e) => setDraft(f.id, "comision", e.target.value.replace(/[^\d.,]/g, "").replace(",", "."))}
                          style={{ width: 80, textAlign: "right" }}
                        />
                      </td>
                      <td style={{ verticalAlign: "middle", textAlign: "right", color: "#b45309", fontWeight: 600, whiteSpace: "nowrap" }}>
                        {comisionMonto > 0 ? fmtCLP(comisionMonto) : "—"}
                      </td>
                      <td style={{ verticalAlign: "middle" }}>
                        <div style={{ minWidth: 150 }}>
                          <DateFilter
                            value={d.vencimiento || ""}
                            onChange={(v) => setDraft(f.id, "vencimiento", v)}
                            placeholder="Vencimiento"
                          />
                          <div style={{ marginTop: 4 }}>
                            <span style={{
                              display: "inline-flex", alignItems: "center", gap: 4,
                              padding: "2px 8px", borderRadius: "999px", fontSize: "11px", fontWeight: 600,
                              color: sem.color, backgroundColor: sem.bg,
                            }}>
                              {dias != null && dias <= 5 && <AlertTriangle size={11} />}
                              {sem.label}
                            </span>
                            {d.vencimiento && (
                              <span style={{ marginLeft: 6, fontSize: 11, color: "var(--text-muted)" }}>
                                {fmtDateCL(d.vencimiento)}
                              </span>
                            )}
                          </div>
                        </div>
                      </td>
                      <td style={{ verticalAlign: "middle", textAlign: "right" }}>
                        <button
                          type="button"
                          onClick={() => guardarFila(f)}
                          disabled={savingId === f.id}
                          className="btn btn-primary btn-sm"
                          style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
                        >
                          <Save size={13} /> {savingId === f.id ? "…" : "Guardar"}
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
