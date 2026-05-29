import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api";
import { Link } from "react-router-dom";
import * as XLSX from "xlsx";
import useAuth from "../hooks/useAuth";
import { ChevronDown, Download, ChevronRight } from "lucide-react";
import Toast from "../components/Toast";
import ConfirmModal from "../components/ConfirmModal";
import DateFilter from "../components/DateFilter";
import { useStickyState } from "../lib/useStickyState";

export default function ListarLicitaciones() {
  const { user, rol, cargando } = useAuth();
  const [data, setData] = useState([]);
  const [usuariosMap, setUsuariosMap] = useState({});
  const [toast, setToast] = useState(null);
  const [confirmEliminar, setConfirmEliminar] = useState(null); // id de cotización a eliminar

  // Filtros persistentes: se conservan al entrar a una cotización y volver atrás.
  const [filtroFechaDesde,   setFiltroFechaDesde]   = useStickyState("cotizaciones.fechaDesde", "");
  const [filtroFechaHasta,   setFiltroFechaHasta]   = useStickyState("cotizaciones.fechaHasta", "");
  const [filtroAdjDesde,     setFiltroAdjDesde]     = useStickyState("cotizaciones.adjDesde", "");
  const [filtroAdjHasta,     setFiltroAdjHasta]     = useStickyState("cotizaciones.adjHasta", "");
  const [filtroIdLicitacion, setFiltroIdLicitacion] = useStickyState("cotizaciones.idLicitacion", "");
  const [filtroNumeroCot,    setFiltroNumeroCot]    = useStickyState("cotizaciones.numeroCot", "");
  const [filtroMontoMin,     setFiltroMontoMin]     = useStickyState("cotizaciones.montoMin", "");
  const [filtroComuna,       setFiltroComuna]       = useStickyState("cotizaciones.comuna", "");
  const [filtroCreadores,    setFiltroCreadores]    = useStickyState("cotizaciones.creadores", []);
  const [filtroEstado,       setFiltroEstado]       = useStickyState("cotizaciones.estado", []);
  const [filtroTipoCompra,   setFiltroTipoCompra]   = useStickyState("cotizaciones.tipoCompra", []);

  const [openCreadores, setOpenCreadores] = useState(false);
  const [openEstados,   setOpenEstados]   = useState(false);
  const [openTipoCompra, setOpenTipoCompra] = useState(false);

  // Orden
  const [sortCol, setSortCol] = useStickyState("cotizaciones.sortCol", "id");
  const [sortDir, setSortDir] = useStickyState("cotizaciones.sortDir", "desc");
  function toggleSort(col) {
    if (sortCol === col) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortCol(col); setSortDir("desc"); }
  }
  function SortIcon({ col }) {
    if (sortCol !== col) return <span style={{ opacity: 0.3 }}>↕</span>;
    return <span>{sortDir === "asc" ? "▲" : "▼"}</span>;
  }
  const creadoresRef = useRef(null);
  const estadosRef   = useRef(null);
  const tipoCompraRef = useRef(null);

  useEffect(() => {
    const onClickOutside = (e) => {
      if (creadoresRef.current && !creadoresRef.current.contains(e.target)) setOpenCreadores(false);
      if (estadosRef.current   && !estadosRef.current.contains(e.target))   setOpenEstados(false);
      if (tipoCompraRef.current && !tipoCompraRef.current.contains(e.target)) setOpenTipoCompra(false);
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  async function loadData() {
    if (cargando) return;

    try {
      // Solo los campos que usa el listado: evita traer columnas pesadas
      // (ítems de la cotización, etc.) que disparan el tamaño del payload.
      const licitaciones = await api.get(
        "/licitaciones/with-fields?fields=id,id_licitacion,fecha,comuna,total_con_iva,tipo_compra,estado,creado_por"
      );

      let rows = licitaciones || [];
      const rolNorm   = (rol ?? "").toString().trim().toLowerCase();
      const emailUser = (user?.email || "").trim().toLowerCase();

      if ((rolNorm === "ventas" || rolNorm === "ventas_especial") && emailUser)
        rows = rows.filter((l) => (l.creado_por || "").trim().toLowerCase() === emailUser);

      // Fecha de adjudicación = fecha de creación de la primera OC de cada cotización.
      // Paralelizamos docs OC + perfiles: antes eran 2 roundtrips secuenciales.
      const ids = rows.map((l) => Number(l?.id)).filter((n) => Number.isFinite(n));
      const emailsUnicos = Array.from(new Set(rows.map((l) => l.creado_por).filter(Boolean)));

      const [docsOcRes, perfilesRes] = await Promise.allSettled([
        ids.length > 0
          ? api.post("/licitaciones/documentos/filter", {
              filter: { licitacion_ids: ids, tipo: ["orden_compra", "factura_boleta", "efectivo"] },
              fields: "licitacion_id,fecha_oc,created_at",
            })
          : Promise.resolve([]),
        emailsUnicos.length > 0
          ? api.post("/usuarios/profiles/by-emails", { emails: emailsUnicos })
          : Promise.resolve([]),
      ]);

      const primeraOcMap = {};
      if (docsOcRes.status === "fulfilled") {
        (docsOcRes.value || []).forEach((d) => {
          const licId = Number(d?.licitacion_id || 0);
          if (!licId) return;
          const raw = d?.fecha_oc || d?.created_at;
          if (!raw) return;
          const iso = String(raw).slice(0, 10);
          if (!primeraOcMap[licId] || iso < primeraOcMap[licId]) {
            primeraOcMap[licId] = iso;
          }
        });
      } else {
        console.error("Error cargando OCs para fecha adjudicación:", docsOcRes.reason);
      }
      rows = rows.map((l) => ({
        ...l,
        fecha_adjudicacion: primeraOcMap[Number(l.id)] || null,
      }));

      setData(rows);

      const mapa = {};
      if (perfilesRes.status === "fulfilled") {
        (perfilesRes.value || []).forEach((p) => {
          const email = (p?.email || "").trim().toLowerCase();
          if (email) mapa[email] = (p?.nombre || "").trim();
        });
      } else {
        console.error("Error profiles:", perfilesRes.reason);
      }
      setUsuariosMap(mapa);
    } catch (error) {
      console.error("Error licitaciones:", error);
    }
  }

  useEffect(() => { loadData(); }, [cargando, rol, user?.email]);

  // ── Badge helper ─────────────────────────────────────────────
  function estadoBadgeClass(estado) {
    if (estado === "Adjudicada")           return "badge badge-success";
    if (estado === "Perdida")              return "badge badge-danger";
    if (estado === "En espera")            return "badge badge-warning";
    if (estado === "Pendiente Aprobación") return "badge badge-primary";
    if (estado === "Cancelada")            return "badge badge-neutral";
    return "badge badge-neutral";
  }

  // ── Opciones ──────────────────────────────────────────────────
  const opcionesCreadores = useMemo(() => {
    const emails = Array.from(new Set(data.map((l) => l.creado_por).filter(Boolean)));
    return emails
      .map((emailRaw) => {
        const email = emailRaw.trim().toLowerCase();
        return { value: email, label: (usuariosMap[email] || "").trim() || "Sin nombre" };
      })
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [data, usuariosMap]);

  const opcionesEstado = [
    "En espera","Adjudicada","Perdida","Desierta","Descartada","Cancelada","Pendiente Aprobación",
  ];

  const opcionesTipoCompra = [
    "Compra ágil","Compra directa","Licitación 0 a 8 meses","Licitación 9 a 24 meses","Cliente particular",
  ];

  const textoCreadores = useMemo(() => {
    if (filtroCreadores.length === 0) return "Todos";
    return filtroCreadores.map((e) => (usuariosMap[e] || "").trim() || "Sin nombre").join(", ");
  }, [filtroCreadores, usuariosMap]);

  const textoEstados = useMemo(() => {
    if (filtroEstado.length === 0) return "Todos";
    return filtroEstado.join(", ");
  }, [filtroEstado]);

  const textoTipoCompra = useMemo(() => {
    if (filtroTipoCompra.length === 0) return "Todos";
    return filtroTipoCompra.join(", ");
  }, [filtroTipoCompra]);

  // ── Filtrado ──────────────────────────────────────────────────
  const dataFiltrada = data.filter((l) => {
    const email  = (l.creado_por || "").trim().toLowerCase();
    const fecha  = l.fecha ? l.fecha.slice(0, 10) : "";
    const idLic  = (l.id_licitacion || "").toString().trim().toLowerCase();
    const comuna = (l.comuna || "").toString().trim().toLowerCase();
    const numeroCot = String(l.id ?? "");
    const montoTotal = Number(l.total_con_iva) || 0;
    const montoMin = filtroMontoMin !== "" ? Number(filtroMontoMin) : null;

    const fechaAdj = l.fecha_adjudicacion || "";
    const tipoCompraRow = (l.tipo_compra || "").toString().trim();

    return (
      (filtroFechaDesde   ? fecha >= filtroFechaDesde   : true) &&
      (filtroFechaHasta   ? fecha <= filtroFechaHasta   : true) &&
      (filtroAdjDesde     ? (fechaAdj && fechaAdj >= filtroAdjDesde) : true) &&
      (filtroAdjHasta     ? (fechaAdj && fechaAdj <= filtroAdjHasta) : true) &&
      (filtroIdLicitacion ? idLic.includes(filtroIdLicitacion.trim().toLowerCase()) : true) &&
      (filtroNumeroCot    ? numeroCot.includes(filtroNumeroCot.trim()) : true) &&
      (montoMin != null ? montoTotal >= montoMin : true) &&
      (filtroComuna       ? comuna.includes(filtroComuna.trim().toLowerCase())      : true) &&
      (filtroCreadores.length > 0 ? filtroCreadores.includes(email)   : true) &&
      (filtroEstado.length   > 0 ? filtroEstado.includes(l.estado)    : true) &&
      (filtroTipoCompra.length > 0 ? filtroTipoCompra.includes(tipoCompraRow) : true)
    );
  });

  // ── Ordenamiento ──────────────────────────────────────────────
  const dataOrdenada = useMemo(() => {
    const arr = [...dataFiltrada];
    const dir = sortDir === "asc" ? 1 : -1;
    const cmp = (a, b) => {
      let va, vb;
      switch (sortCol) {
        case "id":
          va = Number(a.id) || 0; vb = Number(b.id) || 0; break;
        case "id_licitacion":
          va = (a.id_licitacion || "").toString().toLowerCase();
          vb = (b.id_licitacion || "").toString().toLowerCase(); break;
        case "fecha":
          va = a.fecha || ""; vb = b.fecha || ""; break;
        case "fecha_adjudicacion":
          va = a.fecha_adjudicacion || ""; vb = b.fecha_adjudicacion || ""; break;
        case "monto":
          va = Number(a.total_con_iva) || 0; vb = Number(b.total_con_iva) || 0; break;
        case "comuna":
          va = (a.comuna || "").toLowerCase(); vb = (b.comuna || "").toLowerCase(); break;
        case "estado":
          va = (a.estado || "").toLowerCase(); vb = (b.estado || "").toLowerCase(); break;
        case "creado_por":
          va = (usuariosMap[(a.creado_por || "").trim().toLowerCase()] || "").toLowerCase();
          vb = (usuariosMap[(b.creado_por || "").trim().toLowerCase()] || "").toLowerCase();
          break;
        default:
          va = 0; vb = 0;
      }
      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
      return 0;
    };
    arr.sort(cmp);
    return arr;
  }, [dataFiltrada, sortCol, sortDir, usuariosMap]);

  // ── Stats ─────────────────────────────────────────────────────
  const stats = useMemo(() => ({
    total:       dataFiltrada.length,
    adjudicadas: dataFiltrada.filter((l) => l.estado === "Adjudicada").length,
    enEspera:    dataFiltrada.filter((l) => l.estado === "En espera").length,
    perdidas:    dataFiltrada.filter((l) => l.estado === "Perdida").length,
  }), [dataFiltrada]);

  // ── Exportar ──────────────────────────────────────────────────
  function exportarXLSX() {
    if (dataFiltrada.length === 0) {
      setToast({ type: "info", message: "No hay datos para exportar." });
      return;
    }
    const datosExport = dataFiltrada.map((l) => ({
      "N° Cotización": l.id,
      "ID Cotización": l.id_licitacion,
      Fecha:           l.fecha ? l.fecha.slice(0, 10) : "",
      Comuna:          l.comuna || "",
      Estado:          l.estado || "",
      "Creado por":    (usuariosMap[(l.creado_por || "").trim().toLowerCase()] || "").trim(),
    }));
    const ws = XLSX.utils.json_to_sheet(datosExport);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Cotizaciones");
    XLSX.writeFile(wb, "cotizaciones.xlsx");
  }

  const rolNorm    = (rol ?? "").toString().trim().toLowerCase();
  const esAdmin    = rolNorm === "admin";
  const esJefatura = ["jefe_ventas","jefe ventas","jefe-ventas","jefe de ventas","jefe_ventas_especial","contabilidad"].includes(rolNorm);

  // ── Acciones admin ────────────────────────────────────────────
  async function aprobarCotizacion(id) {
    try {
      await api.put(`/licitaciones/${id}`, { estado: "En espera", margen_aprobado: true });
    } catch (error) {
      setToast({ type: "error", message: "No se pudo aprobar la cotización." });
      return;
    }

    setData((prev) =>
      prev.map((l) => l.id === id ? { ...l, estado: "En espera", margen_aprobado: true } : l)
    );
    setToast({ type: "success", message: "Cotización aprobada." });
  }

  function eliminarCotizacion(id) {
    setConfirmEliminar(id);
  }

  async function confirmarEliminarCotizacion() {
    const id = confirmEliminar;
    setConfirmEliminar(null);
    if (!id) return;

    try {
      await api.delete(`/licitaciones/${id}`);
    } catch (error) {
      setToast({ type: "error", message: "No se pudo eliminar la cotización." }); return;
    }

    setData((prev) => prev.filter((l) => l.id !== id));
    setToast({ type: "success", message: "Cotización eliminada." });
  }

  // ── Render ────────────────────────────────────────────────────
  return (
    <div className="page">
      {toast && (
        <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />
      )}

      <ConfirmModal
        open={confirmEliminar !== null}
        title="¿Eliminar esta cotización?"
        message="Esta acción no se puede deshacer. Se eliminará la cotización y todos sus documentos asociados."
        confirmText="Eliminar cotización"
        cancelText="Cancelar"
        confirmTone="danger"
        onConfirm={confirmarEliminarCotizacion}
        onCancel={() => setConfirmEliminar(null)}
      />

      {/* Page header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Cotizaciones</h1>
          <p className="page-subtitle">{dataFiltrada.length} resultado{dataFiltrada.length !== 1 ? "s" : ""}</p>
        </div>
        <div className="page-actions">
          <button onClick={exportarXLSX} className="btn btn-secondary">
            <Download size={14} />
            Exportar XLSX
          </button>
          <Link to="/crear" className="btn btn-primary">
            + Nueva cotización
          </Link>
        </div>
      </div>

      {/* Stats */}
      <div className="stats-row">
        <div className="stat-card">
          <div className="stat-label">Total</div>
          <div className="stat-value">{stats.total}</div>
          <div className="stat-sub">cotizaciones</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Adjudicadas</div>
          <div className="stat-value" style={{ color: "var(--success)" }}>{stats.adjudicadas}</div>
          <div className="stat-sub">ganadas</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">En espera</div>
          <div className="stat-value" style={{ color: "var(--warning)" }}>{stats.enEspera}</div>
          <div className="stat-sub">pendientes</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Perdidas</div>
          <div className="stat-value" style={{ color: "var(--danger)" }}>{stats.perdidas}</div>
          <div className="stat-sub">no adjudicadas</div>
        </div>
      </div>

      {/* Filter bar */}
      <div className="filter-bar filter-bar-grid">
        <div className="filter-field">
          <label className="filter-label">Desde</label>
          <DateFilter value={filtroFechaDesde} onChange={setFiltroFechaDesde} placeholder="Desde" />
        </div>

        <div className="filter-field">
          <label className="filter-label">Hasta</label>
          <DateFilter
            value={filtroFechaHasta}
            onChange={setFiltroFechaHasta}
            placeholder="Hasta"
            minDate={filtroFechaDesde ? new Date(`${filtroFechaDesde}T00:00:00`) : null}
          />
        </div>

        <div className="filter-field">
          <label className="filter-label">Adjudicación desde</label>
          <DateFilter value={filtroAdjDesde} onChange={setFiltroAdjDesde} placeholder="Desde" />
        </div>

        <div className="filter-field">
          <label className="filter-label">Adjudicación hasta</label>
          <DateFilter
            value={filtroAdjHasta}
            onChange={setFiltroAdjHasta}
            placeholder="Hasta"
            minDate={filtroAdjDesde ? new Date(`${filtroAdjDesde}T00:00:00`) : null}
          />
        </div>

        <div className="filter-field">
          <label className="filter-label">ID Cotización</label>
          <input type="text" className="input" placeholder="Buscar ID…"
            value={filtroIdLicitacion} onChange={(e) => setFiltroIdLicitacion(e.target.value)} />
        </div>

        <div className="filter-field">
          <label className="filter-label">N° Cotización</label>
          <input type="text" className="input" placeholder="N°…"
            value={filtroNumeroCot} onChange={(e) => setFiltroNumeroCot(e.target.value)} />
        </div>

        <div className="filter-field">
          <label className="filter-label">Monto Total (mín)</label>
          <input type="number" className="input" placeholder="≥ monto"
            value={filtroMontoMin} onChange={(e) => setFiltroMontoMin(e.target.value)} />
        </div>

        <div className="filter-field">
          <label className="filter-label">Comuna</label>
          <input type="text" className="input" placeholder="Buscar comuna…"
            value={filtroComuna} onChange={(e) => setFiltroComuna(e.target.value)} />
        </div>

        {/* Creado por */}
        <div className="filter-field" style={{ position: "relative" }} ref={creadoresRef}>
          <label className="filter-label">Creado por</label>
          <button type="button" className="dropdown-trigger" onClick={() => setOpenCreadores((v) => !v)}>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{textoCreadores}</span>
            <ChevronDown size={14} style={{ flexShrink: 0, opacity: .6 }} />
          </button>
          {openCreadores && (
            <div className="dropdown-menu">
              <div className="dropdown-menu-header">
                <button className="btn btn-sm btn-secondary" onClick={() => setFiltroCreadores(opcionesCreadores.map((o) => o.value))}>Todos</button>
                <button className="btn btn-sm btn-secondary" onClick={() => setFiltroCreadores([])}>Limpiar</button>
              </div>
              <div className="dropdown-menu-body">
                {opcionesCreadores.map((op) => (
                  <label key={op.value} className="dropdown-option">
                    <input type="checkbox" checked={filtroCreadores.includes(op.value)}
                      onChange={(e) => {
                        if (e.target.checked) setFiltroCreadores((prev) => [...prev, op.value]);
                        else setFiltroCreadores((prev) => prev.filter((x) => x !== op.value));
                      }} />
                    {op.label}
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Estado */}
        <div className="filter-field" style={{ position: "relative" }} ref={estadosRef}>
          <label className="filter-label">Estado</label>
          <button type="button" className="dropdown-trigger" onClick={() => setOpenEstados((v) => !v)}>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{textoEstados}</span>
            <ChevronDown size={14} style={{ flexShrink: 0, opacity: .6 }} />
          </button>
          {openEstados && (
            <div className="dropdown-menu">
              <div className="dropdown-menu-header">
                <button className="btn btn-sm btn-secondary" onClick={() => setFiltroEstado([...opcionesEstado])}>Todos</button>
                <button className="btn btn-sm btn-secondary" onClick={() => setFiltroEstado([])}>Limpiar</button>
              </div>
              <div className="dropdown-menu-body">
                {opcionesEstado.map((op) => (
                  <label key={op} className="dropdown-option">
                    <input type="checkbox" checked={filtroEstado.includes(op)}
                      onChange={(e) => {
                        if (e.target.checked) setFiltroEstado((prev) => [...prev, op]);
                        else setFiltroEstado((prev) => prev.filter((x) => x !== op));
                      }} />
                    {op}
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Tipo de Compra */}
        <div className="filter-field" style={{ position: "relative" }} ref={tipoCompraRef}>
          <label className="filter-label">Tipo de Compra</label>
          <button type="button" className="dropdown-trigger" onClick={() => setOpenTipoCompra((v) => !v)}>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{textoTipoCompra}</span>
            <ChevronDown size={14} style={{ flexShrink: 0, opacity: .6 }} />
          </button>
          {openTipoCompra && (
            <div className="dropdown-menu">
              <div className="dropdown-menu-header">
                <button className="btn btn-sm btn-secondary" onClick={() => setFiltroTipoCompra([...opcionesTipoCompra])}>Todos</button>
                <button className="btn btn-sm btn-secondary" onClick={() => setFiltroTipoCompra([])}>Limpiar</button>
              </div>
              <div className="dropdown-menu-body">
                {opcionesTipoCompra.map((op) => (
                  <label key={op} className="dropdown-option">
                    <input type="checkbox" checked={filtroTipoCompra.includes(op)}
                      onChange={(e) => {
                        if (e.target.checked) setFiltroTipoCompra((prev) => [...prev, op]);
                        else setFiltroTipoCompra((prev) => prev.filter((x) => x !== op));
                      }} />
                    {op}
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="table-wrap">
        <div className="table-scroll" style={{ maxHeight: "calc(100vh - 400px)" }}>
          <table className="data-table cotizaciones-table">
            <thead>
              <tr>
                <th onClick={() => toggleSort("id")} style={{ cursor: "pointer", userSelect: "none" }}>
                  N° <SortIcon col="id" />
                </th>
                <th onClick={() => toggleSort("id_licitacion")} style={{ cursor: "pointer", userSelect: "none" }}>
                  ID Cotización <SortIcon col="id_licitacion" />
                </th>
                <th onClick={() => toggleSort("fecha")} style={{ cursor: "pointer", userSelect: "none" }}>
                  Fecha <SortIcon col="fecha" />
                </th>
                <th onClick={() => toggleSort("fecha_adjudicacion")} style={{ cursor: "pointer", userSelect: "none" }}>
                  Adjudicación <SortIcon col="fecha_adjudicacion" />
                </th>
                <th onClick={() => toggleSort("monto")} style={{ cursor: "pointer", userSelect: "none", textAlign: "left" }}>
                  Monto Total <SortIcon col="monto" />
                </th>
                <th onClick={() => toggleSort("comuna")} style={{ cursor: "pointer", userSelect: "none" }}>
                  Comuna <SortIcon col="comuna" />
                </th>
                <th onClick={() => toggleSort("estado")} style={{ cursor: "pointer", userSelect: "none" }}>
                  Estado <SortIcon col="estado" />
                </th>
                <th onClick={() => toggleSort("creado_por")} style={{ cursor: "pointer", userSelect: "none" }}>
                  Creado por <SortIcon col="creado_por" />
                </th>
                <th style={{ textAlign: "left" }}>Acción</th>
              </tr>
            </thead>
            <tbody>
              {dataOrdenada.length === 0 && (
                <tr>
                  <td colSpan="9" style={{ textAlign: "center", padding: "60px 0", color: "var(--text-muted)" }}>
                    No hay cotizaciones que coincidan con los filtros.
                  </td>
                </tr>
              )}
              {dataOrdenada.map((l) => {
                const email    = (l.creado_por || "").trim().toLowerCase();
                const nombre   = (usuariosMap[email] || "").trim();
                const fechaFmt = l.fecha
                  ? l.fecha.slice(0, 10).split("-").reverse().join("-")
                  : "—";
                const fechaAdjFmt = l.fecha_adjudicacion
                  ? l.fecha_adjudicacion.split("-").reverse().join("-")
                  : "—";
                const montoFmt = Number(l.total_con_iva)
                  ? `$${Number(l.total_con_iva).toLocaleString("es-CL")}`
                  : "—";

                return (
                  <tr key={l.id}>
                    <td style={{ color: "var(--text-muted)", fontSize: "12px" }}>{l.id}</td>
                    <td style={{ fontWeight: 600 }}>{l.id_licitacion || "—"}</td>
                    <td>{fechaFmt}</td>
                    <td>{fechaAdjFmt}</td>
                    <td style={{ textAlign: "left", fontVariantNumeric: "tabular-nums" }}>{montoFmt}</td>
                    <td>{l.comuna || "—"}</td>
                    <td>
                      <span className={estadoBadgeClass(l.estado)}>{l.estado || "—"}</span>
                    </td>
                    <td>{nombre || "Sin nombre"}</td>
                    <td style={{ textAlign: "left" }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-start", gap: "8px" }}>
                        {esAdmin && l.estado === "Pendiente Aprobación" && (
                          <button
                            type="button"
                            className="btn btn-sm btn-primary"
                            onClick={() => aprobarCotizacion(l.id)}
                          >
                            Aprobar
                          </button>
                        )}
                        {esAdmin && (
                          <button
                            type="button"
                            className="btn btn-sm btn-danger"
                            onClick={() => eliminarCotizacion(l.id)}
                          >
                            Eliminar
                          </button>
                        )}
                        <Link to={`/detalle/${l.id}`} className="table-link">
                          Ver detalle <ChevronRight size={13} />
                        </Link>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
