/* ── Decoración de Fiestas Patrias (2026-09-14) ─────────────────────────
   Compartida por el sidebar y el login. Se enciende sola cada año entre el
   5 y el 25 de septiembre y después desaparece sin tocar nada. */
import { useEffect, useState } from "react";

export const ES_FIESTAS_PATRIAS = (() => {
  const hoy = new Date();
  return hoy.getMonth() === 8 && hoy.getDate() >= 5 && hoy.getDate() <= 25;
})();

/* Mascotas dieciocheras (2026-09-14): reemplazan al retrato que había antes
   en el rincón del sidebar. Son dibujos propios (nada de fotos externas) y
   ROTAN cada día, así el equipo se encuentra con una distinta: empanada con
   chupalla, quiltro con chupalla y volantín. Sin carga política, con humor. */
const MASCOTAS = [
  {
    id: "empanada",
    nombre: "Empanada de pino",
    frase: "¡Feliz 18, equipo!",
    dibujo: (
      <>
        <circle cx="20" cy="20" r="20" fill="#fff7ed" />
        <path d="M7 27 C7 17 13 12 20 12 C27 12 33 17 33 27 C33 31 27 34 20 34 C13 34 7 31 7 27 Z" fill="#e3a04a" />
        <path d="M7 27 C7 17 13 12 20 12 C27 12 33 17 33 27 C33 29 30 30 27 30 C27 22 24 17 20 17 C16 17 13 22 13 30 C10 30 7 29 7 27 Z" fill="#d08c36" />
        <path d="M8 28 q3 -3 5 0 q3 -3 5 0 q3 -3 5 0 q3 -3 5 0" fill="none" stroke="#b8762a" strokeWidth="1.6" strokeLinecap="round" />
        <ellipse cx="20" cy="12" rx="13" ry="3.4" fill="#e8cf9a" />
        <path d="M13 12 C13 6 15 4 20 4 C25 4 27 6 27 12 Z" fill="#d9bb78" />
        <path d="M13 10.6 C16 12 24 12 27 10.6" fill="none" stroke="#b8965a" strokeWidth="1.5" />
        <circle cx="16.5" cy="23" r="1.5" fill="#5b3a16" />
        <circle cx="23.5" cy="23" r="1.5" fill="#5b3a16" />
        <path d="M17 27.5 q3 2.5 6 0" fill="none" stroke="#5b3a16" strokeWidth="1.5" strokeLinecap="round" />
      </>
    ),
  },
  {
    id: "quiltro",
    nombre: "Quiltro dieciochero",
    frase: "¡Viva Chile!",
    dibujo: (
      <>
        <circle cx="20" cy="20" r="20" fill="#f5f0e6" />
        <path d="M9 17 C5 19 5 28 9 30 C11 27 11 20 9 17 Z" fill="#8a5a32" />
        <path d="M31 17 C35 19 35 28 31 30 C29 27 29 20 31 17 Z" fill="#8a5a32" />
        <path d="M20 12 C28 12 31 18 31 24 C31 31 26 35 20 35 C14 35 9 31 9 24 C9 18 12 12 20 12 Z" fill="#b07a45" />
        <path d="M12 17 C15 14 19 14 21 16 C18 19 14 20 12 17 Z" fill="#8a5a32" />
        <ellipse cx="20" cy="29" rx="7" ry="5" fill="#e8d3b6" />
        <ellipse cx="20" cy="26" rx="2.6" ry="2" fill="#3a2a1c" />
        <path d="M20 28 L20 30 M20 30 q-2.5 2 -4 0 M20 30 q2.5 2 4 0" fill="none" stroke="#3a2a1c" strokeWidth="1.2" strokeLinecap="round" />
        <path d="M18.5 32 q1.5 3 3 0 Z" fill="#e2727f" />
        <circle cx="15.5" cy="22" r="1.7" fill="#2b1d10" />
        <circle cx="24.5" cy="22" r="1.7" fill="#2b1d10" />
        <circle cx="16.1" cy="21.4" r=".55" fill="#fff" />
        <circle cx="25.1" cy="21.4" r=".55" fill="#fff" />
        <ellipse cx="20" cy="12" rx="14" ry="3.6" fill="#e8cf9a" />
        <path d="M13 12 C13 5.5 15 3.5 20 3.5 C25 3.5 27 5.5 27 12 Z" fill="#d9bb78" />
        <path d="M13 10.4 C16 11.8 24 11.8 27 10.4" fill="none" stroke="#b8965a" strokeWidth="1.5" />
      </>
    ),
  },
  {
    id: "volantin",
    // Sin nombre de personaje: el volantín es un objeto, no un "personaje"
    // como la empanada o el quiltro. Se muestra solo el mensaje.
    nombre: "",
    frase: "¡Se siente el 18!",
    dibujo: (
      <>
        <circle cx="20" cy="20" r="20" fill="#eaf6fb" />
        <ellipse cx="9" cy="9" rx="6" ry="3" fill="#fff" />
        <ellipse cx="31" cy="13" rx="5" ry="2.5" fill="#fff" />
        <g transform="rotate(-12 20 17)">
          <path d="M20 5 L29 17 L20 29 L11 17 Z" fill="#ffffff" stroke="#cbd5e1" strokeWidth=".7" />
          <path d="M20 5 L29 17 L20 17 Z" fill="#0039a6" />
          <path d="M20 17 L29 17 L20 29 Z" fill="#d52b1e" />
          <path d="M20 5 L20 29 M11 17 L29 17" stroke="#94a3b8" strokeWidth=".8" />
          <text x="24" y="13.5" fontSize="5" fill="#fff" textAnchor="middle">★</text>
        </g>
        <path d="M19 30 C15 33 22 34 18 37 C15 39 20 39.5 21 38" fill="none" stroke="#d52b1e" strokeWidth="1.6" strokeLinecap="round" />
        <path d="M12 20 C7 26 5 31 4 37" fill="none" stroke="#94a3b8" strokeWidth=".9" />
      </>
    ),
  },
];

// Mascota del día (rota con la fecha, igual para todo el equipo).
export function mascotaDelDia() {
  return MASCOTAS[new Date().getDate() % MASCOTAS.length];
}

export function MascotaDieciochera({ size = 34, style }) {
  const m = mascotaDelDia();
  return (
    <svg
      viewBox="0 0 40 40"
      width={size}
      height={size}
      role="img"
      aria-label={m.nombre}
      style={{
        borderRadius: "50%",
        border: "2px solid #d52b1e",
        boxShadow: "0 0 0 2px #0039a6",
        flexShrink: 0,
        ...style,
      }}
    >
      {m.dibujo}
    </svg>
  );
}

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
