import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { CheckCircle2, MessageSquare, MessageSquareText, X } from "lucide-react";
import { api } from "../lib/api";

/* ── Comentario interno de un documento (2026-11-19) ─────────────────────────
   Pedido de Ariel: "después de emitir cada documento (factura o guía), se
   pueda agregar un comentario general (este comentario solo vive en la
   plataforma, no se envía a Bsale)".
   Va en el documento registrado en la cotización (licitacion_documentos), con
   quién lo escribió y cuándo. No es la «Observación» de la guía —esa sí viaja
   a Bsale—: este texto no sale de la plataforma, ni al PDF ni al correo.
   Dos formas:
   · <ComentarioDocumento/>: el recuadro que aparece en la ventana de emisión
     apenas el documento queda emitido. Guarda al salir del campo (o con el
     botón), para que no se pierda al cerrar la ventana.
   · <BotonComentarioDocumento/>: el ícono junto al N° del documento en las
     tablas (Trazabilidad, Facturación, Venta directa); abre una ventana para
     leerlo o editarlo. Resaltado cuando el documento ya tiene comentario. */

export const COMENTARIO_DOCUMENTO_MAX = 1000;

const etiqueta = { fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".4px", color: "var(--text-muted)", display: "block", marginBottom: 4 };
const AVISO_INTERNO = "Solo queda en la plataforma: no se envía a Bsale ni al cliente.";
const limpiar = (v) => String(v ?? "").trim().slice(0, COMENTARIO_DOCUMENTO_MAX);

const guardarComentario = (documentoId, texto) => api.put(`/licitaciones/documentos/${Number(documentoId)}/comentario`, { comentario: limpiar(texto) });

