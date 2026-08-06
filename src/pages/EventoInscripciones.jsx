import { useEffect, useMemo, useRef, useState } from "react";
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
  ChevronDown,
  AtSign,
} from "lucide-react";

/* ============================================================
   Submódulo: eventos AMSODENT (Santiago y Brasil).
   ─ Inscripciones: registros de los portales públicos /evento y
     /evento-brasil, con filtros (incluido evento), export a
     Excel, reenvío del correo de confirmación y eliminación.
   ─ Invitaciones: agregar correos y enviarles el correo de
     invitación (formato de marca) con el link al formulario del
     evento elegido; sale desde contacto@amsodentmedical.cl.
   ─ Tarjeta QR: genera el código con el link al portal del
     evento seleccionado (librería qrcode, local).
============================================================ */

// Debe calzar con EVENTOS del backend (eventos.service.ts).
const EVENTOS = [
  { key: "santiago", etiqueta: "Evento Santiago", ruta: "/evento" },
  { key: "brasil", etiqueta: "Evento Brasil", ruta: "/evento-brasil" },
];
const eventoInfo = (key) => EVENTOS.find((e) => e.key === key) || EVENTOS[0];

const fmtFecha = (iso) =>
  iso ? new Date(iso).toLocaleString("es-CL", { dateStyle: "short", timeStyle: "short" }) : "—";

