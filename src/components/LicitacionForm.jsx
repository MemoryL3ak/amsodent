import { useState } from "react";

export default function LicitacionForm({ onCreate }) {
  const [form, setForm] = useState({
    nombre: "",
    fechaInicio: "",
    fechaCierre: "",
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    onCreate(form);
    setForm({ nombre: "", fechaInicio: "", fechaCierre: "" });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 bg-white p-6 rounded-xl shadow">
      <h2 className="text-xl font-semibold">Crear nueva licitación</h2>

      <div>
        <label className="block font-medium mb-1">Nombre</label>
        <input
          type="text"
          className="w-full border p-2 rounded"
          value={form.nombre}
          onChange={(e) => setForm({ ...form, nombre: e.target.value })}
          required
        />
      </div>

      <div>
        <label className="block font-medium mb-1">Fecha de inicio</label>
        <input
          type="date"
          className="w-full border p-2 rounded"
          value={form.fechaInicio}
          onChange={(e) => setForm({ ...form, fechaInicio: e.target.value })}
          required
        />
      </div>

      <div>
        <label className="block font-medium mb-1">Fecha de cierre</label>
        <input
          type="date"
          className="w-full border p-2 rounded"
          value={form.fechaCierre}
          onChange={(e) => setForm({ ...form, fechaCierre: e.target.value })}
          required
        />
      </div>

      <button className="w-full bg-blue-600 hover:bg-blue-700 text-white py-2 rounded-md">
        Guardar licitación
      </button>
    </form>
  );
}