function pieComentario(at, por) {
  const cuando = at ? new Date(at).toLocaleString("es-CL", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
  const quien = String(por || "").split("@")[0];
  return [cuando, quien].filter(Boolean).join(" · ");
}

/* ── Observación al CREAR el documento (2026-11-26) ──────────────────────────
   Pedido de Ariel: «agregar campo observación cuando se cree una guía de
   despacho, factura y se suba una orden de compra. Esta observación se agrega
   como columna nueva en trazabilidad». Es el MISMO comentario interno de
   arriba, solo que ahora se puede escribir antes de crear el documento:
   · <CampoObservacionInterna/>: el campo del formulario (carga manual de OC,
     guía o factura, y ventanas de emisión en Bsale). No viaja a Bsale ni cambia
     la simulación.
   · guardarObservacionInicial(): la guarda apenas el documento existe. Nunca
     lanza: si falla, devuelve null y el texto queda en el recuadro de después
     de emitir, pendiente de guardar. */
export function CampoObservacionInterna({ valor, onChange, disabled = false, nombreDocumento = "el documento", estilo }) {
  return (
    <label className="campo-observacion-interna" style={{ display: "block", minWidth: 0, ...estilo }}>
      <span style={{ ...etiqueta, display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><MessageSquare size={12} /> Observación interna de {nombreDocumento} (opcional)</span>
        <span style={{ fontWeight: 600, textTransform: "none", letterSpacing: 0 }}>{String(valor || "").length}/{COMENTARIO_DOCUMENTO_MAX}</span>
      </span>
      <textarea
        className="input"
        rows={2}
        value={valor || ""}
        maxLength={COMENTARIO_DOCUMENTO_MAX}
        onChange={(e) => onChange?.(e.target.value)}
        disabled={disabled}
        placeholder="Ej: el cliente retira el viernes, se despacha en dos partes…"
        style={{ width: "100%", resize: "vertical", minHeight: 48, fontSize: 13, lineHeight: 1.4 }}
      />
      <span style={{ display: "block", fontSize: 11.5, color: "var(--text-muted)", marginTop: 3 }}>Se ve en la columna «Observación» de Trazabilidad. {AVISO_INTERNO}</span>
    </label>
  );
}

export async function guardarObservacionInicial(documentoId, texto) {
  const t = limpiar(texto);
  if (!documentoId || !t) return null;
  try {
    return await guardarComentario(documentoId, t);
  } catch {
    return null;
  }
}

/* `borrador`: texto escrito antes de emitir que aún no se pudo guardar (queda
   en el recuadro como pendiente). Por defecto, lo ya guardado (`inicial`). */
export default function ComentarioDocumento({ documentoId, nombreDocumento = "el documento", inicial = "", borrador, onGuardado }) {
  const [texto, setTexto] = useState((borrador ?? inicial) || "");
  const [guardado, setGuardado] = useState(limpiar(inicial));
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const [hecho, setHecho] = useState(false);

  if (!documentoId) return null;
  const pendiente = limpiar(texto) !== guardado;

  async function guardar() {
    const nuevo = limpiar(texto);
    if (guardando || nuevo === guardado) return;
    setGuardando(true);
    setError("");
    try {
      const r = await guardarComentario(documentoId, nuevo);
      setGuardado(nuevo);
      setHecho(true);
      onGuardado?.(r);
    } catch (e) {
      setError(e?.message || "No se pudo guardar el comentario.");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="comentario-documento" style={{ border: "1px solid var(--border)", borderRadius: 10, padding: "10px 12px", background: "#fff", display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
        <span style={{ ...etiqueta, marginBottom: 0, display: "inline-flex", alignItems: "center", gap: 5 }}>
          <MessageSquare size={12} /> Comentario interno de {nombreDocumento}
        </span>
        <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)" }}>{texto.length}/{COMENTARIO_DOCUMENTO_MAX}</span>
      </div>
      <textarea
        className="input"
        rows={2}
        value={texto}
        maxLength={COMENTARIO_DOCUMENTO_MAX}
        onChange={(e) => { setTexto(e.target.value); setHecho(false); }}
        onBlur={guardar}
        placeholder="Ej: el cliente retira el viernes, se despacha en dos partes… (opcional)"
        style={{ width: "100%", resize: "vertical", minHeight: 52, fontSize: 13, lineHeight: 1.4 }}
      />
      {error && <div style={{ fontSize: 12.5, color: "#b91c1c", overflowWrap: "anywhere" }}>{error}</div>}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 11.5, color: "var(--text-muted)", flex: "1 1 220px", minWidth: 0 }}>{AVISO_INTERNO}</span>
        {hecho && !pendiente && !guardando && (
          <span className="comentario-guardado" style={{ fontSize: 12, color: "#166534", display: "inline-flex", alignItems: "center", gap: 4 }}>
            <CheckCircle2 size={13} /> {guardado ? "Comentario guardado" : "Comentario borrado"}
          </span>
        )}
        <button type="button" className="btn btn-secondary btn-sm" onClick={guardar} disabled={guardando || !pendiente}>
          {guardando ? "Guardando…" : "Guardar comentario"}
        </button>
      </div>
    </div>
  );
}

/* Ícono para las tablas. `soloLectura`: se puede leer pero no editar (y si no
   hay comentario, el ícono ni aparece). */
export function BotonComentarioDocumento({ documentoId, comentario, comentarioAt, comentarioPor, nombreDocumento = "el documento", soloLectura = false, onGuardado, size = 13 }) {
  const [abierto, setAbierto] = useState(false);
  const tiene = !!String(comentario || "").trim();
  if (!documentoId || (soloLectura && !tiene)) return null;
  const pie = pieComentario(comentarioAt, comentarioPor);
  const Icono = tiene ? MessageSquareText : MessageSquare;
  return (
    <>
      <button
        type="button"
        className="boton-comentario-documento"
        onClick={() => setAbierto(true)}
        title={tiene ? `Comentario interno${pie ? ` (${pie})` : ""}: ${String(comentario).trim()}` : "Agregar un comentario interno (no se envía a Bsale)"}
        aria-label={tiene ? "Ver el comentario interno" : "Agregar un comentario interno"}
        style={{ background: "none", border: "none", cursor: "pointer", padding: 0, display: "inline-flex", flexShrink: 0, color: tiene ? "#b45309" : "var(--text-muted)" }}
      >
        <Icono size={size} fill={tiene ? "#fde68a" : "none"} />
      </button>
      {abierto && (
        <ModalComentarioDocumento
          documentoId={documentoId}
          comentario={comentario}
          pie={pie}
          nombreDocumento={nombreDocumento}
          soloLectura={soloLectura}
          onCerrar={() => setAbierto(false)}
          onGuardado={onGuardado}
        />
      )}
    </>
  );
}

/* ── Columna «Observación» de Trazabilidad (2026-11-26) ──────────────────────
   Las observaciones internas de los documentos de UNA cotización (orden de
   compra, guías y facturas/boletas), una debajo de otra, cada una con el
   documento al que pertenece. Clic en una la abre para leerla entera o
   editarla (con `soloLectura`, solo leer). Sin observaciones, un guion. */
const ETIQUETA_TIPO_OBS = { orden_compra: "OC", guia_despacho: "Guía", factura: "Factura", factura_boleta: "Factura / Boleta" };
const NOMBRE_TIPO_OBS = { orden_compra: "la orden de compra", guia_despacho: "la guía", factura: "la factura", factura_boleta: "la factura o boleta" };
const ORDEN_TIPO_OBS = ["orden_compra", "guia_despacho", "factura", "factura_boleta"];

export function ObservacionesDocumentos({ docs, soloLectura = false, onGuardado, max = 3 }) {
  const [abierto, setAbierto] = useState(null); // documento cuya observación se está viendo
  const [todas, setTodas] = useState(false);
  const conTexto = (docs || [])
    .filter((d) => d && ETIQUETA_TIPO_OBS[d.tipo] && String(d.comentario || "").trim())
    .sort((a, b) => ORDEN_TIPO_OBS.indexOf(a.tipo) - ORDEN_TIPO_OBS.indexOf(b.tipo) || Number(a.id) - Number(b.id));
  if (!conTexto.length) return <span className="sin-observaciones" style={{ color: "#cbd5e1" }}>—</span>;
  const visibles = todas ? conTexto : conTexto.slice(0, max);
  return (
    <div className="observaciones-documentos" style={{ display: "flex", flexDirection: "column", gap: 5, minWidth: 0 }}>
      {visibles.map((d) => (
        <button
          key={d.id}
          type="button"
          className="observacion-documento"
          onClick={() => setAbierto(d)}
          title={`${ETIQUETA_TIPO_OBS[d.tipo]}${d.numero ? ` N° ${d.numero}` : ""}${pieComentario(d.comentario_at, d.comentario_por) ? ` (${pieComentario(d.comentario_at, d.comentario_por)})` : ""}: ${String(d.comentario).trim()}`}
          style={{ background: "none", border: "none", padding: 0, margin: 0, textAlign: "left", cursor: "pointer", fontFamily: "inherit", minWidth: 0, width: "100%" }}
        >
          <span style={{ display: "block", fontSize: 10.5, fontWeight: 700, color: "#b45309", textTransform: "uppercase", letterSpacing: ".3px", overflowWrap: "anywhere" }}>
            {ETIQUETA_TIPO_OBS[d.tipo]}{d.numero ? ` ${d.numero}` : ""}
          </span>
          <span style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", fontSize: 12, lineHeight: 1.3, color: "#1f2937", overflowWrap: "anywhere", whiteSpace: "pre-line" }}>
            {String(d.comentario).trim()}
          </span>
        </button>
      ))}
      {conTexto.length > max && (
        <button type="button" onClick={() => setTodas((v) => !v)} className="table-link" style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontFamily: "inherit", fontSize: 11.5, fontWeight: 600, textAlign: "left" }}>
          {todas ? "Ver menos" : `+${conTexto.length - max} más`}
        </button>
      )}
      {abierto && (
        <ModalComentarioDocumento
          documentoId={abierto.id}
          comentario={abierto.comentario}
          pie={pieComentario(abierto.comentario_at, abierto.comentario_por)}
          nombreDocumento={`${NOMBRE_TIPO_OBS[abierto.tipo]}${abierto.numero ? ` N° ${abierto.numero}` : ""}`}
          soloLectura={soloLectura}
          onCerrar={() => setAbierto(null)}
          onGuardado={onGuardado}
        />
      )}
    </div>
  );
}

function ModalComentarioDocumento({ documentoId, comentario, pie, nombreDocumento, soloLectura, onCerrar, onGuardado }) {
  const [texto, setTexto] = useState(comentario || "");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const tenia = !!String(comentario || "").trim();
  const cambio = limpiar(texto) !== limpiar(comentario);

  useEffect(() => {
    const alTeclear = (e) => { if (e.key === "Escape" && !guardando) onCerrar?.(); };
    window.addEventListener("keydown", alTeclear);
    return () => window.removeEventListener("keydown", alTeclear);
  }, [guardando, onCerrar]);

  async function guardar(valor) {
    if (guardando) return;
    setGuardando(true);
    setError("");
    try {
      const r = await guardarComentario(documentoId, valor);
      onGuardado?.(r);
      onCerrar?.();
    } catch (e) {
      setError(e?.message || "No se pudo guardar el comentario.");
      setGuardando(false);
    }
  }

  return createPortal(
    <div
      onMouseDown={(e) => { if (e.target === e.currentTarget && !guardando) onCerrar?.(); }}
      style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.55)", zIndex: 12000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
    >
      <div className="modal-comentario-documento" style={{ width: 480, maxWidth: "100%", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-lg)", textAlign: "left", whiteSpace: "normal" }}>
        <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
          <div style={{ minWidth: 0 }}>
            <strong style={{ fontSize: 15, display: "inline-flex", alignItems: "center", gap: 7 }}>
              <MessageSquare size={16} style={{ color: "var(--primary)", flexShrink: 0 }} /> Comentario interno
            </strong>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2, overflowWrap: "anywhere" }}>
              De {nombreDocumento}. {AVISO_INTERNO}
            </div>
          </div>
          <button type="button" onClick={onCerrar} className="btn btn-ghost" style={{ padding: 6, flexShrink: 0 }} title="Cerrar" disabled={guardando}><X size={16} /></button>
        </div>
        <div style={{ padding: "14px 18px", display: "flex", flexDirection: "column", gap: 6 }}>
          {soloLectura ? (
            <div style={{ fontSize: 13.5, lineHeight: 1.45, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{String(comentario || "").trim()}</div>
          ) : (
            <>
              <textarea
                className="input"
                autoFocus
                rows={4}
                value={texto}
                maxLength={COMENTARIO_DOCUMENTO_MAX}
                onChange={(e) => setTexto(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && cambio) { e.preventDefault(); guardar(texto); } }}
                disabled={guardando}
                placeholder="Escribe el comentario…"
                style={{ width: "100%", resize: "vertical", minHeight: 96, fontSize: 13.5, lineHeight: 1.45 }}
              />
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", fontSize: 11.5, color: "var(--text-muted)" }}>
                <span>{tenia && pie ? `Última edición: ${pie}` : ""}</span>
                <span style={{ fontWeight: 600 }}>{texto.length}/{COMENTARIO_DOCUMENTO_MAX}</span>
              </div>
            </>
          )}
          {soloLectura && pie && <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>{pie}</div>}
          {error && <div style={{ fontSize: 12.5, color: "#b91c1c", overflowWrap: "anywhere" }}>{error}</div>}
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, flexWrap: "wrap", padding: "12px 18px", borderTop: "1px solid var(--border)", background: "var(--bg)", borderRadius: "0 0 var(--radius-lg) var(--radius-lg)" }}>
          {!soloLectura && tenia && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => guardar("")} disabled={guardando} style={{ marginRight: "auto", color: "#b91c1c" }}>
              Borrar comentario
            </button>
          )}
          <button type="button" className="btn btn-secondary btn-sm" onClick={onCerrar} disabled={guardando}>{soloLectura ? "Cerrar" : "Cancelar"}</button>
          {!soloLectura && (
            <button type="button" className="btn btn-primary btn-sm" onClick={() => guardar(texto)} disabled={guardando || !cambio}>
              {guardando ? "Guardando…" : "Guardar"}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
