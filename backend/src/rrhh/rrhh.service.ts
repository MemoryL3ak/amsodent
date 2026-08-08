import { Injectable, BadRequestException, NotFoundException, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { SupabaseService } from '../supabase/supabase.service';

/* ============================================================================
   Recursos Humanos — servicio
   ----------------------------------------------------------------------------
   Fichas de trabajadores, contratos, liquidaciones de sueldo, solicitudes
   (vacaciones/permisos/licencias), evaluaciones de desempeño, documentos,
   firmas electrónicas simples y reportes (asistencia sobre `marcajes`,
   dotación, costo de nómina, ausentismo).
============================================================================ */

const BUCKET = 'rrhh';

// Parámetros previsionales y tributarios. Cambian cada año/mes: se pueden
// sobreescribir por .env sin tocar código (RRHH_UF, RRHH_UTM, RRHH_IMM).
function parametros() {
  return {
    uf: Number(process.env.RRHH_UF) || 39500,
    utm: Number(process.env.RRHH_UTM) || 69000,
    // Ingreso mínimo mensual (base del tope de gratificación legal).
    imm: Number(process.env.RRHH_IMM) || 529000,
    tope_imponible_uf: Number(process.env.RRHH_TOPE_IMPONIBLE_UF) || 87.8,
    tope_cesantia_uf: Number(process.env.RRHH_TOPE_CESANTIA_UF) || 131.8,
    // Tasa AFP por defecto si la ficha no la trae (10% + comisión promedio).
    tasa_afp_default: Number(process.env.RRHH_TASA_AFP) || 11.44,
    tasa_salud: 7,
    // Seguro de cesantía a cargo del trabajador (contrato indefinido).
    tasa_cesantia_indefinido: 0.6,
  };
}

// Tabla del impuesto único de segunda categoría (tramos en UTM).
const TRAMOS_IMPUESTO: { desde: number; hasta: number; factor: number; rebaja: number }[] = [
  { desde: 0, hasta: 13.5, factor: 0, rebaja: 0 },
  { desde: 13.5, hasta: 30, factor: 0.04, rebaja: 0.54 },
  { desde: 30, hasta: 50, factor: 0.08, rebaja: 1.74 },
  { desde: 50, hasta: 70, factor: 0.135, rebaja: 4.49 },
  { desde: 70, hasta: 90, factor: 0.23, rebaja: 11.14 },
  { desde: 90, hasta: 120, factor: 0.304, rebaja: 17.8 },
  { desde: 120, hasta: 310, factor: 0.35, rebaja: 23.32 },
  { desde: 310, hasta: Infinity, factor: 0.4, rebaja: 38.82 },
];

const num = (v: any, def = 0): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
};
const redondear = (v: any) => Math.round(num(v));
const texto = (v: any, max = 400): string | null => {
  const s = String(v ?? '').trim();
  return s ? s.slice(0, max) : null;
};

@Injectable()
export class RrhhService {
  private readonly logger = new Logger(RrhhService.name);

  constructor(private supabase: SupabaseService) {}

  private get db() {
    return this.supabase.getClient();
  }

  private error(e: any): never {
    const msg = String(e?.message || e || 'Error desconocido');
    if (/relation .*rrhh_.* does not exist/i.test(msg) || /schema cache/i.test(msg)) {
      throw new BadRequestException(
        'Falta aplicar la migración del módulo de RR.HH. (supabase/migrations/20260808_rrhh.sql).',
      );
    }
    throw new BadRequestException(msg);
  }

  // ==========================================================================
  // EMPLEADOS
  // ==========================================================================
  async listarEmpleados(filtros?: { estado?: string; area?: string; q?: string }) {
    let q = this.db.from('rrhh_empleados').select('*').order('nombre', { ascending: true });
    if (filtros?.estado) q = q.eq('estado', filtros.estado);
    if (filtros?.area) q = q.eq('area', filtros.area);
    const { data, error } = await q;
    if (error) this.error(error);
    let filas = data || [];
    const busq = String(filtros?.q || '').trim().toLowerCase();
    if (busq) {
      filas = filas.filter((e: any) =>
        [e.nombre, e.apellidos, e.rut, e.email, e.cargo, e.area]
          .map((s) => String(s || '').toLowerCase())
          .some((s) => s.includes(busq)),
      );
    }
    return filas;
  }

  async obtenerEmpleado(id: number) {
    const { data, error } = await this.db.from('rrhh_empleados').select('*').eq('id', id).maybeSingle();
    if (error) this.error(error);
    if (!data) throw new NotFoundException('Trabajador no encontrado.');
    return data;
  }

  async empleadoPorEmail(email: string) {
    const e = String(email || '').trim().toLowerCase();
    if (!e) return null;
    const { data, error } = await this.db
      .from('rrhh_empleados')
      .select('*')
      .ilike('email', e)
      .maybeSingle();
    if (error) this.error(error);
    return data || null;
  }

  private saneaEmpleado(body: any, parcial = false) {
    const p: Record<string, any> = {};
    const set = (campo: string, valor: any) => {
      if (!parcial || body?.[campo] !== undefined) p[campo] = valor;
    };
    set('email', body?.email ? String(body.email).trim().toLowerCase() : null);
    set('rut', texto(body?.rut, 20));
    set('nombre', texto(body?.nombre, 120) || 'Sin nombre');
    set('apellidos', texto(body?.apellidos, 120));
    set('fecha_nacimiento', body?.fecha_nacimiento || null);
    set('telefono', texto(body?.telefono, 40));
    set('direccion', texto(body?.direccion, 200));
    set('comuna', texto(body?.comuna, 80));
    set('cargo', texto(body?.cargo, 120));
    set('area', texto(body?.area, 80));
    set('jefatura_email', body?.jefatura_email ? String(body.jefatura_email).trim().toLowerCase() : null);
    set('fecha_ingreso', body?.fecha_ingreso || null);
    set('fecha_egreso', body?.fecha_egreso || null);
    set('tipo_contrato', texto(body?.tipo_contrato, 30));
    set('jornada', texto(body?.jornada, 30));
    set('horas_semanales', body?.horas_semanales != null ? num(body.horas_semanales, 45) : null);
    set('sueldo_base', redondear(body?.sueldo_base));
    set('gratificacion_legal', body?.gratificacion_legal !== false);
    set('colacion', redondear(body?.colacion));
    set('movilizacion', redondear(body?.movilizacion));
    set('afp', texto(body?.afp, 40));
    set('tasa_afp', body?.tasa_afp != null ? num(body.tasa_afp) : null);
    set('salud', texto(body?.salud, 60));
    set('plan_salud_uf', body?.plan_salud_uf != null ? num(body.plan_salud_uf) : null);
    set('banco', texto(body?.banco, 60));
    set('tipo_cuenta', texto(body?.tipo_cuenta, 40));
    set('numero_cuenta', texto(body?.numero_cuenta, 40));
    set('contacto_emergencia', texto(body?.contacto_emergencia, 120));
    set('telefono_emergencia', texto(body?.telefono_emergencia, 40));
    set('dias_vacaciones_iniciales', num(body?.dias_vacaciones_iniciales));
    set('estado', texto(body?.estado, 20) || 'activo');
    set('notas', texto(body?.notas, 2000));
    return p;
  }

