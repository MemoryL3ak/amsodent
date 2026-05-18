import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import Toast from "../components/Toast";
import ConfirmModal from "../components/ConfirmModal";
import EditorRichText from "../components/EditorRichText";
import { Plus, Pencil, Trash2, X, Code2, Eye, Zap, Calendar, Hand } from "lucide-react";

const TRIGGERS = [
  { value: "manual",           label: "Manual",                  icon: Hand,     desc: "El usuario la selecciona en el modal Nuevo correo." },
  { value: "adjudicacion_oc",  label: "Adjudicación (1ra OC)",   icon: Zap,      desc: "Se dispara al subir la primera OC de la cotización." },
  { value: "proximo_vencer",   label: "Próximo a vencer",        icon: Calendar, desc: "Se dispara X horas antes de la fecha de cierre." },
];

const VARIABLES_DEFAULT = {
  id_cotizacion: "ID Cotización",
  nombre_entidad: "Nombre Entidad",
  total: "Total con IVA",
  fecha_cierre: "Fecha y hora de cierre",
};

export default function PlantillasCorreo() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editando, setEditando] = useState(null);
  const [confirmDel, setConfirmDel] = useState(null);

  async function cargar() {
    setLoading(true);
    try {
      const data = await api.get("/plantillas-correo");
      setItems(data || []);
    } catch (e) {
      console.error(e);
      setToast({ type: "error", message: "No se pudieron cargar las plantillas." });
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { cargar(); }, []);

  function abrirNueva() {
    setEditando(null);
    setModalOpen(true);
  }
  function abrirEditar(p) {
    setEditando(p);
    setModalOpen(true);
  }

  async function eliminar() {
    if (!confirmDel) return;
    try {
      await api.delete(`/plantillas-correo/${confirmDel.id}`);
      setToast({ type: "success", message: "Plantilla eliminada." });
      cargar();
    } catch (e) {
      setToast({ type: "error", message: e?.message || "No se pudo eliminar." });
    } finally {
      setConfirmDel(null);
    }
  }

  const grouped = useMemo(() => {
    const groups = { manual: [], adjudicacion_oc: [], proximo_vencer: [] };
    for (const p of items) {
      const key = TRIGGERS.find((t) => t.value === p.trigger)?.value || "manual";
      groups[key].push(p);
    }
    return groups;
  }, [items]);

  return (
    <div className="page">
      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}

      <div className="page-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <h1 className="page-title">Plantillas de Correo</h1>
          <p className="page-subtitle">
            Define qué se envía y cuándo: manual, al adjudicar, o como recordatorio.
          </p>
        </div>
        <button className="btn btn-primary" onClick={abrirNueva} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <Plus size={14} /> Nueva Plantilla
        </button>
      </div>

      {loading ? (
        <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>Cargando…</div>
      ) : items.length === 0 ? (
        <div className="surface" style={{ padding: 40, textAlign: "center" }}>
          <p style={{ color: "var(--text-muted)" }}>Aún no hay plantillas. Crea la primera.</p>
        </div>
      ) : (
        TRIGGERS.map((trig) => {
          const grupo = grouped[trig.value] || [];
          if (grupo.length === 0) return null;
          const Icon = trig.icon;
          return (
            <div key={trig.value} className="surface" style={{ marginBottom: 16 }}>
              <div className="surface-header" style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <Icon size={16} color="var(--primary, #28aeb1)" />
                <div>
                  <h3 className="surface-title" style={{ margin: 0 }}>{trig.label}</h3>
                  <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "2px 0 0" }}>{trig.desc}</p>
                </div>
              </div>
              <div className="surface-body" style={{ padding: 0 }}>
                <table className="data-table" style={{ width: "100%" }}>
                  <thead>
                    <tr>
                      <th style={{ width: 200 }}>Código</th>
                      <th>Nombre</th>
                      <th>Asunto</th>
                      <th style={{ width: 80, textAlign: "center" }}>Activo</th>
                      <th style={{ width: 110, textAlign: "center" }}>Horas antes</th>
                      <th style={{ width: 140, textAlign: "right" }}>Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {grupo.map((p) => (
                      <tr key={p.id}>
                        <td style={{ fontFamily: "monospace", fontSize: 12 }}>{p.codigo}</td>
                        <td>{p.nombre}</td>
                        <td title={p.asunto} style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 320 }}>
                          {p.asunto}
                        </td>
                        <td style={{ textAlign: "center" }}>
                          <span style={{
                            display: "inline-block",
                            padding: "2px 8px",
                            borderRadius: 999,
                            fontSize: 11,
                            fontWeight: 600,
                            background: p.activo ? "#dcfce7" : "#fee2e2",
                            color: p.activo ? "#15803d" : "#b91c1c",
                          }}>
                            {p.activo ? "Sí" : "No"}
                          </span>
                        </td>
                        <td style={{ textAlign: "center", fontSize: 12 }}>
                          {p.trigger === "proximo_vencer" ? (p.horas_antes ?? "—") : "—"}
                        </td>
                        <td style={{ textAlign: "right" }}>
                          <div className="btn-row" style={{ justifyContent: "flex-end" }}>
                            <button className="btn btn-secondary btn-sm" onClick={() => abrirEditar(p)}>
                              <Pencil size={12} /> Editar
                            </button>
                            <button className="btn btn-danger btn-sm" onClick={() => setConfirmDel(p)}>
                              <Trash2 size={12} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })
      )}

      {modalOpen && (
        <ModalPlantilla
          plantilla={editando}
          onClose={() => setModalOpen(false)}
          onSaved={() => { setModalOpen(false); cargar(); }}
          onToast={setToast}
        />
      )}

      <ConfirmModal
        open={!!confirmDel}
        title="Eliminar plantilla"
        message={`¿Eliminar la plantilla "${confirmDel?.nombre}"? Si tiene un trigger automático, dejará de enviarse.`}
        onCancel={() => setConfirmDel(null)}
        onConfirm={eliminar}
      />
    </div>
  );
}

