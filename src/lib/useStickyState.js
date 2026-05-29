import { useEffect, useState } from "react";

// useState que persiste el valor en sessionStorage bajo `key`.
// Sirve para conservar los filtros de un listado al navegar a un detalle
// y volver atrás. Se limpia al cerrar la pestaña (no contamina sesiones futuras).
export function useStickyState(key, defaultValue) {
  const [value, setValue] = useState(() => {
    try {
      const raw = sessionStorage.getItem(key);
      if (raw != null) return JSON.parse(raw);
    } catch {
      // sessionStorage no disponible o JSON inválido — usar default
    }
    return defaultValue;
  });

  useEffect(() => {
    try {
      sessionStorage.setItem(key, JSON.stringify(value));
    } catch {
      // modo privado / cuota llena — ignorar
    }
  }, [key, value]);

  return [value, setValue];
}
