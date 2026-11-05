import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowDownCircle, ArrowUpCircle, ChevronDown, ChevronRight, Download, History, Lock, RefreshCw, Trash2, Unlock, Vault, X } from "lucide-react";
import { api } from "../lib/api";
import Toast from "../components/Toast";
import ConfirmModal from "../components/ConfirmModal";
import DropdownSelect from "../components/ui/DropdownSelect";
import { useStickyState } from "../lib/useStickyState";

/* ── Apertura y cierre de caja (2026-11-05) ─────────────────────────────────
   Pedido de Ariel: "Módulo apertura y cierre de caja (asociar solamente lo que
   corresponde al usuario ventas@amsodentmedical.cl)".

   La caja de la sala de ventas. Un turno se abre con el fondo en efectivo y se
   cierra con el arqueo (efectivo contado contra el esperado). Al turno se le
   asocian solo las ventas directas que emitió el usuario de la tienda desde la
   apertura; el servidor las lee de las emisiones de Bsale con su medio de
   pago (backend/src/caja). El efectivo esperado = fondo + ventas en efectivo
   + ingresos − egresos registrados a mano. Tarjeta, transferencia y demás se
   informan por medio de pago y no mueven el efectivo.

   Pestañas: «Turno actual» (abrir, ver ventas y movimientos, cerrar) e
   «Historial» (turnos cerrados, con su detalle y Excel). */

const POR_PAGINA = 10;
const pesos = (n) => `$${Math.round(Number(n) || 0).toLocaleString("es-CL")}`;
const soloDigitos = (v) => String(v ?? "").replace(/[^\d]/g, "");
const conPesos = (v) => (v === "" || v == null ? "" : `$${Number(soloDigitos(v) || 0).toLocaleString("es-CL")}`);
const fechaHora = (iso) => (iso ? new Date(iso).toLocaleString("es-CL", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");
const hora = (iso) => (iso ? new Date(iso).toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit" }) : "—");
const quien = (email) => String(email || "").split("@")[0] || "—";
const colorDiferencia = (d) => (d === 0 ? { color: "#15803d", bg: "#dcfce7" } : d > 0 ? { color: "#0369a1", bg: "#e0f2fe" } : { color: "#b91c1c", bg: "#fee2e2" });
const textoDiferencia = (d) => (d === 0 ? "Cuadra" : d > 0 ? `Sobran ${pesos(d)}` : `Faltan ${pesos(-d)}`);

function Paginador({ pagina, total, onCambiar, etiqueta }) {
  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA));
  if (total <= POR_PAGINA) return null;
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "10px 4px", fontSize: 12.5, color: "var(--text-soft)" }}>
      <span>{(pagina - 1) * POR_PAGINA + 1}–{Math.min(pagina * POR_PAGINA, total)} de {total} {etiqueta}</span>
      <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
        <button type="button" className="btn btn-secondary btn-sm" disabled={pagina <= 1} onClick={() => onCambiar(pagina - 1)}>Anterior</button>
        <span>Página {pagina} de {paginas}</span>
        <button type="button" className="btn btn-secondary btn-sm" disabled={pagina >= paginas} onClick={() => onCambiar(pagina + 1)}>Siguiente</button>
      </span>
    </div>
  );
}

