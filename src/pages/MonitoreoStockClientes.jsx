import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { supabase } from "../lib/supabase";
import useAuth from "../hooks/useAuth";
import Toast from "../components/Toast";
import { descargarCSV, descargarReportePDF } from "../lib/reporteStock";
import { generarPDFSolicitud } from "../components/SolicitudCotizacionDocument.jsx";
import DateFilter from "../components/DateFilter";
import {
  Package,
  Users,
  AlertTriangle,
  AlertCircle,
  CheckCircle2,
  Filter,
  Settings,
  Plus,
  Trash2,
  X,
  RefreshCw,
  Bell,
  Mail,
  FilePlus,
  FileDown,
  Printer,
  FileSpreadsheet,
  Send,
  MessageCircle,
  ExternalLink,
} from "lucide-react";

const TEAL = "#1e9295"; // var --primary-dark
const TEAL_LIGHT = "#28aeb1"; // var --primary (primary de la plataforma)

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

function fmtMoneda(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v === 0) return "—";
  return v.toLocaleString("es-CL", {
    style: "currency",
    currency: "CLP",
    maximumFractionDigits: 0,
  });
}

// Da formato visual al RUT chileno desde su versión normalizada.
function formatearRutVisual(rutNorm) {
  const r = String(rutNorm || "").replace(/[^0-9kK]/g, "");
  if (!r) return "—";
  const cuerpo = r.slice(0, -1);
  const dv = r.slice(-1).toUpperCase();
  if (!cuerpo) return dv;
  return `${cuerpo.replace(/\B(?=(\d{3})+(?!\d))/g, ".")}-${dv}`;
}

function getIniciales(nombre) {
  const s = String(nombre || "").trim();
  if (!s) return "?";
  const partes = s.split(/\s+/);
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
  return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
}

