import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Lock, MessageSquarePlus, Send, Save, CircleSlash, Info } from "lucide-react";
import { api } from "../../lib/api";
import { Modal, REL, RelChip, fmtFecha } from "./e360Kit";

/* ============================================================================
   Evaluación 360° — formulario del evaluador
   ----------------------------------------------------------------------------
   Lo abre cada persona desde Mi Ficha. Una nota por competencia (o «No
   aplica»), comentario opcional y las preguntas abiertas. Se puede guardar a
   medias y retomar; al enviar queda cerrado.
============================================================================ */

export default function FormularioE360({ id, onClose, onGuardado, avisar }) {
  const [form, setForm] = useState(null);
  const [error, setError] = useState("");
  const [respuestas, setRespuestas] = useState({});
  const [abiertas, setAbiertas] = useState({});
  const [conComentario, setConComentario] = useState(() => new Set());
  const [guardando, setGuardando] = useState("");
  const [confirmando, setConfirmando] = useState(false);
  const [marcarFaltantes, setMarcarFaltantes] = useState(false);
  const sucio = useRef(false);

  useEffect(() => {
    let vivo = true;
    api.get(`/rrhh/mi/e360/formularios/${id}`)
      .then((f) => {
        if (!vivo) return;
        setForm(f);
        setRespuestas(f.respuestas || {});
        setAbiertas(f.abiertas || {});
        setConComentario(new Set(Object.entries(f.respuestas || {}).filter(([, r]) => r?.comentario).map(([k]) => k)));
      })
      .catch((e) => vivo && setError(e?.message || "No se pudo abrir la evaluación."));
    return () => { vivo = false; };
  }, [id]);

  const editable = Boolean(form?.editable);
  const max = form?.escala?.max || 5;
  const exigeHasta = form?.ciclo?.comentario_obligatorio_hasta || 0;

  const estaRespondida = (c) => {
    const r = respuestas[c.id];
    return Boolean(r && (r.puntaje != null || r.na));
  };
  const faltaComentario = (c) => {
    const r = respuestas[c.id];
    return Boolean(r && r.puntaje != null && r.puntaje <= exigeHasta && !String(r.comentario || "").trim());
  };

  const total = form?.competencias?.length || 0;
  const respondidas = (form?.competencias || []).filter(estaRespondida).length;
  const faltantes = useMemo(() => {
    if (!form) return [];
    const f = [];
    for (const c of form.competencias) {
      if (!estaRespondida(c) || faltaComentario(c)) f.push(c.id);
    }
    for (const p of form.preguntas) {
      if (p.obligatoria && !String(abiertas[p.id] || "").trim()) f.push(p.id);
    }
    return f;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, respuestas, abiertas]);

  const porCategoria = useMemo(() => {
    const grupos = [];
    for (const c of form?.competencias || []) {
      const cat = c.categoria || "";
      let g = grupos.find((x) => x.categoria === cat);
      if (!g) grupos.push((g = { categoria: cat, items: [] }));
      g.items.push(c);
    }
    return grupos;
  }, [form]);

  const setResp = (cid, cambio) => {
    sucio.current = true;
    setRespuestas((p) => ({ ...p, [cid]: { ...(p[cid] || {}), ...cambio } }));
  };

  async function guardar(enviar) {
    setGuardando(enviar ? "enviar" : "borrador");
    try {
      await api.put(`/rrhh/mi/e360/formularios/${id}`, { respuestas, abiertas, enviar });
      sucio.current = false;
      avisar?.({ type: "success", message: enviar ? "Evaluación enviada. ¡Gracias!" : "Borrador guardado." });
      onGuardado?.(enviar);
      if (enviar) onClose?.();
    } catch (e) {
      avisar?.({ type: "error", message: e?.message || "No se pudo guardar." });
    } finally {
      setGuardando("");
      setConfirmando(false);
    }
  }

  function pedirEnvio() {
    if (faltantes.length) {
      setMarcarFaltantes(true);
      avisar?.({ type: "error", message: `Te falta${faltantes.length === 1 ? "" : "n"} ${faltantes.length} respuesta${faltantes.length === 1 ? "" : "s"} para poder enviar.` });
      document.getElementById(`e360-q-${faltantes[0]}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    setConfirmando(true);
  }

  function cerrar() {
    if (editable && sucio.current && !window.confirm("Tienes cambios sin guardar. ¿Cerrar de todos modos?")) return;
    onClose?.();
  }

  if (error) {
    return (
      <Modal titulo="Evaluación 360°" ancho={480} onClose={onClose}
        pie={<button type="button" className="e360-btn e360-btn-sec" onClick={onClose}>Cerrar</button>}>
        <div className="e360-aviso ojo"><Info size={16} /><div>{error}</div></div>
      </Modal>
    );
  }
  if (!form) {
    return <Modal titulo="Evaluación 360°" ancho={480} onClose={onClose}><div className="e360-vacio">Cargando la evaluación…</div></Modal>;
  }

  const esAuto = form.relacion === "auto";
  const nombre = form.evaluado?.nombre || "—";

  return (
    <Modal
      marca
      ancho={820}
      titulo={esAuto ? "Tu autoevaluación" : `Evaluación de ${nombre}`}
      sub={`${form.ciclo.nombre}${form.ciclo.fecha_cierre ? ` · cierra el ${fmtFecha(form.ciclo.fecha_cierre)}` : ""}`}
      onClose={cerrar}
      pie={editable ? (
        <>
          <span style={{ marginRight: "auto", fontSize: 12, color: "var(--e360-ink-2)" }}>
            Puedes guardar y seguir después. Al enviar ya no se puede editar.
          </span>
          <button type="button" className="e360-btn e360-btn-sec" disabled={Boolean(guardando)} onClick={() => guardar(false)}>
            <Save size={14} /> {guardando === "borrador" ? "Guardando…" : "Guardar borrador"}
          </button>
          <button type="button" className="e360-btn e360-btn-pri" disabled={Boolean(guardando)} onClick={pedirEnvio}>
            <Send size={14} /> Enviar evaluación
          </button>
        </>
      ) : (
        <button type="button" className="e360-btn e360-btn-sec" onClick={onClose}>Cerrar</button>
      )}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "8px 16px", flexWrap: "wrap" }}>
        <RelChip relacion={form.relacion} etiqueta={REL[form.relacion]?.comoEvaluador} />
        {form.evaluado?.cargo && !esAuto && (
          <span style={{ fontSize: 12.5, color: "var(--e360-ink-2)" }}>{form.evaluado.cargo}{form.evaluado.area ? ` · ${form.evaluado.area}` : ""}</span>
        )}
        {!editable && <span className="e360-pill enviada"><Check size={12} /> {form.estado === "enviada" ? `Enviada el ${fmtFecha(form.enviada_at)}` : "Ciclo cerrado"}</span>}
      </div>

      {esAuto ? (
        <div className="e360-aviso info"><Info size={16} />
          <div>Evalúate con honestidad: tu autoevaluación se compara con cómo te ven los demás para detectar puntos ciegos y fortalezas que no estás viendo.</div>
        </div>
      ) : form.ciclo.anonimo && form.relacion !== "jefatura" ? (
        <div className="e360-aviso candado"><Lock size={16} />
          <div>
            <b>Tus respuestas son anónimas.</b> {nombre} verá solo promedios y comentarios sin nombre, y únicamente cuando haya al menos {form.ciclo.min_anonimato} respuestas en su grupo.
            Tampoco Recursos Humanos puede ver qué respondió cada persona.
          </div>
        </div>
      ) : (
        <div className="e360-aviso info"><Info size={16} />
          <div>{form.relacion === "jefatura"
            ? `Evalúas como jefatura: ${nombre} verá tus notas y comentarios identificados como «Jefatura».`
            : `Este ciclo no es anónimo: ${nombre} podrá ver quién escribió cada comentario.`}</div>
        </div>
      )}

      {form.ciclo.instrucciones && (
        <div style={{ fontSize: 13, lineHeight: 1.6, color: "#334155", whiteSpace: "pre-wrap" }}>{form.ciclo.instrucciones}</div>
      )}

      <div className="e360-progreso">
        <span>{respondidas} de {total} competencias</span>
        <div className="e360-barra"><i style={{ width: `${total ? (respondidas / total) * 100 : 0}%` }} /></div>
      </div>

      {porCategoria.map((g) => (
        <div key={g.categoria || "_"} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {g.categoria && <div className="e360-categoria">{g.categoria}</div>}
          {g.items.map((c) => {
            const r = respuestas[c.id] || {};
            const lista = estaRespondida(c) && !faltaComentario(c);
            const falta = marcarFaltantes && !lista;
            const verComentario = conComentario.has(c.id) || faltaComentario(c) || Boolean(r.comentario);
            return (
              <div key={c.id} id={`e360-q-${c.id}`} className={`e360-pregunta${lista ? " lista" : ""}${falta ? " falta" : ""}`}>
                <div className="e360-pregunta-titulo">
                  {lista && <Check size={15} style={{ color: "#15803d", flexShrink: 0 }} />}
                  {c.nombre}
                </div>
                {c.descripcion && <div className="e360-pregunta-desc">{c.descripcion}</div>}
                <div className="e360-escala" role="radiogroup" aria-label={c.nombre}>
                  {Array.from({ length: max }, (_, i) => i + 1).map((v) => {
                    const marcada = r.puntaje === v;
                    return (
                      <button key={v} type="button" role="radio" aria-checked={marcada} disabled={!editable}
                        className={`e360-nota${marcada ? " marcada" : ""}`}
                        title={form.escala.etiquetas[v - 1]}
                        onClick={() => setResp(c.id, { puntaje: v, na: false })}>
                        <b>{v}</b>
                        <small>{form.escala.etiquetas[v - 1]}</small>
                      </button>
                    );
                  })}
                  {form.escala.permitir_na && (
                    <button type="button" role="radio" aria-checked={Boolean(r.na)} disabled={!editable}
                      className={`e360-nota na${r.na ? " marcada" : ""}`}
                      title="No tengo cómo evaluar esto: no cuenta en el promedio"
                      onClick={() => setResp(c.id, { puntaje: null, na: true })}>
                      <CircleSlash size={15} />
                      <small style={{ display: "block" }}>No aplica</small>
                    </button>
                  )}
                </div>
                {/* En pantallas angostas los botones van sin texto: la escala se explica aquí. */}
                <div className="e360-escala-pie">
                  {r.puntaje != null
                    ? <b>{r.puntaje} · {form.escala.etiquetas[r.puntaje - 1]}</b>
                    : <span>1 = {form.escala.etiquetas[0]} · {max} = {form.escala.etiquetas[max - 1]}</span>}
                </div>
                <div style={{ marginTop: 10 }}>
                  {verComentario ? (
                    <textarea className="input" rows={2} disabled={!editable} value={r.comentario || ""}
                      placeholder={faltaComentario(c) ? "Explica esta nota con un ejemplo concreto (obligatorio)" : "Un ejemplo concreto ayuda más que un adjetivo (opcional)"}
                      onChange={(e) => setResp(c.id, { comentario: e.target.value })} />
                  ) : editable ? (
                    <button type="button" className="e360-enlace" onClick={() => setConComentario((s) => new Set(s).add(c.id))}>
                      <MessageSquarePlus size={13} /> Agregar comentario
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      ))}

      {form.preguntas.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div className="e360-categoria">Preguntas abiertas</div>
          {form.preguntas.map((p) => {
            const tiene = Boolean(String(abiertas[p.id] || "").trim());
            const falta = marcarFaltantes && p.obligatoria && !tiene;
            return (
              <div key={p.id} id={`e360-q-${p.id}`} className={`e360-pregunta${tiene ? " lista" : ""}${falta ? " falta" : ""}`}>
                <div className="e360-pregunta-titulo">
                  {p.texto}
                  {!p.obligatoria && <span style={{ fontSize: 11.5, fontWeight: 400, color: "var(--e360-ink-3)" }}>opcional</span>}
                </div>
                <textarea className="input" rows={3} style={{ marginTop: 10 }} disabled={!editable} value={abiertas[p.id] || ""}
                  onChange={(e) => { sucio.current = true; setAbiertas((a) => ({ ...a, [p.id]: e.target.value })); }} />
              </div>
            );
          })}
        </div>
      )}

      {confirmando && (
        <Modal titulo="¿Enviar la evaluación?" ancho={440} onClose={() => setConfirmando(false)}
          pie={<>
            <button type="button" className="e360-btn e360-btn-sec" onClick={() => setConfirmando(false)}>Seguir revisando</button>
            <button type="button" className="e360-btn e360-btn-pri" disabled={Boolean(guardando)} onClick={() => guardar(true)}>
              <Send size={14} /> {guardando === "enviar" ? "Enviando…" : "Sí, enviar"}
            </button>
          </>}>
          <div style={{ fontSize: 13.5, lineHeight: 1.6 }}>
            Una vez enviada no podrás modificar tus respuestas{esAuto ? "" : ` sobre ${nombre}`}. Si después necesitas corregir algo, Recursos Humanos puede reabrirla mientras el ciclo siga en curso.
          </div>
        </Modal>
      )}
    </Modal>
  );
}
