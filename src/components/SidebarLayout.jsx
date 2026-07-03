import { Link, useLocation, Outlet } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { api } from "../lib/api";
import { useEffect, useState } from "react";
import { useUnsavedChanges } from "../context/UnsavedChangesContext";
import SessionTracker from "./SessionTracker";
import PresenceTracker from "./PresenceTracker";
import Avatar from "./Avatar";
import { permisosFallback } from "../constants/modulos";
import {
  FilePlus,
  ClipboardList,
  FileText,
  Package,
  Users,
  Megaphone,
  Target,
  BarChart2,
  Activity,
  UserCog,
  UserCheck,
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
  LayoutDashboard,
  CalendarDays,
  Inbox,
  Percent,
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
        id: perfilDB?.id || "",
        nombre,
        rol: rolDB,
        rolLabel: labelRol(rolDB),
        email: perfilDB?.email || "",
        avatarUrl: perfilDB?.avatar_url || "",
        permisos: Array.isArray(perfilDB?.permisos) ? perfilDB.permisos : null,
      });
    }

    cargarPerfil();
  }, []);

  async function subirMiFoto(file) {
    if (!perfil?.id) return;
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await api.putForm(`/usuarios/profiles/${perfil.id}/avatar`, fd);
      setPerfil((p) => ({ ...p, avatarUrl: r?.avatar_url || p.avatarUrl }));
    } catch (e) {
      console.error("No se pudo subir la foto:", e?.message);
    }
  }

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
  const esAdmin = rolNorm === "admin" || rolNorm === "administrador";
  // Permisos efectivos (perfil de permisos o, en su defecto, por rol). El
  // backend (/auth/profile) los entrega; si no, se usa el fallback por rol.
  const permisos = Array.isArray(perfil?.permisos) ? perfil.permisos : permisosFallback(perfil?.rol);
  const puede = (m) => esAdmin || permisos.includes(m);

  const comercialNav = [
    puede("cotizaciones") && { to: "/listar",      icon: ClipboardList, label: "Cotizaciones" },
    puede("crear_cotizacion") && { to: "/crear",       icon: FilePlus,      label: "Nueva Cotización" },
    esAdmin && { to: "/licitaciones-disponibles", icon: Inbox, label: "Licitaciones disponibles" },
    esAdmin && { to: "/ordenes-compra", icon: FileText, label: "Órdenes de Compra" },
    puede("clientes") && { to: "/clientes",    icon: Users,         label: "Clientes" },
    puede("mis_clientes") && { to: "/mis-clientes", icon: UserCheck,    label: "Mis clientes" },
    puede("bitacora") && { to: "/bitacora-actividades", icon: CalendarDays, label: "Bitácora actividades" },
    puede("productos") && { to: "/productos",   icon: Package,       label: "Productos" },
    puede("campanas") && { to: "/campanas",    icon: Megaphone,     label: "Campañas" },
  ].filter(Boolean);

  const postVentaNav = [
    puede("trazabilidad") && { to: "/trazabilidad",      icon: FileText,   label: "Trazabilidad" },
    puede("seguimiento_pagos") && { to: "/seguimiento-pagos", icon: CreditCard, label: "Seguimiento de Pagos" },
    puede("cobranza") && { to: "/cobranza", icon: Wallet, label: "Cobranza" },
    puede("factoring") && { to: "/factoring", icon: Landmark, label: "Factoring" },
  ].filter(Boolean);

  const comunicacionNav = [
    puede("mi_correo") && { to: "/buzon",                 icon: Mail,          label: "Mi Correo" },
    puede("chat") && { to: "/bitacora-cotizaciones", icon: MessagesSquare, label: "Chat Grupal", badge: chatNoLeidos },
  ].filter(Boolean);

  const metasNav = [
    puede("metas") && { to: "/metas", icon: Target, label: "Definición de metas" },
    puede("resumen_canales") && { to: "/metas-canal", icon: SlidersHorizontal, label: "Resumen canales" },
    (esAdmin || rolNorm === "jefe_ventas") && { to: "/comisiones", icon: Percent, label: "Comisiones" },
  ].filter(Boolean);

  const reportesNav = [
    puede("panel_indicadores") && {
      to: "/panel-indicadores", icon: LayoutDashboard, label: "Panel de Indicadores",
      children: [
        { to: "/panel-particular", icon: Users, label: "Cliente Particular" },
        { to: "/panel-publica", icon: Landmark, label: "Entidad Pública" },
      ],
    },
    (puede("cotizaciones_vendedor") || puede("resumen_comercial")) && { to: "/cotizaciones-vendedor", icon: BarChart3, label: "Panel de Ejecutivos" },
  ].filter(Boolean);

  const herramientasNav = [
    puede("sorteo") && { to: "/sorteo-registros", icon: Gift, label: "Sorteo" },
    puede("marcaje") && { to: "/marcaje", icon: Clock, label: "Marcar Asistencia" },
  ].filter(Boolean);

  const logisticaNav = [
    puede("despachos_choferes") && { to: "/despachos-choferes", icon: Truck, label: "Despachos y Choferes" },
    puede("tracking_choferes") && { to: "/tracking-choferes", icon: MapPin, label: "Tracking en Vivo" },
  ].filter(Boolean);

  const portalClienteNav = [
    puede("monitoreo_stock") && { to: "/monitoreo-stock", icon: PackageSearch, label: "Monitoreo Stock Clientes" },
    puede("portal_accesos") && { to: "/portal-accesos", icon: KeyRound, label: "Acceso Portal Clientes" },
  ].filter(Boolean);

  const adminNav = [
    puede("usuarios") && { to: "/usuarios",          icon: UserCog,  label: "Usuarios" },
    puede("monitoreo_usuarios") && { to: "/monitoreo",         icon: Activity, label: "Monitoreo de Usuarios" },
    puede("monitoreo_asistencia") && { to: "/monitoreo-marcajes", icon: MapPin,   label: "Monitoreo de Asistencia" },
  ].filter(Boolean);

  // Ítem hoja del menú (o hijo anidado si `nested`).
  function NavLeaf({ item, nested }) {
    const { to, icon: Icon, label: itemLabel, badge } = item;
    return (
      <Link
        to={to}
        onClick={(e) => onNavClick(e, to)}
        className={`nav-item ${nested ? "nav-item-child" : ""} ${isActive(to) ? "is-active" : ""}`}
        data-label={itemLabel}
        title={itemLabel}
      >
        <Icon size={nested ? 15 : 16} className="nav-icon" />
        <span className="nav-item-label">{itemLabel}</span>
        {badge > 0 && <span className="nav-item-badge">{badge > 99 ? "99+" : badge}</span>}
      </Link>
    );
  }

  // Ítem padre con submódulos anidados (ej. Panel de Indicadores → sub-paneles).
  function NavParent({ item }) {
    const { to, icon: Icon, label: itemLabel, children } = item;
    const selfActive = isActive(to);
    const childActive = children.some((c) => isActive(c.to));
    const [open, setOpen] = useState(() => {
      try {
        const s = localStorage.getItem(`subnav_${to}`);
        return s === null ? (selfActive || childActive) : s === "1";
      } catch { return true; }
    });
    function toggle(e) {
      e.preventDefault();
      e.stopPropagation();
      const next = !open;
      setOpen(next);
      try { localStorage.setItem(`subnav_${to}`, next ? "1" : "0"); } catch {}
    }
    return (
      <div className={`nav-parent ${open ? "is-open" : ""}`}>
        <div className="nav-parent-row">
          <Link
            to={to}
            onClick={(e) => onNavClick(e, to)}
            className={`nav-item nav-parent-link ${selfActive ? "is-active" : ""}`}
            data-label={itemLabel}
            title={itemLabel}
          >
            <Icon size={16} className="nav-icon" />
            <span className="nav-item-label">{itemLabel}</span>
            {childActive && !open && <span className="nav-group-active-dot" aria-hidden />}
          </Link>
          <button type="button" className="nav-parent-toggle" onClick={toggle} aria-label={open ? "Contraer" : "Expandir"}>
            <ChevronDown size={13} strokeWidth={2.6} className="nav-parent-chevron" />
          </button>
        </div>
        <div className="nav-children">
          {children.map((c) => <NavLeaf key={c.to} item={c} nested />)}
        </div>
      </div>
    );
  }

  function NavGroup({ label, items, collapsible, icon: GroupIcon, storageKey }) {
    if (items.length === 0) return null;

    const algunActivo = items.some((it) => isActive(it.to) || (it.children || []).some((c) => isActive(c.to)));

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

    const items_node = items.map((it) =>
      it.children ? <NavParent key={it.to} item={it} /> : <NavLeaf key={it.to} item={it} />
    );

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
            <Avatar src={perfil.avatarUrl} nombre={perfil.nombre} size={36} editable onUpload={subirMiFoto} title="Mi foto" />
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
