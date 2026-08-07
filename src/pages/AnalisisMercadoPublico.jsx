import { useEffect, useMemo, useState } from "react";
import {
  Trophy, TrendingDown, RefreshCw, Search, ChevronDown, ChevronRight,
  Target, Percent, AlertTriangle, KeyRound, Crown, Building2, Scale,
} from "lucide-react";
import { api } from "../lib/api";
import Toast from "../components/Toast";

/* ============================================================
   Análisis Mercado Público — nuestras postulaciones vs la oferta
   GANADORA de cada proceso (Compra Ágil y Licitaciones), con los
   datos oficiales de las APIs de Mercado Público sincronizados por
   el backend (mp_resultados).
   ─ KPIs: tasa de éxito, monto ganado, oportunidad perdida, brechas.
   ─ Dona resultado global · barras de brechas · ranking competidores.
   ─ Tabla por proceso, expandible: todas las cotizaciones del
     proceso + comparación producto a producto contra el ganador.
============================================================ */

const fmt$ = (v) => (v == null || Number.isNaN(Number(v)) ? "—" : `$${Math.round(Number(v)).toLocaleString("es-CL")}`);
const fmtPct = (v) => (v == null || !Number.isFinite(v) ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(1)}%`);
const fmtFecha = (iso) => (iso ? new Date(iso).toLocaleDateString("es-CL", { day: "2-digit", month: "2-digit", year: "numeric" }) : "—");

// Clasificación de cada proceso para el panel.
function clasificar(r) {
  if (r.ganamos === true) return "ganada";
  if (r.ganamos === false && r.participamos === false) return "sin_participar";
  if (r.ganamos === false) return "perdida";
  if (["desierta", "cancelada", "revocada", "suspendida"].includes(r.estado_mp)) return "sin_efecto";
  if (r.estado_mp === "no_encontrada") return "no_encontrada";
  return "en_curso";
}

const CLASES = {
  ganada:         { label: "Ganada",          color: "#15803d", bg: "#dcfce7" },
  perdida:        { label: "Perdida",         color: "#b91c1c", bg: "#fee2e2" },
  en_curso:       { label: "En curso",        color: "#b45309", bg: "#fef3c7" },
  sin_efecto:     { label: "Sin efecto",      color: "#475569", bg: "#e2e8f0" },
  sin_participar: { label: "No participamos", color: "#6d28d9", bg: "#ede9fe" },
  no_encontrada:  { label: "No encontrada",   color: "#64748b", bg: "#f1f5f9" },
};

function brechaPct(r) {
  const mio = Number(r.monto_nuestro);
  const gan = Number(r.monto_ganador);
  if (!Number.isFinite(mio) || !Number.isFinite(gan) || gan <= 0) return null;
  return ((mio - gan) / gan) * 100;
}

export default function AnalisisMercadoPublico() {
  const [estadoApi, setEstadoApi] = useState(null);
  const [resultados, setResultados] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sincronizando, setSincronizando] = useState(false);
  const [progresoSync, setProgresoSync] = useState(null); // { hechas, restantes }
  const [toast, setToast] = useState(null);
  const [busqueda, setBusqueda] = useState("");
  const [filtroClase, setFiltroClase] = useState("");
  const [filtroTipo, setFiltroTipo] = useState("");
  const [expandida, setExpandida] = useState(null);
  const [donaPorMonto, setDonaPorMonto] = useState(false);
  // Rango de cotizaciones internas a sincronizar (vacío = últimos 8 meses).
  const [syncDesde, setSyncDesde] = useState("");
  const [syncHasta, setSyncHasta] = useState("");

  async function cargarResultados() {
    const res = await api.get("/mercado-publico/resultados");
    setResultados(Array.isArray(res) ? res : []);
  }

  async function cargar() {
    setLoading(true);
    try {
      const est = await api.get("/mercado-publico/estado");
      setEstadoApi(est);
      await cargarResultados();
    } catch (e) {
      setToast({ type: "error", message: e?.message || "Error cargando el análisis." });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { cargar(); }, []);

  // Sincronización INCREMENTAL: tandas de 8 procesos en loop, refrescando la
  // tabla tras cada tanda — los resultados aparecen en vivo, sin recargar.
  async function sincronizar() {
    setSincronizando(true);
    setProgresoSync({ hechas: 0, restantes: null });
    let hechas = 0;
    let finalizadas = 0;
    let erroresTotal = 0;
    let cuotaAgotada = false;
    try {
      for (let i = 0; i < 60; i++) {
        const r = await api.post("/mercado-publico/sincronizar", {
          desde: syncDesde || undefined,
          hasta: syncHasta || undefined,
          lote: 8,
        });
        hechas += r.consultadas || 0;
        finalizadas += r.finalizadas || 0;
        erroresTotal += r.errores?.length || 0;
        cuotaAgotada = !!r.cuota_agotada;
        setProgresoSync({ hechas, restantes: r.restantes ?? 0 });
        await cargarResultados(); // la tabla se actualiza en vivo
        if (cuotaAgotada || !r.restantes || !r.consultadas) break;
      }
      const partes = [`${hechas} proceso${hechas === 1 ? "" : "s"} consultado${hechas === 1 ? "" : "s"}`];
      if (finalizadas) partes.push(`${finalizadas} con resultado final`);
      if (cuotaAgotada) partes.push("cuota diaria de la API agotada, el resto queda para mañana");
      if (erroresTotal) partes.push(`${erroresTotal} con error`);
      setToast({ type: erroresTotal || cuotaAgotada ? "info" : "success", message: `Sincronización completa: ${partes.join(" · ")}.` });
    } catch (e) {
      setToast({ type: "error", message: e?.message || "No se pudo sincronizar." });
    } finally {
      setSincronizando(false);
      setProgresoSync(null);
    }
  }

  /* ── Métricas ── */
  const filas = useMemo(
    () => resultados.map((r) => ({ ...r, clase: clasificar(r), brecha: brechaPct(r) })),
    [resultados],
  );

  const stats = useMemo(() => {
    const ganadas = filas.filter((f) => f.clase === "ganada");
    const perdidas = filas.filter((f) => f.clase === "perdida");
    const decididas = ganadas.length + perdidas.length;
    const montoGanado = ganadas.reduce((s, f) => s + (Number(f.monto_nuestro) || 0), 0);
    const oportunidadPerdida = perdidas.reduce((s, f) => s + (Number(f.monto_ganador) || 0), 0);
    const brechas = perdidas.map((f) => f.brecha).filter((b) => Number.isFinite(b) && b > 0);
    const brechaProm = brechas.length ? brechas.reduce((s, b) => s + b, 0) / brechas.length : null;
    // Perdidas "por poco": brecha menor al 5%.
    const casiGanadas = brechas.filter((b) => b <= 5).length;
    return {
      total: filas.length,
      ganadas: ganadas.length,
      perdidas: perdidas.length,
      enCurso: filas.filter((f) => f.clase === "en_curso").length,
      tasa: decididas ? (ganadas.length / decididas) * 100 : null,
      montoGanado,
      oportunidadPerdida,
      brechaProm,
      casiGanadas,
    };
  }, [filas]);

  // Ranking de competidores que nos han ganado.
  const competidores = useMemo(() => {
    const mapa = new Map();
    for (const f of filas) {
      if (f.clase !== "perdida" || !f.ganador_nombre) continue;
      const key = f.ganador_rut || f.ganador_nombre;
      const prev = mapa.get(key) || { nombre: f.ganador_nombre, rut: f.ganador_rut, veces: 0, monto: 0, es_emt: f.ganador_es_emt };
      prev.veces += 1;
      prev.monto += Number(f.monto_ganador) || 0;
      mapa.set(key, prev);
    }
    return [...mapa.values()].sort((a, b) => b.veces - a.veces || b.monto - a.monto).slice(0, 8);
  }, [filas]);

  // Perdidas más estrechas (donde estuvimos más cerca de ganar).
  const perdidasEstrechas = useMemo(
    () =>
      filas
        .filter((f) => f.clase === "perdida" && Number.isFinite(f.brecha) && f.brecha > 0)
        .sort((a, b) => a.brecha - b.brecha)
        .slice(0, 8),
    [filas],
  );

  const filtradas = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return filas.filter((f) => {
      if (filtroClase && f.clase !== filtroClase) return false;
      if (filtroTipo && f.tipo !== filtroTipo) return false;
      if (!q) return true;
      return [f.codigo_mp, f.organismo, f.ganador_nombre, f.interna?.nombre, f.interna?.nombre_entidad]
        .map((s) => String(s || "").toLowerCase())
        .some((s) => s.includes(q));
    });
  }, [filas, busqueda, filtroClase, filtroTipo]);

  const sinConfig = estadoApi && !estadoApi.ticket_configurado;

  return (
    <div className="page">
      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}

      <div className="page-header">
        <div>
          <h1 className="page-title" style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Scale size={22} style={{ color: "var(--primary)" }} />
            Análisis Mercado Público
          </h1>
          <p className="page-subtitle">
            Nuestras postulaciones vs la oferta ganadora · datos oficiales de las APIs de Mercado Público
            {estadoApi?.rut_empresa ? ` · RUT ${estadoApi.rut_empresa}` : ""}
          </p>
        </div>
        <div className="page-actions" style={{ gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--text-muted)", letterSpacing: ".03em", marginBottom: 3 }}>
              PERÍODO A CONSULTAR (POSTULACIONES CREADAS)
            </div>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input type="date" className="input" style={{ height: 38, width: 150 }} value={syncDesde}
                onChange={(e) => setSyncDesde(e.target.value)} title="Desde (vacío = últimos 8 meses)" />
              <span style={{ color: "var(--text-muted)", fontSize: 12 }}>→</span>
              <input type="date" className="input" style={{ height: 38, width: 150 }} value={syncHasta}
                onChange={(e) => setSyncHasta(e.target.value)} title="Hasta (vacío = hoy)" />
            </div>
          </div>
          <button className="btn btn-primary" onClick={sincronizar} disabled={sincronizando || sinConfig}
            style={{ display: "inline-flex", alignItems: "center", gap: 7, height: 38, minWidth: 250, justifyContent: "center" }}>
            <RefreshCw size={14} className={sincronizando ? "girando" : undefined} />
            {sincronizando
              ? progresoSync?.restantes != null
                ? `${progresoSync.hechas} consultados · ${progresoSync.restantes} restantes`
                : "Sincronizando…"
              : "Sincronizar con Mercado Público"}
          </button>
        </div>
      </div>

      {sinConfig && (
        <div style={{ border: "1px solid #fcd34d", background: "#fffbeb", borderRadius: 12, padding: "14px 18px", marginBottom: 16, display: "flex", gap: 12, alignItems: "flex-start" }}>
          <KeyRound size={18} style={{ color: "#b45309", flexShrink: 0, marginTop: 2 }} />
          <div style={{ fontSize: 13.5, lineHeight: 1.6 }}>
            <b>Falta el ticket de la API de Mercado Público.</b><br />
            Solicítalo gratis en <a href="https://www.chilecompra.cl/api/" target="_blank" rel="noreferrer" style={{ color: "var(--primary-dark)" }}>chilecompra.cl/api</a> (botón
            "Pide tu ticket", con Clave Única — llega por correo). Luego agrégalo al backend como <code>MP_API_TICKET</code> junto
            con <code>MP_RUT_EMPRESA</code> (el RUT con que postulamos) y reinicia el backend.
            {estadoApi?.ticket_configurado && !estadoApi?.rut_configurado && " Falta además MP_RUT_EMPRESA para detectar nuestras ofertas."}
          </div>
        </div>
      )}

      {/* ── KPIs ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12, marginBottom: 16 }}>
        <Kpi icon={<Target size={17} />} tono="#1e9295" fondo="#e6f6f6" label="Procesos analizados" valor={stats.total}
          sub={`${stats.enCurso} en curso`} />
        <Kpi icon={<Trophy size={17} />} tono="#15803d" fondo="#dcfce7" label="Ganadas" valor={stats.ganadas}
          sub={fmt$(stats.montoGanado) + " adjudicado"} />
        <Kpi icon={<TrendingDown size={17} />} tono="#b91c1c" fondo="#fee2e2" label="Perdidas" valor={stats.perdidas}
          sub={fmt$(stats.oportunidadPerdida) + " se llevó la competencia"} />
        <Kpi icon={<Percent size={17} />} tono="#6d28d9" fondo="#ede9fe" label="Tasa de éxito"
          valor={stats.tasa == null ? "—" : `${stats.tasa.toFixed(0)}%`} sub="sobre procesos decididos" />
        <Kpi icon={<Scale size={17} />} tono="#b45309" fondo="#fef3c7" label="Brecha prom. al perder"
          valor={stats.brechaProm == null ? "—" : `+${stats.brechaProm.toFixed(1)}%`}
          sub={`${stats.casiGanadas} perdida${stats.casiGanadas === 1 ? "" : "s"} por <5%`} />
      </div>

      {/* ── Gráficos ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 12, marginBottom: 16 }}>
        <Panel titulo="Resultado global" extra={
          <button className="btn btn-ghost" style={{ fontSize: 11.5, padding: "3px 10px" }} onClick={() => setDonaPorMonto((v) => !v)}>
            {donaPorMonto ? "por monto $" : "por cantidad"}
          </button>
        }>
          <DonaResultados filas={filas} porMonto={donaPorMonto} />
        </Panel>

        <Panel titulo="Perdidas más estrechas" sub="qué tan cerca estuvimos (brecha vs ganador)">
          {perdidasEstrechas.length === 0 ? (
            <Vacio texto="Sin perdidas con brecha calculable aún." />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              {perdidasEstrechas.map((f) => (
                <BarraH key={f.id}
                  etiqueta={f.codigo_mp}
                  detalle={`${fmt$(f.monto_nuestro)} vs ${fmt$(f.monto_ganador)}`}
                  valor={Math.min(f.brecha, 30)} max={30}
                  texto={`+${f.brecha.toFixed(1)}%`}
                  color={f.brecha <= 5 ? "#f59e0b" : "#ef4444"}
                  onClick={() => { setBusqueda(f.codigo_mp); setFiltroClase(""); }}
                />
              ))}
            </div>
          )}
        </Panel>

        <Panel titulo="Quién nos gana" sub="competidores con más victorias sobre nosotros">
          {competidores.length === 0 ? (
            <Vacio texto="Aún no hay perdidas con ganador identificado." />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              {competidores.map((c) => (
                <BarraH key={c.rut || c.nombre}
                  etiqueta={c.nombre + (c.es_emt ? " · EMT" : "")}
                  detalle={fmt$(c.monto)}
                  valor={c.veces} max={competidores[0].veces}
                  texto={`${c.veces}×`}
                  color="#6d28d9"
                  onClick={() => { setBusqueda(c.nombre); setFiltroClase(""); }}
                />
              ))}
            </div>
          )}
        </Panel>
      </div>

      {/* ── Filtros ── */}
      <div className="filter-bar">
        <div className="filter-field" style={{ flex: 1, minWidth: 220 }}>
          <label className="filter-label">Buscar</label>
          <div style={{ position: "relative" }}>
            <Search size={14} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)" }} />
            <input className="input" style={{ paddingLeft: 30 }} placeholder="Código, organismo, competidor…"
              value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
          </div>
        </div>
        <div className="filter-field">
          <label className="filter-label">Resultado</label>
          <select className="input" value={filtroClase} onChange={(e) => setFiltroClase(e.target.value)} style={{ minWidth: 160 }}>
            <option value="">Todos</option>
            {Object.entries(CLASES).map(([k, c]) => <option key={k} value={k}>{c.label}</option>)}
          </select>
        </div>
        <div className="filter-field">
          <label className="filter-label">Tipo</label>
          <select className="input" value={filtroTipo} onChange={(e) => setFiltroTipo(e.target.value)} style={{ minWidth: 150 }}>
            <option value="">Todos</option>
            <option value="compra_agil">Compra Ágil</option>
            <option value="licitacion">Licitación</option>
          </select>
        </div>
      </div>

      {/* ── Tabla ── */}
      <div style={{ border: "1px solid var(--border)", borderRadius: 10, overflowX: "auto", background: "var(--surface)", marginTop: 12 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, whiteSpace: "nowrap" }}>
          <thead>
            <tr style={{ background: "var(--bg)", color: "var(--text-muted)", textAlign: "left" }}>
              <th style={{ padding: "9px 12px", width: 26 }} />
              <th style={{ padding: "9px 12px" }}>Proceso</th>
              <th style={{ padding: "9px 12px" }}>Organismo</th>
              <th style={{ padding: "9px 12px" }}>Cierre</th>
              <th style={{ padding: "9px 12px", textAlign: "right" }}>Nuestra oferta</th>
              <th style={{ padding: "9px 12px", textAlign: "right" }}>Oferta ganadora</th>
              <th style={{ padding: "9px 12px", textAlign: "right" }}>Brecha</th>
              <th style={{ padding: "9px 12px" }}>Ganador</th>
              <th style={{ padding: "9px 12px" }}>Resultado</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9} style={{ padding: 26, textAlign: "center", color: "var(--text-muted)" }}>Cargando análisis…</td></tr>
            ) : filtradas.length === 0 ? (
              <tr><td colSpan={9} style={{ padding: 26, textAlign: "center", color: "var(--text-muted)" }}>
                {resultados.length === 0
                  ? "Sin datos todavía. Usa \"Sincronizar con Mercado Público\" para consultar tus postulaciones."
                  : "Sin resultados con los filtros actuales."}
              </td></tr>
            ) : (
              filtradas.map((f) => {
                const cl = CLASES[f.clase];
                const abierta = expandida === f.id;
                return (
                  <FilaProceso key={f.id} f={f} cl={cl} abierta={abierta}
                    onToggle={() => setExpandida(abierta ? null : f.id)} />
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <p style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 10, lineHeight: 1.5 }}>
        Compra Ágil: cotizaciones públicas desde el cierre del proceso (API v2). Licitaciones: la API solo publica la
        adjudicación (ganador por ítem), no las demás ofertas. Montos con IVA incluido. La sincronización avanza en
        tandas y la tabla se actualiza en vivo; los procesos ya consultados no se repiten hasta pasadas 6 horas
        (cuida la cuota diaria del ticket).
      </p>

      <style>{`.girando { animation: mp-spin 1s linear infinite; } @keyframes mp-spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

