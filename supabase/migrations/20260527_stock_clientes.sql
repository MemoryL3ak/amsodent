-- Portal de stock del cliente.
-- El cliente entra con su RUT, acepta acuerdo de confidencialidad,
-- declara productos con stock actual y mínimo, y el sistema calcula
-- un semáforo. Cuando hay items en amarillo o rojo, se notifica a
-- una lista de usuarios internos configurable.

-- ============================================================
-- Tabla: stock_clientes_portal
-- Identidad del cliente en el portal. PK por RUT normalizado.
-- ============================================================
create table if not exists public.stock_clientes_portal (
  rut                 text primary key,         -- normalizado: solo dígitos + k minúscula
  razon_social        text,
  email               text,
  telefono            text,

  -- Aceptación del acuerdo de confidencialidad (se registra 1 vez por RUT)
  acepto_acuerdo_en   timestamptz,
  acepto_acuerdo_ip   text,

  ultimo_acceso       timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- ============================================================
-- Tabla: stock_productos_cliente
-- Lista persistente de productos que declara el cliente. Al volver
-- a entrar ve sus productos precargados para solo ajustar cantidades.
-- ============================================================
create table if not exists public.stock_productos_cliente (
  id                bigserial primary key,
  rut               text not null references public.stock_clientes_portal(rut) on delete cascade,
  nombre            text not null,
  unidad            text,                       -- opcional: "unidad", "caja", etc.
  stock_actual      numeric(14,2) not null default 0,
  stock_minimo      numeric(14,2) not null default 0,
  activo            boolean not null default true,
  actualizado_at    timestamptz not null default now(),
  created_at        timestamptz not null default now()
);

create index if not exists stock_productos_cliente_rut_idx
  on public.stock_productos_cliente (rut);

-- ============================================================
-- Tabla: stock_declaraciones
-- Snapshot de una declaración (cabecera + items en JSONB).
-- ============================================================
create table if not exists public.stock_declaraciones (
  id                bigserial primary key,
  rut               text not null,
  razon_social      text,
  fecha             timestamptz not null default now(),

  total_items       integer not null default 0,
  total_verdes      integer not null default 0,
  total_amarillos   integer not null default 0,
  total_rojos       integer not null default 0,

  -- Cada item: { nombre, unidad, stock_actual, stock_minimo, semaforo }
  items             jsonb not null default '[]'::jsonb,

  ip_address        text,
  user_agent        text,
  created_at        timestamptz not null default now()
);

create index if not exists stock_declaraciones_rut_idx
  on public.stock_declaraciones (rut);
create index if not exists stock_declaraciones_fecha_idx
  on public.stock_declaraciones (fecha desc);

-- ============================================================
-- Tabla: stock_destinatarios
-- Usuarios internos que reciben alerta (campana y/o correo)
-- cuando un cliente declara stock en amarillo o rojo.
-- ============================================================
create table if not exists public.stock_destinatarios (
  id                bigserial primary key,
  user_email        text not null unique,
  recibe_campana    boolean not null default true,
  recibe_correo     boolean not null default true,
  activo            boolean not null default true,
  created_at        timestamptz not null default now()
);

-- ============================================================
-- RLS
-- Las tablas son operadas por el backend con service_role; el frontend
-- público nunca toca Supabase directamente — pasa por el backend con
-- token del portal de stock.
-- ============================================================
alter table public.stock_clientes_portal    enable row level security;
alter table public.stock_productos_cliente  enable row level security;
alter table public.stock_declaraciones      enable row level security;
alter table public.stock_destinatarios      enable row level security;

-- Lectura para autenticados internos del dashboard.
drop policy if exists "stock_declaraciones select autenticados" on public.stock_declaraciones;
create policy "stock_declaraciones select autenticados"
  on public.stock_declaraciones for select to authenticated using (true);

drop policy if exists "stock_clientes_portal select autenticados" on public.stock_clientes_portal;
create policy "stock_clientes_portal select autenticados"
  on public.stock_clientes_portal for select to authenticated using (true);

drop policy if exists "stock_destinatarios select autenticados" on public.stock_destinatarios;
create policy "stock_destinatarios select autenticados"
  on public.stock_destinatarios for select to authenticated using (true);

-- Realtime para refrescar el dashboard al recibir declaraciones nuevas.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'stock_declaraciones'
  ) then
    alter publication supabase_realtime add table public.stock_declaraciones;
  end if;
end $$;
