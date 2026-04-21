import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api";
import { Link } from "react-router-dom";
import * as XLSX from "xlsx";
import useAuth from "../hooks/useAuth";
import { ChevronDown, Download, ChevronRight } from "lucide-react";
import Toast from "../components/Toast";
import DateFilter from "../components/DateFilter";

export default function ListarLicitaciones() {
  const { user, rol, cargando } = useAuth();
  const [data, setData] = useState([]);
  const [usuariosMap, setUsuariosMap] = useState({});
  const [toast, setToast] = useState(null);

  // Filtros
  const [filtroFechaDesde,   setFiltroFechaDesde]   = useState("");
  const [filtroFechaHasta,   setFiltroFechaHasta]   = useState("");
  const [filtroAdjDesde,     setFiltroAdjDesde]     = useState("");
  const [filtroAdjHasta,     setFiltroAdjHasta]     = useState("");
  const [filtroIdLicitacion, setFiltroIdLicitacion] = useState("");
  const [filtroNumeroCot,    setFiltroNumeroCot]    = useState("");
  const [filtroMontoMin,     setFiltroMontoMin]     = useState("");
  const [filtroMontoMax,     setFiltroMontoMax]     = useState("");
  const [filtroComuna,       setFiltroComuna]       = useState("");
  const [filtroCreadores,    setFiltroCreadores]    = useState([]);
  const [filtroEstado,       setFiltroEstado]       = useState([]);

  const [openCreadores, setOpenCreadores] = useState(false);
  const [openEstados,   setOpenEstados]   = useState(false);

  // Orden
  const [sortCol, setSortCol] = useState("id");
  const [sortDir, setSortDir] = useState("desc");
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

  useEffect(() => {
    const onClickOutside = (e) => {
      if (creadoresRef.current && !creadoresRef.current.contains(e.target)) setOpenCreadores(false);
      if (estadosRef.current   && !estadosRef.current.contains(e.target))   setOpenEstados(false);
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  async function loadData() {
    if (cargando) return;

    try {
      const licitaciones = await api.get("/licitaciones");

      let rows = licitaciones || [];
      const rolNorm   = (rol ?? "").toString().trim().toLowerCase();
      const emailUser = (user?.email || "").trim().toLowerCase();

      if (rolNorm === "ventas" && emailUser)
        rows = rows.filter((l) => (l.creado_por || "").trim().toLowerCase() === emailUser);

      // Fecha de adjudicación = fecha de creación de la primera OC de cada cotización
      const ids = rows.map((l) => Number(l?.id)).filter((n) => Number.isFinite(n));
      const primeraOcMap = {};
      if (ids.length > 0) {
        try {
          const docsOc = await api.post("/licitaciones/documentos/filter", {
            filter: { licitacion_ids: ids, tipo: "orden_compra" },
            fields: "licitacion_id,fecha_oc,created_at",
          });
          (docsOc || []).forEach((d) => {
            const licId = Number(d?.licitacion_id || 0);
            if (!licId) return;
            const raw = d?.fecha_oc || d?.created_at;
            if (!raw) return;
            const iso = String(raw).slice(0, 10);
            if (!primeraOcMap[licId] || iso < primeraOcMap[licId]) {
              primeraOcMap[licId] = iso;
            }
          });
        } catch (errDocsOc) {
          console.error("Error cargando OCs para fecha adjudicación:", errDocsOc);
        }
      }
      rows = rows.map((l) => ({
        ...l,
        fecha_adjudicacion: primeraOcMap[Number(l.id)] || null,
      }));

      setData(rows);

      const emailsUnicos = Array.from(new Set(rows.map((l) => l.creado_por).filter(Boolean)));
      if (emailsUnicos.length === 0) { setUsuariosMap({}); return; }

      const perfiles = await api.post("/usuarios/profiles/by-emails", { emails: emailsUnicos });

      const mapa = {};
      (perfiles || []).forEach((p) => {
        const email = (p?.email || "").trim().toLowerCase();
        if (email) mapa[email] = (p?.nombre || "").trim();
      });
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
    "En espera","Adjudicada","Perdida","Desierta","Descartada","Pendiente Aprobación",
  ];

  const textoCreadores = useMemo(() => {
    if (filtroCreadores.length === 0) return "Todos";
    return filtroCreadores.map((e) => (usuariosMap[e] || "").trim() || "Sin nombre").join(", ");
  }, [filtroCreadores, usuariosMap]);

  const textoEstados = useMemo(() => {
    if (filtroEstado.length === 0) return "Todos";
    return filtroEstado.join(", ");
  }, [filtroEstado]);

  // ── Filtrado ──────────────────────────────────────────────────
  const dataFiltrada = data.filter((l) => {
    const email  = (l.creado_por || "").trim().toLowerCase();
    const fecha  = l.fecha ? l.fecha.slice(0, 10) : "";
    const idLic  = (l.id_licitacion || "").toString().trim().toLowerCase();
    const comuna = (l.comuna || "").toString().trim().toLowerCase();
    const numeroCot = String(l.id ?? "");
    const montoTotal = Number(l.total_con_iva) || 0;
    const montoMin = filtroMontoMin !== "" ? Number(filtroMontoMin) : null;
    const montoMax = filtroMontoMax !== "" ? Number(filtroMontoMax) : null;

    const fechaAdj = l.fecha_adjudicacion || "";

    return (
      (filtroFechaDesde   ? fecha >= filtroFechaDesde   : true) &&
      (filtroFechaHasta   ? fecha <= filtroFechaHasta   : true) &&
      (filtroAdjDesde     ? (fechaAdj && fechaAdj >= filtroAdjDesde) : true) &&
      (filtroAdjHasta     ? (fechaAdj && fechaAdj <= filtroAdjHasta) : true) &&
      (filtroIdLicitacion ? idLic.includes(filtroIdLicitacion.trim().toLowerCase()) : true) &&
      (filtroNumeroCot    ? numeroCot.includes(filtroNumeroCot.trim()) : true) &&
      (montoMin != null ? montoTotal >= montoMin : true) &&
      (montoMax != null ? montoTotal <= montoMax : true) &&
      (filtroComuna       ? comuna.includes(filtroComuna.trim().toLowerCase())      : true) &&
      (filtroCreadores.length > 0 ? filtroCreadores.includes(email)   : true) &&
      (filtroEstado.length   > 0 ? filtroEstado.includes(l.estado)    : true)
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

  // ── Resumen por vendedor ──────────────────────────────────────
  const resumenPorVendedor = useMemo(() => {
    const acc = new Map();
    dataFiltrada.forEach((l) => {
      const email = (l.creado_por || "").trim().toLowerCase();
      if (!email) return;
      acc.set(email, (acc.get(email) || 0) + 1);
    });
    return Array.from(acc.entries())
      .map(([email, count]) => ({
        email,
        nombre: (usuariosMap[email] || "").trim() || "Sin nombre",
        count,
      }))
      .sort((a, b) => b.count - a.count || a.nombre.localeCompare(b.nombre));
  }, [dataFiltrada, usuariosMap]);

  // ── Exportar ──────────────────────────────────────────────────
  function exportarXLSX() {
    if (dataFiltrada.length === 0) { alert("No hay datos para exportar."); return; }
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
  const esJefatura = ["jefe_ventas","jefe ventas","jefe-ventas","jefe de ventas"].includes(rolNorm);

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

  async function eliminarCotizacion(id) {
    if (!window.confirm("¿Estás seguro de que deseas eliminar esta cotización? Esta acción no se puede deshacer.")) return;

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
          <input type="number" className="input" placeholder="Mínimo"
            value={filtroMontoMin} onChange={(e) => setFiltroMontoMin(e.target.value)} />
        </div>

        <div className="filter-field">
          <label className="filter-label">Monto Total (máx)</label>
          <input type="number" className="input" placeholder="Máximo"
            value={filtroMontoMax} onChange={(e) => setFiltroMontoMax(e.target.value)} />
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
      </div>

      {/* Resumen por vendedor */}
      {(esAdmin || esJefatura) && resumenPorVendedor.length > 0 && (
        <div className="surface" style={{ marginBottom: "16px" }}>
          <div className="surface-header">
            <h3 className="surface-title">Actividad por vendedor</h3>
            <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>según filtros activos</span>
          </div>
          <div style={{
            padding: "14px 20px",
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))",
            gap: "8px",
          }}>
            {resumenPorVendedor.map((r) => (
              <div key={r.email} style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                padding: "8px 12px", borderRadius: "var(--radius)",
                border: "1px solid var(--border)", background: "var(--bg)",
                fontSize: "13px",
              }}>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.nombre}</span>
                <span style={{
                  marginLeft: "10px", background: "var(--primary-light)", color: "var(--primary-dark)",
                  borderRadius: "999px", padding: "2px 10px", fontWeight: 700, fontSize: "12px", flexShrink: 0,
                }}>{r.count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

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
