import { Bell, Search } from "lucide-react";

export default function Topbar() {
  return (
    <>
      <div className="top-strip">
        <p>Despacho gratis en compras sobre $59.990 | Soporte comercial: +56 9 1234 5678</p>
      </div>

      <header className="topbar">
        <div className="topbar-left">
          <h1>Licitaciones</h1>
          <p>Base visual corporativa Amsodent</p>
        </div>

        <div className="topbar-right">
          <div className="topbar-search">
            <Search size={16} />
            <input placeholder="Buscar licitación, cliente o SKU..." />
          </div>
          <button className="icon-btn" aria-label="Notificaciones">
            <Bell size={18} />
          </button>
        </div>
      </header>
    </>
  );
}
