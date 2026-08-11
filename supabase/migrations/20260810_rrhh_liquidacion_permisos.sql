-- ============================================================================
-- RR.HH. — liquidación de sueldo completa + permisos por días y por horas
-- ----------------------------------------------------------------------------
-- Tres cosas:
--   1. `rrhh_parametros`: los valores previsionales y tributarios por período
--      (UF, UTM, ingreso mínimo, topes, tramos de asignación familiar). Antes
--      vivían en el .env, lo que hacía imposible reproducir una liquidación
--      antigua: al cambiar la UF cambiaba el cálculo de todos los períodos.
--   2. Columnas nuevas en `rrhh_liquidaciones` para los ítems que faltaban de
--      una liquidación chilena (asignación familiar por tramo, APV, licencias,
--      atrasos, cuota sindical) más el snapshot de lo usado al emitir.
--   3. Permisos medidos en horas y calendario de feriados legales, para que
--      los días hábiles no cuenten el 18 de septiembre.
--
-- RLS habilitado y SIN policies: el acceso pasa solo por el backend.
-- ============================================================================

-- ── 1. Parámetros previsionales por período ─────────────────────────────────
create table if not exists public.rrhh_parametros (
  periodo text primary key,                 -- 'YYYY-MM'
  uf numeric not null,                      -- UF del último día del mes (la que usa Previred)
  utm numeric not null,
  imm numeric not null,                     -- ingreso mínimo mensual
  tope_imponible_uf numeric not null default 87.8,
  tope_cesantia_uf numeric not null default 131.8,
  tasa_salud numeric not null default 7,
  tasa_cesantia_trabajador numeric not null default 0.6,   -- indefinido
  tasa_cesantia_empleador numeric not null default 2.4,    -- indefinido (3% a plazo fijo)
  tasa_sis numeric not null default 1.53,   -- seguro de invalidez y sobrevivencia (cargo empleador)
  tasa_mutual numeric not null default 0.95,-- cotización accidentes del trabajo (varía por empresa)
  -- Asignación familiar: monto por carga según la renta imponible del mes.
  af_tramo_a_hasta numeric not null default 620251,
  af_tramo_a_monto numeric not null default 22007,
  af_tramo_b_hasta numeric not null default 905941,
  af_tramo_b_monto numeric not null default 13505,
  af_tramo_c_hasta numeric not null default 1412957,
  af_tramo_c_monto numeric not null default 4267,
  -- Tope legal del APV con beneficio tributario (régimen B).
  apv_tope_uf_mensual numeric not null default 50,
  notas text,
  actualizado_por text,
  updated_at timestamptz not null default now()
);

alter table public.rrhh_parametros enable row level security;

comment on table public.rrhh_parametros is
  'Parámetros previsionales y tributarios por período. Si falta el período se usa el más reciente anterior; si no hay ninguno, los valores por defecto del backend.';

-- ── 2. Liquidaciones: ítems que faltaban ────────────────────────────────────
alter table public.rrhh_liquidaciones
  add column if not exists dias_licencia numeric default 0,
  add column if not exists horas_extra_valor numeric default 0,     -- valor de la hora extra usado
  add column if not exists semana_corrida numeric default 0,
  add column if not exists aguinaldo numeric default 0,
  add column if not exists cargas_familiares integer default 0,
  add column if not exists tramo_asignacion text,                   -- A | B | C | D
  add column if not exists apv numeric default 0,
  add column if not exists apv_regimen text,                        -- A | B
  add column if not exists descuento_atrasos numeric default 0,
  add column if not exists cuota_sindical numeric default 0,
  add column if not exists base_tributable numeric default 0,
  add column if not exists costo_empresa numeric default 0,         -- total con aportes patronales
  -- Snapshot de los parámetros y del desglose con que se emitió. Sin esto una
  -- liquidación reimpresa meses después mostraría montos distintos.
  add column if not exists detalle jsonb;

-- ── 3. Solicitudes: permisos por horas y media jornada ──────────────────────
alter table public.rrhh_solicitudes
  add column if not exists medida text not null default 'dias',     -- dias | horas
  add column if not exists hora_desde time,
  add column if not exists hora_hasta time,
  add column if not exists horas numeric,
  add column if not exists jornada_parcial text,                    -- manana | tarde  (permiso de medio día)
  add column if not exists goce_sueldo boolean not null default true,
  add column if not exists dias_corridos numeric,                   -- calendario, para licencias
  add column if not exists solicitado_por text,                     -- quién la registró
  add column if not exists visto_bueno_jefatura boolean;

-- Los tipos válidos quedan documentados aquí (el backend valida):
--   vacaciones | permiso_dias | permiso_horas | administrativo | licencia_medica
--   | sin_goce | dia_administrativo | fallecimiento | matrimonio | nacimiento
comment on column public.rrhh_solicitudes.medida is
  'dias = se descuentan días hábiles; horas = permiso dentro de una jornada (hora_desde/hora_hasta).';

-- ── 4. Feriados legales ─────────────────────────────────────────────────────
-- Los días hábiles de vacaciones no cuentan feriados. Tabla editable: cada año
-- se cargan los nuevos (los trasladables cambian de fecha según el día que caen).
create table if not exists public.rrhh_feriados (
  fecha date primary key,
  nombre text not null,
  irrenunciable boolean not null default false,
  tipo text not null default 'civil'        -- civil | religioso
);

alter table public.rrhh_feriados enable row level security;

insert into public.rrhh_feriados (fecha, nombre, irrenunciable, tipo) values
  ('2026-01-01', 'Año Nuevo', true, 'civil'),
  ('2026-04-03', 'Viernes Santo', false, 'religioso'),
  ('2026-04-04', 'Sábado Santo', false, 'religioso'),
  ('2026-05-01', 'Día Nacional del Trabajo', true, 'civil'),
  ('2026-05-21', 'Día de las Glorias Navales', false, 'civil'),
  ('2026-06-21', 'Día Nacional de los Pueblos Indígenas', false, 'civil'),
  ('2026-06-29', 'San Pedro y San Pablo', false, 'religioso'),
  ('2026-07-16', 'Virgen del Carmen', false, 'religioso'),
  ('2026-08-15', 'Asunción de la Virgen', false, 'religioso'),
  ('2026-09-18', 'Independencia Nacional', true, 'civil'),
  ('2026-09-19', 'Día de las Glorias del Ejército', true, 'civil'),
  ('2026-10-12', 'Encuentro de Dos Mundos', false, 'civil'),
  ('2026-10-31', 'Día de las Iglesias Evangélicas y Protestantes', false, 'religioso'),
  ('2026-11-01', 'Día de Todos los Santos', false, 'religioso'),
  ('2026-12-08', 'Inmaculada Concepción', false, 'religioso'),
  ('2026-12-25', 'Navidad', true, 'religioso')
on conflict (fecha) do nothing;

-- ── 5. Ficha: datos que alimentan la liquidación ────────────────────────────
alter table public.rrhh_empleados
  add column if not exists cargas_familiares integer default 0,
  add column if not exists apv_monto numeric default 0,
  add column if not exists apv_regimen text,                        -- A | B
  add column if not exists apv_institucion text,
  add column if not exists cuota_sindical numeric default 0,
  add column if not exists nacionalidad text,
  add column if not exists estado_civil text,
  -- Días administrativos pactados al año (no son legales, son de contrato).
  add column if not exists dias_administrativos_anuales numeric default 0;
