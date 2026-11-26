import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Eye, Image as ImageIcon, Loader2, Mail, MailX, RefreshCw, Send, Users, X } from "lucide-react";
import { api } from "../lib/api";
import ConfirmModal from "./ConfirmModal";
import DropdownSelect from "./ui/DropdownSelect";
import { CamposPlantilla, GaleriaPlantillas } from "./MailingPlantillas";
import { CATEGORIAS_COMUNIDAD } from "../lib/comunidad";

/* ── Mailing a la Comunidad Amsodent (2026-11-19) ────────────────────────────
   Pedido de Ariel: «generar funcionalidad de mailing para clientes de la
   comunidad».

   Pestaña «Mailing» de Comunidad. Tres pasos a la vista:
   1. Para quién: toda la comunidad, una o más categorías, el filtro que está
      puesto en la lista o las filas marcadas ahí.
   2. Qué se envía: asunto, mensaje ({nombre} pone el nombre de cada persona),
      una imagen y un botón opcionales. Sale con la plantilla de la marca y un
      enlace para darse de baja.
   3. Simular (a cuántos llega, a quiénes no y por qué, y cómo se ve) y recién
      entonces «Enviar». «Enviarme una prueba» manda el correo solo a quien
      lo redacta.
   El envío corre en el servidor, uno por persona; abajo queda el historial con
   el avance, las aperturas y los fallidos.

   (2026-11-26) Dos agregados, pedidos por Ariel:
   · Plantillas de campaña (presentación de la plataforma, productos nuevos,
     lanzamiento de marca, workshop, hands-on y descuentos): en el paso 2 se
     elige una en la galería y el mensaje libre se cambia por los campos de
     esa plantilla; a la derecha se ve el correo mientras se escribe. El
     diseño y los campos los define el servidor (components/
     MailingPlantillas.jsx solo los dibuja). Simular y enviar siguen igual.
   · Aperturas: el seguimiento muestra quién abrió, cuándo, cuántas veces y
     el % por envío, y quien envió recibe un aviso en la campana (uno por
     envío, que se va actualizando). La apertura es aproximada y así se dice. */

const APERTURA_APROXIMADA = "La apertura es aproximada: no cuenta a quien tiene las imágenes bloqueadas, y Gmail o Apple Mail pueden cargarlas por su cuenta sin que la persona haya leído el correo.";

