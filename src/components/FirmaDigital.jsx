import { useEffect, useRef, useState } from "react";
import { PenLine, Eraser, Check, X } from "lucide-react";

/* ============================================================
   Firma electrónica simple: el usuario dibuja su firma con el
   mouse o el dedo y se envía como dataURL PNG. El backend la
   guarda junto con el hash del documento, IP y user-agent, que
   es lo que da valor probatorio al acto de firma.
============================================================ */
export default function FirmaDigital({
  titulo = "Firmar documento",
  descripcion,
  contenido,
  onFirmar,
  onCancelar,
  guardando = false,
}) {
  const canvasRef = useRef(null);
  const dibujandoRef = useRef(false);
  const ultimoRef = useRef(null);
  const [vacio, setVacio] = useState(true);
  const [aceptaTerminos, setAceptaTerminos] = useState(false);

  // Ajusta el canvas al ancho real y a la densidad de pantalla (evita el
  // trazo pixelado en pantallas retina).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ratio = window.devicePixelRatio || 1;
    const ancho = canvas.offsetWidth;
    const alto = canvas.offsetHeight;
    canvas.width = ancho * ratio;
    canvas.height = alto * ratio;
    const ctx = canvas.getContext("2d");
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#0f172a";
  }, []);

  function posicion(e) {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const touch = e.touches?.[0];
    return {
      x: (touch ? touch.clientX : e.clientX) - rect.left,
      y: (touch ? touch.clientY : e.clientY) - rect.top,
    };
  }

  function iniciar(e) {
    e.preventDefault();
    dibujandoRef.current = true;
    ultimoRef.current = posicion(e);
  }

  function mover(e) {
    if (!dibujandoRef.current) return;
    e.preventDefault();
    const ctx = canvasRef.current.getContext("2d");
    const p = posicion(e);
    const prev = ultimoRef.current;
    ctx.beginPath();
    ctx.moveTo(prev.x, prev.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    ultimoRef.current = p;
    if (vacio) setVacio(false);
  }

  function terminar() {
    dibujandoRef.current = false;
    ultimoRef.current = null;
  }

  function limpiar() {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setVacio(true);
  }

  function confirmar() {
    if (vacio || !aceptaTerminos || guardando) return;
    onFirmar?.({
      firma_imagen: canvasRef.current.toDataURL("image/png"),
      contenido,
    });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div>
        <div style={{ fontSize: 14, fontWeight: 700, display: "flex", alignItems: "center", gap: 7 }}>
          <PenLine size={15} style={{ color: "var(--primary)" }} /> {titulo}
        </div>
        {descripcion && (
          <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginTop: 3, lineHeight: 1.5 }}>
            {descripcion}
          </div>
        )}
      </div>

      <div
        style={{
          border: "1px dashed var(--border)",
          borderRadius: 10,
          background: "#fff",
          position: "relative",
          height: 170,
        }}
      >
        <canvas
          ref={canvasRef}
          style={{ width: "100%", height: "100%", touchAction: "none", cursor: "crosshair", display: "block" }}
          onMouseDown={iniciar}
          onMouseMove={mover}
          onMouseUp={terminar}
          onMouseLeave={terminar}
          onTouchStart={iniciar}
          onTouchMove={mover}
          onTouchEnd={terminar}
        />
        {vacio && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              pointerEvents: "none",
              color: "var(--text-muted)",
              fontSize: 12.5,
            }}
          >
            Dibuja tu firma aquí con el mouse o el dedo
          </div>
        )}
        {/* Línea de firma */}
        <div
          style={{
            position: "absolute",
            left: 24,
            right: 24,
            bottom: 32,
            borderBottom: "1px solid #cbd5e1",
            pointerEvents: "none",
          }}
        />
      </div>

      <label style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 12.5, lineHeight: 1.5 }}>
        <input
          type="checkbox"
          checked={aceptaTerminos}
          onChange={(e) => setAceptaTerminos(e.target.checked)}
          style={{ marginTop: 3 }}
        />
        <span>
          Declaro que he leído el documento y firmo electrónicamente de forma libre y voluntaria. Se
          registrará la fecha, hora y dispositivo desde el que firmo.
        </span>
      </label>

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
        <button type="button" className="btn btn-ghost" onClick={limpiar} disabled={vacio || guardando}
          style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <Eraser size={14} /> Borrar
        </button>
        {onCancelar && (
          <button type="button" className="btn btn-secondary" onClick={onCancelar} disabled={guardando}
            style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <X size={14} /> Cancelar
          </button>
        )}
        <button
          type="button"
          className="btn btn-primary"
          onClick={confirmar}
          disabled={vacio || !aceptaTerminos || guardando}
          style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
        >
          <Check size={14} /> {guardando ? "Firmando…" : "Firmar"}
        </button>
      </div>
    </div>
  );
}
