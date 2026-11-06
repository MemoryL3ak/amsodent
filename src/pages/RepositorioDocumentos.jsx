import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, CheckCircle2, Clock, Download, FileText, Infinity as InfinityIcon, Pencil, Plus, RefreshCw, Trash2, Upload, X } from "lucide-react";
import { api } from "../lib/api";
import useAuth from "../hooks/useAuth";
import Toast from "../components/Toast";
import ConfirmModal from "../components/ConfirmModal";
import DropdownSelect from "../components/ui/DropdownSelect";
import BotonLimpiarFiltros from "../components/BotonLimpiarFiltros";
import { abrirDocumentoRepositorio, pesoLegible } from "../lib/repositorio";

/* ── Repositorio de documentos (2026-11-05) ─────────────────────────────────
   Pedido de Ariel: "Módulo Repositorio de documentos. Patente, Estatuto
   empresa, carta garantía (vigencia de documentos)". Los documentos de la
   empresa que se piden una y otra vez, cada uno con su archivo y su vigencia:
   vigente, por vencer (a 30 días o menos), vencido o sin vencimiento. El
   servidor avisa en la campana cuando uno está por vencer.

   Cualquier usuario los ve y los descarga (también se pueden sumar al ZIP de
   fichas técnicas de una cotización); subir, editar, reemplazar el archivo y
   eliminar es solo de administradores (2026-11-06, pedido de Ariel).
   Tabla compacta paginada; las tarjetas de arriba filtran por vigencia. */

