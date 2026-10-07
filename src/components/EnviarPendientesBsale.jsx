import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { CheckCircle2, CloudUpload, Loader2, X } from "lucide-react";
import { api } from "../lib/api";

/* ── Productos → «Enviar pendientes a Bsale» (2026-10-07) ────────────────────
   Pedido de Ariel: "crear productos desde Amsodent a Bsale: si hay un
   transitorio sin SKU, se debe enviar a Bsale". Los nuevos ya se envían al
   crearlos; esto es para los que quedaron antes sin enviar (transitorios sin
   SKU y productos con SKU sin variante anotada). Simular cuenta cuántos son,
   sin tocar nada; «Enviar» los manda de a uno en segundo plano (los con SKU
   que ya están en Bsale solo se enlazan) y aquí se ve el avance. Solo admin. */

export default function EnviarPendientesBsale({ onCerrar }) {
  const [sim, setSim] = useState(null);
  const [estado, setEstado] = useState(null);
  const [cargando, setCargando] = useState("");
  const [error, setError] = useState("");
  const [soloSinSku, setSoloSinSku] = useState(true);

  const leerEstado = useCallback(async () => {
    try {
      const r = await api.get("/productos/bsale/pendientes/estado");
      setEstado(r?.estado || null);
      return r?.estado || null;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => { leerEstado(); }, [leerEstado]);
  useEffect(() => {
    if (!estado?.corriendo) return undefined;
    const t = setInterval(leerEstado, 3000);
    return () => clearInterval(t);
  }, [estado?.corriendo, leerEstado]);

  async function pedir(simular) {
    setCargando(simular ? "simular" : "enviar");
    setError("");
    try {
      const r = await api.post("/productos/bsale/pendientes", { simular, solo_sin_sku: soloSinSku });
      if (simular) setSim(r);
      if (r?.estado) setEstado(r.estado);
      if (r?.activa === false && !simular) setError(r.mensaje || "El envío de productos a Bsale está apagado en el servidor.");
    } catch (e) {
      setError(e?.message || "No se pudo consultar los pendientes.");
    } finally {
      setCargando("");
    }
  }

  const corriendo = !!estado?.corriendo;
  const pct = estado?.total ? Math.round((estado.hechos / estado.total) * 100) : 0;
  const res = estado?.resumen || {};

  return createPortal(
    <div onClick={onCerrar} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.5)", zIndex: 11050, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div className="modal-pendientes-bsale" onClick={(e) => e.stopPropagation()} style={{ width: 560, maxWidth: "100%", maxHeight: "92vh", overflow: "auto", background: "var(--surface)", borderRadius: "var(--radius-lg)", border: "1px solid var(--border)", boxShadow: "var(--shadow-lg)" }}>
        <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
          <div>
            <strong style={{ fontSize: 15, display: "inline-flex", alignItems: "center", gap: 6 }}><CloudUpload size={16} /> Enviar pendientes a Bsale</strong>
            <div style={{ fontSize: 12.5, color: "var(--text-muted)" }}>Productos que aún no están en Bsale. Los transitorios sin SKU se crean con su variante sin código (después, al ponerle SKU, se le asigna a esa misma variante); si ya hay uno con el mismo nombre, se enlaza.</div>
          </div>
          <button type="button" className="btn btn-ghost" onClick={onCerrar} style={{ padding: 6, flexShrink: 0 }} title="Cerrar"><X size={16} /></button>
        </div>
        <div style={{ padding: "14px 18px", display: "flex", flexDirection: "column", gap: 12, fontSize: 13 }}>
          <label style={{ display: "flex", gap: 8, alignItems: "flex-start", cursor: "pointer" }}>
            <input type="checkbox" checked={soloSinSku} onChange={(e) => { setSoloSinSku(e.target.checked); setSim(null); }} disabled={corriendo} style={{ marginTop: 3 }} />
            <span>Solo los transitorios sin SKU <span style={{ color: "var(--text-muted)" }}>(los que tienen SKU en general ya están en Bsale: incluirlos solo los enlaza, y son muchos)</span></span>
          </label>
          {sim && (
            <div className="simulacion-pendientes" style={{ border: "1px solid var(--border)", background: "var(--bg)", borderRadius: 10, padding: "10px 12px", lineHeight: 1.55 }}>
              {sim.total === 0
                ? "No hay productos pendientes: todos están en Bsale."
                : sim.solo_sin_sku
                  ? <>Se enviarían <b>{sim.total.toLocaleString("es-CL")} transitorios sin SKU</b> (se crean en Bsale, o se enlazan si ya hay uno con el mismo nombre). Quedan aparte {sim.con_sku.toLocaleString("es-CL")} con SKU sin enlazar.{sim.con_error_previo ? ` ${sim.con_error_previo} tuvieron un error antes.` : ""} No se envió nada.</>
                  : <>Hay <b>{sim.total.toLocaleString("es-CL")} productos pendientes</b>: {sim.sin_sku.toLocaleString("es-CL")} sin SKU (se crean en Bsale) y {sim.con_sku.toLocaleString("es-CL")} con SKU (si ya están en Bsale solo se enlazan).{sim.con_error_previo ? ` ${sim.con_error_previo} tuvieron un error antes.` : ""} No se envió nada.</>}
              {sim.muestra?.length > 0 && (
                <div style={{ marginTop: 6, fontSize: 12, color: "var(--text-muted)" }}>
                  Primeros: {sim.muestra.map((p) => `${p.sku || "sin SKU"} · ${p.nombre}`).join(" | ")}
                </div>
              )}
              {sim.activa === false && <div style={{ marginTop: 6, color: "#b45309" }}>El envío a Bsale está apagado en el servidor.</div>}
            </div>
          )}
          {estado && (
            <div className="avance-pendientes" style={{ border: "1px solid var(--border)", borderRadius: 10, padding: "10px 12px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                <b>{corriendo ? "Enviando…" : "Último envío"}</b>
                <span style={{ color: "var(--text-muted)" }}>{estado.hechos.toLocaleString("es-CL")} de {estado.total.toLocaleString("es-CL")}</span>
              </div>
              <div style={{ height: 8, background: "var(--bg)", borderRadius: 999, overflow: "hidden", margin: "8px 0" }}>
                <div style={{ width: `${pct}%`, height: "100%", background: "var(--primary)" }} />
              </div>
              <div style={{ fontSize: 12.5, color: "var(--text-muted)" }}>
                {res.creados || 0} creados · {res.enlazados || 0} enlazados por nombre · {res.ya_existian || 0} ya estaban · {res.sku_asignados || 0} con SKU asignado · {res.errores || 0} con error
              </div>
              {estado.ultimo_error && <div style={{ fontSize: 12, color: "#b91c1c", marginTop: 4, overflowWrap: "anywhere" }}>Último error: {estado.ultimo_error}</div>}
              {!corriendo && estado.fin && <div style={{ fontSize: 12, color: "#15803d", marginTop: 4 }}><CheckCircle2 size={12} style={{ verticalAlign: -2 }} /> Terminó. Los que fallaron se reintentan desde su ficha o con otro envío.</div>}
            </div>
          )}
          {error && <div style={{ border: "1px solid #fecaca", background: "#fef2f2", color: "#b91c1c", borderRadius: 10, padding: "8px 12px" }}>{error}</div>}
        </div>
        <div style={{ padding: "12px 18px", borderTop: "1px solid var(--border)", display: "flex", justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}>
          <button type="button" className="btn btn-ghost" onClick={onCerrar}>Cerrar</button>
          <button type="button" className="btn btn-secondary" onClick={() => pedir(true)} disabled={!!cargando || corriendo}>
            {cargando === "simular" ? <Loader2 size={14} className="spin" /> : null} Simular
          </button>
          <button type="button" className="btn btn-primary" onClick={() => pedir(false)} disabled={!!cargando || corriendo || !sim || sim.total === 0} title={!sim ? "Simula primero para ver cuántos son" : "Enviar todos los pendientes a Bsale, de a uno"}>
            {cargando === "enviar" || corriendo ? <Loader2 size={14} className="spin" /> : <CloudUpload size={14} />} Enviar a Bsale
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
