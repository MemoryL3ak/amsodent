import { useCallback, useEffect, useMemo, useState } from "react";
import Select from "react-select";
import { api } from "../lib/api";
import useAuth from "../hooks/useAuth";
import Toast from "../components/Toast";
import ConfirmModal from "../components/ConfirmModal";
import { AlertTriangle, Pause, Pencil, Play, Plus, Trash2, X } from "lucide-react";

/* ── Ofertas especiales del portal del cliente (2026-10-02) ────────────────
   Acá se configuran las ofertas que el cliente ve en la pestaña «Ofertas» de
   su portal. Una oferta es una regla: a estos productos, estas categorías o
   estas marcas, un X % de descuento sobre el precio del cliente (lista 2),
   entre dos fechas. El precio de oferta no se guarda: lo calcula el backend
   al mostrar la vitrina y al recibir el pedido. */

const ALCANCES = [
  { value: "producto", label: "Producto", plural: "productos" },
  { value: "categoria", label: "Categoría", plural: "categorías" },
  { value: "marca", label: "Marca", plural: "marcas" },
];

const ESTADOS = {
  vigente: { texto: "Vigente", color: "#15803d", bg: "#dcfce7", borde: "#bbf7d0" },
  programada: { texto: "Programada", color: "#1d4ed8", bg: "#dbeafe", borde: "#bfdbfe" },
  terminada: { texto: "Terminada", color: "#64748b", bg: "#f1f5f9", borde: "#e2e8f0" },
  pausada: { texto: "Pausada", color: "#92400e", bg: "#fef3c7", borde: "#fde68a" },
};

