import { etiquetaEstadoBsale } from "../lib/estadosBsale";

/* ── Estado en Bsale de facturas, boletas y guías (2026-10-07) ──────────────
   Pedido de Ariel: "traerme el estado de las facturas, boletas, guías desde
   Bsale". El servidor cruza cada documento del sistema con Bsale (vigente /
   anulado y lo que respondió el SII) y lo deja en caché 10 minutos. La primera
   consulta tarda (~20 s: lee todos los documentos de Bsale), así que se pide
   en segundo plano y las etiquetas aparecen cuando llega. Solo se muestra lo
   que pide atención: un documento vigente y aceptado por el SII no lleva nada. */

const ESTILO = {
  rojo: { color: "#b91c1c", background: "#fee2e2", border: "1px solid #fecaca" },
  ambar: { color: "#92400e", background: "#fef3c7", border: "1px solid #fde68a" },
  gris: { color: "#475569", background: "#f1f5f9", border: "1px solid #e2e8f0" },
};

export default function EstadoBsaleBadge({ estado, style }) {
  const et = etiquetaEstadoBsale(estado);
  if (!et) return null;
  return (
    <span
      className="estado-bsale"
      title={et.detalle}
      style={{ display: "inline-block", fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 999, whiteSpace: "nowrap", lineHeight: 1.5, ...ESTILO[et.tono], ...style }}
    >
      {et.texto}
    </span>
  );
}
