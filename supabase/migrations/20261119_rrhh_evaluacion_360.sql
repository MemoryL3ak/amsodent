-- ============================================================================
-- RR.HH. — Evaluación 360°
-- ----------------------------------------------------------------------------
-- Submódulo de Recursos Humanos. Un CICLO define el instrumento (competencias
-- ponderadas, escala, preguntas abiertas, peso de cada tipo de evaluador y de
-- los objetivos, anonimato) y agrupa:
--
--   · rrhh_e360_evaluados     → quiénes son evaluados en el ciclo (+ el cierre
--     de cada uno: retroalimentación de RR.HH., plan de desarrollo y acuse).
--   · rrhh_e360_asignaciones  → la matriz «quién evalúa a quién» con la
--     relación vista desde el evaluado:
--       auto      = autoevaluación
--       jefatura  = lo evalúa su jefatura            (descendente)
--       par       = lo evalúa un par
--       reporte   = lo evalúa alguien de su equipo   (ascendente)
--       otro      = cliente interno u otra persona
--     Las respuestas viven en la misma fila (jsonb): una fila = un formulario.
--   · rrhh_e360_objetivos     → objetivos del evaluado con indicador, meta,
--     valor real y peso; de ahí sale el cumplimiento.
--
-- Las relaciones se sugieren desde rrhh_empleados.jefatura_email y el área.
--
-- Convención de acceso: RLS habilitado y SIN policies; todo pasa por el
-- backend (service_role). El panel usa AdminGuard y el trabajador solo llega a
-- sus propias filas, resueltas por el correo del token.
-- ============================================================================

create table if not exists public.rrhh_e360_ciclos (
  id bigserial primary key,
  nombre text not null,
  periodo text,                            -- ej: 2026-S2
  descripcion text,
  instrucciones text,                      -- se muestran al evaluador sobre el formulario
  fecha_inicio date,
  fecha_cierre date,
  estado text not null default 'borrador', -- borrador | activo | cerrado | publicado
  -- Instrumento completo: { escala, competencias[], preguntas[], pesos_relacion,
  -- peso_competencias, peso_objetivos, anonimo, min_anonimato, niveles[],
  -- jefatura_ve_resultados, max_pares }
  config jsonb not null default '{}'::jsonb,
  creado_por text,
  activado_at timestamptz,
  cerrado_at timestamptz,
  publicado_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists rrhh_e360_ciclos_estado_idx on public.rrhh_e360_ciclos (estado);
alter table public.rrhh_e360_ciclos enable row level security;

create table if not exists public.rrhh_e360_evaluados (
  id bigserial primary key,
  ciclo_id bigint not null references public.rrhh_e360_ciclos (id) on delete cascade,
  empleado_id bigint not null references public.rrhh_empleados (id) on delete cascade,
  retro_rrhh text,                         -- síntesis de RR.HH. / jefatura para la conversación de cierre
  plan_desarrollo jsonb not null default '[]'::jsonb, -- [{ accion, plazo, responsable, estado }]
  acuse_at timestamptz,                    -- el evaluado confirmó que revisó su informe
  comentario_evaluado text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (ciclo_id, empleado_id)
);

create index if not exists rrhh_e360_evaluados_empleado_idx on public.rrhh_e360_evaluados (empleado_id);
alter table public.rrhh_e360_evaluados enable row level security;

create table if not exists public.rrhh_e360_asignaciones (
  id bigserial primary key,
  ciclo_id bigint not null references public.rrhh_e360_ciclos (id) on delete cascade,
  evaluado_id bigint not null references public.rrhh_empleados (id) on delete cascade,
  evaluador_id bigint not null references public.rrhh_empleados (id) on delete cascade,
  relacion text not null,                  -- auto | jefatura | par | reporte | otro
  estado text not null default 'pendiente',-- pendiente | en_progreso | enviada
  respuestas jsonb not null default '{}'::jsonb, -- { <competencia_id>: { puntaje, comentario } } (puntaje null = no aplica)
  abiertas jsonb not null default '{}'::jsonb,   -- { <pregunta_id>: texto }
  puntaje numeric,                         -- promedio ponderado del formulario al enviarlo
  iniciada_at timestamptz,
  enviada_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (ciclo_id, evaluado_id, evaluador_id)
);

create index if not exists rrhh_e360_asignaciones_evaluador_idx
  on public.rrhh_e360_asignaciones (evaluador_id, estado);
create index if not exists rrhh_e360_asignaciones_evaluado_idx
  on public.rrhh_e360_asignaciones (ciclo_id, evaluado_id);
alter table public.rrhh_e360_asignaciones enable row level security;

create table if not exists public.rrhh_e360_objetivos (
  id bigserial primary key,
  ciclo_id bigint not null references public.rrhh_e360_ciclos (id) on delete cascade,
  empleado_id bigint not null references public.rrhh_empleados (id) on delete cascade,
  titulo text not null,
  descripcion text,
  indicador text,                          -- cómo se mide (ej: «Ventas netas del semestre»)
  unidad text not null default 'porcentaje', -- porcentaje | numero | monto | si_no
  sentido text not null default 'mayor',   -- mayor = más es mejor | menor = menos es mejor
  meta numeric,
  valor_real numeric,                      -- null = todavía sin medir
  peso numeric not null default 1,
  comentario text,
  orden int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists rrhh_e360_objetivos_ciclo_idx
  on public.rrhh_e360_objetivos (ciclo_id, empleado_id);
alter table public.rrhh_e360_objetivos enable row level security;
