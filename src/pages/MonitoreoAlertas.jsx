import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { RefreshCw } from "lucide-react";
import { api } from "../lib/api";
import DropdownSelect from "../components/ui/DropdownSelect";
import BotonLimpiarFiltros from "../components/BotonLimpiarFiltros";

/* ── Administración → Monitoreo de alertas (2026-10-07) ──────────────────────
   Pedido de Ariel: "generar un módulo para monitorear las alertas que recibe
   cada vendedor y el cumplimiento de cada alerta".
   El servidor (/monitoreo-alertas) evalúa cada alerta de la campana contra el
   dato que la resuelve (postulada, resultado registrado, factura pagada o
   gestionada, correo enviado, aprobación resuelta…). Aquí: KPIs del período,
   tabla por persona y por tipo (un clic filtra el detalle) y el detalle de
   cada alerta con su estado. Las informativas solo cuentan si se leyeron. */

const TIPOS = {
  cierre_proximo: "Cierre de cotización próximo",
  resultados_publicados: "Resultados publicados",
  aprobacion_peso: "Aprobación por peso",
  equivalencias_pendientes: "Equivalencias sin alternativa",
  cobranza_accion: "Acción de cobranza",
  factoring_por_vencer: "Factoring por vencer",
  factoring_vencido: "Factoring vencido",
  factura_vencida: "Factura vencida",
  oc_agradecimiento: "Correo de agradecimiento OC",
  guia_despacho_enviar: "Enviar guía de despacho",
  factura_enviar: "Enviar factura o boleta",
  info_despacho_agradecimiento: "Correo de despacho",
  mp_estado_auto: "Cambio de estado en MP",
  mp_adjudicada: "Adjudicada en MP",
  cotizacion_aprobada: "Cotización aprobada",
  portal_upload: "Documento subido por el cliente",
  stock_solicitud_cotizacion: "Solicitud de cotización (portal)",
  stock_cotizacion_mensaje: "Mensaje del cliente (portal)",
  stock_critico: "Stock crítico de cliente",
  stock_bajo: "Stock bajo de cliente",
  pedido_portal_aprobado: "Pedido del portal aprobado",
  pedido_portal_pagado: "Pedido del portal pagado",
  pedido_portal_sos: "SOS del portal",
  chat_invitacion: "Invitación a sala de chat",
  chat_sala_eliminada: "Sala de chat eliminada",
  monitor_alerta: "Alerta del sistema",
};
const etiquetaTipo = (t) => TIPOS[t] || t;
const ESTADOS = {
  cumplida: { texto: "Cumplida", color: "#15803d", bg: "#dcfce7" },
  pendiente: { texto: "Pendiente", color: "#b45309", bg: "#fef3c7" },
  incumplida: { texto: "Incumplida", color: "#b91c1c", bg: "#fee2e2" },
  informativa: { texto: "Informativa", color: "#475569", bg: "#f1f5f9" },
};
const PERIODOS = [
  { value: "7", label: "Últimos 7 días" },
  { value: "30", label: "Últimos 30 días" },
  { value: "90", label: "Últimos 90 días" },
  { value: "180", label: "Últimos 6 meses" },
];
const POR_PAGINA = 25;
const pct = (n) => (n == null ? "—" : `${Number(n).toLocaleString("es-CL", { maximumFractionDigits: 1 })} %`);
const horas = (h) => (h == null ? "—" : h < 24 ? `${Math.round(h)} h` : `${Math.round(h / 24)} d`);
const fechaHora = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, "0")}-${String(d.getMonth() + 1).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};
const colorPct = (p) => (p == null ? "var(--text-muted)" : p >= 80 ? "#15803d" : p >= 50 ? "#b45309" : "#b91c1c");
const pastilla = (e) => ({ display: "inline-block", fontSize: 11, fontWeight: 700, padding: "1px 8px", borderRadius: 999, whiteSpace: "nowrap", color: ESTADOS[e]?.color, background: ESTADOS[e]?.bg });

function Barra({ valor }) {
  if (valor == null) return <span style={{ color: "var(--text-muted)" }}>—</span>;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, minWidth: 110 }}>
      <span style={{ flex: 1, height: 6, background: "var(--bg)", borderRadius: 999, overflow: "hidden", minWidth: 50 }}>
        <span style={{ display: "block", width: `${Math.min(100, valor)}%`, height: "100%", background: colorPct(valor) }} />
      </span>
      <b style={{ color: colorPct(valor), fontSize: 12 }}>{pct(valor)}</b>
    </span>
  );
}

