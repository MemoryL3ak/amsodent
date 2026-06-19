import { Injectable, BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

type Usuario = { id?: string; email?: string };

export interface ActividadFiltros {
  desde?: string;
  hasta?: string;
  email?: string;
  cliente_id?: string;
  tipo?: string;
  estado?: string;
}

@Injectable()
export class ActividadesService {
  constructor(private supabase: SupabaseService) {}

  private async datosPerfil(user: Usuario): Promise<{ rol: string; nombre: string }> {
    try {
      const { data } = await this.supabase
        .getClient()
        .from('profiles')
        .select('rol, nombre')
        .eq('id', user?.id)
        .maybeSingle();
      return {
        rol: String(data?.rol || '').trim().toLowerCase(),
        nombre: (data?.nombre || '').trim(),
      };
    } catch {
      return { rol: '', nombre: '' };
    }
  }

  private esAdmin(rol: string): boolean {
    return rol === 'admin' || rol === 'administrador';
  }

  async listar(user: Usuario, filtros: ActividadFiltros) {
    const { rol } = await this.datosPerfil(user);
    const email = (user?.email || '').toLowerCase();
    let query = this.supabase
      .getClient()
      .from('actividades_cliente')
      .select('*')
      .order('fecha', { ascending: true })
      .order('hora_inicio', { ascending: true, nullsFirst: true });

    // Visibilidad: el admin puede ver todo (y filtrar por usuario); el resto
    // solo ve sus propias actividades.
    if (this.esAdmin(rol)) {
      if (filtros.email) query = query.ilike('user_email', filtros.email);
    } else {
      query = query.ilike('user_email', email);
    }

    if (filtros.desde) query = query.gte('fecha', filtros.desde);
    if (filtros.hasta) query = query.lte('fecha', filtros.hasta);
    if (filtros.cliente_id) query = query.eq('cliente_id', filtros.cliente_id);
    if (filtros.tipo) query = query.eq('tipo', filtros.tipo);
    if (filtros.estado) query = query.eq('estado', filtros.estado);

    const { data, error } = await query;
    if (error) throw new BadRequestException(error.message);
    return data || [];
  }

  async crear(user: Usuario, body: any) {
    const { nombre } = await this.datosPerfil(user);
    const email = (user?.email || '').toLowerCase();
    if (!body?.titulo || !String(body.titulo).trim()) {
      throw new BadRequestException('El título es obligatorio.');
    }
    if (!body?.fecha) {
      throw new BadRequestException('La fecha es obligatoria.');
    }
    const fila = {
      user_email: email,
      user_nombre: nombre || email,
      cliente_id: body.cliente_id != null ? body.cliente_id : null,
      cliente_nombre: (body.cliente_nombre || '').trim() || null,
      titulo: String(body.titulo).trim(),
      tipo: (body.tipo || 'gestion').trim(),
      comentario: (body.comentario || '').trim() || null,
      fecha: body.fecha,
      hora_inicio: body.todo_el_dia ? null : body.hora_inicio || null,
      hora_fin: body.todo_el_dia ? null : body.hora_fin || null,
      todo_el_dia: Boolean(body.todo_el_dia),
      estado: (body.estado || 'pendiente').trim(),
      adjuntos: Array.isArray(body.adjuntos) ? body.adjuntos : [],
    };
    const insertar = (f: any) =>
      this.supabase.getClient().from('actividades_cliente').insert([f]).select().single();
    let { data, error } = await insertar(fila);
    // Tolerancia: si la columna adjuntos no está migrada, reintentar sin ella.
    if (error && /adjuntos/i.test([error.message, (error as any).details, (error as any).hint].filter(Boolean).join(' '))) {
      const { adjuntos: _omit, ...sinAdj } = fila;
      ({ data, error } = await insertar(sinAdj));
    }
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  private async verificarPropiedad(user: Usuario, id: number) {
    const { data, error } = await this.supabase
      .getClient()
      .from('actividades_cliente')
      .select('id, user_email')
      .eq('id', id)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException('Actividad no encontrada.');
    const { rol } = await this.datosPerfil(user);
    const email = (user?.email || '').toLowerCase();
    if (!this.esAdmin(rol) && String(data.user_email || '').toLowerCase() !== email) {
      throw new ForbiddenException('Solo puedes editar tus propias actividades.');
    }
    return data;
  }

  async actualizar(user: Usuario, id: number, body: any) {
    await this.verificarPropiedad(user, id);
    const patch: Record<string, any> = { updated_at: new Date().toISOString() };
    if (body.cliente_id !== undefined) patch.cliente_id = body.cliente_id != null ? body.cliente_id : null;
    if (body.cliente_nombre !== undefined) patch.cliente_nombre = (body.cliente_nombre || '').trim() || null;
    if (body.titulo !== undefined) patch.titulo = String(body.titulo).trim();
    if (body.tipo !== undefined) patch.tipo = (body.tipo || 'gestion').trim();
    if (body.comentario !== undefined) patch.comentario = (body.comentario || '').trim() || null;
    if (body.fecha !== undefined) patch.fecha = body.fecha;
    if (body.todo_el_dia !== undefined) patch.todo_el_dia = Boolean(body.todo_el_dia);
    if (body.hora_inicio !== undefined) patch.hora_inicio = body.todo_el_dia ? null : body.hora_inicio || null;
    if (body.hora_fin !== undefined) patch.hora_fin = body.todo_el_dia ? null : body.hora_fin || null;
    if (body.estado !== undefined) patch.estado = (body.estado || 'pendiente').trim();
    if (body.adjuntos !== undefined) patch.adjuntos = Array.isArray(body.adjuntos) ? body.adjuntos : [];

    const actualizar = (p: any) =>
      this.supabase.getClient().from('actividades_cliente').update(p).eq('id', id).select().single();
    let { data, error } = await actualizar(patch);
    if (error && /adjuntos/i.test([error.message, (error as any).details, (error as any).hint].filter(Boolean).join(' '))) {
      const { adjuntos: _omit, ...sinAdj } = patch;
      ({ data, error } = await actualizar(sinAdj));
    }
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async eliminar(user: Usuario, id: number) {
    await this.verificarPropiedad(user, id);
    const { error } = await this.supabase
      .getClient()
      .from('actividades_cliente')
      .delete()
      .eq('id', id);
    if (error) throw new BadRequestException(error.message);
    return { deleted: true };
  }

  // Usuarios con actividades (para el filtro del admin).
  async usuarios(user: Usuario) {
    const { rol } = await this.datosPerfil(user);
    if (!this.esAdmin(rol)) return [];
    const { data, error } = await this.supabase
      .getClient()
      .from('actividades_cliente')
      .select('user_email, user_nombre');
    if (error) throw new BadRequestException(error.message);
    const map: Record<string, string> = {};
    (data || []).forEach((r: any) => {
      const e = (r.user_email || '').toLowerCase();
      if (e && !map[e]) map[e] = r.user_nombre || e;
    });
    return Object.entries(map).map(([email, nombre]) => ({ email, nombre })).sort((a, b) => a.nombre.localeCompare(b.nombre));
  }
}
