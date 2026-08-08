import { useEffect, useState } from "react";
import { CheckCircle2, Database, Globe, Mail, XCircle } from "lucide-react";
import { api } from "../lib/api";

/* Semáforo de dependencias del sistema (Supabase, SMTP, Mercado Público)
   + versión desplegada y uptime del backend. Se refresca cada minuto. */

const ICONOS = { supabase: Database, smtp: Mail, mercado_publico: Globe };
const NOMBRES = { supabase: "Supabase (BD)", smtp: "Correo SMTP", mercado_publico: "Mercado Público" };

function fmtUptime(seg) {
  if (seg == null) return "—";
  if (seg < 3600) return `${Math.floor(seg / 60)} min`;
  if (seg < 86400) return `${Math.floor(seg / 3600)} h ${Math.floor((seg % 3600) / 60)} min`;
  return `${Math.floor(seg / 86400)} d ${Math.floor((seg % 86400) / 3600)} h`;
}

export default function MonitorSalud() {
  const [salud, setSalud] = useState(null);

  useEffect(() => {
    let vivo = true;
    const cargar = () =>
      api.get("/monitor/salud").then((d) => { if (vivo) setSalud(d); }).catch(() => {});
    cargar();
    const t = setInterval(cargar, 60_000);
    return () => { vivo = false; clearInterval(t); };
  }, []);

  if (!salud) return null;

  return (
    <div className="msal-fila">
      {(salud.servicios || []).map((s) => {
        const Icono = ICONOS[s.servicio] || Globe;
        const caido = s.ok === false;
        return (
          <div key={s.servicio} className={"msal-chip" + (caido ? " msal-chip-caido" : "")}
            title={caido ? s.error : `Responde en ${s.ms} ms`}>
            <Icono size={13} />
            {NOMBRES[s.servicio] || s.servicio}
            {caido
              ? <><XCircle size={13} style={{ color: "#b91c1c" }} /> <b style={{ color: "#b91c1c" }}>Caído</b></>
              : <><CheckCircle2 size={13} style={{ color: "#15803d" }} /> <span className="msal-ms">{s.ms} ms</span></>}
          </div>
        );
      })}
      <span className="msal-meta">
        Backend v{salud.version} · activo {fmtUptime(salud.uptime_seg)} · {salud.memoria_mb} MB RAM
      </span>

      <style>{`
        .msal-fila { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 14px; }
        .msal-chip {
          display: inline-flex; align-items: center; gap: 6px;
          background: var(--surface, #fff); border: 1px solid var(--border); border-radius: 999px;
          padding: 5px 13px; font-size: 12px; font-weight: 600; color: var(--text-muted);
        }
        .msal-chip-caido { border-color: #fecaca; background: #fef2f2; }
        .msal-ms { font-weight: 500; font-size: 11px; }
        .msal-meta { font-size: 11.5px; color: var(--text-muted); margin-left: auto; }
      `}</style>
    </div>
  );
}