const POR_PAGINA = 15;
const RE_CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_IMAGEN = 4 * 1024 * 1024;
const caja = { border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", background: "var(--surface)", padding: "14px 16px", minWidth: 0 };
const titulo = { fontSize: 13.5, fontWeight: 700, color: "var(--text)", margin: "0 0 2px", display: "flex", alignItems: "center", gap: 7 };
const suave = { fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 };
const etiqueta = { fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".4px", color: "var(--text-muted)", display: "block", marginBottom: 5 };
const num = (n) => Number(n || 0).toLocaleString("es-CL");
const pct = (a, b) => (b > 0 ? `${Math.round((a / b) * 100)} %` : "—");
const fechaHora = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("es-CL", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
};
const ESTADO_ENVIO = {
  enviando: { texto: "Enviando", clase: "badge-primary" },
  terminado: { texto: "Enviado", clase: "badge-success" },
  interrumpido: { texto: "Interrumpido", clase: "badge-warning", ayuda: "El servidor se reinició mientras enviaba: los que faltaban no recibieron el correo." },
  fallido: { texto: "Falló", clase: "badge-danger" },
};

function Aviso({ tipo = "alerta", children }) {
  const c = tipo === "error" ? { color: "#991b1b", bg: "#fef2f2", borde: "#fecaca", icono: "#dc2626" } : tipo === "ok" ? { color: "#14532d", bg: "#f0fdf4", borde: "#bbf7d0", icono: "#16a34a" } : { color: "#78350f", bg: "#fffbeb", borde: "#fde68a", icono: "#d97706" };
  const Icono = tipo === "ok" ? CheckCircle2 : AlertTriangle;
  return (
    <div style={{ display: "flex", gap: 9, fontSize: 12.5, color: c.color, background: c.bg, border: `1px solid ${c.borde}`, borderRadius: 10, padding: "8px 12px", lineHeight: 1.5 }}>
      <Icono size={15} style={{ flexShrink: 0, marginTop: 2, color: c.icono }} />
      <div style={{ minWidth: 0, overflowWrap: "anywhere" }}>{children}</div>
    </div>
  );
}

/* Detalle de un envío: cada destinatario y qué pasó con su correo. */
function DetalleEnvio({ id }) {
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState("");
  const [ver, setVer] = useState("");
  const [pagina, setPagina] = useState(1);
  useEffect(() => {
    let vivo = true;
    api.get(`/comunidad/mailing/envios/${id}`).then((r) => vivo && setDatos(r)).catch((e) => vivo && setError(e?.message || "No se pudo leer el envío."));
    return () => { vivo = false; };
  }, [id]);
  if (error) return <div style={{ padding: 12 }}><Aviso tipo="error">{error}</Aviso></div>;
  if (!datos) return <div style={{ padding: 14, ...suave }}>Cargando los destinatarios…</div>;
  const estadoDe = (d) => (d.fallo ? "fallido" : d.abierto_at ? "abierto" : d.enviado_at ? "enviado" : "pendiente");
  const lista = (datos.destinatarios || []).filter((d) => !ver || estadoDe(d) === ver);
  const paginas = Math.max(1, Math.ceil(lista.length / POR_PAGINA));
  const actual = Math.min(pagina, paginas);
  const ultimaApertura = (datos.destinatarios || []).reduce((max, d) => { const f = d.ultima_apertura_at || d.abierto_at || ""; return f > max ? f : max; }, "");
  return (
    <div className="detalle-envio-comunidad" style={{ padding: "10px 14px 12px", background: "var(--bg)" }}>
      <div className="resumen-aperturas-envio" style={{ fontSize: 12.5, marginBottom: 8 }}>
        <b>{num(datos.abiertos)}</b> de {num(datos.enviados)} persona{datos.enviados === 1 ? "" : "s"} lo {datos.abiertos === 1 ? "abrió" : "abrieron"} · <b>{pct(datos.abiertos, datos.enviados)}</b> de apertura
        {ultimaApertura ? <span style={{ color: "var(--text-muted)" }}> · última apertura {fechaHora(ultimaApertura)}</span> : null}
      </div>
      {datos.aviso_aperturas && <div style={{ marginBottom: 8 }}><Aviso>{datos.aviso_aperturas}</Aviso></div>}
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
        <DropdownSelect
          value={ver}
          onChange={(v) => { setVer(v); setPagina(1); }}
          minWidth={210}
          style={{ width: 210, maxWidth: "100%", height: 32 }}
          options={[
            { value: "", label: `Todos (${num(datos.destinatarios.length)})` },
            { value: "abierto", label: `Lo abrieron (${num(datos.abiertos)})` },
            { value: "enviado", label: "Enviado, sin abrir" },
            { value: "fallido", label: `Fallidos (${num(datos.fallidos)})` },
            { value: "pendiente", label: `Sin enviar (${num(datos.pendientes)})` },
          ]}
        />
        <span style={{ ...suave, flex: "1 1 260px", minWidth: 0 }}>{APERTURA_APROXIMADA}</span>
      </div>
      <div className="table-wrap" style={{ margin: 0 }}>
        <table className="data-table tabla-compacta tabla-texto tabla-destinatarios-envio" style={{ width: "100%", minWidth: 480, tableLayout: "fixed", fontSize: 12.5 }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left" }}>Correo</th>
              <th style={{ textAlign: "left", width: 140 }}>Enviado</th>
              <th style={{ textAlign: "left", width: 190 }}>Abierto</th>
              <th style={{ textAlign: "left", width: "24%" }}>Problema</th>
            </tr>
          </thead>
          <tbody>
            {lista.length === 0 && <tr><td colSpan={4} style={{ textAlign: "center", padding: 16, color: "var(--text-muted)" }}>Nadie en este grupo.</td></tr>}
            {lista.slice((actual - 1) * POR_PAGINA, actual * POR_PAGINA).map((d) => (
              <tr key={d.email}>
                <td style={{ overflowWrap: "anywhere" }}>{d.email}</td>
                <td>{d.enviado_at ? fechaHora(d.enviado_at) : "—"}</td>
                <td>
                  {d.abierto_at ? fechaHora(d.abierto_at) : "—"}
                  {/* Con la migración 20261126: cuántas veces lo abrió y la última. */}
                  {d.abierto_at && Number(d.aperturas) > 1 ? (
                    <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{num(d.aperturas)} veces{d.ultima_apertura_at ? ` · última ${fechaHora(d.ultima_apertura_at)}` : ""}</div>
                  ) : null}
                </td>
                <td style={{ color: "#b91c1c", overflowWrap: "anywhere" }}>{d.fallo || ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {lista.length > POR_PAGINA && (
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 6, alignItems: "center", paddingTop: 8, fontSize: 12.5, color: "var(--text-soft)" }}>
          <button type="button" className="btn btn-secondary btn-sm" disabled={actual <= 1} onClick={() => setPagina(actual - 1)}>Anterior</button>
          <span>Página {actual} de {paginas}</span>
          <button type="button" className="btn btn-secondary btn-sm" disabled={actual >= paginas} onClick={() => setPagina(actual + 1)}>Siguiente</button>
        </div>
      )}
    </div>
  );
}

// `publico` (todos | categorias | filtro | marcadas) lo guarda la página: la lista puede abrir esta pestaña ya apuntada a «las filas marcadas».
export default function MailingComunidad({ registros, filtrados, marcadas, hayFiltros, publico, setPublico, setToast }) {
  const [categorias, setCategorias] = useState([]);
  const [asunto, setAsunto] = useState("");
  const [mensaje, setMensaje] = useState("Hola {nombre}:\n\n");
  const [botonTexto, setBotonTexto] = useState("");
  const [botonUrl, setBotonUrl] = useState("");
  const [imagen, setImagen] = useState(null);
  const [imagenVista, setImagenVista] = useState("");
  const [imagenUrl, setImagenUrl] = useState("");
  const [sim, setSim] = useState(null); // { clave, datos }
  const [ocupado, setOcupado] = useState("");
  const [confirmar, setConfirmar] = useState(false);
  const [envios, setEnvios] = useState(null);
  // El aviso de aperturas de la campana trae ?envio=<id>: ese envío parte desplegado.
  const [parametros] = useSearchParams();
  const [abierto, setAbierto] = useState(() => Number(parametros.get("envio")) || null);
  const [bajas, setBajas] = useState(null);
  const [correoBaja, setCorreoBaja] = useState("");
  const inputImagen = useRef(null);
  // Plantillas de campaña: el catálogo viene del servidor; "" = correo simple (mensaje libre).
  const [catalogo, setCatalogo] = useState(null);
  const [plantilla, setPlantilla] = useState("");
  const [datosPlantillas, setDatosPlantillas] = useState({}); // lo escrito en cada plantilla, por clave: cambiar de una a otra no lo borra
  const [previa, setPrevia] = useState(null); // { clave, html, problemas, cid, error }

  // Si el público elegido deja de existir (se quitaron las marcas o el filtro), vuelve a «toda la comunidad».
  const publicoVigente = (publico === "marcadas" && !marcadas.size) || (publico === "filtro" && !hayFiltros) ? "todos" : publico;

  const elegidas = useMemo(() => {
    if (publicoVigente === "categorias") return registros.filter((r) => categorias.includes(r.categoria));
    if (publicoVigente === "filtro") return filtrados;
    if (publicoVigente === "marcadas") return registros.filter((r) => marcadas.has(r.ref));
    return registros;
  }, [publicoVigente, registros, filtrados, marcadas, categorias]);
  const conCorreo = useMemo(() => new Set(elegidas.map((r) => String(r.correo || "").trim().toLowerCase()).filter((c) => RE_CORREO.test(c))).size, [elegidas]);
  const porCategoria = useMemo(() => Object.fromEntries(CATEGORIAS_COMUNIDAD.map((c) => [c.value, registros.filter((r) => r.categoria === c.value).length])), [registros]);
  const descripcionPublico = publicoVigente === "todos"
    ? "Toda la comunidad"
    : publicoVigente === "categorias"
      ? `Categorías: ${CATEGORIAS_COMUNIDAD.filter((c) => categorias.includes(c.value)).map((c) => c.label).join(", ") || "ninguna"}`
      : publicoVigente === "filtro" ? "El filtro de la lista" : "Filas marcadas en la lista";

  const plantillaActual = (catalogo?.plantillas || []).find((p) => p.clave === plantilla) || null;
  const datosPlantilla = plantillaActual ? datosPlantillas[plantillaActual.clave] || plantillaActual.inicial : null;
  const datosPlantillaJson = plantillaActual ? JSON.stringify(datosPlantilla) : "";

  const refs = useMemo(() => (publicoVigente === "todos" ? null : elegidas.map((r) => r.ref)), [publicoVigente, elegidas]);
  const clave = JSON.stringify([publicoVigente, refs, asunto.trim(), plantillaActual ? [plantillaActual.clave, datosPlantillaJson] : [mensaje.trim(), botonTexto.trim(), botonUrl.trim()], imagen ? `${imagen.name}:${imagen.size}` : "", imagenUrl.trim()]);
  const simVigente = !!sim && sim.clave === clave;
  const datosSim = simVigente ? sim.datos : null;
  const puedeSimular = asunto.trim().length >= 3 && (plantillaActual || mensaje.trim() || imagen) && elegidas.length > 0;

  const cuerpo = (extra = {}) => {
    const fd = new FormData();
    fd.append("asunto", asunto);
    if (plantillaActual) {
      fd.append("plantilla", plantillaActual.clave);
      fd.append("plantilla_datos", datosPlantillaJson);
    } else {
      fd.append("mensaje", mensaje);
      fd.append("boton_texto", botonTexto);
      fd.append("boton_url", botonUrl);
    }
    fd.append("imagen_url", imagenUrl);
    fd.append("publico", descripcionPublico);
    if (refs) fd.append("refs", JSON.stringify(refs));
    else fd.append("todos", "true");
    for (const [k, v] of Object.entries(extra)) fd.append(k, String(v));
    if (imagen) fd.append("imagen", imagen, imagen.name);
    return fd;
  };

  const cargarEnvios = useCallback(async () => {
    try { setEnvios(await api.get("/comunidad/mailing/envios")); } catch (e) { setEnvios({ listo: false, mensaje: e?.message || "No se pudo leer el historial.", envios: [] }); }
  }, []);
  const cargarBajas = useCallback(async () => {
    try { setBajas(await api.get("/comunidad/mailing/bajas")); } catch { setBajas({ listo: false, bajas: [] }); }
  }, []);
  useEffect(() => { cargarEnvios(); cargarBajas(); }, [cargarEnvios, cargarBajas]);

  // El catálogo de plantillas. Si no llega (servidor sin actualizar), queda solo el correo simple.
  useEffect(() => {
    let vivo = true;
    api.get("/comunidad/mailing/plantillas")
      .then((r) => vivo && setCatalogo({ plantillas: [], ...r }))
      .catch((e) => vivo && setCatalogo({ plantillas: [], error: e?.message || "No se pudieron leer las plantillas." }));
    return () => { vivo = false; };
  }, []);

  function elegirPlantilla(nueva) {
    const p = (catalogo?.plantillas || []).find((x) => x.clave === nueva);
    setPlantilla(p ? p.clave : "");
    if (!p) return;
    // El asunto sugerido solo reemplaza a uno vacío o al sugerido por otra plantilla: lo que escribió la persona se respeta.
    const sugeridos = catalogo.plantillas.map((x) => x.asunto);
    if (!asunto.trim() || sugeridos.includes(asunto)) setAsunto(p.asunto);
  }

  // Vista previa de la plantilla mientras se escribe: la arma el servidor (no lee la comunidad ni envía nada).
  const conImagen = !!imagen;
  useEffect(() => {
    if (!plantilla || !datosPlantillaJson) return undefined;
    let vivo = true;
    const t = setTimeout(() => {
      api.post("/comunidad/mailing/plantillas/vista-previa", { plantilla, plantilla_datos: JSON.parse(datosPlantillaJson), con_imagen: conImagen })
        .then((r) => vivo && setPrevia({ clave: plantilla, html: r?.html || "", problemas: r?.problemas || [], cid: r?.cid_imagen || "" }))
        .catch((e) => vivo && setPrevia({ clave: plantilla, html: "", problemas: [], cid: "", error: e?.message || "No se pudo armar la vista previa." }));
    }, 450);
    return () => { vivo = false; clearTimeout(t); };
  }, [plantilla, datosPlantillaJson, conImagen]);
  const previaVigente = previa && plantillaActual && previa.clave === plantillaActual.clave ? previa : null;
  // Mientras haya un envío en curso, el historial se refresca solo.
  const hayEnCurso = (envios?.envios || []).some((e) => e.estado === "enviando");
  useEffect(() => {
    if (!hayEnCurso) return undefined;
    const t = setInterval(cargarEnvios, 4000);
    return () => clearInterval(t);
  }, [hayEnCurso, cargarEnvios]);

  function elegirImagen(file) {
    if (!file) return;
    if (!/^image\/(png|jpe?g|gif|webp)$/i.test(file.type)) { setToast({ type: "error", message: "La imagen debe ser PNG, JPG, GIF o WEBP." }); return; }
    if (file.size > MAX_IMAGEN) { setToast({ type: "error", message: "La imagen pesa más de 4 MB: achícala antes de adjuntarla." }); return; }
    setImagen(file);
    const lector = new FileReader();
    lector.onload = () => setImagenVista(String(lector.result || ""));
    lector.readAsDataURL(file);
  }
  function quitarImagen() {
    setImagen(null); setImagenVista(""); setImagenUrl("");
    if (inputImagen.current) inputImagen.current.value = "";
  }

  async function simular() {
    setOcupado("simular");
    try {
      const datos = await api.postForm("/comunidad/mailing/simular", cuerpo());
      setSim({ clave, datos });
    } catch (e) {
      setToast({ type: "error", message: e?.message || "No se pudo simular el envío." });
    } finally {
      setOcupado("");
    }
  }
  async function prueba() {
    setOcupado("prueba");
    try {
      const r = await api.postForm("/comunidad/mailing/prueba", cuerpo());
      setToast({ type: "success", message: `Prueba enviada a ${r?.para || "tu correo"}. Revisa también la carpeta de spam.` });
    } catch (e) {
      setToast({ type: "error", message: e?.message || "No se pudo enviar la prueba." });
    } finally {
      setOcupado("");
    }
  }
  async function enviar() {
    setConfirmar(false);
    if (!datosSim) return;
    setOcupado("enviar");
    try {
      const r = await api.postForm("/comunidad/mailing/enviar", cuerpo({ destinatarios_esperados: datosSim.destinatarios }));
      setToast({ type: "success", message: `Envío iniciado a ${num(r?.total)} persona(s). Sigue su avance abajo, en «Envíos».` });
      setSim(null);
      setAbierto(r?.envio_id || null);
      await cargarEnvios();
    } catch (e) {
      setToast({ type: "error", message: e?.message || "No se pudo iniciar el envío." });
    } finally {
      setOcupado("");
    }
  }

  async function darDeBaja() {
    const c = correoBaja.trim().toLowerCase();
    if (!RE_CORREO.test(c)) { setToast({ type: "error", message: "Escribe un correo válido." }); return; }
    try {
      await api.post("/comunidad/mailing/bajas", { correo: c });
      setCorreoBaja("");
      setSim(null);
      await cargarBajas();
      setToast({ type: "success", message: `${c} ya no recibirá los mailings de Comunidad.` });
    } catch (e) {
      setToast({ type: "error", message: e?.message || "No se pudo anotar la baja." });
    }
  }
  async function reactivar(correo) {
    try {
      await api.post("/comunidad/mailing/bajas/reactivar", { correo });
      setSim(null);
      await cargarBajas();
      setToast({ type: "success", message: `${correo} vuelve a recibir los mailings.` });
    } catch (e) {
      setToast({ type: "error", message: e?.message || "No se pudo reactivar." });
    }
  }

  const opcionesPublico = [
    { value: "todos", label: "Toda la comunidad", n: registros.length },
    { value: "categorias", label: "Por categoría", n: null },
    ...(hayFiltros ? [{ value: "filtro", label: "El filtro de la lista", n: filtrados.length }] : []),
    ...(marcadas.size ? [{ value: "marcadas", label: "Las filas marcadas", n: marcadas.size }] : []),
  ];
  const excl = datosSim?.excluidos || null;
  const vistaPrevia = datosSim?.html ? datosSim.html.split(`cid:${datosSim.cid_imagen}`).join(imagenVista || "") : "";
  const vistaPlantilla = previaVigente?.html ? (previaVigente.cid ? previaVigente.html.split(`cid:${previaVigente.cid}`).join(imagenVista || "") : previaVigente.html) : "";
  const minutos = datosSim ? Math.max(1, Math.round((datosSim.destinatarios * 0.7) / 60)) : 0;

  return (
    <div className="mailing-comunidad">
      <ConfirmModal
        open={confirmar}
        title="Enviar el correo"
        message={datosSim ? `Se enviará «${datosSim.asunto}» a ${num(datosSim.destinatarios)} persona(s) (${descripcionPublico.toLowerCase()}). El envío no se puede deshacer. ¿Enviar ahora?` : ""}
        confirmText="Enviar ahora"
        confirmTone="primary"
        onConfirm={enviar}
        onCancel={() => setConfirmar(false)}
      />

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-start" }}>
        {/* ── Redacción ── */}
        <div style={{ flex: "1 1 430px", minWidth: 0, display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={caja} className="mailing-publico">
            <h3 style={titulo}><Users size={15} style={{ color: "var(--primary-dark)" }} /> 1. Para quién</h3>
            <div style={{ ...suave, marginBottom: 10 }}>A cada correo le llega una sola vez. Quedan fuera las filas sin correo y quienes se dieron de baja.</div>
            <div role="radiogroup" aria-label="Público del correo" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {opcionesPublico.map((o) => (
                <label key={o.value} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 10px", borderRadius: 8, fontSize: 13, border: `1px solid ${publicoVigente === o.value ? "var(--primary)" : "var(--border)"}`, background: publicoVigente === o.value ? "var(--primary-light)" : "transparent", cursor: "pointer" }}>
                  <input type="radio" name="publico-mailing" checked={publicoVigente === o.value} onChange={() => setPublico(o.value)} disabled={!!ocupado} /> {o.label}{o.n != null ? <b style={{ fontVariantNumeric: "tabular-nums" }}>{num(o.n)}</b> : null}
                </label>
              ))}
            </div>
            {publicoVigente === "categorias" && (
              <div className="mailing-categorias" role="group" aria-label="Categorías a las que se envía" style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
                {CATEGORIAS_COMUNIDAD.map((c) => {
                  const activa = categorias.includes(c.value);
                  return (
                    <button key={c.value} type="button" aria-pressed={activa} disabled={!!ocupado} onClick={() => setCategorias((prev) => (activa ? prev.filter((x) => x !== c.value) : [...prev, c.value]))} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 10px", borderRadius: 999, fontSize: 12, fontWeight: 700, cursor: "pointer", background: activa ? c.color : c.bg, color: activa ? "#fff" : c.color, border: `1px solid ${activa ? c.color : "transparent"}` }}>
                      {c.label} <span style={{ fontWeight: 800 }}>{porCategoria[c.value] || 0}</span>
                    </button>
                  );
                })}
              </div>
            )}
            <div className="mailing-resumen-publico" style={{ marginTop: 10, fontSize: 13 }}>
              <b>{num(elegidas.length)}</b> fila{elegidas.length === 1 ? "" : "s"} elegida{elegidas.length === 1 ? "" : "s"} · <b>{num(conCorreo)}</b> correo{conCorreo === 1 ? "" : "s"} distinto{conCorreo === 1 ? "" : "s"}
              {elegidas.length === 0 && publicoVigente === "categorias" ? <span style={{ color: "#b45309" }}> · elige al menos una categoría</span> : null}
            </div>
          </div>

          <div style={{ ...caja, display: "flex", flexDirection: "column", gap: 12 }} className="mailing-contenido">
            <h3 style={titulo}><Mail size={15} style={{ color: "var(--primary-dark)" }} /> 2. Qué se envía</h3>
            {/* (2026-11-26) Plantillas de campaña: al elegir una, sus campos reemplazan al mensaje libre. */}
            {(catalogo?.plantillas || []).length > 0 && (
              <div className="mailing-plantillas">
                <span style={etiqueta}>Plantilla</span>
                <GaleriaPlantillas plantillas={catalogo.plantillas} valor={plantillaActual?.clave || ""} onElegir={elegirPlantilla} disabled={!!ocupado} />
                <span style={{ ...suave, display: "block", marginTop: 6 }}>
                  {plantillaActual
                    ? <><b>{plantillaActual.nombre}.</b> {plantillaActual.descripcion} Completa sus datos: a la derecha se ve cómo va quedando.</>
                    : "Elige una plantilla de campaña para partir de un diseño hecho, o sigue con el correo simple."}
                </span>
              </div>
            )}
            {catalogo?.error && <Aviso>No se pudieron cargar las plantillas de campaña ({catalogo.error}). El correo simple funciona igual.</Aviso>}
            <label>
              <span style={etiqueta}>Asunto</span>
              <input className="input campo-asunto-mailing" value={asunto} onChange={(e) => setAsunto(e.target.value.slice(0, 200))} placeholder="Ej.: Ofertas de noviembre para la comunidad Amsodent" disabled={!!ocupado} style={{ width: "100%" }} />
            </label>
            {plantillaActual ? (
              <CamposPlantilla
                plantilla={plantillaActual}
                datos={datosPlantilla}
                onCambiar={(d) => setDatosPlantillas((prev) => ({ ...prev, [plantillaActual.clave]: d }))}
                camposProducto={catalogo?.campos_producto}
                maxProductos={catalogo?.max_productos}
                disabled={!!ocupado}
              />
            ) : (
              <label>
                <span style={etiqueta}>Mensaje</span>
                <textarea className="input campo-mensaje-mailing" rows={9} value={mensaje} onChange={(e) => setMensaje(e.target.value.slice(0, 20000))} disabled={!!ocupado} placeholder="Escribe el correo. Una línea en blanco separa los párrafos." style={{ width: "100%", resize: "vertical", minHeight: 150, fontSize: 13.5, lineHeight: 1.5 }} />
                <span style={{ ...suave, display: "block", marginTop: 4 }}><b>{"{nombre}"}</b> se reemplaza por el nombre de cada persona (o el de la clínica). Los links escritos completos (https://…) quedan pinchables. Va con el logo de Amsodent y el pie para darse de baja.</span>
              </label>
            )}
            <div>
              <span style={etiqueta}>Imagen (opcional)</span>
              <input ref={inputImagen} type="file" accept="image/png,image/jpeg,image/gif,image/webp" style={{ display: "none" }} onChange={(e) => elegirImagen(e.target.files?.[0])} />
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                {imagenVista && <img src={imagenVista} alt="" style={{ width: 72, height: 54, objectFit: "cover", borderRadius: 8, border: "1px solid var(--border)", flexShrink: 0 }} />}
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => inputImagen.current?.click()} disabled={!!ocupado} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <ImageIcon size={14} /> {imagen ? "Cambiar imagen" : "Adjuntar imagen o flyer"}
                </button>
                {imagen && (
                  <>
                    <span style={{ ...suave, overflowWrap: "anywhere", minWidth: 0 }}>{imagen.name} · {(imagen.size / 1024).toFixed(0)} KB</span>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={quitarImagen} disabled={!!ocupado} title="Quitar la imagen" style={{ padding: 5 }}><X size={14} /></button>
                  </>
                )}
              </div>
              {imagen && (
                <input className="input" value={imagenUrl} onChange={(e) => setImagenUrl(e.target.value)} placeholder="Link al que lleva la imagen al pincharla (opcional)" disabled={!!ocupado} style={{ width: "100%", marginTop: 8 }} />
              )}
              <span style={{ ...suave, display: "block", marginTop: 4 }}>{plantillaActual ? "Va bajo el encabezado de la plantilla, a todo el ancho (un flyer o una foto)." : "Va arriba del mensaje, a todo el ancho."} PNG o JPG de hasta 4 MB.</span>
            </div>
            {!plantillaActual && (
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <label style={{ flex: "1 1 170px", minWidth: 0 }}>
                  <span style={etiqueta}>Botón (opcional)</span>
                  <input className="input" value={botonTexto} onChange={(e) => setBotonTexto(e.target.value.slice(0, 60))} placeholder="Ej.: Ver las ofertas" disabled={!!ocupado} style={{ width: "100%" }} />
                </label>
                <label style={{ flex: "2 1 220px", minWidth: 0 }}>
                  <span style={etiqueta}>Link del botón</span>
                  <input className="input" value={botonUrl} onChange={(e) => setBotonUrl(e.target.value)} placeholder="https://amsodentmedical.cl/…" disabled={!!ocupado} style={{ width: "100%" }} />
                </label>
              </div>
            )}
          </div>
        </div>

        {/* ── Simulación y envío ── */}
        <div style={{ ...caja, flex: "1 1 430px", display: "flex", flexDirection: "column", gap: 10 }} className="mailing-simulacion">
          <h3 style={titulo}><Eye size={15} style={{ color: "var(--primary-dark)" }} /> 3. Simular y enviar</h3>
          <div style={suave}>«Simular» revisa la lista y arma el correo sin enviar nada. Con la simulación a la vista se habilita «Enviar».</div>
          <div className="btn-row" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" className="btn btn-secondary btn-simular-mailing" onClick={simular} disabled={!puedeSimular || !!ocupado} title={puedeSimular ? "Muestra a cuántos llega y cómo se ve. No envía nada." : plantillaActual ? "Falta el asunto o elegir a quién va" : "Falta el asunto, el mensaje o elegir a quién va"} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              {ocupado === "simular" ? <Loader2 size={14} className="spin" /> : <Eye size={14} />} Simular
            </button>
            <button type="button" className="btn btn-secondary btn-prueba-mailing" onClick={prueba} disabled={!puedeSimular || !!ocupado} title="Te envía este correo solo a ti, para verlo en tu bandeja" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              {ocupado === "prueba" ? <Loader2 size={14} className="spin" /> : <Mail size={14} />} Enviarme una prueba
            </button>
            <button type="button" className="btn btn-primary btn-enviar-mailing" onClick={() => setConfirmar(true)} disabled={!datosSim || datosSim.bloqueada || !!ocupado} title={datosSim && !datosSim.bloqueada ? "Envía el correo a las personas de la simulación" : "Simula primero: se habilita con la simulación de este mismo correo"} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              {ocupado === "enviar" ? <Loader2 size={14} className="spin" /> : <Send size={14} />} Enviar{datosSim && !datosSim.bloqueada ? ` a ${num(datosSim.destinatarios)}` : ""}
            </button>
          </div>

          {!datosSim && plantillaActual ? (
            /* Con plantilla, el correo se ve mientras se escribe; a cuántos llega lo dice «Simular». */
            <div className="previa-plantilla-mailing" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {sim && <div style={suave}>Cambiaste el correo o el público: simula de nuevo antes de enviar.</div>}
              {previaVigente?.error && <Aviso tipo="error">{previaVigente.error}</Aviso>}
              {previaVigente?.problemas?.length > 0 && <Aviso><b>Para poder enviar:</b> {previaVigente.problemas.join(" ")}</Aviso>}
              <div>
                <span style={etiqueta}>Vista previa de la plantilla · se actualiza mientras escribes</span>
                <div style={{ fontSize: 12.5, marginBottom: 6 }}><span style={{ color: "var(--text-muted)" }}>Asunto:</span> <b>{asunto.trim() || "—"}</b></div>
                {vistaPlantilla
                  ? <iframe title="Vista previa de la plantilla" className="vista-previa-mailing" sandbox="" srcDoc={vistaPlantilla} style={{ width: "100%", height: 520, border: "1px solid var(--border)", borderRadius: 10, background: "#eef2f6" }} />
                  : <div style={{ border: "1px dashed var(--border-strong, #cbd5e1)", borderRadius: 10, padding: "28px 16px", textAlign: "center", ...suave }}>{previaVigente?.error ? "Sin vista previa." : "Armando la vista previa…"}</div>}
                <span style={{ ...suave, display: "block", marginTop: 4 }}>El saludo usa un nombre de ejemplo («Ana»). «Simular» muestra a cuántas personas llega y el correo de la primera.</span>
              </div>
            </div>
          ) : !datosSim ? (
            <div style={{ border: "1px dashed var(--border-strong, #cbd5e1)", borderRadius: 10, padding: "28px 16px", textAlign: "center", ...suave }}>
              {sim ? "Cambiaste el correo o el público: simula de nuevo para ver cómo queda." : "Aquí aparecerá a cuántas personas llega y la vista previa del correo."}
            </div>
          ) : (
            <>
              {datosSim.problemas?.length > 0 && <Aviso tipo="error">{datosSim.problemas.join(" ")}</Aviso>}
              {(datosSim.avisos || []).map((a) => <Aviso key={a}>{a}</Aviso>)}
              <div className="resultado-simulacion-mailing" style={{ border: "1px solid #bbf7d0", background: "#f0fdf4", borderRadius: 10, padding: "9px 12px", fontSize: 13, color: "#14532d", lineHeight: 1.55 }}>
                <b>Simulación: llegaría a {num(datosSim.destinatarios)} persona{datosSim.destinatarios === 1 ? "" : "s"}</b> de {num(datosSim.filas)} fila{datosSim.filas === 1 ? "" : "s"} elegida{datosSim.filas === 1 ? "" : "s"}.
                {excl && (excl.sin_correo + excl.correo_invalido + excl.repetidos + excl.de_baja + excl.no_encontradas > 0) && (
                  <> Quedan fuera: {[
                    excl.sin_correo && `${num(excl.sin_correo)} sin correo`,
                    excl.correo_invalido && `${num(excl.correo_invalido)} con correo mal escrito`,
                    excl.repetidos && `${num(excl.repetidos)} con un correo repetido`,
                    excl.de_baja && `${num(excl.de_baja)} dada(s) de baja`,
                    excl.no_encontradas && `${num(excl.no_encontradas)} que ya no está(n) en la lista`,
                  ].filter(Boolean).join(", ")}.</>
                )}
                {datosSim.por_categoria?.length > 0 && <div style={{ fontSize: 12.5 }}>{datosSim.por_categoria.map((c) => `${c.nombre} ${num(c.n)}`).join(" · ")}</div>}
                {!datosSim.bloqueada && <div style={{ fontSize: 12.5 }}>Sale uno por persona: tarda cerca de {minutos} minuto{minutos === 1 ? "" : "s"} y se puede seguir trabajando mientras tanto.</div>}
              </div>
              <div>
                <span style={etiqueta}>Vista previa · así lo recibe {datosSim.ejemplo?.nombre || datosSim.ejemplo?.correo}</span>
                <div style={{ fontSize: 12.5, marginBottom: 6 }}><span style={{ color: "var(--text-muted)" }}>Asunto:</span> <b>{datosSim.asunto}</b></div>
                <iframe title="Vista previa del correo" className="vista-previa-mailing" sandbox="" srcDoc={vistaPrevia} style={{ width: "100%", height: 460, border: "1px solid var(--border)", borderRadius: 10, background: "#eef2f6" }} />
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Envíos ── */}
      <div style={{ ...caja, marginTop: 12 }} className="mailing-envios">
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <h3 style={titulo}><Send size={15} style={{ color: "var(--primary-dark)" }} /> Envíos</h3>
          <button type="button" className="btn btn-ghost btn-sm" onClick={cargarEnvios} title="Actualizar" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><RefreshCw size={14} /> Actualizar</button>
        </div>
        <div className="nota-aperturas-mailing" style={{ ...suave, marginTop: 2 }}>
          Cuando empiecen a abrir un correo te llega un aviso a la campana (uno por envío, que se va poniendo al día). Abre un envío para ver quién lo abrió y cuándo. {APERTURA_APROXIMADA}
        </div>
        {envios && !envios.listo && envios.mensaje && <div style={{ marginTop: 8 }}><Aviso>{envios.mensaje}</Aviso></div>}
        <div className="table-wrap" style={{ marginTop: 8 }}>
          <table className="data-table tabla-compacta tabla-texto tabla-envios-comunidad" style={{ width: "100%", minWidth: 760, tableLayout: "fixed", fontSize: 12.5 }}>
            <thead>
              <tr>
                <th style={{ width: 30 }} />
                <th style={{ textAlign: "left", width: 132 }}>Fecha</th>
                <th style={{ textAlign: "left" }}>Asunto</th>
                <th style={{ textAlign: "left", width: "18%" }}>Público</th>
                <th style={{ textAlign: "left", width: 150 }}>Enviados</th>
                <th style={{ textAlign: "right", width: 96 }}>Abiertos</th>
                <th style={{ textAlign: "right", width: 72 }}>Fallidos</th>
                <th style={{ textAlign: "left", width: 128 }}>Estado</th>
              </tr>
            </thead>
            <tbody>
              {!envios && <tr><td colSpan={8} style={{ textAlign: "center", padding: 22, color: "var(--text-muted)" }}>Cargando…</td></tr>}
              {envios && (envios.envios || []).length === 0 && <tr><td colSpan={8} style={{ textAlign: "center", padding: 22, color: "var(--text-muted)" }}>Todavía no se ha enviado ningún mailing desde Comunidad.</td></tr>}
              {(envios?.envios || []).map((e) => {
                const est = ESTADO_ENVIO[e.estado] || ESTADO_ENVIO.terminado;
                const hechos = e.enviados + e.fallidos;
                const expandido = abierto === e.id;
                return (
                  <Fragment key={e.id}>
                    <tr onClick={() => setAbierto(expandido ? null : e.id)} style={{ cursor: "pointer", background: expandido ? "#f8fafc" : undefined }} title={expandido ? "Ocultar los destinatarios" : "Ver los destinatarios"}>
                      <td style={{ textAlign: "center", color: "var(--text-muted)" }}>{expandido ? <ChevronDown size={15} /> : <ChevronRight size={15} />}</td>
                      <td>{fechaHora(e.creado_at)}<div style={{ fontSize: 11, color: "var(--text-muted)", overflowWrap: "anywhere" }}>{String(e.creado_por || "").split("@")[0]}</div></td>
                      <td style={{ fontWeight: 600, overflowWrap: "anywhere" }}>{e.asunto}{e.plantilla ? <div style={{ fontSize: 11, fontWeight: 400, color: "var(--text-muted)" }}>Plantilla: {e.plantilla}</div> : null}</td>
                      <td style={{ overflowWrap: "anywhere" }}>{e.publico || "—"}</td>
                      <td>
                        <div style={{ fontVariantNumeric: "tabular-nums" }}><b>{num(e.enviados)}</b> de {num(e.total)}</div>
                        <div role="progressbar" aria-valuemin={0} aria-valuemax={e.total} aria-valuenow={hechos} style={{ height: 5, borderRadius: 999, background: "var(--border)", overflow: "hidden", marginTop: 4 }}>
                          <div style={{ height: "100%", width: `${e.total ? (hechos / e.total) * 100 : 0}%`, background: "var(--primary)" }} />
                        </div>
                      </td>
                      <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                        {e.aperturas === false
                          ? <span style={{ color: "var(--text-muted)" }} title="Este envío salió desde un servidor sin dirección pública: sus aperturas no se pueden registrar.">sin seguimiento</span>
                          : <><b>{num(e.abiertos)}</b> · {pct(e.abiertos, e.enviados)}</>}
                      </td>
                      <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", color: e.fallidos ? "#b91c1c" : undefined }}>{num(e.fallidos)}</td>
                      <td><span className={`badge ${est.clase}`} title={est.ayuda || ""}>{est.texto}</span>{e.estado === "interrumpido" && <div style={{ fontSize: 11, color: "#b45309", marginTop: 2 }}>{num(e.pendientes)} sin enviar</div>}</td>
                    </tr>
                    {expandido && <tr><td colSpan={8} style={{ padding: 0 }}><DetalleEnvio id={e.id} /></td></tr>}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Bajas ── */}
      <details style={{ ...caja, marginTop: 12 }} className="mailing-bajas">
        <summary style={{ cursor: "pointer", fontSize: 13.5, fontWeight: 700 }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 7, verticalAlign: "middle" }}>
            <MailX size={15} style={{ color: "var(--primary-dark)", flexShrink: 0 }} />
            Dados de baja{bajas?.listo ? ` (${num(bajas.bajas.length)})` : ""}
          </span>
        </summary>
        <div style={{ ...suave, margin: "8px 0" }}>Quienes pincharon «date de baja» en un correo, o a quienes alguien del equipo anotó porque lo pidieron. No reciben los mailings de Comunidad.</div>
        {bajas && !bajas.listo && <Aviso>{bajas.mensaje || "Falta aplicar la migración 20261119_comunidad_mailing.sql."}</Aviso>}
        {bajas?.listo && (
          <>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
              <input className="input" value={correoBaja} onChange={(e) => setCorreoBaja(e.target.value)} placeholder="correo@ejemplo.cl" style={{ flex: "1 1 220px", minWidth: 0, maxWidth: 320 }} />
              <button type="button" className="btn btn-secondary btn-sm" onClick={darDeBaja} disabled={!correoBaja.trim()}>Anotar una baja</button>
            </div>
            {bajas.bajas.length > 0 && (
              <div className="table-wrap">
                <table className="data-table tabla-compacta tabla-texto" style={{ width: "100%", minWidth: 420, fontSize: 12.5 }}>
                  <thead><tr><th style={{ textAlign: "left" }}>Correo</th><th style={{ textAlign: "left", width: 150 }}>Desde</th><th style={{ textAlign: "left", width: 130 }}>Cómo</th><th style={{ width: 110 }} /></tr></thead>
                  <tbody>
                    {bajas.bajas.slice(0, 200).map((b) => (
                      <tr key={b.correo}>
                        <td style={{ overflowWrap: "anywhere" }}>{b.correo}</td>
                        <td>{fechaHora(b.created_at)}</td>
                        <td>{b.origen === "enlace" ? "Enlace del correo" : "Anotada a mano"}</td>
                        <td style={{ textAlign: "right" }}><button type="button" className="btn btn-ghost btn-sm" onClick={() => reactivar(b.correo)} title="Vuelve a recibir los mailings">Reactivar</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </details>
    </div>
  );
}
