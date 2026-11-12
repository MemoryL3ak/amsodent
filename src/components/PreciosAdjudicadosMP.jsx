import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ExternalLink, LineChart, Loader2, X } from "lucide-react";
import { api } from "../lib/api";
import DropdownSelect from "./ui/DropdownSelect";
import {
  PERIODOS_ADJ,
  diferenciaPct,
  filasDeReferencia,
  filtrarPeriodo,
  marcasEje,
  resumenAdjudicaciones,
  textoPct,
} from "../lib/preciosAdjudicados";

/* ── Precios adjudicados en Mercado Público, por producto (2026-11-12) ───────
   Pedido de Ariel: «al crear una cotización, agregamos los productos y ahí nos
   aparezca una manera de ver por producto un análisis histórico de precios
   basado en Mercado Público, para ver con qué precio histórico se adjudica».

   El botón va en cada línea de la cotización (Crear y Detalle) y abre esta
   ventana: en qué procesos de Mercado Público cotizamos ese producto, a qué
   precio se adjudicó cada uno (a nosotros o a otro proveedor), el precio
   típico, el rango y cómo queda el precio que se está poniendo ahora. Es para
   todo el que cotiza: no muestra costos. El cruce producto ↔ proceso lo hace
   el backend (licitaciones/precios-adjudicados.ts). */

