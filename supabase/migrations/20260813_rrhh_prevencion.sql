-- ============================================================================
-- RR.HH. — Prevención de Riesgos (Decreto Supremo 44/2023, vigente 01-02-2025)
-- ----------------------------------------------------------------------------
-- El D.S. 44 (deroga los DS 40 y 54 de 1969) obliga a TODA entidad empleadora
-- a gestionar la prevención de riesgos y a "registrar y respaldar de forma
-- documental y fidedigna toda la información vinculada a la gestión de los
-- riesgos laborales (...) preferentemente en formato electrónico, a
-- disposición de la entidad fiscalizadora" (art. 72). Estas tablas son ese
-- registro electrónico:
--
--   · rrhh_sst_documentos  → documentos del sistema de gestión (matriz IPER
--     art. 7, programa preventivo art. 8, reglamento interno art. 56, plan de
--     emergencia art. 19, mapa de riesgos art. 62, actas de delegado/comité),
--     con versión y fecha de próxima revisión (la matriz se revisa al menos
--     una vez al año).
--   · rrhh_sst_actividades + rrhh_sst_asistentes → capacitaciones (art. 16,
--     mínimo 8 h cada ≤2 años, con resultado de evaluación), obligación de
--     informar los riesgos / ODI (art. 15), entrega y capacitación de EPP
--     (art. 13, mínimo 1 h con refuerzo anual) y simulacros del plan de
--     emergencia (art. 19: ensayo al menos una vez al año).
--   · rrhh_sst_incidentes  → incidentes peligrosos, accidentes del trabajo y
--     de trayecto y enfermedades profesionales (arts. 71, 73 y 75: lugar,
--     fecha y hora, sexo de la persona, relato, causas y medidas correctivas)
--     + de aquí sale la tasa anual de accidentabilidad (art. 75).
--
-- Convención de acceso: RLS habilitado y SIN policies; todo pasa por el
-- backend (service_role + AdminGuard), igual que el resto del módulo RR.HH.
-- ============================================================================

-- ── Documentos del sistema de gestión (nivel empresa, no por trabajador) ────
create table if not exists public.rrhh_sst_documentos (
  id bigserial primary key,
  tipo text not null,                      -- politica_sst | matriz_riesgos | programa_preventivo |
                                           -- reglamento_interno | plan_emergencia | mapa_riesgos |
                                           -- acta_delegado | acta_comite | otro
  titulo text,
  version text,
  fecha_aprobacion date,
  proxima_revision date,                   -- vencida → el checklist lo marca en alerta
  aprobado_por text,
  descripcion text,
  bucket text,
  storage_path text,
  file_name text,
  mime_type text,
  size_bytes bigint,
  vigente boolean not null default true,   -- false = versión histórica (se conserva como respaldo)
  subido_por text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists rrhh_sst_documentos_tipo_idx
  on public.rrhh_sst_documentos (tipo, vigente);
alter table public.rrhh_sst_documentos enable row level security;

-- ── Actividades preventivas ─────────────────────────────────────────────────
create table if not exists public.rrhh_sst_actividades (
  id bigserial primary key,
  tipo text not null,                      -- capacitacion | odi | entrega_epp | simulacro | charla | otro
  titulo text not null,
  descripcion text,
  fecha date not null default current_date,
  duracion_horas numeric,                  -- art. 16 exige ≥8 h; EPP art. 13 ≥1 h
  relator text,
  lugar text,
  -- Respaldo: hoja de asistencia firmada, material, fotos del simulacro…
  bucket text,
  storage_path text,
  file_name text,
  creado_por text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists rrhh_sst_actividades_tipo_idx
  on public.rrhh_sst_actividades (tipo, fecha desc);
alter table public.rrhh_sst_actividades enable row level security;

create table if not exists public.rrhh_sst_asistentes (
  id bigserial primary key,
  actividad_id bigint not null references public.rrhh_sst_actividades (id) on delete cascade,
  empleado_id bigint not null references public.rrhh_empleados (id) on delete cascade,
  resultado text,                          -- aprobado | reprobado | pendiente (evaluación de aprendizaje)
  observacion text,
  unique (actividad_id, empleado_id)
);

create index if not exists rrhh_sst_asistentes_empleado_idx
  on public.rrhh_sst_asistentes (empleado_id);
alter table public.rrhh_sst_asistentes enable row level security;

-- ── Incidentes, accidentes y enfermedades profesionales ─────────────────────
create table if not exists public.rrhh_sst_incidentes (
  id bigserial primary key,
  tipo text not null,                      -- incidente_peligroso | accidente_trabajo |
                                           -- accidente_trayecto | enfermedad_profesional
  fecha_hora timestamptz not null,
  lugar text,
  empleado_id bigint references public.rrhh_empleados (id) on delete set null,
  afectado_nombre text,                    -- denormalizado (o persona externa a la ficha)
  afectado_sexo text,                      -- arts. 73/74/75: registros con sexo
  descripcion text,                        -- breve descripción del hecho
  relato text,                             -- relato de los hechos
  causas text,                             -- identificación de causas (investigación art. 71)
  medidas text,                            -- medidas correctivas y preventivas
  dias_perdidos numeric default 0,
  denunciado_oa boolean default false,     -- DIAT/DIEP presentada al organismo administrador
  fecha_denuncia date,
  estado text not null default 'abierto',  -- abierto | investigado | cerrado
  -- Respaldo de la investigación (informe, fotos, DIAT escaneada)
  bucket text,
  storage_path text,
  file_name text,
  creado_por text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists rrhh_sst_incidentes_fecha_idx
  on public.rrhh_sst_incidentes (fecha_hora desc);
create index if not exists rrhh_sst_incidentes_tipo_idx
  on public.rrhh_sst_incidentes (tipo, estado);
alter table public.rrhh_sst_incidentes enable row level security;
