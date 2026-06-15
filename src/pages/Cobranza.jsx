import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { supabase } from "../lib/supabase";
import useAuth from "../hooks/useAuth";
import Toast from "../components/Toast";
import {
  Phone,
  Mail,
  MessageCircle,
  StickyNote,
  Eye,
  Send,
  Paperclip,
  X,
  Loader2,
  History,
  AlertTriangle,
  MapPin,
  ChevronDown,
  Check,
} from "lucide-react";

/* ── Helpers de fechas/plazos (mismo criterio que Seguimiento de Pagos) ── */
function diasEntre(fechaIso) {
  if (!fechaIso) return null;
  const f = new Date(`${fechaIso}T00:00:00`);
  if (Number.isNaN(f.getTime())) return null;
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  return Math.floor((hoy.getTime() - f.getTime()) / (1000 * 60 * 60 * 24));
}

function plazoDias(condVenta) {
  const c = (condVenta || "").toString().toLowerCase();
  const m = c.match(/(\d+)/);
  if (m) return Number(m[1]);
  if (c.includes("contado")) return 0;
  return 30;
}

function calcularFechaVencimiento(fechaFacturaIso, condVenta) {
  if (!fechaFacturaIso) return null;
  const f = new Date(`${fechaFacturaIso}T00:00:00`);
  if (Number.isNaN(f.getTime())) return null;
  f.setDate(f.getDate() + plazoDias(condVenta));
  return f;
}

function fmtCLP(value) {
  return `$${Number(value || 0).toLocaleString("es-CL")}`;
}

// Los montos de documentos se guardan NETOS; el monto a cobrar es con IVA.
function brutoDesdeNeto(neto) {
  return Math.round(Number(neto || 0) * 1.19);
}

function fmtDateCL(d) {
  if (!d) return "—";
  if (typeof d === "string") return new Date(`${d}T00:00:00`).toLocaleDateString("es-CL");
  return d.toLocaleDateString("es-CL");
}

function fmtFechaHora(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("es-CL", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

/* ── Catálogos ──────────────────────────────────────────────────────── */
const ESTADOS_COBRANZA = [
  { value: "sin_gestion", label: "Sin gestión", color: "#6b7280", bg: "#f3f4f6" },
  { value: "en_gestion", label: "En gestión", color: "#1d4ed8", bg: "#dbeafe" },
  { value: "comprometido", label: "Pago comprometido", color: "#b45309", bg: "#fef3c7" },
  { value: "pagada", label: "Pagada", color: "#15803d", bg: "#dcfce7" },
  { value: "incobrable", label: "Incobrable", color: "#b91c1c", bg: "#fee2e2" },
];
const ESTADO_MAP = Object.fromEntries(ESTADOS_COBRANZA.map((e) => [e.value, e]));

/* ── Dropdown custom de estado de cobranza (pill de color + menú con portal) ── */
function EstadoCobranzaDropdown({ value, onChange, disabled }) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState(null);
  const btnRef = useRef(null);
  const actual = ESTADO_MAP[value] || ESTADOS_COBRANZA[0];

  function toggle() {
    if (disabled) return;
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setCoords({ left: r.left, top: r.bottom + 4, width: r.width });
    }
    setOpen((o) => !o);
  }

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={toggle}
        disabled={disabled}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          height: 30,
          padding: "0 10px",
          borderRadius: 999,
          border: `1.5px solid ${actual.color}40`,
          background: actual.bg,
          color: actual.color,
          fontSize: 12,
          fontWeight: 700,
          cursor: disabled ? "default" : "pointer",
          whiteSpace: "nowrap",
        }}
      >
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: actual.color, flexShrink: 0 }} />
        {actual.label}
        {!disabled && <ChevronDown size={13} style={{ opacity: 0.7 }} />}
      </button>
      {open && coords && createPortal(
        <>
          <div onMouseDown={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 11000 }} />
          <div
            style={{
              position: "fixed",
              left: coords.left,
              top: coords.top,
              minWidth: Math.max(190, coords.width),
              zIndex: 11001,
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: 10,
              boxShadow: "var(--shadow-lg)",
              padding: 4,
            }}
          >
            {ESTADOS_COBRANZA.map((op) => {
              const sel = op.value === value;
              return (
                <button
                  key={op.value}
                  type="button"
                  onClick={() => { onChange(op.value); setOpen(false); }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    width: "100%",
                    textAlign: "left",
                    padding: "8px 10px",
                    border: "none",
                    background: sel ? `${op.color}14` : "transparent",
                    color: "var(--text)",
                    fontSize: 12.5,
                    fontWeight: 600,
                    cursor: "pointer",
                    borderRadius: 6,
                  }}
                  onMouseEnter={(e) => { if (!sel) e.currentTarget.style.background = "var(--bg)"; }}
                  onMouseLeave={(e) => { if (!sel) e.currentTarget.style.background = "transparent"; }}
                >
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: op.color, flexShrink: 0 }} />
                  <span style={{ flex: 1 }}>{op.label}</span>
                  {sel && <Check size={13} style={{ color: op.color }} />}
                </button>
              );
            })}
          </div>
        </>,
        document.body,
      )}
    </>
  );
}

const TIPOS_GESTION = [
  { value: "llamada", label: "Llamada", icon: Phone, color: "#0d9488" },
  { value: "correo", label: "Correo", icon: Mail, color: "#1d4ed8" },
  { value: "whatsapp", label: "WhatsApp", icon: MessageCircle, color: "#15803d" },
  { value: "visita_terreno", label: "Visita a terreno", icon: MapPin, color: "#7c3aed" },
  { value: "nota", label: "Nota", icon: StickyNote, color: "#b45309" },
];
const TIPO_GESTION_MAP = Object.fromEntries(TIPOS_GESTION.map((t) => [t.value, t]));
// Tipos disponibles para registrar/ filtrar (sin "Nota"). El MAP conserva "nota"
// para seguir mostrando gestiones antiguas de ese tipo.
const TIPOS_GESTION_SEL = TIPOS_GESTION.filter((t) => t.value !== "nota");

const ROLES_COBRANZA = ["admin", "administrador", "contabilidad", "jefe_ventas_especial"];

