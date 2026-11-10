import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import MultiSelect from "./ui/MultiSelect";

/* ── Lotes y vencimientos en la guía de despacho (2026-11-09) ────────────────
   Pedido de Ariel: «cuando se genere una guía de despacho asociada a estos
   productos, en cada producto desplegar un listbox con sus lotes y fechas de
   vencimiento, para permitir seleccionar una o más opciones» (el lote y su
   vencimiento van juntos). Los lotes nacen en Recepción de stock.

   Listbox múltiple (MultiSelect) con los lotes del producto que tienen
   unidades disponibles, del que vence primero al último. Con UN lote, toda la
   línea sale de él. Con varios, las unidades se reparten solas por orden de
   vencimiento (lo disponible de cada uno; lo que sobre, al último) y cada
   cantidad se puede corregir. En la guía de Bsale el lote sale escrito en la
   línea del producto. Lo usan EmitirDespachoBsale (guía desde la OC) y
   DocumentoLibreBsale (guía libre y la de la venta directa).

   Valor por SKU: { ids: [lote_id…], cantidades: {lote_id: "n"} | null, base }.
   `cantidades` null = reparto automático; `base` = la cantidad de la línea con
   que se corrigió a mano (si la línea cambia, vuelve al automático). */

const redondo = (n) => Math.round((Number(n) || 0) * 100) / 100;
const num = (n) => Number(n || 0).toLocaleString("es-CL", { maximumFractionDigits: 2 });
const aNumero = (v) => Number(String(v ?? "").replace(",", ".")) || 0;
export const fechaLote = (ymd) => String(ymd || "").slice(0, 10).split("-").reverse().join("-");
const diasHasta = (ymd, hoy) => Math.round((new Date(`${String(ymd).slice(0, 10)}T00:00:00Z`) - new Date(`${String(hoy).slice(0, 10)}T00:00:00Z`)) / 86400000);

/* Reparto automático: por orden de vencimiento, lo disponible de cada lote; lo que sobre va al último. */
function repartir(lotes, ids, cantidad) {
  const elegidos = (lotes || []).filter((l) => ids.includes(l.id));
  if (!elegidos.length) return [];
  if (elegidos.length === 1) return [{ lote_id: elegidos[0].id, cantidad: redondo(cantidad) }];
  let resto = Number(cantidad) || 0;
  const res = elegidos.map((l) => {
    const c = Math.max(0, Math.min(Number(l.disponible) || 0, resto));
    resto -= c;
    return { lote_id: l.id, cantidad: c };
  });
  if (resto > 1e-9) res[res.length - 1].cantidad += resto;
  return res.map((r) => ({ ...r, cantidad: redondo(r.cantidad) }));
}

/** Lo que se envía al servidor para una línea: [{ lote_id, cantidad }] (vacío si no hay lotes elegidos). */
export function lotesParaEnviar(sel, lotes, cantidad) {
  const ids = (sel?.ids || []).filter((id) => (lotes || []).some((l) => l.id === id));
  if (!ids.length) return [];
  const manual = sel?.cantidades && ids.length > 1 && sel.base === Number(cantidad);
  if (!manual) return repartir(lotes, ids, cantidad);
  return (lotes || []).filter((l) => ids.includes(l.id)).map((l) => ({ lote_id: l.id, cantidad: redondo(aNumero(sel.cantidades[l.id])) }));
}

/** Por qué no se puede simular con esta elección (o null). */
export function problemaLotes(sel, lotes, cantidad) {
  const env = lotesParaEnviar(sel, lotes, cantidad);
  if (env.length < 2) return null;
  if (env.some((a) => !(a.cantidad > 0))) return "Cada lote elegido debe llevar al menos 1 unidad.";
  const suma = env.reduce((a, x) => a + x.cantidad, 0);
  if (suma > Number(cantidad) + 1e-9) return `Los lotes suman ${num(suma)} y la línea lleva ${num(cantidad)}.`;
  return null;
}

/** Arma el objeto { sku: [{lote_id, cantidad}] } del cuerpo, solo con las líneas que llevan lotes. */
export function cuerpoLotes(lineas, seleccion, lotesPorSku) {
  const res = {};
  for (const l of lineas || []) {
    const env = lotesParaEnviar(seleccion[l.sku], lotesPorSku[l.sku], Number(l.cantidad) || 0);
    if (env.length) res[l.sku] = env;
  }
  return res;
}

/* Lotes disponibles de los SKU de una guía armada a mano (guía libre / venta directa). */
export function useLotesPorSku(skus, activo = true) {
  const clave = activo ? [...new Set((skus || []).map((s) => String(s || "").replace(/\s+/g, "").toUpperCase()).filter(Boolean))].sort().join(",") : "";
  const [res, setRes] = useState({ clave: "", lotes: {}, hoy: null });
  useEffect(() => {
    if (!clave) return undefined;
    let vivo = true;
    api
      .get(`/bsale/despachos/lotes?skus=${encodeURIComponent(clave)}`)
      .then((r) => vivo && setRes({ clave, lotes: r?.lotes || {}, hoy: r?.hoy || null }))
      .catch(() => vivo && setRes({ clave, lotes: {}, hoy: null }));
    return () => { vivo = false; };
  }, [clave]);
  // Mientras llega la respuesta nueva se siguen mostrando los lotes que ya estaban.
  return { lotes: clave ? res.lotes : {}, hoy: res.hoy };
}

