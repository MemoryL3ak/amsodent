-- Portal del cliente → Gestión de Stock (2026-10-07).
-- Quién hizo cada declaración de stock (usuario del portal). Con esto el
-- historial de movimientos por producto (últimos 5, solo admin del portal)
-- puede decir quién cambió el stock. Las declaraciones anteriores quedan sin
-- usuario. El código tolera que la migración no esté aplicada.
alter table public.stock_declaraciones
  add column if not exists usuario_email text,
  add column if not exists usuario_nombre text;
