import { useEffect } from "react";
import { supabase } from "../lib/supabase";
import { api } from "../lib/api";

// Componente invisible que vive dentro del layout protegido. Escucha el evento
// SIGNED_IN de Supabase Auth y, si Google entregó un provider_refresh_token
// (lo hace al loguear con scope gmail.send + access_type=offline), lo manda al
// backend para guardarlo en user_google_oauth.
//
// Sin esto el refresh_token vive solo en la sesión del cliente y se pierde al
// cerrar el navegador o al refrescar la página después de ~1h.
//
// Idempotente: si Google no entrega refresh_token (no era la primera vez con
// consent), no hace nada. Si el backend ya tenía uno guardado, queda con el
// que ya tenía válido.
export default function GmailTokenSync() {
  useEffect(() => {
    // 1) Caso login fresco: capturamos el evento SIGNED_IN justo después del
    // callback OAuth de Supabase. Es el único momento en que provider_refresh_token
    // está disponible.
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event !== "SIGNED_IN") return;
      void tryGuardar(session);
    });

    // 2) Caso "ya logueado al cargar la página": si la sesión actual viene del
    // callback OAuth (raro pero posible), también intentamos guardar. Si no hay
    // provider_refresh_token, simplemente no hacemos nada.
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (data?.session) await tryGuardar(data.session);
    })();

    return () => {
      sub?.subscription?.unsubscribe?.();
    };
  }, []);

  return null;
}

async function tryGuardar(session) {
  try {
    const refresh = session?.provider_refresh_token;
    const email = session?.user?.email;
    if (!refresh || !email) return; // login con password o sesión vieja
    // Lo intentamos solo si el provider fue google (otros providers no tienen
    // refresh_token compatible).
    const provider = session?.user?.app_metadata?.provider;
    const providers = session?.user?.app_metadata?.providers || [];
    if (provider !== "google" && !providers.includes("google")) return;

    await api.post("/auth/google/save-refresh-token", {
      refresh_token: refresh,
      google_email: email,
    });
    // Silencioso por diseño: no toasteamos para no spamear al usuario en
    // cada login. Si falla, el flujo "Conectar Gmail" en /perfil sigue
    // disponible como fallback.
  } catch (e) {
    console.warn("[GmailTokenSync] no se pudo guardar refresh_token:", e?.message || e);
  }
}
