import { createElement } from "react";
import { pdf } from "@react-pdf/renderer";
import { DocumentoCartaBsale } from "../components/DocumentoCartaBsale";

/* Abre en una pestaña nueva el PDF carta de un documento de Bsale (2026-10-07)
   con los datos de /bsale/facturas/impresion/:id. Si el navegador bloquea la
   pestaña, lo descarga. */
export async function abrirDocumentoCarta(datos) {
  const blob = await pdf(createElement(DocumentoCartaBsale, { d: datos })).toBlob();
  const url = URL.createObjectURL(blob);
  const ventana = window.open(url, "_blank");
  if (!ventana) {
    const a = document.createElement("a");
    a.href = url;
    a.download = `${String(datos.tipo || "Documento").replace(/\s+/g, "_")}_${datos.numero}.pdf`;
    a.click();
  }
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
