-- Trazabilidad de Despachos Internos.
-- El portal NO crea guías: rastrea las guías de despacho internas que ya
-- existen en el sistema — documentos de licitacion_documentos con
-- tipo = 'guia_despacho' y empresa_despacho = 'Despacho interno'.
-- Cada fila de 'despachos' es el seguimiento (estado, evidencia y firma)
-- de una de esas guías, vinculada por licitacion_documento_id.
--
-- Re-ejecutable: hace drop de las tablas antes de crearlas (no hay datos
-- productivos todavía).

drop table if exists public.despacho_eventos  cascade;
drop table if exists public.despacho_archivos cascade;
drop table if exists public.despachos         cascade;

create table public.despachos (
  id                      uuid primary key default gen_random_uuid(),
  licitacion_documento_id bigint not null unique,
  estado                  text not null default 'Preparación'
    check (estado in ('Preparación', 'En ruta', 'Entregado', 'No entregado')),
  receptor_nombre         text,
  receptor_rut            text,
  firma_path              text,
  firma_at                timestamptz,
  creado_por              text,
  entregado_at            timestamptz,
  created_at              timestamptz not null default now(),
  actualizado_at          timestamptz not null default now()
);

create index despachos_documento_idx on public.despachos (licitacion_documento_id);
create index despachos_estado_idx    on public.despachos (estado);

-- Adjuntos del despacho: fotos, PDF u otros archivos de evidencia.
create table public.despacho_archivos (
  id           uuid primary key default gen_random_uuid(),
  despacho_id  uuid not null references public.despachos(id) on delete cascade,
  tipo         text not null default 'foto' check (tipo in ('foto', 'pdf', 'otro')),
  storage_path text not null,
  nombre       text,
  mime         text,
  tamano       bigint,
  subido_por   text,
  created_at   timestamptz not null default now()
);

create index despacho_archivos_idx on public.despacho_archivos (despacho_id);

-- Bitácora de cambios de estado del despacho.
create table public.despacho_eventos (
  id          uuid primary key default gen_random_uuid(),
  despacho_id uuid not null references public.despachos(id) on delete cascade,
  estado      text,
  nota        text,
  autor       text,
  created_at  timestamptz not null default now()
);

create index despacho_eventos_idx on public.despacho_eventos (despacho_id, created_at);

-- RLS habilitado sin políticas: el acceso es exclusivamente desde el backend
-- (service_role), igual que correo_cuentas.
alter table public.despachos         enable row level security;
alter table public.despacho_archivos enable row level security;
alter table public.despacho_eventos  enable row level security;

-- Bucket privado para fotos, PDF y firmas. Se sirve mediante URLs firmadas.
insert into storage.buckets (id, name, public)
values ('despachos', 'despachos', false)
on conflict (id) do nothing;
