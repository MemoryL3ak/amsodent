-- (2026-10-14) Entrega en local en cotizaciones de CLIENTE PARTICULAR: el
-- cliente retira en nuestro local, así que la cotización no cobra flete
-- (flete_estimado = 0) y el PDF lo declara como ítem "Despacho / Flete —
-- ENTREGA EN LOCAL". Es excluyente con flete_por_pagar. El frontend solo
-- envía la columna cuando corresponde, así el sistema opera aunque la
-- migración esté pendiente (Reportería sí la necesita para "Tipo de despacho").
alter table public.licitaciones add column if not exists retiro_en_local boolean not null default false;
