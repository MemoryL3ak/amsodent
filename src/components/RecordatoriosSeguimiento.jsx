import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { Truck, X } from "lucide-react";
import { api } from "../lib/api";
import DropdownSelect from "./ui/DropdownSelect";

/* ── Guías sin N° de seguimiento (2026-10-07) ────────────────────────────────
   Pedido de Ariel: "cuando una guía de despacho se haya ingresado sin número
   de seguimiento, debemos persistir a través de un popup para que el usuario
   correspondiente edite la guía asociando el número de seguimiento".
   El backend dice cuáles son del usuario (vendedor de la cotización o quien la
   emitió en Bsale; últimos 60 días; nunca Despacho interno ni «Retirado en
   tienda»). Se descartan las anuladas en Bsale. El aviso vuelve cada 5
   minutos hasta completarlas; «Recordarme en 2 horas» lo pospone. Cada guía
   se completa ahí mismo (empresa + N°) o se marca «Lo retiró el cliente». */

const POLL_MS = 5 * 60 * 1000;
const POSPONER_MS = 2 * 60 * 60 * 1000;
const EMPRESAS = [
  { value: "Starken", label: "Starken" },
  { value: "Blue Express", label: "Blue Express" },
  { value: "Despacho interno", label: "Despacho interno", detalle: "Reparto propio: no lleva N° de courier" },
  { value: "Otro", label: "Otro transporte" },
];
const claveAplazo = "seguimiento.pospuesto_hasta";
const leerAplazo = () => { try { return Number(localStorage.getItem(claveAplazo) || 0); } catch { return 0; } };
const fechaCL = (d) => { const [y, m, dd] = String(d || "").slice(0, 10).split("-"); return y && m && dd ? `${dd}-${m}-${y}` : "—"; };

