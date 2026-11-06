import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Download, FlaskConical, PackagePlus, Plus, RefreshCw, Search, Trash2, X } from "lucide-react";
import { api } from "../lib/api";
import DropdownSelect from "../components/ui/DropdownSelect";
import BotonLimpiarFiltros from "../components/BotonLimpiarFiltros";
import Toast from "../components/Toast";

/* ── Recepción de stock (la de Bsale) — 2026-11-06 ──────────────────────────
   Pedido de Ariel: "módulo recepción de Bsale" («sirve para cargar stock; el
   stock se carga según Guía, Factura, Despacho interno o sin documentos
   asociados»).

   La «Recepción de stock» de Bsale hecha desde la plataforma: sucursal, con
   qué documento llegó la mercadería y las líneas (producto, cantidad y costo
   neto unitario). Al registrar, el servidor crea la recepción en Bsale y suma
   las unidades al inventario de la sucursal (backend/src/bsale/
   bsale-recepciones.service.ts). Como toda escritura en Bsale, va en dos
   pasos: «Simular» (vista previa, no escribe) y «Registrar recepción», que
   solo se habilita con una simulación vigente y sin problemas.

   La bandeja es una tabla paginada con el detalle de cada recepción al
   desplegarla. Entra el admin o quien tenga «Recepción de stock» en su perfil. */

const POR_PAGINA = 12;
const clp = (n) => `$${Math.round(Number(n) || 0).toLocaleString("es-CL")}`;
const num = (n) => (n == null || n === "" ? "—" : Number(n).toLocaleString("es-CL", { maximumFractionDigits: 2 }));
const sinTildes = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const fechaHora = (iso) => (iso ? new Date(iso).toLocaleString("es-CL", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");
const diaCorto = (ymd) => {
  const m = String(ymd || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : "";
};
const quien = (email) => String(email || "").split("@")[0] || "—";
const soloNumero = (v) => String(v ?? "").replace(/[^\d.,]/g, "");
const aNumero = (v) => Number(String(v ?? "").replace(/\./g, "").replace(",", ".")) || 0;
const mesDe = (iso) => String(iso || "").slice(0, 7);

/* Busca productos del catálogo con SKU (SKU o nombre), con un pequeño retardo. */
function useBuscarProductos(q) {
  const t = q.trim();
  const [res, setRes] = useState({ q: "", productos: [] });
  useEffect(() => {
    if (t.length < 2) return undefined;
    let vivo = true;
    const timer = setTimeout(() => {
      api
        .get(`/recepciones-stock/productos?q=${encodeURIComponent(t)}`)
        .then((r) => vivo && setRes({ q: t, productos: Array.isArray(r) ? r : [] }))
        .catch(() => vivo && setRes({ q: t, productos: [] }));
    }, 300);
    return () => { vivo = false; clearTimeout(timer); };
  }, [t]);
  const vigente = t.length >= 2 && res.q === t;
  return { productos: vigente ? res.productos : [], buscando: t.length >= 2 && !vigente };
}

function Paginador({ pagina, total, onCambiar }) {
  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA));
  if (total <= POR_PAGINA) return null;
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "10px 4px", fontSize: 12.5, color: "var(--text-soft)" }}>
      <span>{(pagina - 1) * POR_PAGINA + 1}–{Math.min(pagina * POR_PAGINA, total)} de {total.toLocaleString("es-CL")} recepciones</span>
      <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
        <button type="button" className="btn btn-secondary btn-sm" disabled={pagina <= 1} onClick={() => onCambiar(pagina - 1)}>Anterior</button>
        <span>Página {pagina} de {paginas}</span>
        <button type="button" className="btn btn-secondary btn-sm" disabled={pagina >= paginas} onClick={() => onCambiar(pagina + 1)}>Siguiente</button>
      </span>
    </div>
  );
}

