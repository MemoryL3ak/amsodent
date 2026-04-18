import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api";
import { Link } from "react-router-dom";
import useAuth from "../hooks/useAuth";
import Toast from "../components/Toast";
import ConfirmModal from "../components/ConfirmModal";
import Select from "react-select";
import DateFilter from "../components/DateFilter";
import { Upload, Eye, Trash2, ArrowUpDown, ArrowUp, ArrowDown, Calendar, FileCheck } from "lucide-react";

/* ============================================================
   Helpers
============================================================ */
function soloDigitos(str) {
  return (str ?? "").toString().replace(/[^\d]/g, "");
}
function formatearCL(str) {
  const digits = soloDigitos(str);
  if (!digits) return "";
  return Number(digits).toLocaleString("es-CL");
}
function parseMontoCL(str) {
  return Number(soloDigitos(str) || 0);
}

function normalizarNombreArchivo(value) {
  return (value ?? "")
    .toString()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_.-]+/g, "_");
}

function normalizarTexto(str) {
  return (str ?? "")
    .toString()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const DOC_TIPOS = {
  orden_compra: "Orden de Compra",
  guia_despacho: "Guía de Despacho",
  factura: "Factura",
};

const customSelectStyles = {
  control: (base, state) => ({
    ...base,
    minHeight: "36px",
    fontSize: "13px",
    fontFamily: "inherit",
    backgroundColor: state.isDisabled ? "#f3f4f6" : "white",
    borderColor: state.isFocused ? "#6366f1" : "#d1d5db",
    boxShadow: state.isFocused ? "0 0 0 1px #6366f1" : "none",
    "&:hover": { borderColor: "#6366f1" },
  }),
  option: (base, state) => ({
    ...base,
    fontSize: "13px",
    backgroundColor: state.isSelected
      ? "#6366f1"
      : state.isFocused
      ? "#eef2ff"
      : "white",
  }),
  menuPortal: (base) => ({ ...base, zIndex: 9999 }),
};

/* ============================================================
   Component
============================================================ */
export default function Trazabilidad() {
  const { user, rol, cargando } = useAuth();
  const [data, setData] = useState([]);
  const [documentosMap, setDocumentosMap] = useState({});
  const [usuariosMap, setUsuariosMap] = useState({});
  const [toast, setToast] = useState(null);
  const [loading, setLoading] = useState(true);

  // Filtros
  const [filtroId, setFiltroId] = useState("");
  const [filtroEntidad, setFiltroEntidad] = useState("");
  const [filtroVendedor, setFiltroVendedor] = useState("");
  const [filtroFechaDesde, setFiltroFechaDesde] = useState("");
  const [filtroFechaHasta, setFiltroFechaHasta] = useState("");
  // Cada flag: false = sin filtro, true = debe tener
  const [flagOc, setFlagOc] = useState(false);
  const [flagGuia, setFlagGuia] = useState(false);
  const [flagFactura, setFlagFactura] = useState(false);

  // Ordenamiento
  const [sortCol, setSortCol] = useState("id");
  const [sortDir, setSortDir] = useState("desc");

  // Hover de cadena con scope específico:
  // type: "cot" | "oc" | "guia" | "factura"
  const [hoverChain, setHoverChain] = useState(null);
  const clearHover = () => setHoverChain(null);

  // Upload factura state (per cotización)
  const [uploadingFor, setUploadingFor] = useState(null);
  const [facturaNumero, setFacturaNumero] = useState("");
  const [facturaFecha, setFacturaFecha] = useState("");
  const [facturaFile, setFacturaFile] = useState(null);
  const [facturaGuiaId, setFacturaGuiaId] = useState("");
  const [subiendoFactura, setSubiendoFactura] = useState(false);
  const fileInputRef = useRef(null);

  // Delete confirm
  const [confirmEliminar, setConfirmEliminar] = useState(null);

  const rolNorm = (rol ?? "").toString().trim().toLowerCase();
  const esAdmin = rolNorm === "admin";

  // Reload counter para forzar recargas desde subir/eliminar factura
  // Refresca solo los documentos de una cotización (sin tocar loading global)
  async function refrescarDocumentosLic(licId) {
    try {
      const docs = await api.post("/licitaciones/documentos/filter", {
        filter: { licitacion_ids: [licId] },
        fields: "*",
      });
      setDocumentosMap((prev) => ({ ...prev, [licId]: docs || [] }));
    } catch (err) {
      console.error("Error refrescando documentos:", err);
    }
  }

  /* ── Load data ────────────────────────────────────────────── */
  useEffect(() => {
    if (cargando) return;

    async function loadData() {
      setLoading(true);

      // Cotizaciones adjudicadas
      let rows;
      try {
        const licitaciones = await api.get("/licitaciones/with-fields?fields=id,id_licitacion,nombre,nombre_entidad,estado,fecha_adjudicada,total_con_iva,total_sin_iva,creado_por,comuna");
        rows = (licitaciones || []).filter((l) => l.estado === "Adjudicada");
      } catch (error) {
        console.error("Error cargando cotizaciones:", error);
        setLoading(false);
        return;
      }

      const rlNorm = (rol ?? "").toString().trim().toLowerCase();
      const emailUser = (user?.email || "").trim().toLowerCase();
      if (rlNorm === "ventas" && emailUser) {
        rows = rows.filter((l) => (l.creado_por || "").trim().toLowerCase() === emailUser);
      }

      setData(rows);

      // Cargar documentos de todas las cotizaciones adjudicadas
      const ids = rows.map((l) => l.id);
      if (ids.length > 0) {
        try {
          const docs = await api.post("/licitaciones/documentos/filter", {
            filter: { licitacion_ids: ids },
            fields: "*",
          });

          const map = {};
          (docs || []).forEach((d) => {
            if (!map[d.licitacion_id]) map[d.licitacion_id] = [];
            map[d.licitacion_id].push(d);
          });
          setDocumentosMap(map);
        } catch (errDocs) {
          console.error("Error cargando documentos:", errDocs);
        }
      } else {
        setDocumentosMap({});
      }

      // Cargar nombres de usuarios
      const emailsUnicos = Array.from(new Set(rows.map((l) => l.creado_por).filter(Boolean)));
      if (emailsUnicos.length > 0) {
        try {
          const perfiles = await api.post("/usuarios/profiles/by-emails", { emails: emailsUnicos });

          const mapa = {};
          (perfiles || []).forEach((p) => {
            const email = (p?.email || "").trim().toLowerCase();
            if (email) mapa[email] = (p?.nombre || "").trim();
          });
          setUsuariosMap(mapa);
        } catch (errPerfiles) {
          console.error("Error cargando perfiles:", errPerfiles);
        }
      }

      setLoading(false);
    }

    loadData();
  }, [cargando, rol, user?.email]);

  /* ── Filtrado ──────────────────────────────────────────────── */
  const dataFiltrada = useMemo(() => {
    return data.filter((l) => {
      const id = (l.id_licitacion || "").toString().toLowerCase();
      const entidad = (l.nombre_entidad || "").toString().toLowerCase();
      const emailCreador = (l.creado_por || "").trim().toLowerCase();
      const nombreCreador = (usuariosMap[emailCreador] || "").toLowerCase();

      const matchesText =
        (!filtroId || id.includes(filtroId.toLowerCase()) || String(l.id).includes(filtroId)) &&
        (!filtroEntidad || entidad.includes(filtroEntidad.toLowerCase())) &&
        (!filtroVendedor || nombreCreador.includes(filtroVendedor.toLowerCase()) || emailCreador.includes(filtroVendedor.toLowerCase()));
      if (!matchesText) return false;

      // Filtro de fecha (sobre fecha_adjudicada)
      if (filtroFechaDesde || filtroFechaHasta) {
        const fechaRef = l.fecha_adjudicada ? l.fecha_adjudicada.toString().slice(0, 10) : "";
        if (!fechaRef) return false;
        if (filtroFechaDesde && fechaRef < filtroFechaDesde) return false;
        if (filtroFechaHasta && fechaRef > filtroFechaHasta) return false;
      }

      // Filtros por flags (OC / Guía / Factura) — true = debe tener
      const docs = documentosMap[l.id] || [];
      const tieneOC = docs.some((d) => d.tipo === "orden_compra");
      const tieneGuia = docs.some((d) => d.tipo === "guia_despacho");
      const tieneFactura = docs.some((d) => d.tipo === "factura");

      if (flagOc && !tieneOC) return false;
      if (flagGuia && !tieneGuia) return false;
      if (flagFactura && !tieneFactura) return false;

      return true;
    });
  }, [data, filtroId, filtroEntidad, filtroVendedor, filtroFechaDesde, filtroFechaHasta, flagOc, flagGuia, flagFactura, usuariosMap, documentosMap]);

  /* ── Ordenamiento ──────────────────────────────────────────── */
  function toggleSort(col) {
    if (sortCol === col) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortCol(col);
      setSortDir("asc");
    }
  }

  function SortIcon({ col }) {
    if (sortCol !== col) return <ArrowUpDown size={12} className="text-gray-300" />;
    return sortDir === "asc"
      ? <ArrowUp size={12} className="text-indigo-500" />
      : <ArrowDown size={12} className="text-indigo-500" />;
  }

  const dataOrdenada = useMemo(() => {
    const rows = [...dataFiltrada];
    const dir = sortDir === "asc" ? 1 : -1;

    rows.sort((a, b) => {
      let va, vb;
      switch (sortCol) {
        case "id":
          return (a.id - b.id) * dir;
        case "id_licitacion":
          va = (a.id_licitacion || "").toLowerCase();
          vb = (b.id_licitacion || "").toLowerCase();
          return va.localeCompare(vb) * dir;
        case "entidad":
          va = (a.nombre_entidad || "").toLowerCase();
          vb = (b.nombre_entidad || "").toLowerCase();
          return va.localeCompare(vb) * dir;
        case "vendedor":
          va = (usuariosMap[(a.creado_por || "").trim().toLowerCase()] || "").toLowerCase();
          vb = (usuariosMap[(b.creado_por || "").trim().toLowerCase()] || "").toLowerCase();
          return va.localeCompare(vb) * dir;
        case "monto":
          return ((a.total_con_iva || 0) - (b.total_con_iva || 0)) * dir;
        case "factura": {
          const fa = getFacturas(a.id).length;
          const fb = getFacturas(b.id).length;
          return (fa - fb) * dir;
        }
        default:
          return 0;
      }
    });
    return rows;
  }, [dataFiltrada, sortCol, sortDir, usuariosMap, documentosMap]);

  /* ── Docs helpers ──────────────────────────────────────────── */
  function getDocsForLic(licId) {
    return documentosMap[licId] || [];
  }

  function buildCycles(licId) {
    const docs = getDocsForLic(licId);
    const ocs = docs.filter((d) => d.tipo === "orden_compra");
    const guias = docs.filter((d) => d.tipo === "guia_despacho");
    const facturas = docs.filter((d) => d.tipo === "factura");

    const cycles = [];

    // Para cada OC (con índice de grupo), busca guías derivadas, y para cada guía las facturas
    ocs.forEach((oc, ocIdx) => {
      const ocGroup = ocIdx; // índice del grupo de OC
      const guiasDeOc = guias.filter((g) => g.deriva_de_id === oc.id);
      if (guiasDeOc.length === 0) {
        const facturasDeOc = facturas.filter((f) => f.deriva_de_id === oc.id);
        if (facturasDeOc.length === 0) {
          cycles.push({ oc, guia: null, factura: null, ocGroup });
        } else {
          facturasDeOc.forEach((f) => cycles.push({ oc, guia: null, factura: f, ocGroup }));
        }
      } else {
        guiasDeOc.forEach((g) => {
          const facturasDeGuia = facturas.filter((f) => f.deriva_de_id === g.id);
          if (facturasDeGuia.length === 0) {
            cycles.push({ oc, guia: g, factura: null, ocGroup });
          } else {
            facturasDeGuia.forEach((f) => cycles.push({ oc, guia: g, factura: f, ocGroup }));
          }
        });
      }
    });

    // Guías huérfanas (sin OC asociada)
    let huerfanoGroup = ocs.length;
    const guiasUsadas = new Set(cycles.map((c) => c.guia?.id).filter(Boolean));
    for (const g of guias) {
      if (guiasUsadas.has(g.id)) continue;
      const facturasDeGuia = facturas.filter((f) => f.deriva_de_id === g.id);
      if (facturasDeGuia.length === 0) {
        cycles.push({ oc: null, guia: g, factura: null, ocGroup: huerfanoGroup });
      } else {
        facturasDeGuia.forEach((f) => cycles.push({ oc: null, guia: g, factura: f, ocGroup: huerfanoGroup }));
      }
      huerfanoGroup++;
    }

    // Facturas huérfanas (sin guía ni OC)
    const facturasUsadas = new Set(cycles.map((c) => c.factura?.id).filter(Boolean));
    for (const f of facturas) {
      if (facturasUsadas.has(f.id)) continue;
      cycles.push({ oc: null, guia: null, factura: f, ocGroup: huerfanoGroup++ });
    }

    if (cycles.length === 0) cycles.push({ oc: null, guia: null, factura: null, ocGroup: 0 });

    // Marcar metadata + rowSpan para fusionar celdas (OC y Guía)
    cycles.forEach((c, i) => {
      const ocKey = c.oc?.id ?? `null-${i}`;
      const guiaKey = c.guia?.id ?? `null-${i}`;
      c.ocKey = ocKey;
      c.guiaKey = guiaKey;
    });

    // Calcular spans
    const ocCounts = {};
    const guiaCounts = {};
    cycles.forEach((c) => {
      ocCounts[c.ocKey] = (ocCounts[c.ocKey] || 0) + 1;
      guiaCounts[c.guiaKey] = (guiaCounts[c.guiaKey] || 0) + 1;
    });

    // Asignar índice de grupo de guía (0, 1, 2…) para alternar colores de fondo
    let guiaGroupIdx = -1;
    let prevGuiaKeyForGroup = null;
    cycles.forEach((c) => {
      if (c.guiaKey !== prevGuiaKeyForGroup) {
        guiaGroupIdx++;
        prevGuiaKeyForGroup = c.guiaKey;
      }
      c.guiaGroupIdx = guiaGroupIdx;
    });

    let prevOcKey = null;
    let prevGuiaKey = null;
    cycles.forEach((c, i) => {
      c.firstOfOc = c.ocKey !== prevOcKey;
      c.firstOfGuia = c.guiaKey !== prevGuiaKey;
      c.ocSpan = c.firstOfOc ? ocCounts[c.ocKey] : 0;
      c.guiaSpan = c.firstOfGuia ? guiaCounts[c.guiaKey] : 0;
      c.cycleIdx = i;
      prevOcKey = c.ocKey;
      prevGuiaKey = c.guiaKey;
    });

    return cycles;
  }

  // Tonos alternados de verde para cada grupo de guía dentro de la columna factura
  const FACTURA_BG_TONOS = ["#f0fdf4", "#dcfce7"];

  // Colores suaves para alternar grupos de OC dentro de la misma cotización
  const OC_GROUP_COLORS = [
    "#ffffff",
    "#fafbff",
  ];

  function cicloEstado(cycle) {
    const { oc, guia, factura } = cycle;
    if (oc && guia && factura) return "completo";
    if (oc && guia && !factura) return "falta_factura";
    if (oc && !guia && !factura) return "solo_oc";
    if (!oc && !guia && !factura) return "vacio";
    return "parcial";
  }

  const ESTADO_BG = {
    completo: "#f0fdf4",
    falta_factura: "#fefce8",
    solo_oc: "#eff6ff",
    parcial: "#fafafa",
    vacio: "#ffffff",
  };

  function getOrdenes(licId) {
    return getDocsForLic(licId).filter((d) => d.tipo === "orden_compra");
  }
  function getGuias(licId) {
    return getDocsForLic(licId).filter((d) => d.tipo === "guia_despacho");
  }
  function getFacturas(licId) {
    return getDocsForLic(licId).filter((d) => d.tipo === "factura");
  }

  /* ── Open doc ──────────────────────────────────────────────── */
  async function abrirDocumento(doc) {
    if (!doc?.bucket || !doc?.storage_path) return;
    try {
      const data = await api.get(`/licitaciones/storage/signed-url?bucket=${encodeURIComponent(doc.bucket)}&path=${encodeURIComponent(doc.storage_path)}`);

      if (!data?.signedUrl) {
        setToast({ type: "error", message: "No se pudo abrir el documento." });
        return;
      }
      window.open(data.signedUrl, "_blank", "noopener,noreferrer");
    } catch (error) {
      setToast({ type: "error", message: "No se pudo abrir el documento." });
    }
  }

  /* ── Upload factura ────────────────────────────────────────── */
  function iniciarUploadFactura(licId) {
    setUploadingFor(licId);
    setFacturaNumero("");
    setFacturaFecha(new Date().toISOString().slice(0, 10));
    setFacturaFile(null);
    setFacturaGuiaId("");
  }

  function cancelarUploadFactura() {
    setUploadingFor(null);
    setFacturaNumero("");
    setFacturaFecha("");
    setFacturaFile(null);
    setFacturaGuiaId("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function subirFactura() {
    if (subiendoFactura || !uploadingFor) return;
    setToast(null);

    const file = facturaFile;
    if (!file) {
      setToast({ type: "error", message: "Debes seleccionar un PDF." });
      return;
    }

    const esPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
    if (!esPdf) {
      setToast({ type: "error", message: "Solo se permite subir archivos PDF." });
      return;
    }

    // Guía es opcional – si la seleccionan, validamos que sea válida
    if (facturaGuiaId) {
      const guias = getGuias(uploadingFor);
      const docOrigen = guias.find((d) => String(d.id) === String(facturaGuiaId));
      if (!docOrigen || docOrigen.tipo !== "guia_despacho") {
        setToast({ type: "error", message: "La guía de despacho seleccionada no es válida." });
        return;
      }
    }

    setSubiendoFactura(true);

    try {
      const ext = (file.name.split(".").pop() || "pdf").toLowerCase();
      const safeName = normalizarNombreArchivo(file.name.replace(/\.[^.]+$/, ""));
      const fileName = `${Date.now()}-${Math.random().toString(36).slice(2)}-${safeName}.${ext}`;
      const storagePath = `${uploadingFor}/${fileName}`;

      const formData = new FormData();
      formData.append("file", file);
      await api.postForm(`/licitaciones/storage/upload?bucket=factura&path=${encodeURIComponent(storagePath)}`, formData);

      const payload = {
        licitacion_id: Number(uploadingFor),
        tipo: "factura",
        numero: (facturaNumero || "").trim() || null,
        monto: null,
        fecha_oc: null,
        fecha_factura: facturaFecha || null,
        deriva_de_id: facturaGuiaId ? Number(facturaGuiaId) : null,
        bucket: "factura",
        storage_path: storagePath,
        file_name: file.name,
        mime_type: file.type || "application/pdf",
        size_bytes: Number(file.size || 0),
      };

      try {
        await api.post("/licitaciones/documentos", payload);
      } catch (insErr) {
        await api.delete(`/licitaciones/storage/file?bucket=factura&path=${encodeURIComponent(storagePath)}`);
        throw insErr;
      }

      setToast({ type: "success", message: "Factura cargada correctamente." });
      const licIdActual = uploadingFor;
      cancelarUploadFactura();
      await refrescarDocumentosLic(licIdActual);
    } catch (e) {
      console.error("Error subiendo factura:", e);
      const detalle = [e?.code, e?.message].filter(Boolean).join(" - ");
      setToast({
        type: "error",
        message: detalle ? `No se pudo cargar la factura. ${detalle}` : "No se pudo cargar la factura.",
      });
    } finally {
      setSubiendoFactura(false);
    }
  }

  /* ── Delete factura ────────────────────────────────────────── */
  async function eliminarFactura(doc) {
    if (!doc?.id) return;
    setToast(null);

    try {
      await api.delete(`/licitaciones/documentos/${doc.id}`);
    } catch (errDb) {
      setToast({ type: "error", message: "No se pudo eliminar la factura." });
      return;
    }

    if (doc.bucket && doc.storage_path) {
      try {
        await api.delete(`/licitaciones/storage/file?bucket=${encodeURIComponent(doc.bucket)}&path=${encodeURIComponent(doc.storage_path)}`);
      } catch (e) {
        console.error("Error eliminando archivo de storage:", e);
      }
    }

    setToast({ type: "success", message: "Factura eliminada." });
    await refrescarDocumentosLic(doc.licitacion_id);
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

  if (loading) {
    return (
      <div className="page">
        <div className="page-header">
          <h1 className="page-title">Trazabilidad</h1>
        </div>
        <p className="text-gray-500 text-sm mt-4">Cargando...</p>
      </div>
    );
  }

  return (
    <div className="page">
      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}

      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Trazabilidad de Facturación</h1>
          <p className="page-subtitle">
            {dataFiltrada.length} cotización{dataFiltrada.length !== 1 ? "es" : ""} adjudicada{dataFiltrada.length !== 1 ? "s" : ""}
          </p>
        </div>
      </div>

      {/* Stats */}
      <div className="stats-row">
        <div className="stat-card">
          <div className="stat-label">Adjudicadas</div>
          <div className="stat-value">{dataFiltrada.length}</div>
          <div className="stat-sub">cotizaciones</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Con Factura</div>
          <div className="stat-value" style={{ color: "var(--success)" }}>
            {dataFiltrada.filter((l) => getFacturas(l.id).length > 0).length}
          </div>
          <div className="stat-sub">facturadas</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Sin Factura</div>
          <div className="stat-value" style={{ color: "var(--warning)" }}>
            {dataFiltrada.filter((l) => getFacturas(l.id).length === 0).length}
          </div>
          <div className="stat-sub">pendientes</div>
        </div>
      </div>

      {/* Filtros unificados — 2 filas */}
      <div
        style={{
          marginTop: 4,
          marginBottom: 20,
          padding: "18px 24px",
          backgroundColor: "#ffffff",
          border: "1px solid var(--border, #e5e7eb)",
          borderRadius: "10px",
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        {/* Fila 1: búsquedas de texto */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr",
            gap: 18,
          }}
        >
          <div>
            <label className="filter-label">ID Cotización</label>
            <input
              type="text"
              className="input"
              placeholder="Buscar ID..."
              value={filtroId}
              onChange={(e) => setFiltroId(e.target.value)}
              style={{ width: "100%" }}
            />
          </div>
          <div>
            <label className="filter-label">Entidad / Cliente</label>
            <input
              type="text"
              className="input"
              placeholder="Buscar entidad..."
              value={filtroEntidad}
              onChange={(e) => setFiltroEntidad(e.target.value)}
              style={{ width: "100%" }}
            />
          </div>
          <div>
            <label className="filter-label">Vendedor</label>
            <input
              type="text"
              className="input"
              placeholder="Buscar vendedor..."
              value={filtroVendedor}
              onChange={(e) => setFiltroVendedor(e.target.value)}
              style={{ width: "100%" }}
            />
          </div>
        </div>

        {/* Separador sutil */}
        <div style={{ height: 1, backgroundColor: "#f1f5f9" }} />

        {/* Fila 2: período + flags + limpiar (mismo grid 3 columnas) */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr",
            gap: 18,
            alignItems: "end",
          }}
        >
          <div>
            <label className="filter-label">Período de adjudicación</label>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <DateFilter
                value={filtroFechaDesde}
                onChange={setFiltroFechaDesde}
                placeholder="Desde"
              />
              <span style={{ color: "var(--text-muted)", fontSize: 13 }}>→</span>
              <DateFilter
                value={filtroFechaHasta}
                onChange={setFiltroFechaHasta}
                placeholder="Hasta"
                minDate={filtroFechaDesde ? new Date(`${filtroFechaDesde}T00:00:00`) : null}
              />
            </div>
          </div>

          <div>
            <label className="filter-label">Filtrar por documentos</label>
            <div style={{ display: "flex", gap: 6 }}>
              {[
                { label: "Orden de Compra", value: flagOc, set: setFlagOc, color: "#1d4ed8", bg: "#dbeafe" },
                { label: "Guía", value: flagGuia, set: setFlagGuia, color: "#b45309", bg: "#fef3c7" },
                { label: "Factura", value: flagFactura, set: setFlagFactura, color: "#15803d", bg: "#dcfce7" },
              ].map(({ label, value, set, color, bg }) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => set(!value)}
                  style={{
                    flex: 1,
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                    padding: "8px 10px",
                    borderRadius: "6px",
                    border: value ? `1.5px solid ${color}` : "1px solid #d1d5db",
                    backgroundColor: value ? bg : "#ffffff",
                    color: value ? color : "#64748b",
                    fontSize: "12px",
                    fontWeight: 600,
                    cursor: "pointer",
                    transition: "all 0.15s ease",
                    justifyContent: "center",
                    height: 36,
                  }}
                >
                  {value && <span style={{ fontSize: 11, lineHeight: 1 }}>✓</span>}
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "end" }}>
            {(filtroId || filtroEntidad || filtroVendedor || filtroFechaDesde || filtroFechaHasta || flagOc || flagGuia || flagFactura) ? (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                style={{ height: 36, whiteSpace: "nowrap" }}
                onClick={() => {
                  setFiltroId("");
                  setFiltroEntidad("");
                  setFiltroVendedor("");
                  setFiltroFechaDesde("");
                  setFiltroFechaHasta("");
                  setFlagOc(false);
                  setFlagGuia(false);
                  setFlagFactura(false);
                }}
              >
                Limpiar filtros
              </button>
            ) : (
              <div style={{ height: 36 }} />
            )}
          </div>
        </div>
      </div>

      {/* Table */}
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
                <th
                  onClick={() => toggleSort("entidad")}
                  style={{ cursor: "pointer", userSelect: "none", width: "32%", textAlign: "left" }}
                >
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                    Cotización / Cliente <SortIcon col="entidad" />
                  </span>
                </th>
                <th
                  onClick={() => toggleSort("monto")}
                  style={{ cursor: "pointer", userSelect: "none", textAlign: "right", width: "10%" }}
                >
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4, justifyContent: "flex-end" }}>
                    Monto <SortIcon col="monto" />
                  </span>
                </th>
                <th style={{ width: "15%", textAlign: "left" }}>Orden de Compra</th>
                <th style={{ width: "15%", textAlign: "left" }}>Guía Despacho</th>
                <th style={{ width: "15%", textAlign: "left" }}>Factura</th>
                <th style={{ textAlign: "right", width: "13%" }}>Acción</th>
              </tr>
            </thead>
            <tbody>
              {dataFiltrada.length === 0 ? (
                <tr>
                  <td colSpan="6" style={{ textAlign: "center", padding: "60px 0", color: "var(--text-muted)" }}>
                    No hay cotizaciones adjudicadas que coincidan con los filtros.
                  </td>
                </tr>
              ) : (
                dataOrdenada.flatMap((lic) => {
                  const cycles = buildCycles(lic.id);
                  const guias = getGuias(lic.id);
                  const emailCreador = (lic.creado_por || "").trim().toLowerCase();
                  const nombreCreador = usuariosMap[emailCreador] || emailCreador;

                  return cycles.map((cycle, idx) => {
                    const isFirstRow = idx === 0;
                    const { oc, guia, factura, firstOfOc, firstOfGuia, ocSpan, guiaSpan } = cycle;

                    const hoverBg = "#f0fdfd";
                    const sameLic = hoverChain?.licId === lic.id;

                    // Una celda se ilumina si pertenece a la cadena activa.
                    // Reglas según el TIPO de hover:
                    //  - "cot": resalta toda la cotización
                    //  - "oc": resalta esa OC + sus guías + sus facturas
                    //  - "guia": resalta esa guía + parent OC + sus facturas
                    //  - "factura": resalta esa factura + parent guía + parent OC
                    let hoverCotizacion = false, hoverOc = false, hoverGuia = false, hoverFactura = false;
                    if (sameLic) {
                      hoverCotizacion = true;
                      const t = hoverChain.type;
                      if (t === "cot") {
                        hoverOc = true; hoverGuia = true; hoverFactura = true;
                      } else if (t === "oc") {
                        hoverOc = hoverChain.ocKey === cycle.ocKey;
                        hoverGuia = hoverOc;     // todas las guías del OC
                        hoverFactura = hoverOc;  // todas las facturas del OC
                      } else if (t === "guia") {
                        hoverOc = hoverChain.ocKey === cycle.ocKey;
                        hoverGuia = hoverChain.guiaKey === cycle.guiaKey;
                        hoverFactura = hoverGuia; // todas las facturas de la guía
                      } else if (t === "factura") {
                        hoverOc = hoverChain.ocKey === cycle.ocKey;
                        hoverGuia = hoverChain.guiaKey === cycle.guiaKey;
                        hoverFactura = hoverChain.idx === idx; // solo esa factura
                      }
                    }

                    return (
                      <tr
                        key={`${lic.id}-${idx}`}
                        style={{
                          borderTop: isFirstRow ? "1px solid #e5e7eb" : undefined,
                        }}
                      >
                        {/* Cotización + Cliente + Vendedor combinados */}
                        {isFirstRow && (
                          <td
                            rowSpan={cycles.length}
                            onMouseEnter={() => setHoverChain({ type: "cot", licId: lic.id })}
                            onMouseLeave={clearHover}
                            style={{ verticalAlign: "middle", backgroundColor: hoverCotizacion ? hoverBg : undefined }}
                          >
                            <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                              <div
                                style={{
                                  flexShrink: 0,
                                  width: 36,
                                  height: 36,
                                  borderRadius: "50%",
                                  background: "linear-gradient(135deg, #28aeb1, #1e8a8d)",
                                  color: "white",
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  fontWeight: 600,
                                  fontSize: "13px",
                                }}
                                title={nombreCreador}
                              >
                                {(nombreCreador || "?").charAt(0).toUpperCase()}
                              </div>
                              <div style={{ minWidth: 0, flex: 1 }}>
                                <Link
                                  to={`/detalle/${lic.id}`}
                                  className="table-link"
                                  style={{ fontWeight: 600, fontSize: "13px" }}
                                >
                                  #{lic.id}
                                </Link>
                                {lic.id_licitacion && (
                                  <span style={{ color: "var(--text-muted)", fontSize: "11px", marginLeft: 6 }}>
                                    {lic.id_licitacion}
                                  </span>
                                )}
                                <div style={{ fontWeight: 500, fontSize: "13px", marginTop: 1, color: "#1f2937" }}>
                                  {lic.nombre_entidad || "—"}
                                </div>
                                <div style={{ color: "var(--text-muted)", fontSize: "11px", marginTop: 1 }}>
                                  {lic.comuna && <span>{lic.comuna}</span>}
                                  {lic.comuna && nombreCreador && <span> · </span>}
                                  {nombreCreador && <span>{nombreCreador}</span>}
                                  {cycles.length > 1 && <span> · {cycles.length} ciclos</span>}
                                </div>
                              </div>
                            </div>
                          </td>
                        )}

                        {/* Monto */}
                        {isFirstRow && (
                          <td
                            rowSpan={cycles.length}
                            onMouseEnter={() => setHoverChain({ type: "cot", licId: lic.id })}
                            onMouseLeave={clearHover}
                            style={{ verticalAlign: "middle", textAlign: "right", fontWeight: 600, whiteSpace: "nowrap", fontSize: "13px", backgroundColor: hoverCotizacion ? hoverBg : undefined }}
                          >
                            {lic.total_con_iva
                              ? `$${Number(lic.total_con_iva).toLocaleString("es-CL")}`
                              : "—"}
                          </td>
                        )}

                        {/* Orden de Compra */}
                        {firstOfOc && (
                          <td
                            rowSpan={ocSpan}
                            onMouseEnter={() => setHoverChain({ type: "oc", licId: lic.id, ocKey: cycle.ocKey })}
                            onMouseLeave={clearHover}
                            style={{
                              verticalAlign: "middle",
                              borderLeft: "1px solid #e5e7eb",
                              backgroundColor: hoverOc ? hoverBg : undefined,
                            }}
                          >
                            {oc ? (
                              <div>
                                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                  <span style={{ fontWeight: 500, color: "#1f2937" }}>{oc.numero || "S/N"}</span>
                                  <button
                                    type="button"
                                    onClick={() => abrirDocumento(oc)}
                                    style={{ background: "none", border: "none", cursor: "pointer", color: "var(--primary)", padding: 0 }}
                                    title="Ver PDF"
                                  >
                                    <Eye size={13} />
                                  </button>
                                </div>
                                <div style={{ color: "var(--text-muted)", fontSize: "11px" }}>
                                  {oc.fecha_oc
                                    ? new Date(`${oc.fecha_oc}T00:00:00`).toLocaleDateString("es-CL")
                                    : <span style={{ fontStyle: "italic", color: "#cbd5e1" }}>Sin fecha</span>}
                                </div>
                              </div>
                            ) : (
                              <span style={{ color: "var(--text-muted)" }}>—</span>
                            )}
                          </td>
                        )}

                        {/* Guía de Despacho */}
                        {firstOfGuia && (
                          <td
                            rowSpan={guiaSpan}
                            onMouseEnter={() => setHoverChain({ type: "guia", licId: lic.id, ocKey: cycle.ocKey, guiaKey: cycle.guiaKey })}
                            onMouseLeave={clearHover}
                            style={{
                              verticalAlign: "middle",
                              borderLeft: "1px solid #e5e7eb",
                              backgroundColor: hoverGuia ? hoverBg : undefined,
                            }}
                          >
                            {guia ? (
                              <div>
                                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                  <span style={{ fontWeight: 500, color: "#1f2937" }}>{guia.numero || "S/N"}</span>
                                  <button
                                    type="button"
                                    onClick={() => abrirDocumento(guia)}
                                    style={{ background: "none", border: "none", cursor: "pointer", color: "var(--primary)", padding: 0 }}
                                    title="Ver PDF"
                                  >
                                    <Eye size={13} />
                                  </button>
                                </div>
                                <div style={{ color: "var(--text-muted)", fontSize: "11px" }}>
                                  {guia.created_at ? new Date(guia.created_at).toLocaleDateString("es-CL") : ""}
                                </div>
                              </div>
                            ) : (
                              <span style={{ color: "var(--text-muted)" }}>—</span>
                            )}
                          </td>
                        )}

                        {/* Factura */}
                        <td
                          onMouseEnter={() => setHoverChain({ type: "factura", licId: lic.id, ocKey: cycle.ocKey, guiaKey: cycle.guiaKey, idx })}
                          onMouseLeave={clearHover}
                          style={{
                            verticalAlign: "middle",
                            borderLeft: "1px solid #e5e7eb",
                            backgroundColor: hoverFactura ? hoverBg : undefined,
                          }}
                        >
                          {factura ? (
                            <div>
                              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                <span style={{ fontWeight: 500, color: "#1f2937" }}>{factura.numero || "S/N"}</span>
                                <button
                                  type="button"
                                  onClick={() => abrirDocumento(factura)}
                                  style={{ background: "none", border: "none", cursor: "pointer", color: "var(--primary)", padding: 0 }}
                                  title="Ver PDF"
                                >
                                  <Eye size={13} />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setConfirmEliminar(factura)}
                                  style={{ background: "none", border: "none", cursor: "pointer", color: "#ef4444", padding: 0 }}
                                  title="Eliminar"
                                >
                                  <Trash2 size={12} />
                                </button>
                              </div>
                              <div style={{ color: "var(--text-muted)", fontSize: "11px" }}>
                                {factura.fecha_factura
                                  ? new Date(`${factura.fecha_factura}T00:00:00`).toLocaleDateString("es-CL")
                                  : factura.created_at
                                  ? new Date(factura.created_at).toLocaleDateString("es-CL")
                                  : ""}
                              </div>
                            </div>
                          ) : (
                            <span className="badge badge-warning">Pendiente</span>
                          )}
                        </td>

                        {/* Acción - solo en la primera fila */}
                        {isFirstRow && (
                          <td
                            rowSpan={cycles.length}
                            onMouseEnter={() => setHoverChain({ type: "cot", licId: lic.id })}
                            onMouseLeave={clearHover}
                            style={{ verticalAlign: "middle", textAlign: "right", backgroundColor: hoverCotizacion ? hoverBg : undefined }}
                          >
                            {uploadingFor === lic.id ? (
                              <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 220, textAlign: "left" }}>
                                <input
                                  type="text"
                                  className="input"
                                  value={facturaNumero}
                                  onChange={(e) => setFacturaNumero(e.target.value)}
                                  placeholder="N° Factura"
                                  disabled={subiendoFactura}
                                />
                                <input
                                  type="date"
                                  className="input"
                                  value={facturaFecha}
                                  onChange={(e) => setFacturaFecha(e.target.value)}
                                  disabled={subiendoFactura}
                                />
                                {guias.length > 0 && (
                                  <Select
                                    options={guias.map((g) => ({
                                      value: String(g.id),
                                      label: `Guía${g.numero ? ` - ${g.numero}` : ""}`,
                                    }))}
                                    styles={customSelectStyles}
                                    placeholder="Guía (opcional)..."
                                    menuPortalTarget={document.body}
                                    isSearchable
                                    isClearable
                                    isDisabled={subiendoFactura}
                                    noOptionsMessage={() => "Sin guías"}
                                    value={
                                      guias
                                        .map((g) => ({
                                          value: String(g.id),
                                          label: `Guía${g.numero ? ` - ${g.numero}` : ""}`,
                                        }))
                                        .find((o) => o.value === String(facturaGuiaId)) || null
                                    }
                                    onChange={(op) => setFacturaGuiaId(op?.value || "")}
                                  />
                                )}
                                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                  <input
                                    ref={fileInputRef}
                                    type="file"
                                    accept="application/pdf,.pdf"
                                    style={{ display: "none" }}
                                    onChange={(e) => setFacturaFile(e.target.files?.[0] || null)}
                                    disabled={subiendoFactura}
                                  />
                                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => fileInputRef.current?.click()} disabled={subiendoFactura}>
                                    PDF
                                  </button>
                                  <span style={{ fontSize: "11px", color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 100 }}>
                                    {facturaFile ? facturaFile.name : "Sin archivo"}
                                  </span>
                                </div>
                                <div style={{ display: "flex", gap: 6 }}>
                                  <button type="button" onClick={subirFactura} disabled={subiendoFactura} className="btn btn-primary btn-sm">
                                    {subiendoFactura ? "Subiendo..." : "Guardar"}
                                  </button>
                                  <button type="button" onClick={cancelarUploadFactura} disabled={subiendoFactura} className="btn btn-secondary btn-sm">
                                    Cancelar
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={() => iniciarUploadFactura(lic.id)}
                                className="btn btn-primary btn-sm"
                              >
                                <Upload size={12} style={{ marginRight: 4 }} /> Factura
                              </button>
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  });
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Confirm delete modal */}
      <ConfirmModal
        open={!!confirmEliminar}
        title="Eliminar factura"
        message={`Vas a eliminar Factura${confirmEliminar?.numero ? ` (${confirmEliminar.numero})` : ""}${
          confirmEliminar?.file_name ? ` - ${confirmEliminar.file_name}` : ""
        }. Esta acción no se puede deshacer.`}
        onCancel={() => setConfirmEliminar(null)}
        onConfirm={async () => {
          const doc = confirmEliminar;
          setConfirmEliminar(null);
          await eliminarFactura(doc);
        }}
      />
    </div>
  );
}