/* Ventas, movimientos y resumen por medio de un turno (abierto o cerrado). */
function DetalleTurno({ detalle, abierto = false, onEliminarMovimiento }) {
  const [pagina, setPagina] = useState(1);
  const ventas = detalle?.ventas || [];
  const movimientos = detalle?.movimientos || [];
  const resumen = detalle?.resumen || {};
  const paginaActual = Math.min(pagina, Math.max(1, Math.ceil(ventas.length / POR_PAGINA)));
  const visibles = ventas.slice((paginaActual - 1) * POR_PAGINA, paginaActual * POR_PAGINA);

  return (
    <div className="detalle-turno" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {(resumen.por_medio || []).length > 0 && (
        <div className="medios-turno" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {resumen.por_medio.map((m) => (
            <span key={m.medio} style={{ fontSize: 12.5, border: "1px solid var(--border)", background: m.medio === "efectivo" ? "#f0fdf4" : "var(--surface)", borderRadius: 999, padding: "4px 12px", whiteSpace: "nowrap" }} title={`${m.ventas} venta${m.ventas === 1 ? "" : "s"}`}>
              <span style={{ color: "var(--text-muted)" }}>{m.nombre}:</span> <strong>{pesos(m.total)}</strong> <span style={{ color: "var(--text-muted)" }}>({m.ventas})</span>
            </span>
          ))}
        </div>
      )}

      <div>
        <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".4px", color: "var(--text-muted)", marginBottom: 6 }}>
          Ventas del turno{resumen.anuladas ? ` · ${resumen.anuladas} anulada${resumen.anuladas === 1 ? "" : "s"} (no cuenta${resumen.anuladas === 1 ? "" : "n"})` : ""}
        </div>
        <div className="table-wrap" style={{ margin: 0 }}>
          <table className="data-table tabla-compacta tabla-texto tabla-ventas-caja" style={{ minWidth: 560 }}>
            <thead>
              <tr>
                <th>Hora</th>
                <th>Documento</th>
                <th>Cliente</th>
                <th>Medio de pago</th>
                <th style={{ textAlign: "right" }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {ventas.length === 0 && (
                <tr><td colSpan={5} style={{ textAlign: "center", padding: "26px 12px", color: "var(--text-muted)" }}>
                  {abierto ? "Todavía no hay ventas directas del usuario de la tienda en este turno." : "El turno no tuvo ventas."}
                </td></tr>
              )}
              {visibles.map((v) => (
                <tr key={v.id} style={{ opacity: v.anulada ? 0.55 : 1 }}>
                  <td style={{ whiteSpace: "nowrap" }}>{hora(v.hora)}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {v.url_pdf
                      ? <a href={v.url_pdf} target="_blank" rel="noreferrer" className="table-link">{v.tipo === "factura" ? "Factura" : "Boleta"} N° {v.numero || "—"}</a>
                      : <>{v.tipo === "factura" ? "Factura" : "Boleta"} N° {v.numero || "—"}</>}
                    {v.anulada && <span style={{ marginLeft: 6, fontSize: 10.5, fontWeight: 700, color: "#b91c1c", background: "#fee2e2", borderRadius: 999, padding: "1px 7px" }}>anulada</span>}
                  </td>
                  <td style={{ maxWidth: 240 }}>{v.cliente || "Consumidor final"}</td>
                  <td style={{ maxWidth: 170 }}>
                    <span style={{ fontWeight: v.medio === "efectivo" ? 700 : 500, color: v.medio === "efectivo" ? "#15803d" : v.medio === "credito" ? "#b45309" : "var(--text)" }}>{v.medio_nombre}</span>
                    {v.comprobante && <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>{v.comprobante}</div>}
                  </td>
                  <td style={{ textAlign: "right", fontWeight: 700, whiteSpace: "nowrap" }}>{pesos(v.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Paginador pagina={paginaActual} total={ventas.length} onCambiar={setPagina} etiqueta="ventas" />
      </div>

      {(movimientos.length > 0 || abierto) && (
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".4px", color: "var(--text-muted)", marginBottom: 6 }}>Movimientos de efectivo</div>
          {movimientos.length === 0 ? (
            <div style={{ fontSize: 12.5, color: "var(--text-muted)" }}>Sin retiros, gastos ni ingresos a mano en este turno.</div>
          ) : (
            <div className="table-wrap" style={{ margin: 0 }}>
              <table className="data-table tabla-compacta tabla-texto" style={{ minWidth: 480 }}>
                <thead>
                  <tr>
                    <th>Hora</th>
                    <th>Tipo</th>
                    <th>Motivo</th>
                    <th style={{ textAlign: "right" }}>Monto</th>
                    {abierto && <th aria-label="Quitar" style={{ width: 40 }} />}
                  </tr>
                </thead>
                <tbody>
                  {movimientos.map((m) => (
                    <tr key={m.id}>
                      <td style={{ whiteSpace: "nowrap" }}>{hora(m.created_at)}</td>
                      <td style={{ whiteSpace: "nowrap", fontWeight: 700, color: m.tipo === "ingreso" ? "#15803d" : "#b45309" }}>{m.tipo === "ingreso" ? "Ingreso" : "Egreso"}</td>
                      <td style={{ maxWidth: 320 }}>
                        {m.motivo}
                        <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>{quien(m.usuario_email)}</div>
                      </td>
                      <td style={{ textAlign: "right", fontWeight: 700, whiteSpace: "nowrap", color: m.tipo === "ingreso" ? "#15803d" : "#b45309" }}>{m.tipo === "ingreso" ? "+" : "−"}{pesos(m.monto)}</td>
                      {abierto && (
                        <td style={{ textAlign: "right" }}>
                          <button type="button" className="btn btn-ghost btn-sm" onClick={() => onEliminarMovimiento?.(m)} title="Quitar este movimiento" style={{ color: "#dc2626", padding: "2px 6px" }}><Trash2 size={13} /></button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {(detalle?.notas_credito || []).length > 0 && (
        <div style={{ fontSize: 12.5, color: "#92400e", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8, padding: "8px 12px" }}>
          En este turno el usuario de la tienda emitió {detalle.notas_credito.length} nota{detalle.notas_credito.length === 1 ? "" : "s"} de crédito por {pesos(detalle.notas_credito.reduce((a, n) => a + n.total, 0))} ({detalle.notas_credito.map((n) => `N° ${n.numero || "—"}`).join(", ")}). Si se devolvió efectivo, regístralo como egreso.
        </div>
      )}
    </div>
  );
}

export default function Caja() {
  const [estado, setEstado] = useState(null); // { listo, mensaje?, usuario_caja, turno }
  const [cargando, setCargando] = useState(true);
  const [toast, setToast] = useState(null);
  const [pestana, setPestana] = useStickyState("caja.pestana", "turno");
  const [fondo, setFondo] = useState("");
  const [obsApertura, setObsApertura] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [modalMov, setModalMov] = useState(false);
  const [modalCierre, setModalCierre] = useState(false);
  const [movAEliminar, setMovAEliminar] = useState(null);
  // Historial
  const [historial, setHistorial] = useState(null);
  const [paginaHist, setPaginaHist] = useState(1);
  const [abiertoHist, setAbiertoHist] = useState(null);
  const [detalles, setDetalles] = useState({}); // id → detalle

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      setEstado(await api.get("/caja/estado"));
    } catch (e) {
      setToast({ type: "error", message: e?.message || "No se pudo consultar la caja." });
    } finally {
      setCargando(false);
    }
  }, []);
  const cargarHistorial = useCallback(async () => {
    try {
      const r = await api.get("/caja/historial");
      setHistorial(Array.isArray(r?.turnos) ? r.turnos : []);
    } catch {
      setHistorial([]);
    }
  }, []);
  useEffect(() => { cargar(); cargarHistorial(); }, [cargar, cargarHistorial]);

  const turno = estado?.turno || null;
  const resumen = turno?.resumen || null;

  async function abrir(e) {
    e?.preventDefault?.();
    if (ocupado) return;
    setOcupado(true);
    try {
      const t = await api.post("/caja/abrir", { monto_inicial: Number(soloDigitos(fondo)) || 0, observacion: obsApertura.trim() });
      setEstado((prev) => ({ ...(prev || {}), turno: t }));
      setFondo(""); setObsApertura("");
      setToast({ type: "success", message: "Caja abierta: desde ahora las ventas directas de la tienda entran a este turno." });
    } catch (err) {
      setToast({ type: "error", message: err?.message || "No se pudo abrir la caja." });
      cargar();
    } finally {
      setOcupado(false);
    }
  }

  async function quitarMovimiento() {
    const m = movAEliminar;
    setMovAEliminar(null);
    if (!m) return;
    try {
      const t = await api.delete(`/caja/movimientos/${m.id}`);
      setEstado((prev) => ({ ...(prev || {}), turno: t }));
    } catch (err) {
      setToast({ type: "error", message: err?.message || "No se pudo quitar el movimiento." });
    }
  }

  async function verDetalle(id) {
    if (abiertoHist === id) { setAbiertoHist(null); return; }
    setAbiertoHist(id);
    if (detalles[id]) return;
    try {
      const d = await api.get(`/caja/turnos/${id}`);
      setDetalles((prev) => ({ ...prev, [id]: d }));
    } catch (err) {
      setToast({ type: "error", message: err?.message || "No se pudo cargar el detalle del turno." });
      setAbiertoHist(null);
    }
  }

  async function exportar(t) {
    try {
      const d = detalles[t.id] || (await api.get(`/caja/turnos/${t.id}`));
      const XLSX = await import("xlsx");
      const r = t.resumen_cierre || d.resumen || {};
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
        ["Turno de caja N°", t.id],
        ["Apertura", fechaHora(t.abierta_at), t.abierta_por],
        ["Cierre", fechaHora(t.cerrada_at), t.cerrada_por],
        ["Fondo inicial", t.monto_inicial],
        ["Ventas del turno", r.ventas ?? "", r.total_ventas ?? ""],
        ["Ventas en efectivo", r.ventas_efectivo ?? ""],
        ["Otros medios", r.otros_medios ?? ""],
        ["Ingresos de efectivo", r.ingresos ?? ""],
        ["Egresos de efectivo", r.egresos ?? ""],
        ["Efectivo esperado", t.efectivo_esperado],
        ["Efectivo contado", t.efectivo_contado],
        ["Diferencia", t.diferencia],
        ["Observación de cierre", t.observacion_cierre],
        [],
        ["Medio de pago", "Ventas", "Total"],
        ...(r.por_medio || []).map((m) => [m.nombre, m.ventas, m.total]),
      ]), "Arqueo");
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet((d.ventas || []).map((v) => ({
        Hora: fechaHora(v.hora), Documento: v.tipo === "factura" ? "Factura" : "Boleta", "N°": v.numero || "", Cliente: v.cliente || "Consumidor final",
        "Medio de pago": v.medio_nombre, Comprobante: v.comprobante || "", Total: v.total, Anulada: v.anulada ? "Sí" : "",
      }))), "Ventas");
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet((d.movimientos || []).map((m) => ({
        Hora: fechaHora(m.created_at), Tipo: m.tipo === "ingreso" ? "Ingreso" : "Egreso", Motivo: m.motivo, Monto: m.monto, Usuario: m.usuario_email || "",
      }))), "Movimientos");
      XLSX.writeFile(wb, `caja-turno-${t.id}.xlsx`);
    } catch (err) {
      setToast({ type: "error", message: err?.message || "No se pudo exportar el turno." });
    }
  }

  const histVisible = useMemo(() => {
    const lista = historial || [];
    const p = Math.min(paginaHist, Math.max(1, Math.ceil(lista.length / POR_PAGINA)));
    return { pagina: p, filas: lista.slice((p - 1) * POR_PAGINA, p * POR_PAGINA), total: lista.length };
  }, [historial, paginaHist]);

  return (
    <div className="page pagina-caja">
      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}
      <ConfirmModal
        open={movAEliminar !== null}
        title="¿Quitar este movimiento?"
        message={`${movAEliminar?.tipo === "ingreso" ? "Ingreso" : "Egreso"} de ${pesos(movAEliminar?.monto)} · ${movAEliminar?.motivo || ""}. El efectivo esperado se recalcula.`}
        confirmText="Quitar"
        confirmTone="danger"
        onConfirm={quitarMovimiento}
        onCancel={() => setMovAEliminar(null)}
      />

      <div className="page-header">
        <div>
          <h1 className="page-title">Caja</h1>
          <p className="page-subtitle">
            Apertura y cierre de la caja de la sala de ventas. Al turno entran solo las ventas directas emitidas por <strong>{estado?.usuario_caja || "el usuario de la tienda"}</strong>.
          </p>
        </div>
        <div className="page-actions">
          <button type="button" className="btn btn-secondary" onClick={() => { cargar(); cargarHistorial(); }} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <RefreshCw size={14} /> Actualizar
          </button>
        </div>
      </div>

      {estado?.listo === false && (
        <div style={{ fontSize: 13, color: "#92400e", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 10, padding: "10px 14px", marginBottom: 16 }}>{estado.mensaje}</div>
      )}

      <div className="pagos-tabs" role="tablist" aria-label="Vista de Caja">
        {[
          { value: "turno", label: turno ? "Turno abierto" : "Turno actual", Icono: turno ? Unlock : Vault },
          { value: "historial", label: `Historial${historial?.length ? ` (${historial.length})` : ""}`, Icono: History },
        ].map((p) => (
          <button key={p.value} type="button" role="tab" aria-selected={pestana === p.value} className={pestana === p.value ? "activo" : ""} onClick={() => setPestana(p.value)}>
            <p.Icono size={15} />
            {p.label}
          </button>
        ))}
      </div>

      {pestana === "turno" && (
        cargando && !estado ? (
          <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>Cargando…</div>
        ) : !turno ? (
          /* ── Caja cerrada: apertura ── */
          <form onSubmit={abrir} className="surface apertura-caja" style={{ maxWidth: 560 }}>
            <div className="surface-header" style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Lock size={16} style={{ color: "var(--text-muted)" }} />
              <h3 className="surface-title">La caja está cerrada</h3>
            </div>
            <div className="surface-body" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ fontSize: 13, color: "var(--text-soft)", lineHeight: 1.5 }}>
                Cuenta el efectivo con que parte la caja (el fondo o sencillo) y ábrela. Desde ese momento, cada venta directa de la tienda queda en el turno.
              </div>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                <div className="field" style={{ flex: "1 1 160px", minWidth: 0 }}>
                  <label className="field-label">Fondo inicial en efectivo <span style={{ color: "var(--danger)" }}>*</span></label>
                  <input className="input campo-fondo" inputMode="numeric" value={conPesos(fondo)} onChange={(e) => setFondo(soloDigitos(e.target.value))} placeholder="$0" disabled={estado?.listo === false} />
                </div>
                <div className="field" style={{ flex: "2 1 220px", minWidth: 0 }}>
                  <label className="field-label">Observación <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>(opcional)</span></label>
                  <input className="input" value={obsApertura} onChange={(e) => setObsApertura(e.target.value.slice(0, 300))} placeholder="Quién abre, turno…" disabled={estado?.listo === false} />
                </div>
              </div>
              <div>
                <button type="submit" className="btn btn-primary btn-abrir-caja" disabled={ocupado || fondo === "" || estado?.listo === false} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <Unlock size={15} /> {ocupado ? "Abriendo…" : "Abrir caja"}
                </button>
              </div>
            </div>
          </form>
        ) : (
          /* ── Turno abierto ── */
          <>
            <div className="barra-turno" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", border: "1px solid #bbf7d0", background: "#f0fdf4", borderRadius: 12, padding: "10px 14px", marginBottom: 14 }}>
              <div style={{ fontSize: 13, color: "#14532d", lineHeight: 1.5, minWidth: 0 }}>
                <strong>Caja abierta</strong> · turno N° {turno.sesion.id} · desde el {fechaHora(turno.sesion.abierta_at)} por {quien(turno.sesion.abierta_por)}
                {turno.sesion.observacion_apertura && <span style={{ color: "#166534" }}> · {turno.sesion.observacion_apertura}</span>}
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button type="button" className="btn btn-secondary" onClick={() => setModalMov(true)} style={{ display: "inline-flex", alignItems: "center", gap: 6 }} title="Retiro, gasto menor, devolución en efectivo o ingreso de sencillo">
                  <ArrowUpCircle size={14} /> Movimiento de efectivo
                </button>
                <button type="button" className="btn btn-primary btn-cerrar-caja" onClick={() => setModalCierre(true)} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <Lock size={14} /> Cerrar caja
                </button>
              </div>
            </div>

            <div className="stats-row">
              <div className="stat-card">
                <div className="stat-label">Ventas del turno</div>
                <div className="stat-value">{pesos(resumen.total_ventas)}</div>
                <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 2 }}>{resumen.ventas} venta{resumen.ventas === 1 ? "" : "s"}{resumen.credito ? ` · ${pesos(resumen.credito)} a crédito` : ""}</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Efectivo esperado en caja</div>
                <div className="stat-value">{pesos(resumen.efectivo_esperado)}</div>
                <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 2 }}>fondo {pesos(turno.sesion.monto_inicial)} + efectivo {pesos(resumen.ventas_efectivo)}</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Otros medios de pago</div>
                <div className="stat-value">{pesos(resumen.otros_medios)}</div>
                <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 2 }}>tarjeta, transferencia y demás</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Movimientos de efectivo</div>
                <div className="stat-value">{pesos(resumen.ingresos - resumen.egresos)}</div>
                <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 2 }}>+{pesos(resumen.ingresos)} ingresos · −{pesos(resumen.egresos)} egresos</div>
              </div>
            </div>

            <DetalleTurno detalle={turno} abierto onEliminarMovimiento={setMovAEliminar} />
          </>
        )
      )}

      {pestana === "historial" && (
        <>
          <div className="table-wrap">
            <table className="data-table tabla-compacta tabla-texto tabla-historial-caja" style={{ minWidth: 780 }}>
              <thead>
                <tr>
                  <th style={{ width: 28 }} aria-label="Detalle" />
                  <th>Turno</th>
                  <th>Abrió · cerró</th>
                  <th style={{ textAlign: "right" }}>Fondo</th>
                  <th style={{ textAlign: "right" }}>Ventas</th>
                  <th style={{ textAlign: "right" }}>Efectivo esperado</th>
                  <th style={{ textAlign: "right" }}>Contado</th>
                  <th>Arqueo</th>
                  <th style={{ textAlign: "right" }}>Excel</th>
                </tr>
              </thead>
              <tbody>
                {historial === null && <tr><td colSpan={9} style={{ textAlign: "center", padding: "40px 0", color: "var(--text-muted)" }}>Cargando…</td></tr>}
                {historial !== null && histVisible.total === 0 && (
                  <tr><td colSpan={9} style={{ textAlign: "center", padding: "40px 16px", color: "var(--text-muted)" }}>Todavía no hay turnos cerrados.</td></tr>
                )}
                {histVisible.filas.map((t) => {
                  const ab = abiertoHist === t.id;
                  const r = t.resumen_cierre || {};
                  const dif = Number(t.diferencia) || 0;
                  const c = colorDiferencia(dif);
                  return (
                    <Fragment key={t.id}>
                      <tr onClick={() => verDetalle(t.id)} style={{ cursor: "pointer", background: ab ? "var(--bg)" : undefined }} title={ab ? "Ocultar el detalle" : "Ver las ventas y movimientos del turno"}>
                        <td style={{ color: "var(--text-muted)" }}>{ab ? <ChevronDown size={15} /> : <ChevronRight size={15} />}</td>
                        <td>
                          <div style={{ fontWeight: 700 }}>N° {t.id}</div>
                          <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>{fechaHora(t.abierta_at)} → {fechaHora(t.cerrada_at)}</div>
                        </td>
                        <td style={{ maxWidth: 170 }}>{quien(t.abierta_por)} · {quien(t.cerrada_por)}</td>
                        <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>{pesos(t.monto_inicial)}</td>
                        <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                          {pesos(r.total_ventas)}
                          <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>{r.ventas ?? 0} venta{r.ventas === 1 ? "" : "s"}</div>
                        </td>
                        <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>{pesos(t.efectivo_esperado)}</td>
                        <td style={{ textAlign: "right", whiteSpace: "nowrap", fontWeight: 700 }}>{pesos(t.efectivo_contado)}</td>
                        <td>
                          <span className="chip-arqueo" style={{ fontSize: 11.5, fontWeight: 700, color: c.color, background: c.bg, borderRadius: 999, padding: "2px 9px", whiteSpace: "nowrap" }}>{textoDiferencia(dif)}</span>
                          {t.observacion_cierre && <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 3, maxWidth: 200 }}>{t.observacion_cierre}</div>}
                        </td>
                        <td style={{ textAlign: "right" }}>
                          <button type="button" className="btn btn-ghost btn-sm" onClick={(e) => { e.stopPropagation(); exportar(t); }} title="Descargar el arqueo, las ventas y los movimientos del turno" style={{ padding: "2px 6px" }}><Download size={14} /></button>
                        </td>
                      </tr>
                      {ab && (
                        <tr className="detalle-historial-caja">
                          <td colSpan={9} style={{ background: "var(--bg)", padding: "12px 14px" }}>
                            {detalles[t.id] ? <DetalleTurno detalle={{ ...detalles[t.id], resumen: t.resumen_cierre || detalles[t.id].resumen }} /> : <div style={{ color: "var(--text-muted)", fontSize: 13 }}>Cargando el detalle…</div>}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Paginador pagina={histVisible.pagina} total={histVisible.total} onCambiar={(p) => { setPaginaHist(p); setAbiertoHist(null); }} etiqueta="turnos" />
        </>
      )}

      {modalMov && turno && (
        <ModalMovimiento
          onCerrar={() => setModalMov(false)}
          onGuardado={(t) => { setModalMov(false); setEstado((prev) => ({ ...(prev || {}), turno: t })); setToast({ type: "success", message: "Movimiento registrado: el efectivo esperado ya lo considera." }); }}
        />
      )}
      {modalCierre && turno && (
        <ModalCierre
          turno={turno}
          onCerrar={() => setModalCierre(false)}
          onCerrada={(r) => {
            setModalCierre(false);
            const dif = Number(r?.sesion?.diferencia) || 0;
            setToast({ type: dif === 0 ? "success" : "warning", message: `Caja cerrada. ${dif === 0 ? "El efectivo cuadra." : `${textoDiferencia(dif)} en el arqueo.`}` });
            setEstado((prev) => ({ ...(prev || {}), turno: null }));
            setDetalles({});
            cargarHistorial();
            setPestana("historial");
          }}
        />
      )}
    </div>
  );
}

function Ventana({ titulo, ancho = 460, onCerrar, ocupado, children, pie }) {
  return createPortal(
    <div
      onMouseDown={(e) => { if (e.target === e.currentTarget && !ocupado) onCerrar(); }}
      style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.55)", zIndex: 11000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
    >
      <div className="ventana-caja" role="dialog" aria-modal="true" aria-label={titulo} style={{ width: ancho, maxWidth: "100%", maxHeight: "90vh", overflow: "auto", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-lg)" }}>
        <div style={{ padding: "12px 18px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <strong style={{ fontSize: 15 }}>{titulo}</strong>
          <button type="button" onClick={onCerrar} disabled={ocupado} className="btn btn-ghost" style={{ padding: 6 }} aria-label="Cerrar"><X size={18} /></button>
        </div>
        <div style={{ padding: "14px 18px", display: "flex", flexDirection: "column", gap: 12 }}>{children}</div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, flexWrap: "wrap", padding: "11px 18px", borderTop: "1px solid var(--border)", background: "var(--bg)" }}>{pie}</div>
      </div>
    </div>,
    document.body,
  );
}

function ModalMovimiento({ onCerrar, onGuardado }) {
  const [tipo, setTipo] = useState("egreso");
  const [monto, setMonto] = useState("");
  const [motivo, setMotivo] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const ok = Number(soloDigitos(monto)) > 0 && motivo.trim().length > 0 && !guardando;

  async function guardar() {
    if (!ok) return;
    setGuardando(true);
    setError("");
    try {
      onGuardado(await api.post("/caja/movimientos", { tipo, monto: Number(soloDigitos(monto)), motivo: motivo.trim() }));
    } catch (e) {
      setError(e?.message || "No se pudo registrar el movimiento.");
      setGuardando(false);
    }
  }

  return (
    <Ventana
      titulo="Movimiento de efectivo"
      onCerrar={onCerrar}
      ocupado={guardando}
      pie={<>
        <button type="button" className="btn btn-secondary" onClick={onCerrar} disabled={guardando}>Cancelar</button>
        <button type="button" className="btn btn-primary" onClick={guardar} disabled={!ok}>{guardando ? "Guardando…" : "Registrar"}</button>
      </>}
    >
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <div className="field" style={{ flex: "1 1 180px", minWidth: 0 }}>
          <label className="field-label">Tipo</label>
          <DropdownSelect
            value={tipo}
            onChange={setTipo}
            minWidth={240}
            options={[
              { value: "egreso", label: "Egreso (sale efectivo)", detalle: "Retiro, gasto menor, devolución en efectivo", color: "#d97706" },
              { value: "ingreso", label: "Ingreso (entra efectivo)", detalle: "Sencillo, reposición del fondo", color: "#16a34a" },
            ]}
          />
        </div>
        <div className="field" style={{ flex: "1 1 140px", minWidth: 0 }}>
          <label className="field-label">Monto <span style={{ color: "var(--danger)" }}>*</span></label>
          <input className="input" inputMode="numeric" value={conPesos(monto)} onChange={(e) => setMonto(soloDigitos(e.target.value))} placeholder="$0" autoFocus />
        </div>
      </div>
      <div className="field">
        <label className="field-label">Motivo <span style={{ color: "var(--danger)" }}>*</span></label>
        <input className="input" value={motivo} onChange={(e) => setMotivo(e.target.value.slice(0, 200))} placeholder={tipo === "egreso" ? "Ej: retiro a banco, compra de artículos de aseo" : "Ej: sencillo para vuelto"} />
      </div>
      <div style={{ fontSize: 12.5, color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 6 }}>
        {tipo === "egreso" ? <ArrowUpCircle size={14} style={{ color: "#d97706" }} /> : <ArrowDownCircle size={14} style={{ color: "#16a34a" }} />}
        {tipo === "egreso" ? "Resta del efectivo esperado en la caja." : "Suma al efectivo esperado en la caja."}
      </div>
      {error && <div style={{ fontSize: 12.5, color: "#dc2626", fontWeight: 600 }}>{error}</div>}
    </Ventana>
  );
}

function ModalCierre({ turno, onCerrar, onCerrada }) {
  const r = turno.resumen;
  const [contado, setContado] = useState("");
  const [observacion, setObservacion] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const hayConteo = contado !== "";
  const dif = hayConteo ? Number(soloDigitos(contado)) - r.efectivo_esperado : null;
  const c = dif == null ? null : colorDiferencia(dif);
  const ok = hayConteo && (dif === 0 || observacion.trim().length > 0) && !guardando;

  async function cerrar() {
    if (!ok) return;
    setGuardando(true);
    setError("");
    try {
      onCerrada(await api.post("/caja/cerrar", { efectivo_contado: Number(soloDigitos(contado)), observacion: observacion.trim() }));
    } catch (e) {
      setError(e?.message || "No se pudo cerrar la caja.");
      setGuardando(false);
    }
  }
  const fila = (etiqueta, valor, fuerte) => (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 13, fontWeight: fuerte ? 700 : 400 }}>
      <span style={{ color: fuerte ? "var(--text)" : "var(--text-soft)" }}>{etiqueta}</span>
      <span style={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{valor}</span>
    </div>
  );

  return (
    <Ventana
      titulo={`Cerrar caja · turno N° ${turno.sesion.id}`}
      ancho={500}
      onCerrar={onCerrar}
      ocupado={guardando}
      pie={<>
        <button type="button" className="btn btn-secondary" onClick={onCerrar} disabled={guardando}>Cancelar</button>
        <button type="button" className="btn btn-primary btn-confirmar-cierre" onClick={cerrar} disabled={!ok} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <Lock size={14} /> {guardando ? "Cerrando…" : "Cerrar caja"}
        </button>
      </>}
    >
      <div className="arqueo-resumen" style={{ border: "1px solid var(--border)", borderRadius: 10, padding: "10px 12px", background: "var(--bg)", display: "flex", flexDirection: "column", gap: 5 }}>
        {fila("Fondo inicial", pesos(turno.sesion.monto_inicial))}
        {fila(`Ventas en efectivo`, `+ ${pesos(r.ventas_efectivo)}`)}
        {fila("Ingresos de efectivo", `+ ${pesos(r.ingresos)}`)}
        {fila("Egresos de efectivo", `− ${pesos(r.egresos)}`)}
        <div style={{ borderTop: "1px solid var(--border)", margin: "3px 0" }} />
        {fila("Efectivo esperado en la caja", pesos(r.efectivo_esperado), true)}
        {r.otros_medios > 0 && fila("Otros medios (no están en la caja)", pesos(r.otros_medios))}
      </div>
      <div className="field">
        <label className="field-label">Efectivo contado en la caja <span style={{ color: "var(--danger)" }}>*</span></label>
        <input className="input campo-contado" inputMode="numeric" value={conPesos(contado)} onChange={(e) => setContado(soloDigitos(e.target.value))} placeholder="$0" autoFocus />
      </div>
      {dif != null && (
        <div className="arqueo-diferencia" style={{ fontSize: 13, fontWeight: 700, color: c.color, background: c.bg, borderRadius: 8, padding: "8px 12px" }}>
          {dif === 0 ? "El efectivo cuadra con lo esperado." : `${textoDiferencia(dif)} respecto de lo esperado.`}
        </div>
      )}
      <div className="field">
        <label className="field-label">Observación {dif ? <span style={{ color: "var(--danger)" }}>* (explica la diferencia)</span> : <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>(opcional)</span>}</label>
        <input className="input" value={observacion} onChange={(e) => setObservacion(e.target.value.slice(0, 400))} placeholder="Ej: billete de $1.000 de vuelto mal dado" />
      </div>
      <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Al cerrar queda guardada la foto del turno: después no se puede modificar.</div>
      {error && <div style={{ fontSize: 12.5, color: "#dc2626", fontWeight: 600 }}>{error}</div>}
    </Ventana>
  );
}
