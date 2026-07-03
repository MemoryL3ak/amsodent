// ComisionesCalculo.jsx
// Cálculo de comisión por vendedor a partir de la configuración de tramos
// (pestaña "Configuración"). Deriva automáticamente las 4 métricas reales del
// período y las cruza con los umbrales "Desde" de cada tabla:
//   • Venta          → Σ venta neta de sus cotizaciones ADJUDICADAS en el mes (CLP)
//   • Margen         → (venta − costo) / venta de esas adjudicadas (%)
//   • Productividad  → N° de actividades registradas en la bitácora en el mes
//   • Conversión     → adjudicadas / cotizaciones ingresadas en el mes (%)
// Comisión = (Venta_full + Productividad_full) × Margen_mult × Conversión_mult.
import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import MonthCalendarPicker from "../components/MonthCalendarPicker";
import { DollarSign, Percent } from "lucide-react";

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

export default function ComisionesCalculo({ tablas }) {
  const [periodo, setPeriodo] = useState(inicioMesISO());
  const [filtroTipo, setFiltroTipo] = useState(""); // "" | "publica" | "particular"
  const [loading, setLoading] = useState(true);
  const [lics, setLics] = useState([]);
  const [costoBySku, setCostoBySku] = useState({});
  const [profiles, setProfiles] = useState({}); // email -> nombre
  const [actividades, setActividades] = useState([]);
  const [itemsMargen, setItemsMargen] = useState([]); // ítems de adjudicadas del período

  const mesActual = mesDe(periodo);

  const pasaTipo = (l) => {
    if (filtroTipo === "publica") return !esParticular(l);
    if (filtroTipo === "particular") return esParticular(l);
    return true;
  };

  // Carga base: licitaciones + costos por SKU (una vez).
  useEffect(() => {
    let activo = true;
    (async () => {
      setLoading(true);
      try {
        const [data, prods] = await Promise.all([
          api.get("/licitaciones/with-fields?fields=id,creado_por,estado,fecha,fecha_adjudicada,tipo_cliente,total_sin_iva,total_con_iva"),
          api.get("/productos"),
        ]);
        if (!activo) return;
        setLics(Array.isArray(data) ? data : []);
        const m = {};
        (prods || []).forEach((p) => {
          const sku = String(p.sku || "").trim().toUpperCase();
          if (sku) m[sku] = Number(p.costo || 0);
        });
        setCostoBySku(m);
      } catch (e) {
        console.error("Error cargando base de comisiones:", e);
        if (activo) { setLics([]); setCostoBySku({}); }
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

  // Nombres de vendedores (perfiles) según los emails presentes.
  useEffect(() => {
    const emails = new Set();
    lics.forEach((l) => { const e = (l.creado_por || "").trim().toLowerCase(); if (e) emails.add(e); });
    actividades.forEach((a) => { const e = (a.user_email || "").trim().toLowerCase(); if (e) emails.add(e); });
    const arr = Array.from(emails);
    if (!arr.length) { setProfiles({}); return; }
    let activo = true;
    (async () => {
      try {
        const perfiles = await api.post("/usuarios/profiles/by-emails", { emails: arr });
        if (!activo) return;
        const m = {};
        (perfiles || []).forEach((p) => {
          const e = (p?.email || "").trim().toLowerCase();
          if (e) m[e] = (p?.nombre || "").trim();
        });
        setProfiles(m);
      } catch (e) {
        console.error("Error cargando perfiles:", e);
        if (activo) setProfiles({});
      }
    })();
    return () => { activo = false; };
  }, [lics, actividades]);

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

  // ── Agregación por vendedor ─────────────────────────────────────────────
  const filas = useMemo(() => {
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

    // Métricas derivadas + tramos + comisión.
    const out = [];
    map.forEach((r) => {
      const conversion = r.cotizaciones > 0 ? (r.adjudicadas / r.cotizaciones) * 100 : 0;
      const margenPct = r.margenVenta > 0 ? ((r.margenVenta - r.margenCosto) / r.margenVenta) * 100 : 0;

      const tVenta = pickTramo(tablas.venta, r.venta);
      const tProd = pickTramo(tablas.productividad, r.actividades);
      const tMargen = pickTramo(tablas.margen, margenPct);
      const tConv = pickTramo(tablas.conversion, conversion);

      const ventaFull = Number(tVenta?.monto || 0);
      const prodFull = Number(tProd?.monto || 0);
      const margenMult = Number(tMargen?.multiplicador || 0);
      const convMult = Number(tConv?.multiplicador || 0);
      const comision = (ventaFull + prodFull) * margenMult * convMult;
      const pctSobreVenta = r.venta > 0 ? (comision / r.venta) * 100 : null;

      // Se muestran solo vendedores con alguna actividad en el período.
      if (r.cotizaciones === 0 && r.adjudicadas === 0 && r.actividades === 0) return;

      out.push({
        ...r, conversion, margenPct,
        tVenta, tProd, tMargen, tConv,
        ventaFull, prodFull, margenMult, convMult, comision, pctSobreVenta,
      });
    });
    return out.sort((a, b) => b.comision - a.comision);
  }, [lics, itemsMargen, actividades, costoBySku, profiles, tablas, adjudicadasDelMes, mesActual, filtroTipo]);

  const totalComision = filas.reduce((acc, r) => acc + r.comision, 0);
  const totalVenta = filas.reduce((acc, r) => acc + r.venta, 0);

  const configLista = (tablas?.venta?.length || 0) > 0;

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
        <strong style={{ color: "var(--text)" }}>Cómo se calcula:</strong> Venta = Σ venta neta de las cotizaciones adjudicadas del mes ·
        Margen = (venta − costo)/venta de esas adjudicadas · Productividad = N° de actividades del mes en la bitácora ·
        Conversión = adjudicadas / cotizaciones ingresadas. Cada métrica se ubica en su tramo según la columna <strong>Desde</strong> de la Configuración.
        {" "}La productividad considera todas las actividades del vendedor (no distingue tipo de cliente).
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
      </div>

      {!configLista ? (
        <div className="surface" style={{ padding: "24px", color: "var(--text-muted)" }}>
          Primero define los tramos y umbrales en la pestaña <strong>Configuración</strong>.
        </div>
      ) : loading ? (
        <div className="surface" style={{ padding: "40px 24px", color: "var(--text-muted)" }}>Calculando comisiones…</div>
      ) : (
        <div className="surface" style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
            <table className="data-table" style={{ minWidth: 1080, width: "100%" }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left" }}>Vendedor</th>
                  <th style={{ textAlign: "right" }}>Venta neta</th>
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
                {filas.map((r) => (
                  <tr key={r.email}>
                    <td>
                      <div style={{ fontWeight: 600, color: "var(--text)" }}>{r.nombre}</div>
                      <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{r.email === "__sin__" ? "—" : r.email}</div>
                    </td>
                    <td style={{ textAlign: "right" }}>{fmtCLP(r.venta)}</td>
                    <td style={{ textAlign: "right", color: "var(--text-muted)" }} title={r.tVenta?.tramo || ""}>{fmtCLP(r.ventaFull)}</td>
                    <td style={{ textAlign: "right" }}>{fmtPct(r.margenPct)}</td>
                    <td style={{ textAlign: "right", color: "var(--text-muted)" }} title={r.tMargen?.tramo || ""}>{r.margenMult.toLocaleString("es-CL")}</td>
                    <td style={{ textAlign: "right" }}>{fmtNum(r.actividades)}</td>
                    <td style={{ textAlign: "right", color: "var(--text-muted)" }} title={r.tProd?.tramo || ""}>{fmtCLP(r.prodFull)}</td>
                    <td style={{ textAlign: "right" }}>{fmtPct(r.conversion)}</td>
                    <td style={{ textAlign: "right", color: "var(--text-muted)" }} title={r.tConv?.tramo || ""}>{r.convMult.toLocaleString("es-CL")}</td>
                    <td style={{ textAlign: "right", fontWeight: 700, color: "#15803d" }}>{fmtCLP(r.comision)}</td>
                    <td style={{ textAlign: "right", fontWeight: 600 }}>{r.pctSobreVenta == null ? "—" : fmtPct(r.pctSobreVenta)}</td>
                  </tr>
                ))}
                {filas.length === 0 && (
                  <tr>
                    <td colSpan={11} style={{ textAlign: "center", padding: "40px 0", color: "var(--text-muted)" }}>
                      No hay actividad de vendedores en el período seleccionado.
                    </td>
                  </tr>
                )}
              </tbody>
              {filas.length > 0 && (
                <tfoot>
                  <tr style={{ fontWeight: 700, borderTop: "2px solid var(--border)" }}>
                    <td>Total equipo</td>
                    <td style={{ textAlign: "right" }}>{fmtCLP(totalVenta)}</td>
                    <td colSpan={7}></td>
                    <td style={{ textAlign: "right", color: "#15803d" }}>{fmtCLP(totalComision)}</td>
                    <td style={{ textAlign: "right" }}>{totalVenta > 0 ? fmtPct((totalComision / totalVenta) * 100) : "—"}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
