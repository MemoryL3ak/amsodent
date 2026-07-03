// Comisiones.jsx
// Configuración del módulo de comisiones (esquema "Ejecutivo Licitación Pública
// y privado"). Edita las 4 tablas de referencia: Venta, Margen, Productividad y
// Conversión de adjudicación. Solo admin y jefe_ventas.
// Fórmula (etapa posterior): (Venta + Productividad) × Margen × Conversión.
import { useEffect, useState } from "react";
import { api } from "../lib/api";
import useAuth from "../hooks/useAuth";
import { Save, Plus, Trash2, BarChart3, DollarSign, TrendingUp, Target, Settings, Users } from "lucide-react";
import ComisionesCalculo from "./ComisionesCalculo";

const fmtCLP = (v) => `$${Number(v || 0).toLocaleString("es-CL")}`;

// Definición de columnas de cada tabla. La columna "Desde" es el umbral mínimo
// (en la unidad real de la métrica) para caer en ese tramo — la usa el cálculo
// por vendedor. Unidad: venta = CLP · productividad = N° actividades ·
// margen y conversión = % real.
const COLS = {
  venta: [
    { key: "tramo", label: "Tramo", type: "text" },
    { key: "desde", label: "Desde ($)", type: "money" },
    { key: "monto", label: "Full", type: "money" },
  ],
  margen: [
    { key: "tramo", label: "Tramo", type: "text" },
    { key: "desde", label: "Desde (%)", type: "mult" },
    { key: "multiplicador", label: "Multiplicador", type: "mult" },
    { key: "meta", label: "META", type: "text" },
  ],
  productividad: [
    { key: "tramo", label: "Tramo", type: "text" },
    { key: "desde", label: "Desde (N°)", type: "money" },
    { key: "monto", label: "Full", type: "money" },
    { key: "meta", label: "META", type: "text" },
  ],
  conversion: [
    { key: "tramo", label: "Tramo", type: "text" },
    { key: "desde", label: "Desde (%)", type: "mult" },
    { key: "multiplicador", label: "Multiplicador", type: "mult" },
    { key: "meta", label: "META", type: "text" },
  ],
};

const filaVacia = (cols) => Object.fromEntries(cols.map((c) => [c.key, c.type === "text" ? "" : 0]));