const POR_PAGINA = 10;
const VIGENCIAS = {
  vigente: { texto: "Vigente", color: "#15803d", bg: "#dcfce7", Icono: CheckCircle2 },
  por_vencer: { texto: "Por vencer", color: "#b45309", bg: "#fef3c7", Icono: Clock },
  vencido: { texto: "Vencido", color: "#b91c1c", bg: "#fee2e2", Icono: AlertTriangle },
  sin_vencimiento: { texto: "Sin vencimiento", color: "#475569", bg: "#f1f5f9", Icono: InfinityIcon },
};
const sinTildes = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const fechaCL = (d) => {
  const m = String(d || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : "—";
};
const textoDias = (d) => {
  if (d.vigencia === "sin_vencimiento" || d.dias_restantes == null) return "No vence";
  const n = Number(d.dias_restantes);
  if (n < 0) return `Venció hace ${-n} día${n === -1 ? "" : "s"}`;
  if (n === 0) return "Vence hoy";
  return `Vence en ${n} día${n === 1 ? "" : "s"}`;
};

export default function RepositorioDocumentos() {
  const { rol } = useAuth();
  const rolNorm = String(rol || "").trim().toLowerCase();
  const puedeGestionar = rolNorm === "admin" || rolNorm === "administrador";

  const [datos, setDatos] = useState(null); // { listo, mensaje?, categorias, documentos }
  const [cargando, setCargando] = useState(true);
  const [toast, setToast] = useState(null);
  const [fTexto, setFTexto] = useState("");
  const [fTipo, setFTipo] = useState("");
  const [fVigencia, setFVigencia] = useState("");
  const [pagina, setPagina] = useState(1);
  const [form, setForm] = useState(null); // documento en edición ({} = nuevo)
  const [aEliminar, setAEliminar] = useState(null);
  const [abriendo, setAbriendo] = useState(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      setDatos(await api.get("/repositorio"));
    } catch (e) {
      setDatos({ listo: true, categorias: [], documentos: [] });
      setToast({ type: "error", message: e?.message || "No se pudo cargar el repositorio de documentos." });
    } finally {
      setCargando(false);
    }
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  const documentos = useMemo(() => datos?.documentos || [], [datos]);
  const categorias = useMemo(() => datos?.categorias || [], [datos]);
  const nombreTipo = (clave) => categorias.find((c) => c.clave === clave)?.nombre || "Otro";

  const conteo = useMemo(() => {
    const c = { vigente: 0, por_vencer: 0, vencido: 0, sin_vencimiento: 0 };
    for (const d of documentos) c[d.vigencia] = (c[d.vigencia] || 0) + 1;
    return c;
  }, [documentos]);

  const filtrados = useMemo(() => {
    const palabras = sinTildes(fTexto).split(/\s+/).filter(Boolean);
    // Primero lo que requiere atención: vencidos, por vencer, y el resto por nombre.
    const peso = { vencido: 0, por_vencer: 1, vigente: 2, sin_vencimiento: 3 };
    return documentos
      .filter((d) => {
        if (fTipo && d.categoria !== fTipo) return false;
        if (fVigencia && d.vigencia !== fVigencia) return false;
        if (!palabras.length) return true;
        const texto = sinTildes(`${d.nombre} ${d.descripcion || ""} ${nombreTipo(d.categoria)} ${d.file_name || ""}`);
        return palabras.every((w) => texto.includes(w));
      })
      .sort((a, b) => peso[a.vigencia] - peso[b.vigencia] || (a.dias_restantes ?? 1e9) - (b.dias_restantes ?? 1e9) || String(a.nombre).localeCompare(String(b.nombre), "es"));
  }, [documentos, fTexto, fTipo, fVigencia]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setPagina(1); }, [fTexto, fTipo, fVigencia]);
  const paginas = Math.max(1, Math.ceil(filtrados.length / POR_PAGINA));
  const paginaActual = Math.min(pagina, paginas);
  const visibles = filtrados.slice((paginaActual - 1) * POR_PAGINA, paginaActual * POR_PAGINA);
  const hayFiltros = Boolean(fTexto || fTipo || fVigencia);

  async function abrir(d) {
    setAbriendo(d.id);
    try {
      await abrirDocumentoRepositorio(d.id);
    } catch (e) {
      setToast({ type: "error", message: e?.message || "No se pudo abrir el archivo." });
    } finally {
      setAbriendo(null);
    }
  }

  async function eliminar() {
    const d = aEliminar;
    setAEliminar(null);
    if (!d) return;
    try {
      await api.delete(`/repositorio/${d.id}`);
      setToast({ type: "success", message: `«${d.nombre}» se eliminó del repositorio.` });
      cargar();
    } catch (e) {
      setToast({ type: "error", message: e?.message || "No se pudo eliminar el documento." });
    }
  }

  const tarjeta = (clave, etiqueta, valor, detalle) => (
    <button
      type="button"
      className={`stat-card kpi-vigencia${fVigencia === clave ? " activa" : ""}`}
      onClick={() => setFVigencia(fVigencia === clave ? "" : clave)}
      title={clave ? (fVigencia === clave ? "Quitar el filtro" : `Ver solo: ${etiqueta.toLowerCase()}`) : "Ver todos"}
      style={{ textAlign: "left", cursor: "pointer", font: "inherit", outline: fVigencia === clave && clave ? "2px solid var(--primary)" : "none", outlineOffset: -2 }}
    >
      <div className="stat-label">{etiqueta}</div>
      <div className="stat-value">{datos ? valor : "…"}</div>
      <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 2 }}>{detalle}</div>
    </button>
  );

  return (
    <div className="page repositorio-documentos">
      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}
      <ConfirmModal
        open={aEliminar !== null}
        title="¿Eliminar este documento?"
        message={`«${aEliminar?.nombre || ""}» y su archivo se eliminarán del repositorio. Esto no se puede deshacer.`}
        confirmText="Eliminar documento"
        confirmTone="danger"
        onConfirm={eliminar}
        onCancel={() => setAEliminar(null)}
      />

      <div className="page-header">
        <div>
          <h1 className="page-title">Repositorio de documentos</h1>
          <p className="page-subtitle">
            Patente, estatutos, cartas de garantía y otros documentos de la empresa, con su vigencia. Se pueden sumar al ZIP de fichas técnicas de una cotización.
          </p>
        </div>
        <div className="page-actions" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" className="btn btn-secondary" onClick={cargar} title="Actualizar" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <RefreshCw size={14} /> Actualizar
          </button>
          {puedeGestionar && (
            <button type="button" className="btn btn-primary" onClick={() => setForm({})} disabled={datos?.listo === false} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <Plus size={15} /> Nuevo documento
            </button>
          )}
        </div>
      </div>

      {datos?.listo === false && (
        <div style={{ fontSize: 13, color: "#92400e", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 10, padding: "10px 14px", marginBottom: 16 }}>
          {datos.mensaje || "El repositorio aún no está disponible."}
        </div>
      )}

      {/* Las tarjetas filtran por vigencia (un clic) */}
      <div className="stats-row">
        {tarjeta("", "Documentos", documentos.length, `${conteo.sin_vencimiento} sin vencimiento`)}
        {tarjeta("vigente", "Vigentes", conteo.vigente, "con más de 30 días por delante")}
        {tarjeta("por_vencer", "Por vencer", conteo.por_vencer, "vencen en 30 días o menos")}
        {tarjeta("vencido", "Vencidos", conteo.vencido, "hay que renovarlos")}
      </div>

      <div className="filter-bar">
        <div className="filter-field" style={{ flex: 2, minWidth: 200 }}>
          <label className="filter-label">Buscar</label>
          <input className="input" placeholder="Nombre, descripción o archivo…" value={fTexto} onChange={(e) => setFTexto(e.target.value)} />
        </div>
        <div className="filter-field">
          <label className="filter-label">Tipo</label>
          <DropdownSelect
            value={fTipo}
            onChange={setFTipo}
            minWidth={210}
            style={{ width: "100%" }}
            options={[{ value: "", label: "Todos los tipos" }, ...categorias.map((c) => ({ value: c.clave, label: c.nombre }))]}
          />
        </div>
        <div className="filter-field">
          <label className="filter-label">Vigencia</label>
          <DropdownSelect
            value={fVigencia}
            onChange={setFVigencia}
            minWidth={190}
            style={{ width: "100%" }}
            options={[{ value: "", label: "Todas" }, ...Object.entries(VIGENCIAS).map(([value, v]) => ({ value, label: v.texto, color: v.color }))]}
          />
        </div>
        <BotonLimpiarFiltros hay={hayFiltros} onLimpiar={() => { setFTexto(""); setFTipo(""); setFVigencia(""); }} />
      </div>

      <div className="table-wrap">
        <table className="data-table tabla-compacta tabla-texto tabla-repositorio" style={{ minWidth: 760 }}>
          <thead>
            <tr>
              <th>Documento</th>
              <th>Tipo</th>
              <th>Emisión</th>
              <th>Vencimiento</th>
              <th>Vigencia</th>
              <th className="col-archivo">Archivo</th>
              <th style={{ textAlign: "right" }}>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {cargando && !datos && (
              <tr><td colSpan={7} style={{ textAlign: "center", padding: "44px 0", color: "var(--text-muted)" }}>Cargando…</td></tr>
            )}
            {datos && visibles.length === 0 && (
              <tr>
                <td colSpan={7} style={{ textAlign: "center", padding: "44px 16px", color: "var(--text-muted)" }}>
                  {documentos.length === 0
                    ? `Todavía no hay documentos en el repositorio.${puedeGestionar ? " Sube el primero con «Nuevo documento»." : ""}`
                    : "Ningún documento calza con los filtros."}
                </td>
              </tr>
            )}
            {visibles.map((d) => {
              const v = VIGENCIAS[d.vigencia] || VIGENCIAS.sin_vencimiento;
              return (
                <tr key={d.id}>
                  <td style={{ maxWidth: 300 }}>
                    <div style={{ fontWeight: 600 }}>{d.nombre}</div>
                    {d.descripcion && <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{d.descripcion}</div>}
                  </td>
                  <td style={{ maxWidth: 150 }}>{nombreTipo(d.categoria)}</td>
                  <td style={{ whiteSpace: "nowrap" }}>{fechaCL(d.fecha_emision)}</td>
                  <td style={{ whiteSpace: "nowrap" }}>{d.fecha_vencimiento ? fechaCL(d.fecha_vencimiento) : "No vence"}</td>
                  <td>
                    <span className="chip-vigencia" style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, fontWeight: 700, color: v.color, background: v.bg, borderRadius: 999, padding: "2px 9px", whiteSpace: "nowrap" }}>
                      <v.Icono size={12} /> {v.texto}
                    </span>
                    {d.vigencia !== "sin_vencimiento" && <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 3 }}>{textoDias(d)}</div>}
                  </td>
                  <td className="col-archivo" style={{ maxWidth: 180 }}>
                    <div className="truncar" title={d.file_name || ""} style={{ fontSize: 12.5 }}>{d.file_name || "—"}</div>
                    <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>{pesoLegible(d.size_bytes)}</div>
                  </td>
                  <td>
                    <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", flexWrap: "wrap" }}>
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => abrir(d)} disabled={abriendo === d.id} style={{ display: "inline-flex", alignItems: "center", gap: 5 }} title="Descargar el archivo">
                        <Download size={13} /> {abriendo === d.id ? "Abriendo…" : "Descargar"}
                      </button>
                      {puedeGestionar && (
                        <>
                          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setForm(d)} style={{ display: "inline-flex", alignItems: "center", gap: 4 }} title="Editar los datos o reemplazar el archivo (renovación)">
                            <Pencil size={12} /> Editar
                          </button>
                          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAEliminar(d)} style={{ color: "#dc2626", display: "inline-flex", alignItems: "center" }} title="Eliminar">
                            <Trash2 size={13} />
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {filtrados.length > POR_PAGINA && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "10px 4px", fontSize: 12.5, color: "var(--text-soft)" }}>
          <span>
            Mostrando {(paginaActual - 1) * POR_PAGINA + 1}–{Math.min(paginaActual * POR_PAGINA, filtrados.length)} de {filtrados.length} documento{filtrados.length === 1 ? "" : "s"}
          </span>
          <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
            <button type="button" className="btn btn-secondary btn-sm" disabled={paginaActual <= 1} onClick={() => setPagina(paginaActual - 1)}>Anterior</button>
            <span>Página {paginaActual} de {paginas}</span>
            <button type="button" className="btn btn-secondary btn-sm" disabled={paginaActual >= paginas} onClick={() => setPagina(paginaActual + 1)}>Siguiente</button>
          </span>
        </div>
      )}

      {form && (
        <ModalDocumento
          inicial={form}
          categorias={categorias}
          onCerrar={() => setForm(null)}
          onGuardado={(mensaje) => {
            setForm(null);
            setToast({ type: "success", message: mensaje });
            cargar();
          }}
        />
      )}
    </div>
  );
}

