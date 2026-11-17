/* Comunidad Amsodent: categorías y fuentes (2026-11-17).
   Las categorías están espejadas en backend/src/comunidad/comunidad-categorias.ts
   (y en el CHECK de la migración 20261117): al cambiar una, cambiar las tres. */

export const CATEGORIAS_COMUNIDAD = [
  { value: "estudiante", label: "Estudiante", color: "#0284c7", bg: "#e0f2fe" },
  { value: "clinica", label: "Clínica", color: "#0f766e", bg: "#ccfbf1" },
  { value: "doctor_particular", label: "Doctor Particular", color: "#15803d", bg: "#dcfce7" },
  { value: "doctor_docente", label: "Doctor Docente", color: "#7c3aed", bg: "#ede9fe" },
  { value: "doctor_docente_privado", label: "Doctor Docente y Profesional Privado", color: "#a21caf", bg: "#fae8ff" },
  { value: "doctor_docente_publico", label: "Doctor Docente y Profesional Público", color: "#b45309", bg: "#fef3c7" },
  { value: "cliente_rastreado", label: "Cliente Rastreado", color: "#475569", bg: "#f1f5f9" },
];

export const categoriaDe = (clave) => CATEGORIAS_COMUNIDAD.find((c) => c.value === clave) || null;
export const nombreCategoria = (clave) => categoriaDe(clave)?.label || "Sin categoría";

export const FUENTES_COMUNIDAD = [
  { value: "comunidad", label: "Formulario del QR" },
  { value: "sorteo", label: "Sorteos" },
  { value: "evento", label: "Eventos" },
  { value: "rastreo", label: "Google Maps (rastreo)" },
];

/** Nombre para mostrar de una fila (persona o clínica). */
export const nombreFila = (r) => [r?.nombre, r?.apellido].filter(Boolean).join(" ").trim() || r?.correo || "Sin nombre";

/** +56912345678 → «+56 9 1234 5678»; lo demás queda igual. */
export function telefonoLegible(v) {
  const m = String(v || "").match(/^\+56(\d)(\d{4})(\d{4})$/);
  return m ? `+56 ${m[1]} ${m[2]} ${m[3]}` : String(v || "");
}

/** Enlace para abrir el chat de WhatsApp de un número. */
export const enlaceWhatsapp = (v) => {
  const d = String(v || "").replace(/\D/g, "");
  return d.length >= 10 ? `https://wa.me/${d}` : "";
};
