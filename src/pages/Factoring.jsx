import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { Link } from "react-router-dom";
import useAuth from "../hooks/useAuth";
import Toast from "../components/Toast";
import DateFilter from "../components/DateFilter";
import { Eye, AlertTriangle, Save, Lock, Bell } from "lucide-react";
import BotonLimpiarFiltros from "../components/BotonLimpiarFiltros";
import DropdownSelect from "../components/ui/DropdownSelect";

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

/* Semáforo del plazo de factoring por días restantes:
     verde    → faltan más de DIAS_AMARILLO días
     amarillo → faltan DIAS_AMARILLO días o menos (incluye el día del vencimiento)
     rojo     → la fecha ya pasó
   MISMA regla que los avisos por campana y correo del backend
   (recordatorios.service.ts → FACTORING_DIAS_AMARILLO): el primer aviso sale
   cuando la factura pasa a amarillo. Si cambia aquí, cambia allá. */
const DIAS_AMARILLO = 7;

const SEMAFORO = {
  verde: { color: "#15803d", bg: "#dcfce7", luz: "#16a34a" },
  amarillo: { color: "#a16207", bg: "#fef9c3", luz: "#eab308" },
  rojo: { color: "#b91c1c", bg: "#fee2e2", luz: "#dc2626" },
  sin_plazo: { color: "#6b7280", bg: "#f3f4f6", luz: "#d1d5db" },
};

function estadoPlazo(dias) {
  if (dias == null) return "sin_plazo";
  if (dias < 0) return "rojo";
  if (dias <= DIAS_AMARILLO) return "amarillo";
  return "verde";
}

function semaforoPlazo(dias) {
  const estado = estadoPlazo(dias);
  let label = "Sin plazo";
  if (estado === "rojo") label = `Vencido (${Math.abs(dias)}d)`;
  else if (estado === "amarillo") label = dias === 0 ? "Vence hoy" : `Por vencer (${dias}d)`;
  else if (estado === "verde") label = `En plazo (${dias}d)`;
  return { estado, label, ...SEMAFORO[estado] };
}

const BOTONES_SEMAFORO = [
  { estado: "verde", titulo: "En plazo", regla: `más de ${DIAS_AMARILLO} días` },
  { estado: "amarillo", titulo: "Por vencer", regla: `${DIAS_AMARILLO} días o menos` },
  { estado: "rojo", titulo: "Vencidos", regla: "fecha pasada" },
  { estado: "sin_plazo", titulo: "Sin plazo", regla: "sin fecha" },
];

