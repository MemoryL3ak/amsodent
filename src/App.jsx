import Sidebar from "./components/layout/Sidebar";
import Topbar from "./components/layout/Topbar";
import Card from "./components/ui/Card";
import Button from "./components/ui/Button";
import Badge from "./components/ui/Badge";
import Input from "./components/ui/Input";

const rows = [
  {
    id: "L-10454",
    cliente: "Hospital San Juan",
    estado: "En espera",
    monto: "$1.290.000",
    docs: 4,
  },
  {
    id: "L-10453",
    cliente: "Clínica del Norte",
    estado: "Adjudicada",
    monto: "$980.000",
    docs: 7,
  },
  {
    id: "L-10452",
    cliente: "CESFAM Central",
    estado: "Perdida",
    monto: "$640.000",
    docs: 2,
  },
];

function toneFor(estado) {
  if (estado === "Adjudicada") return "success";
  if (estado === "Perdida") return "danger";
  if (estado === "En espera") return "waiting";
  return "neutral";
}

export default function App() {
  return (
    <div className="app-shell">
      <Sidebar />

      <main className="content">
        <Topbar />

        <section className="metrics">
          <Card title="Licitaciones activas">
            <p className="metric-value">87</p>
            <p className="metric-foot">+12% respecto al mes anterior</p>
          </Card>

          <Card title="Monto pipeline">
            <p className="metric-value">$42.450.000</p>
            <p className="metric-foot">Estado En espera + Pendientes</p>
          </Card>

          <Card title="Documentos subidos">
            <p className="metric-value">1.236</p>
            <p className="metric-foot">OC, guías y facturas</p>
          </Card>
        </section>

        <section className="grid-2">
          <Card
            title="Últimas licitaciones"
            subtitle="Tabla principal con estado comercial"
            right={<Button size="sm">Nueva licitación</Button>}
          >
            <table className="table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Cliente</th>
                  <th>Estado</th>
                  <th>Monto</th>
                  <th>Docs</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td>{row.id}</td>
                    <td>{row.cliente}</td>
                    <td>
                      <Badge tone={toneFor(row.estado)}>{row.estado}</Badge>
                    </td>
                    <td>{row.monto}</td>
                    <td>{row.docs}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <Card title="Formulario base" subtitle="Inputs y acciones unificadas">
            <div className="stack">
              <Input label="Nombre cliente" placeholder="Ej: Hospital Regional" />
              <Input label="RUT" placeholder="99.999.999-9" />
              <Input label="Correo contacto" placeholder="compras@cliente.cl" />
              <div className="btn-row">
                <Button variant="primary">Guardar</Button>
                <Button variant="secondary">Cancelar</Button>
                <Button variant="ghost">Enviar a revisión</Button>
              </div>
            </div>
          </Card>
        </section>
      </main>
    </div>
  );
}
