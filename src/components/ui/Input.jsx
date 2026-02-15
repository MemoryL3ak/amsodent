export default function Input({ label, hint, ...props }) {
  return (
    <label className="field">
      {label && <span className="field-label">{label}</span>}
      <input className="input" {...props} />
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}