  async crearEmpleado(body: any) {
    const payload = this.saneaEmpleado(body);
    const { data, error } = await this.db.from('rrhh_empleados').insert(payload).select().single();
    if (error) this.error(error);
    return data;
  }

  async actualizarEmpleado(id: number, body: any) {
    const payload = this.saneaEmpleado(body, true);
    payload.updated_at = new Date().toISOString();
    const { data, error } = await this.db
      .from('rrhh_empleados')
      .update(payload)
      .eq('id', id)
      .select()
      .single();
    if (error) this.error(error);
    if (!data) throw new NotFoundException('Trabajador no encontrado.');
    return data;
  }

  async eliminarEmpleado(id: number) {
    const { error } = await this.db.from('rrhh_empleados').delete().eq('id', id);
    if (error) this.error(error);
    return { ok: true };
  }

  // Ficha completa: datos + contratos, liquidaciones, evaluaciones, solicitudes,
  // documentos y saldo de vacaciones. Es lo que alimenta el detalle del panel.
  async fichaCompleta(id: number) {
    const empleado = await this.obtenerEmpleado(id);
    const [contratos, liquidaciones, evaluaciones, solicitudes, documentos, jornadas] = await Promise.all([
      this.listarContratos(id),
      this.listarLiquidaciones({ empleado_id: id }),
      this.listarEvaluaciones({ empleado_id: id }),
      this.listarSolicitudes({ empleado_id: id }),
      this.listarDocumentos(id),
      this.jornadasDe(id),
    ]);
    return {
      empleado,
      contratos,
      liquidaciones,
      evaluaciones,
      solicitudes,
      documentos,
      jornadas,
      vacaciones: this.calcularVacaciones(empleado, solicitudes),
      antiguedad: this.antiguedad(empleado?.fecha_ingreso),
    };
  }

  // Antigüedad en años/meses a partir de la fecha de ingreso.
  private antiguedad(fechaIngreso?: string | null) {
    if (!fechaIngreso) return null;
    const ini = new Date(`${String(fechaIngreso).slice(0, 10)}T00:00:00`);
    if (Number.isNaN(ini.getTime())) return null;
    const hoy = new Date();
    let meses = (hoy.getFullYear() - ini.getFullYear()) * 12 + (hoy.getMonth() - ini.getMonth());
    if (hoy.getDate() < ini.getDate()) meses -= 1;
    meses = Math.max(0, meses);
    return { anios: Math.floor(meses / 12), meses: meses % 12, total_meses: meses };
  }

  // Vacaciones legales: 15 días hábiles al año = 1,25 por mes trabajado.
  private calcularVacaciones(empleado: any, solicitudes: any[]) {
    const ant = this.antiguedad(empleado?.fecha_ingreso);
    const devengados = ant ? Number((ant.total_meses * 1.25).toFixed(2)) : 0;
    const iniciales = num(empleado?.dias_vacaciones_iniciales);
    const tomados = (solicitudes || [])
      .filter((s: any) => s.tipo === 'vacaciones' && s.estado === 'aprobada')
      .reduce((acc: number, s: any) => acc + num(s.dias), 0);
    const total = Number((devengados + iniciales).toFixed(2));
    return {
      devengados,
      iniciales,
      tomados: Number(tomados.toFixed(2)),
      saldo: Number((total - tomados).toFixed(2)),
    };
  }

  // ==========================================================================
  // CONTRATOS
  // ==========================================================================
  async listarContratos(empleadoId?: number, filtros?: { estado?: string }) {
    let q = this.db.from('rrhh_contratos').select('*').order('fecha_inicio', { ascending: false });
    if (empleadoId) q = q.eq('empleado_id', empleadoId);
    if (filtros?.estado) q = q.eq('estado', filtros.estado);
    const { data, error } = await q;
    if (error) this.error(error);
    return data || [];
  }

  async crearContrato(body: any, creadoPor?: string) {
    const payload = {
      empleado_id: num(body?.empleado_id),
      tipo: texto(body?.tipo, 30) || 'contrato',
      titulo: texto(body?.titulo, 200),
      fecha_inicio: body?.fecha_inicio || null,
      fecha_termino: body?.fecha_termino || null,
      cargo: texto(body?.cargo, 120),
      sueldo_base: body?.sueldo_base != null ? redondear(body.sueldo_base) : null,
      jornada: texto(body?.jornada, 40),
      contenido: texto(body?.contenido, 60000),
      bucket: texto(body?.bucket, 60),
      storage_path: texto(body?.storage_path, 400),
      file_name: texto(body?.file_name, 200),
      estado: texto(body?.estado, 20) || 'borrador',
      creado_por: texto(creadoPor, 120),
    };
    if (!payload.empleado_id) throw new BadRequestException('Falta el trabajador.');
    const { data, error } = await this.db.from('rrhh_contratos').insert(payload).select().single();
    if (error) this.error(error);
    return data;
  }

  async actualizarContrato(id: number, body: any) {
    const p: Record<string, any> = { updated_at: new Date().toISOString() };
    for (const campo of ['tipo', 'titulo', 'cargo', 'jornada', 'estado', 'bucket', 'storage_path', 'file_name']) {
      if (body?.[campo] !== undefined) p[campo] = texto(body[campo], campo === 'storage_path' ? 400 : 200);
    }
    if (body?.contenido !== undefined) p.contenido = texto(body.contenido, 60000);
    if (body?.fecha_inicio !== undefined) p.fecha_inicio = body.fecha_inicio || null;
    if (body?.fecha_termino !== undefined) p.fecha_termino = body.fecha_termino || null;
    if (body?.sueldo_base !== undefined) p.sueldo_base = redondear(body.sueldo_base);
    const { data, error } = await this.db.from('rrhh_contratos').update(p).eq('id', id).select().single();
    if (error) this.error(error);
    if (!data) throw new NotFoundException('Contrato no encontrado.');
    return data;
  }

