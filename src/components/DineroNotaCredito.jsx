import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { CheckCircle2, Undo2, Wallet, X } from "lucide-react";
import { api } from "../lib/api";
import DropdownSelect from "./ui/DropdownSelect";
import { ETIQUETA_DINERO } from "../lib/dineroNotaCredito";

/* ── Dinero de las notas de crédito (2026-10-08) ────────────────────────────
   Pedido de Ariel: "al anular una factura se le devuelve dinero al cliente:
   esa factura debe quedar impaga y hay que dar trazabilidad a la devolución.
   Si se devuelve o queda como saldo a favor se decide al emitir la NC, y todo
   se ve en Trazabilidad → Facturas".
   · La NC trae `dinero`: devolver | saldo_favor | rebajar_deuda | sin_movimiento.
   · La devolución es un documento `devolucion` colgado de la factura y que
     apunta a la NC (origen_doc_id); el saldo a favor aplicado a otra factura
     es un comprobante_pago con origen_doc_id = la NC.
   · La cuenta (qué quedó en manos del cliente) está en lib/dineroNotaCredito.js,
     igual que en el servidor; acá solo la celda y las dos ventanas. */

const clp = (n) => `$${Math.round(Number(n) || 0).toLocaleString("es-CL")}`;
const bruto = (neto) => Math.round((Number(neto) || 0) * 1.19);
const fechaCL = (iso) => {
  const [y, m, d] = String(iso || "").slice(0, 10).split("-");
  return y && m && d ? `${d}-${m}-${y}` : "—";
};
const hoyIso = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const soloDigitos = (s) => String(s || "").replace(/\D/g, "");

const pill = (texto, color, fondo, title) => (
  <span style={{ fontSize: 11, fontWeight: 700, color, background: fondo, padding: "1px 7px", borderRadius: 999, whiteSpace: "nowrap" }} title={title}>{texto}</span>
);

