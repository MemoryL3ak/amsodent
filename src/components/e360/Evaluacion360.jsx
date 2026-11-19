import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import {
  Orbit, Plus, ArrowLeft, Copy, Trash2, Settings2, Users, Target, Activity, BarChart3, Play, Lock, Unlock,
  Megaphone, Send, RefreshCw, Pencil, ChevronRight, ChevronDown, X, Wand2, Check, AlertTriangle, Info,
  ListChecks, Scale, ShieldCheck, MessageSquareText, Layers, CalendarClock, FileText, Eye, RotateCcw, Save,
  ClipboardCheck, Gauge, Award, Hourglass,
} from "lucide-react";
import { api } from "../../lib/api";
import DropdownSelect from "../ui/DropdownSelect";
import MultiSelect from "../ui/MultiSelect";
import InformeE360 from "./InformeE360";
import {
  Modal, Campo, Interruptor, Persona, RelChip, PillEstado, NivelPill, Avance, Calor, useTooltip,
  RELACIONES, REL, ESTADOS_CICLO, ESTADOS_FORM, FLUJO, PLANTILLAS, UNIDADES, TEXTO_OSCURO_SOBRE,
  configDesdePlantilla, etiquetasEscala, fmtFecha, fmtNota, fmtPct, fmtValorObjetivo, nombreCompleto, nombreCorto, diasPara,
} from "./e360Kit";

/* ============================================================================
   Evaluación 360° — panel de Recursos Humanos
   ----------------------------------------------------------------------------
   Pestaña del panel RR.HH. (solo admin). Un ciclo recorre cuatro estados:
   Borrador (se arma el instrumento y la matriz) → En curso (la gente responde
   desde Mi Ficha) → Cerrado (RR.HH. revisa, mide objetivos y escribe el plan)
   → Publicado (cada evaluado ve su informe).
============================================================================ */

const POR_PAGINA = 10;

function usePaginas(items, porPagina = POR_PAGINA) {
  const [pagina, setPagina] = useState(1);
  const paginas = Math.max(1, Math.ceil(items.length / porPagina));
  const actual = Math.min(pagina, paginas);
  const visibles = items.slice((actual - 1) * porPagina, actual * porPagina);
  return { pagina: actual, paginas, setPagina, visibles, total: items.length };
}

function Paginas({ p, etiqueta = "registros" }) {
  if (p.total <= POR_PAGINA) return null;
  return (
    <div className="e360-paginas">
      <span>{p.total} {etiqueta} · página {p.pagina} de {p.paginas}</span>
      <div style={{ display: "flex", gap: 6 }}>
        <button type="button" className="e360-btn e360-btn-sec e360-btn-sm" disabled={p.pagina <= 1} onClick={() => p.setPagina(p.pagina - 1)}>Anterior</button>
        <button type="button" className="e360-btn e360-btn-sec e360-btn-sm" disabled={p.pagina >= p.paginas} onClick={() => p.setPagina(p.pagina + 1)}>Siguiente</button>
      </div>
    </div>
  );
}

function Confirmar({ titulo, children, etiqueta = "Confirmar", peligro, ocupado, onConfirmar, onCancelar }) {
  return (
    <Modal titulo={titulo} ancho={480} onClose={onCancelar}
      pie={<>
        <button type="button" className="e360-btn e360-btn-sec" onClick={onCancelar} disabled={ocupado}>Cancelar</button>
        <button type="button" className={`e360-btn ${peligro ? "e360-btn-peligro" : "e360-btn-pri"}`} onClick={onConfirmar} disabled={ocupado}>
          {ocupado ? "Un momento…" : etiqueta}
        </button>
      </>}>
      <div style={{ fontSize: 13.5, lineHeight: 1.65, color: "#334155" }}>{children}</div>
    </Modal>
  );
}

function Tarjeta({ icono: Icono, titulo, sub, accion, children, cuerpo = true }) {
  return (
    <div className="e360-card">
      <div className="e360-card-cab">
        <div style={{ minWidth: 0 }}>
          <div className="e360-card-titulo">{Icono && <Icono size={16} />}{titulo}</div>
          {sub && <div className="e360-card-sub">{sub}</div>}
        </div>
        {accion}
      </div>
      {cuerpo ? <div className="e360-card-cuerpo">{children}</div> : children}
    </div>
  );
}

function Kpi({ icono: Icono, label, valor, sub }) {
  return (
    <div className="e360-kpi">
      <div className="e360-kpi-label">{Icono && <Icono size={13} />}{label}</div>
      <div className="e360-kpi-valor">{valor}</div>
      {sub && <div className="e360-kpi-sub">{sub}</div>}
    </div>
  );
}

// ============================================================================
// Raíz: lista de ciclos ↔ detalle de un ciclo
// ============================================================================
export default function Evaluacion360({ empleados = [], notificar }) {
  const avisar = useMemo(() => notificar || (() => {}), [notificar]);
  const [abierto, setAbierto] = useState(null);

  return (
    <div className="e360">
      {abierto ? (
        <CicloDetalle id={abierto} empleados={empleados} avisar={avisar} onVolver={() => setAbierto(null)} />
      ) : (
        <ListaCiclos avisar={avisar} onAbrir={setAbierto} />
      )}
    </div>
  );
}

