import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import * as XLSX from "xlsx";
import QRCode from "qrcode";
import Toast from "../components/Toast";
import ConfirmModal from "../components/ConfirmModal";
import BotonLimpiarFiltros from "../components/BotonLimpiarFiltros";
import DropdownSelect from "../components/ui/DropdownSelect";
import DateFilter from "../components/DateFilter";
import RastreoClinicas from "../components/RastreoClinicas";
import { useStickyState } from "../lib/useStickyState";
import { CATEGORIAS_COMUNIDAD, FUENTES_COMUNIDAD, enlaceWhatsapp, nombreCategoria, nombreFila, telefonoLegible } from "../lib/comunidad";
import {
  HeartHandshake,
  QrCode,
  Download,
  Copy,
  Mail,
  Trash2,
  RefreshCw,
  FileSpreadsheet,
  Users,
  MapPin,
  Globe,
  MessageCircle,
  Tags,
} from "lucide-react";

/* ============================================================
   Submódulo ADMIN de la Comunidad Amsodent (/comunidad-registros).

   (2026-11-17) Pedidos de Ariel:
   ─ «Todos los clientes/personas en sorteo y evento se deben
     visualizar en Comunidad»: la lista une, en vivo, el formulario
     del QR, los sorteos, los eventos y las clínicas rastreadas (una
     fila por correo; cada fila dice de dónde viene).
   ─ «Todas las filas se deben categorizar»: cada fila tiene su
     categoría. Si nadie la ha elegido, se propone una según el
     origen (aparece como «propuesta») y se confirma o cambia en la
     misma fila, o a varias a la vez marcándolas.
   ─ Pestaña «Rastreo de clínicas»: el bot de Google Maps
     (components/RastreoClinicas.jsx).

   Además: QR del portal público /comunidad, reenvío del correo de
   bienvenida (solo a quien llenó el formulario) y export a Excel.
============================================================ */

const POR_PAGINA = 15;
const OPCIONES_CATEGORIA = CATEGORIAS_COMUNIDAD.map((c) => ({ value: c.value, label: c.label, color: c.color }));
const COLOR_FUENTE = { comunidad: "badge-primary", sorteo: "badge-warning", evento: "badge-success", rastreo: "badge-neutral" };

