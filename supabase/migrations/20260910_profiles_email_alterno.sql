-- (2026-09-10) Correo alterno por usuario: permite que una misma persona sea
-- reconocida por más de un correo en toda la plataforma (resolución de
-- nombres por creado_por/vendedor_correo, envío de correos con su cuenta
-- conectada, etc.). Editable por admin en la pantalla de Usuarios.
alter table public.profiles add column if not exists email_alterno text;

-- Jeremías Alarcón: inicia sesión con jer.consorcio@gmail.com y su casilla
-- corporativa es jer.alarcon@amsodentmedical.cl — ambos correos son él.
update public.profiles
   set email_alterno = 'jer.alarcon@amsodentmedical.cl'
 where lower(email) = 'jer.consorcio@gmail.com'
   and (email_alterno is null or email_alterno = '');
