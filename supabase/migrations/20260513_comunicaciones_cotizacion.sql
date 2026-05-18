-- Historial de correos enviados (o programados) desde la sección
-- "Comunicaciones" de una cotización. Cada fila representa un correo
-- distinto. Los adjuntos (si existen) se guardan inline en metadata como
-- referencias a Storage; los binarios NO viven en esta tabla.

create table if not exists public.comunicaciones_cotizacion (
  id              bigserial primary key,
  licitacion_id   bigint not null references public.licitaciones(id) on delete cascade,

  -- Quién mandó el correo (email del usuario logueado de la app).
  enviado_por     text not null,
  -- Cuenta Google que efectivamente envió (puede ser distinta si el usuario
  -- conectó una cuenta secundaria desde el perfil).
  google_email    text,

  -- Destinatarios. Guardamos como arrays de text para preservar el orden.
  para            text[] not null default '{}',
  cc              text[] not null default '{}',
  bcc             text[] not null default '{}',

  asunto          text not null,
  cuerpo_html     text not null,
  cuerpo_texto    text,                        -- versión plain como fallback

  -- Estado del envío.
  --   'enviado'    → ya salió, gmail_message_id poblado
  --   'fallido'    → intentamos enviar pero falló, error_mensaje poblado
  --   'programado' → tiene fecha futura en programado_para, espera al cron
  --   'cancelado'  → programado que el usuario canceló antes de enviarse
  estado          text not null default 'enviado'
                  check (estado in ('enviado','fallido','programado','cancelado')),

  programado_para timestamptz,                 -- null = envío inmediato
  enviado_at      timestamptz,                 -- null mientras no se envíe
  gmail_message_id text,                       -- id que retorna Gmail API
  error_mensaje   text,

  -- metadata: { plantilla_id, adjuntos: [{filename, bucket, path, size}], ... }
  metadata        jsonb not null default '{}'::jsonb,

  creado_at       timestamptz not null default now()
);

create index if not exists comunicaciones_cotizacion_licitacion_idx
  on public.comunicaciones_cotizacion (licitacion_id, creado_at desc);

create index if not exists comunicaciones_cotizacion_programados_idx
  on public.comunicaciones_cotizacion (programado_para)
  where estado = 'programado';
