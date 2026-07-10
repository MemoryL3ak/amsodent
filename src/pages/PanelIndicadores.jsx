import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import useAuth from "../hooks/useAuth";
import MonthCalendarPicker from "../components/MonthCalendarPicker";
import DateFilter from "../components/DateFilter";
import EmbudoComercial from "../components/panel/EmbudoComercial";
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

const ESTADOS_ABIERTOS = ["En espera", "Pendiente Aprobación"];
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
  const [catData, setCatData] = useState([]); // [{ categoria, monto, productos:[{producto,monto}] }]
  const [margenMes, setMargenMes] = useState({ monto: 0, pct: 0 });
  const [costoBySku, setCostoBySku] = useState({}); // sku → costo (para el margen)
  const [mostrarProductos, setMostrarProductos] = useState(false);
  const [metaCotizaciones, setMetaCotizaciones] = useState(0);
  const [metaMonto, setMetaMonto] = useState(0);

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
              tipo: ["orden_compra", "guia_despacho", "factura", "factura_boleta", "efectivo"],
            },
            fields: "licitacion_id,tipo,monto,fecha_oc,created_at",
          });
          (docs || []).forEach((d) => {
            const lid = Number(d.licitacion_id);
            if (!lid) return;
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
          });
        }
        if (!activo) return;
        setLics(rows);
        setAdjDateByLic(adj);
        setDocSums(sums);
      } catch (e) {
        console.error("Error cargando panel:", e);
        if (activo) { setLics([]); setAdjDateByLic({}); setDocSums({}); }
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
      if (!idsMes.length) { if (activo) { setCatData([]); setMargenMes({ monto: 0, pct: 0 }); } return; }
      try {
        const items = await api.post("/licitaciones/items/filter", {
          licitacion_ids: idsMes,
          fields: "licitacion_id,producto,categoria,total,cantidad,sku",
        });
        const mapCat = {};      // cat -> total
        const mapCatProd = {};  // cat -> { producto -> monto }
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
          const costoUnit = costoBySku[sku] || 0;
          costoTotal += costoUnit * (Number(it.cantidad) || 0);
        });
        const margenMonto = Math.round(ventaNeta - costoTotal);
        const margenPct = ventaNeta > 0 ? (margenMonto / ventaNeta) * 100 : 0;
        if (activo) setMargenMes({ monto: margenMonto, pct: margenPct });
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
        const total = (mm || []).reduce((acc, r) => acc + Number(r?.meta_neto || 0), 0);
        if (activo) setMetaMonto(total);
      } catch { if (activo) setMetaMonto(0); }
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

  if (!cargando && !puedeVer) {
    return (
      <div className="page">
        <div className="surface"><div className="surface-body" style={{ color: "var(--danger)" }}>
          Acceso restringido: el panel de indicadores es para administración y jefatura de ventas.
        </div></div>
      </div>
    );
  }

  const cumplimientoMonto = metaMonto > 0 ? (m.ventasNeto / metaMonto) * 100 : null;
  const cumplimientoCot = metaCotizaciones > 0 ? (m.cotizaciones / metaCotizaciones) * 100 : null;
  const cumplimiento = cumplimientoMonto != null ? cumplimientoMonto : cumplimientoCot;

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
            <KpiCard icon={ShoppingCart} color="#0e7490" label="Ventas Totales" sub={subVentas} value={fmtCLP(m.ventas)} delta={mostrarDelta ? <Delta actual={m.ventas} prev={mPrev.ventas} /> : null} />
            <KpiCard icon={Banknote} color="#15803d" label="Adjudicados" sub={subAdjudicado} value={fmtCLP(m.adjudicadoMonto)} delta={mostrarDelta ? <Delta actual={m.adjudicadoMonto} prev={mPrev.adjudicadoMonto} /> : null} />
            <KpiCard icon={Target} color="#16a34a" label="Conversión" sub="Adjudicadas / cotizaciones" value={fmtPct(m.conversion)} delta={mostrarDelta ? <Delta actual={m.conversion} prev={mPrev.conversion} unidadPp /> : null} />
            <KpiCard icon={FileText} color="#6366f1" label="Cotizaciones" sub={`Creadas en el ${periodoLabel.toLowerCase()}`} value={fmtNum(m.cotizaciones)} delta={mostrarDelta ? <Delta actual={m.cotizaciones} prev={mPrev.cotizaciones} /> : null} />
            <KpiCard icon={UserPlus} color="#d97706" label="Clientes Nuevos" sub={`Primera compra el ${periodoLabel.toLowerCase()}`} value={fmtNum(cnr.nuevos)} delta={mostrarDelta ? <Delta actual={cnr.nuevos} prev={cnrPrev.nuevos} /> : null} />
            <KpiCard icon={RefreshCw} color="#0ea5e9" label="Recompra" sub="Clientes que repiten" value={fmtPct(cnr.recompra)} delta={mostrarDelta ? <Delta actual={cnr.recompra} prev={cnrPrev.recompra} unidadPp /> : null} />
            <KpiCard icon={Award} color="#b45309" label="Cotizaciones adjudicadas" sub={`Cierres del ${periodoLabel.toLowerCase()}`} value={fmtNum(m.adjudicadas)} delta={mostrarDelta ? <Delta actual={m.adjudicadas} prev={mPrev.adjudicadas} /> : null} />
            <KpiCard icon={TrendingUp} color="#7c3aed" label="Margen %" sub="(venta − costo) / venta · adjudicadas" value={fmtPct(margenMes.pct)} />
            {!esJefatura && (
              <KpiCard icon={Banknote} color="#0d9488" label="Margen $" sub="Venta neta − costo · adjudicadas" value={fmtCLP(margenMes.monto)} />
            )}
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
            {/* Ventas por categoría */}
            <div className="surface" style={{ padding: 18 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, gap: 8 }}>
                <h3 className="surface-title" style={{ margin: 0 }}>Ventas por categoría ({periodoLabel.toLowerCase()})</h3>
                {catData.length > 0 && (
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
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
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1fr)", gap: 16 }}>
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
                    <FilaInd nombre="Ventas (neto)" actual={fmtCLP(m.ventasNeto)} meta={metaMonto > 0 ? fmtCLP(metaMonto) : "—"} cumpl={metaMonto > 0 ? (m.ventasNeto / metaMonto) * 100 : null} delta={<Delta actual={m.ventasNeto} prev={mPrev.ventasNeto} />} />
                    <FilaInd nombre="Ventas (documentos)" actual={fmtCLP(m.ventas)} meta="—" cumpl={null} delta={<Delta actual={m.ventas} prev={mPrev.ventas} />} />
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
                    Cumplimiento {cumplimientoMonto != null ? "(ventas vs meta)" : "(cotizaciones vs meta)"}
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
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <input
                  type="text"
                  className="input"
                  style={{ width: 200 }}
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
        </>
      )}

      {mostrarProductos && (
        <ModalProductosPorCategoria
          categorias={catData}
          onCerrar={() => setMostrarProductos(false)}
        />
      )}
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
