import { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { AlertTriangle, CheckCircle2, ExternalLink, FileSpreadsheet, Globe, Loader2, Mail, MapPin, MessageCircle, Phone, Save, Search, Square, Star } from "lucide-react";
import { api } from "../lib/api";
import DropdownSelect from "./ui/DropdownSelect";
import { REGIONES_CHILE } from "../constants/regiones";
import { enlaceWhatsapp, telefonoLegible } from "../lib/comunidad";

/* ── Rastreo de clínicas dentales en Google Maps (2026-11-17) ────────────────
   Pedido de Ariel: «una función de tipo bot que vaya por comunas en Google
   Maps viendo clínicas dentales y registre su nombre, correo, teléfono,
   WhatsApp, página, dirección, comuna y región; luego se almacenan en
   Comunidad Amsodent y se categorizan como Cliente Rastreado. La idea es
   seleccionar la comuna, darle a buscar y que retorne el resultado».

   Tres pasos, a la vista:
     1. Buscar: Google Maps devuelve las clínicas de la comuna (nombre,
        teléfono, página, dirección). No guarda nada.
     2. Leer contactos: el bot entra a la página web de cada clínica, de a
        pocas, y saca el correo y el WhatsApp (Google Maps no los publica). Se
        ve el avance y se puede detener. Tampoco guarda nada.
     3. Guardar: lo que quede marcado entra a Comunidad como «Cliente
        Rastreado». Un lugar se guarda una sola vez: si ya estaba, se
        actualizan sus datos. */

const POR_PAGINA = 12;
const POR_LOTE = 8; // páginas web por llamada (lo mismo que acepta el servidor)
const REGIONES = Object.keys(REGIONES_CHILE);
const fecha = (iso) => (iso ? String(iso).slice(0, 10).split("-").reverse().join("-") : "");
const sinTildes = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export default function RastreoClinicas({ onGuardado, setToast }) {
  const [estado, setEstado] = useState(null);
  const [region, setRegion] = useState(() => REGIONES.find((r) => /metropolitana/i.test(r)) || REGIONES[0] || "");
  const [comuna, setComuna] = useState("");
  const [buscando, setBuscando] = useState(false);
  const [error, setError] = useState("");
  const [busqueda, setBusqueda] = useState(null); // { region, comuna, consultas, total, en_comuna }
  const [resultados, setResultados] = useState([]);
  const [marcadas, setMarcadas] = useState(() => new Set());
  const [verVecinas, setVerVecinas] = useState(false);
  const [verNoDentales, setVerNoDentales] = useState(false);
  const [lectura, setLectura] = useState(null); // { hechas, total, activa }
  const [guardando, setGuardando] = useState(false);
  const [pagina, setPagina] = useState(1);
  const detener = useRef(false);
  const corrida = useRef(0);

  const cargarEstado = () => api.get("/comunidad/rastreo/estado").then(setEstado).catch(() => setEstado({ configurado: true, migracion: true, historial: [] }));
  useEffect(() => { cargarEstado(); }, []);
  // Al salir de la pestaña se corta la lectura en curso.
  useEffect(() => () => { detener.current = true; corrida.current += 1; }, []);

  const comunas = useMemo(() => [...(REGIONES_CHILE[region] || [])].sort((a, b) => a.localeCompare(b, "es")), [region]);
  const previa = useMemo(
    () => (estado?.historial || []).find((h) => sinTildes(h.comuna) === sinTildes(comuna) && sinTildes(h.region) === sinTildes(region)) || null,
    [estado, comuna, region],
  );

  // Por defecto, lo que se pidió: clínicas dentales con dirección en la comuna. Google también devuelve
  // hospitales, CESFAM y centros médicos, y lugares de comunas cercanas: quedan a un clic.
  const visibles = useMemo(() => resultados.filter((r) => (verVecinas || r.en_comuna) && (verNoDentales || r.dental)), [resultados, verVecinas, verNoDentales]);
  const vecinas = resultados.filter((r) => !r.en_comuna && (verNoDentales || r.dental)).length;
  const noDentales = resultados.filter((r) => !r.dental && (verVecinas || r.en_comuna)).length;
  const paginas = Math.max(1, Math.ceil(visibles.length / POR_PAGINA));
  const paginaActual = Math.min(pagina, paginas);
  const enPagina = visibles.slice((paginaActual - 1) * POR_PAGINA, paginaActual * POR_PAGINA);
  const marcadasVisibles = visibles.filter((r) => marcadas.has(r.place_id));
  const leyendo = !!lectura?.activa;
  const conCorreo = visibles.filter((r) => r.correo).length;
  const conWhatsapp = visibles.filter((r) => r.whatsapp).length;

  async function leerContactos(lista, id) {
    const conSitio = lista.filter((r) => r.lee_sitio);
    if (!conSitio.length) { setLectura(null); return; }
    detener.current = false;
    setLectura({ hechas: 0, total: conSitio.length, activa: true });
    for (let i = 0; i < conSitio.length; i += POR_LOTE) {
      if (detener.current || corrida.current !== id) break;
      const lote = conSitio.slice(i, i + POR_LOTE);
      let leidos = [];
      try {
        const r = await api.post("/comunidad/rastreo/contactos", { sitios: lote.map((x) => ({ place_id: x.place_id, url: x.sitio_web })) });
        leidos = Array.isArray(r?.resultados) ? r.resultados : [];
      } catch {
        leidos = lote.map((x) => ({ place_id: x.place_id, leido: false, motivo: "no se pudo leer", correos: [], whatsapps: [] }));
      }
      if (corrida.current !== id) break;
      const porId = new Map(leidos.map((x) => [x.place_id, x]));
      setResultados((prev) =>
        prev.map((r) => {
          const c = porId.get(r.place_id);
          if (!c) return r;
          const whatsappSitio = (c.whatsapps || [])[0] || "";
          return {
            ...r,
            sitio_leido: c.leido ? "ok" : "fallo",
            sitio_motivo: c.motivo || "",
            correo: (c.correos || [])[0] || r.correo,
            correos: (c.correos || []).length ? c.correos : r.correos,
            whatsapp: whatsappSitio || r.whatsapp,
            whatsapp_origen: whatsappSitio ? "sitio" : r.whatsapp_origen,
          };
        }),
      );
      setLectura({ hechas: Math.min(i + lote.length, conSitio.length), total: conSitio.length, activa: true });
    }
    if (corrida.current === id) setLectura((l) => (l ? { ...l, activa: false, detenida: detener.current } : l));
  }

  async function buscar() {
    if (buscando || !region || !comuna) return;
    const id = ++corrida.current;
    detener.current = true;
    setBuscando(true);
    setError("");
    setLectura(null);
    setResultados([]);
    setBusqueda(null);
    setMarcadas(new Set());
    setPagina(1);
    setVerVecinas(false);
    setVerNoDentales(false);
    try {
      const r = await api.post("/comunidad/rastreo/buscar", { region, comuna });
      if (corrida.current !== id) return;
      const lista = Array.isArray(r?.resultados) ? r.resultados : [];
      setBusqueda({ region: r.region, comuna: r.comuna, consultas: r.consultas || [], total: r.total || lista.length, en_comuna: r.en_comuna || 0 });
      setResultados(lista);
      // Vienen marcadas las clínicas dentales de la comuna que aún no están guardadas.
      setMarcadas(new Set(lista.filter((x) => x.en_comuna && x.dental && !x.ya_guardada).map((x) => x.place_id)));
      setBuscando(false);
      // Se leen primero las páginas de lo que se ve por defecto; el resto, después.
      await leerContactos([...lista.filter((x) => x.en_comuna && x.dental), ...lista.filter((x) => !(x.en_comuna && x.dental))], id);
    } catch (e) {
      if (corrida.current === id) setError(e?.message || "No se pudo buscar en Google Maps.");
    } finally {
      if (corrida.current === id) setBuscando(false);
    }
  }

  const alternar = (id) => setMarcadas((prev) => { const s = new Set(prev); if (s.has(id)) s.delete(id); else s.add(id); return s; });
  const todasMarcadas = visibles.length > 0 && visibles.every((r) => marcadas.has(r.place_id));
  function alternarTodas() {
    setMarcadas((prev) => {
      const s = new Set(prev);
      for (const r of visibles) { if (todasMarcadas) s.delete(r.place_id); else s.add(r.place_id); }
      return s;
    });
  }

  async function guardar() {
    if (guardando || !marcadasVisibles.length || !busqueda) return;
    setGuardando(true);
    try {
      const r = await api.post("/comunidad/rastreo/guardar", { region: busqueda.region, comuna: busqueda.comuna, encontrados: resultados.length, resultados: marcadasVisibles });
      const partes = [];
      if (r?.guardados) partes.push(`${r.guardados} clínica${r.guardados === 1 ? "" : "s"} nueva${r.guardados === 1 ? "" : "s"} en Comunidad como Cliente Rastreado`);
      if (r?.actualizados) partes.push(`${r.actualizados} que ya estaba${r.actualizados === 1 ? "" : "n"} se actualiz${r.actualizados === 1 ? "ó" : "aron"}`);
      setToast?.({ type: "success", message: `${partes.join(" y ") || "Sin cambios"}.` });
      const ids = new Set(marcadasVisibles.map((x) => x.place_id));
      setResultados((prev) => prev.map((x) => (ids.has(x.place_id) ? { ...x, ya_guardada: true } : x)));
      setMarcadas(new Set());
      cargarEstado();
      onGuardado?.();
    } catch (e) {
      setToast?.({ type: "error", message: e?.message || "No se pudieron guardar las clínicas." });
    } finally {
      setGuardando(false);
    }
  }

  function exportar() {
    const filas = visibles.map((r) => ({
      Clínica: r.nombre, Teléfono: telefonoLegible(r.telefono), WhatsApp: telefonoLegible(r.whatsapp), Correo: r.correo, "Otros correos": (r.correos || []).slice(1).join(", "),
      "Página web": r.sitio_web, Dirección: r.direccion, Comuna: r.comuna, Región: r.region, "Nota Google": r.nota ?? "", Reseñas: r.resenas ?? "", "Google Maps": r.maps_url,
      Estado: r.ya_guardada ? "Ya está en Comunidad" : "Nueva",
    }));
    const ws = XLSX.utils.json_to_sheet(filas);
    ws["!cols"] = [{ wch: 36 }, { wch: 18 }, { wch: 18 }, { wch: 30 }, { wch: 30 }, { wch: 34 }, { wch: 44 }, { wch: 18 }, { wch: 22 }, { wch: 11 }, { wch: 9 }, { wch: 40 }, { wch: 20 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Clínicas");
    XLSX.writeFile(wb, `Clinicas_${String(busqueda?.comuna || "comuna").replace(/[\\/:*?"<>|]+/g, "-")}.xlsx`);
  }

  const etiqueta = { fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".4px", color: "var(--text-muted)", display: "block", marginBottom: 4 };
  const enlace = { color: "var(--primary-dark, #1e9295)", textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4, maxWidth: "100%" };

  return (
    <div className="rastreo-clinicas" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div className="surface" style={{ padding: "16px 18px" }}>
        <div style={{ fontSize: 14, fontWeight: 700, display: "flex", alignItems: "center", gap: 7, marginBottom: 4 }}>
          <MapPin size={16} style={{ color: "var(--primary-dark)" }} /> Rastrear clínicas dentales en Google Maps
        </div>
        <p style={{ fontSize: 12.5, color: "var(--text-soft)", margin: "0 0 12px", lineHeight: 1.5 }}>
          Elige la comuna y busca: el bot trae de Google Maps las clínicas dentales (nombre, teléfono, página, dirección) y luego entra a la página
          web de cada una para sacar el correo y el WhatsApp. Nada se guarda hasta que pulses «Guardar en Comunidad».
        </p>
        {estado?.mensaje && (
          <div style={{ display: "flex", gap: 8, fontSize: 12.5, color: "#78350f", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 10, padding: "8px 12px", marginBottom: 12 }}>
            <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 1, color: "#d97706" }} />
            <span>{estado.mensaje}{estado.configurado && !estado.migracion ? " Puedes buscar y revisar los resultados; guardar quedará disponible cuando se aplique." : ""}</span>
          </div>
        )}
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div style={{ flex: "1 1 220px", minWidth: 0, maxWidth: 320 }}>
            <span style={etiqueta}>Región</span>
            <DropdownSelect value={region} onChange={(v) => { setRegion(v); setComuna(""); }} options={REGIONES.map((r) => ({ value: r, label: r }))} minWidth={260} style={{ width: "100%" }} disabled={buscando || leyendo} />
          </div>
          <div style={{ flex: "1 1 220px", minWidth: 0, maxWidth: 320 }}>
            <span style={etiqueta}>Comuna</span>
            <DropdownSelect value={comuna} onChange={setComuna} options={comunas.map((c) => ({ value: c, label: c }))} placeholder="Elige la comuna…" minWidth={240} style={{ width: "100%" }} disabled={buscando || leyendo} />
          </div>
          <button type="button" className="btn btn-primary" onClick={buscar} disabled={!comuna || buscando || leyendo || estado?.configurado === false} style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 38 }}>
            {buscando ? <Loader2 size={15} className="spin" /> : <Search size={15} />} {buscando ? "Buscando en Google Maps…" : "Buscar clínicas"}
          </button>
        </div>
        {previa && !buscando && (
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 8 }}>
            Esta comuna ya se rastreó el {fecha(previa.created_at)}{previa.usuario_email ? ` (${String(previa.usuario_email).split("@")[0]})` : ""}: {previa.encontrados} encontradas, {previa.guardados} guardadas.
            Volver a buscar no duplica: las que ya están se marcan y solo se actualizan.
          </div>
        )}
        {error && <div style={{ border: "1px solid #fecaca", background: "#fef2f2", color: "#b91c1c", borderRadius: 10, padding: "10px 12px", fontSize: 13, marginTop: 12, overflowWrap: "anywhere" }}>{error}</div>}
      </div>

      {busqueda && (
        <div className="surface" style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px 14px", flexWrap: "wrap", padding: "12px 16px", borderBottom: "1px solid var(--border)" }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 700 }}>{busqueda.comuna} · {busqueda.en_comuna} clínica{busqueda.en_comuna === 1 ? "" : "s"} dental{busqueda.en_comuna === 1 ? "" : "es"} en la comuna</div>
              <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                De las {visibles.length} en la lista: {conCorreo} con correo · {conWhatsapp} con WhatsApp · {visibles.filter((r) => r.ya_guardada).length} ya están en Comunidad
              </div>
            </div>
            <div style={{ display: "flex", gap: "6px 14px", flexWrap: "wrap", alignItems: "center" }}>
              {(vecinas > 0 || verVecinas) && (
                <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, cursor: "pointer", color: "var(--text-soft)" }} title="Google Maps también devuelve clínicas de comunas cercanas">
                  <input type="checkbox" checked={verVecinas} onChange={(e) => { setVerVecinas(e.target.checked); setPagina(1); }} />
                  Ver también {verVecinas ? "las" : vecinas} de otras comunas
                </label>
              )}
              {(noDentales > 0 || verNoDentales) && (
                <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, cursor: "pointer", color: "var(--text-soft)" }} title="Hospitales, CESFAM y centros médicos que Google Maps devuelve al buscar dentistas">
                  <input type="checkbox" checked={verNoDentales} onChange={(e) => { setVerNoDentales(e.target.checked); setPagina(1); }} />
                  Ver también {verNoDentales ? "los" : noDentales} que no son dentales
                </label>
              )}
              <button type="button" className="btn btn-secondary btn-sm" onClick={exportar} disabled={!visibles.length} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <FileSpreadsheet size={14} /> Excel
              </button>
            </div>
          </div>

          {lectura && (
            <div style={{ padding: "10px 16px", borderBottom: "1px solid var(--border)", background: "var(--bg)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", fontSize: 12.5, marginBottom: 6 }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: leyendo ? "var(--text)" : "var(--text-soft)" }}>
                  {leyendo ? <Loader2 size={14} className="spin" /> : <CheckCircle2 size={14} style={{ color: "#16a34a" }} />}
                  {leyendo
                    ? `Leyendo las páginas web para sacar correo y WhatsApp: ${lectura.hechas} de ${lectura.total}…`
                    : lectura.detenida
                      ? `Lectura detenida: ${lectura.hechas} de ${lectura.total} páginas revisadas.`
                      : `Páginas web revisadas: ${lectura.total}.`}
                </span>
                {leyendo && (
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => { detener.current = true; }} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                    <Square size={12} /> Detener
                  </button>
                )}
              </div>
              <div style={{ height: 6, borderRadius: 999, background: "var(--border)", overflow: "hidden" }} role="progressbar" aria-valuemin={0} aria-valuemax={lectura.total} aria-valuenow={lectura.hechas}>
                <div style={{ height: "100%", width: `${lectura.total ? (lectura.hechas / lectura.total) * 100 : 100}%`, background: "var(--primary)", transition: "width .3s" }} />
              </div>
            </div>
          )}

          {visibles.length === 0 ? (
            <div style={{ padding: 28, textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>
              Google Maps no devolvió clínicas dentales con dirección en {busqueda.comuna}.{vecinas > 0 || noDentales > 0 ? " Marca «Ver también…» para revisar lo demás que encontró." : ""}
            </div>
          ) : (
            <div className="table-wrap" style={{ margin: 0, border: 0, borderRadius: 0 }}>
              <table className="data-table tabla-compacta tabla-texto" style={{ tableLayout: "fixed", minWidth: 860 }}>
                <thead>
                  <tr>
                    <th style={{ width: 36 }}><input type="checkbox" checked={todasMarcadas} onChange={alternarTodas} title="Marcar o desmarcar todas las de la lista" aria-label="Marcar todas" /></th>
                    <th style={{ width: "25%" }}>Clínica</th>
                    <th style={{ width: "17%" }}>Teléfono · WhatsApp</th>
                    <th style={{ width: "21%" }}>Correo</th>
                    <th style={{ width: "13%" }}>Página</th>
                    <th style={{ textAlign: "left" }}>Dirección</th>
                  </tr>
                </thead>
                <tbody>
                  {enPagina.map((r) => (
                    <tr key={r.place_id} style={{ opacity: r.cerrado_temporal ? 0.6 : 1 }}>
                      <td><input type="checkbox" checked={marcadas.has(r.place_id)} onChange={() => alternar(r.place_id)} aria-label={`Marcar ${r.nombre}`} /></td>
                      <td>
                        <div style={{ fontWeight: 600 }}>{r.nombre}</div>
                        <div style={{ fontSize: 11.5, color: "var(--text-muted)", display: "flex", gap: "2px 8px", flexWrap: "wrap", alignItems: "center" }}>
                          {r.rubro && <span>{r.rubro}</span>}
                          {r.nota != null && <span style={{ display: "inline-flex", alignItems: "center", gap: 2 }} title={`${r.resenas || 0} reseñas en Google`}><Star size={11} style={{ color: "#d97706" }} /> {String(r.nota).replace(".", ",")}{r.resenas ? ` (${r.resenas})` : ""}</span>}
                          {r.maps_url && <a href={r.maps_url} target="_blank" rel="noopener noreferrer" style={enlace} title="Abrir en Google Maps"><MapPin size={11} /> Maps</a>}
                        </div>
                        {r.ya_guardada && <span className="badge badge-neutral" style={{ marginTop: 4 }} title="Este lugar ya está en Comunidad: si lo dejas marcado, se actualizan sus datos">Ya está en Comunidad</span>}
                        {r.cerrado_temporal && <span className="badge badge-warning" style={{ marginTop: 4 }}>Cerrado temporalmente</span>}
                        {!r.en_comuna && <span className="badge badge-neutral" style={{ marginTop: 4 }}>{r.comuna || "Otra comuna"}</span>}
                        {!r.dental && <span className="badge badge-neutral" style={{ marginTop: 4 }} title="Google Maps no lo clasifica como dentista ni clínica dental">No dental</span>}
                      </td>
                      <td style={{ fontSize: 12.5 }}>
                        {r.telefono ? <div style={{ display: "flex", alignItems: "center", gap: 5 }}><Phone size={12} style={{ flexShrink: 0, color: "var(--text-muted)" }} /> {telefonoLegible(r.telefono)}</div> : <span style={{ color: "var(--text-muted)" }}>Sin teléfono</span>}
                        {r.whatsapp && (
                          <a href={enlaceWhatsapp(r.whatsapp)} target="_blank" rel="noopener noreferrer" style={{ ...enlace, color: "#15803d", marginTop: 2 }} title={r.whatsapp_origen === "sitio" ? "WhatsApp publicado en su página web" : "Es el celular de Google Maps: probablemente atiende por WhatsApp"}>
                            <MessageCircle size={12} style={{ flexShrink: 0 }} /> {r.whatsapp_origen === "telefono" ? "WhatsApp probable" : r.whatsapp === r.telefono ? "WhatsApp (mismo número)" : telefonoLegible(r.whatsapp)}
                          </a>
                        )}
                      </td>
                      <td style={{ fontSize: 12.5 }}>
                        {r.correo
                          ? <a href={`mailto:${r.correo}`} style={enlace} title={(r.correos || []).length > 1 ? `También: ${(r.correos || []).slice(1).join(", ")}` : r.correo}><Mail size={12} style={{ flexShrink: 0 }} /> <span style={{ overflowWrap: "anywhere" }}>{r.correo}</span></a>
                          : <span style={{ color: "var(--text-muted)" }}>
                              {!r.sitio_web ? "Sin página web" : !r.lee_sitio ? "Su página es una red social" : r.sitio_leido === "ok" ? "Su página no lo publica" : r.sitio_leido === "fallo" ? `No se pudo leer (${r.sitio_motivo || "sin respuesta"})` : leyendo ? "Leyendo…" : "Sin revisar"}
                            </span>}
                        {(r.correos || []).length > 1 && <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>+{r.correos.length - 1} más</div>}
                      </td>
                      <td style={{ fontSize: 12.5 }}>
                        {r.sitio_web
                          ? <a href={r.sitio_web} target="_blank" rel="noopener noreferrer" style={enlace} title={r.sitio_web}><Globe size={12} style={{ flexShrink: 0 }} /> <span className="truncar">{String(r.sitio_web).replace(/^https?:\/\/(www\.)?/, "").replace(/\/.*$/, "")}</span> <ExternalLink size={10} style={{ flexShrink: 0 }} /></a>
                          : <span style={{ color: "var(--text-muted)" }}>—</span>}
                      </td>
                      <td style={{ fontSize: 12.5 }}>{r.direccion || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px 12px", flexWrap: "wrap", padding: "10px 16px", borderTop: "1px solid var(--border)", background: "var(--bg)" }}>
            <span style={{ fontSize: 12.5, color: "var(--text-soft)", display: "inline-flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              {visibles.length > POR_PAGINA && (
                <>
                  <button type="button" className="btn btn-secondary btn-sm" disabled={paginaActual <= 1} onClick={() => setPagina(paginaActual - 1)}>Anterior</button>
                  <span>Página {paginaActual} de {paginas}</span>
                  <button type="button" className="btn btn-secondary btn-sm" disabled={paginaActual >= paginas} onClick={() => setPagina(paginaActual + 1)}>Siguiente</button>
                </>
              )}
              <span>{marcadasVisibles.length} de {visibles.length} marcada{visibles.length === 1 ? "" : "s"}</span>
            </span>
            <button
              type="button"
              className="btn btn-primary"
              onClick={guardar}
              disabled={guardando || leyendo || !marcadasVisibles.length || estado?.migracion === false}
              title={leyendo ? "Espera a que termine la lectura de páginas web (o detenla) para guardar con correo y WhatsApp" : estado?.migracion === false ? "Falta aplicar la migración para poder guardar" : "Entran a Comunidad con la categoría Cliente Rastreado"}
              style={{ display: "inline-flex", alignItems: "center", gap: 6, height: "auto", minHeight: 36, whiteSpace: "normal" }}
            >
              {guardando ? <Loader2 size={15} className="spin" /> : <Save size={15} />}
              {guardando ? "Guardando…" : `Guardar ${marcadasVisibles.length || ""} en Comunidad como Cliente Rastreado`}
            </button>
          </div>
        </div>
      )}

      {!busqueda && (estado?.historial || []).length > 0 && (
        <div className="surface" style={{ padding: "12px 16px" }}>
          <div style={{ ...etiqueta, marginBottom: 8 }}>Comunas ya rastreadas</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {[...new Map((estado.historial || []).map((h) => [`${sinTildes(h.region)}|${sinTildes(h.comuna)}`, h])).values()].slice(0, 40).map((h) => (
              <button key={h.id} type="button" className="btn btn-secondary btn-sm" onClick={() => { if (REGIONES.includes(h.region)) setRegion(h.region); setComuna(h.comuna); }} title={`${h.region} · rastreada el ${fecha(h.created_at)}: ${h.guardados} guardadas`} style={{ fontSize: 12 }}>
                {h.comuna} <span style={{ color: "var(--text-muted)" }}>· {fecha(h.created_at)}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
