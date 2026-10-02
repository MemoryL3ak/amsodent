import { useCallback, useEffect, useMemo, useState } from "react";
import Select from "react-select";
import { api } from "../lib/api";
import useAuth from "../hooks/useAuth";
import Toast from "../components/Toast";
import ConfirmModal from "../components/ConfirmModal";
import DropdownSelect from "../components/ui/DropdownSelect";
import { calcularLista3 } from "../lib/listas";
import {
  campanaAlcanza,
  normSku,
  estadoCampanaMargen,
  hoyEnChile,
  margenDePrecio,
  precioDesdeMargen,
} from "../lib/campanasMargen";
import { AlertTriangle, Pause, Pencil, Play, Plus, Trash2, X } from "lucide-react";

/* ── Campañas de margen por marca y categoría (2026-10-01) ─────────────────
   Las campañas de siempre fijan un precio producto por producto. Acá se define
   una REGLA: "a los productos de estas marcas y/o categorías, en esta lista,
   véndelos con este margen, entre estas fechas". Mientras está vigente, ese
   precio reemplaza al de lista al cotizar; al terminar vuelve solo el de lista.
   No se reescribe el catálogo. El cálculo vive en src/lib/campanasMargen.js. */

const LISTAS = [
  { value: "1", label: "Lista 1" },
  { value: "2", label: "Lista 2" },
  { value: "3", label: "Lista 3", detalle: "Licitación 9 a 24 meses" },
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

function precioDeLista(prod, lista) {
  if (String(lista) === "3") {
    const explicito = Number(prod.lista3 ?? 0);
    return explicito > 0 ? explicito : calcularLista3(prod.lista2);
  }
  return Number(prod[`lista${lista}`] ?? 0);
}

/* Qué le hace una regla al catálogo: a cuántos productos alcanza, cuántos
   suben o bajan respecto de su precio de lista, y el detalle para mostrar. */
function simular(productos, regla) {
  const filas = [];
  for (const p of productos) {
    if (!campanaAlcanza(p, regla)) continue;
    const campana = precioDesdeMargen(p.costo, regla.margen_pct);
    if (!(campana > 0)) continue;
    const lista = precioDeLista(p, regla.lista_precios);
    filas.push({ p, lista, campana, dif: lista > 0 ? ((campana - lista) / lista) * 100 : null });
  }
  const sube = filas.filter((f) => f.campana > f.lista).length;
  const baja = filas.filter((f) => f.campana < f.lista).length;
  return { filas, total: filas.length, sube, baja, igual: filas.length - sube - baja };
}

// Dos vigencias se cruzan si ninguna termina antes de que empiece la otra.
const seCruzan = (a, b) => !(String(a.hasta) < String(b.desde) || String(b.hasta) < String(a.desde));

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

export default function CampanasMargen() {
  const { rol } = useAuth();
  const rolNorm = String(rol || "").trim().toLowerCase();
  const esAdmin = rolNorm === "admin" || rolNorm === "administrador";

  const [campanas, setCampanas] = useState(null);
  const [productos, setProductos] = useState([]);
  const [toast, setToast] = useState(null);
  const [form, setForm] = useState(null); // regla en edición (o nueva)
  const [aEliminar, setAEliminar] = useState(null);
  const hoy = hoyEnChile();

  // `recarga` se incrementa para volver a pedir la lista tras guardar.
  const [recarga, setRecarga] = useState(0);
  const cargar = useCallback(() => setRecarga((n) => n + 1), []);

  useEffect(() => {
    let vivo = true;
    api.get("/campanas-margen")
      .then((r) => { if (vivo) setCampanas(Array.isArray(r) ? r : []); })
      .catch((e) => {
        console.error(e);
        if (!vivo) return;
        setCampanas([]);
        setToast({ type: "error", message: e?.message || "No se pudieron cargar las campañas." });
      });
    return () => { vivo = false; };
  }, [recarga]);

  useEffect(() => {
    let vivo = true;
    // El catálogo alimenta las listas de marcas/categorías y el simulador.
    api.get("/productos/list")
      .then((r) => { if (vivo) setProductos((Array.isArray(r) ? r : []).filter((p) => (p?.estado || "") !== "Inactivo")); })
      .catch(() => { if (vivo) setProductos([]); });
    return () => { vivo = false; };
  }, []);

  const lista = useMemo(() => campanas || [], [campanas]);

  // Por campaña: a cuántos productos alcanza hoy.
  const alcance = useMemo(() => {
    const m = {};
    for (const c of lista) m[c.id] = simular(productos, c).total;
    return m;
  }, [lista, productos]);

  const vigentes = useMemo(() => lista.filter((c) => estadoCampanaMargen(c, hoy) === "vigente"), [lista, hoy]);
  const programadas = lista.filter((c) => estadoCampanaMargen(c, hoy) === "programada");
  const productosEnCampana = useMemo(() => {
    if (!vigentes.length) return 0;
    return productos.reduce((acc, p) => acc + (vigentes.some((c) => campanaAlcanza(p, c)) ? 1 : 0), 0);
  }, [productos, vigentes]);

  function nueva() {
    setForm({
      id: null, nombre: "", descripcion: "", lista_precios: "1", margen_pct: "",
      marcas: [], categorias: [], skus: [], desde: hoy, hasta: "", activa: true,
    });
  }
  function editar(c) {
    setForm({
      id: c.id,
      nombre: c.nombre || "",
      descripcion: c.descripcion || "",
      lista_precios: String(c.lista_precios || 1),
      margen_pct: String(c.margen_pct ?? ""),
      marcas: Array.isArray(c.marcas) ? c.marcas : [],
      categorias: Array.isArray(c.categorias) ? c.categorias : [],
      skus: Array.isArray(c.skus) ? c.skus : [],
      desde: String(c.desde || "").slice(0, 10),
      hasta: String(c.hasta || "").slice(0, 10),
      activa: c.activa !== false,
    });
  }

  async function alternar(c) {
    try {
      await api.put(`/campanas-margen/${c.id}/activa`, { activa: c.activa === false });
      cargar();
      setToast({ type: "success", message: c.activa === false ? "Campaña reanudada." : "Campaña pausada: vuelve a regir el precio de lista." });
    } catch (e) {
      setToast({ type: "error", message: e?.message || "No se pudo cambiar la campaña." });
    }
  }

  async function eliminar() {
    const c = aEliminar;
    setAEliminar(null);
    if (!c) return;
    try {
      await api.delete(`/campanas-margen/${c.id}`);
      cargar();
      setToast({ type: "success", message: "Campaña eliminada." });
    } catch (e) {
      setToast({ type: "error", message: e?.message || "No se pudo eliminar la campaña." });
    }
  }

  return (
    <div className="page">
      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}

      <ConfirmModal
        open={aEliminar !== null}
        title="¿Eliminar esta campaña?"
        message={`«${aEliminar?.nombre || ""}» dejará de aplicarse y vuelve a regir el precio de lista. Las cotizaciones ya hechas no cambian.`}
        confirmText="Eliminar"
        confirmTone="danger"
        onConfirm={eliminar}
        onCancel={() => setAEliminar(null)}
      />

      <div className="page-header">
        <div>
          <h1 className="page-title">Campañas de margen</h1>
          <p className="page-subtitle">
            Un margen para marcas o categorías completas, o para una lista de SKUs, sobre una lista de precios y por un período. Al terminar, vuelve solo el precio de lista.
          </p>
        </div>
        {esAdmin && (
          <div className="page-actions">
            <button type="button" className="btn btn-primary" onClick={nueva}>
              <Plus size={15} /> Nueva campaña
            </button>
          </div>
        )}
      </div>

      <div className="stats-row stats-3">
        <div className="stat-card">
          <div className="stat-label">Vigentes hoy</div>
          <div className="stat-value">{campanas === null ? "…" : vigentes.length}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Programadas</div>
          <div className="stat-value">{campanas === null ? "…" : programadas.length}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Productos con precio de campaña hoy</div>
          <div className="stat-value">{campanas === null ? "…" : productosEnCampana.toLocaleString("es-CL")}</div>
        </div>
      </div>

      <div className="table-wrap">
        <table className="data-table" style={{ minWidth: 860 }}>
          <thead>
            <tr>
              <th>Campaña</th>
              <th>Lista</th>
              <th>Alcance</th>
              <th>Margen</th>
              <th>Vigencia</th>
              <th>Estado</th>
              <th>Productos</th>
              {esAdmin && <th style={{ textAlign: "right" }}>Acciones</th>}
            </tr>
          </thead>
          <tbody>
            {campanas === null && (
              <tr><td colSpan={esAdmin ? 8 : 7} style={{ textAlign: "center", padding: "50px 0", color: "var(--text-muted)" }}>Cargando…</td></tr>
            )}
            {campanas !== null && lista.length === 0 && (
              <tr>
                <td colSpan={esAdmin ? 8 : 7} style={{ textAlign: "center", padding: "50px 16px", color: "var(--text-muted)" }}>
                  Todavía no hay campañas de margen.{esAdmin ? " Crea la primera con «Nueva campaña»." : ""}
                </td>
              </tr>
            )}
            {lista.map((c) => {
              const est = ESTADOS[estadoCampanaMargen(c, hoy)];
              const marcas = Array.isArray(c.marcas) ? c.marcas : [];
              const cats = Array.isArray(c.categorias) ? c.categorias : [];
              const skus = Array.isArray(c.skus) ? c.skus : [];
              return (
                <tr key={c.id}>
                  <td style={{ maxWidth: 260 }}>
                    <div style={{ fontWeight: 600 }}>{c.nombre}</div>
                    {c.descripcion && <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{c.descripcion}</div>}
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}>Lista {c.lista_precios}</td>
                  <td style={{ maxWidth: 280, fontSize: 12.5 }}>
                    {marcas.length === 0 && cats.length === 0 && skus.length === 0 && <span style={{ color: "#b45309", fontWeight: 600 }}>Todo el catálogo</span>}
                    {skus.length > 0 && (
                      <div title={skus.join(", ")}>
                        <span style={{ color: "var(--text-muted)" }}>SKUs:</span> {skus.slice(0, 3).join(", ")}{skus.length > 3 ? ` +${skus.length - 3}` : ""}
                      </div>
                    )}
                    {marcas.length > 0 && (
                      <div title={marcas.join(", ")}>
                        <span style={{ color: "var(--text-muted)" }}>Marcas:</span> {marcas.slice(0, 3).join(", ")}{marcas.length > 3 ? ` +${marcas.length - 3}` : ""}
                      </div>
                    )}
                    {cats.length > 0 && (
                      <div title={cats.join(", ")}>
                        <span style={{ color: "var(--text-muted)" }}>Categorías:</span> {cats.slice(0, 3).join(", ")}{cats.length > 3 ? ` +${cats.length - 3}` : ""}
                      </div>
                    )}
                  </td>
                  <td style={{ whiteSpace: "nowrap", fontWeight: 700 }}>{Number(c.margen_pct).toLocaleString("es-CL")} %</td>
                  <td style={{ whiteSpace: "nowrap" }}>{fechaCorta(c.desde)} → {fechaCorta(c.hasta)}</td>
                  <td>
                    <span style={{ fontSize: 11, fontWeight: 700, color: est.color, background: est.bg, border: `1px solid ${est.borde}`, borderRadius: 999, padding: "2px 9px", whiteSpace: "nowrap" }}>
                      {est.texto}
                    </span>
                  </td>
                  <td>{(alcance[c.id] ?? 0).toLocaleString("es-CL")}</td>
                  {esAdmin && (
                    <td style={{ textAlign: "right" }}>
                      <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", flexWrap: "wrap" }}>
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => editar(c)} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                          <Pencil size={12} /> Editar
                        </button>
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => alternar(c)} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                          {c.activa === false ? <><Play size={12} /> Reanudar</> : <><Pause size={12} /> Pausar</>}
                        </button>
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAEliminar(c)} style={{ color: "#dc2626", display: "inline-flex", alignItems: "center" }} title="Eliminar">
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
        El precio de campaña se calcula al cotizar, desde el costo vigente del producto. Si un producto tiene además una campaña por producto
        (precio fijo por SKU), manda esa. Si dos campañas de margen alcanzan al mismo producto en la misma lista, manda la más nueva.
      </p>

      {form && (
        <ModalCampana
          inicial={form}
          productos={productos}
          otras={lista.filter((c) => c.id !== form.id)}
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

function ModalCampana({ inicial, productos, otras, onCerrar, onGuardada }) {
  const [f, setF] = useState(inicial);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const set = (k) => (v) => setF((prev) => ({ ...prev, [k]: v }));

  // Marcas y categorías del catálogo, con cuántos productos tiene cada una.
  // Se agrupan sin tildes ni mayúsculas (la misma marca está escrita de varias
  // formas) y se muestra la escritura más usada.
  const opciones = useMemo(() => {
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
    return { marcas: armar("marca"), categorias: armar("categoria") };
  }, [productos]);

  const seleccion = (lista, valores) =>
    valores.map((v) => lista.find((o) => norm(o.value) === norm(v)) || { value: v, label: v });

  const margen = f.margen_pct === "" ? NaN : Number(String(f.margen_pct).replace(",", "."));
  const margenValido = Number.isFinite(margen) && margen >= 0 && margen < 95;
  const sim = useMemo(
    () => (margenValido ? simular(productos, { marcas: f.marcas, categorias: f.categorias, skus: f.skus, lista_precios: f.lista_precios, margen_pct: margen }) : null),
    [productos, f.marcas, f.categorias, f.skus, f.lista_precios, margen, margenValido],
  );

  /* SKUs: se pegan tal cual vienen de un Excel o un correo (separados por
     coma, punto y coma, espacio o salto de línea). Se avisa cuáles no están en
     el catálogo activo y cuáles no tienen costo (no entran a la campaña). */
  const [skusTexto, setSkusTexto] = useState((f.skus || []).join(", "));
  const skusInfo = useMemo(() => {
    const porSku = new Map(productos.map((p) => [normSku(p.sku), p]));
    const lista = Array.isArray(f.skus) ? f.skus : [];
    const noEstan = lista.filter((s) => !porSku.has(normSku(s)));
    const sinCosto = lista.filter((s) => porSku.has(normSku(s)) && !(Number(porSku.get(normSku(s)).costo) > 0));
    return { total: lista.length, noEstan, sinCosto };
  }, [productos, f.skus]);
  function aplicarSkus(texto) {
    setSkusTexto(texto);
    const lista = [...new Set(texto.split(/[\s,;]+/).map((x) => normSku(x)).filter(Boolean))];
    set("skus")(lista);
  }
  // Ejemplos: los que más cambian respecto de su precio de lista.
  const ejemplos = useMemo(
    () => (sim ? [...sim.filas].sort((a, b) => Math.abs(b.dif ?? 0) - Math.abs(a.dif ?? 0)).slice(0, 6) : []),
    [sim],
  );

  // Otras campañas de la misma lista cuya vigencia se cruza y que alcanzan a
  // alguno de los mismos productos.
  const cruces = useMemo(() => {
    if (!sim || !f.desde || !f.hasta) return [];
    return otras
      .filter((c) => c.activa !== false && String(c.lista_precios) === String(f.lista_precios) && seCruzan(c, f))
      .map((c) => ({ c, comunes: sim.filas.filter((x) => campanaAlcanza(x.p, c)).length }))
      .filter((x) => x.comunes > 0);
  }, [otras, sim, f]);

  const todoElCatalogo = f.marcas.length === 0 && f.categorias.length === 0 && (f.skus || []).length === 0;

  async function guardar(e) {
    e.preventDefault();
    if (guardando) return;
    if (!f.nombre.trim()) { setError("Ponle un nombre a la campaña."); return; }
    if (!margenValido) { setError("Indica el margen, entre 0 y 94,99 %."); return; }
    if (!f.desde || !f.hasta) { setError("Indica las fechas de inicio y término."); return; }
    if (f.hasta < f.desde) { setError("La fecha de término no puede ser anterior al inicio."); return; }
    setError("");
    setGuardando(true);
    const payload = {
      nombre: f.nombre.trim(),
      descripcion: f.descripcion.trim(),
      lista_precios: Number(f.lista_precios),
      margen_pct: margen,
      marcas: f.marcas,
      categorias: f.categorias,
      skus: f.skus || [],
      desde: f.desde,
      hasta: f.hasta,
      activa: f.activa !== false,
    };
    try {
      if (f.id) await api.put(`/campanas-margen/${f.id}`, payload);
      else await api.post("/campanas-margen", payload);
      onGuardada(f.id ? "Campaña actualizada." : "Campaña creada.");
    } catch (err) {
      setError(err?.message || "No se pudo guardar la campaña.");
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
          <strong style={{ fontSize: 15 }}>{f.id ? "Editar campaña de margen" : "Nueva campaña de margen"}</strong>
          <button type="button" onClick={onCerrar} className="btn btn-ghost" style={{ padding: 6 }}><X size={18} /></button>
        </div>

        <div style={{ padding: "14px 18px", display: "flex", flexDirection: "column", gap: 12 }}>
          <div className="field">
            <label className="field-label">Nombre <span style={{ color: "var(--danger)" }}>*</span></label>
            <input className="input" value={f.nombre} onChange={(e) => set("nombre")(e.target.value)} placeholder="Ej: Octubre Curaprox" maxLength={120} />
          </div>

          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <div className="field" style={{ flex: "1 1 150px", minWidth: 0 }}>
              <label className="field-label">Lista de precios</label>
              <DropdownSelect value={f.lista_precios} onChange={set("lista_precios")} options={LISTAS} minWidth={200} />
            </div>
            <div className="field" style={{ flex: "1 1 110px", minWidth: 0 }}>
              <label className="field-label">Margen % <span style={{ color: "var(--danger)" }}>*</span></label>
              <input className="input" inputMode="decimal" value={f.margen_pct} onChange={(e) => set("margen_pct")(e.target.value.replace(/[^\d.,]/g, ""))} placeholder="Ej: 25" />
            </div>
            <div className="field" style={{ flex: "1 1 140px", minWidth: 0 }}>
              <label className="field-label">Desde <span style={{ color: "var(--danger)" }}>*</span></label>
              <input type="date" className="input" value={f.desde} onChange={(e) => set("desde")(e.target.value)} />
            </div>
            <div className="field" style={{ flex: "1 1 140px", minWidth: 0 }}>
              <label className="field-label">Hasta <span style={{ color: "var(--danger)" }}>*</span></label>
              <input type="date" className="input" value={f.hasta} min={f.desde || undefined} onChange={(e) => set("hasta")(e.target.value)} />
            </div>
          </div>

          <div className="field">
            <label className="field-label">Marcas <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>(vacío = todas)</span></label>
            <Select
              isMulti
              classNamePrefix="rs"
              value={seleccion(opciones.marcas, f.marcas)}
              onChange={(arr) => set("marcas")((arr || []).map((o) => o.value))}
              options={opciones.marcas}
              placeholder="Busca y agrega marcas…"
              noOptionsMessage={() => "Sin coincidencias"}
              menuPortalTarget={typeof document !== "undefined" ? document.body : undefined}
              menuPosition="fixed"
              styles={estilosSelect}
            />
          </div>
          <div className="field">
            <label className="field-label">Categorías <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>(vacío = todas)</span></label>
            <Select
              isMulti
              classNamePrefix="rs"
              value={seleccion(opciones.categorias, f.categorias)}
              onChange={(arr) => set("categorias")((arr || []).map((o) => o.value))}
              options={opciones.categorias}
              placeholder="Busca y agrega categorías…"
              noOptionsMessage={() => "Sin coincidencias"}
              menuPortalTarget={typeof document !== "undefined" ? document.body : undefined}
              menuPosition="fixed"
              styles={estilosSelect}
            />
            <div className="field-hint">Con marcas y categorías a la vez, el producto debe cumplir las dos.</div>
          </div>

          <div className="field">
            <label className="field-label">SKUs <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>(vacío = sin filtro por SKU)</span></label>
            <textarea
              className="input"
              rows={3}
              value={skusTexto}
              onChange={(e) => aplicarSkus(e.target.value)}
              placeholder="Pega los SKUs separados por coma, espacio o salto de línea. Ej: PH00030, INST00532"
              style={{ height: "auto", minHeight: 72, padding: "8px 10px", fontFamily: "inherit", resize: "vertical" }}
            />
            <div className="field-hint">
              {skusInfo.total === 0
                ? "Solo estos productos entran a la campaña; si además pones marcas o categorías, deben cumplirlas."
                : `${skusInfo.total} SKU${skusInfo.total === 1 ? "" : "s"}${skusInfo.noEstan.length ? ` · ${skusInfo.noEstan.length} no está${skusInfo.noEstan.length === 1 ? "" : "n"} en el catálogo activo: ${skusInfo.noEstan.slice(0, 8).join(", ")}${skusInfo.noEstan.length > 8 ? "…" : ""}` : ""}${skusInfo.sinCosto.length ? ` · ${skusInfo.sinCosto.length} sin costo (no entra${skusInfo.sinCosto.length === 1 ? "" : "n"}): ${skusInfo.sinCosto.slice(0, 8).join(", ")}${skusInfo.sinCosto.length > 8 ? "…" : ""}` : ""}`}
            </div>
          </div>

          <div className="field">
            <label className="field-label">Descripción <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>(opcional)</span></label>
            <input className="input" value={f.descripcion} onChange={(e) => set("descripcion")(e.target.value)} maxLength={400} />
          </div>

          {/* Simulación: qué le hace esta regla al catálogo, antes de guardar. */}
          <div style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 12, background: "var(--bg)", display: "flex", flexDirection: "column", gap: 10 }}>
            <strong style={{ fontSize: 13 }}>Qué va a pasar</strong>
            {!sim && <div style={{ fontSize: 12.5, color: "var(--text-muted)" }}>Indica el margen para ver a qué productos alcanza y cómo quedan sus precios.</div>}
            {sim && (
              <>
                <div style={{ fontSize: 13, color: "var(--text)", lineHeight: 1.5 }}>
                  Alcanza a <strong>{sim.total.toLocaleString("es-CL")} producto{sim.total === 1 ? "" : "s"}</strong> en Lista {f.lista_precios}:{" "}
                  <span style={{ color: "#15803d", fontWeight: 600 }}>{sim.baja.toLocaleString("es-CL")} bajan</span>,{" "}
                  <span style={{ color: "#b91c1c", fontWeight: 600 }}>{sim.sube.toLocaleString("es-CL")} suben</span>
                  {sim.igual > 0 ? ` y ${sim.igual.toLocaleString("es-CL")} quedan igual` : ""} respecto de su precio de lista.
                </div>
                {ejemplos.length > 0 && (
                  <div className="table-wrap" style={{ margin: 0 }}>
                    <table className="data-table" style={{ minWidth: 520, fontSize: 12.5 }}>
                      <thead>
                        <tr>
                          <th>Producto</th>
                          <th>Costo</th>
                          <th>Lista {f.lista_precios} hoy</th>
                          <th style={{ textAlign: "left" }}>En campaña</th>
                        </tr>
                      </thead>
                      <tbody>
                        {ejemplos.map(({ p, lista, campana, dif }) => {
                          const mHoy = margenDePrecio(p.costo, lista);
                          return (
                            <tr key={p.id}>
                              <td style={{ maxWidth: 220 }}>
                                <div className="truncar" title={p.nombre}>{p.nombre}</div>
                                <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{p.sku || "sin SKU"} · {p.marca || "—"}</div>
                              </td>
                              <td style={{ whiteSpace: "nowrap" }}>{pesos(p.costo)}</td>
                              <td style={{ whiteSpace: "nowrap" }}>
                                {pesos(lista)}
                                {mHoy !== null && <span style={{ color: "var(--text-muted)" }}> · {mHoy.toFixed(1)}%</span>}
                              </td>
                              <td style={{ whiteSpace: "nowrap", textAlign: "left", fontWeight: 700 }}>
                                {pesos(campana)}
                                {dif !== null && (
                                  <span style={{ fontWeight: 600, color: dif < 0 ? "#15803d" : dif > 0 ? "#b91c1c" : "var(--text-muted)" }}>
                                    {" "}({dif > 0 ? "+" : ""}{dif.toFixed(1)}%)
                                  </span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
                {sim.total > ejemplos.length && (
                  <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>Se muestran los {ejemplos.length} productos que más cambian de precio.</div>
                )}
              </>
            )}
            {sim && sim.total === 0 && aviso("Ningún producto con costo cumple esta combinación de marcas, categorías y SKUs: la campaña no tendría efecto.")}
            {sim && todoElCatalogo && sim.total > 0 && aviso("Sin marcas, categorías ni SKUs, la campaña aplica a TODO el catálogo.")}
            {margenValido && margen < 20 && aviso("Con menos de 20 % de margen, las cotizaciones quedan «Pendiente Aprobación» y necesitan que alguien las apruebe.")}
            {cruces.map(({ c, comunes }) => (
              <div key={c.id}>
                {aviso(`Se cruza con «${c.nombre}» (${Number(c.margen_pct).toLocaleString("es-CL")} %, ${fechaCorta(c.desde)} → ${fechaCorta(c.hasta)}) en ${comunes.toLocaleString("es-CL")} producto${comunes === 1 ? "" : "s"}. Mientras coincidan, manda la campaña más nueva.`)}
              </div>
            ))}
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "11px 18px", borderTop: "1px solid var(--border)", background: "var(--bg)", position: "sticky", bottom: 0 }}>
          <span style={{ fontSize: 12.5, color: "#dc2626", fontWeight: 600 }}>{error}</span>
          <div style={{ display: "flex", gap: 10 }}>
            <button type="button" onClick={onCerrar} className="btn btn-secondary">Cancelar</button>
            <button type="submit" disabled={guardando} className="btn btn-primary">
              {guardando ? "Guardando…" : f.id ? "Guardar cambios" : "Crear campaña"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
