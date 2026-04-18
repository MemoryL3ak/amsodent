// DetalleLicitacion.jsx (EditarLicitacion)
// ✅ Regla: TODOS los campos se editan SOLO cuando estado === "En espera"
// ✅ Estado SIEMPRE se puede cambiar
// ✅ Drag & drop / ítems / flete / observaciones / entidad / licitación: bloqueados si no está "En espera"

import React, { useEffect, useRef, useState, useCallback } from "react";
import { supabase } from "../lib/supabase";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import Toast from "../components/Toast";
import Select, { components } from "react-select";
import { generarPDFcotizacion } from "../utils/generarPDFcotizacion";
import { useUnsavedChanges } from "../context/UnsavedChangesContext";

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
   ESTILOS SELECT
============================================================ */
const customStyles = {
  control: (base) => ({
    ...base,
    minHeight: "40px",
    fontSize: "13px",
    fontFamily: "inherit",
  }),
  valueContainer: (base) => ({
    ...base,
    fontSize: "13px",
    fontFamily: "inherit",
  }),
  input: (base) => ({
    ...base,
    fontSize: "13px",
    fontFamily: "inherit",
    color: "#333",
  }),
  singleValue: (base) => ({
    ...base,
    fontSize: "13px",
    fontFamily: "inherit",
  }),
  option: (base, state) => ({
    ...base,
    fontSize: "13px",
    fontFamily: "inherit",
    background: state.isFocused ? "#1A73E8" : "white",
    color: state.isFocused ? "white" : "#333",
    cursor: "pointer",
  }),
  placeholder: (base) => ({
    ...base,
    fontSize: "13px",
    fontFamily: "inherit",
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
};

/* ============================================================
   REGIONES / COMUNAS
   ⚠️ Pega aquí tu objeto REGIONES_CHILE completo (el mismo que ya tienes)
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
        dragHandleProps: { ...attributes, ...listeners, ref: setActivatorNodeRef },
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

  const baseLicitaciones = location.pathname.startsWith("/app/")
    ? "/app/licitaciones"
    : location.pathname.startsWith("/dashboard/")
    ? "/dashboard/licitaciones"
    : "/licitaciones";

  function volver() {
    if (window.history.length > 1) requestNavigation(-1);
    else requestNavigation(baseLicitaciones, { replace: true });
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

  // ✅ NUEVO: estados para mostrar generación PDF / evitar doble click
  const [guardando, setGuardando] = useState(false);
  const [generandoPDF, setGenerandoPDF] = useState(false);

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
  const [tipoCompra, setTipoCompra] = useState("Compra ágil");

  // ✅ Observaciones generales
  const [observaciones, setObservaciones] = useState("");

  // ✅ Vendedor (para PDF)
  const [vendedorNombre, setVendedorNombre] = useState("");
  const [vendedorCelular, setVendedorCelular] = useState("");
  const [vendedorCorreo, setVendedorCorreo] = useState("");

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
      sku: "",
      producto: "",
      categoria: "",
      formato: "",
      cantidad: 0,
      precio: 0, // base sin flete
      total: 0,
      observacion: "",
      mostrarObs: false,

      // ✅ Precio Unitario editable (incluye flete)
      precioManual: false,
      precioUnitarioStr: "",
    },
  ]);

  const [campaignPriceBySku, setCampaignPriceBySku] = useState(new Map());
  const [hydrated, setHydrated] = useState(false);

  /* ============================================================
     ✅ REGLA DE EDICIÓN
     Solo editable cuando estado === "En espera"
============================================================ */
  const esEditable = estado === "En espera";
  const lockInput = esEditable ? "" : "bg-gray-100 text-gray-500 cursor-not-allowed";
  const lockBtn = esEditable ? "" : "opacity-50 cursor-not-allowed";
  const lockProps = esEditable ? {} : { disabled: true };
  const readOnlyProps = esEditable ? {} : { readOnly: true };

  /* ============================================================
     Cliente helpers (✅ maybeSingle para evitar 406)
============================================================ */
  async function buscarClientePorRut(rut) {
    if (!rut) return;

    const { data, error } = await supabase
      .from("clientes")
      .select("*")
      .eq("rut", rut)
      .maybeSingle();

    if (error || !data) return;

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
  }

  async function crearClienteSiNoExiste() {
    if (!rutEntidad) return;

    const { data: existe, error: errExiste } = await supabase
      .from("clientes")
      .select("id")
      .eq("rut", rutEntidad)
      .maybeSingle();

    if (errExiste) {
      console.error("Error verificando cliente:", errExiste);
      throw new Error("No se pudo verificar el cliente");
    }

    if (existe) return;

    const { error } = await supabase.from("clientes").insert([
      {
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
      },
    ]);

    if (error) {
      console.error("Error creando cliente:", error);
      throw new Error("No se pudo crear el cliente");
    }
  }

  /* ============================================================
     ✅ Cargar vendedor desde sesión (fallback si la licitación no trae datos)
============================================================ */
  useEffect(() => {
    (async () => {
      try {
        const { data } = await supabase.auth.getUser();
        const user = data?.user;

        if (!user) return;

        const meta = user.user_metadata || {};
        const emailAuth = user.email || "";

        setVendedorCorreo((prev) => prev || emailAuth || "");
        setVendedorNombre(
          (prev) =>
            prev ||
            meta?.nombre ||
            meta?.name ||
            meta?.full_name ||
            meta?.display_name ||
            ""
        );
        setVendedorCelular(
          (prev) => prev || meta?.celular || meta?.phone || meta?.telefono || ""
        );
      } catch (e) {}
    })();
  }, []);

  /* ============================================================
     Crear Item Vacío
============================================================ */
  function crearItemVacio() {
    return {
      uid: generarUid(),
      id_item: null,
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
    };

    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }, [
    hydrated,
    STORAGE_KEY,
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

  /* ============================================================
     DETECCIÓN DE CAMBIOS
============================================================ */
  function buildSnapshot() {
    return JSON.stringify({
      idLicitacionInput: idLicitacionInput || "",
      nombre: nombre || "",
      fechaHoraCierre: fechaHoraCierre || "",
      monto: Number(monto || 0),
      listado: String(listado || "1"),
      estado: estado || "En espera",
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

    const { data: lic, error: errLic } = await supabase
      .from("licitaciones")
      .select("*")
      .eq("id", id)
      .single();

    if (errLic || !lic) {
      setToast({ type: "error", message: "Error recargando la licitación" });
      setLoading(false);
      return;
    }

    const { data: itemsDB } = await supabase
      .from("items_licitacion")
      .select("*")
      .eq("licitacion_id", id);

    setIdLicitacionInput(lic.id_licitacion || "");
    setNombre(lic.nombre || "");
    setFechaHoraCierre(lic.fecha_hora_cierre || "");
    setMonto(lic.monto || "");
    setListado(String(lic.lista_precios || "1"));
    setEstado(lic.estado || "En espera");
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
      const { data } = await supabase
        .from("productos")
        .select("*")
        .order("id")
        .limit(20000);

      setProductos(data || []);
    }
    cargarProductos();
  }, []);

  /* ============================================================
     Campañas vigentes
============================================================ */
  useEffect(() => {
    async function cargarCampaniasVigentes() {
      try {
        const hoy = new Date().toISOString().slice(0, 10);

        const { data: campaigns, error: e1 } = await supabase
          .from("product_campaigns")
          .select("id, created_at")
          .lte("start_date", hoy)
          .gte("end_date", hoy)
          .order("created_at", { ascending: false });

        if (e1) throw e1;

        const ids = (campaigns || []).map((c) => c.id);
        if (ids.length === 0) {
          setCampaignPriceBySku(new Map());
          return;
        }

        const { data: itemsCamp, error: e2 } = await supabase
          .from("product_campaign_items")
          .select("sku, precio_campania, campaign_id, created_at")
          .in("campaign_id", ids)
          .order("created_at", { ascending: false });

        if (e2) throw e2;

        const m = new Map();
        (itemsCamp || []).forEach((row) => {
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
        setLoading(false);
        return;
      }

      setLoading(true);

      const { data: lic, error: errLic } = await supabase
        .from("licitaciones")
        .select("*")
        .eq("id", id)
        .single();

      if (errLic || !lic) {
        setToast({ type: "error", message: "Error cargando la licitación" });
        setLoading(false);
        return;
      }

      const { data: itemsDB } = await supabase
        .from("items_licitacion")
        .select("*")
        .eq("licitacion_id", id);

      setIdLicitacionInput(lic.id_licitacion || "");
      setNombre(lic.nombre || "");
      setFechaHoraCierre(lic.fecha_hora_cierre || "");
      setMonto(lic.monto || "");
      setListado(String(lic.lista_precios || "1"));
      setEstado(lic.estado || "En espera");
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

  /* ============================================================
     ✅ Precio Unitario editable (incluye flete)
============================================================ */
  function actualizarPrecioUnitario(index, valorStr) {
    if (!esEditable) return;

    const copia = [...items];
    const item = { ...copia[index] };

    item.precioUnitarioStr = formatearCLDesdeString(valorStr);
    const unitConFlete = parseMontoCL(item.precioUnitarioStr);

    const baseSinFlete = Math.max(0, unitConFlete - Number(fletePorUnidad || 0));
    item.precio = baseSinFlete;
    item.precioManual = true;

    const cantidad = Math.max(1, Number(item.cantidad || 1));
    item.total = redondear(
      cantidad * (baseSinFlete + Number(fletePorUnidad || 0))
    );

    copia[index] = item;
    setItems(copia);
  }

  /* ============================================================
     Recalcular totales con flete
============================================================ */
  useEffect(() => {
    if (!hydrated) return;

    const copia = items.map((it) => {
      const cantidad = Math.max(1, Number(it.cantidad || 1));

      if (it.precioManual && (it.precioUnitarioStr ?? "") !== "") {
        const unitConFlete = parseMontoCL(it.precioUnitarioStr);
        const baseSinFlete = Math.max(
          0,
          unitConFlete - Number(fletePorUnidad || 0)
        );
        return {
          ...it,
          precio: baseSinFlete,
          total: redondear(
            cantidad * (baseSinFlete + Number(fletePorUnidad || 0))
          ),
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

  let porcentajePresupuesto = 0;
  if (Number(monto) > 0) {
    porcentajePresupuesto = (totalConIVA / Number(monto)) * 100;
  }

  let colorPresupuesto = "text-gray-700 bg-gray-100 border-gray-300";
  if (porcentajePresupuesto <= 80)
    colorPresupuesto = "text-green-700 bg-green-100 border-green-300";
  else if (porcentajePresupuesto <= 100)
    colorPresupuesto = "text-yellow-700 bg-yellow-100 border-yellow-300";
  else colorPresupuesto = "text-red-700 bg-red-100 border-red-300";

  /* ============================================================
     CAMBIO DE LISTA (NO pisa precios manuales)
============================================================ */
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

  /* ============================================================
     ACTUALIZAR ÍTEM
============================================================ */
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

  /* ============================================================
     OBS / CRUD / INSERT ENTRE ITEMS
============================================================ */
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
      await supabase.from("items_licitacion").delete().eq("id", target.id_item);
    }

    const copia = [...items];
    copia.splice(index, 1);
    setItems(copia);
  }

  /* ============================================================
     DRAG & DROP (bloqueado si no editable)
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

      const oldIndex = items.findIndex((it) => it.uid === active.id);
      const newIndex = items.findIndex((it) => it.uid === over.id);
      if (oldIndex === -1 || newIndex === -1) return;

      setItems((prev) => arrayMove(prev, oldIndex, newIndex));
    },
    [items, esEditable]
  );

  /* ============================================================
     EXPORTAR PDF (permitido siempre)
============================================================ */
  async function exportarPDF() {
    if (guardando || generandoPDF) return;

    setToast(null);
    setGenerandoPDF(true);

    try {
      const fechaHoy = new Date().toISOString().slice(0, 10);

      const ITEMS_POR_PAGINA = 23;

      const chunk = (arr, size) => {
        const out = [];
        for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
        return out;
      };

      const partes = chunk(items, ITEMS_POR_PAGINA);

      const pages = partes.map((itemsPagina, pageIndex) => {
        const baseIndex = pageIndex * ITEMS_POR_PAGINA;

        const items_tabla = itemsPagina
          .map((it, idx) => {
            const nro = baseIndex + idx + 1;
            const skuTxt = String(it.sku || "").trim();
            const unitario = Number(it.precio || 0) + fletePorUnidad;

            const fila = `
              <tr>
                <td>${nro}</td>
                <td>${skuTxt}</td>
                <td>${it.producto}</td>
                <td>${it.formato}</td>
                <td>${it.cantidad}</td>
                <td>$ ${formatear(unitario)}</td>
                <td>$ ${formatear(it.total)}</td>
              </tr>
            `;

            const filaObs = it.observacion
              ? `
              <tr>
                <td></td>
                <td></td>
                <td colspan="5" style="font-style: italic; color: #444;">
                  Observación: ${it.observacion}
                </td>
              </tr>`
              : "";

            return fila + filaObs;
          })
          .join("");

        return {
          items_tabla,
          showBottom: pageIndex === partes.length - 1,
        };
      });

      const vendedor_nombre = (vendedorNombre || "").toString();
      const vendedor_celular = (vendedorCelular || "").toString();
      const vendedor_correo = (vendedorCorreo || "").toString();

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

        vendedor_nombre,
        vendedor_celular,
        vendedor_correo,
        vendedor_ccorreo: vendedor_correo,

        observaciones: (observaciones ?? "").toString(),

        pages,

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
     ✅ Permitido siempre (incluye cambios de estado)
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

    try {
      const idLicitacionNorm = (idLicitacionInput || "").toString().trim();

      const { data: dup, error: errDup } = await supabase
        .from("licitaciones")
        .select("id")
        .eq("id_licitacion", idLicitacionNorm)
        .neq("id", id)
        .limit(1);

      if (errDup) {
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

      const { error: errUpdate } = await supabase
        .from("licitaciones")
        .update({
          id_licitacion: idLicitacionInput,
          nombre,
          fecha_hora_cierre: fechaHoraCierre,
          monto: Number(monto),
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

          estado,
          flete_estimado: Number(fleteEstimado),

          total_con_iva: totalConIVA,
          total_sin_iva: totalNeto,
          total_iva: totalIVA,

          observaciones: observaciones || null,
        })
        .eq("id", id);

      if (errUpdate) {
        console.error(errUpdate);
        setToast({ type: "error", message: "Error al guardar licitación" });
        return false;
      }

      // Si NO es editable, igual guardamos licitación (estado), pero NO permitimos cambios de ítems
      // (Los ítems no deberían cambiar porque UI está bloqueada, pero esto agrega seguridad)
      if (!esEditable) {
        setToast({
          type: "success",
          message: `Estado actualizado correctamente.`,
        });

        localStorage.removeItem(STORAGE_KEY);
        baselineRef.current = buildSnapshot();
        setIsDirty(false);
        return true;
      }

      // 1) Filtrar filas completamente vacías
      const itemsParaGuardar = (items || []).filter((it) => {
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

      // 2) Validar: SKU ya no es obligatorio
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

      // 3) UPSERT (SKU opcional -> null)
      for (const it of itemsParaGuardar) {
        const skuLimpio = String(it?.sku ?? "").trim();

        const payload = {
          licitacion_id: id,
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
          const { error: eUpd } = await supabase
            .from("items_licitacion")
            .update(payload)
            .eq("id", it.id_item);

          if (eUpd) {
            console.error(eUpd);
            setToast({ type: "error", message: "Error al guardar un ítem" });
            return false;
          }
        } else {
          const { data: ins, error: eIns } = await supabase
            .from("items_licitacion")
            .insert([payload])
            .select("id")
            .single();

          if (eIns) {
            console.error(eIns);
            setToast({ type: "error", message: "Error al insertar un ítem" });
            return false;
          }

          if (ins?.id) {
            setItems((prev) =>
              prev.map((x) => (x.uid === it.uid ? { ...x, id_item: ins.id } : x))
            );
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
    <div className="w-full max-w-none mx-auto p-8">
      {/* Overlay durante guardado / generación de PDF */}
      {(guardando || generandoPDF) && (
        <div className="fixed inset-0 z-[99999] bg-black/40 flex items-center justify-center">
          <div className="bg-white rounded-xl shadow-lg p-6 w-[360px] text-center">
            <div className="text-lg font-semibold text-gray-900">
              {generandoPDF ? "Generando PDF…" : "Guardando licitación…"}
            </div>
            <div className="text-sm text-gray-600 mt-2">
              Por favor no cierres ni recargues la página.
            </div>
            <div className="mt-4 animate-pulse text-gray-500 text-sm">
              Procesando…
            </div>
          </div>
        </div>
      )}

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

      <div className="flex items-center justify-between mb-4">
        <h1 className="text-3xl font-semibold text-gray-900">
          Edición de Licitación #{idLicitacionInput}
        </h1>

        <button
          type="button"
          onClick={volver}
          className="cursor-pointer select-none text-sm px-3 py-2 rounded-md bg-gray-200 hover:bg-gray-300 transition"
        >
          ← Volver
        </button>
      </div>

      {/* Aviso bloqueo */}
      {!esEditable && (
        <div className="mb-6 rounded-lg border border-yellow-200 bg-yellow-50 px-4 py-3 text-sm text-yellow-900">
          Esta licitación está en estado <b>{estado}</b>. La edición de campos está bloqueada.
          Para editar, cambia el estado a <b>En espera</b>.
        </div>
      )}

      {/* DATOS LICITACIÓN */}
      <h2 className="text-xl font-semibold text-gray-800 mb-3">
        Datos de la Licitación
      </h2>

      <div className="bg-white border border-gray-200 shadow-sm rounded-xl p-6 mb-10">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              ID Licitación *
            </label>
            <input
              className={`w-full rounded-md border border-gray-300 px-3 py-2 ${lockInput}`}
              value={idLicitacionInput}
              onChange={(e) => {
                if (!esEditable) return;
                setIdLicitacionInput(e.target.value);
                setIsDirty(true);
              }}
              {...readOnlyProps}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Nombre Licitación *
            </label>
            <input
              className={`w-full rounded-md border border-gray-300 px-3 py-2 ${lockInput}`}
              value={nombre}
              onChange={(e) => esEditable && setNombre(e.target.value)}
              {...readOnlyProps}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Fecha y Hora de Cierre *
            </label>
            <input
              type="datetime-local"
              className={`w-full rounded-md border border-gray-300 px-3 py-2 ${lockInput}`}
              value={fechaHoraCierre}
              onChange={(e) => esEditable && setFechaHoraCierre(e.target.value)}
              {...lockProps}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Monto Presupuesto *
            </label>
            <input
              type="number"
              className={`w-full rounded-md border border-gray-300 px-3 py-2 ${lockInput}`}
              value={monto}
              onChange={(e) => esEditable && setMonto(e.target.value)}
              {...lockProps}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Lista de Precios *
            </label>
            <select
              className={`w-full rounded-md border border-gray-300 px-3 py-2 ${lockInput}`}
              value={listado}
              onChange={(e) => {
                if (!esEditable) return;
                setListado(e.target.value);
                actualizarPreciosPorLista(e.target.value);
              }}
              {...lockProps}
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
              className={`w-full rounded-md border border-gray-300 px-3 py-2 ${lockInput}`}
              value={tipoCompra}
              onChange={(e) => esEditable && setTipoCompra(e.target.value)}
              {...lockProps}
            >
              <option value="Compra ágil">Compra ágil</option>
              <option value="Compra directa">Compra directa</option>
              <option value="Licitación">Licitación</option>
            </select>
          </div>

          {/* ✅ Estado siempre editable */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Estado
            </label>

            <select
              className={`w-full rounded-md border px-3 py-2 ${
                estadoStyles[estado] || ""
              }`}
              value={estado}
              onChange={(e) => setEstado(e.target.value)}
            >
              <option value="En espera">En espera</option>
              <option value="Adjudicada">Adjudicada</option>
              <option value="Perdida">Perdida</option>
              <option value="Desierta">Desierta</option>
              <option value="Descartada">Descartada</option>
            </select>
          </div>
        </div>
      </div>

      {/* DATOS ENTIDAD */}
      <div className="flex justify-between items-center mb-3">
        <h2 className="text-xl font-semibold text-gray-800">Datos de la Entidad</h2>

        <button
          className="text-sm px-3 py-1 bg-gray-200 rounded-md hover:bg-gray-300 transition"
          onClick={() => setMostrarEntidad(!mostrarEntidad)}
          type="button"
        >
          {mostrarEntidad ? "Ocultar ▲" : "Mostrar ▼"}
        </button>
      </div>

      <div
        className={`bg-white border border-gray-200 shadow-sm rounded-xl p-6 mb-10 transition-all duration-300 overflow-hidden ${
          mostrarEntidad ? "max-h-[2000px] opacity-100" : "max-h-0 opacity-0"
        }`}
      >
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              RUT *
            </label>
            <input
              className={`w-full rounded-md border border-gray-300 px-3 py-2 ${lockInput}`}
              value={rutEntidad}
              onChange={(e) => esEditable && setRutEntidad(e.target.value)}
              onBlur={() => esEditable && buscarClientePorRut(rutEntidad)}
              {...readOnlyProps}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Nombre Entidad *
            </label>
            <input
              className={`w-full rounded-md border border-gray-300 px-3 py-2 ${lockInput}`}
              value={nombreEntidad}
              onChange={(e) => esEditable && setNombreEntidad(e.target.value)}
              {...readOnlyProps}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Departamento *
            </label>
            <input
              className={`w-full rounded-md border border-gray-300 px-3 py-2 ${lockInput}`}
              value={departamento}
              onChange={(e) => esEditable && setDepartamento(e.target.value)}
              {...readOnlyProps}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Municipalidad
            </label>
            <input
              className={`w-full rounded-md border border-gray-300 px-3 py-2 ${lockInput}`}
              value={municipalidad}
              onChange={(e) => esEditable && setMunicipalidad(e.target.value)}
              {...readOnlyProps}
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
                if (!esEditable) return;
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
              onChange={(op) => esEditable && setComuna(op ? op.value : "")}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Dirección *
            </label>
            <input
              className={`w-full rounded-md border border-gray-300 px-3 py-2 ${lockInput}`}
              value={direccion}
              onChange={(e) => esEditable && setDireccion(e.target.value)}
              {...readOnlyProps}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Contacto
            </label>
            <input
              className={`w-full rounded-md border border-gray-300 px-3 py-2 ${lockInput}`}
              value={contacto}
              onChange={(e) => esEditable && setContacto(e.target.value)}
              {...readOnlyProps}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Email
            </label>
            <input
              type="email"
              className={`w-full rounded-md border border-gray-300 px-3 py-2 ${lockInput}`}
              value={email}
              onChange={(e) => esEditable && setEmail(e.target.value)}
              {...readOnlyProps}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Teléfono
            </label>
            <input
              className={`w-full rounded-md border border-gray-300 px-3 py-2 ${lockInput}`}
              value={telefono}
              onChange={(e) => esEditable && setTelefono(e.target.value)}
              {...readOnlyProps}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Condiciones de Venta *
            </label>

            <select
              className={`w-full rounded-md border border-gray-300 px-3 py-2 ${lockInput}`}
              value={condVenta}
              onChange={(e) => esEditable && setCondVenta(e.target.value)}
              {...lockProps}
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

      {/* ÍTEMS */}
      <h2 className="text-xl font-semibold text-gray-800 mb-3">Ítems</h2>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={items.map((it) => it.uid)}
          strategy={verticalListSortingStrategy}
        >
          <div className="space-y-6 max-h-[480px] overflow-y-auto overflow-x-auto pr-2">
            {items.map((it, index) => (
              <SortableItem key={it.uid} itemId={it.uid} disabled={!esEditable}>
                {({ dragHandleProps }) => (
                  <div className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm space-y-3">
                    <div className="grid grid-cols-1 md:grid-cols-[repeat(24,minmax(0,1fr))] gap-4 items-end">
                      {/* Items */}
                      <div className="md:col-span-1">
                        <label className="block text-xs text-gray-600 mb-1">
                          Items
                        </label>
                        <div className="w-full h-10 rounded-md border border-gray-300 px-3 flex items-center justify-center font-semibold bg-gray-50">
                          {index + 1}
                        </div>
                      </div>

                      {/* SKU */}
                      <div className="md:col-span-3">
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
                          onChange={(op) => {
                            if (!esEditable) return;
                            actualizarItem(index, "sku", op ? op.value : "");
                          }}
                        />
                      </div>

                      {/* Producto */}
                      <div className="md:col-span-5">
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
                          onChange={(op) => {
                            if (!esEditable) return;
                            actualizarItem(index, "producto", op ? op.value : "");
                          }}
                          components={{ SingleValue: ProductoSingleValue }}
                          setTooltip={setTooltip}
                        />
                      </div>

                      {/* Categoría */}
                      <div className="md:col-span-3">
                        <label className="block text-xs text-gray-600 mb-1">
                          Categoría
                        </label>
                        <input
                          className="w-full h-10 rounded-md border border-gray-300 bg-gray-100 px-4 text-[13px] truncate"
                          value={it.categoria}
                          readOnly
                        />
                      </div>

                      {/* Formato */}
                      <div className="md:col-span-2">
                        <label className="block text-xs text-gray-600 mb-1">
                          Formato
                        </label>
                        <input
                          className={`w-full h-10 rounded-md border border-gray-300 px-3 text-sm ${lockInput}`}
                          value={it.formato}
                          onChange={(e) =>
                            esEditable && actualizarItem(index, "formato", e.target.value)
                          }
                          {...readOnlyProps}
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
                          className={`w-full h-10 rounded-md border border-gray-300 px-3 text-sm ${lockInput}`}
                          value={it.cantidad}
                          onInput={(e) => {
                            if (!esEditable) return;
                            e.target.value = e.target.value.replace(/[^0-9]/g, "");
                            if (e.target.value === "" || Number(e.target.value) <= 0) {
                              e.target.value = "1";
                            }
                          }}
                          onChange={(e) =>
                            esEditable && actualizarItem(index, "cantidad", e.target.value)
                          }
                          {...lockProps}
                        />
                      </div>

                      {/* Precio Unitario (editable) */}
                      <div className="md:col-span-2">
                        <label className="block text-xs text-gray-600 mb-1">
                          Precio Unitario
                        </label>

                        <input
                          type="text"
                          inputMode="numeric"
                          className={`w-full h-10 rounded-md border border-gray-300 px-3 text-sm font-semibold ${lockInput}`}
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
                            esEditable && actualizarPrecioUnitario(index, e.target.value)
                          }
                          {...readOnlyProps}
                        />
                      </div>

                      {/* Total */}
                      <div className="md:col-span-4">
                        <label className="block text-xs text-gray-600 mb-1">
                          Total
                        </label>
                        <div className="h-10 flex items-center font-semibold whitespace-nowrap">
                          ${Number(it.total).toLocaleString("es-CL")}
                        </div>
                      </div>

                      {/* Acciones */}
                      <div className="md:col-span-2 flex justify-end pr-1">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => toggleObservacion(index)}
                            disabled={!esEditable}
                            className={`bg-gray-300 rounded-md w-10 h-10 text-base shadow flex items-center justify-center ${
                              esEditable
                                ? "cursor-pointer hover:bg-gray-400"
                                : "opacity-50 cursor-not-allowed"
                            }`}
                            title="Observación"
                            type="button"
                          >
                            {it.mostrarObs ? "–" : "+"}
                          </button>

                          {items.length > 1 && (
                            <button
                              onClick={() => eliminarItem(index)}
                              disabled={!esEditable}
                              className={`bg-red-600 text-white px-4 py-2 rounded-md text-sm shadow ${
                                esEditable
                                  ? "cursor-pointer hover:bg-red-700"
                                  : "opacity-50 cursor-not-allowed"
                              }`}
                              type="button"
                            >
                              Eliminar
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
                        className={`rounded-md w-9 h-9 shadow flex items-center justify-center ${
                          esEditable
                            ? "cursor-grab active:cursor-grabbing bg-gray-200 hover:bg-gray-300"
                            : "cursor-not-allowed bg-gray-100 opacity-50"
                        }`}
                        style={{ touchAction: "none" }}
                        title="Arrastrar para reordenar"
                        type="button"
                      >
                        ≡
                      </button>

                      <button
                        type="button"
                        onClick={() => insertarItemDespues(index)}
                        disabled={!esEditable}
                        className={`bg-green-600 text-white rounded-md w-9 h-9 shadow flex items-center justify-center ${
                          esEditable
                            ? "cursor-pointer hover:bg-green-700"
                            : "opacity-50 cursor-not-allowed"
                        }`}
                        title="Agregar ítem debajo"
                      >
                        +
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
                            className={`w-full h-10 rounded-md border border-gray-300 px-3 text-sm ${lockInput}`}
                            value={it.observacion}
                            onChange={(e) =>
                              esEditable &&
                              actualizarItem(index, "observacion", e.target.value)
                            }
                            {...readOnlyProps}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </SortableItem>
            ))}
          </div>
        </SortableContext>
      </DndContext>

      {/* RESUMEN */}
      <div className="bg-white border border-gray-300 rounded-xl shadow-sm p-6 mt-10">
        <h2 className="text-xl font-semibold text-gray-900 mb-4">Resumen</h2>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Cantidad de Productos
            </label>
            <div className="w-full h-10 rounded-md border border-gray-300 px-3 flex items-center font-semibold bg-gray-50">
              {cantidadProductos}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Flete Estimado
            </label>
            <input
              type="number"
              className={`w-full h-10 rounded-md border border-gray-300 px-3 ${lockInput}`}
              value={fleteEstimado}
              onChange={(e) => esEditable && setFleteEstimado(e.target.value)}
              {...lockProps}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Flete por Unidad
            </label>
            <div className="w-full h-10 rounded-md border border-gray-300 px-3 flex items-center bg-gray-50">
              ${fletePorUnidad.toLocaleString("es-CL")}
            </div>
          </div>

          <div></div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Neto
            </label>
            <div className="w-full h-10 rounded-md border border-gray-300 px-3 flex items-center font-semibold bg-gray-50">
              ${totalNeto.toLocaleString("es-CL")}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              IVA 19%
            </label>
            <div className="w-full h-10 rounded-md border border-gray-300 px-3 flex items-center bg-gray-50">
              ${totalIVA.toLocaleString("es-CL")}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Total
            </label>
            <div className="w-full h-10 rounded-md border border-gray-300 px-3 flex items-center font-semibold bg-gray-50">
              ${totalConIVA.toLocaleString("es-CL")}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              % Presupuesto
            </label>
            <div
              className={`w-full h-10 rounded-md border px-3 flex items-center font-semibold ${colorPresupuesto}`}
            >
              {porcentajePresupuesto > 0
                ? porcentajePresupuesto.toFixed(2) + "%"
                : "0%"}
            </div>
          </div>
        </div>
      </div>

      {/* OBSERVACIONES GENERALES */}
      <div className="bg-white border border-gray-300 rounded-xl shadow-sm p-6 mt-6">
        <h2 className="text-xl font-semibold text-gray-900 mb-4">Observaciones</h2>

        <label className="block text-sm font-medium text-gray-700 mb-1">
          Observaciones generales
        </label>

        <textarea
          className={`w-full min-h-[110px] rounded-md border border-gray-300 px-3 py-2 text-sm ${lockInput}`}
          value={observaciones}
          onChange={(e) => esEditable && setObservaciones(e.target.value)}
          placeholder="Escribe observaciones generales para la licitación…"
          {...readOnlyProps}
        />
      </div>

      {/* BOTONES */}
      <div className="flex gap-4 mt-6">
        <button
          onClick={agregarItem}
          className={`bg-green-600 text-white px-4 py-2 rounded-md shadow ${
            esEditable && !guardando && !generandoPDF
              ? "cursor-pointer hover:bg-green-700"
              : "opacity-60 cursor-not-allowed"
          }`}
          type="button"
          disabled={!esEditable || guardando || generandoPDF}
        >
          + Agregar Ítem
        </button>

        {/* Guardar permitido siempre (para guardar cambio de estado) */}
        <button
          onClick={guardarCambios}
          className={`bg-blue-600 text-white px-6 py-2 rounded-md shadow ${
            guardando || generandoPDF ? "opacity-60 cursor-not-allowed" : "cursor-pointer hover:bg-blue-700"
          }`}
          type="button"
          disabled={guardando || generandoPDF}
        >
          Guardar Cambios
        </button>

        <button
          onClick={exportarPDF}
          className={`bg-[#4b89ac] text-white px-6 py-2 rounded-md shadow ${
            guardando || generandoPDF ? "opacity-60 cursor-not-allowed" : "cursor-pointer hover:bg-[#3f7897]"
          }`}
          type="button"
          disabled={guardando || generandoPDF}
        >
          Generar PDF
        </button>
      </div>
    </div>
  );
}
