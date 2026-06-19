-- Fotos / avatares para clientes, usuarios y contactos clave.
-- Las imágenes se guardan en el bucket público de Storage "avatars" y aquí
-- se almacena su URL pública.
--
-- IMPORTANTE: además de esta migración, crear en Supabase Storage un bucket
-- PÚBLICO llamado "avatars" (Dashboard → Storage → New bucket → Public).

alter table public.profiles          add column if not exists avatar_url text;
alter table public.clientes          add column if not exists foto_url   text;
alter table public.cliente_contactos add column if not exists foto_url   text;
