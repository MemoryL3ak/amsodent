// CrearOrdenCompra.jsx
// Formulario de creación/edición de una Orden de Compra. Solo admin.
// La búsqueda/selección de productos es la MISMA que en la
// creación de cotización: react-select por SKU + ProductoPickerModal del
// catálogo. Al elegir un producto se completa descripción y costo (valor
// unitario de compra). Exporta a PDF con el formato de la marca.
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import Select, { components } from "react-select";
import { api } from "../lib/api";
import useAuth from "../hooks/useAuth";
import ProductoPickerModal from "../components/ProductoPickerModal";
import { Plus, Trash2, FileDown, Save, ArrowLeft, Search } from "lucide-react";
import { generarPDFOrdenCompra } from "../components/OrdenCompraDocument";

/* ── Buscador react-select (idéntico a Crear Cotización) ──────────────── */
const CAP_OPCIONES_SELECT = 60;
const MenuListLimitada = (props) => {
  const { children } = props;
  if (Array.isArray(children) && children.length > CAP_OPCIONES_SELECT) {
    return (
      <components.MenuList {...props}>
        {children.slice(0, CAP_OPCIONES_SELECT)}
        <div style={{ padding: "8px 12px", fontSize: 12, color: "#64748b", textAlign: "center", borderTop: "1px solid #eef1f4" }}>
          {children.length.toLocaleString("es-CL")} resultados — escribe para refinar la búsqueda
        </div>
      </components.MenuList>
    );
  }
  return <components.MenuList {...props}>{children}</components.MenuList>;
};
function normalizarTexto(str) {
  return (str ?? "").toString().toLowerCase().normalize("NFD")
    .replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}
function filtrarPorTerminos(option, inputValue) {
  const q = normalizarTexto(inputValue);
  if (!q) return true;
  const label = normalizarTexto(option.label);
  return q.split(" ").filter(Boolean).every((t) => label.includes(t));
}
const customStyles = {
  control: (base) => ({ ...base, minHeight: "40px", fontSize: "13px", fontFamily: "inherit" }),
  valueContainer: (base) => ({ ...base, fontSize: "13px", fontFamily: "inherit" }),
  input: (base) => ({ ...base, fontSize: "13px", fontFamily: "inherit", color: "#333" }),
  singleValue: (base) => ({ ...base, fontSize: "13px", fontFamily: "inherit" }),
  option: (base, state) => ({ ...base, fontSize: "13px", fontFamily: "inherit", background: state.isFocused ? "#1A73E8" : "white", color: state.isFocused ? "white" : "#333", cursor: "pointer" }),
  placeholder: (base) => ({ ...base, fontSize: "13px", fontFamily: "inherit" }),
  menuPortal: (base) => ({ ...base, zIndex: 99999 }),
};

const hoyISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const fmtCLP = (v) => `$${Number(v || 0).toLocaleString("es-CL")}`;
const itemVacio = () => ({ sku: "", descripcion: "", cantidad: 1, valor_unitario: 0 });

