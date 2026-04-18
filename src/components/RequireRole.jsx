// /src/components/RequireRole.jsx
import useAuth from "../hooks/useAuth";
import { Navigate } from "react-router-dom";

export default function RequireRole({ allow, children }) {
  const { cargando, rol } = useAuth();

  if (cargando) return <div>Cargando...</div>;

  if (!allow.includes(rol)) {
    return <Navigate to="/denegado" replace />;
  }

  return children;
}
