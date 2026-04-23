import { pdf } from "@react-pdf/renderer";
import { FichaTecnicaDocument } from "../components/FichaTecnica";
import { api } from "../lib/api";

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

/* ============================================================
   API pública
============================================================ */

/**
 * Genera el PDF de ficha técnica y gatilla la descarga en el navegador.
 * @param {object} producto  – registro completo del producto
 * @returns {Promise<void>}
 */
export async function descargarFichaTecnica(producto) {
  if (!producto) throw new Error("Producto requerido");

  const logoUrl = `${window.location.origin}/logo_superior_ficha.png`;
  const marcaAguaUrl = `${window.location.origin}/logo_marca_agua.png`;

  const [logoSrc, marcaAguaSrc, productoImg] = await Promise.all([
    urlToDataUrl(logoUrl),
    urlToDataUrl(marcaAguaUrl),
    resolverImagenProducto(producto),
  ]);

  const productoSrc =
    productoImg && productoImg.startsWith("data:")
      ? productoImg
      : (await urlToDataUrl(productoImg)) || productoImg || null;

  const pdfBlob = await pdf(
    <FichaTecnicaDocument
      producto={producto}
      logoSrc={logoSrc || null}
      marcaAguaSrc={marcaAguaSrc || null}
      productoSrc={productoSrc || null}
    />
  ).toBlob();

  const sku = (producto.sku || "").toString().trim();
  const safeSku = (sku || "producto")
    .replace(/[\\/]+/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  const downloadName = `${safeSku}.pdf`;

  const blobUrl = URL.createObjectURL(pdfBlob);
  const link = document.createElement("a");
  link.href = blobUrl;
  link.download = downloadName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(blobUrl);
}
