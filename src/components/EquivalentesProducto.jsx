// EquivalentesProducto.jsx
// Selector de "Producto Equivalente 1/2/3" para Crear/Editar Producto.
// Cada equivalente se guarda por SKU. Las opciones se renderizan con chip de
// SKU + nombre + precio (lista 1) alineado, y el panel sigue el estilo de las
// tarjetas del resto de la app. Carga el listado liviano por su cuenta.
import { useEffect, useMemo, useState } from "react";
import Select from "react-select";
import { Repeat } from "lucide-react";
import { api } from "../lib/api";

const fmtCLP = (v) => `$${Number(v || 0).toLocaleString("es-CL")}`;

const selectStyles = {
  menuPortal: (base) => ({ ...base, zIndex: 13000 }),
  control: (base, state) => ({
    ...base,
    minHeight: 40,
    fontSize: 13,
    fontFamily: "inherit",
    backgroundColor: "#fff",
    borderColor: state.isFocused ? "#6366f1" : "#d1d5db",
    boxShadow: state.isFocused ? "0 0 0 1px #6366f1" : "none",
    "&:hover": { borderColor: "#6366f1" },
  }),
  option: (base, state) => ({
    ...base,
    fontSize: 13,
    padding: "8px 10px",
    backgroundColor: state.isSelected ? "#eef2ff" : state.isFocused ? "#f8fafc" : "#fff",
    color: "#111827",
  }),
  placeholder: (base) => ({ ...base, fontSize: 13, color: "#9ca3af" }),
  menu: (base) => ({ ...base, fontSize: 13 }),
};

// Render de cada opción/valor: chip de SKU + nombre (con ellipsis) + precio.
function OpcionEquivalente({ sku, nombre, precio }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, width: "100%" }}>
      <span style={{
        fontSize: 11, fontWeight: 700, padding: "1px 8px", borderRadius: 999, flexShrink: 0,
        background: "#eef2ff", color: "#4338ca", border: "1px solid #e0e7ff",
      }}>{sku}</span>
      <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={nombre}>
        {nombre}
      </span>
      <span style={{ fontWeight: 700, flexShrink: 0, color: "#15803d", fontSize: 12.5 }}>{fmtCLP(precio)}</span>
    </div>
  );
}

export default function EquivalentesProducto({ value = ["", "", ""], onChange, excludeSku }) {
  const [productos, setProductos] = useState([]);

  useEffect(() => {
    let activo = true;
    api.get("/productos/list")
      .then((d) => { if (activo) setProductos(Array.isArray(d) ? d : []); })
      .catch((e) => { console.error("Error cargando catálogo para equivalencias:", e); if (activo) setProductos([]); });
    return () => { activo = false; };
  }, []);

  const propio = String(excludeSku || "").trim();
  const elegidos = (value || []).map((s) => String(s || "").trim());
  const opciones = useMemo(
    () =>
      productos
        .filter((p) => String(p.sku || "").trim() && String(p.sku).trim() !== propio)
        .map((p) => ({
          value: String(p.sku).trim(),
          sku: String(p.sku).trim(),
          nombre: p.nombre || "—",
          precio: Number(p.lista1 || 0),
          // label como texto plano: es lo que usa el buscador del select.
          label: `${String(p.sku).trim()} ${p.nombre || ""}`,
        })),
    [productos, propio]
  );

  const setEq = (i, sku) => {
    const next = [...(value || ["", "", ""])];
    next[i] = sku || "";
    onChange?.(next);
  };

  const nSeleccionados = elegidos.filter(Boolean).length;

  return (
    <div style={{ border: "1px solid var(--border)", background: "var(--bg)", borderRadius: 12, padding: "16px 18px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap", marginBottom: 4 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 28, height: 28, borderRadius: 8, background: "#eef2ff", color: "#4338ca", display: "grid", placeItems: "center", flexShrink: 0 }}>
            <Repeat size={15} />
          </span>
          <span className="text-sm font-semibold text-gray-800">Productos Equivalentes</span>
        </div>
        <span style={{
          fontSize: 11, fontWeight: 700, padding: "2px 10px", borderRadius: 999,
          background: nSeleccionados > 0 ? "#dcfce7" : "#f3f4f6",
          color: nSeleccionados > 0 ? "#15803d" : "#6b7280",
        }}>
          {nSeleccionados} de 3
        </span>
      </div>
      <p className="text-xs text-gray-500 mb-3">
        Hasta 3 productos alternativos del catálogo. Al guardar una cotización de entidad pública que incluya
        este producto, el sistema ofrecerá crear una cotización alternativa con estas equivalencias.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[0, 1, 2].map((i) => (
          <div key={i}>
            <label className="block text-sm font-medium text-gray-700 mb-1" style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{
                width: 18, height: 18, borderRadius: "50%", fontSize: 11, fontWeight: 700,
                background: elegidos[i] ? "#4338ca" : "#e5e7eb", color: elegidos[i] ? "#fff" : "#6b7280",
                display: "grid", placeItems: "center", flexShrink: 0,
              }}>{i + 1}</span>
              Equivalente {i + 1}
            </label>
            <Select
              options={opciones.filter((o) => o.value === elegidos[i] || !elegidos.includes(o.value))}
              styles={selectStyles}
              placeholder="Buscar por SKU o nombre…"
              noOptionsMessage={() => "Sin productos para la búsqueda"}
              menuPortalTarget={document.body}
              isSearchable
              isClearable
              formatOptionLabel={(op) => <OpcionEquivalente sku={op.sku} nombre={op.nombre} precio={op.precio} />}
              value={opciones.find((o) => o.value === elegidos[i]) || null}
              onChange={(op) => setEq(i, op ? op.value : "")}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
