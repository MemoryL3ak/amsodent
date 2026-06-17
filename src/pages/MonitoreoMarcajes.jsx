import { useEffect, useMemo, useRef, useState } from "react";
import Select from "react-select";
import { api } from "../lib/api";
import useAuth from "../hooks/useAuth";
import Toast from "../components/Toast";
import {
  Users,
  MapPin,
  Search,
  Filter,
  LogIn,
  LogOut,
  AlertTriangle,
  Building2,
  Pencil,
  Trash2,
  Plus,
  X,
  ExternalLink,
  Download,
  RefreshCw,
} from "lucide-react";

const TEAL = "#25b7bd";
const TEAL_OSC = "#178a8f";
const TEAL_DEEP = "#0e6e74";
const TEAL_SOFT = "#e8f7f7";
const TEAL_MID = "#b2e4e5";
const ROJO = "#dc2626";

function hoyISO() {
  return new Date().toISOString().slice(0, 10);
}
function hace7DiasISO() {
  const d = new Date();
  d.setDate(d.getDate() - 7);
  return d.toISOString().slice(0, 10);
}

function fmtFechaHora(d) {
  if (!d) return "—";
  return new Date(d).toLocaleString("es-CL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function MonitoreoMarcajes() {
  const { rol, cargando: cargandoAuth } = useAuth();
  const esAdmin = String(rol || "").trim().toLowerCase() === "admin" || String(rol || "").trim().toLowerCase() === "administrador";

  const [filtroDesde, setFiltroDesde] = useState(hace7DiasISO());
  const [filtroHasta, setFiltroHasta] = useState(hoyISO());
  const [filtroEmail, setFiltroEmail] = useState("");
  const [filtroTipo, setFiltroTipo] = useState("");
  const [soloFueraRadio, setSoloFueraRadio] = useState(false);

  const [marcajes, setMarcajes] = useState([]);
  const [cargandoData, setCargandoData] = useState(false);
  const [toast, setToast] = useState(null);

  const [oficinas, setOficinas] = useState([]);
  const [oficinaEdit, setOficinaEdit] = useState(null); // null | "new" | row
  const [guardandoOficina, setGuardandoOficina] = useState(false);
  const [trabajadores, setTrabajadores] = useState([]); // perfiles para asignar a oficinas

  useEffect(() => {
    api.get("/usuarios/profiles").then((d) => setTrabajadores(d || [])).catch(() => {});
  }, []);

  // ============================================================
  // Cargar marcajes
  // ============================================================
  async function cargar() {
    if (!esAdmin) return;
    setCargandoData(true);
    try {
      const qs = new URLSearchParams();
      if (filtroDesde) qs.set("desde", filtroDesde);
      if (filtroHasta) qs.set("hasta", filtroHasta);
      if (filtroEmail) qs.set("email", filtroEmail);
      if (filtroTipo) qs.set("tipo", filtroTipo);
      if (soloFueraRadio) qs.set("fuera_de_radio", "true");
      const data = await api.get(`/marcajes?${qs.toString()}`);
      setMarcajes(data || []);
    } catch (e) {
      console.error(e);
      setToast({ type: "error", message: e?.message || "No se pudieron cargar los marcajes." });
    } finally {
      setCargandoData(false);
    }
  }

  async function cargarOficinas() {
    try {
      const data = await api.get(`/marcajes/oficinas`);
      setOficinas(data || []);
    } catch (e) {
      console.error(e);
    }
  }

  useEffect(() => {
    if (cargandoAuth) return;
    if (!esAdmin) return;
    cargar();
    cargarOficinas();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cargandoAuth, esAdmin]);

  // ============================================================
  // KPIs derivados
  // ============================================================
  const kpis = useMemo(() => {
    const total = marcajes.length;
    const entradas = marcajes.filter((m) => m.tipo === "entrada").length;
    const salidas = marcajes.filter((m) => m.tipo === "salida").length;
    const fuera = marcajes.filter((m) => m.fuera_de_radio).length;
    const usuariosUnicos = new Set(marcajes.map((m) => m.user_email)).size;
    return { total, entradas, salidas, fuera, usuariosUnicos };
  }, [marcajes]);

  // ============================================================
  // Acciones oficinas
  // ============================================================
  function nuevaOficina() {
    setOficinaEdit({
      id: null,
      nombre: "",
      direccion: "",
      latitud: "",
      longitud: "",
      radio_metros: 200,
      activa: true,
      trabajadores: [],
    });
  }

  // Editar oficina existente: cargamos sus trabajadores asignados.
  function editarOficina(o) {
    setOficinaEdit({ ...o, trabajadores: [] });
    api
      .get(`/marcajes/oficinas/${o.id}/trabajadores`)
      .then((emails) =>
        setOficinaEdit((prev) =>
          prev && prev.id === o.id ? { ...prev, trabajadores: Array.isArray(emails) ? emails : [] } : prev,
        ),
      )
      .catch(() => {});
  }

  async function guardarOficina() {
    if (!oficinaEdit) return;
    const payload = {
      nombre: oficinaEdit.nombre,
      direccion: oficinaEdit.direccion || "",
      latitud: Number(oficinaEdit.latitud),
      longitud: Number(oficinaEdit.longitud),
      radio_metros: Number(oficinaEdit.radio_metros),
      activa: oficinaEdit.activa,
    };
    if (!payload.nombre.trim()) {
      setToast({ type: "error", message: "Ingresa un nombre." });
      return;
    }
    if (!Number.isFinite(payload.latitud) || !Number.isFinite(payload.longitud)) {
      setToast({ type: "error", message: "Latitud y longitud deben ser válidas." });
      return;
    }
    setGuardandoOficina(true);
    try {
      let oficinaId = oficinaEdit.id;
      if (oficinaEdit.id) {
        await api.put(`/marcajes/oficinas/${oficinaEdit.id}`, payload);
      } else {
        const creada = await api.post(`/marcajes/oficinas`, payload);
        oficinaId = creada?.id;
      }
      // Persistir los trabajadores asignados (tolerante si la tabla no está migrada).
      if (oficinaId) {
        try {
          await api.put(`/marcajes/oficinas/${oficinaId}/trabajadores`, {
            emails: oficinaEdit.trabajadores || [],
          });
        } catch (errT) {
          console.error("No se pudieron guardar los trabajadores asignados:", errT);
        }
      }
      setOficinaEdit(null);
      await cargarOficinas();
      setToast({ type: "success", message: "Oficina guardada." });
    } catch (e) {
      console.error(e);
      setToast({ type: "error", message: e?.message || "No se pudo guardar." });
    } finally {
      setGuardandoOficina(false);
    }
  }

  async function eliminarOficina(id) {
    if (!confirm("¿Eliminar esta oficina? Los marcajes pasados se mantienen pero sin oficina asociada.")) return;
    try {
      await api.delete(`/marcajes/oficinas/${id}`);
      await cargarOficinas();
      setToast({ type: "success", message: "Oficina eliminada." });
    } catch (e) {
      console.error(e);
      setToast({ type: "error", message: "No se pudo eliminar." });
    }
  }

  // ============================================================
  // Render
  // ============================================================
  if (cargandoAuth) return <div className="page" style={{ padding: 24 }}>Cargando…</div>;
  if (!esAdmin) {
    return (
      <div className="page" style={{ padding: 24 }}>
        <div className="surface">
          <div className="surface-body" style={{ color: ROJO }}>
            Acceso restringido: este módulo es solo para administradores.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page" style={{ padding: "16px 20px 32px" }}>
      <style>{ESTILOS_MM}</style>
      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}

      {/* Header */}
      <div
        style={{
          background: "#fff",
          borderRadius: 18,
          padding: "22px 26px",
          marginBottom: 20,
          border: "1px solid #e7eef0",
          boxShadow: "0 6px 18px -10px rgba(15,23,42,.18)",
          position: "relative",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            position: "absolute", top: -50, right: -50, width: 180, height: 180,
            borderRadius: "50%",
            background: `radial-gradient(circle, ${TEAL}25, transparent 70%)`,
          }}
        />
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 11.5, textTransform: "uppercase", letterSpacing: ".15em", color: TEAL_DEEP, fontWeight: 700 }}>
              Asistencia
            </div>
            <h1 style={{ fontSize: 24, fontWeight: 800, color: "#0f172a", margin: "4px 0 0" }}>
              Monitoreo de Marcajes
            </h1>
            <p style={{ fontSize: 13, color: "#64748b", margin: "4px 0 0" }}>
              Registros de entrada y salida de los trabajadores con su ubicación.
            </p>
          </div>
          <button
            type="button"
            onClick={() => { cargar(); cargarOficinas(); }}
            className="mm-btn-pri"
          >
            <RefreshCw size={14} /> Refrescar
          </button>
        </div>
      </div>

      {/* KPIs */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
          gap: 12,
          marginBottom: 20,
        }}
      >
        <KpiCard color={TEAL} icon={Users} title="Marcajes" value={kpis.total} sub="en el rango filtrado" />
        <KpiCard color="#16a34a" icon={LogIn} title="Entradas" value={kpis.entradas} />
        <KpiCard color="#0369a1" icon={LogOut} title="Salidas" value={kpis.salidas} />
        <KpiCard color="#d97706" icon={AlertTriangle} title="Fuera de radio" value={kpis.fuera} alarma={kpis.fuera > 0} />
        <KpiCard color="#7c3aed" icon={Users} title="Trabajadores" value={kpis.usuariosUnicos} sub="únicos en el periodo" />
      </div>

      {/* Oficinas */}
      <div
        style={{
          background: "#fff",
          borderRadius: 16,
          border: "1px solid #e7eef0",
          marginBottom: 20,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "14px 20px",
            borderBottom: "1px solid #eef2f5",
            background: "linear-gradient(180deg, #fafdfd 0%, #ffffff 100%)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Building2 size={17} style={{ color: TEAL }} />
            <div style={{ fontSize: 13, fontWeight: 800, color: TEAL_DEEP, textTransform: "uppercase", letterSpacing: ".1em" }}>
              Oficinas autorizadas
            </div>
          </div>
          <button type="button" onClick={nuevaOficina} className="mm-btn-pri-sm">
            <Plus size={13} /> Nueva oficina
          </button>
        </div>

        {oficinas.length === 0 ? (
          <div style={{ padding: 24, color: "#64748b", fontSize: 13, textAlign: "center" }}>
            No hay oficinas configuradas. Crea una para validar el radio de los marcajes.
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "#f8fafc", color: "#475569", fontSize: 11, textTransform: "uppercase", letterSpacing: ".05em" }}>
                <th style={thS}>Nombre</th>
                <th style={thS}>Coordenadas</th>
                <th style={thS}>Radio</th>
                <th style={thS}>Estado</th>
                <th style={thS}></th>
              </tr>
            </thead>
            <tbody>
              {oficinas.map((o) => (
                <tr key={o.id} style={{ borderTop: "1px solid #f1f5f9" }}>
                  <td style={tdS}>
                    <div style={{ fontWeight: 700, color: "#0f172a" }}>{o.nombre}</div>
                    {o.direccion ? <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>{o.direccion}</div> : null}
                  </td>
                  <td style={tdS}>
                    <a
                      href={`https://www.google.com/maps?q=${o.latitud},${o.longitud}`}
                      target="_blank"
                      rel="noreferrer"
                      style={{ color: TEAL_OSC, fontFamily: "ui-monospace, monospace", fontSize: 12 }}
                    >
                      {Number(o.latitud).toFixed(5)}, {Number(o.longitud).toFixed(5)} <ExternalLink size={10} style={{ display: "inline" }} />
                    </a>
                  </td>
                  <td style={tdS}>{o.radio_metros} m</td>
                  <td style={tdS}>
                    <span
                      style={{
                        padding: "3px 8px",
                        borderRadius: 999,
                        background: o.activa ? "#dcfce7" : "#fee2e2",
                        color: o.activa ? "#15803d" : ROJO,
                        fontSize: 11,
                        fontWeight: 700,
                      }}
                    >
                      {o.activa ? "Activa" : "Inactiva"}
                    </span>
                  </td>
                  <td style={{ ...tdS, textAlign: "right" }}>
                    <button type="button" onClick={() => editarOficina(o)} className="mm-btn-ghost" title="Editar">
                      <Pencil size={13} />
                    </button>
                    <button type="button" onClick={() => eliminarOficina(o.id)} className="mm-btn-ghost mm-btn-danger" title="Eliminar">
                      <Trash2 size={13} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Filtros */}
      <div
        style={{
          background: "#fff",
          borderRadius: 16,
          padding: 16,
          border: "1px solid #e7eef0",
          marginBottom: 16,
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
          gap: 12,
          alignItems: "end",
        }}
      >
        <div>
          <label style={lblF}>Desde</label>
          <input type="date" className="mm-input" value={filtroDesde} onChange={(e) => setFiltroDesde(e.target.value)} />
        </div>
        <div>
          <label style={lblF}>Hasta</label>
          <input type="date" className="mm-input" value={filtroHasta} onChange={(e) => setFiltroHasta(e.target.value)} />
        </div>
        <div>
          <label style={lblF}>Email</label>
          <div style={{ position: "relative" }}>
            <Search size={13} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "#94a3b8" }} />
            <input
              type="text"
              className="mm-input"
              style={{ paddingLeft: 30 }}
              value={filtroEmail}
              onChange={(e) => setFiltroEmail(e.target.value)}
              placeholder="Buscar email…"
            />
          </div>
        </div>
        <div>
          <label style={lblF}>Tipo</label>
          <select className="mm-input" value={filtroTipo} onChange={(e) => setFiltroTipo(e.target.value)}>
            <option value="">Todos</option>
            <option value="entrada">Entrada</option>
            <option value="salida">Salida</option>
          </select>
        </div>
        <div>
          <label style={lblF}>Filtro</label>
          <label
            style={{
              display: "flex", alignItems: "center", gap: 8, height: 38, padding: "0 12px",
              border: `1.5px solid ${soloFueraRadio ? "#d97706" : "#e2e8f0"}`,
              background: soloFueraRadio ? "#fef3c7" : "#fff",
              borderRadius: 8, cursor: "pointer", fontSize: 12.5, fontWeight: 600,
              color: soloFueraRadio ? "#92400e" : "#475569",
            }}
          >
            <input
              type="checkbox"
              checked={soloFueraRadio}
              onChange={(e) => setSoloFueraRadio(e.target.checked)}
              style={{ accentColor: "#d97706" }}
            />
            Solo fuera de radio
          </label>
        </div>
        <button type="button" onClick={cargar} className="mm-btn-pri" disabled={cargandoData}>
          <Filter size={14} /> {cargandoData ? "Cargando…" : "Aplicar filtros"}
        </button>
      </div>

      {/* Tabla de marcajes */}
      <div style={{ background: "#fff", borderRadius: 16, border: "1px solid #e7eef0", overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
            <thead>
              <tr style={{ background: "#f8fafc", color: "#475569", fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".05em" }}>
                <th style={thS}>Trabajador</th>
                <th style={thS}>Tipo</th>
                <th style={thS}>Fecha / Hora</th>
                <th style={thS}>Ubicación</th>
                <th style={thS}>Distancia</th>
                <th style={thS}>Estado</th>
              </tr>
            </thead>
            <tbody>
              {marcajes.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ padding: 40, textAlign: "center", color: "#94a3b8", fontSize: 13 }}>
                    {cargandoData ? "Cargando marcajes…" : "Sin marcajes con esos filtros."}
                  </td>
                </tr>
              ) : (
                marcajes.map((m) => (
                  <tr key={m.id} style={{ borderTop: "1px solid #f1f5f9", background: m.fuera_de_radio ? "#fffbeb" : "transparent" }}>
                    <td style={tdS}>
                      <div style={{ fontWeight: 700, color: "#0f172a" }}>
                        {m.user_nombre || m.user_email.split("@")[0]}
                      </div>
                      <div style={{ fontSize: 10.5, color: "#94a3b8" }}>{m.user_email}</div>
                    </td>
                    <td style={tdS}>
                      <span
                        style={{
                          display: "inline-flex", alignItems: "center", gap: 5,
                          padding: "3px 9px", borderRadius: 999,
                          background: m.tipo === "entrada" ? "#dcfce7" : "#e0f2fe",
                          color: m.tipo === "entrada" ? "#15803d" : "#0369a1",
                          fontSize: 11, fontWeight: 700, textTransform: "capitalize",
                        }}
                      >
                        {m.tipo === "entrada" ? <LogIn size={11} /> : <LogOut size={11} />}
                        {m.tipo}
                      </span>
                    </td>
                    <td style={tdS}>{fmtFechaHora(m.marcado_at)}</td>
                    <td style={tdS}>
                      {m.latitud != null && m.longitud != null ? (
                        <div style={{ maxWidth: 320 }}>
                          {m.direccion && (
                            <div
                              style={{
                                fontSize: 12,
                                color: "#0f172a",
                                fontWeight: 600,
                                marginBottom: 2,
                                lineHeight: 1.35,
                                wordBreak: "break-word",
                              }}
                            >
                              <MapPin
                                size={11}
                                style={{ color: TEAL, display: "inline", marginRight: 3, marginBottom: -1 }}
                              />
                              {m.direccion}
                            </div>
                          )}
                          <a
                            href={`https://www.google.com/maps?q=${m.latitud},${m.longitud}`}
                            target="_blank"
                            rel="noreferrer"
                            style={{
                              color: TEAL_OSC,
                              fontFamily: "ui-monospace, monospace",
                              fontSize: 10.5,
                              textDecoration: "none",
                            }}
                          >
                            {Number(m.latitud).toFixed(4)}, {Number(m.longitud).toFixed(4)}
                            <ExternalLink size={9} style={{ display: "inline", marginLeft: 3 }} />
                          </a>
                        </div>
                      ) : (
                        <span style={{ color: "#94a3b8" }}>—</span>
                      )}
                    </td>
                    <td style={tdS}>
                      {m.distancia_m != null ? (
                        <span style={{ color: m.fuera_de_radio ? "#92400e" : "#475569", fontWeight: m.fuera_de_radio ? 700 : 500 }}>
                          {m.distancia_m} m
                        </span>
                      ) : (
                        <span style={{ color: "#94a3b8" }}>—</span>
                      )}
                    </td>
                    <td style={tdS}>
                      {m.fuera_de_radio ? (
                        <span
                          style={{
                            display: "inline-flex", alignItems: "center", gap: 4,
                            padding: "3px 8px", borderRadius: 999,
                            background: "#fef3c7", color: "#92400e",
                            fontSize: 10.5, fontWeight: 700,
                          }}
                        >
                          <AlertTriangle size={11} /> Fuera de radio
                        </span>
                      ) : (
                        <span
                          style={{
                            padding: "3px 8px", borderRadius: 999,
                            background: "#dcfce7", color: "#15803d",
                            fontSize: 10.5, fontWeight: 700,
                          }}
                        >
                          OK
                        </span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal editar oficina */}
      {oficinaEdit && (
        <div
          onMouseDown={(e) => { if (e.target === e.currentTarget) setOficinaEdit(null); }}
          style={{
            position: "fixed", inset: 0, background: "rgba(15,23,42,.55)",
            backdropFilter: "blur(4px)", zIndex: 11000,
            display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
          }}
        >
          <div style={{ width: 460, maxWidth: "100%", background: "#fff", borderRadius: 16, overflow: "hidden", boxShadow: "0 32px 80px -16px rgba(15,23,42,.45)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 20px", background: `linear-gradient(135deg, ${TEAL} 0%, ${TEAL_OSC} 100%)`, color: "#fff" }}>
              <div style={{ fontWeight: 800, fontSize: 15 }}>
                {oficinaEdit.id ? "Editar oficina" : "Nueva oficina"}
              </div>
              <button type="button" onClick={() => setOficinaEdit(null)} style={{ background: "rgba(255,255,255,.18)", border: "none", color: "#fff", cursor: "pointer", padding: 7, borderRadius: 7, display: "inline-flex" }}>
                <X size={16} />
              </button>
            </div>
            <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 12 }}>
              <div>
                <label style={lblM}>Nombre</label>
                <input
                  type="text"
                  className="mm-input"
                  value={oficinaEdit.nombre}
                  onChange={(e) => setOficinaEdit((o) => ({ ...o, nombre: e.target.value }))}
                  placeholder="Ej: Oficina central"
                />
              </div>
              <div>
                <label style={lblM}>Dirección</label>
                <BuscadorDireccion
                  value={oficinaEdit.direccion || ""}
                  disabled={guardandoOficina}
                  onChange={(v) => setOficinaEdit((o) => ({ ...o, direccion: v }))}
                  onPick={({ direccion, lat, lng }) =>
                    setOficinaEdit((o) => ({
                      ...o,
                      direccion,
                      latitud: Number.isFinite(lat) ? lat : o.latitud,
                      longitud: Number.isFinite(lng) ? lng : o.longitud,
                    }))
                  }
                />
                <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 4 }}>
                  Escribe la dirección y elígela de la lista; se completan latitud y longitud automáticamente.
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div>
                  <label style={lblM}>Latitud</label>
                  <input
                    type="number"
                    step="any"
                    className="mm-input"
                    value={oficinaEdit.latitud}
                    onChange={(e) => setOficinaEdit((o) => ({ ...o, latitud: e.target.value }))}
                    placeholder="-33.4489"
                  />
                </div>
                <div>
                  <label style={lblM}>Longitud</label>
                  <input
                    type="number"
                    step="any"
                    className="mm-input"
                    value={oficinaEdit.longitud}
                    onChange={(e) => setOficinaEdit((o) => ({ ...o, longitud: e.target.value }))}
                    placeholder="-70.6693"
                  />
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (!("geolocation" in navigator)) return;
                  navigator.geolocation.getCurrentPosition(
                    (pos) =>
                      setOficinaEdit((o) => ({
                        ...o,
                        latitud: pos.coords.latitude.toFixed(6),
                        longitud: pos.coords.longitude.toFixed(6),
                      })),
                    () => setToast({ type: "error", message: "No se pudo obtener la ubicación." }),
                  );
                }}
                className="mm-btn-ghost"
                style={{ alignSelf: "flex-start" }}
              >
                <MapPin size={13} /> Usar mi ubicación actual
              </button>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div>
                  <label style={lblM}>Radio (m)</label>
                  <input
                    type="number"
                    min="10"
                    className="mm-input"
                    value={oficinaEdit.radio_metros}
                    onChange={(e) => setOficinaEdit((o) => ({ ...o, radio_metros: e.target.value }))}
                  />
                </div>
                <div>
                  <label style={lblM}>Estado</label>
                  <select
                    className="mm-input"
                    value={oficinaEdit.activa ? "1" : "0"}
                    onChange={(e) => setOficinaEdit((o) => ({ ...o, activa: e.target.value === "1" }))}
                  >
                    <option value="1">Activa</option>
                    <option value="0">Inactiva</option>
                  </select>
                </div>
              </div>
              <div>
                <label style={lblM}>Trabajadores que marcan aquí</label>
                <Select
                  isMulti
                  options={trabajadores.map((t) => ({
                    value: (t.email || "").trim().toLowerCase(),
                    label: t.nombre ? `${t.nombre} (${t.email})` : t.email,
                  }))}
                  value={(oficinaEdit.trabajadores || []).map((em) => {
                    const t = trabajadores.find((x) => (x.email || "").trim().toLowerCase() === em);
                    return { value: em, label: t?.nombre ? `${t.nombre} (${t.email})` : em };
                  })}
                  onChange={(ops) => setOficinaEdit((o) => ({ ...o, trabajadores: (ops || []).map((x) => x.value) }))}
                  placeholder="Selecciona trabajadores…"
                  noOptionsMessage={() => "Sin trabajadores"}
                  menuPortalTarget={document.body}
                  styles={{ menuPortal: (base) => ({ ...base, zIndex: 9999 }) }}
                  isDisabled={guardandoOficina}
                />
                <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 4 }}>
                  Solo estos trabajadores quedarán dentro de radio al marcar en esta oficina. Si un trabajador no tiene oficina asignada, su marca queda fuera de radio.
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 6 }}>
                <button type="button" onClick={() => setOficinaEdit(null)} className="mm-btn-ghost">
                  Cancelar
                </button>
                <button type="button" onClick={guardarOficina} disabled={guardandoOficina} className="mm-btn-pri">
                  {guardandoOficina ? "Guardando…" : "Guardar"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function KpiCard({ title, value, sub, color, icon: Icon, alarma }) {
  return (
    <div
      style={{
        background: "#fff",
        borderRadius: 14,
        border: `1px solid ${alarma ? "#fde68a" : "#e7eef0"}`,
        padding: "14px 16px",
        position: "relative",
        overflow: "hidden",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".12em", color: "#64748b", fontWeight: 700 }}>
          {title}
        </div>
        <div
          style={{
            width: 28, height: 28, borderRadius: 8,
            background: `${color}18`, color, display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >
          <Icon size={14} />
        </div>
      </div>
      <div style={{ fontSize: 24, fontWeight: 800, color: "#0f172a", marginTop: 6, lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

const thS = { padding: "10px 14px", textAlign: "left", fontWeight: 700 };
const tdS = { padding: "10px 14px", color: "#334155" };
const lblF = { display: "block", fontSize: 11, color: "#475569", fontWeight: 600, marginBottom: 4, textTransform: "uppercase", letterSpacing: ".05em" };
const lblM = { display: "block", fontSize: 12, color: "#475569", fontWeight: 600, marginBottom: 4 };

const ESTILOS_MM = `
.mm-input {
  width: 100%; height: 38px; padding: 0 12px;
  border-radius: 8px; border: 1.5px solid #e2e8f0;
  font-size: 13px; outline: none; background: #fff; box-sizing: border-box;
  transition: border-color .15s, box-shadow .15s;
}
.mm-input:focus { border-color: ${TEAL}; box-shadow: 0 0 0 3px rgba(37,183,189,.15); }

.mm-btn-pri, .mm-btn-pri-sm {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 0 14px; height: 38px; border-radius: 9px;
  background: linear-gradient(135deg, ${TEAL} 0%, ${TEAL_OSC} 100%);
  color: #fff; font-weight: 700; font-size: 12.5px;
  border: none; cursor: pointer;
  box-shadow: 0 3px 10px -2px rgba(37,183,189,.45);
  transition: transform .15s, box-shadow .15s;
}
.mm-btn-pri-sm { height: 32px; padding: 0 10px; font-size: 11.5px; }
.mm-btn-pri:hover:not(:disabled), .mm-btn-pri-sm:hover:not(:disabled) { transform: translateY(-1px); }
.mm-btn-pri:disabled { opacity: .55; cursor: not-allowed; }

.mm-btn-ghost {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 6px 10px; border-radius: 7px;
  background: transparent; color: #475569; border: 1px solid #e2e8f0;
  cursor: pointer; font-size: 12px; font-weight: 600;
  margin-left: 4px; transition: background .12s, color .12s;
}
.mm-btn-ghost:hover { background: ${TEAL_SOFT}; color: ${TEAL_DEEP}; border-color: ${TEAL_MID}; }
.mm-btn-danger:hover { background: #fee2e2; color: ${ROJO}; border-color: #fecaca; }
`;

/* Buscador de dirección con autocompletado (OpenStreetMap / Nominatim, gratis y
   sin API key). Al elegir una sugerencia entrega dirección + latitud + longitud,
   para no ingresar direcciones ni coordenadas incorrectas. Si la búsqueda falla,
   el campo sigue permitiendo escribir a mano. */
function BuscadorDireccion({ value, onChange, onPick, disabled }) {
  const [q, setQ] = useState(value || "");
  const [sug, setSug] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const skipRef = useRef(false);
  const boxRef = useRef(null);

  useEffect(() => { setQ(value || ""); }, [value]);

  useEffect(() => {
    if (skipRef.current) { skipRef.current = false; return; }
    const term = (q || "").trim();
    if (term.length < 4) { setSug([]); return; }
    let activo = true;
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const url =
          "https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1" +
          `&countrycodes=cl&limit=6&q=${encodeURIComponent(term)}`;
        const res = await fetch(url, { headers: { "Accept-Language": "es" } });
        const data = await res.json();
        if (activo) { setSug(Array.isArray(data) ? data : []); setOpen(true); }
      } catch {
        if (activo) setSug([]);
      } finally {
        if (activo) setLoading(false);
      }
    }, 450);
    return () => { activo = false; clearTimeout(t); };
  }, [q]);

  useEffect(() => {
    const h = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  function elegir(s) {
    skipRef.current = true;
    setQ(s.display_name);
    setSug([]);
    setOpen(false);
    onPick({ direccion: s.display_name, lat: Number(s.lat), lng: Number(s.lon) });
  }

  return (
    <div ref={boxRef} style={{ position: "relative" }}>
      <input
        type="text"
        className="mm-input"
        value={q}
        disabled={disabled}
        autoComplete="off"
        placeholder="Escribe y elige la dirección…"
        onChange={(e) => { setQ(e.target.value); onChange(e.target.value); }}
        onFocus={() => { if (sug.length) setOpen(true); }}
      />
      {loading && (
        <div style={{ position: "absolute", right: 10, top: 9, fontSize: 11, color: "#94a3b8" }}>Buscando…</div>
      )}
      {open && sug.length > 0 && (
        <div style={{
          position: "absolute", zIndex: 60, top: "calc(100% + 4px)", left: 0, right: 0,
          background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8,
          boxShadow: "0 8px 24px rgba(15,23,42,.12)", maxHeight: 220, overflowY: "auto",
        }}>
          {sug.map((s) => (
            <button
              key={s.place_id}
              type="button"
              onClick={() => elegir(s)}
              style={{
                display: "block", width: "100%", textAlign: "left", padding: "8px 10px",
                background: "transparent", border: "none", borderBottom: "1px solid #f1f5f9",
                cursor: "pointer", fontSize: 12.5, color: "#334155", lineHeight: 1.35,
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "#f8fafc")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              {s.display_name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
