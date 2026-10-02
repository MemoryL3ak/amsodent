import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ChevronLeft, ChevronRight, ExternalLink, FileCheck, Info, RefreshCw } from "lucide-react";
import { api } from "../lib/api";
import Toast from "../components/Toast";
import BotonLimpiarFiltros from "../components/BotonLimpiarFiltros";
import EmitirFacturaBsale from "../components/EmitirFacturaBsale";

/* ── Facturación (2026-10-02) ────────────────────────────────────────────────
   Sección para emitir en Bsale la factura de una guía de despacho.
   · "Por facturar": las guías de cotizaciones adjudicadas que todavía no
     tienen factura, las más antiguas primero. El botón abre el borrador
     (el mismo de Trazabilidad), que es donde se revisa contra Bsale y donde
     están los dos botones: Simular y Emitir factura.
   · "Emitidas": lo que se ha emitido desde el sistema, y los intentos que no
     resultaron, con quién y cuándo.
   Quién puede usarla lo decide el backend (administración y contabilidad). */

const POR_PAGINA = 25;
const clp = (n) => (n == null ? "—" : `$${Math.round(Number(n) || 0).toLocaleString("es-CL")}`);
const fechaCL = (iso) => {
  if (!iso) return "—";
  const [y, m, d] = String(iso).slice(0, 10).split("-");
  return y && m && d ? `${d}-${m}-${y}` : "—";
};
const sinTildes = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// Semáforo de cuánto lleva la guía sin factura.
function tonoDias(dias) {
  if (dias == null) return { color: "#6b7280", bg: "#f3f4f6", texto: "Sin fecha" };
  const texto = dias === 0 ? "Hoy" : dias === 1 ? "1 día" : `${dias} días`;
  if (dias > 7) return { color: "#b91c1c", bg: "#fee2e2", texto };
  if (dias > 2) return { color: "#b45309", bg: "#fef3c7", texto };
  return { color: "#15803d", bg: "#dcfce7", texto };
}

const ESTADOS = {
  emitida: { texto: "Emitida", color: "#15803d", bg: "#dcfce7" },
  error: { texto: "Rechazada", color: "#b91c1c", bg: "#fee2e2" },
  incierta: { texto: "Sin confirmar", color: "#b45309", bg: "#fef3c7" },
  enviando: { texto: "En curso", color: "#1d4ed8", bg: "#dbeafe" },
};

const pastilla = (t) => ({
  display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 9px", borderRadius: 999,
  fontSize: 11, fontWeight: 700, whiteSpace: "nowrap", color: t.color, background: t.bg,
});

function Paginacion({ pagina, total, porPagina, onCambiar, nombre }) {
  const paginas = Math.max(1, Math.ceil(total / porPagina));
  if (total === 0) return null;
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 10, flexWrap: "wrap", gap: 8 }}>
      <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
        Mostrando {(pagina - 1) * porPagina + 1}–{Math.min(pagina * porPagina, total)} de {total} {nombre}
      </span>
      {paginas > 1 && (
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <button type="button" className="btn btn-secondary btn-sm" disabled={pagina <= 1} onClick={() => onCambiar(pagina - 1)} title="Página anterior">
            <ChevronLeft size={14} />
          </button>
          <span style={{ fontSize: 12.5, fontWeight: 700, minWidth: 60, textAlign: "center" }}>{pagina} / {paginas}</span>
          <button type="button" className="btn btn-secondary btn-sm" disabled={pagina >= paginas} onClick={() => onCambiar(pagina + 1)} title="Página siguiente">
            <ChevronRight size={14} />
          </button>
        </div>
      )}
    </div>
  );
}

