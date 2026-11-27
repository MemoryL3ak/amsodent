import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../lib/api";

/* (2026-11-27) Notas adhesivas: datos y guardado.
   - La pantalla cambia al instante y el servidor se entera un momento después
     (los cambios de una misma nota se juntan mientras se escribe).
   - Si un guardado falla (sin red, sesión bloqueada) el cambio NO se pierde:
     queda pendiente, la nota se marca «sin guardar» y `reintentar` lo manda
     de nuevo. Los envíos de una misma nota van en fila, nunca cruzados. */

const ESPERA_GUARDADO_MS = 700;

export function useNotas(activo) {
  const [notas, setNotas] = useState([]);
  const [estado, setEstado] = useState("cargando"); // cargando | lista | error
  const [error, setError] = useState("");
  const [enVuelo, setEnVuelo] = useState(0);
  const [sinGuardar, setSinGuardar] = useState({}); // id → mensaje del fallo

  const pendientes = useRef(new Map()); // id → { cambios, reloj }
  const filas = useRef(new Map()); // id → promesa del último envío
  const montado = useRef(true);
  const notasRef = useRef([]);
  notasRef.current = notas;

  const cargar = useCallback(async () => {
    setEstado("cargando");
    setError("");
    try {
      const r = await api.get("/notas");
      if (!montado.current) return;
      setNotas(Array.isArray(r?.notas) ? r.notas : []);
      setEstado("lista");
    } catch (e) {
      if (!montado.current) return;
      setError(e?.message || "No se pudieron cargar las notas.");
      setEstado("error");
    }
  }, []);

  const enviar = useCallback((id) => {
    const p = pendientes.current.get(id);
    if (!p) return Promise.resolve();
    clearTimeout(p.reloj);
    pendientes.current.delete(id);
    const cambios = p.cambios;
    const anterior = filas.current.get(id) || Promise.resolve();
    const turno = anterior.then(async () => {
      if (montado.current) setEnVuelo((n) => n + 1);
      try {
        await api.put(`/notas/${id}`, cambios);
        if (montado.current) setSinGuardar((s) => (s[id] ? Object.fromEntries(Object.entries(s).filter(([k]) => Number(k) !== Number(id))) : s));
      } catch (e) {
        // La nota se eliminó en otra pestaña: no hay nada que reintentar.
        if (e?.status === 404) {
          if (montado.current) setNotas((ns) => ns.filter((n) => n.id !== id));
          return;
        }
        // Lo que no salió vuelve a la cola, debajo de lo que se haya escrito después.
        const nuevo = pendientes.current.get(id);
        pendientes.current.set(id, { cambios: { ...cambios, ...(nuevo?.cambios || {}) }, reloj: nuevo?.reloj });
        if (montado.current) setSinGuardar((s) => ({ ...s, [id]: e?.message || "No se pudo guardar." }));
      } finally {
        if (montado.current) setEnVuelo((n) => Math.max(0, n - 1));
      }
    });
    filas.current.set(id, turno);
    return turno;
  }, []);

  const guardarTodo = useCallback(() => {
    for (const id of [...pendientes.current.keys()]) enviar(id);
  }, [enviar]);

  useEffect(() => {
    montado.current = true;
    if (activo) cargar();
    // Al salir o recargar: lo que estaba esperando se manda ya.
    const alSalir = () => guardarTodo();
    window.addEventListener("pagehide", alSalir);
    return () => {
      window.removeEventListener("pagehide", alSalir);
      guardarTodo();
      montado.current = false;
    };
  }, [activo, cargar, guardarTodo]);

  const actualizar = useCallback((id, cambios, { inmediato = false } = {}) => {
    setNotas((ns) => ns.map((n) => (n.id === id ? { ...n, ...cambios, updated_at: new Date().toISOString() } : n)));
    const previo = pendientes.current.get(id);
    clearTimeout(previo?.reloj);
    const junto = { ...(previo?.cambios || {}), ...cambios };
    if (inmediato) {
      pendientes.current.set(id, { cambios: junto, reloj: null });
      enviar(id);
    } else {
      pendientes.current.set(id, { cambios: junto, reloj: setTimeout(() => enviar(id), ESPERA_GUARDADO_MS) });
    }
  }, [enviar]);

  const crear = useCallback(async (campos) => {
    const nota = await api.post("/notas", campos || {});
    if (montado.current && nota?.id) setNotas((ns) => [nota, ...ns.filter((n) => n.id !== nota.id)]);
    return nota;
  }, []);

  const eliminar = useCallback(async (id) => {
    const p = pendientes.current.get(id);
    clearTimeout(p?.reloj);
    pendientes.current.delete(id);
    const quitada = notasRef.current.find((n) => n.id === id) || null;
    setNotas((ns) => ns.filter((n) => n.id !== id));
    setSinGuardar((s) => Object.fromEntries(Object.entries(s).filter(([k]) => Number(k) !== Number(id))));
    try {
      await (filas.current.get(id) || Promise.resolve());
      await api.delete(`/notas/${id}`);
    } catch (e) {
      // No se pudo eliminar: la nota vuelve a su lugar.
      if (montado.current && quitada) setNotas((ns) => (ns.some((n) => n.id === id) ? ns : [...ns, quitada]));
      throw e;
    }
    return quitada;
  }, []);

  /* Guarda el orden del tablero: `ids` es la lista completa ya reordenada. */
  const reordenar = useCallback(async (ids) => {
    const lugar = new Map(ids.map((id, i) => [id, i]));
    setNotas((ns) => ns.map((n) => (lugar.has(n.id) ? { ...n, orden: lugar.get(n.id) } : n)));
    await api.post("/notas/orden", { ids });
  }, []);

  const reintentar = useCallback(() => guardarTodo(), [guardarTodo]);

  return {
    notas,
    estado,
    error,
    guardando: enVuelo > 0,
    sinGuardar,
    cargar,
    crear,
    actualizar,
    eliminar,
    reordenar,
    reintentar,
    guardarYa: enviar,
  };
}
