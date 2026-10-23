import { Pencil } from "lucide-react";

/* (2026-10-22) Pedido de Ariel: editar el producto de una línea sin salir de
   la cotización que se está creando. Abre Editar Producto en OTRA pestaña
   (?desde=cotizacion); al guardar, Editar Producto avisa por el
   BroadcastChannel (src/lib/productosCanal.js) y la cotización abierta
   actualiza el aviso y sus líneas al instante, sin cerrar ni crear otra
   cotización. Mismo alto que el botón «Ficha» que va al lado; en columnas
   angostas queda solo el lápiz (regla .bep-texto en styles.css). */
export default function BotonEditarProducto({ producto, titulo }) {
  if (!producto?.id) return null;
  const etiqueta = producto.sku || producto.nombre || "el producto";
  return (
    <a
      href={`/productos/editar/${producto.id}?desde=cotizacion`}
      target="_blank"
      rel="noopener noreferrer"
      className="boton-editar-producto"
      title={titulo || `Editar ${etiqueta} en otra pestaña · al guardar, esta cotización toma los cambios al instante`}
      aria-label={`Editar ${etiqueta}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "0 8px",
        height: 20,
        borderRadius: 999,
        border: "1px solid #fcd34d",
        background: "#fffbeb",
        color: "#b45309",
        fontSize: 11,
        fontWeight: 700,
        cursor: "pointer",
        whiteSpace: "nowrap",
        flexShrink: 0,
        textDecoration: "none",
      }}
    >
      <Pencil size={11} />
      <span className="bep-texto">Editar</span>
    </a>
  );
}