const clp = (n) => (n == null ? "—" : `$${Math.round(Number(n) || 0).toLocaleString("es-CL")}`);
const fechaCorta = (f) => {
  const m = String(f || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : "—";
};
const POR_PAGINA = 8;

// Dos series: adjudicado a nosotros / a otro proveedor. Verde = ganada, como en
// el resto de la plataforma; la forma (círculo / rombo) las distingue también
// sin color (validado con el banco de paletas: el par verde-naranjo queda
// justo bajo el umbral para daltonismo, por eso la segunda marca).
const COLOR_NOSOTROS = "#16a34a";
const COLOR_OTRO = "#eb6834";

function Marca({ nuestra, cx, cy, activo = false }) {
  const r = activo ? 6 : 4.5;
  return nuestra ? (
    <circle cx={cx} cy={cy} r={r} fill={COLOR_NOSOTROS} stroke="#fff" strokeWidth="2" />
  ) : (
    <rect x={cx - r} y={cy - r} width={r * 2} height={r * 2} transform={`rotate(45 ${cx} ${cy})`} fill={COLOR_OTRO} stroke="#fff" strokeWidth="2" />
  );
}

function ClaveSerie({ nuestra, children, titulo }) {
  return (
    <span title={titulo} style={{ display: "flex", alignItems: "center", gap: 5, minWidth: 0 }}>
      <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" style={{ flexShrink: 0 }}><Marca nuestra={nuestra} cx={6} cy={6} /></svg>
      <span className="truncar">{children}</span>
    </span>
  );
}

/* Precios adjudicados en el tiempo. SVG a mano, como el resto de los gráficos
   de la plataforma. El puntero no tiene que caer sobre la marca: se muestra la
   más cercana. Todo lo que dice el recuadro está también en la tabla. */
function GraficoAdjudicados({ filas, precioActual }) {
  const W = 820, H = 230, IZQ = 60, DER = 16, ARR = 16, ABA = 28;
  const svgRef = useRef(null);
  const [activo, setActivo] = useState(-1);

  const puntos = useMemo(() => {
    const t = (f) => new Date(`${f}T00:00:00`).getTime();
    const serie = [...filas].sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)));
    if (!serie.length) return null;
    const precios = serie.map((f) => Number(f.precio_adjudicado));
    const actual = Number(precioActual) > 0 ? Number(precioActual) : null;
    const marcas = marcasEje(Math.min(...precios, ...(actual ? [actual] : [])), Math.max(...precios, ...(actual ? [actual] : [])));
    const pMin = marcas[0];
    const pMax = marcas.length > 1 ? marcas[marcas.length - 1] : marcas[0] + 1;
    const tMin = t(serie[0].fecha);
    const tMax = t(serie[serie.length - 1].fecha);
    const x = (f) => (tMax > tMin ? IZQ + ((t(f) - tMin) / (tMax - tMin)) * (W - IZQ - DER) : (IZQ + W - DER) / 2);
    const y = (p) => H - ABA - ((p - pMin) / (pMax - pMin)) * (H - ARR - ABA);
    return {
      marcas, y, actual,
      desde: serie[0].fecha,
      hasta: serie[serie.length - 1].fecha,
      lista: serie.map((f) => ({ f, cx: x(f.fecha), cy: y(Number(f.precio_adjudicado)), nuestra: f.resultado === "ganada" })),
    };
  }, [filas, precioActual]);
  if (!puntos) return null;

  function alMover(e) {
    const caja = svgRef.current?.getBoundingClientRect();
    if (!caja?.width) return;
    const px = ((e.clientX - caja.left) / caja.width) * W;
    const py = ((e.clientY - caja.top) / caja.height) * H;
    let mejor = -1, dist = Infinity;
    puntos.lista.forEach((p, i) => {
      const d = (p.cx - px) ** 2 + (p.cy - py) ** 2;
      if (d < dist) { dist = d; mejor = i; }
    });
    setActivo(mejor);
  }

  const sel = activo >= 0 ? puntos.lista[activo] : null;
  const hayNuestras = puntos.lista.some((p) => p.nuestra);
  const hayOtras = puntos.lista.some((p) => !p.nuestra);
  // El recuadro se abre hacia el lado con espacio.
  const corrX = sel ? (sel.cx < W * 0.25 ? "-12%" : sel.cx > W * 0.75 ? "-88%" : "-50%") : "-50%";
  const abajo = sel ? sel.cy < H * 0.42 : false;

  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 9, background: "var(--surface)", padding: "10px 8px 8px", overflowX: "auto" }}>
      <div style={{ position: "relative", minWidth: 460 }}>
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          style={{ width: "100%", height: "auto", display: "block" }}
          role="img"
          aria-label={`Precios adjudicados entre el ${fechaCorta(puntos.desde)} y el ${fechaCorta(puntos.hasta)}: ${puntos.lista.length} procesos. El detalle está en la tabla.`}
          onPointerMove={alMover}
          onPointerLeave={() => setActivo(-1)}
        >
          {puntos.marcas.map((v) => (
            <g key={v}>
              <line x1={IZQ} x2={W - DER} y1={puntos.y(v)} y2={puntos.y(v)} stroke="var(--border)" strokeWidth="1" />
              <text x={IZQ - 8} y={puntos.y(v) + 3.5} textAnchor="end" fontSize="10.5" fill="var(--text-soft)" style={{ fontVariantNumeric: "tabular-nums" }}>{clp(v)}</text>
            </g>
          ))}
          {puntos.actual != null && (
            // La referencia se nombra en la leyenda: un rótulo sobre la línea tapaba las últimas marcas.
            <line x1={IZQ} x2={W - DER} y1={puntos.y(puntos.actual)} y2={puntos.y(puntos.actual)} stroke="#475569" strokeWidth="1.5" strokeDasharray="6 4" />
          )}
          {puntos.lista.map((p, i) => (i === activo ? null : <Marca key={i} nuestra={p.nuestra} cx={p.cx} cy={p.cy} />))}
          {sel && <Marca nuestra={sel.nuestra} cx={sel.cx} cy={sel.cy} activo />}
          <text x={IZQ} y={H - 8} fontSize="10.5" fill="var(--text-soft)">{fechaCorta(puntos.desde)}</text>
          {puntos.hasta !== puntos.desde && <text x={W - DER} y={H - 8} fontSize="10.5" fill="var(--text-soft)" textAnchor="end">{fechaCorta(puntos.hasta)}</text>}
        </svg>
        {sel && (
          <div
            style={{
              position: "absolute", left: `${(sel.cx / W) * 100}%`, top: `${(sel.cy / H) * 100}%`,
              transform: `translate(${corrX}, ${abajo ? "14px" : "calc(-100% - 14px)"})`,
              pointerEvents: "none", zIndex: 2, minWidth: 190, maxWidth: 280,
              background: "var(--surface)", border: "1px solid var(--border-strong)", borderRadius: 8, boxShadow: "var(--shadow-lg)", padding: "8px 10px", fontSize: 11.5, color: "var(--text-soft)", lineHeight: 1.4,
            }}
          >
            <div style={{ fontSize: 15, fontWeight: 800, color: "var(--text)" }}>{clp(sel.f.precio_adjudicado)}{sel.f.calce === "estimado" ? " (estimado)" : sel.f.calce === "aproximado" ? " (aprox.)" : ""}</div>
            <ClaveSerie nuestra={sel.nuestra}>{sel.nuestra ? "Adjudicado a Amsodent" : `Adjudicado a ${sel.f.ganador || "otro proveedor"}`}</ClaveSerie>
            <div>{fechaCorta(sel.f.fecha)} · {Number(sel.f.cantidad).toLocaleString("es-CL")} unid.</div>
            {!sel.nuestra && <div>Nuestro precio: <strong style={{ color: "var(--text)" }}>{clp(sel.f.nuestro_precio)}</strong></div>}
            <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sel.f.organismo || ""}</div>
          </div>
        )}
      </div>
      <div style={{ display: "flex", gap: "4px 16px", flexWrap: "wrap", fontSize: 11.5, color: "var(--text-soft)", padding: "4px 0 0 60px" }}>
        {hayNuestras && <ClaveSerie nuestra>Adjudicado a Amsodent</ClaveSerie>}
        {hayOtras && <ClaveSerie nuestra={false}>Adjudicado a otro proveedor</ClaveSerie>}
        {puntos.actual != null && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <svg width="22" height="12" viewBox="0 0 22 12" aria-hidden="true" style={{ flexShrink: 0 }}><line x1="1" x2="21" y1="6" y2="6" stroke="#475569" strokeWidth="1.5" strokeDasharray="6 4" /></svg>
            Tu precio en esta cotización ({clp(puntos.actual)})
          </span>
        )}
      </div>
    </div>
  );
}

