import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useStickyState } from "../lib/useStickyState";
import { api } from "../lib/api";
import { Link } from "react-router-dom";
import useAuth from "../hooks/useAuth";
import Toast from "../components/Toast";
import ConfirmModal from "../components/ConfirmModal";
import Select from "react-select";
import DateFilter from "../components/DateFilter";
import { calcularSLAGuiaDespacho, cargarFeriadosParaAnios } from "../utils/diasHabiles";

const SLA_GUIA_DIAS_HABILES = 3;

function hoyLocalISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Formatea fechas de DB (date o timestamptz) como dd-mm-yyyy sin pasar
// por `new Date()`, que mete shifts de timezone.
function formatearFechaCorta(fecha) {
  if (!fecha) return "";
  const s = String(fecha).slice(0, 10);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : s;
}

function SLABadge({ fechaOc }) {
  if (!fechaOc) return null;
  const sla = calcularSLAGuiaDespacho(fechaOc, hoyLocalISO(), SLA_GUIA_DIAS_HABILES);

  let bg = "#dcfce7";
  let color = "#15803d";
  let texto = `Quedan ${sla.diasRestantes} días háb.`;
  let titulo = `Vence el ${sla.vence}`;

  if (sla.estado === "vencido") {
    bg = "#fee2e2";
    color = "#b91c1c";
    const atraso = Math.abs(Number(sla.diasRestantes || 0));
    texto = atraso > 0 ? `Vencido hace ${atraso} días háb.` : "Vencido";
    titulo = `Vencía el ${sla.vence}`;
  } else if (sla.estado === "vence_hoy") {
    bg = "#fef3c7";
    color = "#b45309";
    texto = "Vence hoy";
  } else if (sla.estado === "por_vencer") {
    bg = "#fef3c7";
    color = "#b45309";
    texto = `Vence en ${sla.diasRestantes} día háb.`;
  }

  return (
    <span
      title={titulo}
      style={{
        display: "inline-block",
        marginTop: 4,
        padding: "2px 8px",
        fontSize: 10,
        fontWeight: 600,
        borderRadius: 999,
        backgroundColor: bg,
        color,
        whiteSpace: "nowrap",
      }}
    >
      {texto}
    </span>
  );
}
import { Upload, Eye, Trash2, ArrowUpDown, ArrowUp, ArrowDown, Calendar, FileCheck, ChevronDown, Truck, Download, Clock, CheckCircle2, Check, Pencil, X, AlertTriangle, Package } from "lucide-react";
import { SunflowerIcon } from "../components/DamarIAWidget";

// Mapping empresa courier → builder de URL de tracking. Si la empresa no
// tiene URL o no hay número, devuelve "" (no renderizamos el link).
const TRACKING_URL_BUILDER = {
  "Starken": (codigo) =>
    `https://www.starken.cl/seguimiento?codigo=${encodeURIComponent(codigo)}`,
  "Blue Express": (codigo) =>
    `https://www.blue.cl/seguimiento/?n_seguimiento=${encodeURIComponent(codigo)}`,
};

function buildTrackingUrl(empresa, nSeguimiento) {
  const codigo = String(nSeguimiento || "").trim();
  if (!codigo) return "";
  const builder = TRACKING_URL_BUILDER[String(empresa || "").trim()];
  return builder ? builder(codigo) : "";
}

// Contenido de la celda "Tracking Envío": empresa + N° seguimiento (link al
// courier si aplica). Sirve tanto para guía pública como para info de despacho.
function TrackingEnvioContenido({ empresa, nSeguimiento }) {
  const empresaTxt = String(empresa || "").trim();
  const cod = String(nSeguimiento || "").trim();
  if (!empresaTxt && !cod) return <span style={{ color: "var(--text-muted)" }}>—</span>;
  const url = buildTrackingUrl(empresaTxt, cod);
  return (
    <div>
      {empresaTxt && (
        <div style={{ color: "#1f2937", fontWeight: 500, fontSize: 12 }}>{empresaTxt}</div>
      )}
      {cod && (
        url ? (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => {
              if (navigator?.clipboard) navigator.clipboard.writeText(cod).catch(() => {});
            }}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              marginTop: 3,
              padding: "3px 8px",
              borderRadius: 6,
              backgroundColor: "#ea580c",
              color: "#fff",
              fontSize: 11,
              fontWeight: 600,
              textDecoration: "none",
              lineHeight: 1,
            }}
            title={`Abrir tracking ${empresaTxt} (${cod})`}
          >
            <Truck size={12} /> {cod}
          </a>
        ) : (
          <div style={{ color: "var(--text-muted)", fontSize: 11, marginTop: 2 }}>{cod}</div>
        )
      )}
    </div>
  );
}

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
/* ============================================================
   SELECTOR DE ESTADO DE ENTREGA (listbox personalizado)
============================================================ */
const ESTADOS_ENTREGA = [
  {
    valor: "Preparación",
    color: "#b45309",
    bg: "#fef3c7",
    borde: "#fcd34d",
    punto: "#f59e0b",
    icono: Clock,
  },
  {
    valor: "Entregado",
    color: "#15803d",
    bg: "#dcfce7",
    borde: "#86efac",
    punto: "#16a34a",
    icono: CheckCircle2,
  },
];

function SelectorEstadoEntrega({ valor, onCambiar }) {
  const [abierto, setAbierto] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 210 });
  const btnRef = useRef(null);
  const actual = ESTADOS_ENTREGA.find((e) => e.valor === valor) || ESTADOS_ENTREGA[0];

  function alternar() {
    if (abierto) {
      setAbierto(false);
      return;
    }
    const r = btnRef.current?.getBoundingClientRect();
    if (r) {
      const alto = 124;
      const arriba = r.bottom + alto + 12 > window.innerHeight;
      setPos({
        top: arriba ? r.top - alto - 6 : r.bottom + 6,
        left: r.left,
        width: Math.max(r.width, 190),
      });
    }
    setAbierto(true);
  }

  useEffect(() => {
    if (!abierto) return;
    const cerrar = () => setAbierto(false);
    window.addEventListener("scroll", cerrar, true);
    window.addEventListener("resize", cerrar);
    return () => {
      window.removeEventListener("scroll", cerrar, true);
      window.removeEventListener("resize", cerrar);
    };
  }, [abierto]);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={alternar}
        title="Estado de entrega"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          width: "100%",
          height: 34,
          padding: "0 12px",
          borderRadius: 9,
          border: "1.5px solid",
          borderColor: actual.borde,
          background: actual.bg,
          color: actual.color,
          fontSize: 12.5,
          fontWeight: 700,
          cursor: "pointer",
          transition: "all .14s ease",
        }}
      >
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: actual.punto, flexShrink: 0 }} />
        <span style={{ flex: 1, textAlign: "left", whiteSpace: "nowrap" }}>{actual.valor}</span>
        <ChevronDown
          size={14}
          style={{
            transform: abierto ? "rotate(180deg)" : "none",
            transition: "transform .15s ease",
            opacity: 0.65,
            flexShrink: 0,
          }}
        />
      </button>

      {abierto &&
        createPortal(
          <>
            <div
              onClick={() => setAbierto(false)}
              style={{ position: "fixed", inset: 0, zIndex: 9000 }}
            />
            <div
              style={{
                position: "fixed",
                top: pos.top,
                left: pos.left,
                width: pos.width,
                zIndex: 9001,
                background: "#fff",
                borderRadius: 12,
                border: "1px solid #e8edf2",
                boxShadow: "0 16px 38px -10px rgba(16,24,40,.36)",
                padding: 6,
                animation: "trz-menu-in .14s ease",
              }}
            >
              <style>{`
                @keyframes trz-menu-in { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: none; } }
                .trz-opt { transition: background .12s ease; }
                .trz-opt:hover { background: #f6f8fa; }
              `}</style>
              {ESTADOS_ENTREGA.map((e) => {
                const sel = e.valor === actual.valor;
                const IconoE = e.icono;
                return (
                  <button
                    key={e.valor}
                    type="button"
                    className="trz-opt"
                    onClick={() => {
                      setAbierto(false);
                      if (e.valor !== actual.valor) onCambiar(e.valor);
                    }}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      width: "100%",
                      padding: "8px 9px",
                      borderRadius: 9,
                      border: "none",
                      background: sel ? e.bg : "transparent",
                      cursor: "pointer",
                      fontSize: 13,
                      fontWeight: 700,
                      color: e.color,
                      textAlign: "left",
                    }}
                  >
                    <span
                      style={{
                        width: 30,
                        height: 30,
                        borderRadius: 9,
                        background: e.bg,
                        color: e.color,
                        border: `1px solid ${e.borde}`,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                      }}
                    >
                      <IconoE size={16} />
                    </span>
                    <span style={{ flex: 1 }}>{e.valor}</span>
                    {sel && <Check size={15} style={{ color: e.color }} />}
                  </button>
                );
              })}
            </div>
          </>,
          document.body,
        )}
    </>
  );
}

