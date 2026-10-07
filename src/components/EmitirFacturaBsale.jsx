import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, CheckCircle2, ExternalLink, FileText, Info, Loader2, X } from "lucide-react";
import { api } from "../lib/api";
import DateFilter from "./DateFilter";
import DropdownSelect from "./ui/DropdownSelect";
import VistaPreviaBsale from "./VistaPreviaBsale";
import AvisoCorreoDocumento from "./AvisoCorreoDocumento";
import BotonImprimirCarta from "./BotonImprimirCarta";
import RegistrarComprobanteRapido from "./RegistrarComprobanteRapido";

/* ── Emitir factura en Bsale (2026-10-02) ────────────────────────────────────
   Ventana que se abre desde Trazabilidad sobre una guía sin factura. El
   servidor arma el borrador a partir de la guía que ya existe en Bsale (mismas
   líneas, mismo cliente, referencia a la orden de compra y a la guía) y esta
   ventana solo lo muestra y deja decidir tres cosas: fecha, plazo y forma de
   pago (más corregir el folio de la orden de compra si la guía lo trae mal).

   Dos pasos, en orden. 1) "Simular" muestra el documento como quedaría, sin
   emitir ni guardar nada. 2) Solo con esa simulación a la vista aparece
   "Emitir factura oficial", que emite de verdad: no tiene vuelta atrás —una
   factura enviada al SII solo se anula con nota de crédito—, así que además
   exige marcar la casilla de confirmación. Si después de simular se cambia
   cualquier dato, hay que simular de nuevo. Si el servidor tiene la emisión
   apagada (BSALE_EMISION=off), solo queda simular. */

const clp = (n) => `$${Math.round(Number(n) || 0).toLocaleString("es-CL")}`;
const fechaCL = (iso) => {
  if (!iso) return "—";
  const [y, m, d] = String(iso).slice(0, 10).split("-");
  return y && m && d ? `${d}-${m}-${y}` : "—";
};
function sumarDias(iso, dias) {
  const [y, m, d] = String(iso || "").slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return "";
  return new Date(Date.UTC(y, m - 1, d + (Number(dias) || 0))).toISOString().slice(0, 10);
}
const aFecha = (iso) => (iso ? new Date(`${iso}T00:00:00`) : undefined);

const etiqueta = { fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".4px", color: "var(--text-muted)", display: "block", marginBottom: 4 };

