import { X, Download } from "lucide-react";

// Modal compartido (Definición de metas + Panel de Indicadores): lista los
// documentos que componen el avance de la meta del periodo — guías de
// despacho (públicas) y boletas/facturas/efectivo (particulares) — con link
// al detalle de cada cotización y export a Excel.
//
// filas: [{ licId, codigo, cliente, vendedor?, tipoLabel, numero, monto, fecha }]
function fmtCLP(v) {
  return `$${Number(v || 0).toLocaleString("es-CL")}`;
}

function fmtDia(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(ymd || ""));
  return m ? `${m[3]}-${m[2]}-${m[1]}` : "—";
}

export default function ModalAvanceMeta({ titulo, subtitulo, filas, mostrarVendedor = true, onCerrar }) {
  const total = (filas || []).reduce((s, f) => s + (Number(f.monto) || 0), 0);

  async function exportar() {
    try {
      const XLSX = await import("xlsx");
      const rows = (filas || []).map((f) => ({
        "Cotización": f.codigo,
        "Cliente": f.cliente || "",
        ...(mostrarVendedor ? { "Vendedor": f.vendedor || "" } : {}),
        "Documento": f.tipoLabel,
        "N°": f.numero || "",
        "Fecha": f.fecha || "",
        "Monto neto": Math.round(Number(f.monto) || 0),
      }));
      rows.push({
        "Cotización": "TOTAL",
        "Cliente": "",
        ...(mostrarVendedor ? { "Vendedor": "" } : {}),
        "Documento": "",
        "N°": "",
        "Fecha": "",
        "Monto neto": Math.round(total),
      });
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "Avance de metas");
      XLSX.writeFile(wb, `avance_metas_${new Date().toISOString().slice(0, 10)}.xlsx`);
    } catch (e) {
      console.error("Error exportando avance de metas:", e);
    }
  }

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onCerrar(); }}
      style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.55)", zIndex: 12000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
    >
      <div style={{ width: 900, maxWidth: "100%", maxHeight: "86vh", display: "flex", flexDirection: "column", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-lg)", padding: 22 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6, gap: 8 }}>
          <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>{titulo || "Detalle del avance de metas"}</h3>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button className="btn btn-secondary btn-sm" onClick={exportar} disabled={!filas?.length} title="Descargar este detalle en Excel">
              <Download size={14} /> Exportar
            </button>
            <button className="btn btn-ghost" onClick={onCerrar} style={{ padding: 6 }} aria-label="Cerrar"><X size={18} /></button>
          </div>
        </div>
        <p style={{ fontSize: 12.5, color: "var(--text-muted)", marginTop: 2, marginBottom: 12 }}>
          {subtitulo || "Documentos que componen el avance del periodo: guías de despacho (cotizaciones públicas) y boletas/facturas o efectivo (clientes particulares), de cotizaciones adjudicadas en el mes."}
          {" "}Total: <strong>{fmtCLP(total)}</strong> neto en {filas?.length || 0} documento{(filas?.length || 0) === 1 ? "" : "s"}.
        </p>
        <div style={{ overflowY: "auto", overflowX: "auto", flex: 1, border: "1px solid var(--border)", borderRadius: 10 }}>
          <table className="data-table" style={{ width: "100%", minWidth: 700 }}>
            <thead style={{ position: "sticky", top: 0, background: "var(--surface)", boxShadow: "0 1px 0 var(--border)", zIndex: 1 }}>
              <tr>
                <th style={{ textAlign: "left" }}>Cotización</th>
                <th style={{ textAlign: "left" }}>Cliente</th>
                {mostrarVendedor && <th style={{ textAlign: "left" }}>Vendedor</th>}
                <th style={{ textAlign: "left" }}>Documento</th>
                <th style={{ textAlign: "left" }}>N°</th>
                <th style={{ textAlign: "left", whiteSpace: "nowrap" }}>Fecha</th>
                <th style={{ textAlign: "right" }}>Monto neto</th>
              </tr>
            </thead>
            <tbody>
              {(filas || []).length === 0 ? (
                <tr>
                  <td colSpan={mostrarVendedor ? 7 : 6} style={{ padding: "14px 8px", color: "var(--text-muted)" }}>
                    Sin guías ni documentos de venta en el periodo.
                  </td>
                </tr>
              ) : filas.map((f, i) => (
                <tr key={`${f.licId}-${f.tipoLabel}-${f.numero}-${i}`}>
                  <td style={{ fontWeight: 600, whiteSpace: "nowrap" }}>
                    <a
                      href={`/detalle/${f.licId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="table-link"
                      title="Abrir el detalle de la cotización en una pestaña nueva"
                    >
                      {f.codigo || `#${f.licId}`}
                    </a>
                  </td>
                  <td style={{ maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text-muted)" }} title={f.cliente}>{f.cliente || "—"}</td>
                  {mostrarVendedor && (
                    <td style={{ maxWidth: 150, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={f.vendedor}>{f.vendedor || "—"}</td>
                  )}
                  <td>
                    <span style={{
                      fontSize: 10.5, fontWeight: 700, padding: "2px 8px", borderRadius: 999, whiteSpace: "nowrap",
                      background: f.tipoLabel === "Guía de despacho" ? "#e0f2fe" : "#ede9fe",
                      color: f.tipoLabel === "Guía de despacho" ? "#0369a1" : "#6d28d9",
                    }}>{f.tipoLabel}</span>
                  </td>
                  <td style={{ whiteSpace: "nowrap", color: "var(--text-muted)" }}>{f.numero || "—"}</td>
                  <td style={{ whiteSpace: "nowrap" }}>{fmtDia(f.fecha)}</td>
                  <td style={{ textAlign: "right", fontWeight: 600, whiteSpace: "nowrap" }}>{fmtCLP(f.monto)}</td>
                </tr>
              ))}
            </tbody>
            {(filas || []).length > 0 && (
              <tfoot>
                <tr style={{ background: "var(--bg)" }}>
                  <td colSpan={mostrarVendedor ? 6 : 5} style={{ fontWeight: 700 }}>Total</td>
                  <td style={{ textAlign: "right", fontWeight: 700, whiteSpace: "nowrap" }}>{fmtCLP(total)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
}