  async eliminarContrato(id: number) {
    const { error } = await this.db.from('rrhh_contratos').delete().eq('id', id);
    if (error) this.error(error);
    return { ok: true };
  }

  // ==========================================================================
  // LIQUIDACIONES DE SUELDO
  // ==========================================================================

  // Calcula una liquidación completa a partir de los haberes. Devuelve todos
  // los subtotales para que queden guardados y auditables.
  calcularLiquidacion(entrada: {
    sueldo_base?: number;
    dias_trabajados?: number;
    gratificacion_legal?: boolean;
    gratificacion?: number;
    horas_extra?: number;
    bonos?: number;
    comisiones?: number;
    otros_imponibles?: number;
    colacion?: number;
    movilizacion?: number;
    asignacion_familiar?: number;
    otros_no_imponibles?: number;
    tasa_afp?: number;
    salud?: string;
    plan_salud_uf?: number;
    tipo_contrato?: string;
    anticipos?: number;
    prestamos?: number;
    otros_descuentos?: number;
  }) {
    const par = parametros();
    const dias = Math.min(30, Math.max(0, num(entrada.dias_trabajados, 30)));
    // Proporción por días efectivamente trabajados (base 30).
    const proporcion = dias / 30;

    const sueldoBase = redondear(num(entrada.sueldo_base) * proporcion);
    const horasExtra = redondear(entrada.horas_extra);
    const bonos = redondear(entrada.bonos);
    const comisiones = redondear(entrada.comisiones);
    const otrosImp = redondear(entrada.otros_imponibles);

    // Gratificación legal (art. 50): 25% de las remuneraciones imponibles con
    // tope de 4,75 ingresos mínimos al año (÷ 12 al mes).
    const baseGratificacion = sueldoBase + horasExtra + bonos + comisiones + otrosImp;
    let gratificacion = redondear(entrada.gratificacion);
    if (!gratificacion && entrada.gratificacion_legal !== false) {
      const topeMensual = (4.75 * par.imm) / 12;
      gratificacion = redondear(Math.min(baseGratificacion * 0.25, topeMensual * proporcion));
    }

    const totalImponible = sueldoBase + gratificacion + horasExtra + bonos + comisiones + otrosImp;

    // Tope imponible para AFP y salud.
    const topeImponible = par.tope_imponible_uf * par.uf;
    const imponibleTopado = Math.min(totalImponible, topeImponible);

    const tasaAfp = num(entrada.tasa_afp, par.tasa_afp_default);
    const afpMonto = redondear(imponibleTopado * (tasaAfp / 100));

    // Salud: 7% legal; si hay plan Isapre en UF, se cobra el mayor de ambos.
    const salud7 = imponibleTopado * (par.tasa_salud / 100);
    const planUf = num(entrada.plan_salud_uf);
    const esIsapre = String(entrada.salud || '').toLowerCase().includes('isapre') || planUf > 0;
    const saludMonto = redondear(esIsapre && planUf > 0 ? Math.max(salud7, planUf * par.uf) : salud7);

    // Seguro de cesantía: 0,6% del trabajador solo en contrato indefinido.
    const topeCesantia = par.tope_cesantia_uf * par.uf;
    const esIndefinido = String(entrada.tipo_contrato || 'indefinido').toLowerCase().includes('indefinido');
    const seguroCesantia = esIndefinido
      ? redondear(Math.min(totalImponible, topeCesantia) * (par.tasa_cesantia_indefinido / 100))
      : 0;

    // Impuesto único de segunda categoría sobre la base tributable.
    const baseTributable = totalImponible - afpMonto - saludMonto - seguroCesantia;
    const baseUtm = baseTributable / par.utm;
    const tramo = TRAMOS_IMPUESTO.find((t) => baseUtm > t.desde && baseUtm <= t.hasta) || TRAMOS_IMPUESTO[0];
    const impuestoUnico = Math.max(0, redondear(baseTributable * tramo.factor - tramo.rebaja * par.utm));

    // Haberes no imponibles (proporcionales a los días trabajados).
    const colacion = redondear(num(entrada.colacion) * proporcion);
    const movilizacion = redondear(num(entrada.movilizacion) * proporcion);
    const asignacionFamiliar = redondear(entrada.asignacion_familiar);
    const otrosNoImp = redondear(entrada.otros_no_imponibles);

    const totalHaberes = totalImponible + colacion + movilizacion + asignacionFamiliar + otrosNoImp;

    const anticipos = redondear(entrada.anticipos);
    const prestamos = redondear(entrada.prestamos);
    const otrosDesc = redondear(entrada.otros_descuentos);
    const totalDescuentos = afpMonto + saludMonto + seguroCesantia + impuestoUnico + anticipos + prestamos + otrosDesc;

    return {
      dias_trabajados: dias,
      sueldo_base: sueldoBase,
      gratificacion,
      horas_extra: horasExtra,
      bonos,
      comisiones,
      otros_imponibles: otrosImp,
      total_imponible: totalImponible,
      colacion,
      movilizacion,
      asignacion_familiar: asignacionFamiliar,
      otros_no_imponibles: otrosNoImp,
      total_haberes: totalHaberes,
      afp_monto: afpMonto,
      salud_monto: saludMonto,
      seguro_cesantia: seguroCesantia,
      impuesto_unico: impuestoUnico,
      anticipos,
      prestamos,
      otros_descuentos: otrosDesc,
      total_descuentos: totalDescuentos,
      liquido: totalHaberes - totalDescuentos,
      parametros: par,
    };
  }

