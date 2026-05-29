// Utilidades compartidas para exportar reportes de stock desde el portal del
// cliente y el portal de gestión:
//   - descargarCSV: archivo .csv compatible con Excel chileno (separador ";" + BOM)
//   - descargarReportePDF: genera y descarga un PDF VECTORIAL (texto seleccionable,
//     ajustado a la página) con la identidad de Amsodent, directamente como archivo.

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
  panel: "#f8fafc",
  blanco: "#ffffff",
  sombra: "#1e293b",
};

const TONOS = {
  rojo: { color: "#dc2626", bg: "#fef2f2", borde: "#fecaca" },
  amarillo: { color: "#d97706", bg: "#fffbeb", borde: "#fde68a" },
  verde: { color: "#16a34a", bg: "#f0fdf4", borde: "#bbf7d0" },
  neutro: { color: "#0f766e", bg: "#f0fdfa", borde: "#cdeceb" },
};

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
function tonoDeEstado(texto) {
  const t = String(texto || "").trim().toLowerCase();
  if (t === "crítico" || t === "critico") return "rojo";
  if (t === "bajo") return "amarillo";
  if (t === "ok") return "verde";
  return null;
}

export function descargarCSV(filename, headers, rows) {
  const enc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const csv = [headers, ...rows]
    .map((fila) => fila.map(enc).join(";"))
    .join("\r\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
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
          resolve({
            dataUrl: c.toDataURL("image/png"),
            w: img.naturalWidth,
            h: img.naturalHeight,
          });
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

export async function descargarReportePDF({
  filename = "reporte.pdf",
  titulo = "Reporte",
  subtitulo = "",
  meta = [],
  resumen = [],
  headers = [],
  rows = [],
  aligns = [],
  orientation = "landscape",
}) {
  try {
    const logo = await cargarLogo();
    const { jsPDF } = await import("jspdf");
    const doc = new jsPDF({ unit: "pt", format: "a4", orientation });

    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const margin = 36;
    const contentW = pageW - margin * 2;
    const FONT = "helvetica";

    const setColor = (hex) => doc.setTextColor(...rgb(hex));
    const setFill = (hex) => doc.setFillColor(...rgb(hex));
    const setDraw = (hex) => doc.setDrawColor(...rgb(hex));

    // Barra con degradado teal → tealLight.
    const gradBar = (x, yy, w, h) => {
      const steps = 64;
      const seg = w / steps;
      for (let i = 0; i < steps; i++) {
        const [r, g, b] = mezcla(C.teal, C.tealLight, i / (steps - 1));
        doc.setFillColor(r, g, b);
        doc.rect(x + seg * i, yy, seg + 0.7, h, "F");
      }
    };

    // Sombra suave (usa transparencia si está disponible).
    const sombra = (x, yy, w, h, r) => {
      try {
        doc.setGState(new doc.GState({ opacity: 0.1 }));
        setFill(C.sombra);
        doc.roundedRect(x + 1.5, yy + 2.5, w, h, r, r, "F");
        doc.setGState(new doc.GState({ opacity: 1 }));
      } catch {
        setFill("#e9edf2");
        doc.roundedRect(x + 1.5, yy + 2.5, w, h, r, r, "F");
      }
    };

    // ── Encabezado ──────────────────────────────────────────────────────
    let y = margin + 6;
    let brandX = margin;
    if (logo) {
      const logoH = 28;
      const logoW = logoH * (logo.w / logo.h);
      doc.addImage(logo.dataUrl, "PNG", margin, y, logoW, logoH);
      const divX = margin + logoW + 14;
      setDraw(C.borde);
      doc.setLineWidth(1);
      doc.line(divX, y + 1, divX, y + 29);
      brandX = divX + 14;
    }
    doc.setFont(FONT, "bold");
    doc.setFontSize(11.5);
    setColor(C.titulo);
    doc.text("AMSODENT MEDICAL", brandX, y + 8, { baseline: "top" });
    doc.setFont(FONT, "normal");
    doc.setFontSize(8);
    setColor(C.tenue);
    doc.text("INSUMOS Y EQUIPAMIENTO DENTAL", brandX, y + 22, { baseline: "top" });

    const rx = pageW - margin;
    doc.setFont(FONT, "bold");
    doc.setFontSize(8);
    setColor(C.tealLight);
    doc.text("REPORTE", rx, y, { align: "right", baseline: "top" });
    doc.setFont(FONT, "bold");
    doc.setFontSize(17);
    setColor(C.titulo);
    doc.text(titulo, rx, y + 11, { align: "right", baseline: "top" });
    let ry = y + 33;
    if (subtitulo) {
      doc.setFont(FONT, "normal");
      doc.setFontSize(9.5);
      setColor(C.suave);
      doc.text(subtitulo, rx, ry, { align: "right", baseline: "top" });
      ry += 13;
    }
    doc.setFont(FONT, "normal");
    doc.setFontSize(8);
    setColor(C.tenue);
    const fechaEmision = new Date().toLocaleString("es-CL", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
    doc.text(`Emitido el ${fechaEmision}`, rx, ry, { align: "right", baseline: "top" });

    y = Math.max(y + 44, ry + 16);

    // Regla con degradado y extremos redondeados.
    gradBar(margin, y, contentW, 4);
    y += 18;

    // ── Meta (datos de cabecera) ────────────────────────────────────────
    const metaItems = (meta || []).filter((m) => m && (m.valor || m.valor === 0));
    if (metaItems.length) {
      const metaH = 42;
      sombra(margin, y, contentW, metaH, 10);
      setFill(C.blanco);
      setDraw(C.borde);
      doc.setLineWidth(1);
      doc.roundedRect(margin, y, contentW, metaH, 10, 10, "FD");
      let mx = margin + 20;
      metaItems.forEach((m) => {
        doc.setFont(FONT, "bold");
        doc.setFontSize(7.5);
        setColor(C.tenue);
        const label = String(m.label || "").toUpperCase();
        doc.text(label, mx, y + 11, { baseline: "top" });
        doc.setFont(FONT, "bold");
        doc.setFontSize(12.5);
        setColor(C.titulo);
        const valor = String(m.valor);
        doc.text(valor, mx, y + 22, { baseline: "top" });
        doc.setFontSize(12.5);
        const wv = doc.getTextWidth(valor);
        doc.setFontSize(7.5);
        const wl = doc.getTextWidth(label);
        mx += Math.max(wv, wl) + 38;
      });
      y += metaH + 16;
    }

    // ── Tarjetas de resumen (KPIs) ──────────────────────────────────────
    const kpis = (resumen || []).filter(Boolean);
    if (kpis.length) {
      const gap = 14;
      const cardW = (contentW - gap * (kpis.length - 1)) / kpis.length;
      const cardH = 58;
      kpis.forEach((k, i) => {
        const t = TONOS[k.tono] || TONOS.neutro;
        const cx = margin + i * (cardW + gap);
        sombra(cx, y, cardW, cardH, 12);
        setFill(C.blanco);
        setDraw(C.borde);
        doc.setLineWidth(1);
        doc.roundedRect(cx, y, cardW, cardH, 12, 12, "FD");
        // Barra de acento a la izquierda.
        setFill(t.color);
        doc.roundedRect(cx + 14, y + 14, 5, cardH - 28, 2.5, 2.5, "F");
        // Valor grande.
        doc.setFont(FONT, "bold");
        doc.setFontSize(23);
        setColor(t.color);
        doc.text(String(k.valor), cx + 30, y + 15, { baseline: "top" });
        // Etiqueta.
        doc.setFont(FONT, "bold");
        doc.setFontSize(8);
        setColor(C.suave);
        doc.text(String(k.label || "").toUpperCase(), cx + 30, y + cardH - 19, {
          baseline: "top",
        });
      });
      y += cardH + 18;
    }

    // ── Tabla ───────────────────────────────────────────────────────────
    const weights = headers.map((h, i) => {
      const a = aligns[i] || "left";
      if (i === 0) return 2.4;
      if (a === "right") return 1;
      if (a === "center") return 1.15;
      return 1.35;
    });
    const sumW = weights.reduce((a, b) => a + b, 0) || 1;
    const colW = weights.map((w) => (w / sumW) * contentW);
    const colX = [];
    let acc = margin;
    colW.forEach((w) => {
      colX.push(acc);
      acc += w;
    });

    const padX = 10;
    const padY = 8;
    const headerH = 26;
    const lineH = 11;
    const footerReserva = 44;
    let regionTop = 0;

    const cerrarMarco = (bottom) => {
      // Marco exterior redondeado de la tabla en la página actual.
      setDraw(C.borde);
      doc.setLineWidth(1);
      doc.roundedRect(margin, regionTop, contentW, bottom - regionTop, 8, 8, "S");
    };

    const dibujarEncabezadoTabla = () => {
      regionTop = y;
      setFill(C.teal);
      doc.roundedRect(margin, y, contentW, headerH, 8, 8, "F");
      doc.rect(margin, y + headerH - 8, contentW, 8, "F"); // base recta
      doc.setFont(FONT, "bold");
      doc.setFontSize(8);
      setColor(C.blanco);
      headers.forEach((h, i) => {
        const a = aligns[i] || "left";
        const tx =
          a === "right"
            ? colX[i] + colW[i] - padX
            : a === "center"
              ? colX[i] + colW[i] / 2
              : colX[i] + padX;
        doc.text(String(h).toUpperCase(), tx, y + headerH / 2 + 0.5, {
          align: a === "left" ? "left" : a,
          baseline: "middle",
        });
      });
      y += headerH;
    };

    dibujarEncabezadoTabla();
    doc.setFont(FONT, "normal");
    doc.setFontSize(9);

    rows.forEach((fila, ri) => {
      const celdas = fila.map((c, i) => {
        const a = aligns[i] || "left";
        const texto = String(c ?? "");
        if (a === "center" && tonoDeEstado(texto)) {
          return { tipo: "pill", texto };
        }
        const lineas = doc.splitTextToSize(texto, colW[i] - padX * 2);
        return { tipo: "texto", lineas, align: a };
      });
      const maxLineas = Math.max(1, ...celdas.map((c) => c.lineas?.length || 1));
      const rowH = Math.max(26, maxLineas * lineH + padY * 2);

      if (y + rowH > pageH - margin - footerReserva) {
        cerrarMarco(y);
        doc.addPage();
        y = margin + 6;
        dibujarEncabezadoTabla();
        doc.setFont(FONT, "normal");
        doc.setFontSize(9);
      }

      if (ri % 2 === 1) {
        setFill(C.zebra);
        doc.rect(margin, y, contentW, rowH, "F");
      }

      celdas.forEach((celda, i) => {
        if (celda.tipo === "pill") {
          const tono = TONOS[tonoDeEstado(celda.texto)];
          doc.setFont(FONT, "bold");
          doc.setFontSize(7.5);
          const txt = celda.texto.toUpperCase();
          const tw = doc.getTextWidth(txt);
          const pillW = tw + 18;
          const pillH = 15;
          const px = colX[i] + colW[i] / 2 - pillW / 2;
          const py = y + (rowH - pillH) / 2;
          setFill(tono.bg);
          setDraw(tono.borde);
          doc.setLineWidth(0.8);
          doc.roundedRect(px, py, pillW, pillH, 7.5, 7.5, "FD");
          setColor(tono.color);
          doc.text(txt, colX[i] + colW[i] / 2, py + pillH / 2 + 0.5, {
            align: "center",
            baseline: "middle",
          });
          doc.setFont(FONT, "normal");
          doc.setFontSize(9);
        } else {
          const a = celda.align;
          doc.setFont(FONT, i === 0 ? "bold" : "normal");
          setColor(i === 0 ? C.titulo : C.texto);
          const tx =
            a === "right"
              ? colX[i] + colW[i] - padX
              : a === "center"
                ? colX[i] + colW[i] / 2
                : colX[i] + padX;
          celda.lineas.forEach((ln, li) => {
            doc.text(ln, tx, y + padY + li * lineH, {
              align: a === "left" ? "left" : a,
              baseline: "top",
            });
          });
          doc.setFont(FONT, "normal");
        }
      });

      setDraw(C.bordeSuave);
      doc.setLineWidth(0.7);
      doc.line(margin + 6, y + rowH, margin + contentW - 6, y + rowH);
      y += rowH;
    });

    cerrarMarco(y);

    // ── Decoración por página (cinta superior + pie) ────────────────────
    const totalPaginas = doc.getNumberOfPages();
    for (let p = 1; p <= totalPaginas; p++) {
      doc.setPage(p);
      gradBar(0, 0, pageW, 6); // cinta de marca superior
      doc.setFont(FONT, "normal");
      doc.setFontSize(7.5);
      setColor(C.tenue);
      doc.text(
        "AMSODENT MEDICAL · Insumos y equipamiento dental · amsodentmedical.cl · +56 2 2854 0000",
        pageW / 2,
        pageH - 22,
        { align: "center", baseline: "top" },
      );
      doc.text(`Página ${p} de ${totalPaginas}`, pageW - margin, pageH - 22, {
        align: "right",
        baseline: "top",
      });
    }

    doc.save(filename);
    return true;
  } catch {
    return false;
  }
}
