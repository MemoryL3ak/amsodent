import { useEffect, useMemo, useState } from "react";
import { X, Paperclip, Trash2, Send, Clock, AlertTriangle } from "lucide-react";
import { api } from "../lib/api";
import EditorRichText from "./EditorRichText";

const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_TOTAL_BYTES = 20 * 1024 * 1024; // Gmail/SMTP soporta hasta 25MB; dejamos margen.

// Plantilla "blank" siempre disponible. Las demás se cargan de la BD.
const PLANTILLA_BLANK = {
  id: "blank",
  codigo: "blank",
  nombre: "(Mensaje en blanco)",
  asunto: "",
  cuerpo_html: "",
};

// Reemplaza variables {{var}} en un string usando un mapa.
function aplicarVariables(texto, vars) {
  if (!texto) return "";
  return texto.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, key) => {
    return vars?.[key] != null ? String(vars[key]) : "";
  });
}

export default function ModalNuevoCorreo({
  open,
  onClose,
  licitacion, // { id, id_licitacion, nombre_entidad, email, total_con_iva, ... }
  onEnviado,
  onToast,
}) {
  const [para, setPara] = useState("");
  const [cc, setCc] = useState("");
  const [bcc, setBcc] = useState("");
  const [asunto, setAsunto] = useState("");
  const [cuerpoHtml, setCuerpoHtml] = useState("");
  const [adjuntos, setAdjuntos] = useState([]);
  const [enviando, setEnviando] = useState(false);
  const [plantillaId, setPlantillaId] = useState("blank");
  const [plantillas, setPlantillas] = useState([PLANTILLA_BLANK]);
  const [mostrarProgramar, setMostrarProgramar] = useState(false);
  const [programadoPara, setProgramadoPara] = useState("");

  // Variables disponibles para sustitución en plantillas.
  const variables = useMemo(
    () => ({
      id_cotizacion: licitacion?.id_licitacion || "",
      nombre_entidad: licitacion?.nombre_entidad || "",
      total: licitacion?.total_con_iva || licitacion?.total_sin_iva || "",
    }),
    [licitacion],
  );

  // Cargar plantillas desde BD (incluye solo las que tienen 'trigger=manual' y activas
  // para no contaminar el dropdown con plantillas automáticas).
  useEffect(() => {
    if (!open) return;
    let cancel = false;
    (async () => {
      try {
        const data = await api.get("/plantillas-correo");
        if (cancel) return;
        const manuales = (data || [])
          .filter((p) => p.trigger === "manual" && p.activo)
          .map((p) => ({ id: p.codigo, codigo: p.codigo, nombre: p.nombre, asunto: p.asunto, cuerpo_html: p.cuerpo_html }));
        setPlantillas([PLANTILLA_BLANK, ...manuales]);
      } catch (e) {
        // Si falla, mantenemos al menos "blank" y el usuario igual puede escribir libre.
        console.warn("No se pudieron cargar plantillas:", e);
      }
    })();
    return () => { cancel = true; };
  }, [open]);

  // Al abrir: prellenamos "Para" con el email de la entidad si existe.
  useEffect(() => {
    if (!open) return;
    const emailEntidad = (licitacion?.email || "").trim();
    if (emailEntidad && EMAIL_RX.test(emailEntidad)) {
      setPara(emailEntidad);
    }
    aplicarPlantilla("blank");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, licitacion?.id]);

  function aplicarPlantilla(id) {
    const p = plantillas.find((x) => x.id === id) || PLANTILLA_BLANK;
    setPlantillaId(p.id);
    setAsunto(aplicarVariables(p.asunto, variables));
    setCuerpoHtml(aplicarVariables(p.cuerpo_html, variables));
  }

  function agregarArchivos(fileList) {
    const arr = Array.from(fileList || []);
    const next = [...adjuntos, ...arr];
    const total = next.reduce((s, f) => s + (f.size || 0), 0);
    if (total > MAX_TOTAL_BYTES) {
      onToast?.({
        type: "error",
        message: `Los adjuntos superan ${Math.round(MAX_TOTAL_BYTES / 1024 / 1024)}MB en total.`,
      });
      return;
    }
    setAdjuntos(next);
  }

  function quitarAdjunto(idx) {
    setAdjuntos((prev) => prev.filter((_, i) => i !== idx));
  }

  async function enviar() {
    if (!asunto.trim()) {
      onToast?.({ type: "error", message: "El asunto es obligatorio." });
      return;
    }
    const paraList = parseEmailList(para);
    if (paraList.length === 0) {
      onToast?.({ type: "error", message: "Debes indicar al menos un destinatario en Para." });
      return;
    }

    // Si el cuerpo está vacío (solo etiquetas HTML), avisamos.
    const textoCuerpo = cuerpoHtml.replace(/<[^>]*>/g, "").trim();
    if (!textoCuerpo) {
      onToast?.({ type: "error", message: "El cuerpo del correo no puede ir vacío." });
      return;
    }

    setEnviando(true);
    try {
      const formData = new FormData();
      formData.append("para", paraList.join(","));
      if (cc.trim()) formData.append("cc", parseEmailList(cc).join(","));
      if (bcc.trim()) formData.append("bcc", parseEmailList(bcc).join(","));
      formData.append("asunto", asunto);
      formData.append("cuerpo_html", cuerpoHtml);
      formData.append("cuerpo_texto", textoCuerpo);
      if (plantillaId && plantillaId !== "blank") {
        // Ahora pasamos el código de la plantilla (string), no un id numérico.
        formData.append("plantilla_codigo", plantillaId);
      }
      if (mostrarProgramar && programadoPara) {
        formData.append("programado_para", new Date(programadoPara).toISOString());
      }
      adjuntos.forEach((f) => formData.append("files", f, f.name));

      const r = await api.postForm(`/cotizaciones/${licitacion.id}/comunicaciones`, formData);

      const esProgramado = r?.estado === "programado";
      onToast?.({
        type: "success",
        message: esProgramado
          ? "Correo programado correctamente."
          : "Correo enviado correctamente.",
      });
      onEnviado?.();
      onClose?.();
    } catch (e) {
      console.error(e);
      onToast?.({
        type: "error",
        message: `No se pudo enviar el correo: ${e?.message || "error desconocido"}`,
      });
    } finally {
      setEnviando(false);
    }
  }

  if (!open) return null;

  const totalBytes = adjuntos.reduce((s, f) => s + (f.size || 0), 0);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15,23,42,0.45)",
        zIndex: 9999,
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        padding: "5vh 16px",
        overflowY: "auto",
        // pointer-events: auto explícito porque el modal puede vivir dentro
        // del drawer de Comunicaciones (que tiene pointer-events: none en su
        // wrapper) — sin esto los clics no llegarían al modal.
        pointerEvents: "auto",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !enviando) onClose?.();
      }}
    >
      <div
        style={{
          background: "var(--surface)",
          borderRadius: 12,
          width: "100%",
          maxWidth: 760,
          boxShadow: "0 24px 60px rgba(15,23,42,0.25)",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "14px 18px",
            borderBottom: "1px solid var(--border)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ fontWeight: 700, fontSize: 16, color: "var(--text)" }}>
            Nuevo correo · Cotización {licitacion?.id_licitacion}
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => !enviando && onClose?.()}
            disabled={enviando}
            aria-label="Cerrar"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: 18, display: "flex", flexDirection: "column", gap: 12 }}>
          {/* Plantilla */}
          <div className="field">
            <label className="field-label">Plantilla</label>
            <select
              className="input"
              value={plantillaId}
              onChange={(e) => aplicarPlantilla(e.target.value)}
              disabled={enviando}
            >
              {plantillas.map((p) => (
                <option key={p.id} value={p.id}>{p.nombre}</option>
              ))}
            </select>
            <p style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 4 }}>
              La plantilla se aplica al instante; puedes editar libremente lo que se cargó.
              Variables soportadas: {"{{id_cotizacion}}, {{nombre_entidad}}, {{total}}"}.
            </p>
          </div>

          {/* Destinatarios */}
          <div className="field">
            <label className="field-label">Para *</label>
            <input
              className="input"
              placeholder="correo@cliente.cl, otro@cliente.cl"
              value={para}
              onChange={(e) => setPara(e.target.value)}
              disabled={enviando}
            />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div className="field">
              <label className="field-label">CC</label>
              <input
                className="input"
                placeholder="(opcional)"
                value={cc}
                onChange={(e) => setCc(e.target.value)}
                disabled={enviando}
              />
            </div>
            <div className="field">
              <label className="field-label">CCO</label>
              <input
                className="input"
                placeholder="(opcional)"
                value={bcc}
                onChange={(e) => setBcc(e.target.value)}
                disabled={enviando}
              />
            </div>
          </div>

          {/* Asunto */}
          <div className="field">
            <label className="field-label">Asunto *</label>
            <input
              className="input"
              value={asunto}
              onChange={(e) => setAsunto(e.target.value)}
              disabled={enviando}
            />
          </div>

          {/* Cuerpo */}
          <div className="field">
            <label className="field-label">Mensaje *</label>
            <EditorRichText
              value={cuerpoHtml}
              onChange={setCuerpoHtml}
              minHeight={200}
              placeholder="Escribe el mensaje al cliente…"
            />
          </div>

          {/* Adjuntos */}
          <div className="field">
            <label className="field-label" style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Paperclip size={14} /> Adjuntos
              <span style={{ fontWeight: 400, color: "var(--text-muted)", fontSize: 11.5 }}>
                ({(totalBytes / 1024 / 1024).toFixed(2)} MB)
              </span>
            </label>
            <input
              type="file"
              multiple
              onChange={(e) => agregarArchivos(e.target.files)}
              disabled={enviando}
              style={{ fontSize: 13 }}
            />
            {adjuntos.length > 0 && (
              <ul style={{ marginTop: 8, paddingLeft: 0, listStyle: "none" }}>
                {adjuntos.map((f, i) => (
                  <li
                    key={i}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "4px 0",
                      fontSize: 13,
                      color: "var(--text)",
                    }}
                  >
                    <Paperclip size={12} />
                    <span style={{ flex: 1 }}>{f.name}</span>
                    <span style={{ color: "var(--text-muted)", fontSize: 12 }}>
                      {(f.size / 1024).toFixed(1)} KB
                    </span>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => quitarAdjunto(i)}
                      disabled={enviando}
                      title="Quitar adjunto"
                    >
                      <Trash2 size={12} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Programar */}
          <div>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13 }}>
              <input
                type="checkbox"
                checked={mostrarProgramar}
                onChange={(e) => setMostrarProgramar(e.target.checked)}
                disabled={enviando}
              />
              <Clock size={13} /> Programar envío para más tarde
            </label>
            {mostrarProgramar && (
              <div style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 10 }}>
                <input
                  type="datetime-local"
                  className="input"
                  value={programadoPara}
                  onChange={(e) => setProgramadoPara(e.target.value)}
                  disabled={enviando}
                  style={{ maxWidth: 240 }}
                />
                {adjuntos.length > 0 && (
                  <span style={{ fontSize: 11.5, color: "#b45309", display: "inline-flex", alignItems: "center", gap: 4 }}>
                    <AlertTriangle size={12} /> Los programados todavía no soportan adjuntos.
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            padding: "12px 18px",
            borderTop: "1px solid var(--border)",
            background: "var(--bg)",
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            gap: 8,
          }}
        >
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onClose}
            disabled={enviando}
          >
            Cancelar
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={enviar}
            disabled={enviando}
            style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
          >
            {mostrarProgramar && programadoPara ? <Clock size={14} /> : <Send size={14} />}
            {enviando
              ? "Enviando…"
              : mostrarProgramar && programadoPara
                ? "Programar"
                : "Enviar"}
          </button>
        </div>
      </div>
    </div>
  );
}

function parseEmailList(input) {
  return String(input || "")
    .split(/[,;\s]+/)
    .map((e) => e.trim().toLowerCase())
    .filter((e) => EMAIL_RX.test(e));
}
