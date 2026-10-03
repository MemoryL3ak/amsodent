import { useState } from "react";
import { FileText, Loader2 } from "lucide-react";
import { api } from "../lib/api";
import { abrirFichaTecnica } from "../utils/generarFichaTecnica";

/* ── Botón "Ficha" en cada línea de la cotización (2026-10-03) ───────────────
   Pedido de Ariel: "cuando se agregue un producto, que muestre una opción o
   un botón para abrir la ficha técnica". Aparece en la línea cuando el
   producto está en el catálogo (por SKU o por nombre) y abre su ficha técnica
   en PDF en una pestaña nueva. El catálogo que carga la cotización no trae los
   textos de la ficha, así que se pide el producto completo al hacer clic. */

export default function BotonFichaTecnica({ producto, onError }) {
  const [generando, setGenerando] = useState(false);
  if (!producto?.id) return null;
  const etiqueta = producto.sku || producto.nombre || "el producto";

  async function abrir() {
    if (generando) return;
    setGenerando(true);
    try {
      await abrirFichaTecnica(producto, {
        cargar: async () => {
          const completo = await api.get(`/productos/${producto.id}`).catch(() => null);
          return { ...producto, ...(completo || {}) };
        },
      });
    } catch (e) {
      console.error(e);
      onError?.(`No se pudo generar la ficha técnica de ${etiqueta}.`);
    } finally {
      setGenerando(false);
    }
  }

  return (
    <button
      type="button"
      className="boton-ficha-tecnica"
      onClick={abrir}
      disabled={generando}
      title={`Abrir la ficha técnica de ${etiqueta} (PDF)`}
      aria-label={`Abrir la ficha técnica de ${etiqueta}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "3px 8px",
        borderRadius: 999,
        border: "1px solid #c7d2fe",
        background: "#eef2ff",
        color: "#4338ca",
        fontSize: 11,
        fontWeight: 700,
        cursor: generando ? "wait" : "pointer",
        whiteSpace: "nowrap",
        flexShrink: 0,
      }}
    >
      {generando ? <Loader2 size={11} className="spin" /> : <FileText size={11} />}
      <span className="bft-texto">Ficha</span>
    </button>
  );
}
