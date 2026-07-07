-- Recupera los precios corrompidos por el parseo del separador de miles.
-- El bug leia "19.900" (miles) como 19,9 (Number tomaba el punto como decimal),
-- guardando el precio ~1000 veces mas chico y descuadrando el total del portal
-- (total = stock_actual x precio_unitario).
--
-- Como ningun precio real del portal es menor a $1.000, todo precio_unitario
-- positivo y menor a 1000 es un valor corrupto: se restaura multiplicandolo por
-- 1000 y redondeando a entero de pesos. Los precios ya correctos (>= 1000) y los
-- nulos no se tocan.
--
-- Nota: los precios cuyo formato tenia dos separadores (ej. "1.234.567") se
-- guardaron como NULL (Number devolvia NaN) y no son recuperables por este
-- script; esos hay que reingresarlos.
update public.stock_productos_cliente
set precio_unitario = round(precio_unitario * 1000)
where precio_unitario is not null
  and precio_unitario > 0
  and precio_unitario < 1000;
