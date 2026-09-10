-- (Punto 2 — 2026-09-10) Segundo contacto para cotizaciones tipo licitación
-- (entidad pública): Nombre, Correo y Teléfono adicionales al contacto
-- existente (contacto / email / telefono). El frontend solo envía estas
-- columnas cuando traen datos, así el sistema sigue operativo aunque esta
-- migración se aplique después del deploy.
alter table public.licitaciones add column if not exists contacto_2 text;
alter table public.licitaciones add column if not exists email_2 text;
alter table public.licitaciones add column if not exists telefono_2 text;
