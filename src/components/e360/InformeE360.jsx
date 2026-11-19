import { useMemo, useState } from "react";
import {
  Target, Users, Eye, EyeOff, Sparkles, TrendingUp, MessageSquareText, Lock, ArrowUp, ArrowDown,
  Minus, ClipboardList, Plus, Trash2, CheckCircle2, Radar as RadarIcon, UserRound, Save,
} from "lucide-react";
import DropdownSelect from "../ui/DropdownSelect";
import {
  Modal, Calor, NivelPill, RelChip, Radar, COLOR_GRUPO, fmtFecha, fmtNota, fmtPct, fmtValorObjetivo,
} from "./e360Kit";

/* ============================================================================
   Evaluación 360° — informe individual
   ----------------------------------------------------------------------------
   Una sola vista para tres lectores:
   · modo "admin"  → RR.HH.: además escribe la retroalimentación y el plan.
   · modo "propio" → el evaluado, con el ciclo publicado: puede dejar su acuse.
   · modo "equipo" → la jefatura directa, si el ciclo lo permite.
   Los números ya vienen calculados y anonimizados desde el backend.
============================================================================ */

const ESTADOS_PLAN = [
  { value: "pendiente", label: "Pendiente", color: "#94a3b8" },
  { value: "en_curso", label: "En curso", color: "#f59e0b" },
  { value: "cumplida", label: "Cumplida", color: "#16a34a" },
];

function Brecha({ valor, umbral }) {
  if (valor === null || valor === undefined) return <span style={{ color: "var(--e360-ink-3)" }}>—</span>;
  const fuerte = Math.abs(valor) >= umbral;
  const Icono = valor > 0.049 ? ArrowUp : valor < -0.049 ? ArrowDown : Minus;
  return (
    <span className="e360-brecha" style={{ fontWeight: fuerte ? 700 : 500, color: fuerte ? "var(--e360-ink)" : "var(--e360-ink-2)" }}
      title={valor > 0 ? "Se evalúa más alto de lo que lo ven los demás" : valor < 0 ? "Los demás lo ven mejor de lo que se evalúa" : "Coinciden"}>
      <Icono size={12} />
      {valor > 0 ? "+" : ""}{fmtNota(valor)}
    </span>
  );
}

function Lectura({ icono: Icono, color, titulo, ayuda, items, valor }) {
  return (
    <div className="e360-lectura">
      <h4><Icono size={15} style={{ color }} />{titulo}</h4>
      <p>{ayuda}</p>
      {items.length === 0 ? (
        <div style={{ fontSize: 12, color: "var(--e360-ink-3)" }}>Nada que destacar.</div>
      ) : (
        <ul>{items.map((it) => <li key={it.id}><span>{it.nombre}</span><b>{valor(it)}</b></li>)}</ul>
      )}
    </div>
  );
}