export default function ComunidadRegistros() {
  const [vista, setVista] = useStickyState("comunidad.vista", "lista"); // 'lista' | 'rastreo'
  const [registros, setRegistros] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [toast, setToast] = useState(null);
  const [urlPortal, setUrlPortal] = useState("");
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [mostrarQR, setMostrarQR] = useState(false);
  const [reenviando, setReenviando] = useState(null);
  const [aEliminar, setAEliminar] = useState(null);
  const [categorizando, setCategorizando] = useState(false);

  // Filtros
  const [buscar, setBuscar] = useState("");
  const [fCategoria, setFCategoria] = useState("");
  const [fFuente, setFFuente] = useState("");
  const [fDesde, setFDesde] = useState("");
  const [fHasta, setFHasta] = useState("");
  const [pagina, setPagina] = useState(1);
  // Selección para categorizar varias filas a la vez (por `ref` de la fila).
  const [marcadas, setMarcadas] = useState(() => new Set());
  const [categoriaMasiva, setCategoriaMasiva] = useState("");

  async function cargar(silencioso = false) {
    if (!silencioso) setCargando(true);
    try {
      const [regs, portal] = await Promise.all([
        api.get("/comunidad/registros"),
        api.get("/comunidad/portal").catch(() => null),
      ]);
      setRegistros(Array.isArray(regs) ? regs : []);
      if (portal?.url) setUrlPortal(portal.url);
      else setUrlPortal(`${window.location.origin}/comunidad`);
    } catch (e) {
      setToast({ type: "error", message: e?.message || "No se pudieron cargar los registros." });
    } finally {
      setCargando(false);
    }
  }

  useEffect(() => {
    cargar();
  }, []);

  useEffect(() => {
    if (!urlPortal) return;
    QRCode.toDataURL(urlPortal, { width: 480, margin: 2, color: { dark: "#0f172a" } })
      .then(setQrDataUrl)
      .catch(() => setQrDataUrl(""));
  }, [urlPortal]);

  const filtrados = useMemo(() => {
    const q = buscar.trim().toLowerCase();
    return registros.filter((r) => {
      if (fCategoria === "__propuesta") { if (!r.categoria_auto) return false; }
      else if (fCategoria && r.categoria !== fCategoria) return false;
      if (fFuente && !(r.fuentes || []).some((f) => f.tipo === fFuente)) return false;
      const fecha = String(r.created_at || "").slice(0, 10);
      if (fDesde && fecha < fDesde) return false;
      if (fHasta && fecha > fHasta) return false;
      if (q) {
        const bolsa = [r.nombre, r.apellido, r.correo, r.telefono, r.whatsapp, r.universidad, r.especialidad, r.ciudad, r.comuna, r.region, r.direccion, r.sitio_web, ...(r.fuentes || []).map((f) => f.etiqueta)]
          .join(" ")
          .toLowerCase();
        if (!bolsa.includes(q)) return false;
      }
      return true;
    });
  }, [registros, buscar, fCategoria, fFuente, fDesde, fHasta]);

  useEffect(() => { setPagina(1); }, [buscar, fCategoria, fFuente, fDesde, fHasta]);
  const paginas = Math.max(1, Math.ceil(filtrados.length / POR_PAGINA));
  const paginaActual = Math.min(pagina, paginas);
  const enPagina = filtrados.slice((paginaActual - 1) * POR_PAGINA, paginaActual * POR_PAGINA);

  const stats = useMemo(() => {
    const tiene = (r, t) => (r.fuentes || []).some((f) => f.tipo === t);
    return {
      total: registros.length,
      formulario: registros.filter((r) => tiene(r, "comunidad")).length,
      sorteosEventos: registros.filter((r) => tiene(r, "sorteo") || tiene(r, "evento")).length,
      rastreadas: registros.filter((r) => r.fuente === "rastreo").length,
      propuestas: registros.filter((r) => r.categoria_auto).length,
      porCategoria: Object.fromEntries(CATEGORIAS_COMUNIDAD.map((c) => [c.value, registros.filter((r) => r.categoria === c.value).length])),
    };
  }, [registros]);

  function copiarLink() {
    navigator.clipboard?.writeText(urlPortal).then(
      () => setToast({ type: "success", message: "Link copiado al portapapeles." }),
      () => setToast({ type: "error", message: "No se pudo copiar el link." })
    );
  }

  function descargarQR() {
    if (!qrDataUrl) return;
    const a = document.createElement("a");
    a.href = qrDataUrl;
    a.download = "qr_comunidad_amsodent.png";
    a.click();
  }

  async function reenviar(r) {
    if (reenviando || !r.id) return;
    setReenviando(r.id);
    try {
      await api.post(`/comunidad/registros/${r.id}/reenviar`, {});
      setToast({ type: "success", message: `Correo de bienvenida reenviado a ${r.correo}.` });
      setRegistros((prev) => prev.map((x) => (x.ref === r.ref ? { ...x, correo_enviado: true } : x)));
    } catch (e) {
      setToast({ type: "error", message: e?.message || "No se pudo reenviar el correo." });
    } finally {
      setReenviando(null);
    }
  }

  async function eliminar() {
    const r = aEliminar;
    setAEliminar(null);
    if (!r?.id) return;
    try {
      await api.delete(`/comunidad/registros/${r.id}`);
      setToast({ type: "success", message: "Registro eliminado de Comunidad." });
      // Si la persona sigue en un sorteo o evento, vuelve a aparecer desde ahí: se relee la lista.
      cargar(true);
    } catch (e) {
      setToast({ type: "error", message: e?.message || "No se pudo eliminar." });
    }
  }

  /* Guarda la categoría de una o más filas. Se ve al tiro (cambio optimista) y
     luego se relee la lista, porque a quien solo estaba en un sorteo o evento
     se le crea su fila en Comunidad. */
  async function categorizar(refs, categoria) {
    if (!refs.length || !categoria || categorizando) return;
    const antes = registros;
    setCategorizando(true);
    const conjunto = new Set(refs);
    setRegistros((prev) => prev.map((x) => (conjunto.has(x.ref) ? { ...x, categoria, categoria_auto: false } : x)));
    try {
      const r = await api.put("/comunidad/registros/categoria", { refs, categoria });
      setToast({ type: "success", message: refs.length === 1 ? `Categoría guardada: ${nombreCategoria(categoria)}.` : `${r?.actualizadas ?? refs.length} filas quedaron como ${nombreCategoria(categoria)}.` });
      setMarcadas(new Set());
      setCategoriaMasiva("");
      await cargar(true);
    } catch (e) {
      setRegistros(antes);
      setToast({ type: "error", message: e?.message || "No se pudo guardar la categoría." });
    } finally {
      setCategorizando(false);
    }
  }

  const alternar = (ref) => setMarcadas((prev) => { const s = new Set(prev); if (s.has(ref)) s.delete(ref); else s.add(ref); return s; });
  const paginaMarcada = enPagina.length > 0 && enPagina.every((r) => marcadas.has(r.ref));
  function alternarPagina() {
    setMarcadas((prev) => {
      const s = new Set(prev);
      for (const r of enPagina) { if (paginaMarcada) s.delete(r.ref); else s.add(r.ref); }
      return s;
    });
  }

  function exportarExcel() {
    const filas = filtrados.map((r) => ({
      Nombre: nombreFila(r),
      Categoría: nombreCategoria(r.categoria),
      "Categoría confirmada": r.categoria_auto ? "No (propuesta)" : "Sí",
      Correo: r.correo || "",
      "Teléfono": telefonoLegible(r.telefono),
      WhatsApp: telefonoLegible(r.whatsapp),
      "Página web": r.sitio_web || "",
      "Dirección": r.direccion || "",
      Comuna: r.comuna || "",
      "Región": r.region || "",
      Ciudad: r.ciudad || "",
      "Año de estudio": r.anio_estudio || "",
      Universidad: r.universidad || "",
      Especialidad: r.especialidad || "",
      "Cómo nos conoció": r.como_conociste || "",
      "Viene de": (r.fuentes || []).map((f) => f.etiqueta).join(" · "),
      "Correo bienvenida": r.correo_enviado == null ? "" : r.correo_enviado ? "Enviado" : "Sin enviar",
      Registro: String(r.created_at || "").slice(0, 16).replace("T", " "),
    }));
    const ws = XLSX.utils.json_to_sheet(filas);
    ws["!cols"] = [
      { wch: 30 }, { wch: 30 }, { wch: 14 }, { wch: 30 }, { wch: 17 }, { wch: 17 }, { wch: 30 }, { wch: 38 }, { wch: 16 },
      { wch: 20 }, { wch: 14 }, { wch: 13 }, { wch: 26 }, { wch: 22 }, { wch: 20 }, { wch: 34 }, { wch: 17 }, { wch: 17 },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Comunidad");
    XLSX.writeFile(wb, "Comunidad_Amsodent.xlsx");
  }

  /* (2026-09-24) Volver a ver todo sin ir borrando filtro por filtro. */
  const hayFiltros = fCategoria !== "" || fFuente !== "" || fDesde !== "" || fHasta !== "" || buscar.trim() !== "";
  function limpiarFiltros() {
    setBuscar("");
    setFCategoria("");
    setFFuente("");
    setFDesde("");
    setFHasta("");
  }

  const enlace = { color: "var(--primary-dark, #1e9295)", textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4, maxWidth: "100%" };

  return (
    <div className="page vista-compacta pagina-comunidad">
      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}

      <ConfirmModal
        open={!!aEliminar}
        title="Eliminar de Comunidad"
        message={
          aEliminar?.fuente === "rastreo"
            ? `¿Eliminar la clínica ${aEliminar?.nombre || ""} de Comunidad? Si vuelves a rastrear su comuna, aparecerá de nuevo como nueva.`
            : (aEliminar?.fuentes || []).some((f) => f.tipo === "sorteo" || f.tipo === "evento")
              ? `¿Eliminar el registro de ${nombreFila(aEliminar || {})} (${aEliminar?.correo || ""}) en Comunidad? Seguirá apareciendo en la lista porque también está en ${(aEliminar?.fuentes || []).filter((f) => f.tipo !== "comunidad").map((f) => f.etiqueta).join(", ")}, pero se pierde la categoría guardada.`
              : `¿Eliminar a ${nombreFila(aEliminar || {})} (${aEliminar?.correo || ""}) de la comunidad? Esta acción no se puede deshacer.`
        }
        confirmText="Eliminar"
        confirmTone="danger"
        onConfirm={eliminar}
        onCancel={() => setAEliminar(null)}
      />

      <div className="page-header">
        <div>
          <h1 className="page-title">Comunidad Amsodent</h1>
          <p className="page-subtitle">
            Todas las personas y clínicas en un solo lugar: el formulario del QR, los sorteos, los eventos y las clínicas rastreadas en Google Maps, cada una con su categoría.
          </p>
        </div>
        <div className="btn-row">
          <button className="btn btn-secondary" onClick={() => setMostrarQR((v) => !v)} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <QrCode size={15} /> {mostrarQR ? "Ocultar QR" : "QR del portal"}
          </button>
          <button className="btn btn-secondary" onClick={exportarExcel} disabled={!filtrados.length} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <FileSpreadsheet size={15} /> Exportar Excel
          </button>
          <button className="btn btn-ghost" onClick={() => cargar()} title="Actualizar" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <RefreshCw size={15} style={cargando ? { opacity: 0.4 } : undefined} />
          </button>
        </div>
      </div>

      {mostrarQR && (
        <div className="surface" style={{ marginBottom: 16, padding: 22, textAlign: "center" }}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4, display: "inline-flex", alignItems: "center", gap: 7 }}>
            <HeartHandshake size={16} style={{ color: "var(--primary-dark)" }} />
            QR de la Comunidad Amsodent
          </div>
          <p style={{ fontSize: 12.5, color: "var(--text-soft)", margin: "0 0 12px" }}>
            Imprímelo o proyéctalo en el congreso: quien lo escanee llega al
            formulario y recibe el correo de bienvenida a la Familia Amsodent.
          </p>
          {qrDataUrl ? (
            <img
              src={qrDataUrl}
              alt={`QR del portal ${urlPortal}`}
              style={{ width: 220, height: 220, border: "1px solid var(--border)", borderRadius: 12, margin: "0 auto 10px", display: "block" }}
            />
          ) : (
            <div style={{ color: "var(--text-muted)", fontSize: 13, margin: "20px 0" }}>Generando QR…</div>
          )}
          <div style={{ fontSize: 12, color: "var(--text-soft)", wordBreak: "break-all", marginBottom: 10 }}>{urlPortal}</div>
          <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
            <button className="btn btn-primary" onClick={descargarQR} disabled={!qrDataUrl} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <Download size={15} /> Descargar QR
            </button>
            <button className="btn btn-secondary" onClick={copiarLink} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <Copy size={15} /> Copiar link
            </button>
          </div>
        </div>
      )}

      <div className="stats-row" style={{ marginBottom: 14 }}>
        <div className="stat-card">
          <div className="stat-label">En la comunidad</div>
          <div className="stat-value">{stats.total.toLocaleString("es-CL")}</div>
          <div className="stat-sub">personas y clínicas</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Formulario del QR</div>
          <div className="stat-value">{stats.formulario.toLocaleString("es-CL")}</div>
          <div className="stat-sub">se registraron en /comunidad</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Sorteos y eventos</div>
          <div className="stat-value">{stats.sorteosEventos.toLocaleString("es-CL")}</div>
          <div className="stat-sub">participaron o se inscribieron</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Clínicas rastreadas</div>
          <div className="stat-value">{stats.rastreadas.toLocaleString("es-CL")}</div>
          <div className="stat-sub">encontradas en Google Maps</div>
        </div>
      </div>

      <div className="pagos-tabs" role="tablist" aria-label="Secciones de Comunidad">
        {[
          { value: "lista", label: "Comunidad", Icono: Users, n: stats.total || null },
          { value: "rastreo", label: "Rastreo de clínicas", Icono: MapPin, n: null },
        ].map((p) => (
          <button key={p.value} type="button" role="tab" aria-selected={vista === p.value} className={vista === p.value ? "activo" : ""} onClick={() => setVista(p.value)}>
            <p.Icono size={15} /> {p.label} {p.n ? <span className="pagos-tab-n">{p.n.toLocaleString("es-CL")}</span> : null}
          </button>
        ))}
      </div>

      {vista === "rastreo" ? (
        <RastreoClinicas setToast={setToast} onGuardado={() => cargar(true)} />
      ) : (
        <>
          {/* Categorías: cuántas filas hay en cada una; un clic filtra. */}
          <div className="comunidad-categorias" role="group" aria-label="Filtrar por categoría" style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
            {CATEGORIAS_COMUNIDAD.map((c) => {
              const activa = fCategoria === c.value;
              return (
                <button
                  key={c.value}
                  type="button"
                  onClick={() => setFCategoria(activa ? "" : c.value)}
                  aria-pressed={activa}
                  title={activa ? "Quitar el filtro" : `Ver solo ${c.label}`}
                  style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 10px", borderRadius: 999, fontSize: 12, fontWeight: 700, cursor: "pointer", background: activa ? c.color : c.bg, color: activa ? "#fff" : c.color, border: `1px solid ${activa ? c.color : "transparent"}` }}
                >
                  {c.label} <span style={{ fontWeight: 800 }}>{stats.porCategoria[c.value] || 0}</span>
                </button>
              );
            })}
            {stats.propuestas > 0 && (
              <button
                type="button"
                onClick={() => setFCategoria(fCategoria === "__propuesta" ? "" : "__propuesta")}
                aria-pressed={fCategoria === "__propuesta"}
                title="Filas cuya categoría la propuso el sistema según su origen y nadie ha confirmado"
                style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 10px", borderRadius: 999, fontSize: 12, fontWeight: 700, cursor: "pointer", background: fCategoria === "__propuesta" ? "#0f172a" : "transparent", color: fCategoria === "__propuesta" ? "#fff" : "var(--text-soft)", border: "1px dashed var(--border-strong, #cbd5e1)" }}
              >
                Por confirmar <span style={{ fontWeight: 800 }}>{stats.propuestas}</span>
              </button>
            )}
          </div>

          <div className="filter-bar" style={{ marginBottom: 14 }}>
            <div className="filter-field filter-field-ancho">
              <label className="filter-label">Buscar</label>
              <input
                className="input"
                placeholder="Nombre, correo, teléfono, universidad, comuna…"
                value={buscar}
                onChange={(e) => setBuscar(e.target.value)}
              />
            </div>
            <div className="filter-field">
              <label className="filter-label">Categoría</label>
              <DropdownSelect
                value={fCategoria}
                onChange={setFCategoria}
                minWidth={290}
                options={[{ value: "", label: "Todas" }, ...OPCIONES_CATEGORIA, { value: "__propuesta", label: "Por confirmar", detalle: "Categoría propuesta por el sistema" }]}
              />
            </div>
            <div className="filter-field">
              <label className="filter-label">Viene de</label>
              <DropdownSelect value={fFuente} onChange={setFFuente} minWidth={220} options={[{ value: "", label: "Todas las fuentes" }, ...FUENTES_COMUNIDAD]} />
            </div>
            <div className="filter-field">
              <label className="filter-label">Desde</label>
              <DateFilter value={fDesde} onChange={setFDesde} />
            </div>
            <div className="filter-field">
              <label className="filter-label">Hasta</label>
              <DateFilter value={fHasta} onChange={setFHasta} />
            </div>
            <BotonLimpiarFiltros hay={hayFiltros} onLimpiar={limpiarFiltros} />
          </div>

          {/* Categorizar varias a la vez: aparece al marcar filas. */}
          {marcadas.size > 0 && (
            <div className="comunidad-masiva" style={{ display: "flex", gap: "8px 12px", flexWrap: "wrap", alignItems: "center", padding: "10px 14px", marginBottom: 12, border: "1px solid var(--primary)", background: "var(--primary-light)", borderRadius: 10, fontSize: 13 }}>
              <Tags size={15} style={{ color: "var(--primary-dark)", flexShrink: 0 }} />
              <strong>{marcadas.size} fila{marcadas.size === 1 ? "" : "s"} marcada{marcadas.size === 1 ? "" : "s"}</strong>
              <DropdownSelect value={categoriaMasiva} onChange={setCategoriaMasiva} options={OPCIONES_CATEGORIA} placeholder="Elige la categoría…" minWidth={290} style={{ width: 250, maxWidth: "100%", height: 34 }} disabled={categorizando} />
              <button type="button" className="btn btn-primary btn-sm" disabled={!categoriaMasiva || categorizando} onClick={() => categorizar([...marcadas], categoriaMasiva)}>
                {categorizando ? "Guardando…" : "Aplicar categoría"}
              </button>
              {filtrados.length > marcadas.size && (
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setMarcadas(new Set(filtrados.map((r) => r.ref)))} disabled={categorizando}>
                  Marcar las {filtrados.length.toLocaleString("es-CL")} del filtro
                </button>
              )}
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setMarcadas(new Set())} disabled={categorizando}>Quitar marcas</button>
            </div>
          )}

          <div className="table-wrap">
            {/* (2026-10-07) tabla-texto: nombre, correo, universidad… parten línea;
                con todo en una línea la tabla no cabía en un notebook de 13". */}
            <table className="data-table tabla-compacta tabla-texto tabla-comunidad" style={{ tableLayout: "fixed", minWidth: 880 }}>
              <thead>
                <tr>
                  <th style={{ width: 36 }}><input type="checkbox" checked={paginaMarcada} onChange={alternarPagina} title="Marcar o desmarcar las filas de esta página" aria-label="Marcar la página" /></th>
                  <th style={{ width: "21%" }}>Nombre</th>
                  <th style={{ width: "22%" }}>Contacto</th>
                  <th style={{ width: 196 }}>Categoría</th>
                  <th style={{ textAlign: "left" }}>Detalle</th>
                  <th style={{ width: 96 }}>Registro</th>
                  <th style={{ width: 76 }}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {cargando ? (
                  <tr><td colSpan={7} style={{ textAlign: "center", padding: 28, color: "var(--text-muted)" }}>Cargando…</td></tr>
                ) : filtrados.length === 0 ? (
                  <tr><td colSpan={7} style={{ textAlign: "center", padding: 28, color: "var(--text-muted)" }}>
                    {registros.length === 0 ? "Aún no hay registros — comparte el QR o rastrea una comuna para partir." : "Sin resultados para el filtro aplicado."}
                  </td></tr>
                ) : (
                  enPagina.map((r) => {
                    const esClinica = r.fuente === "rastreo";
                    // La dirección de Google Maps ya trae comuna y región: solo se agregan si no hay dirección.
                    const detalle = esClinica
                      ? [r.direccion || [r.comuna, r.region].filter(Boolean).join(", ")].filter(Boolean)
                      : [
                          r.perfil === "estudiante" ? [r.anio_estudio, r.universidad].filter(Boolean).join(" · ") : [r.especialidad, r.universidad].filter(Boolean).join(" · "),
                          r.ciudad,
                          r.como_conociste ? `Nos conoció por: ${r.como_conociste}` : "",
                        ].filter(Boolean);
                    return (
                      <tr key={r.ref}>
                        <td><input type="checkbox" checked={marcadas.has(r.ref)} onChange={() => alternar(r.ref)} aria-label={`Marcar a ${nombreFila(r)}`} /></td>
                        <td>
                          <div style={{ fontWeight: 600 }}>{nombreFila(r)}</div>
                          <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 3 }}>
                            {(r.fuentes || []).map((f) => (
                              <span key={f.ref} className={`badge ${COLOR_FUENTE[f.tipo] || "badge-neutral"}`} style={{ fontSize: 10.5 }} title={f.fecha ? `${f.etiqueta} · ${String(f.fecha).slice(0, 10).split("-").reverse().join("-")}` : f.etiqueta}>
                                {f.etiqueta}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td style={{ fontSize: 12.5 }}>
                          {r.correo ? <a href={`mailto:${r.correo}`} style={enlace}><span style={{ overflowWrap: "anywhere" }}>{r.correo}</span></a> : <span style={{ color: "var(--text-muted)" }}>Sin correo</span>}
                          {r.telefono && <div style={{ color: "var(--text-muted)" }}>{telefonoLegible(r.telefono)}</div>}
                          {(r.whatsapp || r.sitio_web) && (
                            <div style={{ display: "flex", gap: "2px 10px", flexWrap: "wrap", marginTop: 2 }}>
                              {r.whatsapp && <a href={enlaceWhatsapp(r.whatsapp)} target="_blank" rel="noopener noreferrer" style={{ ...enlace, color: "#15803d" }} title={`WhatsApp ${telefonoLegible(r.whatsapp)}`}><MessageCircle size={12} /> WhatsApp</a>}
                              {r.sitio_web && <a href={r.sitio_web} target="_blank" rel="noopener noreferrer" style={enlace} title={r.sitio_web}><Globe size={12} /> Página</a>}
                              {r.maps_url && <a href={r.maps_url} target="_blank" rel="noopener noreferrer" style={enlace} title="Abrir en Google Maps"><MapPin size={12} /> Maps</a>}
                            </div>
                          )}
                        </td>
                        <td>
                          <DropdownSelect
                            value={r.categoria}
                            onChange={(v) => categorizar([r.ref], v)}
                            options={OPCIONES_CATEGORIA}
                            minWidth={290}
                            disabled={categorizando}
                            title={r.categoria_auto ? "Categoría propuesta según el origen: elige una para dejarla confirmada" : "Cambiar la categoría"}
                            style={{ width: "100%", height: 30, fontSize: 12, padding: "0 8px", borderStyle: r.categoria_auto ? "dashed" : "solid" }}
                          />
                          {r.categoria_auto && (
                            <button type="button" onClick={() => categorizar([r.ref], r.categoria)} disabled={categorizando} title={`Dejar confirmada como ${nombreCategoria(r.categoria)}`} style={{ background: "none", border: "none", padding: 0, marginTop: 3, fontSize: 11.5, color: "var(--primary-dark, #1e9295)", cursor: "pointer", fontWeight: 600, fontFamily: "inherit" }}>
                              Propuesta · confirmar
                            </button>
                          )}
                        </td>
                        <td style={{ fontSize: 12.5 }}>
                          {detalle.length ? detalle.map((d, i) => <div key={i} style={i ? { color: "var(--text-muted)" } : undefined}>{d}</div>) : "—"}
                        </td>
                        <td style={{ fontSize: 12.5 }}>
                          <span style={{ whiteSpace: "nowrap" }}>{String(r.created_at || "").slice(0, 10).split("-").reverse().join("-") || "—"}</span>
                          {r.correo_enviado != null && (
                            <div style={{ fontSize: 11, lineHeight: 1.25, color: r.correo_enviado ? "#15803d" : "#b45309" }} title="Correo de bienvenida a la comunidad">
                              {r.correo_enviado ? "Bienvenida enviada" : "Sin bienvenida"}
                            </div>
                          )}
                        </td>
                        <td>
                          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                            {r.fuente === "comunidad" && r.id && (
                              <button
                                className="item-action-btn"
                                title="Reenviar correo de bienvenida"
                                onClick={() => reenviar(r)}
                                disabled={reenviando === r.id}
                              >
                                <Mail size={14} style={reenviando === r.id ? { opacity: 0.4 } : undefined} />
                              </button>
                            )}
                            {r.id ? (
                              <button
                                className="item-action-btn item-action-danger"
                                type="button"
                                title="Eliminar de Comunidad"
                                onClick={() => setAEliminar(r)}
                              >
                                <Trash2 size={14} />
                              </button>
                            ) : (
                              <span style={{ fontSize: 11, color: "var(--text-muted)" }} title={`Esta persona está en ${(r.fuentes || []).map((f) => f.etiqueta).join(", ")}: se administra desde ese módulo`}>—</span>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {filtrados.length > 0 && (
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "10px 4px", fontSize: 12.5, color: "var(--text-soft)" }}>
              <span>
                {(paginaActual - 1) * POR_PAGINA + 1}–{Math.min(paginaActual * POR_PAGINA, filtrados.length)} de {filtrados.length.toLocaleString("es-CL")}
                {filtrados.length !== registros.length ? ` (de ${registros.length.toLocaleString("es-CL")} en total)` : ""}
              </span>
              {filtrados.length > POR_PAGINA && (
                <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                  <button type="button" className="btn btn-secondary btn-sm" disabled={paginaActual <= 1} onClick={() => setPagina(paginaActual - 1)}>Anterior</button>
                  <span>Página {paginaActual} de {paginas}</span>
                  <button type="button" className="btn btn-secondary btn-sm" disabled={paginaActual >= paginas} onClick={() => setPagina(paginaActual + 1)}>Siguiente</button>
                </span>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
