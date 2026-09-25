import { Fragment, useEffect, useMemo, useState, useRef } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import Toast from "../components/Toast";
import { descargarReportePDF } from "../lib/reporteStock";
import BotonLimpiarFiltros from "../components/BotonLimpiarFiltros";
import {
  Inbox,
  ShoppingCart,
  Package,
  ExternalLink,
  MessageCircle,
  FilePlus,
  FileDown,
  RefreshCw,
  Phone,
  Mail,
  MapPin,
  ChevronDown,
  ChevronRight,
  ChevronLeft,
} from "lucide-react";

/* ============================================================
   PEDIDOS DEL PORTAL (2026-09-10)
   Bandeja del equipo con TODOS los pedidos y solicitudes generados desde el
   portal cliente, sin importar el origen (carrito del Explorador de Precios
   o Gestión de Stock). Control compacto: tabla paginada con una fila por
   pedido y detalle expandible con la ficha completa.
============================================================ */

const TEAL = "#0d9488";
const POR_PAGINA = 10;

const ESTADOS = [
  { value: "pendiente", label: "Pendiente", bg: "#fef9c3", fg: "#a16207" },
  { value: "respondida", label: "Respondida", bg: "#dcfce7", fg: "#15803d" },
  { value: "cancelada", label: "Cancelada", bg: "#fee2e2", fg: "#b91c1c" },
];
const estadoMeta = (e) => ESTADOS.find((x) => x.value === e) || ESTADOS[0];

/* Etapas del flujo de aprobación y pago (2026-09-16). Es una dimensión
   distinta del estado comercial de arriba: describe en qué punto del
   camino va el pedido, de quién depende avanzar y cuánto se demoró. */
const FLUJO = [
  { value: "pendiente_aprobacion", label: "Espera al cliente", bg: "#fef3c7", fg: "#b45309", ayuda: "El pedido lo armó un asistente; falta que lo apruebe el administrador de la cuenta." },
  { value: "aprobado_cliente", label: "Por validar", bg: "#e0f2fe", fg: "#0369a1", ayuda: "El cliente ya aprobó: nos toca confirmar existencias y emitir el link de pago." },
  { value: "validado_plataforma", label: "Por pagar", bg: "#ede9fe", fg: "#6d28d9", ayuda: "Existencias confirmadas y link de pago enviado; esperamos el pago." },
  { value: "pagado", label: "Pagado", bg: "#dcfce7", fg: "#15803d", ayuda: "Pagado. Plazo de despacho: 48 a 72 hrs." },
  { value: "rechazado", label: "Rechazado", bg: "#fee2e2", fg: "#b91c1c", ayuda: "El pedido fue rechazado." },
  { value: "cancelado", label: "Cancelado", bg: "#f1f5f9", fg: "#475569", ayuda: "El pedido fue cancelado." },
];
const flujoDe = (s) => String(s?.flujo_estado || "pendiente_aprobacion");
const flujoMeta = (v) => FLUJO.find((f) => f.value === v) || FLUJO[0];

function BadgeFlujo({ valor }) {
  const m = flujoMeta(valor);
  return (
    <span
      title={m.ayuda}
      style={{
        display: "inline-block", fontSize: 10.5, fontWeight: 800, textTransform: "uppercase",
        letterSpacing: ".03em", padding: "3px 9px", borderRadius: 999,
        background: m.bg, color: m.fg, whiteSpace: "nowrap",
      }}
    >
      {m.label}
    </span>
  );
}

// Horas entre dos marcas de tiempo, en formato corto ("3,2 h" / "2 d").
function lapso(desde, hasta) {
  if (!desde || !hasta) return null;
  const h = (new Date(hasta).getTime() - new Date(desde).getTime()) / 3600000;
  if (!Number.isFinite(h) || h < 0) return null;
  if (h < 24) return `${h.toFixed(1).replace(".", ",")} h`;
  return `${Math.round(h / 24)} d`;
}

function formatearRutVisual(input) {
  const limpio = String(input || "").replace(/[^0-9kK]/g, "");
  if (!limpio) return "";
  const cuerpo = limpio.slice(0, -1);
  const dv = limpio.slice(-1).toUpperCase();
  const conPuntos = cuerpo.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return cuerpo ? `${conPuntos}-${dv}` : dv;
}

const fmtCLP = (n) => `$${Math.round(Number(n) || 0).toLocaleString("es-CL")}`;

function fmtFechaHora(iso) {
  const s = String(iso || "");
  if (!s) return "—";
  const [y, m, d] = s.slice(0, 10).split("-");
  const hora = s.length > 10 ? s.slice(11, 16) : "";
  return `${d}-${m}-${y}${hora ? ` · ${hora}` : ""}`;
}

// Origen del pedido: el carrito del explorador deja referencia de tienda /
// precio / url en los ítems (y lo dice la nota); lo demás viene de la
// gestión de stock del portal.
function origenDe(s) {
  // (2026-09-24) Desde el Showroom el pedido viaja diciendo de donde salio;
  // los anteriores siguen deduciendose como antes.
  const declarado = String(s?.origen_seccion || "").trim();
  if (declarado === "showroom" || declarado === "explorador" || declarado === "stock") return declarado;
  const items = Array.isArray(s.items) ? s.items : [];
  const conRef = items.some((i) => i?.tienda || i?.precio_referencia || i?.url);
  if (conRef || /explorador/i.test(String(s.nota || ""))) return "explorador";
  return "stock";
}

/* Cuanto vale un pedido: el monto que Amsodent valido si ya lo hay, o la suma
   de los precios de referencia mientras tanto. Es lo que alimenta el KPI de
   Showroom, que mide venta, no cantidad de pedidos. */
function montoDe(s) {
  const validado = Number(s?.monto_total) || 0;
  if (validado > 0) return validado;
  return (Array.isArray(s?.items) ? s.items : []).reduce(
    (acc, i) => acc + (Number(i?.precio_referencia) || 0) * (Number(i?.cantidad) || 0),
    0,
  );
}

const TONO_ORIGEN = {
  showroom: { bg: "#fdf2f8", color: "#be185d", borde: "#fbcfe8", corto: "Showroom", largo: "Showroom" },
  explorador: { bg: "#f0fdfa", color: TEAL, borde: "#ccfbf1", corto: "Explorador", largo: "Explorador de Precios" },
  stock: { bg: "#f1f5f9", color: "#475569", borde: "#e2e8f0", corto: "Stock", largo: "Gestión de Stock" },
};

function BadgeOrigen({ origen, compacto = false }) {
  const t = TONO_ORIGEN[origen] || TONO_ORIGEN.stock;
  const Icono = origen === "stock" ? Package : ShoppingCart;
  return (
    <span
      style={{
        display: "inline-flex", alignItems: "center", gap: 5, fontSize: 10.5, fontWeight: 800,
        textTransform: "uppercase", letterSpacing: ".03em", padding: "3px 9px", borderRadius: 999,
        background: t.bg,
        color: t.color,
        border: `1px solid ${t.borde}`,
        whiteSpace: "nowrap",
      }}
    >
      <Icono size={11} />
      {compacto ? t.corto : t.largo}
    </span>
  );
}

