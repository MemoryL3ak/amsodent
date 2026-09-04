import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import useAuth from "../hooks/useAuth";
import MonthCalendarPicker from "../components/MonthCalendarPicker";
import DateFilter from "../components/DateFilter";
import EmbudoComercial from "../components/panel/EmbudoComercial";
import ModalAvanceMeta from "../components/ModalAvanceMeta";
import ModalMargenDesglose from "../components/panel/ModalMargenDesglose";
import {
  TrendingUp, TrendingDown, Minus, ShoppingCart, Target, FileText,
  UserPlus, RefreshCw, Award, Banknote, X, Download,
} from "lucide-react";

/* ── Helpers ──────────────────────────────────────────────────────────── */
function fmtCLP(v) { return `$${Number(v || 0).toLocaleString("es-CL")}`; }
function fmtNum(v) { return Number(v || 0).toLocaleString("es-CL"); }
function fmtPct(v) { return Number.isFinite(Number(v)) ? `${Number(v).toFixed(1)}%` : "—"; }
function clamp(v, a, b) { return Math.min(b, Math.max(a, Number(v || 0))); }

function inicioMesISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}
function mesDe(value) { return value ? String(value).slice(0, 7) : ""; } // 'YYYY-MM'
function toDateISO(value) {
  if (!value) return "";
  const s = String(value);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
}
function addMesKey(key, delta) {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function labelMesCorto(key) {
  const [y, m] = key.split("-").map(Number);
  const s = new Date(y, m - 1, 1).toLocaleDateString("es-CL", { month: "short" });
  return s.charAt(0).toUpperCase() + s.slice(1, 3);
}

// "diego.cruz" → "Diego Cruz" (fallback cuando el perfil aún no carga o no
// tiene nombre registrado).
function nombreDesdeEmail(email) {
  return String(email || "")
    .split("@")[0]
    .split(/[._-]+/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ");
}

function iniciales(nombre) {
  const partes = String(nombre || "").trim().split(/\s+/).filter(Boolean);
  return ((partes[0]?.[0] || "") + (partes[1]?.[0] || "")).toUpperCase() || "?";
}

// El bloque "Avance de Metas" mide SOLO al equipo comercial: los perfiles de
// administración (aunque tengan meta asignada o cotizaciones creadas) quedan
// fuera de la meta, del avance y de las tarjetas. Rol desconocido (perfil aún
// no cargado) se trata como venta para no ocultar gente real mientras carga.
const ROLES_VENTA = new Set(["ventas", "ventas_especial", "jefe_ventas", "jefe_ventas_especial"]);
function esRolVenta(rol) {
  const r = String(rol || "").trim().toLowerCase();
  return !r || ROLES_VENTA.has(r);
}

// Gradiente estable por persona para el avatar (misma paleta del chat).
const AVATAR_COLORES = [
  ["#0f766e", "#14b8a6"], ["#0369a1", "#0ea5e9"], ["#6d28d9", "#a855f7"],
  ["#be185d", "#f0609b"], ["#c2410c", "#fb923c"], ["#15803d", "#34d399"],
  ["#1d4ed8", "#60a5fa"], ["#a21caf", "#e879f9"],
];
function avatarFondo(txt) {
  let h = 0;
  const t = String(txt || "?");
  for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) % AVATAR_COLORES.length;
  const [a, b] = AVATAR_COLORES[h];
  return `linear-gradient(135deg, ${a}, ${b})`;
}

const ESTADOS_ABIERTOS = ["En espera", "Pendiente Aprobación", "Pendiente Aprobación Peso"];
const ESTADOS_PERDIDOS = ["Perdida", "Desierta", "Descartada", "Cancelada"];
const COLORES_CAT = ["#28aeb1", "#6366f1", "#f59e0b", "#16a34a", "#ec4899", "#0ea5e9", "#a855f7", "#ef4444", "#14b8a6", "#84cc16"];

/* ── Delta (vs mes anterior) ──────────────────────────────────────────── */
function Delta({ actual, prev, modo = "pct", unidadPp = false }) {
  // pp: diferencia en puntos porcentuales (para %). pct: variación porcentual.
  let val = null;
  if (unidadPp) val = (actual ?? 0) - (prev ?? 0);
  else if (prev) val = ((actual - prev) / Math.abs(prev)) * 100;
  if (val == null || !Number.isFinite(val)) {
    return <span style={{ fontSize: 11, color: "var(--text-muted)" }}>sin base previa</span>;
  }
  const sube = val > 0.05;
  const baja = val < -0.05;
  const color = sube ? "#16a34a" : baja ? "#dc2626" : "var(--text-muted)";
  const Icon = sube ? TrendingUp : baja ? TrendingDown : Minus;
  const txt = unidadPp ? `${val > 0 ? "+" : ""}${val.toFixed(1)} pp` : `${val > 0 ? "+" : ""}${val.toFixed(1)}%`;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, fontWeight: 600, color }}>
      <Icon size={13} /> {txt} <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>vs. mes anterior</span>
    </span>
  );
}

function KpiCard({ icon: Icon, color, label, sub, value, delta }) {
  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderTop: `3px solid ${color}`, borderRadius: "var(--radius-lg)", padding: "16px 18px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <span style={{ width: 30, height: 30, borderRadius: 8, background: `${color}18`, color, display: "grid", placeItems: "center", flexShrink: 0 }}>
          <Icon size={16} />
        </span>
        <div style={{ lineHeight: 1.15 }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".04em", color: "var(--text-muted)" }}>{label}</div>
          {sub ? <div style={{ fontSize: 10, color: "var(--text-muted)" }}>{sub}</div> : null}
        </div>
      </div>
      <div style={{ fontSize: 24, fontWeight: 800, color: "var(--text)", lineHeight: 1.1 }}>{value}</div>
      <div style={{ marginTop: 6 }}>{delta}</div>
    </div>
  );
}

