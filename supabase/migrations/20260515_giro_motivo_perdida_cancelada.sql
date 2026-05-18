-- Migración 2026-05-15: agregar campo GIRO, motivo de pérdida y soporte estado "Cancelada"
-- Punto 30: campo giro (texto libre opcional) en licitaciones.
-- Punto 33: estado "Cancelada" como nuevo valor permitido (no había CHECK previo, así que solo
--           es informativo — los selects del frontend lo aceptan).
-- Punto 35: motivo_perdida + motivo_perdida_otro al pasar una cotización a "Perdida".

-- 1) Campo GIRO (texto libre, opcional)
alter table public.licitaciones
  add column if not exists giro text;

-- 2) Motivo de pérdida (catálogo cerrado) + texto libre para "Otro"
alter table public.licitaciones
  add column if not exists motivo_perdida text,
  add column if not exists motivo_perdida_otro text;

-- Constraint del catálogo: solo valores permitidos o null
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'licitaciones_motivo_perdida_check'
  ) then
    alter table public.licitaciones
      add constraint licitaciones_motivo_perdida_check
      check (
        motivo_perdida is null or motivo_perdida in (
          'Precio',
          'Especificación técnica',
          'Documentación',
          'Plazo de entrega',
          'Otro'
        )
      );
  end if;
end$$;

-- Nota: el estado "Cancelada" se maneja a nivel de aplicación. No existe CHECK en la columna
-- estado de licitaciones, así que no hace falta migración para permitirlo.
