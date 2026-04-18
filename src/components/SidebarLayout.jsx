import { Link, useLocation, Outlet } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { api } from "../lib/api";
import { useEffect, useState } from "react";
import { useUnsavedChanges } from "../context/UnsavedChangesContext";
import SessionTracker from "./SessionTracker";
import PresenceTracker from "./PresenceTracker";
import {
  FilePlus,
  ClipboardList,
  FileText,
  Package,
  Users,
  Megaphone,
  TrendingUp,
  Target,
  BarChart2,
  Activity,
  UserCog,
  LogOut,
  CreditCard,
} from "lucide-react";

const ROLE_LABELS = {
  admin:       "Administrador",
  jefe_ventas: "Jefe de Ventas",
  ventas:      "Ventas",
};

function labelRol(rol) {
  if (!rol) return "Usuario";
  const key = String(rol).trim();
  return ROLE_LABELS[key] || key;
}

export default function SidebarLayout() {
  const location = useLocation();
  const [perfil, setPerfil] = useState(null);
  const { requestNavigation } = useUnsavedChanges();

  const isActive = (path) =>
    location.pathname === path || location.pathname.startsWith(`${path}/`);

  function onNavClick(e, to) {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    requestNavigation(to);
  }

  useEffect(() => {
    async function cargarPerfil() {
      let perfilDB;
      try {
        perfilDB = await api.get("/auth/profile");
      } catch {
        return;
      }
      if (!perfilDB) return;

      const nombre = perfilDB?.nombre || perfilDB?.email;
      const rolDB = perfilDB?.rol || "usuario";

      setPerfil({
        nombre,
        rol: rolDB,
        rolLabel: labelRol(rolDB),
        email: perfilDB?.email || "",
      });
    }

    cargarPerfil();
  }, []);

  async function cerrarSesion() {
    try {
      const ch = window.__presenceChannel;
      if (ch) {
        await ch.untrack();
        supabase.removeChannel(ch);
      }
    } catch {
      // best effort
    }
    await supabase.auth.signOut();
    window.location.href = "/login";
  }

  const rolNorm = (perfil?.rol || "").toString().trim().toLowerCase();
  const esAdmin = rolNorm === "admin";
  const esJefatura = ["jefe_ventas", "jefe ventas", "jefe-ventas", "jefe de ventas"].includes(rolNorm);
  const esVentas = rolNorm === "ventas";
  const puedeVerVentas = esAdmin || esJefatura || esVentas;
  const puedeVerMetas = esAdmin || esJefatura || esVentas;

  const coreNav = [
    { to: "/listar",            icon: ClipboardList, label: "Cotizaciones" },
    { to: "/crear",             icon: FilePlus,      label: "Nueva Cotización" },
    esAdmin && { to: "/trazabilidad",      icon: FileText,   label: "Trazabilidad" },
    esAdmin && { to: "/seguimiento-pagos", icon: CreditCard, label: "Seguimiento de Pagos" },
    { to: "/productos",         icon: Package,       label: "Productos" },
    { to: "/clientes",          icon: Users,         label: "Clientes" },
    { to: "/campanas",          icon: Megaphone,     label: "Campañas" },
  ].filter(Boolean);

  const reportNav = [
    puedeVerVentas && { to: "/ventas", icon: TrendingUp, label: "Ventas" },
    puedeVerMetas  && { to: "/metas",  icon: Target,     label: "Metas" },
    (esAdmin || esJefatura) && { to: "/metas-canal", icon: BarChart2, label: "Metas por Canal" },
  ].filter(Boolean);

  const adminNav = [
    esAdmin && { to: "/monitoreo", icon: Activity, label: "Monitoreo de Usuarios" },
    esAdmin && { to: "/usuarios",  icon: UserCog,  label: "Usuarios" },
  ].filter(Boolean);

  function NavGroup({ label, items }) {
    if (items.length === 0) return null;
    return (
      <div className="nav-group">
        {label && <div className="nav-group-label">{label}</div>}
        {items.map(({ to, icon: Icon, label: itemLabel }) => (
          <Link
            key={to}
            to={to}
            onClick={(e) => onNavClick(e, to)}
            className={`nav-item ${isActive(to) ? "is-active" : ""}`}
          >
            <Icon size={16} className="nav-icon" />
            {itemLabel}
          </Link>
        ))}
      </div>
    );
  }

  return (
    <div className="app-shell">
      <SessionTracker />
      <PresenceTracker />

      <aside className="sidebar">
        {/* Brand */}
        <div className="brand">
          <div className="brand-logo-wrap">
            <img
              className="brand-logo"
              src="https://amsodentmedical.cl/wp-content/uploads/2025/12/Amsodent-1.png"
              alt="Amsodent"
            />
          </div>
        </div>

        {/* Navigation */}
        <NavGroup label="Operaciones" items={coreNav} />
        {reportNav.length > 0 && <NavGroup label="Reportes" items={reportNav} />}
        {adminNav.length > 0 && <NavGroup label="Administración" items={adminNav} />}

        {/* User section */}
        {perfil && (
          <div className="sidebar-user">
            <div className="user-avatar">
              {String(perfil.nombre || "U").charAt(0).toUpperCase()}
            </div>
            <div className="user-info">
              <div className="user-name">{perfil.nombre}</div>
              <div className="user-role">{perfil.rolLabel}</div>
            </div>
            <button
              className="logout-btn"
              onClick={cerrarSesion}
              title="Cerrar sesión"
            >
              <LogOut size={14} />
            </button>
          </div>
        )}
      </aside>

      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}
