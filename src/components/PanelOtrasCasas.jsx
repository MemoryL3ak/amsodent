import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ExternalLink, PackageCheck, Store } from "lucide-react";
import { api } from "../lib/api";
import DropdownSelect from "./ui/DropdownSelect";
import DateFilter from "./DateFilter";
import BotonLimpiarFiltros from "./BotonLimpiarFiltros";
import { ORIGENES_ITEM, fechaChileCorta, metricasOrigen, nombreMes } from "../lib/origenItemPedido";

/* ── Panel «Otras casas dentales» (2026-11-19) ───────────────────────────────
   Pedido de Ariel: «realizar panel para visualizar métricas de % de productos
   que llegan desde otras casas dentales desde el portal cliente».

   Se calcula sobre los pedidos del portal que la bandeja ya tiene cargados
   (lib/origenItemPedido.js): de cada producto pedido se sabe si es nuestro, de
   otra casa dental (hallazgo del Explorador en otra tienda) o del inventario
   del cliente. Muestra el porcentaje, cómo se mueve por mes, de qué casas
   vienen, qué productos se repiten (los candidatos a incorporar al catálogo) y
   qué clientes los piden. Cuenta todos los pedidos, también los cancelados:
   mide lo que llega, no lo que se vende. */

const POR_PAGINA = 10;
const COLOR = Object.fromEntries(ORIGENES_ITEM.map((o) => [o.value, o.color]));
// De abajo hacia arriba en cada columna: lo de otras casas va pegado a la base para compararlo entre meses.
const ORDEN_PILA = ["otra", "amsodent", "inventario"];
const NOMBRE = Object.fromEntries(ORIGENES_ITEM.map((o) => [o.value, o.label]));
const PERIODOS = [
  { value: "", label: "Todo el historial" },
  { value: "30", label: "Últimos 30 días" },
  { value: "90", label: "Últimos 90 días" },
  { value: "180", label: "Últimos 6 meses" },
  { value: "365", label: "Últimos 12 meses" },
  { value: "rango", label: "Entre fechas…" },
];

