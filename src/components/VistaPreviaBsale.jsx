import { useState } from "react";

/* ── Vista previa de un documento para Bsale (2026-10-02) ───────────────────
   Lo que "Simular" muestra: el documento como quedaría, en palabras — cliente,
   productos, totales, referencias, fechas — en vez del JSON que se le manda a
   Bsale. El JSON sigue disponible, plegado, para quien lo necesite. */

const clp = (n) => `$${Math.round(Number(n) || 0).toLocaleString("es-CL")}`;
const fechaCL = (iso) => {
  if (!iso) return "—";
  const [y, m, d] = String(iso).slice(0, 10).split("-");
  return y && m && d ? `${d}-${m}-${y}` : "—";
};
const etiqueta = { fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".4px", color: "var(--text-muted)" };

export default function VistaPreviaBsale({ vista, solicitud, titulo = "Así quedaría el documento" }) {
  const [verJson, setVerJson] = useState(false);
  if (!vista) return null;
  const c = vista.cliente || {};
  const lineas = vista.lineas || [];
  const conPendiente = lineas.some((l) => l.pendiente_despues != null);
  const conGuia = lineas.some((l) => l.guia);
  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 10, background: "#fff", overflow: "hidden" }}>
      <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "baseline" }}>
        <div>
          <div style={etiqueta}>{titulo}</div>
          <div style={{ fontSize: 15, fontWeight: 700 }}>{vista.tipo}</div>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <Chip ok={vista.sii} texto={vista.sii ? "Va al SII" : "No va al SII"} />
          <Chip ok={vista.descuenta_stock} texto={vista.descuenta_stock ? "Descuenta stock" : "No mueve stock"} invertir />
        </div>
      </div>

      <div style={{ padding: "12px 14px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
        <div>
          <div style={etiqueta}>Cliente{c.nuevo ? " · se creará en Bsale" : ""}</div>
          <div style={{ fontSize: 13, fontWeight: 600, overflowWrap: "anywhere" }}>{c.razon_social || "—"}</div>
          <div style={{ fontSize: 12.5 }}>RUT {c.rut || "—"}{c.giro ? ` · ${c.giro}` : ""}</div>
          {(c.direccion || c.comuna) && <div style={{ fontSize: 12, color: "var(--text-muted)", overflowWrap: "anywhere" }}>{[c.direccion, c.comuna].filter(Boolean).join(", ")}</div>}
        </div>
        <div>
          <div style={etiqueta}>Fechas</div>
          <div style={{ fontSize: 12.5 }}>Emisión <b>{fechaCL(vista.fecha_emision)}</b>{vista.vencimiento ? <> · Vence <b>{fechaCL(vista.vencimiento)}</b></> : null}</div>
          {vista.forma_pago && <div style={{ fontSize: 12.5 }}>Forma de pago <b>{vista.forma_pago}</b></div>}
          {(vista.referencias || []).length > 0 && (
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
              Referencias: {vista.referencias.map((r) => `${r.razon} ${r.numero}${r.fecha ? ` (${fechaCL(r.fecha)})` : ""}`).join(" · ")}
            </div>
          )}
        </div>
        {vista.despacho && (
          <div>
            <div style={etiqueta}>Despacho</div>
            <div style={{ fontSize: 12.5, overflowWrap: "anywhere" }}>{vista.despacho.destinatario || "—"}</div>
            <div style={{ fontSize: 12.5, overflowWrap: "anywhere" }}>{[vista.despacho.direccion, vista.despacho.comuna, vista.despacho.ciudad].filter(Boolean).join(", ") || "—"}</div>
            {vista.despacho.tipo_traslado && <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Traslado: {vista.despacho.tipo_traslado}</div>}
          </div>
        )}
      </div>

      <div style={{ maxHeight: 260, overflow: "auto", borderTop: "1px solid var(--border)" }}>
        <table className="data-table" style={{ width: "100%", minWidth: 520 }}>
          <thead>
            <tr>
              {conGuia && <th style={{ textAlign: "left" }}>Guía</th>}
              <th style={{ textAlign: "left" }}>SKU</th>
              <th style={{ textAlign: "left" }}>Producto</th>
              <th style={{ textAlign: "right" }}>Cant.</th>
              {conPendiente && <th style={{ textAlign: "right" }} title="Lo que quedará por despachar de la orden después de esta guía">Queda</th>}
              <th style={{ textAlign: "right" }}>Neto unit.</th>
              <th style={{ textAlign: "right" }}>Neto</th>
            </tr>
          </thead>
          <tbody>
            {lineas.map((l, i) => (
              <tr key={`${l.sku}-${i}`}>
                {conGuia && <td style={{ whiteSpace: "nowrap" }}>{l.guia}</td>}
                <td style={{ whiteSpace: "nowrap", fontWeight: 600 }}>{l.sku || "—"}</td>
                <td style={{ whiteSpace: "normal", overflowWrap: "anywhere" }}>{l.producto || "—"}</td>
                <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>{Number(l.cantidad).toLocaleString("es-CL")}</td>
                {conPendiente && <td style={{ textAlign: "right", whiteSpace: "nowrap", color: l.pendiente_despues > 0 ? "#b45309" : "var(--text-muted)" }}>{Number(l.pendiente_despues || 0).toLocaleString("es-CL")}</td>}
                <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>{clp(l.neto_unitario)}</td>
                <td style={{ textAlign: "right", whiteSpace: "nowrap", fontWeight: 600 }}>{clp(l.neto)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", flexWrap: "wrap", gap: "4px 22px", padding: "10px 14px", borderTop: "1px solid var(--border)", background: "var(--bg)", fontSize: 13 }}>
        <span>Neto <b>{clp(vista.totales?.neto)}</b></span>
        <span>IVA 19% <b>{clp(vista.totales?.iva)}</b></span>
        <span style={{ fontSize: 14 }}>Total <b>{clp(vista.totales?.total)}</b></span>
      </div>
      {(vista.notas || []).length > 0 && (
        <ul style={{ margin: 0, padding: "8px 14px 8px 30px", fontSize: 12, color: "var(--text-muted)", borderTop: "1px solid var(--border)" }}>
          {vista.notas.map((n, i) => <li key={i}>{n}</li>)}
        </ul>
      )}
      {solicitud && (
        <div style={{ borderTop: "1px solid var(--border)", padding: "6px 14px" }}>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setVerJson((v) => !v)} style={{ fontSize: 11.5 }}>
            {verJson ? "Ocultar datos técnicos" : "Ver datos técnicos (lo que recibe Bsale)"}
          </button>
          {verJson && (
            <pre style={{ margin: "6px 0 0", fontSize: 11, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 8, padding: 10, maxHeight: 220, overflow: "auto", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
              {JSON.stringify(solicitud, null, 2)}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

function Chip({ ok, texto, invertir = false }) {
  const positivo = invertir ? !ok : ok;
  return (
    <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 9px", borderRadius: 999, whiteSpace: "nowrap", color: positivo ? "#1e40af" : "#92400e", background: positivo ? "#dbeafe" : "#fef3c7" }}>
      {texto}
    </span>
  );
}
