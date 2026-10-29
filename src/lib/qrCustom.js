import QRCode from "qrcode";

/* QR custom de la plataforma (2026-10-29).
   Dibuja el QR como SVG propio a partir de la matriz de módulos de la
   librería `qrcode`: módulos "fluidos" (redondeados y unidos), ojos
   redondeados con el punto en color de acento, degradado de marca y el
   logo en el centro. Sin CDN ni dependencias nuevas; exporta a PNG y SVG.
   Nivel de corrección H (30 %): el logo y su margen tapan ~6 % de los
   módulos y el código sigue leyéndose sin problema. */

export const ESTILOS_QR = [
  { value: "fluido", label: "Fluido", detalle: "Módulos redondeados que se unen" },
  { value: "puntos", label: "Puntos", detalle: "Círculos separados" },
  { value: "clasico", label: "Clásico", detalle: "Cuadrados tradicionales" },
];

/* ── Colores ─────────────────────────────────────────────────────────── */

function hexARgb(hex) {
  const h = String(hex || "").replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(full, 16);
  if (!Number.isFinite(n) || full.length !== 6) return [40, 174, 177];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbAHex([r, g, b]) {
  return "#" + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("");
}

// mezclar("#28aeb1", "#000000", .3) → 30 % hacia el negro.
export function mezclar(hexA, hexB, t) {
  const a = hexARgb(hexA);
  const b = hexARgb(hexB);
  return rgbAHex(a.map((v, i) => v + (b[i] - v) * t));
}

export const oscurecer = (hex, f = 0.3) => mezclar(hex, "#000000", f);
export const aclarar = (hex, f = 0.3) => mezclar(hex, "#ffffff", f);

// Luminancia relativa (WCAG), 0 = negro, 1 = blanco.
export function luminancia(hex) {
  const lin = (v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const [r, g, b] = hexARgb(hex);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

// Oscurece el color hasta que contraste bien con el fondo blanco: un QR en
// teal o naranja puros se lee mal con poca luz. Conserva el tono.
export function asegurarOscuro(hex, maxLuminancia = 0.22) {
  let c = hex;
  for (let i = 0; i < 12 && luminancia(c) > maxLuminancia; i++) c = mezclar(c, "#000000", 0.08);
  return c;
}

/* ── Construcción del SVG ────────────────────────────────────────────── */

const f = (v) => Math.round(v * 1000) / 1000;

// Rectángulo redondeado como trazo de path (sentido horario).
function rr(x, y, w, h, r) {
  const k = Math.min(r, w / 2, h / 2);
  if (k <= 0) return `M${x} ${y}h${w}v${h}h${-w}z`;
  return (
    `M${x + k} ${y}h${w - 2 * k}a${k} ${k} 0 0 1 ${k} ${k}v${h - 2 * k}a${k} ${k} 0 0 1 ${-k} ${k}` +
    `h${-(w - 2 * k)}a${k} ${k} 0 0 1 ${-k} ${-k}v${-(h - 2 * k)}a${k} ${k} 0 0 1 ${k} ${-k}z`
  );
}

// Todos los subtrazos van en el MISMO sentido (horario, sweep-flag 1): con la
// regla nonzero, un círculo y un puente de sentidos opuestos se anulaban donde
// se superponían y el QR quedaba lleno de huecos.
function circulo(cx, cy, r) {
  return `M${f(cx - r)} ${cy}a${r} ${r} 0 1 1 ${2 * r} 0a${r} ${r} 0 1 1 ${-2 * r} 0z`;
}

/**
 * construirQR({ texto, estilo, color, acento, logo, tamano }) → string SVG.
 *  - texto: contenido (la URL del formulario).
 *  - estilo: "fluido" | "puntos" | "clasico".
 *  - color / colorOscuro: degradado de los módulos (colorOscuro se deriva si falta).
 *  - acento: punto central de los tres ojos.
 *  - logo: data URL (o null). Para exportar a PNG DEBE ser data URL: un SVG
 *    cargado como imagen no puede pedir recursos externos.
 *  - tamano: px del svg (width/height); el viewBox va en módulos.
 */
export function construirQR({
  texto,
  estilo = "fluido",
  color = "#28aeb1",
  colorOscuro,
  acento = "#f59e0b",
  logo = null,
  logoAncho = 0.3, // fracción del ancho del QR
  logoRelacion = 3, // ancho / alto del logo
  margen = 2, // zona silenciosa, en módulos
  tamano = 1000,
  fondo = "#ffffff",
  id,
  radioPunto = 0.42, // estilo "puntos": radio de cada módulo
  radiosOjo, // { ro, ri } para forzar el redondeo de los ojos (pruebas)
}) {
  const qr = QRCode.create(String(texto || " "), { errorCorrectionLevel: "H" });
  const n = qr.modules.size;
  const bits = qr.modules.data;
  // Los módulos van del color (asegurando contraste) a su versión oscura; el
  // punto de los ojos usa el acento, también con contraste garantizado.
  const colorClaro = asegurarOscuro(color, 0.22);
  const oscuroColor = colorOscuro || oscurecer(colorClaro, 0.3);
  const acentoOjo = asegurarOscuro(acento, 0.25);
  const uid = id || `qr${Math.random().toString(36).slice(2, 8)}`;

  const oscuro = (r, c) => r >= 0 && c >= 0 && r < n && c < n && bits[r * n + c] === 1;
  const enOjo = (r, c) => (r < 7 && c < 7) || (r < 7 && c >= n - 7) || (r >= n - 7 && c < 7);

  // Zona del logo: rectángulo centrado (el isologo de Amsodent es apaisado).
  let zona = null;
  if (logo) {
    const w = Math.max(5, Math.round(n * logoAncho));
    const h = Math.max(3, Math.round(w / logoRelacion));
    const c0 = Math.floor((n - w) / 2);
    const r0 = Math.floor((n - h) / 2);
    zona = { c0, r0, c1: c0 + w, r1: r0 + h, w, h };
  }
  const enLogo = (r, c) =>
    !!zona && r >= zona.r0 - 1 && r < zona.r1 + 1 && c >= zona.c0 - 1 && c < zona.c1 + 1;
  const esDato = (r, c) => oscuro(r, c) && !enOjo(r, c) && !enLogo(r, c);

  // Módulos de datos (incluye patrones de alineación y de tiempo).
  let datos = "";
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!esDato(r, c)) continue;
      const x = c + margen;
      const y = r + margen;
      if (estilo === "clasico") {
        datos += `M${x} ${y}h1v1h-1z`;
      } else if (estilo === "puntos") {
        datos += circulo(x + 0.5, y + 0.5, radioPunto);
      } else {
        // fluido: círculo completo + puentes hacia el vecino derecho y el de abajo.
        datos += circulo(x + 0.5, y + 0.5, 0.5);
        if (esDato(r, c + 1)) datos += `M${f(x + 0.5)} ${y}h1v1h-1z`;
        if (esDato(r + 1, c)) datos += `M${x} ${f(y + 0.5)}h1v1h-1z`;
      }
    }
  }

  // Los tres ojos: anillo (7×7 menos 5×5) y punto central (3×3).
  // Ojos redondeados pero con los lados rectos en su mayor parte: los lectores
  // buscan la proporción 1:1:3:1:1 fila por fila.
  const radios =
    radiosOjo || (estilo === "clasico" ? { ro: 0, ri: 0 } : estilo === "puntos" ? { ro: 2.6, ri: 1.6 } : { ro: 2, ri: 1 });
  let anillos = "";
  let puntos = "";
  for (const [r, c] of [[0, 0], [0, n - 7], [n - 7, 0]]) {
    const x = c + margen;
    const y = r + margen;
    anillos += rr(x, y, 7, 7, radios.ro) + rr(x + 1, y + 1, 5, 5, radios.ri);
    if (estilo === "clasico") puntos += `M${x + 2} ${y + 2}h3v3h-3z`;
    else if (estilo === "puntos") puntos += circulo(x + 3.5, y + 3.5, 1.5);
    else puntos += rr(x + 2, y + 2, 3, 3, 1.05);
  }

  const N = n + margen * 2;
  let logoSvg = "";
  if (zona) {
    const pad = 0.55;
    const x = zona.c0 + margen;
    const y = zona.r0 + margen;
    logoSvg =
      `<rect x="${f(x - pad)}" y="${f(y - pad)}" width="${f(zona.w + pad * 2)}" height="${f(zona.h + pad * 2)}" rx="${f(zona.h * 0.45)}" fill="${fondo}"/>` +
      `<image href="${logo}" xlink:href="${logo}" x="${f(x + 0.15)}" y="${f(y + 0.15)}" width="${f(zona.w - 0.3)}" height="${f(zona.h - 0.3)}" preserveAspectRatio="xMidYMid meet"/>`;
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${N} ${N}" width="${tamano}" height="${tamano}" shape-rendering="geometricPrecision">` +
    `<defs><linearGradient id="${uid}-g" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="${N}" y2="${N}">` +
    `<stop offset="0" stop-color="${colorClaro}"/><stop offset="1" stop-color="${oscuroColor}"/></linearGradient></defs>` +
    `<rect width="${N}" height="${N}" rx="${f(margen * 0.9)}" fill="${fondo}"/>` +
    `<path d="${datos}" fill="url(#${uid}-g)"/>` +
    `<path d="${anillos}" fill-rule="evenodd" fill="${oscuroColor}"/>` +
    `<path d="${puntos}" fill="${acentoOjo}"/>` +
    logoSvg +
    `</svg>`
  );
}

