import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Ban, Download, Eye, FilePlus2, Search } from "lucide-react";
import AnularDocumentoBsale from "./AnularDocumentoBsale";
import NotaDebitoBsale from "./NotaDebitoBsale";
import DropdownSelect from "./ui/DropdownSelect";
import BotonImprimirCarta from "./BotonImprimirCarta";
import BotonImprimirTermica from "./BotonImprimirTermica";
import { DineroFactura, RegistrarDevolucionModal, UsarSaldoFavorModal } from "./DineroNotaCredito";
import { Paginas } from "./FacturasTrazabilidad";
import { dineroDeFactura, PAGOS } from "../lib/dineroNotaCredito";

/* ── Trazabilidad → Notas (2026-10-22) ──────────────────────────────────────
   Pedido de Ariel: "¿hicimos el repositorio de las notas de crédito y débito
   emitidas, como lo tenemos en el caso de las facturas en Trazabilidad?".
   Hasta hoy la nota solo colgaba de su factura (columna «Notas» de la pestaña
   Facturas). Acá cada nota de crédito o débito es una fila propia: N°, fecha,
   documento al que se aplica, cotización y cliente, monto, qué hizo
   (anulación total, devolución parcial, ajuste de precio, corrige texto), de
   dónde salió (emitida desde el sistema, cargada a mano, hecha directo en
   Bsale sin registrar) y qué pasó con el dinero (devolución pendiente o
   devuelta, saldo a favor o aplicado). KPIs que filtran, filtro por tipo y
   por mes, buscador y CSV. Las cuentas del dinero son las mismas de la
   pestaña Facturas (lib/dineroNotaCredito.js), así ambas dicen lo mismo.
   Las notas sin factura asociada (cargadas a mano sin elegir la factura) no
   salen en Facturas; acá sí, marcadas «Sin documento asociado». */

const clp = (n) => `$${Math.round(Number(n) || 0).toLocaleString("es-CL")}`;
const fechaCL = (iso) => {
  if (!iso) return "—";
  const [y, m, d] = String(iso).slice(0, 10).split("-");
  return y && m && d ? `${d}-${m}-${y}` : "—";
};
const POR_PAGINA = 15;
const sinTildes = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const bruto = (neto) => Math.round((Number(neto) || 0) * 1.19);
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const nombreMes = (ym) => {
  const [y, m] = String(ym || "").split("-");
  const nombre = MESES[Number(m) - 1];
  return nombre ? `${nombre[0].toUpperCase()}${nombre.slice(1)} ${y}` : ym;
};
const mesActualChile = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago", year: "numeric", month: "2-digit" }).format(new Date()).slice(0, 7);

/* Qué hizo la nota. Las emitidas desde el sistema lo dicen en su descripción
   («Anula Factura N° 415: …», «Devolución parcial de …», «Ajuste de precio de …»);
   las cargadas a mano se deducen comparando el monto con el total del documento. */