// `guiaDocIds` (opcional) abre la ventana con varias guías ya elegidas: sirve
// para retomar un intento que combinaba más de una.
export default function EmitirFacturaBsale({ licitacionId, guiaDocId, guiaDocIds, onCerrar, onEmitida }) {
  const [seleccion, setSeleccion] = useState(() =>
    (Array.isArray(guiaDocIds) && guiaDocIds.length ? guiaDocIds : [guiaDocId]).map(Number).sort((a, b) => a - b),
  );
  const [borrador, setBorrador] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  // Decisiones del usuario (parten de lo que sugiere el borrador).
  const [fecha, setFecha] = useState("");
  const [dias, setDias] = useState("");
  const [forma, setForma] = useState("");
  const [oc, setOc] = useState("");
  const [enviando, setEnviando] = useState(""); // "" | "simular" | "emitir"
  const [resultado, setResultado] = useState(null);
  /* La simulación vale para ESTOS datos: la firma resume lo que la persona
     decide. Simular guarda la firma; si cambia algo, la simulación caduca y
     la confirmación también (hay que simular y confirmar de nuevo). */
  const firma = JSON.stringify({ seleccion, fecha, dias, forma, oc: oc.trim().toUpperCase() });
  const [simuladoCon, setSimuladoCon] = useState(null);
  const [confirmadoCon, setConfirmadoCon] = useState(null);
  const simulacionVigente = !!resultado?.simulacion && simuladoCon === firma;
  const confirmo = confirmadoCon === firma;
  const setConfirmo = (v) => setConfirmadoCon(v ? firma : null);

  useEffect(() => {
    let vivo = true;
    setCargando(true);
    setError("");
    api
      .post("/bsale/facturas/preparar", { licitacion_id: Number(licitacionId), guia_ids: seleccion })
      .then((b) => {
        if (!vivo) return;
        setBorrador(b);
        // Lo ya decidido se conserva al sumar o quitar una guía.
        setFecha((v) => (v && v >= b.fecha_minima && v <= b.fecha_maxima ? v : b.fecha_emision));
        setDias((v) => (v !== "" ? v : String(b.dias_vencimiento ?? 30)));
        setForma((v) => (v && b.formas_pago.some((f) => String(f.id) === String(v)) ? v : String(b.forma_pago_id ?? "")));
        setOc((b.referencias.find((r) => r.codigo_sii === 801) || {}).numero || "");
      })
      .catch((e) => vivo && setError(e?.message || "No se pudo consultar Bsale."))
      .finally(() => vivo && setCargando(false));
    return () => { vivo = false; };
  }, [licitacionId, seleccion]);

  // El servidor puede tener la emisión real apagada: ahí solo se simula.
  const apagada = borrador?.modo !== "activa";
  const bloqueada = (borrador?.problemas?.length || 0) > 0;
  const variasGuias = (borrador?.guias?.length || 0) > 1;
  const vence = fecha && dias !== "" ? sumarDias(fecha, dias) : "";
  const ocOriginal = (borrador?.referencias?.find((r) => r.codigo_sii === 801) || {}).numero || "";
  const opcionesForma = useMemo(
    () => (borrador?.formas_pago || []).map((f) => ({ value: String(f.id), label: f.nombre })),
    [borrador],
  );

  function alternarGuia(id) {
    setSeleccion((prev) => {
      const tiene = prev.includes(id);
      if (tiene && prev.length === 1) return prev; // al menos una
      return (tiene ? prev.filter((x) => x !== id) : [...prev, id]).sort((a, b) => a - b);
    });
  }

  async function enviar(accion) {
    if (enviando || !borrador) return;
    setEnviando(accion);
    setError("");
    try {
      const r = await api.post("/bsale/facturas/emitir", {
        ...(accion === "simular" ? { simular: true } : {}),
        licitacion_id: Number(licitacionId),
        guia_ids: seleccion,
        fecha_emision: fecha,
        dias_vencimiento: Number(dias),
        forma_pago_id: Number(forma),
        // Solo viaja si se corrigió: el servidor usa la de la guía por defecto.
        ...(borrador.oc_editable && oc.trim() && oc.trim().toUpperCase() !== ocOriginal ? { oc_numero: oc.trim() } : {}),
        huella: borrador.huella,
      });
      setResultado(r);
      if (r?.simulacion) setSimuladoCon(firma);
      if (r?.emitida) onEmitida?.(r);
    } catch (e) {
      setError(e?.message || (accion === "simular" ? "No se pudo simular." : "No se pudo emitir la factura."));
    } finally {
      setEnviando("");
    }
  }

  const cerrar = () => { if (!enviando) onCerrar?.(); };
  const completo = !cargando && !enviando && borrador && !bloqueada && fecha && dias !== "" && forma;
  const puedeSimular = completo;
  // Emitir solo después de simular estos mismos datos (o al registrar una ya emitida).
  const puedeEmitir = completo && !apagada && (borrador.recuperar || (simulacionVigente && confirmo));

  return createPortal(
    <div
      onClick={cerrar}
      style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.55)", zIndex: 11000, display: "flex", padding: 16, overflowY: "auto" }}
    >
      <div
        className="modal-emitir-factura"
        onClick={(e) => e.stopPropagation()}
        style={{ width: 780, maxWidth: "100%", margin: "auto", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-lg)" }}
      >
        <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
          <div style={{ minWidth: 0 }}>
            <strong style={{ fontSize: 15, display: "inline-flex", alignItems: "center", gap: 7 }}>
              <FileText size={16} style={{ color: "var(--primary)", flexShrink: 0 }} /> Emitir factura electrónica en Bsale
            </strong>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2, overflowWrap: "anywhere" }}>
              Cotización #{licitacionId}
              {borrador?.cotizacion?.codigo ? ` · ${borrador.cotizacion.codigo}` : ""}
              {borrador?.cotizacion?.cliente ? ` · ${borrador.cotizacion.cliente}` : ""}
            </div>
          </div>
          <button type="button" onClick={cerrar} className="btn btn-ghost" style={{ padding: 6, flexShrink: 0 }} title="Cerrar" disabled={!!enviando}>
            <X size={16} />
          </button>
        </div>

        <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 14 }}>
          {/* ── Resultado ── */}
          {resultado?.emitida && (
            <div style={{ border: "1px solid #bbf7d0", background: "#f0fdf4", borderRadius: 10, padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 15, fontWeight: 700, color: "#15803d" }}>
                <CheckCircle2 size={18} /> Factura N° {resultado.numero} emitida
              </div>
              <div style={{ fontSize: 13 }}>
                Neto {clp(resultado.neto)} · Total {clp(resultado.total)}.{" "}
                {resultado.registrada ? "Quedó registrada en la cotización, enlazada a su guía." : ""}
              </div>
              <AvisoCorreoDocumento correo={resultado.correo} emitido />
              {(resultado.avisos || []).map((a, i) => (
                <div key={i} style={{ fontSize: 12.5, color: "#92400e" }}>{a}</div>
              ))}
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {resultado.url_pdf && (
                <a href={resultado.url_pdf} target="_blank" rel="noopener noreferrer" className="btn btn-secondary btn-sm" style={{ textDecoration: "none" }}>
                  <ExternalLink size={13} /> Ver la factura en Bsale
                </a>
              )}
              {resultado.bsale_id && <BotonImprimirCarta bsaleId={resultado.bsale_id} etiqueta="Imprimir en carta" />}
              </div>
              {resultado.registrada && resultado.documento_id && (
                <RegistrarComprobanteRapido licitacionId={licitacionId} documentoId={resultado.documento_id} totalBruto={resultado.total} nombreDocumento="la factura" />
              )}
            </div>
          )}
          {resultado?.simulacion && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ border: "1px solid #fde68a", background: "#fffbeb", borderRadius: 10, padding: "10px 14px", fontSize: 12.5, color: "#92400e" }}>
                <b>Paso 1 listo — simulación: no se emitió nada{resultado.emision_apagada ? " (la emisión real está apagada en el servidor)" : ""}.</b>
                {!apagada && simulacionVigente ? " Si está bien, abajo puedes emitir la factura oficial." : ""}
                {!simulacionVigente ? " Cambiaste datos después de simular: vuelve a simular antes de emitir." : ""}
              </div>
              {/* El documento como quedaría, en palabras; el JSON queda plegado. */}
              <VistaPreviaBsale vista={resultado.vista} solicitud={resultado.solicitud} />
            </div>
          )}
          {!resultado?.emitida && (
            <>
              {cargando && (
                <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--text-muted)", fontSize: 13, padding: "18px 0" }}>
                  <Loader2 size={16} className="spin" /> Consultando la guía en Bsale…
                </div>
              )}
              {error && (
                <div style={{ border: "1px solid #fecaca", background: "#fef2f2", color: "#b91c1c", borderRadius: 10, padding: "10px 12px", fontSize: 13, overflowWrap: "anywhere" }}>
                  {error}
                </div>
              )}

              {borrador && !cargando && (
                <>
                  {apagada && (
                    <div style={{ border: "1px solid #fde68a", background: "#fffbeb", color: "#92400e", borderRadius: 10, padding: "10px 12px", fontSize: 12.5, display: "flex", gap: 8 }}>
                      <Info size={15} style={{ flexShrink: 0, marginTop: 1 }} />
                      <span>
                        <b>La emisión real está apagada en el servidor.</b> Puedes revisar el borrador y simular, pero no se
                        emite ninguna factura.
                      </span>
                    </div>
                  )}
                  {borrador.recuperar && (
                    <div style={{ border: "1px solid #bfdbfe", background: "#eff6ff", color: "#1e40af", borderRadius: 10, padding: "10px 12px", fontSize: 12.5, display: "flex", gap: 8 }}>
                      <Info size={15} style={{ flexShrink: 0, marginTop: 1 }} />
                      <span>
                        La factura <b>N° {borrador.recuperar.numero}</b> ya se emitió en Bsale desde este sistema, pero no
                        alcanzó a quedar registrada en la cotización. Al continuar solo se registra: no se emite otra.
                      </span>
                    </div>
                  )}
                  {bloqueada && (
                    <div style={{ border: "1px solid #fecaca", background: "#fef2f2", borderRadius: 10, padding: "10px 12px" }}>
                      <div style={{ fontSize: 12.5, fontWeight: 700, color: "#b91c1c", display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                        <AlertTriangle size={14} /> No se puede emitir
                      </div>
                      <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: "#7f1d1d", display: "flex", flexDirection: "column", gap: 3 }}>
                        {borrador.problemas.map((p, i) => <li key={i}>{p.mensaje}</li>)}
                      </ul>
                    </div>
                  )}
                  {(borrador.avisos?.length || 0) > 0 && (
                    <div style={{ border: "1px solid #fde68a", background: "#fffbeb", borderRadius: 10, padding: "10px 12px" }}>
                      <div style={{ fontSize: 12.5, fontWeight: 700, color: "#92400e", marginBottom: 4 }}>Revisa antes de emitir</div>
                      <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: "#78350f", display: "flex", flexDirection: "column", gap: 3 }}>
                        {borrador.avisos.map((p, i) => <li key={i}>{p.mensaje}</li>)}
                      </ul>
                    </div>
                  )}

                  {/* Cliente y guías */}
                  <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                    <div style={{ flex: "2 1 280px", minWidth: 0, border: "1px solid var(--border)", borderRadius: 10, padding: "10px 12px" }}>
                      <span style={etiqueta}>Cliente (según Bsale)</span>
                      {borrador.cliente ? (
                        <div style={{ fontSize: 13, lineHeight: 1.45, overflowWrap: "anywhere" }}>
                          <div style={{ fontWeight: 600 }}>{borrador.cliente.razon_social || "—"}</div>
                          <div>RUT {borrador.cliente.rut || "—"}</div>
                          <div style={{ color: "var(--text-muted)", fontSize: 12 }}>
                            {[borrador.cliente.giro, borrador.cliente.direccion, borrador.cliente.comuna].filter(Boolean).join(" · ") || "Sin giro ni dirección"}
                          </div>
                        </div>
                      ) : (
                        <div style={{ fontSize: 13, color: "var(--text-muted)" }}>Sin cliente.</div>
                      )}
                    </div>
                    <div style={{ flex: "1 1 200px", minWidth: 0, border: "1px solid var(--border)", borderRadius: 10, padding: "10px 12px" }}>
                      <span style={etiqueta}>Guías que se facturan</span>
                      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                        {(borrador.guias_disponibles || []).map((g) => (
                          <label key={g.doc_id} style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 13, cursor: enviando ? "default" : "pointer" }}>
                            <input
                              type="checkbox"
                              checked={seleccion.includes(g.doc_id)}
                              onChange={() => alternarGuia(g.doc_id)}
                              disabled={!!enviando || (seleccion.includes(g.doc_id) && seleccion.length === 1)}
                            />
                            <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>
                              Guía <b>{g.numero}</b>
                              <span style={{ color: "var(--text-muted)", fontSize: 12 }}> · {fechaCL(g.fecha)}</span>
                              {/* Nota que alguien dejó junto al número ("NO FACTURAR HASTA…") */}
                              {g.nota && <span style={{ display: "block", fontSize: 11.5, color: "#92400e" }}>«{g.nota}»</span>}
                            </span>
                          </label>
                        ))}
                        {(borrador.guias_disponibles || []).length === 0 && (
                          <div style={{ fontSize: 12.5, color: "var(--text-muted)" }}>
                            {borrador.guias.map((g) => `Guía ${g.numero}`).join(", ") || "—"}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Líneas */}
                  <div style={{ border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden" }}>
                    <div style={{ maxHeight: 250, overflow: "auto" }}>
                      <table className="data-table" style={{ width: "100%", minWidth: 520 }}>
                        <thead>
                          <tr>
                            {variasGuias && <th style={{ textAlign: "left" }}>Guía</th>}
                            <th style={{ textAlign: "left" }}>SKU</th>
                            <th style={{ textAlign: "left" }}>Producto</th>
                            <th style={{ textAlign: "right" }}>Cant.</th>
                            <th style={{ textAlign: "right" }}>Neto unit.</th>
                            <th style={{ textAlign: "right" }}>Neto</th>
                          </tr>
                        </thead>
                        <tbody>
                          {borrador.lineas.map((l) => (
                            <tr key={l.detalle_id}>
                              {variasGuias && <td style={{ whiteSpace: "nowrap" }}>{l.guia}</td>}
                              <td style={{ whiteSpace: "nowrap", fontWeight: 600 }}>{l.sku || "—"}</td>
                              <td style={{ overflowWrap: "anywhere" }}>
                                {l.producto || "—"}
                                {l.nota && <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{l.nota}</div>}
                              </td>
                              <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>{Number(l.cantidad).toLocaleString("es-CL")}</td>
                              <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>{clp(l.neto_unitario)}</td>
                              <td style={{ textAlign: "right", whiteSpace: "nowrap", fontWeight: 600 }}>{clp(l.neto)}</td>
                            </tr>
                          ))}
                          {borrador.lineas.length === 0 && (
                            <tr><td colSpan={variasGuias ? 6 : 5} style={{ textAlign: "center", color: "var(--text-muted)", padding: 18 }}>Sin productos.</td></tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                    <div style={{ display: "flex", justifyContent: "flex-end", flexWrap: "wrap", gap: "4px 22px", padding: "10px 14px", borderTop: "1px solid var(--border)", background: "var(--bg)", fontSize: 13 }}>
                      <span>Neto <b>{clp(borrador.totales.neto)}</b></span>
                      <span>IVA 19% <b>{clp(borrador.totales.iva)}</b></span>
                      <span style={{ fontSize: 14 }}>Total <b>{clp(borrador.totales.total)}</b></span>
                    </div>
                  </div>

                  {/* Decisiones */}
                  <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                    <div style={{ flex: "1 1 150px", minWidth: 0 }}>
                      <span style={etiqueta}>Fecha de emisión</span>
                      <DateFilter value={fecha} onChange={setFecha} minDate={aFecha(borrador.fecha_minima)} maxDate={aFecha(borrador.fecha_maxima)} disabled={!!enviando} placeholder="Fecha" />
                    </div>
                    <label style={{ flex: "1 1 130px", minWidth: 0 }}>
                      <span style={etiqueta}>Vence en (días)</span>
                      <input
                        className="input"
                        inputMode="numeric"
                        value={dias}
                        onChange={(e) => setDias(e.target.value.replace(/[^\d]/g, "").slice(0, 3))}
                        disabled={!!enviando}
                        style={{ width: "100%" }}
                      />
                      <span style={{ fontSize: 11.5, color: "var(--text-muted)" }}>{vence ? `Vence el ${fechaCL(vence)}` : " "}</span>
                    </label>
                    <div style={{ flex: "1 1 190px", minWidth: 0 }}>
                      <span style={etiqueta}>Forma de pago</span>
                      <DropdownSelect value={forma} onChange={setForma} options={opcionesForma} disabled={!!enviando} minWidth={190} style={{ width: "100%" }} />
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
                    {borrador.oc_editable && (
                      <label style={{ flex: "1 1 220px", minWidth: 0 }}>
                        <span style={etiqueta}>N° orden de compra (referencia)</span>
                        <input className="input" value={oc} maxLength={18} onChange={(e) => setOc(e.target.value)} disabled={!!enviando} style={{ width: "100%" }} />
                      </label>
                    )}
                    {borrador.oc_editable && borrador.oc_del_sistema && oc.trim().toUpperCase() !== borrador.oc_del_sistema && (
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => setOc(borrador.oc_del_sistema)} disabled={!!enviando} style={{ height: "auto", minHeight: 30, whiteSpace: "normal", textAlign: "left", padding: "5px 10px" }}>
                        Usar la del sistema: {borrador.oc_del_sistema}
                      </button>
                    )}
                    <div style={{ flex: "2 1 240px", minWidth: 0, fontSize: 12, color: "var(--text-muted)", lineHeight: 1.45, overflowWrap: "anywhere" }}>
                      La factura referencia:{" "}
                      {borrador.referencias.map((r) => (r.codigo_sii === 801 ? `orden de compra ${borrador.oc_editable ? (oc.trim().toUpperCase() || r.numero) : r.numero}` : `guía ${r.folio}`)).join(" · ") || "nada"}.
                      Las líneas quedan enlazadas a la guía, así que el stock no se descuenta de nuevo.
                    </div>
                  </div>

                  {!apagada && !borrador.recuperar && !bloqueada && simulacionVigente && (
                    <label style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 13, border: "1px solid var(--border)", borderRadius: 10, padding: "10px 12px", cursor: "pointer" }}>
                      <input type="checkbox" checked={confirmo} onChange={(e) => setConfirmo(e.target.checked)} disabled={!!enviando} style={{ marginTop: 2 }} />
                      <span>
                        <b>Paso 2 — emitir la factura oficial:</b> la simulación está correcta. Entiendo que la factura se
                        envía al SII y que solo se puede anular con una nota de crédito.
                      </span>
                    </label>
                  )}
                  {!apagada && !borrador.recuperar && !bloqueada && !simulacionVigente && (
                    <div style={{ fontSize: 12.5, color: "var(--text-muted)" }}>
                      Primero simula (paso 1). Con la simulación a la vista podrás emitir la factura oficial (paso 2).
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, flexWrap: "wrap", padding: "14px 20px", borderTop: "1px solid var(--border)", background: "var(--bg)", borderRadius: "0 0 var(--radius-lg) var(--radius-lg)" }}>
          <button type="button" onClick={cerrar} disabled={!!enviando} className="btn btn-secondary">
            {resultado?.emitida ? "Cerrar" : "Cancelar"}
          </button>
          {/* Simular: muestra lo que se enviaría. No emite ni guarda nada. */}
          {!resultado?.emitida && !borrador?.recuperar && (
            <button
              type="button"
              onClick={() => enviar("simular")}
              disabled={!puedeSimular}
              className="btn btn-secondary"
              style={{ opacity: puedeSimular ? 1 : 0.5, cursor: puedeSimular ? "pointer" : "not-allowed" }}
              title="Muestra exactamente lo que se le enviaría a Bsale. No emite ni guarda nada."
            >
              {enviando === "simular" ? "Simulando…" : simulacionVigente ? "Simular de nuevo" : "1. Simular"}
            </button>
          )}
          {/* Emitir: la factura real. Solo tras simular, y con la casilla marcada. */}
          {!resultado?.emitida && !apagada && (borrador?.recuperar || simulacionVigente) && (
            <button
              type="button"
              onClick={() => enviar("emitir")}
              disabled={!puedeEmitir}
              className="btn btn-primary"
              style={{ height: "auto", minHeight: 36, whiteSpace: "normal", opacity: puedeEmitir ? 1 : 0.5, cursor: puedeEmitir ? "pointer" : "not-allowed" }}
              title={borrador?.recuperar || confirmo || bloqueada ? "" : "Marca la casilla de confirmación para emitir"}
            >
              {enviando === "emitir"
                ? "Emitiendo…"
                : borrador?.recuperar
                  ? `Registrar la factura ${borrador.recuperar.numero}`
                  : `2. Emitir factura oficial por ${clp(borrador?.totales?.total)}`}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
