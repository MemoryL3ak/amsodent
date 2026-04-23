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

// SORTEO
import SorteoRegistro from "./pages/SorteoRegistro";
import SorteoRegistros from "./pages/SorteoRegistros";
import RequireRole from "./components/RequireRole";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* RUTAS PÚBLICAS */}
        <Route path="/login" element={<Login />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/sorteo" element={<SorteoRegistro />} />

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
          <Route path="trazabilidad" element={<Trazabilidad />} />
          <Route path="seguimiento-pagos" element={<SeguimientoPagos />} />
          <Route path="ventas" element={<Ventas />} />
          <Route path="metas" element={<Metas />} />
          <Route path="metas-canal" element={<MetasPorCanal />} />

          {/* SORTEO (solo admin) */}
          <Route
            path="sorteo-registros"
            element={
              <RequireRole allow={["admin"]}>
                <SorteoRegistros />
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
