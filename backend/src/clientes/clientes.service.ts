import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

@Injectable()
export class ClientesService {
  constructor(private supabase: SupabaseService) {}

  async findAll() {
    const { data, error } = await this.supabase
      .getClient()
      .from('clientes')
      .select('*')
      .range(0, 20000)
      .order('id', { ascending: true });

    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async findOne(id: string | number) {
    const { data, error } = await this.supabase
      .getClient()
      .from('clientes')
      .select('*')
      .eq('id', id)
      .single();

    if (error) throw new NotFoundException('Cliente no encontrado');
    return data;
  }

  async create(
    body: {
      rut: string;
      nombre: string;
      departamento?: string;
      municipalidad?: string;
      region: string;
      comuna: string;
      direccion: string;
      contacto: string;
      email: string;
      telefono?: string;
      condiciones_venta?: string;
      tipo_cliente?: 'Cliente Particular' | 'Entidad Pública' | null;
      vendedor_asignado?: string | null;
    },
    creadorEmail?: string,
  ) {
    const fila: Record<string, any> = { ...body };
    // El cliente particular queda anexado a un vendedor: por defecto, el que lo
    // crea (email de la sesión), si el formulario no envió uno. Se guarda el
    // email en minúscula para que "Mis clientes" (que filtra por email) lo reconozca.
    if (body?.tipo_cliente === 'Cliente Particular') {
      const asignado = (body?.vendedor_asignado || creadorEmail || '').toString().trim().toLowerCase();
      fila.vendedor_asignado = asignado || null;
    }
    const { data, error } = await this.supabase
      .getClient()
      .from('clientes')
      .insert([fila])
      .select()
      .single();

    if (error) throw new BadRequestException(error.message);
    return data;
  }

  // Creación rápida desde la bitácora de actividades. Permite registrar un
  // cliente con datos mínimos (solo el nombre). Si no trae RUT se marca como
  // "transitorio" (a completar luego); con RUT se considera un cliente normal.
  // Tolera que la columna `transitorio` aún no esté migrada (error 42703).
  async crearRapido(
    body: {
      nombre: string;
      rut?: string;
      email?: string;
      telefono?: string;
      contacto?: string;
      region?: string;
      comuna?: string;
      direccion?: string;
      oficina?: string;
      tipo_cliente?: 'Cliente Particular' | 'Entidad Pública' | null;
      vendedor_asignado?: string | null;
    },
    creadorEmail?: string,
  ) {
    const nombre = (body?.nombre || '').trim();
    if (!nombre) throw new BadRequestException('El nombre es obligatorio.');
    const rut = (body?.rut || '').trim();
    // Cliente "transitorio" cuando faltan los datos clave (sin RUT). Con RUT y
    // datos de contacto se considera un cliente final/activo.
    const transitorio = !rut;
    const esParticular = body?.tipo_cliente === 'Cliente Particular';
    const fila: Record<string, any> = {
      nombre,
      rut,
      email: (body?.email || '').trim(),
      telefono: (body?.telefono || '').trim(),
      contacto: (body?.contacto || '').trim(),
      region: (body?.region || '').trim(),
      comuna: (body?.comuna || '').trim(),
      direccion: (body?.direccion || '').trim(),
      oficina: (body?.oficina || '').trim(),
      tipo_cliente: body?.tipo_cliente || null,
      transitorio,
    };
    // El cliente particular queda anexado a un vendedor: por defecto, el que lo
    // crea (email de la sesión). Se guarda el email, igual que en "Crear cliente".
    if (esParticular) {
      const asignado = (body?.vendedor_asignado || creadorEmail || '').toString().trim().toLowerCase();
      if (asignado) fila.vendedor_asignado = asignado;
    }
    const intentar = (f: Record<string, any>) =>
      this.supabase.getClient().from('clientes').insert([f]).select().single();
    // Tolera columnas aún no migradas (transitorio / oficina / vendedor_asignado):
    // si el error indica que una columna no existe, se quita y se reintenta.
    const OPCIONALES = ['oficina', 'transitorio', 'vendedor_asignado'];
    let intento = await intentar(fila);
    let data = intento.data;
    let error = intento.error;
    for (let i = 0; error && i < OPCIONALES.length; i++) {
      const msg = [error.message, (error as any).details, (error as any).hint, (error as any).code]
        .filter(Boolean).join(' ').toLowerCase();
      const col = OPCIONALES.find((c) => c in fila && (msg.includes(c) || msg.includes('42703')));
      if (!col) break;
      delete fila[col];
      ({ data, error } = await intentar(fila));
    }
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async update(id: string | number, body: Record<string, any>) {
    const patch: Record<string, any> = { ...body };
    // Al completar el RUT, un cliente transitorio pasa a ser cliente normal.
    if (patch.transitorio === undefined && typeof patch.rut === 'string' && patch.rut.trim()) {
      patch.transitorio = false;
    }
    const intentar = (p: Record<string, any>) =>
      this.supabase
        .getClient()
        .from('clientes')
        .update(p)
        .eq('id', id)
        .select()
        .single();
    let { data, error } = await intentar(patch);
    // Tolera que la columna `transitorio` aún no esté migrada (error 42703).
    if (error) {
      const msg = [error.message, (error as any).details, (error as any).hint, (error as any).code]
        .filter(Boolean).join(' ').toLowerCase();
      if (msg.includes('transitorio') || msg.includes('42703')) {
        const limpio = { ...patch };
        delete limpio.transitorio;
        ({ data, error } = await intentar(limpio));
      }
    }
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async remove(id: string | number) {
    const { error } = await this.supabase
      .getClient()
      .from('clientes')
      .delete()
      .eq('id', id);

    if (error) throw new BadRequestException(error.message);
    return { deleted: true };
  }

  // Override manual del bloqueo por mora (solo admin). Si la columna aún no
  // está migrada, no rompe: simplemente no persiste el override.
  async setCobranzaDesbloqueo(id: string | number, valor: boolean) {
    const { data, error } = await this.supabase
      .getClient()
      .from('clientes')
      .update({ cobranza_desbloqueado: !!valor })
      .eq('id', id)
      .select()
      .single();
    if (error) {
      const msg = (error.message || '').toLowerCase();
      if (msg.includes('cobranza_desbloqueado')) {
        throw new BadRequestException(
          'Falta aplicar la migración de bloqueo por cobranza (columna cobranza_desbloqueado).',
        );
      }
      throw new BadRequestException(error.message);
    }
    return { cobranza_desbloqueado: !!valor, cliente: data };
  }

  // Override manual del estado de cobranza (solo admin):
  //   'bloqueado' | 'desbloqueado' | null (automático según atraso).
  // Tolera que la columna aún no esté migrada (cae al booleano anterior).
  async setCobranzaOverride(id: string | number, valor: any) {
    const v =
      valor === 'bloqueado' || valor === 'desbloqueado' ? valor : null;
    const intentar = (p: Record<string, any>) =>
      this.supabase.getClient().from('clientes').update(p).eq('id', id).select().single();
    let { data, error } = await intentar({
      cobranza_override: v,
      // Mantener el booleano en sincronía para compatibilidad.
      cobranza_desbloqueado: v === 'desbloqueado',
    });
    if (error) {
      const msg = [error.message, (error as any).details, (error as any).hint, (error as any).code]
        .filter(Boolean).join(' ').toLowerCase();
      if (msg.includes('cobranza_override') || msg.includes('42703')) {
        // Sin la columna nueva: persistimos al menos el desbloqueo booleano.
        ({ data, error } = await intentar({ cobranza_desbloqueado: v === 'desbloqueado' }));
      }
    }
    if (error) throw new BadRequestException(error.message);
    return { cobranza_override: v, cliente: data };
  }

  // ============================================================
  // Perfil comercial 360° — cotizaciones, documentos e ítems del cliente
  // ============================================================
  // Las licitaciones se enlazan al cliente por rut_entidad (fiable) con
  // fallback a nombre_entidad. Los KPIs se calculan en el frontend para
  // reutilizar la misma lógica de neto que el resto del sistema.
  async perfilComercial(id: string | number) {
    const client = this.supabase.getClient();
    const cliente = await this.findOne(id);

    const rut = String(cliente?.rut || '').trim();
    const nombre = String(cliente?.nombre || '').trim();

    // 1. Cotizaciones (licitaciones) del cliente.
    const campos =
      'id, id_licitacion, nombre, fecha, estado, total_con_iva, monto, ' +
      'tipo_compra, tipo_cliente, creado_por, vendedor_nombre, ' +
      'fecha_adjudicada, condicion_venta, rut_entidad, nombre_entidad';

    let cotizaciones: any[] = [];
    const ors: string[] = [];
    if (rut) ors.push(`rut_entidad.eq.${rut}`);
    if (nombre) {
      // Escapamos comas para no romper la sintaxis del filtro .or().
      const safe = nombre.replace(/,/g, ' ');
      ors.push(`nombre_entidad.ilike.%${safe}%`);
    }
    if (ors.length) {
      const { data, error } = await client
        .from('licitaciones')
        .select(campos)
        .or(ors.join(','))
        .order('fecha', { ascending: false })
        .range(0, 5000);
      if (error) throw new BadRequestException(error.message);
      cotizaciones = data || [];
    }

    const ids = cotizaciones.map((c) => c.id).filter((x) => x != null);

    // 2. Documentos (OC / facturas / guías / comprobantes) de esas cotizaciones.
    let documentos: any[] = [];
    if (ids.length) {
      documentos = await this.enLotes(ids, async (chunk) => {
        const { data, error } = await client
          .from('licitacion_documentos')
          .select(
            'id, licitacion_id, tipo, numero, monto, fecha_oc, fecha_factura, ' +
              'pagada, fecha_pago, forma_pago, empresa_despacho, n_seguimiento, created_at',
          )
          .in('licitacion_id', chunk)
          .range(0, 50000);
        if (error) throw new BadRequestException(error.message);
        return data || [];
      });
    }

    // 3. Ítems (productos comprados) — usamos columnas denormalizadas.
    let items: any[] = [];
    if (ids.length) {
      items = await this.enLotes(ids, async (chunk) => {
        const { data, error } = await client
          .from('items_licitacion')
          .select('licitacion_id, producto, categoria, cantidad, total')
          .in('licitacion_id', chunk)
          .range(0, 50000);
        if (error) throw new BadRequestException(error.message);
        return data || [];
      });
    }

    return { cliente, cotizaciones, documentos, items };
  }

  // Trocea un arreglo de ids para no desbordar headers en el IN(...).
  private async enLotes(
    ids: number[],
    fn: (chunk: number[]) => Promise<any[]>,
  ): Promise<any[]> {
    const CHUNK = 150;
    const out: any[] = [];
    for (let i = 0; i < ids.length; i += CHUNK) {
      const parte = await fn(ids.slice(i, i + CHUNK));
      out.push(...parte);
    }
    return out;
  }

  // ============================================================
  // Contactos clave del cliente
  // ============================================================
  async listarContactos(clienteId: string | number) {
    const { data, error } = await this.supabase
      .getClient()
      .from('cliente_contactos')
      .select('*')
      .eq('cliente_id', clienteId)
      .order('orden', { ascending: true })
      .order('created_at', { ascending: true });
    // Si la tabla aún no existe (migración no aplicada), no rompemos el perfil.
    if (error) {
      const msg = (error.message || '').toLowerCase();
      if (msg.includes('cliente_contactos') || msg.includes('does not exist')) {
        return [];
      }
      throw new BadRequestException(error.message);
    }
    return data || [];
  }

  async crearContacto(clienteId: string | number, body: Record<string, any>) {
    const payload = {
      cliente_id: clienteId,
      nombre: body?.nombre,
      cargo: body?.cargo ?? null,
      email: body?.email ?? null,
      telefono: body?.telefono ?? null,
      influencia: body?.influencia ?? null,
      cumpleanos: body?.cumpleanos ?? null,
      orden: Number(body?.orden) || 0,
    };
    const { data, error } = await this.supabase
      .getClient()
      .from('cliente_contactos')
      .insert([payload])
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async actualizarContacto(contactoId: string, body: Record<string, any>) {
    const payload: Record<string, any> = { updated_at: new Date().toISOString() };
    for (const k of ['nombre', 'cargo', 'email', 'telefono', 'influencia', 'cumpleanos', 'orden']) {
      if (k in body) payload[k] = body[k];
    }
    const { data, error } = await this.supabase
      .getClient()
      .from('cliente_contactos')
      .update(payload)
      .eq('id', contactoId)
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async eliminarContacto(contactoId: string) {
    const { error } = await this.supabase
      .getClient()
      .from('cliente_contactos')
      .delete()
      .eq('id', contactoId);
    if (error) throw new BadRequestException(error.message);
    return { deleted: true };
  }

  // ============================================================
  // Fotos (bucket público "avatars")
  // ============================================================
  private async subirImagen(carpeta: string, file: any): Promise<string | null> {
    if (!file?.buffer) throw new BadRequestException('Falta el archivo.');
    const client = this.supabase.getClient();
    const ext = (file.originalname?.split('.').pop() || 'jpg').toLowerCase();
    const path = `${carpeta}/${Date.now()}.${ext}`;
    const { error } = await client.storage
      .from('avatars')
      .upload(path, file.buffer, { contentType: file.mimetype, upsert: true });
    if (error) throw new BadRequestException(error.message);
    const { data } = client.storage.from('avatars').getPublicUrl(path);
    return data?.publicUrl || null;
  }

  async subirFotoCliente(id: string | number, file: any) {
    const foto_url = await this.subirImagen(`clientes/${id}`, file);
    const { error } = await this.supabase
      .getClient()
      .from('clientes')
      .update({ foto_url })
      .eq('id', id);
    if (error) throw new BadRequestException(error.message);
    return { foto_url };
  }

  async subirFotoContacto(contactoId: string, file: any) {
    const foto_url = await this.subirImagen(`contactos/${contactoId}`, file);
    const { error } = await this.supabase
      .getClient()
      .from('cliente_contactos')
      .update({ foto_url })
      .eq('id', contactoId);
    if (error) throw new BadRequestException(error.message);
    return { foto_url };
  }
}
