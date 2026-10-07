import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FileArchive, Loader2, X } from "lucide-react";
import { descargarFichasZip } from "../utils/fichasZip";

/* ── Descargar varias fichas técnicas en un ZIP (2026-10-07) ─────────────────
   En la cotización baja las fichas de todos sus productos (los que están en el
   catálogo); en Productos, las de los productos filtrados que tienen la ficha
   completa. Con muchas fichas pide confirmar (cada una es un PDF que se arma
   en el navegador: ~1 s por ficha) y deja cancelar a medio camino. */

export default function BotonDescargarFichas({
  productos,
  nombreZip,
  etiqueta = "Fichas técnicas",
  titulo,
  confirmarDesde = 40,
  onAviso,
  className = "btn btn-secondary btn-sm",
  style,
}) {
  const [progreso, setProgreso] = useState(null); // { hechos, total } | null
  const [confirmando, setConfirmando] = useState(false);
  const cancelar = useRef(false);
  const lista = (productos || []).filter((p) => p?.id);
  const n = lista.length;

  async function descargar() {
    setConfirmando(false);
    cancelar.current = false;
    setProgreso({ hechos: 0, total: n });
    try {
      const r = await descargarFichasZip(lista, {
        nombreZip,
        onProgreso: (p) => setProgreso({ hechos: p.hechos, total: p.total }),
        debeCancelar: () => cancelar.current,
      });
      if (r.cancelado) onAviso?.("info", `Descarga cancelada (${r.generadas} de ${n} fichas listas, no se descargó nada).`);
      else if (r.fallidas.length) onAviso?.("warning", `ZIP con ${r.generadas} fichas. No se pudieron generar: ${r.fallidas.slice(0, 6).join(", ")}${r.fallidas.length > 6 ? "…" : ""}.`);
      else onAviso?.("success", `ZIP descargado con ${r.generadas} ficha${r.generadas === 1 ? "" : "s"} técnica${r.generadas === 1 ? "" : "s"}.`);
    } catch (e) {
      onAviso?.("error", e?.message || "No se pudieron generar las fichas técnicas.");
    } finally {
      setProgreso(null);
    }
  }

  if (progreso) {
    return (
      <span className="descarga-fichas-progreso" style={{ display: "inline-flex", alignItems: "center", gap: 6, ...style }}>
        <span className={className} style={{ pointerEvents: "none", gap: 6 }} aria-live="polite">
          <Loader2 size={14} className="spin" />
          Fichas {Math.min(progreso.hechos + 1, progreso.total)}/{progreso.total}…
        </span>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => { cancelar.current = true; }} title="Cancelar la descarga" style={{ padding: "0 8px" }}>
          <X size={14} />
        </button>
      </span>
    );
  }

  return (
    <>
      <button
        type="button"
        className={className}
        style={{ gap: 6, ...style }}
        disabled={!n}
        onClick={() => (n >= confirmarDesde ? setConfirmando(true) : descargar())}
        title={titulo || (n ? `Descargar en un ZIP las fichas técnicas de ${n} producto${n === 1 ? "" : "s"}` : "No hay productos del catálogo para descargar fichas")}
      >
        <FileArchive size={14} /> {etiqueta}{n ? ` (${n})` : ""}
      </button>
      {confirmando && createPortal(
        <div onClick={() => setConfirmando(false)} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.45)", zIndex: 11000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: 440, maxWidth: "100%", background: "var(--surface)", borderRadius: "var(--radius-lg)", border: "1px solid var(--border)", boxShadow: "var(--shadow-lg)", padding: 20, display: "flex", flexDirection: "column", gap: 12 }}>
            <strong style={{ fontSize: 15 }}>Descargar {n} fichas técnicas</strong>
            <div style={{ fontSize: 13, color: "var(--text-soft)", lineHeight: 1.5 }}>
              Cada ficha se arma en este navegador: tomará alrededor de {Math.max(1, Math.round(n / 60))} minuto{Math.round(n / 60) > 1 ? "s" : ""}.
              Puedes seguir en otra pestaña y cancelar cuando quieras. Al terminar se descarga un solo ZIP.
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}>
              <button type="button" className="btn btn-ghost" onClick={() => setConfirmando(false)}>Cancelar</button>
              <button type="button" className="btn btn-primary" onClick={descargar}>Descargar ZIP</button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
