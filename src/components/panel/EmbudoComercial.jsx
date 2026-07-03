// EmbudoComercial.jsx
// Tarjeta reutilizable del embudo comercial (Prospecto → Contactado → Cotizan
// → Compran) con forma de embudo. Marcas secuenciales y acumuladas por cliente
// particular. Se usa en el Panel de Indicadores y en el sub-panel "Cliente
// Particular".
import { mesDe, FunnelShape } from "./panelKit";
import useEmbudoComercial, { ETAPAS_EMBUDO } from "./useEmbudoComercial";

// periodo: 'YYYY-MM-DD' o 'YYYY-MM' (el mes seleccionado).
export default function EmbudoComercial({ periodo, titulo = "Embudo comercial (clientes particulares)" }) {
  const mesActual = mesDe(periodo);
  const { loading, emb } = useEmbudoComercial(mesActual);
  const stages = ETAPAS_EMBUDO.map((e) => ({ label: e.label, color: e.color, value: emb[e.key] }));

  return (
    <div className="surface" style={{ padding: 18 }}>
      <h3 className="surface-title" style={{ marginBottom: 16 }}>{titulo}</h3>
      {loading
        ? <div style={{ color: "var(--text-muted)", fontSize: 13, padding: "24px 0", textAlign: "center" }}>Cargando embudo…</div>
        : <FunnelShape stages={stages} />}
    </div>
  );
}
