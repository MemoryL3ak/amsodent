import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import useAuth from "../hooks/useAuth";
import DateFilter from "../components/DateFilter";
import { FileText, Trophy, TrendingUp, CircleDollarSign, Activity } from "lucide-react";

const ESTADOS_ORDEN = [
  "En espera",
  "Pendiente Aprobación",
  "Adjudicada",
  "Perdida",
  "Desierta",
  "Descartada",
];
const VISTAS_ADJUDICADO = [
  { value: "ambos", label: "Consumido + Por consumir" },
  { value: "consumido", label: "Solo consumido" },
  { value: "pendiente", label: "Solo por consumir" },
];

function hoyISO() {
  return new Date().toISOString().slice(0, 10);
}

function inicioMesISO() {
  const d = new Date();
  d.setDate(1);
  return d.toISOString().slice(0, 10);
}

function toDateISO(value) {
  if (!value) return "";
  const s = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

function montoLicitacion(l) {
  const total = Number(l?.total_con_iva || 0);
  if (total > 0) return total;
  return Number(l?.monto || 0);
}

function fmtCLP(value) {
  return `$${Number(value || 0).toLocaleString("es-CL")}`;
}

function montoNetoDesdeBruto(value) {
  return Math.round(Number(value || 0) / 1.19);
}

function montoBrutoDesdeNeto(value) {
  return Math.round(Number(value || 0) * 1.19);
}

function fmtPct(value) {
  if (!Number.isFinite(Number(value))) return "0%";
  return `${Number(value).toFixed(1)}%`;
}

function montoAdjPorVista({ consumido, pendiente, vista }) {
  if (vista === "consumido") return Number(consumido || 0);
  if (vista === "pendiente") return Number(pendiente || 0);
  return Number(consumido || 0);
}

function isMissingMontoColumnError(error) {
  const code = (error?.code || "").toString().toUpperCase();
  const msg = [error?.message, error?.details, error?.hint]
    .filter(Boolean)
    .join(" ")
    .toString()
    .toLowerCase();
  return (
    code === "42703" ||
    code === "PGRST204" ||
    (msg.includes("monto") && msg.includes("column")) ||
    (msg.includes("monto") && msg.includes("schema cache"))
  );
}

function badgeEstado(estado) {
  const map = {
    "En espera":            "badge badge-warning",
    "Pendiente Aprobación": "badge badge-warning",
    "Adjudicada":           "badge badge-success",
    "Perdida":              "badge badge-danger",
    "Desierta":             "badge badge-neutral",
    "Descartada":           "badge badge-neutral",
  };
  return map[estado] || "badge badge-neutral";
}

function KpiCard({ title, value, subtitle, minor, color, icon: Icon }) {
  return (
    <div style={{
      background: "var(--surface)",
      borderRadius: "var(--radius-lg)",
      border: "1px solid var(--border)",
      borderTop: `3px solid ${color}`,
      padding: "18px 20px",
      boxShadow: "var(--shadow-sm)",
    }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: "10px" }}>
        <div style={{ fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.12em", color: "var(--text-muted)", fontWeight: 600 }}>
          {title}
        </div>
        {Icon && (
          <div style={{
            width: "30px", height: "30px", borderRadius: "8px",
            background: `${color}18`,
            display: "flex", alignItems: "center", justifyContent: "center",
            color: color, flexShrink: 0,
          }}>
            <Icon size={15} />
          </div>
        )}
      </div>
      <div style={{ fontSize: "26px", fontWeight: 700, color: "var(--text)", lineHeight: 1, marginBottom: "6px" }}>
        {value}
      </div>
      {subtitle ? <div style={{ fontSize: "12px", color: "var(--text-muted)" }}>{subtitle}</div> : null}
      {minor   ? <div style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "2px" }}>{minor}</div> : null}
    </div>
  );
}

