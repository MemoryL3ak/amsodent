import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Search } from "lucide-react";

/* Listbox custom de selección MÚLTIPLE (2026-11-06). Hermano de
   DropdownSelect: mismo botón y mismo menú flotante, pero cada opción es una
   casilla y el menú no se cierra al marcar. Nació en Gestión de compras para
   elegir más de un proveedor por producto.
   options: [{ value, label, detalle? }] · value: arreglo de values marcados ·
   onChange(arreglo) en el orden de `options`. Con más de 7 opciones aparece un
   buscador. `pie` es contenido libre al final del menú (ej. «Agregar…»). */
export default function MultiSelect({
  value = [],
  onChange,
  options,
  placeholder = "Selecciona…",
  minWidth = 240,
  disabled = false,
  className = "input",
  style,
  title,
  vacio = "No hay opciones.",
  resumen,
  pie,
}) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState(null);
  const [q, setQ] = useState("");
  const btnRef = useRef(null);
  const menuRef = useRef(null);
  const marcados = useMemo(() => new Set((value || []).map(String)), [value]);
  const elegidas = options.filter((o) => marcados.has(String(o.value)));

  function toggle() {
    if (disabled) return;
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      const alto = window.innerHeight;
      const abajo = alto - r.bottom - 8;
      const arriba = r.top - 8;
      const haciaArriba = abajo < 240 && arriba > abajo;
      const ancho = Math.max(minWidth, r.width);
      // Que no se salga por la derecha en pantallas angostas.
      const left = Math.max(8, Math.min(r.left, window.innerWidth - ancho - 8));
      setCoords({ left, top: r.bottom + 4, bottom: alto - r.top + 4, width: ancho, arriba: haciaArriba, altoMax: Math.max(160, Math.min(360, haciaArriba ? arriba : abajo)) });
      setQ("");
    }
    setOpen((o) => !o);
  }

  useEffect(() => {
    if (!open) return;
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

  const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const texto = norm(q.trim());
  const visibles = texto ? options.filter((o) => norm(`${o.label} ${o.detalle || ""}`).includes(texto)) : options;
  const alternar = (v) => {
    const k = String(v);
    onChange(options.filter((o) => (String(o.value) === k ? !marcados.has(k) : marcados.has(String(o.value)))).map((o) => o.value));
  };
  const etiqueta = resumen
    ? resumen(elegidas)
    : elegidas.length === 0
      ? placeholder
      : elegidas.length <= 2
        ? elegidas.map((o) => o.label).join(", ")
        : `${elegidas[0].label} y ${elegidas.length - 1} más`;

  return (
    <>
      <button
        type="button"
        ref={btnRef}
        onClick={toggle}
        disabled={disabled}
        title={title || (elegidas.length ? elegidas.map((o) => o.label).join(", ") : undefined)}
        className={className}
        aria-haspopup="listbox"
        aria-expanded={open}
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
        <span style={{ color: elegidas.length ? "#0f172a" : "#94a3b8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>{etiqueta}</span>
        <ChevronDown size={15} style={{ color: "#94a3b8", flexShrink: 0 }} />
      </button>
      {open && coords && createPortal(
        <>
          <div onMouseDown={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 20000 }} />
          <div
            ref={menuRef}
            role="listbox"
            aria-multiselectable="true"
            className="multi-select-menu"
            style={{ position: "fixed", left: coords.left, ...(coords.arriba ? { bottom: coords.bottom } : { top: coords.top }), width: coords.width, maxWidth: "min(92vw, 520px)", zIndex: 20001, background: "var(--surface, #fff)", border: "1px solid var(--border, #e2e8f0)", borderRadius: 10, boxShadow: "var(--shadow-lg, 0 18px 40px -12px rgba(15,23,42,.25))", padding: 4, maxHeight: coords.altoMax || 320, display: "flex", flexDirection: "column" }}
          >
            {options.length > 7 && (
              <div style={{ position: "relative", padding: "4px 4px 6px" }}>
                <Search size={13} style={{ position: "absolute", left: 13, top: "50%", transform: "translateY(-60%)", color: "#94a3b8" }} />
                <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar…" className="input" style={{ width: "100%", height: 32, paddingLeft: 28, fontSize: 13 }} />
              </div>
            )}
            <div style={{ overflowY: "auto", minHeight: 0, flex: "1 1 auto" }}>
              {visibles.length === 0 && <div style={{ padding: "12px 10px", fontSize: 12.5, color: "var(--text-soft, #64748b)" }}>{options.length ? "Nada calza con la búsqueda." : vacio}</div>}
              {visibles.map((op) => {
                const isSel = marcados.has(String(op.value));
                return (
                  <button
                    key={String(op.value)}
                    type="button"
                    role="option"
                    aria-selected={isSel}
                    onClick={() => alternar(op.value)}
                    style={{ display: "flex", alignItems: "flex-start", gap: 8, width: "100%", textAlign: "left", padding: "7px 10px", border: "none", background: isSel ? "var(--primary-light, #e8f7f7)" : "transparent", color: "var(--text, #0f172a)", fontSize: 13, fontWeight: 600, cursor: "pointer", borderRadius: 6 }}
                    onMouseEnter={(e) => { if (!isSel) e.currentTarget.style.background = "var(--bg, #f8fafc)"; }}
                    onMouseLeave={(e) => { if (!isSel) e.currentTarget.style.background = "transparent"; }}
                  >
                    <span style={{ width: 16, height: 16, marginTop: 1, borderRadius: 4, border: `1.5px solid ${isSel ? "var(--primary, #28aeb1)" : "#cbd5e1"}`, background: isSel ? "var(--primary, #28aeb1)" : "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      {isSel && <Check size={12} style={{ color: "#fff" }} />}
                    </span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: "block", overflowWrap: "anywhere" }}>{op.label}</span>
                      {op.detalle && <span style={{ display: "block", fontSize: 11.5, fontWeight: 500, color: "var(--text-soft, #64748b)", lineHeight: 1.35 }}>{op.detalle}</span>}
                    </span>
                  </button>
                );
              })}
            </div>
            {pie && <div style={{ borderTop: "1px solid var(--border, #e2e8f0)", marginTop: 4, padding: "6px 6px 4px" }}>{typeof pie === "function" ? pie({ cerrar: () => setOpen(false), busqueda: q }) : pie}</div>}
          </div>
        </>,
        document.body,
      )}
    </>
  );
}
