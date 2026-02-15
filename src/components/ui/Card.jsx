export default function Card({ title, subtitle, right, children }) {
  return (
    <section className="card">
      {(title || subtitle || right) && (
        <header className="card-head">
          <div>
            {title && <h3 className="card-title">{title}</h3>}
            {subtitle && <p className="card-subtitle">{subtitle}</p>}
          </div>
          {right}
        </header>
      )}
      <div>{children}</div>
    </section>
  );
}
