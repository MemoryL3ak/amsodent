import { useEffect, useMemo, useState } from "react";
import { Link2, Search, X } from "lucide-react";
import { api } from "../lib/api";
import { fmtFechaHoraChile } from "../lib/fechaChile";

/* ── Asociar a un pedido del portal una cotización ya creada (2026-11-12) ────
   Hasta ahora la única forma de que un pedido tuviera cotización era crearla
   desde el pedido. Si se había hecho por el listado, o quedó una equivocada,
   no había cómo corregirlo desde la pantalla. Esta ventana lista las
   cotizaciones DEL MISMO CLIENTE (las arma el servidor por el RUT del pedido,
   que además lo vuelve a comprobar al guardar): nunca se ofrece la de otro.
   Una cotización va en un solo pedido, así que las que ya están en otro salen
   a la vista pero no se pueden elegir. */

const fmtCLP = (n) => `$${Math.round(Number(n) || 0).toLocaleString("es-CL")}`;

const COLOR_ESTADO = {
  adjudicada: { bg: "#dcfce7", fg: "#15803d" },
  "en espera": { bg: "#fef9c3", fg: "#a16207" },
  perdida: { bg: "#fee2e2", fg: "#b91c1c" },
  descartada: { bg: "#f1f5f9", fg: "#475569" },
};
const colorEstado = (e) => COLOR_ESTADO[String(e || "").trim().toLowerCase()] || { bg: "#e0f2fe", fg: "#0369a1" };

