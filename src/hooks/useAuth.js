// /src/hooks/useAuth.js
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { api } from "../lib/api";
import { permisosFallback } from "../constants/modulos";

export default function useAuth() {
  const [user, setUser] = useState(null);
  const [perfil, setPerfil] = useState(null);
  const [permisos, setPermisos] = useState(null); // null = aún cargando
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    async function cargar() {
      const { data: sessionData } = await supabase.auth.getSession();
      const session = sessionData?.session;

      if (!session) {
        setUser(null);
        setPerfil(null);
        setPermisos(null);
        setCargando(false);
        return;
      }

      setUser(session.user);

      // Perfil + permisos efectivos. El backend (/auth/profile) calcula los
      // permisos (perfil asignado o, en su defecto, por rol). Si falla, se usa
      // la consulta directa + fallback por rol.
      let perfilDB = null;
      try {
        perfilDB = await api.get("/auth/profile");
      } catch { /* */ }
      if (!perfilDB) {
        const { data } = await supabase.from("profiles").select("*").eq("id", session.user.id).single();
        perfilDB = data;
      }

      setPerfil(perfilDB);
      setPermisos(
        Array.isArray(perfilDB?.permisos) ? perfilDB.permisos : permisosFallback(perfilDB?.rol),
      );
      setCargando(false);
    }

    cargar();

    // Listener para cambios de sesión
    const { data: listener } = supabase.auth.onAuthStateChange(() => {
      cargar();
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  async function logout() {
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
