import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, Eye, FileText, Hand, Link2, Lock, MessageSquare, Receipt, RotateCcw, Truck, XCircle } from "lucide-react";
import { api } from "../../lib/api";
import DropdownSelect from "../ui/DropdownSelect";
import AccionPostventa from "./AccionPostventa";
import { ACCIONES_POSTVENTA, esAbierta, estadoPostventa, fechaHora, numero, quien, textoDocumentoAfectado } from "./postventaComun";

/* ── Detalle y gestión de una solicitud de postventa (2026-11-26) ────────────
   Es lo que se despliega bajo la fila de la bandeja: a la izquierda el reclamo
   (descripción, productos, documento y cotización afectados, responsable) y a
   la derecha la gestión: tomarla, registrar una de las tres acciones (nota de
   crédito, otra factura, guía de despacho), comentar, cerrarla o reabrirla, y
   la bitácora con todo lo hecho.

   En las solicitudes que vinieron del portal se indica qué ve el cliente: los
   cambios de estado y los documentos emitidos siempre; un comentario, solo si
   se marca «Visible para el cliente». */

const ICONO_ACCION = { nota_credito: FileText, factura: Receipt, guia_despacho: Truck };
const titulo = { fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".4px", color: "var(--text-muted)", marginBottom: 6 };
const bloque = { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: "12px 14px", minWidth: 0 };
const dato = (etiqueta, valor) => (
  <div style={{ display: "flex", gap: 8, fontSize: 12.5, padding: "2px 0" }}>
    <span style={{ color: "var(--text-muted)", flex: "0 0 104px" }}>{etiqueta}</span>
    <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>{valor}</span>
  </div>
);