const CLASES = {
  total: { etiqueta: "Anulación total", color: "#b91c1c", fondo: "#fee2e2", detalle: "La nota de crédito suma el total del documento: queda anulado" },
  parcial: { etiqueta: "Devolución parcial", color: "#b45309", fondo: "#fef3c7", detalle: "Devuelve parte de los productos del documento" },
  ajuste: { etiqueta: "Ajuste de precio", color: "#b45309", fondo: "#fef3c7", detalle: "Rebaja el precio sin devolver productos" },
  texto: { etiqueta: "Corrige texto", color: "#475569", fondo: "#f1f5f9", detalle: "Solo corrige texto (razón social, dirección, giro, nombre de un producto…): no cambia el monto" },
  debito: { etiqueta: "Cargo adicional", color: "#6d28d9", fondo: "#ede9fe", detalle: "Aumenta lo que el cliente debe por el documento: intereses, diferencia de precio, un cargo no cobrado" },
};
const ORIGENES = {
  manual: { etiqueta: "Cargada a mano", detalle: "Registrada a mano en la cotización (Seguimiento de Pagos o documentos), no emitida desde el sistema" },
  bsale: { etiqueta: "Solo en Bsale", detalle: "Hecha directamente en Bsale: no está registrada en la cotización" },
};
function claseNc(d, factura) {
  const s = String(d.descripcion || "");
  if (/^Anula /.test(s)) return "total";
  if (/^Devoluci[oó]n parcial/.test(s)) return "parcial";
  if (/^Ajuste de precio/.test(s)) return "ajuste";
  if (/^Corrige texto/.test(s)) return "texto";
  if (factura && factura.bruto > 0) return Number(d.monto || 0) >= factura.bruto - 2 ? "total" : "parcial";
  return null;
}
// «Anula Factura N° 415: el cliente devolvió todo» → «el cliente devolvió todo».
function motivoDe(descripcion) {
  const s = String(descripcion || "").trim();
  const m = s.match(/^(Anula|Devoluci[oó]n parcial de|Ajuste de precio de|Corrige texto de|Nota de d[eé]bito de) .*? N° [^:]+: (.*)$/s);
  return m ? m[2].trim() : s;
}

const pill = (texto, color, fondo, title) => (
  <span style={{ fontSize: 11, fontWeight: 700, color, background: fondo, padding: "1px 7px", borderRadius: 999, whiteSpace: "nowrap" }} title={title}>{texto}</span>
);

