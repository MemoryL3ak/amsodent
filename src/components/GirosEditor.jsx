import { useState } from "react";
import { Plus, Star, X } from "lucide-react";
import { GIRO_MAX, GIROS_MAX, normalizarGiros } from "../lib/giros";

/* Giros del cliente con selección múltiple (2026-10-23): una pastilla por
   giro, el primero es el principal (la estrella de otro lo pasa adelante), la
   × lo quita y abajo se escribe uno nuevo (Enter o «Agregar»). `value` y
   `onChange` usan la lista guardada en clientes.giros. */
export default function GirosEditor({ value, onChange, disabled = false, placeholder = "Ej: Clínica dental" }) {
  const [texto, setTexto] = useState("");
  const giros = normalizarGiros(value);
  const lleno = giros.length >= GIROS_MAX;

  function agregar() {
    const siguiente = normalizarGiros([...giros, texto]);
    setTexto("");
    if (siguiente.length !== giros.length) onChange?.(siguiente);
  }
  const quitar = (i) => onChange?.(giros.filter((_, j) => j !== i));
  const hacerPrincipal = (i) => onChange?.([giros[i], ...giros.filter((_, j) => j !== i)]);

  const botonChico = { padding: 2, lineHeight: 0, minWidth: 0, color: "inherit" };

  return (
    <div className="giros-editor" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {giros.length > 0 && (
        <div role="list" aria-label="Giros del cliente" style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {giros.map((g, i) => {
            const principal = i === 0;
            return (
              <span
                key={g}
                role="listitem"
                title={principal ? "Giro principal" : "La estrella lo hace principal"}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 4, maxWidth: "100%",
                  border: `1px solid ${principal ? "var(--primary)" : "var(--border)"}`,
                  background: principal ? "var(--primary-light)" : "var(--surface)",
                  color: principal ? "var(--primary-dark)" : "var(--text)",
                  borderRadius: 999, padding: "3px 6px 3px 10px", fontSize: 12.5, fontWeight: principal ? 700 : 500,
                }}
              >
                <span style={{ overflowWrap: "anywhere" }}>{g}</span>
                {principal ? (
                  <span style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: ".3px", opacity: 0.8 }}>principal</span>
                ) : (
                  !disabled && (
                    <button type="button" className="btn btn-ghost" onClick={() => hacerPrincipal(i)} title="Hacer principal" aria-label={`Hacer principal el giro ${g}`} style={botonChico}>
                      <Star size={12} />
                    </button>
                  )
                )}
                {!disabled && (
                  <button type="button" className="btn btn-ghost" onClick={() => quitar(i)} title="Quitar" aria-label={`Quitar el giro ${g}`} style={botonChico}>
                    <X size={12} />
                  </button>
                )}
              </span>
            );
          })}
        </div>
      )}
      {!disabled && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <input
            className="input"
            style={{ flex: "1 1 180px", minWidth: 0 }}
            value={texto}
            maxLength={GIRO_MAX}
            disabled={lleno}
            placeholder={lleno ? `Máximo ${GIROS_MAX} giros` : giros.length ? "Agregar otro giro…" : placeholder}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); agregar(); } }}
            aria-label="Nuevo giro"
          />
          <button type="button" className="btn btn-secondary btn-sm" onClick={agregar} disabled={lleno || !texto.trim()} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <Plus size={13} /> Agregar
          </button>
        </div>
      )}
      <div className="field-hint">
        El primero es el principal y es el que propone la cotización. Bsale guarda un solo texto de giro: se le envían todos unidos con « / ».
      </div>
    </div>
  );
}

/* Pastillas con los giros de la ficha del cliente, para elegir el de la
   cotización con un clic (el campo Giro sigue siendo texto libre). */
export function GirosRapidos({ giros, value, onChange, disabled = false }) {
  const lista = normalizarGiros(giros);
  if (!lista.length) return null;
  const actual = String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
  return (
    <div role="group" aria-label="Giros del cliente" style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
      {lista.map((g, i) => {
        const activo = g.toLowerCase() === actual;
        return (
          <button
            key={g}
            type="button"
            className="btn btn-sm"
            aria-pressed={activo}
            disabled={disabled}
            onClick={() => onChange?.(g)}
            title={i === 0 ? "Giro principal de la ficha del cliente" : "Giro de la ficha del cliente"}
            style={{
              border: `1px solid ${activo ? "var(--primary)" : "var(--border)"}`,
              background: activo ? "var(--primary-light)" : "var(--surface)",
              color: activo ? "var(--primary-dark)" : "var(--text)",
              fontWeight: activo ? 700 : 500, fontSize: 12, padding: "3px 10px", borderRadius: 999,
              maxWidth: "100%", overflowWrap: "anywhere", textAlign: "left",
              opacity: disabled ? 0.6 : 1, cursor: disabled ? "default" : "pointer",
            }}
          >
            {g}{i === 0 ? <span style={{ fontSize: 10, textTransform: "uppercase", marginLeft: 6, opacity: 0.75 }}>principal</span> : null}
          </button>
        );
      })}
    </div>
  );
}
