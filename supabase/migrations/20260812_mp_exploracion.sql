-- ============================================================================
-- Exploración automática de Mercado Público
-- ----------------------------------------------------------------------------
-- La búsqueda del explorador consulta ~90 términos contra la API (~4 minutos y
-- otra tanta cuota). Ejecutarla quedó restringido a una persona, y para el
-- resto del equipo el resultado se genera solo, dos veces al día (14:00 y
-- 23:00 de Chile), y se guarda aquí para que abrir la pestaña «Explorar» sea
-- instantáneo y gratis.
--
-- Una sola fila (id = 1): siempre se muestra la última exploración; el
-- histórico no aporta nada porque los procesos abiertos son los mismos de una
-- corrida a la siguiente, menos los que van cerrando.
--
-- Convención de acceso: RLS habilitado y SIN policies; todo pasa por el backend.
-- ============================================================================

create table if not exists public.mp_exploracion (
  id integer primary key default 1,
  resultado jsonb not null,           -- lo mismo que devuelve /mercado-publico/buscar
  actualizado_at timestamptz not null default now(),
  motivo text,                        -- 'programada 14:00' | 'programada 23:00' | 'manual'
  constraint mp_exploracion_fila_unica check (id = 1)
);

alter table public.mp_exploracion enable row level security;
