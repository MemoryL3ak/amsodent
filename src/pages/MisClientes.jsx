import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import useAuth from "../hooks/useAuth";
import Avatar from "../components/Avatar";
import Toast from "../components/Toast";
import { Search, MapPin, IdCard, ArrowRight } from "lucide-react";

export default function MisClientes() {
  const { user } = useAuth();
  const miEmail = (user?.email || "").trim().toLowerCase();

  const [clientes, setClientes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busqueda, setBusqueda] = useState("");
  const [toast, setToast] = useState(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const data = await api.get("/clientes");
        setClientes(Array.isArray(data) ? data : []);
      } catch (e) {
        console.error(e);
        setToast({ type: "error", message: "No se pudieron cargar los clientes." });
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const mios = useMemo(
    () => clientes.filter((c) => String(c.vendedor_asignado || "").trim().toLowerCase() === miEmail),
    [clientes, miEmail],
  );

  const filtrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    if (!q) return mios;
    return mios.filter((c) =>
      [c.nombre, c.rut, c.comuna, c.region, c.email].some((v) => String(v || "").toLowerCase().includes(q)),
    );
  }, [mios, busqueda]);

  return (
    <div className="page">
      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}

      <div className="page-header">
        <div>
          <h1 className="page-title">Mis clientes</h1>
          <p className="page-subtitle">Clientes asignados a ti · {mios.length} en total</p>
        </div>
      </div>

      <div className="filter-bar" style={{ marginBottom: 16 }}>
        <div className="filter-field" style={{ flex: 1, minWidth: 240 }}>
          <label className="filter-label"><Search size={11} style={{ marginRight: 4 }} />Buscar</label>
          <input
            className="input"
            placeholder="Nombre, RUT, comuna…"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
          />
        </div>
      </div>

      {loading ? (
        <div className="surface" style={{ padding: "40px 24px", color: "var(--text-muted)" }}>Cargando…</div>
      ) : filtrados.length === 0 ? (
        <div className="surface" style={{ padding: "48px 24px", textAlign: "center", color: "var(--text-muted)" }}>
          {mios.length === 0
            ? "No tienes clientes asignados todavía."
            : "Ningún cliente coincide con la búsqueda."}
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 14 }}>
          {filtrados.map((c) => (
            <Link
              key={c.id}
              to={`/clientes/${c.id}`}
              className="surface"
              style={{ textDecoration: "none", padding: 16, display: "flex", flexDirection: "column", gap: 12 }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <Avatar src={c.foto_url} nombre={c.nombre} size={48} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 14.5, fontWeight: 700, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={c.nombre}>
                    {c.nombre}
                  </div>
                  <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>{c.tipo_cliente || "—"}</div>
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 12.5, color: "var(--text-soft)" }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><IdCard size={13} /> {c.rut || "—"}</span>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><MapPin size={13} /> {[c.comuna, c.region].filter(Boolean).join(", ") || "—"}</span>
              </div>
              <div style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12.5, fontWeight: 600, color: "var(--primary-dark)", marginTop: "auto" }}>
                Ver perfil 360° <ArrowRight size={14} />
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
