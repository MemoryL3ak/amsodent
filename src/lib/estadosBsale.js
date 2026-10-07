import { useEffect, useState } from "react";
import { api } from "./api";

/* Estado en Bsale de facturas, boletas y guías (2026-10-07): carga compartida
   y textos de la etiqueta. El componente que la muestra es
   components/EstadoBsale.jsx. */

let compartida = null; // una sola consulta aunque varias pantallas la pidan

export function useEstadosBsale(activo = true) {
  const [estados, setEstados] = useState(null);
  useEffect(() => {
    if (!activo) return undefined;
    let vivo = true;
    if (!compartida) {
      compartida = api.get("/bsale/facturas/estados").catch(() => null);
      // Pasados 5 minutos la próxima pantalla vuelve a preguntar (el servidor cachea 10).
      setTimeout(() => { compartida = null; }, 5 * 60 * 1000);
    }
    compartida.then((r) => { if (vivo) setEstados(r?.estados || {}); });
    return () => { vivo = false; };
  }, [activo]);
  return estados;
}

export function etiquetaEstadoBsale(e) {
  if (!e) return null;
  const doc = e.clase === "guia" ? "guía" : e.clase === "boleta" ? "boleta" : "factura";
  if (e.estado === "anulado") return { texto: "Anulada en Bsale", tono: "rojo", detalle: `La ${doc} ${e.numero} está anulada en Bsale: no debería contar como ${e.clase === "guia" ? "despachada" : "emitida"}.` };
  if (e.estado === "no_encontrado") return { texto: "No está en Bsale", tono: "gris", detalle: `No hay una ${doc} N° ${e.numero} en Bsale: revisa que el número esté bien escrito.` };
  if (e.sii === "rechazado") return { texto: "Rechazada SII", tono: "rojo", detalle: `El SII rechazó la ${doc} ${e.numero}${e.sii_mensaje ? `: ${e.sii_mensaje}` : "."}` };
  if (e.sii === "enviado") return { texto: "SII pendiente", tono: "ambar", detalle: `La ${doc} ${e.numero} se envió al SII y aún no tiene respuesta.` };
  return null;
}
