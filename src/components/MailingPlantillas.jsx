import { Mail, Plus, X } from "lucide-react";

/* ── Plantillas de campaña del mailing de Comunidad (2026-11-26) ─────────────
   Pedido de Ariel: «generar funcionalidad para generar templates de mailing de
   campañas de marketing. Presentación de plataforma, presentación de productos
   nuevos, lanzamiento de marca, invitación a workshop, hands-on, campañas de
   descuentos».

   Dos piezas para la pestaña Mailing (components/MailingComunidad.jsx):
   · GaleriaPlantillas: «Correo simple» + una tarjeta por plantilla, con la
     miniatura del correo de ejemplo.
   · CamposPlantilla: el formulario de la plantilla elegida.
   Aquí no hay diseño de correo ni lista de campos: ambos llegan del servidor
   (GET /comunidad/mailing/plantillas, ver backend/src/comunidad/
   mailing-plantillas.ts), que es también quien arma la vista previa y el
   correo real. Así no existen dos copias que se puedan desincronizar. */

const ANCHO_CORREO = 600;
const ALTO_CORREO = 480;
const ESCALA = 0.155; // miniatura de 93 × 74: caben cuatro tarjetas por fila en un notebook de 13"
const etiqueta = { fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".4px", color: "var(--text-muted)", display: "block", marginBottom: 5 };
const suave = { fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 };

function Tarjeta({ activa, nombre, descripcion, color, onClick, disabled, children }) {
  // La tarjeta entera se pincha a través de un botón transparente que la cubre:
  // así la miniatura (un iframe) no queda dentro del botón.
  return (
    <div
      className={`tarjeta-plantilla-mailing${activa ? " activa" : ""}`}
      title={descripcion}
      style={{
        position: "relative", width: ANCHO_CORREO * ESCALA + 14, padding: 6, borderRadius: 10, display: "flex", flexDirection: "column", gap: 5, opacity: disabled ? 0.6 : 1,
        background: activa ? "var(--primary-light)" : "var(--surface)", border: `1.5px solid ${activa ? "var(--primary)" : "var(--border)"}`,
      }}
    >
      <span style={{ display: "block", width: ANCHO_CORREO * ESCALA, height: ALTO_CORREO * ESCALA, overflow: "hidden", borderRadius: 6, background: "#eef2f6", border: "1px solid var(--border)", position: "relative" }}>
        {children}
      </span>
      <span style={{ display: "flex", alignItems: "flex-start", gap: 5, fontSize: 11, fontWeight: 700, lineHeight: 1.25, color: "var(--text)", minHeight: 41 }}>
        {color && <span aria-hidden style={{ width: 8, height: 8, borderRadius: "50%", background: color, flexShrink: 0, marginTop: 3 }} />}
        <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>{nombre}</span>
      </span>
      <button
        type="button"
        role="radio"
        aria-checked={activa}
        aria-label={nombre}
        onClick={onClick}
        disabled={disabled}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", background: "transparent", border: 0, borderRadius: 10, padding: 0, cursor: disabled ? "default" : "pointer" }}
      />
    </div>
  );
}

/* `valor`: clave de la plantilla elegida, o "" para el correo simple (mensaje libre). */
export function GaleriaPlantillas({ plantillas, valor, onElegir, disabled }) {
  return (
    <div role="radiogroup" aria-label="Plantilla del correo" className="galeria-plantillas-mailing" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      <Tarjeta activa={!valor} nombre="Correo simple" descripcion="Mensaje libre con imagen y botón opcionales, como siempre." onClick={() => onElegir("")} disabled={disabled}>
        <span style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4, color: "var(--text-muted)", fontSize: 11 }}>
          <Mail size={22} />
          Mensaje libre
        </span>
      </Tarjeta>
      {plantillas.map((p) => (
        <Tarjeta key={p.clave} activa={valor === p.clave} nombre={p.nombre} descripcion={p.descripcion} color={p.color} onClick={() => onElegir(p.clave)} disabled={disabled}>
          {/* El correo de ejemplo, tal como lo arma el servidor, achicado. No se puede pinchar ni recibe el foco. */}
          <iframe
            title={`Ejemplo: ${p.nombre}`}
            aria-hidden
            tabIndex={-1}
            sandbox=""
            scrolling="no"
            loading="lazy"
            srcDoc={p.html_ejemplo}
            style={{ display: "block", width: ANCHO_CORREO, maxWidth: "none", height: ALTO_CORREO, border: 0, transform: `scale(${ESCALA})`, transformOrigin: "0 0", pointerEvents: "none", background: "#eef2f6" }}
          />
        </Tarjeta>
      ))}
    </div>
  );
}