export default function Trazabilidad() {
  const { user, rol, cargando } = useAuth();
  const [data, setData] = useState([]);
  const [documentosMap, setDocumentosMap] = useState({});
  const [usuariosMap, setUsuariosMap] = useState({});
  const [toast, setToast] = useState(null);
  const [loading, setLoading] = useState(true);

  // Filtros — persistentes: se conservan al buscar una OC, entrar a un detalle
  // y volver atrás (no se pierden los filtros ni la búsqueda).
  const [filtroId, setFiltroId] = useStickyState("trazabilidad.filtroId", "");
  const [filtroEntidad, setFiltroEntidad] = useStickyState("trazabilidad.filtroEntidad", "");
  const [filtroVendedor, setFiltroVendedor] = useStickyState("trazabilidad.filtroVendedor", "");
  const [filtroOC, setFiltroOC] = useStickyState("trazabilidad.filtroOC", "");
  const [filtroFactura, setFiltroFactura] = useStickyState("trazabilidad.filtroFactura", "");
  const [filtroFechaDesde, setFiltroFechaDesde] = useStickyState("trazabilidad.fechaDesde", "");
  const [filtroFechaHasta, setFiltroFechaHasta] = useStickyState("trazabilidad.fechaHasta", "");
  const [filtroTipoCotizacion, setFiltroTipoCotizacion] = useStickyState("trazabilidad.tipoCotizacion", "");
  const [filtroTipoCompra, setFiltroTipoCompra] = useStickyState("trazabilidad.tipoCompra", []);
  // Estado de ciclo: preparacion | entregado | forzado (cierre forzado).
  const [filtroEstadoCiclo, setFiltroEstadoCiclo] = useStickyState("trazabilidad.estadoCiclo", "");
  const [openTipoCompra, setOpenTipoCompra] = useState(false);
  const [openDescargar, setOpenDescargar] = useState(false);
  // Filtro de documentos: match EXACTO. Sin selección → cotizaciones sin ningún
  // documento (OC/Guía/Factura). Con selección → cotizaciones cuyo conjunto de
  // documentos coincide exactamente con los flags activos.
  const [flagOc, setFlagOc] = useStickyState("trazabilidad.flagOc", false);
  const [flagGuia, setFlagGuia] = useStickyState("trazabilidad.flagGuia", false);
  const [flagFactura, setFlagFactura] = useStickyState("trazabilidad.flagFactura", false);

  // Ordenamiento
  const [sortCol, setSortCol] = useStickyState("trazabilidad.sortCol", "id");
  const [sortDir, setSortDir] = useStickyState("trazabilidad.sortDir", "desc");

  // Hover de cadena con scope específico:
  // type: "cot" | "oc" | "guia" | "factura"
  const [hoverChain, setHoverChain] = useState(null);
  const clearHover = () => setHoverChain(null);

  // Upload documento state (per cotización): factura o guía de despacho
  const [uploadingFor, setUploadingFor] = useState(null);
  const [docTipoUp, setDocTipoUp] = useState("factura"); // "factura" | "guia_despacho"
  // Productos despachados según la guía emitida en Bsale (modal):
  // { numero, ocNumero, cliente } | null.
  const [guiaBsale, setGuiaBsale] = useState(null);
  const [facturaNumero, setFacturaNumero] = useState("");
  const [facturaFecha, setFacturaFecha] = useState("");
  const [facturaMonto, setFacturaMonto] = useState(""); // monto NETO de la factura (solo dígitos)
  const [facturaFile, setFacturaFile] = useState(null);
  const [leyendoIA, setLeyendoIA] = useState(false); // lectura del PDF con IA
  const [facturaGuiaIds, setFacturaGuiaIds] = useState([]); // factura puede asociarse a varias guías
  const [guiaEmpresa, setGuiaEmpresa] = useState("Starken");
  const [guiaSeguimiento, setGuiaSeguimiento] = useState("");
  const [guiaOcId, setGuiaOcId] = useState("");
  const [subiendoFactura, setSubiendoFactura] = useState(false);
  const fileInputRef = useRef(null);
  const tipoCompraRef = useRef(null);

  // Delete confirm
  const [confirmEliminar, setConfirmEliminar] = useState(null);
  // Edición del monto neto de una factura ya cargada (para las que no lo tenían).
  const [editFactura, setEditFactura] = useState(null); // doc factura en edición
  const [editMonto, setEditMonto] = useState(""); // solo dígitos (monto neto)
  const [guardandoMonto, setGuardandoMonto] = useState(false);

  useEffect(() => {
    const onClickOutside = (e) => {
      if (tipoCompraRef.current && !tipoCompraRef.current.contains(e.target)) {
        setOpenTipoCompra(false);
      }
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  useEffect(() => {
    const yearActual = new Date().getFullYear();
    cargarFeriadosParaAnios([yearActual, yearActual + 1]);
  }, []);

  const opcionesTipoCompra = [
    "Compra ágil",
    "Compra directa",
    "Licitación 0 a 8 meses",
    "Licitación 9 a 24 meses",
    "Cliente particular",
  ];

  const textoTipoCompra = useMemo(() => {
    if (filtroTipoCompra.length === 0) return "Todos";
    return filtroTipoCompra.join(", ");
  }, [filtroTipoCompra]);

  // Tipos de cotización presentes en los datos (tipo_cliente).
  const opcionesTipoCotizacion = useMemo(() => {
    const set = new Set();
    data.forEach((l) => {
      const t = (l?.tipo_cliente || "").toString().trim();
      if (t) set.add(t);
    });
    return [...set].sort();
  }, [data]);

  // Cuando el Tipo de Cotización seleccionado es Cliente Particular, ocultamos
  // las columnas Orden de Compra y Guía de Despacho — ese flujo no las usa
  // (solo factura/boleta). Se basa en el tipo de cotización, no en el de compra.
  const esSoloClienteParticular =
    (filtroTipoCotizacion || "").toLowerCase().includes("particular");

  // Cliente Particular seleccionado en el filtro "Tipo de Compra": en ese flujo
  // el documento es "Factura / Boleta". Mostramos el filtro por N° de
  // Factura/Boleta y ocultamos el de N° Factura estándar.
  const esCompraParticular = (filtroTipoCompra || []).some((t) =>
    (t || "").toLowerCase().includes("particular"),
  );
  // El filtro de número pasa a "N° Factura / Boleta" cuando se está en el flujo
  // de cliente particular, ya sea por Tipo de Cotización o por Tipo de Compra.
  const mostrarFacturaBoleta = esSoloClienteParticular || esCompraParticular;

  const rolNorm = (rol ?? "").toString().trim().toLowerCase();
  const esAdmin = rolNorm === "admin";
  const esVentas = rolNorm === "ventas";
  const puedeVerTrazabilidad =
    esAdmin ||
    esVentas ||
    rolNorm === "jefe_ventas" ||
    rolNorm === "jefe_ventas_especial" ||
    rolNorm === "contabilidad";
  // ventas: acceso solo de visualización (no puede cambiar estado de entrega,
  // cerrar ciclo, ni subir/eliminar documentos).
  const soloLectura = esVentas;

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
        const licitaciones = await api.get("/licitaciones/with-fields?fields=id,id_licitacion,nombre,nombre_entidad,estado,fecha_adjudicada,total_con_iva,total_sin_iva,creado_por,comuna,tipo_compra,tipo_cliente,estado_entrega,ciclo_cerrado,monto_forzado");
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

      // Filtro por tipo de cotización (tipo_cliente; vacío = todas)
      if (filtroTipoCotizacion && (l.tipo_cliente || "").toString().trim() !== filtroTipoCotizacion) {
        return false;
      }

      // Filtro por tipo de compra (multi-select; vacío = todos)
      if (filtroTipoCompra.length > 0) {
        const tipoRow = (l.tipo_compra || "").toString().trim();
        if (!filtroTipoCompra.includes(tipoRow)) return false;
      }

      // Filtro por estado de ciclo (preparación / entregado / cierre forzado)
      if (filtroEstadoCiclo) {
        const cerrado = !!l.ciclo_cerrado;
        const entrega = (l.estado_entrega || "Preparación").toString();
        if (filtroEstadoCiclo === "forzado" && !cerrado) return false;
        if (filtroEstadoCiclo === "entregado" && (cerrado || entrega !== "Entregado")) return false;
        if (filtroEstadoCiclo === "preparacion" && (cerrado || entrega === "Entregado")) return false;
      }

      // Filtro por documentos — match EXACTO sobre {OC, Guía, Factura}.
      // Sin selección → cotizaciones sin ningún documento de esos tres tipos.
      // Con selección → cotizaciones cuyo conjunto de tipos coincida exactamente.
      const docs = documentosMap[l.id] || [];

      // Filtro por N° de OC y/o N° de factura (texto). Si se busca por alguno,
      // ese criterio manda: se ignora el filtro exacto de documentos. Si se
      // buscan ambos, deben cumplirse los dos.
      const qOC = filtroOC.trim().toLowerCase();
      const qFactura = filtroFactura.trim().toLowerCase();
      if (qOC || qFactura) {
        const okOC =
          !qOC ||
          docs.some(
            (d) =>
              d.tipo === "orden_compra" &&
              String(d.numero || "").toLowerCase().includes(qOC),
          );
        const okFactura =
          !qFactura ||
          docs.some(
            (d) =>
              (d.tipo === "factura" || d.tipo === "factura_boleta") &&
              String(d.numero || "").toLowerCase().includes(qFactura),
          );
        return okOC && okFactura;
      }

      // Cliente particular no tiene OC ni guía: el único flag aplicable es
      // Factura/Boleta (incluye factura_boleta y efectivo).
      if (esSoloClienteParticular) {
        const tieneFactBoleta = docs.some(
          (d) => d.tipo === "factura" || d.tipo === "factura_boleta" || d.tipo === "efectivo",
        );
        if (tieneFactBoleta !== flagFactura) return false;
        return true;
      }

      const tieneOC = docs.some((d) => d.tipo === "orden_compra");
      const tieneGuia = docs.some((d) => d.tipo === "guia_despacho");
      const tieneFactura = docs.some((d) => d.tipo === "factura");

      if (tieneOC !== flagOc) return false;
      if (tieneGuia !== flagGuia) return false;
      if (tieneFactura !== flagFactura) return false;

      return true;
    });
  }, [data, filtroId, filtroEntidad, filtroVendedor, filtroOC, filtroFactura, filtroFechaDesde, filtroFechaHasta, filtroTipoCotizacion, filtroTipoCompra, filtroEstadoCiclo, flagOc, flagGuia, flagFactura, usuariosMap, documentosMap]);

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

  const puedeCerrarCiclo = useMemo(() => {
    const r = (rol ?? "").toString().trim().toLowerCase();
    return r === "admin" || r === "administrador" || r === "jefe_ventas_especial";
  }, [rol]);

  // Forzar cierre: exige adjuntar un archivo de respaldo Y el motivo del
  // cierre. El archivo queda como documento tipo 'cierre_forzado' y el motivo
  // en su campo `numero` (se muestra en Seguimiento de Pagos).
  const [forzandoCierre, setForzandoCierre] = useState(null); // lic del modal
  const [guardandoCierre, setGuardandoCierre] = useState(false);

  async function confirmarForzarCierre(file, motivo) {
    const lic = forzandoCierre;
    if (!lic || !file || !(motivo || "").trim()) return;
    setGuardandoCierre(true);
    try {
      const ext = (file.name.split(".").pop() || "pdf").toLowerCase();
      const safeName = normalizarNombreArchivo(file.name.replace(/\.[^.]+$/, ""));
      const fileName = `${Date.now()}-${Math.random().toString(36).slice(2)}-${safeName}.${ext}`;
      const bucket = "factura";
      const storagePath = `${lic.id}/${fileName}`;
      const formData = new FormData();
      formData.append("file", file);
      await api.postForm(`/licitaciones/storage/upload?bucket=${bucket}&path=${encodeURIComponent(storagePath)}`, formData);
      try {
        await api.post("/licitaciones/documentos", {
          licitacion_id: Number(lic.id),
          tipo: "cierre_forzado",
          numero: (motivo || "").trim() || null,
          fecha_oc: new Date().toISOString().slice(0, 10),
          bucket,
          storage_path: storagePath,
          file_name: file.name,
          mime_type: file.type || "application/pdf",
          size_bytes: Number(file.size || 0),
        });
      } catch (insErr) {
        try { await api.delete(`/licitaciones/storage/file?bucket=${bucket}&path=${encodeURIComponent(storagePath)}`); } catch {}
        throw insErr;
      }
      setForzandoCierre(null);
      await cambiarCicloCerrado(lic.id, true);
    } catch (e) {
      console.error(e);
      setToast({ type: "error", message: e?.message || "No se pudo registrar el respaldo del cierre forzado. ¿Está aplicada la migración?" });
    } finally {
      setGuardandoCierre(false);
    }
  }

  async function cambiarCicloCerrado(licId, valor) {
    let anterior;
    let anteriorMonto;
    // Al FORZAR el cierre capturamos el monto neto por consumir (OC − guías) en
    // este instante; al reabrir lo anulamos.
    const lic = data.find((l) => l.id === licId);
    const montoForzado = valor && lic ? Math.max(0, montoPorConsumir(lic).porConsumir) : null;
    setData((prev) =>
      prev.map((l) => {
        if (l.id === licId) {
          anterior = l.ciclo_cerrado;
          anteriorMonto = l.monto_forzado;
          return { ...l, ciclo_cerrado: valor, monto_forzado: montoForzado };
        }
        return l;
      }),
    );
    try {
      await api.put(`/licitaciones/${licId}`, { ciclo_cerrado: valor, monto_forzado: montoForzado });
      setToast({
        type: "success",
        message: valor
          ? `Ciclo cerrado. Monto forzado: $${Number(montoForzado || 0).toLocaleString("es-CL")}`
          : "Ciclo reabierto.",
      });
    } catch {
      setData((prev) =>
        prev.map((l) =>
          l.id === licId ? { ...l, ciclo_cerrado: anterior, monto_forzado: anteriorMonto } : l,
        ),
      );
      setToast({ type: "error", message: "No se pudo actualizar el ciclo." });
    }
  }

  async function cambiarEstadoEntrega(licId, nuevo) {
    let anterior;
    setData((prev) =>
      prev.map((l) => {
        if (l.id === licId) {
          anterior = l.estado_entrega;
          return { ...l, estado_entrega: nuevo };
        }
        return l;
      }),
    );
    try {
      await api.put(`/licitaciones/${licId}`, { estado_entrega: nuevo });
    } catch {
      setData((prev) =>
        prev.map((l) => (l.id === licId ? { ...l, estado_entrega: anterior } : l)),
      );
      setToast({ type: "error", message: "No se pudo actualizar el estado de entrega." });
    }
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
          return (montoPorConsumir(a).porConsumir - montoPorConsumir(b).porConsumir) * dir;
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
    // Incluye factura_boleta y efectivo (flujo Cliente Particular), no solo
    // "factura". Si no, la columna "Factura / Boleta" mostraba "Pendiente"
    // aunque la boleta estuviera cargada.
    const facturas = docs.filter(
      (d) => d.tipo === "factura" || d.tipo === "factura_boleta" || d.tipo === "efectivo",
    );

    const cycles = [];

    // Una factura puede estar asociada a varias guías (guias_ids) además de su
    // guía principal (deriva_de_id). Aparece bajo cada guía vinculada.
    const facturaEnGuia = (f, gId) =>
      f.deriva_de_id === gId || (Array.isArray(f.guias_ids) && f.guias_ids.includes(gId));

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
          const facturasDeGuia = facturas.filter((f) => facturaEnGuia(f, g.id));
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
      const facturasDeGuia = facturas.filter((f) => facturaEnGuia(f, g.id));
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

    // Marcar metadata + rowSpan para fusionar celdas (OC, Guía y Factura). Una
    // misma factura (mismo id) puede aparecer en varias filas (cuando cubre
    // varias guías): se fusiona en una sola celda igual que la OC. Las facturas
    // sin id (pendientes) usan una clave única por fila para no fusionarse.
    cycles.forEach((c, i) => {
      const ocKey = c.oc?.id ?? `null-${i}`;
      const guiaKey = c.guia?.id ?? `null-${i}`;
      const facturaKey = c.factura?.id ?? `null-${i}`;
      c.ocKey = ocKey;
      c.guiaKey = guiaKey;
      c.facturaKey = facturaKey;
    });

    // Calcular spans
    const ocCounts = {};
    const guiaCounts = {};
    const facturaCounts = {};
    cycles.forEach((c) => {
      ocCounts[c.ocKey] = (ocCounts[c.ocKey] || 0) + 1;
      guiaCounts[c.guiaKey] = (guiaCounts[c.guiaKey] || 0) + 1;
      facturaCounts[c.facturaKey] = (facturaCounts[c.facturaKey] || 0) + 1;
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
    let prevFacturaKey = null;
    cycles.forEach((c, i) => {
      c.firstOfOc = c.ocKey !== prevOcKey;
      c.firstOfGuia = c.guiaKey !== prevGuiaKey;
      c.firstOfFactura = c.facturaKey !== prevFacturaKey;
      c.ocSpan = c.firstOfOc ? ocCounts[c.ocKey] : 0;
      c.guiaSpan = c.firstOfGuia ? guiaCounts[c.guiaKey] : 0;
      c.facturaSpan = c.firstOfFactura ? facturaCounts[c.facturaKey] : 0;
      c.cycleIdx = i;
      prevOcKey = c.ocKey;
      prevGuiaKey = c.guiaKey;
      prevFacturaKey = c.facturaKey;
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
  // Información de despacho del Cliente Particular (empresa + N° seguimiento).
  function getInfoDespacho(licId) {
    return getDocsForLic(licId).filter((d) => d.tipo === "info_despacho")[0] || null;
  }
  function getFacturas(licId) {
    // Cliente particular: una "factura/boleta" y un pago en "efectivo" son
    // equivalentes al ciclo OC en el flujo público, así que los incluimos como
    // factura para que aparezcan en la columna "Factura/Boleta" cuando el
    // filtro es solo Cliente Particular.
    return getDocsForLic(licId).filter(
      (d) => d.tipo === "factura" || d.tipo === "factura_boleta" || d.tipo === "efectivo",
    );
  }
  function getComprobantes(licId) {
    return getDocsForLic(licId).filter((d) => d.tipo === "comprobante_pago");
  }
  // Respaldo adjuntado al forzar el cierre del ciclo (el más reciente si hay varios).
  function getCierreForzado(licId) {
    const docs = getDocsForLic(licId).filter((d) => d.tipo === "cierre_forzado");
    if (docs.length === 0) return null;
    return [...docs].sort((a, b) => Number(b.id) - Number(a.id))[0];
  }

  // Monto (neto) que aún falta despachar: suma de OC cargadas − suma de guías de
  // despacho cargadas. OC y guías guardan su monto neto. Si el ciclo se cerró
  // de forma forzada, el saldo por consumir queda en $0 (el valor que había al
  // momento del cierre quedó guardado en monto_forzado).
  function montoPorConsumir(lic) {
    const sumaOC = getOrdenes(lic.id).reduce((acc, o) => acc + Number(o.monto || 0), 0);
    const sumaGuias = getGuias(lic.id).reduce((acc, g) => acc + Number(g.monto || 0), 0);
    return {
      hayOC: getOrdenes(lic.id).length > 0,
      sumaOC,
      sumaGuias,
      porConsumir: lic.ciclo_cerrado ? 0 : Math.round(sumaOC - sumaGuias),
    };
  }

  /* ── Reporte descargable (Punto 36) ────────────────────────── */
  function construirFilasReporte() {
    return dataOrdenada.map((lic) => {
      const emailCreador = (lic.creado_por || "").trim().toLowerCase();
      const ocs = getOrdenes(lic.id);
      const guias = getGuias(lic.id);
      const facturas = getFacturas(lic.id);
      const fechasFacturas = facturas
        .map((f) => f.fecha_documento || f.fecha_emision || f.fecha || "")
        .filter(Boolean)
        .sort();
      // Resumen de estado documentación para esta cotización
      let estadoDoc;
      if (ocs.length === 0) estadoDoc = "sin documentos";
      else if (facturas.length > 0) estadoDoc = "con factura";
      else if (guias.length > 0) estadoDoc = "falta factura";
      else estadoDoc = "solo OC";
      const numerosOC = Array.from(
        new Set(ocs.map((o) => String(o.numero || "").trim()).filter(Boolean))
      ).join(", ");
      return {
        "ID Cotización": lic.id_licitacion || lic.id || "",
        "Cliente": lic.nombre_entidad || "",
        "Vendedor": usuariosMap[emailCreador] || emailCreador || "",
        "Tipo de Compra": lic.tipo_compra || "",
        "Fecha Adjudicación": (lic.fecha_adjudicada || "").toString().slice(0, 10),
        "Monto Total": Number(lic.total_con_iva ?? lic.total_sin_iva ?? 0),
        "N° OC": numerosOC,
        "# OCs": ocs.length,
        "# Guías": guias.length,
        "# Facturas": facturas.length,
        "Última Factura": fechasFacturas.length ? fechasFacturas[fechasFacturas.length - 1] : "",
        "Estado Documentación": estadoDoc,
      };
    });
  }

  async function descargarReporte(formato) {
    const filas = construirFilasReporte();
    if (filas.length === 0) {
      setToast({ type: "info", message: "No hay datos en el filtro actual para exportar." });
      return;
    }
    const ts = new Date().toISOString().slice(0, 10);
    const nombreArchivo = `trazabilidad_${ts}`;
    try {
      const XLSX = await import("xlsx");
      const ws = XLSX.utils.json_to_sheet(filas);
      if (formato === "xlsx") {
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Trazabilidad");
        XLSX.writeFile(wb, `${nombreArchivo}.xlsx`);
      } else {
        const csv = XLSX.utils.sheet_to_csv(ws, { FS: ";" });
        // BOM para que Excel detecte UTF-8.
        const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = `${nombreArchivo}.csv`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(link.href);
      }
      setToast({ type: "success", message: `Reporte ${formato.toUpperCase()} generado.` });
    } catch (err) {
      console.error(err);
      setToast({ type: "error", message: "No se pudo generar el reporte." });
    }
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
    setDocTipoUp("factura");
    setFacturaNumero("");
    setFacturaFecha(new Date().toISOString().slice(0, 10));
    setFacturaMonto("");
    setFacturaFile(null);
    setFacturaGuiaIds([]);
    setGuiaEmpresa("Starken");
    setGuiaSeguimiento("");
    setGuiaOcId("");
  }

  function cancelarUploadFactura() {
    setUploadingFor(null);
    setDocTipoUp("factura");
    setFacturaNumero("");
    setFacturaFecha("");
    setFacturaMonto("");
    setFacturaFile(null);
    setFacturaGuiaIds([]);
    setGuiaEmpresa("Starken");
    setGuiaSeguimiento("");
    setGuiaOcId("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  // Lee el PDF seleccionado con la IA del backend y precarga los campos del
  // formulario (número, fecha, monto neto; en guías además courier y
  // seguimiento). El usuario revisa y confirma antes de guardar.
  async function leerDocumentoIA() {
    if (!facturaFile || leyendoIA || subiendoFactura) return;
    setLeyendoIA(true);
    try {
      const formData = new FormData();
      formData.append("file", facturaFile);
      const res = await api.postForm("/ia/extraer-documento", formData);
      const d = res?.datos || {};

      // Si el documento es de otro tipo que el seleccionado, lo ajustamos.
      const esGuiaDetectada = d.tipo_documento === "guia_despacho";
      const esFacturaDetectada = ["factura", "factura_boleta", "boleta"].includes(d.tipo_documento);
      if (esGuiaDetectada && docTipoUp !== "guia_despacho") setDocTipoUp("guia_despacho");
      if (esFacturaDetectada && docTipoUp !== "factura") setDocTipoUp("factura");

      if (d.numero) setFacturaNumero(String(d.numero));
      if (d.fecha) setFacturaFecha(d.fecha);
      if (esGuiaDetectada) {
        const emp = String(d.empresa_transporte || "").toLowerCase();
        if (emp.includes("starken")) setGuiaEmpresa("Starken");
        else if (emp.includes("blue")) setGuiaEmpresa("Blue Express");
        if (d.n_seguimiento) setGuiaSeguimiento(String(d.n_seguimiento));
      } else {
        const neto = d.monto_neto || (d.monto_total ? Math.round(d.monto_total / 1.19) : null);
        if (neto) setFacturaMonto(String(neto));
      }

      const partes = [];
      if (d.numero) partes.push(`N° ${d.numero}`);
      if (d.fecha) partes.push(d.fecha.split("-").reverse().join("-"));
      if (!esGuiaDetectada && (d.monto_neto || d.monto_total)) {
        partes.push(`$${Number(d.monto_neto || Math.round(d.monto_total / 1.19)).toLocaleString("es-CL")} neto`);
      }
      setToast({
        type: d.confianza === "baja" ? "info" : "success",
        message: partes.length
          ? `DamarIA leyó el documento: ${partes.join(" · ")}. Revisa y guarda.${d.confianza === "baja" ? " (A DamarIA le costó leerlo: verifica bien los datos.)" : ""}`
          : "DamarIA no encontró datos claros en el documento; complétalos a mano.",
      });
    } catch (e) {
      setToast({ type: "error", message: e?.message || "DamarIA no pudo leer el documento." });
    } finally {
      setLeyendoIA(false);
    }
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

    const esGuia = docTipoUp === "guia_despacho";

    if (esGuia) {
      // La guía de despacho deriva de una orden de compra de la cotización.
      const ocs = getOrdenes(uploadingFor);
      if (!guiaOcId || !ocs.find((d) => String(d.id) === String(guiaOcId))) {
        setToast({ type: "error", message: "Selecciona la orden de compra de la que deriva la guía." });
        return;
      }
      if (!facturaFecha) {
        setToast({ type: "error", message: "Debes ingresar la fecha de la guía." });
        return;
      }
    } else {
      // Factura: el monto neto es obligatorio.
      if (!facturaMonto || Number(facturaMonto) <= 0) {
        setToast({ type: "error", message: "Debes ingresar el monto neto de la factura." });
        return;
      }
      // Las guías son opcionales; si seleccionan, validamos que sean válidas.
      if (facturaGuiaIds.length > 0) {
        const guias = getGuias(uploadingFor);
        const todasValidas = facturaGuiaIds.every((gid) => {
          const docOrigen = guias.find((d) => String(d.id) === String(gid));
          return docOrigen && docOrigen.tipo === "guia_despacho";
        });
        if (!todasValidas) {
          setToast({ type: "error", message: "Alguna guía de despacho seleccionada no es válida." });
          return;
        }
      }
    }

    setSubiendoFactura(true);

    try {
      const ext = (file.name.split(".").pop() || "pdf").toLowerCase();
      const safeName = normalizarNombreArchivo(file.name.replace(/\.[^.]+$/, ""));
      const fileName = `${Date.now()}-${Math.random().toString(36).slice(2)}-${safeName}.${ext}`;
      const storagePath = `${uploadingFor}/${fileName}`;
      const bucket = esGuia ? "guia-despacho" : "factura";

      const formData = new FormData();
      formData.append("file", file);
      await api.postForm(`/licitaciones/storage/upload?bucket=${bucket}&path=${encodeURIComponent(storagePath)}`, formData);

      const esDespachoInterno = guiaEmpresa === "Despacho interno";
      const payload = esGuia
        ? {
            licitacion_id: Number(uploadingFor),
            tipo: "guia_despacho",
            numero: (facturaNumero || "").trim() || null,
            monto: null,
            fecha_oc: facturaFecha || null,
            deriva_de_id: Number(guiaOcId),
            empresa_despacho: guiaEmpresa,
            n_seguimiento: esDespachoInterno ? null : ((guiaSeguimiento || "").trim() || null),
            bucket,
            storage_path: storagePath,
            file_name: file.name,
            mime_type: file.type || "application/pdf",
            size_bytes: Number(file.size || 0),
          }
        : {
            licitacion_id: Number(uploadingFor),
            tipo: "factura",
            numero: (facturaNumero || "").trim() || null,
            // Monto NETO de la factura (opcional). Solo dígitos → entero.
            monto: facturaMonto ? Number(facturaMonto) : null,
            fecha_oc: null,
            fecha_factura: facturaFecha || null,
            // deriva_de_id = primera guía (compatibilidad); guias_ids = todas.
            deriva_de_id: facturaGuiaIds[0] ? Number(facturaGuiaIds[0]) : null,
            guias_ids: facturaGuiaIds.length ? facturaGuiaIds.map(Number) : null,
            bucket,
            storage_path: storagePath,
            file_name: file.name,
            mime_type: file.type || "application/pdf",
            size_bytes: Number(file.size || 0),
          };

      try {
        await api.post("/licitaciones/documentos", payload);
      } catch (insErr) {
        await api.delete(`/licitaciones/storage/file?bucket=${bucket}&path=${encodeURIComponent(storagePath)}`);
        throw insErr;
      }

      setToast({
        type: "success",
        message: esGuia ? "Guía de despacho cargada correctamente." : "Factura cargada correctamente.",
      });
      const licIdActual = uploadingFor;
      cancelarUploadFactura();
      await refrescarDocumentosLic(licIdActual);
      // Al cargar una guía, avisar al detector de correos pendientes.
      if (esGuia) window.dispatchEvent(new Event("correos:check"));
    } catch (e) {
      console.error("Error subiendo documento:", e);
      const detalle = [e?.code, e?.message].filter(Boolean).join(" - ");
      setToast({
        type: "error",
        message: detalle ? `No se pudo cargar el documento. ${detalle}` : "No se pudo cargar el documento.",
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

  // Abre el modal para editar/agregar el monto neto de una factura ya cargada.
  function abrirEditarMonto(factura) {
    setEditFactura(factura);
    setEditMonto(factura?.monto ? String(Math.round(Number(factura.monto))) : "");
  }

  async function guardarMontoFactura() {
    if (!editFactura?.id) return;
    if (!editMonto || Number(editMonto) <= 0) {
      setToast({ type: "error", message: "Debes ingresar el monto neto de la factura." });
      return;
    }
    setGuardandoMonto(true);
    try {
      await api.put(`/licitaciones/documentos/${editFactura.id}`, { monto: Number(editMonto) });
      setToast({ type: "success", message: "Monto de la factura actualizado." });
      const licId = editFactura.licitacion_id;
      setEditFactura(null);
      setEditMonto("");
      await refrescarDocumentosLic(licId);
    } catch (e) {
      setToast({ type: "error", message: e?.message || "No se pudo actualizar el monto." });
    } finally {
      setGuardandoMonto(false);
    }
  }

  if (!cargando && !puedeVerTrazabilidad) {
    return (
      <div className="page">
        <div className="surface">
          <div className="surface-body" style={{ color: "var(--danger)" }}>
            Acceso restringido.
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
    <div className="page vista-compacta">
      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}
      {guiaBsale && <ModalGuiaBsale {...guiaBsale} onCerrar={() => setGuiaBsale(null)} />}

      {/* Header */}
      <div className="page-header" style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div>
          <h1 className="page-title">Trazabilidad de Facturación</h1>
          <p className="page-subtitle">
            {dataFiltrada.length} cotización{dataFiltrada.length !== 1 ? "es" : ""} adjudicada{dataFiltrada.length !== 1 ? "s" : ""}
          </p>
        </div>
        <div style={{ position: "relative" }}>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setOpenDescargar((v) => !v)}
            style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
            disabled={dataFiltrada.length === 0}
          >
            <Download size={14} /> Descargar reporte <ChevronDown size={14} />
          </button>
          {openDescargar && (
            <div
              style={{
                position: "absolute",
                right: 0,
                marginTop: 4,
                background: "var(--surface, #fff)",
                border: "1px solid var(--border, #e2e8f0)",
                borderRadius: 8,
                boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
                zIndex: 30,
                minWidth: 160,
              }}
              onMouseLeave={() => setOpenDescargar(false)}
            >
              <button
                type="button"
                onClick={() => { setOpenDescargar(false); descargarReporte("xlsx"); }}
                style={{ display: "block", width: "100%", textAlign: "left", padding: "8px 12px", background: "transparent", border: "none", cursor: "pointer", fontSize: 13 }}
              >
                Excel (.xlsx)
              </button>
              <button
                type="button"
                onClick={() => { setOpenDescargar(false); descargarReporte("csv"); }}
                style={{ display: "block", width: "100%", textAlign: "left", padding: "8px 12px", background: "transparent", border: "none", cursor: "pointer", fontSize: 13 }}
              >
                CSV
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Stats — totales de documentos creados dentro del filtro activo */}
      {(() => {
        const totalOCs = dataFiltrada.reduce((acc, l) => acc + getOrdenes(l.id).length, 0);
        const totalGuias = dataFiltrada.reduce((acc, l) => acc + getGuias(l.id).length, 0);
        const totalFacturas = dataFiltrada.reduce((acc, l) => acc + getFacturas(l.id).length, 0);
        const sinFactura = dataFiltrada.filter((l) => getFacturas(l.id).length === 0).length;
        // Pendiente por despachar = OC − guías, solo de ciclos NO cerrados (no forzados).
        const pendienteDespachar = dataFiltrada.reduce((acc, l) => {
          if (l.ciclo_cerrado) return acc;
          return acc + Math.max(0, montoPorConsumir(l).porConsumir);
        }, 0);
        return (
          <div className="stats-row stats-6">
            <div className="stat-card">
              <div className="stat-label">Cotizaciones</div>
              <div className="stat-value">{dataFiltrada.length}</div>
              <div className="stat-sub">adjudicadas</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Órdenes de Compra</div>
              <div className="stat-value" style={{ color: "#1d4ed8" }}>{totalOCs}</div>
              <div className="stat-sub">documentos</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Guías de Despacho</div>
              <div className="stat-value" style={{ color: "#7c3aed" }}>{totalGuias}</div>
              <div className="stat-sub">documentos</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Facturas</div>
              <div className="stat-value" style={{ color: "var(--success)" }}>{totalFacturas}</div>
              <div className="stat-sub">documentos</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Sin Factura</div>
              <div className="stat-value" style={{ color: "var(--warning)" }}>{sinFactura}</div>
              <div className="stat-sub">cotizaciones</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Pendiente por Despachar</div>
              <div className="stat-value" style={{ color: "#0d9488" }}>
                ${pendienteDespachar.toLocaleString("es-CL")}
              </div>
              <div className="stat-sub">OC − guías · ciclos abiertos</div>
            </div>
          </div>
        );
      })()}

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
            gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 200px), 1fr))",
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
          <div>
            <label className="filter-label">N° Orden de Compra</label>
            <input
              type="text"
              className="input"
              placeholder="Buscar N° OC..."
              value={filtroOC}
              onChange={(e) => setFiltroOC(e.target.value)}
              style={{ width: "100%" }}
            />
          </div>
          <div>
            <label className="filter-label">
              {mostrarFacturaBoleta ? "N° Factura / Boleta" : "N° Factura"}
            </label>
            <input
              type="text"
              className="input"
              placeholder={mostrarFacturaBoleta ? "Buscar N° Factura/Boleta..." : "Buscar N° Factura..."}
              value={filtroFactura}
              onChange={(e) => setFiltroFactura(e.target.value)}
              style={{ width: "100%" }}
            />
          </div>
        </div>

        {/* Separador sutil */}
        <div style={{ height: 1, backgroundColor: "#f1f5f9" }} />

        {/* Fila 2: período + tipo cotización + tipo compra + flags + limpiar.
            auto-fit: en pantallas chicas los filtros se apilan en vez de
            comprimirse en 5 columnas (pedido responsive 2026-09-04). */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 220px), 1fr))",
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
            <label className="filter-label">Tipo de Cotización</label>
            <select
              className="input"
              value={filtroTipoCotizacion}
              onChange={(e) => setFiltroTipoCotizacion(e.target.value)}
              style={{ width: "100%", height: 36 }}
            >
              <option value="">Todas</option>
              {opcionesTipoCotizacion.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>

          <div style={{ position: "relative" }} ref={tipoCompraRef}>
            <label className="filter-label">Tipo de Compra</label>
            <button
              type="button"
              className="dropdown-trigger"
              onClick={() => setOpenTipoCompra((v) => !v)}
              style={{ width: "100%", height: 36 }}
            >
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {textoTipoCompra}
              </span>
              <ChevronDown size={14} style={{ flexShrink: 0, opacity: 0.6 }} />
            </button>
            {openTipoCompra && (
              <div className="dropdown-menu">
                <div className="dropdown-menu-header">
                  <button
                    className="btn btn-sm btn-secondary"
                    onClick={() => setFiltroTipoCompra([...opcionesTipoCompra])}
                  >
                    Todos
                  </button>
                  <button
                    className="btn btn-sm btn-secondary"
                    onClick={() => setFiltroTipoCompra([])}
                  >
                    Limpiar
                  </button>
                </div>
                <div className="dropdown-menu-body">
                  {opcionesTipoCompra.map((op) => (
                    <label key={op} className="dropdown-option">
                      <input
                        type="checkbox"
                        checked={filtroTipoCompra.includes(op)}
                        onChange={(e) => {
                          if (e.target.checked) setFiltroTipoCompra((prev) => [...prev, op]);
                          else setFiltroTipoCompra((prev) => prev.filter((x) => x !== op));
                        }}
                      />
                      {op}
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div>
            <label className="filter-label">Estado de ciclo</label>
            <select
              className="input"
              value={filtroEstadoCiclo}
              onChange={(e) => setFiltroEstadoCiclo(e.target.value)}
              style={{ width: "100%", height: 36 }}
            >
              <option value="">Todos</option>
              <option value="preparacion">En preparación</option>
              <option value="entregado">Entregado</option>
              <option value="forzado">Cierre forzado</option>
            </select>
          </div>

          <div>
            <label className="filter-label">Filtrar por documentos (match exacto)</label>
            <div style={{ display: "flex", gap: 6 }}>
              {[
                { key: "oc", label: "OC", value: flagOc, set: setFlagOc, color: "#1d4ed8", bg: "#dbeafe" },
                { key: "guia", label: "Guía", value: flagGuia, set: setFlagGuia, color: "#b45309", bg: "#fef3c7" },
                { key: "factura", label: esSoloClienteParticular ? "Factura / Boleta" : "Factura", value: flagFactura, set: setFlagFactura, color: "#15803d", bg: "#dcfce7" },
              ]
                .filter((b) => !esSoloClienteParticular || b.key === "factura")
                .map(({ label, value, set, color, bg }) => (
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
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {value && <span style={{ fontSize: 11, lineHeight: 1 }}>✓</span>}
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "end" }}>
            {(filtroId || filtroEntidad || filtroVendedor || filtroOC || filtroFactura || filtroFechaDesde || filtroFechaHasta || filtroTipoCotizacion || filtroTipoCompra.length > 0 || filtroEstadoCiclo || flagOc || flagGuia || flagFactura) ? (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                style={{ height: 36, whiteSpace: "nowrap" }}
                onClick={() => {
                  setFiltroId("");
                  setFiltroEntidad("");
                  setFiltroVendedor("");
                  setFiltroOC("");
                  setFiltroFactura("");
                  setFiltroFechaDesde("");
                  setFiltroFechaHasta("");
                  setFiltroTipoCotizacion("");
                  setFiltroTipoCompra([]);
                  setFiltroEstadoCiclo("");
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
        <div className="table-scroll" style={{ maxHeight: "calc(100vh - 240px)" }}>
          <table className="data-table trazabilidad-table table-fit">
            <thead>
              <tr>
                <th
                  onClick={() => toggleSort("entidad")}
                  style={{ cursor: "pointer", userSelect: "none", width: esSoloClienteParticular ? "34%" : "26%", textAlign: "left" }}
                >
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                    Cotización / Cliente <SortIcon col="entidad" />
                  </span>
                </th>
                <th
                  onClick={() => toggleSort("monto")}
                  style={{ cursor: "pointer", userSelect: "none", textAlign: "right", width: "11%" }}
                >
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4, justifyContent: "flex-end" }}>
                    Saldo por consumir <SortIcon col="monto" />
                  </span>
                </th>
                {!esSoloClienteParticular && (
                  <>
                    <th style={{ width: "14%", textAlign: "left" }}>Orden de Compra</th>
                    <th style={{ width: "14%", textAlign: "left" }}>Guía Despacho</th>
                  </>
                )}
                <th style={{ width: esSoloClienteParticular ? "18%" : "14%", textAlign: "left" }}>
                  {esSoloClienteParticular ? "Factura / Boleta" : "Factura"}
                </th>
                {esSoloClienteParticular && (
                  <th style={{ width: "18%", textAlign: "left" }}>Comprobante</th>
                )}
                <th style={{ width: esSoloClienteParticular ? "16%" : "13%", textAlign: "left" }}>Tracking Envío</th>
                <th style={{ textAlign: "right", width: esSoloClienteParticular ? "16%" : "16%" }}>Acción</th>
              </tr>
            </thead>
            <tbody>
              {dataFiltrada.length === 0 ? (
                <tr>
                  <td colSpan={esSoloClienteParticular ? 6 : 7} style={{ textAlign: "center", padding: "60px 0", color: "var(--text-muted)" }}>
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
                    const { oc, guia, factura, firstOfOc, firstOfGuia, ocSpan, guiaSpan, firstOfFactura, facturaSpan } = cycle;

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
                        // Una factura puede cubrir varias guías (guias_ids). Al
                        // resaltarla se iluminan TODAS las guías que comparten esa
                        // misma factura, no solo la primera de la celda fusionada.
                        const enFactura = hoverChain.facturaKey != null && cycle.facturaKey === hoverChain.facturaKey;
                        hoverOc = hoverChain.ocKey === cycle.ocKey;
                        hoverGuia = enFactura;
                        hoverFactura = enFactura;
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

                        {/* Monto + comparación con las OC (#15) */}
                        {isFirstRow && (
                          <td
                            rowSpan={cycles.length}
                            onMouseEnter={() => setHoverChain({ type: "cot", licId: lic.id })}
                            onMouseLeave={clearHover}
                            style={{ verticalAlign: "middle", textAlign: "right", whiteSpace: "nowrap", fontSize: "13px", backgroundColor: hoverCotizacion ? hoverBg : undefined }}
                          >
                            {(() => {
                              const m = montoPorConsumir(lic);
                              if (!m.hayOC) {
                                return <div style={{ fontWeight: 600, color: "#94a3b8" }}>—</div>;
                              }
                              const color = m.porConsumir > 0
                                ? "#b45309"
                                : m.porConsumir < 0
                                ? "#dc2626"
                                : "#16a34a";
                              return (
                                <>
                                  <div style={{ fontWeight: 700, color }}>
                                    ${m.porConsumir.toLocaleString("es-CL")}
                                  </div>
                                  <div
                                    style={{
                                      marginTop: 4,
                                      paddingTop: 4,
                                      borderTop: "1px solid #f1f5f9",
                                      fontWeight: 400,
                                      fontSize: "11px",
                                      lineHeight: 1.5,
                                      color: "#94a3b8",
                                    }}
                                    title="OC cargadas (neto) menos guías de despacho cargadas (neto)"
                                  >
                                    <div>OC neto ${m.sumaOC.toLocaleString("es-CL")}</div>
                                    <div>Guías neto ${m.sumaGuias.toLocaleString("es-CL")}</div>
                                    {lic.ciclo_cerrado && (
                                      <div style={{ color: "#b91c1c", fontWeight: 600 }} title="Ciclo cerrado de forma forzada: el saldo por consumir queda en $0">
                                        Cierre forzado
                                      </div>
                                    )}
                                  </div>
                                </>
                              );
                            })()}
                          </td>
                        )}

                        {/* Orden de Compra */}
                        {!esSoloClienteParticular && firstOfOc && (
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
                            {oc ? (() => {
                              const tieneGuia = getDocsForLic(lic.id).some(
                                (d) => d.tipo === "guia_despacho" && d.deriva_de_id === oc.id
                              );
                              return (
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
                                      ? formatearFechaCorta(oc.fecha_oc)
                                      : <span style={{ fontStyle: "italic", color: "#cbd5e1" }}>Sin fecha</span>}
                                  </div>
                                  {!tieneGuia && oc.fecha_oc && (
                                    <SLABadge fechaOc={oc.fecha_oc} />
                                  )}
                                </div>
                              );
                            })() : (
                              <span style={{ color: "var(--text-muted)" }}>—</span>
                            )}
                          </td>
                        )}

                        {/* Guía de Despacho */}
                        {!esSoloClienteParticular && firstOfGuia && (
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
                                  {guia.numero && (
                                    <button
                                      type="button"
                                      onClick={() => setGuiaBsale({ numero: guia.numero, ocNumero: oc?.numero || null, cliente: lic.nombre_entidad || "" })}
                                      style={{ background: "none", border: "none", cursor: "pointer", color: "#c2570c", padding: 0 }}
                                      title="Ver los productos despachados (guía emitida en Bsale)"
                                    >
                                      <Package size={13} />
                                    </button>
                                  )}
                                </div>
                                <div style={{ color: "var(--text-muted)", fontSize: "11px" }}>
                                  {(guia.fecha_oc || guia.created_at)
                                    ? formatearFechaCorta(guia.fecha_oc || guia.created_at)
                                    : ""}
                                </div>
                              </div>
                            ) : (
                              <span style={{ color: "var(--text-muted)" }}>—</span>
                            )}
                          </td>
                        )}

                        {/* Factura — una misma factura (mismo id) se fusiona en
                            una sola celda aunque cubra varias guías (igual OC). */}
                        {firstOfFactura && (
                        <td
                          rowSpan={facturaSpan}
                          onMouseEnter={() => setHoverChain({ type: "factura", licId: lic.id, ocKey: cycle.ocKey, guiaKey: cycle.guiaKey, facturaKey: cycle.facturaKey, idx })}
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
                                {!soloLectura && (
                                  <button
                                    type="button"
                                    onClick={() => abrirEditarMonto(factura)}
                                    style={{ background: "none", border: "none", cursor: "pointer", color: "var(--primary-dark)", padding: 0 }}
                                    title={factura.monto ? "Editar monto" : "Agregar monto"}
                                  >
                                    <Pencil size={12} />
                                  </button>
                                )}
                                {!soloLectura && (
                                  <button
                                    type="button"
                                    onClick={() => setConfirmEliminar(factura)}
                                    style={{ background: "none", border: "none", cursor: "pointer", color: "#ef4444", padding: 0 }}
                                    title="Eliminar"
                                  >
                                    <Trash2 size={12} />
                                  </button>
                                )}
                              </div>
                              <div style={{ color: "var(--text-muted)", fontSize: "11px" }}>
                                {factura.fecha_factura
                                  ? formatearFechaCorta(factura.fecha_factura)
                                  : factura.created_at
                                  ? formatearFechaCorta(factura.created_at)
                                  : ""}
                              </div>
                              <div style={{ fontSize: "11px", fontWeight: 600, color: factura.monto ? "#15803d" : "#b45309" }}>
                                {factura.monto
                                  ? `Neto $${Number(factura.monto).toLocaleString("es-CL")}`
                                  : "Sin monto"}
                              </div>
                            </div>
                          ) : (
                            <span className="badge badge-warning">Pendiente</span>
                          )}
                        </td>
                        )}

                        {/* Comprobante de transferencia (solo Cliente Particular) — uno por cotización */}
                        {esSoloClienteParticular && isFirstRow && (() => {
                          const comprobantes = getComprobantes(lic.id);
                          const comprobante = comprobantes[0];
                          return (
                            <td rowSpan={cycles.length} style={{ verticalAlign: "middle" }}>
                              {comprobante ? (
                                <div>
                                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                    <span style={{ fontWeight: 500, color: "#1f2937" }}>
                                      {comprobante.numero || "S/N"}
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() => abrirDocumento(comprobante)}
                                      style={{ background: "none", border: "none", cursor: "pointer", color: "var(--primary)", padding: 0 }}
                                      title="Ver PDF"
                                    >
                                      <Eye size={13} />
                                    </button>
                                    {!soloLectura && (
                                      <button
                                        type="button"
                                        onClick={() => setConfirmEliminar(comprobante)}
                                        style={{ background: "none", border: "none", cursor: "pointer", color: "#ef4444", padding: 0 }}
                                        title="Eliminar"
                                      >
                                        <Trash2 size={12} />
                                      </button>
                                    )}
                                  </div>
                                  <div style={{ color: "var(--text-muted)", fontSize: "11px" }}>
                                    {comprobante.fecha_oc
                                      ? formatearFechaCorta(comprobante.fecha_oc)
                                      : comprobante.created_at
                                      ? formatearFechaCorta(comprobante.created_at)
                                      : ""}
                                  </div>
                                </div>
                              ) : (
                                <span className="badge badge-warning">Pendiente</span>
                              )}
                            </td>
                          );
                        })()}

                        {/* Tracking Envío — guía (pública) o info de despacho (particular) */}
                        {!esSoloClienteParticular && firstOfGuia && (
                          <td rowSpan={guiaSpan} style={{ verticalAlign: "middle", borderLeft: "1px solid #e5e7eb" }}>
                            <TrackingEnvioContenido empresa={guia?.empresa_despacho} nSeguimiento={guia?.n_seguimiento} />
                          </td>
                        )}
                        {esSoloClienteParticular && isFirstRow && (() => {
                          const info = getInfoDespacho(lic.id);
                          return (
                            <td rowSpan={cycles.length} style={{ verticalAlign: "middle", borderLeft: "1px solid #e5e7eb" }}>
                              <TrackingEnvioContenido empresa={info?.empresa_despacho} nSeguimiento={info?.n_seguimiento} />
                            </td>
                          );
                        })()}

                        {/* Acción - solo en la primera fila */}
                        {isFirstRow && (
                          <td
                            rowSpan={cycles.length}
                            onMouseEnter={() => setHoverChain({ type: "cot", licId: lic.id })}
                            onMouseLeave={clearHover}
                            style={{ verticalAlign: "middle", textAlign: "right", backgroundColor: hoverCotizacion ? hoverBg : undefined }}
                          >
                            <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "stretch", width: "100%", maxWidth: 240, marginLeft: "auto" }}>
                            {soloLectura ? (() => {
                              const e = ESTADOS_ENTREGA.find((x) => x.valor === lic.estado_entrega) || ESTADOS_ENTREGA[0];
                              return (
                                <span style={{ display: "inline-flex", alignItems: "center", gap: 8, height: 34, padding: "0 12px", borderRadius: 9, border: `1.5px solid ${e.borde}`, background: e.bg, color: e.color, fontSize: 12.5, fontWeight: 700 }}>
                                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: e.punto, flexShrink: 0 }} />
                                  {e.valor}
                                </span>
                              );
                            })() : (
                              <SelectorEstadoEntrega
                                valor={lic.estado_entrega}
                                onCambiar={(nuevo) => cambiarEstadoEntrega(lic.id, nuevo)}
                              />
                            )}
                            <div style={{ display: "flex", flexDirection: (uploadingFor === lic.id || lic.ciclo_cerrado) ? "column" : "row", gap: 6, alignItems: "stretch" }}>
                            {lic.ciclo_cerrado ? (
                              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                                  <span className="badge badge-success" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                                    <CheckCircle2 size={13} /> Ciclo cerrado
                                  </span>
                                  {(() => {
                                    const respaldo = getCierreForzado(lic.id);
                                    return respaldo?.bucket && respaldo?.storage_path ? (
                                      <button
                                        type="button"
                                        onClick={() => abrirDocumento(respaldo)}
                                        style={{ background: "none", border: "none", cursor: "pointer", color: "var(--primary)", padding: 0 }}
                                        title={`Ver respaldo del cierre forzado${respaldo.numero ? ` · ${respaldo.numero}` : ""}`}
                                      >
                                        <Eye size={13} />
                                      </button>
                                    ) : null;
                                  })()}
                                </span>
                                {puedeCerrarCiclo && (
                                  <button
                                    type="button"
                                    className="btn btn-secondary btn-sm"
                                    onClick={() => cambiarCicloCerrado(lic.id, false)}
                                  >
                                    Reabrir
                                  </button>
                                )}
                              </div>
                            ) : (
                              puedeCerrarCiclo && (
                                <button
                                  type="button"
                                  className="btn btn-secondary btn-sm"
                                  style={{ flex: 1, width: "100%", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6 }}
                                  onClick={() => setForzandoCierre(lic)}
                                >
                                  <Check size={14} /> Forzar Cierre
                                </button>
                              )
                            )}
                            {uploadingFor === lic.id ? (
                              <div style={{ display: "flex", flexDirection: "column", gap: 6, width: "100%", textAlign: "left" }}>
                                <select
                                  className="input"
                                  value={docTipoUp}
                                  onChange={(e) => setDocTipoUp(e.target.value)}
                                  disabled={subiendoFactura}
                                >
                                  <option value="factura">Factura</option>
                                  <option value="guia_despacho">Guía de Despacho</option>
                                </select>
                                <input
                                  type="text"
                                  className="input"
                                  value={facturaNumero}
                                  onChange={(e) => setFacturaNumero(e.target.value)}
                                  placeholder={docTipoUp === "guia_despacho" ? "N° Guía" : "N° Factura"}
                                  disabled={subiendoFactura}
                                />
                                <input
                                  type="date"
                                  className="input"
                                  value={facturaFecha}
                                  onChange={(e) => setFacturaFecha(e.target.value)}
                                  disabled={subiendoFactura}
                                />
                                {docTipoUp === "guia_despacho" ? (
                                  <>
                                    <Select
                                      options={getOrdenes(lic.id).map((o) => ({
                                        value: String(o.id),
                                        label: `OC${o.numero ? ` - ${o.numero}` : ` #${o.id}`}`,
                                      }))}
                                      styles={customSelectStyles}
                                      placeholder="Orden de compra..."
                                      menuPortalTarget={document.body}
                                      isSearchable
                                      isDisabled={subiendoFactura}
                                      noOptionsMessage={() => "Sin órdenes de compra"}
                                      value={
                                        getOrdenes(lic.id)
                                          .map((o) => ({
                                            value: String(o.id),
                                            label: `OC${o.numero ? ` - ${o.numero}` : ` #${o.id}`}`,
                                          }))
                                          .find((o) => o.value === String(guiaOcId)) || null
                                      }
                                      onChange={(op) => setGuiaOcId(op?.value || "")}
                                    />
                                    <select
                                      className="input"
                                      value={guiaEmpresa}
                                      onChange={(e) => {
                                        setGuiaEmpresa(e.target.value);
                                        if (e.target.value === "Despacho interno") setGuiaSeguimiento("");
                                      }}
                                      disabled={subiendoFactura}
                                    >
                                      <option value="Starken">Starken</option>
                                      <option value="Blue Express">Blue Express</option>
                                      <option value="Despacho interno">Despacho interno</option>
                                      <option value="Otro">Otro</option>
                                    </select>
                                    {guiaEmpresa !== "Despacho interno" && (
                                      <input
                                        type="text"
                                        className="input"
                                        value={guiaSeguimiento}
                                        onChange={(e) => setGuiaSeguimiento(e.target.value)}
                                        placeholder="N° Seguimiento (opcional)"
                                        disabled={subiendoFactura}
                                      />
                                    )}
                                  </>
                                ) : (
                                  <>
                                    {guias.length > 0 && (
                                      <Select
                                        isMulti
                                        options={guias.map((g) => ({
                                          value: String(g.id),
                                          label: `Guía${g.numero ? ` - ${g.numero}` : ""}`,
                                        }))}
                                        styles={customSelectStyles}
                                        placeholder="Guía(s) (opcional)..."
                                        menuPortalTarget={document.body}
                                        isSearchable
                                        isClearable
                                        isDisabled={subiendoFactura}
                                        noOptionsMessage={() => "Sin guías"}
                                        value={guias
                                          .map((g) => ({
                                            value: String(g.id),
                                            label: `Guía${g.numero ? ` - ${g.numero}` : ""}`,
                                          }))
                                          .filter((o) => facturaGuiaIds.includes(o.value))}
                                        onChange={(ops) => setFacturaGuiaIds((ops || []).map((o) => o.value))}
                                      />
                                    )}
                                    <input
                                      type="text"
                                      inputMode="numeric"
                                      className="input"
                                      value={facturaMonto ? Number(facturaMonto).toLocaleString("es-CL") : ""}
                                      onChange={(e) => setFacturaMonto(e.target.value.replace(/[^\d]/g, ""))}
                                      placeholder="Monto neto *"
                                      disabled={subiendoFactura}
                                    />
                                  </>
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
                                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => fileInputRef.current?.click()} disabled={subiendoFactura || leyendoIA}>
                                    PDF
                                  </button>
                                  {facturaFile && (
                                    <button
                                      type="button"
                                      className="btn btn-secondary btn-sm"
                                      onClick={leerDocumentoIA}
                                      disabled={subiendoFactura || leyendoIA}
                                      title="DamarIA lee el documento y precarga número, fecha y monto"
                                      style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "var(--primary-dark)", whiteSpace: "nowrap" }}
                                    >
                                      <SunflowerIcon size={13} /> {leyendoIA ? "DamarIA leyendo…" : "Pedir a DamarIA"}
                                    </button>
                                  )}
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
                              !soloLectura && (
                                <button
                                  type="button"
                                  onClick={() => iniciarUploadFactura(lic.id)}
                                  className="btn btn-primary btn-sm"
                                  style={{ flex: 1, width: "100%", display: "inline-flex", alignItems: "center", justifyContent: "center" }}
                                >
                                  <Upload size={12} style={{ marginRight: 4 }} /> Documento
                                </button>
                              )
                            )}
                            </div>
                            </div>
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

      {/* Editar / agregar el monto neto de una factura ya cargada */}
      {forzandoCierre && (
        <ModalForzarCierre
          lic={forzandoCierre}
          monto={Math.max(0, montoPorConsumir(forzandoCierre).porConsumir)}
          guardando={guardandoCierre}
          onClose={() => { if (!guardandoCierre) setForzandoCierre(null); }}
          onConfirm={confirmarForzarCierre}
        />
      )}

      {editFactura && (
        <div
          onClick={(e) => { if (e.target === e.currentTarget && !guardandoMonto) { setEditFactura(null); setEditMonto(""); } }}
          style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.55)", zIndex: 12000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
        >
          <div style={{ width: 420, maxWidth: "100%", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-lg)", padding: 22 }}>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}>
              <Pencil size={16} /> {editFactura.monto ? "Editar monto de la factura" : "Agregar monto a la factura"}
            </h3>
            <p style={{ fontSize: 12.5, color: "var(--text-muted)", marginTop: 6, marginBottom: 14 }}>
              Factura {editFactura.numero ? `N° ${editFactura.numero}` : "sin número"}. Ingresa el <strong>monto neto</strong> (sin IVA).
            </p>
            <label className="filter-label">Monto neto *</label>
            <input
              className="input"
              autoFocus
              inputMode="numeric"
              placeholder="Ej: 1.000.000"
              value={editMonto ? Number(editMonto).toLocaleString("es-CL") : ""}
              onChange={(e) => setEditMonto(e.target.value.replace(/[^\d]/g, ""))}
              onKeyDown={(e) => { if (e.key === "Enter" && !guardandoMonto) guardarMontoFactura(); }}
              style={{ width: "100%" }}
            />
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 18 }}>
              <button className="btn btn-secondary" onClick={() => { setEditFactura(null); setEditMonto(""); }} disabled={guardandoMonto}>Cancelar</button>
              <button className="btn btn-primary" onClick={guardarMontoFactura} disabled={guardandoMonto || !editMonto || Number(editMonto) <= 0}>
                {guardandoMonto ? "Guardando…" : "Guardar monto"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Modal: forzar cierre del ciclo (respaldo y motivo obligatorios) ────── */
// Antes de forzar el cierre se exige un archivo de respaldo (autorización o
// justificación) que queda guardado como documento 'cierre_forzado' de la
// cotización, y el MOTIVO del cierre (se muestra en el KPI "Forzado a
// cierre" de Seguimiento de Pagos y sale en su export).
function ModalForzarCierre({ lic, monto, guardando, onClose, onConfirm }) {
  const [file, setFile] = useState(null);
  const [motivo, setMotivo] = useState("");
  const inputRef = useRef(null);

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.55)", zIndex: 12000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
    >
      <div style={{ width: 480, maxWidth: "100%", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-lg)", padding: 22 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}>
            <AlertTriangle size={17} style={{ color: "#b45309" }} /> Forzar cierre del ciclo
          </h3>
          <button className="btn btn-ghost" onClick={onClose} style={{ padding: 6 }} disabled={guardando}><X size={18} /></button>
        </div>
        <p style={{ fontSize: 12.5, color: "var(--text-muted)", marginTop: 2, marginBottom: 12 }}>
          Cotización <strong>{lic.id_licitacion || `#${lic.id}`}</strong> · {lic.nombre_entidad || "—"}.
          Se cerrará el ciclo capturando un monto forzado de <strong>${Number(monto || 0).toLocaleString("es-CL")}</strong> (neto
          por consumir: OC − guías). Debes adjuntar un archivo de respaldo.
        </p>

        <div className="field" style={{ marginBottom: 10 }}>
          <label className="field-label">Archivo de respaldo *</label>
          <div
            onClick={() => !guardando && inputRef.current?.click()}
            style={{ border: "2px dashed var(--border)", borderRadius: 10, padding: "16px 14px", textAlign: "center", cursor: "pointer", background: "var(--bg)" }}
          >
            <Upload size={18} style={{ color: "var(--text-muted)" }} />
            <div style={{ fontSize: 12.5, marginTop: 5 }}>
              {file ? <strong>{file.name}</strong> : "Haz clic para adjuntar el respaldo (PDF o imagen)"}
            </div>
            <input
              ref={inputRef}
              type="file"
              accept=".pdf,.png,.jpg,.jpeg"
              style={{ display: "none" }}
              onChange={(e) => setFile(e.target.files?.[0] || null)}
            />
          </div>
        </div>

        <div className="field" style={{ marginBottom: 14 }}>
          <label className="field-label">Motivo *</label>
          <input
            className="input"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Ej: cliente no emitirá más OC, saldo no despachable…"
            disabled={guardando}
          />
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button className="btn btn-secondary" onClick={onClose} disabled={guardando}>Cancelar</button>
          <button
            className="btn btn-primary"
            onClick={() => onConfirm(file, motivo)}
            disabled={guardando || !file || !motivo.trim()}
            title={!file ? "Adjunta el archivo de respaldo para continuar" : !motivo.trim() ? "Indica el motivo del cierre forzado" : undefined}
            style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
          >
            <Check size={15} /> {guardando ? "Cerrando…" : "Forzar cierre"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Modal: productos despachados según la guía emitida en Bsale ──────────
   Busca la guía electrónica (SII 52) por número en Bsale y muestra sus
   ítems y referencias; si la cotización tiene OC, cruza la referencia de la
   guía contra el número de la OC (pedido 2026-09-04). */
function ModalGuiaBsale({ numero, ocNumero, cliente, onCerrar }) {
  const [estado, setEstado] = useState({ loading: true, data: null, error: "" });

  useEffect(() => {
    let activo = true;
    api.get(`/bsale/guia?numero=${encodeURIComponent(numero)}`)
      .then((data) => { if (activo) setEstado({ loading: false, data, error: "" }); })
      .catch((e) => {
        if (!activo) return;
        const msg = e?.response?.status === 403
          ? "Solo administración puede consultar los documentos de Bsale."
          : (e?.response?.data?.message || e?.message || "No se pudo consultar Bsale.");
        setEstado({ loading: false, data: null, error: msg });
      });
    return () => { activo = false; };
  }, [numero]);

  const d = estado.data;
  const soloDigitos = (v) => String(v || "").replace(/\D/g, "");
  const refs = d?.referencias || [];
  const cruceOc = ocNumero
    ? refs.some((r) =>
        (soloDigitos(r.numero) && soloDigitos(r.numero) === soloDigitos(ocNumero)) ||
        (r.razon || "").toLowerCase().includes(String(ocNumero).toLowerCase()))
    : null;
  const fmt$ = (v) => `$${Math.round(Number(v) || 0).toLocaleString("es-CL")}`;

  return createPortal(
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onCerrar(); }}
      style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.55)", display: "grid", placeItems: "center", zIndex: 12000, padding: 16 }}
    >
      <div style={{ background: "var(--surface)", borderRadius: "var(--radius-lg)", border: "1px solid var(--border)", width: "min(760px, 100%)", maxHeight: "86vh", overflow: "auto", boxShadow: "var(--shadow-lg)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, padding: "14px 18px", borderBottom: "1px solid var(--border)", position: "sticky", top: 0, background: "var(--surface)", zIndex: 1 }}>
          <div>
            <h3 className="surface-title" style={{ margin: 0, display: "flex", alignItems: "center", gap: 8 }}>
              <Package size={16} color="#c2570c" /> Guía N° {numero} · productos despachados
            </h3>
            <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "2px 0 0" }}>
              Según la guía electrónica emitida en Bsale{cliente ? ` · ${cliente}` : ""}
            </p>
          </div>
          <button className="btn btn-ghost" style={{ padding: 6 }} onClick={onCerrar}><X size={16} /></button>
        </div>

        <div style={{ padding: "14px 18px" }}>
          {estado.loading ? (
            <div style={{ color: "var(--text-muted)", padding: "20px 0" }}>Consultando Bsale…</div>
          ) : estado.error ? (
            <div style={{ color: "var(--danger)", padding: "12px 0" }}>{estado.error}</div>
          ) : d?.disponible === false ? (
            <div style={{ color: "var(--text-muted)", padding: "12px 0" }}>
              La integración con Bsale no está configurada en el backend (falta el token).
            </div>
          ) : !d?.encontrado ? (
            <div style={{ color: "var(--text-muted)", padding: "12px 0" }}>
              Bsale no tiene una guía de despacho electrónica con el N° {numero}. Puede tratarse de una
              guía manual o emitida fuera de Bsale.
            </div>
          ) : (
            <>
              <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 12.5, marginBottom: 12 }}>
                {d.emitida && <span><strong>Emitida:</strong> {d.emitida}</span>}
                <span><strong>Neto:</strong> {fmt$(d.neto)}</span>
                {d.anulada && <span style={{ color: "var(--danger)", fontWeight: 700 }}>ANULADA en Bsale</span>}
                {d.url_pdf && (
                  <a className="table-link" href={d.url_pdf} target="_blank" rel="noreferrer">Ver PDF de Bsale</a>
                )}
              </div>

              {/* Cruce guía ↔ OC de la cotización */}
              {ocNumero && (
                <div style={{
                  fontSize: 12.5, padding: "8px 12px", borderRadius: 8, marginBottom: 12,
                  background: cruceOc ? "#dcfce7" : "#fef3c7",
                  color: cruceOc ? "#15803d" : "#a16207",
                  border: `1px solid ${cruceOc ? "#bbf7d0" : "#fde68a"}`,
                }}>
                  {cruceOc
                    ? `✓ La guía referencia la OC N° ${ocNumero} de esta cotización.`
                    : `⚠ La guía emitida en Bsale no trae una referencia que calce con la OC N° ${ocNumero} de esta cotización — revisar que corresponda.`}
                </div>
              )}
              {refs.length > 0 && (
                <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 12 }}>
                  <strong>Referencias de la guía:</strong>{" "}
                  {refs.map((r, i) => `${r.razon || "Ref."}${r.numero ? ` N° ${r.numero}` : ""}`).join(" · ")}
                </div>
              )}

              <div style={{ border: "1px solid var(--border)", borderRadius: 8, overflowX: "auto" }}>
                <table className="data-table" style={{ width: "100%", fontSize: 12.5, minWidth: 520 }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: "left" }}>SKU</th>
                      <th style={{ textAlign: "left" }}>Producto</th>
                      <th style={{ textAlign: "right" }}>Cantidad</th>
                      <th style={{ textAlign: "right" }}>Precio neto</th>
                      <th style={{ textAlign: "right" }}>Total neto</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(d.items || []).length === 0 ? (
                      <tr><td colSpan={5} style={{ padding: "16px 12px", color: "var(--text-muted)", textAlign: "center" }}>La guía no trae detalle de ítems.</td></tr>
                    ) : d.items.map((it, i) => (
                      <tr key={i}>
                        <td>{it.sku || "—"}</td>
                        <td>{it.producto || "—"}</td>
                        <td style={{ textAlign: "right" }}>{Number(it.cantidad || 0).toLocaleString("es-CL")}</td>
                        <td style={{ textAlign: "right" }}>{fmt$(it.precio_neto)}</td>
                        <td style={{ textAlign: "right", fontWeight: 600 }}>{fmt$(it.total_neto)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
