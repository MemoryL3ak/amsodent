import { useEffect } from "react";
import { supabase } from "../lib/supabase";
import { conectarCorreoDeGoogle } from "../lib/ingresoEquipo";

// Red de seguridad del «correo conectado al entrar con Google»: el login ya
// manda al servidor el refresh_token de Google al volver del ingreso; si ese
// envío no alcanzó a salir (red, pestaña cerrada), aquí se reintenta al cargar
// la aplicación, mientras la sesión todavía lo trae.
//
// Las sesiones de correo y contraseña no traen ese token y se ignoran. No se
// mira `app_metadata.provider`: ahí queda el PRIMER proveedor de la cuenta
// («email», porque los usuarios los crea administración), no el de este ingreso.
export default function GoogleAuthSync() {
  useEffect(() => {
    // Caso 1: al cargar la app justo después de volver de Google.
    supabase.auth.getSession().then(({ data }) => {
      conectarCorreoDeGoogle(data?.session);
    });

    // Caso 2: el evento SIGNED_IN al volver del ingreso con Google.
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN") conectarCorreoDeGoogle(session);
    });

    return () => {
      sub?.subscription?.unsubscribe?.();
    };
  }, []);

  return null;
}
