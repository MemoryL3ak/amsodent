import { useEffect } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, Info, CheckCircle2, Trash2, X } from "lucide-react";

// Modal de confirmación profesional, reemplaza window.confirm().
// Tonos: "danger" (rojo), "warning" (ámbar), "primary" (teal), "success" (verde).
export default function ConfirmModal({
  open,
  title,
  message,
  onConfirm,
  onCancel,
  confirmText = "Eliminar",
  cancelText = "Cancelar",
  confirmTone = "danger",
  hideCancel = false,
  icon: IconProp,
}) {
  useEffect(() => {
    if (!open) return undefined;
    function onKey(e) {
      if (e.key === "Escape") onCancel?.();
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) onConfirm?.();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel, onConfirm]);

  if (!open) return null;

  const conf = TONOS[confirmTone] || TONOS.danger;
  const Icono = IconProp || conf.icon;

  return createPortal(
    <div
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel?.();
      }}
      style={overlay}
    >
      <style>{ESTILOS}</style>
      <div className="cm-pop" style={caja}>
        <button
          type="button"
          onClick={onCancel}
          aria-label="Cerrar"
          style={btnCerrar}
        >
          <X size={16} />
        </button>

        <div style={{ padding: "26px 26px 8px", display: "flex", gap: 16, alignItems: "flex-start" }}>
          <div
            style={{
              ...iconoCaja,
              background: conf.iconBg,
              color: conf.iconColor,
              boxShadow: `0 8px 18px -6px ${conf.iconShadow}`,
            }}
          >
            <Icono size={22} strokeWidth={2.2} />
          </div>
          <div style={{ flex: 1, minWidth: 0, paddingTop: 2 }}>
            <h2
              style={{
                margin: 0,
                fontSize: 16,
                fontWeight: 800,
                color: "#0f172a",
                letterSpacing: "-.01em",
                lineHeight: 1.3,
              }}
            >
              {title}
            </h2>
            {message && (
              <p
                style={{
                  margin: "8px 0 0",
                  fontSize: 13.5,
                  color: "#475569",
                  lineHeight: 1.55,
                }}
              >
                {message}
              </p>
            )}
          </div>
        </div>

        <div style={footer}>
          {!hideCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="cm-btn"
              style={btnSec}
            >
              {cancelText}
            </button>
          )}
          <button
            type="button"
            onClick={onConfirm}
            className="cm-btn cm-btn-primary"
            style={{
              ...btnPrim,
              background: conf.btnBg,
              boxShadow: `0 6px 14px -4px ${conf.iconShadow}`,
            }}
          >
            {confirmTone === "danger" && <Trash2 size={14} strokeWidth={2.4} />}
            {confirmText}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

const TONOS = {
  danger: {
    icon: AlertTriangle,
    iconBg: "#fee2e2",
    iconColor: "#dc2626",
    iconShadow: "rgba(220,38,38,.35)",
    btnBg: "linear-gradient(135deg, #dc2626, #ef4444)",
  },
  warning: {
    icon: AlertTriangle,
    iconBg: "#fef3c7",
    iconColor: "#b45309",
    iconShadow: "rgba(180,83,9,.30)",
    btnBg: "linear-gradient(135deg, #b45309, #d97706)",
  },
  primary: {
    icon: Info,
    iconBg: "#ccfbf1",
    iconColor: "#0f766e",
    iconShadow: "rgba(15,118,110,.35)",
    btnBg: "linear-gradient(135deg, #0f766e, #14b8a6)",
  },
  success: {
    icon: CheckCircle2,
    iconBg: "#dcfce7",
    iconColor: "#15803d",
    iconShadow: "rgba(21,128,61,.30)",
    btnBg: "linear-gradient(135deg, #15803d, #22c55e)",
  },
};

const ESTILOS = `
  @keyframes cm-fade { from { opacity: 0; } to { opacity: 1; } }
  @keyframes cm-pop { from { opacity: 0; transform: scale(.94) translateY(10px); } to { opacity: 1; transform: none; } }
  .cm-pop { animation: cm-pop .2s cubic-bezier(.16,1,.3,1); }
  .cm-btn { transition: background .14s ease, transform .14s ease, box-shadow .14s ease, border-color .14s ease; }
  .cm-btn:hover { transform: translateY(-1px); }
  .cm-btn-primary:hover { filter: brightness(1.05); }
`;

const overlay = {
  position: "fixed",
  inset: 0,
  background: "rgba(15,23,42,.55)",
  backdropFilter: "blur(4px)",
  WebkitBackdropFilter: "blur(4px)",
  zIndex: 12000,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 16,
  animation: "cm-fade .15s ease",
};

const caja = {
  width: 440,
  maxWidth: "100%",
  background: "#ffffff",
  borderRadius: 16,
  overflow: "hidden",
  position: "relative",
  boxShadow:
    "0 24px 60px -12px rgba(15,23,42,.30), 0 8px 20px -8px rgba(15,23,42,.12)",
  border: "1px solid rgba(226,232,240,.6)",
};

const btnCerrar = {
  position: "absolute",
  top: 12,
  right: 12,
  width: 28,
  height: 28,
  borderRadius: 8,
  border: "none",
  background: "transparent",
  color: "#94a3b8",
  cursor: "pointer",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  transition: "background .14s ease, color .14s ease",
};

const iconoCaja = {
  width: 48,
  height: 48,
  borderRadius: 13,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  flexShrink: 0,
};

const footer = {
  display: "flex",
  justifyContent: "flex-end",
  gap: 10,
  padding: "14px 26px 20px",
  marginTop: 14,
};

const btnSec = {
  height: 40,
  padding: "0 18px",
  borderRadius: 10,
  border: "1px solid #e2e8f0",
  background: "#fff",
  color: "#334155",
  fontWeight: 600,
  fontSize: 13.5,
  cursor: "pointer",
};

const btnPrim = {
  height: 40,
  padding: "0 18px",
  borderRadius: 10,
  border: "none",
  color: "#fff",
  fontWeight: 700,
  fontSize: 13.5,
  cursor: "pointer",
  display: "inline-flex",
  alignItems: "center",
  gap: 7,
};
