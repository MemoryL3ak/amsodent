import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import {
  AlertTriangle, Boxes, Building2, CalendarDays, ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown,
  ClipboardList, Download, ExternalLink, PackageCheck, PackageX, Paperclip, Plus, RefreshCw, Search, ShoppingCart, Trash2, Wallet, X,
} from "lucide-react";
import { api } from "../lib/api";
import { useStickyState } from "../lib/useStickyState";
import { descargarCSV } from "../lib/reporteStock";
import DropdownSelect from "../components/ui/DropdownSelect";
import MultiSelect from "../components/ui/MultiSelect";
import BotonLimpiarFiltros from "../components/BotonLimpiarFiltros";
import ConfirmModal from "../components/ConfirmModal";
import Toast from "../components/Toast";

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
   solo lo que no está en el catálogo queda como texto y «sin costo»).

   2026-11-06 (Ariel):
   · Columna «OC» en las cotizaciones y filtro «Entidad» (pública / particular),
     que vale también para «Por comprar» y el consolidado.
   · «Por comprar» lleva la columna «Proveedores»: por producto se eligen uno o
     más proveedores (se guarda al marcar). La pestaña «Consolidado Compras»
     junta esa selección por proveedor: qué hay que comprarle a cada uno.
   · Botón «Declarar quiebre de stock»: se elige el producto, opcionalmente se
     adjunta un respaldo, y el vendedor de cada cotización afectada recibe el
     aviso (campana + ventana flotante). Los quiebres quedan en la pestaña
     «Quiebres de stock» y salen solos cuando el producto se despacha. */

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
const quien = (email) => String(email || "").split("@")[0] || "—";
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
const ENTIDADES = [
  { value: "", label: "Todas" },
  { value: "publica", label: "Entidad pública" },
  { value: "particular", label: "Particular" },
];
const PESTANAS = ["cotizaciones", "compras", "consolidado", "quiebres"];

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
// (2026-11-06) «Quiebre de stock» = el producto tiene un quiebre declarado.
function Etiquetas({ p, quiebre = false }) {
  const catalogo = !p.sin_sku && p.en_catalogo;
  if (catalogo && !quiebre) return null;
  return (
    <span className="gc-etiquetas">
      {quiebre && <span className="gc-etiqueta gc-etiqueta-quiebre" title="Tiene un quiebre de stock declarado (pestaña «Quiebres de stock»)">Quiebre de stock</span>}
      {!catalogo && (p.en_catalogo
        ? <span className="gc-etiqueta gc-etiqueta-aviso" title="Producto del catálogo sin SKU: no tiene stock en Bsale, cuenta como por comprar">Transitorio</span>
        : <span className="gc-etiqueta gc-etiqueta-aviso" title="No calzó con ningún producto del catálogo, ni por SKU ni por nombre">No está en el catálogo</span>)}
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

function ChipsCotizaciones({ ids }) {
  return (
    <span className="gc-cot-chips">
      {ids.map((id) => <Link key={id} to={`/detalle/${id}`} target="_blank" rel="noopener noreferrer" className="gc-cot-chip" onClick={(e) => e.stopPropagation()} title={`Abrir la cotización #${id} en una pestaña nueva`}>#{id}</Link>)}
    </span>
  );
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

function Vacio({ icono, titulo, detalle, children }) {
  return (
    <div className="gc-vacio">
      {icono}
      <div className="gc-vacio-titulo">{titulo}</div>
      {detalle && <div className="gc-vacio-detalle">{detalle}</div>}
      {children}
    </div>
  );
}

/* Proveedores de un producto de «Por comprar»: listbox múltiple; abajo, el alta rápida de un proveedor. */
function SelectorProveedores({ entrada, proveedores, deshabilitado, motivo, onCambiar, onCrear }) {
  const [nuevo, setNuevo] = useState("");
  const [creando, setCreando] = useState(false);
  const opciones = useMemo(
    () => proveedores.map((p) => ({ value: p.id, label: p.razon_social || `Proveedor ${p.id}`, detalle: [p.rut, (p.marcas || []).slice(0, 4).join(", ")].filter(Boolean).join(" · ") || undefined })),
    [proveedores],
  );
  async function crear() {
    const razon = nuevo.trim();
    if (razon.length < 2 || creando) return;
    setCreando(true);
    try {
      await onCrear(razon, entrada);
      setNuevo("");
    } finally {
      setCreando(false);
    }
  }
  return (
    <MultiSelect
      value={entrada.proveedores || []}
      onChange={(ids) => onCambiar(entrada, ids)}
      options={opciones}
      placeholder={proveedores.length ? "Elegir proveedores…" : "Agregar proveedor…"}
      // Con más de uno, primero cuántos son: el nombre largo del primero no debe esconder que hay más.
      resumen={(elegidos) => (elegidos.length === 0 ? (proveedores.length ? "Elegir proveedores…" : "Agregar proveedor…") : elegidos.length === 1 ? elegidos[0].label : `${elegidos.length} · ${elegidos.map((o) => o.label).join(", ")}`)}
      minWidth={280}
      disabled={deshabilitado}
      title={deshabilitado ? motivo : undefined}
      className="input gc-selector-proveedores"
      style={{ width: "100%", height: 32, fontSize: 12.5, padding: "0 8px" }}
      vacio="Todavía no hay proveedores: agrega el primero aquí abajo."
      pie={(
        <div className="gc-proveedor-nuevo">
          <input className="input" value={nuevo} onChange={(e) => setNuevo(e.target.value.slice(0, 160))} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); crear(); } }} placeholder="Razón social del proveedor nuevo" style={{ flex: "1 1 auto", minWidth: 0, height: 30, fontSize: 12.5 }} />
          <button type="button" className="btn btn-secondary btn-sm" onClick={crear} disabled={nuevo.trim().length < 2 || creando} title="Crea el proveedor y lo deja elegido para este producto. Sus demás datos se completan en Proveedores.">
            <Plus size={13} /> {creando ? "Agregando…" : "Agregar"}
          </button>
        </div>
      )}
    />
  );
}

/* Ventana «Declarar quiebre de stock»: producto (de los que tienen despacho pendiente), motivo, reposición y respaldo opcional. */
function ModalQuiebre({ productos, onCerrar, onDeclarado }) {
  const [q, setQ] = useState("");
  const [clave, setClave] = useState("");
  const [motivo, setMotivo] = useState("");
  const [fecha, setFecha] = useState("");
  const [archivo, setArchivo] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const texto = sinTildes(q.trim());
  const visibles = useMemo(() => productos.filter((p) => !texto || sinTildes(`${p.sku} ${p.producto}`).includes(texto)).slice(0, 60), [productos, texto]);
  const elegido = productos.find((p) => p.clave === clave) || null;
  const vendedores = useMemo(() => {
    const m = new Map();
    for (const c of elegido?.cotizaciones || []) m.set(c.vendedor || "Sin vendedor", (m.get(c.vendedor || "Sin vendedor") || 0) + 1);
    return [...m.entries()];
  }, [elegido]);
  const ok = !!elegido && !elegido.quiebre && !guardando;

  async function declarar() {
    if (!ok) return;
    setGuardando(true);
    setError("");
    try {
      const fd = new FormData();
      fd.append("clave", elegido.clave);
      if (motivo.trim()) fd.append("motivo", motivo.trim());
      if (fecha) fd.append("fecha_estimada", fecha);
      if (archivo) fd.append("file", archivo);
      onDeclarado(await api.postForm("/gestion-compras/quiebres", fd), elegido);
    } catch (e) {
      setError(e?.message || "No se pudo declarar el quiebre de stock.");
      setGuardando(false);
    }
  }

  return createPortal(
    <div
      onMouseDown={(e) => { if (e.target === e.currentTarget && !guardando) onCerrar(); }}
      style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.55)", zIndex: 11000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
    >
      <div className="ventana-quiebre" role="dialog" aria-modal="true" aria-label="Declarar quiebre de stock" style={{ width: 620, maxWidth: "100%", maxHeight: "92vh", display: "flex", flexDirection: "column", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-lg)" }}>
        <div style={{ padding: "12px 18px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
          <strong style={{ fontSize: 15, display: "inline-flex", alignItems: "center", gap: 8 }}><PackageX size={17} style={{ color: "#dc2626" }} /> Declarar quiebre de stock</strong>
          <button type="button" onClick={onCerrar} disabled={guardando} className="btn btn-ghost" style={{ padding: 6 }} aria-label="Cerrar"><X size={18} /></button>
        </div>
        <div style={{ padding: "14px 18px", display: "flex", flexDirection: "column", gap: 12, overflowY: "auto", minHeight: 0 }}>
          <div className="field">
            <label className="field-label">Producto con quiebre <span style={{ color: "var(--danger)" }}>*</span></label>
            <div style={{ position: "relative" }}>
              <Search size={14} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)" }} />
              <input className="input" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por SKU o nombre entre los productos por despachar…" style={{ width: "100%", paddingLeft: 30 }} />
            </div>
            <div className="lista-productos-quiebre" role="listbox" aria-label="Productos por despachar" style={{ marginTop: 6, border: "1px solid var(--border)", borderRadius: 10, maxHeight: 210, overflowY: "auto", padding: 4 }}>
              {visibles.length === 0 && <div style={{ padding: "14px 10px", fontSize: 12.5, color: "var(--text-muted)" }}>{productos.length ? "Ningún producto calza con la búsqueda." : "No hay productos por despachar en las cotizaciones adjudicadas."}</div>}
              {visibles.map((p) => {
                const sel = p.clave === clave;
                return (
                  <button
                    key={p.clave} type="button" role="option" aria-selected={sel} disabled={p.quiebre} onClick={() => setClave(p.clave)}
                    title={p.quiebre ? "Este producto ya tiene un quiebre de stock declarado" : undefined}
                    style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left", padding: "7px 10px", border: "none", borderRadius: 6, cursor: p.quiebre ? "not-allowed" : "pointer", background: sel ? "var(--primary-light, #e8f7f7)" : "transparent", opacity: p.quiebre ? 0.55 : 1, fontSize: 13, color: "var(--text)" }}
                  >
                    <span style={{ width: 14, height: 14, borderRadius: "50%", border: `1.5px solid ${sel ? "var(--primary)" : "#cbd5e1"}`, background: sel ? "var(--primary)" : "#fff", boxShadow: sel ? "inset 0 0 0 3px #fff" : "none", flexShrink: 0 }} />
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: "block", fontWeight: 600, overflowWrap: "anywhere" }}>{p.producto || "—"}</span>
                      <span style={{ display: "block", fontSize: 11.5, color: "var(--text-muted)" }}>
                        {p.sku || "Sin SKU"} · {num(p.pendiente)} por despachar en {p.cotizaciones.length} cotización{p.cotizaciones.length === 1 ? "" : "es"}{p.falta > 0 ? ` · faltan ${num(p.falta)}` : ""}{p.quiebre ? " · ya declarado" : ""}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
          {elegido && (
            <div className="quiebre-afectadas" style={{ fontSize: 12.5, color: "#7f1d1d", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 10, padding: "9px 12px", lineHeight: 1.5 }}>
              Al declarar se avisa (campana y ventana flotante) al vendedor de cada cotización afectada:{" "}
              <strong>{vendedores.map(([v, n]) => `${v} (${n})`).join(", ")}</strong>.
              <div style={{ marginTop: 4, display: "flex", gap: 5, flexWrap: "wrap" }}>
                {elegido.cotizaciones.map((c) => <span key={c.id} style={{ background: "#fff", border: "1px solid #fecaca", borderRadius: 999, padding: "1px 8px", fontWeight: 600, whiteSpace: "nowrap" }}>#{c.id} · {num(c.pendiente)} u.</span>)}
              </div>
            </div>
          )}
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <div className="field" style={{ flex: "2 1 260px", minWidth: 0 }}>
              <label className="field-label">Motivo u observación <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>(opcional)</span></label>
              <input className="input" value={motivo} onChange={(e) => setMotivo(e.target.value.slice(0, 400))} placeholder="Ej: el proveedor informa quiebre hasta nuevo embarque" />
            </div>
            <div className="field" style={{ flex: "1 1 170px", minWidth: 0 }}>
              <label className="field-label">Reposición estimada <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>(opcional)</span></label>
              <input type="date" className="input" value={fecha} onChange={(e) => setFecha(e.target.value)} />
            </div>
          </div>
          <div className="field">
            <label className="field-label">Documento de respaldo <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>(opcional · PDF, imagen, Word, Excel o correo, hasta 15 MB)</span></label>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <label className="btn btn-secondary" style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                <Paperclip size={14} /> {archivo ? "Cambiar archivo" : "Adjuntar archivo"}
                <input type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx,.xls,.xlsx,.msg,.eml" onChange={(e) => setArchivo(e.target.files?.[0] || null)} style={{ display: "none" }} />
              </label>
              {archivo && (
                <span style={{ fontSize: 12.5, color: "var(--text-soft)", display: "inline-flex", alignItems: "center", gap: 6, minWidth: 0, overflowWrap: "anywhere" }}>
                  {archivo.name}
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setArchivo(null)} title="Quitar el archivo" style={{ padding: "2px 5px" }}><X size={13} /></button>
                </span>
              )}
            </div>
          </div>
          {error && <div style={{ fontSize: 12.5, color: "#dc2626", fontWeight: 600 }}>{error}</div>}
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, flexWrap: "wrap", padding: "11px 18px", borderTop: "1px solid var(--border)", background: "var(--bg)" }}>
          <button type="button" className="btn btn-secondary" onClick={onCerrar} disabled={guardando}>Cancelar</button>
          <button type="button" className="btn btn-primary btn-declarar-quiebre" onClick={declarar} disabled={!ok} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <PackageX size={14} /> {guardando ? "Declarando…" : "Declarar quiebre y avisar"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export default function GestionCompras() {
  const [datos, setDatos] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [toast, setToast] = useState(null);
  const [pestanaGuardada, setPestana] = useStickyState("gestionCompras.pestana", "cotizaciones");
  const pestana = PESTANAS.includes(pestanaGuardada) ? pestanaGuardada : "cotizaciones";
  const [q, setQ] = useStickyState("gestionCompras.q", "");
  const [estado, setEstado] = useStickyState("gestionCompras.estado", "pendientes");
  const [vendedor, setVendedor] = useStickyState("gestionCompras.vendedor", "");
  const [entidad, setEntidad] = useStickyState("gestionCompras.entidad", "");
  const [orden, setOrden] = useStickyState("gestionCompras.orden", "antigua");
  const [desde, setDesde] = useStickyState("gestionCompras.desde", "");
  const [abiertas, setAbiertas] = useState([]);
  const [pagina, setPagina] = useState(1);
  const [modalQuiebre, setModalQuiebre] = useState(false);
  const [quiebreAQuitar, setQuiebreAQuitar] = useState(null);

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
  useEffect(() => { setPagina(1); setAbiertas([]); }, [q, estado, vendedor, entidad, orden, pestana]);

  const texto = sinTildes(q.trim());
  const proveedores = useMemo(() => datos?.proveedores || [], [datos]);
  const nombreProveedor = useMemo(() => new Map(proveedores.map((p) => [p.id, p.razon_social || `Proveedor ${p.id}`])), [proveedores]);
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
      if (entidad && (entidad === "particular") !== !!c.particular) return false;
      if (texto && !sinTildes(`#${c.id} ${c.codigo || ""} ${c.oc || ""} ${c.cliente} ${c.rut} ${c.vendedor} ${c.productos.map((p) => `${p.sku} ${p.producto}`).join(" ")}`).includes(texto)) return false;
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
  }, [datos, estado, vendedor, entidad, texto, orden]);

  // «Por comprar» según la entidad elegida: cada producto trae su desglose pública / particular.
  const comprasEntidad = useMemo(
    () => (datos?.compras || [])
      .map((e) => {
        const t = entidad ? e.por_tipo?.[entidad] : null;
        return t ? { ...e, falta: t.falta, por_despachar: t.por_despachar, cotizaciones: t.cotizaciones, valor_estimado: e.costo ? Math.round(e.costo * t.falta) : null } : e;
      })
      .filter((e) => e.falta > 0),
    [datos, entidad],
  );
  const compras = useMemo(
    () => comprasEntidad.filter((e) => !texto || sinTildes(`${e.sku} ${e.producto} ${e.cotizaciones.map((id) => `#${id}`).join(" ")} ${(e.proveedores || []).map((id) => nombreProveedor.get(id) || "").join(" ")}`).includes(texto)),
    [comprasEntidad, texto, nombreProveedor],
  );
  const totalesCompras = useMemo(() => compras.reduce((a, e) => ({ falta: a.falta + e.falta, valor: a.valor + (e.valor_estimado || 0), sinCosto: a.sinCosto + (e.costo ? 0 : 1) }), { falta: 0, valor: 0, sinCosto: 0 }), [compras]);

  // Consolidado: los productos de «Por comprar» agrupados por cada proveedor elegido.
  const consolidado = useMemo(() => {
    const grupos = new Map();
    for (const e of comprasEntidad) {
      for (const id of e.proveedores || []) {
        if (!nombreProveedor.has(id)) continue;
        const g = grupos.get(id) || { id, proveedor: proveedores.find((p) => p.id === id), productos: [], falta: 0, valor: 0, sinCosto: 0 };
        g.productos.push(e);
        g.falta += e.falta;
        g.valor += e.valor_estimado || 0;
        if (!e.costo) g.sinCosto += 1;
        grupos.set(id, g);
      }
    }
    const lista = [...grupos.values()]
      .filter((g) => !texto || sinTildes(`${g.proveedor?.razon_social} ${g.proveedor?.rut} ${g.productos.map((e) => `${e.sku} ${e.producto}`).join(" ")}`).includes(texto))
      .sort((a, b) => String(a.proveedor?.razon_social).localeCompare(String(b.proveedor?.razon_social), "es"));
    return { lista, total: grupos.size, sinProveedor: comprasEntidad.filter((e) => !(e.proveedores || []).some((id) => nombreProveedor.has(id))).length };
  }, [comprasEntidad, proveedores, nombreProveedor, texto]);

  const quiebres = useMemo(
    () => (datos?.quiebres || []).filter((x) => !texto || sinTildes(`${x.sku} ${x.producto} ${x.motivo} ${x.cotizaciones.map((c) => `#${c.id} ${c.cliente} ${c.vendedor}`).join(" ")}`).includes(texto)),
    [datos, texto],
  );

  // Productos con despacho pendiente (los que se pueden declarar con quiebre), los que faltan primero.
  const productosPendientes = useMemo(() => {
    const m = new Map();
    for (const c of datos?.cotizaciones || []) {
      if (c.cerrada) continue;
      for (const p of c.productos) {
        if (!(p.por_despachar > 0) || !p.clave) continue;
        const e = m.get(p.clave) || { clave: p.clave, sku: p.sku, producto: p.producto, pendiente: 0, falta: 0, quiebre: false, cotizaciones: [] };
        e.pendiente += p.por_despachar;
        e.falta += p.falta;
        e.quiebre = e.quiebre || !!p.quiebre;
        const previa = e.cotizaciones.find((x) => x.id === c.id);
        if (previa) previa.pendiente += p.por_despachar;
        else e.cotizaciones.push({ id: c.id, vendedor: c.vendedor, pendiente: p.por_despachar });
        m.set(p.clave, e);
      }
    }
    return [...m.values()].sort((a, b) => b.falta - a.falta || b.pendiente - a.pendiente || String(a.producto).localeCompare(String(b.producto), "es"));
  }, [datos]);

  const lista = pestana === "compras" ? compras : pestana === "consolidado" ? consolidado.lista : pestana === "quiebres" ? quiebres : cotizaciones;
  const visibles = lista.slice((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA);
  const k = datos?.kpis;
  const hayFiltros = !!q.trim() || estado !== "pendientes" || !!vendedor || !!entidad || orden !== "antigua" || !!desde;
  const limpiar = () => { setQ(""); setEstado("pendientes"); setVendedor(""); setEntidad(""); setOrden("antigua"); setDesde(""); };

  // Desglose por estado para el KPI de cotizaciones (sobre lo que está en gestión, no sobre lo filtrado).
  const desglose = useMemo(() => {
    const en = (datos?.cotizaciones || []).filter((c) => c.estado !== "despachada" && c.estado !== "sin_items" && c.estado !== "cerrada");
    return { lista: en.filter((c) => c.estado === "lista").length, parcial: en.filter((c) => c.estado === "parcial").length, sin_stock: en.filter((c) => c.estado === "sin_stock").length };
  }, [datos]);

  const todasAbiertas = visibles.length > 0 && visibles.every((c) => abiertas.includes(c.id));
  const alternarTodas = () => setAbiertas(todasAbiertas ? [] : visibles.map((c) => c.id));
  const alternar = (id) => setAbiertas((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  const verFaltantes = (c) => { setPestana("compras"); setQ(`#${c.id}`); };

  /* Proveedores de un producto: se guarda al marcar; si el servidor rechaza, vuelve a como estaba. */
  const ponerProveedores = (clave, ids) => setDatos((prev) => (prev ? { ...prev, compras: prev.compras.map((x) => (x.clave === clave ? { ...x, proveedores: ids } : x)) } : prev));
  async function cambiarProveedores(e, ids) {
    const antes = e.proveedores || [];
    ponerProveedores(e.clave, ids);
    try {
      await api.put("/gestion-compras/proveedores", { clave: e.clave, sku: e.sku, producto: e.producto, producto_id: e.producto_id, proveedor_ids: ids });
    } catch (err) {
      ponerProveedores(e.clave, antes);
      setToast({ type: "error", message: err?.message || "No se pudieron guardar los proveedores del producto." });
    }
  }
  async function crearProveedor(razon, e) {
    try {
      const p = await api.post("/gestion-compras/proveedores", { razon_social: razon });
      setDatos((prev) => (prev && !prev.proveedores.some((x) => x.id === p.id) ? { ...prev, proveedores: [...prev.proveedores, p].sort((a, b) => String(a.razon_social).localeCompare(String(b.razon_social), "es")) } : prev));
      if (!(e.proveedores || []).includes(p.id)) await cambiarProveedores(e, [...(e.proveedores || []), p.id]);
      setToast({ type: "success", message: p.existia ? `«${p.razon_social}» ya existía: quedó elegido para el producto.` : `Proveedor «${p.razon_social}» creado. Completa sus datos en Proveedores.` });
    } catch (err) {
      setToast({ type: "error", message: err?.message || "No se pudo crear el proveedor." });
    }
  }

  async function bajarRespaldo(x) {
    try {
      const r = await api.get(`/gestion-compras/quiebres/${x.id}/respaldo`);
      if (r?.url) window.open(r.url, "_blank", "noopener");
    } catch (err) {
      setToast({ type: "error", message: err?.message || "No se pudo abrir el respaldo." });
    }
  }
  async function quitarQuiebre() {
    const x = quiebreAQuitar;
    setQuiebreAQuitar(null);
    if (!x) return;
    try {
      await api.post(`/gestion-compras/quiebres/${x.id}/quitar`, {});
      setToast({ type: "success", message: `Se quitó el quiebre de stock de «${x.producto}».` });
      cargar();
    } catch (err) {
      setToast({ type: "error", message: err?.message || "No se pudo quitar el quiebre." });
    }
  }

  const exportar = () => {
    const hoy = (datos?.hoy || new Date().toISOString().slice(0, 10)).replace(/-/g, "");
    const nombres = (ids) => (ids || []).map((id) => nombreProveedor.get(id)).filter(Boolean).join(" / ");
    if (pestana === "compras") {
      descargarCSV(
        `por-comprar-${hoy}.csv`,
        ["SKU", "Producto", "Por despachar", "Stock", "Falta comprar", "Costo neto", "Valor estimado", "Proveedores", "Cotizaciones"],
        compras.map((e) => [e.sku || "Sin SKU", e.producto, e.por_despachar, e.stock ?? "", e.falta, e.costo ?? "", e.valor_estimado ?? "", nombres(e.proveedores), e.cotizaciones.map((id) => `#${id}`).join(" ")]),
      );
      return;
    }
    if (pestana === "consolidado") {
      descargarCSV(
        `consolidado-compras-${hoy}.csv`,
        ["Proveedor", "RUT", "SKU", "Producto", "Falta comprar", "Costo neto", "Valor estimado", "Otros proveedores", "Cotizaciones"],
        consolidado.lista.flatMap((g) => g.productos.map((e) => [g.proveedor?.razon_social || "", g.proveedor?.rut || "", e.sku || "Sin SKU", e.producto, e.falta, e.costo ?? "", e.valor_estimado ?? "", nombres((e.proveedores || []).filter((id) => id !== g.id)), e.cotizaciones.map((id) => `#${id}`).join(" ")])),
      );
      return;
    }
    if (pestana === "quiebres") {
      descargarCSV(
        `quiebres-de-stock-${hoy}.csv`,
        ["SKU", "Producto", "Declarado", "Declarado por", "Motivo", "Reposición estimada", "Por despachar", "Cotizaciones", "Vendedores"],
        quiebres.map((x) => [x.sku || "Sin SKU", x.producto, fechaCL(x.created_at), x.declarado_por, x.motivo, x.fecha_estimada ? fechaCL(x.fecha_estimada) : "", x.pendiente, x.cotizaciones.filter((c) => c.pendiente > 0).map((c) => `#${c.id}`).join(" "), [...new Set(x.cotizaciones.filter((c) => c.pendiente > 0).map((c) => c.vendedor))].join(" / ")]),
      );
      return;
    }
    descargarCSV(
      `cotizaciones-vs-stock-${hoy}.csv`,
      ["Cotización", "Código", "OC", "Entidad", "Cliente", "RUT", "Vendedor", "Adjudicada", "Estado", "Cobertura %", "SKU", "Producto", "Cotizado", "Despachado", "Por despachar", "Stock", "Asignado", "Falta", "Costo neto"],
      cotizaciones.flatMap((c) => c.productos.map((p) => [c.id, c.codigo || "", c.oc || "", c.particular ? "Particular" : "Pública", c.cliente, c.rut, c.vendedor, fechaCL(c.fecha_adjudicada), (ESTADOS[c.estado] || ESTADOS.sin_items).texto, c.cobertura, p.sku || "Sin SKU", p.producto, p.cotizado, p.despachado, p.por_despachar, p.stock ?? "", p.asignado, p.falta, p.costo ?? ""])),
    );
  };

  const tituloExportar = {
    compras: "Descargar la lista de compras en CSV (Excel)",
    consolidado: "Descargar el consolidado por proveedor en CSV (Excel)",
    quiebres: "Descargar los quiebres de stock en CSV (Excel)",
    cotizaciones: "Descargar el detalle por producto de las cotizaciones filtradas en CSV (Excel)",
  }[pestana];
  const sinProveedoresListo = datos?.proveedores_listo === false;

  return (
    <div className="page gestion-compras">
      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}
      <ConfirmModal
        open={quiebreAQuitar !== null}
        title="¿Quitar este quiebre de stock?"
        message={`«${quiebreAQuitar?.producto || ""}» saldrá de la pestaña «Quiebres de stock». Los avisos ya enviados a los vendedores no se retiran.`}
        confirmText="Quitar"
        confirmTone="danger"
        onConfirm={quitarQuiebre}
        onCancel={() => setQuiebreAQuitar(null)}
      />
      {modalQuiebre && (
        <ModalQuiebre
          productos={productosPendientes}
          onCerrar={() => setModalQuiebre(false)}
          onDeclarado={(r, p) => {
            setModalQuiebre(false);
            setToast({ type: "success", message: `Quiebre de stock declarado para «${p.producto}». ${r?.avisados ? `Se avisó a ${r.avisados === 1 ? "1 vendedor" : `los vendedores de ${r.avisados} cotizaciones`}.` : "No había vendedores a quienes avisar."}` });
            setQ("");
            setPestana("quiebres");
            cargar();
          }}
        />
      )}

      <div className="page-header gc-cabecera">
        <div className="gc-cabecera-texto">
          <h1 className="page-title">Gestión de compras</h1>
          <p className="page-subtitle">
            Cotizaciones adjudicadas desde el {fechaCL(datos?.inicio || "2026-10-16")}: lo que falta despachar de cada producto frente al stock del inventario.
            El stock se reparte por orden de adjudicación (la más antigua primero); lo que no alcanza queda en «Por comprar».
          </p>
        </div>
        <div className="page-actions gc-acciones">
          <button
            type="button" className="btn btn-secondary btn-quiebre" onClick={() => setModalQuiebre(true)} disabled={!datos || datos.quiebres_listo === false}
            title={datos?.quiebres_listo === false ? "Falta aplicar la migración 20261106_gestion_compras_proveedores_quiebres.sql" : "Declarar que un producto por despachar está en quiebre de stock y avisar a los vendedores"}
          >
            <PackageX size={14} /> Declarar quiebre de stock
          </button>
          <button type="button" className="btn btn-secondary" onClick={exportar} disabled={!lista.length} title={tituloExportar}>
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
          { value: "consolidado", label: "Consolidado Compras", n: consolidado.lista.length, Icono: Building2 },
          { value: "quiebres", label: "Quiebres de stock", n: quiebres.length, Icono: PackageX },
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
            <input
              className="input" value={q} onChange={(e) => setQ(e.target.value)}
              placeholder={{ compras: "SKU, producto, proveedor o #cotización…", consolidado: "Proveedor, SKU o producto…", quiebres: "SKU, producto, cliente o vendedor…" }[pestana] || "Cotización, OC, cliente, vendedor, SKU…"}
            />
          </span>
        </div>
        {pestana !== "quiebres" && (
          <div className="filter-field gc-filtro gc-filtro-entidad">
            <label className="filter-label">Entidad</label>
            <DropdownSelect value={entidad} onChange={setEntidad} minWidth={180} style={{ width: "100%" }} options={ENTIDADES} />
          </div>
        )}
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
          {(pestana === "cotizaciones" || pestana === "consolidado") && visibles.length > 0 && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={alternarTodas} title={todasAbiertas ? "Contraer el detalle de todas las filas de esta página" : "Desplegar el detalle de todas las filas de esta página"}>
              {todasAbiertas ? <ChevronsDownUp size={14} /> : <ChevronsUpDown size={14} />} {todasAbiertas ? "Contraer todo" : "Expandir todo"}
            </button>
          )}
          <BotonLimpiarFiltros hay={hayFiltros} onLimpiar={limpiar} />
        </div>
      </div>

      {pestana === "cotizaciones" && (
        <div className="gc-leyenda">
          <span className="gc-leyenda-item gc-tono-ok"><i /> Stock completo (100 %)</span>
          <span className="gc-leyenda-item gc-tono-medio"><i /> Stock parcial (50–99 %)</span>
          <span className="gc-leyenda-item gc-tono-bajo"><i /> Sin stock o bajo 50 %</span>
          <span className="gc-leyenda-nota">La cobertura se mide en unidades por despachar.</span>
        </div>
      )}
      {pestana === "compras" && (
        <div className="gc-leyenda">
          <span className="gc-leyenda-nota">
            {sinProveedoresListo
              ? "Para elegir proveedores falta aplicar la migración 20261106_gestion_compras_proveedores_quiebres.sql."
              : "En «Proveedores» elige a quién se le va a comprar cada producto (puede ser más de uno): se guarda al marcar y arma la pestaña «Consolidado Compras»."}
          </span>
        </div>
      )}
      {pestana === "consolidado" && (
        <div className="gc-leyenda">
          <span className="gc-leyenda-nota">
            Lo que hay que comprarle a cada proveedor, según la selección hecha en «Por comprar». Un producto con varios proveedores aparece en cada uno.
            {consolidado.sinProveedor > 0 && <> <button type="button" className="gc-enlace" onClick={() => setPestana("compras")}>{num(consolidado.sinProveedor)} producto{consolidado.sinProveedor === 1 ? "" : "s"} por comprar todavía no tiene{consolidado.sinProveedor === 1 ? "" : "n"} proveedor</button>.</>}
          </span>
        </div>
      )}
      {pestana === "quiebres" && (
        <div className="gc-leyenda">
          <span className="gc-leyenda-nota">Productos con quiebre de stock declarado. Cada quiebre sale solo de esta lista cuando sus cotizaciones quedan despachadas.</span>
        </div>
      )}

      <div className="surface gc-superficie">
        {cargando && !datos ? (
          <div className="gc-cargando"><RefreshCw size={16} className="spin" /> Cargando cotizaciones, guías y stock…</div>
        ) : !lista.length ? (
          pestana === "compras"
            ? comprasEntidad.length
              ? <Vacio icono={<Search size={30} />} titulo="Ningún producto calza con la búsqueda." detalle="Prueba con otro SKU, nombre, proveedor o #cotización." />
              : <Vacio icono={<PackageCheck size={30} />} titulo="No hay nada que comprar." detalle={entidad ? "El stock alcanza para lo adjudicado a ese tipo de entidad." : "El stock del inventario alcanza para todo lo adjudicado."} />
            : pestana === "consolidado"
              ? consolidado.total
                ? <Vacio icono={<Search size={30} />} titulo="Ningún proveedor calza con la búsqueda." />
                : <Vacio icono={<Building2 size={30} />} titulo="Todavía no hay proveedores elegidos." detalle={sinProveedoresListo ? "Falta aplicar la migración 20261106_gestion_compras_proveedores_quiebres.sql." : "En «Por comprar», elige uno o más proveedores para cada producto y aquí aparecerá el consolidado."}>
                    {!sinProveedoresListo && <button type="button" className="btn btn-secondary btn-sm" onClick={() => setPestana("compras")} style={{ marginTop: 6 }}><ShoppingCart size={13} /> Ir a Por comprar</button>}
                  </Vacio>
              : pestana === "quiebres"
                ? (datos?.quiebres || []).length
                  ? <Vacio icono={<Search size={30} />} titulo="Ningún quiebre calza con la búsqueda." />
                  : <Vacio icono={<PackageCheck size={30} />} titulo="No hay quiebres de stock declarados." detalle={datos?.quiebres_listo === false ? "Falta aplicar la migración 20261106_gestion_compras_proveedores_quiebres.sql." : "Usa «Declarar quiebre de stock» cuando un producto por despachar no esté disponible: se avisa a los vendedores."} />
                : (datos?.cotizaciones || []).length
                  ? <Vacio icono={<Search size={30} />} titulo="Ninguna cotización calza con los filtros." detalle="Cambia el estado, la entidad, el vendedor o la fecha, o limpia los filtros." />
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
                  <th className="gc-col-proveedores" title="A quién se le va a comprar: uno o más proveedores por producto">Proveedores</th>
                  <th>Cotizaciones</th>
                </tr>
              </thead>
              <tbody>
                {visibles.map((e) => (
                  <tr key={e.clave || `${e.sku}|${e.producto}`} className="gc-fila-compra">
                    <td className="gc-col-producto">
                      <NombreProducto p={e} />
                      <div className="gc-producto-meta"><span className="gc-sku">{e.sku || "Sin SKU"}</span><Etiquetas p={e} quiebre={!!e.quiebre_id} /></div>
                    </td>
                    <td className="gc-num">{num(e.por_despachar)}</td>
                    <td className="gc-num">{e.stock == null ? <span className="gc-sin-dato">—</span> : num(e.stock)}</td>
                    <td className="gc-num"><span className="gc-falta">{num(e.falta)}</span></td>
                    <td className="gc-num gc-nowrap">{e.costo ? clp(e.costo) : <span className="gc-sin-dato" title="El producto no tiene costo en el catálogo">sin costo</span>}</td>
                    <td className="gc-num gc-nowrap gc-fuerte">{e.valor_estimado ? clp(e.valor_estimado) : "—"}</td>
                    <td className="gc-col-proveedores">
                      <SelectorProveedores entrada={e} proveedores={proveedores} deshabilitado={sinProveedoresListo} motivo="Falta aplicar la migración 20261106_gestion_compras_proveedores_quiebres.sql" onCambiar={cambiarProveedores} onCrear={crearProveedor} />
                    </td>
                    <td><ChipsCotizaciones ids={e.cotizaciones} /></td>
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
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        ) : pestana === "consolidado" ? (
          <div className="gc-scroll">
            <table className="data-table tabla-compacta cabecera-flexible tabla-texto gc-tabla gc-tabla-cotizaciones gc-tabla-consolidado">
              <thead>
                <tr>
                  <th className="gc-col-chevron" aria-label="Detalle" />
                  <th>Proveedor</th>
                  <th className="gc-num">Productos</th>
                  <th className="gc-num" title="Unidades que falta comprar de los productos asignados a este proveedor">Unidades por comprar</th>
                  <th className="gc-num" title="Falta comprar × costo neto del catálogo">Valor estimado</th>
                </tr>
              </thead>
              <tbody>
                {visibles.map((g) => {
                  const abierta = abiertas.includes(g.id);
                  return (
                    <Fragment key={g.id}>
                      <tr className={`gc-fila ${abierta ? "gc-fila-abierta" : ""}`} onClick={() => alternar(g.id)} aria-expanded={abierta}>
                        <td className="gc-col-chevron"><span className="gc-chevron">{abierta ? <ChevronDown size={15} /> : <ChevronRight size={15} />}</span></td>
                        <td className="gc-col-cot">
                          <div className="gc-cot-linea"><span className="gc-cot-id">{g.proveedor?.razon_social || `Proveedor ${g.id}`}</span></div>
                          <div className="gc-cot-meta">
                            {g.proveedor?.rut && <span>RUT {g.proveedor.rut}</span>}
                            {(g.proveedor?.marcas || []).length > 0 && <span>{g.proveedor.marcas.slice(0, 5).join(", ")}</span>}
                          </div>
                        </td>
                        <td className="gc-num gc-fuerte">{num(g.productos.length)}</td>
                        <td className="gc-num"><span className="gc-falta">{num(g.falta)}</span></td>
                        <td className="gc-num gc-nowrap gc-fuerte">{clp(g.valor)}{g.sinCosto ? <div className="gc-totales-nota">{num(g.sinCosto)} sin costo</div> : null}</td>
                      </tr>
                      {abierta && (
                        <tr className="gc-detalle">
                          <td colSpan={5}>
                            <div className="gc-detalle-card">
                              <div className="gc-detalle-cab">
                                <div className="gc-detalle-titulo"><Building2 size={15} /><span>Para comprar a <strong>{g.proveedor?.razon_social}</strong></span></div>
                                <div className="gc-minis">
                                  <span className="gc-mini"><b>{num(g.productos.length)}</b> producto{g.productos.length === 1 ? "" : "s"}</span>
                                  <span className="gc-mini gc-tono-bajo"><b>{num(g.falta)}</b> unidades</span>
                                  <span className="gc-mini"><b>{clp(g.valor)}</b> estimado</span>
                                </div>
                              </div>
                              <div className="gc-scroll">
                                <table className="data-table tabla-compacta cabecera-flexible tabla-texto gc-tabla gc-tabla-productos">
                                  <thead>
                                    <tr>
                                      <th>Producto</th>
                                      <th className="gc-num">Falta comprar</th>
                                      <th className="gc-num">Costo neto</th>
                                      <th className="gc-num">Valor estimado</th>
                                      <th>También se cotiza con</th>
                                      <th>Cotizaciones</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {g.productos.map((e) => (
                                      <tr key={e.clave} className="gc-prod">
                                        <td className="gc-col-producto">
                                          <NombreProducto p={e} />
                                          <div className="gc-producto-meta"><span className="gc-sku">{e.sku || "Sin SKU"}</span><Etiquetas p={e} quiebre={!!e.quiebre_id} /></div>
                                        </td>
                                        <td className="gc-num"><span className="gc-falta">{num(e.falta)}</span></td>
                                        <td className="gc-num gc-nowrap"><Costo p={e} /></td>
                                        <td className="gc-num gc-nowrap gc-fuerte">{e.valor_estimado ? clp(e.valor_estimado) : "—"}</td>
                                        <td>{(e.proveedores || []).filter((id) => id !== g.id && nombreProveedor.has(id)).map((id) => nombreProveedor.get(id)).join(", ") || <span className="gc-sin-dato">—</span>}</td>
                                        <td><ChipsCotizaciones ids={e.cotizaciones} /></td>
                                      </tr>
                                    ))}
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
        ) : pestana === "quiebres" ? (
          <div className="gc-scroll">
            <table className="data-table tabla-compacta cabecera-flexible tabla-texto gc-tabla gc-tabla-quiebres">
              <thead>
                <tr>
                  <th>Producto</th>
                  <th>Declarado</th>
                  <th>Motivo</th>
                  <th title="Cuándo se espera reponer el producto">Reposición</th>
                  <th className="gc-num" title="Unidades de este producto que siguen por despachar en las cotizaciones afectadas">Por despachar</th>
                  <th>Cotizaciones afectadas</th>
                  <th className="gc-col-acciones" aria-label="Acciones" />
                </tr>
              </thead>
              <tbody>
                {visibles.map((x) => {
                  const pendientes = x.cotizaciones.filter((c) => c.pendiente > 0);
                  const atraso = x.fecha_estimada ? diasEntre(x.fecha_estimada, datos?.hoy) : null;
                  return (
                    <tr key={x.id} className="gc-fila-quiebre">
                      <td className="gc-col-producto">
                        <NombreProducto p={x} />
                        <div className="gc-producto-meta"><span className="gc-sku">{x.sku || "Sin SKU"}</span></div>
                      </td>
                      <td className="gc-nowrap">
                        {fechaCL(x.created_at)}
                        <div className="gc-sub">{quien(x.declarado_por)} · {haceDias(diasEntre(x.created_at, datos?.hoy))}</div>
                      </td>
                      <td className="gc-col-motivo">{x.motivo || <span className="gc-sin-dato">—</span>}</td>
                      <td className="gc-nowrap">
                        {x.fecha_estimada ? fechaCL(x.fecha_estimada) : <span className="gc-sin-dato">Sin fecha</span>}
                        {atraso != null && atraso > 0 && <div className="gc-sub" style={{ color: "var(--gc-bajo)" }}>pasó hace {atraso} día{atraso === 1 ? "" : "s"}</div>}
                      </td>
                      <td className="gc-num"><span className="gc-falta">{num(x.pendiente)}</span></td>
                      <td>
                        <span className="gc-cot-chips">
                          {pendientes.map((c) => (
                            <Link key={c.id} to={`/detalle/${c.id}`} target="_blank" rel="noopener noreferrer" className="gc-cot-chip" title={`${c.cliente || "Cotización"} · ${c.vendedor || "sin vendedor"} · ${num(c.pendiente)} por despachar`}>#{c.id} · {num(c.pendiente)} u.</Link>
                          ))}
                        </span>
                        {x.cotizaciones.length > pendientes.length && <div className="gc-sub">{x.cotizaciones.length - pendientes.length} ya despachada{x.cotizaciones.length - pendientes.length === 1 ? "" : "s"}</div>}
                      </td>
                      <td className="gc-col-acciones gc-nowrap">
                        {x.tiene_respaldo && (
                          <button type="button" className="btn btn-ghost btn-sm" onClick={() => bajarRespaldo(x)} title={`Descargar el respaldo${x.file_name ? `: ${x.file_name}` : ""}`} style={{ padding: "2px 6px" }}><Paperclip size={14} /></button>
                        )}
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setQuiebreAQuitar(x)} title="Quitar este quiebre (por ejemplo, si se declaró por error)" style={{ padding: "2px 6px", color: "#dc2626" }}><Trash2 size={14} /></button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="gc-scroll">
            <table className="data-table tabla-compacta cabecera-flexible tabla-texto gc-tabla gc-tabla-cotizaciones">
              <thead>
                <tr>
                  <th className="gc-col-chevron" aria-label="Detalle" />
                  <th>Cotización</th>
                  <th className="gc-col-oc" title="Orden de compra cargada en la cotización">OC</th>
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
                            {c.productos.some((p) => p.quiebre && p.por_despachar > 0) && <span className="gc-etiqueta gc-etiqueta-quiebre" title="Tiene productos por despachar con quiebre de stock declarado">Quiebre</span>}
                          </div>
                          <div className="gc-cot-cliente">{c.cliente || "—"}</div>
                          <div className="gc-cot-meta">
                            {c.vendedor && <span>{c.vendedor}</span>}
                            {c.neto ? <span>Neto {clp(c.neto)}</span> : null}
                            {cerrada && <span className="gc-meta-cerrada">Cierre forzado{c.monto_forzado ? ` · se cerró con ${clp(c.monto_forzado)} neto` : ""}</span>}
                          </div>
                        </td>
                        <td className="gc-col-oc">{c.oc || <span className="gc-sin-dato" title="La cotización no tiene una orden de compra cargada">—</span>}</td>
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
                          <td colSpan={8}>
                            <div className="gc-detalle-card">
                              <div className="gc-detalle-cab">
                                <div className="gc-detalle-titulo">
                                  <Boxes size={15} />
                                  <span>Productos de la cotización <strong>#{c.id}</strong>{c.codigo && c.codigo !== String(c.id) ? ` · ${c.codigo}` : ""}{c.oc ? ` · OC ${c.oc}` : ""}</span>
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
                                            <div className="gc-producto-meta"><span className="gc-sku">{p.sku || "Sin SKU"}</span>{p.formato && <span className="gc-formato">{p.formato}</span>}<Etiquetas p={p} quiebre={!!p.quiebre && p.por_despachar > 0} /></div>
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
      <Paginacion pagina={pagina} total={lista.length} onCambiar={setPagina} nombre={{ compras: "productos", consolidado: "proveedores", quiebres: "quiebres" }[pestana] || "cotizaciones"} />
      {datos?.actualizado_at && (
        <div className="gc-pie">
          Calculado el {new Date(datos.actualizado_at).toLocaleString("es-CL")}. Lo despachado sale de las guías registradas (Bsale) y el stock es el del inventario, sincronizado desde Bsale.
        </div>
      )}
    </div>
  );
}
