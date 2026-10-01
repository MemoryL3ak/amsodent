/* ============================================================================
   Imágenes de productos para el portal del cliente (2026-10-02)
   ----------------------------------------------------------------------------
   `productos.imagen_url` guarda la RUTA dentro del bucket privado
   `product-images` ("productos/PH00025.png"), no una dirección que el
   navegador pueda abrir. El Showroom la mandaba tal cual al portal, y ahí
   quedaba como imagen rota. Acá se cambia cada ruta por una URL firmada.

   Las firmas se guardan en memoria: una vitrina trae cientos de productos y
   firmarlos todos en cada visita sería una llamada a Storage por cada carga
   de página. La firma dura 12 h y se reutiliza durante 6.
============================================================================ */

const BUCKET = 'product-images';
const DURACION_S = 12 * 3600;
const REUTILIZAR_MS = 6 * 3600 * 1000;

const cache = new Map<string, { url: string; hasta: number }>();

/** Devuelve ruta → URL que el navegador puede abrir. Lo que ya es URL pasa igual. */
export async function firmarImagenesProductos(
  client: any,
  rutas: Array<string | null | undefined>,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const ahora = Date.now();
  const pendientes: string[] = [];
  for (const cruda of new Set(rutas.map((r) => String(r || '').trim()).filter(Boolean))) {
    if (/^https?:\/\//i.test(cruda)) {
      out.set(cruda, cruda);
      continue;
    }
    const guardada = cache.get(cruda);
    if (guardada && guardada.hasta > ahora) out.set(cruda, guardada.url);
    else pendientes.push(cruda);
  }
  for (let i = 0; i < pendientes.length; i += 100) {
    const lote = pendientes.slice(i, i + 100);
    try {
      const { data, error } = await client.storage.from(BUCKET).createSignedUrls(lote, DURACION_S);
      if (error) continue; // sin imagen es mejor que sin vitrina
      for (const fila of data || []) {
        if (!fila?.signedUrl || !fila?.path) continue;
        cache.set(fila.path, { url: fila.signedUrl, hasta: ahora + REUTILIZAR_MS });
        out.set(fila.path, fila.signedUrl);
      }
    } catch {
      /* Storage caído: los productos salen sin imagen. */
    }
  }
  return out;
}