function Dato({ etiqueta, valor, detalle, destacado = false }) {
  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 9, padding: "9px 11px", background: destacado ? "var(--primary-light)" : "var(--bg)", minWidth: 0 }}>
      <div style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".04em", color: "var(--text-soft)" }}>{etiqueta}</div>
      <div style={{ fontSize: 17, fontWeight: 800, color: "var(--text)", overflowWrap: "anywhere" }}>{valor}</div>
      <div style={{ fontSize: 11, color: "var(--text-soft)", overflowWrap: "anywhere" }}>{detalle || ""}</div>
    </div>
  );
}

function VentanaPreciosAdjudicados({ sku, producto, precioActual, onCerrar }) {
  const [leido, setLeido] = useState(null); // { datos } | { error }
  const [periodo, setPeriodo] = useState("24");
  const [verSinPrecio, setVerSinPrecio] = useState(false);
  const [pagina, setPagina] = useState(1);

  useEffect(() => {
    let vivo = true;
    const params = new URLSearchParams();
    if (sku) params.set("sku", sku);
    else params.set("producto", producto);
    api
      .get(`/licitaciones/productos/precios-adjudicados?${params.toString()}`)
      .then((r) => vivo && setLeido({ datos: r || { filas: [] } }))
      .catch((e) => vivo && setLeido({ error: e?.message || "No se pudieron leer los precios adjudicados." }));
    return () => { vivo = false; };
  }, [sku, producto]);

  useEffect(() => {
    const tecla = (e) => { if (e.key === "Escape") onCerrar?.(); };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [onCerrar]);

  const datos = leido?.datos || null;
  const todas = useMemo(() => datos?.filas || [], [datos]);
  const filas = useMemo(() => filtrarPeriodo(todas, periodo), [todas, periodo]);
  const resumen = useMemo(() => resumenAdjudicaciones(filas), [filas]);
  const referencia = useMemo(() => filasDeReferencia(filas).filas, [filas]);
  const tabla = useMemo(() => (verSinPrecio ? filas : filas.filter((f) => f.precio_adjudicado != null)), [filas, verSinPrecio]);
  const paginas = Math.max(1, Math.ceil(tabla.length / POR_PAGINA));
  const paginaActual = Math.min(pagina, paginas);
  const visibles = tabla.slice((paginaActual - 1) * POR_PAGINA, paginaActual * POR_PAGINA);

  const actual = Number(precioActual) > 0 ? Math.round(Number(precioActual)) : null;
  const contraTipico = actual != null && resumen.tipico != null ? diferenciaPct(actual, resumen.tipico) : null;
  const nombre = datos?.producto || producto || sku;
  const estimado = resumen.base === "estimado";

  return createPortal(
    <div onMouseDown={(e) => { if (e.target === e.currentTarget) onCerrar?.(); }} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.55)", zIndex: 11000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div className="ventana-precios-adjudicados" role="dialog" aria-modal="true" aria-label="Precios adjudicados en Mercado Público" style={{ width: 1040, maxWidth: "100%", maxHeight: "94vh", display: "flex", flexDirection: "column", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-lg)" }}>
        <div style={{ padding: "12px 18px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
          <div style={{ minWidth: 0 }}>
            <strong style={{ fontSize: 15, display: "inline-flex", alignItems: "center", gap: 8 }}>
              <LineChart size={16} style={{ color: "var(--primary)", flexShrink: 0 }} /> Precios adjudicados en Mercado Público
            </strong>
            <div style={{ fontSize: 12.5, color: "var(--text-soft)", marginTop: 2, overflowWrap: "anywhere" }}>{nombre}{sku ? ` · ${sku}` : ""}</div>
          </div>
          <button type="button" onClick={onCerrar} className="btn btn-ghost" style={{ padding: 6, flexShrink: 0 }} aria-label="Cerrar"><X size={18} /></button>
        </div>

        {/* El que se desplaza es este bloque; el de adentro reparte el espacio
            (si fuera el mismo, el gráfico y la tabla se encogerían en vez de desplazarse). */}
        <div style={{ overflowY: "auto", minHeight: 0 }}>
        <div style={{ padding: "14px 18px", display: "flex", flexDirection: "column", gap: 12 }}>
          {!leido &&<div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--text-soft)", fontSize: 13, padding: "18px 0" }}><Loader2 size={16} className="spin" /> Buscando los procesos de Mercado Público con este producto…</div>}
          {leido?.error && <div style={{ border: "1px solid #fecaca", background: "#fef2f2", color: "#b91c1c", borderRadius: 10, padding: "10px 12px", fontSize: 13 }}>{leido.error}</div>}

          {datos && todas.length === 0 && (
            <div style={{ border: "1px dashed var(--border-strong)", borderRadius: 10, padding: "18px 14px", fontSize: 13, color: "var(--text-soft)", textAlign: "center" }}>
              {datos.cotizaciones_publicas
                ? `Hemos cotizado este producto en ${datos.cotizaciones_publicas} proceso${datos.cotizaciones_publicas === 1 ? "" : "s"} de Mercado Público, pero ninguno tiene resultado todavía.`
                : "Todavía no hemos cotizado este producto en Mercado Público: no hay precios adjudicados que mostrar."}
            </div>
          )}

          {datos && todas.length > 0 && (
            <>
              <div style={{ display: "flex", gap: "8px 14px", flexWrap: "wrap", alignItems: "center" }}>
                <DropdownSelect value={periodo} onChange={(v) => { setPeriodo(v); setPagina(1); }} options={PERIODOS_ADJ} minWidth={180} style={{ height: 30, fontSize: 12, width: 180, flex: "0 1 180px" }} title="Período (fecha de adjudicación)" />
                <span style={{ fontSize: 12, color: "var(--text-soft)" }}>
                  {resumen.procesos.toLocaleString("es-CL")} proceso{resumen.procesos === 1 ? "" : "s"} con resultado
                  {resumen.procesos ? ` · ganamos ${resumen.ganadas} (${Math.round(resumen.tasa)} %)` : ""}
                  {datos.sin_resultado ? ` · ${datos.sin_resultado} aún sin resultado` : ""}
                </span>
              </div>

              {filas.length === 0 ? (
                <div style={{ border: "1px dashed var(--border-strong)", borderRadius: 10, padding: "16px 14px", fontSize: 13, color: "var(--text-soft)", textAlign: "center" }}>
                  No hay procesos con resultado en este período. Prueba con «Todo el historial».
                </div>
              ) : (
                <>
                  <div className="pa-datos" style={{ display: "grid", gap: 10 }}>
                    <Dato
                      destacado
                      etiqueta={estimado ? "Precio típico adjudicado (estimado)" : "Precio típico adjudicado"}
                      valor={clp(resumen.tipico)}
                      detalle={resumen.conPrecio ? `mediana de ${resumen.conPrecio} adjudicacion${resumen.conPrecio === 1 ? "" : "es"} · entre ${clp(resumen.minimo)} y ${clp(resumen.maximo)}` : "sin precios adjudicados en el período"}
                    />
                    <Dato
                      etiqueta="Última adjudicación"
                      valor={clp(resumen.ultima?.precio_adjudicado)}
                      detalle={resumen.ultima ? `${fechaCorta(resumen.ultima.fecha)} · ${resumen.ultima.resultado === "ganada" ? "a Amsodent" : resumen.ultima.ganador || "otro proveedor"}` : ""}
                    />
                    <Dato
                      etiqueta="Cuando ganamos"
                      valor={clp(resumen.tipicoGanado)}
                      detalle={resumen.ganadas ? `precio típico de nuestras ${resumen.ganadas} adjudicacion${resumen.ganadas === 1 ? "" : "es"}` : "no hemos ganado con este producto en el período"}
                    />
                    <Dato
                      etiqueta="Cuando perdimos"
                      valor={resumen.brechaPerdidas == null ? "—" : textoPct(resumen.brechaPerdidas)}
                      detalle={resumen.brechaPerdidas == null ? "sin precio del ganador para comparar" : `precio del ganador contra el nuestro (mediana de ${resumen.perdidasComparadas})`}
                    />
                  </div>

                  {actual != null && resumen.tipico != null && (
                    <div style={{ fontSize: 12.5, border: "1px solid var(--border)", borderRadius: 9, padding: "8px 12px", background: "var(--bg)", color: "var(--text)" }}>
                      Tu precio en esta cotización es <strong>{clp(actual)}</strong>:{" "}
                      {Math.abs(contraTipico) < 0.05
                        ? "igual al precio típico adjudicado."
                        : <><strong>{textoPct(contraTipico)}</strong> respecto del precio típico adjudicado ({clp(resumen.tipico)}).</>}
                      {resumen.tipicoGanado != null && <> Cuando ganamos, fue con {clp(resumen.tipicoGanado)}.</>}
                    </div>
                  )}

                  {referencia.length > 0 && <GraficoAdjudicados filas={referencia} precioActual={actual} />}

                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".4px", color: "var(--text-soft)" }}>Procesos ({tabla.length})</div>
                    {resumen.sinPrecio > 0 && (
                      <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, cursor: "pointer", color: "var(--text-soft)" }}>
                        <input type="checkbox" checked={verSinPrecio} onChange={(e) => { setVerSinPrecio(e.target.checked); setPagina(1); }} />
                        Mostrar también los {resumen.sinPrecio} sin precio del ganador
                      </label>
                    )}
                  </div>
                  <div className="table-wrap" style={{ margin: 0 }}>
                    {/* Anchos fijos y una línea por fila: Organismo y Ganador se cortan
                        con «…» (el nombre completo sale al pasar el puntero). */}
                    <table className="data-table tabla-compacta" style={{ minWidth: 940, tableLayout: "fixed" }}>
                      <thead>
                        <tr>
                          <th style={{ width: 92 }}>Fecha</th>
                          <th style={{ width: 150 }}>Proceso</th>
                          <th>Organismo</th>
                          <th style={{ textAlign: "right", width: 62 }}>Cant.</th>
                          <th style={{ textAlign: "right", width: 100 }}>Nuestro</th>
                          <th style={{ textAlign: "right", width: 112 }}>Adjudicado</th>
                          <th style={{ textAlign: "right", width: 66 }} title="Precio adjudicado contra nuestro precio">Dif.</th>
                          <th style={{ width: 200, textAlign: "left" }}>Ganador</th>
                        </tr>
                      </thead>
                      <tbody>
                        {visibles.map((f, i) => {
                          const nuestra = f.resultado === "ganada";
                          const dif = !nuestra && f.precio_adjudicado != null ? diferenciaPct(f.precio_adjudicado, f.nuestro_precio) : null;
                          const nota = f.atipico
                            ? { texto: "atípico", titulo: "Precio de otro orden que el nuestro (otra unidad o un dato mal ingresado en Mercado Público): no entra en las cifras de arriba." }
                            : f.calce === "estimado"
                            ? { texto: "estimado", titulo: "El proceso se cotizó por el total, no por producto: se aplica a nuestra línea la misma proporción entre el total ganador y el nuestro." }
                            : f.calce === "aproximado"
                            ? { texto: "aprox.", titulo: "Mercado Público no identifica el producto: la línea se reconoció por cantidad u orden dentro del proceso." }
                            : null;
                          return (
                            <tr key={`${f.licitacion_id}-${i}`}>
                              <td style={{ whiteSpace: "nowrap" }}>{fechaCorta(f.fecha)}</td>
                              <td>
                                <a href={`/detalle/${f.licitacion_id}`} target="_blank" rel="noopener noreferrer" className="table-link" title={`${f.codigo_mp || f.numero || `#${f.licitacion_id}`} · abrir nuestra cotización en otra pestaña`} style={{ maxWidth: "100%" }}>
                                  <span className="truncar">{f.codigo_mp || f.numero || `#${f.licitacion_id}`}</span> <ExternalLink size={11} style={{ flexShrink: 0 }} />
                                </a>
                              </td>
                              <td><span className="truncar" title={f.organismo || ""}>{f.organismo || "—"}</span></td>
                              <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{Number(f.cantidad).toLocaleString("es-CL")}</td>
                              <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{clp(f.nuestro_precio)}</td>
                              <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 700 }}>
                                {clp(f.precio_adjudicado)}
                                {nota && <div title={nota.titulo} style={{ fontSize: 10.5, fontWeight: 600, color: "var(--text-soft)", cursor: "help" }}>{nota.texto}</div>}
                              </td>
                              <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", color: "var(--text-soft)" }}>{dif == null ? "—" : textoPct(dif)}</td>
                              <td>
                                {nuestra
                                  ? <ClaveSerie nuestra><strong>Amsodent</strong></ClaveSerie>
                                  : f.ganador ? <ClaveSerie nuestra={false} titulo={f.ganador}>{f.ganador}</ClaveSerie> : <span className="truncar" style={{ color: "var(--text-soft)" }}>Otro proveedor (sin dato)</span>}
                              </td>
                            </tr>
                          );
                        })}
                        {visibles.length === 0 && (
                          <tr><td colSpan={8} style={{ textAlign: "center", color: "var(--text-soft)", padding: 14 }}>Ningún proceso del período trae el precio adjudicado.</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                  {tabla.length > POR_PAGINA && (
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: 11.5, color: "var(--text-soft)" }}>
                      <span>{(paginaActual - 1) * POR_PAGINA + 1}–{Math.min(paginaActual * POR_PAGINA, tabla.length)} de {tabla.length} procesos</span>
                      <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                        <button type="button" className="btn btn-secondary btn-sm" disabled={paginaActual <= 1} onClick={() => setPagina(paginaActual - 1)} style={{ fontSize: 11.5 }}>Anterior</button>
                        <span>Página {paginaActual} de {paginas}</span>
                        <button type="button" className="btn btn-secondary btn-sm" disabled={paginaActual >= paginas} onClick={() => setPagina(paginaActual + 1)} style={{ fontSize: 11.5 }}>Siguiente</button>
                      </span>
                    </div>
                  )}

                  <div style={{ fontSize: 11.5, color: "var(--text-soft)", lineHeight: 1.5 }}>
                    Precios unitarios netos de los procesos de Mercado Público en que cotizamos este producto. «Adjudicado en» es el precio del proveedor que ganó ese ítem (el nuestro cuando ganamos).
                    {resumen.atipicas > 0 && ` ${resumen.atipicas} precio${resumen.atipicas === 1 ? "" : "s"} atípico${resumen.atipicas === 1 ? "" : "s"} no entra${resumen.atipicas === 1 ? "" : "n"} en las cifras.`}
                    {!estimado && resumen.estimadas > 0 && ` ${resumen.estimadas} estimado${resumen.estimadas === 1 ? "" : "s"} (procesos cotizados por el total) tampoco.`}
                    {datos.truncado && " Se revisaron las 400 líneas más recientes del producto."}
                  </div>
                </>
              )}
            </>
          )}
        </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Botón de la línea de cotización: abre la ventana de precios adjudicados del producto. */
export default function BotonPreciosAdjudicados({ sku, producto, precioActual }) {
  const [abierta, setAbierta] = useState(false);
  const skuLimpio = String(sku || "").trim();
  const nombre = String(producto || "").trim();
  if (!skuLimpio && nombre.length < 3) return null;
  return (
    <>
      <button
        type="button"
        className="boton-precios-adjudicados"
        onClick={() => setAbierta(true)}
        title={`Ver con qué precios se ha adjudicado ${skuLimpio || nombre} en Mercado Público`}
      >
        <LineChart size={14} />
        <span className="bpa-largo">Precios adjudicados en Mercado Público</span>
        <span className="bpa-corto">Precios adjudicados</span>
      </button>
      {abierta && <VentanaPreciosAdjudicados sku={skuLimpio} producto={nombre} precioActual={precioActual} onCerrar={() => setAbierta(false)} />}
    </>
  );
}
