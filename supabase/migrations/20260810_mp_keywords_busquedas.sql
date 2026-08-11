-- ============================================================================
-- Catálogo de palabras clave y búsquedas guardadas para Explorar Mercado Público
-- ----------------------------------------------------------------------------
-- Antes las palabras clave eran una constante en el código (8 fijas), así que
-- agregar una exigía un despliegue. Ahora viven en la base y se administran
-- desde la pantalla.
--
-- Por qué DOS tablas: cada palabra se expande a singular y plural (2 llamadas
-- a la API), así que con un catálogo de decenas de términos hay que poder
-- agrupar los que se usan juntos y recuperarlos de un clic — eso son las
-- búsquedas guardadas.
--
-- Convención de acceso: RLS habilitado y SIN policies; todo pasa por el backend.
-- ============================================================================

-- ── Catálogo de palabras clave ──────────────────────────────────────────────
create table if not exists public.mp_keywords (
  id bigserial primary key,
  texto text not null,
  activa boolean not null default true,   -- se puede desactivar sin perder el término
  creada_por text,
  created_at timestamptz not null default now()
);

-- Sin repetidos, ignorando mayúsculas: "Fresas Diamante" y "fresas diamante"
-- son el mismo término para la API.
create unique index if not exists mp_keywords_texto_idx on public.mp_keywords (lower(texto));
alter table public.mp_keywords enable row level security;

-- ── Búsquedas guardadas ─────────────────────────────────────────────────────
create table if not exists public.mp_busquedas (
  id bigserial primary key,
  nombre text not null,
  keywords text[] not null default '{}',  -- términos que la componen
  creada_por text,
  created_at timestamptz not null default now()
);

create unique index if not exists mp_busquedas_nombre_idx on public.mp_busquedas (lower(nombre));
alter table public.mp_busquedas enable row level security;

-- ── Carga inicial del catálogo ──────────────────────────────────────────────
-- Idempotente: re-ejecutar la migración no duplica ni pisa lo que se haya
-- agregado a mano después.
insert into public.mp_keywords (texto)
values
  ('Fresa diamante cónica'), ('Fresa diamante clear'), ('Cepillo dientes cerda'),
  ('Huincha Soflex'), ('Sonda periodontal Carolina'), ('Sondas dentales Maillefer'),
  ('Vidrio ionómero I-Dental'), ('Tijera encía curva'), ('Silicona Speedex Medium'),
  ('Gelita hemostática'), ('Fresas quirúrgicas'), ('Higiene dental'),
  ('Pieza mano Woodpecker'), ('Fresa carburo metálica'), ('Electrodo dental Perfect'),
  ('Composite resina'), ('Aguja dental extracorta'), ('Contraángulo Ultra Push'),
  ('Escobillas profilaxis'), ('Fresa dental redonda'), ('Fresa diamante grano'),
  ('Aguja carpule larga'), ('Tórulas algodón lisa'), ('Sutura nylon azul'),
  ('Espátula plástica vidrio'), ('Adhesivo Universal Plus'), ('Protector pulpo dentinario'),
  ('Pasta dental menta'), ('Pasta dental infantil'), ('Sonda periodontal'),
  ('Cepillo prótesis doble'), ('Aplicadores Microbrush'), ('Pasta dental anticaries'),
  ('Hilo retractor triple'), ('Aguja carpule corta'), ('Porta discos Soflex'),
  ('Funda radiografía fósforo'), ('Jeringa carpule articulada'), ('Pasta dental fluoruro'),
  ('Mango espejo dental'), ('Pasta dientes fluorada'), ('Sonda caries recta'),
  ('Empacador hilo retractor'), ('Pasta apósito alveolar'), ('Insumos dentales'),
  ('Babero dental'), ('Anestesias'), ('Lidocaína 2'), ('Mepivacaína'),
  ('Guante nitrilo'), ('Fresas diamante'), ('Fresas carbide'), ('Resina 350'),
  ('Resina 3M'), ('Similar a 3M'), ('Aguja corta dental'), ('Aguja larga dental'),
  ('Fresas diamante dental'), ('Fresas dentales'), ('Soflex'), ('Discos lija dental'),
  ('Lápiz Godiva'), ('Cono gutapercha'), ('Cavibrush'), ('Barniz dental'),
  ('Ortofosfórico'), ('Endo Ice'), ('Adhesivo ortodoncia'), ('Protector facial'),
  ('Instrumental dental'), ('Material quirúrgico'), ('Colágeno hemostático'),
  ('Crema dental'),
  -- Las 8 que estaban fijas en el código, para no perder lo que ya se usaba.
  ('dental'), ('odontología'), ('resina'), ('anestesia'), ('ortodoncia'),
  ('implante'), ('fresas')
on conflict do nothing;

-- ── Búsquedas guardadas: SIN carga inicial, a propósito ─────────────────────
-- Esta migración llegó a traer dos búsquedas precargadas («Relevantes» y
-- «Sugerencias IA») copiadas de la configuración que el equipo tenía en
-- LicitaLab. Se quitaron el 2026-08-11 por decisión del equipo, y las filas
-- correspondientes se borraron de la base.
--
-- NO volver a sembrarlas: la tabla se llena desde la pantalla, con el botón
-- «Guardar como búsqueda», que es donde el equipo decide qué agrupar.
