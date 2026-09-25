import { useMemo, useState } from "react";
import { api } from "../lib/api";
import Toast from "../components/Toast";
import BotonLimpiarFiltros from "../components/BotonLimpiarFiltros";
import DropdownSelect from "../components/ui/DropdownSelect";
import { Search, ExternalLink, Store, TrendingDown, TrendingUp, AlertTriangle } from "lucide-react";

/* ── Explorador de Precios — plataforma interna (2026-09-24) ───────────────
   El mismo buscador que el cliente tiene en su portal, ahora acá y solo para
   admin. Por qué hacía falta: hasta ahora, para saber a qué precio está la
   competencia había que entrar al portal del cliente con un RUT prestado, o
   abrir las tiendas a mano una por una.

   Consume /stock-clientes/explorador/interno, que es la misma búsqueda del
   portal pero detrás de AdminGuard. Las tiendas que consulta se administran
   desde Acceso al Portal → Tiendas del explorador.

   La diferencia con la versión del cliente no es el buscador, es para qué se
   usa: acá el dato que importa es dónde queda NUESTRO precio, así que arriba
   va el resumen de la búsqueda (mínimo del mercado, nuestro precio y la
   brecha) y las tarjetas se ordenan con Amsodent primero, igual que allá. */

const fmtMoneda = (n) => {
  const v = Number(n);
  return Number.isFinite(v) && v > 0 ? `$${Math.round(v).toLocaleString("es-CL")}` : "—";
};

