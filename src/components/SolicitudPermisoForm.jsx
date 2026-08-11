import { useEffect, useState } from "react";
import { api } from "../lib/api";

/* ============================================================================
   Solicitud de vacaciones y permisos — formulario compartido
   ----------------------------------------------------------------------------
   Lo usan el panel de RR.HH. (registrando a nombre de un trabajador) y el
   portal «Mi Ficha» (el trabajador pidiendo lo suyo). El cálculo de días
   hábiles y de horas lo hace el backend en vivo: es el mismo que después
   valida al guardar, así que lo que se ve en pantalla es lo que queda.
============================================================================ */

/* Espeja RrhhService.TIPOS_SOLICITUD. `medida` decide si se pide un rango de
   fechas o un tramo horario; `habiles` si los días descuentan fines de semana
   y feriados legales. */
export const TIPOS_SOLICITUD = [
  { key: "vacaciones", label: "Feriado legal (vacaciones)", medida: "dias", habiles: true },
  { key: "permiso_dias", label: "Permiso por días", medida: "dias", habiles: true },
  { key: "permiso_horas", label: "Permiso por horas", medida: "horas", habiles: true },
  { key: "dia_administrativo", label: "Día administrativo", medida: "dias", habiles: true },
  { key: "licencia_medica", label: "Licencia médica", medida: "dias", habiles: false },
  { key: "sin_goce", label: "Permiso sin goce de sueldo", medida: "dias", habiles: true },
  { key: "fallecimiento", label: "Fallecimiento de familiar", medida: "dias", habiles: false, legales: 4 },
  { key: "matrimonio", label: "Matrimonio o unión civil", medida: "dias", habiles: false, legales: 5 },
  { key: "nacimiento", label: "Nacimiento de un hijo", medida: "dias", habiles: false, legales: 5 },
];

export const TIPO_SOLICITUD = Object.fromEntries(TIPOS_SOLICITUD.map((t) => [t.key, t]));

// Las solicitudes creadas antes de esta versión usaban otros nombres de tipo.
export const etiquetaTipo = (t) =>
  TIPO_SOLICITUD[t]?.label || String(t || "").replace(/_/g, " ") || "—";

// Duración legible: los permisos por horas no se miden en días.
export function duracionSolicitud(s) {
  if (s?.medida === "horas") return `${Number(s.horas || 0)} h`;
  const d = Number(s?.dias || 0);
  if (!d) return "—";
  return `${d} ${d === 1 ? "día" : "días"}`;
}

const fmtFecha = (v) => {
  if (!v) return "—";
  const d = new Date(String(v).length <= 10 ? `${v}T00:00:00` : v);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("es-CL");
};

const grid = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 };

function Campo({ label, children }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      <span style={{ fontSize: 11.5, fontWeight: 700, color: "var(--text-muted)" }}>{label}</span>
      {children}
    </label>
  );
}

