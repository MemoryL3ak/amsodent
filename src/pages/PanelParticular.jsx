// PanelParticular.jsx
// Sub-panel "Cliente Particular": embudo comercial basado en las MARCAS
// secuenciales y acumuladas por cliente particular (ver useEmbudoComercial):
//   Prospecto → Cliente Contactado → Clientes que Cotizan → Clientes que Compran
import { useMemo, useState } from "react";
import useAuth from "../hooks/useAuth";
import MonthCalendarPicker from "../components/MonthCalendarPicker";
import { Users, PhoneCall, FileText, ShoppingCart } from "lucide-react";
import {
  fmtNum, fmtPct, inicioMesISO, mesDe, addMesKey, labelMesLargo, clamp,
  Delta, KpiCard, FunnelShape,
} from "../components/panel/panelKit";
import useEmbudoComercial, { ETAPAS_EMBUDO } from "../components/panel/useEmbudoComercial";

const ICONOS = { prospectos: Users, contactados: PhoneCall, cotizan: FileText, compran: ShoppingCart };

export default function PanelParticular() {
  const { rol, cargando } = useAuth();
  const rolNorm = (rol || "").toString().trim().toLowerCase();
  const esAdmin = rolNorm === "admin" || rolNorm === "administrador";
  const esJefatura = ["jefe_ventas", "jefe ventas", "jefe-ventas", "jefe de ventas", "jefe_ventas_especial"].includes(rolNorm);
  const puedeVer = esAdmin || esJefatura;

  const [periodo, setPeriodo] = useState(inicioMesISO());
  const mesActual = mesDe(periodo);

  const { loading, emb, embPrev, evolucion, conv } = useEmbudoComercial(mesActual);

  const stages = ETAPAS_EMBUDO.map((e) => ({ label: e.label, color: e.color, value: emb[e.key] }));
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
        <div className="field" style={{ margin: 0 }}>
          <label className="field-label">Mes</label>
          <MonthCalendarPicker value={periodo} onChange={setPeriodo} />
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
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 16, marginBottom: 16 }}>
            {/* Embudo (forma) */}
            <div className="surface" style={{ padding: 18, display: "flex", flexDirection: "column", justifyContent: "center" }}>
              <h3 className="surface-title" style={{ marginBottom: 16 }}>Embudo comercial ({labelMesLargo(mesActual).toLowerCase()})</h3>
              <FunnelShape stages={stages} />
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

          <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
            * Solo clientes particulares. Marcas secuenciales y acumuladas: un cliente pasa a Contactado solo si ya es Prospecto, a Cotiza solo si ya es Contactado, y a Compra solo si ya Cotiza. Prospecto = motivo Mapeo / Visita Espontánea / Referido; Contactado = tipo Llamada / Visita / Reunión / Correo; Cotiza = motivo "Presupuesto"; Compra = la cotización asociada pasa a "Adjudicada". Acumulado hasta el fin del mes seleccionado.
          </p>
        </>
      )}
    </div>
  );
}
