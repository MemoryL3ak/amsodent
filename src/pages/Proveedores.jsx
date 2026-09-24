// Proveedores.jsx
// Catálogo de proveedores (solo admin): listar, crear, editar y eliminar.
import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import useAuth from "../hooks/useAuth";
import Toast from "../components/Toast";
import ConfirmModal from "../components/ConfirmModal";
import DropdownSelect from "../components/ui/DropdownSelect";
import { Plus, Search, Pencil, Trash2, Building2, X, Save, Star } from "lucide-react";
import CreatableSelect from "react-select/creatable";

const VACIO = { razon_social: "", rut: "", correo: "", telefono: "", contacto: "", direccion: "", rubro: "", observaciones: "", marcas: [], palabras_clave: [], condiciones_compra: [] };

/* Condiciones de compra acordadas con el proveedor (2026-09-16). */
const CONDICIONES_COMPRA = [
  { value: "credito", label: "Crédito" },
  { value: "contado", label: "Pago al contado" },
  { value: "tarjeta_credito", label: "Pago con tarjeta de crédito" },
];
const labelCondicion = (v) => CONDICIONES_COMPRA.find((c) => c.value === v)?.label || "";

/* Texto corto de una opción de compra: "Crédito · 30 días". */
const textoCondicion = (c) =>
  [labelCondicion(c?.condicion), c?.condicion === "credito" && c?.credito_dias ? `${c.credito_dias} días` : null]
    .filter(Boolean)
    .join(" · ");

/* Un proveedor guardado antes de la migración 20260924 solo tiene la condición
   única; se lee como una lista de un elemento para que la pantalla sea una sola. */
function condicionesDe(p) {
  if (Array.isArray(p?.condiciones_compra) && p.condiciones_compra.length) return p.condiciones_compra;
  if (p?.condicion_compra) {
    return [{ condicion: p.condicion_compra, credito_dias: p.credito_dias ?? "", nota: "", preferida: true }];
  }
  return [];
}

// react-select compacto acorde a los inputs del proyecto.
const SELECT_STYLES = {
  control: (base) => ({ ...base, minHeight: 36, borderColor: "var(--border)", fontSize: 13 }),
  menu: (base) => ({ ...base, zIndex: 12000, fontSize: 13 }),
  multiValue: (base) => ({ ...base, background: "var(--primary-light)" }),
};

/* Editor de las opciones de compra del proveedor. Hasta 2026-09-24 era una
   sola condición con su plazo; ahora son varias, porque en la práctica un
   proveedor ofrece crédito Y contado, y el comprador elige según el caso. */
