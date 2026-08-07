// Tipos de las entidades que consume la app. Reflejan las tablas/respuestas
// del backend; los campos opcionales pueden faltar según migraciones aplicadas.

export type Profile = {
  id: string;
  email: string;
  nombre?: string | null;
  rol?: string | null;
  permisos?: string[] | null;
  perfil_nombre?: string | null;
};

export type Licitacion = {
  id: number;
  id_licitacion?: string | null;
  nombre?: string | null;
  nombre_entidad?: string | null;
  rut_entidad?: string | null;
  comuna?: string | null;
  estado?: string | null;
  fecha?: string | null;
  fecha_adjudicada?: string | null;
  fecha_adjudicacion?: string | null;
  tipo_cliente?: string | null;
  tipo_compra?: string | null;
  condicion_venta?: string | null;
  creado_por?: string | null;
  vendedor_nombre?: string | null;
  flete_estimado?: number | null;
  total_sin_iva?: number | null;
  total_con_iva?: number | null;
  jerarquia?: string | null;
  madre_id?: number | null;
};

export type LicitacionItem = {
  id?: number;
  sku?: string | null;
  producto?: string | null;
  cantidad?: number | null;
  valor_unitario?: number | null;
  total?: number | null;
};

export type Cliente = {
  id: number;
  rut?: string | null;
  nombre?: string | null;
  comuna?: string | null;
  direccion?: string | null;
  telefono?: string | null;
  email?: string | null;
  tipo_cliente?: string | null;
  contacto?: string | null;
};

export type Contacto = {
  id?: number;
  nombre?: string | null;
  cargo?: string | null;
  telefono?: string | null;
  email?: string | null;
};

export type Disponible = {
  id: number;
  id_licitacion?: string | null;
  cargada?: boolean | null;
  tomada_por?: string | null;
  tomada_at?: string | null;
  no_aplica?: boolean | null;
  no_aplica_por?: string | null;
  created_at?: string | null;
  datos?: {
    organismo?: string | null;
    region?: string | null;
    monto?: string | number | null;
    tipo?: string | null;
    cierre?: string | null;
    [k: string]: unknown;
  } | null;
};

export type Notificacion = {
  id: number;
  user_email?: string | null;
  tipo?: string | null;
  mensaje?: string | null;
  link?: string | null;
  metadata?: { licitacion_id?: number; [k: string]: unknown } | null;
  leida_at?: string | null;
  snooze_hasta?: string | null;
  creado_at?: string | null;
};
