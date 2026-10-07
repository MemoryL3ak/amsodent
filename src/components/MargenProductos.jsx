import { useMemo, useState } from "react";
import Select from "react-select";
import { Percent, Search, Sparkles } from "lucide-react";
import DropdownSelect from "./ui/DropdownSelect";
import BotonLimpiarFiltros from "./BotonLimpiarFiltros";
import {
  campanaAlcanza,
  estadoCampanaMargen,
  hoyEnChile,
  margenDePrecio,
  opcionesCatalogo,
  precioCampanaMargen,
  precioConDescuento,
  precioListaDe,
} from "../lib/campanasMargen";

/* ── Campañas de margen → Productos y margen (2026-10-07) ──────────────────
   Pedido de Ariel: "que nos permita traer el listado completo de los
   productos con los filtros correspondientes para visualizar KPIs con el
   promedio de margen según lo filtrado. Además, una modificación masiva del
   margen (margen a descontar)".
   · El catálogo completo con filtros (texto, marcas, categorías, lista, si
     está en campaña y por margen) y, para lo filtrado: margen promedio al
     precio de lista y con las campañas vigentes, cuántos quedan bajo 20 % y
     cuántos no tienen costo (no entran al promedio).
   · Descuento masivo: un % sobre el precio de lista de los filtrados.
     «Simular» muestra cómo quedaría el margen; «Crear campaña» abre la
     campaña ya armada (por marca/categoría si solo se filtró por eso, si no
     por los SKUs filtrados) para ponerle nombre y fechas y guardarla. El
     margen se mide igual que en la cotización: (precio − costo) / precio. */

