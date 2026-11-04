import { Zip, ZipPassThrough } from "fflate";
import { api } from "../lib/api";
import { descargarFichaTecnica } from "./generarFichaTecnica";

/* ── Varias fichas técnicas en un ZIP (2026-10-07) ───────────────────────────
   Pedido de Ariel: "botón para descargar todas las fichas técnicas de los
   productos". Cada ficha es el mismo PDF del botón «Ficha» y se agrega al ZIP
   apenas se genera (fflate en modo streaming, sin comprimir: los PDF ya vienen
   comprimidos). Cada ~24 MB los trozos pasan a un Blob, así cientos de fichas
   no llenan la memoria de la pestaña. Los textos de la ficha no vienen en los
   listados livianos: se pide el producto completo antes de generar cada una.

   (2026-11-04) Si el producto completo no se puede pedir (la sesión quedó sin
   token un instante, el servidor no respondió…) ANTES se seguía con el registro
   liviano y la ficha salía sin foto ni textos, sin aviso. Ahora se reintenta
   tres veces y, si igual falla, esa ficha no se genera y se informa; lo mismo
   con la foto (se informa qué fichas salieron sin ella). */

const espera = (ms) => new Promise((r) => setTimeout(r, ms));

/* Producto completo con reintentos. Devuelve `{ producto }` o `{ error }`. */
async function pedirCompleto(p, intentos = 3) {
  if (!p?.id) return { producto: p };
  let ultimo = null;
  for (let i = 0; i < intentos; i++) {
    try {
      const c = await api.get(`/productos/${p.id}`);
      if (c && typeof c === "object") return { producto: { ...p, ...c } };
      ultimo = new Error("respuesta vacía");
    } catch (e) {
      ultimo = e;
    }
    if (i + 1 < intentos) await espera(700 * (i + 1));
  }
  const motivo = ultimo?.status === 401 ? "sesión sin token" : ultimo?.status ? `error ${ultimo.status}` : "sin respuesta del servidor";
  return { error: motivo };
}

const TROZO = 24 * 1024 * 1024;

const nombreArchivo = (p, i) =>
  String(`${p?.sku || "SIN-SKU"} - ${p?.nombre || `producto ${i + 1}`}`)
    .split("").filter((ch) => ch.charCodeAt(0) >= 32).join("")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 90);

/**
 * @param {object[]} productos  productos del catálogo (al menos `id`; el resto se pide)
 * @param {{ nombreZip?: string, onProgreso?: (p: {hechos:number,total:number,actual?:string}) => void, debeCancelar?: () => boolean }} [op]
 * @returns {Promise<{ generadas: number, fallidas: string[], sinFoto: string[], cancelado: boolean }>}
 */
export async function descargarFichasZip(productos, op = {}) {
  const lista = (productos || []).filter(Boolean);
  const total = lista.length;
  if (!total) throw new Error("No hay productos con ficha para descargar.");

  const blobs = [];
  let pendiente = [];
  let tamPendiente = 0;
  let falloZip = null;
  let listo;
  const terminado = new Promise((r) => { listo = r; });
  const zip = new Zip((err, chunk, final) => {
    if (err) { falloZip = err; listo(); return; }
    if (chunk?.length) { pendiente.push(chunk); tamPendiente += chunk.length; }
    if (tamPendiente >= TROZO || final) {
      if (pendiente.length) blobs.push(new Blob(pendiente));
      pendiente = [];
      tamPendiente = 0;
    }
    if (final) listo();
  });

  const usados = new Set();
  const fallidas = [];
  const sinFoto = [];
  let generadas = 0;
  const etiquetaDe = (p, i) => p?.sku || p?.nombre || `#${p?.id || i + 1}`;
  // El siguiente producto se pide mientras se arma el PDF del actual.
  let siguiente = pedirCompleto(lista[0]);

  for (let i = 0; i < total; i++) {
    if (op.debeCancelar?.()) {
      return { generadas, fallidas, sinFoto, cancelado: true };
    }
    const pedido = await siguiente;
    if (i + 1 < total) siguiente = pedirCompleto(lista[i + 1]);
    op.onProgreso?.({ hechos: i, total, actual: etiquetaDe(lista[i], i) });
    if (pedido.error) {
      // Sin el producto completo la ficha saldría vacía: mejor no generarla y decirlo.
      console.error("Ficha técnica", etiquetaDe(lista[i], i), "no se pudo cargar el producto:", pedido.error);
      fallidas.push(`${etiquetaDe(lista[i], i)} (${pedido.error})`);
      continue;
    }
    const completo = pedido.producto;
    try {
      const blob = await descargarFichaTecnica(completo, {
        soloBlob: true,
        onEstado: (e) => { if (e?.sinFoto) sinFoto.push(etiquetaDe(completo, i)); },
      });
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let nombre = nombreArchivo(completo, i);
      while (usados.has(nombre.toLowerCase())) nombre = `${nombre} (${i + 1})`;
      usados.add(nombre.toLowerCase());
      const archivo = new ZipPassThrough(`${nombre}.pdf`);
      zip.add(archivo);
      archivo.push(bytes, true);
      generadas++;
    } catch (e) {
      console.error("Ficha técnica", completo?.sku, e);
      fallidas.push(`${etiquetaDe(completo, i)} (no se pudo armar el PDF)`);
    }
  }
  op.onProgreso?.({ hechos: total, total });
  if (!generadas) {
    const todoCarga = fallidas.length > 0 && fallidas.every((f) => /sesión sin token|sin respuesta|error \d+/.test(f));
    throw new Error(todoCarga
      ? "No se pudo cargar ningún producto (la sesión o el servidor no respondieron). Vuelve a intentar en unos segundos."
      : "No se pudo generar ninguna ficha técnica.");
  }

  zip.end();
  await terminado;
  if (falloZip) throw falloZip;

  const url = URL.createObjectURL(new Blob(blobs, { type: "application/zip" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `${String(op.nombreZip || "fichas-tecnicas").replace(/[\\/:*?"<>|]+/g, "-")}.zip`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60 * 1000);
  return { generadas, fallidas, sinFoto, cancelado: false };
}
