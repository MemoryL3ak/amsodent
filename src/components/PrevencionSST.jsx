import { useEffect, useMemo, useRef, useState } from "react";
import Select from "react-select";
import {
  ShieldCheck, CheckCircle2, AlertTriangle, XCircle, Info, Plus, Pencil, Trash2,
  X, Upload, Eye, Users, Flame, GraduationCap, FileText, Siren, RefreshCw,
} from "lucide-react";
import { api } from "../lib/api";

/* ============================================================================
   Prevención de Riesgos — Decreto Supremo 44/2023
   ----------------------------------------------------------------------------
   Pestaña del panel RR.HH. Es el registro electrónico de la gestión preventiva
   que exige el art. 72 del D.S. 44: documentos del sistema (matriz IPER,
   programa preventivo, reglamento interno, plan de emergencia, mapa de
   riesgos), actividades con asistentes (capacitaciones, ODI, EPP, simulacros)
   e incidentes/accidentes con su investigación. El checklist de cumplimiento
   lo calcula el backend según la dotación activa.
============================================================================ */

const TEAL = "#25b7bd";
const TEAL_OSC = "#178a8f";
const TEAL_DEEP = "#0e6e74";

const TIPOS_DOC = [
  ["politica_sst", "Política de SST"],
  ["matriz_riesgos", "Matriz IPER (peligros y riesgos)"],
  ["programa_preventivo", "Programa de trabajo preventivo"],
  ["reglamento_interno", "Reglamento Interno de Higiene y Seguridad"],
  ["plan_emergencia", "Plan de emergencias"],
  ["mapa_riesgos", "Mapa de riesgos"],
  ["acta_delegado", "Acta elección Delegado SST"],
  ["acta_comite", "Acta constitución Comité Paritario"],
  ["otro", "Otro documento"],
];

const TIPOS_ACT = [
  ["capacitacion", "Capacitación SST"],
  ["odi", "ODI — información de riesgos"],
  ["entrega_epp", "Entrega / capacitación EPP"],
  ["simulacro", "Simulacro plan de emergencia"],
  ["charla", "Charla / difusión"],
  ["otro", "Otra actividad"],
];

const TIPOS_INC = [
  ["incidente_peligroso", "Incidente peligroso"],
  ["accidente_trabajo", "Accidente del trabajo"],
  ["accidente_trayecto", "Accidente de trayecto"],
  ["enfermedad_profesional", "Enfermedad profesional"],
];

const etiqueta = (lista, valor) =>
  lista.find(([k]) => k === valor)?.[1] || String(valor || "—").replace(/_/g, " ");

const fmtFecha = (v) => {
  if (!v) return "—";
  const d = new Date(String(v).length <= 10 ? `${v}T00:00:00` : v);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("es-CL");
};

const CHECK_ESTILO = {
  ok:     { icon: CheckCircle2,  color: "#15803d", bg: "#f0fdf4", borde: "#bbf7d0" },
  alerta: { icon: AlertTriangle, color: "#b45309", bg: "#fffbeb", borde: "#fde68a" },
  falta:  { icon: XCircle,       color: "#b91c1c", bg: "#fef2f2", borde: "#fecaca" },
  info:   { icon: Info,          color: "#475569", bg: "#f8fafc", borde: "#e2e8f0" },
};

