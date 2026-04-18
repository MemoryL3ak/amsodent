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
import Select, { components } from "react-select";
import { generarPDFcotizacion } from "../utils/generarPDFcotizacion";
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

function isTipoOrdenCompra(value) {
  const v = (value || "")
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
  return (
    v === "orden compra" ||
    v === "orden de compra" ||
    v.includes("orden compra") ||
    v.includes("orden de compra")
  );
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
};
const DOC_BUCKET_BY_TIPO = {
  orden_compra: "orden-compra",
  guia_despacho: "guia-despacho",
  factura: "factura",
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
  const [guardandoDocEdit, setGuardandoDocEdit] = useState(false);
  const [aprobando, setAprobando] = useState(false);
  const [documentos, setDocumentos] = useState([]);
  const [docTipo, setDocTipo] = useState("orden_compra");
  const [docNumero, setDocNumero] = useState("");
  const [docMonto, setDocMonto] = useState("");
  const [docFechaOC, setDocFechaOC] = useState(fechaHoyISO());
  const [docDerivaDeId, setDocDerivaDeId] = useState("");
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
  const [margenAprobado, setMargenAprobado] = useState(false);
  const [tipoCompra, setTipoCompra] = useState("Compra ágil");
  const [montoAdicionalOC, setMontoAdicionalOC] = useState("");

  const [observaciones, setObservaciones] = useState("");

  const [vendedorNombre, setVendedorNombre] = useState("");
  const [vendedorCelular, setVendedorCelular] = useState("");
  const [vendedorCorreo, setVendedorCorreo] = useState("");

  const [rol, setRol] = useState(null);
  const esAdmin = useMemo(() => {
    const r = (rol ?? "").toString().trim().toLowerCase();
    return r === "admin" || r === "administrador";
  }, [rol]);

  /* ===============================
     DATOS ENTIDAD
  ================================ */
  const [rutEntidad, setRutEntidad] = useState("");
  const [nombreEntidad, setNombreEntidad] = useState("");
  const [departamento, setDepartamento] = useState("");
  const [municipalidad, setMunicipalidad] = useState("");
  const [region, setRegion] = useState("");
  const [comuna, setComuna] = useState("");
  const [direccion, setDireccion] = useState("");
  const [contacto, setContacto] = useState("");
  const [email, setEmail] = useState("");
  const [telefono, setTelefono] = useState("");
  const [condVenta, setCondVenta] = useState("");

  /* ===============================
     FLETE
  ================================ */
  const [fleteEstimado, setFleteEstimado] = useState(0);

  /* ===============================
     PRODUCTOS / ÍTEMS
  ================================ */
  const [productos, setProductos] = useState([]);
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
      setCondVenta(data.condiciones_venta || "");
    } catch (e) {
      // Client not found or error - ignore
    }
  }

  async function crearClienteSiNoExiste() {
    if (!rutEntidad) return;

    try {
      const existe = await api.get(`/clientes?rut=${encodeURIComponent(rutEntidad)}`);
      if (existe) return;
    } catch (e) {
      // Client not found - proceed to create
    }

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
      });
    } catch (error) {
      console.error("Error creando cliente:", error);
      throw new Error("No se pudo crear el cliente");
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
    if (!esAdmin) return;
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
    setDocEditFechaOC(doc.fecha_oc || "");
  }

  function cancelarEdicionDocumento() {
    setDocEditando(null);
    setDocEditNumero("");
    setDocEditMonto("");
    setDocEditFechaOC("");
  }

  async function guardarEdicionDocumento() {
    if (!docEditando?.id) return;
    setGuardandoDocEdit(true);
    try {
      const payload = {
        numero: docEditNumero.trim() || null,
        monto: docEditMonto ? Number(docEditMonto) : null,
      };
      if (docEditando.tipo === "orden_compra" && docEditFechaOC) {
        payload.fecha_oc = docEditFechaOC;
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

    const file = docFile;
    if (!file) {
      setToast({ type: "error", message: "Debes seleccionar un PDF." });
      return;
    }

    const tipo = String(docTipo || "").trim();
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
    const fechaOc = (docFechaOC || "").toString().trim();
    if (tipo === "orden_compra" && !fechaOc) {
      setToast({
        type: "error",
        message: "Debes ingresar la fecha de la orden de compra.",
      });
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

      const payload = {
        licitacion_id: Number(id),
        tipo,
        numero: (docNumero || "").trim() || null,
        monto: tipo === "orden_compra" ? montoNetoOrdenCompra : null,
        fecha_oc: tipo === "orden_compra" ? fechaOc : null,
        deriva_de_id: docDerivaDeId ? Number(docDerivaDeId) : null,
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
      setDocFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      setToast({
        type: "success",
        message: "Documento cargado correctamente.",
      });
      await cargarDocumentosLicitacion();
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
      setDepartamento(data.departamento || "");
      setMunicipalidad(data.municipalidad || "");
      setRegion(data.region || "");
      setComuna(data.comuna || "");
      setDireccion(data.direccion || "");
      setContacto(data.contacto || "");
      setEmail(data.email || "");
      setTelefono(data.telefono || "");
      setCondVenta(data.condVenta || "");

      setFleteEstimado(data.fleteEstimado || 0);
      setObservaciones(data.observaciones || "");

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
      items: (items || []).map((it) => ({
        uid: it.uid,
        id_item: it.id_item ?? null,
        orden: it.orden ?? null,
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
    setMargenAprobado(Boolean(lic.margen_aprobado));
    setTipoCompra(lic.tipo_compra || "Compra ágil");

    setRutEntidad(lic.rut_entidad || "");
    setNombreEntidad(lic.nombre_entidad || "");
    setDepartamento(lic.departamento || "");
    setMunicipalidad(lic.municipalidad || "");
    setRegion(lic.region || "");
    setComuna(lic.comuna || "");
    setDireccion(lic.direccion || "");
    setContacto(lic.contacto || "");
    setEmail(lic.email || "");
    setTelefono(lic.telefono || "");
    setCondVenta(lic.condicion_venta || "");
    setFleteEstimado(lic.flete_estimado || 0);

    setObservaciones(lic.observaciones || "");

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
        setProductos(data || []);
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
      setMargenAprobado(Boolean(lic.margen_aprobado));
      setTipoCompra(lic.tipo_compra || "Compra ágil");

      setRutEntidad(lic.rut_entidad || "");
      setNombreEntidad(lic.nombre_entidad || "");
      setDepartamento(lic.departamento || "");
      setMunicipalidad(lic.municipalidad || "");
      setRegion(lic.region || "");
      setComuna(lic.comuna || "");
      setDireccion(lic.direccion || "");
      setContacto(lic.contacto || "");
      setEmail(lic.email || "");
      setTelefono(lic.telefono || "");
      setCondVenta(lic.condicion_venta || "");
      setFleteEstimado(lic.flete_estimado || 0);

      setObservaciones(lic.observaciones || "");

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
  const montoConsumidoOCNeto = useMemo(
    () =>
      (documentos || [])
        .filter((d) => isTipoOrdenCompra(d?.tipo))
        .reduce((acc, d) => acc + parseMontoFlexible(d?.monto), 0),
    [documentos]
  );
  const montoConsumidoOC = calcularBrutoDesdeNeto(montoConsumidoOCNeto);
  const montoPresupuesto = parseMontoCL(monto);
  const saldoPresupuesto = montoPresupuesto - totalConIVA;
  const saldoPorConsumirResumen = Math.max(0, totalConIVA - montoConsumidoOC);
  const montoNetoOCFormulario = parseMontoCL(docMonto);
  const montoBrutoOCFormulario = calcularBrutoDesdeNeto(montoNetoOCFormulario);

  let porcentajePresupuesto = 0;
  if (montoPresupuesto > 0) porcentajePresupuesto = (totalConIVA / montoPresupuesto) * 100;

  let colorPresupuesto = "";
  if (porcentajePresupuesto <= 0)        colorPresupuesto = "";
  else if (porcentajePresupuesto <= 80)  colorPresupuesto = "presupuesto-ok";
  else if (porcentajePresupuesto <= 100) colorPresupuesto = "presupuesto-warn";
  else                                   colorPresupuesto = "presupuesto-over";

  function actualizarPreciosPorLista(nuevaLista) {
    if (!esEditable) return;

    const copia = items.map((it) => {
      if (it.precioManual) {
        const cantidad = Math.max(1, Number(it.cantidad || 1));
        return {
          ...it,
          total: redondear(
            cantidad * (Number(it.precio || 0) + fletePorUnidad)
          ),
        };
      }

      const sku = String(it.sku || "").trim();
      const productoNombre = String(it.producto || "").trim();

      const prod = sku
        ? productos.find((p) => String(p.sku || "").trim() === sku)
        : productoNombre
        ? productos.find((p) => String(p.nombre || "").trim() === productoNombre)
        : null;

      if (!prod) return it;

      const listaValida = nuevaLista === "2" ? "lista2" : "lista1";
      const skuProd = String(prod.sku || "").trim();

      const precioCampania = skuProd ? campaignPriceBySku.get(skuProd) : null;
      const precioBase =
        precioCampania != null
          ? Number(precioCampania)
          : Number(prod[listaValida] ?? 0);

      const cantidad = Math.max(1, Number(it.cantidad || 1));

      return {
        ...it,
        sku: skuProd || it.sku || "",
        precio: precioBase,
        precioUnitarioStr: "",
        total: redondear(cantidad * (precioBase + fletePorUnidad)),
      };
    });

    setItems(copia);
  }

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
          : Number(prod[`lista${listado}`] ?? 0);

      item.precioManual = false;
      item.precioUnitarioStr = "";
    }

    const cantidad = Math.max(1, Number(item.cantidad || 1));
    item.total = redondear(
      cantidad * (Number(item.precio || 0) + fletePorUnidad)
    );

    copia[index] = item;
    setItems(copia);
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
      const fechaHoy = new Date().toISOString().slice(0, 10);

      await generarPDFcotizacion({
        numero_licitacion: id,
        id_licitacion: idLicitacionInput,
        fecha_emision: fechaHoy,

        nombre_entidad: nombreEntidad,
        rut_entidad: rutEntidad,
        direccion,
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

    const errores = [];
    if (!idLicitacionInput) errores.push("ID Licitación");
    if (!nombre) errores.push("Nombre Licitación");
    if (!fechaHoraCierre) errores.push("Fecha y Hora de Cierre");
    if (!monto) errores.push("Monto");
    if (!rutEntidad) errores.push("RUT Entidad");
    if (!nombreEntidad) errores.push("Nombre Entidad");
    if (!departamento) errores.push("Departamento");
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
          id_licitacion: idLicitacionInput,
          nombre,
          fecha_hora_cierre: fechaHoraCierre,
          monto: parseMontoCL(monto),
          lista_precios: Number(listado),

          rut_entidad: rutEntidad,
          nombre_entidad: nombreEntidad,
          departamento,
          municipalidad,
          direccion,
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
        });
      } catch (errUpdate) {
        console.error(errUpdate);
        setToast({ type: "error", message: "Error al guardar licitación" });
        return false;
      }
      setEstadoActualDB(estadoFinal);

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

      <div className="page-header">
        <div>
          <h1 className="page-title">Edición de Cotizaciones #{idLicitacionInput}</h1>
        </div>
        <div className="btn-row">
          <button
            type="button"
            onClick={() => setConfirmDuplicarOpen(true)}
            className="btn btn-secondary"
          >
            Duplicar
          </button>
          {esAdmin && estado === "Pendiente Aprobación" && (
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
              ID Cotización *
            </label>
            <input
              className={inputClass}
              value={idLicitacionInput}
              onChange={(e) => {
                setIdLicitacionInput(e.target.value);
                setIsDirty(true);
              }}
              disabled={!esEditable}
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

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Lista de Precios *
            </label>
            <select
              className={inputClass}
              value={listado}
              onChange={(e) => {
                setListado(e.target.value);
                actualizarPreciosPorLista(e.target.value);
              }}
              disabled={!esEditable}
            >
              <option value="1">Lista 1</option>
              <option value="2">Lista 2</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Tipo de Compra *
            </label>
            <select
              className={inputClass}
              value={tipoCompra}
              onChange={(e) => setTipoCompra(e.target.value)}
              disabled={!esEditable}
            >
              <option value="Compra ágil">Compra ágil</option>
              <option value="Compra directa">Compra directa</option>
              <option value="Licitación">Licitación</option>
              <option value="Cliente particular">Cliente particular</option>
            </select>
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
              onChange={(e) => setEstado(e.target.value)}
              disabled={!puedeEditarEstado}
            >
              <option value="En espera">En espera</option>
              <option value="Pendiente Aprobación">Pendiente Aprobación</option>
              <option value="Adjudicada">Adjudicada</option>
              <option value="Perdida">Perdida</option>
              <option value="Desierta">Desierta</option>
              <option value="Descartada">Descartada</option>
            </select>
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
              Departamento *
            </label>
            <input
              className={inputClass}
              value={departamento}
              onChange={(e) => setDepartamento(e.target.value)}
              disabled={!esEditable}
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
                      <div className={esAdmin ? "md:col-span-6" : "md:col-span-7"}>
                        <label className="block text-xs text-gray-600 mb-1">
                          Producto *
                        </label>
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
          </div>
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
                ${montoConsumidoOC.toLocaleString("es-CL")}
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

        <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-end">
          <div className="md:col-span-3">
            <label className="block text-sm font-medium text-gray-700 mb-1">Tipo *</label>
            <select
              className={`${inputClass} text-sm`}
              value={docTipo}
              onChange={(e) => setDocTipo(e.target.value)}
              disabled={subiendoDoc}
            >
              <option value="orden_compra">Orden de Compra</option>
              <option value="guia_despacho">Guía de Despacho</option>
            </select>
          </div>

          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">Número</label>
            <input
              className={`${inputClass} text-sm`}
              value={docNumero}
              onChange={(e) => setDocNumero(e.target.value)}
              placeholder="Ej: OC-2026-001"
              disabled={subiendoDoc}
            />
          </div>

          {docTipo === "orden_compra" && (
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
          )}

          {docTipo === "orden_compra" && (
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Fecha OC *</label>
              <input
                type="date"
                className={`${inputClass} text-sm`}
                value={docFechaOC}
                onChange={(e) => setDocFechaOC(e.target.value)}
                disabled={subiendoDoc}
              />
            </div>
          )}

          {docTipo === "orden_compra" && (
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
          )}

          {docTipo === "guia_despacho" && (
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Deriva de *
              </label>
              <Select
                options={opcionesDerivaSelect}
                styles={customStyles}
                placeholder="Buscar documento"
                menuPortalTarget={document.body}
                isSearchable={true}
                filterOption={filtrarPorTerminos}
                isClearable={true}
                isDisabled={subiendoDoc}
                noOptionsMessage={() => "Sin documentos disponibles"}
                value={
                  opcionesDerivaSelect.find((o) => o.value === String(docDerivaDeId)) ||
                  null
                }
                onChange={(op) => setDocDerivaDeId(op?.value || "")}
              />
            </div>
          )}

          <div className="md:col-span-3">
            <label className="block text-sm font-medium text-gray-700 mb-1">PDF *</label>
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
                Seleccionar PDF
              </button>
              <span className="text-sm text-gray-500 truncate max-w-[160px]">
                {docFile ? docFile.name : "Sin archivo"}
              </span>
            </div>
          </div>

          <div className="md:col-span-2">
            <button
              type="button"
              onClick={subirDocumento}
              disabled={subiendoDoc}
              className="btn btn-primary"
            >
              {subiendoDoc ? "Subiendo…" : "Agregar"}
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
                      {editando && doc.tipo === "orden_compra" ? (
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
                        ? `$${calcularBrutoDesdeNeto(editando && doc.tipo === "orden_compra" ? Number(docEditMonto || 0) : doc.monto).toLocaleString("es-CL")}`
                        : "-"}
                    </td>
                    <td className="px-3 py-2 text-sm">
                      {docOrigen
                        ? `${DOC_TIPOS[docOrigen.tipo] || docOrigen.tipo}${docOrigen.numero ? ` - ${docOrigen.numero}` : ""}`
                        : "-"}
                    </td>
                    <td className="px-3 py-2 text-sm">{doc.file_name || "-"}</td>
                    <td className="px-3 py-2 text-sm">
                      {editando && doc.tipo === "orden_compra" ? (
                        <input
                          type="date"
                          className="input text-sm"
                          style={{ width: 140 }}
                          value={docEditFechaOC}
                          onChange={(e) => setDocEditFechaOC(e.target.value)}
                        />
                      ) : doc.tipo === "orden_compra" && doc.fecha_oc
                        ? new Date(`${doc.fecha_oc}T00:00:00`).toLocaleDateString("es-CL")
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
    </div>
  );
}
