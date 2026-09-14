/* ── Decoración de Fiestas Patrias (2026-09-14) ─────────────────────────
   Compartida por el sidebar y el login. Se enciende sola cada año entre el
   5 y el 25 de septiembre y después desaparece sin tocar nada. */
import { useEffect, useState } from "react";

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
        // Cada banderín se mece con un desfase propio: la guirnalda ondea
        // como si corriera aire, en vez de moverse en bloque.
        <g key={i} className="fp-banderin" style={{ animationDelay: `${(i % 4) * 0.32}s` }}>
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

// Copihue (flor nacional) dibujado según la flor real: campana tubular
// colgante cuyos tépalos se ABREN en la punta, en rojo carmesí con brillo,
// colgando de un pedúnculo verde con su hoja. La silueta es un solo trazo
// con tres puntas y dos valles — a 12–14 px (el tamaño en que se usa junto
// al texto) se sigue leyendo como flor.
let copihueSeq = 0;
export function Copihue({ size = 22, espejo = false, style }) {
  // Id único por instancia: dos gradientes con el mismo id se pisan.
  const gid = `cop${(copihueSeq += 1)}`;
  return (
    <svg
      viewBox="0 0 44 64"
      width={size}
      height={size * 1.45}
      style={{ transform: espejo ? "scaleX(-1)" : undefined, ...style }}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="1" y2="0.2">
          <stop offset="0%" stopColor="#bf1733" />
          <stop offset="30%" stopColor="#e8354c" />
          <stop offset="55%" stopColor="#f8697c" />
          <stop offset="78%" stopColor="#ee3a51" />
          <stop offset="100%" stopColor="#c31c36" />
        </linearGradient>
      </defs>
      <g className="fp-copihue" style={{ animationDelay: espejo ? "1.4s" : "0s" }}>
        {/* pedúnculo del que cuelga la flor + hoja */}
        <path d="M4 4 C14 2 21 5 22 12" fill="none" stroke="#2f8f3e" strokeWidth="2.3" strokeLinecap="round" />
        <path d="M6 2 C14 0.5 18 4 16.5 8.5 C11 9.5 6.5 6.5 6 2 Z" fill="#3aa04a" />
        {/* corola: campana con tres puntas abiertas */}
        <path
          d="M22 11
             C14 21 10 35 9.5 48
             C9 54 7.5 59 10 60
             C13 57 15 52 16 46
             C16.5 52 17 57 19 61.5
             C20.5 63.2 23.5 63.2 25 61.5
             C27 57 27.5 52 28 46
             C29 52 31 57 34 60
             C36.5 59 35 54 34.5 48
             C34 35 30 21 22 11 Z"
          fill={`url(#${gid})`}
        />
        {/* nervaduras longitudinales */}
        <path d="M19 20 C16 32 15.5 45 16.5 52" fill="none" stroke="rgba(255,255,255,.34)" strokeWidth="1.1" strokeLinecap="round" />
        <path d="M25 20 C28 32 28.5 45 27.5 52" fill="none" stroke="rgba(0,0,0,.12)" strokeWidth="1.1" strokeLinecap="round" />
        <path d="M22 16 C21 32 21 48 22 60" fill="none" stroke="rgba(255,255,255,.22)" strokeWidth="1" strokeLinecap="round" />
        {/* estambres asomando bajo la corola */}
        <path d="M21 60 L20 64" stroke="#f4d35e" strokeWidth="1.2" strokeLinecap="round" />
        <path d="M23.5 60.5 L24.5 64" stroke="#f4d35e" strokeWidth="1.2" strokeLinecap="round" />
      </g>
    </svg>
  );
}

/* Saludo de bienvenida — aparece UNA VEZ AL DÍA por persona, se va solo a
   los 7 segundos (o al hacer clic). Tarjeta discreta abajo a la izquierda,
   con el nombre de quien entra y un dato distinto cada día. */
const FRASES_FP = [
  "Que sea una gran semana para el equipo.",
  "A celebrar Chile… y a seguir cotizando con la misma garra.",
  "Buenas ventas y mejores asados. 🇨🇱",
  "Orgullo de trabajar con este equipo.",
  "Que la cueca y las metas salgan igual de bien.",
];

export function SaludoFiestasPatrias({ nombre }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!ES_FIESTAS_PATRIAS) return;
    const hoy = new Date().toISOString().slice(0, 10);
    try {
      if (localStorage.getItem("fp_saludo_visto") === hoy) return;
      localStorage.setItem("fp_saludo_visto", hoy);
    } catch {
      /* sin localStorage: se muestra igual, no es crítico */
    }
    // Pequeño retardo: deja que la pantalla termine de montar.
    const t0 = setTimeout(() => setVisible(true), 700);
    const t1 = setTimeout(() => setVisible(false), 7700);
    return () => { clearTimeout(t0); clearTimeout(t1); };
  }, []);

  if (!ES_FIESTAS_PATRIAS) return null;

  const primerNombre = String(nombre || "").trim().split(/\s+/)[0] || "";
  const frase = FRASES_FP[new Date().getDate() % FRASES_FP.length];
  const dias = 18 - new Date().getDate();
  const cuenta =
    dias > 1 ? `Faltan ${dias} días para el 18` :
    dias === 1 ? "¡Mañana es 18!" :
    dias === 0 ? "¡Hoy es 18 de septiembre!" : null;

  return (
    <div
      onClick={() => setVisible(false)}
      style={{
        position: "fixed", left: 20, bottom: 20, zIndex: 90,
        width: 300, cursor: "pointer",
        background: "var(--surface, #fff)",
        borderRadius: 14,
        border: "1px solid var(--border, #e2e8f0)",
        boxShadow: "0 14px 40px rgba(15,23,42,.18)",
        overflow: "hidden",
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0)" : "translateY(14px)",
        transition: "opacity .45s ease, transform .45s ease",
        pointerEvents: visible ? "auto" : "none",
      }}
    >
      <div style={{ height: 4, background: "linear-gradient(90deg, #0039a6 0 33.3%, #ffffff 33.3% 66.6%, #d52b1e 66.6%)" }} />
      <div style={{ display: "flex", gap: 12, padding: "14px 16px 15px", alignItems: "flex-start" }}>
        <Copihue size={22} style={{ flexShrink: 0, marginTop: -2 }} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: 800, color: "var(--text, #0f172a)", lineHeight: 1.3 }}>
            {primerNombre ? `¡Felices Fiestas Patrias, ${primerNombre}!` : "¡Felices Fiestas Patrias!"}
          </div>
          <div style={{ fontSize: 12, color: "var(--text-muted, #64748b)", marginTop: 3, lineHeight: 1.45 }}>
            {frase}
          </div>
          {cuenta && (
            <div style={{ fontSize: 10.5, fontWeight: 800, color: "#d52b1e", marginTop: 7, letterSpacing: ".03em", textTransform: "uppercase" }}>
              {cuenta}
            </div>
          )}
        </div>
      </div>
    </div>
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
