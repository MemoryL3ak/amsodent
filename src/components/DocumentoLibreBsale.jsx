import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { AlertTriangle, CheckCircle2, ExternalLink, FileText, Info, Loader2, Plus, Receipt, Search, Trash2, Truck, X } from "lucide-react";
import { api } from "../lib/api";
import DateFilter from "./DateFilter";
import DropdownSelect from "./ui/DropdownSelect";
import VistaPreviaBsale from "./VistaPreviaBsale";

/* ── Guía o factura LIBRE en Bsale (2026-10-03) ──────────────────────────────
   Sin orden de compra ni cotización de por medio: se elige el cliente por RUT
   (si no está en Bsale se crea), se agregan productos del catálogo con su
   cantidad y precio neto, se completa el despacho (guía) o la forma de pago
   (factura), y opcionalmente una referencia a OC/guía y la cotización donde
   debe quedar registrado. Mismos dos pasos: 1) Simular, 2) Emitir oficial.

   VENTA DIRECTA (`ventaDirecta`, 2026-10-03): boleta o factura al instante,
   sin cotización previa. Al emitir, el servidor crea la cotización particular
   adjudicada con estos ítems y deja el documento (y el pago, si no es a
   crédito) registrados en ella. En una boleta el cliente es opcional. */

const clp = (n) => `$${Math.round(Number(n) || 0).toLocaleString("es-CL")}`;
const aFecha = (iso) => (iso ? new Date(`${iso}T00:00:00`) : undefined);
const etiqueta = { fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".4px", color: "var(--text-muted)", display: "block", marginBottom: 4 };
const caja = { border: "1px solid var(--border)", borderRadius: 10, padding: "10px 12px" };

