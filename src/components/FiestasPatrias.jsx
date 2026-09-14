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

// Banderita chilena en SVG: el emoji 🇨🇱 se ve como "CL" en Windows.
export function BanderaChile({ size = 13 }) {
  return (
    <svg
      viewBox="0 0 30 20"
      width={size * 1.5}
      height={size}
      style={{ display: "inline-block", verticalAlign: "-1.5px", borderRadius: 2, boxShadow: "0 0 0 1px rgba(15,23,42,.15)" }}
      aria-label="Bandera de Chile"
    >
      <rect width="30" height="10" fill="#ffffff" />
      <rect y="10" width="30" height="10" fill="#d52b1e" />
      <rect width="10" height="10" fill="#0039a6" />
      <text x="5" y="7.8" textAnchor="middle" fontSize="8" fill="#fff">★</text>
    </svg>
  );
}

// Copihue (flor nacional) estilizado: campana roja colgante con tallo.
// Un toque elegante y sobrio, menos literal que más banderas.
export function Copihue({ size = 22, espejo = false, style }) {
  return (
    <svg
      viewBox="0 0 40 64"
      width={size}
      height={size * 1.6}
      style={{ transform: espejo ? "scaleX(-1)" : undefined, ...style }}
      aria-hidden="true"
    >
      {/* tallo y hojita */}
      <path d="M6 0 C14 6 20 10 20 18" fill="none" stroke="#2e7d32" strokeWidth="2" strokeLinecap="round" />
      <path d="M6 0 C10 8 8 12 4 16" fill="none" stroke="#2e7d32" strokeWidth="1.6" strokeLinecap="round" />
      {/* pétalos exteriores */}
      <path d="M20 16 C8 26 8 44 16 56 C19 48 19 28 20 16" fill="#c8102e" />
      <path d="M20 16 C32 26 32 44 24 56 C21 48 21 28 20 16" fill="#d52b1e" />
      {/* pétalo central */}
      <path d="M20 16 C15 30 15 46 20 60 C25 46 25 30 20 16" fill="#e63946" />
      {/* brillo */}
      <path d="M18 24 C16.5 32 16.5 42 18.5 50" fill="none" stroke="rgba(255,255,255,.45)" strokeWidth="1.4" strokeLinecap="round" />
      {/* estambres */}
      <circle cx="18" cy="58" r="1.3" fill="#f8e16c" />
      <circle cx="22" cy="59.5" r="1.3" fill="#f8e16c" />
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
