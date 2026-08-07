// Genera y descarga un PDF VECTORIAL (texto seleccionable) con la ficha de un
// proceso de Mercado Público, a partir de la estructura normalizada que
// entrega el backend (GET /licitaciones/mercado-publico/:codigo):
//   { fuente, codigo, nombre, descripcion, estado, tono, chips[],
//     secciones[{titulo, filas[[k,v]]}], productos[], url_acta }
// Mismo lenguaje visual que los reportes de stock (src/lib/reporteStock.js).

const LOGO_URL =
  "https://amsodentmedical.cl/wp-content/uploads/2025/12/Amsodent-1.png";

const C = {
  teal: "#0f766e",
  tealLight: "#25b7bd",
  titulo: "#0f172a",
  texto: "#334155",
  suave: "#64748b",
  tenue: "#94a3b8",
  borde: "#e3e9ef",
  bordeSuave: "#eef2f6",
  zebra: "#f8fafc",
  panel: "#f1f5f9",
  blanco: "#ffffff",
};

// Colores de los badges de estado (mismos tonos del popup).
const TONO_ESTADO = {
  green: { bg: "#dcfce7", fg: "#15803d" },
  blue: { bg: "#dbeafe", fg: "#1d4ed8" },
  amber: { bg: "#fef3c7", fg: "#b45309" },
  red: { bg: "#fee2e2", fg: "#b91c1c" },
  gray: { bg: "#f1f5f9", fg: "#64748b" },
};
const TONO_CHIP = { bg: "#eef2ff", fg: "#3730a3" };

