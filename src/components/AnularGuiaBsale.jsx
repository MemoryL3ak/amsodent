import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { AlertTriangle, Ban, CheckCircle2, ExternalLink, Info, Loader2, Search, X } from "lucide-react";
import { api } from "../lib/api";
import { refrescarEstadosBsale } from "../lib/estadosBsale";

/* ── Anular una guía de despacho en Bsale (2026-10-16) ───────────────────────
   Pedido de Ariel: "podemos anular guías de despacho desde nuestra
   plataforma". Se abre con la guía ya elegida (Facturación, documentos de la
   cotización) o vacía, para buscarla por N°. No se anula una guía ya anulada
   ni una con factura vigente. Mismos dos pasos: 1) Simular, 2) Anular. Al
   anular se muestra el stock de cada producto antes y después. */

const fechaCL = (iso) => {
  if (!iso) return "—";
  const [y, m, d] = String(iso).slice(0, 10).split("-");
  return y && m && d ? `${d}-${m}-${y}` : "—";
};
const etiqueta = { fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".4px", color: "var(--text-muted)", display: "block", marginBottom: 4 };
const caja = { border: "1px solid var(--border)", borderRadius: 10, padding: "10px 12px" };
const celda = { padding: "6px 8px", borderBottom: "1px solid #f0f2f5", fontSize: 12.5, verticalAlign: "middle" };
const n = (v) => (v == null ? "—" : Number(v).toLocaleString("es-CL"));

