import { Mail } from "lucide-react";

/* Guía, factura y boleta se envían solas al cliente con su PDF (2026-10-07).
   Antes de emitir (simulación) dice a quién irá; después, si se envió. */
export default function AvisoCorreoDocumento({ correo, emitido = false }) {
  if (!correo) return null;
  const estilo = { display: "flex", gap: 6, alignItems: "flex-start", fontSize: 12.5, lineHeight: 1.45 };
  if (emitido) {
    if (!correo.enviado) return null; // el motivo ya viene en los avisos
    return (
      <div className="aviso-correo-documento" style={{ ...estilo, color: "#166534" }}>
        <Mail size={14} style={{ flexShrink: 0, marginTop: 2 }} />
        <span>Enviado por correo a <b>{correo.para}</b> con el PDF{correo.modo === "gmail" ? " (desde la casilla del vendedor)" : ""}{correo.cc?.length ? `, con copia a ${correo.cc.join(", ")}` : ""}.</span>
      </div>
    );
  }
  const texto = correo.activo === false
    ? correo.motivo || "El envío automático por correo está apagado."
    : correo.para
      ? <>Al emitir se enviará por correo a <b>{correo.para}</b> con el PDF.</>
      : "La cotización no tiene correo del cliente: no se enviará solo (agrégalo en la cotización o envíalo a mano).";
  return (
    <div className="aviso-correo-documento" style={{ ...estilo, color: correo.para && correo.activo !== false ? "var(--text-muted)" : "#92400e" }}>
      <Mail size={14} style={{ flexShrink: 0, marginTop: 2 }} />
      <span>{texto}</span>
    </div>
  );
}
