import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { supabase } from "../lib/supabase";
import useAuth from "../hooks/useAuth";
import Toast from "../components/Toast";
import ConfirmModal from "../components/ConfirmModal";
import ChatEquipo from "../components/ChatEquipo";
import { Plus, Pencil, Trash2, X, Search, MessageSquare, ClipboardList } from "lucide-react";

const ESTADOS = ["Pendiente", "Ingresada"];

function estadoBadgeStyle(estado) {
  if (estado === "Ingresada") {
    return { background: "#dcfce7", color: "#15803d", border: "1px solid #86efac" };
  }
  return { background: "#fef3c7", color: "#92400e", border: "1px solid #fcd34d" };
}

function formatearFechaHora(iso) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleString("es-CL", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export default function BitacoraCotizaciones() {
  const { user } = useAuth();
  const [registros, setRegistros] = useState([]);
  const [usuariosMap, setUsuariosMap] = useState({});
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);
  const [tab, setTab] = useState("chat");

  // Filtros
  const [filtroId, setFiltroId] = useState("");
  const [filtroEstado, setFiltroEstado] = useState("");
  const [filtroUsuario, setFiltroUsuario] = useState("");

  // Modal crear/editar
  const [modalOpen, setModalOpen] = useState(false);
  const [registroEditando, setRegistroEditando] = useState(null);

  // Modal eliminar
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [registroAEliminar, setRegistroAEliminar] = useState(null);

  async function cargar() {
    setLoading(true);
    try {
      const data = await api.get("/bitacora-cotizaciones");
      setRegistros(data || []);

      // Resolver nombres faltantes a través de perfiles
      const emails = Array.from(
        new Set((data || []).map((r) => r.creado_por_email).filter(Boolean))
      );
      if (emails.length > 0) {
        try {
          const perfiles = await api.post("/usuarios/profiles/by-emails", { emails });
          const mapa = {};
          (perfiles || []).forEach((p) => {
            mapa[(p.email || "").toLowerCase()] = p.nombre || p.full_name || p.email;
          });
          setUsuariosMap(mapa);
        } catch {
          /* fallback al email */
        }
      }
    } catch (e) {
      console.error(e);
      setToast({ type: "error", message: "No se pudo cargar la bitácora." });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    cargar();
  }, []);

  // Realtime: refresca el registro al instante cuando se crea/edita/elimina
  // una bitácora (p. ej. al registrar una licitación), sin recargar la página.
  useEffect(() => {
    const canal = supabase
      .channel("bitacora-cotizaciones-cambios")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "bitacora_cotizaciones" },
        () => { cargar(); },
      )
      .subscribe();
    return () => {
      try { supabase.removeChannel(canal); } catch { /* */ }
    };
  }, []);

  function nombreUsuario(reg) {
    if (reg.creado_por_nombre) return reg.creado_por_nombre;
    const email = (reg.creado_por_email || "").toLowerCase();
    return usuariosMap[email] || email || "—";
  }

  const registrosFiltrados = useMemo(() => {
    return registros.filter((r) => {
      if (filtroId && !(r.id_cotizacion || "").toLowerCase().includes(filtroId.toLowerCase())) return false;
      if (filtroEstado && r.estado !== filtroEstado) return false;
      if (filtroUsuario) {
        const nombre = (nombreUsuario(r) || "").toLowerCase();
        const email = (r.creado_por_email || "").toLowerCase();
        if (!nombre.includes(filtroUsuario.toLowerCase()) && !email.includes(filtroUsuario.toLowerCase())) {
          return false;
        }
      }
      return true;
    });
  }, [registros, filtroId, filtroEstado, filtroUsuario, usuariosMap]);

  const stats = useMemo(() => {
    return {
      total: registros.length,
      pendientes: registros.filter((r) => r.estado === "Pendiente").length,
      ingresadas: registros.filter((r) => r.estado === "Ingresada").length,
    };
  }, [registros]);

  function abrirNuevo() {
    setRegistroEditando(null);
    setModalOpen(true);
  }

  function abrirEditar(reg) {
    setRegistroEditando(reg);
    setModalOpen(true);
  }

  async function eliminarConfirmado() {
    if (!registroAEliminar) return;
    try {
      await api.delete(`/bitacora-cotizaciones/${registroAEliminar.id}`);
      setToast({ type: "success", message: "Registro eliminado." });
      cargar();
    } catch (e) {
      console.error(e);
      setToast({ type: "error", message: "No se pudo eliminar el registro." });
    } finally {
      setConfirmDeleteOpen(false);
      setRegistroAEliminar(null);
    }
  }

  return (
    <div className="page">
      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}

      <div className="page-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <h1 className="page-title">Chat Grupal</h1>
          <p className="page-subtitle">
            Conversación del equipo y registro de licitaciones tomadas.
          </p>
        </div>
        {tab === "registro" && (
          <button
            type="button"
            className="btn btn-primary"
            onClick={abrirNuevo}
            style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
          >
            <Plus size={14} /> Nuevo Registro
          </button>
        )}
      </div>

      {/* Pestañas */}
      <div
        style={{
          display: "flex",
          gap: 6,
          background: "#eef1f4",
          borderRadius: 11,
          padding: 4,
          marginBottom: 14,
          width: "fit-content",
        }}
      >
        <TabBitacora
          activo={tab === "chat"}
          onClick={() => setTab("chat")}
          icon={MessageSquare}
          label="Chat del equipo"
        />
        <TabBitacora
          activo={tab === "registro"}
          onClick={() => setTab("registro")}
          icon={ClipboardList}
          label="Registro"
        />
      </div>

      {tab === "chat" && <ChatEquipo onLicitacionRegistrada={cargar} />}

      {tab === "registro" && (
        <>
      {/* Stats */}
      <div className="stats-row">
        <div className="stat-card">
          <div className="stat-label">Total</div>
          <div className="stat-value">{stats.total}</div>
          <div className="stat-sub">registros</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Pendientes</div>
          <div className="stat-value" style={{ color: "#92400e" }}>{stats.pendientes}</div>
          <div className="stat-sub">por ingresar</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Ingresadas</div>
          <div className="stat-value" style={{ color: "#15803d" }}>{stats.ingresadas}</div>
          <div className="stat-sub">completadas</div>
        </div>
      </div>

      {/* Filtros */}
      <div className="filter-bar">
        <div className="filter-field">
          <label className="filter-label">ID Cotización</label>
          <div style={{ position: "relative" }}>
            <input
              className="input"
              value={filtroId}
              onChange={(e) => setFiltroId(e.target.value)}
              placeholder="Buscar por ID…"
              style={{ paddingLeft: 28 }}
            />
            <Search size={14} style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)" }} />
          </div>
        </div>
        <div className="filter-field">
          <label className="filter-label">Estado</label>
          <select className="input" value={filtroEstado} onChange={(e) => setFiltroEstado(e.target.value)}>
            <option value="">Todos</option>
            {ESTADOS.map((e) => <option key={e} value={e}>{e}</option>)}
          </select>
        </div>
        <div className="filter-field">
          <label className="filter-label">Usuario</label>
          <input
            className="input"
            value={filtroUsuario}
            onChange={(e) => setFiltroUsuario(e.target.value)}
            placeholder="Nombre o email…"
          />
        </div>
      </div>

      {/* Tabla */}
      <div className="table-wrap" style={{ marginTop: 12 }}>
        <div className="table-scroll" style={{ maxHeight: "calc(100vh - 360px)", minHeight: 240 }}>
          <table className="data-table" style={{ tableLayout: "fixed", width: "100%" }}>
            <colgroup>
              <col style={{ width: 180 }} />
              <col style={{ width: 110 }} />
              <col style={{ width: 200 }} />
              <col style={{ width: 160 }} />
              <col />
              <col style={{ width: 140 }} />
            </colgroup>
            <thead>
              <tr>
                <th>ID Cotización</th>
                <th>Estado</th>
                <th>Usuario</th>
                <th>Fecha y Hora</th>
                <th>Observaciones</th>
                <th style={{ textAlign: "right" }}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan="6" style={{ textAlign: "center", padding: 32, color: "var(--text-muted)" }}>Cargando…</td></tr>
              ) : registrosFiltrados.length === 0 ? (
                <tr><td colSpan="6" style={{ textAlign: "center", padding: 32, color: "var(--text-muted)" }}>
                  {registros.length === 0 ? "Aún no hay registros. Crea el primero." : "No hay registros con los filtros aplicados."}
                </td></tr>
              ) : registrosFiltrados.map((r) => (
                <tr key={r.id}>
                  <td style={{ fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={r.id_cotizacion}>
                    {r.id_cotizacion}
                  </td>
                  <td>
                    <span
                      style={{
                        display: "inline-block",
                        padding: "3px 10px",
                        borderRadius: 999,
                        fontSize: 11,
                        fontWeight: 600,
                        ...estadoBadgeStyle(r.estado),
                      }}
                    >
                      {r.estado}
                    </span>
                  </td>
                  <td style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={r.creado_por_email}>
                    {nombreUsuario(r)}
                  </td>
                  <td style={{ whiteSpace: "nowrap", fontSize: 13 }}>
                    {formatearFechaHora(r.created_at)}
                  </td>
                  <td style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={r.observaciones || ""}>
                    {r.observaciones || <span style={{ color: "var(--text-muted)" }}>—</span>}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <div className="btn-row" style={{ justifyContent: "flex-end" }}>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => abrirEditar(r)}
                        title="Editar"
                      >
                        <Pencil size={13} />
                      </button>
                      {(user?.email || "").toLowerCase() === (r.creado_por_email || "").toLowerCase() && (
                        <button
                          type="button"
                          className="btn btn-danger btn-sm"
                          onClick={() => { setRegistroAEliminar(r); setConfirmDeleteOpen(true); }}
                          title="Eliminar (solo tu propio registro)"
                        >
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
        </>
      )}

      {modalOpen && (
        <ModalRegistro
          registro={registroEditando}
          onClose={() => setModalOpen(false)}
          onSaved={() => { setModalOpen(false); cargar(); }}
          onToast={setToast}
        />
      )}

      <ConfirmModal
        open={confirmDeleteOpen}
        title="Eliminar registro"
        message="¿Eliminar este registro de la bitácora? Esta acción no se puede deshacer."
        onCancel={() => { setConfirmDeleteOpen(false); setRegistroAEliminar(null); }}
        onConfirm={eliminarConfirmado}
      />
    </div>
  );
}

function TabBitacora({ activo, onClick, icon: Icon, label }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 7,
        padding: "8px 16px",
        borderRadius: 8,
        border: "none",
        cursor: "pointer",
        fontSize: 13,
        fontWeight: 700,
        background: activo ? "#fff" : "transparent",
        color: activo ? "#0e7d83" : "#64748b",
        boxShadow: activo
          ? "0 1px 2px rgba(16,24,40,.12), 0 0 0 1px rgba(16,24,40,.04)"
          : "none",
        transition: "color .14s ease",
      }}
    >
      <Icon size={15} /> {label}
    </button>
  );
}

