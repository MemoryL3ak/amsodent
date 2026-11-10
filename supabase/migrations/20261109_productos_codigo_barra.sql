-- (2026-11-09) Código de barras del producto. Pedido de Ariel: «cuando se
-- edita un producto, dame la opción para leer el código de barra con
-- pistoleo» y «cuando se cree una cotización, agregar productos leyendo el
-- código de barra: cada producto tiene un código de barra que es un número;
-- al escanearlo busca la información de ese producto».
--
-- El lector (pistola) actúa como teclado: escribe el código y manda Enter. El
-- código se guarda tal cual lo entrega (dígitos, sin espacios). Dos productos
-- no deberían compartir código: el backend lo revisa al guardar (aviso con el
-- producto que ya lo tiene); el índice no es único para no frenar una carga
-- masiva con datos viejos.
alter table public.productos add column if not exists codigo_barra text;
create index if not exists productos_codigo_barra_idx on public.productos (codigo_barra) where codigo_barra is not null;
