import { Zip, ZipPassThrough } from "fflate";
import { api } from "../lib/api";
import { descargarFichaTecnica } from "./generarFichaTecnica";

/* ── Varias fichas técnicas en un ZIP (2026-10-07) ───────────────────────────
   Pedido de Ariel: "botón para descargar todas las fichas técnicas de los
   productos". Cada ficha es el mismo PDF del botón «Ficha» y se agrega al ZIP
   apenas se genera (fflate en modo streaming, sin comprimir: los PDF ya vienen
   comprimidos). Cada ~24 MB los trozos pasan a un Blob, así cientos de fichas
   no llenan la memoria de la pestaña. Los textos de la ficha no vienen en los
   listados livianos: se pide el producto completo antes de generar cada una. */

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
 * @returns {Promise<{ generadas: number, fallidas: string[], cancelado: boolean }>}
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
  let generadas = 0;
  // El siguiente producto se pide mientras se arma el PDF del actual.
  const pedir = (p) => (p?.id ? api.get(`/productos/${p.id}`).then((c) => ({ ...p, ...(c || {}) })).catch(() => p) : Promise.resolve(p));
  let siguiente = pedir(lista[0]);

  for (let i = 0; i < total; i++) {
    if (op.debeCancelar?.()) {
      return { generadas, fallidas, cancelado: true };
    }
    const completo = await siguiente;
    if (i + 1 < total) siguiente = pedir(lista[i + 1]);
    op.onProgreso?.({ hechos: i, total, actual: completo?.sku || completo?.nombre || "" });
    try {
      const blob = await descargarFichaTecnica(completo, { soloBlob: true });
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
      fallidas.push(completo?.sku || completo?.nombre || `#${completo?.id}`);
    }
  }
  op.onProgreso?.({ hechos: total, total });
  if (!generadas) throw new Error("No se pudo generar ninguna ficha técnica.");

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
  return { generadas, fallidas, cancelado: false };
}
