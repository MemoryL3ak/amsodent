import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FileArchive, FolderPlus, Loader2, X } from "lucide-react";
import { descargarFichasZip } from "../utils/fichasZip";
import { listarDocumentosRepositorio, pesoLegible } from "../lib/repositorio";

/* ── Descargar varias fichas técnicas en un ZIP (2026-10-07) ─────────────────
   En la cotización baja las fichas de todos sus productos (los que están en el
   catálogo); en Productos, las de los productos filtrados que tienen la ficha
   completa. Con muchas fichas pide confirmar (cada una es un PDF que se arma
   en el navegador: ~1 s por ficha) y deja cancelar a medio camino.

   (2026-11-05) Pedido de Ariel: "cuando se pinche la opción de descargar todas
   las fichas, consulte por un popup si quiere agregar otro documento para
   descargar (alguno de los documentos que están en el repositorio)". Al
   pinchar se abre una ventana con los documentos del Repositorio (patente,
   estatutos, cartas de garantía…): se marcan los que se quieran y van dentro
   del mismo ZIP, en la carpeta «Documentos». Si el repositorio está vacío (o
   no está disponible) y las fichas son pocas, baja directo como antes. */

const VIGENCIA = {
  vigente: { texto: "Vigente", color: "#15803d", bg: "#dcfce7" },
  por_vencer: { texto: "Por vencer", color: "#b45309", bg: "#fef3c7" },
  vencido: { texto: "Vencido", color: "#b91c1c", bg: "#fee2e2" },
  sin_vencimiento: { texto: "No vence", color: "#475569", bg: "#f1f5f9" },
};

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
  const [preparando, setPreparando] = useState(false);
  const [ventana, setVentana] = useState(null); // { documentos } | null
  const [elegidos, setElegidos] = useState(() => new Set());
  const cancelar = useRef(false);
  const lista = (productos || []).filter((p) => p?.id);
  const n = lista.length;

  async function abrir() {
    if (preparando) return;
    setPreparando(true);
    const documentos = (await listarDocumentosRepositorio()).filter((d) => d?.file_name);
    setPreparando(false);
    // Sin documentos que ofrecer y con pocas fichas: baja directo.
    if (!documentos.length && n < confirmarDesde) { descargar([]); return; }
    setElegidos(new Set());
    setVentana({ documentos });
  }

  async function descargar(extras) {
    setVentana(null);
    cancelar.current = false;
    setProgreso({ hechos: 0, total: n });
    try {
      const r = await descargarFichasZip(lista, {
        nombreZip,
        extras,
        onProgreso: (p) => setProgreso({ hechos: p.hechos, total: p.total }),
        debeCancelar: () => cancelar.current,
      });
      // (2026-11-04) Lo que no salió bien se dice con nombre: fichas que no se
      // generaron (y por qué) y fichas que salieron sin la foto.
      const lista6 = (l) => `${l.slice(0, 6).join(", ")}${l.length > 6 ? ` y ${l.length - 6} más` : ""}`;
      const sinFoto = r.sinFoto?.length ? ` ${r.sinFoto.length} salió${r.sinFoto.length === 1 ? "" : "eron"} sin foto (no se pudo cargar la imagen): ${lista6(r.sinFoto)}.` : "";
      const docs = r.extras ? ` Incluye ${r.extras} documento${r.extras === 1 ? "" : "s"} del repositorio.` : "";
      const docsFallidos = r.extrasFallidos?.length ? ` No se pudo agregar del repositorio: ${lista6(r.extrasFallidos)}.` : "";
      if (r.cancelado) onAviso?.("info", `Descarga cancelada (${r.generadas} de ${n} fichas listas, no se descargó nada).`);
      else if (r.fallidas.length) onAviso?.("warning", `ZIP con ${r.generadas} de ${n} fichas. No se generaron ${r.fallidas.length}: ${lista6(r.fallidas)}. Vuelve a descargar para completarlas.${sinFoto}${docs}${docsFallidos}`);
      else if (sinFoto || docsFallidos) onAviso?.("warning", `ZIP descargado con ${r.generadas} fichas.${sinFoto}${docs}${docsFallidos}${sinFoto ? " Vuelve a descargar para completarlas." : ""}`);
      else onAviso?.("success", `ZIP descargado con ${r.generadas} ficha${r.generadas === 1 ? "" : "s"} técnica${r.generadas === 1 ? "" : "s"}.${docs}`);
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

  const documentos = ventana?.documentos || [];
  const alternar = (id) => setElegidos((prev) => {
    const s = new Set(prev);
    if (s.has(id)) s.delete(id); else s.add(id);
    return s;
  });
  const todos = documentos.length > 0 && elegidos.size === documentos.length;
  const minutos = Math.max(1, Math.round(n / 60));

  return (
    <>
      <button
        type="button"
        className={className}
        style={{ gap: 6, ...style }}
        disabled={!n || preparando}
        onClick={abrir}
        title={titulo || (n ? `Descargar en un ZIP las fichas técnicas de ${n} producto${n === 1 ? "" : "s"}` : "No hay productos del catálogo para descargar fichas")}
      >
        {preparando ? <Loader2 size={14} className="spin" /> : <FileArchive size={14} />} {etiqueta}{n ? ` (${n})` : ""}
      </button>
      {ventana && createPortal(
        <div onMouseDown={(e) => { if (e.target === e.currentTarget) setVentana(null); }} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.45)", zIndex: 11000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div className="ventana-descarga-fichas" role="dialog" aria-modal="true" aria-label="Descargar fichas técnicas" style={{ width: 520, maxWidth: "100%", maxHeight: "88vh", background: "var(--surface)", borderRadius: "var(--radius-lg)", border: "1px solid var(--border)", boxShadow: "var(--shadow-lg)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <div style={{ padding: "14px 18px 10px", display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
              <div>
                <strong style={{ fontSize: 15 }}>Descargar {n} ficha{n === 1 ? "" : "s"} técnica{n === 1 ? "" : "s"}</strong>
                <div style={{ fontSize: 12.5, color: "var(--text-soft)", lineHeight: 1.5, marginTop: 2 }}>
                  {n >= confirmarDesde
                    ? `Cada ficha se arma en este navegador: tomará alrededor de ${minutos} minuto${minutos > 1 ? "s" : ""}. Puedes seguir en otra pestaña y cancelar cuando quieras.`
                    : "Se descarga un solo ZIP con todas las fichas."}
                </div>
              </div>
              <button type="button" className="btn btn-ghost" onClick={() => setVentana(null)} style={{ padding: 6 }} aria-label="Cerrar"><X size={18} /></button>
            </div>

            <div style={{ padding: "0 18px 12px", overflowY: "auto" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap", margin: "6px 0 8px" }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 700 }}>
                  <FolderPlus size={15} style={{ color: "var(--primary)" }} /> ¿Agregar documentos del repositorio?
                </span>
                {documentos.length > 1 && (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setElegidos(todos ? new Set() : new Set(documentos.map((d) => d.id)))} style={{ fontSize: 12 }}>
                    {todos ? "Quitar todos" : "Marcar todos"}
                  </button>
                )}
              </div>
              {documentos.length === 0 ? (
                <div style={{ fontSize: 12.5, color: "var(--text-muted)", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 8, padding: "10px 12px" }}>
                  El Repositorio de documentos está vacío: se descargan solo las fichas.
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {documentos.map((d) => {
                    const v = VIGENCIA[d.vigencia] || VIGENCIA.sin_vencimiento;
                    const marcado = elegidos.has(d.id);
                    return (
                      <label key={d.id} className="doc-repositorio" style={{ display: "flex", gap: 10, alignItems: "flex-start", border: `1px solid ${marcado ? "var(--primary)" : "var(--border)"}`, background: marcado ? "var(--primary-light, #e8f7f7)" : "var(--surface)", borderRadius: 8, padding: "8px 10px", cursor: "pointer" }}>
                        <input type="checkbox" checked={marcado} onChange={() => alternar(d.id)} style={{ marginTop: 3 }} />
                        <span style={{ flex: 1, minWidth: 0 }}>
                          <span style={{ display: "block", fontSize: 13, fontWeight: 600, overflowWrap: "anywhere" }}>{d.nombre}</span>
                          <span style={{ display: "block", fontSize: 11.5, color: "var(--text-muted)", overflowWrap: "anywhere" }}>
                            {[d.file_name, pesoLegible(d.size_bytes)].filter(Boolean).join(" · ")}
                          </span>
                        </span>
                        <span style={{ flexShrink: 0, fontSize: 10.5, fontWeight: 700, color: v.color, background: v.bg, borderRadius: 999, padding: "2px 8px", whiteSpace: "nowrap" }} title={d.vigencia === "vencido" ? "Este documento está vencido: revisa si conviene enviarlo" : undefined}>
                          {v.texto}
                        </span>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "11px 18px", borderTop: "1px solid var(--border)", background: "var(--bg)" }}>
              <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                {elegidos.size ? `${elegidos.size} documento${elegidos.size === 1 ? "" : "s"} irá${elegidos.size === 1 ? "" : "n"} en la carpeta «Documentos» del ZIP` : "Solo las fichas"}
              </span>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button type="button" className="btn btn-ghost" onClick={() => setVentana(null)}>Cancelar</button>
                <button type="button" className="btn btn-primary" onClick={() => descargar(documentos.filter((d) => elegidos.has(d.id)).map((d) => ({ id: d.id, nombre: d.nombre, archivo: d.file_name })))}>
                  Descargar ZIP
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
