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
  ChevronDown,
  Clock,
  MapPin,
  Trophy,
  BarChart3,
  SlidersHorizontal,
  Briefcase,
  Truck,
  Headphones,
  Wrench,
  Shield,
  PackageSearch,
  Wallet,
  KeyRound,
  Landmark,
} from "lucide-react";
import NotificacionesMenu from "./NotificacionesMenu";
import RecordatoriosCorreo from "./RecordatoriosCorreo";
import RecordatoriosCierre from "./RecordatoriosCierre";
import GoogleAuthSync from "./GoogleAuthSync";
import DamarIAWidget from "./DamarIAWidget";
import useChatNoLeidos from "../hooks/useChatNoLeidos";

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
      const stored = localStorage.getItem("sidebar_collapsed");
      if (stored !== null) return stored === "1";
      // Sin preferencia guardada: cerrado en mobile (drawer), abierto en desktop.
      if (typeof window !== "undefined" && window.matchMedia) {
        return window.matchMedia("(max-width: 1100px)").matches;
      }
      return false;
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

  const chatNoLeidos = useChatNoLeidos(perfil?.email);

  const rolNorm = (perfil?.rol || "").toString().trim().toLowerCase();
  const esAdmin = rolNorm === "admin";
  const esJefatura = ["jefe_ventas", "jefe ventas", "jefe-ventas", "jefe de ventas", "jefe_ventas_especial"].includes(rolNorm);
  const esJefeVentasEspecial = rolNorm === "jefe_ventas_especial";
  const esJefeVentas = ["jefe_ventas", "jefe ventas", "jefe-ventas", "jefe de ventas"].includes(rolNorm);
  const esContabilidad = rolNorm === "contabilidad";
  const esVentas = rolNorm === "ventas" || rolNorm === "ventas_especial";
  const esVentasEspecial = rolNorm === "ventas_especial";
  // Resumen Comercial: solo admin + jefatura de ventas (no vendedores ni contabilidad).
  const puedeVerResumenComercial = esAdmin || esJefatura;
  const puedeVerMetas = esAdmin || esJefatura || esVentas || esContabilidad;

  const comercialNav = [
    { to: "/listar",      icon: ClipboardList, label: "Cotizaciones" },
    { to: "/crear",       icon: FilePlus,      label: "Nueva Cotización" },
    { to: "/clientes",    icon: Users,         label: "Clientes" },
    { to: "/productos",   icon: Package,       label: "Productos" },
    { to: "/campanas",    icon: Megaphone,     label: "Campañas" },
  ].filter(Boolean);

  const postVentaNav = [
    (esAdmin || esJefeVentasEspecial || esJefeVentas) && { to: "/trazabilidad",      icon: FileText,   label: "Trazabilidad" },
    (esAdmin || esJefeVentasEspecial || esContabilidad) && { to: "/seguimiento-pagos", icon: CreditCard, label: "Seguimiento de Pagos" },
    (esAdmin || esJefeVentasEspecial || esContabilidad) && { to: "/cobranza", icon: Wallet, label: "Cobranza" },
    (esAdmin || esJefeVentasEspecial) && { to: "/factoring", icon: Landmark, label: "Factoring" },
  ].filter(Boolean);

  const comunicacionNav = [
    { to: "/buzon",                 icon: Mail,          label: "Mi Correo" },
    { to: "/bitacora-cotizaciones", icon: MessagesSquare, label: "Chat Grupal", badge: chatNoLeidos },
  ].filter(Boolean);

  const metasNav = [
    puedeVerMetas && { to: "/metas", icon: Target, label: "Metas" },
    (esAdmin || esJefatura || esContabilidad) && { to: "/metas-canal", icon: SlidersHorizontal, label: "Definición de Metas" },
  ].filter(Boolean);

  const reportesNav = [
    puedeVerResumenComercial && { to: "/ventas", icon: TrendingUp, label: "Resumen Comercial" },
    puedeVerResumenComercial && { to: "/cotizaciones-vendedor", icon: BarChart3, label: "Cotizaciones por Vendedor" },
  ].filter(Boolean);

  const herramientasNav = [
    (esAdmin || esVentasEspecial) && { to: "/sorteo-registros", icon: Gift, label: "Sorteo" },
    esAdmin && { to: "/marcaje", icon: Clock, label: "Marcar Asistencia" },
  ].filter(Boolean);

  const logisticaNav = [
    esAdmin && { to: "/despachos-choferes", icon: Truck, label: "Despachos y Choferes" },
    esAdmin && { to: "/tracking-choferes", icon: MapPin, label: "Tracking en Vivo" },
  ].filter(Boolean);

  const portalClienteNav = [
    (esAdmin || esVentasEspecial) && { to: "/monitoreo-stock", icon: PackageSearch, label: "Monitoreo Stock Clientes" },
    esAdmin && { to: "/portal-accesos", icon: KeyRound, label: "Acceso Portal Clientes" },
  ].filter(Boolean);

  const adminNav = [
    esAdmin && { to: "/usuarios",          icon: UserCog,  label: "Usuarios" },
    esAdmin && { to: "/monitoreo",         icon: Activity, label: "Monitoreo de Usuarios" },
    esAdmin && { to: "/monitoreo-marcajes", icon: MapPin,   label: "Monitoreo de Asistencia" },
  ].filter(Boolean);

  function NavGroup({ label, items, collapsible, icon: GroupIcon, storageKey }) {
    if (items.length === 0) return null;

    const algunActivo = items.some(({ to }) => isActive(to));

    // Estado persistido en localStorage. Default abierto.
    const [open, setOpen] = useState(() => {
      if (!collapsible || !storageKey) return true;
      try {
        const stored = localStorage.getItem(storageKey);
        return stored === null ? true : stored === "1";
      } catch {
        return true;
      }
    });

    // `open` es la única fuente de verdad cuando es colapsable — respeta
    // siempre el click del usuario. Si querés feedback visual cuando hay un
    // hijo activo y el grupo está cerrado, lo damos con la clase
    // `has-active-child` en el toggle (ver CSS).
    const isOpen = !collapsible || open;

    function toggle() {
      if (!collapsible) return;
      const next = !open;
      setOpen(next);
      if (storageKey) {
        try { localStorage.setItem(storageKey, next ? "1" : "0"); } catch {}
      }
    }

    const items_node = items.map(({ to, icon: Icon, label: itemLabel, badge }) => (
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
        {badge > 0 && <span className="nav-item-badge">{badge > 99 ? "99+" : badge}</span>}
      </Link>
    ));

    const badgeTotal = items.reduce((acc, it) => acc + (it.badge || 0), 0);

    if (!collapsible) {
      return (
        <div className="nav-group">
          {label && <div className="nav-group-label">{label}</div>}
          {items_node}
        </div>
      );
    }

    return (
      <div className={`nav-group nav-group-collapsible ${isOpen ? "is-open" : ""}`}>
        <button
          type="button"
          className={`nav-group-toggle ${algunActivo && !isOpen ? "has-active-child" : ""}`}
          onClick={toggle}
          title={isOpen ? "Contraer" : "Expandir"}
        >
          {GroupIcon && <GroupIcon size={13} className="nav-group-toggle-icon" />}
          <span className="nav-group-toggle-label">{label}</span>
          {!isOpen && badgeTotal > 0 && (
            <span className="nav-group-unread-badge">{badgeTotal > 99 ? "99+" : badgeTotal}</span>
          )}
          {algunActivo && <span className="nav-group-active-dot" aria-hidden />}
          <ChevronDown size={12} strokeWidth={2.8} className="nav-group-chevron" />
        </button>
        <div className="nav-group-items">
          <div className="nav-group-items-inner">{items_node}</div>
        </div>
      </div>
    );
  }

  return (
    <div className={`app-shell ${colapsada ? "is-collapsed" : ""}`}>
      <SessionTracker />
      <PresenceTracker />
      <GoogleAuthSync />
      <RecordatoriosCorreo />
      <RecordatoriosCierre />
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

        {/* Navigation — todos los grupos son colapsables con persistencia */}
        <NavGroup
          label="Comercial"
          items={comercialNav}
          collapsible
          icon={Briefcase}
          storageKey="sidebar_group_comercial"
        />
        {postVentaNav.length > 0 && (
          <NavGroup
            label="Post-Venta"
            items={postVentaNav}
            collapsible
            icon={Truck}
            storageKey="sidebar_group_postventa"
          />
        )}
        {comunicacionNav.length > 0 && (
          <NavGroup
            label="Comunicación"
            items={comunicacionNav}
            collapsible
            icon={Headphones}
            storageKey="sidebar_group_comunicacion"
          />
        )}
        {metasNav.length > 0 && (
          <NavGroup
            label="Metas"
            items={metasNav}
            collapsible
            icon={Trophy}
            storageKey="sidebar_group_metas"
          />
        )}
        {reportesNav.length > 0 && (
          <NavGroup
            label="Reportes"
            items={reportesNav}
            collapsible
            icon={BarChart3}
            storageKey="sidebar_group_reportes"
          />
        )}
        {herramientasNav.length > 0 && (
          <NavGroup
            label="Herramientas"
            items={herramientasNav}
            collapsible
            icon={Wrench}
            storageKey="sidebar_group_herramientas"
          />
        )}
        {logisticaNav.length > 0 && (
          <NavGroup
            label="Logística"
            items={logisticaNav}
            collapsible
            icon={Truck}
            storageKey="sidebar_group_logistica"
          />
        )}
        {portalClienteNav.length > 0 && (
          <NavGroup
            label="Portal del Cliente"
            items={portalClienteNav}
            collapsible
            icon={PackageSearch}
            storageKey="sidebar_group_portal_cliente"
          />
        )}
        {adminNav.length > 0 && (
          <NavGroup
            label="Administración"
            items={adminNav}
            collapsible
            icon={Shield}
            storageKey="sidebar_group_admin"
          />
        )}

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
