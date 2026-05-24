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
  Gift,
  MessagesSquare,
  Mail,
  ChevronLeft,
} from "lucide-react";
import NotificacionesMenu from "./NotificacionesMenu";
import RecordatoriosCorreo from "./RecordatoriosCorreo";
import GoogleAuthSync from "./GoogleAuthSync";
import DamarIAWidget from "./DamarIAWidget";

const ROLE_LABELS = {
  admin:                "Administrador",
  jefe_ventas:          "Jefe de Ventas",
  jefe_ventas_especial: "Jefe de Ventas Especial",
  ventas:               "Ventas",
  ventas_especial:      "Ventas Especial",
  contabilidad:         "Contabilidad",
};

function labelRol(rol) {
  if (!rol) return "Usuario";
  const key = String(rol).trim();
  return ROLE_LABELS[key] || key;
}

export default function SidebarLayout() {
  const location = useLocation();
  const [perfil, setPerfil] = useState(null);
  const [colapsada, setColapsada] = useState(() => {
    try {
      return localStorage.getItem("sidebar_collapsed") === "1";
    } catch {
      return false;
    }
  });
  const { requestNavigation } = useUnsavedChanges();

  function toggleSidebar() {
    setColapsada((v) => {
      const nuevo = !v;
      try {
        localStorage.setItem("sidebar_collapsed", nuevo ? "1" : "0");
      } catch {
        // ignore
      }
      return nuevo;
    });
  }

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
  const esJefatura = ["jefe_ventas", "jefe ventas", "jefe-ventas", "jefe de ventas", "jefe_ventas_especial"].includes(rolNorm);
  const esJefeVentasEspecial = rolNorm === "jefe_ventas_especial";
  const esContabilidad = rolNorm === "contabilidad";
  const esVentas = rolNorm === "ventas" || rolNorm === "ventas_especial";
  const esVentasEspecial = rolNorm === "ventas_especial";
  const puedeVerVentas = esAdmin || esJefatura || esVentas || esContabilidad;
  const puedeVerMetas = esAdmin || esJefatura || esVentas || esContabilidad;

  const comercialNav = [
    { to: "/listar",      icon: ClipboardList, label: "Cotizaciones" },
    { to: "/crear",       icon: FilePlus,      label: "Nueva Cotización" },
    { to: "/clientes",    icon: Users,         label: "Clientes" },
    { to: "/productos",   icon: Package,       label: "Productos" },
    { to: "/campanas",    icon: Megaphone,     label: "Campañas" },
  ].filter(Boolean);

  const postVentaNav = [
    (esAdmin || esJefatura || esContabilidad) && { to: "/trazabilidad",      icon: FileText,   label: "Trazabilidad" },
    (esAdmin || esJefeVentasEspecial || esContabilidad) && { to: "/seguimiento-pagos", icon: CreditCard, label: "Seguimiento de Pagos" },
  ].filter(Boolean);

  const comunicacionNav = [
    esAdmin && { to: "/buzon",                 icon: Mail,          label: "Mi Correo" },
    esAdmin && { to: "/bitacora-cotizaciones", icon: MessagesSquare, label: "Chat Grupal" },
  ].filter(Boolean);

  const reportNav = [
    puedeVerVentas && { to: "/ventas", icon: TrendingUp, label: "Ventas" },
    puedeVerMetas  && { to: "/metas",  icon: Target,     label: "Metas" },
    (esAdmin || esJefatura || esContabilidad) && { to: "/metas-canal", icon: BarChart2, label: "Metas por Canal" },
  ].filter(Boolean);

  const herramientasNav = [
    (esAdmin || esVentasEspecial) && { to: "/sorteo-registros", icon: Gift, label: "Sorteo" },
  ].filter(Boolean);

  const adminNav = [
    esAdmin && { to: "/usuarios",  icon: UserCog,  label: "Usuarios" },
    esAdmin && { to: "/monitoreo", icon: Activity, label: "Monitoreo de Usuarios" },
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
            data-label={itemLabel}
            title={itemLabel}
          >
            <Icon size={16} className="nav-icon" />
            <span className="nav-item-label">{itemLabel}</span>
          </Link>
        ))}
      </div>
    );
  }

  return (
    <div className={`app-shell ${colapsada ? "is-collapsed" : ""}`}>
      <SessionTracker />
      <PresenceTracker />
      <GoogleAuthSync />
      <RecordatoriosCorreo />
      {esAdmin && <DamarIAWidget />}

      <button
        type="button"
        className="sidebar-toggle"
        onClick={toggleSidebar}
        title={colapsada ? "Expandir menú" : "Colapsar menú"}
        aria-label={colapsada ? "Expandir menú" : "Colapsar menú"}
      >
        <ChevronLeft size={16} strokeWidth={2.5} />
      </button>

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
        <NavGroup label="Comercial" items={comercialNav} />
        {postVentaNav.length > 0 && <NavGroup label="Post-Venta" items={postVentaNav} />}
        <NavGroup label="Comunicación" items={comunicacionNav} />
        {reportNav.length > 0 && <NavGroup label="Reportes" items={reportNav} />}
        {herramientasNav.length > 0 && <NavGroup label="Herramientas" items={herramientasNav} />}
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
            <NotificacionesMenu />
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
