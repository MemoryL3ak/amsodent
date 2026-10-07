import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Ban, FileCheck, FilePlus2, Receipt, RefreshCw, Search } from "lucide-react";
import { api } from "../lib/api";
import EmitirFacturaBsale from "./EmitirFacturaBsale";
import DocumentoLibreBsale from "./DocumentoLibreBsale";
import AnularDocumentoBsale from "./AnularDocumentoBsale";
import NotaDebitoBsale from "./NotaDebitoBsale";
import EstadoBsaleBadge from "./EstadoBsale";

/* ── Trazabilidad → Facturas (2026-10-07) ────────────────────────────────────
   Pedido de Ariel: "crear una pestaña llamada Facturas en la sección de
   trazabilidad, que nos permita emitir facturas y emitir notas de crédito y
   débito". Dos listas:
   · Por facturar: guías sin factura → «Emitir factura» (la misma ventana de
     siempre, armada desde la guía de Bsale).
   · Facturas y boletas de las cotizaciones adjudicadas, con su estado en
     Bsale, sus notas de crédito/débito y los botones para emitir otra.
   Arriba: nueva factura libre y notas por N° (para documentos que no están en
   ninguna cotización). Quien no emite en Bsale ve las listas sin botones. */

const clp = (n) => `$${Math.round(Number(n) || 0).toLocaleString("es-CL")}`;
const fechaCL = (iso) => {
  if (!iso) return "—";
  const [y, m, d] = String(iso).slice(0, 10).split("-");
  return y && m && d ? `${d}-${m}-${y}` : "—";
};
const POR_PAGINA = 15;
const sinTildes = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

function Paginas({ pagina, total, porPagina, onCambiar }) {
  const paginas = Math.max(1, Math.ceil(total / porPagina));
  if (paginas <= 1) return null;
  return (
    <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 8, padding: "8px 12px", fontSize: 12.5, flexWrap: "wrap" }}>
      <span style={{ color: "var(--text-muted)" }}>Página {pagina} de {paginas} · {total} registros</span>
      <button type="button" className="btn btn-secondary btn-sm" onClick={() => onCambiar(pagina - 1)} disabled={pagina <= 1}>← Anterior</button>
      <button type="button" className="btn btn-secondary btn-sm" onClick={() => onCambiar(pagina + 1)} disabled={pagina >= paginas}>Siguiente →</button>
    </div>
  );
}

