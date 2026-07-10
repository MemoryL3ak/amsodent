import { useEffect, useRef, useState } from "react";
import { Lock, ShieldCheck, FileText, Upload, Eye, CheckCircle2, LogOut, RefreshCw, ExternalLink, AlertCircle, ArrowRight } from "lucide-react";
import Toast from "../components/Toast";

// Portal del cliente: login con RUT + N° de Cotización (id_licitacion),
// y luego una vista con detalle completo + documentos + subida.

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3001/api";
const TOKEN_KEY = "portal_cliente_token";

function fmtCLP(n) {
  const v = Number(n || 0);
  return `$${v.toLocaleString("es-CL")}`;
}

function fmtFecha(iso) {
  if (!iso) return "—";
  const s = String(iso).slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, d] = s.split("-");
    return `${d}/${m}/${y}`;
  }
  return iso;
}

async function apiRequest(path, options = {}) {
  const token = localStorage.getItem(TOKEN_KEY) || "";
  const headers = { ...(options.headers || {}) };
  if (!options.skipJson) headers["Content-Type"] = "application/json";
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${API_URL}${path}`, { ...options, headers });
  const text = await res.text();
  const body = text ? safeJSON(text) : null;
  if (!res.ok) {
    const err = new Error((body && (body.message || body.error)) || `Error ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return body;
}

function safeJSON(s) {
  try { return JSON.parse(s); } catch { return null; }
}

export default function PortalCliente() {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY) || "");
  const [toast, setToast] = useState(null);

  function handleLogin(newToken) {
    localStorage.setItem(TOKEN_KEY, newToken);
    setToken(newToken);
  }

  function handleLogout() {
    localStorage.removeItem(TOKEN_KEY);
    setToken("");
  }

  return (
    <div className="portal-root">
      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}
      <PortalStyles />

      <div className="portal-bg" aria-hidden />
      <div className="portal-bg-pattern" aria-hidden />

      <div className="portal-shell">
        <header className="portal-header">
          <div className="portal-brand">
            <img src="/logo_superior_ficha.png" alt="Amsodent" className="portal-logo" />
            <div>
              <div className="portal-brand-eyebrow">Portal del Cliente</div>
              <div className="portal-brand-title">Trazabilidad y documentos</div>
            </div>
          </div>
          {token && (
            <button onClick={handleLogout} className="portal-btn portal-btn-ghost" title="Cerrar sesión">
              <LogOut size={14} /> Salir
            </button>
          )}
        </header>

        <main className="portal-main">
          {!token ? (
            <PortalLogin onLogin={handleLogin} setToast={setToast} />
          ) : (
            <PortalDetalle onLogout={handleLogout} setToast={setToast} />
          )}
        </main>

        <footer className="portal-footer">
          <div className="portal-footer-inner">
            <div className="portal-footer-brand">
              <img src="/logo_superior_ficha.png" alt="Amsodent" className="portal-footer-logo" />
              <span>© {new Date().getFullYear()} Amsodent · Portal seguro</span>
            </div>
            <div className="portal-footer-links">
              <span><ShieldCheck size={12} /> Conexión cifrada</span>
              <a href="https://www.amsodentmedical.cl" target="_blank" rel="noopener" className="portal-footer-link">
                amsodentmedical.cl <ExternalLink size={11} />
              </a>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────
   LOGIN
   ───────────────────────────────────────────────────────────────── */

