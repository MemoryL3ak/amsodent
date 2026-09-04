// PanelParticular.jsx
// Sub-panel "Cliente Particular": embudo comercial basado en las MARCAS
// secuenciales y acumuladas por cliente particular (ver useEmbudoComercial):
//   Prospecto → Cliente Contactado → Clientes que Cotizan → Clientes que Compran
import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import useAuth from "../hooks/useAuth";
import MonthCalendarPicker from "../components/MonthCalendarPicker";
import { Users, PhoneCall, FileText, ShoppingCart, TrendingUp, Banknote } from "lucide-react";
import {
  fmtCLP, fmtNum, fmtPct, inicioMesISO, mesDe, toDateISO, addMesKey, labelMesCorto, labelMesLargo, clamp,
  Delta, KpiCard, FunnelShape, BarChart,
} from "../components/panel/panelKit";
import useEmbudoComercial, { ETAPAS_EMBUDO } from "../components/panel/useEmbudoComercial";
import { ModalEtapaEmbudo } from "../components/panel/EmbudoComercial";
import ModalMargenDesglose from "../components/panel/ModalMargenDesglose";

const ICONOS = { prospectos: Users, contactados: PhoneCall, cotizan: FileText, compran: ShoppingCart };

export default function PanelParticular() {
  const { rol, cargando } = useAuth();
  const rolNorm = (rol || "").toString().trim().toLowerCase();
  const esAdmin = rolNorm === "admin" || rolNorm === "administrador";
  const esJefatura = ["jefe_ventas", "jefe ventas", "jefe-ventas", "jefe de ventas", "jefe_ventas_especial"].includes(rolNorm);
  const puedeVer = esAdmin || esJefatura;

  const [periodo, setPeriodo] = useState(inicioMesISO());
  const [ejecutivo, setEjecutivo] = useState("");
  const [filtroMotivo, setFiltroMotivo] = useState("");
  const mesActual = mesDe(periodo);

  const { loading, emb, embPrev, evolucion, conv, opcionesEjecutivos, detalleEmbudo, nombresEjecutivos } = useEmbudoComercial(mesActual, ejecutivo);
  const [etapaSel, setEtapaSel] = useState(null); // etapa del embudo abierta en el modal de detalle

  // Cotizaciones perdidas de clientes particulares (con su motivo). No viene del
  // hook del embudo, así que se carga aquí y se filtra a tipo_cliente particular.
  const [perdidasRaw, setPerdidasRaw] = useState([]);
  useEffect(() => {
    if (cargando || !puedeVer) return;
    let activo = true;
    (async () => {
      try {
        const data = await api.get(
          "/licitaciones/with-fields?fields=id,id_licitacion,nombre,nombre_entidad,rut_entidad,fecha,estado,tipo_cliente,motivo_perdida,motivo_perdida_otro"
        );
        const rows = (data || []).filter(
          (l) => l.estado === "Perdida" && (l.tipo_cliente || "").toLowerCase().includes("particular"),
        );
        if (activo) setPerdidasRaw(rows);
      } catch (e) {
        console.error("Error cargando perdidas particulares:", e);
        if (activo) setPerdidasRaw([]);
      }
    })();
    return () => { activo = false; };
  }, [cargando, puedeVer]);

  // ── Margen de las ventas particulares del mes (pedido 2026-09-03) ────────
  // (venta − costo) / venta sobre los ítems de las cotizaciones particulares
  // ADJUDICADAS en el mes (1ª boleta/factura o efectivo). Mismo criterio que
  // el Panel de Gestión Comercial: costo congelado en el ítem, con fallback
  // al costo vigente del catálogo por SKU.
  const [licsPart, setLicsPart] = useState([]); // [{ id, creado_por }]
  const [adjDatePart, setAdjDatePart] = useState({}); // licId → fecha 1ª boleta/efectivo
  const [costoBySku, setCostoBySku] = useState({});
  const [margenMes, setMargenMes] = useState({ monto: 0, pct: 0, venta: 0 });
  const [margenPorLic, setMargenPorLic] = useState([]); // [{licId, venta, costo}] para el desglose
  const [margenOpen, setMargenOpen] = useState(false); // modal de desglose del margen

  useEffect(() => {
    if (cargando || !puedeVer) return;
    let activo = true;
    (async () => {
      try {
        const data = await api.get("/licitaciones/with-fields?fields=id,tipo_cliente,creado_por,id_licitacion,nombre_entidad,rut_entidad");
        const rows = (data || []).filter((l) => (l.tipo_cliente || "").toLowerCase().includes("particular"));
        const ids = rows.map((l) => Number(l.id)).filter(Boolean);
        const adj = {};
        if (ids.length) {
          const docs = await api.post("/licitaciones/documentos/filter", {
            filter: { licitacion_ids: ids, tipo: ["factura_boleta", "efectivo"] },
            fields: "licitacion_id,tipo,fecha_oc,created_at",
          });
          (docs || []).forEach((d) => {
            const lid = Number(d.licitacion_id);
            if (!lid) return;
            const f = toDateISO(d.fecha_oc) || toDateISO(d.created_at);
            if (f && (!adj[lid] || f < adj[lid])) adj[lid] = f;
          });
        }
        const prods = await api.get("/productos");
        const costos = {};
        (prods || []).forEach((p) => {
          const sku = String(p.sku || "").trim().toUpperCase();
          if (sku) costos[sku] = Number(p.costo || 0);
        });
        if (!activo) return;
        setLicsPart(rows);
        setAdjDatePart(adj);
        setCostoBySku(costos);
      } catch (e) {
        console.error("Error cargando base del margen particular:", e);
        if (activo) { setLicsPart([]); setAdjDatePart({}); setCostoBySku({}); }
      }
    })();
    return () => { activo = false; };
  }, [cargando, puedeVer]);

  useEffect(() => {
    if (cargando || !puedeVer) return;
    const ej = (ejecutivo || "").trim().toLowerCase();
    const idsMes = licsPart
      .filter((l) => mesDe(adjDatePart[l.id]) === mesActual)
      .filter((l) => !ej || (l.creado_por || "").trim().toLowerCase() === ej)
      .map((l) => Number(l.id))
      .filter(Boolean);
    if (!idsMes.length) { setMargenMes({ monto: 0, pct: 0, venta: 0 }); setMargenPorLic([]); return; }
    let activo = true;
    api.post("/licitaciones/items/filter", {
      licitacion_ids: idsMes,
      fields: "licitacion_id,total,cantidad,sku,costo",
    })
      .then((items) => {
        if (!activo) return;
        let venta = 0, costo = 0;
        const porLic = {}; // licId → { venta, costo } (desglose del margen)
        (items || []).forEach((it) => {
          const v = Number(it.total || 0);
          venta += v;
          const sku = String(it.sku || "").trim().toUpperCase();
          const costoUnit = Number(it.costo) > 0 ? Number(it.costo) : (costoBySku[sku] || 0);
          const c = costoUnit * (Number(it.cantidad) || 0);
          costo += c;
          const lid = Number(it.licitacion_id);
          if (lid) {
            const e = (porLic[lid] = porLic[lid] || { venta: 0, costo: 0 });
            e.venta += v;
            e.costo += c;
          }
        });
        const monto = Math.round(venta - costo);
        setMargenMes({ monto, pct: venta > 0 ? (monto / venta) * 100 : 0, venta: Math.round(venta) });
        setMargenPorLic(Object.entries(porLic).map(([licId, v]) => ({ licId: Number(licId), ...v })));
      })
      .catch(() => { if (activo) { setMargenMes({ monto: 0, pct: 0, venta: 0 }); setMargenPorLic([]); } });
    return () => { activo = false; };
  }, [cargando, puedeVer, licsPart, adjDatePart, costoBySku, mesActual, ejecutivo]);

  // Desglose del margen (mismo criterio que el Panel de Gestión Comercial).
  // Sin pestaña "por tipo": aquí todo es cliente particular.
  const margenDesglose = useMemo(() => {
    const licById = new Map(licsPart.map((l) => [Number(l.id), l]));
    const filas = margenPorLic.map((r) => {
      const l = licById.get(r.licId) || {};
      const email = (l.creado_por || "").trim().toLowerCase();
      const monto = r.venta - r.costo;
      return {
        licId: r.licId,
        codigo: l.id_licitacion || `Cot. ${r.licId}`,
        cliente: l.nombre_entidad || l.rut_entidad || "—",
        vendedor: nombresEjecutivos[email] || email || "Sin vendedor",
        venta: r.venta,
        costo: r.costo,
        monto,
        pct: r.venta > 0 ? (monto / r.venta) * 100 : 0,
        sinCosto: r.venta > 0 && !(r.costo > 0),
      };
    }).sort((a, b) => b.venta - a.venta);
    const porVendedor = (() => {
      const m = {};
      filas.forEach((f) => {
        const k = f.vendedor || "—";
        const e = (m[k] = m[k] || { label: k, venta: 0, costo: 0, cotizaciones: 0 });
        e.venta += f.venta;
        e.costo += f.costo;
        e.cotizaciones += 1;
      });
      return Object.values(m)
        .map((e) => ({ ...e, monto: e.venta - e.costo, pct: e.venta > 0 ? ((e.venta - e.costo) / e.venta) * 100 : 0 }))
        .sort((a, b) => b.venta - a.venta);
    })();
    return { filas, porVendedor, porTipo: [] };
  }, [margenPorLic, licsPart, nombresEjecutivos]);

  // Perdidas del mes (por fecha de creación) agrupadas por motivo + detalle.
  const perdidas = useMemo(() => {
    const motivoCount = {};
    const filas = [];
    perdidasRaw.forEach((l) => {
      if (mesDe(l.fecha) !== mesActual) return;
      const motivo = l.motivo_perdida === "Otro" ? (l.motivo_perdida_otro || "Otro") : (l.motivo_perdida || "Sin motivo");
      motivoCount[motivo] = (motivoCount[motivo] || 0) + 1;
      filas.push({ id: l.id, codigo: l.id_licitacion || l.nombre || `Cot. ${l.id}`, cliente: l.nombre_entidad || l.rut_entidad || "—", motivo });
    });
    const items = Object.entries(motivoCount).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
    return { items, filas: filas.sort((a, b) => String(a.codigo).localeCompare(String(b.codigo))), total: filas.length };
  }, [perdidasRaw, mesActual]);

  // Evolución de perdidas (6 meses) para el gráfico de barras del detalle.
  const seriePerdidas6 = useMemo(() => {
    const arr = [];
    for (let i = 5; i >= 0; i--) {
      const k = addMesKey(mesActual, -i);
      arr.push({ mes: k, label: labelMesCorto(k), perdidas: perdidasRaw.filter((l) => mesDe(l.fecha) === k).length });
    }
    return arr;
  }, [perdidasRaw, mesActual]);
  const maxPerdidas6 = Math.max(1, ...seriePerdidas6.map((s) => s.perdidas));

  // Detalle filtrado por motivo.
  const filasPerdidas = useMemo(
    () => (filtroMotivo ? perdidas.filas.filter((f) => f.motivo === filtroMotivo) : perdidas.filas),
    [perdidas.filas, filtroMotivo]
  );

  const stages = ETAPAS_EMBUDO.map((e) => ({ key: e.key, label: e.label, color: e.color, value: emb[e.key] }));
  const maxStack = Math.max(1, ...evolucion.map((e) => e.prospectos + e.contactados + e.cotizan + e.compran));

  if (!cargando && !puedeVer) {
    return (
      <div className="page">
        <div className="surface"><div className="surface-body" style={{ color: "var(--danger)" }}>
          Acceso restringido: este panel es para administración y jefatura de ventas.
        </div></div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-header" style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div>
          <h1 className="page-title">Embudo Comercial — Cliente Particular</h1>
          <p className="page-subtitle">Marcas secuenciales acumuladas por cliente · {labelMesLargo(mesActual)}</p>
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div className="field" style={{ margin: 0 }}>
            <label className="field-label">Ejecutivo</label>
            <select className="input" value={ejecutivo} onChange={(e) => setEjecutivo(e.target.value)} style={{ minWidth: 180 }}>
              <option value="">Todos</option>
              {opcionesEjecutivos.map((op) => (
                <option key={op.value} value={op.value}>{op.label}</option>
              ))}
            </select>
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label className="field-label">Mes</label>
            <MonthCalendarPicker value={periodo} onChange={setPeriodo} />
          </div>
        </div>
      </div>

      {loading ? (
        <div className="surface" style={{ padding: "40px 24px", color: "var(--text-muted)" }}>Cargando embudo…</div>
      ) : (
        <>
          {/* KPIs por etapa */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 14, marginBottom: 22 }}>
            {ETAPAS_EMBUDO.map((et) => (
              <KpiCard
                key={et.key}
                icon={ICONOS[et.key]}
                color={et.color}
                label={et.label}
                value={fmtNum(emb[et.key])}
                delta={<Delta actual={emb[et.key]} prev={embPrev[et.key]} />}
              />
            ))}
            <KpiCard icon={ShoppingCart} color="#0e7490" label="Venta Total" sub="Ventas particulares del mes (neto)" value={fmtCLP(margenMes.venta)} delta={null} />
            <div onClick={() => setMargenOpen(true)} style={{ cursor: "pointer" }} title="Ver desglose del margen por cotización y vendedor">
              <KpiCard icon={TrendingUp} color="#7c3aed" label="Margen %" sub="Ventas particulares del mes · clic para desglose" value={fmtPct(margenMes.pct)} delta={null} />
            </div>
            {!esJefatura && (
              <div onClick={() => setMargenOpen(true)} style={{ cursor: "pointer" }} title="Ver desglose del margen por cotización y vendedor">
                <KpiCard icon={Banknote} color="#0d9488" label="Margen $" sub="Ventas particulares del mes · clic para desglose" value={fmtCLP(margenMes.monto)} delta={null} />
              </div>
            )}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 16, marginBottom: 16 }}>
            {/* Embudo (forma) */}
            <div className="surface" style={{ padding: 18, display: "flex", flexDirection: "column", justifyContent: "center" }}>
              <h3 className="surface-title" style={{ marginBottom: 16 }}>Embudo comercial ({labelMesLargo(mesActual).toLowerCase()})</h3>
              <FunnelShape stages={stages} onStageClick={setEtapaSel} />
              <p style={{ fontSize: 11, color: "var(--text-muted)", textAlign: "center", marginTop: 8, marginBottom: 0 }}>
                Haz clic en una etapa para ver el detalle de actividades.
              </p>
            </div>

            {/* Evolución del embudo (6 meses) — barras apiladas de nuevos logros */}
            <div className="surface" style={{ padding: 18 }}>
              <h3 className="surface-title" style={{ marginBottom: 14 }}>Evolución del embudo (6 meses)</h3>
              <div style={{ display: "flex", alignItems: "flex-end", gap: 10, height: 170, padding: "0 2px" }}>
                {evolucion.map((e) => {
                  const total = e.prospectos + e.contactados + e.cotizan + e.compran;
                  const hTot = clamp((total / maxStack) * 100, total > 0 ? 4 : 0, 100);
                  const seg = (val) => (total > 0 ? (val / total) * 100 : 0);
                  return (
                    <div key={e.mes} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", height: "100%" }} title={`Prospectos ${e.prospectos} · Contactados ${e.contactados} · Cotizan ${e.cotizan} · Compran ${e.compran}`}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: total > 0 ? "var(--text)" : "var(--text-muted)", marginBottom: 2 }}>
                        {fmtNum(total)}
                      </div>
                      <div style={{ width: "62%", maxWidth: 36, height: `${hTot}%`, display: "flex", flexDirection: "column", justifyContent: "flex-end", borderRadius: "5px 5px 0 0", overflow: "hidden" }}>
                        <div style={{ height: `${seg(e.prospectos)}%`, background: "#1e40af" }} />
                        <div style={{ height: `${seg(e.contactados)}%`, background: "#0d9488" }} />
                        <div style={{ height: `${seg(e.cotizan)}%`, background: "#16a34a" }} />
                        <div style={{ height: `${seg(e.compran)}%`, background: "#f59e0b" }} />
                      </div>
                    </div>
                  );
                })}
              </div>
              <div style={{ display: "flex", gap: 10, marginTop: 6 }}>
                {evolucion.map((e) => <span key={e.mes} style={{ flex: 1, fontSize: 10.5, color: "var(--text-muted)", textAlign: "center" }}>{e.label}</span>)}
              </div>
              <div style={{ display: "flex", gap: 14, justifyContent: "center", marginTop: 10, flexWrap: "wrap" }}>
                {[["Prospectos", "#1e40af"], ["Contactados", "#0d9488"], ["Cotizan", "#16a34a"], ["Compran", "#f59e0b"]].map(([t, c]) => (
                  <span key={t} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, color: "var(--text-muted)" }}>
                    <span style={{ width: 10, height: 10, borderRadius: 2, background: c }} /> {t}
                  </span>
                ))}
              </div>
            </div>

            {/* Conversión por etapa */}
            <div className="surface" style={{ padding: 18 }}>
              <h3 className="surface-title" style={{ marginBottom: 14 }}>Conversión por etapa ({labelMesLargo(mesActual).toLowerCase()})</h3>
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                {[
                  { t: "Prospectos → Contactados", v: conv.e1, c: "#1e40af" },
                  { t: "Contactados → Cotizan", v: conv.e2, c: "#0d9488" },
                  { t: "Cotizan → Compran", v: conv.e3, c: "#16a34a" },
                  { t: "Conversión total del embudo", v: conv.total, c: "#f59e0b" },
                ].map((r) => (
                  <div key={r.t}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
                      <span style={{ color: "var(--text)" }}>{r.t}</span>
                      <strong style={{ color: r.c }}>{fmtPct(r.v)}</strong>
                    </div>
                    <div style={{ height: 12, borderRadius: 6, background: "var(--bg)", overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${clamp(r.v, 0, 100)}%`, background: r.c, borderRadius: 6 }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Cotizaciones perdidas del mes. El KPI «Perdidas por motivo» se
              quitó a pedido (2026-08-27); el desglose por motivo sigue en el
              detalle de al lado (con su filtro por motivo). */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 16, marginBottom: 16 }}>
            <div className="surface" style={{ padding: 18 }}>
              <h3 className="surface-title" style={{ marginBottom: 14 }}>Perdidas (6 meses)</h3>
              <BarChart data={seriePerdidas6} max={maxPerdidas6} valueKey="perdidas" color="#dc2626" fmt={fmtNum} />
            </div>

            <div className="surface" style={{ padding: 18, display: "flex", flexDirection: "column" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, gap: 8, flexWrap: "wrap" }}>
                <h3 className="surface-title" style={{ margin: 0 }}>Detalle de perdidas ({labelMesLargo(mesActual).toLowerCase()})</h3>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <select className="input" value={filtroMotivo} onChange={(e) => setFiltroMotivo(e.target.value)} style={{ fontSize: 12, height: 30, padding: "0 8px", maxWidth: 170 }}>
                    <option value="">Todos los motivos</option>
                    {perdidas.items.map((it) => (
                      <option key={it.label} value={it.label}>{it.label}</option>
                    ))}
                  </select>
                  <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{filasPerdidas.length} cotización{filasPerdidas.length === 1 ? "" : "es"}</span>
                </div>
              </div>
              <div style={{ overflowY: "auto", maxHeight: 300 }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, tableLayout: "fixed" }}>
                  <colgroup>
                    <col style={{ width: "30%" }} />
                    <col style={{ width: "38%" }} />
                    <col style={{ width: "32%" }} />
                  </colgroup>
                  <thead>
                    <tr style={{ color: "var(--text-muted)", textAlign: "left" }}>
                      <th style={{ padding: "6px 8px", position: "sticky", top: 0, background: "var(--surface)", borderBottom: "1px solid var(--border)" }}>Cotización</th>
                      <th style={{ padding: "6px 8px", position: "sticky", top: 0, background: "var(--surface)", borderBottom: "1px solid var(--border)" }}>Cliente</th>
                      <th style={{ padding: "6px 8px", position: "sticky", top: 0, background: "var(--surface)", borderBottom: "1px solid var(--border)" }}>Motivo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filasPerdidas.length === 0 ? (
                      <tr><td colSpan={3} style={{ padding: "14px 8px", color: "var(--text-muted)" }}>Sin cotizaciones perdidas en el mes.</td></tr>
                    ) : filasPerdidas.map((f) => (
                      <tr key={f.id} style={{ borderBottom: "1px solid var(--border)" }}>
                        <td style={{ padding: "6px 8px", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={f.codigo}>{f.codigo}</td>
                        <td style={{ padding: "6px 8px", color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={f.cliente}>{f.cliente}</td>
                        <td style={{ padding: "6px 8px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={f.motivo}>
                          <span style={{ fontSize: 10.5, fontWeight: 700, padding: "2px 7px", borderRadius: 999, whiteSpace: "nowrap", background: "#fee2e2", color: "#b91c1c" }}>{f.motivo}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {margenOpen && (
            <ModalMargenDesglose
              desglose={margenDesglose}
              margen={margenMes}
              mostrarMonto={!esJefatura}
              conTipo={false}
              onCerrar={() => setMargenOpen(false)}
            />
          )}

          {etapaSel && (
            <ModalEtapaEmbudo
              etapa={etapaSel}
              items={detalleEmbudo[etapaSel.key] || []}
              nombresEjecutivos={nombresEjecutivos}
              onClose={() => setEtapaSel(null)}
            />
          )}

          <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
            * Solo clientes particulares. Marcas secuenciales y acumuladas: un cliente pasa a Contactado solo si ya es Prospecto, a Cotiza solo si ya es Contactado, y a Compra solo si ya Cotiza. Prospecto = motivo Mapeo / Visita Espontánea / Referido; Contactado = tipo Llamada / Visita / Reunión / Correo; Cotiza = motivo "Presupuesto"; Compra = la cotización asociada pasa a "Adjudicada". Acumulado hasta el fin del mes seleccionado.
          </p>
        </>
      )}
    </div>
  );
}
