import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  KeyRound,
  Search,
  Plus,
  RefreshCw,
  Power,
  CheckCircle2,
  Clock,
  Mail,
  Phone,
  X,
  ShieldCheck,
  ShieldOff,
  Inbox,
  UserPlus,
  Eye,
  EyeOff,
  Copy,
  AlertTriangle,
} from "lucide-react";
import { api } from "../lib/api";
import Toast from "../components/Toast";

const TEAL = "#28aeb1"; // primary de la plataforma (var --primary)
const TEAL_DARK = "#1e9295"; // var --primary-dark (acentos/textos sobre fondo claro)

// Genera una contraseña temporal legible (evita caracteres ambiguos).
function generarClave() {
  const abc = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const min = "abcdefghijkmnpqrstuvwxyz";
  const num = "23456789";
  const pick = (set, n) =>
    Array.from({ length: n }, () =>
      set[Math.floor(Math.random() * set.length)],
    ).join("");
  // Cumple la política del portal: 8+ caracteres con mayúscula, minúscula y
  // número (ej: "ABCdef-234").
  return `${pick(abc, 3)}${pick(min, 3)}-${pick(num, 3)}`;
}

// Política de contraseña del portal del cliente (debe coincidir con el backend
// y con PortalStockCliente): 8+ caracteres con mayúscula, minúscula y número.
function claveCumplePolitica(s) {
  const pw = String(s || "");
  return (
    pw.length >= 8 && /[A-Z]/.test(pw) && /[a-z]/.test(pw) && /[0-9]/.test(pw)
  );
}
const MSG_CLAVE_POLITICA =
  "La contraseña debe tener al menos 8 caracteres, con mayúscula, minúscula y número.";

function fmtFecha(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("es-CL", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return "—";
  }
}

