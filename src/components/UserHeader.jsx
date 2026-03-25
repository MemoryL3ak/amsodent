import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

export default function UserHeader() {
  const [perfil, setPerfil] = useState(null);

  useEffect(() => {
    async function cargarPerfil() {
      // Obtener usuario autenticado
      const { data: authData } = await supabase.auth.getUser();
      const user = authData?.user;
      if (!user) return;

      // Buscar en profiles por EMAIL
      const { data: perfilDB } = await supabase
        .from("profiles")
        .select("nombre, rol, email")
        .eq("email", user.email)
        .single();

      // Construir el perfil final
      setPerfil({
        nombre: perfilDB?.nombre || user.email,
        rol: perfilDB?.rol || "Sin rol",
        email: user.email
      });
    }

    cargarPerfil();
  }, []);

  if (!perfil) return null;

  const inicial = (perfil.nombre || "?").charAt(0).toUpperCase();

  return (
    <div className="flex items-center gap-3 bg-white border border-gray-300 shadow-md px-4 py-2 rounded-full">
      <div className="w-10 h-10 bg-blue-600 text-white rounded-full flex items-center justify-center font-semibold text-lg">
        {inicial}
      </div>

      <div className="text-right leading-tight">
        <div className="font-semibold text-gray-900">{perfil.nombre}</div>
        <div className="text-xs text-gray-500">{perfil.rol}</div>
      </div>
    </div>
  );
}
