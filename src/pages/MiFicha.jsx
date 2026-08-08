import { useCallback, useEffect, useMemo, useState } from "react";
import {
  UserCircle2, Wallet, FileText, ClipboardCheck, PlaneTakeoff, Eye, PenLine,
  Clock, CalendarDays, AlertTriangle, Plus, CheckCircle2, FileDown,
} from "lucide-react";
import { api } from "../lib/api";
import Toast from "../components/Toast";
import FirmaDigital from "../components/FirmaDigital";

/* ============================================================================
   Mi Ficha — portal del trabajador
   ----------------------------------------------------------------------------
   Cada persona ve SOLO lo suyo (el backend resuelve la ficha por el email del
   token): datos personales, saldo de vacaciones, liquidaciones emitidas,
   contratos, evaluaciones y documentos, con firma electrónica en pantalla.
   Desde aquí también solicita vacaciones y permisos.
============================================================================ */

const fmtCLP = (v) => `$${Math.round(Number(v || 0)).toLocaleString("es-CL")}`;
const fmtFecha = (v) => {
  if (!v) return "—";
  const d = new Date(String(v).length <= 10 ? `${v}T00:00:00` : v);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("es-CL");
};
const nombrePeriodo = (p) => {
  if (!p) return "—";
  const [a, m] = String(p).split("-");
  const meses = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
  return `${meses[Number(m) - 1] || m} ${a}`;
};

const SECCIONES = [
  { key: "resumen", label: "Mi información", icon: UserCircle2 },
  { key: "liquidaciones", label: "Mis liquidaciones", icon: Wallet },
  { key: "contratos", label: "Mis contratos", icon: FileText },
  { key: "evaluaciones", label: "Mis evaluaciones", icon: ClipboardCheck },
  { key: "solicitudes", label: "Vacaciones y permisos", icon: PlaneTakeoff },
];

const TONO = {
  emitida: { bg: "#dbeafe", color: "#1d4ed8" }, firmada: { bg: "#dcfce7", color: "#15803d" },
  pagada: { bg: "#dcfce7", color: "#15803d" }, firmado: { bg: "#dcfce7", color: "#15803d" },
  enviado: { bg: "#fef3c7", color: "#b45309" }, enviada: { bg: "#fef3c7", color: "#b45309" },
  pendiente: { bg: "#fef3c7", color: "#b45309" }, aprobada: { bg: "#dcfce7", color: "#15803d" },
  rechazada: { bg: "#fee2e2", color: "#b91c1c" }, anulada: { bg: "#f1f5f9", color: "#64748b" },
};

function Pill({ estado }) {
  const t = TONO[estado] || { bg: "#f1f5f9", color: "#64748b" };
  return (
    <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 9px", borderRadius: 999, background: t.bg, color: t.color, whiteSpace: "nowrap" }}>
      {String(estado || "—").replace(/_/g, " ")}
    </span>
  );
}

function Tarjeta({ children, style }) {
  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 12, background: "var(--surface)", padding: "14px 16px", ...style }}>
      {children}
    </div>
  );
}

function Vacio({ texto }) {
  return <div style={{ padding: "26px 0", textAlign: "center", color: "var(--text-muted)", fontSize: 12.5 }}>{texto}</div>;
}

function Modal({ titulo, ancho = 640, onClose, children, footer }) {
  return (
    <div onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.45)", zIndex: 9000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ background: "var(--surface)", borderRadius: 14, width: `min(${ancho}px, 100%)`, maxHeight: "92vh", display: "flex", flexDirection: "column", boxShadow: "0 24px 64px -12px rgba(15,23,42,.4)" }}>
        <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)", fontWeight: 700, fontSize: 15 }}>{titulo}</div>
        <div style={{ padding: 18, overflowY: "auto", flex: 1 }}>{children}</div>
        {footer && <div style={{ padding: "12px 18px", borderTop: "1px solid var(--border)", display: "flex", gap: 8, justifyContent: "flex-end" }}>{footer}</div>}
      </div>
    </div>
  );
}

