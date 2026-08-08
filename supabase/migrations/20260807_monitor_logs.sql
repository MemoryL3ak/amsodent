-- Monitoreo del sistema: bitácora técnica en tiempo real de TODO lo que pasa
-- en el backend (requests HTTP, excepciones, correos) y errores JS del
-- frontend. La escribe SOLO el backend (service role, en lotes); la lee el
-- panel /monitoreo-sistema (solo admin, vía RLS + Realtime).
create table if not exists public.monitor_logs (
  id bigserial primary key,
  nivel text not null default 'info' check (nivel in ('info', 'warn', 'error')),
  -- de dónde salió el evento: backend | frontend | movil
  origen text not null default 'backend',
  -- qué clase de evento es: http | excepcion | correo | frontend | sistema
  tipo text not null default 'http',
  metodo text,                 -- GET/POST/... (solo tipo http/excepcion)
  ruta text,                   -- /api/... o ruta del frontend
  status int,                  -- código HTTP de la respuesta
  duracion_ms int,             -- latencia de la request
  mensaje text,                -- resumen humano (error message, asunto del correo, etc.)
  stack text,                  -- stacktrace cuando aplica
  usuario_id uuid,             -- auth.users.id si la request venía autenticada
  usuario_email text,
  ip text,
  user_agent text,
  metadata jsonb,              -- extra: body recortado, destinatario, etc.
  created_at timestamptz not null default now()
);

create index if not exists monitor_logs_created_idx on public.monitor_logs (created_at desc);
create index if not exists monitor_logs_nivel_idx on public.monitor_logs (nivel, created_at desc);
create index if not exists monitor_logs_tipo_idx on public.monitor_logs (tipo, created_at desc);

alter table public.monitor_logs enable row level security;

-- Solo administradores pueden leer (necesario también para la suscripción
-- Realtime del panel). Nadie inserta con anon key: escribe el service role.
drop policy if exists "monitor_logs select admin" on public.monitor_logs;
create policy "monitor_logs select admin"
  on public.monitor_logs for select to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and lower(coalesce(p.rol, '')) in ('admin', 'administrador')
    )
  );

-- Realtime para el panel en vivo.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'monitor_logs'
  ) then
    alter publication supabase_realtime add table public.monitor_logs;
  end if;
end $$;