function fmtFechaHora(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("es-CL", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}

const VIGENCIA_LABEL = { "1m": "1 mes", "3m": "3 meses", indefinido: "Indefinido" };

export default function AccesoPortalClientes() {
  const [tab, setTab] = useState("accesos"); // 'accesos' | 'recuperaciones'
  const [accesos, setAccesos] = useState([]);
  const [recuperaciones, setRecuperaciones] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [busqueda, setBusqueda] = useState("");
  const [toast, setToast] = useState(null);

  const [modalHabilitar, setModalHabilitar] = useState(null); // {cliente?} o {} para nuevo
  const [modalRegenerar, setModalRegenerar] = useState(null); // {rut, razon_social, recuperacion_id?}

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const [acc, rec] = await Promise.all([
        api.get("/stock-clientes/accesos"),
        api.get("/stock-clientes/recuperaciones"),
      ]);
      setAccesos(Array.isArray(acc) ? acc : []);
      setRecuperaciones(Array.isArray(rec) ? rec : []);
    } catch (e) {
      setToast({ type: "error", message: e?.message || "No pudimos cargar los datos." });
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const pendientes = useMemo(
    () => recuperaciones.filter((r) => r.estado === "pendiente").length,
    [recuperaciones],
  );

  const accesosFiltrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    if (!q) return accesos;
    return accesos.filter(
      (a) =>
        String(a.razon_social || "").toLowerCase().includes(q) ||
        String(a.rut_formateado || "").toLowerCase().includes(q) ||
        String(a.email || "").toLowerCase().includes(q),
    );
  }, [accesos, busqueda]);

  async function deshabilitar(rut, razon) {
    if (!window.confirm(`¿Deshabilitar el acceso al portal de ${razon || rut}?`)) return;
    try {
      await api.post("/stock-clientes/accesos/deshabilitar", { rut });
      setToast({ type: "success", message: "Acceso deshabilitado." });
      cargar();
    } catch (e) {
      setToast({ type: "error", message: e?.message || "No se pudo deshabilitar." });
    }
  }

  async function resolverRecuperacion(id) {
    try {
      await api.put(`/stock-clientes/recuperaciones/${id}/resolver`);
      setToast({ type: "success", message: "Solicitud marcada como resuelta." });
      cargar();
    } catch (e) {
      setToast({ type: "error", message: e?.message || "No se pudo actualizar." });
    }
  }

  return (
    <div style={s.page}>
      <header style={s.header}>
        <div style={s.headIcon}>
          <KeyRound size={22} />
        </div>
        <div>
          <h1 style={s.title}>Acceso al Portal del Cliente</h1>
          <p style={s.sub}>
            Habilite el acceso al portal de stock, defina la vigencia y atienda
            las solicitudes de recuperación de clave.
          </p>
        </div>
        <button style={s.btnPrimario} onClick={() => setModalHabilitar({})}>
          <UserPlus size={16} /> Habilitar acceso
        </button>
      </header>

      <div style={s.tabs}>
        <button
          style={{ ...s.tab, ...(tab === "accesos" ? s.tabActiva : {}) }}
          onClick={() => setTab("accesos")}
        >
          <ShieldCheck size={15} /> Accesos de clientes
        </button>
        <button
          style={{ ...s.tab, ...(tab === "recuperaciones" ? s.tabActiva : {}) }}
          onClick={() => setTab("recuperaciones")}
        >
          <Inbox size={15} /> Recuperaciones de clave
          {pendientes > 0 && <span style={s.badge}>{pendientes}</span>}
        </button>
      </div>

      {tab === "accesos" && (
        <section style={s.card}>
          <div style={s.infoNota}>
            <ShieldCheck size={14} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>
              Aquí ves los clientes con registro en el portal. Los que entraron
              antes aparecen como <strong>Deshabilitado</strong> hasta que les
              habilites el acceso. Para sumar un cliente nuevo usa{" "}
              <strong>“Habilitar acceso”</strong>.
            </span>
          </div>
          <div style={s.cardHead}>
            <div style={s.searchWrap}>
              <Search size={15} style={{ color: "#94a3b8" }} />
              <input
                style={s.searchInput}
                placeholder="Buscar por razón social, RUT o correo…"
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
              />
            </div>
            <button style={s.btnGhost} onClick={cargar}>
              <RefreshCw size={14} /> Actualizar
            </button>
          </div>

          {cargando ? (
            <div style={s.vacio}>Cargando…</div>
          ) : accesosFiltrados.length === 0 ? (
            <div style={s.vacio}>
              {accesos.length === 0
                ? "Aún no hay clientes con acceso. Use “Habilitar acceso”."
                : "Sin resultados para su búsqueda."}
            </div>
          ) : (
            <div style={s.tablaWrap}>
              <table style={s.tabla}>
                <thead>
                  <tr>
                    <th style={s.th}>Cliente</th>
                    <th style={s.th}>Estado</th>
                    <th style={s.th}>Vigencia</th>
                    <th style={s.th}>Expira</th>
                    <th style={s.th}>Último acceso</th>
                    <th style={{ ...s.th, textAlign: "right" }}>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {accesosFiltrados.map((a) => (
                    <FilaAcceso
                      key={a.rut}
                      a={a}
                      onRegenerar={() =>
                        setModalRegenerar({
                          rut: a.rut,
                          razon_social: a.razon_social,
                        })
                      }
                      onReHabilitar={() =>
                        setModalHabilitar({
                          cliente: {
                            rut: a.rut,
                            rut_formateado: a.rut_formateado,
                            nombre: a.razon_social,
                            email: a.email,
                          },
                        })
                      }
                      onDeshabilitar={() => deshabilitar(a.rut, a.razon_social)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {tab === "recuperaciones" && (
        <section style={s.card}>
          <div style={s.cardHead}>
            <strong style={{ fontSize: 14, color: "#0f172a" }}>
              Solicitudes de recuperación
            </strong>
            <button style={s.btnGhost} onClick={cargar}>
              <RefreshCw size={14} /> Actualizar
            </button>
          </div>

          {cargando ? (
            <div style={s.vacio}>Cargando…</div>
          ) : recuperaciones.length === 0 ? (
            <div style={s.vacio}>No hay solicitudes de recuperación.</div>
          ) : (
            <div style={s.listaRec}>
              {recuperaciones.map((r) => (
                <FilaRecuperacion
                  key={r.id}
                  r={r}
                  onRegenerar={() =>
                    setModalRegenerar({
                      rut: r.rut,
                      razon_social: r.razon_social,
                      recuperacion_id: r.id,
                    })
                  }
                  onResolver={() => resolverRecuperacion(r.id)}
                />
              ))}
            </div>
          )}
        </section>
      )}

      {modalHabilitar && (
        <ModalHabilitar
          clienteInicial={modalHabilitar.cliente || null}
          onCerrar={() => setModalHabilitar(null)}
          onHecho={(msg) => {
            setModalHabilitar(null);
            setToast({ type: "success", message: msg });
            cargar();
          }}
          onError={(msg) => setToast({ type: "error", message: msg })}
        />
      )}

      {modalRegenerar && (
        <ModalRegenerar
          datos={modalRegenerar}
          onCerrar={() => setModalRegenerar(null)}
          onHecho={(msg) => {
            setModalRegenerar(null);
            setToast({ type: "success", message: msg });
            cargar();
          }}
          onError={(msg) => setToast({ type: "error", message: msg })}
        />
      )}

      {toast && (
        <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />
      )}
    </div>
  );
}

function FilaAcceso({ a, onRegenerar, onReHabilitar, onDeshabilitar }) {
  let estado;
  if (!a.acceso_habilitado) {
    estado = { txt: "Deshabilitado", bg: "#f1f5f9", color: "#64748b", Icon: ShieldOff };
  } else if (!a.vigente) {
    estado = { txt: "Expirado", bg: "#fef3c7", color: "#b45309", Icon: AlertTriangle };
  } else {
    estado = { txt: "Habilitado", bg: "#dcfce7", color: "#15803d", Icon: ShieldCheck };
  }
  const EstadoIcon = estado.Icon;
  return (
    <tr style={s.tr}>
      <td style={s.td}>
        <div style={{ fontWeight: 700, color: "#0f172a" }}>
          {a.razon_social || "—"}
        </div>
        <div style={{ fontSize: 12, color: "#64748b" }}>
          {a.rut_formateado}
          {a.email ? ` · ${a.email}` : ""}
        </div>
      </td>
      <td style={s.td}>
        <span style={{ ...s.estadoChip, background: estado.bg, color: estado.color }}>
          <EstadoIcon size={12} /> {estado.txt}
        </span>
        {a.acceso_habilitado && a.password_temporal && (
          <span style={s.tempChip} title="El cliente aún no cambia la clave temporal">
            <Clock size={11} /> Clave temporal
          </span>
        )}
      </td>
      <td style={s.td}>{VIGENCIA_LABEL[a.acceso_vigencia] || "—"}</td>
      <td style={s.td}>{a.acceso_expira ? fmtFecha(a.acceso_expira) : "Sin término"}</td>
      <td style={s.td}>{a.ultimo_acceso ? fmtFechaHora(a.ultimo_acceso) : "Nunca"}</td>
      <td style={{ ...s.td, textAlign: "right", whiteSpace: "nowrap" }}>
        <button style={s.accBtn} onClick={onRegenerar} title="Regenerar clave">
          <KeyRound size={14} /> Clave
        </button>
        {a.acceso_habilitado ? (
          <button
            style={{ ...s.accBtn, color: "#b91c1c" }}
            onClick={onDeshabilitar}
            title="Deshabilitar acceso"
          >
            <Power size={14} /> Deshabilitar
          </button>
        ) : (
          <button style={s.accBtn} onClick={onReHabilitar} title="Volver a habilitar">
            <Power size={14} /> Habilitar
          </button>
        )}
      </td>
    </tr>
  );
}

function FilaRecuperacion({ r, onRegenerar, onResolver }) {
  const resuelta = r.estado === "resuelta";
  return (
    <div style={{ ...s.recCard, opacity: resuelta ? 0.7 : 1 }}>
      <div style={s.recTop}>
        <span
          style={{
            ...s.estadoChip,
            background: resuelta ? "#dcfce7" : "#fef3c7",
            color: resuelta ? "#15803d" : "#b45309",
          }}
        >
          {resuelta ? <CheckCircle2 size={12} /> : <Clock size={12} />}
          {resuelta ? "Resuelta" : "Pendiente"}
        </span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontWeight: 700, color: "#0f172a" }}>
            {r.razon_social || "Cliente"}{" "}
            <span style={{ color: "#94a3b8", fontWeight: 500 }}>· {r.rut_formateado}</span>
          </div>
          <div style={{ fontSize: 12, color: "#64748b" }}>{fmtFechaHora(r.created_at)}</div>
        </div>
        {!resuelta && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button style={s.btnPrimarioSm} onClick={onRegenerar}>
              <KeyRound size={14} /> Regenerar clave
            </button>
            <button style={s.btnGhost} onClick={onResolver}>
              <CheckCircle2 size={14} /> Marcar resuelta
            </button>
          </div>
        )}
      </div>
      <div style={s.recContacto}>
        {r.contacto_nombre && <span>👤 {r.contacto_nombre}</span>}
        {r.contacto_email && (
          <span>
            <Mail size={12} style={{ verticalAlign: -2 }} /> {r.contacto_email}
          </span>
        )}
        {r.contacto_telefono && (
          <span>
            <Phone size={12} style={{ verticalAlign: -2 }} /> {r.contacto_telefono}
          </span>
        )}
      </div>
      {r.mensaje && <div style={s.recMensaje}>{r.mensaje}</div>}
      {resuelta && r.resuelta_por && (
        <div style={{ fontSize: 12, color: "#15803d", marginTop: 6 }}>
          Resuelta por {r.resuelta_por} · {fmtFechaHora(r.resuelta_at)}
        </div>
      )}
    </div>
  );
}

/* ── Modal: Habilitar / re-habilitar acceso ─────────────────────────── */
function ModalHabilitar({ clienteInicial, onCerrar, onHecho, onError }) {
  const [cliente, setCliente] = useState(clienteInicial);
  const [query, setQuery] = useState("");
  const [resultados, setResultados] = useState([]);
  const [buscando, setBuscando] = useState(false);
  const [clave, setClave] = useState(() => generarClave());
  const [verClave, setVerClave] = useState(true);
  const [vigencia, setVigencia] = useState("3m");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState("");
  const debounce = useRef(null);

  useEffect(() => {
    if (cliente) return;
    if (query.trim().length < 2) {
      setResultados([]);
      return;
    }
    clearTimeout(debounce.current);
    debounce.current = setTimeout(async () => {
      setBuscando(true);
      try {
        const res = await api.get(
          `/stock-clientes/accesos/buscar-cliente?q=${encodeURIComponent(query.trim())}`,
        );
        setResultados(Array.isArray(res) ? res : []);
      } catch {
        setResultados([]);
      } finally {
        setBuscando(false);
      }
    }, 280);
    return () => clearTimeout(debounce.current);
  }, [query, cliente]);

  async function habilitar() {
    setError("");
    if (!cliente?.rut) {
      setError("Seleccione un cliente.");
      return;
    }
    if (!claveCumplePolitica(clave.trim())) {
      setError(MSG_CLAVE_POLITICA);
      return;
    }
    setEnviando(true);
    try {
      const res = await api.post("/stock-clientes/accesos/habilitar", {
        rut: cliente.rut,
        password: clave.trim(),
        vigencia,
      });
      const sufijo = res?.correo_enviado
        ? ` Correo de bienvenida enviado a ${res.correo_destino}.`
        : " (No se pudo enviar el correo: el cliente no tiene correo válido).";
      onHecho(`Acceso habilitado para ${cliente.nombre || cliente.rut_formateado}.${sufijo}`);
    } catch (e) {
      setError(e?.message || "No se pudo habilitar el acceso.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Overlay onCerrar={onCerrar}>
      <h2 style={s.modalTitle}>
        <UserPlus size={18} /> Habilitar acceso al portal
      </h2>

      {!cliente ? (
        <div style={s.modalBody}>
          <label style={s.label}>Buscar cliente (razón social o RUT)</label>
          <div style={s.searchWrap}>
            <Search size={15} style={{ color: "#94a3b8" }} />
            <input
              autoFocus
              style={s.searchInput}
              placeholder="Ej: Clínica Dental…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          {buscando && <div style={s.hintMini}>Buscando…</div>}
          {resultados.length > 0 && (
            <div style={s.resultados}>
              {resultados.map((c) => (
                <button key={c.rut} style={s.resItem} onClick={() => setCliente(c)}>
                  <div style={{ fontWeight: 700, color: "#0f172a" }}>{c.nombre}</div>
                  <div style={{ fontSize: 12, color: "#64748b" }}>
                    {c.rut_formateado}
                    {c.email ? ` · ${c.email}` : " · sin correo"}
                  </div>
                </button>
              ))}
            </div>
          )}
          {!buscando && query.trim().length >= 2 && resultados.length === 0 && (
            <div style={s.hintMini}>Sin coincidencias en el maestro de clientes.</div>
          )}
        </div>
      ) : (
        <div style={s.modalBody}>
          <div style={s.clienteSel}>
            <div>
              <div style={{ fontWeight: 700, color: "#0f172a" }}>
                {cliente.nombre || cliente.razon_social}
              </div>
              <div style={{ fontSize: 12, color: "#64748b" }}>
                {cliente.rut_formateado}
                {cliente.email ? ` · ${cliente.email}` : " · sin correo registrado"}
              </div>
            </div>
            {!clienteInicial && (
              <button style={s.linkBtn} onClick={() => setCliente(null)}>
                Cambiar
              </button>
            )}
          </div>

          {!cliente.email && (
            <div style={s.warnBox}>
              <AlertTriangle size={14} /> Este cliente no tiene correo en el maestro:
              no recibirá el correo de bienvenida. Entréguele la clave por otro medio.
            </div>
          )}

          <label style={s.label}>Contraseña temporal</label>
          <div style={{ display: "flex", gap: 8 }}>
            <div style={{ position: "relative", flex: 1 }}>
              <input
                type={verClave ? "text" : "password"}
                style={{ ...s.input, paddingRight: 38 }}
                value={clave}
                onChange={(e) => setClave(e.target.value)}
              />
              <button
                type="button"
                style={s.verBtn}
                onClick={() => setVerClave((v) => !v)}
                tabIndex={-1}
              >
                {verClave ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
            <button style={s.btnGhost} onClick={() => setClave(generarClave())} type="button">
              <RefreshCw size={14} /> Generar
            </button>
            <button
              style={s.btnGhost}
              type="button"
              onClick={() => navigator.clipboard?.writeText(clave)}
              title="Copiar"
            >
              <Copy size={14} />
            </button>
          </div>
          <div style={s.hintMini}>
            El cliente deberá cambiarla en su primer ingreso.
          </div>

          <label style={{ ...s.label, marginTop: 14 }}>Vigencia del acceso</label>
          <div style={s.vigRow}>
            {[
              { v: "1m", t: "1 mes" },
              { v: "3m", t: "3 meses" },
              { v: "indefinido", t: "Indefinido" },
            ].map((o) => (
              <button
                key={o.v}
                type="button"
                style={{ ...s.vigBtn, ...(vigencia === o.v ? s.vigBtnOn : {}) }}
                onClick={() => setVigencia(o.v)}
              >
                {o.t}
              </button>
            ))}
          </div>

          {error && <div style={s.errBox}>{error}</div>}

          <div style={s.modalFooter}>
            <button style={s.btnGhost} onClick={onCerrar} disabled={enviando}>
              Cancelar
            </button>
            <button style={s.btnPrimario} onClick={habilitar} disabled={enviando}>
              {enviando ? "Habilitando…" : "Habilitar y enviar correo"}
            </button>
          </div>
        </div>
      )}
    </Overlay>
  );
}

/* ── Modal: Regenerar clave (recuperación) ──────────────────────────── */
function ModalRegenerar({ datos, onCerrar, onHecho, onError }) {
  const [clave, setClave] = useState(() => generarClave());
  const [verClave, setVerClave] = useState(true);
  const [reenviar, setReenviar] = useState(true);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState("");

  async function regenerar() {
    setError("");
    if (!claveCumplePolitica(clave.trim())) {
      setError(MSG_CLAVE_POLITICA);
      return;
    }
    setEnviando(true);
    try {
      const res = await api.post("/stock-clientes/accesos/regenerar-clave", {
        rut: datos.rut,
        password: clave.trim(),
        reenviar_correo: reenviar,
        recuperacion_id: datos.recuperacion_id,
      });
      const sufijo =
        reenviar && res?.correo_enviado
          ? ` Correo enviado a ${res.correo_destino}.`
          : reenviar
            ? " (No se pudo enviar el correo)."
            : "";
      onHecho(`Clave regenerada para ${datos.razon_social || datos.rut}.${sufijo}`);
    } catch (e) {
      setError(e?.message || "No se pudo regenerar la clave.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Overlay onCerrar={onCerrar}>
      <h2 style={s.modalTitle}>
        <KeyRound size={18} /> Regenerar clave temporal
      </h2>
      <div style={s.modalBody}>
        <div style={s.clienteSel}>
          <div>
            <div style={{ fontWeight: 700, color: "#0f172a" }}>
              {datos.razon_social || "Cliente"}
            </div>
            <div style={{ fontSize: 12, color: "#64748b" }}>{datos.rut}</div>
          </div>
        </div>

        <label style={s.label}>Nueva contraseña temporal</label>
        <div style={{ display: "flex", gap: 8 }}>
          <div style={{ position: "relative", flex: 1 }}>
            <input
              type={verClave ? "text" : "password"}
              style={{ ...s.input, paddingRight: 38 }}
              value={clave}
              onChange={(e) => setClave(e.target.value)}
            />
            <button
              type="button"
              style={s.verBtn}
              onClick={() => setVerClave((v) => !v)}
              tabIndex={-1}
            >
              {verClave ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </div>
          <button style={s.btnGhost} onClick={() => setClave(generarClave())} type="button">
            <RefreshCw size={14} /> Generar
          </button>
          <button
            style={s.btnGhost}
            type="button"
            onClick={() => navigator.clipboard?.writeText(clave)}
            title="Copiar"
          >
            <Copy size={14} />
          </button>
        </div>

        <label style={s.checkRow}>
          <input
            type="checkbox"
            checked={reenviar}
            onChange={(e) => setReenviar(e.target.checked)}
          />
          Reenviar correo con la nueva clave e instrucciones
        </label>

        {datos.recuperacion_id && (
          <div style={s.hintMini}>
            Al regenerar, la solicitud de recuperación se marcará como resuelta.
          </div>
        )}

        {error && <div style={s.errBox}>{error}</div>}

        <div style={s.modalFooter}>
          <button style={s.btnGhost} onClick={onCerrar} disabled={enviando}>
            Cancelar
          </button>
          <button style={s.btnPrimario} onClick={regenerar} disabled={enviando}>
            {enviando ? "Guardando…" : "Regenerar clave"}
          </button>
        </div>
      </div>
    </Overlay>
  );
}

function Overlay({ children, onCerrar }) {
  return (
    <div style={s.overlay} onClick={onCerrar}>
      <div style={s.modal} onClick={(e) => e.stopPropagation()}>
        <button style={s.modalClose} onClick={onCerrar} aria-label="Cerrar">
          <X size={18} />
        </button>
        {children}
      </div>
    </div>
  );
}

const s = {
  page: { padding: "24px 28px", maxWidth: 1100, margin: "0 auto" },
  header: { display: "flex", alignItems: "center", gap: 16, marginBottom: 22 },
  headIcon: {
    width: 46,
    height: 46,
    borderRadius: 12,
    background: "#e8f7f7",
    color: TEAL,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  title: { margin: 0, fontSize: 21, fontWeight: 800, color: "#0f172a" },
  sub: { margin: "3px 0 0", fontSize: 13.5, color: "#64748b", maxWidth: 620 },
  tabs: { display: "flex", gap: 4, marginBottom: 16, borderBottom: "1px solid #e2e8f0" },
  tab: {
    display: "inline-flex",
    alignItems: "center",
    gap: 7,
    padding: "10px 16px",
    background: "transparent",
    border: "none",
    borderBottom: "2px solid transparent",
    color: "#64748b",
    fontSize: 13.5,
    fontWeight: 600,
    cursor: "pointer",
  },
  tabActiva: { color: TEAL, borderBottomColor: TEAL },
  badge: {
    background: "#ef4444",
    color: "#fff",
    fontSize: 11,
    fontWeight: 800,
    borderRadius: 999,
    padding: "1px 7px",
    marginLeft: 2,
  },
  card: {
    background: "#fff",
    border: "1px solid #e2e8f0",
    borderRadius: 14,
    overflow: "hidden",
    boxShadow: "0 2px 8px rgba(15,23,42,0.04)",
  },
  cardHead: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "14px 16px",
    borderBottom: "1px solid #f1f5f9",
    justifyContent: "space-between",
    flexWrap: "wrap",
  },
  infoNota: {
    display: "flex",
    alignItems: "flex-start",
    gap: 8,
    padding: "11px 16px",
    background: "#e8f7f7",
    borderBottom: "1px solid #b2e4e5",
    fontSize: 12.5,
    color: TEAL_DARK,
    lineHeight: 1.5,
  },
  searchWrap: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    background: "#f8fafc",
    border: "1px solid #e2e8f0",
    borderRadius: 10,
    padding: "8px 12px",
    flex: 1,
    minWidth: 220,
  },
  searchInput: { border: "none", outline: "none", background: "transparent", fontSize: 14, flex: 1, color: "#0f172a" },
  vacio: { padding: "44px 20px", textAlign: "center", color: "#94a3b8", fontSize: 14 },
  tablaWrap: { overflowX: "auto" },
  tabla: { width: "100%", borderCollapse: "collapse" },
  th: {
    textAlign: "left",
    padding: "11px 16px",
    fontSize: 11,
    fontWeight: 700,
    color: "#64748b",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    background: "#f8fafc",
    borderBottom: "1px solid #f1f5f9",
    whiteSpace: "nowrap",
  },
  tr: { borderBottom: "1px solid #f8fafc" },
  td: { padding: "12px 16px", fontSize: 13.5, color: "#334155", verticalAlign: "middle" },
  estadoChip: {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    padding: "3px 10px",
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 700,
  },
  tempChip: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    padding: "3px 8px",
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 700,
    background: "#eff6ff",
    color: "#1d4ed8",
    marginLeft: 6,
  },
  accBtn: {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    padding: "6px 10px",
    background: "#f8fafc",
    border: "1px solid #e2e8f0",
    borderRadius: 8,
    fontSize: 12.5,
    fontWeight: 600,
    color: "#334155",
    cursor: "pointer",
    marginLeft: 6,
  },
  listaRec: { display: "flex", flexDirection: "column", gap: 10, padding: 14 },
  recCard: { border: "1px solid #e2e8f0", borderRadius: 12, padding: 14, background: "#fff" },
  recTop: { display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" },
  recContacto: {
    display: "flex",
    gap: 16,
    flexWrap: "wrap",
    fontSize: 12.5,
    color: "#475569",
    marginTop: 8,
  },
  recMensaje: {
    marginTop: 8,
    padding: 10,
    background: "#f8fafc",
    borderRadius: 8,
    fontSize: 13,
    color: "#334155",
    whiteSpace: "pre-wrap",
  },

  btnPrimario: {
    display: "inline-flex",
    alignItems: "center",
    gap: 7,
    padding: "10px 16px",
    background: TEAL,
    color: "#fff",
    border: "none",
    borderRadius: 10,
    fontSize: 13.5,
    fontWeight: 700,
    cursor: "pointer",
  },
  btnPrimarioSm: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "7px 12px",
    background: TEAL,
    color: "#fff",
    border: "none",
    borderRadius: 8,
    fontSize: 12.5,
    fontWeight: 700,
    cursor: "pointer",
  },
  btnGhost: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "8px 12px",
    background: "#fff",
    color: "#334155",
    border: "1px solid #e2e8f0",
    borderRadius: 8,
    fontSize: 12.5,
    fontWeight: 600,
    cursor: "pointer",
  },
  linkBtn: {
    background: "transparent",
    border: "none",
    color: TEAL,
    fontWeight: 600,
    fontSize: 13,
    cursor: "pointer",
  },

  overlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(15,23,42,0.55)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
    zIndex: 1000,
  },
  modal: {
    position: "relative",
    width: "100%",
    maxWidth: 480,
    maxHeight: "92vh",
    overflowY: "auto",
    background: "#fff",
    borderRadius: 16,
    padding: "22px 22px 20px",
    boxShadow: "0 24px 60px rgba(15,23,42,0.3)",
  },
  modalClose: {
    position: "absolute",
    top: 14,
    right: 14,
    width: 30,
    height: 30,
    borderRadius: 8,
    background: "#f1f5f9",
    border: "none",
    color: "#64748b",
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
  },
  modalTitle: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    margin: "0 0 14px",
    fontSize: 17,
    fontWeight: 800,
    color: "#0f172a",
  },
  modalBody: { display: "flex", flexDirection: "column", gap: 4 },
  modalFooter: { display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 18 },
  label: { fontSize: 12, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 6 },
  input: {
    width: "100%",
    padding: "10px 12px",
    border: "1.5px solid #e2e8f0",
    borderRadius: 10,
    fontSize: 14,
    color: "#0f172a",
    outline: "none",
  },
  verBtn: {
    position: "absolute",
    right: 6,
    top: "50%",
    transform: "translateY(-50%)",
    background: "transparent",
    border: "none",
    color: "#94a3b8",
    cursor: "pointer",
    padding: 6,
  },
  hintMini: { fontSize: 12, color: "#94a3b8", marginTop: 6 },
  resultados: {
    marginTop: 8,
    border: "1px solid #e2e8f0",
    borderRadius: 10,
    overflow: "hidden",
    maxHeight: 240,
    overflowY: "auto",
  },
  resItem: {
    display: "block",
    width: "100%",
    textAlign: "left",
    padding: "10px 12px",
    background: "#fff",
    border: "none",
    borderBottom: "1px solid #f1f5f9",
    cursor: "pointer",
  },
  clienteSel: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    padding: 12,
    background: "#f8fafc",
    border: "1px solid #e2e8f0",
    borderRadius: 10,
    marginBottom: 12,
  },
  warnBox: {
    display: "flex",
    alignItems: "flex-start",
    gap: 8,
    padding: "10px 12px",
    background: "#fffbeb",
    border: "1px solid #fde68a",
    borderRadius: 10,
    fontSize: 12.5,
    color: "#92400e",
    marginBottom: 12,
  },
  vigRow: { display: "flex", gap: 8 },
  vigBtn: {
    flex: 1,
    padding: "10px 8px",
    border: "1.5px solid #e2e8f0",
    background: "#fff",
    borderRadius: 10,
    fontSize: 13,
    fontWeight: 600,
    color: "#475569",
    cursor: "pointer",
  },
  vigBtnOn: { borderColor: TEAL, background: "#e8f7f7", color: TEAL },
  checkRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 13,
    color: "#334155",
    marginTop: 12,
    cursor: "pointer",
  },
  errBox: {
    marginTop: 12,
    padding: "10px 12px",
    background: "#fef2f2",
    border: "1px solid #fecaca",
    borderRadius: 8,
    fontSize: 13,
    color: "#991b1b",
  },
};
