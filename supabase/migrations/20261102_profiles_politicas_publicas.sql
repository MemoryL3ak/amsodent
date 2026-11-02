-- Contención de seguridad, remate (2026-11-02).
--
-- Al aplicar 20260904_seguridad_contencion.sql se descubrió que profiles YA
-- tenía RLS con políticas antiguas (creadas desde el dashboard) que aplican a
-- PUBLIC, o sea también al rol anon del bundle:
--   · «Admins pueden ver todos» y «admins see all»: SELECT using (true)
--     → cualquiera en internet leía la tabla completa con la anon key.
--   · «Admins pueden editar cualquier perfil»: UPDATE using (true), y
--     «Usuarios pueden editar su perfil» / «update own profile»: UPDATE del
--     propio → un usuario podía reescribir su propio `rol` a 'admin' desde el
--     navegador (justo lo que la auditoría quería cerrar).
--   · «Admins pueden insertar perfiles»: INSERT para PUBLIC.
-- Ninguna de esas políticas comprueba el rol: el nombre engaña.
--
-- Modelo que queda (el de la contención): SELECT para cualquier autenticado
-- (la app muestra nombres/avatares del equipo); INSERT/UPDATE/DELETE sin
-- políticas → solo el backend (service_role). El frontend no escribe profiles
-- directamente (verificado el 2026-11-02: solo selects en ChatEquipo,
-- PresenceTracker y useAuth; editar usuarios va por PUT /usuarios/profiles/:id).
-- Re-ejecutable.

drop policy if exists "Admins pueden ver todos"             on public.profiles;
drop policy if exists "admins see all"                      on public.profiles;
drop policy if exists "Usuarios pueden ver su perfil"       on public.profiles;
drop policy if exists "select own profile"                  on public.profiles;
drop policy if exists "Admins pueden insertar perfiles"     on public.profiles;
drop policy if exists "Admins pueden editar cualquier perfil" on public.profiles;
drop policy if exists "Usuarios pueden editar su perfil"    on public.profiles;
drop policy if exists "update own profile"                  on public.profiles;

-- Se conservan (ambas solo para authenticated):
--   profiles_select_autenticados  (select, using true)   ← la de la contención
--   profiles_read_own             (select, id = auth.uid()) redundante, inofensiva
alter table public.profiles enable row level security;