function rgb(hex) {
  const n = parseInt(String(hex).replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mezcla(h1, h2, t) {
  const a = rgb(h1);
  const b = rgb(h2);
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

function cargarLogo() {
  return new Promise((resolve) => {
    try {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        try {
          const c = document.createElement("canvas");
          c.width = img.naturalWidth;
          c.height = img.naturalHeight;
          c.getContext("2d").drawImage(img, 0, 0);
          resolve({ dataUrl: c.toDataURL("image/png"), w: img.naturalWidth, h: img.naturalHeight });
        } catch {
          resolve(null);
        }
      };
      img.onerror = () => resolve(null);
      img.src = LOGO_URL;
    } catch {
      resolve(null);
    }
  });
}

export async function descargarFichaMercadoPublicoPDF(ficha, { urlFicha = "" } = {}) {
  const logo = await cargarLogo();
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "a4", orientation: "portrait" });

  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 40;
  const contentW = pageW - margin * 2;
  const FONT = "helvetica";
  const FOOTER_H = 34;

  const setColor = (hex) => doc.setTextColor(...rgb(hex));
  const setFill = (hex) => doc.setFillColor(...rgb(hex));
  const setDraw = (hex) => doc.setDrawColor(...rgb(hex));

  const gradBar = (x, yy, w, h) => {
    const steps = 64;
    const seg = w / steps;
    for (let i = 0; i < steps; i++) {
      const [r, g, b] = mezcla(C.teal, C.tealLight, i / (steps - 1));
      doc.setFillColor(r, g, b);
      doc.rect(x + seg * i, yy, seg + 0.7, h, "F");
    }
  };

  let y = margin;
  const ensure = (h) => {
    if (y + h > pageH - margin - FOOTER_H) {
      doc.addPage();
      y = margin;
    }
  };

  // ── Encabezado de marca ─────────────────────────────────────────────────
  let brandX = margin;
  if (logo) {
    const logoH = 26;
    const logoW = logoH * (logo.w / logo.h);
    doc.addImage(logo.dataUrl, "PNG", margin, y, logoW, logoH);
    const divX = margin + logoW + 12;
    setDraw(C.borde);
    doc.setLineWidth(1);
    doc.line(divX, y + 1, divX, y + 27);
    brandX = divX + 12;
  }
  doc.setFont(FONT, "bold");
  doc.setFontSize(11);
  setColor(C.titulo);
  doc.text("AMSODENT MEDICAL", brandX, y + 7, { baseline: "top" });
  doc.setFont(FONT, "normal");
  doc.setFontSize(7.5);
  setColor(C.tenue);
  doc.text("INSUMOS Y EQUIPAMIENTO DENTAL", brandX, y + 20, { baseline: "top" });

  const rx = pageW - margin;
  doc.setFont(FONT, "bold");
  doc.setFontSize(7.5);
  setColor(C.tealLight);
  doc.text("FICHA MERCADO PÚBLICO", rx, y, { align: "right", baseline: "top" });
  doc.setFont(FONT, "bold");
  doc.setFontSize(15);
  setColor(C.titulo);
  doc.text(String(ficha.codigo || ""), rx, y + 10, { align: "right", baseline: "top" });
  doc.setFont(FONT, "normal");
  doc.setFontSize(7.5);
  setColor(C.tenue);
  const fechaEmision = new Date().toLocaleString("es-CL", {
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
  doc.text(`Emitida el ${fechaEmision}`, rx, y + 29, { align: "right", baseline: "top" });

  y += 44;
  gradBar(margin, y, contentW, 3);
  y += 16;

  // ── Badges de estado ────────────────────────────────────────────────────
  const pill = (texto, tono, x) => {
    doc.setFont(FONT, "bold");
    doc.setFontSize(7.5);
    const w = doc.getTextWidth(texto) + 14;
    setFill(tono.bg);
    doc.roundedRect(x, y, w, 15, 7.5, 7.5, "F");
    setColor(tono.fg);
    doc.text(texto, x + w / 2, y + 10.5, { align: "center" });
    return w;
  };
  let px = margin;
  const badges = [
    [String(ficha.estado || "Sin estado"), TONO_ESTADO[ficha.tono] || TONO_ESTADO.gray],
    ...(ficha.chips || []).map((c) => [String(c), TONO_CHIP]),
  ];
  for (const [texto, tono] of badges) {
    doc.setFont(FONT, "bold");
    doc.setFontSize(7.5);
    const w = doc.getTextWidth(texto) + 14;
    if (px + w > margin + contentW) {
      px = margin;
      y += 20;
    }
    pill(texto, tono, px);
    px += w + 6;
  }
  y += 26;

  // ── Nombre y descripción ────────────────────────────────────────────────
  doc.setFont(FONT, "bold");
  doc.setFontSize(12);
  setColor(C.titulo);
  const nombreLines = doc.splitTextToSize(String(ficha.nombre || ""), contentW);
  ensure(nombreLines.length * 15);
  doc.text(nombreLines, margin, y, { baseline: "top" });
  y += nombreLines.length * 15 + 3;

  if (ficha.descripcion && ficha.descripcion !== ficha.nombre) {
    doc.setFont(FONT, "normal");
    doc.setFontSize(8.5);
    setColor(C.suave);
    const descLines = doc.splitTextToSize(String(ficha.descripcion), contentW);
    ensure(descLines.length * 11);
    doc.text(descLines, margin, y, { baseline: "top" });
    y += descLines.length * 11 + 4;
  }

  // ── Título de sección ───────────────────────────────────────────────────
  const tituloSeccion = (texto) => {
    ensure(34);
    y += 10;
    doc.setFont(FONT, "bold");
    doc.setFontSize(9);
    setColor(C.teal);
    doc.text(texto.toUpperCase(), margin, y, { baseline: "top" });
    y += 13;
    setDraw(C.borde);
    doc.setLineWidth(0.75);
    doc.line(margin, y - 2, margin + contentW, y - 2);
  };

  // ── Productos o servicios ───────────────────────────────────────────────
  const productos = ficha.productos || [];
  if (productos.length > 0) {
    tituloSeccion(`Productos o servicios (${productos.length})`);
    const conAdj = productos.some((p) => p.adjudicacion);
    const colNum = 20;
    const colCant = 86;
    const colAdj = conAdj ? 150 : 0;
    const colProd = contentW - colNum - colCant - colAdj;

    const headerFila = () => {
      ensure(18);
      setFill(C.panel);
      doc.rect(margin, y, contentW, 15, "F");
      doc.setFont(FONT, "bold");
      doc.setFontSize(7.5);
      setColor(C.suave);
      doc.text("#", margin + 5, y + 10.5);
      doc.text("PRODUCTO", margin + colNum + 5, y + 10.5);
      doc.text("CANTIDAD", margin + colNum + colProd + colCant - 5, y + 10.5, { align: "right" });
      if (conAdj) doc.text("ADJUDICACIÓN", margin + colNum + colProd + colCant + 5, y + 10.5);
      y += 15;
    };
    headerFila();

    productos.forEach((p, i) => {
      doc.setFontSize(8.5);
      const nomTxt = `${p.nombre || ""}${p.codigo ? `  ·  Cod: ${p.codigo}` : ""}`;
      doc.setFont(FONT, "bold");
      const nomLines = doc.splitTextToSize(nomTxt, colProd - 10);
      doc.setFont(FONT, "normal");
      doc.setFontSize(8);
      const descLines = p.descripcion ? doc.splitTextToSize(String(p.descripcion), colProd - 10) : [];
      doc.setFontSize(7.5);
      const adjLines = conAdj && p.adjudicacion ? doc.splitTextToSize(String(p.adjudicacion), colAdj - 10) : [];
      const rowH = Math.max(
        nomLines.length * 10.5 + descLines.length * 10 + 9,
        adjLines.length * 9.5 + 9,
        17,
      );
      if (y + rowH > pageH - margin - FOOTER_H) {
        doc.addPage();
        y = margin;
        headerFila();
      }
      if (i % 2 === 1) {
        setFill(C.zebra);
        doc.rect(margin, y, contentW, rowH, "F");
      }
      setDraw(C.bordeSuave);
      doc.setLineWidth(0.5);
      doc.line(margin, y, margin + contentW, y);

      doc.setFont(FONT, "normal");
      doc.setFontSize(8);
      setColor(C.tenue);
      doc.text(String(i + 1), margin + 5, y + 12);

      doc.setFont(FONT, "bold");
      doc.setFontSize(8.5);
      setColor(C.titulo);
      doc.text(nomLines, margin + colNum + 5, y + 12);
      if (descLines.length) {
        doc.setFont(FONT, "normal");
        doc.setFontSize(8);
        setColor(C.suave);
        doc.text(descLines, margin + colNum + 5, y + 12 + nomLines.length * 10.5);
      }

      doc.setFont(FONT, "bold");
      doc.setFontSize(8.5);
      setColor(C.texto);
      const cant = `${Number(p.cantidad || 0).toLocaleString("es-CL")}${p.unidad ? ` ${p.unidad}` : ""}`;
      doc.text(cant, margin + colNum + colProd + colCant - 5, y + 12, { align: "right" });

      if (conAdj) {
        doc.setFont(FONT, "normal");
        doc.setFontSize(7.5);
        setColor(adjLines.length ? C.texto : C.tenue);
        doc.text(adjLines.length ? adjLines : "—", margin + colNum + colProd + colCant + 5, y + 12);
      }
      y += rowH;
    });
    setDraw(C.borde);
    doc.setLineWidth(0.75);
    doc.line(margin, y, margin + contentW, y);
    y += 4;
  }

  // ── Secciones clave → valor ─────────────────────────────────────────────
  const labelW = 165;
  for (const s of ficha.secciones || []) {
    tituloSeccion(s.titulo);
    (s.filas || []).forEach(([k, v], i) => {
      doc.setFont(FONT, "normal");
      doc.setFontSize(8.5);
      const valLines = doc.splitTextToSize(String(v ?? ""), contentW - labelW - 15);
      const rowH = Math.max(17, valLines.length * 11 + 7);
      ensure(rowH);
      if (i % 2 === 1) {
        setFill(C.zebra);
        doc.rect(margin, y, contentW, rowH, "F");
      }
      setDraw(C.bordeSuave);
      doc.setLineWidth(0.5);
      doc.line(margin, y, margin + contentW, y);
      doc.setFont(FONT, "normal");
      doc.setFontSize(8.5);
      setColor(C.suave);
      doc.text(String(k), margin + 5, y + 12);
      doc.setFont(FONT, "bold");
      setColor(C.texto);
      doc.text(valLines, margin + labelW, y + 12);
      y += rowH;
    });
    setDraw(C.borde);
    doc.setLineWidth(0.75);
    doc.line(margin, y, margin + contentW, y);
    y += 4;
  }

  // ── Links útiles ────────────────────────────────────────────────────────
  const links = [
    urlFicha ? ["Ficha en Mercado Público", urlFicha] : null,
    ficha.url_acta ? ["Acta de adjudicación", ficha.url_acta] : null,
  ].filter(Boolean);
  if (links.length) {
    tituloSeccion("Enlaces");
    for (const [etiqueta, url] of links) {
      ensure(14);
      doc.setFont(FONT, "normal");
      doc.setFontSize(8);
      setColor(C.suave);
      doc.text(`${etiqueta}:`, margin + 5, y + 8);
      setColor(C.tealLight);
      const urlCorta = url.length > 95 ? `${url.slice(0, 95)}…` : url;
      doc.textWithLink(urlCorta, margin + 120, y + 8, { url });
      y += 14;
    }
  }

  // ── Pie de página en todas las hojas ────────────────────────────────────
  const total = doc.getNumberOfPages();
  for (let i = 1; i <= total; i++) {
    doc.setPage(i);
    const fy = pageH - 26;
    setDraw(C.borde);
    doc.setLineWidth(0.75);
    doc.line(margin, fy - 8, pageW - margin, fy - 8);
    doc.setFont(FONT, "normal");
    doc.setFontSize(7);
    setColor(C.tenue);
    doc.text(
      `Fuente: ${ficha.fuente || "Mercado Público"} · consultado en vivo y generado desde la plataforma AMSODENT`,
      margin,
      fy,
    );
    doc.text(`Página ${i} de ${total}`, pageW - margin, fy, { align: "right" });
  }

  doc.save(`ficha_${String(ficha.codigo || "proceso").replace(/[^\w-]/g, "_")}.pdf`);
}
