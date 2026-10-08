import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { AlertTriangle, Ban, CheckCircle2, ExternalLink, Info, Loader2, Search, X } from "lucide-react";
import { api } from "../lib/api";
import { refrescarEstadosBsale } from "../lib/estadosBsale";
import DropdownSelect from "./ui/DropdownSelect";
import VistaPreviaBsale from "./VistaPreviaBsale";

/* ── Nota de crédito sobre una factura o boleta (2026-10-03 · 2026-10-07) ────
   Se abre desde Facturación o desde Trazabilidad → Facturas: con el documento
   ya elegido o vacío, para buscarlo por tipo y N° (sirve para las facturas
   hechas a mano en Bsale). Tres modos:
   · Anular completa: todo el documento; Bsale reingresa el stock.
   · Devolución parcial: cuánto de cada línea; Bsale reingresa ese stock.
   · Ajuste de precio: rebaja por unidad, sin devolver productos.
   Mismos dos pasos: 1) Simular la nota de crédito, 2) Emitirla. */

const clp = (n) => `$${Math.round(Number(n) || 0).toLocaleString("es-CL")}`;
const fechaCL = (iso) => {
  if (!iso) return "—";
  const [y, m, d] = String(iso).slice(0, 10).split("-");
  return y && m && d ? `${d}-${m}-${y}` : "—";
};
const etiqueta = { fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".4px", color: "var(--text-muted)", display: "block", marginBottom: 4 };
const caja = { border: "1px solid var(--border)", borderRadius: 10, padding: "10px 12px" };
const TIPOS = [{ value: "factura", label: "Factura" }, { value: "boleta", label: "Boleta" }];
const num = (v) => String(v ?? "").replace(/[^\d.,]/g, "").replace(",", ".");