export default function FacturasTrazabilidad({ lics = [], documentosMap = {}, puedeEmitir = false, estadosBsale, onRefrescar, onAviso }) {
  const [pendientes, setPendientes] = useState(null);
  const [cargandoPend, setCargandoPend] = useState(false);
  const [q, setQ] = useState("");
  const [paginaPend, setPaginaPend] = useState(1);
  const [paginaFact, setPaginaFact] = useState(1);
  const [emitirDesdeGuia, setEmitirDesdeGuia] = useState(null); // { licId, guiaId }
  const [nuevaFactura, setNuevaFactura] = useState(false);
  const [notaCredito, setNotaCredito] = useState(null); // { documentoId } | {} (por N°)
  const [notaDebito, setNotaDebito] = useState(null);

  async function cargarPendientes() {
    if (!puedeEmitir) return;
    setCargandoPend(true);
    try {
      const r = await api.get("/bsale/facturas/pendientes");
      setPendientes(r?.filas || []);
    } catch {
      setPendientes([]);
    } finally {
      setCargandoPend(false);
    }
  }
  useEffect(() => { cargarPendientes(); /* una vez al abrir la pestaña */ }, [puedeEmitir]); // eslint-disable-line react-hooks/exhaustive-deps

  const texto = sinTildes(q.trim());

  // Facturas y boletas de las cotizaciones adjudicadas, con sus notas.
  const facturas = useMemo(() => {
    const filas = [];
    for (const lic of lics || []) {
      const docs = documentosMap[lic.id] || [];
      const notas = (tipo, id) => docs.filter((d) => d.tipo === tipo && d.deriva_de_id === id);
      for (const f of docs) {
        if (f.tipo !== "factura" && f.tipo !== "factura_boleta") continue;
        const nc = notas("nota_credito", f.id);
        const nd = notas("nota_debito", f.id);
        filas.push({
          ...f,
          lic,
          esBoleta: /boleta/i.test(String(f.descripcion || "")) || estadosBsale?.[f.id]?.clase === "boleta",
          nc,
          nd,
          ncTotal: nc.reduce((a, d) => a + Number(d.monto || 0), 0),
          ndTotal: nd.reduce((a, d) => a + Number(d.monto || 0), 0),
        });
      }
    }
    filas.sort((a, b) => String(b.fecha_factura || b.created_at || "").localeCompare(String(a.fecha_factura || a.created_at || "")) || b.id - a.id);
    return filas;
  }, [lics, documentosMap, estadosBsale]);

  const factFiltradas = useMemo(
    () => (!texto ? facturas : facturas.filter((f) => sinTildes(`${f.numero} ${f.lic?.nombre_entidad} #${f.lic?.id} ${f.lic?.id_licitacion}`).includes(texto))),
    [facturas, texto],
  );
  const pendFiltradas = useMemo(
    () => (!texto ? pendientes || [] : (pendientes || []).filter((p) => sinTildes(`${p.guia_numero} ${p.cliente} #${p.licitacion_id} ${p.codigo} ${p.oc_numero}`).includes(texto))),
    [pendientes, texto],
  );
  useEffect(() => { setPaginaFact(1); setPaginaPend(1); }, [texto]);

  const pagFact = Math.min(paginaFact, Math.max(1, Math.ceil(factFiltradas.length / POR_PAGINA)));
  const pagPend = Math.min(paginaPend, Math.max(1, Math.ceil(pendFiltradas.length / 10)));
  const visiblesFact = factFiltradas.slice((pagFact - 1) * POR_PAGINA, pagFact * POR_PAGINA);
  const visiblesPend = pendFiltradas.slice((pagPend - 1) * 10, pagPend * 10);

  const despuesDeEmitir = (licId, mensaje) => {
    if (licId) onRefrescar?.(licId);
    cargarPendientes();
    if (mensaje) onAviso?.("success", mensaje);
  };

  return (
    <div className="facturas-trazabilidad" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Ventanas */}
      {emitirDesdeGuia && (
        <EmitirFacturaBsale
          licitacionId={emitirDesdeGuia.licId}
          guiaDocId={emitirDesdeGuia.guiaId}
          onCerrar={() => setEmitirDesdeGuia(null)}
          onEmitida={(r) => despuesDeEmitir(emitirDesdeGuia.licId, `Factura ${r.numero} emitida en Bsale.`)}
        />
      )}
      {nuevaFactura && (
        <DocumentoLibreBsale tipo="factura" onCerrar={() => setNuevaFactura(false)} onEmitida={(r) => despuesDeEmitir(r?.cotizacion?.id || null, `Factura ${r.numero} emitida en Bsale.`)} />
      )}
      {notaCredito && (
        <AnularDocumentoBsale
          documentoId={notaCredito.documentoId || null}
          modoInicial={notaCredito.documentoId ? "parcial" : "total"}
          onCerrar={() => setNotaCredito(null)}
          onEmitida={(r) => despuesDeEmitir(notaCredito.licId || null, `Nota de crédito ${r.numero} emitida en Bsale.`)}
        />
      )}
      {notaDebito && (
        <NotaDebitoBsale
          documentoId={notaDebito.documentoId || null}
          onCerrar={() => setNotaDebito(null)}
          onEmitida={(r) => despuesDeEmitir(notaDebito.licId || null, `Nota de débito ${r.numero} emitida en Bsale.`)}
        />
      )}

      {/* Barra superior */}
      <div className="filter-bar" style={{ alignItems: "center" }}>
        <label className="filter-field" style={{ flex: "2 1 260px", minWidth: 0 }}>
          <span className="filter-label">Buscar</span>
          <span style={{ position: "relative", display: "block" }}>
            <Search size={14} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)" }} />
            <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="N° de factura o guía, cliente, cotización, OC…" style={{ width: "100%", paddingLeft: 30 }} />
          </span>
        </label>
        {puedeEmitir && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end", alignSelf: "flex-end" }}>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => setNuevaFactura(true)} title="Factura armada a mano (sin guía): cliente, productos y referencias">
              <Receipt size={14} /> Nueva factura
            </button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setNotaCredito({})} title="Nota de crédito buscando el documento por tipo y N° (también los hechos a mano en Bsale)">
              <Ban size={14} /> Nota de crédito por N°
            </button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setNotaDebito({})} title="Nota de débito buscando la factura por N°">
              <FilePlus2 size={14} /> Nota de débito por N°
            </button>
          </div>
        )}
      </div>

      {/* Por facturar */}
      {puedeEmitir && (
        <div className="surface">
          <div className="surface-header">
            <h3 className="surface-title">Guías por facturar {pendientes ? `(${pendFiltradas.length})` : ""}</h3>
            <button type="button" className="btn btn-ghost btn-sm" onClick={cargarPendientes} disabled={cargandoPend} title="Volver a consultar">
              <RefreshCw size={13} className={cargandoPend ? "spin" : ""} /> Actualizar
            </button>
          </div>
          <div className="table-scroll">
            <table className="data-table tabla-compacta tabla-texto" style={{ width: "100%", minWidth: 760 }}>
              <thead>
                <tr>
                  <th>Guía</th>
                  <th>Días sin facturar</th>
                  <th>Cotización / cliente</th>
                  <th>Orden de compra</th>
                  <th style={{ textAlign: "right" }}>Acción</th>
                </tr>
              </thead>
              <tbody>
                {pendientes == null ? (
                  <tr><td colSpan={5} style={{ textAlign: "center", padding: 26, color: "var(--text-muted)" }}>{cargandoPend ? "Consultando…" : "—"}</td></tr>
                ) : visiblesPend.length === 0 ? (
                  <tr><td colSpan={5} style={{ textAlign: "center", padding: 26, color: "var(--text-muted)" }}>{texto ? "Ninguna guía por facturar calza con la búsqueda." : "No hay guías por facturar."}</td></tr>
                ) : (
                  visiblesPend.map((p) => (
                    <tr key={p.guia_id}>
                      <td style={{ whiteSpace: "nowrap" }}>
                        <div style={{ fontWeight: 600 }}>{p.guia_numero || "S/N"}</div>
                        <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{fechaCL(p.guia_fecha)}</div>
                        <EstadoBsaleBadge estado={estadosBsale?.[p.guia_id]} style={{ marginTop: 2 }} />
                      </td>
                      <td style={{ whiteSpace: "nowrap" }}>
                        {p.dias != null ? <span style={{ fontWeight: 600, color: p.dias > 30 ? "#b91c1c" : p.dias > 7 ? "#b45309" : "#15803d" }}>{p.dias} día{p.dias === 1 ? "" : "s"}</span> : "—"}
                      </td>
                      <td>
                        <Link to={`/detalle/${p.licitacion_id}`} className="table-link" style={{ fontWeight: 600 }}>#{p.licitacion_id}</Link>
                        <div style={{ fontSize: 12.5 }}>{p.cliente || "—"}</div>
                      </td>
                      <td style={{ fontSize: 12.5 }}>{p.oc_numero || "—"}</td>
                      <td style={{ textAlign: "right" }}>
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          onClick={() => setEmitirDesdeGuia({ licId: p.licitacion_id, guiaId: p.guia_id })}
                          disabled={!p.emitible}
                          title={p.emitible ? `Emitir en Bsale la factura de la guía ${p.guia_numero}` : "El N° de la guía no tiene un folio reconocible: corrígelo en Trazabilidad"}
                        >
                          <FileCheck size={13} /> Emitir factura
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <Paginas pagina={pagPend} total={pendFiltradas.length} porPagina={10} onCambiar={setPaginaPend} />
        </div>
      )}

      {/* Facturas y boletas */}
      <div className="surface">
        <div className="surface-header">
          <h3 className="surface-title">Facturas y boletas ({factFiltradas.length})</h3>
        </div>
        <div className="table-scroll">
          <table className="data-table tabla-compacta tabla-texto tabla-facturas-traz" style={{ width: "100%", minWidth: 860 }}>
            <thead>
              <tr>
                <th>Documento</th>
                <th>Fecha</th>
                <th>Cotización / cliente</th>
                <th style={{ textAlign: "right" }}>Total</th>
                <th style={{ textAlign: "right" }}>Notas</th>
                <th>Pago</th>
                {puedeEmitir && <th style={{ textAlign: "right" }}>Acción</th>}
              </tr>
            </thead>
            <tbody>
              {visiblesFact.length === 0 ? (
                <tr><td colSpan={puedeEmitir ? 7 : 6} style={{ textAlign: "center", padding: 26, color: "var(--text-muted)" }}>{texto ? "Ningún documento calza con la búsqueda." : "No hay facturas ni boletas en las cotizaciones adjudicadas."}</td></tr>
              ) : (
                visiblesFact.map((f) => {
                  const est = estadosBsale?.[f.id];
                  const anulada = est?.estado === "anulado";
                  const bruto = Math.round(Number(f.monto || 0) * 1.19);
                  return (
                    <tr key={f.id}>
                      <td style={{ whiteSpace: "nowrap" }}>
                        <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{f.tipo === "factura" ? "Factura" : f.esBoleta ? "Boleta" : "Factura o boleta"}</div>
                        <div style={{ fontWeight: 600 }}>N° {f.numero || "S/N"}</div>
                        <EstadoBsaleBadge estado={est} style={{ marginTop: 2 }} />
                      </td>
                      <td style={{ whiteSpace: "nowrap" }}>{fechaCL(f.fecha_factura || f.created_at)}</td>
                      <td>
                        <Link to={`/detalle/${f.lic.id}`} className="table-link" style={{ fontWeight: 600 }}>#{f.lic.id}</Link>
                        <div style={{ fontSize: 12.5 }}>{f.lic.nombre_entidad || "—"}</div>
                      </td>
                      <td style={{ textAlign: "right", whiteSpace: "nowrap", fontWeight: 600 }}>{f.monto ? clp(bruto) : "—"}</td>
                      <td style={{ textAlign: "right", whiteSpace: "nowrap", fontSize: 12 }}>
                        {f.nc.length > 0 && <div style={{ color: "#b91c1c" }} title={f.nc.map((n) => `NC ${n.numero}`).join(", ")}>− {clp(f.ncTotal)} <span style={{ color: "var(--text-muted)" }}>NC</span></div>}
                        {f.nd.length > 0 && <div style={{ color: "#6d28d9" }} title={f.nd.map((n) => `ND ${n.numero}`).join(", ")}>+ {clp(f.ndTotal)} <span style={{ color: "var(--text-muted)" }}>ND</span></div>}
                        {!f.nc.length && !f.nd.length && <span style={{ color: "var(--text-muted)" }}>—</span>}
                      </td>
                      <td style={{ whiteSpace: "nowrap" }}>
                        {f.pagada
                          ? <span style={{ fontSize: 11, fontWeight: 700, color: "#15803d" }}>✓ Pagada</span>
                          : <span style={{ fontSize: 11, fontWeight: 700, color: "#b45309", background: "#fef3c7", padding: "1px 7px", borderRadius: 999 }}>Pendiente</span>}
                      </td>
                      {puedeEmitir && (
                        <td style={{ textAlign: "right" }}>
                          <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", flexWrap: "wrap" }}>
                            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setNotaCredito({ documentoId: f.id, licId: f.lic.id })} disabled={anulada} title={anulada ? "Anulada en Bsale" : "Nota de crédito: anular, devolver parte o ajustar el precio"}>
                              <Ban size={13} /> N. crédito
                            </button>
                            {!f.esBoleta && (
                              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setNotaDebito({ documentoId: f.id, licId: f.lic.id })} disabled={anulada} title={anulada ? "Anulada en Bsale" : "Nota de débito: cobrar intereses, diferencias de precio u otros cargos"}>
                                <FilePlus2 size={13} /> N. débito
                              </button>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <Paginas pagina={pagFact} total={factFiltradas.length} porPagina={POR_PAGINA} onCambiar={setPaginaFact} />
      </div>
      {!puedeEmitir && <div style={{ fontSize: 12.5, color: "var(--text-muted)" }}>Emitir facturas y notas en Bsale es para administración, contabilidad y jefatura de ventas especial.</div>}
    </div>
  );
}
