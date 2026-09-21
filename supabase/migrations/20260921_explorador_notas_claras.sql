-- (2026-09-21) Reescribir las notas del mantenedor del Explorador.
--
-- Las notas de Nexo Dental y Biotech Chile describían el camino técnico por
-- el que se consulta cada tienda ("su Store API responde vacía", "la grilla
-- no informa stock"). Leídas en la tabla, junto a la de Mayordent que sí
-- avisa de un bloqueo, se entendieron como que las tres tiendas estaban
-- fallando — cuando dos de las tres funcionan perfectamente.
--
-- Ahora cada nota empieza diciendo si la tienda funciona o no, y el detalle
-- técnico va después. En la interfaz se suma un ícono (ℹ para el dato, ⚠
-- para la advertencia), porque distinguirlas solo por color no alcanzó.
update public.explorador_tiendas
set nota = 'Funciona normal. Se consulta por wp/v2/product en vez de la Store API, porque la de su sitio viene vacía por un conflicto de plugins.'
where id = 'nexodental';

update public.explorador_tiendas
set nota = 'Funciona normal. Es Odoo: se lee su vitrina /shop. Único límite: no publica stock ni precio anterior, así que sus productos salen sin esos datos.'
where id = 'biotech';

-- La nota de Mayordent tampoco era exacta. Se escribió el 2026-09-16, antes
-- de corregir el User-Agent, y atribuía el bloqueo a un 403 a secas. Ya con
-- el UA nuevo el sitio sigue sin dejar pasar: sirve una página "Checking your
-- browser…" (el reto de bots de Kinsta/Cloudflare) que exige ejecutar
-- JavaScript, e impide incluso leer su robots.txt. No es una heurística mal
-- calibrada como la de Nexo Dental, sino un control deliberado del sitio, así
-- que la tienda queda inactiva a propósito.
update public.explorador_tiendas
set nota = 'No se puede consultar: su sitio exige pasar un desafío de JavaScript (Cloudflare "Checking your browser"). No es el User-Agent; se probó con el corregido. Para activarla habría que pedirle a Mayordent que ponga en lista blanca nuestro User-Agent o la IP del backend.'
where id = 'mayordent';
