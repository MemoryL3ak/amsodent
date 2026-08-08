import { supabase } from "./supabase";

/* Captura global de errores JS del frontend y los reporta al backend
   (POST /monitor/frontend → tabla monitor_logs → panel /monitoreo-sistema).
   Incluye "breadcrumbs": las últimas acciones del usuario (navegación,
   llamadas API, clicks) viajan junto al error para poder reproducirlo.
   Diseñado para no molestar jamás: si no hay sesión no envía, si el envío
   falla se descarta en silencio, y deduplica mensajes repetidos. */

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3001/api";

// Dedupe: el mismo error (p. ej. un render que truena en loop) se reporta
// como máximo una vez por minuto.
const reportados = new Map(); // clave → timestamp último envío
const DEDUPE_MS = 60_000;
const MAX_POR_SESION = 50;
let enviadosSesion = 0;

// ── Breadcrumbs: memoria corta de lo que hizo el usuario ─────────────
const MAX_MIGAS = 25;
const migas = [];

function miga(tipo, dato) {
  migas.push({ t: new Date().toISOString().slice(11, 19), tipo, ...dato });
  if (migas.length > MAX_MIGAS) migas.shift();
}

async function reportar(mensaje, stack, metadata) {
  try {
    if (enviadosSesion >= MAX_POR_SESION) return;
    const clave = String(mensaje || "").slice(0, 200);
    const ultimo = reportados.get(clave);
    if (ultimo && Date.now() - ultimo < DEDUPE_MS) return;
    reportados.set(clave, Date.now());

    const { data } = await supabase.auth.getSession();
    const token = data?.session?.access_token;
    if (!token) return; // sin sesión no reportamos (el endpoint exige auth)

    enviadosSesion += 1;
    // fetch NATIVO original (no el parchado ni el helper api): si este
    // endpoint falla no queremos que ese error vuelva a entrar aquí.
    await fetchOriginal(`${API_URL}/monitor/frontend`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        mensaje: String(mensaje || "Error sin mensaje").slice(0, 2000),
        stack: stack ? String(stack).slice(0, 8000) : undefined,
        ruta: window.location?.pathname || "",
        metadata: { ...metadata, breadcrumbs: [...migas] },
      }),
      keepalive: true,
    });
  } catch {
    /* nunca propagar */
  }
}

// Referencia al fetch sin parchar (se fija en initMonitor).
let fetchOriginal = window.fetch.bind(window);

export function initMonitor() {
  // ── Errores ──
  window.addEventListener("error", (ev) => {
    // Ignorar errores de recursos (imágenes/scripts que no cargan): llegan
    // como ErrorEvent sin `error` y con target distinto de window.
    if (!ev?.message && !ev?.error) return;
    reportar(ev.message || ev.error?.message, ev.error?.stack, {
      archivo: ev.filename || undefined,
      linea: ev.lineno || undefined,
    });
  });

  window.addEventListener("unhandledrejection", (ev) => {
    const r = ev?.reason;
    // Los errores de API ya quedan registrados en el backend; reportarlos de
    // nuevo desde el navegador solo duplicaría la fila.
    if (r?.status != null) return;
    reportar(
      r?.message || (typeof r === "string" ? r : "Promesa rechazada sin mensaje"),
      r?.stack,
      { tipo: "unhandledrejection" },
    );
  });

  // ── Breadcrumbs ──
  // Navegación SPA: pushState/replaceState + botón atrás.
  const origPush = history.pushState.bind(history);
  history.pushState = (...args) => {
    miga("nav", { a: String(args[2] || "") });
    return origPush(...args);
  };
  window.addEventListener("popstate", () => miga("nav", { a: window.location.pathname }));

  // Llamadas API: parchamos fetch para anotar método, ruta, status y ms.
  fetchOriginal = window.fetch.bind(window);
  window.fetch = async (recurso, opciones) => {
    const url = typeof recurso === "string" ? recurso : recurso?.url || "";
    const esApi = url.startsWith(API_URL);
    const esMonitor = url.includes("/monitor/");
    const t0 = Date.now();
    try {
      const res = await fetchOriginal(recurso, opciones);
      if (esApi && !esMonitor) {
        miga("api", {
          m: (opciones?.method || "GET").toUpperCase(),
          u: url.replace(API_URL, "").split("?")[0].slice(0, 120),
          s: res.status,
          ms: Date.now() - t0,
        });
      }
      return res;
    } catch (e) {
      if (esApi && !esMonitor) {
        miga("api", {
          m: (opciones?.method || "GET").toUpperCase(),
          u: url.replace(API_URL, "").split("?")[0].slice(0, 120),
          s: "red",
          ms: Date.now() - t0,
        });
      }
      throw e;
    }
  };

  // Clicks en botones y links (texto corto, sin datos sensibles).
  document.addEventListener(
    "click",
    (ev) => {
      const el = ev.target?.closest?.("button, a, [role='button']");
      if (!el) return;
      const texto = (el.innerText || el.getAttribute("aria-label") || el.title || "")
        .trim()
        .split("\n")[0]
        .slice(0, 40);
      if (texto) miga("click", { a: texto });
    },
    { capture: true, passive: true },
  );
}

/** Para reportar errores manualmente desde un catch puntual. */
export function reportarError(error, metadata) {
  reportar(error?.message || String(error), error?.stack, metadata);
}
