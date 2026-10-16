import { FilterX } from "lucide-react";

/* ── Limpiar todos los filtros (2026-09-24) ────────────────────────────────
   Las secciones acumulan cinco o seis filtros (texto, estado, fechas, tipo…)
   y para volver a ver todo había que ir borrando uno por uno, o recargar la
   página. Peor aún donde los filtros son persistentes: sobreviven a navegar
   al detalle y volver, así que una búsqueda vieja seguía escondiendo filas
   sin que se notara por qué.

   Sin filtros aplicados se ve atenuado (no hay nada que limpiar), pero sigue
   siendo un botón con la manito: el 2026-10-16 Ariel reportó que "no tiene la
   manito cliqueable" — desactivado mostraba la flecha y parecía roto.

   Uso:
     <BotonLimpiarFiltros hay={Boolean(fTexto || fEstado)} onLimpiar={limpiarFiltros} />
*/
export default function BotonLimpiarFiltros({
  hay,
  onLimpiar,
  // "chip" (por omisión) sigue la altura de los controles de una barra de
  // filtros; "texto" es un enlace discreto para barras muy apretadas.
  variante = "chip",
  titulo = "Quitar todos los filtros aplicados",
}) {
  const activo = Boolean(hay);

  if (variante === "texto") {
    return (
      <button
        type="button"
        onClick={() => onLimpiar?.()}
        title={activo ? titulo : "No hay filtros aplicados"}
        style={{
          background: "none",
          border: "none",
          padding: 0,
          cursor: "pointer",
          color: activo ? "var(--primary)" : "var(--text-muted)",
          fontSize: 12,
          fontFamily: "inherit",
          textDecoration: activo ? "underline" : "none",
          opacity: activo ? 1 : 0.55,
          whiteSpace: "nowrap",
        }}
      >
        Limpiar filtros
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onLimpiar?.()}
      title={activo ? titulo : "No hay filtros aplicados"}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        height: 36,
        padding: "0 12px",
        borderRadius: 8,
        border: "1px solid var(--border, #e2e8f0)",
        background: activo ? "var(--surface, #fff)" : "transparent",
        color: activo ? "var(--text)" : "var(--text-muted)",
        fontSize: 13,
        fontFamily: "inherit",
        cursor: "pointer",
        opacity: activo ? 1 : 0.55,
        whiteSpace: "nowrap",
        flexShrink: 0,
      }}
    >
      <FilterX size={14} />
      Limpiar filtros
    </button>
  );
}
