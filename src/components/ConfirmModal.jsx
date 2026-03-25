export default function ConfirmModal({
  open,
  title,
  message,
  onConfirm,
  onCancel,
  confirmText = "Eliminar",
  cancelText = "Cancelar",
  confirmTone = "danger",
}) {
  if (!open) return null;

  const confirmToneClass =
    confirmTone === "primary"
      ? "bg-blue-600 hover:bg-blue-700"
      : "bg-red-600 hover:bg-red-700";

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 animate-fade-in">
      <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md animate-scale-in">
        
        <h2 className="text-xl font-semibold mb-2 text-gray-800">{title}</h2>
        <p className="text-gray-600 mb-6">{message}</p>

        <div className="flex justify-end gap-3">
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded-md border border-gray-300 hover:bg-gray-100 transition cursor-pointer"
          >
            {cancelText}
          </button>

          <button
            onClick={onConfirm}
            className={`px-4 py-2 rounded-md text-white shadow transition cursor-pointer ${confirmToneClass}`}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
