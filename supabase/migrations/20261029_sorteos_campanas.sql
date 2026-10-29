-- Sorteos múltiples (2026-10-29).
-- Antes había UN sorteo global con un formulario fijo (abril 2026). Ahora cada
-- sorteo tiene su propio QR, formulario público (/sorteo/<slug>), participantes
-- y ganadores. Re-ejecutable.

create table if not exists public.sorteos (
  id            bigserial primary key,
  slug          text        not null unique,          -- parte final del enlace del QR
  titulo        text        not null,
  subtitulo     text,
  premio        text,
  universidad   text,                                 -- "¿Eres estudiante de la …?"
  color         text        not null default '#28aeb1',
  color_acento  text        not null default '#f59e0b',
  activo        boolean     not null default true,    -- inscripciones abiertas
  created_by    uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- RLS: todo bloqueado; solo el backend (service-role) lee y escribe.
alter table public.sorteos enable row level security;

-- Participantes: pasan a colgar de un sorteo y el formulario nuevo pregunta
-- "¿eres estudiante?" y "¿en qué año vas?" en vez de perfil/especialidad.
alter table public.sorteo_participantes add column if not exists sorteo_id bigint references public.sorteos(id) on delete cascade;
alter table public.sorteo_participantes add column if not exists es_estudiante boolean;
alter table public.sorteo_participantes add column if not exists anio text;
alter table public.sorteo_participantes alter column tipo_perfil drop not null;
alter table public.sorteo_participantes alter column especialidad drop not null;

-- Los registros del formulario antiguo quedan en un sorteo histórico cerrado,
-- así siguen visibles y exportables desde el panel.
insert into public.sorteos (slug, titulo, subtitulo, activo)
select 'sorteo-2026', 'Sorteo Amsodent 2026', 'Registros del formulario anterior (abril 2026)', false
 where exists (select 1 from public.sorteo_participantes where sorteo_id is null)
   and not exists (select 1 from public.sorteos where slug = 'sorteo-2026');

update public.sorteo_participantes
   set sorteo_id = (select id from public.sorteos where slug = 'sorteo-2026')
 where sorteo_id is null;

-- Sorteo vigente (2026-10-29): evento en la Universidad Viña del Mar (UVM).
-- Queda abierto y es el destino de /sorteo (y de los QR antiguos); el título,
-- el premio y los colores se ajustan desde el panel.
insert into public.sorteos (slug, titulo, subtitulo, premio, universidad, activo)
select 'sorteo-uvm', 'Sorteo Amsodent · UVM',
       'Déjanos tus datos y quedarás participando por nuestro sorteo.',
       null, 'Universidad Viña del Mar', true
 where not exists (select 1 from public.sorteos where slug = 'sorteo-uvm');

-- Un correo participa una vez POR SORTEO (antes el correo era único global).
drop index if exists public.sorteo_participantes_email_unique;
create unique index if not exists sorteo_participantes_sorteo_email_unique
  on public.sorteo_participantes (sorteo_id, lower(email));
create index if not exists sorteo_participantes_sorteo_idx
  on public.sorteo_participantes (sorteo_id);
