-- (2026-09-29) Bloqueo de usuarios.
--
-- Hasta ahora, para sacar a alguien del sistema solo se podia cambiarle la
-- contraseña, y eso NO lo saca: Supabase no revoca los tokens existentes al
-- cambiarla por la Admin API, asi que la sesion abierta sigue funcionando
-- hasta que el refresh token caduque.
--
-- El bloqueo actua en dos frentes, a proposito:
--   · `bloqueado` acá  -> el AuthGuard lo rechaza en la siguiente peticion,
--     o sea la sesion ya abierta deja de servir casi al instante;
--   · ban en Supabase Auth -> no puede volver a iniciar sesion ni renovar el
--     token, aunque alguien le pase la contraseña nueva.
-- Con uno solo no alcanza: el flag sin el ban lo deja volver a entrar, y el
-- ban sin el flag lo deja dentro hasta que expire su token.

alter table public.profiles
  add column if not exists bloqueado          boolean not null default false,
  add column if not exists bloqueado_at       timestamptz,
  add column if not exists bloqueado_por      text,
  add column if not exists bloqueado_motivo   text;

-- El guard consulta por id en cada peticion (con cache corta): el indice
-- parcial mantiene esa lectura barata aunque la tabla crezca.
create index if not exists profiles_bloqueados_idx
  on public.profiles (id) where bloqueado;
