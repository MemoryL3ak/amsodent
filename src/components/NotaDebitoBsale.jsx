import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { AlertTriangle, CheckCircle2, ExternalLink, FilePlus2, Info, Loader2, Plus, Search, Trash2, X } from "lucide-react";
import { api } from "../lib/api";
import VistaPreviaBsale from "./VistaPreviaBsale";

/* ── Nota de débito sobre una factura (2026-10-07) ───────────────────────────
   Pedido de Ariel: "permitir generar notas de crédito y notas de débito a las
   facturas emitidas". La nota de débito AUMENTA lo que el cliente debe por la
   factura: intereses, diferencia de precio, un flete no cobrado… Las líneas
   son de texto libre (descripción, cantidad y valor neto) y la nota referencia
   la factura. Se abre con la factura elegida (Trazabilidad → Facturas) o vacía
   para buscarla por N°. Mismos dos pasos: simular y emitir. */

const clp = (n) => `$${Math.round(Number(n) || 0).toLocaleString("es-CL")}`;
const fechaCL = (iso) => {
  if (!iso) return "—";
  const [y, m, d] = String(iso).slice(0, 10).split("-");
  return y && m && d ? `${d}-${m}-${y}` : "—";
};
const etiqueta = { fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".4px", color: "var(--text-muted)", display: "block", marginBottom: 4 };
const caja = { border: "1px solid var(--border)", borderRadius: 10, padding: "10px 12px" };
const lineaVacia = () => ({ descripcion: "", cantidad: "1", neto_unitario: "" });