function ModalPlantilla({ plantilla, onClose, onSaved, onToast }) {
  const editando = !!plantilla;
  const [codigo, setCodigo] = useState(plantilla?.codigo || "");
  const [nombre, setNombre] = useState(plantilla?.nombre || "");
  const [asunto, setAsunto] = useState(plantilla?.asunto || "");
  const [trigger, setTrigger] = useState(plantilla?.trigger || "manual");
  const [horasAntes, setHorasAntes] = useState(plantilla?.horas_antes ?? 24);
  const [activo, setActivo] = useState(plantilla?.activo ?? true);
  const [cuerpoHtml, setCuerpoHtml] = useState(plantilla?.cuerpo_html || "");
  const [modoEditor, setModoEditor] = useState("visual"); // 'visual' | 'html' | 'preview'
  const [guardando, setGuardando] = useState(false);

  function insertarVariable(key) {
    setCuerpoHtml((prev) => prev + ` {{${key}}}`);
  }

  async function guardar() {
    if (!codigo.trim() || !nombre.trim() || !asunto.trim() || !cuerpoHtml.trim()) {
      onToast?.({ type: "error", message: "Faltan campos obligatorios." });
      return;
    }
    setGuardando(true);
    try {
      const payload = {
        codigo: codigo.trim(),
        nombre: nombre.trim(),
        asunto: asunto.trim(),
        cuerpo_html: cuerpoHtml,
        trigger,
        horas_antes: trigger === "proximo_vencer" ? Number(horasAntes) || 24 : null,
        activo,
        variables_disponibles: VARIABLES_DEFAULT,
      };
      if (editando) {
        await api.put(`/plantillas-correo/${plantilla.id}`, payload);
        onToast?.({ type: "success", message: "Plantilla actualizada." });
      } else {
        await api.post("/plantillas-correo", payload);
        onToast?.({ type: "success", message: "Plantilla creada." });
      }
      onSaved();
    } catch (e) {
      onToast?.({ type: "error", message: e?.message || "No se pudo guardar." });
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15,23,42,0.5)",
        zIndex: 9999,
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        padding: "3vh 16px",
        overflowY: "auto",
      }}
      onClick={(e) => { if (e.target === e.currentTarget && !guardando) onClose(); }}
    >
      <div style={{
        background: "var(--surface, #fff)",
        borderRadius: 12,
        padding: "20px 24px",
        width: "min(820px, 100%)",
        boxShadow: "0 20px 50px rgba(0,0,0,0.3)",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <h3 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>
            {editando ? "Editar Plantilla" : "Nueva Plantilla"}
          </h3>
          <button onClick={onClose} disabled={guardando} style={{ background: "transparent", border: "none", cursor: "pointer" }}>
            <X size={18} />
          </button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600 }}>Código *</label>
            <input
              type="text"
              className="input"
              value={codigo}
              onChange={(e) => setCodigo(e.target.value.replace(/\s/g, "_").toLowerCase())}
              disabled={editando}
              placeholder="ej: agradecer_adjudicacion"
            />
            {editando && (
              <p style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2 }}>El código no se puede cambiar.</p>
            )}
          </div>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600 }}>Nombre *</label>
            <input
              type="text"
              className="input"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              placeholder="ej: Agradecer adjudicación"
            />
          </div>
          <div style={{ gridColumn: "1 / -1" }}>
            <label style={{ fontSize: 12, fontWeight: 600 }}>Asunto *</label>
            <input
              type="text"
              className="input"
              value={asunto}
              onChange={(e) => setAsunto(e.target.value)}
              placeholder="Confirmación de adjudicación cotización {{id_cotizacion}}"
            />
          </div>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600 }}>Trigger *</label>
            <select className="input" value={trigger} onChange={(e) => setTrigger(e.target.value)}>
              {TRIGGERS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
            <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
              {TRIGGERS.find((t) => t.value === trigger)?.desc}
            </p>
          </div>
          {trigger === "proximo_vencer" ? (
            <div>
              <label style={{ fontSize: 12, fontWeight: 600 }}>Horas antes del cierre</label>
              <input type="number" className="input" value={horasAntes} onChange={(e) => setHorasAntes(e.target.value)} min={1} max={168} />
            </div>
          ) : (
            <div style={{ display: "flex", alignItems: "flex-end" }}>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                <input type="checkbox" checked={activo} onChange={(e) => setActivo(e.target.checked)} />
                <span style={{ fontSize: 13 }}>Activa</span>
              </label>
            </div>
          )}
          {trigger === "proximo_vencer" && (
            <div style={{ display: "flex", alignItems: "flex-end" }}>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                <input type="checkbox" checked={activo} onChange={(e) => setActivo(e.target.checked)} />
                <span style={{ fontSize: 13 }}>Activa</span>
              </label>
            </div>
          )}
        </div>

        {/* Variables disponibles */}
        <div style={{ marginBottom: 8 }}>
          <p style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>
            Variables que se reemplazan al enviar (haz clic para insertar):
          </p>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {Object.entries(VARIABLES_DEFAULT).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => insertarVariable(key)}
                style={{
                  fontSize: 11,
                  padding: "3px 10px",
                  background: "var(--bg, #f8fafc)",
                  border: "1px solid var(--border, #e2e8f0)",
                  borderRadius: 6,
                  cursor: "pointer",
                  fontFamily: "monospace",
                }}
                title={`Inserta {{${key}}} (${label})`}
              >
                {`{{${key}}}`}
              </button>
            ))}
          </div>
        </div>

        {/* Tabs editor */}
        <div style={{ display: "flex", gap: 4, marginBottom: 6 }}>
          <button
            type="button"
            onClick={() => setModoEditor("visual")}
            className={modoEditor === "visual" ? "btn btn-primary btn-sm" : "btn btn-ghost btn-sm"}
            style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
          >
            <Pencil size={12} /> Visual
          </button>
          <button
            type="button"
            onClick={() => setModoEditor("html")}
            className={modoEditor === "html" ? "btn btn-primary btn-sm" : "btn btn-ghost btn-sm"}
            style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
          >
            <Code2 size={12} /> HTML
          </button>
          <button
            type="button"
            onClick={() => setModoEditor("preview")}
            className={modoEditor === "preview" ? "btn btn-primary btn-sm" : "btn btn-ghost btn-sm"}
            style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
          >
            <Eye size={12} /> Preview
          </button>
        </div>

        {modoEditor === "visual" && (
          <EditorRichText value={cuerpoHtml} onChange={setCuerpoHtml} minHeight={220} />
        )}
        {modoEditor === "html" && (
          <textarea
            value={cuerpoHtml}
            onChange={(e) => setCuerpoHtml(e.target.value)}
            style={{
              width: "100%",
              minHeight: 240,
              fontFamily: "monospace",
              fontSize: 12,
              padding: 10,
              border: "1px solid var(--border, #e2e8f0)",
              borderRadius: 6,
              resize: "vertical",
            }}
            placeholder="<p>Tu HTML acá…</p>"
          />
        )}
        {modoEditor === "preview" && (
          <div
            style={{
              border: "1px solid var(--border, #e2e8f0)",
              borderRadius: 6,
              padding: "14px 16px",
              minHeight: 240,
              background: "#fff",
            }}
            dangerouslySetInnerHTML={{ __html: cuerpoHtml || "<em style='color:#94a3b8'>Vista previa vacía</em>" }}
          />
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 18 }}>
          <button className="btn btn-ghost btn-sm" onClick={onClose} disabled={guardando}>Cancelar</button>
          <button className="btn btn-primary btn-sm" onClick={guardar} disabled={guardando}>
            {guardando ? "Guardando…" : (editando ? "Actualizar" : "Crear")}
          </button>
        </div>
      </div>
    </div>
  );
}
