import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { AlertTriangle, CheckCircle2, ExternalLink, Loader2, PackagePlus, X } from "lucide-react";
import { api } from "../lib/api";
import DropdownSelect from "./ui/DropdownSelect";
import { CATEGORIAS_PRODUCTO } from "../constants/categoriasProducto";
import { FACTOR_LISTA_3, calcularLista3 } from "../lib/listas";

/* ── Crear producto desde el Explorador de Productos (2026-10-07) ────────────
   Pedido de Ariel: un botón en el explorador interno que cree el producto
   como TRANSITORIO y que reconozca cuando ya está creado por su link.
   (2026-10-09) "Agregar todos los campos para crear el producto… y los campos
   de margen para que mientras crean visualicen cuánto margen tiene": el
   formulario trae las mismas secciones que Productos → Crear (general, ficha
   técnica, dimensiones, precios) y el margen de cada lista se calcula al
   escribir, igual que allá. Obligatorios: como en Productos (todo menos
   marca, SKU, modo de uso, almacenamiento, datos clave y venta showroom).
   Al abrir se lee la ficha en la tienda (marca, SKU, descripción, imagen) y
   se precarga; de nuestra web el precio publicado pasa a Lista 1 (neto). El
   link queda en link_referencia y la imagen se copia al catálogo. Simular
   revisa sin crear; el servidor vuelve a validar y frena los duplicados. */

const OBLIGATORIOS = [
  ["nombre", "Nombre"], ["categoria", "Categoría"], ["formato", "Formato"],
  ["presentacion", "Presentación"], ["descripcion", "Descripción"], ["composicion", "Composición"], ["uso_indicaciones", "Uso / indicaciones"], ["beneficios", "Beneficios"],
  ["peso", "Peso"], ["alto", "Alto"], ["largo", "Largo"], ["ancho", "Ancho"],
  ["costo", "Costo neto"], ["lista1", "Lista 1"], ["lista2", "Lista 2"],
];
const MONTOS = ["costo", "lista1", "lista2", "precio_sugerido"];
const MEDIDAS = ["peso", "alto", "largo", "ancho"];
const soloMonto = (v) => String(v || "").replace(/[^\d]/g, "");
const soloDecimal = (v) => String(v || "").replace(/[^\d.,]/g, "").replace(",", ".");
const fmt = (n) => (Number(n) > 0 ? `$${Math.round(Number(n)).toLocaleString("es-CL")}` : "—");
const margenDe = (precio, costo) => (Number(precio) > 0 ? ((Number(precio) - Number(costo || 0)) / Number(precio)) * 100 : null);
const pct = (m) => (m == null ? "—" : `${m.toLocaleString("es-CL", { maximumFractionDigits: 1, minimumFractionDigits: 1 })} %`);
const colorMargen = (m) => (m == null ? "var(--text-muted)" : m < 0 ? "#b91c1c" : m < 20 ? "#b45309" : "#15803d");
const seccion = { fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".4px", color: "var(--text-muted)", marginBottom: 6 };
const caja = { border: "1px solid var(--border)", borderRadius: 10, padding: "10px 12px", display: "flex", flexDirection: "column", gap: 8 };

