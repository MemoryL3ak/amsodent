-- "No Aplica": marca una postulación como descartada por el equipo (no interesa
-- postular). Sale del listado de pendientes pero se conserva para historial y se
-- puede revertir. Independiente de "tomada" / "cargada".
alter table public.licitaciones_disponibles
  add column if not exists no_aplica     boolean not null default false,
  add column if not exists no_aplica_por text,
  add column if not exists no_aplica_at  timestamptz;

create index if not exists idx_disponibles_no_aplica
  on public.licitaciones_disponibles (no_aplica);
