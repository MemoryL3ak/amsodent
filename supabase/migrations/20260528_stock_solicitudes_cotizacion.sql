-- Solicitudes de cotización enviadas desde el portal del cliente.
-- El cliente elige uno o más de sus productos declarados, indica cantidad
-- y opcionalmente un comentario. El sistema notifica al equipo por correo
-- y guarda la solicitud para seguimiento.
create table if not exists public.stock_solicitudes_cotizacion (
  id              bigserial primary key,
  rut             text not null,
  razon_social    text,
  contacto_email  text,
  contacto_telefono text,
  nota            text,

  -- items: [{ nombre, unidad, cantidad_solicitada }]
  items           jsonb not null default '[]'::jsonb,

  estado          text not null default 'pendiente',
                  -- 'pendiente' | 'respondida' | 'cancelada'
  respondida_at   timestamptz,

  ip_address      text,
  user_agent      text,
  created_at      timestamptz not null default now()
);

create index if not exists stock_solicitudes_rut_idx
  on public.stock_solicitudes_cotizacion (rut);
create index if not exists stock_solicitudes_estado_idx
  on public.stock_solicitudes_cotizacion (estado);
create index if not exists stock_solicitudes_creado_idx
  on public.stock_solicitudes_cotizacion (created_at desc);

alter table public.stock_solicitudes_cotizacion enable row level security;

-- Solo lectura para autenticados internos. El backend escribe con service_role.
drop policy if exists "stock_solicitudes select autenticados" on public.stock_solicitudes_cotizacion;
create policy "stock_solicitudes select autenticados"
  on public.stock_solicitudes_cotizacion for select to authenticated using (true);

-- Realtime para refrescar el dashboard cuando llegue una solicitud nueva.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'stock_solicitudes_cotizacion'
  ) then
    alter publication supabase_realtime add table public.stock_solicitudes_cotizacion;
  end if;
end $$;
