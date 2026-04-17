import { useEffect, useState } from "react";
import { api } from "../lib/api";

export default function UserHeader() {
  const [perfil, setPerfil] = useState(null);

  useEffect(() => {
    async function cargarPerfil() {
      try {
        const perfilDB = await api.get("/auth/profile");
        setPerfil({
          nombre: perfilDB?.nombre || perfilDB?.email || "?",
          rol: perfilDB?.rol || "Sin rol",
          email: perfilDB?.email || "",
        });
      } catch {
        // no autenticado
      }
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
