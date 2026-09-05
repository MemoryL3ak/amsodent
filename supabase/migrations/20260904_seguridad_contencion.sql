-- Contención de la auditoría de seguridad (2026-09-04) — parte 1.
--
-- (1) RLS en public.profiles. Es EL prerrequisito de todo el modelo de
-- autorización: los guards del backend y las políticas de monitor deciden
-- leyendo profiles.rol, y hasta ahora cualquier usuario autenticado podía
-- reescribir su propio rol a 'admin' desde el navegador (la tabla no tenía
-- RLS y el bundle lleva la anon key). Con esto:
--   · SELECT: cualquier autenticado (la app muestra nombres/avatares de
--     todo el equipo en chat, paneles y bitácora).
--   · INSERT/UPDATE/DELETE: sin políticas → solo el backend (service_role).
--     La única escritura del frontend (editar usuarios) ya se movió al
--     endpoint PUT /usuarios/profiles/:id con AdminGuard.
alter table public.profiles enable row level security;

drop policy if exists profiles_select_autenticados on public.profiles;
create policy profiles_select_autenticados
  on public.profiles for select
  to authenticated
  using (true);

-- (2) Funciones del monitoreo de sesiones: se crearon SECURITY DEFINER y, por
-- el default de Postgres, quedaron ejecutables por PUBLIC — es decir, por
-- ANÓNIMOS vía /rest/v1/rpc: cualquiera en internet podía inflar las horas de
-- actividad de un empleado (recibe el user_id como parámetro) o cerrar todas
-- las sesiones abiertas (p_stale_seconds => 0). Se revoca a public/anon; se
-- mantiene authenticated porque el SessionTracker del frontend las llama.
revoke execute on function public.fn_upsert_activity_daily(uuid, date, int, int, timestamptz) from public, anon;
revoke execute on function public.fn_close_stale_sessions(int) from public, anon;
grant execute on function public.fn_upsert_activity_daily(uuid, date, int, int, timestamptz) to authenticated;
grant execute on function public.fn_close_stale_sessions(int) to authenticated;

-- (3) chat-adjuntos: la política de lectura aplicaba también a anon (permitía
-- LISTAR el bucket sin autenticación). Se restringe a authenticated. El flag
-- public=true del bucket sigue sirviendo los archivos por URL directa — ese
-- cambio (bucket privado + URLs firmadas) es la fase 2, porque requiere
-- migrar las 4 pantallas que hoy usan la URL pública.
drop policy if exists "chat_adjuntos_lectura" on storage.objects;
create policy "chat_adjuntos_lectura"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'chat-adjuntos');
