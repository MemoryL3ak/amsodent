// CrearLicitacion.jsx
import React, { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { useLocation } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { api } from "../lib/api";
import { reportarError } from "../lib/monitor";
import Toast from "../components/Toast";
import Select, { components } from "react-select";
import { generarPDFcotizacion } from "../utils/generarPDFcotizacion";
import { calcularLista3 } from "../lib/listas";
import ProductoPickerModal from "../components/ProductoPickerModal";
import CalculadoraFlete from "../components/CalculadoraFlete";

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
import { GripVertical, Plus, Minus, Trash2, ChevronUp, ChevronDown, MessageSquare } from "lucide-react";

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
   MENULIST LIMITADA
   react-select NO virtualiza: al abrir el menú renderiza TODAS las
   opciones en el DOM. Con catálogos grandes (miles de productos) eso
   agota la memoria del navegador (pantalla "Out of Memory"). Esta
   MenuList renderiza solo las primeras N coincidencias; el resto se
   alcanza escribiendo para filtrar.
============================================================ */
const CAP_OPCIONES_SELECT = 60;

const MenuListLimitada = (props) => {
  const { children } = props;
  if (Array.isArray(children) && children.length > CAP_OPCIONES_SELECT) {
    return (
      <components.MenuList {...props}>
        {children.slice(0, CAP_OPCIONES_SELECT)}
        <div
          style={{
            padding: "8px 12px",
            fontSize: 12,
            color: "#64748b",
            textAlign: "center",
            borderTop: "1px solid #eef1f4",
          }}
        >
          {children.length.toLocaleString("es-CL")} resultados — escribe para
          refinar la búsqueda
        </div>
      </components.MenuList>
    );
  }
  return <components.MenuList {...props}>{children}</components.MenuList>;
};

/* ============================================================
   FORMATEO DE VALORES
============================================================ */
function redondear(valor) {
  const entero = Math.floor(valor);
  const decimal = valor - entero;
  return decimal >= 0.5 ? entero + 1 : entero;
}

function formatear(valor) {
  return Number(valor).toLocaleString("es-CL");
}

/* ============================================================
   ✅ MONTO: separador miles en input (es-CL)
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

function formatPorcentajePresupuesto(pct) {
  const n = Number(pct || 0);
  if (!Number.isFinite(n) || n <= 0) return "0%";
  if (n < 100) {
    const truncado = Math.floor(n * 100) / 100;
    return `${truncado.toFixed(2)}%`;
  }
  return `${n.toFixed(2)}%`;
}

function normalizarVolumenCm3(valor) {
  const n = Number(valor || 0);
  if (!Number.isFinite(n) || n <= 0) return 0;
  /* metro_cubico se guarda SIEMPRE en cm³. Existió aquí una heurística
     «n < 1 → dato antiguo en m³ → ×1.000.000» que quedó obsoleta y dañina:
     verificado contra la base el 2026-08-27, no queda NINGÚN producto en m³
     y sí hay 110 productos chicos (fresas, agujas…) con volumen real menor a
     1 cm³, a los que ese ×1.000.000 les inventaba ~1 m³ por unidad y disparaba
     el peso volumétrico del flete (20.000 agujas → 19.060 m³). */
  return n;
}

/**
 * ✅ FIX: si el producto NO tiene SKU, igual debe devolver precio de lista.
 * - SKU solo se usa para campañas (si existe).
 */
function getPrecioBaseParaSKU(prod, listado, campaignPrices) {
  if (!prod) return 0;

  const sku = String(prod?.sku ?? "").trim();

  // campaña solo si existe SKU
  const camp = sku ? campaignPrices?.[sku] : null;
  if (camp && camp.precio != null) return Number(camp.precio || 0);

  // Lista 3 se usa para tipo de compra "Licitación 9 a 24 meses".
  // Si el producto tiene Lista 3 explícita usamos ese valor; si no,
  // fallback al factor configurado (ver src/lib/listas.js).
  if (String(listado) === "3") {
    const explicit = Number(prod.lista3 ?? 0);
    if (explicit > 0) return explicit;
    return calcularLista3(prod.lista2);
  }

  // si no hay sku o no hay campaña: usa lista
  return Number(prod[`lista${listado}`] ?? 0);
}

