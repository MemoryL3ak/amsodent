import { useState } from "react";
import { FileText, FileWarning, Loader2 } from "lucide-react";
import { api } from "../lib/api";
import { abrirFichaTecnica } from "../utils/generarFichaTecnica";

/* ── Botón "Ficha" en cada línea de la cotización (2026-10-03) ───────────────
   Pedido de Ariel: "cuando se agregue un producto, que muestre una opción o
   un botón para abrir la ficha técnica". Aparece en la línea cuando el
   producto está en el catálogo (por SKU o por nombre) y abre su ficha técnica
   en PDF en una pestaña nueva. El catálogo que carga la cotización no trae los
   textos de la ficha, así que se pide el producto completo al hacer clic.

   (2026-11-03) `completa` pinta el botón según el estado de la ficha técnica:
   verde = completa, rojo = incompleta (el PDF de la cotización no se emite
   hasta completarla), índigo = no se sabe (el catálogo no trajo el dato). */

const TONOS = {
  completa: { border: "#86efac", background: "#dcfce7", color: "#15803d" },
  incompleta: { border: "#fca5a5", background: "#fee2e2", color: "#b91c1c" },
  neutra: { border: "#c7d2fe", background: "#eef2ff", color: "#4338ca" },
};

export default function BotonFichaTecnica({ producto, completa = null, onError }) {
  const [generando, setGenerando] = useState(false);
  if (!producto?.id) return null;
  const etiqueta = producto.sku || producto.nombre || "el producto";
  const tono = completa === true ? TONOS.completa : completa === false ? TONOS.incompleta : TONOS.neutra;
  const titulo =
    completa === true
      ? `Ficha técnica completa · abrir la ficha de ${etiqueta} (PDF)`
      : completa === false
      ? `Ficha técnica INCOMPLETA de ${etiqueta}: complétala en Productos → Editar. El PDF de la cotización no se puede generar hasta que todas las fichas estén completas. Clic para abrir la ficha como está (PDF).`
      : `Abrir la ficha técnica de ${etiqueta} (PDF)`;

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

  const Icono = completa === false ? FileWarning : FileText;

  return (
    <button
      type="button"
      className="boton-ficha-tecnica"
      data-ficha={completa === true ? "completa" : completa === false ? "incompleta" : "desconocida"}
      onClick={abrir}
      disabled={generando}
      title={titulo}
      aria-label={titulo}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "0 8px",
        height: 20,
        borderRadius: 999,
        border: `1px solid ${tono.border}`,
        background: tono.background,
        color: tono.color,
        fontSize: 11,
        fontWeight: 700,
        cursor: generando ? "wait" : "pointer",
        whiteSpace: "nowrap",
        flexShrink: 0,
      }}
    >
      {generando ? <Loader2 size={11} className="spin" /> : <Icono size={11} />}
      <span className="bft-texto">Ficha</span>
    </button>
  );
}
