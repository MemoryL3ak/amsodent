-- (2026-11-27) Notas adhesivas («post-it») personales. Pedido de Ariel:
-- «¿podemos tener una barra lateral derecha que nos permita crear unas
-- especies de post-it? Debe ser algo súper custom, con estilos, colores,
-- efectos, etc.»
--
-- Una fila por nota y cada nota es de UNA persona (user_id): nadie ve las
-- notas de otro, tampoco el administrador. Los valores de estilo (color,
-- papel, letra, sujeción) NO llevan CHECK a propósito: la lista válida vive
-- en backend/src/notas/notas.reglas.ts, así se pueden sumar estilos sin otra
-- migración.
--
--   · destacada: queda arriba del tablero.
--   · orden: posición en el tablero (menor = primero); lo cambia el arrastre.
--   · ruta / ruta_titulo: pantalla a la que la nota quedó anclada (opcional).
--   · flotante + pos_x/pos_y: la nota «despegada» del panel y pegada sobre la
--     pantalla; la posición es una fracción (0 a 1) del espacio libre de la
--     ventana, así cae dentro en cualquier monitor.
--
-- Aditiva e idempotente. Solo el backend (service_role) lee y escribe: RLS
-- habilitado y sin políticas. El servidor avisa con un mensaje claro si
-- todavía no está aplicada.
create table if not exists public.notas_adhesivas (
  id           bigserial primary key,
  user_id      uuid not null references auth.users(id) on delete cascade,
  contenido    text not null default '',
  color        text not null default 'amarillo',
  papel        text not null default 'liso',
  letra        text not null default 'normal',
  sujecion     text not null default 'cinta',
  destacada    boolean not null default false,
  orden        double precision not null default 0,
  ruta         text,
  ruta_titulo  text,
  flotante     boolean not null default false,
  pos_x        real,
  pos_y        real,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists notas_adhesivas_user_orden_idx
  on public.notas_adhesivas (user_id, orden);

alter table public.notas_adhesivas enable row level security;
