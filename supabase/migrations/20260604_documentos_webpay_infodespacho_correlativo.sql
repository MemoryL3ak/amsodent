-- Cliente Particular: nuevos tipos de documento Webpay e "Información de
-- despacho", columna url (link al comprobante Webpay) y correlativo automático
-- AMSO para los despachos internos.

-- 1) Tipos válidos: agregamos 'webpay' e 'info_despacho'.
alter table public.licitacion_documentos
  drop constraint if exists licitacion_documentos_tipo_check;
alter table public.licitacion_documentos
  add constraint licitacion_documentos_tipo_check
  check (
    tipo in (
      'orden_compra',
      'guia_despacho',
      'factura',
      'factura_boleta',
      'comprobante_pago',
      'efectivo',
      'webpay',
      'info_despacho'
    )
  );

-- 2) URL del comprobante (ej. voucher/transacción Webpay).
alter table public.licitacion_documentos
  add column if not exists url text;

-- 3) "Información de despacho" no lleva archivo: columnas de archivo nullables.
alter table public.licitacion_documentos alter column bucket drop not null;
alter table public.licitacion_documentos alter column storage_path drop not null;
alter table public.licitacion_documentos alter column file_name drop not null;
alter table public.licitacion_documentos alter column mime_type drop not null;
alter table public.licitacion_documentos alter column size_bytes drop not null;

-- 4) Correlativo global para Despacho interno (AMSO0000001, AMSO0000002, ...).
create sequence if not exists public.despacho_interno_seq start with 1;

create or replace function public.siguiente_correlativo_despacho()
returns text
language sql
as $$
  select 'AMSO' || lpad(nextval('public.despacho_interno_seq')::text, 7, '0');
$$;
