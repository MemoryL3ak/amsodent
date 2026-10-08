import { api } from "./api";

/* Guías por facturar (Trazabilidad → Facturas), 2026-10-08.
   Pedido de Ariel: "esta sección se demora mucho en cargar". La pestaña se
   montaba recién cuando Trazabilidad terminaba de traer cotizaciones y
   documentos, y solo entonces pedía las guías por facturar: todo en serie.
   Ahora Trazabilidad la pide apenas sabe que el usuario puede emitir, en
   paralelo con su propia carga, y la pestaña usa esa misma consulta (una
   sola, compartida, vigente 60 s). `refrescar` fuerza una nueva. */
let compartida = null;
let pedidaEn = 0;

export function pedirPendientesFacturar({ refrescar = false } = {}) {
  if (!refrescar && compartida && Date.now() - pedidaEn < 60 * 1000) return compartida;
  pedidaEn = Date.now();
  compartida = api.get("/bsale/facturas/pendientes")
    .then((r) => r?.filas || [])
    .catch((e) => { compartida = null; throw e; });
  return compartida;
}
