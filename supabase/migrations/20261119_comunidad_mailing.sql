-- (2026-11-19) Mailing a la Comunidad Amsodent. Pedido de Ariel: «generar
-- funcionalidad de mailing para clientes de la comunidad».
--
-- El mailing funciona sin esta migración (envía igual), pero con ella:
--   · cada correo lleva un enlace «date de baja» y quien lo usa deja de
--     recibir los mailings (tabla comunidad_bajas);
--   · los envíos hechos desde Comunidad quedan marcados (origen) y se pueden
--     listar con su avance y aperturas en la pestaña Mailing.
-- Es aditiva y se puede correr más de una vez.

-- 1) Personas que pidieron no recibir más correos. El correo va en minúsculas.
create table if not exists public.comunidad_bajas (
  correo      text primary key,
  origen      text,                              -- 'enlace' (pinchó el enlace del correo) | 'manual' (lo anotó alguien del equipo)
  anotado_por text,                              -- quién la anotó a mano
  created_at  timestamptz not null default now()
);

-- RLS: todo bloqueado; solo el backend (service-role) lee y escribe.
alter table public.comunidad_bajas enable row level security;

-- 2) De qué módulo salió cada envío masivo y a qué público iba.
alter table public.mailings_envios add column if not exists origen text;     -- 'comunidad' | null (Comunicaciones)
alter table public.mailings_envios add column if not exists detalle jsonb;   -- público elegido, excluidos y por qué
create index if not exists mailings_envios_origen_idx on public.mailings_envios (origen, id desc);
