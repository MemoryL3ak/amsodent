// EmbudoComercial.jsx
// Tarjeta reutilizable del embudo comercial (Prospecto → Contactado → Cotizan
// → Compran) con forma de embudo. Marcas secuenciales y acumuladas por cliente
// particular. Se usa en el Panel de Indicadores y en el sub-panel "Cliente
// Particular". Cada etapa es cliqueable: abre el detalle de las actividades
// que marcaron esa etapa.
import { useState } from "react";
import { Link } from "react-router-dom";
import { X } from "lucide-react";
import { mesDe, fmtNum, FunnelShape } from "./panelKit";
import useEmbudoComercial, { ETAPAS_EMBUDO } from "./useEmbudoComercial";

const fmtFechaCL = (v) => {
  if (!v) return "—";
  const d = new Date(`${String(v).slice(0, 10)}T00:00:00`);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("es-CL");
};

// Modal con el detalle de una etapa del embudo: cliente + actividad que marcó
// la etapa (fecha, tipo/motivo, ejecutivo). Compartido por la tarjeta y el
// sub-panel Cliente Particular.
export function ModalEtapaEmbudo({ etapa, items, nombresEjecutivos = {}, onClose }) {
  const esCompra = etapa.key === "compran";
  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.55)", zIndex: 12000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
    >
      <div style={{ width: 700, maxWidth: "100%", maxHeight: "84vh", display: "flex", flexDirection: "column", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-lg)", padding: 22 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ width: 12, height: 12, borderRadius: 3, background: etapa.color, display: "inline-block" }} />
            {etapa.label} · {fmtNum(items.length)}
          </h3>
          <button className="btn btn-ghost" onClick={onClose} style={{ padding: 6 }}><X size={18} /></button>
        </div>
        <p style={{ fontSize: 12.5, color: "var(--text-muted)", marginTop: 2, marginBottom: 12 }}>
          {esCompra
            ? "Clientes con una cotización adjudicada (vinculada a su actividad de presupuesto), acumulado al corte del mes."
            : "Clientes que alcanzaron la etapa, con la actividad de bitácora que los marcó. Acumulado al corte del mes."}
        </p>
        <div style={{ overflowY: "auto", overflowX: "auto", flex: 1, border: "1px solid var(--border)", borderRadius: 10 }}>
          <table className="data-table" style={{ width: "100%" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left" }}>Cliente</th>
                <th style={{ textAlign: "left" }}>Fecha</th>
                <th style={{ textAlign: "left" }}>{esCompra ? "Cotización" : "Actividad"}</th>
                <th style={{ textAlign: "left" }}>Ejecutivo</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr><td colSpan={4} style={{ padding: "16px 10px", color: "var(--text-muted)" }}>Sin clientes en esta etapa para el periodo.</td></tr>
              ) : items.map((it, i) => (
                <tr key={`${it.clienteId}-${i}`}>
                  <td style={{ fontWeight: 600, maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={it.cliente}>{it.cliente}</td>
                  <td style={{ whiteSpace: "nowrap" }}>{fmtFechaCL(it.fecha)}</td>
                  <td style={{ fontSize: 12.5 }}>
                    {esCompra && it.licitacionId ? (
                      <Link to={`/detalle/${it.licitacionId}`} className="table-link">Cotización #{it.licitacionId}</Link>
                    ) : (
                      <span>
                        {(it.tipo || "").trim() || "—"}
                        {it.motivo ? <span style={{ color: "var(--text-muted)" }}> · {it.motivo}</span> : null}
                      </span>
                    )}
                  </td>
                  <td style={{ fontSize: 12.5, maxWidth: 170, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={it.ejecutivo}>
                    {nombresEjecutivos[it.ejecutivo] || it.ejecutivo || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// periodo: 'YYYY-MM-DD' o 'YYYY-MM' (el mes seleccionado).
export default function EmbudoComercial({ periodo, titulo = "Embudo comercial (clientes particulares)" }) {
  const mesActual = mesDe(periodo);
  const [ejecutivo, setEjecutivo] = useState("");
  const [etapaSel, setEtapaSel] = useState(null);
  const { loading, emb, opcionesEjecutivos, detalleEmbudo, nombresEjecutivos } = useEmbudoComercial(mesActual, ejecutivo);
  const stages = ETAPAS_EMBUDO.map((e) => ({ key: e.key, label: e.label, color: e.color, value: emb[e.key] }));

  return (
    <div className="surface" style={{ padding: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
        <h3 className="surface-title" style={{ margin: 0 }}>{titulo}</h3>
        <select
          className="input"
          value={ejecutivo}
          onChange={(e) => setEjecutivo(e.target.value)}
          style={{ maxWidth: 200, fontSize: 12.5, height: 32, padding: "0 8px" }}
          title="Filtrar el embudo por ejecutivo"
        >
          <option value="">Todos los ejecutivos</option>
          {opcionesEjecutivos.map((op) => (
            <option key={op.value} value={op.value}>{op.label}</option>
          ))}
        </select>
      </div>
      {loading
        ? <div style={{ color: "var(--text-muted)", fontSize: 13, padding: "24px 0", textAlign: "center" }}>Cargando embudo…</div>
        : (
          <>
            <FunnelShape stages={stages} onStageClick={setEtapaSel} />
            <p style={{ fontSize: 11, color: "var(--text-muted)", textAlign: "center", marginTop: 8, marginBottom: 0 }}>
              Haz clic en una etapa para ver el detalle de actividades.
            </p>
          </>
        )}
      {etapaSel && (
        <ModalEtapaEmbudo
          etapa={etapaSel}
          items={detalleEmbudo[etapaSel.key] || []}
          nombresEjecutivos={nombresEjecutivos}
          onClose={() => setEtapaSel(null)}
        />
      )}
    </div>
  );
}