export default function NotaDebitoBsale({ bsaleId = null, documentoId = null, onCerrar, onEmitida }) {
  const [numero, setNumero] = useState("");
  const [borrador, setBorrador] = useState(null);
  const [buscando, setBuscando] = useState(false);
  const [error, setError] = useState("");
  const [motivo, setMotivo] = useState("");
  const [dias, setDias] = useState("30");
  const [lineas, setLineas] = useState([lineaVacia()]);
  const [enviando, setEnviando] = useState("");
  const [resultado, setResultado] = useState(null);
  const [simuladoCon, setSimuladoCon] = useState(null);
  const [huella, setHuella] = useState(null);
  const [confirmadoCon, setConfirmadoCon] = useState(null);

  async function preparar(params) {
    setBuscando(true);
    setError("");
    setResultado(null);
    try {
      const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== "").map(([k, v]) => [k, String(v)])).toString();
      setBorrador(await api.get(`/bsale/anulaciones/debito/preparar?${qs}`));
    } catch (e) {
      setBorrador(null);
      setError(e?.message || "No se pudo buscar la factura.");
    } finally {
      setBuscando(false);
    }
  }

  useEffect(() => {
    if (bsaleId || documentoId) preparar({ bsale_id: bsaleId, documento_id: documentoId });
  }, [bsaleId, documentoId]);

  const o = borrador?.original;
  const bloqueado = !!borrador?.problemas?.length;
  const apagada = borrador && borrador.modo !== "activa";
  const limpias = useMemo(
    () => lineas.map((l) => ({ descripcion: l.descripcion.trim(), cantidad: Number(l.cantidad) || 0, neto_unitario: Math.round(Number(l.neto_unitario) || 0) })).filter((l) => l.descripcion || l.neto_unitario),
    [lineas],
  );
  const lineasOk = limpias.length > 0 && limpias.every((l) => l.descripcion && l.cantidad > 0 && l.neto_unitario > 0);
  const totales = useMemo(() => {
    const neto = limpias.reduce((a, l) => a + Math.round(l.cantidad * l.neto_unitario), 0);
    const iva = Math.round(neto * 0.19);
    return { neto, iva, total: neto + iva };
  }, [limpias]);
  const firma = JSON.stringify({ id: o?.bsale_id, motivo: motivo.trim(), dias, limpias });
  const simulacionVigente = !!resultado?.simulacion && !resultado?.bloqueada && simuladoCon === firma;
  const confirmo = confirmadoCon === firma;
  const listoParaSimular = !!o && !bloqueado && !enviando && motivo.trim().length >= 5 && lineasOk;
  const puedeEmitir = listoParaSimular && !apagada && simulacionVigente && confirmo;

  const cambiar = (i, k, v) => setLineas((xs) => xs.map((l, j) => (j === i ? { ...l, [k]: v } : l)));

  async function enviar(accion) {
    if (enviando || !o) return;
    setEnviando(accion);
    setError("");
    try {
      const cuerpo = { bsale_id: o.bsale_id, ...(documentoId ? { documento_id: documentoId } : {}), motivo: motivo.trim(), dias_vencimiento: Number(dias) || 0, lineas: limpias };
      const r = await api.post("/bsale/anulaciones/debito/emitir", { ...cuerpo, ...(accion === "simular" ? { simular: true } : { huella }) });
      setResultado(r);
      if (r?.simulacion) { setSimuladoCon(firma); setHuella(r.huella || null); }
      if (r?.emitida) onEmitida?.({ ...r, original: o });
    } catch (e) {
      setError(e?.message || (accion === "simular" ? "No se pudo simular." : "No se pudo emitir la nota de débito."));
    } finally {
      setEnviando("");
    }
  }

  const cerrar = () => { if (!enviando) onCerrar?.(); };

  return createPortal(
    <div onClick={cerrar} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.55)", zIndex: 11000, display: "flex", padding: 16, overflowY: "auto" }}>
      <div className="modal-emitir-factura modal-nota-debito" onClick={(e) => e.stopPropagation()} style={{ width: 860, maxWidth: "100%", margin: "auto", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-lg)" }}>
        <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
          <div style={{ minWidth: 0 }}>
            <strong style={{ fontSize: 15, display: "inline-flex", alignItems: "center", gap: 7 }}>
              <FilePlus2 size={16} style={{ color: "#6d28d9" }} /> Nota de débito
            </strong>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>Aumenta lo que el cliente debe por una factura. Paso 1: simular. Paso 2: emitir la nota de débito oficial.</div>
          </div>
          <button type="button" onClick={cerrar} className="btn btn-ghost" style={{ padding: 6, flexShrink: 0 }} title="Cerrar" disabled={!!enviando}><X size={16} /></button>
        </div>

        <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 14 }}>
          {resultado?.emitida ? (
            <div style={{ border: "1px solid #bbf7d0", background: "#f0fdf4", borderRadius: 10, padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 15, fontWeight: 700, color: "#15803d" }}>
                <CheckCircle2 size={18} /> Nota de débito N° {resultado.numero} emitida en Bsale
              </div>
              <div style={{ fontSize: 13 }}>
                Suma {clp(resultado.total || totales.total)} a la factura N° {o?.numero}.{" "}
                {resultado.registrada && borrador?.cotizacion
                  ? <>Quedó registrada en la cotización <Link to={`/detalle/${borrador.cotizacion.id}`} className="table-link" style={{ fontWeight: 700 }}>#{borrador.cotizacion.id}</Link>: Seguimiento de Pagos la suma al saldo.</>
                  : "No quedó en ninguna cotización: queda en Bsale y en Emitidas."}
              </div>
              {(resultado.avisos || []).map((a, i) => <div key={i} style={{ fontSize: 12.5, color: "#92400e" }}>{a}</div>)}
              {resultado.url_pdf && <a href={resultado.url_pdf} target="_blank" rel="noopener noreferrer" className="btn btn-secondary btn-sm" style={{ alignSelf: "flex-start", textDecoration: "none" }}><ExternalLink size={13} /> Ver en Bsale</a>}
            </div>
          ) : (
            <>
              {error && <div style={{ border: "1px solid #fecaca", background: "#fef2f2", color: "#b91c1c", borderRadius: 10, padding: "10px 12px", fontSize: 13, overflowWrap: "anywhere" }}>{error}</div>}
              {apagada && (
                <div style={{ border: "1px solid #fde68a", background: "#fffbeb", color: "#92400e", borderRadius: 10, padding: "10px 12px", fontSize: 12.5, display: "flex", gap: 8 }}>
                  <Info size={15} style={{ flexShrink: 0, marginTop: 1 }} /><span><b>La emisión real está apagada en el servidor.</b> Puedes simular, pero no se emite nada.</span>
                </div>
              )}

              {!bsaleId && !documentoId && (
                <div style={caja}>
                  <span style={etiqueta}>Factura</span>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
                    <label style={{ flex: "1 1 160px", minWidth: 0 }}>
                      <span style={etiqueta}>N° de factura</span>
                      <input className="input" inputMode="numeric" value={numero} onChange={(e) => setNumero(e.target.value.replace(/[^\d]/g, "").slice(0, 10))} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (numero) preparar({ numero }); } }} placeholder="Ej: 852" disabled={buscando || !!enviando} style={{ width: "100%" }} />
                    </label>
                    <button type="button" className="btn btn-secondary" onClick={() => preparar({ numero })} disabled={!numero || buscando || !!enviando} style={{ height: 36 }}>
                      {buscando ? <Loader2 size={14} className="spin" /> : <Search size={14} />} Buscar en Bsale
                    </button>
                  </div>
                </div>
              )}
              {buscando && (bsaleId || documentoId) && <div style={{ fontSize: 13, color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 6 }}><Loader2 size={14} className="spin" /> Buscando la factura en Bsale…</div>}

              {o && (
                <div style={caja}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "baseline" }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 14.5, fontWeight: 700 }}>{o.tipo} N° {o.numero}</div>
                      <div style={{ fontSize: 12.5, color: "var(--text-muted)" }}>Emitida el {fechaCL(o.fecha)}</div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 15, fontWeight: 700 }}>{clp(o.totales.total)}</div>
                      <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>neto {clp(o.totales.neto)}</div>
                    </div>
                  </div>
                  <div style={{ fontSize: 13, marginTop: 6, overflowWrap: "anywhere" }}>
                    {o.cliente ? <><b>{o.cliente.razon_social || "—"}</b> · RUT {o.cliente.rut}</> : <span style={{ color: "var(--text-muted)" }}>Sin cliente</span>}
                  </div>
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 6, fontSize: 12.5 }}>
                    {borrador.cotizacion
                      ? <span>Cotización <Link to={`/detalle/${borrador.cotizacion.id}`} className="table-link" style={{ fontWeight: 700 }}>#{borrador.cotizacion.id}</Link>{borrador.cotizacion.cliente ? ` · ${borrador.cotizacion.cliente}` : ""}</span>
                      : <span style={{ color: "var(--text-muted)" }}>No está en ninguna cotización del sistema</span>}
                    {o.url && <a href={o.url} target="_blank" rel="noopener noreferrer" className="table-link" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><ExternalLink size={12} /> Ver en Bsale</a>}
                  </div>
                </div>
              )}

              {borrador?.problemas?.length > 0 && (
                <div style={{ border: "1px solid #fecaca", background: "#fef2f2", borderRadius: 10, padding: "10px 12px" }}>
                  <div style={{ fontSize: 12.5, fontWeight: 700, color: "#b91c1c", display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}><AlertTriangle size={14} /> No se puede emitir una nota de débito</div>
                  <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: "#7f1d1d", display: "flex", flexDirection: "column", gap: 3 }}>{borrador.problemas.map((p, i) => <li key={i}>{p.mensaje}</li>)}</ul>
                </div>
              )}
              {borrador?.avisos?.length > 0 && !bloqueado && (
                <ul style={{ margin: 0, fontSize: 12.5, color: "#78350f", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 10, padding: "8px 12px 8px 30px" }}>
                  {borrador.avisos.map((a, i) => <li key={i}>{a.mensaje}</li>)}
                </ul>
              )}

              {o && !bloqueado && (
                <div style={caja}>
                  <span style={etiqueta}>Qué se cobra</span>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {lineas.map((l, i) => (
                      <div key={i} className="linea-nd" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
                        <label style={{ flex: "3 1 240px", minWidth: 0 }}>
                          <span style={etiqueta}>Descripción</span>
                          <input className="input" value={l.descripcion} onChange={(e) => cambiar(i, "descripcion", e.target.value.slice(0, 120))} placeholder="Ej: Intereses por mora / Diferencia de precio" disabled={!!enviando} style={{ width: "100%" }} />
                        </label>
                        <label style={{ flex: "0 1 90px", minWidth: 70 }}>
                          <span style={etiqueta}>Cantidad</span>
                          <input className="input" inputMode="decimal" value={l.cantidad} onChange={(e) => cambiar(i, "cantidad", e.target.value.replace(/[^\d.,]/g, "").replace(",", "."))} disabled={!!enviando} style={{ width: "100%", textAlign: "right" }} />
                        </label>
                        <label style={{ flex: "1 1 130px", minWidth: 110 }}>
                          <span style={etiqueta}>Valor neto unit.</span>
                          <input className="input" inputMode="numeric" value={l.neto_unitario} onChange={(e) => cambiar(i, "neto_unitario", e.target.value.replace(/[^\d]/g, ""))} placeholder="$0" disabled={!!enviando} style={{ width: "100%", textAlign: "right" }} />
                        </label>
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setLineas((xs) => (xs.length > 1 ? xs.filter((_, j) => j !== i) : [lineaVacia()]))} disabled={!!enviando} title="Quitar la línea" style={{ height: 36, padding: "0 8px" }}>
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))}
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setLineas((xs) => (xs.length < 20 ? [...xs, lineaVacia()] : xs))} disabled={!!enviando || lineas.length >= 20} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                        <Plus size={14} /> Agregar línea
                      </button>
                      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 12.5 }}>
                        <span>Neto <b>{clp(totales.neto)}</b></span>
                        <span>IVA <b>{clp(totales.iva)}</b></span>
                        <span>Total <b>{clp(totales.total)}</b></span>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {resultado?.simulacion && resultado.bloqueada && (
                <div style={{ border: "1px solid #fecaca", background: "#fef2f2", borderRadius: 10, padding: "10px 12px" }}>
                  <div style={{ fontSize: 12.5, fontWeight: 700, color: "#b91c1c", display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}><AlertTriangle size={14} /> Falta corregir</div>
                  <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: "#7f1d1d" }}>{resultado.problemas.map((p, i) => <li key={i}>{p.mensaje}</li>)}</ul>
                </div>
              )}
              {resultado?.simulacion && !resultado.bloqueada && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <div style={{ border: "1px solid #fde68a", background: "#fffbeb", borderRadius: 10, padding: "10px 14px", fontSize: 12.5, color: "#92400e" }}>
                    <b>Paso 1 listo — simulación: no se emitió nada{resultado.emision_apagada ? " (la emisión real está apagada en el servidor)" : ""}.</b>
                    {!apagada && simulacionVigente ? " Si está bien, abajo puedes emitir la nota de débito oficial." : ""}
                    {!simulacionVigente ? " Cambiaste algo después de simular: vuelve a simular." : ""}
                  </div>
                  <VistaPreviaBsale vista={resultado.vista} solicitud={resultado.solicitud} titulo="Así quedaría la nota de débito" />
                </div>
              )}

              {o && !bloqueado && (
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                  <label style={{ flex: "3 1 300px", minWidth: 0 }}>
                    <span style={etiqueta}>Motivo (va en la referencia a la factura · máx. 90)</span>
                    <input className="input" value={motivo} onChange={(e) => setMotivo(e.target.value.slice(0, 90))} placeholder="Ej: Intereses por pago fuera de plazo" disabled={!!enviando} style={{ width: "100%" }} />
                  </label>
                  <label style={{ flex: "1 1 120px", minWidth: 100 }}>
                    <span style={etiqueta}>Vence en (días)</span>
                    <input className="input" inputMode="numeric" value={dias} onChange={(e) => setDias(e.target.value.replace(/[^\d]/g, "").slice(0, 3))} disabled={!!enviando} style={{ width: "100%" }} />
                  </label>
                </div>
              )}

              {o && !bloqueado && !apagada && simulacionVigente && (
                <label style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 13, border: "1px solid var(--border)", borderRadius: 10, padding: "10px 12px", cursor: "pointer" }}>
                  <input type="checkbox" checked={confirmo} onChange={(e) => setConfirmadoCon(e.target.checked ? firma : null)} disabled={!!enviando} style={{ marginTop: 2 }} />
                  <span><b>Paso 2 — emitir la nota de débito oficial:</b> la simulación está correcta. Entiendo que va al SII, aumenta lo que el cliente debe por la factura N° {o.numero} y que no se puede deshacer.</span>
                </label>
              )}
              {o && !bloqueado && !apagada && !simulacionVigente && (
                <div style={{ fontSize: 12.5, color: "var(--text-muted)" }}>Escribe qué se cobra, el motivo y simula (paso 1). Con la simulación a la vista podrás emitir la nota de débito (paso 2).</div>
              )}
            </>
          )}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, flexWrap: "wrap", padding: "14px 20px", borderTop: "1px solid var(--border)", background: "var(--bg)", borderRadius: "0 0 var(--radius-lg) var(--radius-lg)" }}>
          <button type="button" onClick={cerrar} disabled={!!enviando} className="btn btn-secondary">{resultado?.emitida ? "Cerrar" : "Cancelar"}</button>
          {!resultado?.emitida && o && !bloqueado && (
            <button type="button" onClick={() => enviar("simular")} disabled={!listoParaSimular} className="btn btn-secondary" style={{ opacity: listoParaSimular ? 1 : 0.5, cursor: listoParaSimular ? "pointer" : "not-allowed" }} title="Muestra la nota de débito como quedaría. No emite ni guarda nada.">
              {enviando === "simular" ? "Simulando…" : simulacionVigente ? "Simular de nuevo" : "1. Simular"}
            </button>
          )}
          {!resultado?.emitida && o && !bloqueado && !apagada && simulacionVigente && (
            <button type="button" onClick={() => enviar("emitir")} disabled={!puedeEmitir} className="btn btn-primary" style={{ height: "auto", minHeight: 36, whiteSpace: "normal", background: "#6d28d9", borderColor: "#6d28d9", opacity: puedeEmitir ? 1 : 0.5, cursor: puedeEmitir ? "pointer" : "not-allowed" }} title={confirmo ? "" : "Marca la casilla de confirmación"}>
              {enviando === "emitir" ? "Emitiendo…" : `2. Emitir nota de débito oficial por ${clp(totales.total)}`}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
