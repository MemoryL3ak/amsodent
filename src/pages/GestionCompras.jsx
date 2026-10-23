import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle, Boxes, CalendarDays, ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown,
  ClipboardList, Download, ExternalLink, PackageCheck, PackageX, RefreshCw, Search, ShoppingCart, Wallet,
} from "lucide-react";
import { api } from "../lib/api";
import { useStickyState } from "../lib/useStickyState";
import { descargarCSV } from "../lib/reporteStock";
import DropdownSelect from "../components/ui/DropdownSelect";
import BotonLimpiarFiltros from "../components/BotonLimpiarFiltros";

/* ── Gestión de compras (2026-10-16 · rediseño 2026-10-22) ──────────────────
   Pedido de Ariel: las cotizaciones adjudicadas desde ahora en adelante, con
   lo que falta despachar de cada producto contra el stock del inventario y el
   porcentaje (por unidades) que tenemos para despacharlas al 100 %. El stock
   se reparte por orden de adjudicación (la más antigua primero) y lo que no
   alcanza va a «Por comprar». El cálculo vive en el backend
   (gestion-compras.service.ts); esta página solo filtra, ordena y muestra.

   Rediseño 2026-10-22 ("algo bien customizado, con estilos"): KPIs con anillo
   de cobertura y desglose por estado, tabla principal con una fila por
   cotización y detalle por producto con semáforo (verde cubierto, ámbar
   parcial, rojo sin stock), filtros de vendedor, orden y fecha, expandir todo,
   total de la lista de compras y exportación a CSV. Estilos en styles.css
   bajo «Gestión de compras» (clases gc-*).

   2026-10-23 (Ariel): el detalle por producto lleva la columna «Costo neto»
   (el costo del producto en el catálogo, el mismo de «Por comprar»; no el
   que quedó guardado en la cotización) y los enlaces a la cotización abren
   en una pestaña nueva para no perder la gestión. El nombre de un producto
   del catálogo también es un enlace: abre Editar Producto en otra pestaña
   (producto_id lo entrega el backend, que cruza por SKU y, sin SKU, por
   nombre: los transitorios del catálogo también enlazan y traen su costo;
   solo lo que no está en el catálogo queda como texto y «sin costo»). */

