/* ── Observación de la guía → atributo adicional en Bsale (2026-10-07) ──────
   Pedido de Ariel: la observación de cada producto de la cotización va al
   campo «Observación» (atributos adicionales) de la guía en Bsale. Se propone
   con las observaciones de los productos y se puede editar: el mismo campo se
   usa para instrucciones de entrega (horario de bodega, contacto). */

const etiqueta = { fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".4px", color: "var(--text-muted)", display: "block", marginBottom: 4 };

export const OBSERVACION_GUIA_MAX = 250;

/* (2026-10-08) Con `compuesta` (texto final: general · SKU: observación…) el
   campo es la observación GENERAL y abajo se ve exactamente lo que irá a
   Bsale, con el largo total contra el tope. */
export default function CampoObservacionGuia({ valor, onChange, sugerida = "", compuesta = null, max = OBSERVACION_GUIA_MAX, disabled }) {
  const v = valor || "";
  const final = compuesta == null ? v : compuesta;
  const largo = final.length > max;
  return (
    <div className="campo-observacion-guia" style={{ border: "1px solid var(--border)", borderRadius: 10, padding: "10px 12px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
        <span style={etiqueta}>{compuesta == null ? "Observación (atributo adicional en Bsale)" : "Observación general de la guía (atributo adicional en Bsale)"}</span>
        <span className="contador-observacion" style={{ fontSize: 11, fontWeight: 600, color: largo ? "#b91c1c" : "var(--text-muted)" }}>{final.length}/{max}</span>
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
      {compuesta != null && (
        <div className="observacion-compuesta" style={{ marginTop: 6, fontSize: 12, lineHeight: 1.4, padding: "6px 8px", borderRadius: 8, background: "var(--bg)", border: "1px dashed var(--border)" }}>
          <span style={{ color: "var(--text-muted)" }}>Así va a Bsale: </span>
          {final ? <span>{final}</span> : <span style={{ color: "var(--text-muted)" }}>sin observación (escribe algo acá o en un producto)</span>}
        </div>
      )}
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", marginTop: 4, fontSize: 11.5, color: "var(--text-muted)" }}>
        <span>{compuesta != null ? "Las observaciones de cada producto se escriben en su fila; acá va lo general (horario, contacto…)." : sugerida ? "Propuesta con las observaciones de los productos de la cotización." : "Los productos de la cotización no tienen observaciones."}</span>
        {sugerida && v !== sugerida && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange?.(sugerida)} disabled={disabled} style={{ padding: "0 6px", height: 22, fontSize: 11.5 }}>
            Usar la propuesta
          </button>
        )}
      </div>
      {largo && <div style={{ fontSize: 12, color: "#b91c1c", marginTop: 4 }}>En Bsale caben hasta {max} caracteres{compuesta != null ? " en total (general + productos)" : ""}: acórtala para poder simular.</div>}
    </div>
  );
}