/* ── Fila expandible de la tabla ── */
function FilaProceso({ f, cl, abierta, onToggle }) {
  const det = f.detalle || {};
  const cotizaciones = det.cotizaciones || [];
  const comparacion = det.comparacion_items || [];
  const tieneDetalle = cotizaciones.length > 0 || comparacion.length > 0;

  return (
    <>
      <tr style={{ borderTop: "1px solid var(--border)", cursor: tieneDetalle ? "pointer" : "default", background: abierta ? "var(--bg)" : undefined }}
        onClick={tieneDetalle ? onToggle : undefined}>
        <td style={{ padding: "7px 4px 7px 12px", color: "var(--text-muted)" }}>
          {tieneDetalle ? (abierta ? <ChevronDown size={14} /> : <ChevronRight size={14} />) : null}
        </td>
        <td style={{ padding: "7px 12px" }}>
          <div style={{ fontWeight: 700 }}>{f.codigo_mp}</div>
          <div style={{ fontSize: 11.5, color: "var(--text-muted)", maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis" }}>
            {f.interna?.nombre || ""} · {f.tipo === "compra_agil" ? "Compra Ágil" : "Licitación"}
          </div>
        </td>
        <td style={{ padding: "7px 12px", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", fontSize: 12.5 }} title={f.organismo || ""}>
          {f.organismo || f.interna?.nombre_entidad || "—"}
        </td>
        <td style={{ padding: "7px 12px", fontSize: 12.5, color: "var(--text-muted)" }}>{fmtFecha(f.fecha_cierre)}</td>
        <td style={{ padding: "7px 12px", textAlign: "right", fontWeight: 600 }}>{fmt$(f.monto_nuestro)}</td>
        <td style={{ padding: "7px 12px", textAlign: "right", fontWeight: 600 }}>{fmt$(f.monto_ganador)}</td>
        <td style={{ padding: "7px 12px", textAlign: "right", fontWeight: 700, color: f.brecha == null ? "var(--text-muted)" : f.brecha > 0 ? "#b91c1c" : "#15803d" }}>
          {f.clase === "ganada" ? "—" : fmtPct(f.brecha)}
        </td>
        <td style={{ padding: "7px 12px", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", fontSize: 12.5 }} title={f.ganador_nombre || ""}>
          {f.ganamos === true
            ? <span style={{ display: "inline-flex", alignItems: "center", gap: 5, color: "#15803d", fontWeight: 700 }}><Crown size={13} /> Nosotros</span>
            : f.ganador_nombre
              ? <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><Building2 size={12} style={{ color: "var(--text-muted)" }} />{f.ganador_nombre}{f.ganador_es_emt ? <em style={{ fontSize: 10.5, color: "#6d28d9", fontStyle: "normal", fontWeight: 700 }}>EMT</em> : null}</span>
              : "—"}
        </td>
        <td style={{ padding: "7px 12px" }}>
          <span style={{ fontSize: 11.5, fontWeight: 700, padding: "2px 9px", borderRadius: 999, color: cl.color, background: cl.bg }}>
            {cl.label}
          </span>
        </td>
      </tr>

      {abierta && (
        <tr style={{ background: "var(--bg)" }}>
          <td colSpan={9} style={{ padding: "6px 16px 16px 40px" }}>
            <DetalleProceso f={f} />
          </td>
        </tr>
      )}
    </>
  );
}

function DetalleProceso({ f }) {
  const det = f.detalle || {};
  const cotizaciones = [...(det.cotizaciones || [])].sort((a, b) => (a.monto_total ?? Infinity) - (b.monto_total ?? Infinity));
  const comparacion = det.comparacion_items || [];
  const nuestra = cotizaciones.find((c) => c.nuestra);

  // Diagnóstico de por qué se perdió (solo cuando hay datos de ambas ofertas).
  const razones = [];
  if (f.clase === "perdida" && nuestra) {
    const gan = cotizaciones.find((c) => c.rut === f.ganador_rut);
    if (nuestra.inadmisible) razones.push(`Nuestra cotización fue declarada inadmisible${nuestra.justificacion_inadmisibilidad ? `: ${nuestra.justificacion_inadmisibilidad}` : "."}`);
    if (gan && nuestra.valor_neto != null && gan.valor_neto != null && nuestra.valor_neto > gan.valor_neto) {
      razones.push(`Nuestro neto fue ${(((nuestra.valor_neto - gan.valor_neto) / gan.valor_neto) * 100).toFixed(1)}% más alto (${fmt$(nuestra.valor_neto)} vs ${fmt$(gan.valor_neto)}).`);
    }
    if (gan && (nuestra.monto_despacho || 0) > (gan.monto_despacho || 0)) {
      razones.push(`Nuestro despacho fue más caro: ${fmt$(nuestra.monto_despacho || 0)} vs ${fmt$(gan.monto_despacho || 0)} del ganador.`);
    }
    if (razones.length === 0 && f.brecha != null && f.brecha > 0) {
      razones.push(`Perdimos por precio: nuestra oferta total fue ${f.brecha.toFixed(1)}% más alta que la ganadora.`);
    }
    if (razones.length === 0) razones.push("El comprador seleccionó otra oferta (revisa el motivo de selección en la ficha del proceso).");
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {razones.length > 0 && (
        <div style={{ border: "1px solid #fecaca", background: "#fef2f2", borderRadius: 10, padding: "10px 14px", fontSize: 12.5, lineHeight: 1.6 }}>
          <b style={{ color: "#b91c1c", display: "inline-flex", alignItems: "center", gap: 6 }}><AlertTriangle size={13} /> Por qué perdimos</b>
          <ul style={{ margin: "4px 0 0 18px", padding: 0 }}>
            {razones.map((r, i) => <li key={i}>{r}</li>)}
          </ul>
        </div>
      )}

      {cotizaciones.length > 0 && (
        <div>
          <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 6 }}>Cotizaciones del proceso ({cotizaciones.length})</div>
          <div style={{ border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, background: "var(--surface)" }}>
              <thead>
                <tr style={{ background: "var(--bg)", color: "var(--text-muted)", textAlign: "left" }}>
                  <th style={{ padding: "6px 10px" }}>#</th>
                  <th style={{ padding: "6px 10px" }}>Proveedor</th>
                  <th style={{ padding: "6px 10px", textAlign: "right" }}>Neto</th>
                  <th style={{ padding: "6px 10px", textAlign: "right" }}>Despacho</th>
                  <th style={{ padding: "6px 10px", textAlign: "right" }}>Total</th>
                  <th style={{ padding: "6px 10px" }}>Estado</th>
                </tr>
              </thead>
              <tbody>
                {cotizaciones.map((c, i) => {
                  const esGanadora = c.rut && c.rut === f.ganador_rut;
                  return (
                    <tr key={i} style={{
                      borderTop: "1px solid var(--border)",
                      background: c.nuestra ? "#e6f6f6" : esGanadora ? "#f0fdf4" : undefined,
                      fontWeight: c.nuestra || esGanadora ? 600 : 400,
                    }}>
                      <td style={{ padding: "5px 10px", color: "var(--text-muted)" }}>{i + 1}</td>
                      <td style={{ padding: "5px 10px" }}>
                        {c.nombre || c.rut || "—"}
                        {c.nuestra && <span style={{ marginLeft: 6, fontSize: 10.5, fontWeight: 800, color: "#1e9295" }}>NOSOTROS</span>}
                        {esGanadora && <Crown size={12} style={{ marginLeft: 6, color: "#15803d", verticalAlign: -2 }} />}
                        {c.es_emt && <em style={{ marginLeft: 6, fontSize: 10, color: "#6d28d9", fontStyle: "normal", fontWeight: 700 }}>EMT</em>}
                      </td>
                      <td style={{ padding: "5px 10px", textAlign: "right" }}>{fmt$(c.valor_neto)}</td>
                      <td style={{ padding: "5px 10px", textAlign: "right" }}>{fmt$(c.monto_despacho)}</td>
                      <td style={{ padding: "5px 10px", textAlign: "right", fontWeight: 700 }}>{fmt$(c.monto_total)}</td>
                      <td style={{ padding: "5px 10px", fontSize: 11.5, color: c.inadmisible ? "#b91c1c" : "var(--text-muted)" }}>
                        {c.inadmisible ? "Inadmisible" : c.estado_por_comprador || "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {comparacion.length > 0 && (
        <div>
          <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 6 }}>
            {f.tipo === "compra_agil" ? "Producto a producto: nosotros vs ganador" : "Adjudicación por ítem"}
          </div>
          <div style={{ border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, background: "var(--surface)" }}>
              <thead>
                <tr style={{ background: "var(--bg)", color: "var(--text-muted)", textAlign: "left" }}>
                  <th style={{ padding: "6px 10px" }}>Producto</th>
                  {f.tipo === "compra_agil" && <th style={{ padding: "6px 10px", textAlign: "right" }}>Nuestro precio</th>}
                  <th style={{ padding: "6px 10px", textAlign: "right" }}>Precio ganador</th>
                  {f.tipo === "compra_agil"
                    ? <th style={{ padding: "6px 10px", textAlign: "right" }}>Diferencia</th>
                    : <th style={{ padding: "6px 10px" }}>Adjudicado a</th>}
                </tr>
              </thead>
              <tbody>
                {comparacion.map((it, i) => (
                  <tr key={i} style={{ borderTop: "1px solid var(--border)" }}>
                    <td style={{ padding: "5px 10px", maxWidth: 340, overflow: "hidden", textOverflow: "ellipsis" }} title={it.nombre || ""}>
                      {it.nombre || it.codigo_producto || "—"}
                    </td>
                    {f.tipo === "compra_agil" && <td style={{ padding: "5px 10px", textAlign: "right" }}>{fmt$(it.nuestro_precio)}</td>}
                    <td style={{ padding: "5px 10px", textAlign: "right" }}>{fmt$(it.precio_ganador)}</td>
                    {f.tipo === "compra_agil" ? (
                      <td style={{ padding: "5px 10px", textAlign: "right", fontWeight: 700, color: it.diferencia > 0 ? "#b91c1c" : it.diferencia < 0 ? "#15803d" : "var(--text-muted)" }}>
                        {it.diferencia == null ? "—" : `${it.diferencia > 0 ? "+" : ""}${fmt$(it.diferencia)}`}
                      </td>
                    ) : (
                      <td style={{ padding: "5px 10px", fontSize: 12 }}>
                        {it.ganado_por_nosotros
                          ? <span style={{ color: "#15803d", fontWeight: 700 }}>Nosotros</span>
                          : (it.ganador_nombre || it.ganador_rut || "—")}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Componentes de visualización ── */
function Kpi({ icon, tono, fondo, label, valor, sub }) {
  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 12, background: "var(--surface)", padding: "13px 15px", display: "flex", gap: 12, alignItems: "center" }}>
      <div style={{ width: 38, height: 38, borderRadius: 10, background: fondo, color: tono, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        {icon}
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 11.5, color: "var(--text-muted)", fontWeight: 600 }}>{label}</div>
        <div style={{ fontSize: 20, fontWeight: 800, lineHeight: 1.15 }}>{valor}</div>
        {sub && <div style={{ fontSize: 11, color: "var(--text-muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{sub}</div>}
      </div>
    </div>
  );
}

function Panel({ titulo, sub, extra, children }) {
  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 12, background: "var(--surface)", padding: "14px 16px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10, gap: 8 }}>
        <div>
          <div style={{ fontSize: 13.5, fontWeight: 700 }}>{titulo}</div>
          {sub && <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>{sub}</div>}
        </div>
        {extra}
      </div>
      {children}
    </div>
  );
}

function Vacio({ texto }) {
  return <div style={{ padding: "26px 0", textAlign: "center", color: "var(--text-muted)", fontSize: 12.5 }}>{texto}</div>;
}

// Dona SVG: ganadas / perdidas / en curso / otras.
function DonaResultados({ filas, porMonto }) {
  const partes = [
    { clase: "ganada", color: "#15803d" },
    { clase: "perdida", color: "#ef4444" },
    { clase: "en_curso", color: "#f59e0b" },
    { clase: "sin_efecto", color: "#94a3b8" },
    { clase: "sin_participar", color: "#8b5cf6" },
  ].map((p) => {
    const del = filas.filter((f) => f.clase === p.clase);
    const valor = porMonto
      ? del.reduce((s, f) => s + (Number(f.clase === "perdida" ? f.monto_ganador : f.monto_nuestro) || 0), 0)
      : del.length;
    return { ...p, label: CLASES[p.clase].label, valor };
  }).filter((p) => p.valor > 0);

  const total = partes.reduce((s, p) => s + p.valor, 0);
  if (!total) return <Vacio texto="Sin procesos clasificados todavía." />;

  const R = 54, C = 2 * Math.PI * R;
  let offset = 0;
  const ganadas = filas.filter((f) => f.clase === "ganada").length;
  const decididas = ganadas + filas.filter((f) => f.clase === "perdida").length;
  const tasa = decididas ? Math.round((ganadas / decididas) * 100) : null;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
      <svg viewBox="0 0 140 140" style={{ width: 140, height: 140, flexShrink: 0 }}>
        <circle cx="70" cy="70" r={R} fill="none" stroke="var(--border)" strokeWidth="16" />
        {partes.map((p) => {
          const frac = p.valor / total;
          const el = (
            <circle key={p.clase} cx="70" cy="70" r={R} fill="none" stroke={p.color} strokeWidth="16"
              strokeDasharray={`${frac * C} ${C}`} strokeDashoffset={-offset * C}
              transform="rotate(-90 70 70)" strokeLinecap="butt" />
          );
          offset += frac;
          return el;
        })}
        <text x="70" y="66" textAnchor="middle" style={{ fontSize: 22, fontWeight: 800, fill: "var(--text)" }}>
          {tasa == null ? "—" : `${tasa}%`}
        </text>
        <text x="70" y="84" textAnchor="middle" style={{ fontSize: 9.5, fill: "var(--text-muted)", fontWeight: 600 }}>
          tasa de éxito
        </text>
      </svg>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 150 }}>
        {partes.map((p) => (
          <div key={p.clase} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5 }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: p.color, flexShrink: 0 }} />
            <span style={{ flex: 1 }}>{p.label}</span>
            <b>{porMonto ? fmt$(p.valor) : p.valor}</b>
            <span style={{ color: "var(--text-muted)", fontSize: 11.5, width: 38, textAlign: "right" }}>
              {((p.valor / total) * 100).toFixed(0)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Barra horizontal con etiqueta, valor y click para filtrar.
function BarraH({ etiqueta, detalle, valor, max, texto, color, onClick }) {
  const pct = max > 0 ? Math.max(6, (valor / max) * 100) : 0;
  return (
    <div onClick={onClick} style={{ cursor: onClick ? "pointer" : "default" }} title={detalle}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, marginBottom: 2 }}>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "70%" }}>{etiqueta}</span>
        <b style={{ color }}>{texto}</b>
      </div>
      <div style={{ height: 8, borderRadius: 999, background: "var(--bg)", overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", borderRadius: 999, background: `linear-gradient(90deg, ${color}99, ${color})` }} />
      </div>
    </div>
  );
}
