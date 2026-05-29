-- Permite cerrar el ciclo de trazabilidad de una cotización (OC → guía →
-- factura). Solo admin y jefe_ventas_especial pueden marcarlo desde la UI.
-- Es un flag informativo: indica que el ciclo documental quedó completo/cerrado.

alter table public.licitaciones
  add column if not exists ciclo_cerrado boolean not null default false;
