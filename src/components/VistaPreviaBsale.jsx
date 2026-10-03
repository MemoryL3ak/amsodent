import { useState } from "react";

/* ── Vista previa de un documento para Bsale (2026-10-02, formato 2026-10-03) ──
   Lo que "Simular" muestra: el documento como quedaría, con el formato de un
   documento tributario — emisor, recuadro rojo del SII, receptor, referencias,
   detalle y totales — en vez del JSON que se le manda a Bsale. El JSON sigue
   disponible, plegado, para quien lo necesite. El folio y el timbre los pone
   el SII al emitir, así que acá van como "se asigna al emitir". */

const clp = (n) => `$${Math.round(Number(n) || 0).toLocaleString("es-CL")}`;
const num = (n) => Number(n || 0).toLocaleString("es-CL");
const fechaCL = (iso) => {
  if (!iso) return "—";
  const [y, m, d] = String(iso).slice(0, 10).split("-");
  return y && m && d ? `${d}-${m}-${y}` : "—";
};
const etiqueta = { fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".4px", color: "var(--text-muted)" };
const ROJO = "#c62828";

const CSS = `
.dte-hoja{background:#fff;color:#111;padding:16px 18px;font-size:12.5px;line-height:1.35}
.dte-cab{display:grid;grid-template-columns:minmax(0,1fr) minmax(200px,250px);gap:14px;align-items:start}
.dte-meta{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px 16px;margin-top:12px}
.dte-cajas{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:10px;margin-top:12px}
.dte-caja{border:1px solid #d9dce3;border-radius:6px;padding:8px 10px;min-width:0}
.dte-caja dl{display:grid;grid-template-columns:max-content minmax(0,1fr);gap:2px 10px;margin:0}
.dte-caja dt{color:#555;font-size:11.5px}
.dte-caja dd{margin:0;overflow-wrap:anywhere}
.dte-tabla{width:100%;border-collapse:collapse;font-size:12px}
.dte-tabla th{background:#f1f3f6;border-bottom:1px solid #cfd4dc;padding:6px 8px;font-size:11px;text-transform:uppercase;letter-spacing:.3px;color:#374151;white-space:nowrap}
.dte-tabla td{border-bottom:1px solid #e8eaef;padding:6px 8px;vertical-align:top}
.dte-tabla .num{text-align:right;white-space:nowrap}
.dte-pie{display:flex;justify-content:space-between;gap:14px;align-items:flex-end;flex-wrap:wrap;margin-top:12px}
.dte-totales{min-width:230px;margin-left:auto;border:1px solid #d9dce3;border-radius:6px;padding:8px 12px;display:grid;grid-template-columns:1fr auto;gap:4px 18px}
.dte-timbre{border:1.5px dashed #b9bec9;border-radius:6px;padding:10px 12px;color:#6b7280;font-size:11px;max-width:260px;text-align:center}
@media (max-width:560px){.dte-cab{grid-template-columns:1fr}.dte-hoja{padding:12px}}
`;

