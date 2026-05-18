import { useEffect, useRef } from "react";
import { Bold, Italic, Underline, List, ListOrdered, Link as LinkIcon, Undo2, Redo2 } from "lucide-react";

// Editor enriquecido minimal basado en contentEditable + document.execCommand.
// Aunque execCommand está marcado como "obsoleto" en MDN, sigue funcionando en
// todos los navegadores actuales y es la forma más simple de obtener un editor
// rich-text sin dependencias extras. Si más adelante quieren features
// complejas (tablas, imágenes inline, undo profundo), migramos a TipTap.
//
// Props:
//   value         → HTML inicial (controlado por el padre solo en el primer render)
//   onChange      → callback(html) que recibe el HTML actual al cambiar
//   placeholder   → texto que se muestra cuando el editor está vacío
//   minHeight     → alto mínimo del área editable
export default function EditorRichText({
  value = "",
  onChange,
  placeholder = "Escribe tu mensaje…",
  minHeight = 180,
}) {
  const editorRef = useRef(null);
  const initializedRef = useRef(false);

  // Sembramos el HTML inicial solo una vez para que el cursor del usuario no
  // se reinicie en cada keystroke (si el value viene del state padre y lo
  // re-renderizamos, perderíamos el caret).
  useEffect(() => {
    if (initializedRef.current) return;
    if (editorRef.current && value) {
      editorRef.current.innerHTML = value;
    }
    initializedRef.current = true;
  }, [value]);

  function exec(command, arg = null) {
    document.execCommand(command, false, arg);
    editorRef.current?.focus();
    notifyChange();
  }

  function notifyChange() {
    if (!editorRef.current) return;
    const html = editorRef.current.innerHTML;
    onChange?.(html);
  }

  function insertarLink() {
    const url = prompt("URL del enlace:", "https://");
    if (!url) return;
    exec("createLink", url);
  }

  return (
    <div
      style={{
        border: "1px solid var(--border-strong)",
        borderRadius: "var(--radius)",
        background: "var(--surface)",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Toolbar */}
      <div
        style={{
          display: "flex",
          gap: 4,
          padding: "6px 8px",
          borderBottom: "1px solid var(--border)",
          background: "var(--bg)",
          flexWrap: "wrap",
        }}
      >
        <ToolbarButton onClick={() => exec("bold")} title="Negrita (Ctrl+B)"><Bold size={14} /></ToolbarButton>
        <ToolbarButton onClick={() => exec("italic")} title="Cursiva (Ctrl+I)"><Italic size={14} /></ToolbarButton>
        <ToolbarButton onClick={() => exec("underline")} title="Subrayado (Ctrl+U)"><Underline size={14} /></ToolbarButton>
        <ToolbarSeparator />
        <ToolbarButton onClick={() => exec("insertUnorderedList")} title="Lista con viñetas"><List size={14} /></ToolbarButton>
        <ToolbarButton onClick={() => exec("insertOrderedList")} title="Lista numerada"><ListOrdered size={14} /></ToolbarButton>
        <ToolbarSeparator />
        <ToolbarButton onClick={insertarLink} title="Insertar enlace"><LinkIcon size={14} /></ToolbarButton>
        <ToolbarSeparator />
        <ToolbarButton onClick={() => exec("undo")} title="Deshacer (Ctrl+Z)"><Undo2 size={14} /></ToolbarButton>
        <ToolbarButton onClick={() => exec("redo")} title="Rehacer (Ctrl+Shift+Z)"><Redo2 size={14} /></ToolbarButton>
      </div>

      {/* Área editable */}
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        onInput={notifyChange}
        onBlur={notifyChange}
        // Estilos in-line para evitar conflicto con design system global.
        style={{
          minHeight,
          padding: "12px 14px",
          outline: "none",
          fontSize: 14,
          lineHeight: 1.5,
          color: "var(--text)",
          maxHeight: 420,
          overflowY: "auto",
        }}
        data-placeholder={placeholder}
        // Estilo del placeholder via :empty + ::before. Lo metemos con <style>
        // local más abajo para encapsularlo.
      />

      {/* Estilo del placeholder (sin tocar globales). */}
      <style>{`
        [contenteditable][data-placeholder]:empty::before {
          content: attr(data-placeholder);
          color: var(--text-muted);
          pointer-events: none;
        }
        [contenteditable] a {
          color: var(--primary);
          text-decoration: underline;
        }
        [contenteditable] ul, [contenteditable] ol {
          padding-left: 24px;
          margin: 6px 0;
        }
      `}</style>
    </div>
  );
}

function ToolbarButton({ onClick, title, children }) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault() /* no perder selección */}
      onClick={onClick}
      title={title}
      style={{
        background: "transparent",
        border: "1px solid transparent",
        borderRadius: 6,
        cursor: "pointer",
        padding: "4px 6px",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        color: "var(--text)",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "var(--surface)";
        e.currentTarget.style.borderColor = "var(--border)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
        e.currentTarget.style.borderColor = "transparent";
      }}
    >
      {children}
    </button>
  );
}

function ToolbarSeparator() {
  return (
    <div
      style={{
        width: 1,
        background: "var(--border)",
        margin: "2px 4px",
        alignSelf: "stretch",
      }}
    />
  );
}
