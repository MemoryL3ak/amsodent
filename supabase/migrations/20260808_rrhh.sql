-- ============================================================================
-- Módulo de Recursos Humanos
-- ----------------------------------------------------------------------------
-- Ficha del trabajador + contratos, liquidaciones de sueldo, evaluaciones de
-- desempeño, solicitudes (vacaciones/permisos/licencias), documentos y firmas
-- electrónicas simples. La asistencia reutiliza las tablas existentes
-- `marcajes` / `marcaje_oficinas` (módulo de marcaje) y aquí solo se agregan
-- las jornadas pactadas para poder calcular atrasos, horas y ausencias.
--
-- Convención de acceso: todas las tablas quedan con RLS habilitado y SIN
-- policies — el acceso pasa exclusivamente por el backend (service_role),
-- que aplica AdminGuard para RR.HH. y filtra por email en el portal del
-- trabajador. Datos sensibles (sueldos, evaluaciones) nunca se exponen a
-- consultas directas desde el navegador.
-- ============================================================================

-- ── Ficha del trabajador ────────────────────────────────────────────────────
create table if not exists public.rrhh_empleados (
  id bigserial primary key,
  email text unique,                       -- vínculo con profiles.email (null si no usa el sistema)
  rut text,
  nombre text not null,
  apellidos text,
  fecha_nacimiento date,
  telefono text,
  direccion text,
  comuna text,
  -- Datos laborales
  cargo text,
  area text,                               -- área / departamento
  jefatura_email text,                     -- a quién reporta (para evaluaciones y aprobaciones)
  fecha_ingreso date,
  fecha_egreso date,
  tipo_contrato text,                      -- indefinido | plazo_fijo | honorarios | part_time | reemplazo
  jornada text,                            -- completa | parcial | turnos
  horas_semanales numeric default 45,
  -- Remuneración base (se usa para prellenar liquidaciones)
  sueldo_base numeric default 0,
  gratificacion_legal boolean default true,-- art. 50: 25% del imponible con tope
  colacion numeric default 0,              -- no imponible
  movilizacion numeric default 0,          -- no imponible
  -- Previsión
  afp text,                                -- Capital, Cuprum, Habitat, Modelo, PlanVital, ProVida, Uno
  tasa_afp numeric,                        -- % dependiente de la AFP (ej: 11.44)
  salud text,                              -- Fonasa | Isapre <nombre>
  plan_salud_uf numeric,                   -- UF pactadas si es Isapre
  -- Pago de la remuneración
  banco text,
  tipo_cuenta text,
  numero_cuenta text,
  -- Emergencia
  contacto_emergencia text,
  telefono_emergencia text,
  -- Vacaciones: saldo arrastrado al momento de cargar la ficha (días hábiles)
  dias_vacaciones_iniciales numeric default 0,
  estado text not null default 'activo',   -- activo | inactivo | finiquitado
  notas text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists rrhh_empleados_estado_idx on public.rrhh_empleados (estado);
create index if not exists rrhh_empleados_email_idx on public.rrhh_empleados (lower(email));
alter table public.rrhh_empleados enable row level security;

-- ── Contratos y anexos ──────────────────────────────────────────────────────
create table if not exists public.rrhh_contratos (
  id bigserial primary key,
  empleado_id bigint not null references public.rrhh_empleados (id) on delete cascade,
  tipo text not null default 'contrato',   -- contrato | anexo | finiquito | carta_amonestacion
  titulo text,
  fecha_inicio date,
  fecha_termino date,                      -- null en indefinidos
  cargo text,
  sueldo_base numeric,
  jornada text,
  contenido text,                          -- texto del contrato (para firmar en pantalla)
  -- Archivo firmado / original en el bucket privado 'rrhh'
  bucket text,
  storage_path text,
  file_name text,
  estado text not null default 'borrador', -- borrador | enviado | firmado | vencido | anulado
  firmado_at timestamptz,
  creado_por text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists rrhh_contratos_empleado_idx on public.rrhh_contratos (empleado_id);
create index if not exists rrhh_contratos_estado_idx on public.rrhh_contratos (estado);
alter table public.rrhh_contratos enable row level security;

-- ── Liquidaciones de sueldo ─────────────────────────────────────────────────
-- Montos en pesos. Estructura de una liquidación chilena: haberes imponibles,
-- haberes no imponibles, descuentos legales y otros descuentos.
create table if not exists public.rrhh_liquidaciones (
  id bigserial primary key,
  empleado_id bigint not null references public.rrhh_empleados (id) on delete cascade,
  periodo text not null,                   -- 'YYYY-MM'
  dias_trabajados numeric default 30,
  dias_ausencia numeric default 0,
  -- Haberes imponibles
  sueldo_base numeric default 0,
  gratificacion numeric default 0,
  horas_extra_cantidad numeric default 0,
  horas_extra numeric default 0,
  bonos numeric default 0,
  comisiones numeric default 0,
  otros_imponibles numeric default 0,
  total_imponible numeric default 0,
  -- Haberes no imponibles
  colacion numeric default 0,
  movilizacion numeric default 0,
  asignacion_familiar numeric default 0,
  otros_no_imponibles numeric default 0,
  total_haberes numeric default 0,
  -- Descuentos legales
  afp_monto numeric default 0,
  salud_monto numeric default 0,
  seguro_cesantia numeric default 0,
  impuesto_unico numeric default 0,
  -- Otros descuentos
  anticipos numeric default 0,
  prestamos numeric default 0,
  otros_descuentos numeric default 0,
  total_descuentos numeric default 0,
  liquido numeric default 0,
  -- Documento y estado
  bucket text,
  storage_path text,
  file_name text,
  estado text not null default 'borrador', -- borrador | emitida | firmada | pagada
  emitida_at timestamptz,
  firmada_at timestamptz,
  pagada_at timestamptz,
  observaciones text,
  creado_por text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (empleado_id, periodo)
);

create index if not exists rrhh_liquidaciones_periodo_idx on public.rrhh_liquidaciones (periodo);
create index if not exists rrhh_liquidaciones_empleado_idx on public.rrhh_liquidaciones (empleado_id);
alter table public.rrhh_liquidaciones enable row level security;

-- ── Solicitudes: vacaciones, permisos, licencias ────────────────────────────
create table if not exists public.rrhh_solicitudes (
  id bigserial primary key,
  empleado_id bigint not null references public.rrhh_empleados (id) on delete cascade,
  tipo text not null,                      -- vacaciones | permiso | licencia_medica | administrativo | sin_goce
  fecha_desde date not null,
  fecha_hasta date not null,
  dias numeric,                            -- días hábiles calculados
  motivo text,
  estado text not null default 'pendiente',-- pendiente | aprobada | rechazada | anulada
  resuelto_por text,
  resuelto_at timestamptz,
  comentario_resolucion text,
  -- Respaldo (licencia médica, certificado)
  bucket text,
  storage_path text,
  file_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists rrhh_solicitudes_empleado_idx on public.rrhh_solicitudes (empleado_id);
create index if not exists rrhh_solicitudes_estado_idx on public.rrhh_solicitudes (estado);
alter table public.rrhh_solicitudes enable row level security;

-- ── Evaluaciones de desempeño ───────────────────────────────────────────────
-- `competencias` es un arreglo jsonb: [{ nombre, peso, puntaje, comentario }]
create table if not exists public.rrhh_evaluaciones (
  id bigserial primary key,
  empleado_id bigint not null references public.rrhh_empleados (id) on delete cascade,
  periodo text not null,                   -- '2026-S1', '2026-Q3', '2026'
  tipo text not null default 'desempeno',  -- desempeno | periodo_prueba | 360 | objetivos
  evaluador_email text,
  evaluador_nombre text,
  competencias jsonb not null default '[]'::jsonb,
  puntaje numeric,                         -- 1 a 5 (promedio ponderado)
  fortalezas text,
  oportunidades text,
  compromisos text,                        -- plan de acción acordado
  comentario_empleado text,                -- descargo/observación del trabajador
  estado text not null default 'borrador', -- borrador | enviada | firmada
  fecha_evaluacion date default current_date,
  firmada_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists rrhh_evaluaciones_empleado_idx on public.rrhh_evaluaciones (empleado_id);
create index if not exists rrhh_evaluaciones_periodo_idx on public.rrhh_evaluaciones (periodo);
alter table public.rrhh_evaluaciones enable row level security;

-- ── Documentos varios del trabajador ────────────────────────────────────────
create table if not exists public.rrhh_documentos (
  id bigserial primary key,
  empleado_id bigint not null references public.rrhh_empleados (id) on delete cascade,
  tipo text not null default 'otro',       -- certificado | amonestacion | titulo | cedula | otro
  titulo text,
  descripcion text,
  bucket text,
  storage_path text,
  file_name text,
  mime_type text,
  size_bytes bigint,
  requiere_firma boolean default false,
  visible_trabajador boolean default true, -- si el trabajador lo ve en su portal
  subido_por text,
  created_at timestamptz not null default now()
);

create index if not exists rrhh_documentos_empleado_idx on public.rrhh_documentos (empleado_id);
alter table public.rrhh_documentos enable row level security;

-- ── Firmas electrónicas simples ─────────────────────────────────────────────
-- Registra el acto de firma de cualquier documento del módulo: quién, cuándo,
-- desde dónde, con el trazo de la firma y un hash del contenido firmado (para
-- poder demostrar que el documento no cambió después de firmarse).
create table if not exists public.rrhh_firmas (
  id bigserial primary key,
  documento_tipo text not null,            -- contrato | liquidacion | evaluacion | documento
  documento_id bigint not null,
  empleado_id bigint references public.rrhh_empleados (id) on delete set null,
  firmante_email text,
  firmante_nombre text,
  firmante_rut text,
  firma_imagen text,                       -- dataURL PNG del trazo (firma manuscrita en pantalla)
  hash_documento text,                     -- SHA-256 del contenido firmado
  ip_address text,
  user_agent text,
  firmado_at timestamptz not null default now()
);

create index if not exists rrhh_firmas_doc_idx on public.rrhh_firmas (documento_tipo, documento_id);
alter table public.rrhh_firmas enable row level security;

-- ── Jornadas pactadas (para calcular atrasos y horas trabajadas) ────────────
-- Un registro por trabajador y día de semana (0=domingo … 6=sábado).
create table if not exists public.rrhh_jornadas (
  id bigserial primary key,
  empleado_id bigint not null references public.rrhh_empleados (id) on delete cascade,
  dia_semana smallint not null check (dia_semana between 0 and 6),
  hora_entrada time,
  hora_salida time,
  colacion_minutos integer default 60,
  activo boolean not null default true,
  unique (empleado_id, dia_semana)
);

create index if not exists rrhh_jornadas_empleado_idx on public.rrhh_jornadas (empleado_id);
alter table public.rrhh_jornadas enable row level security;

-- ── Bucket privado para documentos de RR.HH. ────────────────────────────────
-- Privado: los archivos se sirven con URL firmada desde el backend, nunca
-- con URL pública (contienen sueldos y datos personales).
insert into storage.buckets (id, name, public)
values ('rrhh', 'rrhh', false)
on conflict (id) do nothing;
