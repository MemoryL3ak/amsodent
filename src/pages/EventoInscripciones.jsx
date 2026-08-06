import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import * as XLSX from "xlsx";
import QRCode from "qrcode";
import Toast from "../components/Toast";
import DateFilter from "../components/DateFilter";
import {
  CalendarCheck,
  Users,
  Search,
  Download,
  Trash2,
  RefreshCw,
  Mail,
  GraduationCap,
  QrCode,
  Copy,
  ExternalLink,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";

/* ============================================================
   Submódulo: inscripciones al evento AMSODENT.
   ─ Lista los registros del portal público /evento (GET
     /eventos/inscripciones), con filtros, export a Excel,
     reenvío del correo de confirmación y eliminación.
   ─ Tarjeta QR: genera el código con el link al portal público
     para imprimirlo o compartirlo (librería qrcode, local).
============================================================ */

const fmtFecha = (iso) =>
  iso ? new Date(iso).toLocaleString("es-CL", { dateStyle: "short", timeStyle: "short" }) : "—";

export default function EventoInscripciones() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filtro, setFiltro] = useState("");
  const [fechaDesde, setFechaDesde] = useState("");
  const [fechaHasta, setFechaHasta] = useState("");
  const [soloConfirmados, setSoloConfirmados] = useState(false);
  const [toast, setToast] = useState(null);
  const [confirmar, setConfirmar] = useState(null); // { title, message, onConfirm }
  const [reenviandoId, setReenviandoId] = useState(null);

  // QR del portal público. El link usa el dominio actual de la plataforma.
  const urlPortal = `${window.location.origin}/evento`;
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [mostrarQR, setMostrarQR] = useState(false);

  useEffect(() => {
    QRCode.toDataURL(urlPortal, { width: 480, margin: 2, color: { dark: "#0f172a" } })
      .then(setQrDataUrl)
      .catch(() => setQrDataUrl(""));
  }, [urlPortal]);

  useEffect(() => {
    cargar();
  }, []);

  async function cargar() {
    setLoading(true);
    try {
      const rows = await api.get("/eventos/inscripciones");
      setData(Array.isArray(rows) ? rows : []);
    } catch (e) {
      setToast({ type: "error", message: e?.message || "Error cargando inscripciones." });
    } finally {
      setLoading(false);
    }
  }

  const filtrada = useMemo(() => {
    const q = filtro.trim().toLowerCase();
    const desde = fechaDesde ? new Date(`${fechaDesde}T00:00:00`) : null;
    const hasta = fechaHasta ? new Date(`${fechaHasta}T23:59:59.999`) : null;
    return data.filter((p) => {
      if (soloConfirmados && !p.confirma_asistencia) return false;
      if (q) {
        const hay = [p.nombre, p.apellido, p.correo, p.telefono, p.especialidad, p.universidad].map(
          (x) => String(x || "").toLowerCase(),
        );
        if (!hay.some((s) => s.includes(q))) return false;
      }
      if (desde || hasta) {
        const created = p.created_at ? new Date(p.created_at) : null;
        if (!created) return false;
        if (desde && created < desde) return false;
        if (hasta && created > hasta) return false;
      }
      return true;
    });
  }, [data, filtro, fechaDesde, fechaHasta, soloConfirmados]);

  const stats = useMemo(
    () => ({
      total: data.length,
      confirmados: data.filter((p) => p.confirma_asistencia).length,
      profesores: data.filter((p) => p.es_profesor).length,
    }),
    [data],
  );

  function exportar() {
    if (filtrada.length === 0) {
      setToast({ type: "info", message: "No hay inscripciones en el filtro actual." });
      return;
    }
    const rows = filtrada.map((p) => ({
      Nombre: p.nombre,
      Apellido: p.apellido,
      "Teléfono": p.telefono,
      Correo: p.correo,
      Especialidad: p.especialidad,
      "Profesor universitario": p.es_profesor ? "Sí" : "No",
      Universidad: p.universidad || "",
      "Confirma asistencia": p.confirma_asistencia ? "Sí" : "No",
      "Correo confirmación": p.correo_enviado ? "Enviado" : "No enviado",
      "Fecha inscripción": fmtFecha(p.created_at),
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Inscripciones");
    XLSX.writeFile(wb, "evento_inscripciones.xlsx");
  }

  function eliminar(p) {
    setConfirmar({
      title: "Eliminar inscripción",
      message: `¿Eliminar la inscripción de ${p.nombre} ${p.apellido} (${p.correo})? Esta acción no se puede deshacer.`,
      onConfirm: async () => {
        try {
          await api.delete(`/eventos/inscripciones/${p.id}`);
          setData((prev) => prev.filter((x) => x.id !== p.id));
          setToast({ type: "success", message: "Inscripción eliminada." });
        } catch (e) {
          setToast({ type: "error", message: e?.message || "No se pudo eliminar." });
        }
      },
    });
  }

  async function reenviarCorreo(p) {
    setReenviandoId(p.id);
    try {
      await api.post(`/eventos/inscripciones/${p.id}/reenviar`, {});
      setData((prev) => prev.map((x) => (x.id === p.id ? { ...x, correo_enviado: true } : x)));
      setToast({ type: "success", message: `Confirmación reenviada a ${p.correo}.` });
    } catch (e) {
      setToast({ type: "error", message: e?.message || "No se pudo reenviar el correo." });
    } finally {
      setReenviandoId(null);
    }
  }

  async function copiarLink() {
    try {
      await navigator.clipboard.writeText(urlPortal);
      setToast({ type: "success", message: "Link del portal copiado." });
    } catch {
      setToast({ type: "error", message: "No se pudo copiar el link." });
    }
  }

  function descargarQR() {
    if (!qrDataUrl) return;
    const a = document.createElement("a");
    a.href = qrDataUrl;
    a.download = "qr_evento_amsodent.png";
    a.click();
  }

  return (
    <div className="page">
      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}

      <div className="page-header">
        <div>
          <h1 className="page-title" style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <CalendarCheck size={22} style={{ color: "var(--primary)" }} />
            Evento · Inscripciones
          </h1>
          <p className="page-subtitle">
            {stats.total} inscrito{stats.total !== 1 ? "s" : ""} · registros del portal público /evento
          </p>
        </div>
        <div className="page-actions" style={{ gap: 8 }}>
          <button className="btn btn-secondary" onClick={() => setMostrarQR(true)}>
            <QrCode size={14} />
            QR del portal
          </button>
          <button className="btn btn-secondary" onClick={cargar} disabled={loading}>
            <RefreshCw size={14} />
            Actualizar
          </button>
          <button className="btn btn-primary" onClick={exportar}>
            <Download size={14} />
            Exportar XLSX
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="evtadm-stats">
        <StatCard icon={<Users size={18} />} label="Inscritos totales" value={stats.total} tone="teal" />
        <StatCard icon={<CheckCircle2 size={18} />} label="Asistencia confirmada" value={stats.confirmados} tone="green" />
        <StatCard icon={<GraduationCap size={18} />} label="Profesores universitarios" value={stats.profesores} tone="violet" />
      </div>

      {/* Filtros */}
      <div className="filter-bar">
        <div className="filter-field" style={{ flex: 1, minWidth: 220 }}>
          <label className="filter-label">Buscar</label>
          <div style={{ position: "relative" }}>
            <Search size={14} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)" }} />
            <input
              className="input"
              style={{ paddingLeft: 30 }}
              placeholder="Nombre, correo, teléfono, especialidad, universidad…"
              value={filtro}
              onChange={(e) => setFiltro(e.target.value)}
            />
          </div>
        </div>
        <div className="filter-field">
          <label className="filter-label">Desde</label>
          <DateFilter value={fechaDesde} onChange={setFechaDesde} placeholder="Desde…" />
        </div>
        <div className="filter-field">
          <label className="filter-label">Hasta</label>
          <DateFilter value={fechaHasta} onChange={setFechaHasta} placeholder="Hasta…" />
        </div>
        <div className="filter-field" style={{ justifyContent: "flex-end" }}>
          <label className="filter-label">&nbsp;</label>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 13, cursor: "pointer", height: 38 }}>
            <input type="checkbox" checked={soloConfirmados} onChange={(e) => setSoloConfirmados(e.target.checked)} />
            Solo asistencia confirmada
          </label>
        </div>
      </div>

      {/* Tabla */}
      <div style={{ border: "1px solid var(--border)", borderRadius: 10, overflowX: "auto", background: "var(--surface)", marginTop: 12 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, whiteSpace: "nowrap" }}>
          <thead>
            <tr style={{ background: "var(--bg)", color: "var(--text-muted)", textAlign: "left" }}>
              <th style={{ padding: "9px 12px" }}>Nombre</th>
              <th style={{ padding: "9px 12px" }}>Teléfono</th>
              <th style={{ padding: "9px 12px" }}>Correo</th>
              <th style={{ padding: "9px 12px" }}>Especialidad</th>
              <th style={{ padding: "9px 12px" }}>Profesor / Universidad</th>
              <th style={{ padding: "9px 12px" }}>Asistencia</th>
              <th style={{ padding: "9px 12px" }}>Confirmación</th>
              <th style={{ padding: "9px 12px" }}>Inscrito</th>
              <th style={{ padding: "9px 12px" }} />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9} style={{ padding: 26, textAlign: "center", color: "var(--text-muted)" }}>Cargando inscripciones…</td></tr>
            ) : filtrada.length === 0 ? (
              <tr><td colSpan={9} style={{ padding: 26, textAlign: "center", color: "var(--text-muted)" }}>
                Sin inscripciones{data.length > 0 ? " en el filtro actual" : " todavía. Comparte el QR o el link del portal para recibir registros"}.
              </td></tr>
            ) : (
              filtrada.map((p) => (
                <tr key={p.id} style={{ borderTop: "1px solid var(--border)" }}>
                  <td style={{ padding: "7px 12px", fontWeight: 600 }}>{p.nombre} {p.apellido}</td>
                  <td style={{ padding: "7px 12px" }}>{p.telefono}</td>
                  <td style={{ padding: "7px 12px" }}>{p.correo}</td>
                  <td style={{ padding: "7px 12px" }}>{p.especialidad}</td>
                  <td style={{ padding: "7px 12px" }}>
                    {p.es_profesor ? (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                        <GraduationCap size={14} style={{ color: "var(--primary)" }} /> {p.universidad || "Sí"}
                      </span>
                    ) : "—"}
                  </td>
                  <td style={{ padding: "7px 12px" }}>
                    {p.confirma_asistencia
                      ? <Badge color="#16a34a" bg="#dcfce7">Confirmada</Badge>
                      : <Badge color="#b45309" bg="#fef3c7">Por confirmar</Badge>}
                  </td>
                  <td style={{ padding: "7px 12px" }}>
                    {p.correo_enviado
                      ? <Badge color="#16a34a" bg="#dcfce7">Correo enviado</Badge>
                      : <Badge color="#dc2626" bg="#fee2e2">Sin correo</Badge>}
                  </td>
                  <td style={{ padding: "7px 12px", color: "var(--text-muted)" }}>{fmtFecha(p.created_at)}</td>
                  <td style={{ padding: "7px 12px", textAlign: "right" }}>
                    <button
                      className="btn btn-sm btn-ghost"
                      title="Reenviar correo de confirmación"
                      style={{ padding: 5 }}
                      disabled={reenviandoId === p.id}
                      onClick={() => reenviarCorreo(p)}
                    >
                      <Mail size={14} />
                    </button>
                    <button
                      className="btn btn-sm btn-ghost"
                      title="Eliminar inscripción"
                      style={{ padding: 5, color: "var(--danger)" }}
                      onClick={() => eliminar(p)}
                    >
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Modal QR */}
      {mostrarQR && (
        <div
          onClick={(e) => { if (e.target === e.currentTarget) setMostrarQR(false); }}
          style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.55)", zIndex: 12000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
        >
          <div style={{ width: 380, maxWidth: "100%", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: 24, textAlign: "center" }}>
            <h3 style={{ margin: "0 0 4px", fontSize: 16, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
              <QrCode size={18} /> QR del portal de inscripción
            </h3>
            <p style={{ margin: "0 0 14px", fontSize: 12.5, color: "var(--text-muted)" }}>
              Imprímelo o compártelo: al escanearlo abre el formulario público del evento.
            </p>
            {qrDataUrl ? (
              <img src={qrDataUrl} alt="QR del portal del evento" style={{ width: 240, height: 240, borderRadius: 10, border: "1px solid var(--border)" }} />
            ) : (
              <div style={{ padding: 40, color: "var(--text-muted)" }}>Generando QR…</div>
            )}
            <div style={{ margin: "10px 0 14px", fontSize: 12.5, wordBreak: "break-all", color: "var(--text)" }}>
              {urlPortal}
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
              <button className="btn btn-primary" onClick={descargarQR} disabled={!qrDataUrl} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <Download size={14} /> Descargar PNG
              </button>
              <button className="btn btn-secondary" onClick={copiarLink} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <Copy size={14} /> Copiar link
              </button>
              <a className="btn btn-secondary" href={urlPortal} target="_blank" rel="noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <ExternalLink size={14} /> Abrir portal
              </a>
            </div>
            <div style={{ marginTop: 14 }}>
              <button className="btn btn-ghost" onClick={() => setMostrarQR(false)}>Cerrar</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal confirmación */}
      {confirmar && (
        <div
          onClick={(e) => { if (e.target === e.currentTarget) setConfirmar(null); }}
          style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.55)", zIndex: 12000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
        >
          <div style={{ width: 420, maxWidth: "100%", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: 22 }}>
            <h3 style={{ margin: "0 0 8px", fontSize: 15.5, fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}>
              <AlertTriangle size={17} style={{ color: "var(--danger)" }} /> {confirmar.title}
            </h3>
            <p style={{ margin: "0 0 16px", fontSize: 13.5, color: "var(--text-muted)" }}>{confirmar.message}</p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button className="btn btn-secondary" onClick={() => setConfirmar(null)}>Cancelar</button>
              <button
                className="btn btn-primary"
                style={{ background: "var(--danger)", borderColor: "var(--danger)" }}
                onClick={async () => { const fn = confirmar.onConfirm; setConfirmar(null); await fn(); }}
              >
                Eliminar
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{EVTADM_STYLES}</style>
    </div>
  );
}

/* Mismo patrón visual que las stat-cards del módulo Sorteo. */
const EVTADM_STYLES = `
.evtadm-stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 12px;
  margin: 16px 0;
}
.evtadm-stat {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px;
  border: 1px solid var(--border);
  background: var(--surface);
  border-radius: var(--radius);
  box-shadow: 0 1px 2px rgba(15,23,42,.03);
}
.evtadm-stat-icon {
  width: 40px; height: 40px;
  border-radius: 10px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.evtadm-stat-value {
  font-size: 22px; font-weight: 700; line-height: 1.1;
}
.evtadm-stat-label {
  font-size: 12px; color: var(--text-soft, var(--text-muted));
}
`;

function StatCard({ icon, label, value, tone = "teal" }) {
  const tones = {
    teal: { bg: "#e6f6f6", fg: "#1e9295" },
    green: { bg: "#dcfce7", fg: "#16a34a" },
    violet: { bg: "#ede9fe", fg: "#7c3aed" },
  };
  const t = tones[tone] || tones.teal;
  return (
    <div className="evtadm-stat">
      <div className="evtadm-stat-icon" style={{ background: t.bg, color: t.fg }}>
        {icon}
      </div>
      <div>
        <div className="evtadm-stat-value">{value}</div>
        <div className="evtadm-stat-label">{label}</div>
      </div>
    </div>
  );
}

function Badge({ color, bg, children }) {
  return (
    <span style={{ fontSize: 11.5, fontWeight: 600, color, background: bg, borderRadius: 999, padding: "3px 9px", whiteSpace: "nowrap" }}>
      {children}
    </span>
  );
}