/* ── Página ───────────────────────────────────────────────────────────── */
export default function PanelIndicadores() {
  const { rol, cargando } = useAuth();
  const rolNorm = (rol || "").toString().trim().toLowerCase();
  const esAdmin = rolNorm === "admin" || rolNorm === "administrador";
  const esJefatura = ["jefe_ventas", "jefe ventas", "jefe-ventas", "jefe de ventas", "jefe_ventas_especial"].includes(rolNorm);
  const puedeVer = esAdmin || esJefatura;

  const [periodo, setPeriodo] = useState(inicioMesISO());
  const [rangoDesde, setRangoDesde] = useState(""); // rango opcional (manda sobre el mes)
  const [rangoHasta, setRangoHasta] = useState("");
  const [filtroTipo, setFiltroTipo] = useState(""); // "" todos | "publica" | "particular"
  const [filtroRegionPanel, setFiltroRegionPanel] = useState(""); // búsqueda en resumen por región
  const [loading, setLoading] = useState(true);
  const [lics, setLics] = useState([]);
  const [adjDateByLic, setAdjDateByLic] = useState({});
  const [docSums, setDocSums] = useState({}); // { [licId]: { guia, oc, factbol } }
  const [docsConsumo, setDocsConsumo] = useState([]); // guías/boletas/efectivo crudos (detalle avance de metas)
  const [docsOC, setDocsOC] = useState([]); // órdenes de compra crudas: { licId, numero, monto, fecha }
  const [cerradasForzadas, setCerradasForzadas] = useState(() => new Set()); // licIds con cierre forzado
  const [ventasOpen, setVentasOpen] = useState(false); // modal detalle del KPI Ventas Totales
  // Comparativo de facturación contra Bsale: null = sin datos (no admin / sin token / cargando)
  const [bsaleVentas, setBsaleVentas] = useState(null);
  // Modal detalle del avance de metas: null | { email: null (equipo) | email del ejecutivo, nombre }
  const [avanceMetaOpen, setAvanceMetaOpen] = useState(null);
  const [metasPorVendedor, setMetasPorVendedor] = useState({}); // email → meta_neto del periodo
  const [catData, setCatData] = useState([]); // [{ categoria, monto, productos:[{producto,monto}] }]
  const [margenMes, setMargenMes] = useState({ monto: 0, pct: 0 });
  const [costoBySku, setCostoBySku] = useState({}); // sku → costo (para el margen)
  const [mostrarProductos, setMostrarProductos] = useState(false);
  const [metaCotizaciones, setMetaCotizaciones] = useState(0);
  const [margenPorLic, setMargenPorLic] = useState([]); // [{licId, venta, costo}] adjudicadas del periodo
  const [margenOpen, setMargenOpen] = useState(false); // modal de desglose del margen
  const [adjOpen, setAdjOpen] = useState(false); // modal con el detalle de las adjudicadas del período
  const [nombresVendedores, setNombresVendedores] = useState({}); // email → nombre
  const [rolesVendedores, setRolesVendedores] = useState({}); // email → rol (para ordenar el avance de metas)
  const [disponibles, setDisponibles] = useState([]); // postulaciones del listado (tomadas / no aplica / vencidas)

  // Público vs particular según tipo_cliente de la licitación.
  const esParticular = (l) => (l?.tipo_cliente || "").toLowerCase().includes("particular");
  const pasaTipo = (l) => {
    if (filtroTipo === "publica") return !esParticular(l);
    if (filtroTipo === "particular") return esParticular(l);
    return true;
  };

  const mesActual = mesDe(periodo);
  const mesPrev = addMesKey(mesActual, -1);

  // Filtro de periodo: si hay rango activo manda sobre el mes seleccionado.
  const rangoActivo = Boolean(rangoDesde || rangoHasta);
  const periodoInicio = rangoActivo ? (rangoDesde || "") : `${mesActual}-01`;
  const enPeriodo = useMemo(() => (value) => {
    const d = toDateISO(value);
    if (!d) return false;
    if (rangoActivo) {
      if (rangoDesde && d < rangoDesde) return false;
      if (rangoHasta && d > rangoHasta) return false;
      return true;
    }
    return mesDe(d) === mesActual;
  }, [rangoActivo, rangoDesde, rangoHasta, mesActual]);

  // Carga base: licitaciones + fecha de adjudicación (1ª OC/factura/efectivo).
  useEffect(() => {
    if (cargando || !puedeVer) { if (!cargando) setLoading(false); return; }
    let activo = true;
    (async () => {
      setLoading(true);
      try {
        const data = await api.get(
          "/licitaciones/with-fields?fields=id,id_licitacion,nombre_entidad,rut_entidad,fecha,fecha_adjudicada,estado,creado_por,total_con_iva,total_sin_iva,monto,tipo_compra,tipo_cliente,region"
        );
        const rows = data || [];
        const ids = rows.map((l) => Number(l.id)).filter(Boolean);
        const adj = {};
        const sums = {}; // { lid: { guia, oc, factbol } }
        if (ids.length) {
          const docs = await api.post("/licitaciones/documentos/filter", {
            filter: {
              licitacion_ids: ids,
              tipo: ["orden_compra", "guia_despacho", "factura", "factura_boleta", "efectivo", "cierre_forzado"],
            },
            fields: "licitacion_id,tipo,numero,monto,fecha_oc,created_at",
          });
          const consumo = []; // guías/boletas/efectivo crudos (detalle avance de metas)
          const ocs = []; // órdenes de compra crudas (saldo por consumir)
          const cerradas = new Set(); // cierre forzado: fuera del saldo por consumir
          (docs || []).forEach((d) => {
            const lid = Number(d.licitacion_id);
            if (!lid) return;
            if (d.tipo === "cierre_forzado") { cerradas.add(lid); return; }
            const monto = Number(d.monto || 0);
            const acc = (sums[lid] = sums[lid] || { guia: 0, oc: 0, factbol: 0 });
            if (d.tipo === "guia_despacho") acc.guia += monto;
            else if (d.tipo === "orden_compra") acc.oc += monto;
            else if (d.tipo === "factura" || d.tipo === "factura_boleta" || d.tipo === "efectivo") acc.factbol += monto;
            // Fecha de adjudicación: primera OC (público) o boleta/efectivo (particular).
            if (d.tipo === "orden_compra" || d.tipo === "factura_boleta" || d.tipo === "efectivo") {
              const f = toDateISO(d.fecha_oc) || toDateISO(d.created_at);
              if (f && (!adj[lid] || f < adj[lid])) adj[lid] = f;
            }
            const fila = {
              licId: lid,
              tipo: d.tipo,
              numero: (d.numero || "").toString(),
              monto,
              fecha: toDateISO(d.fecha_oc) || toDateISO(d.created_at),
            };
            if (d.tipo === "orden_compra") ocs.push(fila);
            else consumo.push(fila);
          });
          if (activo) { setDocsConsumo(consumo); setDocsOC(ocs); setCerradasForzadas(cerradas); }
        }
        if (!activo) return;
        setLics(rows);
        setAdjDateByLic(adj);
        setDocSums(sums);
      } catch (e) {
        console.error("Error cargando panel:", e);
        if (activo) { setLics([]); setAdjDateByLic({}); setDocSums({}); setDocsConsumo([]); }
      } finally {
        if (activo) setLoading(false);
      }
    })();
    return () => { activo = false; };
  }, [cargando, puedeVer]);

  // Catálogo de costos por SKU: `items_licitacion` no guarda costo, así que el
  // margen se calcula cruzando el SKU del ítem con el costo del producto.
  useEffect(() => {
    if (cargando || !puedeVer) return;
    let activo = true;
    (async () => {
      try {
        const prods = await api.get("/productos");
        const m = {};
        (prods || []).forEach((p) => {
          const sku = String(p.sku || "").trim().toUpperCase();
          if (sku) m[sku] = Number(p.costo || 0);
        });
        if (activo) setCostoBySku(m);
      } catch (e) {
        console.error("Error cargando costos de productos:", e);
        if (activo) setCostoBySku({});
      }
    })();
    return () => { activo = false; };
  }, [cargando, puedeVer]);

  // Ventas por categoría del mes (ítems de cotizaciones adjudicadas del mes).
  useEffect(() => {
    if (cargando || !puedeVer) return;
    let activo = true;
    (async () => {
      const idsMes = lics
        .filter((l) => pasaTipo(l) && enPeriodo(adjDateByLic[l.id]))
        .map((l) => Number(l.id));
      if (!idsMes.length) { if (activo) { setCatData([]); setMargenMes({ monto: 0, pct: 0 }); setMargenPorLic([]); } return; }
      try {
        const items = await api.post("/licitaciones/items/filter", {
          licitacion_ids: idsMes,
          fields: "licitacion_id,producto,categoria,total,cantidad,sku,costo",
        });
        const mapCat = {};      // cat -> total
        const mapCatProd = {};  // cat -> { producto -> monto }
        const porLic = {};      // licId -> { venta, costo } (desglose del margen)
        let ventaNeta = 0, costoTotal = 0; // para el margen del mes
        (items || []).forEach((it) => {
          const total = Number(it.total || 0);
          const cat = (it.categoria || "Sin categoría").trim() || "Sin categoría";
          const prod = (it.producto || "Sin nombre").trim() || "Sin nombre";
          mapCat[cat] = (mapCat[cat] || 0) + total;
          (mapCatProd[cat] = mapCatProd[cat] || {});
          mapCatProd[cat][prod] = (mapCatProd[cat][prod] || 0) + total;
          ventaNeta += total;
          const sku = String(it.sku || "").trim().toUpperCase();
          // Costo guardado CON la cotización (incluye el costo editado a mano
          // en el detalle, que antes este panel no veía y el margen no
          // cuadraba con la cotización). Filas anteriores a la columna
          // `costo` vienen null → costo vigente del catálogo, como siempre.
          const costoUnit = Number(it.costo) > 0 ? Number(it.costo) : (costoBySku[sku] || 0);
          const costoItem = costoUnit * (Number(it.cantidad) || 0);
          costoTotal += costoItem;
          const lid = Number(it.licitacion_id);
          if (lid) {
            const acc = (porLic[lid] = porLic[lid] || { venta: 0, costo: 0 });
            acc.venta += total;
            acc.costo += costoItem;
          }
        });
        const margenMonto = Math.round(ventaNeta - costoTotal);
        const margenPct = ventaNeta > 0 ? (margenMonto / ventaNeta) * 100 : 0;
        if (activo) setMargenMes({ monto: margenMonto, pct: margenPct });
        if (activo) setMargenPorLic(Object.entries(porLic).map(([licId, v]) => ({ licId: Number(licId), ...v })));
        const arrCat = Object.entries(mapCat).map(([categoria, monto]) => ({
          categoria,
          monto,
          productos: Object.entries(mapCatProd[categoria] || {})
            .map(([producto, m]) => ({ producto, monto: m }))
            .sort((a, b) => b.monto - a.monto),
        })).sort((a, b) => b.monto - a.monto);
        if (activo) setCatData(arrCat);
      } catch (e) {
        console.error("Error ventas por categoría:", e);
        if (activo) setCatData([]);
      }
    })();
    return () => { activo = false; };
  }, [cargando, puedeVer, lics, adjDateByLic, enPeriodo, filtroTipo, costoBySku]);

  // Nombres de los vendedores (para el desglose del margen y el avance de
  // metas). Incluye también a los que tienen META definida aunque no tengan
  // cotizaciones en el período — si no, aparecían como "diego.cruz".
  useEffect(() => {
    if (cargando || !puedeVer) return;
    const emails = Array.from(new Set([
      ...lics.map((l) => (l.creado_por || "").trim().toLowerCase()),
      ...Object.keys(metasPorVendedor),
    ].filter(Boolean)));
    if (!emails.length) { setNombresVendedores({}); return; }
    let activo = true;
    api.post("/usuarios/profiles/by-emails", { emails })
      .then((perfiles) => {
        if (!activo) return;
        const m = {};
        const roles = {};
        (perfiles || []).forEach((p) => {
          const email = (p.email || "").trim().toLowerCase();
          m[email] = (p.nombre || "").trim();
          roles[email] = (p.rol || "").trim().toLowerCase();
        });
        setNombresVendedores(m);
        setRolesVendedores(roles);
      })
      .catch(() => {});
    return () => { activo = false; };
  }, [cargando, puedeVer, lics, metasPorVendedor]);

  // Listado de postulaciones disponibles (mercado público): tomadas / no aplica / vencidas.
  useEffect(() => {
    if (cargando || !puedeVer) return;
    let activo = true;
    api.get("/licitaciones/disponibles")
      .then((rows) => { if (activo) setDisponibles(Array.isArray(rows) ? rows : []); })
      .catch(() => { if (activo) setDisponibles([]); });
    return () => { activo = false; };
  }, [cargando, puedeVer]);

  // Metas (donde existan): N° cotizaciones del equipo + monto neto de vendedores.
  useEffect(() => {
    if (cargando || !puedeVer) return;
    let activo = true;
    (async () => {
      try {
        const mc = await api.get(`/metas/cotizaciones-equipo?periodo=${periodo}`);
        if (activo) setMetaCotizaciones(Number(mc?.meta) || 0);
      } catch { if (activo) setMetaCotizaciones(0); }
      try {
        const mm = await api.get(`/metas/mensuales?periodo=${periodo}`);
        const porVendedor = {};
        (mm || []).forEach((r) => {
          const email = (r?.vendedor_email || "").trim().toLowerCase();
          if (email) porVendedor[email] = Number(r?.meta_neto || 0);
        });
        if (activo) setMetasPorVendedor(porVendedor);
      } catch { if (activo) setMetasPorVendedor({}); }
    })();
    return () => { activo = false; };
  }, [cargando, puedeVer, periodo]);

  // Venta / adjudicado por licitación, según su tipo de cliente (basado en documentos).
  //  Público   → Ventas = Σ guías de despacho;  Adjudicado = Σ órdenes de compra.
  //  Particular → Ventas = Adjudicado = Σ boletas/facturas.
  const ventaDeLic = (l) => {
    const ds = docSums[l.id] || {};
    return esParticular(l) ? (ds.factbol || 0) : (ds.guia || 0);
  };
  const adjudicadoDeLic = (l) => {
    const ds = docSums[l.id] || {};
    return esParticular(l) ? (ds.factbol || 0) : (ds.oc || 0);
  };
  // Monto neto de la OC (la OC se guarda neta); fallback al neto de la cotización.
  const netoDeLic = (l) => {
    const oc = (docSums[l.id] || {}).oc || 0;
    if (oc > 0) return oc;
    const sinIva = Number(l.total_sin_iva || 0);
    if (sinIva > 0) return sinIva;
    return Math.round(Number(l.total_con_iva || 0) / 1.19);
  };

  // Resumen por región (del mes seleccionado, respetando el filtro de tipo).
  //  - Cotizaciones: creadas en el mes (por fecha).
  //  - Adjudicadas / Ventas / Adjudicado: adjudicadas en el mes.
  const resumenPorRegion = useMemo(() => {
    const m = new Map();
    const get = (region) => {
      const key = region || "Sin región";
      if (!m.has(key)) m.set(key, { region: key, cotizaciones: 0, adjudicadas: 0, ventas: 0, adjudicado: 0 });
      return m.get(key);
    };
    lics.forEach((l) => {
      if (!pasaTipo(l)) return;
      const region = (l.region || "").toString().trim() || "Sin región";
      if (enPeriodo(l.fecha)) get(region).cotizaciones += 1;
      if (enPeriodo(adjDateByLic[l.id])) {
        const r = get(region);
        r.adjudicadas += 1;
        r.ventas += ventaDeLic(l);
        r.adjudicado += adjudicadoDeLic(l);
      }
    });
    return Array.from(m.values())
      .filter((r) => r.cotizaciones > 0 || r.adjudicadas > 0)
      .sort((a, b) => b.ventas - a.ventas || b.adjudicadas - a.adjudicadas);
  }, [lics, adjDateByLic, docSums, enPeriodo, filtroTipo]);

  const resumenRegionFiltrado = useMemo(() => {
    const q = filtroRegionPanel.trim().toLowerCase();
    if (!q) return resumenPorRegion;
    return resumenPorRegion.filter((r) => r.region.toLowerCase().includes(q));
  }, [resumenPorRegion, filtroRegionPanel]);

  // Métricas para un predicado de fecha (pred(dateISO) => bool). Sirve tanto
  // para un mes ('YYYY-MM') como para el rango activo.
  const calcMetricas = useMemo(() => {
    return (pred) => {
      let ventas = 0, ventasNeto = 0, adjudicadoMonto = 0, adjudicadas = 0, cotizaciones = 0;
      const clientesMes = new Set();
      lics.forEach((l) => {
        if (!pasaTipo(l)) return;
        // Las cotizaciones descartadas no cuentan en el total.
        if (pred(l.fecha) && l.estado !== "Descartada") cotizaciones++;
        if (pred(adjDateByLic[l.id])) {
          adjudicadas++;
          ventas += ventaDeLic(l);
          adjudicadoMonto += adjudicadoDeLic(l);
          ventasNeto += Number(l.total_sin_iva || l.total_con_iva || 0);
          const c = (l.rut_entidad || l.nombre_entidad || "").trim().toLowerCase();
          if (c) clientesMes.add(c);
        }
      });
      const conversion = cotizaciones > 0 ? (adjudicadas / cotizaciones) * 100 : 0;
      const ticket = adjudicadas > 0 ? ventas / adjudicadas : 0;
      return { ventas, ventasNeto, adjudicadoMonto, adjudicadas, cotizaciones, conversion, ticket, clientes: clientesMes };
    };
  }, [lics, adjDateByLic, docSums, filtroTipo]);

  // Métricas de un mes dado (key 'YYYY-MM') — para evolución y comparativa.
  const metricasMes = useMemo(
    () => (mesKey) => calcMetricas((iso) => mesDe(iso) === mesKey),
    [calcMetricas],
  );

  // Fechas de adjudicación por cliente (para clientes nuevos / recompra).
  const clienteAdjFechas = useMemo(() => {
    const m = {}; // clienteKey -> [dateISO...] (ascendente)
    lics.forEach((l) => {
      if (!pasaTipo(l)) return;
      const f = toDateISO(adjDateByLic[l.id]);
      if (!f) return;
      const c = (l.rut_entidad || l.nombre_entidad || "").trim().toLowerCase();
      if (!c) return;
      (m[c] = m[c] || []).push(f);
    });
    Object.values(m).forEach((arr) => arr.sort());
    return m;
  }, [lics, adjDateByLic, filtroTipo]);

  // Nuevos / recompra para un predicado de periodo e inicio de periodo (ISO).
  function calcNuevosRecompra(pred, inicioISO) {
    let nuevos = 0, repiten = 0, totalConCompra = 0;
    Object.values(clienteAdjFechas).forEach((fechas) => {
      if (!fechas.some((f) => pred(f))) return;
      totalConCompra++;
      const primera = fechas[0]; // ya ordenadas ascendente
      if (pred(primera)) nuevos++;
      if (inicioISO && fechas.some((f) => f < inicioISO)) repiten++;
    });
    const recompra = totalConCompra > 0 ? (repiten / totalConCompra) * 100 : 0;
    return { nuevos, recompra };
  }

  const m = useMemo(() => calcMetricas(enPeriodo), [calcMetricas, enPeriodo]);
  const mPrev = useMemo(() => metricasMes(mesPrev), [metricasMes, mesPrev]);
  const cnr = useMemo(() => calcNuevosRecompra(enPeriodo, periodoInicio), [clienteAdjFechas, enPeriodo, periodoInicio]); // eslint-disable-line
  const cnrPrev = useMemo(() => calcNuevosRecompra((iso) => mesDe(iso) === mesPrev, `${mesPrev}-01`), [clienteAdjFechas, mesPrev]); // eslint-disable-line

  /* Detalle de las adjudicadas del período (pedido 2026-08-27): las mismas
     filas que suman en los KPIs «Adjudicados» y «Cotizaciones adjudicadas»
     (fecha de adjudicación dentro del período + filtro de tipo), con la venta
     y el adjudicado de cada una. Se abre con clic en cualquiera de esos KPIs. */
  const adjudicadasDetalle = useMemo(() => {
    return lics
      .filter((l) => pasaTipo(l) && enPeriodo(adjDateByLic[l.id]))
      .map((l) => ({
        licId: Number(l.id),
        codigo: l.id_licitacion || `#${l.id}`,
        cliente: l.nombre_entidad || l.rut_entidad || "—",
        vendedor:
          nombresVendedores[(l.creado_por || "").trim().toLowerCase()] ||
          (l.creado_por || "").split("@")[0] || "—",
        tipo: esParticular(l) ? "Particular" : "Pública",
        fecha: adjDateByLic[l.id] || null,
        ventas: ventaDeLic(l),
        adjudicado: adjudicadoDeLic(l),
      }))
      .sort((a, b) => String(b.fecha || "").localeCompare(String(a.fecha || "")));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lics, adjDateByLic, docSums, enPeriodo, filtroTipo, nombresVendedores]);

  /* Avance de metas por ingreso de guía de despacho (pedido 2026-09-03):
     los documentos que consumen la meta — guías de despacho (públicas) y
     boletas/facturas/efectivo (particulares) — de cotizaciones adjudicadas
     dentro del período. Es el MISMO criterio del módulo Definición de metas,
     así el % de cumplimiento del panel cuadra con esa página. */
  const avanceMeta = useMemo(() => {
    const licById = new Map(lics.map((l) => [Number(l.id), l]));
    const TIPO_LABEL = {
      guia_despacho: "Guía de despacho",
      factura: "Factura / Boleta",
      factura_boleta: "Factura / Boleta",
      efectivo: "Efectivo",
    };
    const filas = [];
    let total = 0;
    docsConsumo.forEach((d) => {
      const l = licById.get(d.licId);
      if (!l || !pasaTipo(l)) return;
      if (!enPeriodo(adjDateByLic[d.licId])) return;
      // Mismo criterio que ventaDeLic: en públicas cuentan las guías; en
      // particulares las boletas/facturas y el efectivo.
      const cuenta = esParticular(l)
        ? (d.tipo === "factura" || d.tipo === "factura_boleta" || d.tipo === "efectivo")
        : d.tipo === "guia_despacho";
      if (!cuenta) return;
      const email = (l.creado_por || "").trim().toLowerCase();
      // Solo equipo de ventas: lo creado por perfiles admin no mide meta.
      if (!esRolVenta(rolesVendedores[email])) return;
      total += d.monto;
      filas.push({
        licId: d.licId,
        codigo: l.id_licitacion || `#${d.licId}`,
        cliente: l.nombre_entidad || l.rut_entidad || "—",
        email,
        vendedor: nombresVendedores[email] || email.split("@")[0] || "—",
        tipoLabel: TIPO_LABEL[d.tipo] || d.tipo,
        numero: d.numero,
        monto: d.monto,
        fecha: d.fecha,
      });
    });
    filas.sort((a, b) => String(b.fecha || "").localeCompare(String(a.fecha || "")));
    return { filas, total };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docsConsumo, lics, adjDateByLic, enPeriodo, filtroTipo, nombresVendedores, rolesVendedores]);

  // Meta del equipo de ventas (excluye metas asignadas a perfiles admin).
  const metaMonto = useMemo(
    () => Object.entries(metasPorVendedor).reduce(
      (s, [email, meta]) => (esRolVenta(rolesVendedores[email]) ? s + Number(meta || 0) : s),
      0,
    ),
    [metasPorVendedor, rolesVendedores],
  );

  /* Avance de metas POR EJECUTIVO: cruza la meta de cada vendedor
     (/metas/mensuales) con sus guías/boletas del período. Entran los que
     tienen meta definida o avance; ordenados por cumplimiento. */
  const avancePorVendedor = useMemo(() => {
    const avancePorEmail = {};
    avanceMeta.filas.forEach((f) => {
      if (!f.email) return;
      avancePorEmail[f.email] = (avancePorEmail[f.email] || 0) + Number(f.monto || 0);
    });
    const emails = new Set([...Object.keys(metasPorVendedor), ...Object.keys(avancePorEmail)]);
    return [...emails]
      // Solo el equipo de ventas: los perfiles admin con meta asignada no se
      // muestran (tampoco suman a la meta global, ver metaMonto).
      .filter((email) => esRolVenta(rolesVendedores[email]))
      .map((email) => {
        const meta = Number(metasPorVendedor[email] || 0);
        const avance = Number(avancePorEmail[email] || 0);
        return {
          email,
          nombre: nombresVendedores[email] || nombreDesdeEmail(email),
          meta,
          avance,
          brecha: Math.max(0, meta - avance),
          pct: meta > 0 ? (avance / meta) * 100 : null,
        };
      })
      .filter((r) => r.meta > 0 || r.avance > 0)
      .sort((a, b) =>
        (b.pct ?? -1) - (a.pct ?? -1) ||
        b.avance - a.avance ||
        a.nombre.localeCompare(b.nombre),
      );
  }, [avanceMeta, metasPorVendedor, nombresVendedores, rolesVendedores]);

  // Evolución 6 meses (ventas con IVA).
  const evolucion = useMemo(() => {
    const arr = [];
    for (let i = 5; i >= 0; i--) {
      const k = addMesKey(mesActual, -i);
      arr.push({ mes: k, label: labelMesCorto(k), ventas: metricasMes(k).ventas });
    }
    return arr;
  }, [metricasMes, mesActual]);

  // Top 5 clientes por venta del periodo.
  const topClientes = useMemo(() => {
    const map = {};
    lics.forEach((l) => {
      if (!pasaTipo(l)) return;
      if (!enPeriodo(adjDateByLic[l.id])) return;
      const nombre = (l.nombre_entidad || l.rut_entidad || "—").trim();
      map[nombre] = (map[nombre] || 0) + netoDeLic(l);
    });
    return Object.entries(map).map(([nombre, monto]) => ({ nombre, monto }))
      .sort((a, b) => b.monto - a.monto).slice(0, 5);
  }, [lics, adjDateByLic, docSums, enPeriodo, filtroTipo]);

  /* Detalle del KPI «Ventas Totales» (pedido 2026-09-04): los mismos
     documentos que suman en m.ventas — guías (públicas) y boletas/facturas/
     efectivo (particulares) de cotizaciones adjudicadas en el período. A
     diferencia del avance de metas, aquí NO se filtra por rol: es la venta
     de la empresa, no la medición del equipo. */
  const ventasDetalle = useMemo(() => {
    const licById = new Map(lics.map((l) => [Number(l.id), l]));
    const TIPO_LABEL = {
      guia_despacho: "Guía de despacho",
      factura: "Factura / Boleta",
      factura_boleta: "Factura / Boleta",
      efectivo: "Efectivo",
    };
    const filas = [];
    docsConsumo.forEach((d) => {
      const l = licById.get(d.licId);
      if (!l || !pasaTipo(l)) return;
      if (!enPeriodo(adjDateByLic[d.licId])) return;
      const cuenta = esParticular(l)
        ? (d.tipo === "factura" || d.tipo === "factura_boleta" || d.tipo === "efectivo")
        : d.tipo === "guia_despacho";
      if (!cuenta) return;
      const email = (l.creado_por || "").trim().toLowerCase();
      filas.push({
        licId: d.licId,
        codigo: l.id_licitacion || `#${d.licId}`,
        cliente: l.nombre_entidad || l.rut_entidad || "—",
        vendedor: nombresVendedores[email] || email.split("@")[0] || "—",
        tipoLabel: TIPO_LABEL[d.tipo] || d.tipo,
        numero: d.numero,
        monto: d.monto,
        fecha: d.fecha,
      });
    });
    filas.sort((a, b) => String(b.fecha || "").localeCompare(String(a.fecha || "")));
    return filas;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docsConsumo, lics, adjDateByLic, enPeriodo, filtroTipo, nombresVendedores]);

  /* OC con saldo por consumir (pedido 2026-09-04): monto de las órdenes de
     compra de cada cotización menos lo ya despachado/facturado. SIN filtro
     de fecha del panel (a propósito): muestra todo lo vigente, de cualquier
     mes. Quedan fuera las cotizaciones con cierre forzado. */
  const ocsConSaldo = useMemo(() => {
    const filas = [];
    lics.forEach((l) => {
      if (!pasaTipo(l)) return;
      const lid = Number(l.id);
      if (cerradasForzadas.has(lid)) return;
      const ds = docSums[lid] || {};
      const oc = Number(ds.oc || 0);
      if (oc <= 0) return;
      const consumido = esParticular(l) ? Number(ds.factbol || 0) : Number(ds.guia || 0);
      const saldo = oc - consumido;
      if (saldo <= 0.5) return; // consumida completa
      const email = (l.creado_por || "").trim().toLowerCase();
      const ocsDeLic = docsOC.filter((d) => d.licId === lid);
      filas.push({
        licId: lid,
        codigo: l.id_licitacion || `#${lid}`,
        cliente: l.nombre_entidad || l.rut_entidad || "—",
        vendedor: nombresVendedores[email] || email.split("@")[0] || "—",
        numeroOC: ocsDeLic.map((d) => d.numero).filter(Boolean).join(", ") || "—",
        fechaOC: ocsDeLic.reduce((min, d) => (d.fecha && (!min || d.fecha < min) ? d.fecha : min), null),
        oc,
        consumido,
        saldo,
        pct: (consumido / oc) * 100,
      });
    });
    filas.sort((a, b) => b.saldo - a.saldo);
    return { filas, totalSaldo: filas.reduce((s, f) => s + f.saldo, 0) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lics, docSums, docsOC, cerradasForzadas, filtroTipo, nombresVendedores]);

  async function exportarOcsSaldo() {
    try {
      const XLSX = await import("xlsx");
      const ws = XLSX.utils.json_to_sheet(ocsConSaldo.filas.map((f) => ({
        "Cotización": f.codigo,
        "Cliente": f.cliente,
        "Vendedor": f.vendedor,
        "N° OC": f.numeroOC,
        "Fecha OC": f.fechaOC || "",
        "Monto OC (neto)": f.oc,
        "Consumido": f.consumido,
        "Saldo por consumir": f.saldo,
        "% consumido": Math.round(f.pct),
      })));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "OC con saldo");
      XLSX.writeFile(wb, `oc_saldo_por_consumir_${new Date().toISOString().slice(0, 10)}.xlsx`);
    } catch { /* sin librería no hay export */ }
  }

  // Facturación registrada en el sistema (facturas + boletas por fecha del
  // documento) — la contraparte interna del comparativo con Bsale.
  const facturadoSistema = useMemo(() => {
    let t = 0;
    docsConsumo.forEach((d) => {
      if (d.tipo !== "factura" && d.tipo !== "factura_boleta") return;
      if (!enPeriodo(d.fecha)) return;
      t += Number(d.monto || 0);
    });
    return t;
  }, [docsConsumo, enPeriodo]);

  /* Comparativo con Bsale (pedido 2026-09-04): venta total emitida en Bsale
     (facturas + boletas netas, menos notas de crédito) en el mismo período.
     El endpoint /bsale es solo admin: si no hay acceso o falta el token, la
     sección simplemente no se muestra. */
  useEffect(() => {
    if (cargando || !puedeVer) return;
    let activo = true;
    const iso = (dt) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
    const [y, mm] = mesActual.split("-").map(Number);
    const desde = rangoActivo ? (rangoDesde || `${mesActual}-01`) : `${mesActual}-01`;
    const hasta = rangoActivo ? (rangoHasta || iso(new Date())) : iso(new Date(y, mm, 0));
    setBsaleVentas(null);
    api.get(`/bsale/ventas?desde=${desde}&hasta=${hasta}`)
      .then((r) => { if (activo && r && r.disponible !== false) setBsaleVentas(r); })
      .catch(() => {});
    return () => { activo = false; };
  }, [cargando, puedeVer, rangoActivo, rangoDesde, rangoHasta, mesActual]);

  if (!cargando && !puedeVer) {
    return (
      <div className="page">
        <div className="surface"><div className="surface-body" style={{ color: "var(--danger)" }}>
          Acceso restringido: el panel de indicadores es para administración y jefatura de ventas.
        </div></div>
      </div>
    );
  }

  // Cumplimiento medido por el AVANCE REAL (guías de despacho + boletas), el
  // mismo criterio del módulo Definición de metas — no por el total cotizado.
  const cumplimientoMonto = metaMonto > 0 ? (avanceMeta.total / metaMonto) * 100 : null;
  const cumplimientoCot = metaCotizaciones > 0 ? (m.cotizaciones / metaCotizaciones) * 100 : null;
  const cumplimiento = cumplimientoMonto != null ? cumplimientoMonto : cumplimientoCot;
  const brechaMeta = Math.max(0, metaMonto - avanceMeta.total);

  const mostrarDelta = !rangoActivo; // la comparativa vs mes anterior no aplica con rango
  const periodoLabel = rangoActivo ? "Rango" : "Mes";
  const subVentas =
    filtroTipo === "publica" ? `${periodoLabel} · guías de despacho`
    : filtroTipo === "particular" ? `${periodoLabel} · boletas/facturas`
    : `${periodoLabel} · guías (púb.) + boletas (part.)`;
  const subAdjudicado =
    filtroTipo === "publica" ? `${periodoLabel} · órdenes de compra`
    : filtroTipo === "particular" ? `${periodoLabel} · boletas/facturas`
    : `${periodoLabel} · OC (púb.) + boletas (part.)`;

  // Descarga del detalle COMPLETO de ventas por categoría y producto (Excel / CSV)
  // con monto y porcentajes (sobre el total y sobre su categoría).
  async function descargarTopVentas(formato = "xlsx") {
    if (!catData.length) return;
    const totalGeneral = catData.reduce((acc, c) => acc + Number(c.monto || 0), 0);
    const pct = (parte, todo) => (todo > 0 ? Number(((parte / todo) * 100).toFixed(1)) : 0);
    const filas = [];
    catData.forEach((c) => {
      filas.push({
        "Tipo": "Categoría",
        "Categoría": c.categoria,
        "Producto": "",
        "Monto": Math.round(c.monto),
        "% del total": pct(c.monto, totalGeneral),
        "% de la categoría": "",
      });
      (c.productos || []).forEach((p) => {
        filas.push({
          "Tipo": "Producto",
          "Categoría": c.categoria,
          "Producto": p.producto,
          "Monto": Math.round(p.monto),
          "% del total": pct(p.monto, totalGeneral),
          "% de la categoría": pct(p.monto, c.monto),
        });
      });
    });
    // Fila de total general al final.
    filas.push({ "Tipo": "TOTAL", "Categoría": "", "Producto": "", "Monto": Math.round(totalGeneral), "% del total": 100, "% de la categoría": "" });
    const periodoTxt = rangoActivo ? `${rangoDesde || "inicio"}_a_${rangoHasta || "hoy"}` : mesActual;
    const nombre = `ventas_categoria_producto_${periodoTxt}`;
    try {
      const XLSX = await import("xlsx");
      const ws = XLSX.utils.json_to_sheet(filas);
      if (formato === "csv") {
        const csv = XLSX.utils.sheet_to_csv(ws, { FS: ";" });
        const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = `${nombre}.csv`;
        document.body.appendChild(link); link.click(); link.remove();
        URL.revokeObjectURL(link.href);
      } else {
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Top ventas");
        XLSX.writeFile(wb, `${nombre}.xlsx`);
      }
    } catch (e) {
      console.error("Error exportando top ventas:", e);
    }
  }

  const maxEvol = Math.max(1, ...evolucion.map((e) => e.ventas));
  const totalCat = catData.reduce((acc, c) => acc + c.monto, 0);
  const maxTop = Math.max(1, ...topClientes.map((c) => c.monto));

  // Desglose del margen: por cotización, por vendedor y por tipo de cotización.
  const margenDesglose = useMemo(() => {
    const licById = new Map(lics.map((l) => [Number(l.id), l]));
    const filas = margenPorLic.map((r) => {
      const l = licById.get(r.licId) || {};
      const email = (l.creado_por || "").trim().toLowerCase();
      const monto = r.venta - r.costo;
      return {
        licId: r.licId,
        codigo: l.id_licitacion || `Cot. ${r.licId}`,
        cliente: l.nombre_entidad || l.rut_entidad || "—",
        vendedor: nombresVendedores[email] || email || "Sin vendedor",
        tipo: l.tipo_compra || (esParticular(l) ? "Cliente particular" : "Sin tipo"),
        venta: r.venta,
        costo: r.costo,
        monto,
        pct: r.venta > 0 ? (monto / r.venta) * 100 : 0,
        // Sin costo en ningún ítem (ni guardado ni en catálogo por SKU): el
        // "100%" no es margen real, es un dato faltante que hay que sanear.
        sinCosto: r.venta > 0 && !(r.costo > 0),
      };
    }).sort((a, b) => b.venta - a.venta);
    const agrupar = (key) => {
      const m = {};
      filas.forEach((f) => {
        const k = f[key] || "—";
        const e = (m[k] = m[k] || { label: k, venta: 0, costo: 0, cotizaciones: 0 });
        e.venta += f.venta;
        e.costo += f.costo;
        e.cotizaciones += 1;
      });
      return Object.values(m)
        .map((e) => ({ ...e, monto: e.venta - e.costo, pct: e.venta > 0 ? ((e.venta - e.costo) / e.venta) * 100 : 0 }))
        .sort((a, b) => b.venta - a.venta);
    };
    return { filas, porVendedor: agrupar("vendedor"), porTipo: agrupar("tipo") };
  }, [margenPorLic, lics, nombresVendedores]);

  // Exporta el desglose del margen a Excel — una hoja por vista (cotización /
  // vendedor / tipo), para análisis posterior fuera del sistema (2026-08-13).
  async function exportarMargen() {
    const periodoTxt = rangoActivo ? `${rangoDesde || "inicio"}_a_${rangoHasta || "hoy"}` : mesActual;
    try {
      const XLSX = await import("xlsx");
      const wb = XLSX.utils.book_new();
      const filas = margenDesglose.filas.map((f) => ({
        "Cotización": f.codigo,
        "Cliente": f.cliente,
        "Vendedor": f.vendedor,
        "Tipo": f.tipo,
        "Venta neta": Math.round(f.venta),
        "Costo": Math.round(f.costo),
        "Margen $": Math.round(f.monto),
        "Margen %": Number(f.pct.toFixed(2)),
        "Sin costo": f.sinCosto ? "Sí" : "",
      }));
      const tVenta = margenDesglose.filas.reduce((s, f) => s + f.venta, 0);
      const tCosto = margenDesglose.filas.reduce((s, f) => s + f.costo, 0);
      filas.push({
        "Cotización": "TOTAL", "Cliente": "", "Vendedor": "", "Tipo": "",
        "Venta neta": Math.round(tVenta),
        "Costo": Math.round(tCosto),
        "Margen $": Math.round(tVenta - tCosto),
        "Margen %": tVenta > 0 ? Number((((tVenta - tCosto) / tVenta) * 100).toFixed(2)) : 0,
      });
      const agrupada = (arr, etiqueta) => arr.map((e) => ({
        [etiqueta]: e.label,
        "Cotizaciones": e.cotizaciones,
        "Venta neta": Math.round(e.venta),
        "Costo": Math.round(e.costo),
        "Margen $": Math.round(e.monto),
        "Margen %": Number(e.pct.toFixed(2)),
      }));
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(filas), "Por cotizacion");
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(agrupada(margenDesglose.porVendedor, "Vendedor")), "Por vendedor");
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(agrupada(margenDesglose.porTipo, "Tipo")), "Por tipo");
      XLSX.writeFile(wb, `margenes_${periodoTxt}.xlsx`);
    } catch (e) {
      console.error("Error exportando márgenes:", e);
    }
  }

  // Postulaciones del listado: tomadas / no aplica / vencidas (sin cargar).
  const disponiblesStats = useMemo(() => {
    const fechaCierre = (row) => {
      const raw = row?.datos?.cierre;
      if (!raw) return null;
      const s = String(raw).trim();
      // "DD-MM-YYYY[ HH:mm]" o "DD-MM-YY HH:mm" (año de 2 dígitos).
      const m2 = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4}|\d{2})(?:[ T](\d{1,2}):(\d{2}))?/);
      if (m2) {
        const anio = m2[3].length === 2 ? 2000 + Number(m2[3]) : Number(m2[3]);
        const hh = m2[4] != null ? Number(m2[4]) : 23;
        const mi = m2[5] != null ? Number(m2[5]) : 59;
        return new Date(anio, Number(m2[2]) - 1, Number(m2[1]), hh, mi);
      }
      const d = new Date(s);
      return Number.isNaN(d.getTime()) ? null : d;
    };
    const ahora = new Date();
    let tomadas = 0, noAplica = 0, vencidas = 0;
    disponibles.forEach((r) => {
      if (r.tomada_por) tomadas++;
      if (r.no_aplica) { noAplica++; return; }
      const fc = fechaCierre(r);
      if (fc && fc < ahora && !r.cargada) vencidas++;
    });
    return { tomadas, noAplica, vencidas, total: disponibles.length };
  }, [disponibles]);

  return (
    <div className="page">
      <div className="page-header" style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div>
          <h1 className="page-title">Panel de Indicadores — Gestión Comercial</h1>
          <p className="page-subtitle">Mide · Analiza · Mejora · Crece</p>
        </div>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <div className="field" style={{ margin: 0 }}>
            <label className="field-label">Tipo de cliente</label>
            <select className="input" value={filtroTipo} onChange={(e) => setFiltroTipo(e.target.value)} style={{ minWidth: 180 }}>
              <option value="">Todos</option>
              <option value="publica">Entidad Pública</option>
              <option value="particular">Cliente Particular</option>
            </select>
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label className="field-label">Mes</label>
            <MonthCalendarPicker value={periodo} onChange={setPeriodo} />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label className="field-label">Desde (rango)</label>
            <DateFilter
              value={rangoDesde}
              onChange={setRangoDesde}
              placeholder="Opcional"
              maxDate={rangoHasta ? new Date(`${rangoHasta}T00:00:00`) : undefined}
            />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label className="field-label">Hasta (rango)</label>
            <DateFilter
              value={rangoHasta}
              onChange={setRangoHasta}
              placeholder="Opcional"
              minDate={rangoDesde ? new Date(`${rangoDesde}T00:00:00`) : undefined}
            />
          </div>
        </div>
      </div>

      {rangoActivo && (
        <div className="surface" style={{ marginBottom: 14, padding: "10px 16px", background: "#eff6ff", border: "1px solid #bfdbfe", color: "#1e40af", fontSize: 13, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <span>
            Rango activo: <strong>{rangoDesde || "inicio"}</strong> → <strong>{rangoHasta || "hoy"}</strong>. Las tarjetas, tablas y el embudo reflejan el rango; la evolución de 6 meses sigue usando el mes seleccionado.
          </span>
          <button className="btn btn-secondary btn-sm" onClick={() => { setRangoDesde(""); setRangoHasta(""); }}>
            Limpiar rango
          </button>
        </div>
      )}

      {loading ? (
        <div className="surface" style={{ padding: "40px 24px", color: "var(--text-muted)" }}>Cargando indicadores…</div>
      ) : (
        <>
          {/* KPIs */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 14, marginBottom: 22 }}>
            <div onClick={() => setVentasOpen(true)} style={{ cursor: "pointer" }} title="Ver los documentos que componen la venta del período">
              <KpiCard icon={ShoppingCart} color="#0e7490" label="Ventas Totales" sub={subVentas} value={fmtCLP(m.ventas)} delta={mostrarDelta ? <Delta actual={m.ventas} prev={mPrev.ventas} /> : null} />
            </div>
            <div onClick={() => setAdjOpen(true)} style={{ cursor: "pointer" }} title="Ver el detalle de las adjudicadas del período">
              <KpiCard icon={Banknote} color="#15803d" label="Adjudicados" sub={subAdjudicado} value={fmtCLP(m.adjudicadoMonto)} delta={mostrarDelta ? <Delta actual={m.adjudicadoMonto} prev={mPrev.adjudicadoMonto} /> : null} />
            </div>
            <KpiCard icon={Target} color="#16a34a" label="Conversión" sub="Adjudicadas / cotizaciones" value={fmtPct(m.conversion)} delta={mostrarDelta ? <Delta actual={m.conversion} prev={mPrev.conversion} unidadPp /> : null} />
            <KpiCard icon={FileText} color="#6366f1" label="Cotizaciones" sub={`Creadas en el ${periodoLabel.toLowerCase()}`} value={fmtNum(m.cotizaciones)} delta={mostrarDelta ? <Delta actual={m.cotizaciones} prev={mPrev.cotizaciones} /> : null} />
            <KpiCard icon={UserPlus} color="#d97706" label="Clientes Nuevos" sub={`Primera compra el ${periodoLabel.toLowerCase()}`} value={fmtNum(cnr.nuevos)} delta={mostrarDelta ? <Delta actual={cnr.nuevos} prev={cnrPrev.nuevos} /> : null} />
            <KpiCard icon={RefreshCw} color="#0ea5e9" label="Recompra" sub="Clientes que repiten" value={fmtPct(cnr.recompra)} delta={mostrarDelta ? <Delta actual={cnr.recompra} prev={cnrPrev.recompra} unidadPp /> : null} />
            <div onClick={() => setAdjOpen(true)} style={{ cursor: "pointer" }} title="Ver el detalle de las adjudicadas del período">
              <KpiCard icon={Award} color="#b45309" label="Cotizaciones adjudicadas" sub={`Cierres del ${periodoLabel.toLowerCase()} · clic para detalle`} value={fmtNum(m.adjudicadas)} delta={mostrarDelta ? <Delta actual={m.adjudicadas} prev={mPrev.adjudicadas} /> : null} />
            </div>
            <div onClick={() => setMargenOpen(true)} style={{ cursor: "pointer" }} title="Ver desglose del margen por cotización, vendedor y tipo">
              <KpiCard icon={TrendingUp} color="#7c3aed" label="Margen %" sub="(venta − costo) / venta · clic para desglose" value={fmtPct(margenMes.pct)} />
            </div>
            {!esJefatura && (
              <div onClick={() => setMargenOpen(true)} style={{ cursor: "pointer" }} title="Ver desglose del margen por cotización, vendedor y tipo">
                <KpiCard icon={Banknote} color="#0d9488" label="Margen $" sub="Venta neta − costo · clic para desglose" value={fmtCLP(margenMes.monto)} />
              </div>
            )}
          </div>

          {/* ── Avance de Metas — primero tras los KPIs (pedido 2026-09-04)
              Global + tarjeta por ejecutivo. Medido por guías de despacho
              (públicas) y boletas/facturas (particulares), el mismo criterio
              del módulo Definición de metas. */}
          <div className="surface" style={{ marginBottom: 16 }}>
            <div className="surface-header" style={{ flexWrap: "wrap", gap: 12 }}>
              <div>
                <h3 className="surface-title" style={{ margin: 0 }}>Avance de Metas</h3>
                <p style={{ fontSize: 12, color: "var(--text-muted)", margin: 0 }}>
                  Guías de despacho (públicas) y boletas/facturas (particulares) del {periodoLabel.toLowerCase()}
                  {filtroTipo ? " · la meta es la global del equipo (no se filtra por tipo)" : ""}
                </p>
              </div>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => setAvanceMetaOpen({ email: null, nombre: "equipo" })}
                title="Ver todas las guías y documentos que componen el avance"
                style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
              >
                Ver detalle del equipo
              </button>
            </div>

            <div style={{ padding: "18px 24px" }}>
              {/* Resumen global */}
              <div
                onClick={() => setAvanceMetaOpen({ email: null, nombre: "equipo" })}
                style={{
                  cursor: "pointer",
                  border: "1px solid var(--border)",
                  borderTop: "3px solid var(--primary)",
                  borderRadius: "var(--radius-lg)",
                  padding: "16px 20px",
                  background: "var(--surface)",
                }}
                title="Ver todas las guías y documentos que componen el avance"
              >
                <div style={{ display: "flex", gap: "28px 40px", flexWrap: "wrap" }}>
                  {[
                    { label: "Avance del equipo", valor: fmtCLP(avanceMeta.total), color: "#15803d" },
                    { label: "Meta del mes", valor: metaMonto > 0 ? fmtCLP(metaMonto) : "Sin definir", color: "var(--text)" },
                    { label: "Brecha", valor: metaMonto > 0 ? fmtCLP(brechaMeta) : "—", color: "#b45309" },
                    {
                      label: "Cumplimiento",
                      valor: cumplimientoMonto == null ? "—" : fmtPct(cumplimientoMonto),
                      color: cumplimientoMonto == null ? "var(--text-muted)" : cumplimientoMonto >= 100 ? "#15803d" : cumplimientoMonto >= 70 ? "#0d9488" : "#b45309",
                    },
                  ].map((s) => (
                    <div key={s.label}>
                      <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".08em", color: "var(--text-muted)", fontWeight: 700 }}>{s.label}</div>
                      <div style={{ fontSize: 22, fontWeight: 800, color: s.color, marginTop: 4, lineHeight: 1.15 }}>{s.valor}</div>
                    </div>
                  ))}
                </div>
                {metaMonto > 0 && (
                  <div style={{ height: 10, borderRadius: 5, background: "var(--bg)", border: "1px solid var(--border)", overflow: "hidden", marginTop: 14 }}>
                    <div style={{ height: "100%", borderRadius: 5, width: `${clamp(cumplimientoMonto || 0, (avanceMeta.total > 0 ? 2 : 0), 100)}%`, background: (cumplimientoMonto || 0) >= 100 ? "#16a34a" : "linear-gradient(90deg, var(--primary), #14b8a6)" }} />
                  </div>
                )}
              </div>

              {/* Tarjetas por ejecutivo */}
              {avancePorVendedor.length > 0 && (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))", gap: 12, marginTop: 16 }}>
                  {avancePorVendedor.map((v) => {
                    const pct = v.pct ?? 0;
                    const color = v.pct == null ? "#64748b" : pct >= 100 ? "#15803d" : pct >= 70 ? "#0d9488" : pct >= 40 ? "#b45309" : "#dc2626";
                    return (
                      <div
                        key={v.email}
                        onClick={() => setAvanceMetaOpen({ email: v.email, nombre: v.nombre })}
                        title={`Ver las guías y documentos de ${v.nombre}`}
                        style={{
                          cursor: "pointer",
                          border: "1px solid var(--border)",
                          borderRadius: "var(--radius-lg)",
                          padding: "14px 16px",
                          background: "var(--surface)",
                          boxShadow: "0 1px 2px rgba(15,23,42,.05)",
                          transition: "box-shadow .15s ease, transform .15s ease",
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.boxShadow = "0 6px 16px rgba(15,23,42,.10)"; e.currentTarget.style.transform = "translateY(-1px)"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.boxShadow = "0 1px 2px rgba(15,23,42,.05)"; e.currentTarget.style.transform = "none"; }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <div style={{
                            width: 38, height: 38, borderRadius: "50%", flexShrink: 0,
                            background: avatarFondo(v.email), color: "#fff",
                            display: "grid", placeItems: "center", fontSize: 13, fontWeight: 700, letterSpacing: ".02em",
                          }}>
                            {iniciales(v.nombre)}
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 13.5, fontWeight: 700, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={v.nombre}>
                              {v.nombre}
                            </div>
                            <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 1 }}>
                              Meta {v.meta > 0 ? fmtCLP(v.meta) : "sin definir"}
                            </div>
                          </div>
                          <span style={{
                            display: "inline-flex", alignItems: "center", padding: "2px 10px",
                            borderRadius: 999, fontSize: 12, fontWeight: 700, whiteSpace: "nowrap",
                            color, border: `1px solid ${color}40`, background: `${color}12`,
                          }}>
                            {v.pct == null ? "s/m" : fmtPct(v.pct)}
                          </span>
                        </div>
                        <div style={{ height: 8, borderRadius: 4, background: "var(--bg)", border: "1px solid var(--border)", overflow: "hidden", marginTop: 12 }}>
                          <div style={{ height: "100%", borderRadius: 4, width: `${clamp(pct, v.avance > 0 ? 3 : 0, 100)}%`, background: v.pct == null ? "#94a3b8" : pct >= 100 ? "#16a34a" : "linear-gradient(90deg, var(--primary), #14b8a6)" }} />
                        </div>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 11.5, marginTop: 7 }}>
                          <span style={{ fontWeight: 700, color: "#15803d" }}>{fmtCLP(v.avance)}</span>
                          <span style={{ color: "var(--text-muted)" }}>
                            {v.meta > 0 ? (v.brecha > 0 ? `faltan ${fmtCLP(v.brecha)}` : "meta cumplida ✓") : "sin meta asignada"}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              {avancePorVendedor.length === 0 && (
                <p style={{ fontSize: 12.5, color: "var(--text-muted)", marginTop: 14, marginBottom: 0 }}>
                  Sin metas definidas ni avance en el período. Define las metas en «Definición de metas».
                </p>
              )}
            </div>
          </div>

          {/* Charts row 1 */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 16, marginBottom: 16 }}>
            {/* Evolución */}
            <div className="surface" style={{ padding: 18 }}>
              <h3 className="surface-title" style={{ marginBottom: 14 }}>Evolución de ventas (6 meses)</h3>
              <LineChart data={evolucion} max={maxEvol} />
            </div>
            {/* Embudo comercial (clientes particulares) */}
            <EmbudoComercial periodo={periodo} />
            {/* Licitaciones del listado de postulaciones: tomadas / no aplica / vencidas */}
            <div className="surface" style={{ padding: 18 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 14, gap: 8 }}>
                <h3 className="surface-title" style={{ margin: 0 }}>Licitaciones disponibles</h3>
                <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{fmtNum(disponiblesStats.total)} en el listado</span>
              </div>
              {disponiblesStats.total === 0 ? (
                <p style={{ color: "var(--text-muted)", fontSize: 13 }}>Sin postulaciones en el listado.</p>
              ) : (
                <>
                  <div style={{ display: "flex", alignItems: "flex-end", gap: 18, height: 150, padding: "0 6px" }}>
                    {[
                      { label: "Tomadas", value: disponiblesStats.tomadas, color: "#16a34a" },
                      { label: "No aplica", value: disponiblesStats.noAplica, color: "#a16207" },
                      { label: "Vencidas", value: disponiblesStats.vencidas, color: "#dc2626" },
                    ].map((b) => {
                      const maxV = Math.max(1, disponiblesStats.tomadas, disponiblesStats.noAplica, disponiblesStats.vencidas);
                      const h = clamp((b.value / maxV) * 100, b.value > 0 ? 5 : 0, 100);
                      return (
                        <div key={b.label} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", height: "100%" }} title={`${b.label}: ${fmtNum(b.value)}`}>
                          <div style={{ fontSize: 13, fontWeight: 700, color: b.color, marginBottom: 4 }}>{fmtNum(b.value)}</div>
                          <div style={{ width: "58%", maxWidth: 52, height: `${h}%`, background: b.color, borderRadius: "6px 6px 0 0" }} />
                        </div>
                      );
                    })}
                  </div>
                  <div style={{ display: "flex", gap: 18, marginTop: 8, padding: "0 6px" }}>
                    {["Tomadas", "No aplica", "Vencidas"].map((t) => (
                      <span key={t} style={{ flex: 1, fontSize: 11, color: "var(--text-muted)", textAlign: "center" }}>{t}</span>
                    ))}
                  </div>
                  <p style={{ fontSize: 10.5, color: "var(--text-muted)", marginTop: 10, marginBottom: 0 }}>
                    "Vencidas" = postulaciones con fecha de cierre pasada que no se cargaron ni se marcaron como "No aplica".
                  </p>
                </>
              )}
            </div>
            {/* Ventas por categoría */}
            <div className="surface" style={{ padding: 18 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, gap: 8, flexWrap: "wrap" }}>
                <h3 className="surface-title" style={{ margin: 0, flex: "1 1 auto", minWidth: 160 }}>Ventas por categoría ({periodoLabel.toLowerCase()})</h3>
                {catData.length > 0 && (
                  <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    <button
                      type="button"
                      onClick={() => descargarTopVentas("xlsx")}
                      className="btn btn-ghost"
                      style={{ fontSize: 12, padding: "4px 10px", display: "inline-flex", alignItems: "center", gap: 4 }}
                      title="Descargar top de categorías y productos en Excel"
                    >
                      <Download size={13} /> Excel
                    </button>
                    <button
                      type="button"
                      onClick={() => descargarTopVentas("csv")}
                      className="btn btn-ghost"
                      style={{ fontSize: 12, padding: "4px 10px" }}
                      title="Descargar top de categorías y productos en CSV"
                    >
                      CSV
                    </button>
                    <button
                      type="button"
                      onClick={() => setMostrarProductos(true)}
                      className="btn btn-ghost"
                      style={{ fontSize: 12, padding: "4px 10px" }}
                      title="Ver productos por categoría"
                    >
                      Ver productos
                    </button>
                  </div>
                )}
              </div>
              {catData.length === 0 ? (
                <p style={{ color: "var(--text-muted)", fontSize: 13 }}>Sin ventas en el periodo.</p>
              ) : (
                <div
                  onClick={() => setMostrarProductos(true)}
                  style={{ cursor: "pointer" }}
                  title="Ver productos por categoría"
                >
                  <Donut data={catData} total={totalCat} />
                </div>
              )}
            </div>
            {/* Top clientes */}
            <div className="surface" style={{ padding: 18 }}>
              <h3 className="surface-title" style={{ marginBottom: 14 }}>Top 5 clientes por monto neto OC ({periodoLabel.toLowerCase()})</h3>
              {topClientes.length === 0 ? (
                <p style={{ color: "var(--text-muted)", fontSize: 13 }}>Sin ventas en el periodo.</p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {topClientes.map((c) => (
                    <div key={c.nombre}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 3, gap: 8 }}>
                        <span style={{ color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={c.nombre}>{c.nombre}</span>
                        <strong style={{ color: "var(--text)", whiteSpace: "nowrap" }}>{fmtCLP(c.monto)}</strong>
                      </div>
                      <div style={{ height: 10, borderRadius: 5, background: "var(--bg)", overflow: "hidden" }}>
                        <div style={{ height: "100%", width: `${clamp((c.monto / maxTop) * 100, 2, 100)}%`, background: "#28aeb1", borderRadius: 5 }} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Indicadores + resumen */}
          <div className="panel-grid-2-1">
            {/* Tabla indicadores */}
            <div className="surface">
              <div className="surface-header"><h3 className="surface-title">Indicadores detallados</h3></div>
              <div className="table-wrap" style={{ boxShadow: "none", border: "none" }}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Indicador</th>
                      <th style={{ textAlign: "right" }}>Mes actual</th>
                      <th style={{ textAlign: "right" }}>Meta</th>
                      <th style={{ textAlign: "right" }}>vs Meta</th>
                      <th style={{ textAlign: "right" }}>Tendencia</th>
                    </tr>
                  </thead>
                  <tbody>
                    <FilaInd nombre="Ventas (neto)" actual={fmtCLP(m.ventasNeto)} meta="—" cumpl={null} delta={<Delta actual={m.ventasNeto} prev={mPrev.ventasNeto} />} />
                    {/* La meta se mide contra las ventas por DOCUMENTOS (guías/boletas), igual que en Definición de metas. */}
                    <FilaInd nombre="Ventas (documentos)" actual={fmtCLP(m.ventas)} meta={metaMonto > 0 ? fmtCLP(metaMonto) : "—"} cumpl={metaMonto > 0 ? (m.ventas / metaMonto) * 100 : null} delta={<Delta actual={m.ventas} prev={mPrev.ventas} />} />
                    <FilaInd nombre="Adjudicado ($)" actual={fmtCLP(m.adjudicadoMonto)} meta="—" cumpl={null} delta={<Delta actual={m.adjudicadoMonto} prev={mPrev.adjudicadoMonto} />} />
                    <FilaInd nombre="N° Cotizaciones" actual={fmtNum(m.cotizaciones)} meta={metaCotizaciones > 0 ? fmtNum(metaCotizaciones) : "—"} cumpl={metaCotizaciones > 0 ? (m.cotizaciones / metaCotizaciones) * 100 : null} delta={<Delta actual={m.cotizaciones} prev={mPrev.cotizaciones} />} />
                    <FilaInd nombre="Conversión" actual={fmtPct(m.conversion)} meta="—" cumpl={null} delta={<Delta actual={m.conversion} prev={mPrev.conversion} unidadPp />} />
                    <FilaInd nombre="Ticket promedio" actual={fmtCLP(m.ticket)} meta="—" cumpl={null} delta={<Delta actual={m.ticket} prev={mPrev.ticket} />} />
                    <FilaInd nombre="% Recompra" actual={fmtPct(cnr.recompra)} meta="—" cumpl={null} delta={<Delta actual={cnr.recompra} prev={cnrPrev.recompra} unidadPp />} />
                    <FilaInd nombre="Cotizaciones adjudicadas" actual={fmtNum(m.adjudicadas)} meta="—" cumpl={null} delta={<Delta actual={m.adjudicadas} prev={mPrev.adjudicadas} />} />
                  </tbody>
                </table>
              </div>
            </div>

            {/* Resumen general */}
            <div className="surface" style={{ padding: 18, display: "flex", flexDirection: "column", gap: 14 }}>
              <h3 className="surface-title">Resumen general</h3>
              <div>
                <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".08em", color: "var(--text-muted)", fontWeight: 600 }}>Periodo</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text)" }}>
                  {new Date(`${periodo}T00:00:00`).toLocaleDateString("es-CL", { month: "long", year: "numeric" })}
                </div>
              </div>
              {cumplimiento != null ? (
                <div>
                  <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".08em", color: "var(--text-muted)", fontWeight: 600 }}>
                    Cumplimiento {cumplimientoMonto != null ? "(guías/boletas vs meta)" : "(cotizaciones vs meta)"}
                  </div>
                  <div style={{ fontSize: 30, fontWeight: 800, color: cumplimiento >= 100 ? "#15803d" : cumplimiento >= 70 ? "#0d9488" : "#b45309" }}>
                    {cumplimiento.toFixed(0)}%
                  </div>
                  <div style={{ height: 8, borderRadius: 4, background: "var(--bg)", overflow: "hidden", marginTop: 6 }}>
                    <div style={{ height: "100%", width: `${clamp(cumplimiento, 0, 100)}%`, background: cumplimiento >= 100 ? "#16a34a" : "var(--primary)", borderRadius: 4 }} />
                  </div>
                </div>
              ) : (
                <p style={{ fontSize: 12.5, color: "var(--text-muted)" }}>Define metas (módulo «Definición de Metas») para ver el cumplimiento.</p>
              )}
              <div style={{ borderTop: "1px solid var(--border)", paddingTop: 12 }}>
                <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".08em", color: "var(--text-muted)", fontWeight: 600, marginBottom: 6 }}>Embudo vs mes anterior</div>
                {[
                  { l: "Cotizaciones", a: m.cotizaciones, p: mPrev.cotizaciones },
                  { l: "Adjudicadas", a: m.adjudicadas, p: mPrev.adjudicadas },
                ].map((r) => (
                  <div key={r.l} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12.5, padding: "3px 0" }}>
                    <span style={{ color: "var(--text)" }}>{r.l}</span>
                    <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
                      <span style={{ color: "var(--text-muted)" }}>{fmtNum(r.p)}</span>
                      <span style={{ color: "var(--text-muted)" }}>→</span>
                      <strong style={{ color: "var(--text)" }}>{fmtNum(r.a)}</strong>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Resumen por región (al final del panel) */}
          <div className="surface" style={{ marginBottom: 16 }}>
            <div className="surface-header">
              <div>
                <h3 className="surface-title" style={{ margin: 0 }}>Resumen por Región</h3>
                <p style={{ fontSize: 12, color: "var(--text-muted)", margin: 0 }}>
                  Distribución territorial de cotizaciones y ventas del {periodoLabel.toLowerCase()}.
                </p>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <input
                  type="text"
                  className="input"
                  // Se encoge en vez de forzar 200px fijos junto al contador.
                  style={{ width: 200, maxWidth: "100%", minWidth: 0, flex: "1 1 140px" }}
                  value={filtroRegionPanel}
                  onChange={(e) => setFiltroRegionPanel(e.target.value)}
                  placeholder="Filtrar región…"
                />
                <span style={{ fontSize: 12, color: "var(--text-muted)", whiteSpace: "nowrap" }}>
                  {resumenRegionFiltrado.length} región(es)
                </span>
              </div>
            </div>
            <div className="table-wrap" style={{ boxShadow: "none", border: "none", borderRadius: 0 }}>
              <div className="table-scroll" style={{ maxHeight: 380 }}>
                <table className="data-table" style={{ width: "100%" }}>
                  <thead>
                    <tr>
                      <th>Región</th>
                      <th style={{ textAlign: "right" }}>Cotizaciones</th>
                      <th style={{ textAlign: "right" }}>Adjudicadas</th>
                      <th style={{ textAlign: "right" }}>Ventas</th>
                      <th style={{ textAlign: "right" }}>Adjudicado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {resumenRegionFiltrado.map((r) => (
                      <tr key={r.region}>
                        <td style={{ fontWeight: 600 }}>{r.region}</td>
                        <td style={{ textAlign: "right" }}>{r.cotizaciones}</td>
                        <td style={{ textAlign: "right", fontWeight: 600, color: "#15803d" }}>{r.adjudicadas}</td>
                        <td style={{ textAlign: "right" }}>{fmtCLP(r.ventas)}</td>
                        <td style={{ textAlign: "right", fontWeight: 600, color: "var(--primary-dark)" }}>{fmtCLP(r.adjudicado)}</td>
                      </tr>
                    ))}
                    {resumenRegionFiltrado.length === 0 && (
                      <tr>
                        <td colSpan={5} style={{ textAlign: "center", padding: "32px 0", color: "var(--text-muted)" }}>
                          Sin datos por región en el periodo.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* ── Comparativo de facturación con Bsale (solo admin: si el
              endpoint no responde — sin token, sin permiso — no se pinta) */}
          {bsaleVentas && (
            <div className="surface" style={{ marginBottom: 16 }}>
              <div className="surface-header" style={{ flexWrap: "wrap", gap: 12 }}>
                <div>
                  <h3 className="surface-title" style={{ margin: 0 }}>Comparativo de facturación · Bsale vs sistema</h3>
                  <p style={{ fontSize: 12, color: "var(--text-muted)", margin: 0 }}>
                    Neto emitido en Bsale (facturas + boletas − notas de crédito) contra las facturas y boletas registradas en las cotizaciones, ambos por fecha del documento, en el {periodoLabel.toLowerCase()} · un descuadre suele venir de documentos registrados con otra fecha o aún sin emitir
                  </p>
                </div>
              </div>
              <div style={{ padding: "14px 18px 18px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 14 }}>
                {(() => {
                  const bsaleNeto = Number(bsaleVentas.neto || 0);
                  const dif = facturadoSistema - bsaleNeto; // >0: el sistema registra más que lo emitido en Bsale
                  const pct = bsaleNeto > 0 ? (dif / bsaleNeto) * 100 : null;
                  const cuadrado = Math.abs(dif) < 1;
                  const casiCuadrado = pct != null && Math.abs(pct) <= 5;
                  return [
                    { label: "Facturado en Bsale", valor: fmtCLP(bsaleNeto), accent: "#c2570c", valColor: "var(--text)", sub: `${fmtNum(bsaleVentas.documentos || 0)} documentos emitidos (neto)` },
                    { label: "Registrado en el sistema", valor: fmtCLP(facturadoSistema), accent: "#0e7490", valColor: "var(--text)", sub: "facturas y boletas de cotizaciones" },
                    {
                      label: "Diferencia",
                      valor: `${cuadrado ? "" : dif > 0 ? "+" : "−"}${fmtCLP(Math.abs(dif))}`,
                      accent: cuadrado ? "#15803d" : "#b45309",
                      valColor: cuadrado ? "#15803d" : "#b45309",
                      sub: cuadrado ? "cuadrado ✓" : dif > 0 ? "registrado acá por sobre lo emitido en Bsale" : "emitido en Bsale sin registrar acá",
                    },
                    {
                      label: "Descuadre",
                      valor: pct == null ? "—" : cuadrado ? "0%" : `${dif > 0 ? "+" : "−"}${fmtPct(Math.abs(pct))}`,
                      accent: cuadrado || casiCuadrado ? "#15803d" : "#b45309",
                      valColor: cuadrado || casiCuadrado ? "#15803d" : "#b45309",
                      sub: "diferencia respecto de lo facturado en Bsale",
                    },
                  ].map((s) => (
                    <div key={s.label} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderTop: `3px solid ${s.accent}`, borderRadius: "var(--radius-lg)", padding: "14px 16px" }}>
                      <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".04em", color: "var(--text-muted)", fontWeight: 700 }}>{s.label}</div>
                      <div style={{ fontSize: 22, fontWeight: 800, color: s.valColor, marginTop: 6, lineHeight: 1.15, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{s.valor}</div>
                      <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4, lineHeight: 1.35 }}>{s.sub}</div>
                    </div>
                  ));
                })()}
              </div>
            </div>
          )}

          {/* ── OC con saldo por consumir — SIN filtro de fecha (a pedido) */}
          <div className="surface" style={{ marginBottom: 16 }}>
            <div className="surface-header" style={{ flexWrap: "wrap", gap: 12 }}>
              <div>
                <h3 className="surface-title" style={{ margin: 0 }}>Órdenes de compra con saldo por consumir</h3>
                <p style={{ fontSize: 12, color: "var(--text-muted)", margin: 0 }}>
                  Monto de la OC menos lo despachado/facturado · todas las vigentes, sin filtro de fecha del panel
                </p>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <span style={{ fontSize: 12.5, color: "var(--text-muted)" }}>
                  {fmtNum(ocsConSaldo.filas.length)} OC · saldo total{" "}
                  <strong style={{ color: "#b45309" }}>{fmtCLP(ocsConSaldo.totalSaldo)}</strong>
                </span>
                <button className="btn btn-secondary btn-sm" onClick={exportarOcsSaldo} disabled={!ocsConSaldo.filas.length}>
                  Exportar
                </button>
              </div>
            </div>
            {ocsConSaldo.filas.length === 0 ? (
              <div style={{ padding: "16px 24px", fontSize: 13, color: "var(--text-muted)" }}>
                No hay órdenes de compra con saldo pendiente.
              </div>
            ) : (
              <div style={{ padding: "6px 24px 18px", overflowX: "auto", maxHeight: 420, overflowY: "auto" }}>
                <table className="data-table" style={{ width: "100%", fontSize: 13 }}>
                  <thead>
                    <tr>
                      <th>Cotización</th><th>Cliente</th><th>Vendedor</th><th>N° OC</th><th>Fecha OC</th>
                      <th style={{ textAlign: "right" }}>Monto OC</th>
                      <th style={{ textAlign: "right" }}>Consumido</th>
                      <th style={{ textAlign: "right" }}>Saldo</th>
                      <th style={{ width: 130 }}>% consumido</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ocsConSaldo.filas.map((f) => (
                      <tr key={f.licId}>
                        <td><a className="table-link" href={`/detalle/${f.licId}`} target="_blank" rel="noreferrer">{f.codigo}</a></td>
                        <td>{f.cliente}</td>
                        <td>{f.vendedor}</td>
                        <td>{f.numeroOC}</td>
                        <td>{f.fechaOC || "—"}</td>
                        <td style={{ textAlign: "right" }}>{fmtCLP(f.oc)}</td>
                        <td style={{ textAlign: "right" }}>{fmtCLP(f.consumido)}</td>
                        <td style={{ textAlign: "right", fontWeight: 700, color: "#b45309" }}>{fmtCLP(f.saldo)}</td>
                        <td>
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <div style={{ flex: 1, height: 6, borderRadius: 3, background: "var(--bg)", border: "1px solid var(--border)", overflow: "hidden" }}>
                              <div style={{ height: "100%", width: `${clamp(f.pct, 0, 100)}%`, background: "linear-gradient(90deg, var(--primary), #14b8a6)" }} />
                            </div>
                            <span style={{ fontSize: 11.5, color: "var(--text-muted)", minWidth: 32, textAlign: "right" }}>{Math.round(f.pct)}%</span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>


        </>
      )}

      {mostrarProductos && (
        <ModalProductosPorCategoria
          categorias={catData}
          onCerrar={() => setMostrarProductos(false)}
        />
      )}

      {margenOpen && (
        <ModalMargenDesglose
          desglose={margenDesglose}
          margen={margenMes}
          mostrarMonto={!esJefatura}
          onExportar={exportarMargen}
          onCerrar={() => setMargenOpen(false)}
        />
      )}

      {adjOpen && (
        <ModalAdjudicadas
          filas={adjudicadasDetalle}
          periodoLabel={periodoLabel}
          onCerrar={() => setAdjOpen(false)}
        />
      )}

      {ventasOpen && (
        <ModalAvanceMeta
          titulo={`Ventas totales del ${periodoLabel.toLowerCase()}`}
          subtitulo="Guías de despacho (públicas) y boletas/facturas/efectivo (particulares) de cotizaciones adjudicadas en el período"
          filas={ventasDetalle}
          mostrarVendedor
          onCerrar={() => setVentasOpen(false)}
        />
      )}

      {avanceMetaOpen && (
        <ModalAvanceMeta
          titulo={avanceMetaOpen.email
            ? `Avance de ${avanceMetaOpen.nombre}`
            : `Avance de metas del ${periodoLabel.toLowerCase()}`}
          filas={avanceMetaOpen.email
            ? avanceMeta.filas.filter((f) => f.email === avanceMetaOpen.email)
            : avanceMeta.filas}
          mostrarVendedor={!avanceMetaOpen.email}
          onCerrar={() => setAvanceMetaOpen(null)}
        />
      )}
    </div>
  );
}

