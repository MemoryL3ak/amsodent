import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { MessageSquareWarning, Search, X } from "lucide-react";
import { api } from "../../lib/api";
import DropdownSelect from "../ui/DropdownSelect";
import ProductosAfectados from "./ProductosAfectados";
import { NOMBRE_DOCUMENTO, fechaCorta, quien } from "./postventaComun";

/* ── Ventana «Nueva solicitud de postventa» (2026-11-26) ─────────────────────
   Se elige el cliente (por nombre o RUT), opcionalmente la cotización afectada
   y, de ella, la factura o guía; luego la categoría, la descripción y los
   productos afectados. El vendedor responsable se propone solo (el de la
   cotización o, si no hay, el asignado al cliente); un administrador puede
   elegir otro. El servidor vuelve a validar todo (postventa.service.ts). */

const clp = (n) => `$${Math.round(Number(n) || 0).toLocaleString("es-CL")}`;
const etiqueta = { fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".4px", color: "var(--text-muted)", display: "block", marginBottom: 4 };

/* Clientes por nombre o RUT, con un pequeño retardo. */
function useBuscarClientes(q) {
  const t = q.trim();
  const [res, setRes] = useState({ q: "", clientes: [] });
  useEffect(() => {
    if (t.length < 2) return undefined;
    let vivo = true;
    const timer = setTimeout(() => {
      api
        .get(`/postventa/clientes?q=${encodeURIComponent(t)}`)
        .then((r) => vivo && setRes({ q: t, clientes: Array.isArray(r) ? r : [] }))
        .catch(() => vivo && setRes({ q: t, clientes: [] }));
    }, 300);
    return () => { vivo = false; clearTimeout(timer); };
  }, [t]);
  const vigente = t.length >= 2 && res.q === t;
  return { clientes: vigente ? res.clientes : [], buscando: t.length >= 2 && !vigente };
}

