-- Inventario del portal de clientes por lotes de costo (pedido 2026-10-19).
-- "Crear una sección llamada Inventario: acá debe ir agregando el nuevo stock
-- de los productos considerando que cada grupo nuevo de productos tiene un
-- costo distinto; de un mismo producto puede haber distintos precios de
-- costo. Se debe ir guardando el histórico de los últimos 5 movimientos."
-- Y en Gestión de Stock: el Stock Actual solo puede bajar y el Precio
-- unitario no se edita (es el costo promedio ponderado de lo que queda).
--
-- · stock_lotes_cliente: cada ingreso de stock con su costo. Las salidas
--   descuentan primero el lote más antiguo (FIFO) y el precio unitario del
--   producto es el promedio de lo que queda, pesado por cantidad.
-- · stock_movimientos_cliente: ingresos y salidas (la pantalla muestra los
--   últimos 5 por producto; se guardan todos).
-- · El stock que ya existe entra como «lote inicial» al precio unitario que
--   tiene hoy, para que nada cambie al aplicar la migración.
-- Requiere que los productos conserven su id al guardar Gestión de Stock (el
-- backend dejó de reemplazar la lista entera cuando estas tablas existen).
-- Solo el backend (service_role) lee y escribe: RLS sin políticas.

create table if not exists public.stock_lotes_cliente (
  id                bigserial primary key,
  rut               text not null,
  producto_id       bigint not null references public.stock_productos_cliente(id) on delete cascade,
  cantidad_inicial  numeric(14,2) not null check (cantidad_inicial > 0),
  cantidad_restante numeric(14,2) not null check (cantidad_restante >= 0),
  costo_unitario    numeric(14,2) not null default 0 check (costo_unitario >= 0),
  fecha             date not null default current_date,
  nota              text,
  usuario_email     text,
  usuario_nombre    text,
  created_at        timestamptz not null default now()
);
create index if not exists stock_lotes_cliente_producto_idx on public.stock_lotes_cliente (producto_id, fecha, id);
create index if not exists stock_lotes_cliente_rut_idx on public.stock_lotes_cliente (rut);

create table if not exists public.stock_movimientos_cliente (
  id                bigserial primary key,
  rut               text not null,
  producto_id       bigint not null references public.stock_productos_cliente(id) on delete cascade,
  tipo              text not null check (tipo in ('inicial', 'ingreso', 'salida')),
  cantidad          numeric(14,2) not null,
  costo_unitario    numeric(14,2),
  stock_resultante  numeric(14,2),
  costo_promedio    numeric(14,2),
  nota              text,
  usuario_email     text,
  usuario_nombre    text,
  created_at        timestamptz not null default now()
);
create index if not exists stock_movimientos_cliente_producto_idx on public.stock_movimientos_cliente (producto_id, created_at desc);

alter table public.stock_lotes_cliente enable row level security;
alter table public.stock_movimientos_cliente enable row level security;

-- Lote inicial: el stock de hoy, al precio unitario de hoy (una sola vez por producto).
insert into public.stock_lotes_cliente (rut, producto_id, cantidad_inicial, cantidad_restante, costo_unitario, nota)
select p.rut, p.id, p.stock_actual, p.stock_actual, coalesce(p.precio_unitario, 0), 'Stock inicial (al activar Inventario)'
from public.stock_productos_cliente p
where p.stock_actual > 0
  and not exists (select 1 from public.stock_lotes_cliente l where l.producto_id = p.id);

insert into public.stock_movimientos_cliente (rut, producto_id, tipo, cantidad, costo_unitario, stock_resultante, costo_promedio, nota)
select p.rut, p.id, 'inicial', p.stock_actual, coalesce(p.precio_unitario, 0), p.stock_actual, coalesce(p.precio_unitario, 0), 'Stock inicial (al activar Inventario)'
from public.stock_productos_cliente p
where p.stock_actual > 0
  and not exists (select 1 from public.stock_movimientos_cliente m where m.producto_id = p.id);