export default function SelectorLotes({ sku, lotes, cantidad, valor, onChange, disabled, hoy }) {
  const lista = useMemo(() => lotes || [], [lotes]);
  const ids = (valor?.ids || []).filter((id) => lista.some((l) => l.id === id));
  const enviar = lotesParaEnviar(valor, lista, cantidad);
  const suma = enviar.reduce((a, x) => a + x.cantidad, 0);
  const problema = problemaLotes(valor, lista, cantidad);
  const hoyRef = hoy || new Date().toISOString().slice(0, 10);

  const opciones = lista.map((l) => {
    const dias = diasHasta(l.vencimiento, hoyRef);
    const estado = dias < 0 ? " · VENCIDO" : dias <= 90 ? ` · vence en ${dias} día${dias === 1 ? "" : "s"}` : "";
    return { value: l.id, label: `Lote ${l.lote} · Venc. ${fechaLote(l.vencimiento)}`, detalle: `${num(l.disponible)} disponible${l.disponible === 1 ? "" : "s"} de ${num(l.recibido)} recibidas${estado}` };
  });
  const resumen = (elegidas) =>
    elegidas.length === 0
      ? lista.length ? `Elegir lote (${lista.length} disponible${lista.length === 1 ? "" : "s"})` : "Sin lotes disponibles"
      : elegidas.length === 1
        ? elegidas[0].label
        : `${elegidas.length} lotes: ${elegidas.map((o) => o.label.split(" · ")[0].replace(/^Lote /, "")).join(", ")}`;

  function cambiarCantidad(loteId, v) {
    const base = Object.fromEntries(enviar.map((a) => [a.lote_id, String(a.cantidad)]));
    onChange({ ids, cantidades: { ...base, [loteId]: String(v).replace(/[^\d.,]/g, "").replace(",", ".") }, base: Number(cantidad) });
  }

  return (
    <div className="selector-lotes" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", minWidth: 0 }}>
      <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".4px", color: "var(--text-muted)", whiteSpace: "nowrap" }} title="Lote y fecha de vencimiento (se cargan en Recepción de stock). Salen escritos en la línea de este producto en la guía.">
        Lote {sku}
      </span>
      <MultiSelect
        value={ids}
        onChange={(nuevos) => onChange({ ids: nuevos, cantidades: null, base: null })}
        options={opciones}
        disabled={disabled}
        minWidth={300}
        resumen={resumen}
        vacio="Este producto no tiene lotes con unidades disponibles."
        style={{ flex: "1 1 220px", minWidth: 0, maxWidth: 380, height: 28, padding: "2px 8px", fontSize: 12.5 }}
      />
      {ids.length >= 2 && (
        <span className="cantidades-lotes" style={{ display: "inline-flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          {enviar.map((a) => {
            const l = lista.find((x) => x.id === a.lote_id);
            const valorCampo = valor?.cantidades && valor.base === Number(cantidad) ? valor.cantidades[a.lote_id] ?? "" : String(a.cantidad);
            return (
              <label key={a.lote_id} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11.5, color: "var(--text-soft, #475569)", whiteSpace: "nowrap" }} title={`Unidades de esta línea que salen del lote ${l?.lote}`}>
                {l?.lote}
                <input
                  className="input"
                  inputMode="decimal"
                  value={valorCampo}
                  onChange={(e) => cambiarCantidad(a.lote_id, e.target.value)}
                  disabled={disabled}
                  style={{ width: 62, height: 26, padding: "2px 6px", textAlign: "right", fontSize: 12, borderColor: a.cantidad > (l?.disponible ?? Infinity) + 1e-9 ? "#d97706" : undefined }}
                />
              </label>
            );
          })}
          <span style={{ fontSize: 11.5, whiteSpace: "nowrap", color: problema ? "#b91c1c" : "var(--text-muted)", fontWeight: problema ? 600 : 400 }}>
            {problema || (suma < Number(cantidad) - 1e-9 ? `${num(Number(cantidad) - suma)} sin lote` : `suman ${num(suma)}`)}
          </span>
        </span>
      )}
      {ids.length === 1 && enviar[0] && enviar[0].cantidad > (lista.find((x) => x.id === ids[0])?.disponible ?? Infinity) + 1e-9 && (
        <span style={{ fontSize: 11.5, color: "#b45309", whiteSpace: "nowrap" }}>quedan {num(lista.find((x) => x.id === ids[0])?.disponible)} en el lote</span>
      )}
    </div>
  );
}
