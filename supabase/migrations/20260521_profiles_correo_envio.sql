-- Casilla de correo del vendedor en el dominio Workspace (@amsodentmedical.cl).
-- Se usa para enviar correos a clientes impersonando al vendedor mediante la
-- delegación de todo el dominio de Google.
-- El campo "email" del perfil sigue siendo la cuenta de inicio de sesión
-- (puede ser un Gmail personal); "correo_envio" es la casilla corporativa.
alter table public.profiles
  add column if not exists correo_envio text;
