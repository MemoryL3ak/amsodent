-- Monitoreo v2: correlación por request (trace_id), agrupación de errores
-- estilo "issues" (un bug repetido 400 veces = 1 problema con contador) y
-- soporte para alertas/health checks. Complementa 20260807_monitor_logs.sql.

-- ── trace_id en los logs ─────────────────────────────────────────────
alter table public.monitor_logs
  add column if not exists trace_id text;

create index if not exists monitor_logs_trace_idx on public.monitor_logs (trace_id);

-- ── Problemas agrupados (fingerprint) ────────────────────────────────
create table if not exists public.monitor_issues (
  id bigserial primary key,
  fingerprint text not null unique,   -- hash de tipo+ruta+mensaje normalizado
  titulo text not null,
  tipo text,                          -- excepcion | frontend | correo | sistema
  ruta text,
  ocurrencias int not null default 1,
  -- hasta 20 correos de usuarios afectados (muestra, no exhaustivo)
  usuarios_afectados jsonb not null default '[]'::jsonb,
  ultimo_stack text,
  ultimo_trace_id text,
  estado text not null default 'activo' check (estado in ('activo', 'resuelto', 'ignorado')),
  primera_vez timestamptz not null default now(),
  ultima_vez timestamptz not null default now()
);

create index if not exists monitor_issues_estado_idx on public.monitor_issues (estado, ultima_vez desc);

alter table public.monitor_issues enable row level security;

drop policy if exists "monitor_issues select admin" on public.monitor_issues;
create policy "monitor_issues select admin"
  on public.monitor_issues for select to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and lower(coalesce(p.rol, '')) in ('admin', 'administrador')
    )
  );

-- Upsert atómico: nueva ocurrencia de un error existente incrementa el
-- contador; si estaba "resuelto" se REABRE (regresión); "ignorado" se respeta.
create or replace function public.monitor_issue_upsert(
  p_fingerprint text,
  p_titulo text,
  p_tipo text,
  p_ruta text,
  p_stack text,
  p_trace_id text,
  p_usuario text
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into monitor_issues as mi
    (fingerprint, titulo, tipo, ruta, ultimo_stack, ultimo_trace_id, usuarios_afectados)
  values (
    p_fingerprint, p_titulo, p_tipo, p_ruta, p_stack, p_trace_id,
    case when p_usuario is null then '[]'::jsonb else jsonb_build_array(p_usuario) end
  )
  on conflict (fingerprint) do update set
    ocurrencias     = mi.ocurrencias + 1,
    ultima_vez      = now(),
    titulo          = coalesce(excluded.titulo, mi.titulo),
    ultimo_stack    = coalesce(excluded.ultimo_stack, mi.ultimo_stack),
    ultimo_trace_id = coalesce(excluded.ultimo_trace_id, mi.ultimo_trace_id),
    usuarios_afectados = case
      when p_usuario is null or mi.usuarios_afectados @> to_jsonb(p_usuario)
        then mi.usuarios_afectados
      when jsonb_array_length(mi.usuarios_afectados) >= 20
        then mi.usuarios_afectados
      else mi.usuarios_afectados || to_jsonb(p_usuario)
    end,
    estado = case when mi.estado = 'resuelto' then 'activo' else mi.estado end;
$$;

revoke all on function public.monitor_issue_upsert(text, text, text, text, text, text, text)
  from public, anon, authenticated;
