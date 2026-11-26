import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { nuevoUid, numero, soloNumero } from "./postventaComun";

/* ── Productos afectados de una solicitud de postventa (2026-11-26) ──────────
   Lo usan la ventana «Nueva solicitud» de la plataforma y el formulario del
   portal del cliente. Si la solicitud tiene cotización, se ofrecen sus
   productos para marcarlos (con la cantidad afectada); además se pueden
   agregar productos a mano (SKU opcional, nombre y cantidad).

   No guarda nada: avisa cada cambio con `onCambiar([{ sku, nombre, cantidad }])`.
   Para empezar de cero al cambiar de cotización, móntalo con otra `key`. */

const aNumero = (v) => Number(String(v ?? "").replace(",", ".")) || 0;

export default function ProductosAfectados({ sugeridos = [], onCambiar, disabled = false, claseInput = "input", estiloInput = null }) {
  const [marcados, setMarcados] = useState({}); // índice del sugerido → cantidad (texto)
  const [libres, setLibres] = useState([]); // { uid, sku, nombre, cantidad }

  function avisar(m, l) {
    const lista = [
      ...sugeridos.map((p, i) => (i in m ? { sku: p.sku || null, nombre: p.nombre, cantidad: aNumero(m[i]) || null } : null)).filter(Boolean),
      ...l.filter((x) => x.nombre.trim() || x.sku.trim()).map((x) => ({ sku: x.sku.trim() || null, nombre: x.nombre.trim() || x.sku.trim(), cantidad: aNumero(x.cantidad) || null })),
    ];
    onCambiar?.(lista);
  }
  function marcar(i, activo) {
    const m = { ...marcados };
    if (activo) m[i] = sugeridos[i]?.cantidad != null ? String(sugeridos[i].cantidad) : "1";
    else delete m[i];
    setMarcados(m);
    avisar(m, libres);
  }
  function cantidadDe(i, valor) {
    const m = { ...marcados, [i]: soloNumero(valor) };
    setMarcados(m);
    avisar(m, libres);
  }
  function cambiarLibre(uid, campo, valor) {
    const l = libres.map((x) => (x.uid === uid ? { ...x, [campo]: valor } : x));
    setLibres(l);
    avisar(marcados, l);
  }
  function agregarLibre() {
    const l = [...libres, { uid: nuevoUid(), sku: "", nombre: "", cantidad: "1" }];
    setLibres(l);
  }
  function quitarLibre(uid) {
    const l = libres.filter((x) => x.uid !== uid);
    setLibres(l);
    avisar(marcados, l);
  }

  const campo = { height: 32, boxSizing: "border-box", ...(estiloInput || {}) };
  const botonTexto = { display: "inline-flex", alignItems: "center", gap: 5, border: "none", background: "transparent", color: "var(--primary, #0f766e)", fontWeight: 600, fontSize: 12.5, cursor: disabled ? "default" : "pointer", padding: "4px 0", fontFamily: "inherit" };

  return (
    <div className="productos-afectados" style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
      {sugeridos.length > 0 && (
        <div style={{ border: "1px solid var(--border, #e2e8f0)", borderRadius: 10, maxHeight: 190, overflowY: "auto" }}>
          {sugeridos.map((p, i) => {
            const activo = i in marcados;
            return (
              <div key={`${p.sku || ""}-${i}`} style={{ display: "flex", alignItems: "center", gap: 9, padding: "6px 10px", borderTop: i ? "1px solid var(--border, #f1f5f9)" : "none", fontSize: 12.5, minWidth: 0 }}>
                <label style={{ display: "flex", alignItems: "center", gap: 9, flex: 1, minWidth: 0, cursor: disabled ? "default" : "pointer" }}>
                  <input type="checkbox" checked={activo} disabled={disabled} onChange={(e) => marcar(i, e.target.checked)} style={{ flexShrink: 0 }} />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: "block", fontWeight: 600, overflowWrap: "anywhere" }}>{p.nombre}</span>
                    <span style={{ display: "block", fontSize: 11.5, color: "var(--text-muted, #64748b)" }}>{[p.sku, p.cantidad != null ? `${numero(p.cantidad)} en la cotización` : null].filter(Boolean).join(" · ")}</span>
                  </span>
                </label>
                {activo && (
                  <input
                    className={claseInput}
                    inputMode="decimal"
                    value={marcados[i]}
                    disabled={disabled}
                    onChange={(e) => cantidadDe(i, e.target.value)}
                    aria-label={`Cantidad afectada de ${p.nombre}`}
                    title="Cantidad afectada"
                    style={{ ...campo, width: 76, textAlign: "right", flexShrink: 0 }}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}

      {libres.map((x) => (
        <div key={x.uid} style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          <input className={claseInput} value={x.sku} disabled={disabled} onChange={(e) => cambiarLibre(x.uid, "sku", e.target.value.slice(0, 60))} placeholder="SKU (opcional)" style={{ ...campo, flex: "1 1 110px", minWidth: 0, maxWidth: 150 }} />
          <input className={claseInput} value={x.nombre} disabled={disabled} onChange={(e) => cambiarLibre(x.uid, "nombre", e.target.value.slice(0, 200))} placeholder="Producto" style={{ ...campo, flex: "3 1 180px", minWidth: 0 }} />
          <input className={claseInput} inputMode="decimal" value={x.cantidad} disabled={disabled} onChange={(e) => cambiarLibre(x.uid, "cantidad", soloNumero(e.target.value))} placeholder="Cant." aria-label="Cantidad afectada" style={{ ...campo, width: 76, textAlign: "right" }} />
          <button type="button" onClick={() => quitarLibre(x.uid)} disabled={disabled} title="Quitar este producto" aria-label="Quitar este producto" style={{ border: "none", background: "transparent", color: "#dc2626", cursor: disabled ? "default" : "pointer", padding: 4, display: "inline-flex" }}>
            <Trash2 size={14} />
          </button>
        </div>
      ))}

      <div>
        <button type="button" onClick={agregarLibre} disabled={disabled} style={botonTexto}>
          <Plus size={14} /> {sugeridos.length ? "Agregar un producto que no está en la lista" : "Agregar un producto"}
        </button>
      </div>
    </div>
  );
}
