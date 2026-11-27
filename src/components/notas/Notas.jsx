import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, arrayMove, rectSortingStrategy, sortableKeyboardCoordinates, useSortable } from "@dnd-kit/sortable";
import { Check, CloudOff, Loader2, MapPin, Maximize2, Minimize2, Palette, Search, Star, StickyNote, X } from "lucide-react";
import { useNotas } from "../../hooks/useNotas";
import { COLORES_NOTA, FONDOS_TABLERO, mismaPantalla, ordenarNotas, tituloDeRuta } from "../../lib/notasEstilos";
import NotaAdhesiva from "./NotaAdhesiva";
import "./notas.css";

/* (2026-11-27) Notas adhesivas personales. Pedido de Ariel: «una barra
   lateral derecha que nos permita crear unas especies de post-it; súper
   custom, con estilos, colores, efectos».
   - Pestaña fija en el borde derecho (o Alt + N) → abre el tablero.
   - El tablero NO oscurece ni bloquea la pantalla: se puede seguir trabajando
     con las notas a la vista. Se cierra con la pestaña, la X, Esc o Alt + N.
   - Cada nota: color, papel, letra, sujeción, casillas, destacar, anclar a una
     pantalla y «despegar» (queda pegada sobre la pantalla, en todas las vistas).
   - Las notas son de cada persona y se guardan en el servidor (useNotas).
   Lo que es solo de este navegador (panel abierto, fondo, último estilo) va
   en localStorage. */

const CLAVE_PREFS = "notas_adhesivas_prefs";
const ESTILO_INICIAL = { color: "amarillo", papel: "liso", letra: "normal", sujecion: "cinta" };
const ANCHO_FLOTANTE = 216;
const ALTO_FLOTANTE = 250;

function leerPrefs() {
  const base = { abierto: false, amplio: false, fondo: "corcho", estilo: ESTILO_INICIAL };
  try {
    const p = JSON.parse(localStorage.getItem(CLAVE_PREFS) || "null");
    if (!p || typeof p !== "object") return base;
    return {
      abierto: p.abierto === true,
      amplio: p.amplio === true,
      fondo: FONDOS_TABLERO.some((f) => f.id === p.fondo) ? p.fondo : base.fondo,
      estilo: { ...ESTILO_INICIAL, ...(p.estilo && typeof p.estilo === "object" ? p.estilo : {}) },
    };
  } catch {
    return base;
  }
}

const limitar = (n, min, max) => Math.min(max, Math.max(min, n));

/* Nota del tablero: el marco se ordena arrastrando desde la sujeción. */
function NotaOrdenable({ nota, bloqueada, editando, entrando, saliendo, children }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: nota.id, disabled: bloqueada });
  return (
    <div
      ref={setNodeRef}
      className="postit-marco"
      data-editando={editando ? "1" : "0"}
      data-entrando={entrando ? "1" : "0"}
      data-saliendo={saliendo ? "1" : "0"}
      data-arrastrando={isDragging ? "1" : "0"}
      style={{ transform: transform ? `translate3d(${Math.round(transform.x)}px, ${Math.round(transform.y)}px, 0)` : undefined, transition }}
    >
      {children(bloqueada ? null : { ...attributes, ...listeners })}
    </div>
  );
}

/* Nota despegada: se mueve libre por la pantalla. La posición es una fracción
   del espacio libre de la ventana, así siempre cae dentro. */