export default function SolicitudPermisoForm({
  titulo = "Solicitar vacaciones o permiso",
  empleados,          // presente = RR.HH. elige a quién; ausente = portal propio
  nombreDe = (e) => `${e?.nombre || ""} ${e?.apellidos || ""}`.trim() || "—",
  calcularEn,         // /rrhh/solicitudes/calcular  o  /rrhh/mi/solicitudes/calcular
  saldos,             // saldo de vacaciones ya conocido (portal del trabajador)
  guardando,
  onCancelar,
  onEnviar,
}) {
  const [f, setF] = useState({ tipo: "vacaciones", fecha_desde: "", fecha_hasta: "", jornada_parcial: "" });
  const [calc, setCalc] = useState(null);

  const cfg = TIPO_SOLICITUD[f.tipo] || TIPO_SOLICITUD.permiso_dias;
  const porHoras = cfg.medida === "horas";
  const set = (c, v) => setF((p) => ({ ...p, [c]: v }));

  // Al cambiar de tipo se limpia lo que no aplica: un permiso por días no debe
  // arrastrar la hora de término que quedó escrita antes.
  function cambiarTipo(tipo) {
    const nuevo = TIPO_SOLICITUD[tipo];
    setF((p) => ({
      ...p,
      tipo,
      ...(nuevo?.medida === "horas"
        ? { fecha_hasta: "", jornada_parcial: "" }
        : { hora_desde: "", hora_hasta: "" }),
    }));
  }

  // Cálculo en vivo mientras se llena el formulario.
  useEffect(() => {
    const listo = porHoras
      ? f.fecha_desde && f.hora_desde && f.hora_hasta
      : f.fecha_desde && f.fecha_hasta;
    if (!listo || (empleados && !f.empleado_id)) {
      setCalc(null);
      return;
    }
    let vivo = true;
    const t = setTimeout(async () => {
      try {
        const r = await api.post(calcularEn, f);
        if (vivo) setCalc(r);
      } catch {
        if (vivo) setCalc(null);
      }
    }, 250);
    return () => { vivo = false; clearTimeout(t); };
  }, [f, porHoras, calcularEn, empleados]);

  const puedeEnviar = porHoras
    ? Boolean(f.fecha_desde && f.hora_desde && f.hora_hasta && (!empleados || f.empleado_id))
    : Boolean(f.fecha_desde && f.fecha_hasta && (!empleados || f.empleado_id));

  const saldoVac = calc?.vacaciones || saldos?.vacaciones;
  const excede = f.tipo === "vacaciones" && calc?.vacaciones && calc.vacaciones.saldo_despues < 0;

  return (
    <div
      onClick={onCancelar}
      style={{
        position: "fixed", inset: 0, background: "rgba(15,23,42,.45)", zIndex: 9200,
        display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--surface)", borderRadius: 14, width: "min(600px, 100%)", maxHeight: "92vh",
          display: "flex", flexDirection: "column", boxShadow: "0 24px 64px -12px rgba(15,23,42,.4)",
        }}
      >
        <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)", fontWeight: 700, fontSize: 15 }}>
          {titulo}
        </div>

        <div style={{ padding: 18, overflowY: "auto", flex: 1, display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={grid}>
            {empleados && (
              <Campo label="Trabajador *">
                <select className="input" value={f.empleado_id || ""} onChange={(e) => set("empleado_id", e.target.value)}>
                  <option value="">Seleccionar…</option>
                  {empleados.map((e) => <option key={e.id} value={e.id}>{nombreDe(e)}</option>)}
                </select>
              </Campo>
            )}

            <Campo label="Tipo *">
              <select className="input" value={f.tipo} onChange={(e) => cambiarTipo(e.target.value)}>
                {TIPOS_SOLICITUD.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
              </select>
            </Campo>

            {porHoras ? (
              <>
                <Campo label="Día *">
                  <input className="input" type="date" value={f.fecha_desde || ""} onChange={(e) => set("fecha_desde", e.target.value)} />
                </Campo>
                <Campo label="Desde las *">
                  <input className="input" type="time" value={f.hora_desde || ""} onChange={(e) => set("hora_desde", e.target.value)} />
                </Campo>
                <Campo label="Hasta las *">
                  <input className="input" type="time" value={f.hora_hasta || ""} onChange={(e) => set("hora_hasta", e.target.value)} />
                </Campo>
              </>
            ) : (
              <>
                <Campo label="Desde *">
                  <input className="input" type="date" value={f.fecha_desde || ""} onChange={(e) => set("fecha_desde", e.target.value)} />
                </Campo>
                <Campo label="Hasta *">
                  <input className="input" type="date" min={f.fecha_desde || undefined} value={f.fecha_hasta || ""}
                    onChange={(e) => set("fecha_hasta", e.target.value)} />
                </Campo>
                <Campo label="Jornada">
                  <select className="input" value={f.jornada_parcial || ""} onChange={(e) => set("jornada_parcial", e.target.value)}>
                    <option value="">Día completo</option>
                    <option value="manana">Solo la mañana (medio día)</option>
                    <option value="tarde">Solo la tarde (medio día)</option>
                  </select>
                </Campo>
              </>
            )}
          </div>

          <Campo label={f.tipo === "vacaciones" ? "Comentario" : "Motivo"}>
            <textarea className="input" rows={3} value={f.motivo || ""} onChange={(e) => set("motivo", e.target.value)}
              placeholder={cfg.legales ? `La ley otorga ${cfg.legales} días para este permiso.` : ""} />
          </Campo>

          {/* Resultado del cálculo */}
          <div style={{
            background: excede ? "#fffbeb" : "var(--bg)",
            border: `1px solid ${excede ? "#fde68a" : "var(--border)"}`,
            borderRadius: 10, padding: "10px 12px", fontSize: 12.5, lineHeight: 1.6,
          }}>
            {!calc ? (
              <span style={{ color: "var(--text-muted)" }}>
                {porHoras
                  ? "Elige el día y el tramo horario para ver cuántas horas son."
                  : "Elige las fechas para ver cuántos días se descuentan."}
              </span>
            ) : porHoras ? (
              <>
                <strong>{Number(calc.horas || 0)} horas</strong> de permiso el {fmtFecha(f.fecha_desde)}.
              </>
            ) : (
              <>
                <strong>{calc.dias} {calc.dias === 1 ? "día" : "días"}</strong>
                {cfg.habiles ? " hábiles" : " corridos"}
                {cfg.habiles && calc.dias_corridos !== calc.dias ? ` (${calc.dias_corridos} corridos)` : ""}
                {cfg.habiles ? " — no se cuentan fines de semana ni feriados legales." : "."}
                {saldoVac && f.tipo === "vacaciones" && (
                  <div style={{ marginTop: 4, color: excede ? "#92400e" : "var(--text-muted)" }}>
                    Saldo de vacaciones: {saldoVac.saldo} días
                    {calc.vacaciones ? ` → quedarían ${calc.vacaciones.saldo_despues}` : ""}
                    {excede ? ". Excede el saldo disponible; queda registrado en la solicitud." : "."}
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        <div style={{ padding: "12px 18px", borderTop: "1px solid var(--border)", display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button className="btn btn-secondary" onClick={onCancelar} disabled={guardando}>Cancelar</button>
          <button className="btn btn-primary" onClick={() => onEnviar(f)} disabled={guardando || !puedeEnviar}>
            {guardando ? "Enviando…" : "Enviar solicitud"}
          </button>
        </div>
      </div>
    </div>
  );
}
