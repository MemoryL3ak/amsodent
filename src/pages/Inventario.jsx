// Inventario.jsx — módulo de inventario (pedido 2026-08-27).
// El stock vigente vive en productos.stock; cada cambio pasa por el backend
// (/inventario/movimientos) y queda en el libro inventario_movimientos como
// entrada, salida o ajuste, con el stock resultante estampado. Esta pantalla
// tiene las pestañas Stock (grilla del catálogo valorizada, con alertas de
// mínimo) y Movimientos (el libro completo).
// (2026-11-02) SUCURSALES: el stock total se reparte por sucursal propia y se
// mueve entre ellas con traslados (pestaña Traslados: salen del origen, quedan
// «en tránsito» y se reciben en el destino) y un mantenedor (pestaña
// Sucursales, solo admin). Si el backend no trae sucursales (migración
// 20261102 sin aplicar) todo sigue como antes.
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../lib/api";
import useAuth from "../hooks/useAuth";
import { esAdminRol } from "../constants/modulos";
import Toast from "../components/Toast";
import CrearProductoModal from "../components/CrearProductoModal";
import BotonLimpiarFiltros from "../components/BotonLimpiarFiltros";
import DropdownSelect from "../components/ui/DropdownSelect";
import VistaPreviaBsale from "../components/VistaPreviaBsale";
import {
  Boxes, Search, Plus, Minus, SlidersHorizontal, History,
  Upload, Download, X, AlertTriangle, ArrowUp, ArrowDown, ArrowUpDown,
  RefreshCw, PackagePlus, ArrowLeftRight, Store, PackageCheck, Ban,
  ChevronDown, ChevronRight, Pencil, Star, Trash2, FileText, ExternalLink,
} from "lucide-react";

const fmtCLP = (v) => `$${Math.round(Number(v) || 0).toLocaleString("es-CL")}`;
const fmtNum = (v) => Number(v || 0).toLocaleString("es-CL");
const fmtFechaHora = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return `${d.toLocaleDateString("es-CL", { day: "2-digit", month: "2-digit", year: "numeric" })} ${d.toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit", hour12: false })}`;
};
const aNumero = (s) => Number(String(s ?? "").replace(/\./g, "").replace(",", "."));

const TIPOS_MOV = {
  entrada: { label: "Entrada", color: "#15803d", bg: "#dcfce7" },
  salida: { label: "Salida", color: "#b91c1c", bg: "#fee2e2" },
  ajuste: { label: "Ajuste", color: "#6d28d9", bg: "#ede9fe" },
  // (2026-11-02) Un traslado no cambia el total: sale de una sucursal y entra en otra.
  traslado_salida: { label: "Traslado · salida", color: "#0369a1", bg: "#e0f2fe" },
  traslado_entrada: { label: "Traslado · entrada", color: "#0f766e", bg: "#ccfbf1" },
};
// Los que se registran a mano desde la grilla (los de traslado nacen en su pestaña).
const TIPOS_REGISTRABLES = ["entrada", "salida", "ajuste"];

const ESTADOS_TRASLADO = {
  en_transito: { label: "En tránsito", color: "#b45309", bg: "#fef3c7" },
  recibido: { label: "Recibido", color: "#15803d", bg: "#dcfce7" },
  anulado: { label: "Anulado", color: "#6b7280", bg: "#f3f4f6" },
};
const POR_PAGINA_TRASLADOS = 10;

// Stock de una fila: el total o el de una sucursal (viene como {sucursal_id: stock}).
function stockEn(p, sucursalId) {
  if (!sucursalId) return Number(p.stock) || 0;
  return Number(p.sucursales?.[sucursalId]) || 0;
}

// Estado de alerta de una fila de stock. El umbral 0 significa "sin umbral":
// no genera alerta de mínimo (solo la de sin stock). Mirando UNA sucursal el
// mínimo (que es del producto completo) no se evalúa: solo «sin stock».
function alertaDe(p, sucursalId) {
  const stock = stockEn(p, sucursalId);
  const min = Number(p.stock_minimo) || 0;
  if (stock <= 0) return "sin_stock";
  if (!sucursalId && min > 0 && stock < min) return "bajo_minimo";
  return "ok";
}

const Chip = ({ info, icono: Icono }) => (
  <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 999, background: info.bg, color: info.color, whiteSpace: "nowrap" }}>
    {Icono && <Icono size={11} />} {info.label}
  </span>
);

