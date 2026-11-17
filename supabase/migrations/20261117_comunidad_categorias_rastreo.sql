-- (2026-11-17) Comunidad Amsodent: categorías, personas de sorteos y eventos, y
-- clínicas rastreadas en Google Maps. Pedidos de Ariel:
--   · «todos los clientes/personas en sorteo y evento se deben visualizar en
--     Comunidad Amsodent»;
--   · «todas las filas de Comunidad se deben categorizar: Estudiante, Clínica,
--     Doctor Particular, Doctor Docente, Doctor Docente y Profesional Privado,
--     Doctor Docente y Profesional Público, Cliente Rastreado»;
--   · «un bot que vaya por comunas en Google Maps viendo clínicas dentales y
--     registre nombre, correo, teléfono, WhatsApp, página, dirección, comuna y
--     región; se almacenan en Comunidad como Cliente Rastreado».
--
-- La pantalla lista en vivo a las personas de sorteos y eventos (no se copian);
-- esta migración permite GUARDAR: la categoría elegida a mano y las clínicas
-- rastreadas. Es aditiva y se puede correr más de una vez.

-- 1) Una fila ya no es solo «persona que llenó el formulario»: una clínica
--    rastreada no tiene apellido y puede no tener correo ni teléfono.
alter table public.comunidad_registros alter column apellido drop not null;
alter table public.comunidad_registros alter column telefono drop not null;
alter table public.comunidad_registros alter column correo drop not null;
alter table public.comunidad_registros alter column perfil drop not null;

alter table public.comunidad_registros drop constraint if exists comunidad_registros_perfil_check;
alter table public.comunidad_registros
  add constraint comunidad_registros_perfil_check
  check (perfil is null or perfil in ('estudiante', 'dentista', 'clinica'));

-- 2) Categoría (null = sin elegir a mano: la pantalla propone una según el origen).
alter table public.comunidad_registros add column if not exists categoria text;
alter table public.comunidad_registros drop constraint if exists comunidad_registros_categoria_check;
alter table public.comunidad_registros
  add constraint comunidad_registros_categoria_check
  check (categoria is null or categoria in (
    'estudiante', 'clinica', 'doctor_particular', 'doctor_docente',
    'doctor_docente_privado', 'doctor_docente_publico', 'cliente_rastreado'
  ));
alter table public.comunidad_registros add column if not exists categoria_por text;
alter table public.comunidad_registros add column if not exists categoria_at timestamptz;

-- 3) De dónde viene la fila: 'comunidad' (formulario del QR), 'sorteo' o
--    'evento' (persona de esos módulos a la que se le guardó una categoría) y
--    'rastreo' (clínica encontrada en Google Maps).
alter table public.comunidad_registros add column if not exists fuente text not null default 'comunidad';
alter table public.comunidad_registros drop constraint if exists comunidad_registros_fuente_check;
alter table public.comunidad_registros
  add constraint comunidad_registros_fuente_check
  check (fuente in ('comunidad', 'sorteo', 'evento', 'rastreo'));

-- 4) Datos de contacto de las clínicas rastreadas.
alter table public.comunidad_registros add column if not exists whatsapp text;
alter table public.comunidad_registros add column if not exists sitio_web text;
alter table public.comunidad_registros add column if not exists direccion text;
alter table public.comunidad_registros add column if not exists comuna text;
alter table public.comunidad_registros add column if not exists region text;
alter table public.comunidad_registros add column if not exists place_id text;     -- id del lugar en Google Maps
alter table public.comunidad_registros add column if not exists maps_url text;
alter table public.comunidad_registros add column if not exists rastreo jsonb;     -- lo demás que entregó el rastreo (nota, reseñas, otros correos…)
alter table public.comunidad_registros add column if not exists updated_at timestamptz;

-- Un lugar de Google Maps se guarda una sola vez (volver a rastrear lo actualiza).
create unique index if not exists comunidad_registros_place_id_unique
  on public.comunidad_registros (place_id) where place_id is not null;

-- 5) El correo sigue siendo único entre PERSONAS; las clínicas rastreadas pueden
--    repetirlo (sucursales de una misma clínica) o coincidir con el de una persona.
alter table public.comunidad_registros drop constraint if exists comunidad_registros_correo_key;
create unique index if not exists comunidad_registros_correo_persona_unique
  on public.comunidad_registros (lower(correo))
  where correo is not null and fuente <> 'rastreo';

create index if not exists comunidad_registros_categoria_idx on public.comunidad_registros (categoria);
create index if not exists comunidad_registros_fuente_idx on public.comunidad_registros (fuente);

-- 6) Bitácora de rastreos: qué comuna se buscó, cuándo, cuánto se encontró y se guardó.
create table if not exists public.comunidad_rastreos (
  id bigserial primary key,
  region text not null,
  comuna text not null,
  encontrados integer not null default 0,   -- lugares que devolvió Google Maps
  guardados integer not null default 0,     -- clínicas nuevas guardadas en Comunidad
  actualizados integer not null default 0,  -- clínicas que ya estaban y se actualizaron
  usuario_email text,
  created_at timestamptz not null default now()
);
create index if not exists comunidad_rastreos_comuna_idx on public.comunidad_rastreos (region, comuna, created_at desc);

-- RLS: todo bloqueado; solo el backend (service-role) lee y escribe.
alter table public.comunidad_rastreos enable row level security;
