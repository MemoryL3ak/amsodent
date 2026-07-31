// PanelPublica.jsx
// Sub-panel "Entidad Pública": indicadores de licitación y adjudicación para
// clientes del sector público. Deriva todo desde las licitaciones (tipo_cliente
// público) y sus documentos, igual que el Panel de Indicadores.
import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import useAuth from "../hooks/useAuth";
import MonthCalendarPicker from "../components/MonthCalendarPicker";
import {
  FileText, ClipboardCheck, Target, Trophy, Banknote, PieChart, GitBranch,
} from "lucide-react";
import {
  fmtCLP, fmtNum, fmtPct, inicioMesISO, mesDe, toDateISO, addMesKey,
  labelMesCorto, labelMesLargo, Delta, KpiCard, LineChart, BarChart, HBarList,
} from "../components/panel/panelKit";

// Estados que NO cuentan como licitación participada.
const ESTADOS_NO_PARTICIPA = ["Descartada", "Cancelada", "Pendiente Aprobación"];

export default function PanelPublica() {
  const { rol, cargando } = useAuth();
  const rolNorm = (rol || "").toString().trim().toLowerCase();
  const esAdmin = rolNorm === "admin" || rolNorm === "administrador";
  const esJefatura = ["jefe_ventas", "jefe ventas", "jefe-ventas", "jefe de ventas", "jefe_ventas_especial"].includes(rolNorm);
  const puedeVer = esAdmin || esJefatura;

  const [periodo, setPeriodo] = useState(inicioMesISO());
  const [loading, setLoading] = useState(true);
  const [lics, setLics] = useState([]);
  const [adjDateByLic, setAdjDateByLic] = useState({});
  const [ocByLic, setOcByLic] = useState({}); // { licId: monto OC (adjudicado) }
  const [filtroMotivo, setFiltroMotivo] = useState(""); // detalle perdidas/descartadas
  const [skusConEquiv, setSkusConEquiv] = useState(new Set()); // SKUs con equivalencias válidas
  const [itemsPorLicMes, setItemsPorLicMes] = useState({}); // { licId: [sku, …] } — madres del mes

  const mesActual = mesDe(periodo);
  const mesPrev = addMesKey(mesActual, -1);
  const esPublica = (l) => !(l?.tipo_cliente || "").toLowerCase().includes("particular");

  // Carga: licitaciones públicas + fecha de adjudicación (1ª OC) y monto OC.
  useEffect(() => {
    if (cargando || !puedeVer) { if (!cargando) setLoading(false); return; }
    let activo = true;
    (async () => {
      setLoading(true);
      try {
        const data = await api.get(
          "/licitaciones/with-fields?fields=id,id_licitacion,nombre,nombre_entidad,rut_entidad,fecha,fecha_adjudicada,estado,total_con_iva,total_sin_iva,tipo_compra,tipo_cliente,region,motivo_perdida,motivo_perdida_otro,motivo_descarte,comentario_descarte,madre_id"
        );
        const rows = (data || []).filter(esPublica);
        const ids = rows.map((l) => Number(l.id)).filter(Boolean);
        const adj = {};
        const oc = {};
        if (ids.length) {
          const docs = await api.post("/licitaciones/documentos/filter", {
            filter: { licitacion_ids: ids, tipo: ["orden_compra"] },
            fields: "licitacion_id,tipo,monto,fecha_oc,created_at",
          });
          (docs || []).forEach((d) => {
            const lid = Number(d.licitacion_id);
            if (!lid) return;
            oc[lid] = (oc[lid] || 0) + Number(d.monto || 0);
            const f = toDateISO(d.fecha_oc) || toDateISO(d.created_at);
            if (f && (!adj[lid] || f < adj[lid])) adj[lid] = f;
          });
        }
        // Catálogo: SKUs con al menos una equivalencia válida (existente en el
        // catálogo). Para el indicador de oportunidades de equivalencias.
        try {
          const prods = await api.get("/productos");
          const porSku = new Map();
          (prods || []).forEach((p) => {
            const sku = String(p.sku || "").trim().toUpperCase();
            if (sku) porSku.set(sku, p);
          });
          const conEquiv = new Set();
          porSku.forEach((p, sku) => {
            const eqs = [p.equivalente_1, p.equivalente_2, p.equivalente_3]
              .map((s) => String(s || "").trim().toUpperCase())
              .filter((s) => s && s !== sku && porSku.has(s));
            if (eqs.length) conEquiv.add(sku);
          });
          if (activo) setSkusConEquiv(conEquiv);
        } catch {
          if (activo) setSkusConEquiv(new Set());
        }
        if (!activo) return;
        setLics(rows);
        setAdjDateByLic(adj);
        setOcByLic(oc);
      } catch (e) {
        console.error("Error cargando panel público:", e);
        if (activo) { setLics([]); setAdjDateByLic({}); setOcByLic({}); }
      } finally {
        if (activo) setLoading(false);
      }
    })();
    return () => { activo = false; };
  }, [cargando, puedeVer]);

  // Ítems (SKU) de las cotizaciones MADRE del mes — para detectar cuáles tenían
  // posibilidad de generar una cotización alternativa por equivalencias.
  useEffect(() => {
    if (cargando || !puedeVer) return;
    const madresMes = lics.filter((l) => mesDe(l.fecha) === mesActual && !l.madre_id);
    const ids = madresMes.map((l) => Number(l.id)).filter(Boolean);
    if (!ids.length) { setItemsPorLicMes({}); return; }
    let activo = true;
    api.post("/licitaciones/items/filter", { licitacion_ids: ids, fields: "licitacion_id,sku" })
      .then((items) => {
        if (!activo) return;
        const m = {};
        (items || []).forEach((it) => {
          const lid = Number(it.licitacion_id);
          const sku = String(it.sku || "").trim().toUpperCase();
          if (!lid || !sku) return;
          if (!m[lid]) m[lid] = [];
          m[lid].push(sku);
        });
        setItemsPorLicMes(m);
      })
      .catch(() => { if (activo) setItemsPorLicMes({}); });
    return () => { activo = false; };
  }, [cargando, puedeVer, lics, mesActual]);

  // Fecha de adjudicación = SIEMPRE la fecha de la primera OC cargada. Sin OC la
  // licitación NO se considera adjudicada, aunque tenga estado "Adjudicada" o una
  // fecha_adjudicada antigua (mismo criterio que el Panel de Gestión Comercial).
  const fechaAdj = (l) => adjDateByLic[l.id] || null;
  const esAdjudicada = (l) => Boolean(adjDateByLic[l.id]);
  const montoAdjudicado = (l) => {
    const oc = ocByLic[l.id] || 0;
    if (oc > 0) return oc;
    return Number(l.total_sin_iva || 0) || Math.round(Number(l.total_con_iva || 0) / 1.19);
  };

  // Métricas de un mes ('YYYY-MM').
  const metricasMes = useMemo(() => (mesKey) => {
    let publicadas = 0, participadas = 0, adjudicadas = 0, montoAdj = 0;
    lics.forEach((l) => {
      if (mesDe(l.fecha) === mesKey) {
        publicadas++;
        if (!ESTADOS_NO_PARTICIPA.includes(l.estado)) participadas++;
      }
      if (mesDe(fechaAdj(l)) === mesKey && esAdjudicada(l)) {
        adjudicadas++;
        montoAdj += montoAdjudicado(l);
      }
    });
    const tasaAdj = participadas > 0 ? (adjudicadas / participadas) * 100 : 0;
    const participacion = publicadas > 0 ? (participadas / publicadas) * 100 : 0;
    return { publicadas, participadas, adjudicadas, montoAdj, tasaAdj, participacion };
  }, [lics, adjDateByLic, ocByLic]);

  const m = useMemo(() => metricasMes(mesActual), [metricasMes, mesActual]);
  const mPrev = useMemo(() => metricasMes(mesPrev), [metricasMes, mesPrev]);

  // Evolución 6 meses (adjudicaciones y montos).
  const serie6 = useMemo(() => {
    const arr = [];
    for (let i = 5; i >= 0; i--) {
      const k = addMesKey(mesActual, -i);
      const mm = metricasMes(k);
      arr.push({ mes: k, label: labelMesCorto(k), adjudicadas: mm.adjudicadas, monto: mm.montoAdj });
    }
    return arr;
  }, [metricasMes, mesActual]);

  // Detalle de adjudicaciones del mes (+ licitaciones del mes aún en evaluación).
  const detalleMes = useMemo(() => {
    const filas = [];
    lics.forEach((l) => {
      const adjEnMes = mesDe(fechaAdj(l)) === mesActual && esAdjudicada(l);
      const creadaEnMes = mesDe(l.fecha) === mesActual;
      if (!adjEnMes && !creadaEnMes) return;
      filas.push({
        id: l.id,
        codigo: l.id_licitacion || l.nombre || `Lic. ${l.id}`,
        entidad: l.nombre_entidad || l.rut_entidad || "—",
        estado: adjEnMes ? "Adjudicada" : (l.estado || "En evaluación"),
        adjudicada: adjEnMes,
        monto: adjEnMes ? montoAdjudicado(l) : 0,
      });
    });
    return filas.sort((a, b) => Number(b.adjudicada) - Number(a.adjudicada) || b.monto - a.monto);
  }, [lics, adjDateByLic, ocByLic, mesActual]);

  // Licitaciones descartadas y perdidas del mes (por fecha de creación), con su
  // motivo. Descartada → motivo_descarte (+ comentario); Perdida → motivo_perdida
  // (o motivo_perdida_otro cuando el motivo es "Otro").
  const bajas = useMemo(() => {
    const perdMotivo = {};
    const descMotivo = {};
    const filas = [];
    lics.forEach((l) => {
      if (mesDe(l.fecha) !== mesActual) return;
      const codigo = l.id_licitacion || l.nombre || `Lic. ${l.id}`;
      const entidad = l.nombre_entidad || l.rut_entidad || "—";
      if (l.estado === "Perdida") {
        const motivo = l.motivo_perdida === "Otro" ? (l.motivo_perdida_otro || "Otro") : (l.motivo_perdida || "Sin motivo");
        perdMotivo[motivo] = (perdMotivo[motivo] || 0) + 1;
        filas.push({ id: l.id, codigo, entidad, tipo: "Perdida", motivo, detalle: "" });
      } else if (l.estado === "Descartada") {
        const motivo = l.motivo_descarte || "Sin motivo";
        descMotivo[motivo] = (descMotivo[motivo] || 0) + 1;
        filas.push({ id: l.id, codigo, entidad, tipo: "Descartada", motivo, detalle: l.comentario_descarte || "" });
      }
    });
    const toItems = (obj) => Object.entries(obj).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
    return {
      perdidas: toItems(perdMotivo),
      descartadas: toItems(descMotivo),
      filas: filas.sort((a, b) => a.tipo.localeCompare(b.tipo) || String(a.codigo).localeCompare(String(b.codigo))),
      totalPerdidas: filas.filter((f) => f.tipo === "Perdida").length,
      totalDescartadas: filas.filter((f) => f.tipo === "Descartada").length,
    };
  }, [lics, mesActual]);

  const maxAdj = Math.max(1, ...serie6.map((s) => s.adjudicadas));
  const maxMonto = Math.max(1, ...serie6.map((s) => s.monto));

  // Evolución de perdidas y descartadas (6 meses, por fecha de creación).
  const serieBajas6 = useMemo(() => {
    const arr = [];
    for (let i = 5; i >= 0; i--) {
      const k = addMesKey(mesActual, -i);
      let perdidas = 0, descartadas = 0;
      lics.forEach((l) => {
        if (mesDe(l.fecha) !== k) return;
        if (l.estado === "Perdida") perdidas++;
        else if (l.estado === "Descartada") descartadas++;
      });
      arr.push({ mes: k, label: labelMesCorto(k), perdidas, descartadas });
    }
    return arr;
  }, [lics, mesActual]);
  const maxBajas6 = Math.max(1, ...serieBajas6.map((s) => Math.max(s.perdidas, s.descartadas)));

  // Detalle de perdidas/descartadas filtrado por motivo.
  const motivosDetalle = useMemo(
    () => Array.from(new Set(bajas.filas.map((f) => f.motivo))).sort((a, b) => a.localeCompare(b)),
    [bajas.filas]
  );
  const filasBajas = useMemo(
    () => (filtroMotivo ? bajas.filas.filter((f) => f.motivo === filtroMotivo) : bajas.filas),
    [bajas.filas, filtroMotivo]
  );

  // Oportunidades de equivalencias del mes: cotizaciones MADRE cuyos ítems
  // tienen algún SKU con equivalencia registrada, vs las que efectivamente
  // generaron una cotización alternativa (hija).
  const equivalencias = useMemo(() => {
    const hijasPorMadre = new Map();
    lics.forEach((l) => {
      const mid = Number(l.madre_id || 0);
      if (!mid) return;
      if (!hijasPorMadre.has(mid)) hijasPorMadre.set(mid, []);
      hijasPorMadre.get(mid).push(l);
    });
    const filas = [];
    let conPosibilidad = 0, aprovechadas = 0;
    lics.forEach((l) => {
      if (mesDe(l.fecha) !== mesActual || l.madre_id) return;
      const skus = itemsPorLicMes[Number(l.id)] || [];
      const tiene = skus.some((sku) => skusConEquiv.has(sku));
      if (!tiene) return;
      conPosibilidad++;
      const hijas = hijasPorMadre.get(Number(l.id)) || [];
      if (hijas.length) aprovechadas++;
      filas.push({
        id: l.id,
        codigo: l.id_licitacion || l.nombre || `Lic. ${l.id}`,
        entidad: l.nombre_entidad || l.rut_entidad || "—",
        hijas: hijas.length,
        skusEquiv: skus.filter((sku) => skusConEquiv.has(sku)).length,
      });
    });
    return {
      conPosibilidad,
      aprovechadas,
      sinAprovechar: conPosibilidad - aprovechadas,
      tasa: conPosibilidad > 0 ? (aprovechadas / conPosibilidad) * 100 : 0,
      filas: filas.sort((a, b) => Number(b.hijas > 0) - Number(a.hijas > 0) || String(a.codigo).localeCompare(String(b.codigo))),
    };
  }, [lics, itemsPorLicMes, skusConEquiv, mesActual]);

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
          <h1 className="page-title">Panel de Indicadores — Entidad Pública</h1>
          <p className="page-subtitle">Licitaciones y Adjudicaciones · {labelMesLargo(mesActual)}</p>
        </div>
        <div className="field" style={{ margin: 0 }}>
          <label className="field-label">Mes</label>
          <MonthCalendarPicker value={periodo} onChange={setPeriodo} />
        </div>
      </div>

      {loading ? (
        <div className="surface" style={{ padding: "40px 24px", color: "var(--text-muted)" }}>Cargando indicadores…</div>
      ) : (
        <>
          {/* KPIs */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 14, marginBottom: 22 }}>
            <KpiCard icon={FileText} color="#0e7490" label="Licitaciones Publicadas" sub="Registradas en el mes" value={fmtNum(m.publicadas)} delta={<Delta actual={m.publicadas} prev={mPrev.publicadas} />} />
            <KpiCard icon={ClipboardCheck} color="#6366f1" label="Licitaciones Participadas" sub="Excl. descartadas y pend. aprobación" value={fmtNum(m.participadas)} delta={<Delta actual={m.participadas} prev={mPrev.participadas} />} />
            <KpiCard icon={Target} color="#16a34a" label="Adjudicaciones Obtenidas" sub="Cierres del mes" value={fmtNum(m.adjudicadas)} delta={<Delta actual={m.adjudicadas} prev={mPrev.adjudicadas} />} />
            <KpiCard icon={Trophy} color="#b45309" label="Tasa de Adjudicación" sub="Adjudicadas / participadas" value={fmtPct(m.tasaAdj)} delta={<Delta actual={m.tasaAdj} prev={mPrev.tasaAdj} unidadPp />} />
            <KpiCard icon={Banknote} color="#15803d" label="Monto Adjudicado" sub="Del mes · órdenes de compra" value={fmtCLP(m.montoAdj)} delta={<Delta actual={m.montoAdj} prev={mPrev.montoAdj} />} />
            <KpiCard icon={PieChart} color="#0ea5e9" label="Participación en Licitaciones" sub="Participadas / publicadas" value={fmtPct(m.participacion)} delta={<Delta actual={m.participacion} prev={mPrev.participacion} unidadPp />} />
          </div>

          {/* Charts — el detalle de adjudicaciones ocupa más ancho que los gráficos. */}
          <div className="panel-publica-grid">
            <div className="surface" style={{ padding: 18 }}>
              <h3 className="surface-title" style={{ marginBottom: 14 }}>Evolución de adjudicaciones (6 meses)</h3>
              <LineChart data={serie6} max={maxAdj} valueKey="adjudicadas" color="#28aeb1" />
            </div>

            <div className="surface" style={{ padding: 18, display: "flex", flexDirection: "column" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 14, gap: 8 }}>
                <h3 className="surface-title" style={{ margin: 0 }}>Detalle de adjudicaciones ({labelMesLargo(mesActual).toLowerCase()})</h3>
                <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{detalleMes.length} licitación{detalleMes.length === 1 ? "" : "es"}</span>
              </div>
              {/* tableLayout fijo + ellipsis: las 4 columnas caben sin scroll horizontal. */}
              <div style={{ overflowY: "auto", maxHeight: 300 }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, tableLayout: "fixed" }}>
                  <colgroup>
                    <col style={{ width: "26%" }} />
                    <col style={{ width: "40%" }} />
                    <col style={{ width: "16%" }} />
                    <col style={{ width: "18%" }} />
                  </colgroup>
                  <thead>
                    <tr style={{ color: "var(--text-muted)", textAlign: "left" }}>
                      <th style={{ padding: "6px 8px", position: "sticky", top: 0, background: "var(--surface)", borderBottom: "1px solid var(--border)" }}>Licitación</th>
                      <th style={{ padding: "6px 8px", position: "sticky", top: 0, background: "var(--surface)", borderBottom: "1px solid var(--border)" }}>Entidad</th>
                      <th style={{ padding: "6px 8px", position: "sticky", top: 0, background: "var(--surface)", borderBottom: "1px solid var(--border)" }}>Estado</th>
                      <th style={{ padding: "6px 8px", textAlign: "right", position: "sticky", top: 0, background: "var(--surface)", borderBottom: "1px solid var(--border)" }}>Monto</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detalleMes.length === 0 ? (
                      <tr><td colSpan={4} style={{ padding: "14px 8px", color: "var(--text-muted)" }}>Sin movimientos en el mes.</td></tr>
                    ) : detalleMes.map((f) => (
                      <tr key={f.id} style={{ borderBottom: "1px solid var(--border)" }}>
                        <td style={{ padding: "6px 8px", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={f.codigo}>{f.codigo}</td>
                        <td style={{ padding: "6px 8px", color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={f.entidad}>{f.entidad}</td>
                        <td style={{ padding: "6px 8px" }}>
                          <span style={{
                            fontSize: 10.5, fontWeight: 700, padding: "2px 7px", borderRadius: 999, whiteSpace: "nowrap",
                            background: f.adjudicada ? "#dcfce7" : "#fef9c3",
                            color: f.adjudicada ? "#15803d" : "#a16207",
                          }}>{f.estado}</span>
                        </td>
                        <td style={{ padding: "6px 8px", textAlign: "right", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={f.adjudicada ? fmtCLP(f.monto) : ""}>{f.adjudicada ? fmtCLP(f.monto) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="surface" style={{ padding: 18 }}>
              <h3 className="surface-title" style={{ marginBottom: 14 }}>Montos adjudicados (6 meses)</h3>
              <BarChart data={serie6} max={maxMonto} valueKey="monto" color="#6366f1" fmt={fmtCLP} />
            </div>
          </div>

          {/* Descartadas y perdidas del mes, con su motivo */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16, marginTop: 16 }}>
            <div className="surface" style={{ padding: 18 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 14, gap: 8 }}>
                <h3 className="surface-title" style={{ margin: 0 }}>Perdidas por motivo</h3>
                <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{fmtNum(bajas.totalPerdidas)} en el mes</span>
              </div>
              <HBarList items={bajas.perdidas} color="#dc2626" emptyText="Sin licitaciones perdidas en el mes." />
            </div>

            <div className="surface" style={{ padding: 18 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 14, gap: 8 }}>
                <h3 className="surface-title" style={{ margin: 0 }}>Descartadas por motivo</h3>
                <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{fmtNum(bajas.totalDescartadas)} en el mes</span>
              </div>
              <HBarList items={bajas.descartadas} color="#a16207" emptyText="Sin licitaciones descartadas en el mes." />
            </div>

            <div className="surface" style={{ padding: 18 }}>
              <h3 className="surface-title" style={{ marginBottom: 14 }}>Perdidas (6 meses)</h3>
              <BarChart data={serieBajas6} max={maxBajas6} valueKey="perdidas" color="#dc2626" fmt={fmtNum} />
            </div>

            <div className="surface" style={{ padding: 18 }}>
              <h3 className="surface-title" style={{ marginBottom: 14 }}>Descartadas (6 meses)</h3>
              <BarChart data={serieBajas6} max={maxBajas6} valueKey="descartadas" color="#a16207" fmt={fmtNum} />
            </div>
          </div>

          <div className="surface" style={{ padding: 18, marginTop: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, gap: 8, flexWrap: "wrap" }}>
              <h3 className="surface-title" style={{ margin: 0 }}>Detalle de descartadas y perdidas ({labelMesLargo(mesActual).toLowerCase()})</h3>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <select className="input" value={filtroMotivo} onChange={(e) => setFiltroMotivo(e.target.value)} style={{ fontSize: 12, height: 30, padding: "0 8px", maxWidth: 190 }}>
                  <option value="">Todos los motivos</option>
                  {motivosDetalle.map((mo) => (
                    <option key={mo} value={mo}>{mo}</option>
                  ))}
                </select>
                <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{filasBajas.length} licitación{filasBajas.length === 1 ? "" : "es"}</span>
              </div>
            </div>
            <div style={{ overflowY: "auto", maxHeight: 320 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, tableLayout: "fixed" }}>
                <colgroup>
                  <col style={{ width: "24%" }} />
                  <col style={{ width: "34%" }} />
                  <col style={{ width: "16%" }} />
                  <col style={{ width: "26%" }} />
                </colgroup>
                <thead>
                  <tr style={{ color: "var(--text-muted)", textAlign: "left" }}>
                    <th style={{ padding: "6px 8px", position: "sticky", top: 0, background: "var(--surface)", borderBottom: "1px solid var(--border)" }}>Licitación</th>
                    <th style={{ padding: "6px 8px", position: "sticky", top: 0, background: "var(--surface)", borderBottom: "1px solid var(--border)" }}>Entidad</th>
                    <th style={{ padding: "6px 8px", position: "sticky", top: 0, background: "var(--surface)", borderBottom: "1px solid var(--border)" }}>Estado</th>
                    <th style={{ padding: "6px 8px", position: "sticky", top: 0, background: "var(--surface)", borderBottom: "1px solid var(--border)" }}>Motivo</th>
                  </tr>
                </thead>
                <tbody>
                  {filasBajas.length === 0 ? (
                    <tr><td colSpan={4} style={{ padding: "14px 8px", color: "var(--text-muted)" }}>Sin licitaciones descartadas ni perdidas en el mes.</td></tr>
                  ) : filasBajas.map((f) => (
                    <tr key={f.id} style={{ borderBottom: "1px solid var(--border)" }}>
                      <td style={{ padding: "6px 8px", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={f.codigo}>{f.codigo}</td>
                      <td style={{ padding: "6px 8px", color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={f.entidad}>{f.entidad}</td>
                      <td style={{ padding: "6px 8px" }}>
                        <span style={{
                          fontSize: 10.5, fontWeight: 700, padding: "2px 7px", borderRadius: 999, whiteSpace: "nowrap",
                          background: f.tipo === "Perdida" ? "#fee2e2" : "#fef3c7",
                          color: f.tipo === "Perdida" ? "#b91c1c" : "#a16207",
                        }}>{f.tipo}</span>
                      </td>
                      <td style={{ padding: "6px 8px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={f.detalle ? `${f.motivo} — ${f.detalle}` : f.motivo}>
                        {f.motivo}{f.detalle ? <span style={{ color: "var(--text-muted)" }}> · {f.detalle}</span> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Equivalencias: oportunidades vs cotizaciones alternativas creadas */}
          <div className="surface" style={{ padding: 18, marginTop: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 14, gap: 8, flexWrap: "wrap" }}>
              <h3 className="surface-title" style={{ margin: 0, display: "flex", alignItems: "center", gap: 8 }}>
                <GitBranch size={16} /> Equivalencias — oportunidades del mes
              </h3>
              <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                Cotizaciones con ítems que tienen productos equivalentes registrados
              </span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 14, marginBottom: 16 }}>
              <KpiCard icon={FileText} color="#0e7490" label="Con posibilidad" sub="Cotizaciones madre con equivalencias" value={fmtNum(equivalencias.conPosibilidad)} />
              <KpiCard icon={Target} color="#16a34a" label="Aprovechadas" sub="Se creó la cotización alternativa (hija)" value={fmtNum(equivalencias.aprovechadas)} />
              <KpiCard icon={ClipboardCheck} color="#dc2626" label="Sin aprovechar" sub="Tenían equivalencias y no se generó" value={fmtNum(equivalencias.sinAprovechar)} />
              <KpiCard icon={PieChart} color="#6366f1" label="Tasa de aprovechamiento" sub="Aprovechadas / con posibilidad" value={fmtPct(equivalencias.tasa)} />
            </div>
            <div className="panel-grid-1-2">
              <div>
                <HBarList
                  items={[
                    { label: "Aprovechadas", value: equivalencias.aprovechadas, color: "#16a34a" },
                    { label: "Sin aprovechar", value: equivalencias.sinAprovechar, color: "#dc2626" },
                  ]}
                  color="#6366f1"
                  emptyText="Sin oportunidades de equivalencias en el mes."
                />
              </div>
              <div style={{ overflowY: "auto", maxHeight: 260 }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, tableLayout: "fixed" }}>
                  <colgroup>
                    <col style={{ width: "26%" }} />
                    <col style={{ width: "36%" }} />
                    <col style={{ width: "18%" }} />
                    <col style={{ width: "20%" }} />
                  </colgroup>
                  <thead>
                    <tr style={{ color: "var(--text-muted)", textAlign: "left" }}>
                      <th style={{ padding: "6px 8px", position: "sticky", top: 0, background: "var(--surface)", borderBottom: "1px solid var(--border)" }}>Licitación</th>
                      <th style={{ padding: "6px 8px", position: "sticky", top: 0, background: "var(--surface)", borderBottom: "1px solid var(--border)" }}>Entidad</th>
                      <th style={{ padding: "6px 8px", position: "sticky", top: 0, background: "var(--surface)", borderBottom: "1px solid var(--border)" }}>Ítems c/equiv.</th>
                      <th style={{ padding: "6px 8px", position: "sticky", top: 0, background: "var(--surface)", borderBottom: "1px solid var(--border)" }}>Alternativa</th>
                    </tr>
                  </thead>
                  <tbody>
                    {equivalencias.filas.length === 0 ? (
                      <tr><td colSpan={4} style={{ padding: "14px 8px", color: "var(--text-muted)" }}>Sin oportunidades de equivalencias en el mes.</td></tr>
                    ) : equivalencias.filas.map((f) => (
                      <tr key={f.id} style={{ borderBottom: "1px solid var(--border)" }}>
                        <td style={{ padding: "6px 8px", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={f.codigo}>{f.codigo}</td>
                        <td style={{ padding: "6px 8px", color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={f.entidad}>{f.entidad}</td>
                        <td style={{ padding: "6px 8px" }}>{fmtNum(f.skusEquiv)}</td>
                        <td style={{ padding: "6px 8px" }}>
                          <span style={{
                            fontSize: 10.5, fontWeight: 700, padding: "2px 7px", borderRadius: 999, whiteSpace: "nowrap",
                            background: f.hijas > 0 ? "#dcfce7" : "#fee2e2",
                            color: f.hijas > 0 ? "#15803d" : "#b91c1c",
                          }}>{f.hijas > 0 ? `Creada (${f.hijas})` : "No creada"}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 12 }}>
            * Indicadores enfocados en procesos de licitación pública y adjudicación. "Publicadas" = licitaciones registradas en el mes; "Participadas" = las presentadas (excluye descartadas, canceladas y pendientes de aprobación); "Monto adjudicado" = órdenes de compra del mes. "Descartadas" y "Perdidas" se agrupan por el mes de creación de la licitación.
          </p>
        </>
      )}
    </div>
  );
}
