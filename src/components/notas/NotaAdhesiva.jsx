import { useEffect, useLayoutEffect, useRef } from "react";
import { Check, ListChecks, MapPin, MapPinOff, PanelRightClose, PictureInPicture2, Star, Trash2 } from "lucide-react";
import {
  COLORES_NOTA,
  LETRAS_NOTA,
  MAX_CONTENIDO_NOTA,
  PAPELES_NOTA,
  SUJECIONES_NOTA,
  alternarCasilla,
  casillaEnLinea,
  enterEnCasilla,
  fechaCortaNota,
  giroDeNota,
  lineasDeNota,
  mismaPantalla,
  resumenCasillas,
} from "../../lib/notasEstilos";

/* (2026-11-27) Una nota adhesiva. Sirve para el tablero del panel
   (modo «panel», con barra de estilos al editar) y para las notas despegadas
   sobre la pantalla (modo «flotante», más compacta).
   - Un clic en el texto la deja en edición; «Listo», Esc o salir del foco la cierra.
   - La franja de arriba (cinta, chinche, clip) es de donde se toma para moverla:
     `agarre` trae los eventos del arrastre. */

function Clip() {
  return (
    <svg className="postit-clip" viewBox="0 0 19 46" fill="none" aria-hidden="true">
      <path
        d="M5.5 33V11.5a4 4 0 0 1 8 0V35a6 6 0 0 1-12 0V13"
        stroke="#7b8794" strokeWidth="2.2" strokeLinecap="round"
      />
      <path
        d="M5.5 33V11.5a4 4 0 0 1 8 0V35a6 6 0 0 1-12 0V13"
        stroke="#e5e9ee" strokeWidth=".8" strokeLinecap="round" transform="translate(-.5 -.4)"
      />
    </svg>
  );
}

function Sujecion({ tipo }) {
  if (tipo === "cinta") return <span className="postit-cinta" />;
  if (tipo === "chinche") return <span className="postit-chinche" />;
  if (tipo === "clip") return <Clip />;
  return <span className="postit-agarre" />;
}