export default function CrearOrdenCompra() {
  const navigate = useNavigate();
  const { id } = useParams();
  const editando = Boolean(id);
  const { rol, cargando, perfil, user } = useAuth();
  const rolNorm = (rol || "").toString().trim().toLowerCase();
  const puedeVer = ["admin", "administrador"].includes(rolNorm);

  const [numero, setNumero] = useState(null);
  const [fechaEmision, setFechaEmision] = useState(hoyISO());
  const [prov, setProv] = useState({ razon: "", rut: "", correo: "" });
  const [vend, setVend] = useState({ nombre: "", correo: "" });
  const [items, setItems] = useState([itemVacio()]);
  const [observaciones, setObservaciones] = useState("");
  const [productos, setProductos] = useState([]);
  const [pickerIndex, setPickerIndex] = useState(null);
  const [toast, setToast] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get("/productos").then((data) => setProductos(Array.isArray(data) ? data : [])).catch(() => setProductos([]));
  }, []);

  const prodBySku = useMemo(() => {
    const m = new Map();
    productos.forEach((p) => { const sku = String(p.sku || "").trim().toUpperCase(); if (sku) m.set(sku, p); });
    return m;
  }, [productos]);
  const opcionesSKU = useMemo(
    () => productos.filter((p) => String(p.sku || "").trim() !== "")
      .map((p) => ({ value: String(p.sku).trim(), label: String(p.sku).trim() })),
    [productos],
  );

  // Cargar (edición) o número correlativo (nuevo).
  useEffect(() => {
    if (cargando || !puedeVer) { if (!cargando) setLoading(false); return; }
    let activo = true;
    (async () => {
      try {
        if (editando) {
          const oc = await api.get(`/ordenes-compra/${id}`);
          if (!activo || !oc) return;
          setNumero(oc.numero);
          setFechaEmision((oc.fecha_emision || hoyISO()).slice(0, 10));
          setProv({ razon: oc.proveedor_razon_social || "", rut: oc.proveedor_rut || "", correo: oc.proveedor_correo || "" });
          setVend({ nombre: oc.vendedor_nombre || "", correo: oc.vendedor_correo || "" });
          setItems(Array.isArray(oc.items) && oc.items.length ? oc.items.map((it) => ({ ...itemVacio(), ...it })) : [itemVacio()]);
          setObservaciones(oc.observaciones || "");
        } else {
          const r = await api.get("/ordenes-compra/next-numero");
          if (activo) setNumero(r?.numero || 1);
          // OC nueva: el vendedor se asigna según la sesión del usuario.
          if (activo) setVend({ nombre: perfil?.nombre || "", correo: perfil?.email || user?.email || "" });
        }
      } catch (e) {
        console.error(e);
        if (activo) setToast({ type: "error", message: "No se pudo cargar la orden de compra." });
      } finally {
        if (activo) setLoading(false);
      }
    })();
    return () => { activo = false; };
  }, [cargando, puedeVer, editando, id]);

  function setItem(idx, patch) {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }
  // Al elegir un SKU del listbox, completa descripción y costo del producto.
  function seleccionarSku(idx, sku) {
    const s = String(sku || "").trim();
    const p = prodBySku.get(s.toUpperCase());
    if (p) setItem(idx, { sku: s, descripcion: p.nombre || "", valor_unitario: Number(p.costo || 0) });
    else setItem(idx, { sku: s });
  }
  // Selección desde el ProductoPickerModal (mismo que en cotización).
  function seleccionarProductoDesdePicker(prod) {
    const idx = pickerIndex;
    setPickerIndex(null);
    if (idx == null || !prod) return;
    setProductos((prev) => {
      const existeSku = prod.sku ? prev.some((p) => String(p.sku || "").trim() === String(prod.sku).trim()) : false;
      const existeId = prod.id != null ? prev.some((p) => p.id === prod.id) : false;
      return existeSku || existeId ? prev : [...prev, prod];
    });
    setItem(idx, {
      sku: prod.sku ? String(prod.sku).trim() : "",
      descripcion: prod.nombre || "",
      valor_unitario: Number(prod.costo ?? 0),
    });
  }
  function handleProductoCreado(prod) {
    if (!prod) return;
    setProductos((prev) => (prev.some((p) => p.id === prod.id) ? prev : [...prev, prod]));
  }
  const addItem = () => setItems((p) => [...p, itemVacio()]);
  const delItem = (idx) => setItems((p) => (p.length > 1 ? p.filter((_, i) => i !== idx) : p));

  const totales = useMemo(() => {
    const its = items.map((it) => ({ ...it, total: Math.round(Number(it.cantidad || 0) * Number(it.valor_unitario || 0)) }));
    const subtotal = its.reduce((a, it) => a + it.total, 0);
    const iva = Math.round(subtotal * 0.19);
    return { its, subtotal, iva, total: subtotal + iva };
  }, [items]);

  function construirPayload() {
    return {
      fecha_emision: fechaEmision || null,
      proveedor_razon_social: prov.razon, proveedor_rut: prov.rut, proveedor_correo: prov.correo,
      vendedor_nombre: vend.nombre, vendedor_correo: vend.correo,
      items: totales.its.map((it) => ({
        sku: it.sku, descripcion: it.descripcion,
        cantidad: Number(it.cantidad || 0), valor_unitario: Number(it.valor_unitario || 0), total: it.total,
      })),
      observaciones,
    };
  }

  async function guardar() {
    if (!totales.its.some((it) => it.descripcion || it.sku)) {
      setToast({ type: "error", message: "Agrega al menos un producto." });
      return;
    }
    setGuardando(true);
    try {
      const payload = construirPayload();
      const guardada = editando
        ? await api.put(`/ordenes-compra/${id}`, payload)
        : await api.post("/ordenes-compra", payload);
      setToast({ type: "success", message: "Orden de compra guardada." });
      navigate(`/ordenes-compra/${guardada.id}`, { replace: true });
    } catch (e) {
      console.error(e);
      setToast({ type: "error", message: "No se pudo guardar la orden de compra." });
    } finally {
      setGuardando(false);
    }
  }

  async function exportarPDF() {
    try {
      await generarPDFOrdenCompra({
        numero: numero || 0, fecha_emision: fechaEmision,
        proveedor_razon_social: prov.razon, proveedor_rut: prov.rut, proveedor_correo: prov.correo,
        vendedor_nombre: vend.nombre, vendedor_correo: vend.correo,
        items: totales.its, subtotal_neto: totales.subtotal, iva: totales.iva, total: totales.total, observaciones,
      });
    } catch (e) {
      console.error("Error generando PDF de OC:", e);
      setToast({ type: "error", message: "No se pudo generar el PDF. Revisa la consola." });
    }
  }

  if (!cargando && !puedeVer) {
    return (
      <div className="page">
        <div className="surface"><div className="surface-body" style={{ color: "var(--danger)" }}>
          Acceso restringido: las órdenes de compra son solo para administración.
        </div></div>
      </div>
    );
  }

  const inputCls = "input";

  return (
    <div className="page">
      {pickerIndex !== null && (
        <ProductoPickerModal
          productos={productos}
          onSelect={seleccionarProductoDesdePicker}
          onClose={() => setPickerIndex(null)}
          listadoInicial="1"
          tipoCompra={undefined}
          onProductoCreado={handleProductoCreado}
        />
      )}

      <div className="page-header" style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div>
          <button className="btn btn-ghost btn-sm" onClick={() => navigate("/ordenes-compra")} style={{ display: "inline-flex", alignItems: "center", gap: 5, marginBottom: 6 }}>
            <ArrowLeft size={15} /> Volver al listado
          </button>
          <h1 className="page-title">Orden de Compra {numero ? `#${String(numero).padStart(4, "0")}` : ""}</h1>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-secondary" onClick={exportarPDF} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <FileDown size={15} /> Exportar PDF
          </button>
          <button className="btn btn-primary" onClick={guardar} disabled={guardando} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <Save size={15} /> {guardando ? "Guardando…" : "Guardar"}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="surface" style={{ padding: "40px 24px", color: "var(--text-muted)" }}>Cargando…</div>
      ) : (
        <>
          {/* Datos generales */}
          <div className="surface" style={{ padding: 18, marginBottom: 16 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14 }}>
              <div className="field">
                <label className="field-label">Fecha de emisión</label>
                <input type="date" className={inputCls} value={fechaEmision} onChange={(e) => setFechaEmision(e.target.value)} />
              </div>
            </div>

            <h3 className="surface-title" style={{ margin: "16px 0 8px" }}>Datos del Proveedor</h3>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14 }}>
              <div className="field"><label className="field-label">Razón Social</label><input className={inputCls} value={prov.razon} onChange={(e) => setProv((p) => ({ ...p, razon: e.target.value }))} /></div>
              <div className="field"><label className="field-label">RUT</label><input className={inputCls} value={prov.rut} onChange={(e) => setProv((p) => ({ ...p, rut: e.target.value }))} /></div>
              <div className="field"><label className="field-label">Correo</label><input className={inputCls} value={prov.correo} onChange={(e) => setProv((p) => ({ ...p, correo: e.target.value }))} /></div>
            </div>

            <h3 className="surface-title" style={{ margin: "16px 0 8px" }}>Ejecutivo Solicitante <span style={{ fontSize: 12, fontWeight: 400, color: "var(--text-muted)" }}>· según la sesión</span></h3>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14 }}>
              <div className="field"><label className="field-label">Nombre</label><input className={inputCls} value={vend.nombre} readOnly title="Se asigna automáticamente según el usuario de la sesión" style={{ background: "var(--bg)" }} /></div>
              <div className="field"><label className="field-label">Correo</label><input className={inputCls} value={vend.correo} readOnly title="Se asigna automáticamente según el usuario de la sesión" style={{ background: "var(--bg)" }} /></div>
            </div>
          </div>

          {/* Detalle de productos */}
          <div className="surface" style={{ padding: 18, marginBottom: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <h3 className="surface-title" style={{ margin: 0 }}>Detalle de Productos</h3>
              <button className="btn btn-sm btn-secondary" onClick={addItem} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                <Plus size={14} /> Agregar ítem
              </button>
            </div>

            <div style={{ overflowX: "auto" }}>
              <table className="data-table" style={{ width: "100%", minWidth: 900 }}>
                <thead>
                  <tr>
                    <th style={{ width: 36, textAlign: "center" }}>#</th>
                    <th style={{ width: 170, textAlign: "left" }}>SKU</th>
                    <th style={{ textAlign: "left" }}>Descripción</th>
                    <th style={{ width: 88, textAlign: "center" }}>Cantidad</th>
                    <th style={{ width: 130, textAlign: "right" }}>Valor Unitario</th>
                    <th style={{ width: 120, textAlign: "right" }}>Total</th>
                    <th style={{ width: 44 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {totales.its.map((it, idx) => (
                    <tr key={idx}>
                      <td style={{ textAlign: "center", color: "var(--text-muted)" }}>{idx + 1}</td>
                      <td>
                        <Select
                          options={opcionesSKU}
                          styles={customStyles}
                          placeholder="SKU…"
                          menuPortalTarget={typeof document !== "undefined" ? document.body : null}
                          isSearchable
                          isClearable
                          filterOption={filtrarPorTerminos}
                          components={{ MenuList: MenuListLimitada }}
                          value={opcionesSKU.find((o) => o.value === it.sku) || (it.sku ? { value: it.sku, label: it.sku } : null)}
                          onChange={(op) => seleccionarSku(idx, op ? op.value : "")}
                        />
                      </td>
                      <td>
                        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                          <input className={inputCls} value={it.descripcion} placeholder="Descripción del producto"
                            onChange={(e) => setItem(idx, { descripcion: e.target.value })} style={{ flex: 1 }} />
                          <button type="button" className="btn btn-sm btn-ghost" title="Buscar producto en el catálogo"
                            onClick={() => setPickerIndex(idx)} style={{ padding: 6, lineHeight: 0, flexShrink: 0 }}>
                            <Search size={15} />
                          </button>
                        </div>
                      </td>
                      <td>
                        <input type="number" min="0" className={inputCls} value={it.cantidad}
                          onChange={(e) => setItem(idx, { cantidad: e.target.value })} style={{ textAlign: "center" }} />
                      </td>
                      <td>
                        <input type="number" min="0" className={inputCls} value={it.valor_unitario}
                          onChange={(e) => setItem(idx, { valor_unitario: e.target.value })} style={{ textAlign: "right" }} />
                      </td>
                      <td style={{ textAlign: "right", fontWeight: 600, whiteSpace: "nowrap" }}>{fmtCLP(it.total)}</td>
                      <td style={{ textAlign: "center" }}>
                        <button className="btn btn-sm btn-ghost" onClick={() => delItem(idx)} title="Quitar" style={{ padding: 6, lineHeight: 0 }}>
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Totales */}
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14 }}>
              <div style={{ width: 280, border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden" }}>
                <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 14px", borderBottom: "1px solid var(--border)" }}>
                  <span style={{ fontWeight: 600, color: "var(--primary-dark)" }}>Subtotal Neto</span><span>{fmtCLP(totales.subtotal)}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 14px", borderBottom: "1px solid var(--border)" }}>
                  <span style={{ fontWeight: 600, color: "var(--primary-dark)" }}>IVA (19%)</span><span>{fmtCLP(totales.iva)}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 14px", background: "var(--bg)" }}>
                  <span style={{ fontWeight: 800, color: "var(--primary-dark)", fontSize: 15 }}>TOTAL</span>
                  <span style={{ fontWeight: 800, color: "var(--primary-dark)", fontSize: 16 }}>{fmtCLP(totales.total)}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Observaciones */}
          <div className="surface" style={{ padding: 18 }}>
            <h3 className="surface-title" style={{ margin: "0 0 8px" }}>Observaciones</h3>
            <textarea className={inputCls} rows={3} value={observaciones} placeholder="Datos de despacho, condiciones, etc."
              onChange={(e) => setObservaciones(e.target.value)} style={{ resize: "vertical" }} />
          </div>
        </>
      )}

      {toast && (
        <div onClick={() => setToast(null)}
          style={{
            position: "fixed", bottom: 22, right: 22, zIndex: 12000, cursor: "pointer",
            background: toast.type === "error" ? "#fef2f2" : "#f0fdf4",
            border: `1px solid ${toast.type === "error" ? "#fecaca" : "#bbf7d0"}`,
            color: toast.type === "error" ? "#b91c1c" : "#15803d",
            padding: "12px 16px", borderRadius: 10, fontSize: 13, fontWeight: 600, boxShadow: "var(--shadow-lg)",
          }}>
          {toast.message}
        </div>
      )}
    </div>
  );
}