export default function VistaPreviaBsale({ vista, solicitud, titulo = "Así quedaría el documento" }) {
  const [verJson, setVerJson] = useState(false);
  if (!vista) return null;
  const c = vista.cliente || {};
  const e = vista.emisor || {};
  const lineas = vista.lineas || [];
  const refs = vista.referencias || [];
  const conPendiente = lineas.some((l) => l.pendiente_despues != null);
  const conGuia = lineas.some((l) => l.guia);
  const esGuia = /gu[ií]a/i.test(vista.tipo || "");
  const colorCaja = vista.sii ? ROJO : "#4b5563";
  const sinReceptor = !c.razon_social && !c.rut;
  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 10, background: "#fff", overflow: "hidden" }}>
      <style>{CSS}</style>
      <div style={{ padding: "8px 14px", borderBottom: "1px solid var(--border)", background: "var(--bg)", display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <div style={etiqueta}>{titulo}</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <Chip ok={vista.sii} texto={vista.sii ? "Va al SII" : "No va al SII"} />
          <Chip ok={vista.descuenta_stock} texto={vista.descuenta_stock ? "Descuenta stock" : "No mueve stock"} invertir />
        </div>
      </div>

      <div className="dte-hoja">
        {/* Cabecera: emisor a la izquierda, recuadro del SII a la derecha */}
        <div className="dte-cab">
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 800, textTransform: "uppercase", overflowWrap: "anywhere" }}>{e.razon_social || "Emisor"}</div>
            {e.giro && <div style={{ color: "#374151" }}>{e.giro}</div>}
            {(e.direccion || e.comuna) && <div style={{ color: "#374151" }}>{[e.direccion, e.comuna, e.ciudad].filter(Boolean).join(", ")}</div>}
            {(e.telefono || e.email) && <div style={{ color: "#6b7280", fontSize: 12 }}>{[e.telefono, e.email].filter(Boolean).join(" · ")}</div>}
          </div>
          <div style={{ border: `2px solid ${colorCaja}`, borderRadius: 6, padding: "8px 10px", textAlign: "center", color: colorCaja, fontWeight: 800 }}>
            {e.rut && <div style={{ fontSize: 13 }}>R.U.T.: {e.rut}</div>}
            <div style={{ fontSize: 13.5, textTransform: "uppercase", margin: "4px 0" }}>{vista.tipo}</div>
            <div style={{ fontSize: 12 }}>N° {vista.folio ? num(vista.folio) : <span style={{ fontWeight: 600, fontSize: 11 }}>se asigna al emitir</span>}</div>
            <div style={{ fontSize: 11, marginTop: 4, fontWeight: 700 }}>{vista.sii ? `S.I.I. - ${e.ciudad_sii || "SANTIAGO"}` : "Documento interno"}</div>
          </div>
        </div>

        {/* Fechas y condiciones */}
        <div className="dte-meta">
          <Dato nombre="Fecha de emisión" valor={fechaCL(vista.fecha_emision)} />
          {vista.vencimiento && <Dato nombre="Vencimiento" valor={fechaCL(vista.vencimiento)} />}
          {vista.forma_pago && <Dato nombre="Forma de pago" valor={vista.forma_pago} />}
          {vista.despacho?.tipo_traslado && <Dato nombre="Tipo de traslado" valor={vista.despacho.tipo_traslado} />}
          {vista.vendedor && <Dato nombre="Vendedor" valor={vista.vendedor} />}
        </div>

        {/* Receptor y despacho */}
        <div className="dte-cajas">
          <div className="dte-caja">
            <div style={{ ...etiqueta, marginBottom: 4 }}>Receptor{c.nuevo ? " · se creará en Bsale" : ""}</div>
            {sinReceptor ? (
              <div style={{ color: "#6b7280" }}>Sin datos del cliente (boleta a consumidor final).</div>
            ) : (
              <dl>
                <dt>Señor(es)</dt><dd style={{ fontWeight: 700 }}>{c.razon_social || "—"}</dd>
                <dt>R.U.T.</dt><dd>{c.rut || "—"}</dd>
                {c.giro && <><dt>Giro</dt><dd>{c.giro}</dd></>}
                {(c.direccion || c.comuna) && <><dt>Dirección</dt><dd>{[c.direccion, c.comuna, c.ciudad].filter(Boolean).join(", ")}</dd></>}
                {c.email && <><dt>Correo</dt><dd>{c.email}</dd></>}
              </dl>
            )}
          </div>
          {vista.despacho && (
            <div className="dte-caja">
              <div style={{ ...etiqueta, marginBottom: 4 }}>Despachar a</div>
              <dl>
                <dt>Destinatario</dt><dd style={{ fontWeight: 700 }}>{vista.despacho.destinatario || "—"}</dd>
                <dt>Dirección</dt><dd>{[vista.despacho.direccion, vista.despacho.comuna, vista.despacho.ciudad].filter(Boolean).join(", ") || "—"}</dd>
              </dl>
            </div>
          )}
        </div>

        {/* Referencias */}
        {refs.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <div style={{ ...etiqueta, marginBottom: 4 }}>Referencias</div>
            <div style={{ overflowX: "auto" }}>
              <table className="dte-tabla" style={{ minWidth: 420 }}>
                <thead><tr><th style={{ textAlign: "left" }}>Tipo de documento</th><th style={{ textAlign: "left" }}>Folio</th><th style={{ textAlign: "left" }}>Fecha</th><th style={{ textAlign: "left" }}>Razón</th></tr></thead>
                <tbody>
                  {refs.map((r, i) => (
                    <tr key={i}>
                      <td>{r.tipo || r.razon || "—"}</td>
                      <td style={{ fontWeight: 600, whiteSpace: "nowrap" }}>{r.folio ?? r.numero ?? "—"}</td>
                      <td style={{ whiteSpace: "nowrap" }}>{r.fecha ? fechaCL(r.fecha) : "—"}</td>
                      <td>{r.tipo ? (r.razon || "—") : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Detalle */}
        <div style={{ marginTop: 12 }}>
          <div style={{ ...etiqueta, marginBottom: 4 }}>Detalle</div>
          <div style={{ overflowX: "auto", maxHeight: 300, overflowY: "auto" }}>
            <table className="dte-tabla" style={{ minWidth: 540 }}>
              <thead>
                <tr>
                  {conGuia && <th style={{ textAlign: "left" }}>Guía</th>}
                  <th style={{ textAlign: "left" }}>Código</th>
                  <th style={{ textAlign: "left" }}>Descripción</th>
                  <th className="num">Cant.</th>
                  {conPendiente && <th className="num" title="Lo que quedará por despachar de la orden después de esta guía">Queda</th>}
                  <th className="num">P. unitario</th>
                  <th className="num">Total</th>
                </tr>
              </thead>
              <tbody>
                {lineas.map((l, i) => (
                  <tr key={`${l.sku}-${i}`}>
                    {conGuia && <td style={{ whiteSpace: "nowrap" }}>{l.guia}</td>}
                    <td style={{ whiteSpace: "nowrap", fontWeight: 600 }}>{l.sku || "—"}</td>
                    <td style={{ overflowWrap: "anywhere" }}>{l.producto || "—"}</td>
                    <td className="num">{num(l.cantidad)}</td>
                    {conPendiente && <td className="num" style={{ color: l.pendiente_despues > 0 ? "#b45309" : "#6b7280" }}>{num(l.pendiente_despues)}</td>}
                    <td className="num">{clp(l.neto_unitario)}</td>
                    <td className="num" style={{ fontWeight: 600 }}>{clp(l.neto)}</td>
                  </tr>
                ))}
                {lineas.length === 0 && <tr><td colSpan={7} style={{ color: "#6b7280", textAlign: "center" }}>Sin líneas</td></tr>}
              </tbody>
            </table>
          </div>
          <div style={{ fontSize: 11, color: "#6b7280", marginTop: 4 }}>Precios netos, sin IVA.</div>
        </div>

        {/* Timbre y totales */}
        <div className="dte-pie">
          {vista.sii ? (
            <div className="dte-timbre">
              <div style={{ fontWeight: 700, marginBottom: 2 }}>Timbre electrónico SII</div>
              <div>Se genera al emitir, junto con el folio.</div>
            </div>
          ) : <div />}
          <div className="dte-totales">
            <span>Neto</span><b style={{ textAlign: "right" }}>{clp(vista.totales?.neto)}</b>
            <span>IVA 19%</span><b style={{ textAlign: "right" }}>{clp(vista.totales?.iva)}</b>
            <span style={{ fontSize: 14, fontWeight: 800, borderTop: "1px solid #d9dce3", paddingTop: 4 }}>Total</span>
            <b style={{ fontSize: 14, textAlign: "right", borderTop: "1px solid #d9dce3", paddingTop: 4 }}>{clp(vista.totales?.total)}</b>
          </div>
        </div>
        {esGuia && !vista.despacho && <div style={{ fontSize: 11, color: "#6b7280", marginTop: 6 }}>Sin dirección de despacho.</div>}
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

function Dato({ nombre, valor }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 11, color: "#6b7280" }}>{nombre}</div>
      <div style={{ fontWeight: 600, overflowWrap: "anywhere" }}>{valor}</div>
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
