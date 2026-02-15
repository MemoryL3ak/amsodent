import { ClipboardList, Package, FileText, Users, Settings } from "lucide-react";

const items = [
  { icon: ClipboardList, label: "Licitaciones", active: true },
  { icon: Package, label: "Productos" },
  { icon: FileText, label: "Documentos" },
  { icon: Users, label: "Usuarios" },
  { icon: Settings, label: "Configuración" },
];

export default function Sidebar() {
  return (
    <aside className="sidebar">
      <div className="brand">
        <img
          className="brand-logo"
          src="https://amsodentmedical.cl/wp-content/uploads/2025/12/Amsodent-1.png"
          alt="Amsodent"
        />
        <div>
          <div className="brand-title">Amsodent Medical</div>
          <div className="brand-subtitle">Panel Comercial</div>
        </div>
      </div>

      <nav className="nav">
        {items.map(({ icon: Icon, label, active }) => (
          <button key={label} className={`nav-item ${active ? "is-active" : ""}`}>
            <span className="nav-icon-wrap">
              <Icon size={16} />
            </span>
            <span>{label}</span>
          </button>
        ))}
      </nav>
    </aside>
  );
}