  // Previsualiza el cálculo sin guardar (lo usa el formulario en vivo).
  async previsualizarLiquidacion(body: any) {
    let base: any = body || {};
    if (body?.empleado_id) {
      const emp = await this.obtenerEmpleado(num(body.empleado_id));
      base = {
        sueldo_base: emp.sueldo_base,
        colacion: emp.colacion,
        movilizacion: emp.movilizacion,
        tasa_afp: emp.tasa_afp,
        salud: emp.salud,
        plan_salud_uf: emp.plan_salud_uf,
        tipo_contrato: emp.tipo_contrato,
        gratificacion_legal: emp.gratificacion_legal,
        ...body,
      };
    }
    return this.calcularLiquidacion(base);
  }

  async listarLiquidaciones(filtros?: { empleado_id?: number; periodo?: string; estado?: string }) {
    let q = this.db
      .from('rrhh_liquidaciones')
      .select('*')
      .order('periodo', { ascending: false })
      .order('id', { ascending: false });
    if (filtros?.empleado_id) q = q.eq('empleado_id', filtros.empleado_id);
    if (filtros?.periodo) q = q.eq('periodo', filtros.periodo);
    if (filtros?.estado) q = q.eq('estado', filtros.estado);
    const { data, error } = await q;
    if (error) this.error(error);
    return data || [];
  }

  async guardarLiquidacion(body: any, creadoPor?: string) {
    const empleadoId = num(body?.empleado_id);
    const periodo = String(body?.periodo || '').trim();
    if (!empleadoId) throw new BadRequestException('Falta el trabajador.');
    if (!/^\d{4}-\d{2}$/.test(periodo)) throw new BadRequestException('Período inválido (formato AAAA-MM).');

    const emp = await this.obtenerEmpleado(empleadoId);
    const calc = this.calcularLiquidacion({
      sueldo_base: body?.sueldo_base != null ? num(body.sueldo_base) : num(emp.sueldo_base),
      dias_trabajados: body?.dias_trabajados,
      gratificacion_legal: emp.gratificacion_legal,
      gratificacion: body?.gratificacion,
      horas_extra: body?.horas_extra,
      bonos: body?.bonos,
      comisiones: body?.comisiones,
      otros_imponibles: body?.otros_imponibles,
      colacion: body?.colacion != null ? num(body.colacion) : num(emp.colacion),
      movilizacion: body?.movilizacion != null ? num(body.movilizacion) : num(emp.movilizacion),
      asignacion_familiar: body?.asignacion_familiar,
      otros_no_imponibles: body?.otros_no_imponibles,
      tasa_afp: emp.tasa_afp,
      salud: emp.salud,
      plan_salud_uf: emp.plan_salud_uf,
      tipo_contrato: emp.tipo_contrato,
      anticipos: body?.anticipos,
      prestamos: body?.prestamos,
      otros_descuentos: body?.otros_descuentos,
    });
    const { parametros: _p, ...montos } = calc;

    const payload: Record<string, any> = {
      empleado_id: empleadoId,
      periodo,
      dias_ausencia: num(body?.dias_ausencia),
      horas_extra_cantidad: num(body?.horas_extra_cantidad),
      ...montos,
      estado: texto(body?.estado, 20) || 'borrador',
      observaciones: texto(body?.observaciones, 2000),
      creado_por: texto(creadoPor, 120),
      updated_at: new Date().toISOString(),
    };
    if (payload.estado === 'emitida' && !body?.emitida_at) payload.emitida_at = new Date().toISOString();

    const { data, error } = await this.db
      .from('rrhh_liquidaciones')
      .upsert(payload, { onConflict: 'empleado_id,periodo' })
      .select()
      .single();
    if (error) this.error(error);
    return data;
  }

  // Genera (o regenera) las liquidaciones de todos los trabajadores activos
  // para un período, usando los datos de su ficha. No pisa las ya emitidas.
  async generarLiquidacionesMasivas(periodo: string, creadoPor?: string) {
    if (!/^\d{4}-\d{2}$/.test(String(periodo || ''))) {
      throw new BadRequestException('Período inválido (formato AAAA-MM).');
    }
    const activos = await this.listarEmpleados({ estado: 'activo' });
    const existentes = await this.listarLiquidaciones({ periodo });
    const yaEmitidas = new Set(
      existentes.filter((l: any) => l.estado !== 'borrador').map((l: any) => Number(l.empleado_id)),
    );

    let creadas = 0;
    let omitidas = 0;
    const errores: string[] = [];
    for (const emp of activos) {
      if (yaEmitidas.has(Number(emp.id))) {
        omitidas += 1;
        continue;
      }
      try {
        await this.guardarLiquidacion({ empleado_id: emp.id, periodo }, creadoPor);
        creadas += 1;
      } catch (e: any) {
        errores.push(`${emp.nombre}: ${e?.message || e}`);
      }
    }
    return { ok: true, periodo, creadas, omitidas, total_activos: activos.length, errores };
  }

  async cambiarEstadoLiquidacion(id: number, estado: string) {
    const validos = ['borrador', 'emitida', 'firmada', 'pagada'];
    if (!validos.includes(estado)) throw new BadRequestException('Estado inválido.');
    const p: Record<string, any> = { estado, updated_at: new Date().toISOString() };
    if (estado === 'emitida') p.emitida_at = new Date().toISOString();
    if (estado === 'pagada') p.pagada_at = new Date().toISOString();
    const { data, error } = await this.db.from('rrhh_liquidaciones').update(p).eq('id', id).select().single();
    if (error) this.error(error);
    if (!data) throw new NotFoundException('Liquidación no encontrada.');
    return data;
  }

  async eliminarLiquidacion(id: number) {
    const { error } = await this.db.from('rrhh_liquidaciones').delete().eq('id', id);
    if (error) this.error(error);
    return { ok: true };
  }

  // ==========================================================================
  // SOLICITUDES (vacaciones, permisos, licencias)
  // ==========================================================================

  // Días hábiles entre dos fechas (excluye sábado y domingo).
  private diasHabiles(desde: string, hasta: string): number {
    const d0 = new Date(`${String(desde).slice(0, 10)}T00:00:00`);
    const d1 = new Date(`${String(hasta).slice(0, 10)}T00:00:00`);
    if (Number.isNaN(d0.getTime()) || Number.isNaN(d1.getTime()) || d1 < d0) return 0;
    let dias = 0;
    const cursor = new Date(d0);
    while (cursor <= d1) {
      const dow = cursor.getDay();
      if (dow !== 0 && dow !== 6) dias += 1;
      cursor.setDate(cursor.getDate() + 1);
    }
    return dias;
  }

