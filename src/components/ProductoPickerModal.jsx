import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Search, X, PackageSearch, Tag, Filter, Check, ChevronDown, Plus } from "lucide-react";
import { calcularLista3 } from "../lib/listas";
import CrearProductoModal from "./CrearProductoModal";

// Popup buscador de productos para usar dentro de la cotización, así no hay
// que abrir el módulo de Productos. Muestra el catálogo con filtros; al hacer
// clic en un producto lo devuelve vía onSelect.

const MAX_FILAS = 80;

// Pre-normaliza el texto buscable de cada producto una sola vez (memo por
// instancia del componente) — evita normalizar 20k strings en cada tecla.

// Paleta de la plataforma (turquesa corporativo)
const TEAL = "#25b7bd";
const TEAL_OSC = "#178a8f";
const TEAL_DEEP = "#0e6e74";
const TEAL_SOFT = "#e8f7f7";
const TEAL_MID = "#b2e4e5";

function normalizar(s = "") {
  return String(s)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// Precio neto del producto según el listado de precios seleccionado.
function precioPorLista(p, listado) {
  if (String(listado) === "3") {
    const explicito = Number(p?.lista3 || 0);
    if (explicito > 0) return explicito;
    return calcularLista3(p?.lista2);
  }
  return Number(p?.[`lista${listado}`] || 0);
}

// Texto descriptivo del tipo de compra que justifica el listado de precios.
// El select de lista está bloqueado — la lista la determina el tipo de compra
// de la cotización para evitar errores manuales.
const ETIQUETA_TIPO_COMPRA = {
  "Cliente particular":          { lista: "1", texto: "Cliente particular" },
  "Compra ágil":                 { lista: "2", texto: "Compra ágil" },
  "Compra directa":              { lista: "2", texto: "Compra directa" },
  "Licitación 0 a 8 meses":      { lista: "2", texto: "Licitación 0 a 8 meses" },
  "Licitación 9 a 24 meses":     { lista: "3", texto: "Licitación 9 a 24 meses" },
};

export default function ProductoPickerModal({
  productos,
  onSelect,
  onClose,
  listadoInicial,
  tipoCompra,
  onProductoCreado,
}) {
  const [busqueda, setBusqueda] = useState("");
  const [busquedaInput, setBusquedaInput] = useState(""); // input controlado (sin debounce)
  const [categoriasSel, setCategoriasSel] = useState([]); // array de strings
  const [marcasSel, setMarcasSel] = useState([]);
  const [mostrarCrear, setMostrarCrear] = useState(false);
  // El listado es READ-ONLY — viene del tipo de compra y no se puede cambiar.
  const listado = String(listadoInicial || "2");
  const infoTC = ETIQUETA_TIPO_COMPRA[tipoCompra] || null;

  // Debounce de la búsqueda: el input responde al instante pero el filtrado
  // sobre 20k productos solo se dispara cuando deja de tipear ~150ms.
  useEffect(() => {
    const t = setTimeout(() => setBusqueda(busquedaInput), 150);
    return () => clearTimeout(t);
  }, [busquedaInput]);

  // Pre-cómputo: categorías, marcas y texto normalizado por producto.
  // Esto se hace una sola vez cuando cambia `productos` (no en cada tecla).
  const { categorias, marcas, productosNorm } = useMemo(() => {
    const cats = new Set();
    const mar = new Set();
    const norm = (productos || []).map((p) => {
      if (p.categoria) cats.add(p.categoria);
      if (p.marca) mar.add(p.marca);
      return {
        p,
        texto: normalizar(`${p.sku || ""} ${p.nombre || ""} ${p.marca || ""}`),
      };
    });
    return {
      categorias: [...cats].sort(),
      marcas: [...mar].sort(),
      productosNorm: norm,
    };
  }, [productos]);

  const filtrados = useMemo(() => {
    const tokens = normalizar(busqueda).split(" ").filter(Boolean);
    const setCat = new Set(categoriasSel);
    const setMar = new Set(marcasSel);
    const hayCat = setCat.size > 0;
    const hayMar = setMar.size > 0;
    const hayTokens = tokens.length > 0;
    const out = [];
    for (let i = 0; i < productosNorm.length; i++) {
      const { p, texto } = productosNorm[i];
      if (hayCat && !setCat.has(p.categoria)) continue;
      if (hayMar && !setMar.has(p.marca)) continue;
      if (hayTokens) {
        let ok = true;
        for (let j = 0; j < tokens.length; j++) {
          if (!texto.includes(tokens[j])) { ok = false; break; }
        }
        if (!ok) continue;
      }
      out.push(p);
    }
    return out;
  }, [productosNorm, busqueda, categoriasSel, marcasSel]);

  const visibles = filtrados.slice(0, MAX_FILAS);
  const hayFiltros = busqueda || categoriasSel.length > 0 || marcasSel.length > 0;

  const overlay = (
    <div
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15,23,42,.55)",
        backdropFilter: "blur(4px)",
        WebkitBackdropFilter: "blur(4px)",
        zIndex: 11000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        animation: "ppm-fade-in .18s ease",
      }}
    >
      <style>{ESTILOS_PPM}</style>

      <div
        style={{
          width: 880,
          maxWidth: "100%",
          height: "86vh",
          background: "#fff",
          borderRadius: 18,
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          boxShadow:
            "0 32px 80px -16px rgba(15,23,42,.45), 0 12px 28px -10px rgba(37,183,189,.25)",
          animation: "ppm-pop .25s cubic-bezier(.4, 0, .2, 1)",
        }}
      >
        {/* Header con gradiente turquesa */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "18px 22px",
            background: `linear-gradient(135deg, ${TEAL} 0%, ${TEAL_OSC} 100%)`,
            color: "#fff",
            position: "relative",
            overflow: "hidden",
          }}
        >
          {/* Efecto de brillo sutil */}
          <div
            style={{
              position: "absolute",
              top: -40,
              right: -40,
              width: 180,
              height: 180,
              borderRadius: "50%",
              background: "radial-gradient(circle, rgba(255,255,255,.18), transparent 70%)",
              pointerEvents: "none",
            }}
          />
          <div style={{ display: "flex", alignItems: "center", gap: 12, position: "relative" }}>
            <div
              style={{
                width: 38,
                height: 38,
                borderRadius: 11,
                background: "rgba(255,255,255,.22)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                backdropFilter: "blur(4px)",
              }}
            >
              <PackageSearch size={20} strokeWidth={2.2} />
            </div>
            <div>
              <div style={{ fontWeight: 800, fontSize: 16, letterSpacing: "-.01em" }}>
                Buscar producto en el catálogo
              </div>
              <div style={{ fontSize: 12, opacity: 0.88, marginTop: 1 }}>
                Filtra por SKU, nombre, marca o categoría — clic para agregar
              </div>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, position: "relative" }}>
            <button
              type="button"
              onClick={() => setMostrarCrear(true)}
              className="ppm-crear-btn"
              title="Crear un nuevo producto"
            >
              <Plus size={14} strokeWidth={2.8} />
              <span>Nuevo producto</span>
            </button>
            <button
              type="button"
              onClick={() => onClose?.()}
              className="ppm-close-btn"
              style={{
                background: "rgba(255,255,255,.18)",
                border: "none",
                color: "#fff",
                cursor: "pointer",
                padding: 7,
                borderRadius: 9,
                display: "inline-flex",
                transition: "background .15s ease, transform .15s ease",
              }}
              title="Cerrar (Esc)"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Barra de filtros */}
        <div
          style={{
            display: "flex",
            gap: 10,
            padding: "14px 18px",
            borderBottom: "1px solid #e7eef0",
            background: "linear-gradient(180deg, #fafdfd 0%, #ffffff 100%)",
            flexWrap: "wrap",
          }}
        >
          <div style={{ position: "relative", flex: "1 1 240px", minWidth: 200 }}>
            <Search
              size={15}
              style={{
                position: "absolute",
                left: 12,
                top: "50%",
                transform: "translateY(-50%)",
                color: TEAL,
                pointerEvents: "none",
              }}
            />
            <input
              autoFocus
              type="text"
              value={busquedaInput}
              onChange={(e) => setBusquedaInput(e.target.value)}
              placeholder="Buscar por SKU, nombre o marca…"
              className="ppm-input"
              style={{
                width: "100%",
                height: 40,
                padding: "0 14px 0 36px",
                borderRadius: 10,
                border: `1.5px solid ${TEAL_MID}`,
                fontSize: 13.5,
                outline: "none",
                boxSizing: "border-box",
                background: "#fff",
                transition: "border-color .15s, box-shadow .15s",
              }}
            />
          </div>
          <MultiSelect
            placeholder="Todas las categorías"
            opciones={categorias}
            seleccionados={categoriasSel}
            onChange={setCategoriasSel}
            icon={<Filter size={14} />}
            minWidth={190}
          />
          <MultiSelect
            placeholder="Todas las marcas"
            opciones={marcas}
            seleccionados={marcasSel}
            onChange={setMarcasSel}
            icon={<Tag size={14} />}
            minWidth={160}
          />
          {/* Badge read-only del listado de precios — lo determina el tipo
              de compra de la cotización, no se puede cambiar manualmente. */}
          <div
            title={
              infoTC
                ? `Lista de precios ${listado} (por tipo de compra: ${infoTC.texto})`
                : `Lista de precios ${listado}`
            }
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "0 14px",
              height: 40,
              borderRadius: 10,
              border: `1.5px solid ${TEAL}`,
              background: `linear-gradient(135deg, ${TEAL_SOFT} 0%, #d4f0f1 100%)`,
              color: TEAL_DEEP,
              fontSize: 13,
              fontWeight: 700,
              minWidth: 160,
              boxShadow: "0 1px 3px -1px rgba(37,183,189,.2)",
              userSelect: "none",
            }}
          >
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: 22,
                height: 22,
                borderRadius: 7,
                background: TEAL,
                color: "#fff",
                fontSize: 11.5,
                fontWeight: 800,
                lineHeight: 1,
              }}
            >
              L{listado}
            </span>
            <span style={{ display: "flex", flexDirection: "column", lineHeight: 1.15 }}>
              <span style={{ fontSize: 12.5, fontWeight: 800 }}>Lista de precios {listado}</span>
              {infoTC && (
                <span style={{ fontSize: 10.5, opacity: 0.85, fontWeight: 500 }}>
                  {infoTC.texto}
                </span>
              )}
            </span>
          </div>
        </div>

        {/* Chips de filtros activos */}
        {hayFiltros && (
          <div
            style={{
              display: "flex",
              gap: 6,
              flexWrap: "wrap",
              padding: "10px 18px 0",
              fontSize: 11.5,
              alignItems: "center",
            }}
          >
            {busqueda && (
              <Chip
                onRemove={() => {
                  setBusqueda("");
                  setBusquedaInput("");
                }}
                icon={<Search size={11} />}
              >
                {busqueda}
              </Chip>
            )}
            {categoriasSel.map((c) => (
              <Chip
                key={`cat-${c}`}
                onRemove={() => setCategoriasSel(categoriasSel.filter((x) => x !== c))}
                icon={<Filter size={11} />}
              >
                {c}
              </Chip>
            ))}
            {marcasSel.map((m) => (
              <Chip
                key={`mar-${m}`}
                onRemove={() => setMarcasSel(marcasSel.filter((x) => x !== m))}
                icon={<Tag size={11} />}
              >
                {m}
              </Chip>
            ))}
            {(categoriasSel.length > 0 || marcasSel.length > 0 || busqueda) && (
              <button
                type="button"
                onClick={() => {
                  setBusqueda("");
                  setBusquedaInput("");
                  setCategoriasSel([]);
                  setMarcasSel([]);
                }}
                style={{
                  marginLeft: 4,
                  background: "transparent",
                  border: "none",
                  color: "#64748b",
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: "pointer",
                  textDecoration: "underline",
                  padding: "2px 4px",
                }}
              >
                Limpiar filtros
              </button>
            )}
          </div>
        )}

        {/* Tabla */}
        <div style={{ overflowY: "auto", flex: 1, padding: "8px 0" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr
                style={{
                  position: "sticky",
                  top: 0,
                  background: "linear-gradient(180deg, #f4fafb 0%, #eaf5f6 100%)",
                  zIndex: 1,
                  boxShadow: "0 1px 0 #d4ebec",
                }}
              >
                <Th>SKU</Th>
                <Th>Producto</Th>
                <Th>Marca</Th>
                <Th>Categoría</Th>
                <Th>Formato</Th>
                <Th align="right">Precio (Lista {listado})</Th>
              </tr>
            </thead>
            <tbody>
              {visibles.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ padding: 60, textAlign: "center", color: "#64748b" }}>
                    <div
                      style={{
                        width: 56,
                        height: 56,
                        borderRadius: 16,
                        background: TEAL_SOFT,
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        marginBottom: 12,
                      }}
                    >
                      <PackageSearch size={26} style={{ color: TEAL }} strokeWidth={2} />
                    </div>
                    <div style={{ fontWeight: 700, color: "#1a1d23", marginBottom: 4 }}>
                      Sin resultados
                    </div>
                    <div style={{ fontSize: 12.5 }}>
                      Probá con otros filtros o palabras clave.
                    </div>
                  </td>
                </tr>
              ) : (
                visibles.map((p) => (
                  <tr
                    key={p.id}
                    onClick={() => onSelect?.(p)}
                    className="ppm-row"
                    style={{ cursor: "pointer", borderBottom: "1px solid #f1f5f9" }}
                  >
                    <Td mono>{p.sku || "—"}</Td>
                    <Td bold>{p.nombre || "—"}</Td>
                    <Td>
                      {p.marca ? (
                        <span
                          style={{
                            display: "inline-block",
                            padding: "2px 8px",
                            borderRadius: 6,
                            background: TEAL_SOFT,
                            color: TEAL_DEEP,
                            fontSize: 11.5,
                            fontWeight: 600,
                          }}
                        >
                          {p.marca}
                        </span>
                      ) : (
                        "—"
                      )}
                    </Td>
                    <Td>{p.categoria || "—"}</Td>
                    <Td>{p.formato || "—"}</Td>
                    <Td bold align="right">
                      <span style={{ color: TEAL_DEEP, fontWeight: 800 }}>
                        ${precioPorLista(p, listado).toLocaleString("es-CL")}
                      </span>
                    </Td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div
          style={{
            padding: "10px 18px",
            borderTop: "1px solid #e7eef0",
            background: "linear-gradient(180deg, #fafdfd 0%, #f4fafb 100%)",
            fontSize: 12,
            color: "#64748b",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                minWidth: 22,
                height: 22,
                padding: "0 8px",
                borderRadius: 999,
                background: TEAL,
                color: "#fff",
                fontSize: 11,
                fontWeight: 800,
                lineHeight: 1,
              }}
            >
              {filtrados.length}
            </span>
            <strong style={{ color: "#1a1d23" }}>
              {filtrados.length === 1 ? "producto" : "productos"}
            </strong>
            {filtrados.length > MAX_FILAS && (
              <span>· mostrando los primeros {MAX_FILAS}, refina la búsqueda</span>
            )}
          </span>
          <span style={{ color: "#94a3b8" }}>
            Click en una fila para agregarlo
          </span>
        </div>
      </div>
    </div>
  );

  return (
    <>
      {createPortal(overlay, document.body)}
      {mostrarCrear && (
        <CrearProductoModal
          onClose={() => setMostrarCrear(false)}
          onCreado={(productoCreado, estadoFinal) => {
            setMostrarCrear(false);
            // Si quedó Pendiente Aprobación → solo notificar, no agregar al ítem
            // (no se puede usar hasta que admin lo apruebe).
            if (estadoFinal === "Pendiente Aprobación") {
              onProductoCreado?.(productoCreado, estadoFinal);
              return;
            }
            // Producto válido: notificar al parent para refrescar el catálogo
            // y seleccionar el producto recién creado en la cotización.
            onProductoCreado?.(productoCreado, estadoFinal);
            onSelect?.(productoCreado);
          }}
        />
      )}
    </>
  );
}

function Th({ children, align = "left" }) {
  return (
    <th
      style={{
        textAlign: align,
        padding: "11px 14px",
        fontSize: 10.5,
        textTransform: "uppercase",
        letterSpacing: ".7px",
        color: TEAL_DEEP,
        fontWeight: 800,
        borderBottom: `1px solid ${TEAL_MID}`,
      }}
    >
      {children}
    </th>
  );
}

function Td({ children, bold, mono, align = "left" }) {
  return (
    <td
      style={{
        padding: "10px 14px",
        color: bold ? "#0f172a" : "#334155",
        fontWeight: bold ? 600 : 400,
        fontFamily: mono ? "ui-monospace, SFMono-Regular, monospace" : "inherit",
        textAlign: align,
        fontSize: 12.5,
      }}
    >
      {children}
    </td>
  );
}

function MultiSelect({ placeholder, opciones, seleccionados, onChange, icon, minWidth = 160 }) {
  const [abierto, setAbierto] = useState(false);
  const [busca, setBusca] = useState("");
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!abierto) return undefined;
    function onClick(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setAbierto(false);
        setBusca("");
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [abierto]);

  const opcionesFiltradas = useMemo(() => {
    const q = String(busca || "").toLowerCase().trim();
    if (!q) return opciones;
    return opciones.filter((o) => String(o).toLowerCase().includes(q));
  }, [opciones, busca]);

  function toggle(valor) {
    if (seleccionados.includes(valor)) {
      onChange(seleccionados.filter((x) => x !== valor));
    } else {
      onChange([...seleccionados, valor]);
    }
  }

  const cant = seleccionados.length;
  const etiqueta =
    cant === 0
      ? placeholder
      : cant === 1
        ? seleccionados[0]
        : `${cant} seleccionadas`;

  return (
    <div ref={wrapRef} style={{ position: "relative", minWidth }}>
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        className="ppm-select"
        style={{
          width: "100%",
          height: 40,
          padding: "0 12px",
          borderRadius: 10,
          border: `1.5px solid ${cant > 0 ? TEAL : TEAL_MID}`,
          background: cant > 0 ? TEAL_SOFT : "#fff",
          fontSize: 13.5,
          cursor: "pointer",
          outline: "none",
          transition: "all .15s ease",
          display: "flex",
          alignItems: "center",
          gap: 8,
          textAlign: "left",
          color: cant > 0 ? TEAL_DEEP : "#475569",
          fontWeight: cant > 0 ? 700 : 500,
        }}
      >
        <span style={{ display: "inline-flex", alignItems: "center", color: cant > 0 ? TEAL : "#94a3b8", flexShrink: 0 }}>
          {icon}
        </span>
        <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {etiqueta}
        </span>
        {cant > 0 && (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              minWidth: 20,
              height: 20,
              padding: "0 6px",
              borderRadius: 999,
              background: TEAL,
              color: "#fff",
              fontSize: 11,
              fontWeight: 800,
              lineHeight: 1,
              flexShrink: 0,
            }}
          >
            {cant}
          </span>
        )}
        <ChevronDown
          size={14}
          style={{
            color: cant > 0 ? TEAL_DEEP : "#94a3b8",
            flexShrink: 0,
            transition: "transform .2s ease",
            transform: abierto ? "rotate(180deg)" : "rotate(0)",
          }}
        />
      </button>

      {abierto && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            left: 0,
            right: 0,
            zIndex: 12000,
            background: "#fff",
            borderRadius: 12,
            border: `1px solid ${TEAL_MID}`,
            boxShadow: "0 20px 50px -12px rgba(15,23,42,.25), 0 4px 12px -4px rgba(37,183,189,.18)",
            overflow: "hidden",
            animation: "ppm-fade-in .14s ease",
            minWidth: 240,
          }}
        >
          {/* Buscador interno + acciones */}
          <div style={{ padding: 8, borderBottom: `1px solid #eef2f5`, display: "flex", gap: 6, alignItems: "center" }}>
            <div style={{ position: "relative", flex: 1 }}>
              <Search
                size={12}
                style={{
                  position: "absolute",
                  left: 9,
                  top: "50%",
                  transform: "translateY(-50%)",
                  color: "#94a3b8",
                  pointerEvents: "none",
                }}
              />
              <input
                autoFocus
                type="text"
                placeholder="Buscar…"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                className="ppm-input"
                style={{
                  width: "100%",
                  height: 30,
                  padding: "0 8px 0 28px",
                  borderRadius: 7,
                  border: `1px solid ${TEAL_MID}`,
                  fontSize: 12.5,
                  outline: "none",
                  boxSizing: "border-box",
                }}
              />
            </div>
            {cant > 0 && (
              <button
                type="button"
                onClick={() => onChange([])}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "#dc2626",
                  cursor: "pointer",
                  fontSize: 11,
                  fontWeight: 700,
                  padding: "0 6px",
                  whiteSpace: "nowrap",
                }}
                title="Limpiar selección"
              >
                Limpiar
              </button>
            )}
          </div>

          <div style={{ maxHeight: 260, overflowY: "auto", padding: 4 }}>
            {opcionesFiltradas.length === 0 ? (
              <div style={{ padding: "14px 12px", textAlign: "center", color: "#94a3b8", fontSize: 12 }}>
                Sin coincidencias
              </div>
            ) : (
              opcionesFiltradas.map((op) => {
                const activa = seleccionados.includes(op);
                return (
                  <button
                    key={op}
                    type="button"
                    onClick={() => toggle(op)}
                    className="ppm-opt"
                    style={{
                      width: "100%",
                      display: "flex",
                      alignItems: "center",
                      gap: 9,
                      padding: "7px 10px",
                      borderRadius: 7,
                      border: "none",
                      background: activa ? TEAL_SOFT : "transparent",
                      color: activa ? TEAL_DEEP : "#1a1d23",
                      fontSize: 12.5,
                      fontWeight: activa ? 700 : 500,
                      cursor: "pointer",
                      textAlign: "left",
                      transition: "background .1s ease",
                    }}
                  >
                    <span
                      style={{
                        width: 16,
                        height: 16,
                        borderRadius: 5,
                        border: `1.5px solid ${activa ? TEAL : "#cbd5e1"}`,
                        background: activa ? TEAL : "#fff",
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                        transition: "all .12s ease",
                      }}
                    >
                      {activa && <Check size={11} color="#fff" strokeWidth={3.5} />}
                    </span>
                    <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {op}
                    </span>
                  </button>
                );
              })
            )}
          </div>

          {/* Footer informativo */}
          <div
            style={{
              padding: "6px 10px",
              borderTop: "1px solid #eef2f5",
              fontSize: 10.5,
              color: "#94a3b8",
              background: "#fafdfd",
              fontWeight: 500,
            }}
          >
            {opcionesFiltradas.length} {opcionesFiltradas.length === 1 ? "opción" : "opciones"}
            {cant > 0 && ` · ${cant} seleccionada${cant === 1 ? "" : "s"}`}
          </div>
        </div>
      )}
    </div>
  );
}

