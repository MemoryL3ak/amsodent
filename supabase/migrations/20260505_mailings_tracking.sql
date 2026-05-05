-- Tracking de aperturas de correos masivos.
-- Cada envío genera una fila en mailings_envios y N filas (una por
-- destinatario) en mailings_destinatarios con un token único. Cuando el
-- cliente del destinatario carga el pixel <img src="…/track/open?t=token">,
-- se actualiza abierto_at.

create table if not exists public.mailings_envios (
  id              bigserial primary key,
  asunto          text        not null,
  total           integer     not null default 0,
  enviados        integer     not null default 0,
  fallidos        integer     not null default 0,
  con_flyer       boolean     not null default false,
  creado_por      text,
  creado_at       timestamptz not null default now()
);

create table if not exists public.mailings_destinatarios (
  id           bigserial primary key,
  envio_id     bigint references public.mailings_envios(id) on delete cascade,
  email        text        not null,
  token        text        not null unique,
  enviado_at   timestamptz,
  abierto_at   timestamptz,
  fallo        text,
  user_agent   text,
  creado_at    timestamptz not null default now()
);

create index if not exists mailings_destinatarios_email_idx
  on public.mailings_destinatarios(email);
create index if not exists mailings_destinatarios_envio_idx
  on public.mailings_destinatarios(envio_id);
create index if not exists mailings_destinatarios_abierto_idx
  on public.mailings_destinatarios(abierto_at)
  where abierto_at is not null;
