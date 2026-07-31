// canales.js
// Canales de venta (perfiles de ejecutivo) compartidos entre Metas y
// Comisiones. Misma tabla de labels que usa el módulo de Metas — si se agrega
// un canal nuevo, agregarlo aquí para que aparezca en ambos módulos.

export const CANAL_LABELS = {
  vendedor_terreno: "Vendedor Terreno",
  vendedor_tienda_terreno: "Vendedor Tienda/Terreno",
  vendedor_terreno_mercado_publico: "Vendedor Terreno/Mercado Publico",
  vendedor_mercado_publico: "Vendedor Mercado Publico",
  pagina_web: "Pagina Web",
  vendedor_tienda: "Vendedor Tienda",
  vendedor_freelance: "Vendedor Freelance",
};

// Lista ordenada de canales (el orden define el orden de las pestañas/tablas).
export const CANALES = Object.keys(CANAL_LABELS);

export function normalizeCanal(value) {
  const v = (value || "").toString().trim();
  if (v === "vendedor_terreno_mercado") return "vendedor_terreno_mercado_publico";
  return v;
}

export function canalLabel(value) {
  return CANAL_LABELS[normalizeCanal(value)] || "";
}
