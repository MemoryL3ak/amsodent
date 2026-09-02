import { createPortal } from "react-dom";
import { MessageSquare, X } from "lucide-react";

// Aviso flotante de mensaje nuevo del Chat Grupal. Aparece abajo a la derecha
// cuando llega un mensaje y el usuario está en la app pero fuera del chat
// (el caso "pestaña oculta" lo cubre la notificación del sistema desde
// useChatNoLeidos). Click en la tarjeta → abrir el Chat Grupal.
export default function AvisoMensajeChat({ aviso, onAbrir, onCerrar }) {
  if (!aviso) return null;

  return createPortal(
    <div
      role="status"
      style={{
        position: "fixed",
        right: 16,
        bottom: 16,
        zIndex: 10500,
        width: 340,
        maxWidth: "calc(100vw - 32px)",
        background: "#ffffff",
        border: "1px solid #e2e8f0",
        borderLeft: "4px solid #0f766e",
        borderRadius: 14,
        boxShadow: "0 24px 50px rgba(15,23,42,.22), 0 4px 10px rgba(15,23,42,.06)",
        display: "flex",
        gap: 12,
        padding: "12px 12px 12px 14px",
        cursor: "pointer",
        animation: "aviso-chat-in .22s ease-out",
      }}
      onClick={onAbrir}
      title="Abrir Chat Grupal"
    >
      <style>{`
        @keyframes aviso-chat-in {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
      <div
        style={{
          width: 38,
          height: 38,
          borderRadius: 10,
          background: "linear-gradient(135deg, #0f766e, #14b8a6)",
          color: "#fff",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        <MessageSquare size={17} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 10.5,
            fontWeight: 700,
            color: "#0f766e",
            textTransform: "uppercase",
            letterSpacing: 0.6,
            marginBottom: 2,
          }}
        >
          Chat Grupal · mensaje nuevo
        </div>
        <div
          style={{
            fontSize: 13,
            fontWeight: 700,
            color: "#0f172a",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {aviso.autor}
        </div>
        <div
          style={{
            fontSize: 12.5,
            color: "#475569",
            lineHeight: 1.4,
            marginTop: 2,
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
            wordBreak: "break-word",
          }}
        >
          {aviso.resumen}
        </div>
      </div>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onCerrar?.();
        }}
        title="Cerrar"
        style={{
          alignSelf: "flex-start",
          width: 24,
          height: 24,
          borderRadius: 7,
          border: "none",
          background: "transparent",
          color: "#94a3b8",
          cursor: "pointer",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        <X size={14} />
      </button>
    </div>,
    document.body,
  );
}
