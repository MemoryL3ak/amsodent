import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AlertTriangle, ChevronDown, ChevronRight, MessageSquareWarning, RefreshCw, Search } from "lucide-react";
import { api } from "../lib/api";
import useAuth from "../hooks/useAuth";
import { esAdminRol } from "../constants/modulos";
import DropdownSelect from "../components/ui/DropdownSelect";
import BotonLimpiarFiltros from "../components/BotonLimpiarFiltros";
import Toast from "../components/Toast";
import NuevaSolicitudPostventa from "../components/postventa/NuevaSolicitudPostventa";
import DetalleSolicitudPostventa from "../components/postventa/DetalleSolicitudPostventa";
import { ESTADOS_POSTVENTA, accionPostventa, esAbierta, estadoPostventa, fechaCorta, fechaHora, quien, sinTildes, textoDocumentoAfectado } from "../components/postventa/postventaComun";

/* ── Postventa (2026-11-26) ──────────────────────────────────────────────────
   Pedido de Ariel: «Generar módulo de postventa. En este módulo se deben
   registrar los reclamos generados de los clientes a los vendedores según la
   categoría correspondiente […]. Gestionar la solicitud de postventa. Las
   acciones posibles son: Emisión de NC, Emisión de otra factura, emisión de
   guía de despacho.»

   Bandeja de solicitudes: KPIs, filtros y una tabla paginada; al desplegar una
   fila se ve el reclamo y se gestiona (tomar, acciones, comentarios, cierre).
   «Nueva solicitud» registra un reclamo; las que el cliente envía desde su
   portal llegan a esta misma bandeja marcadas «Portal».

   Entra quien tiene «Postventa» en su perfil (o por rol). Cada uno ve las
   solicitudes donde es responsable o que registró; administración y quienes
   tienen «Ver todas las cotizaciones» ven todas (lo decide el servidor:
   backend/src/postventa). Un aviso de la campana llega con ?solicitud=N y
   despliega esa fila. */

const POR_PAGINA = 12;
const mesDe = (iso) => String(iso || "").slice(0, 7);

function Paginador({ pagina, total, onCambiar }) {
  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA));
  if (total <= POR_PAGINA) return null;
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "10px 4px", fontSize: 12.5, color: "var(--text-soft)" }}>
      <span>{(pagina - 1) * POR_PAGINA + 1}–{Math.min(pagina * POR_PAGINA, total)} de {total.toLocaleString("es-CL")} solicitudes</span>
      <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
        <button type="button" className="btn btn-secondary btn-sm" disabled={pagina <= 1} onClick={() => onCambiar(pagina - 1)}>Anterior</button>
        <span>Página {pagina} de {paginas}</span>
        <button type="button" className="btn btn-secondary btn-sm" disabled={pagina >= paginas} onClick={() => onCambiar(pagina + 1)}>Siguiente</button>
      </span>
    </div>
  );
}

const chip = (texto, color, bg, title) => (
  <span title={title} style={{ display: "inline-block", fontSize: 11.5, fontWeight: 700, color, background: bg, borderRadius: 999, padding: "2px 9px", whiteSpace: "nowrap" }}>{texto}</span>
);

