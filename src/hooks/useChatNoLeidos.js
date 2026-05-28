// Cuenta los mensajes de chat sin leer en TODAS las salas del usuario, en
// tiempo real, sin depender de que la página del Chat Grupal esté abierta.
// Sirve para mostrar un badge de "mensajes pendientes" en el sidebar.
//
// Mecánica:
//  - Al montar: suma, por cada sala donde el usuario es miembro, los mensajes
//    posteriores a su leido_hasta que no escribió él mismo.
//  - INSERT en chat_mensajes (de otra persona, en una sala mía) → incrementa.
//  - UPDATE de mi fila en chat_sala_miembros (leído_hasta = now) → esa sala
//    queda en 0 (es lo que hace la página del chat al abrir/leer una sala).
//  - INSERT/DELETE de mi membresía → mantiene el set de salas al día.
import { useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";

export default function useChatNoLeidos(email) {
  const correo = String(email || "").trim().toLowerCase();
  const [total, setTotal] = useState(0);
  const porSalaRef = useRef({}); // { salaId: count }
  const misSalasRef = useRef(new Set());

  useEffect(() => {
    if (!correo) {
      porSalaRef.current = {};
      misSalasRef.current = new Set();
      setTotal(0);
      return undefined;
    }

    let activo = true;
    const recomputar = () => {
      if (!activo) return;
      const t = Object.values(porSalaRef.current).reduce((a, b) => a + (b || 0), 0);
      setTotal(t);
    };

    (async () => {
      const { data: miembros } = await supabase
        .from("chat_sala_miembros")
        .select("sala_id, leido_hasta")
        .eq("email", correo);
      const ids = (miembros || []).map((m) => m.sala_id);
      misSalasRef.current = new Set(ids);
      const mapaLeido = {};
      (miembros || []).forEach((m) => {
        mapaLeido[m.sala_id] = m.leido_hasta || new Date(0).toISOString();
      });

      const conteo = {};
      await Promise.all(
        ids.map(async (salaId) => {
          const desde = mapaLeido[salaId] || new Date(0).toISOString();
          const { count } = await supabase
            .from("chat_mensajes")
            .select("id", { count: "exact", head: true })
            .eq("sala_id", salaId)
            .gt("created_at", desde)
            .neq("autor_email", correo);
          conteo[salaId] = count || 0;
        }),
      );
      if (!activo) return;
      porSalaRef.current = conteo;
      recomputar();
    })();

    const canalMsg = supabase
      .channel(`sidebar_chat_no_leidos_${correo}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "chat_mensajes" },
        (payload) => {
          const m = payload?.new;
          if (!m?.sala_id) return;
          if ((m.autor_email || "").toLowerCase() === correo) return;
          if (!misSalasRef.current.has(m.sala_id)) return;
          porSalaRef.current[m.sala_id] = (porSalaRef.current[m.sala_id] || 0) + 1;
          recomputar();
        },
      )
      .subscribe();

    const filtroEmail = `email=eq.${correo}`;
    const canalMiembros = supabase
      .channel(`sidebar_chat_membresia_${correo}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "chat_sala_miembros", filter: filtroEmail },
        (payload) => {
          const salaId = payload?.new?.sala_id;
          if (!salaId) return;
          // El único UPDATE de esta fila es bumpear leido_hasta al leer la sala.
          porSalaRef.current[salaId] = 0;
          recomputar();
        },
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "chat_sala_miembros", filter: filtroEmail },
        (payload) => {
          const salaId = payload?.new?.sala_id;
          if (salaId) misSalasRef.current.add(salaId);
        },
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "chat_sala_miembros", filter: filtroEmail },
        (payload) => {
          const salaId = payload?.old?.sala_id;
          if (!salaId) return;
          misSalasRef.current.delete(salaId);
          delete porSalaRef.current[salaId];
          recomputar();
        },
      )
      .subscribe();

    return () => {
      activo = false;
      supabase.removeChannel(canalMsg);
      supabase.removeChannel(canalMiembros);
    };
  }, [correo]);

  return total;
}