export default function RecordatoriosSeguimiento() {
  const [guias, setGuias] = useState([]);
  const [datos, setDatos] = useState({}); // id → { empresa, numero }
  const [guardando, setGuardando] = useState(null);
  const [error, setError] = useState("");
  const [oculto, setOculto] = useState(() => leerAplazo() > Date.now());

  const cargar = useCallback(async () => {
    if (leerAplazo() > Date.now()) return;
    try {
      const r = await api.get("/licitaciones/guias/sin-seguimiento");
      let lista = Array.isArray(r?.guias) ? r.guias : [];
      if (lista.length) {
        // Una guía anulada en Bsale no necesita seguimiento (se cruza por id o por N°: muchas no tienen bsale_id).
        const est = await api.get("/bsale/facturas/estados").catch(() => null);
        lista = lista.filter((g) => est?.estados?.[g.id]?.estado !== "anulado");
      }
      setGuias(lista);
      setOculto(false);
    } catch {
      // silencioso: es un aviso
    }
  }, []);

  useEffect(() => {
    // El primer aviso, unos segundos después de entrar (no compite con la carga de la página).
    const primero = setTimeout(cargar, 4000);
    const id = setInterval(cargar, POLL_MS);
    return () => { clearTimeout(primero); clearInterval(id); };
  }, [cargar]);

  if (oculto || !guias.length) return null;

  const valor = (g) => datos[g.id] || { empresa: g.empresa_despacho && g.empresa_despacho !== "Otro" ? g.empresa_despacho : g.empresa_despacho || "", numero: "" };
  const set = (g, k, v) => setDatos((d) => ({ ...d, [g.id]: { ...valor(g), [k]: v } }));
  const quitar = (id) => setGuias((l) => l.filter((x) => x.id !== id));

  async function guardar(g) {
    const v = valor(g);
    const interno = v.empresa === "Despacho interno";
    if (!v.empresa) { setError(`Elige la empresa de transporte de la guía ${g.numero || ""}.`); return; }
    if (!interno && !String(v.numero || "").trim()) { setError(`Escribe el N° de seguimiento de la guía ${g.numero || ""}.`); return; }
    setGuardando(g.id);
    setError("");
    try {
      await api.put(`/licitaciones/documentos/${g.id}`, { empresa_despacho: v.empresa, ...(interno ? {} : { n_seguimiento: String(v.numero).trim() }) });
      quitar(g.id);
    } catch (e) {
      setError(e?.message || "No se pudo guardar el seguimiento.");
    } finally {
      setGuardando(null);
    }
  }

  async function retirado(g) {
    setGuardando(g.id);
    setError("");
    try {
      await api.put(`/licitaciones/${g.licitacion_id}`, { estado_envio: "retirado", estado_envio_actualizado_at: new Date().toISOString() });
      setGuias((l) => l.filter((x) => x.licitacion_id !== g.licitacion_id));
    } catch (e) {
      setError(e?.message || "No se pudo marcar como retirado.");
    } finally {
      setGuardando(null);
    }
  }

  function posponer() {
    try { localStorage.setItem(claveAplazo, String(Date.now() + POSPONER_MS)); } catch { /* sin almacenamiento: solo se oculta ahora */ }
    setOculto(true);
  }

  return createPortal(
    <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.45)", zIndex: 10820, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div className="modal-seguimiento-guias" role="dialog" aria-label="Guías sin N° de seguimiento" style={{ width: 720, maxWidth: "100%", maxHeight: "90vh", overflow: "auto", background: "var(--surface)", borderRadius: "var(--radius-lg)", border: "1px solid var(--border)", boxShadow: "var(--shadow-lg)" }}>
        <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
          <div>
            <strong style={{ fontSize: 15, display: "inline-flex", alignItems: "center", gap: 6 }}><Truck size={16} /> {guias.length === 1 ? "Una guía sin N° de seguimiento" : `${guias.length} guías sin N° de seguimiento`}</strong>
            <div style={{ fontSize: 12.5, color: "var(--text-muted)" }}>Complétalas para que Trazabilidad y el cliente puedan seguir el despacho. Este aviso vuelve hasta que estén completas.</div>
          </div>
          <button type="button" className="btn btn-ghost" onClick={posponer} style={{ padding: 6, flexShrink: 0 }} title="Recordarme en 2 horas"><X size={16} /></button>
        </div>
        <div style={{ padding: "12px 18px", display: "flex", flexDirection: "column", gap: 10 }}>
          {guias.map((g) => {
            const v = valor(g);
            const interno = v.empresa === "Despacho interno";
            return (
              <div key={g.id} className="guia-sin-seguimiento" style={{ border: "1px solid var(--border)", borderRadius: 10, padding: "10px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", fontSize: 13 }}>
                  <span>
                    <b>Guía N° {g.numero || "S/N"}</b> · {fechaCL(g.fecha)} ·{" "}
                    <Link to={`/detalle/${g.licitacion_id}`} className="table-link" onClick={posponer}>#{g.licitacion_id}</Link>{" "}
                    <span style={{ color: "var(--text-muted)", overflowWrap: "anywhere" }}>{g.cliente}</span>
                  </span>
                  <span style={{ fontSize: 11.5, color: "var(--text-muted)" }}>{g.motivo === "emisor" ? "La emitiste tú" : "Es tu cotización"}</span>
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
                  <label style={{ display: "flex", flexDirection: "column", gap: 3, flex: "1 1 170px", minWidth: 0 }}>
                    <span className="field-label">Empresa</span>
                    <DropdownSelect value={v.empresa} onChange={(x) => set(g, "empresa", x)} minWidth={200} placeholder="Elige la empresa" options={EMPRESAS} disabled={guardando === g.id} />
                  </label>
                  <label style={{ display: "flex", flexDirection: "column", gap: 3, flex: "2 1 200px", minWidth: 0 }}>
                    <span className="field-label">N° de seguimiento</span>
                    <input className="input" value={interno ? "" : v.numero} onChange={(e) => set(g, "numero", e.target.value)} placeholder={interno ? "No aplica (reparto propio)" : "Ej: 998877665"} disabled={interno || guardando === g.id} onKeyDown={(e) => { if (e.key === "Enter") guardar(g); }} />
                  </label>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <button type="button" className="btn btn-primary btn-sm" onClick={() => guardar(g)} disabled={guardando === g.id}>Guardar</button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => retirado(g)} disabled={guardando === g.id} title="La cotización queda «Retirado en tienda»: no lleva seguimiento">Lo retiró el cliente</button>
                  </div>
                </div>
              </div>
            );
          })}
          {error && <div style={{ border: "1px solid #fecaca", background: "#fef2f2", color: "#b91c1c", borderRadius: 10, padding: "8px 12px", fontSize: 13 }}>{error}</div>}
        </div>
        <div style={{ padding: "10px 18px", borderTop: "1px solid var(--border)", display: "flex", justifyContent: "flex-end" }}>
          <button type="button" className="btn btn-secondary" onClick={posponer}>Recordarme en 2 horas</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
