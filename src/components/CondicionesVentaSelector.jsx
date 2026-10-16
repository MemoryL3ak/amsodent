import { Check } from "lucide-react";
import { OPCIONES_CONDICION_VENTA, leerCondiciones, unirCondiciones } from "../lib/condicionesVenta";

/* Condiciones de venta del cliente con selección múltiple (2026-10-16): una
   pastilla por opción que se marca o desmarca. `value` y `onChange` usan el
   texto guardado ("30 días, Contado"). `bloqueadas` lista las opciones que esta
   persona no puede AGREGAR (p. ej. "30 días" en un particular sin ser admin);
   si ya venían marcadas se pueden quitar. */
export default function CondicionesVentaSelector({ value, onChange, bloqueadas = [], disabled = false }) {
  const marcadas = leerCondiciones(value);
  const alternar = (o) => {
    const siguiente = marcadas.includes(o) ? marcadas.filter((x) => x !== o) : [...marcadas, o];
    onChange?.(unirCondiciones(siguiente));
  };
  return (
    <div className="condiciones-venta-selector" role="group" aria-label="Condiciones de venta" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      {OPCIONES_CONDICION_VENTA.map((o) => {
        const activa = marcadas.includes(o);
        const noPuede = disabled || (!activa && bloqueadas.includes(o));
        return (
          <button
            key={o}
            type="button"
            aria-pressed={activa}
            disabled={noPuede}
            onClick={() => alternar(o)}
            className="btn btn-sm"
            style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              border: `1px solid ${activa ? "var(--primary)" : "var(--border)"}`,
              background: activa ? "var(--primary-light)" : "var(--surface)",
              color: activa ? "var(--primary-dark)" : "var(--text)",
              fontWeight: activa ? 700 : 500,
              opacity: noPuede ? 0.55 : 1,
              cursor: noPuede ? "not-allowed" : "pointer",
            }}
          >
            <span style={{ width: 14, height: 14, borderRadius: 4, border: `1.5px solid ${activa ? "var(--primary)" : "var(--border-strong)"}`, background: activa ? "var(--primary)" : "transparent", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              {activa && <Check size={11} color="#fff" strokeWidth={3} />}
            </span>
            {o}
          </button>
        );
      })}
    </div>
  );
}
