import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { useNavigate } from "react-router-dom";
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

export default function CrearCampana() {
  const navigate = useNavigate();

  const [toast, setToast] = useState(null);
  const [loading, setLoading] = useState(true);

  const [nombre, setNombre] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const [productos, setProductos] = useState([]);
  const [items, setItems] = useState([
    { sku: "", producto: "", precio_unitario: 0, precio_campania: "" },
  ]);

  useEffect(() => {
    async function cargarProductos() {
      setLoading(true);
      const { data, error } = await supabase
        .from("productos")
        .select("sku,nombre,lista1")
        .order("id")
        .limit(20000);

      if (error) {
        console.error(error);
        setToast({ type: "error", message: "Error cargando productos" });
        setProductos([]);
      } else {
        setProductos(data || []);
      }
      setLoading(false);
    }
    cargarProductos();
  }, []);

  const opcionesSKU = useMemo(
    () => (productos || []).map((p) => ({ value: p.sku, label: p.sku })),
    [productos]
  );

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
    setItems([...items, { sku: "", producto: "", precio_unitario: 0, precio_campania: "" }]);
  }

  function eliminarItem(index) {
    if (items.length === 1) return;
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

    const { data: auth } = await supabase.auth.getUser();
    const user = auth?.user;

    const { data: insCamp, error: e1 } = await supabase
      .from("product_campaigns")
      .insert([{ nombre: nombre.trim(), start_date: startDate, end_date: endDate, created_by: user?.id || null }])
      .select("id")
      .single();

    if (e1) {
      console.error(e1);
      setToast({ type: "error", message: "Error creando campaña" });
      return;
    }

    const payloadItems = itemsParaGuardar.map((it) => ({
      campaign_id:     insCamp.id,
      sku:             String(it.sku),
      producto:        String(it.producto || ""),
      precio_unitario: Number(it.precio_unitario || 0),
      precio_campania: Number(it.precio_campania || 0),
    }));

    const { error: e2 } = await supabase.from("product_campaign_items").insert(payloadItems);
    if (e2) {
      console.error(e2);
      setToast({ type: "error", message: "Error guardando ítems de campaña" });
      return;
    }

    setToast({ type: "success", message: "Campaña creada correctamente." });
    navigate("/campanas");
  }

  if (loading) return <div className="page" style={{ color: "var(--text-muted)" }}>Cargando productos…</div>;

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
          <h1 className="page-title">Nueva Campaña</h1>
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
              Guardar Campaña
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