export default function CrearProductoExplorador({ item, onCreado, onCerrar }) {
  const [f, setF] = useState({
    sku: item?.tienda === "amsodent" ? item?.sku || "" : "",
    nombre: item?.nombre || "", marca: "", categoria: "", formato: "",
    presentacion: "", descripcion: "", composicion: "", uso_indicaciones: "", beneficios: "", modo_uso: "", almacenamiento: "", datos_clave: "",
    peso: "", alto: "", largo: "", ancho: "",
    costo: "",
    // De nuestra web el precio publicado es con IVA: Lista 1 neta.
    lista1: item?.tienda === "amsodent" && Number(item?.precio) > 0 ? String(Math.round(Number(item.precio) / 1.19)) : "",
    lista2: "", precio_sugerido: "",
  });
  const [detalle, setDetalle] = useState(null); // lo que publica la tienda del producto
  const [leyendo, setLeyendo] = useState(true);
  const [enviando, setEnviando] = useState("");
  const [resultado, setResultado] = useState(null);
  const [error, setError] = useState("");
  const set = (k) => (v) => { setF((x) => ({ ...x, [k]: v })); setResultado(null); };

  // Al abrir: lo que la tienda dice del producto, para no escribirlo a mano.
  useEffect(() => {
    let vivo = true;
    if (!item?.url) { setLeyendo(false); return undefined; }
    api.get(`/stock-clientes/explorador/interno/detalle?url=${encodeURIComponent(item.url)}&tienda=${encodeURIComponent(item.tienda || "")}`)
      .then((d) => {
        if (!vivo || !d) return;
        setDetalle(d);
        setF((x) => ({
          ...x,
          nombre: x.nombre || d.nombre || "",
          marca: x.marca || d.marca || "",
          presentacion: x.presentacion || d.presentacion || "",
          descripcion: x.descripcion || d.descripcion || "",
          sku: x.sku || (item?.tienda === "amsodent" ? d.sku || "" : ""),
        }));
      })
      .catch(() => { /* sin detalle: se completa a mano */ })
      .finally(() => vivo && setLeyendo(false));
    return () => { vivo = false; };
  }, [item?.url, item?.tienda]);

  const faltan = OBLIGATORIOS
    .filter(([k]) => {
      const v = String(f[k] || "").trim();
      if (!v) return true;
      if (MONTOS.includes(k) || MEDIDAS.includes(k)) return !(Number(v) > 0);
      return false;
    })
    .map(([, e]) => e);

  // Margen de cada lista, igual que en Productos: (precio − costo) / precio.
  const costoNum = Number(f.costo) || 0;
  const lista3 = useMemo(() => calcularLista3(Number(f.lista2) || 0), [f.lista2]);
  const margenes = {
    lista1: margenDe(f.lista1, costoNum),
    lista2: margenDe(f.lista2, costoNum),
    lista3: margenDe(lista3, costoNum),
    precio_sugerido: margenDe(f.precio_sugerido, costoNum),
  };
  const cm3 = useMemo(() => {
    const a = Number(f.alto) || 0, l = Number(f.largo) || 0, an = Number(f.ancho) || 0;
    return a && l && an ? (a * l * an).toFixed(3) : "";
  }, [f.alto, f.largo, f.ancho]);

  async function enviar(accion, extra = {}) {
    setEnviando(accion);
    setError("");
    try {
      const r = await api.post("/stock-clientes/explorador/interno/crear-producto", {
        url: item.url, imagen: item.imagen || null, tienda: item.tienda || null,
        ...f, ...(accion === "simular" ? { simular: true } : {}), ...extra,
      });
      setResultado(r);
      if (r?.creado) onCreado?.(r);
    } catch (e) {
      setError(e?.message || "No se pudo crear el producto.");
    } finally {
      setEnviando("");
    }
  }

  const campo = (k, etiqueta, { monto = false, decimal = false, placeholder = "", flex = "1 1 180px", readOnly = false, value } = {}) => (
    <label style={{ display: "flex", flexDirection: "column", gap: 4, flex, minWidth: 0 }}>
      <span className="field-label">{etiqueta}</span>
      <input
        className={`input campo-${k}`}
        value={value !== undefined ? value : f[k]}
        inputMode={monto || decimal ? "decimal" : undefined}
        placeholder={placeholder}
        onChange={readOnly ? undefined : (e) => set(k)(monto ? soloMonto(e.target.value) : decimal ? soloDecimal(e.target.value) : e.target.value)}
        readOnly={readOnly}
        disabled={!!enviando}
        style={readOnly ? { background: "var(--bg)", color: "var(--text-muted)" } : undefined}
      />
    </label>
  );
  const area = (k, etiqueta, { rows = 2, placeholder = "", flex = "1 1 300px" } = {}) => (
    <label style={{ display: "flex", flexDirection: "column", gap: 4, flex, minWidth: 0 }}>
      <span className="field-label">{etiqueta}</span>
      <textarea
        className={`input campo-${k}`}
        rows={rows}
        value={f[k]}
        placeholder={placeholder}
        onChange={(e) => set(k)(e.target.value.slice(0, 2000))}
        disabled={!!enviando}
        style={{ resize: "vertical", minHeight: 44, fontSize: 13, lineHeight: 1.4 }}
      />
    </label>
  );
  // Una fila de precio: neto, bruto y el margen a la vista (como en Productos → Crear).
  const filaPrecio = (k, etiqueta, { readOnly = false, value, hint = "" } = {}) => {
    const neto = Number(value !== undefined ? value : f[k]) || 0;
    const m = margenes[k];
    return (
      <div className={`fila-precio fila-${k}`} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
        {campo(k, etiqueta, { monto: true, readOnly, value: value !== undefined ? (value ? String(value) : "") : undefined, flex: "1 1 150px", placeholder: readOnly ? "" : "neto" })}
        <label style={{ display: "flex", flexDirection: "column", gap: 4, flex: "1 1 120px", minWidth: 0 }}>
          <span className="field-label">Bruto (IVA)</span>
          <input className="input" readOnly value={neto > 0 ? Math.round(neto * 1.19).toLocaleString("es-CL") : ""} style={{ background: "var(--bg)", color: "var(--text-muted)" }} />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, flex: "0 1 110px", minWidth: 0 }}>
          <span className="field-label">Margen</span>
          <input className={`input margen-${k}`} readOnly value={pct(m)} style={{ background: "var(--bg)", color: colorMargen(m), fontWeight: 700 }} title="(precio − costo) / precio" />
        </label>
        {hint && <div style={{ flexBasis: "100%", fontSize: 11.5, color: "var(--text-muted)", marginTop: -4 }}>{hint}</div>}
      </div>
    );
  };

  const problemas = resultado?.problemas || [];
  const avisos = resultado?.avisos || [];
  const existente = resultado?.ya_existe ? resultado.producto : null;

  return createPortal(
    <div onClick={onCerrar} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.5)", zIndex: 11050, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div className="modal-crear-producto-explorador" onClick={(e) => e.stopPropagation()} style={{ width: 780, maxWidth: "100%", maxHeight: "92vh", overflow: "auto", background: "var(--surface)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-lg)", border: "1px solid var(--border)" }}>
        <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
          <div>
            <strong style={{ fontSize: 15, display: "inline-flex", alignItems: "center", gap: 6 }}><PackagePlus size={16} /> Crear producto transitorio</strong>
            <div style={{ fontSize: 12.5, color: "var(--text-muted)" }}>
              {item?.tienda === "amsodent" && item?.sku
                ? <>Queda con el SKU <b>{item.sku}</b> de nuestra web, en estado «Transitorio», con el link como referencia. Si el SKU ya está en Bsale, se enlaza a esa variante.</>
                : "Queda en estado «Transitorio», con el link de la tienda como referencia. Los mismos campos que en Productos; el margen se calcula mientras escribes."}
            </div>
          </div>
          <button type="button" className="btn btn-ghost" onClick={onCerrar} style={{ padding: 6, flexShrink: 0 }} title="Cerrar"><X size={16} /></button>
        </div>

        <div style={{ padding: "14px 18px", display: "flex", flexDirection: "column", gap: 12 }}>
          {/* De dónde sale */}
          <div style={{ display: "flex", gap: 12, alignItems: "center", border: "1px solid var(--border)", borderRadius: 10, padding: 10, background: "var(--bg)" }}>
            {item?.imagen
              ? <img src={item.imagen} alt="" style={{ width: 64, height: 64, objectFit: "contain", background: "#fff", borderRadius: 8, flexShrink: 0 }} />
              : <div style={{ width: 64, height: 64, borderRadius: 8, background: "#fff", flexShrink: 0 }} />}
            <div style={{ minWidth: 0, fontSize: 12.5, lineHeight: 1.45 }}>
              <div style={{ fontWeight: 700 }}>{item?.tienda === "amsodent" ? "Amsodent (web)" : item?.tienda_nombre} · {fmt(item?.precio)}</div>
              <a href={item?.url} target="_blank" rel="noopener noreferrer" className="table-link" style={{ display: "inline-flex", alignItems: "center", gap: 4, overflowWrap: "anywhere" }}>
                {item?.url} <ExternalLink size={12} style={{ flexShrink: 0 }} />
              </a>
              <div style={{ color: "var(--text-muted)" }}>
                {item?.imagen ? "La imagen se copia al catálogo. " : "Sin imagen: súbela después en Productos. "}
                {leyendo ? "Leyendo la ficha en la tienda…" : detalle && (detalle.descripcion || detalle.marca || detalle.sku || detalle.presentacion)
                  ? `Traído de la tienda: ${[detalle.marca && "marca", detalle.presentacion && "presentación", detalle.descripcion && "descripción", detalle.sku && `SKU ${detalle.sku}`].filter(Boolean).join(", ")}. Revísalo antes de crear.`
                  : ""}
              </div>
            </div>
          </div>

          {/* General */}
          <div style={caja}>
            <div style={seccion}>Información general</div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              {campo("sku", item?.tienda === "amsodent" ? "SKU (de nuestra web)" : "SKU (opcional)", { placeholder: "Si ya tiene código", flex: "1 1 140px" })}
              {campo("nombre", "Nombre *", { flex: "3 1 300px" })}
              {campo("marca", "Marca", { placeholder: leyendo ? "Leyendo la tienda…" : "Opcional", flex: "1 1 160px" })}
              <label style={{ display: "flex", flexDirection: "column", gap: 4, flex: "1 1 200px", minWidth: 0 }}>
                <span className="field-label">Categoría *</span>
                <DropdownSelect
                  value={f.categoria}
                  onChange={set("categoria")}
                  minWidth={220}
                  placeholder="Elige la categoría"
                  options={CATEGORIAS_PRODUCTO.map((c) => ({ value: c, label: c }))}
                  disabled={!!enviando}
                />
              </label>
              {campo("formato", "Formato *", { placeholder: "Unidad, caja x 100, frasco 500 ml…", flex: "1 1 200px" })}
            </div>
          </div>

          {/* Ficha técnica */}
          <div style={caja}>
            <div style={seccion}>Ficha técnica</div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              {area("presentacion", "Presentación *", { placeholder: "Cómo viene: caja x 10, jeringa 4 g…" })}
              {area("descripcion", "Descripción *", { rows: 3, placeholder: leyendo ? "Leyendo la ficha en la tienda…" : "Qué es y para qué sirve" })}
              {area("composicion", "Composición *", { placeholder: "Materiales o componentes" })}
              {area("uso_indicaciones", "Uso / indicaciones *", { placeholder: "Para qué se usa" })}
              {area("beneficios", "Beneficios *", { placeholder: "Por qué elegirlo" })}
              {area("modo_uso", "Modo de uso", { placeholder: "Opcional" })}
              {area("almacenamiento", "Almacenamiento", { placeholder: "Opcional" })}
              {area("datos_clave", "Datos clave", { placeholder: "Opcional" })}
            </div>
          </div>

          {/* Dimensiones */}
          <div style={caja}>
            <div style={seccion}>Dimensiones</div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              {campo("peso", "Peso (kg) *", { decimal: true, placeholder: "0.25", flex: "1 1 120px" })}
              {campo("alto", "Alto (cm) *", { decimal: true, flex: "1 1 120px" })}
              {campo("largo", "Largo (cm) *", { decimal: true, flex: "1 1 120px" })}
              {campo("ancho", "Ancho (cm) *", { decimal: true, flex: "1 1 120px" })}
              {campo("cm3", "Centímetros cúbicos", { readOnly: true, value: cm3, flex: "1 1 140px" })}
            </div>
          </div>

          {/* Precios y margen */}
          <div style={caja}>
            <div style={seccion}>Precios y margen</div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
              {campo("costo", "Costo neto *", { monto: true, flex: "0 1 200px" })}
              <div style={{ fontSize: 11.5, color: "var(--text-muted)", flex: "1 1 240px", paddingBottom: 6 }}>Margen = (precio − costo) / precio. Bajo 20 % la cotización pide aprobación.</div>
            </div>
            {filaPrecio("lista1", "Lista 1 (neto) *", { hint: item?.tienda === "amsodent" ? "Precargada con el precio de nuestra web, sin IVA." : "" })}
            {filaPrecio("lista2", "Lista 2 (neto) *")}
            {filaPrecio("lista3", `Lista 3 (Lista 2 × ${FACTOR_LISTA_3})`, { readOnly: true, value: lista3, hint: "Se calcula sola: licitaciones de 9 a 24 meses." })}
            {filaPrecio("precio_sugerido", "Venta showroom (opcional)", { hint: "Precio sugerido al cliente del portal (Prevención e Higiene)." })}
          </div>

          {faltan.length > 0 && !existente && (
            <div className="faltan-campos" style={{ fontSize: 12, color: "#92400e" }}>Falta: {faltan.join(", ")}. Obligatorios como en Productos (todo menos marca, SKU, modo de uso, almacenamiento, datos clave y showroom).</div>
          )}
          {error && <div style={{ border: "1px solid #fecaca", background: "#fef2f2", color: "#b91c1c", borderRadius: 10, padding: "8px 12px", fontSize: 13 }}>{error}</div>}
          {existente && (
            <div className="aviso-ya-creado" style={{ border: "1px solid #bfdbfe", background: "#eff6ff", color: "#1e40af", borderRadius: 10, padding: "8px 12px", fontSize: 13 }}>
              Ya está creado con este link: <Link to={`/productos/editar/${existente.id}`} className="table-link">«{existente.nombre}»</Link> ({existente.sku ? `SKU ${existente.sku}` : "sin SKU"}, {existente.estado || "sin estado"}).
            </div>
          )}
          {!existente && problemas.length > 0 && (
            <div style={{ border: "1px solid #fde68a", background: "#fffbeb", color: "#92400e", borderRadius: 10, padding: "8px 12px", fontSize: 13, display: "flex", flexDirection: "column", gap: 3 }}>
              {problemas.map((p) => <div key={p.codigo + p.mensaje}><AlertTriangle size={13} style={{ verticalAlign: -2 }} /> {p.mensaje}</div>)}
              {resultado?.duplicado && (
                <div style={{ marginTop: 4 }}>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => enviar("crear", { permitir_duplicado: true })} disabled={!!enviando}>
                    Crear de todos modos
                  </button>
                </div>
              )}
            </div>
          )}
          {resultado?.simulacion && !resultado.bloqueada && (
            <div className="simulacion-producto" style={{ border: "1px solid #bbf7d0", background: "#f0fdf4", borderRadius: 10, padding: "8px 12px", fontSize: 12.5, color: "#166534" }}>
              <CheckCircle2 size={13} style={{ verticalAlign: -2 }} /> Simulación: se crearía «{resultado.producto?.nombre}» como Transitorio en {resultado.producto?.categoria} ({resultado.producto?.formato}), costo {fmt(resultado.producto?.costo)}, Lista 1 {fmt(resultado.producto?.lista1)} ({pct(margenes.lista1)}), Lista 2 {fmt(resultado.producto?.lista2)} ({pct(margenes.lista2)}).
            </div>
          )}
          {avisos.length > 0 && !existente && (
            <div style={{ fontSize: 12, color: "var(--text-muted)", display: "flex", flexDirection: "column", gap: 2 }}>
              {avisos.map((a) => <div key={a}>· {a}</div>)}
            </div>
          )}
        </div>

        <div style={{ padding: "12px 18px", borderTop: "1px solid var(--border)", display: "flex", justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}>
          <button type="button" className="btn btn-ghost" onClick={onCerrar} disabled={!!enviando}>Cancelar</button>
          <button type="button" className="btn btn-secondary" onClick={() => enviar("simular")} disabled={!!enviando || !!existente}>
            {enviando === "simular" ? <Loader2 size={14} className="spin" /> : null} Simular
          </button>
          <button type="button" className="btn btn-primary" onClick={() => enviar("crear")} disabled={!!enviando || !!existente || faltan.length > 0} title={faltan.length ? `Falta: ${faltan.join(", ")}` : ""}>
            {enviando === "crear" ? <Loader2 size={14} className="spin" /> : <PackagePlus size={14} />} Crear producto
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
