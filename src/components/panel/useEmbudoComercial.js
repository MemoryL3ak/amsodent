// useEmbudoComercial.js
// Lógica compartida del embudo comercial (clientes particulares según su
// actividad en la bitácora). La usan el Panel de Indicadores y el sub-panel
// "Cliente Particular" para no duplicar reglas.
//
// Qué acción marca cada etapa:
//   • Prospecto            → actividad con motivo Mapeo / Visita Espontánea / Referido
//   • Cliente Contactado   → actividad de tipo Llamada / WhatsApp / Visita / Reunión / Correo
//   • Clientes que Cotizan → actividad con motivo "Presupuesto"
//   • Clientes que Compran → la cotización asociada a esa actividad "Presupuesto"
//                            pasa a estado "Adjudicada"
//
// (2026-10-23) El embudo es DEL MES: cada etapa cuenta los clientes distintos
// que registraron la acción de esa etapa dentro del mes seleccionado (para
// "Compran", la adjudicación del mes). Antes era acumulado desde el inicio y
// cada etapa exigía haber logrado la anterior: el mes casi no cambiaba nada,
// el detalle mostraba acciones de otros meses y, como casi nadie registra el
// motivo de prospecto, meses con decenas de contactos quedaban en cero. La
// conversión entre etapas se mide sobre los mismos clientes del mes (de los
// contactados en el mes, cuántos cotizaron en el mes, etc.).
import { useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api";
import useAuth from "../../hooks/useAuth";
import { esVendedorSiempreVisible } from "../../constants/vendedores";
import { mesDe, toDateISO, addMesKey, labelMesCorto } from "./panelKit";

export const MOTIVOS_PROSPECTO = ["Mapeo", "Visita Espontánea", "Referido"];
export const TIPOS_CONTACTO = ["llamada", "whatsapp", "visita", "reunion", "correo"];
export const MOTIVO_COTIZA = "Presupuesto";

// Quiénes son "ejecutivos" para el filtro: el equipo comercial según su rol
// (misma regla que el Avance de Metas del Panel de Indicadores), más las
// excepciones por correo (Diego Cruz, admin que vende). Antes el filtro
// listaba TODOS los correos de la bitácora: entradas automáticas, correos de
// participantes externos, administradores y una persona dos veces (correo
// principal y alterno).
const ROLES_VENTA = new Set(["ventas", "ventas_especial", "jefe_ventas", "jefe_ventas_especial"]);
function esEquipoComercial(rol, email) {
  if (esVendedorSiempreVisible(email)) return true;
  return ROLES_VENTA.has(String(rol || "").trim().toLowerCase());
}

export const ETAPAS_EMBUDO = [
  { key: "prospectos",  label: "Prospectos",           color: "#1e40af" },
  { key: "contactados", label: "Clientes Contactados", color: "#0d9488" },
  { key: "cotizan",     label: "Clientes que Cotizan", color: "#16a34a" },
  { key: "compran",     label: "Clientes que Compran", color: "#f59e0b" },
];

export function finDeMes(mesKey) {
  const [y, m] = mesKey.split("-").map(Number);
  const d = new Date(y, m, 0); // día 0 del mes siguiente = último del actual
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const normEmail = (e) => String(e || "").trim().toLowerCase();
const conteo = (d) => ({ prospectos: d.prospectos.length, contactados: d.contactados.length, cotizan: d.cotizan.length, compran: d.compran.length });

// mesActualKey: 'YYYY-MM'. Devuelve el embudo del mes (y el del anterior, la
// evolución de 6 meses y el detalle por etapa).
// ejecutivo: correo principal del ejecutivo para filtrar la bitácora; "" = todos.
export default function useEmbudoComercial(mesActualKey, ejecutivo = "") {
  const { rol, cargando } = useAuth();
  const rolNorm = (rol || "").toString().trim().toLowerCase();
  const esAdmin = rolNorm === "admin" || rolNorm === "administrador";
  const esJefatura = ["jefe_ventas", "jefe ventas", "jefe-ventas", "jefe de ventas", "jefe_ventas_especial"].includes(rolNorm);
  const puedeVer = esAdmin || esJefatura;

  const [loading, setLoading] = useState(true);
  const [actividades, setActividades] = useState([]);
  const [lics, setLics] = useState([]);
  const [clientes, setClientes] = useState([]);
  const [perfiles, setPerfiles] = useState([]);

  const mesActual = mesActualKey;
  const mesPrev = addMesKey(mesActual, -1);
  const hastaCorte = finDeMes(mesActual);

  useEffect(() => {
    if (cargando || !puedeVer) { if (!cargando) setLoading(false); return; }
    let activo = true;
    (async () => {
      setLoading(true);
      try {
        const [acts, licis, cli, perfs] = await Promise.all([
          api.get(`/actividades?desde=2000-01-01&hasta=${hastaCorte}`),
          api.get("/licitaciones/with-fields?fields=id,estado,fecha,fecha_adjudicada"),
          api.get("/clientes"),
          api.get("/usuarios/profiles").catch(() => []),
        ]);
        if (!activo) return;
        setActividades(Array.isArray(acts) ? acts : []);
        setLics(Array.isArray(licis) ? licis : []);
        setClientes(Array.isArray(cli) ? cli : []);
        setPerfiles(Array.isArray(perfs) ? perfs : []);
      } catch (e) {
        console.error("Error cargando embudo:", e);
        if (activo) { setActividades([]); setLics([]); setClientes([]); setPerfiles([]); }
      } finally {
        if (activo) setLoading(false);
      }
    })();
    return () => { activo = false; };
  }, [cargando, puedeVer, hastaCorte]);

  // Nombres por correo (principal y alterno) de todos los perfiles, para la
  // columna "Ejecutivo" del detalle. Lo que no sea un perfil (entradas
  // automáticas, externos) se muestra tal cual.
  const nombresEjecutivos = useMemo(() => {
    const m = {};
    perfiles.forEach((p) => {
      const nombre = String(p?.nombre || "").trim();
      if (!nombre) return;
      [p.email, p.email_alterno].map(normEmail).filter(Boolean).forEach((e) => { m[e] = nombre; });
    });
    return m;
  }, [perfiles]);

  // Solo clientes particulares.
  const particularIds = useMemo(() => {
    const s = new Set();
    clientes.forEach((c) => {
      if ((c?.tipo_cliente || "").toLowerCase().includes("particular")) s.add(String(c.id));
    });
    return s;
  }, [clientes]);

  // Equipo comercial: una opción por PERSONA (correo principal + alterno),
  // solo con quienes tienen alguna actividad sobre un cliente particular.
  const equipo = useMemo(() => {
    const conActividad = new Set();
    actividades.forEach((a) => {
      const cid = a.cliente_id != null ? String(a.cliente_id) : "";
      if (cid && particularIds.has(cid)) conActividad.add(normEmail(a.user_email));
    });
    const personas = [];
    perfiles.forEach((p) => {
      const principal = normEmail(p?.email);
      if (!principal || !esEquipoComercial(p?.rol, principal)) return;
      const emails = Array.from(new Set([principal, normEmail(p?.email_alterno)].filter(Boolean)));
      if (!emails.some((e) => conActividad.has(e))) return;
      personas.push({ value: principal, label: String(p?.nombre || "").trim() || principal, emails });
    });
    return personas.sort((a, b) => a.label.localeCompare(b.label));
  }, [perfiles, actividades, particularIds]);

  const opcionesEjecutivos = useMemo(
    () => equipo.map(({ value, label }) => ({ value, label })),
    [equipo]
  );

  // Filtro por ejecutivo: solo su actividad de bitácora (por cualquiera de
  // sus correos) marca las etapas.
  const actividadesFiltradas = useMemo(() => {
    const e = normEmail(ejecutivo);
    if (!e) return actividades;
    const persona = equipo.find((p) => p.value === e);
    const correos = new Set(persona ? persona.emails : [e]);
    return actividades.filter((a) => correos.has(normEmail(a.user_email)));
  }, [actividades, ejecutivo, equipo]);

  const licById = useMemo(() => {
    const m = new Map();
    lics.forEach((l) => {
      const adjudicada = l.estado === "Adjudicada";
      const adjDate = toDateISO(l.fecha_adjudicada) || (adjudicada ? toDateISO(l.fecha) : "");
      m.set(String(l.id), { adjudicada, adjDate });
    });
    return m;
  }, [lics]);

  // Acciones de cada etapa por cliente particular, ordenadas por fecha, con la
  // actividad de bitácora que la registró (para el detalle cliqueable).
  // "Compran" usa la fecha de adjudicación de la cotización vinculada a la
  // actividad "Presupuesto".
  const accionesPorCliente = useMemo(() => {
    const base = new Map(); // cid -> { pros: [], cont: [], cot: [], comp: [] }
    actividadesFiltradas.forEach((a) => {
      const cid = a.cliente_id != null ? String(a.cliente_id) : "";
      if (!cid || !particularIds.has(cid)) return;
      const f = toDateISO(a.fecha);
      if (!f) return;
      let e = base.get(cid);
      if (!e) { e = { pros: [], cont: [], cot: [], comp: [] }; base.set(cid, e); }
      if (MOTIVOS_PROSPECTO.includes(a.motivo)) e.pros.push({ fecha: f, act: a });
      if (TIPOS_CONTACTO.includes(a.tipo)) e.cont.push({ fecha: f, act: a });
      if (a.motivo === MOTIVO_COTIZA) {
        e.cot.push({ fecha: f, act: a });
        const lic = a.licitacion_id != null ? licById.get(String(a.licitacion_id)) : null;
        if (lic && lic.adjudicada && lic.adjDate) e.comp.push({ fecha: lic.adjDate, act: a, licId: a.licitacion_id });
      }
    });
    const porFecha = (x, y) => x.fecha.localeCompare(y.fecha);
    base.forEach((e) => { e.pros.sort(porFecha); e.cont.sort(porFecha); e.cot.sort(porFecha); e.comp.sort(porFecha); });
    return base;
  }, [actividadesFiltradas, licById, particularIds]);

  const clientesById = useMemo(() => {
    const m = new Map();
    clientes.forEach((c) => m.set(String(c.id), c));
    return m;
  }, [clientes]);

  // Embudo de un mes: por etapa, los clientes distintos que registraron la
  // acción de esa etapa dentro del mes (se guarda la primera del mes para el
  // detalle). Devuelve el detalle (cliente + actividad).
  const etapasDelMes = useMemo(() => (mesKey) => {
    const out = { prospectos: [], contactados: [], cotizan: [], compran: [] };
    const primeraDelMes = (arr) => arr.find((x) => mesDe(x.fecha) === mesKey);
    const item = (cid, x, extra) => ({
      clienteId: cid,
      cliente: clientesById.get(cid)?.nombre || `Cliente ${cid}`,
      fecha: x.fecha,
      tipo: x.act?.tipo || "",
      motivo: x.act?.motivo || "",
      ejecutivo: normEmail(x.act?.user_email),
      ...extra,
    });
    accionesPorCliente.forEach((e, cid) => {
      const p = primeraDelMes(e.pros);
      if (p) out.prospectos.push(item(cid, p));
      const c = primeraDelMes(e.cont);
      if (c) out.contactados.push(item(cid, c));
      const z = primeraDelMes(e.cot);
      if (z) out.cotizan.push(item(cid, z));
      const m = primeraDelMes(e.comp);
      if (m) out.compran.push(item(cid, m, { licitacionId: m.licId }));
    });
    Object.values(out).forEach((arr) => arr.sort((a, b) => String(b.fecha).localeCompare(String(a.fecha))));
    return out;
  }, [accionesPorCliente, clientesById]);

  const detalleEmbudo = useMemo(() => etapasDelMes(mesActual), [etapasDelMes, mesActual]);
  const emb = useMemo(() => conteo(detalleEmbudo), [detalleEmbudo]);
  const embPrev = useMemo(() => conteo(etapasDelMes(mesPrev)), [etapasDelMes, mesPrev]);

  // Evolución: embudo de cada uno de los últimos 6 meses (el del mes
  // seleccionado coincide con el embudo principal).
  const evolucion = useMemo(() => {
    const arr = [];
    for (let i = 5; i >= 0; i--) {
      const k = addMesKey(mesActual, -i);
      arr.push({ mes: k, label: labelMesCorto(k), ...conteo(etapasDelMes(k)) });
    }
    return arr;
  }, [mesActual, etapasDelMes]);

  // Conversión entre etapas sobre los clientes del mes: de los que están en
  // una etapa este mes, cuántos aparecen también en la siguiente este mes.
  // Sin base (0 en la etapa de origen) queda en null y la vista muestra "—".
  const conv = useMemo(() => {
    const ids = (arr) => new Set(arr.map((it) => it.clienteId));
    const P = ids(detalleEmbudo.prospectos), C = ids(detalleEmbudo.contactados);
    const Z = ids(detalleEmbudo.cotizan), M = ids(detalleEmbudo.compran);
    const tasa = (origen, destino) => {
      if (!origen.size) return null;
      let n = 0;
      origen.forEach((id) => { if (destino.has(id)) n++; });
      return (n / origen.size) * 100;
    };
    return { e1: tasa(P, C), e2: tasa(C, Z), e3: tasa(Z, M), total: tasa(P, M) };
  }, [detalleEmbudo]);

  const maxEmbudo = Math.max(1, emb.prospectos, emb.contactados, emb.cotizan, emb.compran);

  return { loading: loading && puedeVer, puedeVer, emb, embPrev, evolucion, conv, maxEmbudo, opcionesEjecutivos, detalleEmbudo, nombresEjecutivos };
}
