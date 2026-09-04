// Proveedores.jsx
// Catálogo de proveedores (solo admin): listar, crear, editar y eliminar.
import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import useAuth from "../hooks/useAuth";
import Toast from "../components/Toast";
import ConfirmModal from "../components/ConfirmModal";
import { Plus, Search, Pencil, Trash2, Building2, X, Save } from "lucide-react";
import CreatableSelect from "react-select/creatable";

const VACIO = { razon_social: "", rut: "", correo: "", telefono: "", contacto: "", direccion: "", rubro: "", observaciones: "", marcas: [], palabras_clave: [] };

// react-select compacto acorde a los inputs del proyecto.
const SELECT_STYLES = {
  control: (base) => ({ ...base, minHeight: 36, borderColor: "var(--border)", fontSize: 13 }),
  menu: (base) => ({ ...base, zIndex: 12000, fontSize: 13 }),
  multiValue: (base) => ({ ...base, background: "var(--primary-light)" }),
};

export default function Proveedores() {
  const { rol, cargando } = useAuth();
  const rolNorm = (rol || "").toString().trim().toLowerCase();
  const puedeVer = ["admin", "administrador"].includes(rolNorm);

  const [lista, setLista] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busqueda, setBusqueda] = useState("");
  const [modal, setModal] = useState(null); // { ...proveedor } | null (nuevo si sin id)
  const [guardando, setGuardando] = useState(false);
  const [confirmDel, setConfirmDel] = useState(null);
  const [toast, setToast] = useState(null);
  // Marcas existentes del catálogo de productos, para el selector (se pueden
  // crear marcas nuevas escribiéndolas: CreatableSelect).
  const [marcasCatalogo, setMarcasCatalogo] = useState([]);

  useEffect(() => {
    if (cargando || !puedeVer) return;
    api.get("/productos/list")
      .then((rows) => {
        const s = new Set();
        (Array.isArray(rows) ? rows : []).forEach((p) => {
          const m = String(p?.marca || "").trim();
          if (m) s.add(m);
        });
        setMarcasCatalogo([...s].sort((a, b) => a.localeCompare(b)));
      })
      .catch(() => {});
  }, [cargando, puedeVer]);

  async function cargar() {
    setLoading(true);
    try {
      const data = await api.get("/proveedores");
      setLista(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error(e);
      setToast({ type: "error", message: "No se pudieron cargar los proveedores." });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (cargando) return;
    if (!puedeVer) { setLoading(false); return; }
    cargar();
  }, [cargando, puedeVer]);

  const filtrada = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    if (!q) return lista;
    return lista.filter((p) =>
      [p.razon_social, p.rut, p.correo, p.contacto, p.rubro,
        ...(Array.isArray(p.marcas) ? p.marcas : []),
        ...(Array.isArray(p.palabras_clave) ? p.palabras_clave : [])]
        .some((v) => String(v || "").toLowerCase().includes(q)),
    );
  }, [lista, busqueda]);

  async function guardar() {
    const m = modal;
    if (!m?.razon_social?.trim()) { setToast({ type: "error", message: "La razón social es obligatoria." }); return; }
    setGuardando(true);
    try {
      if (m.id) await api.put(`/proveedores/${m.id}`, m);
      else await api.post("/proveedores", m);
      setToast({ type: "success", message: m.id ? "Proveedor actualizado." : "Proveedor creado." });
      setModal(null);
      cargar();
    } catch (e) {
      setToast({ type: "error", message: e?.message || "No se pudo guardar." });
    } finally {
      setGuardando(false);
    }
  }

  async function eliminar(p) {
    try {
      await api.delete(`/proveedores/${p.id}`);
      setToast({ type: "success", message: "Proveedor eliminado." });
      setConfirmDel(null);
      cargar();
    } catch (e) {
      setToast({ type: "error", message: e?.message || "No se pudo eliminar." });
    }
  }

  if (!cargando && !puedeVer) {
    return (
      <div className="page">
        <div className="surface"><div className="surface-body" style={{ color: "var(--danger)" }}>
          Acceso restringido: el catálogo de proveedores es solo para administración.
        </div></div>
      </div>
    );
  }

  const set = (patch) => setModal((m) => ({ ...m, ...patch }));

  return (
    <div className="page">
      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}
      <ConfirmModal
        open={confirmDel !== null}
        title="¿Eliminar este proveedor?"
        message={`Se eliminará "${confirmDel?.razon_social || ""}" de forma permanente.`}
        confirmText="Eliminar"
        cancelText="Cancelar"
        confirmTone="danger"
        onConfirm={() => eliminar(confirmDel)}
        onCancel={() => setConfirmDel(null)}
      />

      <div className="page-header" style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div>
          <h1 className="page-title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Building2 size={20} /> Proveedores
          </h1>
          <p className="page-subtitle">Catálogo de proveedores para órdenes de compra y gestión.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setModal({ ...VACIO })} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <Plus size={15} /> Nuevo proveedor
        </button>
      </div>

      <div className="surface" style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ padding: 12, borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 8 }}>
          <Search size={15} color="var(--text-muted)" />
          <input
            className="input"
            style={{ border: "none", boxShadow: "none", padding: 0 }}
            placeholder="Buscar por razón social, RUT, correo, contacto o rubro…"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
          />
          <span style={{ fontSize: 12, color: "var(--text-muted)", whiteSpace: "nowrap" }}>{filtrada.length} proveedor(es)</span>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="data-table" style={{ width: "100%", minWidth: 720 }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left" }}>Razón Social</th>
                <th style={{ textAlign: "left" }}>RUT</th>
                <th style={{ textAlign: "left" }}>Contacto</th>
                <th style={{ textAlign: "left" }}>Correo</th>
                <th style={{ textAlign: "left" }}>Teléfono</th>
                <th style={{ textAlign: "left" }}>Rubro</th>
                <th style={{ textAlign: "left" }}>Marcas</th>
                <th style={{ width: 90 }}></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} style={{ padding: "30px 12px", color: "var(--text-muted)" }}>Cargando…</td></tr>
              ) : filtrada.length === 0 ? (
                <tr><td colSpan={8} style={{ padding: "30px 12px", color: "var(--text-muted)", textAlign: "center" }}>Sin proveedores.</td></tr>
              ) : filtrada.map((p) => (
                <tr key={p.id}>
                  <td style={{ fontWeight: 600 }}>{p.razon_social}</td>
                  <td>{p.rut || "—"}</td>
                  <td>{p.contacto || "—"}</td>
                  <td>{p.correo || "—"}</td>
                  <td>{p.telefono || "—"}</td>
                  <td>{p.rubro || "—"}</td>
                  <td style={{ maxWidth: 200 }}>
                    {Array.isArray(p.marcas) && p.marcas.length ? (
                      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                        {p.marcas.slice(0, 3).map((m) => (
                          <span key={m} style={{ fontSize: 10.5, fontWeight: 600, padding: "1px 7px", borderRadius: 999, background: "var(--primary-light)", color: "var(--primary-dark)" }}>{m}</span>
                        ))}
                        {p.marcas.length > 3 && (
                          <span style={{ fontSize: 10.5, color: "var(--text-muted)" }} title={p.marcas.join(", ")}>+{p.marcas.length - 3}</span>
                        )}
                      </div>
                    ) : "—"}
                  </td>
                  <td>
                    <div style={{ display: "flex", gap: 4, justifyContent: "flex-end" }}>
                      <button className="btn btn-sm btn-ghost" title="Editar" onClick={() => setModal({ ...VACIO, ...p, marcas: Array.isArray(p.marcas) ? p.marcas : [], palabras_clave: Array.isArray(p.palabras_clave) ? p.palabras_clave : [] })} style={{ padding: 6 }}><Pencil size={14} /></button>
                      <button className="btn btn-sm btn-ghost" title="Eliminar" onClick={() => setConfirmDel(p)} style={{ padding: 6, color: "var(--danger)" }}><Trash2 size={14} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {modal && (
        <div onClick={(e) => { if (e.target === e.currentTarget) setModal(null); }}
          style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.55)", display: "grid", placeItems: "center", zIndex: 11000, padding: 16 }}>
          <div style={{ background: "var(--surface)", borderRadius: "var(--radius-lg)", border: "1px solid var(--border)", width: "min(560px, 100%)", maxHeight: "88vh", overflow: "auto", boxShadow: "var(--shadow-lg)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 18px", borderBottom: "1px solid var(--border)" }}>
              <h3 className="surface-title" style={{ margin: 0 }}>{modal.id ? "Editar proveedor" : "Nuevo proveedor"}</h3>
              <button className="btn btn-ghost" style={{ padding: 6 }} onClick={() => setModal(null)}><X size={18} /></button>
            </div>
            <div style={{ padding: 18, display: "flex", flexDirection: "column", gap: 12 }}>
              <div className="field">
                <label className="field-label">Razón Social <span style={{ color: "var(--danger)" }}>*</span></label>
                <input className="input" value={modal.razon_social} onChange={(e) => set({ razon_social: e.target.value })} placeholder="Nombre / razón social del proveedor" autoFocus />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div className="field"><label className="field-label">RUT</label><input className="input" value={modal.rut} onChange={(e) => set({ rut: e.target.value })} placeholder="Ej: 76.123.456-7" /></div>
                <div className="field"><label className="field-label">Rubro</label><input className="input" value={modal.rubro} onChange={(e) => set({ rubro: e.target.value })} placeholder="Ej: Insumos dentales" /></div>
                <div className="field"><label className="field-label">Contacto</label><input className="input" value={modal.contacto} onChange={(e) => set({ contacto: e.target.value })} placeholder="Nombre de contacto" /></div>
                <div className="field"><label className="field-label">Teléfono</label><input className="input" value={modal.telefono} onChange={(e) => set({ telefono: e.target.value })} placeholder="+56 9 …" /></div>
                <div className="field"><label className="field-label">Correo</label><input className="input" value={modal.correo} onChange={(e) => set({ correo: e.target.value })} placeholder="correo@proveedor.cl" /></div>
                <div className="field"><label className="field-label">Dirección</label><input className="input" value={modal.direccion} onChange={(e) => set({ direccion: e.target.value })} placeholder="Dirección" /></div>
              </div>
              <div className="field">
                <label className="field-label">Marcas que distribuye</label>
                <CreatableSelect
                  isMulti
                  styles={SELECT_STYLES}
                  options={marcasCatalogo.map((m) => ({ value: m, label: m }))}
                  value={(modal.marcas || []).map((m) => ({ value: m, label: m }))}
                  onChange={(vals) => set({ marcas: (vals || []).map((v) => String(v.value).trim()).filter(Boolean) })}
                  placeholder="Selecciona marcas o escribe una nueva…"
                  formatCreateLabel={(txt) => `Crear marca «${txt}»`}
                  noOptionsMessage={() => "Escribe para crear una marca"}
                />
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 3 }}>
                  Las opciones salen de las marcas del catálogo de productos; también puedes crear una nueva escribiéndola.
                </div>
              </div>
              <div className="field">
                <label className="field-label">Palabras clave</label>
                <CreatableSelect
                  isMulti
                  styles={SELECT_STYLES}
                  options={[]}
                  value={(modal.palabras_clave || []).map((m) => ({ value: m, label: m }))}
                  onChange={(vals) => set({ palabras_clave: (vals || []).map((v) => String(v.value).trim()).filter(Boolean) })}
                  placeholder="Escribe una palabra y presiona Enter…"
                  formatCreateLabel={(txt) => `Agregar «${txt}»`}
                  noOptionsMessage={() => "Escribe para agregar palabras clave"}
                />
              </div>
              <div className="field">
                <label className="field-label">Observaciones</label>
                <textarea className="input" rows={2} value={modal.observaciones} onChange={(e) => set({ observaciones: e.target.value })} placeholder="Notas del proveedor (opcional)" />
              </div>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, padding: "12px 18px", borderTop: "1px solid var(--border)" }}>
              <button className="btn btn-secondary" onClick={() => setModal(null)} disabled={guardando}>Cancelar</button>
              <button className="btn btn-primary" onClick={guardar} disabled={guardando || !modal.razon_social?.trim()} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <Save size={15} /> {guardando ? "Guardando…" : "Guardar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
