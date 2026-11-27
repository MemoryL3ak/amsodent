-- (2026-11-27) Quién creó cada cliente. Pedido de Ariel: «¿cómo se puede ver
-- quién creó un cliente?». Hasta hoy la ficha solo guardaba la fecha
-- (created_at) y la persona no quedaba en ninguna parte.
--
--   · creado_por: correo (en minúscula) de la sesión que creó el cliente, igual
--     que licitaciones.creado_por y clientes.vendedor_asignado. Lo pone el
--     servidor al crear (formulario de Clientes, cliente que se crea solo al
--     guardar una cotización, y creación rápida desde la bitácora); no se
--     puede editar. NULL = cliente anterior a este cambio, sin registro.
--
-- Aditiva e idempotente. El servidor tolera que todavía no esté aplicada.
alter table public.clientes
  add column if not exists creado_por text;

comment on column public.clientes.creado_por is
  'Correo de quien creó el cliente (lo pone el servidor; no editable). NULL = anterior al 2026-11-27 y sin registro en el monitoreo.';

-- Relleno de los clientes recientes: el monitoreo (monitor_logs) guarda unos
-- 30 días de requests con su usuario. Cada creación es un POST /api/clientes
-- (o /api/clientes/rapido) que queda registrado segundos después de la fila
-- del cliente. Se atribuye solo cuando en esa ventana hay UNA única persona;
-- si no hay registro o hay dos personas distintas, queda sin dato.
-- El cruce va por cliente (lateral) para usar el índice por fecha de
-- monitor_logs en vez de recorrer la tabla completa.
do $$
begin
  if to_regclass('public.monitor_logs') is null then
    return;
  end if;

  update public.clientes c
     set creado_por = x.email
    from (
      select c2.id, m.email
        from public.clientes c2
        cross join lateral (
          select count(distinct lower(btrim(l.usuario_email))) as personas,
                 min(lower(btrim(l.usuario_email))) as email
            from public.monitor_logs l
           where l.tipo = 'http'
             and l.created_at >= c2.created_at - interval '2 seconds'
             and l.created_at <= c2.created_at + interval '20 seconds'
             and l.metodo = 'POST'
             and l.ruta in ('/api/clientes', '/api/clientes/rapido')
             and l.status between 200 and 299
             and coalesce(btrim(l.usuario_email), '') <> ''
        ) m
       where c2.creado_por is null
         and c2.created_at > now() - interval '45 days'
         and m.personas = 1
    ) x
   where c.id = x.id
     and c.creado_por is null;
end $$;
