-- Módulo Cobranza: seguimiento de gestión de cobranza por factura/boleta vencida.
--
-- Se apoya en las facturas existentes (licitacion_documentos tipo factura /
-- factura_boleta). Aquí guardamos, por documento:
--   * cobranza_estados: el estado de cobranza actual (resumen).
--   * cobranza_gestiones: la bitácora de acciones (llamadas, respuestas,
--     correos enviados, notas).
--
-- documento_id se guarda como TEXT (es el id de licitacion_documentos) para no
-- acoplarnos al tipo de esa PK. numero/licitacion_id se denormalizan para
-- mostrar y filtrar sin joins.

-- Estado de cobranza por documento (1 fila por factura/boleta).
create table if not exists public.cobranza_estados (
  documento_id   text primary key,
  licitacion_id  text,
  numero         text,
  estado         text not null default 'sin_gestion',
  updated_at     timestamptz not null default now(),
  updated_por    text
);

-- Bitácora de gestiones de cobranza.
create table if not exists public.cobranza_gestiones (
  id                uuid primary key default gen_random_uuid(),
  documento_id      text not null,
  licitacion_id     text,
  numero            text,
  tipo              text not null,            -- llamada | correo | nota | whatsapp
  detalle           text,                     -- respuesta recibida / observación
  correo_para       text,                     -- solo tipo correo
  correo_cc         text[],                   -- solo tipo correo
  correo_asunto     text,                     -- solo tipo correo
  adjuntos          jsonb,                    -- solo tipo correo: [{url,nombre,mime}]
  creado_por_email  text,
  creado_por_nombre text,
  created_at        timestamptz not null default now()
);

create index if not exists cobranza_gestiones_doc_idx
  on public.cobranza_gestiones (documento_id, created_at desc);

-- RLS: es información de equipo. Cualquier usuario autenticado del staff puede
-- leer y registrar gestiones (la página ya restringe el acceso por rol). El
-- control fino de quién puede entrar se hace en el frontend + el endpoint de
-- correo (CobranzaGuard).
alter table public.cobranza_estados enable row level security;
alter table public.cobranza_gestiones enable row level security;

drop policy if exists "cobranza_estados_select" on public.cobranza_estados;
create policy "cobranza_estados_select" on public.cobranza_estados
  for select to authenticated using (true);

drop policy if exists "cobranza_estados_insert" on public.cobranza_estados;
create policy "cobranza_estados_insert" on public.cobranza_estados
  for insert to authenticated with check (true);

drop policy if exists "cobranza_estados_update" on public.cobranza_estados;
create policy "cobranza_estados_update" on public.cobranza_estados
  for update to authenticated using (true) with check (true);

drop policy if exists "cobranza_gestiones_select" on public.cobranza_gestiones;
create policy "cobranza_gestiones_select" on public.cobranza_gestiones
  for select to authenticated using (true);

drop policy if exists "cobranza_gestiones_insert" on public.cobranza_gestiones;
create policy "cobranza_gestiones_insert" on public.cobranza_gestiones
  for insert to authenticated with check (true);
