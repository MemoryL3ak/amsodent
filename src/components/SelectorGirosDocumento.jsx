/* ── Giros con los que sale un documento de Bsale (2026-11-17) ───────────────
   Nació en la factura (2026-11-05/06: «seleccionar qué giro queremos para la
   factura», uno o más) y ahora lo usa también la guía de despacho (pedido de
   Ariel del 2026-11-17: «al crear una guía, que nos permita seleccionar el
   giro y ese sea el que se vaya a Bsale»).

   Casillas con los giros de la ficha del cliente: se marcan uno o más (nunca
   cero) y a Bsale van unidos con « / » en el orden de la ficha. Debajo dice
   con qué texto saldrá el documento y si eso cambia lo que Bsale tiene hoy. */

const etiqueta = { fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".4px", color: "var(--text-muted)", display: "block", marginBottom: 4 };

/** Texto que recibe Bsale: los giros marcados unidos con « / ». */
export const textoGirosDocumento = (seleccion) => (seleccion || []).join(" / ");

/** Marca o desmarca `giro` conservando el orden de la ficha. */
export const alternarGiroDocumento = (giros, seleccion, giro) =>
  (giros || []).filter((x) => (x === giro ? !(seleccion || []).includes(giro) : (seleccion || []).includes(x)));

/**
 * @param {{
 *   giros: string[],            giros de la ficha (en su orden)
 *   seleccion: string[],        los marcados
 *   onChange: (s: string[]) => void,
 *   giroBsale?: string,         el que el cliente tiene hoy en Bsale
 *   clienteNuevo?: boolean,     el cliente todavía no existe en Bsale: se creará con lo marcado
 *   max?: number,               largo que admite Bsale
 *   documento?: { articulo: string, nombre: string },  p. ej. { articulo: "La", nombre: "guía" }
 *   disabled?: boolean,
 * }} props
 */
export default function SelectorGirosDocumento({ giros, seleccion, onChange, giroBsale = "", clienteNuevo = false, max = 80, documento = { articulo: "La", nombre: "factura" }, disabled = false }) {
  const lista = giros || [];
  const marcados = seleccion || [];
  if (lista.length < 2) return null;
  const texto = textoGirosDocumento(marcados);
  const excede = texto.length > max;
  const igualBsale = texto.trim().toLowerCase() === String(giroBsale || "").trim().toLowerCase();
  const doc = `${documento.articulo} ${documento.nombre}`;
  return (
    <div className="factura-giro" style={{ marginTop: 8 }}>
      <span style={etiqueta}>Giros de esta {documento.nombre} (uno o más)</span>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {lista.map((g) => {
          const marcado = marcados.includes(g);
          const unico = marcado && marcados.length === 1;
          return (
            <label key={g} className="factura-giro-opcion" title={unico ? `${doc} necesita al menos un giro` : undefined} style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "5px 8px", borderRadius: 8, border: `1px solid ${marcado ? "var(--primary, #2563eb)" : "var(--border)"}`, background: marcado ? "rgba(37, 99, 235, 0.06)" : "transparent", cursor: disabled || unico ? "default" : "pointer", fontSize: 12.5 }}>
              <input type="checkbox" checked={marcado} disabled={disabled || unico} onChange={() => onChange?.(alternarGiroDocumento(lista, marcados, g))} style={{ marginTop: 2 }} />
              <span style={{ overflowWrap: "anywhere" }}>
                {g}
                {/* El que el cliente tiene hoy en Bsale (puede no ser de la ficha: entonces viene marcado). */}
                {!clienteNuevo && g.trim().toLowerCase() === String(giroBsale || "").trim().toLowerCase() && (
                  <span style={{ marginLeft: 6, fontSize: 10.5, fontWeight: 700, color: "#15803d", background: "#dcfce7", borderRadius: 999, padding: "1px 7px", whiteSpace: "nowrap" }}>hoy en Bsale</span>
                )}
              </span>
            </label>
          );
        })}
      </div>
      <div className="factura-giro-texto" style={{ color: excede ? "#b91c1c" : "var(--text-muted)", fontSize: 11.5, marginTop: 4, overflowWrap: "anywhere" }}>
        {excede
          ? `Los giros marcados suman ${texto.length} caracteres y Bsale admite ${max}: desmarca alguno.`
          : clienteNuevo
            ? `El cliente se creará en Bsale con el giro «${texto}» (${texto.length}/${max}).`
            : igualBsale
              ? `Es el giro que el cliente tiene hoy en Bsale (${texto.length}/${max}).`
              : `${doc} saldrá con «${texto}» (${texto.length}/${max}). En Bsale hoy tiene «${giroBsale || "—"}»: al emitir quedará con lo marcado.`}
      </div>
    </div>
  );
}
