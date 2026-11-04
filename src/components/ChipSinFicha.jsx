import { FileWarning } from "lucide-react";
import { etiquetaProducto } from "../utils/fichaTecnicaCompleta";

/* ── Chip «N sin ficha técnica» arriba de los ítems de la cotización (2026-11-03)
   Pedido de Ariel: distinguir las fichas técnicas completas de las incompletas
   y no emitir el PDF de la cotización mientras falte alguna. El chip cuenta
   los productos del catálogo con la ficha incompleta y los lista al pasar el
   mouse; desaparece cuando todas están completas.
   (2026-11-04) `admin`: al administrador no se le retiene el PDF, así que el
   chip va en ámbar (aviso) en vez de rojo (bloqueo) y lo dice. */

export default function ChipSinFicha({ productos, admin = false, style }) {
  const lista = (productos || []).filter((p) => p?.id);
  if (!lista.length) return null;
  const n = lista.length;
  const detalle = lista.map((p) => `• ${etiquetaProducto(p)}`).join("\n");
  return (
    <span
      className="chip-sin-ficha"
      role="status"
      data-modo={admin ? "aviso" : "bloqueo"}
      title={
        admin
          ? `Sin ficha técnica completa (como administrador puedes generar el PDF igual; el resto del equipo no hasta completarlas en Productos → Editar):\n${detalle}`
          : `Sin ficha técnica completa (el PDF de la cotización no se genera hasta completarlas en Productos → Editar):\n${detalle}`
      }
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "0 10px",
        height: 26,
        borderRadius: 999,
        border: `1px solid ${admin ? "#fcd34d" : "#fca5a5"}`,
        background: admin ? "#fef3c7" : "#fee2e2",
        color: admin ? "#b45309" : "#b91c1c",
        fontSize: 12,
        fontWeight: 700,
        whiteSpace: "nowrap",
        ...style,
      }}
    >
      <FileWarning size={13} />
      {n} sin ficha técnica
    </span>
  );
}
