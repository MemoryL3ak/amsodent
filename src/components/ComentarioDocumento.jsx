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

export default function ComentarioDocumento({ documentoId, nombreDocumento = "el documento", inicial = "", onGuardado }) {
  const [texto, setTexto] = useState(inicial || "");
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
