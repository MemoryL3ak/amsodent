import { pdf } from "@react-pdf/renderer";
import { FichaTecnicaDocument } from "../components/FichaTecnica";
import { api } from "../lib/api";
import { nombreArchivoFicha } from "./nombreArchivoFicha";

/* ============================================================
   Helpers internos
============================================================ */
function extractStoragePathFromUrl(url, bucket) {
  if (!url || !bucket) return "";
  const marker = `/${bucket}/`;
  const idx = url.indexOf(marker);
  if (idx === -1) return "";
  return url.slice(idx + marker.length);
}

async function dataUrlFromStoragePath(bucket, path) {
  if (!bucket || !path) return "";
  try {
    const signedData = await api.get(
      `/licitaciones/storage/signed-url?bucket=${bucket}&path=${encodeURIComponent(path)}`
    );
    if (!signedData?.signedUrl) return "";
    const res = await fetch(signedData.signedUrl);
    if (!res.ok) return "";
    const data = await res.blob();
    return await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result || "");
      reader.onerror = () => resolve("");
      reader.readAsDataURL(data);
    });
  } catch {
    return "";
  }
}

async function urlToDataUrl(url) {
  if (!url) return "";
  if (url.startsWith("data:")) return url;
  if (url.includes("/storage/v1/object/")) {
    const path = extractStoragePathFromUrl(url, "product-images");
    return (await dataUrlFromStoragePath("product-images", path)) || "";
  }
  try {
    const res = await fetch(url);
    if (!res.ok) return "";
    const blob = await res.blob();
    return await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result || "");
      reader.onerror = () => resolve("");
      reader.readAsDataURL(blob);
    });
  } catch {
    return "";
  }
}

async function resolverImagenProducto(producto) {
  const raw = producto?.imagen_url || "";
  if (!raw) return "";
  if (raw.startsWith("http")) return raw;
  return (await dataUrlFromStoragePath("product-images", raw)) || "";
}

/* (2026-11-04) La foto del producto, con reintentos. Al bajar muchas fichas
   seguidas (ZIP) una URL firmada o una descarga podía fallar de pasada y la
   ficha salía sin foto sin que nadie lo supiera: ahora se intenta hasta tres
   veces y quien llama sabe si al final faltó (`sinFoto`). */
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

async function cargarImagenProducto(producto, intentos = 3) {
  if (!producto?.imagen_url) return "";
  for (let i = 0; i < intentos; i++) {
    const img = await resolverImagenProducto(producto);
    const src = img && img.startsWith("data:") ? img : (await urlToDataUrl(img)) || img || "";
    if (src) return src;
    if (i + 1 < intentos) await espera(600 * (i + 1));
  }
  return "";
}

/* Logo y marca de agua: son los mismos para todas las fichas, se traen una
   sola vez por sesión (antes se pedían ficha por ficha). */
const estaticos = new Map();
function estaticoDataUrl(url) {
  if (!estaticos.has(url)) {
    estaticos.set(url, urlToDataUrl(url).then((v) => { if (!v) estaticos.delete(url); return v; }));
  }
  return estaticos.get(url);
}

/* ============================================================
   API pública
============================================================ */

/**
 * Genera el PDF de ficha técnica y gatilla la descarga en el navegador.
 * @param {object} producto  – registro completo del producto
 * @returns {Promise<void>}
 */
/* Abre la ficha en una pestaña nueva (2026-10-03: botón "Abrir ficha técnica"
   al crear un producto). La pestaña se abre ANTES de generar el PDF, todavía
   dentro del clic, para que el navegador no la bloquee como ventana emergente. */
/* (2026-11-17) La ficha abierta en una pestaña es una dirección interna del
   navegador (blob:…): si se guardaba desde el visor, el archivo salía con un
   nombre al azar. Ahora la pestaña trae una barra con el nombre y un botón
   «Descargar» que la baja como «Nombre del producto - SKU.pdf»; debajo va el
   mismo visor de PDF. La dirección se crea en la pestaña nueva, así vive
   mientras esté abierta. Devuelve false si no se pudo armar (se abre como antes). */