export default function AnularGuiaBsale({ bsaleId = null, documentoId = null, onCerrar, onAnulada }) {
  const [numero, setNumero] = useState("");
  const [borrador, setBorrador] = useState(null);
  const [buscando, setBuscando] = useState(false);
  const [error, setError] = useState("");
  const [motivo, setMotivo] = useState("");
  const [enviando, setEnviando] = useState("");
  const [resultado, setResultado] = useState(null);
  const [simuladoCon, setSimuladoCon] = useState(null);
  const [confirmadoCon, setConfirmadoCon] = useState(null);

  async function preparar(params) {
    setBuscando(true);
    setError("");
    setResultado(null);
    try {
      const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== "").map(([k, v]) => [k, String(v)])).toString();
      setBorrador(await api.get(`/bsale/anulaciones/guia/preparar?${qs}`));
    } catch (e) {
      setBorrador(null);
      setError(e?.message || "No se pudo buscar la guía.");
    } finally {
      setBuscando(false);
    }
  }

  useEffect(() => {
    if (bsaleId || documentoId) preparar({ bsale_id: bsaleId, documento_id: documentoId });
    // Solo al abrir: la guía viene elegida desde la lista.
  }, [bsaleId, documentoId]);

  const g = borrador?.guia;
  const bloqueado = !!borrador?.problemas?.length;
  const apagada = borrador && borrador.modo !== "activa";
  const firma = JSON.stringify({ id: g?.bsale_id, motivo: motivo.trim() });
  const simulacionVigente = !!resultado?.simulacion && !resultado?.bloqueada && simuladoCon === firma;
  const confirmo = confirmadoCon === firma;
  const listoParaSimular = !!g && !bloqueado && !enviando;
  const puedeAnular = listoParaSimular && !apagada && simulacionVigente && confirmo;

  async function enviar(accion) {
    if (enviando || !g) return;
    setEnviando(accion);
    setError("");
    try {
      const cuerpo = { bsale_id: g.bsale_id, ...(borrador?.registro?.documento_id ? { documento_id: borrador.registro.documento_id } : {}), motivo: motivo.trim() };
      const r = await api.post("/bsale/anulaciones/guia/anular", { ...cuerpo, ...(accion === "simular" ? { simular: true } : { huella: borrador.huella }) });
      setResultado(r);
      if (r?.simulacion) setSimuladoCon(firma);
      if (r?.anulada != null) {
        refrescarEstadosBsale(); // la guía sale «Anulada en Bsale» en todas las pantallas
        onAnulada?.(r);
      }
    } catch (e) {
      setError(e?.message || (accion === "simular" ? "No se pudo simular." : "No se pudo anular la guía."));
    } finally {
      setEnviando("");
    }
  }

  const cerrar = () => { if (!enviando) onCerrar?.(); };
  const hecho = resultado && resultado.anulada != null;

  return createPortal(
    <div onClick={cerrar} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.55)", zIndex: 11000, display: "flex", padding: 16, overflowY: "auto" }}>
      <div className="modal-anular-guia" onClick={(e) => e.stopPropagation()} style={{ width: 760, maxWidth: "100%", margin: "auto", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-lg)" }}>
        <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
          <div style={{ minWidth: 0 }}>
            <strong style={{ fontSize: 15, display: "inline-flex", alignItems: "center", gap: 7 }}>
              <Ban size={16} style={{ color: "#b91c1c" }} /> Anular guía de despacho
            </strong>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>Se anula en Bsale. Paso 1: simular. Paso 2: anular.</div>
          </div>
          <button type="button" onClick={cerrar} className="btn btn-ghost" style={{ padding: 6, flexShrink: 0 }} title="Cerrar" disabled={!!enviando}><X size={16} /></button>
        </div>

        <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 14 }}>
          {hecho ? (
            <div style={{ border: `1px solid ${resultado.anulada ? "#bbf7d0" : "#fde68a"}`, background: resultado.anulada ? "#f0fdf4" : "#fffbeb", borderRadius: 10, padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 15, fontWeight: 700, color: resultado.anulada ? "#15803d" : "#92400e" }}>
                {resultado.anulada ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
                {resultado.anulada ? `Guía N° ${resultado.numero} anulada en Bsale` : `Bsale respondió, pero la guía N° ${resultado.numero} sigue vigente`}
              </div>
              {resultado.cotizacion && (
                <div style={{ fontSize: 13 }}>
                  Queda en la cotización <Link to={`/detalle/${resultado.cotizacion.id}`} className="table-link" style={{ fontWeight: 700 }}>#{resultado.cotizacion.id}</Link> como «Anulada en Bsale» y deja de contar como despachada.
                </div>
              )}
              {(resultado.stock || []).length > 0 && (
                <div style={{ overflowX: "auto" }}>
                  <table className="tabla-stock-anulacion" style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr>
                        <th style={{ ...celda, textAlign: "left", fontSize: 11 }}>Producto</th>
                        <th style={{ ...celda, textAlign: "right", fontSize: 11 }}>En la guía</th>
                        <th style={{ ...celda, textAlign: "right", fontSize: 11 }}>Stock antes</th>
                        <th style={{ ...celda, textAlign: "right", fontSize: 11 }}>Stock ahora</th>
                      </tr>
                    </thead>
                    <tbody>
                      {resultado.stock.map((l, i) => (
                        <tr key={i}>
                          <td style={{ ...celda, maxWidth: 240 }}><div style={{ fontWeight: 600, overflowWrap: "anywhere" }}>{l.producto || "—"}</div>{l.sku && <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{l.sku}</div>}</td>
                          <td style={{ ...celda, textAlign: "right" }}>{n(l.cantidad)}</td>
                          <td style={{ ...celda, textAlign: "right" }}>{n(l.antes)}</td>
                          <td style={{ ...celda, textAlign: "right", fontWeight: 600, color: l.diferencia > 0 ? "#15803d" : undefined }}>{n(l.despues)}{l.diferencia ? ` (${l.diferencia > 0 ? "+" : ""}${n(l.diferencia)})` : ""}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {(resultado.avisos || []).map((a, i) => <div key={i} style={{ fontSize: 12.5, color: "#92400e" }}>{a}</div>)}
            </div>
          ) : (
            <>
              {error && <div style={{ border: "1px solid #fecaca", background: "#fef2f2", color: "#b91c1c", borderRadius: 10, padding: "10px 12px", fontSize: 13, overflowWrap: "anywhere" }}>{error}</div>}
              {apagada && (
                <div style={{ border: "1px solid #fde68a", background: "#fffbeb", color: "#92400e", borderRadius: 10, padding: "10px 12px", fontSize: 12.5, display: "flex", gap: 8 }}>
                  <Info size={15} style={{ flexShrink: 0, marginTop: 1 }} /><span><b>La emisión real está apagada en el servidor.</b> Puedes simular, pero no se anula nada.</span>
                </div>
              )}

              {!bsaleId && !documentoId && (
                <div style={caja}>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
                    <label style={{ flex: "1 1 160px", minWidth: 0 }}>
                      <span style={etiqueta}>N° de la guía</span>
                      <input className="input" inputMode="numeric" value={numero} onChange={(e) => setNumero(e.target.value.replace(/[^\d]/g, "").slice(0, 10))} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (numero) preparar({ numero }); } }} placeholder="Ej: 910" disabled={buscando || !!enviando} style={{ width: "100%" }} />
                    </label>
                    <button type="button" className="btn btn-secondary" onClick={() => preparar({ numero })} disabled={!numero || buscando || !!enviando} style={{ height: 36 }}>
                      {buscando ? <Loader2 size={14} className="spin" /> : <Search size={14} />} Buscar en Bsale
                    </button>
                  </div>
                </div>
              )}
              {buscando && (bsaleId || documentoId) && <div style={{ fontSize: 13, color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 6 }}><Loader2 size={14} className="spin" /> Buscando la guía en Bsale…</div>}

              {g && (
                <div style={caja}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "baseline" }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 14.5, fontWeight: 700 }}>Guía de despacho N° {g.numero}</div>
                      <div style={{ fontSize: 12.5, color: "var(--text-muted)" }}>Emitida el {fechaCL(g.fecha)} · {g.lineas.length} línea{g.lineas.length === 1 ? "" : "s"}</div>
                    </div>
                    <div style={{ fontSize: 13, color: "var(--text-muted)" }}>neto ${n(g.totales?.neto)}</div>
                  </div>
                  <div style={{ fontSize: 13, marginTop: 6, overflowWrap: "anywhere" }}>
                    {g.cliente ? <><b>{g.cliente.razon_social || "—"}</b> · RUT {g.cliente.rut}</> : <span style={{ color: "var(--text-muted)" }}>Sin cliente</span>}
                  </div>
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 6, fontSize: 12.5 }}>
                    {borrador.cotizacion
                      ? <span>Cotización <Link to={`/detalle/${borrador.cotizacion.id}`} className="table-link" style={{ fontWeight: 700 }}>#{borrador.cotizacion.id}</Link>{borrador.cotizacion.cliente ? ` · ${borrador.cotizacion.cliente}` : ""}</span>
                      : <span style={{ color: "var(--text-muted)" }}>No está en ninguna cotización del sistema</span>}
                    {g.url && <a href={g.url} target="_blank" rel="noopener noreferrer" className="table-link" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><ExternalLink size={12} /> Ver en Bsale</a>}
                  </div>
                  {g.lineas.length > 0 && (
                    <div style={{ overflowX: "auto", marginTop: 8 }}>
                      <table className="tabla-lineas-guia" style={{ width: "100%", borderCollapse: "collapse" }}>
                        <thead>
                          <tr style={{ background: "var(--bg)" }}>
                            <th style={{ ...celda, textAlign: "left", fontSize: 11 }}>Producto</th>
                            <th style={{ ...celda, textAlign: "right", fontSize: 11 }}>Cantidad</th>
                            <th style={{ ...celda, textAlign: "right", fontSize: 11 }}>Stock hoy en Bsale</th>
                          </tr>
                        </thead>
                        <tbody>
                          {g.lineas.map((l, i) => (
                            <tr key={i}>
                              <td style={{ ...celda, maxWidth: 280 }}><div style={{ fontWeight: 600, overflowWrap: "anywhere" }}>{l.producto || "—"}</div>{l.sku && <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{l.sku}</div>}</td>
                              <td style={{ ...celda, textAlign: "right" }}>{n(l.cantidad)}</td>
                              <td style={{ ...celda, textAlign: "right" }}>{n(l.stock_bsale)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {borrador?.problemas?.length > 0 && (
                <div style={{ border: "1px solid #fecaca", background: "#fef2f2", borderRadius: 10, padding: "10px 12px" }}>
                  <div style={{ fontSize: 12.5, fontWeight: 700, color: "#b91c1c", display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}><AlertTriangle size={14} /> No se puede anular</div>
                  <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: "#7f1d1d", display: "flex", flexDirection: "column", gap: 3 }}>{borrador.problemas.map((p, i) => <li key={i}>{p.mensaje}</li>)}</ul>
                </div>
              )}
              {borrador?.avisos?.length > 0 && !bloqueado && (
                <ul style={{ margin: 0, fontSize: 12.5, color: "#78350f", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 10, padding: "8px 12px 8px 30px" }}>
                  {borrador.avisos.map((a, i) => <li key={i}>{a.mensaje}</li>)}
                </ul>
              )}

              {g && !bloqueado && (
                <label>
                  <span style={etiqueta}>Motivo (opcional, queda anotado en el sistema)</span>
                  <textarea className="input" value={motivo} onChange={(e) => setMotivo(e.target.value.slice(0, 200))} rows={2} placeholder="Ej: dirección de despacho equivocada / el cliente no recibió" disabled={!!enviando} style={{ width: "100%", resize: "vertical", minHeight: 56 }} />
                </label>
              )}

              {resultado?.simulacion && resultado.bloqueada && (
                <div style={{ border: "1px solid #fecaca", background: "#fef2f2", borderRadius: 10, padding: "10px 12px" }}>
                  <div style={{ fontSize: 12.5, fontWeight: 700, color: "#b91c1c", display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}><AlertTriangle size={14} /> Falta corregir</div>
                  <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: "#7f1d1d" }}>{resultado.problemas.map((p, i) => <li key={i}>{p.mensaje}</li>)}</ul>
                </div>
              )}
              {resultado?.simulacion && !resultado.bloqueada && (
                <div className="simulacion-anular-guia" style={{ border: "1px solid #fde68a", background: "#fffbeb", borderRadius: 10, padding: "10px 14px", fontSize: 12.5, color: "#92400e" }}>
                  <b>Paso 1 listo — simulación: no se anuló nada{resultado.emision_apagada ? " (la emisión real está apagada en el servidor)" : ""}.</b>
                  {" "}Se anularía en Bsale el despacho {resultado.despacho_id} de la guía N° {g?.numero}.
                  {!apagada && simulacionVigente ? " Si está bien, abajo puedes anularla." : ""}
                  {!simulacionVigente ? " Cambiaste algo después de simular: vuelve a simular." : ""}
                </div>
              )}

              {g && !bloqueado && !apagada && simulacionVigente && (
                <label style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 13, border: "1px solid var(--border)", borderRadius: 10, padding: "10px 12px", cursor: "pointer" }}>
                  <input type="checkbox" checked={confirmo} onChange={(e) => setConfirmadoCon(e.target.checked ? firma : null)} disabled={!!enviando} style={{ marginTop: 2 }} />
                  <span><b>Paso 2 — anular la guía:</b> la simulación está correcta. Entiendo que la guía N° {g.numero} queda anulada en Bsale y ante el SII, y que no se puede deshacer.</span>
                </label>
              )}
              {g && !bloqueado && !apagada && !simulacionVigente && (
                <div style={{ fontSize: 12.5, color: "var(--text-muted)" }}>Simula (paso 1). Con la simulación a la vista podrás anular la guía (paso 2).</div>
              )}
            </>
          )}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, flexWrap: "wrap", padding: "14px 20px", borderTop: "1px solid var(--border)", background: "var(--bg)", borderRadius: "0 0 var(--radius-lg) var(--radius-lg)" }}>
          <button type="button" onClick={cerrar} disabled={!!enviando} className="btn btn-secondary">{hecho ? "Cerrar" : "Cancelar"}</button>
          {!hecho && g && !bloqueado && (
            <button type="button" onClick={() => enviar("simular")} disabled={!listoParaSimular} className="btn btn-secondary" style={{ opacity: listoParaSimular ? 1 : 0.5 }} title="Revisa la anulación. No anula nada.">
              {enviando === "simular" ? "Simulando…" : simulacionVigente ? "Simular de nuevo" : "1. Simular"}
            </button>
          )}
          {!hecho && g && !bloqueado && !apagada && simulacionVigente && (
            <button type="button" onClick={() => enviar("anular")} disabled={!puedeAnular} className="btn btn-primary" style={{ height: "auto", minHeight: 36, whiteSpace: "normal", background: "#b91c1c", borderColor: "#b91c1c", opacity: puedeAnular ? 1 : 0.5, cursor: puedeAnular ? "pointer" : "not-allowed" }} title={confirmo ? "" : "Marca la casilla de confirmación"}>
              {enviando === "anular" ? "Anulando…" : `2. Anular guía N° ${g.numero}`}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
