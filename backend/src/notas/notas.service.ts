import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { MAX_NOTAS_POR_PERSONA, MIGRACION_NOTAS, limpiarNota, ordenValido, sinTablaNotas } from './notas.reglas';

/* (2026-11-27) Notas adhesivas personales (panel lateral derecho).
   Tabla notas_adhesivas (migración 20261127_notas_adhesivas.sql). Toda
   consulta va filtrada por el id de quien está conectado: una nota es de una
   sola persona y nadie más la ve ni la toca, tampoco el administrador. */

const CAMPOS =
  'id, contenido, color, papel, letra, sujecion, destacada, orden, ruta, ruta_titulo, flotante, pos_x, pos_y, created_at, updated_at';

@Injectable()
export class NotasService {
  constructor(private supabase: SupabaseService) {}

  private get db() {
    return this.supabase.getClient();
  }

  private fallo(error: any): BadRequestException {
    return new BadRequestException(sinTablaNotas(error) ? MIGRACION_NOTAS : error?.message || 'No se pudo completar la operación.');
  }

  idUsuario(req: any): string {
    const id = req?.user?.id;
    if (!id) throw new ForbiddenException('Sesión inválida.');
    return String(id);
  }

  async listar(userId: string) {
    const { data, error } = await this.db
      .from('notas_adhesivas')
      .select(CAMPOS)
      .eq('user_id', userId)
      .order('orden', { ascending: true })
      .order('id', { ascending: false })
      .limit(MAX_NOTAS_POR_PERSONA + 50);
    if (error) throw this.fallo(error);
    return { notas: data || [], maximo: MAX_NOTAS_POR_PERSONA };
  }

  /* La nota nueva queda primera: un lugar antes de la que hoy va primera. */
  async crear(userId: string, body: any) {
    const { data: actuales, error: e1 } = await this.db
      .from('notas_adhesivas')
      .select('id, orden')
      .eq('user_id', userId)
      .order('orden', { ascending: true })
      .limit(MAX_NOTAS_POR_PERSONA + 1);
    if (e1) throw this.fallo(e1);
    if ((actuales || []).length >= MAX_NOTAS_POR_PERSONA) {
      throw new BadRequestException(`Llegaste al tope de ${MAX_NOTAS_POR_PERSONA} notas: elimina las que ya no uses.`);
    }
    const primera = (actuales || [])[0] as any;
    // Deshacer una eliminación devuelve la nota a su lugar: se respeta el orden pedido.
    const pedido = Number(body?.orden);
    const orden = Number.isFinite(pedido) ? pedido : primera ? Number(primera.orden) - 1 : 0;
    const { data, error } = await this.db
      .from('notas_adhesivas')
      .insert({ ...limpiarNota(body, false), user_id: userId, orden })
      .select(CAMPOS)
      .single();
    if (error) throw this.fallo(error);
    return data;
  }

  async actualizar(userId: string, id: number, body: any) {
    const cambios = limpiarNota(body, true);
    if (Object.keys(cambios).length === 0) throw new BadRequestException('No hay nada que cambiar.');
    const { data, error } = await this.db
      .from('notas_adhesivas')
      .update({ ...cambios, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('user_id', userId)
      .select(CAMPOS)
      .maybeSingle();
    if (error) throw this.fallo(error);
    if (!data) throw new NotFoundException('La nota ya no existe.');
    return data;
  }

  async eliminar(userId: string, id: number) {
    const { error } = await this.db.from('notas_adhesivas').delete().eq('id', id).eq('user_id', userId);
    if (error) throw this.fallo(error);
    return { ok: true };
  }

  /* Guarda el orden del tablero tal como quedó tras arrastrar. */
  async ordenar(userId: string, ids: any) {
    const { data: propias, error } = await this.db
      .from('notas_adhesivas')
      .select('id')
      .eq('user_id', userId)
      .limit(MAX_NOTAS_POR_PERSONA + 50);
    if (error) throw this.fallo(error);
    const orden = ordenValido(ids, (propias || []).map((n: any) => Number(n.id)));
    for (let i = 0; i < orden.length; i += 20) {
      const tanda = orden.slice(i, i + 20);
      const res = await Promise.all(
        tanda.map((id, j) => this.db.from('notas_adhesivas').update({ orden: i + j }).eq('id', id).eq('user_id', userId)),
      );
      const conError = res.find((r) => r.error);
      if (conError) throw this.fallo(conError.error);
    }
    return { ok: true, ordenadas: orden.length };
  }
}