export default function Ventas() {
  const { user, rol, cargando } = useAuth();
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");
  const [licitaciones, setLicitaciones] = useState([]);
  const [montoOcByLicitacion, setMontoOcByLicitacion] = useState({});
  const [usuariosMap, setUsuariosMap] = useState({});
  const [fechaDesde, setFechaDesde] = useState(inicioMesISO());
  const [fechaHasta, setFechaHasta] = useState(hoyISO());
  const [filtroVendedor, setFiltroVendedor] = useState("");
  const [filtroRegionResumen, setFiltroRegionResumen] = useState("");
  const [vistaAdjudicado, setVistaAdjudicado] = useState("ambos");

  const rolNorm = (rol || "").toString().trim().toLowerCase();
  const esAdmin = rolNorm === "admin" || rolNorm === "administrador";
  const esVentas = rolNorm === "ventas";
  const esJefatura =
    esAdmin ||
    rolNorm === "jefe_ventas" ||
    rolNorm === "jefe ventas" ||
    rolNorm === "jefe-ventas" ||
    rolNorm === "jefe de ventas";
  const puedeVerVentas = esJefatura || esVentas;

  useEffect(() => {
    if (cargando) return;
    if (!puedeVerVentas) {
      setLoading(false);
      setErrorMsg("Acceso restringido: esta seccion es solo para administradores, jefatura o ventas.");
      setLicitaciones([]);
      setMontoOcByLicitacion({});
      setUsuariosMap({});
      return;
    }

    let mounted = true;

    async function cargarDatos() {
      setLoading(true);
      setErrorMsg("");

      try {
        const lics = await api.get("/licitaciones/with-fields?fields=id,id_licitacion,fecha,fecha_adjudicada,estado,creado_por,monto,total_con_iva,total_sin_iva,comuna,region");

        let rows = lics || [];
        const emailUser = (user?.email || "").trim().toLowerCase();
        if (esVentas && emailUser) {
          rows = rows.filter((l) => (l.creado_por || "").trim().toLowerCase() === emailUser);
        }

        const ids = rows.map((l) => Number(l?.id)).filter((n) => Number.isFinite(n));
        let montoOcMap = {};
        if (ids.length > 0) {
          try {
            const docsOc = await api.post("/licitaciones/documentos/filter", {
              filter: { licitacion_ids: ids, tipo: "orden_compra" },
              fields: "licitacion_id,monto,fecha_oc,created_at",
            });

            const primeraOcMap = {};
            (docsOc || []).forEach((d) => {
              const licId = Number(d?.licitacion_id || 0);
              if (!licId) return;
              montoOcMap[licId] =
                Number(montoOcMap[licId] || 0) +
                montoBrutoDesdeNeto(Number(d?.monto || 0));
              const fechaDoc = toDateISO(d?.fecha_oc) || toDateISO(d?.created_at);
              if (fechaDoc) {
                if (!primeraOcMap[licId] || fechaDoc < primeraOcMap[licId]) {
                  primeraOcMap[licId] = fechaDoc;
                }
              }
            });
            rows = rows.map((l) => ({
              ...l,
              fecha_adjudicacion: primeraOcMap[Number(l.id)] || null,
            }));
          } catch (errDocsOc) {
            if (isMissingMontoColumnError(errDocsOc)) {
              montoOcMap = {};
            } else {
              console.error("Error cargando montos OC:", errDocsOc);
            }
          }
        }

        const emails = Array.from(
          new Set(rows.map((l) => (l.creado_por || "").trim().toLowerCase()).filter(Boolean))
        );

        let mapa = {};
        if (emails.length > 0) {
          try {
            const perfiles = await api.post("/usuarios/profiles/by-emails", { emails });

            (perfiles || []).forEach((p) => {
              const email = (p?.email || "").trim().toLowerCase();
              if (email) mapa[email] = (p?.nombre || "").trim();
            });
          } catch (errProfiles) {
            console.error("Error profiles:", errProfiles);
          }
        }

        if (!mounted) return;
        setLicitaciones(rows);
        setMontoOcByLicitacion(montoOcMap);
        setUsuariosMap(mapa);
      } catch (e) {
        console.error("Error cargando ventas:", e);
        if (mounted) {
          setErrorMsg("No se pudo cargar el resumen de ventas.");
          setLicitaciones([]);
          setMontoOcByLicitacion({});
          setUsuariosMap({});
        }
      } finally {
        if (mounted) setLoading(false);
      }
    }

    cargarDatos();

    return () => {
      mounted = false;
    };
  }, [cargando, puedeVerVentas, esVentas, user?.email]);

  if (!cargando && !puedeVerVentas) {
    return (
      <div className="page">
        <div className="surface">
          <div className="surface-body" style={{ color: "var(--danger)" }}>
            Acceso restringido: esta seccion es solo para administradores, jefatura o ventas.
          </div>
        </div>
      </div>
    );
  }

  const opcionesVendedores = useMemo(() => {
    return Array.from(
      new Set(
        licitaciones
          .map((l) => (l.creado_por || "").trim().toLowerCase())
          .filter(Boolean)
      )
    )
      .map((email) => ({
        value: email,
        label: (usuariosMap[email] || "").trim() || email,
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [licitaciones, usuariosMap]);

  const licitacionesFiltradas = useMemo(() => {
    let desde = fechaDesde || "";
    let hasta = fechaHasta || "";

    if (desde && hasta && desde > hasta) {
      const tmp = desde;
      desde = hasta;
      hasta = tmp;
    }

    return licitaciones.filter((l) => {
      // Fecha de adjudicación = fecha de creación de la primera OC
      const fechaAdj = l.fecha_adjudicacion || null;
      if (desde || hasta) {
        if (!fechaAdj) return false;
        if (desde && fechaAdj < desde) return false;
        if (hasta && fechaAdj > hasta) return false;
      }

      const email = (l.creado_por || "").trim().toLowerCase();
      if (filtroVendedor && email !== filtroVendedor) return false;

      return true;
    });
  }, [licitaciones, fechaDesde, fechaHasta, filtroVendedor]);

  const resumenGeneral = useMemo(() => {
    const total = licitacionesFiltradas.length;
    const adjudicadas = licitacionesFiltradas.filter((l) => l.estado === "Adjudicada");
    const pendientes = licitacionesFiltradas.filter(
      (l) => l.estado === "En espera" || l.estado === "Pendiente Aprobación"
    );
    const perdidas = licitacionesFiltradas.filter((l) => l.estado === "Perdida");
    const montoTotal = licitacionesFiltradas.reduce((acc, l) => acc + montoLicitacion(l), 0);
    const montoAdjudicado = adjudicadas.reduce((acc, l) => acc + montoLicitacion(l), 0);
    const montoAdjudicadoConsumido = adjudicadas.reduce(
      (acc, l) => acc + Number(montoOcByLicitacion[l.id] || 0),
      0
    );
    const montoAdjudicadoPendiente = Math.max(0, montoAdjudicado - montoAdjudicadoConsumido);
    const montoAdjudicadoVista = montoAdjPorVista({
      consumido: montoAdjudicadoConsumido,
      pendiente: montoAdjudicadoPendiente,
      vista: vistaAdjudicado,
    });
    const montoTotalNeto = montoNetoDesdeBruto(montoTotal);
    const montoAdjudicadoNeto = montoNetoDesdeBruto(montoAdjudicado);
    const montoAdjudicadoConsumidoNeto = montoNetoDesdeBruto(montoAdjudicadoConsumido);
    const montoAdjudicadoPendienteNeto = Math.max(
      0,
      montoAdjudicadoNeto - montoAdjudicadoConsumidoNeto
    );
    const montoAdjudicadoVistaNeto = montoAdjPorVista({
      consumido: montoAdjudicadoConsumidoNeto,
      pendiente: montoAdjudicadoPendienteNeto,
      vista: vistaAdjudicado,
    });
    const montoAdjudicadoVistaBruto = montoAdjPorVista({
      consumido: montoAdjudicadoConsumido,
      pendiente: montoAdjudicadoPendiente,
      vista: vistaAdjudicado,
    });
    const ticketPromedio = total > 0 ? montoTotal / total : 0;
    const tasaAdjudicacion = total > 0 ? (adjudicadas.length / total) * 100 : 0;

    return {
      total,
      adjudicadas: adjudicadas.length,
      pendientes: pendientes.length,
      perdidas: perdidas.length,
      montoTotal,
      montoAdjudicado,
      montoAdjudicadoConsumido,
      montoAdjudicadoPendiente,
      montoAdjudicadoVista,
      montoTotalNeto,
      montoAdjudicadoNeto,
      montoAdjudicadoConsumidoNeto,
      montoAdjudicadoPendienteNeto,
      montoAdjudicadoVistaNeto,
      montoAdjudicadoVistaBruto,
      ticketPromedio,
      tasaAdjudicacion,
    };
  }, [licitacionesFiltradas, montoOcByLicitacion, vistaAdjudicado]);

  const resumenPorEstado = useMemo(() => {
    const total = licitacionesFiltradas.length || 1;
    const grupos = new Map();

    licitacionesFiltradas.forEach((l) => {
      const estado = (l.estado || "Sin estado").trim() || "Sin estado";
      const prev = grupos.get(estado) || { estado, cantidad: 0, monto: 0 };
      prev.cantidad += 1;
      prev.monto += montoLicitacion(l);
      grupos.set(estado, prev);
    });

    return Array.from(grupos.values())
      .map((r) => ({
        ...r,
        porcentaje: (r.cantidad / total) * 100,
      }))
      .sort((a, b) => {
        const ai = ESTADOS_ORDEN.indexOf(a.estado);
        const bi = ESTADOS_ORDEN.indexOf(b.estado);
        if (ai !== -1 || bi !== -1) return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
        return b.cantidad - a.cantidad;
      });
  }, [licitacionesFiltradas]);

  const resumenVendedores = useMemo(() => {
    const m = new Map();

    licitacionesFiltradas.forEach((l) => {
      const email = (l.creado_por || "").trim().toLowerCase() || "__sin_creador__";
      const nombre = (usuariosMap[email] || "").trim() || (email === "__sin_creador__" ? "Sin nombre" : email);
      const row = m.get(email) || {
        email,
        nombre,
        total: 0,
        adjudicadas: 0,
        pendientes: 0,
        perdidas: 0,
        desiertas: 0,
        descartadas: 0,
        montoTotal: 0,
        montoAdjudicado: 0,
        montoAdjudicadoConsumido: 0,
        montoAdjudicadoPendiente: 0,
      };

      row.total += 1;
      row.montoTotal += montoLicitacion(l);

      if (l.estado === "Adjudicada") {
        const montoAdj = montoLicitacion(l);
        const montoConsumido = Number(montoOcByLicitacion[l.id] || 0);
        row.adjudicadas += 1;
        row.montoAdjudicado += montoAdj;
        row.montoAdjudicadoConsumido += montoConsumido;
        row.montoAdjudicadoPendiente += Math.max(0, montoAdj - montoConsumido);
      } else if (l.estado === "Perdida") {
        row.perdidas += 1;
      } else if (l.estado === "Desierta") {
        row.desiertas += 1;
      } else if (l.estado === "Descartada") {
        row.descartadas += 1;
      } else if (l.estado === "En espera" || l.estado === "Pendiente Aprobación") {
        row.pendientes += 1;
      }

      m.set(email, row);
    });

    return Array.from(m.values())
      .map((r) => ({
        ...r,
        tasaAdjudicacion: r.total > 0 ? (r.adjudicadas / r.total) * 100 : 0,
        ticketPromedio: r.total > 0 ? r.montoTotal / r.total : 0,
      }))
      .sort(
        (a, b) =>
          b.adjudicadas - a.adjudicadas ||
          b.total - a.total ||
          b.montoTotal - a.montoTotal ||
          a.nombre.localeCompare(b.nombre)
      );
  }, [licitacionesFiltradas, usuariosMap, montoOcByLicitacion]);

  const resumenRegiones = useMemo(() => {
    const m = new Map();

    licitacionesFiltradas.forEach((l) => {
      const region = (l.region || "").toString().trim() || "Sin region";
      const row = m.get(region) || {
        region,
        total: 0,
        adjudicadas: 0,
        pendientes: 0,
        perdidas: 0,
        desiertas: 0,
        descartadas: 0,
        montoTotal: 0,
        montoAdjudicado: 0,
        montoAdjudicadoConsumido: 0,
        montoAdjudicadoPendiente: 0,
      };

      row.total += 1;
      row.montoTotal += montoLicitacion(l);

      if (l.estado === "Adjudicada") {
        const montoAdj = montoLicitacion(l);
        const montoConsumido = Number(montoOcByLicitacion[l.id] || 0);
        row.adjudicadas += 1;
        row.montoAdjudicado += montoAdj;
        row.montoAdjudicadoConsumido += montoConsumido;
        row.montoAdjudicadoPendiente += Math.max(0, montoAdj - montoConsumido);
      } else if (l.estado === "Perdida") {
        row.perdidas += 1;
      } else if (l.estado === "Desierta") {
        row.desiertas += 1;
      } else if (l.estado === "Descartada") {
        row.descartadas += 1;
      } else if (l.estado === "En espera" || l.estado === "Pendiente Aprobación") {
        row.pendientes += 1;
      }

      m.set(region, row);
    });

    return Array.from(m.values()).sort(
      (a, b) =>
        b.total - a.total ||
        b.adjudicadas - a.adjudicadas ||
        b.montoTotal - a.montoTotal ||
        a.region.localeCompare(b.region)
    );
  }, [licitacionesFiltradas, montoOcByLicitacion]);

  const resumenRegionesFiltrado = useMemo(() => {
    const q = (filtroRegionResumen || "").toString().trim().toLowerCase();
    if (!q) return resumenRegiones;
    return resumenRegiones.filter((r) =>
      String(r.region || "").toLowerCase().includes(q)
    );
  }, [resumenRegiones, filtroRegionResumen]);

  const barrasVendedores = useMemo(() => resumenVendedores, [resumenVendedores]);
  const maxBarTotal = useMemo(
    () => Math.max(1, ...barrasVendedores.map((r) => r.total)),
    [barrasVendedores]
  );
  const mostrarConsumido = vistaAdjudicado !== "pendiente";
  const mostrarPendiente = vistaAdjudicado !== "consumido";

  const tituloMontoAdjVista =
    vistaAdjudicado === "consumido"
      ? "Adj. Consumido"
      : vistaAdjudicado === "pendiente"
      ? "Adj. Por consumir"
      : "Adj. Operativo";

  const desdeMostrado = fechaDesde || "-";
  const hastaMostrado = fechaHasta || "-";

  return (
    <div className="page">

      {/* HEADER */}
      <div className="surface" style={{ marginBottom: "20px" }}>
        <div className="surface-body">
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-start", justifyContent: "space-between", gap: "20px" }}>
            <div>
              <div style={{ fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.15em", color: "var(--primary)", fontWeight: 600, marginBottom: "6px" }}>
                Ventas
              </div>
              <h1 className="page-title" style={{ marginBottom: "4px" }}>Resumen Comercial de Licitaciones</h1>
              <p style={{ fontSize: "13px", color: "var(--text-muted)", margin: 0 }}>
                Vista general y por vendedor con métricas de adjudicación, montos y desempeño.
              </p>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "12px", minWidth: "560px" }}>
              <div className="field">
                <label className="field-label">Fecha desde</label>
                <DateFilter
                  value={fechaDesde}
                  onChange={setFechaDesde}
                  placeholder="Desde"
                />
              </div>
              <div className="field">
                <label className="field-label">Fecha hasta</label>
                <DateFilter
                  value={fechaHasta}
                  onChange={setFechaHasta}
                  placeholder="Hasta"
                  minDate={fechaDesde ? new Date(`${fechaDesde}T00:00:00`) : null}
                />
              </div>
              <div className="field">
                <label className="field-label">Vendedor</label>
                <select
                  className="input"
                  value={filtroVendedor}
                  onChange={(e) => setFiltroVendedor(e.target.value)}
                  disabled={esVentas}
                >
                  <option value="">{esVentas ? "Mi resumen" : "Todos"}</option>
                  {opcionesVendedores.map((op) => (
                    <option key={op.value} value={op.value}>{op.label}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label className="field-label">Vista adjudicado</label>
                <select
                  className="input"
                  value={vistaAdjudicado}
                  onChange={(e) => setVistaAdjudicado(e.target.value)}
                >
                  {VISTAS_ADJUDICADO.map((op) => (
                    <option key={op.value} value={op.value}>{op.label}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <div style={{ marginTop: "12px" }}>
            <span style={{
              display: "inline-flex",
              alignItems: "center",
              borderRadius: "999px",
              border: "1px solid var(--border)",
              background: "var(--bg)",
              padding: "3px 12px",
              fontSize: "12px",
              color: "var(--text-muted)",
            }}>
              Periodo analizado: {desdeMostrado} a {hastaMostrado}
              {esVentas ? " (solo tus licitaciones)" : esJefatura ? " (equipo completo)" : ""}
            </span>
          </div>
        </div>
      </div>

      {errorMsg ? (
        <div style={{ marginBottom: "16px", borderRadius: "var(--radius)", border: "1px solid #fecaca", background: "#fef2f2", color: "#b91c1c", padding: "12px 16px", fontSize: "13px" }}>
          {errorMsg}
        </div>
      ) : null}

      {loading ? (
        <div className="surface">
          <div className="surface-body" style={{ color: "var(--text-muted)" }}>
            Cargando resumen de ventas…
          </div>
        </div>
      ) : (
        <>
          {/* KPI CARDS */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: "16px", marginBottom: "20px" }}>
            <KpiCard
              title="Licitaciones"
              value={resumenGeneral.total}
              subtitle={`${resumenGeneral.pendientes} pendientes / ${resumenGeneral.perdidas} perdidas`}
              color="#0891b2"
              icon={FileText}
            />
            <KpiCard
              title="Adjudicadas"
              value={resumenGeneral.adjudicadas}
              color="#16a34a"
              icon={Trophy}
            />
            <KpiCard
              title="Monto Total"
              value={fmtCLP(resumenGeneral.montoTotalNeto)}
              subtitle="Neto"
              minor={`Bruto: ${fmtCLP(resumenGeneral.montoTotal)}`}
              color="#475569"
              icon={TrendingUp}
            />
            <KpiCard
              title="Monto Adjudicado"
              value={fmtCLP(resumenGeneral.montoAdjudicadoNeto)}
              subtitle="Neto"
              minor={`Bruto: ${fmtCLP(resumenGeneral.montoAdjudicado)}`}
              color="#d97706"
              icon={CircleDollarSign}
            />
            <KpiCard
              title={tituloMontoAdjVista}
              value={fmtCLP(resumenGeneral.montoAdjudicadoVistaNeto)}
              subtitle={
                vistaAdjudicado === "consumido"
                  ? `Por consumir (neto): ${fmtCLP(resumenGeneral.montoAdjudicadoPendienteNeto)}`
                  : vistaAdjudicado === "pendiente"
                  ? `Consumido (neto): ${fmtCLP(resumenGeneral.montoAdjudicadoConsumidoNeto)}`
                  : `Consumido neto ${fmtCLP(resumenGeneral.montoAdjudicadoConsumidoNeto)} / Por consumir neto ${fmtCLP(resumenGeneral.montoAdjudicadoPendienteNeto)}`
              }
              minor={`Bruto: ${fmtCLP(resumenGeneral.montoAdjudicadoVistaBruto)}`}
              color="#0d9488"
              icon={Activity}
            />
          </div>

          {/* ESTADO + VENDEDOR BARRAS */}
          <div style={{ display: "grid", gridTemplateColumns: "1.05fr 1.45fr", gap: "20px", marginBottom: "20px" }}>

            {/* Resumen por Estado */}
            <div className="surface">
              <div className="surface-header">
                <div>
                  <h3 className="surface-title">Resumen General por Estado</h3>
                  <p style={{ fontSize: "12px", color: "var(--text-muted)", margin: 0 }}>
                    Distribución y monto acumulado de licitaciones en el periodo.
                  </p>
                </div>
              </div>
              <div className="table-wrap" style={{ boxShadow: "none", border: "none", borderRadius: 0 }}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Estado</th>
                      <th style={{ textAlign: "right" }}>Cantidad</th>
                      <th style={{ textAlign: "right" }}>% Total</th>
                      <th style={{ textAlign: "right" }}>Monto</th>
                    </tr>
                  </thead>
                  <tbody>
                    {resumenPorEstado.map((r) => (
                      <tr key={r.estado}>
                        <td><span className={badgeEstado(r.estado)}>{r.estado}</span></td>
                        <td style={{ textAlign: "right", fontWeight: 600 }}>{r.cantidad}</td>
                        <td style={{ textAlign: "right" }}>{fmtPct(r.porcentaje)}</td>
                        <td style={{ textAlign: "right" }}>{fmtCLP(r.monto)}</td>
                      </tr>
                    ))}
                    {resumenPorEstado.length === 0 && (
                      <tr>
                        <td colSpan="4" style={{ textAlign: "center", padding: "40px 0", color: "var(--text-muted)" }}>
                          No hay licitaciones en el rango seleccionado.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Desempeño por Vendedor */}
            <div className="surface">
              <div className="surface-header">
                <h3 className="surface-title">Desempeño por Vendedor</h3>
              </div>
              <div className="surface-body" style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                {barrasVendedores.length === 0 ? (
                  <div style={{ color: "var(--text-muted)", fontSize: "13px" }}>Sin datos para graficar.</div>
                ) : (
                  barrasVendedores.map((r) => {
                    const pctTotal = (r.total / maxBarTotal) * 100;
                    const pctAdj   = (r.adjudicadas / maxBarTotal) * 100;
                    return (
                      <div key={r.email} style={{ display: "grid", gridTemplateColumns: "180px 1fr 110px", gap: "16px", alignItems: "center" }}>
                        {/* Nombre */}
                        <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {r.nombre}
                        </div>

                        {/* Barra bullet: teal claro = total, verde = adjudicadas */}
                        <div style={{ position: "relative", height: "20px", borderRadius: "6px", background: "var(--bg)", border: "1px solid var(--border)", overflow: "hidden" }}>
                          {/* Total */}
                          <div style={{ position: "absolute", top: 0, left: 0, bottom: 0, width: `${pctTotal}%`, background: "var(--primary)", opacity: 0.22 }} />
                          {/* Adjudicadas */}
                          <div style={{ position: "absolute", top: 0, left: 0, bottom: 0, width: `${pctAdj}%`, background: "#16a34a", opacity: 0.75 }} />
                        </div>

                        {/* Stats */}
                        <div style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                          <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--text)" }}>
                            {r.total} <span style={{ fontWeight: 400, color: "var(--text-muted)", fontSize: "12px" }}>lics</span>
                          </div>
                          <div style={{ fontSize: "11px", color: "var(--text-muted)" }}>
                            {r.adjudicadas} adj · {fmtPct(r.tasaAdjudicacion)}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}

                {/* Leyenda */}
                <div style={{ display: "flex", gap: "16px", paddingTop: "4px", borderTop: "1px solid var(--border)", marginTop: "4px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "11px", color: "var(--text-muted)" }}>
                    <div style={{ width: "12px", height: "12px", borderRadius: "3px", background: "var(--primary)", opacity: 0.35 }} />
                    Total licitaciones
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "11px", color: "var(--text-muted)" }}>
                    <div style={{ width: "12px", height: "12px", borderRadius: "3px", background: "#16a34a", opacity: 0.75 }} />
                    Adjudicadas
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* TABLA RESUMEN POR VENDEDOR */}
          <div className="surface" style={{ marginBottom: "20px" }}>
            <div className="surface-header">
              <div>
                <h3 className="surface-title">Tabla Resumen por Vendedor</h3>
                <p style={{ fontSize: "12px", color: "var(--text-muted)", margin: 0 }}>
                  Ranking comercial con volumen, adjudicación y montos.
                </p>
              </div>
              <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>
                {resumenVendedores.length} vendedor(es)
              </span>
            </div>
            <div className="table-wrap" style={{ boxShadow: "none", border: "none", borderRadius: 0 }}>
              <div className="table-scroll">
                <table className="data-table" style={{ minWidth: "1100px" }}>
                  <thead>
                    <tr>
                      <th>Vendedor</th>
                      <th style={{ textAlign: "right" }}>Total</th>
                      <th style={{ textAlign: "right" }}>Adj.</th>
                      <th style={{ textAlign: "right" }}>Pend.</th>
                      <th style={{ textAlign: "right" }}>Perd.</th>
                      <th style={{ textAlign: "right" }}>Des.</th>
                      <th style={{ textAlign: "right" }}>Desc.</th>
                      <th style={{ textAlign: "right" }}>Monto Total</th>
                      <th style={{ textAlign: "right" }}>Adj. Total</th>
                      {mostrarConsumido && <th style={{ textAlign: "right" }}>Consumido</th>}
                      {mostrarPendiente && <th style={{ textAlign: "right" }}>Por consumir</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {resumenVendedores.map((r) => (
                      <tr key={r.email}>
                        <td>
                          <div style={{ fontWeight: 600, color: "var(--text)" }}>{r.nombre}</div>
                          <div style={{ fontSize: "12px", color: "var(--text-muted)" }}>
                            {r.email === "__sin_creador__" ? "-" : r.email}
                          </div>
                        </td>
                        <td style={{ textAlign: "right", fontWeight: 600 }}>{r.total}</td>
                        <td style={{ textAlign: "right", fontWeight: 600, color: "#15803d" }}>{r.adjudicadas}</td>
                        <td style={{ textAlign: "right" }}>{r.pendientes}</td>
                        <td style={{ textAlign: "right", color: "#b91c1c" }}>{r.perdidas}</td>
                        <td style={{ textAlign: "right" }}>{r.desiertas}</td>
                        <td style={{ textAlign: "right" }}>{r.descartadas}</td>
                        <td style={{ textAlign: "right" }}>{fmtCLP(r.montoTotal)}</td>
                        <td style={{ textAlign: "right", fontWeight: 600, color: "#15803d" }}>{fmtCLP(r.montoAdjudicado)}</td>
                        {mostrarConsumido && (
                          <td style={{ textAlign: "right", fontWeight: 600, color: "#1d4ed8" }}>{fmtCLP(r.montoAdjudicadoConsumido)}</td>
                        )}
                        {mostrarPendiente && (
                          <td style={{ textAlign: "right", fontWeight: 600, color: "#b45309" }}>{fmtCLP(r.montoAdjudicadoPendiente)}</td>
                        )}
                      </tr>
                    ))}
                    {resumenVendedores.length === 0 && (
                      <tr>
                        <td colSpan={9 + (mostrarConsumido ? 1 : 0) + (mostrarPendiente ? 1 : 0)}
                          style={{ textAlign: "center", padding: "40px 0", color: "var(--text-muted)" }}>
                          No hay datos para mostrar con los filtros actuales.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* TABLA RESUMEN POR REGIÓN */}
          <div className="surface">
            <div className="surface-header">
              <div>
                <h3 className="surface-title">Resumen por Región</h3>
                <p style={{ fontSize: "12px", color: "var(--text-muted)", margin: 0 }}>
                  Distribución territorial de licitaciones y montos en el periodo.
                </p>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                <input
                  type="text"
                  className="input"
                  style={{ width: "200px" }}
                  value={filtroRegionResumen}
                  onChange={(e) => setFiltroRegionResumen(e.target.value)}
                  placeholder="Filtrar región…"
                />
                <span style={{ fontSize: "12px", color: "var(--text-muted)", whiteSpace: "nowrap" }}>
                  {resumenRegionesFiltrado.length} región(es)
                </span>
              </div>
            </div>
            <div className="table-wrap" style={{ boxShadow: "none", border: "none", borderRadius: 0 }}>
              <div className="table-scroll" style={{ maxHeight: "420px" }}>
                <table className="data-table" style={{ minWidth: "1050px" }}>
                  <thead>
                    <tr>
                      <th>Región</th>
                      <th style={{ textAlign: "right" }}>Total</th>
                      <th style={{ textAlign: "right" }}>Adj.</th>
                      <th style={{ textAlign: "right" }}>Pend.</th>
                      <th style={{ textAlign: "right" }}>Perd.</th>
                      <th style={{ textAlign: "right" }}>Des.</th>
                      <th style={{ textAlign: "right" }}>Desc.</th>
                      <th style={{ textAlign: "right" }}>Monto Total</th>
                      <th style={{ textAlign: "right" }}>Adj. Total</th>
                      {mostrarConsumido && <th style={{ textAlign: "right" }}>Consumido</th>}
                      {mostrarPendiente && <th style={{ textAlign: "right" }}>Por consumir</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {resumenRegionesFiltrado.map((r) => (
                      <tr key={r.region}>
                        <td style={{ fontWeight: 600 }}>{r.region}</td>
                        <td style={{ textAlign: "right", fontWeight: 600 }}>{r.total}</td>
                        <td style={{ textAlign: "right", fontWeight: 600, color: "#15803d" }}>{r.adjudicadas}</td>
                        <td style={{ textAlign: "right" }}>{r.pendientes}</td>
                        <td style={{ textAlign: "right", color: "#b91c1c" }}>{r.perdidas}</td>
                        <td style={{ textAlign: "right" }}>{r.desiertas}</td>
                        <td style={{ textAlign: "right" }}>{r.descartadas}</td>
                        <td style={{ textAlign: "right" }}>{fmtCLP(r.montoTotal)}</td>
                        <td style={{ textAlign: "right", fontWeight: 600, color: "#15803d" }}>{fmtCLP(r.montoAdjudicado)}</td>
                        {mostrarConsumido && (
                          <td style={{ textAlign: "right", fontWeight: 600, color: "#1d4ed8" }}>{fmtCLP(r.montoAdjudicadoConsumido)}</td>
                        )}
                        {mostrarPendiente && (
                          <td style={{ textAlign: "right", fontWeight: 600, color: "#b45309" }}>{fmtCLP(r.montoAdjudicadoPendiente)}</td>
                        )}
                      </tr>
                    ))}
                    {resumenRegionesFiltrado.length === 0 && (
                      <tr>
                        <td colSpan={9 + (mostrarConsumido ? 1 : 0) + (mostrarPendiente ? 1 : 0)}
                          style={{ textAlign: "center", padding: "40px 0", color: "var(--text-muted)" }}>
                          No hay datos por región con los filtros actuales.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
