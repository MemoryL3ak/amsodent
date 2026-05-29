import DatePicker, { registerLocale } from "react-datepicker";
import { es } from "date-fns/locale/es";

registerLocale("es", es);

/**
 * Input de fecha estilizado para filtros.
 * Usa react-datepicker con los estilos custom de Trazabilidad.
 */
export default function DateFilter({ value, onChange, placeholder = "dd-mm-aaaa", minDate, maxDate, disabled, className }) {
  const selected = value ? new Date(`${value}T00:00:00`) : null;
  // El onChange recibe un Date en medianoche local; lo serializamos con sus
  // componentes locales (no toISOString, que pasaría a UTC y podría correr el día).
  const aISO = (d) => {
    if (!d) return "";
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  };
  return (
    <DatePicker
      selected={selected}
      onChange={(d) => onChange(aISO(d))}
      dateFormat="dd-MM-yyyy"
      locale="es"
      placeholderText={placeholder}
      isClearable
      disabled={disabled}
      minDate={minDate}
      maxDate={maxDate}
      className={className}
      wrapperClassName="trazabilidad-datepicker"
    />
  );
}