export default function NuevaSolicitudPostventa({ contexto, onCerrar, onCreada }) {
  const [q, setQ] = useState("");
  const { clientes, buscando } = useBuscarClientes(q);
  const [cliente, setCliente] = useState(null);
  const [cotizaciones, setCotizaciones] = useState(null); // null = cargando / sin cliente
  const [cartera, setCartera] = useState(null);
  const [licId, setLicId] = useState("");
  const [cot, setCot] = useState(null); // { cotizacion, documentos, productos } de la cotización elegida
  const [doc, setDoc] = useState(""); // "" | id del documento | "manual"
  const [docTipo, setDocTipo] = useState("factura");
  const [docNumero, setDocNumero] = useState("");
  const [categoria, setCategoria] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [productos, setProductos] = useState([]);
  const [vendedor, setVendedor] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState("");

  // Cotizaciones del cliente elegido.
  useEffect(() => {
    if (!cliente) return undefined;
    let vivo = true;
    api
      .get(`/postventa/cotizaciones?rut=${encodeURIComponent(cliente.rut)}`)
      .then((r) => { if (vivo) { setCotizaciones(Array.isArray(r?.cotizaciones) ? r.cotizaciones : []); setCartera(r?.vendedor_cartera || null); } })
      .catch((e) => { if (vivo) { setCotizaciones([]); setError(e?.message || "No se pudieron cargar las cotizaciones del cliente."); } });
    return () => { vivo = false; };
  }, [cliente]);

  // Documentos y productos de la cotización elegida.
  useEffect(() => {
    if (!licId) return undefined;
    let vivo = true;
    api
      .get(`/postventa/cotizaciones/${licId}`)
      .then((r) => vivo && setCot(r))
      .catch((e) => { if (vivo) { setCot({ cotizacion: null, documentos: [], productos: [] }); setError(e?.message || "No se pudo cargar la cotización."); } });
    return () => { vivo = false; };
  }, [licId]);

  function elegirCliente(c) {
    setCliente(c);
    setQ("");
    setCotizaciones(null);
    setCartera(null);
    elegirCotizacion("");
    setError("");
  }
  function elegirCotizacion(id) {
    setLicId(id);
    setCot(null);
    setDoc("");
    setProductos([]);
  }

  const cotSel = useMemo(() => (cotizaciones || []).find((c) => String(c.id) === String(licId)) || null, [cotizaciones, licId]);
  const docsAfectables = useMemo(() => (cot?.documentos || []).filter((d) => d.tipo === "factura" || d.tipo === "factura_boleta" || d.tipo === "guia_despacho"), [cot]);
  const propuesto = cotSel?.vendedor || cartera || contexto?.usuario_email || "";
  const manual = doc === "manual";
  const completo = !!cliente && !!categoria && descripcion.trim().length >= 5 && (!manual || docNumero.trim().length > 0) && !enviando;

  async function guardar() {
    if (!completo) return;
    setEnviando(true);
    setError("");
    try {
      const r = await api.post("/postventa", {
        cliente_rut: cliente.rut,
        cliente_nombre: cliente.nombre,
        licitacion_id: licId ? Number(licId) : null,
        ...(manual ? { documento_tipo: docTipo, documento_numero: docNumero.trim() } : doc ? { documento_id: Number(doc) } : {}),
        categoria,
        descripcion: descripcion.trim(),
        productos,
        ...(contexto?.es_admin && vendedor ? { vendedor_email: vendedor } : {}),
      });
      onCreada?.(r?.solicitud || null);
    } catch (e) {
      setError(e?.message || "No se pudo registrar la solicitud.");
      setEnviando(false);
    }
  }

  return createPortal(
    <div
      onMouseDown={(e) => { if (e.target === e.currentTarget && !enviando) onCerrar?.(); }}
      style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.55)", zIndex: 11000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
    >
      <div className="ventana-nueva-postventa" role="dialog" aria-modal="true" aria-label="Nueva solicitud de postventa" style={{ width: 780, maxWidth: "100%", maxHeight: "94vh", display: "flex", flexDirection: "column", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-lg)" }}>
        <div style={{ padding: "12px 18px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
          <strong style={{ fontSize: 15, display: "inline-flex", alignItems: "center", gap: 8 }}><MessageSquareWarning size={17} style={{ color: "var(--primary)" }} /> Nueva solicitud de postventa</strong>
          <button type="button" onClick={onCerrar} disabled={enviando} className="btn btn-ghost" style={{ padding: 6 }} aria-label="Cerrar"><X size={18} /></button>
        </div>

        <div style={{ padding: "14px 18px", display: "flex", flexDirection: "column", gap: 14, overflowY: "auto", minHeight: 0 }}>
          {/* Cliente */}
          <div>
            <span style={etiqueta}>Cliente *</span>
            {cliente ? (
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", border: "1px solid var(--border)", borderRadius: 10, padding: "8px 12px", background: "var(--bg)" }}>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: "block", fontWeight: 700, overflowWrap: "anywhere" }}>{cliente.nombre}</span>
                  <span style={{ display: "block", fontSize: 12, color: "var(--text-muted)" }}>{cliente.rut_formateado}{cliente.vendedor_asignado ? ` · vendedor asignado: ${quien(cliente.vendedor_asignado)}` : ""}</span>
                </span>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setCliente(null); setCotizaciones(null); elegirCotizacion(""); }} disabled={enviando}>Cambiar</button>
              </div>
            ) : (
              <div style={{ position: "relative" }}>
                <Search size={14} style={{ position: "absolute", left: 10, top: 12, color: "var(--text-muted)" }} />
                <input className="input buscador-cliente-postventa" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nombre o RUT…" style={{ width: "100%", paddingLeft: 30 }} />
                {q.trim().length >= 2 && (
                  <div style={{ marginTop: 4, border: "1px solid var(--border)", borderRadius: 10, maxHeight: 220, overflowY: "auto", padding: 4, background: "var(--surface)" }}>
                    {buscando && <div style={{ padding: 10, fontSize: 12.5, color: "var(--text-muted)" }}>Buscando…</div>}
                    {!buscando && clientes.length === 0 && <div style={{ padding: 10, fontSize: 12.5, color: "var(--text-muted)" }}>Ningún cliente calza con «{q.trim()}».</div>}
                    {clientes.map((c) => (
                      <button key={c.rut} type="button" onClick={() => elegirCliente(c)} style={{ display: "block", width: "100%", textAlign: "left", padding: "7px 10px", border: "none", borderRadius: 6, background: "transparent", cursor: "pointer", fontSize: 13, color: "var(--text)", fontFamily: "inherit" }}>
                        <span style={{ display: "block", fontWeight: 600, overflowWrap: "anywhere" }}>{c.nombre}</span>
                        <span style={{ display: "block", fontSize: 11.5, color: "var(--text-muted)" }}>{c.rut_formateado}{c.vendedor_asignado ? ` · ${quien(c.vendedor_asignado)}` : ""}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Cotización y documento afectado */}
          {cliente && (
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <div style={{ flex: "1 1 260px", minWidth: 0 }}>
                <span style={etiqueta}>Cotización o venta afectada</span>
                <DropdownSelect
                  value={licId} onChange={elegirCotizacion} disabled={enviando || cotizaciones === null} minWidth={300} style={{ width: "100%" }}
                  placeholder={cotizaciones === null ? "Cargando cotizaciones…" : "Sin cotización asociada"}
                  options={[
                    { value: "", label: cotizaciones === null ? "Cargando cotizaciones…" : cotizaciones.length ? "Sin cotización asociada" : "El cliente no tiene cotizaciones" },
                    ...(cotizaciones || []).map((c) => ({ value: String(c.id), label: `${c.id_licitacion || `#${c.id}`}${c.nombre ? ` · ${String(c.nombre).slice(0, 40)}` : ""}`, detalle: [c.estado, fechaCorta(c.created_at), c.total_con_iva ? clp(c.total_con_iva) : null, c.vendedor ? quien(c.vendedor) : null].filter(Boolean).join(" · ") })),
                  ]}
                />
              </div>
              <div style={{ flex: "1 1 220px", minWidth: 0 }}>
                <span style={etiqueta}>Documento afectado</span>
                <DropdownSelect
                  value={doc} onChange={setDoc} disabled={enviando || (!!licId && !cot)} minWidth={260} style={{ width: "100%" }}
                  options={[
                    { value: "", label: licId && !cot ? "Cargando documentos…" : "Sin documento específico" },
                    ...docsAfectables.map((d) => ({ value: String(d.id), label: `${NOMBRE_DOCUMENTO[d.tipo] || d.tipo} N° ${d.numero || "s/n"}`, detalle: d.fecha ? fechaCorta(d.fecha) : undefined })),
                    { value: "manual", label: "Otro: escribir el número" },
                  ]}
                />
              </div>
              {manual && (
                <>
                  <div style={{ flex: "1 1 160px", minWidth: 0 }}>
                    <span style={etiqueta}>Tipo</span>
                    <DropdownSelect value={docTipo} onChange={setDocTipo} disabled={enviando} minWidth={180} style={{ width: "100%" }} options={[{ value: "factura", label: "Factura o boleta" }, { value: "guia_despacho", label: "Guía de despacho" }]} />
                  </div>
                  <div style={{ flex: "1 1 140px", minWidth: 0 }}>
                    <span style={etiqueta}>N° del documento *</span>
                    <input className="input" value={docNumero} onChange={(e) => setDocNumero(e.target.value.slice(0, 40))} disabled={enviando} placeholder="Ej: 12345" style={{ width: "100%" }} />
                  </div>
                </>
              )}
            </div>
          )}

          {/* Categoría y descripción */}
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 240px", minWidth: 0 }}>
              <span style={etiqueta}>Categoría *</span>
              <DropdownSelect value={categoria} onChange={setCategoria} disabled={enviando} minWidth={280} style={{ width: "100%" }} placeholder="Elige la categoría" options={(contexto?.categorias || []).map((c, i) => ({ value: c.clave, label: `${i + 1}. ${c.nombre}` }))} />
            </div>
            <div style={{ flex: "1 1 240px", minWidth: 0 }}>
              <span style={etiqueta}>Vendedor responsable</span>
              {contexto?.es_admin ? (
                <DropdownSelect
                  value={vendedor} onChange={setVendedor} disabled={enviando} minWidth={280} style={{ width: "100%" }}
                  options={[{ value: "", label: `Propuesto: ${quien(propuesto)}`, detalle: cotSel?.vendedor ? "Vendedor de la cotización" : cartera ? "Vendedor asignado del cliente" : "Quien registra la solicitud" }, ...(contexto?.vendedores || []).map((v) => ({ value: v.email, label: v.nombre, detalle: v.email }))]}
                />
              ) : (
                <div className="input" style={{ display: "flex", alignItems: "center", background: "var(--bg)", color: "var(--text-soft)", width: "100%" }} title={cotSel?.vendedor ? "Vendedor de la cotización" : cartera ? "Vendedor asignado del cliente" : "Quien registra la solicitud"}>
                  {quien(propuesto)}
                </div>
              )}
            </div>
          </div>
          <div>
            <span style={etiqueta}>Descripción del reclamo *</span>
            <textarea className="input campo-descripcion-postventa" value={descripcion} onChange={(e) => setDescripcion(e.target.value.slice(0, 2000))} disabled={enviando} rows={3} placeholder="Qué pasó, cuándo y qué pide el cliente" style={{ width: "100%", height: "auto", minHeight: 76, padding: "8px 10px", resize: "vertical" }} />
          </div>

          {/* Productos afectados */}
          <div>
            <span style={etiqueta}>Productos afectados (opcional)</span>
            <ProductosAfectados key={licId || "sin-cotizacion"} sugeridos={cot?.productos || []} onCambiar={setProductos} disabled={enviando} />
          </div>

          {error && <div style={{ fontSize: 12.5, color: "#dc2626", fontWeight: 600 }}>{error}</div>}
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "11px 18px", borderTop: "1px solid var(--border)", background: "var(--bg)" }}>
          <span style={{ fontSize: 12, color: "var(--text-muted)", flex: "1 1 240px", minWidth: 0 }}>
            La solicitud queda «Ingresada» y el vendedor responsable recibe el aviso en su campana.
          </span>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button type="button" className="btn btn-secondary" onClick={onCerrar} disabled={enviando}>Cancelar</button>
            <button type="button" className="btn btn-primary btn-registrar-postventa" onClick={guardar} disabled={!completo} title={completo ? "Registra la solicitud" : "Falta el cliente, la categoría o la descripción"}>
              {enviando ? "Registrando…" : "Registrar solicitud"}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