const POR_PAGINA = 20;
const clp = (n) => `$${Math.round(Number(n) || 0).toLocaleString("es-CL")}`;
const num = (n) => (n == null ? "—" : Number(n).toLocaleString("es-CL"));
const pct = (n) => `${Number(n || 0).toLocaleString("es-CL", { maximumFractionDigits: 1 })} %`;
const fechaCL = (iso) => {
  const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : "—";
};
const sinTildes = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const diasEntre = (desde, hasta) => {
  const a = String(desde || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  const b = String(hasta || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!a || !b) return null;
  return Math.round((Date.UTC(+b[1], +b[2] - 1, +b[3]) - Date.UTC(+a[1], +a[2] - 1, +a[3])) / 86400000);
};
const haceDias = (d) => (d == null ? "" : d <= 0 ? "hoy" : d === 1 ? "ayer" : `hace ${d} días`);
// Semáforo de cobertura: verde con todo el stock, ámbar con la mitad o más, rojo bajo eso.
const tono = (cobertura) => (cobertura >= 100 ? "ok" : cobertura >= 50 ? "medio" : "bajo");

const ESTADOS = {
  lista: { texto: "Stock completo", tono: "ok" },
  parcial: { texto: "Stock parcial", tono: "medio" },
  sin_stock: { texto: "Sin stock", tono: "bajo" },
  despachada: { texto: "Despachada", tono: "neutro" },
  cerrada: { texto: "Cierre forzado", tono: "neutro" },
  sin_items: { texto: "Sin productos", tono: "neutro" },
};
// Por defecto de la adjudicación más antigua a la más nueva (pedido de Ariel 2026-10-22): es el orden en que se reparte el stock.
const ORDENES = [
  { value: "antigua", label: "Adjudicación más antigua" },
  { value: "reciente", label: "Adjudicación más reciente" },
  { value: "cobertura", label: "Menor cobertura primero" },
  { value: "falta", label: "Más unidades faltantes" },
  { value: "neto", label: "Mayor monto neto" },
  { value: "cliente", label: "Cliente (A–Z)" },
];

function Anillo({ valor, tamano = 64, grosor = 7 }) {
  const v = Math.max(0, Math.min(100, Number(valor) || 0));
  const r = (tamano - grosor) / 2;
  const largo = 2 * Math.PI * r;
  return (
    <svg className={`gc-anillo gc-tono-${tono(v)}`} width={tamano} height={tamano} viewBox={`0 0 ${tamano} ${tamano}`} role="img" aria-label={`Cobertura ${pct(valor)}`}>
      <circle className="gc-anillo-fondo" cx={tamano / 2} cy={tamano / 2} r={r} strokeWidth={grosor} fill="none" />
      <circle
        className="gc-anillo-valor" cx={tamano / 2} cy={tamano / 2} r={r} strokeWidth={grosor} fill="none" strokeLinecap="round"
        strokeDasharray={`${(largo * v) / 100} ${largo}`} transform={`rotate(-90 ${tamano / 2} ${tamano / 2})`}
      />
      <text x="50%" y="50%" dominantBaseline="central" textAnchor="middle" className="gc-anillo-texto">{Math.round(v)}%</text>
    </svg>
  );
}

function Barra({ valor }) {
  const v = Math.max(0, Math.min(100, Number(valor) || 0));
  return (
    <div className={`gc-barra gc-tono-${tono(v)}`} title={`Cobertura de stock: ${pct(valor)}`}>
      <div className="gc-barra-pista"><div className="gc-barra-relleno" style={{ width: `${v}%` }} /></div>
      <span className="gc-barra-pct">{pct(valor)}</span>
    </div>
  );
}

function Pastilla({ estado }) {
  const e = ESTADOS[estado] || ESTADOS.sin_items;
  return <span className={`gc-pill gc-tono-${e.tono}`}>{e.texto}</span>;
}

// Transitorio = está en el catálogo sin SKU (sin stock que mirar); lo que no calzó ni por SKU ni por nombre no está en el catálogo.
function Etiquetas({ p }) {
  if (!p.sin_sku && p.en_catalogo) return null;
  return (
    <span className="gc-etiquetas">
      {p.en_catalogo
        ? <span className="gc-etiqueta gc-etiqueta-aviso" title="Producto del catálogo sin SKU: no tiene stock en Bsale, cuenta como por comprar">Transitorio</span>
        : <span className="gc-etiqueta gc-etiqueta-aviso" title="No calzó con ningún producto del catálogo, ni por SKU ni por nombre">No está en el catálogo</span>}
    </span>
  );
}

// Nombre del producto: enlace a Editar Producto en otra pestaña cuando está en el catálogo; si no, solo texto.
function NombreProducto({ p }) {
  const nombre = p.producto || "—";
  if (!p.producto_id) return <div className="gc-producto-nombre">{nombre}</div>;
  // El ícono va pegado a la última palabra para que no caiga solo a la línea siguiente.
  const palabras = nombre.split(" ");
  const ultima = palabras.pop();
  return (
    <div className="gc-producto-nombre">
      <Link to={`/productos/editar/${p.producto_id}`} target="_blank" rel="noopener noreferrer" className="gc-producto-link" onClick={(e) => e.stopPropagation()} title="Abrir el producto en una pestaña nueva">
        {palabras.length ? `${palabras.join(" ")} ` : ""}<span className="gc-producto-link-final">{ultima}<ExternalLink size={11} aria-hidden="true" /></span>
      </Link>
    </div>
  );
}

// Costo neto unitario del producto en el catálogo (el mismo de «Por comprar»), no el que quedó en la cotización.
function Costo({ p }) {
  if (p.costo) return <span title="Costo neto unitario del producto en el catálogo">{clp(p.costo)}</span>;
  return <span className="gc-sin-dato" title={p.en_catalogo ? "El producto no tiene costo en el catálogo" : "El producto no está en el catálogo"}>sin costo</span>;
}

function Paginacion({ pagina, total, onCambiar, nombre }) {
  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA));
  if (total <= POR_PAGINA) return null;
  return (
    <div className="gc-paginacion">
      <span>{((pagina - 1) * POR_PAGINA + 1).toLocaleString("es-CL")}–{Math.min(total, pagina * POR_PAGINA).toLocaleString("es-CL")} de {total.toLocaleString("es-CL")} {nombre}</span>
      <span className="gc-paginacion-botones">
        <button type="button" className="btn btn-secondary btn-sm" disabled={pagina <= 1} onClick={() => onCambiar(pagina - 1)}>Anterior</button>
        <button type="button" className="btn btn-secondary btn-sm" disabled={pagina >= paginas} onClick={() => onCambiar(pagina + 1)}>Siguiente</button>
      </span>
    </div>
  );
}

