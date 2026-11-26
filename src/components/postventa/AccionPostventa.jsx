import { Suspense, lazy, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { CheckCircle2, ExternalLink, FileText, Info, Receipt, Truck, X } from "lucide-react";
import { api } from "../../lib/api";
import DropdownSelect from "../ui/DropdownSelect";
import { NOMBRE_DOCUMENTO, accionPostventa, fechaCorta } from "./postventaComun";

/* ── Acción de una solicitud de postventa (2026-11-26) ───────────────────────
   Las tres acciones del pedido: nota de crédito, otra factura y guía de
   despacho. Acá NO se reimplementa la emisión: el documento se emite con las
   ventanas que ya existen (las mismas de Facturación, Trazabilidad y la
   cotización) o en esas pantallas, y la solicitud guarda la gestión con el
   documento asociado.

   Dos pasos en la misma ventana:
   1) Emitir: si el usuario emite en Bsale, abre la ventana de emisión de ese
      documento para la cotización de la solicitud; al emitir, la gestión se
      registra sola con el número. Si no, van los enlaces a la pantalla donde
      se emite.
   2) Registrar: deja la gestión en la solicitud, eligiendo el documento ya
      emitido de la cotización, escribiendo su número o dejándolo para después
      («Asociar documento» en la bitácora).

   Con `gestion` la ventana solo asocia el documento a una acción ya registrada.
   Las ventanas de emisión se cargan recién al abrirlas. */

const AnularDocumentoBsale = lazy(() => import("../AnularDocumentoBsale"));
const DocumentoLibreBsale = lazy(() => import("../DocumentoLibreBsale"));
const EmitirDespachoBsale = lazy(() => import("../EmitirDespachoBsale"));

const ICONOS = { nota_credito: FileText, factura: Receipt, guia_despacho: Truck };
const etiqueta = { fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".4px", color: "var(--text-muted)", display: "block", marginBottom: 4 };
const caja = { border: "1px solid var(--border)", borderRadius: 10, padding: "10px 12px", display: "flex", flexDirection: "column", gap: 8, minWidth: 0 };
const enlace = { display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12.5, fontWeight: 600 };

export default function AccionPostventa({ accion, detalle, gestion = null, puedeEmitir = {}, puede = () => false, onCerrar, onRegistrada }) {
  const acc = accionPostventa(accion);
  const Icono = ICONOS[accion] || FileText;
  const sol = detalle.solicitud;
  const licId = sol.licitacion_id || null;
  const documentos = useMemo(() => detalle.documentos || [], [detalle]);
  const delTipo = useMemo(() => documentos.filter((d) => acc.documentos.includes(d.tipo)), [documentos, acc]);
  const facturas = useMemo(() => documentos.filter((d) => d.tipo === "factura" || d.tipo === "factura_boleta"), [documentos]);
  const ordenes = useMemo(() => documentos.filter((d) => d.tipo === "orden_compra"), [documentos]);
  // Documentos de este tipo que ya están asociados a otra gestión de la solicitud.
  const usados = useMemo(() => new Set((detalle.gestiones || []).filter((g) => g.documento_id && g.id !== gestion?.id).map((g) => g.documento_id)), [detalle, gestion]);

  const facturaInicial = facturas.find((f) => f.id === sol.documento_id) || facturas[facturas.length - 1] || null;
  const [facturaNc, setFacturaNc] = useState(facturaInicial ? String(facturaInicial.id) : "");
  const [ocGuia, setOcGuia] = useState(ordenes[0] ? String(ordenes[0].id) : "");
  const [ventana, setVentana] = useState(null); // { clase: "nc" | "libre" | "oc", ... }
  const [doc, setDoc] = useState(""); // "" | id | "manual"
  const [numero, setNumero] = useState("");
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState("");
  const [hecho, setHecho] = useState("");

  const manual = doc === "manual";
  const emite = accion === "guia_despacho" ? !!(puedeEmitir.guia || puedeEmitir.factura) : !!puedeEmitir.factura;
  const completo = !enviando && (gestion ? (manual ? numero.trim().length > 0 : !!doc) : !manual || numero.trim().length > 0);

  async function enviar(cuerpo) {
    return gestion ? api.put(`/postventa/gestiones/${gestion.id}/documento`, cuerpo) : api.post(`/postventa/${sol.id}/accion`, { tipo: accion, detalle: texto.trim(), ...cuerpo });
  }

  async function registrar() {
    if (!completo) return;
    setEnviando(true);
    setError("");
    try {
      const r = await enviar(manual ? { documento_numero: numero.trim() } : doc ? { documento_id: Number(doc) } : {});
      onRegistrada?.(r);
      onCerrar?.();
    } catch (e) {
      setError(e?.message || "No se pudo registrar la acción.");
      setEnviando(false);
    }
  }

  /* El documento se emitió en la ventana de Bsale: la gestión queda registrada
     con su número (y con el documento de la cotización, si quedó guardado). */
  async function alEmitir(r) {
    const num = r?.numero != null ? String(r.numero) : "";
    setError("");
    try {
      let res;
      try {
        res = await enviar({ ...(r?.documento_id ? { documento_id: Number(r.documento_id) } : {}), documento_numero: num });
      } catch (e) {
        // El documento emitido no calzó con la solicitud (p. ej. se cambió el cliente en la ventana): queda solo el número.
        if (!r?.documento_id || !num) throw e;
        res = await enviar({ documento_numero: num });
      }
      onRegistrada?.(res);
      setHecho(`${acc.corto} N° ${num || "s/n"} emitida y registrada en la solicitud.`);
    } catch (e) {
      setError(`El documento ${num ? `N° ${num} ` : ""}se emitió, pero no quedó registrado en la solicitud: ${e?.message || "error"}. Regístralo abajo con su número.`);
      setDoc("manual");
      setNumero(num);
    }
  }

  const opcionesDoc = [
    ...(gestion ? [] : [{ value: "", label: "Todavía no se emite: lo asocio después" }]),
    ...delTipo.map((d) => ({ value: String(d.id), label: `${NOMBRE_DOCUMENTO[d.tipo] || d.tipo} N° ${d.numero || "s/n"}`, detalle: [d.fecha ? fechaCorta(d.fecha) : null, usados.has(d.id) ? "ya asociada a otra gestión" : null].filter(Boolean).join(" · ") || undefined })),
    { value: "manual", label: "Escribir el número" },
  ];

  return createPortal(
    <div
      onMouseDown={(e) => { if (e.target === e.currentTarget && !enviando && !ventana) onCerrar?.(); }}
      style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.55)", zIndex: 10900, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
    >
      <div className="ventana-accion-postventa" role="dialog" aria-modal="true" aria-label={acc.nombre} style={{ width: 620, maxWidth: "100%", maxHeight: "94vh", display: "flex", flexDirection: "column", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-lg)" }}>
        <div style={{ padding: "12px 18px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
          <strong style={{ fontSize: 15, display: "inline-flex", alignItems: "center", gap: 8, minWidth: 0 }}>
            <Icono size={17} style={{ color: "var(--primary)", flexShrink: 0 }} />
            <span style={{ overflowWrap: "anywhere" }}>{gestion ? `Asociar ${acc.corto.toLowerCase()}` : acc.nombre} · solicitud N° {sol.id}</span>
          </strong>
          <button type="button" onClick={onCerrar} disabled={enviando} className="btn btn-ghost" style={{ padding: 6 }} aria-label="Cerrar"><X size={18} /></button>
        </div>

        <div style={{ padding: "14px 18px", display: "flex", flexDirection: "column", gap: 12, overflowY: "auto", minHeight: 0 }}>
          <div style={{ fontSize: 12.5, color: "var(--text-soft)" }}>
            {sol.cliente_nombre || sol.cliente_rut_formateado}
            {detalle.cotizacion ? ` · cotización ${detalle.cotizacion.id_licitacion || `#${detalle.cotizacion.id}`}` : " · sin cotización asociada"}
          </div>

          {hecho ? (
            <div style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13, color: "#14532d", background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 10, padding: "10px 12px" }}>
              <CheckCircle2 size={16} style={{ flexShrink: 0, marginTop: 1 }} /> {hecho}
            </div>
          ) : (
            <>
              {/* 1) Emitir */}
              <div style={caja} className="postventa-emitir">
                <span style={{ ...etiqueta, marginBottom: 0 }}>1 · Emitir el documento</span>
                {emite ? (
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
                    {accion === "nota_credito" && facturas.length > 0 && (
                      <div style={{ flex: "1 1 220px", minWidth: 0 }}>
                        <DropdownSelect value={facturaNc} onChange={setFacturaNc} minWidth={240} style={{ width: "100%" }} title="Factura o boleta sobre la que se emite la nota de crédito" options={facturas.map((f) => ({ value: String(f.id), label: `${NOMBRE_DOCUMENTO[f.tipo] || "Factura"} N° ${f.numero || "s/n"}`, detalle: f.fecha ? fechaCorta(f.fecha) : undefined }))} />
                      </div>
                    )}
                    {accion === "nota_credito" && (
                      <button type="button" className="btn btn-primary btn-sm btn-emitir-postventa" onClick={() => setVentana({ clase: "nc", documentoId: facturas.length ? Number(facturaNc) || null : null })}>
                        {facturas.length ? "Emitir nota de crédito…" : "Buscar la factura y emitir la nota…"}
                      </button>
                    )}
                    {accion === "factura" && (
                      <button type="button" className="btn btn-primary btn-sm btn-emitir-postventa" onClick={() => setVentana({ clase: "libre", tipo: "factura" })}>
                        {licId ? "Emitir factura de esta cotización…" : "Emitir factura…"}
                      </button>
                    )}
                    {accion === "guia_despacho" && ordenes.length > 0 && (
                      <>
                        {ordenes.length > 1 && (
                          <div style={{ flex: "1 1 200px", minWidth: 0 }}>
                            <DropdownSelect value={ocGuia} onChange={setOcGuia} minWidth={220} style={{ width: "100%" }} title="Orden de compra de la guía" options={ordenes.map((o) => ({ value: String(o.id), label: `OC ${o.numero || `#${o.id}`}`, detalle: o.fecha ? fechaCorta(o.fecha) : undefined }))} />
                          </div>
                        )}
                        <button type="button" className="btn btn-primary btn-sm btn-emitir-postventa" onClick={() => setVentana({ clase: "oc", ocDocId: Number(ocGuia) })} title="Guía contra la orden de compra de la cotización (descuenta su saldo por despachar)">
                          Emitir guía de la orden de compra…
                        </button>
                      </>
                    )}
                    {accion === "guia_despacho" && (
                      <button type="button" className={`btn btn-sm btn-emitir-postventa ${ordenes.length ? "btn-secondary" : "btn-primary"}`} onClick={() => setVentana({ clase: "libre", tipo: "guia" })} title="Guía con los productos que se elijan, sin pasar por la orden de compra">
                        {licId ? (ordenes.length ? "Guía libre de esta cotización…" : "Emitir guía de esta cotización…") : "Emitir guía…"}
                      </button>
                    )}
                  </div>
                ) : (
                  <div style={{ display: "flex", gap: 7, fontSize: 12.5, color: "var(--text-soft)" }}>
                    <Info size={14} style={{ flexShrink: 0, marginTop: 2, color: "var(--text-muted)" }} />
                    Tu usuario no emite este documento en Bsale. Pídeselo a quien factura y, cuando esté emitido, asócialo en el paso 2.
                  </div>
                )}
                <div style={{ display: "flex", gap: "4px 16px", flexWrap: "wrap" }}>
                  {licId && (
                    <Link to={`/detalle/${licId}`} target="_blank" rel="noopener noreferrer" className="table-link" style={enlace}>
                      <ExternalLink size={13} /> Abrir la cotización
                    </Link>
                  )}
                  {accion !== "guia_despacho" && puede("trazabilidad") && (
                    <Link to="/trazabilidad?pestana=facturas" target="_blank" rel="noopener noreferrer" className="table-link" style={enlace}>
                      <ExternalLink size={13} /> Trazabilidad → Facturas
                    </Link>
                  )}
                  {puede("facturacion") && (
                    <Link to="/facturacion" target="_blank" rel="noopener noreferrer" className="table-link" style={enlace}>
                      <ExternalLink size={13} /> Facturación
                    </Link>
                  )}
                  {accion === "factura" && !licId && (puede("venta_directa") || puede("facturacion")) && (
                    <Link to="/venta-directa" target="_blank" rel="noopener noreferrer" className="table-link" style={enlace}>
                      <ExternalLink size={13} /> Venta directa
                    </Link>
                  )}
                </div>
                <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>
                  {accion === "nota_credito"
                    ? "La nota de crédito se emite sobre la factura o boleta, con su simulación previa, igual que en Facturación."
                    : accion === "factura"
                      ? "Es la misma ventana de emisión de Facturación: simula primero y luego emite. Para facturar una guía ya emitida, usa Facturación."
                      : "Es la misma ventana de emisión de la cotización: simula primero y luego emite."}
                </div>
              </div>

              {/* 2) Registrar */}
              <div style={caja} className="postventa-registrar">
                <span style={{ ...etiqueta, marginBottom: 0 }}>{gestion ? "Documento emitido" : "2 · Registrar la gestión en la solicitud"}</span>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <div style={{ flex: "2 1 240px", minWidth: 0 }}>
                    <DropdownSelect value={doc} onChange={setDoc} disabled={enviando} minWidth={280} style={{ width: "100%" }} placeholder="Elige el documento emitido" options={opcionesDoc} />
                  </div>
                  {manual && (
                    <div style={{ flex: "1 1 130px", minWidth: 0 }}>
                      <input className="input" value={numero} onChange={(e) => setNumero(e.target.value.slice(0, 40))} disabled={enviando} placeholder={`N° de la ${acc.corto.toLowerCase()}`} aria-label="Número del documento" style={{ width: "100%" }} />
                    </div>
                  )}
                </div>
                {!gestion && (
                  <textarea className="input" value={texto} onChange={(e) => setTexto(e.target.value.slice(0, 1500))} disabled={enviando} rows={2} placeholder="Detalle de la gestión (opcional)" style={{ width: "100%", height: "auto", minHeight: 56, padding: "8px 10px", resize: "vertical" }} />
                )}
                {!gestion && delTipo.length === 0 && licId && (
                  <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>La cotización todavía no tiene una {acc.corto.toLowerCase()} registrada: apenas se emita aparecerá en esta lista.</div>
                )}
              </div>
            </>
          )}
          {error && <div style={{ fontSize: 12.5, color: "#dc2626", fontWeight: 600 }}>{error}</div>}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, flexWrap: "wrap", padding: "11px 18px", borderTop: "1px solid var(--border)", background: "var(--bg)" }}>
          <button type="button" className="btn btn-secondary" onClick={onCerrar} disabled={enviando}>{hecho ? "Cerrar" : "Cancelar"}</button>
          {!hecho && (
            <button type="button" className="btn btn-primary btn-registrar-accion" onClick={registrar} disabled={!completo}>
              {enviando ? "Guardando…" : gestion ? "Asociar documento" : "Registrar acción"}
            </button>
          )}
        </div>
      </div>

      {ventana && (
        <Suspense fallback={null}>
          {ventana.clase === "nc" && <AnularDocumentoBsale documentoId={ventana.documentoId} onCerrar={() => setVentana(null)} onEmitida={alEmitir} />}
          {ventana.clase === "libre" && <DocumentoLibreBsale tipo={ventana.tipo} cotizacionId={licId} onCerrar={() => setVentana(null)} onEmitida={alEmitir} />}
          {ventana.clase === "oc" && <EmitirDespachoBsale tipo="guia" licitacionId={licId} ocDocId={ventana.ocDocId} onCerrar={() => setVentana(null)} onEmitida={alEmitir} />}
        </Suspense>
      )}
    </div>,
    document.body,
  );
}
