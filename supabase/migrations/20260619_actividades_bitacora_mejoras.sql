-- Mejoras a la bitácora de actividades:
--  - motivo de la gestión (1er Contacto / Solicitud de Reunión / Presupuesto / Presentación Empresa)
--  - cotización asociada (opcional)
--  - reuniones con participantes (se replica la actividad a cada participante,
--    agrupadas por grupo_id; cada copia mantiene su propio estado)
alter table public.actividades_cliente add column if not exists motivo        text;
alter table public.actividades_cliente add column if not exists licitacion_id bigint references public.licitaciones(id) on delete set null;
alter table public.actividades_cliente add column if not exists grupo_id      uuid;
alter table public.actividades_cliente add column if not exists participantes jsonb not null default '[]'::jsonb; -- [{email,nombre}]

create index if not exists actividades_cliente_grupo_idx on public.actividades_cliente (grupo_id);
