// Reporte de crashes JS de la app móvil al monitoreo del backend
// (POST /monitor/frontend con origen 'movil' → panel /monitoreo-sistema).
// Port de src/lib/monitor.js del web, adaptado a React Native: acá el
// handler global es ErrorUtils, no window.onerror.
import { supabase } from './supabase';

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3001/api';

const reportados = new Map<string, number>();
const DEDUPE_MS = 60_000;
const MAX_POR_SESION = 30;
let enviadosSesion = 0;

async function reportar(mensaje: string, stack?: string, metadata?: Record<string, unknown>) {
  try {
    if (enviadosSesion >= MAX_POR_SESION) return;
    const clave = String(mensaje || '').slice(0, 200);
    const ultimo = reportados.get(clave);
    if (ultimo && Date.now() - ultimo < DEDUPE_MS) return;
    reportados.set(clave, Date.now());

    const { data } = await supabase.auth.getSession();
    const token = data?.session?.access_token;
    if (!token) return;

    enviadosSesion += 1;
    await fetch(`${API_URL}/monitor/frontend`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        origen: 'movil',
        mensaje: String(mensaje || 'Error sin mensaje').slice(0, 2000),
        stack: stack ? String(stack).slice(0, 8000) : undefined,
        ruta: 'app-movil',
        metadata,
      }),
    });
  } catch {
    /* nunca propagar */
  }
}

export function initMonitor() {
  // Handler global de errores de React Native (equivale a window.onerror).
  const ErrorUtils = (globalThis as any).ErrorUtils;
  if (ErrorUtils?.setGlobalHandler) {
    const previo = ErrorUtils.getGlobalHandler?.();
    ErrorUtils.setGlobalHandler((error: any, esFatal?: boolean) => {
      void reportar(error?.message || String(error), error?.stack, { fatal: !!esFatal });
      previo?.(error, esFatal);
    });
  }

  // Promesas rechazadas sin catch (Hermes emite 'unhandledrejection').
  const g: any = globalThis;
  if (typeof g.addEventListener === 'function') {
    g.addEventListener('unhandledrejection', (ev: any) => {
      const r = ev?.reason;
      if (r?.status != null) return; // errores de API ya registrados en backend
      void reportar(
        r?.message || (typeof r === 'string' ? r : 'Promesa rechazada sin mensaje'),
        r?.stack,
        { tipo: 'unhandledrejection' },
      );
    });
  }
}

/** Para reportar errores manualmente desde un catch puntual. */
export function reportarError(error: any, metadata?: Record<string, unknown>) {
  void reportar(error?.message || String(error), error?.stack, metadata);
}
