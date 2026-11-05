import { api } from "./api";

/* ── Repositorio de documentos: utilidades compartidas (2026-11-05) ──────────
   Las usan la página del repositorio y la ventana de descarga de fichas
   técnicas (que ofrece sumar documentos del repositorio al ZIP). Los archivos
   están en un bucket privado: el servidor entrega una URL firmada de corta
   duración por cada uno. */

export function pesoLegible(bytes) {
  const n = Number(bytes) || 0;
  if (!n) return "";
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / 1024 / 1024).toLocaleString("es-CL", { maximumFractionDigits: 1 })} MB`;
}

/** Documentos del repositorio (vacío si aún no está disponible o si falla). */
export async function listarDocumentosRepositorio() {
  try {
    const r = await api.get("/repositorio");
    return Array.isArray(r?.documentos) ? r.documentos : [];
  } catch {
    return [];
  }
}

/** Abre (descarga) el archivo de un documento en una pestaña nueva. */
export async function abrirDocumentoRepositorio(id) {
  const r = await api.get(`/repositorio/${id}/url`);
  if (!r?.url) throw new Error("El documento no tiene un archivo disponible.");
  window.open(r.url, "_blank", "noopener");
}

/** Bytes del archivo de un documento, para meterlo en un ZIP. */
export async function bytesDocumentoRepositorio(id) {
  const r = await api.get(`/repositorio/${id}/url`);
  if (!r?.url) throw new Error("sin archivo");
  const res = await fetch(r.url);
  if (!res.ok) throw new Error(`error ${res.status}`);
  return { bytes: new Uint8Array(await res.arrayBuffer()), nombre: r.file_name || `documento-${id}` };
}
