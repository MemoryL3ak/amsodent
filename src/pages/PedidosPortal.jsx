import { Fragment, useEffect, useMemo, useState, useRef } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../lib/api";
import Toast from "../components/Toast";
import { descargarReportePDF } from "../lib/reporteStock";
import { fmtFechaHoraChile } from "../lib/fechaChile";
import BotonLimpiarFiltros from "../components/BotonLimpiarFiltros";
import DropdownSelect from "../components/ui/DropdownSelect";
import ConfirmModal from "../components/ConfirmModal";
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
  X,
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
/* (2026-11-09) Entre «aprobado» y «por pagar» hay paradas intermedias, con
   quién y cuándo: la revisión (a nombre de quien hace la primera acción) y
   las observaciones al cliente. Y la salida «rechazado» con motivo. Mismo
   orden que el backend (pedidos-flujo-etapas.ts). */
/* (2026-11-09, tarde) Se retiró «Cotización enviada»: repetía el «Enviado» y
   la cotización vinculada, y el «Validar cotización» del cliente no movía el
   pedido. Con la cotización creada el pedido queda «En revisión». */
const FLUJO = [
  { value: "pendiente_aprobacion", label: "Espera al cliente", bg: "#fef3c7", fg: "#b45309", ayuda: "Lo armó un usuario de la cuenta del cliente y falta que lo apruebe su administrador." },
  { value: "aprobado_cliente", label: "Por revisar", bg: "#e0f2fe", fg: "#0369a1", ayuda: "Llegó y nadie de Amsodent ha actuado: hay que cotizarlo y confirmar existencias." },
  { value: "en_revision", label: "En revisión", bg: "#ccfbf1", fg: "#0f766e", ayuda: "Amsodent ya lo está trabajando: creó la cotización o lo retomó tras una observación." },
  { value: "observado", label: "Observado", bg: "#ffedd5", fg: "#c2410c", ayuda: "Le dejamos una observación al cliente y esperamos su respuesta antes de seguir." },
  { value: "validado_plataforma", label: "Por pagar", bg: "#ede9fe", fg: "#6d28d9", ayuda: "Existencias confirmadas y link de pago enviado; esperamos el pago." },
  { value: "pagado", label: "Pagado", bg: "#dcfce7", fg: "#15803d", ayuda: "Pagado. Plazo de despacho: 48 a 72 hrs." },
  { value: "rechazado", label: "Rechazado", bg: "#fee2e2", fg: "#b91c1c", ayuda: "Amsodent rechazó el pedido; el cliente leyó el motivo." },
  { value: "cancelado", label: "Cancelado", bg: "#f1f5f9", fg: "#475569", ayuda: "El pedido fue cancelado." },
];
// Etapa retirada → la que la reemplaza (igual que ETAPAS_RETIRADAS del backend).
const ETAPAS_RETIRADAS = { cotizacion_enviada: "en_revision" };
const normalizarEtapa = (e) => {
  const s = String(e || "pendiente_aprobacion");
  return ETAPAS_RETIRADAS[s] || s;
};
const flujoDe = (s) => normalizarEtapa(s?.flujo_estado);
const flujoMeta = (v) => FLUJO.find((f) => f.value === normalizarEtapa(v)) || FLUJO[0];
// Desde qué etapas se puede validar / observar / cerrar (igual que el backend).
const VALIDABLES = ["aprobado_cliente", "en_revision", "observado", "validado_plataforma"];
const OBSERVABLES = ["aprobado_cliente", "en_revision"];
const CERRADOS = ["pagado", "rechazado", "cancelado"];
const quienDe = (correo) => (correo ? String(correo).split("@")[0] : null);

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

// (2026-11-09) Antes cortaba el texto del timestamp y mostraba la hora UTC:
// un pedido enviado a las 09:59 salía «12:59». Ahora va en hora de Chile.
const fmtFechaHora = (iso) => fmtFechaHoraChile(iso);

