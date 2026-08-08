import { BrowserRouter, Routes, Route, Navigate, useParams } from "react-router-dom";
import ProtectedRoute from "./components/ProtectedRoute";
import SidebarLayout from "./components/SidebarLayout";
import { UnsavedChangesProvider } from "./context/UnsavedChangesContext";

// AUTH
import Login from "./pages/Login";
import ResetPassword from "./pages/ResetPassword";

// LICITACIONES
import CrearLicitacion from "./pages/CrearLicitacion";
import LicitacionesDisponibles from "./pages/LicitacionesDisponibles";
import OrdenesCompra from "./pages/OrdenesCompra";
import CrearOrdenCompra from "./pages/CrearOrdenCompra";
import Proveedores from "./pages/Proveedores";
import ListarLicitaciones from "./pages/ListarLicitaciones";
import DetalleLicitacion from "./pages/DetalleLicitacion";

// PRODUCTOS
import Productos from "./pages/Productos";
import CrearProducto from "./pages/CrearProducto";
import EditarProducto from "./pages/EditarProducto";

// CLIENTES
import Clientes from "./pages/Clientes";
import BitacoraActividades from "./pages/BitacoraActividades";
import CrearCliente from "./pages/CrearCliente";
import EditarCliente from "./pages/EditarCliente";
import DetalleCliente from "./pages/DetalleCliente";
import MisClientes from "./pages/MisClientes";

// MONITOREO
import MonitoreoUsuarios from "./pages/MonitoreoUsuarios";
import MonitoreoSistema from "./pages/MonitoreoSistema";

// USUARIOS
import ConfiguracionUsuarios from "./pages/ConfiguracionUsuarios";

// CAMPAÑAS
import CampanasProductos from "./pages/CampanasProductos";
import CrearCampana from "./pages/CrearCampana";
import EditarCampana from "./pages/EditarCampana";
import CotizacionesPorVendedor from "./pages/CotizacionesPorVendedor";
import PanelIndicadores from "./pages/PanelIndicadores";
import AnalisisMercadoPublico from "./pages/AnalisisMercadoPublico";
import PanelParticular from "./pages/PanelParticular";
import Comisiones from "./pages/Comisiones";
import PanelPublica from "./pages/PanelPublica";
import Metas from "./pages/Metas";
import MetasPorCanal from "./pages/MetasPorCanal";
import Trazabilidad from "./pages/Trazabilidad";
import SeguimientoPagos from "./pages/SeguimientoPagos";
import Cobranza from "./pages/Cobranza";
import Factoring from "./pages/Factoring";
import BitacoraCotizaciones from "./pages/BitacoraCotizaciones";
import Buzon from "./pages/Buzon";

// SORTEO
import SorteoRegistro from "./pages/SorteoRegistro";
// EVENTO (inscripciones)
import EventoRegistro from "./pages/EventoRegistro";
import EventoInscripciones from "./pages/EventoInscripciones";
import PortalCliente from "./pages/PortalCliente";
import PortalDespachos from "./pages/PortalDespachos";
import SorteoRegistros from "./pages/SorteoRegistros";
import RequireRole from "./components/RequireRole";
import RequireModulo from "./components/RequireModulo";

// COMUNICACIONES
import Comunicaciones from "./pages/Comunicaciones";

// RECURSOS HUMANOS
import RecursosHumanos from "./pages/RecursosHumanos";
import MiFicha from "./pages/MiFicha";

// MARCAJE
import Marcaje from "./pages/Marcaje";
import MonitoreoMarcajes from "./pages/MonitoreoMarcajes";

// PORTAL DE STOCK
import PortalStockCliente from "./pages/PortalStockCliente";
import MonitoreoStockClientes from "./pages/MonitoreoStockClientes";
import AccesoPortalClientes from "./pages/AccesoPortalClientes";
// DESPACHOS INTERNOS / CHOFERES
import DespachosChoferes from "./pages/DespachosChoferes";
import CosteoFletes from "./pages/CosteoFletes";
import TrackingChoferes from "./pages/TrackingChoferes";
import PortalChofer from "./pages/PortalChofer";

