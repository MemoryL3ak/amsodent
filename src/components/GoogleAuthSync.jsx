import { useEffect } from "react";
import { supabase } from "../lib/supabase";
import { api } from "../lib/api";

// Listener global: cuando el usuario inicia sesión con Google a través de
// Supabase Auth, el primer SIGNED_IN trae el provider_refresh_token de
// Google. Lo enviamos al backend para que el buzón quede conectado
// automáticamente sin pasar por el botón manual "Conectar cuenta".
//
// Solo actúa cuando hay refresh_token nuevo (sesiones email/password no
// traen ninguno, así que se ignoran silenciosamente).
export default function GoogleAuthSync() {
  useEffect(() => {
    const sincronizado = sessionStorage.getItem("google-auth-synced");

    async function intentarSincronizar(session) {
      if (!session) return;
      const refresh = session.provider_refresh_token;
      if (!refresh) return;
      // Solo Google: si en algún momento agregamos otros providers, filtramos.
      const provider = session.user?.app_metadata?.provider;
      if (provider && provider !== "google") return;
      const email = String(session.user?.email || "").toLowerCase();
      if (!email) return;
      if (sincronizado === email) return;
      try {
        await api.post("/correos/oauth/supabase-sync", {
          email,
          refreshToken: refresh,
        });
        sessionStorage.setItem("google-auth-synced", email);
      } catch (e) {
        // best effort — no rompemos el flujo de login si esto falla
        console.warn("No se pudo sincronizar la cuenta de Google:", e?.message || e);
      }
    }

    // Caso 1: al cargar la app justo después del redirect de Google.
    supabase.auth.getSession().then(({ data }) => {
      intentarSincronizar(data?.session);
    });

    // Caso 2: el evento SIGNED_IN dispara al volver del OAuth.
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN") intentarSincronizar(session);
      if (event === "SIGNED_OUT") sessionStorage.removeItem("google-auth-synced");
    });

    return () => {
      sub?.subscription?.unsubscribe?.();
    };
  }, []);

  return null;
}
