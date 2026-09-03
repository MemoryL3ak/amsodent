// Inventario.jsx — módulo de inventario (pedido 2026-08-27).
// El stock vigente vive en productos.stock; cada cambio pasa por el backend
// (/inventario/movimientos) y queda en el libro inventario_movimientos como
// entrada, salida o ajuste, con el stock resultante estampado. Esta pantalla
// tiene dos pestañas: Stock (grilla del catálogo valorizada, con alertas de
// mínimo) y Movimientos (el libro completo).
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../lib/api";
import Toast from "../components/Toast";
import {
  Boxes, Search, Plus, Minus, SlidersHorizontal, History,
  Upload, Download, X, AlertTriangle, ArrowUp, ArrowDown, ArrowUpDown,
  RefreshCw,
} from "lucide-react";

const fmtCLP = (v) => `$${Math.round(Number(v) || 0).toLocaleString("es-CL")}`;
const fmtNum = (v) => Number(v || 0).toLocaleString("es-CL");
const fmtFechaHora = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return `${d.toLocaleDateString("es-CL", { day: "2-digit", month: "2-digit", year: "numeric" })} ${d.toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit", hour12: false })}`;
};

const TIPOS_MOV = {
  entrada: { label: "Entrada", color: "#15803d", bg: "#dcfce7" },
  salida: { label: "Salida", color: "#b91c1c", bg: "#fee2e2" },
  ajuste: { label: "Ajuste", color: "#6d28d9", bg: "#ede9fe" },
};

// Estado de alerta de una fila de stock. El umbral 0 significa "sin umbral":
// no genera alerta de mínimo (solo la de sin stock).
function alertaDe(p) {
  const stock = Number(p.stock) || 0;
  const min = Number(p.stock_minimo) || 0;
  if (stock <= 0) return "sin_stock";
  if (min > 0 && stock < min) return "bajo_minimo";
  return "ok";
}

