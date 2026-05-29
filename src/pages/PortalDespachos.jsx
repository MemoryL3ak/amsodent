import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import {
  Truck, Package, Search, ArrowLeft, Upload, FileText,
  Image as ImageIcon, Eye, PenLine, CheckCircle2, Clock, MapPin,
  LogOut, RefreshCw, X, AlertCircle, Lock, Eraser, ChevronRight,
  ShieldCheck, Loader2, Calendar, User, Boxes, Navigation, PackageCheck,
} from "lucide-react";
import { supabase } from "../lib/supabase";
import { api } from "../lib/api";
import Toast from "../components/Toast";

/* ─────────────────────────────────────────────────────────────────
   Portal de Trazabilidad de Despachos Internos
   URL propia (/despachos). Rastrea las guías de despacho internas ya
   registradas en el sistema (empresa "Despacho interno").
   ───────────────────────────────────────────────────────────────── */

const ESTADOS = ["Preparación", "En ruta", "Entregado", "No entregado"];

function estiloEstado(estado) {
  switch (estado) {
    case "Entregado":
      return { bg: "#dcfce7", color: "#15803d", border: "#86efac", solid: "#16a34a" };
    case "En ruta":
      return { bg: "#dbeafe", color: "#1d4ed8", border: "#93c5fd", solid: "#2563eb" };
    case "No entregado":
      return { bg: "#fee2e2", color: "#b91c1c", border: "#fca5a5", solid: "#dc2626" };
    default:
      return { bg: "#fef3c7", color: "#b45309", border: "#fcd34d", solid: "#d97706" };
  }
}

