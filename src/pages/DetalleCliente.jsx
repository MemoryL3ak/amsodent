import { useEffect, useMemo, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { createPortal } from "react-dom";
import { api } from "../lib/api";
import { REGIONES_CHILE } from "../constants/regiones";
import Toast from "../components/Toast";
import ConfirmModal from "../components/ConfirmModal";
import Avatar from "../components/Avatar";
import {
  ArrowLeft, Pencil, Building2, MapPin, Phone, Mail, Globe, User, IdCard,
  DollarSign, Package, FileText, Target, CheckCircle2, Plus, Trash2,
  CalendarClock, AlertTriangle, Cake, Briefcase, Clock, ShieldCheck, Wallet,
} from "lucide-react";

/* ─── Helpers ─────────────────────────────────────────────────────────── */

// Neto de una cotización = suma de sus OC; sin OC cae al neto de la cotización.
function montoNetoPago(ocSum, lic) {
  const oc = Number(ocSum || 0);
  if (oc > 0) return oc;
  const sinIva = Number(lic?.total_sin_iva || 0);
  if (sinIva > 0) return sinIva;
  return Math.round(Number(lic?.total_con_iva || 0) / 1.19);
}

const fmtCLP = (n) => `$${Number(n || 0).toLocaleString("es-CL")}`;

function fmtFecha(iso) {
  if (!iso) return "—";
  const f = new Date(`${String(iso).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(f.getTime())) return "—";
  return f.toLocaleDateString("es-CL", { day: "2-digit", month: "short", year: "numeric" });
}

function diasDesde(iso) {
  if (!iso) return null;
  const f = new Date(`${String(iso).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(f.getTime())) return null;
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  return Math.floor((hoy.getTime() - f.getTime()) / 86400000);
}

const COLOR_ESTADO = {
  "Adjudicada": { bg: "#dcfce7", color: "#15803d" },
  "En espera": { bg: "#e0f2fe", color: "#0369a1" },
  "Pendiente Aprobación": { bg: "#fef3c7", color: "#b45309" },
  "Descartada": { bg: "#fee2e2", color: "#b91c1c" },
};
function estiloEstado(estado) {
  return COLOR_ESTADO[estado] || { bg: "var(--primary-light)", color: "var(--primary-dark)" };
}

const COLOR_INFLUENCIA = {
  Alta: { bg: "#dcfce7", color: "#15803d" },
  Media: { bg: "#fef3c7", color: "#b45309" },
  Baja: { bg: "#e5e7eb", color: "#4b5563" },
};

const COLORES_CAT = ["#28aeb1", "#3b82f6", "#22c55e", "#a855f7", "#f59e0b", "#ef4444", "#14b8a6", "#6366f1"];

const ICONO_ACTIVIDAD = {
  llamada: Phone, visita: User, reunion: CalendarClock, correo: Mail,
  seguimiento: Clock, tarea: CheckCircle2, otro: FileText, gestion: FileText,
};

/* ─── Página ──────────────────────────────────────────────────────────── */

export default function DetalleCliente() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [cliente, setCliente] = useState(null);
  const [cotizaciones, setCotizaciones] = useState([]);
  const [documentos, setDocumentos] = useState([]);
  const [items, setItems] = useState([]);
  const [actividades, setActividades] = useState([]);
  const [contactos, setContactos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("resumen");
  const [toast, setToast] = useState(null);

  // Contacto en edición / creación.
  const [contactoEdit, setContactoEdit] = useState(null);
  const [contactoBorrar, setContactoBorrar] = useState(null);

  // Edición del cliente (desde el propio perfil).
  const [editando, setEditando] = useState(false);
  const [esAdmin, setEsAdmin] = useState(false);
  const [vendedores, setVendedores] = useState([]);
  // Estado de bloqueo por mora (cobranza).
  const [mora, setMora] = useState(null); // { bloqueado, diasAtrasoMax, umbral, desbloqueado }
  const [moraLoading, setMoraLoading] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const perfil = await api.get("/auth/profile");
        const r = (perfil?.rol || "").toString().trim().toLowerCase();
        setEsAdmin(r === "admin" || r === "administrador");
      } catch { /* */ }
      try {
        const ps = await api.get("/usuarios/profiles");
        setVendedores(Array.isArray(ps) ? ps : []);
      } catch { /* */ }
    })();
  }, []);

  async function cargarContactos() {
    try {
      const c = await api.get(`/clientes/${id}/contactos`);
      setContactos(Array.isArray(c) ? c : []);
    } catch { /* tabla puede no existir aún */ }
  }

  async function subirFotoCliente(file) {
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await api.putForm(`/clientes/${id}/foto`, fd);
      setCliente((c) => ({ ...c, foto_url: r?.foto_url || c?.foto_url }));
      setToast({ type: "success", message: "Foto del cliente actualizada." });
    } catch (e) {
      console.error(e);
      setToast({ type: "error", message: e?.message || "No se pudo subir la foto. ¿Creaste el bucket 'avatars'?" });
    }
  }

  async function subirFotoContacto(contactoId, file) {
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await api.putForm(`/clientes/contactos/${contactoId}/foto`, fd);
      setContactos((prev) => prev.map((c) => (c.id === contactoId ? { ...c, foto_url: r?.foto_url || c.foto_url } : c)));
      setToast({ type: "success", message: "Foto del contacto actualizada." });
    } catch (e) {
      console.error(e);
      setToast({ type: "error", message: e?.message || "No se pudo subir la foto del contacto." });
    }
  }

  useEffect(() => {
    let cancel = false;
    (async () => {
      setLoading(true);
      try {
        const [perfil, conts, acts] = await Promise.all([
          api.get(`/clientes/${id}/comercial`),
          api.get(`/clientes/${id}/contactos`).catch(() => []),
          api.get(`/actividades?cliente_id=${id}`).catch(() => []),
        ]);
        if (cancel) return;
        setCliente(perfil?.cliente || null);
        setCotizaciones(Array.isArray(perfil?.cotizaciones) ? perfil.cotizaciones : []);
        setDocumentos(Array.isArray(perfil?.documentos) ? perfil.documentos : []);
        setItems(Array.isArray(perfil?.items) ? perfil.items : []);
        setContactos(Array.isArray(conts) ? conts : []);
        setActividades(Array.isArray(acts) ? acts : []);
      } catch (e) {
        console.error(e);
        if (!cancel) setToast({ type: "error", message: "No se pudo cargar el perfil del cliente." });
      } finally {
        if (!cancel) setLoading(false);
      }
    })();
    return () => { cancel = true; };
  }, [id]);

  // Estado de bloqueo por mora del cliente.
  const cargarMora = async (rut, tipo) => {
    if (!rut) return;
    try {
      const r = await api.get(`/licitaciones/cliente-mora?rut=${encodeURIComponent(rut)}&tipo=${encodeURIComponent(tipo || "")}`);
      setMora(r || null);
    } catch { setMora(null); }
  };
  useEffect(() => {
    if (cliente?.rut) cargarMora(cliente.rut, cliente.tipo_cliente);
  }, [cliente?.rut, cliente?.tipo_cliente]);

  // Override manual del estado de cobranza (admin): 'auto' | 'bloqueado' | 'desbloqueado'.
  async function cambiarCobranzaOverride(valor) {
    if (!esAdmin || !cliente) return;
    const override = valor === "bloqueado" || valor === "desbloqueado" ? valor : null;
    setMoraLoading(true);
    try {
      await api.put(`/clientes/${id}/cobranza-override`, { override });
      setCliente((c) => ({ ...c, cobranza_override: override, cobranza_desbloqueado: override === "desbloqueado" }));
      await cargarMora(cliente.rut, cliente.tipo_cliente);
      setToast({
        type: "success",
        message:
          override === "bloqueado" ? "Cobranza forzada a BLOQUEADO."
          : override === "desbloqueado" ? "Cobranza forzada a DESBLOQUEADO (permite cotizar)."
          : "Cobranza en automático (según atraso).",
      });
    } catch (e) {
      setToast({ type: "error", message: e?.message || "No se pudo actualizar el estado de cobranza." });
    } finally {
      setMoraLoading(false);
    }
  }

  // Estado de cliente editable a mano por admin (Activo ↔ Transitorio).
  const [estadoLoading, setEstadoLoading] = useState(false);
  async function cambiarTransitorio(valor) {
    if (!esAdmin || !cliente) return;
    setEstadoLoading(true);
    try {
      await api.put(`/clientes/${id}`, { transitorio: valor });
      setCliente((c) => ({ ...c, transitorio: valor }));
      setToast({ type: "success", message: valor ? "Marcado como cliente transitorio." : "Marcado como cliente activo." });
    } catch (e) {
      setToast({ type: "error", message: e?.message || "No se pudo actualizar el estado del cliente." });
    } finally {
      setEstadoLoading(false);
    }
  }

  /* ── Agregaciones ── */
  const calc = useMemo(() => {
    const ocSumByLic = {};
    const factSumByLic = {};
    let pedidos = 0;
    documentos.forEach((d) => {
      const lid = d.licitacion_id;
      if (d.tipo === "orden_compra") {
        ocSumByLic[lid] = (ocSumByLic[lid] || 0) + Number(d.monto || 0);
        pedidos++;
      } else if (d.tipo === "factura" || d.tipo === "factura_boleta") {
        factSumByLic[lid] = (factSumByLic[lid] || 0) + Number(d.monto || 0);
      }
    });

    const conNeto = cotizaciones.map((c) => ({
      ...c,
      neto: montoNetoPago(ocSumByLic[c.id], c),
    }));
    const adjudicadas = conNeto.filter((c) => c.estado === "Adjudicada");
    const ventaAcumulada = adjudicadas.reduce((a, c) => a + c.neto, 0);
    const total = conNeto.length;
    const conversion = total > 0 ? Math.round((adjudicadas.length / total) * 100) : 0;
    const ticket = adjudicadas.length > 0 ? Math.round(ventaAcumulada / adjudicadas.length) : 0;

    // Productos comprados (por categoría) — ítems de cotizaciones adjudicadas.
    const adjIds = new Set(adjudicadas.map((c) => c.id));
    const catMap = {};
    items.forEach((it) => {
      if (!adjIds.has(it.licitacion_id)) return;
      const cat = (it.categoria || "Sin categoría").trim() || "Sin categoría";
      catMap[cat] = (catMap[cat] || 0) + Number(it.total || 0);
    });
    const categorias = Object.entries(catMap)
      .map(([categoria, monto]) => ({ categoria, monto }))
      .sort((a, b) => b.monto - a.monto);
    const totalCat = categorias.reduce((a, c) => a + c.monto, 0);

    // Oportunidades activas = cotizaciones en proceso (ni adjudicadas ni descartadas).
    const oportunidades = conNeto
      .filter((c) => c.estado !== "Adjudicada" && c.estado !== "Descartada")
      .sort((a, b) => b.neto - a.neto);

    return {
      conNeto, adjudicadas, ventaAcumulada, total, conversion, ticket, pedidos,
      ocSumByLic, factSumByLic, categorias, totalCat, oportunidades,
    };
  }, [cotizaciones, documentos, items]);

  // Última / próxima visita y línea de tiempo (actividades + hitos de documentos).
  const timeline = useMemo(() => {
    const eventos = [];
    actividades.forEach((a) => {
      eventos.push({
        fecha: a.fecha,
        titulo: a.titulo || a.tipo || "Gestión",
        tipo: a.tipo || "gestion",
        detalle: a.comentario || "",
        autor: a.user_nombre || a.user_email || "",
        clase: "actividad",
      });
    });
    documentos.forEach((d) => {
      const f = d.fecha_oc || d.fecha_factura || (d.created_at ? String(d.created_at).slice(0, 10) : null);
      if (!f) return;
      const etiqueta = d.tipo === "orden_compra" ? "Orden de compra"
        : d.tipo === "factura" || d.tipo === "factura_boleta" ? "Factura / Boleta"
        : d.tipo === "guia_despacho" ? "Guía de despacho"
        : d.tipo === "comprobante_pago" ? "Comprobante de pago" : null;
      if (!etiqueta) return;
      eventos.push({
        fecha: f,
        titulo: `${etiqueta}${d.numero ? ` ${d.numero}` : ""}`,
        tipo: "documento",
        detalle: d.monto ? fmtCLP(d.monto) : "",
        clase: "documento",
      });
    });
    return eventos
      .filter((e) => e.fecha)
      .sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
  }, [actividades, documentos]);

  const visitas = useMemo(() => {
    const hoyIso = new Date().toISOString().slice(0, 10);
    const pasadas = actividades
      .filter((a) => a.fecha && String(a.fecha) <= hoyIso)
      .sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
    const futuras = actividades
      .filter((a) => a.fecha && String(a.fecha) > hoyIso && a.estado !== "realizada")
      .sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)));
    return { ultima: pasadas[0]?.fecha || null, proxima: futuras[0]?.fecha || null };
  }, [actividades]);

  // Estado del cliente (heurístico): activo si tuvo actividad o cotización < 180 días.
  const estadoCliente = useMemo(() => {
    const fechas = [
      ...actividades.map((a) => a.fecha),
      ...cotizaciones.map((c) => c.fecha),
    ].filter(Boolean);
    if (!fechas.length) return { label: "Sin actividad", activo: false };
    const reciente = fechas.sort().slice(-1)[0];
    const d = diasDesde(reciente);
    return d != null && d <= 180 ? { label: "Activo", activo: true } : { label: "Inactivo", activo: false };
  }, [actividades, cotizaciones]);

  // Línea de tiempo de actividades: conteo por mes o por semana (últimos 12
  // periodos) para ver la evolución y el comportamiento del cliente.
  const [tlGran, setTlGran] = useState("mensual"); // "mensual" | "semanal"
  const timelineActividades = useMemo(() => {
    const ymdL = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
    const fechas = actividades.map((a) => String(a.fecha || "").slice(0, 10)).filter(Boolean);
    const periodos = [];
    if (tlGran === "semanal") {
      const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
      const lunes = new Date(hoy); lunes.setDate(hoy.getDate() - ((hoy.getDay() + 6) % 7));
      const conteo = {};
      fechas.forEach((f) => {
        const d = new Date(`${f}T00:00:00`);
        const lun = new Date(d); lun.setDate(d.getDate() - ((d.getDay() + 6) % 7));
        const k = ymdL(lun);
        conteo[k] = (conteo[k] || 0) + 1;
      });
      for (let i = 11; i >= 0; i--) {
        const ws = new Date(lunes); ws.setDate(lunes.getDate() - i * 7);
        const k = ymdL(ws);
        periodos.push({
          key: k,
          label: `${ws.getDate()} ${ws.toLocaleDateString("es-CL", { month: "short" }).replace(".", "")}`,
          titulo: `Semana del ${ws.toLocaleDateString("es-CL", { day: "2-digit", month: "long" })}`,
          count: conteo[k] || 0,
        });
      }
    } else {
      const conteo = {};
      fechas.forEach((f) => { const k = f.slice(0, 7); conteo[k] = (conteo[k] || 0) + 1; });
      const base = new Date(); base.setDate(1);
      for (let i = 11; i >= 0; i--) {
        const d = new Date(base.getFullYear(), base.getMonth() - i, 1);
        const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
        periodos.push({
          key: k,
          label: cap(d.toLocaleDateString("es-CL", { month: "short" }).replace(".", "")),
          titulo: cap(d.toLocaleDateString("es-CL", { month: "long", year: "numeric" })),
          count: conteo[k] || 0,
        });
      }
    }
    const counts = periodos.map((p) => p.count);
    const max = Math.max(1, ...counts);
    const total = counts.reduce((a, b) => a + b, 0);
    const promedio = total / periodos.length;
    const pico = periodos[counts.indexOf(Math.max(...counts))];
    const activos = counts.filter((c) => c > 0).length;
    return { periodos, max, total, promedio, pico, activos };
  }, [actividades, tlGran]);

  // Alertas inteligentes derivadas de la data.
  const alertas = useMemo(() => {
    const out = [];
    const dVisita = diasDesde(visitas.ultima);
    if (dVisita == null) {
      out.push({ tipo: "warn", titulo: "Cliente sin visitas registradas", detalle: "No hay gestiones en la bitácora." });
    } else if (dVisita >= 30) {
      out.push({ tipo: "warn", titulo: `Cliente sin visita hace ${dVisita} días`, detalle: `Última: ${fmtFecha(visitas.ultima)}` });
    }
    // Cotizaciones pendientes de aprobación.
    const pend = cotizaciones.filter((c) => c.estado === "Pendiente Aprobación");
    if (pend.length) {
      out.push({ tipo: "info", titulo: `${pend.length} cotización(es) pendiente(s) de aprobación`, detalle: "Revísalas para no perder la venta." });
    }
    // Facturas impagas.
    const impagas = documentos.filter((d) => (d.tipo === "factura" || d.tipo === "factura_boleta") && !d.pagada);
    if (impagas.length) {
      out.push({ tipo: "warn", titulo: `${impagas.length} factura(s) sin pago registrado`, detalle: "Verifica el estado de cobranza." });
    }
    // Cumpleaños de contactos.
    contactos.filter((c) => c.cumpleanos).forEach((c) => {
      out.push({ tipo: "info", titulo: `Cumpleaños de ${c.nombre}`, detalle: String(c.cumpleanos) });
    });
    return out;
  }, [visitas, cotizaciones, documentos, contactos]);

  /* ── Acciones contactos ── */
  async function guardarContacto(form) {
    try {
      if (form.id) {
        await api.put(`/clientes/contactos/${form.id}`, form);
      } else {
        await api.post(`/clientes/${id}/contactos`, form);
      }
      setContactoEdit(null);
      setToast({ type: "success", message: "Contacto guardado." });
      cargarContactos();
    } catch (e) {
      console.error(e);
      setToast({ type: "error", message: e?.message || "No se pudo guardar el contacto. ¿Aplicaste la migración?" });
    }
  }
  async function eliminarContactoConfirmado() {
    const c = contactoBorrar;
    setContactoBorrar(null);
    if (!c) return;
    try {
      await api.delete(`/clientes/contactos/${c.id}`);
      setToast({ type: "success", message: "Contacto eliminado." });
      cargarContactos();
    } catch (e) {
      console.error(e);
      setToast({ type: "error", message: "No se pudo eliminar el contacto." });
    }
  }

  if (loading) {
    return <div className="page"><div style={{ padding: 40, color: "var(--text-muted)" }}>Cargando perfil…</div></div>;
  }
  if (!cliente) {
    return (
      <div className="page">
        <Link to="/clientes" style={lnkVolver}><ArrowLeft size={14} /> Volver a Clientes</Link>
        <div style={{ padding: 40, color: "var(--text-muted)" }}>Cliente no encontrado.</div>
      </div>
    );
  }

  const TABS = [
    { id: "resumen", label: "Resumen" },
    { id: "cotizaciones", label: `Cotizaciones (${calc.total})` },
    { id: "documentos", label: `Documentos (${documentos.length})` },
    { id: "actividades", label: `Actividades (${actividades.length})` },
    { id: "productos", label: "Productos" },
  ];

  return (
    <div className="page">
      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}

      <Link to="/clientes" style={lnkVolver}><ArrowLeft size={14} /> Volver a Clientes</Link>

      {/* HEADER */}
      <div className="surface" style={{ marginBottom: 18 }}>
        <div className="surface-body" style={{ display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap" }}>
          <Avatar src={cliente.foto_url} nombre={cliente.nombre} size={64} editable onUpload={subirFotoCliente} title="Foto del cliente" />
          <div style={{ flex: 1, minWidth: 240 }}>
            <h1 style={{ margin: 0, fontSize: 22, color: "var(--text)" }}>{cliente.nombre}</h1>
            <div style={{ display: "flex", gap: 18, flexWrap: "wrap", marginTop: 10 }}>
              <HeaderItem icon={IdCard} label="RUT" value={cliente.rut} />
              <HeaderItem icon={Building2} label="Categoría" value={cliente.tipo_cliente || "—"} />
              <HeaderItem icon={User} label="Ejecutivo" value={cliente.vendedor_asignado || "—"} />
              <HeaderItem icon={CalendarClock} label="Última visita" value={fmtFecha(visitas.ultima)} />
              <HeaderItem icon={CalendarClock} label="Próxima visita" value={fmtFecha(visitas.proxima)} />

              {/* Estado de cliente (editable por admin: Activo ↔ Transitorio) */}
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".4px", color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 4 }}>
                  <ShieldCheck size={11} /> Estado de cliente
                </span>
                {esAdmin ? (
                  <select
                    className="input"
                    value={cliente.transitorio ? "transitorio" : "activo"}
                    onChange={(e) => cambiarTransitorio(e.target.value === "transitorio")}
                    disabled={estadoLoading}
                    style={{ height: 30, padding: "2px 8px", fontSize: 12.5, fontWeight: 600, width: "auto", minWidth: 120 }}
                    title="Transitorio = creado con datos mínimos."
                  >
                    <option value="activo">Activo</option>
                    <option value="transitorio">Transitorio</option>
                  </select>
                ) : (
                  <span style={{ ...badge, alignSelf: "flex-start", background: cliente.transitorio ? "#fef3c7" : "#dcfce7", color: cliente.transitorio ? "#92400e" : "#15803d" }}>
                    {cliente.transitorio ? "Transitorio" : "Activo"}
                  </span>
                )}
              </div>

              {/* Estado de cobranza: automático por atraso; admin puede forzarlo a mano. */}
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".4px", color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 4 }}>
                  <Wallet size={11} /> Estado Comercial
                </span>
                {esAdmin ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <select
                      className="input"
                      value={mora?.bloqueado ? "bloqueado" : "aldia"}
                      onChange={(e) => cambiarCobranzaOverride(e.target.value === "bloqueado" ? "bloqueado" : "desbloqueado")}
                      disabled={moraLoading || !mora}
                      style={{ height: 30, padding: "2px 8px", fontSize: 12.5, fontWeight: 600, width: "auto", minWidth: 120,
                        color: mora?.bloqueado ? "#b91c1c" : "#15803d" }}
                      title="Por defecto se calcula por los días de atraso; aquí puedes forzarlo a mano."
                    >
                      <option value="aldia">Al día</option>
                      <option value="bloqueado">Bloqueado</option>
                    </select>
                    {mora && mora.diasAtrasoMax > 0 && (
                      <span style={{ fontSize: 11, color: "var(--text-muted)" }} title={`Umbral ${mora.umbral} días`}>
                        {mora.diasAtrasoMax}d atraso
                      </span>
                    )}
                  </div>
                ) : (
                  <div style={{ minHeight: 30, display: "flex", alignItems: "center" }}>
                    {mora ? <EstadoCobranzaBadge mora={mora} /> : (
                      <span style={{ ...badge, background: "#e5e7eb", color: "#6b7280" }}>{moraLoading ? "Calculando…" : "—"}</span>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
          <div style={{ alignSelf: "flex-start" }}>
            <button className="btn btn-secondary btn-sm" onClick={() => setEditando(true)} style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 5 }}>
              <Pencil size={13} /> Editar
            </button>
          </div>
        </div>
      </div>

      {/* GRID 3 COLUMNAS */}
      <div style={{ display: "grid", gridTemplateColumns: "300px minmax(0,1fr) 300px", gap: 18, alignItems: "start" }}>

        {/* ─── IZQUIERDA ─── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <Seccion titulo="Información General">
            <InfoRow icon={Building2} label="Razón Social" value={cliente.nombre} />
            <InfoRow icon={IdCard} label="RUT" value={cliente.rut} />
            <InfoRow icon={MapPin} label="Dirección" value={[cliente.direccion, cliente.comuna, cliente.region].filter(Boolean).join(", ")} />
            <InfoRow icon={Briefcase} label="Departamento" value={cliente.departamento} />
            <InfoRow icon={Phone} label="Teléfono" value={cliente.telefono} />
            <InfoRow icon={Mail} label="Correo" value={cliente.email} />
            <InfoRow icon={DollarSign} label="Condición de venta" value={cliente.condiciones_venta} />
          </Seccion>

          <Seccion
            titulo="Contactos Clave"
            accion={
              <button className="btn btn-ghost btn-sm" onClick={() => setContactoEdit({})} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                <Plus size={13} /> Agregar
              </button>
            }
          >
            {contactos.length === 0 ? (
              <div style={{ fontSize: 12.5, color: "var(--text-muted)", padding: "6px 0" }}>
                Sin contactos registrados.
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {contactos.map((c) => {
                  const inf = COLOR_INFLUENCIA[c.influencia] || null;
                  return (
                    <div key={c.id} style={{ display: "flex", gap: 10, borderBottom: "1px solid var(--border)", paddingBottom: 10 }}>
                      <Avatar
                        src={c.foto_url}
                        nombre={c.nombre}
                        size={40}
                        editable
                        onUpload={(file) => subirFotoContacto(c.id, file)}
                        title="Foto del contacto"
                      />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                          <div style={{ fontWeight: 600, fontSize: 13.5, color: "var(--text)" }}>{c.nombre}</div>
                          {inf && <span style={{ ...badge, background: inf.bg, color: inf.color, fontSize: 10 }}>{c.influencia}</span>}
                        </div>
                        {c.cargo && <div style={{ fontSize: 12, color: "var(--text-soft)" }}>{c.cargo}</div>}
                        {c.telefono && <div style={miniRow}><Phone size={11} /> {c.telefono}</div>}
                        {c.email && <div style={miniRow}><Mail size={11} /> {c.email}</div>}
                        {c.cumpleanos && <div style={miniRow}><Cake size={11} /> {c.cumpleanos}</div>}
                        <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                          <button className="btn btn-ghost btn-sm" style={{ padding: "2px 6px" }} onClick={() => setContactoEdit(c)}><Pencil size={12} /></button>
                          <button className="btn btn-ghost btn-sm" style={{ padding: "2px 6px", color: "var(--danger)" }} onClick={() => setContactoBorrar(c)}><Trash2 size={12} /></button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Seccion>
        </div>

        {/* ─── CENTRO ─── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 18, minWidth: 0 }}>
          {/* Tabs */}
          <div style={{ display: "flex", gap: 4, borderBottom: "1px solid var(--border)", flexWrap: "wrap" }}>
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                style={{
                  background: "none", border: "none", cursor: "pointer",
                  padding: "10px 14px", fontSize: 13.5, fontWeight: 600,
                  color: tab === t.id ? "var(--primary-dark)" : "var(--text-soft)",
                  borderBottom: tab === t.id ? "2px solid var(--primary)" : "2px solid transparent",
                  marginBottom: -1,
                }}
              >
                {t.label}
              </button>
            ))}
          </div>

          {tab === "resumen" && (
            <>
              {/* KPIs */}
              <div className="stats-row stats-5 stats-360">
                <KPI label="Venta acumulada" value={fmtCLP(calc.ventaAcumulada)} sub="cotizaciones adjudicadas" color="#28aeb1" money />
                <KPI label="Pedidos" value={calc.pedidos} sub="órdenes de compra" color="#3b82f6" />
                <KPI label="Cotizaciones" value={calc.total} sub="totales del cliente" color="#22c55e" />
                <KPI label="Conversión" value={`${calc.conversion}%`} sub={`${calc.adjudicadas.length}/${calc.total} adjudicadas`} color="#a855f7" />
                <KPI label="Ticket promedio" value={fmtCLP(calc.ticket)} sub="por adjudicación" color="#f59e0b" money />
              </div>

              {/* Línea de tiempo */}
              <Seccion titulo="Historial comercial">
                {timeline.length === 0 ? (
                  <Vacio texto="Sin movimientos registrados." />
                ) : (
                  <div style={{ display: "flex", flexDirection: "column" }}>
                    {timeline.slice(0, 12).map((e, i) => {
                      const Icono = e.clase === "documento" ? FileText : (ICONO_ACTIVIDAD[e.tipo] || FileText);
                      return (
                        <div key={i} style={{ display: "flex", gap: 12, padding: "10px 0", borderBottom: i < timeline.slice(0, 12).length - 1 ? "1px solid var(--border)" : "none" }}>
                          <div style={tlIcon(e.clase)}><Icono size={14} /></div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{e.titulo}</div>
                            {e.detalle && <div style={{ fontSize: 12, color: "var(--text-soft)" }}>{e.detalle}</div>}
                            {e.autor && <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{e.autor}</div>}
                          </div>
                          <div style={{ fontSize: 11.5, color: "var(--text-muted)", whiteSpace: "nowrap" }}>{fmtFecha(e.fecha)}</div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </Seccion>
            </>
          )}

          {tab === "cotizaciones" && (
            <Seccion titulo="Cotizaciones del cliente" pad0>
              {calc.conNeto.length === 0 ? <Vacio texto="Este cliente no tiene cotizaciones." /> : (
                <Tabla cabeceras={["ID", "Nombre", "Fecha", "Estado", "Monto neto"]}>
                  {calc.conNeto.map((c) => {
                    const e = estiloEstado(c.estado);
                    return (
                      <tr key={c.id} style={{ cursor: "pointer" }} onClick={() => navigate(`/detalle/${c.id}`)}>
                        <td style={{ fontWeight: 600 }}>{c.id_licitacion || c.id}</td>
                        <td style={{ maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={c.nombre}>{c.nombre || "—"}</td>
                        <td style={{ whiteSpace: "nowrap" }}>{fmtFecha(c.fecha)}</td>
                        <td><span style={{ ...badge, background: e.bg, color: e.color }}>{c.estado || "—"}</span></td>
                        <td style={{ textAlign: "right", fontWeight: 600, whiteSpace: "nowrap" }}>{fmtCLP(c.neto)}</td>
                      </tr>
                    );
                  })}
                </Tabla>
              )}
            </Seccion>
          )}

          {tab === "documentos" && (
            <Seccion titulo="Documentos" pad0>
              {documentos.length === 0 ? <Vacio texto="Sin documentos." /> : (
                <Tabla cabeceras={["Tipo", "Número", "Fecha", "Monto", "Pago"]}>
                  {documentos.map((d) => (
                    <tr key={d.id}>
                      <td style={{ textTransform: "capitalize" }}>{(d.tipo || "").replace(/_/g, " ")}</td>
                      <td>{d.numero || "—"}</td>
                      <td style={{ whiteSpace: "nowrap" }}>{fmtFecha(d.fecha_oc || d.fecha_factura || d.created_at)}</td>
                      <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>{d.monto ? fmtCLP(d.monto) : "—"}</td>
                      <td>
                        {(d.tipo === "factura" || d.tipo === "factura_boleta")
                          ? <span style={{ ...badge, background: d.pagada ? "#dcfce7" : "#fef3c7", color: d.pagada ? "#15803d" : "#b45309" }}>{d.pagada ? "Pagada" : "Pendiente"}</span>
                          : <span style={{ color: "var(--text-muted)" }}>—</span>}
                      </td>
                    </tr>
                  ))}
                </Tabla>
              )}
            </Seccion>
          )}

          {tab === "actividades" && (
            <Seccion
              titulo="Bitácora de gestiones"
              accion={<Link to="/bitacora-actividades" className="btn btn-ghost btn-sm">Ir a la bitácora</Link>}
            >
              {actividades.length === 0 ? <Vacio texto="Sin gestiones registradas para este cliente." /> : (
                <>
                  {/* Línea de tiempo de actividades (mensual / semanal) */}
                  <div style={{ marginBottom: 18, padding: "16px 18px", background: "linear-gradient(180deg, var(--surface), var(--bg))", borderRadius: 12, border: "1px solid var(--border)" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-soft)", textTransform: "uppercase", letterSpacing: ".4px" }}>
                        Actividad en el tiempo
                        <span style={{ marginLeft: 8, fontWeight: 500, textTransform: "none", letterSpacing: 0, color: "var(--text-muted)" }}>
                          últimos 12 {tlGran === "semanal" ? "semanas" : "meses"}
                        </span>
                      </div>
                      {/* Toggle mensual / semanal */}
                      <div style={{ display: "inline-flex", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 8, padding: 2 }}>
                        {[{ id: "mensual", t: "Mensual" }, { id: "semanal", t: "Semanal" }].map((g) => (
                          <button
                            key={g.id}
                            type="button"
                            onClick={() => setTlGran(g.id)}
                            style={{
                              border: "none", cursor: "pointer", fontSize: 12, fontWeight: 600, padding: "4px 12px", borderRadius: 6,
                              background: tlGran === g.id ? "var(--primary)" : "transparent",
                              color: tlGran === g.id ? "#fff" : "var(--text-muted)",
                            }}
                          >
                            {g.t}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Resumen rápido */}
                    <div style={{ display: "flex", gap: 18, flexWrap: "wrap", marginBottom: 14 }}>
                      <TlStat label="Total en el periodo" value={timelineActividades.total} />
                      <TlStat label={`Promedio / ${tlGran === "semanal" ? "semana" : "mes"}`} value={timelineActividades.promedio.toFixed(1)} />
                      <TlStat label="Pico" value={`${timelineActividades.pico?.count || 0}`} hint={timelineActividades.pico?.label} />
                      <TlStat label={tlGran === "semanal" ? "Semanas con actividad" : "Meses con actividad"} value={`${timelineActividades.activos}/12`} />
                    </div>

                    {/* Línea de tiempo (línea + área sobre un eje temporal) */}
                    {(() => {
                      const per = timelineActividades.periodos;
                      const n = per.length;
                      const W = 1000, H = 210, padX = 30, topPad = 28, botPad = 26;
                      const plotBottom = H - botPad, plotTop = topPad;
                      const max = timelineActividades.max;
                      const xFor = (i) => padX + (n <= 1 ? 0 : (i / (n - 1)) * (W - 2 * padX));
                      const yFor = (c) => plotBottom - (c / max) * (plotBottom - plotTop);
                      const pts = per.map((p, i) => ({ ...p, x: xFor(i), y: yFor(p.count) }));
                      const linePath = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
                      const areaPath = `${linePath} L ${pts[n - 1].x.toFixed(1)} ${plotBottom} L ${pts[0].x.toFixed(1)} ${plotBottom} Z`;
                      const picoCount = timelineActividades.pico?.count || 0;
                      return (
                        <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block", overflow: "visible" }}>
                          <defs>
                            <linearGradient id="tlArea" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.30" />
                              <stop offset="100%" stopColor="var(--primary)" stopOpacity="0" />
                            </linearGradient>
                          </defs>
                          {/* eje temporal */}
                          <line x1={padX} y1={plotBottom} x2={W - padX} y2={plotBottom} stroke="var(--border)" strokeWidth="1" />
                          <path d={areaPath} fill="url(#tlArea)" />
                          <path d={linePath} fill="none" stroke="var(--primary)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
                          {pts.map((p) => {
                            const esPico = p.count > 0 && p.count === picoCount;
                            return (
                              <g key={p.key}>
                                {/* marca sobre el eje */}
                                <line x1={p.x} y1={plotBottom} x2={p.x} y2={plotBottom + 4} stroke="var(--border)" strokeWidth="1" />
                                <circle cx={p.x} cy={p.y} r={esPico ? 6 : 4.2} fill={esPico ? "var(--primary-dark)" : "#fff"} stroke="var(--primary)" strokeWidth="2.2">
                                  <title>{`${p.titulo}: ${p.count} actividad(es)`}</title>
                                </circle>
                                {p.count > 0 && (
                                  <text x={p.x} y={p.y - 11} textAnchor="middle" fontSize="12" fontWeight="700" fill={esPico ? "var(--primary-dark)" : "var(--text-soft)"}>{p.count}</text>
                                )}
                                <text x={p.x} y={H - 6} textAnchor="middle" fontSize="11" fill="var(--text-muted)">{p.label}</text>
                              </g>
                            );
                          })}
                        </svg>
                      );
                    })()}
                  </div>

                  {/* Lista de gestiones (contenida con scroll propio) */}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-soft)" }}>{actividades.length} gestiones</span>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 10, maxHeight: 460, overflowY: "auto", paddingRight: 6 }}>
                    {actividades
                      .slice()
                      .sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)))
                      .map((a) => {
                        const Icono = ICONO_ACTIVIDAD[a.tipo] || FileText;
                        return (
                          <div key={a.id} style={{ display: "flex", gap: 12, padding: "10px 0", borderBottom: "1px solid var(--border)" }}>
                            <div style={tlIcon("actividad")}><Icono size={14} /></div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 13, fontWeight: 600 }}>{a.titulo || a.tipo}</div>
                              {a.comentario && <div style={{ fontSize: 12, color: "var(--text-soft)" }}>{a.comentario}</div>}
                              <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{a.user_nombre || a.user_email}</div>
                            </div>
                            <div style={{ fontSize: 11.5, color: "var(--text-muted)", whiteSpace: "nowrap" }}>{fmtFecha(a.fecha)}</div>
                          </div>
                        );
                      })}
                  </div>
                </>
              )}
            </Seccion>
          )}

          {tab === "productos" && (
            <Seccion titulo="Productos comprados por categoría">
              {calc.categorias.length === 0 ? <Vacio texto="Aún no hay productos en cotizaciones adjudicadas." /> : (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {calc.categorias.map((c, i) => {
                    const pct = calc.totalCat > 0 ? Math.round((c.monto / calc.totalCat) * 100) : 0;
                    return (
                      <div key={c.categoria}>
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 4 }}>
                          <span style={{ color: "var(--text)" }}>{c.categoria}</span>
                          <span style={{ color: "var(--text-soft)" }}>{fmtCLP(c.monto)} · {pct}%</span>
                        </div>
                        <div style={{ height: 8, background: "var(--bg)", borderRadius: 4, overflow: "hidden" }}>
                          <div style={{ width: `${pct}%`, height: "100%", background: COLORES_CAT[i % COLORES_CAT.length] }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Seccion>
          )}
        </div>

        {/* ─── DERECHA ─── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <Seccion titulo="Oportunidades activas">
            {calc.oportunidades.length === 0 ? <Vacio texto="Sin cotizaciones en proceso." /> : (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {calc.oportunidades.slice(0, 6).map((c) => {
                  const e = estiloEstado(c.estado);
                  return (
                    <Link key={c.id} to={`/detalle/${c.id}`} style={{ textDecoration: "none", borderBottom: "1px solid var(--border)", paddingBottom: 10 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                        <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={c.nombre}>{c.nombre || c.id_licitacion || c.id}</span>
                        <span style={{ ...badge, background: e.bg, color: e.color, fontSize: 10 }}>{c.estado}</span>
                      </div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: "var(--primary-dark)", marginTop: 3 }}>{fmtCLP(c.neto)}</div>
                    </Link>
                  );
                })}
              </div>
            )}
          </Seccion>

          <Seccion titulo="Productos comprados">
            {calc.categorias.length === 0 ? <Vacio texto="Sin datos." /> : (
              <>
                <Donut datos={calc.categorias.slice(0, 6)} total={calc.totalCat} />
                <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 12 }}>
                  {calc.categorias.slice(0, 6).map((c, i) => (
                    <div key={c.categoria} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5 }}>
                      <span style={{ width: 10, height: 10, borderRadius: 2, background: COLORES_CAT[i % COLORES_CAT.length] }} />
                      <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={c.categoria}>{c.categoria}</span>
                      <span style={{ color: "var(--text-soft)" }}>{calc.totalCat > 0 ? Math.round((c.monto / calc.totalCat) * 100) : 0}%</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </Seccion>

          <Seccion titulo="Alertas inteligentes">
            {alertas.length === 0 ? <Vacio texto="Todo en orden." /> : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {alertas.map((a, i) => (
                  <div key={i} style={{ display: "flex", gap: 9 }}>
                    <div style={{ color: a.tipo === "warn" ? "var(--danger)" : "var(--primary)", marginTop: 1 }}>
                      {a.tipo === "warn" ? <AlertTriangle size={15} /> : <Target size={15} />}
                    </div>
                    <div>
                      <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text)" }}>{a.titulo}</div>
                      <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>{a.detalle}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Seccion>
        </div>
      </div>

      {contactoEdit && (
        <ModalContacto
          contacto={contactoEdit}
          onCerrar={() => setContactoEdit(null)}
          onGuardar={guardarContacto}
        />
      )}

      <ConfirmModal
        open={!!contactoBorrar}
        title="Eliminar contacto"
        message={`¿Eliminar a "${contactoBorrar?.nombre}"?`}
        onCancel={() => setContactoBorrar(null)}
        onConfirm={eliminarContactoConfirmado}
      />

      {editando && (
        <ModalEditarCliente
          cliente={cliente}
          esAdmin={esAdmin}
          vendedores={vendedores}
          onCerrar={() => setEditando(false)}
          onGuardado={(actualizado) => {
            setCliente((c) => ({ ...c, ...actualizado }));
            setEditando(false);
            setToast({ type: "success", message: "Cliente actualizado." });
          }}
          onError={(msg) => setToast({ type: "error", message: msg })}
        />
      )}
    </div>
  );
}

/* ─── Subcomponentes ──────────────────────────────────────────────────── */

function Seccion({ titulo, accion, children, pad0 }) {
  return (
    <div className="surface">
      <div className="surface-header" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h3 className="surface-title">{titulo}</h3>
        {accion}
      </div>
      <div className="surface-body" style={pad0 ? { padding: 0 } : undefined}>{children}</div>
    </div>
  );
}

// Mini-estadística de la línea de tiempo de actividades.
function TlStat({ label, value, hint }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <span style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: ".4px", color: "var(--text-muted)" }}>{label}</span>
      <span style={{ fontSize: 18, fontWeight: 800, color: "var(--text)", lineHeight: 1 }}>
        {value}
        {hint ? <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", marginLeft: 5 }}>{hint}</span> : null}
      </span>
    </div>
  );
}

function HeaderItem({ icon: Icon, label, value }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <span style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".4px", color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 4 }}>
        <Icon size={11} /> {label}
      </span>
      <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{value || "—"}</span>
    </div>
  );
}

function InfoRow({ icon: Icon, label, value }) {
  return (
    <div style={{ display: "flex", gap: 9, padding: "7px 0", borderBottom: "1px solid var(--border)" }}>
      <Icon size={15} style={{ color: "var(--text-muted)", marginTop: 2, flexShrink: 0 }} />
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".4px", color: "var(--text-muted)" }}>{label}</div>
        <div style={{ fontSize: 13, color: "var(--text)", wordBreak: "break-word" }}>{value || "—"}</div>
      </div>
    </div>
  );
}

function KPI({ label, value, sub, color, money }) {
  return (
    <div className="stat-card">
      <div className="stat-label">{label}</div>
      <div className={money ? "stat-value stat-value-money" : "stat-value"} style={{ color }}>{value}</div>
      <div className="stat-sub">{sub}</div>
    </div>
  );
}

function Tabla({ cabeceras, children }) {
  return (
    <div className="table-scroll" style={{ maxHeight: 520 }}>
      <table className="data-table" style={{ width: "100%" }}>
        <thead>
          <tr>
            {cabeceras.map((h, i) => (
              <th key={h} style={i === cabeceras.length - 1 ? { textAlign: "right" } : undefined}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function Vacio({ texto }) {
  return <div style={{ padding: "24px 0", textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>{texto}</div>;
}

function Donut({ datos, total }) {
  const R = 52, C = 2 * Math.PI * R;
  let acc = 0;
  return (
    <div style={{ display: "flex", justifyContent: "center" }}>
      <svg width="140" height="140" viewBox="0 0 140 140">
        <circle cx="70" cy="70" r={R} fill="none" stroke="var(--bg)" strokeWidth="16" />
        {total > 0 && datos.map((s, i) => {
          const frac = s.monto / total;
          const dash = frac * C;
          const el = (
            <circle
              key={s.categoria} cx="70" cy="70" r={R} fill="none"
              stroke={COLORES_CAT[i % COLORES_CAT.length]} strokeWidth="16"
              strokeDasharray={`${dash} ${C - dash}`}
              strokeDashoffset={-acc * C}
              transform="rotate(-90 70 70)"
            />
          );
          acc += frac;
          return el;
        })}
        <text x="70" y="66" textAnchor="middle" style={{ fontSize: 13, fontWeight: 700, fill: "var(--text)" }}>{fmtCLP(total)}</text>
        <text x="70" y="82" textAnchor="middle" style={{ fontSize: 10, fill: "var(--text-muted)" }}>Total</text>
      </svg>
    </div>
  );
}

function ModalEditarCliente({ cliente, esAdmin, vendedores, onCerrar, onGuardado, onError }) {
  const [tipoCliente, setTipoCliente] = useState(cliente.tipo_cliente || "");
  const [rut, setRut] = useState(cliente.rut || "");
  const [nombre, setNombre] = useState(cliente.nombre || "");
  const [departamento, setDepartamento] = useState(cliente.departamento || "");
  const [municipalidad, setMunicipalidad] = useState(cliente.municipalidad || "");
  const [region, setRegion] = useState(cliente.region || "");
  const [comuna, setComuna] = useState(cliente.comuna || "");
  const [direccion, setDireccion] = useState(cliente.direccion || "");
  const [contacto, setContacto] = useState(cliente.contacto || "");
  const [email, setEmail] = useState(cliente.email || "");
  const [telefono, setTelefono] = useState(cliente.telefono || "");
  const [condVenta, setCondVenta] = useState(cliente.condiciones_venta || "");
  const [vendedorAsignado, setVendedorAsignado] = useState(cliente.vendedor_asignado || "");
  const [guardando, setGuardando] = useState(false);

  const condVentaOriginal = cliente.condiciones_venta || "";
  const esParticular = tipoCliente === "Cliente Particular";
  // Crédito "30 días" en cliente particular: solo el administrador puede autorizarlo.
  const bloquea30 = esParticular && !esAdmin;
  const comunasDisponibles = REGIONES_CHILE?.[region] ?? [];

  const opcionesVendedores = useMemo(() => {
    const roles = ["ventas", "ventas_especial", "jefe_ventas", "jefe_ventas_especial"];
    const map = {};
    (vendedores || []).forEach((p) => {
      const e = (p?.email || "").trim().toLowerCase();
      if (e) map[e] = (p?.nombre || "").trim();
    });
    const lista = (vendedores || [])
      .filter((p) => roles.includes((p?.rol || "").toString().trim().toLowerCase()))
      .map((p) => ({ value: (p?.email || "").trim().toLowerCase(), label: (p?.nombre || p?.email || "").trim() }))
      .filter((o) => o.value);
    const actual = (vendedorAsignado || "").trim().toLowerCase();
    if (actual && !lista.some((o) => o.value === actual)) lista.push({ value: actual, label: map[actual] || vendedorAsignado });
    return lista.sort((a, b) => a.label.localeCompare(b.label));
  }, [vendedores, vendedorAsignado]);

  async function guardar(e) {
    e.preventDefault();
    if (!tipoCliente || !rut || !nombre || !region || !comuna || !direccion || !contacto || !email) {
      onError?.("Debes completar todos los campos obligatorios.");
      return;
    }
    if (bloquea30 && condVenta === "30 días" && condVentaOriginal !== "30 días") {
      onError?.("Solo el administrador puede autorizar el crédito de '30 días' a un cliente particular.");
      return;
    }
    setGuardando(true);
    try {
      const payload = {
        tipo_cliente: tipoCliente, rut, nombre, departamento, municipalidad,
        region, comuna, direccion, contacto, email, telefono,
        condiciones_venta: condVenta,
      };
      if (esAdmin) payload.vendedor_asignado = (vendedorAsignado || "").trim() || null;
      const actualizado = await api.put(`/clientes/${cliente.id}`, payload);
      onGuardado?.(actualizado || payload);
    } catch (err) {
      console.error(err);
      onError?.("No se pudieron guardar los cambios.");
    } finally {
      setGuardando(false);
    }
  }

  return createPortal(
    <div onClick={onCerrar} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.55)", zIndex: 11000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <form onClick={(e) => e.stopPropagation()} onSubmit={guardar} style={{ width: 560, maxWidth: "100%", maxHeight: "92vh", overflow: "auto", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-lg)" }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)" }}>
          <strong style={{ fontSize: 16 }}>Editar datos del cliente</strong>
        </div>
        <div style={{ padding: "18px 20px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <div className="field">
            <label className="field-label">Tipo de Cliente *</label>
            <select className="input" value={tipoCliente} onChange={(e) => setTipoCliente(e.target.value)}>
              <option value="">Seleccione…</option>
              <option value="Cliente Particular">Cliente Particular</option>
              <option value="Entidad Pública">Entidad Pública</option>
            </select>
          </div>
          <div className="field"><label className="field-label">RUT *</label><input className="input" value={rut} onChange={(e) => setRut(e.target.value)} /></div>
          <div className="field"><label className="field-label">Nombre *</label><input className="input" value={nombre} onChange={(e) => setNombre(e.target.value)} /></div>
          <div className="field"><label className="field-label">Departamento</label><input className="input" value={departamento} onChange={(e) => setDepartamento(e.target.value)} /></div>
          <div className="field"><label className="field-label">Municipalidad</label><input className="input" value={municipalidad} onChange={(e) => setMunicipalidad(e.target.value)} /></div>
          <div className="field">
            <label className="field-label">Región *</label>
            <select className="input" value={region} onChange={(e) => { setRegion((e.target.value || "").trim()); setComuna(""); }}>
              <option value="">Seleccione región</option>
              {Object.keys(REGIONES_CHILE || {}).map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div className="field">
            <label className="field-label">Comuna *</label>
            <select className="input" value={comuna} onChange={(e) => setComuna((e.target.value || "").trim())} disabled={!region}>
              <option value="">{region ? "Seleccione comuna" : "Seleccione región primero"}</option>
              {(comunasDisponibles ?? []).map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="field"><label className="field-label">Dirección *</label><input className="input" value={direccion} onChange={(e) => setDireccion(e.target.value)} /></div>
          <div className="field"><label className="field-label">Contacto *</label><input className="input" value={contacto} onChange={(e) => setContacto(e.target.value)} /></div>
          <div className="field"><label className="field-label">Email *</label><input type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
          <div className="field"><label className="field-label">Teléfono</label><input className="input" value={telefono} onChange={(e) => setTelefono(e.target.value)} /></div>
          <div className="field">
            <label className="field-label">Condiciones de Venta</label>
            <select className="input" value={condVenta} onChange={(e) => setCondVenta(e.target.value)}>
              <option value="">Seleccione…</option>
              <option value="30 días" disabled={bloquea30 && condVentaOriginal !== "30 días"}>30 días</option>
              <option value="Contado">Contado</option>
            </select>
            {bloquea30 && condVentaOriginal !== "30 días" && (
              <div className="field-hint">El crédito "30 días" para particulares solo lo autoriza el administrador.</div>
            )}
          </div>
          <div className="field" style={{ gridColumn: "1 / -1" }}>
            <label className="field-label">Vendedor Asignado</label>
            {esAdmin ? (
              <select className="input" value={(vendedorAsignado || "").trim().toLowerCase()} onChange={(e) => setVendedorAsignado(e.target.value)}>
                <option value="">Sin asignar</option>
                {opcionesVendedores.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            ) : (
              <input className="input" style={{ background: "var(--bg)" }} readOnly value={vendedorAsignado || "Sin asignar"} />
            )}
            <div className="field-hint">{esAdmin ? "Solo el administrador puede reasignar el vendedor." : "Solo el administrador puede cambiarlo."}</div>
          </div>
        </div>
        <div style={{ padding: "14px 20px", borderTop: "1px solid var(--border)", display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button type="button" className="btn btn-secondary" onClick={onCerrar} disabled={guardando}>Cancelar</button>
          <button type="submit" className="btn btn-primary" disabled={guardando}>{guardando ? "Guardando…" : "Guardar cambios"}</button>
        </div>
      </form>
    </div>,
    document.body,
  );
}

function ModalContacto({ contacto, onCerrar, onGuardar }) {
  const [form, setForm] = useState({
    id: contacto?.id,
    nombre: contacto?.nombre || "",
    cargo: contacto?.cargo || "",
    email: contacto?.email || "",
    telefono: contacto?.telefono || "",
    influencia: contacto?.influencia || "",
    cumpleanos: contacto?.cumpleanos || "",
  });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  function submit(e) {
    e.preventDefault();
    if (!form.nombre.trim()) return;
    onGuardar({ ...form, influencia: form.influencia || null });
  }

  return createPortal(
    <div onClick={onCerrar} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.55)", zIndex: 11000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <form onClick={(e) => e.stopPropagation()} onSubmit={submit} style={{ width: 420, maxWidth: "100%", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", overflow: "hidden", boxShadow: "var(--shadow-lg)" }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)" }}>
          <strong style={{ fontSize: 15 }}>{form.id ? "Editar contacto" : "Nuevo contacto"}</strong>
        </div>
        <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 12 }}>
          <div className="field"><label className="field-label">Nombre *</label><input className="input" value={form.nombre} onChange={set("nombre")} /></div>
          <div className="field"><label className="field-label">Cargo</label><input className="input" value={form.cargo} onChange={set("cargo")} /></div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div className="field"><label className="field-label">Teléfono</label><input className="input" value={form.telefono} onChange={set("telefono")} /></div>
            <div className="field">
              <label className="field-label">Influencia</label>
              <select className="input" value={form.influencia} onChange={set("influencia")}>
                <option value="">—</option>
                <option value="Alta">Alta</option>
                <option value="Media">Media</option>
                <option value="Baja">Baja</option>
              </select>
            </div>
          </div>
          <div className="field"><label className="field-label">Email</label><input className="input" type="email" value={form.email} onChange={set("email")} /></div>
          <div className="field"><label className="field-label">Cumpleaños</label><input className="input" placeholder="Ej. 12 Marzo" value={form.cumpleanos} onChange={set("cumpleanos")} /></div>
        </div>
        <div style={{ padding: "14px 20px", borderTop: "1px solid var(--border)", display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button type="button" className="btn btn-secondary" onClick={onCerrar}>Cancelar</button>
          <button type="submit" className="btn btn-primary">Guardar</button>
        </div>
      </form>
    </div>,
    document.body,
  );
}

/* ─── Estilos inline reutilizados ─────────────────────────────────────── */
const lnkVolver = { fontSize: 13, color: "var(--text-muted)", textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 5, marginBottom: 12 };
const badge = { display: "inline-flex", alignItems: "center", padding: "3px 10px", borderRadius: 999, fontSize: 11, fontWeight: 600 };
const miniRow = { fontSize: 11.5, color: "var(--text-soft)", display: "flex", alignItems: "center", gap: 5, marginTop: 2 };

// Badge del estado de cobranza EFECTIVO (resultado tras aplicar el override).
function EstadoCobranzaBadge({ mora }) {
  const dias = Number(mora?.diasAtrasoMax || 0);
  const umbral = Number(mora?.umbral || 0);
  if (mora?.bloqueado) {
    const forzado = mora.override === "bloqueado";
    return (
      <span style={{ ...badge, background: "#fee2e2", color: "#b91c1c", display: "inline-flex", alignItems: "center", gap: 5 }}
        title={forzado ? "Bloqueado manualmente por un administrador" : `Mora de ${dias} días (umbral ${umbral})`}>
        <AlertTriangle size={12} /> Bloqueado{forzado ? " (forzado)" : ` · ${dias}d`}
      </span>
    );
  }
  if (mora?.override === "desbloqueado") {
    return (
      <span style={{ ...badge, background: "#fef3c7", color: "#92400e" }}
        title={`Desbloqueado manualmente por un administrador${dias ? ` (mora de ${dias} días)` : ""}`}>
        Desbloqueado{dias >= umbral && dias > 0 ? ` · ${dias}d` : ""}
      </span>
    );
  }
  return (
    <span style={{ ...badge, background: "#dcfce7", color: "#15803d" }}
      title={dias ? `Atraso máximo ${dias} días (umbral ${umbral})` : "Sin facturas vencidas"}>
      Al día
    </span>
  );
}
function tlIcon(clase) {
  const c = clase === "documento" ? { bg: "#eff6ff", color: "#3b82f6" } : { bg: "var(--primary-light)", color: "var(--primary-dark)" };
  return { width: 30, height: 30, borderRadius: "50%", background: c.bg, color: c.color, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 };
}
