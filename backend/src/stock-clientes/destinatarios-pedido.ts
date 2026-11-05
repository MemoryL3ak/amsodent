import { variantesRutFicha } from '../bsale/bsale-giros';

/* ── A quién se le avisa un pedido que llega del portal (2026-11-05) ─────────
   Pedido de Ariel: "los pedidos que llegan del portal deben mostrar una
   notificación al administrador y al dueño de la cartera". Hasta ahora el
   aviso iba solo a la lista de `stock_destinatarios` (Monitoreo de Stock →
   Destinatarios), y si esa lista estaba vacía no se avisaba a nadie.
   Ahora la campana (y la ventana flotante) le llega a la unión de:
     · los destinatarios configurados que reciben campana,
     · todos los administradores,
     · el vendedor dueño de la cartera del cliente (clientes.vendedor_asignado).
   El correo sigue saliendo solo a los destinatarios configurados.

   El RUT del cliente se guarda en `clientes` con puntos, con guion o plano:
   se busca por todas sus formas (antes se comparaba el RUT plano con `.eq` y
   casi nunca calzaba). */

type Db = { from: (tabla: string) => any };

const correo = (v: any) => String(v ?? '').trim().toLowerCase();
const esCorreo = (v: string) => /^[^@\s]+@[^@\s]+$/.test(v);

/* Correo del vendedor dueño de la cartera del cliente; null si no tiene. */
export async function vendedorDeCartera(db: Db, rut: any): Promise<string | null> {
  const variantes = variantesRutFicha(rut);
  if (!variantes.length) return null;
  const { data, error } = await db.from('clientes').select('id, vendedor_asignado').in('rut', variantes).order('id', { ascending: true }).limit(10);
  if (error) return null;
  const fila = ((data || []) as any[]).find((c) => esCorreo(correo(c?.vendedor_asignado)));
  return fila ? correo(fila.vendedor_asignado) : null;
}

/* Correos (en minúsculas, sin repetir) que reciben en la campana un pedido del portal. */
export async function destinatariosCampanaPedido(db: Db, rut: any): Promise<string[]> {
  const [configurados, admins, cartera] = await Promise.all([
    db.from('stock_destinatarios').select('user_email, recibe_campana, activo').eq('activo', true),
    db.from('profiles').select('email, rol').or('rol.ilike.admin,rol.ilike.administrador'),
    vendedorDeCartera(db, rut).catch(() => null),
  ]);
  const lista = [
    ...((configurados?.data || []) as any[]).filter((d) => d?.recibe_campana !== false).map((d) => correo(d?.user_email)),
    ...((admins?.data || []) as any[]).map((p) => correo(p?.email)),
    correo(cartera),
  ].filter(esCorreo);
  return [...new Set(lista)];
}
