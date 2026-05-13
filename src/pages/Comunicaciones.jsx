import { useEffect, useMemo, useRef, useState } from "react";
import { Send, Mail, MailOpen, AlertTriangle, Trash2, Image as ImageIcon, FileUp, Paperclip, Download, Gift, History, ChevronLeft, RefreshCw, CheckCircle2, Clock, XCircle } from "lucide-react";
import { api } from "../lib/api";
import Toast from "../components/Toast";
import { pdfPageToPngBlob, pdfPageToInteractive, blobToDataUrl } from "../utils/pdfToImage";

const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_FLYER_BYTES = 4 * 1024 * 1024; // 4MB después de convertir a PNG

export default function Comunicaciones() {
  const [tab, setTab] = useState("componer"); // "componer" | "historial"

  const [asunto, setAsunto] = useState("");
  const [cuerpo, setCuerpo] = useState("");
  const [remitenteNombre, setRemitenteNombre] = useState("");
  const [destinatariosStr, setDestinatariosStr] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [toast, setToast] = useState(null);
  const [resumen, setResumen] = useState(null);

  // Si está en true → envío individual con tracking pixel por destinatario (lento, ~3 min para 256).
  // Si está en false → envío rápido en BCC sin saber quién abrió (~30 seg para 256).
  const [conTracking, setConTracking] = useState(true);

  // Modo de envío del archivo:
  //   "imagen"           → PDF/imagen → PNG inline (fidelidad pixel-perfect, no seleccionable)
  //   "html_enriquecido" → PDF → PNG + capa de texto invisible posicionada (selectable)
  //   "adjunto_pdf"      → PDF tal cual como adjunto descargable (cuerpo separado)
  const [flyerModo, setFlyerModo] = useState("imagen");

  // Estado del archivo subido. Para los modos "imagen" y "html_enriquecido"
  // guardamos el PNG renderizado; para "adjunto_pdf" guardamos el PDF crudo.
  const [flyerBlob, setFlyerBlob] = useState(null);          // Blob que se envía (PNG o PDF según modo)
  const [flyerOriginalFile, setFlyerOriginalFile] = useState(null); // archivo original (para reprocesar al cambiar modo)
  const [flyerNombre, setFlyerNombre] = useState("");
  const [flyerPreview, setFlyerPreview] = useState("");
  const [flyerHtml, setFlyerHtml] = useState("");            // HTML que ya incluye CID + overlays
  const [flyerLinksCount, setFlyerLinksCount] = useState(0); // hipervínculos detectados en el PDF
  const [flyerPosicion, setFlyerPosicion] = useState("arriba");
  const [procesandoFlyer, setProcesandoFlyer] = useState(false);
  const flyerInputRef = useRef(null);

  // Importador de correos desde otras secciones (Sorteo, etc.)
  const [importerOpen, setImporterOpen] = useState(false);
  const [importerLoading, setImporterLoading] = useState(false);
  const [importerSoloAceptaron, setImporterSoloAceptaron] = useState(true);
  const [importerTipoPerfil, setImporterTipoPerfil] = useState(""); // "" | "estudiante" | "egresado"

  async function importarCorreosSorteo() {
    setImporterLoading(true);
    try {
      const participantes = await api.get("/sorteo/participantes");
      let lista = Array.isArray(participantes) ? participantes : [];

      if (importerSoloAceptaron) {
        lista = lista.filter((p) => Boolean(p?.acepta_comunicaciones));
      }
      if (importerTipoPerfil === "estudiante" || importerTipoPerfil === "egresado") {
        lista = lista.filter((p) => p?.tipo_perfil === importerTipoPerfil);
      }

      const correos = lista
        .map((p) => String(p?.email || "").trim().toLowerCase())
        .filter((e) => EMAIL_RX.test(e));

      const yaPresentes = new Set(
        destinatariosStr
          .split(/[\s,;\n]+/)
          .map((t) => t.trim().toLowerCase())
          .filter(Boolean)
      );
      const nuevos = correos.filter((e) => !yaPresentes.has(e));

      if (nuevos.length === 0) {
        setToast({
          type: "info",
          message:
            correos.length === 0
              ? "No hay correos que coincidan con los filtros."
              : "Todos los correos ya estaban en la lista.",
        });
        return;
      }

      const sep = destinatariosStr && !destinatariosStr.endsWith("\n") ? "\n" : "";
      setDestinatariosStr((prev) => `${prev}${sep}${nuevos.join("\n")}`);
      setImporterOpen(false);
      setToast({
        type: "success",
        message: `${nuevos.length} correo${nuevos.length === 1 ? "" : "s"} agregado${nuevos.length === 1 ? "" : "s"} desde Sorteo${
          correos.length !== nuevos.length ? ` (${correos.length - nuevos.length} ya estaban)` : ""
        }.`,
      });
    } catch (e) {
      setToast({ type: "error", message: e?.message || "No se pudieron cargar los participantes." });
    } finally {
      setImporterLoading(false);
    }
  }

  async function procesarSegunModo(file, modo) {
    if (!file) return;
    const tipo = (file.type || "").toLowerCase();
    const esPdf = tipo === "application/pdf" || /\.pdf$/i.test(file.name);
    const esImagen = tipo.startsWith("image/");

    setProcesandoFlyer(true);
    try {
      // ── Modo imagen: PDF→PNG (página 1) + overlays de links, o imagen tal cual
      if (modo === "imagen") {
        if (esPdf) {
          // Render alta calidad + overlays <a> transparentes para preservar links del PDF
          const result = await pdfPageToInteractive(file, { pagina: 1, displayWidth: 700 });
          if (result.pngBlob.size > MAX_FLYER_BYTES) {
            setToast({
              type: "warning",
              message: `El archivo pesa ${(result.pngBlob.size / 1024 / 1024).toFixed(1)} MB. Se envía igual, pero correos >5MB pueden caer en spam.`,
            });
          }
          const dataUrl = await blobToDataUrl(result.pngBlob);
          setFlyerBlob(result.pngBlob);
          setFlyerNombre(file.name.replace(/\.pdf$/i, "") + ".png");
          setFlyerPreview(dataUrl);
          setFlyerHtml(result.htmlSimple); // <img> + overlays <a>
          setFlyerLinksCount(result.linksCount);
          return;
        }
        if (!esImagen) {
          setToast({ type: "error", message: "Sube una imagen (PNG/JPG) o un PDF." });
          return;
        }
        // Imagen subida directa: sin overlays (no hay metadata de links)
        if (file.size > MAX_FLYER_BYTES) {
          setToast({
            type: "warning",
            message: `La imagen pesa ${(file.size / 1024 / 1024).toFixed(1)} MB. Se envía igual, pero correos >5MB pueden caer en spam.`,
          });
        }
        const dataUrl = await blobToDataUrl(file);
        setFlyerBlob(file);
        setFlyerNombre(file.name);
        setFlyerPreview(dataUrl);
        setFlyerHtml("");
        setFlyerLinksCount(0);
        return;
      }

      // ── Modo HTML enriquecido: requiere PDF ──────────────────────────────
      if (modo === "html_enriquecido") {
        if (!esPdf) {
          setToast({ type: "error", message: "El modo HTML enriquecido sólo funciona con PDF." });
          return;
        }
        const result = await pdfPageToInteractive(file, { pagina: 1, displayWidth: 700 });
        const dataUrl = await blobToDataUrl(result.pngBlob);
        setFlyerBlob(result.pngBlob);
        setFlyerNombre(file.name.replace(/\.pdf$/i, "") + " (HTML)");
        setFlyerPreview(dataUrl);
        setFlyerHtml(result.htmlRico); // <img> + texto invisible + overlays <a>
        setFlyerLinksCount(result.linksCount);
        return;
      }

      // ── Modo adjunto: el archivo viaja como attachment descargable ───────
      if (modo === "adjunto_pdf") {
        if (!esPdf) {
          setToast({ type: "error", message: "El modo Adjunto PDF requiere un archivo PDF." });
          return;
        }
        let dataUrl = "";
        try {
          const previewBlob = await pdfPageToPngBlob(file, { pagina: 1, escala: 1.0 });
          dataUrl = await blobToDataUrl(previewBlob);
        } catch {
          // sin preview no es crítico
        }
        setFlyerBlob(file); // PDF crudo
        setFlyerNombre(file.name);
        setFlyerPreview(dataUrl);
        setFlyerHtml("");
        setFlyerLinksCount(0); // los links viven en el PDF, no como overlay
        return;
      }
    } catch (e) {
      console.error("Error procesando archivo:", e);
      setToast({ type: "error", message: e?.message || "No se pudo procesar el archivo." });
    } finally {
      setProcesandoFlyer(false);
    }
  }

  async function handleFlyerFile(file) {
    if (!file) return;
    setFlyerOriginalFile(file);
    await procesarSegunModo(file, flyerModo);
  }

  async function cambiarModo(nuevoModo) {
    setFlyerModo(nuevoModo);
    if (flyerOriginalFile) {
      await procesarSegunModo(flyerOriginalFile, nuevoModo);
    }
  }

  function quitarFlyer() {
    setFlyerBlob(null);
    setFlyerOriginalFile(null);
    setFlyerNombre("");
    setFlyerPreview("");
    setFlyerHtml("");
    setFlyerLinksCount(0);
    if (flyerInputRef.current) flyerInputRef.current.value = "";
  }

  const { validos, invalidos } = useMemo(() => {
    const tokens = destinatariosStr
      .split(/[\s,;\n]+/)
      .map((t) => t.trim())
      .filter(Boolean);
    const valSet = new Set();
    const inv = [];
    tokens.forEach((t) => {
      const lower = t.toLowerCase();
      if (EMAIL_RX.test(lower)) valSet.add(lower);
      else inv.push(t);
    });
    return { validos: Array.from(valSet), invalidos: inv };
  }, [destinatariosStr]);

  function quitarDestinatario(email) {
    const restante = destinatariosStr
      .split(/[\s,;\n]+/)
      .filter((t) => t.trim().toLowerCase() !== email.toLowerCase())
      .join("\n");
    setDestinatariosStr(restante);
  }

  function limpiarInvalidos() {
    setDestinatariosStr(validos.join("\n"));
  }

  async function enviar() {
    if (!asunto.trim()) return setToast({ type: "error", message: "Falta el asunto." });

    const flyerInline = flyerBlob && (flyerModo === "imagen" || flyerModo === "html_enriquecido");
    if (!cuerpo.trim() && !flyerInline) {
      return setToast({
        type: "error",
        message: flyerBlob && flyerModo === "adjunto_pdf"
          ? "Cuando el PDF va como adjunto, el cuerpo del correo es obligatorio."
          : "Falta el cuerpo del correo o un flyer inline.",
      });
    }
    if (validos.length === 0) return setToast({ type: "error", message: "Agregá al menos un destinatario válido." });

    setEnviando(true);
    setResumen(null);

    try {
      const cuerpoHtml = cuerpo
        ? cuerpo.includes("<")
          ? cuerpo
          : cuerpo
              .split(/\n\n+/)
              .map((p) => `<p>${p.replace(/\n/g, "<br/>")}</p>`)
              .join("")
        : "";

      let r;
      if (flyerBlob) {
        const fd = new FormData();
        fd.append("asunto", asunto);
        fd.append("destinatarios", JSON.stringify(validos));
        fd.append("conTracking", conTracking ? "true" : "false");
        if (remitenteNombre.trim()) fd.append("remitenteNombre", remitenteNombre.trim());

        if (flyerModo === "adjunto_pdf") {
          fd.append("cuerpoHtml", cuerpoHtml);
          fd.append("attachment", flyerBlob, flyerNombre || "documento.pdf");
        } else if (flyerHtml) {
          // Modos inline (imagen con PDF source o html_enriquecido):
          // el frontend ya construyó el HTML con CID + overlays de links.
          // Lo combinamos con el texto del usuario según posición.
          let htmlFinal;
          if (flyerPosicion === "abajo") {
            htmlFinal = `${cuerpoHtml || ""}<br/>${flyerHtml}`;
          } else {
            htmlFinal = `${flyerHtml}${cuerpoHtml ? `<br/>${cuerpoHtml}` : ""}`;
          }
          fd.append("cuerpoHtml", htmlFinal);
          fd.append("flyer", flyerBlob, flyerNombre || "flyer.png");
        } else {
          // Modo imagen con source = imagen subida directa (sin metadata de links).
          // Backend auto-inyecta el <img>.
          fd.append("cuerpoHtml", cuerpoHtml);
          fd.append("flyerPosicion", flyerPosicion);
          fd.append("flyer", flyerBlob, flyerNombre || "flyer.png");
        }
        r = await api.postForm("/mailings/custom", fd);
      } else {
        r = await api.post("/mailings/custom", {
          asunto,
          cuerpoHtml,
          destinatarios: validos,
          remitenteNombre: remitenteNombre.trim() || undefined,
          conTracking,
        });
      }

      setResumen(r);
      setToast({
        type: r?.fallidos > 0 ? "warning" : "success",
        message: `Enviados ${r?.enviados ?? 0} de ${r?.totalDestinatarios ?? validos.length}${
          r?.fallidos > 0 ? ` (${r.fallidos} fallidos)` : ""
        }.`,
      });
    } catch (e) {
      setToast({ type: "error", message: e?.message || "No se pudo enviar el correo." });
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="page">
      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}

      <div className="page-header">
        <div>
          <h1 className="page-title" style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Mail size={22} style={{ color: "var(--primary)" }} />
            Comunicaciones · Envío de correos
          </h1>
          <p className="page-subtitle">
            Envío de correos masivos con tracking de aperturas por destinatario.
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 4, borderBottom: "1px solid var(--border)", marginBottom: 16 }}>
        {[
          { value: "componer", label: "Componer", icon: Send },
          { value: "historial", label: "Historial", icon: History },
        ].map(({ value, label, icon: Icon }) => (
          <button
            key={value}
            type="button"
            onClick={() => setTab(value)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "10px 18px",
              border: "none",
              background: "transparent",
              borderBottom: tab === value ? "2px solid var(--primary)" : "2px solid transparent",
              color: tab === value ? "var(--primary-dark)" : "var(--text-muted)",
              fontWeight: tab === value ? 700 : 500,
              fontSize: 14,
              cursor: "pointer",
              marginBottom: -1,
            }}
          >
            <Icon size={14} />
            {label}
          </button>
        ))}
      </div>

      {tab === "historial" ? (
        <HistorialEnvios />
      ) : (
      <div className="surface">
        <div className="surface-body" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 16 }}>
            <div>
              <label className="filter-label">Asunto *</label>
              <input
                type="text"
                className="input"
                value={asunto}
                onChange={(e) => setAsunto(e.target.value)}
                placeholder="Asunto del correo"
                style={{ width: "100%" }}
                disabled={enviando}
              />
            </div>
            <div>
              <label className="filter-label">Remitente (nombre visible)</label>
              <input
                type="text"
                className="input"
                value={remitenteNombre}
                onChange={(e) => setRemitenteNombre(e.target.value)}
                placeholder="Por defecto: AMSODENT"
                style={{ width: "100%" }}
                disabled={enviando}
              />
            </div>
          </div>

          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
              <label className="filter-label" style={{ marginBottom: 0 }}>
                Destinatarios * <span style={{ fontWeight: 400, color: "var(--text-soft)" }}>(separados por coma, espacio o salto de línea)</span>
              </label>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setImporterOpen((v) => !v)}
                disabled={enviando}
                style={{ fontSize: 12 }}
              >
                <Download size={13} />
                Importar de Sorteo
              </button>
            </div>

            {importerOpen && (
              <div
                style={{
                  background: "var(--bg)",
                  border: "1px solid var(--border)",
                  borderRadius: 10,
                  padding: 12,
                  marginBottom: 8,
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, fontWeight: 600, color: "var(--text)" }}>
                  <Gift size={14} style={{ color: "var(--primary)" }} />
                  Importar correos desde Sorteo
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
                    <input
                      type="checkbox"
                      checked={importerSoloAceptaron}
                      onChange={(e) => setImporterSoloAceptaron(e.target.checked)}
                    />
                    Sólo los que aceptaron comunicaciones
                  </label>
                  <div>
                    <label className="filter-label" style={{ fontSize: 11, marginBottom: 2 }}>Tipo de perfil</label>
                    <select
                      className="input"
                      value={importerTipoPerfil}
                      onChange={(e) => setImporterTipoPerfil(e.target.value)}
                      style={{ width: "100%", fontSize: 12 }}
                    >
                      <option value="">Todos</option>
                      <option value="estudiante">Estudiantes</option>
                      <option value="egresado">Egresados</option>
                    </select>
                  </div>
                </div>

                <div style={{ display: "flex", justifyContent: "flex-end", gap: 6 }}>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => setImporterOpen(false)}
                    disabled={importerLoading}
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={importarCorreosSorteo}
                    disabled={importerLoading}
                  >
                    {importerLoading ? "Cargando…" : "Agregar a la lista"}
                  </button>
                </div>
                <div style={{ fontSize: 11, color: "var(--text-soft)" }}>
                  Sólo se agregan correos nuevos (no duplica los que ya estén en el campo de destinatarios).
                </div>
              </div>
            )}

            <textarea
              className="input"
              value={destinatariosStr}
              onChange={(e) => setDestinatariosStr(e.target.value)}
              placeholder="juan@ejemplo.cl, maria@ejemplo.cl&#10;pedro@ejemplo.cl"
              rows={4}
              style={{ width: "100%", resize: "vertical", fontFamily: "ui-monospace, monospace", fontSize: 13 }}
              disabled={enviando}
            />
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, fontSize: 12, color: "var(--text-muted)" }}>
              <span>
                <strong style={{ color: validos.length > 0 ? "#15803d" : "var(--text-muted)" }}>
                  {validos.length} válido{validos.length === 1 ? "" : "s"}
                </strong>
                {invalidos.length > 0 && (
                  <>
                    {" · "}
                    <span style={{ color: "#b91c1c" }}>
                      <AlertTriangle size={11} style={{ display: "inline", verticalAlign: "-1px" }} /> {invalidos.length} inválido{invalidos.length === 1 ? "" : "s"}
                    </span>
                    {" "}
                    <button
                      type="button"
                      onClick={limpiarInvalidos}
                      className="btn btn-ghost btn-sm"
                      style={{ padding: "2px 6px", fontSize: 11 }}
                    >
                      Quitar inválidos
                    </button>
                  </>
                )}
              </span>
            </div>

            {validos.length > 0 && (
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 6,
                  marginTop: 8,
                  padding: 10,
                  background: "var(--bg)",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  maxHeight: 130,
                  overflowY: "auto",
                }}
              >
                {validos.slice(0, 200).map((email) => (
                  <span
                    key={email}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                      padding: "3px 8px",
                      background: "var(--surface)",
                      border: "1px solid var(--border)",
                      borderRadius: 999,
                      fontSize: 11,
                      color: "var(--text)",
                    }}
                  >
                    {email}
                    <button
                      type="button"
                      onClick={() => quitarDestinatario(email)}
                      style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: "#b91c1c", lineHeight: 0 }}
                      title="Quitar"
                      disabled={enviando}
                    >
                      <Trash2 size={11} />
                    </button>
                  </span>
                ))}
                {validos.length > 200 && (
                  <span style={{ fontSize: 11, color: "var(--text-soft)" }}>
                    +{validos.length - 200} más…
                  </span>
                )}
              </div>
            )}

            {invalidos.length > 0 && (
              <div style={{ marginTop: 6, fontSize: 11, color: "#b91c1c" }}>
                Inválidos: {invalidos.slice(0, 5).join(", ")}
                {invalidos.length > 5 ? ` y ${invalidos.length - 5} más…` : ""}
              </div>
            )}
          </div>

          <div>
            <label className="filter-label">Archivo adjunto / flyer (opcional)</label>

            {/* Selector de modo */}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "4px 0 10px" }}>
              {[
                { value: "imagen", label: "Imagen inline", desc: "PDF/imagen → PNG embebido. Fidelidad pixel-perfect en TODOS los clientes." },
                { value: "html_enriquecido", label: "HTML enriquecido", desc: "PDF → imagen + capa de texto invisible (seleccionable e indexable). Mejor en Gmail / Apple Mail; puede degradar en Outlook desktop." },
                { value: "adjunto_pdf", label: "Adjunto PDF", desc: "PDF como archivo adjunto descargable. Cuerpo separado." },
              ].map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => cambiarModo(opt.value)}
                  disabled={enviando || procesandoFlyer}
                  title={opt.desc}
                  style={{
                    padding: "6px 12px",
                    borderRadius: 6,
                    border: "1px solid",
                    borderColor: flyerModo === opt.value ? "var(--primary)" : "var(--border)",
                    background: flyerModo === opt.value ? "var(--primary-light)" : "var(--surface)",
                    color: flyerModo === opt.value ? "var(--primary-dark)" : "var(--text)",
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: enviando || procesandoFlyer ? "not-allowed" : "pointer",
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <div style={{ fontSize: 11, color: "var(--text-soft)", marginBottom: 8 }}>
              {flyerModo === "html_enriquecido" &&
                "El PDF se convierte a HTML: PNG de fondo + capa de texto invisible posicionada encima. El texto queda seleccionable e indexable en clientes que respetan position:absolute (Gmail webmail, Apple Mail). En Outlook desktop la imagen se ve OK pero la capa de texto puede colapsar."}
              {flyerModo === "adjunto_pdf" &&
                "El PDF viaja como archivo adjunto descargable. El cuerpo del correo es el texto que se escriba; el PDF se abre aparte."}
            </div>

            <input
              ref={flyerInputRef}
              type="file"
              accept={flyerModo === "imagen" ? "image/*,application/pdf,.pdf" : "application/pdf,.pdf"}
              style={{ display: "none" }}
              onChange={(e) => handleFlyerFile(e.target.files?.[0])}
              disabled={enviando || procesandoFlyer}
            />
            {!flyerPreview ? (
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 4 }}>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => flyerInputRef.current?.click()}
                  disabled={enviando || procesandoFlyer}
                >
                  {flyerModo === "adjunto_pdf" ? <Paperclip size={14} /> : <FileUp size={14} />}
                  {procesandoFlyer
                    ? "Procesando…"
                    : flyerModo === "imagen"
                    ? "Subir PDF o imagen"
                    : flyerModo === "html_enriquecido"
                    ? "Subir PDF (texto seleccionable)"
                    : "Adjuntar PDF"}
                </button>
              </div>
            ) : (
              <div
                style={{
                  display: "flex",
                  gap: 14,
                  alignItems: "flex-start",
                  marginTop: 6,
                  padding: 12,
                  background: "var(--bg)",
                  border: "1px solid var(--border)",
                  borderRadius: 10,
                }}
              >
                <img
                  src={flyerPreview}
                  alt="preview"
                  style={{
                    maxWidth: 200,
                    maxHeight: 280,
                    borderRadius: 6,
                    border: "1px solid var(--border)",
                    boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
                  }}
                />
                <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>
                    <ImageIcon size={13} style={{ display: "inline", verticalAlign: "-2px", marginRight: 4 }} />
                    {flyerNombre}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-soft)" }}>
                    {flyerBlob ? `${(flyerBlob.size / 1024).toFixed(0)} KB` : ""}
                  </div>
                  {flyerLinksCount > 0 && flyerModo !== "adjunto_pdf" && (
                    <div style={{ fontSize: 11, color: "#15803d", fontWeight: 600 }}>
                      🔗 {flyerLinksCount} hipervínculo{flyerLinksCount === 1 ? "" : "s"} preservado{flyerLinksCount === 1 ? "" : "s"}
                    </div>
                  )}
                  {flyerModo !== "adjunto_pdf" && (
                    <div>
                      <label className="filter-label" style={{ marginBottom: 2 }}>Posición en el correo</label>
                      <select
                        className="input"
                        value={flyerPosicion}
                        onChange={(e) => setFlyerPosicion(e.target.value)}
                        disabled={enviando}
                        style={{ width: 200 }}
                      >
                        <option value="arriba">Arriba del texto</option>
                        <option value="abajo">Debajo del texto</option>
                      </select>
                    </div>
                  )}
                  <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => flyerInputRef.current?.click()}
                      disabled={enviando || procesandoFlyer}
                    >
                      Reemplazar
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={quitarFlyer}
                      disabled={enviando}
                      style={{ color: "#b91c1c" }}
                    >
                      <Trash2 size={12} /> Quitar
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div>
            <label className="filter-label">
              Cuerpo (texto plano o HTML)
              {flyerBlob && flyerModo !== "adjunto_pdf" ? (
                <span style={{ fontWeight: 400, color: "var(--text-soft)" }}> · opcional cuando el flyer va inline</span>
              ) : (
                " *"
              )}
            </label>
            <textarea
              className="input"
              value={cuerpo}
              onChange={(e) => setCuerpo(e.target.value)}
              placeholder={"Hola,\n\nGracias por…\n\n(puedes usar HTML: <b>, <a href=\"…\">, <p>, <img src=\"…\"> )"}
              rows={12}
              style={{ width: "100%", resize: "vertical", fontFamily: "ui-monospace, monospace", fontSize: 13 }}
              disabled={enviando}
            />
          </div>

          {resumen && (
            <div
              style={{
                background: resumen.fallidos > 0 ? "#fef3c7" : "#dcfce7",
                color: resumen.fallidos > 0 ? "#92400e" : "#15803d",
                padding: "10px 14px",
                borderRadius: 8,
                fontSize: 13,
              }}
            >
              <strong>Último envío:</strong> {resumen.enviados} enviados / {resumen.totalDestinatarios} totales · {resumen.lotes} lote{resumen.lotes === 1 ? "" : "s"}
              {resumen.fallidos > 0 && (
                <>
                  {" · "}
                  <span style={{ color: "#b91c1c" }}>{resumen.fallidos} fallidos</span>
                </>
              )}
              {Array.isArray(resumen.errores) && resumen.errores.length > 0 && (
                <ul style={{ margin: "6px 0 0 18px", padding: 0, fontSize: 12 }}>
                  {resumen.errores.map((er, i) => (
                    <li key={i}>Lote {er.lote}: {er.mensaje}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              padding: "10px 12px",
              background: "var(--surface-soft, #f8fafc)",
              border: "1px solid var(--border, #e2e8f0)",
              borderRadius: 8,
              marginBottom: 8,
            }}
          >
            <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 13, fontWeight: 500 }}>
              <input
                type="checkbox"
                checked={conTracking}
                onChange={(e) => setConTracking(e.target.checked)}
                disabled={enviando}
              />
              Registrar quién abre cada correo (tracking individual)
            </label>
            <span style={{ fontSize: 12, color: "var(--text-soft, #64748b)" }}>
              {conTracking ? (
                <>Lento: ~3 min por cada 256 correos. Permite ver aperturas por destinatario.</>
              ) : (
                <>Envío rápido en BCC: ~30 seg por cada 256 correos. No registra aperturas.</>
              )}
            </span>
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                setAsunto("");
                setCuerpo("");
                setDestinatariosStr("");
                setRemitenteNombre("");
                setResumen(null);
                quitarFlyer();
              }}
              disabled={enviando}
            >
              Limpiar
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={enviar}
              disabled={
                enviando ||
                validos.length === 0 ||
                !asunto.trim() ||
                (!cuerpo.trim() && !(flyerBlob && (flyerModo === "imagen" || flyerModo === "html_enriquecido")))
              }
            >
              <Send size={14} />
              {enviando ? "Enviando…" : `Enviar a ${validos.length || 0}`}
            </button>
          </div>
        </div>
      </div>
      )}
    </div>
  );
}

