import DatePicker, { registerLocale } from "react-datepicker";
import { es } from "date-fns/locale/es";

registerLocale("es", es);

/**
 * Input de fecha estilizado para filtros.
 * Usa react-datepicker con los estilos custom de Trazabilidad.
 */
export default function DateFilter({ value, onChange, placeholder = "dd-mm-aaaa", minDate, maxDate, disabled }) {
  const selected = value ? new Date(`${value}T00:00:00`) : null;
  return (
    <DatePicker
      selected={selected}
      onChange={(d) => onChange(d ? d.toISOString().slice(0, 10) : "")}
      dateFormat="dd-MM-yyyy"
      locale="es"
      placeholderText={placeholder}
      isClearable
      disabled={disabled}
      minDate={minDate}
      maxDate={maxDate}
      wrapperClassName="trazabilidad-datepicker"
    />
  );
}