export default function ExploradorPrecios() {
  const [q, setQ] = useState("");
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState("");
  const [resultado, setResultado] = useState(null);
  const [tiendaFiltro, setTiendaFiltro] = useState("");
  const [soloConHistorial, setSoloConHistorial] = useState(false);
  const [toast, setToast] = useState(null);

  async function buscar(e) {
    e?.preventDefault?.();
    const termino = q.trim();
    if (termino.length < 3) {
      setError("Escribe al menos 3 letras para buscar.");
      return;
    }
    setCargando(true);
    setError("");
    setTiendaFiltro("");
    try {
      const r = await api.get(`/stock-clientes/explorador/interno?q=${encodeURIComponent(termino)}`);
      setResultado(r);
      if (r?.tiendas_sin_respuesta?.length) {
        setToast({
          type: "info",
          message: `No respondieron: ${r.tiendas_sin_respuesta.join(", ")}. El resto sí.`,
        });
      }
    } catch (err) {
      setError(err?.message || "No se pudo consultar a las tiendas.");
      setResultado(null);
    } finally {
      setCargando(false);
    }
  }

  const items = useMemo(() => {
    const todos = resultado?.items || [];
    return todos.filter((it) => {
      if (tiendaFiltro && it.tienda_nombre !== tiendaFiltro) return false;
      if (soloConHistorial && !it.historico) return false;
      return true;
    });
  }, [resultado, tiendaFiltro, soloConHistorial]);

  /* Resumen de la búsqueda: es lo que se viene a mirar. "Nuestro" es el
     hallazgo más barato de la tienda de Amsodent; la brecha se calcula contra
     el mínimo del resto, no contra el mínimo general (si el más barato somos
     nosotros, la brecha sería siempre cero y no diría nada). */
  const resumen = useMemo(() => {
    const todos = resultado?.items || [];
    if (!todos.length) return null;
    const nuestros = todos.filter((i) => i.tienda === "amsodent" && i.precio > 0);
    const ajenos = todos.filter((i) => i.tienda !== "amsodent" && i.precio > 0);
    const nuestro = nuestros.length ? Math.min(...nuestros.map((i) => i.precio)) : null;
    const minAjeno = ajenos.length ? Math.min(...ajenos.map((i) => i.precio)) : null;
    const baratoAjeno = ajenos.find((i) => i.precio === minAjeno) || null;
    return {
      nuestro,
      minAjeno,
      baratoAjeno,
      diferencia: nuestro != null && minAjeno != null ? nuestro - minAjeno : null,
      tiendas: resultado?.tiendas_consultadas?.length || 0,
      sinRespuesta: resultado?.tiendas_sin_respuesta || [],
    };
  }, [resultado]);

  const tiendas = useMemo(
    () => [...new Set((resultado?.items || []).map((i) => i.tienda_nombre))],
    [resultado],
  );

  const hayFiltros = Boolean(tiendaFiltro || soloConHistorial);

  return (
    <div className="page">
      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}

      <div className="page-header">
        <div>
          <h1 className="page-title">Explorador de Precios</h1>
          <p className="page-subtitle">
            Compara nuestro precio contra el de la competencia, en vivo. Las tiendas que
            se consultan se administran en Acceso al Portal.
          </p>
        </div>
      </div>

      {/* Buscador */}
      <form onSubmit={buscar} className="filter-bar" style={{ alignItems: "flex-end" }}>
        <div className="filter-field" style={{ flex: 2, minWidth: 260 }}>
          <label className="filter-label">Producto</label>
          <div style={{ position: "relative" }}>
            <Search
              size={15}
              style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)" }}
            />
            <input
              className="input"
              style={{ paddingLeft: 32 }}
              placeholder="Ej: resina fluida, cepillo interdental, guantes de nitrilo…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
        </div>
        <button type="submit" className="btn btn-primary" disabled={cargando} style={{ height: 36 }}>
          {cargando ? "Consultando tiendas…" : "Buscar"}
        </button>
        {tiendas.length > 0 && (
          <>
            <div className="filter-field" style={{ minWidth: 180 }}>
              <label className="filter-label">Tienda</label>
              <DropdownSelect
                value={tiendaFiltro}
                onChange={setTiendaFiltro}
                options={[
                  { value: "", label: `Todas (${resultado.items.length})` },
                  ...tiendas.map((t) => ({
                    value: t,
                    label: `${t} (${resultado.items.filter((i) => i.tienda_nombre === t).length})`,
                  })),
                ]}
              />
            </div>
            <label
              style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, height: 36, cursor: "pointer" }}
              title="Solo los productos de los que ya hay capturas de precio anteriores"
            >
              <input
                type="checkbox"
                checked={soloConHistorial}
                onChange={(e) => setSoloConHistorial(e.target.checked)}
              />
              Con historial
            </label>
            <BotonLimpiarFiltros
              hay={hayFiltros}
              onLimpiar={() => { setTiendaFiltro(""); setSoloConHistorial(false); }}
            />
          </>
        )}
      </form>

      {error && (
        <div
          className="surface"
          style={{ marginTop: 12, padding: "10px 14px", display: "flex", alignItems: "center", gap: 8, color: "#b91c1c" }}
        >
          <AlertTriangle size={15} /> {error}
        </div>
      )}

      {/* Resumen: dónde queda nuestro precio */}
      {resumen && (
        <div className="stats-row stats-3" style={{ marginTop: 12 }}>
          <div className="stat-card">
            <div className="stat-label">Nuestro precio</div>
            <div className="stat-value" style={{ color: "var(--primary)" }}>{fmtMoneda(resumen.nuestro)}</div>
            <div className="stat-sub">
              {resumen.nuestro == null ? "no aparecemos en esta búsqueda" : "el más barato de nuestra tienda"}
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Más barato de la competencia</div>
            <div className="stat-value">{fmtMoneda(resumen.minAjeno)}</div>
            <div className="stat-sub">{resumen.baratoAjeno?.tienda_nombre || "sin resultados de terceros"}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Diferencia</div>
            {resumen.diferencia == null ? (
              <>
                <div className="stat-value" style={{ color: "var(--text-muted)" }}>—</div>
                <div className="stat-sub">falta uno de los dos precios</div>
              </>
            ) : (
              <>
                <div
                  className="stat-value"
                  style={{ color: resumen.diferencia > 0 ? "#b91c1c" : "#15803d", display: "inline-flex", alignItems: "center", gap: 6 }}
                >
                  {resumen.diferencia > 0 ? <TrendingUp size={18} /> : <TrendingDown size={18} />}
                  {fmtMoneda(Math.abs(resumen.diferencia))}
                </div>
                <div className="stat-sub">
                  {resumen.diferencia > 0 ? "estamos más caros" : resumen.diferencia < 0 ? "estamos más baratos" : "mismo precio"}
                  {resumen.minAjeno ? ` · ${Math.abs(Math.round((resumen.diferencia / resumen.minAjeno) * 100))}%` : ""}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Resultados */}
      {resultado && (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginBottom: 10 }}>
            {items.length} de {resultado.total} resultado{resultado.total === 1 ? "" : "s"} para
            {" "}<strong style={{ color: "var(--text)" }}>{resultado.consulta}</strong>
            {resumen?.tiendas ? ` · ${resumen.tiendas} tienda${resumen.tiendas === 1 ? "" : "s"} consultada${resumen.tiendas === 1 ? "" : "s"}` : ""}
            {resumen?.sinRespuesta?.length ? ` · sin respuesta: ${resumen.sinRespuesta.join(", ")}` : ""}
          </div>

          {items.length === 0 ? (
            <div
              className="surface"
              style={{ padding: 28, textAlign: "center", color: "var(--text-muted)", fontSize: 13.5 }}
            >
              {resultado.total === 0
                ? "Ninguna tienda devolvió resultados para esa búsqueda."
                : "Ningún resultado calza con los filtros."}
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", gap: 12 }}>
              {items.map((it) => {
                const nuestro = it.tienda === "amsodent";
                return (
                  <div
                    key={`${it.tienda}-${it.url}`}
                    className="surface"
                    style={{
                      padding: 12,
                      display: "flex",
                      flexDirection: "column",
                      gap: 7,
                      ...(nuestro ? { border: "1.5px solid var(--primary)" } : {}),
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                      <span
                        style={{
                          display: "inline-flex", alignItems: "center", gap: 4,
                          fontSize: 10.5, fontWeight: 800, padding: "2px 8px", borderRadius: 999,
                          background: nuestro ? "var(--primary)" : "var(--bg)",
                          color: nuestro ? "#fff" : "var(--text)",
                          whiteSpace: "nowrap",
                        }}
                      >
                        <Store size={10} />
                        {nuestro ? "Amsodent" : it.tienda_nombre}
                      </span>
                      {it.oferta && (
                        <span style={{ fontSize: 10.5, fontWeight: 800, color: "#b91c1c", background: "#fee2e2", padding: "2px 8px", borderRadius: 999 }}>
                          OFERTA
                        </span>
                      )}
                    </div>

                    {it.imagen ? (
                      <img
                        src={it.imagen}
                        alt=""
                        loading="lazy"
                        style={{ width: "100%", height: 110, objectFit: "contain", background: "var(--bg)", borderRadius: 10 }}
                      />
                    ) : (
                      <div style={{ width: "100%", height: 110, background: "var(--bg)", borderRadius: 10, display: "grid", placeItems: "center", color: "var(--border)" }}>
                        <Search size={24} />
                      </div>
                    )}

                    <div style={{ fontSize: 12.5, fontWeight: 700, lineHeight: 1.3 }} title={it.nombre}>
                      {it.nombre}
                    </div>
                    {it.sku && (
                      <div style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "ui-monospace, monospace" }}>
                        SKU {it.sku}
                      </div>
                    )}

                    <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 17, fontWeight: 800 }}>{fmtMoneda(it.precio)}</span>
                      {it.precio_normal && (
                        <span style={{ fontSize: 12.5, color: "var(--text-muted)", textDecoration: "line-through" }}>
                          {fmtMoneda(it.precio_normal)}
                        </span>
                      )}
                    </div>

                    <div style={{ fontSize: 11.5, color: "var(--text-muted)", lineHeight: 1.45 }}>
                      {it.historico ? (
                        <>
                          {it.historico.variacion != null && it.historico.variacion !== 0 && (
                            <span style={{ color: it.historico.variacion > 0 ? "#b91c1c" : "#15803d", fontWeight: 700 }}>
                              {it.historico.variacion > 0 ? "▲ subió" : "▼ bajó"} {fmtMoneda(Math.abs(it.historico.variacion))}
                              {" "}desde el {it.historico.anterior?.fecha}
                              <br />
                            </span>
                          )}
                          Mínimo registrado: <strong style={{ color: "var(--text)" }}>{fmtMoneda(it.historico.precio_min)}</strong>
                          {" "}· {it.historico.capturas + 1} captura{it.historico.capturas === 0 ? "" : "s"}
                        </>
                      ) : (
                        "Primera captura de este producto."
                      )}
                      {!it.disponible && (
                        <span style={{ color: "#b45309" }}><br />Sin stock en la tienda.</span>
                      )}
                    </div>

                    <a
                      href={it.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="table-link"
                      style={{ marginTop: "auto", fontSize: 12.5, display: "inline-flex", alignItems: "center", gap: 5 }}
                    >
                      Ver en tienda <ExternalLink size={13} />
                    </a>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {!resultado && !error && !cargando && (
        <div
          className="surface"
          style={{ marginTop: 14, padding: 32, textAlign: "center", color: "var(--text-muted)", fontSize: 13.5 }}
        >
          Busca un producto para comparar su precio contra el de las tiendas configuradas.
        </div>
      )}
    </div>
  );
}