const num = (n) => Math.round(Number(n) || 0).toLocaleString("es-CL");
const clp = (n) => `$${num(n)}`;
const pct = (p, dec = 1) => (p == null ? "—" : `${p.toLocaleString("es-CL", { minimumFractionDigits: dec, maximumFractionDigits: dec })} %`);
const hoyMenos = (dias) => fechaChileCorta(new Date(Date.now() - dias * 86400000).toISOString());
const tituloSeccion = { fontSize: 13.5, fontWeight: 700, color: "var(--text)", margin: 0, display: "flex", alignItems: "center", gap: 6 };
const subtitulo = { fontSize: 12, color: "var(--text-muted)", margin: "2px 0 10px", lineHeight: 1.45 };
const caja = { border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", background: "var(--surface)", padding: "14px 16px", minWidth: 0 };

function Leyenda() {
  return (
    <div className="leyenda-origen" style={{ display: "flex", gap: "4px 16px", flexWrap: "wrap", fontSize: 12, color: "var(--text-soft, #475569)" }}>
      {ORIGENES_ITEM.map((o) => (
        <span key={o.value} title={o.detalle} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span aria-hidden style={{ width: 10, height: 10, borderRadius: 3, background: o.color, flexShrink: 0 }} /> {o.label}
        </span>
      ))}
    </div>
  );
}

/* Cómo se reparte el total entre los tres orígenes: una barra partida, con su cifra donde cabe. */
function BarraReparto({ lineas }) {
  if (!lineas.total) return null;
  return (
    <div className="barra-reparto" role="img" aria-label={ORIGENES_ITEM.map((o) => `${o.label}: ${lineas[o.value]} de ${lineas.total}`).join("; ")} style={{ display: "flex", gap: 2, height: 30, margin: "10px 0 8px" }}>
      {ORIGENES_ITEM.filter((o) => lineas[o.value] > 0).map((o, i, arr) => {
        const parte = (lineas[o.value] / lineas.total) * 100;
        return (
          <div
            key={o.value}
            title={`${o.label}: ${num(lineas[o.value])} producto(s) · ${pct(parte)}`}
            style={{ flex: `${lineas[o.value]} 1 0`, minWidth: 4, background: o.color, borderRadius: `${i === 0 ? 4 : 0}px ${i === arr.length - 1 ? 4 : 0}px ${i === arr.length - 1 ? 4 : 0}px ${i === 0 ? 4 : 0}px`, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 12, fontWeight: 700, whiteSpace: "nowrap" }}
          >
            {/* La cifra va dentro solo si el tramo es ancho; si no, queda en la leyenda y en la tabla. */}
            {parte >= 14 ? pct(parte, 0) : ""}
          </div>
        );
      })}
    </div>
  );
}

/* Productos pedidos por mes, apilados por origen. Sobre cada columna, el % de otras casas. */
function GraficoMeses({ meses }) {
  const [sobre, setSobre] = useState(null);
  const maximo = Math.max(1, ...meses.map((m) => m.total));
  const ALTO = 150;
  return (
    <div className="grafico-meses" style={{ position: "relative" }}>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: ALTO + 22, borderBottom: "1px solid #c3c2b7", overflowX: "auto", paddingTop: 4 }}>
        {meses.map((m) => {
          const partes = ORDEN_PILA.filter((o) => m[o] > 0);
          const activo = sobre === m.mes;
          return (
            <div
              key={m.mes}
              className="columna-mes"
              tabIndex={0}
              onMouseEnter={() => setSobre(m.mes)}
              onMouseLeave={() => setSobre((s) => (s === m.mes ? null : s))}
              onFocus={() => setSobre(m.mes)}
              onBlur={() => setSobre((s) => (s === m.mes ? null : s))}
              aria-label={`${nombreMes(m.mes)}: ${m.total} productos, ${m.otra} de otras casas dentales (${pct(m.pct)})`}
              style={{ flex: "1 0 44px", maxWidth: 72, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", height: "100%", outline: "none", background: activo ? "rgba(15,23,42,.04)" : "transparent", borderRadius: "6px 6px 0 0", cursor: "default" }}
            >
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-soft, #475569)", marginBottom: 3, fontVariantNumeric: "tabular-nums" }}>{m.pct == null ? "" : pct(m.pct, 0)}</div>
              <div style={{ width: 24, display: "flex", flexDirection: "column-reverse", gap: 2 }}>
                {partes.map((o, i) => (
                  <div key={o} style={{ height: Math.max(3, (m[o] / maximo) * (ALTO - 4 * partes.length)), background: COLOR[o], borderRadius: i === partes.length - 1 ? "4px 4px 0 0" : 0 }} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: 6, overflow: "hidden" }}>
        {meses.map((m) => (
          <div key={m.mes} style={{ flex: "1 0 44px", maxWidth: 72, textAlign: "center", fontSize: 10.5, color: "var(--text-muted)", paddingTop: 4, whiteSpace: "nowrap" }}>{nombreMes(m.mes).replace(" 20", " ’")}</div>
        ))}
      </div>
      {sobre && (() => {
        const m = meses.find((x) => x.mes === sobre);
        if (!m) return null;
        return (
          <div className="tooltip-mes" role="status" style={{ position: "absolute", top: 0, right: 0, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, boxShadow: "var(--shadow-sm)", padding: "8px 12px", fontSize: 12, minWidth: 190, pointerEvents: "none", zIndex: 2 }}>
            <div style={{ fontWeight: 700, marginBottom: 4, textTransform: "capitalize" }}>{nombreMes(m.mes)} · {m.pedidos} pedido{m.pedidos === 1 ? "" : "s"}</div>
            {ORIGENES_ITEM.map((o) => (
              <div key={o.value} style={{ display: "flex", justifyContent: "space-between", gap: 12, color: "var(--text-soft, #475569)" }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><span aria-hidden style={{ width: 9, height: 9, borderRadius: 3, background: o.color }} /> {o.label}</span>
                <b style={{ color: "var(--text)", fontVariantNumeric: "tabular-nums" }}>{num(m[o.value])} · {pct(m.total ? (m[o.value] / m.total) * 100 : null, 0)}</b>
              </div>
            ))}
          </div>
        );
      })()}
    </div>
  );
}

function Paginador({ pagina, total, onCambiar, etiqueta }) {
  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA));
  if (total <= POR_PAGINA) return null;
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "8px 2px 0", fontSize: 12.5, color: "var(--text-soft)" }}>
      <span>{(pagina - 1) * POR_PAGINA + 1}–{Math.min(pagina * POR_PAGINA, total)} de {total.toLocaleString("es-CL")} {etiqueta}</span>
      <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
        <button type="button" className="btn btn-secondary btn-sm" disabled={pagina <= 1} onClick={() => onCambiar(pagina - 1)}>Anterior</button>
        <span>Página {pagina} de {paginas}</span>
        <button type="button" className="btn btn-secondary btn-sm" disabled={pagina >= paginas} onClick={() => onCambiar(pagina + 1)}>Siguiente</button>
      </span>
    </div>
  );
}

export default function PanelOtrasCasas({ pedidos, onAbrirPedido }) {
  const [periodo, setPeriodo] = useState("");
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [pagProductos, setPagProductos] = useState(1);
  const [pagClientes, setPagClientes] = useState(1);
  const [catalogo, setCatalogo] = useState({}); // { [clave del producto]: producto del catálogo | null }

  const rango = useMemo(() => {
    if (periodo === "rango") return { desde, hasta };
    if (periodo) return { desde: hoyMenos(Number(periodo)), hasta: "" };
    return { desde: "", hasta: "" };
  }, [periodo, desde, hasta]);
  const m = useMemo(() => metricasOrigen(pedidos, rango), [pedidos, rango]);
  // Cambiar el período vuelve las tablas a su primera página.
  const alCambiar = (poner) => (v) => { poner(v); setPagProductos(1); setPagClientes(1); };

  /* ¿Cuáles de esos productos ya están creados (como «Temporal» o en el catálogo)? Una sola consulta, de solo lectura. */
  const firma = useMemo(() => m.productos.slice(0, 400).map((p) => p.clave).join("|"), [m.productos]);
  useEffect(() => {
    const lista = m.productos.slice(0, 400);
    if (!lista.length) return undefined;
    let vivo = true;
    api.post("/stock-clientes/explorador/interno/en-catalogo", { items: lista.map((p) => ({ nombre: p.nombre, url: p.url, tienda: p.casa })) })
      .then((r) => {
        if (!vivo) return;
        const productos = Array.isArray(r?.productos) ? r.productos : [];
        setCatalogo(Object.fromEntries(lista.map((p, i) => [p.clave, productos[i] || null])));
      })
      .catch(() => { /* sin esta columna el panel sirve igual */ });
    return () => { vivo = false; };
  }, [firma]); // eslint-disable-line react-hooks/exhaustive-deps

  const creados = m.productos.filter((p) => catalogo[p.clave]).length;
  // Si los pedidos se refrescan y hay menos filas, la página no queda apuntando al vacío.
  const pagP = Math.min(pagProductos, Math.max(1, Math.ceil(m.productos.length / POR_PAGINA)));
  const pagC = Math.min(pagClientes, Math.max(1, Math.ceil(m.clientes.length / POR_PAGINA)));
  const productosPagina = m.productos.slice((pagP - 1) * POR_PAGINA, pagP * POR_PAGINA);
  const clientesPagina = m.clientes.slice((pagC - 1) * POR_PAGINA, pagC * POR_PAGINA);
  const hayFiltro = periodo !== "";
  const maxCasa = Math.max(1, ...m.por_casa.map((c) => c.lineas));

  return (
    <div className="panel-otras-casas">
      <div className="filter-bar" style={{ marginTop: 12, alignItems: "flex-end", gap: 12, flexWrap: "wrap" }}>
        <div className="filter-field" style={{ flex: "0 1 230px", minWidth: 0 }}>
          <label className="filter-label">Período</label>
          <DropdownSelect value={periodo} onChange={alCambiar(setPeriodo)} minWidth={210} style={{ width: "100%" }} options={PERIODOS} />
        </div>
        {periodo === "rango" && (
          <>
            <div className="filter-field">
              <label className="filter-label">Desde</label>
              <DateFilter value={desde} onChange={alCambiar(setDesde)} />
            </div>
            <div className="filter-field">
              <label className="filter-label">Hasta</label>
              <DateFilter value={hasta} onChange={alCambiar(setHasta)} />
            </div>
          </>
        )}
        <BotonLimpiarFiltros hay={hayFiltro} onLimpiar={() => { setPeriodo(""); setDesde(""); setHasta(""); setPagProductos(1); setPagClientes(1); }} />
        <div style={{ flex: "1 1 260px", minWidth: 0, fontSize: 12, color: "var(--text-muted)", lineHeight: 1.45, paddingBottom: 4 }}>
          Cuenta cada producto de cada pedido recibido por el portal (también los cancelados): mide lo que el cliente pide, no lo que se vende.
        </div>
      </div>

      {m.lineas.total === 0 ? (
        <div className="surface" style={{ marginTop: 12, padding: "40px 16px", textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>
          No hay pedidos del portal en este período.
        </div>
      ) : (
        <>
          <div className="stats-row" style={{ marginTop: 12 }}>
            <div className="stat-card kpi-pct-otras">
              <div className="stat-label">Productos de otras casas</div>
              <div className="stat-value">{pct(m.pct_lineas)}</div>
              <div className="stat-sub">{num(m.lineas.otra)} de {num(m.lineas.total)} productos pedidos</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Pedidos que los traen</div>
              <div className="stat-value">{pct(m.pct_pedidos)}</div>
              <div className="stat-sub">{num(m.pedidos_con_otras)} de {num(m.pedidos)} pedidos{m.pedidos_solo_otras ? ` · ${num(m.pedidos_solo_otras)} solo de otras casas` : ""}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">En unidades</div>
              <div className="stat-value">{pct(m.pct_unidades)}</div>
              <div className="stat-sub">{num(m.unidades.otra)} de {num(m.unidades.total)} unidades</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Monto de referencia</div>
              <div className="stat-value">{clp(m.monto.otra)}</div>
              <div className="stat-sub">{pct(m.pct_monto)} de lo pedido con precio (con IVA)</div>
            </div>
          </div>

          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 12, alignItems: "stretch" }}>
            <div style={{ ...caja, flex: "1 1 320px" }}>
              <h3 style={tituloSeccion}>De dónde vienen los productos pedidos</h3>
              <p style={subtitulo}>{num(m.lineas.total)} productos en {num(m.pedidos)} pedido{m.pedidos === 1 ? "" : "s"} del portal.</p>
              <BarraReparto lineas={m.lineas} />
              <Leyenda />
              <table className="data-table tabla-compacta tabla-reparto-origen" style={{ width: "100%", minWidth: 0, tableLayout: "fixed", marginTop: 12, fontSize: 12.5 }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left" }}>Origen</th>
                    <th style={{ textAlign: "right", width: 86 }}>Productos</th>
                    <th style={{ textAlign: "right", width: 70 }}>%</th>
                    <th style={{ textAlign: "right", width: 82 }}>Unidades</th>
                  </tr>
                </thead>
                <tbody>
                  {ORIGENES_ITEM.map((o) => (
                    <tr key={o.value}>
                      <td title={o.detalle}><span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}><span aria-hidden style={{ width: 10, height: 10, borderRadius: 3, background: o.color, flexShrink: 0 }} /> {o.label}</span></td>
                      <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{num(m.lineas[o.value])}</td>
                      <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 700 }}>{pct((m.lineas[o.value] / m.lineas.total) * 100)}</td>
                      <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{num(m.unidades[o.value])}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{ ...caja, flex: "2 1 420px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "baseline" }}>
                <h3 style={tituloSeccion}>Productos pedidos por mes</h3>
                <Leyenda />
              </div>
              <p style={subtitulo}>Sobre cada columna, el porcentaje de productos de otras casas dentales de ese mes.</p>
              <GraficoMeses meses={m.por_mes} />
              <details style={{ marginTop: 10 }}>
                <summary style={{ fontSize: 12, color: "var(--primary-dark, #1e9295)", cursor: "pointer", fontWeight: 600 }}>Ver los números por mes</summary>
                <div className="table-wrap" style={{ marginTop: 8 }}>
                  <table className="data-table tabla-compacta tabla-meses-origen" style={{ width: "100%", minWidth: 0, fontSize: 12.5 }}>
                    <thead>
                      <tr>
                        <th style={{ textAlign: "left" }}>Mes</th>
                        <th style={{ textAlign: "right" }}>Pedidos</th>
                        <th style={{ textAlign: "right" }}>Prod.</th>
                        <th style={{ textAlign: "right" }}>Amsodent</th>
                        <th style={{ textAlign: "right" }} title="Productos de otras casas dentales">Otras</th>
                        <th style={{ textAlign: "right" }} title="Productos del inventario del cliente">Invent.</th>
                        <th style={{ textAlign: "right" }} title="Porcentaje de productos de otras casas dentales">% otras</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...m.por_mes].reverse().map((x) => (
                        <tr key={x.mes}>
                          <td style={{ textTransform: "capitalize" }}>{nombreMes(x.mes)}</td>
                          <td style={{ textAlign: "right" }}>{num(x.pedidos)}</td>
                          <td style={{ textAlign: "right" }}>{num(x.total)}</td>
                          <td style={{ textAlign: "right" }}>{num(x.amsodent)}</td>
                          <td style={{ textAlign: "right" }}>{num(x.otra)}</td>
                          <td style={{ textAlign: "right" }}>{num(x.inventario)}</td>
                          <td style={{ textAlign: "right", fontWeight: 700 }}>{pct(x.pct)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            </div>
          </div>

          {m.lineas.otra === 0 ? (
            <div className="surface" style={{ marginTop: 12, padding: "28px 16px", textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>
              En este período ningún pedido trae productos de otras casas dentales.
            </div>
          ) : (
            <>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 12, alignItems: "flex-start" }}>
                <div style={{ ...caja, flex: "1 1 380px" }}>
                  <h3 style={tituloSeccion}><Store size={14} style={{ flexShrink: 0 }} /> Por casa dental</h3>
                  <p style={subtitulo}>A qué tiendas corresponden los {num(m.lineas.otra)} productos de otras casas.</p>
                  <div className="table-wrap">
                    <table className="data-table tabla-compacta tabla-texto tabla-casas" style={{ width: "100%", minWidth: 360, fontSize: 12.5 }}>
                      <thead>
                        <tr>
                          <th style={{ textAlign: "left" }}>Casa dental</th>
                          <th style={{ textAlign: "left", width: "34%" }}>Productos</th>
                          <th style={{ textAlign: "right" }}>Pedidos</th>
                          <th style={{ textAlign: "right" }}>Monto ref.</th>
                        </tr>
                      </thead>
                      <tbody>
                        {m.por_casa.map((c) => (
                          <tr key={c.clave}>
                            <td>
                              <div style={{ fontWeight: 600 }}>{c.casa}</div>
                              {c.dominio && <a href={`https://${c.dominio}`} target="_blank" rel="noopener noreferrer" className="table-link" style={{ fontSize: 11.5 }}>{c.dominio}</a>}
                            </td>
                            <td>
                              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                <div aria-hidden style={{ flex: "1 1 auto", minWidth: 30 }}>
                                  <div style={{ width: `${Math.max(4, (c.lineas / maxCasa) * 100)}%`, height: 10, background: COLOR.otra, borderRadius: "0 4px 4px 0" }} />
                                </div>
                                <span style={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}><b>{num(c.lineas)}</b> · {pct(c.pct, 0)}</span>
                              </div>
                            </td>
                            <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{num(c.pedidos)}</td>
                            <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{c.monto > 0 ? clp(c.monto) : "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div style={{ ...caja, flex: "1 1 380px" }}>
                  <h3 style={tituloSeccion}>Clientes que los piden</h3>
                  <p style={subtitulo}>Quiénes arman pedidos con productos de otras casas y cuánto pesan en lo que piden.</p>
                  <div className="table-wrap">
                    <table className="data-table tabla-compacta tabla-texto tabla-clientes-otras" style={{ width: "100%", minWidth: 340, tableLayout: "fixed", fontSize: 12.5 }}>
                      <thead>
                        <tr>
                          <th style={{ textAlign: "left" }}>Cliente</th>
                          <th style={{ textAlign: "right", width: 68 }}>Pedidos</th>
                          <th style={{ textAlign: "right", width: 92 }} title="Productos de otras casas dentales, de todos los que pidió">De otras</th>
                          <th style={{ textAlign: "right", width: 64 }} title="Qué parte de lo que pide es de otras casas dentales">%</th>
                        </tr>
                      </thead>
                      <tbody>
                        {clientesPagina.map((c) => (
                          <tr key={c.rut || c.razon_social}>
                            <td style={{ fontWeight: 600, overflowWrap: "anywhere" }}>{c.razon_social}</td>
                            <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{num(c.pedidos)}</td>
                            <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{num(c.otra)} de {num(c.total)}</td>
                            <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 700 }}>{pct(c.pct, 0)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <Paginador pagina={pagC} total={m.clientes.length} onCambiar={setPagClientes} etiqueta="clientes" />
                </div>
              </div>

              <div style={{ ...caja, marginTop: 12 }}>
                <h3 style={tituloSeccion}>Productos pedidos a otras casas dentales</h3>
                <p style={subtitulo}>
                  Los más repetidos primero: son los candidatos a incorporar al catálogo. {num(m.productos.length)} producto{m.productos.length === 1 ? "" : "s"} distinto{m.productos.length === 1 ? "" : "s"}
                  {Object.keys(catalogo).length ? `, ${num(creados)} ya creado${creados === 1 ? "" : "s"} en Productos` : ""}. Para crear uno como «Temporal», abre su pedido.
                </p>
                <div className="table-wrap">
                  <table className="data-table tabla-compacta tabla-texto tabla-productos-otras" style={{ width: "100%", minWidth: 760, tableLayout: "fixed", fontSize: 12.5 }}>
                    <thead>
                      <tr>
                        <th style={{ textAlign: "left" }}>Producto</th>
                        <th style={{ textAlign: "left", width: "16%" }}>Casa dental</th>
                        <th style={{ textAlign: "right", width: 64 }}>Veces</th>
                        <th style={{ textAlign: "right", width: 78 }}>Unidades</th>
                        <th style={{ textAlign: "right", width: 100 }}>Precio ref.</th>
                        <th style={{ textAlign: "left", width: 118 }}>En Productos</th>
                        <th style={{ textAlign: "left", width: 110 }}>Pedidos</th>
                      </tr>
                    </thead>
                    <tbody>
                      {productosPagina.map((p) => {
                        const prod = catalogo[p.clave];
                        const estado = String(prod?.estado || "").toLowerCase();
                        return (
                          <tr key={p.clave}>
                            <td style={{ overflowWrap: "anywhere" }}>
                              {p.nombre}
                              {p.url && (
                                <a href={p.url} target="_blank" rel="noopener noreferrer" className="table-link" style={{ marginLeft: 6, fontWeight: 600, whiteSpace: "nowrap" }} title="Abrir la página del producto en la tienda">
                                  ver <ExternalLink size={11} style={{ verticalAlign: -1 }} />
                                </a>
                              )}
                            </td>
                            <td style={{ overflowWrap: "anywhere" }}>{p.casa}</td>
                            <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 700 }}>{num(p.veces)}</td>
                            <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{num(p.unidades)}</td>
                            <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{p.precio > 0 ? clp(p.precio) : "—"}</td>
                            <td>
                              {prod ? (
                                <Link to={`/productos/editar/${prod.id}`} target="_blank" rel="noopener noreferrer" title={`«${prod.nombre}» · ${prod.estado || "sin estado"}. Abrir el producto en otra pestaña.`} style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "2px 9px", borderRadius: 999, fontSize: 11.5, fontWeight: 700, textDecoration: "none", background: estado === "temporal" ? "#ede9fe" : estado === "transitorio" ? "#fef3c7" : "#dcfce7", color: estado === "temporal" ? "#6d28d9" : estado === "transitorio" ? "#b45309" : "#15803d" }}>
                                  <PackageCheck size={12} /> {estado === "temporal" ? "Temporal" : estado === "transitorio" ? "Transitorio" : "En catálogo"}
                                </Link>
                              ) : (
                                <span style={{ color: "var(--text-muted)" }}>{p.clave in catalogo ? "Sin crear" : "…"}</span>
                              )}
                            </td>
                            <td>
                              <span style={{ display: "inline-flex", gap: "2px 8px", flexWrap: "wrap" }}>
                                {p.pedidos_ids.slice(0, 4).map((id) => (
                                  <button key={id} type="button" onClick={() => onAbrirPedido?.(id)} className="table-link" title={`Abrir el pedido N° ${id} en la bandeja`} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontFamily: "inherit", fontSize: 12.5, fontWeight: 600 }}>
                                    N° {id}
                                  </button>
                                ))}
                                {p.pedidos_ids.length > 4 && <span style={{ color: "var(--text-muted)" }}>+{p.pedidos_ids.length - 4}</span>}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <Paginador pagina={pagP} total={m.productos.length} onCambiar={setPagProductos} etiqueta="productos" />
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