export default function NotasTrazabilidad({ lics = [], documentosMap = {}, estadosBsale, puedeEmitir = false, onRefrescar, onAviso, onAbrirDocumento }) {
  const [q, setQ] = useState("");
  const [pagina, setPagina] = useState(1);
  const [notaCredito, setNotaCredito] = useState(null);
  const [notaDebito, setNotaDebito] = useState(null);
  const [devolucion, setDevolucion] = useState(null); // { nota, factura }
  const [saldoFavor, setSaldoFavor] = useState(null); // { nota, factura }
  const [filtro, setFiltro] = useState(() => {
    const p = new URLSearchParams(window.location.search);
    const f = p.get("filtro");
    return p.get("pestana") === "notas" && ["nc", "nd", "total", "parcial", "texto", "bsale", "manual", "sin_documento", "devolucion_pendiente", "saldo_favor"].includes(f) ? f : "todas";
  });
  const [mes, setMes] = useState("todos");
  const texto = sinTildes(q.trim());
  const mesActual = mesActualChile();

  // Una fila por nota: las registradas en las cotizaciones adjudicadas más las que solo Bsale conoce.
  const filas = useMemo(() => {
    const out = [];
    // Saldos a favor aplicados: pagos (en cualquier cotización) que apuntan a una NC.
    const usosPorNc = {};
    for (const docsLic of Object.values(documentosMap || {})) for (const d of docsLic || []) if (PAGOS.includes(d.tipo) && d.origen_doc_id) (usosPorNc[d.origen_doc_id] = usosPorNc[d.origen_doc_id] || []).push(d);
    for (const lic of lics || []) {
      const docs = documentosMap[lic.id] || [];
      const facturas = docs
        .filter((f) => f.tipo === "factura" || f.tipo === "factura_boleta")
        .map((f) => {
          const est = estadosBsale?.[f.id];
          const ncSistema = docs.filter((d) => d.tipo === "nota_credito" && d.deriva_de_id === f.id).reduce((a, d) => a + Number(d.monto || 0), 0);
          const b = bruto(f.monto);
          return { ...f, lic, est, bruto: b, ncSistema, esBoleta: /boleta/i.test(String(f.descripcion || "")) || est?.clase === "boleta", anulada: est?.estado === "anulado" || !!est?.nc?.completa || (b > 0 && ncSistema >= b - 2) };
        });
      const porId = new Map(facturas.map((f) => [f.id, f]));
      const dineroPorNc = {};
      for (const f of facturas) for (const n of dineroDeFactura(f, docs, usosPorNc).notas) dineroPorNc[n.nc.id] = { nota: n, factura: f };
      const numerosNc = new Set();
      for (const d of docs) {
        if (d.tipo !== "nota_credito" && d.tipo !== "nota_debito") continue;
        const esNc = d.tipo === "nota_credito";
        const factura = d.deriva_de_id != null ? porId.get(Number(d.deriva_de_id)) || null : null;
        const numero = String(d.numero || "").trim();
        if (esNc && numero) numerosNc.add(numero);
        out.push({
          clave: `d${d.id}`, id: d.id, esNc, numero: numero || null,
          fecha: String(d.fecha_oc || d.created_at || "").slice(0, 10) || null,
          monto: Number(d.monto) || 0, factura, lic,
          clase: esNc ? claseNc(d, factura) : "debito",
          motivo: motivoDe(d.descripcion),
          origen: d.bsale_id ? "sistema" : "manual",
          dinero: esNc ? dineroPorNc[d.id]?.nota || null : null,
          bsale_url: d.bsale_url || null, bsale_id: d.bsale_id || null,
          archivo: d.bucket && d.storage_path ? d : null,
        });
      }
      // NC hechas directo en Bsale (Bsale acredita más de lo registrado) y las que solo corrigen texto.
      for (const f of facturas) {
        const est = f.est;
        if (!est) continue;
        const numsBsale = (est.nc?.numeros || []).map(String).filter((n) => !numerosNc.has(n));
        const soloBsale = Number(est.nc?.total || 0) > f.ncSistema + 2 ? numsBsale : [];
        for (const n of soloBsale) {
          const monto = soloBsale.length === 1 ? Math.max(0, Number(est.nc.total) - f.ncSistema) : null;
          out.push({ clave: `b${f.id}-${n}`, id: null, esNc: true, numero: n, fecha: null, monto, factura: f, lic, clase: monto == null ? null : monto >= f.bruto - 2 ? "total" : "parcial", motivo: "", origen: "bsale", dinero: null, bsale_url: null, bsale_id: null, archivo: null });
        }
        for (const n of (est.nc_texto || []).map(String)) {
          if (numerosNc.has(n)) continue;
          out.push({ clave: `t${f.id}-${n}`, id: null, esNc: true, numero: n, fecha: null, monto: 0, factura: f, lic, clase: "texto", motivo: "", origen: "bsale", dinero: null, bsale_url: null, bsale_id: null, archivo: null });
        }
      }
    }
    // Más recientes primero; las que no tienen fecha (solo en Bsale), al final.
    out.sort((a, b) => String(b.fecha || "").localeCompare(String(a.fecha || "")) || (b.id || 0) - (a.id || 0));
    return out;
  }, [lics, documentosMap, estadosBsale]);

  const mesDe = (r) => String(r.fecha || "").slice(0, 7);
  const conDinero = (r, cual) => !!r.dinero && r.dinero.disponible > 0 && (cual ? r.dinero.dinero === cual : !r.dinero.dinero);
  const FILTROS = {
    todas: () => true,
    nc: (r) => r.esNc,
    nd: (r) => !r.esNc,
    total: (r) => r.esNc && r.clase === "total",
    parcial: (r) => r.esNc && (r.clase === "parcial" || r.clase === "ajuste"),
    texto: (r) => r.clase === "texto",
    bsale: (r) => r.origen === "bsale",
    manual: (r) => r.origen === "manual",
    sin_documento: (r) => !r.factura,
    devolucion_pendiente: (r) => conDinero(r, "devolver") || conDinero(r, null),
    saldo_favor: (r) => conDinero(r, "saldo_favor"),
  };
  const cuenta = (k) => filas.filter(FILTROS[k]).length;
  const meses = useMemo(() => {
    const m = {};
    for (const r of filas) { const k = mesDe(r); if (k) m[k] = (m[k] || 0) + 1; }
    return Object.keys(m).sort().reverse().map((k) => ({ value: k, label: `${nombreMes(k)} (${m[k]})` }));
  }, [filas]);
  const filtradas = useMemo(
    () => filas
      .filter(FILTROS[filtro] || FILTROS.todas)
      .filter((r) => mes === "todos" || mesDe(r) === mes)
      .filter((r) => !texto || sinTildes(`${r.numero} ${r.factura?.numero} ${r.lic?.nombre_entidad} #${r.lic?.id} ${r.lic?.id_licitacion} ${r.motivo}`).includes(texto)),
    [filas, filtro, mes, texto], // eslint-disable-line react-hooks/exhaustive-deps
  );
  useEffect(() => { setPagina(1); }, [texto, filtro, mes]);

  // KPIs (sobre todas las notas, sin el buscador). Cada tarjeta filtra la tabla.
  const kpis = useMemo(() => {
    const suma = (l, fn = (r) => r.monto) => l.reduce((a, r) => a + (Number(fn(r)) || 0), 0);
    const ncMes = filas.filter((r) => r.esNc && mesDe(r) === mesActual);
    const ndMes = filas.filter((r) => !r.esNc && mesDe(r) === mesActual);
    const anulaciones = filas.filter(FILTROS.total);
    const parciales = filas.filter(FILTROS.parcial);
    const devPend = filas.filter(FILTROS.devolucion_pendiente);
    const saldos = filas.filter(FILTROS.saldo_favor);
    return {
      ncMes: ncMes.length, ncMesTotal: suma(ncMes),
      ndMes: ndMes.length, ndMesTotal: suma(ndMes),
      anulaciones: anulaciones.length, anulacionesTotal: suma(anulaciones),
      parciales: parciales.length, parcialesTotal: suma(parciales),
      devPend: devPend.length, devPendTotal: suma(devPend, (r) => r.dinero.disponible),
      saldos: saldos.length, saldosTotal: suma(saldos, (r) => r.dinero.disponible),
      soloBsale: filas.filter((r) => r.origen === "bsale" && r.clase !== "texto").length,
      sinDocumento: cuenta("sin_documento"),
    };
  }, [filas]); // eslint-disable-line react-hooks/exhaustive-deps

  const elegir = (f, m = "todos") => {
    if (filtro === f && mes === m) { setFiltro("todas"); setMes("todos"); } else { setFiltro(f); setMes(m); }
  };
  const activa = (f, m = "todos") => (filtro === f && mes === m ? { outline: "2px solid var(--primary)", outlineOffset: -2 } : {});

  const pag = Math.min(pagina, Math.max(1, Math.ceil(filtradas.length / POR_PAGINA)));
  const visibles = filtradas.slice((pag - 1) * POR_PAGINA, pag * POR_PAGINA);

  const despuesDeEmitir = (licId, mensaje) => {
    if (licId) onRefrescar?.(licId);
    if (mensaje) onAviso?.("success", mensaje);
  };

  async function descargarCsv() {
    if (!filtradas.length) { onAviso?.("info", "No hay notas en el filtro actual para exportar."); return; }
    try {
      const XLSX = await import("xlsx");
      const filasCsv = filtradas.map((r) => ({
        "Tipo": r.esNc ? "Nota de crédito" : "Nota de débito",
        "N°": r.numero || "",
        "Fecha": fechaCL(r.fecha) === "—" ? "" : fechaCL(r.fecha),
        "Aplica a": r.factura ? `${r.factura.tipo === "factura" ? "Factura" : r.factura.esBoleta ? "Boleta" : "Factura/boleta"} N° ${r.factura.numero || "S/N"}` : "",
        "Total del documento (con IVA)": r.factura ? r.factura.bruto : "",
        "Cotización": r.lic?.id ?? "",
        "Cliente": r.lic?.nombre_entidad || "",
        "Monto (con IVA)": r.monto == null ? "" : r.esNc ? -r.monto : r.monto,
        "Qué hizo": r.clase ? CLASES[r.clase].etiqueta : "",
        "Motivo": r.motivo || "",
        "Origen": r.origen === "sistema" ? "Emitida desde el sistema" : ORIGENES[r.origen].etiqueta,
        "Dinero": r.dinero ? (r.dinero.dinero === "devolver" ? "Devolver al cliente" : r.dinero.dinero === "saldo_favor" ? "Saldo a favor" : r.dinero.dinero === "rebajar_deuda" ? "Rebaja de deuda" : r.dinero.dinero === "sin_movimiento" ? "Sin movimiento" : "Sin decisión") : "",
        "Pendiente (con IVA)": r.dinero && (r.dinero.dinero === "devolver" || r.dinero.dinero === "saldo_favor" || !r.dinero.dinero) ? r.dinero.disponible : "",
        "Devuelto": r.dinero ? r.dinero.devuelto : "",
        "Aplicado": r.dinero ? r.dinero.usado : "",
        "PDF": r.bsale_url || "",
      }));
      const csv = XLSX.utils.sheet_to_csv(XLSX.utils.json_to_sheet(filasCsv), { FS: ";" });
      const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `notas_credito_debito_${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(link.href);
      onAviso?.("success", `CSV generado con ${filasCsv.length} ${filasCsv.length === 1 ? "nota" : "notas"}.`);
    } catch {
      onAviso?.("error", "No se pudo generar el CSV.");
    }
  }

  return (
    <div className="notas-trazabilidad" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Ventanas */}
      {notaCredito && (
        <AnularDocumentoBsale
          documentoId={null}
          modoInicial="total"
          onCerrar={() => setNotaCredito(null)}
          onEmitida={(r) => despuesDeEmitir(r?.cotizacion?.id || r?.licitacion_id || null, `Nota de crédito ${r.numero} emitida en Bsale.`)}
        />
      )}
      {notaDebito && (
        <NotaDebitoBsale
          documentoId={null}
          onCerrar={() => setNotaDebito(null)}
          onEmitida={(r) => despuesDeEmitir(r?.cotizacion?.id || r?.licitacion_id || null, `Nota de débito ${r.numero} emitida en Bsale.`)}
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

      {/* KPIs: cada tarjeta filtra la tabla (otro clic la deja en «todas»). */}
      <div className="stats-row stats-6 kpis-notas" style={{ marginBottom: 0 }}>
        <div className="stat-card" style={{ cursor: "pointer", ...activa("nc", mesActual) }} onClick={() => elegir("nc", mesActual)} title="Ver las notas de crédito de este mes">
          <div className="stat-label">NC este mes</div>
          <div className="stat-value" style={{ color: kpis.ncMes ? "#b91c1c" : undefined }}>{kpis.ncMes}</div>
          <div className="stat-money">{clp(kpis.ncMesTotal)}</div>
          <div className="stat-sub">acreditado al cliente · con IVA</div>
        </div>
        <div className="stat-card" style={{ cursor: "pointer", ...activa("nd", mesActual) }} onClick={() => elegir("nd", mesActual)} title="Ver las notas de débito de este mes">
          <div className="stat-label">ND este mes</div>
          <div className="stat-value" style={{ color: kpis.ndMes ? "#6d28d9" : undefined }}>{kpis.ndMes}</div>
          <div className="stat-money">{clp(kpis.ndMesTotal)}</div>
          <div className="stat-sub">cargos adicionales · con IVA</div>
        </div>
        <div className="stat-card" style={{ cursor: "pointer", ...activa("total") }} onClick={() => elegir("total")} title="Ver las notas de crédito que anulan el documento completo">
          <div className="stat-label">Anulaciones</div>
          <div className="stat-value">{kpis.anulaciones}</div>
          <div className="stat-money">{clp(kpis.anulacionesTotal)}</div>
          <div className="stat-sub">
            {kpis.soloBsale
              ? <span style={{ color: "#b45309", fontWeight: 600 }}>{kpis.soloBsale} {kpis.soloBsale === 1 ? "hecha en Bsale sin registrar" : "hechas en Bsale sin registrar"}</span>
              : "notas por el total del documento"}
          </div>
        </div>
        <div className="stat-card" style={{ cursor: "pointer", ...activa("parcial") }} onClick={() => elegir("parcial")} title="Ver las devoluciones parciales y los ajustes de precio">
          <div className="stat-label">Parciales y ajustes</div>
          <div className="stat-value">{kpis.parciales}</div>
          <div className="stat-money">{clp(kpis.parcialesTotal)}</div>
          <div className="stat-sub">{kpis.sinDocumento ? <span style={{ color: "#b45309" }}>{kpis.sinDocumento} sin documento asociado</span> : "devolución parcial o ajuste de precio"}</div>
        </div>
        <div className="stat-card" style={{ cursor: "pointer", ...activa("devolucion_pendiente") }} onClick={() => elegir("devolucion_pendiente")} title="Ver las notas con dinero del cliente por devolver">
          <div className="stat-label">Devolución pendiente</div>
          <div className="stat-value" style={{ color: kpis.devPend ? "var(--danger)" : undefined }}>{kpis.devPend}</div>
          <div className="stat-money">{clp(kpis.devPendTotal)}</div>
          <div className="stat-sub">el cliente ya había pagado</div>
        </div>
        <div className="stat-card" style={{ cursor: "pointer", ...activa("saldo_favor") }} onClick={() => elegir("saldo_favor")} title="Ver las notas con saldo a favor del cliente por aplicar">
          <div className="stat-label">Saldo a favor</div>
          <div className="stat-value" style={{ color: kpis.saldos ? "#1d4ed8" : undefined }}>{kpis.saldos}</div>
          <div className="stat-money">{clp(kpis.saldosTotal)}</div>
          <div className="stat-sub">por aplicar a otra factura</div>
        </div>
      </div>

      {/* Barra superior */}
      <div className="filter-bar" style={{ alignItems: "flex-end" }}>
        <label className="filter-field" style={{ flex: "2 1 240px", minWidth: 0 }}>
          <span className="filter-label">Buscar</span>
          <span style={{ position: "relative", display: "block" }}>
            <Search size={14} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)" }} />
            <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="N° de nota o factura, cliente, cotización, motivo…" style={{ width: "100%", paddingLeft: 30 }} />
          </span>
        </label>
        <div className="filter-field" style={{ flex: "0 1 230px", minWidth: 0 }}>
          <span className="filter-label">Tipo</span>
          <DropdownSelect
            value={filtro}
            onChange={setFiltro}
            minWidth={200}
            title="Filtrar por tipo de nota"
            style={{ width: "100%" }}
            options={[
              { value: "todas", label: `Todas (${filas.length})` },
              { value: "nc", label: `Notas de crédito (${cuenta("nc")})`, color: "#b91c1c" },
              { value: "nd", label: `Notas de débito (${cuenta("nd")})`, color: "#6d28d9" },
              { value: "total", label: `Anulaciones totales (${cuenta("total")})`, color: "#b91c1c", detalle: "NC por el total del documento" },
              { value: "parcial", label: `Parciales y ajustes (${cuenta("parcial")})`, color: "#b45309", detalle: "Devolución parcial o ajuste de precio" },
              { value: "texto", label: `Corrigen texto (${cuenta("texto")})`, detalle: "Solo corrigen texto (razón social, dirección, giro, producto): no cambian el monto" },
              { value: "bsale", label: `Hechas en Bsale (${cuenta("bsale")})`, color: "#b45309", detalle: "No están registradas en la cotización" },
              { value: "manual", label: `Cargadas a mano (${cuenta("manual")})`, detalle: "Registradas sin emitirlas desde el sistema" },
              { value: "sin_documento", label: `Sin documento asociado (${cuenta("sin_documento")})`, color: "#b45309", detalle: "No se sabe a qué factura o boleta aplican" },
              { value: "devolucion_pendiente", label: `Devolución pendiente (${cuenta("devolucion_pendiente")})`, color: "#b91c1c", detalle: "El cliente había pagado y falta devolverle el dinero" },
              { value: "saldo_favor", label: `Con saldo a favor (${cuenta("saldo_favor")})`, color: "#1d4ed8", detalle: "Dinero del cliente por aplicar a otra factura" },
            ]}
          />
        </div>
        <div className="filter-field" style={{ flex: "0 1 190px", minWidth: 0 }}>
          <span className="filter-label">Mes</span>
          <DropdownSelect
            value={mes}
            onChange={setMes}
            minWidth={170}
            title="Filtrar por mes de la nota"
            style={{ width: "100%" }}
            options={[{ value: "todos", label: "Todos los meses" }, ...meses]}
          />
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
          <button type="button" className="btn btn-secondary btn-sm" onClick={descargarCsv} title="Descargar las notas del filtro actual en CSV">
            <Download size={14} /> CSV
          </button>
          {puedeEmitir && (
            <>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setNotaCredito({})} title="Nota de crédito buscando el documento por tipo y N° (también los hechos a mano en Bsale)">
                <Ban size={14} /> Nota de crédito por N°
              </button>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setNotaDebito({})} title="Nota de débito buscando la factura por N°">
                <FilePlus2 size={14} /> Nota de débito por N°
              </button>
            </>
          )}
        </div>
      </div>

      {/* Tabla */}
      <div className="surface">
        <div className="surface-header" style={{ flexWrap: "wrap", gap: 8 }}>
          <h3 className="surface-title">Notas de crédito y débito ({filtradas.length})</h3>
          {(filtro !== "todas" || mes !== "todos") && (
            <button type="button" className="table-link" onClick={() => { setFiltro("todas"); setMes("todos"); }} style={{ border: 0, background: "none", padding: 0, cursor: "pointer", font: "inherit", fontSize: 12.5 }}>ver todas</button>
          )}
        </div>
        <div className="table-scroll">
          <table className="data-table tabla-compacta tabla-texto tabla-notas-traz" style={{ width: "100%", minWidth: 960 }}>
            <thead>
              <tr>
                <th>Nota</th>
                <th>Fecha</th>
                <th>Aplica a</th>
                <th>Cotización / cliente</th>
                <th style={{ textAlign: "right" }}>Monto</th>
                <th>Qué hizo y por qué</th>
                <th>Dinero</th>
              </tr>
            </thead>
            <tbody>
              {visibles.length === 0 ? (
                <tr><td colSpan={7} style={{ textAlign: "center", padding: 26, color: "var(--text-muted)" }}>{texto || filtro !== "todas" || mes !== "todos" ? "Ninguna nota calza con la búsqueda o el filtro." : "No hay notas de crédito ni de débito en las cotizaciones adjudicadas."}</td></tr>
              ) : (
                visibles.map((r) => {
                  const c = r.clase ? CLASES[r.clase] : null;
                  const o = ORIGENES[r.origen];
                  const f = r.factura;
                  const sinDinero = r.dinero && !r.dinero.dinero && r.dinero.disponible <= 0 && !r.dinero.devuelto && !r.dinero.usado;
                  return (
                    <tr key={r.clave}>
                      <td style={{ maxWidth: 190 }}>
                        <div style={{ fontSize: 11, color: r.esNc ? "#b91c1c" : "#6d28d9", fontWeight: 700, whiteSpace: "nowrap" }}>{r.esNc ? "Nota de crédito" : "Nota de débito"}</div>
                        {/* El N° puede venir largo cargado a mano («FACTURA 460 ANULACION PARCIAL»): se parte, no ensancha la tabla. */}
                        <div style={{ fontWeight: 600, display: "flex", alignItems: "center", flexWrap: "wrap", gap: 4, overflowWrap: "anywhere" }}>
                          N° {r.numero || "S/N"}
                          <BotonImprimirTermica urlPdf={r.bsale_url} compacto />
                          <BotonImprimirCarta bsaleId={r.bsale_id} compacto />
                          {r.archivo && !r.bsale_url && (
                            <button type="button" className="btn btn-ghost" onClick={() => onAbrirDocumento?.(r.archivo)} title={`Abrir ${r.archivo.file_name || "el archivo cargado"}`} aria-label="Abrir el archivo de la nota" style={{ padding: 4 }}>
                              <Eye size={14} />
                            </button>
                          )}
                        </div>
                        {o && <div style={{ marginTop: 2 }}>{pill(o.etiqueta, "#b45309", "#fef3c7", o.detalle)}</div>}
                      </td>
                      <td style={{ whiteSpace: "nowrap" }} title={r.fecha ? undefined : "Hecha en Bsale: el sistema no tiene su fecha"}>{fechaCL(r.fecha)}</td>
                      <td>
                        {f ? (
                          <>
                            <div style={{ fontWeight: 600, whiteSpace: "nowrap" }}>{f.tipo === "factura" ? "Factura" : f.esBoleta ? "Boleta" : "Factura/boleta"} N° {f.numero || "S/N"}</div>
                            <div style={{ fontSize: 11.5, color: "var(--text-muted)", display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                              {f.monto ? clp(f.bruto) : "—"}
                              {f.anulada && pill("Anulada", "#475569", "#f1f5f9", "El documento quedó anulado")}
                            </div>
                          </>
                        ) : (
                          <span style={{ color: "#b45309", fontSize: 12.5 }} title="La nota se cargó sin elegir la factura o boleta a la que aplica">Sin documento asociado</span>
                        )}
                      </td>
                      <td>
                        <Link to={`/detalle/${r.lic.id}`} className="table-link" style={{ fontWeight: 600 }}>#{r.lic.id}</Link>
                        <div style={{ fontSize: 12.5 }}>{r.lic.nombre_entidad || "—"}</div>
                      </td>
                      <td style={{ textAlign: "right", whiteSpace: "nowrap", fontWeight: 600, color: r.esNc ? "#b91c1c" : "#6d28d9" }}>
                        {r.monto == null ? <span style={{ color: "var(--text-muted)", fontWeight: 400 }} title="Monto no registrado: verlo en Bsale">—</span> : r.clase === "texto" ? <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>$0</span> : `${r.esNc ? "−" : "+"} ${clp(r.monto)}`}
                      </td>
                      <td style={{ minWidth: 150 }}>
                        {c ? pill(c.etiqueta, c.color, c.fondo, c.detalle) : <span style={{ fontSize: 11, color: "var(--text-muted)" }}>—</span>}
                        {r.motivo && <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 3, whiteSpace: "normal", maxWidth: 280, overflowWrap: "anywhere" }} title={r.motivo}>{r.motivo}</div>}
                      </td>
                      <td style={{ minWidth: 140, verticalAlign: "top" }}>
                        {!r.esNc ? (
                          <span style={{ fontSize: 11.5, color: "var(--text-muted)" }}>Suma al saldo de la factura</span>
                        ) : r.dinero && !sinDinero ? (
                          <DineroFactura f={{ dinero: { notas: [r.dinero] } }} puedeOperar={puedeEmitir} onRegistrar={(nota) => setDevolucion({ nota, factura: f })} onAplicar={(nota) => setSaldoFavor({ nota, factura: f })} />
                        ) : (
                          <span style={{ fontSize: 11.5, color: "var(--text-muted)" }} title={r.origen === "bsale" ? "Sin registro en la cotización: no se puede seguir el dinero" : !f ? "Sin documento asociado: no se puede seguir el dinero" : "Sin decisión sobre el dinero y sin pago registrado"}>
                            {r.origen === "bsale" ? "Sin registro en el sistema" : !f ? "Sin documento asociado" : "Sin pago registrado"}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <Paginas pagina={pag} total={filtradas.length} porPagina={POR_PAGINA} onCambiar={setPagina} />
      </div>
      {!puedeEmitir && <div style={{ fontSize: 12.5, color: "var(--text-muted)" }}>Emitir notas de crédito y débito en Bsale es para administración, contabilidad y jefatura de ventas especial.</div>}
    </div>
  );
}