  async listarSolicitudes(filtros?: { empleado_id?: number; estado?: string; tipo?: string }) {
    let q = this.db.from('rrhh_solicitudes').select('*').order('fecha_desde', { ascending: false });
    if (filtros?.empleado_id) q = q.eq('empleado_id', filtros.empleado_id);
    if (filtros?.estado) q = q.eq('estado', filtros.estado);
    if (filtros?.tipo) q = q.eq('tipo', filtros.tipo);
    const { data, error } = await q;
    if (error) this.error(error);
    return data || [];
  }

  async crearSolicitud(body: any) {
    const empleadoId = num(body?.empleado_id);
    const desde = String(body?.fecha_desde || '').slice(0, 10);
    const hasta = String(body?.fecha_hasta || '').slice(0, 10);
    if (!empleadoId) throw new BadRequestException('Falta el trabajador.');
    if (!desde || !hasta) throw new BadRequestException('Faltan las fechas de la solicitud.');
    if (hasta < desde) throw new BadRequestException('La fecha de término no puede ser anterior al inicio.');

    const payload = {
      empleado_id: empleadoId,
      tipo: texto(body?.tipo, 30) || 'vacaciones',
      fecha_desde: desde,
      fecha_hasta: hasta,
      dias: body?.dias != null ? num(body.dias) : this.diasHabiles(desde, hasta),
      motivo: texto(body?.motivo, 1000),
      estado: 'pendiente',
      bucket: texto(body?.bucket, 60),
      storage_path: texto(body?.storage_path, 400),
      file_name: texto(body?.file_name, 200),
    };
    const { data, error } = await this.db.from('rrhh_solicitudes').insert(payload).select().single();
    if (error) this.error(error);
    return data;
  }

