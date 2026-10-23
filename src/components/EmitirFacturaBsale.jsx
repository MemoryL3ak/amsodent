import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, CheckCircle2, FileText, Info, Loader2, Mail, RotateCcw, Search, Trash2, X } from "lucide-react";
import { api } from "../lib/api";
import DateFilter from "./DateFilter";
import DropdownSelect from "./ui/DropdownSelect";
import VistaPreviaBsale from "./VistaPreviaBsale";
import AvisoCorreoDocumento from "./AvisoCorreoDocumento";
import BotonImprimirCarta from "./BotonImprimirCarta";
import BotonImprimirTermica from "./BotonImprimirTermica";
import RegistrarComprobanteRapido from "./RegistrarComprobanteRapido";

/* ── Emitir factura en Bsale (2026-10-02) ────────────────────────────────────
   Ventana que se abre desde Trazabilidad sobre una guía sin factura. El
   servidor arma el borrador a partir de la guía que ya existe en Bsale (mismas
   líneas, mismo cliente, referencia a la orden de compra y a la guía) y esta
   ventana lo muestra y deja decidir fecha, plazo y forma de pago (más
   corregir el folio de la orden de compra si la guía lo trae mal).
   (2026-10-24, pedido de Ariel) También se pueden editar las líneas: bajar la
   cantidad (nunca subirla: Bsale no deja facturar más que la guía), poner una
   observación por línea, quitar líneas y agregar productos del catálogo que
   no vienen en la guía. El precio se cambia en los productos agregados y en
   las líneas copiadas; el de una línea enlazada a la guía lo fija la guía (para
   otro precio: nota de crédito de ajuste o nota de débito después). Y «Todas
   las guías» arma una sola factura con todas las guías pendientes.
   Stock (comprobado en Bsale real, ver decidirDespacho en
   bsale-facturacion.service.ts, que esta ventana repite para mostrarlo): una
   línea enlazada no lo toca; una libre queda reservada como pendiente de
   despacho; si TODAS son libres la factura se despacha y rebaja el stock.

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
  // (2026-10-24) Edición de líneas: por detalle_id { cantidad, nota, quitada }; y productos agregados.
  const [edits, setEdits] = useState({});
  const [extras, setExtras] = useState([]); // { key, sku, producto, cantidad, neto_unitario, nota }
  const [qProducto, setQProducto] = useState("");
  const [productos, setProductos] = useState([]);
  const [buscandoProd, setBuscandoProd] = useState(false);
  const [enviando, setEnviando] = useState(""); // "" | "simular" | "emitir"
  const [resultado, setResultado] = useState(null);
  /* La simulación vale para ESTOS datos: la firma resume lo que la persona
     decide. Simular guarda la firma; si cambia algo, la simulación caduca y
     la confirmación también (hay que simular y confirmar de nuevo). */
  const firma = JSON.stringify({
    seleccion,
    fecha,
    dias,
    forma,
    oc: oc.trim().toUpperCase(),
    edits,
    extras: extras.map((x) => [x.sku, x.cantidad, x.neto_unitario, x.nota]),
  });
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
        setEdits((prev) => Object.fromEntries((b.lineas || []).map((l) => [l.detalle_id, prev[l.detalle_id] || { cantidad: String(l.cantidad), nota: l.nota || "", neto_unitario: String(l.neto_unitario_raw ?? l.neto_unitario), quitada: false }])));
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

  useEffect(() => {
    const q = qProducto.trim();
    if (q.length < 2) { setProductos([]); return undefined; }
    let vivo = true;
    setBuscandoProd(true);
    const t = setTimeout(() => {
      api
        .get(`/bsale/libre/productos?q=${encodeURIComponent(q)}`)
        .then((r) => vivo && setProductos(Array.isArray(r) ? r : []))
        .catch(() => vivo && setProductos([]))
        .finally(() => vivo && setBuscandoProd(false));
    }, 300);
    return () => { vivo = false; clearTimeout(t); };
  }, [qProducto]);

  // El servidor puede tener la emisión real apagada: ahí solo se simula.
  const apagada = borrador?.modo !== "activa";
  const bloqueada = (borrador?.problemas?.length || 0) > 0;
  const variasGuias = (borrador?.guias?.length || 0) > 1;
  const vence = fecha && dias !== "" ? sumarDias(fecha, dias) : "";
  const ocOriginal = (borrador?.referencias?.find((r) => r.codigo_sii === 801) || {}).numero || "";

  // ── Edición de líneas (2026-10-24) ──
  const cambiarEdit = (id, cambio) => setEdits((prev) => ({ ...prev, [id]: { ...(prev[id] || {}), ...cambio } }));
  const cambiarExtra = (key, cambio) => setExtras((prev) => prev.map((x) => (x.key === key ? { ...x, ...cambio } : x)));
  function agregarExtra(p) {
    setExtras((prev) => {
      if (prev.some((x) => x.sku === p.sku)) return prev.map((x) => (x.sku === p.sku ? { ...x, cantidad: String((Number(x.cantidad) || 0) + 1) } : x));
      return [...prev, { key: `${p.sku}-${Date.now()}`, sku: p.sku, producto: p.nombre, cantidad: "1", neto_unitario: p.lista1 != null && p.lista1 !== "" ? String(p.lista1) : "", nota: "" }];
    });
    setQProducto("");
    setProductos([]);
  }
  const numero = (v) => { const n = Number(String(v ?? "").replace(",", ".")); return Number.isFinite(n) ? n : NaN; };
  const cantidadDe = (l) => numero(edits[l.detalle_id]?.cantidad ?? l.cantidad);
  const precioGuia = (l) => Number(l.neto_unitario_raw ?? l.neto_unitario) || 0;
  const precioDe = (l) => numero(edits[l.detalle_id]?.neto_unitario ?? precioGuia(l));
  const precioCambiado = (l) => Number.isFinite(precioDe(l)) && Math.abs(precioDe(l) - precioGuia(l)) > 0.005;
  const netoLinea = (cant, unit) => Math.round((Number(cant) || 0) * (Number(unit) || 0));
  const lineasActivas = (borrador?.lineas || []).filter((l) => !edits[l.detalle_id]?.quitada);
  const netoEdit =
    lineasActivas.reduce((a, l) => a + netoLinea(cantidadDe(l), precioDe(l)), 0) +
    extras.reduce((a, x) => a + netoLinea(numero(x.cantidad), numero(x.neto_unitario)), 0);
  const totalesEdit = { neto: netoEdit, iva: Math.round(netoEdit * 0.19), total: netoEdit + Math.round(netoEdit * 0.19) };
  const cantidadInvalida =
    lineasActivas.some((l) => { const c = cantidadDe(l); return !(c > 0) || c > l.cantidad || !(precioDe(l) > 0); }) ||
    extras.some((x) => !(numero(x.cantidad) > 0) || !(numero(x.neto_unitario) > 0));
  const editada =
    extras.length > 0 ||
    (borrador?.lineas || []).some((l) => { const e = edits[l.detalle_id]; return !!e && (e.quitada || numero(e.cantidad) !== l.cantidad || (e.nota || "") !== (l.nota || "") || precioCambiado(l)); });
  /* Stock (misma regla que decidirDespacho en el servidor): rebajan las líneas
     copiadas tras una NC y las agregadas; las enlazadas a la guía y las de
     precio cambiado ya las rebajó la guía. Se despacha solo si TODAS rebajan. */
  const rebajaLinea = (l) => l.enlazada === false && !!l.consumida_por;
  const hayQueRebajar = lineasActivas.some(rebajaLinea) || extras.length > 0;
  const despachaEdit = hayQueRebajar && !lineasActivas.some((l) => !rebajaLinea(l));
  const todasSeleccionadas = (borrador?.guias_disponibles || []).length > 0 && borrador.guias_disponibles.every((g) => seleccion.includes(g.doc_id));
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
        // (2026-10-24) Líneas de la guía que se facturan (las quitadas no van), con cantidad y observación; y productos agregados.
        lineas: lineasActivas.map((l) => ({ detalle_id: l.detalle_id, cantidad: cantidadDe(l), nota: edits[l.detalle_id]?.nota ?? l.nota ?? "", ...(precioCambiado(l) ? { neto_unitario: precioDe(l) } : {}) })),
        extras: extras.map((x) => ({ sku: x.sku, producto: x.producto, cantidad: numero(x.cantidad), neto_unitario: numero(x.neto_unitario), nota: x.nota || "" })),
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

  // (2026-10-08) Emitido el documento, al cerrar se abre la ventana de correo para enviárselo al cliente.
  const cerrar = () => { if (enviando) return; if (resultado?.emitida) window.dispatchEvent(new Event("correos:check")); onCerrar?.(); };
  const completo = !cargando && !enviando && borrador && !bloqueada && fecha && dias !== "" && forma && !cantidadInvalida && lineasActivas.length + extras.length > 0;
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
        style={{ width: 900, maxWidth: "100%", margin: "auto", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-lg)" }}
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
              <div className="acciones-emitido" style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {/* (2026-10-09) Imprimir térmica (PDF de Bsale) o carta, y enviar al cliente sin esperar a cerrar. */}
                <BotonImprimirTermica urlPdf={resultado.url_pdf} etiqueta="Imprimir térmica" />
                {resultado.bsale_id && <BotonImprimirCarta bsaleId={resultado.bsale_id} etiqueta="Imprimir en carta" />}
                {resultado.correo?.ventana && (
                  <button type="button" className="btn btn-primary btn-sm" onClick={cerrar} title="Abre la ventana de correo con el documento adjunto">
                    <Mail size={13} /> Enviar al cliente
                  </button>
                )}
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
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                        <span style={etiqueta}>Guías que se facturan</span>
                        {(borrador.guias_disponibles || []).length > 1 && (
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            disabled={!!enviando}
                            onClick={() => setSeleccion(todasSeleccionadas ? [seleccion.includes(Number(guiaDocId)) ? Number(guiaDocId) : seleccion[0]] : borrador.guias_disponibles.map((g) => g.doc_id).sort((a, b) => a - b))}
                            title={todasSeleccionadas ? "Dejar una sola guía" : "Una sola factura con todas las guías pendientes de esta cotización"}
                            style={{ padding: "0 6px", height: "auto", minHeight: 22, fontSize: 11.5, whiteSpace: "nowrap" }}
                          >
                            {todasSeleccionadas ? "Solo una" : "Todas las guías"}
                          </button>
                        )}
                      </div>
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

                  {/* Líneas (2026-10-24: editables — cantidad hasta la de la guía, observación, quitar; y productos agregados) */}
                  <div style={{ border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden" }}>
                    <div style={{ maxHeight: 380, overflow: "auto" }}>
                      <table className="data-table" style={{ width: "100%", minWidth: 560 }}>
                        <thead>
                          <tr>
                            {variasGuias && <th style={{ textAlign: "left" }}>Guía</th>}
                            <th style={{ textAlign: "left" }}>SKU</th>
                            <th style={{ textAlign: "left" }}>Producto y observación</th>
                            <th style={{ textAlign: "right" }}>Cant.</th>
                            <th style={{ textAlign: "right" }}>Neto unit.</th>
                            <th style={{ textAlign: "right" }}>Neto</th>
                            <th style={{ width: 34 }} />
                          </tr>
                        </thead>
                        <tbody>
                          {borrador.lineas.map((l) => {
                            const e = edits[l.detalle_id] || { cantidad: String(l.cantidad), nota: l.nota || "", quitada: false };
                            const cant = cantidadDe(l);
                            const mala = !e.quitada && (!(cant > 0) || cant > l.cantidad);
                            return (
                              <tr key={l.detalle_id} style={e.quitada ? { opacity: 0.45 } : undefined}>
                                {variasGuias && <td style={{ whiteSpace: "nowrap", verticalAlign: "top" }}>{l.guia}</td>}
                                <td style={{ whiteSpace: "nowrap", fontWeight: 600, verticalAlign: "top", textDecoration: e.quitada ? "line-through" : "none" }}>{l.sku || "—"}</td>
                                <td style={{ overflowWrap: "anywhere", whiteSpace: "normal", minWidth: 180 }}>
                                  <div style={{ textDecoration: e.quitada ? "line-through" : "none" }}>{l.producto || "—"}</div>
                                  {e.quitada ? (
                                    <div style={{ fontSize: 11, color: "var(--text-muted)" }}>No se factura.</div>
                                  ) : (
                                    <input
                                      className="input"
                                      value={e.nota}
                                      onChange={(ev) => cambiarEdit(l.detalle_id, { nota: ev.target.value.slice(0, borrador.observacion_max || 250) })}
                                      disabled={!!enviando}
                                      placeholder="Observación de la línea (opcional)"
                                      title={l.nota_guia ? `En la guía: ${l.nota_guia}` : "Observación que irá en la línea de la factura"}
                                      style={{ width: "100%", height: 26, fontSize: 11.5, marginTop: 3, padding: "0 6px" }}
                                    />
                                  )}
                                  {!e.quitada && l.enlazada === false && (
                                    <div style={{ fontSize: 11, color: "#92400e", marginTop: 2 }}>
                                      Copiada, no enlazada: la usó la factura {l.consumida_por || "anulada"}.{" "}
                                      {despachaEdit
                                        ? `Rebaja stock al despacharse${l.stock_bsale != null ? ` (Bsale tiene ${Number(l.stock_bsale).toLocaleString("es-CL")})` : ""}.`
                                        : "Queda reservada en Bsale como pendiente de despacho."}
                                    </div>
                                  )}
                                </td>
                                <td style={{ textAlign: "right", whiteSpace: "nowrap", verticalAlign: "top" }}>
                                  {e.quitada ? (
                                    Number(l.cantidad).toLocaleString("es-CL")
                                  ) : (
                                    <input
                                      className="input"
                                      inputMode="decimal"
                                      value={e.cantidad}
                                      onChange={(ev) => cambiarEdit(l.detalle_id, { cantidad: ev.target.value.replace(/[^\d.,]/g, "").slice(0, 9) })}
                                      disabled={!!enviando}
                                      title={`En la guía: ${Number(l.cantidad).toLocaleString("es-CL")}. Se puede facturar menos, no más.`}
                                      style={{ width: 70, height: 28, textAlign: "right", fontSize: 12.5, padding: "0 6px", borderColor: mala ? "#dc2626" : undefined }}
                                    />
                                  )}
                                  {!e.quitada && !mala && cant !== l.cantidad && (
                                    <div style={{ fontSize: 10.5, color: "#92400e" }}>de {Number(l.cantidad).toLocaleString("es-CL")}</div>
                                  )}
                                  {mala && <div style={{ fontSize: 10.5, color: "#b91c1c" }}>máx. {Number(l.cantidad).toLocaleString("es-CL")}</div>}
                                </td>
                                <td style={{ textAlign: "right", whiteSpace: "nowrap", verticalAlign: "top" }}>
                                  {e.quitada || l.enlazada !== false ? (
                                    <span title={l.enlazada !== false ? "Lo fija la guía. Para cobrar otro precio, emite con este y después haz una nota de crédito de ajuste de precio (o una nota de débito si sube)." : undefined}>
                                      {clp(l.neto_unitario)}
                                    </span>
                                  ) : (
                                    <input
                                      className="input"
                                      inputMode="decimal"
                                      value={e.neto_unitario ?? String(precioGuia(l))}
                                      onChange={(ev) => cambiarEdit(l.detalle_id, { neto_unitario: ev.target.value.replace(/[^\d.,]/g, "").slice(0, 12) })}
                                      disabled={!!enviando}
                                      title={`Precio neto unitario. En la guía: ${clp(precioGuia(l))}`}
                                      style={{ width: 92, height: 28, textAlign: "right", fontSize: 12.5, padding: "0 6px", borderColor: precioDe(l) > 0 ? undefined : "#dc2626" }}
                                    />
                                  )}
                                  {!e.quitada && precioCambiado(l) && (
                                    <div style={{ fontSize: 10.5, color: "#92400e" }}>
                                      guía {clp(precioGuia(l))}{" "}
                                      <button type="button" className="btn-link" onClick={() => cambiarEdit(l.detalle_id, { neto_unitario: String(precioGuia(l)) })} disabled={!!enviando} style={{ fontSize: 10.5, padding: 0, background: "none", border: "none", color: "var(--primary)", cursor: "pointer", textDecoration: "underline" }}>
                                        volver
                                      </button>
                                    </div>
                                  )}
                                </td>
                                <td style={{ textAlign: "right", whiteSpace: "nowrap", fontWeight: 600, verticalAlign: "top" }}>{e.quitada ? "—" : clp(netoLinea(cant, precioDe(l)))}</td>
                                <td style={{ textAlign: "center", padding: "4px 2px", verticalAlign: "top" }}>
                                  <button
                                    type="button"
                                    className="btn btn-ghost btn-sm"
                                    onClick={() => cambiarEdit(l.detalle_id, { quitada: !e.quitada })}
                                    disabled={!!enviando}
                                    title={e.quitada ? "Volver a incluir esta línea" : "No facturar esta línea"}
                                    style={{ padding: 4, height: "auto", minHeight: 24 }}
                                  >
                                    {e.quitada ? <RotateCcw size={13} /> : <Trash2 size={13} />}
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                          {extras.map((x) => {
                            const cant = numero(x.cantidad);
                            const unit = numero(x.neto_unitario);
                            return (
                              <tr key={x.key} style={{ background: "#fffbeb" }}>
                                {variasGuias && <td style={{ whiteSpace: "nowrap", verticalAlign: "top", color: "var(--text-muted)" }}>—</td>}
                                <td style={{ whiteSpace: "nowrap", fontWeight: 600, verticalAlign: "top" }}>{x.sku}</td>
                                <td style={{ overflowWrap: "anywhere", whiteSpace: "normal", minWidth: 180 }}>
                                  <div>
                                    {x.producto || x.sku} <span style={{ fontSize: 10.5, color: "#92400e", fontWeight: 600 }}>agregado · no viene en la guía</span>
                                  </div>
                                  <div style={{ fontSize: 11, color: "#92400e" }}>
                                    {despachaEdit ? "Rebaja stock al despacharse." : "Queda reservado en Bsale como pendiente de despacho: emite la guía desde la factura cuando salga."}
                                  </div>
                                  <input
                                    className="input"
                                    value={x.nota}
                                    onChange={(ev) => cambiarExtra(x.key, { nota: ev.target.value.slice(0, borrador.observacion_max || 250) })}
                                    disabled={!!enviando}
                                    placeholder="Observación de la línea (opcional)"
                                    style={{ width: "100%", height: 26, fontSize: 11.5, marginTop: 3, padding: "0 6px" }}
                                  />
                                </td>
                                <td style={{ textAlign: "right", whiteSpace: "nowrap", verticalAlign: "top" }}>
                                  <input
                                    className="input"
                                    inputMode="decimal"
                                    value={x.cantidad}
                                    onChange={(ev) => cambiarExtra(x.key, { cantidad: ev.target.value.replace(/[^\d.,]/g, "").slice(0, 9) })}
                                    disabled={!!enviando}
                                    style={{ width: 70, height: 28, textAlign: "right", fontSize: 12.5, padding: "0 6px", borderColor: cant > 0 ? undefined : "#dc2626" }}
                                  />
                                </td>
                                <td style={{ textAlign: "right", whiteSpace: "nowrap", verticalAlign: "top" }}>
                                  <input
                                    className="input"
                                    inputMode="decimal"
                                    value={x.neto_unitario}
                                    onChange={(ev) => cambiarExtra(x.key, { neto_unitario: ev.target.value.replace(/[^\d.,]/g, "").slice(0, 12) })}
                                    disabled={!!enviando}
                                    placeholder="Neto"
                                    title="Precio neto unitario"
                                    style={{ width: 92, height: 28, textAlign: "right", fontSize: 12.5, padding: "0 6px", borderColor: unit >= 0 ? undefined : "#dc2626" }}
                                  />
                                </td>
                                <td style={{ textAlign: "right", whiteSpace: "nowrap", fontWeight: 600, verticalAlign: "top" }}>{clp(netoLinea(cant, unit))}</td>
                                <td style={{ textAlign: "center", padding: "4px 2px", verticalAlign: "top" }}>
                                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setExtras((prev) => prev.filter((y) => y.key !== x.key))} disabled={!!enviando} title="Quitar esta línea" style={{ padding: 4, height: "auto", minHeight: 24 }}>
                                    <Trash2 size={13} />
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                          {borrador.lineas.length === 0 && extras.length === 0 && (
                            <tr><td colSpan={variasGuias ? 7 : 6} style={{ textAlign: "center", color: "var(--text-muted)", padding: 18 }}>Sin productos.</td></tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                    <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", flexWrap: "wrap", gap: "4px 22px", padding: "10px 14px", borderTop: "1px solid var(--border)", background: "var(--bg)", fontSize: 13 }}>
                      {editada && <span style={{ marginRight: "auto", color: "#92400e", fontSize: 12 }}>Factura editada respecto a la guía.</span>}
                      <span>Neto <b>{clp(totalesEdit.neto)}</b></span>
                      <span>IVA 19% <b>{clp(totalesEdit.iva)}</b></span>
                      <span style={{ fontSize: 14 }}>Total <b>{clp(totalesEdit.total)}</b></span>
                    </div>
                  </div>

                  {/* Agregar un producto del catálogo que no viene en la guía (línea libre: descuenta stock) */}
                  <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <Search size={13} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
                    <input
                      className="input"
                      value={qProducto}
                      onChange={(e) => setQProducto(e.target.value)}
                      disabled={!!enviando}
                      placeholder="Agregar producto que no viene en la guía (SKU o nombre)…"
                      style={{ flex: "1 1 240px", minWidth: 0, height: 30, fontSize: 12.5 }}
                    />
                    {buscandoProd && <Loader2 size={13} className="spin" style={{ color: "var(--text-muted)" }} />}
                    {productos.length > 0 && qProducto.trim().length >= 2 && (
                      <div style={{ position: "absolute", left: 0, right: 0, top: "100%", zIndex: 5, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, boxShadow: "var(--shadow-lg)", maxHeight: 200, overflow: "auto" }}>
                        {productos.slice(0, 12).map((p) => (
                          <button key={p.sku} type="button" onClick={() => agregarExtra(p)} style={{ display: "flex", justifyContent: "space-between", gap: 8, width: "100%", textAlign: "left", padding: "7px 10px", background: "none", border: "none", cursor: "pointer", fontSize: 12.5 }}>
                            <span style={{ minWidth: 0, overflowWrap: "anywhere" }}><b>{p.sku}</b> · {p.nombre}</span>
                            <span style={{ color: "var(--text-muted)", whiteSpace: "nowrap" }}>{p.lista1 ? clp(p.lista1) : ""}</span>
                          </button>
                        ))}
                      </div>
                    )}
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
                      {borrador.referencias.map((r) => (r.codigo_sii === 801 ? `orden de compra ${borrador.oc_editable ? (oc.trim().toUpperCase() || r.numero) : r.numero}` : `guía ${r.folio}`)).join(" · ") || "nada"}.{" "}
                      {despachaEdit
                        ? "La factura se despacha en Bsale: rebaja el stock de todas sus líneas."
                        : hayQueRebajar
                          ? "La factura no se despacha en Bsale, porque lleva líneas cuyo stock ya rebajó la guía: las copiadas o agregadas quedan reservadas como pendientes de despacho. El precio de las líneas enlazadas lo fija la guía."
                          : "La factura no mueve stock: la guía ya lo rebajó. El precio de las líneas lo fija la guía."}
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
                  : `2. Emitir factura oficial por ${clp(totalesEdit.total)}`}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
