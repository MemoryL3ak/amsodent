import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, CheckCircle2, ExternalLink, Info, Loader2, Truck, X } from "lucide-react";
import { api } from "../lib/api";
import DateFilter from "./DateFilter";
import DropdownSelect from "./ui/DropdownSelect";
import VistaPreviaBsale from "./VistaPreviaBsale";

/* ── Emitir guía de despacho / registrar orden en Bsale (2026-10-02) ─────────
   Ventana del módulo Facturación para una orden de compra:
   · tipo "guia": el servidor dice qué productos tiene la cotización, cuánto
     se despachó ya según Bsale y cuánto falta; acá se elige cuánto va en
     esta guía, a dónde se despacha y con qué tipo de traslado.
   · tipo "orden": registra la orden del cliente en Bsale como nota de venta
     (todos los productos, sin elegir cantidades).
   Dos pasos, en orden: 1) Simular muestra el documento como quedaría, sin
   emitir; 2) solo con esa simulación a la vista aparece Emitir (real, con
   casilla de confirmación). Si se cambia algo después de simular, hay que
   simular de nuevo. */

const clp = (n) => `$${Math.round(Number(n) || 0).toLocaleString("es-CL")}`;
const aFecha = (iso) => (iso ? new Date(`${iso}T00:00:00`) : undefined);
const etiqueta = { fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".4px", color: "var(--text-muted)", display: "block", marginBottom: 4 };
const ruta = (tipo) => (tipo === "orden" ? "/bsale/despachos/orden" : "/bsale/despachos/guia");