export default function Inventario() {
  // (2026-10-14) Ventas entra a ver el stock sin mover stock, mínimos ni
  // cargas (solo admin). (2026-10-22) Las tarjetas KPI son SOLO admin (ya no
  // existe el permiso de perfil `inventario_kpis`); las columnas Costo y
  // Valorización (y su export) solo para admin o quien tenga «ver_costos» en
  // su perfil: a los demás el backend ni siquiera les manda el costo.
  const { rol, puede } = useAuth();
  const esAdmin = esAdminRol(rol);
  const verCostos = esAdmin || puede("ver_costos");
  const [filas, setFilas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);
  const [vista, setVista] = useState("stock"); // stock | movimientos | traslados | sucursales

  // Filtros de la pestaña Stock.
  const [busqueda, setBusqueda] = useState("");
  const [filtroCategoria, setFiltroCategoria] = useState("");
  const [filtroAlerta, setFiltroAlerta] = useState(""); // "" | con_stock | bajo_minimo | sin_stock
  const [filtroEstado, setFiltroEstado] = useState("Activo"); // estado del producto
  const [filtroSucursal, setFiltroSucursal] = useState(""); // "" = todas (total)
  const [orden, setOrden] = useState({ campo: null, dir: "desc" }); // stock | valor

  // Modales.
  const [movModal, setMovModal] = useState(null); // { producto, tipo, sucursalId }
  const [histModal, setHistModal] = useState(null); // { producto, movs, loading }
  const [cargaOpen, setCargaOpen] = useState(false);

  // Edición inline del stock mínimo: id → string en edición.
  const [minEdit, setMinEdit] = useState({});

  // Pestaña Movimientos (libro completo).
  const [libro, setLibro] = useState(null); // null = aún no cargado
  const [libroLoading, setLibroLoading] = useState(false);
  const [filtroTipoMov, setFiltroTipoMov] = useState("");
  const [filtroSucursalMov, setFiltroSucursalMov] = useState("");
  const [busquedaMov, setBusquedaMov] = useState("");

  // Sucursales (2026-11-02): { listo, sucursales, principal_id, puede_trasladar }.
  // listo=false → el backend no tiene la migración: ni pestañas ni filtros.
  const [sucInfo, setSucInfo] = useState(null);
  const sucursales = useMemo(() => sucInfo?.sucursales || [], [sucInfo]);
  const sucActivas = useMemo(() => sucursales.filter((s) => s.activa), [sucursales]);
  const conSucursales = !!sucInfo?.listo;
  const multiSucursal = conSucursales && sucActivas.length > 1;
  const puedeTrasladar = !!sucInfo?.puede_trasladar;
  const nombreSucursal = (id) => sucursales.find((s) => String(s.id) === String(id))?.nombre || (id ? `Sucursal ${id}` : "—");

  // Pestaña Traslados.
  const [traslados, setTraslados] = useState(null);
  const [trasladosLoading, setTrasladosLoading] = useState(false);
  const [filtroEstadoTr, setFiltroEstadoTr] = useState("en_transito");
  const [busquedaTr, setBusquedaTr] = useState("");
  const [paginaTr, setPaginaTr] = useState(1);
  const [trasladoAbierto, setTrasladoAbierto] = useState(null);
  const [nuevoTraslado, setNuevoTraslado] = useState(false);
  const [recibirModal, setRecibirModal] = useState(null); // traslado
  const [anularModal, setAnularModal] = useState(null); // traslado
  const [guiaBsaleModal, setGuiaBsaleModal] = useState(null); // traslado → guía de traslado interno en Bsale

  // Pestaña Sucursales (mantenedor, solo admin).
  const [resumenSuc, setResumenSuc] = useState(null);
  const [sucModal, setSucModal] = useState(null); // { sucursal: null | {...} }
  // Sucursales de la cuenta de Bsale (/offices.json), para asociarlas; null = no cargadas.
  const [oficinasBsale, setOficinasBsale] = useState(null);

  // Un traslado puede llevar guía de traslado interno en Bsale cuando ambas
  // sucursales están asociadas a sucursales distintas de Bsale.
  const oficinaDe = (id) => sucursales.find((s) => String(s.id) === String(id))?.bsale_office_id || null;
  const trasladoMapeado = (t) => {
    const a = oficinaDe(t.origen?.id);
    const b = oficinaDe(t.destino?.id);
    return !!a && !!b && a !== b;
  };
  const nombreOficina = (id) => {
    const o = (oficinasBsale || []).find((x) => Number(x.id) === Number(id));
    return o ? `${o.nombre} (${id})` : `sucursal ${id} de Bsale`;
  };

  // Integración Bsale (etapa 1: catálogo y stock). El stock de Bsale es la
  // fuente de verdad: la sincronización lo trae y deja cada cambio como un
  // ajuste en el libro. null = estado aún no cargado (o backend sin el módulo).
  const [bsale, setBsale] = useState(null);
  const [bsaleSync, setBsaleSync] = useState(false);
  const [bsaleDif, setBsaleDif] = useState(null); // modal: { loading, data }
  // SKUs que existen en Bsale pero no como producto interno (última corrida).
  // Se destacan en la grilla principal para que se creen acá.
  const [huerfanos, setHuerfanos] = useState([]);
  const [crearDesdeBsale, setCrearDesdeBsale] = useState(null); // { sku, nombre, stock }

  useEffect(() => {
    api.get("/bsale/estado").then(setBsale).catch(() => setBsale(null));
  }, []);

  async function cargarSucursales() {
    try {
      const d = await api.get("/inventario/sucursales");
      setSucInfo(d && typeof d === "object" ? d : { listo: false, sucursales: [] });
    } catch {
      setSucInfo({ listo: false, sucursales: [] });
    }
  }
  useEffect(() => { cargarSucursales(); }, []);

  // Cada vez que hay una corrida nueva guardada, se refresca la lista de
  // huérfanos (viene del mismo detalle que alimenta el panel de diferencias).
  const bsaleUltimaCorrida = bsale?.ultima?.actualizado_at || null;
  useEffect(() => {
    if (!bsaleUltimaCorrida) return;
    let vivo = true;
    api.get("/bsale/diferencias")
      .then((d) => { if (vivo) setHuerfanos(Array.isArray(d?.detalle?.skus_bsale_sin_producto) ? d.detalle.skus_bsale_sin_producto : []); })
      .catch(() => {});
    return () => { vivo = false; };
  }, [bsaleUltimaCorrida]);

  // Mientras corre una sincronización (lanzada aquí o en otra pestaña), se
  // sondea el avance cada 2,5 s para la barra de progreso; en la fase final
  // ("aplicando") el stock ya se está escribiendo, así que la grilla se
  // refresca sola para verlo llegar en tiempo real. Al terminar: toast +
  // refresco completo (grilla y libro, porque hubo ajustes).
  const bsaleSincronizando = !!bsale?.sincronizando;
  useEffect(() => {
    if (!bsaleSincronizando) return;
    let tick = 0;
    const t = setInterval(async () => {
      let est;
      try {
        est = await api.get("/bsale/estado");
      } catch {
        return; // backend momentáneamente inalcanzable: se reintenta al próximo tick
      }
      setBsale(est);
      tick += 1;
      if (est?.sincronizando) {
        // Refresco silencioso (sin spinner) cada 2 ticks mientras se aplica el stock.
        if (est?.progreso?.fase === "aplicando" && tick % 2 === 0) {
          api.get("/inventario/resumen").then((d) => Array.isArray(d) && setFilas(d)).catch(() => {});
        }
        return;
      }
      const r = est?.ultima?.resumen;
      if (r) {
        setToast({
          type: "success",
          message: `Bsale sincronizado: ${fmtNum(r.actualizados || 0)} stocks actualizados (${fmtNum(r.matcheados || 0)} SKUs matcheados).`,
        });
      }
      cargar();
      setLibro(null);
    }, 2500);
    return () => clearInterval(t);
  }, [bsaleSincronizando]);

  async function sincronizarBsale() {
    if (bsaleSync || bsale?.sincronizando) return;
    setBsaleSync(true);
    try {
      const r = await api.post("/bsale/sincronizar", {});
      if (r?.iniciado) {
        // Arrancó en el backend; el sondeo de arriba muestra la barra y avisa al final.
        api.get("/bsale/estado").then(setBsale).catch(() => {});
      } else {
        // Compatibilidad con un backend antiguo que respondía recién al terminar.
        setToast({
          type: "success",
          message: `Bsale sincronizado: ${fmtNum(r?.actualizados || 0)} stocks actualizados (${fmtNum(r?.matcheados || 0)} SKUs matcheados).`,
        });
        api.get("/bsale/estado").then(setBsale).catch(() => {});
        cargar();
        setLibro(null);
      }
    } catch (e) {
      setToast({ type: "error", message: e?.response?.data?.message || e?.message || "No se pudo sincronizar con Bsale." });
    } finally {
      setBsaleSync(false);
    }
  }

  async function abrirDiferenciasBsale() {
    setBsaleDif({ loading: true, data: null });
    try {
      const data = await api.get("/bsale/diferencias");
      setBsaleDif({ loading: false, data });
    } catch (e) {
      setBsaleDif(null);
      setToast({ type: "error", message: e?.message || "No se pudieron cargar las diferencias." });
    }
  }

  async function exportarDiferenciasBsale() {
    const det = bsaleDif?.data?.detalle;
    if (!det) return;
    try {
      const XLSX = await import("xlsx");
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.json_to_sheet((det.skus_bsale_sin_producto || []).map((r) => ({ "SKU Bsale": r.sku, "Descripción": r.descripcion || "", "Stock Bsale": r.stock == null ? "" : r.stock }))),
        "En Bsale sin producto",
      );
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.json_to_sheet((det.productos_sin_bsale || []).map((r) => ({ "SKU interno": r.sku, "Producto": r.nombre || "" }))),
        "Internos sin Bsale",
      );
      XLSX.writeFile(wb, `diferencias_bsale_${new Date().toISOString().slice(0, 10)}.xlsx`);
    } catch {
      setToast({ type: "error", message: "No se pudo exportar el archivo." });
    }
  }

  async function cargar() {
    setLoading(true);
    try {
      const data = await api.get("/inventario/resumen");
      setFilas(Array.isArray(data) ? data : []);
    } catch (e) {
      setToast({ type: "error", message: e?.message || "No se pudo cargar el inventario." });
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { cargar(); }, []);

  // El libro se carga al entrar a su pestaña (y se refresca al volver a entrar
  // después de registrar movimientos, porque registrar lo invalida). Los
  // filtros de tipo y sucursal van al servidor: así los 500 que llegan son
  // los que interesan.
  useEffect(() => { setLibro(null); }, [filtroTipoMov, filtroSucursalMov]);
  useEffect(() => {
    if (vista !== "movimientos" || libro !== null || libroLoading) return;
    (async () => {
      setLibroLoading(true);
      try {
        const q = new URLSearchParams({ limit: "500" });
        if (filtroTipoMov) q.set("tipo", filtroTipoMov);
        if (filtroSucursalMov) q.set("sucursalId", filtroSucursalMov);
        const data = await api.get(`/inventario/movimientos?${q.toString()}`);
        setLibro(Array.isArray(data) ? data : []);
      } catch (e) {
        setToast({ type: "error", message: e?.message || "No se pudieron cargar los movimientos." });
        setLibro([]);
      } finally {
        setLibroLoading(false);
      }
    })();
  }, [vista, libro, libroLoading, filtroTipoMov, filtroSucursalMov]);

  // Traslados: se cargan al entrar a la pestaña; cualquier acción los invalida.
  useEffect(() => {
    if (vista !== "traslados" || traslados !== null || trasladosLoading || !conSucursales) return;
    (async () => {
      setTrasladosLoading(true);
      try {
        const data = await api.get("/inventario/traslados?limit=300");
        setTraslados(Array.isArray(data) ? data : []);
      } catch (e) {
        setToast({ type: "error", message: e?.message || "No se pudieron cargar los traslados." });
        setTraslados([]);
      } finally {
        setTrasladosLoading(false);
      }
    })();
  }, [vista, traslados, trasladosLoading, conSucursales]);

  // Mantenedor de sucursales: resumen (stock, unidades, valorización) por sucursal.
  useEffect(() => {
    if (vista !== "sucursales" || resumenSuc !== null || !conSucursales) return;
    api.get("/inventario/sucursales/resumen")
      .then((d) => setResumenSuc(Array.isArray(d) ? d : []))
      .catch((e) => { setToast({ type: "error", message: e?.message || "No se pudo cargar el resumen por sucursal." }); setResumenSuc([]); });
  }, [vista, resumenSuc, conSucursales]);
  // Sucursales de Bsale: una vez, al entrar al mantenedor (si Bsale no responde, se escribe el id a mano).
  useEffect(() => {
    if (vista !== "sucursales" || oficinasBsale !== null || !conSucursales) return;
    api.get("/bsale/traslados/oficinas")
      .then((d) => setOficinasBsale(Array.isArray(d) ? d : []))
      .catch(() => setOficinasBsale([]));
  }, [vista, oficinasBsale, conSucursales]);

  const categorias = useMemo(
    () => [...new Set(filas.map((p) => String(p.categoria || "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "es")),
    [filas],
  );

  // Filas sintéticas para los SKUs de Bsale sin producto interno. Se excluye
  // cualquier SKU que ya exista acá (creado después de la última corrida).
  const filasHuerfanas = useMemo(() => {
    if (!huerfanos.length) return [];
    const internos = new Set(filas.map((p) => String(p.sku || "").trim().toUpperCase()).filter(Boolean));
    return huerfanos
      .filter((h) => h?.sku && !internos.has(String(h.sku).trim().toUpperCase()))
      .map((h) => ({
        id: `bsale:${h.sku}`,
        sku: h.sku,
        nombre: h.descripcion || "",
        stock: h.stock == null ? null : Number(h.stock) || 0,
        bsale_huerfano: true,
      }));
  }, [huerfanos, filas]);

  const filtradas = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    // Los huérfanos de Bsale NO se mezclan con el inventario normal (son
    // cientos y taparían la grilla): entran solo con el filtro «No creados»
    // o cuando la búsqueda escrita los alcanza (ej. buscar un SKU nuevo).
    const soloHuerfanos = filtroAlerta === "sin_producto";
    const huerfanosVisibles = (soloHuerfanos || q) && !filtroSucursal
      ? [...filasHuerfanas].sort((a, b) => (Number(b.stock) || 0) - (Number(a.stock) || 0) || String(a.sku).localeCompare(String(b.sku)))
      : [];
    const arr = [...huerfanosVisibles, ...filas].filter((p) => {
      if (p.bsale_huerfano) {
        // No tienen estado ni categoría internos; solo entran a los filtros
        // que tienen sentido para ellos.
        if (filtroCategoria) return false;
        if (filtroAlerta === "con_stock" && !(Number(p.stock) > 0)) return false;
        if (filtroAlerta === "bajo_minimo" || filtroAlerta === "sin_stock") return false;
      } else {
        if (filtroAlerta === "sin_producto") return false;
        if (filtroEstado && String(p.estado || "") !== filtroEstado) return false;
        if (filtroCategoria && String(p.categoria || "").trim() !== filtroCategoria) return false;
        const al = alertaDe(p, filtroSucursal);
        if (filtroAlerta === "con_stock" && !(stockEn(p, filtroSucursal) > 0)) return false;
        if (filtroAlerta === "bajo_minimo" && al !== "bajo_minimo") return false;
        if (filtroAlerta === "sin_stock" && al !== "sin_stock") return false;
      }
      if (!q) return true;
      return (
        String(p.sku || "").toLowerCase().includes(q) ||
        String(p.nombre || "").toLowerCase().includes(q) ||
        String(p.marca || "").toLowerCase().includes(q)
      );
    });
    if (!orden.campo) return arr;
    const signo = orden.dir === "asc" ? 1 : -1;
    const valorDe = (p) => (orden.campo === "valor" ? stockEn(p, filtroSucursal) * (Number(p.costo) || 0) : stockEn(p, filtroSucursal));
    return [...arr].sort((a, b) => (valorDe(a) - valorDe(b)) * signo);
  }, [filas, filasHuerfanas, busqueda, filtroCategoria, filtroAlerta, filtroEstado, filtroSucursal, orden]);

  // KPIs sobre el filtro de estado del producto (no sobre los demás filtros:
  // los KPIs describen el inventario, no la búsqueda en curso). Con una
  // sucursal elegida, describen esa sucursal.
  const stats = useMemo(() => {
    const base = filas.filter((p) => !filtroEstado || String(p.estado || "") === filtroEstado);
    let conStock = 0, unidades = 0, valor = 0, bajo = 0, sinStock = 0, enTransito = 0;
    for (const p of base) {
      const stock = stockEn(p, filtroSucursal);
      if (stock > 0) { conStock++; unidades += stock; valor += stock * (Number(p.costo) || 0); }
      const al = alertaDe(p, filtroSucursal);
      if (al === "bajo_minimo") bajo++;
      if (al === "sin_stock") sinStock++;
      enTransito += Number(p.en_transito) || 0;
    }
    return { total: base.length, conStock, unidades, valor, bajo, sinStock, enTransito };
  }, [filas, filtroEstado, filtroSucursal]);
  const huerfanosConStock = useMemo(() => filasHuerfanas.filter((h) => Number(h.stock) > 0).length, [filasHuerfanas]);
  // La corrida guardada puede ser anterior a que la sincronización guardara
  // el stock de los huérfanos: en ese caso todos vienen en null.
  const huerfanosSinDato = filasHuerfanas.length > 0 && filasHuerfanas.every((h) => h.stock == null);

  function toggleOrden(campo) {
    setOrden((o) => (o.campo !== campo ? { campo, dir: "desc" } : o.dir === "desc" ? { campo, dir: "asc" } : { campo: null, dir: "desc" }));
  }

  // Refleja en la grilla el stock que devolvió el backend tras un movimiento
  // (total y, si vino, el de la sucursal donde ocurrió).
  function aplicarStockLocal(productoId, res) {
    setFilas((prev) => prev.map((p) => {
      if (p.id !== productoId) return p;
      const n = { ...p, stock: res.stock };
      if (res?.sucursal?.id != null && res.stock_sucursal != null) {
        n.sucursales = { ...(p.sucursales || {}) };
        if (Number(res.stock_sucursal) === 0) delete n.sucursales[res.sucursal.id];
        else n.sucursales[res.sucursal.id] = Number(res.stock_sucursal);
      }
      return n;
    }));
    setLibro(null); // el libro quedó desactualizado: se recarga al abrirlo
    setResumenSuc(null);
  }

  async function guardarStockMinimo(p, valorStr) {
    const valor = Number(String(valorStr).replace(",", "."));
    setMinEdit((m) => { const c = { ...m }; delete c[p.id]; return c; });
    if (!Number.isFinite(valor) || valor < 0 || valor === (Number(p.stock_minimo) || 0)) return;
    try {
      await api.put(`/inventario/stock-minimo/${p.id}`, { stockMinimo: valor });
      setFilas((prev) => prev.map((x) => (x.id === p.id ? { ...x, stock_minimo: valor } : x)));
      setToast({ type: "success", message: `Stock mínimo de ${p.sku || p.nombre} actualizado a ${fmtNum(valor)}.` });
    } catch (e) {
      setToast({ type: "error", message: e?.message || "No se pudo guardar el stock mínimo." });
    }
  }

  async function abrirHistorial(p) {
    setHistModal({ producto: p, movs: [], loading: true });
    try {
      const data = await api.get(`/inventario/movimientos?productoId=${p.id}&limit=300`);
      setHistModal((prev) => (prev?.producto?.id === p.id ? { ...prev, movs: Array.isArray(data) ? data : [], loading: false } : prev));
    } catch (e) {
      setToast({ type: "error", message: e?.message || "No se pudo cargar el historial." });
      setHistModal(null);
    }
  }

  async function exportarExcel() {
    if (!filtradas.length) {
      setToast({ type: "info", message: "No hay filas en el filtro actual para exportar." });
      return;
    }
    const XLSX = await import("xlsx");
    const ws = XLSX.utils.json_to_sheet(filtradas.map((p) => ({
      SKU: p.sku || "",
      Nombre: p.nombre || "",
      Marca: p.marca || "",
      "Categoría": p.categoria || "",
      Estado: p.bsale_huerfano ? "NO CREADO EN EL SISTEMA (existe en Bsale)" : (p.estado || ""),
      Stock: Number(p.stock) || 0,
      ...(multiSucursal ? Object.fromEntries([
        ...sucActivas.map((s) => [`Stock ${s.nombre}`, p.bsale_huerfano ? "" : stockEn(p, s.id)]),
        ["En tránsito", p.bsale_huerfano ? "" : Number(p.en_transito) || 0],
      ]) : {}),
      "Stock mínimo": Number(p.stock_minimo) || 0,
      ...(verCostos ? {
        Costo: Number(p.costo) || 0,
        "Valorización (stock × costo)": (Number(p.stock) || 0) * (Number(p.costo) || 0),
      } : {}),
      Alerta: p.bsale_huerfano ? "No creado" : alertaDe(p) === "sin_stock" ? "Sin stock" : alertaDe(p) === "bajo_minimo" ? "Bajo mínimo" : "",
    })));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Inventario");
    XLSX.writeFile(wb, `inventario_${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  const libroFiltrado = useMemo(() => {
    const q = busquedaMov.trim().toLowerCase();
    return (libro || []).filter((m) => {
      if (!q) return true;
      return (
        String(m.sku || "").toLowerCase().includes(q) ||
        String(m.motivo || "").toLowerCase().includes(q) ||
        String(m.referencia || "").toLowerCase().includes(q) ||
        String(m.usuario_email || "").toLowerCase().includes(q) ||
        nombreSucursal(m.sucursal_id).toLowerCase().includes(q)
      );
    });
  }, [libro, busquedaMov, sucursales]); // eslint-disable-line react-hooks/exhaustive-deps

  const trasladosFiltrados = useMemo(() => {
    const q = busquedaTr.trim().toLowerCase();
    return (traslados || []).filter((t) => {
      if (filtroEstadoTr && t.estado !== filtroEstadoTr) return false;
      if (!q) return true;
      return (
        `#${t.id}`.includes(q) || String(t.id) === q ||
        String(t.origen?.nombre || "").toLowerCase().includes(q) ||
        String(t.destino?.nombre || "").toLowerCase().includes(q) ||
        String(t.motivo || "").toLowerCase().includes(q) ||
        String(t.referencia || "").toLowerCase().includes(q) ||
        String(t.usuario_email || "").toLowerCase().includes(q) ||
        (t.lineas || []).some((l) => String(l.sku || "").toLowerCase().includes(q) || String(l.nombre || "").toLowerCase().includes(q))
      );
    });
  }, [traslados, filtroEstadoTr, busquedaTr]);
  useEffect(() => { setPaginaTr(1); }, [filtroEstadoTr, busquedaTr]);
  const trasladosPagina = useMemo(
    () => trasladosFiltrados.slice((paginaTr - 1) * POR_PAGINA_TRASLADOS, paginaTr * POR_PAGINA_TRASLADOS),
    [trasladosFiltrados, paginaTr],
  );
  const trasladosEnTransito = useMemo(() => (traslados || []).filter((t) => t.estado === "en_transito").length, [traslados]);

  // Tras crear/recibir/anular: la grilla cambia (stock por sucursal) y el libro también.
  function trasTraslado(mensaje) {
    setTraslados(null);
    setLibro(null);
    setResumenSuc(null);
    cargar();
    if (mensaje) setToast({ type: "success", message: mensaje });
  }

  const FlechaOrden = ({ campo }) => (
    orden.campo !== campo ? <ArrowUpDown size={12} style={{ opacity: 0.35 }} />
      : orden.dir === "asc" ? <ArrowUp size={12} /> : <ArrowDown size={12} />
  );


  /* (2026-09-24) Volver a ver todo sin ir borrando filtro por filtro. */
  const hayFiltros = filtroCategoria !== "" || filtroAlerta !== "" || filtroEstado !== "Activo" || filtroTipoMov !== "" || filtroSucursal !== "" || filtroSucursalMov !== "";
  function limpiarFiltros() {
    setFiltroCategoria("");
    setFiltroAlerta("");
    setFiltroEstado("Activo");
    setFiltroTipoMov("");
    setFiltroSucursal("");
    setFiltroSucursalMov("");
  }

  const opcionesSucursal = (todasLabel) => [
    { value: "", label: todasLabel },
    ...sucActivas.map((s) => ({ value: String(s.id), label: s.nombre, detalle: s.es_principal ? "Principal" : s.comuna || undefined })),
  ];

  const pestanas = [
    ["stock", "Stock"],
    ["movimientos", "Movimientos"],
    ...(conSucursales ? [["traslados", `Traslados${trasladosEnTransito ? ` (${trasladosEnTransito})` : ""}`]] : []),
    ...(conSucursales && esAdmin ? [["sucursales", "Sucursales"]] : []),
  ];

  return (
    <div className="page">
      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}

      <div className="page-header" style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div>
          <h1 className="page-title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Boxes size={20} /> Inventario
          </h1>
          <p className="page-subtitle">
            Stock por SKU{multiSucursal ? " y por sucursal" : ""} con libro de movimientos: cada entrada, salida, ajuste{conSucursales ? " y traslado" : ""} queda registrado y auditable.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="btn btn-secondary" onClick={exportarExcel} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <Download size={14} /> Exportar
          </button>
          {conSucursales && puedeTrasladar && (
            <button className="btn btn-secondary" onClick={() => setNuevoTraslado(true)}
              disabled={sucActivas.length < 2}
              title={sucActivas.length < 2 ? "Crea una segunda sucursal (pestaña Sucursales) para poder trasladar stock" : "Mover stock de una sucursal a otra"}
              style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <ArrowLeftRight size={14} /> Nuevo traslado
            </button>
          )}
          {esAdmin && (
            <button className="btn btn-primary" onClick={() => setCargaOpen(true)}
              title="Carga el conteo físico desde una planilla (columnas: sku, stock y opcionalmente stock_minimo). Cada diferencia queda como un ajuste en el libro."
              style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <Upload size={14} /> Carga masiva
            </button>
          )}
        </div>
      </div>

      {/* KPIs */}
      {/* (2026-10-22) Las tarjetas KPI son solo para administradores (pedido de Ariel; antes también por perfil). */}
      {esAdmin && (
      <div className={`stats-row ${bsale ? "stats-6" : "stats-5"}`}>
        <div className="stat-card">
          <div className="stat-label">SKUs con stock{filtroSucursal ? ` · ${nombreSucursal(filtroSucursal)}` : ""}</div>
          <div className="stat-value">{fmtNum(stats.conStock)}</div>
          <div className="stat-sub">de {fmtNum(stats.total)} en el filtro de estado</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Unidades totales</div>
          <div className="stat-value" style={{ color: "var(--primary-dark)" }}>{fmtNum(stats.unidades)}</div>
          <div className="stat-sub">{filtroSucursal ? `en ${nombreSucursal(filtroSucursal)}` : multiSucursal && stats.enTransito ? `${fmtNum(stats.enTransito)} en tránsito entre sucursales` : "suma de stock vigente"}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Valorización</div>
          <div className="stat-value stat-value-monto" style={{ color: "#15803d" }} title={fmtCLP(stats.valor)}>{fmtCLP(stats.valor)}</div>
          <div className="stat-sub">stock × costo (neto)</div>
        </div>
        <div className="stat-card" onClick={() => { setVista("stock"); setFiltroSucursal(""); setFiltroAlerta("bajo_minimo"); }} style={{ cursor: "pointer" }} title="Ver solo los productos bajo su mínimo (sobre el stock total)">
          <div className="stat-label">Bajo mínimo</div>
          <div className="stat-value" style={{ color: "var(--warning)" }}>{fmtNum(filtroSucursal ? filas.filter((p) => (!filtroEstado || String(p.estado || "") === filtroEstado) && alertaDe(p) === "bajo_minimo").length : stats.bajo)}</div>
          <div className="stat-sub">stock total menor al umbral definido</div>
        </div>
        <div className="stat-card" onClick={() => { setVista("stock"); setFiltroAlerta("sin_stock"); }} style={{ cursor: "pointer" }} title="Ver solo los productos sin stock">
          <div className="stat-label">Sin stock</div>
          <div className="stat-value" style={{ color: "var(--danger)" }}>{fmtNum(stats.sinStock)}</div>
          <div className="stat-sub">{filtroSucursal ? `sin stock en ${nombreSucursal(filtroSucursal)}` : "stock en 0"}</div>
        </div>
        {bsale && (
          <div className="stat-card" onClick={() => { setVista("stock"); setFiltroSucursal(""); setFiltroAlerta("sin_producto"); }} style={{ cursor: "pointer" }} title="Ver solo los SKUs que existen en Bsale pero no están creados en el sistema">
            <div className="stat-label">No creados en el sistema</div>
            <div className="stat-value" style={{ color: "#c2410c" }}>{fmtNum(filasHuerfanas.length)}</div>
            <div className="stat-sub">{!bsale.ultima?.resumen ? "requiere una sincronización" : huerfanosSinDato ? "en Bsale · sincroniza para ver su stock" : `en Bsale · ${fmtNum(huerfanosConStock)} con stock`}</div>
          </div>
        )}
      </div>
      )}

      {/* Integración Bsale: el stock disponible de Bsale (donde se factura)
          es la fuente de verdad; cada corrida deja los cambios como ajustes
          en el libro. La tarjeta solo aparece si el backend trae el módulo. */}
      {bsale && (
        <div className="surface" style={{ padding: "14px 18px", margin: "4px 0 14px", display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
          <div style={{
            width: 38, height: 38, borderRadius: 10, flexShrink: 0,
            background: "linear-gradient(135deg, #f97316, #fb923c)", color: "#fff",
            display: "grid", placeItems: "center", fontWeight: 800, fontSize: 15,
          }}>
            B
          </div>
          <div style={{ flex: 1, minWidth: 240 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <strong style={{ fontSize: 13.5 }}>Integración Bsale · stock</strong>
              {bsale.token_configurado ? (
                <span style={{ fontSize: 10.5, fontWeight: 700, padding: "2px 8px", borderRadius: 999, background: "#dcfce7", color: "#15803d" }}>CONECTADO</span>
              ) : (
                <span style={{ fontSize: 10.5, fontWeight: 700, padding: "2px 8px", borderRadius: 999, background: "#fef3c7", color: "#b45309" }}>FALTA TOKEN</span>
              )}
              {bsale.automatica?.activa && bsale.automatica?.horas?.length > 0 && (
                <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                  automática a las {bsale.automatica.horas.map((h) => `${String(h).padStart(2, "0")}:00`).join(" y ")}
                </span>
              )}
            </div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
              {!bsale.token_configurado ? (
                "Configura BSALE_ACCESS_TOKEN en el backend (Bsale: Configuración → Integraciones → API) para activar la sincronización."
              ) : bsale.ultima?.resumen ? (
                <>
                  Última corrida {fmtFechaHora(bsale.ultima.actualizado_at)}: {fmtNum(bsale.ultima.resumen.matcheados)} SKUs matcheados,{" "}
                  {fmtNum(bsale.ultima.resumen.actualizados)} stocks actualizados ·{" "}
                  <button type="button" onClick={abrirDiferenciasBsale} className="table-link" style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontSize: 12 }}>
                    {fmtNum(bsale.ultima.resumen.skus_bsale_sin_producto)} SKUs de Bsale sin producto interno{bsale.ultima.resumen.skus_bsale_sin_producto_con_stock != null ? ` (${fmtNum(bsale.ultima.resumen.skus_bsale_sin_producto_con_stock)} con stock)` : ""} · {fmtNum(bsale.ultima.resumen.productos_sin_bsale)} internos sin Bsale
                  </button>
                  {multiSucursal && (() => {
                    const principal = sucursales.find((s) => s.es_principal);
                    return principal ? <> · las diferencias se aplican en <b>{principal.nombre}</b></> : null;
                  })()}
                </>
              ) : (
                "Aún no se ha corrido la primera sincronización. El stock disponible de Bsale reemplazará al interno (cada cambio queda como ajuste en el libro)."
              )}
            </div>
            {bsale.sincronizando && (() => {
              const p = bsale.progreso;
              const FASES = {
                catalogo: ["1", "Bajando el catálogo de Bsale"],
                stocks: ["2", "Consultando el stock en Bsale"],
                aplicando: ["3", "Actualizando el stock de los productos"],
              };
              const [paso, etiqueta] = FASES[p?.fase] || [null, "Sincronizando con Bsale"];
              const pct = p?.total > 0 ? Math.min(100, Math.round((p.hechas / p.total) * 100)) : null;
              const detalle = !p?.total
                ? "…"
                : p.fase === "catalogo"
                  ? ` — página ${fmtNum(p.hechas)} de ${fmtNum(p.total)}`
                  : p.fase === "aplicando"
                    ? ` — ${fmtNum(p.hechas)} de ${fmtNum(p.total)} productos`
                    : ` — ${fmtNum(p.hechas)} de ${fmtNum(p.total)}`;
              return (
                <div style={{ marginTop: 8, maxWidth: 520 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, fontSize: 12, color: "var(--text-muted)", marginBottom: 4 }}>
                    <span>{paso ? `Paso ${paso} de 3 · ` : ""}{etiqueta}{detalle}</span>
                    {pct != null && <strong style={{ color: "var(--primary-dark)", fontVariantNumeric: "tabular-nums" }}>{pct}%</strong>}
                  </div>
                  <div style={{ height: 6, borderRadius: 4, background: "var(--border)", overflow: "hidden" }}>
                    <div style={{
                      width: `${pct ?? 12}%`, height: "100%", borderRadius: 4,
                      background: "linear-gradient(90deg, var(--primary), #14b8a6)",
                      transition: "width .4s ease",
                    }} />
                  </div>
                  {p?.fase === "aplicando" && (
                    <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 4 }}>
                      El stock ya se está escribiendo: la tabla de abajo se refresca sola a medida que avanza.
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
          {esAdmin && (
            <button
              className="btn btn-secondary"
              onClick={sincronizarBsale}
              disabled={bsaleSync || bsale.sincronizando || !bsale.token_configurado}
              title={!bsale.token_configurado ? "Configura el token de Bsale en el backend" : "Traer el stock disponible desde Bsale ahora"}
              style={{ display: "inline-flex", alignItems: "center", gap: 6, flexShrink: 0 }}
            >
              <RefreshCw size={14} style={bsaleSync || bsale.sincronizando ? { animation: "bsale-spin 1s linear infinite" } : undefined} />
              {bsaleSync || bsale.sincronizando ? "Sincronizando…" : "Sincronizar ahora"}
            </button>
          )}
          <style>{`@keyframes bsale-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
        </div>
      )}

      {/* Pestañas */}
      <div style={{ display: "inline-flex", borderRadius: 9, overflow: "hidden", border: "1px solid var(--border)", margin: "4px 0 14px", flexWrap: "wrap" }}>
        {pestanas.map(([key, label]) => (
          <button key={key} type="button" onClick={() => setVista(key)}
            style={{
              padding: "7px 18px", fontSize: 13, fontWeight: 700, cursor: "pointer", border: "none",
              background: vista === key ? "var(--primary)" : "var(--surface)",
              color: vista === key ? "#fff" : "var(--text-muted)",
            }}>
            {label}
          </button>
        ))}
      </div>

      {vista === "stock" && (
        <>
          <div className="filter-bar" style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
            <div className="filter-field" style={{ flex: 2, minWidth: 220 }}>
              <label className="filter-label">Buscar</label>
              <div style={{ position: "relative" }}>
                <Search size={15} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)" }} />
                <input className="input" style={{ paddingLeft: 32 }} placeholder="SKU, nombre o marca…" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
              </div>
            </div>
            {multiSucursal && (
              <div className="filter-field">
                <label className="filter-label">Sucursal</label>
                <DropdownSelect value={filtroSucursal} onChange={setFiltroSucursal} minWidth={170}
                  options={opcionesSucursal("Todas (stock total)")} title="Ver el stock de una sucursal en particular" />
              </div>
            )}
            <div className="filter-field">
              <label className="filter-label">Categoría</label>
              <DropdownSelect value={filtroCategoria} onChange={setFiltroCategoria} minWidth={160}
                options={[{ value: "", label: "Todas" }, ...categorias.map((c) => ({ value: c, label: c }))]} />
            </div>
            <div className="filter-field">
              <label className="filter-label">Alerta</label>
              <DropdownSelect value={filtroAlerta} onChange={setFiltroAlerta} minWidth={160}
                options={[
                  { value: "", label: "Todos" },
                  { value: "con_stock", label: "Con stock" },
                  ...(filtroSucursal ? [] : [{ value: "bajo_minimo", label: "Bajo mínimo" }]),
                  { value: "sin_stock", label: "Sin stock" },
                  ...(bsale && !filtroSucursal ? [{ value: "sin_producto", label: "No creados en el sistema", detalle: "Existen en Bsale" }] : []),
                ]} />
            </div>
            <div className="filter-field">
              <label className="filter-label">Estado producto</label>
              <DropdownSelect value={filtroEstado} onChange={setFiltroEstado} minWidth={140}
                options={[{ value: "Activo", label: "Activos" }, { value: "Transitorio", label: "Transitorios" }, { value: "", label: "Todos" }]} />
            </div>
            <BotonLimpiarFiltros hay={hayFiltros} onLimpiar={limpiarFiltros} />
          </div>

          {filasHuerfanas.length > 0 && filtroAlerta !== "sin_producto" && !busqueda.trim() && !filtroSucursal && (
            <div style={{ marginTop: 14, padding: "10px 14px", borderRadius: 10, background: "#fff7ed", border: "1px solid #fed7aa", boxShadow: "inset 3px 0 0 #f97316", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <AlertTriangle size={15} style={{ color: "#c2410c", flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 220, fontSize: 12.5 }}>
                <strong style={{ color: "#c2410c" }}>{fmtNum(filasHuerfanas.length)} SKUs existen en Bsale y no están creados en el sistema</strong>
                {huerfanosSinDato ? " · corre «Sincronizar ahora» para ver su stock" : huerfanosConStock > 0 ? ` · ${fmtNum(huerfanosConStock)} con stock en Bsale` : " · ninguno con stock"}
                . No aparecen en esta grilla hasta que se creen acá; también puedes buscarlos por SKU.
              </div>
              <button className="btn btn-sm btn-secondary" onClick={() => setFiltroAlerta("sin_producto")} style={{ whiteSpace: "nowrap" }}>
                Ver los no creados
              </button>
            </div>
          )}

          <div className="surface" style={{ marginTop: 14, overflowX: "auto" }}>
            {loading ? (
              <div style={{ padding: "36px 24px", color: "var(--text-muted)" }}>Cargando inventario…</div>
            ) : filtradas.length === 0 ? (
              <div style={{ padding: "36px 24px", color: "var(--text-muted)" }}>
                {filtroAlerta === "sin_producto" ? "Todos los SKUs de Bsale están creados en el sistema." : "Sin productos para el filtro."}
              </div>
            ) : (
              <table className="data-table tabla-compacta" style={{ width: "100%", minWidth: 870 /* 2026-10-07: era 1080, no cabía en 13" */ }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left", whiteSpace: "nowrap" }}>SKU</th>
                    <th style={{ textAlign: "left", minWidth: 200 }}>Producto</th>
                    <th style={{ textAlign: "left" }}>Categoría</th>
                    <th style={{ textAlign: "right", whiteSpace: "nowrap", cursor: "pointer" }} onClick={() => toggleOrden("stock")} title={filtroSucursal ? `Stock en ${nombreSucursal(filtroSucursal)} (ordenar)` : "Ordenar por stock"}>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>Stock <FlechaOrden campo="stock" /></span>
                      {filtroSucursal && <div style={{ fontSize: 10, fontWeight: 600, textTransform: "none", letterSpacing: 0, color: "#0369a1" }}>en {nombreSucursal(filtroSucursal)}</div>}
                    </th>
                    <th style={{ textAlign: "right", whiteSpace: "nowrap" }} title="Umbral de alerta. Clic en el número para editarlo; 0 = sin umbral.">Mínimo</th>
                    {verCostos && (
                      <>
                        <th style={{ textAlign: "right", whiteSpace: "nowrap" }}>Costo</th>
                        <th style={{ textAlign: "right", whiteSpace: "nowrap", cursor: "pointer" }} onClick={() => toggleOrden("valor")} title="Ordenar por valorización">
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>Valorización <FlechaOrden campo="valor" /></span>
                        </th>
                      </>
                    )}
                    <th style={{ textAlign: "left" }}>Alerta</th>
                    <th style={{ textAlign: "left", whiteSpace: "nowrap" }}>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {filtradas.map((p) => {
                    if (p.bsale_huerfano) {
                      return (
                        <tr key={p.id} style={{ background: "#fff7ed", boxShadow: "inset 3px 0 0 #f97316" }} title="Este SKU existe en Bsale pero no está creado en el sistema">
                          <td style={{ fontWeight: 700, whiteSpace: "nowrap", color: "#c2410c" }}>{p.sku}</td>
                          <td style={{ whiteSpace: "normal", wordBreak: "break-word" }}>
                            {p.nombre || <span style={{ color: "var(--text-muted)" }}>Sin descripción en Bsale</span>}
                            <div style={{ fontSize: 11, color: "#c2410c", fontWeight: 600 }}>Existe en Bsale · no creado en el sistema</div>
                          </td>
                          <td style={{ fontSize: 12.5, color: "var(--text-muted)" }}>—</td>
                          <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                            <div style={{ fontWeight: 700, color: p.stock > 0 ? "#c2410c" : "var(--text-muted)" }}>{p.stock == null ? "—" : fmtNum(p.stock)}</div>
                            <div style={{ fontSize: 10.5, color: "var(--text-muted)" }}>en Bsale</div>
                          </td>
                          <td style={{ textAlign: "right", color: "var(--text-muted)" }}>—</td>
                          {verCostos && (
                            <>
                              <td style={{ textAlign: "right", color: "var(--text-muted)" }}>—</td>
                              <td style={{ textAlign: "right", color: "var(--text-muted)" }}>—</td>
                            </>
                          )}
                          <td>
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 999, background: "#ffedd5", color: "#c2410c", whiteSpace: "nowrap" }}>
                              <AlertTriangle size={11} /> No creado
                            </span>
                          </td>
                          <td>
                            {esAdmin && (
                              <button className="btn btn-sm btn-primary" onClick={() => setCrearDesdeBsale({ sku: p.sku, nombre: p.nombre, stock: p.stock })}
                                title="Crear el producto en el sistema con este SKU; el stock de Bsale queda como ajuste en el libro"
                                style={{ display: "inline-flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}>
                                <PackagePlus size={14} /> Crear producto
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    }
                    const al = alertaDe(p, filtroSucursal);
                    const stock = stockEn(p, filtroSucursal);
                    const total = Number(p.stock) || 0;
                    const enTransito = Number(p.en_transito) || 0;
                    const reparto = multiSucursal && !filtroSucursal
                      ? sucActivas.filter((s) => stockEn(p, s.id) !== 0).map((s) => `${s.nombre} ${fmtNum(stockEn(p, s.id))}`)
                      : [];
                    return (
                      <tr key={p.id}>
                        <td style={{ fontWeight: 600, whiteSpace: "nowrap" }}>{p.sku || <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>—</span>}</td>
                        <td style={{ whiteSpace: "normal", wordBreak: "break-word" }}>
                          {p.nombre || "—"}
                          {p.marca && <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{p.marca}</div>}
                          {/* Reparto por sucursal (y lo que viaja entre ellas): acá, donde hay
                              ancho para que parta línea sin estirar la columna Stock. */}
                          {(reparto.length > 0 || (multiSucursal && enTransito > 0)) && (
                            <div style={{ fontSize: 11, color: "#0369a1", marginTop: 2 }}>
                              {reparto.join(" · ")}{enTransito > 0 ? `${reparto.length ? " · " : ""}${fmtNum(enTransito)} en tránsito` : ""}
                            </div>
                          )}
                        </td>
                        {/* (2026-11-02) La categoría parte línea si hace falta: en 13" con el menú abierto la tabla quedaba 2 px pasada. */}
                        <td style={{ fontSize: 12.5, whiteSpace: "normal", minWidth: 90 }}>{p.categoria || "—"}</td>
                        <td style={{ textAlign: "right", fontWeight: 700, whiteSpace: "nowrap", color: al === "sin_stock" ? "var(--danger)" : al === "bajo_minimo" ? "var(--warning)" : "var(--text)" }}>
                          {fmtNum(stock)}
                          {filtroSucursal && (
                            <div style={{ fontSize: 10.5, fontWeight: 500, color: "var(--text-muted)" }}>total {fmtNum(total)}{enTransito > 0 ? ` · ${fmtNum(enTransito)} en tránsito` : ""}</div>
                          )}
                        </td>
                        <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                          {!esAdmin ? (
                            <span style={{ color: Number(p.stock_minimo) > 0 ? "var(--text)" : "var(--text-muted)" }}>{fmtNum(Number(p.stock_minimo) || 0)}</span>
                          ) : minEdit[p.id] !== undefined ? (
                            <input
                              className="input"
                              autoFocus
                              inputMode="numeric"
                              value={minEdit[p.id]}
                              onChange={(e) => setMinEdit((m) => ({ ...m, [p.id]: e.target.value.replace(/[^\d.,]/g, "") }))}
                              onBlur={(e) => guardarStockMinimo(p, e.target.value)}
                              onKeyDown={(e) => { if (e.key === "Enter") e.target.blur(); if (e.key === "Escape") setMinEdit((m) => { const c = { ...m }; delete c[p.id]; return c; }); }}
                              style={{ width: 80, height: 28, textAlign: "right", fontSize: 12.5 }}
                            />
                          ) : (
                            <button type="button" onClick={() => setMinEdit((m) => ({ ...m, [p.id]: String(Number(p.stock_minimo) || 0) }))}
                              title="Editar el stock mínimo"
                              style={{ background: "none", border: "none", cursor: "pointer", font: "inherit", color: Number(p.stock_minimo) > 0 ? "var(--text)" : "var(--text-muted)", textDecoration: "underline dotted", textUnderlineOffset: 3 }}>
                              {fmtNum(Number(p.stock_minimo) || 0)}
                            </button>
                          )}
                        </td>
                        {verCostos && (
                          <>
                            <td style={{ textAlign: "right", whiteSpace: "nowrap", fontSize: 12.5 }}>{fmtCLP(p.costo)}</td>
                            <td style={{ textAlign: "right", whiteSpace: "nowrap", fontWeight: 600 }}>{fmtCLP(stock * (Number(p.costo) || 0))}</td>
                          </>
                        )}
                        <td>
                          {al === "sin_stock" ? (
                            <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 999, background: "#fee2e2", color: "#b91c1c", whiteSpace: "nowrap" }}>Sin stock</span>
                          ) : al === "bajo_minimo" ? (
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 999, background: "#fef3c7", color: "#b45309", whiteSpace: "nowrap" }}>
                              <AlertTriangle size={11} /> Bajo mínimo
                            </span>
                          ) : (
                            <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 999, background: "#dcfce7", color: "#15803d", whiteSpace: "nowrap" }}>OK</span>
                          )}
                        </td>
                        <td>
                          <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
                            {esAdmin && (
                              <>
                                <button className="btn btn-sm btn-ghost" title={`Registrar entrada (compra, devolución)${multiSucursal ? ` en ${nombreSucursal(filtroSucursal || sucInfo?.principal_id)}` : ""}`} onClick={() => setMovModal({ producto: p, tipo: "entrada", sucursalId: filtroSucursal || sucInfo?.principal_id })} style={{ padding: 6, lineHeight: 0, color: "#15803d" }}>
                                  <Plus size={15} />
                                </button>
                                <button className="btn btn-sm btn-ghost" title={`Registrar salida (venta, merma, muestra)${multiSucursal ? ` en ${nombreSucursal(filtroSucursal || sucInfo?.principal_id)}` : ""}`} onClick={() => setMovModal({ producto: p, tipo: "salida", sucursalId: filtroSucursal || sucInfo?.principal_id })} style={{ padding: 6, lineHeight: 0, color: "#b91c1c" }}>
                                  <Minus size={15} />
                                </button>
                                <button className="btn btn-sm btn-ghost" title={`Ajustar al conteo físico${multiSucursal ? ` de ${nombreSucursal(filtroSucursal || sucInfo?.principal_id)}` : ""}`} onClick={() => setMovModal({ producto: p, tipo: "ajuste", sucursalId: filtroSucursal || sucInfo?.principal_id })} style={{ padding: 6, lineHeight: 0, color: "#6d28d9" }}>
                                  <SlidersHorizontal size={15} />
                                </button>
                              </>
                            )}
                            <button className="btn btn-sm btn-ghost" title="Ver historial de movimientos" onClick={() => abrirHistorial(p)} style={{ padding: 6, lineHeight: 0, color: "var(--text-muted)" }}>
                              <History size={15} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {vista === "movimientos" && (
        <>
          <div className="filter-bar" style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
            <div className="filter-field" style={{ flex: 2, minWidth: 220 }}>
              <label className="filter-label">Buscar</label>
              <div style={{ position: "relative" }}>
                <Search size={15} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)" }} />
                <input className="input" style={{ paddingLeft: 32 }} placeholder={`SKU, motivo, referencia${multiSucursal ? ", sucursal" : ""} o usuario…`} value={busquedaMov} onChange={(e) => setBusquedaMov(e.target.value)} />
              </div>
            </div>
            <div className="filter-field">
              <label className="filter-label">Tipo</label>
              <DropdownSelect value={filtroTipoMov} onChange={setFiltroTipoMov} minWidth={150}
                options={[
                  { value: "", label: "Todos" },
                  { value: "entrada", label: "Entradas", color: TIPOS_MOV.entrada.color },
                  { value: "salida", label: "Salidas", color: TIPOS_MOV.salida.color },
                  { value: "ajuste", label: "Ajustes", color: TIPOS_MOV.ajuste.color },
                  ...(conSucursales ? [{ value: "traslado", label: "Traslados", color: TIPOS_MOV.traslado_salida.color, detalle: "Salidas y entradas entre sucursales" }] : []),
                ]} />
            </div>
            {multiSucursal && (
              <div className="filter-field">
                <label className="filter-label">Sucursal</label>
                <DropdownSelect value={filtroSucursalMov} onChange={setFiltroSucursalMov} minWidth={170} options={opcionesSucursal("Todas")} />
              </div>
            )}
            <BotonLimpiarFiltros hay={hayFiltros} onLimpiar={limpiarFiltros} />
            <span style={{ fontSize: 12, color: "var(--text-muted)", paddingBottom: 9 }}>
              Últimos 500 movimientos{libro && libroFiltrado.length !== libro.length ? ` · ${libroFiltrado.length} en el filtro` : ""}
            </span>
          </div>

          <div className="surface" style={{ marginTop: 14, overflowX: "auto" }}>
            {libroLoading || libro === null ? (
              <div style={{ padding: "36px 24px", color: "var(--text-muted)" }}>Cargando movimientos…</div>
            ) : libroFiltrado.length === 0 ? (
              <div style={{ padding: "36px 24px", color: "var(--text-muted)" }}>
                {libro.length === 0 ? "Aún no hay movimientos registrados." : "Sin movimientos para el filtro."}
              </div>
            ) : (
              <TablaMovimientos movs={libroFiltrado} conSku sucursales={multiSucursal ? sucursales : null} />
            )}
          </div>
        </>
      )}

      {vista === "traslados" && conSucursales && (
        <>
          <div className="filter-bar" style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
            <div className="filter-field" style={{ flex: 2, minWidth: 220 }}>
              <label className="filter-label">Buscar</label>
              <div style={{ position: "relative" }}>
                <Search size={15} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)" }} />
                <input className="input" style={{ paddingLeft: 32 }} placeholder="N°, SKU, producto, sucursal, motivo o usuario…" value={busquedaTr} onChange={(e) => setBusquedaTr(e.target.value)} />
              </div>
            </div>
            <div className="filter-field">
              <label className="filter-label">Estado</label>
              <DropdownSelect value={filtroEstadoTr} onChange={setFiltroEstadoTr} minWidth={160}
                options={[
                  { value: "en_transito", label: "En tránsito", color: ESTADOS_TRASLADO.en_transito.color, detalle: "Salieron y aún no se reciben" },
                  { value: "recibido", label: "Recibidos", color: ESTADOS_TRASLADO.recibido.color },
                  { value: "anulado", label: "Anulados", color: ESTADOS_TRASLADO.anulado.color },
                  { value: "", label: "Todos" },
                ]} />
            </div>
            <span style={{ fontSize: 12, color: "var(--text-muted)", paddingBottom: 9 }}>
              {traslados ? `${fmtNum(trasladosFiltrados.length)} traslado${trasladosFiltrados.length === 1 ? "" : "s"}` : ""}
            </span>
          </div>

          {sucActivas.length < 2 && (
            <div style={{ marginTop: 14, padding: "10px 14px", borderRadius: 10, background: "#eff6ff", border: "1px solid #bfdbfe", boxShadow: "inset 3px 0 0 #3b82f6", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", fontSize: 12.5 }}>
              <Store size={15} style={{ color: "#1d4ed8", flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 220 }}>
                <strong style={{ color: "#1d4ed8" }}>Hay una sola sucursal activa ({sucActivas[0]?.nombre || "—"})</strong>. Para trasladar stock hace falta una segunda{esAdmin ? ": créala en la pestaña Sucursales" : " (la crea un administrador)"}.
              </div>
              {esAdmin && <button className="btn btn-sm btn-secondary" onClick={() => setVista("sucursales")}>Ir a Sucursales</button>}
            </div>
          )}

          <div className="surface" style={{ marginTop: 14, overflowX: "auto" }}>
            {trasladosLoading || traslados === null ? (
              <div style={{ padding: "36px 24px", color: "var(--text-muted)" }}>Cargando traslados…</div>
            ) : trasladosFiltrados.length === 0 ? (
              <div style={{ padding: "36px 24px", color: "var(--text-muted)" }}>
                {traslados.length === 0 ? "Aún no hay traslados entre sucursales." : "Sin traslados para el filtro."}
              </div>
            ) : (
              <table className="data-table tabla-compacta" style={{ width: "100%", minWidth: 760 }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left", whiteSpace: "nowrap" }}>N°</th>
                    <th style={{ textAlign: "left", whiteSpace: "nowrap" }}>Fecha</th>
                    <th style={{ textAlign: "left" }}>Origen → destino</th>
                    <th style={{ textAlign: "right", whiteSpace: "nowrap" }} title="Productos distintos · unidades enviadas">Productos</th>
                    <th style={{ textAlign: "left" }}>Estado</th>
                    <th style={{ textAlign: "left", minWidth: 150 }}>Motivo / referencia</th>
                    <th style={{ textAlign: "left", whiteSpace: "nowrap" }}>Usuario</th>
                    <th style={{ textAlign: "left", whiteSpace: "nowrap" }}>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {trasladosPagina.map((t) => {
                    const est = ESTADOS_TRASLADO[t.estado] || { label: t.estado, color: "var(--text-muted)", bg: "var(--neutral-bg)" };
                    const abierto = trasladoAbierto === t.id;
                    const faltantes = t.estado === "recibido" ? (t.lineas || []).reduce((a, l) => a + Math.max(0, Number(l.cantidad) - Number(l.cantidad_recibida ?? l.cantidad)), 0) : 0;
                    return [
                      <tr key={t.id} style={{ cursor: "pointer" }} onClick={() => setTrasladoAbierto(abierto ? null : t.id)}>
                        <td style={{ fontWeight: 700, whiteSpace: "nowrap" }}>
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                            {abierto ? <ChevronDown size={13} /> : <ChevronRight size={13} />}#{t.id}
                          </span>
                        </td>
                        <td style={{ whiteSpace: "nowrap", fontSize: 12.5 }}>{fmtFechaHora(t.created_at)}</td>
                        <td style={{ fontSize: 12.5, whiteSpace: "normal" }}>
                          <span style={{ fontWeight: 600 }}>{t.origen?.nombre}</span>
                          <span style={{ color: "var(--text-muted)", margin: "0 6px" }}>→</span>
                          <span style={{ fontWeight: 600 }}>{t.destino?.nombre}</span>
                          {t.bsale_id && (
                            <div style={{ fontSize: 11, marginTop: 2, display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
                              <a href={t.bsale_url || undefined} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}
                                style={{ color: "#c2410c", fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 3 }} title="Ver la guía en Bsale">
                                <FileText size={11} /> Guía Bsale N° {t.bsale_numero || t.bsale_doc_id || t.bsale_id} <ExternalLink size={10} />
                              </a>
                              <span style={{ color: "var(--text-muted)" }}>· {t.bsale_recibido_at ? "recepcionada en Bsale" : "sin recepcionar en Bsale"}</span>
                            </div>
                          )}
                        </td>
                        <td style={{ textAlign: "right", whiteSpace: "nowrap", fontSize: 12.5 }}>
                          {fmtNum(t.items)} · <b>{fmtNum(t.unidades)}</b> un.
                          {t.estado === "recibido" && t.unidades_recibidas != null && t.unidades_recibidas !== t.unidades && (
                            <div style={{ fontSize: 10.5, color: "#b45309" }}>recibidas {fmtNum(t.unidades_recibidas)}</div>
                          )}
                        </td>
                        <td>
                          <Chip info={est} />
                          {faltantes > 0 && <div style={{ fontSize: 10.5, color: "#b45309", marginTop: 2 }}>{fmtNum(faltantes)} faltante{faltantes === 1 ? "" : "s"}</div>}
                        </td>
                        <td style={{ fontSize: 12.5, whiteSpace: "normal", wordBreak: "break-word" }}>
                          {t.motivo || <span style={{ color: "var(--text-muted)" }}>—</span>}
                          {t.referencia && <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Ref. {t.referencia}</div>}
                        </td>
                        <td style={{ fontSize: 12, color: "var(--text-muted)", whiteSpace: "nowrap" }}>{(t.usuario_email || "—").split("@")[0]}</td>
                        <td onClick={(e) => e.stopPropagation()}>
                          {t.estado === "en_transito" && puedeTrasladar ? (
                            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                              {!t.bsale_id && trasladoMapeado(t) && (
                                <button className="btn btn-sm btn-secondary" onClick={() => setGuiaBsaleModal(t)} title="Emitir en Bsale la guía de despacho de traslado interno (primero se simula)" style={{ display: "inline-flex", alignItems: "center", gap: 4, whiteSpace: "nowrap" }}>
                                  <FileText size={13} /> Guía Bsale
                                </button>
                              )}
                              <button className="btn btn-sm btn-primary" onClick={() => setRecibirModal(t)} title={`Confirmar que el stock llegó a ${t.destino?.nombre}`} style={{ display: "inline-flex", alignItems: "center", gap: 4, whiteSpace: "nowrap" }}>
                                <PackageCheck size={13} /> Recibir
                              </button>
                              <button className="btn btn-sm btn-ghost" onClick={() => setAnularModal(t)} title={`Anular: el stock vuelve a ${t.origen?.nombre}`} style={{ padding: 6, lineHeight: 0, color: "#b91c1c" }}>
                                <Ban size={14} />
                              </button>
                            </div>
                          ) : (
                            <span style={{ fontSize: 11.5, color: "var(--text-muted)" }}>
                              {t.estado === "recibido" ? `${(t.recibido_por || "").split("@")[0] || "—"} · ${fmtFechaHora(t.recibido_at)}` : t.estado === "anulado" ? `${(t.anulado_por || "").split("@")[0] || "—"} · ${fmtFechaHora(t.anulado_at)}` : "—"}
                            </span>
                          )}
                        </td>
                      </tr>,
                      abierto && (
                        <tr key={`${t.id}-detalle`}>
                          <td colSpan={8} style={{ background: "var(--bg)", padding: "10px 14px 12px" }}>
                            <table className="data-table" style={{ width: "100%", maxWidth: 760 }}>
                              <thead>
                                <tr>
                                  <th style={{ textAlign: "left", whiteSpace: "nowrap" }}>SKU</th>
                                  <th style={{ textAlign: "left" }}>Producto</th>
                                  <th style={{ textAlign: "right", whiteSpace: "nowrap" }}>Enviadas</th>
                                  <th style={{ textAlign: "right", whiteSpace: "nowrap" }}>Recibidas</th>
                                </tr>
                              </thead>
                              <tbody>
                                {(t.lineas || []).map((l) => {
                                  const rec = l.cantidad_recibida;
                                  const falta = t.estado === "recibido" && rec != null && Number(rec) < Number(l.cantidad);
                                  return (
                                    <tr key={l.id}>
                                      <td style={{ fontWeight: 600, whiteSpace: "nowrap", fontSize: 12.5 }}>{l.sku || "—"}</td>
                                      <td style={{ fontSize: 12.5, whiteSpace: "normal", wordBreak: "break-word" }}>{l.nombre || "—"}</td>
                                      <td style={{ textAlign: "right", fontSize: 12.5 }}>{fmtNum(l.cantidad)}</td>
                                      <td style={{ textAlign: "right", fontSize: 12.5, fontWeight: falta ? 700 : 400, color: falta ? "#b45309" : "var(--text)" }}>
                                        {t.estado === "recibido" ? fmtNum(rec ?? l.cantidad) : t.estado === "anulado" ? <span style={{ color: "var(--text-muted)" }}>devueltas al origen</span> : <span style={{ color: "var(--text-muted)" }}>en tránsito</span>}
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                            {(t.nota_recepcion || t.motivo_anulacion) && (
                              <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 8 }}>
                                {t.nota_recepcion && <>Nota de recepción: <b>{t.nota_recepcion}</b></>}
                                {t.motivo_anulacion && <>Motivo de la anulación: <b>{t.motivo_anulacion}</b></>}
                              </div>
                            )}
                          </td>
                        </tr>
                      ),
                    ];
                  })}
                </tbody>
              </table>
            )}
          </div>
          <Paginacion pagina={paginaTr} total={trasladosFiltrados.length} porPagina={POR_PAGINA_TRASLADOS} onCambiar={setPaginaTr} nombre="traslados" />
        </>
      )}

      {vista === "sucursales" && conSucursales && esAdmin && (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <p style={{ margin: 0, fontSize: 12.5, color: "var(--text-muted)", flex: 1, minWidth: 240 }}>
              Sucursales y bodegas propias. La <b>principal</b> recibe los movimientos sin sucursal y las diferencias de la sincronización con Bsale (Bsale tiene una sola sucursal).
            </p>
            <button className="btn btn-primary" onClick={() => setSucModal({ sucursal: null })} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <Plus size={14} /> Nueva sucursal
            </button>
          </div>
          <div className="surface" style={{ marginTop: 14, overflowX: "auto" }}>
            {resumenSuc === null ? (
              <div style={{ padding: "36px 24px", color: "var(--text-muted)" }}>Cargando sucursales…</div>
            ) : (
              <table className="data-table tabla-compacta" style={{ width: "100%", minWidth: 720 }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left" }}>Sucursal</th>
                    <th style={{ textAlign: "left" }}>Dirección</th>
                    <th style={{ textAlign: "left", whiteSpace: "nowrap" }} title="id de la sucursal en Bsale (/offices.json)">Bsale</th>
                    <th style={{ textAlign: "right", whiteSpace: "nowrap" }}>SKUs con stock</th>
                    <th style={{ textAlign: "right", whiteSpace: "nowrap" }}>Unidades</th>
                    {verCostos && <th style={{ textAlign: "right", whiteSpace: "nowrap" }}>Valorización</th>}
                    <th style={{ textAlign: "right", whiteSpace: "nowrap" }} title="Traslados en tránsito que salen o llegan">En tránsito</th>
                    <th style={{ textAlign: "left", whiteSpace: "nowrap" }}>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {resumenSuc.map((s) => (
                    <tr key={s.id} style={!s.activa ? { opacity: 0.6 } : undefined}>
                      <td style={{ whiteSpace: "normal" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                          <span style={{ fontWeight: 700 }}>{s.nombre}</span>
                          {s.es_principal && <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 10.5, fontWeight: 700, padding: "1px 7px", borderRadius: 999, background: "#dbeafe", color: "#1d4ed8" }}><Star size={10} /> Principal</span>}
                          {!s.activa && <span style={{ fontSize: 10.5, fontWeight: 700, padding: "1px 7px", borderRadius: 999, background: "#f3f4f6", color: "#6b7280" }}>Inactiva</span>}
                        </div>
                      </td>
                      <td style={{ fontSize: 12.5, whiteSpace: "normal", wordBreak: "break-word" }}>{[s.direccion, s.comuna].filter(Boolean).join(", ") || <span style={{ color: "var(--text-muted)" }}>—</span>}</td>
                      <td style={{ fontSize: 12.5, whiteSpace: "normal" }}>{s.bsale_office_id ? nombreOficina(s.bsale_office_id) : <span style={{ color: "var(--text-muted)" }}>—</span>}</td>
                      <td style={{ textAlign: "right" }}>{fmtNum(s.skus_con_stock)}</td>
                      <td style={{ textAlign: "right", fontWeight: 700 }}>{fmtNum(s.unidades)}</td>
                      {verCostos && <td style={{ textAlign: "right", fontWeight: 600 }}>{fmtCLP(s.valorizacion)}</td>}
                      <td style={{ textAlign: "right" }}>{s.traslados_en_transito ? <b style={{ color: "#b45309" }}>{fmtNum(s.traslados_en_transito)}</b> : <span style={{ color: "var(--text-muted)" }}>0</span>}</td>
                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: 2, flexWrap: "wrap" }}>
                          <button className="btn btn-sm btn-ghost" title="Editar la sucursal" onClick={() => setSucModal({ sucursal: s })} style={{ padding: 6, lineHeight: 0 }}>
                            <Pencil size={14} />
                          </button>
                          {!s.es_principal && s.activa && (
                            <button className="btn btn-sm btn-ghost" title="Marcar como sucursal principal" style={{ padding: 6, lineHeight: 0, color: "#1d4ed8" }}
                              onClick={async () => {
                                try {
                                  await api.put(`/inventario/sucursales/${s.id}`, { es_principal: true });
                                  setResumenSuc(null); cargarSucursales();
                                  setToast({ type: "success", message: `${s.nombre} ahora es la sucursal principal.` });
                                } catch (e) { setToast({ type: "error", message: e?.message || "No se pudo cambiar la principal." }); }
                              }}>
                              <Star size={14} />
                            </button>
                          )}
                          {!s.es_principal && (
                            <button className="btn btn-sm btn-ghost" title={s.activa ? "Desactivar (solo sin stock ni traslados en tránsito)" : "Volver a activar"} style={{ padding: 6, lineHeight: 0, color: s.activa ? "#b91c1c" : "#15803d" }}
                              onClick={async () => {
                                try {
                                  await api.put(`/inventario/sucursales/${s.id}`, { activa: !s.activa });
                                  setResumenSuc(null); cargarSucursales();
                                  setToast({ type: "success", message: `${s.nombre} ${s.activa ? "desactivada" : "activada"}.` });
                                } catch (e) { setToast({ type: "error", message: e?.message || "No se pudo cambiar el estado." }); }
                              }}>
                              {s.activa ? <Trash2 size={14} /> : <RefreshCw size={14} />}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {/* Diferencias de catálogo con Bsale (última sincronización). */}
      {bsaleDif && createPortal(
        <div onClick={(e) => { if (e.target === e.currentTarget) setBsaleDif(null); }}
          style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.55)", zIndex: 12000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ width: 820, maxWidth: "100%", maxHeight: "88vh", display: "flex", flexDirection: "column", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: 22 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, marginBottom: 6 }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 15.5, fontWeight: 700 }}>Diferencias de catálogo con Bsale</h3>
                <p style={{ margin: "3px 0 0", fontSize: 12, color: "var(--text-muted)" }}>
                  De la última sincronización ({fmtFechaHora(bsaleDif.data?.actualizado_at)}). Solo informativo: la sincronización no crea ni borra productos.
                </p>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn btn-secondary btn-sm" onClick={exportarDiferenciasBsale} disabled={!bsaleDif.data?.detalle} title="Descargar ambas listas en Excel">
                  <Download size={13} /> Exportar
                </button>
                <button className="btn btn-ghost" onClick={() => setBsaleDif(null)} style={{ padding: 6 }}><X size={16} /></button>
              </div>
            </div>
            {bsaleDif.loading ? (
              <div style={{ padding: "36px 24px", color: "var(--text-muted)" }}>Cargando…</div>
            ) : !bsaleDif.data?.detalle ? (
              <div style={{ padding: "36px 24px", color: "var(--text-muted)" }}>Aún no hay una sincronización guardada.</div>
            ) : (
              <div style={{ overflowY: "auto", display: "flex", flexDirection: "column", gap: 16 }}>
                {[
                  { titulo: `En Bsale, sin producto interno (${(bsaleDif.data.detalle.skus_bsale_sin_producto || []).length})`, filas: bsaleDif.data.detalle.skus_bsale_sin_producto || [], col: "Descripción en Bsale", campo: "descripcion", conStock: true },
                  { titulo: `Internos, sin SKU en Bsale (${(bsaleDif.data.detalle.productos_sin_bsale || []).length})`, filas: bsaleDif.data.detalle.productos_sin_bsale || [], col: "Producto interno", campo: "nombre", conStock: false },
                ].map((sec) => (
                  <div key={sec.titulo}>
                    <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 6 }}>{sec.titulo}</div>
                    {sec.filas.length === 0 ? (
                      <div style={{ fontSize: 12.5, color: "var(--text-muted)" }}>Sin diferencias — todo calza.</div>
                    ) : (
                      <div style={{ border: "1px solid var(--border)", borderRadius: 8, maxHeight: 240, overflowY: "auto" }}>
                        <table className="data-table" style={{ width: "100%" }}>
                          <thead style={{ position: "sticky", top: 0, background: "var(--surface)" }}>
                            <tr>
                              <th style={{ textAlign: "left" }}>SKU</th>
                              <th style={{ textAlign: "left" }}>{sec.col}</th>
                              {sec.conStock && <th style={{ textAlign: "right", whiteSpace: "nowrap" }} title="Stock disponible en Bsale (suma de sucursales) en la última sincronización">Stock Bsale</th>}
                            </tr>
                          </thead>
                          <tbody>
                            {sec.filas.map((r, i) => (
                              <tr key={`${r.sku}-${i}`}>
                                <td style={{ fontWeight: 600, whiteSpace: "nowrap" }}>{r.sku}</td>
                                <td style={{ color: "var(--text-muted)" }}>{r[sec.campo] || "—"}</td>
                                {sec.conStock && (
                                  <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: r.stock > 0 ? 700 : 400, color: r.stock > 0 ? "var(--text)" : "var(--text-muted)" }}>
                                    {r.stock == null ? "—" : fmtNum(r.stock)}
                                  </td>
                                )}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>,
        document.body
      )}

      {crearDesdeBsale && (
        <CrearProductoModal
          inicial={{ sku: crearDesdeBsale.sku, nombre: crearDesdeBsale.nombre }}
          onClose={() => setCrearDesdeBsale(null)}
          onCreado={async (creado, estadoFinal) => {
            const { sku, stock } = crearDesdeBsale;
            setCrearDesdeBsale(null);
            // El stock de Bsale entra como ajuste en el libro, igual que lo
            // haría la próxima sincronización, pero sin esperarla (en la
            // sucursal principal, como la sincronización).
            let msgStock = "";
            if (creado?.id && Number(stock) > 0) {
              try {
                await api.post("/inventario/movimientos", { productoId: creado.id, tipo: "ajuste", nuevoStock: Number(stock), motivo: "Stock inicial desde Bsale", referencia: "bsale" });
                msgStock = ` Stock inicial: ${fmtNum(stock)} unidades (desde Bsale).`;
              } catch (e) {
                msgStock = ` No se pudo registrar el stock inicial: ${e?.message || "error"}. Corre «Sincronizar ahora» para traerlo.`;
              }
            }
            setHuerfanos((h) => h.filter((x) => String(x.sku).toUpperCase() !== String(sku).toUpperCase()));
            setToast({
              type: estadoFinal === "Pendiente Aprobación" ? "info" : "success",
              message: `Producto ${sku} creado${estadoFinal === "Pendiente Aprobación" ? " (queda pendiente de aprobación)" : ""}.${msgStock}${creado?.bsale?.estado === "error" ? ` No se pudo enlazar con Bsale: ${creado.bsale.mensaje}` : ""}`,
            });
            cargar();
            setLibro(null);
          }}
        />
      )}

      {movModal && (
        <ModalMovimiento
          producto={movModal.producto}
          tipoInicial={movModal.tipo}
          sucursales={conSucursales ? sucActivas : null}
          sucursalInicial={movModal.sucursalId}
          onClose={() => setMovModal(null)}
          onListo={(res, tipo) => {
            setMovModal(null);
            aplicarStockLocal(movModal.producto.id, res);
            const donde = res?.sucursal?.nombre && multiSucursal ? ` en ${res.sucursal.nombre} (${fmtNum(res.stock_sucursal)})` : "";
            setToast({ type: "success", message: `${TIPOS_MOV[tipo].label} registrada: ${movModal.producto.sku || movModal.producto.nombre} queda con ${fmtNum(res.stock)} unidades${donde}.` });
          }}
          onError={(m) => setToast({ type: "error", message: m })}
        />
      )}

      {histModal && createPortal(
        <div onClick={(e) => { if (e.target === e.currentTarget) setHistModal(null); }}
          style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.55)", zIndex: 12000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ width: multiSucursal ? 880 : 780, maxWidth: "100%", maxHeight: "88vh", display: "flex", flexDirection: "column", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: 22 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, marginBottom: 10 }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 15.5, fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}>
                  <History size={16} /> Historial · {histModal.producto.sku || histModal.producto.nombre}
                </h3>
                <p style={{ margin: "3px 0 0", fontSize: 12, color: "var(--text-muted)" }}>
                  Stock vigente: <b>{fmtNum(Number(histModal.producto.stock) || 0)}</b> unidades
                  {multiSucursal && (
                    <> · {sucActivas.filter((s) => stockEn(histModal.producto, s.id) !== 0).map((s) => `${s.nombre} ${fmtNum(stockEn(histModal.producto, s.id))}`).join(" · ") || "sin stock en ninguna sucursal"}
                      {Number(histModal.producto.en_transito) > 0 ? ` · ${fmtNum(histModal.producto.en_transito)} en tránsito` : ""}</>
                  )}
                </p>
              </div>
              <button className="btn btn-ghost" onClick={() => setHistModal(null)} style={{ padding: 6 }}><X size={16} /></button>
            </div>
            <div style={{ overflow: "auto", border: "1px solid var(--border)", borderRadius: 10 }}>
              {histModal.loading ? (
                <div style={{ padding: "30px 20px", color: "var(--text-muted)" }}>Cargando…</div>
              ) : histModal.movs.length === 0 ? (
                <div style={{ padding: "30px 20px", color: "var(--text-muted)" }}>Este producto aún no tiene movimientos.</div>
              ) : (
                <TablaMovimientos movs={histModal.movs} sucursales={multiSucursal ? sucursales : null} />
              )}
            </div>
          </div>
        </div>,
        document.body
      )}

      {cargaOpen && (
        <ModalCargaMasiva
          sucursales={conSucursales ? sucActivas : null}
          principalId={sucInfo?.principal_id}
          onClose={() => setCargaOpen(false)}
          onListo={(res) => {
            setCargaOpen(false);
            const partes = [`${res.aplicadas} ajuste${res.aplicadas === 1 ? "" : "s"} aplicado${res.aplicadas === 1 ? "" : "s"}`];
            if (res.sin_cambio) partes.push(`${res.sin_cambio} sin cambio`);
            if (res.no_encontrados?.length) partes.push(`${res.no_encontrados.length} SKU no encontrados`);
            if (res.errores?.length) partes.push(`${res.errores.length} con error`);
            setToast({ type: res.errores?.length ? "info" : "success", message: `Carga terminada${res?.sucursal?.nombre && multiSucursal ? ` en ${res.sucursal.nombre}` : ""}: ${partes.join(" · ")}.` });
            cargar();
            setLibro(null);
            setResumenSuc(null);
          }}
          onError={(m) => setToast({ type: "error", message: m })}
        />
      )}

      {nuevoTraslado && (
        <ModalTraslado
          sucursales={sucActivas}
          principalId={sucInfo?.principal_id}
          filas={filas}
          onClose={() => setNuevoTraslado(false)}
          onListo={(t) => {
            setNuevoTraslado(false);
            setVista("traslados");
            if (t?.estado === "recibido") setFiltroEstadoTr("recibido");
            else setFiltroEstadoTr("en_transito");
            trasTraslado(`Traslado #${t.id} ${t.estado === "recibido" ? "registrado y recibido" : "creado: el stock queda en tránsito hasta recibirlo"} (${fmtNum(t.unidades)} unidades de ${t.origen?.nombre} a ${t.destino?.nombre}).`);
          }}
          onError={(m) => setToast({ type: "error", message: m })}
        />
      )}

      {recibirModal && (
        <ModalRecibirTraslado
          traslado={recibirModal}
          onClose={() => setRecibirModal(null)}
          onListo={(t) => {
            setRecibirModal(null);
            const falt = (t.lineas || []).reduce((a, l) => a + Math.max(0, Number(l.cantidad) - Number(l.cantidad_recibida ?? l.cantidad)), 0);
            trasTraslado(`Traslado #${t.id} recibido en ${t.destino?.nombre}${falt > 0 ? ` con ${fmtNum(falt)} unidad${falt === 1 ? "" : "es"} faltante${falt === 1 ? "" : "s"} (quedó como ajuste en el libro)` : ""}.`);
          }}
          onError={(m) => setToast({ type: "error", message: m })}
        />
      )}

      {anularModal && (
        <ModalAnularTraslado
          traslado={anularModal}
          onClose={() => setAnularModal(null)}
          onListo={(t) => {
            setAnularModal(null);
            trasTraslado(`Traslado #${t.id} anulado: ${fmtNum(t.unidades)} unidades volvieron a ${t.origen?.nombre}.`);
          }}
          onError={(m) => setToast({ type: "error", message: m })}
        />
      )}

      {guiaBsaleModal && (
        <ModalGuiaBsaleTraslado
          traslado={guiaBsaleModal}
          onClose={() => setGuiaBsaleModal(null)}
          onListo={(res) => {
            const id = guiaBsaleModal.id;
            setGuiaBsaleModal(null);
            trasTraslado(`Guía de traslado interno N° ${res?.numero || "—"} emitida en Bsale para el traslado #${id}. Bsale ya descontó el origen; el destino sube cuando la recepcionen allá.`);
          }}
          onError={(m) => setToast({ type: "error", message: m })}
        />
      )}

      {sucModal && (
        <ModalSucursal
          sucursal={sucModal.sucursal}
          oficinas={oficinasBsale}
          onClose={() => setSucModal(null)}
          onListo={(s, creada) => {
            setSucModal(null);
            setResumenSuc(null);
            cargarSucursales();
            setToast({ type: "success", message: creada ? `Sucursal «${s.nombre}» creada.` : `Sucursal «${s.nombre}» actualizada.` });
          }}
          onError={(m) => setToast({ type: "error", message: m })}
        />
      )}
    </div>
  );
}

/* Paginación compacta (misma de Gestión de compras / Facturación). */
function Paginacion({ pagina, total, porPagina, onCambiar, nombre }) {
  const paginas = Math.max(1, Math.ceil(total / porPagina));
  if (total <= porPagina) return null;
  return (
    <div className="gc-paginacion">
      <span>{((pagina - 1) * porPagina + 1).toLocaleString("es-CL")}–{Math.min(total, pagina * porPagina).toLocaleString("es-CL")} de {total.toLocaleString("es-CL")} {nombre}</span>
      <span className="gc-paginacion-botones">
        <button type="button" className="btn btn-secondary btn-sm" disabled={pagina <= 1} onClick={() => onCambiar(pagina - 1)}>Anterior</button>
        <button type="button" className="btn btn-secondary btn-sm" disabled={pagina >= paginas} onClick={() => onCambiar(pagina + 1)}>Siguiente</button>
      </span>
    </div>
  );
}

/* Tabla de movimientos compartida por el libro y el historial del producto.
   `sucursales` (lista) agrega la columna Sucursal con el stock que quedó ahí. */
function TablaMovimientos({ movs, conSku = false, sucursales = null }) {
  const nombreDe = (id) => sucursales?.find((s) => String(s.id) === String(id))?.nombre || (id ? `Sucursal ${id}` : "—");
  // (2026-11-02) Con la columna Sucursal el libro se compacta (padding chico,
  // sucursal y referencia parten línea) para seguir cabiendo en 13".
  return (
    <table className={`data-table${sucursales ? " tabla-compacta" : ""}`} style={{ width: "100%", minWidth: conSku ? 860 : 700 }}>
      <thead>
        <tr>
          <th style={{ textAlign: "left", whiteSpace: "nowrap" }}>Fecha</th>
          {conSku && <th style={{ textAlign: "left", whiteSpace: "nowrap" }}>SKU</th>}
          <th style={{ textAlign: "left" }}>Tipo</th>
          {sucursales && <th style={{ textAlign: "left", whiteSpace: "nowrap" }} title="Sucursal donde ocurrió y el stock que quedó en ella">Sucursal</th>}
          <th style={{ textAlign: "right", whiteSpace: "nowrap" }} title="Entradas suman, salidas restan; en los ajustes es el delta aplicado tras el conteo">Cantidad</th>
          <th style={{ textAlign: "right", whiteSpace: "nowrap" }} title={sucursales ? "Stock total del producto después del movimiento" : undefined}>{sucursales ? "Stock total" : "Stock resultante"}</th>
          <th style={{ textAlign: "left", minWidth: 160 }}>Motivo</th>
          <th style={{ textAlign: "left" }}>Referencia</th>
          <th style={{ textAlign: "left", whiteSpace: "nowrap" }}>Usuario</th>
        </tr>
      </thead>
      <tbody>
        {movs.map((m) => {
          const t = TIPOS_MOV[m.tipo] || { label: m.tipo, color: "var(--text-muted)", bg: "var(--neutral-bg)" };
          const cant = Number(m.cantidad) || 0;
          const signo = m.tipo === "entrada" || m.tipo === "traslado_entrada" ? "+" : m.tipo === "salida" || m.tipo === "traslado_salida" ? "−" : cant > 0 ? "+" : "−";
          return (
            <tr key={m.id}>
              <td style={{ whiteSpace: "nowrap", fontSize: 12.5 }}>{fmtFechaHora(m.created_at)}</td>
              {conSku && <td style={{ whiteSpace: "nowrap", fontWeight: 600, fontSize: 12.5 }}>{m.sku || "—"}</td>}
              <td>
                <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 999, background: t.bg, color: t.color, whiteSpace: "nowrap" }}>{t.label}</span>
              </td>
              {sucursales && (
                <td style={{ fontSize: 12, whiteSpace: "normal", minWidth: 110 }}>
                  {nombreDe(m.sucursal_id)}
                  {m.stock_resultante_sucursal != null && <div style={{ fontSize: 10.5, color: "var(--text-muted)", whiteSpace: "nowrap" }}>quedan {fmtNum(m.stock_resultante_sucursal)}</div>}
                </td>
              )}
              <td style={{ textAlign: "right", fontWeight: 700, whiteSpace: "nowrap", color: signo === "+" ? "#15803d" : "#b91c1c" }}>
                {signo}{fmtNum(Math.abs(cant))}
              </td>
              <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>{fmtNum(Number(m.stock_resultante) || 0)}</td>
              <td style={{ fontSize: 12.5, whiteSpace: "normal", wordBreak: "break-word" }}>{m.motivo || "—"}</td>
              <td style={{ fontSize: 12.5, whiteSpace: sucursales ? "normal" : "nowrap", wordBreak: "break-word" }}>{m.referencia || "—"}</td>
              <td style={{ fontSize: 12, color: "var(--text-muted)", whiteSpace: "nowrap" }}>{(m.usuario_email || "—").split("@")[0]}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

const estiloOverlay = { position: "fixed", inset: 0, background: "rgba(15,23,42,.55)", zIndex: 12000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 };
const estiloModal = (width) => ({ width, maxWidth: "100%", maxHeight: "90vh", overflowY: "auto", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: 22 });

const opcionesDe = (sucursales) => (sucursales || []).map((s) => ({ value: String(s.id), label: s.nombre, detalle: s.es_principal ? "Principal" : s.comuna || undefined }));

/* Modal para registrar UNA entrada, salida o ajuste (en una sucursal). */
function ModalMovimiento({ producto, tipoInicial, sucursales, sucursalInicial, onClose, onListo, onError }) {
  const [tipo, setTipo] = useState(tipoInicial || "entrada");
  const [cantidad, setCantidad] = useState("");
  const [nuevoStock, setNuevoStock] = useState("");
  const [motivo, setMotivo] = useState("");
  const [referencia, setReferencia] = useState("");
  const [costoUnitario, setCostoUnitario] = useState("");
  const [sucursalId, setSucursalId] = useState(sucursalInicial ? String(sucursalInicial) : sucursales?.[0] ? String(sucursales[0].id) : "");
  const [guardando, setGuardando] = useState(false);
  const conSucursal = !!sucursales;
  const stockActual = conSucursal ? stockEn(producto, sucursalId) : Number(producto.stock) || 0;
  const nombreSuc = sucursales?.find((s) => String(s.id) === sucursalId)?.nombre || "";

  async function guardar() {
    if (guardando) return;
    setGuardando(true);
    try {
      const body = {
        productoId: producto.id,
        tipo,
        motivo,
        referencia,
      };
      if (conSucursal && sucursalId) body.sucursalId = Number(sucursalId);
      if (tipo === "ajuste") body.nuevoStock = Number(String(nuevoStock).replace(",", "."));
      else body.cantidad = Number(String(cantidad).replace(",", "."));
      if (tipo === "entrada" && costoUnitario) body.costoUnitario = Number(String(costoUnitario).replace(/[^\d]/g, ""));
      const res = await api.post("/inventario/movimientos", body);
      onListo?.(res, tipo);
    } catch (e) {
      onError?.(e?.message || "No se pudo registrar el movimiento.");
    } finally {
      setGuardando(false);
    }
  }

  const t = TIPOS_MOV[tipo];
  return createPortal(
    <div onClick={(e) => { if (e.target === e.currentTarget) onClose(); }} style={estiloOverlay}>
      <div style={estiloModal(440)}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
          <h3 style={{ margin: 0, fontSize: 15.5, fontWeight: 700 }}>Registrar movimiento</h3>
          <button className="btn btn-ghost" onClick={onClose} style={{ padding: 6 }}><X size={16} /></button>
        </div>
        <p style={{ margin: "0 0 12px", fontSize: 12.5, color: "var(--text-muted)" }}>
          <b>{producto.sku || "sin SKU"}</b> · {producto.nombre} · stock vigente{conSucursal && sucursales.length > 1 ? ` en ${nombreSuc}` : ""}: <b>{fmtNum(stockActual)}</b>
          {conSucursal && sucursales.length > 1 && <> · total <b>{fmtNum(Number(producto.stock) || 0)}</b></>}
        </p>

        <div className="segmentado" style={{ display: "flex", marginBottom: 12 }}>
          {TIPOS_REGISTRABLES.map((key) => {
            const info = TIPOS_MOV[key];
            return (
              <button key={key} type="button" onClick={() => setTipo(key)}
                className={tipo === key ? "activo" : undefined}
                style={{ flex: 1, padding: "7px 0", fontSize: 12.5, fontWeight: 700, cursor: "pointer",
                  border: "1px solid var(--border)",
                  background: tipo === key ? info.bg : "var(--surface)", color: tipo === key ? info.color : "var(--text-muted)" }}>
                {info.label}
              </button>
            );
          })}
        </div>

        {conSucursal && sucursales.length > 1 && (
          <div style={{ marginBottom: 10 }}>
            <label className="filter-label">Sucursal</label>
            <DropdownSelect value={sucursalId} onChange={setSucursalId} options={opcionesDe(sucursales)} style={{ width: "100%" }} />
          </div>
        )}

        {tipo === "ajuste" ? (
          <div style={{ marginBottom: 10 }}>
            <label className="filter-label">Stock contado (conteo físico{conSucursal && sucursales.length > 1 ? ` en ${nombreSuc}` : ""})</label>
            <input className="input" inputMode="numeric" autoFocus value={nuevoStock}
              onChange={(e) => setNuevoStock(e.target.value.replace(/[^\d.,]/g, ""))}
              placeholder={`Vigente: ${fmtNum(stockActual)}`} />
            {nuevoStock !== "" && Number.isFinite(Number(nuevoStock.replace(",", "."))) && (
              <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 4 }}>
                Delta que quedará en el libro: <b>{Number(nuevoStock.replace(",", ".")) - stockActual > 0 ? "+" : ""}{fmtNum(Number(nuevoStock.replace(",", ".")) - stockActual)}</b>
              </div>
            )}
          </div>
        ) : (
          <div style={{ marginBottom: 10 }}>
            <label className="filter-label">Cantidad</label>
            <input className="input" inputMode="numeric" autoFocus value={cantidad}
              onChange={(e) => setCantidad(e.target.value.replace(/[^\d.,]/g, ""))}
              placeholder={tipo === "salida" ? `Disponible: ${fmtNum(stockActual)}` : "Unidades que entran"} />
          </div>
        )}

        {tipo === "entrada" && (
          <div style={{ marginBottom: 10 }}>
            <label className="filter-label">Costo unitario (opcional)</label>
            <input className="input" inputMode="numeric" value={costoUnitario ? `$${Number(costoUnitario.replace(/[^\d]/g, "") || 0).toLocaleString("es-CL")}` : ""}
              onChange={(e) => setCostoUnitario(e.target.value.replace(/[^\d]/g, ""))}
              placeholder="Costo de esta compra (queda en el libro)" />
          </div>
        )}

        <div style={{ marginBottom: 10 }}>
          <label className="filter-label">Motivo</label>
          <input className="input" value={motivo} onChange={(e) => setMotivo(e.target.value)}
            placeholder={tipo === "entrada" ? "Ej: Compra proveedor, devolución de cliente…" : tipo === "salida" ? "Ej: Venta, merma, muestra…" : "Ej: Inventario físico, corrección…"} />
        </div>
        <div style={{ marginBottom: 16 }}>
          <label className="filter-label">Referencia (opcional)</label>
          <input className="input" value={referencia} onChange={(e) => setReferencia(e.target.value)}
            placeholder="N° de OC, código de cotización, guía…" />
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button className="btn btn-secondary" onClick={onClose} disabled={guardando}>Cancelar</button>
          <button className="btn btn-primary" onClick={guardar} disabled={guardando} style={{ background: t.color, borderColor: t.color }}>
            {guardando ? "Guardando…" : `Registrar ${t.label.toLowerCase()}`}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

/* Carga masiva de conteo: planilla con columnas sku, stock y (opcional)
   stock_minimo. Cada diferencia queda como ajuste auditado en el libro.
   (2026-11-02) El conteo es de UNA sucursal (por defecto, la principal). */
function ModalCargaMasiva({ sucursales, principalId, onClose, onListo, onError }) {
  const [filas, setFilas] = useState([]);
  const [nombreArchivo, setNombreArchivo] = useState("");
  const [motivo, setMotivo] = useState("Inventario físico");
  const [sucursalId, setSucursalId] = useState(principalId ? String(principalId) : sucursales?.[0] ? String(sucursales[0].id) : "");
  const [parsing, setParsing] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const conSucursal = !!sucursales && sucursales.length > 1;

  async function manejarArchivo(file) {
    if (!file) return;
    setNombreArchivo(file.name);
    setParsing(true);
    try {
      const XLSX = await import("xlsx");
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const raw = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: "", raw: false });
      const norm = [];
      for (const row of raw) {
        const o = {};
        for (const [k, v] of Object.entries(row)) {
          const key = String(k || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "_");
          const val = String(v ?? "").trim();
          if (key === "sku") o.sku = val;
          else if (key === "stock" || key === "cantidad" || key === "conteo") o.stock = aNumero(val);
          else if (key.includes("minimo")) o.stock_minimo = aNumero(val);
        }
        if (o.sku && (Number.isFinite(o.stock) || Number.isFinite(o.stock_minimo))) norm.push(o);
      }
      setFilas(norm);
      if (!norm.length) onError?.("No se encontraron filas con columnas 'sku' y 'stock' (o 'stock_minimo').");
    } catch {
      onError?.("No se pudo leer el archivo. ¿Es un .xlsx / .csv válido?");
      setFilas([]);
    } finally {
      setParsing(false);
    }
  }

  async function enviar() {
    if (!filas.length || enviando) return;
    setEnviando(true);
    try {
      const body = { rows: filas, motivo };
      if (sucursales && sucursalId) body.sucursalId = Number(sucursalId);
      const res = await api.post("/inventario/carga-masiva", body);
      onListo?.(res);
    } catch (e) {
      onError?.(e?.message || "No se pudo procesar la carga.");
    } finally {
      setEnviando(false);
    }
  }

  return createPortal(
    <div onClick={(e) => { if (e.target === e.currentTarget) onClose(); }} style={estiloOverlay}>
      <div style={estiloModal(520)}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}>
            <Upload size={17} /> Carga masiva de inventario
          </h3>
          <button className="btn btn-ghost" onClick={onClose} style={{ padding: 6 }}><X size={16} /></button>
        </div>
        <p style={{ fontSize: 12.5, color: "var(--text-muted)", marginTop: 2, marginBottom: 14 }}>
          Planilla con columnas <b>sku</b> y <b>stock</b> (el conteo físico), y opcionalmente <b>stock_minimo</b>.
          Cada SKU cuyo conteo difiera del vigente{conSucursal ? " en la sucursal elegida" : ""} queda como un <b>ajuste</b> en el libro, con el motivo de abajo.
          Los SKUs que no existen en el catálogo se informan sin aplicar.
        </p>

        <label
          style={{ display: "block", border: "2px dashed var(--border)", borderRadius: 10, padding: "22px 16px", textAlign: "center", cursor: "pointer", background: "var(--bg)" }}>
          <Upload size={22} style={{ color: "var(--text-muted)" }} />
          <div style={{ fontSize: 13, marginTop: 6 }}>
            {nombreArchivo ? <strong>{nombreArchivo}</strong> : "Haz clic para elegir un archivo .xlsx / .xls / .csv"}
          </div>
          <input type="file" accept=".xlsx,.xls,.csv" style={{ display: "none" }} onChange={(e) => manejarArchivo(e.target.files?.[0])} />
        </label>

        {parsing && <p style={{ fontSize: 12.5, marginTop: 10 }}>Leyendo archivo…</p>}
        {!parsing && filas.length > 0 && (
          <p style={{ fontSize: 13, marginTop: 12 }}>
            <strong>{filas.length}</strong> fila(s) detectada(s).
          </p>
        )}

        {conSucursal && (
          <div style={{ marginTop: 12 }}>
            <label className="filter-label">Sucursal contada</label>
            <DropdownSelect value={sucursalId} onChange={setSucursalId} options={opcionesDe(sucursales)} style={{ width: "100%" }} />
          </div>
        )}

        <div style={{ marginTop: 12 }}>
          <label className="filter-label">Motivo del ajuste</label>
          <input className="input" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 18 }}>
          <button className="btn btn-secondary" onClick={onClose} disabled={enviando}>Cancelar</button>
          <button className="btn btn-primary" onClick={enviar} disabled={enviando || parsing || filas.length === 0}>
            {enviando ? "Procesando…" : `Aplicar ${filas.length || ""}`.trim()}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

/* Nuevo traslado entre sucursales: origen, destino, productos (buscados en el
   catálogo, con su stock en el origen) y cantidades. El backend vuelve a
   validar el stock antes de escribir. */
function ModalTraslado({ sucursales, principalId, filas, onClose, onListo, onError }) {
  const primera = sucursales.find((s) => String(s.id) === String(principalId)) || sucursales[0];
  const [origenId, setOrigenId] = useState(primera ? String(primera.id) : "");
  const [destinoId, setDestinoId] = useState(() => {
    const otra = sucursales.find((s) => String(s.id) !== String(primera?.id));
    return otra ? String(otra.id) : "";
  });
  const [lineas, setLineas] = useState([]); // [{ producto, cantidad: string }]
  const [q, setQ] = useState("");
  const [motivo, setMotivo] = useState("");
  const [referencia, setReferencia] = useState("");
  const [recibirAhora, setRecibirAhora] = useState(false);
  const [guardando, setGuardando] = useState(false);

  const origen = sucursales.find((s) => String(s.id) === origenId);
  const destino = sucursales.find((s) => String(s.id) === destinoId);
  const disponible = (p) => stockEn(p, origenId);

  const candidatos = useMemo(() => {
    const txt = q.trim().toLowerCase();
    if (!txt) return [];
    const ya = new Set(lineas.map((l) => l.producto.id));
    return filas
      .filter((p) => !p.bsale_huerfano && !ya.has(p.id) && (String(p.sku || "").toLowerCase().includes(txt) || String(p.nombre || "").toLowerCase().includes(txt) || String(p.marca || "").toLowerCase().includes(txt)))
      .sort((a, b) => disponible(b) - disponible(a) || String(a.sku || "").localeCompare(String(b.sku || "")))
      .slice(0, 8);
  }, [q, filas, lineas, origenId]); // eslint-disable-line react-hooks/exhaustive-deps

  function agregar(p) {
    setLineas((prev) => [...prev, { producto: p, cantidad: "1" }]);
    setQ("");
  }
  function cambiarCantidad(id, valor) {
    setLineas((prev) => prev.map((l) => (l.producto.id === id ? { ...l, cantidad: valor.replace(/[^\d.,]/g, "") } : l)));
  }
  function quitar(id) {
    setLineas((prev) => prev.filter((l) => l.producto.id !== id));
  }

  const problemas = [];
  if (!origenId || !destinoId) problemas.push("Elige origen y destino.");
  else if (origenId === destinoId) problemas.push("El origen y el destino tienen que ser distintos.");
  if (!lineas.length) problemas.push("Agrega al menos un producto.");
  for (const l of lineas) {
    const n = aNumero(l.cantidad);
    if (!Number.isFinite(n) || n <= 0) problemas.push(`${l.producto.sku || l.producto.nombre}: cantidad mayor a 0.`);
    else if (n > disponible(l.producto)) problemas.push(`${l.producto.sku || l.producto.nombre}: en ${origen?.nombre || "el origen"} hay ${fmtNum(disponible(l.producto))}.`);
  }
  const totalUnidades = lineas.reduce((a, l) => a + (aNumero(l.cantidad) || 0), 0);

  async function guardar() {
    if (guardando || problemas.length) return;
    setGuardando(true);
    try {
      const t = await api.post("/inventario/traslados", {
        origenId: Number(origenId),
        destinoId: Number(destinoId),
        lineas: lineas.map((l) => ({ productoId: l.producto.id, cantidad: aNumero(l.cantidad) })),
        motivo,
        referencia,
        recibirAhora,
      });
      onListo?.(t);
    } catch (e) {
      onError?.(e?.message || "No se pudo crear el traslado.");
    } finally {
      setGuardando(false);
    }
  }

  return createPortal(
    <div onClick={(e) => { if (e.target === e.currentTarget) onClose(); }} style={estiloOverlay}>
      <div style={estiloModal(680)}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
          <h3 style={{ margin: 0, fontSize: 15.5, fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}>
            <ArrowLeftRight size={16} /> Nuevo traslado entre sucursales
          </h3>
          <button className="btn btn-ghost" onClick={onClose} style={{ padding: 6 }}><X size={16} /></button>
        </div>
        <p style={{ margin: "0 0 12px", fontSize: 12.5, color: "var(--text-muted)" }}>
          El stock sale del origen de inmediato y queda <b>en tránsito</b> hasta que alguien lo reciba en el destino. El total del producto no cambia.
        </p>
        {origen?.bsale_office_id && destino?.bsale_office_id && origen.bsale_office_id !== destino.bsale_office_id && (
          <div style={{ margin: "0 0 12px", padding: "8px 12px", borderRadius: 8, background: "#fff7ed", border: "1px solid #fed7aa", fontSize: 12, display: "flex", gap: 8, alignItems: "flex-start" }}>
            <FileText size={14} style={{ color: "#c2410c", flexShrink: 0, marginTop: 1 }} />
            <span>Ambas sucursales existen en Bsale: después de crearlo, emite la <b>guía de traslado interno</b> desde la fila del traslado (botón «Guía Bsale») para que Bsale también mueva el stock entre sus sucursales.</span>
          </div>
        )}

        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <label className="filter-label">Origen</label>
            <DropdownSelect value={origenId} onChange={(v) => { setOrigenId(v); if (v === destinoId) setDestinoId(""); }} options={opcionesDe(sucursales)} style={{ width: "100%" }} />
          </div>
          <div style={{ flex: 1, minWidth: 200 }}>
            <label className="filter-label">Destino</label>
            <DropdownSelect value={destinoId} onChange={setDestinoId} placeholder="Elige el destino…"
              options={opcionesDe(sucursales.filter((s) => String(s.id) !== origenId))} style={{ width: "100%" }} />
          </div>
        </div>

        <div style={{ marginBottom: 10, position: "relative" }}>
          <label className="filter-label">Agregar producto</label>
          <div style={{ position: "relative" }}>
            <Search size={15} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)" }} />
            <input className="input" style={{ paddingLeft: 32 }} placeholder={`SKU, nombre o marca… (stock en ${origen?.nombre || "el origen"})`} value={q} onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && candidatos[0]) { e.preventDefault(); agregar(candidatos[0]); } }} />
          </div>
          {q.trim() && (
            <div style={{ position: "absolute", left: 0, right: 0, zIndex: 5, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, boxShadow: "0 8px 24px rgba(15,23,42,.12)", marginTop: 4, maxHeight: 260, overflowY: "auto" }}>
              {candidatos.length === 0 ? (
                <div style={{ padding: "10px 12px", fontSize: 12.5, color: "var(--text-muted)" }}>Sin productos para «{q}».</div>
              ) : candidatos.map((p) => {
                const disp = disponible(p);
                return (
                  <button key={p.id} type="button" onClick={() => agregar(p)} disabled={disp <= 0}
                    style={{ display: "flex", width: "100%", alignItems: "center", gap: 10, padding: "8px 12px", border: "none", borderBottom: "1px solid var(--border)", background: "none", cursor: disp > 0 ? "pointer" : "not-allowed", textAlign: "left", opacity: disp > 0 ? 1 : 0.55 }}>
                    <span style={{ fontWeight: 700, fontSize: 12.5, whiteSpace: "nowrap" }}>{p.sku || "—"}</span>
                    <span style={{ flex: 1, fontSize: 12.5, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.nombre}</span>
                    <span style={{ fontSize: 11.5, color: disp > 0 ? "var(--text)" : "var(--danger)", whiteSpace: "nowrap" }}>{fmtNum(disp)} en {origen?.nombre || "origen"}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div style={{ border: "1px solid var(--border)", borderRadius: 10, overflowX: "auto", marginBottom: 12 }}>
          {lineas.length === 0 ? (
            <div style={{ padding: "18px 14px", fontSize: 12.5, color: "var(--text-muted)" }}>Aún no hay productos en el traslado. Búscalos arriba y agrégalos.</div>
          ) : (
            <table className="data-table" style={{ width: "100%" }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left", whiteSpace: "nowrap" }}>SKU</th>
                  <th style={{ textAlign: "left" }}>Producto</th>
                  <th style={{ textAlign: "right", whiteSpace: "nowrap" }}>En {origen?.nombre || "origen"}</th>
                  <th style={{ textAlign: "right", whiteSpace: "nowrap" }}>Cantidad</th>
                  <th style={{ width: 36 }}></th>
                </tr>
              </thead>
              <tbody>
                {lineas.map((l) => {
                  const disp = disponible(l.producto);
                  const n = aNumero(l.cantidad);
                  const mal = !Number.isFinite(n) || n <= 0 || n > disp;
                  return (
                    <tr key={l.producto.id}>
                      <td style={{ fontWeight: 600, whiteSpace: "nowrap", fontSize: 12.5 }}>{l.producto.sku || "—"}</td>
                      <td style={{ fontSize: 12.5, whiteSpace: "normal", wordBreak: "break-word" }}>{l.producto.nombre}</td>
                      <td style={{ textAlign: "right", fontSize: 12.5 }}>{fmtNum(disp)}</td>
                      <td style={{ textAlign: "right" }}>
                        <input className="input" inputMode="numeric" value={l.cantidad} onChange={(e) => cambiarCantidad(l.producto.id, e.target.value)}
                          style={{ width: 90, height: 30, textAlign: "right", fontSize: 12.5, borderColor: mal ? "var(--danger)" : undefined }} />
                      </td>
                      <td>
                        <button className="btn btn-sm btn-ghost" onClick={() => quitar(l.producto.id)} title="Quitar" style={{ padding: 5, lineHeight: 0, color: "var(--text-muted)" }}><X size={14} /></button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 10 }}>
          <div style={{ flex: 2, minWidth: 200 }}>
            <label className="filter-label">Motivo (opcional)</label>
            <input className="input" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ej: Reposición de vitrina, pedido para despacho…" />
          </div>
          <div style={{ flex: 1, minWidth: 160 }}>
            <label className="filter-label">Referencia (opcional)</label>
            <input className="input" value={referencia} onChange={(e) => setReferencia(e.target.value)} placeholder="Guía, cotización…" />
          </div>
        </div>
        <label style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 12.5, cursor: "pointer", marginBottom: 14 }}>
          <input type="checkbox" checked={recibirAhora} onChange={(e) => setRecibirAhora(e.target.checked)} style={{ marginTop: 2 }} />
          <span>
            <b>Recibir de inmediato en {destino?.nombre || "el destino"}</b>
            <span style={{ color: "var(--text-muted)" }}> — el stock ya está allá (lo llevaste tú mismo); no queda en tránsito.</span>
          </span>
        </label>

        {problemas.length > 0 && lineas.length > 0 && (
          <div style={{ fontSize: 12, color: "#b45309", marginBottom: 10 }}>{problemas[0]}</div>
        )}

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 12.5, color: "var(--text-muted)" }}>
            {lineas.length} producto{lineas.length === 1 ? "" : "s"} · <b>{fmtNum(totalUnidades)}</b> unidades
          </span>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn btn-secondary" onClick={onClose} disabled={guardando}>Cancelar</button>
            <button className="btn btn-primary" onClick={guardar} disabled={guardando || problemas.length > 0} title={problemas[0] || undefined} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <ArrowLeftRight size={14} /> {guardando ? "Guardando…" : recibirAhora ? "Trasladar y recibir" : "Crear traslado"}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

/* Recepción de un traslado en tránsito: confirma cuánto llegó de cada línea.
   Lo que falte queda como ajuste negativo (merma en tránsito). */
function ModalRecibirTraslado({ traslado, onClose, onListo, onError }) {
  const [recibidas, setRecibidas] = useState(() => Object.fromEntries((traslado.lineas || []).map((l) => [l.id, String(l.cantidad)])));
  const [nota, setNota] = useState("");
  const [guardando, setGuardando] = useState(false);

  const problemas = [];
  let faltantes = 0;
  for (const l of traslado.lineas || []) {
    const n = aNumero(recibidas[l.id]);
    if (!Number.isFinite(n) || n < 0) problemas.push(`${l.sku || l.nombre}: cantidad inválida.`);
    else if (n > Number(l.cantidad)) problemas.push(`${l.sku || l.nombre}: se enviaron ${fmtNum(l.cantidad)}; si llegó de más, registra una entrada aparte.`);
    else faltantes += Number(l.cantidad) - n;
  }

  async function guardar() {
    if (guardando || problemas.length) return;
    setGuardando(true);
    try {
      const t = await api.post(`/inventario/traslados/${traslado.id}/recibir`, {
        lineas: (traslado.lineas || []).map((l) => ({ lineaId: l.id, cantidadRecibida: aNumero(recibidas[l.id]) })),
        nota,
      });
      onListo?.(t);
    } catch (e) {
      onError?.(e?.message || "No se pudo recibir el traslado.");
    } finally {
      setGuardando(false);
    }
  }

  return createPortal(
    <div onClick={(e) => { if (e.target === e.currentTarget) onClose(); }} style={estiloOverlay}>
      <div style={estiloModal(600)}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
          <h3 style={{ margin: 0, fontSize: 15.5, fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}>
            <PackageCheck size={16} /> Recibir traslado #{traslado.id}
          </h3>
          <button className="btn btn-ghost" onClick={onClose} style={{ padding: 6 }}><X size={16} /></button>
        </div>
        <p style={{ margin: "0 0 12px", fontSize: 12.5, color: "var(--text-muted)" }}>
          De <b>{traslado.origen?.nombre}</b> a <b>{traslado.destino?.nombre}</b> · {fmtFechaHora(traslado.created_at)}. Confirma cuánto llegó de cada producto: lo recibido entra a {traslado.destino?.nombre}; lo que falte queda como ajuste en el libro.
        </p>
        <div style={{ border: "1px solid var(--border)", borderRadius: 10, overflowX: "auto", marginBottom: 12 }}>
          <table className="data-table" style={{ width: "100%" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", whiteSpace: "nowrap" }}>SKU</th>
                <th style={{ textAlign: "left" }}>Producto</th>
                <th style={{ textAlign: "right", whiteSpace: "nowrap" }}>Enviadas</th>
                <th style={{ textAlign: "right", whiteSpace: "nowrap" }}>Recibidas</th>
              </tr>
            </thead>
            <tbody>
              {(traslado.lineas || []).map((l) => {
                const n = aNumero(recibidas[l.id]);
                const mal = !Number.isFinite(n) || n < 0 || n > Number(l.cantidad);
                const falta = !mal && n < Number(l.cantidad);
                return (
                  <tr key={l.id}>
                    <td style={{ fontWeight: 600, whiteSpace: "nowrap", fontSize: 12.5 }}>{l.sku || "—"}</td>
                    <td style={{ fontSize: 12.5, whiteSpace: "normal", wordBreak: "break-word" }}>{l.nombre}</td>
                    <td style={{ textAlign: "right", fontSize: 12.5 }}>{fmtNum(l.cantidad)}</td>
                    <td style={{ textAlign: "right" }}>
                      <input className="input" inputMode="numeric" value={recibidas[l.id] ?? ""} onChange={(e) => setRecibidas((r) => ({ ...r, [l.id]: e.target.value.replace(/[^\d.,]/g, "") }))}
                        style={{ width: 90, height: 30, textAlign: "right", fontSize: 12.5, borderColor: mal ? "var(--danger)" : falta ? "var(--warning)" : undefined }} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {faltantes > 0 && problemas.length === 0 && (
          <div style={{ fontSize: 12.5, color: "#b45309", marginBottom: 10, display: "flex", gap: 6, alignItems: "flex-start" }}>
            <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>Faltan <b>{fmtNum(faltantes)}</b> unidad{faltantes === 1 ? "" : "es"}: quedarán como ajuste negativo (merma en tránsito) y el stock total bajará.</span>
          </div>
        )}
        {problemas.length > 0 && <div style={{ fontSize: 12, color: "var(--danger)", marginBottom: 10 }}>{problemas[0]}</div>}
        <div style={{ marginBottom: 14 }}>
          <label className="filter-label">Nota de recepción (opcional)</label>
          <input className="input" value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Ej: Llegó una caja abierta, faltó 1 unidad…" />
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button className="btn btn-secondary" onClick={onClose} disabled={guardando}>Cancelar</button>
          <button className="btn btn-primary" onClick={guardar} disabled={guardando || problemas.length > 0} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <PackageCheck size={14} /> {guardando ? "Recibiendo…" : `Recibir en ${traslado.destino?.nombre || "destino"}`}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

/* Anulación de un traslado en tránsito: todo vuelve al origen. */
function ModalAnularTraslado({ traslado, onClose, onListo, onError }) {
  const [motivo, setMotivo] = useState("");
  const [guardando, setGuardando] = useState(false);

  async function guardar() {
    if (guardando) return;
    setGuardando(true);
    try {
      const t = await api.post(`/inventario/traslados/${traslado.id}/anular`, { motivo });
      onListo?.(t);
    } catch (e) {
      onError?.(e?.message || "No se pudo anular el traslado.");
    } finally {
      setGuardando(false);
    }
  }

  return createPortal(
    <div onClick={(e) => { if (e.target === e.currentTarget) onClose(); }} style={estiloOverlay}>
      <div style={estiloModal(460)}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
          <h3 style={{ margin: 0, fontSize: 15.5, fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}>
            <Ban size={16} style={{ color: "#b91c1c" }} /> Anular traslado #{traslado.id}
          </h3>
          <button className="btn btn-ghost" onClick={onClose} style={{ padding: 6 }}><X size={16} /></button>
        </div>
        <p style={{ margin: "0 0 12px", fontSize: 12.5, color: "var(--text-muted)" }}>
          Las <b>{fmtNum(traslado.unidades)}</b> unidades ({traslado.items} producto{traslado.items === 1 ? "" : "s"}) vuelven a <b>{traslado.origen?.nombre}</b> y el traslado queda anulado. Queda registrado en el libro.
        </p>
        <div style={{ marginBottom: 14 }}>
          <label className="filter-label">Motivo (opcional)</label>
          <input className="input" autoFocus value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ej: Se creó por error, el pedido se canceló…" />
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button className="btn btn-secondary" onClick={onClose} disabled={guardando}>Cancelar</button>
          <button className="btn btn-primary" onClick={guardar} disabled={guardando} style={{ background: "#b91c1c", borderColor: "#b91c1c", display: "inline-flex", alignItems: "center", gap: 6 }}>
            <Ban size={14} /> {guardando ? "Anulando…" : "Anular traslado"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

/* Guía de traslado interno en Bsale para un traslado en tránsito. Dos pasos,
   como el resto de las emisiones: 1) Simular muestra la guía como quedaría
   (no escribe nada); 2) con esa simulación a la vista y la casilla marcada,
   Emitir (real, irreversible ante el SII). Si la cuenta tiene la emisión
   apagada (BSALE_EMISION=off) solo se puede simular. */
function ModalGuiaBsaleTraslado({ traslado, onClose, onListo, onError }) {
  const [borrador, setBorrador] = useState(null); // null = cargando
  const [resultado, setResultado] = useState(null); // { simulacion } | { emitida }
  const [enviando, setEnviando] = useState(null); // "simular" | "emitir"
  const [confirmo, setConfirmo] = useState(false);

  useEffect(() => {
    let vivo = true;
    api.post("/bsale/traslados/preparar", { traslado_id: traslado.id })
      .then((b) => { if (vivo) setBorrador(b || { problemas: ["Respuesta vacía del servidor."], listo: false }); })
      .catch((e) => { if (vivo) setBorrador({ problemas: [e?.message || "No se pudo preparar la guía."], listo: false }); });
    return () => { vivo = false; };
  }, [traslado.id]);

  const apagada = borrador && borrador.emision_activa === false;
  const simulacionVigente = !!resultado?.simulacion && resultado.huella === borrador?.huella;
  const puedeEmitir = !!borrador?.listo && !apagada && simulacionVigente && confirmo && !enviando;

  async function enviar(modo) {
    if (!borrador?.listo || enviando) return;
    setEnviando(modo);
    try {
      const r = await api.post("/bsale/traslados/emitir", { traslado_id: traslado.id, huella: borrador.huella, simular: modo === "simular" });
      if (r?.simulacion) {
        setResultado({ ...r, huella: borrador.huella });
        setConfirmo(false);
      } else if (r?.emitida) {
        setResultado(r);
        onListo?.(r);
      } else {
        onError?.("Bsale respondió algo inesperado. Revisa en Bsale antes de volver a intentar.");
      }
    } catch (e) {
      onError?.(e?.message || "No se pudo emitir la guía.");
    } finally {
      setEnviando(null);
    }
  }

  return createPortal(
    <div onClick={(e) => { if (e.target === e.currentTarget && !enviando) onClose(); }} style={estiloOverlay}>
      <div style={estiloModal(760)}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
          <h3 style={{ margin: 0, fontSize: 15.5, fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}>
            <FileText size={16} /> Guía de traslado interno en Bsale · traslado #{traslado.id}
          </h3>
          <button className="btn btn-ghost" onClick={onClose} disabled={!!enviando} style={{ padding: 6 }}><X size={16} /></button>
        </div>
        <p style={{ margin: "0 0 12px", fontSize: 12.5, color: "var(--text-muted)" }}>
          Es el módulo de Bsale para mover mercadería entre sus sucursales: una guía de despacho electrónica de tipo «Traslados internos». Bsale descuenta el stock del origen al emitirla y suma el destino cuando lo <b>recepcionan en Bsale</b>; el sistema detecta esa recepción en la siguiente sincronización y da el traslado por recibido.
        </p>

        {borrador === null ? (
          <div style={{ padding: "24px 0", color: "var(--text-muted)" }}>Preparando el borrador con Bsale…</div>
        ) : (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10, marginBottom: 12, fontSize: 12.5 }}>
              <div style={{ border: "1px solid var(--border)", borderRadius: 10, padding: "8px 12px" }}>
                <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", color: "var(--text-muted)" }}>Origen</div>
                <div style={{ fontWeight: 700 }}>{borrador.origen?.nombre || traslado.origen?.nombre}</div>
                <div style={{ color: "var(--text-muted)" }}>{borrador.origen?.oficina ? `${borrador.origen.oficina.nombre} (sucursal ${borrador.origen.bsale_office_id} de Bsale)` : borrador.origen?.bsale_office_id ? `sucursal ${borrador.origen.bsale_office_id} de Bsale` : "sin sucursal en Bsale"}</div>
              </div>
              <div style={{ border: "1px solid var(--border)", borderRadius: 10, padding: "8px 12px" }}>
                <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", color: "var(--text-muted)" }}>Destino</div>
                <div style={{ fontWeight: 700 }}>{borrador.destino?.nombre || traslado.destino?.nombre}</div>
                <div style={{ color: "var(--text-muted)" }}>{borrador.destino?.oficina ? `${borrador.destino.oficina.nombre} (sucursal ${borrador.destino.bsale_office_id} de Bsale)` : borrador.destino?.bsale_office_id ? `sucursal ${borrador.destino.bsale_office_id} de Bsale` : "sin sucursal en Bsale"}</div>
                {borrador.despacho && <div style={{ color: "var(--text-muted)" }}>{[borrador.despacho.direccion, borrador.despacho.comuna].filter(Boolean).join(", ") || "sin dirección"}</div>}
              </div>
            </div>

            {(borrador.problemas || []).length > 0 && (
              <div style={{ marginBottom: 12, padding: "10px 14px", borderRadius: 10, background: "#fee2e2", border: "1px solid #fecaca", fontSize: 12.5, color: "#991b1b" }}>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>No se puede emitir todavía:</div>
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {borrador.problemas.map((p, i) => <li key={i}>{p}</li>)}
                </ul>
              </div>
            )}

            {!resultado?.simulacion && (borrador.lineas || []).length > 0 && (
              <div style={{ border: "1px solid var(--border)", borderRadius: 10, overflowX: "auto", marginBottom: 12 }}>
                <table className="data-table" style={{ width: "100%" }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: "left", whiteSpace: "nowrap" }}>SKU</th>
                      <th style={{ textAlign: "left" }}>Producto</th>
                      <th style={{ textAlign: "right", whiteSpace: "nowrap" }}>Cantidad</th>
                      <th style={{ textAlign: "right", whiteSpace: "nowrap" }} title="Costo neto del catálogo: la guía electrónica lleva valores, pero no es una venta">Valor neto</th>
                      <th style={{ textAlign: "left", whiteSpace: "nowrap" }}>En Bsale</th>
                    </tr>
                  </thead>
                  <tbody>
                    {borrador.lineas.map((l, i) => (
                      <tr key={`${l.sku}-${i}`}>
                        <td style={{ fontWeight: 600, whiteSpace: "nowrap", fontSize: 12.5 }}>{l.sku || "—"}</td>
                        <td style={{ fontSize: 12.5, whiteSpace: "normal", wordBreak: "break-word" }}>{l.producto}</td>
                        <td style={{ textAlign: "right", fontSize: 12.5 }}>{fmtNum(l.cantidad)}</td>
                        <td style={{ textAlign: "right", fontSize: 12.5 }}>{fmtCLP(l.neto_unitario)}</td>
                        <td>{l.en_bsale ? <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 999, background: "#dcfce7", color: "#15803d" }}>Sí</span> : <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 999, background: "#fee2e2", color: "#b91c1c" }}>No</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {resultado?.simulacion && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginBottom: 8 }}>
                  Simulación: así quedaría la guía. No se envió nada a Bsale.
                  {apagada ? " La emisión real está apagada en el servidor (BSALE_EMISION=off)." : simulacionVigente ? " Si está bien, marca la casilla y emítela." : " Cambió el borrador: vuelve a simular."}
                </div>
                <VistaPreviaBsale vista={resultado.vista} solicitud={resultado.solicitud} titulo="Así quedaría la guía de traslado interno" />
              </div>
            )}

            {borrador.listo && !apagada && simulacionVigente && (
              <label style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 12.5, cursor: "pointer", marginBottom: 12 }}>
                <input type="checkbox" checked={confirmo} onChange={(e) => setConfirmo(e.target.checked)} disabled={!!enviando} style={{ marginTop: 2 }} />
                <span>Revisé la simulación y quiero <b>emitir la guía oficial en Bsale</b> (va al SII; no se puede deshacer desde acá).</span>
              </label>
            )}

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}>
              <button className="btn btn-secondary" onClick={onClose} disabled={!!enviando}>Cerrar</button>
              <button className="btn btn-secondary" onClick={() => enviar("simular")} disabled={!borrador.listo || !!enviando} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                {enviando === "simular" ? "Simulando…" : simulacionVigente ? "Simular de nuevo" : "1. Simular"}
              </button>
              {!apagada && simulacionVigente && (
                <button className="btn btn-primary" onClick={() => enviar("emitir")} disabled={!puedeEmitir} title={confirmo ? "" : "Marca la casilla de confirmación"} style={{ display: "inline-flex", alignItems: "center", gap: 6, opacity: puedeEmitir ? 1 : 0.5 }}>
                  <FileText size={14} /> {enviando === "emitir" ? "Emitiendo…" : "2. Emitir guía oficial"}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>,
    document.body
  );
}

/* Mantenedor: crear o editar una sucursal. */
function ModalSucursal({ sucursal, oficinas, onClose, onListo, onError }) {
  const editando = !!sucursal;
  const [nombre, setNombre] = useState(sucursal?.nombre || "");
  const [direccion, setDireccion] = useState(sucursal?.direccion || "");
  const [comuna, setComuna] = useState(sucursal?.comuna || "");
  const [bsaleOffice, setBsaleOffice] = useState(sucursal?.bsale_office_id ? String(sucursal.bsale_office_id) : "");
  const [esPrincipal, setEsPrincipal] = useState(!!sucursal?.es_principal);
  const [guardando, setGuardando] = useState(false);

  async function guardar() {
    if (guardando) return;
    if (!nombre.trim()) { onError?.("La sucursal necesita un nombre."); return; }
    setGuardando(true);
    try {
      const body = { nombre: nombre.trim(), direccion, comuna, bsale_office_id: bsaleOffice ? Number(bsaleOffice) : null, es_principal: esPrincipal };
      const s = editando ? await api.put(`/inventario/sucursales/${sucursal.id}`, body) : await api.post("/inventario/sucursales", body);
      onListo?.(s, !editando);
    } catch (e) {
      onError?.(e?.message || "No se pudo guardar la sucursal.");
    } finally {
      setGuardando(false);
    }
  }

  return createPortal(
    <div onClick={(e) => { if (e.target === e.currentTarget) onClose(); }} style={estiloOverlay}>
      <div style={estiloModal(460)}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
          <h3 style={{ margin: 0, fontSize: 15.5, fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}>
            <Store size={16} /> {editando ? `Editar ${sucursal.nombre}` : "Nueva sucursal"}
          </h3>
          <button className="btn btn-ghost" onClick={onClose} style={{ padding: 6 }}><X size={16} /></button>
        </div>
        <p style={{ margin: "0 0 12px", fontSize: 12.5, color: "var(--text-muted)" }}>
          Una sucursal o bodega propia donde se guarda stock. {!editando && "Nace sin stock: muévelo con un traslado o registra un ajuste con su conteo."}
        </p>
        <div style={{ marginBottom: 10 }}>
          <label className="filter-label">Nombre</label>
          <input className="input" autoFocus value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej: Bodega Santiago Centro" maxLength={80} />
        </div>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 10 }}>
          <div style={{ flex: 2, minWidth: 180 }}>
            <label className="filter-label">Dirección (opcional)</label>
            <input className="input" value={direccion} onChange={(e) => setDireccion(e.target.value)} placeholder="Calle y número" />
          </div>
          <div style={{ flex: 1, minWidth: 140 }}>
            <label className="filter-label">Comuna (opcional)</label>
            <input className="input" value={comuna} onChange={(e) => setComuna(e.target.value)} placeholder="Comuna" />
          </div>
        </div>
        <div style={{ marginBottom: 12 }}>
          <label className="filter-label">Sucursal en Bsale (opcional)</label>
          {Array.isArray(oficinas) && oficinas.length > 0 ? (
            <DropdownSelect value={bsaleOffice} onChange={setBsaleOffice} style={{ width: "100%" }}
              options={[
                { value: "", label: "Sin sucursal en Bsale", detalle: "Bodega solo del sistema: la sincronización no la toca" },
                ...oficinas.map((o) => ({ value: String(o.id), label: `${o.nombre} (${o.id})`, detalle: [o.direccion, o.comuna].filter(Boolean).join(", ") || undefined, color: o.activa ? "#16a34a" : "#9ca3af" })),
              ]} />
          ) : (
            <input className="input" inputMode="numeric" value={bsaleOffice} onChange={(e) => setBsaleOffice(e.target.value.replace(/[^\d]/g, ""))} placeholder="id de la sucursal en Bsale (offices.json)" />
          )}
          <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 4 }}>
            Asociada a una sucursal de Bsale, la sincronización deja acá exactamente el stock que Bsale tiene en ella, y los traslados hacia otra sucursal asociada pueden emitir la guía de traslado interno en Bsale.
          </div>
        </div>
        <label style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 12.5, cursor: sucursal?.es_principal ? "default" : "pointer", marginBottom: 16 }}>
          <input type="checkbox" checked={esPrincipal} disabled={sucursal?.es_principal} onChange={(e) => setEsPrincipal(e.target.checked)} style={{ marginTop: 2 }} />
          <span>
            <b>Sucursal principal</b>
            <span style={{ color: "var(--text-muted)" }}> — recibe los movimientos sin sucursal y las diferencias de la sincronización con Bsale. {sucursal?.es_principal ? "Para cambiarla, marca otra como principal." : "Reemplaza a la actual."}</span>
          </span>
        </label>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button className="btn btn-secondary" onClick={onClose} disabled={guardando}>Cancelar</button>
          <button className="btn btn-primary" onClick={guardar} disabled={guardando || !nombre.trim()}>
            {guardando ? "Guardando…" : editando ? "Guardar cambios" : "Crear sucursal"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
