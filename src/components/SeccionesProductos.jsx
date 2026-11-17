import { Package, Tags } from "lucide-react";
import { useUnsavedChanges } from "../context/UnsavedChangesContext";

/* ── Secciones de Productos (2026-11-17) ─────────────────────────────────────
   Pedido de Ariel: «Actualización de precios» pasa a ser una sección de
   Productos. En el listado de Productos van estas pestañas: «Catálogo» (el
   listado de siempre) y «Actualización de precios», que abre esa sección
   (/productos/actualizacion-precios). En el menú lateral cuelga de Productos.
   Solo se muestra a quien puede actualizar precios: sin ese permiso hay una
   sola sección y las pestañas no aportan nada. */
export default function SeccionesProductos({ activa = "catalogo", conPrecios = false }) {
  const { requestNavigation } = useUnsavedChanges();
  if (!conPrecios) return null;
  const secciones = [
    { value: "catalogo", to: "/productos", label: "Catálogo", Icono: Package, titulo: "El listado de productos: crear, editar la ficha, fichas técnicas y carga masiva" },
    { value: "precios", to: "/productos/actualizacion-precios", label: "Actualización de precios", Icono: Tags, titulo: "Cambiar el costo y los precios de los productos, uno a uno o en masa" },
  ];
  return (
    <div className="pagos-tabs secciones-productos" role="tablist" aria-label="Secciones de Productos">
      {secciones.map((s) => (
        <button
          key={s.value}
          type="button"
          role="tab"
          aria-selected={activa === s.value}
          className={activa === s.value ? "activo" : ""}
          title={s.titulo}
          onClick={() => { if (activa !== s.value) requestNavigation(s.to); }}
        >
          <s.Icono size={15} /> {s.label}
        </button>
      ))}
    </div>
  );
}