export default function Facturacion() {
  const [estado, setEstado] = useState(null);
  const [pendientes, setPendientes] = useState([]);
  const [emitidas, setEmitidas] = useState({ registro_listo: true, filas: [] });
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [toast, setToast] = useState(null);
  const [pestana, setPestana] = useState("pendientes");
  const [buscar, setBuscar] = useState("");
  const [pagina, setPagina] = useState(1);
  const [emitir, setEmitir] = useState(null); // { licId, guiaId, guiaIds? } | null

  const cargar = useCallback(async () => {
    setCargando(true);
    setError("");
    try {
      const e = await api.get("/bsale/facturas/estado");
      setEstado(e);
      if (!e?.puede) return;
      const [p, h] = await Promise.all([api.get("/bsale/facturas/pendientes"), api.get("/bsale/facturas/emitidas")]);
      setPendientes(p?.filas || []);
      setEmitidas({ registro_listo: h?.registro_listo !== false, filas: h?.filas || [] });
    } catch (e) {
      setError(e?.message || "No se pudo cargar la facturación.");
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  const texto = sinTildes(buscar.trim());
  const pendientesFiltradas = useMemo(
    () => (!texto ? pendientes : pendientes.filter((f) => sinTildes(`${f.cliente} ${f.rut} ${f.codigo} #${f.licitacion_id} ${f.oc_numero} ${f.guia_numero}`).includes(texto))),
    [pendientes, texto],
  );
  const emitidasFiltradas = useMemo(
    () => (!texto ? emitidas.filas : emitidas.filas.filter((f) => sinTildes(`${f.cliente} ${f.codigo} #${f.licitacion_id} ${f.numero} ${f.guias.join(" ")} ${f.usuario}`).includes(texto))),
    [emitidas, texto],
  );
  const lista = pestana === "pendientes" ? pendientesFiltradas : emitidasFiltradas;
  const paginas = Math.max(1, Math.ceil(lista.length / POR_PAGINA));
  const paginaActual = Math.min(pagina, paginas);
  const visibles = lista.slice((paginaActual - 1) * POR_PAGINA, paginaActual * POR_PAGINA);

  const kpis = useMemo(() => {
    const mes = new Date().toISOString().slice(0, 7);
    const delMes = emitidas.filas.filter((f) => f.estado === "emitida" && String(f.fecha || "").slice(0, 7) === mes);
    return {
      porFacturar: pendientes.length,
      atrasadas: pendientes.filter((f) => (f.dias ?? 0) > 7).length,
      emitidasMes: delMes.length,
      totalMes: delMes.reduce((a, f) => a + (Number(f.total) || 0), 0),
      conProblema: emitidas.filas.filter((f) => f.estado === "error" || f.estado === "incierta").length,
    };
  }, [pendientes, emitidas]);

  const cambiarPestana = (p) => { setPestana(p); setPagina(1); };

  if (!cargando && estado && !estado.puede) {
    return (
      <div className="page">
        <div className="page-header"><h1 className="page-title">Facturación</h1></div>
        <div className="surface">
          <div className="surface-body" style={{ color: estado.configurada ? "var(--danger)" : "var(--text-muted)" }}>
            {estado.configurada
              ? "Acceso restringido: emitir facturas es para administración, contabilidad y jefatura de ventas especial."
              : "La integración con Bsale no está configurada en el servidor (falta el token)."}
          </div>
        </div>
      </div>
    );
  }

  // La emisión real se puede apagar en el servidor (BSALE_EMISION=off).
  const apagada = estado && estado.modo !== "activa";

  return (
    <div className="page">
      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}
      {emitir && (
        <EmitirFacturaBsale
          licitacionId={emitir.licId}
          guiaDocId={emitir.guiaId}
          guiaDocIds={emitir.guiaIds}
          onCerrar={() => setEmitir(null)}
          onEmitida={(r) => {
            setToast({ type: "success", message: `Factura ${r.numero} emitida en Bsale${r.registrada ? " y registrada en la cotización." : "."}` });
            cargar();
          }}
        />
      )}

      <div className="page-header" style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 className="page-title">Facturación</h1>
          <p className="page-subtitle">Emite en Bsale la factura de cada guía de despacho. Queda registrada en su cotización.</p>
        </div>
        <button type="button" className="btn btn-secondary" onClick={cargar} disabled={cargando}>
          <RefreshCw size={14} className={cargando ? "spin" : ""} /> Actualizar
        </button>
      </div>

      {apagada && (
        <div style={{ border: "1px solid #fde68a", background: "#fffbeb", color: "#92400e", borderRadius: 10, padding: "10px 14px", fontSize: 13, display: "flex", gap: 8, marginBottom: 14 }}>
          <Info size={16} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>
            <b>La emisión real está apagada en el servidor.</b> Puedes abrir cada guía, revisar el borrador y simular,
            pero no se emite ninguna factura.
          </span>
        </div>
      )}
      {estado && estado.registro_listo === false && (
        <div style={{ border: "1px solid #fecaca", background: "#fef2f2", color: "#b91c1c", borderRadius: 10, padding: "10px 14px", fontSize: 13, display: "flex", gap: 8, marginBottom: 14 }}>
          <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>Falta aplicar la migración de emisiones de Bsale en la base de datos. Hasta entonces no se puede emitir ni hay historial.</span>
        </div>
      )}
      {error && (
        <div style={{ border: "1px solid #fecaca", background: "#fef2f2", color: "#b91c1c", borderRadius: 10, padding: "10px 14px", fontSize: 13, marginBottom: 14, overflowWrap: "anywhere" }}>
          {error}
        </div>
      )}

      <div className="stats-row stats-3">
        <div className="stat-card" onClick={() => cambiarPestana("pendientes")} style={{ cursor: "pointer" }} title="Ver las guías por facturar">
          <div className="stat-label">Guías por facturar</div>
          <div className="stat-value">{kpis.porFacturar}</div>
          <div className="stat-sub">de cotizaciones adjudicadas</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Con más de 7 días</div>
          <div className="stat-value" style={{ color: kpis.atrasadas ? "var(--danger)" : undefined }}>{kpis.atrasadas}</div>
          <div className="stat-sub">guías despachadas hace más de una semana, sin factura</div>
        </div>
        <div className="stat-card" onClick={() => cambiarPestana("emitidas")} style={{ cursor: "pointer" }} title="Ver lo emitido">
          <div className="stat-label">Emitidas este mes</div>
          <div className="stat-value">{kpis.emitidasMes}</div>
          <div className="stat-money">{clp(kpis.totalMes)}</div>
          <div className="stat-sub">
            desde el sistema · con IVA{kpis.conProblema ? ` · ${kpis.conProblema} intento${kpis.conProblema === 1 ? "" : "s"} sin emitir` : ""}
          </div>
        </div>
      </div>

      <div className="filter-bar" style={{ alignItems: "flex-end" }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <button type="button" className={`btn ${pestana === "pendientes" ? "btn-primary" : "btn-secondary"}`} onClick={() => cambiarPestana("pendientes")}>
            Por facturar ({pendientes.length})
          </button>
          <button type="button" className={`btn ${pestana === "emitidas" ? "btn-primary" : "btn-secondary"}`} onClick={() => cambiarPestana("emitidas")}>
            Emitidas ({emitidas.filas.filter((f) => f.estado === "emitida").length})
          </button>
        </div>
        <div className="filter-field" style={{ flex: "1 1 220px", minWidth: 0 }}>
          <label className="filter-label">Buscar</label>
          <input
            type="text"
            className="input"
            placeholder={pestana === "pendientes" ? "Cliente, RUT, cotización, orden de compra o guía…" : "Cliente, cotización, N° de factura o guía…"}
            value={buscar}
            onChange={(e) => { setBuscar(e.target.value); setPagina(1); }}
          />
        </div>
        <BotonLimpiarFiltros hay={buscar !== ""} onLimpiar={() => { setBuscar(""); setPagina(1); }} />
      </div>

      <div className="table-wrap" style={{ boxShadow: "0 1px 3px rgba(15, 23, 42, 0.04), 0 0 0 1px rgba(15, 23, 42, 0.04)", borderRadius: 10, overflow: "hidden" }}>
        <div className="table-scroll">
          {pestana === "pendientes" ? (
            <table className="data-table" style={{ minWidth: 760 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left" }}>Cotización / Cliente</th>
                  <th style={{ textAlign: "left" }}>Orden de compra</th>
                  <th style={{ textAlign: "left" }}>Guía</th>
                  <th style={{ textAlign: "left" }}>Sin factura hace</th>
                  <th style={{ textAlign: "right" }}>Acción</th>
                </tr>
              </thead>
              <tbody>
                {visibles.length === 0 ? (
                  <tr>
                    <td colSpan="5" style={{ textAlign: "center", padding: "50px 0", color: "var(--text-muted)" }}>
                      {cargando ? "Cargando…" : pendientes.length === 0 ? "No hay guías pendientes de factura." : "Ninguna guía coincide con la búsqueda."}
                    </td>
                  </tr>
                ) : (
                  visibles.map((f) => {
                    const tono = tonoDias(f.dias);
                    return (
                      <tr key={f.guia_id}>
                        <td style={{ verticalAlign: "middle", whiteSpace: "normal" }}>
                          <Link to={`/detalle/${f.licitacion_id}`} className="table-link" style={{ fontWeight: 600 }}>#{f.licitacion_id}</Link>
                          {f.codigo && <span style={{ color: "var(--text-muted)", fontSize: 11, marginLeft: 6 }}>{f.codigo}</span>}
                          <div style={{ fontWeight: 500, fontSize: 13, color: "#1f2937", marginTop: 2, overflowWrap: "anywhere" }}>{f.cliente || "—"}</div>
                          {f.rut && <div style={{ color: "var(--text-muted)", fontSize: 11 }}>RUT {f.rut}</div>}
                        </td>
                        <td style={{ verticalAlign: "middle" }}>
                          <div style={{ fontWeight: 500, overflowWrap: "anywhere" }}>{f.oc_numero || "—"}</div>
                          {f.oc_neto ? <div style={{ color: "var(--text-muted)", fontSize: 11, whiteSpace: "nowrap" }}>Neto {clp(f.oc_neto)}</div> : null}
                        </td>
                        <td style={{ verticalAlign: "middle", whiteSpace: "normal" }}>
                          <div style={{ fontWeight: 600 }}>{f.guia_folio || f.guia_numero || "Sin número"}</div>
                          {/* Lo que se digitó junto al número (p. ej. "NO FACTURAR HASTA…") */}
                          {f.guia_numero && f.guia_numero !== f.guia_folio && (
                            <div style={{ fontSize: 11.5, color: "#92400e", overflowWrap: "anywhere" }}>«{f.guia_numero}»</div>
                          )}
                          <div style={{ color: "var(--text-muted)", fontSize: 11, whiteSpace: "nowrap" }}>{fechaCL(f.guia_fecha)}</div>
                        </td>
                        <td style={{ verticalAlign: "middle" }}>
                          <span style={pastilla(tono)}>{tono.texto}</span>
                        </td>
                        <td style={{ verticalAlign: "middle", textAlign: "right", whiteSpace: "nowrap" }}>
                          {f.emitible ? (
                            <button type="button" className="btn btn-primary btn-sm" onClick={() => setEmitir({ licId: f.licitacion_id, guiaId: f.guia_id })}>
                              <FileCheck size={13} /> {apagada ? "Revisar borrador" : "Emitir factura"}
                            </button>
                          ) : (
                            <span style={{ fontSize: 12, color: "var(--text-muted)" }} title="Lo cargado como número no es un folio de guía: no se puede buscar en Bsale. Corrígelo en Trazabilidad.">
                              Sin N° de guía válido
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          ) : (
            <table className="data-table" style={{ minWidth: 900 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left" }}>Fecha</th>
                  <th style={{ textAlign: "left" }}>Factura</th>
                  <th style={{ textAlign: "left" }}>Cotización / Cliente</th>
                  <th style={{ textAlign: "left" }}>Guías</th>
                  <th style={{ textAlign: "right" }}>Neto</th>
                  <th style={{ textAlign: "right" }}>Total</th>
                  <th style={{ textAlign: "left" }}>Emitida por</th>
                  <th style={{ textAlign: "left" }}>Estado</th>
                </tr>
              </thead>
              <tbody>
                {visibles.length === 0 ? (
                  <tr>
                    <td colSpan="8" style={{ textAlign: "center", padding: "50px 0", color: "var(--text-muted)" }}>
                      {cargando ? "Cargando…" : emitidas.filas.length === 0 ? "Todavía no se ha emitido ninguna factura desde el sistema." : "Nada coincide con la búsqueda."}
                    </td>
                  </tr>
                ) : (
                  visibles.map((f) => {
                    const est = ESTADOS[f.estado] || { texto: f.estado, color: "#6b7280", bg: "#f3f4f6" };
                    return (
                      <tr key={f.id}>
                        <td style={{ verticalAlign: "middle", whiteSpace: "nowrap" }}>{fechaCL(f.fecha)}</td>
                        <td style={{ verticalAlign: "middle" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <span style={{ fontWeight: 600 }}>{f.numero || "—"}</span>
                            {f.url_pdf && (
                              <a href={f.url_pdf} target="_blank" rel="noopener noreferrer" title="Ver la factura en Bsale" style={{ color: "var(--primary)", display: "inline-flex" }}>
                                <ExternalLink size={13} />
                              </a>
                            )}
                          </div>
                        </td>
                        <td style={{ verticalAlign: "middle", whiteSpace: "normal" }}>
                          <Link to={`/detalle/${f.licitacion_id}`} className="table-link" style={{ fontWeight: 600 }}>#{f.licitacion_id}</Link>
                          {f.codigo && <span style={{ color: "var(--text-muted)", fontSize: 11, marginLeft: 6 }}>{f.codigo}</span>}
                          <div style={{ fontSize: 13, color: "#1f2937", marginTop: 2, overflowWrap: "anywhere" }}>{f.cliente || "—"}</div>
                        </td>
                        <td style={{ verticalAlign: "middle" }}>{f.guias.join(", ") || "—"}</td>
                        <td style={{ verticalAlign: "middle", textAlign: "right", whiteSpace: "nowrap" }}>{clp(f.neto)}</td>
                        <td style={{ verticalAlign: "middle", textAlign: "right", whiteSpace: "nowrap", fontWeight: 600 }}>{clp(f.total)}</td>
                        <td style={{ verticalAlign: "middle", fontSize: 12, whiteSpace: "normal", overflowWrap: "anywhere" }}>{f.usuario || "—"}</td>
                        <td style={{ verticalAlign: "middle", whiteSpace: "normal" }}>
                          <span style={pastilla(est)}>{est.texto}</span>
                          {f.error && (
                            <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 3, overflowWrap: "anywhere", maxWidth: 260 }} title={f.error}>
                              {f.error.length > 110 ? `${f.error.slice(0, 110)}…` : f.error}
                            </div>
                          )}
                          {(f.estado === "error" || f.estado === "incierta") && f.guia_ids?.[0] && (
                            <button type="button" className="btn btn-secondary btn-sm" style={{ marginTop: 5 }} onClick={() => setEmitir({ licId: f.licitacion_id, guiaId: f.guia_ids[0], guiaIds: f.guia_ids })}>
                              Revisar de nuevo
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <Paginacion pagina={paginaActual} total={lista.length} porPagina={POR_PAGINA} onCambiar={setPagina} nombre={pestana === "pendientes" ? "guías" : "registros"} />
    </div>
  );
}