function NotaFlotante({ nota, saliendo, onMover, ...resto }) {
  const ref = useRef(null);
  const toma = useRef(null);
  const [pos, setPos] = useState(null);

  function alBajar(e) {
    if (e.button !== undefined && e.button !== 0) return;
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    toma.current = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* sin captura */ }
    e.preventDefault();
  }
  function alMover(e) {
    if (!toma.current) return;
    const libreX = Math.max(1, window.innerWidth - ANCHO_FLOTANTE);
    const libreY = Math.max(1, window.innerHeight - ALTO_FLOTANTE);
    setPos({
      x: limitar(e.clientX - toma.current.dx, 0, libreX) / libreX,
      y: limitar(e.clientY - toma.current.dy, 0, libreY) / libreY,
    });
  }
  function alSoltar() {
    if (!toma.current) return;
    toma.current = null;
    if (pos) onMover(pos);
    setPos(null);
  }

  const x = pos ? pos.x : Number.isFinite(Number(nota.pos_x)) && nota.pos_x !== null ? Number(nota.pos_x) : 0.5;
  const y = pos ? pos.y : Number.isFinite(Number(nota.pos_y)) && nota.pos_y !== null ? Number(nota.pos_y) : 0.3;

  return (
    <div
      ref={ref}
      className="postit-marco postit-flotante"
      data-arrastrando={pos ? "1" : "0"}
      data-saliendo={saliendo ? "1" : "0"}
      data-entrando="0"
      style={{ "--x": x, "--y": y }}
    >
      <NotaAdhesiva
        nota={nota}
        modo="flotante"
        cerrarAlSalir
        agarre={{ onPointerDown: alBajar, onPointerMove: alMover, onPointerUp: alSoltar, onPointerCancel: alSoltar }}
        {...resto}
      />
    </div>
  );
}

