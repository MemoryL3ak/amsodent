// Utilidades para convertir páginas de PDF a recursos embebibles en correo:
// - PNG renderizado en alta calidad
// - Hipervínculos extraídos del PDF (Link annotations) → overlays <a>
// - Capa de texto seleccionable (técnica del PDF.js viewer)

import * as pdfjsLib from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

// Render por defecto: 3x da resolución suficiente para retina; 4x es máximo
// razonable antes de que el peso del PNG se vuelva un problema para SMTP.
const DEFAULT_RENDER_SCALE = 3.0;
const DEFAULT_DISPLAY_WIDTH = 700;

function escapeHtml(str) {
  return String(str || "").replace(/[<>&"']/g, (c) =>
    ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

function safeUrl(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";
  // Sólo aceptamos esquemas seguros para correo.
  if (/^(https?:|mailto:|tel:)/i.test(s)) return s;
  return "";
}

export async function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// Genera el PNG de la primera página (o la indicada) de un PDF.
// Mantenido por compatibilidad — la mayoría de los flujos nuevos usan
// `pdfPageToInteractive` que devuelve el PNG + overlays.
export async function pdfPageToPngBlob(file, { pagina = 1, escala = DEFAULT_RENDER_SCALE } = {}) {
  if (!file) throw new Error("Falta el archivo PDF.");
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const numPagina = Math.min(Math.max(1, pagina), pdf.numPages);
  const page = await pdf.getPage(numPagina);
  const viewport = page.getViewport({ scale: escala });

  const canvas = document.createElement("canvas");
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  const ctx = canvas.getContext("2d");
  await page.render({ canvasContext: ctx, viewport }).promise;

  const blob = await new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/png"));
  if (!blob) throw new Error("No se pudo generar la imagen del PDF.");
  return blob;
}

// Renderiza una página y extrae anotaciones (links) + texto, devolviendo
// HTML listo para insertar en el cuerpo del correo en dos variantes:
//   - htmlSimple: <img> + overlays <a> transparentes (links clicables)
//   - htmlRico:   htmlSimple + capa de texto invisible (selectable)
export async function pdfPageToInteractive(
  file,
  {
    pagina = 1,
    escala = DEFAULT_RENDER_SCALE,
    displayWidth = DEFAULT_DISPLAY_WIDTH,
    cidImagen = "flyer-amsodent",
  } = {}
) {
  if (!file) throw new Error("Falta el archivo PDF.");
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const numPagina = Math.min(Math.max(1, pagina), pdf.numPages);
  const page = await pdf.getPage(numPagina);

  // ── Render PNG en alta resolución ────────────────────────────────────
  const viewportRender = page.getViewport({ scale: escala });
  const canvas = document.createElement("canvas");
  canvas.width = Math.floor(viewportRender.width);
  canvas.height = Math.floor(viewportRender.height);
  const ctx = canvas.getContext("2d");
  await page.render({ canvasContext: ctx, viewport: viewportRender }).promise;
  const pngBlob = await new Promise((resolve) =>
    canvas.toBlob((b) => resolve(b), "image/png")
  );

  // ── Viewport "de display" (en px del correo) para posicionar overlays ─
  const ratio = displayWidth / page.getViewport({ scale: 1 }).width;
  const viewportEmail = page.getViewport({ scale: ratio });
  const widthPx = Math.round(viewportEmail.width);
  const heightPx = Math.round(viewportEmail.height);

  // ── Hipervínculos ────────────────────────────────────────────────────
  const annotations = await page.getAnnotations({ intent: "display" }).catch(() => []);
  const linkOverlays = [];
  const linksLista = [];
  for (const ann of annotations || []) {
    if (ann.subtype !== "Link") continue;
    const url = safeUrl(ann.url || ann.unsafeUrl);
    if (!url) continue; // saltamos enlaces internos (a otra página, named dest, etc.)

    const [x1, y1, x2, y2] = viewportEmail.convertToViewportRectangle(ann.rect);
    const left = Math.min(x1, x2);
    const top = Math.min(y1, y2);
    const w = Math.abs(x2 - x1);
    const h = Math.abs(y2 - y1);

    linkOverlays.push(
      `<a href="${escapeHtml(url)}" target="_blank" rel="noopener" style="position:absolute;left:${left.toFixed(1)}px;top:${top.toFixed(1)}px;width:${w.toFixed(1)}px;height:${h.toFixed(1)}px;display:block;text-decoration:none;background:transparent;"></a>`
    );
    linksLista.push(url);
  }

  // ── Capa de texto invisible (selectable) ─────────────────────────────
  const textContent = await page.getTextContent();
  const textSpans = [];
  for (const item of textContent.items) {
    const text = escapeHtml(item.str);
    if (!text || !text.trim()) continue;

    const tx = pdfjsLib.Util.transform(viewportEmail.transform, item.transform);
    const fontSize = Math.hypot(tx[2], tx[3]);
    const left = tx[4];
    const top = tx[5] - fontSize;

    textSpans.push(
      `<span style="position:absolute;left:${left.toFixed(1)}px;top:${top.toFixed(1)}px;font-size:${fontSize.toFixed(1)}px;line-height:1;font-family:Arial,Helvetica,sans-serif;color:transparent;-webkit-text-fill-color:transparent;white-space:pre;">${text}</span>`
    );
  }

  // ── Fallback de links como lista al final (para clientes que strippean
  //     position:absolute, ej. Outlook desktop). Sólo se incluye si hay links.
  let linksFallback = "";
  if (linksLista.length > 0) {
    const lis = Array.from(new Set(linksLista))
      .map((u) => `<li><a href="${escapeHtml(u)}" target="_blank" rel="noopener">${escapeHtml(u)}</a></li>`)
      .join("");
    linksFallback = `<div style="margin-top:14px;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#475569;"><div style="font-weight:600;margin-bottom:4px;">Enlaces:</div><ul style="margin:0;padding-left:18px;">${lis}</ul></div>`;
  }

  const wrapperOpen = `<div style="position:relative;width:${widthPx}px;max-width:100%;margin:0 auto;font-family:Arial,Helvetica,sans-serif;">`;
  const imgTag = `<img src="cid:${cidImagen}" alt="" style="display:block;width:${widthPx}px;max-width:100%;height:auto;" />`;
  const wrapperClose = `</div>`;

  const htmlSimple = wrapperOpen + imgTag + linkOverlays.join("") + wrapperClose + linksFallback;
  const htmlRico = wrapperOpen + imgTag + textSpans.join("") + linkOverlays.join("") + wrapperClose + linksFallback;

  return {
    pngBlob,
    htmlSimple,
    htmlRico,
    widthPx,
    heightPx,
    linksCount: linksLista.length,
  };
}

// Backward compat: alias del flujo anterior (PDF → solo PNG, sin overlays).
export async function pdfPageToInlineHtml(file, opts = {}) {
  const r = await pdfPageToInteractive(file, opts);
  return { pngBlob: r.pngBlob, html: r.htmlRico, widthPx: r.widthPx, heightPx: r.heightPx };
}