function PortalLogin({ onLogin, setToast }) {
  const [rut, setRut] = useState("");
  const [idLic, setIdLic] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState("");

  async function entrar(e) {
    e?.preventDefault?.();
    setError("");
    if (!rut.trim() || !idLic.trim()) {
      setError("Debes ingresar RUT y N° de cotización.");
      return;
    }
    setEnviando(true);
    try {
      const res = await apiRequest("/portal/login", {
        method: "POST",
        body: JSON.stringify({ rut: rut.trim(), id_licitacion: idLic.trim() }),
      });
      if (res?.token) {
        onLogin(res.token);
        setToast({ type: "success", message: `Bienvenido, ${res.licitacion?.nombre_entidad || "cliente"}.` });
      } else {
        setError("No pudimos iniciar sesión. Revisa los datos.");
      }
    } catch (e) {
      setError(e?.message || "No pudimos iniciar sesión.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="portal-login-grid">
      {/* Columna izquierda: pitch */}
      <section className="portal-pitch animate-fade-up">
        <span className="portal-chip">
          <ShieldCheck size={12} /> Acceso seguro y privado
        </span>
        <h1 className="portal-pitch-title">
          Seguí tu cotización <span className="portal-pitch-accent">en un solo lugar</span>
        </h1>
        <p className="portal-pitch-sub">
          Consulta el estado, descarga documentos y carga la información que necesitamos
          sin enviar correos. Todo lo que subas queda en línea para nuestro equipo al instante.
        </p>

        <ul className="portal-features">
          <li>
            <span className="portal-feat-icon"><FileText size={18} /></span>
            <div>
              <strong>Detalle completo</strong>
              <small>Productos, montos, fechas y estado actualizado.</small>
            </div>
          </li>
          <li>
            <span className="portal-feat-icon"><Upload size={18} /></span>
            <div>
              <strong>Carga tus documentos</strong>
              <small>Orden de compra, guía, factura u otros archivos.</small>
            </div>
          </li>
          <li>
            <span className="portal-feat-icon"><Eye size={18} /></span>
            <div>
              <strong>Visualiza todo</strong>
              <small>Revisa los documentos emitidos por Amsodent.</small>
            </div>
          </li>
        </ul>
      </section>

      {/* Columna derecha: formulario */}
      <section className="portal-login-card animate-fade-up" style={{ animationDelay: "80ms" }}>
        <div className="portal-login-icon">
          <Lock size={22} />
        </div>
        <h2 className="portal-login-title">Acceso del cliente</h2>
        <p className="portal-login-desc">
          Ingresa el RUT de tu institución y el N° de cotización que te enviamos por correo.
        </p>

        <form onSubmit={entrar} className="portal-form">
          <div className="portal-field">
            <label>RUT</label>
            <input
              type="text"
              value={rut}
              onChange={(e) => setRut(e.target.value)}
              placeholder="76.123.456-7"
              autoFocus
              disabled={enviando}
            />
          </div>
          <div className="portal-field">
            <label>N° de cotización</label>
            <input
              type="text"
              value={idLic}
              onChange={(e) => setIdLic(e.target.value)}
              placeholder="Ej: 1002772-1407-COT26"
              disabled={enviando}
            />
          </div>

          {error && (
            <div className="portal-error" role="alert">
              <AlertCircle size={14} /> {error}
            </div>
          )}

          <button type="submit" disabled={enviando} className="portal-btn portal-btn-primary portal-btn-block">
            {enviando ? (
              <>
                <span className="portal-spinner" /> Ingresando…
              </>
            ) : (
              <>Ingresar <ArrowRight size={15} /></>
            )}
          </button>
        </form>

        <div className="portal-help">
          <ShieldCheck size={12} /> Tu sesión se cierra automáticamente a las 24 horas.
        </div>
      </section>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────
   DETALLE
   ───────────────────────────────────────────────────────────────── */

function PortalDetalle({ onLogout, setToast }) {
  const [loading, setLoading] = useState(true);
  const [licitacion, setLicitacion] = useState(null);
  const [productos, setProductos] = useState([]);
  const [documentos, setDocumentos] = useState([]);
  const [errorMsg, setErrorMsg] = useState("");

  // Historial de cotizaciones del mismo cliente (mismo RUT).
  const [historial, setHistorial] = useState([]);
  const [licSelId, setLicSelId] = useState(null); // id de la cotización que se está viendo (null = la del login)

  // Upload
  const [archivo, setArchivo] = useState(null);
  const [tipoDoc, setTipoDoc] = useState("otro");
  const [numeroDoc, setNumeroDoc] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [subiendo, setSubiendo] = useState(false);
  const fileInputRef = useRef(null);

  const tipoRequiereNumero = tipoDoc === "orden_compra" || tipoDoc === "guia_despacho" || tipoDoc === "factura";

  async function cargar(id = licSelId) {
    setLoading(true);
    setErrorMsg("");
    try {
      const qs = id ? `?id=${encodeURIComponent(id)}` : "";
      const [det, docs] = await Promise.all([
        apiRequest(`/portal/cotizacion${qs}`),
        apiRequest(`/portal/documentos${qs}`),
      ]);
      setLicitacion(det?.licitacion || null);
      setProductos(det?.productos || []);
      setDocumentos(docs || []);
    } catch (e) {
      if (e.status === 401) { onLogout(); return; }
      setErrorMsg(e?.message || "No se pudo cargar la cotización.");
    } finally {
      setLoading(false);
    }
  }

  async function cargarHistorial() {
    try {
      const rows = await apiRequest("/portal/cotizaciones");
      setHistorial(Array.isArray(rows) ? rows : []);
    } catch (e) {
      if (e.status === 401) { onLogout(); return; }
      // El historial es complementario: si falla, no bloquea la vista principal.
      console.error("No se pudo cargar el historial:", e?.message || e);
    }
  }

  // Cambia la cotización que se está viendo (desde el historial).
  function verCotizacion(id) {
    if (id === licitacion?.id) return;
    setLicSelId(id);
    cargar(id);
    // Sube al inicio para ver el detalle recién cargado.
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }

  useEffect(() => { cargar(); cargarHistorial(); /* eslint-disable-line */ }, []);

  async function subir() {
    if (!archivo) { setToast({ type: "error", message: "Elige un archivo primero." }); return; }
    if (tipoRequiereNumero && !numeroDoc.trim()) {
      setToast({ type: "error", message: "Ingresa el número del documento." });
      return;
    }
    setSubiendo(true);
    try {
      const token = localStorage.getItem(TOKEN_KEY) || "";
      const fd = new FormData();
      fd.append("file", archivo);
      fd.append("tipo", tipoDoc);
      if (licitacion?.id) fd.append("licitacion_id", String(licitacion.id));
      if (numeroDoc.trim()) fd.append("numero", numeroDoc.trim());
      if (descripcion.trim()) fd.append("descripcion", descripcion.trim());
      const res = await fetch(`${API_URL}/portal/documentos`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      const text = await res.text();
      const body = text ? safeJSON(text) : null;
      if (!res.ok) throw new Error((body && (body.message || body.error)) || `Error ${res.status}`);
      setToast({ type: "success", message: "Documento subido correctamente." });
      setArchivo(null); setNumeroDoc(""); setDescripcion(""); setTipoDoc("otro");
      if (fileInputRef.current) fileInputRef.current.value = "";
      cargar();
    } catch (e) {
      setToast({ type: "error", message: e?.message || "No se pudo subir el archivo." });
    } finally {
      setSubiendo(false);
    }
  }

  async function abrirDoc(doc) {
    try {
      const data = await apiRequest(`/portal/documentos/signed-url?docId=${doc.id}`);
      const url = data?.signedUrl || data?.signedURL;
      if (url) window.open(url, "_blank", "noopener");
      else setToast({ type: "error", message: "No se pudo abrir el archivo." });
    } catch (e) {
      setToast({ type: "error", message: e?.message || "No se pudo abrir el archivo." });
    }
  }

  if (loading) return <div className="portal-card portal-loading">Cargando información de tu cotización…</div>;
  if (errorMsg) return <div className="portal-card" style={{ color: "#b91c1c" }}>{errorMsg}</div>;
  if (!licitacion) return <div className="portal-card">No se encontró la cotización.</div>;

  return (
    <div className="portal-detalle">
      {/* Hero de la cotización */}
      <section className="portal-card portal-hero animate-fade-up">
        <div className="portal-hero-pattern" aria-hidden />
        <div className="portal-hero-content">
          <div className="portal-hero-top">
            <div>
              <div className="portal-hero-eyebrow">Cotización</div>
              <div className="portal-hero-id">{licitacion.id_licitacion || `#${licitacion.id}`}</div>
              <div className="portal-hero-name">{licitacion.nombre_entidad || "—"}</div>
              {licitacion.nombre && (
                <div className="portal-hero-desc">{licitacion.nombre}</div>
              )}
            </div>
            <EstadoBadge estado={licitacion.estado} />
          </div>

          <div className="portal-hero-stats">
            <Stat label="Fecha adjudicada" value={fmtFecha(licitacion.fecha_adjudicada)} />
            <Stat label="Fecha cierre" value={fmtFecha(licitacion.fecha_cierre)} />
            <Stat label="Monto con IVA" value={fmtCLP(licitacion.total_con_iva)} accent />
            <Stat label="Monto neto" value={fmtCLP(licitacion.total_sin_iva)} />
            <Stat label="Tipo de compra" value={licitacion.tipo_compra || "—"} />
            <Stat label="Comuna" value={licitacion.comuna || "—"} />
          </div>
        </div>
      </section>

      {/* Historial de cotizaciones del cliente */}
      {historial.length > 1 && (
        <section className="portal-card animate-fade-up" style={{ animationDelay: "40ms" }}>
          <div className="portal-card-header">
            <div>
              <div className="portal-card-title">
                <FileText size={16} style={{ verticalAlign: "-3px", marginRight: 6 }} />
                Historial de cotizaciones
              </div>
              <div className="portal-card-sub">
                Todas las cotizaciones asociadas a tu RUT. Selecciona una para ver su detalle y documentos.
              </div>
            </div>
            <span className="portal-pill">{historial.length}</span>
          </div>
          <div className="portal-table-wrap">
            <table className="portal-table">
              <thead>
                <tr>
                  <th>N° cotización</th>
                  <th>Descripción</th>
                  <th>Fecha</th>
                  <th>Estado</th>
                  <th className="t-right">Monto con IVA</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {historial.map((h) => {
                  const activa = h.id === licitacion?.id;
                  return (
                    <tr
                      key={h.id}
                      onClick={() => verCotizacion(h.id)}
                      className={activa ? "portal-hist-row is-active" : "portal-hist-row"}
                    >
                      <td className="t-strong" style={{ fontFamily: "ui-monospace, monospace" }}>{h.id_licitacion || `#${h.id}`}</td>
                      <td>{h.nombre || h.nombre_entidad || "—"}</td>
                      <td>{fmtFecha(h.fecha)}</td>
                      <td><EstadoBadge estado={h.estado} /></td>
                      <td className="t-right t-strong">{fmtCLP(h.total_con_iva)}</td>
                      <td className="t-right">
                        {activa
                          ? <span className="portal-tag portal-tag-amsodent">Viendo</span>
                          : <span className="portal-hist-link"><Eye size={13} /> Ver</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Productos */}
      {productos.length > 0 && (
        <section className="portal-card animate-fade-up" style={{ animationDelay: "60ms" }}>
          <div className="portal-card-header">
            <div className="portal-card-title">Productos cotizados</div>
            <span className="portal-pill">{productos.length} ítem{productos.length === 1 ? "" : "s"}</span>
          </div>
          <div className="portal-table-wrap">
            <table className="portal-table">
              <thead>
                <tr>
                  <th>Producto</th>
                  <th className="t-right">Cantidad</th>
                  <th className="t-right">Precio unitario</th>
                  <th className="t-right">Subtotal</th>
                </tr>
              </thead>
              <tbody>
                {productos.map((p) => (
                  <tr key={p.id}>
                    <td>{p.nombre || p.descripcion || "—"}</td>
                    <td className="t-right">{p.cantidad || 0}</td>
                    <td className="t-right">{fmtCLP(p.precio_unitario)}</td>
                    <td className="t-right t-strong">{fmtCLP((p.cantidad || 0) * (p.precio_unitario || 0))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Subida */}
      <section className="portal-card animate-fade-up" style={{ animationDelay: "120ms" }}>
        <div className="portal-card-header">
          <div>
            <div className="portal-card-title">
              <Upload size={16} style={{ verticalAlign: "-3px", marginRight: 6 }} />
              Cargar documento
            </div>
            <div className="portal-card-sub">
              Sube órdenes de compra, comprobantes u otros archivos relacionados a esta cotización.
              Lo recibimos al instante.
            </div>
          </div>
        </div>
        <div className="portal-upload">
          <div className="portal-upload-grid">
            <div className="portal-field">
              <label>Tipo de documento *</label>
              <select value={tipoDoc} onChange={(e) => setTipoDoc(e.target.value)} disabled={subiendo}>
                <option value="orden_compra">Orden de Compra</option>
                <option value="guia_despacho">Guía de Despacho</option>
                <option value="factura">Factura</option>
                <option value="otro">Otro</option>
              </select>
            </div>
            <div className="portal-field">
              <label>N° del documento {tipoRequiereNumero ? "*" : "(opcional)"}</label>
              <input
                type="text"
                value={numeroDoc}
                onChange={(e) => setNumeroDoc(e.target.value)}
                placeholder={tipoRequiereNumero ? "Ej: OC-12345" : "—"}
                disabled={subiendo}
              />
            </div>
          </div>

          <div className="portal-field">
            <label>Archivo *</label>
            <div className="portal-filebox">
              <input
                ref={fileInputRef}
                type="file"
                onChange={(e) => setArchivo(e.target.files?.[0] || null)}
                disabled={subiendo}
              />
              {archivo && <span className="portal-filename">📎 {archivo.name}</span>}
            </div>
          </div>

          <div className="portal-field">
            <label>Descripción (opcional)</label>
            <textarea
              placeholder="Comentarios sobre el documento…"
              value={descripcion}
              onChange={(e) => setDescripcion(e.target.value)}
              disabled={subiendo}
              rows={2}
            />
          </div>

          <button
            type="button"
            onClick={subir}
            disabled={subiendo || !archivo}
            className="portal-btn portal-btn-primary"
          >
            {subiendo ? (<><span className="portal-spinner" /> Subiendo…</>) : (<><Upload size={14} /> Subir documento</>)}
          </button>
        </div>
      </section>

      {/* Documentos */}
      <section className="portal-card animate-fade-up" style={{ animationDelay: "180ms" }}>
        <div className="portal-card-header">
          <div>
            <div className="portal-card-title">Documentos de la cotización</div>
            <div className="portal-card-sub">Total: {documentos.length}</div>
          </div>
          <button onClick={cargar} className="portal-btn portal-btn-ghost">
            <RefreshCw size={13} /> Actualizar
          </button>
        </div>

        {documentos.length === 0 ? (
          <div className="portal-empty">
            <FileText size={26} />
            <span>Aún no hay documentos asociados.</span>
          </div>
        ) : (
          <div className="portal-doc-list">
            {documentos.map((d) => (
              <article key={d.id} className="portal-doc">
                <div className="portal-doc-icon">
                  <TipoIcon tipo={d.tipo} />
                </div>
                <div className="portal-doc-body">
                  <div className="portal-doc-title">
                    {tipoLabel(d.tipo)}
                    {d.numero && <span className="portal-doc-num"> · {d.numero}</span>}
                  </div>
                  <div className="portal-doc-meta">
                    <span>{fmtFecha(d.fecha_oc || d.created_at)}</span>
                    <span>·</span>
                    {d.subido_por_cliente ? (
                      <span className="portal-tag portal-tag-cliente">Subido por ti</span>
                    ) : (
                      <span className="portal-tag portal-tag-amsodent">Amsodent</span>
                    )}
                  </div>
                  {d.descripcion && (
                    <div className="portal-doc-desc">“{d.descripcion}”</div>
                  )}
                </div>
                <div className="portal-doc-action">
                  {d.storage_path ? (
                    <button onClick={() => abrirDoc(d)} className="portal-btn portal-btn-ghost">
                      <Eye size={13} /> Ver
                    </button>
                  ) : <span style={{ color: "var(--portal-muted)" }}>—</span>}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────
   PRIMITIVOS
   ───────────────────────────────────────────────────────────────── */

function Stat({ label, value, accent }) {
  return (
    <div className="portal-stat">
      <div className="portal-stat-label">{label}</div>
      <div className={"portal-stat-value" + (accent ? " is-accent" : "")}>{value}</div>
    </div>
  );
}

function EstadoBadge({ estado }) {
  const e = (estado || "").toLowerCase();
  let cls = "portal-estado portal-estado-neutral";
  if (e === "adjudicada") cls = "portal-estado portal-estado-success";
  else if (e.includes("pendiente")) cls = "portal-estado portal-estado-warning";
  return (
    <span className={cls}>
      <CheckCircle2 size={13} />
      {estado || "Sin estado"}
    </span>
  );
}

function TipoIcon({ tipo }) {
  return <FileText size={18} />;
}

function tipoLabel(t) {
  switch (t) {
    case "orden_compra": return "Orden de Compra";
    case "guia_despacho": return "Guía de Despacho";
    case "factura": return "Factura";
    case "portal_cliente": return "Documento";
    default: return t || "—";
  }
}

/* ─────────────────────────────────────────────────────────────────
   ESTILOS LOCALES — el portal es público, no comparte la app shell
   ───────────────────────────────────────────────────────────────── */

function PortalStyles() {
  return (
    <style>{`
:root {
  --portal-primary:      #28aeb1;
  --portal-primary-dark: #1e9295;
  --portal-primary-deep: #0f5f61;
  --portal-bg:           #f1f8f9;
  --portal-surface:      #ffffff;
  --portal-text:         #0f172a;
  --portal-soft:         #475569;
  --portal-muted:        #94a3b8;
  --portal-border:       #e2e8f0;
  --portal-success:      #15803d;
  --portal-success-bg:   #dcfce7;
  --portal-warning:      #b45309;
  --portal-warning-bg:   #fef3c7;
  --portal-shadow-md:    0 10px 30px rgba(15,23,42,.08);
  --portal-shadow-lg:    0 24px 64px rgba(15,23,42,.12);
}

.portal-root {
  position: relative;
  min-height: 100vh;
  font-family: "Jost", system-ui, sans-serif;
  color: var(--portal-text);
  background: var(--portal-bg);
}

/* Fondo: gradient teal + manchas radiales suaves */
.portal-bg {
  position: fixed; inset: 0; z-index: 0;
  background:
    radial-gradient(900px 600px at 10% -10%, rgba(40,174,177,.30) 0%, transparent 70%),
    radial-gradient(700px 500px at 100% 0%, rgba(178,228,229,.55) 0%, transparent 70%),
    radial-gradient(800px 600px at 50% 110%, rgba(40,174,177,.16) 0%, transparent 70%),
    linear-gradient(180deg, #f0fafa 0%, #e8f7f7 60%, #ffffff 100%);
}
/* Patrón de puntitos sutil */
.portal-bg-pattern {
  position: fixed; inset: 0; z-index: 0;
  background-image: radial-gradient(rgba(40,174,177,.18) 1px, transparent 1px);
  background-size: 22px 22px;
  mask-image: radial-gradient(ellipse at center, black 30%, transparent 80%);
  opacity: .35;
  pointer-events: none;
}

.portal-shell {
  position: relative; z-index: 1;
  max-width: 1180px;
  margin: 0 auto;
  padding: 28px 22px 0;
  display: flex; flex-direction: column;
  min-height: 100vh;
}

/* Header */
.portal-header {
  display: flex; align-items: center; justify-content: space-between;
  gap: 16px;
  padding: 14px 18px;
  background: rgba(255,255,255,.78);
  backdrop-filter: blur(8px);
  border: 1px solid rgba(40,174,177,.18);
  border-radius: 16px;
  box-shadow: 0 1px 0 rgba(255,255,255,.6) inset;
}
.portal-brand { display: flex; align-items: center; gap: 14px; }
.portal-logo { height: 38px; width: auto; display: block; }
.portal-brand-eyebrow {
  font-size: 10px; font-weight: 700; letter-spacing: .18em;
  color: var(--portal-primary-dark); text-transform: uppercase;
}
.portal-brand-title { font-size: 15px; font-weight: 700; color: var(--portal-text); line-height: 1.2; }

.portal-main { flex: 1; padding: 32px 0 24px; }

/* Footer */
.portal-footer { padding: 18px 0 28px; }
.portal-footer-inner {
  display: flex; justify-content: space-between; align-items: center;
  gap: 14px; flex-wrap: wrap;
  padding: 12px 18px;
  background: rgba(255,255,255,.55);
  border: 1px solid var(--portal-border);
  border-radius: 14px;
  font-size: 12px; color: var(--portal-soft);
}
.portal-footer-brand { display: flex; align-items: center; gap: 10px; }
.portal-footer-logo { height: 22px; opacity: .85; }
.portal-footer-links { display: inline-flex; gap: 14px; align-items: center; flex-wrap: wrap; }
.portal-footer-links span, .portal-footer-link {
  display: inline-flex; align-items: center; gap: 4px;
}
.portal-footer-link {
  color: var(--portal-primary-dark);
  text-decoration: none;
  font-weight: 600;
}

/* Login */
.portal-login-grid {
  display: grid;
  grid-template-columns: 1.05fr .95fr;
  gap: 40px;
  align-items: center;
  min-height: 60vh;
}
@media (max-width: 880px) {
  .portal-login-grid { grid-template-columns: 1fr; gap: 24px; }
}

.portal-pitch { padding: 8px; }
.portal-chip {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 5px 12px;
  background: rgba(40,174,177,.12);
  color: var(--portal-primary-deep);
  border: 1px solid rgba(40,174,177,.28);
  border-radius: 999px;
  font-size: 11.5px; font-weight: 600;
  letter-spacing: .03em;
}
.portal-pitch-title {
  margin: 16px 0 12px;
  font-size: 38px; font-weight: 700; line-height: 1.1;
  color: var(--portal-text);
  letter-spacing: -.01em;
}
.portal-pitch-accent {
  background: linear-gradient(90deg, var(--portal-primary) 0%, var(--portal-primary-dark) 80%);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
.portal-pitch-sub { font-size: 15px; color: var(--portal-soft); line-height: 1.55; max-width: 480px; }
.portal-features {
  list-style: none; padding: 0; margin: 22px 0 0;
  display: flex; flex-direction: column; gap: 12px;
}
.portal-features li {
  display: flex; align-items: flex-start; gap: 12px;
  padding: 12px 14px;
  background: rgba(255,255,255,.7);
  border: 1px solid var(--portal-border);
  border-radius: 12px;
  transition: transform .18s, box-shadow .18s, border-color .18s;
}
.portal-features li:hover {
  transform: translateY(-2px);
  border-color: rgba(40,174,177,.45);
  box-shadow: var(--portal-shadow-md);
}
.portal-features strong { display: block; font-size: 14px; color: var(--portal-text); }
.portal-features small { color: var(--portal-soft); font-size: 12.5px; }
.portal-feat-icon {
  flex: none;
  width: 36px; height: 36px;
  display: inline-flex; align-items: center; justify-content: center;
  background: linear-gradient(135deg, var(--portal-primary) 0%, var(--portal-primary-dark) 100%);
  color: #fff; border-radius: 10px;
  box-shadow: 0 6px 16px rgba(40,174,177,.32);
}

.portal-login-card {
  background: var(--portal-surface);
  border: 1px solid var(--portal-border);
  border-radius: 18px;
  box-shadow: var(--portal-shadow-lg);
  padding: 30px 28px 26px;
  position: relative;
  overflow: hidden;
}
.portal-login-card::before {
  content: ""; position: absolute; top: 0; left: 0; right: 0;
  height: 4px;
  background: linear-gradient(90deg, var(--portal-primary) 0%, var(--portal-primary-dark) 100%);
}
.portal-login-icon {
  width: 44px; height: 44px;
  display: inline-flex; align-items: center; justify-content: center;
  background: linear-gradient(135deg, var(--portal-primary) 0%, var(--portal-primary-dark) 100%);
  color: #fff;
  border-radius: 12px;
  box-shadow: 0 8px 20px rgba(40,174,177,.38);
  margin-bottom: 14px;
}
.portal-login-title { margin: 0; font-size: 22px; font-weight: 700; color: var(--portal-text); }
.portal-login-desc { margin: 6px 0 22px; font-size: 13.5px; color: var(--portal-soft); }
.portal-form { display: flex; flex-direction: column; gap: 14px; }

.portal-field { display: flex; flex-direction: column; gap: 5px; }
.portal-field label {
  font-size: 11px; font-weight: 600;
  color: var(--portal-soft);
  text-transform: uppercase; letter-spacing: .07em;
}
.portal-field input,
.portal-field select,
.portal-field textarea {
  width: 100%;
  padding: 11px 13px;
  font-size: 14px;
  border: 1px solid var(--portal-border);
  border-radius: 10px;
  background: #fff;
  color: var(--portal-text);
  font-family: inherit;
  transition: border-color .15s, box-shadow .15s;
}
.portal-field input:focus,
.portal-field select:focus,
.portal-field textarea:focus {
  outline: none;
  border-color: var(--portal-primary);
  box-shadow: 0 0 0 3px rgba(40,174,177,.18);
}
.portal-field input:disabled,
.portal-field select:disabled,
.portal-field textarea:disabled { background: #f8fafc; cursor: not-allowed; }

.portal-error {
  display: flex; align-items: center; gap: 6px;
  padding: 10px 12px;
  background: #fef2f2; border: 1px solid #fecaca;
  color: #b91c1c; border-radius: 10px;
  font-size: 13px;
}
.portal-help {
  margin-top: 16px;
  display: inline-flex; align-items: center; gap: 6px;
  font-size: 11.5px; color: var(--portal-muted);
}

/* Botones */
.portal-btn {
  display: inline-flex; align-items: center; justify-content: center;
  gap: 7px;
  padding: 10px 16px;
  border-radius: 10px;
  font-weight: 600; font-size: 13px;
  cursor: pointer;
  border: 1px solid transparent;
  transition: transform .12s, box-shadow .15s, background .15s, color .15s;
  font-family: inherit;
}
.portal-btn:disabled { cursor: not-allowed; opacity: .65; }
.portal-btn-block { width: 100%; padding: 12px 18px; font-size: 14px; }
.portal-btn-primary {
  background: linear-gradient(135deg, var(--portal-primary) 0%, var(--portal-primary-dark) 100%);
  color: #fff;
  box-shadow: 0 8px 20px rgba(40,174,177,.32);
}
.portal-btn-primary:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 12px 24px rgba(40,174,177,.38);
}
.portal-btn-ghost {
  background: rgba(255,255,255,.9);
  color: var(--portal-primary-dark);
  border-color: var(--portal-border);
}
.portal-btn-ghost:hover:not(:disabled) {
  background: rgba(40,174,177,.10);
  border-color: rgba(40,174,177,.32);
}

.portal-spinner {
  display: inline-block;
  width: 13px; height: 13px;
  border-radius: 50%;
  border: 2px solid rgba(255,255,255,.5);
  border-top-color: #fff;
  animation: portalSpin .8s linear infinite;
}
@keyframes portalSpin { to { transform: rotate(360deg); } }

/* Detalle */
.portal-detalle { display: flex; flex-direction: column; gap: 18px; }
.portal-card {
  background: var(--portal-surface);
  border: 1px solid var(--portal-border);
  border-radius: 16px;
  box-shadow: var(--portal-shadow-md);
  overflow: hidden;
}
.portal-card-header {
  display: flex; align-items: flex-start; justify-content: space-between;
  gap: 12px; padding: 16px 22px;
  border-bottom: 1px solid var(--portal-border);
}
.portal-card-title { font-size: 14px; font-weight: 700; color: var(--portal-text); }
.portal-card-sub { font-size: 12px; color: var(--portal-soft); margin-top: 2px; }
.portal-pill {
  padding: 3px 10px;
  font-size: 11px; font-weight: 600;
  background: rgba(40,174,177,.12);
  color: var(--portal-primary-deep);
  border-radius: 999px;
  border: 1px solid rgba(40,174,177,.25);
}
.portal-loading { padding: 30px; text-align: center; color: var(--portal-soft); }

/* Hero */
.portal-hero { position: relative; }
.portal-hero-pattern {
  position: absolute; inset: 0;
  background:
    radial-gradient(420px 280px at 80% -10%, rgba(40,174,177,.40) 0%, transparent 70%),
    linear-gradient(180deg, rgba(40,174,177,.06) 0%, transparent 100%);
  pointer-events: none;
}
.portal-hero-content { position: relative; padding: 22px 24px; }
.portal-hero-top {
  display: flex; justify-content: space-between; align-items: flex-start;
  gap: 18px; flex-wrap: wrap;
}
.portal-hero-eyebrow {
  font-size: 10px; font-weight: 700; letter-spacing: .12em;
  color: var(--portal-primary-dark); text-transform: uppercase;
}
.portal-hero-id {
  font-size: 22px; font-weight: 700; color: var(--portal-text);
  letter-spacing: -.005em; margin-top: 2px;
  font-family: ui-monospace, monospace;
}
.portal-hero-name { font-size: 17px; font-weight: 600; color: var(--portal-text); margin-top: 8px; }
.portal-hero-desc { font-size: 13px; color: var(--portal-soft); margin-top: 2px; max-width: 600px; }
.portal-hero-stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 12px;
  margin-top: 20px;
}
.portal-stat {
  background: rgba(255,255,255,.75);
  border: 1px solid var(--portal-border);
  border-radius: 12px;
  padding: 10px 12px;
}
.portal-stat-label {
  font-size: 10.5px; color: var(--portal-soft);
  text-transform: uppercase; letter-spacing: .08em; font-weight: 600;
}
.portal-stat-value {
  font-size: 14.5px; font-weight: 700; color: var(--portal-text);
  margin-top: 3px;
}
.portal-stat-value.is-accent { color: var(--portal-primary-dark); }

/* Estado */
.portal-estado {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 5px 12px;
  font-size: 12px; font-weight: 700;
  border-radius: 999px; border: 1px solid;
  white-space: nowrap;
}
.portal-estado-success {
  background: var(--portal-success-bg);
  color: var(--portal-success);
  border-color: #a7f3d0;
}
.portal-estado-warning {
  background: var(--portal-warning-bg);
  color: var(--portal-warning);
  border-color: #fde68a;
}
.portal-estado-neutral { background: #f1f5f9; color: #334155; border-color: #cbd5e1; }

/* Tabla productos */
.portal-table-wrap { overflow-x: auto; }
.portal-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.portal-table thead tr { background: #f8fafc; color: var(--portal-soft); }
.portal-table th, .portal-table td { padding: 10px 14px; text-align: left; }
.portal-table th { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; }
.portal-table tbody tr { border-top: 1px solid var(--portal-border); }
.portal-table tbody tr:hover { background: rgba(40,174,177,.04); }
.portal-table .t-right { text-align: right; }
.portal-table .t-strong { font-weight: 700; color: var(--portal-text); }

/* Historial (filas clickeables) */
.portal-hist-row { cursor: pointer; transition: background .12s; }
.portal-hist-row:hover { background: rgba(40,174,177,.06); }
.portal-hist-row.is-active { background: rgba(40,174,177,.10); }
.portal-hist-row.is-active td:first-child { box-shadow: inset 3px 0 0 var(--portal-primary); }
.portal-hist-link {
  display: inline-flex; align-items: center; gap: 4px;
  color: var(--portal-primary-dark); font-weight: 600; font-size: 12.5px;
  white-space: nowrap;
}

/* Upload */
.portal-upload { padding: 18px 22px 22px; display: flex; flex-direction: column; gap: 14px; }
.portal-upload-grid {
  display: grid; grid-template-columns: 1fr 1fr; gap: 14px;
}
@media (max-width: 640px) { .portal-upload-grid { grid-template-columns: 1fr; } }
.portal-filebox {
  display: flex; flex-direction: column; gap: 6px;
  padding: 14px;
  border: 1.5px dashed rgba(40,174,177,.45);
  border-radius: 12px;
  background: rgba(40,174,177,.04);
}
.portal-filebox input { font-size: 13px; }
.portal-filename { font-size: 12px; color: var(--portal-primary-deep); font-weight: 500; }

/* Lista docs */
.portal-doc-list { padding: 12px 14px 16px; display: flex; flex-direction: column; gap: 8px; }
.portal-doc {
  display: flex; align-items: center; gap: 14px;
  padding: 14px;
  border: 1px solid var(--portal-border);
  border-radius: 12px;
  background: #fff;
  transition: border-color .15s, transform .12s, box-shadow .15s;
}
.portal-doc:hover {
  border-color: rgba(40,174,177,.4);
  transform: translateY(-1px);
  box-shadow: var(--portal-shadow-md);
}
.portal-doc-icon {
  flex: none; width: 40px; height: 40px;
  display: flex; align-items: center; justify-content: center;
  background: rgba(40,174,177,.12);
  color: var(--portal-primary-dark);
  border-radius: 10px;
}
.portal-doc-body { flex: 1; min-width: 0; }
.portal-doc-title { font-size: 14px; font-weight: 600; color: var(--portal-text); }
.portal-doc-num { color: var(--portal-soft); font-weight: 500; }
.portal-doc-meta {
  display: inline-flex; align-items: center; gap: 6px;
  margin-top: 3px; font-size: 12px; color: var(--portal-soft);
}
.portal-doc-desc {
  margin-top: 4px; font-size: 12.5px; color: var(--portal-soft);
  font-style: italic;
}
.portal-doc-action { flex: none; }
.portal-tag {
  font-size: 11px; padding: 2px 8px; border-radius: 999px; font-weight: 600;
}
.portal-tag-cliente { background: #f5f3ff; color: #6d28d9; border: 1px solid #ddd6fe; }
.portal-tag-amsodent { background: rgba(40,174,177,.10); color: var(--portal-primary-deep); border: 1px solid rgba(40,174,177,.28); }

.portal-empty {
  padding: 36px 16px; text-align: center;
  display: flex; flex-direction: column; align-items: center; gap: 10px;
  color: var(--portal-muted);
}

/* Animaciones */
@keyframes portalFadeUp {
  from { opacity: 0; transform: translateY(14px); }
  to   { opacity: 1; transform: translateY(0); }
}
.animate-fade-up {
  animation: portalFadeUp .55s cubic-bezier(.2,.7,.2,1) both;
}
`}</style>
  );
}
