-- Acceso controlado al Portal del Cliente (stock):
--  - El acceso ya NO se otorga a todo RUT del maestro: el admin debe
--    habilitarlo explícitamente y por un período (1 mes, 3 meses o indefinido).
--  - Se exige contraseña (la define el admin al habilitar). En el primer
--    ingreso el cliente debe cambiarla (password_temporal).
--  - Las solicitudes de recuperación de clave del cliente llegan a una
--    bandeja interna (stock_recuperacion_solicitudes) que el admin resuelve
--    regenerando la clave.

-- 1) Columnas de acceso/credenciales sobre el registro del portal.
alter table public.stock_clientes_portal
  add column if not exists acceso_habilitado boolean not null default false,
  add column if not exists password_hash text,
  add column if not exists password_temporal boolean not null default true,
  add column if not exists acceso_vigencia text,        -- '1m' | '3m' | 'indefinido'
  add column if not exists acceso_expira timestamptz,    -- null = indefinido
  add column if not exists acceso_habilitado_en timestamptz,
  add column if not exists acceso_habilitado_por text,
  add column if not exists password_actualizada_en timestamptz;

comment on column public.stock_clientes_portal.acceso_habilitado is
  'El admin habilitó el acceso al portal para este cliente. Sin esto no puede ingresar.';
comment on column public.stock_clientes_portal.password_hash is
  'Hash scrypt de la contraseña: formato scrypt$<saltHex>$<hashHex>.';
comment on column public.stock_clientes_portal.password_temporal is
  'La clave actual es temporal (definida por el admin); el cliente debe cambiarla al ingresar.';
comment on column public.stock_clientes_portal.acceso_vigencia is
  'Período de habilitación elegido por el admin: 1m, 3m o indefinido.';
comment on column public.stock_clientes_portal.acceso_expira is
  'Fecha de expiración del acceso. null = indefinido.';

-- Restringe los valores válidos de vigencia.
alter table public.stock_clientes_portal
  drop constraint if exists stock_clientes_portal_vigencia_chk;
alter table public.stock_clientes_portal
  add constraint stock_clientes_portal_vigencia_chk
  check (acceso_vigencia is null or acceso_vigencia in ('1m', '3m', 'indefinido'));

-- 2) Bandeja de solicitudes de recuperación de clave (las genera el cliente
--    desde el portal y las resuelve el admin).
create table if not exists public.stock_recuperacion_solicitudes (
  id                bigserial primary key,
  rut               text not null,
  razon_social      text,
  contacto_nombre   text,
  contacto_email    text,
  contacto_telefono text,
  mensaje           text,
  estado            text not null default 'pendiente'
                      check (estado in ('pendiente', 'resuelta')),
  resuelta_at       timestamptz,
  resuelta_por      text,
  ip_address        text,
  user_agent        text,
  created_at        timestamptz not null default now()
);

create index if not exists stock_recuperacion_rut_idx
  on public.stock_recuperacion_solicitudes (rut);
create index if not exists stock_recuperacion_estado_idx
  on public.stock_recuperacion_solicitudes (estado);
create index if not exists stock_recuperacion_creado_idx
  on public.stock_recuperacion_solicitudes (created_at desc);

alter table public.stock_recuperacion_solicitudes enable row level security;

-- Realtime para que la bandeja del admin se actualice al instante.
do $$
begin
  begin
    alter publication supabase_realtime add table public.stock_recuperacion_solicitudes;
  exception
    when duplicate_object then null;
    when undefined_object then null;
  end;
end $$;