export default function Cobranza() {
  const { user, perfil, rol, cargando } = useAuth();
  const rolNorm = (rol ?? "").toString().trim().toLowerCase();
  const puedeVer = ROLES_COBRANZA.includes(rolNorm);
  const yoEmail = (user?.email || "").trim().toLowerCase();
  const yoNombre = perfil?.nombre || user?.email || "Usuario";

  const [facturas, setFacturas] = useState([]);
  const [ocs, setOcs] = useState([]); // órdenes de compra (para filtro OC y monto de factura pública)
  const [guiasPorLic, setGuiasPorLic] = useState({}); // licitacion_id → guía de despacho
  const [licMap, setLicMap] = useState({});
  const [estadosMap, setEstadosMap] = useState({}); // documento_id -> { estado, ... }
  const [gestionesPorDoc, setGestionesPorDoc] = useState({}); // documento_id -> [gestiones]
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);

  // Pestañas
  const [tab, setTab] = useState("vencidas"); // "vencidas" | "historial"

  // Filtros (Vencidas)
  const [filtroEntidad, setFiltroEntidad] = useState("");
  const [filtroNumero, setFiltroNumero] = useState("");
  const [filtroOC, setFiltroOC] = useState("");
  const [filtroCotId, setFiltroCotId] = useState("");
  const [filtroTipoCotizacion, setFiltroTipoCotizacion] = useState("");
  const [filtroEstado, setFiltroEstado] = useState("");

  // Filtros (Historial de gestiones)
  const [hEntidad, setHEntidad] = useState("");
  const [hNumero, setHNumero] = useState("");
  const [hTipo, setHTipo] = useState("");

  // Modales
  const [modalGestion, setModalGestion] = useState(null); // { doc, lic }
  const [modalCorreo, setModalCorreo] = useState(null); // { doc, lic }

  const [reloadKey, setReloadKey] = useState(0);
  const recargar = () => setReloadKey((k) => k + 1);

  useEffect(() => {
    if (cargando || !puedeVer) return;
    let activo = true;

    async function load() {
      setLoading(true);
      try {
        const licsAdj = await api.get(
          "/licitaciones/with-fields?fields=id,id_licitacion,nombre_entidad,rut_entidad,fecha_adjudicada,total_con_iva,creado_por,condicion_venta,comuna,estado,tipo_compra,tipo_cliente",
        );
        const rows = (licsAdj || []).filter((l) => l.estado === "Adjudicada");
        const mapa = {};
        rows.forEach((l) => { mapa[l.id] = l; });

        const ids = rows.map((l) => l.id);
        let docs = [];
        let ordenes = [];
        const guiasMap = {};
        if (ids.length > 0) {
          const [fact, boletas, guias, ocsResp] = await Promise.all([
            api.post("/licitaciones/documentos/filter", {
              filter: { licitacion_ids: ids, tipo: "factura" },
              fields: "*",
            }),
            api.post("/licitaciones/documentos/filter", {
              filter: { licitacion_ids: ids, tipo: "factura_boleta" },
              fields: "*",
            }),
            api.post("/licitaciones/documentos/filter", {
              filter: { licitacion_ids: ids, tipo: "guia_despacho" },
              fields: "*",
            }),
            api.post("/licitaciones/documentos/filter", {
              filter: { licitacion_ids: ids, tipo: "orden_compra" },
              fields: "*",
            }),
          ]);
          docs = [...(fact || []), ...(boletas || [])];
          ordenes = ocsResp || [];
          // Última guía de despacho por cotización (para auto-adjuntar al correo).
          (guias || []).forEach((g) => {
            const lid = g.licitacion_id;
            const prev = guiasMap[lid];
            const fa = String(g.fecha_oc || g.created_at || "");
            const fp = prev ? String(prev.fecha_oc || prev.created_at || "") : "";
            if (!prev || fa > fp) guiasMap[lid] = g;
          });
        }

        // Estados y gestiones de cobranza (Supabase directo, con RLS).
        const [{ data: estados }, { data: gestiones }] = await Promise.all([
          supabase.from("cobranza_estados").select("*"),
          supabase.from("cobranza_gestiones").select("*").order("created_at", { ascending: false }),
        ]);

        if (!activo) return;
        setLicMap(mapa);
        setFacturas(docs);
        setOcs(ordenes);
        setGuiasPorLic(guiasMap);

        const em = {};
        (estados || []).forEach((e) => { em[e.documento_id] = e; });
        setEstadosMap(em);

        const gm = {};
        (gestiones || []).forEach((g) => {
          if (!gm[g.documento_id]) gm[g.documento_id] = [];
          gm[g.documento_id].push(g);
        });
        setGestionesPorDoc(gm);
      } catch (e) {
        console.error(e);
        if (activo) setToast({ type: "error", message: "Error cargando la cobranza." });
      } finally {
        if (activo) setLoading(false);
      }
    }

    load();
    return () => { activo = false; };
  }, [cargando, puedeVer, reloadKey]);

  // Facturas/boletas vencidas y no pagadas.
  const vencidas = useMemo(() => {
    return facturas
      .filter((f) => {
        const lic = licMap[f.licitacion_id];
        if (!lic) return false;
        if (f.pagada) return false;
        const dias = diasEntre(f.fecha_factura);
        const restantes = dias != null ? plazoDias(lic.condicion_venta) - dias : null;
        return restantes != null && restantes < 0;
      })
      .sort((a, b) => {
        // Más vencida primero.
        const da = diasEntre(a.fecha_factura) ?? 0;
        const db = diasEntre(b.fecha_factura) ?? 0;
        return db - da;
      });
  }, [facturas, licMap]);

  // OC por documento (resolver deriva_de_id) y por cotización (filtro + monto).
  const ocById = useMemo(() => {
    const m = {};
    ocs.forEach((o) => { m[o.id] = o; });
    return m;
  }, [ocs]);

  const ocPorLic = useMemo(() => {
    const m = {};
    ocs.forEach((o) => {
      const k = String(o.licitacion_id);
      if (!m[k]) m[k] = [];
      m[k].push(o);
    });
    return m;
  }, [ocs]);

  // Monto a cobrar (con IVA) tomado de la FACTURA, no de la cotización:
  //  - particular: factura_boleta.monto (neto) → bruto
  //  - pública: la factura deriva de una OC; si no, suma de OC de la cotización
  //  - fallback final: total con IVA de la cotización
  const montoFacturaBruto = useCallback((f, lic) => {
    const neto = Number(f?.monto || 0);
    if (neto > 0) return brutoDesdeNeto(neto);
    const ocDeriva = f?.deriva_de_id != null ? ocById[f.deriva_de_id] : null;
    if (ocDeriva && Number(ocDeriva.monto) > 0) return brutoDesdeNeto(ocDeriva.monto);
    const ocsLic = ocPorLic[String(f?.licitacion_id)] || [];
    const sumaOc = ocsLic.reduce((acc, o) => acc + Number(o.monto || 0), 0);
    if (sumaOc > 0) return brutoDesdeNeto(sumaOc);
    return Number(lic?.total_con_iva || 0) || 0;
  }, [ocById, ocPorLic]);

  const tiposCotizacion = useMemo(() => {
    const set = new Set();
    Object.values(licMap || {}).forEach((l) => {
      const t = (l?.tipo_cliente || "").toString().trim();
      if (t) set.add(t);
    });
    return [...set].sort();
  }, [licMap]);

  const filtradas = useMemo(() => {
    return vencidas.filter((f) => {
      const lic = licMap[f.licitacion_id];
      if (!lic) return false;
      if (filtroEntidad && !(lic.nombre_entidad || "").toLowerCase().includes(filtroEntidad.toLowerCase())) return false;
      if (filtroNumero && !(f.numero || "").toString().toLowerCase().includes(filtroNumero.toLowerCase())) return false;
      if (filtroCotId) {
        const q = filtroCotId.trim().toLowerCase();
        const idTxt = `${lic.id ?? ""}`.toLowerCase();
        const idLicTxt = `${lic.id_licitacion || ""}`.toLowerCase();
        if (!idTxt.includes(q) && !idLicTxt.includes(q)) return false;
      }
      if (filtroOC) {
        const q = filtroOC.trim().toLowerCase();
        const ocsLic = ocPorLic[String(f.licitacion_id)] || [];
        const match = ocsLic.some((o) => (o.numero || "").toString().toLowerCase().includes(q));
        if (!match) return false;
      }
      if (filtroTipoCotizacion && (lic.tipo_cliente || "").toString().trim() !== filtroTipoCotizacion) return false;
      if (filtroEstado) {
        const est = estadosMap[String(f.id)]?.estado || "sin_gestion";
        if (est !== filtroEstado) return false;
      }
      return true;
    });
  }, [vencidas, licMap, filtroEntidad, filtroNumero, filtroCotId, filtroOC, ocPorLic, filtroTipoCotizacion, filtroEstado, estadosMap]);

  const stats = useMemo(() => {
    let monto = 0, sinGestion = 0, enGestion = 0, comprometido = 0;
    vencidas.forEach((f) => {
      const lic = licMap[f.licitacion_id];
      monto += montoFacturaBruto(f, lic);
      const est = estadosMap[String(f.id)]?.estado || "sin_gestion";
      if (est === "sin_gestion") sinGestion++;
      else if (est === "en_gestion") enGestion++;
      else if (est === "comprometido") comprometido++;
    });
    return { cantidad: vencidas.length, monto, sinGestion, enGestion, comprometido };
  }, [vencidas, licMap, estadosMap, montoFacturaBruto]);

  // Historial: todas las gestiones registradas (cualquier cotización), filtrables.
  const historial = useMemo(() => {
    const todas = Object.values(gestionesPorDoc).flat();
    todas.sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
    const ent = hEntidad.trim().toLowerCase();
    const num = hNumero.trim().toLowerCase();
    return todas.filter((g) => {
      const lic = licMap[g.licitacion_id];
      if (ent) {
        const txt = `${lic?.nombre_entidad || ""} ${lic?.id ?? ""} ${lic?.id_licitacion || ""}`.toLowerCase();
        if (!txt.includes(ent)) return false;
      }
      if (num && !(g.numero || "").toString().toLowerCase().includes(num)) return false;
      if (hTipo && g.tipo !== hTipo) return false;
      return true;
    });
  }, [gestionesPorDoc, licMap, hEntidad, hNumero, hTipo]);

  const totalGestiones = useMemo(
    () => Object.values(gestionesPorDoc).reduce((acc, arr) => acc + arr.length, 0),
    [gestionesPorDoc],
  );

  async function abrirDocumento(doc) {
    if (!doc?.bucket || !doc?.storage_path) {
      setToast({ type: "error", message: "Este documento no tiene archivo asociado." });
      return;
    }
    try {
      const data = await api.get(
        `/licitaciones/storage/signed-url?bucket=${encodeURIComponent(doc.bucket)}&path=${encodeURIComponent(doc.storage_path)}`,
      );
      if (!data?.signedUrl) throw new Error();
      window.open(data.signedUrl, "_blank", "noopener,noreferrer");
    } catch {
      setToast({ type: "error", message: "No se pudo abrir el documento." });
    }
  }

  async function cambiarEstado(doc, lic, nuevo) {
    const documento_id = String(doc.id);
    const fila = {
      documento_id,
      licitacion_id: String(lic?.id ?? doc.licitacion_id ?? ""),
      numero: doc.numero || "",
      estado: nuevo,
      updated_at: new Date().toISOString(),
      updated_por: yoEmail,
    };
    setEstadosMap((prev) => ({ ...prev, [documento_id]: { ...(prev[documento_id] || {}), ...fila } }));
    const { error } = await supabase
      .from("cobranza_estados")
      .upsert(fila, { onConflict: "documento_id" });
    if (error) {
      setToast({ type: "error", message: "No se pudo guardar el estado." });
      recargar();
    }
  }

  async function registrarGestion({ doc, lic, tipo, detalle, correo }) {
    const documento_id = String(doc.id);
    const fila = {
      documento_id,
      licitacion_id: String(lic?.id ?? doc.licitacion_id ?? ""),
      numero: doc.numero || "",
      tipo,
      detalle: detalle || null,
      correo_para: correo?.para || null,
      correo_cc: correo?.cc?.length ? correo.cc : null,
      correo_asunto: correo?.asunto || null,
      adjuntos: correo?.adjuntos?.length ? correo.adjuntos : null,
      creado_por_email: yoEmail,
      creado_por_nombre: yoNombre,
      created_at: new Date().toISOString(),
    };
    const { data, error } = await supabase.from("cobranza_gestiones").insert(fila).select().single();
    if (error) throw error;
    setGestionesPorDoc((prev) => ({ ...prev, [documento_id]: [data, ...(prev[documento_id] || [])] }));
    // Primera gestión sobre una factura sin gestión → pasa a "en gestión".
    const est = estadosMap[documento_id]?.estado || "sin_gestion";
    if (est === "sin_gestion") await cambiarEstado(doc, lic, "en_gestion");
    return data;
  }

  if (cargando || loading) {
    return (
      <div className="page">
        <div className="page-header"><h1 className="page-title">Cobranza</h1></div>
        <p className="text-gray-500 text-sm mt-4">Cargando…</p>
      </div>
    );
  }

  if (!puedeVer) {
    return (
      <div className="page">
        <div className="surface">
          <div className="surface-body" style={{ color: "var(--danger)" }}>
            Acceso restringido: este módulo es para contabilidad y administración.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}

      <div className="page-header">
        <div>
          <h1 className="page-title">Cobranza</h1>
          <p className="page-subtitle">
            {tab === "vencidas"
              ? `Gestión de facturas y boletas vencidas — ${filtradas.length} de ${vencidas.length}`
              : `Historial de gestiones registradas — ${historial.length} de ${totalGestiones}`}
          </p>
        </div>
      </div>

      {/* Pestañas */}
      <div style={{ display: "flex", gap: 4, borderBottom: "1px solid var(--border)", marginBottom: 16 }}>
        {[
          { id: "vencidas", label: "Gestión de cobranza", count: vencidas.length },
          { id: "historial", label: "Historial de gestiones", count: totalGestiones },
        ].map((t) => {
          const activo = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 7,
                padding: "10px 16px",
                border: "none",
                background: "none",
                cursor: "pointer",
                fontSize: 13.5,
                fontWeight: 700,
                color: activo ? "var(--primary-dark)" : "var(--text-muted)",
                borderBottom: `2.5px solid ${activo ? "var(--primary)" : "transparent"}`,
                marginBottom: -1,
              }}
            >
              {t.label}
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  padding: "1px 8px",
                  borderRadius: 999,
                  background: activo ? "var(--primary-light)" : "var(--bg)",
                  color: activo ? "var(--primary-dark)" : "var(--text-muted)",
                }}
              >
                {t.count}
              </span>
            </button>
          );
        })}
      </div>

      {tab === "vencidas" && (
      <>
      {/* KPIs */}
      <div className="stats-row">
        <div className="stat-card">
          <div className="stat-label">Vencidas</div>
          <div className="stat-value" style={{ color: "var(--danger)" }}>{stats.cantidad}</div>
          <div className="stat-money" style={{ color: "var(--danger)" }}>{fmtCLP(stats.monto)}</div>
          <div className="stat-sub">por cobrar · con IVA</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Sin gestión</div>
          <div className="stat-value" style={{ color: "#6b7280" }}>{stats.sinGestion}</div>
          <div className="stat-sub">aún no contactadas</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">En gestión</div>
          <div className="stat-value" style={{ color: "#1d4ed8" }}>{stats.enGestion}</div>
          <div className="stat-sub">en seguimiento</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Comprometidas</div>
          <div className="stat-value" style={{ color: "var(--warning)" }}>{stats.comprometido}</div>
          <div className="stat-sub">con promesa de pago</div>
        </div>
      </div>

      {/* Filtros */}
      <div className="filter-bar">
        <div className="filter-field">
          <label className="filter-label">Entidad / Cliente</label>
          <input type="text" className="input" placeholder="Buscar…" value={filtroEntidad} onChange={(e) => setFiltroEntidad(e.target.value)} />
        </div>
        <div className="filter-field">
          <label className="filter-label">N° / ID Cotización</label>
          <input type="text" className="input" placeholder="N° o ID licitación…" value={filtroCotId} onChange={(e) => setFiltroCotId(e.target.value)} />
        </div>
        <div className="filter-field">
          <label className="filter-label">N° Orden de Compra</label>
          <input type="text" className="input" placeholder="Buscar OC…" value={filtroOC} onChange={(e) => setFiltroOC(e.target.value)} />
        </div>
        <div className="filter-field">
          <label className="filter-label">N° Factura / Boleta</label>
          <input type="text" className="input" placeholder="Buscar N°…" value={filtroNumero} onChange={(e) => setFiltroNumero(e.target.value)} />
        </div>
        <div className="filter-field">
          <label className="filter-label">Tipo de Cotización</label>
          <select className="input" value={filtroTipoCotizacion} onChange={(e) => setFiltroTipoCotizacion(e.target.value)}>
            <option value="">Todas</option>
            {tiposCotizacion.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div className="filter-field">
          <label className="filter-label">Estado de Cobranza</label>
          <select className="input" value={filtroEstado} onChange={(e) => setFiltroEstado(e.target.value)}>
            <option value="">Todos</option>
            {ESTADOS_COBRANZA.map((e) => <option key={e.value} value={e.value}>{e.label}</option>)}
          </select>
        </div>
      </div>

      {/* Tabla */}
      <div className="table-wrap" style={{ marginTop: 12 }}>
        <div className="table-scroll" style={{ maxHeight: "calc(100vh - 380px)", minHeight: 240 }}>
          <table className="data-table trazabilidad-table table-fit">
            <colgroup>
              <col style={{ width: "22%" }} />
              <col style={{ width: "12%" }} />
              <col style={{ width: "11%" }} />
              <col style={{ width: "10%" }} />
              <col style={{ width: "15%" }} />
              <col style={{ width: "15%" }} />
              <col style={{ width: "15%" }} />
            </colgroup>
            <thead>
              <tr>
                <th style={{ textAlign: "left" }}>Cotización / Cliente</th>
                <th style={{ textAlign: "left" }}>Factura / Boleta</th>
                <th style={{ textAlign: "right" }}>Monto</th>
                <th style={{ textAlign: "left" }}>Vencida</th>
                <th style={{ textAlign: "left" }}>Estado cobranza</th>
                <th style={{ textAlign: "left" }}>Última gestión</th>
                <th style={{ textAlign: "right" }}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filtradas.length === 0 ? (
                <tr>
                  <td colSpan="7" style={{ textAlign: "center", padding: "60px 0", color: "var(--text-muted)" }}>
                    No hay facturas vencidas con los filtros aplicados.
                  </td>
                </tr>
              ) : (
                filtradas.map((f) => {
                  const lic = licMap[f.licitacion_id];
                  if (!lic) return null;
                  const documento_id = String(f.id);
                  const dias = diasEntre(f.fecha_factura);
                  const restantes = dias != null ? plazoDias(lic.condicion_venta) - dias : null;
                  const venc = calcularFechaVencimiento(f.fecha_factura, lic.condicion_venta);
                  const estado = estadosMap[documento_id]?.estado || "sin_gestion";
                  const gestiones = gestionesPorDoc[documento_id] || [];
                  const ultima = gestiones[0];
                  const esParticular = (lic.tipo_cliente || "").toLowerCase().includes("particular");
                  return (
                    <tr key={documento_id}>
                      <td style={{ verticalAlign: "middle" }}>
                        <Link to={`/detalle/${lic.id}`} className="table-link" style={{ fontWeight: 600 }}>#{lic.id}</Link>
                        {lic.id_licitacion && <span style={{ color: "var(--text-muted)", fontSize: 11, marginLeft: 6 }}>{lic.id_licitacion}</span>}
                        <div style={{ fontWeight: 500, fontSize: 13, color: "#1f2937", marginTop: 2 }}>{lic.nombre_entidad || "—"}</div>
                        <span
                          style={{
                            display: "inline-block",
                            marginTop: 3,
                            fontSize: 10.5,
                            fontWeight: 700,
                            padding: "1px 8px",
                            borderRadius: 999,
                            color: esParticular ? "#7c3aed" : "#0369a1",
                            background: esParticular ? "#f3e8ff" : "#e0f2fe",
                          }}
                        >
                          {esParticular ? "Privada" : "Pública"}
                        </span>
                      </td>
                      <td style={{ verticalAlign: "middle" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <span style={{ fontWeight: 500, color: "#1f2937" }}>{f.numero || "S/N"}</span>
                          <button
                            type="button"
                            onClick={() => abrirDocumento(f)}
                            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--primary)", padding: 0 }}
                            title="Ver documento"
                          >
                            <Eye size={13} />
                          </button>
                        </div>
                        <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{fmtDateCL(f.fecha_factura)}</div>
                      </td>
                      <td style={{ verticalAlign: "middle", textAlign: "right", fontWeight: 600, whiteSpace: "nowrap" }}>
                        {(() => { const m = montoFacturaBruto(f, lic); return m > 0 ? fmtCLP(m) : "—"; })()}
                      </td>
                      <td style={{ verticalAlign: "middle" }}>
                        <div style={{ color: "#1f2937", fontWeight: 500 }}>{fmtDateCL(venc)}</div>
                        <div style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 11, color: "#dc2626", fontWeight: 600 }}>
                          <AlertTriangle size={11} /> {restantes != null ? `Hace ${Math.abs(restantes)}d` : "—"}
                        </div>
                      </td>
                      <td style={{ verticalAlign: "middle" }}>
                        <EstadoCobranzaDropdown
                          value={estado}
                          onChange={(v) => cambiarEstado(f, lic, v)}
                        />
                      </td>
                      <td style={{ verticalAlign: "middle" }}>
                        {ultima ? (
                          <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 600, color: TIPO_GESTION_MAP[ultima.tipo]?.color || "#1f2937" }}>
                              {(() => { const I = TIPO_GESTION_MAP[ultima.tipo]?.icon; return I ? <I size={12} /> : null; })()}
                              {TIPO_GESTION_MAP[ultima.tipo]?.label || ultima.tipo}
                            </span>
                            <span style={{ fontSize: 10.5, color: "var(--text-muted)" }}>{fmtFechaHora(ultima.created_at)}</span>
                            {ultima.detalle && (
                              <span style={{ fontSize: 11, color: "#475569", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 180 }} title={ultima.detalle}>
                                {ultima.detalle}
                              </span>
                            )}
                          </div>
                        ) : (
                          <span style={{ color: "var(--text-muted)", fontSize: 12 }}>Sin gestiones</span>
                        )}
                      </td>
                      <td style={{ verticalAlign: "middle", textAlign: "right" }}>
                        <div className="btn-row" style={{ justifyContent: "flex-end", flexWrap: "wrap", gap: 6 }}>
                          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setModalGestion({ doc: f, lic })} title="Bitácora / registrar gestión">
                            <History size={13} />
                            {gestiones.length > 0 && <span style={{ marginLeft: 4 }}>{gestiones.length}</span>}
                          </button>
                          <button type="button" className="btn btn-primary btn-sm" onClick={() => setModalCorreo({ doc: f, lic })} title="Enviar correo de cobranza">
                            <Mail size={13} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
      </>
      )}

      {tab === "historial" && (
      <>
        {/* Filtros del historial */}
        <div className="filter-bar">
          <div className="filter-field">
            <label className="filter-label">Cotización / Entidad</label>
            <input type="text" className="input" placeholder="N° cotización, ID o entidad…" value={hEntidad} onChange={(e) => setHEntidad(e.target.value)} />
          </div>
          <div className="filter-field">
            <label className="filter-label">N° Factura / Boleta</label>
            <input type="text" className="input" placeholder="Buscar N°…" value={hNumero} onChange={(e) => setHNumero(e.target.value)} />
          </div>
          <div className="filter-field">
            <label className="filter-label">Tipo de gestión</label>
            <select className="input" value={hTipo} onChange={(e) => setHTipo(e.target.value)}>
              <option value="">Todas</option>
              {TIPOS_GESTION_SEL.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
        </div>

        {/* Tabla del historial */}
        <div className="table-wrap" style={{ marginTop: 12 }}>
          <div className="table-scroll" style={{ maxHeight: "calc(100vh - 360px)", minHeight: 240 }}>
            <table className="data-table table-fit">
              <colgroup>
                <col style={{ width: "14%" }} />
                <col style={{ width: "24%" }} />
                <col style={{ width: "12%" }} />
                <col style={{ width: "13%" }} />
                <col style={{ width: "37%" }} />
              </colgroup>
              <thead>
                <tr>
                  <th style={{ textAlign: "left" }}>Fecha</th>
                  <th style={{ textAlign: "left" }}>Cotización / Cliente</th>
                  <th style={{ textAlign: "left" }}>Factura / Boleta</th>
                  <th style={{ textAlign: "left" }}>Tipo</th>
                  <th style={{ textAlign: "left" }}>Detalle</th>
                </tr>
              </thead>
              <tbody>
                {historial.length === 0 ? (
                  <tr>
                    <td colSpan="5" style={{ textAlign: "center", padding: "60px 0", color: "var(--text-muted)" }}>
                      No hay gestiones con los filtros aplicados.
                    </td>
                  </tr>
                ) : (
                  historial.map((g) => {
                    const lic = licMap[g.licitacion_id];
                    const meta = TIPO_GESTION_MAP[g.tipo];
                    const I = meta?.icon || StickyNote;
                    return (
                      <tr key={g.id}>
                        <td style={{ verticalAlign: "top", whiteSpace: "nowrap", fontSize: 12, color: "var(--text-muted)" }}>
                          {fmtFechaHora(g.created_at)}
                        </td>
                        <td style={{ verticalAlign: "top" }}>
                          {lic ? (
                            <>
                              <Link to={`/detalle/${lic.id}`} className="table-link" style={{ fontWeight: 600 }}>#{lic.id}</Link>
                              {lic.id_licitacion && <span style={{ color: "var(--text-muted)", fontSize: 11, marginLeft: 6 }}>{lic.id_licitacion}</span>}
                              <div style={{ fontSize: 12.5, color: "#1f2937", marginTop: 2 }}>{lic.nombre_entidad || "—"}</div>
                              <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 1 }}>RUT: {lic.rut_entidad || "—"}</div>
                            </>
                          ) : (
                            <span style={{ color: "var(--text-muted)", fontSize: 12 }}>Cotización #{g.licitacion_id}</span>
                          )}
                        </td>
                        <td style={{ verticalAlign: "top", fontSize: 13, color: "#1f2937" }}>{g.numero || "S/N"}</td>
                        <td style={{ verticalAlign: "top" }}>
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12.5, fontWeight: 600, color: meta?.color || "#1f2937" }}>
                            <I size={13} /> {meta?.label || g.tipo}
                          </span>
                        </td>
                        <td style={{ verticalAlign: "top" }}>
                          {g.tipo === "correo" && (
                            <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginBottom: 2 }}>
                              Para: {g.correo_para || "—"}{g.correo_cc?.length ? ` · CC: ${g.correo_cc.join(", ")}` : ""}
                              {g.adjuntos?.length ? ` · ${g.adjuntos.length} adjunto(s)` : ""}
                            </div>
                          )}
                          {(g.correo_asunto || g.detalle) ? (
                            <div style={{ fontSize: 13, color: "#475569", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                              {g.correo_asunto ? <strong>{g.correo_asunto}</strong> : null}
                              {g.correo_asunto && g.detalle ? " — " : ""}
                              {g.detalle}
                            </div>
                          ) : (
                            <span style={{ color: "var(--text-muted)", fontSize: 12 }}>—</span>
                          )}
                          <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 3 }}>{g.creado_por_nombre || g.creado_por_email}</div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </>
      )}

      {modalGestion && (
        <ModalGestion
          doc={modalGestion.doc}
          lic={modalGestion.lic}
          gestiones={gestionesPorDoc[String(modalGestion.doc.id)] || []}
          onCerrar={() => setModalGestion(null)}
          onRegistrar={registrarGestion}
          onEnviarCorreo={() => { const m = modalGestion; setModalGestion(null); setModalCorreo(m); }}
          onError={(msg) => setToast({ type: "error", message: msg })}
        />
      )}

      {modalCorreo && (
        <ModalCorreo
          doc={modalCorreo.doc}
          lic={modalCorreo.lic}
          guia={guiasPorLic[modalCorreo.lic?.id] || null}
          numeroOC={(() => {
            const d = modalCorreo.doc;
            const ocDeriva = d?.deriva_de_id != null ? ocById[d.deriva_de_id] : null;
            if (ocDeriva?.numero) return ocDeriva.numero;
            const ocsLic = ocPorLic[String(d?.licitacion_id)] || [];
            return ocsLic.map((o) => o.numero).filter(Boolean).join(", ");
          })()}
          onCerrar={() => setModalCorreo(null)}
          onEnviado={(msg) => { setToast({ type: "success", message: msg }); setModalCorreo(null); }}
          onError={(msg) => setToast({ type: "error", message: msg })}
          registrarGestion={registrarGestion}
        />
      )}
    </div>
  );
}

