import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { AlertTriangle, Ban, CheckCircle2, ExternalLink, Info, Loader2, Search, X } from "lucide-react";
import { api } from "../lib/api";
import DropdownSelect from "./ui/DropdownSelect";
import VistaPreviaBsale from "./VistaPreviaBsale";

/* ── Anular una factura o boleta con nota de crédito (2026-10-03) ────────────
   Se abre desde Facturación: con el documento ya elegido (fila de Emitidas) o
   vacío, para buscarlo por tipo y N° (sirve para las facturas hechas a mano
   en Bsale). Mismos dos pasos: 1) Simular la nota de crédito, 2) Emitirla.
   Se anula el documento completo; Bsale reingresa el stock. */

const clp = (n) => `$${Math.round(Number(n) || 0).toLocaleString("es-CL")}`;
const fechaCL = (iso) => {
  if (!iso) return "—";
  const [y, m, d] = String(iso).slice(0, 10).split("-");
  return y && m && d ? `${d}-${m}-${y}` : "—";
};
const etiqueta = { fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".4px", color: "var(--text-muted)", display: "block", marginBottom: 4 };
const caja = { border: "1px solid var(--border)", borderRadius: 10, padding: "10px 12px" };
const TIPOS = [{ value: "factura", label: "Factura" }, { value: "boleta", label: "Boleta" }];

