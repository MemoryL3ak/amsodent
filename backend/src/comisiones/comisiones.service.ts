import { Injectable, BadRequestException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

// Configuración por defecto (según la lámina de referencia). Se usa cuando aún
// no hay una configuración guardada. Fórmula: (venta + productividad) × margen × conversión.
// El campo `desde` es el umbral MÍNIMO (en la unidad real de cada métrica) para
// caer en ese tramo; el cálculo por vendedor toma el tramo con el mayor `desde`
// que no supere el valor real. Unidades:
//   • venta         → `desde` en CLP (venta neta adjudicada del vendedor)
//   • productividad → `desde` en N° de actividades del mes
//   • margen        → `desde` en % de margen real
//   • conversion    → `desde` en % de conversión real (adjudicadas / cotizaciones)
const DEFAULT_CONFIG = {
  nombre: 'Ejecutivo Licitación Pública y privado',
  formula: '(Venta + Productividad) × Margen × Conversión',
  venta: [
    { tramo: '>100%', desde: 10000000, monto: 250000 },
    { tramo: '90%-100%', desde: 6000000, monto: 150000 },
    { tramo: '80%-89%', desde: 3000000, monto: 80000 },
    { tramo: '<80%', desde: 0, monto: 0 },
  ],
  margen: [
    { tramo: '100%', desde: 26, multiplicador: 1.1, meta: '>26%' },
    { tramo: '90%-99%', desde: 21, multiplicador: 1.0, meta: '21 al 25%' },
    { tramo: '80%-89%', desde: 16, multiplicador: 0.8, meta: '16 al 20%' },
    { tramo: '<80%', desde: 0, multiplicador: 0.5, meta: '<15%' },
  ],
  productividad: [
    { tramo: '>100%', desde: 160, monto: 150000, meta: '10 diarias' },
    { tramo: '90%-100%', desde: 120, monto: 100000, meta: '8-9 diarias' },
    { tramo: '80%-89%', desde: 80, monto: 70000, meta: '7 diarias' },
    { tramo: '<80%', desde: 0, monto: 0, meta: '<7' },
  ],
  conversion: [
    { tramo: '>100%', desde: 10, multiplicador: 1.3, meta: '>10%' },
    { tramo: '90%-100%', desde: 8, multiplicador: 1.0, meta: '8%-10%' },
    { tramo: '80%-89%', desde: 5, multiplicador: 0.8, meta: '5%<X<7%' },
    { tramo: '<80%', desde: 0, multiplicador: 0.5, meta: '<5%' },
  ],
};

@Injectable()
export class ComisionesService {
  constructor(private supabase: SupabaseService) {}

  async getConfig() {
    const { data, error } = await this.supabase.getClient()
      .from('comisiones_config')
      .select('*')
      .eq('id', 1)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    const cfg = data?.config && Object.keys(data.config).length ? data.config : DEFAULT_CONFIG;
    return { nombre: data?.nombre || DEFAULT_CONFIG.nombre, config: cfg, updated_at: data?.updated_at || null };
  }

  async saveConfig(body: any, email: string) {
    const config = body?.config && typeof body.config === 'object' ? body.config : {};
    const nombre = String(body?.nombre || DEFAULT_CONFIG.nombre).trim();
    const fila = {
      id: 1,
      nombre,
      config,
      updated_at: new Date().toISOString(),
      updated_by: email || null,
    };
    const { data, error } = await this.supabase.getClient()
      .from('comisiones_config')
      .upsert(fila, { onConflict: 'id' })
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }
}
