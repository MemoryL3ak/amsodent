import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Search, X, PackageSearch, Tag, Filter } from "lucide-react";
import { calcularLista3 } from "../lib/listas";

// Popup buscador de productos para usar dentro de la cotización, así no hay
// que abrir el módulo de Productos. Muestra el catálogo con filtros; al hacer
// clic en un producto lo devuelve vía onSelect.

const MAX_FILAS = 200;

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
}) {
  const [busqueda, setBusqueda] = useState("");
  const [categoria, setCategoria] = useState("");
  const [marca, setMarca] = useState("");
  // El listado es READ-ONLY — viene del tipo de compra y no se puede cambiar.
  const listado = String(listadoInicial || "2");
  const infoTC = ETIQUETA_TIPO_COMPRA[tipoCompra] || null;

  const categorias = useMemo(
    () => [...new Set((productos || []).map((p) => p.categoria).filter(Boolean))].sort(),
    [productos],
  );
  const marcas = useMemo(
    () => [...new Set((productos || []).map((p) => p.marca).filter(Boolean))].sort(),
    [productos],
  );

  const filtrados = useMemo(() => {
    const tokens = normalizar(busqueda).split(" ").filter(Boolean);
    return (productos || []).filter((p) => {
      if (categoria && p.categoria !== categoria) return false;
      if (marca && p.marca !== marca) return false;
      if (tokens.length === 0) return true;
      const texto = normalizar(`${p.sku || ""} ${p.nombre || ""} ${p.marca || ""}`);
      return tokens.every((t) => texto.includes(t));
    });
  }, [productos, busqueda, categoria, marca]);

  const visibles = filtrados.slice(0, MAX_FILAS);
  const hayFiltros = busqueda || categoria || marca;

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
              position: "relative",
              transition: "background .15s ease, transform .15s ease",
            }}
            title="Cerrar (Esc)"
          >
            <X size={18} />
          </button>
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
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
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
          <select
            value={categoria}
            onChange={(e) => setCategoria(e.target.value)}
            className="ppm-select"
            style={{
              padding: "0 12px",
              height: 40,
              borderRadius: 10,
              border: `1.5px solid ${TEAL_MID}`,
              fontSize: 13.5,
              minWidth: 170,
              background: "#fff",
              cursor: "pointer",
              outline: "none",
              transition: "border-color .15s, box-shadow .15s",
            }}
          >
            <option value="">Todas las categorías</option>
            {categorias.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <select
            value={marca}
            onChange={(e) => setMarca(e.target.value)}
            className="ppm-select"
            style={{
              padding: "0 12px",
              height: 40,
              borderRadius: 10,
              border: `1.5px solid ${TEAL_MID}`,
              fontSize: 13.5,
              minWidth: 150,
              background: "#fff",
              cursor: "pointer",
              outline: "none",
              transition: "border-color .15s, box-shadow .15s",
            }}
          >
            <option value="">Todas las marcas</option>
            {marcas.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
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
            }}
          >
            {busqueda && (
              <Chip onRemove={() => setBusqueda("")} icon={<Search size={11} />}>
                {busqueda}
              </Chip>
            )}
            {categoria && (
              <Chip onRemove={() => setCategoria("")} icon={<Filter size={11} />}>
                {categoria}
              </Chip>
            )}
            {marca && (
              <Chip onRemove={() => setMarca("")} icon={<Tag size={11} />}>
                {marca}
              </Chip>
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

  return createPortal(overlay, document.body);
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
`;
