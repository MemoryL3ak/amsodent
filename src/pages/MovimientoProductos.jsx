import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, Boxes, CalendarDays, ChevronDown, ChevronRight, Download, ExternalLink, FileText, PackageSearch, RefreshCw, Search, Truck } from "lucide-react";
import { api } from "../lib/api";
import { useStickyState } from "../lib/useStickyState";
import BotonLimpiarFiltros from "../components/BotonLimpiarFiltros";
import Toast from "../components/Toast";

/* ── Movimiento diario de productos (2026-11-06) ────────────────────────────
   Pedido de Ariel: "En abastecimiento, crear un módulo de movimiento de
   productos diarios. Esto se debe basar en la creación de las guías de
   despacho según la fecha de creación".

   Qué productos salieron cada día y cuántas unidades, según las guías de
   despacho emitidas en Bsale (por su fecha de emisión). El servidor las lee de
   Bsale y arma el resumen (backend/src/gestion-compras/movimiento-productos).
   Dos vistas: «Por día» (una fila por día; el detalle trae los productos y
   las guías de ese día) y «Por producto» (el total del período). Excel con
   ambas. Entra quien tiene Gestión de compras. */

const POR_PAGINA = 15;
const clp = (n) => `$${Math.round(Number(n) || 0).toLocaleString("es-CL")}`;
const num = (n) => (n == null ? "—" : Number(n).toLocaleString("es-CL", { maximumFractionDigits: 2 }));
const sinTildes = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const diaCorto = (ymd) => {
  const m = String(ymd || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : "—";
};
const diaSemana = (ymd) => {
  const d = new Date(`${ymd}T12:00:00`);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("es-CL", { weekday: "long" });
};

function Paginador({ pagina, total, onCambiar, etiqueta }) {
  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA));
  if (total <= POR_PAGINA) return null;
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "10px 4px", fontSize: 12.5, color: "var(--text-soft)" }}>
      <span>{(pagina - 1) * POR_PAGINA + 1}–{Math.min(pagina * POR_PAGINA, total)} de {total.toLocaleString("es-CL")} {etiqueta}</span>
      <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
        <button type="button" className="btn btn-secondary btn-sm" disabled={pagina <= 1} onClick={() => onCambiar(pagina - 1)}>Anterior</button>
        <span>Página {pagina} de {paginas}</span>
        <button type="button" className="btn btn-secondary btn-sm" disabled={pagina >= paginas} onClick={() => onCambiar(pagina + 1)}>Siguiente</button>
      </span>
    </div>
  );
}

// Nombre del producto: abre Editar Producto en otra pestaña cuando está en el catálogo.
function Producto({ p }) {
  return (
    <>
      <div style={{ fontWeight: 600, overflowWrap: "anywhere" }}>
        {p.producto_id
          ? <Link to={`/productos/editar/${p.producto_id}`} target="_blank" rel="noopener noreferrer" className="table-link" onClick={(e) => e.stopPropagation()} title="Abrir el producto en una pestaña nueva">{p.producto}</Link>
          : p.producto}
      </div>
      <div style={{ fontSize: 11.5, color: "var(--text-muted)", fontFamily: 'Consolas, "SFMono-Regular", monospace' }}>{p.sku || "Sin SKU"}</div>
    </>
  );
}