export default function AnularDocumentoBsale({ bsaleId = null, documentoId = null, onCerrar, onEmitida }) {
  const [tipo, setTipo] = useState("factura");
  const [numero, setNumero] = useState("");
  const [borrador, setBorrador] = useState(null);
  const [buscando, setBuscando] = useState(false);
  const [error, setError] = useState("");
  const [motivo, setMotivo] = useState("");
  const [tipoDev, setTipoDev] = useState("");
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
      const b = await api.get(`/bsale/anulaciones/preparar?${qs}`);
      setBorrador(b);
      setTipoDev(String(b.tipo_devolucion ?? ""));
    } catch (e) {
      setBorrador(null);
      setError(e?.message || "No se pudo buscar el documento.");
    } finally {
      setBuscando(false);
    }
  }

  useEffect(() => {
    if (bsaleId || documentoId) preparar({ bsale_id: bsaleId, documento_id: documentoId });
    // Solo al abrir: el documento viene elegido desde la lista.
  }, [bsaleId, documentoId]);

  const o = borrador?.original;
  const bloqueado = !!borrador?.problemas?.length;
  const apagada = borrador && borrador.modo !== "activa";
  const firma = JSON.stringify({ id: o?.bsale_id, motivo: motivo.trim(), tipoDev });
  const simulacionVigente = !!resultado?.simulacion && !resultado?.bloqueada && simuladoCon === firma;
  const confirmo = confirmadoCon === firma;
  const listoParaSimular = !!o && !bloqueado && !enviando && motivo.trim().length >= 5 && tipoDev !== "";
  const puedeEmitir = listoParaSimular && !apagada && simulacionVigente && confirmo;
  const tipoElegido = (borrador?.tipos_devolucion || []).find((t) => String(t.id) === String(tipoDev));

  async function enviar(accion) {
    if (enviando || !o) return;
    setEnviando(accion);
    setError("");
    try {
      const cuerpo = { bsale_id: o.bsale_id, ...(documentoId ? { documento_id: documentoId } : {}), motivo: motivo.trim(), tipo_devolucion: Number(tipoDev) };
      const r = await api.post("/bsale/anulaciones/emitir", { ...cuerpo, ...(accion === "simular" ? { simular: true } : { huella }) });
      setResultado(r);
      if (r?.simulacion) { setSimuladoCon(firma); setHuella(r.huella || null); }
      if (r?.emitida) onEmitida?.({ ...r, original: o });
    } catch (e) {
      setError(e?.message || (accion === "simular" ? "No se pudo simular." : "No se pudo emitir la nota de crédito."));
    } finally {
      setEnviando("");
    }
  }

  const cerrar = () => { if (!enviando) onCerrar?.(); };

  return createPortal(
    <div onClick={cerrar} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.55)", zIndex: 11000, display: "flex", padding: 16, overflowY: "auto" }}>
      <div className="modal-emitir-factura modal-anular" onClick={(e) => e.stopPropagation()} style={{ width: 860, maxWidth: "100%", margin: "auto", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-lg)" }}>
        <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
          <div style={{ minWidth: 0 }}>
            <strong style={{ fontSize: 15, display: "inline-flex", alignItems: "center", gap: 7 }}>
              <Ban size={16} style={{ color: "#b91c1c" }} /> Anular factura o boleta
            </strong>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>Se anula con una nota de crédito en Bsale. Paso 1: simular. Paso 2: emitir la nota de crédito oficial.</div>
          </div>
          <button type="button" onClick={cerrar} className="btn btn-ghost" style={{ padding: 6, flexShrink: 0 }} title="Cerrar" disabled={!!enviando}><X size={16} /></button>
        </div>

        <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 14 }}>
          {resultado?.emitida ? (
            <div style={{ border: "1px solid #bbf7d0", background: "#f0fdf4", borderRadius: 10, padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 15, fontWeight: 700, color: "#15803d" }}>
                <CheckCircle2 size={18} /> Nota de crédito N° {resultado.numero} emitida en Bsale
              </div>
              <div style={{ fontSize: 13 }}>
                Anula la {o?.tipo?.toLowerCase()} N° {o?.numero} por {clp(resultado.total || o?.totales?.total)}.{" "}
                {resultado.registrada && borrador?.cotizacion
                  ? <>Quedó registrada en la cotización <Link to={`/detalle/${borrador.cotizacion.id}`} className="table-link" style={{ fontWeight: 700 }}>#{borrador.cotizacion.id}</Link>: Seguimiento de Pagos la descuenta del saldo.</>
                  : "El documento no estaba en ninguna cotización: queda en Bsale y en Emitidas."}
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

              {/* Búsqueda por tipo y N° (cuando no viene elegido) */}
              {!bsaleId && !documentoId && (
                <div style={caja}>
                  <span style={etiqueta}>Documento a anular</span>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
                    <div style={{ flex: "0 1 160px", minWidth: 0 }}>
                      <span style={etiqueta}>Tipo</span>
                      <DropdownSelect value={tipo} onChange={setTipo} options={TIPOS} disabled={buscando || !!enviando} minWidth={140} style={{ width: "100%" }} />
                    </div>
                    <label style={{ flex: "1 1 140px", minWidth: 0 }}>
                      <span style={etiqueta}>N°</span>
                      <input className="input" inputMode="numeric" value={numero} onChange={(e) => setNumero(e.target.value.replace(/[^\d]/g, "").slice(0, 10))} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (numero) preparar({ tipo, numero }); } }} placeholder="Ej: 852" disabled={buscando || !!enviando} style={{ width: "100%" }} />
                    </label>
                    <button type="button" className="btn btn-secondary" onClick={() => preparar({ tipo, numero })} disabled={!numero || buscando || !!enviando} style={{ height: 36 }}>
                      {buscando ? <Loader2 size={14} className="spin" /> : <Search size={14} />} Buscar en Bsale
                    </button>
                  </div>
                </div>
              )}
              {buscando && (bsaleId || documentoId) && <div style={{ fontSize: 13, color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 6 }}><Loader2 size={14} className="spin" /> Buscando el documento en Bsale…</div>}

              {o && (
                <div style={caja}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "baseline" }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 14.5, fontWeight: 700 }}>{o.tipo} N° {o.numero}</div>
                      <div style={{ fontSize: 12.5, color: "var(--text-muted)" }}>Emitida el {fechaCL(o.fecha)} · {o.lineas.length} línea{o.lineas.length === 1 ? "" : "s"}</div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 15, fontWeight: 700 }}>{clp(o.totales.total)}</div>
                      <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>neto {clp(o.totales.neto)}</div>
                    </div>
                  </div>
                  <div style={{ fontSize: 13, marginTop: 6, overflowWrap: "anywhere" }}>
                    {o.cliente ? <><b>{o.cliente.razon_social || "—"}</b> · RUT {o.cliente.rut}</> : <span style={{ color: "var(--text-muted)" }}>Sin cliente (consumidor final)</span>}
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
                  <div style={{ fontSize: 12.5, fontWeight: 700, color: "#b91c1c", display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}><AlertTriangle size={14} /> No se puede anular desde aquí</div>
                  <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: "#7f1d1d", display: "flex", flexDirection: "column", gap: 3 }}>{borrador.problemas.map((p, i) => <li key={i}>{p.mensaje}</li>)}</ul>
                </div>
              )}
              {borrador?.avisos?.length > 0 && !bloqueado && (
                <ul style={{ margin: 0, fontSize: 12.5, color: "#78350f", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 10, padding: "8px 12px 8px 30px" }}>
                  {borrador.avisos.map((a, i) => <li key={i}>{a.mensaje}</li>)}
                </ul>
              )}

              {/* Resultado de la simulación */}
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
                    {!apagada && simulacionVigente ? " Si está bien, abajo puedes emitir la nota de crédito oficial." : ""}
                    {!simulacionVigente ? " Cambiaste el motivo o el tipo después de simular: vuelve a simular." : ""}
                  </div>
                  <VistaPreviaBsale vista={resultado.vista} solicitud={resultado.solicitud} titulo="Así quedaría la nota de crédito" />
                </div>
              )}

              {o && !bloqueado && (
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                  <label style={{ flex: "2 1 300px", minWidth: 0 }}>
                    <span style={etiqueta}>Motivo de la anulación (sale en la nota de crédito)</span>
                    <textarea className="input" value={motivo} onChange={(e) => setMotivo(e.target.value.slice(0, 250))} rows={2} placeholder="Ej: Factura rechazada por el cliente / error en la emisión" disabled={!!enviando} style={{ width: "100%", resize: "vertical", minHeight: 60 }} />
                  </label>
                  <div style={{ flex: "1 1 220px", minWidth: 0 }}>
                    <span style={etiqueta}>Qué pasa con el dinero</span>
                    <DropdownSelect value={tipoDev} onChange={setTipoDev} options={(borrador.tipos_devolucion || []).map((t) => ({ value: String(t.id), label: t.nombre }))} disabled={!!enviando} minWidth={220} style={{ width: "100%" }} />
                    {tipoElegido && <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 4 }}>{tipoElegido.detalle}</div>}
                  </div>
                </div>
              )}

              {o && !bloqueado && !apagada && simulacionVigente && (
                <label style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 13, border: "1px solid var(--border)", borderRadius: 10, padding: "10px 12px", cursor: "pointer" }}>
                  <input type="checkbox" checked={confirmo} onChange={(e) => setConfirmadoCon(e.target.checked ? firma : null)} disabled={!!enviando} style={{ marginTop: 2 }} />
                  <span><b>Paso 2 — emitir la nota de crédito oficial:</b> la simulación está correcta. Entiendo que anula la {o.tipo.toLowerCase()} N° {o.numero} ante el SII y que no se puede deshacer.</span>
                </label>
              )}
              {o && !bloqueado && !apagada && !simulacionVigente && (
                <div style={{ fontSize: 12.5, color: "var(--text-muted)" }}>Escribe el motivo y simula (paso 1). Con la simulación a la vista podrás emitir la nota de crédito (paso 2).</div>
              )}
            </>
          )}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, flexWrap: "wrap", padding: "14px 20px", borderTop: "1px solid var(--border)", background: "var(--bg)", borderRadius: "0 0 var(--radius-lg) var(--radius-lg)" }}>
          <button type="button" onClick={cerrar} disabled={!!enviando} className="btn btn-secondary">{resultado?.emitida ? "Cerrar" : "Cancelar"}</button>
          {!resultado?.emitida && o && !bloqueado && (
            <button type="button" onClick={() => enviar("simular")} disabled={!listoParaSimular} className="btn btn-secondary" style={{ opacity: listoParaSimular ? 1 : 0.5, cursor: listoParaSimular ? "pointer" : "not-allowed" }} title="Muestra la nota de crédito como quedaría. No emite ni guarda nada.">
              {enviando === "simular" ? "Simulando…" : simulacionVigente ? "Simular de nuevo" : "1. Simular"}
            </button>
          )}
          {!resultado?.emitida && o && !bloqueado && !apagada && simulacionVigente && (
            <button type="button" onClick={() => enviar("emitir")} disabled={!puedeEmitir} className="btn btn-primary" style={{ height: "auto", minHeight: 36, whiteSpace: "normal", background: "#b91c1c", borderColor: "#b91c1c", opacity: puedeEmitir ? 1 : 0.5, cursor: puedeEmitir ? "pointer" : "not-allowed" }} title={confirmo ? "" : "Marca la casilla de confirmación"}>
              {enviando === "emitir" ? "Emitiendo…" : `2. Emitir nota de crédito oficial por ${clp(o.totales.total)}`}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
