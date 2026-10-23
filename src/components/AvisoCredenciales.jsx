import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { KeyRound, X } from "lucide-react";
import { api } from "../lib/api";

/* Banner para administradores (2026-10-23): mientras alguna credencial o
   integración esté RECHAZADA por su proveedor (SMTP, Bsale, Mercado Público,
   Anthropic…), se ve en todas las pantallas, no solo en Monitoreo. Nació
   porque el SMTP llevaba 18 días rechazando la clave y nadie se enteró.
   Se puede cerrar por sesión; si cambia lo que falla, vuelve a aparecer. */

const CLAVE_OCULTO = "aviso_credenciales_oculto";

function leerFirmaOculta() {
  try {
    return sessionStorage.getItem(CLAVE_OCULTO) || "";
  } catch {
    return "";
  }
}

export default function AvisoCredenciales() {
  const [malas, setMalas] = useState([]);
  // Firma (claves que fallan) que el admin ya cerró en esta sesión.
  const [firmaOculta, setFirmaOculta] = useState(leerFirmaOculta);

  useEffect(() => {
    let vivo = true;
    const cargar = () =>
      api
        .get("/monitor/credenciales")
        .then((d) => {
          if (!vivo) return;
          setMalas((d?.items || []).filter((i) => i.estado === "fallo"));
        })
        .catch(() => {});
    cargar();
    const t = setInterval(cargar, 10 * 60_000);
    return () => { vivo = false; clearInterval(t); };
  }, []);

  const firma = malas.map((m) => m.clave).sort().join("|");
  const oculto = !!firma && firmaOculta === firma;

  if (!malas.length || oculto) return null;

  function cerrar() {
    try { sessionStorage.setItem(CLAVE_OCULTO, firma); } catch { /* sin storage */ }
    setFirmaOculta(firma);
  }

  return (
    <div role="alert" className="aviso-cred">
      <KeyRound size={16} style={{ flexShrink: 0 }} />
      <div className="aviso-cred-texto">
        <strong>
          {malas.length === 1 ? "Una credencial fue rechazada" : `${malas.length} credenciales fueron rechazadas`}:
        </strong>{" "}
        {malas.map((m) => m.nombre).join(" · ")}. Lo que dependa de ellas no está funcionando.{" "}
        <Link to="/monitoreo-sistema">Ver detalle en Monitoreo</Link>
      </div>
      <button type="button" className="aviso-cred-cerrar" onClick={cerrar} title="Ocultar por esta sesión">
        <X size={15} />
      </button>
      <style>{`
        .aviso-cred {
          display: flex; align-items: flex-start; gap: 10px;
          background: #fef2f2; border: 1px solid #fca5a5; color: #991b1b;
          border-radius: 10px; padding: 10px 12px; margin-bottom: 14px; font-size: 13px; line-height: 1.45;
        }
        .aviso-cred-texto { flex: 1; min-width: 0; overflow-wrap: anywhere; }
        .aviso-cred-texto a { color: #991b1b; font-weight: 700; text-decoration: underline; }
        .aviso-cred-cerrar {
          flex-shrink: 0; border: 0; background: transparent; color: #991b1b; cursor: pointer;
          padding: 2px; border-radius: 6px; display: inline-flex;
        }
        .aviso-cred-cerrar:hover { background: #fee2e2; }
      `}</style>
    </div>
  );
}
