-- ============================================================================
-- Cola de trabajos de Mercado Público + estado del robot (2026-10-21)
-- ----------------------------------------------------------------------------
-- Hasta ahora las consultas a Mercado Público corrían DENTRO de la request del
-- usuario (Sincronizar, Revisar estados, Confirmar postulaciones) o dentro del
-- proceso web (crons). Con una API que tarda 12-29 s por ficha y falla el 42 %
-- de las veces, eso dejaba la plataforma lenta y las pantallas en error.
--
-- Ahora las pantallas ENCOLAN trabajos y un robot aparte (APP_ROL=worker) los
-- procesa de a pocos, con reintentos. Las pantallas solo consultan el avance.
--
-- Re-ejecutable (IF NOT EXISTS / OR REPLACE).
-- ============================================================================

create table if not exists public.mp_cola (
  id                 bigserial primary key,
  tipo               text not null,                         -- ficha | estado | postulacion | exploracion | analisis_global
  clave              text not null,                         -- id de la cotización / postulación, o 'unica'
  payload            jsonb not null default '{}'::jsonb,
  lote               text,                                  -- agrupa los trabajos de un mismo pedido (uuid)
  estado             text not null default 'pendiente',     -- pendiente | en_curso | hecho | error | cancelado
  prioridad          int  not null default 5,               -- menor = antes
  intentos           int  not null default 0,
  max_intentos       int  not null default 6,
  proximo_intento_at timestamptz not null default now(),
  ultimo_error       text,
  resultado          jsonb,
  solicitado_por     text,
  created_at         timestamptz not null default now(),
  iniciado_at        timestamptz,
  terminado_at       timestamptz
);

create index if not exists mp_cola_pendientes_idx
  on public.mp_cola (estado, prioridad, proximo_intento_at, id);
create index if not exists mp_cola_lote_idx on public.mp_cola (lote);
create index if not exists mp_cola_terminado_idx on public.mp_cola (terminado_at);
-- Un mismo trabajo no se encola dos veces mientras esté vivo.
create unique index if not exists mp_cola_activo_uniq
  on public.mp_cola (tipo, clave) where estado in ('pendiente', 'en_curso');

-- Estado del robot: latido, pausas por cuota agotada / API caída.
create table if not exists public.mp_robot (
  id                  int primary key default 1 check (id = 1),
  latido_at           timestamptz,
  version             text,
  concurrencia        int,
  en_vuelo            int default 0,
  cuota_agotada_hasta timestamptz,
  api_caida_hasta     timestamptz,
  nota                text,
  actualizado_at      timestamptz default now()
);
insert into public.mp_robot (id) values (1) on conflict (id) do nothing;

-- Índices que al panel de Análisis le faltaban (ordena por consultado_at y
-- cruza por licitacion_id en cada carga).
create index if not exists mp_resultados_consultado_idx on public.mp_resultados (consultado_at desc);
create index if not exists mp_resultados_licitacion_idx on public.mp_resultados (licitacion_id);

-- ── Encolar ──────────────────────────────────────────────────────────────
-- p_items: [{tipo, clave, payload, lote, prioridad, solicitado_por}, …]
-- Devuelve cuántos se insertaron (los que ya estaban vivos se omiten).
create or replace function public.mp_cola_encolar(p_items jsonb)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  insertados int := 0;
begin
  with datos as (
    select
      i->>'tipo'                                   as tipo,
      i->>'clave'                                  as clave,
      coalesce(i->'payload', '{}'::jsonb)          as payload,
      i->>'lote'                                   as lote,
      coalesce((i->>'prioridad')::int, 5)          as prioridad,
      i->>'solicitado_por'                         as solicitado_por
    from jsonb_array_elements(p_items) as i
    where coalesce(i->>'tipo', '') <> '' and coalesce(i->>'clave', '') <> ''
  ),
  ins as (
    insert into public.mp_cola (tipo, clave, payload, lote, prioridad, solicitado_por)
    select tipo, clave, payload, lote, prioridad, solicitado_por from datos
    on conflict (tipo, clave) where estado in ('pendiente', 'en_curso') do nothing
    returning 1
  )
  select count(*) into insertados from ins;
  return insertados;
end;
$$;

-- ── Tomar trabajos (SKIP LOCKED: varios robots no se pisan) ──────────────
create or replace function public.mp_cola_tomar(p_n int, p_tipos text[] default null)
returns setof public.mp_cola
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with elegidos as (
    select id from public.mp_cola
    where estado = 'pendiente'
      and proximo_intento_at <= now()
      and (p_tipos is null or tipo = any(p_tipos))
    order by prioridad, proximo_intento_at, id
    limit greatest(1, coalesce(p_n, 1))
    for update skip locked
  )
  update public.mp_cola c
     set estado = 'en_curso', iniciado_at = now(), intentos = c.intentos + 1
    from elegidos e
   where c.id = e.id
  returning c.*;
end;
$$;

-- ── Resumen para las pantallas ───────────────────────────────────────────
-- Con p_lote: el avance de ese pedido. Sin p_lote: el lote activo más reciente
-- (el que tenga trabajos pendientes o en curso), para que una pantalla recién
-- abierta se enganche a lo que el robot ya está haciendo.
create or replace function public.mp_cola_resumen(p_lote text default null, p_tipo text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lote text := p_lote;
  r jsonb;
begin
  if v_lote is null then
    select lote into v_lote
      from public.mp_cola
     where estado in ('pendiente', 'en_curso') and lote is not null
       and (p_tipo is null or tipo = p_tipo)
     order by created_at desc
     limit 1;
  end if;
  if v_lote is null then
    return jsonb_build_object('lote', null, 'total', 0);
  end if;
  select jsonb_build_object(
    'lote', v_lote,
    'tipo', min(tipo),
    'solicitado_por', min(solicitado_por),
    'total', count(*),
    'pendientes', count(*) filter (where estado = 'pendiente'),
    'en_curso', count(*) filter (where estado = 'en_curso'),
    'hechos', count(*) filter (where estado = 'hecho'),
    'errores', count(*) filter (where estado = 'error'),
    'cancelados', count(*) filter (where estado = 'cancelado'),
    'creado_at', min(created_at),
    'ultimo_terminado_at', max(terminado_at),
    -- Sumas de lo que informan los trabajos terminados (cada tipo usa las suyas).
    'guardadas', coalesce(sum((resultado->>'guardada')::int) filter (where estado = 'hecho'), 0),
    'finalizadas', coalesce(sum((resultado->>'finalizada')::int) filter (where estado = 'hecho'), 0),
    'con_postulacion', coalesce(sum((resultado->>'con_postulacion')::int) filter (where estado = 'hecho'), 0),
    'sin_dato', coalesce(sum((resultado->>'sin_dato')::int) filter (where estado = 'hecho'), 0),
    'con_discrepancia', count(*) filter (where estado = 'hecho' and (resultado->>'discrepancia') = 'true'),
    'sin_respuesta', count(*) filter (where estado = 'hecho' and coalesce(resultado->>'error', '') <> '')
  ) into r
  from public.mp_cola
  where lote = v_lote;
  return r;
end;
$$;

-- Solo las usa el backend (service role).
revoke all on function public.mp_cola_encolar(jsonb) from public, anon, authenticated;
revoke all on function public.mp_cola_tomar(int, text[]) from public, anon, authenticated;
revoke all on function public.mp_cola_resumen(text, text) from public, anon, authenticated;
