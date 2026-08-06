-- Multi-evento: "Evento Santiago" y "Evento Viña del Mar" comparten la tabla
-- de inscripciones; la columna `evento` distingue a cuál se inscribió la
-- persona. (El evento de Viña del Mar se llamó "brasil" al inicio.)
-- Además, tabla de invitaciones: correos agregados desde el módulo a los que
-- se les envía el correo con el link al formulario de inscripción del evento.

alter table public.evento_inscripciones
  add column if not exists evento text not null default 'santiago';

-- El correo deja de ser único global: pasa a ser único POR evento (una misma
-- persona puede inscribirse en Santiago y en Viña del Mar).
alter table public.evento_inscripciones
  drop constraint if exists evento_inscripciones_correo_key;
create unique index if not exists evento_inscripciones_evento_correo_key
  on public.evento_inscripciones (evento, correo);

create table if not exists public.evento_invitaciones (
  id bigserial primary key,
  evento text not null,
  correo text not null,
  enviado boolean not null default false,
  enviado_at timestamptz,
  error text,
  agregado_por text,
  created_at timestamptz not null default now(),
  unique (evento, correo)
);

alter table public.evento_invitaciones enable row level security;

-- Renombre: el segundo evento no es en Brasil sino en Viña del Mar (clave `vina`).
update public.evento_inscripciones set evento = 'vina' where evento = 'brasil';
update public.evento_invitaciones set evento = 'vina' where evento = 'brasil';
