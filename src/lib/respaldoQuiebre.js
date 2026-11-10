import { api } from "./api";

/* (2026-11-09) Respaldo de un quiebre de stock desde el aviso (campana y
   ventana flotante). Lo puede bajar el vendedor avisado aunque no tenga el
   módulo Gestión de compras: GET /quiebres-stock/:id/respaldo.

   La URL firmada viene con «download» (Content-Disposition: attachment), así
   que basta navegar un enlace: el navegador lo descarga sin abrir pestaña y
   sin que lo frene el bloqueador de ventanas (un window.open después de un
   await sí lo frena). */

// Avisos nuevos traen `tiene_respaldo`; los anteriores al 2026-11-09 no lo
// traen y se ofrece igual (si no hay documento, el servidor lo dice).
export const avisoConRespaldo = (n) =>
  n?.tipo === "quiebre_stock" && Number(n?.metadata?.quiebre_id) > 0 && n.metadata.tiene_respaldo !== false;

export async function descargarRespaldoQuiebre(quiebreId) {
  const r = await api.get(`/quiebres-stock/${quiebreId}/respaldo`);
  if (!r?.url) throw new Error("No se pudo generar el enlace del respaldo.");
  const a = document.createElement("a");
  a.href = r.url;
  a.rel = "noopener";
  if (r.file_name) a.download = r.file_name;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
}
