import { Mail } from "lucide-react";

/* Guía, factura y boleta se envían al cliente desde la ventana de correo, nunca
   solas (2026-10-08). Antes de emitir (simulación) dice a quién irá; después,
   que al cerrar se abre esa ventana con todo prellenado para revisar y enviar. */
export default function AvisoCorreoDocumento({ correo, emitido = false }) {
  if (!correo) return null;
  const estilo = { display: "flex", gap: 6, alignItems: "flex-start", fontSize: 12.5, lineHeight: 1.45 };
  if (emitido) {
    if (!correo.ventana) return null;
    return (
      <div className="aviso-correo-documento" style={{ ...estilo, color: "#166534" }}>
        <Mail size={14} style={{ flexShrink: 0, marginTop: 2 }} />
        <span>
          Al cerrar esta ventana se abre el correo para enviárselo al cliente{correo.para ? <> (<b>{correo.para}</b>)</> : ""}, con el PDF adjunto: ahí puedes cambiar destinatarios, texto y adjuntos antes de enviar.
          {!correo.para ? " La cotización no tiene correo del cliente: escríbelo ahí." : ""}
        </span>
      </div>
    );
  }
  const texto = correo.activo === false
    ? correo.motivo || "Este documento no se envía por correo."
    : correo.para
      ? <>Al emitir se abrirá la ventana para enviarlo por correo a <b>{correo.para}</b>: ahí puedes cambiar destinatarios, texto y adjuntos antes de enviar.</>
      : "Al emitir se abrirá la ventana de correo; la cotización no tiene correo del cliente, así que tendrás que escribirlo ahí.";
  return (
    <div className="aviso-correo-documento" style={{ ...estilo, color: correo.para && correo.activo !== false ? "var(--text-muted)" : "#92400e" }}>
      <Mail size={14} style={{ flexShrink: 0, marginTop: 2 }} />
      <span>{texto}</span>
    </div>
  );
}