export default function PrevencionSST({ notificar }) {
  const avisar = notificar || (() => {});

  const [resumen, setResumen] = useState(null);
  const [docs, setDocs] = useState([]);
  const [acts, setActs] = useState([]);
  const [incs, setIncs] = useState([]);
  const [empleados, setEmpleados] = useState([]);
  const [cargando, setCargando] = useState(true);

  const [docEdit, setDocEdit] = useState(null);
  const [actEdit, setActEdit] = useState(null);
  const [incEdit, setIncEdit] = useState(null);
  const [guardando, setGuardando] = useState(false);

  const activos = useMemo(
    () => empleados.filter((e) => e.estado === "activo"),
    [empleados],
  );
  const nombreEmpleado = (id) => {
    const e = empleados.find((x) => Number(x.id) === Number(id));
    return e ? `${e.nombre} ${e.apellidos || ""}`.trim() : `#${id}`;
  };

  async function cargar() {
    setCargando(true);
    try {
      const [r, d, a, i, emp] = await Promise.all([
        api.get("/rrhh/sst/resumen"),
        api.get("/rrhh/sst/documentos"),
        api.get("/rrhh/sst/actividades"),
        api.get("/rrhh/sst/incidentes"),
        api.get("/rrhh/empleados"),
      ]);
      setResumen(r);
      setDocs(d || []);
      setActs(a || []);
      setIncs(i || []);
      setEmpleados(emp || []);
    } catch (e) {
      console.error(e);
      avisar({ type: "error", message: e?.message || "No se pudo cargar Prevención. ¿Está aplicada la migración 20260813_rrhh_prevencion?" });
    } finally {
      setCargando(false);
    }
  }
  useEffect(() => {
    cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function subirArchivo(file, subcarpeta) {
    const nombre = `${Date.now()}-${file.name.replace(/[^\w.-]/g, "_")}`;
    const path = `sst/${subcarpeta}/${nombre}`;
    const fd = new FormData();
    fd.append("file", file);
    await api.postForm(`/rrhh/storage/upload?path=${encodeURIComponent(path)}`, fd);
    return {
      bucket: "rrhh", storage_path: path, file_name: file.name,
      mime_type: file.type, size_bytes: file.size,
    };
  }

  async function abrirArchivo(row) {
    try {
      const { url } = await api.get(
        `/rrhh/storage/signed-url?bucket=${encodeURIComponent(row.bucket || "rrhh")}&path=${encodeURIComponent(row.storage_path)}`,
      );
      if (url) window.open(url, "_blank", "noopener");
    } catch (e) {
      avisar({ type: "error", message: e?.message || "No se pudo abrir el archivo." });
    }
  }

  // ── Guardar / eliminar ────────────────────────────────────────────────────
  async function guardar(ruta, body, cerrar) {
    setGuardando(true);
    try {
      await api.post(ruta, body);
      cerrar();
      await cargar();
      avisar({ type: "success", message: "Guardado." });
    } catch (e) {
      avisar({ type: "error", message: e?.message || "No se pudo guardar." });
    } finally {
      setGuardando(false);
    }
  }

  async function eliminar(ruta, id) {
    if (!confirm("¿Eliminar este registro? Se conserva solo si lo exige otro respaldo.")) return;
    try {
      await api.delete(`${ruta}/${id}`);
      await cargar();
      avisar({ type: "success", message: "Eliminado." });
    } catch (e) {
      avisar({ type: "error", message: e?.message || "No se pudo eliminar." });
    }
  }

  if (cargando && !resumen) {
    return <div style={{ padding: 24, color: "#64748b", fontSize: 13 }}>Cargando Prevención…</div>;
  }

  const k = resumen?.kpis || {};

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <style>{ESTILOS_SST}</style>

      {/* Encabezado */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <ShieldCheck size={20} style={{ color: TEAL_DEEP }} />
          <div>
            <div style={{ fontSize: 15, fontWeight: 800, color: "#0f172a" }}>
              Prevención de Riesgos — D.S. 44/2023
            </div>
            <div style={{ fontSize: 12, color: "#64748b" }}>
              Registro electrónico de la gestión preventiva (art. 72), a disposición de la fiscalización.
            </div>
          </div>
        </div>
        <button type="button" className="sst-btn-pri" onClick={cargar}>
          <RefreshCw size={13} /> Refrescar
        </button>
      </div>

      {/* KPIs */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
        <Kpi icon={Users} color={TEAL} titulo="Trabajadores activos" valor={resumen?.trabajadores_activos ?? "—"} />
        <Kpi icon={ShieldCheck} color="#15803d" titulo="Checklist al día" valor={`${k.checks_ok ?? 0}/${k.checks_total ?? 0}`} />
        <Kpi icon={Siren} color="#b91c1c" titulo="Accidentes del año" valor={k.accidentes_anio ?? 0}
          sub={k.tasa_accidentabilidad != null ? `tasa ${k.tasa_accidentabilidad}% (art. 75)` : null} />
        <Kpi icon={Flame} color="#b45309" titulo="Días perdidos (año)" valor={k.dias_perdidos_anio ?? 0} />
        <Kpi icon={GraduationCap} color="#7c3aed" titulo="Capacitaciones (año)" valor={k.capacitaciones_anio ?? 0} />
      </div>

      {/* Checklist de cumplimiento */}
      <Seccion icon={CheckCircle2} titulo="Checklist de cumplimiento">
        <div>
          {(resumen?.checks || []).map((c) => {
            const st = CHECK_ESTILO[c.estado] || CHECK_ESTILO.info;
            const Icono = st.icon;
            return (
              <div key={c.clave + c.titulo} style={{
                display: "flex", gap: 10, alignItems: "flex-start", padding: "10px 14px",
                borderBottom: "1px solid #f1f5f9", background: c.estado === "falta" ? "#fff7f7" : "transparent",
              }}>
                <Icono size={17} style={{ color: st.color, flexShrink: 0, marginTop: 1 }} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#0f172a" }}>
                    {c.titulo}{" "}
                    <span style={{
                      fontSize: 10.5, fontWeight: 700, color: TEAL_DEEP, background: "#e8f7f7",
                      padding: "1px 7px", borderRadius: 999, whiteSpace: "nowrap",
                    }}>
                      D.S. 44 · {c.referencia}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: "#475569", marginTop: 2, lineHeight: 1.45 }}>{c.detalle}</div>
                </div>
              </div>
            );
          })}
        </div>
      </Seccion>

      {/* Documentos del sistema */}
      <Seccion
        icon={FileText}
        titulo="Documentos del sistema de gestión"
        accion={
          <button type="button" className="sst-btn-pri-sm" onClick={() => setDocEdit({
            tipo: "matriz_riesgos", titulo: "", version: "", fecha_aprobacion: "",
            proxima_revision: "", aprobado_por: "", descripcion: "", vigente: true,
          })}>
            <Plus size={12} /> Nuevo documento
          </button>
        }
      >
        <TablaVacia vacia={docs.length === 0} mensaje="Sin documentos. Parte por la matriz IPER, el programa preventivo y el reglamento interno.">
          <table className="sst-tabla">
            <thead>
              <tr>
                <th>Tipo</th><th>Título / versión</th><th>Aprobado</th><th>Próx. revisión</th><th>Estado</th><th></th>
              </tr>
            </thead>
            <tbody>
              {docs.map((d) => (
                <tr key={d.id} style={{ opacity: d.vigente ? 1 : 0.55 }}>
                  <td style={{ fontWeight: 700 }}>{etiqueta(TIPOS_DOC, d.tipo)}</td>
                  <td>
                    {d.titulo || d.file_name || "—"}
                    {d.version ? <span style={{ color: "#94a3b8" }}> · v{d.version}</span> : null}
                  </td>
                  <td>{fmtFecha(d.fecha_aprobacion)}</td>
                  <td style={{ color: d.vigente && d.proxima_revision && d.proxima_revision < new Date().toISOString().slice(0, 10) ? "#b91c1c" : undefined }}>
                    {fmtFecha(d.proxima_revision)}
                  </td>
                  <td>
                    <span className={d.vigente ? "sst-pill-ok" : "sst-pill-gris"}>
                      {d.vigente ? "Vigente" : "Histórico"}
                    </span>
                  </td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    {d.storage_path && (
                      <button type="button" className="sst-btn-ghost" title="Ver archivo" onClick={() => abrirArchivo(d)}><Eye size={13} /></button>
                    )}
                    <button type="button" className="sst-btn-ghost" title="Editar" onClick={() => setDocEdit({ ...d })}><Pencil size={13} /></button>
                    <button type="button" className="sst-btn-ghost sst-danger" title="Eliminar" onClick={() => eliminar("/rrhh/sst/documentos", d.id)}><Trash2 size={13} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TablaVacia>
      </Seccion>

      {/* Actividades preventivas */}
      <Seccion
        icon={GraduationCap}
        titulo="Actividades preventivas (capacitaciones · ODI · EPP · simulacros)"
        accion={
          <button type="button" className="sst-btn-pri-sm" onClick={() => setActEdit({
            tipo: "capacitacion", titulo: "", fecha: new Date().toISOString().slice(0, 10),
            duracion_horas: "", relator: "", lugar: "", descripcion: "", asistentes: [],
          })}>
            <Plus size={12} /> Registrar actividad
          </button>
        }
      >
        <TablaVacia vacia={acts.length === 0} mensaje="Sin actividades registradas. La capacitación del art. 16 (≥8 h cada ≤2 años) y la ODI del art. 15 se registran aquí.">
          <table className="sst-tabla">
            <thead>
              <tr><th>Fecha</th><th>Tipo</th><th>Actividad</th><th>Duración</th><th>Asistentes</th><th></th></tr>
            </thead>
            <tbody>
              {acts.map((a) => (
                <tr key={a.id}>
                  <td>{fmtFecha(a.fecha)}</td>
                  <td><span className="sst-pill-teal">{etiqueta(TIPOS_ACT, a.tipo)}</span></td>
                  <td style={{ fontWeight: 600 }}>{a.titulo}{a.relator ? <div style={{ fontSize: 11, color: "#94a3b8", fontWeight: 400 }}>Relator: {a.relator}</div> : null}</td>
                  <td>{a.duracion_horas != null ? `${a.duracion_horas} h` : "—"}</td>
                  <td>{(a.asistentes || []).length}</td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    {a.storage_path && (
                      <button type="button" className="sst-btn-ghost" title="Ver respaldo" onClick={() => abrirArchivo(a)}><Eye size={13} /></button>
                    )}
                    <button type="button" className="sst-btn-ghost" title="Editar" onClick={() => setActEdit({ ...a, asistentes: (a.asistentes || []).map((x) => ({ ...x })) })}><Pencil size={13} /></button>
                    <button type="button" className="sst-btn-ghost sst-danger" title="Eliminar" onClick={() => eliminar("/rrhh/sst/actividades", a.id)}><Trash2 size={13} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TablaVacia>
      </Seccion>

      {/* Incidentes y accidentes */}
      <Seccion
        icon={Siren}
        titulo="Incidentes, accidentes y enfermedades profesionales"
        accion={
          <button type="button" className="sst-btn-pri-sm" onClick={() => setIncEdit({
            tipo: "incidente_peligroso", fecha_hora: new Date().toISOString().slice(0, 16),
            lugar: "", empleado_id: "", afectado_nombre: "", afectado_sexo: "",
            descripcion: "", relato: "", causas: "", medidas: "", dias_perdidos: 0,
            denunciado_oa: false, fecha_denuncia: "", estado: "abierto",
          })}>
            <Plus size={12} /> Registrar evento
          </button>
        }
      >
        <TablaVacia vacia={incs.length === 0} mensaje="Sin eventos registrados. Todo incidente peligroso, accidente o enfermedad profesional se registra e investiga (arts. 71 y 73).">
          <table className="sst-tabla">
            <thead>
              <tr><th>Fecha</th><th>Tipo</th><th>Afectado</th><th>Días perdidos</th><th>DIAT/DIEP</th><th>Estado</th><th></th></tr>
            </thead>
            <tbody>
              {incs.map((i) => (
                <tr key={i.id} style={{ background: i.estado === "abierto" ? "#fffbeb" : "transparent" }}>
                  <td>{new Date(i.fecha_hora).toLocaleString("es-CL", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}</td>
                  <td><span className="sst-pill-rojo">{etiqueta(TIPOS_INC, i.tipo)}</span></td>
                  <td>{i.empleado_id ? nombreEmpleado(i.empleado_id) : i.afectado_nombre || "—"}</td>
                  <td>{i.dias_perdidos || 0}</td>
                  <td>{i.tipo === "incidente_peligroso" ? "n/a" : i.denunciado_oa ? `Sí${i.fecha_denuncia ? ` (${fmtFecha(i.fecha_denuncia)})` : ""}` : <span style={{ color: "#b91c1c", fontWeight: 700 }}>Pendiente</span>}</td>
                  <td>
                    <span className={i.estado === "cerrado" ? "sst-pill-ok" : i.estado === "investigado" ? "sst-pill-teal" : "sst-pill-ambar"}>
                      {i.estado}
                    </span>
                  </td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    {i.storage_path && (
                      <button type="button" className="sst-btn-ghost" title="Ver respaldo" onClick={() => abrirArchivo(i)}><Eye size={13} /></button>
                    )}
                    <button type="button" className="sst-btn-ghost" title="Editar / investigar" onClick={() => setIncEdit({ ...i, fecha_hora: String(i.fecha_hora || "").slice(0, 16), empleado_id: i.empleado_id || "", fecha_denuncia: i.fecha_denuncia || "" })}><Pencil size={13} /></button>
                    <button type="button" className="sst-btn-ghost sst-danger" title="Eliminar" onClick={() => eliminar("/rrhh/sst/incidentes", i.id)}><Trash2 size={13} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TablaVacia>
      </Seccion>

      {/* ── Modal documento ──────────────────────────────────────────────── */}
      {docEdit && (
        <Modal titulo={docEdit.id ? "Editar documento" : "Nuevo documento del sistema"} onClose={() => setDocEdit(null)}>
          <Campo label="Tipo">
            <select className="sst-input" value={docEdit.tipo} onChange={(e) => setDocEdit((d) => ({ ...d, tipo: e.target.value }))}>
              {TIPOS_DOC.map(([k2, v]) => <option key={k2} value={k2}>{v}</option>)}
            </select>
          </Campo>
          <Campo label="Título">
            <input className="sst-input" value={docEdit.titulo || ""} onChange={(e) => setDocEdit((d) => ({ ...d, titulo: e.target.value }))} placeholder="Ej: Matriz IPER bodega y oficina 2026" />
          </Campo>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
            <Campo label="Versión">
              <input className="sst-input" value={docEdit.version || ""} onChange={(e) => setDocEdit((d) => ({ ...d, version: e.target.value }))} placeholder="1.0" />
            </Campo>
            <Campo label="Fecha aprobación">
              <input type="date" className="sst-input" value={docEdit.fecha_aprobacion || ""} onChange={(e) => setDocEdit((d) => ({ ...d, fecha_aprobacion: e.target.value }))} />
            </Campo>
            <Campo label="Próxima revisión">
              <input type="date" className="sst-input" value={docEdit.proxima_revision || ""} onChange={(e) => setDocEdit((d) => ({ ...d, proxima_revision: e.target.value }))} />
            </Campo>
          </div>
          <Campo label="Aprobado por (representante legal)">
            <input className="sst-input" value={docEdit.aprobado_por || ""} onChange={(e) => setDocEdit((d) => ({ ...d, aprobado_por: e.target.value }))} />
          </Campo>
          <Campo label="Descripción / alcance">
            <textarea className="sst-input" rows={2} value={docEdit.descripcion || ""} onChange={(e) => setDocEdit((d) => ({ ...d, descripcion: e.target.value }))} />
          </Campo>
          <AdjuntarArchivo
            row={docEdit}
            onArchivo={async (file) => {
              const meta = await subirArchivo(file, "documentos");
              setDocEdit((d) => ({ ...d, ...meta }));
            }}
            avisar={avisar}
          />
          <PieModal guardando={guardando} onCancelar={() => setDocEdit(null)}
            onGuardar={() => guardar("/rrhh/sst/documentos", docEdit, () => setDocEdit(null))} />
        </Modal>
      )}

      {/* ── Modal actividad ──────────────────────────────────────────────── */}
      {actEdit && (
        <Modal titulo={actEdit.id ? "Editar actividad" : "Registrar actividad preventiva"} onClose={() => setActEdit(null)}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <Campo label="Tipo">
              <select className="sst-input" value={actEdit.tipo} onChange={(e) => setActEdit((a) => ({ ...a, tipo: e.target.value }))}>
                {TIPOS_ACT.map(([k2, v]) => <option key={k2} value={k2}>{v}</option>)}
              </select>
            </Campo>
            <Campo label="Fecha">
              <input type="date" className="sst-input" value={actEdit.fecha || ""} onChange={(e) => setActEdit((a) => ({ ...a, fecha: e.target.value }))} />
            </Campo>
          </div>
          <Campo label="Título">
            <input className="sst-input" value={actEdit.titulo || ""} onChange={(e) => setActEdit((a) => ({ ...a, titulo: e.target.value }))} placeholder="Ej: Curso SST 8 h — mutual" />
          </Campo>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
            <Campo label="Duración (h)">
              <input type="number" min="0" step="0.5" className="sst-input" value={actEdit.duracion_horas ?? ""} onChange={(e) => setActEdit((a) => ({ ...a, duracion_horas: e.target.value }))} />
            </Campo>
            <Campo label="Relator">
              <input className="sst-input" value={actEdit.relator || ""} onChange={(e) => setActEdit((a) => ({ ...a, relator: e.target.value }))} />
            </Campo>
            <Campo label="Lugar">
              <input className="sst-input" value={actEdit.lugar || ""} onChange={(e) => setActEdit((a) => ({ ...a, lugar: e.target.value }))} />
            </Campo>
          </div>
          <Campo label="Contenidos / descripción">
            <textarea className="sst-input" rows={2} value={actEdit.descripcion || ""} onChange={(e) => setActEdit((a) => ({ ...a, descripcion: e.target.value }))} />
          </Campo>
          <Campo label="Asistentes">
            <Select
              isMulti
              options={activos.map((e) => ({ value: Number(e.id), label: `${e.nombre} ${e.apellidos || ""}`.trim() }))}
              value={(actEdit.asistentes || []).map((x) => ({ value: Number(x.empleado_id), label: nombreEmpleado(x.empleado_id) }))}
              onChange={(ops) =>
                setActEdit((a) => ({
                  ...a,
                  asistentes: (ops || []).map((o) => {
                    const previo = (a.asistentes || []).find((x) => Number(x.empleado_id) === o.value);
                    return previo || { empleado_id: o.value, resultado: "aprobado" };
                  }),
                }))
              }
              placeholder="Selecciona trabajadores…"
              noOptionsMessage={() => "Sin trabajadores"}
              menuPortalTarget={document.body}
              menuPosition="fixed"
              styles={{ menuPortal: (base) => ({ ...base, zIndex: 12000 }) }}
            />
          </Campo>
          {(actEdit.asistentes || []).length > 0 && (actEdit.tipo === "capacitacion" || actEdit.tipo === "entrega_epp") && (
            <div style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: "8px 12px" }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#475569", marginBottom: 6 }}>
                Resultado de la evaluación de aprendizaje (arts. 13 y 16)
              </div>
              {(actEdit.asistentes || []).map((x) => (
                <div key={x.empleado_id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px 0", fontSize: 12.5 }}>
                  <span style={{ flex: 1 }}>{nombreEmpleado(x.empleado_id)}</span>
                  <select
                    className="sst-input"
                    style={{ width: 140, height: 30 }}
                    value={x.resultado || "aprobado"}
                    onChange={(e) =>
                      setActEdit((a) => ({
                        ...a,
                        asistentes: a.asistentes.map((y) =>
                          Number(y.empleado_id) === Number(x.empleado_id) ? { ...y, resultado: e.target.value } : y,
                        ),
                      }))
                    }
                  >
                    <option value="aprobado">Aprobado</option>
                    <option value="reprobado">Reprobado</option>
                    <option value="pendiente">Pendiente</option>
                  </select>
                </div>
              ))}
            </div>
          )}
          <AdjuntarArchivo
            row={actEdit}
            etiqueta="Respaldo (hoja de asistencia firmada, material, fotos)"
            onArchivo={async (file) => {
              const meta = await subirArchivo(file, "actividades");
              setActEdit((a) => ({ ...a, ...meta }));
            }}
            avisar={avisar}
          />
          <PieModal guardando={guardando} onCancelar={() => setActEdit(null)}
            onGuardar={() => guardar("/rrhh/sst/actividades", actEdit, () => setActEdit(null))} />
        </Modal>
      )}

      {/* ── Modal incidente ──────────────────────────────────────────────── */}
      {incEdit && (
        <Modal titulo={incEdit.id ? "Editar / investigar evento" : "Registrar incidente o accidente"} onClose={() => setIncEdit(null)}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <Campo label="Tipo">
              <select className="sst-input" value={incEdit.tipo} onChange={(e) => setIncEdit((i) => ({ ...i, tipo: e.target.value }))}>
                {TIPOS_INC.map(([k2, v]) => <option key={k2} value={k2}>{v}</option>)}
              </select>
            </Campo>
            <Campo label="Fecha y hora">
              <input type="datetime-local" className="sst-input" value={incEdit.fecha_hora || ""} onChange={(e) => setIncEdit((i) => ({ ...i, fecha_hora: e.target.value }))} />
            </Campo>
          </div>
          <Campo label="Lugar">
            <input className="sst-input" value={incEdit.lugar || ""} onChange={(e) => setIncEdit((i) => ({ ...i, lugar: e.target.value }))} placeholder="Ej: bodega, pasillo 2" />
          </Campo>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 10 }}>
            <Campo label="Persona afectada">
              <select
                className="sst-input"
                value={incEdit.empleado_id || ""}
                onChange={(e) => setIncEdit((i) => ({ ...i, empleado_id: e.target.value }))}
              >
                <option value="">— Sin lesionados / persona externa —</option>
                {empleados.map((e2) => (
                  <option key={e2.id} value={e2.id}>{`${e2.nombre} ${e2.apellidos || ""}`.trim()}</option>
                ))}
              </select>
            </Campo>
            <Campo label="Sexo (arts. 73–75)">
              <select className="sst-input" value={incEdit.afectado_sexo || ""} onChange={(e) => setIncEdit((i) => ({ ...i, afectado_sexo: e.target.value }))}>
                <option value="">—</option>
                <option value="femenino">Femenino</option>
                <option value="masculino">Masculino</option>
                <option value="otro">Otro</option>
              </select>
            </Campo>
          </div>
          {!incEdit.empleado_id && (
            <Campo label="Nombre del afectado (si no está en la ficha)">
              <input className="sst-input" value={incEdit.afectado_nombre || ""} onChange={(e) => setIncEdit((i) => ({ ...i, afectado_nombre: e.target.value }))} />
            </Campo>
          )}
          <Campo label="Breve descripción">
            <input className="sst-input" value={incEdit.descripcion || ""} onChange={(e) => setIncEdit((i) => ({ ...i, descripcion: e.target.value }))} />
          </Campo>
          <Campo label="Relato de los hechos">
            <textarea className="sst-input" rows={3} value={incEdit.relato || ""} onChange={(e) => setIncEdit((i) => ({ ...i, relato: e.target.value }))} />
          </Campo>
          <Campo label="Identificación de causas (investigación, art. 71)">
            <textarea className="sst-input" rows={2} value={incEdit.causas || ""} onChange={(e) => setIncEdit((i) => ({ ...i, causas: e.target.value }))} />
          </Campo>
          <Campo label="Medidas correctivas y preventivas">
            <textarea className="sst-input" rows={2} value={incEdit.medidas || ""} onChange={(e) => setIncEdit((i) => ({ ...i, medidas: e.target.value }))} />
          </Campo>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, alignItems: "end" }}>
            <Campo label="Días perdidos">
              <input type="number" min="0" className="sst-input" value={incEdit.dias_perdidos ?? 0} onChange={(e) => setIncEdit((i) => ({ ...i, dias_perdidos: e.target.value }))} />
            </Campo>
            <Campo label="Estado">
              <select className="sst-input" value={incEdit.estado} onChange={(e) => setIncEdit((i) => ({ ...i, estado: e.target.value }))}>
                <option value="abierto">Abierto</option>
                <option value="investigado">Investigado</option>
                <option value="cerrado">Cerrado</option>
              </select>
            </Campo>
            {incEdit.tipo !== "incidente_peligroso" && (
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, fontWeight: 600, color: "#475569", height: 38 }}>
                <input type="checkbox" checked={Boolean(incEdit.denunciado_oa)} onChange={(e) => setIncEdit((i) => ({ ...i, denunciado_oa: e.target.checked }))} style={{ accentColor: TEAL }} />
                DIAT/DIEP presentada
              </label>
            )}
          </div>
          {incEdit.denunciado_oa && incEdit.tipo !== "incidente_peligroso" && (
            <Campo label="Fecha de la denuncia">
              <input type="date" className="sst-input" value={incEdit.fecha_denuncia || ""} onChange={(e) => setIncEdit((i) => ({ ...i, fecha_denuncia: e.target.value }))} />
            </Campo>
          )}
          <AdjuntarArchivo
            row={incEdit}
            etiqueta="Respaldo (informe de investigación, DIAT escaneada, fotos)"
            onArchivo={async (file) => {
              const meta = await subirArchivo(file, "incidentes");
              setIncEdit((i) => ({ ...i, ...meta }));
            }}
            avisar={avisar}
          />
          <PieModal guardando={guardando} onCancelar={() => setIncEdit(null)}
            onGuardar={() =>
              guardar(
                "/rrhh/sst/incidentes",
                { ...incEdit, fecha_hora: incEdit.fecha_hora ? new Date(incEdit.fecha_hora).toISOString() : null, empleado_id: incEdit.empleado_id || null },
                () => setIncEdit(null),
              )
            } />
        </Modal>
      )}
    </div>
  );
}

/* ── Piezas de UI ──────────────────────────────────────────────────────────── */

function Kpi({ icon, color, titulo, valor, sub }) {
  const Icono = icon;
  return (
    <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e7eef0", padding: "12px 14px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".1em", color: "#64748b", fontWeight: 700 }}>{titulo}</div>
        <div style={{ width: 26, height: 26, borderRadius: 7, background: `${color}18`, color, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Icono size={13} />
        </div>
      </div>
      <div style={{ fontSize: 21, fontWeight: 800, color: "#0f172a", marginTop: 5, lineHeight: 1 }}>{valor}</div>
      {sub && <div style={{ fontSize: 10.5, color: "#94a3b8", marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

function Seccion({ icon, titulo, accion, children }) {
  const Icono = icon;
  return (
    <div style={{ background: "#fff", borderRadius: 14, border: "1px solid #e7eef0", overflow: "hidden" }}>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10,
        padding: "12px 16px", borderBottom: "1px solid #eef2f5",
        background: "linear-gradient(180deg, #fafdfd 0%, #ffffff 100%)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Icono size={15} style={{ color: TEAL }} />
          <div style={{ fontSize: 12, fontWeight: 800, color: TEAL_DEEP, textTransform: "uppercase", letterSpacing: ".08em" }}>
            {titulo}
          </div>
        </div>
        {accion}
      </div>
      {children}
    </div>
  );
}

function TablaVacia({ vacia, mensaje, children }) {
  if (vacia) {
    return <div style={{ padding: 22, fontSize: 12.5, color: "#64748b", textAlign: "center" }}>{mensaje}</div>;
  }
  return <div style={{ overflowX: "auto" }}>{children}</div>;
}

function Modal({ titulo, onClose, children }) {
  return (
    <div
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: "fixed", inset: 0, background: "rgba(15,23,42,.55)", backdropFilter: "blur(4px)",
        zIndex: 11000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
      }}
    >
      <div style={{ width: 560, maxWidth: "100%", maxHeight: "92vh", overflowY: "auto", background: "#fff", borderRadius: 16, boxShadow: "0 32px 80px -16px rgba(15,23,42,.45)" }}>
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between", padding: "13px 18px",
          background: `linear-gradient(135deg, ${TEAL} 0%, ${TEAL_OSC} 100%)`, color: "#fff",
          position: "sticky", top: 0, zIndex: 1,
        }}>
          <div style={{ fontWeight: 800, fontSize: 14.5 }}>{titulo}</div>
          <button type="button" onClick={onClose} style={{ background: "rgba(255,255,255,.18)", border: "none", color: "#fff", cursor: "pointer", padding: 6, borderRadius: 7, display: "inline-flex" }}>
            <X size={15} />
          </button>
        </div>
        <div style={{ padding: 18, display: "flex", flexDirection: "column", gap: 11 }}>
          {children}
        </div>
      </div>
    </div>
  );
}

function Campo({ label, children }) {
  return (
    <div>
      <label style={{ display: "block", fontSize: 11.5, color: "#475569", fontWeight: 600, marginBottom: 4 }}>{label}</label>
      {children}
    </div>
  );
}

function AdjuntarArchivo({ row, onArchivo, avisar, etiqueta = "Archivo" }) {
  const inputRef = useRef(null);
  const [subiendo, setSubiendo] = useState(false);
  return (
    <div>
      <label style={{ display: "block", fontSize: 11.5, color: "#475569", fontWeight: 600, marginBottom: 4 }}>{etiqueta}</label>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <button type="button" className="sst-btn-ghost" disabled={subiendo} onClick={() => inputRef.current?.click()}>
          <Upload size={13} /> {subiendo ? "Subiendo…" : row?.file_name ? "Reemplazar" : "Adjuntar"}
        </button>
        {row?.file_name && <span style={{ fontSize: 12, color: "#475569" }}>{row.file_name}</span>}
        <input
          ref={inputRef}
          type="file"
          hidden
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            setSubiendo(true);
            try {
              await onArchivo(file);
            } catch (err) {
              console.error(err);
              avisar({ type: "error", message: err?.message || "No se pudo subir el archivo." });
            } finally {
              setSubiendo(false);
              if (inputRef.current) inputRef.current.value = "";
            }
          }}
        />
      </div>
    </div>
  );
}

function PieModal({ guardando, onCancelar, onGuardar }) {
  return (
    <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 4 }}>
      <button type="button" className="sst-btn-ghost" onClick={onCancelar}>Cancelar</button>
      <button type="button" className="sst-btn-pri" disabled={guardando} onClick={onGuardar}>
        {guardando ? "Guardando…" : "Guardar"}
      </button>
    </div>
  );
}

const ESTILOS_SST = `
.sst-input {
  width: 100%; height: 38px; padding: 0 11px;
  border-radius: 8px; border: 1.5px solid #e2e8f0;
  font-size: 13px; outline: none; background: #fff; box-sizing: border-box;
  transition: border-color .15s, box-shadow .15s;
}
textarea.sst-input { height: auto; padding: 8px 11px; resize: vertical; font-family: inherit; }
.sst-input:focus { border-color: ${TEAL}; box-shadow: 0 0 0 3px rgba(37,183,189,.15); }

.sst-btn-pri, .sst-btn-pri-sm {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 0 13px; height: 36px; border-radius: 9px;
  background: linear-gradient(135deg, ${TEAL} 0%, ${TEAL_OSC} 100%);
  color: #fff; font-weight: 700; font-size: 12.5px;
  border: none; cursor: pointer;
  box-shadow: 0 3px 10px -2px rgba(37,183,189,.45);
}
.sst-btn-pri-sm { height: 30px; padding: 0 10px; font-size: 11.5px; }
.sst-btn-pri:disabled { opacity: .55; cursor: not-allowed; }

.sst-btn-ghost {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 5px 9px; border-radius: 7px;
  background: transparent; color: #475569; border: 1px solid #e2e8f0;
  cursor: pointer; font-size: 12px; font-weight: 600; margin-left: 4px;
}
.sst-btn-ghost:hover { background: #e8f7f7; color: ${TEAL_DEEP}; border-color: #b2e4e5; }
.sst-danger:hover { background: #fee2e2; color: #b91c1c; border-color: #fecaca; }

.sst-tabla { width: 100%; border-collapse: collapse; font-size: 12.5px; }
.sst-tabla th {
  padding: 9px 14px; text-align: left; font-weight: 700; font-size: 10.5px;
  text-transform: uppercase; letter-spacing: .05em; color: #475569; background: #f8fafc;
}
.sst-tabla td { padding: 9px 14px; color: #334155; border-top: 1px solid #f1f5f9; }

.sst-pill-ok, .sst-pill-gris, .sst-pill-teal, .sst-pill-rojo, .sst-pill-ambar {
  font-size: 11px; font-weight: 700; padding: 2px 9px; border-radius: 999px; white-space: nowrap;
}
.sst-pill-ok   { background: #dcfce7; color: #15803d; }
.sst-pill-gris { background: #f1f5f9; color: #64748b; }
.sst-pill-teal { background: #e8f7f7; color: ${TEAL_DEEP}; }
.sst-pill-rojo { background: #fee2e2; color: #b91c1c; }
.sst-pill-ambar{ background: #fef3c7; color: #b45309; }
`;