function Luz({ estado, size = 9 }) {
  return (
    <span
      aria-hidden
      style={{
        display: "inline-block", width: size, height: size, borderRadius: "50%",
        background: SEMAFORO[estado].luz, flexShrink: 0,
      }}
    />
  );
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

  /* Monto de la factura CON IVA, que es lo que se cede al factoring y sobre lo
     que se calcula el margen. Los documentos se guardan en NETO, así que se
     lleva a bruto (×1,19), igual que en Seguimiento de Pagos. Antes se mostraba
     el neto bajo el rótulo "con IVA" y el margen en pesos salía 16 % más bajo. */
  function montoFactura(f) {
    const lic = licMap[f.licitacion_id] || {};
    const neto = Number(f.monto) || 0;
    return neto > 0 ? Math.round(neto * 1.19) : Number(lic.total_con_iva) || 0;
  }

  /* El margen y el plazo llegan desde Seguimiento de Pagos, donde se piden al
     registrar el pago por factoring; la empresa es opcional allá. Por eso la
     fila se da por completa solo cuando tiene los tres datos: mientras falte
     alguno se puede terminar de llenar aquí. */
  function filaCompleta(f) {
    return Boolean(
      (f.factoring_empresa || "").toString().trim() &&
      f.factoring_vencimiento &&
      f.factoring_comision_pct != null
    );
  }
  // Una vez completa, la edición queda bloqueada salvo para admin.
  function filaBloqueada(f) {
    return filaCompleta(f) && !esAdmin;
  }

  function setDraft(docId, campo, valor) {
    setDraftMap((prev) => ({ ...prev, [docId]: { ...(prev[docId] || {}), [campo]: valor } }));
  }

  async function guardarFila(f) {
    const d = draftMap[f.id] || {};
    const comisionNum = d.comision === "" || d.comision == null ? null : Number(d.comision);
    if (comisionNum != null && (Number.isNaN(comisionNum) || comisionNum < 0 || comisionNum > 100)) {
      setToast({ type: "error", message: "El margen debe ser un porcentaje entre 0 y 100." });
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

  /* Lo más urgente arriba: primero lo vencido hace más tiempo, al final lo que
     no tiene plazo. Se ordena por la fecha GUARDADA, no por la que se está
     escribiendo, para que la fila no salte mientras se edita. */
  const facturasFiltradas = useMemo(() => {
    return facturas
      .filter((f) => {
        const lic = licMap[f.licitacion_id] || {};
        if (filtroEntidad && !(lic.nombre_entidad || "").toLowerCase().includes(filtroEntidad.toLowerCase())) return false;
        if (filtroEmpresa && (f.factoring_empresa || "") !== filtroEmpresa) return false;
        if (filtroPlazo !== "todas" && estadoPlazo(diasHasta(f.factoring_vencimiento)) !== filtroPlazo) return false;
        return true;
      })
      .sort((a, b) => {
        const da = diasHasta(a.factoring_vencimiento);
        const db = diasHasta(b.factoring_vencimiento);
        if (da == null || db == null) return (da == null) - (db == null);
        return da - db;
      });
  }, [facturas, licMap, filtroEntidad, filtroEmpresa, filtroPlazo]);

  const stats = useMemo(() => {
    let count = 0, monto = 0, comision = 0;
    const plazo = { verde: 0, amarillo: 0, rojo: 0, sin_plazo: 0 };
    facturas.forEach((f) => {
      count++;
      const m = montoFactura(f);
      monto += m;
      const pct = Number(f.factoring_comision_pct);
      if (Number.isFinite(pct)) comision += Math.round((m * pct) / 100);
      plazo[estadoPlazo(diasHasta(f.factoring_vencimiento))]++;
    });
    return { count, monto, comision, plazo };
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


  /* (2026-09-24) Volver a ver todo sin ir borrando filtro por filtro. */
  const hayFiltros = filtroEmpresa !== "" || filtroEntidad !== "" || filtroPlazo !== "todas";
  function limpiarFiltros() {
    setFiltroEmpresa("");
    setFiltroEntidad("");
    setFiltroPlazo("todas");
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
          <div className="stat-value stat-value-money" style={{ color: "#7c3aed" }}>{fmtCLP(stats.monto)}</div>
          <div className="stat-sub">total · con IVA</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Margen total</div>
          <div className="stat-value stat-value-money" style={{ color: "#b45309" }}>{fmtCLP(stats.comision)}</div>
          <div className="stat-sub">según % registrado</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Plazos vencidos</div>
          <div className="stat-value" style={{ color: "var(--danger)" }}>{stats.plazo.rojo}</div>
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
          <DropdownSelect
            value={filtroEmpresa}
            onChange={setFiltroEmpresa}
            options={[{ value: "", label: "Todas" }, ...empresasUnicas.map((e) => ({ value: e, label: e }))]}
            minWidth={180}
            style={{ width: "100%" }}
          />
        </div>
        <div className="filter-field">
          <label className="filter-label">Plazo</label>
          <DropdownSelect
            value={filtroPlazo}
            onChange={setFiltroPlazo}
            options={[
              { value: "todas", label: "Todos" },
              { value: "verde", label: "En plazo (verde)" },
              { value: "amarillo", label: `Por vencer (amarillo, ≤${DIAS_AMARILLO}d)` },
              { value: "rojo", label: "Vencidos (rojo)" },
              { value: "sin_plazo", label: "Sin plazo" },
            ]}
            minWidth={180}
            style={{ width: "100%" }}
          />
        </div>
        <BotonLimpiarFiltros hay={hayFiltros} onLimpiar={limpiarFiltros} />
      </div>

      {/* Semáforo: cuántas facturas hay en cada color. Cada botón filtra la
          tabla (otro clic vuelve a mostrar todo) y hace de leyenda. */}
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px 10px", margin: "0 0 12px" }}>
        {BOTONES_SEMAFORO.map((b) => {
          const activo = filtroPlazo === b.estado;
          const s = SEMAFORO[b.estado];
          return (
            <button
              key={b.estado}
              type="button"
              onClick={() => setFiltroPlazo(activo ? "todas" : b.estado)}
              aria-pressed={activo}
              title={activo ? "Quitar el filtro" : "Ver solo estas facturas"}
              style={{
                display: "inline-flex", alignItems: "center", gap: 7,
                padding: "5px 12px", borderRadius: 999, cursor: "pointer",
                fontSize: 12, fontWeight: 600, color: s.color,
                background: activo ? s.bg : "var(--surface, #fff)",
                border: `1px solid ${activo ? s.luz : "var(--border)"}`,
              }}
            >
              <Luz estado={b.estado} />
              {b.titulo}
              <span style={{ fontVariantNumeric: "tabular-nums" }}>{stats.plazo[b.estado]}</span>
              <span style={{ fontWeight: 400, color: "var(--text-muted)" }}>{b.regla}</span>
            </button>
          );
        })}
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text-muted)" }}>
          <Bell size={12} style={{ flexShrink: 0 }} />
          Avisos por campana y correo: {DIAS_AMARILLO} y 3 días antes, el día del vencimiento, y 1, 7 y 15 días después.
        </span>
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
        <div className="table-scroll" style={{ maxHeight: "calc(100vh - 400px)" }}>
          {/* (2026-10-07) minWidth 1080 → 920 y celdas compactas: en un notebook de
              13" la tabla obligaba a desplazarse de lado. */}
          <table className="data-table tabla-compacta" style={{ minWidth: "920px" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left" }}>Cotización / Cliente</th>
                <th style={{ textAlign: "left" }}>Factura</th>
                <th style={{ textAlign: "right" }}>Monto</th>
                <th style={{ textAlign: "left" }}>Empresa factoring</th>
                <th style={{ textAlign: "right" }} title="Porcentaje que cobra la empresa de factoring sobre el monto de la factura">Margen %</th>
                <th style={{ textAlign: "right" }}>Margen $</th>
                <th style={{ textAlign: "left" }}>Plazo (vencimiento)</th>
                <th style={{ textAlign: "right" }}>Acción</th>
              </tr>
            </thead>
            <tbody>
              {facturasFiltradas.length === 0 ? (
                <tr>
                  <td colSpan="8" style={{ textAlign: "center", padding: "60px 0", color: "var(--text-muted)" }}>
                    No hay facturas pagadas por factoring. Llegan aquí al registrar un pago con forma «Factoring» en Seguimiento de Pagos, con su margen y su plazo.
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
                  const bloqueada = filaBloqueada(f);
                  return (
                    <tr key={f.id}>
                      {/* Franja del color del semáforo al borde de la fila */}
                      <td style={{ verticalAlign: "middle", boxShadow: `inset 4px 0 0 ${sem.luz}` }}>
                        <Link to={`/detalle/${lic.id}`} className="table-link" style={{ fontWeight: 600 }}>
                          #{lic.id}
                        </Link>
                        {lic.id_licitacion && (
                          <span style={{ color: "var(--text-muted)", fontSize: "11px", marginLeft: 6 }}>{lic.id_licitacion}</span>
                        )}
                        {/* El nombre largo se parte en líneas: en una sola empujaba
                            la columna del plazo (el semáforo) fuera de la pantalla. */}
                        <div style={{ fontWeight: 500, fontSize: "13px", color: "#1f2937", marginTop: 2, whiteSpace: "normal", maxWidth: 260 }}>
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
                        {bloqueada ? (
                          <span style={{ fontWeight: 500, color: "#1f2937" }}>{d.empresa || "—"}</span>
                        ) : (
                          <input
                            type="text"
                            className="input"
                            placeholder="Empresa…"
                            value={d.empresa || ""}
                            onChange={(e) => setDraft(f.id, "empresa", e.target.value)}
                            style={{ width: "100%", minWidth: 140 }}
                          />
                        )}
                      </td>
                      <td style={{ verticalAlign: "middle", textAlign: "right" }}>
                        {bloqueada ? (
                          <span style={{ fontWeight: 500, color: "#1f2937" }}>{d.comision !== "" && d.comision != null ? `${d.comision}%` : "—"}</span>
                        ) : (
                          <input
                            type="text"
                            inputMode="decimal"
                            className="input"
                            placeholder="0"
                            value={d.comision ?? ""}
                            onChange={(e) => setDraft(f.id, "comision", e.target.value.replace(/[^\d.,]/g, "").replace(",", "."))}
                            style={{ width: 80, textAlign: "right" }}
                          />
                        )}
                      </td>
                      <td style={{ verticalAlign: "middle", textAlign: "right", color: "#b45309", fontWeight: 600, whiteSpace: "nowrap" }}>
                        {comisionMonto > 0 ? fmtCLP(comisionMonto) : "—"}
                      </td>
                      <td style={{ verticalAlign: "middle" }}>
                        <div style={{ minWidth: 150 }}>
                          {bloqueada ? (
                            <span style={{ fontWeight: 500, color: "#1f2937" }}>{fmtDateCL(d.vencimiento)}</span>
                          ) : (
                            <DateFilter
                              value={d.vencimiento || ""}
                              onChange={(v) => setDraft(f.id, "vencimiento", v)}
                              placeholder="Vencimiento"
                            />
                          )}
                          <div style={{ marginTop: 4 }}>
                            <span style={{
                              display: "inline-flex", alignItems: "center", gap: 5,
                              padding: "2px 8px", borderRadius: "999px", fontSize: "11px", fontWeight: 600,
                              color: sem.color, backgroundColor: sem.bg, whiteSpace: "nowrap",
                            }}>
                              {sem.estado === "rojo" ? <AlertTriangle size={11} /> : <Luz estado={sem.estado} size={7} />}
                              {sem.label}
                            </span>
                            {!bloqueada && d.vencimiento && (
                              <span style={{ marginLeft: 6, fontSize: 11, color: "var(--text-muted)" }}>
                                {fmtDateCL(d.vencimiento)}
                              </span>
                            )}
                          </div>
                        </div>
                      </td>
                      <td style={{ verticalAlign: "middle", textAlign: "right" }}>
                        {bloqueada ? (
                          <span
                            title="Datos guardados. Solo un administrador puede editarlos."
                            style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, color: "var(--text-muted)" }}
                          >
                            <Lock size={13} /> Guardado
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => guardarFila(f)}
                            disabled={savingId === f.id}
                            className="btn btn-primary btn-sm"
                            style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
                          >
                            <Save size={13} /> {savingId === f.id ? "…" : "Guardar"}
                          </button>
                        )}
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
