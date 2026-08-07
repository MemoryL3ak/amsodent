// DetalleLicitacion.jsx
// ✅ Regla: TODOS los campos se editan SOLO cuando estado === "En espera"
// ✅ Estado editable, excepto "Pendiente Aprobación" para no-admin
// ✅ Además: cuando está bloqueado, los campos se ven GRIS (disabled styles)
// ✅ Drag & drop / ítems / flete / observaciones / entidad / licitación: bloqueados si no está "En espera"

// ✅ FIX ORDEN:
// - items_licitacion YA tiene columna `orden` (según tu screenshot)
// - CARGA desde BD: .order("orden").order("id")
// - GUARDAR: escribe `orden` (idx+1) en cada ítem
// - DRAG: persiste el reorder al tiro en localStorage (no esperar al useEffect)

import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { api } from "../lib/api";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import Toast from "../components/Toast";
import ConfirmModal from "../components/ConfirmModal";
import DateFilter from "../components/DateFilter";
import Select, { components } from "react-select";
import ProductoPickerModal from "../components/ProductoPickerModal";
import CalculadoraFlete from "../components/CalculadoraFlete";
import { generarPDFcotizacion } from "../utils/generarPDFcotizacion";
import { calcularLista3 } from "../lib/listas";
import { useUnsavedChanges } from "../context/UnsavedChangesContext";
import { GripVertical, Plus, Trash2, MessageSquare, Minus, ChevronUp, ChevronDown } from "lucide-react";

import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  sortableKeyboardCoordinates,
  arrayMove,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

// Correos autorizados a aprobar cotizaciones (además del administrador).
const APROBADORES_AUTORIZADOS = [
  "benja.alarcon.z@gmail.com",
  "diego.cruz@bvan.cl",
  "ventas@amsodentmedical.cl",
];

/* ============================================================
   TOOLTIP SOLO PARA PRODUCTO (NO TOCA EL INPUT DEL SELECT)
============================================================ */
const ProductoSingleValue = (props) => {
  return (
    <components.SingleValue
      {...props}
      onMouseEnter={(e) => {
        const rect = e.target.getBoundingClientRect();
        props.selectProps.setTooltip({
          visible: true,
          texto: props.data.label,
          x: rect.left,
          y: rect.bottom,
        });
      }}
      onMouseLeave={() =>
        props.selectProps.setTooltip((t) => ({ ...t, visible: false }))
      }
      style={{ fontSize: "13px", cursor: "default" }}
    >
      {props.children}
    </components.SingleValue>
  );
};

/* ============================================================
   HELPERS
============================================================ */
function redondear(valor) {
  const entero = Math.floor(valor);
  const decimal = valor - entero;
  return decimal >= 0.5 ? entero + 1 : entero;
}

function formatear(valor) {
  return Number(valor).toLocaleString("es-CL");
}

function generarUid() {
  if (typeof crypto !== "undefined" && crypto.randomUUID)
    return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/* ============================================================
   ✅ CL $ helpers (para Precio Unitario editable)
============================================================ */
function soloDigitos(str) {
  return (str ?? "").toString().replace(/[^\d]/g, "");
}

function formatearCLDesdeString(str) {
  const digits = soloDigitos(str);
  if (!digits) return "";
  return Number(digits).toLocaleString("es-CL");
}

function parseMontoCL(str) {
  const digits = soloDigitos(str);
  return Number(digits || 0);
}

function parseMontoFlexible(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") return parseMontoCL(value);
  return 0;
}

function formatPorcentajePresupuesto(pct) {
  const n = Number(pct || 0);
  if (!Number.isFinite(n) || n <= 0) return "0%";
  if (n < 100) {
    const truncado = Math.floor(n * 100) / 100;
    return `${truncado.toFixed(2)}%`;
  }
  return `${n.toFixed(2)}%`;
}

function calcularBrutoDesdeNeto(neto) {
  return redondear(Number(neto || 0) * 1.19);
}

function fechaHoyISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Formatea una fecha guardada en DB (date o timestamptz) como dd-mm-yyyy
// SIN pasar por `new Date()` — el constructor de Date introduce shifts de
// timezone que pueden cambiar el día (e incluso "intercambiar" día y mes
// si el formato no es ISO estricto). Toma los primeros 10 chars y los
// reordena por string directamente.
function formatearFechaCorta(fecha) {
  if (!fecha) return "—";
  const s = String(fecha).slice(0, 10);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return s;
}

// Toma una fecha posiblemente timestamptz (ej "2026-05-15T03:00:00+00:00")
// y la convierte a YYYY-MM-DD para usar con DateFilter.
function aIsoFechaCorta(fecha) {
  if (!fecha) return "";
  const s = String(fecha).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : "";
}

// Precio base según la lista activa. Lista 3 se usa para tipo de compra
// "Licitación 9 a 24 meses". Si el producto tiene Lista 3 explícita la usamos;
// si no, fallback al factor configurado (ver src/lib/listas.js).
function getPrecioPorListado(prod, listado) {
  if (!prod) return 0;
  if (String(listado) === "3") {
    const explicit = Number(prod.lista3 ?? 0);
    if (explicit > 0) return explicit;
    return calcularLista3(prod.lista2);
  }
  return Number(prod[`lista${listado}`] ?? 0);
}

function normalizarVolumenCm3(valor) {
  const n = Number(valor || 0);
  if (!Number.isFinite(n) || n <= 0) return 0;
  // Compatibilidad con datos antiguos guardados en m3.
  if (n < 1) return n * 1_000_000;
  return n;
}


/* ============================================================
   BUSCADOR MEJORADO (igual que Crear)
============================================================ */
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

function filtrarPorTerminos(option, inputValue) {
  const q = normalizarTexto(inputValue);
  if (!q) return true;

  const label = normalizarTexto(option.label);
  const terms = q.split(" ").filter(Boolean);
  return terms.every((t) => label.includes(t));
}

/* ============================================================
   ESTILOS SELECT (✅ GRIS cuando isDisabled)
============================================================ */
const customStyles = {
  control: (base, state) => ({
    ...base,
    minHeight: "40px",
    fontSize: "13px",
    fontFamily: "inherit",
    backgroundColor: state.isDisabled ? "#f3f4f6" : "white",
    borderColor: state.isDisabled ? "#e5e7eb" : base.borderColor,
    boxShadow: "none",
    cursor: state.isDisabled ? "not-allowed" : "default",
    opacity: state.isDisabled ? 0.95 : 1,
  }),
  valueContainer: (base) => ({
    ...base,
    fontSize: "13px",
    fontFamily: "inherit",
  }),
  input: (base, state) => ({
    ...base,
    fontSize: "13px",
    fontFamily: "inherit",
    color: state.isDisabled ? "#6b7280" : "#333",
  }),
  singleValue: (base, state) => ({
    ...base,
    fontSize: "13px",
    fontFamily: "inherit",
    color: state.isDisabled ? "#6b7280" : base.color,
  }),
  option: (base, state) => ({
    ...base,
    fontSize: "13px",
    fontFamily: "inherit",
    background: state.isFocused ? "#1A73E8" : "white",
    color: state.isFocused ? "white" : "#333",
    cursor: "pointer",
  }),
  placeholder: (base, state) => ({
    ...base,
    fontSize: "13px",
    fontFamily: "inherit",
    color: state.isDisabled ? "#9ca3af" : base.color,
  }),
  menuPortal: (base) => ({ ...base, zIndex: 99999 }),
};

/* ============================================================
   ESTILOS DE ESTADO (SOLO EDICIÓN)
============================================================ */
const estadoStyles = {
  "En espera": "bg-yellow-50 text-yellow-800 border-yellow-300",
  Adjudicada: "bg-green-50 text-green-800 border-green-300",
  Perdida: "bg-red-50 text-red-800 border-red-300",
  Desierta: "bg-gray-100 text-gray-700 border-gray-300",
  Descartada: "bg-purple-50 text-purple-800 border-purple-300",
  Cancelada: "bg-slate-100 text-slate-700 border-slate-300",
  "Pendiente Aprobación": "bg-orange-50 text-orange-800 border-orange-300",
};

/* ============================================================
   REGIONES / COMUNAS
============================================================ */
const REGIONES_CHILE = {
  "Arica y Parinacota": ["Arica", "Camarones", "Putre", "General Lagos"],
  Tarapacá: [
    "Iquique",
    "Alto Hospicio",
    "Pozo Almonte",
    "Camiña",
    "Colchane",
    "Huara",
    "Pica",
  ],
  Antofagasta: [
    "Antofagasta",
    "Mejillones",
    "Sierra Gorda",
    "Taltal",
    "Calama",
    "Ollagüe",
    "San Pedro de Atacama",
    "Tocopilla",
    "María Elena",
  ],
  Atacama: [
    "Copiapó",
    "Caldera",
    "Tierra Amarilla",
    "Chañaral",
    "Diego de Almagro",
    "Vallenar",
    "Alto del Carmen",
    "Freirina",
    "Huasco",
  ],
  Coquimbo: [
    "La Serena",
    "Coquimbo",
    "Andacollo",
    "La Higuera",
    "Paihuano",
    "Vicuña",
    "Illapel",
    "Canela",
    "Los Vilos",
    "Salamanca",
    "Ovalle",
    "Combarbalá",
    "Monte Patria",
    "Punitaqui",
    "Río Hurtado",
  ],
  Valparaíso: [
    "Valparaíso",
    "Casablanca",
    "Concón",
    "Juan Fernández",
    "Puchuncaví",
    "Quintero",
    "Viña del Mar",
    "Isla de Pascua",
    "Los Andes",
    "Calle Larga",
    "Rinconada",
    "San Esteban",
    "La Ligua",
    "Cabildo",
    "Papudo",
    "Petorca",
    "Zapallar",
    "Quillota",
    "Calera",
    "Hijuelas",
    "La Cruz",
    "Nogales",
    "San Antonio",
    "Algarrobo",
    "Cartagena",
    "El Quisco",
    "El Tabo",
    "Santo Domingo",
    "San Felipe",
    "Catemu",
    "Llaillay",
    "Panquehue",
    "Putaendo",
    "Santa María",
    "Quilpué",
    "Limache",
    "Olmué",
    "Villa Alemana",
  ],
  "Metropolitana de Santiago": [
    "Cerrillos",
    "Cerro Navia",
    "Conchalí",
    "El Bosque",
    "Estación Central",
    "Huechuraba",
    "Independencia",
    "La Cisterna",
    "La Florida",
    "La Granja",
    "La Pintana",
    "La Reina",
    "Las Condes",
    "Lo Barnechea",
    "Lo Espejo",
    "Lo Prado",
    "Macul",
    "Maipú",
    "Ñuñoa",
    "Pedro Aguirre Cerda",
    "Peñalolén",
    "Providencia",
    "Pudahuel",
    "Quilicura",
    "Quinta Normal",
    "Recoleta",
    "Renca",
    "San Joaquín",
    "San Miguel",
    "San Ramón",
    "Santiago",
    "Vitacura",
    "Puente Alto",
    "Pirque",
    "San José de Maipo",
    "Colina",
    "Lampa",
    "Tiltil",
    "San Bernardo",
    "Buin",
    "Calera de Tango",
    "Paine",
    "Melipilla",
    "Alhué",
    "Curacaví",
    "María Pinto",
    "San Pedro",
    "Talagante",
    "El Monte",
    "Isla de Maipo",
    "Padre Hurtado",
    "Peñaflor",
  ],
  "O'Higgins": [
    "Rancagua",
    "Codegua",
    "Coinco",
    "Coltauco",
    "Doñihue",
    "Graneros",
    "Las Cabras",
    "Machalí",
    "Malloa",
    "Mostazal",
    "Olivar",
    "Peumo",
    "Pichidegua",
    "Quinta de Tilcoco",
    "Rengo",
    "Requínoa",
    "San Vicente",
    "Pichilemu",
    "La Estrella",
    "Litueche",
    "Marchigüe",
    "Navidad",
    "Paredones",
    "San Fernando",
    "Chépica",
    "Chimbarongo",
    "Lolol",
    "Nancagua",
    "Palmilla",
    "Peralillo",
    "Placilla",
    "Pumanque",
    "Santa Cruz",
  ],
  Maule: [
    "Talca",
    "Constitución",
    "Curepto",
    "Empedrado",
    "Maule",
    "Pelarco",
    "Pencahue",
    "Río Claro",
    "San Clemente",
    "San Rafael",
    "Cauquenes",
    "Chanco",
    "Pelluhue",
    "Curicó",
    "Hualañé",
    "Licantén",
    "Molina",
    "Rauco",
    "Romeral",
    "Sagrada Familia",
    "Teno",
    "Vichuquén",
    "Linares",
    "Colbún",
    "Longaví",
    "Parral",
    "Retiro",
    "San Javier",
    "Villa Alegre",
    "Yerbas Buenas",
  ],
  Ñuble: [
    "Chillán",
    "Bulnes",
    "Chillán Viejo",
    "El Carmen",
    "Pemuco",
    "Pinto",
    "Quillón",
    "San Ignacio",
    "Yungay",
    "Coelemu",
    "Cobquecura",
    "Ninhue",
    "Portezuelo",
    "Quirihue",
    "Ránquil",
    "Treguaco",
    "San Carlos",
    "Coihueco",
    "Ñiquén",
    "San Fabián",
    "San Nicolás",
  ],
  Biobío: [
    "Concepción",
    "Coronel",
    "Chiguayante",
    "Florida",
    "Hualqui",
    "Lota",
    "Penco",
    "San Pedro de la Paz",
    "Santa Juana",
    "Talcahuano",
    "Tomé",
    "Hualpén",
    "Lebu",
    "Arauco",
    "Cañete",
    "Contulmo",
    "Curanilahue",
    "Los Álamos",
    "Tirúa",
    "Los Ángeles",
    "Antuco",
    "Cabrero",
    "Laja",
    "Mulchén",
    "Nacimiento",
    "Negrete",
    "Quilaco",
    "Quilleco",
    "San Rosendo",
    "Santa Bárbara",
    "Tucapel",
    "Yumbel",
    "Alto Biobío",
  ],
  "La Araucanía": [
    "Temuco",
    "Carahue",
    "Cunco",
    "Curarrehue",
    "Freire",
    "Galvarino",
    "Gorbea",
    "Lautaro",
    "Loncoche",
    "Melipeuco",
    "Nueva Imperial",
    "Padre Las Casas",
    "Perquenco",
    "Pitrufquén",
    "Pucón",
    "Saavedra",
    "Teodoro Schmidt",
    "Toltén",
    "Vilcún",
    "Villarrica",
    "Cholchol",
    "Angol",
    "Collipulli",
    "Curacautín",
    "Ercilla",
    "Lonquimay",
    "Los Sauces",
    "Lumaco",
    "Purén",
    "Renaico",
    "Traiguén",
    "Victoria",
  ],
  "Los Ríos": [
    "Valdivia",
    "Corral",
    "Lanco",
    "Los Lagos",
    "Máfil",
    "Mariquina",
    "Paillaco",
    "Panguipulli",
    "La Unión",
    "Futrono",
    "Lago Ranco",
    "Río Bueno",
  ],
  "Los Lagos": [
    "Puerto Montt",
    "Calbuco",
    "Cochamó",
    "Fresia",
    "Frutillar",
    "Los Muermos",
    "Llanquihue",
    "Maullín",
    "Puerto Varas",
    "Castro",
    "Ancud",
    "Chonchi",
    "Curaco de Vélez",
    "Dalcahue",
    "Puqueldón",
    "Queilén",
    "Quellón",
    "Quemchi",
    "Quinchao",
    "Osorno",
    "Puerto Octay",
    "Purranque",
    "Puyehue",
    "Río Negro",
    "San Juan de la Costa",
    "San Pablo",
  ],
  Aysén: [
    "Coyhaique",
    "Lago Verde",
    "Aysén",
    "Cisnes",
    "Guaitecas",
    "Cochrane",
    "O'Higgins",
    "Tortel",
    "Chile Chico",
    "Río Ibáñez",
  ],
  "Magallanes y de la Antártica Chilena": [
    "Punta Arenas",
    "Laguna Blanca",
    "Río Verde",
    "San Gregorio",
    "Cabo de Hornos",
    "Antártica",
    "Porvenir",
    "Primavera",
    "Timaukel",
    "Natales",
    "Torres del Paine",
  ],
};

const opcionesRegion = Object.keys(REGIONES_CHILE).map((reg) => ({
  value: reg,
  label: reg,
}));

const opcionesComuna = (regionSeleccionada) =>
  (REGIONES_CHILE[regionSeleccionada] || []).map((c) => ({
    value: c,
    label: c,
  }));

const OPCIONES_COND_VENTA = ["30 días", "Contado"];
const STORAGE_KEY_PREFIX = "editar_licitacion_draft_";
const DOC_TIPOS = {
  orden_compra: "Orden de Compra",
  guia_despacho: "Guía de Despacho",
  factura: "Factura",
  factura_boleta: "Factura o Boleta",
  comprobante_pago: "Comprobante de Transferencia",
  webpay: "Webpay",
  efectivo: "Efectivo",
  info_despacho: "Información de Despacho",
  nota_credito: "Nota de Crédito",
  cierre_forzado: "Respaldo Cierre Forzado",
};
const DOC_BUCKET_BY_TIPO = {
  orden_compra: "orden-compra",
  guia_despacho: "guia-despacho",
  factura: "factura",
  factura_boleta: "factura",
  comprobante_pago: "factura",
  webpay: "factura",
  efectivo: "factura",
  // info_despacho: sin archivo (no lleva bucket).
};

/* ============================================================
   Sortable Item wrapper
============================================================ */
function SortableItem({ itemId, children, disabled }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: itemId, disabled });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition: isDragging ? undefined : transition,
    willChange: "transform",
  };

  return (
    <div ref={setNodeRef} style={style}>
      {children({
        dragHandleProps: {
          ...attributes,
          ...listeners,
          ref: setActivatorNodeRef,
        },
        isDragging,
      })}
    </div>
  );
}

