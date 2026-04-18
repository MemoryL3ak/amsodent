import { useEffect, useMemo, useRef, useState } from "react";

const MONTHS = [
  { value: 1, label: "Enero" },
  { value: 2, label: "Febrero" },
  { value: 3, label: "Marzo" },
  { value: 4, label: "Abril" },
  { value: 5, label: "Mayo" },
  { value: 6, label: "Junio" },
  { value: 7, label: "Julio" },
  { value: 8, label: "Agosto" },
  { value: 9, label: "Septiembre" },
  { value: 10, label: "Octubre" },
  { value: 11, label: "Noviembre" },
  { value: 12, label: "Diciembre" },
];

function parsePeriodo(value) {
  const s = String(value || "");
  const match = s.match(/^(\d{4})-(\d{2})-\d{2}$/);
  if (!match) {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() + 1 };
  }
  return { year: Number(match[1]), month: Number(match[2]) };
}

function formatPeriodo(year, month) {
  return `${String(year)}-${String(month).padStart(2, "0")}-01`;
}

export default function MonthCalendarPicker({ value, onChange, className = "" }) {
  const pickerRef = useRef(null);
  const [open, setOpen] = useState(false);
  const { year, month } = parsePeriodo(value);
  const [viewYear, setViewYear] = useState(year);

  useEffect(() => {
    setViewYear(year);
  }, [year]);

  useEffect(() => {
    if (!open) return undefined;

    function handleClickOutside(event) {
      if (!pickerRef.current?.contains(event.target)) {
        setOpen(false);
      }
    }

    function handleEsc(event) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEsc);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEsc);
    };
  }, [open]);

  const title = useMemo(() => {
    const selected = new Date(Date.UTC(year, month - 1, 1));
    return selected.toLocaleDateString("es-CL", { month: "long", year: "numeric" });
  }, [year, month]);

  return (
    <div ref={pickerRef} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="min-w-[190px] rounded-xl border border-slate-300 bg-white px-3 py-2 text-left text-sm text-slate-900 shadow-sm hover:bg-slate-50"
      >
        <span className="block capitalize">{title}</span>
      </button>

      {open ? (
        <div className="absolute z-30 mt-2 w-[280px] rounded-2xl border border-slate-200 bg-white p-3 shadow-xl">
          <div className="mb-3 flex items-center justify-between">
            <button
              type="button"
              onClick={() => setViewYear((prev) => prev - 1)}
              className="rounded-lg border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              Anterior
            </button>
            <div className="text-sm font-semibold text-slate-900">{viewYear}</div>
            <button
              type="button"
              onClick={() => setViewYear((prev) => prev + 1)}
              className="rounded-lg border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              Siguiente
            </button>
          </div>

          <div className="grid grid-cols-3 gap-2">
            {MONTHS.map((m) => {
              const selected = m.value === month && viewYear === year;
              return (
                <button
                  key={m.value}
                  type="button"
                  onClick={() => {
                    onChange(formatPeriodo(viewYear, m.value));
                    setOpen(false);
                  }}
                  className={`rounded-lg px-2 py-2 text-xs font-medium transition ${
                    selected
                      ? "bg-sky-600 text-white"
                      : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  {m.label}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