export default function MiFicha() {
  const [ficha, setFicha] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [seccion, setSeccion] = useState("resumen");
  const [toast, setToast] = useState(null);
  const [firmando, setFirmando] = useState(null); // { tipo, doc, titulo, contenido }
  const [guardandoFirma, setGuardandoFirma] = useState(false);
  const [detalleLiq, setDetalleLiq] = useState(null);
  const [nuevaSolicitud, setNuevaSolicitud] = useState(null);
  const [enviandoSolicitud, setEnviandoSolicitud] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      setFicha(await api.get("/rrhh/mi/ficha"));
      setError("");
    } catch (e) {
      setError(e?.message || "No se pudo cargar tu ficha.");
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  async function firmar(datos) {
    setGuardandoFirma(true);
    try {
      await api.post("/rrhh/mi/firmar", {
        documento_tipo: firmando.tipo,
        documento_id: firmando.doc.id,
        firma_imagen: datos.firma_imagen,
        contenido: datos.contenido || "",
      });
      setToast({ type: "success", message: "Documento firmado correctamente." });
      setFirmando(null);
      await cargar();
    } catch (e) {
      setToast({ type: "error", message: e?.message || "No se pudo firmar." });
    } finally {
      setGuardandoFirma(false);
    }
  }

  async function abrirArchivo(doc) {
    try {
      const { url } = await api.get(
        `/rrhh/mi/archivo?bucket=${encodeURIComponent(doc.bucket || "rrhh")}&path=${encodeURIComponent(doc.storage_path)}`,
      );
      if (url) window.open(url, "_blank", "noopener");
      else setToast({ type: "error", message: "El archivo no está disponible." });
    } catch (e) {
      setToast({ type: "error", message: e?.message || "No se pudo abrir el archivo." });
    }
  }

  async function enviarSolicitud() {
    if (!nuevaSolicitud?.fecha_desde || !nuevaSolicitud?.fecha_hasta) {
      setToast({ type: "error", message: "Indica las fechas de tu solicitud." });
      return;
    }
    setEnviandoSolicitud(true);
    try {
      await api.post("/rrhh/mi/solicitudes", nuevaSolicitud);
      setToast({ type: "success", message: "Solicitud enviada. Recursos Humanos la revisará." });
      setNuevaSolicitud(null);
      await cargar();
    } catch (e) {
      setToast({ type: "error", message: e?.message || "No se pudo enviar la solicitud." });
    } finally {
      setEnviandoSolicitud(false);
    }
  }

  // Documentos pendientes de firma (para el aviso destacado).
  const porFirmar = useMemo(() => {
    if (!ficha) return [];
    const items = [];
    for (const c of ficha.contratos || []) {
      if (c.estado === "enviado") items.push({ tipo: "contrato", doc: c, titulo: c.titulo || "Contrato de trabajo" });
    }
    for (const e of ficha.evaluaciones || []) {
      if (e.estado === "enviada") items.push({ tipo: "evaluacion", doc: e, titulo: `Evaluación ${e.periodo}` });
    }
    for (const l of ficha.liquidaciones || []) {
      if (l.estado === "emitida") items.push({ tipo: "liquidacion", doc: l, titulo: `Liquidación ${nombrePeriodo(l.periodo)}` });
    }
    return items;
  }, [ficha]);

  if (cargando) {
    return <div className="page"><Vacio texto="Cargando tu ficha…" /></div>;
  }

  if (error) {
    return (
      <div className="page">
        <div style={{ border: "1px solid #fcd34d", background: "#fffbeb", borderRadius: 12, padding: "16px 20px", display: "flex", gap: 12, alignItems: "flex-start", maxWidth: 640 }}>
          <AlertTriangle size={18} style={{ color: "#b45309", flexShrink: 0, marginTop: 2 }} />
          <div style={{ fontSize: 13.5, lineHeight: 1.6 }}>
            <b>No tienes una ficha de trabajador registrada.</b><br />
            {error}<br />
            Pide a Recursos Humanos que cree tu ficha con este correo para ver aquí tus liquidaciones,
            contratos y solicitar vacaciones.
          </div>
        </div>
      </div>
    );
  }

  const { empleado, vacaciones, antiguedad, liquidaciones, contratos, evaluaciones, solicitudes, documentos } = ficha;

  return (
    <div className="page">
      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}

      <div className="page-header">
        <div>
          <h1 className="page-title" style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <UserCircle2 size={22} style={{ color: "var(--primary)" }} />
            Mi Ficha
          </h1>
          <p className="page-subtitle">
            {empleado.cargo || "Trabajador"}{empleado.area ? ` · ${empleado.area}` : ""} · desde {fmtFecha(empleado.fecha_ingreso)}
          </p>
        </div>
      </div>

      {/* Aviso de documentos por firmar */}
      {porFirmar.length > 0 && (
        <div style={{ border: "1px solid #fcd34d", background: "#fffbeb", borderRadius: 12, padding: "13px 16px", marginBottom: 16, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <PenLine size={17} style={{ color: "#b45309", flexShrink: 0 }} />
          <div style={{ fontSize: 13, flex: 1, minWidth: 200 }}>
            Tienes <b>{porFirmar.length} documento{porFirmar.length === 1 ? "" : "s"}</b> pendiente{porFirmar.length === 1 ? "" : "s"} de firma.
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {porFirmar.slice(0, 3).map((f, i) => (
              <button key={i} className="btn btn-secondary" style={{ fontSize: 12, padding: "5px 11px" }}
                onClick={() => setFirmando(f)}>
                Firmar: {f.titulo}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* KPIs personales */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 12, marginBottom: 16 }}>
        <Tarjeta>
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <div style={{ width: 38, height: 38, borderRadius: 10, background: "#dcfce7", color: "#15803d", display: "flex", alignItems: "center", justifyContent: "center" }}><PlaneTakeoff size={17} /></div>
            <div>
              <div style={{ fontSize: 11.5, color: "var(--text-muted)", fontWeight: 600 }}>Vacaciones disponibles</div>
              <div style={{ fontSize: 20, fontWeight: 800 }}>{vacaciones.saldo} días</div>
              <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{vacaciones.tomados} tomados este período</div>
            </div>
          </div>
        </Tarjeta>
        <Tarjeta>
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <div style={{ width: 38, height: 38, borderRadius: 10, background: "#e6f6f6", color: "#1e9295", display: "flex", alignItems: "center", justifyContent: "center" }}><Clock size={17} /></div>
            <div>
              <div style={{ fontSize: 11.5, color: "var(--text-muted)", fontWeight: 600 }}>Antigüedad</div>
              <div style={{ fontSize: 20, fontWeight: 800 }}>{antiguedad ? `${antiguedad.anios}a ${antiguedad.meses}m` : "—"}</div>
              <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Ingreso {fmtFecha(empleado.fecha_ingreso)}</div>
            </div>
          </div>
        </Tarjeta>
        <Tarjeta>
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <div style={{ width: 38, height: 38, borderRadius: 10, background: "#ede9fe", color: "#6d28d9", display: "flex", alignItems: "center", justifyContent: "center" }}><Wallet size={17} /></div>
            <div>
              <div style={{ fontSize: 11.5, color: "var(--text-muted)", fontWeight: 600 }}>Última liquidación</div>
              <div style={{ fontSize: 20, fontWeight: 800 }}>{liquidaciones[0] ? fmtCLP(liquidaciones[0].liquido) : "—"}</div>
              <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{liquidaciones[0] ? nombrePeriodo(liquidaciones[0].periodo) : "sin liquidaciones"}</div>
            </div>
          </div>
        </Tarjeta>
      </div>

      {/* Secciones */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 16, borderBottom: "1px solid var(--border)", paddingBottom: 10 }}>
        {SECCIONES.map(({ key, label, icon: Icon }) => (
          <button key={key} type="button" onClick={() => setSeccion(key)}
            style={{
              display: "inline-flex", alignItems: "center", gap: 7, padding: "8px 14px", borderRadius: 9,
              border: "1px solid " + (seccion === key ? "transparent" : "var(--border)"),
              background: seccion === key ? "var(--primary)" : "var(--surface)",
              color: seccion === key ? "#fff" : "var(--text-muted)",
              fontSize: 12.5, fontWeight: 700, cursor: "pointer",
            }}>
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>

      {seccion === "resumen" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <Tarjeta>
            <div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 12 }}>Mis datos</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12, fontSize: 12.5 }}>
              {[
                ["Nombre", `${empleado.nombre} ${empleado.apellidos || ""}`.trim()],
                ["RUT", empleado.rut], ["Correo", empleado.email], ["Teléfono", empleado.telefono],
                ["Cargo", empleado.cargo], ["Área", empleado.area],
                ["Tipo de contrato", String(empleado.tipo_contrato || "").replace(/_/g, " ")],
                ["Jornada", empleado.jornada], ["AFP", empleado.afp], ["Salud", empleado.salud],
                ["Dirección", [empleado.direccion, empleado.comuna].filter(Boolean).join(", ")],
                ["Contacto de emergencia", [empleado.contacto_emergencia, empleado.telefono_emergencia].filter(Boolean).join(" · ")],
              ].map(([label, valor]) => (
                <div key={label} style={{ borderBottom: "1px solid var(--border)", paddingBottom: 6 }}>
                  <div style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 600 }}>{label}</div>
                  <div style={{ textTransform: label === "Tipo de contrato" ? "capitalize" : undefined }}>{valor || "—"}</div>
                </div>
              ))}
            </div>
            <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 12 }}>
              ¿Algún dato incorrecto? Avisa a Recursos Humanos para corregirlo.
            </div>
          </Tarjeta>

          {(documentos || []).length > 0 && (
            <Tarjeta>
              <div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 10 }}>Mis documentos</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                {documentos.map((d) => (
                  <div key={d.id} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12.5, padding: "6px 0", borderBottom: "1px solid var(--border)" }}>
                    <FileText size={14} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
                    <span style={{ flex: 1 }}>{d.titulo || d.file_name}</span>
                    <span style={{ color: "var(--text-muted)", fontSize: 11.5 }}>{fmtFecha(d.created_at)}</span>
                    {d.storage_path && (
                      <button className="btn btn-ghost" style={{ padding: 5, lineHeight: 0 }} onClick={() => abrirArchivo(d)} title="Abrir">
                        <Eye size={14} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </Tarjeta>
          )}
        </div>
      )}

      {seccion === "liquidaciones" && (
        <Tarjeta>
          {(liquidaciones || []).length === 0 ? <Vacio texto="Aún no tienes liquidaciones emitidas." /> : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {liquidaciones.map((l) => (
                <div key={l.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderBottom: "1px solid var(--border)", flexWrap: "wrap" }}>
                  <div style={{ flex: 1, minWidth: 150 }}>
                    <div style={{ fontWeight: 700 }}>{nombrePeriodo(l.periodo)}</div>
                    <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>
                      Haberes {fmtCLP(l.total_haberes)} · Descuentos {fmtCLP(l.total_descuentos)}
                    </div>
                  </div>
                  <div style={{ fontSize: 17, fontWeight: 800, color: "var(--primary-dark)" }}>{fmtCLP(l.liquido)}</div>
                  <Pill estado={l.estado} />
                  <div style={{ display: "flex", gap: 6 }}>
                    <button className="btn btn-secondary" style={{ fontSize: 12, padding: "5px 11px" }} onClick={() => setDetalleLiq(l)}>
                      Ver detalle
                    </button>
                    {l.estado === "emitida" && (
                      <button className="btn btn-primary" style={{ fontSize: 12, padding: "5px 11px", display: "inline-flex", alignItems: "center", gap: 5 }}
                        onClick={() => setFirmando({ tipo: "liquidacion", doc: l, titulo: `Liquidación ${nombrePeriodo(l.periodo)}` })}>
                        <PenLine size={12} /> Firmar
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Tarjeta>
      )}

      {seccion === "contratos" && (
        <Tarjeta>
          {(contratos || []).length === 0 ? <Vacio texto="No tienes contratos publicados." /> : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {contratos.map((c) => (
                <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderBottom: "1px solid var(--border)", flexWrap: "wrap" }}>
                  <div style={{ flex: 1, minWidth: 180 }}>
                    <div style={{ fontWeight: 700 }}>{c.titulo || `Contrato ${String(c.tipo || "").replace(/_/g, " ")}`}</div>
                    <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>
                      Desde {fmtFecha(c.fecha_inicio)}{c.fecha_termino ? ` hasta ${fmtFecha(c.fecha_termino)}` : " · indefinido"}
                    </div>
                  </div>
                  <Pill estado={c.estado} />
                  <div style={{ display: "flex", gap: 6 }}>
                    {c.storage_path && (
                      <button className="btn btn-secondary" style={{ fontSize: 12, padding: "5px 11px", display: "inline-flex", alignItems: "center", gap: 5 }} onClick={() => abrirArchivo(c)}>
                        <FileDown size={12} /> Ver PDF
                      </button>
                    )}
                    {c.estado === "enviado" && (
                      <button className="btn btn-primary" style={{ fontSize: 12, padding: "5px 11px", display: "inline-flex", alignItems: "center", gap: 5 }}
                        onClick={() => setFirmando({ tipo: "contrato", doc: c, titulo: c.titulo || "Contrato", contenido: c.contenido })}>
                        <PenLine size={12} /> Leer y firmar
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Tarjeta>
      )}

      {seccion === "evaluaciones" && (
        <Tarjeta>
          {(evaluaciones || []).length === 0 ? <Vacio texto="Aún no tienes evaluaciones publicadas." /> : (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {evaluaciones.map((ev) => (
                <div key={ev.id} style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 14 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
                    <div>
                      <div style={{ fontWeight: 700 }}>Evaluación {ev.periodo}</div>
                      <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>
                        {ev.evaluador_nombre || ev.evaluador_email || "—"} · {fmtFecha(ev.fecha_evaluacion)}
                      </div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <div style={{ fontSize: 20, fontWeight: 800, color: Number(ev.puntaje) >= 4 ? "#15803d" : Number(ev.puntaje) >= 3 ? "#b45309" : "#b91c1c" }}>
                        {ev.puntaje != null ? `${ev.puntaje}/5` : "—"}
                      </div>
                      <Pill estado={ev.estado} />
                      {ev.estado === "enviada" && (
                        <button className="btn btn-primary" style={{ fontSize: 12, padding: "5px 11px", display: "inline-flex", alignItems: "center", gap: 5 }}
                          onClick={() => setFirmando({ tipo: "evaluacion", doc: ev, titulo: `Evaluación ${ev.periodo}` })}>
                          <PenLine size={12} /> Firmar
                        </button>
                      )}
                    </div>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12, fontSize: 12.5 }}>
                    <div>
                      <div style={{ fontWeight: 700, marginBottom: 5 }}>Competencias</div>
                      {(ev.competencias || []).map((c, i) => (
                        <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "2px 0" }}>
                          <span>{c.nombre}</span><b>{c.puntaje}</b>
                        </div>
                      ))}
                    </div>
                    {[["Fortalezas", ev.fortalezas], ["Oportunidades", ev.oportunidades], ["Compromisos", ev.compromisos]]
                      .filter(([, v]) => v).map(([label, v]) => (
                        <div key={label}>
                          <div style={{ fontWeight: 700, marginBottom: 4 }}>{label}</div>
                          <div style={{ lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{v}</div>
                        </div>
                      ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Tarjeta>
      )}

      {seccion === "solicitudes" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <Tarjeta style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <div style={{ fontSize: 12.5 }}>
              Tienes <b>{vacaciones.saldo} días</b> de vacaciones disponibles.
              Las solicitudes las revisa Recursos Humanos.
            </div>
            <button className="btn btn-primary" onClick={() => setNuevaSolicitud({ tipo: "vacaciones" })}
              style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
              <Plus size={15} /> Nueva solicitud
            </button>
          </Tarjeta>

          <Tarjeta>
            {(solicitudes || []).length === 0 ? <Vacio texto="No has hecho solicitudes." /> : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {solicitudes.map((s) => (
                  <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "9px 0", borderBottom: "1px solid var(--border)", flexWrap: "wrap" }}>
                    <CalendarDays size={15} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 170 }}>
                      <div style={{ fontWeight: 700, textTransform: "capitalize" }}>{String(s.tipo || "").replace(/_/g, " ")}</div>
                      <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>
                        {fmtFecha(s.fecha_desde)} → {fmtFecha(s.fecha_hasta)} · {s.dias} día{s.dias === 1 ? "" : "s"}
                      </div>
                    </div>
                    {s.comentario_resolucion && (
                      <div style={{ fontSize: 11.5, color: "var(--text-muted)", maxWidth: 240 }}>{s.comentario_resolucion}</div>
                    )}
                    <Pill estado={s.estado} />
                  </div>
                ))}
              </div>
            )}
          </Tarjeta>
        </div>
      )}

      {/* Firma */}
      {firmando && (
        <Modal titulo={`Firmar · ${firmando.titulo}`} ancho={680} onClose={() => setFirmando(null)}>
          {firmando.contenido && (
            <div style={{ maxHeight: 240, overflowY: "auto", background: "var(--bg)", borderRadius: 10, padding: 14, fontSize: 12.5, lineHeight: 1.7, whiteSpace: "pre-wrap", marginBottom: 16 }}>
              {firmando.contenido}
            </div>
          )}
          {firmando.tipo === "liquidacion" && (
            <div style={{ background: "var(--bg)", borderRadius: 10, padding: 14, marginBottom: 16, fontSize: 12.5 }}>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "3px 0" }}><span>Total haberes</span><b>{fmtCLP(firmando.doc.total_haberes)}</b></div>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", color: "#b91c1c" }}><span>Total descuentos</span><b>{fmtCLP(firmando.doc.total_descuentos)}</b></div>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0 0", marginTop: 6, borderTop: "1px solid var(--border)", fontWeight: 800, fontSize: 14 }}>
                <span>Líquido a pagar</span><span>{fmtCLP(firmando.doc.liquido)}</span>
              </div>
            </div>
          )}
          <FirmaDigital
            titulo="Tu firma"
            descripcion="Al firmar dejas constancia de que recibiste y revisaste este documento."
            contenido={firmando.contenido || firmando.titulo}
            onFirmar={firmar}
            onCancelar={() => setFirmando(null)}
            guardando={guardandoFirma}
          />
        </Modal>
      )}

      {/* Detalle de liquidación */}
      {detalleLiq && (
        <Modal titulo={`Liquidación ${nombrePeriodo(detalleLiq.periodo)}`} ancho={520} onClose={() => setDetalleLiq(null)}
          footer={<button className="btn btn-secondary" onClick={() => setDetalleLiq(null)}>Cerrar</button>}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13 }}>
            <div style={{ fontWeight: 800, marginBottom: 4, color: "var(--primary-dark)" }}>Haberes</div>
            {[["Sueldo base", detalleLiq.sueldo_base], ["Gratificación", detalleLiq.gratificacion],
              ["Horas extra", detalleLiq.horas_extra], ["Bonos", detalleLiq.bonos],
              ["Comisiones", detalleLiq.comisiones], ["Colación", detalleLiq.colacion],
              ["Movilización", detalleLiq.movilizacion], ["Asignación familiar", detalleLiq.asignacion_familiar]]
              .filter(([, v]) => Number(v) > 0).map(([label, v]) => (
                <div key={label} style={{ display: "flex", justifyContent: "space-between", padding: "2px 0" }}>
                  <span>{label}</span><span>{fmtCLP(v)}</span>
                </div>
              ))}
            <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 800, borderTop: "1px solid var(--border)", paddingTop: 5, marginTop: 3 }}>
              <span>Total haberes</span><span>{fmtCLP(detalleLiq.total_haberes)}</span>
            </div>

            <div style={{ fontWeight: 800, margin: "12px 0 4px", color: "#b91c1c" }}>Descuentos</div>
            {[["AFP", detalleLiq.afp_monto], ["Salud", detalleLiq.salud_monto],
              ["Seguro de cesantía", detalleLiq.seguro_cesantia], ["Impuesto único", detalleLiq.impuesto_unico],
              ["Anticipos", detalleLiq.anticipos], ["Préstamos", detalleLiq.prestamos],
              ["Otros descuentos", detalleLiq.otros_descuentos]]
              .filter(([, v]) => Number(v) > 0).map(([label, v]) => (
                <div key={label} style={{ display: "flex", justifyContent: "space-between", padding: "2px 0" }}>
                  <span>{label}</span><span>−{fmtCLP(v)}</span>
                </div>
              ))}
            <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 800, borderTop: "1px solid var(--border)", paddingTop: 5, marginTop: 3 }}>
              <span>Total descuentos</span><span>−{fmtCLP(detalleLiq.total_descuentos)}</span>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 900, fontSize: 17, marginTop: 12, paddingTop: 10, borderTop: "2px solid var(--primary)", color: "var(--primary-dark)" }}>
              <span>Líquido a pagar</span><span>{fmtCLP(detalleLiq.liquido)}</span>
            </div>
            <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 8 }}>
              Días trabajados: {detalleLiq.dias_trabajados}. {detalleLiq.observaciones || ""}
            </div>
          </div>
        </Modal>
      )}

      {/* Nueva solicitud */}
      {nuevaSolicitud && (
        <Modal titulo="Solicitar vacaciones o permiso" ancho={520} onClose={() => setNuevaSolicitud(null)}
          footer={<>
            <button className="btn btn-secondary" onClick={() => setNuevaSolicitud(null)} disabled={enviandoSolicitud}>Cancelar</button>
            <button className="btn btn-primary" onClick={enviarSolicitud} disabled={enviandoSolicitud}>
              {enviandoSolicitud ? "Enviando…" : "Enviar solicitud"}
            </button>
          </>}>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <label style={{ fontSize: 11.5, fontWeight: 700, color: "var(--text-muted)" }}>Tipo</label>
                <select className="input" value={nuevaSolicitud.tipo} onChange={(e) => setNuevaSolicitud((p) => ({ ...p, tipo: e.target.value }))}>
                  <option value="vacaciones">Vacaciones</option>
                  <option value="permiso">Permiso</option>
                  <option value="licencia_medica">Licencia médica</option>
                  <option value="administrativo">Día administrativo</option>
                  <option value="sin_goce">Permiso sin goce de sueldo</option>
                </select>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <label style={{ fontSize: 11.5, fontWeight: 700, color: "var(--text-muted)" }}>Desde</label>
                <input className="input" type="date" value={nuevaSolicitud.fecha_desde || ""}
                  onChange={(e) => setNuevaSolicitud((p) => ({ ...p, fecha_desde: e.target.value }))} />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <label style={{ fontSize: 11.5, fontWeight: 700, color: "var(--text-muted)" }}>Hasta</label>
                <input className="input" type="date" value={nuevaSolicitud.fecha_hasta || ""}
                  onChange={(e) => setNuevaSolicitud((p) => ({ ...p, fecha_hasta: e.target.value }))} />
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <label style={{ fontSize: 11.5, fontWeight: 700, color: "var(--text-muted)" }}>Motivo (opcional)</label>
              <textarea className="input" rows={3} value={nuevaSolicitud.motivo || ""}
                onChange={(e) => setNuevaSolicitud((p) => ({ ...p, motivo: e.target.value }))} />
            </div>
            <div style={{ fontSize: 11.5, color: "var(--text-muted)", display: "flex", gap: 6, alignItems: "flex-start" }}>
              <CheckCircle2 size={13} style={{ marginTop: 1, flexShrink: 0, color: "#15803d" }} />
              Los días hábiles se calculan solos (sin sábados ni domingos). Tu saldo actual es de {vacaciones.saldo} días.
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