// ============================================================================
// Lista de ciclos
// ============================================================================
function ListaCiclos({ avisar, onAbrir }) {
  const [ciclos, setCiclos] = useState(null);
  const [error, setError] = useState("");
  const [nuevo, setNuevo] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [borrar, setBorrar] = useState(null);

  const cargar = useCallback(async () => {
    try {
      setCiclos(await api.get("/rrhh/e360/ciclos"));
      setError("");
    } catch (e) {
      setCiclos([]);
      setError(e?.message || "No se pudo cargar Evaluación 360°.");
    }
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  const lista = useMemo(() => ciclos || [], [ciclos]);
  const p = usePaginas(lista);
  const enCurso = lista.filter((c) => c.estado === "activo");
  const formularios = enCurso.reduce((s, c) => s + c.formularios, 0);
  const enviados = enCurso.reduce((s, c) => s + c.enviados, 0);

  async function crear() {
    if (!nuevo?.nombre?.trim()) { avisar({ type: "error", message: "Ponle un nombre al ciclo." }); return; }
    setGuardando(true);
    try {
      const c = await api.post("/rrhh/e360/ciclos", {
        nombre: nuevo.nombre, periodo: nuevo.periodo, fecha_inicio: nuevo.fecha_inicio || null, fecha_cierre: nuevo.fecha_cierre || null,
        config: configDesdePlantilla(nuevo.plantilla),
      });
      setNuevo(null);
      onAbrir(c.id);
    } catch (e) {
      avisar({ type: "error", message: e?.message || "No se pudo crear el ciclo." });
    } finally { setGuardando(false); }
  }

  async function duplicar(c) {
    try {
      const copia = await api.post(`/rrhh/e360/ciclos/${c.id}/duplicar`, {});
      avisar({ type: "success", message: "Ciclo duplicado: se copió el instrumento y los participantes." });
      onAbrir(copia.id);
    } catch (e) { avisar({ type: "error", message: e?.message || "No se pudo duplicar." }); }
  }

  async function eliminar() {
    setGuardando(true);
    try {
      await api.delete(`/rrhh/e360/ciclos/${borrar.id}`);
      setBorrar(null);
      await cargar();
      avisar({ type: "success", message: "Ciclo eliminado." });
    } catch (e) { avisar({ type: "error", message: e?.message || "No se pudo eliminar." }); }
    finally { setGuardando(false); }
  }

  const abrirNuevo = () => setNuevo({
    nombre: "", periodo: `${new Date().getFullYear()}-S${new Date().getMonth() < 6 ? 1 : 2}`,
    fecha_inicio: new Date().toISOString().slice(0, 10), fecha_cierre: "", plantilla: "integral",
  });

  return (
    <>
      <div className="e360-hero">
        <div style={{ position: "relative", zIndex: 1 }}>
          <div className="e360-hero-titulo"><Orbit size={20} />Evaluación 360°</div>
          <div className="e360-hero-sub">
            Cada persona se evalúa a sí misma y recibe la mirada de su jefatura, sus pares y su equipo, junto con el cumplimiento de sus objetivos.
          </div>
        </div>
        <div className="e360-hero-acciones">
          <button type="button" className="e360-btn e360-btn-cristal" onClick={cargar}><RefreshCw size={14} /> Actualizar</button>
          <button type="button" className="e360-btn e360-btn-blanco" onClick={abrirNuevo}><Plus size={15} /> Nuevo ciclo</button>
        </div>
      </div>

      {error && <div className="e360-aviso ojo"><AlertTriangle size={16} /><div>{error}</div></div>}

      {ciclos === null ? (
        <div className="e360-card e360-vacio">Cargando ciclos…</div>
      ) : lista.length === 0 ? (
        !error && (
          <div className="e360-card e360-vacio">
            <b>Todavía no hay ciclos de evaluación</b>
            Un ciclo es una ronda de evaluación (por ejemplo, «Segundo semestre 2026»). Así funciona:
            <div className="e360-pasos-guia">
              <div><div className="n">PASO 1</div><b>Arma el instrumento</b><span>Competencias, escala, preguntas y cuánto pesa cada tipo de evaluador.</span></div>
              <div><div className="n">PASO 2</div><b>Define quién evalúa a quién</b><span>La matriz se sugiere sola desde la jefatura de cada ficha.</span></div>
              <div><div className="n">PASO 3</div><b>El equipo responde</b><span>Cada persona contesta desde Mi Ficha; aquí sigues el avance.</span></div>
              <div><div className="n">PASO 4</div><b>Publica los informes</b><span>Con resultados, brechas, objetivos y plan de desarrollo.</span></div>
            </div>
            <button type="button" className="e360-btn e360-btn-pri" onClick={abrirNuevo}><Plus size={15} /> Crear el primer ciclo</button>
          </div>
        )
      ) : (
        <>
          <div className="e360-kpis">
            <Kpi icono={Activity} label="Ciclos en curso" valor={enCurso.length} sub={`${lista.length} en total`} />
            <Kpi icono={Hourglass} label="Formularios pendientes" valor={formularios - enviados} sub="en los ciclos en curso" />
            <Kpi icono={Gauge} label="Avance de respuestas" valor={formularios ? <>{Math.round((enviados / formularios) * 100)}<small> %</small></> : "—"} sub={formularios ? `${enviados} de ${formularios} enviados` : "sin ciclos en curso"} />
            <Kpi icono={Award} label="Ciclos publicados" valor={lista.filter((c) => c.estado === "publicado").length} sub="con informes entregados" />
          </div>

          <div className="e360-card">
            <div className="e360-tabla-wrap">
              <table className="e360-tabla">
                <thead>
                  <tr><th>Ciclo</th><th>Fechas</th><th>Estado</th><th className="num">Evaluados</th><th style={{ minWidth: 150 }}>Respuestas</th><th /></tr>
                </thead>
                <tbody>
                  {p.visibles.map((c) => (
                    <tr key={c.id} className="clic" onClick={() => onAbrir(c.id)}>
                      <td>
                        <div style={{ fontWeight: 600, color: "var(--e360-ink)" }}>{c.nombre}</div>
                        {c.periodo && <div style={{ fontSize: 11.5, color: "var(--e360-ink-3)" }}>{c.periodo}</div>}
                      </td>
                      <td style={{ whiteSpace: "nowrap" }}>{fmtFecha(c.fecha_inicio)} → {fmtFecha(c.fecha_cierre)}</td>
                      <td><PillEstado estado={c.estado} /></td>
                      <td className="num">{c.evaluados}</td>
                      <td>{c.formularios ? <Avance hechos={c.enviados} total={c.formularios} /> : <span style={{ color: "var(--e360-ink-3)" }}>Sin matriz</span>}</td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <div className="e360-acciones">
                          <button type="button" className="e360-icono" title="Abrir" onClick={() => onAbrir(c.id)}><ChevronRight size={16} /></button>
                          <button type="button" className="e360-icono" title="Duplicar (instrumento y participantes)" onClick={() => duplicar(c)}><Copy size={15} /></button>
                          <button type="button" className="e360-icono peligro" title="Eliminar" onClick={() => setBorrar(c)}><Trash2 size={15} /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Paginas p={p} etiqueta="ciclos" />
          </div>
        </>
      )}

      {nuevo && (
        <Modal titulo="Nuevo ciclo de evaluación" sub="Queda en borrador: nadie recibe nada hasta que lo inicies." ancho={600} onClose={() => setNuevo(null)}
          pie={<>
            <button type="button" className="e360-btn e360-btn-sec" onClick={() => setNuevo(null)}>Cancelar</button>
            <button type="button" className="e360-btn e360-btn-pri" disabled={guardando} onClick={crear}>{guardando ? "Creando…" : "Crear y configurar"}</button>
          </>}>
          <Campo label="Nombre del ciclo">
            <input className="input" autoFocus value={nuevo.nombre} placeholder="Ej: Evaluación 360° segundo semestre 2026"
              onChange={(e) => setNuevo((n) => ({ ...n, nombre: e.target.value }))} />
          </Campo>
          <div className="e360-grid">
            <Campo label="Período"><input className="input" value={nuevo.periodo} onChange={(e) => setNuevo((n) => ({ ...n, periodo: e.target.value }))} /></Campo>
            <Campo label="Inicio"><input className="input" type="date" value={nuevo.fecha_inicio} onChange={(e) => setNuevo((n) => ({ ...n, fecha_inicio: e.target.value }))} /></Campo>
            <Campo label="Cierre de respuestas"><input className="input" type="date" value={nuevo.fecha_cierre} onChange={(e) => setNuevo((n) => ({ ...n, fecha_cierre: e.target.value }))} /></Campo>
          </div>
          <Campo label="Plantilla de competencias" ayuda="Es solo el punto de partida: después puedes cambiar, quitar o agregar lo que quieras.">
            <DropdownSelect value={nuevo.plantilla} onChange={(v) => setNuevo((n) => ({ ...n, plantilla: v }))}
              options={PLANTILLAS.map((x) => ({ value: x.key, label: x.nombre, detalle: x.detalle }))} />
          </Campo>
        </Modal>
      )}

      {borrar && (
        <Confirmar titulo="Eliminar ciclo" etiqueta="Eliminar ciclo" peligro ocupado={guardando} onCancelar={() => setBorrar(null)} onConfirmar={eliminar}>
          Se eliminará <b>{borrar.nombre}</b> con su matriz, sus objetivos
          {borrar.enviados > 0 ? <> y las <b>{borrar.enviados} evaluaciones ya respondidas</b></> : null}. Esta acción no se puede deshacer.
        </Confirmar>
      )}
    </>
  );
}

// ============================================================================
// Detalle del ciclo
// ============================================================================
const TABS = [
  { key: "instrumento", label: "Instrumento", icono: Settings2 },
  { key: "matriz", label: "Participantes y matriz", icono: Users },
  { key: "objetivos", label: "Objetivos", icono: Target },
  { key: "seguimiento", label: "Seguimiento", icono: Activity },
  { key: "resultados", label: "Resultados", icono: BarChart3 },
];

function CicloDetalle({ id, empleados, avisar, onVolver }) {
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("instrumento");
  const [transicion, setTransicion] = useState(null);
  const [ocupado, setOcupado] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const d = await api.get(`/rrhh/e360/ciclos/${id}`);
      setDatos(d);
      setError("");
      return d;
    } catch (e) {
      setError(e?.message || "No se pudo cargar el ciclo.");
      return null;
    }
  }, [id]);

  useEffect(() => {
    cargar().then((d) => {
      if (!d) return;
      // Se abre donde está el trabajo según el estado del ciclo.
      setTab(d.ciclo.estado === "borrador" ? (d.ciclo.config.competencias.length && !d.evaluados.length ? "matriz" : "instrumento")
        : d.ciclo.estado === "activo" ? "seguimiento" : "resultados");
    });
  }, [cargar]);

  const porId = useMemo(() => new Map(empleados.map((e) => [Number(e.id), e])), [empleados]);
  const nombre = useCallback((eid) => (porId.has(Number(eid)) ? nombreCompleto(porId.get(Number(eid))) : `#${eid}`), [porId]);

  if (error && !datos) {
    return (
      <>
        <button type="button" className="e360-btn e360-btn-sec" style={{ alignSelf: "flex-start" }} onClick={onVolver}><ArrowLeft size={14} /> Volver a los ciclos</button>
        <div className="e360-aviso ojo"><AlertTriangle size={16} /><div>{error}</div></div>
      </>
    );
  }
  if (!datos) return <div className="e360-card e360-vacio">Cargando ciclo…</div>;

  const { ciclo, evaluados, asignaciones, objetivos } = datos;
  const enviadas = asignaciones.filter((a) => a.estado === "enviada").length;
  const evaluadores = new Set(asignaciones.map((a) => a.evaluador_id)).size;
  const paso = FLUJO.indexOf(ciclo.estado);

  async function cambiarEstado() {
    setOcupado(true);
    try {
      const r = await api.put(`/rrhh/e360/ciclos/${id}/estado`, { estado: transicion.a });
      const extra = r?.avisados ? ` Se avisó a ${r.avisados} persona${r.avisados === 1 ? "" : "s"} en la campana.` : "";
      avisar({ type: "success", message: `${transicion.hecho}${extra}` });
      setTransicion(null);
      const d = await cargar();
      if (d?.ciclo.estado === "activo") setTab("seguimiento");
      if (d?.ciclo.estado === "cerrado" || d?.ciclo.estado === "publicado") setTab("resultados");
    } catch (e) {
      avisar({ type: "error", message: e?.message || "No se pudo cambiar el estado." });
    } finally { setOcupado(false); }
  }

  const TRANSICIONES = {
    iniciar: {
      a: "activo", titulo: "Iniciar el ciclo", etiqueta: "Iniciar ciclo", hecho: "Ciclo iniciado.",
      cuerpo: <>
        Se abrirán <b>{asignaciones.length} formularios</b> para <b>{evaluadores} evaluadores</b>, que recibirán un aviso en la campana y los encontrarán en <b>Mi Ficha</b>.
        <br /><br />Desde este momento el instrumento queda fijo: competencias, escala, preguntas y anonimato ya no se pueden cambiar.
      </>,
    },
    cerrar: {
      a: "cerrado", titulo: "Cerrar el ciclo", etiqueta: "Cerrar ciclo", hecho: "Ciclo cerrado: ya no se reciben respuestas.",
      cuerpo: <>
        {asignaciones.length - enviadas > 0
          ? <>Quedan <b>{asignaciones.length - enviadas} formularios sin enviar</b>: no entrarán en los resultados.</>
          : <>Todos los formularios están enviados.</>}
        <br /><br />Nadie podrá responder ni editar. Los informes siguen ocultos para los evaluados hasta que los publiques, y puedes reabrir el ciclo si hace falta.
      </>,
    },
    publicar: {
      a: "publicado", titulo: "Publicar los informes", etiqueta: "Publicar informes", hecho: "Informes publicados.",
      cuerpo: <>
        Cada una de las <b>{evaluados.length} personas evaluadas</b> verá su informe en Mi Ficha y recibirá un aviso en la campana.
        {ciclo.config.jefatura_ve_resultados && <><br /><br />Las jefaturas también verán los informes de su equipo directo.</>}
        <br /><br />Revisa antes que estén medidos los objetivos y escrita la retroalimentación de cada persona.
      </>,
    },
    reabrir: { a: "activo", titulo: "Reabrir el ciclo", etiqueta: "Reabrir", hecho: "Ciclo reabierto: se vuelven a recibir respuestas.", cuerpo: <>Los formularios pendientes se podrán responder otra vez. Los ya enviados siguen cerrados (puedes reabrirlos uno a uno en Seguimiento).</> },
    despublicar: { a: "cerrado", titulo: "Retirar la publicación", etiqueta: "Retirar publicación", hecho: "Informes retirados.", peligro: true, cuerpo: <>Los evaluados dejarán de ver su informe en Mi Ficha hasta que vuelvas a publicar.</> },
    borrador: { a: "borrador", titulo: "Volver a borrador", etiqueta: "Volver a borrador", hecho: "El ciclo volvió a borrador.", cuerpo: <>Nadie ha respondido todavía, así que puedes volver a editar el instrumento. Los formularios dejarán de verse en Mi Ficha.</> },
  };
  const pedir = (k) => setTransicion({ ...TRANSICIONES[k] });
  const nadieEmpezo = asignaciones.every((a) => a.estado === "pendiente");

  return (
    <>
      <div className="e360-hero">
        <div style={{ position: "relative", zIndex: 1, minWidth: 0 }}>
          <button type="button" className="e360-btn e360-btn-cristal e360-btn-sm" onClick={onVolver} style={{ marginBottom: 10 }}>
            <ArrowLeft size={13} /> Ciclos
          </button>
          <div className="e360-hero-titulo">{ciclo.nombre}</div>
          <div className="e360-hero-sub">
            {[ciclo.periodo, `${fmtFecha(ciclo.fecha_inicio)} → ${fmtFecha(ciclo.fecha_cierre)}`, `${evaluados.length} evaluados`, asignaciones.length ? `${enviadas} de ${asignaciones.length} formularios enviados` : null]
              .filter(Boolean).join(" · ")}
          </div>
        </div>
        <div className="e360-hero-acciones">
          {ciclo.estado === "borrador" && <button type="button" className="e360-btn e360-btn-blanco" onClick={() => pedir("iniciar")}><Play size={14} /> Iniciar ciclo</button>}
          {ciclo.estado === "activo" && nadieEmpezo && <button type="button" className="e360-btn e360-btn-cristal" onClick={() => pedir("borrador")}><RotateCcw size={14} /> Volver a borrador</button>}
          {ciclo.estado === "activo" && <button type="button" className="e360-btn e360-btn-blanco" onClick={() => pedir("cerrar")}><Lock size={14} /> Cerrar ciclo</button>}
          {ciclo.estado === "cerrado" && <button type="button" className="e360-btn e360-btn-cristal" onClick={() => pedir("reabrir")}><Unlock size={14} /> Reabrir</button>}
          {ciclo.estado === "cerrado" && <button type="button" className="e360-btn e360-btn-blanco" onClick={() => pedir("publicar")}><Megaphone size={14} /> Publicar informes</button>}
          {ciclo.estado === "publicado" && <button type="button" className="e360-btn e360-btn-cristal" onClick={() => pedir("despublicar")}><RotateCcw size={14} /> Retirar publicación</button>}
        </div>
      </div>

      <div className="e360-card" style={{ padding: "12px 16px" }}>
        <div className="e360-flujo">
          {FLUJO.map((e, i) => (
            <Fragment key={e}>
              {i > 0 && <span className={`e360-paso-linea${i <= paso ? " hecha" : ""}`} />}
              <span className={`e360-paso${i < paso ? " hecho" : i === paso ? " actual" : ""}`}>
                <span className="e360-paso-n">{i < paso ? <Check size={13} /> : i + 1}</span>
                {ESTADOS_CICLO[e]}
              </span>
            </Fragment>
          ))}
        </div>
      </div>

      <div className="e360-tabs" role="tablist">
        {TABS.map(({ key, label, icono: Icono }) => (
          <button key={key} type="button" role="tab" aria-selected={tab === key} className={`e360-tab${tab === key ? " activa" : ""}`} onClick={() => setTab(key)}>
            <Icono size={14} /> {label}
            {key === "matriz" && <span className="e360-tab-n">{evaluados.length}</span>}
            {key === "objetivos" && objetivos.length > 0 && <span className="e360-tab-n">{objetivos.length}</span>}
            {key === "seguimiento" && asignaciones.length > 0 && <span className="e360-tab-n">{enviadas}/{asignaciones.length}</span>}
          </button>
        ))}
      </div>

      {tab === "instrumento" && <TabInstrumento ciclo={ciclo} avisar={avisar} recargar={cargar} />}
      {tab === "matriz" && <TabMatriz datos={datos} empleados={empleados} nombre={nombre} porId={porId} avisar={avisar} recargar={cargar} />}
      {tab === "objetivos" && <TabObjetivos datos={datos} nombre={nombre} porId={porId} avisar={avisar} recargar={cargar} />}
      {tab === "seguimiento" && <TabSeguimiento datos={datos} nombre={nombre} porId={porId} avisar={avisar} recargar={cargar} />}
      {tab === "resultados" && <TabResultados datos={datos} avisar={avisar} />}

      {transicion && (
        <Confirmar titulo={transicion.titulo} etiqueta={transicion.etiqueta} peligro={transicion.peligro} ocupado={ocupado}
          onCancelar={() => setTransicion(null)} onConfirmar={cambiarEstado}>
          {transicion.cuerpo}
        </Confirmar>
      )}
    </>
  );
}

// ============================================================================
// Instrumento
// ============================================================================
function TabInstrumento({ ciclo, avisar, recargar }) {
  const [f, setF] = useState(() => ({
    nombre: ciclo.nombre || "", periodo: ciclo.periodo || "", fecha_inicio: ciclo.fecha_inicio || "", fecha_cierre: ciclo.fecha_cierre || "",
    descripcion: ciclo.descripcion || "", instrucciones: ciclo.instrucciones || "", config: structuredClone(ciclo.config),
  }));
  const [guardando, setGuardando] = useState(false);
  const [sucio, setSucio] = useState(false);
  const [plantilla, setPlantilla] = useState(null);
  const fijo = ciclo.estado !== "borrador";
  const cfg = f.config;
  const max = cfg.escala.max;

  const set = (cambio) => { setF((p) => ({ ...p, ...cambio })); setSucio(true); };
  const setCfg = (cambio) => { setF((p) => ({ ...p, config: { ...p.config, ...cambio } })); setSucio(true); };
  const setComp = (i, cambio) => setCfg({ competencias: cfg.competencias.map((c, k) => (k === i ? { ...c, ...cambio } : c)) });
  const setPreg = (i, cambio) => setCfg({ preguntas: cfg.preguntas.map((q, k) => (k === i ? { ...q, ...cambio } : q)) });
  const setNivel = (i, cambio) => setCfg({ niveles: cfg.niveles.map((n, k) => (k === i ? { ...n, ...cambio } : n)) });

  async function guardar() {
    setGuardando(true);
    try {
      const guardado = await api.post("/rrhh/e360/ciclos", { id: ciclo.id, ...f, fecha_inicio: f.fecha_inicio || null, fecha_cierre: f.fecha_cierre || null });
      // Lo guardado vuelve con los ids definitivos de competencias y preguntas.
      if (guardado?.config) setF((p) => ({ ...p, config: structuredClone(guardado.config) }));
      setSucio(false);
      await recargar();
      avisar({ type: "success", message: "Instrumento guardado." });
    } catch (e) {
      avisar({ type: "error", message: e?.message || "No se pudo guardar." });
    } finally { setGuardando(false); }
  }

  function aplicarPlantilla(modo) {
    const p = configDesdePlantilla(plantilla);
    const base = modo === "agregar" ? cfg.competencias : [];
    const nombres = new Set(base.map((c) => c.nombre.toLowerCase()));
    const nuevas = p.competencias.filter((c) => !nombres.has(c.nombre.toLowerCase())).map((c) => ({ ...c, id: undefined }));
    setCfg({ competencias: [...base, ...nuevas], preguntas: modo === "agregar" ? cfg.preguntas : p.preguntas.map((q) => ({ ...q, id: undefined })) });
    setPlantilla(null);
  }

  const pesoTotalComp = cfg.competencias.reduce((s, c) => s + (Number(c.peso) || 0), 0) || 1;
  const pesoTotalRel = RELACIONES.reduce((s, r) => s + (Number(cfg.pesos_relacion[r.key]) || 0), 0);

  return (
    <>
      {fijo && (
        <div className="e360-aviso candado"><Lock size={16} />
          <div>
            <b>El instrumento está fijo porque el ciclo ya partió.</b> Competencias, escala, preguntas y anonimato no se pueden cambiar con gente respondiendo.
            Sí puedes ajustar los datos del ciclo, las ponderaciones y los niveles: los resultados se recalculan al instante.
          </div>
        </div>
      )}

      <Tarjeta icono={FileText} titulo="Datos del ciclo">
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <Campo label="Nombre"><input className="input" value={f.nombre} onChange={(e) => set({ nombre: e.target.value })} /></Campo>
          <div className="e360-grid">
            <Campo label="Período"><input className="input" value={f.periodo} placeholder="2026-S2" onChange={(e) => set({ periodo: e.target.value })} /></Campo>
            <Campo label="Inicio"><input className="input" type="date" value={f.fecha_inicio} onChange={(e) => set({ fecha_inicio: e.target.value })} /></Campo>
            <Campo label="Cierre de respuestas"><input className="input" type="date" value={f.fecha_cierre} onChange={(e) => set({ fecha_cierre: e.target.value })} /></Campo>
          </div>
          <Campo label="Instrucciones para quien evalúa" ayuda="Aparecen arriba de cada formulario.">
            <textarea className="input" rows={2} value={f.instrucciones} placeholder="Ej: Piensa en los últimos seis meses. Evalúa lo que has visto directamente; si no tienes cómo saberlo, marca «No aplica»."
              onChange={(e) => set({ instrucciones: e.target.value })} />
          </Campo>
          <Campo label="Notas internas (solo RR.HH.)">
            <textarea className="input" rows={2} value={f.descripcion} onChange={(e) => set({ descripcion: e.target.value })} />
          </Campo>
        </div>
      </Tarjeta>

      <Tarjeta icono={ListChecks} titulo={`Competencias (${cfg.competencias.length})`}
        sub="Cada una se evalúa con la escala. El peso define cuánto influye en la nota; «quién la responde» permite preguntar algo solo a cierto tipo de evaluador."
        accion={!fijo && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <DropdownSelect value="" onChange={(v) => v && setPlantilla(v)} minWidth={250} style={{ width: 190 }} placeholder="Cargar plantilla…"
              options={PLANTILLAS.filter((x) => x.key !== "vacia").map((x) => ({ value: x.key, label: x.nombre, detalle: x.detalle }))} />
            <button type="button" className="e360-btn e360-btn-sec" onClick={() => setCfg({ competencias: [...cfg.competencias, { nombre: "", descripcion: "", categoria: "", peso: 1, relaciones: null }] })}>
              <Plus size={14} /> Competencia
            </button>
          </div>
        )}>
        {cfg.competencias.length === 0 ? (
          <div className="e360-vacio" style={{ padding: 18 }}>Sin competencias. Carga una plantilla o agrégalas una a una.</div>
        ) : (
          <div className="e360-lista">
            {cfg.competencias.map((c, i) => (
              <div className="e360-comp" key={c.id || `n${i}`}>
                <div className="e360-comp-fila">
                  <Campo label={i === 0 ? "Competencia" : null}><input className="input" disabled={fijo} value={c.nombre} placeholder="Nombre de la competencia" onChange={(e) => setComp(i, { nombre: e.target.value })} /></Campo>
                  <div className="cat"><Campo label={i === 0 ? "Categoría" : null}><input className="input" disabled={fijo} value={c.categoria || ""} placeholder="Ej: Resultados" onChange={(e) => setComp(i, { categoria: e.target.value })} /></Campo></div>
                  <Campo label={i === 0 ? "Peso" : null}>
                    <input className="input" type="number" min="0.5" step="0.5" disabled={fijo} value={c.peso} title={`${Math.round(((Number(c.peso) || 0) / pesoTotalComp) * 100)} % de la nota de competencias`}
                      onChange={(e) => setComp(i, { peso: e.target.value })} />
                  </Campo>
                  <div className="quien"><Campo label={i === 0 ? "Quién la responde" : null}>
                    <MultiSelect disabled={fijo} value={c.relaciones || []} placeholder="Todos" minWidth={220}
                      options={RELACIONES.map((r) => ({ value: r.key, label: r.label }))}
                      resumen={(el) => (el.length === 0 || el.length === RELACIONES.length ? "Todos" : el.map((o) => REL[o.value].corto).join(", "))}
                      onChange={(v) => setComp(i, { relaciones: v.length && v.length < RELACIONES.length ? v : null })} />
                  </Campo></div>
                  <button type="button" className="e360-icono peligro" disabled={fijo} title="Quitar competencia" style={{ marginBottom: 3 }}
                    onClick={() => setCfg({ competencias: cfg.competencias.filter((_, k) => k !== i) })}><Trash2 size={15} /></button>
                </div>
                <input className="input" disabled={fijo} value={c.descripcion || ""} placeholder="Qué se observa: una frase que ayude a evaluar con el mismo criterio"
                  onChange={(e) => setComp(i, { descripcion: e.target.value })} />
              </div>
            ))}
          </div>
        )}
      </Tarjeta>

      <div className="e360-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 16, alignItems: "start" }}>
        <Tarjeta icono={Layers} titulo="Escala de evaluación">
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <Campo label="Puntos de la escala">
              <DropdownSelect disabled={fijo} value={max} options={[3, 4, 5, 7, 10].map((n) => ({ value: n, label: `1 a ${n}` }))}
                onChange={(v) => setCfg({ escala: { ...cfg.escala, max: Number(v), etiquetas: etiquetasEscala(Number(v)) } })} />
            </Campo>
            <div className="e360-lista" style={{ gap: 6 }}>
              {cfg.escala.etiquetas.map((et, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <Calor valor={i + 1} max={max} dec={0} />
                  <input className="input" disabled={fijo} value={et} onChange={(e) => setCfg({ escala: { ...cfg.escala, etiquetas: cfg.escala.etiquetas.map((x, k) => (k === i ? e.target.value : x)) } })} />
                </div>
              ))}
            </div>
            <Interruptor disabled={fijo} checked={cfg.escala.permitir_na} onChange={(v) => setCfg({ escala: { ...cfg.escala, permitir_na: v } })}
              titulo="Permitir «No aplica»" detalle="Para cuando el evaluador no tiene cómo saberlo. No cuenta en el promedio." />
            <Campo label="Exigir comentario en las notas bajas">
              <DropdownSelect disabled={fijo} value={cfg.comentario_obligatorio_hasta}
                options={[{ value: 0, label: "No exigir" }, ...Array.from({ length: Math.max(1, Math.floor(max / 2)) }, (_, i) => ({ value: i + 1, label: `En notas de ${i + 1} o menos` }))]}
                onChange={(v) => setCfg({ comentario_obligatorio_hasta: Number(v) })} />
            </Campo>
          </div>
        </Tarjeta>

        <Tarjeta icono={MessageSquareText} titulo="Preguntas abiertas"
          accion={!fijo && <button type="button" className="e360-btn e360-btn-sec e360-btn-sm" onClick={() => setCfg({ preguntas: [...cfg.preguntas, { texto: "", obligatoria: false }] })}><Plus size={13} /> Pregunta</button>}>
          {cfg.preguntas.length === 0 ? (
            <div style={{ fontSize: 12.5, color: "var(--e360-ink-3)" }}>Sin preguntas abiertas: el formulario tendrá solo las notas y sus comentarios.</div>
          ) : (
            <div className="e360-lista">
              {cfg.preguntas.map((q, i) => (
                <div key={q.id || `n${i}`} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <div style={{ display: "flex", gap: 6 }}>
                    <input className="input" disabled={fijo} value={q.texto} placeholder="Texto de la pregunta" onChange={(e) => setPreg(i, { texto: e.target.value })} />
                    <button type="button" className="e360-icono peligro" disabled={fijo} title="Quitar" onClick={() => setCfg({ preguntas: cfg.preguntas.filter((_, k) => k !== i) })}><Trash2 size={15} /></button>
                  </div>
                  <Interruptor disabled={fijo} checked={q.obligatoria} onChange={(v) => setPreg(i, { obligatoria: v })} titulo="Obligatoria" />
                </div>
              ))}
            </div>
          )}
        </Tarjeta>
      </div>

      <Tarjeta icono={Scale} titulo="Ponderación" sub="Cuánto pesa la mirada de cada tipo de evaluador y cuánto los objetivos. Si un grupo no responde, su peso se reparte entre los demás.">
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div>
            <div className="e360-label" style={{ marginBottom: 8 }}>Peso por tipo de evaluador</div>
            {pesoTotalRel > 0 && (
              <div className="e360-segmentos" style={{ marginBottom: 10 }}>
                {RELACIONES.filter((r) => Number(cfg.pesos_relacion[r.key]) > 0).map((r) => {
                  const pct = Math.round((Number(cfg.pesos_relacion[r.key]) / pesoTotalRel) * 100);
                  return (
                    <div key={r.key} className={TEXTO_OSCURO_SOBRE.has(r.color) ? "oscuro" : undefined} style={{ flexGrow: Number(cfg.pesos_relacion[r.key]), flexBasis: 0, background: r.color }} title={`${r.label}: ${pct} %`}>
                      {pct >= 8 ? `${pct} %` : ""}
                    </div>
                  );
                })}
              </div>
            )}
            <div className="e360-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
              {RELACIONES.map((r) => (
                <div className="e360-campo" key={r.key}>
                  <label><RelChip relacion={r.key} /></label>
                  <input className="input" type="number" min="0" max="100" value={cfg.pesos_relacion[r.key]}
                    onChange={(e) => setCfg({ pesos_relacion: { ...cfg.pesos_relacion, [r.key]: e.target.value } })} />
                </div>
              ))}
            </div>
            <div className="e360-ayuda" style={{ marginTop: 6 }}>Con peso 0 ese grupo responde y aparece en el informe, pero no mueve la nota (útil para la autoevaluación).</div>
          </div>
          <div>
            <div className="e360-label" style={{ marginBottom: 8 }}>Nota final: competencias y objetivos</div>
            <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
              <span style={{ fontSize: 13, fontWeight: 600, minWidth: 150 }}>Competencias {cfg.peso_competencias} %</span>
              <input type="range" min="0" max="100" step="5" value={cfg.peso_competencias} style={{ flex: 1, minWidth: 160, accentColor: "#1e9295" }}
                aria-label="Peso de las competencias en la nota final"
                onChange={(e) => setCfg({ peso_competencias: Number(e.target.value), peso_objetivos: 100 - Number(e.target.value) })} />
              <span style={{ fontSize: 13, fontWeight: 600, minWidth: 120, textAlign: "right" }}>Objetivos {cfg.peso_objetivos} %</span>
            </div>
            <div className="e360-ayuda" style={{ marginTop: 6 }}>Quien no tenga objetivos medidos se evalúa solo por competencias.</div>
          </div>
        </div>
      </Tarjeta>

      <div className="e360-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 16, alignItems: "start" }}>
        <Tarjeta icono={ShieldCheck} titulo="Confidencialidad">
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <Interruptor disabled={fijo} checked={cfg.anonimo} onChange={(v) => setCfg({ anonimo: v })}
              titulo="Evaluaciones anónimas"
              detalle="Las notas y comentarios de pares, equipo y otros se muestran sin nombre y solo agregados. Tampoco este panel muestra qué respondió cada persona." />
            {cfg.anonimo && (
              <Campo label="Mínimo de respuestas para desglosar un grupo" ayuda="Con menos respuestas el grupo se funde con los demás o no se desglosa, para que nadie pueda deducir quién respondió.">
                <DropdownSelect disabled={fijo} value={cfg.min_anonimato} onChange={(v) => setCfg({ min_anonimato: Number(v) })}
                  options={[1, 2, 3, 4, 5].map((n) => ({ value: n, label: n === 1 ? "1 (sin protección)" : `${n} respuestas`, detalle: n === 3 ? "Recomendado" : undefined }))} />
              </Campo>
            )}
            <Interruptor checked={cfg.jefatura_ve_resultados} onChange={(v) => setCfg({ jefatura_ve_resultados: v })}
              titulo="La jefatura ve el informe de su equipo"
              detalle="Al publicar, cada jefatura ve en Mi Ficha los informes de sus reportes directos (con el mismo anonimato)." />
          </div>
        </Tarjeta>

        <Tarjeta icono={Award} titulo="Niveles de desempeño" sub="Tramos sobre el resultado final (0 a 100 %)."
          accion={cfg.niveles.length < 8 && <button type="button" className="e360-btn e360-btn-sec e360-btn-sm" onClick={() => setCfg({ niveles: [...cfg.niveles, { desde: 95, etiqueta: "" }] })}><Plus size={13} /> Nivel</button>}>
          <div className="e360-lista" style={{ gap: 6 }}>
            {cfg.niveles.map((n, i) => (
              <div key={i} style={{ display: "grid", gridTemplateColumns: "92px 1fr 30px", gap: 8, alignItems: "center" }}>
                <div style={{ position: "relative" }}>
                  <input className="input" type="number" min="0" max="100" disabled={i === 0} value={n.desde} aria-label="Desde (%)" onChange={(e) => setNivel(i, { desde: e.target.value })} style={{ paddingRight: 26 }} />
                  <span style={{ position: "absolute", right: 9, top: "50%", transform: "translateY(-50%)", fontSize: 12, color: "var(--e360-ink-3)" }}>%</span>
                </div>
                <input className="input" value={n.etiqueta} placeholder="Nombre del nivel" onChange={(e) => setNivel(i, { etiqueta: e.target.value })} />
                <button type="button" className="e360-icono peligro" disabled={i === 0 || cfg.niveles.length <= 2} title="Quitar" onClick={() => setCfg({ niveles: cfg.niveles.filter((_, k) => k !== i) })}><Trash2 size={15} /></button>
              </div>
            ))}
            <div className="e360-ayuda">Cada nivel parte en su porcentaje y llega hasta donde empieza el siguiente.</div>
          </div>
        </Tarjeta>
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, alignItems: "center", position: "sticky", bottom: 0, padding: "10px 0", background: "linear-gradient(180deg, transparent, var(--bg) 40%)" }}>
        {sucio && <span style={{ fontSize: 12.5, color: "#92400e", fontWeight: 600 }}>Hay cambios sin guardar</span>}
        <button type="button" className="e360-btn e360-btn-pri" disabled={guardando || !sucio} onClick={guardar}><Save size={14} /> {guardando ? "Guardando…" : "Guardar cambios"}</button>
      </div>

      {plantilla && (
        <Modal titulo={`Cargar plantilla «${PLANTILLAS.find((x) => x.key === plantilla)?.nombre}»`} ancho={480} onClose={() => setPlantilla(null)}
          pie={<>
            <button type="button" className="e360-btn e360-btn-sec" onClick={() => setPlantilla(null)}>Cancelar</button>
            <button type="button" className="e360-btn e360-btn-sec" onClick={() => aplicarPlantilla("agregar")}>Agregar a las actuales</button>
            <button type="button" className="e360-btn e360-btn-pri" onClick={() => aplicarPlantilla("reemplazar")}>Reemplazar todo</button>
          </>}>
          <div style={{ fontSize: 13.5, lineHeight: 1.6 }}>
            «Reemplazar todo» cambia las {cfg.competencias.length} competencias y las preguntas abiertas actuales por las de la plantilla. «Agregar» suma solo las que no estén.
            Nada se guarda hasta que presiones «Guardar cambios».
          </div>
        </Modal>
      )}
    </>
  );
}

