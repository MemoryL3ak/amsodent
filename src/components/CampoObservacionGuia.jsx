/* ── Observación de la guía → atributo adicional en Bsale (2026-10-07) ──────
   Pedido de Ariel: la observación de cada producto de la cotización va al
   campo «Observación» (atributos adicionales) de la guía en Bsale. Se propone
   con las observaciones de los productos y se puede editar: el mismo campo se
   usa para instrucciones de entrega (horario de bodega, contacto). */

const etiqueta = { fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".4px", color: "var(--text-muted)", display: "block", marginBottom: 4 };

export const OBSERVACION_GUIA_MAX = 250;

export default function CampoObservacionGuia({ valor, onChange, sugerida = "", max = OBSERVACION_GUIA_MAX, disabled }) {
  const v = valor || "";
  const largo = v.length > max;
  return (
    <div className="campo-observacion-guia" style={{ border: "1px solid var(--border)", borderRadius: 10, padding: "10px 12px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
        <span style={etiqueta}>Observación (atributo adicional en Bsale)</span>
        <span style={{ fontSize: 11, fontWeight: 600, color: largo ? "#b91c1c" : "var(--text-muted)" }}>{v.length}/{max}</span>
      </div>
      <textarea
        className="input"
        rows={2}
        value={v}
        onChange={(e) => onChange?.(e.target.value)}
        disabled={disabled}
        placeholder="Ej: horario de recepción, contacto en bodega… (opcional)"
        style={{ width: "100%", resize: "vertical", minHeight: 52, fontSize: 13, lineHeight: 1.4, borderColor: largo ? "#fca5a5" : undefined }}
      />
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", marginTop: 4, fontSize: 11.5, color: "var(--text-muted)" }}>
        <span>{sugerida ? "Propuesta con las observaciones de los productos de la cotización." : "Los productos de la cotización no tienen observaciones."}</span>
        {sugerida && v !== sugerida && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange?.(sugerida)} disabled={disabled} style={{ padding: "0 6px", height: 22, fontSize: 11.5 }}>
            Usar la propuesta
          </button>
        )}
      </div>
      {largo && <div style={{ fontSize: 12, color: "#b91c1c", marginTop: 4 }}>En Bsale caben hasta {max} caracteres: acórtala para poder simular.</div>}
    </div>
  );
}
