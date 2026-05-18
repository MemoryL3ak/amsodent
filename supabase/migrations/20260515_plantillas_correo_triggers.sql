-- Plantillas de correo + soporte para triggers automáticos y cron de programados.
--
-- 1) plantillas_correo: catálogo administrable de plantillas con HTML editable.
--    Cada plantilla declara su trigger ('manual', 'adjudicacion_oc', 'proximo_vencer').
--    Para envíos manuales el usuario elige la plantilla en el modal.
--    Para triggers automáticos el sistema busca plantillas activas con ese trigger.
--
-- 2) comunicaciones_cotizacion: columnas extra para registrar de dónde nació el envío
--    (manual/automático) y a qué plantilla pertenece.

create table if not exists public.plantillas_correo (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique,
  nombre text not null,
  asunto text not null,
  cuerpo_html text not null,
  -- Variables disponibles para reemplazar en el cuerpo: ej {"id_cotizacion": "ID", "nombre_entidad": "Cliente"}
  variables_disponibles jsonb default '{}'::jsonb,
  trigger text not null default 'manual'
    check (trigger in ('manual', 'adjudicacion_oc', 'proximo_vencer')),
  -- Para 'proximo_vencer': horas antes del cierre. NULL para otros triggers.
  horas_antes int,
  activo boolean not null default true,
  creado_por_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists plantillas_correo_trigger_idx on public.plantillas_correo (trigger) where activo;

-- Trigger updated_at
create or replace function public.plantillas_correo_set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

drop trigger if exists trg_plantillas_correo_updated on public.plantillas_correo;
create trigger trg_plantillas_correo_updated
before update on public.plantillas_correo
for each row execute function public.plantillas_correo_set_updated_at();

-- Plantillas de ejemplo (solo si la tabla está vacía)
insert into public.plantillas_correo (codigo, nombre, asunto, cuerpo_html, trigger, variables_disponibles)
select * from (values
  (
    'agradecer_adjudicacion',
    'Agradecer adjudicación',
    'Confirmación de adjudicación cotización {{id_cotizacion}}',
    '<p>Estimado(a) cliente,</p><p>Le agradecemos la confianza depositada en nuestra empresa al adjudicarnos la cotización <strong>{{id_cotizacion}}</strong> a nombre de {{nombre_entidad}}.</p><p>Por un monto total de {{total}}.</p><p>En breve nos pondremos en contacto para coordinar el despacho.</p><p>Saludos cordiales,<br/>AMSODENT</p>',
    'adjudicacion_oc',
    '{"id_cotizacion":"ID Cotización","nombre_entidad":"Nombre Entidad","total":"Total con IVA"}'::jsonb
  ),
  (
    'recordatorio_vencimiento',
    'Recordatorio fecha de cierre',
    'Recordatorio: cotización {{id_cotizacion}} cierra pronto',
    '<p>Estimado(a),</p><p>Le recordamos que la cotización <strong>{{id_cotizacion}}</strong> para {{nombre_entidad}} tiene fecha de cierre próxima.</p><p>Quedamos atentos a cualquier consulta.</p><p>Saludos,<br/>AMSODENT</p>',
    'proximo_vencer',
    '{"id_cotizacion":"ID Cotización","nombre_entidad":"Nombre Entidad"}'::jsonb
  ),
  (
    'solicitar_oc',
    'Solicitar orden de compra',
    'Solicitud OC cotización {{id_cotizacion}}',
    '<p>Estimado(a),</p><p>Le solicitamos por favor enviarnos la orden de compra correspondiente a la cotización <strong>{{id_cotizacion}}</strong> a nombre de {{nombre_entidad}}.</p><p>Saludos cordiales,<br/>AMSODENT</p>',
    'manual',
    '{"id_cotizacion":"ID Cotización","nombre_entidad":"Nombre Entidad"}'::jsonb
  )
) as v(codigo, nombre, asunto, cuerpo_html, trigger, variables_disponibles)
where not exists (select 1 from public.plantillas_correo);

-- 2) Columnas adicionales en comunicaciones_cotizacion
alter table public.comunicaciones_cotizacion
  add column if not exists trigger_origen text default 'manual',
  add column if not exists plantilla_codigo text;

-- Marcamos qué cotizaciones ya recibieron correo automático de adjudicación
-- para no duplicar (idempotencia del trigger).
alter table public.licitaciones
  add column if not exists correo_adjudicacion_enviado_at timestamptz,
  add column if not exists correo_recordatorio_enviado_at timestamptz;
