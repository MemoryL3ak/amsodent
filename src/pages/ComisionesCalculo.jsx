// ComisionesCalculo.jsx
// Cálculo de comisión por vendedor a partir de la configuración de tramos POR
// PERFIL (pestaña "Configuración"): cada vendedor se evalúa con las tablas del
// canal que tiene asignado en Metas. El listado de vendedores sale de los
// perfiles (rol ventas / jefe_ventas) y se distribuye en una tabla por perfil.
// Métricas reales del período:
//   • Venta          → Σ venta neta de sus cotizaciones ADJUDICADAS en el mes (CLP)
//   • Margen         → (venta − costo) / venta de esas adjudicadas (%)
//   • Productividad  → N° de actividades registradas en la bitácora en el mes
//   • Conversión     → adjudicadas / cotizaciones ingresadas en el mes (%)
// Además trae de Definición de Metas: meta neta (CLP) y cantidad de meta.
// Comisión = (Venta_full + Productividad_full) × Margen_mult × Conversión_mult.
import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import MonthCalendarPicker from "../components/MonthCalendarPicker";
import { DollarSign, Percent, Users } from "lucide-react";
import { CANALES, CANAL_LABELS, normalizeCanal } from "../lib/canales";

/* ── Helpers ──────────────────────────────────────────────────────────── */
const fmtCLP = (v) => `$${Math.round(Number(v || 0)).toLocaleString("es-CL")}`;
const fmtPct = (v) => (Number.isFinite(Number(v)) ? `${Number(v).toFixed(1)}%` : "—");
const fmtNum = (v) => Number(v || 0).toLocaleString("es-CL");

function inicioMesISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}
function mesDe(value) { return value ? String(value).slice(0, 7) : ""; }
function toDateISO(value) {
  if (!value) return "";
  const s = String(value);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
}
function finDeMes(mesKey) {
  const [y, m] = mesKey.split("-").map(Number);
  const d = new Date(y, m, 0);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const esParticular = (l) => (l?.tipo_cliente || "").toLowerCase().includes("particular");

// Elige el tramo cuyo umbral "desde" es el mayor que no supera el valor real.
function pickTramo(filas, valor) {
  if (!Array.isArray(filas) || !filas.length) return null;
  const ordenadas = [...filas].sort((a, b) => Number(b.desde || 0) - Number(a.desde || 0));
  const v = Number(valor || 0);
  for (const f of ordenadas) {
    if (v >= Number(f.desde || 0)) return f;
  }
  return ordenadas[ordenadas.length - 1];
}

// Estados que no cuentan como cotización ingresada (coherente con el resto del sistema).
const ESTADOS_NO_CUENTAN = ["Descartada", "Desierta", "Pendiente Aprobación"];

const SIN_CANAL = "__sin_canal__";

export default function ComisionesCalculo({ perfiles }) {
  const [periodo, setPeriodo] = useState(inicioMesISO());
  const [filtroTipo, setFiltroTipo] = useState(""); // "" | "publica" | "particular"
  const [loading, setLoading] = useState(true);
  const [lics, setLics] = useState([]);
  const [costoBySku, setCostoBySku] = useState({});
  const [vendedores, setVendedores] = useState([]); // roster: [{email, nombre, rol}]
  const [profiles, setProfiles] = useState({}); // email -> nombre (todos los perfiles)
  const [actividades, setActividades] = useState([]);
  const [itemsMargen, setItemsMargen] = useState([]); // ítems de adjudicadas del período
  const [canalMap, setCanalMap] = useState({}); // email -> canal asignado en Metas
  const [metaNetaMap, setMetaNetaMap] = useState({}); // email -> meta neta (CLP)
  const [metaCantMap, setMetaCantMap] = useState({}); // email -> Σ cantidad de meta

  const mesActual = mesDe(periodo);

  const pasaTipo = (l) => {
    if (filtroTipo === "publica") return !esParticular(l);
    if (filtroTipo === "particular") return esParticular(l);
    return true;
  };

  // Carga base: licitaciones + costos por SKU + roster de vendedores (una vez).
  useEffect(() => {
    let activo = true;
    (async () => {
      setLoading(true);
      try {
        const [data, prods, perfilesUsr] = await Promise.all([
          api.get("/licitaciones/with-fields?fields=id,creado_por,estado,fecha,fecha_adjudicada,tipo_cliente,total_sin_iva,total_con_iva"),
          api.get("/productos"),
          api.get("/usuarios/profiles"),
        ]);
        if (!activo) return;
        setLics(Array.isArray(data) ? data : []);
        const m = {};
        (prods || []).forEach((p) => {
          const sku = String(p.sku || "").trim().toUpperCase();
          if (sku) m[sku] = Number(p.costo || 0);
        });
        setCostoBySku(m);
        // Roster: el equipo de ventas completo, aunque no tenga actividad aún.
        const nombres = {};
        const roster = [];
        (perfilesUsr || []).forEach((p) => {
          const email = (p?.email || "").trim().toLowerCase();
          if (!email) return;
          nombres[email] = (p?.nombre || "").trim() || email;
          if (["ventas", "jefe_ventas"].includes(p?.rol)) roster.push({ email, nombre: nombres[email], rol: p.rol });
        });
        setProfiles(nombres);
        setVendedores(roster);
      } catch (e) {
        console.error("Error cargando base de comisiones:", e);
        if (activo) { setLics([]); setCostoBySku({}); setVendedores([]); setProfiles({}); }
      } finally {
        if (activo) setLoading(false);
      }
    })();
    return () => { activo = false; };
  }, []);

  // Actividades del mes (para la productividad por vendedor).
  useEffect(() => {
    let activo = true;
    (async () => {
      try {
        const desde = `${mesActual}-01`;
        const hasta = finDeMes(mesActual);
        const acts = await api.get(`/actividades?desde=${desde}&hasta=${hasta}`);
        if (activo) setActividades(Array.isArray(acts) ? acts : []);
      } catch (e) {
        console.error("Error cargando actividades:", e);
        if (activo) setActividades([]);
      }
    })();
    return () => { activo = false; };
  }, [mesActual]);

  // Asignación de canal + metas del período (desde Definición de Metas).
  useEffect(() => {
    let activo = true;
    (async () => {
      const [asig, metas, partes] = await Promise.all([
        api.get(`/metas/canal?periodo=${periodo}`).catch((e) => { console.error("Error cargando canales:", e); return []; }),
        api.get(`/metas/mensuales?periodo=${periodo}`).catch((e) => { console.error("Error cargando metas:", e); return []; }),
        api.get(`/metas/canal-partes?periodo=${periodo}`).catch((e) => { console.error("Error cargando cantidad de metas:", e); return []; }),
      ]);
      if (!activo) return;
      const cm = {};
      (asig || []).forEach((r) => {
        const email = (r?.vendedor_email || "").trim().toLowerCase();
        const canal = normalizeCanal(r?.canal);
        if (email && canal) cm[email] = canal;
      });
      setCanalMap(cm);
      const mn = {};
      (metas || []).forEach((r) => {
        const email = (r?.vendedor_email || "").trim().toLowerCase();
        if (email) mn[email] = Number(r?.meta_neto || 0);
      });
      setMetaNetaMap(mn);
      // Cantidad de meta: suma del desglose por canal de cada vendedor.
      const mc = {};
      (partes || []).forEach((r) => {
        const email = (r?.vendedor_email || "").trim().toLowerCase();
        if (!email) return;
        mc[email] = (mc[email] || 0) + Math.max(0, Number(r?.meta_cantidad || 0));
      });
      setMetaCantMap(mc);
    })();
    return () => { activo = false; };
  }, [periodo]);

  // Cotizaciones adjudicadas en el mes (para el margen: se cargan sus ítems).
  const adjudicadasDelMes = useMemo(() => {
    return lics.filter((l) => {
      if (l.estado !== "Adjudicada") return false;
      if (!pasaTipo(l)) return false;
      const f = toDateISO(l.fecha_adjudicada) || toDateISO(l.fecha);
      return mesDe(f) === mesActual;
    });
  }, [lics, mesActual, filtroTipo]);

  useEffect(() => {
    const ids = adjudicadasDelMes.map((l) => Number(l.id)).filter(Boolean);
    if (!ids.length) { setItemsMargen([]); return; }
    let activo = true;
    (async () => {
      try {
        const items = await api.post("/licitaciones/items/filter", {
          licitacion_ids: ids,
          fields: "licitacion_id,total,cantidad,sku",
        });
        if (activo) setItemsMargen(Array.isArray(items) ? items : []);
      } catch (e) {
        console.error("Error cargando ítems para margen:", e);
        if (activo) setItemsMargen([]);
      }
    })();
    return () => { activo = false; };
  }, [adjudicadasDelMes]);

  // ── Agregación por vendedor y distribución por perfil (canal) ───────────
  const grupos = useMemo(() => {
    const map = new Map();
    const ensure = (email) => {
      const key = email || "__sin__";
      if (!map.has(key)) {
        map.set(key, {
          email: key,
          nombre: profiles[key] || (key === "__sin__" ? "Sin asignar" : key),
          venta: 0, cotizaciones: 0, adjudicadas: 0,
          margenVenta: 0, margenCosto: 0, actividades: 0,
        });
      }
      return map.get(key);
    };

    // 6.2: el roster completo del equipo de ventas entra al listado, con o sin
    // actividad, para distribuirlo en la tabla de su perfil.
    vendedores.forEach((v) => { ensure(v.email).nombre = v.nombre; });

    // Cotizaciones ingresadas y adjudicadas (con su venta neta).
    lics.forEach((l) => {
      if (!pasaTipo(l)) return;
      const email = (l.creado_por || "").trim().toLowerCase();
      const row = ensure(email);
      if (mesDe(toDateISO(l.fecha)) === mesActual && !ESTADOS_NO_CUENTAN.includes((l.estado || "").trim())) {
        row.cotizaciones += 1;
      }
      if (l.estado === "Adjudicada") {
        const f = toDateISO(l.fecha_adjudicada) || toDateISO(l.fecha);
        if (mesDe(f) === mesActual) {
          row.adjudicadas += 1;
          const neto = Number(l.total_sin_iva || 0) || Math.round(Number(l.total_con_iva || 0) / 1.19);
          row.venta += neto;
        }
      }
    });

    // Margen: ítems de las adjudicadas del mes, atribuidos a su vendedor.
    const licVendedor = new Map();
    adjudicadasDelMes.forEach((l) => licVendedor.set(String(l.id), (l.creado_por || "").trim().toLowerCase()));
    itemsMargen.forEach((it) => {
      const email = licVendedor.get(String(it.licitacion_id));
      if (email == null) return;
      const row = ensure(email);
      const total = Number(it.total || 0);
      const sku = String(it.sku || "").trim().toUpperCase();
      const costo = (costoBySku[sku] || 0) * (Number(it.cantidad) || 0);
      row.margenVenta += total;
      row.margenCosto += costo;
    });

    // Productividad: N° de actividades del mes por vendedor.
    actividades.forEach((a) => {
      const email = (a.user_email || "").trim().toLowerCase();
      if (!email) return;
      const f = toDateISO(a.fecha);
      if (mesDe(f) !== mesActual) return;
      ensure(email).actividades += 1;
    });

    const esDelRoster = new Set(vendedores.map((v) => v.email));

    // Métricas derivadas + tramos del PERFIL del vendedor + comisión.
    const porCanal = new Map(); // canal -> filas[]
    map.forEach((r) => {
      // Fuera del roster: solo se muestra si tuvo actividad en el período.
      if (!esDelRoster.has(r.email) && r.cotizaciones === 0 && r.adjudicadas === 0 && r.actividades === 0) return;

      const canal = canalMap[r.email] || SIN_CANAL;
      const tablas = canal !== SIN_CANAL ? perfiles?.[canal] : null;

      const conversion = r.cotizaciones > 0 ? (r.adjudicadas / r.cotizaciones) * 100 : 0;
      const margenPct = r.margenVenta > 0 ? ((r.margenVenta - r.margenCosto) / r.margenVenta) * 100 : 0;

      const tVenta = pickTramo(tablas?.venta, r.venta);
      const tProd = pickTramo(tablas?.productividad, r.actividades);
      const tMargen = pickTramo(tablas?.margen, margenPct);
      const tConv = pickTramo(tablas?.conversion, conversion);

      const ventaFull = Number(tVenta?.monto || 0);
      const prodFull = Number(tProd?.monto || 0);
      const margenMult = Number(tMargen?.multiplicador || 0);
      const convMult = Number(tConv?.multiplicador || 0);
      const comision = tablas ? (ventaFull + prodFull) * margenMult * convMult : null;
      const pctSobreVenta = comision != null && r.venta > 0 ? (comision / r.venta) * 100 : null;

      // 6.3 / 6.4: meta neta y cantidad de meta desde Definición de Metas.
      const metaNeta = metaNetaMap[r.email] || 0;
      const metaCant = metaCantMap[r.email] || 0;
      const pctMeta = metaNeta > 0 ? (r.venta / metaNeta) * 100 : null;

      const fila = {
        ...r, canal, conversion, margenPct,
        tVenta, tProd, tMargen, tConv,
        ventaFull, prodFull, margenMult, convMult, comision, pctSobreVenta,
        metaNeta, metaCant, pctMeta,
      };
      if (!porCanal.has(canal)) porCanal.set(canal, []);
      porCanal.get(canal).push(fila);
    });

    // Orden de los grupos: el de CANALES; "Sin canal" al final.
    const out = [];
    [...CANALES, SIN_CANAL].forEach((canal) => {
      const filas = porCanal.get(canal);
      if (!filas || !filas.length) return;
      filas.sort((a, b) => (b.comision || 0) - (a.comision || 0) || b.venta - a.venta);
      out.push({
        canal,
        label: canal === SIN_CANAL ? "Sin canal asignado en Metas" : CANAL_LABELS[canal],
        filas,
        totalComision: filas.reduce((acc, f) => acc + (f.comision || 0), 0),
        totalVenta: filas.reduce((acc, f) => acc + f.venta, 0),
      });
    });
    return out;
  }, [lics, itemsMargen, actividades, costoBySku, profiles, vendedores, perfiles, canalMap, metaNetaMap, metaCantMap, adjudicadasDelMes, mesActual, filtroTipo]);

  const todas = grupos.flatMap((g) => g.filas);
  const totalComision = todas.reduce((acc, r) => acc + (r.comision || 0), 0);
  const totalVenta = todas.reduce((acc, r) => acc + r.venta, 0);

  const configLista = CANALES.some((c) => (perfiles?.[c]?.venta?.length || 0) > 0);

  return (
    <div>
      {/* Filtros */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 16 }}>
        <div className="field" style={{ margin: 0 }}>
          <label className="field-label">Mes</label>
          <MonthCalendarPicker value={periodo} onChange={setPeriodo} />
        </div>
        <div className="field" style={{ margin: 0 }}>
          <label className="field-label">Tipo de cliente</label>
          <select className="input" value={filtroTipo} onChange={(e) => setFiltroTipo(e.target.value)} style={{ minWidth: 180 }}>
            <option value="">Todos</option>
            <option value="publica">Entidad Pública</option>
            <option value="particular">Cliente Particular</option>
          </select>
        </div>
      </div>

      {/* Cómo se derivan las métricas */}
      <div className="surface" style={{ marginBottom: 16, padding: "12px 16px", background: "#f8fafc", border: "1px solid var(--border)", fontSize: 12.5, color: "var(--text-muted)" }}>
        <strong style={{ color: "var(--text)" }}>Cómo se calcula:</strong> cada vendedor usa las tablas del perfil (canal) que tiene asignado en Metas.
        Venta = Σ venta neta de las cotizaciones adjudicadas del mes ·
        Margen = (venta − costo)/venta de esas adjudicadas · Productividad = N° de actividades del mes en la bitácora ·
        Conversión = adjudicadas / cotizaciones ingresadas. Meta neta y cantidad de meta vienen de la Definición de Metas del período.
      </div>

      {/* KPIs resumen */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 14, marginBottom: 18 }}>
        <div className="surface" style={{ padding: "16px 18px", borderTop: "3px solid #16a34a" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".04em", color: "var(--text-muted)" }}>
            <DollarSign size={15} color="#16a34a" /> Comisión total del equipo
          </div>
          <div style={{ fontSize: 24, fontWeight: 800, color: "var(--text)" }}>{fmtCLP(totalComision)}</div>
        </div>
        <div className="surface" style={{ padding: "16px 18px", borderTop: "3px solid #0e7490" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".04em", color: "var(--text-muted)" }}>
            <Percent size={15} color="#0e7490" /> Comisión sobre venta
          </div>
          <div style={{ fontSize: 24, fontWeight: 800, color: "var(--text)" }}>
            {totalVenta > 0 ? fmtPct((totalComision / totalVenta) * 100) : "—"}
          </div>
        </div>
        <div className="surface" style={{ padding: "16px 18px", borderTop: "3px solid #6366f1" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".04em", color: "var(--text-muted)" }}>
            <Users size={15} color="#6366f1" /> Vendedores en el cálculo
          </div>
          <div style={{ fontSize: 24, fontWeight: 800, color: "var(--text)" }}>{fmtNum(todas.length)}</div>
        </div>
      </div>

      {!configLista ? (
        <div className="surface" style={{ padding: "24px", color: "var(--text-muted)" }}>
          Primero define los tramos y umbrales de cada perfil en la pestaña <strong>Configuración</strong>.
        </div>
      ) : loading ? (
        <div className="surface" style={{ padding: "40px 24px", color: "var(--text-muted)" }}>Calculando comisiones…</div>
      ) : grupos.length === 0 ? (
        <div className="surface" style={{ padding: "40px 24px", color: "var(--text-muted)" }}>
          No hay vendedores ni actividad en el período seleccionado.
        </div>
      ) : (
        grupos.map((g) => (
          <div key={g.canal} className="surface" style={{ padding: 0, overflow: "hidden", marginBottom: 18, borderTop: `3px solid ${g.canal === SIN_CANAL ? "#94a3b8" : "var(--primary)"}` }}>
            {/* Encabezado del perfil */}
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, padding: "12px 16px", borderBottom: "1px solid var(--border)", flexWrap: "wrap" }}>
              <strong style={{ fontSize: 14.5, color: "var(--text)" }}>
                {g.label}
                <span style={{ marginLeft: 8, fontSize: 11.5, fontWeight: 700, padding: "2px 8px", borderRadius: 999, background: "var(--bg)", color: "var(--text-muted)" }}>
                  {g.filas.length} vendedor{g.filas.length === 1 ? "" : "es"}
                </span>
              </strong>
              <span style={{ fontSize: 12.5, color: "var(--text-muted)" }}>
                Comisión del perfil: <strong style={{ color: "#15803d" }}>{fmtCLP(g.totalComision)}</strong>
              </span>
            </div>
            {g.canal === SIN_CANAL && (
              <div style={{ padding: "8px 16px", fontSize: 12, color: "#b45309", background: "#fffbeb", borderBottom: "1px solid var(--border)" }}>
                Estos vendedores no tienen canal asignado en la Definición de Metas del período, por lo que no se les puede aplicar un perfil de comisión. Asigna su canal en el módulo Metas.
              </div>
            )}
            <div style={{ overflowX: "auto" }}>
              <table className="data-table" style={{ minWidth: 1280, width: "100%" }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left" }}>Vendedor</th>
                    <th style={{ textAlign: "right" }} title="Meta neta del período (Definición de Metas)">Meta neta</th>
                    <th style={{ textAlign: "right" }} title="Cantidad de meta del período (Definición de Metas)">Cant. meta</th>
                    <th style={{ textAlign: "right" }}>Venta neta</th>
                    <th style={{ textAlign: "right" }} title="Venta neta / meta neta">% meta</th>
                    <th style={{ textAlign: "right" }}>Full venta</th>
                    <th style={{ textAlign: "right" }}>Margen %</th>
                    <th style={{ textAlign: "right" }}>× Margen</th>
                    <th style={{ textAlign: "right" }}>Activ.</th>
                    <th style={{ textAlign: "right" }}>Full prod.</th>
                    <th style={{ textAlign: "right" }}>Conv. %</th>
                    <th style={{ textAlign: "right" }}>× Conv.</th>
                    <th style={{ textAlign: "right" }}>Comisión</th>
                    <th style={{ textAlign: "right" }}>% s/venta</th>
                  </tr>
                </thead>
                <tbody>
                  {g.filas.map((r) => (
                    <tr key={r.email}>
                      <td>
                        <div style={{ fontWeight: 600, color: "var(--text)" }}>{r.nombre}</div>
                        <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{r.email === "__sin__" ? "—" : r.email}</div>
                      </td>
                      <td style={{ textAlign: "right" }}>{r.metaNeta > 0 ? fmtCLP(r.metaNeta) : <span style={{ color: "var(--text-muted)" }}>—</span>}</td>
                      <td style={{ textAlign: "right" }}>{r.metaCant > 0 ? fmtNum(r.metaCant) : <span style={{ color: "var(--text-muted)" }}>—</span>}</td>
                      <td style={{ textAlign: "right" }}>{fmtCLP(r.venta)}</td>
                      <td style={{ textAlign: "right", fontWeight: 600, color: r.pctMeta == null ? "var(--text-muted)" : r.pctMeta >= 100 ? "#15803d" : r.pctMeta >= 70 ? "#0d9488" : r.pctMeta >= 40 ? "#b45309" : "#dc2626" }}>
                        {r.pctMeta == null ? "—" : fmtPct(r.pctMeta)}
                      </td>
                      <td style={{ textAlign: "right", color: "var(--text-muted)" }} title={r.tVenta?.tramo || ""}>{r.comision == null ? "—" : fmtCLP(r.ventaFull)}</td>
                      <td style={{ textAlign: "right" }}>{fmtPct(r.margenPct)}</td>
                      <td style={{ textAlign: "right", color: "var(--text-muted)" }} title={r.tMargen?.tramo || ""}>{r.comision == null ? "—" : r.margenMult.toLocaleString("es-CL")}</td>
                      <td style={{ textAlign: "right" }}>{fmtNum(r.actividades)}</td>
                      <td style={{ textAlign: "right", color: "var(--text-muted)" }} title={r.tProd?.tramo || ""}>{r.comision == null ? "—" : fmtCLP(r.prodFull)}</td>
                      <td style={{ textAlign: "right" }}>{fmtPct(r.conversion)}</td>
                      <td style={{ textAlign: "right", color: "var(--text-muted)" }} title={r.tConv?.tramo || ""}>{r.comision == null ? "—" : r.convMult.toLocaleString("es-CL")}</td>
                      <td style={{ textAlign: "right", fontWeight: 700, color: "#15803d" }}>{r.comision == null ? "—" : fmtCLP(r.comision)}</td>
                      <td style={{ textAlign: "right", fontWeight: 600 }}>{r.pctSobreVenta == null ? "—" : fmtPct(r.pctSobreVenta)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{ fontWeight: 700, borderTop: "2px solid var(--border)" }}>
                    <td>Total {g.canal === SIN_CANAL ? "sin canal" : g.label}</td>
                    <td colSpan={2}></td>
                    <td style={{ textAlign: "right" }}>{fmtCLP(g.totalVenta)}</td>
                    <td colSpan={8}></td>
                    <td style={{ textAlign: "right", color: "#15803d" }}>{fmtCLP(g.totalComision)}</td>
                    <td style={{ textAlign: "right" }}>{g.totalVenta > 0 ? fmtPct((g.totalComision / g.totalVenta) * 100) : "—"}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
