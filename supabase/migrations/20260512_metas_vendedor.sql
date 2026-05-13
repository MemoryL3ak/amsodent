-- Metas mensuales de vendedores.
--
-- Tres tablas relacionadas:
--   1) vendedor_metas_mensuales        — meta neto global por vendedor/periodo.
--   2) vendedor_metas_canal_mensuales  — canal asignado al vendedor en ese periodo
--                                        (vendedor_terreno, vendedor_mercado_publico,
--                                         vendedor_terreno_mercado_publico, etc.).
--   3) vendedor_metas_canal_partes_mensuales
--                                      — desglose de la meta cuando el canal es
--                                        mixto (terreno + mercado), guarda meta_neto
--                                        por canal_base.
--
-- periodo: 'YYYY-MM' (ej: '2026-05'). Se usa texto para evitar lidiar con primer-día-de-mes.

-- 1) Meta neto global por vendedor/periodo
create table if not exists public.vendedor_metas_mensuales (
  vendedor_email text not null,
  periodo        text not null,
  meta_neto      numeric not null default 0,
  updated_at     timestamptz not null default now(),
  primary key (vendedor_email, periodo)
);

-- 2) Canal asignado al vendedor en cada periodo
create table if not exists public.vendedor_metas_canal_mensuales (
  vendedor_email text not null,
  periodo        text not null,
  canal          text not null,
  updated_at     timestamptz not null default now(),
  primary key (vendedor_email, periodo)
);

create index if not exists vendedor_metas_canal_mensuales_periodo_idx
  on public.vendedor_metas_canal_mensuales (periodo);

-- 3) Desglose de meta por canal_base (cuando el vendedor es de canal mixto)
create table if not exists public.vendedor_metas_canal_partes_mensuales (
  vendedor_email text not null,
  periodo        text not null,
  canal_base     text not null,
  meta_neto      numeric not null default 0,
  updated_at     timestamptz not null default now(),
  primary key (vendedor_email, periodo, canal_base)
);

create index if not exists vendedor_metas_canal_partes_periodo_idx
  on public.vendedor_metas_canal_partes_mensuales (periodo);