function tiempoRelativo(iso) {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms)) return "";
  const m = Math.floor(ms / 60000);
  if (m < 1) return "ahora";
  if (m < 60) return `hace ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  if (d < 30) return `hace ${d} d`;
  const meses = Math.floor(d / 30);
  return `hace ${meses} mes${meses === 1 ? "" : "es"}`;
}

// Paleta de gradientes para los avatares — distribuye colores según el RUT
// para que cada cliente tenga su propio "look" estable entre visitas.
const AVATAR_GRADIENTES = [
  ["#1e9295", "#28aeb1"],
  ["#1e40af", "#3b82f6"],
  ["#6d28d9", "#a78bfa"],
  ["#be185d", "#ec4899"],
  ["#c2410c", "#fb923c"],
  ["#15803d", "#4ade80"],
  ["#0e7490", "#22d3ee"],
];
function gradienteAvatar(seed) {
  const s = String(seed || "");
  let hash = 0;
  for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) | 0;
  const idx = Math.abs(hash) % AVATAR_GRADIENTES.length;
  return AVATAR_GRADIENTES[idx];
}

export default function MonitoreoStockClientes() {
  const { rol } = useAuth();
  const esAdmin =
    String(rol || "").trim().toLowerCase() === "admin" ||
    String(rol || "").trim().toLowerCase() === "administrador";

  const [filtroDesde, setFiltroDesde] = useState(hace7DiasISO());
  const [filtroHasta, setFiltroHasta] = useState(hoyISO());
  const [filtroRut, setFiltroRut] = useState("");
  const [filtroCliente, setFiltroCliente] = useState("");
  const [soloAlertas, setSoloAlertas] = useState(false);

  const [declaraciones, setDeclaraciones] = useState([]);
  const [cargando, setCargando] = useState(false);
  const [seleccionada, setSeleccionada] = useState(null);
  const [toast, setToast] = useState(null);

  const [mostrarDestinatarios, setMostrarDestinatarios] = useState(false);

  // Lista de clientes con al menos una declaración (alimenta el autocompletado).
  const [sugerencias, setSugerencias] = useState([]);

  async function cargar() {
    setCargando(true);
    try {
      const qs = new URLSearchParams();
      if (filtroDesde) qs.set("desde", filtroDesde + "T00:00:00");
      if (filtroHasta) qs.set("hasta", filtroHasta + "T23:59:59");
      if (filtroRut.trim()) qs.set("rut", filtroRut.trim());
      if (filtroCliente.trim()) qs.set("razon_social", filtroCliente.trim());
      if (soloAlertas) qs.set("solo_alertas", "true");
      const data = await api.get(`/stock-clientes/declaraciones?${qs.toString()}`);
      setDeclaraciones(Array.isArray(data) ? data : []);
    } catch (e) {
      setToast({ type: "error", message: e?.message || "No pudimos cargar las declaraciones." });
    } finally {
      setCargando(false);
    }
  }

  async function cargarSugerencias() {
    try {
      const data = await api.get("/stock-clientes/clientes-con-declaraciones");
      setSugerencias(Array.isArray(data) ? data : []);
    } catch {
      // Sin sugerencias no es bloqueante.
    }
  }

  useEffect(() => {
    cargar();
    cargarSugerencias();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Mantenemos la función "cargar" en una ref para que la suscripción realtime
  // siempre llame a la versión más reciente sin tener que recrear el canal
  // cada vez que cambia un filtro.
  const cargarRef = useRef(cargar);
  useEffect(() => {
    cargarRef.current = cargar;
  });

  // Suscripción realtime a stock_declaraciones: cuando llega una nueva
  // declaración (o se actualiza una existente), refrescamos el dashboard
  // automáticamente y también la lista de sugerencias del autocompletado.
  useEffect(() => {
    const canal = supabase
      .channel("stock-declaraciones-monitoreo")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "stock_declaraciones",
        },
        () => {
          cargarRef.current?.();
          cargarSugerencias();
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(canal);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Una fila por cliente: agrupamos por RUT y conservamos la declaración
  // más reciente. Así la tabla siempre refleja el estado actual del cliente.
  const declaracionesMostradas = useMemo(() => {
    const mapa = new Map();
    for (const d of declaraciones) {
      const previa = mapa.get(d.rut);
      if (!previa || new Date(d.fecha) > new Date(previa.fecha)) {
        mapa.set(d.rut, d);
      }
    }
    return Array.from(mapa.values()).sort(
      (a, b) => new Date(b.fecha) - new Date(a.fecha),
    );
  }, [declaraciones]);

  const kpis = useMemo(() => {
    const totales = declaracionesMostradas.reduce(
      (acc, d) => {
        acc.declaraciones += 1;
        acc.rojos += Number(d.total_rojos) || 0;
        acc.amarillos += Number(d.total_amarillos) || 0;
        acc.verdes += Number(d.total_verdes) || 0;
        acc.clientes.add(d.rut);
        return acc;
      },
      { declaraciones: 0, rojos: 0, amarillos: 0, verdes: 0, clientes: new Set() },
    );
    return { ...totales, clientes: totales.clientes.size };
  }, [declaracionesMostradas]);

  // ── Reporte del pool completo de clientes (CSV + impresión) ──────────
  function filasPoolReporte() {
    return declaracionesMostradas.map((d) => ({
      cliente: d.razon_social || "—",
      rut: formatearRutVisual(d.rut),
      fecha: fmtFechaHora(d.fecha),
      productos: d.total_items || 0,
      ok: d.total_verdes || 0,
      bajo: d.total_amarillos || 0,
      critico: d.total_rojos || 0,
    }));
  }

  function exportarPoolCSV() {
    const filas = filasPoolReporte();
    if (filas.length === 0) {
      setToast({ type: "error", message: "No hay clientes para exportar en el rango actual." });
      return;
    }
    const headers = [
      "Cliente",
      "RUT",
      "Última declaración",
      "Productos",
      "OK",
      "Bajo",
      "Crítico",
    ];
    const rows = filas.map((f) => [
      f.cliente,
      f.rut,
      f.fecha,
      f.productos,
      f.ok,
      f.bajo,
      f.critico,
    ]);
    descargarCSV(
      `monitoreo-stock-${new Date().toISOString().slice(0, 10)}.csv`,
      headers,
      rows,
    );
  }

  async function imprimirPool() {
    const filas = filasPoolReporte();
    if (filas.length === 0) {
      setToast({ type: "error", message: "No hay clientes para exportar en el rango actual." });
      return;
    }
    const ok = await descargarReportePDF({
      filename: `monitoreo-stock-${new Date().toISOString().slice(0, 10)}.pdf`,
      titulo: "Monitoreo de stock por cliente",
      subtitulo: "Estado actual del pool de clientes",
      meta: [
        { label: "Período", valor: `${filtroDesde} a ${filtroHasta}` },
        { label: "Clientes", valor: String(kpis.clientes) },
      ],
      resumen: [
        { label: "Clientes", valor: kpis.clientes, tono: "neutro" },
        { label: "Stock crítico", valor: kpis.rojos, tono: "rojo" },
        { label: "Stock bajo", valor: kpis.amarillos, tono: "amarillo" },
        { label: "Stock OK", valor: kpis.verdes, tono: "verde" },
      ],
      headers: [
        "Cliente",
        "RUT",
        "Última declaración",
        "Productos",
        "OK",
        "Bajo",
        "Crítico",
      ],
      aligns: ["left", "left", "left", "right", "right", "right", "right"],
      rows: filas.map((f) => [
        f.cliente,
        f.rut,
        f.fecha,
        f.productos,
        f.ok,
        f.bajo,
        f.critico,
      ]),
    });
    if (!ok) {
      setToast({ type: "error", message: "No pudimos generar el PDF. Intente nuevamente." });
    }
  }

  return (
    <div style={styles.page}>
      <style>{`
        .row-hover {
          transition: filter .18s ease, transform .18s ease;
        }
        .row-hover:hover {
          filter: brightness(.985);
        }
        .row-critica td:nth-child(7) {
          animation: rowCriticaPulse 2.4s ease-in-out infinite;
        }
        @keyframes rowCriticaPulse {
          0%, 100% { background: transparent; }
          50% { background: rgba(239,68,68,0.04); }
        }
      `}</style>
      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}

      <header style={styles.header}>
        <div>
          <div style={styles.eyebrow}>Portal de Stock</div>
          <h1 style={styles.h1}>Monitoreo Stock Clientes</h1>
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button onClick={cargar} style={styles.btnGhost} disabled={cargando}>
            <RefreshCw size={14} /> Actualizar
          </button>
          <ExportarMenu
            label="Exportar reporte"
            onCSV={exportarPoolCSV}
            onImprimir={imprimirPool}
            disabled={declaracionesMostradas.length === 0}
          />
          {esAdmin && (
            <button onClick={() => setMostrarDestinatarios(true)} style={styles.btnPrimario}>
              <Settings size={14} /> Configurar destinatarios
            </button>
          )}
        </div>
      </header>

      {/* KPIs */}
      <div style={styles.kpisGrid}>
        <KPI icon={Users} label="Clientes" valor={kpis.clientes} color={TEAL} />
        <KPI icon={Package} label="Declaraciones" valor={kpis.declaraciones} color="#0f172a" />
        <KPI icon={AlertCircle} label="Stock crítico" valor={kpis.rojos} color="#b91c1c" bg="#fee2e2" />
        <KPI icon={AlertTriangle} label="Stock bajo" valor={kpis.amarillos} color="#b45309" bg="#fef3c7" />
        <KPI icon={CheckCircle2} label="Stock OK" valor={kpis.verdes} color="#15803d" bg="#dcfce7" />
      </div>

      {/* Filtros */}
      <div style={styles.filtrosCard}>
        <div style={styles.filtroGroup}>
          <label style={styles.filtroLabel}>Desde</label>
          <DateFilter value={filtroDesde} onChange={setFiltroDesde} placeholder="Desde" />
        </div>
        <div style={styles.filtroGroup}>
          <label style={styles.filtroLabel}>Hasta</label>
          <DateFilter value={filtroHasta} onChange={setFiltroHasta} placeholder="Hasta" />
        </div>
        <div style={{ ...styles.filtroGroup, flex: 1, minWidth: 180 }}>
          <label style={styles.filtroLabel}>RUT</label>
          <TypeaheadCliente
            valor={filtroRut}
            campo="rut"
            placeholder="12.345.678-9"
            opciones={sugerencias}
            onChange={(txt) => setFiltroRut(txt)}
            onSelect={(c) => {
              setFiltroRut(c.rut_formateado || c.rut || "");
              setFiltroCliente(c.razon_social || "");
            }}
          />
        </div>
        <div style={{ ...styles.filtroGroup, flex: 1.4, minWidth: 220 }}>
          <label style={styles.filtroLabel}>Cliente</label>
          <TypeaheadCliente
            valor={filtroCliente}
            campo="razon_social"
            placeholder="Razón social"
            opciones={sugerencias}
            onChange={(txt) => setFiltroCliente(txt)}
            onSelect={(c) => {
              setFiltroRut(c.rut_formateado || c.rut || "");
              setFiltroCliente(c.razon_social || "");
            }}
          />
        </div>
        <label style={styles.filtroChk} title="Solo clientes con productos en amarillo o rojo">
          <input
            type="checkbox"
            checked={soloAlertas}
            onChange={(e) => setSoloAlertas(e.target.checked)}
          />
          Solo con alerta
        </label>

        <div style={styles.filtroAcciones}>
          {(filtroRut || filtroCliente) && (
            <button
              type="button"
              onClick={() => {
                setFiltroRut("");
                setFiltroCliente("");
              }}
              style={styles.btnGhost}
              title="Limpiar filtros de RUT y cliente"
            >
              Limpiar
            </button>
          )}
          <button onClick={cargar} style={styles.btnFiltrar} disabled={cargando}>
            <Filter size={14} /> Filtrar
          </button>
        </div>
      </div>

      {/* Tabla declaraciones */}
      <div style={styles.tablaCard}>
        <div style={styles.tablaHeader}>
          <div>
            <div style={styles.tablaTitulo}>Estado actual por cliente</div>
            <div style={styles.tablaSub}>
              {declaracionesMostradas.length}{" "}
              {declaracionesMostradas.length === 1 ? "cliente" : "clientes"} con
              declaración en el período
            </div>
          </div>
        </div>
        <div style={styles.tablaWrap}>
          <table style={styles.tabla}>
            <thead>
              <tr>
                <th style={styles.th}>Fecha</th>
                <th style={styles.th}>Cliente</th>
                <th style={styles.th}>RUT</th>
                <th style={{ ...styles.th, textAlign: "center" }}>Productos</th>
                <th style={{ ...styles.th, textAlign: "center" }}>OK</th>
                <th style={{ ...styles.th, textAlign: "center" }}>Bajo</th>
                <th style={{ ...styles.th, textAlign: "center" }}>Crítico</th>
                <th style={styles.th} />
              </tr>
            </thead>
            <tbody>
              {cargando ? (
                <tr>
                  <td colSpan={8} style={styles.tdEmpty}>
                    Cargando…
                  </td>
                </tr>
              ) : declaracionesMostradas.length === 0 ? (
                <tr>
                  <td colSpan={8} style={styles.tdEmpty}>
                    No hay declaraciones en el rango seleccionado.
                  </td>
                </tr>
              ) : (
                declaracionesMostradas.map((d) => {
                  const esCritico = (d.total_rojos || 0) > 0;
                  const esBajo = !esCritico && (d.total_amarillos || 0) > 0;
                  const borderColor = esCritico
                    ? "#ef4444"
                    : esBajo
                      ? "#f59e0b"
                      : "#22c55e";
                  // Tinte muy sutil en el lado izquierdo de la fila según el peor estado
                  const tinteFila = esCritico
                    ? "linear-gradient(90deg, rgba(254,226,226,0.40) 0%, rgba(255,255,255,0) 30%)"
                    : esBajo
                      ? "linear-gradient(90deg, rgba(254,243,199,0.40) 0%, rgba(255,255,255,0) 30%)"
                      : "linear-gradient(90deg, rgba(220,252,231,0.32) 0%, rgba(255,255,255,0) 30%)";
                  const [colA, colB] = gradienteAvatar(d.rut);
                  return (
                    <tr
                      key={d.id}
                      className={`row-hover ${esCritico ? "row-critica" : ""}`}
                      style={{
                        ...styles.tr,
                        boxShadow: `inset 3px 0 0 ${borderColor}`,
                        background: tinteFila,
                      }}
                      onClick={() => setSeleccionada(d)}
                    >
                      <td style={styles.td}>
                        <div style={{ fontWeight: 600, color: "#0f172a" }}>
                          {fmtFechaHora(d.fecha)}
                        </div>
                        <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>
                          {tiempoRelativo(d.fecha)}
                        </div>
                      </td>
                      <td style={styles.td}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <div
                            style={{
                              width: 34,
                              height: 34,
                              borderRadius: "50%",
                              background: `linear-gradient(135deg, ${colA}, ${colB})`,
                              color: "#fff",
                              fontSize: 12,
                              fontWeight: 700,
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              flexShrink: 0,
                              boxShadow:
                                "0 4px 10px rgba(15,23,42,0.10), inset 0 0 0 1px rgba(255,255,255,0.18)",
                              letterSpacing: 0.3,
                            }}
                          >
                            {getIniciales(d.razon_social || d.rut)}
                          </div>
                          <div style={{ fontWeight: 600, color: "#0f172a" }}>
                            {d.razon_social || "—"}
                          </div>
                        </div>
                      </td>
                      <td style={{ ...styles.td, color: "#475569", fontVariantNumeric: "tabular-nums" }}>
                        {formatearRutVisual(d.rut)}
                      </td>
                      <td style={{ ...styles.td, textAlign: "center", fontWeight: 600 }}>
                        {d.total_items}
                      </td>
                      <td style={{ ...styles.td, textAlign: "center" }}>
                        <Chip valor={d.total_verdes} color="#15803d" bg="#dcfce7" />
                      </td>
                      <td style={{ ...styles.td, textAlign: "center" }}>
                        <Chip valor={d.total_amarillos} color="#b45309" bg="#fef3c7" />
                      </td>
                      <td style={{ ...styles.td, textAlign: "center" }}>
                        <Chip valor={d.total_rojos} color="#b91c1c" bg="#fee2e2" />
                      </td>
                      <td style={{ ...styles.td, textAlign: "right" }}>
                        <span style={styles.linkVer}>Ver detalle →</span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Detalle */}
      {seleccionada && (
        <DetalleDeclaracion
          declaracion={seleccionada}
          onCerrar={() => setSeleccionada(null)}
          setToast={setToast}
        />
      )}

      {/* Destinatarios */}
      {mostrarDestinatarios && (
        <ModalDestinatarios
          onCerrar={() => setMostrarDestinatarios(false)}
          esAdmin={esAdmin}
          setToast={setToast}
        />
      )}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────
   Typeahead de clientes con declaraciones.
   El input es libre (se puede teclear cualquier texto y filtrar como
   substring en el backend), pero al teclear se muestra una lista de
   sugerencias que matchean por RUT o por razón social. Al elegir una,
   se rellenan ambos filtros (RUT + cliente).
   ────────────────────────────────────────────────────────────────────── */
function TypeaheadCliente({ valor, campo, placeholder, opciones, onChange, onSelect }) {
  const [abierto, setAbierto] = useState(false);
  const [indiceActivo, setIndiceActivo] = useState(-1);

  const sugerencias = useMemo(() => {
    const q = String(valor || "").toLowerCase().trim();
    const lista = Array.isArray(opciones) ? opciones : [];
    if (!q) return lista.slice(0, 8);
    return lista
      .filter((o) => {
        const rut = String(o?.rut_formateado || o?.rut || "").toLowerCase();
        const rs = String(o?.razon_social || "").toLowerCase();
        return rut.includes(q) || rs.includes(q);
      })
      .slice(0, 8);
  }, [valor, opciones]);

  function elegir(c) {
    onSelect?.(c);
    setAbierto(false);
    setIndiceActivo(-1);
  }

  function manejarTeclado(e) {
    if (!abierto) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setIndiceActivo((i) => Math.min(i + 1, sugerencias.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setIndiceActivo((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && indiceActivo >= 0 && sugerencias[indiceActivo]) {
      e.preventDefault();
      elegir(sugerencias[indiceActivo]);
    } else if (e.key === "Escape") {
      setAbierto(false);
    }
  }

  return (
    <div style={{ position: "relative" }}>
      <input
        type="text"
        placeholder={placeholder}
        value={valor}
        onChange={(e) => {
          onChange?.(e.target.value);
          setAbierto(true);
          setIndiceActivo(-1);
        }}
        onFocus={() => setAbierto(true)}
        onBlur={() => setTimeout(() => setAbierto(false), 150)}
        onKeyDown={manejarTeclado}
        className="input"
        style={{ minWidth: 120 }}
        autoComplete="off"
      />
      {abierto && sugerencias.length > 0 && (
        <div style={styles.dropdown}>
          {sugerencias.map((c, idx) => {
            const rs = c.razon_social || "—";
            const rut = c.rut_formateado || c.rut || "";
            const esActivo = idx === indiceActivo;
            return (
              <button
                type="button"
                key={c.rut}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => elegir(c)}
                onMouseEnter={() => setIndiceActivo(idx)}
                style={{
                  ...styles.dropdownItem,
                  background: esActivo ? "#e6f7f7" : "transparent",
                }}
              >
                <div style={{ fontWeight: 600, color: "var(--text)", fontSize: 13 }}>
                  {campo === "razon_social" ? rs : rut}
                </div>
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 1 }}>
                  {campo === "razon_social" ? rut : rs}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Chip compacto de conteo. Se vuelve gris tenue cuando el valor es 0,
// y mantiene el color del semáforo cuando hay productos en esa categoría.
function Chip({ valor, color, bg }) {
  const v = Number(valor) || 0;
  const esVacio = v === 0;
  return (
    <span
      style={{
        display: "inline-block",
        minWidth: 32,
        padding: "3px 10px",
        borderRadius: 999,
        background: esVacio ? "#f1f5f9" : bg,
        color: esVacio ? "#94a3b8" : color,
        fontSize: 12,
        fontWeight: 700,
        fontVariantNumeric: "tabular-nums",
      }}
    >
      {v}
    </span>
  );
}

// Hilo de mensajes (lado equipo) ligado a una solicitud/cotización.
function HiloMensajesAdmin({ solicitudId, setToast }) {
  const [mensajes, setMensajes] = useState([]);
  const [texto, setTexto] = useState("");
  const [cargando, setCargando] = useState(true);
  const [enviando, setEnviando] = useState(false);

  async function cargar() {
    setCargando(true);
    try {
      const data = await api.get(`/stock-clientes/solicitudes/${solicitudId}/mensajes`);
      setMensajes(Array.isArray(data) ? data : []);
    } catch { /* */ } finally { setCargando(false); }
  }
  useEffect(() => { cargar(); /* eslint-disable-next-line */ }, [solicitudId]);

  async function enviar(e) {
    e?.preventDefault?.();
    const t = texto.trim();
    if (!t || enviando) return;
    setEnviando(true);
    try {
      await api.post(`/stock-clientes/solicitudes/${solicitudId}/mensajes`, { mensaje: t });
      setTexto("");
      await cargar();
    } catch (err) {
      setToast?.({ type: "error", message: err?.message || "No se pudo enviar el mensaje." });
    } finally { setEnviando(false); }
  }

  return (
    <div style={{ border: "1px solid var(--border, #e2e8f0)", borderRadius: 10, padding: 10, marginBottom: 10 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 8, display: "flex", alignItems: "center", gap: 5 }}>
        <MessageCircle size={12} /> Comunicación con el cliente
      </div>
      <div style={{ maxHeight: 200, overflowY: "auto", display: "flex", flexDirection: "column", gap: 6, marginBottom: 8 }}>
        {cargando ? (
          <div style={{ fontSize: 12, color: "#94a3b8" }}>Cargando…</div>
        ) : mensajes.length === 0 ? (
          <div style={{ fontSize: 12, color: "#94a3b8" }}>Aún no hay mensajes. Escribe para iniciar la conversación.</div>
        ) : mensajes.map((m) => {
          const equipo = m.autor_tipo === "equipo";
          return (
            <div key={m.id} style={{ alignSelf: equipo ? "flex-end" : "flex-start", maxWidth: "85%", background: equipo ? "#e6f7f7" : "#f1f5f9", borderRadius: 10, padding: "6px 10px" }}>
              <div style={{ fontSize: 13, color: "#0f172a", whiteSpace: "pre-wrap" }}>{m.mensaje}</div>
              <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 2 }}>{equipo ? (m.autor_nombre || "Equipo") : "Cliente"} · {fmtFechaHora(m.created_at)}</div>
            </div>
          );
        })}
      </div>
      <form onSubmit={enviar} style={{ display: "flex", gap: 6 }}>
        <input className="input" value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Escribe un mensaje al cliente…" style={{ flex: 1 }} />
        <button type="submit" disabled={enviando || !texto.trim()} className="btn btn-primary btn-sm" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
          <Send size={13} /> Enviar
        </button>
      </form>
    </div>
  );
}

function KPI({ icon: Icon, label, valor, color, bg }) {
  return (
    <div style={{ ...styles.kpiCard, background: bg || "#fff" }}>
      <div style={{ ...styles.kpiIcon, background: bg ? "rgba(0,0,0,0.05)" : `${color}15`, color }}>
        <Icon size={18} />
      </div>
      <div>
        <div style={{ fontSize: 22, fontWeight: 700, color }}>{valor}</div>
        <div style={{ fontSize: 11, color: "#64748b", fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5 }}>
          {label}
        </div>
      </div>
    </div>
  );
}

// Menú compacto de exportación reutilizable: CSV o impresión/PDF.
function ExportarMenu({ label = "Exportar", onCSV, onImprimir, disabled, variante = "ghost" }) {
  const [abierto, setAbierto] = useState(false);
  useEffect(() => {
    if (!abierto) return;
    const cerrar = () => setAbierto(false);
    window.addEventListener("click", cerrar);
    return () => window.removeEventListener("click", cerrar);
  }, [abierto]);

  const botonStyle = variante === "mini" ? styles.btnGhostMini : styles.btnGhost;

  return (
    <div style={{ position: "relative" }} onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        disabled={disabled}
        style={{ ...botonStyle, opacity: disabled ? 0.5 : 1, cursor: disabled ? "not-allowed" : "pointer" }}
        title={disabled ? "No hay datos para exportar." : "Exportar reporte"}
      >
        <FileDown size={14} /> {label}
      </button>
      {abierto && !disabled && (
        <div style={styles.exportMenu}>
          <button
            type="button"
            style={styles.exportOpcion}
            onClick={() => { setAbierto(false); onImprimir?.(); }}
          >
            <Printer size={14} /> Descargar PDF
          </button>
          <button
            type="button"
            style={styles.exportOpcion}
            onClick={() => { setAbierto(false); onCSV?.(); }}
          >
            <FileSpreadsheet size={14} /> Descargar Excel (CSV)
          </button>
        </div>
      )}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────
   Detalle de una declaración
   ────────────────────────────────────────────────────────────────────── */
function DetalleDeclaracion({ declaracion, onCerrar, setToast }) {
  const navigate = useNavigate();
  const items = Array.isArray(declaracion.items) ? declaracion.items : [];
  const [solicitudes, setSolicitudes] = useState([]);
  const [cargandoSolicitudes, setCargandoSolicitudes] = useState(true);
  const [expandidaId, setExpandidaId] = useState(null);
  const [contacto, setContacto] = useState(null);
  const [sucursalesMap, setSucursalesMap] = useState({});
  const [mostrarCorreo, setMostrarCorreo] = useState(false);

  // Lleva al admin a /crear con datos del cliente (RUT, razón social, contacto)
  // y un detalle de la solicitud en observaciones para que arranque la cotización.
  // Marca automáticamente la solicitud como "respondida" porque el equipo
  // está atendiéndola.
  async function crearCotizacionDesdeSolicitud(solicitud) {
    const draft = {
      rutEntidad: formatearRutVisual(declaracion.rut),
      nombreEntidad: declaracion.razon_social || "",
      tipoCliente: "Entidad Pública",
      tipoCompra: "Compra ágil",
      listado: "2",
      email: solicitud?.contacto_email || "",
      telefono: solicitud?.contacto_telefono || "",
      observaciones: armarObservacionesSolicitud(declaracion, solicitud),
      solicitud_stock_id: solicitud?.id ?? null,
    };

    // Marcar como respondida en segundo plano (no bloqueamos la navegación).
    if (solicitud?.estado === "pendiente") {
      api
        .put(`/stock-clientes/solicitudes/${solicitud.id}/estado`, {
          estado: "respondida",
        })
        .catch(() => undefined);
    }

    onCerrar?.();
    navigate("/crear", { state: { duplicarLicitacion: draft } });
  }

  async function cambiarEstadoSolicitud(solicitudId, estado) {
    try {
      await api.put(`/stock-clientes/solicitudes/${solicitudId}/estado`, {
        estado,
      });
      // Actualiza la lista local sin recargar todo
      setSolicitudes((prev) =>
        prev.map((s) =>
          s.id === solicitudId
            ? {
                ...s,
                estado,
                respondida_at:
                  estado === "respondida"
                    ? new Date().toISOString()
                    : estado === "pendiente"
                      ? null
                      : s.respondida_at,
              }
            : s,
        ),
      );
    } catch (e) {
      console.warn("No se pudo cambiar el estado:", e?.message);
    }
  }

  useEffect(() => {
    let cancel = false;
    (async () => {
      setCargandoSolicitudes(true);
      try {
        const [data, cont, sucs] = await Promise.all([
          api.get(
            `/stock-clientes/solicitudes-por-rut?rut=${encodeURIComponent(declaracion.rut)}`,
          ),
          api
            .get(`/stock-clientes/contacto?rut=${encodeURIComponent(declaracion.rut)}`)
            .catch(() => null),
          api
            .get(`/stock-clientes/sucursales-por-rut?rut=${encodeURIComponent(declaracion.rut)}`)
            .catch(() => []),
        ]);
        if (!cancel) {
          setSolicitudes(Array.isArray(data) ? data : []);
          setContacto(cont || null);
          const map = {};
          (Array.isArray(sucs) ? sucs : []).forEach((s) => { map[s.id] = s; });
          setSucursalesMap(map);
        }
      } catch {
        if (!cancel) setSolicitudes([]);
      } finally {
        if (!cancel) setCargandoSolicitudes(false);
      }
    })();
    return () => {
      cancel = true;
    };
  }, [declaracion.rut]);

  // Teléfono para WhatsApp: contacto del maestro o el de la última solicitud.
  const telefonoContacto =
    contacto?.telefono ||
    solicitudes.find((s) => s.contacto_telefono)?.contacto_telefono ||
    "";
  const emailContacto =
    contacto?.email ||
    solicitudes.find((s) => s.contacto_email)?.contacto_email ||
    "";

  function irAFichaCliente() {
    if (!contacto?.id) {
      setToast?.({
        type: "warning",
        message: "No se encontró la ficha de este cliente en el maestro.",
      });
      return;
    }
    onCerrar?.();
    navigate(`/clientes/editar/${contacto.id}`);
  }

  function abrirWhatsApp() {
    const limpio = String(telefonoContacto || "").replace(/[^0-9]/g, "");
    if (!limpio) {
      setToast?.({
        type: "warning",
        message: "Este cliente no tiene teléfono registrado para WhatsApp.",
      });
      return;
    }
    // Si viene sin código de país (8-9 dígitos), anteponemos 56 (Chile).
    const numero = limpio.length <= 9 ? `56${limpio}` : limpio;
    const texto = encodeURIComponent(
      `Hola${declaracion.razon_social ? ` ${declaracion.razon_social}` : ""}, le escribimos de AMSODENT respecto a su gestión de stock.`,
    );
    window.open(`https://wa.me/${numero}?text=${texto}`, "_blank", "noopener");
  }

  // ── Reporte por cliente (productos declarados) ───────────────────────
  function filasClienteReporte() {
    return items.map((it) => {
      const sem = it.semaforo || "verde";
      const total =
        (Number(it.stock_actual) || 0) * (Number(it.precio_unitario) || 0);
      return {
        nombre: it.nombre || "",
        marca: it.marca || "",
        unidad: it.unidad || "",
        stock_actual: Number(it.stock_actual) || 0,
        stock_bajo: it.stock_alerta ?? "",
        stock_minimo: it.stock_minimo ?? "",
        precio: Number(it.precio_unitario) || 0,
        total,
        estado: sem === "rojo" ? "Crítico" : sem === "amarillo" ? "Bajo" : "OK",
      };
    });
  }

  function exportarClienteCSV() {
    const filas = filasClienteReporte();
    if (filas.length === 0) {
      setToast?.({ type: "error", message: "Esta declaración no tiene productos." });
      return;
    }
    const headers = [
      "Producto",
      "Marca",
      "Unidad",
      "Stock actual",
      "Stock bajo",
      "Stock crítico",
      "Precio unitario",
      "Total",
      "Estado",
    ];
    const rows = filas.map((f) => [
      f.nombre,
      f.marca,
      f.unidad,
      f.stock_actual,
      f.stock_bajo,
      f.stock_minimo,
      f.precio,
      f.total,
      f.estado,
    ]);
    const slug = formatearRutVisual(declaracion.rut).replace(/[.\-]/g, "");
    descargarCSV(`stock-${slug}.csv`, headers, rows);
  }

  async function imprimirCliente() {
    const filas = filasClienteReporte();
    if (filas.length === 0) {
      setToast?.({ type: "error", message: "Esta declaración no tiene productos." });
      return;
    }
    const nCriticos = filas.filter((f) => f.estado === "Crítico").length;
    const nBajos = filas.filter((f) => f.estado === "Bajo").length;
    const nOk = filas.filter((f) => f.estado === "OK").length;
    const valorTotal = filas.reduce((acc, f) => acc + (Number(f.total) || 0), 0);
    const slug = formatearRutVisual(declaracion.rut).replace(/[.\-]/g, "");
    const ok = await descargarReportePDF({
      filename: `stock-${slug}.pdf`,
      titulo: "Reporte de stock del cliente",
      subtitulo: declaracion.razon_social || "",
      meta: [
        { label: "Cliente", valor: declaracion.razon_social || "" },
        { label: "RUT", valor: formatearRutVisual(declaracion.rut) },
        { label: "Declaración", valor: fmtFechaHora(declaracion.fecha) },
        { label: "Valor inventario", valor: fmtMoneda(valorTotal) },
      ],
      resumen: [
        { label: "Productos", valor: filas.length, tono: "neutro" },
        { label: "Crítico", valor: nCriticos, tono: "rojo" },
        { label: "Bajo", valor: nBajos, tono: "amarillo" },
        { label: "OK", valor: nOk, tono: "verde" },
      ],
      headers: [
        "Producto",
        "Marca",
        "Unidad",
        "Stock actual",
        "Stock bajo",
        "Stock crítico",
        "Total",
        "Estado",
      ],
      aligns: ["left", "left", "left", "right", "right", "right", "right", "center"],
      rows: filas.map((f) => [
        f.nombre,
        f.marca || "—",
        f.unidad || "—",
        f.stock_actual,
        f.stock_bajo || "—",
        f.stock_minimo || "—",
        fmtMoneda(f.total),
        f.estado,
      ]),
    });
    if (!ok) {
      setToast?.({ type: "error", message: "No pudimos generar el PDF. Intente nuevamente." });
    }
  }

  return (
    <div style={styles.modalOverlay} onClick={onCerrar}>
      <div style={styles.modalCard} onClick={(e) => e.stopPropagation()}>
        <div style={styles.modalHeader}>
          <div>
            <div style={styles.eyebrow}>Declaración #{declaracion.id}</div>
            <div
              onClick={irAFichaCliente}
              title={contacto?.id ? "Ver ficha del cliente" : undefined}
              style={{
                fontSize: 18,
                fontWeight: 700,
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                cursor: contacto?.id ? "pointer" : "default",
                color: contacto?.id ? TEAL : "#0f172a",
              }}
            >
              {declaracion.razon_social || declaracion.rut}
              {contacto?.id && <ExternalLink size={15} />}
            </div>
            <div style={{ fontSize: 13, color: "#64748b" }}>
              {formatearRutVisual(declaracion.rut)} · {fmtFechaHora(declaracion.fecha)}
            </div>
          </div>
          <button onClick={onCerrar} style={styles.btnIcon}>
            <X size={18} />
          </button>
        </div>

        <div style={styles.modalBody}>
          {/* Barra de contacto y exportación */}
          <div style={styles.contactoBar}>
            <button type="button" style={styles.btnWhatsapp} onClick={abrirWhatsApp}>
              <MessageCircle size={14} /> WhatsApp
            </button>
            <button
              type="button"
              style={styles.btnCorreo}
              onClick={() => setMostrarCorreo(true)}
            >
              <Mail size={14} /> Enviar correo
            </button>
            <ExportarMenu
              label="Exportar"
              variante="mini"
              onCSV={exportarClienteCSV}
              onImprimir={imprimirCliente}
              disabled={items.length === 0}
            />
            {(emailContacto || telefonoContacto) && (
              <span style={{ fontSize: 11.5, color: "#94a3b8", marginLeft: "auto" }}>
                {emailContacto}
                {emailContacto && telefonoContacto ? " · " : ""}
                {telefonoContacto}
              </span>
            )}
          </div>

          <div style={styles.modalSeccionTitulo}>Productos declarados</div>
          <div style={{ overflowX: "auto" }}>
          <table style={{ ...styles.tabla, minWidth: 640 }}>
            <thead>
              <tr>
                <th style={styles.th}>Producto</th>
                <th style={styles.th}>Marca</th>
                <th style={styles.th}>Unidad</th>
                <th style={{ ...styles.th, textAlign: "right" }}>Stock</th>
                <th style={{ ...styles.th, textAlign: "right" }}>Bajo</th>
                <th style={{ ...styles.th, textAlign: "right" }}>Crítico</th>
                <th style={{ ...styles.th, textAlign: "right" }}>Total</th>
                <th style={{ ...styles.th, textAlign: "center" }}>Semáforo</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, idx) => {
                const sem = it.semaforo || "verde";
                const colores =
                  sem === "rojo"
                    ? { bg: "#fee2e2", color: "#b91c1c", label: "Crítico" }
                    : sem === "amarillo"
                      ? { bg: "#fef3c7", color: "#b45309", label: "Bajo" }
                      : { bg: "#dcfce7", color: "#15803d", label: "OK" };
                const total =
                  (Number(it.stock_actual) || 0) *
                  (Number(it.precio_unitario) || 0);
                return (
                  <tr key={idx}>
                    <td style={styles.td}>{it.nombre}</td>
                    <td style={styles.td}>{it.marca || "—"}</td>
                    <td style={styles.td}>{it.unidad || "—"}</td>
                    <td style={{ ...styles.td, textAlign: "right" }}>{it.stock_actual}</td>
                    <td style={{ ...styles.td, textAlign: "right", color: "#64748b" }}>
                      {it.stock_alerta ?? "—"}
                    </td>
                    <td style={{ ...styles.td, textAlign: "right", color: "#64748b" }}>
                      {it.stock_minimo}
                    </td>
                    <td
                      style={{
                        ...styles.td,
                        textAlign: "right",
                        fontWeight: 600,
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {fmtMoneda(total)}
                    </td>
                    <td style={{ ...styles.td, textAlign: "center" }}>
                      <span
                        style={{
                          display: "inline-block",
                          padding: "3px 10px",
                          borderRadius: 999,
                          fontSize: 11,
                          fontWeight: 600,
                          background: colores.bg,
                          color: colores.color,
                        }}
                      >
                        {colores.label}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>

          {/* Solicitudes de cotización del cliente */}
          <div style={{ marginTop: 22 }}>
            <div style={styles.modalSeccionTitulo}>
              Cotizaciones solicitadas{" "}
              <span style={styles.modalSeccionConteo}>
                ({solicitudes.length})
              </span>
            </div>
            {cargandoSolicitudes ? (
              <div style={styles.solVacio}>Cargando cotizaciones…</div>
            ) : solicitudes.length === 0 ? (
              <div style={styles.solVacio}>
                Este cliente aún no envió solicitudes de cotización.
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {solicitudes.map((s) => {
                  const expandida = expandidaId === s.id;
                  const itemsSol = Array.isArray(s.items) ? s.items : [];
                  const estado =
                    ESTADOS_SOLICITUD_ADMIN[s.estado] ||
                    ESTADOS_SOLICITUD_ADMIN.pendiente;
                  return (
                    <div key={s.id} style={styles.solCard}>
                      <button
                        type="button"
                        onClick={() =>
                          setExpandidaId(expandida ? null : s.id)
                        }
                        style={styles.solHeader}
                      >
                        <div style={styles.solHeaderIzq}>
                          <span
                            style={{
                              ...styles.solBadge,
                              background: estado.bg,
                              color: estado.color,
                              border: `1px solid ${estado.borde}`,
                            }}
                          >
                            {estado.label}
                          </span>
                          <div>
                            <div style={styles.solTitulo}>
                              Solicitud #{s.id}
                            </div>
                            <div style={styles.solSub}>
                              {fmtFechaHora(s.created_at)} ·{" "}
                              {itemsSol.length} producto
                              {itemsSol.length === 1 ? "" : "s"}
                              {s.sucursal_id && sucursalesMap[s.sucursal_id] ? ` · 🏢 ${sucursalesMap[s.sucursal_id].nombre}` : ""}
                            </div>
                          </div>
                        </div>
                        <span
                          style={{
                            ...styles.solChevron,
                            transform: expandida
                              ? "rotate(180deg)"
                              : "none",
                          }}
                        >
                          ▾
                        </span>
                      </button>

                      {expandida && (
                        <div style={styles.solBody}>
                          {itemsSol.length > 0 && (
                            <table style={styles.tabla}>
                              <thead>
                                <tr>
                                  <th style={styles.th}>Producto</th>
                                  <th
                                    style={{
                                      ...styles.th,
                                      textAlign: "right",
                                    }}
                                  >
                                    Cantidad
                                  </th>
                                </tr>
                              </thead>
                              <tbody>
                                {itemsSol.map((it, idx) => (
                                  <tr key={idx}>
                                    <td style={styles.td}>{it.nombre}</td>
                                    <td
                                      style={{
                                        ...styles.td,
                                        textAlign: "right",
                                        fontWeight: 700,
                                        fontVariantNumeric: "tabular-nums",
                                      }}
                                    >
                                      {it.cantidad}
                                      {it.unidad ? ` ${it.unidad}` : ""}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}

                          {s.nota && (
                            <div style={styles.solNota}>
                              <div style={styles.solNotaLabel}>
                                Comentario del cliente
                              </div>
                              <div style={styles.solNotaTexto}>{s.nota}</div>
                            </div>
                          )}

                          {(s.contacto_email || s.contacto_telefono) && (
                            <div style={styles.solContacto}>
                              {s.contacto_email && (
                                <span>
                                  <strong>Correo:</strong> {s.contacto_email}
                                </span>
                              )}
                              {s.contacto_telefono && (
                                <span>
                                  <strong>Tel:</strong> {s.contacto_telefono}
                                </span>
                              )}
                            </div>
                          )}

                          {s.estado === "respondida" && s.respondida_at && (
                            <div style={styles.respondidaInfo}>
                              ✓ Atendida el {fmtFechaHora(s.respondida_at)}
                            </div>
                          )}
                          {s.estado === "cancelada" && (
                            <div style={styles.canceladaInfo}>
                              Solicitud cancelada
                            </div>
                          )}

                          {s.cotizacion && (
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "8px 12px", background: "#ecfdf5", border: "1px solid #a7f3d0", borderRadius: 10, marginBottom: 10 }}>
                              <div style={{ fontSize: 12.5, color: "#065f46" }}>
                                <strong>Cotización generada:</strong> {s.cotizacion.id_licitacion || `#${s.cotizacion.id}`} · {s.cotizacion.estado}
                              </div>
                              <button type="button" onClick={() => navigate(`/detalle/${s.cotizacion.id}`)} style={{ ...styles.btnSecMini, display: "inline-flex", alignItems: "center", gap: 5 }}>
                                Ver cotización
                              </button>
                            </div>
                          )}

                          <HiloMensajesAdmin solicitudId={s.id} setToast={setToast} />

                          <div style={styles.solAcciones}>
                            <button
                              type="button"
                              onClick={async () => {
                                try {
                                  await generarPDFSolicitud(s, {
                                    razon_social: declaracion.razon_social || "",
                                    rut: formatearRutVisual(declaracion.rut),
                                    fechaTexto: fmtFechaHora(s.created_at),
                                  });
                                } catch (e) {
                                  setToast({
                                    type: "error",
                                    message: e?.message || "No se pudo generar el PDF.",
                                  });
                                }
                              }}
                              style={{ ...styles.btnSecMini, display: "inline-flex", alignItems: "center", gap: 5 }}
                              title="Descargar la solicitud del cliente como PDF"
                            >
                              <FileDown size={14} />
                              Descargar PDF
                            </button>
                            {s.estado === "pendiente" && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => cambiarEstadoSolicitud(s.id, "cancelada")}
                                  style={styles.btnGhostMini}
                                  title="Marcar la solicitud como cancelada"
                                >
                                  Cancelar
                                </button>
                                <button
                                  type="button"
                                  onClick={() => cambiarEstadoSolicitud(s.id, "respondida")}
                                  style={styles.btnSecMini}
                                  title="Marcar como respondida sin crear cotización"
                                >
                                  Marcar respondida
                                </button>
                              </>
                            )}
                            {(s.estado === "respondida" || s.estado === "cancelada") && (
                              <button
                                type="button"
                                onClick={() => cambiarEstadoSolicitud(s.id, "pendiente")}
                                style={styles.btnGhostMini}
                                title="Volver a poner como pendiente"
                              >
                                Reabrir
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => crearCotizacionDesdeSolicitud(s)}
                              style={styles.btnCrearCotizacion}
                            >
                              <FilePlus size={14} />
                              Crear cotización con estos datos
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {mostrarCorreo && (
        <ModalComunicarCorreo
          declaracion={declaracion}
          emailInicial={emailContacto}
          onCerrar={() => setMostrarCorreo(false)}
          setToast={setToast}
        />
      )}
    </div>
  );
}

// Vista previa de la firma. Memoizada para que NO se vuelva a inyectar el HTML
// (ni recargue el logo) cada vez que el usuario teclea en el modal.
const FirmaPreview = memo(function FirmaPreview({ html }) {
  return (
    <div style={{ marginTop: 14 }}>
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          color: "#64748b",
          textTransform: "uppercase",
          letterSpacing: 0.5,
          marginBottom: 6,
        }}
      >
        Tu firma (se incluirá al enviar)
      </div>
      <div
        style={{
          border: "1px solid #e2e8f0",
          borderRadius: 10,
          padding: 14,
          background: "#f8fafc",
          maxHeight: 180,
          overflow: "auto",
        }}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
});

// Modal de redacción libre de correo al cliente. Sale desde la cuenta
// conectada del usuario con su firma; permite agregar correos en copia (CC).
function ModalComunicarCorreo({ declaracion, emailInicial, onCerrar, setToast }) {
  const [para, setPara] = useState(emailInicial || "");
  const [cc, setCc] = useState("");
  const [asunto, setAsunto] = useState("");
  const [mensaje, setMensaje] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [firmaHtml, setFirmaHtml] = useState("");

  // El correo del cliente puede llegar después de abrir el modal (la carga del
  // contacto es asíncrona). Lo completamos al llegar, sin pisar lo tecleado.
  useEffect(() => {
    if (emailInicial) setPara((prev) => prev || emailInicial);
  }, [emailInicial]);

  // Trae la firma del usuario para mostrarla como vista previa: es la misma
  // que se anexará al enviar el correo.
  useEffect(() => {
    let cancel = false;
    api
      .get("/correos/firma")
      .then((r) => {
        if (!cancel) setFirmaHtml(String(r?.html || ""));
      })
      .catch(() => undefined);
    return () => {
      cancel = true;
    };
  }, []);

  async function enviar() {
    if (!para.trim()) {
      setToast?.({ type: "warning", message: "Indique el correo de destino." });
      return;
    }
    if (!asunto.trim() || !mensaje.trim()) {
      setToast?.({ type: "warning", message: "Complete el asunto y el mensaje." });
      return;
    }
    // Copia: admite varios correos separados por coma o punto y coma.
    const ccLista = cc
      .split(/[,;]+/)
      .map((e) => e.trim())
      .filter(Boolean);
    setEnviando(true);
    try {
      await api.post("/stock-clientes/comunicar", {
        rut: declaracion.rut,
        para: para.trim(),
        cc: ccLista,
        asunto: asunto.trim(),
        mensaje: mensaje.trim(),
      });
      setToast?.({ type: "success", message: `Correo enviado a ${para.trim()}.` });
      onCerrar?.();
    } catch (e) {
      setToast?.({ type: "error", message: e?.message || "No pudimos enviar el correo." });
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div style={styles.modalOverlay} onClick={onCerrar}>
      <div
        style={{ ...styles.modalCard, maxWidth: 560 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={styles.modalHeader}>
          <div>
            <div style={styles.eyebrow}>Comunicación</div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>Enviar correo al cliente</div>
            <div style={{ fontSize: 13, color: "#64748b" }}>
              {declaracion.razon_social || formatearRutVisual(declaracion.rut)}
            </div>
          </div>
          <button onClick={onCerrar} style={styles.btnIcon}>
            <X size={18} />
          </button>
        </div>

        <div style={styles.modalBody}>
          <label style={styles.comunicarCampo}>
            Para
            <input
              type="email"
              value={para}
              onChange={(e) => setPara(e.target.value)}
              placeholder="cliente@empresa.cl"
              style={styles.input}
            />
          </label>
          <label style={styles.comunicarCampo}>
            Copia (CC) <span style={{ textTransform: "none", fontWeight: 400, color: "#94a3b8" }}>— opcional, separar con coma</span>
            <input
              type="text"
              value={cc}
              onChange={(e) => setCc(e.target.value)}
              placeholder="otro@correo.cl, jefatura@empresa.cl"
              style={styles.input}
            />
          </label>
          <label style={styles.comunicarCampo}>
            Asunto
            <input
              type="text"
              value={asunto}
              onChange={(e) => setAsunto(e.target.value)}
              placeholder="Ej: Recordatorio de reposición de stock"
              style={styles.input}
            />
          </label>
          <label style={{ ...styles.comunicarCampo, marginBottom: 4 }}>
            Mensaje
            <textarea
              value={mensaje}
              onChange={(e) => setMensaje(e.target.value)}
              rows={7}
              placeholder="Escriba aquí su mensaje. Saldrá desde su cuenta conectada con su firma."
              style={{
                ...styles.input,
                resize: "vertical",
                fontFamily: "inherit",
                textTransform: "none",
                letterSpacing: 0,
                fontWeight: 400,
              }}
            />
          </label>
          <div style={{ fontSize: 11.5, color: "#94a3b8" }}>
            Se enviará desde tu cuenta de correo conectada.
          </div>

          {firmaHtml && <FirmaPreview html={firmaHtml} />}
        </div>

        <div
          style={{
            padding: "14px 22px",
            borderTop: "1px solid #e2e8f0",
            display: "flex",
            justifyContent: "flex-end",
            gap: 8,
          }}
        >
          <button
            type="button"
            onClick={onCerrar}
            style={styles.btnGhost}
            disabled={enviando}
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={enviar}
            style={styles.btnPrimario}
            disabled={enviando}
          >
            <Send size={14} /> {enviando ? "Enviando…" : "Enviar correo"}
          </button>
        </div>
      </div>
    </div>
  );
}

function armarObservacionesSolicitud(declaracion, solicitud) {
  const fechaSolic = fmtFechaHora(solicitud?.created_at);
  const lineas = [
    `Cotización solicitada desde el portal del cliente #${solicitud?.id || "—"}`,
    `Fecha de solicitud: ${fechaSolic}`,
    "",
    "Productos solicitados:",
  ];
  const items = Array.isArray(solicitud?.items) ? solicitud.items : [];
  for (const it of items) {
    const unidad = it.unidad ? ` ${it.unidad}` : "";
    lineas.push(`  • ${it.nombre} — ${it.cantidad}${unidad}`);
  }
  if (solicitud?.nota) {
    lineas.push("");
    lineas.push("Comentario del cliente:");
    lineas.push(solicitud.nota);
  }
  return lineas.join("\n");
}

const ESTADOS_SOLICITUD_ADMIN = {
  pendiente: {
    label: "Pendiente",
    color: "#b45309",
    bg: "#fef3c7",
    borde: "rgba(245,158,11,0.30)",
  },
  respondida: {
    label: "Respondida",
    color: "#15803d",
    bg: "#dcfce7",
    borde: "rgba(34,197,94,0.30)",
  },
  cancelada: {
    label: "Cancelada",
    color: "#64748b",
    bg: "#f1f5f9",
    borde: "rgba(100,116,139,0.30)",
  },
};

/* ──────────────────────────────────────────────────────────────────────
   Modal: configuración de destinatarios
   ────────────────────────────────────────────────────────────────────── */
function ModalDestinatarios({ onCerrar, esAdmin, setToast }) {
  const [lista, setLista] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [emailNuevo, setEmailNuevo] = useState("");
  const [campanaNuevo, setCampanaNuevo] = useState(true);
  const [correoNuevo, setCorreoNuevo] = useState(true);
  const [guardando, setGuardando] = useState(false);

  async function cargar() {
    setCargando(true);
    try {
      const data = await api.get("/stock-clientes/destinatarios");
      setLista(Array.isArray(data) ? data : []);
    } catch (e) {
      setToast({ type: "error", message: e?.message || "No pudimos cargar los destinatarios." });
    } finally {
      setCargando(false);
    }
  }

  useEffect(() => {
    cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function agregar(e) {
    e?.preventDefault?.();
    if (!emailNuevo.trim()) {
      setToast({ type: "warning", message: "Ingrese un correo." });
      return;
    }
    setGuardando(true);
    try {
      await api.post("/stock-clientes/destinatarios", {
        user_email: emailNuevo.trim().toLowerCase(),
        recibe_campana: campanaNuevo,
        recibe_correo: correoNuevo,
        activo: true,
      });
      setEmailNuevo("");
      setCampanaNuevo(true);
      setCorreoNuevo(true);
      await cargar();
      setToast({ type: "success", message: "Destinatario agregado." });
    } catch (e) {
      setToast({ type: "error", message: e?.message || "No pudimos agregar el destinatario." });
    } finally {
      setGuardando(false);
    }
  }

  async function actualizar(row, cambios) {
    try {
      await api.put(`/stock-clientes/destinatarios/${row.id}`, {
        user_email: row.user_email,
        recibe_campana: row.recibe_campana,
        recibe_correo: row.recibe_correo,
        activo: row.activo,
        ...cambios,
      });
      await cargar();
    } catch (e) {
      setToast({ type: "error", message: e?.message || "No pudimos actualizar." });
    }
  }

  async function eliminar(id) {
    if (!window.confirm("¿Eliminar este destinatario? Dejará de recibir alertas de stock.")) return;
    try {
      await api.delete(`/stock-clientes/destinatarios/${id}`);
      await cargar();
      setToast({ type: "success", message: "Destinatario eliminado." });
    } catch (e) {
      setToast({ type: "error", message: e?.message || "No pudimos eliminar." });
    }
  }

  return (
    <div style={styles.modalOverlay} onClick={onCerrar}>
      <div style={{ ...styles.modalCard, maxWidth: 700 }} onClick={(e) => e.stopPropagation()}>
        <div style={styles.modalHeader}>
          <div>
            <div style={styles.eyebrow}>Configuración</div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>Destinatarios de alertas</div>
            <div style={{ fontSize: 13, color: "#64748b" }}>
              Reciben notificación cuando un cliente declara stock en amarillo o rojo.
            </div>
          </div>
          <button onClick={onCerrar} style={styles.btnIcon}>
            <X size={18} />
          </button>
        </div>

        <div style={styles.modalBody}>
          {/* Form alta */}
          {esAdmin && (
            <form onSubmit={agregar} style={styles.formAlta}>
              <input
                type="email"
                placeholder="correo@amsodent.cl"
                value={emailNuevo}
                onChange={(e) => setEmailNuevo(e.target.value)}
                style={{ ...styles.input, flex: 1 }}
                disabled={guardando}
              />
              <label style={styles.chkInline}>
                <input
                  type="checkbox"
                  checked={campanaNuevo}
                  onChange={(e) => setCampanaNuevo(e.target.checked)}
                />
                <Bell size={12} /> Campana
              </label>
              <label style={styles.chkInline}>
                <input
                  type="checkbox"
                  checked={correoNuevo}
                  onChange={(e) => setCorreoNuevo(e.target.checked)}
                />
                <Mail size={12} /> Correo
              </label>
              <button type="submit" style={styles.btnPrimario} disabled={guardando}>
                <Plus size={14} /> Agregar
              </button>
            </form>
          )}

          {/* Lista */}
          {cargando ? (
            <div style={{ padding: 20, textAlign: "center", color: "#64748b" }}>Cargando…</div>
          ) : lista.length === 0 ? (
            <div style={{ padding: 20, textAlign: "center", color: "#64748b" }}>
              No hay destinatarios configurados aún.
            </div>
          ) : (
            <table style={styles.tabla}>
              <thead>
                <tr>
                  <th style={styles.th}>Correo</th>
                  <th style={{ ...styles.th, textAlign: "center" }}>Campana</th>
                  <th style={{ ...styles.th, textAlign: "center" }}>Correo</th>
                  <th style={{ ...styles.th, textAlign: "center" }}>Activo</th>
                  {esAdmin && <th style={styles.th} />}
                </tr>
              </thead>
              <tbody>
                {lista.map((row) => (
                  <tr key={row.id}>
                    <td style={styles.td}>{row.user_email}</td>
                    <td style={{ ...styles.td, textAlign: "center" }}>
                      <input
                        type="checkbox"
                        checked={!!row.recibe_campana}
                        disabled={!esAdmin}
                        onChange={(e) => actualizar(row, { recibe_campana: e.target.checked })}
                      />
                    </td>
                    <td style={{ ...styles.td, textAlign: "center" }}>
                      <input
                        type="checkbox"
                        checked={!!row.recibe_correo}
                        disabled={!esAdmin}
                        onChange={(e) => actualizar(row, { recibe_correo: e.target.checked })}
                      />
                    </td>
                    <td style={{ ...styles.td, textAlign: "center" }}>
                      <input
                        type="checkbox"
                        checked={!!row.activo}
                        disabled={!esAdmin}
                        onChange={(e) => actualizar(row, { activo: e.target.checked })}
                      />
                    </td>
                    {esAdmin && (
                      <td style={{ ...styles.td, textAlign: "right" }}>
                        <button onClick={() => eliminar(row.id)} style={styles.btnIcon} title="Eliminar">
                          <Trash2 size={14} />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

const styles = {
  page: { padding: 24, maxWidth: 1280, margin: "0 auto" },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-end",
    flexWrap: "wrap",
    gap: 18,
    marginBottom: 22,
  },
  eyebrow: {
    fontSize: 11,
    color: "#94a3b8",
    textTransform: "uppercase",
    fontWeight: 600,
    letterSpacing: 1,
  },
  h1: { fontSize: 26, fontWeight: 700, color: "#0f172a", margin: "4px 0 2px" },
  sub: { fontSize: 13, color: "#64748b", margin: 0 },
  codeInline: {
    background: "#f1f5f9",
    padding: "2px 6px",
    borderRadius: 4,
    fontSize: 12,
    color: TEAL,
    marginLeft: 6,
  },
  btnGhost: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    border: "1px solid #cbd5e1",
    background: "#fff",
    color: "#475569",
    fontSize: 13,
    fontWeight: 500,
    padding: "9px 14px",
    borderRadius: 8,
    cursor: "pointer",
  },
  btnPrimario: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    background: `linear-gradient(135deg, ${TEAL}, ${TEAL_LIGHT})`,
    color: "#fff",
    border: "none",
    fontSize: 13,
    fontWeight: 600,
    padding: "9px 14px",
    borderRadius: 8,
    cursor: "pointer",
    boxShadow: "0 6px 14px rgba(40,174,177,0.20)",
  },
  btnFiltrar: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    background: TEAL_LIGHT,
    color: "#fff",
    border: "none",
    fontSize: 13,
    fontWeight: 500,
    padding: "9px 14px",
    borderRadius: 8,
    cursor: "pointer",
  },
  btnIcon: {
    border: "none",
    background: "transparent",
    cursor: "pointer",
    color: "#64748b",
    padding: 6,
    borderRadius: 6,
  },
  linkVer: { color: TEAL, fontSize: 12, fontWeight: 600 },

  kpisGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
    gap: 12,
    marginBottom: 18,
  },
  kpiCard: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: 16,
    borderRadius: 12,
    border: "1px solid #e2e8f0",
    boxShadow: "0 2px 8px rgba(15,23,42,0.04)",
  },
  kpiIcon: {
    width: 42,
    height: 42,
    borderRadius: 10,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },

  filtrosCard: {
    display: "flex",
    flexWrap: "wrap",
    gap: 14,
    alignItems: "flex-end",
    background: "#fff",
    border: "1px solid #e2e8f0",
    borderRadius: 14,
    padding: "14px 16px",
    marginBottom: 16,
    boxShadow: "0 1px 3px rgba(15,23,42,0.04)",
  },
  filtroGroup: { display: "flex", flexDirection: "column", gap: 5 },
  filtroLabel: {
    fontSize: 10.5,
    color: "#64748b",
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: 0.7,
  },
  filtroAcciones: {
    display: "flex",
    gap: 8,
    alignItems: "center",
    paddingTop: 14,
    marginLeft: "auto",
  },
  filtroChk: {
    display: "inline-flex",
    alignItems: "center",
    gap: 7,
    fontSize: 12.5,
    color: "#475569",
    cursor: "pointer",
    userSelect: "none",
    fontWeight: 500,
  },
  input: {
    height: 36,
    padding: "0 10px",
    border: "1px solid var(--border-strong)",
    borderRadius: "var(--radius)",
    fontSize: 13.5,
    color: "var(--text)",
    background: "var(--surface)",
    outline: "none",
    minWidth: 120,
    width: "100%",
    boxSizing: "border-box",
  },
  dropdown: {
    position: "absolute",
    top: "calc(100% + 4px)",
    left: 0,
    right: 0,
    background: "var(--surface)",
    border: "1px solid var(--border)",
    borderRadius: 10,
    boxShadow: "0 10px 30px rgba(15,23,42,0.15)",
    maxHeight: 280,
    overflowY: "auto",
    zIndex: 50,
    padding: 4,
  },
  dropdownItem: {
    display: "block",
    width: "100%",
    textAlign: "left",
    padding: "8px 10px",
    border: "none",
    background: "transparent",
    cursor: "pointer",
    borderRadius: 6,
  },
  exportMenu: {
    position: "absolute",
    top: "calc(100% + 6px)",
    right: 0,
    background: "#fff",
    border: "1px solid #e2e8f0",
    borderRadius: 10,
    boxShadow: "0 12px 28px rgba(15,23,42,0.14)",
    padding: 6,
    zIndex: 60,
    minWidth: 210,
  },
  exportOpcion: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    width: "100%",
    textAlign: "left",
    padding: "9px 12px",
    background: "transparent",
    border: "none",
    borderRadius: 8,
    fontSize: 13,
    color: "#334155",
    fontWeight: 500,
    cursor: "pointer",
  },
  contactoBar: {
    display: "flex",
    flexWrap: "wrap",
    gap: 8,
    alignItems: "center",
    padding: "12px 0 16px",
    marginBottom: 14,
    borderBottom: "1px solid #f1f5f9",
  },
  btnWhatsapp: {
    display: "inline-flex",
    alignItems: "center",
    gap: 7,
    padding: "8px 14px",
    background: "#25d366",
    color: "#fff",
    border: "none",
    fontSize: 12.5,
    fontWeight: 700,
    borderRadius: 999,
    cursor: "pointer",
    boxShadow: "0 6px 14px rgba(37,211,102,0.28)",
    textDecoration: "none",
  },
  btnCorreo: {
    display: "inline-flex",
    alignItems: "center",
    gap: 7,
    padding: "8px 14px",
    background: "#fff",
    color: TEAL,
    border: `1px solid ${TEAL}40`,
    fontSize: 12.5,
    fontWeight: 700,
    borderRadius: 999,
    cursor: "pointer",
  },
  comunicarCampo: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    fontSize: 11,
    color: "#64748b",
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 12,
  },

  tablaCard: {
    background: "#fff",
    border: "1px solid #e2e8f0",
    borderRadius: 14,
    overflow: "hidden",
    boxShadow: "0 4px 14px rgba(15,23,42,0.04)",
  },
  tablaHeader: {
    padding: "16px 20px",
    borderBottom: "1px solid #f1f5f9",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    background: "linear-gradient(180deg, #ffffff 0%, #fafbfc 100%)",
  },
  tablaTitulo: { fontSize: 14, fontWeight: 700, color: "#0f172a" },
  tablaSub: { fontSize: 12, color: "#94a3b8", marginTop: 2 },
  tablaWrap: { overflowX: "auto" },
  tabla: { width: "100%", borderCollapse: "collapse" },
  th: {
    textAlign: "left",
    padding: "11px 16px",
    fontSize: 10.5,
    fontWeight: 700,
    color: "#64748b",
    textTransform: "uppercase",
    letterSpacing: 0.7,
    background: "linear-gradient(180deg, #f8fafc 0%, #f1f5f9 100%)",
    borderBottom: "1px solid #e2e8f0",
  },
  tr: {
    cursor: "pointer",
    transition: "background .15s ease",
  },
  td: {
    padding: "12px 16px",
    borderBottom: "1px solid #f1f5f9",
    fontSize: 13,
    color: "#0f172a",
    verticalAlign: "middle",
  },
  tdEmpty: { padding: 48, textAlign: "center", color: "#94a3b8", fontSize: 13 },

  modalOverlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(15,23,42,0.45)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
    zIndex: 1000,
  },
  modalCard: {
    background: "#fff",
    borderRadius: 14,
    maxWidth: 820,
    width: "100%",
    maxHeight: "85vh",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    boxShadow: "0 20px 60px rgba(0,0,0,0.25)",
  },
  modalHeader: {
    padding: "16px 22px",
    borderBottom: "1px solid #e2e8f0",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  modalBody: { padding: 18, overflowY: "auto", flex: 1 },
  modalSeccionTitulo: {
    fontSize: 12,
    fontWeight: 700,
    color: "#475569",
    textTransform: "uppercase",
    letterSpacing: 0.7,
    marginBottom: 10,
    display: "flex",
    alignItems: "center",
    gap: 8,
  },
  modalSeccionConteo: {
    fontSize: 11,
    fontWeight: 600,
    color: "#94a3b8",
    textTransform: "none",
    letterSpacing: 0,
  },
  solVacio: {
    padding: "20px 16px",
    background: "#f8fafc",
    color: "#64748b",
    fontSize: 12.5,
    borderRadius: 10,
    textAlign: "center",
    border: "1px dashed #cbd5e1",
  },
  solCard: {
    background: "#fff",
    border: "1px solid #e2e8f0",
    borderRadius: 10,
    overflow: "hidden",
  },
  solHeader: {
    width: "100%",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "10px 14px",
    background: "transparent",
    border: "none",
    cursor: "pointer",
    textAlign: "left",
    gap: 10,
  },
  solHeaderIzq: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    minWidth: 0,
    flex: 1,
  },
  solBadge: {
    display: "inline-block",
    padding: "3px 10px",
    borderRadius: 999,
    fontSize: 10.5,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    flexShrink: 0,
  },
  solTitulo: { fontSize: 13, fontWeight: 700, color: "#0f172a" },
  solSub: { fontSize: 11.5, color: "#64748b", marginTop: 2 },
  solChevron: {
    color: "#94a3b8",
    fontSize: 14,
    transition: "transform .2s ease",
    flexShrink: 0,
  },
  solBody: {
    padding: "4px 14px 14px",
    display: "flex",
    flexDirection: "column",
    gap: 10,
    borderTop: "1px solid #f1f5f9",
  },
  solNota: {
    padding: 10,
    background: "#f8fafc",
    borderRadius: 8,
    border: "1px solid #f1f5f9",
  },
  solNotaLabel: {
    fontSize: 10,
    fontWeight: 700,
    color: "#64748b",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  solNotaTexto: {
    fontSize: 12.5,
    color: "#334155",
    lineHeight: 1.5,
    whiteSpace: "pre-wrap",
  },
  solContacto: {
    display: "flex",
    gap: 14,
    flexWrap: "wrap",
    fontSize: 12,
    color: "#475569",
  },
  solAcciones: {
    display: "flex",
    justifyContent: "flex-end",
    alignItems: "center",
    gap: 8,
    paddingTop: 8,
    borderTop: "1px dashed #e2e8f0",
    marginTop: 4,
    flexWrap: "wrap",
  },
  btnGhostMini: {
    padding: "7px 12px",
    background: "transparent",
    color: "#64748b",
    border: "1px solid #e2e8f0",
    fontSize: 11.5,
    fontWeight: 600,
    borderRadius: 999,
    cursor: "pointer",
    transition: "background .15s, color .15s",
  },
  btnSecMini: {
    padding: "7px 12px",
    background: "#fff",
    color: "#15803d",
    border: "1px solid rgba(34,197,94,0.30)",
    fontSize: 11.5,
    fontWeight: 600,
    borderRadius: 999,
    cursor: "pointer",
  },
  respondidaInfo: {
    fontSize: 12,
    color: "#15803d",
    fontWeight: 600,
    background: "#dcfce7",
    padding: "6px 12px",
    borderRadius: 8,
    border: "1px solid rgba(34,197,94,0.20)",
    display: "inline-block",
  },
  canceladaInfo: {
    fontSize: 12,
    color: "#64748b",
    fontWeight: 600,
    background: "#f1f5f9",
    padding: "6px 12px",
    borderRadius: 8,
    border: "1px solid rgba(100,116,139,0.20)",
    display: "inline-block",
  },
  btnCrearCotizacion: {
    display: "inline-flex",
    alignItems: "center",
    gap: 7,
    padding: "8px 16px",
    background: `linear-gradient(135deg, ${TEAL}, ${TEAL_LIGHT})`,
    color: "#fff",
    border: "none",
    fontSize: 12.5,
    fontWeight: 700,
    borderRadius: 999,
    cursor: "pointer",
    boxShadow: "0 6px 14px rgba(40,174,177,0.22)",
    transition: "transform .15s ease, box-shadow .2s ease",
  },

  formAlta: {
    display: "flex",
    gap: 8,
    flexWrap: "wrap",
    alignItems: "center",
    background: "#f8fafc",
    padding: 12,
    borderRadius: 10,
    border: "1px dashed #cbd5e1",
    marginBottom: 14,
  },
  chkInline: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    fontSize: 12,
    color: "#475569",
    cursor: "pointer",
  },
};