function ModalRegistro({ registro, onClose, onSaved, onToast }) {
  const editando = !!registro;
  const [idCot, setIdCot] = useState(registro?.id_cotizacion || "");
  const [idCot2, setIdCot2] = useState("");
  const [estado, setEstado] = useState(registro?.estado || "Pendiente");
  const [obs, setObs] = useState(registro?.observaciones || "");
  const [guardando, setGuardando] = useState(false);

  async function guardar() {
    if (!idCot.trim()) {
      onToast?.({ type: "error", message: "El ID de cotización es obligatorio." });
      return;
    }
    const segundo = idCot2.trim();
    if (!editando && segundo && segundo === idCot.trim()) {
      onToast?.({ type: "error", message: "Los dos IDs deben ser distintos." });
      return;
    }
    setGuardando(true);
    try {
      if (editando) {
        await api.put(`/bitacora-cotizaciones/${registro.id}`, {
          estado,
          observaciones: obs.trim() || null,
        });
        onToast?.({ type: "success", message: "Registro actualizado." });
      } else {
        await api.post("/bitacora-cotizaciones", {
          id_cotizacion: idCot.trim(),
          estado,
          observaciones: obs.trim() || null,
        });
        if (segundo) {
          await api.post("/bitacora-cotizaciones", {
            id_cotizacion: segundo,
            estado,
            observaciones: obs.trim() || null,
          });
        }
        onToast?.({
          type: "success",
          message: segundo ? "2 registros creados." : "Registro creado.",
        });
      }
      onSaved();
    } catch (e) {
      console.error(e);
      onToast?.({ type: "error", message: e?.message || "No se pudo guardar." });
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15,23,42,0.45)",
        zIndex: 9999,
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        padding: "8vh 16px",
        overflowY: "auto",
      }}
      onClick={(e) => { if (e.target === e.currentTarget && !guardando) onClose(); }}
    >
      <div
        style={{
          background: "var(--surface, #fff)",
          borderRadius: 12,
          padding: "22px 24px",
          width: "min(480px, 100%)",
          boxShadow: "0 20px 50px rgba(0,0,0,0.25)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <h3 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>
            {editando ? "Editar Registro" : "Nuevo Registro"}
          </h3>
          <button type="button" onClick={onClose} disabled={guardando} style={{ background: "transparent", border: "none", cursor: "pointer", padding: 4 }}>
            <X size={18} />
          </button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
              ID Cotización / Licitación *
            </label>
            <input
              type="text"
              className="input"
              value={idCot}
              onChange={(e) => setIdCot(e.target.value)}
              disabled={editando || guardando}
              placeholder="Ej: 1234-56-LR23"
              autoFocus={!editando}
            />
            {editando && (
              <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
                El ID no se puede editar después de crear el registro.
              </p>
            )}
          </div>

          {!editando && (
            <div>
              <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                Segundo ID <span style={{ fontWeight: 400, color: "var(--text-muted)" }}>(opcional)</span>
              </label>
              <input
                type="text"
                className="input"
                value={idCot2}
                onChange={(e) => setIdCot2(e.target.value)}
                disabled={guardando}
                placeholder="Otra licitación a registrar junto a la anterior"
              />
              <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
                Si lo completas, se crearán 2 registros con el mismo estado y observaciones.
              </p>
            </div>
          )}

          <div>
            <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
              Estado *
            </label>
            <select className="input" value={estado} onChange={(e) => setEstado(e.target.value)} disabled={guardando}>
              {ESTADOS.map((e) => <option key={e} value={e}>{e}</option>)}
            </select>
          </div>

          <div>
            <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
              Observaciones
            </label>
            <textarea
              className="input"
              value={obs}
              onChange={(e) => setObs(e.target.value)}
              disabled={guardando}
              placeholder="Notas opcionales…"
              rows={3}
              style={{ resize: "vertical", minHeight: 70 }}
            />
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 18 }}>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} disabled={guardando}>
            Cancelar
          </button>
          <button type="button" className="btn btn-primary btn-sm" onClick={guardar} disabled={guardando || !idCot.trim()}>
            {guardando ? "Guardando…" : (editando ? "Actualizar" : "Crear")}
          </button>
        </div>
      </div>
    </div>
  );
}
