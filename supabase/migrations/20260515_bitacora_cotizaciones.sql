-- Bitácora de Cotizaciones: registro de quién ingresa qué cotización a plataformas
-- externas (mercado público, portales de clientes, etc) con su estado.
-- Estados permitidos: 'Pendiente', 'Ingresada'.

create table if not exists public.bitacora_cotizaciones (
  id uuid primary key default gen_random_uuid(),
  id_cotizacion text not null,
  estado text not null default 'Pendiente' check (estado in ('Pendiente', 'Ingresada')),
  observaciones text,

  -- Auditoría: quién creó y quién actualizó por última vez (email + nombre snapshot).
  creado_por_email text not null,
  creado_por_nombre text,
  actualizado_por_email text,
  actualizado_por_nombre text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists bitacora_cotizaciones_id_cot_idx
  on public.bitacora_cotizaciones (id_cotizacion);

create index if not exists bitacora_cotizaciones_creado_por_idx
  on public.bitacora_cotizaciones (creado_por_email);

create index if not exists bitacora_cotizaciones_estado_idx
  on public.bitacora_cotizaciones (estado);

-- Trigger: refrescar updated_at en cada UPDATE.
create or replace function public.bitacora_cotizaciones_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_bitacora_cot_set_updated on public.bitacora_cotizaciones;
create trigger trg_bitacora_cot_set_updated
before update on public.bitacora_cotizaciones
for each row execute function public.bitacora_cotizaciones_set_updated_at();
