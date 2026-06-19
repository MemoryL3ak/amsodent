// /src/components/RequireModulo.jsx
// Protege una ruta según los permisos efectivos del usuario (perfil o rol).
import useAuth from "../hooks/useAuth";
import { Navigate } from "react-router-dom";

export default function RequireModulo({ modulo, children }) {
  const { cargando, puede } = useAuth();

  if (cargando) return <div>Cargando...</div>;

  if (!puede(modulo)) {
    return <Navigate to="/denegado" replace />;
  }

  return children;
}