export default function Notas({ pantallas }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { notas, estado, error, guardando, sinGuardar, cargar, crear, actualizar, eliminar, reordenar, reintentar, guardarYa } = useNotas(true);

  const [prefs, setPrefs] = useState(leerPrefs);
  const [editandoId, setEditandoId] = useState(null);
  const [recienId, setRecienId] = useState(null);
  const [saliendo, setSaliendo] = useState({});
  const [creando, setCreando] = useState(false);
  const [busqueda, setBusqueda] = useState("");
  const [filtroColor, setFiltroColor] = useState("");
  const [soloPantalla, setSoloPantalla] = useState(false);
  const [soloDestacadas, setSoloDestacadas] = useState(false);
  const [menuFondo, setMenuFondo] = useState(false);
  const [aviso, setAviso] = useState(null); // { texto, accion?, alAccionar? }
  const relojAviso = useRef(null);
  const refPanel = useRef(null);

  const cambiarPrefs = useCallback((cambios) => {
    setPrefs((p) => {
      const nuevo = { ...p, ...cambios };
      try { localStorage.setItem(CLAVE_PREFS, JSON.stringify(nuevo)); } catch { /* sin almacenamiento */ }
      return nuevo;
    });
  }, []);

  const mostrarAviso = useCallback((dato, ms = 6500) => {
    clearTimeout(relojAviso.current);
    setAviso(dato);
    if (dato) relojAviso.current = setTimeout(() => setAviso(null), ms);
  }, []);
  useEffect(() => () => clearTimeout(relojAviso.current), []);

  const pantallaActual = useMemo(
    () => ({ ruta: location.pathname, titulo: tituloDeRuta(location.pathname, pantallas) }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [location.pathname, (pantallas || []).length],
  );

  const delTablero = useMemo(() => ordenarNotas(notas.filter((n) => !n.flotante)), [notas]);
  const flotantes = useMemo(() => notas.filter((n) => n.flotante), [notas]);
  const deEstaPantalla = useMemo(() => notas.filter((n) => mismaPantalla(n.ruta, location.pathname)).length, [notas, location.pathname]);
  const coloresEnUso = useMemo(() => COLORES_NOTA.filter((c) => delTablero.some((n) => n.color === c.id)), [delTablero]);
  const hayDestacadas = delTablero.some((n) => n.destacada);

  const hayFiltro = Boolean(busqueda.trim() || filtroColor || soloPantalla || soloDestacadas);
  const visibles = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return delTablero.filter((n) => {
      if (n.id === editandoId) return true; // la que se está escribiendo no desaparece bajo el filtro
      if (q && !`${n.contenido || ""} ${n.ruta_titulo || ""}`.toLowerCase().includes(q)) return false;
      if (filtroColor && n.color !== filtroColor) return false;
      if (soloPantalla && !mismaPantalla(n.ruta, location.pathname)) return false;
      if (soloDestacadas && !n.destacada) return false;
      return true;
    });
  }, [delTablero, busqueda, filtroColor, soloPantalla, soloDestacadas, location.pathname, editandoId]);

  const quitarFiltros = () => { setBusqueda(""); setFiltroColor(""); setSoloPantalla(false); setSoloDestacadas(false); };

  const refEditando = useRef(null);
  refEditando.current = editandoId;
  const cerrarEdicion = useCallback(() => {
    if (refEditando.current !== null) guardarYa(refEditando.current);
    setEditandoId(null);
  }, [guardarYa]);

  const alternarPanel = useCallback(() => {
    setMenuFondo(false);
    cambiarPrefs({ abierto: !prefs.abierto });
    if (prefs.abierto) cerrarEdicion();
  }, [prefs.abierto, cambiarPrefs, cerrarEdicion]);

  // Alt + N abre o cierra el tablero desde cualquier pantalla.
  useEffect(() => {
    const alTeclear = (e) => {
      if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && e.code === "KeyN") {
        e.preventDefault();
        alternarPanel();
      }
    };
    window.addEventListener("keydown", alTeclear);
    return () => window.removeEventListener("keydown", alTeclear);
  }, [alternarPanel]);

  async function nuevaNota(color) {
    if (creando) return;
    setCreando(true);
    try {
      const nota = await crear({
        ...prefs.estilo,
        ...(color ? { color } : {}),
        // Con «Esta pantalla» activo, la nota nueva nace anclada a ella.
        ...(soloPantalla ? { ruta: pantallaActual.ruta, ruta_titulo: pantallaActual.titulo } : {}),
      });
      if (color) cambiarPrefs({ estilo: { ...prefs.estilo, color } });
      setBusqueda("");
      setFiltroColor("");
      setSoloDestacadas(false);
      if (nota?.id) {
        setRecienId(nota.id);
        setEditandoId(nota.id);
        setTimeout(() => setRecienId((id) => (id === nota.id ? null : id)), 700);
        refPanel.current?.querySelector(".adh-lienzo")?.scrollTo?.({ top: 0, behavior: "smooth" });
      }
    } catch (e) {
      mostrarAviso({ texto: e?.message || "No se pudo crear la nota." });
    } finally {
      setCreando(false);
    }
  }

  function cambiarNota(nota, cambios, inmediato) {
    actualizar(nota.id, cambios, { inmediato: Boolean(inmediato) });
    // El último estilo usado es el de la próxima nota.
    const estilo = {};
    for (const k of ["color", "papel", "letra", "sujecion"]) if (cambios[k]) estilo[k] = cambios[k];
    if (Object.keys(estilo).length) cambiarPrefs({ estilo: { ...prefs.estilo, ...estilo } });
  }

  function eliminarNota(nota) {
    if (editandoId === nota.id) setEditandoId(null);
    setSaliendo((s) => ({ ...s, [nota.id]: true }));
    setTimeout(async () => {
      try {
        await eliminar(nota.id);
        mostrarAviso({
          texto: "Nota eliminada",
          accion: "Deshacer",
          alAccionar: async () => {
            mostrarAviso(null);
            try {
              const { id: _id, created_at: _c, updated_at: _u, ...campos } = nota;
              const devuelta = await crear(campos);
              if (devuelta?.id) {
                setRecienId(devuelta.id);
                setTimeout(() => setRecienId((id) => (id === devuelta.id ? null : id)), 700);
              }
            } catch (e) {
              mostrarAviso({ texto: e?.message || "No se pudo recuperar la nota." });
            }
          },
        });
      } catch (e) {
        mostrarAviso({ texto: e?.message || "No se pudo eliminar la nota." });
      } finally {
        setSaliendo((s) => Object.fromEntries(Object.entries(s).filter(([k]) => Number(k) !== Number(nota.id))));
      }
    }, 330);
  }

  /* Despegar: la nota sale del tablero y queda pegada sobre la pantalla, a la
     izquierda del panel (escalonadas para que no caigan una sobre otra). */
  function despegar(nota) {
    if (editandoId === nota.id) cerrarEdicion();
    const ancho = refPanel.current?.getBoundingClientRect().width || 420;
    const libreX = Math.max(1, window.innerWidth - ANCHO_FLOTANTE);
    const paso = flotantes.length % 5;
    const izquierda = limitar(window.innerWidth - ancho - ANCHO_FLOTANTE - 44 - paso * 26, 12, libreX);
    actualizar(nota.id, { flotante: true, pos_x: izquierda / libreX, pos_y: limitar(0.1 + paso * 0.09, 0, 1) }, { inmediato: true });
  }

  function traerTodas() {
    for (const n of flotantes) actualizar(n.id, { flotante: false }, { inmediato: true });
  }

  function irARuta(ruta) {
    if (!ruta || mismaPantalla(ruta, location.pathname)) return;
    navigate(ruta);
  }

  const sensores = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function alSoltarNota({ active, over }) {
    if (!over || active.id === over.id) return;
    const ids = delTablero.map((n) => n.id);
    const de = ids.indexOf(active.id);
    const a = ids.indexOf(over.id);
    if (de < 0 || a < 0) return;
    reordenar([...arrayMove(ids, de, a), ...flotantes.map((n) => n.id)]).catch((e) => {
      mostrarAviso({ texto: e?.message || "No se pudo guardar el orden." });
    });
  }

  // Clic fuera de la nota en edición (dentro del panel): se da por terminada.
  function alPulsarPanel(e) {
    if (menuFondo && !e.target.closest?.(".adh-fondos, .adh-btn-fondo")) setMenuFondo(false);
    if (editandoId !== null && !e.target.closest?.('.postit-marco[data-editando="1"]')) cerrarEdicion();
  }

  function teclasPanel(e) {
    if (e.key !== "Escape") return;
    if (menuFondo) setMenuFondo(false);
    else if (editandoId !== null) cerrarEdicion();
    else alternarPanel();
  }

  const totalSinGuardar = Object.keys(sinGuardar).length;
  const cuentaPestana = deEstaPantalla > 0 ? deEstaPantalla : notas.length;

  return (
    <div className="adh-raiz" data-abierto={prefs.abierto ? "1" : "0"} data-amplio={prefs.amplio ? "1" : "0"}>
      <button
        type="button"
        className="adh-pestana"
        data-aqui={deEstaPantalla > 0 ? "1" : "0"}
        onClick={alternarPanel}
        aria-expanded={prefs.abierto}
        aria-controls="panel-notas"
        title={
          prefs.abierto
            ? "Cerrar mis notas (Alt + N)"
            : deEstaPantalla > 0
              ? `Mis notas: ${deEstaPantalla} de esta pantalla (Alt + N)`
              : "Mis notas (Alt + N)"
        }
      >
        <span className="adh-pestana-hoja h1" />
        <span className="adh-pestana-hoja h2" />
        <span className="adh-pestana-hoja h3">
          {cuentaPestana > 0 && <span className="adh-pestana-cuenta">{cuentaPestana > 99 ? "99+" : cuentaPestana}</span>}
          <span className="adh-pestana-texto">Notas</span>
        </span>
      </button>

      <aside
        id="panel-notas"
        ref={refPanel}
        className="adh-panel"
        aria-label="Mis notas"
        aria-hidden={!prefs.abierto}
        onPointerDownCapture={alPulsarPanel}
        onKeyDown={teclasPanel}
      >
        <header className="adh-cabecera">
          <div className="adh-titulo">
            <StickyNote size={19} color="#d9a400" />
            Mis notas
            {notas.length > 0 && <span className="adh-titulo-cuenta">{notas.length}</span>}
          </div>
          <div className="adh-acciones">
            <button
              type="button"
              className="adh-icono-btn adh-btn-fondo"
              aria-expanded={menuFondo}
              title="Fondo del tablero"
              onClick={() => setMenuFondo((v) => !v)}
            >
              <Palette size={17} />
            </button>
            <button
              type="button"
              className="adh-icono-btn adh-ampliar"
              aria-pressed={prefs.amplio}
              title={prefs.amplio ? "Tablero angosto" : "Tablero amplio"}
              onClick={() => cambiarPrefs({ amplio: !prefs.amplio })}
            >
              {prefs.amplio ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
            </button>
            <button type="button" className="adh-icono-btn" title="Cerrar (Esc)" onClick={alternarPanel}>
              <X size={18} />
            </button>
            {menuFondo && (
              <div className="adh-fondos" role="menu" aria-label="Fondo del tablero">
                {FONDOS_TABLERO.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    className="adh-fondo-op"
                    aria-pressed={prefs.fondo === f.id}
                    onClick={() => { cambiarPrefs({ fondo: f.id }); setMenuFondo(false); }}
                  >
                    <span className="adh-fondo-muestra" data-fondo={f.id} />
                    {f.nombre}
                  </button>
                ))}
              </div>
            )}
          </div>
        </header>

        <div className="adh-tacos">
          <span className="adh-tacos-rotulo">Saca una nota</span>
          {COLORES_NOTA.map((c) => (
            <button
              key={c.id}
              type="button"
              className="adh-taco"
              style={{ "--muestra": c.muestra }}
              disabled={creando || estado !== "lista"}
              title={`Nueva nota ${c.nombre.toLowerCase()}`}
              aria-label={`Nueva nota ${c.nombre.toLowerCase()}`}
              onClick={() => nuevaNota(c.id)}
            />
          ))}
        </div>

        <label className="adh-buscar">
          <Search size={15} />
          <input
            type="text"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar en mis notas…"
            aria-label="Buscar en mis notas"
          />
          {busqueda && (
            <button type="button" title="Limpiar" onClick={() => setBusqueda("")}><X size={14} /></button>
          )}
        </label>

        <div className="adh-filtros">
          {(deEstaPantalla > 0 || soloPantalla) && (
            <button type="button" className="adh-chip" aria-pressed={soloPantalla} onClick={() => setSoloPantalla((v) => !v)} title={`Notas ancladas a «${pantallaActual.titulo}»`}>
              <MapPin size={12} /> Esta pantalla{deEstaPantalla > 0 ? ` (${deEstaPantalla})` : ""}
            </button>
          )}
          {(hayDestacadas || soloDestacadas) && (
            <button type="button" className="adh-chip" aria-pressed={soloDestacadas} onClick={() => setSoloDestacadas((v) => !v)}>
              <Star size={12} /> Destacadas
            </button>
          )}
          {coloresEnUso.length > 1 && coloresEnUso.map((c) => (
            <button
              key={c.id}
              type="button"
              className="adh-punto"
              style={{ "--muestra": c.muestra }}
              aria-pressed={filtroColor === c.id}
              title={`Solo las de color ${c.nombre.toLowerCase()}`}
              aria-label={`Filtrar por color ${c.nombre.toLowerCase()}`}
              onClick={() => setFiltroColor((v) => (v === c.id ? "" : c.id))}
            />
          ))}
        </div>

        <div className="adh-lienzo" data-fondo={prefs.fondo}>
          {flotantes.length > 0 && (
            <div className="adh-sueltas">
              <span>{flotantes.length === 1 ? "1 nota despegada sobre la pantalla" : `${flotantes.length} notas despegadas sobre la pantalla`}</span>
              <button type="button" onClick={traerTodas}>Traer al tablero</button>
            </div>
          )}

          {estado === "cargando" && notas.length === 0 && (
            <div className="adh-aviso"><strong>Un momento…</strong>Buscando tus notas.</div>
          )}
          {estado === "error" && (
            <div className="adh-aviso">
              <strong>No se pudieron cargar las notas</strong>
              {error}
              <div><button type="button" className="adh-aviso-btn" onClick={cargar}>Reintentar</button></div>
            </div>
          )}
          {estado === "lista" && delTablero.length === 0 && flotantes.length === 0 && (
            <div className="adh-aviso">
              <strong>Tu tablero está vacío</strong>
              Saca una nota de los tacos de colores de arriba y escribe lo que no quieras olvidar. Solo tú ves tus notas.
              <div><button type="button" className="adh-aviso-btn" disabled={creando} onClick={() => nuevaNota()}>Pegar la primera nota</button></div>
            </div>
          )}
          {estado === "lista" && delTablero.length > 0 && visibles.length === 0 && (
            <div className="adh-aviso">
              <strong>Ninguna nota coincide</strong>
              Prueba con otra palabra o quita los filtros.
              <div><button type="button" className="adh-aviso-btn" onClick={quitarFiltros}>Quitar filtros</button></div>
            </div>
          )}

          {visibles.length > 0 && (
            <DndContext sensors={sensores} collisionDetection={closestCenter} onDragStart={cerrarEdicion} onDragEnd={alSoltarNota}>
              <SortableContext items={visibles.map((n) => n.id)} strategy={rectSortingStrategy}>
                <div className="adh-rejilla">
                  {visibles.map((n) => (
                    <NotaOrdenable
                      key={n.id}
                      nota={n}
                      bloqueada={hayFiltro || editandoId === n.id}
                      editando={editandoId === n.id}
                      entrando={recienId === n.id}
                      saliendo={Boolean(saliendo[n.id])}
                    >
                      {(agarre) => (
                        <NotaAdhesiva
                          nota={n}
                          editando={editandoId === n.id}
                          agarre={agarre}
                          pantallaActual={pantallaActual}
                          sinGuardar={sinGuardar[n.id]}
                          onEditar={() => setEditandoId(n.id)}
                          onCerrarEdicion={cerrarEdicion}
                          onCambiar={(cambios, inmediato) => cambiarNota(n, cambios, inmediato)}
                          onEliminar={() => eliminarNota(n)}
                          onDespegar={() => despegar(n)}
                          onIrARuta={irARuta}
                        />
                      )}
                    </NotaOrdenable>
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          )}
        </div>

        <footer className="adh-pie">
          {totalSinGuardar > 0 ? (
            <span className="adh-pie-estado" data-estado="error">
              <CloudOff size={13} />
              {totalSinGuardar === 1 ? "1 nota sin guardar" : `${totalSinGuardar} notas sin guardar`} ·
              <button type="button" onClick={reintentar}>Reintentar</button>
            </span>
          ) : guardando ? (
            <span className="adh-pie-estado"><Loader2 size={13} className="adh-gira" /> Guardando…</span>
          ) : estado === "lista" ? (
            <span className="adh-pie-estado"><Check size={13} /> Guardado</span>
          ) : (
            <span className="adh-pie-estado" />
          )}
          <span style={{ marginLeft: "auto", whiteSpace: "nowrap" }}><kbd>Alt</kbd> + <kbd>N</kbd></span>
        </footer>
      </aside>

      {/* Notas despegadas: visibles en todas las pantallas, con el panel abierto o cerrado */}
      {flotantes.map((n) => (
        <NotaFlotante
          key={n.id}
          nota={n}
          saliendo={Boolean(saliendo[n.id])}
          onMover={(p) => actualizar(n.id, { pos_x: p.x, pos_y: p.y }, { inmediato: true })}
          editando={editandoId === n.id}
          pantallaActual={pantallaActual}
          sinGuardar={sinGuardar[n.id]}
          onEditar={() => setEditandoId(n.id)}
          onCerrarEdicion={cerrarEdicion}
          onCambiar={(cambios, inmediato) => cambiarNota(n, cambios, inmediato)}
          onEliminar={() => eliminarNota(n)}
          onVolverAlPanel={() => actualizar(n.id, { flotante: false }, { inmediato: true })}
          onIrARuta={irARuta}
        />
      ))}

      {aviso && (
        <div className="adh-deshacer" role="status">
          <span>{aviso.texto}</span>
          {aviso.accion && <button type="button" onClick={aviso.alAccionar}>{aviso.accion}</button>}
        </div>
      )}
    </div>
  );
}