// ============================================================================
// Participantes y matriz
// ============================================================================
function TabMatriz({ datos, empleados, nombre, porId, avisar, recargar }) {
  const { ciclo, evaluados, asignaciones } = datos;
  const bloqueado = ["cerrado", "publicado"].includes(ciclo.estado);
  const idsActuales = useMemo(() => evaluados.map((e) => Number(e.empleado_id)), [evaluados]);
  const [seleccion, setSeleccion] = useState(idsActuales);
  const [opciones, setOpciones] = useState({ auto: true, jefatura: true, pares: true, reportes: true, max_pares: ciclo.config.max_pares });
  const [sim, setSim] = useState(null);
  const [ocupado, setOcupado] = useState("");
  const [forzar, setForzar] = useState(false);
  const [agregar, setAgregar] = useState(null);
  const [quitar, setQuitar] = useState(null);

  useEffect(() => { setSeleccion(idsActuales); }, [idsActuales]);

  const activos = useMemo(() => empleados.filter((e) => e.estado === "activo" || idsActuales.includes(Number(e.id))), [empleados, idsActuales]);
  const cambio = seleccion.length !== idsActuales.length || seleccion.some((x) => !idsActuales.includes(Number(x)));
  const setOp = (c) => { setOpciones((o) => ({ ...o, ...c })); setSim(null); };

  async function guardarParticipantes(confirmado = false) {
    setOcupado("participantes");
    try {
      const r = await api.put(`/rrhh/e360/ciclos/${ciclo.id}/participantes`, { empleado_ids: seleccion, forzar: confirmado });
      setForzar(false);
      setSim(null);
      await recargar();
      avisar({ type: "success", message: `Participantes guardados${r.agregados ? ` · ${r.agregados} agregados` : ""}${r.quitados ? ` · ${r.quitados} quitados` : ""}.` });
    } catch (e) {
      if (/ya tienen evaluaciones respondidas/i.test(e?.message || "")) setForzar(e.message);
      else avisar({ type: "error", message: e?.message || "No se pudo guardar." });
    } finally { setOcupado(""); }
  }

  async function simular() {
    setOcupado("simular");
    try { setSim(await api.post(`/rrhh/e360/ciclos/${ciclo.id}/matriz/sugerir`, opciones)); }
    catch (e) { avisar({ type: "error", message: e?.message || "No se pudo simular." }); }
    finally { setOcupado(""); }
  }

  async function aplicar() {
    setOcupado("aplicar");
    try {
      const r = await api.post(`/rrhh/e360/ciclos/${ciclo.id}/matriz/generar`, opciones);
      setSim(null);
      await recargar();
      avisar({ type: "success", message: `Matriz actualizada: ${r.agregadas} evaluaciones agregadas.` });
    } catch (e) { avisar({ type: "error", message: e?.message || "No se pudo generar." }); }
    finally { setOcupado(""); }
  }

  async function crearAsignacion() {
    if (!agregar.evaluador_id) { avisar({ type: "error", message: "Elige quién evalúa." }); return; }
    setOcupado("agregar");
    try {
      await api.post(`/rrhh/e360/ciclos/${ciclo.id}/asignaciones`, agregar);
      setAgregar(null);
      await recargar();
    } catch (e) { avisar({ type: "error", message: e?.message || "No se pudo agregar." }); }
    finally { setOcupado(""); }
  }

  async function quitarAsignacion(a, confirmado = false) {
    if (a.estado !== "pendiente" && !confirmado) { setQuitar(a); return; }
    setOcupado("quitar");
    try {
      await api.delete(`/rrhh/e360/asignaciones/${a.id}${a.estado === "enviada" ? "?forzar=1" : ""}`);
      setQuitar(null);
      await recargar();
    } catch (e) { avisar({ type: "error", message: e?.message || "No se pudo quitar." }); }
    finally { setOcupado(""); }
  }

  const filas = useMemo(
    () => idsActuales
      .map((id) => ({ id, nombre: nombre(id), cargo: porId.get(id)?.cargo, asignaciones: asignaciones.filter((a) => Number(a.evaluado_id) === id) }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre)),
    [idsActuales, asignaciones, nombre, porId],
  );
  const p = usePaginas(filas);
  const sinMatriz = filas.filter((f) => f.asignaciones.length === 0).length;

  return (
    <>
      <Tarjeta icono={Users} titulo="Personas evaluadas" sub="Quiénes reciben evaluación en este ciclo. Quienes evalúan pueden ser otras personas: se definen en la matriz.">
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <div style={{ flex: "1 1 320px", minWidth: 240 }}>
            <MultiSelect disabled={bloqueado} value={seleccion} onChange={(v) => setSeleccion(v.map(Number))} placeholder="Selecciona trabajadores…" minWidth={320}
              options={activos.map((e) => ({ value: Number(e.id), label: nombreCompleto(e), detalle: [e.cargo, e.area].filter(Boolean).join(" · ") || undefined }))}
              resumen={(el) => (el.length === 0 ? "Selecciona trabajadores…" : `${el.length} persona${el.length === 1 ? "" : "s"} seleccionada${el.length === 1 ? "" : "s"}`)} />
          </div>
          <button type="button" className="e360-btn e360-btn-sec" disabled={bloqueado} onClick={() => setSeleccion(empleados.filter((e) => e.estado === "activo").map((e) => Number(e.id)))}>
            Todos los activos
          </button>
          <button type="button" className="e360-btn e360-btn-pri" disabled={bloqueado || !cambio || ocupado === "participantes"} onClick={() => guardarParticipantes(false)}>
            <Save size={14} /> {ocupado === "participantes" ? "Guardando…" : "Guardar participantes"}
          </button>
        </div>
        {bloqueado && <div className="e360-ayuda" style={{ marginTop: 8 }}>El ciclo está cerrado: reábrelo para cambiar participantes o la matriz.</div>}
      </Tarjeta>

      {idsActuales.length > 0 && !bloqueado && (
        <Tarjeta icono={Wand2} titulo="Armar la matriz automáticamente"
          sub="Usa la jefatura y el área de cada ficha. Solo AGREGA lo que falta: nunca borra evaluaciones existentes. Primero se simula; nada se guarda hasta que lo apliques.">
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div className="e360-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: 14 }}>
              <Interruptor checked={opciones.auto} onChange={(v) => setOp({ auto: v })} titulo="Autoevaluación" detalle="Cada evaluado se evalúa a sí mismo." />
              <Interruptor checked={opciones.jefatura} onChange={(v) => setOp({ jefatura: v })} titulo="Jefatura → trabajador" detalle="La jefatura de la ficha evalúa a su reporte." />
              <Interruptor checked={opciones.reportes} onChange={(v) => setOp({ reportes: v })} titulo="Equipo → jefatura" detalle="Cada reporte directo evalúa a su jefatura." />
              <Interruptor checked={opciones.pares} onChange={(v) => setOp({ pares: v })} titulo="Entre pares" detalle="Quienes comparten jefatura (o área) se evalúan entre sí." />
            </div>
            <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
              {opciones.pares && (
                <Campo label="Pares por persona" style={{ width: 170 }}>
                  <DropdownSelect value={opciones.max_pares} onChange={(v) => setOp({ max_pares: Number(v) })} minWidth={170}
                    options={[1, 2, 3, 4, 5, 6, 8, 10].map((n) => ({ value: n, label: `Hasta ${n}` }))} />
                </Campo>
              )}
              <button type="button" className="e360-btn e360-btn-sec" disabled={ocupado === "simular"} onClick={simular}>
                <Eye size={14} /> {ocupado === "simular" ? "Simulando…" : "Simular matriz"}
              </button>
              {sim && sim.nuevas.length > 0 && (
                <button type="button" className="e360-btn e360-btn-pri" disabled={ocupado === "aplicar"} onClick={aplicar}>
                  <Check size={14} /> {ocupado === "aplicar" ? "Aplicando…" : `Aplicar: agregar ${sim.nuevas.length} evaluaciones`}
                </button>
              )}
            </div>
            {sim && (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <div className={`e360-aviso ${sim.nuevas.length ? "info" : "ok"}`}>
                  {sim.nuevas.length ? <Info size={16} /> : <Check size={16} />}
                  <div>
                    {sim.nuevas.length ? (
                      <>
                        <b>Simulación: se agregarían {sim.nuevas.length} evaluaciones</b>{sim.ya_existentes ? ` (${sim.ya_existentes} ya existen y no se tocan)` : ""}.
                        <div className="e360-leyenda" style={{ marginTop: 6 }}>
                          {RELACIONES.filter((r) => sim.por_relacion[r.key]).map((r) => <RelChip key={r.key} relacion={r.key} n={sim.por_relacion[r.key]} />)}
                        </div>
                      </>
                    ) : <b>La matriz ya tiene todo lo que estas reglas sugieren.</b>}
                  </div>
                </div>
                {sim.sin_jefatura.length > 0 && opciones.jefatura && (
                  <div className="e360-aviso ojo"><AlertTriangle size={16} />
                    <div><b>{sim.sin_jefatura.length} sin jefatura en su ficha</b> (o la jefatura no tiene ficha): {sim.sin_jefatura.map((e) => e.nombre).join(", ")}. No tendrán evaluación de jefatura; complétala en Trabajadores → Editar, o agrégala a mano en la tabla.</div>
                  </div>
                )}
                {sim.sin_correo.length > 0 && (
                  <div className="e360-aviso ojo"><AlertTriangle size={16} />
                    <div><b>{sim.sin_correo.length} sin correo en su ficha</b>: {sim.sin_correo.map((e) => e.nombre).join(", ")}. Pueden ser evaluados, pero no pueden autoevaluarse ni evaluar a otros porque no entran a la plataforma.</div>
                  </div>
                )}
              </div>
            )}
          </div>
        </Tarjeta>
      )}

      {idsActuales.length > 0 && (
        <Tarjeta icono={ClipboardCheck} cuerpo={false} titulo="Matriz de evaluadores"
          sub={<>Quién evalúa a cada persona. <span className="e360-rel" style={{ marginLeft: 6 }}><i style={{ background: "#cbd5e1", borderRadius: "50%" }} />pendiente</span>
            <span className="e360-rel" style={{ marginLeft: 10 }}><i style={{ background: "#f59e0b", borderRadius: "50%" }} />en progreso</span>
            <span className="e360-rel" style={{ marginLeft: 10 }}><i style={{ background: "#16a34a", borderRadius: "50%" }} />enviada</span>
            {sinMatriz > 0 && <b style={{ color: "#92400e", marginLeft: 12 }}>{sinMatriz} sin evaluadores</b>}</>}>
          <div className="e360-tabla-wrap">
            <table className="e360-tabla arriba" style={{ tableLayout: "fixed", minWidth: 860 }}>
              <colgroup><col style={{ width: "21%" }} /><col style={{ width: "9%" }} /><col style={{ width: "17%" }} /><col style={{ width: "22%" }} /><col style={{ width: "22%" }} /><col style={{ width: "9%" }} /></colgroup>
              <thead>
                <tr>
                  <th>Evaluado</th>
                  {RELACIONES.filter((r) => r.key !== "otro").map((r) => <th key={r.key}><RelChip relacion={r.key} etiqueta={r.corto} /></th>)}
                  <th><RelChip relacion="otro" etiqueta="Otros" /></th>
                </tr>
              </thead>
              <tbody>
                {p.visibles.map((f) => (
                  <tr key={f.id}>
                    <td><Persona nombre={f.nombre} cargo={f.cargo} /></td>
                    {RELACIONES.map((r) => {
                      const suyas = f.asignaciones.filter((a) => a.relacion === r.key);
                      return (
                        <td key={r.key}>
                          <div className="e360-chips">
                            {suyas.map((a) => (
                              <span className="e360-chip" key={a.id} title={`${nombre(a.evaluador_id)} · ${ESTADOS_FORM[a.estado]}`}>
                                <i className={`est ${a.estado}`} />
                                <span className="txt">{r.key === "auto" ? "Sí" : nombreCorto(nombre(a.evaluador_id))}</span>
                                {!bloqueado && <button type="button" aria-label="Quitar" onClick={() => quitarAsignacion(a)}><X size={12} /></button>}
                              </span>
                            ))}
                            {!bloqueado && (r.key !== "auto" || suyas.length === 0) && (
                              <button type="button" className="e360-mas" title={`Agregar ${r.label.toLowerCase()}`}
                                onClick={() => setAgregar({ evaluado_id: f.id, relacion: r.key, evaluador_id: r.key === "auto" ? f.id : "" })}>
                                <Plus size={13} />
                              </button>
                            )}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Paginas p={p} etiqueta="evaluados" />
        </Tarjeta>
      )}

      {agregar && (
        <Modal titulo={`Agregar evaluador para ${nombre(agregar.evaluado_id)}`} ancho={460} onClose={() => setAgregar(null)}
          pie={<>
            <button type="button" className="e360-btn e360-btn-sec" onClick={() => setAgregar(null)}>Cancelar</button>
            <button type="button" className="e360-btn e360-btn-pri" disabled={ocupado === "agregar"} onClick={crearAsignacion}>Agregar</button>
          </>}>
          <Campo label="Relación con el evaluado">
            <DropdownSelect value={agregar.relacion} onChange={(v) => setAgregar((a) => ({ ...a, relacion: v, evaluador_id: v === "auto" ? a.evaluado_id : (a.evaluador_id === a.evaluado_id ? "" : a.evaluador_id) }))}
              options={RELACIONES.map((r) => ({ value: r.key, label: r.label, color: r.color }))} />
          </Campo>
          {agregar.relacion !== "auto" && (
            <Campo label="Quién evalúa" ayuda="Solo fichas activas con correo: lo necesitan para entrar a responder.">
              <DropdownSelect value={agregar.evaluador_id} onChange={(v) => setAgregar((a) => ({ ...a, evaluador_id: v }))} placeholder="Selecciona a la persona…"
                options={empleados
                  .filter((e) => e.estado === "activo" && e.email && Number(e.id) !== Number(agregar.evaluado_id)
                    && !asignaciones.some((a) => Number(a.evaluado_id) === Number(agregar.evaluado_id) && Number(a.evaluador_id) === Number(e.id)))
                  .map((e) => ({ value: Number(e.id), label: nombreCompleto(e), detalle: [e.cargo, e.area].filter(Boolean).join(" · ") || undefined }))} />
            </Campo>
          )}
        </Modal>
      )}

      {quitar && (
        <Confirmar titulo="Quitar evaluación" etiqueta="Quitar y borrar respuestas" peligro ocupado={ocupado === "quitar"}
          onCancelar={() => setQuitar(null)} onConfirmar={() => quitarAsignacion(quitar, true)}>
          <b>{nombre(quitar.evaluador_id)}</b> ya {quitar.estado === "enviada" ? "envió" : "empezó"} su evaluación de <b>{nombre(quitar.evaluado_id)}</b>.
          Si la quitas, sus respuestas se borran y no se pueden recuperar.
        </Confirmar>
      )}

      {forzar && (
        <Confirmar titulo="Quitar personas con respuestas" etiqueta="Quitar igual" peligro ocupado={ocupado === "participantes"}
          onCancelar={() => setForzar(false)} onConfirmar={() => guardarParticipantes(true)}>
          {forzar} Sus objetivos del ciclo también se eliminan.
        </Confirmar>
      )}
    </>
  );
}

// ============================================================================
// Objetivos
// ============================================================================
function resumenObjetivos(lista) {
  const medidos = lista.filter((o) => o.cumplimiento !== null && o.cumplimiento !== undefined);
  const peso = medidos.reduce((s, o) => s + (Number(o.peso) || 1), 0);
  return {
    total: lista.length,
    medidos: medidos.length,
    cumplimiento: medidos.length && peso > 0 ? medidos.reduce((s, o) => s + o.cumplimiento * (Number(o.peso) || 1), 0) / peso : null,
  };
}

function Medidor({ pct }) {
  return (
    <div className="e360-medidor" title={pct === null ? "Sin medir" : `${fmtPct(pct, 1)} de la meta`}>
      <i style={{ width: `${pct === null ? 0 : Math.min(100, (pct / 120) * 100)}%` }} />
      <em style={{ left: `${(100 / 120) * 100}%` }} />
    </div>
  );
}

function TabObjetivos({ datos, nombre, porId, avisar, recargar }) {
  const { ciclo, evaluados, objetivos } = datos;
  const [abierta, setAbierta] = useState(null);
  const [editando, setEditando] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [borrar, setBorrar] = useState(null);

  const filas = useMemo(
    () => evaluados
      .map((e) => {
        const lista = objetivos.filter((o) => Number(o.empleado_id) === Number(e.empleado_id));
        return { id: Number(e.empleado_id), nombre: nombre(e.empleado_id), cargo: porId.get(Number(e.empleado_id))?.cargo, lista, ...resumenObjetivos(lista) };
      })
      .sort((a, b) => a.nombre.localeCompare(b.nombre)),
    [evaluados, objetivos, nombre, porId],
  );
  const p = usePaginas(filas);
  const conObjetivos = filas.filter((f) => f.total > 0).length;
  const medidos = objetivos.filter((o) => o.cumplimiento !== null).length;

  async function guardar() {
    if (!editando.titulo?.trim()) { avisar({ type: "error", message: "Ponle un título al objetivo." }); return; }
    setGuardando(true);
    try {
      await api.post(`/rrhh/e360/ciclos/${ciclo.id}/objetivos`, editando);
      setEditando(null);
      await recargar();
      avisar({ type: "success", message: "Objetivo guardado." });
    } catch (e) { avisar({ type: "error", message: e?.message || "No se pudo guardar." }); }
    finally { setGuardando(false); }
  }

  async function eliminar() {
    setGuardando(true);
    try {
      await api.delete(`/rrhh/e360/objetivos/${borrar.id}`);
      setBorrar(null);
      await recargar();
    } catch (e) { avisar({ type: "error", message: e?.message || "No se pudo eliminar." }); }
    finally { setGuardando(false); }
  }

  const nuevo = (empleadoId) => setEditando({ empleado_id: empleadoId, titulo: "", indicador: "", unidad: "porcentaje", sentido: "mayor", meta: "", valor_real: "", peso: 1, descripcion: "", comentario: "" });
  const set = (cambio) => setEditando((o) => ({ ...o, ...cambio }));

  if (evaluados.length === 0) {
    return <div className="e360-card e360-vacio"><b>Primero define a quiénes se evalúa</b>Los objetivos se asignan a cada persona evaluada, en «Participantes y matriz».</div>;
  }

  return (
    <>
      <div className="e360-kpis cols-3">
        <Kpi icono={Target} label="Objetivos definidos" valor={objetivos.length} sub={`${conObjetivos} de ${filas.length} personas tienen objetivos`} />
        <Kpi icono={Gauge} label="Ya medidos" valor={<>{medidos}<small> / {objetivos.length}</small></>} sub="con valor real ingresado" />
        <Kpi icono={Scale} label="Peso en la nota final" valor={<>{ciclo.config.peso_objetivos}<small> %</small></>} sub="se cambia en Instrumento → Ponderación" />
      </div>

      <div className="e360-card">
        <div className="e360-tabla-wrap">
          <table className="e360-tabla">
            <thead><tr><th style={{ width: 30 }} /><th>Persona</th><th className="num">Objetivos</th><th className="num">Medidos</th><th style={{ minWidth: 180 }}>Cumplimiento</th><th /></tr></thead>
            <tbody>
              {p.visibles.map((f) => (
                <Fragment key={f.id}>
                  <tr className="clic" onClick={() => setAbierta(abierta === f.id ? null : f.id)}>
                    <td style={{ color: "var(--e360-ink-3)" }}>{abierta === f.id ? <ChevronDown size={15} /> : <ChevronRight size={15} />}</td>
                    <td><Persona nombre={f.nombre} cargo={f.cargo} /></td>
                    <td className="num">{f.total || <span style={{ color: "var(--e360-ink-3)" }}>—</span>}</td>
                    <td className="num">{f.total ? `${f.medidos}/${f.total}` : <span style={{ color: "var(--e360-ink-3)" }}>—</span>}</td>
                    <td>
                      {f.total ? (
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <div style={{ flex: 1 }}><Medidor pct={f.cumplimiento} /></div>
                          <b style={{ minWidth: 48, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{f.cumplimiento === null ? "—" : fmtPct(f.cumplimiento, 0)}</b>
                        </div>
                      ) : <span style={{ color: "var(--e360-ink-3)" }}>Sin objetivos</span>}
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <div className="e360-acciones">
                        <button type="button" className="e360-btn e360-btn-sec e360-btn-sm" onClick={() => { setAbierta(f.id); nuevo(f.id); }}><Plus size={13} /> Objetivo</button>
                      </div>
                    </td>
                  </tr>
                  {abierta === f.id && (
                    <tr className="detalle">
                      <td colSpan={6}>
                        {f.lista.length === 0 ? (
                          <div style={{ fontSize: 12.5, color: "var(--e360-ink-2)" }}>Sin objetivos todavía. Un buen objetivo tiene un indicador que se pueda medir y una meta clara.</div>
                        ) : (
                          <div className="e360-card e360-card-cuerpo">
                            {f.lista.map((o) => (
                              <div className="e360-obj" key={o.id} style={{ gridTemplateColumns: "minmax(0, 1.6fr) minmax(0, 1fr) 56px 68px" }}>
                                <div style={{ minWidth: 0 }}>
                                  <div className="e360-obj-titulo">{o.titulo}</div>
                                  <div className="e360-obj-meta">
                                    {o.indicador ? `${o.indicador} · ` : ""}
                                    {o.unidad === "si_no" ? "Se cumple o no" : `Meta ${fmtValorObjetivo(o.meta, o.unidad)}${o.sentido === "menor" ? " o menos" : ""}`}
                                    {" · "}Real <b style={{ color: o.valor_real === null ? "#92400e" : "var(--e360-ink)" }}>{o.valor_real === null ? "sin medir" : fmtValorObjetivo(o.valor_real, o.unidad)}</b>
                                    {" · "}peso {fmtNota(o.peso, 0)}
                                  </div>
                                </div>
                                <div className="e360-medidor-celda"><Medidor pct={o.cumplimiento} /></div>
                                <b style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{o.cumplimiento === null ? "—" : fmtPct(o.cumplimiento, 0)}</b>
                                <div className="e360-acciones" style={{ flexWrap: "nowrap" }}>
                                  <button type="button" className="e360-icono" title="Editar / ingresar el valor real" onClick={() => setEditando({ ...o, meta: o.meta ?? "", valor_real: o.valor_real ?? "" })}><Pencil size={14} /></button>
                                  <button type="button" className="e360-icono peligro" title="Eliminar" onClick={() => setBorrar(o)}><Trash2 size={14} /></button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
        <Paginas p={p} etiqueta="personas" />
      </div>

      {editando && (
        <Modal titulo={editando.id ? "Editar objetivo" : "Nuevo objetivo"} sub={nombre(editando.empleado_id)} ancho={620} onClose={() => setEditando(null)}
          pie={<>
            <button type="button" className="e360-btn e360-btn-sec" onClick={() => setEditando(null)}>Cancelar</button>
            <button type="button" className="e360-btn e360-btn-pri" disabled={guardando} onClick={guardar}>{guardando ? "Guardando…" : "Guardar objetivo"}</button>
          </>}>
          <Campo label="Objetivo"><input className="input" autoFocus value={editando.titulo} placeholder="Ej: Aumentar las ventas del canal particular" onChange={(e) => set({ titulo: e.target.value })} /></Campo>
          <Campo label="Indicador (cómo se mide)"><input className="input" value={editando.indicador || ""} placeholder="Ej: Ventas netas facturadas del semestre" onChange={(e) => set({ indicador: e.target.value })} /></Campo>
          <div className="e360-grid">
            <Campo label="Se mide en">
              <DropdownSelect value={editando.unidad} onChange={(v) => set({ unidad: v })} options={UNIDADES} />
            </Campo>
            {editando.unidad !== "si_no" && (
              <Campo label="Qué es mejor">
                <DropdownSelect value={editando.sentido} onChange={(v) => set({ sentido: v })}
                  options={[{ value: "mayor", label: "Más es mejor", detalle: "Ventas, visitas, satisfacción" }, { value: "menor", label: "Menos es mejor", detalle: "Reclamos, errores, días de atraso" }]} />
              </Campo>
            )}
            <Campo label="Peso" ayuda="Frente a sus otros objetivos."><input className="input" type="number" min="0.5" step="0.5" value={editando.peso} onChange={(e) => set({ peso: e.target.value })} /></Campo>
          </div>
          <div className="e360-grid">
            {editando.unidad !== "si_no" ? (
              <>
                <Campo label="Meta"><input className="input" type="number" step="any" value={editando.meta} onChange={(e) => set({ meta: e.target.value })} /></Campo>
                <Campo label="Valor real" ayuda="Déjalo vacío hasta medirlo."><input className="input" type="number" step="any" value={editando.valor_real} onChange={(e) => set({ valor_real: e.target.value })} /></Campo>
              </>
            ) : (
              <Campo label="¿Se cumplió?">
                <DropdownSelect value={editando.valor_real === "" || editando.valor_real === null ? "" : String(Number(editando.valor_real) >= 1 ? 1 : 0)} onChange={(v) => set({ valor_real: v })}
                  options={[{ value: "", label: "Todavía sin medir" }, { value: "1", label: "Sí, se cumplió", color: "#16a34a" }, { value: "0", label: "No se cumplió", color: "#dc2626" }]} />
              </Campo>
            )}
          </div>
          <Campo label="Comentario (lo ve el evaluado en su informe)"><textarea className="input" rows={2} value={editando.comentario || ""} onChange={(e) => set({ comentario: e.target.value })} /></Campo>
        </Modal>
      )}

      {borrar && (
        <Confirmar titulo="Eliminar objetivo" etiqueta="Eliminar" peligro ocupado={guardando} onCancelar={() => setBorrar(null)} onConfirmar={eliminar}>
          Se eliminará el objetivo <b>{borrar.titulo}</b> de {nombre(borrar.empleado_id)}.
        </Confirmar>
      )}
    </>
  );
}

// ============================================================================
// Seguimiento
// ============================================================================
function TabSeguimiento({ datos, nombre, porId, avisar, recargar }) {
  const { ciclo, asignaciones } = datos;
  const [abierta, setAbierta] = useState(null);
  const [soloPendientes, setSoloPendientes] = useState(false);
  const [recordatorio, setRecordatorio] = useState(null);
  const [ocupado, setOcupado] = useState(false);

  const filas = useMemo(() => {
    const m = new Map();
    for (const a of asignaciones) {
      const id = Number(a.evaluador_id);
      if (!m.has(id)) m.set(id, { id, nombre: nombre(id), cargo: porId.get(id)?.cargo, lista: [] });
      m.get(id).lista.push(a);
    }
    return [...m.values()]
      .map((f) => ({ ...f, enviadas: f.lista.filter((a) => a.estado === "enviada").length }))
      .sort((a, b) => (b.lista.length - b.enviadas) - (a.lista.length - a.enviadas) || a.nombre.localeCompare(b.nombre));
  }, [asignaciones, nombre, porId]);
  const visibles = soloPendientes ? filas.filter((f) => f.enviadas < f.lista.length) : filas;
  const p = usePaginas(visibles);

  const total = asignaciones.length;
  const enviadas = asignaciones.filter((a) => a.estado === "enviada").length;
  const conPendientes = filas.filter((f) => f.enviadas < f.lista.length).length;
  const dias = diasPara(ciclo.fecha_cierre);

  async function simularRecordatorio() {
    setOcupado(true);
    try { setRecordatorio(await api.post(`/rrhh/e360/ciclos/${ciclo.id}/recordar`, { simular: true })); }
    catch (e) { avisar({ type: "error", message: e?.message || "No se pudo preparar el recordatorio." }); }
    finally { setOcupado(false); }
  }
  async function enviarRecordatorio() {
    setOcupado(true);
    try {
      const r = await api.post(`/rrhh/e360/ciclos/${ciclo.id}/recordar`, { simular: false });
      setRecordatorio(null);
      avisar({ type: "success", message: `Recordatorio enviado a ${r.avisados} persona${r.avisados === 1 ? "" : "s"} en la campana.` });
    } catch (e) { avisar({ type: "error", message: e?.message || "No se pudo enviar." }); }
    finally { setOcupado(false); }
  }
  async function reabrir(a) {
    try {
      await api.put(`/rrhh/e360/asignaciones/${a.id}/reabrir`, {});
      await recargar();
      avisar({ type: "success", message: `Se reabrió la evaluación de ${nombre(a.evaluador_id)}: puede corregirla y volver a enviarla.` });
    } catch (e) { avisar({ type: "error", message: e?.message || "No se pudo reabrir." }); }
  }

  if (total === 0) {
    return <div className="e360-card e360-vacio"><b>Todavía no hay matriz</b>Cuando definas quién evalúa a quién, aquí verás el avance de cada persona.</div>;
  }

  return (
    <>
      {ciclo.estado === "borrador" && <div className="e360-aviso info"><Info size={16} /><div>El ciclo está en borrador: nadie ve todavía sus formularios. Inícialo para que el equipo empiece a responder.</div></div>}

      <div className="e360-kpis">
        <Kpi icono={Send} label="Formularios enviados" valor={<>{enviadas}<small> / {total}</small></>} sub={`${asignaciones.filter((a) => a.estado === "en_progreso").length} en progreso`} />
        <Kpi icono={Gauge} label="Avance" valor={<>{Math.round((enviadas / total) * 100)}<small> %</small></>} sub={<div className="e360-barra fina" style={{ marginTop: 6 }}><i style={{ width: `${(enviadas / total) * 100}%` }} /></div>} />
        <Kpi icono={Hourglass} label="Personas con pendientes" valor={conPendientes} sub={`de ${filas.length} evaluadores`} />
        <Kpi icono={CalendarClock} label="Cierre de respuestas"
          valor={dias === null ? "—" : dias < 0 ? "Vencido" : dias === 0 ? "Hoy" : <>{dias}<small> día{dias === 1 ? "" : "s"}</small></>}
          sub={ciclo.fecha_cierre ? fmtFecha(ciclo.fecha_cierre) : "sin fecha de cierre"} />
      </div>

      <Tarjeta icono={Activity} cuerpo={false} titulo="Avance por evaluador"
        sub="Se ve quién respondió y quién falta; nunca qué respondió cada uno."
        accion={
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <Interruptor checked={soloPendientes} onChange={(v) => { setSoloPendientes(v); p.setPagina(1); }} titulo="Solo con pendientes" />
            {ciclo.estado === "activo" && conPendientes > 0 && (
              <button type="button" className="e360-btn e360-btn-pri" disabled={ocupado} onClick={simularRecordatorio}><Megaphone size={14} /> Recordar pendientes</button>
            )}
          </div>
        }>
        <div className="e360-tabla-wrap">
          <table className="e360-tabla">
            <thead><tr><th style={{ width: 30 }} /><th>Evaluador</th><th className="num">Asignadas</th><th className="num">Pendientes</th><th style={{ minWidth: 170 }}>Avance</th></tr></thead>
            <tbody>
              {p.visibles.length === 0 && <tr><td colSpan={5} className="e360-vacio" style={{ padding: 22 }}>Nadie tiene pendientes.</td></tr>}
              {p.visibles.map((f) => (
                <Fragment key={f.id}>
                  <tr className="clic" onClick={() => setAbierta(abierta === f.id ? null : f.id)}>
                    <td style={{ color: "var(--e360-ink-3)" }}>{abierta === f.id ? <ChevronDown size={15} /> : <ChevronRight size={15} />}</td>
                    <td><Persona nombre={f.nombre} cargo={f.cargo} /></td>
                    <td className="num">{f.lista.length}</td>
                    <td className="num">{f.lista.length - f.enviadas ? <b style={{ color: "#92400e" }}>{f.lista.length - f.enviadas}</b> : <Check size={15} style={{ color: "#15803d", display: "inline-block" }} aria-label="Al día" />}</td>
                    <td><Avance hechos={f.enviadas} total={f.lista.length} /></td>
                  </tr>
                  {abierta === f.id && (
                    <tr className="detalle">
                      <td colSpan={5}>
                        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                          {f.lista.map((a) => (
                            <div key={a.id} className="e360-seg-fila">
                              <span style={{ minWidth: 0 }}>
                                {a.relacion === "auto" ? <b>Su autoevaluación</b> : <>Evalúa a <b>{nombre(a.evaluado_id)}</b></>}
                              </span>
                              <RelChip relacion={a.relacion} />
                              <PillEstado estado={a.estado} etiquetas={ESTADOS_FORM} />
                              <span style={{ color: "var(--e360-ink-3)" }}>{a.enviada_at ? fmtFecha(a.enviada_at) : ""}</span>
                              <span style={{ textAlign: "right" }}>
                                {a.estado === "enviada" && ciclo.estado === "activo" && (
                                  <button type="button" className="e360-btn e360-btn-sec e360-btn-sm" title="Se la devuelve para que la corrija y la vuelva a enviar" onClick={() => reabrir(a)}>
                                    <Unlock size={12} /> Reabrir
                                  </button>
                                )}
                              </span>
                            </div>
                          ))}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
        <Paginas p={p} etiqueta="evaluadores" />
      </Tarjeta>

      {recordatorio && (
        <Modal titulo="Recordar pendientes" sub="Simulación: todavía no se ha enviado nada." ancho={520} onClose={() => setRecordatorio(null)}
          pie={<>
            <button type="button" className="e360-btn e360-btn-sec" onClick={() => setRecordatorio(null)}>Cancelar</button>
            <button type="button" className="e360-btn e360-btn-pri" disabled={ocupado || recordatorio.destinatarios.length === 0} onClick={enviarRecordatorio}>
              <Megaphone size={14} /> {ocupado ? "Enviando…" : `Enviar aviso a ${recordatorio.destinatarios.length} persona${recordatorio.destinatarios.length === 1 ? "" : "s"}`}
            </button>
          </>}>
          <div style={{ fontSize: 13, color: "#334155", lineHeight: 1.6 }}>
            Cada persona recibirá un aviso en la <b>campana</b> de la plataforma con un enlace a Mi Ficha:
          </div>
          <div className="e360-card" style={{ maxHeight: 260, overflowY: "auto" }}>
            {recordatorio.destinatarios.map((d) => (
              <div key={d.id} className="e360-tarea" style={{ padding: "8px 14px" }}>
                <div className="e360-tarea-info"><Persona nombre={d.nombre} cargo={d.cargo} /></div>
                <b style={{ fontSize: 12.5, color: "#92400e" }}>{d.pendientes} pendiente{d.pendientes === 1 ? "" : "s"}</b>
              </div>
            ))}
          </div>
          {recordatorio.sin_correo.length > 0 && (
            <div className="e360-aviso ojo"><AlertTriangle size={16} /><div>No se puede avisar a {recordatorio.sin_correo.map((d) => d.nombre).join(", ")}: su ficha no tiene correo.</div></div>
          )}
        </Modal>
      )}
    </>
  );
}

// ============================================================================
// Resultados
// ============================================================================
function TabResultados({ datos, avisar }) {
  const { ciclo } = datos;
  const [res, setRes] = useState(null);
  const [error, setError] = useState("");
  const [informe, setInforme] = useState(null);
  const [abriendo, setAbriendo] = useState(null);
  const { mostrar, ocultar, nodo } = useTooltip();

  const cargar = useCallback(async () => {
    try { setRes(await api.get(`/rrhh/e360/ciclos/${ciclo.id}/resultados`)); setError(""); }
    catch (e) { setError(e?.message || "No se pudieron calcular los resultados."); }
  }, [ciclo.id]);
  useEffect(() => { cargar(); }, [cargar, ciclo.estado, ciclo.updated_at]);

  const filas = useMemo(() => res?.filas || [], [res]);
  const p = usePaginas(filas);

  async function abrir(empleadoId) {
    setAbriendo(empleadoId);
    try { setInforme(await api.get(`/rrhh/e360/ciclos/${ciclo.id}/resultados/${empleadoId}`)); }
    catch (e) { avisar({ type: "error", message: e?.message || "No se pudo abrir el informe." }); }
    finally { setAbriendo(null); }
  }

  async function guardarCierre(body) {
    try {
      await api.put(`/rrhh/e360/ciclos/${ciclo.id}/resultados/${informe.empleado.id}/cierre`, body);
      avisar({ type: "success", message: "Retroalimentación y plan guardados." });
      setInforme(null);
    } catch (e) { avisar({ type: "error", message: e?.message || "No se pudo guardar." }); }
  }

  if (error) return <div className="e360-aviso ojo"><AlertTriangle size={16} /><div>{error}</div></div>;
  if (!res) return <div className="e360-card e360-vacio">Calculando resultados…</div>;
  if (filas.length === 0) return <div className="e360-card e360-vacio"><b>Sin personas evaluadas</b>Agrega participantes para ver resultados.</div>;

  const max = res.escala.max;
  const conDatos = filas.filter((f) => f.porcentaje_final !== null);
  const acuses = filas.filter((f) => f.acuse_at).length;
  const porNivel = res.niveles.map((n, i) => ({ ...n, indice: i, total: res.niveles.length, n: conDatos.filter((f) => f.nivel?.indice === i).length }));
  const maxNivel = Math.max(1, ...porNivel.map((n) => n.n));

  return (
    <>
      {ciclo.estado === "activo" && <div className="e360-aviso info"><Info size={16} /><div>El ciclo sigue en curso: estos resultados son parciales y cambian con cada formulario que llega.</div></div>}
      {ciclo.estado === "cerrado" && <div className="e360-aviso ojo"><Info size={16} /><div>Resultados listos para revisar. Los evaluados no los ven todavía: mide los objetivos, escribe la retroalimentación de cada informe y luego publica.</div></div>}

      <div className="e360-kpis cols-3">
        <Kpi icono={Gauge} label="Resultado promedio" valor={res.promedio_final === null ? "—" : <>{fmtNota(res.promedio_final, 0)}<small> %</small></>} sub={`${conDatos.length} de ${filas.length} personas con respuestas`} />
        <div className="e360-kpi">
          <div className="e360-kpi-label"><Award size={13} />Distribución por nivel</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 8 }}>
            {[...porNivel].reverse().map((n) => (
              <div key={n.indice} style={{ display: "grid", gridTemplateColumns: "minmax(0, 130px) 1fr 18px", gap: 8, alignItems: "center", fontSize: 11.5 }}>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--e360-ink-2)" }}>{n.etiqueta}</span>
                <div style={{ height: 8, borderRadius: 4, background: "#f1f5f9" }}>
                  <div style={{ height: "100%", width: `${(n.n / maxNivel) * 100}%`, minWidth: n.n ? 4 : 0, borderRadius: 4, background: "#1e9295" }} />
                </div>
                <b style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{n.n}</b>
              </div>
            ))}
          </div>
        </div>
        <Kpi icono={ClipboardCheck} label="Informes revisados" valor={<>{acuses}<small> / {filas.length}</small></>} sub={ciclo.estado === "publicado" ? "evaluados que confirmaron su lectura" : "disponible al publicar"} />
      </div>

      <Tarjeta icono={BarChart3} cuerpo={false} titulo="Resultados por persona" sub="Ordenados por resultado final. Abre una fila para ver el informe completo y escribir la retroalimentación.">
        <div className="e360-tabla-wrap">
          <table className="e360-tabla compacta">
            <thead>
              <tr>
                <th style={{ minWidth: 190 }}>Persona</th><th style={{ minWidth: 132 }}>Resultado final</th><th>Nivel</th>
                <th className="centro" title="Promedio ponderado de competencias, según todos los evaluadores">Competencias</th>
                <th className="centro" title="Cómo se evaluó a sí mismo (compáralo con Competencias)">Auto</th>
                <th className="num">Objetivos</th><th className="num" title="Formularios enviados sobre los asignados">Resp.</th><th />
              </tr>
            </thead>
            <tbody>
              {p.visibles.map((f) => (
                <tr key={f.empleado.id} className="clic" onClick={() => abrir(f.empleado.id)}>
                  <td><Persona nombre={f.empleado.nombre} cargo={f.empleado.cargo} /></td>
                  <td>
                    {f.porcentaje_final === null ? <span style={{ color: "var(--e360-ink-3)" }}>Sin respuestas</span> : (
                      <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                        <div className="e360-barra" style={{ flex: 1 }}><i style={{ width: `${f.porcentaje_final}%` }} /></div>
                        <b style={{ minWidth: 44, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtPct(f.porcentaje_final, 0)}</b>
                      </div>
                    )}
                  </td>
                  <td><NivelPill nivel={f.nivel} /></td>
                  <td className="centro"><Calor valor={f.puntaje_competencias} max={max} /></td>
                  <td className="centro" style={{ fontVariantNumeric: "tabular-nums" }}>{fmtNota(f.puntaje_auto)}</td>
                  <td className="num">{f.porcentaje_objetivos === null ? <span style={{ color: "var(--e360-ink-3)" }}>{f.objetivos.total ? "sin medir" : "—"}</span> : fmtPct(f.porcentaje_objetivos, 0)}</td>
                  <td className="num">{f.respuestas.enviadas}/{f.respuestas.total}</td>
                  <td>
                    <div className="e360-acciones" style={{ flexWrap: "nowrap" }}>
                      {f.acuse_at && <span title={`Revisó su informe el ${fmtFecha(f.acuse_at)}`} style={{ display: "inline-flex", alignItems: "center", color: "#15803d" }}><Check size={15} /></span>}
                      <button type="button" className="e360-icono" title="Ver el informe" disabled={abriendo === f.empleado.id}><ChevronRight size={16} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Paginas p={p} etiqueta="personas" />
      </Tarjeta>

      {res.competencias.length > 0 && conDatos.length > 0 && (
        <Tarjeta icono={Layers} cuerpo={false} titulo="Mapa de competencias" sub={`Resultado de cada persona en cada competencia (1 a ${max}). Más oscuro = más alto.`}>
          <div className="e360-tabla-wrap">
            <table className="e360-tabla">
              <thead>
                <tr>
                  <th style={{ position: "sticky", left: 0, zIndex: 1 }}>Persona</th>
                  {res.competencias.map((c) => (
                    <th key={c.id} className="centro" style={{ whiteSpace: "normal", minWidth: 84, maxWidth: 120, lineHeight: 1.25, textTransform: "none", letterSpacing: 0, fontSize: 11.5 }}>{c.nombre}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {conDatos.map((f) => (
                  <tr key={f.empleado.id}>
                    <td style={{ position: "sticky", left: 0, background: "#fff", fontWeight: 600, color: "var(--e360-ink)", whiteSpace: "nowrap" }}>{f.empleado.nombre}</td>
                    {res.competencias.map((c) => (
                      <td key={c.id} className="centro" style={{ padding: "6px 8px" }}>
                        <Calor valor={f.competencias[c.id]} max={max}
                          onMouseMove={(e) => mostrar(e, <><b>{f.empleado.nombre}</b><div className="fila"><span>{c.nombre}</span><span>{fmtNota(f.competencias[c.id], 2)}</span></div><div className="fila"><span>Promedio del ciclo</span><span>{fmtNota(res.promedios[c.id], 2)}</span></div></>)}
                          onMouseLeave={ocultar} />
                      </td>
                    ))}
                  </tr>
                ))}
                <tr>
                  <td style={{ position: "sticky", left: 0, background: "#f8fafc", fontWeight: 700, color: "var(--e360-ink-2)", whiteSpace: "nowrap", borderTop: "2px solid var(--e360-linea)" }}>Promedio del ciclo</td>
                  {res.competencias.map((c) => (
                    <td key={c.id} className="centro" style={{ padding: "6px 8px", background: "#f8fafc", borderTop: "2px solid var(--e360-linea)" }}><Calor valor={res.promedios[c.id]} max={max} /></td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        </Tarjeta>
      )}

      {nodo}
      {informe && <InformeE360 datos={informe} modo="admin" onClose={() => setInforme(null)} onGuardarCierre={guardarCierre} />}
    </>
  );
}
