import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api";
import * as XLSX from "xlsx";
import Toast from "../components/Toast";
import DateFilter from "../components/DateFilter";
import {
  Gift,
  Users,
  Search,
  Download,
  Shuffle,
  Crown,
  Trash2,
  RefreshCw,
  Mail,
  Calendar,
  AlertTriangle,
  GraduationCap,
  Building2,
} from "lucide-react";

export default function SorteoRegistros() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filtro, setFiltro] = useState("");
  const [fechaDesde, setFechaDesde] = useState("");
  const [fechaHasta, setFechaHasta] = useState("");
  const [toast, setToast] = useState(null);

  // Ganador animado
  const [sorteando, setSorteando] = useState(false);
  const [ganador, setGanador] = useState(null);
  const [rolling, setRolling] = useState(null); // para animación "ruleta"
  const [mostrarModalGanador, setMostrarModalGanador] = useState(false);

  // Modal de confirmación custom
  const [confirmar, setConfirmar] = useState(null);
  // shape: { title, message, confirmText, tone: "danger"|"warning", onConfirm: () => Promise<void>|void }

  useEffect(() => {
    cargar();
  }, []);

  async function cargar() {
    setLoading(true);
    try {
      const rows = await api.get("/sorteo/participantes");
      setData(rows || []);
    } catch (e) {
      setToast({ type: "error", message: e.message || "Error cargando participantes." });
    } finally {
      setLoading(false);
    }
  }

  const filtrada = useMemo(() => {
    const q = filtro.trim().toLowerCase();
    const desde = fechaDesde ? new Date(`${fechaDesde}T00:00:00`) : null;
    const hasta = fechaHasta ? new Date(`${fechaHasta}T23:59:59.999`) : null;
    return data.filter((p) => {
      if (q) {
        const hay = [p.nombre, p.email, p.universidad_clinica].map((x) =>
          String(x || "").toLowerCase()
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
  }, [data, filtro, fechaDesde, fechaHasta]);

  const hoyIso = new Date().toISOString().slice(0, 10);
  const totalRegistros = data.length;
  const totalHoy = data.filter(
    (p) => p.created_at && p.created_at.slice(0, 10) === hoyIso
  ).length;
  const totalEstudiantes = data.filter((p) => p.tipo_perfil === "estudiante").length;
  const totalEgresados = data.filter((p) => p.tipo_perfil === "egresado").length;
  const yaGanador = data.find((p) => p.ganador);

  async function sortearGanador() {
    if (sorteando) return;
    const elegibles = data.filter((p) => p.acepta_uso_datos && !p.ganador);
    if (elegibles.length === 0) {
      setToast({ type: "error", message: "No hay participantes elegibles para sortear." });
      return;
    }

    setSorteando(true);
    setGanador(null);
    setMostrarModalGanador(true);

    // Animación tipo ruleta local de ~2.8s
    let i = 0;
    const totalFrames = 28;
    const interval = setInterval(() => {
      const pick = elegibles[Math.floor(Math.random() * elegibles.length)];
      setRolling(pick);
      i += 1;
      if (i >= totalFrames) {
        clearInterval(interval);
      }
    }, 90);

    try {
      // En paralelo hacemos el sorteo real en el backend
      const [elegido] = await Promise.all([
        api.post("/sorteo/sortear", {}),
        new Promise((r) => setTimeout(r, totalFrames * 90 + 200)),
      ]);
      setRolling(null);
      setGanador(elegido);
      // Actualiza flag en la data local
      setData((prev) =>
        prev.map((p) =>
          p.id === elegido.id ? { ...p, ganador: true, fecha_ganador: elegido.fecha_ganador } : p
        )
      );
    } catch (e) {
      clearInterval(interval);
      setMostrarModalGanador(false);
      setToast({ type: "error", message: e.message || "No se pudo sortear." });
    } finally {
      setSorteando(false);
    }
  }

  function pedirResetGanadores() {
    setConfirmar({
      title: "Reiniciar ganadores",
      message: "Todos los participantes volverán a quedar elegibles para un nuevo sorteo. ¿Continuar?",
      confirmText: "Reiniciar",
      tone: "warning",
      onConfirm: async () => {
        try {
          await api.post("/sorteo/reset-ganadores", {});
          setData((prev) => prev.map((p) => ({ ...p, ganador: false, fecha_ganador: null })));
          setToast({ type: "success", message: "Ganadores reiniciados." });
        } catch (e) {
          setToast({ type: "error", message: e.message || "Error al reiniciar." });
        }
      },
    });
  }

  function pedirEliminar(p) {
    setConfirmar({
      title: "Eliminar participante",
      message: `Se eliminará a ${p.nombre} del sorteo. Esta acción no se puede deshacer.`,
      confirmText: "Eliminar",
      tone: "danger",
      onConfirm: async () => {
        try {
          await api.delete(`/sorteo/participantes/${p.id}`);
          setData((prev) => prev.filter((x) => x.id !== p.id));
          setToast({ type: "success", message: "Participante eliminado." });
        } catch (e) {
          setToast({ type: "error", message: e.message || "Error al eliminar." });
        }
      },
    });
  }

  function exportarXLSX() {
    const rows = filtrada.map((p) => ({
      ID: p.id,
      Nombre: p.nombre,
      Email: p.email,
      Perfil: p.tipo_perfil === "estudiante" ? "Estudiante" : "Egresado",
      "Universidad / Clínica": p.universidad_clinica || "",
      "Nos conocía": p.conocia_amsodent ? "Sí" : "No",
      "Acepta uso datos": p.acepta_uso_datos ? "Sí" : "No",
      "Acepta comunicaciones": p.acepta_comunicaciones ? "Sí" : "No",
      Ganador: p.ganador ? "Sí" : "No",
      "Fecha registro": p.created_at ? new Date(p.created_at).toLocaleString("es-CL") : "",
      "IP origen": p.ip_origen || "",
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Participantes");
    XLSX.writeFile(wb, `sorteo-participantes-${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  return (
    <div className="page">
      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}

      <div className="page-header">
        <div>
          <h1 className="page-title" style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Gift size={22} style={{ color: "var(--primary)" }} />
            Sorteo · Participantes
          </h1>
          <p className="page-subtitle">
            {totalRegistros} registro{totalRegistros !== 1 ? "s" : ""} totales
          </p>
        </div>
        <div className="page-actions" style={{ gap: 8 }}>
          <button className="btn btn-secondary" onClick={cargar} disabled={loading}>
            <RefreshCw size={14} />
            Actualizar
          </button>
          <button className="btn btn-secondary" onClick={exportarXLSX} disabled={filtrada.length === 0}>
            <Download size={14} />
            Exportar XLSX
          </button>
          <button
            className="sorteo-admin-btn-win"
            onClick={sortearGanador}
            disabled={sorteando || totalRegistros === 0}
          >
            <Shuffle size={16} />
            {sorteando ? "Sorteando…" : "Elegir ganador"}
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="sorteo-stats">
        <StatCard
          icon={<Users size={18} />}
          label="Inscritos totales"
          value={totalRegistros}
          tone="blue"
        />
        <StatCard
          icon={<Calendar size={18} />}
          label="Inscritos hoy"
          value={totalHoy}
          tone="violet"
        />
        <StatCard
          icon={<GraduationCap size={18} />}
          label="Estudiantes"
          value={totalEstudiantes}
          tone="blue"
        />
        <StatCard
          icon={<Building2 size={18} />}
          label="Egresados"
          value={totalEgresados}
          tone="green"
        />
      </div>

      {/* Filtros */}
      <div className="sorteo-admin-toolbar">
        <div className="sorteo-filters-left">
          <div className="sorteo-search">
            <Search size={14} />
            <input
              type="text"
              placeholder="Buscar por nombre, correo o universidad/clínica…"
              value={filtro}
              onChange={(e) => setFiltro(e.target.value)}
            />
          </div>

          <div className="sorteo-date-range">
            <span className="sorteo-date-label">Desde</span>
            <DateFilter
              value={fechaDesde}
              onChange={setFechaDesde}
              maxDate={fechaHasta ? new Date(`${fechaHasta}T00:00:00`) : undefined}
            />
            <span className="sorteo-date-label">Hasta</span>
            <DateFilter
              value={fechaHasta}
              onChange={setFechaHasta}
              minDate={fechaDesde ? new Date(`${fechaDesde}T00:00:00`) : undefined}
            />
          </div>
        </div>

        {yaGanador && (
          <button className="btn btn-ghost" onClick={pedirResetGanadores} title="Reiniciar ganadores">
            <RefreshCw size={14} />
            Reiniciar ganadores
          </button>
        )}
      </div>

      {/* Tabla */}
      <div className="table-wrap">
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ width: 56 }}>#</th>
                <th>Nombre</th>
                <th>Correo</th>
                <th style={{ width: 130 }}>Perfil</th>
                <th>Universidad / Clínica</th>
                <th style={{ width: 110 }}>Nos conocía</th>
                <th style={{ width: 170 }}>Registro</th>
                <th style={{ width: 80 }}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8} style={{ textAlign: "center", padding: 30, opacity: 0.6 }}>
                    Cargando participantes…
                  </td>
                </tr>
              ) : filtrada.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ textAlign: "center", padding: 40, opacity: 0.6 }}>
                    {filtro ? "Sin resultados para el filtro." : "Aún no hay participantes."}
                  </td>
                </tr>
              ) : (
                filtrada.map((p) => (
                  <tr
                    key={p.id}
                    className={p.ganador ? "sorteo-row-winner" : ""}
                  >
                    <td style={{ opacity: 0.55, fontVariantNumeric: "tabular-nums" }}>
                      {p.id}
                    </td>
                    <td>
                      <div style={{ fontWeight: 600 }}>{p.nombre}</div>
                      {p.ganador && (
                        <span className="sorteo-winner-chip">
                          <Crown size={11} /> GANADOR
                        </span>
                      )}
                    </td>
                    <td>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12.5 }}>
                        <Mail size={12} style={{ color: "var(--primary)" }} />
                        {p.email}
                      </span>
                    </td>
                    <td>
                      {p.tipo_perfil === "estudiante" ? (
                        <span className="badge badge-primary">
                          <GraduationCap size={11} style={{ marginRight: 3 }} />
                          Estudiante
                        </span>
                      ) : p.tipo_perfil === "egresado" ? (
                        <span className="badge badge-success">
                          <Building2 size={11} style={{ marginRight: 3 }} />
                          Egresado
                        </span>
                      ) : (
                        <span className="badge badge-neutral">—</span>
                      )}
                    </td>
                    <td style={{ fontSize: 13, color: "var(--text-soft)", maxWidth: 220 }}>
                      {p.universidad_clinica || "—"}
                    </td>
                    <td>
                      {p.conocia_amsodent ? (
                        <span className="badge badge-success">Sí</span>
                      ) : (
                        <span className="badge badge-neutral">No</span>
                      )}
                    </td>
                    <td style={{ fontSize: 12.5, color: "var(--text-soft)", whiteSpace: "nowrap" }}>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                        <Calendar size={12} />
                        {p.created_at ? new Date(p.created_at).toLocaleString("es-CL") : "—"}
                      </span>
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <button
                        className="btn btn-sm btn-ghost"
                        onClick={() => pedirEliminar(p)}
                        title="Eliminar"
                      >
                        <Trash2 size={13} />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal ganador */}
      {mostrarModalGanador && (
        <GanadorModal
          rolling={rolling}
          ganador={ganador}
          onClose={() => {
            setMostrarModalGanador(false);
            setGanador(null);
            setRolling(null);
          }}
        />
      )}

      {/* Modal de confirmación custom */}
      {confirmar && (
        <ConfirmarModal
          {...confirmar}
          onCancel={() => setConfirmar(null)}
          onDone={() => setConfirmar(null)}
        />
      )}

      <style>{ADMIN_STYLES}</style>
    </div>
  );
}

/* ──────────────────────────────── Sub-componentes ──────────────────────────────── */

function StatCard({ icon, label, value, tone = "blue" }) {
  const tones = {
    blue:   { bg: "var(--primary-light)", fg: "var(--primary-dark)" },
    green:  { bg: "linear-gradient(135deg,#ecfdf5,#d1fae5)", fg: "#047857" },
    violet: { bg: "linear-gradient(135deg,#e8f7f7,#b2e4e5)", fg: "#1e9295" },
    gold:   { bg: "linear-gradient(135deg,#fefce8,#fef3c7)", fg: "#b45309" },
  };
  const t = tones[tone] || tones.blue;
  return (
    <div className="sorteo-stat">
      <div className="sorteo-stat-icon" style={{ background: t.bg, color: t.fg }}>
        {icon}
      </div>
      <div>
        <div className="sorteo-stat-value">{value}</div>
        <div className="sorteo-stat-label">{label}</div>
      </div>
    </div>
  );
}

function ConfirmarModal({ title, message, confirmText, tone = "danger", onConfirm, onCancel, onDone }) {
  const [trabajando, setTrabajando] = useState(false);

  const tones = {
    danger:  { iconBg: "#fee2e2", iconFg: "#dc2626", btnClass: "sorteo-confirm-btn-danger" },
    warning: { iconBg: "#fef3c7", iconFg: "#d97706", btnClass: "sorteo-confirm-btn-warning" },
  };
  const t = tones[tone] || tones.danger;

  async function ejecutar() {
    if (trabajando) return;
    setTrabajando(true);
    try {
      await onConfirm?.();
      onDone?.();
    } finally {
      setTrabajando(false);
    }
  }

  return (
    <div
      className="sorteo-modal-back"
      onClick={trabajando ? undefined : onCancel}
    >
      <div
        className="sorteo-confirm-card"
        onClick={(e) => e.stopPropagation()}
        role="alertdialog"
        aria-labelledby="sorteo-confirm-title"
      >
        <div className="sorteo-confirm-icon" style={{ background: t.iconBg, color: t.iconFg }}>
          <AlertTriangle size={26} />
        </div>
        <h3 id="sorteo-confirm-title" className="sorteo-confirm-title">
          {title}
        </h3>
        <p className="sorteo-confirm-message">{message}</p>
        <div className="sorteo-confirm-actions">
          <button
            className="btn btn-ghost"
            onClick={onCancel}
            disabled={trabajando}
          >
            Cancelar
          </button>
          <button
            className={t.btnClass}
            onClick={ejecutar}
            disabled={trabajando}
          >
            {trabajando ? "Procesando…" : confirmText || "Confirmar"}
          </button>
        </div>
      </div>
    </div>
  );
}

function GanadorModal({ rolling, ganador, onClose }) {
  const confettiPieces = useMemo(() => {
    const colors = ["#28aeb1", "#1e9295", "#b2e4e5", "#f59e0b", "#fde68a", "#fb7185"];
    return Array.from({ length: 90 }).map((_, i) => ({
      left: `${Math.random() * 100}%`,
      delay: `${Math.random() * 0.8}s`,
      duration: `${1.8 + Math.random() * 2.2}s`,
      color: colors[i % colors.length],
      rotate: `${Math.random() * 360}deg`,
    }));
  }, [ganador?.id]);

  return (
    <div className="sorteo-modal-back" onClick={ganador ? onClose : undefined}>
      <div className="sorteo-modal-card" onClick={(e) => e.stopPropagation()}>
        {ganador && (
          <div className="sorteo-modal-confetti" aria-hidden>
            {confettiPieces.map((p, i) => (
              <span
                key={i}
                style={{
                  left: p.left,
                  background: p.color,
                  animationDelay: p.delay,
                  animationDuration: p.duration,
                  transform: `rotate(${p.rotate})`,
                }}
              />
            ))}
          </div>
        )}

        <div className={`sorteo-modal-crown ${ganador ? "is-revealed" : ""}`}>
          <Crown size={42} />
        </div>

        <h2 className="sorteo-modal-title">
          {ganador ? "¡Tenemos ganador!" : "Sorteando…"}
        </h2>

        <div className={`sorteo-reel ${ganador ? "is-revealed" : ""}`}>
          <div className="sorteo-reel-name">
            {ganador ? ganador.nombre : rolling?.nombre || "—"}
          </div>
          <div className="sorteo-reel-email">
            {ganador ? ganador.email : rolling?.email || ""}
          </div>
        </div>

        {ganador && (
          <>
            <div className="sorteo-modal-details">
              {ganador.tipo_perfil === "estudiante" && (
                <div>
                  <GraduationCap size={12} /> Estudiante
                </div>
              )}
              {ganador.tipo_perfil === "egresado" && (
                <div>
                  <Building2 size={12} /> {ganador.universidad_clinica || "Egresado"}
                </div>
              )}
              <div>
                <Calendar size={12} />{" "}
                {ganador.fecha_ganador
                  ? new Date(ganador.fecha_ganador).toLocaleString("es-CL")
                  : new Date().toLocaleString("es-CL")}
              </div>
            </div>
            <button className="btn btn-primary" onClick={onClose} style={{ marginTop: 18 }}>
              Cerrar
            </button>
          </>
        )}

        {!ganador && <div className="sorteo-modal-hint">Eligiendo al azar entre los participantes elegibles…</div>}
      </div>
    </div>
  );
}

/* ──────────────────────────────── Estilos ──────────────────────────────── */

const ADMIN_STYLES = `
.sorteo-stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 12px;
  margin: 16px 0;
}
.sorteo-stat {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px;
  border: 1px solid var(--border);
  background: var(--surface);
  border-radius: var(--radius);
  box-shadow: 0 1px 2px rgba(15,23,42,.03);
}
.sorteo-stat-icon {
  width: 40px; height: 40px;
  border-radius: 10px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.sorteo-stat-value {
  font-size: 22px; font-weight: 700; line-height: 1.1;
}
.sorteo-stat-label {
  font-size: 12px; color: var(--text-soft);
}

.sorteo-admin-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  margin: 10px 0 14px;
  flex-wrap: wrap;
}
.sorteo-search {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 0 12px;
  height: 38px;
  flex: 1;
  max-width: 380px;
}
.sorteo-search input {
  border: none;
  outline: none;
  background: transparent;
  flex: 1;
  font-size: 13px;
  color: var(--text);
}

/* Agrupación izquierda: search + fechas */
.sorteo-filters-left {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  flex: 1;
}

/* Filtro de fechas (usa DateFilter custom) */
.sorteo-date-range {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-wrap: nowrap;
}
.sorteo-date-label {
  font-size: 12px;
  color: var(--text-soft);
  font-weight: 600;
  letter-spacing: .02em;
}

/* Botón sortear gradient */
.sorteo-admin-btn-win {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 0 16px;
  height: 38px;
  border: none;
  border-radius: 10px;
  cursor: pointer;
  color: #fff;
  font-weight: 600;
  font-size: 13.5px;
  background: linear-gradient(135deg,var(--primary-dark),var(--primary),#f59e0b);
  background-size: 200% 100%;
  box-shadow: 0 8px 20px -8px rgba(40,174,177,.6);
  transition: transform .18s, box-shadow .18s, background-position .6s;
  overflow: hidden;
}
.sorteo-admin-btn-win:hover:not(:disabled) {
  background-position: 100% 0;
  transform: translateY(-1px);
}
.sorteo-admin-btn-win:disabled { opacity: .6; cursor: not-allowed; }

/* Fila del ganador resaltada */
.sorteo-row-winner td {
  background: linear-gradient(90deg, #fef3c7 0%, #fffbeb 60%, transparent 100%);
  box-shadow: inset 3px 0 0 #f59e0b;
}

/* Winner chip en tabla */
.sorteo-winner-chip {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  margin-top: 4px;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: .08em;
  background: linear-gradient(135deg,#fef3c7,#fde68a);
  color: #92400e;
  border: 1px solid #f59e0b55;
}

/* ---------- Modal ganador ---------- */
.sorteo-modal-back {
  position: fixed;
  inset: 0;
  z-index: 9999;
  background: rgba(2,6,23,.72);
  backdrop-filter: blur(6px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  animation: sorteo-fade-in .25s ease both;
}
@keyframes sorteo-fade-in { from { opacity: 0; } to { opacity: 1; } }

.sorteo-modal-card {
  position: relative;
  width: 100%;
  max-width: 480px;
  background: #fff;
  border-radius: 20px;
  padding: 36px 28px 28px;
  text-align: center;
  box-shadow: 0 40px 80px -20px rgba(0,0,0,.6);
  overflow: hidden;
  animation: sorteo-modal-in .45s cubic-bezier(.16,1,.3,1) both;
}

/* ---------- Confirmación ---------- */
.sorteo-confirm-card {
  position: relative;
  width: 100%;
  max-width: 440px;
  background: #fff;
  border-radius: 18px;
  padding: 28px 26px 22px;
  text-align: center;
  box-shadow: 0 30px 70px -15px rgba(0,0,0,.45);
  animation: sorteo-modal-in .32s cubic-bezier(.16,1,.3,1) both;
}
.sorteo-confirm-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 56px;
  height: 56px;
  border-radius: 50%;
  margin-bottom: 14px;
  animation: sorteo-pop-soft .4s cubic-bezier(.25,1.4,.45,1) both;
}
@keyframes sorteo-pop-soft {
  0% { transform: scale(.4); opacity: 0; }
  70% { transform: scale(1.08); }
  100% { transform: scale(1); opacity: 1; }
}
.sorteo-confirm-title {
  margin: 0 0 8px;
  font-size: 18px;
  font-weight: 700;
  color: var(--text, #1a1d23);
  letter-spacing: -.01em;
}
.sorteo-confirm-message {
  margin: 0 0 22px;
  color: var(--text-soft, #6b7280);
  font-size: 14px;
  line-height: 1.55;
}
.sorteo-confirm-actions {
  display: flex;
  gap: 10px;
  justify-content: flex-end;
}
.sorteo-confirm-btn-danger,
.sorteo-confirm-btn-warning {
  height: 38px;
  padding: 0 18px;
  border: none;
  border-radius: 10px;
  cursor: pointer;
  color: #fff;
  font-weight: 600;
  font-size: 13.5px;
  transition: transform .15s, box-shadow .15s, filter .15s;
}
.sorteo-confirm-btn-danger {
  background: linear-gradient(135deg, #ef4444, #dc2626);
  box-shadow: 0 8px 18px -8px rgba(220,38,38,.55);
}
.sorteo-confirm-btn-warning {
  background: linear-gradient(135deg, #f59e0b, #d97706);
  box-shadow: 0 8px 18px -8px rgba(245,158,11,.55);
}
.sorteo-confirm-btn-danger:hover:not(:disabled),
.sorteo-confirm-btn-warning:hover:not(:disabled) {
  transform: translateY(-1px);
  filter: brightness(1.05);
}
.sorteo-confirm-btn-danger:disabled,
.sorteo-confirm-btn-warning:disabled {
  opacity: .65;
  cursor: not-allowed;
}
@keyframes sorteo-modal-in {
  from { opacity: 0; transform: translateY(20px) scale(.96); }
  to   { opacity: 1; transform: translateY(0) scale(1); }
}

.sorteo-modal-crown {
  display: inline-flex;
  padding: 14px;
  border-radius: 50%;
  background: linear-gradient(135deg,#fef3c7,#fde68a);
  color: #b45309;
  margin-bottom: 12px;
  animation: sorteo-spin-slow 2s linear infinite;
}
.sorteo-modal-crown.is-revealed {
  animation: sorteo-crown-pop .6s cubic-bezier(.25,1.4,.45,1) both;
  box-shadow: 0 0 0 6px rgba(245,158,11,.15), 0 0 40px rgba(245,158,11,.5);
}
@keyframes sorteo-spin-slow { to { transform: rotate(360deg); } }
@keyframes sorteo-crown-pop {
  0% { transform: scale(.3); }
  70% { transform: scale(1.15); }
  100% { transform: scale(1); }
}

.sorteo-modal-title {
  margin: 0 0 18px;
  font-size: 22px;
  font-weight: 800;
  background: linear-gradient(135deg,var(--primary-dark),#f59e0b);
  -webkit-background-clip: text;
          background-clip: text;
  color: transparent;
}

.sorteo-reel {
  padding: 20px 14px;
  border-radius: 14px;
  background: linear-gradient(135deg,#f8fafc,#f1f5f9);
  border: 1.5px dashed #cbd5e1;
  margin-bottom: 4px;
  transition: all .4s;
}
.sorteo-reel.is-revealed {
  background: linear-gradient(135deg,#fefce8,#fef3c7);
  border: 1.5px solid #f59e0b;
  box-shadow: 0 0 0 4px rgba(245,158,11,.15);
  animation: sorteo-reveal-pop .5s cubic-bezier(.25,1.4,.45,1) both;
}
@keyframes sorteo-reveal-pop {
  0% { transform: scale(.96); }
  60% { transform: scale(1.04); }
  100% { transform: scale(1); }
}
.sorteo-reel-name {
  font-size: 22px;
  font-weight: 800;
  color: #0f172a;
  letter-spacing: -.01em;
  animation: sorteo-reel-flip .12s ease;
}
.sorteo-reel.is-revealed .sorteo-reel-name {
  animation: none;
  font-size: 26px;
}
.sorteo-reel-email {
  margin-top: 4px;
  font-size: 13px;
  color: #475569;
}
@keyframes sorteo-reel-flip {
  from { opacity: .4; transform: translateY(-6px); }
  to   { opacity: 1; transform: translateY(0); }
}

.sorteo-modal-details {
  display: flex;
  justify-content: center;
  gap: 16px;
  margin-top: 14px;
  color: #475569;
  font-size: 12.5px;
}
.sorteo-modal-details > div {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.sorteo-modal-hint {
  margin-top: 14px;
  color: #64748b;
  font-size: 12.5px;
  font-style: italic;
}

/* Confetti modal */
.sorteo-modal-confetti {
  position: absolute;
  inset: 0;
  pointer-events: none;
  overflow: hidden;
}
.sorteo-modal-confetti span {
  position: absolute;
  top: -20px;
  width: 9px;
  height: 16px;
  border-radius: 2px;
  animation: sorteo-modal-fall linear forwards;
}
@keyframes sorteo-modal-fall {
  to { transform: translateY(620px) rotate(720deg); opacity: 0; }
}
`;
