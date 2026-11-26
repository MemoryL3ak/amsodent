-- (2026-11-26) Aperturas de los mailings. Pedido de Ariel: «en la funcionalidad
-- de mailing, notificar cuando las personas abren los correos enviados».
--
-- El seguimiento funciona sin esta migración (se anota la primera apertura de
-- cada persona y quien envió recibe su aviso en la campana), pero con ella:
--   · se sabe cuántas veces abrió el correo cada persona y cuándo fue la
--     última vez;
--   · buscar el aviso de aperturas de un envío no recorre toda la tabla de
--     notificaciones.
-- Es aditiva y se puede correr más de una vez.

-- 1) Contador y última apertura por destinatario.
alter table public.mailings_destinatarios add column if not exists aperturas integer not null default 0;
alter table public.mailings_destinatarios add column if not exists ultima_apertura_at timestamptz;

-- Las aperturas que ya estaban registradas cuentan como una (solo toca las filas abiertas y sin contar).
update public.mailings_destinatarios
   set aperturas = 1,
       ultima_apertura_at = coalesce(ultima_apertura_at, abierto_at)
 where abierto_at is not null
   and aperturas = 0;

-- 2) El aviso «N personas abrieron tu correo» se busca por el envío (metadata.envio_id).
create index if not exists notificaciones_mailing_apertura_idx
  on public.notificaciones ((metadata->>'envio_id'))
  where tipo = 'mailing_apertura';
