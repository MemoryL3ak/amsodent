import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Ban, FileCheck, FilePlus2, Receipt, RefreshCw, Search } from "lucide-react";
import { pedirPendientesFacturar } from "../lib/pendientesFacturar";
import EmitirFacturaBsale from "./EmitirFacturaBsale";
import DocumentoLibreBsale from "./DocumentoLibreBsale";
import AnularDocumentoBsale from "./AnularDocumentoBsale";
import NotaDebitoBsale from "./NotaDebitoBsale";
import EstadoBsaleBadge from "./EstadoBsale";
import DropdownSelect from "./ui/DropdownSelect";
import BotonImprimirCarta from "./BotonImprimirCarta";
import { DineroFactura, RegistrarDevolucionModal, UsarSaldoFavorModal } from "./DineroNotaCredito";
import { dineroDeFactura, PAGOS } from "../lib/dineroNotaCredito";

/* ── Trazabilidad → Facturas (2026-10-07) ────────────────────────────────────
   Pedido de Ariel: "crear una pestaña llamada Facturas en la sección de
   trazabilidad, que nos permita emitir facturas y emitir notas de crédito y
   débito". Dos listas:
   · Por facturar: guías sin factura → «Emitir factura» (la misma ventana de
     siempre, armada desde la guía de Bsale).
   · Facturas y boletas de las cotizaciones adjudicadas, con su estado en
     Bsale, sus notas de crédito/débito y los botones para emitir otra.
   Arriba: nueva factura libre y notas por N° (para documentos que no están en
   ninguna cotización). Quien no emite en Bsale ve las listas sin botones.
   (2026-10-07) "Al emitir una NC debemos ver reflejada esta anulación": una
   factura cuyas notas de crédito suman su total queda «Anulada con NC N°»
   (atenuada, sin cobro pendiente y sin botones de notas); con NC menor, «NC
   parcial». Cuenta las NC del sistema y las hechas a mano en Bsale.
   (2026-10-08) KPIs arriba ("la hiciste muy vacía, no tiene KPIs"): guías por
   facturar y su neto, las atrasadas (más de 7 días), facturado este mes, por
   cobrar, pagado este mes y anuladas/con NC. Cada tarjeta filtra su tabla.
   (2026-10-08) "Toda la trazabilidad de la anulación queda acá": la celda
   «Pago y dinero» dice qué pasó con el dinero de cada nota de crédito (se
   decide al emitirla): devolución pendiente → «Registrar devolución»; saldo a
   favor → «Aplicar a una factura»; devuelto / aplicado con fecha, medio y N°.
   Las cuentas las hace DineroNotaCredito.jsx (igual que el servidor). */

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
  const [devolucion, setDevolucion] = useState(null); // { nota, factura }: registrar la devolución del dinero
  const [saldoFavor, setSaldoFavor] = useState(null); // { nota, factura }: aplicar el saldo a favor
  // El aviso de devolución pendiente llega con ?filtro=devolucion_pendiente.
  const [filtro, setFiltro] = useState(() => {
    const f = new URLSearchParams(window.location.search).get("filtro");
    return ["devolucion_pendiente", "saldo_favor", "anuladas", "por_cobrar", "pagadas", "con_nc"].includes(f) ? f : "todas";
  });
  const [filtroPend, setFiltroPend] = useState("todas"); // todas | atrasadas
  const refGuias = useRef(null);
  const refFacturas = useRef(null);

  async function cargarPendientes(refrescar = false) {
    if (!puedeEmitir) return;
    setCargandoPend(true);
    try {
      setPendientes(await pedirPendientesFacturar({ refrescar }));
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
    // Saldos a favor aplicados: pagos (en cualquier cotización) que apuntan a una NC.
    const usosPorNc = {};
    for (const docsLic of Object.values(documentosMap || {})) for (const d of docsLic || []) if (PAGOS.includes(d.tipo) && d.origen_doc_id) (usosPorNc[d.origen_doc_id] = usosPorNc[d.origen_doc_id] || []).push(d);
    for (const lic of lics || []) {
      const docs = documentosMap[lic.id] || [];
      const notas = (tipo, id) => docs.filter((d) => d.tipo === tipo && d.deriva_de_id === id);
      for (const f of docs) {
        if (f.tipo !== "factura" && f.tipo !== "factura_boleta") continue;
        const nc = notas("nota_credito", f.id);
        const nd = notas("nota_debito", f.id);
        const est = estadosBsale?.[f.id];
        // NC: las registradas en la cotización (BRUTO) y las que Bsale conoce (también las hechas allá).
        const ncSistema = nc.reduce((a, d) => a + Number(d.monto || 0), 0);
        // Los N° de Bsale mandan (a mano a veces se cargó «FACTURA 460 ANULACION PARCIAL» como N°).
        const numsSistema = nc.map((d) => String(d.numero || "").trim()).filter(Boolean);
        const numsBsale = (est?.nc?.numeros || []).map(String);
        const ncNumeros = numsBsale.length ? [...new Set([...numsBsale, ...numsSistema.filter((n) => /^\d+$/.test(n))])] : numsSistema;
        // Hecha en Bsale y no registrada en la cotización: Bsale acredita más de lo registrado.
        const ncSoloBsale = Number(est?.nc?.total || 0) > ncSistema + 2 ? numsBsale.filter((n) => !numsSistema.includes(n)) : [];
        const ncTotal = Math.max(ncSistema, Number(est?.nc?.total || 0));
        const bruto = Math.round(Number(f.monto || 0) * 1.19);
        const anuladaNc = !!est?.nc?.completa || (bruto > 0 && ncSistema >= bruto - 2);
        const dinero = dineroDeFactura(f, docs, usosPorNc);
        filas.push({
          ...f,
          lic,
          est,
          bruto,
          esBoleta: /boleta/i.test(String(f.descripcion || "")) || est?.clase === "boleta",
          nc,
          nd,
          ncTotal,
          ncNumeros,
          ncSoloBsale,
          ncTexto: est?.nc_texto || [],
          anuladaNc,
          anulada: anuladaNc || est?.estado === "anulado",
          ndTotal: nd.reduce((a, d) => a + Number(d.monto || 0), 0),
          dinero,
          pendienteDevolver: dinero.pendienteDevolver,
          saldoFavor: dinero.saldoFavor,
        });
      }
    }
    filas.sort((a, b) => String(b.fecha_factura || b.created_at || "").localeCompare(String(a.fecha_factura || a.created_at || "")) || b.id - a.id);
    return filas;
  }, [lics, documentosMap, estadosBsale]);

  const mes = new Date().toISOString().slice(0, 7);
  const delMes = (f) => String(f.fecha_factura || f.created_at || "").slice(0, 7) === mes;
  // Lo que vale la factura hoy: total − NC + ND (con IVA).
  const saldoDe = (f) => Math.max(0, f.bruto - (f.ncTotal || 0) + (f.ndTotal || 0));
  const FILTROS = {
    todas: () => true,
    vigentes: (f) => !f.anulada,
    mes: (f) => !f.anulada && delMes(f),
    por_cobrar: (f) => !f.anulada && !f.pagada,
    pagadas: (f) => !f.anulada && f.pagada,
    anuladas: (f) => f.anulada,
    nc_parcial: (f) => !f.anulada && f.ncTotal > 0,
    con_nc: (f) => f.anulada || f.ncTotal > 0,
    con_nd: (f) => f.nd.length > 0,
    devolucion_pendiente: (f) => f.pendienteDevolver > 0 || f.dinero?.sinDecision > 0,
    saldo_favor: (f) => f.saldoFavor > 0,
  };
  const cuenta = (k) => facturas.filter(FILTROS[k]).length;
  const factFiltradas = useMemo(
    () => facturas
      .filter(FILTROS[filtro] || FILTROS.todas)
      .filter((f) => !texto || sinTildes(`${f.numero} ${f.lic?.nombre_entidad} #${f.lic?.id} ${f.lic?.id_licitacion} ${f.ncNumeros.join(" ")}`).includes(texto)),
    [facturas, texto, filtro], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const atrasada = (p) => Number(p.dias) > 7;
  const pendFiltradas = useMemo(
    () => (pendientes || [])
      .filter((p) => filtroPend !== "atrasadas" || atrasada(p))
      .filter((p) => !texto || sinTildes(`${p.guia_numero} ${p.cliente} #${p.licitacion_id} ${p.codigo} ${p.oc_numero}`).includes(texto)),
    [pendientes, texto, filtroPend],
  );
  useEffect(() => { setPaginaFact(1); setPaginaPend(1); }, [texto]);
  useEffect(() => { setPaginaFact(1); }, [filtro]);
  useEffect(() => { setPaginaPend(1); }, [filtroPend]);

  // KPIs de la pestaña (sobre todo, sin el buscador).
  const kpis = useMemo(() => {
    const pend = pendientes || [];
    const suma = (lista, fn) => lista.reduce((a, x) => a + (Number(fn(x)) || 0), 0);
    const facturadasMes = facturas.filter(FILTROS.mes);
    const porCobrar = facturas.filter(FILTROS.por_cobrar);
    const pagadasMes = facturas.filter((f) => FILTROS.pagadas(f) && String(f.fecha_pago || "").slice(0, 7) === mes);
    return {
      porFacturar: pend.length,
      porFacturarNeto: suma(pend, (p) => p.guia_neto),
      atrasadas: pend.filter(atrasada).length,
      facturadasMes: facturadasMes.length,
      facturadasMesTotal: suma(facturadasMes, (f) => f.bruto),
      porCobrar: porCobrar.length,
      porCobrarTotal: suma(porCobrar, saldoDe),
      pagadasMes: pagadasMes.length,
      pagadasMesTotal: suma(pagadasMes, saldoDe),
      anuladas: facturas.filter(FILTROS.anuladas).length,
      ncParcial: facturas.filter(FILTROS.nc_parcial).length,
      devolucionesPendientes: facturas.filter(FILTROS.devolucion_pendiente).length,
      devolucionesPendientesTotal: suma(facturas.filter(FILTROS.devolucion_pendiente), (f) => f.pendienteDevolver + (f.dinero?.sinDecision || 0)),
      saldosFavor: facturas.filter(FILTROS.saldo_favor).length,
    };
  }, [pendientes, facturas]); // eslint-disable-line react-hooks/exhaustive-deps

  const irA = (ref) => ref.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  const filtrarFacturas = (k) => { setFiltro(filtro === k ? "todas" : k); irA(refFacturas); };
  const filtrarGuias = (k) => { setFiltroPend(filtroPend === k ? "todas" : k); irA(refGuias); };
  const activa = (cond) => (cond ? { outline: "2px solid var(--primary)", outlineOffset: -2 } : {});

  const pagFact = Math.min(paginaFact, Math.max(1, Math.ceil(factFiltradas.length / POR_PAGINA)));
  const pagPend = Math.min(paginaPend, Math.max(1, Math.ceil(pendFiltradas.length / 10)));
  const visiblesFact = factFiltradas.slice((pagFact - 1) * POR_PAGINA, pagFact * POR_PAGINA);
  const visiblesPend = pendFiltradas.slice((pagPend - 1) * 10, pagPend * 10);

  const despuesDeEmitir = (licId, mensaje) => {
    if (licId) onRefrescar?.(licId);
    cargarPendientes(true);
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
      {devolucion && (
        <RegistrarDevolucionModal
          nota={devolucion.nota}
          factura={devolucion.factura}
          onCerrar={() => setDevolucion(null)}
          onHecho={(r) => { onRefrescar?.(devolucion.factura.lic.id); onAviso?.("success", r?.factura_pagada === false ? "Devolución registrada: la factura queda sin pago." : "Devolución registrada."); }}
        />
      )}
      {saldoFavor && (
        <UsarSaldoFavorModal
          nota={saldoFavor.nota}
          factura={saldoFavor.factura}
          onCerrar={() => setSaldoFavor(null)}
          onHecho={(r) => { onRefrescar?.(saldoFavor.factura.lic.id); if (r?.destino?.licitacion_id) onRefrescar?.(r.destino.licitacion_id); onAviso?.("success", `Saldo a favor aplicado a la factura N° ${r?.destino?.numero || ""}${r?.factura_pagada ? ": quedó pagada" : ""}.`); }}
        />
      )}
      {notaDebito && (
        <NotaDebitoBsale
          documentoId={notaDebito.documentoId || null}
          onCerrar={() => setNotaDebito(null)}
          onEmitida={(r) => despuesDeEmitir(notaDebito.licId || null, `Nota de débito ${r.numero} emitida en Bsale.`)}
        />
      )}

      {/* KPIs: cada tarjeta filtra su tabla (otro clic la deja en «todas»). */}
      <div className="stats-row stats-6 kpis-facturas" style={{ marginBottom: 0 }}>
        <div className="stat-card" style={{ cursor: "pointer" }} onClick={() => filtrarGuias("todas")} title="Ir a las guías por facturar">
          <div className="stat-label">Guías por facturar</div>
          <div className="stat-value">{pendientes == null ? "…" : kpis.porFacturar}</div>
          {kpis.porFacturarNeto > 0 && <div className="stat-money">{clp(kpis.porFacturarNeto)}</div>}
          <div className="stat-sub">{kpis.porFacturarNeto > 0 ? "neto despachado sin factura" : "guías despachadas sin factura"}</div>
        </div>
        <div className="stat-card" style={{ cursor: "pointer", ...activa(filtroPend === "atrasadas") }} onClick={() => filtrarGuias("atrasadas")} title="Ver solo las guías con más de 7 días sin factura">
          <div className="stat-label">Con más de 7 días</div>
          <div className="stat-value" style={{ color: kpis.atrasadas ? "var(--danger)" : undefined }}>{pendientes == null ? "…" : kpis.atrasadas}</div>
          <div className="stat-sub">guías que urge facturar</div>
        </div>
        <div className="stat-card" style={{ cursor: "pointer", ...activa(filtro === "mes") }} onClick={() => filtrarFacturas("mes")} title="Ver las facturas y boletas de este mes">
          <div className="stat-label">Facturado este mes</div>
          <div className="stat-value">{kpis.facturadasMes}</div>
          <div className="stat-money">{clp(kpis.facturadasMesTotal)}</div>
          <div className="stat-sub">con IVA · sin anuladas</div>
        </div>
        <div className="stat-card" style={{ cursor: "pointer", ...activa(filtro === "por_cobrar") }} onClick={() => filtrarFacturas("por_cobrar")} title="Ver las facturas sin pago registrado">
          <div className="stat-label">Por cobrar</div>
          <div className="stat-value" style={{ color: kpis.porCobrar ? "#b45309" : undefined }}>{kpis.porCobrar}</div>
          <div className="stat-money">{clp(kpis.porCobrarTotal)}</div>
          <div className="stat-sub">facturas sin pago · con sus notas</div>
        </div>
        <div className="stat-card" style={{ cursor: "pointer", ...activa(filtro === "pagadas") }} onClick={() => filtrarFacturas("pagadas")} title="Ver las facturas pagadas">
          <div className="stat-label">Pagado este mes</div>
          <div className="stat-value" style={{ color: "#15803d" }}>{kpis.pagadasMes}</div>
          <div className="stat-money">{clp(kpis.pagadasMesTotal)}</div>
          <div className="stat-sub">facturas con pago registrado este mes</div>
        </div>
        <div className="stat-card" style={{ cursor: "pointer", ...activa(filtro === "con_nc") }} onClick={() => filtrarFacturas("con_nc")} title="Ver las anuladas y las que tienen nota de crédito">
          <div className="stat-label">Anuladas / con NC</div>
          <div className="stat-value" style={{ color: kpis.anuladas ? "#b91c1c" : undefined }}>{kpis.anuladas}</div>
          <div className="stat-sub">
            {kpis.devolucionesPendientes
              ? <span style={{ color: "#b91c1c", fontWeight: 600 }}>{kpis.devolucionesPendientes} {kpis.devolucionesPendientes === 1 ? "devolución pendiente" : "devoluciones pendientes"} · {clp(kpis.devolucionesPendientesTotal)}</span>
              : kpis.saldosFavor
                ? <span style={{ color: "#1d4ed8" }}>{kpis.saldosFavor} con saldo a favor del cliente</span>
                : kpis.ncParcial ? `anuladas · ${kpis.ncParcial} con NC parcial` : "con nota de crédito por el total"}
          </div>
        </div>
      </div>

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
        <div className="surface" ref={refGuias}>
          <div className="surface-header" style={{ flexWrap: "wrap", gap: 8 }}>
            <h3 className="surface-title">
              Guías por facturar {pendientes ? `(${pendFiltradas.length})` : ""}
              {filtroPend === "atrasadas" && <span style={{ fontSize: 12, fontWeight: 600, color: "#b91c1c", marginLeft: 8 }}>solo con más de 7 días · <button type="button" className="table-link" onClick={() => setFiltroPend("todas")} style={{ border: 0, background: "none", padding: 0, cursor: "pointer", font: "inherit" }}>ver todas</button></span>}
            </h3>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => cargarPendientes(true)} disabled={cargandoPend} title="Volver a consultar">
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
                          disabled={!p.emitible || estadosBsale?.[p.guia_id]?.estado === "anulado"}
                          title={estadosBsale?.[p.guia_id]?.estado === "anulado"
                            ? `La guía ${p.guia_numero} está anulada en Bsale: no se factura`
                            : p.emitible ? `Emitir en Bsale la factura de la guía ${p.guia_numero}` : "El N° de la guía no tiene un folio reconocible: corrígelo en Trazabilidad"}
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
      <div className="surface" ref={refFacturas}>
        <div className="surface-header" style={{ flexWrap: "wrap", gap: 8 }}>
          <h3 className="surface-title">Facturas y boletas ({factFiltradas.length})</h3>
          <DropdownSelect
            value={filtro}
            onChange={setFiltro}
            minWidth={210}
            title="Filtrar por estado de la factura"
            style={{ width: 230, maxWidth: "100%" }}
            options={[
              { value: "todas", label: `Todas (${facturas.length})` },
              { value: "vigentes", label: `Vigentes (${cuenta("vigentes")})` },
              { value: "mes", label: `De este mes (${cuenta("mes")})` },
              { value: "por_cobrar", label: `Por cobrar (${cuenta("por_cobrar")})`, color: "#b45309" },
              { value: "pagadas", label: `Pagadas (${cuenta("pagadas")})`, color: "#15803d" },
              { value: "anuladas", label: `Anuladas (${cuenta("anuladas")})`, color: "#b91c1c", detalle: "Con nota de crédito por el total, o anuladas en Bsale" },
              { value: "nc_parcial", label: `Con NC parcial (${cuenta("nc_parcial")})`, color: "#b45309" },
              { value: "con_nc", label: `Anuladas o con NC (${cuenta("con_nc")})`, color: "#b91c1c" },
              { value: "con_nd", label: `Con nota de débito (${cuenta("con_nd")})`, color: "#6d28d9" },
              { value: "devolucion_pendiente", label: `Devolución pendiente (${cuenta("devolucion_pendiente")})`, color: "#b91c1c", detalle: "El cliente había pagado y falta devolverle el dinero" },
              { value: "saldo_favor", label: `Con saldo a favor (${cuenta("saldo_favor")})`, color: "#1d4ed8", detalle: "Dinero del cliente por aplicar a otra factura" },
            ]}
          />
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
                <th>Pago y dinero</th>
                {puedeEmitir && <th style={{ textAlign: "right" }}>Acción</th>}
              </tr>
            </thead>
            <tbody>
              {visiblesFact.length === 0 ? (
                <tr><td colSpan={puedeEmitir ? 7 : 6} style={{ textAlign: "center", padding: 26, color: "var(--text-muted)" }}>{texto || filtro !== "todas" ? "Ningún documento calza con la búsqueda o el filtro." : "No hay facturas ni boletas en las cotizaciones adjudicadas."}</td></tr>
              ) : (
                visiblesFact.map((f) => {
                  const { est, anulada, bruto } = f;
                  // Si la NC se registró en la cotización pero Bsale aún no la cuenta, la etiqueta igual dice «Anulada con NC».
                  const estBadge = f.anuladaNc && !est?.nc?.completa
                    ? { ...(est || {}), estado: est?.estado === "anulado" ? "anulado" : "vigente", clase: f.esBoleta ? "boleta" : "factura", numero: f.numero, nc: { total: f.ncTotal, numeros: f.ncNumeros, completa: true } }
                    : est;
                  const motivoBloqueo = f.anuladaNc ? `Anulada con nota de crédito${f.ncNumeros.length ? ` N° ${f.ncNumeros.join(", ")}` : ""}` : "Anulada en Bsale";
                  return (
                    <tr key={f.id} className={anulada ? "fila-anulada" : undefined}>
                      <td style={{ whiteSpace: "nowrap" }}>
                        <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{f.tipo === "factura" ? "Factura" : f.esBoleta ? "Boleta" : "Factura o boleta"}</div>
                        <div style={{ fontWeight: 600, textDecoration: anulada ? "line-through" : "none", display: "flex", alignItems: "center", gap: 4 }}>
                          N° {f.numero || "S/N"}
                          <BotonImprimirCarta bsaleId={f.bsale_id || est?.bsale_id} compacto />
                        </div>
                        <EstadoBsaleBadge estado={estBadge} style={{ marginTop: 2 }} />
                      </td>
                      <td style={{ whiteSpace: "nowrap" }}>{fechaCL(f.fecha_factura || f.created_at)}</td>
                      <td>
                        <Link to={`/detalle/${f.lic.id}`} className="table-link" style={{ fontWeight: 600 }}>#{f.lic.id}</Link>
                        <div style={{ fontSize: 12.5 }}>{f.lic.nombre_entidad || "—"}</div>
                      </td>
                      <td style={{ textAlign: "right", whiteSpace: "nowrap", fontWeight: 600, textDecoration: anulada ? "line-through" : "none" }}>{f.monto ? clp(bruto) : "—"}</td>
                      <td style={{ textAlign: "right", whiteSpace: "nowrap", fontSize: 12 }}>
                        {f.ncTotal > 0 && (
                          <div style={{ color: "#b91c1c" }} title={f.ncNumeros.map((n) => `NC ${n}`).join(", ")}>
                            − {clp(f.ncTotal)} <span style={{ color: "var(--text-muted)" }}>NC{f.ncNumeros.length ? ` ${f.ncNumeros.join(", ")}` : ""}</span>
                          </div>
                        )}
                        {f.ncSoloBsale.length > 0 && <div style={{ fontSize: 10.5, color: "var(--text-muted)" }} title="Emitida directamente en Bsale: no está registrada en la cotización">NC {f.ncSoloBsale.join(", ")} hecha en Bsale</div>}
                        {f.ncTexto.length > 0 && <div style={{ fontSize: 10.5, color: "var(--text-muted)" }} title="Nota de crédito que solo corrige texto (giro, dirección, forma de pago): no cambia el monto">NC {f.ncTexto.join(", ")} corrige texto</div>}
                        {f.nd.length > 0 && <div style={{ color: "#6d28d9" }} title={f.nd.map((n) => `ND ${n.numero}`).join(", ")}>+ {clp(f.ndTotal)} <span style={{ color: "var(--text-muted)" }}>ND</span></div>}
                        {!(f.ncTotal > 0) && !f.nd.length && !f.ncTexto.length && <span style={{ color: "var(--text-muted)" }}>—</span>}
                      </td>
                      <td style={{ minWidth: 150, verticalAlign: "top" }}>
                        <div style={{ whiteSpace: "nowrap" }}>
                          {anulada
                            ? <span style={{ fontSize: 11, fontWeight: 700, color: "#475569", background: "#f1f5f9", padding: "1px 7px", borderRadius: 999 }} title="Una factura anulada ya no se cobra">Anulada</span>
                            : f.pagada
                              ? <span style={{ fontSize: 11, fontWeight: 700, color: "#15803d" }}>✓ Pagada</span>
                              : <span style={{ fontSize: 11, fontWeight: 700, color: "#b45309", background: "#fef3c7", padding: "1px 7px", borderRadius: 999 }}>Pendiente</span>}
                        </div>
                        {/* Qué pasó con el dinero de cada nota de crédito (2026-10-08) */}
                        <DineroFactura f={f} puedeOperar={puedeEmitir} onRegistrar={(nota) => setDevolucion({ nota, factura: f })} onAplicar={(nota) => setSaldoFavor({ nota, factura: f })} />
                      </td>
                      {puedeEmitir && (
                        <td style={{ textAlign: "right" }}>
                          {anulada ? (
                            <span className="sin-notas-anulada" style={{ fontSize: 11.5, color: "var(--text-muted)" }} title={motivoBloqueo}>Sin notas: anulada</span>
                          ) : (
                          <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", flexWrap: "wrap" }}>
                            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setNotaCredito({ documentoId: f.id, licId: f.lic.id })} title="Nota de crédito: anular, devolver parte o ajustar el precio">
                              <Ban size={13} /> N. crédito
                            </button>
                            {!f.esBoleta && (
                              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setNotaDebito({ documentoId: f.id, licId: f.lic.id })} title="Nota de débito: cobrar intereses, diferencias de precio u otros cargos">
                                <FilePlus2 size={13} /> N. débito
                              </button>
                            )}
                          </div>
                          )}
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