export default function InformeE360({ datos, modo = "admin", onClose, onGuardarCierre, onAcuse }) {
  const { ciclo, empleado, resultado: r, cierre } = datos;
  const max = r.escala.max;
  const umbral = 0.25 * (max - 1);
  const propio = modo === "propio";
  const admin = modo === "admin";

  const [retro, setRetro] = useState(cierre?.retro_rrhh || "");
  const [plan, setPlan] = useState(() => (cierre?.plan_desarrollo || []).map((p) => ({ ...p })));
  const [guardando, setGuardando] = useState(false);
  const [comentarioAcuse, setComentarioAcuse] = useState("");

  const gruposTabla = r.grupos.filter((g) => g.clave !== "auto" && g.visible);
  // Las competencias que a esta persona nadie le respondió (ej. las de liderazgo
  // para quien no tiene equipo) no se listan.
  const conDatos = r.competencias.filter((c) => c.n > 0);
  const ejes = conDatos.filter((c) => c.auto !== null || c.otros !== null);
  const hayRadar = ejes.length >= 3;
  const comentariosPorComp = useMemo(() => {
    const m = new Map();
    for (const c of r.comentarios) {
      if (!m.has(c.competencia_id)) m.set(c.competencia_id, []);
      m.get(c.competencia_id).push(c);
    }
    return m;
  }, [r.comentarios]);
  const hayAbiertas = r.abiertas.some((q) => q.respuestas.length);
  const sinDatos = r.respuestas.enviadas === 0 && r.objetivos.medidos === 0;

  async function guardarCierre() {
    setGuardando(true);
    try { await onGuardarCierre?.({ retro_rrhh: retro, plan_desarrollo: plan }); }
    finally { setGuardando(false); }
  }
  async function acusar() {
    setGuardando(true);
    try { await onAcuse?.(comentarioAcuse); }
    finally { setGuardando(false); }
  }
  const setFila = (i, cambio) => setPlan((p) => p.map((x, k) => (k === i ? { ...x, ...cambio } : x)));

  return (
    <Modal
      marca
      ancho={1060}
      titulo={propio ? "Mi informe 360°" : `Informe 360° · ${empleado.nombre}`}
      sub={`${ciclo.nombre}${ciclo.periodo ? ` · ${ciclo.periodo}` : ""}${empleado.cargo && !propio ? ` · ${empleado.cargo}` : ""}`}
      onClose={onClose}
      pie={admin ? (
        <>
          <span style={{ marginRight: "auto", fontSize: 12, color: "var(--e360-ink-2)" }}>
            {ciclo.estado === "publicado" ? "El ciclo está publicado: el trabajador ve este informe en Mi Ficha." : "El trabajador verá este informe cuando publiques el ciclo."}
          </span>
          <button type="button" className="e360-btn e360-btn-sec" onClick={onClose}>Cerrar</button>
          <button type="button" className="e360-btn e360-btn-pri" disabled={guardando} onClick={guardarCierre}>
            <Save size={14} /> {guardando ? "Guardando…" : "Guardar retroalimentación y plan"}
          </button>
        </>
      ) : (
        <button type="button" className="e360-btn e360-btn-sec" onClick={onClose}>Cerrar</button>
      )}
    >
      {sinDatos ? (
        <div className="e360-vacio"><b>Todavía no hay respuestas enviadas</b>El informe se arma a medida que los evaluadores envían sus formularios.</div>
      ) : (
        <>
          {/* Nota final */}
          <div className="e360-nota-final">
            <div className="e360-nota-hero">
              <span className="rotulo">Resultado final</span>
              <span className="cifra">{r.porcentaje_final === null ? "—" : fmtNota(r.porcentaje_final, 0)}<small> %</small></span>
              <span className="equiv">Equivale a {fmtNota(r.puntaje_final)} de {max}</span>
              <NivelPill nivel={r.nivel} />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
              <div className="e360-tiles">
                <div className="e360-tile">
                  <div className="rotulo"><RadarIcon size={13} />Competencias</div>
                  <div className="valor">{fmtNota(r.puntaje_competencias)}<small> / {max}</small></div>
                  <div className="pie">{fmtPct(r.porcentaje_competencias, 1)} · pesa {r.pesos.competencias}</div>
                </div>
                <div className="e360-tile">
                  <div className="rotulo"><Target size={13} />Objetivos</div>
                  <div className="valor">{r.porcentaje_objetivos === null ? "—" : fmtNota(r.porcentaje_objetivos, 0)}<small> %</small></div>
                  <div className="pie">{r.objetivos.medidos} de {r.objetivos.total} medidos · pesa {r.pesos.objetivos}</div>
                </div>
                <div className="e360-tile">
                  <div className="rotulo"><UserRound size={13} />Autoevaluación</div>
                  <div className="valor">{fmtNota(r.puntaje_auto)}<small> / {max}</small></div>
                  <div className="pie">cómo {propio ? "te ves" : "se ve"}</div>
                </div>
                <div className="e360-tile">
                  <div className="rotulo"><Users size={13} />Evaluadores</div>
                  <div className="valor">{fmtNota(r.puntaje_otros)}<small> / {max}</small></div>
                  <div className="pie">cómo {propio ? "te" : "lo"} ven · {r.respuestas.enviadas} de {r.respuestas.total} respuestas</div>
                </div>
              </div>
              <div className="e360-leyenda" style={{ padding: "2px 2px 0" }}>
                {r.grupos.map((g) => (
                  <span key={g.clave} style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                    <RelChip relacion={g.clave} etiqueta={g.etiqueta} n={g.n} />
                    {g.visible ? <b style={{ fontSize: 12.5 }}>{fmtNota(g.promedio)}</b> : <Lock size={12} style={{ color: "var(--e360-ink-3)" }} />}
                  </span>
                ))}
              </div>
              {r.respuestas.protegidas > 0 && (
                <div className="e360-aviso candado"><Lock size={15} />
                  <div>
                    {r.respuestas.protegidas === 1 ? "Hay 1 respuesta que cuenta" : `Hay ${r.respuestas.protegidas} respuestas que cuentan`} en la nota pero no se desglosa{r.respuestas.protegidas === 1 ? "" : "n"} ni se muestran sus comentarios:
                    el ciclo es anónimo y exige al menos {r.min_anonimato} respuestas por grupo para no delatar a quien respondió.
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Competencias */}
          {r.competencias.length > 0 && r.respuestas.enviadas > 0 && (
            <>
              <h3 className="e360-seccion-titulo"><RadarIcon size={16} />Competencias</h3>
              <div className={hayRadar ? "e360-dos" : undefined}>
                {hayRadar && (
                  <div className="e360-card" style={{ padding: "12px 8px 14px" }}>
                    <Radar ejes={ejes} max={max} series={[
                      { campo: "otros", nombre: "Evaluadores", color: COLOR_GRUPO.otros, relleno: 0.12 },
                      { campo: "auto", nombre: "Autoevaluación", color: COLOR_GRUPO.auto, relleno: 0.06 },
                    ]} />
                  </div>
                )}
                <div className="e360-card e360-tabla-wrap">
                  <table className="e360-tabla compacta cab-flexible">
                    <thead>
                      <tr>
                        <th>Competencia</th>
                        <th className="centro">Auto</th>
                        {gruposTabla.map((g) => <th key={g.clave} className="centro" style={{ maxWidth: 104 }}>{g.etiqueta}</th>)}
                        <th className="centro">Resultado</th>
                        <th className="num" title="Autoevaluación menos el promedio de los evaluadores">Brecha</th>
                      </tr>
                    </thead>
                    <tbody>
                      {conDatos.map((c) => (
                        <tr key={c.id}>
                          <td>
                            <div style={{ fontWeight: 600, color: "var(--e360-ink)" }}>{c.nombre}</div>
                            {c.categoria && <div style={{ fontSize: 11.5, color: "var(--e360-ink-3)" }}>{c.categoria}</div>}
                          </td>
                          <td className="centro"><Calor valor={c.auto} max={max} /></td>
                          {gruposTabla.map((g) => <td key={g.clave} className="centro"><Calor valor={c.por_grupo[g.clave]} max={max} /></td>)}
                          <td className="centro"><Calor valor={c.promedio} max={max} titulo="Promedio ponderado por tipo de evaluador" /></td>
                          <td className="num"><Brecha valor={c.brecha} umbral={umbral} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="e360-lecturas">
                <Lectura icono={Sparkles} color="#15803d" titulo="Fortalezas" ayuda="Lo mejor evaluado por los demás."
                  items={r.fortalezas} valor={(it) => fmtNota(it.valor)} />
                <Lectura icono={TrendingUp} color="#b45309" titulo="Oportunidades" ayuda="Donde hay más espacio para crecer."
                  items={r.oportunidades} valor={(it) => fmtNota(it.valor)} />
                <Lectura icono={EyeOff} color="#b91c1c" titulo="Puntos ciegos" ayuda="Se evalúa bastante más alto de lo que lo ven."
                  items={r.puntos_ciegos} valor={(it) => `+${fmtNota(it.brecha)}`} />
                <Lectura icono={Eye} color="#1d4ed8" titulo="Fortalezas ocultas" ayuda="Los demás lo ven mejor de lo que se evalúa."
                  items={r.fortalezas_ocultas} valor={(it) => fmtNota(it.brecha)} />
              </div>
            </>
          )}

          {/* Objetivos */}
          {r.objetivos.total > 0 && (
            <>
              <h3 className="e360-seccion-titulo"><Target size={16} />Objetivos del período</h3>
              <div className="e360-card e360-card-cuerpo">
                {r.objetivos.items.map((o) => {
                  const pct = o.cumplimiento;
                  return (
                    <div className="e360-obj" key={o.id}>
                      <div style={{ minWidth: 0 }}>
                        <div className="e360-obj-titulo">{o.titulo}</div>
                        <div className="e360-obj-meta">
                          {o.indicador ? `${o.indicador} · ` : ""}
                          {o.unidad === "si_no" ? "Se cumple o no" : `Meta ${fmtValorObjetivo(o.meta, o.unidad)}${o.sentido === "menor" ? " o menos" : ""}`}
                          {" · "}Real {fmtValorObjetivo(o.valor_real, o.unidad)} · peso {fmtNota(o.peso, 0)}
                        </div>
                        {o.comentario && <div className="e360-obj-meta" style={{ fontStyle: "italic" }}>{o.comentario}</div>}
                      </div>
                      <div className="e360-medidor-celda">
                        {/* Medidor con tope en 120 %: la marca negra es la meta (100 %). */}
                        <div className="e360-medidor" title={pct === null ? "Sin medir" : `${fmtPct(pct, 1)} de la meta`}>
                          <i style={{ width: `${pct === null ? 0 : Math.min(100, (pct / 120) * 100)}%` }} />
                          <em style={{ left: `${(100 / 120) * 100}%` }} />
                        </div>
                      </div>
                      <div style={{ textAlign: "right", fontWeight: 700, fontSize: 14, fontVariantNumeric: "tabular-nums" }}>
                        {pct === null ? <span style={{ fontWeight: 400, fontSize: 12, color: "var(--e360-ink-3)" }}>sin medir</span> : fmtPct(pct, 0)}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {/* Comentarios */}
          {(r.comentarios.length > 0 || hayAbiertas) && (
            <>
              <h3 className="e360-seccion-titulo"><MessageSquareText size={16} />Comentarios</h3>
              <div className="e360-card e360-card-cuerpo" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                {r.abiertas.filter((q) => q.respuestas.length).map((q) => (
                  <div key={q.id}>
                    <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>{q.texto}</div>
                    {q.respuestas.map((x, i) => (
                      <div className="e360-comentario" key={i} style={{ borderLeftColor: COLOR_GRUPO[x.grupo] }}>
                        <div className="quien"><RelChip relacion={x.grupo} etiqueta={x.autor ? `${x.autor} · ${x.etiqueta}` : x.etiqueta} /></div>
                        {x.texto}
                      </div>
                    ))}
                  </div>
                ))}
                {r.competencias.filter((c) => comentariosPorComp.has(c.id)).map((c) => (
                  <div key={c.id}>
                    <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>{c.nombre}</div>
                    {comentariosPorComp.get(c.id).map((x, i) => (
                      <div className="e360-comentario" key={i} style={{ borderLeftColor: COLOR_GRUPO[x.grupo] }}>
                        <div className="quien"><RelChip relacion={x.grupo} etiqueta={x.autor ? `${x.autor} · ${x.etiqueta}` : x.etiqueta} /></div>
                        {x.texto}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}

      {/* Cierre: retroalimentación, plan de desarrollo y acuse */}
      <h3 className="e360-seccion-titulo"><ClipboardList size={16} />Retroalimentación y plan de desarrollo</h3>
      <div className="e360-card e360-card-cuerpo" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {admin ? (
          <div className="e360-campo">
            <label>Síntesis para la conversación de cierre</label>
            <textarea className="input" rows={3} value={retro} onChange={(e) => setRetro(e.target.value)}
              placeholder="Lo más importante del informe, en palabras simples: qué se reconoce y en qué se va a trabajar." />
          </div>
        ) : cierre?.retro_rrhh ? (
          <div style={{ fontSize: 13.5, lineHeight: 1.65, whiteSpace: "pre-wrap", color: "#334155" }}>{cierre.retro_rrhh}</div>
        ) : (
          <div style={{ fontSize: 12.5, color: "var(--e360-ink-3)" }}>Recursos Humanos todavía no agrega una síntesis.</div>
        )}

        <div>
          <div className="e360-label" style={{ marginBottom: 6 }}>Plan de desarrollo</div>
          {plan.length === 0 && !admin && <div style={{ fontSize: 12.5, color: "var(--e360-ink-3)" }}>Sin acciones comprometidas todavía.</div>}
          {plan.length > 0 && (
            <div className="e360-tabla-wrap">
              <table className="e360-tabla">
                <thead><tr><th>Acción</th><th style={{ width: 150 }}>Plazo</th><th style={{ width: 170 }}>Responsable</th><th style={{ width: 150 }}>Estado</th>{admin && <th style={{ width: 40 }} />}</tr></thead>
                <tbody>
                  {plan.map((p, i) => admin ? (
                    <tr key={i}>
                      <td><input className="input" value={p.accion || ""} placeholder="Ej: Curso de negociación" onChange={(e) => setFila(i, { accion: e.target.value })} /></td>
                      <td><input className="input" type="date" value={p.plazo || ""} onChange={(e) => setFila(i, { plazo: e.target.value })} /></td>
                      <td><input className="input" value={p.responsable || ""} placeholder="Quién acompaña" onChange={(e) => setFila(i, { responsable: e.target.value })} /></td>
                      <td><DropdownSelect value={p.estado || "pendiente"} onChange={(v) => setFila(i, { estado: v })} options={ESTADOS_PLAN} minWidth={150} /></td>
                      <td><button type="button" className="e360-icono peligro" title="Quitar" onClick={() => setPlan((x) => x.filter((_, k) => k !== i))}><Trash2 size={14} /></button></td>
                    </tr>
                  ) : (
                    <tr key={i}>
                      <td style={{ fontWeight: 600, color: "var(--e360-ink)" }}>{p.accion}</td>
                      <td>{fmtFecha(p.plazo)}</td>
                      <td>{p.responsable || "—"}</td>
                      <td><span className={`e360-pill ${p.estado === "cumplida" ? "enviada" : p.estado === "en_curso" ? "en_progreso" : "pendiente"}`}>{ESTADOS_PLAN.find((x) => x.value === p.estado)?.label || "Pendiente"}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {admin && (
            <button type="button" className="e360-btn e360-btn-sec e360-btn-sm" style={{ marginTop: 8 }}
              onClick={() => setPlan((p) => [...p, { accion: "", plazo: "", responsable: "", estado: "pendiente" }])}>
              <Plus size={13} /> Agregar acción
            </button>
          )}
        </div>

        {cierre?.acuse_at ? (
          <div className="e360-aviso ok"><CheckCircle2 size={16} />
            <div>
              <b>{propio ? "Confirmaste" : `${empleado.nombre} confirmó`} haber revisado el informe el {fmtFecha(cierre.acuse_at)}.</b>
              {cierre.comentario_evaluado && <div style={{ marginTop: 3, whiteSpace: "pre-wrap" }}>«{cierre.comentario_evaluado}»</div>}
            </div>
          </div>
        ) : propio ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div className="e360-campo">
              <label>¿Quieres dejar un comentario sobre tu informe? (opcional)</label>
              <textarea className="input" rows={2} value={comentarioAcuse} onChange={(e) => setComentarioAcuse(e.target.value)} />
            </div>
            <button type="button" className="e360-btn e360-btn-pri" style={{ alignSelf: "flex-start" }} disabled={guardando} onClick={acusar}>
              <CheckCircle2 size={14} /> {guardando ? "Guardando…" : "Confirmo que revisé mi informe"}
            </button>
          </div>
        ) : admin && ciclo.estado === "publicado" ? (
          <div style={{ fontSize: 12.5, color: "var(--e360-ink-3)" }}>El trabajador todavía no confirma que revisó su informe.</div>
        ) : null}
      </div>
    </Modal>
  );
}