function mostrarFichaEnPestana(ventana, blob, nombre) {
  try {
    const doc = ventana.document;
    const url = ventana.URL.createObjectURL(blob);
    doc.title = nombre;
    doc.body.innerHTML = "";
    doc.body.style.cssText = "margin:0;height:100vh;display:flex;flex-direction:column;background:#525659;font-family:system-ui,-apple-system,'Segoe UI',sans-serif";

    const barra = doc.createElement("div");
    barra.style.cssText = "display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:8px 14px;background:#0f172a;color:#fff;font-size:13px";
    const titulo = doc.createElement("span");
    titulo.textContent = nombre;
    titulo.style.cssText = "flex:1 1 200px;min-width:0;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap";
    const bajar = doc.createElement("a");
    bajar.href = url;
    bajar.download = `${nombre}.pdf`;
    bajar.textContent = "Descargar";
    bajar.title = `Descargar como «${nombre}.pdf»`;
    bajar.style.cssText = "flex-shrink:0;background:#25b3b3;color:#fff;text-decoration:none;font-weight:700;padding:6px 14px;border-radius:8px";
    barra.appendChild(titulo);
    barra.appendChild(bajar);

    const marco = doc.createElement("iframe");
    marco.src = url;
    marco.title = nombre;
    marco.style.cssText = "flex:1 1 auto;min-height:0;width:100%;border:0;background:#525659";

    doc.body.appendChild(barra);
    doc.body.appendChild(marco);
    return true;
  } catch {
    return false;
  }
}

export async function abrirFichaTecnica(producto, opciones = {}) {
  const ventana = window.open("", "_blank");
  if (ventana) {
    try { ventana.document.title = "Ficha técnica"; ventana.document.body.innerHTML = '<p style="font-family:sans-serif;padding:24px">Generando la ficha técnica…</p>'; } catch { /* otra pestaña */ }
  }
  try {
    // `cargar`: trae el producto completo (con los textos de la ficha) ya con la pestaña abierta.
    const completo = opciones.cargar ? await opciones.cargar() : producto;
    const blob = await descargarFichaTecnica(completo || producto, { soloBlob: true });
    const nombre = nombreArchivoFicha(completo || producto);
    if (ventana && !ventana.closed && mostrarFichaEnPestana(ventana, blob, nombre)) return;
    const url = URL.createObjectURL(blob);
    if (ventana && !ventana.closed) ventana.location.href = url;
    else window.open(url, "_blank");
    setTimeout(() => URL.revokeObjectURL(url), 5 * 60 * 1000);
  } catch (e) {
    try { ventana?.close(); } catch { /* nada */ }
    throw e;
  }
}

export async function descargarFichaTecnica(producto, opciones) {
  if (!producto) throw new Error("Producto requerido");

  const logoUrl = `${window.location.origin}/logo_superior_ficha.png`;
  const marcaAguaUrl = `${window.location.origin}/logo_marca_agua.png`;

  const [logoSrc, marcaAguaSrc, productoSrc] = await Promise.all([
    estaticoDataUrl(logoUrl),
    estaticoDataUrl(marcaAguaUrl),
    cargarImagenProducto(producto),
  ]);
  // `onEstado`: avisa si el producto tiene foto registrada pero no se pudo cargar.
  opciones?.onEstado?.({ sinFoto: Boolean(producto.imagen_url) && !productoSrc });

  const pdfBlob = await pdf(
    <FichaTecnicaDocument
      producto={producto}
      logoSrc={logoSrc || null}
      marcaAguaSrc={marcaAguaSrc || null}
      productoSrc={productoSrc || null}
    />
  ).toBlob();
  if (opciones?.soloBlob) return pdfBlob;

  // (2026-11-17) «Nombre del producto - SKU.pdf» (antes solo el SKU).
  const downloadName = `${nombreArchivoFicha(producto)}.pdf`;

  const blobUrl = URL.createObjectURL(pdfBlob);
  const link = document.createElement("a");
  link.href = blobUrl;
  link.download = downloadName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(blobUrl);
}
