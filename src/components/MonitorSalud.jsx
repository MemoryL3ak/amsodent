import { useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Database,
  Globe,
  KeyRound,
  Mail,
  MinusCircle,
  RefreshCw,
  XCircle,
} from "lucide-react";
import { api } from "../lib/api";

/* Semáforo de dependencias del sistema (Supabase, SMTP, Mercado Público)
   + versión desplegada y uptime del backend. Se refresca cada minuto.
   Debajo (2026-10-23) el estado de las CREDENCIALES: el semáforo solo dice
   si el servicio responde; el chequeo de credenciales autentica de verdad
   contra cada proveedor (el SMTP estuvo 18 días "verde" con la clave
   rechazada). */

const ICONOS = { supabase: Database, smtp: Mail, mercado_publico: Globe };
const NOMBRES = { supabase: "Supabase (BD)", smtp: "Correo SMTP (conexión)", mercado_publico: "Mercado Público (conexión)" };

function fmtUptime(seg) {
  if (seg == null) return "—";
  if (seg < 3600) return `${Math.floor(seg / 60)} min`;
  if (seg < 86400) return `${Math.floor(seg / 3600)} h ${Math.floor((seg % 3600) / 60)} min`;
  return `${Math.floor(seg / 86400)} d ${Math.floor((seg % 86400) / 3600)} h`;
}

