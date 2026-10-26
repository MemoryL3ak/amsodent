// Redeploy 2026-09-04.
import React from "react";
import ReactDOM from "react-dom/client";
import "react-datepicker/dist/react-datepicker.css";
import App from "./App";
import "./styles.css";
import { initMonitor } from "./lib/monitor";

initMonitor();

/* (2026-10-26) Tras un despliegue, una pestaña que quedó abierta con la
   versión anterior pide archivos que ya no existen y falla con "Failed to
   fetch dynamically imported module" (pasó al imprimir en carta una guía).
   Vite avisa con `vite:preloadError`: se ofrece recargar, porque recargar
   sin preguntar podría perder lo que la persona no ha guardado. El tope de
   un minuto evita un bucle si el archivo de verdad no existe. */
window.addEventListener("vite:preloadError", (event) => {
  const err = event.payload;
  let ultima = 0;
  try { ultima = Number(sessionStorage.getItem("recarga_por_version")) || 0; } catch { /* sin storage */ }
  const recienRecargada = Date.now() - ultima < 60_000;
  if (!recienRecargada && window.confirm(
    "Se publicó una versión nueva del sistema y esta pestaña quedó desactualizada.\n\n" +
    "¿Recargar ahora? Si tienes algo sin guardar, cancela, guárdalo y recarga después (F5).",
  )) {
    try { sessionStorage.setItem("recarga_por_version", String(Date.now())); } catch { /* sin storage */ }
    event.preventDefault();
    window.location.reload();
    return;
  }
  // Sin recargar, el error sigue su curso: que al menos se entienda.
  if (err instanceof Error) {
    err.message = "El sistema se actualizó y esta pestaña quedó con la versión anterior: recarga la página (F5) y vuelve a intentarlo.";
  }
});

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