const POR_PAGINA = 25;
const pesos = (n) => (Number(n) > 0 ? `$${Math.round(Number(n)).toLocaleString("es-CL")}` : "—");
const pct = (n) => (n == null || !Number.isFinite(n) ? "—" : `${n.toLocaleString("es-CL", { maximumFractionDigits: 1, minimumFractionDigits: 1 })} %`);
const sinTildes = (v) => String(v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
const colorMargen = (m) => (m == null ? "var(--text-muted)" : m < 0 ? "#b91c1c" : m < 20 ? "#b45309" : "#15803d");
const promedio = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

const estilosSelect = {
  control: (b, st) => ({ ...b, minHeight: 36, borderColor: st.isFocused ? "var(--primary)" : "var(--border-strong, #cbd5e1)", boxShadow: "none", fontSize: 13, borderRadius: 8 }),
  menuPortal: (b) => ({ ...b, zIndex: 12000 }),
  option: (b) => ({ ...b, fontSize: 13 }),
  multiValue: (b) => ({ ...b, borderRadius: 6 }),
};

export default function MargenProductos({ productos = [], campanas = [], esAdmin = false, onCrearCampana }) {
  const [q, setQ] = useState("");
  const [marcas, setMarcas] = useState([]);
  const [categorias, setCategorias] = useState([]);
  const [lista, setLista] = useState("1");
  const [enCampana, setEnCampana] = useState("todos");
  const [margenFiltro, setMargenFiltro] = useState("todos");
  const [orden, setOrden] = useState("margen_asc");
  const [paginaDe, setPaginaDe] = useState({ clave: "", n: 1 });
  const [descuento, setDescuento] = useState("");
  const [simuladoDe, setSimuladoDe] = useState(null);

  const hoy = hoyEnChile();
  const opciones = useMemo(() => opcionesCatalogo(productos), [productos]);
  // Vigentes de la más nueva a la más antigua: manda la más nueva (igual que al cotizar).
  const vigentes = useMemo(
    () => (campanas || []).filter((c) => estadoCampanaMargen(c, hoy) === "vigente").sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || ""))),
    [campanas, hoy],
  );

  const filas = useMemo(() => productos.map((p) => {
    const costo = Number(p.costo) || 0;
    const precioLista = precioListaDe(p, lista);
    const camp = precioCampanaMargen(p, lista, vigentes);
    const precioFinal = camp?.precio ?? precioLista;
    return {
      p,
      costo,
      precioLista,
      margenLista: costo > 0 && precioLista > 0 ? margenDePrecio(costo, precioLista) : null,
      campana: camp?.campana || null,
      precioFinal,
      margenFinal: costo > 0 && precioFinal > 0 ? margenDePrecio(costo, precioFinal) : null,
    };
  }), [productos, lista, vigentes]);

  const texto = sinTildes(q);
  const filtradas = useMemo(() => {
    const regla = { marcas, categorias, skus: [] };
    const out = filas.filter((f) => {
      if ((marcas.length || categorias.length) && !campanaAlcanza(f.p, regla)) return false;
      if (texto && !sinTildes(`${f.p.sku || ""} ${f.p.nombre || ""} ${f.p.marca || ""}`).includes(texto)) return false;
      if (enCampana === "con" && !f.campana) return false;
      if (enCampana === "sin" && f.campana) return false;
      if (margenFiltro === "bajo20" && !(f.margenFinal != null && f.margenFinal < 20)) return false;
      if (margenFiltro === "bajo_costo" && !(f.margenFinal != null && f.margenFinal < 0)) return false;
      if (margenFiltro === "sin_costo" && f.costo > 0) return false;
      if (margenFiltro === "sin_precio" && f.precioLista > 0) return false;
      return true;
    });
    const valor = (f) => (f.margenFinal == null ? Infinity : f.margenFinal);
    if (orden === "margen_asc") out.sort((a, b) => valor(a) - valor(b));
    else if (orden === "margen_desc") out.sort((a, b) => (b.margenFinal ?? -Infinity) - (a.margenFinal ?? -Infinity));
    else out.sort((a, b) => String(a.p.nombre || "").localeCompare(String(b.p.nombre || ""), "es"));
    return out;
  }, [filas, marcas, categorias, texto, enCampana, margenFiltro, orden]);

  const kpis = useMemo(() => {
    const conMargen = filtradas.filter((f) => f.margenLista != null);
    const conFinal = filtradas.filter((f) => f.margenFinal != null);
    return {
      total: filtradas.length,
      conCosto: conMargen.length,
      margenLista: promedio(conMargen.map((f) => f.margenLista)),
      margenFinal: promedio(conFinal.map((f) => f.margenFinal)),
      enCampana: filtradas.filter((f) => f.campana).length,
      bajo20: conFinal.filter((f) => f.margenFinal < 20).length,
      bajoCosto: conFinal.filter((f) => f.margenFinal < 0).length,
      sinCosto: filtradas.filter((f) => !(f.costo > 0)).length,
    };
  }, [filtradas]);

  // Al cambiar un filtro vuelve a la página 1 y se descarta la simulación anterior.
  const clave = JSON.stringify([texto, marcas, categorias, lista, enCampana, margenFiltro]);
  const pagina = paginaDe.clave === clave ? paginaDe.n : 1;
  const setPagina = (n) => setPaginaDe({ clave, n });
  const simulado = simuladoDe && simuladoDe.clave === clave ? simuladoDe.r : null;
  const setSimulado = (r) => setSimuladoDe(r ? { clave, r } : null);
  const paginas = Math.max(1, Math.ceil(filtradas.length / POR_PAGINA));
  const pag = Math.min(pagina, paginas);
  const visibles = filtradas.slice((pag - 1) * POR_PAGINA, pag * POR_PAGINA);
  const hayFiltros = q !== "" || marcas.length > 0 || categorias.length > 0 || enCampana !== "todos" || margenFiltro !== "todos";
  const limpiar = () => { setQ(""); setMarcas([]); setCategorias([]); setEnCampana("todos"); setMargenFiltro("todos"); };

  // ── Descuento masivo ──
  const d = descuento === "" ? NaN : Number(String(descuento).replace(",", "."));
  const dValido = Number.isFinite(d) && d >= 0 && d < 95;
  // Solo marcas/categorías filtradas → la campaña se arma por marca/categoría (alcanza también a los productos nuevos).
  const porRegla = !texto && enCampana === "todos" && margenFiltro === "todos" && (marcas.length > 0 || categorias.length > 0);
  const conSku = filtradas.filter((f) => String(f.p.sku || "").trim());
  const alcanzables = porRegla ? filtradas : conSku;

  function simular() {
    if (!dValido) { setSimulado({ error: "Indica un descuento entre 0 y 94,99 %." }); return; }
    const res = alcanzables.filter((f) => f.precioLista > 0).map((f) => {
      const precio = precioConDescuento(f.precioLista, d);
      return { ...f, precioNuevo: precio, margenNuevo: f.costo > 0 && precio > 0 ? margenDePrecio(f.costo, precio) : null };
    });
    const conM = res.filter((x) => x.margenNuevo != null);
    setSimulado({
      d,
      n: res.length,
      sinPrecio: alcanzables.length - res.length,
      sinSku: porRegla ? 0 : filtradas.length - conSku.length,
      margenAntes: promedio(conM.map((x) => x.margenFinal ?? x.margenLista).filter((m) => m != null)),
      margenNuevo: promedio(conM.map((x) => x.margenNuevo)),
      bajo20: conM.filter((x) => x.margenNuevo >= 0 && x.margenNuevo < 20).length,
      bajoCosto: conM.filter((x) => x.margenNuevo < 0).length,
      demasiados: !porRegla && conSku.length > 2000,
    });
  }

  function crearCampana() {
    if (!dValido) { setSimulado({ error: "Indica un descuento entre 0 y 94,99 %." }); return; }
    const etiqueta = porRegla ? [...marcas, ...categorias].slice(0, 3).join(", ") : `${conSku.length} productos`;
    onCrearCampana?.({
      nombre: `Descuento ${String(d).replace(".", ",")} % · ${etiqueta}`.slice(0, 120),
      lista_precios: lista,
      margen_pct: String(d).replace(".", ","),
      marcas: porRegla ? marcas : [],
      categorias: porRegla ? categorias : [],
      skus: porRegla ? [] : conSku.map((f) => String(f.p.sku).trim().toUpperCase()).slice(0, 2000),
    });
  }

  const valores = (lista_, sel) => sel.map((v) => lista_.find((o) => sinTildes(o.value) === sinTildes(v)) || { value: v, label: v });

  return (
    <div className="margen-productos" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div className="stats-row stats-5" style={{ marginBottom: 0 }}>
        <div className="stat-card">
          <div className="stat-label">Productos</div>
          <div className="stat-value">{kpis.total.toLocaleString("es-CL")}</div>
          <div className="stat-sub">{kpis.conCosto.toLocaleString("es-CL")} con costo y precio en Lista {lista}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Margen promedio · lista</div>
          <div className="stat-value" style={{ color: colorMargen(kpis.margenLista) }}>{pct(kpis.margenLista)}</div>
          <div className="stat-sub">al precio de Lista {lista}, sin campañas</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Margen promedio · hoy</div>
          <div className="stat-value" style={{ color: colorMargen(kpis.margenFinal) }}>{pct(kpis.margenFinal)}</div>
          <div className="stat-sub">con las campañas vigentes · {kpis.enCampana.toLocaleString("es-CL")} en campaña</div>
        </div>
        <div className="stat-card" style={{ cursor: "pointer" }} onClick={() => setMargenFiltro("bajo20")} title="Ver los que quedan bajo 20 %">
          <div className="stat-label">Bajo 20 %</div>
          <div className="stat-value" style={{ color: kpis.bajo20 ? "#b45309" : undefined }}>{kpis.bajo20.toLocaleString("es-CL")}</div>
          <div className="stat-sub">{kpis.bajoCosto ? `${kpis.bajoCosto.toLocaleString("es-CL")} bajo su costo · ` : ""}la cotización pide aprobación</div>
        </div>
        <div className="stat-card" style={{ cursor: "pointer" }} onClick={() => setMargenFiltro("sin_costo")} title="Ver los que no tienen costo">
          <div className="stat-label">Sin costo</div>
          <div className="stat-value">{kpis.sinCosto.toLocaleString("es-CL")}</div>
          <div className="stat-sub">no entran al promedio</div>
        </div>
      </div>

      <div className="filter-bar" style={{ alignItems: "flex-end", marginBottom: 0 }}>
        <div className="filter-field" style={{ flex: "2 1 220px", minWidth: 0 }}>
          <label className="filter-label">Buscar</label>
          <span style={{ position: "relative", display: "block" }}>
            <Search size={14} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)" }} />
            <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="SKU, nombre o marca…" style={{ width: "100%", paddingLeft: 30 }} />
          </span>
        </div>
        <div className="filter-field" style={{ flex: "2 1 220px", minWidth: 0 }}>
          <label className="filter-label">Marcas</label>
          <Select isMulti classNamePrefix="rs" value={valores(opciones.marcas, marcas)} onChange={(arr) => setMarcas((arr || []).map((o) => o.value))} options={opciones.marcas} placeholder="Todas" noOptionsMessage={() => "Sin coincidencias"} menuPortalTarget={typeof document !== "undefined" ? document.body : undefined} menuPosition="fixed" styles={estilosSelect} />
        </div>
        <div className="filter-field" style={{ flex: "2 1 220px", minWidth: 0 }}>
          <label className="filter-label">Categorías</label>
          <Select isMulti classNamePrefix="rs" value={valores(opciones.categorias, categorias)} onChange={(arr) => setCategorias((arr || []).map((o) => o.value))} options={opciones.categorias} placeholder="Todas" noOptionsMessage={() => "Sin coincidencias"} menuPortalTarget={typeof document !== "undefined" ? document.body : undefined} menuPosition="fixed" styles={estilosSelect} />
        </div>
        <div className="filter-field" style={{ flex: "1 1 120px", minWidth: 0 }}>
          <label className="filter-label">Lista</label>
          <DropdownSelect value={lista} onChange={setLista} minWidth={150} options={[{ value: "1", label: "Lista 1" }, { value: "2", label: "Lista 2" }, { value: "3", label: "Lista 3", detalle: "Licitación 9 a 24 meses" }]} />
        </div>
        <div className="filter-field" style={{ flex: "1 1 150px", minWidth: 0 }}>
          <label className="filter-label">Campaña</label>
          <DropdownSelect value={enCampana} onChange={setEnCampana} minWidth={190} options={[{ value: "todos", label: "Todos" }, { value: "con", label: "En campaña vigente" }, { value: "sin", label: "Sin campaña" }]} />
        </div>
        <div className="filter-field" style={{ flex: "1 1 150px", minWidth: 0 }}>
          <label className="filter-label">Margen</label>
          <DropdownSelect
            value={margenFiltro}
            onChange={setMargenFiltro}
            minWidth={200}
            options={[
              { value: "todos", label: "Todos" },
              { value: "bajo20", label: "Bajo 20 %", color: "#b45309" },
              { value: "bajo_costo", label: "Bajo su costo", color: "#b91c1c" },
              { value: "sin_costo", label: "Sin costo" },
              { value: "sin_precio", label: `Sin precio en Lista ${lista}` },
            ]}
          />
        </div>
        <BotonLimpiarFiltros hay={hayFiltros} onLimpiar={limpiar} />
      </div>

      {esAdmin && (
        <div className="surface descuento-masivo" style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
            <div className="filter-field" style={{ flex: "0 1 160px", minWidth: 120 }}>
              <label className="filter-label">Descuento masivo %</label>
              <input className="input" inputMode="decimal" value={descuento} onChange={(e) => { setDescuento(e.target.value.replace(/[^\d.,]/g, "")); setSimulado(null); }} placeholder="Ej: 10" title={`Descuento sobre el precio de Lista ${lista}`} />
            </div>
            <div style={{ fontSize: 12.5, color: "var(--text-muted)", flex: "1 1 260px", minWidth: 0, paddingBottom: 6 }}>
              {porRegla
                ? <>Se aplica a <b>{[...marcas, ...categorias].join(", ")}</b> en Lista {lista} ({filtradas.length.toLocaleString("es-CL")} productos hoy, y los que se agreguen).</>
                : <>Se aplica a los <b>{conSku.length.toLocaleString("es-CL")} productos filtrados con SKU</b> en Lista {lista}{filtradas.length - conSku.length > 0 ? ` (${(filtradas.length - conSku.length).toLocaleString("es-CL")} sin SKU quedan fuera)` : ""}.</>}
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button type="button" className="btn btn-secondary btn-sm" onClick={simular} disabled={!alcanzables.length}>
                <Sparkles size={13} /> Simular
              </button>
              <button type="button" className="btn btn-primary btn-sm" onClick={crearCampana} disabled={!alcanzables.length || !dValido || (!porRegla && conSku.length > 2000)} title="Abre la campaña ya armada para ponerle nombre y fechas">
                <Percent size={13} /> Crear campaña
              </button>
            </div>
          </div>
          {simulado?.error && <div style={{ fontSize: 12.5, color: "#b91c1c" }}>{simulado.error}</div>}
          {simulado && !simulado.error && (
            <div className="simulacion-masiva" style={{ fontSize: 12.5, lineHeight: 1.5, border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", background: "var(--bg)" }}>
              Con {simulado.d.toLocaleString("es-CL")} % de descuento, <b>{simulado.n.toLocaleString("es-CL")} productos</b> pasan de un margen promedio de{" "}
              <b style={{ color: colorMargen(simulado.margenAntes) }}>{pct(simulado.margenAntes)}</b> a <b style={{ color: colorMargen(simulado.margenNuevo) }}>{pct(simulado.margenNuevo)}</b>.
              {simulado.bajoCosto > 0 && <span style={{ color: "#b91c1c", fontWeight: 600 }}> {simulado.bajoCosto.toLocaleString("es-CL")} quedarían bajo su costo.</span>}
              {simulado.bajo20 > 0 && <span style={{ color: "#b45309", fontWeight: 600 }}> {simulado.bajo20.toLocaleString("es-CL")} con menos de 20 % (la cotización pide aprobación).</span>}
              {simulado.sinPrecio > 0 && <span> {simulado.sinPrecio.toLocaleString("es-CL")} sin precio en Lista {lista} no cambian.</span>}
              {simulado.demasiados && <span style={{ color: "#b91c1c" }}> Son más de 2.000 SKUs: filtra solo por marca o categoría para armarla por regla.</span>}
              {" "}No se cambió nada: «Crear campaña» la deja lista para revisar y guardar.
            </div>
          )}
        </div>
      )}

      <div className="surface">
        <div className="table-scroll">
          <table className="data-table tabla-compacta tabla-texto tabla-margen-productos" style={{ width: "100%", minWidth: 860 }}>
            <thead>
              <tr>
                <th>SKU</th>
                <th>Producto</th>
                <th style={{ textAlign: "right" }}>Costo</th>
                <th style={{ textAlign: "right" }}>Lista {lista}</th>
                <th style={{ textAlign: "right" }}>Margen</th>
                <th>Campaña vigente</th>
                <th style={{ textAlign: "right" }}>Margen hoy</th>
              </tr>
            </thead>
            <tbody>
              {visibles.length === 0 ? (
                <tr><td colSpan={7} style={{ textAlign: "center", padding: 28, color: "var(--text-muted)" }}>{productos.length ? "Ningún producto calza con los filtros." : "Cargando el catálogo…"}</td></tr>
              ) : visibles.map((f) => (
                <tr key={f.p.id}>
                  <td style={{ whiteSpace: "nowrap", fontFamily: "ui-monospace, monospace", fontSize: 12 }}>{f.p.sku || <span style={{ color: "var(--text-muted)" }}>sin SKU</span>}</td>
                  <td>
                    <div style={{ fontWeight: 600 }}>{f.p.nombre}</div>
                    <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>{[f.p.marca, f.p.categoria].filter(Boolean).join(" · ") || "—"}</div>
                  </td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>{pesos(f.costo)}</td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>{pesos(f.precioLista)}</td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap", fontWeight: 600, color: colorMargen(f.margenLista) }}>{pct(f.margenLista)}</td>
                  <td style={{ fontSize: 12 }}>
                    {f.campana
                      ? <><b>{pesos(f.precioFinal)}</b> <span style={{ color: "var(--text-muted)" }}>· −{Number(f.campana.margen_pct).toLocaleString("es-CL")} % · {f.campana.nombre}</span></>
                      : <span style={{ color: "var(--text-muted)" }}>—</span>}
                  </td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap", fontWeight: 700, color: colorMargen(f.margenFinal) }}>{pct(f.margenFinal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 12px", flexWrap: "wrap", gap: 8 }}>
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
            {filtradas.length ? `Mostrando ${(pag - 1) * POR_PAGINA + 1}–${Math.min(pag * POR_PAGINA, filtradas.length)} de ${filtradas.length.toLocaleString("es-CL")} productos` : ""}
          </span>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <DropdownSelect value={orden} onChange={setOrden} minWidth={190} style={{ width: 190 }} options={[{ value: "margen_asc", label: "Menor margen primero" }, { value: "margen_desc", label: "Mayor margen primero" }, { value: "nombre", label: "Por nombre" }]} />
            {paginas > 1 && (
              <>
                <button type="button" className="btn btn-secondary btn-sm" disabled={pag <= 1} onClick={() => setPagina(pag - 1)}>← Anterior</button>
                <span style={{ fontSize: 12.5, fontWeight: 700 }}>{pag} / {paginas}</span>
                <button type="button" className="btn btn-secondary btn-sm" disabled={pag >= paginas} onClick={() => setPagina(pag + 1)}>Siguiente →</button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