export default function ModalAsociarCotizacion({ pedido, guardando = false, onCerrar, onConfirmar }) {
  // La cotización que el pedido tiene hoy (si la tiene): entonces es un cambio.
  const actualId = Number(pedido?.cotizacion?.id) || null;
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState("");
  const [texto, setTexto] = useState("");
  const [elegidaId, setElegidaId] = useState(null);

  useEffect(() => {
    let vivo = true;
    api.get(`/stock-clientes/solicitudes/${pedido.id}/cotizaciones-asociables`)
      .then((r) => { if (vivo) setDatos(r || { cotizaciones: [] }); })
      .catch((e) => { if (vivo) { setError(e?.message || "No se pudieron cargar las cotizaciones del cliente."); setDatos({ cotizaciones: [] }); } });
    return () => { vivo = false; };
  }, [pedido.id]);

  useEffect(() => {
    const alTeclear = (e) => { if (e.key === "Escape") onCerrar(); };
    window.addEventListener("keydown", alTeclear);
    return () => window.removeEventListener("keydown", alTeclear);
  }, [onCerrar]);

  const todas = useMemo(() => (Array.isArray(datos?.cotizaciones) ? datos.cotizaciones : []), [datos]);
  const visibles = useMemo(() => {
    const t = texto.trim().toLowerCase();
    if (!t) return todas;
    return todas.filter((c) =>
      [c.id, c.id_licitacion, c.nombre, c.estado, c.vendedor].some((v) => String(v ?? "").toLowerCase().includes(t)),
    );
  }, [todas, texto]);
  const elegida = todas.find((c) => c.id === elegidaId) || null;

  const rut = datos?.pedido?.rut || "";
  const cliente = pedido.razon_social || datos?.pedido?.razon_social || "";

  return (
    <div
      onMouseDown={(e) => { if (e.target === e.currentTarget && !guardando) onCerrar(); }}
      style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.55)", zIndex: 12000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
    >
      <div style={{ width: 680, maxWidth: "100%", maxHeight: "88vh", display: "flex", flexDirection: "column", background: "var(--surface)", borderRadius: 14, border: "1px solid var(--border)" }}>
        <div style={{ padding: "18px 20px 12px", display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
          <div style={{ minWidth: 0 }}>
            <h3 style={{ margin: "0 0 4px", fontSize: 16, fontWeight: 800, color: "var(--text)" }}>
              {actualId ? "Cambiar la cotización" : "Asociar una cotización"} del pedido N° {pedido.id}
            </h3>
            <p style={{ margin: 0, fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.5 }}>
              Cotizaciones ya creadas de <strong style={{ color: "var(--text)" }}>{cliente || "este cliente"}</strong>
              {rut ? ` (${rut})` : ""}. Al asociarla, el cliente la ve en su portal dentro de este pedido.
            </p>
          </div>
          <button type="button" onClick={onCerrar} disabled={guardando} title="Cerrar" style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", flexShrink: 0 }}>
            <X size={18} />
          </button>
        </div>

        {actualId && (
          <div style={{ margin: "0 20px 10px", fontSize: 12.5, color: "#92400e", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 9, padding: "8px 10px", lineHeight: 1.45 }}>
            Hoy el pedido tiene la cotización <strong>#{actualId}</strong>. Si la cambias, el cliente deja de verla en este
            pedido y pasa a ver la que elijas; la #{actualId} no se borra y el cambio queda en la bitácora.
          </div>
        )}

        {todas.length > 6 && (
          <div style={{ margin: "0 20px 10px", position: "relative" }}>
            <Search size={14} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)" }} />
            <input
              className="input"
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              placeholder="Buscar por N°, nombre, estado o vendedor…"
              style={{ width: "100%", paddingLeft: 30 }}
            />
          </div>
        )}

        <div role="radiogroup" aria-label="Cotizaciones del cliente" style={{ padding: "0 20px", overflowY: "auto", display: "flex", flexDirection: "column", gap: 6, minHeight: 80 }}>
          {datos == null ? (
            <div style={{ fontSize: 13, color: "var(--text-muted)", padding: "14px 0" }}>Cargando las cotizaciones del cliente…</div>
          ) : error ? (
            <div style={{ fontSize: 13, color: "#b91c1c", padding: "14px 0" }}>{error}</div>
          ) : todas.length === 0 ? (
            <div style={{ fontSize: 13, color: "var(--text-muted)", padding: "14px 0", lineHeight: 1.5 }}>
              Este cliente no tiene cotizaciones creadas con su RUT. Créala con «Crear cotización desde el pedido».
            </div>
          ) : visibles.length === 0 ? (
            <div style={{ fontSize: 13, color: "var(--text-muted)", padding: "14px 0" }}>Ninguna cotización calza con «{texto}».</div>
          ) : (
            visibles.map((c) => {
              const esActual = c.id === actualId;
              const enOtro = c.pedido_id && Number(c.pedido_id) !== Number(pedido.id) ? c.pedido_id : null;
              const bloqueada = esActual || Boolean(enOtro);
              const marcada = c.id === elegidaId;
              const ce = colorEstado(c.estado);
              return (
                <button
                  key={c.id}
                  type="button"
                  role="radio"
                  aria-checked={marcada}
                  disabled={bloqueada || guardando}
                  onClick={() => setElegidaId(c.id)}
                  title={enOtro ? `Ya está asociada al pedido N° ${enOtro}` : esActual ? "Es la cotización que el pedido tiene hoy" : `Elegir la cotización #${c.id}`}
                  style={{
                    textAlign: "left", width: "100%", cursor: bloqueada ? "not-allowed" : "pointer",
                    background: marcada ? "#f0fdfa" : "var(--surface)",
                    border: `1.5px solid ${marcada ? "#0d9488" : "var(--border)"}`,
                    borderRadius: 10, padding: "9px 12px", opacity: bloqueada ? 0.55 : 1,
                    display: "flex", alignItems: "center", gap: 10, font: "inherit", color: "var(--text)",
                  }}
                >
                  <span aria-hidden style={{ width: 16, height: 16, borderRadius: "50%", flexShrink: 0, border: `2px solid ${marcada ? "#0d9488" : "#cbd5e1"}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    {marcada && <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#0d9488" }} />}
                  </span>
                  <span style={{ flex: "1 1 auto", minWidth: 0 }}>
                    <span style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                      <span style={{ fontWeight: 800, fontSize: 13.5 }}>#{c.id}</span>
                      <span style={{ fontSize: 12.5, color: "var(--text)", overflowWrap: "anywhere" }}>{c.nombre && c.nombre !== String(c.id) ? c.nombre : ""}</span>
                    </span>
                    <span style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 3, fontSize: 11.5, color: "var(--text-muted)" }}>
                      <span style={{ fontSize: 10.5, fontWeight: 800, padding: "1px 8px", borderRadius: 999, background: ce.bg, color: ce.fg }}>{c.estado || "—"}</span>
                      <span>{fmtFechaHoraChile(c.created_at)}</span>
                      <span>{c.lineas} {c.lineas === 1 ? "línea" : "líneas"}</span>
                      {c.vendedor && <span>{c.vendedor}</span>}
                      {esActual && <span style={{ fontWeight: 800, color: "#0f766e" }}>Asociada hoy a este pedido</span>}
                      {enOtro && <span style={{ fontWeight: 800, color: "#b45309" }}>Ya está en el pedido N° {enOtro}</span>}
                    </span>
                  </span>
                  <span style={{ flexShrink: 0, textAlign: "right", fontWeight: 800, fontSize: 13, fontVariantNumeric: "tabular-nums" }}>
                    {Number(c.total_con_iva) > 0 ? fmtCLP(c.total_con_iva) : "—"}
                    <span style={{ display: "block", fontSize: 10, fontWeight: 600, color: "var(--text-muted)" }}>con IVA</span>
                  </span>
                </button>
              );
            })
          )}
        </div>

        <div style={{ padding: "14px 20px 18px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: 11.5, color: "var(--text-muted)", flex: "1 1 220px" }}>
            Solo aparecen cotizaciones con el RUT del pedido. Si el pedido está por revisar o en revisión, el cliente recibe el aviso de su cotización.
          </span>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button type="button" className="btn btn-secondary" onClick={onCerrar} disabled={guardando}>Cancelar</button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={!elegida || guardando}
              onClick={() => onConfirmar(elegida)}
            >
              <Link2 size={14} style={{ marginRight: 6 }} />
              {guardando ? "Guardando…" : elegida ? `${actualId ? "Cambiar por" : "Asociar"} la #${elegida.id}` : actualId ? "Cambiar cotización" : "Asociar cotización"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
