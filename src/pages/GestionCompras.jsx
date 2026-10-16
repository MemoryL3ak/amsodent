import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronDown, ChevronRight, ClipboardList, RefreshCw, Search, ShoppingCart } from "lucide-react";
import { api } from "../lib/api";
import { useStickyState } from "../lib/useStickyState";
import DropdownSelect from "../components/ui/DropdownSelect";
import BotonLimpiarFiltros from "../components/BotonLimpiarFiltros";

/* ── Gestión de compras (2026-10-16) ─────────────────────────────────────────
   Pedido de Ariel: las cotizaciones adjudicadas desde ahora en adelante, con
   lo que falta despachar de cada producto contra el stock del inventario y el
   porcentaje (por unidades) que tenemos para despacharlas al 100 %. El stock
   se reparte por orden de adjudicación (la más antigua primero) y lo que no
   alcanza va a «Por comprar». El cálculo vive en el backend
   (gestion-compras.service.ts). */

const POR_PAGINA = 20;
const clp = (n) => `$${Math.round(Number(n) || 0).toLocaleString("es-CL")}`;
const num = (n) => (n == null ? "—" : Number(n).toLocaleString("es-CL"));
const fechaCL = (iso) => {
  const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : "—";
};
const sinTildes = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const ESTADOS = {
  lista: { texto: "Stock completo", color: "#15803d", bg: "#dcfce7" },
  parcial: { texto: "Stock parcial", color: "#92400e", bg: "#fef3c7" },
  sin_stock: { texto: "Sin stock", color: "#b91c1c", bg: "#fee2e2" },
  despachada: { texto: "Despachada", color: "#475569", bg: "#f1f5f9" },
  sin_items: { texto: "Sin productos", color: "#475569", bg: "#f1f5f9" },
};
const pastilla = (e) => ({ display: "inline-block", padding: "2px 8px", borderRadius: 999, fontSize: 11.5, fontWeight: 700, color: e.color, background: e.bg, whiteSpace: "nowrap" });
const colorCobertura = (c) => (c >= 100 ? "#15803d" : c >= 50 ? "#b45309" : "#b91c1c");

function Barra({ valor }) {
  const v = Math.max(0, Math.min(100, Number(valor) || 0));
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
      <div style={{ flex: "1 1 60px", minWidth: 40, height: 7, borderRadius: 999, background: "#eef2f6", overflow: "hidden" }}>
        <div style={{ width: `${v}%`, height: "100%", background: colorCobertura(v), borderRadius: 999 }} />
      </div>
      <span style={{ fontWeight: 700, fontSize: 12.5, color: colorCobertura(v), whiteSpace: "nowrap" }}>{Number(valor).toLocaleString("es-CL")} %</span>
    </div>
  );
}

function Paginacion({ pagina, total, onCambiar, nombre }) {
  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA));
  if (total <= POR_PAGINA) return null;
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "10px 4px", fontSize: 12.5, color: "var(--text-muted)" }}>
      <span>{((pagina - 1) * POR_PAGINA + 1).toLocaleString("es-CL")}–{Math.min(total, pagina * POR_PAGINA).toLocaleString("es-CL")} de {total.toLocaleString("es-CL")} {nombre}</span>
      <span style={{ display: "flex", gap: 6 }}>
        <button type="button" className="btn btn-secondary btn-sm" disabled={pagina <= 1} onClick={() => onCambiar(pagina - 1)}>Anterior</button>
        <button type="button" className="btn btn-secondary btn-sm" disabled={pagina >= paginas} onClick={() => onCambiar(pagina + 1)}>Siguiente</button>
      </span>
    </div>
  );
}

