import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

export type TriggerPlantilla = 'manual' | 'adjudicacion_oc' | 'proximo_vencer';

export interface PlantillaInput {
  codigo: string;
  nombre: string;
  asunto: string;
  cuerpo_html: string;
  variables_disponibles?: Record<string, string>;
  trigger?: TriggerPlantilla;
  horas_antes?: number | null;
  activo?: boolean;
}

@Injectable()
export class PlantillasService {
  constructor(private supabase: SupabaseService) {}

  async listar() {
    const { data, error } = await this.supabase
      .getClient()
      .from('plantillas_correo')
      .select('*')
      .order('trigger', { ascending: true })
      .order('nombre', { ascending: true });
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async findOne(id: string) {
    const { data, error } = await this.supabase
      .getClient()
      .from('plantillas_correo')
      .select('*')
      .eq('id', id)
      .single();
    if (error) throw new NotFoundException('Plantilla no encontrada');
    return data;
  }

  async findByCodigo(codigo: string) {
    const { data } = await this.supabase
      .getClient()
      .from('plantillas_correo')
      .select('*')
      .eq('codigo', codigo)
      .maybeSingle();
    return data;
  }

  async findActivasByTrigger(trigger: TriggerPlantilla) {
    const { data, error } = await this.supabase
      .getClient()
      .from('plantillas_correo')
      .select('*')
      .eq('trigger', trigger)
      .eq('activo', true);
    if (error) throw new BadRequestException(error.message);
    return data || [];
  }

  async crear(input: PlantillaInput, creadoPor: string) {
    if (!input.codigo?.trim()) throw new BadRequestException('codigo es obligatorio');
    if (!input.nombre?.trim()) throw new BadRequestException('nombre es obligatorio');
    if (!input.asunto?.trim()) throw new BadRequestException('asunto es obligatorio');
    if (!input.cuerpo_html?.trim()) throw new BadRequestException('cuerpo_html es obligatorio');

    const { data, error } = await this.supabase
      .getClient()
      .from('plantillas_correo')
      .insert([
        {
          codigo: input.codigo.trim(),
          nombre: input.nombre.trim(),
          asunto: input.asunto.trim(),
          cuerpo_html: input.cuerpo_html,
          variables_disponibles: input.variables_disponibles || {},
          trigger: input.trigger || 'manual',
          horas_antes: input.horas_antes ?? null,
          activo: input.activo ?? true,
          creado_por_email: creadoPor,
        },
      ])
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async actualizar(id: string, input: Partial<PlantillaInput>) {
    const body: Record<string, any> = {};
    if (input.codigo !== undefined) body.codigo = input.codigo.trim();
    if (input.nombre !== undefined) body.nombre = input.nombre.trim();
    if (input.asunto !== undefined) body.asunto = input.asunto.trim();
    if (input.cuerpo_html !== undefined) body.cuerpo_html = input.cuerpo_html;
    if (input.variables_disponibles !== undefined) body.variables_disponibles = input.variables_disponibles;
    if (input.trigger !== undefined) body.trigger = input.trigger;
    if (input.horas_antes !== undefined) body.horas_antes = input.horas_antes;
    if (input.activo !== undefined) body.activo = input.activo;

    const { data, error } = await this.supabase
      .getClient()
      .from('plantillas_correo')
      .update(body)
      .eq('id', id)
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async eliminar(id: string) {
    const { error } = await this.supabase
      .getClient()
      .from('plantillas_correo')
      .delete()
      .eq('id', id);
    if (error) throw new BadRequestException(error.message);
    return { deleted: true };
  }

  // Sustituye {{variable}} en el texto con los valores del contexto.
  // Variables no provistas se reemplazan por string vacío para no dejar "{{x}}" colgando.
  renderPlantilla(
    plantilla: { asunto: string; cuerpo_html: string },
    contexto: Record<string, string | number | null | undefined>,
  ) {
    const reemplazar = (texto: string): string =>
      texto.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, key) => {
        const v = contexto[key];
        if (v == null) return '';
        return String(v);
      });
    return {
      asunto: reemplazar(plantilla.asunto),
      cuerpo_html: reemplazar(plantilla.cuerpo_html),
    };
  }
}