function Chip({ children, icon, onRemove }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "4px 10px 4px 8px",
        borderRadius: 999,
        background: TEAL_SOFT,
        color: TEAL_DEEP,
        border: `1px solid ${TEAL_MID}`,
        fontWeight: 700,
        animation: "ppm-fade-in .2s ease",
      }}
    >
      {icon}
      <span style={{ maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {children}
      </span>
      <button
        type="button"
        onClick={onRemove}
        style={{
          background: "transparent",
          border: "none",
          color: TEAL_DEEP,
          cursor: "pointer",
          padding: 0,
          marginLeft: 2,
          display: "inline-flex",
          opacity: 0.65,
        }}
        title="Quitar filtro"
      >
        <X size={12} />
      </button>
    </span>
  );
}

const ESTILOS_PPM = `
@keyframes ppm-fade-in { from { opacity: 0; } to { opacity: 1; } }
@keyframes ppm-pop {
  from { opacity: 0; transform: translateY(14px) scale(.97); }
  to   { opacity: 1; transform: none; }
}
.ppm-input:focus, .ppm-select:focus {
  border-color: ${TEAL} !important;
  box-shadow: 0 0 0 3px rgba(37,183,189,.15) !important;
}
.ppm-close-btn:hover {
  background: rgba(255,255,255,.3) !important;
  transform: scale(1.05);
}
.ppm-crear-btn {
  display: inline-flex; align-items: center; gap: 6px;
  height: 34px; padding: 0 14px;
  border-radius: 999px;
  background: linear-gradient(135deg, rgba(255,255,255,.98) 0%, rgba(255,255,255,.85) 100%);
  color: ${TEAL_DEEP};
  border: none; cursor: pointer;
  font-size: 12.5px; font-weight: 800; letter-spacing: .02em;
  box-shadow: 0 4px 12px -3px rgba(0,0,0,.25), inset 0 1px 0 rgba(255,255,255,.6);
  transition: transform .15s ease, box-shadow .15s ease, background .15s ease;
  position: relative;
  overflow: hidden;
}
.ppm-crear-btn::before {
  content: ""; position: absolute; inset: 0;
  background: linear-gradient(120deg, transparent 30%, rgba(37,183,189,.18) 50%, transparent 70%);
  transform: translateX(-100%);
  transition: transform .55s ease;
}
.ppm-crear-btn:hover {
  transform: translateY(-1px) scale(1.03);
  box-shadow: 0 8px 20px -4px rgba(0,0,0,.32), inset 0 1px 0 rgba(255,255,255,.6);
}
.ppm-crear-btn:hover::before { transform: translateX(100%); }
.ppm-crear-btn:active { transform: scale(.97); }
.ppm-row {
  transition: background .12s ease, transform .12s ease, box-shadow .12s ease;
}
.ppm-row:hover {
  background: ${TEAL_SOFT};
  box-shadow: inset 3px 0 0 ${TEAL};
}
.ppm-row:active {
  transform: scale(.998);
}
.ppm-opt:hover {
  background: ${TEAL_SOFT} !important;
}
`;