export default function PedidosPortal() {
  const [pedidos, setPedidos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);

  const [fTexto, setFTexto] = useState("");
  const [fEstado, setFEstado] = useState("");
  const [fOrigen, setFOrigen] = useState("");
  const [pagina, setPagina] = useState(1);
  const [expandidoId, setExpandidoId] = useState(null);

  async function cargar() {
    setLoading(true);
    try {
      const data = await api.get("/stock-clientes/solicitudes");
      setPedidos(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error(e);
      setToast({ type: "error", message: "No se pudieron cargar los pedidos del portal." });
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { cargar(); }, []);

  /* (2026-09-24) Refresco al volver a la bandeja. "Crear cotizacion" abre /crear
     en una pestana nueva; al guardarla alla, el pedido pasa a "Respondida" y
     queda vinculado, pero esta pantalla seguia mostrando el estado viejo hasta
     que alguien recargaba. Ahora se recarga sola al volver el foco, que es
     justo cuando el usuario vuelve de crear la cotizacion.
     (2026-09-25) El refresco es SILENCIOSO: antes pasaba por `cargar()`, que
     pone `loading` y reemplaza toda la pantalla por "Cargando pedidos…" —
     se veia como si la pagina se recargara sola cada vez que se apretaba
     "Crear" y se perdia el detalle abierto y el scroll. Ahora se piden los
     datos por detras y se reemplazan en su lugar, como maximo una vez cada
     5 s (el foco y visibilitychange suelen disparar juntos). */
  const ultimoRefrescoRef = useRef(0);
  async function refrescarSilencioso() {
    const ahora = Date.now();
    if (ahora - ultimoRefrescoRef.current < 5000) return;
    ultimoRefrescoRef.current = ahora;
    try {
      const data = await api.get("/stock-clientes/solicitudes");
      if (Array.isArray(data)) setPedidos(data);
      cargarKpis();
    } catch {
      /* sin ruido: si falla, la bandeja queda como estaba */
    }
  }
  useEffect(() => {
    const alVolver = () => {
      if (document.visibilityState === "visible") refrescarSilencioso();
    };
    window.addEventListener("focus", alVolver);
    document.addEventListener("visibilitychange", alVolver);
    return () => {
      window.removeEventListener("focus", alVolver);
      document.removeEventListener("visibilitychange", alVolver);
    };
    // refrescarSilencioso se redefine en cada render pero hace siempre lo mismo.
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Cambiar cualquier filtro vuelve a la página 1 y colapsa el detalle.
  useEffect(() => {
    setPagina(1);
    setExpandidoId(null);
  }, [fTexto, fEstado, fOrigen]);

  const filtrados = useMemo(() => {
    const q = fTexto.trim().toLowerCase();
    const qRut = q.replace(/[.\-\s]/g, "");
    return pedidos.filter((s) => {
      if (fEstado && (s.estado || "pendiente") !== fEstado) return false;
      if (fOrigen && origenDe(s) !== fOrigen) return false;
      if (!q) return true;
      const items = Array.isArray(s.items) ? s.items : [];
      return (
        String(s.razon_social || "").toLowerCase().includes(q) ||
        String(s.rut || "").replace(/[.\-\s]/g, "").includes(qRut) ||
        String(s.nota || "").toLowerCase().includes(q) ||
        String(s.contacto_nombre || "").toLowerCase().includes(q) ||
        String(s.id) === q ||
        items.some((i) => String(i?.nombre || "").toLowerCase().includes(q))
      );
    });
  }, [pedidos, fTexto, fEstado, fOrigen]);

  const totalPaginas = Math.max(1, Math.ceil(filtrados.length / POR_PAGINA));
  const paginaActual = Math.min(pagina, totalPaginas);
  const visibles = filtrados.slice((paginaActual - 1) * POR_PAGINA, paginaActual * POR_PAGINA);

  const stats = useMemo(() => {
    const total = pedidos.length;
    const porEstado = { pendiente: 0, respondida: 0, cancelada: 0 };
    let explorador = 0;
    // KPI del Showroom (2026-09-24): no cuantos pedidos, sino CUANTO se vende
    // por ahi. `vendido` cuenta solo lo pagado, que es la venta de verdad;
    // `enCurso` es lo que todavia esta en el flujo.
    let showroom = 0;
    let showroomVendido = 0;
    let showroomEnCurso = 0;
    pedidos.forEach((s) => {
      const e = s.estado || "pendiente";
      porEstado[e] = (porEstado[e] || 0) + 1;
      const origen = origenDe(s);
      if (origen === "explorador") explorador++;
      if (origen === "showroom") {
        showroom++;
        const monto = montoDe(s);
        if (String(s.flujo_estado || "") === "pagado") showroomVendido += monto;
        else if (!["cancelado", "rechazado"].includes(String(s.flujo_estado || ""))) showroomEnCurso += monto;
      }
    });
    return { total, ...porEstado, explorador, showroom, showroomVendido, showroomEnCurso };
  }, [pedidos]);

  /* ── Acciones del flujo (2026-09-16) ───────────────────────────────── */

  const [modalValidar, setModalValidar] = useState(null); // pedido a validar
  // { rut, razon } de la cuenta cuyo historial del portal se esta viendo.
  const [historialCliente, setHistorialCliente] = useState(null);
  const [kpis, setKpis] = useState(null);
  const [accionando, setAccionando] = useState(false);

  async function cargarKpis() {
    try {
      setKpis(await api.get("/stock-clientes/solicitudes-kpis"));
    } catch { setKpis(null); /* la migración puede estar pendiente */ }
  }
  useEffect(() => { cargarKpis(); }, []);

  function reemplazar(pedido) {
    setPedidos((prev) => prev.map((p) => (p.id === pedido.id ? { ...p, ...pedido } : p)));
  }

  async function validarPedido(pedido, payload) {
    setAccionando(true);
    try {
      const r = await api.post(`/stock-clientes/solicitudes/${pedido.id}/validar`, payload);
      reemplazar(r.pedido);
      setModalValidar(null);
      setToast({ type: "success", message: "Existencias confirmadas y link de pago enviado al cliente." });
      cargarKpis();
    } catch (e) {
      setToast({ type: "error", message: e?.message || "No se pudo validar el pedido." });
    } finally {
      setAccionando(false);
    }
  }

  async function revertirPedido(pedido) {
    const motivo = window.prompt(
      "¿Por qué se devuelve el pedido a la etapa anterior?\n(Queda registrado en la bitácora del pedido.)",
      "",
    );
    if (motivo === null) return;
    try {
      const r = await api.post(`/stock-clientes/solicitudes/${pedido.id}/revertir`, { motivo });
      reemplazar(r.pedido);
      setToast({ type: "success", message: "El pedido volvió a la etapa anterior." });
      cargarKpis();
    } catch (e) {
      setToast({ type: "error", message: e?.message || "No se pudo revertir el pedido." });
    }
  }

  async function alternarSos(pedido) {
    const activo = Boolean(pedido.sos);
    let motivo = "";
    if (!activo) {
      motivo = window.prompt("SOS: el pedido se despacha dentro de 24 hrs.\n¿Motivo?", "") ?? null;
      if (motivo === null) return;
    } else if (!window.confirm("¿Quitar el SOS de este pedido?")) {
      return;
    }
    try {
      const r = await api.post(`/stock-clientes/solicitudes/${pedido.id}/sos`, { motivo, quitar: activo });
      reemplazar(r.pedido);
      setToast({ type: "success", message: activo ? "SOS retirado." : "Pedido marcado como SOS: despacho en 24 hrs." });
      cargarKpis();
    } catch (e) {
      setToast({ type: "error", message: e?.message || "No se pudo cambiar el SOS." });
    }
  }

  async function cambiarEstado(s, estado) {
    const anterior = s.estado;
    setPedidos((prev) => prev.map((p) => (p.id === s.id ? { ...p, estado } : p)));
    try {
      await api.put(`/stock-clientes/solicitudes/${s.id}/estado`, { estado });
    } catch (e) {
      setPedidos((prev) => prev.map((p) => (p.id === s.id ? { ...p, estado: anterior } : p)));
      setToast({ type: "error", message: "No se pudo cambiar el estado." });
    }
  }

  // Descarga el detalle del pedido como PDF con la marca Amsodent (mismo
  // motor de reportes del stock: jsPDF).
  async function descargarPdfPedido(s) {
    const items = Array.isArray(s.items) ? s.items : [];
    const origen = origenDe(s);
    const totalRef = items.reduce(
      (acc, i) => acc + Number(i?.precio_referencia || 0) * Number(i?.cantidad || 0),
      0,
    );
    const rows = items.map((i) => [
      `${i?.nombre || "—"}${i?.observacion ? `\nObs: ${i.observacion}` : ""}`,
      `${i?.cantidad || 0}${i?.unidad ? ` ${i.unidad}` : ""}`,
      i?.tienda || "—",
      i?.precio_referencia ? fmtCLP(i.precio_referencia) : "—",
      i?.precio_referencia ? fmtCLP(Number(i.precio_referencia) * Number(i?.cantidad || 0)) : "—",
    ]);
    if (totalRef > 0) rows.push(["TOTAL REFERENCIAL", "", "", "", fmtCLP(totalRef)]);
    const contacto = [s.contacto_nombre, s.contacto_email, s.contacto_telefono].filter(Boolean).join(" · ");
    if (contacto) rows.push([`Contacto: ${contacto}`, "", "", "", ""]);
    if (s.nota) rows.push([`Nota del cliente: ${s.nota}`, "", "", "", ""]);
    try {
      await descargarReportePDF({
        filename: `pedido-portal-${s.id}.pdf`,
        orientation: "portrait",
        titulo: `Pedido del Portal N° ${s.id}`,
        subtitulo: origen === "explorador" ? "Origen: Explorador de Precios" : "Origen: Gestión de Stock",
        meta: [
          { label: "Cliente", valor: s.razon_social || "—" },
          { label: "RUT", valor: formatearRutVisual(s.rut) || "—" },
          { label: "Fecha", valor: fmtFechaHora(s.created_at) },
          { label: "Estado", valor: estadoMeta(s.estado || "pendiente").label },
          ...(s.sucursal_nombre ? [{ label: "Sucursal", valor: s.sucursal_nombre }] : []),
        ],
        resumen: [
          { label: "Productos", valor: items.length, tono: "neutro" },
          { label: "Unidades", valor: items.reduce((a, i) => a + Number(i?.cantidad || 0), 0), tono: "neutro" },
          ...(totalRef > 0 ? [{ label: "Total referencial", valor: fmtCLP(totalRef), tono: "verde" }] : []),
        ],
        headers: ["Producto", "Cantidad", "Tienda ref.", "Precio ref.", "Subtotal ref."],
        aligns: ["left", "center", "left", "right", "right"],
        rows,
      });
    } catch (e) {
      console.error(e);
      setToast({ type: "error", message: "No se pudo generar el PDF del pedido." });
    }
  }

  // Arranca una cotización desde el pedido: precarga cliente + observaciones
  // con el detalle y deja el vínculo (solicitud_stock_id) para que al
  // guardarse quede asociada y el pedido pase a "Respondida".
  // Se abre en una PESTAÑA NUEVA: el borrador viaja por localStorage (la
  // misma clave que hidrata /crear), así la bandeja queda abierta.
  function crearCotizacion(s) {
    /* (2026-09-24) La cotizacion ya no nace con el bloque de observaciones
       generales. Se volcaba ahi el pedido entero -- cabecera, una linea por
       producto y la nota del cliente -- y eso terminaba impreso en el PDF que
       ve el cliente, repitiendo lo que el detalle de la cotizacion ya dice.
       El pedido sigue accesible por `solicitud_stock_id` y en la bandeja. */

    /* OJO: aquí NO se marca "respondida". Abrir el formulario no es responder:
       el estado lo cambia el guardado de la cotización (vincularLicitacion),
       que es cuando el cliente de verdad tiene su cotización en el portal.
       Antes se marcaba al abrir y quedaban pedidos "respondidos" sin
       cotización si la pestaña se cerraba sin guardar. */
    /* (2026-09-25) El borrador viaja con los PRODUCTOS del pedido que son de
       Amsodent: los del Showroom (traen SKU), los de Gestión de Stock (sin
       tienda; son lo que el cliente nos pide) y los hallazgos del Explorador
       cuya tienda es la web de Amsodent (amsodentmedical.cl). /crear los
       calza contra el catálogo por SKU o por nombre y les pone precio de
       lista; el que no calce (la web tiene productos que el catálogo interno
       no tiene) entra igual como línea libre con el precio web en neto, para
       que el vendedor lo complete. Los hallazgos de OTRAS tiendas no son
       productos nuestros: quedan fuera y se avisa cuántos fueron. */
    const items = Array.isArray(s.items) ? s.items : [];
    const esNuestro = (i) => {
      if (String(i?.sku || "").trim()) return true;
      const tienda = String(i?.tienda || "").trim().toLowerCase();
      if (!tienda && !i?.url) return true; // Gestión de Stock
      return tienda.includes("amsodent") || /amsodentmedical\.cl/i.test(String(i?.url || ""));
    };
    const itemsPorSku = items
      .filter(esNuestro)
      .map((i) => ({
        sku: String(i?.sku || "").trim(),
        nombre: i?.nombre || "",
        cantidad: Math.max(1, Number(i?.cantidad || 1)),
        observacion: String(i?.observacion || "").trim(),
        precio_referencia: Number(i?.precio_referencia || 0) || 0,
        tienda: String(i?.tienda || "").trim(),
      }));
    const sinSku = items.length - itemsPorSku.length;
    const draft = {
      rutEntidad: formatearRutVisual(s.rut),
      nombreEntidad: s.razon_social || "",
      tipoCliente: "Entidad Pública",
      tipoCompra: "Compra ágil",
      listado: "2",
      contacto: s.contacto_nombre || "",
      email: s.contacto_email || "",
      telefono: s.contacto_telefono || "",
      solicitud_stock_id: s.id,
      itemsPorSku,
      itemsSinSku: sinSku,
    };
    try {
      // Misma clave que hidrata CrearLicitacion al montar.
      localStorage.setItem("crear_licitacion_draft", JSON.stringify(draft));
    } catch { /* */ }
    window.open("/crear", "_blank", "noopener");
    if (sinSku > 0) {
      setToast({
        type: "info",
        message: `Se llevan ${itemsPorSku.length} producto(s) Amsodent al borrador; ${sinSku} ítem(s) son de otras tiendas del Explorador y quedaron fuera.`,
      });
    }
  }

  if (loading) {
    return (
      <div className="page">
        <div className="page-header"><h1 className="page-title">Pedidos del Portal</h1></div>
        <p className="text-gray-500 text-sm mt-4">Cargando pedidos…</p>
      </div>
    );
  }


  /* (2026-09-24) Volver a ver todo sin ir borrando filtro por filtro. */
  const hayFiltros = fTexto !== "" || fEstado !== "" || fOrigen !== "";
  function limpiarFiltros() {
    setFTexto("");
    setFEstado("");
    setFOrigen("");
    setPagina(1);
  }

  return (
    <div className="page">
      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}

      <div className="page-header" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 className="page-title" style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Inbox size={22} style={{ color: TEAL }} /> Pedidos del Portal
          </h1>
          <p style={{ fontSize: 12.5, color: "var(--text-muted)", margin: "4px 0 0" }}>
            Todo lo que los clientes piden desde el portal — carrito del Explorador de Precios y solicitudes de Gestión de Stock — en una sola bandeja.
          </p>
        </div>
        <button type="button" className="btn btn-secondary" onClick={cargar} title="Actualizar">
          <RefreshCw size={14} style={{ marginRight: 6 }} /> Actualizar
        </button>
      </div>

      {/* KPIs — una sola fila (5 columnas) */}
      <div className="stats-row stats-6" style={{ marginTop: 8 }}>
        <div
          className="stat-card"
          onClick={() => { setFEstado(""); setFOrigen(""); }}
          style={{ cursor: "pointer" }}
          title="Quitar filtros de estado y origen"
        >
          <div className="stat-label">Pedidos</div>
          <div className="stat-value">{stats.total}</div>
        </div>
        <div className="stat-card" onClick={() => setFEstado(fEstado === "pendiente" ? "" : "pendiente")} style={{ cursor: "pointer", outline: fEstado === "pendiente" ? "2px solid #f59e0b" : "none" }}>
          <div className="stat-label">Pendientes</div>
          <div className="stat-value" style={{ color: "#b45309" }}>{stats.pendiente}</div>
        </div>
        <div className="stat-card" onClick={() => setFEstado(fEstado === "respondida" ? "" : "respondida")} style={{ cursor: "pointer", outline: fEstado === "respondida" ? "2px solid #16a34a" : "none" }}>
          <div className="stat-label">Respondidas</div>
          <div className="stat-value" style={{ color: "var(--success)" }}>{stats.respondida}</div>
        </div>
        <div className="stat-card" onClick={() => setFEstado(fEstado === "cancelada" ? "" : "cancelada")} style={{ cursor: "pointer", outline: fEstado === "cancelada" ? "2px solid #dc2626" : "none" }}>
          <div className="stat-label">Canceladas</div>
          <div className="stat-value" style={{ color: "#b91c1c" }}>{stats.cancelada}</div>
        </div>
        <div className="stat-card" onClick={() => setFOrigen(fOrigen === "explorador" ? "" : "explorador")} style={{ cursor: "pointer", outline: fOrigen === "explorador" ? `2px solid ${TEAL}` : "none" }}>
          <div className="stat-label">Del explorador</div>
          <div className="stat-value" style={{ color: TEAL }}>{stats.explorador}</div>
        </div>
        {/* Showroom: lo que interesa es cuanto se vende por ahi, no cuantos
            pedidos entraron. Clic para filtrar solo los del Showroom. */}
        <div className="stat-card" onClick={() => setFOrigen(fOrigen === "showroom" ? "" : "showroom")} style={{ cursor: "pointer", outline: fOrigen === "showroom" ? "2px solid #be185d" : "none" }}>
          <div className="stat-label">Vendido por Showroom</div>
          <div className="stat-value" style={{ color: "#be185d" }}>{fmtCLP(stats.showroomVendido)}</div>
          <div className="stat-sub">
            {stats.showroom} pedido{stats.showroom === 1 ? "" : "s"}
            {stats.showroomEnCurso > 0 ? ` · ${fmtCLP(stats.showroomEnCurso)} en curso` : ""}
          </div>
        </div>
      </div>

      {/* Tiempos de respuesta (punto 18): cuánto demora cada tramo del flujo.
          Si la migración del flujo aún no está aplicada, esto no aparece. */}
      {kpis && (
        <div className="surface" style={{ marginTop: 12, padding: "12px 16px" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
            <strong style={{ fontSize: 13, color: "var(--text)" }}>Tiempos de respuesta</strong>
            <span style={{ fontSize: 11.5, color: "var(--text-muted)" }}>
              promedio de cada tramo · {kpis.total} pedido{kpis.total === 1 ? "" : "s"}
            </span>
          </div>
          <div className="kpi-grid">
            <KpiTiempo label="Cliente aprueba" horas={kpis.horas_a_aprobacion} detalle="desde que se envía el pedido" />
            <KpiTiempo label="Validamos" horas={kpis.horas_a_validacion} detalle="desde que el cliente aprueba" objetivo={48} />
            <KpiTiempo label="Paga" horas={kpis.horas_a_pago} detalle="desde que enviamos el link" />
            <KpiTiempo label="Ciclo completo" horas={kpis.horas_total} detalle="del envío al pago" />
            <div className="kpi-card" style={{ background: "var(--surface)", border: "1px solid var(--border)", borderTop: "3px solid #15803d", borderRadius: "var(--radius-lg)", padding: "12px 14px" }}>
              <div style={{ fontSize: 10.5, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".04em", color: "var(--text-muted)" }}>Pagado</div>
              <div className="kpi-value" style={{ fontWeight: 800, color: "var(--text)", lineHeight: 1.1 }}>{fmtCLP(kpis.monto_pagado)}</div>
              <div style={{ fontSize: 10.5, color: "var(--text-muted)" }}>
                {kpis.por_estado?.pagado || 0} pedido{(kpis.por_estado?.pagado || 0) === 1 ? "" : "s"}
                {kpis.sos > 0 ? ` · ${kpis.sos} con SOS` : ""}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Filtros */}
      <div className="filter-bar" style={{ marginTop: 12 }}>
        <div className="filter-field" style={{ minWidth: 260 }}>
          <label className="filter-label">Buscar</label>
          <input
            type="text"
            className="input"
            placeholder="Cliente, RUT, N° pedido, producto, nota…"
            value={fTexto}
            onChange={(e) => setFTexto(e.target.value)}
          />
        </div>
        <div className="filter-field">
          <label className="filter-label">Estado</label>
          <select className="input" value={fEstado} onChange={(e) => setFEstado(e.target.value)}>
            <option value="">Todos</option>
            {ESTADOS.map((e) => <option key={e.value} value={e.value}>{e.label}</option>)}
          </select>
        </div>
        <div className="filter-field">
          <label className="filter-label">Origen</label>
          <select className="input" value={fOrigen} onChange={(e) => setFOrigen(e.target.value)}>
            <option value="">Todos</option>
            <option value="explorador">Explorador de Precios</option>
            <option value="stock">Gestión de Stock</option>
          </select>
        </div>
        <BotonLimpiarFiltros hay={hayFiltros} onLimpiar={limpiarFiltros} />
      </div>

      {/* Tabla compacta: una fila por pedido, detalle expandible */}
      <div className="table-wrap" style={{ marginTop: 12 }}>
        <div className="table-scroll">
          <table className="data-table">
            <colgroup>
              <col style={{ width: 36 }} />
              <col style={{ width: "9%" }} />
              <col style={{ width: "23%" }} />
              <col style={{ width: "11%" }} />
              <col style={{ width: "18%" }} />
              <col style={{ width: "9%" }} />
              <col style={{ width: "11%" }} />
              <col style={{ width: "9%" }} />
              <col style={{ width: "10%" }} />
            </colgroup>
            <thead>
              <tr>
                <th />
                <th style={{ textAlign: "left" }}>Pedido</th>
                <th style={{ textAlign: "left" }}>Cliente</th>
                <th style={{ textAlign: "left" }}>Origen</th>
                <th style={{ textAlign: "left" }}>Ítems</th>
                <th style={{ textAlign: "right" }}>Total ref.</th>
                <th style={{ textAlign: "left" }}>Etapa</th>
                <th style={{ textAlign: "left" }}>Estado</th>
                <th style={{ textAlign: "left" }}>Cotización</th>
              </tr>
            </thead>
            <tbody>
              {visibles.length === 0 ? (
                <tr>
                  <td colSpan={9} style={{ textAlign: "center", padding: "50px 0", color: "var(--text-muted)" }}>
                    No hay pedidos que coincidan con los filtros.
                  </td>
                </tr>
              ) : (
                visibles.map((s) => {
                  const origen = origenDe(s);
                  const em = estadoMeta(s.estado || "pendiente");
                  const items = Array.isArray(s.items) ? s.items : [];
                  const totalRef = items.reduce(
                    (acc, i) => acc + Number(i?.precio_referencia || 0) * Number(i?.cantidad || 0),
                    0,
                  );
                  const abierto = expandidoId === s.id;
                  const resumenItems = items
                    .map((i) => i?.nombre)
                    .filter(Boolean)
                    .join(" · ");
                  return (
                    <Fragment key={s.id}>
                      <tr
                        onClick={() => setExpandidoId(abierto ? null : s.id)}
                        style={{ cursor: "pointer", background: abierto ? "#f8fafc" : undefined }}
                        title={abierto ? "Ocultar el detalle" : "Ver el detalle del pedido"}
                      >
                        <td style={{ textAlign: "center", color: "var(--text-muted)" }}>
                          {abierto ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                        </td>
                        <td style={{ whiteSpace: "nowrap" }}>
                          <div style={{ fontWeight: 700, color: "var(--text)" }}>N° {s.id}</div>
                          <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{fmtFechaHora(s.created_at)}</div>
                        </td>
                        <td>
                          <div style={{ fontWeight: 600, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 340 }}>
                            {s.razon_social || "Cliente sin nombre"}
                          </div>
                          <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                            {formatearRutVisual(s.rut) || "—"}
                            {s.sucursal_nombre ? ` · ${s.sucursal_nombre}` : ""}
                          </div>
                        </td>
                        <td><BadgeOrigen origen={origen} compacto /></td>
                        <td>
                          <div style={{ fontSize: 12.5, color: "#475569", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 280 }} title={resumenItems}>
                            <strong>{items.length}</strong> ítem{items.length === 1 ? "" : "s"}
                            {resumenItems ? ` — ${resumenItems}` : ""}
                          </div>
                          {s.mensajes_no_leidos > 0 && (
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10.5, fontWeight: 700, color: "#b45309", background: "#fef3c7", padding: "1px 8px", borderRadius: 999, marginTop: 2 }}>
                              <MessageCircle size={10} /> {s.mensajes_no_leidos} sin leer
                            </span>
                          )}
                        </td>
                        <td style={{ textAlign: "right", fontWeight: 700, fontVariantNumeric: "tabular-nums", color: totalRef > 0 ? "var(--text)" : "var(--text-muted)" }}>
                          {totalRef > 0 ? fmtCLP(totalRef) : "—"}
                          {s.monto_total > 0 && (
                            <div style={{ fontSize: 10.5, color: "#6d28d9", fontWeight: 700 }}>
                              validado {fmtCLP(s.monto_total)}
                            </div>
                          )}
                        </td>
                        <td>
                          <BadgeFlujo valor={flujoDe(s)} />
                          {s.sos && (
                            <div style={{ fontSize: 10, fontWeight: 800, color: "#b91c1c", marginTop: 3 }} title={s.sos_motivo || "Despacho comprometido en 24 hrs"}>
                              ⚡ SOS 24 h
                            </div>
                          )}
                        </td>
                        <td onClick={(e) => e.stopPropagation()}>
                          <select
                            className="input"
                            value={s.estado || "pendiente"}
                            onChange={(e) => cambiarEstado(s, e.target.value)}
                            style={{ width: "auto", height: 28, fontSize: 12, fontWeight: 700, background: em.bg, color: em.fg, border: "none", borderRadius: 999, padding: "0 10px" }}
                            title="Cambiar el estado del pedido"
                          >
                            {ESTADOS.map((e) => <option key={e.value} value={e.value}>{e.label}</option>)}
                          </select>
                        </td>
                        <td onClick={(e) => e.stopPropagation()} style={{ whiteSpace: "nowrap" }}>
                          {s.cotizacion ? (
                            <Link to={`/detalle/${s.cotizacion.id}`} className="table-link" style={{ fontWeight: 600, fontSize: 12.5 }} title={`Estado: ${s.cotizacion.estado || "—"}`}>
                              #{s.cotizacion.id}{s.cotizacion.id_licitacion && s.cotizacion.id_licitacion !== String(s.cotizacion.id) ? ` · ${s.cotizacion.id_licitacion}` : ""}
                            </Link>
                          ) : (
                            <button type="button" className="btn btn-primary btn-sm" onClick={() => crearCotizacion(s)} title="Crear cotización desde el pedido (se abre en una pestaña nueva)">
                              <FilePlus size={12} style={{ marginRight: 4 }} /> Crear
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => descargarPdfPedido(s)}
                            title="Descargar el detalle del pedido en PDF"
                            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--primary-dark)", padding: 4, marginLeft: 6, verticalAlign: "middle" }}
                          >
                            <FileDown size={15} />
                          </button>
                        </td>
                      </tr>

                      {abierto && (
                        <tr>
                          <td colSpan={8} style={{ background: "#f8fafc", padding: "14px 20px" }}>
                            <div style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 980 }}>
                              {(s.contacto_nombre || s.contacto_email || s.contacto_telefono || s.sucursal_nombre) && (
                                <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 12.5, color: "#475569" }}>
                                  {s.contacto_nombre && <span style={{ fontWeight: 700 }}>{s.contacto_nombre}</span>}
                                  {s.contacto_email && <span><Mail size={12} style={{ verticalAlign: "-1px", marginRight: 4 }} />{s.contacto_email}</span>}
                                  {s.contacto_telefono && <span><Phone size={12} style={{ verticalAlign: "-1px", marginRight: 4 }} />{s.contacto_telefono}</span>}
                                  {s.sucursal_nombre && <span><MapPin size={12} style={{ verticalAlign: "-1px", marginRight: 4 }} />{s.sucursal_nombre}</span>}
                                </div>
                              )}

                              {items.length > 0 && (
                                <div style={{ overflowX: "auto", background: "#fff", border: "1px solid #eef2f7", borderRadius: 10 }}>
                                  <table className="data-table" style={{ width: "100%", fontSize: 12.5 }}>
                                    <thead>
                                      <tr>
                                        <th style={{ textAlign: "left" }}>Producto</th>
                                        <th style={{ textAlign: "right", width: 90 }}>Cantidad</th>
                                        <th style={{ textAlign: "left", width: "32%" }}>Referencia</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {items.map((i, idx) => (
                                        <tr key={idx}>
                                          <td>
                                            {i?.nombre || "—"}
                                            {i?.observacion && (
                                              <div style={{ fontSize: 11, color: "#64748b", fontStyle: "italic", marginTop: 1 }}>
                                                Obs: {i.observacion}
                                              </div>
                                            )}
                                          </td>
                                          <td style={{ textAlign: "right", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                                            {i?.cantidad || 0}{i?.unidad ? ` ${i.unidad}` : ""}
                                          </td>
                                          <td style={{ fontSize: 12, color: "var(--text-muted)" }}>
                                            {i?.tienda || i?.precio_referencia || i?.url ? (
                                              <>
                                                {i?.tienda || "—"}
                                                {i?.precio_referencia ? ` · ${fmtCLP(i.precio_referencia)} c/u` : ""}
                                                {i?.url && (
                                                  <a href={i.url} target="_blank" rel="noopener noreferrer" style={{ color: TEAL, marginLeft: 6, fontWeight: 600 }}>
                                                    ver <ExternalLink size={11} style={{ verticalAlign: "-1px" }} />
                                                  </a>
                                                )}
                                              </>
                                            ) : (
                                              "—"
                                            )}
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              )}

                              {s.nota && (
                                <div style={{ fontSize: 12.5, color: "#475569", background: "#fff", border: "1px solid #eef2f7", borderRadius: 10, padding: "8px 12px" }}>
                                  <span style={{ fontWeight: 700, color: "#334155" }}>Nota:</span> {s.nota}
                                </div>
                              )}

                              {/* Flujo de aprobación y pago (2026-09-16) */}
                              <PanelFlujoPedido
                                pedido={s}
                                onValidar={() => setModalValidar(s)}
                                onRevertir={() => revertirPedido(s)}
                                onSos={() => alternarSos(s)}
                                onVerHistorial={() => setHistorialCliente({ rut: s.rut, razon: s.razon_social })}
                              />

                              <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                                {s.cotizacion ? (
                                  <Link to={`/detalle/${s.cotizacion.id}`} className="btn btn-secondary btn-sm" style={{ textDecoration: "none" }}>
                                    Abrir cotización #{s.cotizacion.id} ({s.cotizacion.estado || "—"})
                                  </Link>
                                ) : (
                                  <button type="button" className="btn btn-primary btn-sm" onClick={() => crearCotizacion(s)} title="Se abre en una pestaña nueva">
                                    <FilePlus size={13} style={{ marginRight: 5 }} /> Crear cotización desde el pedido
                                  </button>
                                )}
                                <button type="button" className="btn btn-secondary btn-sm" onClick={() => descargarPdfPedido(s)}>
                                  <FileDown size={13} style={{ marginRight: 5 }} /> Descargar PDF
                                </button>
                                <Link to="/monitoreo-stock" style={{ fontSize: 12, color: "var(--text-muted)", textDecoration: "none" }}>
                                  Ver en Monitoreo Stock →
                                </Link>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Paginación */}
      {filtrados.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 10, flexWrap: "wrap", gap: 8 }}>
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
            Mostrando {(paginaActual - 1) * POR_PAGINA + 1}–{Math.min(paginaActual * POR_PAGINA, filtrados.length)} de {filtrados.length} pedido{filtrados.length === 1 ? "" : "s"}
          </span>
          {totalPaginas > 1 && (
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={paginaActual <= 1}
                onClick={() => { setPagina(paginaActual - 1); setExpandidoId(null); }}
              >
                <ChevronLeft size={14} />
              </button>
              <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text)", minWidth: 60, textAlign: "center" }}>
                {paginaActual} / {totalPaginas}
              </span>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={paginaActual >= totalPaginas}
                onClick={() => { setPagina(paginaActual + 1); setExpandidoId(null); }}
              >
                <ChevronRight size={14} />
              </button>
            </div>
          )}
        </div>
      )}

      {modalValidar && (
        <ModalValidarPedido
          pedido={modalValidar}
          guardando={accionando}
          onCerrar={() => setModalValidar(null)}
          onConfirmar={(payload) => validarPedido(modalValidar, payload)}
        />
      )}

      {historialCliente && (
        <ModalHistorialCliente
          rut={historialCliente.rut}
          razon={historialCliente.razon}
          onCerrar={() => setHistorialCliente(null)}
        />
      )}
    </div>
  );
}

/* Historial de actividad de la cuenta del cliente en el portal (2026-09-24).
   Es la MISMA informacion que el cliente ve en su pestana "Actividad": sirve
   para entender que hizo sin tener que preguntarselo. */
function ModalHistorialCliente({ rut, razon, onCerrar }) {
  const [filas, setFilas] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let vivo = true;
    api.get(`/stock-clientes/historial?rut=${encodeURIComponent(rut)}`)
      .then((r) => { if (vivo) setFilas(Array.isArray(r) ? r : []); })
      .catch((e) => { if (vivo) { setError(e?.message || "No se pudo cargar la actividad."); setFilas([]); } });
    return () => { vivo = false; };
  }, [rut]);

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.45)", zIndex: 90, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onCerrar(); }}
    >
      <div style={{ background: "var(--surface, #fff)", borderRadius: 12, width: "min(620px, 96vw)", maxHeight: "82vh", display: "flex", flexDirection: "column", boxShadow: "0 18px 48px rgba(15,23,42,.28)" }}>
        <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border, #e2e8f0)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 800 }}>Actividad en el portal</div>
            <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{razon || rut}</div>
          </div>
          <button type="button" onClick={onCerrar} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)" }}>
            <X size={18} />
          </button>
        </div>
        <div style={{ padding: "12px 18px 18px", overflowY: "auto" }}>
          {filas == null ? (
            <div style={{ fontSize: 13, color: "var(--text-muted)" }}>Cargando...</div>
          ) : error ? (
            <div style={{ fontSize: 13, color: "#b91c1c" }}>{error}</div>
          ) : filas.length === 0 ? (
            <div style={{ fontSize: 13, color: "var(--text-muted)" }}>Sin actividad registrada para esta cuenta.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {filas.map((f, i) => (
                <div key={`${f.fecha}-${i}`} style={{ borderLeft: `3px solid ${f.origen === "plataforma" ? "#7c3aed" : "#0f766e"}`, paddingLeft: 10 }}>
                  <div style={{ fontSize: 13, fontWeight: 700 }}>{f.titulo}</div>
                  {f.detalle && <div style={{ fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.45 }}>{f.detalle}</div>}
                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
                    {fmtFechaHora(f.fecha)}
                    {f.actor ? ` · ${String(f.actor).split("@")[0]}` : ""}
                    {f.origen === "plataforma" ? " · Amsodent" : f.origen === "cliente" ? " · cliente" : ""}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* Tarjeta de un tramo del flujo. `objetivo` es el compromiso que le damos al
   cliente (48 hrs para validar): si se pasa, el número se pone en rojo. */
function KpiTiempo({ label, horas, detalle, objetivo }) {
  const hay = horas != null;
  const excedido = hay && objetivo != null && horas > objetivo;
  const texto = !hay
    ? "—"
    : horas < 24
      ? `${horas.toFixed(1).replace(".", ",")} h`
      : `${(horas / 24).toFixed(1).replace(".", ",")} d`;
  return (
    <div className="kpi-card" style={{ background: "var(--surface)", border: "1px solid var(--border)", borderTop: `3px solid ${excedido ? "#b91c1c" : TEAL}`, borderRadius: "var(--radius-lg)", padding: "12px 14px" }}>
      <div style={{ fontSize: 10.5, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".04em", color: "var(--text-muted)" }}>{label}</div>
      <div className="kpi-value" style={{ fontWeight: 800, lineHeight: 1.1, color: excedido ? "#b91c1c" : "var(--text)" }}>{texto}</div>
      <div style={{ fontSize: 10.5, color: "var(--text-muted)" }}>
        {detalle}{objetivo != null ? ` · meta ${objetivo} h` : ""}
      </div>
    </div>
  );
}

/* ── Panel del flujo dentro del detalle del pedido ─────────────────────── */
function PanelFlujoPedido({ pedido, onValidar, onRevertir, onSos, onVerHistorial }) {
  const estado = flujoDe(pedido);
  const m = flujoMeta(estado);
  const pasos = [
    { key: "pendiente_aprobacion", label: "Enviado", fecha: pedido.created_at },
    { key: "aprobado_cliente", label: "Aprobado por el cliente", fecha: pedido.aprobado_cliente_at, quien: pedido.aprobado_cliente_por },
    { key: "validado_plataforma", label: "Validado por Amsodent", fecha: pedido.validado_at, quien: pedido.validado_por },
    { key: "pagado", label: "Pagado", fecha: pedido.pago_at, quien: pedido.pago_medio },
  ];

  return (
    <div style={{ background: "#fff", border: "1px solid #eef2f7", borderRadius: 10, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <strong style={{ fontSize: 12.5, color: "#334155" }}>Flujo del pedido</strong>
        <BadgeFlujo valor={estado} />
        <span style={{ fontSize: 11.5, color: "var(--text-muted)" }}>{m.ayuda}</span>
      </div>

      {/* Línea de tiempo con los tiempos de respuesta de cada tramo */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        {pasos.map((p, i) => {
          const hecho = Boolean(p.fecha);
          const previo = i > 0 ? pasos[i - 1].fecha : null;
          const demora = i > 0 ? lapso(previo, p.fecha) : null;
          return (
            <div
              key={p.key}
              style={{
                flex: "1 1 150px", minWidth: 0, border: "1px solid", borderRadius: 9, padding: "7px 10px",
                borderColor: hecho ? "#d1fae5" : "#e2e8f0",
                background: hecho ? "#f0fdf4" : "#f8fafc",
              }}
            >
              <div style={{ fontSize: 10.5, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".03em", color: hecho ? "#15803d" : "#94a3b8" }}>
                {p.label}
              </div>
              <div style={{ fontSize: 11.5, color: hecho ? "#334155" : "#cbd5e1" }}>
                {hecho ? fmtFechaHora(p.fecha) : "Pendiente"}
              </div>
              {p.quien && hecho && (
                <div style={{ fontSize: 10.5, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis" }}>{p.quien}</div>
              )}
              {demora && <div style={{ fontSize: 10.5, color: "#0369a1", fontWeight: 700 }}>+{demora}</div>}
            </div>
          );
        })}
      </div>

      {/* (2026-09-24) El cliente pidio cambios desde su carrito. Los productos
          del pedido YA estan reemplazados por los nuevos; esto muestra que
          cambio respecto de lo cotizado, para no tener que compararlo a mano
          antes de revalidar. */}
      {pedido.modificacion_pedida_at && (
        <div style={{ border: "1px solid #fed7aa", background: "#fff7ed", borderRadius: 10, padding: "10px 12px" }}>
          <div style={{ fontSize: 12.5, fontWeight: 800, color: "#9a3412", marginBottom: 6 }}>
            El cliente modifico este pedido
            <span style={{ fontWeight: 500, color: "#9a3412" }}>
              {" · "}{fmtFechaHora(pedido.modificacion_pedida_at)}
              {pedido.modificacion_pedida_por ? ` · ${String(pedido.modificacion_pedida_por).split("@")[0]}` : ""}
            </span>
          </div>
          {Array.isArray(pedido.modificacion_detalle) && pedido.modificacion_detalle.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              {pedido.modificacion_detalle
                .filter((d) => d.accion !== "mantiene")
                .map((d, i) => {
                  const tono = d.accion === "agrega" ? "#15803d" : d.accion === "quita" ? "#b91c1c" : "#b45309";
                  const etiqueta = d.accion === "agrega" ? "Agrego" : d.accion === "quita" ? "Quito" : "Cambio";
                  return (
                    <div key={i} style={{ fontSize: 12, color: "#475569" }}>
                      <strong style={{ color: tono }}>{etiqueta}:</strong> {d.nombre}
                      {d.sku ? ` (${d.sku})` : ""}
                      {d.accion === "cambia" ? ` · ${d.cantidad_anterior} → ${d.cantidad}` : ""}
                      {d.accion === "agrega" ? ` · ${d.cantidad}` : ""}
                      {d.accion === "quita" ? ` · eran ${d.cantidad_anterior}` : ""}
                    </div>
                  );
                })}
              {pedido.modificacion_detalle.every((d) => d.accion === "mantiene") && (
                <div style={{ fontSize: 12, color: "#475569" }}>Reenvio los mismos productos, sin cambios.</div>
              )}
            </div>
          ) : (
            <div style={{ fontSize: 12, color: "#475569" }}>
              Revisa los productos del pedido: son los que el cliente dejo en su carrito.
            </div>
          )}
        </div>
      )}

      {Array.isArray(pedido.disponibilidad) && pedido.disponibilidad.length > 0 && (
        <div style={{ fontSize: 12, color: "#475569" }}>
          <strong>Existencias confirmadas:</strong>{" "}
          {pedido.disponibilidad.map((d) => `${d.nombre} (${d.cantidad_disponible}/${d.cantidad_solicitada})`).join(" · ")}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {estado === "aprobado_cliente" || estado === "validado_plataforma" ? (
          <button type="button" className="btn btn-primary btn-sm" onClick={onValidar}>
            {estado === "validado_plataforma" ? "Revalidar existencias" : "Validar existencias y enviar link de pago"}
          </button>
        ) : null}
        {estado === "pendiente_aprobacion" && (
          <span style={{ fontSize: 12, color: "#b45309" }}>
            Esperando que el administrador de la cuenta del cliente apruebe el pedido.
          </span>
        )}
        {estado !== "pagado" && estado !== "pendiente_aprobacion" && (
          <button type="button" className="btn btn-secondary btn-sm" onClick={onRevertir} title="Devuelve el pedido a la etapa anterior">
            Volver atrás
          </button>
        )}
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={onSos}
          style={{ color: pedido.sos ? "#b91c1c" : undefined }}
          title="SOS: despacho comprometido en 24 hrs"
        >
          {pedido.sos ? "Quitar SOS" : "Marcar SOS (24 h)"}
        </button>
        {/* (2026-09-24) Mismo historial que ve el cliente en su portal: sirve
            para entender el pedido sin tener que preguntarle que hizo. */}
        <button type="button" className="btn btn-secondary btn-sm" onClick={onVerHistorial} title="Actividad de la cuenta en el portal">
          Ver actividad del cliente
        </button>
      </div>
    </div>
  );
}

/* ── Modal: confirmar existencias producto por producto y emitir el pago ── */
function ModalValidarPedido({ pedido, guardando, onCerrar, onConfirmar }) {
  const itemsPedido = Array.isArray(pedido.items) ? pedido.items : [];
  const previos = Array.isArray(pedido.disponibilidad) ? pedido.disponibilidad : [];
  const [filas, setFilas] = useState(() =>
    itemsPedido.map((it) => {
      const previo = previos.find((p) => p.nombre === it.nombre);
      return {
        nombre: it?.nombre || "",
        cantidad_solicitada: Number(it?.cantidad) || 0,
        cantidad_disponible: previo ? Number(previo.cantidad_disponible) : Number(it?.cantidad) || 0,
        precio_unitario: previo ? Number(previo.precio_unitario) : Number(it?.precio_referencia) || 0,
        nota: previo?.nota || "",
      };
    }),
  );
  const [nota, setNota] = useState("");

  const set = (i, patch) => setFilas((prev) => prev.map((f, k) => (k === i ? { ...f, ...patch } : f)));
  const total = filas.reduce((acc, f) => acc + Number(f.cantidad_disponible || 0) * Number(f.precio_unitario || 0), 0);
  const faltantes = filas.filter((f) => Number(f.cantidad_disponible) < Number(f.cantidad_solicitada));

  return (
    <div
      onMouseDown={(e) => { if (e.target === e.currentTarget) onCerrar(); }}
      style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.55)", zIndex: 12000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
    >
      <div style={{ width: 760, maxWidth: "100%", maxHeight: "88vh", overflow: "auto", background: "var(--surface)", borderRadius: 14, padding: 20, border: "1px solid var(--border)" }}>
        <h3 style={{ margin: "0 0 4px", fontSize: 16, fontWeight: 800, color: "var(--text)" }}>
          Validar el pedido N° {pedido.id}
        </h3>
        <p style={{ margin: "0 0 14px", fontSize: 12.5, color: "var(--text-muted)" }}>
          Confirma cuánto hay de cada producto y a qué precio. Con eso se calcula el monto y se le
          envía al cliente el link de pago, al portal y por correo.
        </p>

        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ textAlign: "left" }}>Producto</th>
                <th style={{ textAlign: "right", width: 90 }}>Pedido</th>
                <th style={{ textAlign: "right", width: 110 }}>Disponible</th>
                <th style={{ textAlign: "right", width: 130 }}>Precio unit.</th>
                <th style={{ textAlign: "right", width: 120 }}>Subtotal</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f, i) => {
                const falta = Number(f.cantidad_disponible) < Number(f.cantidad_solicitada);
                return (
                  <tr key={i} style={{ background: falta ? "#fff7ed" : undefined }}>
                    <td>
                      <div style={{ fontWeight: 600, color: "var(--text)" }}>{f.nombre}</div>
                      <input
                        className="input"
                        value={f.nota}
                        onChange={(e) => set(i, { nota: e.target.value })}
                        placeholder="Nota para el cliente (opcional)"
                        style={{ height: 28, fontSize: 11.5, marginTop: 4 }}
                      />
                    </td>
                    <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{f.cantidad_solicitada}</td>
                    <td style={{ textAlign: "right" }}>
                      <input
                        className="input"
                        type="number"
                        min={0}
                        value={f.cantidad_disponible}
                        onChange={(e) => set(i, { cantidad_disponible: e.target.value })}
                        style={{ height: 30, width: 90, textAlign: "right" }}
                      />
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <input
                        className="input"
                        type="number"
                        min={0}
                        value={f.precio_unitario}
                        onChange={(e) => set(i, { precio_unitario: e.target.value })}
                        style={{ height: 30, width: 110, textAlign: "right" }}
                      />
                    </td>
                    <td style={{ textAlign: "right", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                      {fmtCLP(Number(f.cantidad_disponible || 0) * Number(f.precio_unitario || 0))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {faltantes.length > 0 && (
          <div style={{ marginTop: 10, fontSize: 12.5, color: "#b45309", background: "#fff7ed", border: "1px solid #fed7aa", borderRadius: 9, padding: "8px 12px" }}>
            {faltantes.length} producto{faltantes.length === 1 ? "" : "s"} sin stock completo. El cliente lo verá
            en el detalle y el monto considera solo lo disponible.
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 14, gap: 12, flexWrap: "wrap" }}>
          <input
            className="input"
            value={nota}
            onChange={(e) => setNota(e.target.value)}
            placeholder="Nota general del pedido (opcional)"
            style={{ flex: "1 1 260px" }}
          />
          <div style={{ fontSize: 15, fontWeight: 800, color: "var(--text)" }}>
            Total a pagar: {fmtCLP(total)}
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 16 }}>
          <button type="button" className="btn btn-secondary" onClick={onCerrar}>Cancelar</button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={guardando || total <= 0}
            onClick={() => onConfirmar({ disponibilidad: filas, monto_total: total, nota })}
            title={total <= 0 ? "El monto debe ser mayor a cero" : "Confirma y envía el link de pago"}
          >
            {guardando ? "Guardando…" : "Confirmar y enviar link de pago"}
          </button>
        </div>
      </div>
    </div>
  );
}