/* Ventana «Nueva recepción»: cabecera, líneas, simulación y registro. */
function ModalRecepcion({ contexto, onCerrar, onRegistrada }) {
  const principal = contexto.sucursales.find((s) => s.es_principal) || contexto.sucursales[0] || null;
  const [sucursalId, setSucursalId] = useState(principal ? String(principal.id) : "");
  const [tipo, setTipo] = useState("guia");
  const [numero, setNumero] = useState("");
  const [fecha, setFecha] = useState("");
  const [proveedorId, setProveedorId] = useState("");
  const [nota, setNota] = useState("");
  const [lineas, setLineas] = useState([]); // { producto_id, sku, nombre, stock, cantidad, costo }
  const [q, setQ] = useState("");
  const { productos, buscando } = useBuscarProductos(q);
  const [enviando, setEnviando] = useState(""); // "" | "simular" | "registrar"
  const [simulacion, setSimulacion] = useState(null);
  const [simuladoCon, setSimuladoCon] = useState(null);
  const [error, setError] = useState("");

  const tipoSel = contexto.tipos.find((t) => t.clave === tipo);
  const conNumero = tipoSel?.con_numero !== false;
  const cuerpo = useMemo(() => ({
    sucursal_id: sucursalId ? Number(sucursalId) : null,
    tipo_documento: tipo,
    documento_numero: conNumero ? numero.trim() : "",
    documento_fecha: fecha || null,
    proveedor_id: proveedorId ? Number(proveedorId) : null,
    nota: nota.trim(),
    lineas: lineas.map((l) => ({ producto_id: l.producto_id, cantidad: aNumero(l.cantidad), costo_unitario: l.costo === "" ? null : aNumero(l.costo) })),
  }), [sucursalId, tipo, conNumero, numero, fecha, proveedorId, nota, lineas]);
  // La simulación vale para ESTOS datos: si cambia algo, caduca y hay que simular de nuevo.
  const firma = JSON.stringify(cuerpo);
  const simulacionVigente = !!simulacion && simuladoCon === firma;
  const lineasValidas = lineas.length > 0 && lineas.every((l) => aNumero(l.cantidad) > 0);
  const completo = !!sucursalId && lineasValidas && (!conNumero || numero.trim().length > 0) && !enviando;
  const puedeRegistrar = completo && simulacionVigente && simulacion.problemas.length === 0 && contexto.emision_activa !== false;
  const totalCosto = lineas.reduce((a, l) => a + aNumero(l.cantidad) * aNumero(l.costo), 0);
  const totalUnidades = lineas.reduce((a, l) => a + aNumero(l.cantidad), 0);

  function agregar(p) {
    setLineas((prev) => (prev.some((l) => l.producto_id === p.id) ? prev : [...prev, { producto_id: p.id, sku: p.sku, nombre: p.nombre, stock: p.stock, cantidad: "1", costo: p.costo ? String(Math.round(p.costo)) : "" }]));
    setQ("");
  }
  const cambiar = (id, campo, valor) => setLineas((prev) => prev.map((l) => (l.producto_id === id ? { ...l, [campo]: valor } : l)));
  const quitar = (id) => setLineas((prev) => prev.filter((l) => l.producto_id !== id));

  async function simular() {
    if (!completo) return;
    setEnviando("simular");
    setError("");
    try {
      const r = await api.post("/recepciones-stock/simular", cuerpo);
      setSimulacion(r);
      setSimuladoCon(firma);
    } catch (e) {
      setSimulacion(null);
      setError(e?.message || "No se pudo simular la recepción.");
    } finally {
      setEnviando("");
    }
  }
  async function registrar() {
    if (!puedeRegistrar) return;
    setEnviando("registrar");
    setError("");
    try {
      onRegistrada(await api.post("/recepciones-stock", { ...cuerpo, huella: simulacion.huella }));
    } catch (e) {
      setError(e?.message || "No se pudo registrar la recepción.");
      setSimulacion(null);
      setEnviando("");
    }
  }

  const etiqueta = { fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".4px", color: "var(--text-muted)", display: "block", marginBottom: 4 };
  return createPortal(
    <div
      onMouseDown={(e) => { if (e.target === e.currentTarget && !enviando) onCerrar(); }}
      style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.55)", zIndex: 11000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
    >
      <div className="ventana-recepcion" role="dialog" aria-modal="true" aria-label="Nueva recepción de stock" style={{ width: 920, maxWidth: "100%", maxHeight: "94vh", display: "flex", flexDirection: "column", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-lg)" }}>
        <div style={{ padding: "12px 18px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
          <strong style={{ fontSize: 15, display: "inline-flex", alignItems: "center", gap: 8 }}><PackagePlus size={17} style={{ color: "var(--primary)" }} /> Nueva recepción de stock</strong>
          <button type="button" onClick={onCerrar} disabled={!!enviando} className="btn btn-ghost" style={{ padding: 6 }} aria-label="Cerrar"><X size={18} /></button>
        </div>

        <div style={{ padding: "14px 18px", display: "flex", flexDirection: "column", gap: 14, overflowY: "auto", minHeight: 0 }}>
          {/* Cabecera */}
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 200px", minWidth: 0 }}>
              <span style={etiqueta}>Sucursal que recibe *</span>
              <DropdownSelect
                value={sucursalId} onChange={setSucursalId} disabled={!!enviando} minWidth={240} style={{ width: "100%" }} placeholder="Elige la sucursal"
                options={contexto.sucursales.map((s) => ({ value: String(s.id), label: s.nombre, detalle: s.bsale_office_id ? `Sucursal ${s.bsale_office_id} de Bsale` : "Sin asociar a Bsale", color: s.bsale_office_id ? "#16a34a" : "#dc2626" }))}
              />
            </div>
            <div style={{ flex: "1 1 190px", minWidth: 0 }}>
              <span style={etiqueta}>Documento *</span>
              <DropdownSelect value={tipo} onChange={setTipo} disabled={!!enviando} minWidth={220} style={{ width: "100%" }} options={contexto.tipos.map((t) => ({ value: t.clave, label: t.nombre }))} />
            </div>
            <div style={{ flex: "1 1 150px", minWidth: 0 }}>
              <span style={etiqueta}>N° del documento {conNumero ? "*" : ""}</span>
              <input className="input campo-numero-documento" value={conNumero ? numero : ""} onChange={(e) => setNumero(e.target.value.slice(0, 40))} disabled={!conNumero || !!enviando} placeholder={conNumero ? "Ej: 12345" : "No aplica"} style={{ width: "100%" }} />
            </div>
            <div style={{ flex: "1 1 150px", minWidth: 0 }}>
              <span style={etiqueta}>Fecha del documento</span>
              <input type="date" className="input" value={fecha} onChange={(e) => setFecha(e.target.value)} disabled={!!enviando} style={{ width: "100%" }} />
            </div>
          </div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 240px", minWidth: 0 }}>
              <span style={etiqueta}>Proveedor (opcional)</span>
              <DropdownSelect
                value={proveedorId} onChange={setProveedorId} disabled={!!enviando} minWidth={260} style={{ width: "100%" }}
                options={[{ value: "", label: contexto.proveedores.length ? "Sin proveedor" : "No hay proveedores cargados" }, ...contexto.proveedores.map((p) => ({ value: String(p.id), label: p.razon_social, detalle: p.rut || undefined }))]}
              />
            </div>
            <div style={{ flex: "2 1 300px", minWidth: 0 }}>
              <span style={etiqueta}>Nota (opcional)</span>
              <input className="input" value={nota} onChange={(e) => setNota(e.target.value.slice(0, 300))} disabled={!!enviando} placeholder="Ej: llegó en dos bultos, falta una caja" style={{ width: "100%" }} />
            </div>
          </div>

          {/* Líneas */}
          <div>
            <span style={etiqueta}>Productos recibidos *</span>
            <div style={{ position: "relative" }}>
              <Search size={14} style={{ position: "absolute", left: 10, top: 12, color: "var(--text-muted)" }} />
              <input className="input buscador-producto-recepcion" value={q} onChange={(e) => setQ(e.target.value)} disabled={!!enviando} placeholder="Buscar por SKU o nombre para agregar un producto…" style={{ width: "100%", paddingLeft: 30 }} />
              {q.trim().length >= 2 && (
                <div className="resultados-producto-recepcion" style={{ marginTop: 4, border: "1px solid var(--border)", borderRadius: 10, maxHeight: 200, overflowY: "auto", padding: 4, background: "var(--surface)" }}>
                  {buscando && <div style={{ padding: "10px", fontSize: 12.5, color: "var(--text-muted)" }}>Buscando…</div>}
                  {!buscando && productos.length === 0 && <div style={{ padding: "10px", fontSize: 12.5, color: "var(--text-muted)" }}>Ningún producto con SKU calza con «{q.trim()}».</div>}
                  {productos.map((p) => {
                    const ya = lineas.some((l) => l.producto_id === p.id);
                    return (
                      <button key={p.id} type="button" disabled={ya} onClick={() => agregar(p)} style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left", padding: "7px 10px", border: "none", borderRadius: 6, background: "transparent", cursor: ya ? "default" : "pointer", opacity: ya ? 0.5 : 1, fontSize: 13, color: "var(--text)" }}>
                        <Plus size={14} style={{ color: "var(--primary)", flexShrink: 0 }} />
                        <span style={{ flex: 1, minWidth: 0 }}>
                          <span style={{ display: "block", fontWeight: 600, overflowWrap: "anywhere" }}>{p.nombre}</span>
                          <span style={{ display: "block", fontSize: 11.5, color: "var(--text-muted)" }}>{p.sku}{p.marca ? ` · ${p.marca}` : ""} · stock {num(p.stock)}{p.costo ? ` · costo ${clp(p.costo)}` : " · sin costo"}{p.en_bsale ? "" : " · se busca en Bsale por SKU"}{ya ? " · ya está en la recepción" : ""}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="table-wrap" style={{ margin: "8px 0 0" }}>
              <table className="data-table tabla-compacta tabla-texto tabla-lineas-recepcion" style={{ minWidth: 620 }}>
                <thead>
                  <tr>
                    <th>Producto</th>
                    <th style={{ textAlign: "right" }}>Stock hoy</th>
                    <th style={{ textAlign: "right", width: 110 }}>Cantidad</th>
                    <th style={{ textAlign: "right", width: 140 }}>Costo neto unit.</th>
                    <th style={{ textAlign: "right" }}>Subtotal</th>
                    <th style={{ width: 36 }} aria-label="Quitar" />
                  </tr>
                </thead>
                <tbody>
                  {lineas.length === 0 && <tr><td colSpan={6} style={{ textAlign: "center", padding: "22px 12px", color: "var(--text-muted)" }}>Busca arriba los productos que llegaron y agrégalos.</td></tr>}
                  {lineas.map((l) => (
                    <tr key={l.producto_id}>
                      <td style={{ minWidth: 200 }}>
                        <div style={{ fontWeight: 600, overflowWrap: "anywhere" }}>{l.nombre}</div>
                        <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>{l.sku}</div>
                      </td>
                      <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>{num(l.stock)}</td>
                      <td style={{ textAlign: "right" }}>
                        <input className="input campo-cantidad-recepcion" inputMode="decimal" value={l.cantidad} onChange={(e) => cambiar(l.producto_id, "cantidad", soloNumero(e.target.value))} disabled={!!enviando} style={{ width: 90, textAlign: "right", height: 32, borderColor: aNumero(l.cantidad) > 0 ? undefined : "#dc2626" }} />
                      </td>
                      <td style={{ textAlign: "right" }}>
                        <input className="input" inputMode="numeric" value={l.costo} onChange={(e) => cambiar(l.producto_id, "costo", soloNumero(e.target.value))} disabled={!!enviando} placeholder="$0" style={{ width: 120, textAlign: "right", height: 32 }} />
                      </td>
                      <td style={{ textAlign: "right", fontWeight: 700, whiteSpace: "nowrap" }}>{clp(aNumero(l.cantidad) * aNumero(l.costo))}</td>
                      <td style={{ textAlign: "right" }}>
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => quitar(l.producto_id)} disabled={!!enviando} title="Quitar de la recepción" style={{ color: "#dc2626", padding: "2px 6px" }}><Trash2 size={13} /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                {lineas.length > 0 && (
                  <tfoot>
                    <tr>
                      <td style={{ fontWeight: 700 }}>Total · {lineas.length} producto{lineas.length === 1 ? "" : "s"}</td>
                      <td />
                      <td style={{ textAlign: "right", fontWeight: 700 }}>{num(totalUnidades)}</td>
                      <td />
                      <td style={{ textAlign: "right", fontWeight: 700, whiteSpace: "nowrap" }}>{clp(totalCosto)}</td>
                      <td />
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>

          {/* Resultado de la simulación */}
          {simulacionVigente && (
            <div className="simulacion-recepcion" style={{ border: `1px solid ${simulacion.problemas.length ? "#fecaca" : "#bbf7d0"}`, background: simulacion.problemas.length ? "#fef2f2" : "#f0fdf4", borderRadius: 10, padding: "10px 12px", fontSize: 12.5, lineHeight: 1.5 }}>
              <div style={{ fontWeight: 700, color: simulacion.problemas.length ? "#991b1b" : "#14532d", display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                {simulacion.problemas.length ? <AlertTriangle size={15} /> : <CheckCircle2 size={15} />}
                {simulacion.problemas.length ? "La simulación encontró problemas: no se puede registrar todavía" : `Simulación correcta: entrarían ${num(simulacion.totales.unidades)} unidades por ${clp(simulacion.totales.costo)} a ${simulacion.sucursal?.nombre || "la sucursal"}`}
              </div>
              {simulacion.problemas.length > 0 && <ul style={{ margin: "0 0 4px", paddingLeft: 18, color: "#991b1b" }}>{simulacion.problemas.map((p, i) => <li key={i}>{p}</li>)}</ul>}
              {simulacion.avisos.length > 0 && <ul style={{ margin: "0 0 4px", paddingLeft: 18, color: "#92400e" }}>{simulacion.avisos.map((a, i) => <li key={i}>{a}</li>)}</ul>}
              {!simulacion.problemas.length && (
                <div style={{ color: "#166534" }}>
                  Bsale recibiría una recepción «{simulacion.solicitud.document}»{simulacion.documento.numero ? ` N° ${simulacion.documento.numero}` : ""} en la sucursal {simulacion.solicitud.officeId} con {simulacion.solicitud.details.length} línea{simulacion.solicitud.details.length === 1 ? "" : "s"}.
                  Stock en la sucursal: {simulacion.lineas.slice(0, 4).map((l) => `${l.sku} ${num(l.stock_antes)} → ${num(l.stock_despues)}`).join(" · ")}{simulacion.lineas.length > 4 ? ` · y ${simulacion.lineas.length - 4} más` : ""}.
                </div>
              )}
            </div>
          )}
          {error && <div style={{ fontSize: 12.5, color: "#dc2626", fontWeight: 600 }}>{error}</div>}
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "11px 18px", borderTop: "1px solid var(--border)", background: "var(--bg)" }}>
          <span style={{ fontSize: 12, color: "var(--text-muted)", flex: "1 1 240px", minWidth: 0 }}>
            {simulacionVigente ? "Si cambias algo hay que simular de nuevo." : "Primero simula: verás lo que se enviará a Bsale y cómo queda el stock, sin escribir nada."}
          </span>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button type="button" className="btn btn-secondary" onClick={onCerrar} disabled={!!enviando}>Cancelar</button>
            <button type="button" className="btn btn-secondary btn-simular-recepcion" onClick={simular} disabled={!completo} style={{ display: "inline-flex", alignItems: "center", gap: 6 }} title="Vista previa: no escribe en Bsale ni en el inventario">
              <FlaskConical size={14} /> {enviando === "simular" ? "Simulando…" : "Simular"}
            </button>
            <button type="button" className="btn btn-primary btn-registrar-recepcion" onClick={registrar} disabled={!puedeRegistrar} style={{ display: "inline-flex", alignItems: "center", gap: 6 }} title={puedeRegistrar ? "Crea la recepción en Bsale y suma el stock al inventario" : contexto.emision_activa === false ? "Las escrituras en Bsale están apagadas en este servidor" : "Simula primero (y resuelve los problemas, si los hay)"}>
              <PackagePlus size={14} /> {enviando === "registrar" ? "Registrando…" : "Registrar recepción"}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export default function RecepcionStock() {
  const [contexto, setContexto] = useState(null);
  const [recepciones, setRecepciones] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [toast, setToast] = useState(null);
  const [nueva, setNueva] = useState(false);
  const [q, setQ] = useState("");
  const [tipo, setTipo] = useState("");
  const [pagina, setPagina] = useState(1);
  const [abierta, setAbierta] = useState(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const [c, r] = await Promise.all([api.get("/recepciones-stock/contexto"), api.get("/recepciones-stock")]);
      setContexto(c);
      setRecepciones(Array.isArray(r?.recepciones) ? r.recepciones : []);
    } catch (e) {
      setToast({ type: "error", message: e?.message || "No se pudieron cargar las recepciones." });
      setRecepciones((prev) => prev || []);
    } finally {
      setCargando(false);
    }
  }, []);
  useEffect(() => { cargar(); }, [cargar]);
  useEffect(() => { setPagina(1); setAbierta(null); }, [q, tipo]);

  const texto = sinTildes(q.trim());
  const filtradas = useMemo(
    () => (recepciones || []).filter((r) => (!tipo || r.tipo_documento === tipo) && (!texto || sinTildes(`#${r.id} ${r.tipo_nombre} ${r.documento_numero || ""} ${r.proveedor} ${r.sucursal} ${r.usuario_email} ${r.nota} ${r.lineas.map((l) => `${l.sku} ${l.nombre}`).join(" ")}`).includes(texto))),
    [recepciones, tipo, texto],
  );
  const paginaActual = Math.min(pagina, Math.max(1, Math.ceil(filtradas.length / POR_PAGINA)));
  const visibles = filtradas.slice((paginaActual - 1) * POR_PAGINA, paginaActual * POR_PAGINA);

  const kpis = useMemo(() => {
    const registradas = (recepciones || []).filter((r) => r.estado === "registrada");
    const mes = new Date().toISOString().slice(0, 7);
    const delMes = registradas.filter((r) => mesDe(r.created_at) === mes);
    return {
      mes: delMes.length,
      unidades: delMes.reduce((a, r) => a + r.total_unidades, 0),
      costo: delMes.reduce((a, r) => a + r.total_costo, 0),
      total: registradas.length,
      ultima: registradas[0] || null,
    };
  }, [recepciones]);

  async function exportar() {
    try {
      const XLSX = await import("xlsx");
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(filtradas.map((r) => ({
        "N°": r.id, Fecha: fechaHora(r.created_at), Documento: r.tipo_nombre, "N° documento": r.documento_numero || "", "Fecha documento": diaCorto(r.documento_fecha), Sucursal: r.sucursal,
        Proveedor: r.proveedor, Líneas: r.total_lineas, Unidades: r.total_unidades, "Costo total": r.total_costo, "Recepción Bsale": r.bsale_reception_id ?? "", Estado: r.estado === "registrada" ? "Registrada" : "Fallida", Usuario: r.usuario_email, Nota: r.nota,
      }))), "Recepciones");
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(filtradas.flatMap((r) => r.lineas.map((l) => ({
        "Recepción N°": r.id, Fecha: fechaHora(r.created_at), Documento: `${r.tipo_nombre}${r.documento_numero ? ` ${r.documento_numero}` : ""}`, SKU: l.sku, Producto: l.nombre, Cantidad: l.cantidad, "Costo neto unitario": l.costo_unitario, Subtotal: l.subtotal,
      })))), "Productos");
      XLSX.writeFile(wb, "recepciones-de-stock.xlsx");
    } catch (err) {
      setToast({ type: "error", message: err?.message || "No se pudo exportar." });
    }
  }

  const bloqueo = contexto?.listo === false
    ? contexto.mensaje
    : contexto && !contexto.bsale_configurado
      ? "La integración con Bsale no está configurada en este servidor: se puede simular, pero no registrar."
      : contexto && contexto.sucursales.length === 0
        ? "El Inventario no tiene sucursales activas: créalas o tráelas de Bsale en Inventario → Sucursales."
        : null;

  return (
    <div className="page pagina-recepcion-stock">
      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}
      {nueva && contexto && (
        <ModalRecepcion
          contexto={contexto}
          onCerrar={() => setNueva(false)}
          onRegistrada={(r) => {
            setNueva(false);
            setToast({ type: r?.avisos?.length ? "warning" : "success", message: r?.avisos?.length ? `Recepción #${r.recepcion?.id} registrada en Bsale, con avisos: ${r.avisos[0]}` : `Recepción #${r.recepcion?.id} registrada: el stock ya está en el inventario${r.bsale_reception_id ? ` (recepción ${r.bsale_reception_id} de Bsale)` : ""}.` });
            cargar();
          }}
        />
      )}

      <div className="page-header">
        <div style={{ minWidth: 0 }}>
          <h1 className="page-title">Recepción de stock</h1>
          <p className="page-subtitle">Carga el stock que llega con guía, factura, despacho interno o sin documento. La recepción se crea en Bsale y suma las unidades al inventario de la sucursal.</p>
        </div>
        <div className="page-actions" style={{ flexWrap: "wrap" }}>
          <button type="button" className="btn btn-secondary" onClick={exportar} disabled={!filtradas.length} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Download size={14} /> Excel</button>
          <button type="button" className="btn btn-secondary" onClick={cargar} disabled={cargando} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><RefreshCw size={14} className={cargando ? "spin" : ""} /> Actualizar</button>
          <button type="button" className="btn btn-primary btn-nueva-recepcion" onClick={() => setNueva(true)} disabled={!contexto || contexto.listo === false || contexto.sucursales.length === 0} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <PackagePlus size={15} /> Nueva recepción
          </button>
        </div>
      </div>

      {bloqueo && (
        <div style={{ display: "flex", gap: 10, fontSize: 13, color: "#78350f", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 10, padding: "10px 14px", marginBottom: 14 }}>
          <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 1, color: "#d97706" }} /> {bloqueo}
        </div>
      )}

      <div className="stats-row">
        <div className="stat-card">
          <div className="stat-label">Recepciones de este mes</div>
          <div className="stat-value">{num(kpis.mes)}</div>
          <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 2 }}>{num(kpis.total)} en total</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Unidades recibidas (mes)</div>
          <div className="stat-value">{num(kpis.unidades)}</div>
          <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 2 }}>sumadas al inventario</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Costo recibido (mes)</div>
          <div className="stat-value">{clp(kpis.costo)}</div>
          <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 2 }}>a costo neto de cada recepción</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Última recepción</div>
          <div className="stat-value" style={{ fontSize: 20 }}>{kpis.ultima ? `#${kpis.ultima.id}` : "—"}</div>
          <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 2 }}>{kpis.ultima ? `${fechaHora(kpis.ultima.created_at)} · ${quien(kpis.ultima.usuario_email)}` : "Todavía no hay recepciones"}</div>
        </div>
      </div>

      <div className="filter-bar" style={{ alignItems: "flex-end", gap: 12, flexWrap: "wrap" }}>
        <div className="filter-field" style={{ flex: "2 1 240px", minWidth: 0 }}>
          <label className="filter-label">Buscar</label>
          <span style={{ position: "relative", display: "block" }}>
            <Search size={14} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)", pointerEvents: "none" }} />
            <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="N° de documento, proveedor, SKU, producto…" style={{ width: "100%", paddingLeft: 30 }} />
          </span>
        </div>
        <div className="filter-field" style={{ flex: "1 1 180px", minWidth: 0, maxWidth: 260 }}>
          <label className="filter-label">Documento</label>
          <DropdownSelect value={tipo} onChange={setTipo} minWidth={200} style={{ width: "100%" }} options={[{ value: "", label: "Todos" }, ...(contexto?.tipos || []).map((t) => ({ value: t.clave, label: t.nombre }))]} />
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginLeft: "auto" }}>
          <BotonLimpiarFiltros hay={!!q.trim() || !!tipo} onLimpiar={() => { setQ(""); setTipo(""); }} />
        </div>
      </div>

      <div className="table-wrap" style={{ marginTop: 12 }}>
        <table className="data-table tabla-compacta tabla-texto tabla-recepciones" style={{ minWidth: 760 }}>
          <thead>
            <tr>
              <th style={{ width: 28 }} aria-label="Detalle" />
              <th>Recepción</th>
              <th>Documento</th>
              <th>Sucursal · proveedor</th>
              <th style={{ textAlign: "right" }}>Unidades</th>
              <th style={{ textAlign: "right" }}>Costo total</th>
              <th>Bsale</th>
            </tr>
          </thead>
          <tbody>
            {recepciones === null && <tr><td colSpan={7} style={{ textAlign: "center", padding: "40px 0", color: "var(--text-muted)" }}>Cargando…</td></tr>}
            {recepciones !== null && filtradas.length === 0 && (
              <tr><td colSpan={7} style={{ textAlign: "center", padding: "40px 16px", color: "var(--text-muted)" }}>
                {recepciones.length ? "Ninguna recepción calza con los filtros." : "Todavía no hay recepciones. Registra la primera con «Nueva recepción»."}
              </td></tr>
            )}
            {visibles.map((r) => {
              const ab = abierta === r.id;
              const fallida = r.estado !== "registrada";
              return (
                <Fragment key={r.id}>
                  <tr className="fila-recepcion" onClick={() => setAbierta(ab ? null : r.id)} style={{ cursor: "pointer", background: ab ? "var(--bg)" : undefined }} title={ab ? "Ocultar el detalle" : "Ver los productos de la recepción"}>
                    <td style={{ color: "var(--text-muted)" }}>{ab ? <ChevronDown size={15} /> : <ChevronRight size={15} />}</td>
                    <td>
                      <div style={{ fontWeight: 700 }}>#{r.id}</div>
                      <div style={{ fontSize: 11.5, color: "var(--text-muted)", whiteSpace: "nowrap" }}>{fechaHora(r.created_at)} · {quien(r.usuario_email)}</div>
                    </td>
                    <td>
                      <div style={{ fontWeight: 600 }}>{r.tipo_nombre}{r.documento_numero ? ` N° ${r.documento_numero}` : ""}</div>
                      {r.documento_fecha && <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>del {diaCorto(r.documento_fecha)}</div>}
                    </td>
                    <td style={{ maxWidth: 240, overflowWrap: "anywhere" }}>
                      {r.sucursal || "—"}
                      {r.proveedor && <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>{r.proveedor}</div>}
                    </td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      <div style={{ fontWeight: 700 }}>{num(r.total_unidades)}</div>
                      <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>{r.total_lineas} producto{r.total_lineas === 1 ? "" : "s"}</div>
                    </td>
                    <td style={{ textAlign: "right", fontWeight: 700, whiteSpace: "nowrap" }}>{clp(r.total_costo)}</td>
                    <td>
                      {fallida
                        ? <span style={{ fontSize: 11.5, fontWeight: 700, color: "#b91c1c", background: "#fee2e2", borderRadius: 999, padding: "2px 9px", whiteSpace: "nowrap" }} title={r.error || "Bsale no la registró: el inventario no se tocó"}>No registrada</span>
                        : <span style={{ fontSize: 11.5, fontWeight: 700, color: r.error ? "#b45309" : "#15803d", background: r.error ? "#fef3c7" : "#dcfce7", borderRadius: 999, padding: "2px 9px", whiteSpace: "nowrap" }} title={r.error || "Recepción creada en Bsale"}>{r.bsale_reception_id ? `Recepción ${r.bsale_reception_id}` : "Registrada"}{r.error ? " · con avisos" : ""}</span>}
                    </td>
                  </tr>
                  {ab && (
                    <tr className="detalle-recepcion">
                      <td colSpan={7} style={{ background: "var(--bg)", padding: "12px 14px" }}>
                        {r.nota && <div style={{ fontSize: 12.5, color: "var(--text-soft)", marginBottom: 8 }}><strong>Nota:</strong> {r.nota}</div>}
                        {r.error && <div style={{ fontSize: 12.5, color: fallida ? "#991b1b" : "#92400e", background: fallida ? "#fef2f2" : "#fffbeb", border: `1px solid ${fallida ? "#fecaca" : "#fde68a"}`, borderRadius: 8, padding: "7px 10px", marginBottom: 8 }}>{r.error}</div>}
                        <div className="table-wrap" style={{ margin: 0 }}>
                          <table className="data-table tabla-compacta tabla-texto" style={{ minWidth: 480 }}>
                            <thead>
                              <tr>
                                <th>Producto</th>
                                <th style={{ textAlign: "right" }}>Cantidad</th>
                                <th style={{ textAlign: "right" }}>Costo neto unit.</th>
                                <th style={{ textAlign: "right" }}>Subtotal</th>
                              </tr>
                            </thead>
                            <tbody>
                              {r.lineas.map((l) => (
                                <tr key={l.producto_id}>
                                  <td style={{ minWidth: 200 }}>
                                    <div style={{ fontWeight: 600, overflowWrap: "anywhere" }}>
                                      <Link to={`/productos/editar/${l.producto_id}`} target="_blank" rel="noopener noreferrer" className="table-link" title="Abrir el producto en una pestaña nueva">{l.nombre}</Link>
                                    </div>
                                    <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>{l.sku}</div>
                                  </td>
                                  <td style={{ textAlign: "right", fontWeight: 700, whiteSpace: "nowrap" }}>{num(l.cantidad)}</td>
                                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>{clp(l.costo_unitario)}</td>
                                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>{clp(l.subtotal)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <Paginador pagina={paginaActual} total={filtradas.length} onCambiar={(p) => { setPagina(p); setAbierta(null); }} />
    </div>
  );
}
