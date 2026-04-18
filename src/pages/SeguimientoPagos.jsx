import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { Link } from "react-router-dom";
import useAuth from "../hooks/useAuth";
import Toast from "../components/Toast";
import DateFilter from "../components/DateFilter";
import { Eye, CheckCircle2, Circle, AlertTriangle, ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";

const FORMAS_PAGO = [
  { value: "transferencia", label: "Transferencia" },
  { value: "cheque", label: "Cheque" },
  { value: "vale_vista", label: "Vale Vista" },
  { value: "efectivo", label: "Efectivo" },
];

function diasEntre(fechaIso) {
  if (!fechaIso) return null;
  const f = new Date(`${fechaIso}T00:00:00`);
  if (Number.isNaN(f.getTime())) return null;
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  const ms = hoy.getTime() - f.getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

function plazoDias(condVenta) {
  const c = (condVenta || "").toString().toLowerCase();
  const m = c.match(/(\d+)/);
  if (m) return Number(m[1]);
  if (c.includes("contado")) return 0;
  return 30;
}

function calcularFechaVencimiento(fechaFacturaIso, condVenta) {
  if (!fechaFacturaIso) return null;
  const f = new Date(`${fechaFacturaIso}T00:00:00`);
  if (Number.isNaN(f.getTime())) return null;
  const plazo = plazoDias(condVenta);
  f.setDate(f.getDate() + plazo);
  return f;
}

function fmtDateCL(d) {
  if (!d) return "—";
  if (typeof d === "string") {
    return new Date(`${d}T00:00:00`).toLocaleDateString("es-CL");
  }
  return d.toLocaleDateString("es-CL");
}

function semaforo(diasRestantes, pagada) {
  if (pagada) return { color: "#15803d", bg: "#dcfce7", label: "Pagada" };
  if (diasRestantes == null) return { color: "#6b7280", bg: "#f3f4f6", label: "Sin fecha" };
  if (diasRestantes < 0) return { color: "#dc2626", bg: "#fee2e2", label: `Vencida (${Math.abs(diasRestantes)}d)` };
  if (diasRestantes <= 5) return { color: "#b45309", bg: "#fef3c7", label: `Por vencer (${diasRestantes}d)` };
  if (diasRestantes <= 15) return { color: "#0d9488", bg: "#ccfbf1", label: `${diasRestantes}d restantes` };
  return { color: "#1d4ed8", bg: "#dbeafe", label: `${diasRestantes}d restantes` };
}

export default function SeguimientoPagos() {
  const { user, rol, cargando } = useAuth();
  const rolNorm = (rol ?? "").toString().trim().toLowerCase();
  const esAdmin = rolNorm === "admin";
  const [facturas, setFacturas] = useState([]);
  const [licMap, setLicMap] = useState({});
  const [usuariosMap, setUsuariosMap] = useState({});
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);

  // Filtros
  const [filtroEstado, setFiltroEstado] = useState("todas");
  const [filtroEntidad, setFiltroEntidad] = useState("");
  const [filtroNumero, setFiltroNumero] = useState("");
  const [filtroFechaDesde, setFiltroFechaDesde] = useState("");
  const [filtroFechaHasta, setFiltroFechaHasta] = useState("");

  // Ordenamiento
  const [sortCol, setSortCol] = useState("vencimiento");
  const [sortDir, setSortDir] = useState("asc");

  function toggleSort(col) {
    if (sortCol === col) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortCol(col);
      setSortDir("asc");
    }
  }
  function SortIcon({ col }) {
    if (sortCol !== col) return <ArrowUpDown size={11} style={{ color: "#cbd5e1" }} />;
    return sortDir === "asc"
      ? <ArrowUp size={11} style={{ color: "var(--primary-dark, #28aeb1)" }} />
      : <ArrowDown size={11} style={{ color: "var(--primary-dark, #28aeb1)" }} />;
  }

  // Edición de pago
  const [pagandoId, setPagandoId] = useState(null);
  const [fechaPago, setFechaPago] = useState("");
  const [formaPago, setFormaPago] = useState("transferencia");
  const [guardando, setGuardando] = useState(false);

  const [reloadKey, setReloadKey] = useState(0);
  const recargar = () => setReloadKey((k) => k + 1);

  useEffect(() => {
    if (cargando) return;

    async function load() {
      setLoading(true);
      try {
        // 1. Cotizaciones adjudicadas
        const lics = await api.get(
          "/licitaciones/with-fields?fields=id,id_licitacion,nombre_entidad,fecha_adjudicada,total_con_iva,creado_por,condicion_venta,comuna"
        );
        let rows = (lics || []).filter((l) => l.estado === "Adjudicada" || l.estado == null);

        // Cotizaciones adjudicadas reales
        const licsAdj = await api.get(
          "/licitaciones/with-fields?fields=id,id_licitacion,nombre_entidad,fecha_adjudicada,total_con_iva,creado_por,condicion_venta,comuna,estado"
        );
        rows = (licsAdj || []).filter((l) => l.estado === "Adjudicada");

        const rolNorm = (rol ?? "").toString().trim().toLowerCase();
        const emailUser = (user?.email || "").trim().toLowerCase();
        if (rolNorm === "ventas" && emailUser) {
          rows = rows.filter((l) => (l.creado_por || "").trim().toLowerCase() === emailUser);
        }

        const mapa = {};
        rows.forEach((l) => { mapa[l.id] = l; });
        setLicMap(mapa);

        // 2. Facturas de esas cotizaciones
        const ids = rows.map((l) => l.id);
        let allFacturas = [];
        if (ids.length > 0) {
          const docs = await api.post("/licitaciones/documentos/filter", {
            filter: { licitacion_ids: ids, tipo: "factura" },
            fields: "*",
          });
          allFacturas = docs || [];
        }
        setFacturas(allFacturas);

        // 3. Vendedores
        const emails = Array.from(new Set(rows.map((l) => l.creado_por).filter(Boolean)));
        if (emails.length > 0) {
          try {
            const perfiles = await api.post("/usuarios/profiles/by-emails", { emails });
            const m = {};
            (perfiles || []).forEach((p) => {
              const e = (p?.email || "").trim().toLowerCase();
              if (e) m[e] = (p?.nombre || "").trim();
            });
            setUsuariosMap(m);
          } catch { /* */ }
        }
      } catch (e) {
        console.error(e);
        setToast({ type: "error", message: "Error cargando facturas." });
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [cargando, rol, user?.email, reloadKey]);

  // Filtros aplicados
  const facturasFiltradas = useMemo(() => {
    return facturas.filter((f) => {
      const lic = licMap[f.licitacion_id];
      if (!lic) return false;

      const entidad = (lic.nombre_entidad || "").toLowerCase();
      if (filtroEntidad && !entidad.includes(filtroEntidad.toLowerCase())) return false;

      if (filtroNumero) {
        const num = (f.numero || "").toString().toLowerCase();
        if (!num.includes(filtroNumero.toLowerCase())) return false;
      }

      const fechaRef = f.fecha_factura || (f.created_at ? f.created_at.slice(0, 10) : "");
      if (filtroFechaDesde && fechaRef && fechaRef < filtroFechaDesde) return false;
      if (filtroFechaHasta && fechaRef && fechaRef > filtroFechaHasta) return false;

      const plazo = plazoDias(lic.condicion_venta);
      const dias = diasEntre(f.fecha_factura);
      const diasRestantes = dias != null ? plazo - dias : null;

      if (filtroEstado === "pagadas" && !f.pagada) return false;
      if (filtroEstado === "pendientes" && f.pagada) return false;
      if (filtroEstado === "vencidas" && (f.pagada || diasRestantes == null || diasRestantes >= 0)) return false;
      if (filtroEstado === "por_vencer" && (f.pagada || diasRestantes == null || diasRestantes < 0 || diasRestantes > 5)) return false;

      return true;
    });
  }, [facturas, licMap, filtroEntidad, filtroNumero, filtroFechaDesde, filtroFechaHasta, filtroEstado]);

  // Ordenamiento
  const facturasOrdenadas = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    const arr = [...facturasFiltradas];
    arr.sort((a, b) => {
      const licA = licMap[a.licitacion_id] || {};
      const licB = licMap[b.licitacion_id] || {};
      switch (sortCol) {
        case "cotizacion": return ((licA.id || 0) - (licB.id || 0)) * dir;
        case "entidad": {
          const va = (licA.nombre_entidad || "").toLowerCase();
          const vb = (licB.nombre_entidad || "").toLowerCase();
          return va.localeCompare(vb) * dir;
        }
        case "factura": {
          const va = (a.numero || "").toLowerCase();
          const vb = (b.numero || "").toLowerCase();
          return va.localeCompare(vb) * dir;
        }
        case "fecha_factura": {
          const va = a.fecha_factura || "";
          const vb = b.fecha_factura || "";
          return va.localeCompare(vb) * dir;
        }
        case "vencimiento": {
          const va = calcularFechaVencimiento(a.fecha_factura, licA.condicion_venta);
          const vb = calcularFechaVencimiento(b.fecha_factura, licB.condicion_venta);
          if (!va && !vb) return 0;
          if (!va) return 1;
          if (!vb) return -1;
          return (va.getTime() - vb.getTime()) * dir;
        }
        case "monto": return ((Number(licA.total_con_iva) || 0) - (Number(licB.total_con_iva) || 0)) * dir;
        case "estado": {
          // Orden lógico: vencida (peor) → por vencer → pendientes → pagada
          const orden = (f, lic) => {
            if (f.pagada) return 4;
            const dias = diasEntre(f.fecha_factura);
            const restantes = dias != null ? plazoDias(lic.condicion_venta) - dias : null;
            if (restantes == null) return 5;
            if (restantes < 0) return 0;
            if (restantes <= 5) return 1;
            return 2;
          };
          return (orden(a, licA) - orden(b, licB)) * dir;
        }
        default: return 0;
      }
    });
    return arr;
  }, [facturasFiltradas, licMap, sortCol, sortDir]);

  // Stats globales (de todas las facturas, no solo las filtradas)
  const stats = useMemo(() => {
    let total = 0, pagadas = 0, pendientes = 0, vencidas = 0, porVencer = 0;
    facturas.forEach((f) => {
      const lic = licMap[f.licitacion_id];
      if (!lic) return;
      total++;
      if (f.pagada) { pagadas++; return; }
      pendientes++;
      const plazo = plazoDias(lic.condicion_venta);
      const dias = diasEntre(f.fecha_factura);
      const diasRestantes = dias != null ? plazo - dias : null;
      if (diasRestantes != null && diasRestantes < 0) vencidas++;
      else if (diasRestantes != null && diasRestantes <= 5) porVencer++;
    });
    return { total, pagadas, pendientes, vencidas, porVencer };
  }, [facturas, licMap]);

  async function abrirDocumento(doc) {
    if (!doc?.bucket || !doc?.storage_path) return;
    try {
      const data = await api.get(
        `/licitaciones/storage/signed-url?bucket=${encodeURIComponent(doc.bucket)}&path=${encodeURIComponent(doc.storage_path)}`
      );
      if (!data?.signedUrl) {
        setToast({ type: "error", message: "No se pudo abrir el documento." });
        return;
      }
      window.open(data.signedUrl, "_blank", "noopener,noreferrer");
    } catch {
      setToast({ type: "error", message: "No se pudo abrir el documento." });
    }
  }

  function iniciarPago(f) {
    setPagandoId(f.id);
    setFechaPago(f.fecha_pago || new Date().toISOString().slice(0, 10));
    setFormaPago(f.forma_pago || "transferencia");
  }

  function cancelarPago() {
    setPagandoId(null);
    setFechaPago("");
    setFormaPago("transferencia");
  }

  async function confirmarPago(f) {
    if (!fechaPago) {
      setToast({ type: "error", message: "Debes ingresar la fecha de pago." });
      return;
    }
    setGuardando(true);
    try {
      await api.put(`/licitaciones/documentos/${f.id}`, {
        pagada: true,
        fecha_pago: fechaPago,
        forma_pago: formaPago,
      });
      setToast({ type: "success", message: "Pago registrado." });
      cancelarPago();
      recargar();
    } catch (e) {
      console.error(e);
      setToast({ type: "error", message: "Error al registrar el pago." });
    } finally {
      setGuardando(false);
    }
  }

  async function desmarcarPago(f) {
    if (!confirm("¿Marcar esta factura como NO pagada?")) return;
    try {
      await api.put(`/licitaciones/documentos/${f.id}`, {
        pagada: false,
        fecha_pago: null,
        forma_pago: null,
      });
      setToast({ type: "success", message: "Pago desmarcado." });
      recargar();
    } catch (e) {
      setToast({ type: "error", message: "Error desmarcando el pago." });
    }
  }

  if (loading) {
    return (
      <div className="page">
        <div className="page-header">
          <h1 className="page-title">Seguimiento de Pagos</h1>
        </div>
        <p className="text-gray-500 text-sm mt-4">Cargando...</p>
      </div>
    );
  }

  if (!cargando && !esAdmin) {
    return (
      <div className="page">
        <div className="surface">
          <div className="surface-body" style={{ color: "var(--danger)" }}>
            Acceso restringido: esta sección es solo para administradores.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}

      <div className="page-header">
        <div>
          <h1 className="page-title">Seguimiento de Pagos</h1>
          <p className="page-subtitle">
            {facturasFiltradas.length} factura{facturasFiltradas.length !== 1 ? "s" : ""}
          </p>
        </div>
      </div>

      {/* Stats */}
      <div className="stats-row">
        <div className="stat-card">
          <div className="stat-label">Pagadas</div>
          <div className="stat-value" style={{ color: "var(--success)" }}>{stats.pagadas}</div>
          <div className="stat-sub">facturas</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Pendientes</div>
          <div className="stat-value" style={{ color: "var(--primary)" }}>
            {Math.max(0, stats.pendientes - stats.porVencer - stats.vencidas)}
          </div>
          <div className="stat-sub">aún en plazo</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Por vencer</div>
          <div className="stat-value" style={{ color: "var(--warning)" }}>{stats.porVencer}</div>
          <div className="stat-sub">próximas a vencer</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Vencidas</div>
          <div className="stat-value" style={{ color: "var(--danger)" }}>{stats.vencidas}</div>
          <div className="stat-sub">fuera de plazo</div>
        </div>
      </div>

      {/* Filtros */}
      <div className="filter-bar">
        <div className="filter-field">
          <label className="filter-label">Estado</label>
          <select className="input" value={filtroEstado} onChange={(e) => setFiltroEstado(e.target.value)}>
            <option value="todas">Todas</option>
            <option value="pagadas">Pagadas</option>
            <option value="pendientes">Pendientes</option>
            <option value="por_vencer">Por vencer</option>
            <option value="vencidas">Vencidas</option>
          </select>
        </div>
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
          <label className="filter-label">N° Factura</label>
          <input
            type="text"
            className="input"
            placeholder="Buscar N°..."
            value={filtroNumero}
            onChange={(e) => setFiltroNumero(e.target.value)}
          />
        </div>
        <div className="filter-field">
          <label className="filter-label">Factura desde</label>
          <DateFilter value={filtroFechaDesde} onChange={setFiltroFechaDesde} placeholder="Desde" />
        </div>
        <div className="filter-field">
          <label className="filter-label">Factura hasta</label>
          <DateFilter
            value={filtroFechaHasta}
            onChange={setFiltroFechaHasta}
            placeholder="Hasta"
            minDate={filtroFechaDesde ? new Date(`${filtroFechaDesde}T00:00:00`) : null}
          />
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
          <table className="data-table trazabilidad-table">
            <thead>
              <tr>
                <th onClick={() => toggleSort("entidad")} style={{ cursor: "pointer", userSelect: "none", textAlign: "left" }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                    Cotización / Cliente <SortIcon col="entidad" />
                  </span>
                </th>
                <th onClick={() => toggleSort("factura")} style={{ cursor: "pointer", userSelect: "none", textAlign: "left" }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                    Factura <SortIcon col="factura" />
                  </span>
                </th>
                <th onClick={() => toggleSort("fecha_factura")} style={{ cursor: "pointer", userSelect: "none", textAlign: "left" }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                    Fecha Factura <SortIcon col="fecha_factura" />
                  </span>
                </th>
                <th onClick={() => toggleSort("vencimiento")} style={{ cursor: "pointer", userSelect: "none", textAlign: "left" }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                    Vencimiento <SortIcon col="vencimiento" />
                  </span>
                </th>
                <th style={{ textAlign: "left" }}>Cond.</th>
                <th onClick={() => toggleSort("monto")} style={{ cursor: "pointer", userSelect: "none", textAlign: "right" }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4, justifyContent: "flex-end" }}>
                    Monto <SortIcon col="monto" />
                  </span>
                </th>
                <th onClick={() => toggleSort("estado")} style={{ cursor: "pointer", userSelect: "none", textAlign: "left" }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                    Estado <SortIcon col="estado" />
                  </span>
                </th>
                <th style={{ textAlign: "left" }}>Pago</th>
                <th style={{ textAlign: "right" }}>Acción</th>
              </tr>
            </thead>
            <tbody>
              {facturasOrdenadas.length === 0 ? (
                <tr>
                  <td colSpan="9" style={{ textAlign: "center", padding: "60px 0", color: "var(--text-muted)" }}>
                    No hay facturas que coincidan con los filtros.
                  </td>
                </tr>
              ) : (
                facturasOrdenadas.map((f) => {
                  const lic = licMap[f.licitacion_id];
                  if (!lic) return null;
                  const plazo = plazoDias(lic.condicion_venta);
                  const dias = diasEntre(f.fecha_factura);
                  const diasRestantes = dias != null ? plazo - dias : null;
                  const sem = semaforo(diasRestantes, f.pagada);
                  const editando = pagandoId === f.id;
                  const fechaVenc = calcularFechaVencimiento(f.fecha_factura, lic.condicion_venta);

                  return (
                    <tr key={f.id}>
                      <td style={{ verticalAlign: "middle" }}>
                        <Link to={`/detalle/${lic.id}`} className="table-link" style={{ fontWeight: 600 }}>
                          #{lic.id}
                        </Link>
                        {lic.id_licitacion && (
                          <span style={{ color: "var(--text-muted)", fontSize: "11px", marginLeft: 6 }}>
                            {lic.id_licitacion}
                          </span>
                        )}
                        <div style={{ fontWeight: 500, fontSize: "13px", color: "#1f2937", marginTop: 2 }}>
                          {lic.nombre_entidad || "—"}
                        </div>
                        {lic.comuna && (
                          <div style={{ color: "var(--text-muted)", fontSize: "11px" }}>{lic.comuna}</div>
                        )}
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
                      <td style={{ verticalAlign: "middle", color: "var(--text-muted)" }}>
                        {f.fecha_factura
                          ? new Date(`${f.fecha_factura}T00:00:00`).toLocaleDateString("es-CL")
                          : f.created_at
                          ? new Date(f.created_at).toLocaleDateString("es-CL")
                          : "—"}
                      </td>
                      <td style={{ verticalAlign: "middle" }}>
                        {fechaVenc ? (
                          <div>
                            <div style={{ color: "#1f2937", fontWeight: 500 }}>{fmtDateCL(fechaVenc)}</div>
                            {!f.pagada && diasRestantes != null && (
                              <div style={{ fontSize: 11, color: diasRestantes < 0 ? "#dc2626" : diasRestantes <= 5 ? "#b45309" : "var(--text-muted)" }}>
                                {diasRestantes < 0
                                  ? `Hace ${Math.abs(diasRestantes)}d`
                                  : `En ${diasRestantes}d`}
                              </div>
                            )}
                          </div>
                        ) : (
                          <span style={{ color: "var(--text-muted)" }}>—</span>
                        )}
                      </td>
                      <td style={{ verticalAlign: "middle", color: "var(--text-muted)" }}>
                        {lic.condicion_venta || "—"}
                      </td>
                      <td style={{ verticalAlign: "middle", textAlign: "right", fontWeight: 600, whiteSpace: "nowrap" }}>
                        {lic.total_con_iva ? `$${Number(lic.total_con_iva).toLocaleString("es-CL")}` : "—"}
                      </td>
                      <td style={{ verticalAlign: "middle" }}>
                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 4,
                            padding: "3px 10px",
                            borderRadius: "999px",
                            fontSize: "11px",
                            fontWeight: 600,
                            color: sem.color,
                            backgroundColor: sem.bg,
                          }}
                        >
                          {!f.pagada && diasRestantes != null && diasRestantes <= 5 && <AlertTriangle size={11} />}
                          {sem.label}
                        </span>
                      </td>
                      <td style={{ verticalAlign: "middle" }}>
                        {f.pagada ? (
                          <div>
                            <div style={{ color: "#15803d", fontWeight: 500, fontSize: "12px" }}>
                              {f.fecha_pago ? new Date(`${f.fecha_pago}T00:00:00`).toLocaleDateString("es-CL") : "—"}
                            </div>
                            <div style={{ color: "var(--text-muted)", fontSize: "11px" }}>
                              {FORMAS_PAGO.find((x) => x.value === f.forma_pago)?.label || f.forma_pago || "—"}
                            </div>
                          </div>
                        ) : (
                          <span style={{ color: "var(--text-muted)" }}>—</span>
                        )}
                      </td>
                      <td style={{ verticalAlign: "middle", textAlign: "right" }}>
                        {editando ? (
                          <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 200, textAlign: "left" }}>
                            <DateFilter
                              value={fechaPago}
                              onChange={setFechaPago}
                              placeholder="Fecha pago"
                              disabled={guardando}
                            />
                            <select
                              className="input"
                              value={formaPago}
                              onChange={(e) => setFormaPago(e.target.value)}
                              disabled={guardando}
                            >
                              {FORMAS_PAGO.map((fp) => (
                                <option key={fp.value} value={fp.value}>{fp.label}</option>
                              ))}
                            </select>
                            <div style={{ display: "flex", gap: 6 }}>
                              <button type="button" onClick={() => confirmarPago(f)} disabled={guardando} className="btn btn-primary btn-sm">
                                {guardando ? "..." : "Confirmar"}
                              </button>
                              <button type="button" onClick={cancelarPago} disabled={guardando} className="btn btn-secondary btn-sm">
                                Cancelar
                              </button>
                            </div>
                          </div>
                        ) : f.pagada ? (
                          <button
                            type="button"
                            onClick={() => desmarcarPago(f)}
                            className="btn btn-secondary btn-sm"
                            title="Desmarcar pago"
                          >
                            <CheckCircle2 size={13} style={{ color: "#15803d", marginRight: 4 }} /> Desmarcar
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => iniciarPago(f)}
                            className="btn btn-primary btn-sm"
                          >
                            <Circle size={12} style={{ marginRight: 4 }} /> Marcar pagada
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
