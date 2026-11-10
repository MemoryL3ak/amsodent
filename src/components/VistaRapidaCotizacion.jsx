import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { ExternalLink, Eye, FileText, Loader2, X } from "lucide-react";
import { api } from "../lib/api";

/* ── Vista rápida de una cotización (2026-11-09) ─────────────────────────────
   Pedido de Ariel: «en Gestión de compras, sección Cotizaciones, agregar el
   ojo para visualizar la OC y la cotización». El PDF de la cotización se arma
   en el Detalle (flete, fichas técnicas…) y no queda guardado: esta ventana
   muestra lo que dice la cotización —cliente, productos, totales y sus
   documentos, cada uno con su ojo para abrir el archivo— sin salir de la
   pantalla, y enlaza al Detalle para el PDF Carta.
   abrirArchivoDocumento() es el mismo «ver PDF» de Trazabilidad (URL firmada). */

const clp = (n) => `$${Math.round(Number(n) || 0).toLocaleString("es-CL")}`;
const num = (n) => Number(n || 0).toLocaleString("es-CL", { maximumFractionDigits: 2 });
const fecha = (v) => {
  const m = String(v || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : "—";
};
const TIPOS_DOC = {
  orden_compra: "Orden de compra",
  guia_despacho: "Guía de despacho",
  factura: "Factura",
  factura_boleta: "Factura o boleta",
  nota_credito: "Nota de crédito",
  nota_debito: "Nota de débito",
  comprobante_pago: "Comprobante de pago",
};
const ORDEN_DOC = ["orden_compra", "guia_despacho", "factura", "factura_boleta", "nota_credito", "nota_debito", "comprobante_pago"];

/** Abre el archivo de un documento (OC, guía, factura…) en una pestaña nueva. Devuelve false si no se pudo. */
export async function abrirArchivoDocumento(bucket, path) {
  if (!bucket || !path) return false;
  try {
    const data = await api.get(`/licitaciones/storage/signed-url?bucket=${encodeURIComponent(bucket)}&path=${encodeURIComponent(path)}`);
    if (!data?.signedUrl) return false;
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
    return true;
  } catch {
    return false;
  }
}

export default function VistaRapidaCotizacion({ id, onCerrar }) {
  // Lo leído va con el id al que pertenece: si cambia el id, lo anterior ya no vale.
  const [leido, setLeido] = useState(null);
  const [aviso, setAviso] = useState("");
  const datos = leido && leido.id === id && !leido.error ? leido : null;
  const error = leido && leido.id === id ? leido.error || "" : "";

  useEffect(() => {
    let vivo = true;
    Promise.all([api.get(`/licitaciones/${id}`), api.get(`/licitaciones/${id}/items`), api.get(`/licitaciones/${id}/documentos`).catch(() => [])])
      .then(([lic, items, docs]) => vivo && setLeido({ id, lic: lic || {}, items: Array.isArray(items) ? items : [], docs: Array.isArray(docs) ? docs : [] }))
      .catch((e) => vivo && setLeido({ id, error: e?.message || "No se pudo leer la cotización." }));
    return () => { vivo = false; };
  }, [id]);

  useEffect(() => {
    const tecla = (e) => { if (e.key === "Escape") onCerrar?.(); };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [onCerrar]);

  async function ver(doc) {
    setAviso("");
    if (!(await abrirArchivoDocumento(doc.bucket, doc.storage_path))) setAviso(`No se pudo abrir el archivo de ${TIPOS_DOC[doc.tipo] || "el documento"} ${doc.numero || ""}.`);
  }

  const lic = datos?.lic || {};
  const items = datos?.items || [];
  const totalItem = (it) => (Number(it.total) > 0 ? Number(it.total) : (Number(it.cantidad) || 0) * (Number(it.valor_unitario) || 0));
  const netoItems = Math.round(items.reduce((a, it) => a + totalItem(it), 0));
  const flete = Number(lic.flete_estimado) || 0;
  const neto = netoItems + Math.round(flete);
  const iva = Math.round(neto * 0.19);
  const docs = (datos?.docs || []).filter((d) => ORDEN_DOC.includes(d.tipo)).sort((a, b) => ORDEN_DOC.indexOf(a.tipo) - ORDEN_DOC.indexOf(b.tipo) || String(a.created_at || "").localeCompare(String(b.created_at || "")));
  const etiqueta = { fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".4px", color: "var(--text-muted)" };
  const dato = (titulo, valor) => (
    <div style={{ minWidth: 0 }}>
      <div style={etiqueta}>{titulo}</div>
      <div style={{ fontSize: 13, overflowWrap: "anywhere" }}>{valor || "—"}</div>
    </div>
  );

  return createPortal(
    <div onMouseDown={(e) => { if (e.target === e.currentTarget) onCerrar?.(); }} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.55)", zIndex: 11000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div className="vista-rapida-cotizacion" role="dialog" aria-modal="true" aria-label={`Cotización #${id}`} style={{ width: 880, maxWidth: "100%", maxHeight: "92vh", display: "flex", flexDirection: "column", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-lg)" }}>
        <div style={{ padding: "12px 18px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
          <div style={{ minWidth: 0 }}>
            <strong style={{ fontSize: 15, display: "inline-flex", alignItems: "center", gap: 8 }}><FileText size={16} style={{ color: "var(--primary)", flexShrink: 0 }} /> Cotización #{id}{lic.id_licitacion && String(lic.id_licitacion) !== String(id) ? ` · ${lic.id_licitacion}` : ""}</strong>
            {lic.estado && <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>{lic.estado}{lic.nombre && lic.nombre !== lic.nombre_entidad ? ` · ${lic.nombre}` : ""}</div>}
          </div>
          <button type="button" onClick={onCerrar} className="btn btn-ghost" style={{ padding: 6, flexShrink: 0 }} aria-label="Cerrar"><X size={18} /></button>
        </div>

        <div style={{ padding: "14px 18px", display: "flex", flexDirection: "column", gap: 14, overflowY: "auto", minHeight: 0 }}>
          {!datos && !error && <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--text-muted)", fontSize: 13, padding: "18px 0" }}><Loader2 size={16} className="spin" /> Cargando la cotización…</div>}
          {error && <div style={{ border: "1px solid #fecaca", background: "#fef2f2", color: "#b91c1c", borderRadius: 10, padding: "10px 12px", fontSize: 13 }}>{error}</div>}
          {datos && (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: "10px 16px" }}>
                {dato("Cliente", lic.nombre_entidad)}
                {dato("RUT", lic.rut_entidad)}
                {dato("Tipo", lic.tipo_cliente)}
                {dato("Vendedor", lic.vendedor_nombre || lic.vendedor_correo || lic.creado_por)}
                {dato("Adjudicada", lic.fecha_adjudicada ? fecha(lic.fecha_adjudicada) : null)}
                {dato("Condición de venta", lic.condicion_venta)}
                {dato("Despacho", [lic.direccion, lic.comuna].filter(Boolean).join(", "))}
              </div>

              <div>
                <div style={{ ...etiqueta, marginBottom: 6 }}>Productos ({items.length})</div>
                <div className="table-wrap" style={{ margin: 0 }}>
                  <table className="data-table tabla-compacta tabla-texto" style={{ minWidth: 600 }}>
                    <thead>
                      <tr>
                        <th style={{ width: 34 }}>N°</th>
                        <th>Producto</th>
                        <th style={{ textAlign: "right" }}>Cantidad</th>
                        <th style={{ textAlign: "right" }}>Precio unit. neto</th>
                        <th style={{ textAlign: "right" }}>Total neto</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.length === 0 && <tr><td colSpan={5} style={{ textAlign: "center", padding: 16, color: "var(--text-muted)" }}>La cotización no tiene productos.</td></tr>}
                      {items.map((it, i) => (
                        <tr key={it.id || i}>
                          <td style={{ color: "var(--text-muted)" }}>{i + 1}</td>
                          <td style={{ minWidth: 220 }}>
                            <div style={{ fontWeight: 600, overflowWrap: "anywhere" }}>{it.producto || "—"}</div>
                            <div style={{ fontSize: 11.5, color: "var(--text-muted)", overflowWrap: "anywhere" }}>{[it.sku || "Sin SKU", it.formato].filter(Boolean).join(" · ")}</div>
                            {it.observacion && <div style={{ fontSize: 11.5, color: "var(--text-soft, #475569)", fontStyle: "italic", overflowWrap: "anywhere" }}>{it.observacion}</div>}
                          </td>
                          <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>{num(it.cantidad)}</td>
                          <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>{clp(it.valor_unitario)}</td>
                          <td style={{ textAlign: "right", whiteSpace: "nowrap", fontWeight: 600 }}>{clp(totalItem(it))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div style={{ display: "flex", justifyContent: "flex-end", flexWrap: "wrap", gap: "4px 20px", padding: "8px 4px 0", fontSize: 13 }}>
                  {flete > 0 && <span>Productos <b>{clp(netoItems)}</b></span>}
                  {flete > 0 && <span>Flete <b>{clp(flete)}</b></span>}
                  <span>Neto <b>{clp(neto)}</b></span>
                  <span>IVA 19% <b>{clp(iva)}</b></span>
                  <span style={{ fontSize: 14 }}>Total <b>{clp(neto + iva)}</b></span>
                </div>
              </div>

              <div>
                <div style={{ ...etiqueta, marginBottom: 6 }}>Documentos</div>
                {docs.length === 0 ? (
                  <div style={{ fontSize: 12.5, color: "var(--text-muted)" }}>La cotización no tiene documentos cargados.</div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    {docs.map((d) => (
                      <div key={d.id} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: 12.5, padding: "5px 8px", border: "1px solid var(--border)", borderRadius: 8 }}>
                        <span style={{ fontWeight: 700, minWidth: 0 }}>{TIPOS_DOC[d.tipo] || d.tipo} {d.numero ? `N° ${d.numero}` : "s/n"}</span>
                        <span style={{ color: "var(--text-muted)" }}>{fecha(d.fecha_factura || d.fecha_oc || d.created_at)}{Number(d.monto) > 0 ? ` · ${clp(d.monto)} neto` : ""}</span>
                        <span style={{ marginLeft: "auto" }}>
                          {d.bucket && d.storage_path ? (
                            <button type="button" className="btn btn-ghost btn-sm" onClick={() => ver(d)} title="Ver el archivo" style={{ padding: "2px 8px", display: "inline-flex", alignItems: "center", gap: 4 }}><Eye size={13} /> Ver</button>
                          ) : (
                            <span style={{ fontSize: 11.5, color: "var(--text-muted)" }}>sin archivo</span>
                          )}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                {aviso && <div style={{ fontSize: 12.5, color: "#b91c1c", marginTop: 6 }}>{aviso}</div>}
              </div>
            </>
          )}
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "11px 18px", borderTop: "1px solid var(--border)", background: "var(--bg)", borderRadius: "0 0 var(--radius-lg) var(--radius-lg)" }}>
          <span style={{ fontSize: 12, color: "var(--text-muted)", flex: "1 1 240px", minWidth: 0 }}>Lo guardado en la cotización. El PDF Carta se genera desde el Detalle.</span>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Link to={`/detalle/${id}`} target="_blank" rel="noopener noreferrer" className="btn btn-secondary" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><ExternalLink size={14} /> Abrir en el Detalle</Link>
            <button type="button" className="btn btn-primary" onClick={onCerrar}>Cerrar</button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