function fmtFecha(iso) {
  if (!iso) return "—";
  const s = String(iso).slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, d] = s.split("-");
    return `${d}/${m}/${y}`;
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("es-CL", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function fmtFechaHora(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("es-CL", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function fmtCLP(n) {
  if (n == null || n === "") return "—";
  const v = Number(n);
  if (Number.isNaN(v)) return "—";
  return `$${v.toLocaleString("es-CL")}`;
}

/* ═══════════════════════════════════════════════════════════════════
   COMPONENTE RAÍZ
   ═══════════════════════════════════════════════════════════════════ */

export default function PortalDespachos() {
  const [sesion, setSesion] = useState(undefined); // undefined = cargando
  const [toast, setToast] = useState(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSesion(data?.session || null));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSesion(s || null));
    return () => sub?.subscription?.unsubscribe();
  }, []);

  async function salir() {
    await supabase.auth.signOut();
    setSesion(null);
  }

  return (
    <div className="dsp-root">
      <DespachosStyles />
      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}

      <div className="dsp-bg" aria-hidden />
      <div className="dsp-bg-pattern" aria-hidden />

      {sesion === undefined ? (
        <div className="dsp-boot">
          <Loader2 className="dsp-spin" size={28} />
        </div>
      ) : !sesion ? (
        <LoginDespachos setToast={setToast} />
      ) : (
        <PortalShell sesion={sesion} onSalir={salir} setToast={setToast} />
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   LOGIN
   ═══════════════════════════════════════════════════════════════════ */

function LoginDespachos({ setToast }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [verPwd, setVerPwd] = useState(false);
  const [error, setError] = useState("");
  const [cargando, setCargando] = useState(false);

  async function entrar(e) {
    e.preventDefault();
    setError("");
    if (!email.trim() || !password) {
      setError("Ingresa tu correo y contraseña.");
      return;
    }
    setCargando(true);
    const { error: err } = await supabase.auth.signInWithPassword({
      email: email.trim(), password,
    });
    setCargando(false);
    if (err) {
      setError("Credenciales incorrectas. Verifica tu correo y contraseña.");
      return;
    }
    setToast({ type: "success", message: "Bienvenido al portal de despachos." });
  }

  return (
    <div className="dsp-login-wrap">
      <form onSubmit={entrar} className="dsp-login-card dsp-fade-up">
        <div className="dsp-login-bar" />
        <div className="dsp-login-logo">
          <img src="/logo_superior_ficha.png" alt="Amsodent Medical" />
        </div>
        <div className="dsp-login-icon"><Truck size={24} /></div>
        <h1 className="dsp-login-title">Portal de Despachos</h1>
        <p className="dsp-login-sub">
          Trazabilidad de despachos internos. Ingresa con tu cuenta del sistema.
        </p>

        <div className="dsp-field">
          <label>Correo electrónico</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="correo@amsodentmedical.cl"
            autoComplete="email"
            autoFocus
            disabled={cargando}
          />
        </div>
        <div className="dsp-field">
          <label>Contraseña</label>
          <div className="dsp-pwd">
            <input
              type={verPwd ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
              disabled={cargando}
            />
            <button type="button" onClick={() => setVerPwd((v) => !v)} tabIndex={-1}>
              <Eye size={15} />
            </button>
          </div>
        </div>

        {error && (
          <div className="dsp-error" role="alert">
            <AlertCircle size={14} /> {error}
          </div>
        )}

        <button type="submit" className="dsp-btn dsp-btn-primary dsp-btn-block" disabled={cargando}>
          {cargando ? (<><Loader2 size={15} className="dsp-spin" /> Ingresando…</>) : (<><Lock size={14} /> Ingresar</>)}
        </button>

        <div className="dsp-login-foot">
          <ShieldCheck size={12} /> Acceso exclusivo para personal autorizado
        </div>
      </form>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   SHELL DEL PORTAL
   ═══════════════════════════════════════════════════════════════════ */

function PortalShell({ sesion, onSalir, setToast }) {
  const [vista, setVista] = useState({ tipo: "lista" });
  const email = sesion?.user?.email || "";

  return (
    <div className="dsp-shell">
      <header className="dsp-header">
        <div className="dsp-header-inner">
          <div className="dsp-brand" onClick={() => setVista({ tipo: "lista" })} role="button" tabIndex={0}>
            <div className="dsp-brand-chip">
              <img src="/logo_superior_ficha.png" alt="Amsodent Medical" />
            </div>
            <div className="dsp-brand-text">
              <div className="dsp-brand-eyebrow"><Truck size={11} /> Portal de Despachos</div>
              <div className="dsp-brand-title">Trazabilidad de despachos internos</div>
            </div>
          </div>
          <div className="dsp-header-right">
            <div className="dsp-user">
              <div className="dsp-user-avatar">{(email[0] || "U").toUpperCase()}</div>
              <span className="dsp-user-email">{email}</span>
            </div>
            <button className="dsp-btn dsp-btn-ghost dsp-btn-sm" onClick={onSalir} title="Cerrar sesión">
              <LogOut size={14} /> Salir
            </button>
          </div>
        </div>
      </header>

      <main className="dsp-main">
        {vista.tipo === "lista" ? (
          <ListaDespachos
            onAbrir={(id) => setVista({ tipo: "detalle", id })}
            setToast={setToast}
          />
        ) : (
          <DetalleDespacho
            id={vista.id}
            onVolver={() => setVista({ tipo: "lista" })}
            setToast={setToast}
          />
        )}
      </main>

      <footer className="dsp-footer">
        © {new Date().getFullYear()} Amsodent Medical · Portal de despachos internos
      </footer>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   LISTA DE DESPACHOS
   ═══════════════════════════════════════════════════════════════════ */

function ListaDespachos({ onAbrir, setToast }) {
  const [todos, setTodos] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [busqueda, setBusqueda] = useState("");
  const [filtroEstado, setFiltroEstado] = useState("");

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const data = await api.get("/despachos");
      setTodos(Array.isArray(data) ? data : []);
    } catch (e) {
      setToast({ type: "error", message: e?.message || "No se pudieron cargar los despachos." });
    } finally {
      setCargando(false);
    }
  }, [setToast]);

  useEffect(() => { cargar(); }, [cargar]);

  const kpis = useMemo(() => {
    const c = { total: todos.length };
    ESTADOS.forEach((e) => { c[e] = todos.filter((d) => d.estado === e).length; });
    return c;
  }, [todos]);

  const filtrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return todos.filter((d) => {
      if (filtroEstado && d.estado !== filtroEstado) return false;
      if (!q) return true;
      return [d.numero_guia, d.id_licitacion, d.cliente_nombre, d.comuna]
        .some((v) => String(v || "").toLowerCase().includes(q));
    });
  }, [todos, busqueda, filtroEstado]);

  return (
    <div className="dsp-fade-up">
      {/* Encabezado */}
      <div className="dsp-page-head">
        <div>
          <h1 className="dsp-page-title">Despachos internos</h1>
          <p className="dsp-page-sub">
            Seguimiento de las guías de despacho marcadas como <strong>“Despacho interno”</strong> en el sistema.
            Controla su estado, adjunta evidencia y registra la firma de recepción.
          </p>
        </div>
        <button className="dsp-btn dsp-btn-ghost" onClick={cargar} title="Actualizar">
          <RefreshCw size={15} /> Actualizar
        </button>
      </div>

      {/* KPIs */}
      <div className="dsp-kpis">
        <KpiCard icon={<Boxes size={18} />} tono="ink"
          valor={kpis.total} label="Guías internas" />
        <KpiCard icon={<Package size={18} />} tono="amber"
          valor={kpis["Preparación"]} label="En preparación" />
        <KpiCard icon={<Navigation size={18} />} tono="blue"
          valor={kpis["En ruta"]} label="En ruta" />
        <KpiCard icon={<PackageCheck size={18} />} tono="green"
          valor={kpis["Entregado"]} label="Entregados" />
      </div>

      {/* Toolbar */}
      <div className="dsp-toolbar">
        <div className="dsp-search">
          <Search size={15} />
          <input
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar por guía, cotización, cliente o comuna…"
          />
          {busqueda && (
            <button onClick={() => setBusqueda("")} className="dsp-search-clear"><X size={13} /></button>
          )}
        </div>
        <div className="dsp-filtros">
          <button
            className={`dsp-chip ${!filtroEstado ? "is-on" : ""}`}
            onClick={() => setFiltroEstado("")}
          >
            Todos <span className="dsp-chip-n">{todos.length}</span>
          </button>
          {ESTADOS.map((e) => {
            const st = estiloEstado(e);
            const on = filtroEstado === e;
            return (
              <button
                key={e}
                className={`dsp-chip ${on ? "is-on" : ""}`}
                onClick={() => setFiltroEstado(on ? "" : e)}
                style={on ? { background: st.bg, color: st.color, borderColor: st.border } : undefined}
              >
                {e} <span className="dsp-chip-n">{kpis[e] || 0}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Resultados */}
      {cargando ? (
        <div className="dsp-grid">
          {[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="dsp-card dsp-skel" />)}
        </div>
      ) : todos.length === 0 ? (
        <div className="dsp-empty">
          <div className="dsp-empty-ico"><Package size={30} /></div>
          <div className="dsp-empty-title">Aún no hay despachos internos</div>
          <div className="dsp-empty-sub">
            Los despachos aparecen aquí automáticamente cuando se registra una guía de despacho
            con la empresa <strong>“Despacho interno”</strong> dentro de una cotización (módulo Trazabilidad).
          </div>
        </div>
      ) : filtrados.length === 0 ? (
        <div className="dsp-empty">
          <div className="dsp-empty-ico"><Search size={28} /></div>
          <div className="dsp-empty-title">Sin coincidencias</div>
          <div className="dsp-empty-sub">Prueba ajustando la búsqueda o el filtro de estado.</div>
        </div>
      ) : (
        <div className="dsp-grid">
          {filtrados.map((d) => {
            const st = estiloEstado(d.estado);
            return (
              <button
                key={d.documento_id}
                className="dsp-card dsp-card-clic"
                style={{ "--acc": st.solid }}
                onClick={() => onAbrir(d.documento_id)}
              >
                <div className="dsp-card-top">
                  <div className="dsp-card-guia">
                    <span className="dsp-card-guia-label">Guía de despacho</span>
                    <span className="dsp-card-guia-num">{d.numero_guia || `#${d.documento_id}`}</span>
                  </div>
                  <span
                    className="dsp-badge"
                    style={{ background: st.bg, color: st.color, borderColor: st.border }}
                  >
                    {d.estado}
                  </span>
                </div>
                <div className="dsp-card-cliente">{d.cliente_nombre || "Sin cliente"}</div>
                <div className="dsp-card-meta">
                  {d.id_licitacion && (
                    <span className="dsp-card-cot"><FileText size={12} /> {d.id_licitacion}</span>
                  )}
                  {d.comuna && <span><MapPin size={12} /> {d.comuna}</span>}
                </div>
                <div className="dsp-card-foot">
                  <span><Calendar size={12} /> {fmtFecha(d.fecha_guia || d.created_at)}</span>
                  {d.tiene_firma && (
                    <span className="dsp-card-firma"><PenLine size={12} /> Firmado</span>
                  )}
                  <ChevronRight size={15} className="dsp-card-arrow" />
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function KpiCard({ icon, valor, label, tono }) {
  return (
    <div className={`dsp-kpi dsp-kpi-${tono}`}>
      <div className="dsp-kpi-ico">{icon}</div>
      <div className="dsp-kpi-body">
        <div className="dsp-kpi-valor">{valor ?? 0}</div>
        <div className="dsp-kpi-label">{label}</div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   DETALLE DEL DESPACHO
   ═══════════════════════════════════════════════════════════════════ */

function DetalleDespacho({ id, onVolver, setToast }) {
  const [datos, setDatos] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");

  const cargar = useCallback(async () => {
    try {
      const data = await api.get(`/despachos/${id}`);
      setDatos(data);
      setError("");
    } catch (e) {
      setError(e?.message || "No se pudo cargar el despacho.");
    } finally {
      setCargando(false);
    }
  }, [id]);

  useEffect(() => { cargar(); }, [cargar]);

  if (cargando) {
    return (
      <div className="dsp-detalle-loading">
        <Loader2 size={26} className="dsp-spin" /> Cargando despacho…
      </div>
    );
  }
  if (error || !datos) {
    return (
      <div className="dsp-empty">
        <div className="dsp-empty-ico"><AlertCircle size={28} /></div>
        <div className="dsp-empty-title">{error || "Despacho no disponible"}</div>
        <button className="dsp-btn dsp-btn-ghost" onClick={onVolver}>
          <ArrowLeft size={15} /> Volver al listado
        </button>
      </div>
    );
  }

  const { guia, licitacion, despacho, archivos, eventos } = datos;
  const st = estiloEstado(despacho.estado);

  return (
    <div className="dsp-fade-up">
      <button className="dsp-volver" onClick={onVolver}>
        <ArrowLeft size={15} /> Volver al listado
      </button>

      {/* Hero */}
      <section className="dsp-card dsp-hero">
        <div className="dsp-hero-pattern" aria-hidden />
        <div className="dsp-hero-body">
          <div className="dsp-hero-top">
            <div>
              <div className="dsp-hero-eyebrow"><Truck size={12} /> Guía de despacho interna</div>
              <div className="dsp-hero-guia">{guia.numero || `#${guia.id}`}</div>
              <div className="dsp-hero-cliente">
                {licitacion?.nombre_entidad || licitacion?.nombre || "Sin cliente"}
              </div>
            </div>
            <span
              className="dsp-badge dsp-badge-lg"
              style={{ background: st.bg, color: st.color, borderColor: st.border }}
            >
              {despacho.estado}
            </span>
          </div>
          <div className="dsp-hero-stats">
            <DetItem icon={<FileText size={14} />} label="Cotización" value={licitacion?.id_licitacion || "—"} />
            <DetItem icon={<MapPin size={14} />} label="Comuna" value={licitacion?.comuna || "—"} />
            <DetItem icon={<Calendar size={14} />} label="Fecha de guía" value={fmtFecha(guia.fecha_oc)} />
            <DetItem icon={<Package size={14} />} label="Monto" value={fmtCLP(guia.monto)} />
            <DetItem icon={<Truck size={14} />} label="Modalidad" value={guia.empresa_despacho || "Despacho interno"} />
            {despacho.entregado_at && (
              <DetItem icon={<CheckCircle2 size={14} />} label="Entregado" value={fmtFechaHora(despacho.entregado_at)} />
            )}
          </div>
        </div>
      </section>

      <div className="dsp-detalle-grid">
        <div className="dsp-detalle-col">
          <PanelEstado docId={id} estadoActual={despacho.estado} onActualizar={cargar} setToast={setToast} />
          <PanelArchivos docId={id} archivos={archivos} onActualizar={cargar} setToast={setToast} />
        </div>
        <div className="dsp-detalle-col">
          <PanelFirma docId={id} despacho={despacho} onActualizar={cargar} setToast={setToast} />
          <PanelEventos eventos={eventos} />
        </div>
      </div>
    </div>
  );
}

function DetItem({ icon, label, value }) {
  return (
    <div className="dsp-det-item">
      <div className="dsp-det-item-label">{icon} {label}</div>
      <div className="dsp-det-item-value">{value}</div>
    </div>
  );
}

/* ── Panel: cambio de estado ──────────────────────────────────────── */

function PanelEstado({ docId, estadoActual, onActualizar, setToast }) {
  const [seleccion, setSeleccion] = useState(estadoActual);
  const [nota, setNota] = useState("");
  const [guardando, setGuardando] = useState(false);

  useEffect(() => { setSeleccion(estadoActual); }, [estadoActual]);

  const cambiado = seleccion !== estadoActual;

  async function guardar() {
    setGuardando(true);
    try {
      await api.put(`/despachos/${docId}/estado`, { estado: seleccion, nota: nota.trim() });
      setToast({ type: "success", message: `Estado actualizado a "${seleccion}".` });
      setNota("");
      onActualizar();
    } catch (e) {
      setToast({ type: "error", message: e?.message || "No se pudo cambiar el estado." });
    } finally {
      setGuardando(false);
    }
  }

  return (
    <section className="dsp-card dsp-panel">
      <div className="dsp-panel-head">
        <div className="dsp-panel-ico dsp-ico-teal"><RefreshCw size={15} /></div>
        <div>
          <div className="dsp-panel-title">Estado del despacho</div>
          <div className="dsp-panel-sub">Selecciona el nuevo estado y registra el cambio.</div>
        </div>
      </div>
      <div className="dsp-panel-body">
        <div className="dsp-estado-opciones">
          {ESTADOS.map((e) => {
            const st = estiloEstado(e);
            const on = seleccion === e;
            return (
              <button
                key={e}
                className={`dsp-estado-opt ${on ? "is-on" : ""}`}
                onClick={() => setSeleccion(e)}
                style={on ? {
                  background: st.bg, color: st.color, borderColor: st.border,
                  boxShadow: `0 0 0 3px ${st.bg}`,
                } : undefined}
              >
                {on && <CheckCircle2 size={14} />}
                {e}
              </button>
            );
          })}
        </div>
        <div className="dsp-field">
          <label>Nota del cambio (opcional)</label>
          <input
            value={nota}
            onChange={(e) => setNota(e.target.value)}
            placeholder="Ej: salió a reparto con transporte interno…"
          />
        </div>
        <button
          className="dsp-btn dsp-btn-primary dsp-btn-block"
          onClick={guardar}
          disabled={!cambiado || guardando}
        >
          {guardando
            ? (<><Loader2 size={15} className="dsp-spin" /> Guardando…</>)
            : cambiado
              ? (<><CheckCircle2 size={15} /> Guardar cambio de estado</>)
              : "Estado sin cambios"}
        </button>
      </div>
    </section>
  );
}

/* ── Panel: archivos (fotos / PDF) ────────────────────────────────── */

function PanelArchivos({ docId, archivos, onActualizar, setToast }) {
  const [subiendo, setSubiendo] = useState(false);
  const inputRef = useRef(null);

  async function subir(fileList) {
    const files = Array.from(fileList || []);
    if (files.length === 0) return;
    setSubiendo(true);
    try {
      for (const file of files) {
        const fd = new FormData();
        fd.append("file", file);
        await api.postForm(`/despachos/${docId}/archivos`, fd);
      }
      setToast({ type: "success", message: "Evidencia subida correctamente." });
      onActualizar();
    } catch (e) {
      setToast({ type: "error", message: e?.message || "No se pudo subir el archivo." });
    } finally {
      setSubiendo(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <section className="dsp-card dsp-panel">
      <div className="dsp-panel-head">
        <div className="dsp-panel-ico dsp-ico-blue"><ImageIcon size={15} /></div>
        <div>
          <div className="dsp-panel-title">Evidencia del despacho</div>
          <div className="dsp-panel-sub">Fotos, PDF u otros documentos de respaldo.</div>
        </div>
        <span className="dsp-panel-count">{archivos.length}</span>
      </div>
      <div className="dsp-panel-body">
        <button
          className="dsp-dropzone"
          onClick={() => inputRef.current?.click()}
          disabled={subiendo}
        >
          {subiendo ? (
            <><Loader2 size={20} className="dsp-spin" /> <span>Subiendo archivos…</span></>
          ) : (
            <>
              <div className="dsp-dropzone-ico"><Upload size={18} /></div>
              <span className="dsp-dropzone-title">Subir fotos o documentos</span>
              <span className="dsp-dropzone-sub">Imágenes y PDF · hasta 20 MB c/u</span>
            </>
          )}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="image/*,application/pdf"
          multiple
          style={{ display: "none" }}
          onChange={(e) => subir(e.target.files)}
        />

        {archivos.length > 0 && (
          <div className="dsp-archivos">
            {archivos.map((a) => (
              <a
                key={a.id}
                href={a.url || "#"}
                target="_blank"
                rel="noopener noreferrer"
                className="dsp-archivo"
              >
                {a.tipo === "foto" && a.url ? (
                  <div className="dsp-archivo-thumb" style={{ backgroundImage: `url(${a.url})` }} />
                ) : (
                  <div className="dsp-archivo-thumb dsp-archivo-thumb-doc">
                    <FileText size={22} />
                  </div>
                )}
                <div className="dsp-archivo-info">
                  <div className="dsp-archivo-nombre">{a.nombre || "Archivo"}</div>
                  <div className="dsp-archivo-fecha">{fmtFecha(a.created_at)}</div>
                </div>
                <Eye size={14} className="dsp-archivo-ver" />
              </a>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

/* ── Panel: firma de recepción ────────────────────────────────────── */

function PanelFirma({ docId, despacho, onActualizar, setToast }) {
  const [reFirmar, setReFirmar] = useState(false);
  const [receptor, setReceptor] = useState("");
  const [rut, setRut] = useState("");
  const [firmaData, setFirmaData] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  const yaFirmado = Boolean(despacho.firma_url) && !reFirmar;

  async function guardar() {
    setError("");
    if (!receptor.trim()) { setError("Indica el nombre de quien recibe."); return; }
    if (!firmaData) { setError("Dibuja la firma antes de guardar."); return; }
    setGuardando(true);
    try {
      await api.post(`/despachos/${docId}/firma`, {
        firma: firmaData,
        receptor_nombre: receptor.trim(),
        receptor_rut: rut.trim(),
      });
      setToast({ type: "success", message: "Firma de recepción registrada." });
      setReFirmar(false);
      setReceptor(""); setRut(""); setFirmaData(null);
      onActualizar();
    } catch (e) {
      setError(e?.message || "No se pudo guardar la firma.");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <section className="dsp-card dsp-panel">
      <div className="dsp-panel-head">
        <div className="dsp-panel-ico dsp-ico-violet"><PenLine size={15} /></div>
        <div>
          <div className="dsp-panel-title">Firma de recepción</div>
          <div className="dsp-panel-sub">Conformidad de quien recibe el despacho.</div>
        </div>
      </div>
      <div className="dsp-panel-body">
        {yaFirmado ? (
          <div className="dsp-firma-hecha">
            <div className="dsp-firma-img-wrap">
              <img src={despacho.firma_url} alt="Firma de recepción" className="dsp-firma-img" />
            </div>
            <div className="dsp-firma-datos">
              <div className="dsp-firma-receptor">
                <User size={13} /> {despacho.receptor_nombre || "Receptor"}
                {despacho.receptor_rut && <span className="dsp-firma-rut"> · {despacho.receptor_rut}</span>}
              </div>
              <div className="dsp-firma-fecha">
                <Clock size={12} /> Firmado el {fmtFechaHora(despacho.firma_at)}
              </div>
            </div>
            <button className="dsp-btn dsp-btn-ghost dsp-btn-sm" onClick={() => setReFirmar(true)}>
              <PenLine size={13} /> Volver a firmar
            </button>
          </div>
        ) : (
          <>
            <div className="dsp-field-row">
              <div className="dsp-field">
                <label>Nombre de quien recibe *</label>
                <input
                  value={receptor}
                  onChange={(e) => setReceptor(e.target.value)}
                  placeholder="Nombre y apellido"
                />
              </div>
              <div className="dsp-field">
                <label>RUT (opcional)</label>
                <input
                  value={rut}
                  onChange={(e) => setRut(e.target.value)}
                  placeholder="12.345.678-9"
                />
              </div>
            </div>
            <FirmaPad onCambio={setFirmaData} />
            {error && <div className="dsp-error"><AlertCircle size={14} /> {error}</div>}
            <div className="dsp-firma-acciones">
              {reFirmar && (
                <button className="dsp-btn dsp-btn-ghost" onClick={() => setReFirmar(false)} disabled={guardando}>
                  Cancelar
                </button>
              )}
              <button
                className="dsp-btn dsp-btn-primary"
                onClick={guardar}
                disabled={guardando}
                style={{ flex: 1 }}
              >
                {guardando
                  ? (<><Loader2 size={15} className="dsp-spin" /> Guardando…</>)
                  : (<><CheckCircle2 size={15} /> Guardar firma</>)}
              </button>
            </div>
          </>
        )}
      </div>
    </section>
  );
}

/* ── Pad de firma (canvas) ────────────────────────────────────────── */

function FirmaPad({ onCambio }) {
  const canvasRef = useRef(null);
  const dibujandoRef = useRef(false);
  const ultimoRef = useRef(null);
  const [vacio, setVacio] = useState(true);

  const preparar = useCallback(() => {
    const c = canvasRef.current;
    if (!c) return;
    const g = c.getContext("2d");
    g.fillStyle = "#ffffff";
    g.fillRect(0, 0, c.width, c.height);
    g.lineWidth = 2.6;
    g.lineCap = "round";
    g.lineJoin = "round";
    g.strokeStyle = "#0f172a";
  }, []);

  useEffect(() => { preparar(); }, [preparar]);

  function limpiar() {
    preparar();
    setVacio(true);
    onCambio?.(null);
  }

  function posicion(e) {
    const c = canvasRef.current;
    const rect = c.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (c.width / rect.width),
      y: (e.clientY - rect.top) * (c.height / rect.height),
    };
  }

  function iniciar(e) {
    e.preventDefault();
    dibujandoRef.current = true;
    ultimoRef.current = posicion(e);
  }

  function mover(e) {
    if (!dibujandoRef.current) return;
    e.preventDefault();
    const c = canvasRef.current;
    const g = c.getContext("2d");
    const p = posicion(e);
    g.beginPath();
    g.moveTo(ultimoRef.current.x, ultimoRef.current.y);
    g.lineTo(p.x, p.y);
    g.stroke();
    ultimoRef.current = p;
    if (vacio) setVacio(false);
  }

  function terminar() {
    if (!dibujandoRef.current) return;
    dibujandoRef.current = false;
    const c = canvasRef.current;
    onCambio?.(vacio ? null : c.toDataURL("image/png"));
  }

  return (
    <div className="dsp-firmapad">
      <div className="dsp-firmapad-canvas-wrap">
        <canvas
          ref={canvasRef}
          width={620}
          height={210}
          className="dsp-firmapad-canvas"
          onPointerDown={iniciar}
          onPointerMove={mover}
          onPointerUp={terminar}
          onPointerLeave={terminar}
          onPointerCancel={terminar}
        />
        {vacio && (
          <div className="dsp-firmapad-hint">
            <PenLine size={16} /> Firme aquí
          </div>
        )}
      </div>
      <div className="dsp-firmapad-foot">
        <span className="dsp-firmapad-label">Dibuje la firma con el mouse o el dedo</span>
        <button type="button" className="dsp-btn dsp-btn-ghost dsp-btn-sm" onClick={limpiar} disabled={vacio}>
          <Eraser size={13} /> Limpiar
        </button>
      </div>
    </div>
  );
}

/* ── Panel: línea de tiempo ───────────────────────────────────────── */

function PanelEventos({ eventos }) {
  return (
    <section className="dsp-card dsp-panel">
      <div className="dsp-panel-head">
        <div className="dsp-panel-ico dsp-ico-slate"><Clock size={15} /></div>
        <div>
          <div className="dsp-panel-title">Historial</div>
          <div className="dsp-panel-sub">Bitácora de movimientos del despacho.</div>
        </div>
      </div>
      <div className="dsp-panel-body">
        {eventos.length === 0 ? (
          <div className="dsp-timeline-vacio">
            Sin movimientos todavía. Al cambiar el estado o firmar, los eventos aparecerán aquí.
          </div>
        ) : (
          <div className="dsp-timeline">
            {eventos.slice().reverse().map((ev) => {
              const st = ev.estado ? estiloEstado(ev.estado) : null;
              return (
                <div key={ev.id} className="dsp-tl-item">
                  <div
                    className="dsp-tl-dot"
                    style={{ background: st ? st.solid : "#94a3b8" }}
                  />
                  <div className="dsp-tl-body">
                    <div className="dsp-tl-top">
                      {ev.estado && (
                        <span
                          className="dsp-badge dsp-badge-xs"
                          style={{ background: st.bg, color: st.color, borderColor: st.border }}
                        >
                          {ev.estado}
                        </span>
                      )}
                      <span className="dsp-tl-fecha">{fmtFechaHora(ev.created_at)}</span>
                    </div>
                    {ev.nota && <div className="dsp-tl-nota">{ev.nota}</div>}
                    {ev.autor && <div className="dsp-tl-autor">{ev.autor}</div>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   ESTILOS
   ═══════════════════════════════════════════════════════════════════ */

function DespachosStyles() {
  return (
    <style>{`
:root {
  --dsp-teal:    #28aeb1;
  --dsp-teal-d:  #1d8f92;
  --dsp-teal-dd: #0f5f61;
  --dsp-ink:     #0f172a;
  --dsp-soft:    #475569;
  --dsp-muted:   #94a3b8;
  --dsp-line:    #e2e8f0;
  --dsp-bg:      #eef2f5;
  --dsp-shadow:  0 10px 30px rgba(15,23,42,.07);
  --dsp-shadow-l:0 22px 60px rgba(15,23,42,.16);
}

.dsp-root {
  position: relative;
  min-height: 100vh;
  font-family: "Jost", system-ui, -apple-system, sans-serif;
  color: var(--dsp-ink);
  background: var(--dsp-bg);
}
.dsp-root * { box-sizing: border-box; }

.dsp-bg {
  position: fixed; inset: 0; z-index: 0;
  background:
    radial-gradient(900px 520px at 12% -8%, rgba(40,174,177,.16) 0%, transparent 70%),
    radial-gradient(720px 480px at 100% 0%, rgba(40,174,177,.10) 0%, transparent 70%),
    linear-gradient(180deg, #f1f5f7 0%, #eef2f5 60%, #ffffff 100%);
}
.dsp-bg-pattern {
  position: fixed; inset: 0; z-index: 0; pointer-events: none;
  background-image: radial-gradient(rgba(15,23,42,.05) 1px, transparent 1px);
  background-size: 26px 26px;
  mask-image: radial-gradient(ellipse at 50% 0%, black 8%, transparent 72%);
  opacity: .6;
}

.dsp-boot {
  position: relative; z-index: 1;
  min-height: 100vh; display: flex; align-items: center; justify-content: center;
  color: var(--dsp-teal-d);
}
.dsp-spin { animation: dspSpin .8s linear infinite; }
@keyframes dspSpin { to { transform: rotate(360deg); } }

@keyframes dspFadeUp {
  from { opacity: 0; transform: translateY(14px); }
  to   { opacity: 1; transform: translateY(0); }
}
.dsp-fade-up { animation: dspFadeUp .5s cubic-bezier(.2,.7,.2,1) both; }

/* ── Botones ───────────────────────────────────────────── */
.dsp-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 7px;
  padding: 10px 16px; border-radius: 10px;
  font-family: inherit; font-size: 13px; font-weight: 600;
  cursor: pointer; border: 1px solid transparent;
  transition: transform .12s, box-shadow .15s, background .15s, color .15s, border-color .15s;
  white-space: nowrap;
}
.dsp-btn:disabled { cursor: not-allowed; opacity: .6; }
.dsp-btn-sm { padding: 8px 12px; font-size: 12.5px; }
.dsp-btn-block { width: 100%; }
.dsp-btn-primary {
  background: linear-gradient(135deg, var(--dsp-teal) 0%, var(--dsp-teal-d) 100%);
  color: #fff; box-shadow: 0 8px 20px rgba(40,174,177,.30);
}
.dsp-btn-primary:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 12px 26px rgba(40,174,177,.38); }
.dsp-btn-ghost {
  background: #fff; color: var(--dsp-teal-d); border-color: var(--dsp-line);
}
.dsp-btn-ghost:hover:not(:disabled) { background: rgba(40,174,177,.08); border-color: rgba(40,174,177,.35); }

/* ── Login ─────────────────────────────────────────────── */
.dsp-login-wrap {
  position: relative; z-index: 1;
  min-height: 100vh; display: flex; align-items: center; justify-content: center;
  padding: 24px;
}
.dsp-login-card {
  position: relative; width: 100%; max-width: 410px;
  background: #fff; border: 1px solid var(--dsp-line);
  border-radius: 20px; box-shadow: var(--dsp-shadow-l);
  padding: 34px 30px 26px; overflow: hidden;
  text-align: center;
}
.dsp-login-bar {
  position: absolute; top: 0; left: 0; right: 0; height: 5px;
  background: linear-gradient(90deg, var(--dsp-teal) 0%, var(--dsp-teal-d) 100%);
}
.dsp-login-logo { margin-bottom: 18px; }
.dsp-login-logo img { height: 42px; width: auto; }
.dsp-login-icon {
  width: 52px; height: 52px; margin: 0 auto 14px;
  display: flex; align-items: center; justify-content: center;
  background: linear-gradient(135deg, var(--dsp-teal) 0%, var(--dsp-teal-d) 100%);
  color: #fff; border-radius: 14px;
  box-shadow: 0 10px 22px rgba(40,174,177,.35);
}
.dsp-login-title { margin: 0; font-size: 22px; font-weight: 700; }
.dsp-login-sub { margin: 6px 0 22px; font-size: 13px; color: var(--dsp-soft); line-height: 1.5; }
.dsp-login-foot {
  margin-top: 18px; display: inline-flex; align-items: center; gap: 6px;
  font-size: 11.5px; color: var(--dsp-muted);
}

/* ── Campos ────────────────────────────────────────────── */
.dsp-field { display: flex; flex-direction: column; gap: 5px; text-align: left; margin-bottom: 14px; }
.dsp-field:last-child { margin-bottom: 0; }
.dsp-field label {
  font-size: 11px; font-weight: 700; color: var(--dsp-soft);
  text-transform: uppercase; letter-spacing: .06em;
}
.dsp-field input, .dsp-field textarea {
  width: 100%; padding: 11px 13px; font-size: 14px; font-family: inherit;
  border: 1px solid var(--dsp-line); border-radius: 10px;
  background: #fff; color: var(--dsp-ink);
  transition: border-color .15s, box-shadow .15s;
}
.dsp-field textarea { resize: vertical; }
.dsp-field input:focus, .dsp-field textarea:focus {
  outline: none; border-color: var(--dsp-teal);
  box-shadow: 0 0 0 3px rgba(40,174,177,.16);
}
.dsp-field input:disabled, .dsp-field textarea:disabled { background: #f8fafc; }
.dsp-field-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
@media (max-width: 560px) { .dsp-field-row { grid-template-columns: 1fr; } }

.dsp-pwd { position: relative; }
.dsp-pwd input { padding-right: 42px; }
.dsp-pwd button {
  position: absolute; right: 8px; top: 50%; transform: translateY(-50%);
  background: none; border: none; cursor: pointer; color: var(--dsp-muted);
  padding: 6px; display: flex;
}

.dsp-error {
  display: flex; align-items: center; gap: 7px;
  padding: 10px 12px; margin-top: 4px;
  background: #fef2f2; border: 1px solid #fecaca; color: #b91c1c;
  border-radius: 9px; font-size: 12.5px;
}

/* ── Shell ─────────────────────────────────────────────── */
.dsp-shell { position: relative; z-index: 1; min-height: 100vh; display: flex; flex-direction: column; }

.dsp-header {
  position: sticky; top: 0; z-index: 20;
  background: linear-gradient(115deg, #0c1828 0%, #15273a 55%, #0f4f50 100%);
  border-bottom: 1px solid rgba(255,255,255,.06);
  box-shadow: 0 6px 24px rgba(15,23,42,.18);
}
.dsp-header-inner {
  max-width: 1180px; margin: 0 auto;
  padding: 13px 22px; display: flex; align-items: center; justify-content: space-between; gap: 16px;
}
.dsp-brand { display: flex; align-items: center; gap: 13px; cursor: pointer; }
.dsp-brand-chip {
  background: #fff; border-radius: 11px;
  padding: 7px 13px; display: flex; align-items: center;
  box-shadow: 0 6px 16px rgba(0,0,0,.22);
}
.dsp-brand-chip img { height: 26px; width: auto; display: block; }
.dsp-brand-text { display: flex; flex-direction: column; }
.dsp-brand-eyebrow {
  display: inline-flex; align-items: center; gap: 5px;
  font-size: 9.5px; font-weight: 700; letter-spacing: .15em; text-transform: uppercase;
  color: #5fd4d7;
}
.dsp-brand-title { font-size: 14px; font-weight: 700; color: #fff; line-height: 1.3; margin-top: 1px; }
@media (max-width: 560px) { .dsp-brand-title { display: none; } }
.dsp-header-right { display: flex; align-items: center; gap: 12px; }
.dsp-user { display: flex; align-items: center; gap: 8px; }
.dsp-user-avatar {
  width: 31px; height: 31px; border-radius: 9px;
  background: linear-gradient(135deg, var(--dsp-teal) 0%, var(--dsp-teal-d) 100%);
  color: #fff; font-size: 13px; font-weight: 700;
  display: flex; align-items: center; justify-content: center;
}
.dsp-user-email { font-size: 12.5px; color: rgba(255,255,255,.78); font-weight: 500; }
@media (max-width: 720px) { .dsp-user-email { display: none; } }

.dsp-main { flex: 1; max-width: 1180px; width: 100%; margin: 0 auto; padding: 28px 22px 40px; }
.dsp-footer {
  text-align: center; padding: 18px; font-size: 11.5px; color: var(--dsp-muted);
}

/* ── Encabezado de página ──────────────────────────────── */
.dsp-page-head {
  display: flex; align-items: flex-start; justify-content: space-between; gap: 16px;
  margin-bottom: 20px; flex-wrap: wrap;
}
.dsp-page-title { margin: 0; font-size: 25px; font-weight: 700; letter-spacing: -.015em; }
.dsp-page-sub { margin: 6px 0 0; font-size: 13.5px; color: var(--dsp-soft); max-width: 620px; line-height: 1.55; }
.dsp-page-sub strong { color: var(--dsp-teal-dd); font-weight: 700; }

/* ── KPIs ──────────────────────────────────────────────── */
.dsp-kpis {
  display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 20px;
}
@media (max-width: 720px) { .dsp-kpis { grid-template-columns: repeat(2, 1fr); } }
.dsp-kpi {
  display: flex; align-items: center; gap: 13px;
  background: #fff; border: 1px solid var(--dsp-line);
  border-radius: 14px; padding: 15px 16px;
  box-shadow: var(--dsp-shadow); position: relative; overflow: hidden;
}
.dsp-kpi::before {
  content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 4px;
  background: var(--kpi-acc);
}
.dsp-kpi-ink   { --kpi-acc: #0f172a; }
.dsp-kpi-amber { --kpi-acc: #d97706; }
.dsp-kpi-blue  { --kpi-acc: #2563eb; }
.dsp-kpi-green { --kpi-acc: #16a34a; }
.dsp-kpi-ico {
  width: 42px; height: 42px; flex: none; border-radius: 11px;
  display: flex; align-items: center; justify-content: center; color: #fff;
  background: var(--kpi-acc);
}
.dsp-kpi-valor { font-size: 24px; font-weight: 800; line-height: 1; letter-spacing: -.02em; }
.dsp-kpi-label {
  font-size: 11.5px; color: var(--dsp-soft); font-weight: 600; margin-top: 4px;
  text-transform: uppercase; letter-spacing: .04em;
}

/* ── Toolbar ───────────────────────────────────────────── */
.dsp-toolbar {
  display: flex; align-items: center; gap: 10px; margin-bottom: 18px; flex-wrap: wrap;
}
.dsp-search {
  display: flex; align-items: center; gap: 8px;
  padding: 9px 12px; background: #fff;
  border: 1px solid var(--dsp-line); border-radius: 10px;
  flex: 1; min-width: 240px; color: var(--dsp-muted);
}
.dsp-search:focus-within { border-color: var(--dsp-teal); box-shadow: 0 0 0 3px rgba(40,174,177,.14); }
.dsp-search input {
  border: none; outline: none; background: none; font-family: inherit;
  font-size: 13.5px; color: var(--dsp-ink); flex: 1; min-width: 0;
}
.dsp-search-clear {
  background: none; border: none; cursor: pointer; color: var(--dsp-muted);
  display: flex; padding: 2px;
}
.dsp-filtros { display: flex; gap: 6px; flex-wrap: wrap; }
.dsp-chip {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 8px 12px; border-radius: 999px;
  background: #fff; border: 1px solid var(--dsp-line);
  font-family: inherit; font-size: 12.5px; font-weight: 600; color: var(--dsp-soft);
  cursor: pointer; transition: all .14s;
}
.dsp-chip:hover { border-color: var(--dsp-muted); }
.dsp-chip.is-on { background: var(--dsp-ink); color: #fff; border-color: var(--dsp-ink); }
.dsp-chip-n {
  font-size: 11px; padding: 1px 6px; border-radius: 999px;
  background: rgba(15,23,42,.08); color: inherit;
}
.dsp-chip.is-on .dsp-chip-n { background: rgba(255,255,255,.22); }

/* ── Tarjetas / grid ───────────────────────────────────── */
.dsp-grid {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(292px, 1fr)); gap: 14px;
}
.dsp-card {
  background: #fff; border: 1px solid var(--dsp-line);
  border-radius: 16px; box-shadow: var(--dsp-shadow);
}
.dsp-card-clic {
  text-align: left; cursor: pointer; font-family: inherit;
  padding: 16px 16px 14px 18px; display: flex; flex-direction: column; gap: 10px;
  position: relative; overflow: hidden;
  transition: transform .14s, box-shadow .15s, border-color .15s;
}
.dsp-card-clic::before {
  content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 4px;
  background: var(--acc); opacity: .9;
}
.dsp-card-clic:hover {
  transform: translateY(-3px); border-color: rgba(40,174,177,.4);
  box-shadow: 0 16px 36px rgba(15,23,42,.13);
}
.dsp-card-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }
.dsp-card-guia { display: flex; flex-direction: column; min-width: 0; }
.dsp-card-guia-label {
  font-size: 9.5px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase;
  color: var(--dsp-muted);
}
.dsp-card-guia-num {
  font-size: 17px; font-weight: 700; color: var(--dsp-ink);
  font-family: ui-monospace, "SF Mono", monospace; letter-spacing: -.01em;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.dsp-card-cliente { font-size: 14px; font-weight: 600; color: var(--dsp-ink); line-height: 1.3; }
.dsp-card-meta {
  display: flex; gap: 12px; flex-wrap: wrap;
  font-size: 12px; color: var(--dsp-soft);
}
.dsp-card-meta span { display: inline-flex; align-items: center; gap: 4px; }
.dsp-card-cot { font-family: ui-monospace, monospace; }
.dsp-card-foot {
  display: flex; align-items: center; gap: 10px;
  border-top: 1px solid var(--dsp-line); padding-top: 10px; margin-top: 2px;
  font-size: 11.5px; color: var(--dsp-muted);
}
.dsp-card-foot span { display: inline-flex; align-items: center; gap: 4px; }
.dsp-card-firma { color: #15803d !important; font-weight: 600; }
.dsp-card-arrow { margin-left: auto; color: var(--dsp-muted); transition: transform .14s, color .14s; }
.dsp-card-clic:hover .dsp-card-arrow { color: var(--dsp-teal-d); transform: translateX(2px); }

.dsp-skel {
  height: 158px; border: 1px solid var(--dsp-line);
  background: linear-gradient(100deg, #f1f5f9 30%, #e2e8f0 50%, #f1f5f9 70%);
  background-size: 200% 100%; animation: dspShimmer 1.3s infinite;
}
@keyframes dspShimmer { to { background-position: -200% 0; } }

/* ── Badges ────────────────────────────────────────────── */
.dsp-badge {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 4px 10px; border-radius: 999px;
  font-size: 11.5px; font-weight: 700; border: 1px solid; white-space: nowrap;
}
.dsp-badge-lg { font-size: 13px; padding: 7px 15px; }
.dsp-badge-xs { font-size: 10px; padding: 2px 7px; }

/* ── Vacío ─────────────────────────────────────────────── */
.dsp-empty {
  display: flex; flex-direction: column; align-items: center; gap: 8px;
  padding: 54px 24px; text-align: center; color: var(--dsp-muted);
  background: #fff; border: 1px solid var(--dsp-line); border-radius: 16px;
  box-shadow: var(--dsp-shadow);
}
.dsp-empty-ico {
  width: 60px; height: 60px; border-radius: 16px; margin-bottom: 4px;
  display: flex; align-items: center; justify-content: center;
  background: linear-gradient(135deg, #f1f5f9, #e2e8f0); color: #64748b;
}
.dsp-empty-title { font-size: 16px; font-weight: 700; color: var(--dsp-ink); }
.dsp-empty-sub { font-size: 13px; color: var(--dsp-soft); max-width: 480px; line-height: 1.55; }
.dsp-empty-sub strong { color: var(--dsp-teal-dd); }

/* ── Detalle ───────────────────────────────────────────── */
.dsp-detalle-loading {
  display: flex; align-items: center; justify-content: center; gap: 10px;
  padding: 60px; color: var(--dsp-soft); font-size: 14px;
}
.dsp-volver {
  display: inline-flex; align-items: center; gap: 6px;
  background: none; border: none; cursor: pointer; font-family: inherit;
  font-size: 13px; font-weight: 600; color: var(--dsp-teal-d);
  padding: 4px 0; margin-bottom: 14px;
}
.dsp-volver:hover { color: var(--dsp-teal-dd); }

.dsp-hero { position: relative; overflow: hidden; margin-bottom: 16px; }
.dsp-hero-pattern {
  position: absolute; inset: 0; pointer-events: none;
  background:
    radial-gradient(360px 220px at 88% -20%, rgba(40,174,177,.28) 0%, transparent 70%),
    linear-gradient(180deg, rgba(40,174,177,.05) 0%, transparent 60%);
}
.dsp-hero-body { position: relative; padding: 22px 24px; }
.dsp-hero-top {
  display: flex; align-items: flex-start; justify-content: space-between;
  gap: 16px; flex-wrap: wrap;
}
.dsp-hero-eyebrow {
  display: inline-flex; align-items: center; gap: 5px;
  font-size: 10px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase;
  color: var(--dsp-teal-d);
}
.dsp-hero-guia {
  font-size: 28px; font-weight: 700; letter-spacing: -.01em; margin-top: 4px;
  font-family: ui-monospace, "SF Mono", monospace;
}
.dsp-hero-cliente { font-size: 15px; font-weight: 600; color: var(--dsp-soft); margin-top: 4px; }
.dsp-hero-stats {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 10px; margin-top: 18px;
}
.dsp-det-item {
  background: #f8fafc; border: 1px solid var(--dsp-line);
  border-radius: 11px; padding: 9px 12px;
}
.dsp-det-item-label {
  display: inline-flex; align-items: center; gap: 5px;
  font-size: 10px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase;
  color: var(--dsp-muted);
}
.dsp-det-item-value { font-size: 13px; font-weight: 600; color: var(--dsp-ink); margin-top: 3px; }

.dsp-detalle-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
@media (max-width: 880px) { .dsp-detalle-grid { grid-template-columns: 1fr; } }
.dsp-detalle-col { display: flex; flex-direction: column; gap: 16px; }

/* ── Paneles ───────────────────────────────────────────── */
.dsp-panel { overflow: hidden; }
.dsp-panel-head {
  display: flex; align-items: center; gap: 11px;
  padding: 15px 18px; border-bottom: 1px solid var(--dsp-line);
}
.dsp-panel-ico {
  width: 34px; height: 34px; flex: none; border-radius: 10px;
  display: flex; align-items: center; justify-content: center; color: #fff;
}
.dsp-ico-teal   { background: linear-gradient(135deg, #28aeb1, #1d8f92); }
.dsp-ico-blue   { background: linear-gradient(135deg, #3b82f6, #1d4ed8); }
.dsp-ico-violet { background: linear-gradient(135deg, #8b5cf6, #6d28d9); }
.dsp-ico-slate  { background: linear-gradient(135deg, #64748b, #334155); }
.dsp-panel-title { font-size: 14px; font-weight: 700; }
.dsp-panel-sub { font-size: 12px; color: var(--dsp-soft); margin-top: 1px; }
.dsp-panel-count {
  margin-left: auto; font-size: 12px; font-weight: 700;
  background: #f1f5f9; color: var(--dsp-soft);
  padding: 3px 10px; border-radius: 999px;
}
.dsp-panel-body { padding: 16px 18px; }

/* ── Selector de estado ────────────────────────────────── */
.dsp-estado-opciones {
  display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 14px;
}
@media (max-width: 480px) { .dsp-estado-opciones { grid-template-columns: 1fr; } }
.dsp-estado-opt {
  display: flex; align-items: center; justify-content: center; gap: 6px;
  padding: 11px 10px; border-radius: 10px;
  background: #f8fafc; border: 1px solid var(--dsp-line);
  font-family: inherit; font-size: 12.5px; font-weight: 600; color: var(--dsp-soft);
  cursor: pointer; transition: all .14s;
}
.dsp-estado-opt:hover { border-color: var(--dsp-muted); background: #fff; }
.dsp-estado-opt.is-on { font-weight: 700; }

/* ── Dropzone / archivos ───────────────────────────────── */
.dsp-dropzone {
  width: 100%; display: flex; flex-direction: column; align-items: center; gap: 4px;
  padding: 20px; border-radius: 12px;
  border: 1.6px dashed rgba(40,174,177,.45); background: rgba(40,174,177,.04);
  cursor: pointer; font-family: inherit; transition: all .15s;
}
.dsp-dropzone:hover:not(:disabled) {
  border-color: var(--dsp-teal); background: rgba(40,174,177,.08);
}
.dsp-dropzone:disabled { cursor: wait; color: var(--dsp-teal-d); }
.dsp-dropzone-ico {
  width: 40px; height: 40px; border-radius: 11px; margin-bottom: 4px;
  background: linear-gradient(135deg, var(--dsp-teal) 0%, var(--dsp-teal-d) 100%);
  color: #fff; display: flex; align-items: center; justify-content: center;
}
.dsp-dropzone-title { font-size: 13.5px; font-weight: 700; color: var(--dsp-ink); }
.dsp-dropzone-sub { font-size: 11.5px; color: var(--dsp-muted); }

.dsp-archivos {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(148px, 1fr));
  gap: 10px; margin-top: 14px;
}
.dsp-archivo {
  display: flex; flex-direction: column;
  border: 1px solid var(--dsp-line); border-radius: 11px; overflow: hidden;
  text-decoration: none; background: #fff; position: relative;
  transition: transform .12s, box-shadow .15s, border-color .15s;
}
.dsp-archivo:hover {
  transform: translateY(-2px); border-color: rgba(40,174,177,.4);
  box-shadow: var(--dsp-shadow);
}
.dsp-archivo-thumb {
  height: 96px; background-size: cover; background-position: center;
  background-color: #f1f5f9;
}
.dsp-archivo-thumb-doc {
  display: flex; align-items: center; justify-content: center; color: #64748b;
  background: linear-gradient(135deg, #f1f5f9, #e2e8f0);
}
.dsp-archivo-info { padding: 8px 10px; }
.dsp-archivo-nombre {
  font-size: 12px; font-weight: 600; color: var(--dsp-ink);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.dsp-archivo-fecha { font-size: 10.5px; color: var(--dsp-muted); margin-top: 1px; }
.dsp-archivo-ver {
  position: absolute; top: 7px; right: 7px; color: #fff;
  background: rgba(15,23,42,.55); border-radius: 6px; padding: 3px; box-sizing: content-box;
}

/* ── Firma ─────────────────────────────────────────────── */
.dsp-firmapad { margin: 6px 0 12px; }
.dsp-firmapad-canvas-wrap {
  position: relative; border: 1.6px dashed #cbd5e1; border-radius: 12px;
  overflow: hidden; background: #fff;
}
.dsp-firmapad-canvas {
  display: block; width: 100%; height: auto;
  touch-action: none; cursor: crosshair;
}
.dsp-firmapad-hint {
  position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
  gap: 7px; color: #cbd5e1; font-size: 14px; font-weight: 600;
  pointer-events: none;
}
.dsp-firmapad-foot {
  display: flex; align-items: center; justify-content: space-between; gap: 10px;
  margin-top: 8px;
}
.dsp-firmapad-label { font-size: 11.5px; color: var(--dsp-muted); }
.dsp-firma-acciones { display: flex; gap: 10px; }

.dsp-firma-hecha { display: flex; flex-direction: column; gap: 12px; }
.dsp-firma-img-wrap {
  border: 1px solid var(--dsp-line); border-radius: 12px;
  background:
    repeating-linear-gradient(0deg, #fff, #fff 22px, #f8fafc 22px, #f8fafc 23px);
  padding: 8px;
}
.dsp-firma-img { display: block; width: 100%; height: auto; max-height: 180px; object-fit: contain; }
.dsp-firma-datos {
  display: flex; flex-direction: column; gap: 4px;
  padding: 10px 12px; background: #f8fafc; border-radius: 10px;
}
.dsp-firma-receptor {
  display: inline-flex; align-items: center; gap: 6px;
  font-size: 13.5px; font-weight: 700; color: var(--dsp-ink);
}
.dsp-firma-rut { font-weight: 500; color: var(--dsp-soft); }
.dsp-firma-fecha {
  display: inline-flex; align-items: center; gap: 5px;
  font-size: 12px; color: var(--dsp-soft);
}

/* ── Timeline ──────────────────────────────────────────── */
.dsp-timeline-vacio { font-size: 12.5px; color: var(--dsp-muted); padding: 8px 2px; line-height: 1.5; }
.dsp-timeline { display: flex; flex-direction: column; }
.dsp-tl-item { display: flex; gap: 12px; padding-bottom: 14px; position: relative; }
.dsp-tl-item:not(:last-child)::before {
  content: ""; position: absolute; left: 5px; top: 14px; bottom: 0;
  width: 2px; background: var(--dsp-line);
}
.dsp-tl-dot {
  width: 12px; height: 12px; border-radius: 50%; flex: none; margin-top: 2px;
  box-shadow: 0 0 0 3px #fff;
}
.dsp-tl-body { flex: 1; min-width: 0; }
.dsp-tl-top { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.dsp-tl-fecha { font-size: 11px; color: var(--dsp-muted); }
.dsp-tl-nota { font-size: 13px; color: var(--dsp-ink); margin-top: 3px; line-height: 1.4; }
.dsp-tl-autor { font-size: 11px; color: var(--dsp-muted); margin-top: 2px; }
`}</style>
  );
}