function EditorCondiciones({ valor, onChange }) {
  const filas = Array.isArray(valor) ? valor : [];

  const cambiar = (i, parche) =>
    onChange(filas.map((f, k) => (k === i ? { ...f, ...parche } : f)));

  const agregar = () =>
    onChange([...filas, { condicion: "contado", credito_dias: "", nota: "", preferida: filas.length === 0 }]);

  const quitar = (i) => {
    const resto = filas.filter((_, k) => k !== i);
    // Si se borró la preferida, la primera que queda toma su lugar.
    if (resto.length && !resto.some((f) => f.preferida)) resto[0] = { ...resto[0], preferida: true };
    onChange(resto);
  };

  const marcarPreferida = (i) =>
    onChange(filas.map((f, k) => ({ ...f, preferida: k === i })));

  return (
    <div className="field">
      <label className="field-label">Opciones de compra</label>
      {filas.length === 0 && (
        <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 6 }}>
          Sin definir. Agrega una o más formas acordadas con el proveedor.
        </div>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {filas.map((f, i) => (
          <div
            key={i}
            style={{
              display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end",
              border: "1px solid var(--border)", borderRadius: 10, padding: "8px 10px",
              background: f.preferida ? "var(--primary-light)" : "transparent",
            }}
          >
            <div style={{ flex: "1 1 180px", minWidth: 150 }}>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 3 }}>Condición</div>
              <DropdownSelect
                value={f.condicion || ""}
                onChange={(v) => cambiar(i, { condicion: v, credito_dias: v === "credito" ? f.credito_dias : "" })}
                options={CONDICIONES_COMPRA}
              />
            </div>
            <div style={{ flex: "0 1 120px", minWidth: 100 }}>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 3 }}>Plazo (días)</div>
              <input
                className="input"
                type="number"
                min={0}
                value={f.credito_dias ?? ""}
                onChange={(e) => cambiar(i, { credito_dias: e.target.value })}
                placeholder="Ej: 30"
                disabled={f.condicion !== "credito"}
                title={f.condicion !== "credito" ? "Solo aplica cuando la condición es crédito" : ""}
              />
            </div>
            <div style={{ flex: "2 1 200px", minWidth: 160 }}>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 3 }}>Nota</div>
              <input
                className="input"
                value={f.nota || ""}
                maxLength={120}
                onChange={(e) => cambiar(i, { nota: e.target.value })}
                placeholder="Ej: 5% de descuento"
              />
            </div>
            <div style={{ display: "flex", gap: 6, alignItems: "center", paddingBottom: 2 }}>
              <button
                type="button"
                onClick={() => marcarPreferida(i)}
                title={f.preferida ? "Es la opción preferida" : "Marcar como preferida"}
                style={{
                  background: "none", border: "none", cursor: "pointer", padding: 4,
                  color: f.preferida ? "var(--primary)" : "var(--text-muted)",
                }}
              >
                <Star size={16} fill={f.preferida ? "currentColor" : "none"} />
              </button>
              <button
                type="button"
                onClick={() => quitar(i)}
                title="Quitar esta opción"
                style={{ background: "none", border: "none", cursor: "pointer", padding: 4, color: "#ef4444" }}
              >
                <Trash2 size={16} />
              </button>
            </div>
          </div>
        ))}
      </div>
      <button type="button" className="btn btn-secondary" onClick={agregar} style={{ marginTop: 8 }}>
        <Plus size={14} /> Agregar opción
      </button>
    </div>
  );
}

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
                <th style={{ textAlign: "left" }}>Condición</th>
                <th style={{ textAlign: "left" }}>Marcas</th>
                <th style={{ width: 90 }}></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={9} style={{ padding: "30px 12px", color: "var(--text-muted)" }}>Cargando…</td></tr>
              ) : filtrada.length === 0 ? (
                <tr><td colSpan={9} style={{ padding: "30px 12px", color: "var(--text-muted)", textAlign: "center" }}>Sin proveedores.</td></tr>
              ) : filtrada.map((p) => (
                <tr key={p.id}>
                  <td style={{ fontWeight: 600 }}>{p.razon_social}</td>
                  <td>{p.rut || "—"}</td>
                  <td>{p.contacto || "—"}</td>
                  <td>{p.correo || "—"}</td>
                  <td>{p.telefono || "—"}</td>
                  <td>{p.rubro || "—"}</td>
                  <td>
                    {(() => {
                      const cs = condicionesDe(p);
                      if (!cs.length) return "—";
                      return (
                        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                          {cs.map((c, i) => (
                            <span
                              key={`${c.condicion}-${c.credito_dias ?? ""}-${i}`}
                              title={c.nota || (c.preferida ? "Opción preferida" : "")}
                              style={{
                                fontSize: 11, fontWeight: 700, padding: "2px 9px", borderRadius: 999,
                                background: c.preferida ? "var(--primary-light)" : "var(--bg)",
                                color: c.preferida ? "var(--primary)" : "var(--text)",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {c.preferida ? "★ " : ""}{textoCondicion(c)}
                            </span>
                          ))}
                        </div>
                      );
                    })()}
                  </td>
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
                      <button className="btn btn-sm btn-ghost" title="Editar" onClick={() => setModal({ ...VACIO, ...p, marcas: Array.isArray(p.marcas) ? p.marcas : [], palabras_clave: Array.isArray(p.palabras_clave) ? p.palabras_clave : [], condiciones_compra: condicionesDe(p) })} style={{ padding: 6 }}><Pencil size={14} /></button>
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

              {/* Opciones de compra: un proveedor puede ofrecer varias (crédito
                  a 30 días O contado con descuento). La marcada con la estrella
                  es la preferida y es la que se usa por omisión. */}
              <EditorCondiciones
                valor={modal.condiciones_compra || []}
                onChange={(v) => set({ condiciones_compra: v })}
              />
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
