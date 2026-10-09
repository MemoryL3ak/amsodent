import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { AlertTriangle, CheckCircle2, ExternalLink, Loader2, PackagePlus, X } from "lucide-react";
import { api } from "../lib/api";
import DropdownSelect from "./ui/DropdownSelect";
import { CATEGORIAS_PRODUCTO } from "../constants/categoriasProducto";

/* ── Crear producto desde el Explorador de Precios (2026-10-07) ─────────────
   Pedido de Ariel: un botón en el explorador interno (no el del portal) que
   cree el producto como TRANSITORIO — no tendrá toda la información — y que
   reconozca cuando ya está creado por su link de referencia.
   (2026-10-09) Pedido de Ariel: todos los campos obligatorios salvo la marca,
   y traer de la página de la tienda el máximo de datos: al abrir se pide
   /explorador/interno/detalle (marca, SKU, descripción) y se precarga; de
   nuestra web, el precio publicado pasa a Lista 1 (neto). El link queda en
   link_referencia y la imagen se copia al catálogo. Simular revisa sin
   crear; el servidor vuelve a validar y frena los duplicados. */

const OBLIGATORIOS = [["nombre", "Nombre"], ["categoria", "Categoría"], ["formato", "Formato"], ["descripcion", "Descripción"], ["costo", "Costo neto"], ["lista1", "Lista 1"], ["lista2", "Lista 2"]];

const soloMonto = (v) => String(v || "").replace(/[^\d]/g, "");
const fmt = (n) => (Number(n) > 0 ? `$${Math.round(Number(n)).toLocaleString("es-CL")}` : "—");

export default function CrearProductoExplorador({ item, onCreado, onCerrar }) {
  const [f, setF] = useState({
    nombre: item?.nombre || "", marca: "", categoria: "", formato: "", descripcion: "", costo: "",
    // De nuestra web el precio publicado es con IVA: Lista 1 neta.
    lista1: item?.tienda === "amsodent" && Number(item?.precio) > 0 ? String(Math.round(Number(item.precio) / 1.19)) : "",
    lista2: "",
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
          marca: x.marca || d.marca || "",
          descripcion: x.descripcion || d.descripcion || "",
          nombre: x.nombre || d.nombre || "",
        }));
      })
      .catch(() => { /* sin detalle: se completa a mano */ })
      .finally(() => vivo && setLeyendo(false));
    return () => { vivo = false; };
  }, [item?.url, item?.tienda]);
  const faltan = OBLIGATORIOS.filter(([k]) => !String(f[k] || "").trim() || (["costo", "lista1", "lista2"].includes(k) && !(Number(f[k]) > 0))).map(([, e]) => e);

  async function enviar(accion, extra = {}) {
    setEnviando(accion);
    setError("");
    try {
      const r = await api.post("/stock-clientes/explorador/interno/crear-producto", {
        // De nuestra web va el SKU: el servidor revisa que no exista y lo deja en el producto.
        url: item.url, imagen: item.imagen || null, tienda: item.tienda || null, sku: item.tienda === "amsodent" ? item.sku || null : null,
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

  const campo = (k, etiqueta, { monto = false, placeholder = "", full = false } = {}) => (
    <label style={{ display: "flex", flexDirection: "column", gap: 4, flex: full ? "1 1 100%" : "1 1 180px", minWidth: 0 }}>
      <span className="field-label">{etiqueta}</span>
      <input
        className="input"
        value={f[k]}
        inputMode={monto ? "numeric" : undefined}
        placeholder={placeholder}
        onChange={(e) => set(k)(monto ? soloMonto(e.target.value) : e.target.value)}
        disabled={!!enviando}
      />
    </label>
  );

  const problemas = resultado?.problemas || [];
  const avisos = resultado?.avisos || [];
  const existente = resultado?.ya_existe ? resultado.producto : null;

  return createPortal(
    <div onClick={onCerrar} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.5)", zIndex: 11050, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div className="modal-crear-producto-explorador" onClick={(e) => e.stopPropagation()} style={{ width: 640, maxWidth: "100%", maxHeight: "92vh", overflow: "auto", background: "var(--surface)", borderRadius: "var(--radius-lg)", border: "1px solid var(--border)", boxShadow: "var(--shadow-lg)" }}>
        <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
          <div>
            <strong style={{ fontSize: 15, display: "inline-flex", alignItems: "center", gap: 6 }}><PackagePlus size={16} /> Crear producto transitorio</strong>
            <div style={{ fontSize: 12.5, color: "var(--text-muted)" }}>
              {item?.tienda === "amsodent" && item?.sku
                ? <>Queda con el SKU <b>{item.sku}</b> de nuestra web, en estado «Transitorio» (falta la ficha), con el link como referencia. Si el SKU ya está en Bsale, se enlaza a esa variante.</>
                : "Queda sin SKU y en estado «Transitorio», con el link de la tienda como referencia. Lo demás se completa después en Productos."}
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
              <div style={{ color: "var(--text-muted)" }}>{item?.imagen ? "La imagen se copia al catálogo." : "Sin imagen: súbela después en Productos."}</div>
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {campo("nombre", "Nombre *", { full: true })}
            <label style={{ display: "flex", flexDirection: "column", gap: 4, flex: "1 1 180px", minWidth: 0 }}>
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
            {campo("formato", "Formato *", { placeholder: "Unidad, caja x 100, frasco 500 ml…" })}
            {campo("marca", "Marca", { placeholder: leyendo ? "Leyendo la tienda…" : "Opcional" })}
            {campo("costo", "Costo neto *", { monto: true })}
            {campo("lista1", "Lista 1 (neto) *", { monto: true, placeholder: item?.tienda === "amsodent" ? "Del precio web, sin IVA" : "" })}
            {campo("lista2", "Lista 2 (neto) *", { monto: true })}
            <label style={{ display: "flex", flexDirection: "column", gap: 4, flex: "1 1 100%", minWidth: 0 }}>
              <span className="field-label">Descripción *</span>
              <textarea
                className="input descripcion-producto"
                rows={4}
                value={f.descripcion}
                placeholder={leyendo ? "Leyendo la ficha en la tienda…" : "Qué es, para qué sirve, cómo viene…"}
                onChange={(e) => set("descripcion")(e.target.value.slice(0, 2000))}
                disabled={!!enviando}
                style={{ resize: "vertical", minHeight: 72, fontSize: 13, lineHeight: 1.4 }}
              />
              {detalle && (detalle.descripcion || detalle.marca || detalle.sku) && (
                <span style={{ fontSize: 11.5, color: "var(--text-muted)" }}>
                  Traído de la tienda: {[detalle.marca && "marca", detalle.descripcion && "descripción", detalle.sku && `SKU ${detalle.sku}`].filter(Boolean).join(", ")}. Revísalo antes de crear.
                </span>
              )}
            </label>
          </div>
          {faltan.length > 0 && !existente && (
            <div className="faltan-campos" style={{ fontSize: 12, color: "#92400e" }}>Falta: {faltan.join(", ")}. Todo es obligatorio salvo la marca.</div>
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
              <CheckCircle2 size={13} style={{ verticalAlign: -2 }} /> Simulación: se crearía «{resultado.producto?.nombre}» como Transitorio en {resultado.producto?.categoria} ({resultado.producto?.formato}), {resultado.producto?.sku ? `con el SKU ${resultado.producto.sku}` : "sin SKU"}. No se creó nada.
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