export default function AnularDocumentoBsale({ bsaleId = null, documentoId = null, modoInicial = "total", onCerrar, onEmitida }) {
  const [tipo, setTipo] = useState("factura");
  const [numero, setNumero] = useState("");
  const [borrador, setBorrador] = useState(null);
  const [buscando, setBuscando] = useState(false);
  const [error, setError] = useState("");
  const [motivo, setMotivo] = useState("");
  const [tipoDev, setTipoDev] = useState("");
  const [modo, setModo] = useState(modoInicial);
  const [cantidades, setCantidades] = useState({}); // detalle_id → texto
  const [rebajas, setRebajas] = useState({}); // detalle_id → texto (ajuste)
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
      // Con notas previas no se puede anular completa: se parte en devolución parcial.
      if ((b.previas || []).length && modoInicial === "total") setModo("parcial");
      setCantidades({});
      setRebajas({});
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bsaleId, documentoId]);

  const o = borrador?.original;
  const bloqueado = !!borrador?.problemas?.length;
  const apagada = borrador && borrador.modo !== "activa";
  const conPrevias = (borrador?.previas || []).length > 0;

  // Líneas elegidas según el modo y su total (lo mismo que calcula el servidor).
  const elegidas = useMemo(() => {
    if (!o) return [];
    if (modo === "total") return o.lineas.map((l) => ({ ...l, valor: l.neto_unitario }));
    return o.lineas
      .map((l) => {
        const cant = Number(cantidades[l.detalle_id] ?? (modo === "ajuste" ? l.cantidad : 0)) || 0;
        const valor = modo === "ajuste" ? Math.round(Number(rebajas[l.detalle_id]) || 0) : l.neto_unitario;
        return { ...l, cantidad: cant, valor };
      })
      .filter((l) => l.cantidad > 0 && l.valor > 0);
  }, [o, modo, cantidades, rebajas]);
  const totales = useMemo(() => {
    if (!o) return { neto: 0, iva: 0, total: 0 };
    if (modo === "total") return o.totales;
    const neto = elegidas.reduce((a, l) => a + Math.round(l.cantidad * l.valor), 0);
    const iva = Math.round(neto * 0.19);
    return { neto, iva, total: neto + iva };
  }, [o, modo, elegidas]);
  const errores = useMemo(() => {
    if (!o || modo === "total") return [];
    const e = [];
    for (const l of o.lineas) {
      const cant = Number(cantidades[l.detalle_id] ?? (modo === "ajuste" ? l.cantidad : 0)) || 0;
      if (modo === "parcial" && cant > l.disponible) e.push(`${l.sku || l.producto}: hasta ${l.disponible}`);
      if (modo === "ajuste") {
        const r = Number(rebajas[l.detalle_id]) || 0;
        if (cant > l.cantidad) e.push(`${l.sku || l.producto}: la factura tiene ${l.cantidad}`);
        if (r > l.neto_unitario) e.push(`${l.sku || l.producto}: la rebaja supera su precio`);
      }
    }
    if (borrador?.saldo && totales.total > Number(borrador.saldo.disponible) + 2) e.push(`el total supera el saldo del documento (${clp(borrador.saldo.disponible)})`);
    return e;
  }, [o, modo, cantidades, rebajas, totales, borrador]);

  const firma = JSON.stringify({ id: o?.bsale_id, motivo: motivo.trim(), tipoDev, modo, lineas: elegidas.map((l) => [l.detalle_id, l.cantidad, l.valor]) });
  const simulacionVigente = !!resultado?.simulacion && !resultado?.bloqueada && simuladoCon === firma;
  const confirmo = confirmadoCon === firma;
  const listoParaSimular = !!o && !bloqueado && !enviando && motivo.trim().length >= 5 && tipoDev !== "" && (modo === "total" ? !conPrevias : elegidas.length > 0 && !errores.length);
  const puedeEmitir = listoParaSimular && !apagada && simulacionVigente && confirmo;
  const tipoElegido = (borrador?.tipos_devolucion || []).find((t) => String(t.id) === String(tipoDev));
  const titulo = modo === "total" ? "Anular factura o boleta" : modo === "parcial" ? "Nota de crédito · devolución parcial" : "Nota de crédito · ajuste de precio";

  async function enviar(accion) {
    if (enviando || !o) return;
    setEnviando(accion);
    setError("");
    try {
      const cuerpo = {
        bsale_id: o.bsale_id,
        ...(documentoId ? { documento_id: documentoId } : {}),
        motivo: motivo.trim(),
        tipo_devolucion: tipoDev,
        modo,
        ...(modo === "parcial" ? { lineas: elegidas.map((l) => ({ detalle_id: l.detalle_id, cantidad: l.cantidad })) } : {}),
        ...(modo === "ajuste" ? { lineas: elegidas.map((l) => ({ detalle_id: l.detalle_id, cantidad: l.cantidad, neto_unitario: l.valor })) } : {}),
      };
      const r = await api.post("/bsale/anulaciones/emitir", { ...cuerpo, ...(accion === "simular" ? { simular: true } : { huella }) });
      setResultado(r);
      if (r?.simulacion) { setSimuladoCon(firma); setHuella(r.huella || null); }
      if (r?.emitida) {
        refrescarEstadosBsale(); // la factura se ve anulada / con NC en todas las pantallas
        onEmitida?.({ ...r, original: o });
      }
    } catch (e) {
      setError(e?.message || (accion === "simular" ? "No se pudo simular." : "No se pudo emitir la nota de crédito."));
    } finally {
      setEnviando("");
    }
  }

  const cerrar = () => { if (!enviando) onCerrar?.(); };
  const celda = { padding: "6px 8px", borderBottom: "1px solid #f0f2f5", fontSize: 12.5, verticalAlign: "middle" };

  return createPortal(
    <div onClick={cerrar} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.55)", zIndex: 11000, display: "flex", padding: 16, overflowY: "auto" }}>
      <div className="modal-emitir-factura modal-anular" onClick={(e) => e.stopPropagation()} style={{ width: 900, maxWidth: "100%", margin: "auto", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-lg)" }}>
        <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
          <div style={{ minWidth: 0 }}>
            <strong style={{ fontSize: 15, display: "inline-flex", alignItems: "center", gap: 7 }}>
              <Ban size={16} style={{ color: "#b91c1c" }} /> {titulo}
            </strong>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>Nota de crédito en Bsale. Paso 1: simular. Paso 2: emitir la nota de crédito oficial.</div>
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
                {modo === "total" ? "Anula" : modo === "parcial" ? "Devolución parcial de" : "Ajuste de precio de"} la {o?.tipo?.toLowerCase()} N° {o?.numero} por {clp(resultado.total || totales.total)}.{" "}
                {resultado.registrada && borrador?.cotizacion
                  ? <>Quedó registrada en la cotización <Link to={`/detalle/${borrador.cotizacion.id}`} className="table-link" style={{ fontWeight: 700 }}>#{borrador.cotizacion.id}</Link>: Seguimiento de Pagos la descuenta del saldo.</>
                  : "El documento no estaba en ninguna cotización: queda en Bsale y en Emitidas."}
              </div>
              {resultado.pendiente_devolver > 0 && (
                <div className="aviso-devolucion" style={{ fontSize: 13, fontWeight: 600, color: "#b91c1c" }}>
                  Queda una devolución pendiente de {clp(resultado.pendiente_devolver)}: regístrala en Trazabilidad → Facturas cuando se le devuelva el dinero al cliente (admin y contabilidad ya tienen el aviso).
                </div>
              )}
              {resultado.saldo_favor > 0 && (
                <div className="aviso-saldo-favor" style={{ fontSize: 13, fontWeight: 600, color: "#1d4ed8" }}>
                  El cliente queda con {clp(resultado.saldo_favor)} a favor: aplícalo a otra factura suya desde Trazabilidad → Facturas.
                </div>
              )}
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
                  <span style={etiqueta}>Documento</span>
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
                      <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>neto {clp(o.totales.neto)}{conPrevias ? ` · saldo ${clp(borrador.saldo?.disponible)}` : ""}</div>
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
                  <div style={{ fontSize: 12.5, fontWeight: 700, color: "#b91c1c", display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}><AlertTriangle size={14} /> No se puede emitir una nota de crédito</div>
                  <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: "#7f1d1d", display: "flex", flexDirection: "column", gap: 3 }}>{borrador.problemas.map((p, i) => <li key={i}>{p.mensaje}</li>)}</ul>
                </div>
              )}
              {borrador?.avisos?.length > 0 && !bloqueado && (
                <ul style={{ margin: 0, fontSize: 12.5, color: "#78350f", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 10, padding: "8px 12px 8px 30px" }}>
                  {borrador.avisos.map((a, i) => <li key={i}>{a.mensaje}</li>)}
                </ul>
              )}

              {/* Modo de la nota */}
              {o && !bloqueado && (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <div className="segmentado modos-nc" style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {(borrador.modos || []).map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        className={`btn btn-sm ${modo === m.id ? "btn-primary" : "btn-secondary"}`}
                        onClick={() => { setModo(m.id); setCantidades({}); setRebajas({}); }}
                        disabled={!!enviando || (m.id === "total" && conPrevias)}
                        title={m.id === "total" && conPrevias ? "Ya tiene notas de crédito: usa devolución parcial o ajuste para el saldo" : m.detalle}
                      >
                        {m.nombre}
                      </button>
                    ))}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{(borrador.modos || []).find((m) => m.id === modo)?.detalle}</div>
                </div>
              )}

              {/* Líneas: cuánto devolver o cuánto rebajar */}
              {o && !bloqueado && modo !== "total" && (
                <div style={{ ...caja, padding: 0, overflowX: "auto" }}>
                  <table className="tabla-lineas-nc" style={{ width: "100%", borderCollapse: "collapse", minWidth: 560 }}>
                    <thead>
                      <tr style={{ background: "var(--bg)" }}>
                        <th style={{ ...celda, textAlign: "left", fontSize: 11 }}>Producto</th>
                        <th style={{ ...celda, textAlign: "right", fontSize: 11 }}>Facturado</th>
                        {modo === "parcial" && <th style={{ ...celda, textAlign: "right", fontSize: 11 }}>Ya devuelto</th>}
                        <th style={{ ...celda, textAlign: "right", fontSize: 11 }}>Neto unit.</th>
                        <th style={{ ...celda, textAlign: "right", fontSize: 11 }}>{modo === "parcial" ? "A devolver" : "Unidades"}</th>
                        {modo === "ajuste" && <th style={{ ...celda, textAlign: "right", fontSize: 11 }}>Rebaja por unidad</th>}
                        <th style={{ ...celda, textAlign: "right", fontSize: 11 }}>Neto NC</th>
                      </tr>
                    </thead>
                    <tbody>
                      {o.lineas.map((l) => {
                        const cant = cantidades[l.detalle_id] ?? (modo === "ajuste" ? String(l.cantidad) : "");
                        const valor = modo === "ajuste" ? Math.round(Number(rebajas[l.detalle_id]) || 0) : l.neto_unitario;
                        const sub = Math.round((Number(cant) || 0) * valor);
                        const agotada = modo === "parcial" && l.disponible <= 0;
                        return (
                          <tr key={l.detalle_id} style={{ opacity: agotada ? 0.5 : 1 }}>
                            <td style={{ ...celda, maxWidth: 260 }}>
                              <div style={{ fontWeight: 600, overflowWrap: "anywhere" }}>{l.producto || "—"}</div>
                              {l.sku && <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{l.sku}</div>}
                            </td>
                            <td style={{ ...celda, textAlign: "right" }}>{l.cantidad}</td>
                            {modo === "parcial" && <td style={{ ...celda, textAlign: "right", color: l.devuelto ? "#b45309" : "var(--text-muted)" }}>{l.devuelto || "—"}</td>}
                            <td style={{ ...celda, textAlign: "right", whiteSpace: "nowrap" }}>{clp(l.neto_unitario)}</td>
                            <td style={{ ...celda, textAlign: "right" }}>
                              <input className="input" inputMode="decimal" value={cant} onChange={(e) => setCantidades((x) => ({ ...x, [l.detalle_id]: num(e.target.value) }))} disabled={!!enviando || agotada} placeholder={modo === "parcial" ? `máx ${l.disponible}` : ""} style={{ width: 84, textAlign: "right", height: 30 }} />
                            </td>
                            {modo === "ajuste" && (
                              <td style={{ ...celda, textAlign: "right" }}>
                                <input className="input" inputMode="numeric" value={rebajas[l.detalle_id] ?? ""} onChange={(e) => setRebajas((x) => ({ ...x, [l.detalle_id]: e.target.value.replace(/[^\d]/g, "") }))} disabled={!!enviando} placeholder="$0" style={{ width: 96, textAlign: "right", height: 30 }} />
                              </td>
                            )}
                            <td style={{ ...celda, textAlign: "right", whiteSpace: "nowrap", fontWeight: 600 }}>{sub ? clp(sub) : "—"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  <div style={{ display: "flex", justifyContent: "flex-end", gap: 14, flexWrap: "wrap", padding: "8px 12px", fontSize: 12.5 }}>
                    <span>Neto <b>{clp(totales.neto)}</b></span>
                    <span>IVA <b>{clp(totales.iva)}</b></span>
                    <span>Total nota de crédito <b>{clp(totales.total)}</b></span>
                  </div>
                  {errores.length > 0 && <div style={{ padding: "0 12px 10px", fontSize: 12, color: "#b91c1c" }}>Revisa: {errores.join(" · ")}.</div>}
                </div>
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
                    {!simulacionVigente ? " Cambiaste algo después de simular: vuelve a simular." : ""}
                  </div>
                  <VistaPreviaBsale vista={resultado.vista} solicitud={resultado.solicitud} titulo="Así quedaría la nota de crédito" />
                </div>
              )}

              {o && !bloqueado && (
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                  <label style={{ flex: "2 1 300px", minWidth: 0 }}>
                    <span style={etiqueta}>Motivo (sale en la nota de crédito)</span>
                    <textarea className="input" value={motivo} onChange={(e) => setMotivo(e.target.value.slice(0, 250))} rows={2} placeholder={modo === "total" ? "Ej: Factura rechazada por el cliente / error en la emisión" : modo === "parcial" ? "Ej: Devolución de 2 cajas dañadas" : "Ej: Descuento acordado con el cliente"} disabled={!!enviando} style={{ width: "100%", resize: "vertical", minHeight: 60 }} />
                  </label>
                  <div style={{ flex: "1 1 220px", minWidth: 0 }}>
                    <span style={etiqueta}>Qué pasa con el dinero</span>
                    <DropdownSelect value={tipoDev} onChange={setTipoDev} options={(borrador.tipos_devolucion || []).map((t) => ({ value: String(t.id), label: t.nombre }))} disabled={!!enviando} minWidth={220} style={{ width: "100%" }} />
                    {tipoElegido && <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 4 }}>{tipoElegido.detalle}</div>}
                    {borrador.pago && (
                      <div className="pago-registrado" style={{ fontSize: 11.5, marginTop: 4, color: borrador.pago.bruto > 0 ? "#b45309" : "var(--text-muted)" }}>
                        {borrador.pago.bruto > 0
                          ? `El cliente tiene pagados ${clp(borrador.pago.bruto)}${borrador.pago.fecha ? ` (${String(borrador.pago.fecha).slice(0, 10).split("-").reverse().join("-")}${borrador.pago.medio ? `, ${borrador.pago.medio}` : ""})` : ""}: elige si se le devuelven o quedan a su favor.`
                          : "Sin pagos registrados en el sistema para este documento."}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {o && !bloqueado && !apagada && simulacionVigente && (
                <label style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 13, border: "1px solid var(--border)", borderRadius: 10, padding: "10px 12px", cursor: "pointer" }}>
                  <input type="checkbox" checked={confirmo} onChange={(e) => setConfirmadoCon(e.target.checked ? firma : null)} disabled={!!enviando} style={{ marginTop: 2 }} />
                  <span><b>Paso 2 — emitir la nota de crédito oficial:</b> la simulación está correcta. Entiendo que {modo === "total" ? "anula" : "rebaja"} la {o.tipo.toLowerCase()} N° {o.numero} ante el SII y que no se puede deshacer.</span>
                </label>
              )}
              {o && !bloqueado && !apagada && !simulacionVigente && (
                <div style={{ fontSize: 12.5, color: "var(--text-muted)" }}>
                  {modo === "total" ? "Escribe el motivo y simula (paso 1)." : modo === "parcial" ? "Indica cuánto se devuelve de cada producto, el motivo y simula (paso 1)." : "Indica la rebaja por unidad, el motivo y simula (paso 1)."} Con la simulación a la vista podrás emitir la nota de crédito (paso 2).
                </div>
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
              {enviando === "emitir" ? "Emitiendo…" : `2. Emitir nota de crédito oficial por ${clp(totales.total)}`}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
