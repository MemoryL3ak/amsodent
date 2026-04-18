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

  if (!sesion) return <Navigate to="/login" />;

  return children;
}
