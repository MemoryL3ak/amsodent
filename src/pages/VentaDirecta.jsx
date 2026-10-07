import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, Ban, ChevronDown, ChevronLeft, ChevronRight, ExternalLink, FilePlus2, Plus, RefreshCw } from "lucide-react";
import { api } from "../lib/api";
import Toast from "../components/Toast";
import BotonLimpiarFiltros from "../components/BotonLimpiarFiltros";
import DropdownSelect from "../components/ui/DropdownSelect";
import DocumentoLibreBsale from "../components/DocumentoLibreBsale";
import AnularDocumentoBsale from "../components/AnularDocumentoBsale";
import NotaDebitoBsale from "../components/NotaDebitoBsale";
import EstadoBsaleBadge from "../components/EstadoBsale";
import { useEstadosBsale } from "../lib/estadosBsale";

/* ── Comercial → Venta directa (2026-10-07) ─────────────────────────────────
   Pedido de Ariel: "crear el módulo comercial de Venta directa. Acá se debe
   visualizar el listado de venta directa y creación de documentos
   correspondientes".
   · Arriba: nueva boleta o factura de venta directa (se emite en Bsale y crea
     su cotización con esos productos, como desde Facturación).
   · El listado: TODAS las ventas directas, con su cotización, el pago, las
     notas de crédito y débito (también las hechas a mano en Bsale, por el
     estado en Bsale) y sus guías. Cada fila se despliega con el detalle.
   · Por fila: nota de crédito (anular, devolver parte o ajustar precio) y,
     en facturas, nota de débito. Una venta anulada ya no ofrece notas.
   La guía de despacho NO se ofrece aquí: la venta directa ya rebaja el stock
   al emitirse y en Bsale una guía siempre lo rebaja otra vez. */