export default function GestionCompras() {
  const [datos, setDatos] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [pestana, setPestana] = useStickyState("gestionCompras.pestana", "cotizaciones");
  const [q, setQ] = useStickyState("gestionCompras.q", "");
  const [estado, setEstado] = useStickyState("gestionCompras.estado", "pendientes");
  const [abierta, setAbierta] = useState(null);
  const [pagina, setPagina] = useState(1);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError("");
    try {
      setDatos(await api.get("/gestion-compras"));
    } catch (e) {
      setError(e?.message || "No se pudo cargar la gestión de compras.");
    } finally {
      setCargando(false);
    }
  }, []);
  useEffect(() => { cargar(); }, [cargar]);
  useEffect(() => { setPagina(1); }, [q, estado, pestana]);

  const texto = sinTildes(q.trim());
  const cotizaciones = useMemo(() => (datos?.cotizaciones || []).filter((c) => {
    if (estado === "pendientes" && (c.estado === "despachada" || c.estado === "sin_items")) return false;
    if (estado !== "pendientes" && estado !== "todas" && c.estado !== estado) return false;
    if (texto && !sinTildes(`${c.id} ${c.codigo || ""} ${c.cliente} ${c.rut} ${c.vendedor} ${c.productos.map((p) => `${p.sku} ${p.producto}`).join(" ")}`).includes(texto)) return false;
    return true;
  }), [datos, estado, texto]);
  const compras = useMemo(() => (datos?.compras || []).filter((e) => !texto || sinTildes(`${e.sku} ${e.producto} ${e.cotizaciones.join(" ")}`).includes(texto)), [datos, texto]);
  const lista = pestana === "compras" ? compras : cotizaciones;
  const visibles = lista.slice((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA);
  const k = datos?.kpis;
  const hayFiltros = !!q.trim() || estado !== "pendientes";

  return (
    <div className="page-container gestion-compras">
      <div className="page-header" style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div style={{ minWidth: 0 }}>
          <h1 className="page-title">Gestión de compras</h1>
          <p className="page-subtitle">
            Cotizaciones adjudicadas desde el {fechaCL(datos?.inicio || "2026-10-16")}: lo que falta despachar de cada producto contra el stock del inventario.
            El stock se reparte por orden de adjudicación (la más antigua primero); lo que no alcanza queda en «Por comprar».
          </p>
        </div>
        <button type="button" className="btn btn-secondary" onClick={cargar} disabled={cargando}>
          <RefreshCw size={14} className={cargando ? "spin" : ""} /> Actualizar
        </button>
      </div>

      {error && <div style={{ border: "1px solid #fecaca", background: "#fef2f2", color: "#b91c1c", borderRadius: 10, padding: "10px 12px", fontSize: 13, marginBottom: 14 }}>{error}</div>}

      <div className="stats-row">
        <div className="stat-card" style={{ cursor: "pointer" }} onClick={() => { setPestana("cotizaciones"); setEstado("pendientes"); }} title="Ver las cotizaciones por despachar">
          <div className="stat-label">Por despachar</div>
          <div className="stat-value">{num(k?.cotizaciones ?? 0)}</div>
          <div className="stat-sub">cotizaciones · {num(k?.listas ?? 0)} con stock completo</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Cobertura de stock</div>
          <div className="stat-value" style={{ color: colorCobertura(k?.cobertura ?? 100) }}>{k ? `${Number(k.cobertura).toLocaleString("es-CL")} %` : "—"}</div>
          <div className="stat-sub">{num((k?.unidades_por_despachar ?? 0) - (k?.unidades_faltan ?? 0))} de {num(k?.unidades_por_despachar ?? 0)} unidades</div>
        </div>
        <div className="stat-card" style={{ cursor: "pointer" }} onClick={() => setPestana("compras")} title="Ver lo que hay que comprar">
          <div className="stat-label">Por comprar</div>
          <div className="stat-value" style={{ color: k?.unidades_faltan ? "#b91c1c" : undefined }}>{num(k?.unidades_faltan ?? 0)}</div>
          <div className="stat-sub">unidades de {num(k?.skus_por_comprar ?? 0)} producto{k?.skus_por_comprar === 1 ? "" : "s"}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Valor estimado de compra</div>
          <div className="stat-value">{clp(k?.valor_por_comprar ?? 0)}</div>
          <div className="stat-sub">a costo neto{k?.sin_costo ? ` · ${num(k.sin_costo)} sin costo` : ""}</div>
        </div>
      </div>

      {(datos?.avisos || []).length > 0 && (
        <ul style={{ margin: "0 0 14px", fontSize: 12.5, color: "#78350f", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 10, padding: "8px 12px 8px 30px" }}>
          {datos.avisos.map((a, i) => <li key={i}>{a}</li>)}
        </ul>
      )}

      <div className="pagos-tabs" role="tablist" aria-label="Vista de Gestión de compras">
        {[
          { value: "cotizaciones", label: `Cotizaciones (${num(cotizaciones.length)})`, Icono: ClipboardList },
          { value: "compras", label: `Por comprar (${num(compras.length)})`, Icono: ShoppingCart },
        ].map((p) => (
          <button key={p.value} type="button" role="tab" aria-selected={pestana === p.value} className={pestana === p.value ? "activo" : ""} onClick={() => setPestana(p.value)}>
            <p.Icono size={15} /> {p.label}
          </button>
        ))}
      </div>

      <div className="filter-bar" style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
        <div className="filter-field" style={{ flex: "2 1 240px", minWidth: 0 }}>
          <label className="filter-label">Buscar</label>
          <span style={{ position: "relative", display: "block" }}>
            <Search size={14} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)" }} />
            <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder={pestana === "compras" ? "SKU, producto o N° de cotización…" : "Cotización, cliente, vendedor, SKU…"} style={{ width: "100%", paddingLeft: 30 }} />
          </span>
        </div>
        {pestana === "cotizaciones" && (
          <div className="filter-field" style={{ flex: "1 1 190px", minWidth: 0 }}>
            <label className="filter-label">Stock</label>
            <DropdownSelect
              value={estado}
              onChange={setEstado}
              minWidth={200}
              style={{ width: "100%" }}
              options={[
                { value: "pendientes", label: "Por despachar" },
                { value: "lista", label: "Stock completo", color: ESTADOS.lista.color },
                { value: "parcial", label: "Stock parcial", color: ESTADOS.parcial.color },
                { value: "sin_stock", label: "Sin stock", color: ESTADOS.sin_stock.color },
                { value: "despachada", label: "Despachadas" },
                { value: "todas", label: "Todas" },
              ]}
            />
          </div>
        )}
        <BotonLimpiarFiltros hay={hayFiltros} onLimpiar={() => { setQ(""); setEstado("pendientes"); }} />
      </div>

      <div className="surface" style={{ marginTop: 14, overflowX: "auto" }}>
        {cargando && !datos ? (
          <div style={{ padding: "36px 24px", color: "var(--text-muted)" }}>Cargando cotizaciones y stock…</div>
        ) : !lista.length ? (
          <div style={{ padding: "36px 24px", color: "var(--text-muted)" }}>
            {pestana === "compras"
              ? (datos?.compras || []).length ? "Ningún producto calza con la búsqueda." : "No hay nada que comprar: el stock alcanza para todo lo adjudicado."
              : (datos?.cotizaciones || []).length ? "Ninguna cotización calza con el filtro." : `Todavía no hay cotizaciones adjudicadas desde el ${fechaCL(datos?.inicio)}.`}
          </div>
        ) : pestana === "compras" ? (
          <table className="data-table tabla-compacta cabecera-flexible tabla-texto tabla-por-comprar" style={{ width: "100%" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left" }}>Producto</th>
                <th style={{ textAlign: "right" }}>Por despachar</th>
                <th style={{ textAlign: "right" }}>Stock</th>
                <th style={{ textAlign: "right" }}>Falta comprar</th>
                <th style={{ textAlign: "right" }}>Costo neto</th>
                <th style={{ textAlign: "right" }}>Valor estimado</th>
                <th style={{ textAlign: "left" }}>Cotizaciones</th>
              </tr>
            </thead>
            <tbody>
              {visibles.map((e) => (
                <tr key={`${e.sku}|${e.producto}`}>
                  <td style={{ minWidth: 180 }}>
                    <div style={{ fontWeight: 600, overflowWrap: "anywhere" }}>{e.producto || "—"}</div>
                    <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>{e.sku || "Sin SKU (transitorio)"}{e.sku && !e.en_catalogo ? " · no está en el catálogo" : ""}</div>
                  </td>
                  <td style={{ textAlign: "right" }}>{num(e.por_despachar)}</td>
                  <td style={{ textAlign: "right" }}>{num(e.stock)}</td>
                  <td style={{ textAlign: "right", fontWeight: 700, color: "#b91c1c" }}>{num(e.falta)}</td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>{e.costo ? clp(e.costo) : "—"}</td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap", fontWeight: 600 }}>{e.valor_estimado ? clp(e.valor_estimado) : "—"}</td>
                  <td style={{ fontSize: 12.5 }}>
                    <span style={{ display: "inline-flex", gap: 6, flexWrap: "wrap" }}>
                      {e.cotizaciones.map((id) => <Link key={id} to={`/detalle/${id}`} className="table-link">#{id}</Link>)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <table className="data-table tabla-compacta cabecera-flexible tabla-texto tabla-gestion-compras" style={{ width: "100%" }}>
            <thead>
              <tr>
                <th style={{ width: 28 }} aria-label="Detalle" />
                <th style={{ textAlign: "left" }}>Cotización</th>
                <th style={{ textAlign: "left" }}>Adjudicada</th>
                <th style={{ textAlign: "right" }} title="Productos por despachar que tienen todo su stock">Productos con stock</th>
                <th style={{ textAlign: "right" }} title="Unidades por despachar cubiertas por el stock">Unidades con stock</th>
                <th style={{ textAlign: "left", minWidth: 120 }}>Cobertura</th>
                <th style={{ textAlign: "left" }}>Estado</th>
              </tr>
            </thead>
            <tbody>
              {visibles.map((c) => {
                const abiertaEsta = abierta === c.id;
                const est = ESTADOS[c.estado] || ESTADOS.sin_items;
                return (
                  <Fragment key={c.id}>
                    <tr className={abiertaEsta ? "fila-abierta" : ""} style={{ cursor: "pointer" }} onClick={() => setAbierta(abiertaEsta ? null : c.id)}>
                      <td>{abiertaEsta ? <ChevronDown size={15} /> : <ChevronRight size={15} />}</td>
                      <td style={{ minWidth: 150 }}>
                        <Link to={`/detalle/${c.id}`} className="table-link" style={{ fontWeight: 700 }} onClick={(e) => e.stopPropagation()}>#{c.id}</Link>
                        {c.codigo && c.codigo !== String(c.id) && <span style={{ color: "var(--text-muted)", fontSize: 11.5, marginLeft: 6 }}>{c.codigo}</span>}
                        <div style={{ fontSize: 12.5, overflowWrap: "anywhere" }}>{c.cliente || "—"}</div>
                        {c.vendedor && <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>{c.vendedor}</div>}
                      </td>
                      <td style={{ whiteSpace: "nowrap" }}>{fechaCL(c.fecha_adjudicada)}</td>
                      <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>{num(c.productos_cubiertos)} de {num(c.productos_pendientes)}</td>
                      <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>{num(c.unidades.asignadas)} de {num(c.unidades.por_despachar)}</td>
                      <td><Barra valor={c.cobertura} /></td>
                      <td><span style={pastilla(est)}>{est.texto}</span></td>
                    </tr>
                    {abiertaEsta && (
                      <tr className="detalle-gestion-compras">
                        <td colSpan={7} style={{ background: "var(--bg)", padding: "10px 12px" }}>
                          <div style={{ overflowX: "auto" }}>
                            <table className="data-table tabla-compacta cabecera-flexible tabla-texto" style={{ width: "100%", background: "var(--surface)" }}>
                              <thead>
                                <tr>
                                  <th style={{ textAlign: "left" }}>Producto</th>
                                  <th style={{ textAlign: "right" }}>Cotizado</th>
                                  <th style={{ textAlign: "right" }}>Despachado</th>
                                  <th style={{ textAlign: "right" }}>Por despachar</th>
                                  <th style={{ textAlign: "right" }} title="Stock total del inventario">Stock</th>
                                  <th style={{ textAlign: "right" }} title="Unidades del stock que le tocan a esta cotización (por orden de adjudicación)">Asignado</th>
                                  <th style={{ textAlign: "right" }}>Falta</th>
                                  <th style={{ textAlign: "left", minWidth: 100 }}>Cobertura</th>
                                </tr>
                              </thead>
                              <tbody>
                                {c.productos.map((p, i) => (
                                  <tr key={i} style={{ opacity: p.por_despachar > 0 ? 1 : 0.55 }}>
                                    <td style={{ minWidth: 140 }}>
                                      <div style={{ fontWeight: 600, overflowWrap: "anywhere" }}>{p.producto || "—"}</div>
                                      <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>{p.sku || "Sin SKU (transitorio)"}{p.sku && !p.en_catalogo ? " · no está en el catálogo" : ""}</div>
                                    </td>
                                    <td style={{ textAlign: "right" }}>{num(p.cotizado)}</td>
                                    <td style={{ textAlign: "right" }}>{num(p.despachado)}</td>
                                    <td style={{ textAlign: "right", fontWeight: 600 }}>{num(p.por_despachar)}</td>
                                    <td style={{ textAlign: "right" }}>{num(p.stock)}</td>
                                    <td style={{ textAlign: "right" }}>{num(p.asignado)}</td>
                                    <td style={{ textAlign: "right", fontWeight: 700, color: p.falta > 0 ? "#b91c1c" : undefined }}>{p.falta > 0 ? num(p.falta) : "—"}</td>
                                    <td>{p.por_despachar > 0 ? <Barra valor={p.cobertura} /> : <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Despachado</span>}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
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
      <Paginacion pagina={pagina} total={lista.length} onCambiar={setPagina} nombre={pestana === "compras" ? "productos" : "cotizaciones"} />
      {datos?.actualizado_at && <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 6 }}>Calculado {new Date(datos.actualizado_at).toLocaleString("es-CL")}. El stock es el del inventario (sincronizado desde Bsale).</div>}
    </div>
  );
}
