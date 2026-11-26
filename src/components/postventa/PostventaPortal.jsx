import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, ChevronRight, MessageSquareWarning, Plus, X } from "lucide-react";
import DropdownSelect from "../ui/DropdownSelect";
import ProductosAfectados from "./ProductosAfectados";
import { CATEGORIAS_POSTVENTA, esAbierta, estadoPostventa, fechaCorta, fechaHora, numero, textoDocumentoAfectado } from "./postventaComun";

/* ── Postventa en el portal del cliente (2026-11-26) ─────────────────────────
   Pedido de Ariel: «Agregar módulo de solicitud de postventa en portal de
   cliente». Pestaña «Postventa» de /portal-cliente: el cliente envía una
   solicitud (categoría, descripción, y si quiere la factura, guía o pedido
   afectado elegido de SUS documentos, con los productos y cantidades) y sigue
   su estado: ingresada → en gestión → resuelta o rechazada, con el historial
   de lo que Amsodent hizo (cambios de estado, documentos emitidos y los
   mensajes que el equipo marcó para el cliente; los comentarios internos no
   llegan acá).

   El portal entrega su `apiRequest` (lleva el token) y el nombre del evento de
   «Actualizar». El servidor saca el RUT del token y exige el módulo
   «postventa» de la cuenta (backend/src/postventa/postventa-portal.controller.ts). */

const TEAL = "#0f766e";
const TEAL_LIGHT = "#25b7bd";
const POR_PAGINA = 10;
const est = {
  tarjeta: { background: "#fff", borderRadius: 18, border: "1px solid #e2e8f0", boxShadow: "0 10px 30px rgba(15,23,42,0.05)", overflow: "hidden" },
  cabecera: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "18px 22px", borderBottom: "1px solid #f1f5f9", gap: 12, flexWrap: "wrap" },
  titulo: { fontSize: 16, fontWeight: 700, color: "#0f172a" },
  sub: { fontSize: 12, color: "#64748b", marginTop: 2 },
  campo: { width: "100%", padding: "0 12px", height: 38, border: "1.5px solid #e2e8f0", borderRadius: 10, fontSize: 13, color: "#0f172a", outline: "none", boxSizing: "border-box", background: "#fff", fontFamily: "inherit" },
  primario: { display: "inline-flex", alignItems: "center", gap: 6, background: `linear-gradient(135deg, ${TEAL}, ${TEAL_LIGHT})`, color: "#fff", border: "none", fontSize: 13, fontWeight: 700, padding: "9px 16px", borderRadius: 10, cursor: "pointer", fontFamily: "inherit" },
  secundario: { display: "inline-flex", alignItems: "center", gap: 6, background: "#fff", color: "#334155", border: "1px solid #e2e8f0", fontSize: 13, fontWeight: 600, padding: "9px 16px", borderRadius: 10, cursor: "pointer", fontFamily: "inherit" },
  etiqueta: { fontSize: 10.5, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".04em", color: "#94a3b8", display: "block", marginBottom: 5 },
  th: { textAlign: "left", padding: "9px 12px", fontSize: 10.5, fontWeight: 800, color: "#94a3b8", textTransform: "uppercase", letterSpacing: ".04em" },
  td: { padding: "10px 12px", color: "#334155", verticalAlign: "top" },
};
const FILTROS = [
  { value: "", label: "Todas" },
  { value: "abiertas", label: "En curso" },
  { value: "resuelta", label: "Resueltas" },
  { value: "rechazada", label: "Rechazadas" },
];

