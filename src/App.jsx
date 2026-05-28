import { BrowserRouter, Routes, Route } from "react-router-dom";
import ProtectedRoute from "./components/ProtectedRoute";
import SidebarLayout from "./components/SidebarLayout";
import { UnsavedChangesProvider } from "./context/UnsavedChangesContext";

// AUTH
import Login from "./pages/Login";
import ResetPassword from "./pages/ResetPassword";

// LICITACIONES
import CrearLicitacion from "./pages/CrearLicitacion";
import ListarLicitaciones from "./pages/ListarLicitaciones";
import DetalleLicitacion from "./pages/DetalleLicitacion";

// PRODUCTOS
import Productos from "./pages/Productos";
import CrearProducto from "./pages/CrearProducto";
import EditarProducto from "./pages/EditarProducto";

// CLIENTES
import Clientes from "./pages/Clientes";
import CrearCliente from "./pages/CrearCliente";
import EditarCliente from "./pages/EditarCliente";

// MONITOREO
import MonitoreoUsuarios from "./pages/MonitoreoUsuarios";

// USUARIOS
import ConfiguracionUsuarios from "./pages/ConfiguracionUsuarios";

// CAMPAÑAS
import CampanasProductos from "./pages/CampanasProductos";
import CrearCampana from "./pages/CrearCampana";
import EditarCampana from "./pages/EditarCampana";
import Ventas from "./pages/Ventas";
import Metas from "./pages/Metas";
import MetasPorCanal from "./pages/MetasPorCanal";
import Trazabilidad from "./pages/Trazabilidad";
import SeguimientoPagos from "./pages/SeguimientoPagos";
import BitacoraCotizaciones from "./pages/BitacoraCotizaciones";
import Buzon from "./pages/Buzon";

// SORTEO
import SorteoRegistro from "./pages/SorteoRegistro";
import PortalCliente from "./pages/PortalCliente";
import SorteoRegistros from "./pages/SorteoRegistros";
import RequireRole from "./components/RequireRole";

// COMUNICACIONES
import Comunicaciones from "./pages/Comunicaciones";

// PORTAL DE STOCK
import PortalStockCliente from "./pages/PortalStockCliente";
import MonitoreoStockClientes from "./pages/MonitoreoStockClientes";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* RUTAS PÚBLICAS */}
        <Route path="/login" element={<Login />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/sorteo" element={<SorteoRegistro />} />
        <Route path="/portal" element={<PortalCliente />} />
        <Route path="/portal-cliente" element={<PortalStockCliente />} />

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
          <Route path="listar" element={<ListarLicitaciones />} />
          <Route path="detalle/:id" element={<DetalleLicitacion />} />

          {/* PRODUCTOS */}
          <Route path="productos" element={<Productos />} />
          <Route path="productos/nuevo" element={<CrearProducto />} />
          <Route path="productos/editar/:id" element={<EditarProducto />} />

          {/* CLIENTES */}
          <Route path="clientes" element={<Clientes />} />
          <Route path="clientes/nuevo" element={<CrearCliente />} />
          <Route path="clientes/editar/:id" element={<EditarCliente />} />

          {/* MONITOREO */}
          <Route path="monitoreo" element={<MonitoreoUsuarios />} />

          {/* USUARIOS */}
          <Route path="usuarios" element={<ConfiguracionUsuarios />} />

          {/* CAMPAÑAS */}
          <Route path="campanas" element={<CampanasProductos />} />
          <Route path="campanas/nueva" element={<CrearCampana />} />
          <Route path="campanas/editar/:id" element={<EditarCampana />} />
          <Route
            path="trazabilidad"
            element={
              <RequireRole allow={["admin", "jefe_ventas", "jefe_ventas_especial", "contabilidad"]}>
                <Trazabilidad />
              </RequireRole>
            }
          />
          <Route
            path="seguimiento-pagos"
            element={
              <RequireRole allow={["admin", "jefe_ventas_especial", "contabilidad"]}>
                <SeguimientoPagos />
              </RequireRole>
            }
          />
          <Route path="ventas" element={<Ventas />} />
          <Route path="metas" element={<Metas />} />
          <Route path="metas-canal" element={<MetasPorCanal />} />

          {/* SORTEO (admin + ventas_especial) */}
          <Route
            path="sorteo-registros"
            element={
              <RequireRole allow={["admin", "ventas_especial"]}>
                <SorteoRegistros />
              </RequireRole>
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

          {/* BUZÓN DE CORREO — solo admin */}
          <Route
            path="buzon"
            element={
              <RequireRole allow={["admin"]}>
                <Buzon />
              </RequireRole>
            }
          />

          {/* MONITOREO DE STOCK DE CLIENTES — solo admin */}
          <Route
            path="monitoreo-stock"
            element={
              <RequireRole allow={["admin"]}>
                <MonitoreoStockClientes />
              </RequireRole>
            }
          />
        </Route>

        {/* FALLBACK */}
        <Route path="*" element={<Login />} />
      </Routes>
    </BrowserRouter>
  );
}
