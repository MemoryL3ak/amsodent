// /src/hooks/useAuth.js
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

export default function useAuth() {
  const [user, setUser] = useState(null);
  const [perfil, setPerfil] = useState(null);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    async function cargar() {
      const { data: sessionData } = await supabase.auth.getSession();
      const session = sessionData?.session;

      if (!session) {
        setUser(null);
        setPerfil(null);
        setCargando(false);
        return;
      }

      setUser(session.user);

      // Obtener perfil
      const { data: perfilDB } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", session.user.id)
        .single();

      setPerfil(perfilDB);
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
  }

  return {
    user,
    perfil,
    rol: perfil?.rol || "Usuario",
    cargando,
    logout,
  };
}
