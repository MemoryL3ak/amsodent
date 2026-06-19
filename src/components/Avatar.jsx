import { useRef, useState } from "react";
import { Camera } from "lucide-react";

function iniciales(nombre) {
  const partes = String(nombre || "").trim().split(/\s+/).filter(Boolean);
  if (!partes.length) return "?";
  return (partes[0][0] + (partes[1]?.[0] || "")).toUpperCase();
}

/**
 * Avatar reutilizable: muestra la imagen `src` o, si no hay, las iniciales del
 * nombre sobre un círculo. Si se pasa `onUpload`, muestra un botón de cámara
 * que permite seleccionar una imagen (se entrega el File a `onUpload`).
 */
export default function Avatar({ src, nombre, size = 40, editable = false, onUpload, title }) {
  const inputRef = useRef(null);
  const [subiendo, setSubiendo] = useState(false);

  async function onChange(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !onUpload) return;
    setSubiendo(true);
    try {
      await onUpload(file);
    } finally {
      setSubiendo(false);
    }
  }

  const fuente = Math.max(11, Math.round(size * 0.38));

  return (
    <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }} title={title}>
      {src ? (
        <img
          src={src}
          alt={nombre || ""}
          style={{ width: size, height: size, borderRadius: "50%", objectFit: "cover", display: "block", border: "1px solid var(--border)" }}
        />
      ) : (
        <div
          style={{
            width: size, height: size, borderRadius: "50%",
            background: "var(--primary-light)", color: "var(--primary-dark)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: fuente, fontWeight: 700,
          }}
        >
          {iniciales(nombre)}
        </div>
      )}

      {editable && (
        <>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={subiendo}
            title="Cambiar foto"
            style={{
              position: "absolute", right: -2, bottom: -2,
              width: Math.max(20, Math.round(size * 0.34)), height: Math.max(20, Math.round(size * 0.34)),
              borderRadius: "50%", border: "2px solid var(--surface)",
              background: "var(--primary)", color: "#fff",
              display: "flex", alignItems: "center", justifyContent: "center",
              cursor: subiendo ? "default" : "pointer", padding: 0,
            }}
          >
            <Camera size={Math.max(10, Math.round(size * 0.18))} />
          </button>
          <input ref={inputRef} type="file" accept="image/*" onChange={onChange} style={{ display: "none" }} />
        </>
      )}
    </div>
  );
}
