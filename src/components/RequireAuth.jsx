// /src/components/RequireAuth.jsx
import useAuth from "../hooks/useAuth";
import { Navigate } from "react-router-dom";

export default function RequireAuth({ children }) {
  const { user, cargando } = useAuth();

  if (cargando) return <div>Cargando...</div>;

  if (!user) return <Navigate to="/login" replace />;

  return children;
}
