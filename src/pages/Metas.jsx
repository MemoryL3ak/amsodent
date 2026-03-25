import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import useAuth from "../hooks/useAuth";
import MonthCalendarPicker from "../components/MonthCalendarPicker";

const CANAL_LABELS = {
  vendedor_terreno: "Vendedor Terreno",
  vendedor_tienda_terreno: "Vendedor Tienda/Terreno",
  vendedor_terreno_mercado_publico: "Vendedor Terreno/Mercado Publico",
  vendedor_terreno_mercado: "Vendedor Terreno/Mercado",
  vendedor_mercado_publico: "Vendedor Mercado Publico",
  pagina_web: "Pagina Web",
  vendedor_tienda: "Vendedor Tienda",
  vendedor_freelance: "Vendedor Freelance",
};

function normalizeCanal(value) {
  const v = (value || "").toString().trim();
  if (v === "vendedor_terreno_mercado") return "vendedor_terreno_mercado_publico";
  return v;
}

function canalLabel(value) {
  return CANAL_LABELS[normalizeCanal(value)] || "";
}

function canalSplitConfig(value) {
  const canal = normalizeCanal(value);
  if (canal === "vendedor_tienda_terreno") {
    return {
      firstKey: "vendedor_tienda",
      secondKey: "vendedor_terreno",
      firstLabel: "Meta Tienda",
      secondLabel: "Meta Terreno",
    };
  }
  if (canal === "vendedor_terreno_mercado_publico") {
    return {
      firstKey: "vendedor_terreno",
      secondKey: "vendedor_mercado_publico",
      firstLabel: "Meta Terreno",
      secondLabel: "Meta Mercado",
    };
  }
  return null;
}

function hoyISO() {
  return new Date().toISOString().slice(0, 10);
}

function inicioMesISO() {
  const d = new Date();
  d.setDate(1);
  return d.toISOString().slice(0, 10);
}

function finMesISO(fechaMes) {
  const base = fechaMes ? new Date(`${fechaMes}T00:00:00`) : new Date();
  if (Number.isNaN(base.getTime())) return hoyISO();
  const y = base.getUTCFullYear();
  const m = base.getUTCMonth();
  const fin = new Date(Date.UTC(y, m + 1, 0));
  return fin.toISOString().slice(0, 10);
}

function toDateISO(value) {
  if (!value) return "";
  const s = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

function tituloMes(fechaMes) {
  const base = fechaMes ? new Date(`${fechaMes}T00:00:00`) : new Date();
  if (Number.isNaN(base.getTime())) return "Mes actual";
  return base.toLocaleDateString("es-CL", { month: "long", year: "numeric" });
}

function fmtCLP(value) {
  return `$${Number(value || 0).toLocaleString("es-CL")}`;
}

function fmtPct(value) {
  if (!Number.isFinite(Number(value))) return "0%";
  return `${Number(value).toFixed(1)}%`;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value || 0)));
}

function colorCumplimiento(pct) {
  if (pct >= 100) return "#15803d";
  if (pct >= 70)  return "#0d9488";
  if (pct >= 40)  return "#b45309";
  return "#dc2626";
}

function barColorCumplimiento(pct) {
  if (pct >= 100) return "#16a34a";
  if (pct >= 70)  return "var(--primary)";
  if (pct >= 40)  return "#d97706";
  return "#ef4444";
}

function montoBrutoDesdeNeto(value) {
  return Math.round(Number(value || 0) * 1.19);
}

function isMissingMontoColumnError(error) {
  const code = (error?.code || "").toString().toUpperCase();
  const msg = [error?.message, error?.details, error?.hint].filter(Boolean).join(" ").toLowerCase();
  return code === "42703" || code === "PGRST204" || (msg.includes("monto") && msg.includes("column"));
}

function isMissingFechaOcColumnError(error) {
  const code = (error?.code || "").toString().toUpperCase();
  const msg = [error?.message, error?.details, error?.hint].filter(Boolean).join(" ").toLowerCase();
  return code === "42703" || code === "PGRST204" || (msg.includes("fecha_oc") && msg.includes("column"));
}

function isMissingMetasTableError(error) {
  const code = (error?.code || "").toString().toUpperCase();
  const msg = [error?.message, error?.details, error?.hint].filter(Boolean).join(" ").toLowerCase();
  return code === "42P01" || msg.includes("vendedor_metas_mensuales");
}

function isMissingAsignacionCanalTableError(error) {
  const code = (error?.code || "").toString().toUpperCase();
  const msg = [error?.message, error?.details, error?.hint].filter(Boolean).join(" ").toLowerCase();
  return code === "42P01" || msg.includes("vendedor_metas_canal_mensuales");
}