export default function DetalleSolicitudPostventa({ id, contexto, puedeEmitir, puede, onCambio, onAviso }) {
  const [detalle, setDetalle] = useState(null);
  const [error, setError] = useState("");
  const [ocupado, setOcupado] = useState("");
  const [accion, setAccion] = useState(null); // { clave, gestion? }
  const [cierre, setCierre] = useState(null); // null | { estado, texto }
  const [comentario, setComentario] = useState("");
  const [visible, setVisible] = useState(false);

  const recibir = useCallback((r) => {
    if (!r?.solicitud) return;
    setDetalle(r);
    onCambio?.(r.solicitud);
  }, [onCambio]);

  useEffect(() => {
    let vivo = true;
    api
      .get(`/postventa/${id}`)
      .then((r) => vivo && setDetalle(r))
      .catch((e) => vivo && setError(e?.message || "No se pudo cargar la solicitud."));
    return () => { vivo = false; };
  }, [id]);

  async function ejecutar(clave, pedido, mensaje) {
    if (ocupado) return false;
    setOcupado(clave);
    try {
      recibir(await pedido());
      if (mensaje) onAviso?.({ type: "success", message: mensaje });
      return true;
    } catch (e) {
      onAviso?.({ type: "error", message: e?.message || "No se pudo completar la acción." });
      return false;
    } finally {
      setOcupado("");
    }
  }

  if (error) return <div style={{ fontSize: 12.5, color: "#dc2626", fontWeight: 600 }}>{error}</div>;
  if (!detalle) return <div style={{ fontSize: 12.5, color: "var(--text-muted)" }}>Cargando la solicitud…</div>;

  const s = detalle.solicitud;
  const abierta = esAbierta(s.estado);
  const delPortal = s.origen === "portal";
  const est = estadoPostventa(s.estado);
  const docAfectado = textoDocumentoAfectado(s);

  async function enviarComentario() {
    const texto = comentario.trim();
    if (texto.length < 2) return;
    const ok = await ejecutar("comentario", () => api.post(`/postventa/${s.id}/comentario`, { detalle: texto, visible_cliente: delPortal && visible }));
    if (ok) { setComentario(""); setVisible(false); }
  }
  async function confirmarCierre() {
    if (!cierre || cierre.texto.trim().length < 3) return;
    const ok = await ejecutar("cerrar", () => api.post(`/postventa/${s.id}/cerrar`, { estado: cierre.estado, resolucion: cierre.texto.trim() }), `Solicitud N° ${s.id} ${cierre.estado === "resuelta" ? "resuelta" : "rechazada"}.`);
    if (ok) setCierre(null);
  }

  return (
    <div className="detalle-postventa" style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-start" }}>
      {accion && (
        <AccionPostventa
          accion={accion.clave}
          gestion={accion.gestion || null}
          detalle={detalle}
          puedeEmitir={puedeEmitir}
          puede={puede}
          onCerrar={() => setAccion(null)}
          onRegistrada={(r) => { recibir(r); onAviso?.({ type: "success", message: accion.gestion ? "Documento asociado a la gestión." : "Acción registrada en la solicitud." }); }}
        />
      )}

      {/* El reclamo */}
      <div style={{ ...bloque, flex: "1 1 340px" }}>
        <div style={titulo}>Reclamo</div>
        <div style={{ fontSize: 13, whiteSpace: "pre-wrap", overflowWrap: "anywhere", marginBottom: 8 }}>{s.descripcion}</div>
        {dato("Categoría", s.categoria_nombre)}
        {dato("Cliente", <>{s.cliente_nombre || "—"} <span style={{ color: "var(--text-muted)" }}>· {s.cliente_rut_formateado}</span></>)}
        {dato("Cotización", s.licitacion_id ? (
          <Link to={`/detalle/${s.licitacion_id}`} target="_blank" rel="noopener noreferrer" className="table-link" title="Abrir la cotización en una pestaña nueva">
            {detalle.cotizacion?.id_licitacion || `#${s.licitacion_id}`}{detalle.cotizacion?.estado ? ` · ${detalle.cotizacion.estado}` : ""}
          </Link>
        ) : "Sin cotización asociada")}
        {docAfectado && dato("Documento", docAfectado)}
        {s.pedido_id && dato("Pedido", `Pedido del portal N° ${s.pedido_id}`)}
        {dato("Ingresó", <>{fechaHora(s.created_at)} · {delPortal ? `portal del cliente (${s.creada_por_nombre || s.creada_por || "cuenta principal"})` : s.creada_por_nombre || quien(s.creada_por)}</>)}
        {dato("Responsable", contexto?.es_admin ? (
          <DropdownSelect
            value={s.vendedor_email || ""}
            onChange={(v) => { if (v && v !== s.vendedor_email) ejecutar("vendedor", () => api.put(`/postventa/${s.id}/vendedor`, { vendedor_email: v }), "Responsable actualizado: recibe el aviso en su campana."); }}
            disabled={!!ocupado}
            minWidth={240}
            placeholder="Sin asignar"
            style={{ width: "100%", maxWidth: 260, height: 30 }}
            options={[...(s.vendedor_email && !(contexto.vendedores || []).some((v) => v.email === s.vendedor_email) ? [{ value: s.vendedor_email, label: quien(s.vendedor_email), detalle: s.vendedor_email }] : []), ...(contexto.vendedores || []).map((v) => ({ value: v.email, label: v.nombre, detalle: v.email }))]}
          />
        ) : s.vendedor_email ? quien(s.vendedor_email) : "Sin asignar")}
        {s.resolucion && (
          <div style={{ marginTop: 8, fontSize: 12.5, background: est.bg, color: est.color, borderRadius: 8, padding: "7px 10px", overflowWrap: "anywhere" }}>
            <strong>{s.estado === "rechazada" ? "Motivo del rechazo" : "Resolución"}:</strong> {s.resolucion}
            <div style={{ fontSize: 11.5, opacity: 0.85, marginTop: 2 }}>{fechaHora(s.cerrada_at)} · {quien(s.cerrada_por)}</div>
          </div>
        )}
        {s.productos.length > 0 && (
          <div style={{ marginTop: 10 }}>
            <div style={titulo}>Productos afectados</div>
            <div className="table-wrap" style={{ margin: 0 }}>
              <table className="data-table tabla-compacta tabla-texto" style={{ minWidth: 300 }}>
                <thead>
                  <tr><th>Producto</th><th style={{ textAlign: "right", width: 90 }}>Cantidad</th></tr>
                </thead>
                <tbody>
                  {s.productos.map((p, i) => (
                    <tr key={`${p.sku || ""}-${i}`}>
                      <td>
                        <div style={{ fontWeight: 600, overflowWrap: "anywhere" }}>{p.nombre}</div>
                        {p.sku && <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>{p.sku}</div>}
                      </td>
                      <td style={{ textAlign: "right", fontWeight: 700 }}>{numero(p.cantidad)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* La gestión */}
      <div style={{ ...bloque, flex: "1.3 1 400px" }}>
        <div style={titulo}>Gestión</div>
        <div className="acciones-postventa" style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
          {s.estado === "ingresada" && (
            <button type="button" className="btn btn-primary btn-sm btn-tomar-postventa" disabled={!!ocupado} onClick={() => ejecutar("tomar", () => api.post(`/postventa/${s.id}/tomar`, {}), `Tomaste la solicitud N° ${s.id}: pasó a «En gestión».`)} style={{ display: "inline-flex", alignItems: "center", gap: 6 }} title="La solicitud pasa a «En gestión»">
              <Hand size={14} /> {ocupado === "tomar" ? "Tomando…" : "Tomar solicitud"}
            </button>
          )}
          {abierta && ACCIONES_POSTVENTA.map((a) => {
            const Icono = ICONO_ACCION[a.clave];
            return (
              <button key={a.clave} type="button" className="btn btn-secondary btn-sm btn-accion-postventa" disabled={!!ocupado} onClick={() => setAccion({ clave: a.clave })} style={{ display: "inline-flex", alignItems: "center", gap: 6 }} title={a.nombre}>
                <Icono size={14} /> {a.corto}
              </button>
            );
          })}
          {abierta && !cierre && (
            <>
              <button type="button" className="btn btn-secondary btn-sm" disabled={!!ocupado} onClick={() => setCierre({ estado: "resuelta", texto: "" })} style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "#15803d" }}>
                <CheckCircle2 size={14} /> Resolver
              </button>
              <button type="button" className="btn btn-secondary btn-sm" disabled={!!ocupado} onClick={() => setCierre({ estado: "rechazada", texto: "" })} style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "#b91c1c" }}>
                <XCircle size={14} /> Rechazar
              </button>
            </>
          )}
          {!abierta && (
            <button type="button" className="btn btn-secondary btn-sm" disabled={!!ocupado} onClick={() => ejecutar("reabrir", () => api.post(`/postventa/${s.id}/reabrir`, {}), `Solicitud N° ${s.id} reabierta.`)} style={{ display: "inline-flex", alignItems: "center", gap: 6 }} title="Vuelve a «En gestión»">
              <RotateCcw size={14} /> {ocupado === "reabrir" ? "Reabriendo…" : "Reabrir"}
            </button>
          )}
        </div>

        {cierre && (
          <div className="cierre-postventa" style={{ border: `1px solid ${cierre.estado === "resuelta" ? "#bbf7d0" : "#fecaca"}`, background: cierre.estado === "resuelta" ? "#f0fdf4" : "#fef2f2", borderRadius: 10, padding: "10px 12px", marginBottom: 10, display: "flex", flexDirection: "column", gap: 8 }}>
            <strong style={{ fontSize: 12.5 }}>{cierre.estado === "resuelta" ? "Cerrar como resuelta" : "Cerrar como rechazada"}</strong>
            <textarea className="input" autoFocus value={cierre.texto} onChange={(e) => setCierre({ ...cierre, texto: e.target.value.slice(0, 1500) })} disabled={!!ocupado} rows={2} placeholder={cierre.estado === "resuelta" ? "Cómo se resolvió" : "Motivo del rechazo"} style={{ width: "100%", height: "auto", minHeight: 56, padding: "8px 10px", resize: "vertical" }} />
            {delPortal && <span style={{ fontSize: 11.5, color: "var(--text-soft)" }}>El cliente verá este texto en su portal y recibirá el aviso.</span>}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setCierre(null)} disabled={!!ocupado}>Cancelar</button>
              <button type="button" className="btn btn-primary btn-sm btn-confirmar-cierre" onClick={confirmarCierre} disabled={!!ocupado || cierre.texto.trim().length < 3}>{ocupado === "cerrar" ? "Guardando…" : cierre.estado === "resuelta" ? "Marcar resuelta" : "Marcar rechazada"}</button>
            </div>
          </div>
        )}

        {/* Bitácora */}
        <div className="bitacora-postventa" style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
          {detalle.gestiones.length === 0 && <div style={{ fontSize: 12.5, color: "var(--text-muted)" }}>Todavía no hay gestiones. {s.estado === "ingresada" ? "Toma la solicitud para empezar." : ""}</div>}
          {detalle.gestiones.map((g) => {
            const Icono = g.es_accion ? ICONO_ACCION[g.tipo] : g.tipo === "comentario" ? MessageSquare : RotateCcw;
            const sinDocumento = g.es_accion && !g.documento_id && !g.documento_numero;
            return (
              <div key={g.id} style={{ display: "flex", gap: 9, alignItems: "flex-start", fontSize: 12.5, borderLeft: `3px solid ${g.es_accion ? "var(--primary)" : "var(--border)"}`, paddingLeft: 9 }}>
                <Icono size={14} style={{ flexShrink: 0, marginTop: 2, color: g.es_accion ? "var(--primary)" : "var(--text-muted)" }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", gap: "2px 8px", flexWrap: "wrap", alignItems: "baseline" }}>
                    <strong>{g.tipo === "cambio_estado" && g.estado_nuevo ? `Pasó a «${estadoPostventa(g.estado_nuevo).nombre}»` : g.tipo_nombre}{g.documento_numero ? ` · N° ${g.documento_numero}` : ""}</strong>
                    <span style={{ fontSize: 11.5, color: "var(--text-muted)" }}>{fechaHora(g.created_at)} · {g.usuario_nombre || quien(g.usuario_email)}</span>
                    {delPortal && (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 11, fontWeight: 700, color: g.visible_cliente ? "#0f766e" : "var(--text-muted)" }} title={g.visible_cliente ? "El cliente lo ve en su portal" : "Solo lo ve el equipo"}>
                        {g.visible_cliente ? <Eye size={11} /> : <Lock size={11} />} {g.visible_cliente ? "Lo ve el cliente" : "Interno"}
                      </span>
                    )}
                  </div>
                  {g.detalle && !(g.tipo === "cambio_estado" && g.estado_nuevo === "en_gestion") && <div style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", color: "var(--text-soft)" }}>{g.detalle}</div>}
                  {sinDocumento && (
                    <button type="button" onClick={() => setAccion({ clave: g.tipo, gestion: g })} disabled={!!ocupado} style={{ display: "inline-flex", alignItems: "center", gap: 5, border: "none", background: "transparent", color: "#b45309", fontWeight: 700, fontSize: 12, cursor: "pointer", padding: "2px 0", fontFamily: "inherit" }} title="Elige el documento emitido o escribe su número">
                      <Link2 size={12} /> Sin documento: asociar
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Comentario */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
          <textarea className="input campo-comentario-postventa" value={comentario} onChange={(e) => setComentario(e.target.value.slice(0, 1500))} disabled={!!ocupado} rows={1} placeholder="Agregar un comentario a la bitácora…" style={{ flex: "1 1 240px", minWidth: 0, height: "auto", minHeight: 36, padding: "8px 10px", resize: "vertical" }} />
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            {delPortal && (
              <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text-soft)", cursor: "pointer" }} title="Si lo marcas, el cliente lo lee en su portal y recibe el aviso">
                <input type="checkbox" checked={visible} onChange={(e) => setVisible(e.target.checked)} disabled={!!ocupado} /> Visible para el cliente
              </label>
            )}
            <button type="button" className="btn btn-secondary btn-sm btn-comentar-postventa" onClick={enviarComentario} disabled={!!ocupado || comentario.trim().length < 2}>{ocupado === "comentario" ? "Guardando…" : "Comentar"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
