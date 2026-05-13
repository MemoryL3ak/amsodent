-- Portal del cliente: login con RUT + id_licitacion para ver detalle y subir documentos.
--
-- Cambios:
--   1. licitacion_documentos.subido_por_cliente: marca los documentos subidos
--      desde el portal (vs los que carga el equipo interno).
--   2. notificaciones: bandeja in-app por usuario. Se crea una al subir un doc
--      desde el portal, dirigida al creado_por de la licitación.

-- 1) Marcador de origen del documento + descripción libre (la usa el portal)
alter table public.licitacion_documentos
  add column if not exists subido_por_cliente boolean not null default false,
  add column if not exists descripcion text;

-- 2) Bandeja de notificaciones in-app
create table if not exists public.notificaciones (
  id          bigserial primary key,
  user_email  text not null,             -- destinatario (perfil.email)
  tipo        text not null,             -- p.ej. 'portal_upload', 'portal_login'
  mensaje     text not null,
  link        text,                      -- ruta relativa para click-through
  metadata    jsonb,                     -- payload libre (licitacion_id, etc.)
  leida_at    timestamptz,
  creado_at   timestamptz not null default now()
);

create index if not exists notificaciones_user_no_leidas_idx
  on public.notificaciones (user_email, leida_at)
  where leida_at is null;

create index if not exists notificaciones_creado_at_idx
  on public.notificaciones (creado_at desc);