/* ── Modal: bitácora de gestiones + registrar nueva ─────────────────── */
function ModalGestion({ doc, lic, gestiones, onCerrar, onRegistrar, onEnviarCorreo, onError }) {
  const [tipo, setTipo] = useState("llamada");
  const [detalle, setDetalle] = useState("");
  const [guardando, setGuardando] = useState(false);

  async function guardar() {
    if (tipo === "correo") { onEnviarCorreo(); return; }
    if (!detalle.trim()) { onError("Escribe el detalle de la gestión."); return; }
    setGuardando(true);
    try {
      await onRegistrar({ doc, lic, tipo, detalle: detalle.trim() });
      setDetalle("");
      setTipo("llamada");
    } catch (e) {
      onError(e?.message || "No se pudo registrar la gestión.");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div style={mOverlay} onMouseDown={(e) => { if (e.target === e.currentTarget) onCerrar(); }}>
      <div style={{ ...mCard, width: 560, maxWidth: "100%" }}>
        <div style={mHead}>
          <h3 style={mTitle}>Bitácora de cobranza · {doc.numero || "S/N"}</h3>
          <button type="button" style={mClose} onClick={onCerrar}><X size={18} /></button>
        </div>
        <div style={{ ...mBody, maxHeight: "70vh" }}>
          <div style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 14 }}>
            {lic?.nombre_entidad} · {fmtCLP(lic?.total_con_iva)}
          </div>

          {/* Registrar nueva gestión */}
          <div style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 14, marginBottom: 18 }}>
            <div style={{ display: "flex", gap: 6, flexWrap: "nowrap", marginBottom: 10 }}>
              {TIPOS_GESTION_SEL.map((t) => {
                const activo = tipo === t.value;
                const I = t.icon;
                return (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() => setTipo(t.value)}
                    style={{
                      display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 5,
                      padding: "6px 10px", borderRadius: 8, cursor: "pointer",
                      border: `1.5px solid ${activo ? t.color : "var(--border)"}`,
                      background: activo ? `${t.color}14` : "#fff",
                      color: activo ? t.color : "var(--text-muted)",
                      fontWeight: 600, fontSize: 12,
                      whiteSpace: "nowrap", flexShrink: 0,
                    }}
                    title={t.label}
                  >
                    <I size={14} style={{ flexShrink: 0 }} /> {t.label}
                  </button>
                );
              })}
            </div>
            {tipo === "correo" ? (
              <div style={{ fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.5 }}>
                El correo de cobranza se redacta y envía en su propia ventana (con adjuntos y copia).
                <div style={{ marginTop: 10 }}>
                  <button type="button" className="btn btn-primary btn-sm" onClick={onEnviarCorreo}>
                    <Mail size={13} style={{ marginRight: 4 }} /> Redactar correo
                  </button>
                </div>
              </div>
            ) : (
              <>
                <textarea
                  className="input"
                  rows={3}
                  placeholder="Detalle: a quién se contactó, qué respondió, compromiso de pago, etc."
                  value={detalle}
                  onChange={(e) => setDetalle(e.target.value)}
                  style={{ resize: "vertical", minHeight: 70 }}
                />
                <div style={{ marginTop: 10 }}>
                  <button type="button" className="btn btn-primary btn-sm" onClick={guardar} disabled={guardando}>
                    {guardando ? "Guardando…" : "Registrar gestión"}
                  </button>
                </div>
              </>
            )}
          </div>

          {/* Historial */}
          <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".04em", color: "var(--text-muted)", marginBottom: 8 }}>
            Historial ({gestiones.length})
          </div>
          {gestiones.length === 0 ? (
            <div style={{ fontSize: 13, color: "var(--text-muted)", padding: "8px 0" }}>Aún no hay gestiones registradas.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {gestiones.map((g) => {
                const meta = TIPO_GESTION_MAP[g.tipo];
                const I = meta?.icon || StickyNote;
                return (
                  <div key={g.id} style={{ display: "flex", gap: 10, padding: "10px 12px", border: "1px solid var(--border)", borderRadius: 10 }}>
                    <span style={{ width: 30, height: 30, borderRadius: 8, flexShrink: 0, display: "inline-flex", alignItems: "center", justifyContent: "center", color: meta?.color || "#64748b", background: `${meta?.color || "#64748b"}14` }}>
                      <I size={15} />
                    </span>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                        <span style={{ fontWeight: 700, fontSize: 13, color: "#1f2937" }}>{meta?.label || g.tipo}</span>
                        <span style={{ fontSize: 11, color: "var(--text-muted)", whiteSpace: "nowrap" }}>{fmtFechaHora(g.created_at)}</span>
                      </div>
                      {g.tipo === "correo" && (
                        <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 2 }}>
                          Para: {g.correo_para || "—"}{g.correo_cc?.length ? ` · CC: ${g.correo_cc.join(", ")}` : ""}
                          {g.adjuntos?.length ? ` · ${g.adjuntos.length} adjunto(s)` : ""}
                        </div>
                      )}
                      {(g.detalle || g.correo_asunto) && (
                        <div style={{ fontSize: 13, color: "#475569", marginTop: 3, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                          {g.correo_asunto ? <strong>{g.correo_asunto}</strong> : null}
                          {g.correo_asunto && g.detalle ? " — " : ""}
                          {g.detalle}
                        </div>
                      )}
                      <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 3 }}>{g.creado_por_nombre || g.creado_por_email}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Modal: redactar y enviar correo de cobranza ────────────────────── */
function ModalCorreo({ doc, lic, guia, numeroOC, onCerrar, onEnviado, onError, registrarGestion }) {
  const vencDias = (() => {
    const d = diasEntre(doc.fecha_factura);
    return d != null ? plazoDias(lic?.condicion_venta) - d : null;
  })();
  const diasVencida = vencDias != null ? Math.abs(vencDias) : null;

  // Asunto/referencia según el tipo de cliente:
  //  - Entidad pública: OC concatenada con el N° de factura.
  //  - Cliente particular: N° factura - N° cotización.
  const esParticular = (lic?.tipo_cliente || "").toLowerCase().includes("particular");
  const asuntoInicial = esParticular
    ? `Factura ${doc.numero || "S/N"} - Cotización ${lic?.id_licitacion || lic?.id || ""}`.trim()
    : `${numeroOC ? `OC ${numeroOC} - ` : ""}Factura ${doc.numero || "S/N"}`.trim();

  const [para, setPara] = useState("");
  // Copia por defecto a Jeremías y Benjamín (Alarcón).
  const [cc, setCc] = useState("jer.consorcio@gmail.com, benja.alarcon.z@gmail.com");
  const [asunto, setAsunto] = useState(asuntoInicial);
  const [cuerpo, setCuerpo] = useState(
    `Estimados,\n\nJunto con saludar, nos contactamos para recordar el pago de la factura N° ${doc.numero || ""} por un monto de ${fmtCLP(lic?.total_con_iva)}, ${diasVencida != null ? `actualmente con ${diasVencida} días de atraso` : "que se encuentra vencida"}.\n\nAgradeceremos regularizar el pago a la brevedad o indicarnos una fecha estimada.\n\nQuedamos atentos.\nSaludos cordiales.`,
  );
  const [adjuntos, setAdjuntos] = useState([]); // [{url,nombre,mime}]
  const [subiendo, setSubiendo] = useState(false);
  const [enviando, setEnviando] = useState(false);

  // Auto-adjuntar la factura y la guía de despacho de la cotización (removibles).
  useEffect(() => {
    let activo = true;
    async function adjuntoDesdeDoc(d) {
      if (!d?.bucket || !d?.storage_path) return null;
      try {
        const data = await api.get(
          `/licitaciones/storage/signed-url?bucket=${encodeURIComponent(d.bucket)}&path=${encodeURIComponent(d.storage_path)}`,
        );
        if (!data?.signedUrl) return null;
        return { url: data.signedUrl, nombre: d.file_name || `${d.tipo || "documento"}.pdf`, mime: d.mime_type || "application/pdf" };
      } catch { return null; }
    }
    (async () => {
      const pre = [];
      const aFactura = await adjuntoDesdeDoc(doc);
      if (aFactura) pre.push(aFactura);
      if (guia) {
        const aGuia = await adjuntoDesdeDoc(guia);
        if (aGuia) pre.push(aGuia);
      }
      if (activo && pre.length) setAdjuntos((prev) => [...pre, ...prev]);
    })();
    return () => { activo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onFiles(files) {
    if (!files?.length) return;
    setSubiendo(true);
    try {
      const nuevos = [];
      for (const file of Array.from(files)) {
        const ext = (file.name.split(".").pop() || "bin").toLowerCase();
        const path = `cobranza/${crypto.randomUUID()}.${ext}`;
        const { error } = await supabase.storage.from("chat-adjuntos").upload(path, file, {
          contentType: file.type || "application/octet-stream",
          upsert: false,
        });
        if (error) throw error;
        const { data } = supabase.storage.from("chat-adjuntos").getPublicUrl(path);
        nuevos.push({ url: data.publicUrl, nombre: file.name, mime: file.type || "" });
      }
      setAdjuntos((prev) => [...prev, ...nuevos]);
    } catch (e) {
      onError(e?.message || "No se pudo subir el adjunto.");
    } finally {
      setSubiendo(false);
    }
  }

  async function enviar() {
    const paraNorm = para.trim().toLowerCase();
    if (!paraNorm) { onError("Indica el correo del destinatario."); return; }
    if (!asunto.trim()) { onError("Falta el asunto."); return; }
    if (!cuerpo.trim()) { onError("El correo no puede ir vacío."); return; }
    const ccArr = cc.split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean);
    setEnviando(true);
    try {
      await api.post("/correos/cobranza/enviar", {
        para: paraNorm,
        cc: ccArr,
        asunto: asunto.trim(),
        cuerpo,
        adjuntos,
      });
      await registrarGestion({
        doc, lic, tipo: "correo",
        detalle: null,
        correo: { para: paraNorm, cc: ccArr, asunto: asunto.trim(), adjuntos },
      });
      onEnviado("Correo de cobranza enviado.");
    } catch (e) {
      const msg = e?.response?.data?.message || e?.message || "No se pudo enviar el correo.";
      onError(msg);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div style={mOverlay} onMouseDown={(e) => { if (e.target === e.currentTarget && !enviando) onCerrar(); }}>
      <div style={{ ...mCard, width: 600, maxWidth: "100%" }}>
        <div style={mHead}>
          <h3 style={mTitle}>Correo de cobranza · {doc.numero || "S/N"}</h3>
          <button type="button" style={mClose} onClick={() => !enviando && onCerrar()}><X size={18} /></button>
        </div>
        <div style={{ ...mBody, maxHeight: "72vh" }}>
          <div className="field">
            <label className="field-label">Para *</label>
            <input className="input" type="email" placeholder="cliente@correo.cl" value={para} onChange={(e) => setPara(e.target.value)} />
          </div>
          <div className="field">
            <label className="field-label">CC (copia)</label>
            <input className="input" placeholder="separa con comas: jefe@..., contador@..." value={cc} onChange={(e) => setCc(e.target.value)} />
          </div>
          <div className="field">
            <label className="field-label">Asunto *</label>
            <input className="input" value={asunto} onChange={(e) => setAsunto(e.target.value)} />
          </div>
          <div className="field">
            <label className="field-label">Mensaje *</label>
            <textarea className="input" rows={9} value={cuerpo} onChange={(e) => setCuerpo(e.target.value)} style={{ resize: "vertical", minHeight: 160, fontFamily: "inherit" }} />
            <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>Tu firma se agrega automáticamente. El correo sale desde tu cuenta conectada.</p>
          </div>

          <div className="field">
            <label className="field-label">Adjuntos</label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
              <label className="btn btn-secondary btn-sm" style={{ cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6 }}>
                {subiendo ? <Loader2 size={13} style={{ animation: "login-spin 1s linear infinite" }} /> : <Paperclip size={13} />}
                {subiendo ? "Subiendo…" : "Adjuntar archivo"}
                <input type="file" multiple style={{ display: "none" }} onChange={(e) => { onFiles(e.target.files); e.target.value = ""; }} />
              </label>
              {adjuntos.map((a, i) => (
                <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 10px", borderRadius: 999, background: "#f1f5f9", fontSize: 12 }}>
                  {a.nombre}
                  <button type="button" onClick={() => setAdjuntos((prev) => prev.filter((_, j) => j !== i))} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", display: "inline-flex" }}>
                    <X size={12} />
                  </button>
                </span>
              ))}
            </div>
          </div>
        </div>
        <div style={mFoot}>
          <button type="button" className="btn btn-secondary" onClick={() => !enviando && onCerrar()} disabled={enviando}>Cancelar</button>
          <button type="button" className="btn btn-primary" onClick={enviar} disabled={enviando || subiendo}>
            {enviando ? <Loader2 size={14} style={{ animation: "login-spin 1s linear infinite", marginRight: 6 }} /> : <Send size={14} style={{ marginRight: 6 }} />}
            {enviando ? "Enviando…" : "Enviar correo"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Estilos inline de modal (el proyecto no tiene clases .modal-*) ──── */
const mOverlay = {
  position: "fixed",
  inset: 0,
  background: "rgba(15,23,42,.5)",
  backdropFilter: "blur(2px)",
  WebkitBackdropFilter: "blur(2px)",
  zIndex: 1000,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 16,
};
const mCard = {
  background: "#fff",
  borderRadius: 14,
  boxShadow: "0 24px 60px rgba(15,23,42,.35)",
  display: "flex",
  flexDirection: "column",
  maxHeight: "90vh",
  overflow: "hidden",
};
const mHead = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  padding: "14px 18px",
  borderBottom: "1px solid var(--border)",
};
const mTitle = { fontSize: 15, fontWeight: 800, color: "#0f172a", margin: 0 };
const mClose = {
  background: "none",
  border: "none",
  cursor: "pointer",
  color: "var(--text-muted)",
  display: "inline-flex",
  padding: 4,
};
const mBody = { padding: 18, overflowY: "auto" };
const mFoot = {
  display: "flex",
  justifyContent: "flex-end",
  gap: 10,
  padding: "13px 18px",
  borderTop: "1px solid var(--border)",
};
