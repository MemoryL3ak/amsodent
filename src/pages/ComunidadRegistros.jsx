import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import * as XLSX from "xlsx";
import QRCode from "qrcode";
import Toast from "../components/Toast";
import ConfirmModal from "../components/ConfirmModal";
import {
  HeartHandshake,
  QrCode,
  Download,
  Copy,
  Mail,
  Trash2,
  RefreshCw,
  FileSpreadsheet,
  GraduationCap,
  Stethoscope,
} from "lucide-react";

/* ============================================================
   Submódulo ADMIN de la Comunidad Amsodent (/comunidad-registros).
   ─ Tarjeta QR: genera el código con el link al portal público
     /comunidad (la gente lo escanea y llena el formulario).
   ─ Registros: KPIs, filtros, tabla, reenvío del correo de
     bienvenida y export a Excel.
============================================================ */

export default function ComunidadRegistros() {
  const [registros, setRegistros] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [toast, setToast] = useState(null);
  const [urlPortal, setUrlPortal] = useState("");
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [mostrarQR, setMostrarQR] = useState(false);
  const [reenviando, setReenviando] = useState(null);
  const [aEliminar, setAEliminar] = useState(null);

  // Filtros
  const [buscar, setBuscar] = useState("");
  const [fPerfil, setFPerfil] = useState("");
  const [fDesde, setFDesde] = useState("");
  const [fHasta, setFHasta] = useState("");

  async function cargar() {
    setCargando(true);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      if (fPerfil && r.perfil !== fPerfil) return false;
      const fecha = String(r.created_at || "").slice(0, 10);
      if (fDesde && fecha < fDesde) return false;
      if (fHasta && fecha > fHasta) return false;
      if (q) {
        const bolsa = [r.nombre, r.apellido, r.correo, r.telefono, r.universidad, r.especialidad, r.ciudad]
          .join(" ")
          .toLowerCase();
        if (!bolsa.includes(q)) return false;
      }
      return true;
    });
  }, [registros, buscar, fPerfil, fDesde, fHasta]);

  const stats = useMemo(() => {
    const total = registros.length;
    const estudiantes = registros.filter((r) => r.perfil === "estudiante").length;
    const dentistas = registros.filter((r) => r.perfil === "dentista").length;
    const enviados = registros.filter((r) => r.correo_enviado).length;
    return { total, estudiantes, dentistas, enviados };
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
    if (reenviando) return;
    setReenviando(r.id);
    try {
      await api.post(`/comunidad/registros/${r.id}/reenviar`, {});
      setToast({ type: "success", message: `Correo de bienvenida reenviado a ${r.correo}.` });
      setRegistros((prev) => prev.map((x) => (x.id === r.id ? { ...x, correo_enviado: true } : x)));
    } catch (e) {
      setToast({ type: "error", message: e?.message || "No se pudo reenviar el correo." });
    } finally {
      setReenviando(null);
    }
  }

  async function eliminar() {
    const r = aEliminar;
    setAEliminar(null);
    if (!r) return;
    try {
      await api.delete(`/comunidad/registros/${r.id}`);
      setRegistros((prev) => prev.filter((x) => x.id !== r.id));
      setToast({ type: "success", message: "Registro eliminado." });
    } catch (e) {
      setToast({ type: "error", message: e?.message || "No se pudo eliminar." });
    }
  }

  function exportarExcel() {
    const filas = filtrados.map((r) => ({
      Nombre: `${r.nombre} ${r.apellido}`,
      Correo: r.correo,
      "Teléfono": r.telefono,
      Perfil: r.perfil === "estudiante" ? "Estudiante" : "Dentista",
      "Año de estudio": r.anio_estudio || "",
      Universidad: r.universidad || "",
      Especialidad: r.especialidad || "",
      Ciudad: r.ciudad || "",
      "Cómo nos conoció": r.como_conociste || "",
      "Evento de origen": r.origen || "",
      "Correo bienvenida": r.correo_enviado ? "Enviado" : "Sin enviar",
      Registro: String(r.created_at || "").slice(0, 16).replace("T", " "),
    }));
    const ws = XLSX.utils.json_to_sheet(filas);
    ws["!cols"] = [
      { wch: 26 }, { wch: 30 }, { wch: 16 }, { wch: 11 }, { wch: 13 },
      { wch: 26 }, { wch: 22 }, { wch: 14 }, { wch: 20 }, { wch: 15 }, { wch: 17 },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Comunidad");
    XLSX.writeFile(wb, "Comunidad_Amsodent.xlsx");
  }

  return (
    <div className="page vista-compacta">
      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}

      <ConfirmModal
        open={!!aEliminar}
        title="Eliminar registro"
        message={`¿Eliminar a ${aEliminar?.nombre || ""} ${aEliminar?.apellido || ""} (${aEliminar?.correo || ""}) de la comunidad? Esta acción no se puede deshacer.`}
        confirmText="Eliminar"
        confirmTone="danger"
        onConfirm={eliminar}
        onCancel={() => setAEliminar(null)}
      />

      <div className="page-header">
        <div>
          <h1 className="page-title">Comunidad Amsodent</h1>
          <p className="page-subtitle">
            Registros del formulario del stand (QR) — hoy apunta al Congreso ADEO Chile 2026
            (U. de Valparaíso); cada registro guarda su evento de origen.
          </p>
        </div>
        <div className="btn-row">
          <button className="btn btn-secondary" onClick={() => setMostrarQR((v) => !v)} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <QrCode size={15} /> {mostrarQR ? "Ocultar QR" : "QR del portal"}
          </button>
          <button className="btn btn-secondary" onClick={exportarExcel} disabled={!filtrados.length} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <FileSpreadsheet size={15} /> Exportar Excel
          </button>
          <button className="btn btn-ghost" onClick={cargar} title="Actualizar" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
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
            Imprímelo o proyéctalo en el stand del congreso: quien lo escanee llega al
            formulario y recibe el correo de bienvenida a la familia Amsodent.
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

      <div className="stats-row" style={{ marginBottom: 16 }}>
        <div className="stat-card">
          <div className="stat-label">Miembros</div>
          <div className="stat-value">{stats.total}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Estudiantes</div>
          <div className="stat-value">{stats.estudiantes}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Dentistas</div>
          <div className="stat-value">{stats.dentistas}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Bienvenidas enviadas</div>
          <div className="stat-value">{stats.enviados}</div>
          <div className="stat-sub">de {stats.total} registros</div>
        </div>
      </div>

      <div className="filter-bar" style={{ marginBottom: 14 }}>
        <div className="filter-field filter-field-ancho">
          <label className="filter-label">Buscar</label>
          <input
            className="input"
            placeholder="Nombre, correo, universidad, especialidad…"
            value={buscar}
            onChange={(e) => setBuscar(e.target.value)}
          />
        </div>
        <div className="filter-field">
          <label className="filter-label">Perfil</label>
          <select className="input" value={fPerfil} onChange={(e) => setFPerfil(e.target.value)}>
            <option value="">Todos</option>
            <option value="estudiante">Estudiantes</option>
            <option value="dentista">Dentistas</option>
          </select>
        </div>
        <div className="filter-field">
          <label className="filter-label">Desde</label>
          <input type="date" className="input" value={fDesde} onChange={(e) => setFDesde(e.target.value)} />
        </div>
        <div className="filter-field">
          <label className="filter-label">Hasta</label>
          <input type="date" className="input" value={fHasta} onChange={(e) => setFHasta(e.target.value)} />
        </div>
        <div className="filter-field">
          <label className="filter-label">&nbsp;</label>
          <div style={{ fontSize: 12.5, color: "var(--text-soft)", height: 36, display: "flex", alignItems: "center" }}>
            {filtrados.length} de {registros.length}
          </div>
        </div>
      </div>

      <div className="table-wrap">
        <div className="table-scroll" style={{ maxHeight: "calc(100vh - 320px)" }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Contacto</th>
                <th>Perfil</th>
                <th>Detalle</th>
                <th>Ciudad</th>
                <th>Nos conoció por</th>
                <th>Bienvenida</th>
                <th>Registro</th>
                <th style={{ width: 90 }}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {cargando ? (
                <tr><td colSpan={9} style={{ textAlign: "center", padding: 28, color: "var(--text-muted)" }}>Cargando…</td></tr>
              ) : filtrados.length === 0 ? (
                <tr><td colSpan={9} style={{ textAlign: "center", padding: 28, color: "var(--text-muted)" }}>
                  {registros.length === 0 ? "Aún no hay registros — comparte el QR para partir." : "Sin resultados para el filtro aplicado."}
                </td></tr>
              ) : (
                filtrados.map((r) => (
                  <tr key={r.id}>
                    <td style={{ fontWeight: 600 }}>{r.nombre} {r.apellido}</td>
                    <td>
                      <div style={{ fontSize: 12.5 }}>{r.correo}</div>
                      <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{r.telefono}</div>
                    </td>
                    <td>
                      {r.perfil === "estudiante" ? (
                        <span className="badge badge-primary" style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                          <GraduationCap size={12} /> Estudiante
                        </span>
                      ) : (
                        <span className="badge badge-success" style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                          <Stethoscope size={12} /> Dentista
                        </span>
                      )}
                    </td>
                    <td style={{ fontSize: 12.5 }}>
                      {r.perfil === "estudiante"
                        ? [r.anio_estudio, r.universidad].filter(Boolean).join(" · ") || "—"
                        : r.especialidad || "—"}
                    </td>
                    <td style={{ fontSize: 12.5 }}>{r.ciudad || "—"}</td>
                    <td style={{ fontSize: 12.5 }}>{r.como_conociste || "—"}</td>
                    <td>
                      {r.correo_enviado ? (
                        <span className="badge badge-success">Enviada</span>
                      ) : (
                        <span className="badge badge-warning">Sin enviar</span>
                      )}
                    </td>
                    <td style={{ fontSize: 12.5, whiteSpace: "nowrap" }}>
                      {String(r.created_at || "").slice(0, 10)}
                    </td>
                    <td>
                      <div style={{ display: "flex", gap: 4 }}>
                        <button
                          className="item-action-btn"
                          title="Reenviar correo de bienvenida"
                          onClick={() => reenviar(r)}
                          disabled={reenviando === r.id}
                        >
                          <Mail size={14} style={reenviando === r.id ? { opacity: 0.4 } : undefined} />
                        </button>
                        <button
                          className="item-action-btn item-action-danger"
                          type="button"
                          title="Eliminar registro"
                          onClick={() => setAEliminar(r)}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
