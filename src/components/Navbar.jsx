import { Link, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import UserHeader from "./UserHeader";

export default function Navbar() {
  const navigate = useNavigate();

  const logout = async () => {
    await supabase.auth.signOut();
    navigate("/login");
  };

  return (
    <header className="w-full border-b border-gray-500/20 bg-white/80 backdrop-blur supports-[backdrop-filter]:bg-white/60">
      <nav className="mx-auto max-w-7xl px-6 py-3 flex justify-between items-center">
        
        {/* LEFT SIDE: LINKS */}
        <div className="flex gap-6 text-sm font-medium text-gray-700">
          <Link className="hover:text-gray-900 transition" to="/crear">Crear Cotización</Link>
          <Link className="hover:text-gray-900 transition" to="/listar">Ver Cotizaciones</Link>
          <Link className="hover:text-gray-900 transition" to="/productos">Productos</Link>
        </div>

        {/* RIGHT SIDE: USER + LOGOUT */}
        <div className="flex items-center gap-4">
          <UserHeader />

          <button
            onClick={logout}
            className="cursor-pointer rounded-md bg-red-500 text-white px-4 py-2 text-sm shadow hover:bg-red-600 transition"
          >
            Cerrar sesión
          </button>
        </div>

      </nav>
    </header>
  );
}
