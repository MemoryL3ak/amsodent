import { useState } from "react";
import { Loader2, Printer } from "lucide-react";
import { api } from "../lib/api";

/* Botón «Carta» (2026-10-07): imprime el documento de Bsale en hoja carta.
   La boleta y la nota de débito salen de Bsale en rollo térmico de 80 mm; la
   factura, la guía y la nota de crédito ya salen en hoja, así que este botón
   abre igual una versión carta para todas. El PDF se arma en el navegador
   (@react-pdf, cargado solo al usarlo). */
export default function BotonImprimirCarta({ bsaleId, etiqueta = "Carta", compacto = false, className, style, onError }) {
  const [cargando, setCargando] = useState(false);
  if (!bsaleId) return null;
  async function imprimir() {
    setCargando(true);
    try {
      const [datos, mod] = await Promise.all([api.get(`/bsale/facturas/impresion/${bsaleId}`), import("../lib/imprimirCarta")]);
      await mod.abrirDocumentoCarta(datos);
    } catch (e) {
      const msg = e?.message || "No se pudo armar el documento en carta.";
      if (onError) onError(msg); else window.alert(msg);
    } finally {
      setCargando(false);
    }
  }
  return (
    <button
      type="button"
      className={className || (compacto ? "btn btn-ghost btn-sm boton-carta" : "btn btn-secondary btn-sm boton-carta")}
      onClick={imprimir}
      disabled={cargando}
      title="Imprimir en hoja carta (formato normal, no térmico)"
      aria-label="Imprimir en hoja carta"
      style={{ display: "inline-flex", alignItems: "center", gap: 4, ...(compacto ? { padding: "2px 5px", minHeight: 0 } : {}), ...style }}
    >
      {cargando ? <Loader2 size={13} className="spin" /> : <Printer size={13} />}{compacto ? null : ` ${etiqueta}`}
    </button>
  );
}
