import DropdownSelect from "./ui/DropdownSelect";

/* ── Transporte de una guía emitida desde el sistema (2026-10-07) ────────────
   Empresa de transporte y N° de seguimiento. Son datos del sistema (no van a
   Bsale) y el N° es opcional: si todavía no existe, se agrega después desde la
   cotización. "Despacho interno" recibe el correlativo AMSO automático. */

const EMPRESAS_DESPACHO = [
  { value: "", label: "Sin definir todavía" },
  { value: "Starken", label: "Starken" },
  { value: "Blue Express", label: "Blue Express" },
  { value: "Despacho interno", label: "Despacho interno" },
  { value: "Otro", label: "Otro" },
];
const etiqueta = { fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".4px", color: "var(--text-muted)", display: "block", marginBottom: 4 };

export default function CamposSeguimientoGuia({ valor, onChange, disabled }) {
  const v = valor || { empresa: "", numero: "" };
  const interno = v.empresa === "Despacho interno";
  return (
    <div className="campos-seguimiento-guia" style={{ border: "1px solid var(--border)", borderRadius: 10, padding: "10px 12px" }}>
      <span style={etiqueta}>Transporte (solo para el sistema)</span>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
        <div style={{ flex: "1 1 180px", minWidth: 0 }}>
          <span style={etiqueta}>Empresa</span>
          <DropdownSelect
            value={v.empresa}
            onChange={(empresa) => onChange?.({ ...v, empresa, numero: empresa === "Despacho interno" ? "" : v.numero })}
            options={EMPRESAS_DESPACHO}
            disabled={disabled}
            minWidth={180}
            style={{ width: "100%" }}
          />
        </div>
        {!interno && (
          <label style={{ flex: "1 1 180px", minWidth: 0 }}>
            <span style={etiqueta}>N° de seguimiento (opcional)</span>
            <input
              className="input"
              value={v.numero}
              onChange={(e) => onChange?.({ ...v, numero: e.target.value.slice(0, 80) })}
              placeholder="Si aún no lo tienes, se agrega después"
              disabled={disabled}
              style={{ width: "100%" }}
            />
          </label>
        )}
      </div>
      {interno && <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 6 }}>Al emitir se asigna el correlativo de despacho interno (AMSO…).</div>}
    </div>
  );
}
