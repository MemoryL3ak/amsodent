-- Reajuste porcentual por courier: ajusta los valores del tarifario al
-- calcular el flete (10 = +10%, -5 = -5%). No modifica las tablas de tarifas.
create table if not exists public.fletes_reajuste (
  empresa text primary key,
  porcentaje numeric not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.fletes_reajuste enable row level security;

insert into public.fletes_reajuste (empresa, porcentaje)
values ('Starken', 0), ('Blue', 0)
on conflict (empresa) do nothing;
