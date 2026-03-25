import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { useNavigate } from "react-router-dom";
import Toast from "../components/Toast";
import { ChevronRight } from "lucide-react";

function formatearFecha(d) {
  if (!d) return "—";
  const s = String(d);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s.split("-").reverse().join("-");
  try { return new Date(s).toLocaleDateString("es-CL"); } catch { return s; }
}

export default function CampanasProductos() {
  const navigate = useNavigate();
  const [toast, setToast] = useState(null);
  const [loading, setLoading] = useState(true);
  const [campanas, setCampanas] = useState([]);

  async function cargarCreators(userIds) {
    const ids = Array.from(new Set((userIds || []).filter(Boolean)));
    if (ids.length === 0) return new Map();

    const { data, error } = await supabase
      .from("profiles")
      .select("id,nombre,email")
      .in("id", ids);

    if (error) { console.error("Error cargando profiles:", error); return new Map(); }

    const m = new Map();
    (data || []).forEach((p) => m.set(p.id, p));
    return m;
  }

  async function cargarCampanas() {
    setLoading(true);
    setToast(null);

    try {
      const { data: c, error: e1 } = await supabase
        .from("product_campaigns")
        .select("id,nombre,start_date,end_date,created_at,created_by")
        .order("created_at", { ascending: false });

      if (e1) throw e1;

      const campanasBase = c || [];
      const ids = campanasBase.map((x) => x.id);

      let countsMap = new Map();
      if (ids.length > 0) {
        const { data: items, error: e2 } = await supabase
          .from("product_campaign_items")
          .select("campaign_id")
          .in("campaign_id", ids);

        if (e2) throw e2;
        (items || []).forEach((it) => {
          countsMap.set(it.campaign_id, (countsMap.get(it.campaign_id) || 0) + 1);
        });
      }

      const creatorIds = campanasBase.map((x) => x.created_by).filter(Boolean);
      const creatorsMap = await cargarCreators(creatorIds);

      const normalizado = campanasBase.map((x) => {
        const p = x.created_by ? creatorsMap.get(x.created_by) : null;
        return {
          ...x,
          items_count: countsMap.get(x.id) || 0,
          creador_nombre: p?.nombre || p?.email || "—",
        };
      });

      setCampanas(normalizado);
    } catch (err) {
      console.error(err);
      setToast({ type: "error", message: "Error cargando campañas" });
      setCampanas([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    cargarCampanas();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="page">
      {toast && (
        <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />
      )}

      {/* HEADER */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Campañas de Productos</h1>
          <p className="page-subtitle">{campanas.length} campaña{campanas.length !== 1 ? "s" : ""}</p>
        </div>
        <div className="page-actions">
          <button onClick={cargarCampanas} className="btn btn-secondary">
            Refrescar
          </button>
          <button onClick={() => navigate("/campanas/nueva")} className="btn btn-primary">
            + Nueva Campaña
          </button>
        </div>
      </div>

      {/* TABLA */}
      <div className="table-wrap">
        {loading ? (
          <div style={{ padding: "40px 24px", color: "var(--text-muted)" }}>Cargando…</div>
        ) : (
          <div className="table-scroll" style={{ maxHeight: "calc(100vh - 260px)" }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th>Inicio</th>
                  <th>Fin</th>
                  <th>SKUs</th>
                  <th>Creada por</th>
                  <th style={{ textAlign: "right" }}>Acciones</th>
                </tr>
              </thead>

              <tbody>
                {campanas.length === 0 && (
                  <tr>
                    <td colSpan="6" style={{ textAlign: "center", padding: "60px 0", color: "var(--text-muted)" }}>
                      No hay campañas creadas.
                    </td>
                  </tr>
                )}
                {campanas.map((c) => (
                  <tr key={c.id}>
                    <td style={{ fontWeight: 600 }}>{c.nombre}</td>
                    <td>{formatearFecha(c.start_date)}</td>
                    <td>{formatearFecha(c.end_date)}</td>
                    <td>{c.items_count}</td>
                    <td>{c.creador_nombre}</td>
                    <td style={{ textAlign: "right" }}>
                      <button
                        onClick={() => navigate(`/campanas/editar/${c.id}`)}
                        className="table-link"
                        style={{ border: "none", background: "none", cursor: "pointer" }}
                      >
                        Editar <ChevronRight size={13} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
