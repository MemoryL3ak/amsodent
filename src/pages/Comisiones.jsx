// Comisiones.jsx
// Configuración del módulo de comisiones POR PERFIL de ejecutivo (un perfil por
// cada canal de Metas: terreno, mixto, mercado público, etc.). Cada perfil tiene
// sus propias 4 tablas de referencia: Venta, Margen, Productividad y Conversión
// de adjudicación. Solo admin y jefe_ventas.
// Fórmula: (Venta + Productividad) × Margen × Conversión.
import { useEffect, useState } from "react";
import { api } from "../lib/api";
import useAuth from "../hooks/useAuth";
import { Save, Plus, Trash2, BarChart3, DollarSign, TrendingUp, Target, Settings, Users, Copy } from "lucide-react";
import ComisionesCalculo from "./ComisionesCalculo";
import { CANALES, CANAL_LABELS } from "../lib/canales";

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

const TABLAS_VACIAS = { venta: [], margen: [], productividad: [], conversion: [] };

// Normaliza el set de 4 tablas de un perfil (tolera datos parciales).
function normTablas(t) {
  return {
    venta: Array.isArray(t?.venta) ? t.venta : [],
    margen: Array.isArray(t?.margen) ? t.margen : [],
    productividad: Array.isArray(t?.productividad) ? t.productividad : [],
    conversion: Array.isArray(t?.conversion) ? t.conversion : [],
  };
}

