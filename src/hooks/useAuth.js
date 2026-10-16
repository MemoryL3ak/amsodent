// /src/hooks/useAuth.js
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { api } from "../lib/api";
import { permisosFallback } from "../constants/modulos";

/* (2026-10-16) Francisco (rol ventas con perfil «Vendedor con campañas,
   trazabilidad e inventario») a veces no podía entrar a Trazabilidad. Cada
   componente que usa este hook (menú, ruta protegida, página, chat,
   recordatorios…) pedía /auth/profile por su cuenta — y otra vez con cada
   evento de sesión —, y si UNA de esas llamadas fallaba (límite de pedidos por
   IP de la oficina, red, timeout) ese componente caía en silencio a los
   permisos del ROL, que para ventas no traen Trazabilidad: la ruta lo mandaba
   a «denegado». Solo les pasaba a quienes tienen perfil de permisos.
   Ahora: una sola carga compartida (60 s), dos reintentos y, si aun así
   falla, los últimos permisos buenos de ese usuario (guardados en este
   navegador); el rol solo se usa si nunca hubo una carga buena. */

const VIGENCIA_MS = 60 * 1000;
let compartida = null; // { userId, ts, promesa }
const claveCache = (uid) => `amsodent.perfil.${uid}`;

function guardarCache(uid, perfil) {
  try { localStorage.setItem(claveCache(uid), JSON.stringify(perfil)); } catch { /* sin almacenamiento: no pasa nada */ }
}
function leerCache(uid) {
  try {
    const p = JSON.parse(localStorage.getItem(claveCache(uid)) || "null");
    return p && Array.isArray(p.permisos) ? p : null;
  } catch {
    return null;
  }
}
function borrarCache(uid) {
  try {
    if (uid) localStorage.removeItem(claveCache(uid));
    else for (const k of Object.keys(localStorage)) if (k.startsWith("amsodent.perfil.")) localStorage.removeItem(k);
  } catch { /* */ }
}

function cargarPerfil(uid) {
  if (compartida && compartida.userId === uid && Date.now() - compartida.ts < VIGENCIA_MS) return compartida.promesa;
  const promesa = (async () => {
    for (let intento = 0; intento < 3; intento++) {
      try {
        const p = await api.get("/auth/profile");
        if (p && Array.isArray(p.permisos)) {
          guardarCache(uid, p);
          return p;
        }
      } catch (e) {
        if (e?.status === 401 || e?.status === 403) break; // sesión inválida: reintentar no sirve
      }
      if (intento < 2) await new Promise((r) => setTimeout(r, 500 * (intento + 1)));
    }
    return null;
  })();
  compartida = { userId: uid, ts: Date.now(), promesa };
  // Una carga fallida no se comparte: la próxima vez se intenta de nuevo.
  promesa.then((p) => { if (!p && compartida?.promesa === promesa) compartida = null; });
  return promesa;
}

export default function useAuth() {
  const [user, setUser] = useState(null);
  const [perfil, setPerfil] = useState(null);
  const [permisos, setPermisos] = useState(null); // null = aún cargando
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    let vivo = true;
    async function cargar(evento) {
      const { data: sessionData } = await supabase.auth.getSession();
      const session = sessionData?.session;

      if (!session) {
        if (evento === "SIGNED_OUT") { compartida = null; borrarCache(); }
        if (!vivo) return;
        setUser(null);
        setPerfil(null);
        setPermisos(null);
        setCargando(false);
        return;
      }

      const uid = session.user.id;
      if (vivo) setUser(session.user);

      // Perfil + permisos efectivos. El backend (/auth/profile) calcula los
      // permisos (perfil asignado o, en su defecto, por rol).
      let perfilDB = await cargarPerfil(uid);
      if (!perfilDB) perfilDB = leerCache(uid);
      if (!perfilDB) {
        const { data } = await supabase.from("profiles").select("*").eq("id", uid).single();
        perfilDB = data;
      }
      if (!vivo) return;
      setPerfil(perfilDB);
      setPermisos(
        Array.isArray(perfilDB?.permisos) ? perfilDB.permisos : permisosFallback(perfilDB?.rol),
      );
      setCargando(false);
    }

    cargar();

    // Cambios de sesión. INITIAL_SESSION ya lo cubre la carga de arriba y
    // TOKEN_REFRESHED no cambia permisos: no se vuelve a pedir el perfil.
    const { data: listener } = supabase.auth.onAuthStateChange((evento) => {
      if (evento === "INITIAL_SESSION" || evento === "TOKEN_REFRESHED") return;
      cargar(evento);
    });

    return () => {
      vivo = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  async function logout() {
    borrarCache(user?.id);
    compartida = null;
    await supabase.auth.signOut();
    setUser(null);
    setPerfil(null);
    setPermisos(null);
  }

  const puede = (modulo) => (Array.isArray(permisos) ? permisos.includes(modulo) : false);

  return {
    user,
    perfil,
    rol: perfil?.rol || "Usuario",
    permisos: permisos || [],
    puede,
    cargando,
    logout,
  };
}
