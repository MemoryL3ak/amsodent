-- Cuentas de correo conectadas por OAuth de Google.
-- Cada vendedor conecta su propia cuenta de Google desde "Mi Correo"
-- (sirve tanto para casillas @amsodentmedical.cl como @gmail.com).
-- Guardamos el refresh_token para enviar correos en su nombre y leer su
-- bandeja a través de la API de Gmail.
--
-- Tabla sensible: contiene tokens de acceso. RLS habilitado SIN políticas,
-- de modo que solo el backend (service_role, que omite RLS) puede leerla.
create table if not exists public.correo_cuentas (
  user_id        uuid primary key references auth.users(id) on delete cascade,
  email          text not null,
  refresh_token  text not null,
  scopes         text,
  conectado_at   timestamptz not null default now(),
  actualizado_at timestamptz not null default now()
);

alter table public.correo_cuentas enable row level security;