  async resolverSolicitud(id: number, body: { estado?: string; comentario?: string }, resueltoPor?: string) {
    const estado = String(body?.estado || '').trim();
    if (!['aprobada', 'rechazada', 'anulada', 'pendiente'].includes(estado)) {
      throw new BadRequestException('Estado inválido.');
    }
    const { data, error } = await this.db
      .from('rrhh_solicitudes')
      .update({
        estado,
        comentario_resolucion: texto(body?.comentario, 1000),
        resuelto_por: texto(resueltoPor, 120),
        resuelto_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single();
    if (error) this.error(error);
    if (!data) throw new NotFoundException('Solicitud no encontrada.');
    return data;
  }

  async eliminarSolicitud(id: number) {
    const { error } = await this.db.from('rrhh_solicitudes').delete().eq('id', id);
    if (error) this.error(error);
    return { ok: true };
  }

  // ==========================================================================
  // EVALUACIONES DE DESEMPEÑO
  // ==========================================================================
  async listarEvaluaciones(filtros?: { empleado_id?: number; periodo?: string; estado?: string }) {
    let q = this.db.from('rrhh_evaluaciones').select('*').order('fecha_evaluacion', { ascending: false });
    if (filtros?.empleado_id) q = q.eq('empleado_id', filtros.empleado_id);
    if (filtros?.periodo) q = q.eq('periodo', filtros.periodo);
    if (filtros?.estado) q = q.eq('estado', filtros.estado);
    const { data, error } = await q;
    if (error) this.error(error);
    return data || [];
  }

  // Promedio ponderado de las competencias (peso por defecto: 1).
  private puntajeDe(competencias: any[]): number | null {
    const items = (Array.isArray(competencias) ? competencias : []).filter(
      (c) => Number.isFinite(Number(c?.puntaje)),
    );
    if (!items.length) return null;
    const pesoTotal = items.reduce((s, c) => s + (num(c.peso, 1) || 1), 0);
    if (pesoTotal <= 0) return null;
    const suma = items.reduce((s, c) => s + num(c.puntaje) * (num(c.peso, 1) || 1), 0);
    return Number((suma / pesoTotal).toFixed(2));
  }

  async guardarEvaluacion(body: any, evaluador?: { email?: string; nombre?: string }) {
    const empleadoId = num(body?.empleado_id);
    if (!empleadoId) throw new BadRequestException('Falta el trabajador.');
    const competencias = Array.isArray(body?.competencias) ? body.competencias : [];
    const payload: Record<string, any> = {
      empleado_id: empleadoId,
      periodo: texto(body?.periodo, 20) || String(new Date().getFullYear()),
      tipo: texto(body?.tipo, 30) || 'desempeno',
      evaluador_email: texto(body?.evaluador_email || evaluador?.email, 120),
      evaluador_nombre: texto(body?.evaluador_nombre || evaluador?.nombre, 120),
      competencias,
      puntaje: body?.puntaje != null ? num(body.puntaje) : this.puntajeDe(competencias),
      fortalezas: texto(body?.fortalezas, 4000),
      oportunidades: texto(body?.oportunidades, 4000),
      compromisos: texto(body?.compromisos, 4000),
      comentario_empleado: texto(body?.comentario_empleado, 4000),
      estado: texto(body?.estado, 20) || 'borrador',
      fecha_evaluacion: body?.fecha_evaluacion || new Date().toISOString().slice(0, 10),
      updated_at: new Date().toISOString(),
    };

    if (body?.id) {
      const { data, error } = await this.db
        .from('rrhh_evaluaciones')
        .update(payload)
        .eq('id', num(body.id))
        .select()
        .single();
      if (error) this.error(error);
      return data;
    }
    const { data, error } = await this.db.from('rrhh_evaluaciones').insert(payload).select().single();
    if (error) this.error(error);
    return data;
  }

  async eliminarEvaluacion(id: number) {
    const { error } = await this.db.from('rrhh_evaluaciones').delete().eq('id', id);
    if (error) this.error(error);
    return { ok: true };
  }

  // ==========================================================================
  // DOCUMENTOS
  // ==========================================================================
  async listarDocumentos(empleadoId: number, soloVisibles = false) {
    let q = this.db
      .from('rrhh_documentos')
      .select('*')
      .eq('empleado_id', empleadoId)
      .order('created_at', { ascending: false });
    if (soloVisibles) q = q.eq('visible_trabajador', true);
    const { data, error } = await q;
    if (error) this.error(error);
    return data || [];
  }

  async crearDocumento(body: any, subidoPor?: string) {
    const payload = {
      empleado_id: num(body?.empleado_id),
      tipo: texto(body?.tipo, 40) || 'otro',
      titulo: texto(body?.titulo, 200),
      descripcion: texto(body?.descripcion, 1000),
      bucket: texto(body?.bucket, 60) || BUCKET,
      storage_path: texto(body?.storage_path, 400),
      file_name: texto(body?.file_name, 200),
      mime_type: texto(body?.mime_type, 120),
      size_bytes: body?.size_bytes != null ? num(body.size_bytes) : null,
      requiere_firma: Boolean(body?.requiere_firma),
      visible_trabajador: body?.visible_trabajador !== false,
      subido_por: texto(subidoPor, 120),
    };
    if (!payload.empleado_id) throw new BadRequestException('Falta el trabajador.');
    const { data, error } = await this.db.from('rrhh_documentos').insert(payload).select().single();
    if (error) this.error(error);
    return data;
  }

  async eliminarDocumento(id: number) {
    const { data } = await this.db.from('rrhh_documentos').select('bucket,storage_path').eq('id', id).maybeSingle();
    const { error } = await this.db.from('rrhh_documentos').delete().eq('id', id);
    if (error) this.error(error);
    if (data?.bucket && data?.storage_path) {
      await this.eliminarArchivo(data.bucket, data.storage_path).catch(() => undefined);
    }
    return { ok: true };
  }

  // ==========================================================================
  // FIRMAS ELECTRÓNICAS SIMPLES
  // ==========================================================================
  // Registra la firma y marca el documento como firmado. El hash se calcula
  // sobre el contenido firmado para poder probar que no cambió después.
  async firmar(
    body: {
      documento_tipo?: string;
      documento_id?: number;
      empleado_id?: number;
      firma_imagen?: string;
      contenido?: string;
    },
    firmante: { email?: string; nombre?: string; rut?: string; ip?: string; userAgent?: string },
  ) {
    const tipo = String(body?.documento_tipo || '').trim();
    const docId = num(body?.documento_id);
    const validos = ['contrato', 'liquidacion', 'evaluacion', 'documento'];
    if (!validos.includes(tipo)) throw new BadRequestException('Tipo de documento inválido.');
    if (!docId) throw new BadRequestException('Falta el documento a firmar.');

    const hash = createHash('sha256')
      .update(String(body?.contenido || `${tipo}:${docId}`))
      .digest('hex');

    const payload = {
      documento_tipo: tipo,
      documento_id: docId,
      empleado_id: body?.empleado_id ? num(body.empleado_id) : null,
      firmante_email: texto(firmante?.email, 120),
      firmante_nombre: texto(firmante?.nombre, 120),
      firmante_rut: texto(firmante?.rut, 20),
      firma_imagen: body?.firma_imagen ? String(body.firma_imagen).slice(0, 500000) : null,
      hash_documento: hash,
      ip_address: texto(firmante?.ip, 60),
      user_agent: texto(firmante?.userAgent, 400),
    };
    const { data, error } = await this.db.from('rrhh_firmas').insert(payload).select().single();
    if (error) this.error(error);

    // Marca el documento de origen como firmado.
    const ahora = new Date().toISOString();
    if (tipo === 'contrato') {
      await this.db.from('rrhh_contratos').update({ estado: 'firmado', firmado_at: ahora }).eq('id', docId);
    } else if (tipo === 'liquidacion') {
      await this.db.from('rrhh_liquidaciones').update({ estado: 'firmada', firmada_at: ahora }).eq('id', docId);
    } else if (tipo === 'evaluacion') {
      await this.db.from('rrhh_evaluaciones').update({ estado: 'firmada', firmada_at: ahora }).eq('id', docId);
    }
    return data;
  }

  async listarFirmas(documentoTipo: string, documentoId: number) {
    const { data, error } = await this.db
      .from('rrhh_firmas')
      .select('*')
      .eq('documento_tipo', documentoTipo)
      .eq('documento_id', documentoId)
      .order('firmado_at', { ascending: false });
    if (error) this.error(error);
    return data || [];
  }

  // ==========================================================================
  // JORNADAS PACTADAS
  // ==========================================================================
  async jornadasDe(empleadoId: number) {
    const { data, error } = await this.db
      .from('rrhh_jornadas')
      .select('*')
      .eq('empleado_id', empleadoId)
      .order('dia_semana', { ascending: true });
    if (error) this.error(error);
    return data || [];
  }

  async guardarJornadas(empleadoId: number, jornadas: any[]) {
    if (!empleadoId) throw new BadRequestException('Falta el trabajador.');
    const { error: delErr } = await this.db.from('rrhh_jornadas').delete().eq('empleado_id', empleadoId);
    if (delErr) this.error(delErr);
    const filas = (Array.isArray(jornadas) ? jornadas : [])
      .filter((j) => j && Number.isFinite(Number(j.dia_semana)) && (j.hora_entrada || j.hora_salida))
      .map((j) => ({
        empleado_id: empleadoId,
        dia_semana: Number(j.dia_semana),
        hora_entrada: j.hora_entrada || null,
        hora_salida: j.hora_salida || null,
        colacion_minutos: num(j.colacion_minutos, 60),
        activo: j.activo !== false,
      }));
    if (filas.length) {
      const { error } = await this.db.from('rrhh_jornadas').insert(filas);
      if (error) this.error(error);
    }
    return { ok: true, guardadas: filas.length };
  }

  // ==========================================================================
  // ASISTENCIA — cruza los marcajes con las jornadas pactadas
  // ==========================================================================
  async reporteAsistencia(filtros: { desde?: string; hasta?: string; email?: string }) {
    const hoy = new Date();
    const hasta = filtros?.hasta || hoy.toISOString().slice(0, 10);
    const desde =
      filtros?.desde || new Date(hoy.getFullYear(), hoy.getMonth(), 1).toISOString().slice(0, 10);

    let q = this.db
      .from('marcajes')
      .select('user_email,user_nombre,tipo,marcado_at,fuera_de_radio,oficina_id,distancia_m')
      .gte('marcado_at', `${desde}T00:00:00`)
      .lte('marcado_at', `${hasta}T23:59:59`)
      .order('marcado_at', { ascending: true })
      .limit(20000);
    if (filtros?.email) q = q.ilike('user_email', String(filtros.email).trim().toLowerCase());
    const { data: marcas, error } = await q;
    if (error) this.error(error);

    const empleados = await this.listarEmpleados();
    const porEmail = new Map<string, any>();
    for (const e of empleados) {
      if (e.email) porEmail.set(String(e.email).toLowerCase(), e);
    }
    // Jornadas de todos (una sola consulta).
    const { data: jornadasTodas } = await this.db.from('rrhh_jornadas').select('*');
    const jornadasPorEmpleado = new Map<number, any[]>();
    for (const j of jornadasTodas || []) {
      const arr = jornadasPorEmpleado.get(Number(j.empleado_id)) || [];
      arr.push(j);
      jornadasPorEmpleado.set(Number(j.empleado_id), arr);
    }

    // Agrupa marcas por trabajador y día.
    const dias = new Map<string, any>();
    for (const m of marcas || []) {
      const email = String(m.user_email || '').toLowerCase();
      const fecha = String(m.marcado_at).slice(0, 10);
      const clave = `${email}|${fecha}`;
      const dia = dias.get(clave) || {
        email,
        nombre: m.user_nombre || porEmail.get(email)?.nombre || email,
        fecha,
        entrada: null as string | null,
        salida: null as string | null,
        marcas: 0,
        fuera_de_radio: false,
      };
      dia.marcas += 1;
      if (m.fuera_de_radio) dia.fuera_de_radio = true;
      if (m.tipo === 'entrada') {
        if (!dia.entrada || m.marcado_at < dia.entrada) dia.entrada = m.marcado_at;
      } else if (m.tipo === 'salida') {
        if (!dia.salida || m.marcado_at > dia.salida) dia.salida = m.marcado_at;
      }
      dias.set(clave, dia);
    }

    const hhmm = (iso: string | null) => (iso ? String(new Date(iso).toTimeString().slice(0, 5)) : null);
    const minutosDe = (hm: string | null) => {
      if (!hm) return null;
      const [h, m] = String(hm).split(':').map(Number);
      return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null;
    };

    const filas = [...dias.values()].map((d) => {
      const emp = porEmail.get(d.email);
      const dow = new Date(`${d.fecha}T12:00:00`).getDay();
      const jornada = (jornadasPorEmpleado.get(Number(emp?.id)) || []).find(
        (j) => Number(j.dia_semana) === dow && j.activo !== false,
      );
      const entradaHm = hhmm(d.entrada);
      const salidaHm = hhmm(d.salida);
      const entradaMin = minutosDe(entradaHm);
      const salidaMin = minutosDe(salidaHm);
      const pactadaEntrada = minutosDe(jornada?.hora_entrada ? String(jornada.hora_entrada).slice(0, 5) : null);
      const pactadaSalida = minutosDe(jornada?.hora_salida ? String(jornada.hora_salida).slice(0, 5) : null);
      const colacion = num(jornada?.colacion_minutos, 60);

      const atrasoMin = pactadaEntrada != null && entradaMin != null ? Math.max(0, entradaMin - pactadaEntrada) : null;
      const salidaAnticipadaMin =
        pactadaSalida != null && salidaMin != null ? Math.max(0, pactadaSalida - salidaMin) : null;
      const trabajadoMin =
        entradaMin != null && salidaMin != null ? Math.max(0, salidaMin - entradaMin - colacion) : null;
      const esperadoMin =
        pactadaEntrada != null && pactadaSalida != null ? Math.max(0, pactadaSalida - pactadaEntrada - colacion) : null;

      return {
        ...d,
        empleado_id: emp?.id || null,
        cargo: emp?.cargo || null,
        area: emp?.area || null,
        entrada_hora: entradaHm,
        salida_hora: salidaHm,
        jornada_entrada: jornada?.hora_entrada ? String(jornada.hora_entrada).slice(0, 5) : null,
        jornada_salida: jornada?.hora_salida ? String(jornada.hora_salida).slice(0, 5) : null,
        atraso_min: atrasoMin,
        salida_anticipada_min: salidaAnticipadaMin,
        trabajado_min: trabajadoMin,
        esperado_min: esperadoMin,
        sin_salida: Boolean(d.entrada && !d.salida),
      };
    });

    filas.sort((a, b) => (a.fecha === b.fecha ? a.nombre.localeCompare(b.nombre) : b.fecha.localeCompare(a.fecha)));

    // Resumen por trabajador.
    const resumenMap = new Map<string, any>();
    for (const f of filas) {
      const r = resumenMap.get(f.email) || {
        email: f.email,
        nombre: f.nombre,
        area: f.area,
        dias_con_marca: 0,
        atrasos: 0,
        minutos_atraso: 0,
        dias_sin_salida: 0,
        minutos_trabajados: 0,
        dias_fuera_de_radio: 0,
      };
      r.dias_con_marca += 1;
      if (num(f.atraso_min) > 5) {
        r.atrasos += 1;
        r.minutos_atraso += num(f.atraso_min);
      }
      if (f.sin_salida) r.dias_sin_salida += 1;
      if (f.fuera_de_radio) r.dias_fuera_de_radio += 1;
      r.minutos_trabajados += num(f.trabajado_min);
      resumenMap.set(f.email, r);
    }

    return {
      rango: { desde, hasta },
      dias: filas,
      resumen: [...resumenMap.values()].sort((a, b) => b.atrasos - a.atrasos || a.nombre.localeCompare(b.nombre)),
    };
  }

  // ==========================================================================
  // REPORTES / TABLERO
  // ==========================================================================
  async tablero() {
    const [empleados, contratos, solicitudes, evaluaciones] = await Promise.all([
      this.listarEmpleados(),
      this.listarContratos(),
      this.listarSolicitudes(),
      this.listarEvaluaciones(),
    ]);

    const activos = empleados.filter((e: any) => e.estado === 'activo');
    const hoy = new Date();
    const en30dias = new Date(hoy.getTime() + 30 * 86400000).toISOString().slice(0, 10);
    const hoyIso = hoy.toISOString().slice(0, 10);
    const mesActual = hoy.getMonth() + 1;

    // Costo mensual de la nómina (sueldo base + no imponibles de la ficha).
    const costoNomina = activos.reduce(
      (s: number, e: any) => s + num(e.sueldo_base) + num(e.colacion) + num(e.movilizacion),
      0,
    );

    // Dotación por área y por tipo de contrato.
    const agrupar = (campo: string) => {
      const m = new Map<string, number>();
      for (const e of activos) {
        const k = String(e[campo] || 'Sin definir');
        m.set(k, (m.get(k) || 0) + 1);
      }
      return [...m.entries()].map(([nombre, total]) => ({ nombre, total })).sort((a, b) => b.total - a.total);
    };

    // Contratos a plazo fijo que vencen dentro de 30 días.
    const porVencer = contratos.filter(
      (c: any) => c.fecha_termino && c.fecha_termino >= hoyIso && c.fecha_termino <= en30dias,
    );

    // Cumpleaños del mes.
    const cumpleanos = activos
      .filter((e: any) => e.fecha_nacimiento && Number(String(e.fecha_nacimiento).slice(5, 7)) === mesActual)
      .map((e: any) => ({
        id: e.id,
        nombre: `${e.nombre} ${e.apellidos || ''}`.trim(),
        dia: Number(String(e.fecha_nacimiento).slice(8, 10)),
      }))
      .sort((a: any, b: any) => a.dia - b.dia);

    // Antigüedad promedio (meses).
    const antiguedades = activos
      .map((e: any) => this.antiguedad(e.fecha_ingreso)?.total_meses)
      .filter((n: any) => Number.isFinite(n)) as number[];
    const antiguedadProm = antiguedades.length
      ? Number((antiguedades.reduce((s, n) => s + n, 0) / antiguedades.length / 12).toFixed(1))
      : null;

    return {
      dotacion: {
        activos: activos.length,
        total: empleados.length,
        inactivos: empleados.filter((e: any) => e.estado !== 'activo').length,
        por_area: agrupar('area'),
        por_tipo_contrato: agrupar('tipo_contrato'),
        antiguedad_promedio_anios: antiguedadProm,
      },
      nomina: {
        costo_mensual: redondear(costoNomina),
        sueldo_promedio: activos.length ? redondear(costoNomina / activos.length) : 0,
      },
      pendientes: {
        solicitudes: solicitudes.filter((s: any) => s.estado === 'pendiente').length,
        contratos_por_vencer: porVencer.length,
        contratos_sin_firmar: contratos.filter((c: any) => c.estado === 'enviado').length,
        evaluaciones_borrador: evaluaciones.filter((e: any) => e.estado === 'borrador').length,
      },
      contratos_por_vencer: porVencer.map((c: any) => {
        const emp = empleados.find((e: any) => Number(e.id) === Number(c.empleado_id));
        return {
          id: c.id,
          empleado_id: c.empleado_id,
          nombre: emp ? `${emp.nombre} ${emp.apellidos || ''}`.trim() : '—',
          fecha_termino: c.fecha_termino,
          tipo: c.tipo,
        };
      }),
      cumpleanos_mes: cumpleanos,
      ausentismo: this.resumenAusentismo(solicitudes),
    };
  }

  private resumenAusentismo(solicitudes: any[]) {
    const anio = new Date().getFullYear();
    const delAnio = (solicitudes || []).filter(
      (s: any) => s.estado === 'aprobada' && String(s.fecha_desde || '').startsWith(String(anio)),
    );
    const porTipo = new Map<string, { dias: number; casos: number }>();
    for (const s of delAnio) {
      const k = String(s.tipo || 'otro');
      const v = porTipo.get(k) || { dias: 0, casos: 0 };
      v.dias += num(s.dias);
      v.casos += 1;
      porTipo.set(k, v);
    }
    return {
      anio,
      total_dias: delAnio.reduce((acc: number, s: any) => acc + num(s.dias), 0),
      por_tipo: [...porTipo.entries()].map(([tipo, v]) => ({ tipo, ...v })).sort((a, b) => b.dias - a.dias),
    };
  }

  // Libro de remuneraciones de un período (para contabilidad).
  async libroRemuneraciones(periodo: string) {
    if (!/^\d{4}-\d{2}$/.test(String(periodo || ''))) {
      throw new BadRequestException('Período inválido (formato AAAA-MM).');
    }
    const [liquidaciones, empleados] = await Promise.all([
      this.listarLiquidaciones({ periodo }),
      this.listarEmpleados(),
    ]);
    const porId = new Map(empleados.map((e: any) => [Number(e.id), e]));
    const filas = liquidaciones.map((l: any) => {
      const e = porId.get(Number(l.empleado_id));
      return {
        ...l,
        rut: e?.rut || null,
        nombre: e ? `${e.nombre} ${e.apellidos || ''}`.trim() : '—',
        cargo: e?.cargo || null,
        area: e?.area || null,
      };
    });
    const suma = (campo: string) => redondear(filas.reduce((s: number, f: any) => s + num(f[campo]), 0));
    return {
      periodo,
      filas,
      totales: {
        trabajadores: filas.length,
        total_imponible: suma('total_imponible'),
        total_haberes: suma('total_haberes'),
        afp: suma('afp_monto'),
        salud: suma('salud_monto'),
        cesantia: suma('seguro_cesantia'),
        impuesto: suma('impuesto_unico'),
        total_descuentos: suma('total_descuentos'),
        liquido: suma('liquido'),
      },
    };
  }

  // ==========================================================================
  // ARCHIVOS (bucket privado 'rrhh')
  // ==========================================================================
  async subirArchivo(path: string, buffer: Buffer, mimeType: string) {
    const ruta = String(path || '').replace(/^\/+/, '');
    if (!ruta) throw new BadRequestException('Ruta de archivo inválida.');
    const { error } = await this.db.storage
      .from(BUCKET)
      .upload(ruta, buffer, { contentType: mimeType || 'application/octet-stream', upsert: true });
    if (error) {
      if (/bucket.*not found/i.test(error.message)) {
        throw new BadRequestException(
          'Falta el bucket "rrhh" en Supabase Storage (lo crea la migración 20260808_rrhh.sql).',
        );
      }
      throw new BadRequestException(error.message);
    }
    return { ok: true, bucket: BUCKET, path: ruta };
  }

  async urlFirmada(bucket: string, path: string) {
    const b = String(bucket || BUCKET);
    const { data, error } = await this.db.storage.from(b).createSignedUrl(String(path || ''), 3600);
    if (error) throw new BadRequestException(error.message);
    return { url: data?.signedUrl || null };
  }

  async eliminarArchivo(bucket: string, path: string) {
    const b = String(bucket || BUCKET);
    const { error } = await this.db.storage.from(b).remove([String(path || '')]);
    if (error) throw new BadRequestException(error.message);
    return { ok: true };
  }
}
