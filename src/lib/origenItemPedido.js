/* ── De dónde viene cada producto de un pedido del portal (2026-11-19) ────────
   Pedidos de Ariel:
     · los productos de OTRA casa dental que llegan en un pedido se crean como
       «Temporal», no como transitorios;
     · «panel para visualizar métricas de % de productos que llegan desde otras
       casas dentales desde el portal cliente».

   Cada línea de un pedido viene de uno de tres lados:
     · amsodent    → lo nuestro: la web de Amsodent en el Explorador, el
                     Showroom y las Ofertas especiales;
     · otra        → un hallazgo del Explorador en la tienda de otra casa dental
                     (trae el nombre de esa tienda y su link);
     · inventario  → lo que el cliente pide desde su propio inventario (Gestión
                     de Stock): no trae tienda ni link.
   Mismo criterio que `esDeOtraCasa` del servidor (explorador-productos.service.ts).
   Aquí solo hay cálculo (sin pantalla ni red) para poder probarlo. */

export const ORIGENES_ITEM = [
  { value: "amsodent", label: "Amsodent", detalle: "Nuestra web, Showroom y Ofertas", color: "#2a78d6" },
  { value: "otra", label: "Otras casas dentales", detalle: "Hallazgos del Explorador en otras tiendas", color: "#eb6834" },
  { value: "inventario", label: "Inventario del cliente", detalle: "Pedido desde Gestión de Stock, sin tienda", color: "#1baf7a" },
];

const txt = (v) => String(v ?? "").trim();
const conLink = (url) => /^https?:\/\//i.test(txt(url));

export function origenDeItem(i) {
  const tienda = txt(i?.tienda);
  const url = txt(i?.url);
  if (i?.oferta || i?.oferta_id || /^oferta\b/i.test(tienda)) return "amsodent";
  if (/amsodent/i.test(tienda) || /amsodentmedical\.cl/i.test(url)) return "amsodent";
  if (/^mi inventario$/i.test(tienda)) return "inventario";
  if (!tienda && !conLink(url)) return "inventario";
  return "otra";
}

export const esDeOtraCasa = (i) => origenDeItem(i) === "otra";

/** Nombre de la casa dental de una línea: el de la tienda o, si falta, el dominio del link. */
export function casaDeItem(i) {
  const tienda = txt(i?.tienda);
  if (tienda) return tienda;
  try {
    return new URL(txt(i?.url)).hostname.replace(/^www\./, "");
  } catch {
    return "Sin nombre";
  }
}