/* ============================================================
   BUSCADOR MEJORADO PARA REACT-SELECT
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
   ESTILOS DEL SELECT
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
  "Ñuble": [
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
    "Puqueldón", // ✅ (arreglé typo)
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

// ✅ Opciones React-Select para Región/Comuna
const opcionesRegion = Object.keys(REGIONES_CHILE).map((reg) => ({
  value: reg,
  label: reg,
}));

const opcionesComuna = (regionSeleccionada) =>
  (REGIONES_CHILE[regionSeleccionada] || []).map((c) => ({
    value: c,
    label: c,
  }));

const STORAGE_KEY = "crear_licitacion_draft";

function generarId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function crearItemVacio() {
  return {
    id: generarId(),
    sku: "",
    producto: "",
    categoria: "",
    formato: "",
    cantidad: "", // vacío por defecto (no "0")
    precio: 0, // precio base (sin flete)
    costo: 0,
    total: 0,
    observacion: "",
    mostrarObs: false,

    // ✅ NUEVO (Precio Unitario editable)
    precioManual: false,
    precioUnitarioStr: "", // string formateado para input

    // ✅ NUEVO (Costo editable)
    costoManual: false,
    costoStr: "",
  };
}

function SortableItem({ itemId, children, onInsertAfter, canInsertAfter }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: itemId });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition: isDragging ? undefined : transition,
    willChange: "transform",
  };

  return (
    <div ref={setNodeRef} style={style}>
      {children({
        dragHandleProps: { ...attributes, ...listeners, ref: setActivatorNodeRef },
        onInsertAfter,
        canInsertAfter,
        isDragging,
      })}
    </div>
  );
}

/* ============================================================
   COMPONENTE PRINCIPAL
============================================================ */
export default function CrearLicitacion() {
  const location = useLocation();
  const [tooltip, setTooltip] = useState({
    visible: false,
    texto: "",
    x: 0,
    y: 0,
  });

  /* PERFIL / ROL */
  const [perfilLoading, setPerfilLoading] = useState(true);
  const [rol, setRol] = useState(null);

  // ✅ vendedor (perfil)
  const [perfilNombre, setPerfilNombre] = useState("");
  const [perfilEmail, setPerfilEmail] = useState("");
  const [perfilCelular, setPerfilCelular] = useState("");

  // ✅ estados para mostrar generación PDF / evitar doble click
  const [guardando, setGuardando] = useState(false);
  // Guard SINCRÓNICO contra doble clic al guardar: `guardando` es estado de
  // React y no cambia hasta el próximo render, así que dos clics seguidos
  // (antes de que el botón se deshabilite) ejecutaban el guardado dos veces
  // y la cotización quedaba duplicada.
  const guardandoRef = useRef(false);
  const [generandoPDF, setGenerandoPDF] = useState(false);

  useEffect(() => {
    async function cargarPerfil() {
      setPerfilLoading(true);

      try {
        const perfil = await api.get("/auth/profile");
        setPerfilEmail(perfil?.email || "");
        setRol(perfil?.rol || null);
        setPerfilNombre(perfil?.nombre || "");
        setPerfilCelular(perfil?.celular || "");
      } catch {
        setRol(null);
        setPerfilNombre("");
        setPerfilEmail("");
        setPerfilCelular("");
      }
      setPerfilLoading(false);
    }

    cargarPerfil();
  }, []);

  const puedeCrearLicitacion = useMemo(() => {
    return ["admin", "jefe_ventas", "jefe_ventas_especial", "ventas", "ventas_especial", "contabilidad"].includes(rol);
  }, [rol]);

  const esAdmin = useMemo(() => {
    const r = (rol ?? "").toString().trim().toLowerCase();
    return r === "admin" || r === "administrador";
  }, [rol]);

  // La opción "30 días" para un Cliente Particular solo la puede habilitar el
  // admin. El resto de los roles queda fijo en "Contado".
  const puedeEditarCondVenta = useMemo(() => {
    const r = (rol ?? "").toString().trim().toLowerCase();
    return r === "admin" || r === "administrador";
  }, [rol]);

  const [mostrarEntidad, setMostrarEntidad] = useState(true);

  const [idLicitacionInput, setIdLicitacionInput] = useState("");
  const [nombre, setNombre] = useState("");
  const [fechaHoraCierre, setFechaHoraCierre] = useState("");
  const [fechaPublicacionResultados, setFechaPublicacionResultados] = useState("");
  const [monto, setMonto] = useState(""); // string formateado "1.234.567"
  const [listado, setListado] = useState("2"); // derivado de tipoCompra: "Compra ágil" → lista 2

  const [rutEntidad, setRutEntidad] = useState("");
  const [nombreEntidad, setNombreEntidad] = useState("");
  // Lista de clientes para autocompletar la entidad por RUT o por nombre.
  const [clientesLista, setClientesLista] = useState([]);
  const [giro, setGiro] = useState("");
  const [tipoCliente, setTipoCliente] = useState(""); // "Entidad Pública" | "Cliente Particular" | ""
  // Preview del próximo correlativo para cliente particular (max(id)+1 al momento de la consulta).
  const [idPreview, setIdPreview] = useState(null);
  const [idPreviewLoading, setIdPreviewLoading] = useState(false);
  const [departamento, setDepartamento] = useState("");
  const [municipalidad, setMunicipalidad] = useState("");
  const [direccion, setDireccion] = useState("");
  // Sucursales del cliente (por RUT) + la seleccionada para esta cotización.
  const [sucursales, setSucursales] = useState([]);
  const [sucursal, setSucursal] = useState(""); // nombre de la sucursal elegida
  // Datos generales del cliente: respaldo cuando una sucursal no trae ese dato
  // (ej. Casa Matriz sin dirección propia usa la dirección general del cliente).
  const [clienteBase, setClienteBase] = useState({});
  const [contacto, setContacto] = useState("");
  const [email, setEmail] = useState("");
  const [telefono, setTelefono] = useState("");
  const [condVenta, setCondVenta] = useState("30 días");

  const esParticular = tipoCliente.toLowerCase() === "cliente particular";

  // Sugerencias de cliente para el autocompletado de la entidad, acotadas por el
  // tipo de cotización elegido (Cliente Particular / Entidad Pública). Sin tipo
  // elegido, se ofrecen todos.
  const clientesSugeridos = useMemo(
    () => (tipoCliente ? clientesLista.filter((c) => (c.tipo_cliente || "") === tipoCliente) : clientesLista),
    [clientesLista, tipoCliente],
  );

  // Cliente Particular ⇒ "Contado" obligatorio para roles no autorizados.
  // Admin / jefe_ventas_especial quedan libres de editarlo.
  useEffect(() => {
    if (esParticular && !puedeEditarCondVenta && condVenta !== "Contado") {
      setCondVenta("Contado");
    }
  }, [esParticular, puedeEditarCondVenta, condVenta]);

  const [fleteEstimado, setFleteEstimado] = useState(0);
  const [tipoCompra, setTipoCompra] = useState("Compra ágil");
  const [region, setRegion] = useState("");
  const [comuna, setComuna] = useState("");

  const [productos, setProductos] = useState([]);
  const [toast, setToast] = useState(null);
  const [campaignPrices, setCampaignPrices] = useState({});
  const [items, setItems] = useState([crearItemVacio()]);
  // Índice del ítem para el que está abierto el buscador de productos (popup).
  const [pickerIndex, setPickerIndex] = useState(null);
  const [hydrated, setHydrated] = useState(false);

  // ✅ Observaciones generales
  const [observaciones, setObservaciones] = useState("");

  // ── Cotizaciones madre/hija por productos equivalentes ──────────────────
  // madreId: si está seteado, este formulario está creando una cotización HIJA
  // (alternativa con equivalencias) de esa cotización madre. Las hijas no
  // vuelven a analizar equivalencias al guardar.
  const [madreId, setMadreId] = useState(null);
  // Sugerencia post-guardado: {madreId, codigoMadre, form, items, conEquiv}.
  const [sugerenciaEquiv, setSugerenciaEquiv] = useState(null);

  /* ============================================================
     ✅ Persistir items inmediatamente (para no perder orden si se cae)
============================================================ */
  function persistirDraftItems(nextItems) {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const draft = raw ? JSON.parse(raw) : {};
      draft.items = nextItems;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
    } catch {}
  }

  // Rellena el formulario con los datos de un cliente (sea encontrado por RUT
  // o por nombre).
  function aplicarCliente(data) {
    if (!data) return;
    if (data.rut) setRutEntidad(data.rut);
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
    if (tc) {
      setTipoCliente(tc);
      // Si el cliente es Particular, el único tipo de compra válido es "Cliente particular".
      if (tc.toLowerCase() === "cliente particular") {
        setTipoCompra("Cliente particular");
        setListado("1");
      } else if (tipoCompra === "Cliente particular") {
        // Si el cliente es Entidad Pública y veníamos con "Cliente particular", resetear.
        setTipoCompra("Compra ágil");
        setListado("2");
      }
    }
  }

  // Carga la lista de clientes (RUT + nombre) para las sugerencias de la
  // entidad. Vía backend (service_role): la consulta directa a Supabase
  // dependía de las políticas RLS del rol del usuario.
  useEffect(() => {
    (async () => {
      try {
        const data = await api.get("/clientes");
        if (Array.isArray(data)) {
          setClientesLista(
            data
              .map((c) => ({ rut: c.rut, nombre: c.nombre, tipo_cliente: c.tipo_cliente }))
              .sort((a, b) => String(a.nombre || "").localeCompare(String(b.nombre || ""), "es"))
          );
        }
      } catch (e) {
        console.error("Error cargando lista de clientes:", e);
      }
    })();
  }, []);

  // Puebla los datos de despacho con los de una sucursal. Determinista: setea
  // TODOS los campos, usando el dato de la sucursal o, si no lo tiene, el dato
  // general del cliente. Así al alternar entre sucursales los campos siempre
  // reflejan la sucursal elegida (Casa Matriz sin dirección → dirección del cliente).
  function aplicarDatosSucursal(s) {
    setDireccion((s?.direccion) || clienteBase.direccion || "");
    setComuna((s?.comuna) || clienteBase.comuna || "");
    setContacto((s?.contacto) || clienteBase.contacto || "");
    setTelefono((s?.telefono) || clienteBase.telefono || "");
    setEmail((s?.email) || clienteBase.email || "");
  }

  // Carga las sucursales del cliente (por RUT). Al elegir/cambiar de cliente, por
  // defecto queda seleccionada "Casa Matriz" (o la primera) y se traen sus datos.
  // Si no hay RUT, se limpia todo.
  useEffect(() => {
    const rut = (rutEntidad || "").trim();
    if (!rut) { setSucursales([]); setSucursal(""); return; }
    let activo = true;
    (async () => {
      try {
        const data = await api.get(`/stock-clientes/sucursales-por-rut?rut=${encodeURIComponent(rut)}`);
        const lista = Array.isArray(data) ? data.filter((s) => s.activo !== false) : [];
        if (!activo) return;
        setSucursales(lista);
        // Por defecto Casa Matriz (o la primera). Si la sucursal ya elegida sigue
        // siendo válida para este cliente, se respeta.
        const vigente = sucursal && lista.some((s) => s.nombre === sucursal);
        if (!vigente && lista.length) {
          const cm = lista.find((s) => (s.nombre || "").trim().toLowerCase() === "casa matriz") || lista[0];
          setSucursal(cm.nombre);
          aplicarDatosSucursal(cm);
        }
      } catch {
        if (activo) { setSucursales([]); setSucursal(""); }
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

  // Búsquedas vía backend: la consulta directa a Supabase fallaba en silencio
  // con RUT duplicados (maybeSingle) o según las políticas RLS del rol, y por
  // eso "a veces" el cliente elegido no traía sus demás datos.
  async function buscarClientePorRut(rut) {
    if (!rut) return;
    try {
      const data = await api.get(`/clientes?rut=${encodeURIComponent(rut)}`);
      if (data) aplicarCliente(data);
    } catch (e) {
      console.error("Error buscando cliente por RUT:", e);
    }
  }

  async function buscarClientePorNombre(nombre) {
    const n = (nombre || "").trim();
    if (!n) return;
    try {
      const data = await api.get(`/clientes?nombre=${encodeURIComponent(n)}`);
      if (data) aplicarCliente(data);
    } catch (e) {
      console.error("Error buscando cliente por nombre:", e);
    }
  }

  // Si esta cotización se crea a partir de una solicitud del portal del cliente,
  // guardamos el id para vincularlas al guardar.
  const [solicitudStockId, setSolicitudStockId] = useState(null);
  // Id de la fila del listado "Licitaciones disponibles" (si la cotización se
  // originó desde ahí): al guardar, esa fila se marca como "cargada".
  const [disponibleId, setDisponibleId] = useState(null);

  useEffect(() => {
    const draftDuplicado = location.state?.duplicarLicitacion;
    if (!draftDuplicado) return;

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(draftDuplicado));
    } catch (e) {
      console.error("Error preparando duplicado de licitación", e);
    }
  }, [location.state]);

  // Prellenado desde el listado de "Licitaciones disponibles": arranca una
  // cotización nueva con el ID de licitación y el nombre ya cargados.
  useEffect(() => {
    const prefill = location.state?.prefillLicitacion;
    if (!prefill) return;
    try {
      // Columnas adicionales del xlsx (organismo, región, monto, cierre, etc.)
      // para prellenar la mayor cantidad de campos de la cotización.
      const d = prefill.datos || {};
      const soloDigitos = (s) => String(s || "").replace(/[^\d]/g, "");
      const montoNum = soloDigitos(d.monto);
      /* Cierre → "YYYY-MM-DDTHH:mm" para el campo fecha/hora. El dato llega en
         formatos distintos según el origen: "DD-MM-YYYY[ HH:mm]" (xlsx del
         portal), "DD-MM-YY HH:mm" (año de 2 dígitos, formato actual del
         portal) e ISO "YYYY-MM-DD[THH:mm…]" (buscador y exploración de
         Mercado Público). Antes solo se entendía el primero: los otros dos se
         descartaban en silencio y el campo quedaba vacío. La hora también se
         conserva — en Compra Ágil el cierre a las 15:00 es real, no medianoche. */
      let fechaCierre = "";
      const sCierre = String(d.cierre || "").trim();
      let mc = sCierre.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{1,2}):(\d{2}))?/); // ISO
      if (mc) {
        fechaCierre = `${mc[1]}-${mc[2]}-${mc[3]}T${String(mc[4] ?? "0").padStart(2, "0")}:${mc[5] ?? "00"}`;
      } else {
        mc = sCierre.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4}|\d{2})(?:[ T](\d{1,2}):(\d{2}))?/); // DD-MM-YY(YY)
        if (mc) {
          const anio = mc[3].length === 2 ? `20${mc[3]}` : mc[3];
          fechaCierre = `${anio}-${mc[2].padStart(2, "0")}-${mc[1].padStart(2, "0")}T${String(mc[4] ?? "0").padStart(2, "0")}:${mc[5] ?? "00"}`;
        }
      }
      // Región: quita el prefijo "Región de/del/de la ".
      const region = String(d.region || "").replace(/^regi[oó]n\s+(de\s+la\s+|del\s+|de\s+)?/i, "").trim();
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        idLicitacionInput: prefill.idLicitacionInput || "",
        nombre: prefill.nombre || "",
        disponible_id: prefill.disponibleId ?? null,
        // Las postulaciones disponibles son de mercado público → por defecto
        // arranca como Entidad Pública (tipo de compra público).
        tipoCliente: "Entidad Pública",
        tipoCompra: "Compra ágil",
        nombreEntidad: d.organismo || "",
        region,
        monto: montoNum ? Number(montoNum) : "",
        fechaHoraCierre: fechaCierre,
        // Observaciones parte VACÍO a propósito: antes se prellenaba con la
        // descripción del proceso + link de la ficha, y ese texto terminaba
        // impreso en la cotización si nadie lo borraba (pedido 2026-08-13).
      }));
    } catch (e) {
      console.error("Error preparando prellenado de licitación", e);
    }
  }, [location.state]);

  /* CARGAR BORRADOR */
  useEffect(() => {
    const guardado = localStorage.getItem(STORAGE_KEY);
    if (!guardado) {
      setHydrated(true);
      return;
    }

    try {
      const data = JSON.parse(guardado);

      if (data.solicitud_stock_id != null) setSolicitudStockId(data.solicitud_stock_id);
      if (data.disponible_id != null) setDisponibleId(data.disponible_id);
      if (data.madre_id != null) setMadreId(data.madre_id);
      setIdLicitacionInput(data.idLicitacionInput || "");
      setNombre(data.nombre || "");
      setFechaHoraCierre(data.fechaHoraCierre || "");

      const montoGuardado = data.monto ?? "";
      if (typeof montoGuardado === "number") {
        setMonto(Number(montoGuardado).toLocaleString("es-CL"));
      } else {
        setMonto(formatearCLDesdeString(montoGuardado));
      }

      setListado(data.listado || "2");

      setRutEntidad(data.rutEntidad || "");
      setNombreEntidad(data.nombreEntidad || "");
      setGiro(data.giro || "");
      setTipoCliente(data.tipoCliente || "");
      setDepartamento(data.departamento || "");
      setMunicipalidad(data.municipalidad || "");
      setDireccion(data.direccion || "");
      setSucursal(data.sucursal || "");
      setContacto(data.contacto || "");
      setEmail(data.email || "");
      setTelefono(data.telefono || "");
      setCondVenta(data.condVenta || "");

      setFleteEstimado(data.fleteEstimado || 0);
      setTipoCompra(data.tipoCompra || "Compra ágil");
      setRegion(data.region || "");
      setComuna(data.comuna || "");

      setObservaciones(data.observaciones || "");

      const cargados = Array.isArray(data.items) ? data.items : [];
      if (cargados.length > 0) {
        setItems(
          cargados.map((it) => ({
            ...crearItemVacio(),
            ...it,
            id: it?.id || generarId(),
          }))
        );
      }
    } catch (e) {
      console.error("Error cargando borrador de licitación", e);
    } finally {
      setHydrated(true);
    }
  }, []);

  /* GUARDAR BORRADOR (debounced — evita JSON.stringify enorme en cada tecla) */
  useEffect(() => {
    if (!hydrated) return;

    const data = {
      idLicitacionInput,
      nombre,
      fechaHoraCierre,
      monto,
      listado,
      rutEntidad,
      nombreEntidad,
      giro,
      tipoCliente,
      departamento,
      municipalidad,
      direccion,
      sucursal,
      contacto,
      email,
      telefono,
      condVenta,
      fleteEstimado,
      tipoCompra,
      region,
      comuna,
      items,
      observaciones,
      madre_id: madreId,
      // Vínculos con el origen de la cotización. Van SÍ o SÍ en el borrador:
      // este autoguardado reescribe la clave completa, así que lo que no esté
      // acá se pierde al primer cambio y ya no se recupera si la página se
      // recarga o se vuelve a entrar. Sin `disponible_id` la postulación nunca
      // se marca como cargada al guardar y queda eternamente "Tomada".
      disponible_id: disponibleId,
      solicitud_stock_id: solicitudStockId,
    };

    const t = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      } catch {}
    }, 400);

    return () => clearTimeout(t);
  }, [
    hydrated,
    idLicitacionInput,
    nombre,
    fechaHoraCierre,
    monto,
    listado,
    rutEntidad,
    nombreEntidad,
    giro,
    tipoCliente,
    departamento,
    municipalidad,
    direccion,
    sucursal,
    contacto,
    email,
    telefono,
    condVenta,
    fleteEstimado,
    tipoCompra,
    region,
    comuna,
    items,
    observaciones,
    madreId,
    disponibleId,
    solicitudStockId,
  ]);

  /* CARGA DE PRODUCTOS */
  useEffect(() => {
    async function cargar() {
      // Solo las columnas que usa el picker / cálculo de precios: evita traer
      // las fichas técnicas (textos largos) que disparan el tamaño del payload.
      const { data } = await supabase
        .from("productos")
        .select("id, sku, nombre, marca, categoria, formato, costo, lista1, lista2, lista3, equivalente_1, equivalente_2, equivalente_3, peso, metro_cubico")
        .in("estado", ["Activo", "Transitorio"])
        .order("id")
        .limit(20000);

      setProductos(data || []);
    }
    cargar();
  }, []);

  useEffect(() => {
    let alive = true;

    async function cargarCampanasVigentes() {
      try {
        const hoy = new Date().toISOString().slice(0, 10);

        const { data: camps, error: eCamps } = await supabase
          .from("product_campaigns")
          .select("id, created_at, start_date, end_date")
          .lte("start_date", hoy)
          .gte("end_date", hoy)
          .order("created_at", { ascending: false });

        if (eCamps) throw eCamps;

        const ids = (camps || []).map((c) => c.id);
        if (ids.length === 0) {
          if (alive) setCampaignPrices({});
          return;
        }

        const { data: its, error: eIts } = await supabase
          .from("product_campaign_items")
          .select("campaign_id, sku, producto, precio_campania")
          .in("campaign_id", ids);

        if (eIts) throw eIts;

        const map = {};
        for (const campId of ids) {
          for (const it of its || []) {
            if (it.campaign_id !== campId) continue;

            const sku = String(it.sku || "").trim();
            if (!sku) continue;

            if (map[sku] == null) {
              map[sku] = {
                precio: Number(it.precio_campania || 0),
                producto: it.producto ? String(it.producto) : null,
              };
            }
          }
        }

        if (alive) setCampaignPrices(map);
      } catch (err) {
        console.error("Error cargando campañas vigentes:", err);
        if (alive) setCampaignPrices({});
      }
    }

    cargarCampanasVigentes();
    return () => {
      alive = false;
    };
  }, []);

  /* ============================================================
     RESUMEN (para flete)
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
     Precio Unitario editable
  ============================================================ */
  function actualizarPrecioUnitario(index, valorStr) {
    const copia = [...items];
    const item = { ...copia[index] };

    item.precioUnitarioStr = formatearCLDesdeString(valorStr);
    const baseSinFlete = parseMontoCL(item.precioUnitarioStr);

    item.precio = Math.max(0, baseSinFlete);
    item.precioManual = true;

    const cantidad = Math.max(1, Number(item.cantidad || 1));
    const precioConFlete =
      Number(item.precio || 0) + Number(fletePorUnidad || 0);
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

  /* ============================================================
     Costo editable (solo admin)
  ============================================================ */
  function actualizarCostoItem(index, valorStr) {
    const copia = [...items];
    const item = { ...copia[index] };

    item.costoStr = formatearCLDesdeString(valorStr);
    const costo = parseMontoCL(item.costoStr);

    item.costo = Math.max(0, costo);
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

  /* ============================================================
     ACTUALIZAR ÍTEM
  ============================================================ */
  function actualizarItem(index, campo, valor) {
    const copia = [...items];
    let item = { ...copia[index] };

    item[campo] = valor;

    let prod = null;
    if (campo === "sku") {
      prod = productos.find(
        (p) => String(p.sku || "").trim() === String(valor || "").trim()
      );
    }
    if (campo === "producto") {
      prod = productos.find((p) => p.nombre === valor);
    }

    if (prod) {
      item.sku = prod.sku ? String(prod.sku).trim() : "";
      item.producto = prod.nombre || "";
      item.categoria = prod.categoria || "";
      item.formato = prod.formato || "";

      item.precio = getPrecioBaseParaSKU(prod, listado, campaignPrices);
      item.costo = Number(prod.costo ?? 0);

      item.precioManual = false;
      item.precioUnitarioStr = "";

      item.costoManual = false;
      item.costoStr = "";
    }

    const cantidad = Math.max(1, Number(item.cantidad || 1));
    const precioBase = Number(item.precio || 0);
    const precioConFlete = precioBase + fletePorUnidad;

    item.total = redondear(cantidad * precioConFlete);

    copia[index] = item;
    setItems(copia);
  }

  // Selección de un producto desde el popup buscador. Usa el objeto producto
  // directamente — no depende de productos.find() porque cuando el producto
  // recién se creó, productos puede estar stale (race con setProductos).
  function seleccionarProductoDesdePicker(prod) {
    const idx = pickerIndex;
    setPickerIndex(null);
    if (idx == null || !prod) return;

    // Mantener el catálogo local actualizado para próximas selecciones.
    setProductos((prev) => {
      const existeId = prev.some((p) => p.id != null && p.id === prod.id);
      const existeSku = prod.sku
        ? prev.some((p) => String(p.sku || "").trim() === String(prod.sku).trim())
        : false;
      if (existeId || existeSku) return prev;
      return [...prev, prod];
    });

    // Rellenar el ítem con los datos del prod recibido — NO usar
    // actualizarItem(sku) ni (producto) porque hacen lookup que puede fallar
    // si productos aún no se actualizó.
    setItems((prev) => {
      const copia = [...prev];
      const item = { ...(copia[idx] || crearItemVacio()) };
      item.sku = prod.sku ? String(prod.sku).trim() : "";
      item.producto = prod.nombre || "";
      item.categoria = prod.categoria || "";
      item.formato = prod.formato || "";
      item.precio = getPrecioBaseParaSKU(prod, listado, campaignPrices);
      item.costo = Number(prod.costo ?? 0);
      item.precioManual = false;
      item.precioUnitarioStr = "";
      item.costoManual = false;
      item.costoStr = "";
      const cantidad = Math.max(1, Number(item.cantidad || 1));
      item.total = redondear(cantidad * (Number(item.precio || 0) + Number(fletePorUnidad || 0)));
      copia[idx] = item;
      return copia;
    });
  }

  // Callback cuando se crea un producto desde el modal del picker.
  // Se refresca la lista local agregando el nuevo producto y se muestra
  // un toast informativo (especialmente útil cuando queda Pendiente Aprobación).
  function handleProductoCreado(productoCreado, estadoFinal) {
    if (!productoCreado) return;
    setProductos((prev) => {
      const existe = prev.some((p) => p.id != null && p.id === productoCreado.id);
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

  function getCostoParaItem(item) {
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

  /* OBS / CRUD */
  function toggleObservacion(index) {
    const copia = [...items];
    copia[index].mostrarObs = !copia[index].mostrarObs;
    setItems(copia);
  }

  function agregarItem() {
    setItems((prev) => [...prev, crearItemVacio()]);
  }

  function insertarItemDespues(index) {
    setItems((prev) => {
      const copia = [...prev];
      copia.splice(index + 1, 0, crearItemVacio());
      return copia;
    });
  }

  function eliminarItem(index) {
    setItems((prev) => {
      if (prev.length === 1) return prev;
      const copia = [...prev];
      copia.splice(index, 1);
      return copia;
    });
  }

  /* ============================================================
     ✅ recalcular totales con flete
  ============================================================ */
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
      const precioConFlete = precioBase + fletePorUnidad;

      return {
        ...it,
        total: redondear(cantidad * precioConFlete),
      };
    });

    setItems(copia);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fletePorUnidad, hydrated]);

  /* ============================================================
     ✅ campañas: NO pisa manual
  ============================================================ */
  useEffect(() => {
    if (!hydrated) return;
    if (!productos?.length) return;

    const tieneCamp = campaignPrices && Object.keys(campaignPrices).length > 0;
    if (!tieneCamp) return;

    const copia = items.map((it) => {
      if (it.precioManual) return it;

      const sku = String(it.sku || "").trim();
      const prod =
        (sku
          ? productos.find((p) => String(p.sku || "").trim() === sku)
          : null) ||
        (it.producto ? productos.find((p) => p.nombre === it.producto) : null);

      if (!prod) return it;

      const precioBase = getPrecioBaseParaSKU(prod, listado, campaignPrices);
      const cantidad = Math.max(1, Number(it.cantidad || 1));
      const precioConFlete = precioBase + fletePorUnidad;

      return {
        ...it,
        precio: precioBase,
        precioUnitarioStr: "",
        total: redondear(cantidad * precioConFlete),
      };
    });

    setItems(copia);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignPrices, productos]);

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

  // Peso total del envío (kg): peso del producto × cantidad, para el cálculo de flete.
  const pesoTotalGeneral = useMemo(
    () =>
      items.reduce((acc, it) => {
        const cantidad = Math.max(1, Number(it.cantidad || 1));
        return acc + getPesoParaItem(it) * cantidad;
      }, 0),
    [items, productos]
  );

  const montoNum = parseMontoCL(monto);

  let porcentajePresupuesto = 0;
  if (montoNum > 0) porcentajePresupuesto = (totalConIVA / montoNum) * 100;

  let colorPresupuesto = "";
  if (porcentajePresupuesto <= 0)        colorPresupuesto = "";
  else if (porcentajePresupuesto <= 80)  colorPresupuesto = "presupuesto-ok";
  else if (porcentajePresupuesto <= 100) colorPresupuesto = "presupuesto-warn";
  else                                   colorPresupuesto = "presupuesto-over";

  async function crearClienteSiNoExiste() {
    if (!rutEntidad) return;

    // Verificación vía backend (service_role): la consulta directa a Supabase
    // fallaba por RLS según el rol del usuario y abortaba el guardado.
    let existe = null;
    try {
      existe = await api.get(`/clientes?rut=${encodeURIComponent(rutEntidad)}`);
    } catch (errExiste) {
      console.error("Error verificando cliente:", errExiste);
      throw new Error("No se pudo verificar el cliente");
    }

    if (existe) {
      // Cliente existente: si el tipo_cliente cambió en la cotización lo
      // sincronizamos en la ficha del cliente (antes se ignoraba y por eso
      // nunca se persistía).
      const tcActual = (existe.tipo_cliente || "").toString().trim();
      const tcNuevo = (tipoCliente || "").toString().trim();
      if (tcNuevo && tcNuevo !== tcActual) {
        try {
          await api.put(`/clientes/${existe.id}`, { tipo_cliente: tcNuevo });
        } catch (errUpd) {
          console.warn("No se pudo actualizar tipo_cliente del cliente existente:", errUpd);
          // No bloqueamos la creación de la cotización por esto.
        }
      }
      return;
    }

    // Cliente particular: queda anexado al vendedor que lo crea (su email).
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
        vendedor_asignado: esParticular ? ((perfilEmail || "").trim() || null) : null,
      });
    } catch (error) {
      console.error("Error creando cliente:", error);
      throw new Error("No se pudo crear el cliente");
    }
  }

  function limpiarDatos(showToast = true) {
    setIdLicitacionInput("");
    setNombre("");
    setFechaHoraCierre("");
    setMonto("");
    setListado("1");

    setRutEntidad("");
    setNombreEntidad("");
    setGiro("");
    setTipoCliente("");
    setDepartamento("");
    setMunicipalidad("");
    setRegion("");
    setComuna("");
    setDireccion("");
    setSucursal("");
    setSucursales([]);
    setContacto("");
    setEmail("");
    setTelefono("");
    setCondVenta("");

    setFleteEstimado(0);
    setItems([crearItemVacio()]);

    setObservaciones("");
    setMadreId(null);

    if (showToast) {
      setToast({
        type: "success",
        message: "Los datos fueron limpiados correctamente.",
      });
    }
  }

  /* ============================================================
     PRODUCTOS EQUIVALENTES → COTIZACIÓN HIJA
============================================================ */
  const buscarProductoPorSku = (sku) =>
    productos.find((p) => String(p.sku || "").trim() === String(sku || "").trim()) || null;

  // Equivalencias válidas de un SKU: las declaradas en el producto que además
  // existan en el catálogo activo.
  function equivalenciasDeSku(sku) {
    const p = buscarProductoPorSku(sku);
    if (!p) return [];
    return [p.equivalente_1, p.equivalente_2, p.equivalente_3]
      .map((s) => String(s || "").trim())
      .filter(Boolean)
      .filter((s) => s !== String(sku || "").trim())
      .filter((s) => buscarProductoPorSku(s));
  }

  // Tras guardar una cotización MADRE: si algún ítem tiene equivalencias,
  // arma la sugerencia para crear la cotización alternativa (hija).
  // Las equivalencias aplican solamente a cotizaciones de ENTIDAD PÚBLICA.
  function construirSugerenciaHija(licId, itemsGuardados) {
    const esParticular =
      (tipoCliente || "").toLowerCase() === "cliente particular" || tipoCompra === "Cliente particular";
    if (esParticular) return null;
    const conEquiv = [];
    const itemsHija = itemsGuardados.map((it) => {
      const eqs = equivalenciasDeSku(it.sku);
      if (!eqs.length) return { ...it };
      conEquiv.push({ sku: it.sku, producto: it.producto, equivalencias: eqs });
      // equivOpciones: SKU original + equivalencias — el selector del ítem
      // permite alternar entre ellas en la hija.
      return { ...it, equivOpciones: [String(it.sku || "").trim(), ...eqs] };
    });
    if (!conEquiv.length) return null;
    return {
      madreId: licId,
      codigoMadre: idLicitacionInput || String(licId),
      conEquiv,
      items: itemsHija,
      form: {
        nombre, fechaHoraCierre, monto, listado, rutEntidad, nombreEntidad, giro,
        tipoCliente, departamento, municipalidad, direccion, sucursal, contacto,
        email, telefono, condVenta, fleteEstimado, tipoCompra, region, comuna,
        observaciones, fechaPublicacionResultados,
      },
    };
  }

  // Confirmación del usuario: repuebla el formulario como cotización HIJA de la
  // madre recién guardada, destacando los ítems con equivalencias.
  async function crearCotizacionHija() {
    const s = sugerenciaEquiv;
    setSugerenciaEquiv(null);
    if (!s) return;
    const f = s.form;
    setMadreId(s.madreId);
    // ID de la hija: correlativo por defecto derivado de la madre
    // (<código madre>-1, -2, …) según cuántas hijas ya existen. Editable.
    let correlativo = 1;
    try {
      const hijas = await api.get(`/licitaciones/${s.madreId}/hijas`);
      correlativo = (Array.isArray(hijas) ? hijas.length : 0) + 1;
    } catch {
      // sin datos de hijas: se asume la primera
    }
    setIdLicitacionInput(`${s.codigoMadre}-${correlativo}`);
    setNombre(f.nombre || "");
    setFechaHoraCierre(f.fechaHoraCierre || "");
    setMonto(typeof f.monto === "number" ? Number(f.monto).toLocaleString("es-CL") : f.monto || "");
    setListado(String(f.listado || "1"));
    setRutEntidad(f.rutEntidad || "");
    setNombreEntidad(f.nombreEntidad || "");
    setGiro(f.giro || "");
    setTipoCliente(f.tipoCliente || "");
    setDepartamento(f.departamento || "");
    setMunicipalidad(f.municipalidad || "");
    setDireccion(f.direccion || "");
    setSucursal(f.sucursal || "");
    setContacto(f.contacto || "");
    setEmail(f.email || "");
    setTelefono(f.telefono || "");
    setCondVenta(f.condVenta || "");
    setFleteEstimado(f.fleteEstimado || 0);
    setTipoCompra(f.tipoCompra || "");
    setRegion(f.region || "");
    setComuna(f.comuna || "");
    setObservaciones(f.observaciones || "");
    setFechaPublicacionResultados(f.fechaPublicacionResultados || "");
    setItems(s.items.map((it) => ({ ...it })));
    setToast({
      type: "info",
      message: "Cotización alternativa: los ítems destacados tienen equivalencias — elige en cada uno el producto equivalente que quieras usar y guarda.",
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // Cambia el ítem al SKU elegido (equivalente u original) manteniendo el
  // selector disponible.
  function aplicarEquivalencia(index, sku) {
    if (!sku) return;
    actualizarItem(index, "sku", sku);
  }

  /* ============================================================
     GUARDAR LICITACIÓN
     ✅ FIX: filtra ítems vacíos + valida mínimos
     ✅ FIX: inserta items en batch + agrega `orden`
============================================================ */
  async function guardarLicitacion() {
    setToast(null);

    if (guardando || generandoPDF || guardandoRef.current) return;
    guardandoRef.current = true;
    setGuardando(true);

    if (!puedeCrearLicitacion) {
      guardandoRef.current = false;
      setGuardando(false);
      setToast({
        type: "error",
        message: "No tienes permisos para crear licitaciones.",
      });
      return;
    }

    const esClienteParticular = tipoCliente.toLowerCase() === "cliente particular" || tipoCompra === "Cliente particular";

    const errores = [];
    // Para cliente particular el ID se genera automáticamente (igual al id interno) — no validamos.
    if (!esClienteParticular && !idLicitacionInput) errores.push("ID Licitación");
    if (!nombre) errores.push("Nombre Licitación");
    // Cliente particular no lleva fecha/hora de cierre.
    if (!esClienteParticular && !fechaHoraCierre) errores.push("Fecha y Hora de Cierre");
    // Licitaciones exigen fecha de publicación de resultados.
    const esLicitacionTipo = tipoCompra === "Licitación 0 a 8 meses" || tipoCompra === "Licitación 9 a 24 meses";
    if (esLicitacionTipo && !fechaPublicacionResultados) errores.push("Fecha de publicación de resultados");
    if (!esClienteParticular && !monto) errores.push("Monto");
    if (!tipoCliente) errores.push("Tipo de Cotización");
    if (!rutEntidad) errores.push("RUT Entidad");
    if (!nombreEntidad) errores.push("Nombre Entidad");
    // Punto 29: Departamento no es obligatorio cuando el tipo de compra es "Cliente particular".
    if (tipoCompra !== "Cliente particular" && !departamento) errores.push("Departamento");
    if (!tipoCompra) errores.push("Tipo de Compra");
    if (!region) errores.push("Región");
    if (!comuna) errores.push("Comuna");

    if (errores.length > 0) {
      guardandoRef.current = false;
      setGuardando(false);
      setToast({
        type: "error",
        message: "Faltan campos obligatorios:\n\n• " + errores.join("\n• "),
      });
      return;
    }

    const fechaHoy = new Date().toISOString().slice(0, 10);

    const vendedorNombreFinal = (perfilNombre || "").toString().trim();
    const vendedorCorreoFinal = (perfilEmail || "").toString().trim();
    const vendedorCelularFinal = (perfilCelular || "").toString().trim();

    if (!vendedorCorreoFinal) {
      guardandoRef.current = false;
      setGuardando(false);
      setToast({ type: "error", message: "Sesión no válida. Vuelve a iniciar." });
      return;
    }

    // Pre-check de bloqueo por mora del cliente (el backend lo valida igual al
    // guardar, esto solo evita el trabajo previo y avisa de inmediato).
    try {
      const estadoMora = await api.get(
        `/licitaciones/cliente-mora?rut=${encodeURIComponent(rutEntidad)}&tipo=${encodeURIComponent(tipoCliente || "")}`
      );
      if (estadoMora?.bloqueado) {
        guardandoRef.current = false;
        setGuardando(false);
        setToast({
          type: "error",
          message: `Cliente bloqueado por deuda: ${estadoMora.diasAtrasoMax} días de atraso (máximo ${estadoMora.umbral}). Regulariza en Cobranza o solicita desbloqueo a un administrador.`,
        });
        return;
      }
    } catch { /* si el check falla, no bloqueamos aquí; el backend decide al guardar */ }

    setToast({ type: "info", message: "Guardando licitación…" });

    try {
      // ✅ validar duplicado por ID Licitación (solo si NO es cliente particular —
      // los particulares reciben el correlativo automáticamente al guardar).
      const idLicitacionNorm = (idLicitacionInput || "").toString().trim();
      if (!esClienteParticular) {
        let dup;
        try {
          const allLics = await api.get(`/licitaciones?id_licitacion=${encodeURIComponent(idLicitacionNorm)}`);
          dup = allLics;
        } catch (errDup) {
          console.error(errDup);
          setToast({
            type: "error",
            message: "No se pudo validar el ID de licitación.",
          });
          return;
        }

        if (dup && dup.length > 0) {
          setToast({
            type: "error",
            message:
              `Ya existe una licitación con el ID "${idLicitacionNorm}".\n` +
              "No se puede guardar nuevamente con el mismo ID Licitación.",
          });
          return;
        }
      }

      try {
        await crearClienteSiNoExiste();
      } catch (e) {
        setToast({
          type: "error",
          message: "Error al guardar el cliente asociado.",
        });
        return;
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

      if (itemsParaGuardar.length === 0) {
        setToast({
          type: "error",
          message: "Debes agregar al menos 1 ítem válido antes de guardar.",
        });
        return;
      }

      // ✅ Validar mínimos por ítem
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
          return;
        }
      }

      const lineasBajoMargen = itemsParaGuardarConIndex
        .map(({ it, idx }) => {
          const margen = calcularMargenItem(it);
          return margen > 0 && margen < 20 ? idx + 1 : null;
        })
        .filter(Boolean);

      const requiereAprobacion = margenGeneral < 20;

      // Para cliente particular el id_licitacion final = String(id interno). Como necesitamos
      // el id antes del INSERT, mandamos un placeholder único y lo reemplazamos con un UPDATE
      // posterior. El placeholder evita colisiones por UNIQUE constraint.
      const idLicitacionParaInsert = esClienteParticular
        ? `__pending_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
        : idLicitacionInput;

      let lic;
      try {
        lic = await api.post("/licitaciones", {
            id_licitacion: idLicitacionParaInsert,
            nombre,
            fecha_hora_cierre: esClienteParticular ? null : (fechaHoraCierre || null),
            fecha_publicacion_resultados: fechaPublicacionResultados || null,
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

            fecha: fechaHoy,
            creado_por: vendedorCorreoFinal,
            estado: requiereAprobacion ? "Pendiente Aprobación" : "En espera",
            // Jerarquía por equivalencias: la hija referencia a su madre y no
            // vuelve a analizar sus propias equivalencias al guardarse.
            madre_id: madreId || null,
            jerarquia: madreId ? "hija" : "madre",
            flete_estimado: Number(fleteEstimado),
            total_con_iva: totalConIVA,
            total_sin_iva: totalNeto,
            total_iva: totalIVA,

            observaciones: observaciones || null,

            vendedor_nombre: vendedorNombreFinal || null,
            vendedor_celular: vendedorCelularFinal || null,
            vendedor_correo: vendedorCorreoFinal || null,
        });
      } catch (error) {
        console.error(error);
        // Surface el motivo real (ej. bloqueo por mora del cliente).
        setToast({ type: "error", message: error?.message || "Error al guardar licitación" });
        return;
      }

      const idLicitacion = lic.id;

      // Cliente particular: reemplazar el placeholder con el id interno como id_licitacion final.
      if (esClienteParticular) {
        try {
          await api.put(`/licitaciones/${idLicitacion}`, {
            id_licitacion: String(idLicitacion),
          });
          setIdLicitacionInput(String(idLicitacion));
        } catch (errCorr) {
          console.error("No se pudo asignar el correlativo automático:", errCorr);
        }
      }

      // ✅ INSERT EN BATCH + ✅ ORDEN
      const payloadItems = itemsParaGuardar.map((it, idx) => {
        const skuLimpio = String(it.sku || "").trim();
        const cantidad = Math.max(1, Number(it.cantidad || 1));

        return {
          licitacion_id: idLicitacion,
          orden: idx + 1, // ✅ orden persistido
          producto: it.producto || "",
          formato: it.formato || "",
          cantidad,
          valor_unitario: Number(it.precio || 0) + fletePorUnidad,
          sku: skuLimpio ? skuLimpio : null,
          total: Number(it.total || 0),
          categoria: it.categoria || "",
          observacion: it.observacion || "",
          // El costo con el que se calculó el margen EN ESTA cotización
          // (editado a mano o el de catálogo al guardar): es lo que leen los
          // KPIs de margen de los paneles, para que digan lo mismo que acá.
          costo: getCostoParaItem(it),
        };
      });

      try {
        await api.post(`/licitaciones/${idLicitacion}/items`, { items: payloadItems });
      } catch (errItems) {
        console.error(errItems);
        setToast({
          type: "error",
          message: "La licitación se creó, pero hubo un error guardando los ítems.",
        });
        return;
      }

      // Vincular con la solicitud del portal del cliente (si aplica).
      if (solicitudStockId) {
        try {
          await api.put(`/stock-clientes/solicitudes/${solicitudStockId}/vincular`, {
            licitacion_id: idLicitacion,
          });
        } catch (errVinc) {
          console.warn("No se pudo vincular la solicitud del cliente:", errVinc?.message);
        }
        setSolicitudStockId(null);
      }

      // Marcar la fila del listado "Licitaciones disponibles" como cargada
      // (solo ahora que la cotización quedó guardada).
      if (disponibleId) {
        try {
          await api.put(`/licitaciones/disponibles/${disponibleId}/cargar`, {});
        } catch (errDisp) {
          // No interrumpe el guardado (la cotización ya existe), pero tampoco
          // se pierde: si vuelve a fallar, queda registrado en el Monitoreo en
          // vez de morir en la consola del navegador como pasaba antes.
          console.warn("No se pudo marcar la licitación del listado como cargada:", errDisp?.message);
          reportarError(errDisp, { contexto: "marcar_disponible_cargada", disponible_id: disponibleId, licitacion_id: idLicitacion });
        }
        setDisponibleId(null);
      }

      if (requiereAprobacion) {
        const detalleLineas = lineasBajoMargen.length
          ? ` Las líneas ${lineasBajoMargen.join(", ")} tienen un % de margen menor al 20%.`
          : "";
        setToast({
          type: "success",
          message: `Licitación pendiente de aprobación porque el margen general es inferior al 20%.${detalleLineas}`,
        });
        localStorage.removeItem(STORAGE_KEY);
        // Solo las cotizaciones MADRE analizan equivalencias (las hijas no).
        const sugerenciaAprob = !madreId ? construirSugerenciaHija(idLicitacion, itemsParaGuardar) : null;
        limpiarDatos(false);
        if (sugerenciaAprob) setSugerenciaEquiv(sugerenciaAprob);
        return;
      }

      // ✅ generar PDF (con el orden del array filtrado)
      setGenerandoPDF(true);
      setToast({ type: "info", message: "Generando PDF…" });

      await generarPDFcotizacion({
        numero_licitacion: idLicitacion,
        id_licitacion: idLicitacionInput,
        fecha_emision: fechaHoy,

        vendedor_nombre: vendedorNombreFinal,
        vendedor_correo: vendedorCorreoFinal,
        vendedor_celular: vendedorCelularFinal,

        nombre_entidad: nombreEntidad,
        rut_entidad: rutEntidad,
        direccion,
        sucursal,
        comuna,
        contacto,
        email,
        telefono,
        condicion_venta: condVenta,

        observaciones: (observaciones ?? "").toString(),

        items: itemsParaGuardar.map((it, idx) => ({
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

      setToast({
        type: "success",
        message: `La licitación "${nombre}" fue creada correctamente.`,
      });

      localStorage.removeItem(STORAGE_KEY);
      // Solo las cotizaciones MADRE analizan equivalencias (las hijas no).
      const sugerencia = !madreId ? construirSugerenciaHija(idLicitacion, itemsParaGuardar) : null;
      limpiarDatos();
      if (sugerencia) setSugerenciaEquiv(sugerencia);
    } finally {
      guardandoRef.current = false;
      setGenerandoPDF(false);
      setGuardando(false);
    }
  }

  /* ============================================================
     OPCIONES SELECT (SKU: solo productos con SKU)
  ============================================================ */
  const opcionesSKU = useMemo(
    () =>
      productos
        .filter((p) => String(p.sku || "").trim() !== "")
        .map((p) => ({
          value: String(p.sku).trim(),
          label: String(p.sku).trim(),
        })),
    [productos]
  );

  const opcionesProducto = useMemo(
    () =>
      productos.map((p) => ({
        value: p.nombre,
        label: p.nombre,
      })),
    [productos]
  );

  /* DRAG & DROP */
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  // ✅ FIX: NO depender de "items" aquí (evita stale state)
  // ✅ FIX: persistencia inmediata del orden
  const handleDragEnd = useCallback((event) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    setItems((prev) => {
      const oldIndex = prev.findIndex((it) => it.id === active.id);
      const newIndex = prev.findIndex((it) => it.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return prev;

      const next = arrayMove(prev, oldIndex, newIndex);

      // ✅ guardar al tiro en localStorage (evita perder orden si se cae)
      persistirDraftItems(next);

      return next;
    });
  }, []);

  /* UI */
  if (perfilLoading) {
    return <div className="p-8 text-gray-600">Cargando perfil…</div>;
  }

  if (!puedeCrearLicitacion) {
    return (
      <div className="p-8">
        <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
          <h1 className="text-xl font-semibold text-gray-900 mb-2">
            Acceso restringido
          </h1>
          <p className="text-sm text-gray-700">
            Tu usuario no tiene permisos para crear licitaciones.
          </p>
          <p className="text-xs text-gray-500 mt-2">
            Rol detectado: <b>{rol ?? "sin rol"}</b>{" "}
            {perfilNombre ? `(${perfilNombre})` : ""}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="page">

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

      {/* Sugerencia post-guardado: crear cotización alternativa con equivalencias */}
      {sugerenciaEquiv && (
        <div
          onClick={(e) => { if (e.target === e.currentTarget) setSugerenciaEquiv(null); }}
          style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.55)", zIndex: 12000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
        >
          <div style={{ width: 560, maxWidth: "100%", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-lg)", padding: 22 }}>
            <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}>
              ⇄ Se detectaron productos con equivalencias
            </h3>
            <p style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 8, marginBottom: 12 }}>
              La cotización <strong>{sugerenciaEquiv.codigoMadre}</strong> quedó guardada. {sugerenciaEquiv.conEquiv.length === 1 ? "1 ítem tiene" : `${sugerenciaEquiv.conEquiv.length} ítems tienen`} productos equivalentes registrados.
              ¿Quieres crear una <strong>cotización alternativa (hija)</strong> usando esas equivalencias?
            </p>
            <div style={{ maxHeight: 260, overflowY: "auto", border: "1px solid var(--border)", borderRadius: 8, marginBottom: 16 }}>
              {sugerenciaEquiv.conEquiv.map((c) => {
                // Precios según la lista de la cotización recién guardada (el
                // formulario ya se limpió, así que se usa la capturada).
                const listaPrecio = sugerenciaEquiv.form?.listado || listado;
                const prodOrig = buscarProductoPorSku(c.sku);
                const precioOrig = prodOrig ? getPrecioBaseParaSKU(prodOrig, listaPrecio, campaignPrices) : 0;
                const fmtP = (v) => `$${Math.round(Number(v || 0)).toLocaleString("es-CL")}`;
                return (
                  <div key={c.sku} style={{ padding: "10px 12px", borderBottom: "1px solid var(--border)", fontSize: 12.5 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                      <span style={{ fontWeight: 600 }}>{c.sku} — {c.producto}</span>
                      <span style={{ fontWeight: 700, whiteSpace: "nowrap" }}>{fmtP(precioOrig)}</span>
                    </div>
                    <div style={{ fontSize: 11.5, color: "var(--text-muted)", margin: "4px 0 2px" }}>
                      Equivalencias (precios lista {listaPrecio}):
                    </div>
                    <ul style={{ listStyle: "disc", margin: 0, paddingLeft: 20, display: "flex", flexDirection: "column", gap: 3 }}>
                      {c.equivalencias.map((sku) => {
                        const p = buscarProductoPorSku(sku);
                        const precio = p ? getPrecioBaseParaSKU(p, listaPrecio, campaignPrices) : 0;
                        return (
                          <li key={sku} style={{ color: "var(--text-muted)" }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                              <span>
                                <strong style={{ color: "var(--text)" }}>{sku}</strong>
                                {p ? ` — ${p.nombre}` : ""}
                              </span>
                              <span style={{ fontWeight: 700, color: precio > 0 && precioOrig > 0 && precio < precioOrig ? "#15803d" : "var(--text)", whiteSpace: "nowrap" }}>
                                {fmtP(precio)}
                              </span>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                );
              })}
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button className="btn btn-secondary" onClick={() => setSugerenciaEquiv(null)}>No, gracias</button>
              <button className="btn btn-primary" onClick={crearCotizacionHija}>Crear cotización con equivalencias</button>
            </div>
          </div>
        </div>
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
          <h1 className="page-title">Crear Cotización</h1>
          {madreId && (
            <p className="page-subtitle" style={{ display: "inline-flex", alignItems: "center", gap: 6, marginTop: 4 }}>
              <span style={{ fontSize: 12, fontWeight: 700, padding: "3px 10px", borderRadius: 999, background: "#fef3c7", color: "#a16207", border: "1px solid #fde68a" }}>
                Cotización Alternativa · Hija de la Cotización #{madreId}
              </span>
              <button
                type="button"
                onClick={() => setMadreId(null)}
                title="Desvincular de la cotización madre"
                style={{ fontSize: 11, color: "var(--text-muted)", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}
              >
                Desvincular
              </button>
            </p>
          )}
        </div>
      </div>

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
              className="w-full rounded-md border border-gray-300 px-3 py-2"
              value={tipoCliente}
              onChange={async (e) => {
                const nuevo = e.target.value;
                setTipoCliente(nuevo);
                if (nuevo.toLowerCase() === "cliente particular") {
                  setTipoCompra("Cliente particular");
                  setListado("1");
                  // Cliente particular se asocia automáticamente a "Contado".
                  setCondVenta("Contado");
                  // Para cliente particular el ID se asigna automáticamente: pedimos el preview.
                  setIdLicitacionInput("");
                  setIdPreviewLoading(true);
                  try {
                    const res = await api.get("/licitaciones/next-id");
                    setIdPreview(res?.next ?? null);
                  } catch (err) {
                    console.error("No se pudo obtener el correlativo:", err);
                    setIdPreview(null);
                  } finally {
                    setIdPreviewLoading(false);
                  }
                } else {
                  setIdPreview(null);
                  if (nuevo.toLowerCase() === "entidad pública" && tipoCompra === "Cliente particular") {
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
            <p className="text-[11px] text-gray-500 mt-1">
              Define las opciones de tipo de compra disponibles.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              ID Cotización{tipoCliente.toLowerCase() === "cliente particular" ? " (auto)" : " *"}
            </label>
            <input
              className="w-full rounded-md border border-gray-300 px-3 py-2 disabled:bg-gray-100 disabled:text-gray-500 disabled:font-semibold"
              value={
                tipoCliente.toLowerCase() === "cliente particular"
                  ? (idPreviewLoading ? "Cargando…" : (idPreview != null ? String(idPreview) : ""))
                  : idLicitacionInput
              }
              onChange={(e) => setIdLicitacionInput(e.target.value)}
              disabled={tipoCliente.toLowerCase() === "cliente particular"}
              placeholder={tipoCliente.toLowerCase() === "cliente particular" ? "Se asigna al guardar" : ""}
            />
            {tipoCliente.toLowerCase() === "cliente particular" && (
              <p className="text-[11px] text-gray-500 mt-1">
                Correlativo automático. El número definitivo se confirma al guardar.
              </p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Nombre Cotización *
            </label>
            <input
              className="w-full rounded-md border border-gray-300 px-3 py-2"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
            />
          </div>

          {!(tipoCliente.toLowerCase() === "cliente particular" || tipoCompra === "Cliente particular") && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Fecha y Hora de Cierre *
              </label>
              <input
                type="datetime-local"
                className="w-full rounded-md border border-gray-300 px-3 py-2"
                value={fechaHoraCierre}
                onChange={(e) => setFechaHoraCierre(e.target.value)}
              />
            </div>
          )}

          {!esParticular && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Monto Presupuesto *
              </label>
              <input
                type="text"
                inputMode="numeric"
                className="w-full rounded-md border border-gray-300 px-3 py-2"
                value={monto}
                onChange={(e) => setMonto(formatearCLDesdeString(e.target.value))}
                placeholder=""
              />
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Tipo de Compra *
            </label>
            <select
              className="w-full rounded-md border border-gray-300 px-3 py-2"
              value={tipoCompra}
              onChange={(e) => {
                const next = e.target.value;
                setTipoCompra(next);
                if (next === "Cliente particular") setListado("1");
                else if (next === "Licitación 9 a 24 meses") setListado("3");
                else setListado("2");
              }}
            >
              {/* Filtrado por tipoCliente: Particular → solo "Cliente particular"; Pública → resto. */}
              {tipoCliente.toLowerCase() === "cliente particular" ? (
                <option value="Cliente particular">Cliente particular</option>
              ) : (
                <>
                  <option value="Compra ágil">Compra ágil</option>
                  <option value="Compra directa">Compra directa</option>
                  <option value="Licitación 0 a 8 meses">Licitación 0 a 8 meses</option>
                  <option value="Licitación 9 a 24 meses">Licitación 9 a 24 meses</option>
                  {/* Si aún no eligen tipo de cliente, mostrar todas las opciones. */}
                  {!tipoCliente && <option value="Cliente particular">Cliente particular</option>}
                </>
              )}
            </select>
            <p className="text-[11px] text-gray-500 mt-1">
              Cliente particular usa Lista 1, Licitación 9 a 24 meses usa Lista 3 (Lista 2 × 1.08); el resto usa Lista 2.
            </p>
          </div>

          {(tipoCompra === "Licitación 0 a 8 meses" || tipoCompra === "Licitación 9 a 24 meses") && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Fecha de publicación de resultados *
              </label>
              <input
                type="date"
                className="w-full rounded-md border border-gray-300 px-3 py-2"
                value={fechaPublicacionResultados}
                onChange={(e) => setFechaPublicacionResultados(e.target.value)}
              />
            </div>
          )}
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

      <div
        className={`transition-all duration-300 overflow-hidden ${
          mostrarEntidad ? "max-h-[2000px] opacity-100" : "max-h-0 opacity-0"
        }`}
      >
        <div className="surface-body">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              RUT *
            </label>
            <ClienteAutocomplete
              modo="rut"
              value={rutEntidad}
              onChange={setRutEntidad}
              onPick={(c) => buscarClientePorRut(c.rut)}
              onBlur={() => buscarClientePorRut(rutEntidad)}
              clientes={clientesSugeridos}
              className="w-full rounded-md border border-gray-300 px-3 py-2"
              placeholder="Busca o escribe el RUT…"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Nombre Entidad *
            </label>
            <ClienteAutocomplete
              modo="nombre"
              value={nombreEntidad}
              onChange={setNombreEntidad}
              onPick={(c) => buscarClientePorRut(c.rut)}
              onBlur={() => buscarClientePorNombre(nombreEntidad)}
              clientes={clientesSugeridos}
              className="w-full rounded-md border border-gray-300 px-3 py-2"
              placeholder="Busca o escribe el nombre…"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Giro
            </label>
            <input
              className="w-full rounded-md border border-gray-300 px-3 py-2"
              value={giro}
              onChange={(e) => setGiro(e.target.value)}
              placeholder="Ej: Servicios dentales"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Departamento{tipoCompra !== "Cliente particular" ? " *" : ""}
            </label>
            <input
              className="w-full rounded-md border border-gray-300 px-3 py-2"
              value={departamento}
              onChange={(e) => setDepartamento(e.target.value)}
              disabled={tipoCompra === "Cliente particular"}
              placeholder={tipoCompra === "Cliente particular" ? "No aplica para cliente particular" : ""}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Municipalidad
            </label>
            <input
              className="w-full rounded-md border border-gray-300 px-3 py-2"
              value={municipalidad}
              onChange={(e) => setMunicipalidad(e.target.value)}
            />
          </div>

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
            />
          </div>

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
              isDisabled={!region}
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
                !rutEntidad ? "Seleccione el cliente primero"
                  : sucursales.length ? "Seleccione sucursal…"
                  : "Sin sucursales registradas"
              }
              menuPortalTarget={document.body}
              isSearchable
              isClearable
              filterOption={filtrarPorTerminos}
              isDisabled={!rutEntidad || sucursales.length === 0}
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
              className="w-full rounded-md border border-gray-300 px-3 py-2"
              value={direccion}
              onChange={(e) => setDireccion(e.target.value)}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Contacto
            </label>
            <input
              className="w-full rounded-md border border-gray-300 px-3 py-2"
              value={contacto}
              onChange={(e) => setContacto(e.target.value)}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Email
            </label>
            <input
              type="email"
              className="w-full rounded-md border border-gray-300 px-3 py-2"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Teléfono
            </label>
            <input
              className="w-full rounded-md border border-gray-300 px-3 py-2"
              value={telefono}
              onChange={(e) => setTelefono(e.target.value)}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Condiciones de Venta *
            </label>
            <select
              className="w-full rounded-md border border-gray-300 px-3 py-2 disabled:bg-gray-100 disabled:text-gray-500"
              value={condVenta}
              onChange={(e) => setCondVenta(e.target.value)}
              disabled={esParticular && !puedeEditarCondVenta}
            >
              <option value="">Seleccione…</option>
              <option value="30 días">30 días</option>
              <option value="Contado">Contado</option>
            </select>
            {esParticular && !puedeEditarCondVenta && (
              <p className="text-[11px] text-gray-500 mt-1">
                Cliente particular: condición fija en "Contado".
              </p>
            )}
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
          items={items.map((it) => it.id)}
          strategy={verticalListSortingStrategy}
        >
          <div className="space-y-3 max-h-[900px] overflow-y-auto pr-2">
            {items.map((it, index) => {
              const margenItem = calcularMargenItem(it);
              const isLowMargin = margenItem > 0 && margenItem < 20;
              // Cotización hija: ítems con equivalencias disponibles se destacan
              // y ofrecen el selector para cambiar al producto equivalente.
              const equivOpciones = Array.isArray(it.equivOpciones)
                ? it.equivOpciones.map((sku) => buscarProductoPorSku(sku)).filter(Boolean)
                : [];
              const tieneEquiv = equivOpciones.length > 1;

              return (
                <SortableItem
                  key={it.id}
                  itemId={it.id}
                  onInsertAfter={() => insertarItemDespues(index)}
                  canInsertAfter={true}
                >
                  {({ dragHandleProps, onInsertAfter }) => (
                    <div
                      className={`bg-white border rounded-lg p-4 shadow-sm space-y-3 ${
                        isLowMargin ? "border-red-400 bg-red-50" : tieneEquiv ? "border-amber-400 bg-amber-50" : "border-gray-200"
                      }`}
                    >
                    {tieneEquiv && (
                      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "6px 10px", borderRadius: 8, background: "#fffbeb", border: "1px solid #fde68a" }}>
                        <span style={{ fontSize: 11.5, fontWeight: 700, color: "#a16207" }}>
                          ⇄ Producto con equivalencias
                        </span>
                        <select
                          className="input"
                          value={String(it.sku || "").trim()}
                          onChange={(e) => aplicarEquivalencia(index, e.target.value)}
                          style={{ fontSize: 12, maxWidth: 460, padding: "4px 8px" }}
                          title="Elegir el producto equivalente para esta cotización alternativa"
                        >
                          {equivOpciones.map((p, i) => {
                            const skuOp = String(p.sku || "").trim();
                            const precioOp = getPrecioBaseParaSKU(p, listado, campaignPrices);
                            return (
                              <option key={skuOp} value={skuOp}>
                                {i === 0 ? "(Original) " : `(Equiv. ${i}) `}{skuOp} — {p.nombre} — ${Number(precioOp || 0).toLocaleString("es-CL")}
                              </option>
                            );
                          })}
                        </select>
                      </div>
                    )}
                    <div className="grid grid-cols-1 md:grid-cols-[repeat(24,minmax(0,1fr))] gap-4 items-end">
                      <div className="md:col-span-1">
                        <label className="block text-xs text-gray-600 mb-1">
                          Items
                        </label>
                        <div className="w-full h-10 rounded-md border border-gray-300 px-3 flex items-center justify-center font-semibold bg-gray-50">
                          {index + 1}
                        </div>
                      </div>

                      <div className={esAdmin ? "md:col-span-3" : "md:col-span-3"}>
                        <label className="block text-xs text-gray-600 mb-1">
                          SKU
                        </label>
                        <Select
                          options={opcionesSKU}
                          styles={customStyles}
                          placeholder="Seleccione SKU…"
                          menuPortalTarget={document.body}
                          isSearchable={true}
                          filterOption={filtrarPorTerminos}
                          components={{ MenuList: MenuListLimitada }}
                          value={opcionesSKU.find((o) => o.value === it.sku) || null}
                          onChange={(op) =>
                            actualizarItem(index, "sku", op ? op.value : "")
                          }
                        />
                      </div>

                      <div className={esAdmin ? "md:col-span-4" : "md:col-span-9"}>
                        <div className="flex items-center justify-between mb-1">
                          <label className="block text-xs text-gray-600">
                            Producto
                          </label>
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
                        </div>
                        <Select
                          options={opcionesProducto}
                          styles={customStyles}
                          placeholder="Seleccione producto…"
                          menuPortalTarget={document.body}
                          isSearchable={true}
                          filterOption={filtrarPorTerminos}
                          value={
                            opcionesProducto.find((o) => o.value === it.producto) ||
                            null
                          }
                          onChange={(op) =>
                            actualizarItem(index, "producto", op ? op.value : "")
                          }
                          components={{
                            SingleValue: ProductoSingleValue,
                            MenuList: MenuListLimitada,
                          }}
                          setTooltip={setTooltip}
                        />
                      </div>

                      <div className="md:col-span-2">
                        <label className="block text-xs text-gray-600 mb-1">
                          Formato
                        </label>
                        <input
                          className="w-full h-10 rounded-md border border-gray-300 px-3 text-sm"
                          value={it.formato}
                          onChange={(e) =>
                            actualizarItem(index, "formato", e.target.value)
                          }
                        />
                      </div>

                      <div className="md:col-span-2">
                        <label className="block text-xs text-gray-600 mb-1">
                          Cantidad
                        </label>
                        <input
                          type="number"
                          min="1"
                          className="w-full h-10 rounded-md border border-gray-300 px-3 text-sm no-spinner"
                          value={it.cantidad}
                          onInput={(e) => {
                            e.target.value = e.target.value.replace(/[^0-9]/g, "");
                            if (e.target.value === "" || Number(e.target.value) <= 0) {
                              e.target.value = "1";
                            }
                          }}
                          onChange={(e) =>
                            actualizarItem(index, "cantidad", e.target.value)
                          }
                        />
                      </div>

                      <div className="md:col-span-2">
                        <label className="block text-xs text-gray-600 mb-1">
                          Precio Unitario
                        </label>

                        <input
                          type="text"
                          inputMode="numeric"
                          className="w-full h-10 rounded-md border border-gray-300 px-3 text-sm font-semibold bg-white"
                          value={
                            (it.precioUnitarioStr ?? "").toString() !== ""
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
                            className="w-full h-10 rounded-md border border-gray-300 px-3 text-sm font-semibold bg-white"
                            value={
                              (it.costoStr ?? "").toString() !== ""
                                ? it.costoStr
                                : formatearCLDesdeString(
                                    String(Number(getCostoParaItem(it) || 0))
                                  )
                            }
                            onChange={(e) => actualizarCostoItem(index, e.target.value)}
                            onBlur={() => finalizarEdicionCosto(index)}
                          />
                        </div>
                      )}

                      {/* Margen por línea visible para TODOS (pedido 2026-08-27);
                          el campo Costo editable sigue siendo solo de admin. */}
                      <div className="md:col-span-2">
                        <label className="block text-xs text-gray-600 mb-1">
                          Margen
                        </label>
                        <input
                          className="w-full h-10 rounded-md border border-gray-300 px-3 text-sm bg-gray-50"
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

                      <div className="md:col-span-2">
                        <label className="block text-xs text-gray-600 mb-1">
                          Total
                        </label>
                        <div className="h-10 flex items-center font-semibold whitespace-nowrap">
                          ${Number(it.total).toLocaleString("es-CL")}
                        </div>
                      </div>

                      <div
                        className={`flex justify-end ${
                          esAdmin ? "md:col-span-3" : "md:col-span-3"
                        }`}
                      >
                        <div className="flex items-center gap-2 whitespace-nowrap">
                          <button
                            onClick={() => toggleObservacion(index)}
                            className="item-action-btn"
                            title="Nota de ítem"
                            type="button"
                          >
                            {it.mostrarObs ? <Minus size={14} /> : <MessageSquare size={14} />}
                          </button>

                          {items.length > 1 && (
                            <button
                              onClick={() => eliminarItem(index)}
                              className="item-action-btn item-action-danger"
                              type="button"
                              title="Eliminar ítem"
                            >
                              <Trash2 size={14} />
                            </button>
                          )}
                        </div>
                      </div>

                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        ref={dragHandleProps.ref}
                        {...dragHandleProps}
                        className="item-action-btn item-drag-handle"
                        style={{ touchAction: "none" }}
                        title="Arrastrar para reordenar"
                        type="button"
                      >
                        <GripVertical size={14} />
                      </button>

                      <button
                        type="button"
                        onClick={onInsertAfter}
                        className="item-action-btn item-action-primary"
                        title="Agregar ítem debajo"
                      >
                        <Plus size={14} />
                      </button>

                    </div>

                    {it.mostrarObs && (
                      <div className="grid grid-cols-1 md:grid-cols-[repeat(24,minmax(0,1fr))] transition-all">
                        <div className="md:col-span-12">
                          <label className="block text-xs text-gray-600 mb-1">
                            Observación
                          </label>
                          <input
                            className="w-full h-10 rounded-md border border-gray-300 px-3 text-sm"
                            value={it.observacion}
                            onChange={(e) =>
                              actualizarItem(index, "observacion", e.target.value)
                            }
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
              <div className="form-display form-display-value">
                {cantidadProductos}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Flete Estimado
              </label>
              {/* Edición manual SOLO admin (pedido 2026-09-01): el resto lo
                  fija únicamente con el botón de cálculo de la calculadora. */}
              {esAdmin ? (
                <input
                  type="number"
                  className="w-full h-10 rounded-md border border-gray-300 px-3"
                  value={fleteEstimado}
                  onChange={(e) => setFleteEstimado(e.target.value)}
                />
              ) : (
                <>
                  <div className="form-display form-display-value">
                    ${Number(fleteEstimado || 0).toLocaleString("es-CL")}
                  </div>
                  <div className="field-hint">Se fija con la calculadora de flete.</div>
                </>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Flete por Unidad
              </label>
              <div className="form-display">
                ${fletePorUnidad.toLocaleString("es-CL")}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Centímetro cúbico general (cm³)
              </label>
              <div className="form-display form-display-value">
                {metroCubicoGeneral.toFixed(2)}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Peso total (kg)
              </label>
              <div className="form-display form-display-value">
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
            tipoCotizacion={esParticular || tipoCompra === "Cliente particular" ? "particular" : "publico"}
            totalCompra={totalConIVA}
            onAplicar={(neto) => setFleteEstimado(neto)}
          />
        </div>

        <div>
          <p className="form-section-title">Financiero</p>
          <div className="grid grid-cols-1 md:grid-cols-5 gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Margen General
              </label>
              <div className="form-display">
                {margenGeneral.toFixed(2)}%
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Neto
              </label>
              <div className="form-display form-display-value">
                ${totalNeto.toLocaleString("es-CL")}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                IVA 19%
              </label>
              <div className="form-display">
                ${totalIVA.toLocaleString("es-CL")}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Total
              </label>
              <div className="form-display form-display-value">
                ${totalConIVA.toLocaleString("es-CL")}
              </div>
            </div>

            {!esParticular && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  % Presupuesto
                </label>
                <div
                  className={`form-display form-display-value ${colorPresupuesto}`}
                >
                  {porcentajePresupuesto > 0
                    ? formatPorcentajePresupuesto(porcentajePresupuesto)
                    : "0%"}
                </div>
              </div>
            )}
          </div>
        </div>
        </div>
      </div>

      {/* OBSERVACIONES */}
      <div className="surface">
        <div className="surface-header">
          <h3 className="surface-title">Observaciones</h3>
        </div>
        <div className="surface-body">
          <label>Observaciones generales</label>
          <textarea
            style={{ minHeight: "110px" }}
            value={observaciones}
            onChange={(e) => setObservaciones(e.target.value)}
            placeholder="Escribe observaciones generales para la licitación…"
          />
        </div>
      </div>

      {/* BOTONES */}
      <div className="btn-row" style={{ marginTop: "8px", paddingBottom: "32px" }}>
        <button
          onClick={agregarItem}
          className="btn btn-primary"
          type="button"
        >
          + Agregar Ítem
        </button>

        <button
          type="button"
          onClick={limpiarDatos}
          className="btn btn-secondary"
        >
          Limpiar Datos
        </button>

        <button
          onClick={guardarLicitacion}
          disabled={guardando || generandoPDF}
          className={`btn btn-primary ${guardando || generandoPDF ? "opacity-60 cursor-not-allowed" : ""}`}
          type="button"
        >
          Guardar Cotización
        </button>
      </div>
    </div>
  );
}

/* ── Autocompletado de entidad (busca cliente por RUT o nombre, con estilo
   propio en vez del <datalist> nativo). Permite también texto libre. ──────── */
function ClienteAutocomplete({ modo, value, onChange, onPick, onBlur, clientes, className, placeholder }) {
  const [open, setOpen] = useState(false);
  const [activo, setActivo] = useState(-1);
  const boxRef = useRef(null);

  const norm = (s) => (s || "").toString().toLowerCase().replace(/[.\-\s]/g, "");
  const q = (value || "").toString().toLowerCase().trim();
  const qn = norm(value);

  const sugerencias = useMemo(() => {
    if (!q) return [];
    const res = [];
    for (const c of clientes || []) {
      const nombre = (c.nombre || "").toLowerCase();
      const rut = (c.rut || "").toLowerCase();
      const match =
        modo === "rut"
          ? rut.includes(q) || (qn && norm(c.rut).includes(qn))
          : nombre.includes(q) || (qn && norm(c.rut).includes(qn));
      if (match) res.push(c);
      if (res.length >= 8) break;
    }
    return res;
  }, [clientes, q, qn, modo]);

  useEffect(() => {
    function onDoc(e) {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const elegir = (c) => {
    onPick(c);
    setOpen(false);
    setActivo(-1);
  };

  return (
    <div ref={boxRef} style={{ position: "relative" }}>
      <input
        className={className}
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        onChange={(e) => { onChange(e.target.value); setOpen(true); setActivo(-1); }}
        onFocus={() => { if (value) setOpen(true); }}
        onBlur={onBlur}
        onKeyDown={(e) => {
          if (!open || !sugerencias.length) return;
          if (e.key === "ArrowDown") { e.preventDefault(); setActivo((a) => Math.min(a + 1, sugerencias.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setActivo((a) => Math.max(a - 1, 0)); }
          else if (e.key === "Enter" && activo >= 0) { e.preventDefault(); elegir(sugerencias[activo]); }
          else if (e.key === "Escape") setOpen(false);
        }}
      />
      {open && sugerencias.length > 0 && (
        <div
          style={{
            position: "absolute", zIndex: 1000, top: "calc(100% + 2px)", left: 0, right: 0,
            background: "#fff", border: "1px solid #d1d5db", borderRadius: 8,
            boxShadow: "0 8px 24px rgba(0,0,0,.12)", maxHeight: 260, overflowY: "auto",
          }}
        >
          {sugerencias.map((c, i) => (
            <button
              type="button"
              key={i}
              onMouseDown={(e) => { e.preventDefault(); elegir(c); }}
              onMouseEnter={() => setActivo(i)}
              style={{
                display: "block", width: "100%", textAlign: "left", padding: "8px 12px",
                border: "none", borderBottom: "1px solid #f1f5f9", cursor: "pointer",
                background: i === activo ? "#eff6ff" : "#fff",
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 600, color: "#111827" }}>
                {modo === "rut" ? (c.rut || "—") : (c.nombre || "—")}
              </div>
              <div style={{ fontSize: 12, color: "#6b7280" }}>
                {modo === "rut" ? (c.nombre || "") : (c.rut || "")}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
