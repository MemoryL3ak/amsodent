-- (2026-11-05) Repositorio de documentos. Pedido de Ariel: "Módulo Repositorio
-- de documentos. Patente, Estatuto empresa, carta garantía (vigencia de
-- documentos)". Cada documento de la empresa con su archivo y su vigencia
-- (emisión y vencimiento). El estado (vigente / por vencer / vencido) lo
-- calcula el backend con la fecha de hoy; un cron diario avisa los que están
-- por vencer. Al descargar las fichas técnicas de una cotización se pueden
-- sumar al ZIP documentos de este repositorio.
create table if not exists public.repositorio_documentos (
  id                bigserial primary key,
  nombre            text not null,
  -- patente | estatuto | carta_garantia | certificado | legal | otro
  categoria         text not null default 'otro',
  descripcion       text,
  fecha_emision     date,
  -- null = el documento no vence
  fecha_vencimiento date,
  bucket            text not null default 'repositorio',
  storage_path      text,
  file_name         text,
  mime_type         text,
  size_bytes        bigint,
  subido_por        text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists repositorio_documentos_vencimiento_idx
  on public.repositorio_documentos (fecha_vencimiento)
  where fecha_vencimiento is not null;

-- Solo el backend (service_role) lee y escribe: sin políticas, RLS lo cierra al resto.
alter table public.repositorio_documentos enable row level security;

-- Bucket PRIVADO para los archivos: se entregan con URL firmada desde el backend.
insert into storage.buckets (id, name, public)
values ('repositorio', 'repositorio', false)
on conflict (id) do nothing;