function Campo({ campo, valor, onCambiar, disabled, clase }) {
  const guia = campo.ejemplo ? (campo.tipo === "url" || campo.tipo === "lineas" ? campo.ejemplo : `Ej.: ${campo.ejemplo}`) : "";
  const comun = { className: `input ${clase || ""}`, value: valor ?? "", disabled, placeholder: guia, style: { width: "100%" } };
  return (
    <label style={{ flex: campo.corto ? "1 1 190px" : "1 1 100%", minWidth: 0 }}>
      <span style={etiqueta}>{campo.etiqueta}{campo.obligatorio ? <span style={{ color: "#dc2626" }} title="Obligatorio"> *</span> : null}</span>
      {campo.tipo === "parrafo" || campo.tipo === "lineas" ? (
        <textarea {...comun} rows={campo.tipo === "parrafo" ? 5 : 4} onChange={(e) => onCambiar(e.target.value.slice(0, campo.max || 4000))} style={{ ...comun.style, resize: "vertical", minHeight: 84, fontSize: 13.5, lineHeight: 1.5 }} />
      ) : (
        <input {...comun} onChange={(e) => onCambiar(campo.tipo === "url" ? e.target.value : e.target.value.slice(0, campo.max || 200))} />
      )}
      {campo.ayuda ? <span style={{ ...suave, display: "block", marginTop: 4 }}>{campo.ayuda}</span> : null}
    </label>
  );
}

function Productos({ campo, lista, onCambiar, camposProducto, maximo, disabled }) {
  const productos = Array.isArray(lista) ? lista : [];
  const cambiar = (i, clave, v) => onCambiar(productos.map((p, j) => (j === i ? { ...p, [clave]: v } : p)));
  const vacio = Object.fromEntries(camposProducto.map((c) => [c.clave, ""]));
  return (
    <div style={{ flex: "1 1 100%", minWidth: 0 }} className="productos-plantilla-mailing">
      <span style={etiqueta}>{campo.etiqueta}{campo.obligatorio ? <span style={{ color: "#dc2626" }} title="Obligatorio"> *</span> : null} · {productos.length} de {maximo}</span>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {productos.map((p, i) => (
          <div key={i} style={{ border: "1px dashed var(--border-strong, #cbd5e1)", borderRadius: 10, padding: "8px 10px 10px", minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 6 }}>
              <b style={{ fontSize: 12.5 }}>Producto {i + 1}</b>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => onCambiar(productos.filter((_, j) => j !== i))} disabled={disabled} title="Quitar este producto" style={{ padding: 4 }}><X size={14} /></button>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {camposProducto.map((c) => <Campo key={c.clave} campo={c} valor={p?.[c.clave]} onCambiar={(v) => cambiar(i, c.clave, v)} disabled={disabled} />)}
            </div>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginTop: 8 }}>
        <button type="button" className="btn btn-secondary btn-sm btn-agregar-producto-mailing" onClick={() => onCambiar([...productos, vacio])} disabled={disabled || productos.length >= maximo} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <Plus size={14} /> Agregar producto
        </button>
        {campo.ayuda ? <span style={{ ...suave, minWidth: 0 }}>{campo.ayuda}</span> : null}
      </div>
    </div>
  );
}

/* El formulario de una plantilla: sus campos propios, en el orden y con los textos que define el servidor. */
export function CamposPlantilla({ plantilla, datos, onCambiar, camposProducto, maxProductos, disabled }) {
  const poner = (clave, v) => onCambiar({ ...datos, [clave]: v });
  return (
    <div className="campos-plantilla-mailing" style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
      {plantilla.campos.map((c) => (c.tipo === "productos" ? (
        <Productos key={c.clave} campo={c} lista={datos?.[c.clave]} onCambiar={(v) => poner(c.clave, v)} camposProducto={camposProducto || []} maximo={maxProductos || 8} disabled={disabled} />
      ) : (
        <Campo key={c.clave} campo={c} valor={datos?.[c.clave]} onCambiar={(v) => poner(c.clave, v)} disabled={disabled} clase={`campo-plantilla-${c.clave}`} />
      )))}
    </div>
  );
}
