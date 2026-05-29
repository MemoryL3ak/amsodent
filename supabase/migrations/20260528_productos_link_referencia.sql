-- Link de referencia del producto: URL desde donde el creador tomó la
-- información (productos "Transitorio" creados por ventas). Una vez guardado,
-- solo el administrador puede modificarlo. No se incluye en la ficha PDF.
alter table public.productos
  add column if not exists link_referencia text;

-- Marca de tiempo de creación (si la tabla aún no la tiene), para que el
-- administrador pueda ver la fecha en que se creó el producto.
alter table public.productos
  add column if not exists created_at timestamptz not null default now();