/* Formulario «Nueva solicitud». */
function NuevaSolicitudPortal({ apiRequest, categorias, onCerrar, onEnviada }) {
  const [opciones, setOpciones] = useState(null);
  const [categoria, setCategoria] = useState("");
  const [afectado, setAfectado] = useState(""); // "" | "doc:ID" | "ped:ID"
  const [descripcion, setDescripcion] = useState("");
  const [sugeridos, setSugeridos] = useState({ clave: "", productos: [] });
  const [productos, setProductos] = useState([]);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let vivo = true;
    apiRequest("/postventa-portal/opciones")
      .then((r) => vivo && setOpciones({ documentos: r?.documentos || [], pedidos: r?.pedidos || [] }))
      .catch(() => vivo && setOpciones({ documentos: [], pedidos: [] }));
    return () => { vivo = false; };
  }, [apiRequest]);

  // Cotización detrás de lo elegido, para ofrecer sus productos.
  const licitacionId = useMemo(() => {
    if (!opciones || !afectado) return null;
    const [clase, id] = afectado.split(":");
    const fila = (clase === "doc" ? opciones.documentos : opciones.pedidos).find((x) => String(x.id) === id);
    return fila?.licitacion_id || null;
  }, [opciones, afectado]);
  useEffect(() => {
    if (!licitacionId) return undefined;
    let vivo = true;
    apiRequest(`/postventa-portal/cotizaciones/${licitacionId}/productos`)
      .then((r) => vivo && setSugeridos({ clave: String(licitacionId), productos: r?.productos || [] }))
      .catch(() => vivo && setSugeridos({ clave: String(licitacionId), productos: [] }));
    return () => { vivo = false; };
  }, [apiRequest, licitacionId]);
  const productosCotizacion = licitacionId && sugeridos.clave === String(licitacionId) ? sugeridos.productos : [];

  const opcionesAfectado = useMemo(() => [
    { value: "", label: opciones ? "Ninguno en particular" : "Cargando tus documentos…" },
    ...(opciones?.documentos || []).map((d) => ({ value: `doc:${d.id}`, label: `${d.tipo === "guia_despacho" ? "Guía de despacho" : "Factura"} N° ${d.numero || "s/n"}`, detalle: [d.fecha ? fechaCorta(d.fecha) : null, d.cotizacion ? `cotización ${d.cotizacion}` : null].filter(Boolean).join(" · ") || undefined })),
    ...(opciones?.pedidos || []).map((p) => ({ value: `ped:${p.id}`, label: `Pedido N° ${p.id}`, detalle: p.fecha ? fechaCorta(p.fecha) : undefined })),
  ], [opciones]);

  const completo = !!categoria && descripcion.trim().length >= 5 && !enviando;

  async function enviar() {
    if (!completo) return;
    setEnviando(true);
    setError("");
    try {
      const [clase, id] = afectado ? afectado.split(":") : [];
      const r = await apiRequest("/postventa-portal/solicitudes", {
        method: "POST",
        body: JSON.stringify({
          categoria,
          descripcion: descripcion.trim(),
          ...(clase === "doc" ? { documento_id: Number(id) } : clase === "ped" ? { pedido_id: Number(id) } : {}),
          productos,
        }),
      });
      onEnviada?.(r?.solicitud || null);
    } catch (e) {
      setError(e?.message || "No se pudo enviar la solicitud.");
      setEnviando(false);
    }
  }

  return createPortal(
    <div
      onMouseDown={(e) => { if (e.target === e.currentTarget && !enviando) onCerrar?.(); }}
      style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.55)", zIndex: 12000, display: "flex", alignItems: "center", justifyContent: "center", padding: 14 }}
    >
      <div className="ventana-postventa-portal" role="dialog" aria-modal="true" aria-label="Nueva solicitud de postventa" style={{ width: 620, maxWidth: "100%", maxHeight: "94vh", display: "flex", flexDirection: "column", background: "#fff", borderRadius: 16, boxShadow: "0 24px 60px rgba(15,23,42,.3)", fontFamily: "inherit" }}>
        <div style={{ padding: "14px 18px", borderBottom: "1px solid #f1f5f9", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
          <strong style={{ fontSize: 15, color: "#0f172a", display: "inline-flex", alignItems: "center", gap: 8 }}><MessageSquareWarning size={17} style={{ color: TEAL }} /> Nueva solicitud de postventa</strong>
          <button type="button" onClick={onCerrar} disabled={enviando} aria-label="Cerrar" style={{ border: "none", background: "transparent", cursor: "pointer", color: "#64748b", padding: 4, display: "inline-flex" }}><X size={18} /></button>
        </div>

        <div style={{ padding: "14px 18px", display: "flex", flexDirection: "column", gap: 14, overflowY: "auto", minHeight: 0 }}>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 240px", minWidth: 0 }}>
              <span style={est.etiqueta}>¿Qué pasó? *</span>
              <DropdownSelect value={categoria} onChange={setCategoria} disabled={enviando} minWidth={260} className="" placeholder="Elige el motivo" style={{ ...est.campo }} options={categorias.map((c) => ({ value: c.clave, label: c.nombre }))} />
            </div>
            <div style={{ flex: "1 1 240px", minWidth: 0 }}>
              <span style={est.etiqueta}>Factura, guía o pedido afectado</span>
              <DropdownSelect value={afectado} onChange={(v) => { setAfectado(v); setProductos([]); }} disabled={enviando || !opciones} minWidth={280} className="" style={{ ...est.campo }} options={opcionesAfectado} />
            </div>
          </div>
          <div>
            <span style={est.etiqueta}>Cuéntanos el detalle *</span>
            <textarea className="campo-descripcion-postventa-portal" value={descripcion} onChange={(e) => setDescripcion(e.target.value.slice(0, 2000))} disabled={enviando} rows={4} placeholder="Qué recibiste, qué esperabas y cómo prefieres que lo resolvamos" style={{ ...est.campo, height: "auto", minHeight: 92, padding: "10px 12px", resize: "vertical" }} />
          </div>
          <div>
            <span style={est.etiqueta}>Productos y cantidades afectados (opcional)</span>
            <ProductosAfectados key={afectado || "sin-documento"} sugeridos={productosCotizacion} onCambiar={setProductos} disabled={enviando} claseInput="" estiloInput={{ ...est.campo, height: 34, padding: "0 10px" }} />
          </div>
          {error && <div style={{ fontSize: 12.5, color: "#b91c1c", fontWeight: 600 }}>{error}</div>}
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "12px 18px", borderTop: "1px solid #f1f5f9", background: "#f8fafc", borderRadius: "0 0 16px 16px" }}>
          <span style={{ fontSize: 12, color: "#64748b", flex: "1 1 220px", minWidth: 0 }}>Tu ejecutivo de Amsodent la recibe de inmediato y verás aquí cada avance.</span>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" style={est.secundario} onClick={onCerrar} disabled={enviando}>Cancelar</button>
            <button type="button" className="btn-enviar-postventa-portal" style={{ ...est.primario, opacity: completo ? 1 : 0.55, cursor: completo ? "pointer" : "not-allowed" }} onClick={enviar} disabled={!completo}>{enviando ? "Enviando…" : "Enviar solicitud"}</button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export default function PostventaPortal({ apiRequest, eventoRefrescar = "portal-refrescar", setToast }) {
  const [datos, setDatos] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [filtro, setFiltro] = useState("");
  const [pagina, setPagina] = useState(1);
  const [abierta, setAbierta] = useState(null);
  const [nueva, setNueva] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError("");
    try {
      const r = await apiRequest("/postventa-portal/mis-solicitudes");
      if (r) setDatos(r);
    } catch (e) {
      setError(e?.message || "No se pudieron cargar tus solicitudes.");
    } finally {
      setCargando(false);
    }
  }, [apiRequest]);
  useEffect(() => {
    const timer = setTimeout(cargar, 0);
    window.addEventListener(eventoRefrescar, cargar);
    return () => { clearTimeout(timer); window.removeEventListener(eventoRefrescar, cargar); };
  }, [cargar, eventoRefrescar]);

  const solicitudes = useMemo(() => datos?.solicitudes || [], [datos]);
  const categorias = datos?.categorias?.length ? datos.categorias : CATEGORIAS_POSTVENTA;
  const resumen = useMemo(() => ({
    abiertas: solicitudes.filter((s) => esAbierta(s.estado)).length,
    resueltas: solicitudes.filter((s) => s.estado === "resuelta").length,
    rechazadas: solicitudes.filter((s) => s.estado === "rechazada").length,
  }), [solicitudes]);
  const filtradas = useMemo(() => solicitudes.filter((s) => (filtro === "abiertas" ? esAbierta(s.estado) : !filtro || s.estado === filtro)), [solicitudes, filtro]);
  const paginas = Math.max(1, Math.ceil(filtradas.length / POR_PAGINA));
  const paginaActual = Math.min(pagina, paginas);
  const visibles = filtradas.slice((paginaActual - 1) * POR_PAGINA, paginaActual * POR_PAGINA);
  const sinModulo = datos?.listo === false;

  const kpi = (etiqueta, valor, detalle, color) => (
    <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderTop: `3px solid ${color}`, borderRadius: 12, padding: "12px 14px", minWidth: 0 }}>
      <div style={{ fontSize: 10.5, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".04em", color: "#94a3b8" }}>{etiqueta}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: "#0f172a", lineHeight: 1.15 }}>{valor}</div>
      <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>{detalle}</div>
    </div>
  );

  return (
    <div style={est.tarjeta} className="panel-postventa-portal">
      <style>{`
        .postventa-portal-kpis { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
        @media (max-width: 640px) { .postventa-portal-kpis { grid-template-columns: 1fr; } }
        .postventa-portal-detalle { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(260px, 100%), 1fr)); gap: 12px; }
      `}</style>
      {nueva && (
        <NuevaSolicitudPortal
          apiRequest={apiRequest}
          categorias={categorias}
          onCerrar={() => setNueva(false)}
          onEnviada={(s) => {
            setNueva(false);
            // El toast del portal usa { type, titulo, mensaje }.
            setToast?.({ type: "success", titulo: "Solicitud enviada", mensaje: s ? `Recibimos tu solicitud de postventa N° ${s.id}. Te avisaremos cada avance.` : "Recibimos tu solicitud." });
            setFiltro("");
            setPagina(1);
            if (s) setAbierta(s.id);
            cargar();
          }}
        />
      )}

      <div style={est.cabecera}>
        <div style={{ minWidth: 0, flex: "1 1 260px" }}>
          <div style={est.titulo}>Postventa</div>
          <div style={est.sub}>
            ¿Un producto llegó en mal estado, con otra fecha de vencimiento, no corresponde, faltó o sobró algo, o necesitas un cambio? Envíanos la solicitud y sigue aquí su avance.
          </div>
        </div>
        <button type="button" className="btn-nueva-postventa-portal" style={{ ...est.primario, opacity: sinModulo ? 0.55 : 1 }} onClick={() => setNueva(true)} disabled={sinModulo}>
          <Plus size={15} /> Nueva solicitud
        </button>
      </div>

      <div style={{ padding: "16px 22px 20px", display: "flex", flexDirection: "column", gap: 14 }}>
        {cargando && !datos ? (
          <div style={{ padding: 12, color: "#64748b", fontSize: 13 }}>Cargando tus solicitudes…</div>
        ) : error ? (
          <div style={{ padding: 12, color: "#b91c1c", fontSize: 13 }}>{error}</div>
        ) : sinModulo ? (
          <div style={{ padding: 12, color: "#64748b", fontSize: 13 }}>Esta sección estará disponible muy pronto. Mientras tanto, escríbele a tu ejecutivo de Amsodent.</div>
        ) : !solicitudes.length ? (
          <div style={{ padding: 12, color: "#64748b", fontSize: 13 }}>Todavía no has enviado solicitudes de postventa. Si tuviste un problema con un pedido, usa «Nueva solicitud».</div>
        ) : (
          <>
            <div className="postventa-portal-kpis">
              {kpi("En curso", resumen.abiertas, resumen.abiertas ? "Amsodent las está revisando" : "Nada pendiente", "#b45309")}
              {kpi("Resueltas", resumen.resueltas, "Con su resolución", "#15803d")}
              {kpi("Rechazadas", resumen.rechazadas, "Con su motivo", "#b91c1c")}
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
              <DropdownSelect value={filtro} onChange={(v) => { setFiltro(v); setPagina(1); setAbierta(null); }} options={FILTROS} minWidth={200} className="" style={{ ...est.campo, width: 220, flex: "0 1 220px", minWidth: 160, maxWidth: "100%" }} />
              <span style={{ fontSize: 12, color: "#64748b" }}>{filtradas.length} de {solicitudes.length} solicitud{solicitudes.length === 1 ? "" : "es"}</span>
            </div>

            {!filtradas.length ? (
              <div style={{ padding: 12, color: "#64748b", fontSize: 13 }}>Ninguna solicitud en ese estado.</div>
            ) : (
              <>
                {/* containerType: el detalle mide 100cqw = lo visible de esta caja. */}
                <div style={{ overflowX: "auto", containerType: "inline-size" }}>
                  <table className="tabla-postventa-portal" style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 620 }}>
                    <thead>
                      <tr style={{ background: "#f8fafc" }}>
                        <th style={{ ...est.th, width: 26 }} aria-label="Detalle" />
                        <th style={est.th}>Solicitud</th>
                        <th style={est.th}>Motivo</th>
                        <th style={est.th}>Documento</th>
                        <th style={est.th}>Estado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibles.map((s) => {
                        const ab = abierta === s.id;
                        const e = estadoPostventa(s.estado);
                        const docAfectado = textoDocumentoAfectado(s) || (s.pedido_id ? `Pedido N° ${s.pedido_id}` : "");
                        return (
                          <Fragment key={s.id}>
                            <tr style={{ borderTop: "1px solid #f1f5f9", cursor: "pointer" }} onClick={() => setAbierta(ab ? null : s.id)} title={ab ? "Ocultar el detalle" : "Ver el detalle y el historial"}>
                              <td style={est.td}>{ab ? <ChevronDown size={15} /> : <ChevronRight size={15} />}</td>
                              <td style={{ ...est.td, whiteSpace: "nowrap" }}>
                                <div style={{ fontWeight: 800, color: "#0f172a" }}>N° {s.id}</div>
                                <div style={{ fontSize: 11.5, color: "#94a3b8" }}>{fechaHora(s.created_at)}</div>
                              </td>
                              <td style={{ ...est.td, minWidth: 180 }}>
                                <div style={{ fontWeight: 600, color: "#0f172a" }}>{s.categoria_nombre}</div>
                                <div style={{ fontSize: 11.5, color: "#64748b", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", overflowWrap: "anywhere" }}>{s.descripcion}</div>
                              </td>
                              <td style={{ ...est.td, overflowWrap: "anywhere" }}>{docAfectado || <span style={{ color: "#94a3b8" }}>—</span>}</td>
                              <td style={est.td}>
                                <span style={{ display: "inline-block", fontSize: 11, fontWeight: 800, padding: "3px 9px", borderRadius: 999, background: e.bg, color: e.color, whiteSpace: "nowrap" }}>{s.estado_nombre || e.nombre}</span>
                              </td>
                            </tr>
                            {ab && (
                              <tr className="detalle-postventa-portal">
                                <td colSpan={5} style={{ background: "#f8fafc", padding: 0 }}>
                                  <div className="postventa-portal-detalle" style={{ position: "sticky", left: 0, width: "100cqw", boxSizing: "border-box", padding: "12px 14px" }}>
                                    <div style={{ background: "#fff", border: "1px solid #eef2f7", borderRadius: 10, padding: "10px 12px", minWidth: 0 }}>
                                      <span style={est.etiqueta}>Tu solicitud</span>
                                      <div style={{ fontSize: 13, color: "#334155", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{s.descripcion}</div>
                                      {s.creada_por_nombre && <div style={{ fontSize: 11.5, color: "#94a3b8", marginTop: 6 }}>Enviada por {s.creada_por_nombre}</div>}
                                      {s.productos.length > 0 && (
                                        <div style={{ marginTop: 10 }}>
                                          <span style={est.etiqueta}>Productos afectados</span>
                                          {s.productos.map((p, i) => (
                                            <div key={`${p.sku || ""}-${i}`} style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 12.5, padding: "3px 0", borderTop: i ? "1px solid #f1f5f9" : "none" }}>
                                              <span style={{ minWidth: 0, overflowWrap: "anywhere", color: "#334155" }}>{p.nombre}{p.sku ? <span style={{ color: "#94a3b8" }}> · {p.sku}</span> : null}</span>
                                              <strong style={{ whiteSpace: "nowrap", color: "#0f172a" }}>{p.cantidad != null ? numero(p.cantidad) : "—"}</strong>
                                            </div>
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                    <div style={{ background: "#fff", border: "1px solid #eef2f7", borderRadius: 10, padding: "10px 12px", minWidth: 0 }}>
                                      <span style={est.etiqueta}>Avance</span>
                                      {s.resolucion && (
                                        <div style={{ fontSize: 12.5, background: e.bg, color: e.color, borderRadius: 8, padding: "7px 10px", marginBottom: 8, overflowWrap: "anywhere" }}>
                                          <strong>{s.estado === "rechazada" ? "Motivo del rechazo" : "Resolución"}:</strong> {s.resolucion}
                                        </div>
                                      )}
                                      <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                                        <div style={{ fontSize: 12.5, borderLeft: "3px solid #e2e8f0", paddingLeft: 9 }}>
                                          <strong style={{ color: "#0f172a" }}>Solicitud ingresada</strong>
                                          <div style={{ fontSize: 11.5, color: "#94a3b8" }}>{fechaHora(s.created_at)}</div>
                                        </div>
                                        {s.gestiones.map((g) => (
                                          <div key={g.id} style={{ fontSize: 12.5, borderLeft: `3px solid ${g.tipo === "cambio_estado" ? "#e2e8f0" : TEAL}`, paddingLeft: 9 }}>
                                            <strong style={{ color: "#0f172a" }}>{g.titulo}{g.documento_numero ? ` · N° ${g.documento_numero}` : ""}</strong>
                                            {g.detalle && <div style={{ color: "#475569", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{g.detalle}</div>}
                                            <div style={{ fontSize: 11.5, color: "#94a3b8" }}>{fechaHora(g.fecha)}</div>
                                          </div>
                                        ))}
                                        {s.gestiones.length === 0 && <div style={{ fontSize: 12, color: "#64748b" }}>Tu ejecutivo la revisará pronto: aquí verás cada avance.</div>}
                                      </div>
                                    </div>
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
                {filtradas.length > POR_PAGINA && (
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: 12.5, color: "#64748b" }}>
                    <span>{(paginaActual - 1) * POR_PAGINA + 1}–{Math.min(paginaActual * POR_PAGINA, filtradas.length)} de {filtradas.length} solicitudes</span>
                    <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                      <button type="button" style={est.secundario} disabled={paginaActual <= 1} onClick={() => { setPagina(paginaActual - 1); setAbierta(null); }}>Anterior</button>
                      <span>Página {paginaActual} de {paginas}</span>
                      <button type="button" style={est.secundario} disabled={paginaActual >= paginas} onClick={() => { setPagina(paginaActual + 1); setAbierta(null); }}>Siguiente</button>
                    </span>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
