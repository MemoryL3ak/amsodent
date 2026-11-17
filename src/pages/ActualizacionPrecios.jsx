import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { AlertTriangle, ArrowLeft, CheckCircle2, CloudUpload, Copy, Download, ExternalLink, FileSpreadsheet, History, Loader2, PackagePlus, Percent, RefreshCw, Scale, Search, Tags, Undo2, X } from "lucide-react";
import ConfirmModal from "../components/ConfirmModal";
import { api } from "../lib/api";
import { useStickyState } from "../lib/useStickyState";
import { useUnsavedChanges } from "../context/UnsavedChangesContext";
import DropdownSelect from "../components/ui/DropdownSelect";
import BotonLimpiarFiltros from "../components/BotonLimpiarFiltros";
import Toast from "../components/Toast";

/* ── Actualización de precios → Google Sheet (2026-11-12) ────────────────────
   Pedido de Ariel (punto 7 del lote del 2026-11-09): «manejar desde la
   plataforma la actualización de precios; la actualización se envía a un
   Google Sheet […] y desde la plataforma se pueden dar permisos».

   La plataforma manda y el Sheet «Lista de Precios» se lee. Tres pestañas:
   · Precios: grilla para cambiar costo y listas (en NETO, como los guarda la
     plataforma). Dos pasos: «Simular» muestra qué cambia y dónde queda en el
     Sheet sin guardar nada; solo con esa simulación vigente se habilita
     «Guardar y enviar al Sheet». Guardar es lo mismo que editar el producto
     (actualiza Bsale y deja el cambio en el historial) y además lo envía.
   · Google Sheet: conexión, cola de envío y «Nivelar» (dejar el Sheet igual a
     la plataforma), también en dos pasos y con Excel de diferencias.
   · Historial: los últimos cambios de precio y si llegaron al Sheet.
   Entra el admin o quien tenga «actualizar_precios» en su perfil; el costo se
   ve y se cambia solo con «ver_costos» (el servidor lo vuelve a exigir). */

const POR_PAGINA = 20;
const MAX_POR_GUARDADO = 80; // productos por llamada al servidor (cada guardado también actualiza Bsale)
const MAX_CAMBIOS = 1500; // productos con cambios que se simulan y guardan de una vez, por tandas
const SIN_MARCA = "__sin_marca";
const IVA = 1.19;
const FACTOR_LISTA_3 = 1.08;
const CAMPOS = ["costo", "lista1", "lista2", "lista3"];
const NOMBRE_CAMPO = { costo: "Costo", lista1: "Lista 1", lista2: "Lista 2", lista3: "Lista 3" };
const NOMBRE_ORIGEN = { edicion: "Edición", carga_masiva: "Carga masiva", reversion: "Carga deshecha", nivelacion: "Nivelación" };
const ESTADO_SHEET = {
  previo: { texto: "Anterior al envío", clase: "badge-neutral", ayuda: "Cambio hecho antes de activar el envío al Sheet: no se envía. Para dejar el Sheet al día está «Nivelar»." },
  pendiente: { texto: "Por enviar", clase: "badge-warning", ayuda: "En la cola: sale en segundos o, a más tardar, en la próxima pasada (cada 5 minutos)." },
  enviando: { texto: "Enviando", clase: "badge-primary", ayuda: "Un proceso lo está escribiendo en el Sheet." },
  enviado: { texto: "En el Sheet", clase: "badge-success", ayuda: "Quedó escrito en el Sheet." },
  omitido: { texto: "No corresponde", clase: "badge-neutral", ayuda: "No se escribe en el Sheet." },
  error: { texto: "Con error", clase: "badge-danger", ayuda: "Falló al escribir en el Sheet." },
};

const num = (n) => (n == null || n === "" ? "—" : Number(n).toLocaleString("es-CL", { maximumFractionDigits: 2 }));
const clp = (n) => (n == null || n === "" ? "—" : `$${num(n)}`);
const bruto = (neto) => Math.round(Number(neto) * IVA);
const sinTildes = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const quien = (email) => (email ? String(email).split("@")[0] : "Sistema");
const fechaHora = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("es-CL", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
};
const fechaCorta = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("es-CL", { day: "2-digit", month: "2-digit", year: "numeric" });
};

/* Lee lo que la persona escribió: «12.500», «12500», «1.234,5» o «1234.5».
   null = vacío (sin cambio); NaN = no es un número válido. */
function leerNumero(texto, conDecimales) {
  let s = String(texto ?? "").replace(/[$\s]/g, "");
  if (!s) return null;
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return NaN;
  return conDecimales ? Math.round(n * 100) / 100 : Math.round(n);
}

/* Qué cambia de verdad en un producto respecto de lo guardado. */
function cambiosDe(p, ed) {
  const lista = [];
  let invalido = false;
  for (const campo of CAMPOS) {
    const texto = ed?.[campo];
    if (texto === undefined || String(texto).trim() === "") continue;
    const n = leerNumero(texto, campo === "costo");
    if (Number.isNaN(n)) {
      invalido = true;
      continue;
    }
    if ((Number(p[campo]) || 0) === n) continue;
    lista.push({ campo, antes: p[campo] ?? null, ahora: n });
  }
  return { lista, invalido };
}

const caja = { border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", background: "var(--surface)", padding: "14px 16px", minWidth: 0 };
const tituloCaja = { fontSize: 14, fontWeight: 700, display: "flex", alignItems: "center", gap: 7, marginBottom: 4 };
const textoSuave = { fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.5 };

function Aviso({ tipo = "alerta", children }) {
  const c = tipo === "error" ? { color: "#991b1b", bg: "#fef2f2", borde: "#fecaca", icono: "#dc2626" } : tipo === "ok" ? { color: "#14532d", bg: "#f0fdf4", borde: "#bbf7d0", icono: "#16a34a" } : { color: "#78350f", bg: "#fffbeb", borde: "#fde68a", icono: "#d97706" };
  const Icono = tipo === "ok" ? CheckCircle2 : AlertTriangle;
  return (
    <div style={{ display: "flex", gap: 10, fontSize: 13, color: c.color, background: c.bg, border: `1px solid ${c.borde}`, borderRadius: 10, padding: "10px 14px", marginBottom: 12, lineHeight: 1.5 }}>
      <Icono size={16} style={{ flexShrink: 0, marginTop: 2, color: c.icono }} />
      <div style={{ minWidth: 0, overflowWrap: "anywhere" }}>{children}</div>
    </div>
  );
}

function Paginador({ pagina, total, onCambiar, etiqueta, porPagina = POR_PAGINA }) {
  const paginas = Math.max(1, Math.ceil(total / porPagina));
  if (total <= porPagina) return null;
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "10px 4px", fontSize: 12.5, color: "var(--text-soft)" }}>
      <span>{(pagina - 1) * porPagina + 1}–{Math.min(pagina * porPagina, total)} de {total.toLocaleString("es-CL")} {etiqueta}</span>
      <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
        <button type="button" className="btn btn-secondary btn-sm" disabled={pagina <= 1} onClick={() => onCambiar(pagina - 1)}>Anterior</button>
        <span>Página {pagina} de {paginas}</span>
        <button type="button" className="btn btn-secondary btn-sm" disabled={pagina >= paginas} onClick={() => onCambiar(pagina + 1)}>Siguiente</button>
      </span>
    </div>
  );
}

function ChipSheet({ fila }) {
  const e = ESTADO_SHEET[fila.sheet_estado];
  if (!e) return <span style={{ color: "var(--text-muted)" }}>—</span>;
  const detalle = fila.sheet_error ? `${e.ayuda} ${fila.sheet_error}` : e.ayuda;
  return (
    <>
      <span className={`badge ${e.clase}`} title={detalle}>{e.texto}</span>
      {fila.sheet_estado === "error" && <div style={{ fontSize: 11.5, color: "#b91c1c", marginTop: 3, maxWidth: 240, overflowWrap: "anywhere" }}>{fila.sheet_error || "Sin detalle"}{fila.sheet_intentos ? ` · intento ${fila.sheet_intentos} de 8` : ""}</div>}
      {fila.sheet_estado === "omitido" && fila.sheet_error && <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 3, maxWidth: 240, overflowWrap: "anywhere" }}>{fila.sheet_error}</div>}
    </>
  );
}

/* ── Celda editable de un precio ─────────────────────────────────────────── */
function CeldaPrecio({ original, texto, onCambiar, onSalir, conDecimales, placeholder, pie, etiqueta, deshabilitado }) {
  const editado = texto !== undefined;
  const n = editado && String(texto).trim() !== "" ? leerNumero(texto, conDecimales) : null;
  const invalido = Number.isNaN(n);
  const cambia = n != null && !invalido && (Number(original) || 0) !== n;
  const mostrado = editado ? texto : original == null || Number(original) === 0 ? "" : num(original);
  return (
    <td style={{ textAlign: "right", verticalAlign: "top", whiteSpace: "nowrap" }}>
      <input
        className="input celda-precio"
        inputMode="decimal"
        aria-label={etiqueta}
        value={mostrado}
        placeholder={placeholder || "—"}
        disabled={deshabilitado}
        onChange={(e) => onCambiar(e.target.value)}
        onBlur={onSalir}
        onFocus={(e) => e.target.select()}
        style={{ width: 104, height: 32, textAlign: "right", padding: "0 8px", fontVariantNumeric: "tabular-nums", borderColor: invalido ? "#dc2626" : cambia ? "#d97706" : undefined, background: invalido ? "#fef2f2" : cambia ? "#fffbeb" : undefined, fontWeight: cambia ? 700 : 500 }}
      />
      <div style={{ fontSize: 11, color: invalido ? "#b91c1c" : "var(--text-muted)", marginTop: 2, minHeight: 14 }}>
        {/* (2026-11-17) «antes …» va en su propia línea: en una sola, con un ajuste masivo todas las celdas
            se ensanchaban y la tabla dejaba de caber en un notebook de 13". */}
        {invalido ? "No es un número" : cambia ? <><span style={{ color: "#b45309", fontWeight: 600 }}>antes {original == null || Number(original) === 0 ? "vacío" : clp(original)}</span>{pie ? <><br />{pie}</> : null}</> : pie}
      </div>
    </td>
  );
}

/* ── Ajuste masivo (2026-11-17) ──────────────────────────────────────────────
   Qué campos, cuánto y cómo redondear. Al aplicar solo se ESCRIBE en la grilla
   (nada se guarda): el cambio se revisa, se simula y se guarda como siempre. */