function fmtHora(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("es-CL", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function fmtDesde(iso) {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "";
  const min = Math.floor(ms / 60000);
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 48) return `hace ${h} h`;
  return `hace ${Math.floor(h / 24)} días`;
}

const ESTADOS = {
  ok: { icono: CheckCircle2, color: "#15803d", fondo: "#f0fdf4", borde: "#bbf7d0", etiqueta: "OK" },
  fallo: { icono: XCircle, color: "#b91c1c", fondo: "#fef2f2", borde: "#fecaca", etiqueta: "Rechazada" },
  aviso: { icono: AlertTriangle, color: "#b45309", fondo: "#fffbeb", borde: "#fde68a", etiqueta: "Aviso" },
  sin_respuesta: { icono: Clock, color: "#475569", fondo: "#f8fafc", borde: "#e2e8f0", etiqueta: "Sin respuesta" },
  no_configurada: { icono: MinusCircle, color: "#94a3b8", fondo: "#f8fafc", borde: "#e2e8f0", etiqueta: "No configurada" },
};
const ORDEN = { fallo: 0, aviso: 1, sin_respuesta: 2, ok: 3, no_configurada: 4 };

export default function MonitorSalud() {
  const [salud, setSalud] = useState(null);
  const [cred, setCred] = useState(null);
  const [probando, setProbando] = useState(false);
  const [errorCred, setErrorCred] = useState("");

  useEffect(() => {
    let vivo = true;
    const cargar = () =>
      api.get("/monitor/salud").then((d) => { if (vivo) setSalud(d); }).catch(() => {});
    cargar();
    const t = setInterval(cargar, 60_000);
    return () => { vivo = false; clearInterval(t); };
  }, []);

  useEffect(() => {
    let vivo = true;
    const cargar = () =>
      api.get("/monitor/credenciales").then((d) => { if (vivo) setCred(d); }).catch(() => {});
    cargar();
    const t = setInterval(cargar, 5 * 60_000);
    return () => { vivo = false; clearInterval(t); };
  }, []);

  async function probarAhora() {
    setProbando(true);
    setErrorCred("");
    try {
      const d = await api.post("/monitor/credenciales/chequear", {});
      setCred(d);
    } catch (e) {
      setErrorCred(e?.message || "No se pudo correr el chequeo.");
    } finally {
      setProbando(false);
    }
  }

  const items = [...(cred?.items || [])].sort(
    (a, b) => (ORDEN[a.estado] ?? 9) - (ORDEN[b.estado] ?? 9) || a.nombre.localeCompare(b.nombre),
  );
  const fallos = items.filter((i) => i.estado === "fallo").length;
  const avisos = items.filter((i) => i.estado === "aviso").length;

  return (
    <>
      {salud && (
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
        </div>
      )}

      {/* ── Credenciales e integraciones ── */}
      <section className={"mcred" + (fallos ? " mcred-fallo" : avisos ? " mcred-aviso" : "")}>
        <div className="mcred-cabecera">
          <div className="mcred-titulo">
            <KeyRound size={16} style={{ color: fallos ? "#b91c1c" : "var(--primary)" }} />
            <strong>Credenciales e integraciones</strong>
            {cred && items.length > 0 && (
              fallos
                ? <span className="mcred-resumen mcred-resumen-fallo">{fallos} rechazada{fallos === 1 ? "" : "s"}{avisos ? ` · ${avisos} aviso${avisos === 1 ? "" : "s"}` : ""}</span>
                : avisos
                  ? <span className="mcred-resumen mcred-resumen-aviso">{avisos} aviso{avisos === 1 ? "" : "s"}</span>
                  : <span className="mcred-resumen mcred-resumen-ok">Todas aceptadas</span>
            )}
          </div>
          <div className="mcred-acciones">
            <span className="mcred-meta">
              {cred?.revisado_en ? `Revisado ${fmtHora(cred.revisado_en)}` : "Aún sin revisar"}
              {cred?.intervalo_horas ? ` · cada ${cred.intervalo_horas} h` : ""}
              {cred && cred.en_produccion === false ? " · avisos a admins apagados fuera de Railway" : ""}
            </span>
            <button className="btn btn-ghost" onClick={probarAhora} disabled={probando || cred?.chequeando}
              style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <RefreshCw size={13} className={probando || cred?.chequeando ? "girando" : undefined} />
              {probando || cred?.chequeando ? "Probando…" : "Probar ahora"}
            </button>
          </div>
        </div>
        {errorCred && <div className="mcred-error">{errorCred}</div>}
        {!cred || items.length === 0 ? (
          <div className="mcred-vacio">El backend corre el primer chequeo a los 20 s de arrancar. Pulsa «Probar ahora» para no esperar.</div>
        ) : (
          <div className="mcred-grid">
            {items.map((it) => {
              const v = ESTADOS[it.estado] || ESTADOS.sin_respuesta;
              const Icono = v.icono;
              return (
                <div key={it.clave} className="mcred-item" style={{ background: v.fondo, borderColor: v.borde }} title={it.detalle}>
                  <Icono size={16} style={{ color: v.color, flexShrink: 0, marginTop: 1 }} />
                  <div style={{ minWidth: 0 }}>
                    <div className="mcred-nombre">
                      {it.nombre}
                      <span className="mcred-estado" style={{ color: v.color }}>{v.etiqueta}</span>
                      {it.estado !== "ok" && it.estado !== "no_configurada" && it.desde && (
                        <span className="mcred-desde">{fmtDesde(it.desde)}</span>
                      )}
                    </div>
                    <div className="mcred-detalle">{it.detalle}</div>
                    {it.estado === "fallo" && <div className="mcred-variable">Corregir: <code>{it.variable}</code></div>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

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

        .mcred { background: var(--surface, #fff); border: 1px solid var(--border); border-radius: 12px; padding: 12px 14px; margin-bottom: 16px; }
        .mcred-fallo { border-color: #fca5a5; box-shadow: 0 0 0 3px #fee2e2; }
        .mcred-aviso { border-color: #fcd34d; }
        .mcred-cabecera { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; margin-bottom: 10px; }
        .mcred-titulo { display: flex; align-items: center; gap: 8px; font-size: 13.5px; color: var(--text, #0f172a); flex-wrap: wrap; }
        .mcred-resumen { font-size: 11.5px; font-weight: 700; border-radius: 999px; padding: 2px 9px; }
        .mcred-resumen-fallo { background: #fee2e2; color: #b91c1c; }
        .mcred-resumen-aviso { background: #fef3c7; color: #b45309; }
        .mcred-resumen-ok { background: #dcfce7; color: #15803d; }
        .mcred-acciones { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
        .mcred-meta { font-size: 11.5px; color: var(--text-muted); }
        .mcred-error { font-size: 12.5px; color: #b91c1c; margin-bottom: 8px; }
        .mcred-vacio { font-size: 12.5px; color: var(--text-muted); padding: 4px 0 2px; }
        .mcred-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 8px; }
        .mcred-item { display: flex; gap: 8px; border: 1px solid; border-radius: 10px; padding: 8px 10px; min-width: 0; }
        .mcred-nombre { font-size: 12.5px; font-weight: 700; color: var(--text, #0f172a); display: flex; align-items: baseline; gap: 6px; flex-wrap: wrap; }
        .mcred-estado { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .02em; }
        .mcred-desde { font-size: 11px; font-weight: 500; color: var(--text-muted); }
        .mcred-detalle { font-size: 11.5px; color: var(--text-muted); line-height: 1.4; overflow-wrap: anywhere; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
        .mcred-variable { font-size: 11px; color: #991b1b; margin-top: 3px; }
        .mcred-variable code { font-size: 11px; }
      `}</style>
    </>
  );
}