export default function Postventa() {
  const { puede, rol } = useAuth();
  const esAdmin = esAdminRol(rol);
  const puedeModulo = (m) => esAdmin || puede(m);
  const [params, setParams] = useSearchParams();
  const [contexto, setContexto] = useState(null);
  const [solicitudes, setSolicitudes] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [puedeEmitir, setPuedeEmitir] = useState({ factura: false, guia: false });
  const [toast, setToast] = useState(null);
  const [nueva, setNueva] = useState(false);
  const [q, setQ] = useState("");
  const [estado, setEstado] = useState("");
  const [categoria, setCategoria] = useState("");
  const [vendedor, setVendedor] = useState("");
  const [pagina, setPagina] = useState(1);
  const [abierta, setAbierta] = useState(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const [c, r] = await Promise.all([api.get("/postventa/contexto"), api.get("/postventa")]);
      setContexto(c);
      setSolicitudes(Array.isArray(r?.solicitudes) ? r.solicitudes : []);
    } catch (e) {
      setToast({ type: "error", message: e?.message || "No se pudieron cargar las solicitudes de postventa." });
      setSolicitudes((prev) => prev || []);
    } finally {
      setCargando(false);
    }
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  // ¿Este usuario emite en Bsale? Mismo criterio que Facturación y la cotización.
  useEffect(() => {
    let vivo = true;
    api
      .get("/bsale/facturas/estado")
      .then((e) => vivo && setPuedeEmitir({ factura: !!e?.puede, guia: !!(e?.puede_guia ?? e?.puede) }))
      .catch(() => { /* sin integración: quedan los enlaces y el registro a mano */ });
    return () => { vivo = false; };
  }, []);

  const limpiar = () => { setQ(""); setEstado(""); setCategoria(""); setVendedor(""); setPagina(1); setAbierta(null); };
  const filtrar = (fijar) => (valor) => { fijar(valor); setPagina(1); setAbierta(null); };

  const texto = sinTildes(q.trim());
  const filtradas = useMemo(
    () =>
      (solicitudes || []).filter((s) => {
        if (estado === "abiertas" ? !esAbierta(s.estado) : estado && s.estado !== estado) return false;
        if (categoria && s.categoria !== categoria) return false;
        if (vendedor === "sin_asignar" ? !!s.vendedor_email : vendedor && s.vendedor_email !== vendedor) return false;
        if (!texto) return true;
        return sinTildes(`#${s.id} n°${s.id} ${s.cliente_nombre || ""} ${s.cliente_rut} ${s.cliente_rut_formateado} ${s.categoria_nombre} ${s.descripcion} ${s.documento_numero || ""} ${s.vendedor_email || ""} ${s.origen === "portal" ? "portal" : "plataforma"} ${s.productos.map((p) => `${p.sku || ""} ${p.nombre}`).join(" ")} ${s.acciones.map((a) => a.documento_numero || "").join(" ")}`).includes(texto);
      }),
    [solicitudes, estado, categoria, vendedor, texto],
  );
  const paginaActual = Math.min(pagina, Math.max(1, Math.ceil(filtradas.length / POR_PAGINA)));
  const visibles = filtradas.slice((paginaActual - 1) * POR_PAGINA, paginaActual * POR_PAGINA);

  // Aviso de la campana (?solicitud=N): quita los filtros, va a su página y la despliega.
  const pedida = Number(params.get("solicitud")) || null;
  useEffect(() => {
    if (!pedida || solicitudes === null) return;
    const i = solicitudes.findIndex((s) => s.id === pedida);
    const listo = () => setParams((p) => { p.delete("solicitud"); return p; }, { replace: true });
    const timer = setTimeout(() => {
      if (i < 0) {
        setToast({ type: "warning", message: `La solicitud N° ${pedida} no está entre las que puedes ver.` });
      } else {
        setQ(""); setEstado(""); setCategoria(""); setVendedor("");
        setPagina(Math.floor(i / POR_PAGINA) + 1);
        setAbierta(pedida);
      }
      listo();
    }, 0);
    return () => clearTimeout(timer);
  }, [pedida, solicitudes, setParams]);

  const kpis = useMemo(() => {
    const lista = solicitudes || [];
    const mes = new Date().toISOString().slice(0, 7);
    const ingresadas = lista.filter((s) => s.estado === "ingresada");
    const enGestion = lista.filter((s) => s.estado === "en_gestion");
    const masAntigua = enGestion.length ? enGestion[enGestion.length - 1] : null;
    return {
      ingresadas: ingresadas.length,
      ingresadasPortal: ingresadas.filter((s) => s.origen === "portal").length,
      enGestion: enGestion.length,
      masAntigua,
      resueltasMes: lista.filter((s) => s.estado === "resuelta" && mesDe(s.cerrada_at) === mes).length,
      resueltas: lista.filter((s) => s.estado === "resuelta").length,
      rechazadasMes: lista.filter((s) => s.estado === "rechazada" && mesDe(s.cerrada_at) === mes).length,
      rechazadas: lista.filter((s) => s.estado === "rechazada").length,
    };
  }, [solicitudes]);

  // Responsables que aparecen en la bandeja, con su nombre si se conoce.
  const opcionesVendedor = useMemo(() => {
    const nombres = new Map((contexto?.vendedores || []).map((v) => [v.email, v.nombre]));
    const presentes = [...new Set((solicitudes || []).map((s) => s.vendedor_email).filter(Boolean))].sort();
    const haySinAsignar = (solicitudes || []).some((s) => !s.vendedor_email);
    return [{ value: "", label: "Todos" }, ...(haySinAsignar ? [{ value: "sin_asignar", label: "Sin asignar" }] : []), ...presentes.map((e) => ({ value: e, label: nombres.get(e) || quien(e), detalle: e }))];
  }, [contexto, solicitudes]);

  const alCambiar = useCallback((s) => setSolicitudes((prev) => (prev || []).map((x) => (x.id === s.id ? s : x))), []);

  const bloqueo = contexto?.listo === false ? contexto.mensaje : null;
  const hayFiltros = !!q.trim() || !!estado || !!categoria || !!vendedor;
  const tarjeta = (clave, etiquetaKpi, valor, pie) => (
    <button type="button" className="stat-card" onClick={() => { setEstado(estado === clave ? "" : clave); setPagina(1); setAbierta(null); }} title={estado === clave ? "Quitar el filtro" : `Ver solo las ${etiquetaKpi.toLowerCase()}`} style={{ textAlign: "left", cursor: "pointer", font: "inherit", color: "inherit", outline: estado === clave ? "2px solid var(--primary)" : "none", outlineOffset: -2 }}>
      <div className="stat-label">{etiquetaKpi}</div>
      <div className="stat-value">{valor}</div>
      <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 2 }}>{pie}</div>
    </button>
  );

  return (
    <div className="page pagina-postventa">
      {/* Color de cada tarjeta según su estado (el orden por defecto pinta la 2.ª verde y la 3.ª ámbar). */}
      <style>{`
        .pagina-postventa .stats-row .stat-card:nth-child(2)::after { background: var(--warning); }
        .pagina-postventa .stats-row .stat-card:nth-child(3)::after { background: var(--success); }
      `}</style>
      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}
      {nueva && contexto && (
        <NuevaSolicitudPostventa
          contexto={contexto}
          onCerrar={() => setNueva(false)}
          onCreada={(s) => {
            setNueva(false);
            setToast({ type: "success", message: s ? `Solicitud de postventa N° ${s.id} registrada${s.vendedor_email ? `: responsable ${quien(s.vendedor_email)}.` : "."}` : "Solicitud registrada." });
            limpiar();
            if (s) setAbierta(s.id);
            cargar();
          }}
        />
      )}

      <div className="page-header">
        <div style={{ minWidth: 0 }}>
          <h1 className="page-title">Postventa</h1>
          <p className="page-subtitle">Reclamos de los clientes por categoría y su gestión: nota de crédito, otra factura o guía de despacho. Incluye las solicitudes que los clientes envían desde su portal.</p>
        </div>
        <div className="page-actions" style={{ flexWrap: "wrap" }}>
          <button type="button" className="btn btn-secondary" onClick={cargar} disabled={cargando} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><RefreshCw size={14} className={cargando ? "spin" : ""} /> Actualizar</button>
          <button type="button" className="btn btn-primary btn-nueva-postventa" onClick={() => setNueva(true)} disabled={!contexto || contexto.listo === false} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <MessageSquareWarning size={15} /> Nueva solicitud
          </button>
        </div>
      </div>

      {bloqueo && (
        <div className="aviso-migracion-postventa" style={{ display: "flex", gap: 10, fontSize: 13, color: "#78350f", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 10, padding: "10px 14px", marginBottom: 14 }}>
          <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 1, color: "#d97706" }} /> {bloqueo}
        </div>
      )}

      <div className="stats-row">
        {tarjeta("ingresada", "Ingresadas", kpis.ingresadas, kpis.ingresadas ? `por tomar${kpis.ingresadasPortal ? ` · ${kpis.ingresadasPortal} del portal` : ""}` : "ninguna por tomar")}
        {tarjeta("en_gestion", "En gestión", kpis.enGestion, kpis.masAntigua ? `la más antigua, del ${fechaCorta(kpis.masAntigua.created_at)}` : "ninguna en curso")}
        {tarjeta("resuelta", "Resueltas", kpis.resueltasMes, `este mes · ${kpis.resueltas} en total`)}
        {tarjeta("rechazada", "Rechazadas", kpis.rechazadasMes, `este mes · ${kpis.rechazadas} en total`)}
      </div>

      <div className="filter-bar" style={{ alignItems: "flex-end", gap: 12, flexWrap: "wrap" }}>
        <div className="filter-field" style={{ flex: "2 1 240px", minWidth: 0 }}>
          <label className="filter-label">Buscar</label>
          <span style={{ position: "relative", display: "block" }}>
            <Search size={14} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)", pointerEvents: "none" }} />
            <input className="input" value={q} onChange={(e) => filtrar(setQ)(e.target.value)} placeholder="Cliente, RUT, N° de documento, producto…" style={{ width: "100%", paddingLeft: 30 }} />
          </span>
        </div>
        <div className="filter-field" style={{ flex: "1 1 150px", minWidth: 0, maxWidth: 220 }}>
          <label className="filter-label">Estado</label>
          <DropdownSelect value={estado} onChange={filtrar(setEstado)} minWidth={180} style={{ width: "100%" }} options={[{ value: "", label: "Todos" }, { value: "abiertas", label: "Abiertas" }, ...ESTADOS_POSTVENTA.map((e) => ({ value: e.clave, label: e.nombre, color: e.color }))]} />
        </div>
        <div className="filter-field" style={{ flex: "1 1 190px", minWidth: 0, maxWidth: 280 }}>
          <label className="filter-label">Categoría</label>
          <DropdownSelect value={categoria} onChange={filtrar(setCategoria)} minWidth={260} style={{ width: "100%" }} options={[{ value: "", label: "Todas" }, ...(contexto?.categorias || []).map((c) => ({ value: c.clave, label: c.nombre }))]} />
        </div>
        {contexto?.ve_todas && (
          <div className="filter-field" style={{ flex: "1 1 170px", minWidth: 0, maxWidth: 240 }}>
            <label className="filter-label">Responsable</label>
            <DropdownSelect value={vendedor} onChange={filtrar(setVendedor)} minWidth={220} style={{ width: "100%" }} options={opcionesVendedor} />
          </div>
        )}
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginLeft: "auto" }}>
          <BotonLimpiarFiltros hay={hayFiltros} onLimpiar={limpiar} />
        </div>
      </div>

      {/* containerType: el detalle desplegado mide 100cqw = lo visible de esta caja. */}
      <div className="table-wrap" style={{ marginTop: 12, containerType: "inline-size" }}>
        <table className="data-table tabla-compacta tabla-texto tabla-postventa" style={{ minWidth: 760 }}>
          <thead>
            <tr>
              <th style={{ width: 28 }} aria-label="Detalle" />
              <th>Solicitud</th>
              <th>Cliente</th>
              <th>Reclamo</th>
              <th>Documento</th>
              <th>Responsable</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            {solicitudes === null && <tr><td colSpan={7} style={{ textAlign: "center", padding: "40px 0", color: "var(--text-muted)" }}>Cargando…</td></tr>}
            {solicitudes !== null && filtradas.length === 0 && (
              <tr><td colSpan={7} style={{ textAlign: "center", padding: "40px 16px", color: "var(--text-muted)" }}>
                {solicitudes.length ? "Ninguna solicitud calza con los filtros." : bloqueo ? "El módulo quedará disponible al aplicar la migración." : "Todavía no hay solicitudes de postventa. Registra la primera con «Nueva solicitud»."}
              </td></tr>
            )}
            {visibles.map((s) => {
              const ab = abierta === s.id;
              const est = estadoPostventa(s.estado);
              const docAfectado = textoDocumentoAfectado(s);
              return (
                <Fragment key={s.id}>
                  <tr className="fila-postventa" onClick={() => setAbierta(ab ? null : s.id)} style={{ cursor: "pointer", background: ab ? "var(--bg)" : undefined }} title={ab ? "Ocultar el detalle" : "Ver y gestionar la solicitud"}>
                    <td style={{ color: "var(--text-muted)" }}>{ab ? <ChevronDown size={15} /> : <ChevronRight size={15} />}</td>
                    <td>
                      <div style={{ fontWeight: 700, whiteSpace: "nowrap" }}>N° {s.id} {s.origen === "portal" && chip("Portal", "#0f766e", "#ccfbf1", "La envió el cliente desde su portal")}</div>
                      <div style={{ fontSize: 11.5, color: "var(--text-muted)", whiteSpace: "nowrap" }}>{fechaHora(s.created_at)}</div>
                    </td>
                    <td style={{ maxWidth: 220, overflowWrap: "anywhere" }}>
                      <div style={{ fontWeight: 600 }}>{s.cliente_nombre || "—"}</div>
                      <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>{s.cliente_rut_formateado}</div>
                    </td>
                    <td style={{ maxWidth: 300 }}>
                      <div style={{ fontWeight: 600 }}>{s.categoria_nombre}</div>
                      <div style={{ fontSize: 11.5, color: "var(--text-muted)", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", overflowWrap: "anywhere" }}>{s.descripcion}</div>
                    </td>
                    <td style={{ maxWidth: 170, overflowWrap: "anywhere" }}>
                      {docAfectado || <span style={{ color: "var(--text-muted)" }}>—</span>}
                      {s.licitacion_id && (
                        <div style={{ fontSize: 11.5 }}>
                          <Link to={`/detalle/${s.licitacion_id}`} target="_blank" rel="noopener noreferrer" className="table-link" onClick={(e) => e.stopPropagation()} title="Abrir la cotización en una pestaña nueva">Cotización #{s.licitacion_id}</Link>
                        </div>
                      )}
                    </td>
                    <td style={{ maxWidth: 150, overflowWrap: "anywhere" }}>
                      {s.vendedor_email ? quien(s.vendedor_email) : <span style={{ color: "#b45309", fontWeight: 600 }}>Sin asignar</span>}
                    </td>
                    <td>
                      {chip(est.nombre, est.color, est.bg)}
                      {s.acciones.length > 0 && (
                        <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 3, maxWidth: 180, overflowWrap: "anywhere" }}>
                          {s.acciones.map((a) => `${accionPostventa(a.tipo)?.sigla || a.nombre}${a.documento_numero ? ` ${a.documento_numero}` : " (sin N°)"}`).join(" · ")}
                        </div>
                      )}
                    </td>
                  </tr>
                  {ab && (
                    <tr className="detalle-fila-postventa">
                      <td colSpan={7} style={{ background: "var(--bg)", padding: 0 }}>
                        {/* En pantallas angostas la tabla se desplaza de lado: el detalle queda
                            fijo a la izquierda y del ancho visible, para gestionarlo entero. */}
                        <div style={{ position: "sticky", left: 0, width: "100cqw", boxSizing: "border-box", padding: "12px 14px" }}>
                          <DetalleSolicitudPostventa id={s.id} contexto={contexto} puedeEmitir={puedeEmitir} puede={puedeModulo} onCambio={alCambiar} onAviso={setToast} />
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <Paginador pagina={paginaActual} total={filtradas.length} onCambiar={(p) => { setPagina(p); setAbierta(null); }} />
    </div>
  );
}
