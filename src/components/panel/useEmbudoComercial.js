// useEmbudoComercial.js
// Lógica compartida del embudo comercial (marcas acumuladas por cliente
// particular según su actividad en la bitácora). La usan el Panel de
// Indicadores y el sub-panel "Cliente Particular" para no duplicar reglas.
//
// Reglas de marcado (se suman, nunca se quitan):
//   • Prospecto            → actividad con motivo Mapeo / Visita Espontánea / Referido
//   • Cliente Contactado   → actividad de tipo Llamada / Visita / Reunión / Correo
//   • Clientes que Cotizan → actividad con motivo "Presupuesto"
//   • Clientes que Compran → la cotización asociada a esa actividad "Presupuesto"
//                            pasa a estado "Adjudicada"
import { useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api";
import useAuth from "../../hooks/useAuth";
import { mesDe, toDateISO, addMesKey, labelMesCorto } from "./panelKit";

export const MOTIVOS_PROSPECTO = ["Mapeo", "Visita Espontánea", "Referido"];
export const TIPOS_CONTACTO = ["llamada", "whatsapp", "visita", "reunion", "correo"];
export const MOTIVO_COTIZA = "Presupuesto";

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

// mesActualKey: 'YYYY-MM'. Devuelve el embudo acumulado hasta el fin de ese mes.
// ejecutivo: email (lowercase) del ejecutivo para filtrar la bitácora; "" = todos.
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
  const [nombresEjecutivos, setNombresEjecutivos] = useState({});

  const mesActual = mesActualKey;
  const mesPrev = addMesKey(mesActual, -1);
  const hastaCorte = finDeMes(mesActual);

  useEffect(() => {
    if (cargando || !puedeVer) { if (!cargando) setLoading(false); return; }
    let activo = true;
    (async () => {
      setLoading(true);
      try {
        const [acts, licis, cli] = await Promise.all([
          api.get(`/actividades?desde=2000-01-01&hasta=${hastaCorte}`),
          api.get("/licitaciones/with-fields?fields=id,estado,fecha,fecha_adjudicada"),
          api.get("/clientes"),
        ]);
        if (!activo) return;
        setActividades(Array.isArray(acts) ? acts : []);
        setLics(Array.isArray(licis) ? licis : []);
        setClientes(Array.isArray(cli) ? cli : []);
      } catch (e) {
        console.error("Error cargando embudo:", e);
        if (activo) { setActividades([]); setLics([]); setClientes([]); }
      } finally {
        if (activo) setLoading(false);
      }
    })();
    return () => { activo = false; };
  }, [cargando, puedeVer, hastaCorte]);

  // Nombres de los ejecutivos presentes en la bitácora (para el filtro).
  useEffect(() => {
    const emails = Array.from(new Set(
      actividades.map((a) => (a.user_email || "").trim().toLowerCase()).filter(Boolean)
    ));
    if (!emails.length) { setNombresEjecutivos({}); return; }
    let activo = true;
    api.post("/usuarios/profiles/by-emails", { emails })
      .then((perfiles) => {
        if (!activo) return;
        const m = {};
        (perfiles || []).forEach((p) => {
          m[(p.email || "").trim().toLowerCase()] = (p.nombre || "").trim();
        });
        setNombresEjecutivos(m);
      })
      .catch(() => {});
    return () => { activo = false; };
  }, [actividades]);

  const opcionesEjecutivos = useMemo(
    () =>
      Array.from(new Set(
        actividades.map((a) => (a.user_email || "").trim().toLowerCase()).filter(Boolean)
      ))
        .map((email) => ({ value: email, label: nombresEjecutivos[email] || email }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [actividades, nombresEjecutivos]
  );

  // Filtro por ejecutivo: solo su actividad de bitácora marca las etapas.
  const actividadesFiltradas = useMemo(() => {
    const e = (ejecutivo || "").trim().toLowerCase();
    if (!e) return actividades;
    return actividades.filter((a) => (a.user_email || "").trim().toLowerCase() === e);
  }, [actividades, ejecutivo]);

  // Solo clientes particulares.
  const particularIds = useMemo(() => {
    const s = new Set();
    clientes.forEach((c) => {
      if ((c?.tipo_cliente || "").toLowerCase().includes("particular")) s.add(String(c.id));
    });
    return s;
  }, [clientes]);

  const licById = useMemo(() => {
    const m = new Map();
    lics.forEach((l) => {
      const adjudicada = l.estado === "Adjudicada";
      const adjDate = toDateISO(l.fecha_adjudicada) || (adjudicada ? toDateISO(l.fecha) : "");
      m.set(String(l.id), { adjudicada, adjDate });
    });
    return m;
  }, [lics]);

  // Fecha de LOGRO de cada marca por cliente, respetando el orden secuencial:
  // para pasar a una etapa el cliente ya debe tener la marca anterior. La
  // fecha de logro de una etapa = la más tardía entre "tener la etapa previa"
  // y "registrar la acción propia de esta etapa".
  const logrosPorCliente = useMemo(() => {
    const maxDate = (a, b) => (!a || !b ? null : (a > b ? a : b));
    // 1) Primera fecha de cada acción por cliente particular. Se guarda
    //    también LA ACTIVIDAD que marcó cada etapa, para el detalle cliqueable
    //    del embudo.
    const base = new Map(); // cid -> { pDate, cDate, zDate, mDate, pAct, cAct, zAct, mAct, mLicId }
    const ensure = (cid) => {
      let e = base.get(cid);
      if (!e) {
        e = { pDate: null, cDate: null, zDate: null, mDate: null, pAct: null, cAct: null, zAct: null, mAct: null, mLicId: null };
        base.set(cid, e);
      }
      return e;
    };
    const marcar = (e, dateKey, actKey, f, a) => {
      if (!e[dateKey] || f < e[dateKey]) { e[dateKey] = f; e[actKey] = a; }
    };
    actividadesFiltradas.forEach((a) => {
      const cid = a.cliente_id != null ? String(a.cliente_id) : "";
      if (!cid || !particularIds.has(cid)) return;
      const f = toDateISO(a.fecha);
      if (!f) return;
      const e = ensure(cid);
      if (MOTIVOS_PROSPECTO.includes(a.motivo)) marcar(e, "pDate", "pAct", f, a);
      if (TIPOS_CONTACTO.includes(a.tipo)) marcar(e, "cDate", "cAct", f, a);
      if (a.motivo === MOTIVO_COTIZA) marcar(e, "zDate", "zAct", f, a);
    });
    // Compran: la cotización vinculada a una actividad "Presupuesto" adjudicada.
    actividadesFiltradas.forEach((a) => {
      if (a.motivo !== MOTIVO_COTIZA || a.cliente_id == null) return;
      const cid = String(a.cliente_id);
      if (!particularIds.has(cid)) return;
      const lic = a.licitacion_id != null ? licById.get(String(a.licitacion_id)) : null;
      if (lic && lic.adjudicada && lic.adjDate) {
        const e = ensure(cid);
        if (!e.mDate || lic.adjDate < e.mDate) { e.mDate = lic.adjDate; e.mAct = a; e.mLicId = a.licitacion_id; }
      }
    });
    // 2) Fechas de logro encadenadas (cada etapa exige la anterior).
    const arr = [];
    base.forEach((e, cid) => {
      const achP = e.pDate;                                   // Prospecto
      const achC = achP && e.cDate ? maxDate(achP, e.cDate) : null; // Contactado (ya prospecto)
      const achZ = achC && e.zDate ? maxDate(achC, e.zDate) : null; // Cotiza (ya contactado)
      const achM = achZ && e.mDate ? maxDate(achZ, e.mDate) : null; // Compra (ya cotiza)
      arr.push({ cid, achP, achC, achZ, achM, pAct: e.pAct, cAct: e.cAct, zAct: e.zAct, mAct: e.mAct, mLicId: e.mLicId });
    });
    return arr;
  }, [actividadesFiltradas, licById, particularIds]);

  const clientesById = useMemo(() => {
    const m = new Map();
    clientes.forEach((c) => m.set(String(c.id), c));
    return m;
  }, [clientes]);

  // Detalle por etapa (acumulado al corte del mes seleccionado): cliente + la
  // actividad de bitácora que marcó la etapa. Para "compran" se incluye la
  // cotización adjudicada que gatilló la marca.
  const detalleEmbudo = useMemo(() => {
    const corte = finDeMes(mesActual);
    const out = { prospectos: [], contactados: [], cotizan: [], compran: [] };
    logrosPorCliente.forEach((L) => {
      const cliente = clientesById.get(L.cid)?.nombre || `Cliente ${L.cid}`;
      const push = (key, ach, act, extra) => {
        if (!ach || ach > corte) return;
        out[key].push({
          clienteId: L.cid,
          cliente,
          fecha: ach,
          tipo: act?.tipo || "",
          motivo: act?.motivo || "",
          ejecutivo: (act?.user_email || "").trim().toLowerCase(),
          ...extra,
        });
      };
      push("prospectos", L.achP, L.pAct);
      push("contactados", L.achC, L.cAct);
      push("cotizan", L.achZ, L.zAct);
      push("compran", L.achM, L.mAct, { licitacionId: L.mLicId });
    });
    Object.values(out).forEach((arr) => arr.sort((a, b) => String(b.fecha).localeCompare(String(a.fecha))));
    return out;
  }, [logrosPorCliente, clientesById, mesActual]);

  const embudoHasta = useMemo(() => (mesKey) => {
    const corte = finDeMes(mesKey);
    let p = 0, c = 0, z = 0, m = 0;
    logrosPorCliente.forEach((L) => {
      if (L.achP && L.achP <= corte) p++;
      if (L.achC && L.achC <= corte) c++;
      if (L.achZ && L.achZ <= corte) z++;
      if (L.achM && L.achM <= corte) m++;
    });
    return { prospectos: p, contactados: c, cotizan: z, compran: m };
  }, [logrosPorCliente]);

  // Evolución: clientes que ENTRAN a cada etapa en el mes (nuevos logros).
  const evolucion = useMemo(() => {
    const arr = [];
    for (let i = 5; i >= 0; i--) {
      const k = addMesKey(mesActual, -i);
      let pros = 0, cont = 0, cot = 0, com = 0;
      logrosPorCliente.forEach((L) => {
        if (mesDe(L.achP) === k) pros++;
        if (mesDe(L.achC) === k) cont++;
        if (mesDe(L.achZ) === k) cot++;
        if (mesDe(L.achM) === k) com++;
      });
      arr.push({ mes: k, label: labelMesCorto(k), prospectos: pros, contactados: cont, cotizan: cot, compran: com });
    }
    return arr;
  }, [mesActual, logrosPorCliente]);

  const emb = useMemo(() => embudoHasta(mesActual), [embudoHasta, mesActual]);
  const embPrev = useMemo(() => embudoHasta(mesPrev), [embudoHasta, mesPrev]);

  const conv = useMemo(() => ({
    e1: emb.prospectos > 0 ? (emb.contactados / emb.prospectos) * 100 : 0,
    e2: emb.contactados > 0 ? (emb.cotizan / emb.contactados) * 100 : 0,
    e3: emb.cotizan > 0 ? (emb.compran / emb.cotizan) * 100 : 0,
    total: emb.prospectos > 0 ? (emb.compran / emb.prospectos) * 100 : 0,
  }), [emb]);

  const maxEmbudo = Math.max(1, emb.prospectos, emb.contactados, emb.cotizan, emb.compran);

  return { loading: loading && puedeVer, puedeVer, emb, embPrev, evolucion, conv, maxEmbudo, opcionesEjecutivos, detalleEmbudo, nombresEjecutivos };
}