// Origen del pedido: el carrito del explorador deja referencia de tienda /
// precio / url en los ítems (y lo dice la nota); lo demás viene de la
// gestión de stock del portal.
function origenDe(s) {
  // (2026-09-24) Desde el Showroom el pedido viaja diciendo de donde salio;
  // los anteriores siguen deduciendose como antes.
  const declarado = String(s?.origen_seccion || "").trim();
  if (["showroom", "ofertas", "explorador", "stock"].includes(declarado)) return declarado;
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
  // (2026-10-02) Pedidos que salen de la pestaña Ofertas especiales del portal.
  ofertas: { bg: "#fff7ed", color: "#c2410c", borde: "#fed7aa", corto: "Ofertas", largo: "Ofertas especiales" },
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
  const [fEtapa, setFEtapa] = useState("");
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
  }, [fTexto, fEstado, fOrigen, fEtapa]);

  const filtrados = useMemo(() => {
    const q = fTexto.trim().toLowerCase();
    const qRut = q.replace(/[.\-\s]/g, "");
    return pedidos.filter((s) => {
      if (fEstado && (s.estado || "pendiente") !== fEstado) return false;
      if (fOrigen && origenDe(s) !== fOrigen) return false;
      if (fEtapa && flujoDe(s) !== fEtapa) return false;
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
  }, [pedidos, fTexto, fEstado, fOrigen, fEtapa]);

  /* (2026-11-05) El aviso de un pedido nuevo (campana o ventana flotante) llega
     con ?pedido=ID: se abre ese pedido en su página, una sola vez por cada id.
     Si los filtros lo esconden, se limpian para que aparezca. */
  const [parametros, setParametros] = useSearchParams();
  const pedidoPedido = Number(parametros.get("pedido")) || null;
  useEffect(() => {
    if (!pedidoPedido || loading) return;
    const enTodos = pedidos.findIndex((s) => Number(s.id) === pedidoPedido);
    if (enTodos < 0) {
      if (pedidos.length) setToast({ type: "warning", message: `El pedido N° ${pedidoPedido} no está en tu bandeja.` });
    } else {
      const idx = filtrados.findIndex((s) => Number(s.id) === pedidoPedido);
      if (idx < 0) {
        // Con los filtros puestos no se ve: se limpian y este efecto vuelve a correr.
        setFTexto(""); setFEstado(""); setFOrigen(""); setFEtapa("");
        return;
      }
      setPagina(Math.floor(idx / POR_PAGINA) + 1);
      setExpandidoId(pedidos[enTodos].id);
      setTimeout(() => document.getElementById(`pedido-portal-${pedidoPedido}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 80);
    }
    // El parámetro se consume: recargar o filtrar después no vuelve a abrirlo.
    const sinPedido = new URLSearchParams(parametros);
    sinPedido.delete("pedido");
    setParametros(sinPedido, { replace: true });
  }, [pedidoPedido, loading, pedidos, filtrados]); // eslint-disable-line react-hooks/exhaustive-deps

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

  /* (2026-11-09) Las acciones que llevan un texto (observar, rechazar, volver
     atrás, SOS) pasan por una ventana propia, no por el window.prompt del
     navegador. `modalMotivo` describe la ventana abierta y qué hacer con el
     texto; `confirmar` es la confirmación simple (quitar el SOS). */
  const [modalMotivo, setModalMotivo] = useState(null);
  const [confirmar, setConfirmar] = useState(null);

  async function accionFlujo(pedido, ruta, body, exito, fallo) {
    setAccionando(true);
    try {
      const r = await api.post(`/stock-clientes/solicitudes/${pedido.id}/${ruta}`, body);
      if (r?.pedido) reemplazar(r.pedido);
      setModalMotivo(null);
      setToast({ type: "success", message: typeof exito === "function" ? exito(r) : exito });
      cargarKpis();
      return true;
    } catch (e) {
      setToast({ type: "error", message: e?.message || fallo });
      return false;
    } finally {
      setAccionando(false);
    }
  }

  // (2026-11-09) «Tomar el pedido» se retiró: la revisión queda a nombre de
  // quien hace la primera acción (crear la cotización, observar o validar).

  function observarPedido(pedido) {
    setModalMotivo({
      titulo: `Observar el pedido N° ${pedido.id}`,
      descripcion: "Escribe qué necesitas que el cliente responda: un producto sin stock, un reemplazo, un dato que falta. Lo ve en su portal, en el hilo del pedido y por correo. El pedido queda «Observado» hasta que acepte seguir o lo modifique.",
      placeholder: "Ej: El producto X no tiene stock hasta el 20-11. ¿Esperas o lo reemplazamos por Y?",
      textoConfirmar: "Enviar observación",
      tono: "warning",
      obligatorio: true,
      accion: (texto) => accionFlujo(pedido, "observar", { texto }, "Observación enviada al cliente.", "No se pudo enviar la observación."),
    });
  }

  function rechazarPedido(pedido) {
    setModalMotivo({
      titulo: `Rechazar el pedido N° ${pedido.id}`,
      descripcion: "El pedido se cierra y el cliente lee el motivo en su portal y por correo. El estado comercial pasa a Cancelada.",
      placeholder: "Motivo del rechazo…",
      textoConfirmar: "Rechazar pedido",
      tono: "danger",
      obligatorio: true,
      accion: (motivo) => accionFlujo(pedido, "rechazar", { motivo }, "Pedido rechazado; el cliente fue avisado.", "No se pudo rechazar el pedido."),
    });
  }

  function revertirPedido(pedido) {
    setModalMotivo({
      titulo: `Devolver el pedido N° ${pedido.id} a la etapa anterior`,
      descripcion: "Se deshace lo que produjo la etapa actual (una validación, una observación, la cotización enviada) y el motivo queda en la bitácora del pedido.",
      placeholder: "¿Por qué se devuelve? (opcional)",
      textoConfirmar: "Volver atrás",
      tono: "warning",
      accion: (motivo) => accionFlujo(pedido, "revertir", { motivo }, "El pedido volvió a la etapa anterior.", "No se pudo revertir el pedido."),
    });
  }

  /* (2026-11-09) El cliente paga por el link fijo de Webpay y Transbank no
     avisa de vuelta: quien lo ve en el portal de Transbank lo registra aquí. */
  const [modalPago, setModalPago] = useState(null);
  async function registrarPago(pedido, payload) {
    const ok = await accionFlujo(
      pedido,
      "registrar-pago",
      payload,
      (r) => r?.mensaje || "Pago registrado: el pedido quedó pagado.",
      "No se pudo registrar el pago.",
    );
    if (ok) setModalPago(null);
  }

  function alternarSos(pedido) {
    if (pedido.sos) {
      setConfirmar({
        titulo: "Quitar el SOS",
        mensaje: `El pedido N° ${pedido.id} deja de estar comprometido a despacho en 24 hrs.`,
        onConfirm: async () => {
          setConfirmar(null);
          await accionFlujo(pedido, "sos", { quitar: true }, "SOS retirado.", "No se pudo quitar el SOS.");
        },
      });
      return;
    }
    setModalMotivo({
      titulo: `SOS para el pedido N° ${pedido.id}`,
      descripcion: "El despacho queda comprometido dentro de 24 hrs y se avisa al equipo.",
      placeholder: "Motivo (opcional)",
      textoConfirmar: "Marcar SOS",
      tono: "danger",
      accion: (motivo) => accionFlujo(pedido, "sos", { motivo }, "Pedido marcado como SOS: despacho en 24 hrs.", "No se pudo marcar el SOS."),
    });
  }

  async function cambiarEstado(s, estado) {
    const anterior = s.estado;
    setPedidos((prev) => prev.map((p) => (p.id === s.id ? { ...p, estado } : p)));
    try {
      // (2026-11-09) El servidor devuelve el pedido con la etapa ya
      // sincronizada: cancelar cierra el flujo y sacar de cancelada lo reabre.
      const r = await api.put(`/stock-clientes/solicitudes/${s.id}/estado`, { estado });
      if (r?.id) reemplazar(r);
      cargarKpis();
    } catch {
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
        // (2026-10-02) Oferta especial del portal: el precio que se le mostró
        // al cliente (validado por el servidor al recibir el pedido) es el
        // que debe quedar en la cotización, no el de lista.
        precio_oferta: i?.oferta ? Number(i?.precio_referencia || 0) || 0 : 0,
        // (2026-11-05) La oferta es una campaña de margen: su id viaja para que
        // la línea de la cotización sume al cupo de la campaña al adjudicarse.
        oferta_id: Number(i?.oferta?.id) || null,
        oferta_nombre: i?.oferta?.nombre || "",
        oferta_pct: Number(i?.oferta?.descuento_pct || 0) || 0,
      }));
    const sinSku = items.length - itemsPorSku.length;
    /* (2026-11-09) El tipo de cliente ya no va fijo en «Entidad Pública»: un
       cliente particular (ej. Jeremias Alarcon) salía cotizado como público,
       con lista 2 y «Compra ágil». /crear lee la ficha del cliente por su RUT
       (aplicarFicha) antes de armar las líneas, así que tipo, tipo de compra,
       lista de precios, giro, dirección y condición de venta salen de ella. */
    const draft = {
      rutEntidad: formatearRutVisual(s.rut),
      nombreEntidad: s.razon_social || "",
      aplicarFicha: true,
      contacto: s.contacto_nombre || "",
      email: s.contacto_email || "",
      telefono: s.contacto_telefono || "",
      solicitud_stock_id: s.id,
      // (2026-11-12) De quién es el pedido: /crear lo muestra arriba y no
      // asocia la cotización si termina siendo para otro cliente.
      solicitud_stock_rut: s.rut || "",
      solicitud_stock_cliente: s.razon_social || "",
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
  const hayFiltros = fTexto !== "" || fEstado !== "" || fOrigen !== "" || fEtapa !== "";
  function limpiarFiltros() {
    setFTexto("");
    setFEstado("");
    setFOrigen("");
    setFEtapa("");
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
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {/* Atajo a la pantalla donde se publican las ofertas del portal: desde el
              2026-11-05 son campañas de margen de canal «Portal del cliente». */}
          <Link to="/campanas-margen" className="btn btn-secondary" title="Las ofertas que ve el cliente en su portal se crean en Campañas de margen, eligiendo «Portal del cliente» en «Dónde aplica»">
            Ofertas del portal
          </Link>
          <button type="button" className="btn btn-secondary" onClick={cargar} title="Actualizar">
            <RefreshCw size={14} style={{ marginRight: 6 }} /> Actualizar
          </button>
        </div>
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
            {/* (2026-11-09) Cuánto tardamos en la primera acción (cotizar, observar o
                validar; ya no hay «Tomar el pedido»): la mitad del plazo de 48 h. */}
            <KpiTiempo label="Primera respuesta" horas={kpis.horas_a_revision} detalle="desde que el cliente aprueba" objetivo={24} />
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
          <DropdownSelect
            value={fEstado}
            onChange={setFEstado}
            minWidth={190}
            options={[{ value: "", label: "Todos" }, ...ESTADOS.map((e) => ({ value: e.value, label: e.label }))]}
          />
        </div>
        <div className="filter-field">
          <label className="filter-label">Etapa</label>
          <DropdownSelect
            value={fEtapa}
            onChange={setFEtapa}
            minWidth={190}
            options={[{ value: "", label: "Todas" }, ...FLUJO.map((f) => ({ value: f.value, label: f.label, color: f.fg }))]}
          />
        </div>
        <div className="filter-field">
          <label className="filter-label">Origen</label>
          <DropdownSelect
            value={fOrigen}
            onChange={setFOrigen}
            minWidth={200}
            options={[
              { value: "", label: "Todos" },
              { value: "ofertas", label: "Ofertas especiales" },
              { value: "showroom", label: "Showroom" },
              { value: "explorador", label: "Explorador de Precios" },
              { value: "stock", label: "Gestión de Stock" },
            ]}
          />
        </div>
        <BotonLimpiarFiltros hay={hayFiltros} onLimpiar={limpiarFiltros} />
      </div>

      {/* Tabla compacta: una fila por pedido, detalle expandible */}
      <div className="table-wrap" style={{ marginTop: 12 }}>
        <div className="table-scroll">
          {/* (2026-10-07) Ancho fijo por columna: antes el nombre del cliente y
              de la sucursal estiraban la tabla y en un notebook de 13" había
              que desplazarse de lado. El origen va bajo el N° de pedido; cliente
              e ítems se cortan con "…" (el texto completo queda en el title). */}
          <table className="data-table tabla-compacta" style={{ tableLayout: "fixed", width: "100%", minWidth: 860 }}>
            <colgroup>
              <col style={{ width: 34 }} />
              <col style={{ width: 128 }} />
              <col />
              <col />
              <col style={{ width: 116 }} />
              <col style={{ width: 132 }} />
              <col style={{ width: 142 }} />
              <col style={{ width: 132 }} />
            </colgroup>
            <thead>
              <tr>
                <th />
                <th style={{ textAlign: "left" }}>Pedido</th>
                <th style={{ textAlign: "left" }}>Cliente</th>
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
                  <td colSpan={8} style={{ textAlign: "center", padding: "50px 0", color: "var(--text-muted)" }}>
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
                        id={`pedido-portal-${s.id}`}
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
                          <div style={{ marginTop: 3 }}><BadgeOrigen origen={origen} compacto /></div>
                        </td>
                        <td title={[s.razon_social, s.sucursal_nombre].filter(Boolean).join(" · ")}>
                          <div style={{ fontWeight: 600, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {s.razon_social || "Cliente sin nombre"}
                          </div>
                          <div style={{ fontSize: 11, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {formatearRutVisual(s.rut) || "—"}
                            {s.sucursal_nombre ? ` · ${s.sucursal_nombre}` : ""}
                          </div>
                        </td>
                        <td>
                          <div style={{ fontSize: 12.5, color: "#475569", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={resumenItems}>
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
                          {/* (2026-11-09) El cliente avisó que pagó por el link de Webpay. */}
                          {flujoDe(s) === "validado_plataforma" && s.pago_estado === "informado" && (
                            <div style={{ fontSize: 10, fontWeight: 800, color: "#6d28d9", marginTop: 3 }} title="Verifícalo en Transbank y registra el pago">
                              Pago informado
                            </div>
                          )}
                          {s.sos && (
                            <div style={{ fontSize: 10, fontWeight: 800, color: "#b91c1c", marginTop: 3 }} title={s.sos_motivo || "Despacho comprometido en 24 hrs"}>
                              ⚡ SOS 24 h
                            </div>
                          )}
                        </td>
                        <td onClick={(e) => e.stopPropagation()}>
                          {/* (2026-11-09) Listbox de la plataforma en vez del <select> nativo. */}
                          <DropdownSelect
                            value={s.estado || "pendiente"}
                            onChange={(v) => cambiarEstado(s, v)}
                            minWidth={150}
                            options={ESTADOS.map((e) => ({ value: e.value, label: e.label, color: e.fg }))}
                            title="Cambiar el estado del pedido"
                            style={{ width: "100%", maxWidth: 132, height: 28, fontSize: 12, fontWeight: 700, background: em.bg, border: "none", borderRadius: 999, padding: "0 10px" }}
                          />
                        </td>
                        <td onClick={(e) => e.stopPropagation()} style={{ whiteSpace: "nowrap" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 2, minWidth: 0 }}>
                          {s.cotizacion ? (
                            <Link to={`/detalle/${s.cotizacion.id}`} className="table-link truncar" style={{ fontWeight: 600, fontSize: 12.5 }} title={`#${s.cotizacion.id}${s.cotizacion.id_licitacion ? ` · ${s.cotizacion.id_licitacion}` : ""} — estado: ${s.cotizacion.estado || "—"}`}>
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
                            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--primary-dark)", padding: 4, marginLeft: 4, flexShrink: 0 }}
                          >
                            <FileDown size={15} />
                          </button>
                          </div>
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
                                            {i?.sku && (
                                              <span style={{ marginLeft: 6, fontSize: 11, color: "#64748b", fontFamily: "ui-monospace, monospace", whiteSpace: "nowrap" }}>
                                                SKU {i.sku}
                                              </span>
                                            )}
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
                                                {i?.oferta ? (
                                                  <span style={{ color: "#c2410c", fontWeight: 700 }} title={`Oferta especial «${i.oferta.nombre}»`}>
                                                    Oferta −{Number(i.oferta.descuento_pct).toLocaleString("es-CL")}% · {i.oferta.nombre}
                                                  </span>
                                                ) : (i?.tienda || "—")}
                                                {i?.precio_referencia ? ` · ${fmtCLP(i.precio_referencia)} c/u` : ""}
                                                {i?.oferta && i?.precio_normal ? (
                                                  <span style={{ textDecoration: "line-through", marginLeft: 6 }}>{fmtCLP(i.precio_normal)}</span>
                                                ) : null}
                                                {/^https?:\/\//i.test(String(i?.url || "")) && (
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
                                ocupado={accionando}
                                onValidar={() => setModalValidar(s)}
                                onObservar={() => observarPedido(s)}
                                onRechazar={() => rechazarPedido(s)}
                                onRevertir={() => revertirPedido(s)}
                                onSos={() => alternarSos(s)}
                                onRegistrarPago={() => setModalPago(s)}
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

      {modalPago && (
        <ModalRegistrarPago
          pedido={modalPago}
          guardando={accionando}
          onCerrar={() => { if (!accionando) setModalPago(null); }}
          onConfirmar={(payload) => registrarPago(modalPago, payload)}
        />
      )}

      {modalMotivo && (
        <ModalMotivo
          titulo={modalMotivo.titulo}
          descripcion={modalMotivo.descripcion}
          placeholder={modalMotivo.placeholder}
          textoConfirmar={modalMotivo.textoConfirmar}
          tono={modalMotivo.tono}
          obligatorio={modalMotivo.obligatorio}
          guardando={accionando}
          onCerrar={() => { if (!accionando) setModalMotivo(null); }}
          onConfirmar={modalMotivo.accion}
        />
      )}

      <ConfirmModal
        open={Boolean(confirmar)}
        title={confirmar?.titulo}
        message={confirmar?.mensaje}
        confirmText="Quitar SOS"
        confirmTone="warning"
        onConfirm={confirmar?.onConfirm}
        onCancel={() => setConfirmar(null)}
      />
    </div>
  );
}

/* ── Ventana para una acción que lleva un texto (2026-11-09) ───────────────
   Observar al cliente, rechazar, volver atrás y marcar SOS. Reemplaza al
   window.prompt del navegador; el texto queda en la bitácora del pedido. */
function ModalMotivo({ titulo, descripcion, placeholder, textoConfirmar, tono = "primary", obligatorio = false, guardando = false, onCerrar, onConfirmar }) {
  const [texto, setTexto] = useState("");
  const puede = !guardando && (!obligatorio || texto.trim().length > 0);
  useEffect(() => {
    const alTeclear = (e) => { if (e.key === "Escape") onCerrar(); };
    window.addEventListener("keydown", alTeclear);
    return () => window.removeEventListener("keydown", alTeclear);
  }, [onCerrar]);
  const colorBoton = tono === "danger" ? "#dc2626" : tono === "warning" ? "#b45309" : null;
  return (
    <div
      onMouseDown={(e) => { if (e.target === e.currentTarget) onCerrar(); }}
      style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.55)", zIndex: 12000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
    >
      <div style={{ width: 540, maxWidth: "100%", background: "var(--surface)", borderRadius: 14, padding: 20, border: "1px solid var(--border)" }}>
        <h3 style={{ margin: "0 0 4px", fontSize: 16, fontWeight: 800, color: "var(--text)" }}>{titulo}</h3>
        {descripcion && (
          <p style={{ margin: "0 0 12px", fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.5 }}>{descripcion}</p>
        )}
        <textarea
          className="input"
          autoFocus
          rows={4}
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder={placeholder}
          style={{ width: "100%", resize: "vertical", minHeight: 90, height: "auto", padding: 10, fontSize: 13, lineHeight: 1.45 }}
        />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
          <span style={{ fontSize: 11.5, color: "var(--text-muted)" }}>
            {obligatorio ? "Obligatorio: el cliente lo lee y queda en la bitácora." : "Opcional: queda en la bitácora del pedido."}
          </span>
          <div style={{ display: "flex", gap: 10 }}>
            <button type="button" className="btn btn-secondary" onClick={onCerrar} disabled={guardando}>Cancelar</button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={!puede}
              onClick={() => onConfirmar(texto.trim())}
              style={colorBoton ? { background: colorBoton, borderColor: colorBoton } : undefined}
            >
              {guardando ? "Guardando…" : textoConfirmar}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Ventana: registrar el pago recibido por el link de Webpay (2026-11-09) ──
   El cliente escribe el monto a mano en la página de Webpay, así que el monto
   recibido se anota tal cual sale en Transbank; si no calza con el total del
   pedido, se avisa pero se deja registrar (queda en la bitácora). */
function ModalRegistrarPago({ pedido, guardando = false, onCerrar, onConfirmar }) {
  const total = Math.round(Number(pedido?.monto_total) || 0);
  const [monto, setMonto] = useState(total > 0 ? String(total) : "");
  const [autorizacion, setAutorizacion] = useState("");
  const [nota, setNota] = useState("");
  useEffect(() => {
    const alTeclear = (e) => { if (e.key === "Escape") onCerrar(); };
    window.addEventListener("keydown", alTeclear);
    return () => window.removeEventListener("keydown", alTeclear);
  }, [onCerrar]);
  const montoNum = Math.round(Number(String(monto).replace(/[^\d]/g, "")) || 0);
  const distinto = montoNum > 0 && total > 0 && montoNum !== total;
  const informado = pedido?.pago_estado === "informado";
  const det = pedido?.pago_detalle || {};
  return (
    <div
      onMouseDown={(e) => { if (e.target === e.currentTarget) onCerrar(); }}
      style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.55)", zIndex: 12000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
    >
      <div style={{ width: 500, maxWidth: "100%", background: "var(--surface)", borderRadius: 14, padding: 20, border: "1px solid var(--border)" }}>
        <h3 style={{ margin: "0 0 4px", fontSize: 16, fontWeight: 800, color: "var(--text)" }}>Registrar el pago del pedido N° {pedido.id}</h3>
        <p style={{ margin: "0 0 12px", fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.5 }}>
          Revisa en el portal de Transbank que el pago haya entrado. Al registrarlo, el pedido queda <strong>Pagado</strong> y
          el cliente recibe el aviso en su portal y por correo.
        </p>
        {informado && (
          <div style={{ fontSize: 12.5, color: "#5b21b6", background: "#f5f3ff", border: "1px solid #ddd6fe", borderRadius: 9, padding: "8px 10px", marginBottom: 12 }}>
            El cliente informó el pago{det.informado_at ? ` el ${fmtFechaHora(det.informado_at)}` : ""}
            {quienDe(det.informado_por) ? ` · ${quienDe(det.informado_por)}` : ""}
            {det.informado_nota ? <>: «{det.informado_nota}»</> : "."}
          </div>
        )}
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <label style={{ flex: "1 1 180px", display: "flex", flexDirection: "column", gap: 4, fontSize: 12, fontWeight: 700, color: "var(--text)" }}>
            Monto recibido (CLP)
            <input
              className="input"
              autoFocus
              inputMode="numeric"
              value={monto}
              onChange={(e) => setMonto(e.target.value)}
              placeholder={String(total)}
            />
          </label>
          <label style={{ flex: "1 1 180px", display: "flex", flexDirection: "column", gap: 4, fontSize: 12, fontWeight: 700, color: "var(--text)" }}>
            Código de autorización (opcional)
            <input className="input" value={autorizacion} onChange={(e) => setAutorizacion(e.target.value)} maxLength={40} placeholder="Ej: 123456" />
          </label>
        </div>
        <div style={{ fontSize: 11.5, marginTop: 6, color: distinto ? "#b45309" : "var(--text-muted)" }}>
          Total del pedido: {fmtCLP(total)}
          {distinto ? ` · el monto recibido no coincide (diferencia ${fmtCLP(montoNum - total)}); queda anotado en la bitácora.` : ""}
        </div>
        <textarea
          className="input"
          rows={2}
          value={nota}
          onChange={(e) => setNota(e.target.value)}
          placeholder="Nota (opcional)"
          maxLength={300}
          style={{ width: "100%", resize: "vertical", height: "auto", minHeight: 56, padding: 10, fontSize: 13, lineHeight: 1.45, marginTop: 12 }}
        />
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
          <button type="button" className="btn btn-secondary" onClick={onCerrar} disabled={guardando}>Cancelar</button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={guardando || montoNum <= 0}
            onClick={() => onConfirmar({ monto: montoNum, autorizacion: autorizacion.trim(), nota: nota.trim() })}
          >
            {guardando ? "Guardando…" : `Registrar pago de ${fmtCLP(montoNum)}`}
          </button>
        </div>
      </div>
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
/* Cómo se pagó, para la línea de tiempo. */
const MEDIOS_PAGO = { webpay: "Webpay", webpay_link: "Webpay (link)", credito: "Crédito", transferencia: "Transferencia" };

function PanelFlujoPedido({ pedido, ocupado = false, onValidar, onObservar, onRechazar, onRevertir, onSos, onRegistrarPago, onVerHistorial }) {
  const estado = flujoDe(pedido);
  const m = flujoMeta(estado);
  const cerrado = CERRADOS.includes(estado);
  // (2026-11-09) Pago por el link fijo de Webpay: el cliente avisa que pagó.
  const detPago = pedido.pago_detalle || {};
  const pagoInformado = estado === "validado_plataforma" && pedido.pago_estado === "informado";
  const conCotizacion = Boolean(pedido.licitacion_id || pedido.cotizacion);
  /* (2026-11-09) Pasos intermedios con quién y cuándo. El paso «Cotización
     enviada» se retiró con la etapa: repetía el «Enviado». */
  /* El pedido que envía el administrador de la cuenta llega directo, sin paso
     de aprobación: su `aprobado_cliente_at` es la hora del envío (sirve a los
     KPI), y mostrarlo como «Aprobado por el cliente» decía que alguien aprobó
     algo que nadie aprobó (solicitud 28). Solo se muestra la aprobación real:
     la del administrador sobre el pedido que armó un asistente. */
  const envioDirecto = Boolean(
    pedido.aprobado_cliente_at && pedido.created_at &&
    Math.abs(new Date(pedido.aprobado_cliente_at) - new Date(pedido.created_at)) < 60000,
  );
  const pasos = [
    { key: "enviado", label: "Enviado", fecha: pedido.created_at, quien: quienDe(pedido.creado_por_email) },
    ...(envioDirecto
      ? []
      : [{ key: "aprobado", label: "Aprobado por el cliente", fecha: pedido.aprobado_cliente_at, quien: quienDe(pedido.aprobado_cliente_por) }]),
    { key: "revision", label: "En revisión", fecha: pedido.revision_iniciada_at, quien: quienDe(pedido.revision_por) },
    { key: "validado", label: "Validado por Amsodent", fecha: pedido.validado_at, quien: quienDe(pedido.validado_por) },
    {
      key: "pagado",
      label: "Pagado",
      fecha: pedido.pago_at,
      quien: [MEDIOS_PAGO[pedido.pago_medio] || pedido.pago_medio, quienDe(detPago.registrado_por)].filter(Boolean).join(" · "),
    },
  ];

  return (
    <div style={{ background: "#fff", border: "1px solid #eef2f7", borderRadius: 10, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <strong style={{ fontSize: 12.5, color: "#334155" }}>Flujo del pedido</strong>
        <BadgeFlujo valor={estado} />
        <span style={{ fontSize: 11.5, color: "var(--text-muted)" }}>{m.ayuda}</span>
      </div>

      {/* Línea de tiempo con los tiempos de respuesta de cada tramo. La demora
          se mide contra el último paso que sí tiene fecha (un pedido puede
          saltarse «En revisión» si se validó de una). */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        {pasos.map((p, i) => {
          const hecho = Boolean(p.fecha);
          const previo = pasos.slice(0, i).reverse().find((x) => x.fecha)?.fecha || null;
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
              {p.extra && hecho && (
                <div style={{ fontSize: 10.5, color: "#15803d", fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis" }}>{p.extra}</div>
              )}
              {demora && <div style={{ fontSize: 10.5, color: "#0369a1", fontWeight: 700 }}>+{demora}</div>}
            </div>
          );
        })}
      </div>

      {/* (2026-11-09) Observación abierta o ya respondida, y rechazo. */}
      {pedido.observacion_at && (
        <div style={{ border: "1px solid #fed7aa", background: estado === "observado" ? "#fff7ed" : "#fff", borderRadius: 10, padding: "10px 12px" }}>
          <div style={{ fontSize: 12.5, fontWeight: 800, color: "#9a3412" }}>
            {estado === "observado" ? "Observación enviada al cliente · esperando su respuesta" : "Observación respondida"}
            <span style={{ fontWeight: 500 }}>
              {" · "}{fmtFechaHora(pedido.observacion_at)}
              {quienDe(pedido.observacion_por) ? ` · ${quienDe(pedido.observacion_por)}` : ""}
            </span>
          </div>
          <div style={{ fontSize: 12.5, color: "#475569", marginTop: 4, whiteSpace: "pre-wrap" }}>{pedido.observacion_texto}</div>
          {pedido.observacion_respondida_at && (
            <div style={{ fontSize: 12, color: "#166534", marginTop: 6 }}>
              <strong>Respuesta del cliente</strong>
              {" · "}{fmtFechaHora(pedido.observacion_respondida_at)}
              {quienDe(pedido.observacion_respondida_por) ? ` · ${quienDe(pedido.observacion_respondida_por)}` : ""}
              {": "}{pedido.observacion_respuesta || "acepta seguir con el pedido tal como está."}
            </div>
          )}
        </div>
      )}
      {estado === "rechazado" && (
        <div style={{ border: "1px solid #fecaca", background: "#fef2f2", borderRadius: 10, padding: "10px 12px", fontSize: 12.5, color: "#991b1b" }}>
          <strong>Rechazado por Amsodent</strong>
          {pedido.rechazado_at ? ` · ${fmtFechaHora(pedido.rechazado_at)}` : ""}
          {quienDe(pedido.rechazado_por) ? ` · ${quienDe(pedido.rechazado_por)}` : ""}
          {pedido.rechazo_motivo && <div style={{ color: "#475569", marginTop: 4, whiteSpace: "pre-wrap" }}>{pedido.rechazo_motivo}</div>}
        </div>
      )}

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

      {/* Qué toca ahora, en una línea; abajo los botones de la etapa. */}
      {estado === "pendiente_aprobacion" && (
        <span style={{ fontSize: 12, color: "#b45309" }}>Esperando que el administrador de la cuenta del cliente apruebe el pedido.</span>
      )}
      {estado === "en_revision" && (pedido.revision_por || conCotizacion) && (
        <span style={{ fontSize: 12, color: "#0f766e" }}>
          {pedido.revision_por && <>Lo está revisando <strong>{quienDe(pedido.revision_por)}</strong>. </>}
          {conCotizacion && "El cliente ya tiene la cotización en su portal: falta validar existencias y enviar el link de pago."}
        </span>
      )}
      {estado === "observado" && (
        <span style={{ fontSize: 12, color: "#c2410c" }}>Esperando la respuesta del cliente. Si ya se resolvió por otro canal, se puede validar igual.</span>
      )}
      {estado === "validado_plataforma" && (
        pagoInformado ? (
          <div style={{ border: "1px solid #ddd6fe", background: "#f5f3ff", borderRadius: 10, padding: "9px 12px", fontSize: 12.5, color: "#5b21b6" }}>
            <strong>El cliente informó que pagó por Webpay</strong>
            {detPago.informado_at ? ` · ${fmtFechaHora(detPago.informado_at)}` : ""}
            {quienDe(detPago.informado_por) ? ` · ${quienDe(detPago.informado_por)}` : ""}
            {detPago.informado_nota && <div style={{ color: "#475569", marginTop: 3 }}>«{detPago.informado_nota}»</div>}
            <div style={{ color: "#475569", marginTop: 3 }}>Revísalo en el portal de Transbank y registra el pago para cerrar el pedido.</div>
          </div>
        ) : (
          <span style={{ fontSize: 12, color: "#6d28d9" }}>
            El cliente paga por el link de Webpay de Amsodent. Cuando el pago aparezca en Transbank, regístralo aquí.
          </span>
        )
      )}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {estado === "validado_plataforma" && (
          <button type="button" className="btn btn-primary btn-sm" onClick={onRegistrarPago} disabled={ocupado} title="Cierra el pedido como pagado y avisa al cliente">
            Registrar pago recibido
          </button>
        )}
        {VALIDABLES.includes(estado) && (
          <button
            type="button"
            className={estado === "observado" || estado === "validado_plataforma" ? "btn btn-secondary btn-sm" : "btn btn-primary btn-sm"}
            onClick={onValidar}
            disabled={ocupado}
          >
            {estado === "validado_plataforma" ? "Revalidar existencias" : "Validar existencias y enviar link de pago"}
          </button>
        )}
        {OBSERVABLES.includes(estado) && (
          <button type="button" className="btn btn-secondary btn-sm" onClick={onObservar} disabled={ocupado} title="Dejarle una observación al cliente y esperar su respuesta">
            Observar al cliente
          </button>
        )}
        {!cerrado && estado !== "pendiente_aprobacion" && (
          <button type="button" className="btn btn-secondary btn-sm" onClick={onRevertir} disabled={ocupado} title="Devuelve el pedido a la etapa anterior">
            Volver atrás
          </button>
        )}
        {/* (2026-11-09) Mientras espera la aprobación del administrador de la
            cuenta, el pedido no llegó a Amsodent: no se rechaza ni se marca SOS. */}
        {!cerrado && estado !== "pendiente_aprobacion" && (
          <button type="button" className="btn btn-secondary btn-sm" onClick={onRechazar} disabled={ocupado} style={{ color: "#b91c1c" }} title="Cierra el pedido con un motivo que el cliente lee">
            Rechazar
          </button>
        )}
        {estado !== "rechazado" && estado !== "cancelado" && estado !== "pendiente_aprobacion" && (
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={onSos}
            disabled={ocupado}
            style={{ color: pedido.sos ? "#b91c1c" : undefined }}
            title="SOS: despacho comprometido en 24 hrs"
          >
            {pedido.sos ? "Quitar SOS" : "Marcar SOS (24 h)"}
          </button>
        )}
        {/* (2026-09-24) Mismo historial que ve el cliente en su portal: sirve
            para entender el pedido sin tener que preguntarle que hizo. */}
        <button type="button" className="btn btn-secondary btn-sm" onClick={onVerHistorial} title="Actividad de la cuenta en el portal">
          Ver actividad del cliente
        </button>
      </div>
    </div>
  );
}

/* ── Modal: confirmar existencias producto por producto y emitir el pago ──
   (2026-11-09) El precio unitario salía en blanco: solo se llenaba con el
   `precio_referencia` de la línea, que traen las del Explorador de precios y
   las ofertas, pero no las de Gestión de Stock ni la mayoría del catálogo
   (solicitud 28). Ahora se sugiere, en este orden:
     1. lo que se puso en la validación anterior (al revalidar);
     2. la cotización vinculada al pedido (mismo SKU, o mismo nombre);
     3. el precio de la oferta, si la línea viene de una;
     4. el precio de lista que ve el cliente en el portal (lista 2, si no 1);
     5. la referencia de tienda que trajo la línea.
   Los precios son NETOS, como en la cotización y el catálogo, y el link de
   pago cobra el total con IVA: antes el total era la suma simple y, con
   precios netos, el cliente habría pagado sin IVA. */
const IVA_PEDIDO = 0.19;
const claveTexto = (v) => String(v || "").trim().toLowerCase();
const ORIGEN_PRECIO = {
  validacion: "validación anterior",
  cotizacion: "de la cotización",
  oferta: "precio de oferta",
  lista: "precio de lista",
  referencia: "referencia de tienda",
};

function ModalValidarPedido({ pedido, guardando, onCerrar, onConfirmar }) {
  const itemsPedido = Array.isArray(pedido.items) ? pedido.items : [];
  const previos = Array.isArray(pedido.disponibilidad) ? pedido.disponibilidad : [];
  const licId = Number(pedido.cotizacion?.id || pedido.licitacion_id) || null;
  const [filas, setFilas] = useState(() =>
    itemsPedido.map((it) => {
      const previo = previos.find((p) => p.nombre === it.nombre);
      const precioPrevio = previo ? Number(previo.precio_unitario) || 0 : 0;
      return {
        nombre: it?.nombre || "",
        cantidad_solicitada: Number(it?.cantidad) || 0,
        cantidad_disponible: previo ? Number(previo.cantidad_disponible) : Number(it?.cantidad) || 0,
        precio_unitario: precioPrevio > 0 ? precioPrevio : "",
        origen: precioPrevio > 0 ? "validacion" : "",
        nota: previo?.nota || "",
      };
    }),
  );
  // Precio sugerido por fila ({ precio, origen } o null), ya sin contar la validación anterior.
  const [sugeridos, setSugeridos] = useState([]);
  const [cargandoPrecios, setCargandoPrecios] = useState(true);
  const [nota, setNota] = useState("");

  useEffect(() => {
    let vivo = true;
    (async () => {
      const porSku = new Map();
      const porNombre = new Map();
      if (licId) {
        try {
          const items = await api.get(`/licitaciones/${licId}/items`);
          for (const it of Array.isArray(items) ? items : []) {
            const precio = Number(it?.valor_unitario) || 0;
            if (precio <= 0) continue;
            if (it?.sku && !porSku.has(claveTexto(it.sku))) porSku.set(claveTexto(it.sku), precio);
            if (it?.producto && !porNombre.has(claveTexto(it.producto))) porNombre.set(claveTexto(it.producto), precio);
          }
        } catch { /* sin la cotización se sigue con el catálogo */ }
      }
      const deCotizacion = (it) => porSku.get(claveTexto(it?.sku)) || porNombre.get(claveTexto(it?.nombre)) || 0;
      // El catálogo completo solo se pide si alguna línea con SKU no quedó con precio.
      const lista = new Map();
      if (itemsPedido.some((it) => it?.sku && !deCotizacion(it))) {
        try {
          const productos = await api.get("/productos/list");
          for (const p of Array.isArray(productos) ? productos : []) {
            const precio = Number(p?.lista2) || Number(p?.lista1) || 0;
            if (p?.sku && precio > 0) lista.set(claveTexto(p.sku), precio);
          }
        } catch { /* sin catálogo quedan la oferta y la referencia */ }
      }
      const resultado = itemsPedido.map((it) => {
        const cot = deCotizacion(it);
        if (cot) return { precio: cot, origen: "cotizacion" };
        const ref = Number(it?.precio_referencia) || 0;
        if (it?.oferta && ref > 0) return { precio: ref, origen: "oferta" };
        const lis = lista.get(claveTexto(it?.sku));
        if (lis) return { precio: lis, origen: "lista" };
        return ref > 0 ? { precio: ref, origen: "referencia" } : null;
      });
      if (!vivo) return;
      setSugeridos(resultado);
      setFilas((prev) =>
        prev.map((f, i) =>
          f.precio_unitario === "" && resultado[i] ? { ...f, precio_unitario: resultado[i].precio, origen: resultado[i].origen } : f,
        ),
      );
      setCargandoPrecios(false);
    })();
    return () => { vivo = false; };
    // Solo al abrir: el pedido no cambia mientras el modal está abierto.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const set = (i, patch) => setFilas((prev) => prev.map((f, k) => (k === i ? { ...f, ...patch } : f)));
  const neto = filas.reduce((acc, f) => acc + Number(f.cantidad_disponible || 0) * Number(f.precio_unitario || 0), 0);
  const iva = Math.round(neto * IVA_PEDIDO);
  const total = Math.round(neto) + iva;
  const faltantes = filas.filter((f) => Number(f.cantidad_disponible) < Number(f.cantidad_solicitada));
  const sinPrecio = filas.filter((f) => !(Number(f.precio_unitario) > 0)).length;
  // Al revalidar, la validación anterior manda; si sus precios difieren de los sugeridos se ofrece reemplazarlos.
  const distintos = filas.filter((f, i) => sugeridos[i] && Number(f.precio_unitario) !== sugeridos[i].precio).length;
  const usarSugeridos = () =>
    setFilas((prev) => prev.map((f, i) => (sugeridos[i] ? { ...f, precio_unitario: sugeridos[i].precio, origen: sugeridos[i].origen } : f)));
  const totalCotizacion = Number(pedido.cotizacion?.total_con_iva) || 0;

  return (
    <div
      onMouseDown={(e) => { if (e.target === e.currentTarget) onCerrar(); }}
      style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.55)", zIndex: 12000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
    >
      <div style={{ width: 800, maxWidth: "100%", minWidth: 0, boxSizing: "border-box", maxHeight: "88vh", overflow: "auto", background: "var(--surface)", borderRadius: 14, padding: 20, border: "1px solid var(--border)" }}>
        <h3 style={{ margin: "0 0 4px", fontSize: 16, fontWeight: 800, color: "var(--text)" }}>
          Validar el pedido N° {pedido.id}
        </h3>
        <p style={{ margin: "0 0 14px", fontSize: 12.5, color: "var(--text-muted)" }}>
          Confirma cuánto hay de cada producto y su precio neto
          {licId ? <> (sugerido desde la cotización #{licId} o el precio de lista)</> : <> (sugerido desde el precio de lista)</>}.
          El link de pago cobra el total con IVA y le llega al cliente al portal y por correo.
        </p>

        {!cargandoPrecios && distintos > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 10, fontSize: 12.5, color: "#0369a1", background: "#f0f9ff", border: "1px solid #bae6fd", borderRadius: 9, padding: "8px 12px" }}>
            <span style={{ flex: "1 1 240px" }}>
              {distintos} precio{distintos === 1 ? "" : "s"} de la validación anterior no coincide{distintos === 1 ? "" : "n"} con
              {licId ? " la cotización o el precio de lista" : " el precio de lista"}.
            </span>
            <button type="button" className="btn btn-secondary btn-sm" onClick={usarSugeridos}>
              Usar precios sugeridos
            </button>
          </div>
        )}

        <div className="table-wrap">
          {/* tabla-texto: los nombres largos parten línea en vez de empujar
              las columnas de precio fuera del modal. */}
          <table className="data-table tabla-compacta tabla-texto">
            <thead>
              <tr>
                <th style={{ textAlign: "left", minWidth: 180 }}>Producto</th>
                <th style={{ textAlign: "right", width: 80 }}>Pedido</th>
                <th style={{ textAlign: "right", width: 100 }}>Disponible</th>
                <th style={{ textAlign: "right", width: 140 }} title="Sin IVA, como en la cotización">Precio unit. neto</th>
                <th style={{ textAlign: "right", width: 110 }}>Subtotal neto</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f, i) => {
                const falta = Number(f.cantidad_disponible) < Number(f.cantidad_solicitada);
                const sinValor = !(Number(f.precio_unitario) > 0);
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
                        style={{ height: 30, width: 80, textAlign: "right" }}
                      />
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <input
                        className="input"
                        type="number"
                        min={0}
                        value={f.precio_unitario}
                        placeholder={cargandoPrecios && f.precio_unitario === "" ? "Buscando…" : "0"}
                        onChange={(e) => set(i, { precio_unitario: e.target.value, origen: "" })}
                        style={{ height: 30, width: 110, textAlign: "right", borderColor: !cargandoPrecios && sinValor ? "#f59e0b" : undefined }}
                      />
                      <div style={{ fontSize: 10.5, marginTop: 2, color: !cargandoPrecios && sinValor ? "#b45309" : "var(--text-muted)" }}>
                        {cargandoPrecios && f.precio_unitario === ""
                          ? "buscando precio…"
                          : sinValor
                            ? "sin precio: ingrésalo"
                            : f.origen === "cotizacion" && licId
                              ? `de la cotización #${licId}`
                              : ORIGEN_PRECIO[f.origen] || "ingresado a mano"}
                      </div>
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

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginTop: 14, gap: 12, flexWrap: "wrap" }}>
          <input
            className="input"
            value={nota}
            onChange={(e) => setNota(e.target.value)}
            placeholder="Nota general del pedido (opcional)"
            style={{ flex: "1 1 260px" }}
          />
          <div style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", lineHeight: 1.5 }}>
            <div style={{ fontSize: 12.5, color: "var(--text-muted)" }}>
              Neto {fmtCLP(neto)} · IVA 19% {fmtCLP(iva)}
            </div>
            <div style={{ fontSize: 15, fontWeight: 800, color: "var(--text)" }}>
              Total a pagar: {fmtCLP(total)}
            </div>
            {totalCotizacion > 0 && Math.abs(totalCotizacion - total) > 1 && (
              <div style={{ fontSize: 11.5, color: "#b45309" }}>
                La cotización #{licId} suma {fmtCLP(totalCotizacion)} con IVA.
              </div>
            )}
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", flexWrap: "wrap", gap: 10, marginTop: 16 }}>
          <button type="button" className="btn btn-secondary" onClick={onCerrar}>Cancelar</button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={guardando || cargandoPrecios || total <= 0}
            onClick={() =>
              onConfirmar({
                disponibilidad: filas.map(({ nombre, cantidad_solicitada, cantidad_disponible, precio_unitario, nota: n }) => ({
                  nombre,
                  cantidad_solicitada,
                  cantidad_disponible,
                  precio_unitario,
                  nota: n,
                })),
                monto_total: total,
                nota,
              })
            }
            title={
              cargandoPrecios
                ? "Buscando los precios…"
                : total <= 0
                  ? "El monto debe ser mayor a cero"
                  : sinPrecio
                    ? `${sinPrecio} producto${sinPrecio === 1 ? "" : "s"} sin precio: quedarán en $0`
                    : "Confirma y envía el link de pago"
            }
          >
            {guardando ? "Guardando…" : `Confirmar y enviar link de pago (${fmtCLP(total)})`}
          </button>
        </div>
      </div>
    </div>
  );
}