export default function EditarLicitacion() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();

  const {
    setIsDirty,
    requestNavigation,
    registerDiscardHandler,
    clearDiscardHandler,
    registerSaveHandler,
    clearSaveHandler,
  } = useUnsavedChanges();

  const baselineRef = useRef(null);
  const saveHandlerRef = useRef(null);
  const discardHandlerRef = useRef(null);
  const fileInputRef = useRef(null);

  const baseLicitaciones = location.pathname.startsWith("/app/")
    ? "/app/licitaciones"
    : location.pathname.startsWith("/dashboard/")
    ? "/dashboard/licitaciones"
    : "/licitaciones";
  const rutaCrearLicitacion = location.pathname.startsWith("/app/")
    ? "/app/crear"
    : location.pathname.startsWith("/dashboard/")
    ? "/dashboard/crear"
    : "/crear";

  function volver() {
    if (window.history.length > 1) requestNavigation(-1);
    else requestNavigation(baseLicitaciones, { replace: true });
  }

  function duplicarLicitacion() {
    const draftDuplicado = {
      idLicitacionInput: "",
      nombre: nombre || "",
      fechaHoraCierre: fechaHoraCierre || "",
      monto: monto || "",
      listado: listado || "1",
      rutEntidad: rutEntidad || "",
      nombreEntidad: nombreEntidad || "",
      departamento: departamento || "",
      municipalidad: municipalidad || "",
      direccion: direccion || "",
      sucursal: sucursal || "",
      contacto: contacto || "",
      email: email || "",
      telefono: telefono || "",
      condVenta: condVenta || "",
      fleteEstimado: fleteEstimado || 0,
      tipoCompra: tipoCompra || "Compra ágil",
      region: region || "",
      comuna: comuna || "",
      observaciones: observaciones || "",
      items: (items || []).map((it) => ({
        sku: it?.sku || "",
        producto: it?.producto || "",
        categoria: it?.categoria || "",
        formato: it?.formato || "",
        cantidad: Number(it?.cantidad || 0),
        precio: Number(it?.precio || 0),
        costo: Number(it?.costo || 0),
        total: Number(it?.total || 0),
        observacion: it?.observacion || "",
        mostrarObs: Boolean(it?.mostrarObs),
        precioManual: Boolean(it?.precioManual),
        precioUnitarioStr: it?.precioUnitarioStr || "",
        costoManual: Boolean(it?.costoManual),
        costoStr: it?.costoStr || "",
      })),
    };

    navigate(rutaCrearLicitacion, {
      state: { duplicarLicitacion: draftDuplicado },
    });
  }

  const [tooltip, setTooltip] = useState({
    visible: false,
    texto: "",
    x: 0,
    y: 0,
  });

  const [toast, setToast] = useState(null);
  const [loading, setLoading] = useState(true);
  const [mostrarEntidad, setMostrarEntidad] = useState(true);
  const [mostrarPortalModal, setMostrarPortalModal] = useState(false);

  const [guardando, setGuardando] = useState(false);
  const [generandoPDF, setGenerandoPDF] = useState(false);
  const [eliminando, setEliminando] = useState(false);
  const [confirmEliminarOpen, setConfirmEliminarOpen] = useState(false);
  const [confirmEliminarDocOpen, setConfirmEliminarDocOpen] = useState(false);
  const [confirmDuplicarOpen, setConfirmDuplicarOpen] = useState(false);
  const [adjudicarPrompt, setAdjudicarPrompt] = useState(null); // { stage:"check"|"modificar", total, resolve }
  const [docAEliminar, setDocAEliminar] = useState(null);
  const [docEditando, setDocEditando] = useState(null);
  const [docEditNumero, setDocEditNumero] = useState("");
  const [docEditMonto, setDocEditMonto] = useState("");
  const [docEditFechaOC, setDocEditFechaOC] = useState("");
  const [docEditFileName, setDocEditFileName] = useState("");
  const [docEditTracking, setDocEditTracking] = useState("");
  const [guardandoDocEdit, setGuardandoDocEdit] = useState(false);
  const [aprobando, setAprobando] = useState(false);
  const [documentos, setDocumentos] = useState([]);
  // Tipo de documento por defecto. Si la cotización es Cliente Particular, el
  // selector arranca en "factura_boleta" (los tipos de doc cambian); si es
  // pública, arranca en "orden_compra".
  const [docTipo, setDocTipo] = useState("orden_compra");
  const [docNumero, setDocNumero] = useState("");
  const [docMonto, setDocMonto] = useState("");
  const [docFechaOC, setDocFechaOC] = useState(fechaHoyISO());
  const [docDerivaDeId, setDocDerivaDeId] = useState("");
  const [docEmpresa, setDocEmpresa] = useState("Starken");
  const [docNumSeguimiento, setDocNumSeguimiento] = useState("");
  const [docUrl, setDocUrl] = useState(""); // Webpay: link al comprobante
  const [docFile, setDocFile] = useState(null);
  const [subiendoDoc, setSubiendoDoc] = useState(false);

  const STORAGE_KEY = `${STORAGE_KEY_PREFIX}${id}`;

  /* ===============================
     DATOS LICITACIÓN
  ================================ */
  const [idLicitacionInput, setIdLicitacionInput] = useState("");
  const [nombre, setNombre] = useState("");
  const [fechaHoraCierre, setFechaHoraCierre] = useState("");
  const [monto, setMonto] = useState("");
  const [listado, setListado] = useState("1");
  const [estado, setEstado] = useState("En espera");
  const [estadoActualDB, setEstadoActualDB] = useState("En espera");
  const [fechaAdjudicada, setFechaAdjudicada] = useState(null);
  const [fechaCreacionLic, setFechaCreacionLic] = useState(null);
  const [margenAprobado, setMargenAprobado] = useState(false);
  // Ciclo cerrado de forma forzada (Trazabilidad): fuerza el saldo por consumir a $0.
  const [cicloCerrado, setCicloCerrado] = useState(false);
  const [tipoCompra, setTipoCompra] = useState("Compra ágil");
  const [montoAdicionalOC, setMontoAdicionalOC] = useState("");

  const [observaciones, setObservaciones] = useState("");

  const [vendedorNombre, setVendedorNombre] = useState("");
  const [vendedorCelular, setVendedorCelular] = useState("");
  const [vendedorCorreo, setVendedorCorreo] = useState("");

  const [rol, setRol] = useState(null);
  const [miCorreo, setMiCorreo] = useState("");
  const esAdmin = useMemo(() => {
    const r = (rol ?? "").toString().trim().toLowerCase();
    return r === "admin" || r === "administrador";
  }, [rol]);
  // Aprobación de cotizaciones: además del administrador, ciertos correos están
  // autorizados a aprobar (sin darles el resto de permisos de admin).
  const puedeAprobar = useMemo(() => {
    if (esAdmin) return true;
    const e = (miCorreo || "").trim().toLowerCase();
    return APROBADORES_AUTORIZADOS.includes(e);
  }, [esAdmin, miCorreo]);
  // Admin y jefe_ventas_especial pueden editar el nombre del documento y el N° de tracking.
  const puedeEditarDocAvanzado = useMemo(() => {
    const r = (rol ?? "").toString().trim().toLowerCase();
    return r === "admin" || r === "administrador" || r === "jefe_ventas_especial";
  }, [rol]);

  /* ===============================
     DATOS ENTIDAD
  ================================ */
  const [rutEntidad, setRutEntidad] = useState("");
  const [nombreEntidad, setNombreEntidad] = useState("");
  const [giro, setGiro] = useState("");
  const [tipoCliente, setTipoCliente] = useState("");
  // Valor de tipo_cliente que ya está guardado en BD. Lo usamos para mostrar el
  // botón "Guardar" inline cuando la licitación está bloqueada (Adjudicada,
  // Perdida, Cancelada): el campo Tipo de Cliente sigue editable y persistible
  // aunque el resto del formulario esté bloqueado.
  const [tipoClienteGuardado, setTipoClienteGuardado] = useState("");
  const [guardandoTipoCliente, setGuardandoTipoCliente] = useState(false);
  const [departamento, setDepartamento] = useState("");
  const [motivoPerdida, setMotivoPerdida] = useState("");
  const [motivoPerdidaOtro, setMotivoPerdidaOtro] = useState("");
  const [modalMotivoPerdidaOpen, setModalMotivoPerdidaOpen] = useState(false);
  // Descarte: motivo (Presupuesto / Quiebre stock) + comentario obligatorio.
  const [motivoDescarte, setMotivoDescarte] = useState("");
  const [comentarioDescarte, setComentarioDescarte] = useState("");
  const [modalMotivoDescarteOpen, setModalMotivoDescarteOpen] = useState(false);
  // Estado "candidato": al cambiar el select a Perdida, retenemos el cambio hasta que el modal
  // confirme. Si el usuario cancela el modal, restauramos el estado anterior.
  const estadoPrevioRef = useRef("En espera");

  // Una cotización es Cliente Particular si lo dice el Tipo de Cotización
  // (tipo_cliente) O el tipo de compra. No basta tipo_compra: en cotizaciones
  // convertidas a particular estando bloqueadas ("Guardar Tipo de Cotización"
  // solo persistía tipo_cliente), tipo_compra quedó con un valor de licitación
  // y la sección Documentos ofrecía OC/Guía en vez de Factura o Boleta.
  const esCotizacionParticular =
    tipoCompra === "Cliente particular" ||
    tipoCliente.trim().toLowerCase() === "cliente particular";

  // Sincroniza el tipo de documento default con el tipo de compra: si la cotización
  // es Cliente Particular, los tipos son factura_boleta / comprobante_pago.
  // Si el usuario tenía un tipo no aplicable (ej. orden_compra) lo reajustamos.
  // IMPORTANTE: este efecto debe declararse DESPUÉS de useState(tipoCompra) para
  // evitar "Cannot access 'tipoCompra' before initialization" en producción.
  useEffect(() => {
    const tiposParticular = ["factura_boleta", "comprobante_pago", "webpay", "efectivo", "info_despacho"];
    if (esCotizacionParticular) {
      if (!tiposParticular.includes(docTipo)) {
        setDocTipo("factura_boleta");
      }
    } else {
      if (docTipo !== "orden_compra" && docTipo !== "guia_despacho") {
        setDocTipo("orden_compra");
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [esCotizacionParticular]);
  const [municipalidad, setMunicipalidad] = useState("");
  const [region, setRegion] = useState("");
  const [comuna, setComuna] = useState("");
  const [direccion, setDireccion] = useState("");
  const [sucursales, setSucursales] = useState([]);
  const [sucursal, setSucursal] = useState("");
  // Datos generales del cliente: respaldo cuando una sucursal no trae ese dato.
  const [clienteBase, setClienteBase] = useState({});
  const [contacto, setContacto] = useState("");
  const [email, setEmail] = useState("");
  const [telefono, setTelefono] = useState("");
  const [condVenta, setCondVenta] = useState("");

  // Puebla los datos de despacho con los de una sucursal. Determinista: setea
  // TODOS los campos, usando el dato de la sucursal o, si no lo tiene, el dato
  // general del cliente. Así al alternar entre sucursales los campos siempre
  // reflejan la sucursal elegida.
  function aplicarDatosSucursal(s) {
    setDireccion((s?.direccion) || clienteBase.direccion || "");
    setComuna((s?.comuna) || clienteBase.comuna || "");
    setContacto((s?.contacto) || clienteBase.contacto || "");
    setTelefono((s?.telefono) || clienteBase.telefono || "");
    setEmail((s?.email) || clienteBase.email || "");
  }

  // Sucursales del cliente (por RUT). Se respeta la sucursal ya guardada en la
  // cotización; si no hay ninguna, queda "Casa Matriz" por defecto (solo la
  // etiqueta, sin pisar la dirección ya guardada de la cotización).
  useEffect(() => {
    const rut = (rutEntidad || "").trim();
    if (!rut) { setSucursales([]); return; }
    let activo = true;
    (async () => {
      try {
        const [sucs, cli] = await Promise.all([
          api.get(`/stock-clientes/sucursales-por-rut?rut=${encodeURIComponent(rut)}`).catch(() => []),
          api.get(`/clientes?rut=${encodeURIComponent(rut)}`).catch(() => null),
        ]);
        if (!activo) return;
        const lista = Array.isArray(sucs) ? sucs.filter((x) => x.activo !== false) : [];
        setSucursales(lista);
        if (cli) setClienteBase({
          direccion: cli.direccion || "", comuna: cli.comuna || "",
          contacto: cli.contacto || "", telefono: cli.telefono || "", email: cli.email || "",
        });
        if (!sucursal && lista.length) {
          const cm = lista.find((s) => (s.nombre || "").trim().toLowerCase() === "casa matriz") || lista[0];
          setSucursal(cm.nombre);
        }
      } catch {
        if (activo) setSucursales([]);
      }
    })();
    return () => { activo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rutEntidad]);

  // Elige una sucursal manualmente: guarda su nombre y trae sus datos de despacho.
  function elegirSucursal(nombre) {
    setSucursal(nombre || "");
    aplicarDatosSucursal(sucursales.find((x) => x.nombre === nombre));
  }

  /* ===============================
     FLETE
  ================================ */
  const [fleteEstimado, setFleteEstimado] = useState(0);

  /* ===============================
     PRODUCTOS / ÍTEMS
  ================================ */
  const [productos, setProductos] = useState([]);
  // Índice del ítem para el que está abierto el buscador de catálogo (popup).
  const [pickerIndex, setPickerIndex] = useState(null);
  const [items, setItems] = useState([
    {
      uid: generarUid(),
      id_item: null,
      orden: null,
      sku: "",
      producto: "",
      categoria: "",
      formato: "",
      cantidad: 0,
      precio: 0,
      total: 0,
      observacion: "",
      mostrarObs: false,
      precioManual: false,
      precioUnitarioStr: "",
    },
  ]);

  const [campaignPriceBySku, setCampaignPriceBySku] = useState(new Map());
  const [hydrated, setHydrated] = useState(false);

  /* ============================================================
     ✅ REGLA DE EDICIÓN + ESTILOS GRIS (disabled)
============================================================ */
  const esEditable = estado === "En espera" || estado === "Pendiente Aprobación";
  const estadoBloqueadoPendiente =
    !esAdmin && estadoActualDB === "Pendiente Aprobación";
  const puedeEditarEstado = !estadoBloqueadoPendiente;

  useEffect(() => {
    setDocDerivaDeId("");
    if (docTipo !== "orden_compra") {
      setDocMonto("");
      setDocFechaOC(fechaHoyISO());
    }
  }, [docTipo]);

  const opcionesDeriva = useMemo(() => {
    if (docTipo === "guia_despacho") {
      return documentos.filter((d) => d.tipo === "orden_compra");
    }
    // El comprobante de transferencia se asocia a la boleta/factura que paga.
    if (docTipo === "comprobante_pago") {
      return documentos.filter((d) => d.tipo === "factura_boleta");
    }
    // El pago en efectivo puede asociarse a la factura o boleta que paga.
    if (docTipo === "efectivo") {
      return documentos.filter((d) => d.tipo === "factura_boleta");
    }
    // La información de despacho (particular) puede asociarse a la
    // factura/boleta que se despacha.
    if (docTipo === "info_despacho") {
      return documentos.filter((d) => d.tipo === "factura_boleta");
    }
    return [];
  }, [docTipo, documentos]);

  const opcionesDerivaSelect = useMemo(
    () =>
      opcionesDeriva.map((d) => ({
        value: String(d.id),
        label: `${DOC_TIPOS[d.tipo] || d.tipo}${d.numero ? ` - ${d.numero}` : ""}`,
      })),
    [opcionesDeriva]
  );

  const inputClass =
    "w-full rounded-md border border-gray-300 px-3 py-2 " +
    "disabled:bg-gray-100 disabled:text-gray-500 disabled:cursor-not-allowed disabled:border-gray-200";

  const inputClassH10 =
    "w-full h-10 rounded-md border border-gray-300 px-3 " +
    "disabled:bg-gray-100 disabled:text-gray-500 disabled:cursor-not-allowed disabled:border-gray-200";

  const textareaClass =
    "w-full min-h-[110px] rounded-md border border-gray-300 px-3 py-2 text-sm " +
    "disabled:bg-gray-100 disabled:text-gray-500 disabled:cursor-not-allowed disabled:border-gray-200";

  const btnDisabled = "opacity-50 cursor-not-allowed pointer-events-none";

  /* ============================================================
     ✅ Persistir items inmediatamente (para evitar perder orden si cae la página)
============================================================ */
  function persistirDraftItems(nextItems) {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const draft = raw ? JSON.parse(raw) : {};
      draft.items = nextItems;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
    } catch {}
  }

  /* ============================================================
     Cliente helpers
============================================================ */
  async function buscarClientePorRut(rut) {
    if (!rut) return;

    try {
      const data = await api.get(`/clientes?rut=${encodeURIComponent(rut)}`);
      if (!data) return;

      setNombreEntidad(data.nombre || "");
      setDepartamento(data.departamento || "");
      setMunicipalidad(data.municipalidad || "");
      setRegion(data.region || "");
      setComuna(data.comuna || "");
      setDireccion(data.direccion || "");
      setContacto(data.contacto || "");
      setEmail(data.email || "");
      setTelefono(data.telefono || "");
      setClienteBase({
        direccion: data.direccion || "",
        comuna: data.comuna || "",
        contacto: data.contacto || "",
        telefono: data.telefono || "",
        email: data.email || "",
      });
      setCondVenta(data.condiciones_venta || "");
      const tc = (data.tipo_cliente || "").toString().trim();
      if (tc) setTipoCliente(tc);
    } catch (e) {
      // Client not found or error - ignore
    }
  }

  async function crearClienteSiNoExiste() {
    if (!rutEntidad) return;

    let existe = null;
    try {
      existe = await api.get(`/clientes?rut=${encodeURIComponent(rutEntidad)}`);
    } catch (e) {
      // Client not found - proceed to create
    }

    if (existe) {
      // Sincronizar tipo_cliente en la ficha del cliente si cambió en la cotización.
      const tcActual = (existe.tipo_cliente || "").toString().trim();
      const tcNuevo = (tipoCliente || "").toString().trim();
      if (tcNuevo && tcNuevo !== tcActual && existe.id) {
        try {
          await api.put(`/clientes/${existe.id}`, { tipo_cliente: tcNuevo });
        } catch (errUpd) {
          console.warn("No se pudo actualizar tipo_cliente del cliente:", errUpd);
        }
      }
      return;
    }

    // Cliente particular: queda anexado al vendedor de la cotización.
    const esParticular = (tipoCliente || "").toString().trim().toLowerCase() === "cliente particular";
    try {
      await api.post("/clientes", {
        rut: rutEntidad,
        nombre: nombreEntidad,
        departamento,
        municipalidad,
        region,
        comuna,
        direccion,
        contacto,
        email,
        telefono,
        condiciones_venta: condVenta,
        tipo_cliente: tipoCliente || null,
        vendedor_asignado: esParticular ? ((vendedorCorreo || "").trim() || null) : null,
      });
    } catch (error) {
      console.error("Error creando cliente:", error);
      throw new Error("No se pudo crear el cliente");
    }
  }

  // Guarda solo el Tipo de Cliente cuando la cotización está bloqueada por
  // estado (Adjudicada, Perdida, Cancelada). Persiste el cambio en la
  // cotización y, si existe, también lo sincroniza en la ficha del cliente.
  async function guardarSoloTipoCliente() {
    if (!tipoCliente || tipoCliente === tipoClienteGuardado) return;
    setGuardandoTipoCliente(true);
    try {
      const payload = { tipo_cliente: tipoCliente };
      // Alinear tipo_compra con el nuevo tipo de cotización: si queda solo
      // tipo_cliente, Documentos (y otros gates por tipo_compra) siguen
      // tratando la cotización como licitación pública y no dejan cargar
      // Factura o Boleta.
      if (tipoCliente.toLowerCase() === "cliente particular" && tipoCompra !== "Cliente particular") {
        payload.tipo_compra = "Cliente particular";
      } else if (tipoCliente.toLowerCase() === "entidad pública" && tipoCompra === "Cliente particular") {
        payload.tipo_compra = "Compra ágil";
      }
      await api.put(`/licitaciones/${id}`, payload);
      if (payload.tipo_compra) setTipoCompra(payload.tipo_compra);
      if (rutEntidad) {
        try {
          const existe = await api.get(`/clientes?rut=${encodeURIComponent(rutEntidad)}`);
          if (existe?.id) {
            const tcActual = (existe.tipo_cliente || "").toString().trim();
            if (tipoCliente !== tcActual) {
              await api.put(`/clientes/${existe.id}`, { tipo_cliente: tipoCliente });
            }
          }
        } catch (errCli) {
          console.warn("No se pudo sincronizar tipo_cliente en la ficha del cliente:", errCli);
        }
      }
      setTipoClienteGuardado(tipoCliente);
      setToast({ type: "success", message: "Tipo de cliente actualizado." });
    } catch (e) {
      console.error("Error guardando tipo de cliente:", e);
      setToast({ type: "error", message: "No se pudo guardar el tipo de cliente." });
    } finally {
      setGuardandoTipoCliente(false);
    }
  }

  /* ============================================================
     ✅ Cargar vendedor desde sesión
============================================================ */
  useEffect(() => {
    (async () => {
      try {
        const profile = await api.get("/auth/profile");
        if (!profile) return;

        setRol(profile.rol ?? null);
        setMiCorreo(profile.email || "");

        setVendedorCorreo((prev) => prev || profile.email || "");
        setVendedorNombre(
          (prev) =>
            prev ||
            profile.nombre ||
            ""
        );
        setVendedorCelular(
          (prev) => prev || profile.celular || profile.telefono || ""
        );
      } catch (e) {}
    })();
  }, []);

  async function eliminarLicitacion() {
    if (!esAdmin) return;
    if (guardando || generandoPDF || eliminando) return;
    setEliminando(true);
    setToast(null);

    try {
      const docsLic = await api.get(`/licitaciones/${id}/documentos`);

      for (const doc of docsLic || []) {
        if (!doc?.bucket || !doc?.storage_path) continue;
        try {
          await api.delete(`/licitaciones/storage/file?bucket=${encodeURIComponent(doc.bucket)}&path=${encodeURIComponent(doc.storage_path)}`);
        } catch (errStorage) {
          console.error("Error borrando archivo de storage:", errStorage);
        }
      }

      // Delete all docs for this licitacion
      for (const doc of docsLic || []) {
        if (!doc?.id) continue;
        try {
          await api.delete(`/licitaciones/documentos/${doc.id}`);
        } catch (e) {
          console.error("Error eliminando documento:", e);
        }
      }

      // Delete items - the backend handles this via the licitacion delete
      await api.delete(`/licitaciones/${id}`);

      localStorage.removeItem(STORAGE_KEY);
      setConfirmEliminarOpen(false);
      setToast({ type: "success", message: "Licitación eliminada." });
      requestNavigation(baseLicitaciones, { replace: true });
    } catch (e) {
      console.error("Error eliminando licitación:", e);
      setToast({ type: "error", message: "No se pudo eliminar la licitación." });
      setConfirmEliminarOpen(false);
    } finally {
      setEliminando(false);
    }
  }

  async function aprobarLicitacion() {
    if (!puedeAprobar) return;
    if (aprobando || guardando || generandoPDF || eliminando) return;
    if (estado !== "Pendiente Aprobación") return;

    setAprobando(true);
    setToast(null);

    try {
      await api.put(`/licitaciones/${id}`, { estado: "En espera", margen_aprobado: true });

      setEstado("En espera");
      setEstadoActualDB("En espera");
      setMargenAprobado(true);
      setToast({ type: "success", message: "Licitación aprobada." });
    } catch (e) {
      console.error("Error aprobando licitación:", e);
      setToast({ type: "error", message: "No se pudo aprobar la licitación." });
    } finally {
      setAprobando(false);
    }
  }

  function getCostoParaItem(item) {
    // Costo editado en la cotización (no modifica el producto). Si no se editó,
    // se toma el costo del producto del catálogo.
    if (item?.costo != null && item.costo !== "") return Number(item.costo || 0);
    const sku = String(item?.sku || "").trim();
    const prod =
      (sku
        ? productos.find((p) => String(p.sku || "").trim() === sku)
        : null) || (item?.producto ? productos.find((p) => p.nombre === item.producto) : null);
    return Number(prod?.costo ?? 0);
  }

  function getMetroCubicoParaItem(item) {
    const sku = String(item?.sku || "").trim();
    const prod =
      (sku
        ? productos.find((p) => String(p.sku || "").trim() === sku)
        : null) || (item?.producto ? productos.find((p) => p.nombre === item.producto) : null);
    return normalizarVolumenCm3(prod?.metro_cubico ?? 0);
  }

  function getPesoParaItem(item) {
    const sku = String(item?.sku || "").trim();
    const prod =
      (sku
        ? productos.find((p) => String(p.sku || "").trim() === sku)
        : null) || (item?.producto ? productos.find((p) => p.nombre === item.producto) : null);
    const n = Number(prod?.peso ?? 0);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  function calcularMargenItem(item) {
    const costo = getCostoParaItem(item);
    const precioBase = Number(item?.precio || 0);
    if (precioBase <= 0) return 0;
    return ((precioBase - costo) / precioBase) * 100;
  }

  function crearItemVacio() {
    return {
      uid: generarUid(),
      id_item: null,
      orden: null,
      sku: "",
      producto: "",
      categoria: "",
      formato: "",
      cantidad: 0,
      precio: 0,
      total: 0,
      observacion: "",
      mostrarObs: false,
      precioManual: false,
      precioUnitarioStr: "",
      costoManual: false,
      costoStr: "",
    };
  }

  function normalizarNombreArchivo(value) {
    return (value ?? "")
      .toString()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9_.-]+/g, "_");
  }

  async function cargarDocumentosLicitacion() {
    try {
      const data = await api.get(`/licitaciones/${id}/documentos`);
      setDocumentos(data || []);
    } catch (error) {
      console.error("Error cargando documentos:", error);
      setDocumentos([]);
    }
  }

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
      console.error("Error creando URL firmada:", error);
      setToast({ type: "error", message: "No se pudo abrir el documento." });
    }
  }

  async function eliminarDocumento(doc) {
    if (!doc?.id) return;

    setToast(null);

    try {
      await api.delete(`/licitaciones/documentos/${doc.id}`);
    } catch (errDb) {
      console.error("Error eliminando documento:", errDb);
      setToast({ type: "error", message: "No se pudo eliminar el documento." });
      return;
    }

    if (doc.bucket && doc.storage_path) {
      try {
        await api.delete(`/licitaciones/storage/file?bucket=${encodeURIComponent(doc.bucket)}&path=${encodeURIComponent(doc.storage_path)}`);
      } catch (errStorage) {
        console.error("Error borrando archivo de storage:", errStorage);
      }
    }

    setToast({ type: "success", message: "Documento eliminado." });
    await cargarDocumentosLicitacion();
  }

  function solicitarEliminarDocumento(doc) {
    if (!doc?.id) return;
    setDocAEliminar(doc);
    setConfirmEliminarDocOpen(true);
  }

  function iniciarEdicionDocumento(doc) {
    if (!doc?.id) return;
    setDocEditando(doc);
    setDocEditNumero(doc.numero || "");
    setDocEditMonto(doc.monto != null ? String(doc.monto) : "");
    // Si la DB retorna timestamptz ("2026-05-15T03:00:00+00:00"), DateFilter
    // no puede parsearlo. Lo recortamos a YYYY-MM-DD.
    setDocEditFechaOC(aIsoFechaCorta(doc.fecha_oc));
    setDocEditFileName(doc.file_name || "");
    setDocEditTracking(doc.n_seguimiento || "");
  }

  function cancelarEdicionDocumento() {
    setDocEditando(null);
    setDocEditNumero("");
    setDocEditMonto("");
    setDocEditFechaOC("");
    setDocEditFileName("");
    setDocEditTracking("");
  }

  async function guardarEdicionDocumento() {
    if (!docEditando?.id) return;
    setGuardandoDocEdit(true);
    try {
      // Tipos cuya fecha se persiste en fecha_oc (no en fecha_factura):
      // OC, Factura/Boleta y Comprobante de Transferencia. La Guía también
      // usa fecha_oc pero su edición está restringida más arriba en el flujo.
      const tiposConFechaOc = ["orden_compra", "factura_boleta", "comprobante_pago", "efectivo"];
      const payload = {
        numero: docEditNumero.trim() || null,
        monto: docEditMonto ? Number(docEditMonto) : null,
      };
      if (tiposConFechaOc.includes(docEditando.tipo) && docEditFechaOC) {
        payload.fecha_oc = docEditFechaOC;
      }
      // Admin y jefe_ventas_especial: pueden editar el nombre del documento y,
      // en las guías de despacho, el N° de tracking.
      if (puedeEditarDocAvanzado) {
        payload.file_name = docEditFileName.trim() || null;
        if (docEditando.tipo === "guia_despacho") {
          payload.n_seguimiento = docEditTracking.trim() || null;
        }
      }
      await api.put(`/licitaciones/documentos/${docEditando.id}`, payload);
      setToast({ type: "success", message: "Documento actualizado." });
      cancelarEdicionDocumento();
      await cargarDocumentosLicitacion();
    } catch (e) {
      console.error(e);
      setToast({ type: "error", message: "Error actualizando documento." });
    } finally {
      setGuardandoDocEdit(false);
    }
  }

  async function confirmarEliminarDocumento() {
    const doc = docAEliminar;
    setConfirmEliminarDocOpen(false);
    setDocAEliminar(null);
    await eliminarDocumento(doc);
  }

  async function subirDocumento() {
    if (subiendoDoc) return;
    setToast(null);

    const tipo = String(docTipo || "").trim();

    // Información de despacho (Cliente Particular): no lleva archivo; solo
    // empresa + N° de seguimiento (interno → correlativo automático AMSO).
    if (tipo === "info_despacho") {
      const empresa = (docEmpresa || "").trim();
      if (!empresa) {
        setToast({ type: "error", message: "Debes seleccionar la empresa de despacho." });
        return;
      }
      const esInterno = empresa === "Despacho interno";
      setSubiendoDoc(true);
      try {
        // Documento adjunto OPCIONAL.
        let bucket = null, storagePath = null, fileName = null, mimeType = null, sizeBytes = null;
        const file = docFile;
        if (file) {
          bucket = "factura";
          const ext = (file.name.split(".").pop() || "pdf").toLowerCase();
          const safeName = normalizarNombreArchivo(file.name.replace(/\.[^.]+$/, ""));
          const fn = `${Date.now()}-${Math.random().toString(36).slice(2)}-${safeName}.${ext}`;
          storagePath = `${id}/${fn}`;
          const formData = new FormData();
          formData.append("file", file);
          await api.postForm(`/licitaciones/storage/upload?bucket=${encodeURIComponent(bucket)}&path=${encodeURIComponent(storagePath)}`, formData);
          fileName = file.name;
          mimeType = file.type || "application/octet-stream";
          sizeBytes = Number(file.size || 0);
        }
        await api.post("/licitaciones/documentos", {
          licitacion_id: Number(id),
          tipo: "info_despacho",
          empresa_despacho: empresa,
          n_seguimiento: esInterno ? null : ((docNumSeguimiento || "").trim() || null),
          // Factura/boleta asociada al despacho (opcional).
          deriva_de_id: docDerivaDeId ? Number(docDerivaDeId) : null,
          bucket,
          storage_path: storagePath,
          file_name: fileName,
          mime_type: mimeType,
          size_bytes: sizeBytes,
        });
        setDocEmpresa("Starken");
        setDocNumSeguimiento("");
        setDocDerivaDeId("");
        setDocFile(null);
        if (fileInputRef.current) fileInputRef.current.value = "";
        setToast({ type: "success", message: "Información de despacho registrada." });
        await cargarDocumentosLicitacion();
        // Avisar al detector de correos para levantar el popup de agradecimiento.
        window.dispatchEvent(new Event("correos:check"));
      } catch (e) {
        console.error("Error registrando info de despacho:", e);
        setToast({ type: "error", message: "No se pudo registrar la información de despacho." });
      } finally {
        setSubiendoDoc(false);
      }
      return;
    }

    const file = docFile;
    if (!file) {
      setToast({ type: "error", message: "Debes seleccionar un PDF." });
      return;
    }

    const bucket = DOC_BUCKET_BY_TIPO[tipo];
    if (!bucket) {
      setToast({ type: "error", message: "Tipo de documento inválido." });
      return;
    }
    const montoNetoOrdenCompra = parseMontoCL(docMonto);
    if (tipo === "orden_compra" && montoNetoOrdenCompra <= 0) {
      setToast({
        type: "error",
        message: "Debes ingresar el monto neto de la orden de compra.",
      });
      return;
    }
    // Cliente Particular: Factura/Boleta exige monto neto + fecha (igual que OC).
    if (tipo === "factura_boleta" && montoNetoOrdenCompra <= 0) {
      setToast({ type: "error", message: "Debes ingresar el monto neto de la factura o boleta." });
      return;
    }
    if (tipo === "efectivo" && montoNetoOrdenCompra <= 0) {
      setToast({ type: "error", message: "Debes ingresar el monto neto del pago en efectivo." });
      return;
    }
    if ((tipo === "comprobante_pago" || tipo === "webpay") && montoNetoOrdenCompra <= 0) {
      setToast({ type: "error", message: "Debes ingresar el monto neto del comprobante." });
      return;
    }
    const fechaOc = (docFechaOC || "").toString().trim();
    if (tipo === "orden_compra" && !fechaOc) {
      setToast({
        type: "error",
        message: "Debes ingresar la fecha de la orden de compra.",
      });
      return;
    }
    if (tipo === "factura_boleta" && !fechaOc) {
      setToast({ type: "error", message: "Debes ingresar la fecha de la factura o boleta." });
      return;
    }
    if ((tipo === "comprobante_pago" || tipo === "webpay") && !fechaOc) {
      setToast({ type: "error", message: "Debes ingresar la fecha del comprobante." });
      return;
    }
    if (tipo === "efectivo" && !fechaOc) {
      setToast({ type: "error", message: "Debes ingresar la fecha del pago en efectivo." });
      return;
    }

    if (tipo === "guia_despacho" && !fechaOc) {
      setToast({ type: "error", message: "Debes ingresar la fecha de la guía." });
      return;
    }
    if (tipo === "guia_despacho" && !(docEmpresa || "").trim()) {
      setToast({ type: "error", message: "Debes seleccionar la empresa de despacho." });
      return;
    }
    const montoGuia = parseMontoCL(docMonto);
    if (tipo === "guia_despacho" && montoGuia <= 0) {
      setToast({ type: "error", message: "Debes ingresar el monto neto de la guía." });
      return;
    }

    const esPdf =
      file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
    if (!esPdf) {
      setToast({ type: "error", message: "Solo se permite subir archivos PDF." });
      return;
    }

    if (tipo === "guia_despacho" && !docDerivaDeId) {
      setToast({
        type: "error",
        message: "La guía de despacho debe derivar de una orden de compra.",
      });
      return;
    }

    if (tipo === "guia_despacho") {
      const docOrigen = documentos.find(
        (d) => String(d.id) === String(docDerivaDeId)
      );
      if (!docOrigen || docOrigen.tipo !== "orden_compra") {
        setToast({
          type: "error",
          message: "La guía de despacho debe vincularse a una orden de compra válida.",
        });
        return;
      }
    }

    if ((tipo === "comprobante_pago" || tipo === "webpay") && !docDerivaDeId) {
      setToast({
        type: "error",
        message: "Debes asociar el comprobante a la boleta o factura del pago.",
      });
      return;
    }

    if (tipo === "comprobante_pago" || tipo === "webpay") {
      const docOrigen = documentos.find(
        (d) => String(d.id) === String(docDerivaDeId)
      );
      if (!docOrigen || docOrigen.tipo !== "factura_boleta") {
        setToast({
          type: "error",
          message: "El comprobante debe vincularse a una boleta o factura válida.",
        });
        return;
      }
    }

    // Efectivo: la factura/boleta asociada es opcional, pero si se elige debe
    // ser válida.
    if (tipo === "efectivo" && docDerivaDeId) {
      const docOrigen = documentos.find(
        (d) => String(d.id) === String(docDerivaDeId)
      );
      if (!docOrigen || docOrigen.tipo !== "factura_boleta") {
        setToast({
          type: "error",
          message: "El pago en efectivo debe vincularse a una boleta o factura válida.",
        });
        return;
      }
    }

    setSubiendoDoc(true);

    try {
      const ext = (file.name.split(".").pop() || "pdf").toLowerCase();
      const safeName = normalizarNombreArchivo(file.name.replace(/\.[^.]+$/, ""));
      const fileName = `${Date.now()}-${Math.random()
        .toString(36)
        .slice(2)}-${safeName}.${ext}`;
      const storagePath = `${id}/${fileName}`;

      const formData = new FormData();
      formData.append("file", file);

      await api.postForm(`/licitaciones/storage/upload?bucket=${encodeURIComponent(bucket)}&path=${encodeURIComponent(storagePath)}`, formData);

      const esGuia = tipo === "guia_despacho";
      const empresaGuia = esGuia ? (docEmpresa || "").trim() : null;
      const esDespachoInterno = empresaGuia === "Despacho interno";
      const esFacturaBoleta = tipo === "factura_boleta";
      const esComprobantePago = tipo === "comprobante_pago";
      const esWebpay = tipo === "webpay";
      const esEfectivo = tipo === "efectivo";
      const tieneMonto = tipo === "orden_compra" || esFacturaBoleta || esEfectivo || esComprobantePago || esWebpay;
      const tieneFecha = tipo === "orden_compra" || esGuia || esFacturaBoleta || esComprobantePago || esWebpay || esEfectivo;

      const payload = {
        licitacion_id: Number(id),
        tipo,
        numero: (docNumero || "").trim() || null,
        monto: tieneMonto ? montoNetoOrdenCompra : (esGuia && montoGuia > 0 ? montoGuia : null),
        fecha_oc: tieneFecha ? fechaOc : null,
        deriva_de_id: docDerivaDeId ? Number(docDerivaDeId) : null,
        empresa_despacho: esGuia ? empresaGuia : null,
        n_seguimiento: esGuia && !esDespachoInterno ? ((docNumSeguimiento || "").trim() || null) : null,
        url: esWebpay ? ((docUrl || "").trim() || null) : null,
        bucket,
        storage_path: storagePath,
        file_name: file.name,
        mime_type: file.type || "application/pdf",
        size_bytes: Number(file.size || 0),
      };

      try {
        await api.post("/licitaciones/documentos", payload);
      } catch (insErr) {
        // Clean up uploaded file on failure
        try {
          await api.delete(`/licitaciones/storage/file?bucket=${encodeURIComponent(bucket)}&path=${encodeURIComponent(storagePath)}`);
        } catch (_) {}
        throw insErr;
      }

      setDocNumero("");
      setDocMonto("");
      setDocFechaOC(fechaHoyISO());
      setDocDerivaDeId("");
      setDocEmpresa("Starken");
      setDocNumSeguimiento("");
      setDocUrl("");
      setDocFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      setToast({
        type: "success",
        message: "Documento cargado correctamente.",
      });
      await cargarDocumentosLicitacion();
      // Fase 1 correos: avisar al detector global para que revise si hay un
      // correo pendiente (agradecimiento OC / envío de guía) recién generado.
      if (tipo === "orden_compra" || tipo === "guia_despacho") {
        window.dispatchEvent(new Event("correos:check"));
      }
    } catch (e) {
      console.error("Error subiendo documento:", {
        code: e?.code,
        message: e?.message,
        details: e?.details,
        hint: e?.hint,
        raw: e,
      });
      const detalle = [e?.code, e?.message].filter(Boolean).join(" - ");
      setToast({
        type: "error",
        message: detalle
          ? `No se pudo cargar el documento. ${detalle}`
          : "No se pudo cargar el documento.",
      });
    } finally {
      setSubiendoDoc(false);
    }
  }

  /* ============================================================
     BORRADOR
============================================================ */
  useEffect(() => {
    const guardado = localStorage.getItem(STORAGE_KEY);
    if (!guardado) return;

    try {
      const data = JSON.parse(guardado);

      setIdLicitacionInput(data.idLicitacionInput || "");
      setNombre(data.nombre || "");
      setFechaHoraCierre(data.fechaHoraCierre || "");
      setMonto(data.monto || "");
      setListado(data.listado || "1");
      setEstado(data.estado || "En espera");
      setTipoCompra(data.tipoCompra || "Compra ágil");
      setMargenAprobado(Boolean(data.margenAprobado || data.margen_aprobado));
      setMontoAdicionalOC(data.montoAdicionalOC || "");

      setRutEntidad(data.rutEntidad || "");
      setNombreEntidad(data.nombreEntidad || "");
      setGiro(data.giro || "");
      setTipoCliente(data.tipoCliente || "");
      setDepartamento(data.departamento || "");
      setMunicipalidad(data.municipalidad || "");
      setRegion(data.region || "");
      setComuna(data.comuna || "");
      setDireccion(data.direccion || "");
      setSucursal(data.sucursal || "");
      setContacto(data.contacto || "");
      setEmail(data.email || "");
      setTelefono(data.telefono || "");
      setCondVenta(data.condVenta || "");

      setFleteEstimado(data.fleteEstimado || 0);
      setObservaciones(data.observaciones || "");
      setMotivoPerdida(data.motivoPerdida || "");
      setMotivoPerdidaOtro(data.motivoPerdidaOtro || "");
      setMotivoDescarte(data.motivoDescarte || "");
      setComentarioDescarte(data.comentarioDescarte || "");

      setVendedorNombre(data.vendedorNombre || "");
      setVendedorCelular(data.vendedorCelular || "");
      setVendedorCorreo(data.vendedorCorreo || "");

      const cargados = Array.isArray(data.items) ? data.items : [];
      setItems(
        cargados.length
          ? cargados.map((it) => ({
              uid: it.uid || generarUid(),
              id_item: it.id_item ?? null,
              orden: it.orden ?? null,
              sku: it.sku || "",
              producto: it.producto || "",
              categoria: it.categoria || "",
              formato: it.formato || "",
              cantidad: Number(it.cantidad || 0),
              precio: Number(it.precio || 0),
              total: Number(it.total || 0),
              observacion: it.observacion || "",
              mostrarObs: Boolean(it.mostrarObs),
              precioManual: Boolean(it.precioManual),
              precioUnitarioStr: it.precioUnitarioStr || "",
            }))
          : [crearItemVacio()]
      );
    } catch (e) {
      console.error("Error cargando borrador edición", e);
    } finally {
      setHydrated(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [STORAGE_KEY]);

  useEffect(() => {
    if (!hydrated) return;

    const data = {
      idLicitacionInput,
      nombre,
      fechaHoraCierre,
      monto,
      listado,
      estado,
      margenAprobado,
      tipoCompra,
      rutEntidad,
      nombreEntidad,
      departamento,
      municipalidad,
      region,
      comuna,
      direccion,
      sucursal,
      contacto,
      email,
      telefono,
      condVenta,
      fleteEstimado,
      items,
      observaciones,
      vendedorNombre,
      vendedorCelular,
      vendedorCorreo,
      montoAdicionalOC,
    };

    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }, [
    hydrated,
    STORAGE_KEY,
    idLicitacionInput,
    nombre,
    fechaHoraCierre,
    monto,
    montoAdicionalOC,
    listado,
    estado,
    margenAprobado,
    tipoCompra,
    rutEntidad,
    nombreEntidad,
    departamento,
    municipalidad,
    region,
    comuna,
    direccion,
    sucursal,
    contacto,
    email,
    telefono,
    condVenta,
    fleteEstimado,
    items,
    observaciones,
    vendedorNombre,
    vendedorCelular,
    vendedorCorreo,
  ]);

  /* ============================================================
     DETECCIÓN DE CAMBIOS
============================================================ */
  function buildSnapshot() {
    const montoPresupuestoNeto = parseMontoCL(monto);
    return JSON.stringify({
      idLicitacionInput: idLicitacionInput || "",
      nombre: nombre || "",
      fechaHoraCierre: fechaHoraCierre || "",
      monto: montoPresupuestoNeto,
      listado: String(listado || "1"),
      estado: estado || "En espera",
      margenAprobado: Boolean(margenAprobado),
      tipoCompra: tipoCompra || "Compra ágil",

      rutEntidad: rutEntidad || "",
      nombreEntidad: nombreEntidad || "",
      departamento: departamento || "",
      municipalidad: municipalidad || "",
      region: region || "",
      comuna: comuna || "",
      direccion: direccion || "",
      contacto: contacto || "",
      email: email || "",
      telefono: telefono || "",
      condVenta: condVenta || "",

      fleteEstimado: Number(fleteEstimado || 0),
      observaciones: observaciones || "",

      vendedorNombre: vendedorNombre || "",
      vendedorCelular: vendedorCelular || "",
      vendedorCorreo: vendedorCorreo || "",

      // el orden queda implícito por el orden del arreglo
      // NOTA: id_item y orden son metadatos del backend (asignados tras guardar),
      // no campos editables por el usuario → se excluyen del snapshot para no
      // marcar dirty cuando el backend devuelve los IDs recién insertados.
      items: (items || []).map((it) => ({
        uid: it.uid,
        sku: it.sku || "",
        producto: it.producto || "",
        categoria: it.categoria || "",
        formato: it.formato || "",
        cantidad: Number(it.cantidad || 0),
        precio: Number(it.precio || 0),
        observacion: it.observacion || "",
        mostrarObs: Boolean(it.mostrarObs),
        precioManual: Boolean(it.precioManual),
        precioUnitarioStr: it.precioUnitarioStr || "",
      })),
    });
  }

  useEffect(() => {
    baselineRef.current = null;
    setIsDirty(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    if (!hydrated) return;
    if (loading) return;

    if (!baselineRef.current) {
      baselineRef.current = buildSnapshot();
      setIsDirty(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, loading]);

  useEffect(() => {
    if (!baselineRef.current) return;
    const now = buildSnapshot();
    setIsDirty(now !== baselineRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    hydrated,
    loading,
    idLicitacionInput,
    nombre,
    fechaHoraCierre,
    monto,
    listado,
    estado,
    tipoCompra,
    rutEntidad,
    nombreEntidad,
    departamento,
    municipalidad,
    region,
    comuna,
    direccion,
    sucursal,
    contacto,
    email,
    telefono,
    condVenta,
    fleteEstimado,
    items,
    observaciones,
    vendedorNombre,
    vendedorCelular,
    vendedorCorreo,
  ]);

  async function descartarCambios() {
    localStorage.removeItem(STORAGE_KEY);
    setLoading(true);

    let lic, itemsDB;
    try {
      lic = await api.get(`/licitaciones/${id}`);
    } catch (errLic) {
      setToast({ type: "error", message: "Error recargando la licitación" });
      setLoading(false);
      return;
    }

    if (!lic) {
      setToast({ type: "error", message: "Error recargando la licitación" });
      setLoading(false);
      return;
    }

    // ✅ ORDER FIX
    try {
      itemsDB = await api.get(`/licitaciones/${id}/items`);
    } catch (e) {
      itemsDB = [];
    }

    setIdLicitacionInput(lic.id_licitacion || "");
    setNombre(lic.nombre || "");
    setFechaHoraCierre(lic.fecha_hora_cierre || "");
    setMonto(lic.monto || "");
    setListado(String(lic.lista_precios || "1"));
    setEstado(lic.estado || "En espera");
    setEstadoActualDB(lic.estado || "En espera");
    setFechaAdjudicada(lic.fecha_adjudicada || null);
    setFechaCreacionLic(lic.fecha || lic.created_at || null);
    setMargenAprobado(Boolean(lic.margen_aprobado));
    setCicloCerrado(Boolean(lic.ciclo_cerrado));
    setTipoCompra(lic.tipo_compra || "Compra ágil");

    setRutEntidad(lic.rut_entidad || "");
    setNombreEntidad(lic.nombre_entidad || "");
    setGiro(lic.giro || "");
    if (lic.tipo_cliente) setTipoCliente(lic.tipo_cliente);
    setTipoClienteGuardado(lic.tipo_cliente || "");
    setDepartamento(lic.departamento || "");
    setMunicipalidad(lic.municipalidad || "");
    setRegion(lic.region || "");
    setComuna(lic.comuna || "");
    setDireccion(lic.direccion || "");
    setSucursal(lic.sucursal || "");
    setContacto(lic.contacto || "");
    setEmail(lic.email || "");
    setTelefono(lic.telefono || "");
    setCondVenta(lic.condicion_venta || "");
    setFleteEstimado(lic.flete_estimado || 0);

    setObservaciones(lic.observaciones || "");
    setMotivoPerdida(lic.motivo_perdida || "");
    setMotivoPerdidaOtro(lic.motivo_perdida_otro || "");
    setMotivoDescarte(lic.motivo_descarte || "");
    setComentarioDescarte(lic.comentario_descarte || "");

    setVendedorNombre(lic.vendedor_nombre || "");
    setVendedorCelular(lic.vendedor_celular || "");
    setVendedorCorreo(lic.vendedor_correo || "");
    await cargarDocumentosLicitacion();

    const cantidadProductosDB = (itemsDB || []).reduce(
      (acc, it) => acc + Number(it.cantidad || 0),
      0
    );

    const fletePorUnidadDB =
      cantidadProductosDB > 0
        ? redondear(Number(lic.flete_estimado || 0) / cantidadProductosDB)
        : 0;

    const itemsNormalizados =
      (itemsDB || []).map((i) => {
        const cantidad = Math.max(1, Number(i.cantidad || 1));
        const valorUnit = Number(i.valor_unitario || 0);
        const precioBase = Math.max(0, valorUnit - fletePorUnidadDB);

        return {
          uid: generarUid(),
          id_item: i.id,
          orden: i.orden ?? null,
          sku: i.sku || "",
          producto: i.producto || "",
          categoria: i.categoria || "",
          formato: i.formato || "",
          cantidad,
          precio: precioBase,
          total: redondear(cantidad * (precioBase + fletePorUnidadDB)),
          observacion: i.observacion || "",
          mostrarObs: Boolean(i.observacion),
          precioManual: false,
          precioUnitarioStr: "",
        };
      }) || [];

    setItems(itemsNormalizados.length > 0 ? itemsNormalizados : [crearItemVacio()]);

    setHydrated(true);
    setLoading(false);

    baselineRef.current = null;
    setIsDirty(false);

    setToast({ type: "success", message: "Cambios descartados correctamente." });
  }

  useEffect(() => {
    saveHandlerRef.current = guardarCambios;
  });

  useEffect(() => {
    discardHandlerRef.current = descartarCambios;
  });

  useEffect(() => {
    registerDiscardHandler(() => discardHandlerRef.current?.());
    registerSaveHandler(() => saveHandlerRef.current?.());

    return () => {
      clearDiscardHandler();
      clearSaveHandler();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    return () => {
      setIsDirty(false);
      baselineRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ============================================================
     Cargar productos
============================================================ */
  useEffect(() => {
    async function cargarProductos() {
      try {
        const data = await api.get("/productos");
        // Punto 38: ocultar productos Inactivos del selector de la cotización.
        const visibles = (data || []).filter((p) => (p?.estado || "") !== "Inactivo");
        setProductos(visibles);
      } catch (e) {
        console.error("Error cargando productos:", e);
        setProductos([]);
      }
    }
    cargarProductos();
  }, []);

  /* ============================================================
     Campañas vigentes
============================================================ */
  useEffect(() => {
    async function cargarCampaniasVigentes() {
      try {
        const data = await api.get("/productos/campaign-prices");

        const m = new Map();
        (data || []).forEach((row) => {
          const sku = row?.sku;
          if (!sku) return;
          if (!m.has(sku)) m.set(sku, Number(row.precio_campania || 0));
        });

        setCampaignPriceBySku(m);
      } catch (error) {
        console.error("Error cargando campañas vigentes:", error);
        setCampaignPriceBySku(new Map());
      }
    }

    cargarCampaniasVigentes();
  }, []);

  /* ============================================================
     Cargar licitación + items desde BD (si no hay borrador)
============================================================ */
  useEffect(() => {
    async function cargarTodoDB() {
      if (hydrated && localStorage.getItem(STORAGE_KEY)) {
        await cargarDocumentosLicitacion();
        setLoading(false);
        return;
      }

      setLoading(true);

      let lic, itemsDB;
      try {
        lic = await api.get(`/licitaciones/${id}`);
      } catch (errLic) {
        setToast({ type: "error", message: "Error cargando la licitación" });
        setLoading(false);
        return;
      }

      if (!lic) {
        setToast({ type: "error", message: "Error cargando la licitación" });
        setLoading(false);
        return;
      }

      // ✅ ORDER FIX
      try {
        itemsDB = await api.get(`/licitaciones/${id}/items`);
      } catch (e) {
        itemsDB = [];
      }

      setIdLicitacionInput(lic.id_licitacion || "");
      setNombre(lic.nombre || "");
      setFechaHoraCierre(lic.fecha_hora_cierre || "");
      setMonto(lic.monto || "");
      setListado(String(lic.lista_precios || "1"));
      setEstado(lic.estado || "En espera");
      setEstadoActualDB(lic.estado || "En espera");
      setFechaAdjudicada(lic.fecha_adjudicada || null);
    setFechaCreacionLic(lic.fecha || lic.created_at || null);
      setMargenAprobado(Boolean(lic.margen_aprobado));
      setCicloCerrado(Boolean(lic.ciclo_cerrado));
      setTipoCompra(lic.tipo_compra || "Compra ágil");

      setRutEntidad(lic.rut_entidad || "");
      setNombreEntidad(lic.nombre_entidad || "");
      setGiro(lic.giro || "");
      if (lic.tipo_cliente) setTipoCliente(lic.tipo_cliente);
      setTipoClienteGuardado(lic.tipo_cliente || "");
      setDepartamento(lic.departamento || "");
      setMunicipalidad(lic.municipalidad || "");
      setRegion(lic.region || "");
      setComuna(lic.comuna || "");
      setDireccion(lic.direccion || "");
      setSucursal(lic.sucursal || "");
      setContacto(lic.contacto || "");
      setEmail(lic.email || "");
      setTelefono(lic.telefono || "");
      setCondVenta(lic.condicion_venta || "");
      setFleteEstimado(lic.flete_estimado || 0);

      setObservaciones(lic.observaciones || "");
      setMotivoPerdida(lic.motivo_perdida || "");
      setMotivoPerdidaOtro(lic.motivo_perdida_otro || "");
      setMotivoDescarte(lic.motivo_descarte || "");
      setComentarioDescarte(lic.comentario_descarte || "");

      setVendedorNombre(lic.vendedor_nombre || "");
      setVendedorCelular(lic.vendedor_celular || "");
      setVendedorCorreo(lic.vendedor_correo || "");
      await cargarDocumentosLicitacion();

      const cantidadProductosDB = (itemsDB || []).reduce(
        (acc, it) => acc + Number(it.cantidad || 0),
        0
      );

      const fletePorUnidadDB =
        cantidadProductosDB > 0
          ? redondear(Number(lic.flete_estimado || 0) / cantidadProductosDB)
          : 0;

      const itemsNormalizados =
        (itemsDB || []).map((i) => {
          const cantidad = Math.max(1, Number(i.cantidad || 1));
          const valorUnit = Number(i.valor_unitario || 0);
          const precioBase = Math.max(0, valorUnit - fletePorUnidadDB);

          return {
            uid: generarUid(),
            id_item: i.id,
            orden: i.orden ?? null,
            sku: i.sku || "",
            producto: i.producto || "",
            categoria: i.categoria || "",
            formato: i.formato || "",
            cantidad,
            precio: precioBase,
            total: redondear(cantidad * (precioBase + fletePorUnidadDB)),
            observacion: i.observacion || "",
            mostrarObs: Boolean(i.observacion),
            precioManual: false,
            precioUnitarioStr: "",
          };
        }) || [];

      setItems(itemsNormalizados.length > 0 ? itemsNormalizados : [crearItemVacio()]);

      setHydrated(true);
      setLoading(false);
    }

    cargarTodoDB();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, hydrated, STORAGE_KEY]);

  /* ============================================================
     OPCIONES SELECT
============================================================ */
  const opcionesSKU = productos
    .filter((p) => String(p.sku || "").trim() !== "")
    .map((p) => ({
      value: String(p.sku).trim(),
      label: String(p.sku).trim(),
    }));

  const opcionesProducto = productos.map((p) => ({
    value: p.nombre,
    label: p.nombre,
  }));

  /* ============================================================
     RESUMEN
============================================================ */
  const cantidadProductos = items.reduce(
    (acc, it) => acc + Number(it.cantidad || 0),
    0
  );

  const fletePorUnidad =
    cantidadProductos > 0
      ? redondear(Number(fleteEstimado) / cantidadProductos)
      : 0;

  const margenGeneral = useMemo(() => {
    let totalVenta = 0;
    let totalCosto = 0;
    items.forEach((it) => {
      const cantidad = Math.max(1, Number(it.cantidad || 1));
      const precioBase = Number(it.precio || 0);
      const costo = getCostoParaItem(it);
      totalVenta += precioBase * cantidad;
      totalCosto += costo * cantidad;
    });
    if (totalVenta <= 0) return 0;
    return ((totalVenta - totalCosto) / totalVenta) * 100;
  }, [items, productos]);

  /* ============================================================
     ✅ Precio Unitario editable
============================================================ */
  function actualizarPrecioUnitario(index, valorStr) {
    if (!esEditable) return;

    const copia = [...items];
    const item = { ...copia[index] };

    item.precioUnitarioStr = formatearCLDesdeString(valorStr);
    const baseSinFlete = parseMontoCL(item.precioUnitarioStr);
    item.precio = Math.max(0, baseSinFlete);
    item.precioManual = true;

    const cantidad = Math.max(1, Number(item.cantidad || 1));
    const precioConFlete = Number(item.precio || 0) + Number(fletePorUnidad || 0);
    item.total = redondear(cantidad * precioConFlete);

    copia[index] = item;
    setItems(copia);
  }

  function finalizarEdicionPrecioUnitario(index) {
    setItems((prev) => {
      const copia = [...prev];
      const item = { ...copia[index] };
      item.precioUnitarioStr = "";
      copia[index] = item;
      return copia;
    });
  }

  // Costo editable por el admin — solo afecta a esta cotización (el margen),
  // nunca modifica el costo del producto en el catálogo.
  function actualizarCostoItem(index, valorStr) {
    if (!esEditable) return;
    const copia = [...items];
    const item = { ...copia[index] };
    item.costoStr = formatearCLDesdeString(valorStr);
    item.costo = Math.max(0, parseMontoCL(item.costoStr));
    item.costoManual = true;
    copia[index] = item;
    setItems(copia);
  }

  function finalizarEdicionCosto(index) {
    setItems((prev) => {
      const copia = [...prev];
      const item = { ...copia[index] };
      item.costoStr = "";
      copia[index] = item;
      return copia;
    });
  }

  useEffect(() => {
    if (!hydrated) return;

    const copia = items.map((it) => {
      const cantidad = Math.max(1, Number(it.cantidad || 1));

      if (it.precioManual && (it.precioUnitarioStr ?? "") !== "") {
        const baseSinFlete = parseMontoCL(it.precioUnitarioStr);
        const precioConFlete = baseSinFlete + Number(fletePorUnidad || 0);
        return {
          ...it,
          precio: Math.max(0, baseSinFlete),
          total: redondear(cantidad * precioConFlete),
        };
      }

      const precioBase = Number(it.precio || 0);
      return {
        ...it,
        total: redondear(cantidad * (precioBase + fletePorUnidad)),
      };
    });

    setItems(copia);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fletePorUnidad, hydrated]);

  const totalNeto = items.reduce((acc, it) => acc + Number(it.total || 0), 0);
  const totalIVA = Math.round(totalNeto * 0.19);
  const totalConIVA = totalNeto + totalIVA;
  const metroCubicoGeneral = useMemo(
    () =>
      items.reduce((acc, it) => {
        const cantidad = Math.max(1, Number(it.cantidad || 1));
        return acc + getMetroCubicoParaItem(it) * cantidad;
      }, 0),
    [items, productos]
  );
  // Peso total del envío (kg) para el cálculo de flete por courier.
  const pesoTotalGeneral = useMemo(
    () =>
      items.reduce((acc, it) => {
        const cantidad = Math.max(1, Number(it.cantidad || 1));
        return acc + getPesoParaItem(it) * cantidad;
      }, 0),
    [items, productos]
  );
  // Consumido = guías de despacho + facturas/boletas + efectivo (no la OC).
  const montoConsumidoNeto = useMemo(
    () =>
      (documentos || [])
        .filter((d) => {
          const t = (d?.tipo || "").toString();
          return t === "guia_despacho" || t === "factura_boleta" || t === "efectivo";
        })
        .reduce((acc, d) => acc + parseMontoFlexible(d?.monto), 0),
    [documentos]
  );
  const montoConsumido = calcularBrutoDesdeNeto(montoConsumidoNeto);
  const montoPresupuesto = parseMontoCL(monto);
  const saldoPresupuesto = montoPresupuesto - totalConIVA;
  // Ciclo cerrado de forma forzada: el saldo por consumir queda en $0.
  const saldoPorConsumirResumen = cicloCerrado ? 0 : Math.max(0, totalConIVA - montoConsumido);
  const montoNetoOCFormulario = parseMontoCL(docMonto);
  const montoBrutoOCFormulario = calcularBrutoDesdeNeto(montoNetoOCFormulario);

  let porcentajePresupuesto = 0;
  if (montoPresupuesto > 0) porcentajePresupuesto = (totalConIVA / montoPresupuesto) * 100;

  let colorPresupuesto = "";
  if (porcentajePresupuesto <= 0)        colorPresupuesto = "";
  else if (porcentajePresupuesto <= 80)  colorPresupuesto = "presupuesto-ok";
  else if (porcentajePresupuesto <= 100) colorPresupuesto = "presupuesto-warn";
  else                                   colorPresupuesto = "presupuesto-over";

  function actualizarItem(index, campo, valor) {
    if (!esEditable) return;

    const copia = [...items];
    let item = { ...copia[index] };

    item[campo] = valor;

    let prod = null;
    if (campo === "sku") {
      const sku = String(valor || "").trim();
      prod = productos.find((p) => String(p.sku || "").trim() === sku);
    }
    if (campo === "producto") {
      prod = productos.find((p) => p.nombre === valor);
    }

    if (prod) {
      item.sku = prod.sku ? String(prod.sku).trim() : "";
      item.producto = prod.nombre || "";
      item.categoria = prod.categoria || "";
      item.formato = prod.formato || "";

      const sku = String(item.sku || "").trim();
      const precioCampania = sku ? campaignPriceBySku.get(sku) : null;

      item.precio =
        precioCampania != null
          ? Number(precioCampania)
          : getPrecioPorListado(prod, listado);

      item.precioManual = false;
      item.precioUnitarioStr = "";

      // Costo inicial desde el producto; el admin puede editarlo en la cotización.
      item.costo = Number(prod.costo ?? 0);
      item.costoManual = false;
      item.costoStr = "";
    }

    const cantidad = Math.max(1, Number(item.cantidad || 1));
    item.total = redondear(
      cantidad * (Number(item.precio || 0) + fletePorUnidad)
    );

    copia[index] = item;
    setItems(copia);
  }

  // Selección desde el buscador de catálogo (popup). Rellena el ítem con el
  // objeto producto recibido (no usa productos.find, que puede estar stale si
  // el producto recién se creó). Replica la lógica de precios de actualizarItem.
  function seleccionarProductoDesdePicker(prod) {
    const idx = pickerIndex;
    setPickerIndex(null);
    if (idx == null || !prod || !esEditable) return;

    setProductos((prev) => {
      const existeId = prod.id != null && prev.some((p) => p.id === prod.id);
      const existeSku = prod.sku
        ? prev.some((p) => String(p.sku || "").trim() === String(prod.sku).trim())
        : false;
      if (existeId || existeSku) return prev;
      return [...prev, prod];
    });

    setItems((prev) => {
      const copia = [...prev];
      const item = { ...(copia[idx] || crearItemVacio()) };
      item.sku = prod.sku ? String(prod.sku).trim() : "";
      item.producto = prod.nombre || "";
      item.categoria = prod.categoria || "";
      item.formato = prod.formato || "";

      const sku = String(item.sku || "").trim();
      const precioCampania = sku ? campaignPriceBySku.get(sku) : null;
      item.precio =
        precioCampania != null ? Number(precioCampania) : getPrecioPorListado(prod, listado);

      item.precioManual = false;
      item.precioUnitarioStr = "";
      item.costo = Number(prod.costo ?? 0);
      item.costoManual = false;
      item.costoStr = "";

      const cantidad = Math.max(1, Number(item.cantidad || 1));
      item.total = redondear(cantidad * (Number(item.precio || 0) + Number(fletePorUnidad || 0)));
      copia[idx] = item;
      return copia;
    });
  }

  // Producto creado desde el modal del picker: refresca el catálogo local.
  function handleProductoCreado(productoCreado, estadoFinal) {
    if (!productoCreado) return;
    setProductos((prev) => {
      const existe = productoCreado.id != null && prev.some((p) => p.id === productoCreado.id);
      return existe ? prev : [...prev, productoCreado];
    });
    if (estadoFinal === "Pendiente Aprobación") {
      setToast({
        type: "warning",
        message:
          'Producto creado en estado "Pendiente Aprobación" (margen < 15%). No se agregó al ítem — esperar aprobación de admin.',
      });
    } else {
      setToast({
        type: "success",
        message: `Producto "${productoCreado.nombre}" creado y agregado a la cotización.`,
      });
    }
  }

  function toggleObservacion(index) {
    if (!esEditable) return;
    const copia = [...items];
    copia[index].mostrarObs = !copia[index].mostrarObs;
    setItems(copia);
  }

  function agregarItem() {
    if (!esEditable) return;
    setItems((prev) => [...prev, crearItemVacio()]);
  }

  function insertarItemDespues(index) {
    if (!esEditable) return;
    setItems((prev) => {
      const copia = [...prev];
      copia.splice(index + 1, 0, crearItemVacio());
      return copia;
    });
  }

  async function eliminarItem(index) {
    if (!esEditable) return;
    if (items.length === 1) return;

    const target = items[index];
    if (target.id_item) {
      try {
        await api.delete(`/licitaciones/items/${target.id_item}`);
      } catch (e) {
        console.error("Error eliminando ítem:", e);
      }
    }

    const copia = [...items];
    copia.splice(index, 1);
    setItems(copia);
  }

  /* ============================================================
     DRAG & DROP (bloqueado si no editable)
     ✅ FIX: usar prev dentro del setItems (evita stale items)
     ✅ FIX: persistir reorder al tiro en localStorage
============================================================ */
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragEnd = useCallback(
    (event) => {
      if (!esEditable) return;

      const { active, over } = event;
      if (!over || active.id === over.id) return;

      setItems((prev) => {
        const oldIndex = prev.findIndex((it) => it.uid === active.id);
        const newIndex = prev.findIndex((it) => it.uid === over.id);
        if (oldIndex === -1 || newIndex === -1) return prev;

        const next = arrayMove(prev, oldIndex, newIndex);

        // ✅ persistencia inmediata del orden en draft
        persistirDraftItems(next);

        return next;
      });
    },
    [esEditable] // STORAGE_KEY ya lo usa persistirDraftItems (closure del componente)
  );

  /* ============================================================
     EXPORTAR PDF
============================================================ */
  async function exportarPDF() {
    if (guardando || generandoPDF) return;
    if (estado === "Pendiente Aprobación") {
      setToast({
        type: "error",
        message:
          "No se puede generar PDF mientras la licitación esté en \"Pendiente Aprobación\".",
      });
      return;
    }

    setGenerandoPDF(true);
    setToast({ type: "info", message: "Generando PDF…" });

    try {
      // Fecha de emisión = fecha ingresada en el comprobante de pago (si existe).
      // Si no hay comprobante todavía, caemos a hoy.
      const comprobantes = (documentos || []).filter(
        (d) => d.tipo === "comprobante_pago" && d.fecha_oc,
      );
      const comprobanteMasReciente = comprobantes
        .slice()
        .sort((a, b) => String(b.fecha_oc).localeCompare(String(a.fecha_oc)))[0];
      const fechaEmision = comprobanteMasReciente?.fecha_oc
        ? formatearFechaCorta(comprobanteMasReciente.fecha_oc)
        : formatearFechaCorta(new Date().toISOString().slice(0, 10));

      // Fecha de adjudicación = fecha de la primera OC subida (la más antigua).
      // Si no hay OC todavía, queda vacío y el PDF omite la línea.
      const ocsConFecha = (documentos || []).filter(
        (d) => d.tipo === "orden_compra" && d.fecha_oc,
      );
      const primeraOC = ocsConFecha
        .slice()
        .sort((a, b) => String(a.fecha_oc).localeCompare(String(b.fecha_oc)))[0];
      // Fecha de creación de la cotización (cuando se ingresó al sistema).
      const fechaCreacion = fechaCreacionLic
        ? formatearFechaCorta(String(fechaCreacionLic).slice(0, 10))
        : "";

      // Cliente particular no tiene OC: su fecha de adjudicación = fecha de
      // creación de la cotización.
      const esParticularPdf = (tipoCliente || tipoClienteGuardado || "")
        .toLowerCase()
        .includes("particular");
      const fechaAdjudicacion = esParticularPdf
        ? fechaCreacion
        : primeraOC?.fecha_oc
        ? formatearFechaCorta(primeraOC.fecha_oc)
        : "";

      await generarPDFcotizacion({
        numero_licitacion: id,
        id_licitacion: idLicitacionInput,
        fecha_emision: fechaEmision,
        fecha_creacion: fechaCreacion,
        fecha_adjudicacion: fechaAdjudicacion,

        nombre_entidad: nombreEntidad,
        rut_entidad: rutEntidad,
        direccion,
        sucursal,
        comuna,
        contacto,
        email,
        telefono,
        condicion_venta: condVenta,

        vendedor_nombre: (vendedorNombre || "").toString(),
        vendedor_celular: (vendedorCelular || "").toString(),
        vendedor_correo: (vendedorCorreo || "").toString(),

        observaciones: (observaciones ?? "").toString(),

        items: items.map((it, idx) => ({
          n: idx + 1,
          sku: String(it.sku || "").trim(),
          producto: it.producto || "",
          formato: it.formato || "",
          cantidad: it.cantidad,
          precio_unitario: formatear(Number(it.precio || 0) + fletePorUnidad),
          total: formatear(it.total),
          observacion: it.observacion || "",
        })),

        afecto: formatear(totalNeto),
        iva: formatear(totalIVA),
        total_con_iva: formatear(totalConIVA),
      });

      setToast({ type: "success", message: "PDF generado correctamente." });
    } finally {
      setGenerandoPDF(false);
    }
  }

  /* ============================================================
     GUARDAR CAMBIOS
     - Guardar siempre permitido (para cambiar estado)
     - Si NO es editable: NO upsertea items (seguridad extra)
     ✅ FIX: escribir `orden` (idx+1) en items_licitacion
============================================================ */
  async function guardarCambios() {
    if (guardando || generandoPDF) return false;

    setToast(null);

    const esParticularVal = (tipoCliente || "").toString().trim().toLowerCase() === "cliente particular";
    const errores = [];
    if (!idLicitacionInput) errores.push("ID Licitación");
    if (!nombre) errores.push("Nombre Licitación");
    if (!esParticularVal && !fechaHoraCierre) errores.push("Fecha y Hora de Cierre");
    if (!esParticularVal && !monto) errores.push("Monto");
    if (!tipoCliente) errores.push("Tipo de Cotización");
    if (!rutEntidad) errores.push("RUT Entidad");
    if (!nombreEntidad) errores.push("Nombre Entidad");
    if (!esCotizacionParticular && !departamento) errores.push("Departamento");
    if (!tipoCompra) errores.push("Tipo de Compra");
    if (!region) errores.push("Región");
    if (!comuna) errores.push("Comuna");

    if (errores.length > 0) {
      setToast({
        type: "error",
        message: "Faltan campos obligatorios:\n\n• " + errores.join("\n• "),
      });
      return false;
    }

    setGuardando(true);
    setToast({ type: "info", message: "Guardando licitación…" });

    try {
      const idLicitacionNorm = (idLicitacionInput || "").toString().trim();

      let dup;
      try {
        dup = await api.get(`/licitaciones?id_licitacion=${encodeURIComponent(idLicitacionNorm)}&exclude_id=${id}`);
      } catch (errDup) {
        console.error(errDup);
        setToast({
          type: "error",
          message: "No se pudo validar el ID de licitación.",
        });
        return false;
      }

      if (dup && dup.length > 0) {
        setToast({
          type: "error",
          message:
            `Ya existe una licitación con el ID "${idLicitacionNorm}".\n` +
            "No se puede guardar nuevamente con el mismo ID Licitación.",
        });
        return false;
      }

      try {
        await crearClienteSiNoExiste();
      } catch (e) {
        setToast({
          type: "error",
          message: "Error al guardar el cliente asociado.",
        });
        return false;
      }

      // ✅ Filtrar filas vacías (manteniendo índice original)
      const itemsParaGuardarConIndex = (items || [])
        .map((it, idx) => ({ it, idx }))
        .filter(({ it }) => {
          const sku = (it?.sku ?? "").trim();
          const producto = (it?.producto ?? "").trim();
          const formato = (it?.formato ?? "").trim();
          const categoria = (it?.categoria ?? "").trim();
          const obs = (it?.observacion ?? "").trim();
          const cantidad = Number(it?.cantidad ?? 0);
          const precio = Number(it?.precio ?? 0);

          const tieneAlgo =
            sku || producto || formato || categoria || obs || cantidad > 0 || precio > 0;

          return tieneAlgo;
        });

      const itemsParaGuardar = itemsParaGuardarConIndex.map(({ it }) => it);

      const lineasBajoMargen = itemsParaGuardarConIndex
        .map(({ it, idx }) => {
          const margen = calcularMargenItem(it);
          return margen > 0 && margen < 20 ? idx + 1 : null;
        })
        .filter(Boolean);

      const estadoSolicitado = estadoBloqueadoPendiente
        ? "Pendiente Aprobación"
        : estado;
      const requiereAprobacion = margenGeneral < 20 && !margenAprobado;
      const estadoFinal =
        requiereAprobacion && estadoSolicitado !== "En espera"
          ? "Pendiente Aprobación"
          : estadoSolicitado;
      const margenAprobadoFinal = margenGeneral < 20 ? margenAprobado : false;
      const fechaAdjudicadaFinal =
        estadoFinal === "Adjudicada"
          ? fechaAdjudicada || new Date().toISOString()
          : fechaAdjudicada;

      if (estadoFinal !== estado) {
        setEstado(estadoFinal);
      }
      if (fechaAdjudicadaFinal !== fechaAdjudicada) {
        setFechaAdjudicada(fechaAdjudicadaFinal);
      }
      if (margenAprobadoFinal !== margenAprobado) {
        setMargenAprobado(margenAprobadoFinal);
      }

      // Confirmación del Monto Total al pasar a Adjudicada
      if (estadoFinal === "Adjudicada" && estadoActualDB !== "Adjudicada") {
        const totalActual = Number(totalConIVA) || 0;
        const decision = await new Promise((resolve) => {
          setAdjudicarPrompt({ stage: "check", total: totalActual, resolve });
        });
        if (decision !== "igual") {
          setGuardando(false);
          setToast(
            decision === "modificar"
              ? { type: "info", message: "Ajuste los items y vuelva a guardar como Adjudicada." }
              : null
          );
          return false;
        }
      }

      try {
        await api.put(`/licitaciones/${id}`, {
          // Si la cotización proviene de una solicitud del cliente, el backend
          // le avisa de la modificación (hilo + correo). Si no, no hace nada.
          notificar_cliente_cotizacion: true,
          id_licitacion: idLicitacionInput,
          nombre,
          // Cliente particular no tiene fecha de cierre: enviar null en vez de
          // "" para no romper el timestamp en Postgres (invalid input syntax).
          fecha_hora_cierre: fechaHoraCierre || null,
          monto: parseMontoCL(monto),
          lista_precios: Number(listado),

          rut_entidad: rutEntidad,
          nombre_entidad: nombreEntidad,
          giro: giro || null,
          tipo_cliente: tipoCliente || null,
          departamento,
          municipalidad,
          direccion,
          sucursal: sucursal || null,
          tipo_compra: tipoCompra,
          region,
          comuna,
          contacto,
          email,
          telefono,
          condicion_venta: condVenta,

          estado: estadoFinal,
          margen_aprobado: margenAprobadoFinal,
          fecha_adjudicada: fechaAdjudicadaFinal,
          flete_estimado: Number(fleteEstimado),

          total_con_iva: totalConIVA,
          total_sin_iva: totalNeto,
          total_iva: totalIVA,

          observaciones: observaciones || null,

          // Punto 35: motivo de pérdida (solo persistir si estado es Perdida; si cambia a otro
          // estado limpiamos para no dejar datos colgando).
          motivo_perdida: estadoFinal === "Perdida" ? motivoPerdida || null : null,
          motivo_perdida_otro:
            estadoFinal === "Perdida" && motivoPerdida === "Otro"
              ? motivoPerdidaOtro || null
              : null,

          // Descarte: motivo + comentario (solo si el estado final es Descartada).
          motivo_descarte: estadoFinal === "Descartada" ? motivoDescarte || null : null,
          comentario_descarte: estadoFinal === "Descartada" ? comentarioDescarte || null : null,
        });
      } catch (errUpdate) {
        console.error(errUpdate);
        setToast({ type: "error", message: "Error al guardar licitación" });
        return false;
      }
      setEstadoActualDB(estadoFinal);
      setTipoClienteGuardado(tipoCliente || "");

      if (requiereAprobacion) {
        const detalleLineas = lineasBajoMargen.length
          ? ` Las líneas ${lineasBajoMargen.join(", ")} tienen un % de margen menor al 20%.`
          : "";
        setToast({
          type: "success",
          message: `Licitación pendiente de aprobación porque el margen general es inferior al 20%.${detalleLineas}`,
        });
      }

      // ✅ Seguridad extra: si no es editable, no tocar items
      if (!esEditable) {
        setToast({ type: "success", message: "Estado actualizado correctamente." });
        localStorage.removeItem(STORAGE_KEY);
        baselineRef.current = buildSnapshot();
        setIsDirty(false);
        return true;
      }

      // 2) Validar mínimos
      for (let i = 0; i < itemsParaGuardar.length; i++) {
        const it = itemsParaGuardar[i];
        const producto = (it?.producto ?? "").trim();
        const cantidad = Number(it?.cantidad ?? 0);

        const faltan = [];
        if (!producto) faltan.push("Producto");
        if (!(cantidad > 0)) faltan.push("Cantidad");

        if (faltan.length > 0) {
          setToast({
            type: "error",
            message: `Ítem #${i + 1} incompleto.\n\nFaltan:\n• ` + faltan.join("\n• "),
          });
          return false;
        }
      }

      // 3) UPSERT (update/insert) + ✅ ORDEN
      for (let idx = 0; idx < itemsParaGuardar.length; idx++) {
        const it = itemsParaGuardar[idx];
        const skuLimpio = String(it?.sku ?? "").trim();

        const payload = {
          licitacion_id: id,
          orden: idx + 1, // ✅ orden persistido
          producto: String(it?.producto ?? ""),
          formato: String(it?.formato ?? ""),
          cantidad: Number(it?.cantidad ?? 0),
          valor_unitario: Number(it?.precio ?? 0) + fletePorUnidad,
          sku: skuLimpio ? skuLimpio : null,
          total: Number(it?.total ?? 0),
          categoria: String(it?.categoria ?? ""),
          observacion: String(it?.observacion ?? ""),
        };

        if (it.id_item) {
          try {
            await api.put(`/licitaciones/items/${it.id_item}`, payload);
          } catch (eUpd) {
            console.error(eUpd);
            setToast({ type: "error", message: "Error al guardar un ítem" });
            return false;
          }
        } else {
          try {
            const ins = await api.post(`/licitaciones/${id}/items`, { items: [payload] });

            const newId = Array.isArray(ins) ? ins[0]?.id : ins?.id;
            if (newId) {
              setItems((prev) =>
                prev.map((x) =>
                  x.uid === it.uid
                    ? { ...x, id_item: newId, orden: payload.orden }
                    : x
                )
              );
            }
          } catch (eIns) {
            console.error(eIns);
            setToast({ type: "error", message: "Error al insertar un ítem" });
            return false;
          }
        }
      }

      setToast({
        type: "success",
        message: `La licitación "${nombre}" fue actualizada correctamente.`,
      });

      localStorage.removeItem(STORAGE_KEY);
      baselineRef.current = buildSnapshot();
      setIsDirty(false);

      return true;
    } finally {
      setGuardando(false);
    }
  }

  /* ============================================================
     UI
============================================================ */
  if (loading) {
    return <div className="p-8 text-gray-600">Cargando licitación…</div>;
  }

  return (
    <div className="page">
      {/* Overlay durante guardado / generación de PDF */}

      {/* Tooltip */}
      {tooltip.visible && (
        <div
          style={{
            position: "fixed",
            top: tooltip.y + 10,
            left: tooltip.x,
            padding: "8px 12px",
            background: "linear-gradient(135deg, #1e3a8a, #2563eb)",
            color: "white",
            fontSize: "12px",
            borderRadius: "6px",
            boxShadow: "0 4px 12px rgba(0,0,0,0.25)",
            zIndex: 99999,
            whiteSpace: "nowrap",
            pointerEvents: "none",
            opacity: tooltip.visible ? 1 : 0,
            transform: tooltip.visible ? "translateY(0px)" : "translateY(-6px)",
            transition: "opacity 0.15s ease, transform 0.15s ease",
          }}
        >
          {tooltip.texto}
        </div>
      )}

      {toast && (
        <Toast
          type={toast.type}
          message={toast.message}
          onClose={() => setToast(null)}
        />
      )}

      {pickerIndex !== null && (
        <ProductoPickerModal
          productos={productos}
          onSelect={seleccionarProductoDesdePicker}
          onClose={() => setPickerIndex(null)}
          listadoInicial={listado}
          tipoCompra={tipoCompra}
          onProductoCreado={handleProductoCreado}
        />
      )}

      <div className="page-header">
        <div>
          <h1 className="page-title">Edición de Cotizaciones #{idLicitacionInput}</h1>
        </div>
        <div className="btn-row">
          {esAdmin && idLicitacionInput && rutEntidad && (
            <button
              type="button"
              onClick={() => setMostrarPortalModal(true)}
              className="btn btn-secondary"
              title="Ver datos del portal del cliente"
            >
              Compartir portal
            </button>
          )}
          <button
            type="button"
            onClick={() => setConfirmDuplicarOpen(true)}
            className="btn btn-secondary"
          >
            Duplicar
          </button>
          {puedeAprobar && estado === "Pendiente Aprobación" && (
            <button
              type="button"
              onClick={aprobarLicitacion}
              className="btn btn-primary"
              disabled={aprobando}
            >
              {aprobando ? "Aprobando…" : "Aprobar"}
            </button>
          )}
          <button
            type="button"
            onClick={volver}
            className="btn btn-ghost"
          >
            ← Volver
          </button>
        </div>
      </div>

      {/* Aviso bloqueo */}
      {!esEditable && (
        <div className="mb-6 rounded-lg border border-yellow-200 bg-yellow-50 px-4 py-3 text-sm text-yellow-900">
          Esta licitación está en estado <b>{estado}</b>. Los campos están
          bloqueados. Para editar, cambia el estado a <b>En espera</b>.
        </div>
      )}

      {/* DATOS LICITACIÓN */}
      <div className="surface">
        <div className="surface-header">
          <h3 className="surface-title">Datos de la Cotización</h3>
        </div>
        <div className="surface-body">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Tipo de Cotización *
            </label>
            <select
              className={inputClass}
              value={tipoCliente}
              onChange={(e) => {
                const nuevo = e.target.value;
                setTipoCliente(nuevo);
                if (esEditable) {
                  if (nuevo.toLowerCase() === "cliente particular") {
                    setTipoCompra("Cliente particular");
                    setListado("1");
                  } else if (nuevo.toLowerCase() === "entidad pública" && tipoCompra === "Cliente particular") {
                    setTipoCompra("Compra ágil");
                    setListado("2");
                  }
                }
              }}
            >
              <option value="">(Seleccionar)</option>
              <option value="Entidad Pública">Entidad Pública</option>
              <option value="Cliente Particular">Cliente Particular</option>
            </select>
            {!esEditable && tipoCliente && tipoCliente !== tipoClienteGuardado && (
              <button
                type="button"
                className="mt-2 text-xs font-medium rounded-md border border-blue-600 text-blue-700 bg-white hover:bg-blue-50 px-3 py-1 disabled:opacity-50"
                onClick={guardarSoloTipoCliente}
                disabled={guardandoTipoCliente}
              >
                {guardandoTipoCliente ? "Guardando..." : "Guardar Tipo de Cotización"}
              </button>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              ID Cotización *
            </label>
            <input
              className={inputClass}
              value={idLicitacionInput}
              onChange={(e) => {
                setIdLicitacionInput(e.target.value);
                setIsDirty(true);
              }}
              disabled={!esEditable || tipoCliente.toLowerCase() === "cliente particular"}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Nombre Cotización *
            </label>
            <input
              className={inputClass}
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              disabled={!esEditable}
            />
          </div>

          {/* Cliente Particular: no aplica fecha/hora de cierre ni monto presupuesto. */}
          {tipoCliente.toLowerCase() !== "cliente particular" && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Fecha y Hora de Cierre *
                </label>
                <input
                  type="datetime-local"
                  className={inputClass}
                  value={fechaHoraCierre}
                  onChange={(e) => setFechaHoraCierre(e.target.value)}
                  disabled={!esEditable}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Monto Presupuesto *
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  className={inputClass}
                  value={monto ? `$${formatearCLDesdeString(String(monto))}` : ""}
                  onChange={(e) => setMonto(soloDigitos(e.target.value))}
                  disabled={!esEditable}
                />
              </div>
            </>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Tipo de Compra *
            </label>
            <select
              className={inputClass}
              value={tipoCompra}
              onChange={(e) => {
                const next = e.target.value;
                setTipoCompra(next);
                if (next === "Cliente particular") setListado("1");
                else if (next === "Licitación 9 a 24 meses") setListado("3");
                else setListado("2");
              }}
              disabled={!esEditable}
            >
              {tipoCliente.toLowerCase() === "cliente particular" ? (
                <option value="Cliente particular">Cliente particular</option>
              ) : (
                <>
                  <option value="Compra ágil">Compra ágil</option>
                  <option value="Compra directa">Compra directa</option>
                  <option value="Licitación 0 a 8 meses">Licitación 0 a 8 meses</option>
                  <option value="Licitación 9 a 24 meses">Licitación 9 a 24 meses</option>
                  {!tipoCliente && <option value="Cliente particular">Cliente particular</option>}
                </>
              )}
            </select>
            <p className="text-[11px] text-gray-500 mt-1">
              Cliente particular usa Lista 1, Licitación 9 a 24 meses usa Lista 3 (Lista 2 × 1.08); el resto usa Lista 2.
            </p>
          </div>

          {/* ✅ Estado bloqueado en "Pendiente Aprobación" para no-admin */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Estado
            </label>

            <select
              className={`w-full rounded-md border px-3 py-2 ${
                estadoStyles[estado] || ""
              } disabled:opacity-70 disabled:cursor-not-allowed`}
              value={estado}
              onChange={(e) => {
                const next = e.target.value;
                // Punto 35: al pasar a Perdida, exigimos seleccionar el motivo vía modal antes de
                // efectuar el cambio. Si el usuario cancela el modal, no aplicamos el cambio.
                if (next === "Perdida" && estado !== "Perdida") {
                  estadoPrevioRef.current = estado;
                  setModalMotivoPerdidaOpen(true);
                  return;
                }
                // Al pasar a Descartada exigimos motivo + comentario vía modal.
                if (next === "Descartada" && estado !== "Descartada") {
                  estadoPrevioRef.current = estado;
                  setModalMotivoDescarteOpen(true);
                  return;
                }
                // Si saliendo de Perdida, limpiamos motivo para no persistir datos colgando.
                if (estado === "Perdida" && next !== "Perdida") {
                  setMotivoPerdida("");
                  setMotivoPerdidaOtro("");
                }
                if (estado === "Descartada" && next !== "Descartada") {
                  setMotivoDescarte("");
                  setComentarioDescarte("");
                }
                setEstado(next);
              }}
              disabled={!puedeEditarEstado}
            >
              <option value="En espera">En espera</option>
              <option value="Pendiente Aprobación">Pendiente Aprobación</option>
              <option value="Adjudicada">Adjudicada</option>
              <option value="Perdida">Perdida</option>
              <option value="Desierta">Desierta</option>
              <option value="Descartada">Descartada</option>
              <option value="Cancelada">Cancelada</option>
            </select>
            {estado === "Perdida" && motivoPerdida && (
              <div
                style={{
                  marginTop: 8,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 8,
                  padding: "8px 10px",
                  background: "#fef2f2",
                  border: "1px solid #fecaca",
                  borderRadius: 8,
                }}
              >
                <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.25, minWidth: 0 }}>
                  <span style={{ fontSize: 10, fontWeight: 600, color: "#b91c1c", textTransform: "uppercase", letterSpacing: 0.4 }}>
                    Motivo de pérdida
                  </span>
                  <span
                    title={motivoPerdida === "Otro" ? motivoPerdidaOtro : motivoPerdida}
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                      color: "#7f1d1d",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {motivoPerdida === "Otro" ? (motivoPerdidaOtro || "Otro") : motivoPerdida}
                  </span>
                </div>
                {puedeEditarEstado && (
                  <button
                    type="button"
                    onClick={() => setModalMotivoPerdidaOpen(true)}
                    style={{
                      flexShrink: 0,
                      background: "transparent",
                      border: "1px solid #fca5a5",
                      borderRadius: 6,
                      color: "#b91c1c",
                      cursor: "pointer",
                      fontSize: 11,
                      fontWeight: 600,
                      padding: "4px 10px",
                    }}
                  >
                    Editar
                  </button>
                )}
              </div>
            )}
            {estado === "Descartada" && motivoDescarte && (
              <div
                style={{
                  marginTop: 8,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 8,
                  padding: "8px 10px",
                  background: "#faf5ff",
                  border: "1px solid #e9d5ff",
                  borderRadius: 8,
                }}
              >
                <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.25, minWidth: 0 }}>
                  <span style={{ fontSize: 10, fontWeight: 600, color: "#7e22ce", textTransform: "uppercase", letterSpacing: 0.4 }}>
                    Motivo de descarte
                  </span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: "#581c87" }}>{motivoDescarte}</span>
                  {comentarioDescarte && (
                    <span title={comentarioDescarte} style={{ fontSize: 12, color: "#6b21a8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {comentarioDescarte}
                    </span>
                  )}
                </div>
                {puedeEditarEstado && (
                  <button
                    type="button"
                    onClick={() => setModalMotivoDescarteOpen(true)}
                    style={{
                      flexShrink: 0,
                      background: "transparent",
                      border: "1px solid #d8b4fe",
                      borderRadius: 6,
                      color: "#7e22ce",
                      cursor: "pointer",
                      fontSize: 11,
                      fontWeight: 600,
                      padding: "4px 10px",
                    }}
                  >
                    Editar
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
        </div>
      </div>

      {/* DATOS ENTIDAD */}
      <div className="surface">
        <div className="surface-header">
          <h3 className="surface-title">Datos de la Entidad</h3>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => setMostrarEntidad(!mostrarEntidad)}
            type="button"
          >
            {mostrarEntidad ? <><ChevronUp size={14} /> Ocultar</> : <><ChevronDown size={14} /> Mostrar</>}
          </button>
        </div>

        <div className={`transition-all duration-300 overflow-hidden ${mostrarEntidad ? "max-h-[2000px] opacity-100" : "max-h-0 opacity-0"}`}>
        <div className="surface-body">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              RUT *
            </label>
            <input
              className={inputClass}
              value={rutEntidad}
              onChange={(e) => setRutEntidad(e.target.value)}
              onBlur={() => buscarClientePorRut(rutEntidad)}
              disabled={!esEditable}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Nombre Entidad *
            </label>
            <input
              className={inputClass}
              value={nombreEntidad}
              onChange={(e) => setNombreEntidad(e.target.value)}
              disabled={!esEditable}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Giro
            </label>
            <input
              className={inputClass}
              value={giro}
              onChange={(e) => setGiro(e.target.value)}
              disabled={!esEditable}
              placeholder="Ej: Servicios dentales"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Departamento{!esCotizacionParticular ? " *" : ""}
            </label>
            <input
              className={inputClass}
              value={departamento}
              onChange={(e) => setDepartamento(e.target.value)}
              disabled={!esEditable || esCotizacionParticular}
              placeholder={esCotizacionParticular ? "No aplica para cliente particular" : ""}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Municipalidad
            </label>
            <input
              className={inputClass}
              value={municipalidad}
              onChange={(e) => setMunicipalidad(e.target.value)}
              disabled={!esEditable}
            />
          </div>

          {/* Región */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Región *
            </label>
            <Select
              options={opcionesRegion}
              styles={customStyles}
              placeholder="Seleccione región…"
              menuPortalTarget={document.body}
              isSearchable={true}
              filterOption={filtrarPorTerminos}
              value={opcionesRegion.find((o) => o.value === region) || null}
              onChange={(op) => {
                const nuevaRegion = op ? op.value : "";
                setRegion(nuevaRegion);
                setComuna("");
              }}
              isDisabled={!esEditable}
            />
          </div>

          {/* Comuna */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Comuna *
            </label>
            <Select
              options={opcionesComuna(region)}
              styles={customStyles}
              placeholder={region ? "Seleccione comuna…" : "Seleccione región primero"}
              menuPortalTarget={document.body}
              isSearchable={true}
              filterOption={filtrarPorTerminos}
              isDisabled={!region || !esEditable}
              value={opcionesComuna(region).find((o) => o.value === comuna) || null}
              onChange={(op) => setComuna(op ? op.value : "")}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Sucursal
            </label>
            <Select
              options={sucursales.map((s) => ({
                value: s.nombre,
                label: s.comuna ? `${s.nombre} — ${s.comuna}` : s.nombre,
              }))}
              styles={customStyles}
              placeholder={
                !rutEntidad ? "Sin cliente"
                  : sucursales.length ? "Seleccione sucursal…"
                  : "Sin sucursales registradas"
              }
              menuPortalTarget={document.body}
              isSearchable
              isClearable
              filterOption={filtrarPorTerminos}
              isDisabled={!esEditable || !rutEntidad || sucursales.length === 0}
              value={sucursal ? { value: sucursal, label: sucursal } : null}
              onChange={(op) => elegirSucursal(op ? op.value : "")}
            />
            <p className="text-xs text-gray-500 mt-1">
              Al elegir una sucursal se completa la dirección de despacho.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Dirección *
            </label>
            <input
              className={inputClass}
              value={direccion}
              onChange={(e) => setDireccion(e.target.value)}
              disabled={!esEditable}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Contacto
            </label>
            <input
              className={inputClass}
              value={contacto}
              onChange={(e) => setContacto(e.target.value)}
              disabled={!esEditable}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Email
            </label>
            <input
              type="email"
              className={inputClass}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={!esEditable}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Teléfono
            </label>
            <input
              className={inputClass}
              value={telefono}
              onChange={(e) => setTelefono(e.target.value)}
              disabled={!esEditable}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Condiciones de Venta *
            </label>

            <select
              className={inputClass}
              value={condVenta}
              onChange={(e) => setCondVenta(e.target.value)}
              disabled={!esEditable}
            >
              <option value="">Seleccione…</option>
              {OPCIONES_COND_VENTA.map((op) => (
                <option key={op} value={op}>
                  {op}
                </option>
              ))}
            </select>
          </div>
        </div>
        </div>
        </div>
      </div>

      {/* ÍTEMS */}
      <div className="surface">
        <div className="surface-header">
          <h3 className="surface-title">Ítems</h3>
        </div>
        <div className="surface-body">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={items.map((it) => it.uid)}
          strategy={verticalListSortingStrategy}
        >
          <div className="space-y-3 max-h-[900px] overflow-y-auto pr-2">
            {items.map((it, index) => {
              const margenItem = calcularMargenItem(it);
              const isLowMargin = margenItem > 0 && margenItem < 20;

              return (
                <SortableItem key={it.uid} itemId={it.uid} disabled={!esEditable}>
                  {({ dragHandleProps }) => (
                    <div
                      className={`bg-white border rounded-lg p-4 shadow-sm space-y-3 ${
                        isLowMargin ? "border-red-400 bg-red-50" : "border-gray-200"
                      } ${!esEditable ? "opacity-95" : ""}`}
                    >
                    <div className="grid grid-cols-1 md:grid-cols-[repeat(24,minmax(0,1fr))] gap-4 items-end">
                      {/* Items */}
                      <div className="md:col-span-1">
                        <label className="block text-xs text-gray-600 mb-1">
                          Items
                        </label>
                        <div className="form-display form-display-value" style={{justifyContent:"center",fontWeight:700}}>
                          {index + 1}
                        </div>
                      </div>

                      {/* SKU */}
                      <div className={esAdmin ? "md:col-span-3" : "md:col-span-4"}>
                        <label className="block text-xs text-gray-600 mb-1">
                          SKU (opcional)
                        </label>
                        <Select
                          options={opcionesSKU}
                          styles={customStyles}
                          placeholder="Seleccione SKU…"
                          menuPortalTarget={document.body}
                          isSearchable={true}
                          filterOption={filtrarPorTerminos}
                          isDisabled={!esEditable}
                          value={opcionesSKU.find((o) => o.value === it.sku) || null}
                          onChange={(op) =>
                            actualizarItem(index, "sku", op ? op.value : "")
                          }
                        />
                      </div>

                      {/* Producto */}
                      <div className={esAdmin ? "md:col-span-4" : "md:col-span-7"}>
                        <div className="flex items-center justify-between mb-1">
                          <label className="block text-xs text-gray-600">
                            Producto *
                          </label>
                          {esEditable && (
                            <button
                              type="button"
                              onClick={() => setPickerIndex(index)}
                              title="Buscar producto en el catálogo"
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 5,
                                padding: "3px 10px",
                                borderRadius: 999,
                                border: "1px solid #25b7bd",
                                background: "#fff",
                                color: "#178a8f",
                                fontSize: 11,
                                fontWeight: 700,
                                cursor: "pointer",
                                letterSpacing: ".02em",
                                boxShadow: "0 1px 3px -1px rgba(37,183,189,.25)",
                                transition: "all .15s cubic-bezier(.4, 0, .2, 1)",
                              }}
                              onMouseEnter={(e) => {
                                e.currentTarget.style.background = "linear-gradient(135deg, #25b7bd 0%, #178a8f 100%)";
                                e.currentTarget.style.color = "#fff";
                                e.currentTarget.style.boxShadow = "0 3px 10px -2px rgba(37,183,189,.55)";
                                e.currentTarget.style.transform = "translateY(-1px)";
                              }}
                              onMouseLeave={(e) => {
                                e.currentTarget.style.background = "#fff";
                                e.currentTarget.style.color = "#178a8f";
                                e.currentTarget.style.boxShadow = "0 1px 3px -1px rgba(37,183,189,.25)";
                                e.currentTarget.style.transform = "translateY(0)";
                              }}
                            >
                              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                                <circle cx="11" cy="11" r="8"/>
                                <line x1="21" y1="21" x2="16.65" y2="16.65"/>
                              </svg>
                              Buscar catálogo
                            </button>
                          )}
                        </div>
                        <Select
                          options={opcionesProducto}
                          styles={customStyles}
                          placeholder="Seleccione producto…"
                          menuPortalTarget={document.body}
                          isSearchable={true}
                          filterOption={filtrarPorTerminos}
                          isDisabled={!esEditable}
                          value={
                            opcionesProducto.find((o) => o.value === it.producto) ||
                            null
                          }
                          onChange={(op) =>
                            actualizarItem(index, "producto", op ? op.value : "")
                          }
                          components={{ SingleValue: ProductoSingleValue }}
                          setTooltip={setTooltip}
                        />
                      </div>

                      {/* Formato */}
                      <div className="md:col-span-2">
                        <label className="block text-xs text-gray-600 mb-1">
                          Formato
                        </label>
                        <input
                          className={`${inputClassH10} text-sm`}
                          value={it.formato}
                          onChange={(e) =>
                            actualizarItem(index, "formato", e.target.value)
                          }
                          disabled={!esEditable}
                        />
                      </div>

                      {/* Cantidad */}
                      <div className="md:col-span-2">
                        <label className="block text-xs text-gray-600 mb-1">
                          Cantidad *
                        </label>
                        <input
                          type="number"
                          min="1"
                          className={`${inputClassH10} text-sm no-spinner`}
                          value={it.cantidad}
                          onInput={(e) => {
                            if (!esEditable) return;
                            e.target.value = e.target.value.replace(/[^0-9]/g, "");
                            if (e.target.value === "" || Number(e.target.value) <= 0) {
                              e.target.value = "1";
                            }
                          }}
                          onChange={(e) =>
                            actualizarItem(index, "cantidad", e.target.value)
                          }
                          disabled={!esEditable}
                        />
                      </div>

                      {/* Precio Unitario */}
                      <div className="md:col-span-2">
                        <label className="block text-xs text-gray-600 mb-1">
                          Precio Unitario
                        </label>

                        <input
                          type="text"
                          inputMode="numeric"
                          className={`${inputClassH10} text-sm font-semibold`}
                          value={
                            (it.precioUnitarioStr ?? "") !== ""
                              ? it.precioUnitarioStr
                              : formatearCLDesdeString(
                                  String(
                                    Number(it.precio || 0) +
                                      Number(fletePorUnidad || 0)
                                  )
                                )
                          }
                          onChange={(e) =>
                            actualizarPrecioUnitario(index, e.target.value)
                          }
                          onBlur={() => finalizarEdicionPrecioUnitario(index)}
                          disabled={!esEditable}
                        />
                      </div>

                      {esAdmin && (
                        <div className="md:col-span-2">
                          <label className="block text-xs text-gray-600 mb-1">
                            Costo
                          </label>
                          <input
                            type="text"
                            inputMode="numeric"
                            className={`${inputClassH10} text-sm font-semibold`}
                            value={
                              (it.costoStr ?? "").toString() !== ""
                                ? it.costoStr
                                : formatearCLDesdeString(
                                    String(Number(getCostoParaItem(it) || 0)),
                                  )
                            }
                            onChange={(e) => actualizarCostoItem(index, e.target.value)}
                            onBlur={() => finalizarEdicionCosto(index)}
                            disabled={!esEditable}
                            title="Costo solo para esta cotización — no modifica el producto"
                          />
                        </div>
                      )}

                      {esAdmin && (
                        <div className="md:col-span-2">
                          <label className="block text-xs text-gray-600 mb-1">
                            Margen
                          </label>
                          <input
                            className={`${inputClassH10} text-sm bg-gray-50`}
                            readOnly
                            value={(() => {
                              const costo = getCostoParaItem(it);
                              const precioBase = Number(it.precio || 0);
                              if (precioBase <= 0) return "0.00%";
                              const margen = ((precioBase - costo) / precioBase) * 100;
                              return `${margen.toFixed(2)}%`;
                            })()}
                          />
                        </div>
                      )}

                      {/* Total */}
                      <div className="md:col-span-3">
                        <label className="block text-xs text-gray-600 mb-1">
                          Total
                        </label>
                        <div className="h-10 flex items-center font-semibold whitespace-nowrap">
                          ${Number(it.total).toLocaleString("es-CL")}
                        </div>
                      </div>

                      {/* Acciones */}
                      <div
                        className={`flex justify-start pr-1 ${
                          esAdmin ? "md:col-span-2" : "md:col-span-3"
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => toggleObservacion(index)}
                            disabled={!esEditable}
                            className="item-action-btn"
                            title="Observación"
                            type="button"
                          >
                            {it.mostrarObs ? <Minus size={14}/> : <MessageSquare size={14}/>}
                          </button>

                          {items.length > 1 && (
                            <button
                              onClick={() => eliminarItem(index)}
                              disabled={!esEditable}
                              className="item-action-btn item-action-danger"
                              type="button"
                              title="Eliminar ítem"
                            >
                              <Trash2 size={14}/>
                            </button>
                          )}
                        </div>
                      </div>

                    </div>

                    {/* mover + insertar */}
                    <div className="flex items-center gap-2">
                      <button
                        ref={dragHandleProps.ref}
                        {...dragHandleProps}
                        disabled={!esEditable}
                        className="item-action-btn item-drag-handle"
                        style={{ touchAction: "none" }}
                        title="Arrastrar para reordenar"
                        type="button"
                      >
                        <GripVertical size={14}/>
                      </button>

                      <button
                        type="button"
                        onClick={() => insertarItemDespues(index)}
                        disabled={!esEditable}
                        className="item-action-btn item-action-primary"
                        title="Agregar ítem debajo"
                      >
                        <Plus size={14}/>
                      </button>

                    </div>

                    {/* Observación */}
                    {it.mostrarObs && (
                      <div className="grid grid-cols-1 md:grid-cols-[repeat(24,minmax(0,1fr))] transition-all">
                        <div className="md:col-span-12">
                          <label className="block text-xs text-gray-600 mb-1">
                            Observación
                          </label>
                          <input
                            className={`${inputClassH10} text-sm`}
                            value={it.observacion}
                            onChange={(e) =>
                              actualizarItem(index, "observacion", e.target.value)
                            }
                            disabled={!esEditable}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                  )}
                </SortableItem>
              );
            })}
          </div>
        </SortableContext>
      </DndContext>
        </div>
      </div>

      {/* RESUMEN */}
      <div className="surface">
        <div className="surface-header">
          <h3 className="surface-title">Resumen</h3>
        </div>
        <div className="surface-body">
        <div className="mb-6">
          <p className="form-section-title">Logística</p>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Cantidad de Productos
              </label>
              <div className="form-display form-display-value" style={{fontWeight:600}}>
                {cantidadProductos}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Flete Estimado
              </label>
              <input
                type="number"
                className={inputClassH10}
                value={fleteEstimado}
                onChange={(e) => setFleteEstimado(e.target.value)}
                disabled={!esEditable}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Flete por Unidad
              </label>
              <div className="form-display form-display-value">
                ${fletePorUnidad.toLocaleString("es-CL")}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Centímetro cúbico general (cm³)
              </label>
              <div className="form-display form-display-value" style={{fontWeight:600}}>
                {metroCubicoGeneral.toFixed(2)}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Peso total (kg)
              </label>
              <div className="form-display form-display-value" style={{fontWeight:600}}>
                {pesoTotalGeneral.toFixed(2)}
              </div>
            </div>
          </div>

          <CalculadoraFlete
            pesoTotal={pesoTotalGeneral}
            volumenTotal={metroCubicoGeneral}
            regionCliente={region}
            comunaCliente={comuna}
            direccionCliente={direccion}
            tipoCotizacion={esCotizacionParticular ? "particular" : "publico"}
            totalCompra={totalConIVA}
            deshabilitado={!esEditable}
            onAplicar={(neto) => setFleteEstimado(neto)}
          />
        </div>

        <div className="mb-6">
          <p className="form-section-title">Financiero</p>
          <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-6 gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Margen General
              </label>
              <div className="form-display form-display-value">
                {margenGeneral.toFixed(2)}%
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Neto
              </label>
              <div className="form-display form-display-value" style={{fontWeight:600}}>
                ${totalNeto.toLocaleString("es-CL")}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                IVA 19%
              </label>
              <div className="form-display form-display-value">
                ${totalIVA.toLocaleString("es-CL")}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Total
              </label>
              <div className="form-display form-display-value" style={{fontWeight:600}}>
                ${totalConIVA.toLocaleString("es-CL")}
              </div>
            </div>

            {tipoCliente.toLowerCase() !== "cliente particular" && (
              <>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Saldo Presupuesto
                  </label>
                  <div className="form-display form-display-value" style={{fontWeight:600}}>
                    {saldoPresupuesto >= 0 ? "$" : "-$"}
                    {Math.abs(saldoPresupuesto).toLocaleString("es-CL")}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    % Presupuesto
                  </label>
                  <div className={`form-display form-display-value ${colorPresupuesto}`} style={{fontWeight:600}}>
                    {porcentajePresupuesto > 0
                      ? formatPorcentajePresupuesto(porcentajePresupuesto)
                      : "0%"}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        <div>
          <p className="form-section-title">Órdenes de Compra</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Valor consumido
              </label>
              <div className="form-display form-display-value" style={{fontWeight:600}}>
                ${montoConsumido.toLocaleString("es-CL")}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Saldo por consumir
              </label>
              <div className="form-display form-display-value" style={{fontWeight:600}}>
                ${saldoPorConsumirResumen.toLocaleString("es-CL")}
              </div>
            </div>
          </div>
        </div>
        </div>
      </div>

      {/* OBSERVACIONES GENERALES */}
      <div className="surface">
        <div className="surface-header">
          <h3 className="surface-title">Observaciones</h3>
        </div>
        <div className="surface-body">
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Observaciones generales
        </label>

        <textarea
          className={textareaClass}
          value={observaciones}
          onChange={(e) => setObservaciones(e.target.value)}
          placeholder="Escribe observaciones generales para la licitación…"
          disabled={!esEditable}
        />
        </div>
      </div>

      {/* DOCUMENTOS */}
      <div className="surface">
        <div className="surface-header">
          <h3 className="surface-title">Documentos</h3>
        </div>
        <div className="surface-body">

        {/* Línea 1: comunes (Tipo, Número) + campos específicos del tipo */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
          <div className="md:col-span-3">
            <label className="block text-sm font-medium text-gray-700 mb-1">Tipo *</label>
            <select
              className={`${inputClass} text-sm`}
              value={docTipo}
              onChange={(e) => setDocTipo(e.target.value)}
              disabled={subiendoDoc}
            >
              {esCotizacionParticular ? (
                <>
                  <option value="factura_boleta">Factura o Boleta</option>
                  <option value="comprobante_pago">Comprobante de Transferencia</option>
                  <option value="webpay">Webpay</option>
                  <option value="efectivo">Efectivo</option>
                  <option value="info_despacho">Información de Despacho</option>
                </>
              ) : (
                <>
                  <option value="orden_compra">Orden de Compra</option>
                  <option value="guia_despacho">Guía de Despacho</option>
                </>
              )}
            </select>
          </div>

          {docTipo !== "info_despacho" && (
            <div className="md:col-span-3">
              <label className="block text-sm font-medium text-gray-700 mb-1">Número</label>
              <input
                className={`${inputClass} text-sm`}
                value={docNumero}
                onChange={(e) => setDocNumero(e.target.value)}
                placeholder={
                  docTipo === "orden_compra" ? "Ej: OC-2026-001" :
                  docTipo === "factura_boleta" ? "Ej: FB-2026-001" :
                  docTipo === "comprobante_pago" ? "Ej: TRX-2026-001" :
                  docTipo === "webpay" ? "Ej: WP-2026-001" :
                  docTipo === "efectivo" ? "Ej: EFE-2026-001" :
                  "Ej: GD-2026-001"
                }
                disabled={subiendoDoc}
              />
            </div>
          )}

          {/* Cliente particular — Factura/Boleta y Efectivo: mismos campos (monto + fecha) */}
          {(docTipo === "factura_boleta" || docTipo === "efectivo") && (
            <>
              {docTipo === "efectivo" && (
                <div className="md:col-span-3">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Factura / Boleta asociada</label>
                  <Select
                    options={opcionesDerivaSelect}
                    styles={{
                      ...customStyles,
                      control: (base, state) => ({
                        ...customStyles.control(base, state),
                        minHeight: "38px",
                        height: "38px",
                      }),
                      valueContainer: (base) => ({
                        ...customStyles.valueContainer(base),
                        padding: "0 8px",
                      }),
                      indicatorsContainer: (base) => ({
                        ...base,
                        height: "38px",
                      }),
                    }}
                    placeholder="Buscar factura/boleta (opcional)"
                    menuPortalTarget={document.body}
                    isSearchable={true}
                    filterOption={filtrarPorTerminos}
                    isClearable={true}
                    isDisabled={subiendoDoc}
                    noOptionsMessage={() => "Sin boletas/facturas disponibles"}
                    value={
                      opcionesDerivaSelect.find((o) => o.value === String(docDerivaDeId)) || null
                    }
                    onChange={(op) => setDocDerivaDeId(op?.value || "")}
                  />
                </div>
              )}
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">Monto Neto *</label>
                <input
                  type="text"
                  inputMode="numeric"
                  className={`${inputClass} text-sm`}
                  value={docMonto}
                  onChange={(e) => setDocMonto(formatearCLDesdeString(e.target.value))}
                  placeholder="Ej: 1.250.000"
                  disabled={subiendoDoc}
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">Fecha *</label>
                <DateFilter
                  className={`${inputClass} text-sm`}
                  value={docFechaOC}
                  onChange={setDocFechaOC}
                  disabled={subiendoDoc}
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">Monto Bruto</label>
                <input
                  type="text"
                  className={`${inputClass} text-sm bg-gray-100`}
                  value={montoNetoOCFormulario > 0 ? `$${montoBrutoOCFormulario.toLocaleString("es-CL")}` : ""}
                  placeholder="Neto x 1,19"
                  readOnly
                  disabled
                />
              </div>
            </>
          )}

          {/* Cliente particular — Comprobante de Transferencia / Webpay: boleta/factura asociada + monto + fecha (+ URL en Webpay) */}
          {(docTipo === "comprobante_pago" || docTipo === "webpay") && (
            <>
              <div className="md:col-span-3">
                <label className="block text-sm font-medium text-gray-700 mb-1">Boleta / Factura asociada *</label>
                <Select
                  options={opcionesDerivaSelect}
                  styles={{
                    ...customStyles,
                    control: (base, state) => ({
                      ...customStyles.control(base, state),
                      minHeight: "38px",
                      height: "38px",
                    }),
                    valueContainer: (base) => ({
                      ...customStyles.valueContainer(base),
                      padding: "0 8px",
                    }),
                    indicatorsContainer: (base) => ({
                      ...base,
                      height: "38px",
                    }),
                  }}
                  placeholder="Buscar boleta/factura"
                  menuPortalTarget={document.body}
                  isSearchable={true}
                  filterOption={filtrarPorTerminos}
                  isClearable={true}
                  isDisabled={subiendoDoc}
                  noOptionsMessage={() => "Sin boletas/facturas disponibles"}
                  value={
                    opcionesDerivaSelect.find((o) => o.value === String(docDerivaDeId)) || null
                  }
                  onChange={(op) => setDocDerivaDeId(op?.value || "")}
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">Monto Neto *</label>
                <input
                  type="text"
                  inputMode="numeric"
                  className={`${inputClass} text-sm`}
                  value={docMonto}
                  onChange={(e) => setDocMonto(formatearCLDesdeString(e.target.value))}
                  placeholder="Ej: 1.250.000"
                  disabled={subiendoDoc}
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">Fecha *</label>
                <DateFilter
                  className={`${inputClass} text-sm`}
                  value={docFechaOC}
                  onChange={setDocFechaOC}
                  disabled={subiendoDoc}
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">Monto Bruto</label>
                <input
                  type="text"
                  className={`${inputClass} text-sm bg-gray-100`}
                  value={montoNetoOCFormulario > 0 ? `$${montoBrutoOCFormulario.toLocaleString("es-CL")}` : ""}
                  placeholder="Neto x 1,19"
                  readOnly
                  disabled
                />
              </div>
              {docTipo === "webpay" && (
                <div className="md:col-span-12">
                  <label className="block text-sm font-medium text-gray-700 mb-1">URL del comprobante (Webpay)</label>
                  <input
                    type="url"
                    className={`${inputClass} text-sm`}
                    value={docUrl}
                    onChange={(e) => setDocUrl(e.target.value)}
                    placeholder="https://… (link al voucher Webpay)"
                    disabled={subiendoDoc}
                  />
                </div>
              )}
            </>
          )}

          {/* Cliente particular — Información de Despacho: empresa + N° seguimiento (sin archivo) */}
          {docTipo === "info_despacho" && (
            <>
              <div className="md:col-span-3">
                <label className="block text-sm font-medium text-gray-700 mb-1">Empresa *</label>
                <select
                  className={`${inputClass} text-sm`}
                  value={docEmpresa}
                  onChange={(e) => {
                    const next = e.target.value;
                    setDocEmpresa(next);
                    if (next === "Despacho interno") setDocNumSeguimiento("");
                  }}
                  disabled={subiendoDoc}
                >
                  <option value="Starken">Starken</option>
                  <option value="Blue Express">Blue Express</option>
                  <option value="Despacho interno">Despacho interno</option>
                  <option value="Otro">Otro</option>
                </select>
              </div>
              {docEmpresa !== "Despacho interno" && (
                <div className="md:col-span-3">
                  <label className="block text-sm font-medium text-gray-700 mb-1">N° Seguimiento</label>
                  <input
                    type="text"
                    className={`${inputClass} text-sm`}
                    value={docNumSeguimiento}
                    onChange={(e) => setDocNumSeguimiento(e.target.value)}
                    placeholder="Código de tracking del courier"
                    disabled={subiendoDoc}
                  />
                </div>
              )}
              {docEmpresa === "Despacho interno" && (
                <div className="md:col-span-3 flex items-end">
                  <p className="text-xs text-gray-500">
                    Se generará automáticamente un N° de seguimiento interno (AMSO…) al guardar.
                  </p>
                </div>
              )}
              <div className="md:col-span-3">
                <label className="block text-sm font-medium text-gray-700 mb-1">Factura / Boleta asociada</label>
                <Select
                  options={opcionesDerivaSelect}
                  styles={{
                    ...customStyles,
                    control: (base, state) => ({
                      ...customStyles.control(base, state),
                      minHeight: "38px",
                      height: "38px",
                    }),
                    valueContainer: (base) => ({
                      ...customStyles.valueContainer(base),
                      padding: "0 8px",
                    }),
                    indicatorsContainer: (base) => ({
                      ...base,
                      height: "38px",
                    }),
                  }}
                  placeholder="Asociar despacho a factura (opcional)"
                  menuPortalTarget={document.body}
                  isSearchable={true}
                  filterOption={filtrarPorTerminos}
                  isClearable={true}
                  isDisabled={subiendoDoc}
                  noOptionsMessage={() => "Sin boletas/facturas disponibles"}
                  value={
                    opcionesDerivaSelect.find((o) => o.value === String(docDerivaDeId)) || null
                  }
                  onChange={(op) => setDocDerivaDeId(op?.value || "")}
                />
              </div>
            </>
          )}

          {docTipo === "orden_compra" && (
            <>
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">Monto Neto OC *</label>
                <input
                  type="text"
                  inputMode="numeric"
                  className={`${inputClass} text-sm`}
                  value={docMonto}
                  onChange={(e) => setDocMonto(formatearCLDesdeString(e.target.value))}
                  placeholder="Ej: 1.250.000"
                  disabled={subiendoDoc}
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">Fecha OC *</label>
                <DateFilter
                  className={`${inputClass} text-sm`}
                  value={docFechaOC}
                  onChange={setDocFechaOC}
                  disabled={subiendoDoc}
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">Monto Bruto OC</label>
                <input
                  type="text"
                  className={`${inputClass} text-sm bg-gray-100`}
                  value={montoNetoOCFormulario > 0 ? `$${montoBrutoOCFormulario.toLocaleString("es-CL")}` : ""}
                  placeholder="Neto x 1,19"
                  readOnly
                  disabled
                />
              </div>
            </>
          )}

          {docTipo === "guia_despacho" && (
            <>
              <div className="md:col-span-3">
                <label className="block text-sm font-medium text-gray-700 mb-1">Deriva de *</label>
                <Select
                  options={opcionesDerivaSelect}
                  styles={{
                    ...customStyles,
                    control: (base, state) => ({
                      ...customStyles.control(base, state),
                      minHeight: "38px",
                      height: "38px",
                    }),
                    valueContainer: (base) => ({
                      ...customStyles.valueContainer(base),
                      padding: "0 8px",
                    }),
                    indicatorsContainer: (base) => ({
                      ...base,
                      height: "38px",
                    }),
                  }}
                  placeholder="Buscar OC"
                  menuPortalTarget={document.body}
                  isSearchable={true}
                  filterOption={filtrarPorTerminos}
                  isClearable={true}
                  isDisabled={subiendoDoc}
                  noOptionsMessage={() => "Sin documentos disponibles"}
                  value={
                    opcionesDerivaSelect.find((o) => o.value === String(docDerivaDeId)) || null
                  }
                  onChange={(op) => setDocDerivaDeId(op?.value || "")}
                />
              </div>
              <div className="md:col-span-3">
                <label className="block text-sm font-medium text-gray-700 mb-1">Fecha *</label>
                <DateFilter
                  className={`${inputClass} text-sm`}
                  value={docFechaOC}
                  onChange={setDocFechaOC}
                  disabled={subiendoDoc}
                />
              </div>
            </>
          )}
        </div>

        {/* Línea 2 (sólo guía): Monto + Empresa + N° Seguimiento */}
        {docTipo === "guia_despacho" && (
          <div className="grid grid-cols-1 md:grid-cols-12 gap-4 mt-4">
            <div className="md:col-span-3">
              <label className="block text-sm font-medium text-gray-700 mb-1">Monto Neto Guía *</label>
              <input
                type="text"
                inputMode="numeric"
                className={`${inputClass} text-sm`}
                value={docMonto}
                onChange={(e) => setDocMonto(formatearCLDesdeString(e.target.value))}
                placeholder="Ej: 1.250.000"
                disabled={subiendoDoc}
              />
            </div>
            <div className="md:col-span-3">
              <label className="block text-sm font-medium text-gray-700 mb-1">Empresa *</label>
              <select
                className={`${inputClass} text-sm`}
                value={docEmpresa}
                onChange={(e) => {
                  const next = e.target.value;
                  setDocEmpresa(next);
                  if (next === "Despacho interno") setDocNumSeguimiento("");
                }}
                disabled={subiendoDoc}
              >
                <option value="Starken">Starken</option>
                <option value="Blue Express">Blue Express</option>
                <option value="Despacho interno">Despacho interno</option>
                <option value="Otro">Otro</option>
              </select>
            </div>
            {docEmpresa !== "Despacho interno" && (
              <div className="md:col-span-6">
                <label className="block text-sm font-medium text-gray-700 mb-1">N° Seguimiento</label>
                <input
                  type="text"
                  className={`${inputClass} text-sm`}
                  value={docNumSeguimiento}
                  onChange={(e) => setDocNumSeguimiento(e.target.value)}
                  placeholder="Código de tracking del courier"
                  disabled={subiendoDoc}
                />
              </div>
            )}
          </div>
        )}

        {/* Línea 3: PDF + Botón agregar */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-4 mt-4 items-end">
          <div className="md:col-span-9">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {docTipo === "info_despacho" ? "Documento (opcional)" : "PDF *"}
            </label>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf,.pdf"
              style={{ display: "none" }}
              onChange={(e) => setDocFile(e.target.files?.[0] || null)}
              disabled={subiendoDoc}
            />
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => fileInputRef.current?.click()}
                disabled={subiendoDoc}
              >
                {docTipo === "info_despacho" ? "Adjuntar documento" : "Seleccionar PDF"}
              </button>
              <span className="text-sm text-gray-500 truncate">
                {docFile ? docFile.name : "Sin archivo"}
              </span>
            </div>
          </div>
          <div className="md:col-span-3 flex md:justify-end">
            <button
              type="button"
              onClick={subirDocumento}
              disabled={subiendoDoc}
              className="btn btn-primary"
            >
              {subiendoDoc ? "Subiendo…" : "Agregar documento"}
            </button>
          </div>
        </div>

        <div className="mt-6 overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">Tipo</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">Número</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">Monto Neto</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">Monto Bruto</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">Deriva de</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">Archivo</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">Fecha</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">Acción</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 bg-white">
              {documentos.map((doc) => {
                const docOrigen = documentos.find((x) => x.id === doc.deriva_de_id);
                const editando = docEditando?.id === doc.id;
                return (
                  <tr key={doc.id}>
                    <td className="px-3 py-2 text-sm">{DOC_TIPOS[doc.tipo] || doc.tipo}</td>
                    <td className="px-3 py-2 text-sm">
                      {editando ? (
                        <input
                          type="text"
                          className="input text-sm"
                          style={{ width: 100 }}
                          value={docEditNumero}
                          onChange={(e) => setDocEditNumero(e.target.value)}
                        />
                      ) : (doc.numero || "-")}
                    </td>
                    <td className="px-3 py-2 text-sm">
                      {editando && (doc.tipo === "orden_compra" || doc.tipo === "factura_boleta" || doc.tipo === "efectivo") ? (
                        <input
                          type="number"
                          className="input text-sm"
                          style={{ width: 110 }}
                          value={docEditMonto}
                          onChange={(e) => setDocEditMonto(e.target.value)}
                        />
                      ) : doc.monto !== null && doc.monto !== undefined
                        ? `$${Number(doc.monto).toLocaleString("es-CL")}`
                        : "-"}
                    </td>
                    <td className="px-3 py-2 text-sm">
                      {doc.monto !== null && doc.monto !== undefined
                        ? `$${calcularBrutoDesdeNeto(editando && (doc.tipo === "orden_compra" || doc.tipo === "factura_boleta" || doc.tipo === "efectivo") ? Number(docEditMonto || 0) : doc.monto).toLocaleString("es-CL")}`
                        : "-"}
                    </td>
                    <td className="px-3 py-2 text-sm">
                      {docOrigen
                        ? `${DOC_TIPOS[docOrigen.tipo] || docOrigen.tipo}${docOrigen.numero ? ` - ${docOrigen.numero}` : ""}`
                        : "-"}
                    </td>
                    <td className="px-3 py-2 text-sm">
                      {editando && puedeEditarDocAvanzado ? (
                        <div className="flex flex-col gap-1">
                          <input
                            type="text"
                            className="input text-sm"
                            style={{ minWidth: 170 }}
                            value={docEditFileName}
                            onChange={(e) => setDocEditFileName(e.target.value)}
                            placeholder="Nombre del documento"
                          />
                          {doc.tipo === "guia_despacho" && (
                            <input
                              type="text"
                              className="input text-sm"
                              style={{ minWidth: 170 }}
                              value={docEditTracking}
                              onChange={(e) => setDocEditTracking(e.target.value)}
                              placeholder="N° de tracking"
                            />
                          )}
                        </div>
                      ) : (
                        <>
                          <div>{doc.file_name || "-"}</div>
                          {(doc.tipo === "guia_despacho" || doc.tipo === "info_despacho") && (doc.empresa_despacho || doc.n_seguimiento) && (
                            <div className="text-xs text-gray-500 mt-1">
                              {doc.empresa_despacho || ""}
                              {doc.empresa_despacho && doc.n_seguimiento ? " · " : ""}
                              {doc.n_seguimiento ? `Tracking: ${doc.n_seguimiento}` : ""}
                            </div>
                          )}
                        </>
                      )}
                    </td>
                    <td className="px-3 py-2 text-sm">
                      {editando && ["orden_compra", "factura_boleta", "comprobante_pago", "efectivo"].includes(doc.tipo) ? (
                        <DateFilter
                          className="input text-sm"
                          value={docEditFechaOC}
                          onChange={setDocEditFechaOC}
                        />
                      ) : ["orden_compra", "guia_despacho", "factura_boleta", "comprobante_pago", "efectivo"].includes(doc.tipo) && doc.fecha_oc
                        ? formatearFechaCorta(doc.fecha_oc)
                        : doc.created_at
                        ? new Date(doc.created_at).toLocaleString("es-CL")
                        : "-"}
                    </td>
                    <td className="px-3 py-2 text-sm">
                      <div className="flex gap-2">
                        {editando ? (
                          <>
                            <button
                              type="button"
                              onClick={guardarEdicionDocumento}
                              disabled={guardandoDocEdit}
                              className="btn btn-primary btn-sm"
                            >
                              {guardandoDocEdit ? "…" : "Guardar"}
                            </button>
                            <button
                              type="button"
                              onClick={cancelarEdicionDocumento}
                              disabled={guardandoDocEdit}
                              className="btn btn-secondary btn-sm"
                            >
                              Cancelar
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() => iniciarEdicionDocumento(doc)}
                              className="btn btn-secondary btn-sm"
                            >
                              Editar
                            </button>
                            <button
                              type="button"
                              onClick={() => abrirDocumento(doc)}
                              className="btn btn-secondary btn-sm"
                            >
                              Ver
                            </button>
                            <button
                              type="button"
                              onClick={() => solicitarEliminarDocumento(doc)}
                              className="btn btn-danger btn-sm"
                            >
                              Eliminar
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}

              {documentos.length === 0 && (
                <tr>
                  <td colSpan="8" className="px-3 py-4 text-sm text-gray-500 text-center">
                    No hay documentos cargados para esta licitación.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        </div>
      </div>

      {/* BOTONES */}
      <div className="btn-row" style={{marginTop: "1.5rem"}}>
        <button
          onClick={agregarItem}
          className="btn btn-secondary"
          type="button"
          disabled={!esEditable || guardando || generandoPDF}
        >
          + Agregar Ítem
        </button>

        {/* Guardar permitido siempre (para guardar cambio de estado) */}
        <button
          onClick={guardarCambios}
          className="btn btn-primary"
          type="button"
          disabled={guardando || generandoPDF}
        >
          {guardando ? "Guardando…" : "Guardar Cambios"}
        </button>

        {estado !== "Pendiente Aprobación" && (
          <button
            onClick={exportarPDF}
            className="btn btn-secondary"
            type="button"
            disabled={guardando || generandoPDF}
          >
            {generandoPDF ? "Generando…" : "Generar PDF"}
          </button>
        )}

        {esAdmin && (
          <button
            type="button"
            onClick={() => setConfirmEliminarOpen(true)}
            className="btn btn-danger"
            disabled={guardando || generandoPDF || eliminando}
          >
            Eliminar
          </button>
        )}
      </div>

      <ConfirmModal
        open={confirmDuplicarOpen}
        title="Duplicar licitación"
        message="Se abrirá una nueva licitación en creación con los mismos datos e ítems de esta licitación. El ID de licitación quedará vacío para que ingreses uno nuevo. ¿Deseas continuar?"
        confirmText="Duplicar"
        confirmTone="primary"
        onCancel={() => setConfirmDuplicarOpen(false)}
        onConfirm={() => {
          setConfirmDuplicarOpen(false);
          duplicarLicitacion();
        }}
      />

      <ConfirmModal
        open={confirmEliminarDocOpen}
        title="Eliminar documento"
        message={`Vas a eliminar ${
          DOC_TIPOS[docAEliminar?.tipo] || "documento"
        }${docAEliminar?.numero ? ` (${docAEliminar.numero})` : ""}${
          docAEliminar?.file_name ? ` - ${docAEliminar.file_name}` : ""
        }. Esta acción no se puede deshacer.`}
        onCancel={() => {
          setConfirmEliminarDocOpen(false);
          setDocAEliminar(null);
        }}
        onConfirm={confirmarEliminarDocumento}
      />

      <ConfirmModal
        open={!!adjudicarPrompt && adjudicarPrompt.stage === "check"}
        title="Confirmar adjudicación"
        message={
          adjudicarPrompt
            ? `La cotización pasará a "Adjudicada". El Monto Total es $${adjudicarPrompt.total.toLocaleString("es-CL")}. ¿El monto adjudicado es igual a este total?`
            : ""
        }
        confirmText="Sí, es igual"
        cancelText="No, es distinto"
        confirmTone="primary"
        onConfirm={() => {
          const r = adjudicarPrompt?.resolve;
          setAdjudicarPrompt(null);
          r && r("igual");
        }}
        onCancel={() => {
          // Pasar a la segunda pregunta
          const total = adjudicarPrompt?.total || 0;
          const prevResolve = adjudicarPrompt?.resolve;
          setAdjudicarPrompt({
            stage: "modificar",
            total,
            resolve: prevResolve,
          });
        }}
      />

      <ConfirmModal
        open={!!adjudicarPrompt && adjudicarPrompt.stage === "modificar"}
        title="Monto distinto"
        message={
          adjudicarPrompt
            ? `El monto adjudicado es distinto al total de la cotización ($${adjudicarPrompt.total.toLocaleString("es-CL")}). ¿Desea modificar la cotización (cantidad, items, etc.) antes de adjudicar?`
            : ""
        }
        confirmText="Sí, modificar"
        cancelText="Abortar"
        confirmTone="primary"
        onConfirm={() => {
          const r = adjudicarPrompt?.resolve;
          setAdjudicarPrompt(null);
          r && r("modificar");
        }}
        onCancel={() => {
          const r = adjudicarPrompt?.resolve;
          setAdjudicarPrompt(null);
          r && r("abortar");
        }}
      />

      <ConfirmModal
        open={confirmEliminarOpen}
        title="Eliminar licitación"
        message="¿Seguro que deseas eliminar esta licitación? Esta acción no se puede deshacer."
        onCancel={() => setConfirmEliminarOpen(false)}
        onConfirm={eliminarLicitacion}
      />

      {mostrarPortalModal && (
        <CompartirPortalModal
          rut={rutEntidad}
          idLicitacion={idLicitacionInput}
          onClose={() => setMostrarPortalModal(false)}
          onToast={setToast}
        />
      )}

      {modalMotivoPerdidaOpen && (
        <ModalMotivoPerdida
          motivoActual={motivoPerdida}
          otroActual={motivoPerdidaOtro}
          onCancel={() => setModalMotivoPerdidaOpen(false)}
          onConfirm={(nuevoMotivo, nuevoOtro) => {
            setMotivoPerdida(nuevoMotivo);
            setMotivoPerdidaOtro(nuevoMotivo === "Otro" ? nuevoOtro : "");
            // Si veníamos del select (estado !== "Perdida"), aplicamos el cambio ahora.
            if (estado !== "Perdida") setEstado("Perdida");
            setModalMotivoPerdidaOpen(false);
          }}
        />
      )}

      {modalMotivoDescarteOpen && (
        <ModalMotivoDescarte
          motivoActual={motivoDescarte}
          comentarioActual={comentarioDescarte}
          onCancel={() => setModalMotivoDescarteOpen(false)}
          onConfirm={(nuevoMotivo, nuevoComentario) => {
            setMotivoDescarte(nuevoMotivo);
            setComentarioDescarte(nuevoComentario);
            if (estado !== "Descartada") setEstado("Descartada");
            setModalMotivoDescarteOpen(false);
          }}
        />
      )}
    </div>
  );
}

/* ============================================================
   Modal: motivo de pérdida (selección única + texto si "Otro")
============================================================ */
function ModalMotivoPerdida({ motivoActual, otroActual, onCancel, onConfirm }) {
  const [seleccion, setSeleccion] = useState(motivoActual || "");
  const [otro, setOtro] = useState(otroActual || "");

  const opciones = [
    "Precio",
    "Especificación técnica",
    "Documentación",
    "Plazo de entrega",
    "Otro",
  ];

  function confirmar() {
    if (!seleccion) return;
    if (seleccion === "Otro" && !otro.trim()) return;
    onConfirm(seleccion, otro.trim());
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15,23,42,0.45)",
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        style={{
          background: "var(--surface, #fff)",
          borderRadius: 10,
          padding: "20px 22px",
          width: "min(420px, 100%)",
          boxShadow: "0 20px 50px rgba(0,0,0,0.25)",
        }}
      >
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Motivo de pérdida</h3>
        <p style={{ fontSize: 12, color: "var(--text-muted, #64748b)", margin: "6px 0 14px" }}>
          Selecciona la razón por la que la cotización se perdió.
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {opciones.map((op) => (
            <label
              key={op}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                fontSize: 14,
                cursor: "pointer",
              }}
            >
              <input
                type="radio"
                name="motivo_perdida"
                value={op}
                checked={seleccion === op}
                onChange={() => setSeleccion(op)}
              />
              {op}
            </label>
          ))}
        </div>

        {seleccion === "Otro" && (
          <div style={{ marginTop: 12 }}>
            <label style={{ fontSize: 12, color: "var(--text-muted, #64748b)" }}>
              Especificar
            </label>
            <input
              type="text"
              value={otro}
              onChange={(e) => setOtro(e.target.value)}
              style={{
                width: "100%",
                padding: "8px 10px",
                borderRadius: 6,
                border: "1px solid var(--border, #e2e8f0)",
                marginTop: 4,
                fontSize: 14,
              }}
              autoFocus
            />
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 18 }}>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>
            Cancelar
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={!seleccion || (seleccion === "Otro" && !otro.trim())}
            onClick={confirmar}
          >
            Confirmar
          </button>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   Modal: motivo de descarte (Presupuesto / Quiebre stock) + comentario obligatorio
============================================================ */
function ModalMotivoDescarte({ motivoActual, comentarioActual, onCancel, onConfirm }) {
  const [seleccion, setSeleccion] = useState(motivoActual || "");
  const [comentario, setComentario] = useState(comentarioActual || "");

  const opciones = ["Presupuesto", "Quiebre stock", "Otro Motivo"];
  const valido = Boolean(seleccion) && comentario.trim().length > 0;

  function confirmar() {
    if (!valido) return;
    onConfirm(seleccion, comentario.trim());
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15,23,42,0.45)",
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        style={{
          background: "var(--surface, #fff)",
          borderRadius: 10,
          padding: "20px 22px",
          width: "min(440px, 100%)",
          boxShadow: "0 20px 50px rgba(0,0,0,0.25)",
        }}
      >
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Motivo de descarte</h3>
        <p style={{ fontSize: 12, color: "var(--text-muted, #64748b)", margin: "6px 0 14px" }}>
          Selecciona el motivo y agrega un comentario (obligatorio).
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {opciones.map((op) => (
            <label
              key={op}
              style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, cursor: "pointer" }}
            >
              <input
                type="radio"
                name="motivo_descarte"
                value={op}
                checked={seleccion === op}
                onChange={() => setSeleccion(op)}
              />
              {op}
            </label>
          ))}
        </div>

        <div style={{ marginTop: 14 }}>
          <label style={{ fontSize: 12, color: "var(--text-muted, #64748b)" }}>
            Comentario <span style={{ color: "#dc2626" }}>*</span>
          </label>
          <textarea
            value={comentario}
            onChange={(e) => setComentario(e.target.value)}
            rows={3}
            placeholder="Detalle del descarte…"
            style={{
              width: "100%",
              padding: "8px 10px",
              borderRadius: 6,
              border: "1px solid var(--border, #e2e8f0)",
              marginTop: 4,
              fontSize: 14,
              resize: "vertical",
              fontFamily: "inherit",
            }}
            autoFocus
          />
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 18 }}>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>
            Cancelar
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={!valido}
            onClick={confirmar}
          >
            Confirmar
          </button>
        </div>
      </div>
    </div>
  );
}

function CompartirPortalModal({ rut, idLicitacion, onClose, onToast }) {
  const portalBase = (import.meta.env.VITE_PORTAL_URL || window.location.origin).replace(/\/$/, "");
  const url = `${portalBase}/portal`;

  async function copiar(valor, etiqueta) {
    try {
      await navigator.clipboard.writeText(valor);
      onToast?.({ type: "success", message: `${etiqueta} copiado.` });
    } catch {
      onToast?.({ type: "error", message: "No se pudo copiar." });
    }
  }

  const filas = [
    { label: "URL del portal", valor: url, monospace: true },
    { label: "RUT", valor: rut, monospace: true },
    { label: "N° de cotización", valor: idLicitacion, monospace: true },
  ];

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 1000,
        background: "rgba(15,23,42,.45)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--surface, #fff)", borderRadius: 12,
          width: "100%", maxWidth: 520,
          boxShadow: "0 24px 64px rgba(15,23,42,.18)",
          border: "1px solid var(--border, #e2e8f0)",
          overflow: "hidden",
        }}
      >
        <div style={{
          padding: "16px 20px",
          borderBottom: "1px solid var(--border, #e2e8f0)",
          display: "flex", justifyContent: "space-between", alignItems: "center",
        }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text)" }}>Compartir portal del cliente</div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
              Copia cada dato y pégalo en el correo al cliente.
            </div>
          </div>
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", cursor: "pointer", fontSize: 22, lineHeight: 1, color: "var(--text-muted)" }}
          >
            ×
          </button>
        </div>

        <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 12 }}>
          {filas.map((f) => (
            <div key={f.label}>
              <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 4 }}>
                {f.label}
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  type="text"
                  readOnly
                  value={f.valor || ""}
                  onFocus={(e) => e.target.select()}
                  style={{
                    flex: 1, padding: "8px 12px",
                    border: "1px solid var(--border, #cbd5e1)", borderRadius: 8,
                    fontSize: 13, background: "var(--bg, #f8fafc)",
                    fontFamily: f.monospace ? "ui-monospace, monospace" : undefined,
                    color: "var(--text)",
                  }}
                />
                <button
                  type="button"
                  onClick={() => copiar(f.valor, f.label)}
                  className="btn btn-secondary"
                  style={{ whiteSpace: "nowrap" }}
                >
                  Copiar
                </button>
              </div>
            </div>
          ))}
        </div>

        <div style={{
          padding: "12px 20px 16px",
          borderTop: "1px solid var(--border, #e2e8f0)",
          display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center",
        }}>
          <button
            type="button"
            onClick={() => {
              const texto = [
                "Portal de seguimiento Amsodent",
                `URL: ${url}`,
                `RUT: ${rut}`,
                `N° de cotización: ${idLicitacion}`,
              ].join("\n");
              copiar(texto, "Bloque completo");
            }}
            className="btn btn-secondary"
          >
            Copiar todo (para correo)
          </button>
          <button type="button" onClick={onClose} className="btn btn-primary">
            Listo
          </button>
        </div>
      </div>
    </div>
  );
}
