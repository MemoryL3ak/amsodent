-- Módulos del portal por cliente (2026-10-05).
-- Qué secciones del portal ve cada RUT: { "declaracion": true, "solicitudes": true,
-- "ofertas": false, "showroom": true, "explorador": true, "actividad": true }.
-- NULL o una clave ausente = habilitado (así estaban todos los clientes hasta hoy).
-- Resumen y Usuarios no se configuran acá. El código tolera que la columna falte.
alter table if exists public.stock_clientes_portal
  add column if not exists modulos jsonb;