export default function NotaAdhesiva({
  nota,
  modo = "panel",
  editando = false,
  onEditar,
  onCerrarEdicion,
  onCambiar,
  onEliminar,
  onDespegar,
  onVolverAlPanel,
  onIrARuta,
  pantallaActual,
  sinGuardar,
  agarre,
  cerrarAlSalir = false,
}) {
  const refTexto = useRef(null);
  const refCursor = useRef(null);
  const flotante = modo === "flotante";

  // El área de texto crece con lo escrito (sin barra de desplazamiento propia).
  useLayoutEffect(() => {
    const t = refTexto.current;
    if (!editando || !t) return;
    t.style.height = "auto";
    t.style.height = `${t.scrollHeight}px`;
    if (refCursor.current !== null) {
      t.setSelectionRange(refCursor.current, refCursor.current);
      refCursor.current = null;
    }
  }, [editando, nota.contenido, nota.letra]);

  useEffect(() => {
    const t = refTexto.current;
    if (!editando || !t) return;
    t.focus({ preventScroll: true });
    const fin = t.value.length;
    t.setSelectionRange(fin, fin);
    t.closest(".postit-marco")?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  }, [editando]);

  const lineas = lineasDeNota(nota.contenido);
  const avance = resumenCasillas(nota.contenido);
  const vacia = !String(nota.contenido || "").trim();
  const largo = !flotante && (lineas.length > 11 || String(nota.contenido || "").length > 330);
  const ancladaAqui = Boolean(pantallaActual && mismaPantalla(nota.ruta, pantallaActual.ruta));

  function teclas(e) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onCerrarEdicion?.();
      return;
    }
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      onCerrarEdicion?.();
      return;
    }
    if (e.key === "Enter" && !e.shiftKey && !e.altKey) {
      const r = enterEnCasilla(e.currentTarget.value, e.currentTarget.selectionStart);
      if (r) {
        e.preventDefault();
        refCursor.current = r.cursor;
        onCambiar?.({ contenido: r.contenido });
      }
    }
  }

  function ponerCasilla() {
    const t = refTexto.current;
    const r = casillaEnLinea(nota.contenido, t ? t.selectionStart : String(nota.contenido || "").length);
    refCursor.current = r.cursor;
    onCambiar?.({ contenido: r.contenido });
    t?.focus({ preventScroll: true });
  }

  function anclar() {
    if (nota.ruta) onCambiar?.({ ruta: null, ruta_titulo: null }, true);
    else if (pantallaActual) onCambiar?.({ ruta: pantallaActual.ruta, ruta_titulo: pantallaActual.titulo }, true);
  }

  return (
    <article
      className="postit"
      data-color={nota.color}
      data-papel={nota.papel}
      data-letra={nota.letra}
      data-sujecion={nota.sujecion}
      style={{ "--giro": `${giroDeNota(nota.id)}deg` }}
    >
      <span className="postit-sombra" />

      <div className="postit-sujecion" title="Arrastra para mover la nota" {...(agarre || {})}>
        <Sujecion tipo={nota.sujecion} />
      </div>

      {nota.destacada && (
        <span className="postit-estrella" title="Destacada">
          <Star size={14} fill="currentColor" strokeWidth={1.5} />
        </span>
      )}

      <div className="postit-herramientas">
        {!flotante && (
          <button
            type="button"
            className="postit-btn"
            aria-pressed={Boolean(nota.destacada)}
            title={nota.destacada ? "Quitar de destacadas" : "Destacar: queda arriba del tablero"}
            onClick={() => onCambiar?.({ destacada: !nota.destacada }, true)}
          >
            <Star size={12} fill={nota.destacada ? "currentColor" : "none"} />
          </button>
        )}
        {!flotante && (
          <button type="button" className="postit-btn" title="Despegar: pegarla sobre la pantalla" onClick={() => onDespegar?.()}>
            <PictureInPicture2 size={12} />
          </button>
        )}
        {flotante && (
          <button type="button" className="postit-btn" title="Devolver al tablero" onClick={() => onVolverAlPanel?.()}>
            <PanelRightClose size={12} />
          </button>
        )}
        <button type="button" className="postit-btn" data-peligro="1" title="Eliminar nota" onClick={() => onEliminar?.()}>
          <Trash2 size={12} />
        </button>
      </div>

      <div className="postit-papel">
        {editando ? (
          <textarea
            ref={refTexto}
            className="postit-texto"
            value={nota.contenido || ""}
            maxLength={MAX_CONTENIDO_NOTA}
            placeholder="Escribe aquí…"
            spellCheck
            onChange={(e) => onCambiar?.({ contenido: e.target.value })}
            onKeyDown={teclas}
            onBlur={cerrarAlSalir ? () => onCerrarEdicion?.() : undefined}
            aria-label="Texto de la nota"
          />
        ) : (
          <div
            className="postit-cuerpo"
            data-largo={largo ? "1" : "0"}
            role="button"
            tabIndex={0}
            title="Clic para escribir"
            onClick={() => onEditar?.()}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onEditar?.(); } }}
          >
            {vacia ? (
              <div className="postit-linea postit-vacia">Nota vacía: clic para escribir</div>
            ) : (
              lineas.map((l) =>
                l.casilla ? (
                  <div key={l.indice} className="postit-tarea" data-hecha={l.hecha ? "1" : "0"}>
                    <button
                      type="button"
                      className="postit-casilla"
                      role="checkbox"
                      aria-checked={l.hecha}
                      title={l.hecha ? "Marcar como pendiente" : "Marcar como hecha"}
                      onClick={(e) => { e.stopPropagation(); onCambiar?.({ contenido: alternarCasilla(nota.contenido, l.indice) }, true); }}
                      onKeyDown={(e) => e.stopPropagation()}
                    >
                      {l.hecha && <Check size={11} strokeWidth={3.4} />}
                    </button>
                    <span>{l.texto || " "}</span>
                  </div>
                ) : (
                  <div key={l.indice} className="postit-linea">{l.texto || " "}</div>
                ),
              )
            )}
          </div>
        )}

        {editando && !flotante && (
          <div className="postit-estilos" onMouseDown={(e) => { if (e.target.tagName !== "TEXTAREA") e.preventDefault(); }}>
            <div className="postit-fila">
              <span className="postit-rotulo">Color</span>
              {COLORES_NOTA.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className="postit-color"
                  style={{ "--muestra": c.muestra }}
                  aria-pressed={nota.color === c.id}
                  title={c.nombre}
                  aria-label={`Color ${c.nombre}`}
                  onClick={() => onCambiar?.({ color: c.id }, true)}
                />
              ))}
            </div>
            <div className="postit-fila">
              <span className="postit-rotulo">Papel</span>
              {PAPELES_NOTA.map((p) => (
                <button key={p.id} type="button" className="postit-op" aria-pressed={nota.papel === p.id} onClick={() => onCambiar?.({ papel: p.id }, true)}>
                  {p.nombre}
                </button>
              ))}
            </div>
            <div className="postit-fila">
              <span className="postit-rotulo">Letra</span>
              {LETRAS_NOTA.map((l) => (
                <button key={l.id} type="button" className="postit-op" data-letra={l.id} aria-pressed={nota.letra === l.id} onClick={() => onCambiar?.({ letra: l.id }, true)}>
                  {l.nombre}
                </button>
              ))}
            </div>
            <div className="postit-fila">
              <span className="postit-rotulo">Pegado</span>
              {SUJECIONES_NOTA.map((s) => (
                <button key={s.id} type="button" className="postit-op" aria-pressed={nota.sujecion === s.id} onClick={() => onCambiar?.({ sujecion: s.id }, true)}>
                  {s.nombre}
                </button>
              ))}
            </div>
            <div className="postit-fila">
              <button type="button" className="postit-op" title="Convierte la línea en una tarea que se marca con un clic" onClick={ponerCasilla}>
                <ListChecks size={13} /> Casilla
              </button>
              {pantallaActual && (
                <button
                  type="button"
                  className="postit-op"
                  aria-pressed={Boolean(nota.ruta)}
                  title={nota.ruta ? "Quitar el ancla a la pantalla" : `Anclar a «${pantallaActual.titulo}»: la pestaña avisa cuando vuelvas a esa pantalla`}
                  onClick={anclar}
                >
                  {nota.ruta ? <MapPinOff size={13} /> : <MapPin size={13} />}
                  {nota.ruta ? "Quitar ancla" : "Anclar aquí"}
                </button>
              )}
              <span className="postit-cuenta">{String(nota.contenido || "").length}/{MAX_CONTENIDO_NOTA}</span>
              <button type="button" className="postit-listo" onClick={() => onCerrarEdicion?.()}>Listo</button>
            </div>
          </div>
        )}

        <footer className="postit-pie">
          {nota.ruta && (
            <button
              type="button"
              className="postit-ruta"
              title={ancladaAqui ? "Anclada a esta pantalla" : `Ir a ${nota.ruta_titulo || nota.ruta}`}
              onClick={() => onIrARuta?.(nota.ruta)}
            >
              <MapPin size={10} />
              <span>{nota.ruta_titulo || nota.ruta}</span>
            </button>
          )}
          {avance.total > 0 && <span className="postit-avance">{avance.hechas}/{avance.total}</span>}
          {sinGuardar
            ? <span className="postit-sin-guardar postit-fecha" title={sinGuardar}>Sin guardar</span>
            : <span className="postit-fecha">{fechaCortaNota(nota.updated_at || nota.created_at)}</span>}
        </footer>
      </div>
    </article>
  );
}
