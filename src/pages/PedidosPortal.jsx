import { Fragment, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import Toast from "../components/Toast";
import {
  Inbox,
  ShoppingCart,
  Package,
  ExternalLink,
  MessageCircle,
  FilePlus,
  RefreshCw,
  Phone,
  Mail,
  MapPin,
  ChevronDown,
  ChevronRight,
  ChevronLeft,
} from "lucide-react";

/* ============================================================
   PEDIDOS DEL PORTAL (2026-09-10)
   Bandeja del equipo con TODOS los pedidos y solicitudes generados desde el
   portal cliente, sin importar el origen (carrito del Explorador de Precios
   o Gestión de Stock). Control compacto: tabla paginada con una fila por
   pedido y detalle expandible con la ficha completa.
============================================================ */

const TEAL = "#0d9488";
const POR_PAGINA = 10;

const ESTADOS = [
  { value: "pendiente", label: "Pendiente", bg: "#fef9c3", fg: "#a16207" },
  { value: "respondida", label: "Respondida", bg: "#dcfce7", fg: "#15803d" },
  { value: "cancelada", label: "Cancelada", bg: "#fee2e2", fg: "#b91c1c" },
];
const estadoMeta = (e) => ESTADOS.find((x) => x.value === e) || ESTADOS[0];

function formatearRutVisual(input) {
  const limpio = String(input || "").replace(/[^0-9kK]/g, "");
  if (!limpio) return "";
  const cuerpo = limpio.slice(0, -1);
  const dv = limpio.slice(-1).toUpperCase();
  const conPuntos = cuerpo.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return cuerpo ? `${conPuntos}-${dv}` : dv;
}

const fmtCLP = (n) => `$${Math.round(Number(n) || 0).toLocaleString("es-CL")}`;

function fmtFechaHora(iso) {
  const s = String(iso || "");
  if (!s) return "—";
  const [y, m, d] = s.slice(0, 10).split("-");
  const hora = s.length > 10 ? s.slice(11, 16) : "";
  return `${d}-${m}-${y}${hora ? ` · ${hora}` : ""}`;
}

// Origen del pedido: el carrito del explorador deja referencia de tienda /
// precio / url en los ítems (y lo dice la nota); lo demás viene de la
// gestión de stock del portal.
function origenDe(s) {
  const items = Array.isArray(s.items) ? s.items : [];
  const conRef = items.some((i) => i?.tienda || i?.precio_referencia || i?.url);
  if (conRef || /explorador/i.test(String(s.nota || ""))) return "explorador";
  return "stock";
}

function BadgeOrigen({ origen, compacto = false }) {
  const esExp = origen === "explorador";
  return (
    <span
      style={{
        display: "inline-flex", alignItems: "center", gap: 5, fontSize: 10.5, fontWeight: 800,
        textTransform: "uppercase", letterSpacing: ".03em", padding: "3px 9px", borderRadius: 999,
        background: esExp ? "#f0fdfa" : "#f1f5f9",
        color: esExp ? TEAL : "#475569",
        border: `1px solid ${esExp ? "#ccfbf1" : "#e2e8f0"}`,
        whiteSpace: "nowrap",
      }}
    >
      {esExp ? <ShoppingCart size={11} /> : <Package size={11} />}
      {compacto ? (esExp ? "Explorador" : "Stock") : esExp ? "Explorador de Precios" : "Gestión de Stock"}
    </span>
  );
}

export default function PedidosPortal() {
  const navigate = useNavigate();
  const [pedidos, setPedidos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);

  const [fTexto, setFTexto] = useState("");
  const [fEstado, setFEstado] = useState("");
  const [fOrigen, setFOrigen] = useState("");
  const [pagina, setPagina] = useState(1);
  const [expandidoId, setExpandidoId] = useState(null);

  async function cargar() {
    setLoading(true);
    try {
      const data = await api.get("/stock-clientes/solicitudes");
      setPedidos(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error(e);
      setToast({ type: "error", message: "No se pudieron cargar los pedidos del portal." });
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { cargar(); }, []);

  // Cambiar cualquier filtro vuelve a la página 1 y colapsa el detalle.
  useEffect(() => {
    setPagina(1);
    setExpandidoId(null);
  }, [fTexto, fEstado, fOrigen]);

  const filtrados = useMemo(() => {
    const q = fTexto.trim().toLowerCase();
    const qRut = q.replace(/[.\-\s]/g, "");
    return pedidos.filter((s) => {
      if (fEstado && (s.estado || "pendiente") !== fEstado) return false;
      if (fOrigen && origenDe(s) !== fOrigen) return false;
      if (!q) return true;
      const items = Array.isArray(s.items) ? s.items : [];
      return (
        String(s.razon_social || "").toLowerCase().includes(q) ||
        String(s.rut || "").replace(/[.\-\s]/g, "").includes(qRut) ||
        String(s.nota || "").toLowerCase().includes(q) ||
        String(s.contacto_nombre || "").toLowerCase().includes(q) ||
        String(s.id) === q ||
        items.some((i) => String(i?.nombre || "").toLowerCase().includes(q))
      );
    });
  }, [pedidos, fTexto, fEstado, fOrigen]);

  const totalPaginas = Math.max(1, Math.ceil(filtrados.length / POR_PAGINA));
  const paginaActual = Math.min(pagina, totalPaginas);
  const visibles = filtrados.slice((paginaActual - 1) * POR_PAGINA, paginaActual * POR_PAGINA);

  const stats = useMemo(() => {
    const total = pedidos.length;
    const porEstado = { pendiente: 0, respondida: 0, cancelada: 0 };
    let explorador = 0;
    pedidos.forEach((s) => {
      const e = s.estado || "pendiente";
      porEstado[e] = (porEstado[e] || 0) + 1;
      if (origenDe(s) === "explorador") explorador++;
    });
    return { total, ...porEstado, explorador };
  }, [pedidos]);

  async function cambiarEstado(s, estado) {
    const anterior = s.estado;
    setPedidos((prev) => prev.map((p) => (p.id === s.id ? { ...p, estado } : p)));
    try {
      await api.put(`/stock-clientes/solicitudes/${s.id}/estado`, { estado });
    } catch (e) {
      setPedidos((prev) => prev.map((p) => (p.id === s.id ? { ...p, estado: anterior } : p)));
      setToast({ type: "error", message: "No se pudo cambiar el estado." });
    }
  }

  // Arranca una cotización desde el pedido: precarga cliente + observaciones
  // con el detalle y deja el vínculo (solicitud_stock_id) para que al
  // guardarse quede asociada y el pedido pase a "Respondida".
  function crearCotizacion(s) {
    const items = Array.isArray(s.items) ? s.items : [];
    const lineas = items.map((i) => {
      const ref = [
        i?.tienda ? `ref. ${i.tienda}` : null,
        i?.precio_referencia ? fmtCLP(i.precio_referencia) : null,
      ].filter(Boolean).join(" ");
      return `  • ${i?.nombre || "?"} — ${i?.cantidad || 0}${i?.unidad ? ` ${i.unidad}` : ""}${ref ? ` (${ref})` : ""}`;
    });
    const obs = [
      `Pedido del portal N° ${s.id} (${origenDe(s) === "explorador" ? "Explorador de Precios" : "Gestión de Stock"}) del ${fmtFechaHora(s.created_at)}:`,
      ...lineas,
      s.nota ? `Nota del cliente: ${s.nota}` : null,
    ].filter(Boolean).join("\n");

    if ((s.estado || "pendiente") === "pendiente") {
      api.put(`/stock-clientes/solicitudes/${s.id}/estado`, { estado: "respondida" }).catch(() => undefined);
    }
    navigate("/crear", {
      state: {
        duplicarLicitacion: {
          rutEntidad: formatearRutVisual(s.rut),
          nombreEntidad: s.razon_social || "",
          tipoCliente: "Entidad Pública",
          tipoCompra: "Compra ágil",
          listado: "2",
          contacto: s.contacto_nombre || "",
          email: s.contacto_email || "",
          telefono: s.contacto_telefono || "",
          observaciones: obs,
          solicitud_stock_id: s.id,
        },
      },
    });
  }

  if (loading) {
    return (
      <div className="page">
        <div className="page-header"><h1 className="page-title">Pedidos del Portal</h1></div>
        <p className="text-gray-500 text-sm mt-4">Cargando pedidos…</p>
      </div>
    );
  }

  return (
    <div className="page">
      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}

      <div className="page-header" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 className="page-title" style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Inbox size={22} style={{ color: TEAL }} /> Pedidos del Portal
          </h1>
          <p style={{ fontSize: 12.5, color: "var(--text-muted)", margin: "4px 0 0" }}>
            Todo lo que los clientes piden desde el portal — carrito del Explorador de Precios y solicitudes de Gestión de Stock — en una sola bandeja.
          </p>
        </div>
        <button type="button" className="btn btn-secondary" onClick={cargar} title="Actualizar">
          <RefreshCw size={14} style={{ marginRight: 6 }} /> Actualizar
        </button>
      </div>

      {/* KPIs — una sola fila (5 columnas) */}
      <div className="stats-row stats-5" style={{ marginTop: 8 }}>
        <div
          className="stat-card"
          onClick={() => { setFEstado(""); setFOrigen(""); }}
          style={{ cursor: "pointer" }}
          title="Quitar filtros de estado y origen"
        >
          <div className="stat-label">Pedidos</div>
          <div className="stat-value">{stats.total}</div>
        </div>
        <div className="stat-card" onClick={() => setFEstado(fEstado === "pendiente" ? "" : "pendiente")} style={{ cursor: "pointer", outline: fEstado === "pendiente" ? "2px solid #f59e0b" : "none" }}>
          <div className="stat-label">Pendientes</div>
          <div className="stat-value" style={{ color: "#b45309" }}>{stats.pendiente}</div>
        </div>
        <div className="stat-card" onClick={() => setFEstado(fEstado === "respondida" ? "" : "respondida")} style={{ cursor: "pointer", outline: fEstado === "respondida" ? "2px solid #16a34a" : "none" }}>
          <div className="stat-label">Respondidas</div>
          <div className="stat-value" style={{ color: "var(--success)" }}>{stats.respondida}</div>
        </div>
        <div className="stat-card" onClick={() => setFEstado(fEstado === "cancelada" ? "" : "cancelada")} style={{ cursor: "pointer", outline: fEstado === "cancelada" ? "2px solid #dc2626" : "none" }}>
          <div className="stat-label">Canceladas</div>
          <div className="stat-value" style={{ color: "#b91c1c" }}>{stats.cancelada}</div>
        </div>
        <div className="stat-card" onClick={() => setFOrigen(fOrigen === "explorador" ? "" : "explorador")} style={{ cursor: "pointer", outline: fOrigen === "explorador" ? `2px solid ${TEAL}` : "none" }}>
          <div className="stat-label">Del explorador</div>
          <div className="stat-value" style={{ color: TEAL }}>{stats.explorador}</div>
        </div>
      </div>

      {/* Filtros */}
      <div className="filter-bar" style={{ marginTop: 12 }}>
        <div className="filter-field" style={{ minWidth: 260 }}>
          <label className="filter-label">Buscar</label>
          <input
            type="text"
            className="input"
            placeholder="Cliente, RUT, N° pedido, producto, nota…"
            value={fTexto}
            onChange={(e) => setFTexto(e.target.value)}
          />
        </div>
        <div className="filter-field">
          <label className="filter-label">Estado</label>
          <select className="input" value={fEstado} onChange={(e) => setFEstado(e.target.value)}>
            <option value="">Todos</option>
            {ESTADOS.map((e) => <option key={e.value} value={e.value}>{e.label}</option>)}
          </select>
        </div>
        <div className="filter-field">
          <label className="filter-label">Origen</label>
          <select className="input" value={fOrigen} onChange={(e) => setFOrigen(e.target.value)}>
            <option value="">Todos</option>
            <option value="explorador">Explorador de Precios</option>
            <option value="stock">Gestión de Stock</option>
          </select>
        </div>
      </div>

      {/* Tabla compacta: una fila por pedido, detalle expandible */}
      <div className="table-wrap" style={{ marginTop: 12 }}>
        <div className="table-scroll">
          <table className="data-table">
            <colgroup>
              <col style={{ width: 36 }} />
              <col style={{ width: "9%" }} />
              <col style={{ width: "27%" }} />
              <col style={{ width: "13%" }} />
              <col style={{ width: "21%" }} />
              <col style={{ width: "9%" }} />
              <col style={{ width: "10%" }} />
              <col style={{ width: "11%" }} />
            </colgroup>
            <thead>
              <tr>
                <th />
                <th style={{ textAlign: "left" }}>Pedido</th>
                <th style={{ textAlign: "left" }}>Cliente</th>
                <th style={{ textAlign: "left" }}>Origen</th>
                <th style={{ textAlign: "left" }}>Ítems</th>
                <th style={{ textAlign: "right" }}>Total ref.</th>
                <th style={{ textAlign: "left" }}>Estado</th>
                <th style={{ textAlign: "left" }}>Cotización</th>
              </tr>
            </thead>
            <tbody>
              {visibles.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ textAlign: "center", padding: "50px 0", color: "var(--text-muted)" }}>
                    No hay pedidos que coincidan con los filtros.
                  </td>
                </tr>
              ) : (
                visibles.map((s) => {
                  const origen = origenDe(s);
                  const em = estadoMeta(s.estado || "pendiente");
                  const items = Array.isArray(s.items) ? s.items : [];
                  const totalRef = items.reduce(
                    (acc, i) => acc + Number(i?.precio_referencia || 0) * Number(i?.cantidad || 0),
                    0,
                  );
                  const abierto = expandidoId === s.id;
                  const resumenItems = items
                    .map((i) => i?.nombre)
                    .filter(Boolean)
                    .join(" · ");
                  return (
                    <Fragment key={s.id}>
                      <tr
                        onClick={() => setExpandidoId(abierto ? null : s.id)}
                        style={{ cursor: "pointer", background: abierto ? "#f8fafc" : undefined }}
                        title={abierto ? "Ocultar el detalle" : "Ver el detalle del pedido"}
                      >
                        <td style={{ textAlign: "center", color: "var(--text-muted)" }}>
                          {abierto ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                        </td>
                        <td style={{ whiteSpace: "nowrap" }}>
                          <div style={{ fontWeight: 700, color: "var(--text)" }}>N° {s.id}</div>
                          <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{fmtFechaHora(s.created_at)}</div>
                        </td>
                        <td>
                          <div style={{ fontWeight: 600, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 340 }}>
                            {s.razon_social || "Cliente sin nombre"}
                          </div>
                          <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                            {formatearRutVisual(s.rut) || "—"}
                            {s.sucursal_nombre ? ` · ${s.sucursal_nombre}` : ""}
                          </div>
                        </td>
                        <td><BadgeOrigen origen={origen} compacto /></td>
                        <td>
                          <div style={{ fontSize: 12.5, color: "#475569", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 280 }} title={resumenItems}>
                            <strong>{items.length}</strong> ítem{items.length === 1 ? "" : "s"}
                            {resumenItems ? ` — ${resumenItems}` : ""}
                          </div>
                          {s.mensajes_no_leidos > 0 && (
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10.5, fontWeight: 700, color: "#b45309", background: "#fef3c7", padding: "1px 8px", borderRadius: 999, marginTop: 2 }}>
                              <MessageCircle size={10} /> {s.mensajes_no_leidos} sin leer
                            </span>
                          )}
                        </td>
                        <td style={{ textAlign: "right", fontWeight: 700, fontVariantNumeric: "tabular-nums", color: totalRef > 0 ? "var(--text)" : "var(--text-muted)" }}>
                          {totalRef > 0 ? fmtCLP(totalRef) : "—"}
                        </td>
                        <td onClick={(e) => e.stopPropagation()}>
                          <select
                            className="input"
                            value={s.estado || "pendiente"}
                            onChange={(e) => cambiarEstado(s, e.target.value)}
                            style={{ width: "auto", height: 28, fontSize: 12, fontWeight: 700, background: em.bg, color: em.fg, border: "none", borderRadius: 999, padding: "0 10px" }}
                            title="Cambiar el estado del pedido"
                          >
                            {ESTADOS.map((e) => <option key={e.value} value={e.value}>{e.label}</option>)}
                          </select>
                        </td>
                        <td onClick={(e) => e.stopPropagation()} style={{ whiteSpace: "nowrap" }}>
                          {s.cotizacion ? (
                            <Link to={`/detalle/${s.cotizacion.id}`} className="table-link" style={{ fontWeight: 600, fontSize: 12.5 }} title={`Estado: ${s.cotizacion.estado || "—"}`}>
                              #{s.cotizacion.id}{s.cotizacion.id_licitacion && s.cotizacion.id_licitacion !== String(s.cotizacion.id) ? ` · ${s.cotizacion.id_licitacion}` : ""}
                            </Link>
                          ) : (
                            <button type="button" className="btn btn-primary btn-sm" onClick={() => crearCotizacion(s)}>
                              <FilePlus size={12} style={{ marginRight: 4 }} /> Crear
                            </button>
                          )}
                        </td>
                      </tr>

                      {abierto && (
                        <tr>
                          <td colSpan={8} style={{ background: "#f8fafc", padding: "14px 20px" }}>
                            <div style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 980 }}>
                              {(s.contacto_nombre || s.contacto_email || s.contacto_telefono || s.sucursal_nombre) && (
                                <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 12.5, color: "#475569" }}>
                                  {s.contacto_nombre && <span style={{ fontWeight: 700 }}>{s.contacto_nombre}</span>}
                                  {s.contacto_email && <span><Mail size={12} style={{ verticalAlign: "-1px", marginRight: 4 }} />{s.contacto_email}</span>}
                                  {s.contacto_telefono && <span><Phone size={12} style={{ verticalAlign: "-1px", marginRight: 4 }} />{s.contacto_telefono}</span>}
                                  {s.sucursal_nombre && <span><MapPin size={12} style={{ verticalAlign: "-1px", marginRight: 4 }} />{s.sucursal_nombre}</span>}
                                </div>
                              )}

                              {items.length > 0 && (
                                <div style={{ overflowX: "auto", background: "#fff", border: "1px solid #eef2f7", borderRadius: 10 }}>
                                  <table className="data-table" style={{ width: "100%", fontSize: 12.5 }}>
                                    <thead>
                                      <tr>
                                        <th style={{ textAlign: "left" }}>Producto</th>
                                        <th style={{ textAlign: "right", width: 90 }}>Cantidad</th>
                                        <th style={{ textAlign: "left", width: "32%" }}>Referencia</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {items.map((i, idx) => (
                                        <tr key={idx}>
                                          <td>{i?.nombre || "—"}</td>
                                          <td style={{ textAlign: "right", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                                            {i?.cantidad || 0}{i?.unidad ? ` ${i.unidad}` : ""}
                                          </td>
                                          <td style={{ fontSize: 12, color: "var(--text-muted)" }}>
                                            {i?.tienda || i?.precio_referencia || i?.url ? (
                                              <>
                                                {i?.tienda || "—"}
                                                {i?.precio_referencia ? ` · ${fmtCLP(i.precio_referencia)} c/u` : ""}
                                                {i?.url && (
                                                  <a href={i.url} target="_blank" rel="noopener noreferrer" style={{ color: TEAL, marginLeft: 6, fontWeight: 600 }}>
                                                    ver <ExternalLink size={11} style={{ verticalAlign: "-1px" }} />
                                                  </a>
                                                )}
                                              </>
                                            ) : (
                                              "—"
                                            )}
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              )}

                              {s.nota && (
                                <div style={{ fontSize: 12.5, color: "#475569", background: "#fff", border: "1px solid #eef2f7", borderRadius: 10, padding: "8px 12px" }}>
                                  <span style={{ fontWeight: 700, color: "#334155" }}>Nota:</span> {s.nota}
                                </div>
                              )}

                              <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                                {s.cotizacion ? (
                                  <Link to={`/detalle/${s.cotizacion.id}`} className="btn btn-secondary btn-sm" style={{ textDecoration: "none" }}>
                                    Abrir cotización #{s.cotizacion.id} ({s.cotizacion.estado || "—"})
                                  </Link>
                                ) : (
                                  <button type="button" className="btn btn-primary btn-sm" onClick={() => crearCotizacion(s)}>
                                    <FilePlus size={13} style={{ marginRight: 5 }} /> Crear cotización desde el pedido
                                  </button>
                                )}
                                <Link to="/monitoreo-stock" style={{ fontSize: 12, color: "var(--text-muted)", textDecoration: "none" }}>
                                  Ver en Monitoreo Stock →
                                </Link>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Paginación */}
      {filtrados.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 10, flexWrap: "wrap", gap: 8 }}>
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
            Mostrando {(paginaActual - 1) * POR_PAGINA + 1}–{Math.min(paginaActual * POR_PAGINA, filtrados.length)} de {filtrados.length} pedido{filtrados.length === 1 ? "" : "s"}
          </span>
          {totalPaginas > 1 && (
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={paginaActual <= 1}
                onClick={() => { setPagina(paginaActual - 1); setExpandidoId(null); }}
              >
                <ChevronLeft size={14} />
              </button>
              <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text)", minWidth: 60, textAlign: "center" }}>
                {paginaActual} / {totalPaginas}
              </span>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={paginaActual >= totalPaginas}
                onClick={() => { setPagina(paginaActual + 1); setExpandidoId(null); }}
              >
                <ChevronRight size={14} />
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