export default function MonitoreoAlertas() {
  const [periodo, setPeriodo] = useState("30");
  const [datos, setDatos] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState("");
  const [usuario, setUsuario] = useState("");
  const [tipo, setTipo] = useState("");
  const [estado, setEstado] = useState("");
  const [paginaDe, setPaginaDe] = useState({ clave: "", n: 1 });

  const cargar = useCallback(async () => {
    setCargando(true);
    setError("");
    try {
      const desde = new Date(Date.now() - Number(periodo) * 864e5).toISOString().slice(0, 10);
      setDatos(await api.get(`/monitoreo-alertas?desde=${desde}`));
    } catch (e) {
      setError(e?.message || "No se pudo cargar el monitoreo de alertas.");
    } finally {
      setCargando(false);
    }
  }, [periodo]);
  useEffect(() => { cargar(); }, [cargar]);

  const alertas = useMemo(() => datos?.alertas || [], [datos]);
  const filtradas = useMemo(() => alertas.filter((a) =>
    (!usuario || a.email === usuario)
    && (!tipo || a.tipo === tipo)
    && (!estado || (estado === "sin_leer" ? !a.leida_at : estado === "accionables" ? a.estado !== "informativa" : a.estado === estado))), [alertas, usuario, tipo, estado]);
  const clave = JSON.stringify([usuario, tipo, estado, periodo]);
  const pagina = paginaDe.clave === clave ? paginaDe.n : 1;
  const paginas = Math.max(1, Math.ceil(filtradas.length / POR_PAGINA));
  const pag = Math.min(pagina, paginas);
  const visibles = filtradas.slice((pag - 1) * POR_PAGINA, pag * POR_PAGINA);
  const r = datos?.resumen;
  const hayFiltros = !!(usuario || tipo || estado);

  const opcionesUsuario = [{ value: "", label: "Todas las personas" }, ...(datos?.por_usuario || []).map((u) => ({ value: u.email, label: u.nombre || u.email, detalle: `${u.total} alertas` }))];
  const opcionesTipo = [{ value: "", label: "Todos los tipos" }, ...(datos?.por_tipo || []).map((t) => ({ value: t.tipo, label: etiquetaTipo(t.tipo), detalle: `${t.total} alertas` }))];

  return (
    <div className="page monitoreo-alertas">
      <div className="page-header" style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 className="page-title">Monitoreo de alertas</h1>
          <p className="page-subtitle">Las alertas que recibe cada persona en su campana y si se cumplieron: postular, registrar el resultado, cobrar, enviar el correo, aprobar…</p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <DropdownSelect value={periodo} onChange={setPeriodo} options={PERIODOS} minWidth={180} style={{ width: 190 }} />
          <button type="button" className="btn btn-secondary" onClick={cargar} disabled={cargando}>
            <RefreshCw size={14} className={cargando ? "spin" : ""} /> Actualizar
          </button>
        </div>
      </div>

      {error && <div style={{ border: "1px solid #fecaca", background: "#fef2f2", color: "#b91c1c", borderRadius: 10, padding: "10px 14px", fontSize: 13, marginBottom: 14 }}>{error}</div>}

      <div className="stats-row stats-5">
        <div className="stat-card" style={{ cursor: "pointer" }} onClick={() => setEstado("")} title="Ver todas">
          <div className="stat-label">Alertas</div>
          <div className="stat-value">{r ? r.total.toLocaleString("es-CL") : "…"}</div>
          <div className="stat-sub">{r ? `${r.sin_leer.toLocaleString("es-CL")} sin leer` : ""}</div>
        </div>
        <div className="stat-card" style={{ cursor: "pointer" }} onClick={() => setEstado("sin_leer")} title="Ver las sin leer">
          <div className="stat-label">Leídas</div>
          <div className="stat-value" style={{ color: colorPct(r?.pct_lectura) }}>{r ? pct(r.pct_lectura) : "…"}</div>
          <div className="stat-sub">{r?.mediana_horas_lectura != null ? `la mitad se lee en ${horas(r.mediana_horas_lectura)} o menos` : "tiempo de lectura"}</div>
        </div>
        <div className="stat-card" style={{ cursor: "pointer" }} onClick={() => setEstado("accionables")} title="Ver las que piden una acción">
          <div className="stat-label">Cumplimiento</div>
          <div className="stat-value" style={{ color: colorPct(r?.pct_cumplimiento) }}>{r ? pct(r.pct_cumplimiento) : "…"}</div>
          <div className="stat-sub">{r ? `${r.cumplidas.toLocaleString("es-CL")} de ${r.accionables.toLocaleString("es-CL")} que piden una acción` : ""}</div>
        </div>
        <div className="stat-card" style={{ cursor: "pointer" }} onClick={() => setEstado("pendiente")} title="Ver las pendientes">
          <div className="stat-label">Pendientes</div>
          <div className="stat-value" style={{ color: r?.pendientes ? "#b45309" : undefined }}>{r ? r.pendientes.toLocaleString("es-CL") : "…"}</div>
          <div className="stat-sub">aún se pueden cumplir</div>
        </div>
        <div className="stat-card" style={{ cursor: "pointer" }} onClick={() => setEstado("incumplida")} title="Ver las incumplidas">
          <div className="stat-label">Incumplidas</div>
          <div className="stat-value" style={{ color: r?.incumplidas ? "var(--danger)" : undefined }}>{r ? r.incumplidas.toLocaleString("es-CL") : "…"}</div>
          <div className="stat-sub">p. ej. cerró sin postular</div>
        </div>
      </div>

      <div className="surface" style={{ marginBottom: 16 }}>
        <div className="surface-header"><h3 className="surface-title">Por persona</h3></div>
        <div className="table-scroll">
          <table className="data-table tabla-compacta tabla-alertas-usuario" style={{ width: "100%", minWidth: 760 }}>
            <thead>
              <tr>
                <th>Persona</th>
                <th style={{ textAlign: "right" }}>Alertas</th>
                <th>Leídas</th>
                <th style={{ textAlign: "right" }}>Lee en</th>
                <th style={{ textAlign: "right" }}>Piden acción</th>
                <th style={{ textAlign: "right" }}>Pendientes</th>
                <th style={{ textAlign: "right" }}>Incumplidas</th>
                <th>Cumplimiento</th>
              </tr>
            </thead>
            <tbody>
              {!datos ? (
                <tr><td colSpan={8} style={{ textAlign: "center", padding: 24, color: "var(--text-muted)" }}>{cargando ? "Cargando…" : "—"}</td></tr>
              ) : (datos.por_usuario || []).length === 0 ? (
                <tr><td colSpan={8} style={{ textAlign: "center", padding: 24, color: "var(--text-muted)" }}>No hubo alertas en el período.</td></tr>
              ) : datos.por_usuario.map((u) => (
                <tr key={u.email} onClick={() => setUsuario(usuario === u.email ? "" : u.email)} style={{ cursor: "pointer", background: usuario === u.email ? "var(--primary-soft, #e8f7f7)" : undefined }} title="Filtrar el detalle por esta persona">
                  <td><div style={{ fontWeight: 600 }}>{u.nombre || u.email}</div><div style={{ fontSize: 11, color: "var(--text-muted)", overflowWrap: "anywhere" }}>{u.nombre ? u.email : ""}{u.rol ? `${u.nombre ? " · " : ""}${u.rol}` : ""}</div></td>
                  <td style={{ textAlign: "right", fontWeight: 600 }}>{u.total.toLocaleString("es-CL")}</td>
                  <td><Barra valor={u.pct_lectura} /></td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }} title="Mediana del tiempo entre que llega y se lee">{horas(u.mediana_horas_lectura)}</td>
                  <td style={{ textAlign: "right" }}>{u.accionables.toLocaleString("es-CL")}</td>
                  <td style={{ textAlign: "right", color: u.pendientes ? "#b45309" : undefined, fontWeight: u.pendientes ? 700 : 400 }}>{u.pendientes.toLocaleString("es-CL")}</td>
                  <td style={{ textAlign: "right", color: u.incumplidas ? "#b91c1c" : undefined, fontWeight: u.incumplidas ? 700 : 400 }}>{u.incumplidas.toLocaleString("es-CL")}</td>
                  <td><Barra valor={u.pct_cumplimiento} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="surface">
        <div className="surface-header" style={{ flexWrap: "wrap", gap: 8 }}>
          <h3 className="surface-title">Detalle ({filtradas.length.toLocaleString("es-CL")})</h3>
        </div>
        <div className="filter-bar" style={{ alignItems: "flex-end", padding: "0 12px 10px", marginBottom: 0, border: 0, boxShadow: "none" }}>
          <div className="filter-field" style={{ flex: "1 1 200px", minWidth: 0 }}>
            <label className="filter-label">Persona</label>
            <DropdownSelect value={usuario} onChange={setUsuario} options={opcionesUsuario} minWidth={240} />
          </div>
          <div className="filter-field" style={{ flex: "1 1 200px", minWidth: 0 }}>
            <label className="filter-label">Tipo</label>
            <DropdownSelect value={tipo} onChange={setTipo} options={opcionesTipo} minWidth={260} />
          </div>
          <div className="filter-field" style={{ flex: "1 1 160px", minWidth: 0 }}>
            <label className="filter-label">Estado</label>
            <DropdownSelect
              value={estado}
              onChange={setEstado}
              minWidth={200}
              options={[
                { value: "", label: "Todos" },
                { value: "accionables", label: "Piden una acción" },
                { value: "pendiente", label: "Pendientes", color: ESTADOS.pendiente.color },
                { value: "incumplida", label: "Incumplidas", color: ESTADOS.incumplida.color },
                { value: "cumplida", label: "Cumplidas", color: ESTADOS.cumplida.color },
                { value: "informativa", label: "Informativas" },
                { value: "sin_leer", label: "Sin leer" },
              ]}
            />
          </div>
          <BotonLimpiarFiltros hay={hayFiltros} onLimpiar={() => { setUsuario(""); setTipo(""); setEstado(""); }} />
        </div>
        <div className="table-scroll">
          <table className="data-table tabla-compacta tabla-texto tabla-alertas-detalle" style={{ width: "100%", minWidth: 860 }}>
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Persona</th>
                <th>Alerta</th>
                <th>Leída</th>
                <th>Cumplimiento</th>
              </tr>
            </thead>
            <tbody>
              {visibles.length === 0 ? (
                <tr><td colSpan={5} style={{ textAlign: "center", padding: 24, color: "var(--text-muted)" }}>{datos ? "Ninguna alerta calza con los filtros." : "—"}</td></tr>
              ) : visibles.map((a) => (
                <tr key={a.id}>
                  <td style={{ whiteSpace: "nowrap", fontSize: 12.5 }}>{fechaHora(a.creado_at)}</td>
                  <td style={{ fontSize: 12.5 }}>{a.nombre || a.email}</td>
                  <td>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)" }}>{etiquetaTipo(a.tipo)}</div>
                    <div style={{ fontSize: 12.5 }}>{a.mensaje}</div>
                    {a.licitacion_id && <Link to={`/detalle/${a.licitacion_id}`} className="table-link" style={{ fontSize: 12 }}>#{a.licitacion_id}{a.cliente ? ` · ${a.cliente}` : ""}</Link>}
                  </td>
                  <td style={{ whiteSpace: "nowrap", fontSize: 12 }}>{a.leida_at ? `Sí · ${horas(a.horas_lectura)}` : <span style={{ color: "#b45309", fontWeight: 600 }}>No</span>}</td>
                  <td>
                    <span style={pastilla(a.estado)}>{ESTADOS[a.estado]?.texto || a.estado}</span>
                    {a.detalle && <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 2 }}>{a.detalle}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {filtradas.length > POR_PAGINA && (
          <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 8, padding: "8px 12px", fontSize: 12.5, flexWrap: "wrap" }}>
            <span style={{ color: "var(--text-muted)" }}>Página {pag} de {paginas}</span>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setPaginaDe({ clave, n: pag - 1 })} disabled={pag <= 1}>← Anterior</button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setPaginaDe({ clave, n: pag + 1 })} disabled={pag >= paginas}>Siguiente →</button>
          </div>
        )}
        {datos?.truncadas && <div style={{ fontSize: 12, color: "var(--text-muted)", padding: "0 12px 10px" }}>Se muestran las 5.000 más recientes: acorta el período para ver el resto.</div>}
      </div>
    </div>
  );
}
