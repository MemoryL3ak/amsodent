// ModalValidarTransitorio.jsx
// Validación del costo de un producto transitorio con más de 30 días
// (pedido 2026-09-04): paso 1 avisa; "Validar info producto" despliega la
// ficha (costo, estado, fechas) con el link a Productos → Editar, y recién
// ahí se puede confirmar "El costo sigue vigente" para usarlo en la cotización.
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, ExternalLink, CheckCircle2, X } from "lucide-react";

const fmtCLP = (v) => `$${Number(v || 0).toLocaleString("es-CL")}`;

export default function ModalValidarTransitorio({ open, prod, onValidado, onCancelar }) {
  const [paso, setPaso] = useState("aviso"); // aviso | info
  useEffect(() => { if (open) setPaso("aviso"); }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === "Escape") onCancelar?.(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancelar]);

  if (!open || !prod) return null;

  const dias = Number.isFinite(Date.parse(prod.created_at))
    ? Math.floor((Date.now() - Date.parse(prod.created_at)) / 86400000)
    : null;
  const creado = String(prod.created_at || "").slice(0, 10);
  const costo = Number(prod.costo ?? 0);
  const urlEditar = prod.id != null ? `/productos/editar/${prod.id}` : null;

  const Fila = ({ label, children }) => (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "7px 0", borderBottom: "1px solid #f1f5f9", fontSize: 13 }}>
      <span style={{ color: "#64748b", flexShrink: 0 }}>{label}</span>
      <span style={{ color: "#0f172a", fontWeight: 600, textAlign: "right", overflow: "hidden", textOverflow: "ellipsis" }}>{children}</span>
    </div>
  );

  return createPortal(
    <div
      onMouseDown={(e) => { if (e.target === e.currentTarget) onCancelar?.(); }}
      style={{
        position: "fixed", inset: 0, background: "rgba(15,23,42,.55)", backdropFilter: "blur(4px)",
        zIndex: 12000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
      }}
    >
      <div style={{
        width: 480, maxWidth: "100%", background: "#fff", borderRadius: 16, position: "relative",
        boxShadow: "0 24px 60px -12px rgba(15,23,42,.30)", border: "1px solid rgba(226,232,240,.6)",
      }}>
        <button type="button" onClick={onCancelar} aria-label="Cerrar" style={{
          position: "absolute", top: 12, right: 12, width: 28, height: 28, borderRadius: 8, border: "none",
          background: "transparent", color: "#94a3b8", cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center",
        }}><X size={16} /></button>

        <div style={{ padding: "26px 26px 8px", display: "flex", gap: 16, alignItems: "flex-start" }}>
          <div style={{
            width: 48, height: 48, borderRadius: 13, display: "inline-flex", alignItems: "center", justifyContent: "center",
            flexShrink: 0, background: "#fef3c7", color: "#b45309", boxShadow: "0 8px 18px -6px rgba(180,83,9,.30)",
          }}>
            <AlertTriangle size={22} strokeWidth={2.2} />
          </div>
          <div style={{ flex: 1, minWidth: 0, paddingTop: 2 }}>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: "#0f172a", letterSpacing: "-.01em", lineHeight: 1.3 }}>
              Valida el costo de este producto transitorio
            </h2>
            {paso === "aviso" ? (
              <p style={{ margin: "8px 0 0", fontSize: 13.5, color: "#475569", lineHeight: 1.55 }}>
                «{prod.nombre}» es un producto transitorio creado hace {dias ?? "más de 30"} días{creado ? ` (${creado})` : ""}.
                Su costo registrado es {fmtCLP(costo)} y puede estar obsoleto: revisa la información del producto antes de cotizarlo.
              </p>
            ) : (
              <div style={{ margin: "10px 0 0" }}>
                <Fila label="Producto">{prod.nombre || "—"}</Fila>
                {prod.sku ? <Fila label="SKU">{prod.sku}</Fila> : null}
                <Fila label="Estado">{prod.estado || "Transitorio"}</Fila>
                <Fila label="Creado">{creado || "—"}{dias != null ? ` · hace ${dias} días` : ""}</Fila>
                {prod.categoria ? <Fila label="Categoría">{prod.categoria}</Fila> : null}
                {prod.formato ? <Fila label="Formato">{prod.formato}</Fila> : null}
                <Fila label="Costo registrado"><span style={{ color: "#b45309" }}>{fmtCLP(costo)}</span></Fila>
                <Fila label="URL de referencia">
                  {prod.link_referencia ? (
                    <a
                      href={prod.link_referencia}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: "#0f766e", fontWeight: 600, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 5, maxWidth: 260, overflow: "hidden" }}
                      title={prod.link_referencia}
                    >
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", direction: "rtl" }}>{prod.link_referencia}</span>
                      <ExternalLink size={13} style={{ flexShrink: 0 }} />
                    </a>
                  ) : (
                    <span style={{ color: "#94a3b8", fontWeight: 500 }}>No registrada</span>
                  )}
                </Fila>
                {urlEditar && (
                  <a
                    href={urlEditar}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      display: "inline-flex", alignItems: "center", gap: 6, marginTop: 12,
                      fontSize: 13, fontWeight: 700, color: "#0f766e", textDecoration: "none",
                    }}
                    title="Abre la edición del producto en una pestaña nueva para verificar o corregir el costo"
                  >
                    <ExternalLink size={14} /> Abrir en Productos → Editar
                  </a>
                )}
                <p style={{ margin: "10px 0 0", fontSize: 12, color: "#94a3b8", lineHeight: 1.5 }}>
                  Si corriges el costo en la otra pestaña, cancela aquí y vuelve a seleccionar el producto para que la cotización tome el valor nuevo.
                </p>
              </div>
            )}
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, padding: "14px 26px 20px", marginTop: 14 }}>
          <button type="button" onClick={onCancelar} className="cm-btn" style={{
            height: 40, padding: "0 18px", borderRadius: 10, border: "1px solid #e2e8f0",
            background: "#fff", color: "#334155", fontWeight: 600, fontSize: 13.5, cursor: "pointer",
          }}>
            Cancelar
          </button>
          {paso === "aviso" ? (
            <button type="button" onClick={() => setPaso("info")} style={{
              height: 40, padding: "0 18px", borderRadius: 10, border: "none", color: "#fff",
              fontWeight: 700, fontSize: 13.5, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 7,
              background: "linear-gradient(135deg, #b45309, #d97706)", boxShadow: "0 6px 14px -4px rgba(180,83,9,.30)",
            }}>
              Validar info producto
            </button>
          ) : (
            <button type="button" onClick={onValidado} style={{
              height: 40, padding: "0 18px", borderRadius: 10, border: "none", color: "#fff",
              fontWeight: 700, fontSize: 13.5, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 7,
              background: "linear-gradient(135deg, #15803d, #22c55e)", boxShadow: "0 6px 14px -4px rgba(21,128,61,.30)",
            }}>
              <CheckCircle2 size={14} strokeWidth={2.4} /> El costo sigue vigente
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
