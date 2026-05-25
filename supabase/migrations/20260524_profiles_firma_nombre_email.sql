-- Permite que cada usuario sobrescriba el nombre y el correo que aparecen
-- en su firma de correo, sin tocar los campos canónicos del perfil
-- (auth.users.email, profiles.nombre). Si quedan en NULL, la firma usa
-- los datos del perfil como antes.

alter table public.profiles
  add column if not exists firma_nombre text,
  add column if not exists firma_email  text;
