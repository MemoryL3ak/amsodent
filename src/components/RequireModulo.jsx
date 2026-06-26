// /src/components/RequireModulo.jsx
// Protege una ruta según los permisos efectivos del usuario (perfil o rol).
import useAuth from "../hooks/useAuth";
import { Navigate } from "react-router-dom";

export default function RequireModulo({ modulo, children }) {
  const { cargando, puede } = useAuth();

  if (cargando) return <div>Cargando...</div>;

  // `modulo` puede ser un string o un arreglo (acceso si tiene cualquiera).
  const mods = Array.isArray(modulo) ? modulo : [modulo];
  if (!mods.some((m) => puede(m))) {
    return <Navigate to="/denegado" replace />;
  }

  return children;
}