const POR_PAGINA = 20;
const clp = (n) => `$${Math.round(Number(n) || 0).toLocaleString("es-CL")}`;
const fechaCL = (iso) => {
  if (!iso) return "—";
  const [y, m, d] = String(iso).slice(0, 10).split("-");
  return y && m && d ? `${d}-${m}-${y}` : "—";
};
const sinTildes = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const pastilla = (color, bg) => ({ display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 9px", borderRadius: 999, fontSize: 11, fontWeight: 700, whiteSpace: "nowrap", color, background: bg });

const PAGO = {
  anulada: { texto: "Anulada", estilo: pastilla("#475569", "#f1f5f9") },
  pagada: { texto: "✓ Pagada", estilo: pastilla("#15803d", "#dcfce7") },
  por_cobrar: { texto: "Por cobrar", estilo: pastilla("#b45309", "#fef3c7") },
  fallida: { texto: "Sin emitir", estilo: pastilla("#b91c1c", "#fee2e2") },
};

export default function VentaDirecta() {
  const [estado, setEstado] = useState(null);
  const [datos, setDatos] = useState({ registro_listo: true, filas: [] });
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [toast, setToast] = useState(null);
  const [buscar, setBuscar] = useState("");
  const [tipo, setTipo] = useState("todos");
  const [pago, setPago] = useState("todas");
  const [pagina, setPagina] = useState(1);
  const [abierta, setAbierta] = useState(null);
  const [nueva, setNueva] = useState(null); // "boleta" | "factura"
  const [notaCredito, setNotaCredito] = useState(null);
  const [notaDebito, setNotaDebito] = useState(null);
  const estadosBsale = useEstadosBsale();

  const cargar = useCallback(async () => {
    setCargando(true);
    setError("");
    try {
      const est = await api.get("/bsale/facturas/estado").catch(() => null);
      setEstado(est);
      if (est && est.puede === false) { setDatos({ registro_listo: true, filas: [] }); return; }
      setDatos(await api.get("/bsale/facturas/ventas-directas"));
    } catch (e) {
      setError(e?.message || "No se pudo cargar el listado de ventas directas.");
    } finally {
      setCargando(false);
    }
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  // Cada venta con su estado de pago, sumando las NC que Bsale conoce (también las hechas allá).
  const filas = useMemo(() => (datos.filas || []).map((f) => {
    const eb = f.documento_id ? estadosBsale?.[f.documento_id] : null;
    const ncTotal = Math.max(Number(f.nc?.total || 0), Number(eb?.nc?.total || 0));
    const ncNumeros = [...new Set([...(eb?.nc?.numeros || []), ...(f.nc?.numeros || []).filter((n) => /^\d+$/.test(n))])];
    const anulada = !!f.anulada || !!eb?.nc?.completa || eb?.estado === "anulado";
    const situacion = f.estado !== "emitida" ? "fallida" : anulada ? "anulada" : f.pagada ? "pagada" : "por_cobrar";
    return { ...f, eb, ncTotal, ncNumeros, anulada, situacion };
  }), [datos, estadosBsale]);

  const mes = new Date().toISOString().slice(0, 7);
  // Lo que vale la venta hoy: total − notas de crédito + notas de débito (todo con IVA).
  const saldo = (f) => Number(f.total || 0) - (f.ncTotal || 0) + Number(f.nd?.total || 0);
  const kpis = useMemo(() => {
    const emitidas = filas.filter((f) => f.estado === "emitida");
    const delMes = emitidas.filter((f) => String(f.fecha || "").slice(0, 7) === mes && !f.anulada);
    const porCobrar = filas.filter((f) => f.situacion === "por_cobrar");
    return {
      mes: delMes.length,
      montoMes: delMes.reduce((a, f) => a + saldo(f), 0),
      porCobrar: porCobrar.length,
      montoPorCobrar: porCobrar.reduce((a, f) => a + saldo(f), 0),
      anuladas: filas.filter((f) => f.situacion === "anulada").length,
      fallidas: filas.filter((f) => f.situacion === "fallida").length,
      total: emitidas.length,
    };
  }, [filas, mes]);

  const texto = sinTildes(buscar.trim());
  const filtradas = useMemo(() => filas.filter((f) =>
    (tipo === "todos" || f.tipo === tipo)
    && (pago === "todas" || f.situacion === pago)
    && (!texto || sinTildes(`${f.cliente} ${f.rut} ${f.numero} #${f.licitacion_id} ${f.codigo} ${f.usuario} ${f.ncNumeros.join(" ")}`).includes(texto))),
  [filas, tipo, pago, texto]);
  const paginas = Math.max(1, Math.ceil(filtradas.length / POR_PAGINA));
  const pag = Math.min(pagina, paginas);
  const visibles = filtradas.slice((pag - 1) * POR_PAGINA, pag * POR_PAGINA);
  useEffect(() => { setPagina(1); }, [texto, tipo, pago]);

  const puede = !!estado?.puede;
  const hayFiltros = buscar !== "" || tipo !== "todos" || pago !== "todas";
  const columnas = puede ? 7 : 6;
  const filtrarPago = (p) => { setPago(p); setAbierta(null); };

  return (
    <div className="page venta-directa">
      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}
      {nueva && (
        <DocumentoLibreBsale
          tipo={nueva}
          ventaDirecta
          onCerrar={() => setNueva(null)}
          onEmitida={(r) => {
            setToast({
              type: r.cotizacion ? "success" : "warning",
              message: `${r.tipo === "boleta" ? "Boleta" : "Factura"} ${r.numero} emitida en Bsale${r.cotizacion ? ` · cotización #${r.cotizacion.id} creada.` : " · la cotización no se pudo crear: revisa el aviso."}`,
            });
            cargar();
          }}
        />
      )}
      {notaCredito && (
        <AnularDocumentoBsale
          documentoId={notaCredito.documentoId || null}
          bsaleId={notaCredito.documentoId ? null : notaCredito.bsaleId || null}
          modoInicial="total"
          onCerrar={() => setNotaCredito(null)}
          onEmitida={(r) => { setToast({ type: "success", message: `Nota de crédito ${r.numero} emitida en Bsale.` }); cargar(); }}
        />
      )}
      {notaDebito && (
        <NotaDebitoBsale
          documentoId={notaDebito.documentoId || null}
          bsaleId={notaDebito.documentoId ? null : notaDebito.bsaleId || null}
          onCerrar={() => setNotaDebito(null)}
          onEmitida={(r) => { setToast({ type: "success", message: `Nota de débito ${r.numero} emitida en Bsale.` }); cargar(); }}
        />
      )}

      <div className="page-header" style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 className="page-title">Venta directa</h1>
          <p className="page-subtitle">Boletas y facturas al instante: se emiten en Bsale y crean su cotización con esos productos. Aquí está cada venta con su pago y sus notas.</p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {puede && (
            <>
              <button type="button" className="btn btn-primary" onClick={() => setNueva("boleta")} title="Boleta de venta directa: se emite en Bsale y se crea la cotización">
                <Plus size={14} /> Nueva boleta
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => setNueva("factura")} title="Factura de venta directa: se emite en Bsale y se crea la cotización">
                <Plus size={14} /> Nueva factura
              </button>
            </>
          )}
          <button type="button" className="btn btn-secondary" onClick={cargar} disabled={cargando}>
            <RefreshCw size={14} className={cargando ? "spin" : ""} /> Actualizar
          </button>
        </div>
      </div>

      {estado && estado.puede === false && (
        <div style={{ border: "1px solid #fde68a", background: "#fffbeb", color: "#92400e", borderRadius: 10, padding: "10px 14px", fontSize: 13, display: "flex", gap: 8, marginBottom: 14 }}>
          <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>Emitir y ver las ventas directas es para administración, contabilidad y jefatura de ventas especial.</span>
        </div>
      )}
      {datos.registro_listo === false && (
        <div style={{ border: "1px solid #fecaca", background: "#fef2f2", color: "#b91c1c", borderRadius: 10, padding: "10px 14px", fontSize: 13, marginBottom: 14 }}>
          Falta aplicar la migración de emisiones de Bsale en la base de datos: todavía no hay historial de ventas directas.
        </div>
      )}
      {error && (
        <div style={{ border: "1px solid #fecaca", background: "#fef2f2", color: "#b91c1c", borderRadius: 10, padding: "10px 14px", fontSize: 13, marginBottom: 14, overflowWrap: "anywhere" }}>{error}</div>
      )}

      <div className="stats-row">
        <div className="stat-card" onClick={() => filtrarPago("todas")} style={{ cursor: "pointer" }} title="Ver todas">
          <div className="stat-label">Ventas este mes</div>
          <div className="stat-value">{kpis.mes}</div>
          <div className="stat-money">{clp(kpis.montoMes)}</div>
          <div className="stat-sub">con IVA, sin anuladas · {kpis.total} en total</div>
        </div>
        <div className="stat-card" onClick={() => filtrarPago("por_cobrar")} style={{ cursor: "pointer" }} title="Ver las ventas por cobrar">
          <div className="stat-label">Por cobrar</div>
          <div className="stat-value" style={{ color: kpis.porCobrar ? "#b45309" : undefined }}>{kpis.porCobrar}</div>
          <div className="stat-money">{clp(kpis.montoPorCobrar)}</div>
          <div className="stat-sub">facturas a crédito sin pago · con sus notas</div>
        </div>
        <div className="stat-card" onClick={() => filtrarPago("anulada")} style={{ cursor: "pointer" }} title="Ver las anuladas">
          <div className="stat-label">Anuladas</div>
          <div className="stat-value">{kpis.anuladas}</div>
          <div className="stat-sub">con nota de crédito por el total</div>
        </div>
        <div className="stat-card" onClick={() => filtrarPago("fallida")} style={{ cursor: "pointer" }} title="Ver los intentos que no se emitieron">
          <div className="stat-label">Sin emitir</div>
          <div className="stat-value" style={{ color: kpis.fallidas ? "var(--danger)" : undefined }}>{kpis.fallidas}</div>
          <div className="stat-sub">intentos rechazados o sin confirmar</div>
        </div>
      </div>

      <div className="filter-bar" style={{ alignItems: "flex-end" }}>
        <div className="filter-field" style={{ flex: "2 1 240px", minWidth: 0 }}>
          <label className="filter-label">Buscar</label>
          <input type="text" className="input" placeholder="Cliente, RUT, N° de boleta o factura, cotización…" value={buscar} onChange={(e) => setBuscar(e.target.value)} />
        </div>
        <div className="filter-field" style={{ flex: "1 1 160px", minWidth: 0 }}>
          <label className="filter-label">Documento</label>
          <DropdownSelect value={tipo} onChange={setTipo} minWidth={170} options={[{ value: "todos", label: "Boletas y facturas" }, { value: "boleta", label: "Boletas" }, { value: "factura", label: "Facturas" }]} />
        </div>
        <div className="filter-field" style={{ flex: "1 1 160px", minWidth: 0 }}>
          <label className="filter-label">Pago</label>
          <DropdownSelect
            value={pago}
            onChange={filtrarPago}
            minWidth={190}
            options={[
              { value: "todas", label: "Todas" },
              { value: "pagada", label: "Pagadas", color: "#15803d" },
              { value: "por_cobrar", label: "Por cobrar", color: "#b45309" },
              { value: "anulada", label: "Anuladas", color: "#475569" },
              { value: "fallida", label: "Sin emitir", color: "#b91c1c" },
            ]}
          />
        </div>
        <BotonLimpiarFiltros hay={hayFiltros} onLimpiar={() => { setBuscar(""); setTipo("todos"); setPago("todas"); }} />
      </div>

      <div className="surface">
        <div className="table-scroll">
          <table className="data-table tabla-compacta tabla-texto tabla-venta-directa" style={{ width: "100%", minWidth: 820 }}>
            <thead>
              <tr>
                <th style={{ width: 30 }} aria-label="Detalle" />
                <th>Fecha</th>
                <th>Documento</th>
                <th>Cliente / cotización</th>
                <th style={{ textAlign: "right" }}>Total</th>
                <th>Pago</th>
                {puede && <th style={{ textAlign: "right" }}>Documentos</th>}
              </tr>
            </thead>
            <tbody>
              {visibles.length === 0 ? (
                <tr>
                  <td colSpan={columnas} style={{ textAlign: "center", padding: 28, color: "var(--text-muted)" }}>
                    {cargando ? "Cargando…" : hayFiltros ? "Ninguna venta calza con la búsqueda o los filtros." : "Todavía no hay ventas directas: emite una boleta o factura con los botones de arriba."}
                  </td>
                </tr>
              ) : visibles.map((f) => {
                const abiertaEsta = abierta === f.id;
                const sit = PAGO[f.situacion];
                return (
                  <Fragment key={f.id}>
                    <tr className={f.anulada ? "fila-anulada" : undefined}>
                      <td>
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAbierta(abiertaEsta ? null : f.id)} title={abiertaEsta ? "Ocultar el detalle" : "Ver el detalle"} aria-expanded={abiertaEsta} style={{ padding: 4 }}>
                          {abiertaEsta ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                        </button>
                      </td>
                      <td style={{ whiteSpace: "nowrap" }}>{fechaCL(f.fecha)}</td>
                      <td style={{ whiteSpace: "nowrap" }}>
                        <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{f.tipo === "factura" ? "Factura" : "Boleta"}{f.credito ? " · a crédito" : ""}</div>
                        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                          <span style={{ fontWeight: 700, textDecoration: f.anulada ? "line-through" : "none" }}>N° {f.numero || "—"}</span>
                          {f.url_pdf && <a href={f.url_pdf} target="_blank" rel="noopener noreferrer" title="Ver el documento en Bsale" style={{ color: "var(--primary)", display: "inline-flex" }}><ExternalLink size={13} /></a>}
                        </div>
                        <EstadoBsaleBadge estado={f.eb} style={{ marginTop: 2 }} />
                      </td>
                      <td>
                        <div style={{ fontWeight: 600, overflowWrap: "anywhere" }}>{f.cliente || "—"}</div>
                        <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                          {f.licitacion_id ? <Link to={`/detalle/${f.licitacion_id}`} className="table-link">#{f.licitacion_id}</Link> : "Sin cotización"}
                          {f.rut ? ` · ${f.rut}` : ""}
                        </div>
                      </td>
                      <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                        <div style={{ fontWeight: 700, textDecoration: f.anulada ? "line-through" : "none" }}>{f.total ? clp(f.total) : "—"}</div>
                        {f.ncTotal > 0 && <div style={{ fontSize: 11.5, color: "#b91c1c" }}>− {clp(f.ncTotal)} NC</div>}
                        {f.nd && <div style={{ fontSize: 11.5, color: "#6d28d9" }}>+ {clp(f.nd.total)} ND</div>}
                      </td>
                      <td><span style={sit.estilo}>{sit.texto}</span></td>
                      {puede && (
                        <td style={{ textAlign: "right" }}>
                          {f.estado !== "emitida" ? (
                            <span style={{ fontSize: 11.5, color: "var(--text-muted)" }}>—</span>
                          ) : f.anulada ? (
                            <span style={{ fontSize: 11.5, color: "var(--text-muted)" }} title={`Anulada${f.ncNumeros.length ? ` con NC N° ${f.ncNumeros.join(", ")}` : ""}`}>Sin notas: anulada</span>
                          ) : (
                            <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", flexWrap: "wrap" }}>
                              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setNotaCredito({ documentoId: f.documento_id, bsaleId: f.bsale_id })} title="Nota de crédito: anular, devolver parte o ajustar el precio">
                                <Ban size={13} /> N. crédito
                              </button>
                              {f.tipo === "factura" && (
                                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setNotaDebito({ documentoId: f.documento_id, bsaleId: f.bsale_id })} title="Nota de débito: cobrar intereses, diferencias de precio u otros cargos">
                                  <FilePlus2 size={13} /> N. débito
                                </button>
                              )}
                            </div>
                          )}
                        </td>
                      )}
                    </tr>
                    {abiertaEsta && (
                      <tr className="detalle-venta-directa">
                        <td colSpan={columnas} style={{ background: "var(--bg)", padding: "10px 14px" }}>
                          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "8px 18px", fontSize: 12.5 }}>
                            <div><div className="filter-label">Condición</div>{f.condicion || (f.credito ? "Crédito" : "Contado")}</div>
                            <div><div className="filter-label">Pago</div>{f.pagada ? `Pagada${f.fecha_pago ? ` el ${fechaCL(f.fecha_pago)}` : ""}${f.forma_pago ? ` · ${f.forma_pago}` : ""}` : "Sin pago registrado"}</div>
                            <div><div className="filter-label">Comprobantes</div>{f.comprobantes.length ? f.comprobantes.map((c) => `${c.numero}${c.monto ? ` (${clp(c.monto)} neto)` : ""}`).join(" · ") : "—"}</div>
                            <div><div className="filter-label">Notas de crédito</div>{f.ncTotal > 0 ? `${f.ncNumeros.length ? `N° ${f.ncNumeros.join(", ")} · ` : ""}${clp(f.ncTotal)}${f.eb?.nc && !(f.nc?.total > 0) ? " (hecha en Bsale)" : ""}` : "—"}{f.eb?.nc_texto?.length ? ` · N° ${f.eb.nc_texto.join(", ")} corrige texto` : ""}</div>
                            <div><div className="filter-label">Notas de débito</div>{f.nd ? `N° ${f.nd.numeros.join(", ")} · ${clp(f.nd.total)}` : "—"}</div>
                            <div><div className="filter-label">Guías</div>{f.guias.length ? f.guias.map((g) => g.numero).join(", ") : "—"}</div>
                            <div><div className="filter-label">Neto</div>{f.neto ? clp(f.neto) : "—"}</div>
                            <div><div className="filter-label">Emitida por</div><span style={{ overflowWrap: "anywhere" }}>{f.usuario || "—"}</span></div>
                          </div>
                          {f.error && <div style={{ marginTop: 8, fontSize: 12, color: "#b91c1c", overflowWrap: "anywhere" }}>No se emitió: {f.error}</div>}
                          {f.licitacion_id && (
                            <div style={{ marginTop: 8 }}>
                              <Link to={`/detalle/${f.licitacion_id}`} className="table-link" style={{ fontSize: 12.5 }}>Abrir la cotización #{f.licitacion_id} (productos, archivos y pagos) →</Link>
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        {filtradas.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 12px", flexWrap: "wrap", gap: 8 }}>
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
              Mostrando {(pag - 1) * POR_PAGINA + 1}–{Math.min(pag * POR_PAGINA, filtradas.length)} de {filtradas.length} ventas
            </span>
            {paginas > 1 && (
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <button type="button" className="btn btn-secondary btn-sm" disabled={pag <= 1} onClick={() => setPagina(pag - 1)} title="Página anterior"><ChevronLeft size={14} /></button>
                <span style={{ fontSize: 12.5, fontWeight: 700, minWidth: 60, textAlign: "center" }}>{pag} / {paginas}</span>
                <button type="button" className="btn btn-secondary btn-sm" disabled={pag >= paginas} onClick={() => setPagina(pag + 1)} title="Página siguiente"><ChevronRight size={14} /></button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
