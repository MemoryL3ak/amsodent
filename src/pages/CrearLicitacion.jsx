// CrearLicitacion.jsx
import React, { useEffect, useMemo, useState, useCallback } from "react";
import { useLocation } from "react-router-dom";
import { supabase } from "../lib/supabase";
import Toast from "../components/Toast";
import Select, { components } from "react-select";
import { generarPDFcotizacion } from "../utils/generarPDFcotizacion";

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
  // Compatibilidad con datos antiguos guardados en m3.
  if (n < 1) return n * 1_000_000;
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
    cantidad: 0,
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
  const [generandoPDF, setGenerandoPDF] = useState(false);

  useEffect(() => {
    async function cargarPerfil() {
      setPerfilLoading(true);

      const { data: userData, error: userErr } = await supabase.auth.getUser();
      const user = userData?.user;

      if (userErr || !user) {
        setRol(null);
        setPerfilNombre("");
        setPerfilEmail("");
        setPerfilCelular("");
        setPerfilLoading(false);
        return;
      }

      setPerfilEmail(user.email || "");

      const { data: perfil, error: perfilErr } = await supabase
        .from("profiles")
        .select("rol, nombre, celular")
        .eq("id", user.id)
        .single();

      if (perfilErr || !perfil) {
        setRol(null);
        setPerfilNombre("");
        setPerfilCelular("");
      } else {
        setRol(perfil.rol || null);
        setPerfilNombre(perfil.nombre || "");
        setPerfilCelular(perfil.celular || "");
      }

      setPerfilLoading(false);
    }

    cargarPerfil();
  }, []);

  const puedeCrearLicitacion = useMemo(() => {
    return ["admin", "jefe_ventas", "ventas"].includes(rol);
  }, [rol]);

  const esAdmin = useMemo(() => {
    const r = (rol ?? "").toString().trim().toLowerCase();
    return r === "admin" || r === "administrador";
  }, [rol]);

  const [mostrarEntidad, setMostrarEntidad] = useState(true);

  const [idLicitacionInput, setIdLicitacionInput] = useState("");
  const [nombre, setNombre] = useState("");
  const [fechaHoraCierre, setFechaHoraCierre] = useState("");
  const [monto, setMonto] = useState(""); // string formateado "1.234.567"
  const [listado, setListado] = useState("1");

  const [rutEntidad, setRutEntidad] = useState("");
  const [nombreEntidad, setNombreEntidad] = useState("");
  const [departamento, setDepartamento] = useState("");
  const [municipalidad, setMunicipalidad] = useState("");
  const [direccion, setDireccion] = useState("");
  const [contacto, setContacto] = useState("");
  const [email, setEmail] = useState("");
  const [telefono, setTelefono] = useState("");
  const [condVenta, setCondVenta] = useState("30 días");

  const [fleteEstimado, setFleteEstimado] = useState(0);
  const [tipoCompra, setTipoCompra] = useState("Compra ágil");
  const [region, setRegion] = useState("");
  const [comuna, setComuna] = useState("");

  const [productos, setProductos] = useState([]);
  const [toast, setToast] = useState(null);
  const [campaignPrices, setCampaignPrices] = useState({});
  const [items, setItems] = useState([crearItemVacio()]);
  const [hydrated, setHydrated] = useState(false);

  // ✅ Observaciones generales
  const [observaciones, setObservaciones] = useState("");

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

  useEffect(() => {
    const draftDuplicado = location.state?.duplicarLicitacion;
    if (!draftDuplicado) return;

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(draftDuplicado));
    } catch (e) {
      console.error("Error preparando duplicado de licitación", e);
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

      setIdLicitacionInput(data.idLicitacionInput || "");
      setNombre(data.nombre || "");
      setFechaHoraCierre(data.fechaHoraCierre || "");

      const montoGuardado = data.monto ?? "";
      if (typeof montoGuardado === "number") {
        setMonto(Number(montoGuardado).toLocaleString("es-CL"));
      } else {
        setMonto(formatearCLDesdeString(montoGuardado));
      }

      setListado(data.listado || "1");

      setRutEntidad(data.rutEntidad || "");
      setNombreEntidad(data.nombreEntidad || "");
      setDepartamento(data.departamento || "");
      setMunicipalidad(data.municipalidad || "");
      setDireccion(data.direccion || "");
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

  /* GUARDAR BORRADOR */
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
      departamento,
      municipalidad,
      direccion,
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
    };

    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }, [
    hydrated,
    idLicitacionInput,
    nombre,
    fechaHoraCierre,
    monto,
    listado,
    rutEntidad,
    nombreEntidad,
    departamento,
    municipalidad,
    direccion,
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
  ]);

  /* CARGA DE PRODUCTOS */
  useEffect(() => {
    async function cargar() {
      const { data } = await supabase
        .from("productos")
        .select("*")
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
     CAMBIO DE LISTA (no pisa manual)
  ============================================================ */
  function actualizarPreciosPorLista(nuevaLista) {
    const copia = items.map((it) => {
      const sku = String(it.sku || "").trim();
      const prod =
        (sku
          ? productos.find((p) => String(p.sku || "").trim() === sku)
          : null) ||
        (it.producto ? productos.find((p) => p.nombre === it.producto) : null);

      if (!prod) return it;

      const precioAuto = getPrecioBaseParaSKU(prod, nuevaLista, campaignPrices);
      const cantidad = Math.max(1, Number(it.cantidad || 1));

      const precioBaseFinal = it.precioManual ? Number(it.precio || 0) : precioAuto;
      const precioConFlete = precioBaseFinal + fletePorUnidad;

      return {
        ...it,
        precio: precioBaseFinal,
        precioUnitarioStr: it.precioManual ? (it.precioUnitarioStr || "") : "",
        total: redondear(cantidad * precioConFlete),
      };
    });

    setItems(copia);
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

  function limpiarDatos(showToast = true) {
    setIdLicitacionInput("");
    setNombre("");
    setFechaHoraCierre("");
    setMonto("");
    setListado("1");

    setRutEntidad("");
    setNombreEntidad("");
    setDepartamento("");
    setMunicipalidad("");
    setRegion("");
    setComuna("");
    setDireccion("");
    setContacto("");
    setEmail("");
    setTelefono("");
    setCondVenta("");

    setFleteEstimado(0);
    setItems([crearItemVacio()]);

    setObservaciones("");

    if (showToast) {
      setToast({
        type: "success",
        message: "Los datos fueron limpiados correctamente.",
      });
    }
  }

  /* ============================================================
     GUARDAR LICITACIÓN
     ✅ FIX: filtra ítems vacíos + valida mínimos
     ✅ FIX: inserta items en batch + agrega `orden`
============================================================ */
  async function guardarLicitacion() {
    setToast(null);

    if (guardando || generandoPDF) return;

    if (!puedeCrearLicitacion) {
      setToast({
        type: "error",
        message: "No tienes permisos para crear licitaciones.",
      });
      return;
    }

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
      return;
    }

    const fechaHoy = new Date().toISOString().slice(0, 10);

    const { data: userData, error: userErr } = await supabase.auth.getUser();
    const user = userData?.user;

    if (userErr || !user) {
      setToast({ type: "error", message: "Sesión no válida. Vuelve a iniciar." });
      return;
    }

    const vendedorNombreFinal = (perfilNombre || "").toString().trim();
    const vendedorCorreoFinal = (user.email || perfilEmail || "").toString().trim();
    const vendedorCelularFinal = (perfilCelular || "").toString().trim();

    setGuardando(true);
    setToast({ type: "info", message: "Guardando licitación…" });

    try {
      // ✅ validar duplicado por ID Licitación
      const idLicitacionNorm = (idLicitacionInput || "").toString().trim();
      const { data: dup, error: errDup } = await supabase
        .from("licitaciones")
        .select("id")
        .eq("id_licitacion", idLicitacionNorm)
        .limit(1);

      if (errDup) {
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

      const { data: lic, error } = await supabase
        .from("licitaciones")
        .insert([
          {
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

            fecha: fechaHoy,
            creado_por: user.email,
            estado: requiereAprobacion ? "Pendiente Aprobación" : "En espera",
            flete_estimado: Number(fleteEstimado),
            total_con_iva: totalConIVA,
            total_sin_iva: totalNeto,
            total_iva: totalIVA,

            observaciones: observaciones || null,

            created_by: user.id,
            vendedor_nombre: vendedorNombreFinal || null,
            vendedor_celular: vendedorCelularFinal || null,
            vendedor_correo: vendedorCorreoFinal || null,
          },
        ])
        .select("id")
        .single();

      if (error) {
        console.error(error);
        setToast({ type: "error", message: "Error al guardar licitación" });
        return;
      }

      const idLicitacion = lic.id;

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
        };
      });

      const { error: errItems } = await supabase
        .from("items_licitacion")
        .insert(payloadItems);

      if (errItems) {
        console.error(errItems);
        setToast({
          type: "error",
          message: "La licitación se creó, pero hubo un error guardando los ítems.",
        });
        return;
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
        limpiarDatos(false);
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
      limpiarDatos();
    } finally {
      setGenerandoPDF(false);
      setGuardando(false);
    }
  }

  /* ============================================================
     OPCIONES SELECT (SKU: solo productos con SKU)
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

      <div className="page-header">
        <div>
          <h1 className="page-title">Crear Cotización</h1>
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
              ID Cotización *
            </label>
            <input
              className="w-full rounded-md border border-gray-300 px-3 py-2"
              value={idLicitacionInput}
              onChange={(e) => setIdLicitacionInput(e.target.value)}
            />
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

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Lista de Precios *
            </label>
            <select
              className="w-full rounded-md border border-gray-300 px-3 py-2"
              value={listado}
              onChange={(e) => {
                setListado(e.target.value);
                actualizarPreciosPorLista(e.target.value);
              }}
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
              className="w-full rounded-md border border-gray-300 px-3 py-2"
              value={tipoCompra}
              onChange={(e) => setTipoCompra(e.target.value)}
            >
              <option value="Compra ágil">Compra ágil</option>
              <option value="Compra directa">Compra directa</option>
              <option value="Licitación">Licitación</option>
              <option value="Cliente particular">Cliente particular</option>
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
            <input
              className="w-full rounded-md border border-gray-300 px-3 py-2"
              value={rutEntidad}
              onChange={(e) => setRutEntidad(e.target.value)}
              onBlur={() => buscarClientePorRut(rutEntidad)}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Nombre Entidad *
            </label>
            <input
              className="w-full rounded-md border border-gray-300 px-3 py-2"
              value={nombreEntidad}
              onChange={(e) => setNombreEntidad(e.target.value)}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Departamento *
            </label>
            <input
              className="w-full rounded-md border border-gray-300 px-3 py-2"
              value={departamento}
              onChange={(e) => setDepartamento(e.target.value)}
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
              className="w-full rounded-md border border-gray-300 px-3 py-2"
              value={condVenta}
              onChange={(e) => setCondVenta(e.target.value)}
            >
              <option value="">Seleccione…</option>
              <option value="30 días">30 días</option>
              <option value="Contado">Contado</option>
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
          items={items.map((it) => it.id)}
          strategy={verticalListSortingStrategy}
        >
          <div className="space-y-3 max-h-[900px] overflow-y-auto pr-2">
            {items.map((it, index) => {
              const margenItem = calcularMargenItem(it);
              const isLowMargin = margenItem > 0 && margenItem < 20;

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
                        isLowMargin ? "border-red-400 bg-red-50" : "border-gray-200"
                      }`}
                    >
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
                          value={opcionesSKU.find((o) => o.value === it.sku) || null}
                          onChange={(op) =>
                            actualizarItem(index, "sku", op ? op.value : "")
                          }
                        />
                      </div>

                      <div className={esAdmin ? "md:col-span-4" : "md:col-span-9"}>
                        <label className="block text-xs text-gray-600 mb-1">
                          Producto
                        </label>
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
                          components={{ SingleValue: ProductoSingleValue }}
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

                      {esAdmin && (
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
                      )}

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
              <input
                type="number"
                className="w-full h-10 rounded-md border border-gray-300 px-3"
                value={fleteEstimado}
                onChange={(e) => setFleteEstimado(e.target.value)}
              />
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
          </div>
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
