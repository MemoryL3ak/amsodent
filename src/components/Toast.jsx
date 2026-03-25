import { useEffect } from "react";

const TYPES = {
  success: {
    color: "var(--primary)",
    bg: "var(--primary-light)",
    icon: (
      <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
        <circle cx="10" cy="10" r="10" fill="var(--primary)" />
        <path d="M6 10.5l2.5 2.5L14 8" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  error: {
    color: "#dc2626",
    bg: "#fef2f2",
    icon: (
      <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
        <circle cx="10" cy="10" r="10" fill="#dc2626" />
        <path d="M7 7l6 6M13 7l-6 6" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
      </svg>
    ),
  },
  warning: {
    color: "#d97706",
    bg: "#fffbeb",
    icon: (
      <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
        <circle cx="10" cy="10" r="10" fill="#d97706" />
        <path d="M10 6v5M10 13.5v.5" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
      </svg>
    ),
  },
  info: {
    color: "#6366f1",
    bg: "#eef2ff",
    icon: (
      <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
        <circle cx="10" cy="10" r="10" fill="#6366f1" />
        <path d="M10 9v5M10 6.5v.5" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
      </svg>
    ),
  },
};

export default function Toast({ type = "success", message, onClose }) {
  useEffect(() => {
    const timer = setTimeout(onClose, 6000);
    return () => clearTimeout(timer);
  }, [onClose]);

  const t = TYPES[type] ?? TYPES.info;

  return (
    <div style={{
      position: "fixed",
      bottom: 24,
      right: 24,
      zIndex: 9999,
      animation: "toast-slide-in 0.22s cubic-bezier(.16,1,.3,1) forwards",
    }}>
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        background: "#fff",
        border: "1px solid var(--border)",
        borderLeft: `4px solid ${t.color}`,
        borderRadius: "var(--radius)",
        padding: "12px 16px",
        boxShadow: "0 4px 20px rgba(0,0,0,.10)",
        minWidth: 260,
        maxWidth: 400,
      }}>
        <span style={{flexShrink: 0}}>{t.icon}</span>
        <p style={{
          margin: 0,
          fontSize: 13.5,
          fontWeight: 500,
          color: "var(--text)",
          lineHeight: 1.45,
          whiteSpace: "pre-line",
        }}>
          {message}
        </p>
        <button
          onClick={onClose}
          style={{
            marginLeft: "auto",
            flexShrink: 0,
            background: "none",
            border: "none",
            cursor: "pointer",
            color: "var(--text-muted)",
            padding: "0 0 0 8px",
            fontSize: 16,
            lineHeight: 1,
          }}
          aria-label="Cerrar"
        >
          ×
        </button>
      </div>

      <style>{`
        @keyframes toast-slide-in {
          from { opacity: 0; transform: translateY(12px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
