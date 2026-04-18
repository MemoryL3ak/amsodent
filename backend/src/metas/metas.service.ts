import { Injectable, BadRequestException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

@Injectable()
export class MetasService {
  constructor(private supabase: SupabaseService) {}

  // vendedor_metas_mensuales
  async getMetasMensuales(periodo: string) {
    const { data, error } = await this.supabase.getClient()
      .from('vendedor_metas_mensuales')
      .select('vendedor_email,meta_neto')
      .eq('periodo', periodo);
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async upsertMetasMensuales(rows: any[]) {
    const { data, error } = await this.supabase.getClient()
      .from('vendedor_metas_mensuales')
      .upsert(rows, { onConflict: 'vendedor_email,periodo' });
    if (error) throw new BadRequestException(error.message);
    return data;
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
    const { data, error } = await this.supabase.getClient()
      .from('vendedor_metas_canal_mensuales')
      .select('vendedor_email,canal')
      .eq('periodo', periodo);
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async upsertMetasCanal(rows: any[]) {
    const { data, error } = await this.supabase.getClient()
      .from('vendedor_metas_canal_mensuales')
      .upsert(rows, { onConflict: 'vendedor_email,periodo' });
    if (error) throw new BadRequestException(error.message);
    return data;
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
    const { data, error } = await this.supabase.getClient()
      .from('vendedor_metas_canal_partes_mensuales')
      .select('vendedor_email,canal_base,meta_neto')
      .eq('periodo', periodo);
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async upsertMetasCanalPartes(rows: any[]) {
    const { data, error } = await this.supabase.getClient()
      .from('vendedor_metas_canal_partes_mensuales')
      .upsert(rows, { onConflict: 'vendedor_email,periodo,canal_base' });
    if (error) throw new BadRequestException(error.message);
    return data;
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
