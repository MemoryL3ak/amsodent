/* ── Decoración de Fiestas Patrias (2026-09-14) ─────────────────────────
   Compartida por el sidebar y el login. Se enciende sola cada año entre el
   5 y el 25 de septiembre y después desaparece sin tocar nada. */

export const ES_FIESTAS_PATRIAS = (() => {
  const hoy = new Date();
  return hoy.getMonth() === 8 && hoy.getDate() >= 5 && hoy.getDate() <= 25;
})();

// Retrato de dominio público (Wikimedia Commons).
export const FOTO_ALLENDE =
  "https://commons.wikimedia.org/wiki/Special:FilePath/Salvador%20Allende%202.jpg?width=120";

// Banderines chilenos colgando de un cordel (azul con estrella / blanco / rojo).
export function GuirnaldaBanderines({ height = 22, cordel = "#94a3b8" }) {
  const colores = ["#0039a6", "#ffffff", "#d52b1e"];
  const banderines = Array.from({ length: 8 }, (_, i) => {
    const x = 8 + i * 27;
    const color = colores[i % 3];
    return { x, color, esAzul: color === "#0039a6" };
  });
  return (
    <svg viewBox="0 0 232 26" style={{ width: "100%", height, display: "block" }} aria-hidden="true">
      <path d="M0 4 Q 116 12 232 4" fill="none" stroke={cordel} strokeWidth="1.2" />
      {banderines.map((b, i) => (
        <g key={i}>
          <polygon
            points={`${b.x},5 ${b.x + 20},5 ${b.x + 10},21`}
            fill={b.color}
            stroke={b.color === "#ffffff" ? "#cbd5e1" : "none"}
            strokeWidth="0.8"
          />
          {b.esAzul && (
            <text x={b.x + 10} y={12.5} textAnchor="middle" fontSize="7" fill="#fff">★</text>
          )}
        </g>
      ))}
    </svg>
  );
}

// Cinta tricolor fija en el borde superior de la pantalla.
export function CintaTricolor() {
  return (
    <div
      aria-hidden="true"
      style={{
        position: "fixed", top: 0, left: 0, right: 0, height: 4, zIndex: 80,
        background: "linear-gradient(90deg, #0039a6 0 33.3%, #ffffff 33.3% 66.6%, #d52b1e 66.6%)",
        boxShadow: "0 1px 3px rgba(15,23,42,.15)",
      }}
    />
  );
}
