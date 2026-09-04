// ModalMargenDesglose.jsx
// Desglose del margen (por cotización / vendedor / tipo), compartido por el
// Panel de Gestión Comercial y los sub-paneles Cliente Particular y Entidad
// Pública. `mostrarMonto` oculta las columnas en pesos a la jefatura;
// `conTipo` apaga la pestaña "por tipo" donde el tipo es constante (particular).
import { useState } from "react";
import { Download, X } from "lucide-react";
import { fmtCLP, fmtNum, fmtPct } from "./panelKit";

export default function ModalMargenDesglose({ desglose, margen, mostrarMonto, conTipo = true, onExportar, onCerrar }) {
  const [vista, setVista] = useState("cotizaciones"); // cotizaciones | vendedor | tipo
  const TABS = [
    { key: "cotizaciones", label: "Por cotización" },
    { key: "vendedor", label: "Por vendedor" },
    ...(conTipo ? [{ key: "tipo", label: "Por tipo de cotización" }] : []),
  ];
  const colorPct = (pct) => (pct >= 20 ? "#15803d" : pct > 0 ? "#b45309" : "#dc2626");

  const TablaAgrupada = ({ filas, etiqueta }) => (
    <table className="data-table" style={{ width: "100%" }}>
      <thead>
        <tr>
          <th style={{ textAlign: "left" }}>{etiqueta}</th>
          <th style={{ textAlign: "right" }}>Cotizaciones</th>
          <th style={{ textAlign: "right" }}>Venta neta</th>
          {mostrarMonto && <th style={{ textAlign: "right" }}>Costo</th>}
          {mostrarMonto && <th style={{ textAlign: "right" }}>Margen $</th>}
          <th style={{ textAlign: "right" }}>Margen %</th>
        </tr>
      </thead>
      <tbody>
        {filas.length === 0 ? (
          <tr><td colSpan={mostrarMonto ? 6 : 4} style={{ padding: "14px 8px", color: "var(--text-muted)" }}>Sin adjudicaciones en el periodo.</td></tr>
        ) : filas.map((f) => (
          <tr key={f.label}>
            <td style={{ fontWeight: 600, maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={f.label}>{f.label}</td>
            <td style={{ textAlign: "right" }}>{fmtNum(f.cotizaciones)}</td>
            <td style={{ textAlign: "right", fontWeight: 600 }}>{fmtCLP(f.venta)}</td>
            {mostrarMonto && <td style={{ textAlign: "right" }}>{fmtCLP(f.costo)}</td>}
            {mostrarMonto && <td style={{ textAlign: "right", fontWeight: 600 }}>{fmtCLP(f.monto)}</td>}
            <td style={{ textAlign: "right", fontWeight: 700, color: colorPct(f.pct) }}>{fmtPct(f.pct)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onCerrar(); }}
      style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.55)", zIndex: 12000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
    >
      <div style={{ width: 860, maxWidth: "100%", maxHeight: "86vh", display: "flex", flexDirection: "column", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-lg)", padding: 22 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>Desglose del margen</h3>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {onExportar && (
              <button className="btn btn-secondary btn-sm" onClick={onExportar} title="Descargar el desglose completo en Excel: una hoja por vista">
                <Download size={14} /> Exportar
              </button>
            )}
            <button className="btn btn-ghost" onClick={onCerrar} style={{ padding: 6 }}><X size={18} /></button>
          </div>
        </div>
        <p style={{ fontSize: 12.5, color: "var(--text-muted)", marginTop: 2, marginBottom: 12 }}>
          Margen del periodo: <strong style={{ color: colorPct(margen.pct) }}>{fmtPct(margen.pct)}</strong>
          {mostrarMonto ? <> · <strong>{fmtCLP(margen.monto)}</strong></> : null}. Calculado sobre los ítems de las cotizaciones adjudicadas del periodo (costo guardado con cada cotización; si no existe, el del catálogo por SKU). Las filas con ⚠ no tienen costo en ningún ítem: su "100%" no es margen real.
        </p>
        <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
          {TABS.map((t) => (
            <button key={t.key} type="button" onClick={() => setVista(t.key)}
              style={{
                fontSize: 12.5, fontWeight: 700, padding: "6px 14px", borderRadius: 999, cursor: "pointer",
                background: vista === t.key ? "var(--primary)" : "var(--surface)",
                color: vista === t.key ? "#fff" : "var(--text-muted)",
                border: `1px solid ${vista === t.key ? "var(--primary)" : "var(--border)"}`,
              }}>
              {t.label}
            </button>
          ))}
        </div>
        <div style={{ overflowY: "auto", overflowX: "auto", flex: 1, border: "1px solid var(--border)", borderRadius: 10 }}>
          {vista === "cotizaciones" ? (
            <table className="data-table" style={{ width: "100%" }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left" }}>Cotización</th>
                  <th style={{ textAlign: "left" }}>Cliente</th>
                  <th style={{ textAlign: "left" }}>Vendedor</th>
                  <th style={{ textAlign: "right" }}>Venta neta</th>
                  {mostrarMonto && <th style={{ textAlign: "right" }}>Costo</th>}
                  {mostrarMonto && <th style={{ textAlign: "right" }}>Margen $</th>}
                  <th style={{ textAlign: "right" }}>Margen %</th>
                </tr>
              </thead>
              <tbody>
                {desglose.filas.length === 0 ? (
                  <tr><td colSpan={mostrarMonto ? 7 : 5} style={{ padding: "14px 8px", color: "var(--text-muted)" }}>Sin adjudicaciones en el periodo.</td></tr>
                ) : desglose.filas.map((f) => (
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
                    <td style={{ maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text-muted)" }} title={f.cliente}>{f.cliente}</td>
                    <td style={{ maxWidth: 150, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={f.vendedor}>{f.vendedor}</td>
                    <td style={{ textAlign: "right", fontWeight: 600 }}>{fmtCLP(f.venta)}</td>
                    {mostrarMonto && <td style={{ textAlign: "right" }}>{fmtCLP(f.costo)}</td>}
                    {mostrarMonto && <td style={{ textAlign: "right", fontWeight: 600 }}>{fmtCLP(f.monto)}</td>}
                    <td
                      style={{ textAlign: "right", fontWeight: 700, whiteSpace: "nowrap", color: f.sinCosto ? "var(--text-muted)" : colorPct(f.pct) }}
                      title={f.sinCosto ? "Ningún ítem de esta cotización tiene costo (ni guardado ni en el catálogo por SKU): el 100% no es margen real. Ingresa el costo de los ítems en el detalle de la cotización." : undefined}
                    >
                      {f.sinCosto ? "⚠ " : ""}{fmtPct(f.pct)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : vista === "vendedor" ? (
            <TablaAgrupada filas={desglose.porVendedor} etiqueta="Vendedor" />
          ) : (
            <TablaAgrupada filas={desglose.porTipo} etiqueta="Tipo de cotización" />
          )}
        </div>
      </div>
    </div>
  );
}
