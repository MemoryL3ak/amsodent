import { useEffect, useRef, useState } from "react";
import { ScanBarcode, X } from "lucide-react";

/* ── Código de barras con pistola (2026-11-09) ───────────────────────────────
   Pedido de Ariel: «cuando se edita un producto, dame la opción para leer el
   código de barra con pistoleo» y «al crear una cotización, agregar productos
   leyendo el código de barra». El lector actúa como teclado: escribe el
   código y manda Enter. Acá se intercepta ese Enter (para que no envíe el
   formulario) y se entrega el código limpio (sin espacios).

   · CampoCodigoBarra: el campo del producto (Editar / Crear producto). Con
     «Pistolear» el campo toma el foco y espera la lectura; al llegar el Enter
     queda el código escrito.
   · EscanerCodigoBarra: ventana flotante para cotizar: queda abierta y cada
     lectura llama onLeer(codigo); sirve para pistolear varios productos
     seguidos. Esc o la × la cierran. */

export const limpiarCodigoBarra = (v) => String(v ?? "").replace(/\s+/g, "").trim().slice(0, 64);

export default function CampoCodigoBarra({ value, onChange, disabled, className = "input", style, placeholder = "Ej: 7801234567890", onLeido }) {
  const ref = useRef(null);
  const [escuchando, setEscuchando] = useState(false);

  function pistolear() {
    if (disabled) return;
    setEscuchando(true);
    onChange?.("");
    setTimeout(() => ref.current?.focus(), 0);
  }
  function tecla(e) {
    if (e.key !== "Enter") return;
    // El Enter de la pistola no debe enviar el formulario.
    e.preventDefault();
    e.stopPropagation();
    const codigo = limpiarCodigoBarra(e.currentTarget.value);
    onChange?.(codigo);
    setEscuchando(false);
    if (codigo) onLeido?.(codigo);
  }

  return (
    <div className="campo-codigo-barra" style={{ display: "flex", gap: 6, alignItems: "stretch", flexWrap: "wrap", ...style }}>
      <input
        ref={ref}
        className={className}
        value={value || ""}
        onChange={(e) => onChange?.(limpiarCodigoBarra(e.target.value))}
        onKeyDown={tecla}
        onBlur={() => setEscuchando(false)}
        disabled={disabled}
        inputMode="numeric"
        autoComplete="off"
        placeholder={escuchando ? "Pistolea el código ahora…" : placeholder}
        style={{ flex: "1 1 180px", minWidth: 0, ...(escuchando ? { borderColor: "var(--primary, #28aeb1)", boxShadow: "0 0 0 3px rgba(40,174,177,.18)" } : {}) }}
      />
      <button
        type="button"
        className={`btn ${escuchando ? "btn-primary" : "btn-secondary"}`}
        onClick={pistolear}
        disabled={disabled}
        title="Deja el campo esperando la lectura de la pistola (también puedes escribir el número)"
        style={{ display: "inline-flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}
      >
        <ScanBarcode size={15} /> {escuchando ? "Esperando lectura…" : "Pistolear"}
      </button>
    </div>
  );
}

/* Ventana flotante para pistolear varios productos seguidos. `ultimo` es el
   texto del último resultado (lo arma quien la usa). */
export function EscanerCodigoBarra({ onLeer, onCerrar, ultimo, ocupado = false, titulo = "Pistolear código de barras" }) {
  const ref = useRef(null);
  const [valor, setValor] = useState("");

  useEffect(() => {
    ref.current?.focus();
    const tecla = (e) => { if (e.key === "Escape") onCerrar?.(); };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [onCerrar]);

  function leer(e) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    e.stopPropagation();
    const codigo = limpiarCodigoBarra(valor);
    setValor("");
    if (codigo && !ocupado) onLeer?.(codigo);
    ref.current?.focus();
  }

  return (
    <div className="escaner-codigo-barra" role="dialog" aria-label={titulo} style={{ position: "fixed", right: 20, bottom: 20, zIndex: 10500, width: 360, maxWidth: "calc(100vw - 32px)", background: "var(--surface, #fff)", border: "1px solid var(--border, #e2e8f0)", borderRadius: 12, boxShadow: "var(--shadow-lg, 0 18px 40px -12px rgba(15,23,42,.3))", padding: "12px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <ScanBarcode size={16} style={{ color: "var(--primary, #28aeb1)", flexShrink: 0 }} />
        <strong style={{ fontSize: 13.5, flex: 1, minWidth: 0 }}>{titulo}</strong>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCerrar} aria-label="Cerrar" style={{ padding: 4 }}><X size={15} /></button>
      </div>
      <input
        ref={ref}
        className="input"
        value={valor}
        onChange={(e) => setValor(e.target.value)}
        onKeyDown={leer}
        onBlur={() => setTimeout(() => ref.current?.focus(), 150)}
        inputMode="numeric"
        autoComplete="off"
        placeholder={ocupado ? "Buscando…" : "Pistolea el código (o escríbelo y Enter)"}
        style={{ width: "100%", height: 38, fontSize: 14, borderColor: "var(--primary, #28aeb1)" }}
      />
      <div style={{ fontSize: 12, color: ultimo?.error ? "#b91c1c" : "var(--text-muted, #64748b)", lineHeight: 1.4, overflowWrap: "anywhere" }}>
        {ultimo?.texto || "Cada lectura agrega el producto a la cotización (si ya está, suma una unidad). Esc para cerrar."}
      </div>
    </div>
  );
}