export default function EmitirDespachoBsale({ tipo = "guia", licitacionId, ocDocId, onCerrar, onEmitida }) {
  const esGuia = tipo !== "orden";
  const [borrador, setBorrador] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [cantidades, setCantidades] = useState({});
  const [despacho, setDespacho] = useState(null);
  const [cliente, setCliente] = useState(null);
  const [fecha, setFecha] = useState("");
  const [enviando, setEnviando] = useState("");
  const [resultado, setResultado] = useState(null);
  // La simulación y la confirmación valen para estos datos; si cambian, caducan.
  const firma = JSON.stringify({ cantidades, despacho, cliente, fecha });
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
      .post(`${ruta(tipo)}/preparar`, { licitacion_id: Number(licitacionId), oc_doc_id: Number(ocDocId) })
      .then((b) => {
        if (!vivo) return;
        setBorrador(b);
        setFecha(b.fecha_emision);
        setCantidades(Object.fromEntries((b.lineas || []).map((l) => [l.sku, l.en_bsale ? String(esGuia ? l.pendiente : l.cantidad) : "0"])));
        setDespacho(b.despacho ? { ...b.despacho } : null);
        setCliente(b.cliente ? { ...b.cliente } : null);
      })
      .catch((e) => vivo && setError(e?.message || "No se pudo consultar Bsale."))
      .finally(() => vivo && setCargando(false));
    return () => { vivo = false; };
  }, [tipo, licitacionId, ocDocId, esGuia]);

  const apagada = borrador?.modo !== "activa";
  const bloqueada = (borrador?.problemas?.length || 0) > 0;
  const lineasElegidas = useMemo(
    () => (borrador?.lineas || []).filter((l) => l.en_bsale && Number(cantidades[l.sku]) > 0).map((l) => ({ ...l, cantidad: Number(cantidades[l.sku]) })),
    [borrador, cantidades],
  );
  const totales = useMemo(() => {
    const neto = Math.round(lineasElegidas.reduce((a, l) => a + l.cantidad * (Number(l.neto_unitario) || 0), 0));
    const iva = Math.round(neto * 0.19);
    return { neto, iva, total: neto + iva };
  }, [lineasElegidas]);
  const excesos = useMemo(() => (borrador?.lineas || []).filter((l) => esGuia && Number(cantidades[l.sku]) > l.pendiente + 1e-9), [borrador, cantidades, esGuia]);
  const opcionesTraslado = useMemo(() => (borrador?.tipos_traslado || []).map((t) => ({ value: String(t.id), label: t.nombre })), [borrador]);

  function cambiarCantidad(sku, v) {
    setCantidades((prev) => ({ ...prev, [sku]: v.replace(/[^\d.,]/g, "").replace(",", ".") }));
  }
  function todoPendiente() {
    setCantidades(Object.fromEntries((borrador?.lineas || []).map((l) => [l.sku, l.en_bsale ? String(l.pendiente) : "0"])));
  }

  async function enviar(accion) {
    if (enviando || !borrador) return;
    setEnviando(accion);
    setError("");
    try {
      const r = await api.post(`${ruta(tipo)}/emitir`, {
        ...(accion === "simular" ? { simular: true } : {}),
        licitacion_id: Number(licitacionId),
        oc_doc_id: Number(ocDocId),
        fecha_emision: fecha,
        huella: borrador.huella,
        ...(esGuia ? { lineas: lineasElegidas.map((l) => ({ sku: l.sku, cantidad: l.cantidad })), despacho: { ...despacho, tipo_traslado_id: Number(despacho?.tipo_traslado_id) } } : {}),
        ...(cliente?.nuevo ? { cliente } : {}),
      });
      setResultado(r);
      if (r?.simulacion) setSimuladoCon(firma);
      if (r?.emitida) onEmitida?.(r);
    } catch (e) {
      setError(e?.message || (accion === "simular" ? "No se pudo simular." : "No se pudo emitir."));
    } finally {
      setEnviando("");
    }
  }

  const cerrar = () => { if (!enviando) onCerrar?.(); };
  const faltaDespacho = esGuia && despacho && (!despacho.direccion?.trim() || !despacho.comuna?.trim() || !despacho.ciudad?.trim() || !despacho.destinatario?.trim() || !despacho.tipo_traslado_id);
  const faltaCliente = cliente?.nuevo && (!cliente.rut?.trim() || !cliente.razon_social?.trim() || !cliente.giro?.trim() || !cliente.direccion?.trim() || !cliente.comuna?.trim());
  const completo = !cargando && !enviando && borrador && !bloqueada && fecha && !excesos.length && !faltaDespacho && !faltaCliente && (esGuia ? lineasElegidas.length > 0 : true);
  const puedeEmitir = completo && !apagada && simulacionVigente && confirmo;
  const titulo = esGuia ? "Emitir guía de despacho en Bsale" : "Registrar la orden en Bsale";
  const verbo = esGuia ? "Emitir guía" : "Registrar orden";

  const campo = (obj, setObj, k, label, props = {}) => (
    <label style={{ flex: "1 1 160px", minWidth: 0 }}>
      <span style={etiqueta}>{label}</span>
      <input className="input" value={obj?.[k] || ""} onChange={(e) => setObj((p) => ({ ...p, [k]: e.target.value }))} disabled={!!enviando} style={{ width: "100%" }} {...props} />
    </label>
  );

  return createPortal(
    <div onClick={cerrar} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.55)", zIndex: 11000, display: "flex", padding: 16, overflowY: "auto" }}>
      <div className="modal-emitir-factura" onClick={(e) => e.stopPropagation()} style={{ width: 820, maxWidth: "100%", margin: "auto", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-lg)" }}>
        <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
          <div style={{ minWidth: 0 }}>
            <strong style={{ fontSize: 15, display: "inline-flex", alignItems: "center", gap: 7 }}>
              <Truck size={16} style={{ color: "var(--primary)", flexShrink: 0 }} /> {titulo}
            </strong>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2, overflowWrap: "anywhere" }}>
              Cotización #{licitacionId}{borrador?.cotizacion?.codigo ? ` · ${borrador.cotizacion.codigo}` : ""}{borrador?.cotizacion?.cliente ? ` · ${borrador.cotizacion.cliente}` : ""}
              {borrador?.oc?.numero ? ` · OC ${borrador.oc.numero}` : ""}
            </div>
          </div>
          <button type="button" onClick={cerrar} className="btn btn-ghost" style={{ padding: 6, flexShrink: 0 }} title="Cerrar" disabled={!!enviando}><X size={16} /></button>
        </div>

        <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 14 }}>
          {resultado?.emitida && (
            <div style={{ border: "1px solid #bbf7d0", background: "#f0fdf4", borderRadius: 10, padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 15, fontWeight: 700, color: "#15803d" }}>
                <CheckCircle2 size={18} /> {esGuia ? "Guía" : "Orden"} N° {resultado.numero} {esGuia ? "emitida" : "registrada"} en Bsale
              </div>
              <div style={{ fontSize: 13 }}>
                {resultado.total ? `Total ${clp(resultado.total)}. ` : ""}
                {resultado.registrada ? (esGuia ? "Quedó en Trazabilidad como guía de esta orden de compra; desde ahí se emite la factura." : "La orden de compra quedó enlazada a su nota de venta.") : ""}
              </div>
              {(resultado.avisos || []).map((a, i) => <div key={i} style={{ fontSize: 12.5, color: "#92400e" }}>{a}</div>)}
              {resultado.url_pdf && (
                <a href={resultado.url_pdf} target="_blank" rel="noopener noreferrer" className="btn btn-secondary btn-sm" style={{ alignSelf: "flex-start", textDecoration: "none" }}>
                  <ExternalLink size={13} /> Ver en Bsale
                </a>
              )}
            </div>
          )}
          {resultado?.simulacion && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ border: "1px solid #fde68a", background: "#fffbeb", borderRadius: 10, padding: "10px 14px", fontSize: 12.5, color: "#92400e" }}>
                <b>Paso 1 listo — simulación: no se emitió nada{resultado.emision_apagada ? " (la emisión real está apagada en el servidor)" : ""}.</b>
                {!apagada && simulacionVigente ? ` Si está bien, abajo puedes ${esGuia ? "emitir la guía oficial" : "registrar la orden oficial"}.` : ""}
                {!simulacionVigente ? " Cambiaste datos después de simular: vuelve a simular antes de emitir." : ""}
              </div>
              <VistaPreviaBsale vista={resultado.vista} solicitud={resultado.solicitud} />
            </div>
          )}

          {!resultado?.emitida && (
            <>
              {cargando && <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--text-muted)", fontSize: 13, padding: "18px 0" }}><Loader2 size={16} className="spin" /> Consultando la orden en Bsale…</div>}
              {error && <div style={{ border: "1px solid #fecaca", background: "#fef2f2", color: "#b91c1c", borderRadius: 10, padding: "10px 12px", fontSize: 13, overflowWrap: "anywhere" }}>{error}</div>}

              {borrador && !cargando && (
                <>
                  {apagada && (
                    <div style={{ border: "1px solid #fde68a", background: "#fffbeb", color: "#92400e", borderRadius: 10, padding: "10px 12px", fontSize: 12.5, display: "flex", gap: 8 }}>
                      <Info size={15} style={{ flexShrink: 0, marginTop: 1 }} /><span><b>La emisión real está apagada en el servidor.</b> Puedes revisar y simular, pero no se emite nada.</span>
                    </div>
                  )}
                  {bloqueada && (
                    <div style={{ border: "1px solid #fecaca", background: "#fef2f2", borderRadius: 10, padding: "10px 12px" }}>
                      <div style={{ fontSize: 12.5, fontWeight: 700, color: "#b91c1c", display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}><AlertTriangle size={14} /> No se puede {esGuia ? "emitir" : "registrar"}</div>
                      <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: "#7f1d1d", display: "flex", flexDirection: "column", gap: 3 }}>{borrador.problemas.map((p, i) => <li key={i}>{p.mensaje}</li>)}</ul>
                    </div>
                  )}
                  {(borrador.avisos?.length || 0) > 0 && (
                    <div style={{ border: "1px solid #fde68a", background: "#fffbeb", borderRadius: 10, padding: "10px 12px" }}>
                      <div style={{ fontSize: 12.5, fontWeight: 700, color: "#92400e", marginBottom: 4 }}>Revisa antes de {esGuia ? "emitir" : "registrar"}</div>
                      <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: "#78350f", display: "flex", flexDirection: "column", gap: 3 }}>{borrador.avisos.map((p, i) => <li key={i}>{p.mensaje}</li>)}</ul>
                    </div>
                  )}

                  {/* Cliente */}
                  <div style={{ border: "1px solid var(--border)", borderRadius: 10, padding: "10px 12px" }}>
                    <span style={etiqueta}>Cliente {cliente?.nuevo ? "(nuevo en Bsale: revisa los datos)" : "(según Bsale)"}</span>
                    {cliente?.nuevo ? (
                      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                        {campo(cliente, setCliente, "razon_social", "Razón social", { style: { width: "100%" } })}
                        {campo(cliente, setCliente, "rut", "RUT")}
                        {campo(cliente, setCliente, "giro", "Giro", { placeholder: "Obligatorio para Bsale" })}
                        {campo(cliente, setCliente, "direccion", "Dirección")}
                        {campo(cliente, setCliente, "comuna", "Comuna")}
                        {campo(cliente, setCliente, "ciudad", "Ciudad")}
                        {campo(cliente, setCliente, "email", "Correo (opcional)")}
                      </div>
                    ) : (
                      <div style={{ fontSize: 13, lineHeight: 1.45, overflowWrap: "anywhere" }}>
                        <div style={{ fontWeight: 600 }}>{cliente?.razon_social || "—"}</div>
                        <div>RUT {cliente?.rut || "—"}</div>
                        <div style={{ color: "var(--text-muted)", fontSize: 12 }}>{[cliente?.giro, cliente?.direccion, cliente?.comuna].filter(Boolean).join(" · ") || "Sin giro ni dirección"}</div>
                      </div>
                    )}
                  </div>

                  {/* Líneas */}
                  <div style={{ border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "8px 12px", background: "var(--bg)", borderBottom: "1px solid var(--border)" }}>
                      <span style={{ ...etiqueta, marginBottom: 0 }}>{esGuia ? "Qué va en esta guía" : "Productos de la orden"}</span>
                      {esGuia && (
                        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", fontSize: 12, color: "var(--text-muted)" }}>
                          {borrador.guias_bsale?.length ? <span>Guías ya emitidas en Bsale para esta orden: {borrador.guias_bsale.map((g) => g.numero).join(", ")}</span> : <span>Sin guías anteriores en Bsale.</span>}
                          <button type="button" className="btn btn-secondary btn-sm" onClick={todoPendiente} disabled={!!enviando}>Todo lo pendiente</button>
                        </div>
                      )}
                    </div>
                    <div style={{ maxHeight: 280, overflow: "auto" }}>
                      <table className="data-table" style={{ width: "100%", minWidth: 640 }}>
                        <thead>
                          <tr>
                            <th style={{ textAlign: "left" }}>SKU</th>
                            <th style={{ textAlign: "left" }}>Producto</th>
                            <th style={{ textAlign: "right" }}>Cotizado</th>
                            {esGuia && <th style={{ textAlign: "right" }} title="Según las guías emitidas en Bsale para esta orden">Despachado</th>}
                            {esGuia && <th style={{ textAlign: "right" }}>Falta</th>}
                            <th style={{ textAlign: "right" }}>{esGuia ? "Esta guía" : "Cantidad"}</th>
                            <th style={{ textAlign: "right" }}>Neto unit.</th>
                            <th style={{ textAlign: "right" }}>Neto</th>
                          </tr>
                        </thead>
                        <tbody>
                          {borrador.lineas.map((l) => {
                            const cant = Number(cantidades[l.sku]) || 0;
                            const exceso = esGuia && cant > l.pendiente + 1e-9;
                            return (
                              <tr key={l.sku} style={{ opacity: l.en_bsale ? 1 : 0.55 }}>
                                <td style={{ whiteSpace: "nowrap", fontWeight: 600 }}>{l.sku}{!l.en_bsale && <div style={{ fontSize: 10.5, color: "#b91c1c", fontWeight: 600 }}>No está en Bsale</div>}</td>
                                <td style={{ whiteSpace: "normal", overflowWrap: "anywhere" }}>{l.producto || "—"}{l.formato ? <span style={{ color: "var(--text-muted)", fontSize: 11 }}> · {l.formato}</span> : null}</td>
                                <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>{Number(esGuia ? l.cotizado : l.cantidad).toLocaleString("es-CL")}</td>
                                {esGuia && <td style={{ textAlign: "right", whiteSpace: "nowrap", color: "var(--text-muted)" }}>{Number(l.despachado).toLocaleString("es-CL")}</td>}
                                {esGuia && <td style={{ textAlign: "right", whiteSpace: "nowrap", fontWeight: 600, color: l.pendiente > 0 ? "#b45309" : "#15803d" }}>{Number(l.pendiente).toLocaleString("es-CL")}</td>}
                                <td style={{ textAlign: "right" }}>
                                  {esGuia ? (
                                    <input
                                      className="input"
                                      inputMode="decimal"
                                      value={cantidades[l.sku] ?? ""}
                                      onChange={(e) => cambiarCantidad(l.sku, e.target.value)}
                                      disabled={!!enviando || !l.en_bsale || l.pendiente <= 0}
                                      style={{ width: 84, height: 30, padding: "2px 8px", textAlign: "right", borderColor: exceso ? "#dc2626" : undefined }}
                                      title={exceso ? `No puede superar lo que falta (${l.pendiente})` : ""}
                                    />
                                  ) : (
                                    <span style={{ whiteSpace: "nowrap" }}>{Number(l.cantidad).toLocaleString("es-CL")}</span>
                                  )}
                                </td>
                                <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>{clp(l.neto_unitario)}</td>
                                <td style={{ textAlign: "right", whiteSpace: "nowrap", fontWeight: 600 }}>{clp(cant * (Number(l.neto_unitario) || 0))}</td>
                              </tr>
                            );
                          })}
                          {borrador.lineas.length === 0 && <tr><td colSpan={esGuia ? 8 : 6} style={{ textAlign: "center", color: "var(--text-muted)", padding: 18 }}>Sin productos.</td></tr>}
                        </tbody>
                      </table>
                    </div>
                    <div style={{ display: "flex", justifyContent: "flex-end", flexWrap: "wrap", gap: "4px 22px", padding: "10px 14px", borderTop: "1px solid var(--border)", background: "var(--bg)", fontSize: 13 }}>
                      <span>Neto <b>{clp(totales.neto)}</b></span>
                      <span>IVA 19% <b>{clp(totales.iva)}</b></span>
                      <span style={{ fontSize: 14 }}>Total <b>{clp(totales.total)}</b></span>
                    </div>
                  </div>
                  {excesos.length > 0 && <div style={{ fontSize: 12.5, color: "#b91c1c" }}>Hay cantidades mayores a lo que falta: {excesos.map((l) => l.sku).join(", ")}.</div>}

                  {/* Despacho y fecha */}
                  <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                    <div style={{ flex: "1 1 150px", minWidth: 0 }}>
                      <span style={etiqueta}>Fecha de emisión</span>
                      <DateFilter value={fecha} onChange={setFecha} minDate={aFecha(borrador.fecha_minima)} maxDate={aFecha(borrador.fecha_maxima)} disabled={!!enviando} placeholder="Fecha" />
                    </div>
                    {esGuia && despacho && (
                      <div style={{ flex: "1 1 220px", minWidth: 0 }}>
                        <span style={etiqueta}>Tipo de traslado</span>
                        <DropdownSelect value={String(despacho.tipo_traslado_id || "")} onChange={(v) => setDespacho((p) => ({ ...p, tipo_traslado_id: Number(v) }))} options={opcionesTraslado} disabled={!!enviando} minWidth={220} style={{ width: "100%" }} />
                      </div>
                    )}
                  </div>
                  {esGuia && despacho && (
                    <div style={{ border: "1px solid var(--border)", borderRadius: 10, padding: "10px 12px" }}>
                      <span style={etiqueta}>Despacho (sale impreso en la guía)</span>
                      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                        {campo(despacho, setDespacho, "destinatario", "Destinatario", { style: { width: "100%" } })}
                        {campo(despacho, setDespacho, "direccion", "Dirección de entrega", { style: { width: "100%" } })}
                        {campo(despacho, setDespacho, "comuna", "Comuna")}
                        {campo(despacho, setDespacho, "ciudad", "Ciudad")}
                      </div>
                    </div>
                  )}
                  <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.45 }}>
                    {borrador.referencias?.length ? `Referencia a la orden de compra: folio ${borrador.referencias[0].folio} · razón ${borrador.referencias[0].numero}. ` : ""}
                    {esGuia ? "Bsale descuenta el stock al emitir la guía; la factura se emite después desde la guía." : "La nota de venta no va al SII ni mueve stock."}
                  </div>

                  {!apagada && !bloqueada && simulacionVigente && (
                    <label style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 13, border: "1px solid var(--border)", borderRadius: 10, padding: "10px 12px", cursor: "pointer" }}>
                      <input type="checkbox" checked={confirmo} onChange={(e) => setConfirmo(e.target.checked)} disabled={!!enviando} style={{ marginTop: 2 }} />
                      <span><b>Paso 2 — {esGuia ? "emitir la guía oficial" : "registrar la orden oficial"}:</b> la simulación está correcta.{esGuia ? " Entiendo que la guía va al SII y descuenta stock, y que solo se anula en Bsale." : ""}</span>
                    </label>
                  )}
                  {!apagada && !bloqueada && !simulacionVigente && (
                    <div style={{ fontSize: 12.5, color: "var(--text-muted)" }}>
                      Primero simula (paso 1). Con la simulación a la vista podrás {esGuia ? "emitir la guía oficial" : "registrar la orden oficial"} (paso 2).
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, flexWrap: "wrap", padding: "14px 20px", borderTop: "1px solid var(--border)", background: "var(--bg)", borderRadius: "0 0 var(--radius-lg) var(--radius-lg)" }}>
          <button type="button" onClick={cerrar} disabled={!!enviando} className="btn btn-secondary">{resultado?.emitida ? "Cerrar" : "Cancelar"}</button>
          {!resultado?.emitida && (
            <button type="button" onClick={() => enviar("simular")} disabled={!completo} className="btn btn-secondary" style={{ opacity: completo ? 1 : 0.5, cursor: completo ? "pointer" : "not-allowed" }} title="Muestra el documento como quedaría. No emite ni guarda nada.">
              {enviando === "simular" ? "Simulando…" : simulacionVigente ? "Simular de nuevo" : "1. Simular"}
            </button>
          )}
          {!resultado?.emitida && !apagada && simulacionVigente && (
            <button type="button" onClick={() => enviar("emitir")} disabled={!puedeEmitir} className="btn btn-primary" style={{ height: "auto", minHeight: 36, whiteSpace: "normal", opacity: puedeEmitir ? 1 : 0.5, cursor: puedeEmitir ? "pointer" : "not-allowed" }} title={confirmo || bloqueada ? "" : "Marca la casilla de confirmación"}>
              {enviando === "emitir" ? (esGuia ? "Emitiendo…" : "Registrando…") : `2. ${verbo} oficial por ${clp(totales.total)}`}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