const dominioDe = (url) => {
  try {
    return new URL(txt(url)).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
};
// El link de la variante elegida termina en #v<id>: es el mismo producto de la tienda.
const linkBase = (url) => txt(url).split("#")[0].split("?")[0].replace(/\/+$/, "").toLowerCase();
const normNombre = (s) => txt(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ");
const pct = (parte, total) => (total > 0 ? (parte / total) * 100 : null);
const vacio = () => ({ amsodent: 0, otra: 0, inventario: 0, total: 0 });
const sumar = (acum, origen, n) => { acum[origen] += n; acum.total += n; };

/**
 * Métricas de origen de los productos de los pedidos del portal.
 * @param pedidos  los pedidos (con `items`, `created_at`, `rut`, `razon_social`)
 * @param periodo  { desde, hasta } en 'YYYY-MM-DD' (hora de Chile); vacío = sin límite
 */
export function metricasOrigen(pedidos, periodo = {}) {
  const desde = txt(periodo.desde);
  const hasta = txt(periodo.hasta);
  const lineas = vacio();
  const unidades = vacio();
  const monto = vacio(); // precio de referencia × cantidad (con IVA, lo que vio el cliente)
  const meses = new Map();
  const casas = new Map();
  const productos = new Map();
  const clientes = new Map();
  let nPedidos = 0;
  let pedidosConOtras = 0;
  let pedidosSoloOtras = 0;

  for (const p of Array.isArray(pedidos) ? pedidos : []) {
    const items = (Array.isArray(p?.items) ? p.items : []).filter((i) => txt(i?.nombre));
    if (!items.length) continue;
    const dia = fechaChileCorta(p?.created_at);
    if (desde && dia && dia < desde) continue;
    if (hasta && dia && dia > hasta) continue;
    nPedidos++;
    const mes = dia ? dia.slice(0, 7) : "sin fecha";
    if (!meses.has(mes)) meses.set(mes, { mes, pedidos: 0, ...vacio() });
    const m = meses.get(mes);
    m.pedidos++;
    const claveCliente = txt(p?.rut).replace(/[^0-9kK]/g, "").toUpperCase() || `pedido-${p?.id}`;
    if (!clientes.has(claveCliente)) clientes.set(claveCliente, { rut: txt(p?.rut), razon_social: txt(p?.razon_social) || "Cliente sin nombre", pedidos: 0, ...vacio() });
    const c = clientes.get(claveCliente);
    c.pedidos++;
    let otrasEnPedido = 0;

    for (const i of items) {
      const origen = origenDeItem(i);
      const cant = Math.max(0, Number(i?.cantidad) || 0);
      const valor = (Number(i?.precio_referencia) || 0) * cant;
      sumar(lineas, origen, 1);
      sumar(unidades, origen, cant);
      sumar(monto, origen, valor);
      sumar(m, origen, 1);
      sumar(c, origen, 1);
      if (origen !== "otra") continue;
      otrasEnPedido++;
      const nombreCasa = casaDeItem(i);
      const claveCasa = dominioDe(i?.url) || nombreCasa.toLowerCase();
      if (!casas.has(claveCasa)) casas.set(claveCasa, { clave: claveCasa, casa: nombreCasa, dominio: dominioDe(i?.url), lineas: 0, unidades: 0, monto: 0, pedidos: new Set() });
      const k = casas.get(claveCasa);
      k.lineas++; k.unidades += cant; k.monto += valor; k.pedidos.add(p.id);
      const claveProd = conLink(i?.url) ? linkBase(i.url) : `${claveCasa}|${normNombre(i?.nombre)}`;
      if (!productos.has(claveProd)) productos.set(claveProd, { clave: claveProd, nombre: txt(i?.nombre), casa: nombreCasa, url: conLink(i?.url) ? txt(i.url).split("#")[0] : "", sku_tienda: txt(i?.sku), veces: 0, unidades: 0, monto: 0, precio: 0, pedidos: new Set(), ultimo: "" });
      const pr = productos.get(claveProd);
      pr.veces++; pr.unidades += cant; pr.monto += valor; pr.pedidos.add(p.id);
      if (Number(i?.precio_referencia) > 0) pr.precio = Number(i.precio_referencia);
      if (dia > pr.ultimo) pr.ultimo = dia;
    }
    if (otrasEnPedido > 0) pedidosConOtras++;
    if (otrasEnPedido === items.length) pedidosSoloOtras++;
  }

  const cerrar = (x) => ({ ...x, pedidos: x.pedidos.size, pedidos_ids: [...x.pedidos].sort((a, b) => b - a) });
  return {
    pedidos: nPedidos,
    pedidos_con_otras: pedidosConOtras,
    pedidos_solo_otras: pedidosSoloOtras,
    lineas,
    unidades,
    monto,
    // El % que pide Ariel: de todos los productos que llegan, cuántos son de otras casas.
    pct_lineas: pct(lineas.otra, lineas.total),
    pct_unidades: pct(unidades.otra, unidades.total),
    // El monto solo existe donde hay precio de referencia: lo del inventario del cliente no lo trae.
    pct_monto: pct(monto.otra, monto.amsodent + monto.otra),
    pct_pedidos: pct(pedidosConOtras, nPedidos),
    por_mes: [...meses.values()].sort((a, b) => a.mes.localeCompare(b.mes)).map((x) => ({ ...x, pct: pct(x.otra, x.total) })),
    por_casa: [...casas.values()].map(cerrar).sort((a, b) => b.lineas - a.lineas || b.monto - a.monto).map((x) => ({ ...x, pct: pct(x.lineas, lineas.otra) })),
    productos: [...productos.values()].map(cerrar).sort((a, b) => b.veces - a.veces || b.unidades - a.unidades || b.ultimo.localeCompare(a.ultimo)),
    clientes: [...clientes.values()].filter((x) => x.otra > 0).sort((a, b) => b.otra - a.otra || b.total - a.total).map((x) => ({ ...x, pct: pct(x.otra, x.total) })),
  };
}

/** 'YYYY-MM-DD' del instante en hora de Chile ('' si no es una fecha). */
export function fechaChileCorta(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  // en-CA entrega AAAA-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
/** '2026-11' → 'nov 2026'. */
export const nombreMes = (mes) => {
  const m = /^(\d{4})-(\d{2})$/.exec(String(mes || ""));
  return m ? `${MESES[Number(m[2]) - 1] || m[2]} ${m[1]}` : String(mes || "");
};
