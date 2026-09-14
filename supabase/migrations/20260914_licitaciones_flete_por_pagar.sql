-- (2026-09-14) Flete POR PAGAR en cotizaciones de cliente particular: el
-- cliente paga el despacho directo al courier al recibir, así que la
-- cotización no cobra flete (flete_estimado = 0) y el PDF lo indica como
-- ítem "Despacho / Flete — POR PAGAR". El frontend solo envía la columna
-- cuando corresponde, así el sistema opera aunque la migración esté pendiente.
alter table public.licitaciones add column if not exists flete_por_pagar boolean not null default false;
