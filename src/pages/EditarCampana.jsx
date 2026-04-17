import React, { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { useNavigate, useParams } from "react-router-dom";
import Select from "react-select";
import Toast from "../components/Toast";

const selectStyles = {
  control: (base, state) => ({
    ...base,
    minHeight: "36px",
    height: "36px",
    borderRadius: "var(--radius)",
    borderColor: state.isFocused ? "var(--primary)" : "var(--border-strong)",
    backgroundColor: "var(--surface)",
    boxShadow: state.isFocused ? "0 0 0 2px rgba(40,174,177,.15)" : "none",
    fontSize: "13.5px",
    fontFamily: "var(--font)",
    ":hover": { borderColor: "var(--primary)" },
  }),
  valueContainer: (base) => ({ ...base, padding: "0 10px" }),
  indicatorsContainer: (base) => ({ ...base, height: "36px" }),
  indicatorSeparator: () => ({ display: "none" }),
  menu: (base) => ({ ...base, zIndex: 50, fontSize: "13.5px" }),
  menuPortal: (base) => ({ ...base, zIndex: 99999 }),
  option: (base, state) => ({
    ...base,
    backgroundColor: state.isFocused ? "var(--primary-light)" : "white",
    color: state.isFocused ? "var(--primary-dark)" : "var(--text)",
    cursor: "pointer",
    fontFamily: "var(--font)",
  }),
  placeholder: (base) => ({ ...base, color: "var(--text-muted)", fontFamily: "var(--font)" }),
  singleValue: (base) => ({ ...base, fontFamily: "var(--font)", color: "var(--text)" }),
};

export default function EditarCampana() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [toast, setToast] = useState(null);
  const [loading, setLoading] = useState(true);

  const [nombre, setNombre] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const [productos, setProductos] = useState([]);
  const [items, setItems] = useState([
    { id_item: null, sku: "", producto: "", precio_unitario: 0, precio_campania: "" },
  ]);

  useEffect(() => {
    async function cargarProductos() {
      try {
        const data = await api.get("/productos");
        setProductos((data || []).map((p) => ({ sku: p.sku, nombre: p.nombre, lista1: p.lista1 })));
      } catch (error) {
        console.error(error);
        setToast({ type: "error", message: "Error cargando productos" });
        setProductos([]);
      }
    }
    cargarProductos();
  }, []);

  const opcionesSKU = useMemo(
    () => (productos || []).map((p) => ({ value: p.sku, label: p.sku })),
    [productos]
  );

  useEffect(() => {
    async function cargarCampana() {
      setLoading(true);
      setToast(null);

      try {
        const c = await api.get(`/campanas/${id}`);

        setNombre(c.nombre || "");
        setStartDate(c.start_date || "");
        setEndDate(c.end_date || "");

        const normalizados = (c.items || []).map((x) => ({
          id_item:         x.id,
          sku:             x.sku || "",
          producto:        x.producto || "",
          precio_unitario: Number(x.precio_unitario || 0),
          precio_campania: String(x.precio_campania ?? ""),
        }));

        setItems(
          normalizados.length > 0
            ? normalizados
            : [{ id_item: null, sku: "", producto: "", precio_unitario: 0, precio_campania: "" }]
        );
      } catch (e) {
        console.error(e);
        setToast({ type: "error", message: "Error cargando campaña" });
      } finally {
        setLoading(false);
      }
    }

    cargarCampana();
  }, [id]);

  function actualizarItem(index, campo, valor) {
    const copia = [...items];
    const it = { ...copia[index] };

    if (campo === "sku") {
      it.sku = valor;
      const prod = productos.find((p) => p.sku === valor);
      it.producto = prod?.nombre || "";
      it.precio_unitario = Number(prod?.lista1 ?? 0);
    } else if (campo === "precio_campania") {
      it.precio_campania = valor;
    }

    copia[index] = it;
    setItems(copia);
  }

  function agregarItem() {
    setItems([...items, { id_item: null, sku: "", producto: "", precio_unitario: 0, precio_campania: "" }]);
  }

  async function eliminarItem(index) {
    if (items.length === 1) return;

    const target = items[index];
    if (target?.id_item) {
      try { await api.delete(`/campanas/items/${target.id_item}`); } catch (e) { console.error(e); }
    }

    const copia = [...items];
    copia.splice(index, 1);
    setItems(copia);
  }

  async function guardar() {
    setToast(null);

    const errores = [];
    if (!nombre.trim()) errores.push("Nombre Campaña");
    if (!startDate) errores.push("Fecha Inicio");
    if (!endDate) errores.push("Fecha Fin");

    const itemsParaGuardar = (items || []).filter((it) => {
      const sku  = (it?.sku ?? "").trim();
      const pc   = String(it?.precio_campania ?? "").trim();
      const pu   = Number(it?.precio_unitario ?? 0);
      const prod = String(it?.producto ?? "").trim();
      return sku || pc || pu > 0 || prod;
    });

    if (itemsParaGuardar.length === 0) errores.push("Debe agregar al menos 1 SKU");

    const skus = itemsParaGuardar.map((x) => String(x.sku || "").trim()).filter(Boolean);
    const dup  = skus.find((s, i) => skus.indexOf(s) !== i);
    if (dup) {
      setToast({ type: "error", message: `SKU duplicado en la campaña: ${dup}` });
      return;
    }

    if (errores.length > 0) {
      setToast({ type: "error", message: "Faltan campos obligatorios:\n\n• " + errores.join("\n• ") });
      return;
    }

    for (let i = 0; i < itemsParaGuardar.length; i++) {
      const it    = itemsParaGuardar[i];
      const faltan = [];
      if (!String(it?.sku ?? "").trim()) faltan.push("SKU");
      if (String(it?.precio_campania ?? "").trim() === "") faltan.push("Precio Campaña");
      if (faltan.length > 0) {
        setToast({ type: "error", message: `Ítem #${i + 1} incompleto.\n\nFaltan:\n• ${faltan.join("\n• ")}` });
        return;
      }
    }

    try {
      await api.put(`/campanas/${id}`, {
        nombre: nombre.trim(),
        start_date: startDate,
        end_date: endDate,
        items: itemsParaGuardar.map((it) => ({
          id_item: it.id_item || null,
          sku: String(it.sku),
          producto: String(it.producto || ""),
          precio_unitario: Number(it.precio_unitario || 0),
          precio_campania: Number(it.precio_campania || 0),
        })),
      });

      setToast({ type: "success", message: "Campaña actualizada correctamente." });
      navigate("/campanas");
    } catch (err) {
      console.error(err);
      setToast({ type: "error", message: "Error guardando campaña" });
    }
  }

  if (loading) return <div className="page" style={{ color: "var(--text-muted)" }}>Cargando campaña…</div>;

  return (
    <div className="page">
      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}

      {/* HEADER */}
      <div className="page-header">
        <div>
          <button
            onClick={() => navigate("/campanas")}
            style={{ fontSize: "13px", color: "var(--text-muted)", background: "none", border: "none", cursor: "pointer", padding: 0, marginBottom: "6px", display: "inline-flex", alignItems: "center", gap: "4px" }}
          >
            ← Volver al listado
          </button>
          <h1 className="page-title">Editar Campaña</h1>
        </div>
      </div>

      {/* DATOS CAMPAÑA */}
      <div className="surface" style={{ marginBottom: "20px" }}>
        <div className="surface-header">
          <h3 className="surface-title">Datos de la campaña</h3>
        </div>
        <div className="surface-body">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "20px" }}>
            <div className="field">
              <label className="field-label">Nombre Campaña *</label>
              <input
                className="input"
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
              />
            </div>

            <div className="field">
              <label className="field-label">Fecha Inicio *</label>
              <input
                type="date"
                className="input"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>

            <div className="field">
              <label className="field-label">Fecha Fin *</label>
              <input
                type="date"
                className="input"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
          </div>
        </div>
      </div>

      {/* PRODUCTOS */}
      <div className="surface">
        <div className="surface-header">
          <h3 className="surface-title">Productos</h3>
          <button onClick={agregarItem} className="btn btn-sm btn-ghost">
            + Agregar SKU
          </button>
        </div>
        <div className="surface-body" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          {items.map((it, idx) => (
            <div
              key={idx}
              style={{
                display: "grid",
                gridTemplateColumns: "220px 1fr 140px 140px 80px",
                gap: "12px",
                alignItems: "end",
                padding: "14px 16px",
                background: "var(--bg)",
                borderRadius: "var(--radius)",
                border: "1px solid var(--border)",
              }}
            >
              <div className="field">
                <label className="field-label">SKU</label>
                <Select
                  options={opcionesSKU}
                  styles={selectStyles}
                  placeholder="Seleccione SKU…"
                  menuPortalTarget={document.body}
                  isSearchable
                  value={opcionesSKU.find((o) => o.value === it.sku) || null}
                  onChange={(op) => actualizarItem(idx, "sku", op ? op.value : "")}
                />
              </div>

              <div className="field">
                <label className="field-label">Producto</label>
                <input
                  className="input"
                  value={it.producto}
                  readOnly
                  style={{ background: "var(--neutral-bg)", color: "var(--text-soft)" }}
                />
              </div>

              <div className="field">
                <label className="field-label">Precio Unitario</label>
                <div
                  className="input"
                  style={{ display: "flex", alignItems: "center", background: "var(--neutral-bg)", color: "var(--text-soft)", fontWeight: 600 }}
                >
                  ${Number(it.precio_unitario || 0).toLocaleString("es-CL")}
                </div>
              </div>

              <div className="field">
                <label className="field-label">Precio Campaña *</label>
                <input
                  type="number"
                  className="input"
                  value={it.precio_campania}
                  onChange={(e) => actualizarItem(idx, "precio_campania", e.target.value)}
                />
              </div>

              <div style={{ display: "flex", alignItems: "flex-end", paddingBottom: "1px" }}>
                {items.length > 1 && (
                  <button
                    onClick={() => eliminarItem(idx)}
                    className="btn btn-sm btn-outline-danger"
                  >
                    Quitar
                  </button>
                )}
              </div>
            </div>
          ))}

          <div style={{ marginTop: "8px" }}>
            <button onClick={guardar} className="btn btn-primary">
              Guardar Cambios
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
