import { Receipt } from "lucide-react";

/* Botón «Térmica» (2026-10-09). Pedido de Ariel: "botón para impresión normal
   e impresión térmica". La térmica es el PDF que arma Bsale (rollo de 80 mm):
   se abre en otra pestaña y desde ahí se imprime. Va junto a
   BotonImprimirCarta (formato normal, hoja carta). */
export default function BotonImprimirTermica({ urlPdf, etiqueta = "Térmica", compacto = false, className, style }) {
  if (!urlPdf) return null;
  return (
    <a
      href={urlPdf}
      target="_blank"
      rel="noopener noreferrer"
      className={className || (compacto ? "btn btn-ghost btn-sm boton-termica" : "btn btn-secondary btn-sm boton-termica")}
      title="Imprimir en impresora térmica (rollo de 80 mm, el PDF de Bsale)"
      aria-label="Imprimir en impresora térmica"
      style={{ display: "inline-flex", alignItems: "center", gap: 4, textDecoration: "none", ...(compacto ? { padding: "2px 5px", minHeight: 0 } : {}), ...style }}
    >
      <Receipt size={13} />{compacto ? null : ` ${etiqueta}`}
    </a>
  );
}