function Vacio({ icono, titulo, detalle }) {
  return (
    <div className="gc-vacio">
      {icono}
      <div className="gc-vacio-titulo">{titulo}</div>
      {detalle && <div className="gc-vacio-detalle">{detalle}</div>}
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
  const [vendedor, setVendedor] = useStickyState("gestionCompras.vendedor", "");
  const [orden, setOrden] = useStickyState("gestionCompras.orden", "antigua");
  const [desde, setDesde] = useStickyState("gestionCompras.desde", "");
  const [abiertas, setAbiertas] = useState([]);
  const [pagina, setPagina] = useState(1);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError("");
    try {
      const r = await api.get(`/gestion-compras${/^\d{4}-\d{2}-\d{2}$/.test(desde) ? `?desde=${desde}` : ""}`);
      setDatos(r);
      // Si pedí una fecha anterior al inicio del módulo el servidor la sube al inicio: el campo refleja lo que se calculó.
      if (desde && r?.desde && r.desde !== desde) setDesde(r.desde === r.inicio ? "" : r.desde);
    } catch (e) {
      setError(e?.message || "No se pudo cargar la gestión de compras.");
    } finally {
      setCargando(false);
    }
  }, [desde, setDesde]);
  useEffect(() => { cargar(); }, [cargar]);
  useEffect(() => { setPagina(1); }, [q, estado, vendedor, orden, pestana]);

  const texto = sinTildes(q.trim());
  const vendedores = useMemo(() => {
    const s = new Set((datos?.cotizaciones || []).map((c) => c.vendedor).filter(Boolean));
    return [...s].sort((a, b) => a.localeCompare(b, "es"));
  }, [datos]);

  const cotizaciones = useMemo(() => {
    const lista = (datos?.cotizaciones || []).filter((c) => {
      if (estado === "pendientes" && (c.estado === "despachada" || c.estado === "sin_items" || c.estado === "cerrada")) return false;
      if (estado === "faltantes" && c.estado !== "parcial" && c.estado !== "sin_stock") return false;
      if (!["pendientes", "faltantes", "todas"].includes(estado) && c.estado !== estado) return false;
      if (vendedor && c.vendedor !== vendedor) return false;
      if (texto && !sinTildes(`#${c.id} ${c.codigo || ""} ${c.cliente} ${c.rut} ${c.vendedor} ${c.productos.map((p) => `${p.sku} ${p.producto}`).join(" ")}`).includes(texto)) return false;
      return true;
    });
    const cmp = {
      reciente: (a, b) => b.fecha_adjudicada.localeCompare(a.fecha_adjudicada) || b.id - a.id,
      antigua: (a, b) => a.fecha_adjudicada.localeCompare(b.fecha_adjudicada) || a.id - b.id,
      cobertura: (a, b) => a.cobertura - b.cobertura || b.unidades.faltan - a.unidades.faltan,
      falta: (a, b) => b.unidades.faltan - a.unidades.faltan || a.cobertura - b.cobertura,
      neto: (a, b) => b.neto - a.neto,
      cliente: (a, b) => String(a.cliente).localeCompare(String(b.cliente), "es") || b.id - a.id,
    }[orden] || (() => 0);
    return [...lista].sort(cmp);
  }, [datos, estado, vendedor, texto, orden]);

  const compras = useMemo(
    () => (datos?.compras || []).filter((e) => !texto || sinTildes(`${e.sku} ${e.producto} ${e.cotizaciones.map((id) => `#${id}`).join(" ")}`).includes(texto)),
    [datos, texto],
  );
  const totalesCompras = useMemo(() => compras.reduce((a, e) => ({ falta: a.falta + e.falta, valor: a.valor + (e.valor_estimado || 0), sinCosto: a.sinCosto + (e.costo ? 0 : 1) }), { falta: 0, valor: 0, sinCosto: 0 }), [compras]);

  const lista = pestana === "compras" ? compras : cotizaciones;
  const visibles = lista.slice((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA);
  const k = datos?.kpis;
  const hayFiltros = !!q.trim() || estado !== "pendientes" || !!vendedor || orden !== "antigua" || !!desde;
  const limpiar = () => { setQ(""); setEstado("pendientes"); setVendedor(""); setOrden("antigua"); setDesde(""); };

  // Desglose por estado para el KPI de cotizaciones (sobre lo que está en gestión, no sobre lo filtrado).
  const desglose = useMemo(() => {
    const en = (datos?.cotizaciones || []).filter((c) => c.estado !== "despachada" && c.estado !== "sin_items" && c.estado !== "cerrada");
    return { lista: en.filter((c) => c.estado === "lista").length, parcial: en.filter((c) => c.estado === "parcial").length, sin_stock: en.filter((c) => c.estado === "sin_stock").length };
  }, [datos]);

  const todasAbiertas = visibles.length > 0 && visibles.every((c) => abiertas.includes(c.id));
  const alternarTodas = () => setAbiertas(todasAbiertas ? [] : visibles.map((c) => c.id));
  const alternar = (id) => setAbiertas((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  const verFaltantes = (c) => { setPestana("compras"); setQ(`#${c.id}`); };

  const exportar = () => {
    const hoy = (datos?.hoy || new Date().toISOString().slice(0, 10)).replace(/-/g, "");
    if (pestana === "compras") {
      descargarCSV(
        `por-comprar-${hoy}.csv`,
        ["SKU", "Producto", "Por despachar", "Stock", "Falta comprar", "Costo neto", "Valor estimado", "Cotizaciones"],
        compras.map((e) => [e.sku || "Sin SKU", e.producto, e.por_despachar, e.stock ?? "", e.falta, e.costo ?? "", e.valor_estimado ?? "", e.cotizaciones.map((id) => `#${id}`).join(" ")]),
      );
      return;
    }
    descargarCSV(
      `cotizaciones-vs-stock-${hoy}.csv`,
      ["Cotización", "Código", "Cliente", "RUT", "Vendedor", "Adjudicada", "Estado", "Cobertura %", "SKU", "Producto", "Cotizado", "Despachado", "Por despachar", "Stock", "Asignado", "Falta", "Costo neto"],
      cotizaciones.flatMap((c) => c.productos.map((p) => [c.id, c.codigo || "", c.cliente, c.rut, c.vendedor, fechaCL(c.fecha_adjudicada), (ESTADOS[c.estado] || ESTADOS.sin_items).texto, c.cobertura, p.sku || "Sin SKU", p.producto, p.cotizado, p.despachado, p.por_despachar, p.stock ?? "", p.asignado, p.falta, p.costo ?? ""])),
    );
  };

  return (
    <div className="page gestion-compras">
      <div className="page-header gc-cabecera">
        <div className="gc-cabecera-texto">
          <h1 className="page-title">Gestión de compras</h1>
          <p className="page-subtitle">
            Cotizaciones adjudicadas desde el {fechaCL(datos?.inicio || "2026-10-16")}: lo que falta despachar de cada producto frente al stock del inventario.
            El stock se reparte por orden de adjudicación (la más antigua primero); lo que no alcanza queda en «Por comprar».
          </p>
        </div>
        <div className="page-actions gc-acciones">
          <button type="button" className="btn btn-secondary" onClick={exportar} disabled={!lista.length} title={pestana === "compras" ? "Descargar la lista de compras en CSV (Excel)" : "Descargar el detalle por producto de las cotizaciones filtradas en CSV (Excel)"}>
            <Download size={14} /> Exportar
          </button>
          <button type="button" className="btn btn-secondary" onClick={cargar} disabled={cargando}>
            <RefreshCw size={14} className={cargando ? "spin" : ""} /> Actualizar
          </button>
        </div>
      </div>

      {error && <div className="gc-error">{error}</div>}

      <div className="gc-kpis">
        <button type="button" className="gc-kpi gc-kpi-primario" onClick={() => { setPestana("cotizaciones"); setEstado("pendientes"); }} title="Ver las cotizaciones por despachar">
          <div className="gc-kpi-label"><ClipboardList size={14} /> Por despachar</div>
          <div className="gc-kpi-valor">{num(k?.cotizaciones ?? 0)}</div>
          <div className="gc-kpi-sub">cotizaciones adjudicadas con despacho pendiente</div>
          <div className="gc-kpi-chips">
            <span className="gc-chip gc-tono-ok">{num(desglose.lista)} completas</span>
            <span className="gc-chip gc-tono-medio">{num(desglose.parcial)} parciales</span>
            <span className="gc-chip gc-tono-bajo">{num(desglose.sin_stock)} sin stock</span>
          </div>
        </button>
        <div className="gc-kpi gc-kpi-cobertura">
          <div className="gc-kpi-label"><Boxes size={14} /> Cobertura de stock</div>
          <div className="gc-kpi-fila">
            <Anillo valor={k?.cobertura ?? 100} />
            <div className="gc-kpi-fila-texto">
              <div className={`gc-kpi-valor gc-tono-${tono(k?.cobertura ?? 100)}`}>{k ? pct(k.cobertura) : "—"}</div>
              <div className="gc-kpi-sub">{num((k?.unidades_por_despachar ?? 0) - (k?.unidades_faltan ?? 0))} de {num(k?.unidades_por_despachar ?? 0)} unidades con stock</div>
            </div>
          </div>
        </div>
        <button type="button" className="gc-kpi gc-kpi-rojo" onClick={() => setPestana("compras")} title="Ver lo que hay que comprar">
          <div className="gc-kpi-label"><PackageX size={14} /> Unidades por comprar</div>
          <div className={`gc-kpi-valor ${k?.unidades_faltan ? "gc-tono-bajo" : ""}`}>{num(k?.unidades_faltan ?? 0)}</div>
          <div className="gc-kpi-sub">en {num(k?.skus_por_comprar ?? 0)} producto{k?.skus_por_comprar === 1 ? "" : "s"} distinto{k?.skus_por_comprar === 1 ? "" : "s"}</div>
        </button>
        <div className="gc-kpi gc-kpi-ambar">
          <div className="gc-kpi-label"><Wallet size={14} /> Valor estimado de compra</div>
          <div className="gc-kpi-valor gc-kpi-valor-monto">{clp(k?.valor_por_comprar ?? 0)}</div>
          <div className="gc-kpi-sub">a costo neto del catálogo{k?.sin_costo ? ` · ${num(k.sin_costo)} producto${k.sin_costo === 1 ? "" : "s"} sin costo` : ""}</div>
        </div>
      </div>

      {(datos?.avisos || []).length > 0 && (
        <div className="gc-aviso">
          <AlertTriangle size={16} />
          <ul>{datos.avisos.map((a, i) => <li key={i}>{a}</li>)}</ul>
        </div>
      )}

      <div className="pagos-tabs" role="tablist" aria-label="Vista de Gestión de compras">
        {[
          { value: "cotizaciones", label: "Cotizaciones", n: cotizaciones.length, Icono: ClipboardList },
          { value: "compras", label: "Por comprar", n: compras.length, Icono: ShoppingCart },
        ].map((p) => (
          <button key={p.value} type="button" role="tab" aria-selected={pestana === p.value} className={pestana === p.value ? "activo" : ""} onClick={() => setPestana(p.value)}>
            <p.Icono size={15} /> {p.label} <span className="pagos-tab-n">{num(p.n)}</span>
          </button>
        ))}
      </div>

      <div className="filter-bar gc-filtros">
        <div className="filter-field gc-filtro-buscar">
          <label className="filter-label">Buscar</label>
          <span className="gc-buscar">
            <Search size={14} />
            <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder={pestana === "compras" ? "SKU, producto o #cotización…" : "Cotización, cliente, vendedor, SKU…"} />
          </span>
        </div>
        {pestana === "cotizaciones" && (
          <>
            <div className="filter-field gc-filtro">
              <label className="filter-label">Stock</label>
              <DropdownSelect
                value={estado} onChange={setEstado} minWidth={180} style={{ width: "100%" }}
                options={[
                  { value: "pendientes", label: "Por despachar" },
                  { value: "faltantes", label: "Con faltantes", detalle: "Parciales y sin stock" },
                  { value: "lista", label: "Stock completo", color: "#16a34a" },
                  { value: "parcial", label: "Stock parcial", color: "#ca8a04" },
                  { value: "sin_stock", label: "Sin stock", color: "#dc2626" },
                  { value: "despachada", label: "Despachadas" },
                  { value: "cerrada", label: "Cierre forzado", detalle: "No toman stock ni entran en Por comprar" },
                  { value: "todas", label: "Todas" },
                ]}
              />
            </div>
            {vendedores.length > 1 && (
              <div className="filter-field gc-filtro">
                <label className="filter-label">Vendedor</label>
                <DropdownSelect value={vendedor} onChange={setVendedor} minWidth={180} style={{ width: "100%" }} options={[{ value: "", label: "Todos" }, ...vendedores.map((v) => ({ value: v, label: v }))]} />
              </div>
            )}
            <div className="filter-field gc-filtro">
              <label className="filter-label">Ordenar por</label>
              <DropdownSelect value={orden} onChange={setOrden} minWidth={200} style={{ width: "100%" }} options={ORDENES} />
            </div>
            <div className="filter-field gc-filtro-fecha">
              <label className="filter-label">Adjudicadas desde</label>
              <span className="gc-fecha">
                <CalendarDays size={14} />
                <input type="date" className="input" value={desde} min={datos?.inicio || "2026-10-16"} max={datos?.hoy || undefined} onChange={(e) => setDesde(e.target.value)} title={`Como mínimo el ${fechaCL(datos?.inicio || "2026-10-16")}, el día que nació el módulo`} />
              </span>
            </div>
          </>
        )}
        <div className="gc-filtros-extremo">
          {pestana === "cotizaciones" && visibles.length > 0 && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={alternarTodas} title={todasAbiertas ? "Contraer el detalle de todas las cotizaciones de esta página" : "Desplegar el detalle por producto de todas las cotizaciones de esta página"}>
              {todasAbiertas ? <ChevronsDownUp size={14} /> : <ChevronsUpDown size={14} />} {todasAbiertas ? "Contraer todo" : "Expandir todo"}
            </button>
          )}
          <BotonLimpiarFiltros hay={hayFiltros} onLimpiar={limpiar} />
        </div>
      </div>

      <div className="gc-leyenda">
        <span className="gc-leyenda-item gc-tono-ok"><i /> Stock completo (100 %)</span>
        <span className="gc-leyenda-item gc-tono-medio"><i /> Stock parcial (50–99 %)</span>
        <span className="gc-leyenda-item gc-tono-bajo"><i /> Sin stock o bajo 50 %</span>
        <span className="gc-leyenda-nota">La cobertura se mide en unidades por despachar.</span>
      </div>

      <div className="surface gc-superficie">
        {cargando && !datos ? (
          <div className="gc-cargando"><RefreshCw size={16} className="spin" /> Cargando cotizaciones, guías y stock…</div>
        ) : !lista.length ? (
          pestana === "compras"
            ? (datos?.compras || []).length
              ? <Vacio icono={<Search size={30} />} titulo="Ningún producto calza con la búsqueda." detalle="Prueba con otro SKU, nombre o #cotización." />
              : <Vacio icono={<PackageCheck size={30} />} titulo="No hay nada que comprar." detalle="El stock del inventario alcanza para todo lo adjudicado." />
            : (datos?.cotizaciones || []).length
              ? <Vacio icono={<Search size={30} />} titulo="Ninguna cotización calza con los filtros." detalle="Cambia el estado, el vendedor o la fecha, o limpia los filtros." />
              : <Vacio icono={<ClipboardList size={30} />} titulo={`Todavía no hay cotizaciones adjudicadas desde el ${fechaCL(datos?.desde || datos?.inicio)}.`} />
        ) : pestana === "compras" ? (
          <div className="gc-scroll">
            <table className="data-table tabla-compacta cabecera-flexible tabla-texto gc-tabla gc-tabla-compras">
              <thead>
                <tr>
                  <th>Producto</th>
                  <th className="gc-num" title="Unidades que falta despachar sumando todas las cotizaciones">Por despachar</th>
                  <th className="gc-num" title="Stock actual del inventario">Stock</th>
                  <th className="gc-num" title="Unidades que el stock no alcanza a cubrir">Falta comprar</th>
                  <th className="gc-num">Costo neto</th>
                  <th className="gc-num" title="Falta comprar × costo neto">Valor estimado</th>
                  <th>Cotizaciones</th>
                </tr>
              </thead>
              <tbody>
                {visibles.map((e) => (
                  <tr key={`${e.sku}|${e.producto}`} className="gc-fila-compra">
                    <td className="gc-col-producto">
                      <NombreProducto p={e} />
                      <div className="gc-producto-meta"><span className="gc-sku">{e.sku || "Sin SKU"}</span><Etiquetas p={e} /></div>
                    </td>
                    <td className="gc-num">{num(e.por_despachar)}</td>
                    <td className="gc-num">{e.stock == null ? <span className="gc-sin-dato">—</span> : num(e.stock)}</td>
                    <td className="gc-num"><span className="gc-falta">{num(e.falta)}</span></td>
                    <td className="gc-num gc-nowrap">{e.costo ? clp(e.costo) : <span className="gc-sin-dato" title="El producto no tiene costo en el catálogo">sin costo</span>}</td>
                    <td className="gc-num gc-nowrap gc-fuerte">{e.valor_estimado ? clp(e.valor_estimado) : "—"}</td>
                    <td>
                      <span className="gc-cot-chips">
                        {e.cotizaciones.map((id) => <Link key={id} to={`/detalle/${id}`} target="_blank" rel="noopener noreferrer" className="gc-cot-chip" title={`Abrir la cotización #${id} en una pestaña nueva`}>#{id}</Link>)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="gc-totales">
                  <td>Total {compras.length === (datos?.compras || []).length ? "" : "filtrado "}· {num(compras.length)} producto{compras.length === 1 ? "" : "s"}</td>
                  <td className="gc-num">{num(compras.reduce((a, e) => a + e.por_despachar, 0))}</td>
                  <td />
                  <td className="gc-num"><span className="gc-falta">{num(totalesCompras.falta)}</span></td>
                  <td />
                  <td className="gc-num gc-nowrap gc-fuerte">{clp(totalesCompras.valor)}{totalesCompras.sinCosto ? <div className="gc-totales-nota">{num(totalesCompras.sinCosto)} sin costo</div> : null}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        ) : (
          <div className="gc-scroll">
            <table className="data-table tabla-compacta cabecera-flexible tabla-texto gc-tabla gc-tabla-cotizaciones">
              <thead>
                <tr>
                  <th className="gc-col-chevron" aria-label="Detalle" />
                  <th>Cotización</th>
                  <th className="gc-col-fecha">Adjudicada</th>
                  <th className="gc-num" title="Productos y unidades por despachar que el stock cubre">Con stock</th>
                  <th className="gc-num" title="Unidades que falta comprar para despachar al 100 %">Faltan</th>
                  <th className="gc-col-cobertura">Cobertura</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {visibles.map((c) => {
                  const abierta = abiertas.includes(c.id);
                  const cerrada = c.estado === "cerrada";
                  const dias = diasEntre(c.fecha_adjudicada, datos?.hoy);
                  const faltantes = c.productos.filter((p) => p.falta > 0).length;
                  return (
                    <Fragment key={c.id}>
                      <tr className={`gc-fila ${abierta ? "gc-fila-abierta" : ""}`} onClick={() => alternar(c.id)} aria-expanded={abierta}>
                        <td className="gc-col-chevron"><span className="gc-chevron">{abierta ? <ChevronDown size={15} /> : <ChevronRight size={15} />}</span></td>
                        <td className="gc-col-cot">
                          <div className="gc-cot-linea">
                            <Link to={`/detalle/${c.id}`} target="_blank" rel="noopener noreferrer" className="gc-cot-id" onClick={(e) => e.stopPropagation()} title="Abrir la cotización en una pestaña nueva">#{c.id}</Link>
                            {c.codigo && c.codigo !== String(c.id) && <span className="gc-cot-codigo">{c.codigo}</span>}
                            <span className={`gc-etiqueta ${c.particular ? "gc-etiqueta-particular" : "gc-etiqueta-publica"}`}>{c.particular ? "Particular" : "Pública"}</span>
                          </div>
                          <div className="gc-cot-cliente">{c.cliente || "—"}</div>
                          <div className="gc-cot-meta">
                            {c.vendedor && <span>{c.vendedor}</span>}
                            {c.neto ? <span>Neto {clp(c.neto)}</span> : null}
                            {cerrada && <span className="gc-meta-cerrada">Cierre forzado{c.monto_forzado ? ` · se cerró con ${clp(c.monto_forzado)} neto` : ""}</span>}
                          </div>
                        </td>
                        <td className="gc-col-fecha">
                          <div className="gc-nowrap">{fechaCL(c.fecha_adjudicada)}</div>
                          {dias != null && <div className="gc-sub">{haceDias(dias)}</div>}
                        </td>
                        <td className="gc-num">
                          {cerrada ? <span className="gc-sin-dato">—</span> : <>
                            <div className="gc-nowrap"><strong>{num(c.productos_cubiertos)}</strong> de {num(c.productos_pendientes)} <span className="gc-sub-inline">prod.</span></div>
                            <div className="gc-sub gc-nowrap">{num(c.unidades.asignadas)} de {num(c.unidades.por_despachar)} unid.</div>
                          </>}
                        </td>
                        <td className="gc-num">
                          {cerrada ? <span className="gc-sin-dato">—</span> : c.unidades.faltan > 0 ? <><span className="gc-falta">{num(c.unidades.faltan)}</span><div className="gc-sub gc-nowrap">{num(faltantes)} prod.</div></> : <span className="gc-ok-check"><PackageCheck size={16} /></span>}
                        </td>
                        <td className="gc-col-cobertura">{cerrada ? <span className="gc-pill gc-tono-neutro">No se despacha</span> : <Barra valor={c.cobertura} />}</td>
                        <td><Pastilla estado={c.estado} /></td>
                      </tr>
                      {abierta && (
                        <tr className="gc-detalle">
                          <td colSpan={7}>
                            <div className="gc-detalle-card">
                              <div className="gc-detalle-cab">
                                <div className="gc-detalle-titulo">
                                  <Boxes size={15} />
                                  <span>Productos de la cotización <strong>#{c.id}</strong>{c.codigo && c.codigo !== String(c.id) ? ` · ${c.codigo}` : ""}</span>
                                </div>
                                <div className="gc-minis">
                                  {cerrada ? <>
                                    <span className="gc-mini gc-tono-neutro"><b>{num(c.unidades.sin_despachar)}</b> sin despachar</span>
                                    <span className="gc-mini gc-tono-neutro">Cierre forzado: no toma stock ni entra en Por comprar</span>
                                  </> : <>
                                    <span className="gc-mini"><b>{num(c.unidades.por_despachar)}</b> por despachar</span>
                                    <span className="gc-mini gc-tono-ok"><b>{num(c.unidades.asignadas)}</b> con stock</span>
                                    <span className={`gc-mini ${c.unidades.faltan > 0 ? "gc-tono-bajo" : ""}`}><b>{num(c.unidades.faltan)}</b> faltan</span>
                                    <span className={`gc-mini gc-tono-${tono(c.cobertura)}`}><b>{pct(c.cobertura)}</b> cobertura</span>
                                    {c.unidades.faltan > 0 && (
                                      <button type="button" className="btn btn-secondary btn-sm" onClick={(e) => { e.stopPropagation(); verFaltantes(c); }} title="Ver estos faltantes en la lista de compras">
                                        <ShoppingCart size={13} /> Ver en Por comprar
                                      </button>
                                    )}
                                  </>}
                                </div>
                              </div>
                              <div className="gc-scroll">
                                <table className="data-table tabla-compacta cabecera-flexible tabla-texto gc-tabla gc-tabla-productos">
                                  <thead>
                                    <tr>
                                      <th>Producto</th>
                                      <th className="gc-num">Cotizado</th>
                                      <th className="gc-num" title="Unidades ya despachadas en las guías de esta cotización (leídas de Bsale)">Despachado</th>
                                      <th className="gc-num">Por despachar</th>
                                      <th className="gc-num" title="Stock total del inventario">Stock</th>
                                      <th className="gc-num" title="Unidades del stock que le tocan a esta cotización (por orden de adjudicación)">Asignado</th>
                                      <th className="gc-num">Falta</th>
                                      <th className="gc-num" title="Costo neto unitario del producto en el catálogo (el mismo de «Por comprar»)">Costo neto</th>
                                      <th className="gc-col-cobertura">Cobertura</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {c.productos.map((p, i) => {
                                      const clase = cerrada || p.por_despachar <= 0 ? "gc-prod-listo" : p.falta <= 0 ? "gc-prod-ok" : p.asignado > 0 ? "gc-prod-medio" : "gc-prod-bajo";
                                      return (
                                        <tr key={i} className={`gc-prod ${clase}`}>
                                          <td className="gc-col-producto">
                                            <NombreProducto p={p} />
                                            <div className="gc-producto-meta"><span className="gc-sku">{p.sku || "Sin SKU"}</span>{p.formato && <span className="gc-formato">{p.formato}</span>}<Etiquetas p={p} /></div>
                                          </td>
                                          <td className="gc-num">{num(p.cotizado)}</td>
                                          <td className="gc-num">{num(p.despachado)}</td>
                                          <td className="gc-num gc-fuerte">{num(p.por_despachar)}</td>
                                          <td className="gc-num">{p.stock == null ? <span className="gc-sin-dato">—</span> : num(p.stock)}</td>
                                          <td className="gc-num">{num(p.asignado)}</td>
                                          <td className="gc-num">{p.falta > 0 ? <span className="gc-falta">{num(p.falta)}</span> : <span className="gc-sin-dato">—</span>}</td>
                                          <td className="gc-num gc-nowrap"><Costo p={p} /></td>
                                          <td className="gc-col-cobertura">{p.por_despachar <= 0 ? <span className="gc-pill gc-tono-neutro">Despachado</span> : cerrada ? <span className="gc-pill gc-tono-neutro">No se despacha</span> : <Barra valor={p.cobertura} />}</td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
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
          </div>
        )}
      </div>
      <Paginacion pagina={pagina} total={lista.length} onCambiar={setPagina} nombre={pestana === "compras" ? "productos" : "cotizaciones"} />
      {datos?.actualizado_at && (
        <div className="gc-pie">
          Calculado el {new Date(datos.actualizado_at).toLocaleString("es-CL")}. Lo despachado sale de las guías registradas (Bsale) y el stock es el del inventario, sincronizado desde Bsale.
        </div>
      )}
    </div>
  );
}