/* ──────────────────────────────── Historial ──────────────────────────────── */

function HistorialEnvios() {
  const [envios, setEnvios] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [seleccionado, setSeleccionado] = useState(null); // id del envío con detalle abierto
  const [confirmarEliminar, setConfirmarEliminar] = useState(null); // envío a eliminar
  const [eliminando, setEliminando] = useState(false);

  useEffect(() => {
    cargar();
  }, []);

  async function cargar() {
    setCargando(true);
    setError("");
    try {
      const r = await api.get("/mailings/envios");
      setEnvios(Array.isArray(r) ? r : []);
    } catch (e) {
      setError(e?.message || "No se pudo cargar el historial.");
    } finally {
      setCargando(false);
    }
  }

  async function eliminarEnvio() {
    if (!confirmarEliminar) return;
    setEliminando(true);
    try {
      await api.delete(`/mailings/envios/${confirmarEliminar.id}`);
      setEnvios((prev) => prev.filter((e) => e.id !== confirmarEliminar.id));
      setConfirmarEliminar(null);
    } catch (e) {
      setError(e?.message || "No se pudo eliminar el envío.");
    } finally {
      setEliminando(false);
    }
  }

  if (seleccionado) {
    return (
      <DetalleEnvio
        envioId={seleccionado}
        onVolver={() => {
          setSeleccionado(null);
          cargar();
        }}
      />
    );
  }

  return (
    <>
      {confirmarEliminar && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15,23,42,.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            padding: 16,
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget && !eliminando) setConfirmarEliminar(null);
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: 460,
              background: "var(--surface)",
              borderRadius: 12,
              padding: 22,
              boxShadow: "0 20px 50px rgba(15,23,42,.25)",
            }}
          >
            <h3 style={{ margin: "0 0 10px", fontSize: 17, fontWeight: 700 }}>
              Eliminar envío
            </h3>
            <p style={{ margin: "0 0 6px", fontSize: 13, color: "var(--text)" }}>
              Se eliminará el envío y todo el registro de destinatarios y aperturas.
            </p>
            <p style={{ margin: "0 0 14px", fontSize: 13, color: "var(--text-muted)" }}>
              <strong>{confirmarEliminar.asunto || "(sin asunto)"}</strong>
              {" · "}
              {confirmarEliminar.creado_at
                ? new Date(confirmarEliminar.creado_at).toLocaleString("es-CL")
                : ""}
            </p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setConfirmarEliminar(null)}
                disabled={eliminando}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={eliminarEnvio}
                disabled={eliminando}
              >
                {eliminando ? "Eliminando…" : "Eliminar"}
              </button>
            </div>
          </div>
        </div>
      )}

    <div className="surface">
      <div className="surface-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h3 className="surface-title">Envíos realizados</h3>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={cargar}
          disabled={cargando}
        >
          <RefreshCw size={13} />
          Actualizar
        </button>
      </div>
      <div className="surface-body" style={{ padding: 0 }}>
        {error && (
          <div style={{ padding: 14, color: "#b91c1c", fontSize: 13 }}>{error}</div>
        )}
        {cargando ? (
          <div style={{ padding: 30, textAlign: "center", color: "var(--text-muted)" }}>
            Cargando envíos…
          </div>
        ) : envios.length === 0 ? (
          <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)", fontSize: 14 }}>
            Aún no hay correos enviados desde Comunicaciones.
          </div>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Asunto</th>
                  <th style={{ textAlign: "right", width: 90 }}>Total</th>
                  <th style={{ textAlign: "right", width: 100 }}>Enviados</th>
                  <th style={{ textAlign: "right", width: 100 }}>Fallidos</th>
                  <th style={{ width: 200 }}>Aperturas</th>
                  <th style={{ width: 180 }}></th>
                </tr>
              </thead>
              <tbody>
                {envios.map((e) => {
                  const total = Number(e.total || 0);
                  const abiertos = Number(e.abiertos || 0);
                  const pct = total > 0 ? Math.round((abiertos / total) * 100) : 0;
                  return (
                    <tr key={e.id}>
                      <td style={{ whiteSpace: "nowrap", fontSize: 12.5, color: "var(--text-soft)" }}>
                        {e.creado_at ? new Date(e.creado_at).toLocaleString("es-CL") : "—"}
                      </td>
                      <td style={{ fontWeight: 600 }}>{e.asunto || "(sin asunto)"}</td>
                      <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{total}</td>
                      <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", color: "#15803d" }}>
                        {Number(e.enviados || 0)}
                      </td>
                      <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", color: Number(e.fallidos) ? "#b91c1c" : "var(--text-muted)" }}>
                        {Number(e.fallidos || 0)}
                      </td>
                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <div style={{ flex: 1, height: 8, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 4, overflow: "hidden" }}>
                            <div style={{
                              height: "100%",
                              width: `${pct}%`,
                              background: pct >= 50 ? "#16a34a" : pct >= 20 ? "#f59e0b" : "#94a3b8",
                              transition: "width 0.3s",
                            }} />
                          </div>
                          <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", minWidth: 60, textAlign: "right" }}>
                            {abiertos}/{total} · {pct}%
                          </span>
                        </div>
                      </td>
                      <td>
                        <div style={{ display: "flex", gap: 6 }}>
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() => setSeleccionado(e.id)}
                          >
                            Ver detalle
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={() => setConfirmarEliminar(e)}
                            title="Eliminar envío"
                            style={{ color: "#b91c1c" }}
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
    </>
  );
}

function DetalleEnvio({ envioId, onVolver }) {
  const [detalle, setDetalle] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [filtro, setFiltro] = useState(""); // "" | "abiertos" | "pendientes" | "fallidos"
  const [busqueda, setBusqueda] = useState("");

  useEffect(() => {
    cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [envioId]);

  async function cargar() {
    setCargando(true);
    setError("");
    try {
      const r = await api.get(`/mailings/envios/${envioId}`);
      setDetalle(r);
    } catch (e) {
      setError(e?.message || "No se pudo cargar el detalle.");
    } finally {
      setCargando(false);
    }
  }

  const destinatariosFiltrados = useMemo(() => {
    if (!detalle?.destinatarios) return [];
    let arr = detalle.destinatarios;
    if (filtro === "abiertos") arr = arr.filter((d) => d.abierto_at);
    else if (filtro === "pendientes") arr = arr.filter((d) => d.enviado_at && !d.abierto_at && !d.fallo);
    else if (filtro === "fallidos") arr = arr.filter((d) => d.fallo);

    const q = busqueda.trim().toLowerCase();
    if (q) arr = arr.filter((d) => String(d.email || "").toLowerCase().includes(q));
    return arr;
  }, [detalle, filtro, busqueda]);

  if (cargando) {
    return (
      <div className="surface">
        <div className="surface-body" style={{ padding: 30, textAlign: "center", color: "var(--text-muted)" }}>
          Cargando detalle…
        </div>
      </div>
    );
  }
  if (error) {
    return (
      <div className="surface">
        <div className="surface-body" style={{ padding: 14, color: "#b91c1c", fontSize: 13 }}>
          {error}
          <div style={{ marginTop: 12 }}>
            <button type="button" className="btn btn-secondary btn-sm" onClick={onVolver}>
              <ChevronLeft size={13} /> Volver al historial
            </button>
          </div>
        </div>
      </div>
    );
  }
  if (!detalle) return null;

  const { envio, stats } = detalle;

  return (
    <div className="surface">
      <div className="surface-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onVolver}>
            <ChevronLeft size={14} /> Volver
          </button>
          <div>
            <div className="surface-title" style={{ marginBottom: 2 }}>{envio.asunto || "(sin asunto)"}</div>
            <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
              {envio.creado_at ? new Date(envio.creado_at).toLocaleString("es-CL") : ""}
              {envio.creado_por ? ` · ${envio.creado_por}` : ""}
            </div>
          </div>
        </div>
        <button type="button" className="btn btn-secondary btn-sm" onClick={cargar}>
          <RefreshCw size={13} /> Refrescar
        </button>
      </div>

      <div className="surface-body" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {/* KPIs */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
          <KpiCard label="Total destinatarios" value={stats.total} color="var(--text)" />
          <KpiCard label="Enviados" value={stats.enviados} color="#15803d" />
          <KpiCard label="Fallidos" value={stats.fallidos} color="#b91c1c" />
          <KpiCard
            label="Abrieron"
            value={`${stats.abiertos} (${stats.total > 0 ? Math.round((stats.abiertos / stats.total) * 100) : 0}%)`}
            color="#1d4ed8"
          />
        </div>

        {/* Filtros */}
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {[
            { v: "", label: "Todos", count: stats.total },
            { v: "abiertos", label: "Abrieron", count: stats.abiertos },
            { v: "pendientes", label: "Pendientes", count: stats.enviados - stats.abiertos },
            { v: "fallidos", label: "Fallidos", count: stats.fallidos },
          ].map((opt) => (
            <button
              key={opt.v}
              type="button"
              onClick={() => setFiltro(opt.v)}
              style={{
                padding: "5px 12px",
                borderRadius: 6,
                border: "1px solid",
                borderColor: filtro === opt.v ? "var(--primary)" : "var(--border)",
                background: filtro === opt.v ? "var(--primary-light)" : "var(--surface)",
                color: filtro === opt.v ? "var(--primary-dark)" : "var(--text)",
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              {opt.label} <span style={{ opacity: 0.6 }}>· {opt.count}</span>
            </button>
          ))}
          <input
            type="text"
            placeholder="Buscar correo…"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            className="input"
            style={{ width: 220, fontSize: 12.5, marginLeft: "auto" }}
          />
        </div>

        {/* Tabla */}
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ width: 130 }}>Estado</th>
                <th>Email</th>
                <th style={{ whiteSpace: "nowrap" }}>Enviado</th>
                <th style={{ whiteSpace: "nowrap" }}>Abierto</th>
                <th>Detalle</th>
              </tr>
            </thead>
            <tbody>
              {destinatariosFiltrados.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ padding: 30, textAlign: "center", color: "var(--text-muted)" }}>
                    Sin resultados.
                  </td>
                </tr>
              ) : (
                destinatariosFiltrados.map((d) => {
                  let estado;
                  if (d.fallo) {
                    estado = (
                      <span className="badge badge-danger" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                        <XCircle size={11} /> Falló
                      </span>
                    );
                  } else if (d.abierto_at) {
                    estado = (
                      <span className="badge badge-success" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                        <MailOpen size={11} /> Abrió
                      </span>
                    );
                  } else if (d.enviado_at) {
                    estado = (
                      <span className="badge badge-neutral" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                        <Clock size={11} /> Pendiente
                      </span>
                    );
                  } else {
                    estado = (
                      <span className="badge badge-neutral" style={{ display: "inline-flex", alignItems: "center", gap: 4, opacity: 0.6 }}>
                        <Clock size={11} /> En cola
                      </span>
                    );
                  }
                  return (
                    <tr key={d.id}>
                      <td>{estado}</td>
                      <td style={{ fontFamily: "ui-monospace, monospace", fontSize: 12.5 }}>{d.email}</td>
                      <td style={{ fontSize: 12, color: "var(--text-muted)", whiteSpace: "nowrap" }}>
                        {d.enviado_at ? new Date(d.enviado_at).toLocaleString("es-CL") : "—"}
                      </td>
                      <td style={{ fontSize: 12, color: d.abierto_at ? "#15803d" : "var(--text-muted)", whiteSpace: "nowrap", fontWeight: d.abierto_at ? 600 : 400 }}>
                        {d.abierto_at ? new Date(d.abierto_at).toLocaleString("es-CL") : "—"}
                      </td>
                      <td style={{ fontSize: 11, color: "var(--text-muted)", maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {d.fallo ? d.fallo : d.user_agent ? d.user_agent : "—"}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function KpiCard({ label, value, color }) {
  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: "12px 14px" }}>
      <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-muted)", fontWeight: 600 }}>
        {label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, color, marginTop: 4, fontVariantNumeric: "tabular-nums" }}>
        {value}
      </div>
    </div>
  );
}
