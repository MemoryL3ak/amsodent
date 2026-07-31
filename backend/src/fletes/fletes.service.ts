import { Injectable, BadRequestException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

// Costeo de Fletes: cobros reales de Starken/Blue cargados desde sus archivos
// de detalle de cobro. Upsert por (empresa, n_seguimiento) para poder recargar
// un archivo corregido sin duplicar filas.
@Injectable()
export class FletesService {
  constructor(private supabase: SupabaseService) {}

  async listarCobros(empresa?: string) {
    let query = this.supabase.getClient()
      .from('fletes_cobros')
      .select('id,empresa,n_seguimiento,monto,detalle,archivo,cargado_por,created_at,updated_at')
      .range(0, 50000)
      .order('created_at', { ascending: false });
    if (empresa) query = query.eq('empresa', empresa);
    const { data, error } = await query;
    if (error) throw new BadRequestException(error.message);
    return data || [];
  }

  async bulkUpsert(body: { empresa?: string; archivo?: string; rows?: any[] }, email: string) {
    const empresa = String(body?.empresa || '').trim();
    if (!['Starken', 'Blue'].includes(empresa)) {
      throw new BadRequestException('Empresa inválida (Starken o Blue).');
    }
    const rows = Array.isArray(body?.rows) ? body.rows : [];
    const archivo = String(body?.archivo || '').trim() || null;

    // Dedup por n° de seguimiento dentro del archivo (última fila gana).
    const porSeguimiento = new Map<string, any>();
    for (const r of rows) {
      const n = String(r?.n_seguimiento || '').trim();
      const monto = Number(r?.monto || 0);
      if (!n || !(monto >= 0)) continue;
      porSeguimiento.set(n, {
        empresa,
        n_seguimiento: n,
        monto,
        detalle: r?.detalle && typeof r.detalle === 'object' ? r.detalle : null,
        archivo,
        cargado_por: email || null,
        updated_at: new Date().toISOString(),
      });
    }
    const filas = Array.from(porSeguimiento.values());
    if (!filas.length) return { insertados: 0 };

    const { error } = await this.supabase.getClient()
      .from('fletes_cobros')
      .upsert(filas, { onConflict: 'empresa,n_seguimiento' });
    if (error) throw new BadRequestException(error.message);
    return { insertados: filas.length };
  }

  async eliminarCobros(empresa?: string) {
    let query = this.supabase.getClient().from('fletes_cobros').delete();
    if (empresa) query = query.eq('empresa', empresa);
    else query = query.neq('id', 0); // delete all requiere un filtro
    const { error } = await query;
    if (error) throw new BadRequestException(error.message);
    return { ok: true };
  }

  // ── Cierres de costeo (subsección Análisis) ──────────────────────────────

  async listarCierres() {
    const { data, error } = await this.supabase.getClient()
      .from('fletes_cierres')
      .select('id,licitacion_id,flete_estimado,cobro_real,diferencia,cerrado_por,created_at')
      .range(0, 50000)
      .order('created_at', { ascending: false });
    if (error) throw new BadRequestException(error.message);
    return data || [];
  }

  async cerrarCosteo(body: { licitacion_id?: number; flete_estimado?: number; cobro_real?: number; diferencia?: number }, email: string) {
    const licitacionId = Number(body?.licitacion_id || 0);
    if (!licitacionId) throw new BadRequestException('licitacion_id requerido.');
    const fila = {
      licitacion_id: licitacionId,
      flete_estimado: Number(body?.flete_estimado || 0),
      cobro_real: Number(body?.cobro_real || 0),
      diferencia: Number(body?.diferencia || 0),
      cerrado_por: email || null,
    };
    const { data, error } = await this.supabase.getClient()
      .from('fletes_cierres')
      .upsert([fila], { onConflict: 'licitacion_id' })
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async reabrirCosteo(licitacionId: number) {
    if (!licitacionId) throw new BadRequestException('licitacion_id requerido.');
    const { error } = await this.supabase.getClient()
      .from('fletes_cierres')
      .delete()
      .eq('licitacion_id', licitacionId);
    if (error) throw new BadRequestException(error.message);
    return { ok: true };
  }
}
