-- Firma de correo personalizable por usuario.
-- Si firma_html es NULL, el backend genera una firma por defecto con plantilla
-- bonita a partir del nombre, rol y correo del perfil. El usuario puede
-- sobrescribirla con HTML propio desde la sección "Mi firma" del Buzón.

alter table public.profiles
  add column if not exists firma_html text,
  add column if not exists firma_celular text,
  add column if not exists firma_cargo text;

comment on column public.profiles.firma_html is
  'Firma HTML del usuario para correos salientes. NULL = usar plantilla por defecto.';
comment on column public.profiles.firma_celular is
  'Teléfono / celular para mostrar en la firma (independiente del rol).';
comment on column public.profiles.firma_cargo is
  'Cargo libre que se muestra en la firma (ej: "Asesor Comercial"). Si NULL, se usa el rol.';