function ModalDocumento({ inicial, categorias, onCerrar, onGuardado }) {
  const nuevo = !inicial?.id;
  const [nombre, setNombre] = useState(inicial?.nombre || "");
  const [categoria, setCategoria] = useState(inicial?.categoria || "");
  const [descripcion, setDescripcion] = useState(inicial?.descripcion || "");
  const [emision, setEmision] = useState(String(inicial?.fecha_emision || "").slice(0, 10));
  const [vencimiento, setVencimiento] = useState(String(inicial?.fecha_vencimiento || "").slice(0, 10));
  const [archivo, setArchivo] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const inputArchivo = useRef(null);

  async function guardar(e) {
    e.preventDefault();
    if (guardando) return;
    if (!nombre.trim()) { setError("Ponle un nombre al documento."); return; }
    if (!categoria) { setError("Elige el tipo de documento."); return; }
    if (nuevo && !archivo) { setError("Elige el archivo del documento."); return; }
    if (emision && vencimiento && vencimiento < emision) { setError("El vencimiento no puede ser anterior a la emisión."); return; }
    if (archivo && archivo.size > 20 * 1024 * 1024) { setError("El archivo pesa más de 20 MB."); return; }
    setError("");
    setGuardando(true);
    const fd = new FormData();
    fd.append("nombre", nombre.trim());
    fd.append("categoria", categoria);
    fd.append("descripcion", descripcion.trim());
    fd.append("fecha_emision", emision);
    fd.append("fecha_vencimiento", vencimiento);
    if (archivo) fd.append("file", archivo);
    try {
      if (nuevo) await api.postForm("/repositorio", fd);
      else await api.putForm(`/repositorio/${inicial.id}`, fd);
      onGuardado(nuevo ? "Documento agregado al repositorio." : archivo ? "Documento actualizado con su archivo nuevo." : "Documento actualizado.");
    } catch (err) {
      setError(err?.message || "No se pudo guardar el documento.");
      setGuardando(false);
    }
  }

  return createPortal(
    <div
      onMouseDown={(e) => { if (e.target === e.currentTarget && !guardando) onCerrar(); }}
      style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.55)", zIndex: 11000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
    >
      <form onSubmit={guardar} className="modal-documento-repositorio" style={{ width: 560, maxWidth: "100%", maxHeight: "90vh", overflow: "auto", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-lg)" }}>
        <div style={{ padding: "12px 18px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center", position: "sticky", top: 0, background: "var(--surface)", zIndex: 2 }}>
          <strong style={{ fontSize: 15 }}>{nuevo ? "Nuevo documento" : "Editar documento"}</strong>
          <button type="button" onClick={onCerrar} className="btn btn-ghost" style={{ padding: 6 }} aria-label="Cerrar"><X size={18} /></button>
        </div>

        <div style={{ padding: "14px 18px", display: "flex", flexDirection: "column", gap: 12 }}>
          <div className="field">
            <label className="field-label">Nombre <span style={{ color: "var(--danger)" }}>*</span></label>
            <input className="input" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej: Patente comercial 2026" maxLength={160} autoFocus />
          </div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <div className="field" style={{ flex: "2 1 200px", minWidth: 0 }}>
              <label className="field-label">Tipo <span style={{ color: "var(--danger)" }}>*</span></label>
              <DropdownSelect value={categoria} onChange={setCategoria} placeholder="Elige el tipo…" minWidth={230} options={categorias.map((c) => ({ value: c.clave, label: c.nombre }))} />
            </div>
            <div className="field" style={{ flex: "1 1 140px", minWidth: 0 }}>
              <label className="field-label">Emisión</label>
              <input type="date" className="input" value={emision} onChange={(e) => setEmision(e.target.value)} />
            </div>
            <div className="field" style={{ flex: "1 1 140px", minWidth: 0 }}>
              <label className="field-label">Vencimiento</label>
              <input type="date" className="input" value={vencimiento} min={emision || undefined} onChange={(e) => setVencimiento(e.target.value)} />
            </div>
          </div>
          <div className="field-hint" style={{ marginTop: -6 }}>
            {vencimiento ? "El sistema avisa en la campana a 30, 15 y 7 días del vencimiento, y el día que vence." : "Sin fecha de vencimiento el documento no vence (por ejemplo, los estatutos)."}
          </div>
          <div className="field">
            <label className="field-label">Descripción <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>(opcional)</span></label>
            <input className="input" value={descripcion} onChange={(e) => setDescripcion(e.target.value)} maxLength={400} placeholder="Para qué se usa, quién lo emite…" />
          </div>
          <div className="field">
            <label className="field-label">
              Archivo {nuevo ? <span style={{ color: "var(--danger)" }}>*</span> : <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>(elige uno solo si quieres reemplazar el actual)</span>}
            </label>
            <input ref={inputArchivo} type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx,.xls,.xlsx" style={{ display: "none" }} onChange={(e) => setArchivo(e.target.files?.[0] || null)} />
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <button type="button" className="btn btn-secondary" onClick={() => inputArchivo.current?.click()} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <Upload size={14} /> {archivo ? "Cambiar archivo" : nuevo ? "Elegir archivo" : "Reemplazar archivo"}
              </button>
              <span style={{ fontSize: 12.5, color: "var(--text-muted)", overflowWrap: "anywhere", minWidth: 0, display: "inline-flex", alignItems: "center", gap: 5 }}>
                <FileText size={13} style={{ flexShrink: 0 }} />
                {archivo ? `${archivo.name} · ${pesoLegible(archivo.size)}` : nuevo ? "PDF, imagen, Word o Excel, hasta 20 MB" : `Actual: ${inicial.file_name || "sin archivo"}`}
              </span>
            </div>
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "11px 18px", borderTop: "1px solid var(--border)", background: "var(--bg)", position: "sticky", bottom: 0 }}>
          <span style={{ fontSize: 12.5, color: "#dc2626", fontWeight: 600 }}>{error}</span>
          <div style={{ display: "flex", gap: 10 }}>
            <button type="button" onClick={onCerrar} className="btn btn-secondary" disabled={guardando}>Cancelar</button>
            <button type="submit" disabled={guardando} className="btn btn-primary">
              {guardando ? "Guardando…" : nuevo ? "Agregar documento" : "Guardar cambios"}
            </button>
          </div>
        </div>
      </form>
    </div>,
    document.body,
  );
}
