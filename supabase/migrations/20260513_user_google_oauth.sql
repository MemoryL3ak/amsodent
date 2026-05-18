-- Almacena los refresh tokens de Google OAuth para que el backend pueda enviar
-- correos via Gmail API en nombre del usuario logueado.
--
-- El refresh_token es de larga duración (mientras el usuario no revoque la app
-- en su cuenta Google). Lo usamos para obtener access_tokens (1h de vigencia)
-- a demanda al momento de enviar un correo.

create table if not exists public.user_google_oauth (
  user_email     text primary key,                 -- email del usuario en profiles (Supabase auth)
  google_email   text not null,                    -- email Google asociado (el que realmente enviará)
  refresh_token  text not null,                    -- refresh token entregado por Google
  scopes         text,                             -- lista de scopes autorizados (space-separated)
  connected_at   timestamptz not null default now(),
  last_used_at   timestamptz
);

create index if not exists user_google_oauth_google_email_idx
  on public.user_google_oauth (google_email);
