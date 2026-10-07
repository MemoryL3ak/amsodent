import { useEffect, useState } from "react";
import { api } from "./api";

/* Estado en Bsale de facturas, boletas y guías (2026-10-07): carga compartida
   y textos de la etiqueta. El componente que la muestra es
   components/EstadoBsale.jsx. */

let compartida = null; // una sola consulta aunque varias pantallas la pidan
const oyentes = new Set(); // pantallas abiertas, para avisarles de un refresco

export function useEstadosBsale(activo = true) {
  const [estados, setEstados] = useState(null);
  useEffect(() => {
    if (!activo) return undefined;
    let vivo = true;
    const oyente = (e) => { if (vivo) setEstados(e); };
    oyentes.add(oyente);
    if (!compartida) {
      compartida = api.get("/bsale/facturas/estados").catch(() => null);
      // Pasados 5 minutos la próxima pantalla vuelve a preguntar (el servidor cachea 10).
      setTimeout(() => { compartida = null; }, 5 * 60 * 1000);
    }
    compartida.then((r) => { if (vivo) setEstados(r?.estados || {}); });
    return () => { vivo = false; oyentes.delete(oyente); };
  }, [activo]);
  return estados;
}

/* Recién emitida una nota de crédito (2026-10-07): el servidor ya la anotó en
   su caché, así que se vuelve a pedir y cada pantalla abierta muestra la
   factura anulada / con NC sin esperar los 5 minutos. */
export function refrescarEstadosBsale() {
  compartida = api.get("/bsale/facturas/estados").catch(() => null);
  compartida.then((r) => { if (r?.estados) for (const f of oyentes) f(r.estados); });
}

export function etiquetaEstadoBsale(e) {
  if (!e) return null;
  const doc = e.clase === "guia" ? "guía" : e.clase === "boleta" ? "boleta" : "factura";
  if (e.estado === "anulado") return { texto: "Anulada en Bsale", tono: "rojo", detalle: `La ${doc} ${e.numero} está anulada en Bsale: no debería contar como ${e.clase === "guia" ? "despachada" : "emitida"}.` };
  // Nota de crédito (2026-10-07): la factura sigue "activa" en Bsale, pero quedó anulada o rebajada.
  if (e.nc?.completa) return { texto: `Anulada con NC ${e.nc.numeros.join(", ")}`.trim(), tono: "rojo", detalle: `La ${doc} ${e.numero} está anulada con nota de crédito${e.nc.numeros.length ? ` N° ${e.nc.numeros.join(", ")}` : ""}: ya no se cobra.` };
  if (e.estado === "no_encontrado") return { texto: "No está en Bsale", tono: "gris", detalle: `No hay una ${doc} N° ${e.numero} en Bsale: revisa que el número esté bien escrito.` };
  if (e.sii === "rechazado") return { texto: "Rechazada SII", tono: "rojo", detalle: `El SII rechazó la ${doc} ${e.numero}${e.sii_mensaje ? `: ${e.sii_mensaje}` : "."}` };
  if (e.nc) return { texto: `NC parcial $${Math.round(e.nc.total).toLocaleString("es-CL")}`, tono: "ambar", detalle: `La ${doc} ${e.numero} tiene nota${e.nc.numeros.length === 1 ? "" : "s"} de crédito${e.nc.numeros.length ? ` N° ${e.nc.numeros.join(", ")}` : ""} por $${Math.round(e.nc.total).toLocaleString("es-CL")} (bruto).` };
  if (e.sii === "enviado") return { texto: "SII pendiente", tono: "ambar", detalle: `La ${doc} ${e.numero} se envió al SII y aún no tiene respuesta.` };
  return null;
}