const norm = (v) =>
  String(v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
const pesos = (n) => `$${Math.round(Number(n || 0)).toLocaleString("es-CL")}`;
const fechaCorta = (d) => {
  const m = String(d || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : "—";
};
const hoyLocal = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const estilosSelect = {
  control: (b, st) => ({
    ...b,
    minHeight: 36,
    borderColor: st.isFocused ? "var(--primary)" : "var(--border-strong, #cbd5e1)",
    boxShadow: "none",
    fontSize: 13,
    borderRadius: 8,
  }),
  menuPortal: (b) => ({ ...b, zIndex: 12000 }),
  option: (b) => ({ ...b, fontSize: 13 }),
  multiValue: (b) => ({ ...b, borderRadius: 6 }),
};

export default function OfertasPortal() {
  const { rol } = useAuth();
  const rolNorm = String(rol || "").trim().toLowerCase();
  const esAdmin = rolNorm === "admin" || rolNorm === "administrador";

  const [ofertas, setOfertas] = useState(null);
  const [productos, setProductos] = useState([]);
  const [toast, setToast] = useState(null);
  const [form, setForm] = useState(null);
  const [aEliminar, setAEliminar] = useState(null);

  // `recarga` se incrementa para volver a pedir la lista tras guardar.
  const [recarga, setRecarga] = useState(0);
  const cargar = useCallback(() => setRecarga((n) => n + 1), []);

  useEffect(() => {
    let vivo = true;
    api.get("/ofertas-portal")
      .then((r) => { if (vivo) setOfertas(Array.isArray(r) ? r : []); })
      .catch((e) => {
        console.error(e);
        if (!vivo) return;
        setOfertas([]);
        setToast({ type: "error", message: e?.message || "No se pudieron cargar las ofertas." });
      });
    return () => { vivo = false; };
  }, [recarga]);

  useEffect(() => {
    let vivo = true;
    // El catálogo alimenta los selectores de producto, categoría y marca.
    api.get("/productos/list")
      .then((r) => {
        if (!vivo) return;
        setProductos((Array.isArray(r) ? r : []).filter((p) => (p?.estado || "") !== "Inactivo" && String(p?.sku || "").trim()));
      })
      .catch(() => { if (vivo) setProductos([]); });
    return () => { vivo = false; };
  }, []);

  const lista = useMemo(() => ofertas || [], [ofertas]);
  const vigentes = lista.filter((o) => o.estado === "vigente");
  const programadas = lista.filter((o) => o.estado === "programada");

  function nueva() {
    setForm({ id: null, nombre: "", descripcion: "", alcance: "producto", valores: [], descuento_pct: "", desde: hoyLocal(), hasta: "", activa: true });
  }
  function editar(o) {
    setForm({
      id: o.id,
      nombre: o.nombre || "",
      descripcion: o.descripcion || "",
      alcance: o.alcance || "producto",
      valores: Array.isArray(o.valores) ? o.valores : [],
      descuento_pct: String(o.descuento_pct ?? ""),
      desde: String(o.desde || "").slice(0, 10),
      hasta: String(o.hasta || "").slice(0, 10),
      activa: o.activa !== false,
    });
  }

  async function alternar(o) {
    try {
      await api.put(`/ofertas-portal/${o.id}/activa`, { activa: o.activa === false });
      cargar();
      setToast({ type: "success", message: o.activa === false ? "Oferta reanudada." : "Oferta pausada: deja de verse en el portal." });
    } catch (e) {
      setToast({ type: "error", message: e?.message || "No se pudo cambiar la oferta." });
    }
  }

  async function eliminar() {
    const o = aEliminar;
    setAEliminar(null);
    if (!o) return;
    try {
      await api.delete(`/ofertas-portal/${o.id}`);
      cargar();
      setToast({ type: "success", message: "Oferta eliminada." });
    } catch (e) {
      setToast({ type: "error", message: e?.message || "No se pudo eliminar la oferta." });
    }
  }

  const columnas = esAdmin ? 7 : 6;

  return (
    <div className="page">
      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}

      <ConfirmModal
        open={aEliminar !== null}
        title="¿Eliminar esta oferta?"
        message={`«${aEliminar?.nombre || ""}» dejará de verse en el portal. Los pedidos que ya la usaron no cambian.`}
        confirmText="Eliminar"
        confirmTone="danger"
        onConfirm={eliminar}
        onCancel={() => setAEliminar(null)}
      />

      <div className="page-header">
        <div>
          <h1 className="page-title">Ofertas del portal</h1>
          <p className="page-subtitle">
            Las ofertas especiales que el cliente ve en su portal: un descuento por producto, categoría o marca, por un período.
          </p>
        </div>
        {esAdmin && (
          <div className="page-actions">
            <button type="button" className="btn btn-primary" onClick={nueva}>
              <Plus size={15} /> Nueva oferta
            </button>
          </div>
        )}
      </div>

      <div className="stats-row stats-3">
        <div className="stat-card">
          <div className="stat-label">Vigentes hoy</div>
          <div className="stat-value">{ofertas === null ? "…" : vigentes.length}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Programadas</div>
          <div className="stat-value">{ofertas === null ? "…" : programadas.length}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Productos alcanzados por ofertas vigentes</div>
          <div className="stat-value">{ofertas === null ? "…" : vigentes.reduce((a, o) => a + Number(o.productos || 0), 0).toLocaleString("es-CL")}</div>
        </div>
      </div>

      <div className="table-wrap">
        <table className="data-table" style={{ minWidth: 820 }}>
          <thead>
            <tr>
              <th>Oferta</th>
              <th>Aplica a</th>
              <th>Descuento</th>
              <th>Vigencia</th>
              <th>Estado</th>
              <th style={esAdmin ? undefined : { textAlign: "left" }}>Productos</th>
              {esAdmin && <th style={{ textAlign: "right" }}>Acciones</th>}
            </tr>
          </thead>
          <tbody>
            {ofertas === null && (
              <tr><td colSpan={columnas} style={{ textAlign: "center", padding: "50px 0", color: "var(--text-muted)" }}>Cargando…</td></tr>
            )}
            {ofertas !== null && lista.length === 0 && (
              <tr>
                <td colSpan={columnas} style={{ textAlign: "center", padding: "50px 16px", color: "var(--text-muted)" }}>
                  Todavía no hay ofertas.{esAdmin ? " Crea la primera con «Nueva oferta»." : ""}
                </td>
              </tr>
            )}
            {lista.map((o) => {
              const est = ESTADOS[o.estado] || ESTADOS.terminada;
              const valores = Array.isArray(o.valores) ? o.valores : [];
              const alcance = ALCANCES.find((a) => a.value === o.alcance);
              return (
                <tr key={o.id}>
                  <td style={{ maxWidth: 260 }}>
                    <div style={{ fontWeight: 600 }}>{o.nombre}</div>
                    {o.descripcion && <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{o.descripcion}</div>}
                  </td>
                  <td style={{ maxWidth: 280, fontSize: 12.5 }} title={valores.join(", ")}>
                    <span style={{ color: "var(--text-muted)" }}>{alcance?.label || o.alcance}:</span>{" "}
                    {valores.slice(0, 3).join(", ")}{valores.length > 3 ? ` +${valores.length - 3}` : ""}
                  </td>
                  <td style={{ whiteSpace: "nowrap", fontWeight: 700 }}>−{Number(o.descuento_pct).toLocaleString("es-CL")} %</td>
                  <td style={{ whiteSpace: "nowrap" }}>{fechaCorta(o.desde)} → {fechaCorta(o.hasta)}</td>
                  <td>
                    <span style={{ fontSize: 11, fontWeight: 700, color: est.color, background: est.bg, border: `1px solid ${est.borde}`, borderRadius: 999, padding: "2px 9px", whiteSpace: "nowrap" }}>
                      {est.texto}
                    </span>
                  </td>
                  <td style={esAdmin ? undefined : { textAlign: "left" }}>
                    {Number(o.productos || 0).toLocaleString("es-CL")}
                    {Number(o.productos || 0) === 0 && (
                      <span title="Ningún producto del catálogo calza con esta oferta: no se verá en el portal." style={{ color: "#b45309", marginLeft: 4 }}>
                        <AlertTriangle size={12} style={{ verticalAlign: -1 }} />
                      </span>
                    )}
                  </td>
                  {esAdmin && (
                    <td style={{ textAlign: "right" }}>
                      <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", flexWrap: "wrap" }}>
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => editar(o)} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                          <Pencil size={12} /> Editar
                        </button>
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => alternar(o)} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                          {o.activa === false ? <><Play size={12} /> Reanudar</> : <><Pause size={12} /> Pausar</>}
                        </button>
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAEliminar(o)} style={{ color: "#dc2626", display: "inline-flex", alignItems: "center" }} title="Eliminar">
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 10, lineHeight: 1.5 }}>
        El descuento se aplica sobre el precio del cliente del portal (lista 2). Si dos ofertas alcanzan al mismo producto, el cliente
        ve la de mayor descuento. El precio de oferta viaja con el pedido y es el que queda en la cotización que nace de él.
      </p>

      {form && (
        <ModalOferta
          inicial={form}
          productos={productos}
          onCerrar={() => setForm(null)}
          onGuardada={(mensaje) => {
            setForm(null);
            cargar();
            setToast({ type: "success", message: mensaje });
          }}
        />
      )}
    </div>
  );
}

function ModalOferta({ inicial, productos, onCerrar, onGuardada }) {
  const [f, setF] = useState(inicial);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const [busca, setBusca] = useState("");
  const [sim, setSim] = useState(null);
  const set = (k) => (v) => setF((prev) => ({ ...prev, [k]: v }));

  // Categorías y marcas del catálogo, con cuántos productos tiene cada una. Se
  // agrupan sin tildes ni mayúsculas y se muestra la escritura más usada.
  const opcionesGrupo = useMemo(() => {
    const armar = (campo) => {
      const grupos = new Map();
      for (const p of productos) {
        const crudo = String(p[campo] || "").trim();
        if (!crudo || crudo === "-") continue;
        const k = norm(crudo);
        if (!grupos.has(k)) grupos.set(k, { n: 0, formas: new Map() });
        const g = grupos.get(k);
        g.n += 1;
        g.formas.set(crudo, (g.formas.get(crudo) || 0) + 1);
      }
      return [...grupos.values()]
        .map((g) => {
          const forma = [...g.formas.entries()].sort((a, b) => b[1] - a[1])[0][0];
          return { value: forma, label: `${forma} (${g.n})` };
        })
        .sort((a, b) => a.value.localeCompare(b.value, "es"));
    };
    return { categoria: armar("categoria"), marca: armar("marca") };
  }, [productos]);

  const porSku = useMemo(() => new Map(productos.map((p) => [norm(p.sku), p])), [productos]);
  const etiquetaProducto = (sku) => {
    const p = porSku.get(norm(sku));
    return p ? `${p.sku} — ${p.nombre}` : String(sku);
  };

  // Productos: son miles, así que la lista se arma con lo que se va escribiendo.
  const opcionesProducto = useMemo(() => {
    const terminos = norm(busca).split(/\s+/).filter(Boolean);
    if (terminos.join("").length < 2) return [];
    const elegidos = new Set(f.valores.map(norm));
    const out = [];
    for (const p of productos) {
      if (elegidos.has(norm(p.sku))) continue;
      const texto = norm(`${p.sku} ${p.nombre} ${p.marca || ""}`);
      if (!terminos.every((t) => texto.includes(t))) continue;
      out.push({ value: p.sku, label: `${p.sku} — ${p.nombre}` });
      if (out.length >= 60) break;
    }
    return out;
  }, [busca, productos, f.valores]);

  const alcance = ALCANCES.find((a) => a.value === f.alcance) || ALCANCES[0];
  const pct = f.descuento_pct === "" ? NaN : Number(String(f.descuento_pct).replace(",", "."));
  const pctValido = Number.isFinite(pct) && pct > 0 && pct < 100;

  // Simulación en el backend (la misma regla que usa la vitrina), con una
  // pausa para no pedirla en cada tecla.
  useEffect(() => {
    if (!pctValido || f.valores.length === 0) return undefined;
    let vivo = true;
    const t = setTimeout(() => {
      api.post("/ofertas-portal/simular", { alcance: f.alcance, valores: f.valores, descuento_pct: pct })
        .then((r) => { if (vivo) setSim(r); })
        .catch(() => { if (vivo) setSim(null); });
    }, 350);
    return () => { vivo = false; clearTimeout(t); };
  }, [f.alcance, f.valores, pct, pctValido]);
  const simVisible = pctValido && f.valores.length > 0 ? sim : null;

  async function guardar(e) {
    e.preventDefault();
    if (guardando) return;
    if (!f.nombre.trim()) { setError("Ponle un nombre a la oferta."); return; }
    if (f.valores.length === 0) { setError(`Elige al menos un${f.alcance === "producto" ? " producto" : f.alcance === "categoria" ? "a categoría" : "a marca"}.`); return; }
    if (!pctValido) { setError("Indica el descuento, mayor que 0 y menor que 100 %."); return; }
    if (!f.desde || !f.hasta) { setError("Indica las fechas de inicio y término."); return; }
    if (f.hasta < f.desde) { setError("La fecha de término no puede ser anterior al inicio."); return; }
    setError("");
    setGuardando(true);
    const payload = {
      nombre: f.nombre.trim(),
      descripcion: f.descripcion.trim(),
      alcance: f.alcance,
      valores: f.valores,
      descuento_pct: pct,
      desde: f.desde,
      hasta: f.hasta,
      activa: f.activa !== false,
    };
    try {
      if (f.id) await api.put(`/ofertas-portal/${f.id}`, payload);
      else await api.post("/ofertas-portal", payload);
      onGuardada(f.id ? "Oferta actualizada." : "Oferta creada: ya se ve en el portal si está dentro de su vigencia.");
    } catch (err) {
      setError(err?.message || "No se pudo guardar la oferta.");
      setGuardando(false);
    }
  }

  const aviso = (texto) => (
    <div style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 12.5, color: "#92400e", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8, padding: "8px 10px", lineHeight: 1.45 }}>
      <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 2 }} />
      <span>{texto}</span>
    </div>
  );

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onCerrar(); }}
      style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.55)", zIndex: 11000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
    >
      <form onSubmit={guardar} style={{ width: 680, maxWidth: "100%", maxHeight: "90vh", overflow: "auto", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-lg)" }}>
        <div style={{ padding: "12px 18px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center", position: "sticky", top: 0, background: "var(--surface)", zIndex: 2 }}>
          <strong style={{ fontSize: 15 }}>{f.id ? "Editar oferta" : "Nueva oferta especial"}</strong>
          <button type="button" onClick={onCerrar} className="btn btn-ghost" style={{ padding: 6 }}><X size={18} /></button>
        </div>

        <div style={{ padding: "14px 18px", display: "flex", flexDirection: "column", gap: 12 }}>
          <div className="field">
            <label className="field-label">Nombre <span style={{ color: "var(--danger)" }}>*</span></label>
            <input className="input" value={f.nombre} onChange={(e) => set("nombre")(e.target.value)} placeholder="Ej: Semana Curaprox" maxLength={120} />
            <div className="field-hint">Es el nombre que ve el cliente en su portal.</div>
          </div>
          <div className="field">
            <label className="field-label">Descripción <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>(opcional, la ve el cliente)</span></label>
            <input className="input" value={f.descripcion} onChange={(e) => set("descripcion")(e.target.value)} maxLength={300} placeholder="Ej: Toda la línea de cepillos e interdentales" />
          </div>

          <div className="field">
            <label className="field-label">La oferta es por</label>
            <div className="segmentado" style={{ height: 36 }}>
              {ALCANCES.map((a) => (
                <button
                  key={a.value}
                  type="button"
                  className={f.alcance === a.value ? "activo" : undefined}
                  // Cambiar el tipo vacía la selección: un SKU no es una marca.
                  onClick={() => { if (f.alcance !== a.value) { setF((prev) => ({ ...prev, alcance: a.value, valores: [] })); setBusca(""); } }}
                >
                  {a.label}
                </button>
              ))}
            </div>
          </div>

          <div className="field">
            <label className="field-label">
              {alcance.label === "Producto" ? "Productos" : alcance.label === "Categoría" ? "Categorías" : "Marcas"} en oferta <span style={{ color: "var(--danger)" }}>*</span>
            </label>
            {f.alcance === "producto" ? (
              <Select
                isMulti
                classNamePrefix="rs"
                value={f.valores.map((v) => ({ value: v, label: etiquetaProducto(v) }))}
                onChange={(arr) => set("valores")((arr || []).map((o) => o.value))}
                options={opcionesProducto}
                inputValue={busca}
                onInputChange={(v, meta) => { if (meta.action === "input-change") setBusca(v); if (meta.action === "menu-close") setBusca(""); }}
                filterOption={() => true}
                closeMenuOnSelect={false}
                placeholder="Escribe el nombre o el SKU…"
                noOptionsMessage={() => (norm(busca).length < 2 ? "Escribe al menos 2 letras del nombre o el SKU" : "Sin coincidencias")}
                menuPortalTarget={typeof document !== "undefined" ? document.body : undefined}
                menuPosition="fixed"
                styles={estilosSelect}
              />
            ) : (
              <Select
                isMulti
                classNamePrefix="rs"
                value={f.valores.map((v) => opcionesGrupo[f.alcance].find((o) => norm(o.value) === norm(v)) || { value: v, label: v })}
                onChange={(arr) => set("valores")((arr || []).map((o) => o.value))}
                options={opcionesGrupo[f.alcance]}
                placeholder={f.alcance === "categoria" ? "Busca y agrega categorías…" : "Busca y agrega marcas…"}
                noOptionsMessage={() => "Sin coincidencias"}
                menuPortalTarget={typeof document !== "undefined" ? document.body : undefined}
                menuPosition="fixed"
                styles={estilosSelect}
              />
            )}
          </div>

          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <div className="field" style={{ flex: "1 1 120px", minWidth: 0 }}>
              <label className="field-label">Descuento % <span style={{ color: "var(--danger)" }}>*</span></label>
              <input className="input" inputMode="decimal" value={f.descuento_pct} onChange={(e) => set("descuento_pct")(e.target.value.replace(/[^\d.,]/g, ""))} placeholder="Ej: 15" />
            </div>
            <div className="field" style={{ flex: "1 1 150px", minWidth: 0 }}>
              <label className="field-label">Desde <span style={{ color: "var(--danger)" }}>*</span></label>
              <input type="date" className="input" value={f.desde} onChange={(e) => set("desde")(e.target.value)} />
            </div>
            <div className="field" style={{ flex: "1 1 150px", minWidth: 0 }}>
              <label className="field-label">Hasta <span style={{ color: "var(--danger)" }}>*</span></label>
              <input type="date" className="input" value={f.hasta} min={f.desde || undefined} onChange={(e) => set("hasta")(e.target.value)} />
            </div>
          </div>

          {/* Qué le hace la oferta al catálogo, antes de guardar. */}
          <div style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 12, background: "var(--bg)", display: "flex", flexDirection: "column", gap: 10 }}>
            <strong style={{ fontSize: 13 }}>Qué va a ver el cliente</strong>
            {!simVisible && (
              <div style={{ fontSize: 12.5, color: "var(--text-muted)" }}>
                Elige {alcance.plural} y el descuento para ver cuántos productos entran y cómo quedan sus precios.
              </div>
            )}
            {simVisible && (
              <>
                <div style={{ fontSize: 13, color: "var(--text)", lineHeight: 1.5 }}>
                  <strong>{Number(simVisible.total).toLocaleString("es-CL")} producto{simVisible.total === 1 ? "" : "s"}</strong> en oferta, con {pct.toLocaleString("es-CL")} % de descuento sobre su precio del portal.
                </div>
                {simVisible.ejemplos?.length > 0 && (
                  <div className="table-wrap" style={{ margin: 0 }}>
                    <table className="data-table" style={{ minWidth: 520, fontSize: 12.5 }}>
                      <thead>
                        <tr>
                          <th>Producto</th>
                          <th>Costo</th>
                          <th>Precio normal</th>
                          <th style={{ textAlign: "left" }}>En oferta</th>
                        </tr>
                      </thead>
                      <tbody>
                        {simVisible.ejemplos.map((e) => (
                          <tr key={e.sku}>
                            <td style={{ maxWidth: 220 }}>
                              <div className="truncar" title={e.nombre}>{e.nombre}</div>
                              <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{e.sku}{e.marca ? ` · ${e.marca}` : ""}</div>
                            </td>
                            <td style={{ whiteSpace: "nowrap" }}>{e.costo > 0 ? pesos(e.costo) : "—"}</td>
                            <td style={{ whiteSpace: "nowrap" }}>{pesos(e.precio_normal)}</td>
                            <td style={{ whiteSpace: "nowrap", textAlign: "left", fontWeight: 700 }}>
                              {pesos(e.precio_oferta)}
                              {e.margen_pct !== null && (
                                <span style={{ fontWeight: 600, color: e.margen_pct < 0 ? "#b91c1c" : e.margen_pct < 20 ? "#b45309" : "#15803d" }}>
                                  {" "}· margen {e.margen_pct.toLocaleString("es-CL")} %
                                </span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {simVisible.total > (simVisible.ejemplos?.length || 0) && (
                  <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>Se muestran los {simVisible.ejemplos.length} productos que quedan con menos margen.</div>
                )}
                {simVisible.total === 0 && aviso("Ningún producto con SKU y precio calza con esta selección: la oferta no se vería en el portal.")}
                {simVisible.bajo_costo > 0 && aviso(`${Number(simVisible.bajo_costo).toLocaleString("es-CL")} producto${simVisible.bajo_costo === 1 ? " queda" : "s quedan"} BAJO EL COSTO con este descuento.`)}
                {simVisible.margen_bajo > 0 && aviso(`${Number(simVisible.margen_bajo).toLocaleString("es-CL")} producto${simVisible.margen_bajo === 1 ? " queda" : "s quedan"} con menos de 20 % de margen: la cotización que nazca de un pedido con ${simVisible.margen_bajo === 1 ? "ese producto" : "esos productos"} puede quedar «Pendiente Aprobación».`)}
              </>
            )}
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "11px 18px", borderTop: "1px solid var(--border)", background: "var(--bg)", position: "sticky", bottom: 0 }}>
          <span style={{ fontSize: 12.5, color: "#dc2626", fontWeight: 600 }}>{error}</span>
          <div style={{ display: "flex", gap: 10 }}>
            <button type="button" onClick={onCerrar} className="btn btn-secondary">Cancelar</button>
            <button type="submit" disabled={guardando} className="btn btn-primary">
              {guardando ? "Guardando…" : f.id ? "Guardar cambios" : "Crear oferta"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