/* ── Exportación ─────────────────────────────────────────────────────── */

export function svgADataUrl(svg) {
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
}

// Rasteriza el SVG a PNG (data URL) de px × px.
export function svgAPng(svg, px = 1200) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = px;
        canvas.height = px;
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, px, px);
        ctx.drawImage(img, 0, 0, px, px);
        resolve(canvas.toDataURL("image/png"));
      } catch (e) {
        reject(e);
      }
    };
    img.onerror = () => reject(new Error("No se pudo rasterizar el QR."));
    img.src = svgADataUrl(svg);
  });
}

export function descargarArchivo(nombre, href) {
  const a = document.createElement("a");
  a.href = href;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

const cacheDataUrls = new Map();

// Carga una imagen del propio sitio como data URL (para incrustarla en el SVG).
export async function cargarDataUrl(url) {
  if (!url) return null;
  if (cacheDataUrls.has(url)) return cacheDataUrls.get(url);
  const promesa = fetch(url)
    .then((r) => {
      if (!r.ok) throw new Error(`No se pudo cargar ${url}`);
      return r.blob();
    })
    .then(
      (blob) =>
        new Promise((resolve, reject) => {
          const fr = new FileReader();
          fr.onload = () => resolve(String(fr.result));
          fr.onerror = () => reject(new Error("No se pudo leer la imagen."));
          fr.readAsDataURL(blob);
        })
    )
    .catch((e) => {
      cacheDataUrls.delete(url);
      throw e;
    });
  cacheDataUrls.set(url, promesa);
  return promesa;
}

// Nombre de archivo seguro: "QR Sorteo Día" → "qr-sorteo-dia".
export function nombreArchivo(texto, fallback = "qr") {
  const s = String(texto || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s || fallback;
}
