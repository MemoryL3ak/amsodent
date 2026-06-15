import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Mail, X, Send, Paperclip, Loader2 } from "lucide-react";
import { api } from "../lib/api";

// Editor de correo transaccional (Fase 1 del sistema de correos).
// Carga la plantilla pre-armada desde el backend; el vendedor puede ajustar
// destinatario y asunto, ve el cuerpo HTML pro en una vista previa, y envía.

const TITULOS = {
  oc_agradecimiento: "Correo de agradecimiento",
  guia_despacho_enviar: "Envío de guía de despacho",
};

export default function CorreoComposer({
  tipo,
  licitacionId,
  documentoId,
  onClose,
  onSent,
}) {
  const [cargando, setCargando] = useState(true);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState("");
  const [enviado, setEnviado] = useState(false);

  const [para, setPara] = useState("");
  const [cc, setCc] = useState("");
  const [asunto, setAsunto] = useState("");
  const [cuerpoHtml, setCuerpoHtml] = useState("");
  const [replyTo, setReplyTo] = useState("");
  const [de, setDe] = useState("");
  const [modoEnvio, setModoEnvio] = useState("smtp");
  const [adjuntarDocumentoId, setAdjuntarDocumentoId] = useState(null);
  // Archivos adicionales que adjunta el usuario: { filename, mime, size, contentBase64 }.
  const [adjuntos, setAdjuntos] = useState([]);

  const MAX_ADJUNTO = 10 * 1024 * 1024; // 10 MB por archivo

  function archivoABase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const res = String(reader.result || "");
        resolve(res.includes(",") ? res.split(",")[1] : res);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  async function onElegirArchivos(e) {
    const files = Array.from(e.target.files || []);
    e.target.value = ""; // permite re-seleccionar el mismo archivo
    for (const f of files) {
      if (f.size > MAX_ADJUNTO) {
        setError(`"${f.name}" supera el límite de 10 MB.`);
        continue;
      }
      try {
        const contentBase64 = await archivoABase64(f);
        setAdjuntos((prev) => [
          ...prev,
          { filename: f.name, mime: f.type || "application/octet-stream", size: f.size, contentBase64 },
        ]);
      } catch {
        setError(`No se pudo leer "${f.name}".`);
      }
    }
  }

  function quitarAdjunto(idx) {
    setAdjuntos((prev) => prev.filter((_, i) => i !== idx));
  }

  useEffect(() => {
    let activo = true;
    async function cargar() {
      setCargando(true);
      setError("");
      try {
        const r = await api.get(
          `/correos/plantilla?tipo=${encodeURIComponent(tipo)}` +
            `&licitacionId=${encodeURIComponent(licitacionId)}` +
            `&documentoId=${encodeURIComponent(documentoId)}`,
        );
        if (!activo) return;
        setPara(r?.para || "");
        // Copia por defecto sugerida por el backend (ventas@/admin@). Editable.
        setCc((Array.isArray(r?.cc) ? r.cc : []).join(", "));
        setAsunto(r?.asunto || "");
        setCuerpoHtml(r?.cuerpoHtml || "");
        setReplyTo(r?.replyTo || "");
        setDe(r?.de || "");
        setModoEnvio(r?.modoEnvio || "smtp");
        setAdjuntarDocumentoId(r?.adjuntarDocumentoId ?? null);
      } catch (e) {
        if (activo) setError(e?.message || "No se pudo cargar la plantilla del correo.");
      } finally {
        if (activo) setCargando(false);
      }
    }
    cargar();
    return () => {
      activo = false;
    };
  }, [tipo, licitacionId, documentoId]);

  async function enviar() {
    setError("");
    const destinatario = (para || "").trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(destinatario)) {
      setError("Ingresa un correo de destinatario válido.");
      return;
    }
    if (!(asunto || "").trim()) {
      setError("El asunto no puede estar vacío.");
      return;
    }
    // "Copia a": separa por coma, punto y coma o espacios y valida cada correo.
    const ccLista = (cc || "")
      .split(/[,;\s]+/)
      .map((e) => e.trim())
      .filter(Boolean);
    const ccInvalido = ccLista.find((e) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
    if (ccInvalido) {
      setError(`Hay un correo inválido en "Copia a": ${ccInvalido}`);
      return;
    }
    setEnviando(true);
    try {
      await api.post("/correos/enviar", {
        licitacionId,
        para: destinatario,
        cc: ccLista,
        asunto: asunto.trim(),
        cuerpoHtml,
        adjuntarDocumentoId: adjuntarDocumentoId ?? null,
        adjuntos: adjuntos.map((a) => ({
          filename: a.filename,
          contentBase64: a.contentBase64,
          mime: a.mime,
        })),
      });
      setEnviado(true);
      if (onSent) onSent();
    } catch (e) {
      setError(e?.message || "No se pudo enviar el correo.");
    } finally {
      setEnviando(false);
    }
  }

  const overlay = (
    <div
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !enviando) onClose?.();
      }}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15,23,42,.55)",
        zIndex: 11000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
    >
      <div
        style={{
          width: 640,
          maxWidth: "100%",
          maxHeight: "92vh",
          background: "#fff",
          borderRadius: 14,
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 24px 64px rgba(15,23,42,.32)",
        }}
      >
        <style>{"@keyframes cc-spin{to{transform:rotate(360deg)}}"}</style>
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "14px 18px",
            background: "linear-gradient(135deg, var(--primary) 0%, var(--primary-dark) 100%)",
            color: "#fff",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700 }}>
            <Mail size={18} />
            {TITULOS[tipo] || "Enviar correo"}
          </div>
          <button
            type="button"
            onClick={() => !enviando && onClose?.()}
            style={{
              background: "transparent",
              border: "none",
              color: "#fff",
              cursor: enviando ? "default" : "pointer",
              padding: 4,
              display: "inline-flex",
            }}
            title="Cerrar"
          >
            <X size={18} />
          </button>
        </div>

        {/* Cuerpo */}
        <div style={{ padding: 18, overflowY: "auto" }}>
          {cargando ? (
            <div style={{ padding: 40, textAlign: "center", color: "#64748b" }}>
              <Loader2 size={22} style={{ animation: "cc-spin 1s linear infinite" }} /> Cargando plantilla…
            </div>
          ) : enviado ? (
            <div style={{ padding: 30, textAlign: "center" }}>
              <div style={{ fontSize: 40 }}>✅</div>
              <p style={{ fontWeight: 700, color: "#0f172a", margin: "8px 0 4px" }}>
                Correo enviado correctamente
              </p>
              <p style={{ color: "#64748b", fontSize: 14, margin: 0 }}>
                Se envió a {para}.
              </p>
            </div>
          ) : (
            <>
              <Campo etiqueta="De (cuenta que envía)">
                <div style={readonlyStyle}>
                  <span style={{ fontSize: 15 }}>📤</span>
                  <span style={{ fontWeight: 600, color: "#0f172a" }}>
                    {de || "Cuenta de correo AMSODENT"}
                  </span>
                </div>
                {modoEnvio === "gmail" ? (
                  <p style={{ fontSize: 12, color: "var(--primary-dark)", margin: "5px 0 0" }}>
                    Se enviará desde la casilla del vendedor; las respuestas del cliente le llegarán directamente.
                  </p>
                ) : (
                  <p style={{ fontSize: 12, color: "#b45309", margin: "5px 0 0" }}>
                    El vendedor aún no conectó su cuenta de correo (puede hacerlo en{" "}
                    <strong>Mi Correo</strong>). Por ahora el correo sale desde la cuenta
                    compartida
                    {replyTo ? (
                      <> — las respuestas del cliente llegarán a <strong>{replyTo}</strong></>
                    ) : null}
                    .
                  </p>
                )}
              </Campo>
              <Campo etiqueta="Para (destinatario)">
                <input
                  type="email"
                  value={para}
                  onChange={(e) => setPara(e.target.value)}
                  placeholder="correo@cliente.cl"
                  style={inputStyle}
                />
              </Campo>
              <Campo etiqueta="Copia a (CC) — opcional">
                <input
                  type="text"
                  value={cc}
                  onChange={(e) => setCc(e.target.value)}
                  placeholder="copia1@correo.cl, copia2@correo.cl"
                  style={inputStyle}
                />
              </Campo>
              <Campo etiqueta="Asunto">
                <input
                  type="text"
                  value={asunto}
                  onChange={(e) => setAsunto(e.target.value)}
                  style={inputStyle}
                />
              </Campo>
              {adjuntarDocumentoId ? (
                <p
                  style={{
                    fontSize: 13,
                    color: "var(--primary-dark)",
                    margin: "0 0 10px",
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
                  <Paperclip size={14} /> Se adjuntará el PDF del documento.
                </p>
              ) : null}

              {/* Adjuntos adicionales (cualquier archivo) */}
              <Campo etiqueta="Adjuntos adicionales — opcional">
                <label style={adjuntarBtnStyle}>
                  <Paperclip size={14} /> Agregar archivos
                  <input
                    type="file"
                    multiple
                    onChange={onElegirArchivos}
                    style={{ display: "none" }}
                  />
                </label>
                {adjuntos.length > 0 && (
                  <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
                    {adjuntos.map((a, i) => (
                      <div key={i} style={adjuntoFilaStyle}>
                        <span
                          style={{
                            fontSize: 13,
                            color: "#0f172a",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          📎 {a.filename}{" "}
                          <span style={{ color: "#94a3b8", fontSize: 11 }}>({fmtTamano(a.size)})</span>
                        </span>
                        <button
                          type="button"
                          onClick={() => quitarAdjunto(i)}
                          title="Quitar"
                          style={{
                            background: "transparent",
                            border: "none",
                            color: "#ef4444",
                            cursor: "pointer",
                            display: "inline-flex",
                            padding: 2,
                          }}
                        >
                          <X size={15} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </Campo>

              <div style={{ fontSize: 12, color: "#64748b", margin: "4px 0 6px", fontWeight: 600 }}>
                Vista previa del correo
              </div>
              <iframe
                title="Vista previa del correo"
                srcDoc={cuerpoHtml}
                sandbox=""
                style={{
                  width: "100%",
                  height: 320,
                  border: "1px solid #e5e7eb",
                  borderRadius: 10,
                  background: "#f1f5f9",
                }}
              />

              {error && (
                <div
                  style={{
                    marginTop: 12,
                    padding: "8px 12px",
                    background: "#fef2f2",
                    border: "1px solid #fecaca",
                    color: "#b91c1c",
                    borderRadius: 8,
                    fontSize: 13,
                  }}
                >
                  {error}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        {!enviado && !cargando && (
          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              gap: 10,
              padding: "12px 18px",
              borderTop: "1px solid #e5e7eb",
              background: "#f8fafc",
            }}
          >
            <button
              type="button"
              onClick={() => !enviando && onClose?.()}
              disabled={enviando}
              style={{
                padding: "9px 16px",
                borderRadius: 8,
                border: "1px solid #cbd5e1",
                background: "#fff",
                color: "#334155",
                fontWeight: 600,
                cursor: enviando ? "default" : "pointer",
              }}
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={enviar}
              disabled={enviando}
              style={{
                padding: "9px 18px",
                borderRadius: 8,
                border: "none",
                background: enviando ? "#94a3b8" : "linear-gradient(135deg, var(--primary) 0%, var(--primary-dark) 100%)",
                color: "#fff",
                fontWeight: 700,
                cursor: enviando ? "default" : "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              {enviando ? <Loader2 size={15} style={{ animation: "cc-spin 1s linear infinite" }} /> : <Send size={15} />}
              {enviando ? "Enviando…" : "Enviar correo"}
            </button>
          </div>
        )}
        {enviado && (
          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              padding: "12px 18px",
              borderTop: "1px solid #e5e7eb",
              background: "#f8fafc",
            }}
          >
            <button
              type="button"
              onClick={() => onClose?.()}
              style={{
                padding: "9px 18px",
                borderRadius: 8,
                border: "none",
                background: "linear-gradient(135deg, var(--primary) 0%, var(--primary-dark) 100%)",
                color: "#fff",
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              Listo
            </button>
          </div>
        )}
      </div>
    </div>
  );

  return createPortal(overlay, document.body);
}

const inputStyle = {
  width: "100%",
  padding: "9px 11px",
  borderRadius: 8,
  border: "1px solid #cbd5e1",
  fontSize: 14,
  color: "#0f172a",
  outline: "none",
  boxSizing: "border-box",
};

const adjuntarBtnStyle = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "7px 12px",
  borderRadius: 8,
  border: "1px dashed #94a3b8",
  background: "#f8fafc",
  color: "#334155",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
};

const adjuntoFilaStyle = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 8,
  padding: "6px 10px",
  borderRadius: 8,
  border: "1px solid #e2e8f0",
  background: "#fff",
};

function fmtTamano(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

const readonlyStyle = {
  width: "100%",
  padding: "9px 11px",
  borderRadius: 8,
  border: "1px solid #e2e8f0",
  background: "#f8fafc",
  fontSize: 14,
  boxSizing: "border-box",
  display: "flex",
  alignItems: "center",
  gap: 8,
};

function Campo({ etiqueta, children }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <label
        style={{
          display: "block",
          fontSize: 12,
          fontWeight: 700,
          color: "#475569",
          marginBottom: 4,
        }}
      >
        {etiqueta}
      </label>
      {children}
    </div>
  );
}