export default function DocumentoLibreBsale({ tipo = "guia", ventaDirecta = false, onCerrar, onEmitida }) {
  const [tipoDoc, setTipoDoc] = useState(ventaDirecta && tipo === "guia" ? "boleta" : tipo);
  const esGuia = tipoDoc === "guia";
  const esBoleta = tipoDoc === "boleta";
  const [opciones, setOpciones] = useState(null);
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState("");
  const [resultado, setResultado] = useState(null);

  // Cliente
  const [rut, setRut] = useState("");
  const [buscandoCliente, setBuscandoCliente] = useState(false);
  const [cliente, setCliente] = useState(null); // lo que devolvió /cliente (+ ediciones si es nuevo)
  const [sugerencias, setSugerencias] = useState([]);
  const [qCliente, setQCliente] = useState("");
  // Líneas
  const [lineas, setLineas] = useState([]);
  const [qProducto, setQProducto] = useState("");
  const [productos, setProductos] = useState([]);
  // Resto
  const [fecha, setFecha] = useState("");
  const [despacho, setDespacho] = useState({ destinatario: "", direccion: "", comuna: "", ciudad: "", tipo_traslado_id: "" });
  const [formaPago, setFormaPago] = useState("");
  const [dias, setDias] = useState("30");
  const [descuentaStock, setDescuentaStock] = useState(true);
  const [refOc, setRefOc] = useState({ numero: "", fecha: "" });
  const [refGuia, setRefGuia] = useState({ numero: "", fecha: "" });
  const [cotizacion, setCotizacion] = useState("");

  useEffect(() => {
    let vivo = true;
    api.get("/bsale/libre/opciones")
      .then((o) => {
        if (!vivo) return;
        setOpciones(o);
        setFecha(o.fecha_emision);
        setFormaPago(String((ventaDirecta ? o.forma_pago_venta_id : o.forma_pago_id) || o.forma_pago_id || ""));
        setDespacho((d) => ({ ...d, tipo_traslado_id: String(o.tipo_traslado_id || "") }));
      })
      .catch((e) => vivo && setError(e?.message || "No se pudieron cargar las opciones."));
    return () => { vivo = false; };
  }, [ventaDirecta]);

  // Búsquedas con pausa, para no consultar por cada tecla.
  const timerCliente = useRef(null);
  useEffect(() => {
    if (timerCliente.current) clearTimeout(timerCliente.current);
    if (qCliente.trim().length < 2) { setSugerencias([]); return undefined; }
    timerCliente.current = setTimeout(() => {
      api.get(`/bsale/libre/clientes?q=${encodeURIComponent(qCliente.trim())}`).then((r) => setSugerencias(Array.isArray(r) ? r : [])).catch(() => setSugerencias([]));
    }, 250);
    return () => clearTimeout(timerCliente.current);
  }, [qCliente]);
  const timerProducto = useRef(null);
  useEffect(() => {
    if (timerProducto.current) clearTimeout(timerProducto.current);
    if (qProducto.trim().length < 2) { setProductos([]); return undefined; }
    timerProducto.current = setTimeout(() => {
      api.get(`/bsale/libre/productos?q=${encodeURIComponent(qProducto.trim())}`).then((r) => setProductos(Array.isArray(r) ? r : [])).catch(() => setProductos([]));
    }, 250);
    return () => clearTimeout(timerProducto.current);
  }, [qProducto]);

  async function buscarCliente(rutElegido) {
    const r = String(rutElegido ?? rut).trim();
    if (!r) return;
    setBuscandoCliente(true);
    setError("");
    try {
      const c = await api.get(`/bsale/libre/cliente?rut=${encodeURIComponent(r)}`);
      setCliente(c);
      setRut(c.rut || r);
      setSugerencias([]);
      setQCliente("");
      if (esGuia) setDespacho((d) => ({ ...d, destinatario: d.destinatario || c.razon_social || "", direccion: d.direccion || c.direccion || "", comuna: d.comuna || c.comuna || "", ciudad: d.ciudad || c.ciudad || "" }));
    } catch (e) {
      setError(e?.message || "No se pudo buscar el cliente.");
    } finally {
      setBuscandoCliente(false);
    }
  }

  function agregarProducto(p) {
    setLineas((prev) => {
      if (prev.some((l) => l.sku === p.sku)) return prev.map((l) => (l.sku === p.sku ? { ...l, cantidad: String((Number(l.cantidad) || 0) + 1) } : l));
      return [...prev, { sku: p.sku, producto: p.nombre, formato: p.formato, cantidad: "1", neto_unitario: String(p.lista1 || p.lista2 || ""), lista1: p.lista1, lista2: p.lista2, stock: p.stock }];
    });
    setQProducto("");
    setProductos([]);
  }
  const cambiarLinea = (sku, campo, v) => setLineas((prev) => prev.map((l) => (l.sku === sku ? { ...l, [campo]: v.replace(/[^\d.,]/g, "").replace(",", ".") } : l)));
  const quitarLinea = (sku) => setLineas((prev) => prev.filter((l) => l.sku !== sku));

  // Venta directa: el plazo solo aplica si la factura queda a crédito.
  const formaElegida = (opciones?.formas_pago || []).find((f) => String(f.id) === String(formaPago));
  const aCredito = !!formaElegida?.credito;
  const diasEfectivos = esGuia ? 0 : esBoleta ? 0 : ventaDirecta && !aCredito ? 0 : Number(dias);

  const totales = useMemo(() => {
    const neto = Math.round(lineas.reduce((a, l) => a + (Number(l.cantidad) || 0) * (Number(l.neto_unitario) || 0), 0));
    const iva = Math.round(neto * 0.19);
    return { neto, iva, total: neto + iva };
  }, [lineas]);

  const cuerpo = () => ({
    tipo: tipoDoc,
    ...(ventaDirecta ? { venta_directa: true } : {}),
    cliente: cliente ? { rut: cliente.rut, razon_social: cliente.razon_social, giro: cliente.giro, direccion: cliente.direccion, comuna: cliente.comuna, ciudad: cliente.ciudad, email: cliente.email } : { rut: esBoleta ? "" : rut },
    lineas: lineas.map((l) => ({ sku: l.sku, producto: l.producto, cantidad: Number(l.cantidad), neto_unitario: Number(l.neto_unitario) })),
    fecha_emision: fecha,
    ...(esGuia
      ? { despacho: { ...despacho, tipo_traslado_id: Number(despacho.tipo_traslado_id) } }
      : { forma_pago_id: Number(formaPago), dias_vencimiento: diasEfectivos, ...(ventaDirecta ? {} : { descuenta_stock: descuentaStock }) }),
    referencias: ventaDirecta
      ? []
      : [
          ...(refOc.numero.trim() ? [{ tipo: "oc", numero: refOc.numero.trim(), fecha: refOc.fecha || null }] : []),
          ...(!esGuia && refGuia.numero.trim() ? [{ tipo: "guia", numero: refGuia.numero.trim(), fecha: refGuia.fecha || null }] : []),
        ],
    ...(!ventaDirecta && cotizacion.trim() ? { cotizacion_id: Number(cotizacion.trim().replace(/\D/g, "")) } : {}),
  });
  // Firma de lo decidido: la simulación y la confirmación valen solo para estos datos.
  const firma = JSON.stringify(cuerpo());
  const [simuladoCon, setSimuladoCon] = useState(null);
  const [huella, setHuella] = useState(null);
  const [confirmadoCon, setConfirmadoCon] = useState(null);
  const simulacionVigente = !!resultado?.simulacion && !resultado?.bloqueada && simuladoCon === firma;
  const confirmo = confirmadoCon === firma;

  async function enviar(accion) {
    if (enviando) return;
    setEnviando(accion);
    setError("");
    try {
      const r = await api.post("/bsale/libre/emitir", { ...cuerpo(), ...(accion === "simular" ? { simular: true } : { huella }) });
      setResultado(r);
      if (r?.simulacion) { setSimuladoCon(firma); setHuella(r.huella || null); }
      if (r?.emitida) onEmitida?.(r);
    } catch (e) {
      setError(e?.message || (accion === "simular" ? "No se pudo simular." : "No se pudo emitir."));
    } finally {
      setEnviando("");
    }
  }

  const apagada = opciones && opciones.modo !== "activa";
  const cerrar = () => { if (!enviando) onCerrar?.(); };
  const listoParaSimular = !!opciones && !enviando && (!!cliente || esBoleta) && lineas.length > 0 && !!fecha;
  const puedeEmitir = listoParaSimular && !apagada && simulacionVigente && confirmo;
  const nombreDoc = esGuia ? "guía" : esBoleta ? "boleta" : "factura";
  const titulo = ventaDirecta ? `Venta directa · ${esBoleta ? "Boleta" : "Factura"}` : esGuia ? "Nueva guía de despacho (libre)" : "Nueva factura (libre)";
  const verbo = `Emitir ${nombreDoc}`;
  const opcionesTraslado = (opciones?.tipos_traslado || []).map((t) => ({ value: String(t.id), label: t.nombre }));
  const opcionesPago = (opciones?.formas_pago || []).map((f) => ({ value: String(f.id), label: f.nombre }));

  const campo = (obj, setObj, k, label, props = {}) => (
    <label style={{ flex: "1 1 160px", minWidth: 0 }}>
      <span style={etiqueta}>{label}</span>
      <input className="input" value={obj?.[k] || ""} onChange={(e) => setObj((p) => ({ ...p, [k]: e.target.value }))} disabled={!!enviando} style={{ width: "100%" }} {...props} />
    </label>
  );

  return createPortal(
    <div onClick={cerrar} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.55)", zIndex: 11000, display: "flex", padding: 16, overflowY: "auto" }}>
      <div className="modal-emitir-factura" onClick={(e) => e.stopPropagation()} style={{ width: 860, maxWidth: "100%", margin: "auto", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-lg)" }}>
        <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
          <div style={{ minWidth: 0 }}>
            <strong style={{ fontSize: 15, display: "inline-flex", alignItems: "center", gap: 7 }}>
              {esGuia ? <Truck size={16} style={{ color: "var(--primary)" }} /> : ventaDirecta ? <Receipt size={16} style={{ color: "var(--primary)" }} /> : <FileText size={16} style={{ color: "var(--primary)" }} />} {titulo}
            </strong>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
              {ventaDirecta
                ? "Se emite al tiro en Bsale y el sistema crea la cotización con estos productos. Paso 1: simular. Paso 2: emitir el documento oficial."
                : "Se arma a mano y Bsale la emite. Paso 1: simular. Paso 2: emitir el documento oficial."}
            </div>
          </div>
          <button type="button" onClick={cerrar} className="btn btn-ghost" style={{ padding: 6, flexShrink: 0 }} title="Cerrar" disabled={!!enviando}><X size={16} /></button>
        </div>

        <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 14 }}>
          {resultado?.emitida && (
            <div style={{ border: "1px solid #bbf7d0", background: "#f0fdf4", borderRadius: 10, padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 15, fontWeight: 700, color: "#15803d" }}>
                <CheckCircle2 size={18} /> {esGuia ? "Guía" : esBoleta ? "Boleta" : "Factura"} N° {resultado.numero} emitida en Bsale
              </div>
              <div style={{ fontSize: 13 }}>
                {resultado.total ? `Total ${clp(resultado.total)}. ` : ""}
                {resultado.cotizacion
                  ? <>Se creó la cotización <Link to={`/detalle/${resultado.cotizacion.id}`} className="table-link" style={{ fontWeight: 700 }}>#{resultado.cotizacion.id}</Link> con estos productos{resultado.cotizacion.pagada ? ", el documento y el pago registrados." : " y el documento registrado (pago pendiente: aparece en Seguimiento de Pagos)."}</>
                  : ventaDirecta
                    ? "El documento se emitió pero la cotización no se pudo crear: revisa el aviso de abajo."
                    : resultado.registrada ? "Quedó registrada en la cotización indicada." : "No se indicó cotización: queda en Bsale y en el historial de Emitidas."}
              </div>
              {(resultado.avisos || []).map((a, i) => <div key={i} style={{ fontSize: 12.5, color: "#92400e" }}>{a}</div>)}
              {resultado.url_pdf && <a href={resultado.url_pdf} target="_blank" rel="noopener noreferrer" className="btn btn-secondary btn-sm" style={{ alignSelf: "flex-start", textDecoration: "none" }}><ExternalLink size={13} /> Ver en Bsale</a>}
            </div>
          )}

          {!resultado?.emitida && (
            <>
              {error && <div style={{ border: "1px solid #fecaca", background: "#fef2f2", color: "#b91c1c", borderRadius: 10, padding: "10px 12px", fontSize: 13, overflowWrap: "anywhere" }}>{error}</div>}
              {apagada && (
                <div style={{ border: "1px solid #fde68a", background: "#fffbeb", color: "#92400e", borderRadius: 10, padding: "10px 12px", fontSize: 12.5, display: "flex", gap: 8 }}>
                  <Info size={15} style={{ flexShrink: 0, marginTop: 1 }} /><span><b>La emisión real está apagada en el servidor.</b> Puedes armar y simular, pero no se emite nada.</span>
                </div>
              )}

              {/* Resultado de la simulación (paso 1) */}
              {resultado?.simulacion && resultado.bloqueada && (
                <div style={{ border: "1px solid #fecaca", background: "#fef2f2", borderRadius: 10, padding: "10px 12px" }}>
                  <div style={{ fontSize: 12.5, fontWeight: 700, color: "#b91c1c", display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}><AlertTriangle size={14} /> Falta corregir</div>
                  <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: "#7f1d1d", display: "flex", flexDirection: "column", gap: 3 }}>{resultado.problemas.map((p, i) => <li key={i}>{p.mensaje}</li>)}</ul>
                </div>
              )}
              {resultado?.simulacion && !resultado.bloqueada && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <div style={{ border: "1px solid #fde68a", background: "#fffbeb", borderRadius: 10, padding: "10px 14px", fontSize: 12.5, color: "#92400e" }}>
                    <b>Paso 1 listo — simulación: no se emitió nada{resultado.emision_apagada ? " (la emisión real está apagada en el servidor)" : ""}.</b>
                    {!apagada && simulacionVigente ? ` Si está bien, abajo puedes emitir la ${nombreDoc} oficial.` : ""}
                    {!simulacionVigente ? " Cambiaste datos después de simular: vuelve a simular antes de emitir." : ""}
                  </div>
                  {(resultado.avisos || []).length > 0 && (
                    <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: "#78350f", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 10, padding: "8px 12px 8px 30px" }}>
                      {resultado.avisos.map((a, i) => <li key={i}>{a.mensaje}</li>)}
                    </ul>
                  )}
                  <VistaPreviaBsale vista={resultado.vista} solicitud={resultado.solicitud} />
                </div>
              )}

              {ventaDirecta && (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                  <span style={{ ...etiqueta, marginBottom: 0, marginRight: 4 }}>Documento</span>
                  {[["boleta", "Boleta"], ["factura", "Factura"]].map(([v, t]) => (
                    <button key={v} type="button" className={`btn btn-sm ${tipoDoc === v ? "btn-primary" : "btn-secondary"}`} onClick={() => setTipoDoc(v)} disabled={!!enviando}>
                      {t}
                    </button>
                  ))}
                  <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{esBoleta ? "A consumidor final: el cliente es opcional." : "Con RUT y giro del cliente."}</span>
                </div>
              )}

              {/* Cliente */}
              <div style={caja}>
                <span style={etiqueta}>{esBoleta ? "Cliente (opcional en una boleta)" : "Cliente"}</span>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
                  <label style={{ flex: "1 1 180px", minWidth: 0 }}>
                    <span style={etiqueta}>RUT</span>
                    <input className="input" value={rut} onChange={(e) => setRut(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); buscarCliente(); } }} placeholder="76.123.456-7" disabled={!!enviando} style={{ width: "100%" }} />
                  </label>
                  <button type="button" className="btn btn-secondary" onClick={() => buscarCliente()} disabled={!rut.trim() || buscandoCliente || !!enviando} style={{ height: 36 }}>
                    {buscandoCliente ? <Loader2 size={14} className="spin" /> : <Search size={14} />} Buscar en Bsale
                  </button>
                  <label style={{ flex: "2 1 220px", minWidth: 0, position: "relative" }}>
                    <span style={etiqueta}>O busca por nombre (clientes del sistema)</span>
                    <input className="input" value={qCliente} onChange={(e) => setQCliente(e.target.value)} placeholder="Hospital, municipalidad, clínica…" disabled={!!enviando} style={{ width: "100%" }} />
                    {sugerencias.length > 0 && (
                      <div style={{ position: "absolute", left: 0, right: 0, top: "100%", zIndex: 5, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, boxShadow: "var(--shadow-lg)", maxHeight: 220, overflow: "auto" }}>
                        {sugerencias.map((s) => (
                          <button key={`${s.rut}-${s.nombre}`} type="button" onClick={() => buscarCliente(s.rut)} style={{ display: "block", width: "100%", textAlign: "left", padding: "7px 10px", background: "none", border: "none", cursor: "pointer", fontSize: 12.5 }}>
                            <b>{s.nombre}</b> <span style={{ color: "var(--text-muted)" }}>· {s.rut}{s.comuna ? ` · ${s.comuna}` : ""}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </label>
                </div>
                {cliente && (
                  <div style={{ marginTop: 10 }}>
                    {cliente.nuevo ? (
                      <>
                        <div style={{ fontSize: 12.5, color: "#92400e", marginBottom: 6 }}>
                          {esBoleta ? "Este RUT no está en Bsale: se creará con estos datos. En una boleta basta el nombre." : "Este RUT no está en Bsale: se creará con estos datos. Razón social, giro, dirección y comuna son obligatorios."}
                        </div>
                        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                          {campo(cliente, setCliente, "razon_social", "Razón social", { style: { width: "100%" } })}
                          {campo(cliente, setCliente, "giro", "Giro", { placeholder: esBoleta ? "Opcional" : "Obligatorio para Bsale" })}
                          {campo(cliente, setCliente, "direccion", "Dirección")}
                          {campo(cliente, setCliente, "comuna", "Comuna")}
                          {campo(cliente, setCliente, "ciudad", "Ciudad")}
                          {campo(cliente, setCliente, "email", "Correo (opcional)")}
                        </div>
                      </>
                    ) : (
                      <div style={{ fontSize: 13, lineHeight: 1.45, overflowWrap: "anywhere" }}>
                        <div style={{ fontWeight: 600 }}>{cliente.razon_social || "—"} <span style={{ fontSize: 11, fontWeight: 700, color: "#15803d", background: "#dcfce7", borderRadius: 999, padding: "1px 8px", marginLeft: 6 }}>En Bsale</span></div>
                        <div>RUT {cliente.rut}</div>
                        <div style={{ color: "var(--text-muted)", fontSize: 12 }}>{[cliente.giro, cliente.direccion, cliente.comuna].filter(Boolean).join(" · ") || "Sin giro ni dirección"}</div>
                      </div>
                    )}
                    {esBoleta && (
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setCliente(null); setRut(""); }} disabled={!!enviando} style={{ marginTop: 6, fontSize: 12 }}>
                        Quitar cliente (boleta a consumidor final)
                      </button>
                    )}
                  </div>
                )}
                {esBoleta && !cliente && <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 8 }}>Sin cliente, la boleta sale a consumidor final.</div>}
              </div>

              {/* Productos */}
              <div style={{ border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden" }}>
                <div style={{ padding: "8px 12px", background: "var(--bg)", borderBottom: "1px solid var(--border)", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <span style={{ ...etiqueta, marginBottom: 0 }}>Productos</span>
                  <div style={{ flex: "1 1 260px", minWidth: 0, position: "relative" }}>
                    <input className="input" value={qProducto} onChange={(e) => setQProducto(e.target.value)} placeholder="Agregar por SKU o nombre…" disabled={!!enviando} style={{ width: "100%", height: 32 }} />
                    {productos.length > 0 && (
                      <div style={{ position: "absolute", left: 0, right: 0, top: "100%", zIndex: 5, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, boxShadow: "var(--shadow-lg)", maxHeight: 240, overflow: "auto" }}>
                        {productos.map((p) => (
                          <button key={p.sku} type="button" onClick={() => agregarProducto(p)} style={{ display: "flex", justifyContent: "space-between", gap: 8, width: "100%", textAlign: "left", padding: "7px 10px", background: "none", border: "none", cursor: "pointer", fontSize: 12.5 }}>
                            <span style={{ minWidth: 0 }}><b>{p.sku}</b> · {p.nombre}</span>
                            <span style={{ color: "var(--text-muted)", whiteSpace: "nowrap" }}>L1 {clp(p.lista1)} · L2 {clp(p.lista2)} · stock {p.stock}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                <div style={{ maxHeight: 280, overflow: "auto" }}>
                  <table className="data-table" style={{ width: "100%", minWidth: 620 }}>
                    <thead>
                      <tr>
                        <th style={{ textAlign: "left" }}>SKU</th>
                        <th style={{ textAlign: "left" }}>Producto</th>
                        <th style={{ textAlign: "right" }}>Cantidad</th>
                        <th style={{ textAlign: "right" }}>Neto unit.</th>
                        <th style={{ textAlign: "right" }}>Neto</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {lineas.map((l) => (
                        <tr key={l.sku}>
                          <td style={{ whiteSpace: "nowrap", fontWeight: 600 }}>{l.sku}</td>
                          <td style={{ whiteSpace: "normal", overflowWrap: "anywhere" }}>
                            {l.producto}{l.formato ? <span style={{ color: "var(--text-muted)", fontSize: 11 }}> · {l.formato}</span> : null}
                            <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Lista 1 {clp(l.lista1)} · Lista 2 {clp(l.lista2)} · stock {l.stock}</div>
                          </td>
                          <td style={{ textAlign: "right" }}><input className="input" inputMode="decimal" value={l.cantidad} onChange={(e) => cambiarLinea(l.sku, "cantidad", e.target.value)} disabled={!!enviando} style={{ width: 84, height: 30, padding: "2px 8px", textAlign: "right" }} /></td>
                          <td style={{ textAlign: "right" }}>
                            <input className="input" inputMode="numeric" value={l.neto_unitario} onChange={(e) => cambiarLinea(l.sku, "neto_unitario", e.target.value)} disabled={!!enviando} style={{ width: 104, height: 30, padding: "2px 8px", textAlign: "right" }} />
                            {Number(l.neto_unitario) > 0 && <div style={{ fontSize: 10.5, color: "var(--text-muted)", whiteSpace: "nowrap" }}>{clp(Number(l.neto_unitario) * 1.19)} c/IVA</div>}
                          </td>
                          <td style={{ textAlign: "right", whiteSpace: "nowrap", fontWeight: 600 }}>{clp((Number(l.cantidad) || 0) * (Number(l.neto_unitario) || 0))}</td>
                          <td style={{ textAlign: "right" }}><button type="button" className="btn btn-ghost btn-sm" onClick={() => quitarLinea(l.sku)} disabled={!!enviando} title="Quitar" style={{ color: "#dc2626", padding: 4 }}><Trash2 size={13} /></button></td>
                        </tr>
                      ))}
                      {lineas.length === 0 && <tr><td colSpan="6" style={{ textAlign: "center", color: "var(--text-muted)", padding: 18 }}><Plus size={13} style={{ verticalAlign: "middle" }} /> Busca un producto arriba para agregarlo.</td></tr>}
                    </tbody>
                  </table>
                </div>
                <div style={{ display: "flex", justifyContent: "flex-end", flexWrap: "wrap", gap: "4px 22px", padding: "10px 14px", borderTop: "1px solid var(--border)", background: "var(--bg)", fontSize: 13 }}>
                  <span>Neto <b>{clp(totales.neto)}</b></span>
                  <span>IVA 19% <b>{clp(totales.iva)}</b></span>
                  <span style={{ fontSize: 14 }}>Total <b>{clp(totales.total)}</b></span>
                </div>
              </div>

              {/* Datos propios del documento */}
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                <div style={{ flex: "1 1 150px", minWidth: 0 }}>
                  <span style={etiqueta}>Fecha de emisión</span>
                  <DateFilter value={fecha} onChange={setFecha} maxDate={aFecha(opciones?.fecha_emision)} disabled={!!enviando} placeholder="Fecha" />
                </div>
                {esGuia ? (
                  <div style={{ flex: "1 1 220px", minWidth: 0 }}>
                    <span style={etiqueta}>Tipo de traslado</span>
                    <DropdownSelect value={despacho.tipo_traslado_id} onChange={(v) => setDespacho((d) => ({ ...d, tipo_traslado_id: v }))} options={opcionesTraslado} disabled={!!enviando} minWidth={220} style={{ width: "100%" }} />
                  </div>
                ) : (
                  <>
                    <div style={{ flex: "1 1 190px", minWidth: 0 }}>
                      <span style={etiqueta}>Forma de pago</span>
                      <DropdownSelect value={formaPago} onChange={setFormaPago} options={opcionesPago} disabled={!!enviando} minWidth={190} style={{ width: "100%" }} />
                    </div>
                    {!esBoleta && (!ventaDirecta || aCredito) && (
                      <label style={{ flex: "1 1 120px", minWidth: 0 }}>
                        <span style={etiqueta}>Vence en (días)</span>
                        <input className="input" inputMode="numeric" value={dias} onChange={(e) => setDias(e.target.value.replace(/[^\d]/g, "").slice(0, 3))} disabled={!!enviando} style={{ width: "100%" }} />
                      </label>
                    )}
                    {ventaDirecta && (
                      <div style={{ flex: "2 1 220px", minWidth: 0, fontSize: 12, color: "var(--text-muted)", alignSelf: "center" }}>
                        {aCredito ? "A crédito: el documento queda por cobrar en Seguimiento de Pagos." : "Pagada al emitir: el pago queda registrado en la cotización."}
                      </div>
                    )}
                  </>
                )}
              </div>
              {esGuia && (
                <div style={caja}>
                  <span style={etiqueta}>Despacho (sale impreso en la guía)</span>
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                    {campo(despacho, setDespacho, "destinatario", "Destinatario", { style: { width: "100%" } })}
                    {campo(despacho, setDespacho, "direccion", "Dirección de entrega", { style: { width: "100%" } })}
                    {campo(despacho, setDespacho, "comuna", "Comuna")}
                    {campo(despacho, setDespacho, "ciudad", "Ciudad")}
                  </div>
                </div>
              )}
              {!ventaDirecta && <div style={caja}>
                <span style={etiqueta}>Referencias y registro (opcional)</span>
                <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 8 }}>
                  {esGuia
                    ? <>En la referencia a la orden de compra, la cotización va como <b>folio</b> y el N° de orden de compra como <b>razón</b>.</>
                    : <>El N° de orden de compra va como <b>folio</b> de la referencia (así Mercado Público cruza la factura con la OC).</>}
                </div>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
                  {campo(refOc, setRefOc, "numero", "N° orden de compra", { maxLength: 18, placeholder: "Ej: 1293138-180-AG26" })}
                  <div style={{ flex: "1 1 150px", minWidth: 0 }}>
                    <span style={etiqueta}>Fecha de la OC</span>
                    <DateFilter value={refOc.fecha} onChange={(v) => setRefOc((r) => ({ ...r, fecha: v }))} disabled={!!enviando} placeholder="Fecha" />
                  </div>
                  {!esGuia && campo(refGuia, setRefGuia, "numero", "N° guía de despacho", { maxLength: 18, placeholder: "Si factura una guía" })}
                  {!esGuia && (
                    <div style={{ flex: "1 1 150px", minWidth: 0 }}>
                      <span style={etiqueta}>Fecha de la guía</span>
                      <DateFilter value={refGuia.fecha} onChange={(v) => setRefGuia((r) => ({ ...r, fecha: v }))} disabled={!!enviando} placeholder="Fecha" />
                    </div>
                  )}
                  <label style={{ flex: "1 1 150px", minWidth: 0 }}>
                    <span style={etiqueta}>{esGuia ? "Cotización # (folio de la referencia y Trazabilidad)" : "Cotización # (para Trazabilidad)"}</span>
                    <input className="input" inputMode="numeric" value={cotizacion} onChange={(e) => setCotizacion(e.target.value.replace(/[^\d]/g, ""))} disabled={!!enviando} placeholder="Ej: 5286" style={{ width: "100%" }} />
                  </label>
                </div>
                {!esGuia && (
                  <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, marginTop: 10, cursor: "pointer" }}>
                    <input type="checkbox" checked={descuentaStock} onChange={(e) => setDescuentaStock(e.target.checked)} disabled={!!enviando} />
                    Descontar stock en Bsale con esta factura (desmárcalo si la mercadería ya salió con una guía)
                  </label>
                )}
              </div>}

              {!apagada && simulacionVigente && (
                <label style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 13, border: "1px solid var(--border)", borderRadius: 10, padding: "10px 12px", cursor: "pointer" }}>
                  <input type="checkbox" checked={confirmo} onChange={(e) => setConfirmadoCon(e.target.checked ? firma : null)} disabled={!!enviando} style={{ marginTop: 2 }} />
                  <span><b>Paso 2 — emitir la {nombreDoc} oficial:</b> la simulación está correcta. Entiendo que el documento va al SII y que solo se anula en Bsale{esGuia ? "" : " con nota de crédito"}{ventaDirecta ? ", y que se creará la cotización con estos productos" : ""}.</span>
                </label>
              )}
              {!apagada && !simulacionVigente && (
                <div style={{ fontSize: 12.5, color: "var(--text-muted)" }}>Primero simula (paso 1). Con la simulación a la vista podrás emitir el documento oficial (paso 2).</div>
              )}
            </>
          )}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, flexWrap: "wrap", padding: "14px 20px", borderTop: "1px solid var(--border)", background: "var(--bg)", borderRadius: "0 0 var(--radius-lg) var(--radius-lg)" }}>
          <button type="button" onClick={cerrar} disabled={!!enviando} className="btn btn-secondary">{resultado?.emitida ? "Cerrar" : "Cancelar"}</button>
          {!resultado?.emitida && (
            <button type="button" onClick={() => enviar("simular")} disabled={!listoParaSimular} className="btn btn-secondary" style={{ opacity: listoParaSimular ? 1 : 0.5, cursor: listoParaSimular ? "pointer" : "not-allowed" }} title="Muestra el documento como quedaría. No emite ni guarda nada.">
              {enviando === "simular" ? "Simulando…" : simulacionVigente ? "Simular de nuevo" : "1. Simular"}
            </button>
          )}
          {!resultado?.emitida && !apagada && simulacionVigente && (
            <button type="button" onClick={() => enviar("emitir")} disabled={!puedeEmitir} className="btn btn-primary" style={{ height: "auto", minHeight: 36, whiteSpace: "normal", opacity: puedeEmitir ? 1 : 0.5, cursor: puedeEmitir ? "pointer" : "not-allowed" }} title={confirmo ? "" : "Marca la casilla de confirmación"}>
              {enviando === "emitir" ? "Emitiendo…" : `2. ${verbo} oficial por ${clp(totales.total)}`}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
