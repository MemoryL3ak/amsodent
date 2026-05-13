import { Injectable, BadRequestException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

@Injectable()
export class MetasService {
  constructor(private supabase: SupabaseService) {}

  // Busca el periodo anterior más reciente que tenga al menos una fila en la tabla
  // dada. Devuelve null si no existe ninguno. Lo usamos para "arrastrar" las metas
  // de un mes al siguiente automáticamente cuando el periodo solicitado está vacío.
  private async getUltimoPeriodoAnterior(tabla: string, periodo: string): Promise<string | null> {
    const { data, error } = await this.supabase.getClient()
      .from(tabla)
      .select('periodo')
      .lt('periodo', periodo)
      .order('periodo', { ascending: false })
      .limit(1);
    if (error) return null;
    return data?.[0]?.periodo ?? null;
  }

  // vendedor_metas_mensuales
  async getMetasMensuales(periodo: string) {
    const client = this.supabase.getClient();
    const { data, error } = await client
      .from('vendedor_metas_mensuales')
      .select('vendedor_email,meta_neto')
      .eq('periodo', periodo);
    if (error) throw new BadRequestException(error.message);
    if (data && data.length > 0) return data;

    // Fallback: traer las metas del periodo anterior más reciente con datos
    const periodoFallback = await this.getUltimoPeriodoAnterior(
      'vendedor_metas_mensuales',
      periodo,
    );
    if (!periodoFallback) return [];
    const { data: prev, error: e2 } = await client
      .from('vendedor_metas_mensuales')
      .select('vendedor_email,meta_neto')
      .eq('periodo', periodoFallback);
    if (e2) throw new BadRequestException(e2.message);
    return prev || [];
  }

  async upsertMetasMensuales(rows: any[]) {
    const { error } = await this.supabase.getClient()
      .from('vendedor_metas_mensuales')
      .upsert(rows, { onConflict: 'vendedor_email,periodo' });
    if (error) throw new BadRequestException(error.message);
    return { ok: true, count: rows?.length || 0 };
  }

  async deleteMetasMensuales(periodo: string) {
    const { error } = await this.supabase.getClient()
      .from('vendedor_metas_mensuales')
      .delete()
      .eq('periodo', periodo);
    if (error) throw new BadRequestException(error.message);
    return { deleted: true };
  }

  // vendedor_metas_canal_mensuales
  async getMetasCanal(periodo: string) {
    const client = this.supabase.getClient();
    const { data, error } = await client
      .from('vendedor_metas_canal_mensuales')
      .select('vendedor_email,canal')
      .eq('periodo', periodo);
    if (error) throw new BadRequestException(error.message);
    if (data && data.length > 0) return data;

    // Fallback: arrastrar las asignaciones de canal del periodo anterior
    const periodoFallback = await this.getUltimoPeriodoAnterior(
      'vendedor_metas_canal_mensuales',
      periodo,
    );
    if (!periodoFallback) return [];
    const { data: prev, error: e2 } = await client
      .from('vendedor_metas_canal_mensuales')
      .select('vendedor_email,canal')
      .eq('periodo', periodoFallback);
    if (e2) throw new BadRequestException(e2.message);
    return prev || [];
  }

  async upsertMetasCanal(rows: any[]) {
    const { error } = await this.supabase.getClient()
      .from('vendedor_metas_canal_mensuales')
      .upsert(rows, { onConflict: 'vendedor_email,periodo' });
    if (error) throw new BadRequestException(error.message);
    return { ok: true, count: rows?.length || 0 };
  }

  async deleteMetasCanal(periodo: string) {
    const { error } = await this.supabase.getClient()
      .from('vendedor_metas_canal_mensuales')
      .delete()
      .eq('periodo', periodo);
    if (error) throw new BadRequestException(error.message);
    return { deleted: true };
  }

  // vendedor_metas_canal_partes_mensuales
  async getMetasCanalPartes(periodo: string) {
    const client = this.supabase.getClient();
    const { data, error } = await client
      .from('vendedor_metas_canal_partes_mensuales')
      .select('vendedor_email,canal_base,meta_neto')
      .eq('periodo', periodo);
    if (error) throw new BadRequestException(error.message);
    if (data && data.length > 0) return data;

    // Fallback: traer el desglose por canal del periodo anterior más reciente
    const periodoFallback = await this.getUltimoPeriodoAnterior(
      'vendedor_metas_canal_partes_mensuales',
      periodo,
    );
    if (!periodoFallback) return [];
    const { data: prev, error: e2 } = await client
      .from('vendedor_metas_canal_partes_mensuales')
      .select('vendedor_email,canal_base,meta_neto')
      .eq('periodo', periodoFallback);
    if (e2) throw new BadRequestException(e2.message);
    return prev || [];
  }

  async upsertMetasCanalPartes(rows: any[]) {
    const { error } = await this.supabase.getClient()
      .from('vendedor_metas_canal_partes_mensuales')
      .upsert(rows, { onConflict: 'vendedor_email,periodo,canal_base' });
    if (error) throw new BadRequestException(error.message);
    return { ok: true, count: rows?.length || 0 };
  }

  async deleteMetasCanalPartes(periodo: string) {
    const { error } = await this.supabase.getClient()
      .from('vendedor_metas_canal_partes_mensuales')
      .delete()
      .eq('periodo', periodo);
    if (error) throw new BadRequestException(error.message);
    return { deleted: true };
  }
}
