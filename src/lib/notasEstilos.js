/* (2026-11-27) Notas adhesivas: catálogo de estilos y utilidades puras.
   Espejo de backend/src/notas/notas.reglas.ts (el servidor valida contra su
   propia lista). El aspecto de cada opción está en components/notas/notas.css,
   por atributo: data-color, data-papel, data-letra, data-sujecion. */

export const COLORES_NOTA = [
  { id: "amarillo", nombre: "Amarillo", muestra: "#ffe76a" },
  { id: "rosa",     nombre: "Rosa",     muestra: "#ffb0cc" },
  { id: "menta",    nombre: "Menta",    muestra: "#a3ecbf" },
  { id: "celeste",  nombre: "Celeste",  muestra: "#a5d8fc" },
  { id: "lila",     nombre: "Lila",     muestra: "#cbb6ff" },
  { id: "naranja",  nombre: "Naranja",  muestra: "#ffc285" },
  { id: "turquesa", nombre: "Turquesa", muestra: "#7fdcde" },
  { id: "blanco",   nombre: "Blanco",   muestra: "#ffffff" },
  { id: "grafito",  nombre: "Grafito",  muestra: "#2f343d" },
];

export const PAPELES_NOTA = [
  { id: "liso",    nombre: "Liso" },
  { id: "lineas",  nombre: "Líneas" },
  { id: "cuadros", nombre: "Cuadros" },
  { id: "puntos",  nombre: "Puntos" },
];

export const LETRAS_NOTA = [
  { id: "normal",     nombre: "Normal" },
  { id: "manuscrita", nombre: "Manuscrita" },
  { id: "marcador",   nombre: "Marcador" },
  { id: "maquina",    nombre: "Máquina" },
];

export const SUJECIONES_NOTA = [
  { id: "cinta",   nombre: "Cinta" },
  { id: "chinche", nombre: "Chinche" },
  { id: "clip",    nombre: "Clip" },
  { id: "ninguna", nombre: "Nada" },
];

export const FONDOS_TABLERO = [
  { id: "corcho",  nombre: "Corcho" },
  { id: "pizarra", nombre: "Pizarra" },
  { id: "papel",   nombre: "Cuadriculado" },
  { id: "claro",   nombre: "Claro" },
];

export const MAX_CONTENIDO_NOTA = 2000;

/* Inclinación fija de cada nota (grados, entre −2,4 y 2,4): sale de su id,
   así la misma nota queda siempre igual de chueca. */
export function giroDeNota(id) {
  const n = Math.abs(Math.sin((Number(id) || 1) * 12.9898) * 43758.5453);
  const g = (n - Math.floor(n)) * 4.8 - 2.4;
  return Math.round(g * 10) / 10;
}

/* ── Casillas ────────────────────────────────────────────────────────────
   Una línea que parte con «[ ] » o «[x] » es una tarea que se marca con un
   clic, sin entrar a editar la nota. */
const RE_CASILLA = /^\[( |x|X)\] ?/;

export function lineasDeNota(contenido) {
  return String(contenido || "").split("\n").map((texto, indice) => {
    const m = texto.match(RE_CASILLA);
    if (!m) return { indice, casilla: false, hecha: false, texto };
    return { indice, casilla: true, hecha: m[1] !== " ", texto: texto.slice(m[0].length) };
  });
}

export function alternarCasilla(contenido, indice) {
  const lineas = String(contenido || "").split("\n");
  const m = (lineas[indice] || "").match(RE_CASILLA);
  if (!m) return String(contenido || "");
  lineas[indice] = (m[1] === " " ? "[x] " : "[ ] ") + lineas[indice].slice(m[0].length);
  return lineas.join("\n");
}

/* Pone o quita la casilla en la línea donde está el cursor. Devuelve el texto
   nuevo y dónde dejar el cursor. */
export function casillaEnLinea(contenido, cursor) {
  const texto = String(contenido || "");
  const pos = Math.max(0, Math.min(Number(cursor) || 0, texto.length));
  const inicio = texto.lastIndexOf("\n", pos - 1) + 1;
  const finBusqueda = texto.indexOf("\n", pos);
  const fin = finBusqueda === -1 ? texto.length : finBusqueda;
  const linea = texto.slice(inicio, fin);
  const m = linea.match(RE_CASILLA);
  const nueva = m ? linea.slice(m[0].length) : `[ ] ${linea}`;
  const delta = nueva.length - linea.length;
  return {
    contenido: (texto.slice(0, inicio) + nueva + texto.slice(fin)).slice(0, MAX_CONTENIDO_NOTA),
    cursor: Math.max(inicio, pos + delta),
  };
}

/* Al dar Enter en una línea con casilla, la siguiente parte con casilla; si la
   línea estaba vacía («[ ] » sola), la casilla se quita (como las listas de
   cualquier editor). Devuelve null si no hay nada especial que hacer. */
export function enterEnCasilla(contenido, cursor) {
  const texto = String(contenido || "");
  const pos = Math.max(0, Math.min(Number(cursor) || 0, texto.length));
  const inicio = texto.lastIndexOf("\n", pos - 1) + 1;
  const finBusqueda = texto.indexOf("\n", pos);
  const fin = finBusqueda === -1 ? texto.length : finBusqueda;
  const linea = texto.slice(inicio, fin);
  const m = linea.match(RE_CASILLA);
  if (!m) return null;
  if (linea.slice(m[0].length).trim() === "") {
    return { contenido: texto.slice(0, inicio) + texto.slice(fin), cursor: inicio };
  }
  const nuevo = texto.slice(0, pos) + "\n[ ] " + texto.slice(pos);
  if (nuevo.length > MAX_CONTENIDO_NOTA) return null;
  return { contenido: nuevo, cursor: pos + 5 };
}

export function resumenCasillas(contenido) {
  const casillas = lineasDeNota(contenido).filter((l) => l.casilla);
  return { total: casillas.length, hechas: casillas.filter((l) => l.hecha).length };
}

/* Orden del tablero: las destacadas primero y después por posición. */
export function ordenarNotas(notas) {
  return [...(notas || [])].sort(
    (a, b) => Number(Boolean(b.destacada)) - Number(Boolean(a.destacada)) || Number(a.orden) - Number(b.orden) || Number(b.id) - Number(a.id),
  );
}

/* Nombre de la pantalla de una ruta, según los ítems del menú: gana el ítem
   con la ruta más larga que coincide («/productos/actualizacion-precios» antes
   que «/productos»). */
export function tituloDeRuta(pathname, pantallas) {
  const p = String(pathname || "/");
  let mejor = null;
  for (const it of pantallas || []) {
    if (!it?.to) continue;
    if (p === it.to || p.startsWith(`${it.to}/`)) {
      if (!mejor || it.to.length > mejor.to.length) mejor = it;
    }
  }
  if (mejor) return mejor.label;
  const trozo = p.split("/").filter(Boolean)[0] || "Inicio";
  return trozo.charAt(0).toUpperCase() + trozo.slice(1).replace(/-/g, " ");
}

export function mismaPantalla(rutaNota, pathname) {
  if (!rutaNota) return false;
  return String(rutaNota).split("?")[0] === String(pathname || "");
}

export function fechaCortaNota(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const hoy = new Date();
  const mismoDia = d.toDateString() === hoy.toDateString();
  if (mismoDia) return d.toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit" });
  const opciones = d.getFullYear() === hoy.getFullYear() ? { day: "numeric", month: "short" } : { day: "numeric", month: "short", year: "2-digit" };
  return d.toLocaleDateString("es-CL", opciones);
}
