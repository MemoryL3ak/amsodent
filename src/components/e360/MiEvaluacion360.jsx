import { useState } from "react";
import { Orbit, PenLine, Eye, Target, Users, FileBarChart2, CheckCircle2, CalendarClock, Lock, History } from "lucide-react";
import { api } from "../../lib/api";
import FormularioE360 from "./FormularioE360";
import InformeE360 from "./InformeE360";
import { REL, RelChip, Persona, PillEstado, Avance, ESTADOS_FORM, fmtFecha, fmtPct, fmtValorObjetivo, diasPara } from "./e360Kit";

/* ============================================================================
   Evaluación 360° — sección de Mi Ficha
   ----------------------------------------------------------------------------
   Lo que le toca a cada persona: los formularios que debe responder, sus
   objetivos del período, su informe cuando RR.HH. lo publica y —si el ciclo lo
   permite— los informes de su equipo directo.
============================================================================ */

function Bloque({ icono: Icono, titulo, sub, children }) {
  return (
    <div className="e360-card">
      <div className="e360-card-cab">
        <div>
          <div className="e360-card-titulo"><Icono size={16} />{titulo}</div>
          {sub && <div className="e360-card-sub">{sub}</div>}
        </div>
      </div>
      {children}
    </div>
  );
}

export default function MiEvaluacion360({ datos, recargar, avisar }) {
  const [formulario, setFormulario] = useState(null);
  const [informe, setInforme] = useState(null);
  const [abriendo, setAbriendo] = useState("");
  const [verHistorial, setVerHistorial] = useState(false);

  if (!datos) return <div className="e360"><div className="e360-card e360-vacio">Cargando tus evaluaciones…</div></div>;

  const { formularios = [], informes = [], objetivos = [], equipo = [] } = datos;
  const abiertos = formularios.filter((f) => f.abierta);
  const historial = formularios.filter((f) => !f.abierta);
  const nada = !formularios.length && !informes.length && !objetivos.length && !equipo.length;

  async function abrirInforme(ruta, modo, clave) {
    setAbriendo(clave);
    try { setInforme({ datos: await api.get(ruta), modo }); }
    catch (e) { avisar?.({ type: "error", message: e?.message || "No se pudo abrir el informe." }); }
    finally { setAbriendo(""); }
  }

  async function acusar(comentario) {
    try {
      await api.post(`/rrhh/mi/e360/informes/${informe.datos.ciclo.id}/acuse`, { comentario });
      avisar?.({ type: "success", message: "Quedó registrado que revisaste tu informe." });
      setInforme(null);
      recargar?.();
    } catch (e) { avisar?.({ type: "error", message: e?.message || "No se pudo registrar." }); }
  }

  // Objetivos agrupados por ciclo.
  const ciclosObj = [];
  for (const o of objetivos) {
    let g = ciclosObj.find((x) => x.ciclo.id === o.ciclo.id);
    if (!g) ciclosObj.push((g = { ciclo: o.ciclo, items: [] }));
    g.items.push(o);
  }

  return (
    <div className="e360">
      {nada && (
        <div className="e360-card e360-vacio">
          <Orbit size={26} style={{ color: "var(--primary)", marginBottom: 6 }} />
          <b>No tienes evaluaciones 360° por ahora</b>
          Cuando Recursos Humanos inicie un ciclo, aquí aparecerán los formularios que te toca responder y, al final, tu informe.
        </div>
      )}

      {abiertos.length > 0 && (
        <Bloque icono={PenLine} titulo={`Por responder (${abiertos.length})`} sub="Puedes guardar un borrador y terminar después. Una vez enviada, la evaluación queda cerrada.">
          <div>
            {abiertos.map((f) => {
              const dias = diasPara(f.ciclo.fecha_cierre);
              return (
                <div className="e360-tarea" key={f.id}>
                  <div className="e360-tarea-info">
                    <Persona nombre={f.relacion === "auto" ? "Tu autoevaluación" : f.evaluado?.nombre} cargo={f.relacion === "auto" ? null : f.evaluado?.cargo} />
                    <div className="e360-tarea-meta">
                      <RelChip relacion={f.relacion} etiqueta={REL[f.relacion]?.comoEvaluador} />
                      <span>{f.ciclo.nombre}</span>
                      {f.ciclo.fecha_cierre && (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: dias !== null && dias <= 3 ? "#b91c1c" : undefined, fontWeight: dias !== null && dias <= 3 ? 700 : 400 }}>
                          <CalendarClock size={12} />
                          {dias < 0 ? "Plazo vencido" : dias === 0 ? "Cierra hoy" : `Cierra el ${fmtFecha(f.ciclo.fecha_cierre)}`}
                        </span>
                      )}
                      {f.ciclo.anonimo && f.relacion !== "auto" && f.relacion !== "jefatura" && (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><Lock size={12} />Anónima</span>
                      )}
                    </div>
                  </div>
                  <div style={{ width: 150 }}><Avance hechos={f.avance.respondidas} total={f.avance.total} fina /></div>
                  <button type="button" className="e360-btn e360-btn-pri" onClick={() => setFormulario(f.id)}>
                    <PenLine size={14} /> {f.estado === "en_progreso" ? "Continuar" : "Responder"}
                  </button>
                </div>
              );
            })}
          </div>
        </Bloque>
      )}

      {informes.length > 0 && (
        <Bloque icono={FileBarChart2} titulo="Mis informes" sub="Cómo te ves, cómo te ven y el cumplimiento de tus objetivos.">
          <div>
            {informes.map((i) => (
              <div className="e360-tarea" key={i.ciclo.id}>
                <div className="e360-tarea-info">
                  <div style={{ fontWeight: 600 }}>{i.ciclo.nombre}</div>
                  <div className="e360-tarea-meta">
                    {i.ciclo.periodo && <span>{i.ciclo.periodo}</span>}
                    <span>Publicado el {fmtFecha(i.publicado_at)}</span>
                    {i.acuse_at
                      ? <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "#166534" }}><CheckCircle2 size={12} />Revisado</span>
                      : <span style={{ color: "#92400e", fontWeight: 700 }}>Pendiente de revisar</span>}
                  </div>
                </div>
                <button type="button" className="e360-btn e360-btn-pri" disabled={abriendo === `i${i.ciclo.id}`}
                  onClick={() => abrirInforme(`/rrhh/mi/e360/informes/${i.ciclo.id}`, "propio", `i${i.ciclo.id}`)}>
                  <Eye size={14} /> {abriendo === `i${i.ciclo.id}` ? "Abriendo…" : "Ver mi informe"}
                </button>
              </div>
            ))}
          </div>
        </Bloque>
      )}

      {ciclosObj.map((g) => (
        <Bloque key={g.ciclo.id} icono={Target} titulo="Mis objetivos" sub={`${g.ciclo.nombre} · los define y mide Recursos Humanos junto a tu jefatura.`}>
          <div className="e360-card-cuerpo">
            {g.items.map((o) => (
              <div className="e360-obj" key={o.id}>
                <div style={{ minWidth: 0 }}>
                  <div className="e360-obj-titulo">{o.titulo}</div>
                  <div className="e360-obj-meta">
                    {o.indicador ? `${o.indicador} · ` : ""}
                    {o.unidad === "si_no" ? "Se cumple o no" : `Meta ${fmtValorObjetivo(o.meta, o.unidad)}${o.sentido === "menor" ? " o menos" : ""}`}
                    {o.valor_real !== null && o.valor_real !== undefined ? ` · Real ${fmtValorObjetivo(o.valor_real, o.unidad)}` : ""}
                  </div>
                </div>
                <div className="e360-medidor-celda">
                  <div className="e360-medidor" title={o.cumplimiento === null ? "Sin medir" : `${fmtPct(o.cumplimiento, 1)} de la meta`}>
                    <i style={{ width: `${o.cumplimiento === null ? 0 : Math.min(100, (o.cumplimiento / 120) * 100)}%` }} />
                    <em style={{ left: `${(100 / 120) * 100}%` }} />
                  </div>
                </div>
                <div style={{ textAlign: "right", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                  {o.cumplimiento === null ? <span style={{ fontWeight: 400, fontSize: 12, color: "var(--e360-ink-3)" }}>sin medir</span> : fmtPct(o.cumplimiento, 0)}
                </div>
              </div>
            ))}
          </div>
        </Bloque>
      ))}

      {equipo.length > 0 && (
        <Bloque icono={Users} titulo="Informes de mi equipo" sub="Los de tus reportes directos, con el mismo anonimato que ven ellos.">
          <div>
            {equipo.map((x) => {
              const clave = `e${x.ciclo.id}-${x.empleado?.id}`;
              return (
                <div className="e360-tarea" key={clave}>
                  <div className="e360-tarea-info">
                    <Persona nombre={x.empleado?.nombre} cargo={x.empleado?.cargo} />
                    <div className="e360-tarea-meta"><span>{x.ciclo.nombre}</span></div>
                  </div>
                  <button type="button" className="e360-btn e360-btn-sec" disabled={abriendo === clave}
                    onClick={() => abrirInforme(`/rrhh/mi/e360/equipo/${x.ciclo.id}/${x.empleado.id}`, "equipo", clave)}>
                    <Eye size={14} /> {abriendo === clave ? "Abriendo…" : "Ver informe"}
                  </button>
                </div>
              );
            })}
          </div>
        </Bloque>
      )}

      {historial.length > 0 && (
        <Bloque icono={History} titulo={`Evaluaciones anteriores (${historial.length})`}>
          {verHistorial ? (
            <div>
              {historial.map((f) => (
                <div className="e360-tarea" key={f.id}>
                  <div className="e360-tarea-info">
                    <div style={{ fontWeight: 600 }}>{f.relacion === "auto" ? "Tu autoevaluación" : f.evaluado?.nombre}</div>
                    <div className="e360-tarea-meta">
                      <RelChip relacion={f.relacion} etiqueta={REL[f.relacion]?.comoEvaluador} />
                      <span>{f.ciclo.nombre}</span>
                      {f.enviada_at && <span>Enviada el {fmtFecha(f.enviada_at)}</span>}
                    </div>
                  </div>
                  <PillEstado estado={f.estado} etiquetas={f.estado === "enviada" ? ESTADOS_FORM : { pendiente: "No respondida", en_progreso: "Quedó a medias" }} />
                  <button type="button" className="e360-btn e360-btn-sec e360-btn-sm" onClick={() => setFormulario(f.id)}><Eye size={13} /> Ver</button>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ padding: "12px 16px" }}>
              <button type="button" className="e360-enlace" onClick={() => setVerHistorial(true)}>Mostrar las {historial.length} evaluaciones ya enviadas o cerradas</button>
            </div>
          )}
        </Bloque>
      )}

      {formulario && (
        <FormularioE360 id={formulario} avisar={avisar} onClose={() => setFormulario(null)} onGuardado={() => recargar?.()} />
      )}
      {informe && (
        <InformeE360 datos={informe.datos} modo={informe.modo} onClose={() => setInforme(null)} onAcuse={acusar} />
      )}
    </div>
  );
}
