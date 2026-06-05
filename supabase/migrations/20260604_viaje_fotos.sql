-- Fotos del despacho que el chofer sube desde su portal como respaldo de la
-- entrega. Cada foto se guarda en el bucket privado `viajes` (URLs firmadas) y
-- se referencia por viaje. Marcar un viaje como "Entregado" desde el portal
-- exige al menos una foto (validado en el backend).

create table if not exists public.viaje_fotos (
  id           uuid primary key default gen_random_uuid(),
  viaje_id     uuid not null references public.viajes(id) on delete cascade,
  storage_path text not null,
  nombre       text,
  mime         text,
  tamano       bigint,
  tomada_por   text,                        -- "chofer:{id}" o email del autor
  created_at   timestamptz not null default now()
);
create index if not exists viaje_fotos_viaje_idx
  on public.viaje_fotos (viaje_id, created_at desc);

comment on table public.viaje_fotos is
  'Fotos del despacho subidas por el chofer desde el portal (respaldo de entrega).';

-- RLS habilitada sin políticas: acceso exclusivo desde el backend (service_role).
alter table public.viaje_fotos enable row level security;

-- Bucket privado para las fotos de despacho. Se sirve mediante URLs firmadas.
insert into storage.buckets (id, name, public)
values ('viajes', 'viajes', false)
on conflict (id) do nothing;
