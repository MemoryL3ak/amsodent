import { useState } from "react";
import { CheckCircle2, Receipt } from "lucide-react";
import { api } from "../lib/api";
import DateFilter from "./DateFilter";
import DropdownSelect from "./ui/DropdownSelect";

/* ── Comprobante de pago al emitir (2026-10-07) ──────────────────────────────
   Pedido de Ariel: "cuando se emite una factura, que dé la opción de agregar
   un número de comprobante". Queda como comprobante de pago de ESA factura o
   boleta (monto NETO, como todo en licitacion_documentos); si cubre el total,
   el servidor la deja pagada y Seguimiento de Pagos la muestra así. */

const MEDIOS = [
  { value: "transferencia", label: "Transferencia" },
  { value: "efectivo", label: "Efectivo" },
  { value: "transbank", label: "Transbank" },
  { value: "getnet", label: "Getnet" },
  { value: "cheque", label: "Cheque" },
  { value: "vale_vista", label: "Vale vista" },
];
const clp = (n) => `$${Math.round(Number(n) || 0).toLocaleString("es-CL")}`;
const hoy = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago" }).format(new Date());
const etiqueta = { fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".4px", color: "var(--text-muted)", display: "block", marginBottom: 4 };

export default function RegistrarComprobanteRapido({ licitacionId, documentoId, totalBruto, nombreDocumento = "la factura", onRegistrado }) {
  const [abierto, setAbierto] = useState(false);
  const [numero, setNumero] = useState("");
  const [fecha, setFecha] = useState(hoy());
  const [monto, setMonto] = useState(totalBruto ? String(Math.round(totalBruto)) : "");
  const [medio, setMedio] = useState("transferencia");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const [hecho, setHecho] = useState(null);

  if (!licitacionId || !documentoId) return null;

  async function guardar() {
    const bruto = Number(String(monto).replace(/\D/g, ""));
    if (!numero.trim()) { setError("Escribe el N° de comprobante."); return; }
    if (!(bruto > 0)) { setError("Indica el monto pagado."); return; }
    if (!fecha) { setError("Indica la fecha del pago."); return; }
    setGuardando(true);
    setError("");
    try {
      const r = await api.post("/licitaciones/documentos", {
        licitacion_id: Number(licitacionId),
        tipo: "comprobante_pago",
        numero: numero.trim(),
        monto: Math.round(bruto / 1.19), // los documentos se guardan en neto
        fecha_oc: fecha,
        deriva_de_id: Number(documentoId),
        forma_pago: medio,
      });
      setHecho({ numero: numero.trim(), bruto, pagada: !!r?.factura_pagada });
      onRegistrado?.(r);
    } catch (e) {
      setError(e?.message || "No se pudo registrar el comprobante.");
    } finally {
      setGuardando(false);
    }
  }

  if (hecho) {
    return (
      <div style={{ fontSize: 12.5, color: "#166534", display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        <CheckCircle2 size={14} /> Comprobante N° {hecho.numero} registrado por {clp(hecho.bruto)}.
        {hecho.pagada ? ` ${nombreDocumento[0].toUpperCase()}${nombreDocumento.slice(1)} quedó pagada.` : " Queda saldo por pagar en Seguimiento de Pagos."}
      </div>
    );
  }
  if (!abierto) {
    return (
      <button type="button" className="btn btn-secondary btn-sm" onClick={() => setAbierto(true)} style={{ alignSelf: "flex-start" }}>
        <Receipt size={13} /> Agregar N° de comprobante de pago
      </button>
    );
  }
  return (
    <div className="comprobante-rapido" style={{ border: "1px solid var(--border)", borderRadius: 10, padding: "10px 12px", background: "#fff", display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ fontSize: 12.5, fontWeight: 700 }}>Comprobante de pago de {nombreDocumento}</div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
        <label style={{ flex: "1 1 150px", minWidth: 0 }}>
          <span style={etiqueta}>N° de comprobante</span>
          <input className="input" value={numero} onChange={(e) => setNumero(e.target.value.slice(0, 60))} placeholder="Ej: 123456789" disabled={guardando} style={{ width: "100%" }} />
        </label>
        <div style={{ flex: "1 1 140px", minWidth: 0 }}>
          <span style={etiqueta}>Fecha del pago</span>
          <DateFilter value={fecha} onChange={setFecha} disabled={guardando} placeholder="Fecha" />
        </div>
        <label style={{ flex: "1 1 130px", minWidth: 0 }}>
          <span style={etiqueta}>Monto pagado (con IVA)</span>
          <input className="input" inputMode="numeric" value={monto ? Number(String(monto).replace(/\D/g, "")).toLocaleString("es-CL") : ""} onChange={(e) => setMonto(e.target.value.replace(/\D/g, "").slice(0, 12))} disabled={guardando} style={{ width: "100%" }} />
        </label>
        <div style={{ flex: "1 1 150px", minWidth: 0 }}>
          <span style={etiqueta}>Medio</span>
          <DropdownSelect value={medio} onChange={setMedio} options={MEDIOS} disabled={guardando} minWidth={150} style={{ width: "100%" }} />
        </div>
      </div>
      {error && <div style={{ fontSize: 12.5, color: "#b91c1c" }}>{error}</div>}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setAbierto(false)} disabled={guardando}>Cancelar</button>
        <button type="button" className="btn btn-primary btn-sm" onClick={guardar} disabled={guardando}>{guardando ? "Guardando…" : "Guardar comprobante"}</button>
      </div>
    </div>
  );
}
