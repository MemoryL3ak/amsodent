-- (2026-09-16) Varios usuarios por RUT en el portal de clientes, con rol.
--
-- Hasta ahora el acceso era una credencial por RUT guardada en
-- stock_clientes_portal: toda la clínica compartía la misma clave y no había
-- forma de saber quién pidió qué, ni de quitarle el acceso a una persona sin
-- cortárselo a todos. Esta tabla permite N usuarios por RUT, cada uno con su
-- correo, su clave y su rol:
--
--   · admin     → puede todo, incluidas la aprobación de la cotización y el pago.
--   · asistente → puede todo lo demás (armar carro, pedir cotización, ver
--                 historial), pero NO aprueba ni paga.
--
-- La credencial antigua de stock_clientes_portal se mantiene: quien ya
-- ingresaba solo con RUT + clave sigue haciéndolo (cuenta principal, rol
-- admin). Los usuarios nuevos ingresan con RUT + correo + clave.
create table if not exists public.portal_usuarios (
  id                      bigserial primary key,
  rut                     text not null,
  email                   text not null,
  nombre                  text,
  password_hash           text not null,
  password_temporal       boolean not null default true,
  rol                     text not null default 'asistente'
                            check (rol in ('admin', 'asistente')),
  activo                  boolean not null default true,
  ultimo_acceso           timestamptz,
  password_actualizada_en timestamptz,
  creado_por              text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

-- Un mismo correo no se repite dentro del RUT (sí puede existir en otro RUT:
-- un contador externo puede atender a dos clínicas distintas).
create unique index if not exists portal_usuarios_rut_email_uk
  on public.portal_usuarios (rut, lower(email));
create index if not exists portal_usuarios_rut_idx
  on public.portal_usuarios (rut);

comment on table public.portal_usuarios is
  'Usuarios del portal de clientes: varios por RUT, cada uno con su rol.';
comment on column public.portal_usuarios.rol is
  'admin = puede aprobar y pagar; asistente = todo lo demás.';

alter table public.portal_usuarios enable row level security;