// Construye el mapa { canal: tablas } desde la config guardada. Compatibilidad:
// si aún no existe `perfiles` (config antigua de un solo esquema), cada canal
// parte con una copia de las tablas legacy para no arrancar de cero.
function perfilesDesdeConfig(c) {
  const legacy = normTablas(c);
  const guardados = c?.perfiles && typeof c.perfiles === "object" ? c.perfiles : null;
  const out = {};
  CANALES.forEach((canal) => {
    out[canal] = guardados?.[canal]
      ? normTablas(guardados[canal])
      : JSON.parse(JSON.stringify(legacy));
  });
  return out;
}

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
  const [perfiles, setPerfiles] = useState({}); // { canal: { venta, margen, productividad, conversion } }
  const [perfilActivo, setPerfilActivo] = useState(CANALES[0]);
  const [loading, setLoading] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [toast, setToast] = useState(null);
  const [tab, setTab] = useState("config"); // "config" | "calculo"

  const tablas = perfiles[perfilActivo] || TABLAS_VACIAS;
  const setTablaPerfil = (key, filas) =>
    setPerfiles((p) => ({ ...p, [perfilActivo]: { ...normTablas(p[perfilActivo]), [key]: filas } }));

  useEffect(() => {
    if (cargando || !puedeVer) { if (!cargando) setLoading(false); return; }
    let activo = true;
    (async () => {
      try {
        const r = await api.get("/comisiones/config");
        if (!activo) return;
        const c = r?.config || {};
        setNombre(r?.nombre || c.nombre || "Ejecutivo Licitación Pública y privado");
        setPerfiles(perfilesDesdeConfig(c));
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
      // Se guarda el mapa de perfiles y, por compatibilidad, las tablas del
      // perfil activo también en el nivel raíz (formato legacy).
      const act = normTablas(perfiles[perfilActivo]);
      await api.put("/comisiones/config", {
        nombre,
        config: {
          formula: "(Venta + Productividad) × Margen × Conversión",
          perfiles,
          venta: act.venta,
          margen: act.margen,
          productividad: act.productividad,
          conversion: act.conversion,
        },
      });
      setToast({ type: "success", message: "Configuración de comisiones guardada (todos los perfiles)." });
    } catch (e) {
      console.error(e);
      setToast({ type: "error", message: "No se pudo guardar." });
    } finally {
      setGuardando(false);
    }
  }

  // Copia las 4 tablas de otro perfil hacia el perfil activo.
  function copiarDesde(canalOrigen) {
    if (!canalOrigen || canalOrigen === perfilActivo) return;
    setPerfiles((p) => ({
      ...p,
      [perfilActivo]: JSON.parse(JSON.stringify(normTablas(p[canalOrigen]))),
    }));
    setToast({ type: "success", message: `Tablas copiadas desde «${CANAL_LABELS[canalOrigen]}». Recuerda guardar.` });
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
        <ComisionesCalculo perfiles={perfiles} />
      ) : (
      <>
      {/* Fórmula */}
      <div className="surface" style={{ marginBottom: 16, padding: "12px 16px", background: "#eef6ff", border: "1px solid #bfdbfe", color: "#1e40af", fontSize: 13 }}>
        <strong>Fórmula de comisión:</strong> (Venta + Productividad) × Margen × Conversión.
        <span style={{ color: "#3b5b8c" }}> La columna <strong>Desde</strong> es el umbral mínimo real de cada tramo (venta en $, productividad en N° de actividades, margen y conversión en %). El cálculo por vendedor usa estos umbrales, según el perfil (canal) de cada vendedor.</span>
      </div>

      {/* Selector de perfil de ejecutivo (un set de tablas por canal de Metas) */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 16 }}>
        {CANALES.map((canal) => {
          const activo = canal === perfilActivo;
          return (
            <button
              key={canal}
              type="button"
              onClick={() => setPerfilActivo(canal)}
              style={{
                fontSize: 12.5, fontWeight: 700, padding: "6px 13px", borderRadius: 999, cursor: "pointer",
                background: activo ? "var(--primary)" : "var(--surface)",
                color: activo ? "#fff" : "var(--text-muted)",
                border: `1px solid ${activo ? "var(--primary)" : "var(--border)"}`,
              }}
            >
              {CANAL_LABELS[canal]}
            </button>
          );
        })}
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, marginLeft: "auto", fontSize: 12, color: "var(--text-muted)" }}>
          <Copy size={13} /> Copiar desde
          <select className="input" defaultValue="" onChange={(e) => { copiarDesde(e.target.value); e.target.value = ""; }} style={{ minWidth: 180, padding: "4px 8px", fontSize: 12.5 }}>
            <option value="" disabled>Elegir perfil…</option>
            {CANALES.filter((c) => c !== perfilActivo).map((c) => (
              <option key={c} value={c}>{CANAL_LABELS[c]}</option>
            ))}
          </select>
        </span>
      </div>

      {loading ? (
        <div className="surface" style={{ padding: "40px 24px", color: "var(--text-muted)" }}>Cargando…</div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 16 }}>
          <TablaComision titulo={`Tabla de venta — ${CANAL_LABELS[perfilActivo]}`} color="#2563eb" icon={BarChart3}
            cols={COLS.venta} filas={tablas.venta} onChange={(f) => setTablaPerfil("venta", f)} />
          <TablaComision titulo={`Tabla de margen — ${CANAL_LABELS[perfilActivo]}`} color="#0d9488" icon={DollarSign}
            cols={COLS.margen} filas={tablas.margen} onChange={(f) => setTablaPerfil("margen", f)} />
          <TablaComision titulo={`Tabla de productividad — ${CANAL_LABELS[perfilActivo]}`} color="#7c3aed" icon={TrendingUp}
            cols={COLS.productividad} filas={tablas.productividad} onChange={(f) => setTablaPerfil("productividad", f)} />
          <TablaComision titulo={`Tabla de conversión de adjudicación — ${CANAL_LABELS[perfilActivo]}`} color="#1e3a8a" icon={Target}
            cols={COLS.conversion} filas={tablas.conversion} onChange={(f) => setTablaPerfil("conversion", f)} />
        </div>
      )}

      {/* Vista previa de valores (formato) */}
      {!loading && (
        <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 14 }}>
          Cada perfil (canal) guarda sus propias 4 tablas; «Guardar cambios» persiste todos los perfiles a la vez.
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