// Envuelve DetalleLicitacion con key={id} para forzar el remontaje al cambiar
// de cotización (p. ej. al abrir otra desde las notificaciones): así el estado
// se reinicia y no queda "pegada" la cotización anterior.
function DetalleLicitacionRoute() {
  const { id } = useParams();
  return <DetalleLicitacion key={id} />;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* RUTAS PÚBLICAS */}
        <Route path="/login" element={<Login />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/sorteo" element={<SorteoRegistro />} />
        <Route path="/evento" element={<EventoRegistro evento="santiago" />} />
        <Route path="/evento-vina" element={<EventoRegistro evento="vina" />} />
        {/* Alias antiguo: el evento de Viña del Mar se publicó primero como "Brasil". */}
        <Route path="/evento-brasil" element={<EventoRegistro evento="vina" />} />
        <Route path="/portal" element={<PortalCliente />} />
        <Route path="/despachos" element={<PortalDespachos />} />
        <Route path="/portal-cliente" element={<PortalStockCliente />} />
        <Route path="/portal-chofer" element={<PortalChofer />} />

        {/* RUTAS PROTEGIDAS */}
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <UnsavedChangesProvider>
                <SidebarLayout />
              </UnsavedChangesProvider>
            </ProtectedRoute>
          }
        >
          {/* LICITACIONES */}
          <Route path="crear" element={<CrearLicitacion />} />
          <Route path="licitaciones-disponibles" element={<LicitacionesDisponibles />} />
          <Route path="ordenes-compra" element={<OrdenesCompra />} />
          <Route path="ordenes-compra/nueva" element={<CrearOrdenCompra />} />
          <Route path="ordenes-compra/:id" element={<CrearOrdenCompra />} />
          <Route path="proveedores" element={<Proveedores />} />
          <Route path="listar" element={<ListarLicitaciones />} />
          <Route path="detalle/:id" element={<DetalleLicitacionRoute />} />

          {/* PRODUCTOS */}
          <Route path="productos" element={<Productos />} />
          <Route path="productos/nuevo" element={<CrearProducto />} />
          <Route path="productos/editar/:id" element={<EditarProducto />} />

          {/* CLIENTES */}
          <Route path="clientes" element={<Clientes />} />
          <Route path="mis-clientes" element={<MisClientes />} />
          <Route path="bitacora-actividades" element={<BitacoraActividades />} />
          <Route path="clientes/nuevo" element={<CrearCliente />} />
          <Route path="clientes/editar/:id" element={<EditarCliente />} />
          <Route path="clientes/:id" element={<DetalleCliente />} />

          {/* MONITOREO */}
          <Route path="monitoreo" element={<MonitoreoUsuarios />} />

          {/* USUARIOS */}
          <Route path="usuarios" element={<ConfiguracionUsuarios />} />

          {/* CAMPAÑAS */}
          <Route path="campanas" element={<CampanasProductos />} />
          <Route
            path="campanas/nueva"
            element={
              <RequireRole allow={["admin"]}>
                <CrearCampana />
              </RequireRole>
            }
          />
          <Route path="campanas/editar/:id" element={<EditarCampana />} />
          <Route
            path="trazabilidad"
            element={
              <RequireModulo modulo="trazabilidad">
                <Trazabilidad />
              </RequireModulo>
            }
          />
          <Route
            path="seguimiento-pagos"
            element={
              <RequireModulo modulo="seguimiento_pagos">
                <SeguimientoPagos />
              </RequireModulo>
            }
          />
          <Route
            path="cobranza"
            element={
              <RequireModulo modulo="cobranza">
                <Cobranza />
              </RequireModulo>
            }
          />
          <Route
            path="factoring"
            element={
              <RequireModulo modulo="factoring">
                <Factoring />
              </RequireModulo>
            }
          />
          <Route
            path="despachos-choferes"
            element={
              <RequireModulo modulo="despachos_choferes">
                <DespachosChoferes />
              </RequireModulo>
            }
          />
          <Route
            path="tracking-choferes"
            element={
              <RequireModulo modulo="tracking_choferes">
                <TrackingChoferes />
              </RequireModulo>
            }
          />
          <Route
            path="costeo-fletes"
            element={
              <RequireModulo modulo="costeo_fletes">
                <CosteoFletes />
              </RequireModulo>
            }
          />
          {/* "Resumen Comercial" se fusionó en "Panel de Ejecutivos". */}
          <Route path="ventas" element={<Navigate to="/cotizaciones-vendedor" replace />} />
          <Route
            path="cotizaciones-vendedor"
            element={
              <RequireModulo modulo={["cotizaciones_vendedor", "resumen_comercial"]}>
                <CotizacionesPorVendedor />
              </RequireModulo>
            }
          />
          <Route
            path="analisis-mercado-publico"
            element={
              <RequireRole allow={["admin"]}>
                <AnalisisMercadoPublico />
              </RequireRole>
            }
          />
          {/* MONITOREO DEL SISTEMA (logs técnicos) — solo admin */}
          <Route
            path="monitoreo-sistema"
            element={
              <RequireRole allow={["admin"]}>
                <MonitoreoSistema />
              </RequireRole>
            }
          />
          <Route
            path="panel-indicadores"
            element={
              <RequireModulo modulo="panel_indicadores">
                <PanelIndicadores />
              </RequireModulo>
            }
          />
          <Route
            path="panel-particular"
            element={
              <RequireModulo modulo="panel_indicadores">
                <PanelParticular />
              </RequireModulo>
            }
          />
          <Route
            path="panel-publica"
            element={
              <RequireModulo modulo="panel_indicadores">
                <PanelPublica />
              </RequireModulo>
            }
          />
          <Route path="metas" element={<Metas />} />
          <Route path="metas-canal" element={<MetasPorCanal />} />
          <Route path="comisiones" element={<Comisiones />} />

          {/* SORTEO (admin + ventas_especial) */}
          <Route
            path="sorteo-registros"
            element={
              <RequireModulo modulo="sorteo">
                <SorteoRegistros />
              </RequireModulo>
            }
          />

          {/* EVENTO: inscripciones del portal público /evento */}
          <Route
            path="evento-inscripciones"
            element={
              <RequireModulo modulo="eventos">
                <EventoInscripciones />
              </RequireModulo>
            }
          />

          {/* COMUNICACIONES (solo admin) */}
          <Route
            path="comunicaciones"
            element={
              <RequireRole allow={["admin"]}>
                <Comunicaciones />
              </RequireRole>
            }
          />

          {/* CHAT GRUPAL — disponible para todos los autenticados */}
          <Route
            path="bitacora-cotizaciones"
            element={<BitacoraCotizaciones />}
          />

          {/* MI CORREO — habilitado para todos los roles */}
          <Route path="buzon" element={<Buzon />} />

          {/* RECURSOS HUMANOS — solo admin (sueldos y datos personales) */}
          <Route
            path="recursos-humanos"
            element={
              <RequireRole allow={["admin"]}>
                <RecursosHumanos />
              </RequireRole>
            }
          />

          {/* MI FICHA — portal del trabajador, cada uno ve solo lo suyo */}
          <Route path="mi-ficha" element={<MiFicha />} />

          {/* MARCAJE DE ASISTENCIA — solo admin */}
          <Route
            path="marcaje"
            element={
              <RequireModulo modulo="marcaje">
                <Marcaje />
              </RequireModulo>
            }
          />

          {/* MONITOREO DE MARCAJES — solo admin */}
          <Route
            path="monitoreo-marcajes"
            element={
              <RequireModulo modulo="monitoreo_asistencia">
                <MonitoreoMarcajes />
              </RequireModulo>
            }
          />

          {/* MONITOREO DE STOCK DE CLIENTES — admin y ventas_especial */}
          <Route
            path="monitoreo-stock"
            element={
              <RequireModulo modulo="monitoreo_stock">
                <MonitoreoStockClientes />
              </RequireModulo>
            }
          />

          {/* ACCESO AL PORTAL DEL CLIENTE — solo admin */}
          <Route
            path="portal-accesos"
            element={
              <RequireModulo modulo="portal_accesos">
                <AccesoPortalClientes />
              </RequireModulo>
            }
          />
        </Route>

        {/* FALLBACK */}
        <Route path="*" element={<Login />} />
      </Routes>
    </BrowserRouter>
  );
}