const CAMPOS_MASIVO = [
  { value: "costo", label: "Costo" },
  { value: "lista1", label: "Lista 1" },
  { value: "lista2", label: "Lista 2" },
  { value: "lista3", label: "Lista 3", detalle: "Solo las que tienen precio fijo" },
];
function ModalAjusteMasivo({ total, filtro, verCostos, onCerrar, onAplicar }) {
  const [campos, setCampos] = useState(["lista1"]);
  const [modo, setModo] = useState("porcentaje"); // 'porcentaje' | 'margen'
  const [sentido, setSentido] = useState("subir");
  const [valor, setValor] = useState("");
  const [redondeo, setRedondeo] = useState("1");
  const opciones = CAMPOS_MASIVO.filter((c) => (c.value === "costo" ? verCostos && modo === "porcentaje" : true));
  const elegidos = campos.filter((c) => opciones.some((o) => o.value === c));
  const n = Number(String(valor).replace(",", "."));
  const valido = Number.isFinite(n) && n > 0 && (modo === "margen" ? n < 95 : sentido === "bajar" ? n < 100 : n <= 500);
  const demasiados = total > MAX_CAMBIOS;
  const puede = valido && elegidos.length > 0 && !demasiados && total > 0;
  const alternar = (c) => setCampos((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]));
  const etiqueta = { fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".4px", color: "var(--text-muted)", display: "block", marginBottom: 5 };
  const nombres = elegidos.map((c) => NOMBRE_CAMPO[c]).join(", ");

  return createPortal(
    <div onClick={onCerrar} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.5)", zIndex: 11050, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div className="modal-ajuste-masivo" role="dialog" aria-modal="true" aria-label="Ajuste masivo de precios" onClick={(e) => e.stopPropagation()} style={{ width: 560, maxWidth: "100%", maxHeight: "92vh", overflow: "auto", background: "var(--surface)", borderRadius: "var(--radius-lg)", border: "1px solid var(--border)", boxShadow: "var(--shadow-lg)" }}>
        <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
          <div style={{ minWidth: 0 }}>
            <strong style={{ fontSize: 15, display: "inline-flex", alignItems: "center", gap: 7 }}><Percent size={16} style={{ color: "var(--primary)" }} /> Ajuste masivo</strong>
            <div style={textoSuave}>
              Se aplica a <b>{total.toLocaleString("es-CL")} producto{total === 1 ? "" : "s"}</b>: {filtro ? `los del filtro actual (${filtro})` : "todo el catálogo, porque no hay filtros puestos"}.
            </div>
          </div>
          <button type="button" className="btn btn-ghost" onClick={onCerrar} style={{ padding: 6, flexShrink: 0 }} title="Cerrar"><X size={16} /></button>
        </div>
        <div style={{ padding: "14px 18px", display: "flex", flexDirection: "column", gap: 14, fontSize: 13 }}>
          {demasiados && <Aviso>Son más de {MAX_CAMBIOS.toLocaleString("es-CL")} productos: acota el filtro (por marca o categoría) y aplica el ajuste por partes.</Aviso>}
          <div>
            <span style={etiqueta}>Qué se ajusta</span>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {[{ value: "porcentaje", label: "Subir o bajar un porcentaje" }, ...(verCostos ? [{ value: "margen", label: "Fijar el margen sobre el costo" }] : [])].map((o) => (
                <label key={o.value} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 10px", borderRadius: 8, border: `1px solid ${modo === o.value ? "var(--primary)" : "var(--border)"}`, background: modo === o.value ? "var(--primary-light)" : "transparent", cursor: "pointer" }}>
                  <input type="radio" name="modo-masivo" checked={modo === o.value} onChange={() => setModo(o.value)} /> {o.label}
                </label>
              ))}
            </div>
          </div>
          <div>
            <span style={etiqueta}>En qué listas</span>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {opciones.map((c) => (
                <label key={c.value} title={c.detalle || ""} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 10px", borderRadius: 8, border: `1px solid ${elegidos.includes(c.value) ? "var(--primary)" : "var(--border)"}`, background: elegidos.includes(c.value) ? "var(--primary-light)" : "transparent", cursor: "pointer" }}>
                  <input type="checkbox" checked={elegidos.includes(c.value)} onChange={() => alternar(c.value)} /> {c.label}
                </label>
              ))}
            </div>
            {modo === "porcentaje" && <div style={{ ...textoSuave, marginTop: 5 }}>La lista 3 solo se ajusta en los productos que la tienen con precio fijo; en el resto sigue calculándose sola desde la lista 2.</div>}
          </div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
            {modo === "porcentaje" && (
              <div style={{ flex: "1 1 150px", minWidth: 0 }}>
                <span style={etiqueta}>Sentido</span>
                <DropdownSelect value={sentido} onChange={setSentido} minWidth={160} style={{ width: "100%" }} options={[{ value: "subir", label: "Subir" }, { value: "bajar", label: "Bajar" }]} />
              </div>
            )}
            <label style={{ flex: "1 1 130px", minWidth: 0 }}>
              <span style={etiqueta}>{modo === "margen" ? "Margen (%)" : "Porcentaje (%)"}</span>
              <input className="input campo-porcentaje-masivo" inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value.replace(/[^\d.,]/g, ""))} placeholder={modo === "margen" ? "35" : "5"} style={{ width: "100%" }} autoFocus />
            </label>
            <div style={{ flex: "1 1 170px", minWidth: 0 }}>
              <span style={etiqueta}>Redondear los precios a</span>
              <DropdownSelect value={redondeo} onChange={setRedondeo} minWidth={180} style={{ width: "100%" }} options={[{ value: "1", label: "$1 (sin redondear)" }, { value: "10", label: "$10" }, { value: "50", label: "$50" }, { value: "100", label: "$100" }]} />
            </div>
          </div>
          <div style={{ ...textoSuave, border: "1px solid var(--border)", borderRadius: 10, padding: "9px 12px", background: "var(--bg)" }}>
            {puede
              ? modo === "margen"
                ? <>Cada precio de <b>{nombres}</b> quedará en <b>costo ÷ (1 − {String(n).replace(".", ",")} %)</b>: un margen de {String(n).replace(".", ",")} % sobre el precio. Los productos sin costo se saltan.</>
                : <><b>{nombres}</b> {sentido === "subir" ? "sube" : "baja"} un <b>{String(n).replace(".", ",")} %</b> en los productos que ya tienen ese valor.</>
              : "Elige al menos una lista y escribe el porcentaje."}
            {" "}El resultado queda <b>escrito en la grilla, sin guardar</b>: después se revisa, se simula y se guarda.
          </div>
        </div>
        <div style={{ padding: "12px 18px", borderTop: "1px solid var(--border)", display: "flex", justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}>
          <button type="button" className="btn btn-ghost" onClick={onCerrar}>Cancelar</button>
          <button type="button" className="btn btn-primary" disabled={!puede} onClick={() => onAplicar({ campos: elegidos, modo, valor: modo === "porcentaje" && sentido === "bajar" ? -n : n, redondeo: Number(redondeo) || 1 })}>
            Escribir el ajuste en la grilla
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/* ── Pestaña «Precios» ───────────────────────────────────────────────────── */
function PestanaPrecios({ productos, cargando, verCostos, estado, ediciones, setEdiciones, onGuardado, setToast }) {
  const [q, setQ] = useStickyState("actualizacionPrecios.q", "");
  const [categoria, setCategoria] = useStickyState("actualizacionPrecios.categoria", "");
  // (2026-11-17) Filtro por marca (pedido de Ariel): junto con el ajuste masivo permite subir o bajar una marca entera.
  const [marca, setMarca] = useStickyState("actualizacionPrecios.marca", "");
  const [mostrar, setMostrar] = useState("");
  const [pagina, setPagina] = useState(1);
  const [sim, setSim] = useState(null); // { clave, datos }
  const [verSim, setVerSim] = useState(false);
  const [ocupado, setOcupado] = useState("");
  const [avance, setAvance] = useState(null); // { hechos, total } mientras se simula o guarda por tandas
  const [resultado, setResultado] = useState(null);
  const [masivoAbierto, setMasivoAbierto] = useState(false);

  // La ficha de un producto enlaza aquí con ?q=<SKU>: llega con ese producto buscado.
  useEffect(() => {
    const qUrl = new URLSearchParams(window.location.search).get("q");
    if (qUrl) { setQ(qUrl); setCategoria(""); setMarca(""); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const porId = useMemo(() => new Map((productos || []).map((p) => [String(p.id), p])), [productos]);
  const categorias = useMemo(() => [...new Set((productos || []).map((p) => String(p.categoria || "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "es")), [productos]);
  const marcas = useMemo(() => {
    const cuenta = new Map();
    for (const p of productos || []) {
      const m = String(p.marca || "").trim();
      if (m) cuenta.set(m, (cuenta.get(m) || 0) + 1);
    }
    return [...cuenta.entries()].sort((a, b) => a[0].localeCompare(b[0], "es", { sensitivity: "base" }));
  }, [productos]);

  // Productos con algo escrito que de verdad cambia (o que no se entiende).
  const pendientes = useMemo(() => {
    const lista = [];
    for (const [id, ed] of Object.entries(ediciones)) {
      const p = porId.get(id);
      if (!p) continue;
      const c = cambiosDe(p, ed);
      if (c.lista.length || c.invalido) lista.push({ p, ...c });
    }
    return lista;
  }, [ediciones, porId]);
  const conCambios = pendientes.filter((x) => x.lista.length);
  const invalidos = pendientes.filter((x) => x.invalido).length;
  const cuerpo = useMemo(() => conCambios.map((x) => ({ id: x.p.id, ...Object.fromEntries(x.lista.map((c) => [c.campo, c.ahora])) })), [conCambios]);
  const clave = JSON.stringify(cuerpo);
  const simVigente = !!sim && sim.clave === clave;
  // (2026-11-17) Ya no hay tope de 80 por guardado: con más, se simula y se guarda por tandas, con el avance a la vista.
  const demasiados = conCambios.length > MAX_CAMBIOS;

  // La barra se fija abajo mientras hay cambios sin guardar. Con position:sticky no
  // sirve: `.content` recorta en horizontal y eso la deja como caja de desplazamiento
  // que nunca se desplaza. Se mide el hueco que deja en la página y se fija sobre él.
  const huecoBarra = useRef(null);
  const barraRef = useRef(null);
  const [caja, setCaja] = useState(null); // { left, width, alto }
  const fijar = pendientes.length > 0;
  useEffect(() => {
    const hueco = huecoBarra.current;
    if (!fijar || !hueco) { setCaja(null); return undefined; }
    const medir = () => {
      const r = hueco.getBoundingClientRect();
      const alto = barraRef.current ? barraRef.current.offsetHeight : 0;
      setCaja((c) => (c && c.left === r.left && c.width === r.width && c.alto === alto ? c : { left: r.left, width: r.width, alto }));
    };
    medir();
    const observador = new ResizeObserver(medir);
    observador.observe(hueco);
    if (barraRef.current) observador.observe(barraRef.current);
    window.addEventListener("resize", medir);
    return () => { observador.disconnect(); window.removeEventListener("resize", medir); };
  }, [fijar]);
  const barraFija = fijar && caja ? { position: "fixed", left: caja.left, width: caja.width, bottom: 12, zIndex: 40, paddingRight: 84, boxShadow: "0 8px 28px -8px rgba(15,23,42,.35)" } : null;
  const idsPendientes = useMemo(() => new Set(pendientes.map((x) => String(x.p.id))), [pendientes]);

  const texto = sinTildes(q.trim());
  const filtrados = useMemo(() => (productos || []).filter((p) => {
    if (categoria && String(p.categoria || "").trim() !== categoria) return false;
    if (marca === SIN_MARCA ? String(p.marca || "").trim() : marca && String(p.marca || "").trim() !== marca) return false;
    if (mostrar === "cambios" && !idsPendientes.has(String(p.id))) return false;
    if (mostrar === "sin_lista1" && Number(p.lista1) > 0) return false;
    if (mostrar === "sin_costo" && Number(p.costo) > 0) return false;
    if (mostrar === "inactivos" && String(p.estado || "").toLowerCase() !== "inactivo") return false;
    if (mostrar === "sin_sku" && p.con_sku !== false) return false;
    return !texto || sinTildes(`${p.sku || ""} ${p.nombre} ${p.marca || ""}`).includes(texto);
  }), [productos, categoria, marca, mostrar, texto, idsPendientes]);
  useEffect(() => { setPagina(1); }, [q, categoria, marca, mostrar]);
  const paginaActual = Math.min(pagina, Math.max(1, Math.ceil(filtrados.length / POR_PAGINA)));
  const visibles = filtrados.slice((paginaActual - 1) * POR_PAGINA, paginaActual * POR_PAGINA);

  const escribir = (id, campo, valor) => setEdiciones((prev) => ({ ...prev, [id]: { ...(prev[id] || {}), [campo]: valor } }));
  // Al salir de la celda: si quedó vacía o igual a lo guardado, se suelta la edición.
  const soltar = (p, campo) => setEdiciones((prev) => {
    const ed = prev[p.id];
    if (!ed || ed[campo] === undefined) return prev;
    const n = String(ed[campo]).trim() === "" ? null : leerNumero(ed[campo], campo === "costo");
    if (n !== null && (Number.isNaN(n) || (Number(p[campo]) || 0) !== n)) return prev;
    const { [campo]: _fuera, ...resto } = ed;
    const siguiente = { ...prev };
    if (Object.keys(resto).length) siguiente[p.id] = resto;
    else delete siguiente[p.id];
    return siguiente;
  });

  /* El servidor recibe hasta 80 productos por llamada (cada guardado también
     actualiza Bsale): con más cambios se va por tandas y se junta el resultado. */
  const tandas = () => {
    const out = [];
    for (let i = 0; i < cuerpo.length; i += MAX_POR_GUARDADO) out.push(cuerpo.slice(i, i + MAX_POR_GUARDADO));
    return out;
  };

  async function simular() {
    setOcupado("simular");
    setResultado(null);
    const partes = tandas();
    setAvance(partes.length > 1 ? { hechos: 0, total: cuerpo.length } : null);
    try {
      const datos = { simulacion: true, recibidos: 0, con_cambios: 0, sheet: null, productos: [] };
      let hechos = 0;
      for (const parte of partes) {
        const r = await api.post("/precios-sheet/precios/simular", { cambios: parte });
        datos.recibidos += r?.recibidos || 0;
        datos.con_cambios += r?.con_cambios || 0;
        datos.productos.push(...(r?.productos || []));
        // Si alguna tanda no pudo revisar el Sheet, se dice (con el motivo de esa tanda).
        if (!datos.sheet || r?.sheet?.disponible === false) datos.sheet = r?.sheet || datos.sheet;
        hechos += parte.length;
        if (partes.length > 1) setAvance({ hechos, total: cuerpo.length });
      }
      setSim({ clave, datos });
      setVerSim(true);
    } catch (e) {
      setToast({ type: "error", message: e?.message || "No se pudo simular." });
    } finally {
      setOcupado("");
      setAvance(null);
    }
  }

  async function guardar() {
    if (!simVigente) return;
    setOcupado("guardar");
    const partes = tandas();
    setAvance(partes.length > 1 ? { hechos: 0, total: cuerpo.length } : null);
    const total = { guardados: 0, errores: [], sheet: null, mensaje: "" };
    let fallo = null;
    let hechos = 0;
    try {
      for (const parte of partes) {
        const r = await api.post("/precios-sheet/precios/guardar", { cambios: parte });
        total.guardados += r?.guardados || 0;
        total.errores.push(...(r?.errores || []));
        if (r?.sheet) total.sheet = r.sheet;
        hechos += parte.length;
        if (partes.length > 1) setAvance({ hechos, total: cuerpo.length });
      }
    } catch (e) {
      fallo = e?.message || "No se pudieron guardar los precios.";
    }
    // Lo que alcanzó a guardarse sale de la grilla; queda marcado lo que falló o no se alcanzó a enviar.
    const enviados = new Set(cuerpo.slice(0, hechos).map((c) => String(c.id)));
    const conError = new Set(total.errores.map((e) => String(e.id)));
    setEdiciones((prev) => Object.fromEntries(Object.entries(prev).filter(([id]) => !enviados.has(id) || conError.has(id))));
    setSim(null);
    setVerSim(false);
    setOcupado("");
    setAvance(null);
    if (hechos > 0) {
      total.mensaje = `${total.guardados} producto(s) actualizados${total.errores.length ? `, ${total.errores.length} con error` : ""}${fallo ? `; quedaron ${cuerpo.length - hechos} sin guardar` : ""}.`;
      setResultado(total);
      await onGuardado();
    }
    setToast(fallo
      ? { type: "error", message: hechos > 0 ? `Se guardó una parte y luego falló: ${fallo} Lo que falta sigue marcado en la grilla.` : fallo }
      : { type: total.errores.length ? "warning" : "success", message: total.mensaje || "Precios guardados." });
  }

  /* (2026-11-17) Ajuste masivo: «en esta sección se actualizan masivamente los
     costos y precios de distintos listados». Aplica un porcentaje (o fija el
     margen sobre el costo) a TODOS los productos del filtro actual —una marca,
     una categoría, una búsqueda— y lo deja escrito en la grilla, sin guardar:
     después se revisa, se simula y se guarda como cualquier otro cambio. */
  function aplicarMasivo({ campos, modo, valor, redondeo }) {
    const redondear = (n) => Math.max(0, Math.round(n / redondeo) * redondeo);
    let tocados = 0;
    let sinBase = 0;
    const siguiente = { ...ediciones };
    for (const p of filtrados) {
      const ed = { ...(siguiente[p.id] || {}) };
      let cambio = false;
      // El costo que rige para calcular el margen: el escrito en la grilla o el guardado.
      const escrito = ed.costo !== undefined && String(ed.costo).trim() !== "" ? leerNumero(ed.costo, true) : null;
      const costoVigente = escrito != null && !Number.isNaN(escrito) ? escrito : Number(p.costo) || 0;
      for (const campo of campos) {
        let nuevo = null;
        if (modo === "margen") {
          // Precio para que el margen (sobre el precio) sea el pedido: costo / (1 − margen).
          if (!(costoVigente > 0)) { sinBase++; continue; }
          nuevo = redondear(costoVigente / (1 - valor / 100));
        } else {
          const base = Number(p[campo]) || 0;
          // Una lista 3 vacía se calcula sola desde la lista 2: no se toca.
          if (!(base > 0)) { if (campo !== "lista3") sinBase++; continue; }
          nuevo = campo === "costo" ? Math.max(0, Math.round(base * (1 + valor / 100) * 100) / 100) : redondear(base * (1 + valor / 100));
        }
        if (nuevo === (Number(p[campo]) || 0)) continue;
        ed[campo] = String(nuevo).replace(".", ",");
        cambio = true;
      }
      if (cambio) { siguiente[p.id] = ed; tocados++; }
    }
    setEdiciones(siguiente);
    setSim(null);
    setMasivoAbierto(false);
    setMostrar("cambios");
    setToast({
      type: tocados ? "info" : "warning",
      message: tocados
        ? `Ajuste escrito en ${tocados} producto${tocados === 1 ? "" : "s"}: revísalo, simula y guarda. Nada se ha guardado todavía.${sinBase ? ` ${sinBase} valor(es) se saltaron por no tener precio o costo de base.` : ""}`
        : "El ajuste no cambia ningún producto del filtro (sin precio o costo de base, o ya estaban así).",
    });
  }

  const columnas = verCostos ? 5 : 4;
  const sheetListo = estado?.configurado && estado?.acceso?.ok && estado?.migracion;

  return (
    <>
      {resultado && (
        <Aviso tipo={resultado.errores?.length || ["error", "sin_configurar", "sin_migracion"].includes(resultado.sheet?.estado) ? "alerta" : "ok"}>
          <b>{resultado.mensaje}</b> {resultado.sheet?.mensaje ? <>Google Sheet: {resultado.sheet.mensaje}</> : null}
          {resultado.errores?.length > 0 && <div style={{ marginTop: 4 }}>No se guardaron (siguen marcados en la grilla): {resultado.errores.map((e) => `${e.sku || `#${e.id}`}: ${e.mensaje}`).join(" · ")}</div>}
          <div><button type="button" onClick={() => setResultado(null)} style={{ background: "none", border: "none", padding: 0, marginTop: 4, color: "inherit", textDecoration: "underline", cursor: "pointer", fontSize: 12.5, fontFamily: "inherit" }}>Ocultar</button></div>
        </Aviso>
      )}

      <div className="filter-bar" style={{ alignItems: "flex-end", gap: 12, flexWrap: "wrap" }}>
        <div className="filter-field" style={{ flex: "2 1 240px", minWidth: 0 }}>
          <label className="filter-label">Buscar</label>
          <span style={{ position: "relative", display: "block" }}>
            <Search size={14} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)", pointerEvents: "none" }} />
            <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="SKU, producto o marca…" style={{ width: "100%", paddingLeft: 30 }} />
          </span>
        </div>
        <div className="filter-field" style={{ flex: "1 1 190px", minWidth: 0, maxWidth: 280 }}>
          <label className="filter-label">Categoría</label>
          <DropdownSelect value={categoria} onChange={setCategoria} minWidth={220} style={{ width: "100%" }} options={[{ value: "", label: "Todas" }, ...categorias.map((c) => ({ value: c, label: c }))]} />
        </div>
        <div className="filter-field" style={{ flex: "1 1 180px", minWidth: 0, maxWidth: 260 }}>
          <label className="filter-label">Marca</label>
          <DropdownSelect
            value={marca}
            onChange={setMarca}
            minWidth={240}
            style={{ width: "100%" }}
            options={[
              { value: "", label: "Todas" },
              ...marcas.map(([m, n]) => ({ value: m, label: m, detalle: `${n.toLocaleString("es-CL")} producto${n === 1 ? "" : "s"}` })),
              { value: SIN_MARCA, label: "Sin marca" },
            ]}
          />
        </div>
        <div className="filter-field" style={{ flex: "1 1 180px", minWidth: 0, maxWidth: 260 }}>
          <label className="filter-label">Mostrar</label>
          <DropdownSelect
            value={mostrar}
            onChange={setMostrar}
            minWidth={230}
            style={{ width: "100%" }}
            options={[
              { value: "", label: "Todos los productos" },
              { value: "cambios", label: "Con cambios sin guardar" },
              { value: "sin_lista1", label: "Sin precio en lista 1" },
              ...(verCostos ? [{ value: "sin_costo", label: "Sin costo" }] : []),
              { value: "sin_sku", label: "Sin SKU", detalle: "Transitorios: no van al Sheet" },
              { value: "inactivos", label: "Inactivos" },
            ]}
          />
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginLeft: "auto" }}>
          <BotonLimpiarFiltros hay={!!q.trim() || !!categoria || !!marca || !!mostrar} onLimpiar={() => { setQ(""); setCategoria(""); setMarca(""); setMostrar(""); }} />
          <button
            type="button"
            className="btn btn-secondary btn-ajuste-masivo"
            onClick={() => setMasivoAbierto(true)}
            disabled={!filtrados.length || !!ocupado}
            title="Subir o bajar en un porcentaje (o fijar un margen) el costo o las listas de todos los productos del filtro"
            style={{ display: "inline-flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}
          >
            <Percent size={14} /> Ajuste masivo
          </button>
        </div>
      </div>
      <div style={{ ...textoSuave, margin: "8px 2px 10px" }}>
        Los precios se escriben en <b>neto</b>, como los guarda la plataforma; al Sheet llegan con IVA (neto × 1,19). La lista 3 vacía se calcula sola (lista 2 × 1,08); escribir 0 la devuelve a ese cálculo. Los productos sin SKU (transitorios) también se cambian aquí, pero no van al Sheet.
      </div>
      {masivoAbierto && (
        <ModalAjusteMasivo
          total={filtrados.length}
          filtro={[marca === SIN_MARCA ? "sin marca" : marca ? `marca ${marca}` : "", categoria ? `categoría ${categoria}` : "", q.trim() ? `búsqueda «${q.trim()}»` : "", mostrar ? "filtro «Mostrar»" : ""].filter(Boolean).join(" · ")}
          verCostos={verCostos}
          onCerrar={() => setMasivoAbierto(false)}
          onAplicar={aplicarMasivo}
        />
      )}

      <div className="table-wrap">
        <table className="data-table tabla-compacta tabla-texto tabla-actualizacion-precios" style={{ minWidth: verCostos ? 800 : 680 }}>
          <thead>
            <tr>
              <th>Producto</th>
              {verCostos && <th style={{ textAlign: "right", width: 126 }}>Costo</th>}
              <th style={{ textAlign: "right", width: 126 }} title="Web y cliente particular">Lista 1 (neto)</th>
              <th style={{ textAlign: "right", width: 126 }} title="Compra Ágil">Lista 2 (neto)</th>
              <th style={{ textAlign: "right", width: 126 }} title="Licitación 24 meses">Lista 3 (neto)</th>
            </tr>
          </thead>
          <tbody>
            {cargando && !productos && <tr><td colSpan={columnas} style={{ textAlign: "center", padding: "40px 0", color: "var(--text-muted)" }}>Cargando los productos…</td></tr>}
            {productos && filtrados.length === 0 && <tr><td colSpan={columnas} style={{ textAlign: "center", padding: "40px 16px", color: "var(--text-muted)" }}>{productos.length ? "Ningún producto calza con los filtros." : "No hay productos con SKU."}</td></tr>}
            {visibles.map((p) => {
              const ed = ediciones[p.id] || {};
              const vigente = (campo) => {
                const n = ed[campo] !== undefined && String(ed[campo]).trim() !== "" ? leerNumero(ed[campo], campo === "costo") : null;
                return n != null && !Number.isNaN(n) ? n : Number(p[campo]) || 0;
              };
              const costo = verCostos ? vigente("costo") : 0;
              const pieLista = (neto) => (neto > 0 ? <>con IVA {clp(bruto(neto))}{costo > 0 ? ` · margen ${num(Math.round((1 - costo / neto) * 1000) / 10)}%` : ""}</> : null);
              const l1 = vigente("lista1");
              const l2 = vigente("lista2");
              const l3 = vigente("lista3");
              const l3Auto = l2 > 0 ? Math.round(l2 * FACTOR_LISTA_3) : 0;
              const inactivo = String(p.estado || "").toLowerCase() === "inactivo";
              return (
                <tr key={p.id} style={{ opacity: inactivo ? 0.65 : 1 }}>
                  <td style={{ minWidth: 220, verticalAlign: "top" }}>
                    <div style={{ fontWeight: 600, overflowWrap: "anywhere" }}>
                      <Link to={`/productos/editar/${p.id}`} target="_blank" rel="noopener noreferrer" className="table-link" title="Abrir el producto en una pestaña nueva">{p.nombre || "(sin nombre)"}</Link>
                    </div>
                    <div style={{ fontSize: 11.5, color: "var(--text-muted)", overflowWrap: "anywhere" }}>
                      {p.sku ? <span style={{ fontFamily: 'Consolas, "SFMono-Regular", monospace' }}>{p.sku}</span> : <span title="Los productos sin SKU no van al Google Sheet">sin SKU{p.estado ? ` (${String(p.estado).toLowerCase()})` : ""}</span>}
                      {p.marca ? ` · ${p.marca}` : ""}{p.categoria ? ` · ${p.categoria}` : ""}{inactivo ? " · inactivo" : ""}
                      {p.precio_actualizado_at ? ` · precio del ${fechaCorta(p.precio_actualizado_at)}` : ""}
                    </div>
                  </td>
                  {verCostos && <CeldaPrecio etiqueta={`Costo de ${p.sku}`} original={p.costo} texto={ed.costo} conDecimales onCambiar={(v) => escribir(p.id, "costo", v)} onSalir={() => soltar(p, "costo")} deshabilitado={!!ocupado} />}
                  <CeldaPrecio etiqueta={`Lista 1 de ${p.sku}`} original={p.lista1} texto={ed.lista1} onCambiar={(v) => escribir(p.id, "lista1", v)} onSalir={() => soltar(p, "lista1")} pie={pieLista(l1)} deshabilitado={!!ocupado} />
                  <CeldaPrecio etiqueta={`Lista 2 de ${p.sku}`} original={p.lista2} texto={ed.lista2} onCambiar={(v) => escribir(p.id, "lista2", v)} onSalir={() => soltar(p, "lista2")} pie={pieLista(l2)} deshabilitado={!!ocupado} />
                  <CeldaPrecio
                    etiqueta={`Lista 3 de ${p.sku}`}
                    original={p.lista3}
                    texto={ed.lista3}
                    onCambiar={(v) => escribir(p.id, "lista3", v)}
                    onSalir={() => soltar(p, "lista3")}
                    placeholder={l3Auto ? num(l3Auto) : "—"}
                    pie={l3 > 0 ? <>fija · con IVA {clp(bruto(l3))}</> : l3Auto ? "lista 2 × 1,08" : null}
                    deshabilitado={!!ocupado}
                  />
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Paginador pagina={paginaActual} total={filtrados.length} onCambiar={setPagina} etiqueta="productos" />

      {/* Barra de acciones: queda fija abajo mientras hay cambios sin guardar (el hueco guarda su sitio). */}
      <div ref={huecoBarra} style={{ marginTop: 10, minHeight: barraFija ? caja.alto : undefined }}>
      <div ref={barraRef} className="barra-guardar-precios" style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: "10px 14px", boxSizing: "border-box", ...(barraFija || {}) }}>
        <div style={{ flex: "1 1 260px", minWidth: 0, fontSize: 13 }}>
          {pendientes.length === 0
            ? <span style={{ color: "var(--text-muted)" }}>Escribe un precio en la grilla para cambiarlo. Nada se guarda hasta pulsar «Guardar y enviar al Sheet».</span>
            : <>
                <b>{conCambios.length} producto{conCambios.length === 1 ? "" : "s"} con cambios sin guardar</b>
                {invalidos > 0 && <span style={{ color: "#b91c1c" }}> · {invalidos} con un valor que no es un número</span>}
                {demasiados && <span style={{ color: "#b91c1c" }}> · son demasiados para una sola vez: guarda hasta {MAX_CAMBIOS.toLocaleString("es-CL")} y sigue con el resto</span>}
                {avance && <span style={{ color: "var(--primary-dark)" }}> · {ocupado === "guardar" ? "guardando" : "simulando"} {avance.hechos.toLocaleString("es-CL")} de {avance.total.toLocaleString("es-CL")}…</span>}
                {!avance && !demasiados && !invalidos && <span style={{ color: "var(--text-muted)" }}> · {simVigente ? "simulación vigente: ya se puede guardar" : conCambios.length > MAX_POR_GUARDADO ? `simula para ver qué cambia (se hace en tandas de ${MAX_POR_GUARDADO})` : "simula para ver qué cambia y dónde queda en el Sheet"}</span>}
              </>}
          {avance && (
            <div style={{ height: 5, borderRadius: 999, background: "var(--border)", overflow: "hidden", marginTop: 6, maxWidth: 420 }} role="progressbar" aria-valuemin={0} aria-valuemax={avance.total} aria-valuenow={avance.hechos}>
              <div style={{ height: "100%", width: `${avance.total ? (avance.hechos / avance.total) * 100 : 0}%`, background: "var(--primary)", transition: "width .3s" }} />
            </div>
          )}
        </div>
        <div className="btn-row" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" className="btn btn-ghost" onClick={() => { setEdiciones({}); setSim(null); }} disabled={!pendientes.length || !!ocupado} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Undo2 size={14} /> Descartar</button>
          <button type="button" className="btn btn-secondary btn-simular-precios" onClick={simVigente ? () => setVerSim(true) : simular} disabled={!conCambios.length || invalidos > 0 || demasiados || !!ocupado} title="Muestra qué cambia y dónde queda en el Sheet. No guarda nada.">
            {ocupado === "simular" ? <Loader2 size={14} className="spin" /> : null} {simVigente ? "Ver simulación" : "Simular"}
          </button>
          <button type="button" className="btn btn-primary btn-guardar-precios" onClick={guardar} disabled={!simVigente || !!ocupado} title={simVigente ? "Guarda los precios (también en Bsale) y los envía al Google Sheet" : "Simula primero: se habilita con la simulación de estos mismos cambios"} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            {ocupado === "guardar" ? <Loader2 size={14} className="spin" /> : <CloudUpload size={14} />} Guardar y enviar al Sheet
          </button>
        </div>
      </div>
      </div>

      {verSim && simVigente && createPortal(
        <div onClick={() => !ocupado && setVerSim(false)} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.5)", zIndex: 11050, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div className="modal-simulacion-precios" role="dialog" aria-modal="true" aria-label="Simulación del cambio de precios" onClick={(e) => e.stopPropagation()} style={{ width: 760, maxWidth: "100%", maxHeight: "92vh", display: "flex", flexDirection: "column", background: "var(--surface)", borderRadius: "var(--radius-lg)", border: "1px solid var(--border)", boxShadow: "var(--shadow-lg)" }}>
            <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
              <div>
                <strong style={{ fontSize: 15 }}>Simulación del cambio de precios</strong>
                <div style={textoSuave}>Así quedarían {sim.datos.con_cambios} producto{sim.datos.con_cambios === 1 ? "" : "s"}. Todavía no se guardó ni se envió nada.</div>
              </div>
              <button type="button" className="btn btn-ghost" onClick={() => setVerSim(false)} disabled={!!ocupado} style={{ padding: 6, flexShrink: 0 }} title="Cerrar"><X size={16} /></button>
            </div>
            <div style={{ padding: "12px 18px", overflow: "auto", fontSize: 13 }}>
              {sim.datos.sheet?.disponible === false && <Aviso>No se pudo revisar el Google Sheet: {sim.datos.sheet.error} Los precios se pueden guardar igual: quedan en la cola y se envían cuando el Sheet responda.</Aviso>}
              {!sheetListo && sim.datos.sheet?.disponible !== false && estado?.error_migracion && <Aviso>{estado.error_migracion}</Aviso>}
              {sim.datos.con_cambios === 0
                ? <div style={{ color: "var(--text-muted)", padding: "16px 0" }}>Los precios ya están así en la plataforma: no hay nada que guardar.</div>
                : (
                  <div className="table-wrap" style={{ margin: 0 }}>
                    <table className="data-table tabla-compacta tabla-texto" style={{ minWidth: 520 }}>
                      <thead>
                        <tr>
                          <th>Producto</th>
                          <th>Cambia</th>
                          <th>En el Google Sheet</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sim.datos.productos.map((p) => (
                          <tr key={p.id}>
                            <td style={{ minWidth: 160 }}>
                              <div style={{ fontWeight: 600, overflowWrap: "anywhere" }}>{p.nombre}</div>
                              <div style={{ fontSize: 11.5, color: "var(--text-muted)", fontFamily: 'Consolas, "SFMono-Regular", monospace' }}>{p.sku}</div>
                            </td>
                            <td style={{ minWidth: 190 }}>
                              {p.cambios.map((c) => (
                                <div key={c.campo}>
                                  <span style={{ color: "var(--text-muted)" }}>{NOMBRE_CAMPO[c.campo]}:</span> {c.antes == null || Number(c.antes) === 0 ? "vacío" : clp(c.antes)} → <b>{c.ahora === 0 ? (c.campo === "lista3" ? "se calcula sola" : "queda vacío") : clp(c.ahora)}</b>
                                  {c.campo !== "costo" && c.ahora > 0 ? <span style={{ color: "var(--text-muted)" }}> (con IVA {clp(bruto(c.ahora))})</span> : null}
                                </div>
                              ))}
                            </td>
                            <td style={{ maxWidth: 240, color: p.sheet && !p.sheet.escribe ? "#b45309" : undefined }}>{p.sheet ? p.sheet.texto : "Se enviará cuando el Sheet esté disponible"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              <div style={{ ...textoSuave, marginTop: 10 }}>Al guardar, cada producto queda igual que al editarlo en Productos: el precio de lista 1 y 2 se actualiza también en Bsale, el cambio queda en el historial y se envía al Sheet, que además anota una línea en su pestaña «Cambios de precio».</div>
            </div>
            <div style={{ padding: "12px 18px", borderTop: "1px solid var(--border)", display: "flex", justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}>
              <button type="button" className="btn btn-ghost" onClick={() => setVerSim(false)} disabled={!!ocupado}>Seguir editando</button>
              <button type="button" className="btn btn-primary" onClick={guardar} disabled={!!ocupado || sim.datos.con_cambios === 0} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                {ocupado === "guardar" ? <Loader2 size={14} className="spin" /> : <CloudUpload size={14} />} Guardar y enviar al Sheet
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

/* ── Pestaña «Google Sheet»: conexión, cola y nivelación ─────────────────── */
function PestanaSheet({ estado, verCostos, envios, onProbar, onCambio, setToast }) {
  const [campos, setCampos] = useState({ costo: true, lista1: true, lista2: true, lista3: false });
  const [agregar, setAgregar] = useState(true);
  const [sim, setSim] = useState(null);
  const [ocupado, setOcupado] = useState("");
  const [error, setError] = useState("");
  const [hecho, setHecho] = useState(null);
  const [filtroCampo, setFiltroCampo] = useState("");
  const [pagina, setPagina] = useState(1);

  const elegidos = CAMPOS.filter((c) => campos[c] && (c !== "costo" || verCostos));
  const acceso = estado?.acceso;
  const conectado = !!estado?.configurado && !!acceso?.ok;
  const enCola = (estado?.pendientes || 0) + (estado?.errores || 0);

  const cambiarOpcion = (fn) => { fn(); setSim(null); setError(""); setHecho(null); };

  async function probar() {
    setOcupado("probar");
    await onProbar();
    setOcupado("");
  }

  async function reintentar() {
    setOcupado("reintentar");
    setError("");
    try {
      const r = await api.post("/precios-sheet/reintentar", {});
      setToast({ type: r?.estado === "ok" || r?.estado === "vacio" ? "success" : "warning", message: r?.mensaje || "Listo." });
      await onCambio();
    } catch (e) {
      setToast({ type: "error", message: e?.message || "No se pudo reintentar." });
    } finally {
      setOcupado("");
    }
  }

  async function nivelar(simular) {
    setOcupado(simular ? "simular" : "enviar");
    setError("");
    setHecho(null);
    try {
      if (simular) {
        const r = await api.post("/precios-sheet/nivelar/simular", { campos: elegidos, agregar });
        setSim(r);
        setPagina(1);
        setFiltroCampo("");
      } else {
        const r = await api.post("/precios-sheet/nivelar", { campos: elegidos, agregar, huella: sim.huella });
        setHecho(r);
        setSim(null);
        setToast({ type: r?.aviso ? "warning" : "success", message: r?.aviso || `El Sheet quedó nivelado: ${num(r?.resumen?.celdas)} celdas escritas.` });
        await onCambio();
      }
    } catch (e) {
      if (e?.status === 409) setSim(null);
      setError(e?.message || "No se pudo completar.");
    } finally {
      setOcupado("");
    }
  }

  async function excel() {
    try {
      const XLSX = await import("xlsx");
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet((sim.detalle || []).map((d) => ({
        SKU: d.sku, Producto: d.nombre, Pestaña: d.pestana, Fila: d.fila, Precio: NOMBRE_CAMPO[d.campo] || d.campo,
        "Sheet hoy (neto)": d.antes_neto ?? "", "Plataforma (neto)": d.ahora_neto ?? "",
        "Diferencia (neto)": d.antes_neto != null && d.ahora_neto != null ? Math.round((d.ahora_neto - d.antes_neto) * 100) / 100 : "",
        "Se escribiría en la celda": d.valor,
      }))), "Diferencias");
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet((sim.nuevas || []).map((n) => ({ SKU: n.sku, Producto: n.nombre, "Se agrega en la pestaña": n.pestana, Fila: n.fila }))), "Se agregan al Sheet");
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet((sim.omitidos || []).map((o) => ({ SKU: o.sku || "", Producto: o.nombre || "", Motivo: o.motivo }))), "No se escriben");
      XLSX.writeFile(wb, `diferencias-sheet-precios-${new Date().toISOString().slice(0, 10)}.xlsx`);
    } catch (e) {
      setToast({ type: "error", message: e?.message || "No se pudo armar el Excel." });
    }
  }

  async function copiarCuenta() {
    try {
      await navigator.clipboard.writeText(estado.cuenta);
      setToast({ type: "success", message: "Cuenta copiada." });
    } catch {
      setToast({ type: "warning", message: `Copia a mano: ${estado.cuenta}` });
    }
  }

  const detalle = useMemo(() => (sim?.detalle || []).filter((d) => !filtroCampo || d.campo === filtroCampo), [sim, filtroCampo]);
  const POR = 12;
  const paginaActual = Math.min(pagina, Math.max(1, Math.ceil(detalle.length / POR)));
  const r = sim?.resumen;
  const nadaQueEnviar = !!r && r.celdas === 0 && r.agregados === 0;
  const motivos = useMemo(() => {
    const m = new Map();
    for (const o of sim?.omitidos || []) m.set(o.motivo, (m.get(o.motivo) || 0) + 1);
    return [...m].sort((a, b) => b[1] - a[1]);
  }, [sim]);

  return (
    <>
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "stretch", marginBottom: 14 }}>
        <div style={{ ...caja, flex: "1 1 360px" }}>
          <div style={tituloCaja}><FileSpreadsheet size={16} /> Conexión con el Sheet</div>
          {!estado
            ? <div style={textoSuave}>Revisando…</div>
            : conectado
              ? <div style={{ fontSize: 13, lineHeight: 1.55 }}><span className="badge badge-success">Conectado</span> «{acceso.titulo}» · {acceso.pestanas} pestañas de categoría{acceso.consolidado ? " + Consolidado_auto" : ""}{acceso.bitacora ? " · con bitácora «Cambios de precio»" : " · la bitácora «Cambios de precio» se crea con el primer envío"}</div>
              : <div style={{ fontSize: 13, lineHeight: 1.55 }}><span className="badge badge-danger">Sin conexión</span> <span style={{ color: "#991b1b", overflowWrap: "anywhere" }}>{acceso?.error || "No se pudo leer el Sheet."}</span></div>}
          {estado?.cuenta && (
            <div style={{ ...textoSuave, marginTop: 8 }}>
              La plataforma escribe con la cuenta{" "}
              <button type="button" onClick={copiarCuenta} title="Copiar la cuenta" style={{ display: "inline-flex", alignItems: "center", gap: 4, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 6, padding: "1px 6px", fontFamily: 'Consolas, "SFMono-Regular", monospace', fontSize: 11.5, cursor: "pointer", color: "var(--text)", maxWidth: "100%", overflowWrap: "anywhere", textAlign: "left" }}>{estado.cuenta} <Copy size={11} style={{ flexShrink: 0 }} /></button>
              {" "}El Sheet debe estar compartido con ella como <b>Editor</b>. El resto de las personas conviene dejarlas como lectoras (eso se maneja en «Compartir» del propio Sheet).
            </div>
          )}
          {(acceso?.pestanas_con_problema || []).length > 0 && (
            <div style={{ fontSize: 12.5, color: "#92400e", marginTop: 8 }}>
              Pestañas que no se tocan porque su encabezado cambió: {acceso.pestanas_con_problema.map((p) => `«${p.pestana}» (${p.motivo})`).join(" · ")}
            </div>
          )}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
            <button type="button" className="btn btn-secondary btn-sm" onClick={probar} disabled={!!ocupado} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><RefreshCw size={13} className={ocupado === "probar" ? "spin" : ""} /> Probar conexión</button>
            {estado?.sheet_url && <a className="btn btn-secondary btn-sm" href={estado.sheet_url} target="_blank" rel="noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 6, textDecoration: "none" }}><ExternalLink size={13} /> Abrir el Sheet</a>}
          </div>
        </div>

        <div style={{ ...caja, flex: "1 1 360px" }}>
          <div style={tituloCaja}><CloudUpload size={16} /> Envío automático</div>
          <div style={textoSuave}>Cada cambio de precio (al editar un producto, en una carga masiva, al deshacer una carga o desde esta pantalla) se envía al Sheet a los pocos segundos. Si Google falla se reintenta solo cada 5 minutos, hasta 8 veces.</div>
          <div style={{ fontSize: 13, marginTop: 8, lineHeight: 1.6 }}>
            <b>{estado?.pendientes > 1000 ? "más de 1.000" : num(estado?.pendientes ?? 0)}</b> por enviar · <b style={{ color: estado?.errores ? "#b91c1c" : undefined }}>{estado?.errores > 1000 ? "más de 1.000" : num(estado?.errores ?? 0)}</b> con error
            {estado?.ultimo_error && estado?.errores > 0 && <div style={{ fontSize: 12, color: "#b91c1c", overflowWrap: "anywhere" }}>Último error: {estado.ultimo_error}</div>}
            {estado?.ultimo_envio && <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Último envío: {fechaHora(estado.ultimo_envio.created_at)} · {estado.ultimo_envio.estado === "ok" ? `${num(estado.ultimo_envio.celdas)} celdas` : "con error"}</div>}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
            <button type="button" className="btn btn-secondary btn-sm" onClick={reintentar} disabled={!!ocupado || !enCola || !estado?.migracion} title={enCola ? "Envía ahora lo que está en la cola, incluidos los que agotaron sus intentos" : "No hay cambios en la cola"} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              {ocupado === "reintentar" ? <Loader2 size={13} className="spin" /> : <RefreshCw size={13} />} Enviar la cola ahora
            </button>
          </div>
        </div>
      </div>

      <div className="caja-nivelar" style={{ ...caja, marginBottom: 14 }}>
        <div style={tituloCaja}><Scale size={16} /> Nivelar: dejar el Sheet igual a la plataforma</div>
        <div style={textoSuave}>
          Compara todos los productos con SKU contra el Sheet y escribe en el Sheet los precios que estén distintos. No cambia nada en la plataforma, no borra precios del Sheet y no toca fórmulas, stock ni medidas. Sirve la primera vez (el Sheet y la plataforma hoy no dicen lo mismo) y cada vez que alguien haya escrito a mano en el Sheet.
        </div>
        <div style={{ display: "flex", gap: "8px 18px", flexWrap: "wrap", alignItems: "center", margin: "10px 0 4px", fontSize: 13 }}>
          <span style={{ fontWeight: 600 }}>Precios a nivelar:</span>
          {CAMPOS.filter((c) => c !== "costo" || verCostos).map((c) => (
            <label key={c} style={{ display: "inline-flex", gap: 6, alignItems: "center", cursor: "pointer" }}>
              <input type="checkbox" checked={!!campos[c]} disabled={!!ocupado} onChange={(e) => cambiarOpcion(() => setCampos((prev) => ({ ...prev, [c]: e.target.checked })))} /> {NOMBRE_CAMPO[c]}
            </label>
          ))}
        </div>
        <label style={{ display: "flex", gap: 6, alignItems: "flex-start", cursor: "pointer", fontSize: 13, marginBottom: 4 }}>
          <input type="checkbox" checked={agregar} disabled={!!ocupado} onChange={(e) => cambiarOpcion(() => setAgregar(e.target.checked))} style={{ marginTop: 3 }} />
          <span>Agregar al Sheet los productos activos que no están <span style={{ color: "var(--text-muted)" }}>(al final de la pestaña de su categoría, con el formato y las fórmulas de la fila anterior)</span></span>
        </label>
        <div style={{ ...textoSuave, marginBottom: 10 }}>La lista 3 viene desmarcada: en la plataforma casi siempre se calcula (lista 2 × 1,08) y marcarla reemplaza las listas 3 escritas a mano en el Sheet por ese cálculo.</div>

        {error && <Aviso tipo="error">{error}</Aviso>}
        {hecho && <Aviso tipo="ok"><b>Sheet nivelado.</b> {num(hecho.resumen?.celdas)} celdas escritas en {num(hecho.resumen?.productos)} productos{hecho.resumen?.agregados ? ` y ${num(hecho.resumen.agregados)} productos agregados` : ""}. {hecho.aviso || "Cada celda quedó anotada en la pestaña «Cambios de precio» del Sheet."}</Aviso>}

        {sim && (
          <div className="simulacion-nivelar" style={{ border: "1px solid var(--border)", background: "var(--bg)", borderRadius: 10, padding: "12px 14px", marginBottom: 12 }}>
            <div style={{ fontSize: 13, lineHeight: 1.6 }}>
              {nadaQueEnviar
                ? <><b>El Sheet ya está igual a la plataforma</b> en los precios elegidos ({num(sim.revisados)} productos revisados). No hay nada que enviar.</>
                : <>Se escribirían <b>{num(r.celdas)} celdas en {num(r.productos)} productos</b>{Object.keys(r.por_campo || {}).length ? <> ({CAMPOS.filter((c) => r.por_campo[c]).map((c) => `${NOMBRE_CAMPO[c]}: ${num(r.por_campo[c])}`).join(" · ")})</> : null}{r.agregados ? <> y se agregarían <b>{num(r.agregados)} productos</b> que no están en el Sheet</> : null}. {num(r.sin_cambios)} productos ya están iguales. <b>No se escribió nada.</b></>}
              {motivos.length > 0 && <div style={{ fontSize: 12.5, color: "var(--text-muted)" }}>No se escriben {num(r.omitidos)}: {motivos.slice(0, 4).map(([m, n]) => `${num(n)} — ${m}`).join(" · ")}</div>}
              {(r.pestanas_con_problema || []).length > 0 && <div style={{ fontSize: 12.5, color: "#92400e" }}>Pestañas que no se tocan: {r.pestanas_con_problema.map((p) => `«${p.pestana}» (${p.motivo})`).join(" · ")}</div>}
            </div>
            {(sim.detalle || []).length > 0 && (
              <>
                <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", margin: "10px 0 8px" }}>
                  <DropdownSelect value={filtroCampo} onChange={(v) => { setFiltroCampo(v); setPagina(1); }} minWidth={170} style={{ width: 190, height: 32 }} options={[{ value: "", label: "Todos los precios" }, ...CAMPOS.filter((c) => r.por_campo?.[c]).map((c) => ({ value: c, label: `${NOMBRE_CAMPO[c]} (${num(r.por_campo[c])})` }))]} />
                  <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Valores en neto; a la celda de una lista va el precio con IVA.</span>
                </div>
                <div className="table-wrap" style={{ margin: 0, background: "var(--surface)" }}>
                  <table className="data-table tabla-compacta tabla-texto tabla-nivelar" style={{ minWidth: 640 }}>
                    <thead>
                      <tr>
                        <th>Producto</th>
                        <th>Dónde</th>
                        <th>Precio</th>
                        <th style={{ textAlign: "right" }}>Sheet hoy</th>
                        <th style={{ textAlign: "right" }}>Plataforma</th>
                        <th style={{ textAlign: "right" }}>Se escribe</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detalle.slice((paginaActual - 1) * POR, paginaActual * POR).map((d) => (
                        <tr key={`${d.pestana}-${d.fila}-${d.campo}`}>
                          <td style={{ minWidth: 180 }}>
                            <div style={{ fontWeight: 600, overflowWrap: "anywhere" }}>{d.nombre || "—"}</div>
                            <div style={{ fontSize: 11.5, color: "var(--text-muted)", fontFamily: 'Consolas, "SFMono-Regular", monospace' }}>{d.sku}</div>
                          </td>
                          <td style={{ maxWidth: 150, fontSize: 12.5 }}>{d.pestana} · fila {d.fila}</td>
                          <td style={{ whiteSpace: "nowrap" }}>{NOMBRE_CAMPO[d.campo]}</td>
                          <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>{d.antes_neto == null ? "vacío" : clp(d.antes_neto)}</td>
                          <td style={{ textAlign: "right", whiteSpace: "nowrap", fontWeight: 700 }}>{clp(d.ahora_neto)}</td>
                          <td style={{ textAlign: "right", whiteSpace: "nowrap", color: "var(--text-soft)" }}>{clp(d.valor)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Paginador pagina={paginaActual} total={detalle.length} onCambiar={setPagina} etiqueta="celdas" porPagina={POR} />
              </>
            )}
            {(sim.nuevas || []).length > 0 && (
              <div style={{ fontSize: 12.5, color: "var(--text-soft)", marginTop: 8, overflowWrap: "anywhere" }}>
                <b>Se agregan:</b> {sim.nuevas.slice(0, 8).map((n) => `${n.sku} → ${n.pestana}`).join(" · ")}{sim.nuevas.length > 8 ? ` · y ${sim.nuevas.length - 8} más (están en el Excel)` : ""}
              </div>
            )}
          </div>
        )}

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
          <button type="button" className="btn btn-secondary" onClick={excel} disabled={!sim || !!ocupado} title={sim ? "Las diferencias, lo que se agrega y lo que no se escribe, en Excel" : "Simula primero"} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Download size={14} /> Descargar diferencias (Excel)</button>
          <button type="button" className="btn btn-secondary btn-simular-nivelar" onClick={() => nivelar(true)} disabled={!!ocupado || !elegidos.length} title="Compara y muestra qué se escribiría. No escribe nada.">
            {ocupado === "simular" ? <Loader2 size={14} className="spin" /> : null} Simular
          </button>
          <button type="button" className="btn btn-primary btn-enviar-nivelar" onClick={() => nivelar(false)} disabled={!!ocupado || !sim || nadaQueEnviar} title={!sim ? "Simula primero: se habilita con la simulación a la vista" : "Escribe en el Sheet exactamente lo que muestra la simulación"} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            {ocupado === "enviar" ? <Loader2 size={14} className="spin" /> : <CloudUpload size={14} />} Enviar al Sheet
          </button>
        </div>
      </div>

      <div style={{ fontSize: 13.5, fontWeight: 700, margin: "0 2px 8px" }}>Últimos envíos al Sheet</div>
      <div className="table-wrap">
        <table className="data-table tabla-compacta tabla-texto tabla-envios-sheet" style={{ minWidth: 620 }}>
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Tipo</th>
              <th>Quién</th>
              <th style={{ textAlign: "right" }}>Productos</th>
              <th style={{ textAlign: "right" }}>Celdas</th>
              <th style={{ textAlign: "right" }}>Agregados</th>
              <th>Resultado</th>
            </tr>
          </thead>
          <tbody>
            {!envios && <tr><td colSpan={7} style={{ textAlign: "center", padding: "28px 0", color: "var(--text-muted)" }}>Cargando…</td></tr>}
            {envios && envios.envios.length === 0 && <tr><td colSpan={7} style={{ textAlign: "center", padding: "28px 16px", color: "var(--text-muted)" }}>{envios.listo ? "Todavía no se ha enviado nada al Sheet." : "El registro de envíos aparece cuando se aplique la migración 20261112_precios_sheet.sql."}</td></tr>}
            {(envios?.envios || []).slice(0, 15).map((e) => (
              <tr key={e.id}>
                <td style={{ whiteSpace: "nowrap" }}>{fechaHora(e.created_at)}</td>
                <td>{e.tipo === "nivelacion" ? "Nivelación" : "Cambios de precio"}</td>
                <td>{e.usuario_email ? quien(e.usuario_email) : "Automático"}</td>
                <td style={{ textAlign: "right" }}>{num(e.productos)}</td>
                <td style={{ textAlign: "right", fontWeight: 700 }}>{num(e.celdas)}</td>
                <td style={{ textAlign: "right" }}>{num(e.agregados)}</td>
                <td style={{ maxWidth: 260 }}>
                  {e.estado === "ok" ? <span className="badge badge-success">Escrito</span> : <span className="badge badge-danger">Error</span>}
                  {e.omitidos > 0 && <span style={{ fontSize: 11.5, color: "var(--text-muted)" }}> · {num(e.omitidos)} sin escribir</span>}
                  {e.error && <div style={{ fontSize: 11.5, color: "#b91c1c", overflowWrap: "anywhere" }}>{e.error}</div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

/* ── Pestaña «Historial»: últimos cambios de precio y su paso al Sheet ───── */
function PestanaHistorial({ cambios }) {
  const [q, setQ] = useState("");
  const [fEstado, setFEstado] = useState("");
  const [pagina, setPagina] = useState(1);
  const texto = sinTildes(q.trim());
  const lista = useMemo(() => (cambios?.cambios || []).filter((c) => (!fEstado || c.sheet_estado === fEstado) && (!texto || sinTildes(`${c.sku} ${c.nombre} ${c.usuario_email}`).includes(texto))), [cambios, fEstado, texto]);
  useEffect(() => { setPagina(1); }, [q, fEstado]);
  const POR = 15;
  const paginaActual = Math.min(pagina, Math.max(1, Math.ceil(lista.length / POR)));

  return (
    <>
      {cambios && !cambios.listo && <Aviso>Para ver si cada cambio llegó al Sheet falta aplicar la migración 20261112_precios_sheet.sql.</Aviso>}
      <div className="filter-bar" style={{ alignItems: "flex-end", gap: 12, flexWrap: "wrap" }}>
        <div className="filter-field" style={{ flex: "2 1 240px", minWidth: 0 }}>
          <label className="filter-label">Buscar</label>
          <span style={{ position: "relative", display: "block" }}>
            <Search size={14} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)", pointerEvents: "none" }} />
            <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="SKU, producto o quién lo cambió…" style={{ width: "100%", paddingLeft: 30 }} />
          </span>
        </div>
        <div className="filter-field" style={{ flex: "1 1 190px", minWidth: 0, maxWidth: 260 }}>
          <label className="filter-label">En el Sheet</label>
          <DropdownSelect value={fEstado} onChange={setFEstado} minWidth={210} style={{ width: "100%" }} options={[{ value: "", label: "Todos" }, ...Object.entries(ESTADO_SHEET).map(([value, e]) => ({ value, label: e.texto, detalle: e.ayuda }))]} />
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginLeft: "auto" }}>
          <BotonLimpiarFiltros hay={!!q.trim() || !!fEstado} onLimpiar={() => { setQ(""); setFEstado(""); }} />
        </div>
      </div>
      <div style={{ ...textoSuave, margin: "8px 2px 10px" }}>Los últimos 300 cambios de precio, vengan de donde vengan (edición del producto, carga masiva, esta pantalla). Valores en neto.</div>
      <div className="table-wrap">
        <table className="data-table tabla-compacta tabla-texto tabla-cambios-precio" style={{ minWidth: 700 }}>
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Producto</th>
              <th>Precio</th>
              <th style={{ textAlign: "right" }}>Antes</th>
              <th style={{ textAlign: "right" }}>Ahora</th>
              <th>Quién</th>
              <th>En el Sheet</th>
            </tr>
          </thead>
          <tbody>
            {!cambios && <tr><td colSpan={7} style={{ textAlign: "center", padding: "40px 0", color: "var(--text-muted)" }}>Cargando…</td></tr>}
            {cambios && lista.length === 0 && <tr><td colSpan={7} style={{ textAlign: "center", padding: "40px 16px", color: "var(--text-muted)" }}>{(cambios.cambios || []).length ? "Ningún cambio calza con los filtros." : "Todavía no hay cambios de precio registrados."}</td></tr>}
            {lista.slice((paginaActual - 1) * POR, paginaActual * POR).map((c) => (
              <tr key={c.id}>
                <td style={{ whiteSpace: "nowrap" }}>{fechaHora(c.created_at)}</td>
                <td style={{ minWidth: 180 }}>
                  <div style={{ fontWeight: 600, overflowWrap: "anywhere" }}>{c.nombre || "—"}</div>
                  <div style={{ fontSize: 11.5, color: "var(--text-muted)", fontFamily: 'Consolas, "SFMono-Regular", monospace' }}>{c.sku || "Sin SKU"}</div>
                </td>
                <td style={{ whiteSpace: "nowrap" }}>{NOMBRE_CAMPO[c.campo] || c.campo}</td>
                <td style={{ textAlign: "right", whiteSpace: "nowrap", color: "var(--text-soft)" }}>{clp(c.anterior)}</td>
                <td style={{ textAlign: "right", whiteSpace: "nowrap", fontWeight: 700 }}>{clp(c.nuevo)}</td>
                <td style={{ maxWidth: 140 }}>
                  {quien(c.usuario_email)}
                  <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>{NOMBRE_ORIGEN[c.origen] || c.origen || ""}</div>
                </td>
                <td><ChipSheet fila={c} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Paginador pagina={paginaActual} total={lista.length} onCambiar={setPagina} etiqueta="cambios" porPagina={POR} />
    </>
  );
}

/* ── Pestaña «Costos por confirmar» (2026-11-17) ─────────────────────────────
   Pedido de Ariel: «si se reconoce que en recepción de stock el último costo
   es superior, levantar alerta para confirmar si es modificación de costo
   definitiva o momentánea».
   Una fila por producto cuya ÚLTIMA recepción de stock llegó con un costo
   mayor al que tiene. Dos salidas, cada una con su confirmación:
     · Definitiva → el costo del producto pasa a ser el de la recepción (queda
       en el historial y sigue a Bsale y al Sheet como cualquier cambio).
     · Momentánea → el costo se mantiene y la alerta se cierra.
   La ventana de confirmación muestra antes cómo queda el margen de cada lista. */
const NOMBRE_LISTA = { lista1: "Lista 1", lista2: "Lista 2", lista3: "Lista 3" };
const pct = (m) => (m == null ? "—" : `${Number(m).toLocaleString("es-CL", { maximumFractionDigits: 1 })} %`);
function PestanaCostos({ costos, onResuelto, setToast }) {
  const [pagina, setPagina] = useState(1);
  const [decidir, setDecidir] = useState(null); // { alerta, decision }
  const [ocupado, setOcupado] = useState(null); // linea_id
  const POR = 12;
  const alertas = costos?.alertas || [];
  const paginaActual = Math.min(pagina, Math.max(1, Math.ceil(alertas.length / POR)));
  const visibles = alertas.slice((paginaActual - 1) * POR, paginaActual * POR);

  async function resolver() {
    const { alerta, decision } = decidir || {};
    setDecidir(null);
    if (!alerta) return;
    setOcupado(alerta.linea_id);
    try {
      const r = await api.post("/precios-sheet/costos-recepcion/resolver", { linea_id: alerta.linea_id, decision });
      setToast({ type: r?.aviso ? "warning" : "success", message: [r?.mensaje, r?.aviso].filter(Boolean).join(" ") || "Listo." });
      await onResuelto(decision);
    } catch (e) {
      setToast({ type: "error", message: e?.message || "No se pudo resolver la alerta." });
      await onResuelto(null);
    } finally {
      setOcupado(null);
    }
  }

  if (!costos) return <div style={{ padding: "40px 0", textAlign: "center", color: "var(--text-muted)" }}>Cargando…</div>;
  if (costos.sin_permiso) return <Aviso>Para ver y resolver los costos por confirmar tu perfil necesita «Ver el costo de los productos».</Aviso>;

  const a = decidir?.alerta;
  return (
    <>
      {costos.mensaje && <Aviso>{costos.mensaje} «Definitiva» funciona igual.</Aviso>}
      <div style={{ ...textoSuave, margin: "2px 2px 10px" }}>
        Productos cuya <b>última recepción de stock</b> llegó con un costo mayor al que tienen. La recepción no cambia el costo sola: aquí se decide si el alza es
        <b> definitiva</b> (el costo del producto pasa a ser el de la recepción) o <b>momentánea</b> (el costo se mantiene).
      </div>
      <div className="table-wrap">
        <table className="data-table tabla-compacta tabla-texto tabla-costos-confirmar" style={{ minWidth: 820 }}>
          <thead>
            <tr>
              <th>Producto</th>
              <th style={{ textAlign: "right", width: 108 }}>Costo actual</th>
              <th style={{ textAlign: "right", width: 126 }}>Costo recibido</th>
              <th style={{ width: "24%" }}>Recepción</th>
              <th style={{ width: 236, textAlign: "left" }}>¿El alza es…?</th>
            </tr>
          </thead>
          <tbody>
            {alertas.length === 0 && (
              <tr><td colSpan={5} style={{ textAlign: "center", padding: "40px 16px", color: "var(--text-muted)" }}>
                {costos.listo === false ? "Todavía no hay recepciones de stock registradas." : "No hay costos por confirmar: ninguna recepción llegó con un costo mayor al del producto."}
              </td></tr>
            )}
            {visibles.map((x) => (
              <tr key={x.linea_id}>
                <td style={{ minWidth: 200, verticalAlign: "top" }}>
                  <div style={{ fontWeight: 600, overflowWrap: "anywhere" }}>
                    <Link to={`/productos/editar/${x.producto_id}`} target="_blank" rel="noopener noreferrer" className="table-link" title="Abrir el producto en una pestaña nueva">{x.nombre || "(sin nombre)"}</Link>
                  </div>
                  <div style={{ fontSize: 11.5, color: "var(--text-muted)", overflowWrap: "anywhere" }}>
                    <span style={{ fontFamily: 'Consolas, "SFMono-Regular", monospace' }}>{x.sku || "sin SKU"}</span>{x.marca ? ` · ${x.marca}` : ""}
                  </div>
                </td>
                <td style={{ textAlign: "right", verticalAlign: "top", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{x.costo_actual > 0 ? clp(x.costo_actual) : <span style={{ color: "var(--text-muted)" }}>sin costo</span>}</td>
                <td style={{ textAlign: "right", verticalAlign: "top", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
                  <b>{clp(x.costo_recepcion)}</b>
                  <div style={{ fontSize: 11.5, color: "#b45309", fontWeight: 700 }}>{x.alza_pct != null ? `+${num(x.alza_pct)} %` : "primer costo"} · +{clp(x.diferencia)}</div>
                </td>
                <td style={{ verticalAlign: "top", fontSize: 12.5 }}>
                  <div>{x.documento || `Recepción #${x.recepcion_id}`}</div>
                  <div style={{ color: "var(--text-muted)", overflowWrap: "anywhere" }}>
                    {[fechaCorta(x.fecha), x.proveedor, `${num(x.cantidad)} unid.`, x.usuario ? quien(x.usuario) : ""].filter(Boolean).join(" · ")}
                  </div>
                </td>
                <td style={{ verticalAlign: "top" }}>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <button type="button" className="btn btn-primary btn-sm" disabled={ocupado != null} onClick={() => setDecidir({ alerta: x, decision: "definitiva" })} title="El costo del producto pasa a ser el de la recepción">
                      {ocupado === x.linea_id ? <Loader2 size={13} className="spin" /> : null} Definitiva
                    </button>
                    <button type="button" className="btn btn-secondary btn-sm" disabled={ocupado != null || costos.con_decision === false} onClick={() => setDecidir({ alerta: x, decision: "momentanea" })} title={costos.con_decision === false ? "Falta aplicar la migración para poder anotar que es momentánea" : "El costo del producto se mantiene y la alerta se cierra"}>
                      Momentánea
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Paginador pagina={paginaActual} total={alertas.length} onCambiar={setPagina} etiqueta="productos" porPagina={POR} />

      <ConfirmModal
        open={!!decidir}
        title={decidir?.decision === "definitiva" ? "Alza definitiva: actualizar el costo" : "Alza momentánea: mantener el costo"}
        confirmTone={decidir?.decision === "definitiva" ? "primary" : "warning"}
        confirmText={decidir?.decision === "definitiva" ? "Actualizar el costo" : "Mantener el costo"}
        onConfirm={resolver}
        onCancel={() => setDecidir(null)}
        message={a ? (
          <span style={{ display: "block" }}>
            <b>{a.sku || a.nombre}</b>{a.sku ? ` · ${a.nombre}` : ""}<br />
            {decidir.decision === "definitiva"
              ? <>El costo pasa de <b>{a.costo_actual > 0 ? clp(a.costo_actual) : "sin costo"}</b> a <b>{clp(a.costo_recepcion)}</b>. Queda en el historial de precios y se envía al Sheet. Los precios de las listas no cambian.</>
              : <>El costo se mantiene en <b>{a.costo_actual > 0 ? clp(a.costo_actual) : "sin costo"}</b> aunque la recepción llegó a {clp(a.costo_recepcion)}. La alerta se cierra; si otra recepción vuelve a llegar más cara, aparecerá de nuevo.</>}
            {(a.margenes || []).length > 0 && (
              <span style={{ display: "block", marginTop: 8, fontSize: 12.5 }}>
                {decidir.decision === "definitiva" ? "Margen con el costo nuevo: " : "Margen real de lo recibido: "}
                {a.margenes.map((m) => `${NOMBRE_LISTA[m.lista]} ${pct(m.actual)} → ${pct(m.nuevo)}`).join(" · ")}
              </span>
            )}
          </span>
        ) : null}
      />
    </>
  );
}

export default function ActualizacionPrecios() {
  const [vista, setVista] = useStickyState("actualizacionPrecios.vista", "precios");
  const [estado, setEstado] = useState(null);
  const [productos, setProductos] = useState(null);
  const [cambios, setCambios] = useState(null);
  const [envios, setEnvios] = useState(null);
  const [ediciones, setEdiciones] = useState({});
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [toast, setToast] = useState(null);
  const { setIsDirty, registerDiscardHandler, clearDiscardHandler, registerSaveHandler, clearSaveHandler, requestNavigation } = useUnsavedChanges();

  const cargarEstado = useCallback(async (forzar = false) => {
    try {
      setEstado(await api.get(`/precios-sheet/estado${forzar ? "?forzar=1" : ""}`));
    } catch (e) {
      setError(e?.message || "No se pudo consultar el estado del Sheet.");
    }
  }, []);
  const cargarProductos = useCallback(async () => {
    try {
      setProductos(await api.get("/precios-sheet/productos"));
    } catch (e) {
      setError(e?.message || "No se pudieron cargar los productos.");
    }
  }, []);
  const cargarHistorial = useCallback(async () => {
    const [c, e] = await Promise.all([
      api.get("/precios-sheet/cambios?limite=300").catch(() => ({ listo: false, cambios: [] })),
      api.get("/precios-sheet/envios").catch(() => ({ listo: false, envios: [] })),
    ]);
    setCambios(c);
    setEnvios(e);
  }, []);
  // (2026-11-17) Costos por confirmar: recepciones de stock que llegaron con un costo mayor.
  const [costos, setCostos] = useState(null);
  const cargarCostos = useCallback(async () => {
    setCostos(await api.get("/precios-sheet/costos-recepcion").catch((e) => ({ listo: true, con_decision: true, mensaje: e?.message || "No se pudieron leer los costos por confirmar.", alertas: [] })));
  }, []);
  const cargarTodo = useCallback(async () => {
    setCargando(true);
    setError("");
    await Promise.all([cargarEstado(), cargarProductos(), cargarHistorial(), cargarCostos()]);
    setCargando(false);
  }, [cargarEstado, cargarProductos, cargarHistorial, cargarCostos]);
  useEffect(() => { cargarTodo(); }, [cargarTodo]);
  // El aviso de la campana abre ?vista=costos; la ficha de un producto, ?q=<SKU> (pestaña Precios).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("vista") === "costos") setVista("costos");
    else if (params.get("q")) setVista("precios");
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Cambios escritos sin guardar: el menú pregunta antes de salir de la pantalla.
  const hayEdiciones = Object.keys(ediciones).length > 0;
  useEffect(() => {
    setIsDirty(hayEdiciones);
    if (!hayEdiciones) return undefined;
    registerDiscardHandler(() => setEdiciones({}));
    registerSaveHandler(() => {
      setToast({ type: "warning", message: "Para guardar los precios: «Simular» y luego «Guardar y enviar al Sheet»." });
      return false;
    });
    return () => {
      clearDiscardHandler();
      clearSaveHandler();
    };
  }, [hayEdiciones, setIsDirty, registerDiscardHandler, clearDiscardHandler, registerSaveHandler, clearSaveHandler]);
  useEffect(() => () => setIsDirty(false), [setIsDirty]);

  const verCostos = !!estado?.ver_costos;
  const costosPendientes = verCostos ? (costos?.alertas || []).length : 0;
  // La pestaña de costos es solo para quien puede ver costos.
  useEffect(() => { if (estado && !estado.ver_costos && vista === "costos") setVista("precios"); }, [estado, vista, setVista]);
  const conectado = !!estado?.configurado && !!estado?.acceso?.ok;
  const ultimo = estado?.ultimo_envio;
  const cerrarToast = useCallback(() => setToast(null), []);

  return (
    <div className="page pagina-actualizacion-precios">
      {toast && <Toast type={toast.type} message={toast.message} onClose={cerrarToast} />}
      <div className="page-header">
        <div style={{ minWidth: 0 }}>
          {/* (2026-11-17) Es una sección de Productos: se vuelve al catálogo desde aquí
              (por el menú o por este enlace, que avisa si hay cambios sin guardar). */}
          <button type="button" onClick={() => requestNavigation("/productos")} className="table-link" style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12.5, marginBottom: 4, background: "none", border: "none", padding: 0, cursor: "pointer", fontFamily: "inherit" }}>
            <ArrowLeft size={13} /> Productos
          </button>
          <h1 className="page-title">Actualización de precios</h1>
          <p className="page-subtitle">El costo y los precios de los productos se cambian aquí —uno a uno o en masa— y la plataforma los envía a Bsale y al Google Sheet «Lista de Precios».</p>
        </div>
        <div className="page-actions" style={{ flexWrap: "wrap" }}>
          {estado?.sheet_url && (
            <a className="btn btn-secondary" href={estado.sheet_url} target="_blank" rel="noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 6, textDecoration: "none" }}>
              <FileSpreadsheet size={14} /> Abrir el Sheet
            </a>
          )}
          <button type="button" className="btn btn-secondary" onClick={cargarTodo} disabled={cargando} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <RefreshCw size={14} className={cargando ? "spin" : ""} /> Actualizar
          </button>
        </div>
      </div>

      {error && <Aviso tipo="error">{error}</Aviso>}
      {estado?.error_migracion && <Aviso>{estado.error_migracion} Mientras tanto los precios se guardan en la plataforma (y en Bsale), pero no llegan al Sheet.</Aviso>}
      {estado && estado.migracion && !conectado && (
        <Aviso>
          La plataforma no puede escribir en el Sheet: {estado.acceso?.error || "sin conexión."} Los cambios de precio se guardan igual y quedan en la cola hasta que se resuelva.{" "}
          <button type="button" onClick={() => setVista("sheet")} style={{ background: "none", border: "none", padding: 0, color: "inherit", textDecoration: "underline", cursor: "pointer", fontSize: 13, fontFamily: "inherit" }}>Ver la conexión</button>
        </Aviso>
      )}

      {costosPendientes > 0 && vista !== "costos" && (
        <Aviso>
          <b>{costosPendientes} producto{costosPendientes === 1 ? "" : "s"}</b> {costosPendientes === 1 ? "llegó" : "llegaron"} en recepción de stock con un costo mayor al que {costosPendientes === 1 ? "tiene" : "tienen"}: falta confirmar si el alza es definitiva o momentánea.{" "}
          <button type="button" onClick={() => setVista("costos")} style={{ background: "none", border: "none", padding: 0, color: "inherit", textDecoration: "underline", cursor: "pointer", fontSize: 13, fontFamily: "inherit", fontWeight: 700 }}>Revisar</button>
        </Aviso>
      )}

      <div className="stats-row">
        <div className="stat-card">
          <div className="stat-label" style={{ display: "flex", alignItems: "center", gap: 6 }}><Tags size={14} /> Productos</div>
          <div className="stat-value">{num(productos?.length ?? 0)}</div>
          <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 2 }}>{num((productos || []).filter((p) => p.con_sku !== false).length)} con SKU van al Sheet</div>
        </div>
        <div className="stat-card">
          <div className="stat-label" style={{ display: "flex", alignItems: "center", gap: 6 }}><FileSpreadsheet size={14} /> Google Sheet</div>
          <div className="stat-value" style={{ fontSize: 20 }}>{!estado ? "—" : conectado ? "Conectado" : "Sin conexión"}</div>
          <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 2 }}>{conectado ? `${estado.acceso.pestanas} pestañas de categoría` : "los cambios quedan en la cola"}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label" style={{ display: "flex", alignItems: "center", gap: 6 }}><CloudUpload size={14} /> Por enviar al Sheet</div>
          <div className="stat-value">{estado?.pendientes > 1000 ? "1.000+" : num(estado?.pendientes ?? 0)}</div>
          <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 2 }}>{ultimo ? `último envío ${fechaHora(ultimo.created_at)}` : "todavía sin envíos"}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label" style={{ display: "flex", alignItems: "center", gap: 6 }}><AlertTriangle size={14} /> Con error</div>
          <div className="stat-value">{estado?.errores > 1000 ? "1.000+" : num(estado?.errores ?? 0)}</div>
          <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 2 }}>{estado?.errores ? "se reintentan solos; ver pestaña Google Sheet" : "nada pendiente de corregir"}</div>
        </div>
      </div>

      <div className="pagos-tabs" role="tablist" aria-label="Secciones de la actualización de precios">
        {[
          { value: "precios", label: "Precios", Icono: Tags, n: Object.keys(ediciones).length || null },
          ...(verCostos ? [{ value: "costos", label: "Costos por confirmar", Icono: PackagePlus, n: costosPendientes || null }] : []),
          { value: "sheet", label: "Google Sheet", Icono: FileSpreadsheet, n: (estado?.pendientes || 0) + (estado?.errores || 0) || null },
          { value: "historial", label: "Historial", Icono: History, n: null },
        ].map((p) => (
          <button key={p.value} type="button" role="tab" aria-selected={vista === p.value} className={vista === p.value ? "activo" : ""} onClick={() => setVista(p.value)}>
            <p.Icono size={15} /> {p.label} {p.n ? <span className="pagos-tab-n">{num(p.n)}</span> : null}
          </button>
        ))}
      </div>

      {vista === "costos" && verCostos
        ? <PestanaCostos costos={costos} setToast={setToast} onResuelto={(decision) => Promise.all([cargarCostos(), ...(decision === "definitiva" ? [cargarProductos(), cargarEstado(), cargarHistorial()] : [])])} />
        : vista === "sheet"
        ? <PestanaSheet estado={estado} verCostos={verCostos} envios={envios} onProbar={() => cargarEstado(true)} onCambio={() => Promise.all([cargarEstado(), cargarHistorial()])} setToast={setToast} />
        : vista === "historial"
          ? <PestanaHistorial cambios={cambios} />
          : <PestanaPrecios productos={productos} cargando={cargando} verCostos={verCostos} estado={estado} ediciones={ediciones} setEdiciones={setEdiciones} onGuardado={() => Promise.all([cargarProductos(), cargarEstado(), cargarHistorial()])} setToast={setToast} />}
    </div>
  );
}
