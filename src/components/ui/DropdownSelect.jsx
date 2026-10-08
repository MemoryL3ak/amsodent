import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";

/* Listbox custom de la plataforma: reemplaza a TODO <select> nativo.
   Nació en Despachos/Choferes y se promovió a componente compartido.
   options: [{ value, label, color?, detalle? }] — color pinta un punto,
   detalle agrega una segunda línea gris en el menú. Una opción con
   value "" sirve como estado "sin definir" y se muestra como cualquier
   otra; placeholder solo aparece si el value no calza con ninguna. */
export default function DropdownSelect({
  value,
  onChange,
  options,
  placeholder = "Selecciona…",
  minWidth = 200,
  disabled = false,
  className = "input",
  style,
  title,
}) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState(null);
  const btnRef = useRef(null);
  const menuRef = useRef(null);
  const sel = options.find((o) => String(o.value) === String(value ?? ""));

  function toggle() {
    if (disabled) return;
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      // (2026-10-08) Si abajo no cabe (ventanas bajas, pantallas de 13"), el menú
      // se abre hacia arriba o se acorta: antes se salía por el borde y había
      // opciones imposibles de alcanzar.
      const alto = window.innerHeight;
      const abajo = alto - r.bottom - 8;
      const arriba = r.top - 8;
      const haciaArriba = abajo < 200 && arriba > abajo;
      setCoords({ left: r.left, top: r.bottom + 4, bottom: alto - r.top + 4, width: r.width, arriba: haciaArriba, altoMax: Math.max(120, Math.min(300, haciaArriba ? arriba : abajo)) });
    }
    setOpen((o) => !o);
  }

  useEffect(() => {
    if (!open) return;
    // El scroll de la página cierra el menú (quedaría flotando lejos del
    // botón), pero el scroll INTERNO de la lista no debe cerrarlo — sin esta
    // distinción, una lista larga era imposible de recorrer.
    const porScroll = (e) => {
      if (menuRef.current && menuRef.current.contains(e.target)) return;
      setOpen(false);
    };
    const close = () => setOpen(false);
    const porTecla = (e) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("scroll", porScroll, true);
    window.addEventListener("resize", close);
    window.addEventListener("keydown", porTecla);
    return () => {
      window.removeEventListener("scroll", porScroll, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("keydown", porTecla);
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        ref={btnRef}
        onClick={toggle}
        disabled={disabled}
        title={title}
        className={className}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          cursor: disabled ? "default" : "pointer",
          textAlign: "left",
          background: disabled ? "#f1f5f9" : "#fff",
          ...style,
        }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: 8, color: sel ? "#0f172a" : "#94a3b8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {sel?.color && <span style={{ width: 9, height: 9, borderRadius: "50%", background: sel.color, flexShrink: 0 }} />}
          {sel ? sel.label : placeholder}
        </span>
        <ChevronDown size={15} style={{ color: "#94a3b8", flexShrink: 0 }} />
      </button>
      {open && coords && createPortal(
        <>
          {/* (2026-10-08) Por encima de toda ventana (las hay hasta 13000; solo los avisos flotantes van más arriba):
              dentro de «Crear producto» (11050) el menú quedaba detrás de la ventana. */}
          <div onMouseDown={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 20000 }} />
          <div ref={menuRef} style={{ position: "fixed", left: coords.left, ...(coords.arriba ? { bottom: coords.bottom } : { top: coords.top }), minWidth: Math.max(minWidth, coords.width), maxWidth: "min(92vw, 520px)", zIndex: 20001, background: "var(--surface, #fff)", border: "1px solid var(--border, #e2e8f0)", borderRadius: 10, boxShadow: "var(--shadow-lg, 0 18px 40px -12px rgba(15,23,42,.25))", padding: 4, maxHeight: coords.altoMax || 300, overflowY: "auto" }}>
            {options.map((op) => {
              const isSel = String(op.value) === String(value ?? "");
              return (
                <button
                  key={String(op.value)}
                  type="button"
                  onClick={() => { onChange(op.value); setOpen(false); }}
                  style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", textAlign: "left", padding: "8px 10px", border: "none", background: isSel ? "var(--primary-light, #e8f7f7)" : "transparent", color: "var(--text, #0f172a)", fontSize: 13, fontWeight: 600, cursor: "pointer", borderRadius: 6 }}
                  onMouseEnter={(e) => { if (!isSel) e.currentTarget.style.background = "var(--bg, #f8fafc)"; }}
                  onMouseLeave={(e) => { if (!isSel) e.currentTarget.style.background = "transparent"; }}
                >
                  {op.color && <span style={{ width: 9, height: 9, borderRadius: "50%", background: op.color, flexShrink: 0, marginTop: op.detalle ? 4 : 0, alignSelf: op.detalle ? "flex-start" : "center" }} />}
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: "block" }}>{op.label}</span>
                    {op.detalle && (
                      <span style={{ display: "block", fontSize: 11.5, fontWeight: 500, color: "var(--text-soft, #64748b)", lineHeight: 1.35 }}>{op.detalle}</span>
                    )}
                  </span>
                  {isSel && <Check size={14} style={{ color: "var(--primary, #28aeb1)", flexShrink: 0 }} />}
                </button>
              );
            })}
          </div>
        </>,
        document.body,
      )}
    </>
  );
}
