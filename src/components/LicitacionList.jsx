export default function LicitacionList({ data }) {
  if (!data.length) {
    return <p className="text-center mt-6 text-gray-600">No hay licitaciones registradas.</p>;
  }

  return (
    <table className="w-full mt-8 bg-white shadow rounded-xl overflow-hidden">
      <thead className="bg-gray-100">
        <tr>
          <th className="p-3 text-left">Nombre</th>
          <th className="p-3 text-left">Inicio</th>
          <th className="p-3 text-left">Cierre</th>
          <th className="p-3 text-left">Estado</th>
        </tr>
      </thead>

      <tbody>
        {data.map((l) => (
          <tr key={l.id} className="border-t">
            <td className="p-3">{l.nombre}</td>
            <td className="p-3">{l.fechaInicio}</td>
            <td className="p-3">{l.fechaCierre}</td>
            <td className="p-3">
              <span className="text-green-600 font-semibold">{l.estado}</span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