function isMissingMetaDetalleTableError(error) {
  const code = (error?.code || "").toString().toUpperCase();
  const msg = [error?.message, error?.details, error?.hint].filter(Boolean).join(" ").toLowerCase();
  return code === "42P01" || msg.includes("vendedor_metas_canal_partes_mensuales");
}

function MetaGaugeCard({ title, value, subtitle, pct }) {
  const progreso = clamp(pct, 0, 100);
  return (
    <div style={{
      background: "var(--surface)",
      borderRadius: "var(--radius-lg)",
      border: "1px solid var(--border)",
      borderTop: "3px solid var(--primary)",
      padding: "18px 20px",
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: "16px",
    }}>
      <div>
        <div style={{ fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.12em", color: "var(--text-muted)", fontWeight: 600 }}>{title}</div>
        <div style={{ fontSize: "22px", fontWeight: 700, color: "var(--text)", lineHeight: 1.2, marginTop: "6px" }}>{value}</div>
        {subtitle ? <div style={{ fontSize: "12px", color: "var(--text-muted)", marginTop: "4px" }}>{subtitle}</div> : null}
      </div>
      <div style={{
        width: "64px", height: "64px", borderRadius: "50%", flexShrink: 0,
        display: "grid", placeItems: "center",
        background: `conic-gradient(var(--primary) ${progreso * 3.6}deg, rgba(40,174,177,0.12) ${progreso * 3.6}deg 360deg)`,
      }}>
        <div style={{
          width: "48px", height: "48px", borderRadius: "50%",
          background: "var(--surface)", display: "grid", placeItems: "center",
          fontSize: "10px", fontWeight: 700, color: "var(--text)",
        }}>
          {fmtPct(pct)}
        </div>
      </div>
    </div>
  );
}

export default function Metas() {
  const { user, rol, cargando } = useAuth();
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");
  const [metasErrorMsg, setMetasErrorMsg] = useState("");
  const [metasInfoMsg, setMetasInfoMsg] = useState("");
  const [guardandoMetas, setGuardandoMetas] = useState(false);
  const [licitaciones, setLicitaciones] = useState([]);
  const [ocs, setOcs] = useState([]);
  const [usuariosMap, setUsuariosMap] = useState({});
  const [metasMap, setMetasMap] = useState({});
  const [metasDraftMap, setMetasDraftMap] = useState({});
  const [metasSplitDraftMap, setMetasSplitDraftMap] = useState({});
  const [metasDetalleMap, setMetasDetalleMap] = useState({});
  const [canalPorVendedorMap, setCanalPorVendedorMap] = useState({});
  const [metaPeriodo, setMetaPeriodo] = useState(inicioMesISO());
  const [filtroVendedor, setFiltroVendedor] = useState("");

  const rolNorm = (rol || "").toString().trim().toLowerCase();
  const esAdmin = rolNorm === "admin" || rolNorm === "administrador";
  const esJefatura =
    rolNorm === "jefe_ventas" ||
    rolNorm === "jefe ventas" ||
    rolNorm === "jefe-ventas" ||
    rolNorm === "jefe de ventas";
  const esVentas = rolNorm === "ventas";
  const puedeVerTodo = esAdmin || esJefatura;
  const puedeVerMetas = esAdmin || esJefatura || esVentas;
  const puedeEditarMetas = esAdmin;

  useEffect(() => {
    if (!esVentas) return;
    const emailUser = (user?.email || "").trim().toLowerCase();
    setFiltroVendedor(emailUser);
  }, [esVentas, user?.email]);

  useEffect(() => {
    if (cargando) return;
    if (!puedeVerMetas) {
      setLoading(false);
      setErrorMsg("Acceso restringido: esta seccion es solo para administradores, jefatura o ventas.");
      return;
    }

    let mounted = true;

    async function cargarDatosBase() {
      setLoading(true);
      setErrorMsg("");
      try {
        const { data: lics, error: licsError } = await supabase
          .from("licitaciones")
          .select("id,creado_por")
          .order("id", { ascending: false });
        if (licsError) throw licsError;

        let rows = lics || [];
        const emailUser = (user?.email || "").trim().toLowerCase();
        if (esVentas && emailUser) {
          rows = rows.filter((l) => (l?.creado_por || "").trim().toLowerCase() === emailUser);
        }
        const ids = rows.map((l) => Number(l?.id)).filter((n) => Number.isFinite(n));

        let docsOcRows = [];
        if (ids.length > 0) {
          const { data: docsOc, error: errDocsOc } = await supabase
            .from("licitacion_documentos")
            .select("licitacion_id,monto,fecha_oc,created_at")
            .in("licitacion_id", ids)
            .eq("tipo", "orden_compra")
            .not("monto", "is", null);

          if (!errDocsOc) {
            docsOcRows = docsOc || [];
          } else if (isMissingFechaOcColumnError(errDocsOc)) {
            const { data: docsOcSinFecha, error: errDocsOcSinFecha } = await supabase
              .from("licitacion_documentos")
              .select("licitacion_id,monto,created_at")
              .in("licitacion_id", ids)
              .eq("tipo", "orden_compra")
              .not("monto", "is", null);

            if (!errDocsOcSinFecha) {
              docsOcRows = (docsOcSinFecha || []).map((d) => ({ ...d, fecha_oc: null }));
            } else if (isMissingMontoColumnError(errDocsOcSinFecha)) {
              docsOcRows = [];
            } else {
              throw errDocsOcSinFecha;
            }
          } else if (isMissingMontoColumnError(errDocsOc)) {
            docsOcRows = [];
          } else {
            throw errDocsOc;
          }
        }

        const { data: perfilesVendedores, error: errPerfiles } = await supabase
          .from("profiles")
          .select("email,nombre,rol")
          .in("rol", ["ventas", "jefe_ventas"]);

        if (errPerfiles) throw errPerfiles;

        const mapa = {};
        (perfilesVendedores || []).forEach((p) => {
          const email = (p?.email || "").trim().toLowerCase();
          if (email) mapa[email] = (p?.nombre || "").trim() || email;
        });

        if (!mounted) return;
        setLicitaciones(rows);
        setOcs(docsOcRows);
        setUsuariosMap(mapa);
      } catch (e) {
        console.error("Error cargando metas:", e);
        if (!mounted) return;
        setErrorMsg("No se pudo cargar la sección de metas.");
        setLicitaciones([]);
        setOcs([]);
        setUsuariosMap({});
      } finally {
        if (mounted) setLoading(false);
      }
    }

    cargarDatosBase();
    return () => {
      mounted = false;
    };
  }, [cargando, puedeVerMetas, esVentas, user?.email]);

  useEffect(() => {
    if (cargando || !puedeVerMetas) return;
    let mounted = true;

    async function cargarMetas() {
      setMetasErrorMsg("");
      setMetasInfoMsg("");
      const qMetas = supabase
        .from("vendedor_metas_mensuales")
        .select("vendedor_email,meta_neto")
        .eq("periodo", metaPeriodo);
      const qDetalle = supabase
        .from("vendedor_metas_canal_partes_mensuales")
        .select("vendedor_email,canal_base,meta_neto")
        .eq("periodo", metaPeriodo);
      const emailUser = (user?.email || "").trim().toLowerCase();
      if (esVentas && emailUser) {
        qMetas.eq("vendedor_email", emailUser);
        qDetalle.eq("vendedor_email", emailUser);
      }

      const [metasRes, detalleRes] = await Promise.all([qMetas, qDetalle]);

      if (!mounted) return;

      if (metasRes.error) {
        if (isMissingMetasTableError(metasRes.error)) {
          setMetasErrorMsg("Falta la tabla vendedor_metas_mensuales. Ejecuta las migraciones.");
        } else {
          setMetasErrorMsg("No se pudieron cargar las metas del periodo.");
        }
        setMetasMap({});
        setMetasDraftMap({});
        setMetasSplitDraftMap({});
        setMetasDetalleMap({});
        return;
      }

      const mapa = {};
      (metasRes.data || []).forEach((row) => {
        const email = (row?.vendedor_email || "").trim().toLowerCase();
        if (!email) return;
        mapa[email] = Number(row?.meta_neto || 0);
      });

      const detalleMapa = {};
      if (!detalleRes.error) {
        (detalleRes.data || []).forEach((row) => {
          const email = (row?.vendedor_email || "").trim().toLowerCase();
          const canalBase = normalizeCanal(row?.canal_base);
          if (!email || !canalBase) return;
          detalleMapa[email] = detalleMapa[email] || {};
          detalleMapa[email][canalBase] = Math.max(0, Number(row?.meta_neto || 0));
        });
      } else if (!isMissingMetaDetalleTableError(detalleRes.error)) {
        console.error("Error cargando detalle de metas por canal:", detalleRes.error);
      }

      setMetasMap(mapa);
      setMetasDraftMap(mapa);
      setMetasSplitDraftMap({});
      setMetasDetalleMap(detalleMapa);
    }

    cargarMetas();
    return () => {
      mounted = false;
    };
  }, [cargando, puedeVerMetas, esVentas, user?.email, metaPeriodo]);

  useEffect(() => {
    if (cargando || !puedeVerMetas) return;
    let mounted = true;

    async function cargarAsignacionesCanal() {
      const qAsig = supabase
        .from("vendedor_metas_canal_mensuales")
        .select("vendedor_email,canal")
        .eq("periodo", metaPeriodo);
      const emailUser = (user?.email || "").trim().toLowerCase();
      if (esVentas && emailUser) qAsig.eq("vendedor_email", emailUser);
      const { data, error } = await qAsig;

      if (!mounted) return;

      if (error) {
        if (!isMissingAsignacionCanalTableError(error)) {
          console.error("Error cargando asignaciones de canal:", error);
        }
        setCanalPorVendedorMap({});
        return;
      }

      const mapa = {};
      (data || []).forEach((row) => {
        const email = (row?.vendedor_email || "").trim().toLowerCase();
        if (!email) return;
        mapa[email] = normalizeCanal(row?.canal);
      });
      setCanalPorVendedorMap(mapa);
    }

    cargarAsignacionesCanal();
    return () => {
      mounted = false;
    };
  }, [cargando, puedeVerMetas, esVentas, user?.email, metaPeriodo]);

  const opcionesVendedores = useMemo(() => {
    const correos = new Set([
      ...Object.keys(usuariosMap),
      ...licitaciones.map((l) => (l.creado_por || "").trim().toLowerCase()).filter(Boolean),
      ...Object.keys(metasMap),
      ...Object.keys(metasDraftMap),
      ...Object.keys(canalPorVendedorMap),
    ]);
    return Array.from(correos)
      .filter(Boolean)
      .map((email) => ({ value: email, label: usuariosMap[email] || email }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [usuariosMap, licitaciones, metasMap, metasDraftMap, canalPorVendedorMap]);

  const avanceMetas = useMemo(() => {
    const finPeriodo = finMesISO(metaPeriodo);
    const licById = new Map();

    licitaciones.forEach((l) => {
      const id = Number(l?.id || 0);
      const email = (l?.creado_por || "").trim().toLowerCase();
      if (id && email) licById.set(id, email);
    });

    const consumidoPorVendedor = {};
    (ocs || []).forEach((doc) => {
      const licId = Number(doc?.licitacion_id || 0);
      const email = licById.get(licId);
      if (!email) return;
      if (filtroVendedor && email !== filtroVendedor) return;

      const fechaBase = toDateISO(doc?.fecha_oc) || toDateISO(doc?.created_at);
      if (!fechaBase) return;
      if (fechaBase < metaPeriodo || fechaBase > finPeriodo) return;

      consumidoPorVendedor[email] = Number(consumidoPorVendedor[email] || 0) + Number(doc?.monto || 0);
    });

    return opcionesVendedores
      .filter((v) => !filtroVendedor || v.value === filtroVendedor)
      .map((v) => {
        const metaNeto = Math.max(0, Number(metasDraftMap[v.value] ?? metasMap[v.value] ?? 0));
        const avanceNeto = Number(consumidoPorVendedor[v.value] || 0);
        const canal = normalizeCanal(canalPorVendedorMap[v.value] || "");
        return {
          email: v.value,
          nombre: v.label,
          canal,
          canalLabel: canalLabel(canal),
          metaNeto,
          avanceNeto,
          brechaNeto: Math.max(0, metaNeto - avanceNeto),
          pctCumplimiento: metaNeto > 0 ? (avanceNeto / metaNeto) * 100 : 0,
          avanceBruto: montoBrutoDesdeNeto(avanceNeto),
        };
      })
      .sort((a, b) => b.pctCumplimiento - a.pctCumplimiento || b.avanceNeto - a.avanceNeto);
  }, [metaPeriodo, licitaciones, ocs, opcionesVendedores, metasDraftMap, metasMap, filtroVendedor, canalPorVendedorMap]);

  const resumenMetas = useMemo(() => {
    const metaNetaTotal = avanceMetas.reduce((acc, x) => acc + Number(x.metaNeto || 0), 0);
    const avanceNetoTotal = avanceMetas.reduce((acc, x) => acc + Number(x.avanceNeto || 0), 0);
    return {
      metaNetaTotal,
      avanceNetoTotal,
      brechaNetaTotal: Math.max(0, metaNetaTotal - avanceNetoTotal),
      pctCumplimientoTotal: metaNetaTotal > 0 ? (avanceNetoTotal / metaNetaTotal) * 100 : 0,
    };
  }, [avanceMetas]);

  const topCumplidorMetas = useMemo(() => {
    if (!avanceMetas.length) return null;
    return [...avanceMetas].sort((a, b) => b.pctCumplimiento - a.pctCumplimiento)[0];
  }, [avanceMetas]);

  async function guardarMetas() {
    if (!puedeEditarMetas || guardandoMetas) return;
    setGuardandoMetas(true);
    setMetasErrorMsg("");
    setMetasInfoMsg("");

    try {
      const entries = Object.entries(metasDraftMap)
        .map(([email, meta]) => [String(email).trim().toLowerCase(), Math.max(0, Number(meta || 0))])
        .filter(([email]) => Boolean(email));

      const upserts = entries
        .filter(([, meta]) => meta > 0)
        .map(([email, meta]) => ({ vendedor_email: email, periodo: metaPeriodo, meta_neto: meta }));

      const deletions = entries.filter(([, meta]) => meta <= 0).map(([email]) => email);

      if (deletions.length > 0) {
        const { error: errDelete } = await supabase
          .from("vendedor_metas_mensuales")
          .delete()
          .eq("periodo", metaPeriodo)
          .in("vendedor_email", deletions);
        if (errDelete) throw errDelete;
      }

      if (upserts.length > 0) {
        const { error: errUpsert } = await supabase
          .from("vendedor_metas_mensuales")
          .upsert(upserts, { onConflict: "vendedor_email,periodo" });
        if (errUpsert) throw errUpsert;
      }

      const emailsAll = entries.map(([email]) => email).filter(Boolean);
      const detalleUpserts = [];

      entries.forEach(([email, meta]) => {
        const metaTotal = Math.max(0, Number(meta || 0));
        if (!email || metaTotal <= 0) return;

        const canalAsignado = normalizeCanal(canalPorVendedorMap[email] || "");
        const splitCfg = canalSplitConfig(canalAsignado);
        const splitDraft = metasSplitDraftMap[email];
        const splitSaved = metasDetalleMap[email] || {};

        if (splitCfg) {
          const first = splitDraft
            ? Math.max(0, Number(splitDraft[splitCfg.firstKey] ?? 0))
            : Math.max(0, Number(splitSaved[splitCfg.firstKey] ?? Math.floor(metaTotal / 2)));
          const second = splitDraft
            ? Math.max(0, Number(splitDraft[splitCfg.secondKey] ?? 0))
            : Math.max(0, Number(splitSaved[splitCfg.secondKey] ?? Math.max(0, metaTotal - first)));
          const fixedSecond = Math.max(0, metaTotal - first);
          detalleUpserts.push(
            { vendedor_email: email, periodo: metaPeriodo, canal_base: splitCfg.firstKey, meta_neto: first },
            { vendedor_email: email, periodo: metaPeriodo, canal_base: splitCfg.secondKey, meta_neto: splitDraft ? second : fixedSecond }
          );
          return;
        }

        const canalBase =
          canalAsignado === "vendedor_terreno" ||
          canalAsignado === "vendedor_mercado_publico" ||
          canalAsignado === "vendedor_tienda" ||
          canalAsignado === "pagina_web" ||
          canalAsignado === "vendedor_freelance"
            ? canalAsignado
            : "";

        if (canalBase) {
          detalleUpserts.push({
            vendedor_email: email,
            periodo: metaPeriodo,
            canal_base: canalBase,
            meta_neto: metaTotal,
          });
        }
      });

      if (emailsAll.length > 0) {
        const { error: errDeleteDetalle } = await supabase
          .from("vendedor_metas_canal_partes_mensuales")
          .delete()
          .eq("periodo", metaPeriodo)
          .in("vendedor_email", emailsAll);
        if (errDeleteDetalle && !isMissingMetaDetalleTableError(errDeleteDetalle)) throw errDeleteDetalle;
      }

      if (detalleUpserts.length > 0) {
        const { error: errUpsertDetalle } = await supabase
          .from("vendedor_metas_canal_partes_mensuales")
          .upsert(detalleUpserts, { onConflict: "vendedor_email,periodo,canal_base" });
        if (errUpsertDetalle && !isMissingMetaDetalleTableError(errUpsertDetalle)) throw errUpsertDetalle;
      }

      const nuevoMapa = {};
      upserts.forEach((row) => {
        const email = (row?.vendedor_email || "").trim().toLowerCase();
        if (email) nuevoMapa[email] = Number(row?.meta_neto || 0);
      });

      setMetasMap(nuevoMapa);
      setMetasDraftMap(nuevoMapa);
      const nuevoDetalle = {};
      detalleUpserts.forEach((row) => {
        const email = (row?.vendedor_email || "").trim().toLowerCase();
        const canal = normalizeCanal(row?.canal_base);
        if (!email || !canal) return;
        nuevoDetalle[email] = nuevoDetalle[email] || {};
        nuevoDetalle[email][canal] = Number(row?.meta_neto || 0);
      });
      setMetasDetalleMap(nuevoDetalle);
      setMetasInfoMsg("Metas guardadas correctamente.");
    } catch (e) {
      console.error("Error guardando metas:", e);
      setMetasErrorMsg("No se pudieron guardar las metas.");
    } finally {
      setGuardandoMetas(false);
    }
  }

  if (!cargando && !puedeVerMetas) {
    return (
      <div className="page">
        <div style={{ padding: "12px 16px", borderRadius: "var(--radius)", border: "1px solid #fecaca", background: "#fef2f2", color: "#b91c1c", fontSize: "13px" }}>
          Acceso restringido: esta sección es solo para administradores, jefatura o ventas.
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      {/* PAGE HEADER */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Metas Comerciales por Vendedor</h1>
          <p style={{ fontSize: "13px", color: "var(--text-muted)", margin: 0 }}>
            El avance se calcula por fecha de OC del periodo, no por fecha de creación de licitación.
          </p>
        </div>
      </div>

      {errorMsg     ? <div style={{ marginBottom: "16px", padding: "12px 16px", borderRadius: "var(--radius)", border: "1px solid #fecaca",  background: "#fef2f2", color: "#b91c1c",  fontSize: "13px" }}>{errorMsg}</div>     : null}
      {metasErrorMsg ? <div style={{ marginBottom: "16px", padding: "12px 16px", borderRadius: "var(--radius)", border: "1px solid #fde68a",  background: "#fffbeb", color: "#92400e",  fontSize: "13px" }}>{metasErrorMsg}</div> : null}
      {metasInfoMsg  ? <div style={{ marginBottom: "16px", padding: "12px 16px", borderRadius: "var(--radius)", border: "1px solid #bbf7d0",  background: "#f0fdf4", color: "#15803d",  fontSize: "13px" }}>{metasInfoMsg}</div>  : null}

      {loading ? (
        <div className="surface" style={{ padding: "40px 24px", color: "var(--text-muted)" }}>Cargando metas…</div>
      ) : (
        <div className="surface">
          {/* HEADER */}
          <div className="surface-header" style={{ flexWrap: "wrap", gap: "16px" }}>
            <div>
              <h3 className="surface-title">Control de Meta por Vendedor</h3>
              <p style={{ fontSize: "12px", color: "var(--text-muted)", margin: 0 }}>
                Cálculo por consumo real de OC usando fecha de OC.
              </p>
            </div>
            <div style={{ display: "flex", alignItems: "flex-end", gap: "12px", flexWrap: "wrap" }}>
              <div className="field" style={{ margin: 0 }}>
                <label className="field-label">Mes de evaluación</label>
                <MonthCalendarPicker value={metaPeriodo} onChange={setMetaPeriodo} />
              </div>
              <div className="field" style={{ margin: 0 }}>
                <label className="field-label">Vendedor</label>
                <select
                  className="input"
                  value={filtroVendedor}
                  onChange={(e) => setFiltroVendedor(e.target.value)}
                  disabled={esVentas}
                  style={{ minWidth: "160px" }}
                >
                  <option value="">Todos</option>
                  {opcionesVendedores.map((op) => (
                    <option key={op.value} value={op.value}>{op.label}</option>
                  ))}
                </select>
              </div>
              <button
                type="button"
                onClick={guardarMetas}
                disabled={guardandoMetas || !puedeEditarMetas}
                className="btn btn-primary"
                style={{ opacity: (guardandoMetas || !puedeEditarMetas) ? 0.6 : 1, cursor: (guardandoMetas || !puedeEditarMetas) ? "not-allowed" : "pointer" }}
              >
                {guardandoMetas ? "Guardando…" : puedeEditarMetas ? "Guardar metas" : "Solo lectura"}
              </button>
            </div>
          </div>

          {/* KPI CARDS */}
          <div className="surface-body" style={{ borderBottom: "1px solid var(--border)" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1.2fr repeat(3, 1fr)", gap: "16px" }}>
              <MetaGaugeCard
                title="Cumplimiento Global"
                value={fmtCLP(resumenMetas.avanceNetoTotal)}
                subtitle={`Meta ${fmtCLP(resumenMetas.metaNetaTotal)} | Brecha ${fmtCLP(resumenMetas.brechaNetaTotal)}`}
                pct={resumenMetas.pctCumplimientoTotal}
              />

              {/* Periodo */}
              <div style={{ background: "var(--surface)", borderRadius: "var(--radius-lg)", border: "1px solid var(--border)", borderTop: "3px solid var(--primary)", padding: "16px 18px" }}>
                <div style={{ fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.12em", color: "var(--text-muted)", fontWeight: 600 }}>Periodo</div>
                <div style={{ fontSize: "17px", fontWeight: 700, color: "var(--primary-dark)", marginTop: "8px", textTransform: "capitalize" }}>{tituloMes(metaPeriodo)}</div>
                <div style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "6px" }}>Corte: {metaPeriodo} a {finMesISO(metaPeriodo)}</div>
              </div>

              {/* Top Cumplimiento */}
              <div style={{ background: "var(--surface)", borderRadius: "var(--radius-lg)", border: "1px solid var(--border)", borderTop: "3px solid var(--primary)", padding: "16px 18px" }}>
                <div style={{ fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.12em", color: "var(--text-muted)", fontWeight: 600 }}>Top Cumplimiento</div>
                <div style={{ fontSize: "15px", fontWeight: 700, color: "var(--text)", marginTop: "8px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {topCumplidorMetas?.nombre || "Sin datos"}
                </div>
                <div style={{ marginTop: "6px" }}>
                  <span style={{
                    display: "inline-flex", alignItems: "center", padding: "2px 10px",
                    borderRadius: "999px", fontSize: "12px", fontWeight: 600, border: "1px solid",
                    color: colorCumplimiento(topCumplidorMetas?.pctCumplimiento || 0),
                    borderColor: `${colorCumplimiento(topCumplidorMetas?.pctCumplimiento || 0)}40`,
                    background: `${colorCumplimiento(topCumplidorMetas?.pctCumplimiento || 0)}12`,
                  }}>
                    {fmtPct(topCumplidorMetas?.pctCumplimiento || 0)}
                  </span>
                </div>
              </div>

              {/* Vendedores en Meta */}
              <div style={{ background: "var(--surface)", borderRadius: "var(--radius-lg)", border: "1px solid var(--border)", borderTop: "3px solid var(--primary)", padding: "16px 18px" }}>
                <div style={{ fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.12em", color: "var(--text-muted)", fontWeight: 600 }}>Vendedores en Meta</div>
                <div style={{ fontSize: "22px", fontWeight: 700, color: "var(--text)", marginTop: "6px", lineHeight: 1.2 }}>
                  <span style={{ color: "#15803d" }}>{avanceMetas.filter((r) => r.pctCumplimiento >= 100).length}</span>
                  <span style={{ fontSize: "15px", color: "var(--text-muted)", fontWeight: 500 }}> / {avanceMetas.length}</span>
                </div>
                <div style={{ marginTop: "10px", height: "6px", borderRadius: "3px", background: "rgba(40,174,177,0.12)", overflow: "hidden" }}>
                  <div style={{
                    height: "100%", borderRadius: "3px", background: "#16a34a",
                    width: `${clamp(avanceMetas.length ? (avanceMetas.filter((r) => r.pctCumplimiento >= 100).length / avanceMetas.length) * 100 : 0, 0, 100)}%`,
                  }} />
                </div>
              </div>
            </div>
          </div>

          {/* TABLE */}
          <div className="table-wrap" style={{ boxShadow: "none", border: "none", borderRadius: 0 }}>
            <div className="table-scroll">
              <table className="data-table" style={{ minWidth: "980px" }}>
                <thead>
                  <tr>
                    <th>Vendedor</th>
                    <th style={{ textAlign: "right" }}>Meta Neta</th>
                    <th style={{ textAlign: "right" }}>Avance OC Neto</th>
                    <th style={{ textAlign: "right" }}>Avance OC Bruto</th>
                    <th>Progreso</th>
                    <th style={{ textAlign: "right" }}>Cumplimiento</th>
                    <th style={{ textAlign: "right" }}>Brecha</th>
                  </tr>
                </thead>
                <tbody>
                  {avanceMetas.map((r) => {
                    const pct = Number(r.pctCumplimiento || 0);
                    const splitCfg = canalSplitConfig(r.canal);
                    const totalMetaDraft = Math.max(0, Number(metasDraftMap[r.email] ?? 0));
                    const splitDraft = metasSplitDraftMap[r.email];
                    const splitSaved = metasDetalleMap[r.email] || {};
                    const splitFirst = splitDraft
                      ? Math.max(0, Number(splitDraft[splitCfg?.firstKey] ?? 0))
                      : Math.max(0, Number(splitSaved[splitCfg?.firstKey] ?? (splitCfg ? Math.floor(totalMetaDraft / 2) : 0)));
                    const splitSecond = splitDraft
                      ? Math.max(0, Number(splitDraft[splitCfg?.secondKey] ?? 0))
                      : Math.max(0, Number(splitSaved[splitCfg?.secondKey] ?? (splitCfg ? Math.max(0, totalMetaDraft - Math.floor(totalMetaDraft / 2)) : 0)));
                    return (
                      <tr key={r.email}>
                        <td>
                          <div style={{ fontWeight: 600, fontSize: "13px", color: "var(--text)" }}>{r.nombre}</div>
                          <div style={{ fontSize: "11px", color: "var(--text-muted)" }}>{r.email}</div>
                          <div style={{ fontSize: "11px", color: "var(--primary-dark)", marginTop: "2px" }}>
                            Canal: {r.canalLabel || "Sin canal asignado"}
                          </div>
                        </td>
                        <td style={{ textAlign: "right" }}>
                          {splitCfg ? (
                            <div style={{ display: "flex", flexDirection: "column", gap: "8px", alignItems: "flex-end", width: "224px", marginLeft: "auto" }}>
                              <div style={{ width: "100%" }}>
                                <div style={{ fontSize: "10px", color: "var(--text-muted)", marginBottom: "4px" }}>{splitCfg.firstLabel}</div>
                                <input
                                  type="number" min="0" step="1" value={splitFirst}
                                  disabled={!puedeEditarMetas}
                                  onChange={(e) => {
                                    const nextFirst = Math.max(0, Number(e.target.value || 0));
                                    const nextSecond = splitSecond;
                                    setMetasSplitDraftMap((prev) => ({ ...prev, [r.email]: { [splitCfg.firstKey]: nextFirst, [splitCfg.secondKey]: nextSecond } }));
                                    setMetasDraftMap((prev) => ({ ...prev, [r.email]: nextFirst + nextSecond }));
                                  }}
                                  className="input" style={{ textAlign: "right", width: "100%" }}
                                />
                              </div>
                              <div style={{ width: "100%" }}>
                                <div style={{ fontSize: "10px", color: "var(--text-muted)", marginBottom: "4px" }}>{splitCfg.secondLabel}</div>
                                <input
                                  type="number" min="0" step="1" value={splitSecond}
                                  disabled={!puedeEditarMetas}
                                  onChange={(e) => {
                                    const nextSecond = Math.max(0, Number(e.target.value || 0));
                                    const nextFirst = splitFirst;
                                    setMetasSplitDraftMap((prev) => ({ ...prev, [r.email]: { [splitCfg.firstKey]: nextFirst, [splitCfg.secondKey]: nextSecond } }));
                                    setMetasDraftMap((prev) => ({ ...prev, [r.email]: nextFirst + nextSecond }));
                                  }}
                                  className="input" style={{ textAlign: "right", width: "100%" }}
                                />
                              </div>
                              <div style={{ fontSize: "11px", color: "var(--text-muted)" }}>Total: {fmtCLP(splitFirst + splitSecond)}</div>
                            </div>
                          ) : (
                            <input
                              type="number" min="0" step="1"
                              value={Number(metasDraftMap[r.email] ?? 0)}
                              disabled={!puedeEditarMetas}
                              onChange={(e) => {
                                const v = Math.max(0, Number(e.target.value || 0));
                                setMetasSplitDraftMap((prev) => { if (!prev[r.email]) return prev; const next = { ...prev }; delete next[r.email]; return next; });
                                setMetasDraftMap((prev) => ({ ...prev, [r.email]: v }));
                              }}
                              className="input" style={{ textAlign: "right", width: "176px" }}
                            />
                          )}
                        </td>
                        <td style={{ textAlign: "right", fontWeight: 600, color: "#15803d" }}>{fmtCLP(r.avanceNeto)}</td>
                        <td style={{ textAlign: "right", fontWeight: 600, color: "var(--primary-dark)" }}>{fmtCLP(r.avanceBruto)}</td>
                        <td style={{ minWidth: "200px" }}>
                          <div style={{ height: "8px", borderRadius: "4px", background: "var(--bg)", border: "1px solid var(--border)", overflow: "hidden" }}>
                            <div style={{ height: "100%", borderRadius: "4px", background: barColorCumplimiento(pct), width: `${clamp(pct, 0, 100)}%` }} />
                          </div>
                          <div style={{ marginTop: "4px", fontSize: "11px", color: "var(--text-muted)" }}>
                            {fmtCLP(r.avanceNeto)} de {fmtCLP(r.metaNeto)}
                          </div>
                        </td>
                        <td style={{ textAlign: "right" }}>
                          <span style={{
                            display: "inline-flex", alignItems: "center", padding: "2px 10px",
                            borderRadius: "999px", fontSize: "12px", fontWeight: 600, border: "1px solid",
                            color: colorCumplimiento(pct),
                            borderColor: `${colorCumplimiento(pct)}40`,
                            background: `${colorCumplimiento(pct)}12`,
                          }}>
                            {fmtPct(pct)}
                          </span>
                        </td>
                        <td style={{ textAlign: "right", fontWeight: 600, color: "#b45309" }}>{fmtCLP(r.brechaNeto)}</td>
                      </tr>
                    );
                  })}
                  {avanceMetas.length === 0 && (
                    <tr>
                      <td colSpan="7" style={{ textAlign: "center", padding: "40px 0", color: "var(--text-muted)" }}>
                        No hay vendedores o metas para el filtro/periodo seleccionado.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* FOOTER */}
          <div style={{ display: "flex", justifyContent: "flex-end", padding: "16px 24px", borderTop: "1px solid var(--border)" }}>
            <button
              type="button"
              onClick={guardarMetas}
              disabled={guardandoMetas || !puedeEditarMetas}
              className="btn btn-primary"
              style={{ opacity: (guardandoMetas || !puedeEditarMetas) ? 0.6 : 1, cursor: (guardandoMetas || !puedeEditarMetas) ? "not-allowed" : "pointer" }}
            >
              {guardandoMetas ? "Guardando…" : puedeEditarMetas ? "Guardar metas" : "Solo lectura"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}