export default function EventoInscripciones() {
  const [tab, setTab] = useState("inscripciones"); // inscripciones | invitaciones
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filtro, setFiltro] = useState("");
  const [filtroEvento, setFiltroEvento] = useState("");
  const [fechaDesde, setFechaDesde] = useState("");
  const [fechaHasta, setFechaHasta] = useState("");
  const [soloConfirmados, setSoloConfirmados] = useState(false);
  const [toast, setToast] = useState(null);
  const [confirmar, setConfirmar] = useState(null); // { title, message, onConfirm }
  const [reenviandoId, setReenviandoId] = useState(null);

  // Invitaciones: correos agregados a mano a los que se les envía el
  // correo con el link al formulario de inscripción.
  const [invitaciones, setInvitaciones] = useState([]);
  const [loadingInv, setLoadingInv] = useState(false);
  const [invCorreos, setInvCorreos] = useState("");
  const [invEvento, setInvEvento] = useState("santiago");
  const [agregando, setAgregando] = useState(false);
  const [reenviandoInvId, setReenviandoInvId] = useState(null);

  // QR del portal público del evento seleccionado. El link usa el dominio
  // actual de la plataforma (descargarlo desde producción, no localhost).
  const [qrEvento, setQrEvento] = useState("santiago");
  const urlPortal = `${window.location.origin}${eventoInfo(qrEvento).ruta}`;
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [mostrarQR, setMostrarQR] = useState(false);

  useEffect(() => {
    QRCode.toDataURL(urlPortal, { width: 480, margin: 2, color: { dark: "#0f172a" } })
      .then(setQrDataUrl)
      .catch(() => setQrDataUrl(""));
  }, [urlPortal]);

  useEffect(() => {
    cargar();
    cargarInvitaciones();
  }, []);

  // El envío de la invitación corre en segundo plano en el backend: mientras
  // haya filas "Enviando…" (sin enviado ni error) se re-consulta cada 4 s para
  // que el estado pase solo a "Enviada"/"Error" (con tope, por si el backend
  // nunca actualiza la fila).
  const pollsRef = useRef(0);
  useEffect(() => {
    const pendientes = invitaciones.some((i) => !i.enviado && !i.error);
    if (!pendientes) {
      pollsRef.current = 0;
      return;
    }
    if (pollsRef.current >= 20) return; // ~80 s; después queda el botón Actualizar
    const t = setTimeout(() => {
      pollsRef.current += 1;
      cargarInvitaciones(true);
    }, 4000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invitaciones]);

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

  // `silencioso` = refresco de fondo (sin spinner ni toast), usado por el
  // auto-refresh de las invitaciones en estado "Enviando…".
  async function cargarInvitaciones(silencioso = false) {
    if (!silencioso) setLoadingInv(true);
    try {
      const rows = await api.get("/eventos/invitaciones");
      setInvitaciones(Array.isArray(rows) ? rows : []);
    } catch (e) {
      if (silencioso) return;
      // Silencioso si falta la migración; el toast aparece al usar la pestaña.
      setInvitaciones([]);
      if (tab === "invitaciones") {
        setToast({ type: "error", message: e?.message || "Error cargando invitaciones." });
      }
    } finally {
      if (!silencioso) setLoadingInv(false);
    }
  }

  // Agrega los correos pegados (separados por coma, espacio o salto de línea)
  // y dispara el envío de la invitación del evento elegido.
  async function agregarInvitaciones() {
    const correos = invCorreos
      .split(/[\s,;]+/)
      .map((c) => c.trim())
      .filter(Boolean);
    if (correos.length === 0) {
      setToast({ type: "error", message: "Pega al menos un correo." });
      return;
    }
    setAgregando(true);
    try {
      const res = await api.post("/eventos/invitaciones", { evento: invEvento, correos });
      const partes = [];
      if (res?.agregados) partes.push(`${res.agregados} invitación(es) enviándose`);
      if (res?.duplicados) partes.push(`${res.duplicados} ya estaban agregadas`);
      if (res?.invalidos) partes.push(`${res.invalidos} correo(s) inválido(s)`);
      setToast({ type: res?.agregados ? "success" : "info", message: partes.join(" · ") || "Sin cambios." });
      setInvCorreos("");
      pollsRef.current = 0; // reinicia el auto-refresh para las recién agregadas
      await cargarInvitaciones();
    } catch (e) {
      setToast({ type: "error", message: e?.message || "No se pudieron agregar los correos." });
    } finally {
      setAgregando(false);
    }
  }

  async function reenviarInvitacion(inv) {
    setReenviandoInvId(inv.id);
    try {
      await api.post(`/eventos/invitaciones/${inv.id}/reenviar`, {});
      setInvitaciones((prev) => prev.map((x) => (x.id === inv.id ? { ...x, enviado: true, error: null, enviado_at: new Date().toISOString() } : x)));
      setToast({ type: "success", message: `Invitación enviada a ${inv.correo}.` });
    } catch (e) {
      setToast({ type: "error", message: e?.message || "No se pudo enviar la invitación." });
      cargarInvitaciones();
    } finally {
      setReenviandoInvId(null);
    }
  }

  function eliminarInvitacion(inv) {
    setConfirmar({
      title: "Eliminar invitación",
      message: `¿Quitar a ${inv.correo} del listado de invitaciones (${eventoInfo(inv.evento).etiqueta})?`,
      onConfirm: async () => {
        try {
          await api.delete(`/eventos/invitaciones/${inv.id}`);
          setInvitaciones((prev) => prev.filter((x) => x.id !== inv.id));
          setToast({ type: "success", message: "Invitación eliminada." });
        } catch (e) {
          setToast({ type: "error", message: e?.message || "No se pudo eliminar." });
        }
      },
    });
  }

  const filtrada = useMemo(() => {
    const q = filtro.trim().toLowerCase();
    const desde = fechaDesde ? new Date(`${fechaDesde}T00:00:00`) : null;
    const hasta = fechaHasta ? new Date(`${fechaHasta}T23:59:59.999`) : null;
    return data.filter((p) => {
      if (filtroEvento && (p.evento || "santiago") !== filtroEvento) return false;
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
  }, [data, filtro, filtroEvento, fechaDesde, fechaHasta, soloConfirmados]);

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
      Evento: eventoInfo(p.evento || "santiago").etiqueta,
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
    a.download = `qr_evento_${qrEvento}_amsodent.png`;
    a.click();
  }

  return (
    <div className="page">
      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}

      <div className="page-header">
        <div>
          <h1 className="page-title" style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <CalendarCheck size={22} style={{ color: "var(--primary)" }} />
            Eventos · Santiago y Brasil
          </h1>
          <p className="page-subtitle">
            {stats.total} inscrito{stats.total !== 1 ? "s" : ""} · portales públicos /evento y /evento-brasil
          </p>
        </div>
        <div className="page-actions" style={{ gap: 8 }}>
          <button className="btn btn-secondary" onClick={() => setMostrarQR(true)}>
            <QrCode size={14} />
            QR del portal
          </button>
          <button className="btn btn-secondary" onClick={() => { cargar(); cargarInvitaciones(); }} disabled={loading}>
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
        <StatCard icon={<Mail size={18} />} label="Invitaciones enviadas" value={invitaciones.filter((i) => i.enviado).length} tone="teal" />
      </div>

      {/* Pestañas */}
      <div style={{ display: "inline-flex", borderRadius: 9, overflow: "hidden", border: "1px solid var(--border)", marginBottom: 4 }}>
        {[
          ["inscripciones", `Inscripciones (${data.length})`],
          ["invitaciones", `Invitaciones (${invitaciones.length})`],
        ].map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            style={{
              padding: "7px 18px", fontSize: 13, fontWeight: 700, cursor: "pointer", border: "none",
              background: tab === key ? "var(--primary)" : "var(--surface)",
              color: tab === key ? "#fff" : "var(--text-muted)",
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "inscripciones" && (
      <>
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
          <label className="filter-label">Evento</label>
          <select className="input" value={filtroEvento} onChange={(e) => setFiltroEvento(e.target.value)} style={{ minWidth: 150 }}>
            <option value="">Todos</option>
            {EVENTOS.map((ev) => (
              <option key={ev.key} value={ev.key}>{ev.etiqueta}</option>
            ))}
          </select>
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
              <th style={{ padding: "9px 12px" }}>Evento</th>
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
              <tr><td colSpan={10} style={{ padding: 26, textAlign: "center", color: "var(--text-muted)" }}>Cargando inscripciones…</td></tr>
            ) : filtrada.length === 0 ? (
              <tr><td colSpan={10} style={{ padding: 26, textAlign: "center", color: "var(--text-muted)" }}>
                Sin inscripciones{data.length > 0 ? " en el filtro actual" : " todavía. Comparte el QR o el link del portal para recibir registros"}.
              </td></tr>
            ) : (
              filtrada.map((p) => (
                <tr key={p.id} style={{ borderTop: "1px solid var(--border)" }}>
                  <td style={{ padding: "7px 12px" }}>
                    {(p.evento || "santiago") === "brasil"
                      ? <Badge color="#7c3aed" bg="#ede9fe">Brasil</Badge>
                      : <Badge color="#1e9295" bg="#e6f6f6">Santiago</Badge>}
                  </td>
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
      </>
      )}

      {tab === "invitaciones" && (
      <>
      {/* Agregar correos: se envía la invitación del evento elegido */}
      <div style={{ border: "1px solid var(--border)", borderRadius: 10, background: "var(--surface)", padding: "14px 16px", marginTop: 12 }}>
        <div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 4 }}>Agregar correos e invitar</div>
        <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginBottom: 10 }}>
          Pega uno o varios correos (separados por coma, espacio o salto de línea), elige el evento y
          se les enviará el correo de invitación con el link a su formulario de inscripción
          desde <b>contacto@amsodentmedical.cl</b>.
        </div>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div style={{ flex: 2, minWidth: 280 }}>
            <label className="filter-label">Correos</label>
            <div className="evtadm-inputwrap is-area">
              <AtSign size={15} className="evtadm-input-ic" />
              <textarea
                className="evtadm-textarea"
                placeholder={"doctor@clinica.cl, otra@correo.cl\nuna@porlinea.cl"}
                value={invCorreos}
                onChange={(e) => setInvCorreos(e.target.value)}
              />
            </div>
          </div>
          <div style={{ minWidth: 210 }}>
            <label className="filter-label">Evento (formulario que recibirá)</label>
            <div className="evtadm-inputwrap">
              <CalendarCheck size={15} className="evtadm-input-ic" />
              <select className="evtadm-select" value={invEvento} onChange={(e) => setInvEvento(e.target.value)}>
                {EVENTOS.map((ev) => (
                  <option key={ev.key} value={ev.key}>{ev.etiqueta}</option>
                ))}
              </select>
              <ChevronDown size={15} className="evtadm-select-chevron" aria-hidden />
            </div>
          </div>
          <button
            className="btn btn-primary"
            onClick={agregarInvitaciones}
            disabled={agregando || !invCorreos.trim()}
            style={{ display: "inline-flex", alignItems: "center", gap: 7, height: 46, borderRadius: 12, padding: "0 20px" }}
          >
            <Mail size={14} /> {agregando ? "Agregando…" : "Agregar y enviar"}
          </button>
        </div>
      </div>

      {/* Tabla de invitaciones */}
      <div style={{ border: "1px solid var(--border)", borderRadius: 10, overflowX: "auto", background: "var(--surface)", marginTop: 12 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, whiteSpace: "nowrap" }}>
          <thead>
            <tr style={{ background: "var(--bg)", color: "var(--text-muted)", textAlign: "left" }}>
              <th style={{ padding: "9px 12px" }}>Correo</th>
              <th style={{ padding: "9px 12px" }}>Evento</th>
              <th style={{ padding: "9px 12px" }}>Estado</th>
              <th style={{ padding: "9px 12px" }}>Agregado por</th>
              <th style={{ padding: "9px 12px" }}>Agregado</th>
              <th style={{ padding: "9px 12px" }} />
            </tr>
          </thead>
          <tbody>
            {loadingInv ? (
              <tr><td colSpan={6} style={{ padding: 26, textAlign: "center", color: "var(--text-muted)" }}>Cargando invitaciones…</td></tr>
            ) : invitaciones.length === 0 ? (
              <tr><td colSpan={6} style={{ padding: 26, textAlign: "center", color: "var(--text-muted)" }}>
                Aún no agregas correos. Pega los correos arriba, elige el evento y presiona "Agregar y enviar".
              </td></tr>
            ) : (
              invitaciones.map((inv) => (
                <tr key={inv.id} style={{ borderTop: "1px solid var(--border)" }}>
                  <td style={{ padding: "7px 12px", fontWeight: 600 }}>{inv.correo}</td>
                  <td style={{ padding: "7px 12px" }}>
                    {inv.evento === "brasil"
                      ? <Badge color="#7c3aed" bg="#ede9fe">Brasil</Badge>
                      : <Badge color="#1e9295" bg="#e6f6f6">Santiago</Badge>}
                  </td>
                  <td style={{ padding: "7px 12px" }}>
                    {inv.enviado ? (
                      <Badge color="#16a34a" bg="#dcfce7">Enviada{inv.enviado_at ? ` · ${fmtFecha(inv.enviado_at)}` : ""}</Badge>
                    ) : inv.error ? (
                      <span title={inv.error}><Badge color="#dc2626" bg="#fee2e2">Error al enviar</Badge></span>
                    ) : (
                      <Badge color="#b45309" bg="#fef3c7">Enviando…</Badge>
                    )}
                  </td>
                  <td style={{ padding: "7px 12px", color: "var(--text-muted)" }}>{inv.agregado_por || "—"}</td>
                  <td style={{ padding: "7px 12px", color: "var(--text-muted)" }}>{fmtFecha(inv.created_at)}</td>
                  <td style={{ padding: "7px 12px", textAlign: "right" }}>
                    <button
                      className="btn btn-sm btn-ghost"
                      title="Enviar / reenviar la invitación"
                      style={{ padding: 5 }}
                      disabled={reenviandoInvId === inv.id}
                      onClick={() => reenviarInvitacion(inv)}
                    >
                      <Mail size={14} />
                    </button>
                    <button
                      className="btn btn-sm btn-ghost"
                      title="Eliminar invitación"
                      style={{ padding: 5, color: "var(--danger)" }}
                      onClick={() => eliminarInvitacion(inv)}
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
      </>
      )}

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
            <p style={{ margin: "0 0 10px", fontSize: 12.5, color: "var(--text-muted)" }}>
              Imprímelo o compártelo: al escanearlo abre el formulario público del evento.
            </p>
            <div style={{ display: "inline-flex", borderRadius: 9, overflow: "hidden", border: "1px solid var(--border)", marginBottom: 12 }}>
              {EVENTOS.map((ev) => (
                <button
                  key={ev.key}
                  type="button"
                  onClick={() => setQrEvento(ev.key)}
                  style={{
                    padding: "6px 14px", fontSize: 12.5, fontWeight: 700, cursor: "pointer", border: "none",
                    background: qrEvento === ev.key ? "var(--primary)" : "var(--surface)",
                    color: qrEvento === ev.key ? "#fff" : "var(--text-muted)",
                  }}
                >
                  {ev.etiqueta}
                </button>
              ))}
            </div>
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

/* Inputs custom del panel de invitaciones: mismo lenguaje visual del portal
   /evento (icono adentro, bordes redondeados y anillo de foco teal). */
.evtadm-inputwrap { position: relative; display: block; }
.evtadm-input-ic {
  position: absolute;
  left: 14px;
  top: 50%;
  transform: translateY(-50%);
  color: #98a2b3;
  pointer-events: none;
  transition: color .15s;
}
.evtadm-inputwrap.is-area .evtadm-input-ic { top: 16px; transform: none; }
.evtadm-inputwrap:focus-within .evtadm-input-ic { color: #1e9295; }

.evtadm-textarea,
.evtadm-select {
  width: 100%;
  border: 1.5px solid var(--border);
  border-radius: 12px;
  background: var(--bg, #f8fafc);
  color: var(--text);
  font-size: 13.5px;
  font-family: inherit;
  outline: none;
  transition: border-color .15s, box-shadow .15s, background .15s;
}
.evtadm-textarea {
  min-height: 74px;
  resize: vertical;
  padding: 11px 14px 11px 40px;
  line-height: 1.5;
}
.evtadm-select {
  appearance: none;
  -webkit-appearance: none;
  height: 46px;
  padding: 0 38px 0 40px;
  cursor: pointer;
  font-weight: 600;
}
.evtadm-textarea::placeholder { color: #98a2b3; }
.evtadm-textarea:focus,
.evtadm-select:focus {
  border-color: #28aeb1;
  background: var(--surface, #fff);
  box-shadow: 0 0 0 4px rgba(40, 174, 177, .14);
}
.evtadm-select-chevron {
  position: absolute;
  right: 13px;
  top: 50%;
  transform: translateY(-50%);
  color: #98a2b3;
  pointer-events: none;
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
