import { Link } from "react-router-dom";
import { mensajeBsale, tipoAvisoBsale } from "../lib/bsaleProducto";

/* ── Producto recién creado (2026-10-03) ─────────────────────────────────────
   Pedido de Ariel: "cuando se agregue un producto desde la sección de
   productos, que muestre una opción o botón para abrir la ficha técnica".
   Queda a la vista tras guardar, con la ficha (abrir o descargar), el enlace
   a la ficha del producto y lo que pasó al enviarlo a Bsale. */

export default function ProductoCreadoAviso({ creado, generando = "", onAbrir, onDescargar, onCerrar }) {
  if (!creado) return null;
  const aviso = creado.bsale ? mensajeBsale(creado.bsale) : "";
  const advertencia = creado.bsale && tipoAvisoBsale(creado.bsale) === "warning";
  return (
    <div className="producto-creado-aviso" style={{ border: "1px solid #bbf7d0", background: "#f0fdf4", borderRadius: 12, padding: "14px 16px", marginBottom: 20, display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: "#15803d" }}>Producto creado</div>
          <div style={{ fontSize: 13.5, overflowWrap: "anywhere" }}>
            <b>{creado.nombre}</b>
            {creado.sku ? ` · SKU ${creado.sku}` : " · sin SKU (transitorio)"}
            {creado.estado ? ` · ${creado.estado}` : ""}
          </div>
          {aviso && <div style={{ fontSize: 12.5, marginTop: 4, color: advertencia ? "#92400e" : "#166534", overflowWrap: "anywhere" }}>{aviso}</div>}
        </div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCerrar} title="Cerrar" style={{ flexShrink: 0 }}>✕</button>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button type="button" className="btn btn-primary" onClick={onAbrir} disabled={!!generando}>
          {generando === "abrir" ? "Generando…" : "Abrir ficha técnica"}
        </button>
        <button type="button" className="btn btn-secondary" onClick={onDescargar} disabled={!!generando}>
          {generando === "descargar" ? "Generando…" : "Descargar PDF"}
        </button>
        <Link to={`/productos/editar/${creado.id}`} className="btn btn-secondary" style={{ textDecoration: "none" }}>
          Ver / editar producto
        </Link>
      </div>
    </div>
  );
}
