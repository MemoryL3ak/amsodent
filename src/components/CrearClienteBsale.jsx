import { useState } from "react";
import { createPortal } from "react-dom";
import { CheckCircle2, Loader2, UserPlus, X } from "lucide-react";
import { api } from "../lib/api";

/* ── Crear el cliente en Bsale (2026-10-07) ─────────────────────────────────
   Pedido de Ariel: en la venta directa, si al buscar el cliente no está en
   Bsale, una ventana con todos los campos que Bsale pide para crearlo. Se
   abre con lo que el sistema ya sabe del cliente. Como toda acción en Bsale
   tiene «Simular» (muestra lo que se enviará) junto a «Crear en Bsale». */

const etiqueta = { fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".4px", color: "var(--text-muted)", display: "block", marginBottom: 4 };

export default function CrearClienteBsale({ inicial, onCreado, onCerrar }) {
  const [tipo, setTipo] = useState("empresa");
  const [d, setD] = useState({
    rut: inicial?.rut || "",
    razon_social: inicial?.razon_social || "",
    nombres: "",
    apellidos: "",
    giro: inicial?.giro || "",
    direccion: inicial?.direccion || "",
    comuna: inicial?.comuna || "",
    ciudad: inicial?.ciudad || inicial?.comuna || "",
    email: inicial?.email || "",
    telefono: "",
  });
  const [enviando, setEnviando] = useState("");
  const [error, setError] = useState("");
  const [simulado, setSimulado] = useState(null);

  const persona = tipo === "persona";
  const faltan = [
    !d.rut.trim() && "RUT",
    !persona && !d.razon_social.trim() && "razón social",
    !persona && !d.giro.trim() && "giro",
    persona && !d.nombres.trim() && "nombres",
    persona && !d.apellidos.trim() && "apellidos",
    !d.direccion.trim() && "dirección",
    !d.comuna.trim() && "comuna",
    !d.ciudad.trim() && "ciudad",
  ].filter(Boolean);

  const cambiar = (k) => (e) => { setD((x) => ({ ...x, [k]: e.target.value })); setSimulado(null); };
  const campo = (k, label, props = {}) => (
    <label style={{ flex: "1 1 200px", minWidth: 0, ...(props.full ? { flexBasis: "100%" } : {}) }}>
      <span style={etiqueta}>{label}</span>
      <input className="input" value={d[k]} onChange={cambiar(k)} disabled={!!enviando || props.readOnly} readOnly={props.readOnly} placeholder={props.placeholder} style={{ width: "100%" }} />
    </label>
  );

  async function enviar(simular) {
    setEnviando(simular ? "simular" : "crear");
    setError("");
    try {
      const r = await api.post("/bsale/libre/clientes", { ...d, tipo, ...(simular ? { simular: true } : {}) });
      if (r?.cliente) { onCreado?.(r.cliente, !!r.ya_existia); return; }
      setSimulado(r);
    } catch (e) {
      setError(e?.message || "No se pudo crear el cliente en Bsale.");
    } finally {
      setEnviando("");
    }
  }

  return createPortal(
    <div onClick={onCerrar} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.5)", zIndex: 11050, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div className="modal-crear-cliente-bsale" onClick={(e) => e.stopPropagation()} style={{ width: 620, maxWidth: "100%", maxHeight: "92vh", overflow: "auto", background: "var(--surface)", borderRadius: "var(--radius-lg)", border: "1px solid var(--border)", boxShadow: "var(--shadow-lg)" }}>
        <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
          <div>
            <strong style={{ fontSize: 15, display: "inline-flex", alignItems: "center", gap: 6 }}><UserPlus size={16} /> Crear cliente en Bsale</strong>
            <div style={{ fontSize: 12.5, color: "var(--text-muted)" }}>El RUT {d.rut} no está en Bsale. Completa los datos que Bsale exige para crearlo.</div>
          </div>
          <button type="button" className="btn btn-ghost" onClick={onCerrar} style={{ padding: 6, flexShrink: 0 }} title="Cerrar"><X size={16} /></button>
        </div>
        <div style={{ padding: "14px 18px", display: "flex", flexDirection: "column", gap: 12 }}>
          <div className="segmentado" style={{ display: "inline-flex", gap: 6, flexWrap: "wrap" }}>
            {[["empresa", "Empresa"], ["persona", "Persona natural"]].map(([v, t]) => (
              <button key={v} type="button" className={`btn btn-sm ${tipo === v ? "btn-primary" : "btn-secondary"}`} onClick={() => { setTipo(v); setSimulado(null); }} disabled={!!enviando}>{t}</button>
            ))}
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {campo("rut", "RUT", { readOnly: true })}
            {persona ? (
              <>
                {campo("nombres", "Nombres *")}
                {campo("apellidos", "Apellidos *")}
                {campo("giro", "Giro (opcional)")}
              </>
            ) : (
              <>
                {campo("razon_social", "Razón social *", { full: true })}
                {campo("giro", "Giro *", { placeholder: "Ej: Clínica dental" })}
              </>
            )}
            {campo("direccion", "Dirección *", { full: true })}
            {campo("comuna", "Comuna *")}
            {campo("ciudad", "Ciudad *")}
            {campo("email", "Correo (para enviarle sus documentos)")}
            {campo("telefono", "Teléfono")}
          </div>
          {faltan.length > 0 && <div style={{ fontSize: 12.5, color: "#92400e" }}>Falta: {faltan.join(", ")}.</div>}
          {error && <div style={{ border: "1px solid #fecaca", background: "#fef2f2", color: "#b91c1c", borderRadius: 10, padding: "8px 12px", fontSize: 13 }}>{error}</div>}
          {simulado && (
            <div style={{ border: "1px solid #bbf7d0", background: "#f0fdf4", borderRadius: 10, padding: "8px 12px", fontSize: 12.5, color: "#166534" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 700 }}><CheckCircle2 size={14} /> Simulación: los datos están completos. No se creó nada{simulado.emision_apagada ? " (la emisión real está apagada en el servidor)" : ""}.</div>
              <div style={{ marginTop: 4, color: "var(--text-soft)" }}>
                {simulado.solicitud?.company || `${simulado.solicitud?.firstName || ""} ${simulado.solicitud?.lastName || ""}`.trim()} · {simulado.solicitud?.code}
                {simulado.solicitud?.activity ? ` · ${simulado.solicitud.activity}` : ""} · {[simulado.solicitud?.address, simulado.solicitud?.municipality, simulado.solicitud?.city].filter(Boolean).join(", ")}
              </div>
            </div>
          )}
        </div>
        <div style={{ padding: "12px 18px", borderTop: "1px solid var(--border)", display: "flex", justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}>
          <button type="button" className="btn btn-ghost" onClick={onCerrar} disabled={!!enviando}>Cancelar</button>
          <button type="button" className="btn btn-secondary" onClick={() => enviar(true)} disabled={!!enviando || faltan.length > 0} title="Revisa los datos sin crear nada en Bsale">
            {enviando === "simular" ? <Loader2 size={14} className="spin" /> : null} Simular
          </button>
          <button type="button" className="btn btn-primary" onClick={() => enviar(false)} disabled={!!enviando || faltan.length > 0}>
            {enviando === "crear" ? <Loader2 size={14} className="spin" /> : <UserPlus size={14} />} Crear en Bsale
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
