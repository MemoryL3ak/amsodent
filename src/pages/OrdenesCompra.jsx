// OrdenesCompra.jsx
// Listado de órdenes de compra (solo admin). Permite crear una nueva,
// abrir/editar, exportar a PDF y eliminar.
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import useAuth from "../hooks/useAuth";
import { Plus, Search, FileDown, Trash2, FileText } from "lucide-react";
import { generarPDFOrdenCompra } from "../components/OrdenCompraDocument";

const fmtCLP = (v) => `$${Number(v || 0).toLocaleString("es-CL")}`;
function fmtFecha(v) {
  if (!v) return "";
  const s = String(v).slice(0, 10);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : s;
}

export default function OrdenesCompra() {
  const navigate = useNavigate();
  const { rol, cargando } = useAuth();
  const rolNorm = (rol || "").toString().trim().toLowerCase();
  const puedeVer = ["admin", "administrador"].includes(rolNorm);

  const [lista, setLista] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busqueda, setBusqueda] = useState("");
  const [toast, setToast] = useState(null);

  async function cargar() {
    setLoading(true);
    try {
      const data = await api.get("/ordenes-compra");
      setLista(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error(e);
      setToast({ type: "error", message: "No se pudo cargar el listado. ¿Está aplicada la migración?" });
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { if (!cargando && puedeVer) cargar(); else if (!cargando) setLoading(false); }, [cargando, puedeVer]);

  const filtradas = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    if (!q) return lista;
    return lista.filter((o) =>
      String(o.numero || "").includes(q) ||
      String(o.proveedor_razon_social || "").toLowerCase().includes(q) ||
      String(o.proveedor_rut || "").toLowerCase().includes(q)
    );
  }, [lista, busqueda]);

  async function eliminar(o) {
    try {
      await api.delete(`/ordenes-compra/${o.id}`);
      setLista((prev) => prev.filter((x) => x.id !== o.id));
    } catch (e) {
      console.error(e);
      setToast({ type: "error", message: "No se pudo eliminar." });
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

  return (
    <div className="page">
      <div className="page-header" style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div>
          <h1 className="page-title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <FileText size={20} /> Órdenes de Compra
          </h1>
          <p className="page-subtitle">Genera órdenes de compra a proveedores y expórtalas a PDF.</p>
        </div>
        <button className="btn btn-primary" onClick={() => navigate("/ordenes-compra/nueva")} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <Plus size={15} /> Nueva orden de compra
        </button>
      </div>

      <div className="filter-bar">
        <div className="filter-field" style={{ flex: 1, minWidth: 240 }}>
          <label className="filter-label">Buscar</label>
          <div style={{ position: "relative" }}>
            <Search size={15} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)" }} />
            <input className="input" style={{ paddingLeft: 32 }} placeholder="N°, proveedor o RUT…" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
          </div>
        </div>
      </div>

      <div className="surface" style={{ marginTop: 14, overflowX: "auto" }}>
        {loading ? (
          <div style={{ padding: "36px 24px", color: "var(--text-muted)" }}>Cargando…</div>
        ) : filtradas.length === 0 ? (
          <div style={{ padding: "36px 24px", color: "var(--text-muted)" }}>
            {lista.length === 0 ? "Aún no hay órdenes de compra. Crea la primera." : "Sin resultados."}
          </div>
        ) : (
          <table className="data-table" style={{ width: "100%" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", width: 90 }}>N°</th>
                <th style={{ textAlign: "left", width: 110 }}>Fecha</th>
                <th style={{ textAlign: "left" }}>Proveedor</th>
                <th style={{ textAlign: "right", width: 140 }}>Total</th>
                <th style={{ textAlign: "right", width: 120 }}></th>
              </tr>
            </thead>
            <tbody>
              {filtradas.map((o) => (
                <tr key={o.id} onClick={() => navigate(`/ordenes-compra/${o.id}`)} style={{ cursor: "pointer" }}>
                  <td style={{ fontWeight: 700 }}>#{String(o.numero || 0).padStart(4, "0")}</td>
                  <td style={{ color: "var(--text-muted)" }}>{fmtFecha(o.fecha_emision)}</td>
                  <td>{o.proveedor_razon_social || <span style={{ color: "var(--text-muted)" }}>—</span>}</td>
                  <td style={{ textAlign: "right", fontWeight: 600, whiteSpace: "nowrap" }}>{fmtCLP(o.total)}</td>
                  <td>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 4 }}>
                      <button className="btn btn-sm btn-ghost" title="Exportar PDF" style={{ padding: 6, lineHeight: 0 }}
                        onClick={(e) => { e.stopPropagation(); generarPDFOrdenCompra(o); }}>
                        <FileDown size={14} />
                      </button>
                      <button className="btn btn-sm btn-ghost" title="Eliminar" style={{ padding: 6, lineHeight: 0 }}
                        onClick={(e) => { e.stopPropagation(); eliminar(o); }}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

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