function TablaComision({ titulo, color, icon: Icon, cols, filas, onChange }) {
  function setCelda(i, key, valor) {
    onChange(filas.map((f, idx) => (idx === i ? { ...f, [key]: valor } : f)));
  }
  const addFila = () => onChange([...filas, filaVacia(cols)]);
  const delFila = (i) => onChange(filas.filter((_, idx) => idx !== i));

  return (
    <div className="surface" style={{ padding: 0, overflow: "hidden", borderTop: `3px solid ${color}` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 16px", borderBottom: "1px solid var(--border)" }}>
        <span style={{ width: 26, height: 26, borderRadius: 7, background: `${color}18`, color, display: "grid", placeItems: "center" }}>
          <Icon size={15} />
        </span>
        <strong style={{ fontSize: 14, color: "var(--text)" }}>{titulo}</strong>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table className="data-table" style={{ width: "100%" }}>
          <thead>
            <tr>
              {cols.map((c) => <th key={c.key} style={{ textAlign: "left", color, background: `${color}0e` }}>{c.label}</th>)}
              <th style={{ width: 40, background: `${color}0e` }}></th>
            </tr>
          </thead>
          <tbody>
            {filas.map((f, i) => (
              <tr key={i}>
                {cols.map((c) => (
                  <td key={c.key}>
                    {c.type === "text" ? (
                      <input className="input" value={f[c.key] ?? ""} onChange={(e) => setCelda(i, c.key, e.target.value)} style={{ minWidth: 90 }} />
                    ) : (
                      <input type="number" className="input" step={c.type === "mult" ? "0.1" : "1"} min="0"
                        value={f[c.key] ?? 0} onChange={(e) => setCelda(i, c.key, Number(e.target.value))}
                        style={{ minWidth: 90, textAlign: "right" }} />
                    )}
                  </td>
                ))}
                <td style={{ textAlign: "center" }}>
                  <button className="btn btn-sm btn-ghost" onClick={() => delFila(i)} title="Quitar fila" style={{ padding: 6, lineHeight: 0 }}>
                    <Trash2 size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ padding: "8px 16px", borderTop: "1px solid var(--border)" }}>
        <button className="btn btn-sm btn-ghost" onClick={addFila} style={{ display: "inline-flex", alignItems: "center", gap: 5, color }}>
          <Plus size={14} /> Agregar tramo
        </button>
      </div>
    </div>
  );
}

export default function Comisiones() {
  const { rol, cargando } = useAuth();
  const rolNorm = (rol || "").toString().trim().toLowerCase();
  const puedeVer = ["admin", "administrador", "jefe_ventas"].includes(rolNorm);

  const [nombre, setNombre] = useState("");
  const [tablas, setTablas] = useState({ venta: [], margen: [], productividad: [], conversion: [] });
  const [loading, setLoading] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [toast, setToast] = useState(null);
  const [tab, setTab] = useState("config"); // "config" | "calculo"

  useEffect(() => {
    if (cargando || !puedeVer) { if (!cargando) setLoading(false); return; }
    let activo = true;
    (async () => {
      try {
        const r = await api.get("/comisiones/config");
        if (!activo) return;
        const c = r?.config || {};
        setNombre(r?.nombre || c.nombre || "Ejecutivo Licitación Pública y privado");
        setTablas({
          venta: Array.isArray(c.venta) ? c.venta : [],
          margen: Array.isArray(c.margen) ? c.margen : [],
          productividad: Array.isArray(c.productividad) ? c.productividad : [],
          conversion: Array.isArray(c.conversion) ? c.conversion : [],
        });
      } catch (e) {
        console.error(e);
        if (activo) setToast({ type: "error", message: "No se pudo cargar la configuración. ¿Está aplicada la migración?" });
      } finally {
        if (activo) setLoading(false);
      }
    })();
    return () => { activo = false; };
  }, [cargando, puedeVer]);

  async function guardar() {
    setGuardando(true);
    try {
      await api.put("/comisiones/config", {
        nombre,
        config: {
          formula: "(Venta + Productividad) × Margen × Conversión",
          venta: tablas.venta,
          margen: tablas.margen,
          productividad: tablas.productividad,
          conversion: tablas.conversion,
        },
      });
      setToast({ type: "success", message: "Configuración de comisiones guardada." });
    } catch (e) {
      console.error(e);
      setToast({ type: "error", message: "No se pudo guardar." });
    } finally {
      setGuardando(false);
    }
  }

  if (!cargando && !puedeVer) {
    return (
      <div className="page">
        <div className="surface"><div className="surface-body" style={{ color: "var(--danger)" }}>
          Acceso restringido: la configuración de comisiones es para administración y jefe de ventas.
        </div></div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-header" style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div>
          <h1 className="page-title">Comisiones</h1>
          <p className="page-subtitle">{nombre}</p>
        </div>
        {tab === "config" && (
          <button className="btn btn-primary" onClick={guardar} disabled={guardando || loading} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <Save size={15} /> {guardando ? "Guardando…" : "Guardar cambios"}
          </button>
        )}
      </div>

      {/* Pestañas */}
      <div style={{ display: "flex", gap: 4, borderBottom: "1px solid var(--border)", marginBottom: 18 }}>
        {[
          { key: "config", label: "Configuración", icon: Settings },
          { key: "calculo", label: "Cálculo por vendedor", icon: Users },
        ].map((t) => {
          const activo = tab === t.key;
          return (
            <button key={t.key} onClick={() => setTab(t.key)}
              style={{
                display: "inline-flex", alignItems: "center", gap: 6, padding: "9px 16px",
                border: "none", background: "none", cursor: "pointer", fontSize: 13.5, fontWeight: 600,
                color: activo ? "var(--primary)" : "var(--text-muted)",
                borderBottom: `2px solid ${activo ? "var(--primary)" : "transparent"}`, marginBottom: -1,
              }}>
              <t.icon size={15} /> {t.label}
            </button>
          );
        })}
      </div>

      {tab === "calculo" ? (
        <ComisionesCalculo tablas={tablas} />
      ) : (
      <>
      {/* Fórmula */}
      <div className="surface" style={{ marginBottom: 16, padding: "12px 16px", background: "#eef6ff", border: "1px solid #bfdbfe", color: "#1e40af", fontSize: 13 }}>
        <strong>Fórmula de comisión:</strong> (Venta + Productividad) × Margen × Conversión.
        <span style={{ color: "#3b5b8c" }}> La columna <strong>Desde</strong> es el umbral mínimo real de cada tramo (venta en $, productividad en N° de actividades, margen y conversión en %). El cálculo por vendedor usa estos umbrales.</span>
      </div>

      {loading ? (
        <div className="surface" style={{ padding: "40px 24px", color: "var(--text-muted)" }}>Cargando…</div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 16 }}>
          <TablaComision titulo="Tabla de venta" color="#2563eb" icon={BarChart3}
            cols={COLS.venta} filas={tablas.venta} onChange={(f) => setTablas((t) => ({ ...t, venta: f }))} />
          <TablaComision titulo="Tabla de margen" color="#0d9488" icon={DollarSign}
            cols={COLS.margen} filas={tablas.margen} onChange={(f) => setTablas((t) => ({ ...t, margen: f }))} />
          <TablaComision titulo="Tabla de productividad" color="#7c3aed" icon={TrendingUp}
            cols={COLS.productividad} filas={tablas.productividad} onChange={(f) => setTablas((t) => ({ ...t, productividad: f }))} />
          <TablaComision titulo="Tabla de conversión de adjudicación" color="#1e3a8a" icon={Target}
            cols={COLS.conversion} filas={tablas.conversion} onChange={(f) => setTablas((t) => ({ ...t, conversion: f }))} />
        </div>
      )}

      {/* Vista previa de valores (formato) */}
      {!loading && (
        <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 14 }}>
          Los montos se guardan como número (ej. 250000 → {fmtCLP(250000)}). Los multiplicadores admiten decimales (ej. 1,1). La columna META es descriptiva del umbral de cada tramo.
        </p>
      )}
      </>
      )}

      {toast && (
        <div onClick={() => setToast(null)}
          style={{
            position: "fixed", bottom: 22, right: 22, zIndex: 12000, cursor: "pointer",
            background: toast.type === "error" ? "#fef2f2" : "#f0fdf4",
            border: `1px solid ${toast.type === "error" ? "#fecaca" : "#bbf7d0"}`,
            color: toast.type === "error" ? "#b91c1c" : "#15803d",
            padding: "12px 16px", borderRadius: 10, fontSize: 13, fontWeight: 600, boxShadow: "var(--shadow-lg)",
          }}>
          {toast.message}
        </div>
      )}
    </div>
  );
}