export default function MovimientoProductos() {
  const [desde, setDesde] = useStickyState("movimientoProductos.desde", "");
  const [hasta, setHasta] = useStickyState("movimientoProductos.hasta", "");
  const [vista, setVista] = useStickyState("movimientoProductos.vista", "dias");
  const [q, setQ] = useState("");
  const [datos, setDatos] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [toast, setToast] = useState(null);
  const [pagina, setPagina] = useState(1);
  const [abierto, setAbierto] = useState(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError("");
    try {
      const qs = new URLSearchParams();
      if (desde) qs.set("desde", desde);
      if (hasta) qs.set("hasta", hasta);
      setDatos(await api.get(`/gestion-compras/movimiento-diario${qs.toString() ? `?${qs}` : ""}`));
    } catch (e) {
      setError(e?.message || "No se pudo cargar el movimiento de productos.");
    } finally {
      setCargando(false);
    }
  }, [desde, hasta]);
  useEffect(() => { cargar(); }, [cargar]);
  useEffect(() => { setPagina(1); setAbierto(null); }, [desde, hasta, vista, q]);

  const texto = sinTildes(q.trim());
  // Por día: con búsqueda, cada día conserva solo los productos y guías que calzan.
  const dias = useMemo(() => {
    const lista = datos?.dias || [];
    if (!texto) return lista;
    return lista
      .map((d) => {
        const guias = d.detalle_guias.filter((g) => sinTildes(`${g.numero} ${g.cliente} ${g.rut} #${g.cotizacion_id || ""}`).includes(texto));
        const numeros = new Set(guias.map((g) => g.numero));
        const productos = d.detalle_productos.filter((p) => sinTildes(`${p.sku} ${p.producto}`).includes(texto) || p.guias.some((n) => numeros.has(n)));
        return productos.length || guias.length ? { ...d, filtrado: true, detalle_productos: productos, detalle_guias: guias.length ? guias : d.detalle_guias.filter((g) => productos.some((p) => p.guias.includes(g.numero))) } : null;
      })
      .filter(Boolean);
  }, [datos, texto]);
  const productos = useMemo(() => (datos?.productos || []).filter((p) => !texto || sinTildes(`${p.sku} ${p.producto}`).includes(texto)), [datos, texto]);

  const lista = vista === "productos" ? productos : dias;
  const paginaActual = Math.min(pagina, Math.max(1, Math.ceil(lista.length / POR_PAGINA)));
  const visibles = lista.slice((paginaActual - 1) * POR_PAGINA, paginaActual * POR_PAGINA);
  const t = datos?.totales;
  const hayFiltros = !!desde || !!hasta || !!q.trim();

  async function exportar() {
    try {
      const XLSX = await import("xlsx");
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(dias.flatMap((d) => d.detalle_productos.map((p) => ({
        Fecha: diaCorto(d.fecha), Día: diaSemana(d.fecha), SKU: p.sku || "Sin SKU", Producto: p.producto, Unidades: p.unidades, "Neto despachado": p.neto, Guías: p.guias.join(", "),
      })))), "Por día y producto");
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(productos.map((p) => ({
        SKU: p.sku || "Sin SKU", Producto: p.producto, Unidades: p.unidades, "Días con movimiento": p.dias, Guías: p.guias, "Neto despachado": p.neto,
      }))), "Por producto");
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(dias.flatMap((d) => d.detalle_guias.map((g) => ({
        Fecha: diaCorto(d.fecha), "Guía N°": g.numero, Cliente: g.cliente, RUT: g.rut, Sucursal: g.sucursal, Líneas: g.lineas, Unidades: g.unidades, Neto: g.neto,
        Cotización: g.cotizacion_id ? `#${g.cotizacion_id}` : "", Anulada: g.anulada ? "Sí" : "",
      })))), "Guías");
      XLSX.writeFile(wb, `movimiento-productos-${datos?.desde || ""}-a-${datos?.hasta || ""}.xlsx`);
    } catch (err) {
      setToast({ type: "error", message: err?.message || "No se pudo exportar." });
    }
  }

  return (
    <div className="page pagina-movimiento-productos">
      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}
      <div className="page-header">
        <div style={{ minWidth: 0 }}>
          <h1 className="page-title">Movimiento diario de productos</h1>
          <p className="page-subtitle">Qué productos salieron cada día, según las guías de despacho emitidas en Bsale (por la fecha de la guía).</p>
        </div>
        <div className="page-actions" style={{ flexWrap: "wrap" }}>
          <button type="button" className="btn btn-secondary" onClick={exportar} disabled={!lista.length} style={{ display: "inline-flex", alignItems: "center", gap: 6 }} title="Descargar el período en Excel: por día y producto, por producto y las guías">
            <Download size={14} /> Excel
          </button>
          <button type="button" className="btn btn-secondary" onClick={cargar} disabled={cargando} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <RefreshCw size={14} className={cargando ? "spin" : ""} /> Actualizar
          </button>
        </div>
      </div>

      {error && <div style={{ fontSize: 13, color: "#991b1b", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 10, padding: "10px 14px", marginBottom: 14 }}>{error}</div>}
      {datos?.disponible === false && (
        <div style={{ display: "flex", gap: 10, fontSize: 13, color: "#78350f", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 10, padding: "10px 14px", marginBottom: 14 }}>
          <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 1, color: "#d97706" }} /> No se pudo leer Bsale: {datos.motivo}
        </div>
      )}

      <div className="stats-row">
        <div className="stat-card">
          <div className="stat-label" style={{ display: "flex", alignItems: "center", gap: 6 }}><Truck size={14} /> Guías emitidas</div>
          <div className="stat-value">{num(t?.guias ?? 0)}</div>
          <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 2 }}>en {num(t?.dias ?? 0)} día{t?.dias === 1 ? "" : "s"} con movimiento{t?.anuladas ? ` · ${num(t.anuladas)} anulada${t.anuladas === 1 ? "" : "s"} (no cuenta${t.anuladas === 1 ? "" : "n"})` : ""}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label" style={{ display: "flex", alignItems: "center", gap: 6 }}><PackageSearch size={14} /> Productos distintos</div>
          <div className="stat-value">{num(t?.productos ?? 0)}</div>
          <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 2 }}>con salida en el período</div>
        </div>
        <div className="stat-card">
          <div className="stat-label" style={{ display: "flex", alignItems: "center", gap: 6 }}><Boxes size={14} /> Unidades despachadas</div>
          <div className="stat-value">{num(t?.unidades ?? 0)}</div>
          <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 2 }}>{t?.dias ? `${num(Math.round((t.unidades / t.dias) * 10) / 10)} por día con movimiento` : "—"}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label" style={{ display: "flex", alignItems: "center", gap: 6 }}><FileText size={14} /> Neto despachado</div>
          <div className="stat-value">{clp(t?.neto ?? 0)}</div>
          <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 2 }}>valor neto de las guías</div>
        </div>
      </div>

      <div className="pagos-tabs" role="tablist" aria-label="Vista del movimiento de productos">
        {[
          { value: "dias", label: "Por día", n: dias.length, Icono: CalendarDays },
          { value: "productos", label: "Por producto", n: productos.length, Icono: PackageSearch },
        ].map((p) => (
          <button key={p.value} type="button" role="tab" aria-selected={vista === p.value} className={vista === p.value ? "activo" : ""} onClick={() => setVista(p.value)}>
            <p.Icono size={15} /> {p.label} <span className="pagos-tab-n">{num(p.n)}</span>
          </button>
        ))}
      </div>

      <div className="filter-bar" style={{ alignItems: "flex-end", gap: 12, flexWrap: "wrap" }}>
        <div className="filter-field" style={{ flex: "2 1 240px", minWidth: 0 }}>
          <label className="filter-label">Buscar</label>
          <span style={{ position: "relative", display: "block" }}>
            <Search size={14} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)", pointerEvents: "none" }} />
            <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder={vista === "productos" ? "SKU o producto…" : "SKU, producto, cliente, N° de guía o #cotización…"} style={{ width: "100%", paddingLeft: 30 }} />
          </span>
        </div>
        <div className="filter-field" style={{ flex: "0 1 170px", minWidth: 140 }}>
          <label className="filter-label">Desde</label>
          <input type="date" className="input" value={desde || datos?.desde || ""} max={hasta || datos?.hoy || undefined} onChange={(e) => setDesde(e.target.value)} />
        </div>
        <div className="filter-field" style={{ flex: "0 1 170px", minWidth: 140 }}>
          <label className="filter-label">Hasta</label>
          <input type="date" className="input" value={hasta || datos?.hasta || ""} min={desde || undefined} max={datos?.hoy || undefined} onChange={(e) => setHasta(e.target.value)} />
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginLeft: "auto" }}>
          <BotonLimpiarFiltros hay={hayFiltros} onLimpiar={() => { setDesde(""); setHasta(""); setQ(""); }} />
        </div>
      </div>
      <div style={{ fontSize: 12, color: "var(--text-muted)", margin: "8px 2px 10px" }}>
        Sin fechas se muestran los últimos 7 días; cada consulta admite hasta {datos?.max_dias || 62} días.
      </div>

      <div className="table-wrap">
        {vista === "productos" ? (
          <table className="data-table tabla-compacta tabla-texto tabla-movimiento-productos" style={{ minWidth: 620 }}>
            <thead>
              <tr>
                <th>Producto</th>
                <th style={{ textAlign: "right" }}>Unidades</th>
                <th style={{ textAlign: "right" }} title="En cuántos días del período tuvo salida">Días</th>
                <th style={{ textAlign: "right" }}>Guías</th>
                <th style={{ textAlign: "right" }}>Neto despachado</th>
              </tr>
            </thead>
            <tbody>
              {cargando && !datos && <tr><td colSpan={5} style={{ textAlign: "center", padding: "40px 0", color: "var(--text-muted)" }}>Leyendo las guías de Bsale…</td></tr>}
              {datos && productos.length === 0 && <tr><td colSpan={5} style={{ textAlign: "center", padding: "40px 16px", color: "var(--text-muted)" }}>{(datos.productos || []).length ? "Ningún producto calza con la búsqueda." : `Entre el ${diaCorto(datos.desde)} y el ${diaCorto(datos.hasta)} no se emitieron guías de despacho.`}</td></tr>}
              {visibles.map((p) => (
                <tr key={p.clave}>
                  <td style={{ minWidth: 220 }}><Producto p={p} /></td>
                  <td style={{ textAlign: "right", fontWeight: 700, whiteSpace: "nowrap" }}>{num(p.unidades)}</td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>{num(p.dias)}</td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>{num(p.guias)}</td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>{clp(p.neto)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <table className="data-table tabla-compacta tabla-texto tabla-movimiento-dias" style={{ minWidth: 620 }}>
            <thead>
              <tr>
                <th style={{ width: 28 }} aria-label="Detalle" />
                <th>Día</th>
                <th style={{ textAlign: "right" }}>Guías</th>
                <th style={{ textAlign: "right" }}>Productos</th>
                <th style={{ textAlign: "right" }}>Unidades</th>
                <th style={{ textAlign: "right" }}>Neto despachado</th>
              </tr>
            </thead>
            <tbody>
              {cargando && !datos && <tr><td colSpan={6} style={{ textAlign: "center", padding: "40px 0", color: "var(--text-muted)" }}>Leyendo las guías de Bsale…</td></tr>}
              {datos && dias.length === 0 && <tr><td colSpan={6} style={{ textAlign: "center", padding: "40px 16px", color: "var(--text-muted)" }}>{(datos.dias || []).length ? "Nada calza con la búsqueda." : `Entre el ${diaCorto(datos.desde)} y el ${diaCorto(datos.hasta)} no se emitieron guías de despacho.`}</td></tr>}
              {visibles.map((d) => {
                const ab = abierto === d.fecha;
                return (
                  <Fragment key={d.fecha}>
                    <tr className="fila-dia-movimiento" onClick={() => setAbierto(ab ? null : d.fecha)} style={{ cursor: "pointer", background: ab ? "var(--bg)" : undefined }} title={ab ? "Ocultar el detalle" : "Ver los productos y las guías del día"}>
                      <td style={{ color: "var(--text-muted)" }}>{ab ? <ChevronDown size={15} /> : <ChevronRight size={15} />}</td>
                      <td>
                        <div style={{ fontWeight: 700, whiteSpace: "nowrap" }}>{diaCorto(d.fecha)}</div>
                        <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>{diaSemana(d.fecha)}{d.filtrado ? " · filtrado por la búsqueda" : ""}</div>
                      </td>
                      <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>{num(d.guias)}{d.anuladas ? <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>+{d.anuladas} anulada{d.anuladas === 1 ? "" : "s"}</div> : null}</td>
                      <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>{num(d.productos)}</td>
                      <td style={{ textAlign: "right", fontWeight: 700, whiteSpace: "nowrap" }}>{num(d.unidades)}</td>
                      <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>{clp(d.neto)}</td>
                    </tr>
                    {ab && (
                      <tr className="detalle-dia-movimiento">
                        <td colSpan={6} style={{ background: "var(--bg)", padding: "12px 14px" }}>
                          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-start" }}>
                            <div style={{ flex: "3 1 380px", minWidth: 0 }}>
                              <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".4px", color: "var(--text-muted)", marginBottom: 6 }}>Productos que salieron ({d.detalle_productos.length})</div>
                              <div className="table-wrap" style={{ margin: 0 }}>
                                <table className="data-table tabla-compacta tabla-texto" style={{ minWidth: 380 }}>
                                  <thead>
                                    <tr>
                                      <th>Producto</th>
                                      <th style={{ textAlign: "right" }}>Unidades</th>
                                      <th style={{ textAlign: "right" }}>Neto</th>
                                      <th>Guías</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {d.detalle_productos.map((p) => (
                                      <tr key={p.clave}>
                                        <td style={{ minWidth: 180 }}><Producto p={p} /></td>
                                        <td style={{ textAlign: "right", fontWeight: 700, whiteSpace: "nowrap" }}>{num(p.unidades)}</td>
                                        <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>{clp(p.neto)}</td>
                                        <td style={{ fontSize: 12, color: "var(--text-soft)", maxWidth: 120, overflowWrap: "anywhere" }}>{p.guias.join(", ")}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                            <div style={{ flex: "2 1 320px", minWidth: 0 }}>
                              <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".4px", color: "var(--text-muted)", marginBottom: 6 }}>Guías de despacho ({d.detalle_guias.length})</div>
                              <div className="table-wrap" style={{ margin: 0 }}>
                                <table className="data-table tabla-compacta tabla-texto" style={{ minWidth: 320 }}>
                                  <thead>
                                    <tr>
                                      <th>Guía</th>
                                      <th>Cliente</th>
                                      <th style={{ textAlign: "right" }}>Unid.</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {d.detalle_guias.map((g) => (
                                      <tr key={g.id} style={{ opacity: g.anulada ? 0.55 : 1 }}>
                                        <td style={{ whiteSpace: "nowrap" }}>
                                          {g.url_pdf
                                            ? <a href={g.url_pdf} target="_blank" rel="noreferrer" className="table-link" title="Abrir el PDF de la guía">N° {g.numero} <ExternalLink size={11} style={{ display: "inline", verticalAlign: "-1px" }} /></a>
                                            : <>N° {g.numero}</>}
                                          {g.anulada && <div style={{ fontSize: 10.5, fontWeight: 700, color: "#b91c1c" }}>anulada</div>}
                                          {g.cotizacion_id && <div><Link to={`/detalle/${g.cotizacion_id}`} target="_blank" rel="noopener noreferrer" className="table-link" style={{ fontSize: 11.5 }} title="Abrir la cotización en una pestaña nueva">#{g.cotizacion_id}</Link></div>}
                                        </td>
                                        <td style={{ maxWidth: 200, overflowWrap: "anywhere" }}>
                                          {g.cliente || "—"}
                                          <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>{clp(g.neto)} neto · {g.lineas} línea{g.lineas === 1 ? "" : "s"}</div>
                                        </td>
                                        <td style={{ textAlign: "right", fontWeight: 700, whiteSpace: "nowrap" }}>{num(g.unidades)}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      <Paginador pagina={paginaActual} total={lista.length} onCambiar={(p) => { setPagina(p); setAbierto(null); }} etiqueta={vista === "productos" ? "productos" : "días"} />
    </div>
  );
}