export default function Inventario() {
  const [filas, setFilas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);
  const [vista, setVista] = useState("stock"); // stock | movimientos

  // Filtros de la pestaña Stock.
  const [busqueda, setBusqueda] = useState("");
  const [filtroCategoria, setFiltroCategoria] = useState("");
  const [filtroAlerta, setFiltroAlerta] = useState(""); // "" | con_stock | bajo_minimo | sin_stock
  const [filtroEstado, setFiltroEstado] = useState("Activo"); // estado del producto
  const [orden, setOrden] = useState({ campo: null, dir: "desc" }); // stock | valor

  // Modales.
  const [movModal, setMovModal] = useState(null); // { producto, tipo }
  const [histModal, setHistModal] = useState(null); // { producto, movs, loading }
  const [cargaOpen, setCargaOpen] = useState(false);

  // Edición inline del stock mínimo: id → string en edición.
  const [minEdit, setMinEdit] = useState({});

  // Pestaña Movimientos (libro completo).
  const [libro, setLibro] = useState(null); // null = aún no cargado
  const [libroLoading, setLibroLoading] = useState(false);
  const [filtroTipoMov, setFiltroTipoMov] = useState("");
  const [busquedaMov, setBusquedaMov] = useState("");

  // Integración Bsale (etapa 1: catálogo y stock). El stock de Bsale es la
  // fuente de verdad: la sincronización lo trae y deja cada cambio como un
  // ajuste en el libro. null = estado aún no cargado (o backend sin el módulo).
  const [bsale, setBsale] = useState(null);
  const [bsaleSync, setBsaleSync] = useState(false);
  const [bsaleDif, setBsaleDif] = useState(null); // modal: { loading, data }

  useEffect(() => {
    api.get("/bsale/estado").then(setBsale).catch(() => setBsale(null));
  }, []);

  // Mientras corre una sincronización (lanzada aquí o en otra pestaña), se
  // sondea el avance cada 2,5 s para la barra de progreso; en la fase final
  // ("aplicando") el stock ya se está escribiendo, así que la grilla se
  // refresca sola para verlo llegar en tiempo real. Al terminar: toast +
  // refresco completo (grilla y libro, porque hubo ajustes).
  const bsaleSincronizando = !!bsale?.sincronizando;
  useEffect(() => {
    if (!bsaleSincronizando) return;
    let tick = 0;
    const t = setInterval(async () => {
      let est;
      try {
        est = await api.get("/bsale/estado");
      } catch {
        return; // backend momentáneamente inalcanzable: se reintenta al próximo tick
      }
      setBsale(est);
      tick += 1;
      if (est?.sincronizando) {
        // Refresco silencioso (sin spinner) cada 2 ticks mientras se aplica el stock.
        if (est?.progreso?.fase === "aplicando" && tick % 2 === 0) {
          api.get("/inventario/resumen").then((d) => Array.isArray(d) && setFilas(d)).catch(() => {});
        }
        return;
      }
      const r = est?.ultima?.resumen;
      if (r) {
        setToast({
          type: "success",
          message: `Bsale sincronizado: ${fmtNum(r.actualizados || 0)} stocks actualizados (${fmtNum(r.matcheados || 0)} SKUs matcheados).`,
        });
      }
      cargar();
      setLibro(null);
    }, 2500);
    return () => clearInterval(t);
  }, [bsaleSincronizando]); // eslint-disable-line react-hooks/exhaustive-deps

  async function sincronizarBsale() {
    if (bsaleSync || bsale?.sincronizando) return;
    setBsaleSync(true);
    try {
      const r = await api.post("/bsale/sincronizar", {});
      if (r?.iniciado) {
        // Arrancó en el backend; el sondeo de arriba muestra la barra y avisa al final.
        api.get("/bsale/estado").then(setBsale).catch(() => {});
      } else {
        // Compatibilidad con un backend antiguo que respondía recién al terminar.
        setToast({
          type: "success",
          message: `Bsale sincronizado: ${fmtNum(r?.actualizados || 0)} stocks actualizados (${fmtNum(r?.matcheados || 0)} SKUs matcheados).`,
        });
        api.get("/bsale/estado").then(setBsale).catch(() => {});
        cargar();
        setLibro(null);
      }
    } catch (e) {
      setToast({ type: "error", message: e?.response?.data?.message || e?.message || "No se pudo sincronizar con Bsale." });
    } finally {
      setBsaleSync(false);
    }
  }

  async function abrirDiferenciasBsale() {
    setBsaleDif({ loading: true, data: null });
    try {
      const data = await api.get("/bsale/diferencias");
      setBsaleDif({ loading: false, data });
    } catch (e) {
      setBsaleDif(null);
      setToast({ type: "error", message: e?.message || "No se pudieron cargar las diferencias." });
    }
  }

  async function exportarDiferenciasBsale() {
    const det = bsaleDif?.data?.detalle;
    if (!det) return;
    try {
      const XLSX = await import("xlsx");
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.json_to_sheet((det.skus_bsale_sin_producto || []).map((r) => ({ "SKU Bsale": r.sku, "Descripción": r.descripcion || "" }))),
        "En Bsale sin producto",
      );
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.json_to_sheet((det.productos_sin_bsale || []).map((r) => ({ "SKU interno": r.sku, "Producto": r.nombre || "" }))),
        "Internos sin Bsale",
      );
      XLSX.writeFile(wb, `diferencias_bsale_${new Date().toISOString().slice(0, 10)}.xlsx`);
    } catch (e) {
      setToast({ type: "error", message: "No se pudo exportar el archivo." });
    }
  }

  async function cargar() {
    setLoading(true);
    try {
      const data = await api.get("/inventario/resumen");
      setFilas(Array.isArray(data) ? data : []);
    } catch (e) {
      setToast({ type: "error", message: e?.message || "No se pudo cargar el inventario." });
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { cargar(); }, []);

  // El libro se carga al entrar a su pestaña (y se refresca al volver a entrar
  // después de registrar movimientos, porque registrar lo invalida).
  useEffect(() => {
    if (vista !== "movimientos" || libro !== null || libroLoading) return;
    (async () => {
      setLibroLoading(true);
      try {
        const data = await api.get("/inventario/movimientos?limit=500");
        setLibro(Array.isArray(data) ? data : []);
      } catch (e) {
        setToast({ type: "error", message: e?.message || "No se pudieron cargar los movimientos." });
        setLibro([]);
      } finally {
        setLibroLoading(false);
      }
    })();
  }, [vista, libro, libroLoading]);

  const categorias = useMemo(
    () => [...new Set(filas.map((p) => String(p.categoria || "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "es")),
    [filas],
  );

  const filtradas = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    const arr = filas.filter((p) => {
      if (filtroEstado && String(p.estado || "") !== filtroEstado) return false;
      if (filtroCategoria && String(p.categoria || "").trim() !== filtroCategoria) return false;
      const al = alertaDe(p);
      if (filtroAlerta === "con_stock" && !(Number(p.stock) > 0)) return false;
      if (filtroAlerta === "bajo_minimo" && al !== "bajo_minimo") return false;
      if (filtroAlerta === "sin_stock" && al !== "sin_stock") return false;
      if (!q) return true;
      return (
        String(p.sku || "").toLowerCase().includes(q) ||
        String(p.nombre || "").toLowerCase().includes(q) ||
        String(p.marca || "").toLowerCase().includes(q)
      );
    });
    if (!orden.campo) return arr;
    const signo = orden.dir === "asc" ? 1 : -1;
    const valorDe = (p) => (orden.campo === "valor" ? (Number(p.stock) || 0) * (Number(p.costo) || 0) : Number(p.stock) || 0);
    return [...arr].sort((a, b) => (valorDe(a) - valorDe(b)) * signo);
  }, [filas, busqueda, filtroCategoria, filtroAlerta, filtroEstado, orden]);

  // KPIs sobre el filtro de estado del producto (no sobre los demás filtros:
  // los KPIs describen el inventario, no la búsqueda en curso).
  const stats = useMemo(() => {
    const base = filas.filter((p) => !filtroEstado || String(p.estado || "") === filtroEstado);
    let conStock = 0, unidades = 0, valor = 0, bajo = 0, sinStock = 0;
    for (const p of base) {
      const stock = Number(p.stock) || 0;
      if (stock > 0) { conStock++; unidades += stock; valor += stock * (Number(p.costo) || 0); }
      const al = alertaDe(p);
      if (al === "bajo_minimo") bajo++;
      if (al === "sin_stock") sinStock++;
    }
    return { total: base.length, conStock, unidades, valor, bajo, sinStock };
  }, [filas, filtroEstado]);

  function toggleOrden(campo) {
    setOrden((o) => (o.campo !== campo ? { campo, dir: "desc" } : o.dir === "desc" ? { campo, dir: "asc" } : { campo: null, dir: "desc" }));
  }

  // Refleja en la grilla el stock que devolvió el backend tras un movimiento.
  function aplicarStockLocal(productoId, stock) {
    setFilas((prev) => prev.map((p) => (p.id === productoId ? { ...p, stock } : p)));
    setLibro(null); // el libro quedó desactualizado: se recarga al abrirlo
  }

  async function guardarStockMinimo(p, valorStr) {
    const valor = Number(String(valorStr).replace(",", "."));
    setMinEdit((m) => { const c = { ...m }; delete c[p.id]; return c; });
    if (!Number.isFinite(valor) || valor < 0 || valor === (Number(p.stock_minimo) || 0)) return;
    try {
      await api.put(`/inventario/stock-minimo/${p.id}`, { stockMinimo: valor });
      setFilas((prev) => prev.map((x) => (x.id === p.id ? { ...x, stock_minimo: valor } : x)));
      setToast({ type: "success", message: `Stock mínimo de ${p.sku || p.nombre} actualizado a ${fmtNum(valor)}.` });
    } catch (e) {
      setToast({ type: "error", message: e?.message || "No se pudo guardar el stock mínimo." });
    }
  }

  async function abrirHistorial(p) {
    setHistModal({ producto: p, movs: [], loading: true });
    try {
      const data = await api.get(`/inventario/movimientos?productoId=${p.id}&limit=300`);
      setHistModal((prev) => (prev?.producto?.id === p.id ? { ...prev, movs: Array.isArray(data) ? data : [], loading: false } : prev));
    } catch (e) {
      setToast({ type: "error", message: e?.message || "No se pudo cargar el historial." });
      setHistModal(null);
    }
  }

  async function exportarExcel() {
    if (!filtradas.length) {
      setToast({ type: "info", message: "No hay filas en el filtro actual para exportar." });
      return;
    }
    const XLSX = await import("xlsx");
    const ws = XLSX.utils.json_to_sheet(filtradas.map((p) => ({
      SKU: p.sku || "",
      Nombre: p.nombre || "",
      Marca: p.marca || "",
      "Categoría": p.categoria || "",
      Estado: p.estado || "",
      Stock: Number(p.stock) || 0,
      "Stock mínimo": Number(p.stock_minimo) || 0,
      Costo: Number(p.costo) || 0,
      "Valorización (stock × costo)": (Number(p.stock) || 0) * (Number(p.costo) || 0),
      Alerta: alertaDe(p) === "sin_stock" ? "Sin stock" : alertaDe(p) === "bajo_minimo" ? "Bajo mínimo" : "",
    })));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Inventario");
    XLSX.writeFile(wb, `inventario_${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  const libroFiltrado = useMemo(() => {
    const q = busquedaMov.trim().toLowerCase();
    return (libro || []).filter((m) => {
      if (filtroTipoMov && m.tipo !== filtroTipoMov) return false;
      if (!q) return true;
      return (
        String(m.sku || "").toLowerCase().includes(q) ||
        String(m.motivo || "").toLowerCase().includes(q) ||
        String(m.referencia || "").toLowerCase().includes(q) ||
        String(m.usuario_email || "").toLowerCase().includes(q)
      );
    });
  }, [libro, filtroTipoMov, busquedaMov]);

  const FlechaOrden = ({ campo }) => (
    orden.campo !== campo ? <ArrowUpDown size={12} style={{ opacity: 0.35 }} />
      : orden.dir === "asc" ? <ArrowUp size={12} /> : <ArrowDown size={12} />
  );

  return (
    <div className="page">
      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}

      <div className="page-header" style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div>
          <h1 className="page-title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Boxes size={20} /> Inventario
          </h1>
          <p className="page-subtitle">
            Stock por SKU con libro de movimientos: cada entrada, salida y ajuste queda registrado y auditable.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="btn btn-secondary" onClick={exportarExcel} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <Download size={14} /> Exportar
          </button>
          <button className="btn btn-primary" onClick={() => setCargaOpen(true)}
            title="Carga el conteo físico desde una planilla (columnas: sku, stock y opcionalmente stock_minimo). Cada diferencia queda como un ajuste en el libro."
            style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <Upload size={14} /> Carga masiva
          </button>
        </div>
      </div>

      {/* KPIs */}
      <div className="stats-row stats-5">
        <div className="stat-card">
          <div className="stat-label">SKUs con stock</div>
          <div className="stat-value">{fmtNum(stats.conStock)}</div>
          <div className="stat-sub">de {fmtNum(stats.total)} en el filtro de estado</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Unidades totales</div>
          <div className="stat-value" style={{ color: "var(--primary-dark)" }}>{fmtNum(stats.unidades)}</div>
          <div className="stat-sub">suma de stock vigente</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Valorización</div>
          <div className="stat-value" style={{ color: "#15803d" }}>{fmtCLP(stats.valor)}</div>
          <div className="stat-sub">stock × costo (neto)</div>
        </div>
        <div className="stat-card" onClick={() => { setVista("stock"); setFiltroAlerta("bajo_minimo"); }} style={{ cursor: "pointer" }} title="Ver solo los productos bajo su mínimo">
          <div className="stat-label">Bajo mínimo</div>
          <div className="stat-value" style={{ color: "var(--warning)" }}>{fmtNum(stats.bajo)}</div>
          <div className="stat-sub">stock menor al umbral definido</div>
        </div>
        <div className="stat-card" onClick={() => { setVista("stock"); setFiltroAlerta("sin_stock"); }} style={{ cursor: "pointer" }} title="Ver solo los productos sin stock">
          <div className="stat-label">Sin stock</div>
          <div className="stat-value" style={{ color: "var(--danger)" }}>{fmtNum(stats.sinStock)}</div>
          <div className="stat-sub">stock en 0</div>
        </div>
      </div>

      {/* Integración Bsale: el stock disponible de Bsale (donde se factura)
          es la fuente de verdad; cada corrida deja los cambios como ajustes
          en el libro. La tarjeta solo aparece si el backend trae el módulo. */}
      {bsale && (
        <div className="surface" style={{ padding: "14px 18px", margin: "4px 0 14px", display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
          <div style={{
            width: 38, height: 38, borderRadius: 10, flexShrink: 0,
            background: "linear-gradient(135deg, #f97316, #fb923c)", color: "#fff",
            display: "grid", placeItems: "center", fontWeight: 800, fontSize: 15,
          }}>
            B
          </div>
          <div style={{ flex: 1, minWidth: 240 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <strong style={{ fontSize: 13.5 }}>Integración Bsale · stock</strong>
              {bsale.token_configurado ? (
                <span style={{ fontSize: 10.5, fontWeight: 700, padding: "2px 8px", borderRadius: 999, background: "#dcfce7", color: "#15803d" }}>CONECTADO</span>
              ) : (
                <span style={{ fontSize: 10.5, fontWeight: 700, padding: "2px 8px", borderRadius: 999, background: "#fef3c7", color: "#b45309" }}>FALTA TOKEN</span>
              )}
              {bsale.automatica?.activa && bsale.automatica?.horas?.length > 0 && (
                <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                  automática a las {bsale.automatica.horas.map((h) => `${String(h).padStart(2, "0")}:00`).join(" y ")}
                </span>
              )}
            </div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
              {!bsale.token_configurado ? (
                "Configura BSALE_ACCESS_TOKEN en el backend (Bsale: Configuración → Integraciones → API) para activar la sincronización."
              ) : bsale.ultima?.resumen ? (
                <>
                  Última corrida {fmtFechaHora(bsale.ultima.actualizado_at)}: {fmtNum(bsale.ultima.resumen.matcheados)} SKUs matcheados,{" "}
                  {fmtNum(bsale.ultima.resumen.actualizados)} stocks actualizados ·{" "}
                  <button type="button" onClick={abrirDiferenciasBsale} className="table-link" style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontSize: 12 }}>
                    {fmtNum(bsale.ultima.resumen.skus_bsale_sin_producto)} SKUs de Bsale sin producto interno · {fmtNum(bsale.ultima.resumen.productos_sin_bsale)} internos sin Bsale
                  </button>
                </>
              ) : (
                "Aún no se ha corrido la primera sincronización. El stock disponible de Bsale reemplazará al interno (cada cambio queda como ajuste en el libro)."
              )}
            </div>
            {bsale.sincronizando && (() => {
              const p = bsale.progreso;
              const FASES = {
                catalogo: ["1", "Bajando el catálogo de Bsale"],
                stocks: ["2", "Consultando el stock en Bsale"],
                aplicando: ["3", "Actualizando el stock de los productos"],
              };
              const [paso, etiqueta] = FASES[p?.fase] || [null, "Sincronizando con Bsale"];
              const pct = p?.total > 0 ? Math.min(100, Math.round((p.hechas / p.total) * 100)) : null;
              const detalle = !p?.total
                ? "…"
                : p.fase === "catalogo"
                  ? ` — página ${fmtNum(p.hechas)} de ${fmtNum(p.total)}`
                  : ` — ${fmtNum(p.hechas)} de ${fmtNum(p.total)} productos`;
              return (
                <div style={{ marginTop: 8, maxWidth: 520 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, fontSize: 12, color: "var(--text-muted)", marginBottom: 4 }}>
                    <span>{paso ? `Paso ${paso} de 3 · ` : ""}{etiqueta}{detalle}</span>
                    {pct != null && <strong style={{ color: "var(--primary-dark)", fontVariantNumeric: "tabular-nums" }}>{pct}%</strong>}
                  </div>
                  <div style={{ height: 6, borderRadius: 4, background: "var(--border)", overflow: "hidden" }}>
                    <div style={{
                      width: `${pct ?? 12}%`, height: "100%", borderRadius: 4,
                      background: "linear-gradient(90deg, var(--primary), #14b8a6)",
                      transition: "width .4s ease",
                    }} />
                  </div>
                  {p?.fase === "aplicando" && (
                    <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 4 }}>
                      El stock ya se está escribiendo: la tabla de abajo se refresca sola a medida que avanza.
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
          <button
            className="btn btn-secondary"
            onClick={sincronizarBsale}
            disabled={bsaleSync || bsale.sincronizando || !bsale.token_configurado}
            title={!bsale.token_configurado ? "Configura el token de Bsale en el backend" : "Traer el stock disponible desde Bsale ahora"}
            style={{ display: "inline-flex", alignItems: "center", gap: 6, flexShrink: 0 }}
          >
            <RefreshCw size={14} style={bsaleSync || bsale.sincronizando ? { animation: "bsale-spin 1s linear infinite" } : undefined} />
            {bsaleSync || bsale.sincronizando ? "Sincronizando…" : "Sincronizar ahora"}
          </button>
          <style>{`@keyframes bsale-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
        </div>
      )}

      {/* Pestañas */}
      <div style={{ display: "inline-flex", borderRadius: 9, overflow: "hidden", border: "1px solid var(--border)", margin: "4px 0 14px" }}>
        {[["stock", "Stock"], ["movimientos", "Movimientos"]].map(([key, label]) => (
          <button key={key} type="button" onClick={() => setVista(key)}
            style={{
              padding: "7px 18px", fontSize: 13, fontWeight: 700, cursor: "pointer", border: "none",
              background: vista === key ? "var(--primary)" : "var(--surface)",
              color: vista === key ? "#fff" : "var(--text-muted)",
            }}>
            {label}
          </button>
        ))}
      </div>

      {vista === "stock" && (
        <>
          <div className="filter-bar" style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
            <div className="filter-field" style={{ flex: 2, minWidth: 220 }}>
              <label className="filter-label">Buscar</label>
              <div style={{ position: "relative" }}>
                <Search size={15} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)" }} />
                <input className="input" style={{ paddingLeft: 32 }} placeholder="SKU, nombre o marca…" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
              </div>
            </div>
            <div className="filter-field">
              <label className="filter-label">Categoría</label>
              <select className="input" value={filtroCategoria} onChange={(e) => setFiltroCategoria(e.target.value)} style={{ minWidth: 160 }}>
                <option value="">Todas</option>
                {categorias.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="filter-field">
              <label className="filter-label">Alerta</label>
              <select className="input" value={filtroAlerta} onChange={(e) => setFiltroAlerta(e.target.value)} style={{ minWidth: 160 }}>
                <option value="">Todos</option>
                <option value="con_stock">Con stock</option>
                <option value="bajo_minimo">Bajo mínimo</option>
                <option value="sin_stock">Sin stock</option>
              </select>
            </div>
            <div className="filter-field">
              <label className="filter-label">Estado producto</label>
              <select className="input" value={filtroEstado} onChange={(e) => setFiltroEstado(e.target.value)} style={{ minWidth: 140 }}>
                <option value="Activo">Activos</option>
                <option value="Transitorio">Transitorios</option>
                <option value="">Todos</option>
              </select>
            </div>
          </div>

          <div className="surface" style={{ marginTop: 14, overflowX: "auto" }}>
            {loading ? (
              <div style={{ padding: "36px 24px", color: "var(--text-muted)" }}>Cargando inventario…</div>
            ) : filtradas.length === 0 ? (
              <div style={{ padding: "36px 24px", color: "var(--text-muted)" }}>Sin productos para el filtro.</div>
            ) : (
              <table className="data-table" style={{ width: "100%", minWidth: 1080 }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left", whiteSpace: "nowrap" }}>SKU</th>
                    <th style={{ textAlign: "left", minWidth: 220 }}>Producto</th>
                    <th style={{ textAlign: "left" }}>Categoría</th>
                    <th style={{ textAlign: "right", whiteSpace: "nowrap", cursor: "pointer" }} onClick={() => toggleOrden("stock")} title="Ordenar por stock">
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>Stock <FlechaOrden campo="stock" /></span>
                    </th>
                    <th style={{ textAlign: "right", whiteSpace: "nowrap" }} title="Umbral de alerta. Clic en el número para editarlo; 0 = sin umbral.">Mínimo</th>
                    <th style={{ textAlign: "right", whiteSpace: "nowrap" }}>Costo</th>
                    <th style={{ textAlign: "right", whiteSpace: "nowrap", cursor: "pointer" }} onClick={() => toggleOrden("valor")} title="Ordenar por valorización">
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>Valorización <FlechaOrden campo="valor" /></span>
                    </th>
                    <th style={{ textAlign: "left" }}>Alerta</th>
                    <th style={{ textAlign: "left", whiteSpace: "nowrap" }}>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {filtradas.map((p) => {
                    const al = alertaDe(p);
                    const stock = Number(p.stock) || 0;
                    return (
                      <tr key={p.id}>
                        <td style={{ fontWeight: 600, whiteSpace: "nowrap" }}>{p.sku || <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>—</span>}</td>
                        <td style={{ whiteSpace: "normal", wordBreak: "break-word" }}>
                          {p.nombre || "—"}
                          {p.marca && <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{p.marca}</div>}
                        </td>
                        <td style={{ fontSize: 12.5, whiteSpace: "nowrap" }}>{p.categoria || "—"}</td>
                        <td style={{ textAlign: "right", fontWeight: 700, whiteSpace: "nowrap", color: al === "sin_stock" ? "var(--danger)" : al === "bajo_minimo" ? "var(--warning)" : "var(--text)" }}>
                          {fmtNum(stock)}
                        </td>
                        <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                          {minEdit[p.id] !== undefined ? (
                            <input
                              className="input"
                              autoFocus
                              inputMode="numeric"
                              value={minEdit[p.id]}
                              onChange={(e) => setMinEdit((m) => ({ ...m, [p.id]: e.target.value.replace(/[^\d.,]/g, "") }))}
                              onBlur={(e) => guardarStockMinimo(p, e.target.value)}
                              onKeyDown={(e) => { if (e.key === "Enter") e.target.blur(); if (e.key === "Escape") setMinEdit((m) => { const c = { ...m }; delete c[p.id]; return c; }); }}
                              style={{ width: 80, height: 28, textAlign: "right", fontSize: 12.5 }}
                            />
                          ) : (
                            <button type="button" onClick={() => setMinEdit((m) => ({ ...m, [p.id]: String(Number(p.stock_minimo) || 0) }))}
                              title="Editar el stock mínimo"
                              style={{ background: "none", border: "none", cursor: "pointer", font: "inherit", color: Number(p.stock_minimo) > 0 ? "var(--text)" : "var(--text-muted)", textDecoration: "underline dotted", textUnderlineOffset: 3 }}>
                              {fmtNum(Number(p.stock_minimo) || 0)}
                            </button>
                          )}
                        </td>
                        <td style={{ textAlign: "right", whiteSpace: "nowrap", fontSize: 12.5 }}>{fmtCLP(p.costo)}</td>
                        <td style={{ textAlign: "right", whiteSpace: "nowrap", fontWeight: 600 }}>{fmtCLP(stock * (Number(p.costo) || 0))}</td>
                        <td>
                          {al === "sin_stock" ? (
                            <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 999, background: "#fee2e2", color: "#b91c1c", whiteSpace: "nowrap" }}>Sin stock</span>
                          ) : al === "bajo_minimo" ? (
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 999, background: "#fef3c7", color: "#b45309", whiteSpace: "nowrap" }}>
                              <AlertTriangle size={11} /> Bajo mínimo
                            </span>
                          ) : (
                            <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 999, background: "#dcfce7", color: "#15803d", whiteSpace: "nowrap" }}>OK</span>
                          )}
                        </td>
                        <td>
                          <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
                            <button className="btn btn-sm btn-ghost" title="Registrar entrada (compra, devolución)" onClick={() => setMovModal({ producto: p, tipo: "entrada" })} style={{ padding: 6, lineHeight: 0, color: "#15803d" }}>
                              <Plus size={15} />
                            </button>
                            <button className="btn btn-sm btn-ghost" title="Registrar salida (venta, merma, muestra)" onClick={() => setMovModal({ producto: p, tipo: "salida" })} style={{ padding: 6, lineHeight: 0, color: "#b91c1c" }}>
                              <Minus size={15} />
                            </button>
                            <button className="btn btn-sm btn-ghost" title="Ajustar al conteo físico" onClick={() => setMovModal({ producto: p, tipo: "ajuste" })} style={{ padding: 6, lineHeight: 0, color: "#6d28d9" }}>
                              <SlidersHorizontal size={15} />
                            </button>
                            <button className="btn btn-sm btn-ghost" title="Ver historial de movimientos" onClick={() => abrirHistorial(p)} style={{ padding: 6, lineHeight: 0, color: "var(--text-muted)" }}>
                              <History size={15} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {vista === "movimientos" && (
        <>
          <div className="filter-bar" style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
            <div className="filter-field" style={{ flex: 2, minWidth: 220 }}>
              <label className="filter-label">Buscar</label>
              <div style={{ position: "relative" }}>
                <Search size={15} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)" }} />
                <input className="input" style={{ paddingLeft: 32 }} placeholder="SKU, motivo, referencia o usuario…" value={busquedaMov} onChange={(e) => setBusquedaMov(e.target.value)} />
              </div>
            </div>
            <div className="filter-field">
              <label className="filter-label">Tipo</label>
              <select className="input" value={filtroTipoMov} onChange={(e) => setFiltroTipoMov(e.target.value)} style={{ minWidth: 140 }}>
                <option value="">Todos</option>
                <option value="entrada">Entradas</option>
                <option value="salida">Salidas</option>
                <option value="ajuste">Ajustes</option>
              </select>
            </div>
            <span style={{ fontSize: 12, color: "var(--text-muted)", paddingBottom: 9 }}>
              Últimos 500 movimientos{libro && libroFiltrado.length !== libro.length ? ` · ${libroFiltrado.length} en el filtro` : ""}
            </span>
          </div>

          <div className="surface" style={{ marginTop: 14, overflowX: "auto" }}>
            {libroLoading || libro === null ? (
              <div style={{ padding: "36px 24px", color: "var(--text-muted)" }}>Cargando movimientos…</div>
            ) : libroFiltrado.length === 0 ? (
              <div style={{ padding: "36px 24px", color: "var(--text-muted)" }}>
                {libro.length === 0 ? "Aún no hay movimientos registrados." : "Sin movimientos para el filtro."}
              </div>
            ) : (
              <TablaMovimientos movs={libroFiltrado} conSku />
            )}
          </div>
        </>
      )}

      {/* Diferencias de catálogo con Bsale (última sincronización). */}
      {bsaleDif && createPortal(
        <div onClick={(e) => { if (e.target === e.currentTarget) setBsaleDif(null); }}
          style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.55)", zIndex: 12000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ width: 820, maxWidth: "100%", maxHeight: "88vh", display: "flex", flexDirection: "column", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: 22 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, marginBottom: 6 }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 15.5, fontWeight: 700 }}>Diferencias de catálogo con Bsale</h3>
                <p style={{ margin: "3px 0 0", fontSize: 12, color: "var(--text-muted)" }}>
                  De la última sincronización ({fmtFechaHora(bsaleDif.data?.actualizado_at)}). Solo informativo: la sincronización no crea ni borra productos.
                </p>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn btn-secondary btn-sm" onClick={exportarDiferenciasBsale} disabled={!bsaleDif.data?.detalle} title="Descargar ambas listas en Excel">
                  <Download size={13} /> Exportar
                </button>
                <button className="btn btn-ghost" onClick={() => setBsaleDif(null)} style={{ padding: 6 }}><X size={16} /></button>
              </div>
            </div>
            {bsaleDif.loading ? (
              <div style={{ padding: "36px 24px", color: "var(--text-muted)" }}>Cargando…</div>
            ) : !bsaleDif.data?.detalle ? (
              <div style={{ padding: "36px 24px", color: "var(--text-muted)" }}>Aún no hay una sincronización guardada.</div>
            ) : (
              <div style={{ overflowY: "auto", display: "flex", flexDirection: "column", gap: 16 }}>
                {[
                  { titulo: `En Bsale, sin producto interno (${(bsaleDif.data.detalle.skus_bsale_sin_producto || []).length})`, filas: bsaleDif.data.detalle.skus_bsale_sin_producto || [], col: "Descripción en Bsale", campo: "descripcion" },
                  { titulo: `Internos, sin SKU en Bsale (${(bsaleDif.data.detalle.productos_sin_bsale || []).length})`, filas: bsaleDif.data.detalle.productos_sin_bsale || [], col: "Producto interno", campo: "nombre" },
                ].map((sec) => (
                  <div key={sec.titulo}>
                    <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 6 }}>{sec.titulo}</div>
                    {sec.filas.length === 0 ? (
                      <div style={{ fontSize: 12.5, color: "var(--text-muted)" }}>Sin diferencias — todo calza.</div>
                    ) : (
                      <div style={{ border: "1px solid var(--border)", borderRadius: 8, maxHeight: 240, overflowY: "auto" }}>
                        <table className="data-table" style={{ width: "100%" }}>
                          <thead style={{ position: "sticky", top: 0, background: "var(--surface)" }}>
                            <tr><th style={{ textAlign: "left" }}>SKU</th><th style={{ textAlign: "left" }}>{sec.col}</th></tr>
                          </thead>
                          <tbody>
                            {sec.filas.map((r, i) => (
                              <tr key={`${r.sku}-${i}`}>
                                <td style={{ fontWeight: 600, whiteSpace: "nowrap" }}>{r.sku}</td>
                                <td style={{ color: "var(--text-muted)" }}>{r[sec.campo] || "—"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>,
        document.body
      )}

      {movModal && (
        <ModalMovimiento
          producto={movModal.producto}
          tipoInicial={movModal.tipo}
          onClose={() => setMovModal(null)}
          onListo={(res, tipo) => {
            setMovModal(null);
            aplicarStockLocal(movModal.producto.id, res.stock);
            setToast({ type: "success", message: `${TIPOS_MOV[tipo].label} registrada: ${movModal.producto.sku || movModal.producto.nombre} queda con ${fmtNum(res.stock)} unidades.` });
          }}
          onError={(m) => setToast({ type: "error", message: m })}
        />
      )}

      {histModal && createPortal(
        <div onClick={(e) => { if (e.target === e.currentTarget) setHistModal(null); }}
          style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.55)", zIndex: 12000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ width: 780, maxWidth: "100%", maxHeight: "88vh", display: "flex", flexDirection: "column", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: 22 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, marginBottom: 10 }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 15.5, fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}>
                  <History size={16} /> Historial · {histModal.producto.sku || histModal.producto.nombre}
                </h3>
                <p style={{ margin: "3px 0 0", fontSize: 12, color: "var(--text-muted)" }}>
                  Stock vigente: <b>{fmtNum(Number(histModal.producto.stock) || 0)}</b> unidades
                </p>
              </div>
              <button className="btn btn-ghost" onClick={() => setHistModal(null)} style={{ padding: 6 }}><X size={16} /></button>
            </div>
            <div style={{ overflow: "auto", border: "1px solid var(--border)", borderRadius: 10 }}>
              {histModal.loading ? (
                <div style={{ padding: "30px 20px", color: "var(--text-muted)" }}>Cargando…</div>
              ) : histModal.movs.length === 0 ? (
                <div style={{ padding: "30px 20px", color: "var(--text-muted)" }}>Este producto aún no tiene movimientos.</div>
              ) : (
                <TablaMovimientos movs={histModal.movs} />
              )}
            </div>
          </div>
        </div>,
        document.body
      )}

      {cargaOpen && (
        <ModalCargaMasiva
          onClose={() => setCargaOpen(false)}
          onListo={(res) => {
            setCargaOpen(false);
            const partes = [`${res.aplicadas} ajuste${res.aplicadas === 1 ? "" : "s"} aplicado${res.aplicadas === 1 ? "" : "s"}`];
            if (res.sin_cambio) partes.push(`${res.sin_cambio} sin cambio`);
            if (res.no_encontrados?.length) partes.push(`${res.no_encontrados.length} SKU no encontrados`);
            if (res.errores?.length) partes.push(`${res.errores.length} con error`);
            setToast({ type: res.errores?.length ? "info" : "success", message: `Carga terminada: ${partes.join(" · ")}.` });
            cargar();
            setLibro(null);
          }}
          onError={(m) => setToast({ type: "error", message: m })}
        />
      )}
    </div>
  );
}

/* Tabla de movimientos compartida por el libro y el historial del producto. */
function TablaMovimientos({ movs, conSku = false }) {
  return (
    <table className="data-table" style={{ width: "100%", minWidth: conSku ? 860 : 700 }}>
      <thead>
        <tr>
          <th style={{ textAlign: "left", whiteSpace: "nowrap" }}>Fecha</th>
          {conSku && <th style={{ textAlign: "left", whiteSpace: "nowrap" }}>SKU</th>}
          <th style={{ textAlign: "left" }}>Tipo</th>
          <th style={{ textAlign: "right", whiteSpace: "nowrap" }} title="Entradas suman, salidas restan; en los ajustes es el delta aplicado tras el conteo">Cantidad</th>
          <th style={{ textAlign: "right", whiteSpace: "nowrap" }}>Stock resultante</th>
          <th style={{ textAlign: "left", minWidth: 160 }}>Motivo</th>
          <th style={{ textAlign: "left" }}>Referencia</th>
          <th style={{ textAlign: "left", whiteSpace: "nowrap" }}>Usuario</th>
        </tr>
      </thead>
      <tbody>
        {movs.map((m) => {
          const t = TIPOS_MOV[m.tipo] || { label: m.tipo, color: "var(--text-muted)", bg: "var(--neutral-bg)" };
          const cant = Number(m.cantidad) || 0;
          const signo = m.tipo === "entrada" ? "+" : m.tipo === "salida" ? "−" : cant > 0 ? "+" : "−";
          return (
            <tr key={m.id}>
              <td style={{ whiteSpace: "nowrap", fontSize: 12.5 }}>{fmtFechaHora(m.created_at)}</td>
              {conSku && <td style={{ whiteSpace: "nowrap", fontWeight: 600, fontSize: 12.5 }}>{m.sku || "—"}</td>}
              <td>
                <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 999, background: t.bg, color: t.color, whiteSpace: "nowrap" }}>{t.label}</span>
              </td>
              <td style={{ textAlign: "right", fontWeight: 700, whiteSpace: "nowrap", color: signo === "+" ? "#15803d" : "#b91c1c" }}>
                {signo}{fmtNum(Math.abs(cant))}
              </td>
              <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>{fmtNum(Number(m.stock_resultante) || 0)}</td>
              <td style={{ fontSize: 12.5, whiteSpace: "normal", wordBreak: "break-word" }}>{m.motivo || "—"}</td>
              <td style={{ fontSize: 12.5, whiteSpace: "nowrap" }}>{m.referencia || "—"}</td>
              <td style={{ fontSize: 12, color: "var(--text-muted)", whiteSpace: "nowrap" }}>{(m.usuario_email || "—").split("@")[0]}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/* Modal para registrar UNA entrada, salida o ajuste. */
function ModalMovimiento({ producto, tipoInicial, onClose, onListo, onError }) {
  const [tipo, setTipo] = useState(tipoInicial || "entrada");
  const [cantidad, setCantidad] = useState("");
  const [nuevoStock, setNuevoStock] = useState("");
  const [motivo, setMotivo] = useState("");
  const [referencia, setReferencia] = useState("");
  const [costoUnitario, setCostoUnitario] = useState("");
  const [guardando, setGuardando] = useState(false);
  const stockActual = Number(producto.stock) || 0;

  async function guardar() {
    if (guardando) return;
    setGuardando(true);
    try {
      const body = {
        productoId: producto.id,
        tipo,
        motivo,
        referencia,
      };
      if (tipo === "ajuste") body.nuevoStock = Number(String(nuevoStock).replace(",", "."));
      else body.cantidad = Number(String(cantidad).replace(",", "."));
      if (tipo === "entrada" && costoUnitario) body.costoUnitario = Number(String(costoUnitario).replace(/[^\d]/g, ""));
      const res = await api.post("/inventario/movimientos", body);
      onListo?.(res, tipo);
    } catch (e) {
      onError?.(e?.message || "No se pudo registrar el movimiento.");
    } finally {
      setGuardando(false);
    }
  }

  const t = TIPOS_MOV[tipo];
  return createPortal(
    <div onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.55)", zIndex: 12000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div style={{ width: 440, maxWidth: "100%", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: 22 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
          <h3 style={{ margin: 0, fontSize: 15.5, fontWeight: 700 }}>Registrar movimiento</h3>
          <button className="btn btn-ghost" onClick={onClose} style={{ padding: 6 }}><X size={16} /></button>
        </div>
        <p style={{ margin: "0 0 12px", fontSize: 12.5, color: "var(--text-muted)" }}>
          <b>{producto.sku || "sin SKU"}</b> · {producto.nombre} · stock vigente: <b>{fmtNum(stockActual)}</b>
        </p>

        <div className="segmentado" style={{ display: "flex", marginBottom: 12 }}>
          {Object.entries(TIPOS_MOV).map(([key, info]) => (
            <button key={key} type="button" onClick={() => setTipo(key)}
              className={tipo === key ? "activo" : undefined}
              style={{ flex: 1, padding: "7px 0", fontSize: 12.5, fontWeight: 700, cursor: "pointer",
                border: "1px solid var(--border)",
                background: tipo === key ? info.bg : "var(--surface)", color: tipo === key ? info.color : "var(--text-muted)" }}>
              {info.label}
            </button>
          ))}
        </div>

        {tipo === "ajuste" ? (
          <div style={{ marginBottom: 10 }}>
            <label className="filter-label">Stock contado (conteo físico)</label>
            <input className="input" inputMode="numeric" autoFocus value={nuevoStock}
              onChange={(e) => setNuevoStock(e.target.value.replace(/[^\d.,]/g, ""))}
              placeholder={`Vigente: ${fmtNum(stockActual)}`} />
            {nuevoStock !== "" && Number.isFinite(Number(nuevoStock.replace(",", "."))) && (
              <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 4 }}>
                Delta que quedará en el libro: <b>{Number(nuevoStock.replace(",", ".")) - stockActual > 0 ? "+" : ""}{fmtNum(Number(nuevoStock.replace(",", ".")) - stockActual)}</b>
              </div>
            )}
          </div>
        ) : (
          <div style={{ marginBottom: 10 }}>
            <label className="filter-label">Cantidad</label>
            <input className="input" inputMode="numeric" autoFocus value={cantidad}
              onChange={(e) => setCantidad(e.target.value.replace(/[^\d.,]/g, ""))}
              placeholder={tipo === "salida" ? `Disponible: ${fmtNum(stockActual)}` : "Unidades que entran"} />
          </div>
        )}

        {tipo === "entrada" && (
          <div style={{ marginBottom: 10 }}>
            <label className="filter-label">Costo unitario (opcional)</label>
            <input className="input" inputMode="numeric" value={costoUnitario ? `$${Number(costoUnitario.replace(/[^\d]/g, "") || 0).toLocaleString("es-CL")}` : ""}
              onChange={(e) => setCostoUnitario(e.target.value.replace(/[^\d]/g, ""))}
              placeholder="Costo de esta compra (queda en el libro)" />
          </div>
        )}

        <div style={{ marginBottom: 10 }}>
          <label className="filter-label">Motivo</label>
          <input className="input" value={motivo} onChange={(e) => setMotivo(e.target.value)}
            placeholder={tipo === "entrada" ? "Ej: Compra proveedor, devolución de cliente…" : tipo === "salida" ? "Ej: Venta, merma, muestra…" : "Ej: Inventario físico, corrección…"} />
        </div>
        <div style={{ marginBottom: 16 }}>
          <label className="filter-label">Referencia (opcional)</label>
          <input className="input" value={referencia} onChange={(e) => setReferencia(e.target.value)}
            placeholder="N° de OC, código de cotización, guía…" />
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button className="btn btn-secondary" onClick={onClose} disabled={guardando}>Cancelar</button>
          <button className="btn btn-primary" onClick={guardar} disabled={guardando} style={{ background: t.color, borderColor: t.color }}>
            {guardando ? "Guardando…" : `Registrar ${t.label.toLowerCase()}`}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

/* Carga masiva de conteo: planilla con columnas sku, stock y (opcional)
   stock_minimo. Cada diferencia queda como ajuste auditado en el libro. */
function ModalCargaMasiva({ onClose, onListo, onError }) {
  const [filas, setFilas] = useState([]);
  const [nombreArchivo, setNombreArchivo] = useState("");
  const [motivo, setMotivo] = useState("Inventario físico");
  const [parsing, setParsing] = useState(false);
  const [enviando, setEnviando] = useState(false);

  async function manejarArchivo(file) {
    if (!file) return;
    setNombreArchivo(file.name);
    setParsing(true);
    try {
      const XLSX = await import("xlsx");
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const raw = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: "", raw: false });
      const norm = [];
      for (const row of raw) {
        const o = {};
        for (const [k, v] of Object.entries(row)) {
          const key = String(k || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "_");
          const val = String(v ?? "").trim();
          if (key === "sku") o.sku = val;
          else if (key === "stock" || key === "cantidad" || key === "conteo") o.stock = Number(val.replace(/\./g, "").replace(",", "."));
          else if (key.includes("minimo")) o.stock_minimo = Number(val.replace(/\./g, "").replace(",", "."));
        }
        if (o.sku && (Number.isFinite(o.stock) || Number.isFinite(o.stock_minimo))) norm.push(o);
      }
      setFilas(norm);
      if (!norm.length) onError?.("No se encontraron filas con columnas 'sku' y 'stock' (o 'stock_minimo').");
    } catch {
      onError?.("No se pudo leer el archivo. ¿Es un .xlsx / .csv válido?");
      setFilas([]);
    } finally {
      setParsing(false);
    }
  }

  async function enviar() {
    if (!filas.length || enviando) return;
    setEnviando(true);
    try {
      const res = await api.post("/inventario/carga-masiva", { rows: filas, motivo });
      onListo?.(res);
    } catch (e) {
      onError?.(e?.message || "No se pudo procesar la carga.");
    } finally {
      setEnviando(false);
    }
  }

  return createPortal(
    <div onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.55)", zIndex: 12000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div style={{ width: 520, maxWidth: "100%", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: 22 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}>
            <Upload size={17} /> Carga masiva de inventario
          </h3>
          <button className="btn btn-ghost" onClick={onClose} style={{ padding: 6 }}><X size={16} /></button>
        </div>
        <p style={{ fontSize: 12.5, color: "var(--text-muted)", marginTop: 2, marginBottom: 14 }}>
          Planilla con columnas <b>sku</b> y <b>stock</b> (el conteo físico), y opcionalmente <b>stock_minimo</b>.
          Cada SKU cuyo conteo difiera del vigente queda como un <b>ajuste</b> en el libro, con el motivo de abajo.
          Los SKUs que no existen en el catálogo se informan sin aplicar.
        </p>

        <label
          style={{ display: "block", border: "2px dashed var(--border)", borderRadius: 10, padding: "22px 16px", textAlign: "center", cursor: "pointer", background: "var(--bg)" }}>
          <Upload size={22} style={{ color: "var(--text-muted)" }} />
          <div style={{ fontSize: 13, marginTop: 6 }}>
            {nombreArchivo ? <strong>{nombreArchivo}</strong> : "Haz clic para elegir un archivo .xlsx / .xls / .csv"}
          </div>
          <input type="file" accept=".xlsx,.xls,.csv" style={{ display: "none" }} onChange={(e) => manejarArchivo(e.target.files?.[0])} />
        </label>

        {parsing && <p style={{ fontSize: 12.5, marginTop: 10 }}>Leyendo archivo…</p>}
        {!parsing && filas.length > 0 && (
          <p style={{ fontSize: 13, marginTop: 12 }}>
            <strong>{filas.length}</strong> fila(s) detectada(s).
          </p>
        )}

        <div style={{ marginTop: 12 }}>
          <label className="filter-label">Motivo del ajuste</label>
          <input className="input" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 18 }}>
          <button className="btn btn-secondary" onClick={onClose} disabled={enviando}>Cancelar</button>
          <button className="btn btn-primary" onClick={enviar} disabled={enviando || parsing || filas.length === 0}>
            {enviando ? "Procesando…" : `Aplicar ${filas.length || ""}`.trim()}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
