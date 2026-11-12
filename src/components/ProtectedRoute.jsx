import { Navigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

export default function ProtectedRoute({ children }) {
  const [loading, setLoading] = useState(true);
  const [sesion, setSesion] = useState(null);

  useEffect(() => {
    async function validar() {
      const { data } = await supabase.auth.getSession();
      setSesion(data.session);
      setLoading(false);
    }
    validar();
  }, []);

  if (loading) return <div className="mt-10 text-center">Cargando...</div>;

  if (!sesion) {
    /* (2026-11-12) Si el ingreso con Google falló y Supabase devolvió a la
       persona a esta ruta (y no a /login), el motivo viene en la URL: se lleva
       al login para que lo explique, en vez de perderlo en la redirección. */
    const { search, hash } = window.location;
    if (/[?#&]error(_code|_description)?=/.test(search + hash)) {
      return <Navigate to={`/login${search}${hash}`} replace />;
    }
    return <Navigate to="/login" />;
  }

  return children;
}
