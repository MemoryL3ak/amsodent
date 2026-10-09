import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { AlertTriangle, CheckCircle2, ExternalLink, FileText, Info, Loader2, Plus, Receipt, Search, Trash2, Truck, X } from "lucide-react";
import { api } from "../lib/api";
import DateFilter from "./DateFilter";
import DropdownSelect from "./ui/DropdownSelect";
import VistaPreviaBsale from "./VistaPreviaBsale";
import AvisoCorreoDocumento from "./AvisoCorreoDocumento";
import BotonImprimirCarta from "./BotonImprimirCarta";
import CamposSeguimientoGuia from "./CamposSeguimientoGuia";
import CampoObservacionGuia, { OBSERVACION_GUIA_MAX } from "./CampoObservacionGuia";
import { componerObservacion } from "../lib/observacionGuia";
import CrearClienteBsale from "./CrearClienteBsale";
import RegistrarComprobanteRapido from "./RegistrarComprobanteRapido";

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

/* DESDE UNA COTIZACIÓN (`cotizacionId`, 2026-10-07): boleta o factura del
   cliente particular desde Trazabilidad, o guía de una cotización adjudicada
   sin orden de compra. Se precargan el cliente y los productos de la
   cotización, y el documento queda registrado en ella. */
export default function DocumentoLibreBsale({ tipo = "guia", ventaDirecta = false, cotizacionId = null, onCerrar, onEmitida }) {
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
  // N° de comprobante del pago (2026-10-07): se pide al crear la boleta/factura.
  const [comprobante, setComprobante] = useState("");
  // Ventana para crear en Bsale un cliente que no está (2026-10-07).
  const [crearCliente, setCrearCliente] = useState(null);
  const [dias, setDias] = useState("30");
  const [descuentaStock, setDescuentaStock] = useState(true);
  const [refOc, setRefOc] = useState({ numero: "", fecha: "" });
  const [refGuia, setRefGuia] = useState({ numero: "", fecha: "" });
  const [cotizacion, setCotizacion] = useState(cotizacionId ? String(cotizacionId) : "");
  const [desde, setDesde] = useState(null); // datos de la cotización de origen
  const [seguimiento, setSeguimiento] = useState({ empresa: "", numero: "" });
  // (2026-10-08) Venta directa: «Emitir guía de despacho» marcada por defecto.
  const [conGuia, setConGuia] = useState(!!ventaDirecta);
  // Atributo adicional «Observación» de la guía en Bsale.
  const [observacion, setObservacion] = useState("");

  useEffect(() => {
    let vivo = true;
    api.get("/bsale/libre/opciones")
      .then((o) => {
        if (!vivo) return;
        setOpciones(o);
        setFecha(o.fecha_emision);
        setFormaPago(String(((ventaDirecta || cotizacionId) ? o.forma_pago_venta_id : o.forma_pago_id) || o.forma_pago_id || ""));
        setDespacho((d) => ({ ...d, tipo_traslado_id: String(o.tipo_traslado_id || "") }));
      })
      .catch((e) => vivo && setError(e?.message || "No se pudieron cargar las opciones."));
    return () => { vivo = false; };
  }, [ventaDirecta, cotizacionId]);

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
      // No está en Bsale: se abre la ventana para crearlo con todos sus datos.
      if (c?.nuevo) setCrearCliente(c);
      setSugerencias([]);
      setQCliente("");
      if (esGuia || ventaDirecta) setDespacho((d) => ({ ...d, destinatario: d.destinatario || c.razon_social || "", direccion: d.direccion || c.direccion || "", comuna: d.comuna || c.comuna || "", ciudad: d.ciudad || c.ciudad || "" }));
    } catch (e) {
      setError(e?.message || "No se pudo buscar el cliente.");
    } finally {
      setBuscandoCliente(false);
    }
  }

  // Precarga: cliente y productos de la cotización.
  useEffect(() => {
    if (!cotizacionId) return undefined;
    let vivo = true;
    api.get(`/bsale/libre/desde-cotizacion?id=${encodeURIComponent(cotizacionId)}`)
      .then(async (r) => {
        if (!vivo || !r) return;
        setDesde(r);
        setObservacion("");
        if (tipo !== "guia" && r.tipo_sugerido && !esGuia) setTipoDoc(r.tipo_sugerido);
        setLineas((r.lineas || []).map((l) => ({ sku: l.sku, producto: l.producto, formato: "", cantidad: String(l.cantidad), neto_unitario: String(l.neto_unitario), lista1: null, lista2: null, stock: null, deCotizacion: true, observacion: l.observacion || "" })));
        if (r.cliente?.rut) {
          setRut(r.cliente.rut);
          try {
            const c = await api.get(`/bsale/libre/cliente?rut=${encodeURIComponent(r.cliente.rut)}`);
            if (!vivo) return;
            // Lo que Bsale no sabe del cliente nuevo se completa con la cotización.
            const lleno = c?.nuevo
              ? { ...c, razon_social: c.razon_social || r.cliente.razon_social, giro: c.giro || r.cliente.giro, direccion: c.direccion || r.cliente.direccion, comuna: c.comuna || r.cliente.comuna, ciudad: c.ciudad || r.cliente.ciudad, email: c.email || r.cliente.email }
              : c;
            setCliente(lleno);
            setRut(lleno.rut || r.cliente.rut);
            if (esGuia || ventaDirecta) setDespacho((d) => ({ ...d, destinatario: d.destinatario || lleno.razon_social || "", direccion: d.direccion || lleno.direccion || r.cliente.direccion || "", comuna: d.comuna || lleno.comuna || r.cliente.comuna || "", ciudad: d.ciudad || lleno.ciudad || r.cliente.ciudad || "" }));
          } catch { /* el RUT queda escrito para buscarlo a mano */ }
        } else if (esGuia) {
          // Sin RUT válido: el despacho igual sale de la cotización.
          setDespacho((d) => ({ ...d, destinatario: d.destinatario || r.cliente?.razon_social || "", direccion: d.direccion || r.cliente?.direccion || "", comuna: d.comuna || r.cliente?.comuna || "", ciudad: d.ciudad || r.cliente?.ciudad || "" }));
        }
      })
      .catch((e) => vivo && setError(e?.message || "No se pudo leer la cotización."));
    return () => { vivo = false; };
    // Solo al abrir: la cotización viene fija.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cotizacionId]);

  function agregarProducto(p) {
    setLineas((prev) => {
      if (prev.some((l) => l.sku === p.sku)) return prev.map((l) => (l.sku === p.sku ? { ...l, cantidad: String((Number(l.cantidad) || 0) + 1) } : l));
      return [...prev, { sku: p.sku, producto: p.nombre, formato: p.formato, cantidad: "1", neto_unitario: String(p.lista1 || p.lista2 || ""), lista1: p.lista1, lista2: p.lista2, stock: p.stock, observacion: "" }];
    });
    setQProducto("");
    setProductos([]);
  }
  const cambiarLinea = (sku, campo, v) => setLineas((prev) => prev.map((l) => (l.sku === sku ? { ...l, [campo]: v.replace(/[^\d.,]/g, "").replace(",", ".") } : l)));
  const quitarLinea = (sku) => setLineas((prev) => prev.filter((l) => l.sku !== sku));
  // Observación por producto (2026-10-08): va al atributo «Observación» de la guía en Bsale.
  const cambiarObsLinea = (sku, v) => setLineas((prev) => prev.map((l) => (l.sku === sku ? { ...l, observacion: v } : l)));
  const obsPorSku = () => Object.fromEntries(lineas.map((l) => [l.sku, l.observacion || ""]));

  // Venta directa: el plazo solo aplica si la factura queda a crédito.
  const formaElegida = (opciones?.formas_pago || []).find((f) => String(f.id) === String(formaPago));
  const aCredito = !!formaElegida?.credito;
  // Venta directa pagada al emitir: obligatorio (salvo efectivo). Desde una cotización: opcional.
  const pideComprobante = !esGuia && !aCredito && (ventaDirecta || !!cotizacionId);
  const esEfectivo = /efectivo/i.test(formaElegida?.nombre || "");
  const comprobanteObligatorio = pideComprobante && ventaDirecta && !esEfectivo;
  // La guía necesita un receptor con RUT: a consumidor final no hay guía.
  const guiaPosible = ventaDirecta && (!esBoleta || !!cliente);
  // Hay guía (libre, de la cotización o de la venta directa): observación general + por producto.
  const conObsGuia = esGuia || (ventaDirecta && conGuia && guiaPosible);
  const observacionFinal = useMemo(() => (conObsGuia ? componerObservacion(observacion, lineas) : ""), [conObsGuia, observacion, lineas]);
  const diasEfectivos = esGuia ? 0 : esBoleta ? 0 : ventaDirecta && !aCredito ? 0 : Number(dias);

  const totales = useMemo(() => {
    const neto = Math.round(lineas.reduce((a, l) => a + (Number(l.cantidad) || 0) * (Number(l.neto_unitario) || 0), 0));
    const iva = Math.round(neto * 0.19);
    return { neto, iva, total: neto + iva };
  }, [lineas]);

  const cuerpo = () => ({
    tipo: tipoDoc,
    ...(ventaDirecta ? { venta_directa: true, con_guia: conGuia && guiaPosible, ...(conGuia && guiaPosible ? { despacho: { destinatario: despacho.destinatario, direccion: despacho.direccion, comuna: despacho.comuna, ciudad: despacho.ciudad, tipo_traslado_id: 1 }, observacion, observaciones: obsPorSku() } : {}) } : {}),
    cliente: cliente ? { rut: cliente.rut, razon_social: cliente.razon_social, giro: cliente.giro, direccion: cliente.direccion, comuna: cliente.comuna, ciudad: cliente.ciudad, email: cliente.email } : { rut: esBoleta ? "" : rut },
    lineas: lineas.map((l) => ({ sku: l.sku, producto: l.producto, cantidad: Number(l.cantidad), neto_unitario: Number(l.neto_unitario) })),
    fecha_emision: fecha,
    ...(esGuia
      ? { despacho: { ...despacho, tipo_traslado_id: Number(despacho.tipo_traslado_id) }, observacion, observaciones: obsPorSku() }
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
      const r = await api.post("/bsale/libre/emitir", { ...cuerpo(), ...(pideComprobante ? { comprobante: comprobante.trim() } : {}), ...(accion === "simular" ? { simular: true } : { huella, ...(esGuia || (conGuia && guiaPosible) ? { seguimiento } : {}) }) });
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
  // (2026-10-08) Emitido el documento, al cerrar se abre la ventana de correo para enviárselo al cliente.
  const cerrar = () => { if (enviando) return; if (resultado?.emitida) window.dispatchEvent(new Event("correos:check")); onCerrar?.(); };
  const obsMax = desde?.observacion_max || OBSERVACION_GUIA_MAX;
  const listoParaSimular = !!opciones && !enviando && (!!cliente || esBoleta) && lineas.length > 0 && !!fecha && (!conObsGuia || observacionFinal.length <= obsMax) && (!comprobanteObligatorio || !!comprobante.trim());
  const puedeEmitir = listoParaSimular && !apagada && simulacionVigente && confirmo;
  const nombreDoc = esGuia ? "guía" : esBoleta ? "boleta" : "factura";
  const titulo = ventaDirecta
    ? `Venta directa · ${esBoleta ? "Boleta" : "Factura"}`
    : cotizacionId
      ? `${esGuia ? "Guía de despacho" : esBoleta ? "Boleta" : "Factura"} de la cotización #${cotizacionId}`
      : esGuia ? "Nueva guía de despacho (libre)" : "Nueva factura (libre)";
  // Boleta o factura a elegir: en la venta directa y al emitir desde la cotización de un particular.
  const eligeTipo = ventaDirecta || (!!cotizacionId && !esGuia);
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
              {resultado.guia && (resultado.guia.emitida ? (
                <div className="guia-venta-ok" style={{ fontSize: 13, color: "#166534" }}>
                  Guía de despacho N° {resultado.guia.numero} emitida con las mismas líneas y registrada en la cotización.
                  {resultado.guia.url_pdf && <> <a href={resultado.guia.url_pdf} target="_blank" rel="noopener noreferrer" className="table-link">Ver la guía en Bsale</a></>}
                  {(resultado.guia.avisos || []).map((a, i) => <div key={i} style={{ fontSize: 12.5, color: "#92400e" }}>{a}</div>)}
                </div>
              ) : (
                <div className="guia-venta-error" style={{ fontSize: 12.5, color: "#92400e" }}>
                  La guía de despacho no se pudo emitir: {resultado.guia.error}. La {esBoleta ? "boleta" : "factura"} quedó emitida sin rebajar stock: emite la guía desde la cotización con «Emitir guía».
                </div>
              ))}
              <AvisoCorreoDocumento correo={resultado.correo} emitido />
              {(resultado.avisos || []).map((a, i) => <div key={i} style={{ fontSize: 12.5, color: "#92400e" }}>{a}</div>)}
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {resultado.url_pdf && <a href={resultado.url_pdf} target="_blank" rel="noopener noreferrer" className="btn btn-secondary btn-sm" style={{ textDecoration: "none" }}><ExternalLink size={13} /> Ver en Bsale</a>}
                {resultado.bsale_id && <BotonImprimirCarta bsaleId={resultado.bsale_id} etiqueta="Imprimir en carta" />}
              </div>
              {resultado.comprobante && (
                <div style={{ fontSize: 12.5, color: "#166534" }}>
                  Comprobante N° {resultado.comprobante.numero} registrado{resultado.comprobante.pagada ? `: la ${esBoleta ? "boleta" : "factura"} quedó pagada.` : "."}
                </div>
              )}
              {!esGuia && resultado.registrada && resultado.documento_id && !resultado.cotizacion?.pagada && !resultado.comprobante && (
                <RegistrarComprobanteRapido
                  licitacionId={resultado.cotizacion?.id || Number(cotizacion) || null}
                  documentoId={resultado.documento_id}
                  totalBruto={resultado.total}
                  nombreDocumento={esBoleta ? "la boleta" : "la factura"}
                />
              )}
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

              {cotizacionId && desde && (
                <div style={{ border: "1px solid #bae6fd", background: "#f0f9ff", borderRadius: 10, padding: "8px 12px", fontSize: 12.5, color: "#0c4a6e" }}>
                  Cotización <b>#{desde.cotizacion.id}</b>{desde.cotizacion.cliente ? ` · ${desde.cotizacion.cliente}` : ""}: se cargaron su cliente y sus {desde.lineas.length} producto{desde.lineas.length === 1 ? "" : "s"} con SKU (precio neto con el flete repartido, igual que su total). Revisa y simula.
                  {desde.rut_descartado && (
                    <div style={{ color: "#92400e", marginTop: 4 }}>
                      El RUT de la cotización ({desde.rut_descartado}) no es válido: {esGuia ? "indica el RUT del destinatario." : "la boleta puede ir a consumidor final, o escribe el RUT correcto."}
                    </div>
                  )}
                  {desde.sin_sku?.length > 0 && (
                    <div style={{ color: "#92400e", marginTop: 4 }}>
                      Sin SKU, no pueden ir en Bsale: {desde.sin_sku.join(" · ")}. Asígnales SKU en la cotización o agrégalos aquí con su SKU.
                    </div>
                  )}
                </div>
              )}

              {eligeTipo && (
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

              {crearCliente && (
                <CrearClienteBsale
                  inicial={crearCliente}
                  onCerrar={() => setCrearCliente(null)}
                  onCreado={(c) => {
                    setCliente(c);
                    setRut(c.rut || rut);
                    setCrearCliente(null);
                    if (esGuia || ventaDirecta) setDespacho((d) => ({ ...d, destinatario: d.destinatario || c.razon_social || "", direccion: d.direccion || c.direccion || "", comuna: d.comuna || c.comuna || "", ciudad: d.ciudad || c.ciudad || "" }));
                  }}
                />
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
                        <div style={{ fontSize: 12.5, color: "#92400e", marginBottom: 6, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                          <span style={{ flex: "1 1 260px", minWidth: 0 }}>
                            {esBoleta ? "Este RUT no está en Bsale: créalo ahora o se creará al emitir con estos datos (en una boleta basta el nombre)." : "Este RUT no está en Bsale: créalo ahora o se creará al emitir con estos datos (razón social, giro, dirección y comuna obligatorios)."}
                          </span>
                          <button type="button" className="btn btn-primary btn-sm" onClick={() => setCrearCliente(cliente)} disabled={!!enviando}>
                            Crear cliente en Bsale
                          </button>
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
                        <Fragment key={l.sku}>
                        <tr>
                          <td style={{ whiteSpace: "nowrap", fontWeight: 600 }}>{l.sku}</td>
                          <td style={{ whiteSpace: "normal", overflowWrap: "anywhere" }}>
                            {l.producto}{l.formato ? <span style={{ color: "var(--text-muted)", fontSize: 11 }}> · {l.formato}</span> : null}
                            <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{l.deCotizacion ? "De la cotización" : `Lista 1 ${clp(l.lista1)} · Lista 2 ${clp(l.lista2)} · stock ${l.stock}`}</div>
                          </td>
                          <td style={{ textAlign: "right" }}><input className="input" inputMode="decimal" value={l.cantidad} onChange={(e) => cambiarLinea(l.sku, "cantidad", e.target.value)} disabled={!!enviando} style={{ width: 84, height: 30, padding: "2px 8px", textAlign: "right" }} /></td>
                          <td style={{ textAlign: "right" }}>
                            <input className="input" inputMode="numeric" value={l.neto_unitario} onChange={(e) => cambiarLinea(l.sku, "neto_unitario", e.target.value)} disabled={!!enviando} style={{ width: 104, height: 30, padding: "2px 8px", textAlign: "right" }} />
                            {Number(l.neto_unitario) > 0 && <div style={{ fontSize: 10.5, color: "var(--text-muted)", whiteSpace: "nowrap" }}>{clp(Number(l.neto_unitario) * 1.19)} c/IVA</div>}
                          </td>
                          <td style={{ textAlign: "right", whiteSpace: "nowrap", fontWeight: 600 }}>{clp((Number(l.cantidad) || 0) * (Number(l.neto_unitario) || 0))}</td>
                          <td style={{ textAlign: "right" }}><button type="button" className="btn btn-ghost btn-sm" onClick={() => quitarLinea(l.sku)} disabled={!!enviando} title="Quitar" style={{ color: "#dc2626", padding: 4 }}><Trash2 size={13} /></button></td>
                        </tr>
                        {conObsGuia && (
                          <tr className="fila-observacion-linea">
                            <td colSpan="6" style={{ padding: "0 10px 8px", borderTop: 0 }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                                <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".4px", color: "var(--text-muted)", whiteSpace: "nowrap" }} title="Va en el atributo «Observación» de la guía en Bsale">
                                  Observación {l.sku}
                                </span>
                                <input
                                  className="input observacion-linea"
                                  value={l.observacion || ""}
                                  onChange={(e) => cambiarObsLinea(l.sku, e.target.value)}
                                  disabled={!!enviando}
                                  placeholder={l.deCotizacion ? "Observación de este producto para la guía (de la cotización; se puede completar)" : "Observación de este producto para la guía (opcional)"}
                                  style={{ flex: "1 1 240px", minWidth: 0, height: 28, padding: "2px 8px", fontSize: 12.5 }}
                                />
                              </div>
                            </td>
                          </tr>
                        )}
                        </Fragment>
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
                    {pideComprobante && (
                      <label className="campo-comprobante" style={{ flex: "1 1 180px", minWidth: 0 }}>
                        <span style={etiqueta}>N° de comprobante{comprobanteObligatorio ? " *" : ""}</span>
                        <input
                          className="input"
                          value={comprobante}
                          onChange={(e) => setComprobante(e.target.value.slice(0, 60))}
                          disabled={!!enviando}
                          placeholder={comprobanteObligatorio ? "N° de operación o voucher" : ventaDirecta ? "Opcional en efectivo" : "Si ya pagó (opcional)"}
                          style={{ width: "100%", borderColor: comprobanteObligatorio && !comprobante.trim() ? "#fca5a5" : undefined }}
                        />
                      </label>
                    )}
                    {ventaDirecta && (
                      <div style={{ flex: "2 1 220px", minWidth: 0, fontSize: 12, color: "var(--text-muted)", alignSelf: "center" }}>
                        {aCredito ? "A crédito: el documento queda por cobrar en Seguimiento de Pagos." : "Pagada al emitir: el pago queda registrado en la cotización con este N° de comprobante."}
                      </div>
                    )}
                    {!ventaDirecta && pideComprobante && (
                      <div style={{ flex: "2 1 220px", minWidth: 0, fontSize: 12, color: "var(--text-muted)", alignSelf: "center" }}>
                        Si el cliente ya pagó, con el N° de comprobante el pago queda registrado y el documento pagado.
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
              {ventaDirecta && (
                <div style={caja} className="caja-guia-venta">
                  <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontWeight: 600, fontSize: 13 }}>
                    <input type="checkbox" checked={conGuia && guiaPosible} onChange={(e) => setConGuia(e.target.checked)} disabled={!!enviando || !guiaPosible} />
                    Emitir guía de despacho
                  </label>
                  <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
                    {!guiaPosible
                      ? "Sin cliente (consumidor final) no se puede emitir guía de despacho: la boleta rebaja el stock al emitirse. Indica el cliente para despachar con guía."
                      : conGuia
                      ? "Se emite enseguida de la boleta/factura con las mismas líneas (traslado «Operación constituye venta»). El stock lo rebaja la guía, no la boleta/factura."
                      : "Sin guía (retiro en tienda): la boleta/factura rebaja el stock al emitirse."}
                  </div>
                  {conGuia && guiaPosible && (
                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 8 }}>
                      {campo(despacho, setDespacho, "destinatario", "Destinatario", { style: { width: "100%" } })}
                      {campo(despacho, setDespacho, "direccion", "Dirección de entrega", { style: { width: "100%" } })}
                      {campo(despacho, setDespacho, "comuna", "Comuna")}
                      {campo(despacho, setDespacho, "ciudad", "Ciudad")}
                    </div>
                  )}
                </div>
              )}
              {(esGuia || (conGuia && guiaPosible)) && <CamposSeguimientoGuia valor={seguimiento} onChange={setSeguimiento} disabled={!!enviando} />}
              {conObsGuia && <CampoObservacionGuia valor={observacion} onChange={setObservacion} compuesta={observacionFinal} max={obsMax} disabled={!!enviando} />}
              {!ventaDirecta && !esBoleta && <div style={caja}>
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
                    <input className="input" inputMode="numeric" value={cotizacion} onChange={(e) => setCotizacion(e.target.value.replace(/[^\d]/g, ""))} disabled={!!enviando || !!cotizacionId} readOnly={!!cotizacionId} placeholder="Ej: 5286" style={{ width: "100%" }} />
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