/* Lo que pasó con el dinero de cada nota de crédito de la factura (celda «Pago y dinero»). */
export function DineroFactura({ f, puedeOperar = false, onRegistrar, onAplicar }) {
  const d = f?.dinero;
  if (!d || !d.notas.length) return null;
  return (
    <div className="dinero-nc" style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 4, fontSize: 11.5, whiteSpace: "normal", maxWidth: 260 }}>
      {d.notas.map((n) => {
        const sin = !n.dinero;
        const activa = n.disponible > 0 && (n.dinero === "devolver" || n.dinero === "saldo_favor" || sin);
        return (
          <div key={n.nc.id} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            {n.dinero === "rebajar_deuda" && <span style={{ color: "var(--text-muted)" }}>NC {n.nc.numero}: deuda rebajada, no había pago</span>}
            {n.dinero === "sin_movimiento" && <span style={{ color: "var(--text-muted)" }}>NC {n.nc.numero}: sin movimiento de dinero</span>}
            {n.dinero === "devolver" && n.disponible > 0 && pill(`Devolución pendiente ${clp(n.disponible)}`, "#b91c1c", "#fee2e2", `NC ${n.nc.numero}: el cliente ya había pagado; falta devolverle ${clp(n.disponible)}`)}
            {n.dinero === "saldo_favor" && n.disponible > 0 && pill(`Saldo a favor ${clp(n.disponible)}`, "#1d4ed8", "#dbeafe", `NC ${n.nc.numero}: el cliente tiene ${clp(n.disponible)} a favor para su próxima factura`)}
            {sin && n.disponible > 0 && pill(`Pagó ${clp(n.disponible)} · sin decisión`, "#b45309", "#fef3c7", `NC ${n.nc.numero} sin decisión sobre el dinero: regístrale la devolución o aplícalo como saldo a favor`)}
            {(n.dinero === "devolver" || n.dinero === "saldo_favor") && n.base <= 0 && (
              <span style={{ color: "var(--text-muted)" }}>NC {n.nc.numero}: {ETIQUETA_DINERO[n.dinero].toLowerCase()} · sin pago registrado</span>
            )}
            {n.devuelto > 0 && (
              <span style={{ color: "#15803d" }}>
                ✓ Devuelto {clp(n.devuelto)}
                {n.devoluciones.map((x) => ` · ${fechaCL(x.fecha_oc)} ${x.forma_pago || ""}${x.numero ? ` N° ${x.numero}` : ""}`).join("")}
              </span>
            )}
            {n.usado > 0 && (
              <span style={{ color: "#1d4ed8" }}>
                Aplicado {clp(n.usado)}{" "}
                {n.usos.map((u, i) => (
                  <span key={u.id || i}>
                    {i > 0 ? ", " : ""}
                    <Link to={`/detalle/${u.licitacion_id}`} className="table-link" title={u.descripcion || ""}>cot. #{u.licitacion_id}</Link>
                  </span>
                ))}
              </span>
            )}
            {puedeOperar && activa && (
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                {n.dinero !== "saldo_favor" && (
                  <button type="button" className="btn btn-secondary btn-sm" style={{ fontSize: 11 }} onClick={() => onRegistrar?.(n)} title="Registrar la transferencia o el efectivo devuelto al cliente">
                    <Undo2 size={12} /> Registrar devolución
                  </button>
                )}
                {n.dinero !== "devolver" && (
                  <button type="button" className="btn btn-secondary btn-sm" style={{ fontSize: 11 }} onClick={() => onAplicar?.(n)} title="Aplicar el saldo a favor a otra factura del mismo cliente">
                    <Wallet size={12} /> Aplicar a una factura
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

const fondo = { position: "fixed", inset: 0, background: "rgba(15,23,42,.55)", zIndex: 11000, display: "flex", padding: 16, overflowY: "auto" };
const ventana = { width: 560, maxWidth: "100%", margin: "auto", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-lg)" };
const etiqueta = { fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".4px", color: "var(--text-muted)", display: "block", marginBottom: 4 };
const cajaError = { border: "1px solid #fecaca", background: "#fef2f2", color: "#b91c1c", borderRadius: 10, padding: "10px 12px", fontSize: 13, overflowWrap: "anywhere" };
const cajaOk = { border: "1px solid #bbf7d0", background: "#f0fdf4", borderRadius: 10, padding: 14, display: "flex", flexDirection: "column", gap: 6, fontSize: 13 };

function Marco({ className, titulo, icono, onCerrar, enviando, children }) {
  return createPortal(
    <div onClick={() => !enviando && onCerrar?.()} style={fondo}>
      <div className={className} onClick={(e) => e.stopPropagation()} style={ventana}>
        <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <strong style={{ fontSize: 15, display: "inline-flex", alignItems: "center", gap: 7 }}>{icono} {titulo}</strong>
          <button type="button" onClick={onCerrar} className="btn btn-ghost" style={{ padding: 6, flexShrink: 0 }} title="Cerrar" disabled={!!enviando}><X size={16} /></button>
        </div>
        <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 12 }}>{children}</div>
      </div>
    </div>,
    document.body,
  );
}

const campo = (label, props = {}, ancho = "1 1 150px") => (
  <label style={{ flex: ancho, minWidth: 0 }}>
    <span style={etiqueta}>{label}</span>
    <input className="input" style={{ width: "100%" }} {...props} />
  </label>
);

const nombreDoc = (f) => (f?.tipo === "factura" ? "factura" : f?.esBoleta ? "boleta" : "factura/boleta");

/* Registrar la devolución del dinero (transferencia, efectivo…) con su comprobante. */
export function RegistrarDevolucionModal({ nota, factura, onCerrar, onHecho }) {
  const [monto, setMonto] = useState(String(Math.round(nota?.disponible || 0)));
  const [fecha, setFecha] = useState(hoyIso());
  const [medio, setMedio] = useState("Transferencia");
  const [banco, setBanco] = useState("");
  const [comprobante, setComprobante] = useState("");
  const [observacion, setObservacion] = useState("");
  const [archivo, setArchivo] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState("");
  const [listo, setListo] = useState(null);
  const medios = ["Transferencia", "Efectivo", "Reverso de tarjeta / Webpay", "Cheque"].map((m) => ({ value: m, label: m }));
  const montoNum = Number(soloDigitos(monto)) || 0;
  const tope = Math.round(nota?.disponible || 0);

  async function registrar() {
    if (enviando) return;
    setError("");
    if (!(montoNum > 0)) return setError("Indica el monto devuelto (con IVA).");
    if (montoNum > tope + 2) return setError(`Se puede devolver hasta ${clp(tope)}: lo pagado que cubre la nota de crédito y no se ha devuelto ni aplicado.`);
    setEnviando(true);
    try {
      let adjunto = null;
      if (archivo) {
        const ext = (archivo.name.split(".").pop() || "pdf").toLowerCase();
        const path = `${factura.lic.id}/${Date.now()}-devolucion-nc${nota.nc.id}.${ext}`;
        const fd = new FormData();
        fd.append("file", archivo);
        await api.postForm(`/licitaciones/storage/upload?bucket=factura&path=${encodeURIComponent(path)}`, fd);
        adjunto = { bucket: "factura", storage_path: path, file_name: archivo.name, mime_type: archivo.type || "application/pdf", size_bytes: Number(archivo.size || 0) };
      }
      const r = await api.post("/licitaciones/devoluciones", {
        nc_id: nota.nc.id, monto: montoNum, fecha, medio, banco: banco.trim(), comprobante: comprobante.trim(), observacion: observacion.trim(), archivo: adjunto,
      });
      setListo(r);
      onHecho?.(r);
    } catch (e) {
      setError(e?.message || "No se pudo registrar la devolución.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Marco className="modal-devolucion" titulo="Registrar devolución" icono={<Undo2 size={16} style={{ color: "var(--primary)" }} />} onCerrar={onCerrar} enviando={enviando}>
      {listo ? (
        <div style={cajaOk}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 15, fontWeight: 700, color: "#15803d" }}><CheckCircle2 size={18} /> Devolución de {clp(montoNum)} registrada</div>
          <div>
            Queda en la cotización <Link to={`/detalle/${factura.lic.id}`} className="table-link" style={{ fontWeight: 700 }}>#{factura.lic.id}</Link> colgada de la {nombreDoc(factura)} N° {factura.numero}, con la nota de crédito N° {nota.nc.numero}.
            {listo.factura_pagada === false ? ` La ${nombreDoc(factura)} queda sin pago.` : ""}
            {listo.pendiente_devolver > 0 ? ` Falta devolver ${clp(listo.pendiente_devolver)}.` : ""}
          </div>
          <button type="button" className="btn btn-primary btn-sm" style={{ alignSelf: "flex-start" }} onClick={onCerrar}>Cerrar</button>
        </div>
      ) : (
        <>
          <div style={{ fontSize: 13 }}>
            La nota de crédito N° {nota.nc.numero} {nota.base >= bruto(factura.monto) - 2 ? "anuló" : "rebajó"} la {nombreDoc(factura)} N° {factura.numero} de <b>{factura.lic?.nombre_entidad || "—"}</b>, que ya estaba pagada:
            el cliente tiene <b>{clp(tope)}</b> por recibir{nota.devuelto > 0 ? ` (ya se devolvieron ${clp(nota.devuelto)})` : ""}.
          </div>
          {error && <div style={cajaError}>{error}</div>}
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {campo("Monto devuelto (con IVA)", { inputMode: "numeric", value: monto ? Number(soloDigitos(monto)).toLocaleString("es-CL") : "", onChange: (e) => setMonto(soloDigitos(e.target.value)), disabled: enviando, className: "input monto-devolucion" })}
            {campo("Fecha", { type: "date", value: fecha, onChange: (e) => setFecha(e.target.value), disabled: enviando })}
            <div style={{ flex: "1 1 200px", minWidth: 0 }}>
              <span style={etiqueta}>Cómo se devolvió</span>
              <DropdownSelect value={medio} onChange={setMedio} options={medios} disabled={enviando} minWidth={200} style={{ width: "100%" }} />
            </div>
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {campo("Banco (opcional)", { value: banco, onChange: (e) => setBanco(e.target.value), disabled: enviando, placeholder: "Ej: BCI" })}
            {campo("N° de comprobante (opcional)", { value: comprobante, onChange: (e) => setComprobante(e.target.value), disabled: enviando, placeholder: "N° de la transferencia" })}
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <label style={{ flex: "1 1 200px", minWidth: 0 }}>
              <span style={etiqueta}>Comprobante (PDF o imagen, opcional)</span>
              <input type="file" accept=".pdf,image/*" onChange={(e) => setArchivo(e.target.files?.[0] || null)} disabled={enviando} style={{ fontSize: 12.5 }} />
            </label>
            {campo("Observación (opcional)", { value: observacion, onChange: (e) => setObservacion(e.target.value.slice(0, 300)), disabled: enviando }, "2 1 220px")}
          </div>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
            <button type="button" className="btn btn-secondary btn-sm" onClick={onCerrar} disabled={enviando}>Cancelar</button>
            <button type="button" className="btn btn-primary btn-sm" onClick={registrar} disabled={enviando || !(montoNum > 0)}>
              {enviando ? "Registrando…" : `Registrar devolución de ${clp(montoNum)}`}
            </button>
          </div>
        </>
      )}
    </Marco>
  );
}

/* Aplicar el saldo a favor a otra factura del mismo cliente. */
export function UsarSaldoFavorModal({ nota, factura, onCerrar, onHecho }) {
  const [info, setInfo] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [destino, setDestino] = useState("");
  const [monto, setMonto] = useState("");
  const [fecha, setFecha] = useState(hoyIso());
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState("");
  const [listo, setListo] = useState(null);

  useEffect(() => {
    let vivo = true;
    api.get(`/licitaciones/devoluciones/nota/${nota.nc.id}`)
      .then((r) => {
        if (!vivo) return;
        setInfo(r);
        const primera = r?.candidatas?.[0];
        if (primera) {
          setDestino(String(primera.id));
          setMonto(String(Math.min(Number(r.disponible_bruto) || 0, Number(primera.saldo_bruto) || 0)));
        }
      })
      .catch((e) => vivo && setError(e?.message || "No se pudieron leer las facturas del cliente."))
      .finally(() => vivo && setCargando(false));
    return () => { vivo = false; };
  }, [nota.nc.id]);

  const elegida = (info?.candidatas || []).find((c) => String(c.id) === destino) || null;
  const disponible = Math.round(Number(info?.disponible_bruto ?? nota?.disponible) || 0);
  const tope = elegida ? Math.min(disponible, Math.round(Number(elegida.saldo_bruto) || 0)) : disponible;
  const montoNum = Number(soloDigitos(monto)) || 0;

  async function aplicar() {
    if (enviando || !elegida) return;
    setError("");
    if (!(montoNum > 0)) return setError("Indica el monto a aplicar (con IVA).");
    if (montoNum > tope + 2) return setError(`Se puede aplicar hasta ${clp(tope)}: saldo a favor ${clp(disponible)} y saldo de la factura ${clp(elegida.saldo_bruto)}.`);
    setEnviando(true);
    try {
      const r = await api.post("/licitaciones/devoluciones/saldo-favor", { nc_id: nota.nc.id, factura_id: elegida.id, monto: montoNum, fecha });
      setListo(r);
      onHecho?.(r);
    } catch (e) {
      setError(e?.message || "No se pudo aplicar el saldo a favor.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Marco className="modal-saldo-favor" titulo="Aplicar saldo a favor" icono={<Wallet size={16} style={{ color: "var(--primary)" }} />} onCerrar={onCerrar} enviando={enviando}>
      {listo ? (
        <div style={cajaOk}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 15, fontWeight: 700, color: "#15803d" }}><CheckCircle2 size={18} /> {clp(montoNum)} aplicados a la factura N° {listo.destino?.numero || elegida?.numero}</div>
          <div>
            Quedó como pago de esa factura en la cotización <Link to={`/detalle/${listo.destino?.licitacion_id || elegida?.licitacion_id}`} className="table-link" style={{ fontWeight: 700 }}>#{listo.destino?.licitacion_id || elegida?.licitacion_id}</Link>, con origen en la nota de crédito N° {nota.nc.numero}.
            {listo.factura_pagada ? " La factura quedó pagada." : ""}
            {listo.saldo_favor > 0 ? ` Al cliente le quedan ${clp(listo.saldo_favor)} a favor.` : ""}
          </div>
          <button type="button" className="btn btn-primary btn-sm" style={{ alignSelf: "flex-start" }} onClick={onCerrar}>Cerrar</button>
        </div>
      ) : (
        <>
          <div style={{ fontSize: 13 }}>
            Por la nota de crédito N° {nota.nc.numero} de la {nombreDoc(factura)} N° {factura.numero}, <b>{factura.lic?.nombre_entidad || "el cliente"}</b> tiene <b>{clp(disponible)}</b> a favor.
            Se aplica como pago a otra de sus facturas con saldo.
          </div>
          {error && <div style={cajaError}>{error}</div>}
          {cargando ? (
            <div style={{ fontSize: 12.5, color: "var(--text-muted)" }}>Buscando facturas del cliente…</div>
          ) : !(info?.candidatas || []).length ? (
            <div style={{ fontSize: 12.5, color: "#92400e", border: "1px solid #fde68a", background: "#fffbeb", borderRadius: 10, padding: "10px 12px" }}>
              El cliente no tiene otras facturas con saldo. El monto queda a su favor para la próxima; si prefiere recibirlo, regístralo como devolución.
            </div>
          ) : (
            <>
              <div>
                <span style={etiqueta}>Factura a la que se aplica</span>
                <DropdownSelect
                  value={destino}
                  onChange={(v) => { setDestino(v); const c = (info?.candidatas || []).find((x) => String(x.id) === v); if (c) setMonto(String(Math.min(disponible, Math.round(Number(c.saldo_bruto) || 0)))); }}
                  options={(info?.candidatas || []).map((c) => ({ value: String(c.id), label: `${c.tipo === "factura" ? "Factura" : c.tipo === "boleta" ? "Boleta" : "Documento"} N° ${c.numero} · ${fechaCL(c.fecha)} · saldo ${clp(c.saldo_bruto)}`, detalle: `Cotización #${c.licitacion_id}${c.codigo && c.codigo !== String(c.licitacion_id) ? ` (${c.codigo})` : ""}` }))}
                  disabled={enviando}
                  minWidth={260}
                  style={{ width: "100%" }}
                />
              </div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                {campo("Monto a aplicar (con IVA)", { inputMode: "numeric", value: monto ? Number(soloDigitos(monto)).toLocaleString("es-CL") : "", onChange: (e) => setMonto(soloDigitos(e.target.value)), disabled: enviando, className: "input monto-saldo-favor" })}
                {campo("Fecha", { type: "date", value: fecha, onChange: (e) => setFecha(e.target.value), disabled: enviando })}
              </div>
              <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Máximo {clp(tope)}: lo menor entre el saldo a favor y lo que debe esa factura.</div>
            </>
          )}
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
            <button type="button" className="btn btn-secondary btn-sm" onClick={onCerrar} disabled={enviando}>Cancelar</button>
            {!!(info?.candidatas || []).length && (
              <button type="button" className="btn btn-primary btn-sm" onClick={aplicar} disabled={enviando || !elegida || !(montoNum > 0)}>
                {enviando ? "Aplicando…" : `Aplicar ${clp(montoNum)}`}
              </button>
            )}
          </div>
        </>
      )}
    </Marco>
  );
}