/* ── Modal: detalle de las adjudicadas del período ─────────────────────────
   Las mismas filas que suman en los KPIs «Adjudicados» y «Cotizaciones
   adjudicadas»: cotización (link al detalle en pestaña nueva), cliente,
   vendedor, tipo, fecha de adjudicación, ventas y adjudicado. */
function ModalAdjudicadas({ filas, periodoLabel, onCerrar }) {
  const totalVentas = filas.reduce((s, f) => s + (Number(f.ventas) || 0), 0);
  const totalAdj = filas.reduce((s, f) => s + (Number(f.adjudicado) || 0), 0);
  const fmtDia = (ymd) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(ymd || ""));
    return m ? `${m[3]}-${m[2]}-${m[1]}` : "—";
  };

  async function exportar() {
    const XLSX = await import("xlsx");
    const ws = XLSX.utils.json_to_sheet(filas.map((f) => ({
      "Cotización": f.codigo,
      "Cliente": f.cliente,
      "Vendedor": f.vendedor,
      "Tipo": f.tipo,
      "Fecha adjudicación": f.fecha || "",
      "Ventas": Math.round(Number(f.ventas) || 0),
      "Adjudicado": Math.round(Number(f.adjudicado) || 0),
    })));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Adjudicadas");
    XLSX.writeFile(wb, `adjudicadas_${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onCerrar(); }}
      style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.55)", zIndex: 12000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
    >
      <div style={{ width: 860, maxWidth: "100%", maxHeight: "86vh", display: "flex", flexDirection: "column", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-lg)", padding: 22 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>Adjudicadas del {periodoLabel.toLowerCase()}</h3>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button className="btn btn-secondary btn-sm" onClick={exportar} disabled={filas.length === 0} title="Descargar este detalle en Excel">
              <Download size={14} /> Exportar
            </button>
            <button className="btn btn-ghost" onClick={onCerrar} style={{ padding: 6 }}><X size={18} /></button>
          </div>
        </div>
        <p style={{ fontSize: 12.5, color: "var(--text-muted)", marginTop: 2, marginBottom: 12 }}>
          <strong>{fmtNum(filas.length)}</strong> cotización{filas.length === 1 ? "" : "es"} ·
          Ventas <strong>{fmtCLP(totalVentas)}</strong> · Adjudicado <strong>{fmtCLP(totalAdj)}</strong>.
          Adjudicada = fecha de su 1ª OC (pública) o boleta/efectivo (particular). Ventas = Σ guías de despacho;
          Adjudicado = Σ órdenes de compra (netas); en particulares ambas son las boletas/facturas.
        </p>
        <div style={{ overflowY: "auto", overflowX: "auto", flex: 1, border: "1px solid var(--border)", borderRadius: 10 }}>
          <table className="data-table" style={{ width: "100%", minWidth: 720 }}>
            <thead style={{ position: "sticky", top: 0, background: "var(--surface)", boxShadow: "0 1px 0 var(--border)" }}>
              <tr>
                <th style={{ textAlign: "left" }}>Cotización</th>
                <th style={{ textAlign: "left" }}>Cliente</th>
                <th style={{ textAlign: "left" }}>Vendedor</th>
                <th style={{ textAlign: "left" }}>Tipo</th>
                <th style={{ textAlign: "left", whiteSpace: "nowrap" }}>Adjudicada el</th>
                <th style={{ textAlign: "right" }}>Ventas</th>
                <th style={{ textAlign: "right" }}>Adjudicado</th>
              </tr>
            </thead>
            <tbody>
              {filas.length === 0 ? (
                <tr><td colSpan={7} style={{ padding: "14px 8px", color: "var(--text-muted)" }}>Sin adjudicaciones en el periodo.</td></tr>
              ) : filas.map((f) => (
                <tr key={f.licId}>
                  <td style={{ fontWeight: 600, whiteSpace: "nowrap" }}>
                    <a
                      href={`/detalle/${f.licId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="table-link"
                      title="Abrir el detalle de la cotización en una pestaña nueva"
                    >
                      {f.codigo}
                    </a>
                  </td>
                  <td style={{ maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text-muted)" }} title={f.cliente}>{f.cliente}</td>
                  <td style={{ maxWidth: 150, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={f.vendedor}>{f.vendedor}</td>
                  <td>
                    <span style={{
                      fontSize: 10.5, fontWeight: 700, padding: "2px 8px", borderRadius: 999, whiteSpace: "nowrap",
                      background: f.tipo === "Particular" ? "#ede9fe" : "#e0f2fe",
                      color: f.tipo === "Particular" ? "#6d28d9" : "#0369a1",
                    }}>{f.tipo}</span>
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}>{fmtDia(f.fecha)}</td>
                  <td style={{ textAlign: "right", fontWeight: 600, whiteSpace: "nowrap" }}>{fmtCLP(f.ventas)}</td>
                  <td style={{ textAlign: "right", fontWeight: 600, whiteSpace: "nowrap" }}>{fmtCLP(f.adjudicado)}</td>
                </tr>
              ))}
            </tbody>
            {filas.length > 0 && (
              <tfoot>
                <tr style={{ background: "var(--bg)" }}>
                  <td colSpan={5} style={{ fontWeight: 700 }}>Total ({fmtNum(filas.length)})</td>
                  <td style={{ textAlign: "right", fontWeight: 700, whiteSpace: "nowrap" }}>{fmtCLP(totalVentas)}</td>
                  <td style={{ textAlign: "right", fontWeight: 700, whiteSpace: "nowrap" }}>{fmtCLP(totalAdj)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
}

/* ── Modal: productos por categoría (acordeón) ────────────────────────── */
function ModalProductosPorCategoria({ categorias, onCerrar }) {
  const total = categorias.reduce((acc, c) => acc + c.monto, 0);
  // Primera categoría abierta por defecto.
  const [abierta, setAbierta] = useState(categorias[0]?.categoria || null);
  return (
    <div
      onClick={onCerrar}
      style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.55)", display: "grid", placeItems: "center", zIndex: 11000, padding: 16 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: "var(--surface)", borderRadius: "var(--radius-lg)", border: "1px solid var(--border)", width: "min(580px, 100%)", maxHeight: "85vh", overflow: "auto", boxShadow: "0 20px 50px rgba(0,0,0,.3)" }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 18px", borderBottom: "1px solid var(--border)" }}>
          <h3 className="surface-title" style={{ margin: 0 }}>Productos por categoría (mes)</h3>
          <button type="button" onClick={onCerrar} className="btn btn-ghost" style={{ padding: 6 }} aria-label="Cerrar">
            <X size={18} />
          </button>
        </div>
        <div style={{ padding: 14 }}>
          {categorias.length === 0 ? (
            <p style={{ color: "var(--text-muted)", fontSize: 13 }}>Sin productos en el periodo.</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {categorias.map((c, i) => {
                const expandida = abierta === c.categoria;
                const color = COLORES_CAT[i % COLORES_CAT.length];
                const maxProd = Math.max(1, ...c.productos.map((p) => p.monto));
                return (
                  <div key={c.categoria} style={{ border: "1px solid var(--border)", borderRadius: "var(--radius)", overflow: "hidden" }}>
                    <button
                      type="button"
                      onClick={() => setAbierta(expandida ? null : c.categoria)}
                      style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", background: "var(--bg)", border: "none", cursor: "pointer", textAlign: "left" }}
                    >
                      <span style={{ width: 11, height: 11, borderRadius: 3, background: color, flexShrink: 0 }} />
                      <span style={{ flex: 1, fontWeight: 600, fontSize: 13, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={c.categoria}>{c.categoria}</span>
                      <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text)", whiteSpace: "nowrap" }}>
                        {fmtCLP(c.monto)}
                        <span style={{ color: "var(--text-muted)", fontWeight: 400, marginLeft: 6 }}>{total > 0 ? `${((c.monto / total) * 100).toFixed(0)}%` : "0%"}</span>
                      </span>
                      <span style={{ color: "var(--text-muted)", transform: expandida ? "rotate(180deg)" : "none", transition: "transform .15s" }}>▾</span>
                    </button>
                    {expandida && (
                      <div style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: 9 }}>
                        {c.productos.length === 0 ? (
                          <p style={{ color: "var(--text-muted)", fontSize: 12 }}>Sin productos con nombre en esta categoría.</p>
                        ) : c.productos.map((p, j) => (
                          <div key={p.producto}>
                            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 3, gap: 8 }}>
                              <span style={{ color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={p.producto}>
                                <strong style={{ color: "var(--text-muted)", marginRight: 6 }}>{j + 1}.</strong>{p.producto}
                              </span>
                              <strong style={{ color: "var(--text)", whiteSpace: "nowrap" }}>{fmtCLP(p.monto)}</strong>
                            </div>
                            <div style={{ height: 8, borderRadius: 4, background: "var(--bg)", overflow: "hidden" }}>
                              <div style={{ height: "100%", width: `${clamp((p.monto / maxProd) * 100, 2, 100)}%`, background: color, borderRadius: 4 }} />
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Fila de indicador ────────────────────────────────────────────────── */
function FilaInd({ nombre, actual, meta, cumpl, delta }) {
  const color = cumpl == null ? "var(--text-muted)" : cumpl >= 100 ? "#15803d" : cumpl >= 70 ? "#0d9488" : "#b45309";
  return (
    <tr>
      <td style={{ fontWeight: 600 }}>{nombre}</td>
      <td style={{ textAlign: "right", fontWeight: 600 }}>{actual}</td>
      <td style={{ textAlign: "right", color: "var(--text-muted)" }}>{meta}</td>
      <td style={{ textAlign: "right", fontWeight: 600, color }}>{cumpl == null ? "—" : `${cumpl.toFixed(0)}%`}</td>
      <td style={{ textAlign: "right" }}>{delta}</td>
    </tr>
  );
}

/* ── Línea SVG (evolución) ────────────────────────────────────────────── */
function LineChart({ data, max }) {
  const W = 320, H = 130, padX = 8, padY = 14;
  const n = data.length;
  const stepX = n > 1 ? (W - padX * 2) / (n - 1) : 0;
  const y = (v) => H - padY - (v / max) * (H - padY * 2);
  const pts = data.map((d, i) => [padX + i * stepX, y(d.ventas)]);
  const path = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  const area = `${path} L${pts[pts.length - 1][0].toFixed(1)},${H - padY} L${pts[0][0].toFixed(1)},${H - padY} Z`;
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: 130 }}>
        <path d={area} fill="rgba(40,174,177,0.12)" />
        <path d={path} fill="none" stroke="#28aeb1" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        {pts.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r="3" fill="#28aeb1" />)}
      </svg>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
        {data.map((d) => (
          <div key={d.mes} style={{ flex: 1, textAlign: "center", fontSize: 10, color: "var(--text-muted)" }}>
            <div>{d.label}</div>
            <div style={{ fontSize: 9.5 }}>{`$${Math.round(d.ventas / 1000).toLocaleString("es-CL")}k`}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Donut SVG (categorías) ───────────────────────────────────────────── */
function Donut({ data, total }) {
  const top = data.slice(0, 9);
  const restoMonto = data.slice(9).reduce((acc, c) => acc + c.monto, 0);
  const segmentos = restoMonto > 0 ? [...top, { categoria: "Otros", monto: restoMonto }] : top;
  const R = 52, sw = 18, C = 2 * Math.PI * R;
  let acc = 0;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
      <svg viewBox="0 0 130 130" style={{ width: 130, height: 130, flexShrink: 0 }}>
        <g transform="translate(65,65) rotate(-90)">
          <circle r={R} fill="none" stroke="var(--bg)" strokeWidth={sw} />
          {segmentos.map((s, i) => {
            const frac = total > 0 ? s.monto / total : 0;
            const dash = frac * C;
            const el = (
              <circle key={s.categoria} r={R} fill="none" stroke={COLORES_CAT[i % COLORES_CAT.length]}
                strokeWidth={sw} strokeDasharray={`${dash} ${C - dash}`} strokeDashoffset={-acc} />
            );
            acc += dash;
            return el;
          })}
        </g>
        <text x="65" y="62" textAnchor="middle" style={{ fontSize: 10, fill: "var(--text-muted)" }}>Total</text>
        <text x="65" y="76" textAnchor="middle" style={{ fontSize: 11, fontWeight: 700, fill: "var(--text)" }}>
          {`$${Math.round(total / 1000).toLocaleString("es-CL")}k`}
        </text>
      </svg>
      <div style={{ flex: 1, minWidth: 150, display: "flex", flexDirection: "column", gap: 4 }}>
        {segmentos.map((s, i) => (
          <div key={s.categoria} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5 }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: COLORES_CAT[i % COLORES_CAT.length], flexShrink: 0 }} />
            <span style={{ flex: 1, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={s.categoria}>{s.categoria}</span>
            <span style={{ color: "var(--text-muted)" }}>{total > 0 ? `${((s.monto / total) * 100).toFixed(0)}%` : "0%"}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
