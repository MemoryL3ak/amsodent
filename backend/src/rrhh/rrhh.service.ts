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

// Parámetros previsionales y tributarios de un período. La fuente de verdad es
// la tabla `rrhh_parametros` (un registro por mes): así una liquidación de
// marzo se puede reimprimir en diciembre con la UF de marzo. Estos valores solo
// se usan cuando la tabla todavía no tiene el período, y se pueden ajustar por
// .env para el arranque.
const PARAMETROS_DEFECTO = {
  uf: Number(process.env.RRHH_UF) || 39500,
  utm: Number(process.env.RRHH_UTM) || 69000,
  // Ingreso mínimo mensual (base del tope de gratificación legal).
  imm: Number(process.env.RRHH_IMM) || 529000,
  tope_imponible_uf: Number(process.env.RRHH_TOPE_IMPONIBLE_UF) || 87.8,
  tope_cesantia_uf: Number(process.env.RRHH_TOPE_CESANTIA_UF) || 131.8,
  tasa_salud: 7,
  // Seguro de cesantía: 0,6% del trabajador con contrato indefinido; el
  // empleador aporta 2,4% (indefinido) o 3% (plazo fijo, todo de su cargo).
  tasa_cesantia_trabajador: 0.6,
  tasa_cesantia_empleador: 2.4,
  // Aportes patronales que no aparecen en la liquidación pero sí en el costo.
  tasa_sis: 2,
  tasa_mutual: 0.93,
  // Aporte del empleador de la reforma previsional (ley 21.735): capitalización
  // individual más el seguro social de expectativa de vida.
  tasa_seguro_social: 1,
  // Asignación familiar: monto por carga según la renta imponible del mes.
  af_tramo_a_hasta: 620251,
  af_tramo_a_monto: 22007,
  af_tramo_b_hasta: 905941,
  af_tramo_b_monto: 13505,
  af_tramo_c_hasta: 1412957,
  af_tramo_c_monto: 4267,
  apv_tope_uf_mensual: 50,
  // Tasa AFP por defecto si la ficha no la trae (10% + comisión).
  tasa_afp_default: Number(process.env.RRHH_TASA_AFP) || 11.16,
};

type Parametros = typeof PARAMETROS_DEFECTO & { periodo?: string; origen?: string };

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
    // Columnas agregadas después: liquidación completa, permisos por horas.
    if (/column .*(does not exist|no existe)/i.test(msg)) {
      throw new BadRequestException(
        `Falta aplicar la migración 20260810_rrhh_liquidacion_permisos.sql en Supabase. (${msg})`,
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
    set('dias_administrativos_anuales', num(body?.dias_administrativos_anuales));
    set('cargas_familiares', Math.max(0, Math.floor(num(body?.cargas_familiares))));
    set('apv_monto', redondear(body?.apv_monto));
    set('apv_regimen', body?.apv_regimen === 'A' ? 'A' : body?.apv_regimen === 'B' ? 'B' : null);
    set('apv_institucion', texto(body?.apv_institucion, 80));
    set('cuota_sindical', redondear(body?.cuota_sindical));
    set('nacionalidad', texto(body?.nacionalidad, 60));
    set('estado_civil', texto(body?.estado_civil, 40));
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
      saldos: await this.saldosDe(Number(id)).catch(() => null),
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

  // Parámetros del período. Busca el registro exacto en `rrhh_parametros`; si
  // no existe usa el más reciente anterior (la UF de un mes sin cargar es la
  // del último mes cargado, no la de hoy) y, en última instancia, los valores
  // por defecto del backend.
  async parametrosDe(periodo?: string): Promise<Parametros> {
    const p = /^\d{4}-\d{2}$/.test(String(periodo || '')) ? String(periodo) : null;
    try {
      let q = this.db.from('rrhh_parametros').select('*').order('periodo', { ascending: false }).limit(1);
      if (p) q = q.lte('periodo', p);
      const { data } = await q;
      const fila = (data || [])[0];
      if (fila) {
        const { notas: _n, actualizado_por: _a, updated_at: _u, ...valores } = fila as any;
        return {
          ...PARAMETROS_DEFECTO,
          ...Object.fromEntries(
            Object.entries(valores).filter(([k, v]) => k !== 'periodo' && v != null && Number.isFinite(Number(v))),
          ),
          periodo: fila.periodo,
          origen: fila.periodo === p ? 'periodo' : 'anterior',
        } as Parametros;
      }
    } catch {
      /* tabla aún no creada: se sigue con los valores por defecto */
    }
    return { ...PARAMETROS_DEFECTO, periodo: p || undefined, origen: 'defecto' };
  }

  async listarParametros() {
    const { data, error } = await this.db
      .from('rrhh_parametros')
      .select('*')
      .order('periodo', { ascending: false });
    if (error) this.error(error);
    return data || [];
  }

  async guardarParametros(body: any, email?: string) {
    const periodo = String(body?.periodo || '').trim();
    if (!/^\d{4}-\d{2}$/.test(periodo)) throw new BadRequestException('Período inválido (formato AAAA-MM).');
    const payload: Record<string, any> = { periodo, actualizado_por: texto(email, 120), updated_at: new Date().toISOString() };
    for (const clave of Object.keys(PARAMETROS_DEFECTO)) {
      if (clave === 'tasa_afp_default') continue; // vive en la ficha de cada trabajador
      if (body?.[clave] !== undefined && body[clave] !== '') payload[clave] = num(body[clave]);
    }
    if (body?.notas !== undefined) payload.notas = texto(body.notas, 1000);
    const { data, error } = await this.db
      .from('rrhh_parametros')
      .upsert(payload, { onConflict: 'periodo' })
      .select()
      .single();
    if (error) this.error(error);
    return data;
  }

  // Asignación familiar: monto por carga según la renta imponible del mes.
  // Tramo D (rentas altas) no da derecho a asignación.
  private asignacionFamiliarDe(rentaImponible: number, cargas: number, par: Parametros) {
    const n = Math.max(0, Math.floor(num(cargas)));
    if (!n) return { tramo: null as string | null, monto_carga: 0, monto: 0 };
    let tramo = 'D';
    let montoCarga = 0;
    if (rentaImponible <= par.af_tramo_a_hasta) {
      tramo = 'A';
      montoCarga = par.af_tramo_a_monto;
    } else if (rentaImponible <= par.af_tramo_b_hasta) {
      tramo = 'B';
      montoCarga = par.af_tramo_b_monto;
    } else if (rentaImponible <= par.af_tramo_c_hasta) {
      tramo = 'C';
      montoCarga = par.af_tramo_c_monto;
    }
    return { tramo, monto_carga: redondear(montoCarga), monto: redondear(montoCarga * n) };
  }

  // Valor de una hora extra: sueldo mensual ÷ 30 × 7 ÷ jornada semanal × 1,5.
  // Para la jornada de 45 horas equivale al factor 0,0077778 de uso habitual.
  private valorHoraExtra(sueldoBaseMensual: number, horasSemanales: number, recargo = 1.5) {
    const horas = num(horasSemanales, 45) || 45;
    return redondear((num(sueldoBaseMensual) / 30) * (7 / horas) * recargo);
  }

  // Calcula una liquidación completa a partir de los haberes. Devuelve todos
  // los subtotales para que queden guardados y auditables.
  calcularLiquidacion(
    entrada: {
      sueldo_base?: number;
      horas_semanales?: number;
      dias_trabajados?: number;
      dias_ausencia?: number;
      dias_licencia?: number;
      gratificacion_legal?: boolean;
      gratificacion?: number;
      horas_extra_cantidad?: number;
      horas_extra?: number;
      semana_corrida?: number;
      aguinaldo?: number;
      bonos?: number;
      comisiones?: number;
      otros_imponibles?: number;
      colacion?: number;
      movilizacion?: number;
      cargas_familiares?: number;
      asignacion_familiar?: number;
      otros_no_imponibles?: number;
      tasa_afp?: number;
      salud?: string;
      plan_salud_uf?: number;
      tipo_contrato?: string;
      apv?: number;
      apv_regimen?: string;
      anticipos?: number;
      prestamos?: number;
      cuota_sindical?: number;
      descuento_atrasos?: number;
      otros_descuentos?: number;
    },
    par: Parametros,
  ) {
    // ── Días del período (base 30) ────────────────────────────────────────
    const diasAusencia = Math.max(0, num(entrada.dias_ausencia));
    const diasLicencia = Math.max(0, num(entrada.dias_licencia));
    // Si no se indican días trabajados se deducen: los de licencia los paga la
    // isapre/Fonasa y los de ausencia sin goce simplemente no se pagan.
    const dias =
      entrada.dias_trabajados != null
        ? Math.min(30, Math.max(0, num(entrada.dias_trabajados, 30)))
        : Math.min(30, Math.max(0, 30 - diasAusencia - diasLicencia));
    const proporcion = dias / 30;

    const sueldoBaseMensual = num(entrada.sueldo_base);
    const sueldoBase = redondear(sueldoBaseMensual * proporcion);

    // ── Horas extra ───────────────────────────────────────────────────────
    // Si viene la cantidad de horas se calcula el monto; si viene el monto
    // directo (caso de un pacto distinto) se respeta tal cual.
    const horasExtraCantidad = Math.max(0, num(entrada.horas_extra_cantidad));
    const valorHora = this.valorHoraExtra(sueldoBaseMensual, num(entrada.horas_semanales, 45));
    const horasExtra = horasExtraCantidad
      ? redondear(valorHora * horasExtraCantidad)
      : redondear(entrada.horas_extra);

    const semanaCorrida = redondear(entrada.semana_corrida);
    const aguinaldo = redondear(entrada.aguinaldo);
    const bonos = redondear(entrada.bonos);
    const comisiones = redondear(entrada.comisiones);
    const otrosImp = redondear(entrada.otros_imponibles);

    // ── Gratificación legal (art. 50) ─────────────────────────────────────
    // 25% de las remuneraciones imponibles con tope de 4,75 ingresos mínimos
    // al año (÷ 12 al mes), proporcional a los días trabajados.
    const baseGratificacion = sueldoBase + horasExtra + semanaCorrida + bonos + comisiones + otrosImp;
    let gratificacion = redondear(entrada.gratificacion);
    if (!gratificacion && entrada.gratificacion_legal !== false) {
      const topeMensual = (4.75 * par.imm) / 12;
      gratificacion = redondear(Math.min(baseGratificacion * 0.25, topeMensual * proporcion));
    }

    const totalImponible =
      sueldoBase + gratificacion + horasExtra + semanaCorrida + aguinaldo + bonos + comisiones + otrosImp;

    // ── Cotizaciones previsionales ────────────────────────────────────────
    const topeImponible = par.tope_imponible_uf * par.uf;
    const imponibleTopado = Math.min(totalImponible, topeImponible);

    const tasaAfp = num(entrada.tasa_afp, par.tasa_afp_default);
    const afpMonto = redondear(imponibleTopado * (tasaAfp / 100));

    // Salud: 7% legal; si hay plan Isapre en UF se cotiza el mayor de ambos y
    // la diferencia sobre el 7% es el "adicional" que se muestra aparte.
    const salud7 = redondear(imponibleTopado * (par.tasa_salud / 100));
    const planUf = num(entrada.plan_salud_uf);
    const esIsapre = String(entrada.salud || '').toLowerCase().includes('isapre') || planUf > 0;
    const planPesos = redondear(planUf * par.uf);
    const saludMonto = esIsapre && planUf > 0 ? Math.max(salud7, planPesos) : salud7;
    const saludAdicional = Math.max(0, saludMonto - salud7);

    // Seguro de cesantía: 0,6% del trabajador solo con contrato indefinido.
    const topeCesantia = par.tope_cesantia_uf * par.uf;
    const cesantiaTopado = Math.min(totalImponible, topeCesantia);
    const esIndefinido = String(entrada.tipo_contrato || 'indefinido').toLowerCase().includes('indefinido');
    const seguroCesantia = esIndefinido
      ? redondear(cesantiaTopado * (par.tasa_cesantia_trabajador / 100))
      : 0;

    // ── APV ───────────────────────────────────────────────────────────────
    // Régimen B rebaja la base tributable (con tope de 50 UF mensuales);
    // régimen A no rebaja impuesto, el beneficio es la bonificación fiscal.
    const apvSolicitado = redondear(entrada.apv);
    const apvRegimen = String(entrada.apv_regimen || 'B').toUpperCase() === 'A' ? 'A' : 'B';
    const apvTope = redondear(par.apv_tope_uf_mensual * par.uf);
    const apv = Math.min(apvSolicitado, Math.max(0, apvTope));
    const apvRebaja = apvRegimen === 'B' ? apv : 0;

    // ── Impuesto único de segunda categoría ───────────────────────────────
    const baseTributable = Math.max(0, totalImponible - afpMonto - saludMonto - seguroCesantia - apvRebaja);
    const baseUtm = baseTributable / par.utm;
    const tramo = TRAMOS_IMPUESTO.find((t) => baseUtm > t.desde && baseUtm <= t.hasta) || TRAMOS_IMPUESTO[0];
    const impuestoUnico = Math.max(0, redondear(baseTributable * tramo.factor - tramo.rebaja * par.utm));

    // ── Haberes no imponibles ─────────────────────────────────────────────
    // Colación y movilización se pagan por día efectivamente trabajado.
    const colacion = redondear(num(entrada.colacion) * proporcion);
    const movilizacion = redondear(num(entrada.movilizacion) * proporcion);
    // La asignación familiar se calcula por tramo de renta salvo que se fuerce
    // un monto (caso de retroactivos o de asignación maternal).
    const af = this.asignacionFamiliarDe(totalImponible, entrada.cargas_familiares || 0, par);
    const asignacionFamiliar =
      entrada.asignacion_familiar != null && entrada.asignacion_familiar !== ('' as any)
        ? redondear(entrada.asignacion_familiar)
        : af.monto;
    const otrosNoImp = redondear(entrada.otros_no_imponibles);

    const totalNoImponible = colacion + movilizacion + asignacionFamiliar + otrosNoImp;
    const totalHaberes = totalImponible + totalNoImponible;

    // ── Otros descuentos ──────────────────────────────────────────────────
    const anticipos = redondear(entrada.anticipos);
    const prestamos = redondear(entrada.prestamos);
    const cuotaSindical = redondear(entrada.cuota_sindical);
    const descuentoAtrasos = redondear(entrada.descuento_atrasos);
    const otrosDesc = redondear(entrada.otros_descuentos);

    const descuentosLegales = afpMonto + saludMonto + seguroCesantia + impuestoUnico;
    const otrosDescuentosTotal = apv + anticipos + prestamos + cuotaSindical + descuentoAtrasos + otrosDesc;
    const totalDescuentos = descuentosLegales + otrosDescuentosTotal;

    // ── Costo para la empresa (no se muestra al trabajador) ───────────────
    const sis = redondear(imponibleTopado * (par.tasa_sis / 100));
    const afcEmpleador = redondear(
      cesantiaTopado * ((esIndefinido ? par.tasa_cesantia_empleador : 3) / 100),
    );
    const mutual = redondear(totalImponible * (par.tasa_mutual / 100));
    const seguroSocial = redondear(imponibleTopado * (par.tasa_seguro_social / 100));
    const costoEmpresa = totalHaberes + sis + afcEmpleador + mutual + seguroSocial;

    return {
      dias_trabajados: dias,
      dias_ausencia: diasAusencia,
      dias_licencia: diasLicencia,
      // Haberes imponibles
      sueldo_base: sueldoBase,
      gratificacion,
      horas_extra_cantidad: horasExtraCantidad,
      horas_extra_valor: valorHora,
      horas_extra: horasExtra,
      semana_corrida: semanaCorrida,
      aguinaldo,
      bonos,
      comisiones,
      otros_imponibles: otrosImp,
      total_imponible: totalImponible,
      // Haberes no imponibles
      colacion,
      movilizacion,
      cargas_familiares: Math.max(0, Math.floor(num(entrada.cargas_familiares))),
      tramo_asignacion: af.tramo,
      asignacion_familiar: asignacionFamiliar,
      otros_no_imponibles: otrosNoImp,
      total_no_imponible: totalNoImponible,
      total_haberes: totalHaberes,
      // Descuentos legales
      afp_monto: afpMonto,
      afp_tasa: tasaAfp,
      salud_monto: saludMonto,
      salud_legal: salud7,
      salud_adicional: saludAdicional,
      seguro_cesantia: seguroCesantia,
      base_tributable: baseTributable,
      impuesto_unico: impuestoUnico,
      total_descuentos_legales: descuentosLegales,
      // Otros descuentos
      apv,
      apv_regimen: apvRegimen,
      anticipos,
      prestamos,
      cuota_sindical: cuotaSindical,
      descuento_atrasos: descuentoAtrasos,
      otros_descuentos: otrosDesc,
      total_otros_descuentos: otrosDescuentosTotal,
      total_descuentos: totalDescuentos,
      liquido: totalHaberes - totalDescuentos,
      // Aportes del empleador
      aporte_sis: sis,
      aporte_cesantia_empleador: afcEmpleador,
      aporte_mutual: mutual,
      aporte_seguro_social: seguroSocial,
      costo_empresa: costoEmpresa,
      topes: {
        imponible: redondear(topeImponible),
        cesantia: redondear(topeCesantia),
        apv: apvTope,
        gratificacion_mensual: redondear((4.75 * par.imm) / 12),
      },
      parametros: par,
    };
  }

  // Arma la entrada del cálculo mezclando la ficha del trabajador con lo que
  // se está editando en el formulario. Lo del formulario siempre manda.
  private entradaDesdeFicha(emp: any, body: any) {
    return {
      sueldo_base: emp?.sueldo_base,
      horas_semanales: emp?.horas_semanales,
      colacion: emp?.colacion,
      movilizacion: emp?.movilizacion,
      tasa_afp: emp?.tasa_afp,
      salud: emp?.salud,
      plan_salud_uf: emp?.plan_salud_uf,
      tipo_contrato: emp?.tipo_contrato,
      gratificacion_legal: emp?.gratificacion_legal,
      cargas_familiares: emp?.cargas_familiares,
      apv: emp?.apv_monto,
      apv_regimen: emp?.apv_regimen,
      cuota_sindical: emp?.cuota_sindical,
      // Lo editado en pantalla pisa la ficha, pero solo si trae valor: un campo
      // vacío significa "usa lo de la ficha", no "cero".
      ...Object.fromEntries(Object.entries(body || {}).filter(([, v]) => v !== '' && v != null)),
    };
  }

  // Previsualiza el cálculo sin guardar (lo usa el formulario en vivo).
  async previsualizarLiquidacion(body: any) {
    const par = await this.parametrosDe(body?.periodo);
    if (!body?.empleado_id) return this.calcularLiquidacion(body || {}, par);
    const emp = await this.obtenerEmpleado(num(body.empleado_id));
    return this.calcularLiquidacion(this.entradaDesdeFicha(emp, body), par);
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
    const par = await this.parametrosDe(periodo);
    const calc = this.calcularLiquidacion(this.entradaDesdeFicha(emp, { ...body, periodo }), par);

    // Solo se guardan las columnas que existen en la tabla; el resto del
    // cálculo (topes, tasas, aportes patronales) va al snapshot `detalle`,
    // que es lo que después imprime el PDF sin recalcular nada.
    const columnas = [
      'dias_trabajados', 'dias_ausencia', 'dias_licencia',
      'sueldo_base', 'gratificacion', 'horas_extra_cantidad', 'horas_extra_valor', 'horas_extra',
      'semana_corrida', 'aguinaldo', 'bonos', 'comisiones', 'otros_imponibles', 'total_imponible',
      'colacion', 'movilizacion', 'cargas_familiares', 'tramo_asignacion', 'asignacion_familiar',
      'otros_no_imponibles', 'total_haberes',
      'afp_monto', 'salud_monto', 'seguro_cesantia', 'base_tributable', 'impuesto_unico',
      'apv', 'apv_regimen', 'anticipos', 'prestamos', 'cuota_sindical', 'descuento_atrasos',
      'otros_descuentos', 'total_descuentos', 'liquido', 'costo_empresa',
    ];
    const montos = Object.fromEntries(columnas.map((c) => [c, (calc as any)[c]]));

    const payload: Record<string, any> = {
      empleado_id: empleadoId,
      periodo,
      ...montos,
      detalle: calc,
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

  // Tipos de solicitud y cómo se miden. `dias_legales` es el máximo que fija
  // la ley para los permisos con fecha determinada (art. 66 del Código del
  // Trabajo y ley 21.155): son referencia para el formulario, no un tope duro.
  static readonly TIPOS_SOLICITUD: Record<
    string,
    { label: string; medida: 'dias' | 'horas'; con_goce: boolean; habiles: boolean; dias_legales?: number }
  > = {
    vacaciones: { label: 'Feriado legal (vacaciones)', medida: 'dias', con_goce: true, habiles: true },
    permiso_dias: { label: 'Permiso por días', medida: 'dias', con_goce: true, habiles: true },
    permiso_horas: { label: 'Permiso por horas', medida: 'horas', con_goce: true, habiles: true },
    dia_administrativo: { label: 'Día administrativo', medida: 'dias', con_goce: true, habiles: true },
    licencia_medica: { label: 'Licencia médica', medida: 'dias', con_goce: true, habiles: false },
    sin_goce: { label: 'Permiso sin goce de sueldo', medida: 'dias', con_goce: false, habiles: true },
    fallecimiento: { label: 'Permiso por fallecimiento', medida: 'dias', con_goce: true, habiles: false, dias_legales: 4 },
    matrimonio: { label: 'Matrimonio o acuerdo de unión civil', medida: 'dias', con_goce: true, habiles: false, dias_legales: 5 },
    nacimiento: { label: 'Nacimiento de un hijo', medida: 'dias', con_goce: true, habiles: false, dias_legales: 5 },
    // Compatibilidad con las solicitudes creadas antes de esta versión.
    permiso: { label: 'Permiso', medida: 'dias', con_goce: true, habiles: true },
    administrativo: { label: 'Administrativo', medida: 'dias', con_goce: true, habiles: true },
  };

  // Feriados legales cargados en la tabla, cacheados: se consultan en cada
  // cálculo de días hábiles y cambian una vez al año.
  private feriadosCache: { set: Set<string>; at: number } | null = null;

  private async feriadosSet(): Promise<Set<string>> {
    if (this.feriadosCache && Date.now() - this.feriadosCache.at < 3600000) {
      return this.feriadosCache.set;
    }
    let set = new Set<string>();
    try {
      const { data } = await this.db.from('rrhh_feriados').select('fecha');
      set = new Set((data || []).map((f: any) => String(f.fecha).slice(0, 10)));
    } catch {
      /* tabla aún no creada: solo se excluyen sábados y domingos */
    }
    this.feriadosCache = { set, at: Date.now() };
    return set;
  }

  async listarFeriados(anio?: string) {
    let q = this.db.from('rrhh_feriados').select('*').order('fecha', { ascending: true });
    if (/^\d{4}$/.test(String(anio || ''))) {
      q = q.gte('fecha', `${anio}-01-01`).lte('fecha', `${anio}-12-31`);
    }
    const { data, error } = await q;
    if (error) this.error(error);
    return data || [];
  }

  async guardarFeriado(body: any) {
    const fecha = String(body?.fecha || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) throw new BadRequestException('Fecha inválida.');
    const { data, error } = await this.db
      .from('rrhh_feriados')
      .upsert(
        {
          fecha,
          nombre: texto(body?.nombre, 120) || 'Feriado',
          irrenunciable: Boolean(body?.irrenunciable),
          tipo: texto(body?.tipo, 20) || 'civil',
        },
        { onConflict: 'fecha' },
      )
      .select()
      .single();
    if (error) this.error(error);
    this.feriadosCache = null;
    return data;
  }

  async eliminarFeriado(fecha: string) {
    const { error } = await this.db.from('rrhh_feriados').delete().eq('fecha', String(fecha).slice(0, 10));
    if (error) this.error(error);
    this.feriadosCache = null;
    return { ok: true };
  }

  // Días entre dos fechas. `habiles` excluye sábados, domingos y feriados
  // legales — es como se cuentan las vacaciones. Sin `habiles` cuenta días
  // corridos, que es como se cuentan las licencias médicas y los permisos del
  // art. 66 (fallecimiento, matrimonio, nacimiento).
  private async contarDias(desde: string, hasta: string, habiles: boolean): Promise<number> {
    const d0 = new Date(`${String(desde).slice(0, 10)}T00:00:00`);
    const d1 = new Date(`${String(hasta).slice(0, 10)}T00:00:00`);
    if (Number.isNaN(d0.getTime()) || Number.isNaN(d1.getTime()) || d1 < d0) return 0;
    if (!habiles) return Math.round((d1.getTime() - d0.getTime()) / 86400000) + 1;

    const feriados = await this.feriadosSet();
    let dias = 0;
    const cursor = new Date(d0);
    while (cursor <= d1) {
      const dow = cursor.getDay();
      const iso = cursor.toISOString().slice(0, 10);
      if (dow !== 0 && dow !== 6 && !feriados.has(iso)) dias += 1;
      cursor.setDate(cursor.getDate() + 1);
    }
    return dias;
  }

  // Horas entre dos horas del mismo día (permisos por horas).
  private horasEntre(horaDesde?: string | null, horaHasta?: string | null): number {
    const min = (h?: string | null) => {
      const m = /^(\d{1,2}):(\d{2})/.exec(String(h || ''));
      return m ? Number(m[1]) * 60 + Number(m[2]) : null;
    };
    const a = min(horaDesde);
    const b = min(horaHasta);
    if (a == null || b == null || b <= a) return 0;
    return Number(((b - a) / 60).toFixed(2));
  }

  // Calcula días/horas de una solicitud sin guardarla y, si es feriado legal,
  // avisa cómo queda el saldo de vacaciones. Lo usa el formulario en vivo.
  async previsualizarSolicitud(body: any) {
    const tipo = String(body?.tipo || 'vacaciones');
    const cfg = RrhhService.TIPOS_SOLICITUD[tipo] || RrhhService.TIPOS_SOLICITUD.permiso_dias;
    const desde = String(body?.fecha_desde || '').slice(0, 10);
    const hasta = String(body?.fecha_hasta || desde).slice(0, 10);
    const medida = body?.medida || cfg.medida;

    if (medida === 'horas') {
      const horas = this.horasEntre(body?.hora_desde, body?.hora_hasta);
      return { medida, tipo, horas, dias: 0, dias_corridos: 0, cfg };
    }

    // Medio día: cuenta como 0,5 aunque el rango sea de un día completo.
    const parcial = String(body?.jornada_parcial || '');
    const habiles = body?.dias_habiles != null ? Boolean(body.dias_habiles) : cfg.habiles;
    let dias = await this.contarDias(desde, hasta, habiles);
    if (parcial === 'manana' || parcial === 'tarde') dias = dias ? 0.5 : 0;
    const diasCorridos = await this.contarDias(desde, hasta, false);

    const salida: Record<string, any> = { medida: 'dias', tipo, dias, dias_corridos: diasCorridos, horas: 0, cfg };

    if (tipo === 'vacaciones' && body?.empleado_id) {
      try {
        const emp = await this.obtenerEmpleado(num(body.empleado_id));
        const solicitudes = await this.listarSolicitudes({ empleado_id: Number(emp.id) });
        const vac = this.calcularVacaciones(emp, solicitudes);
        salida.vacaciones = { ...vac, saldo_despues: Number((vac.saldo - dias).toFixed(2)) };
      } catch {
        /* sin ficha no se puede proyectar el saldo, pero el cálculo sigue */
      }
    }
    return salida;
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

  async crearSolicitud(body: any, solicitadoPor?: string) {
    const empleadoId = num(body?.empleado_id);
    const tipo = texto(body?.tipo, 30) || 'vacaciones';
    const cfg = RrhhService.TIPOS_SOLICITUD[tipo];
    if (!cfg) throw new BadRequestException('Tipo de solicitud inválido.');
    if (!empleadoId) throw new BadRequestException('Falta el trabajador.');

    const desde = String(body?.fecha_desde || '').slice(0, 10);
    const medida = body?.medida === 'horas' || cfg.medida === 'horas' ? 'horas' : 'dias';
    // En un permiso por horas el rango es un solo día.
    const hasta = medida === 'horas' ? desde : String(body?.fecha_hasta || desde).slice(0, 10);
    if (!desde || !hasta) throw new BadRequestException('Faltan las fechas de la solicitud.');
    if (hasta < desde) throw new BadRequestException('La fecha de término no puede ser anterior al inicio.');

    const payload: Record<string, any> = {
      empleado_id: empleadoId,
      tipo,
      medida,
      fecha_desde: desde,
      fecha_hasta: hasta,
      motivo: texto(body?.motivo, 1000),
      estado: 'pendiente',
      goce_sueldo: body?.goce_sueldo != null ? Boolean(body.goce_sueldo) : cfg.con_goce,
      solicitado_por: texto(solicitadoPor, 120),
      bucket: texto(body?.bucket, 60),
      storage_path: texto(body?.storage_path, 400),
      file_name: texto(body?.file_name, 200),
    };

    if (medida === 'horas') {
      const horas = this.horasEntre(body?.hora_desde, body?.hora_hasta);
      if (!horas) throw new BadRequestException('Indica una hora de inicio y de término válidas.');
      payload.hora_desde = String(body.hora_desde).slice(0, 5);
      payload.hora_hasta = String(body.hora_hasta).slice(0, 5);
      payload.horas = horas;
      payload.dias = 0;
      payload.dias_corridos = 1;
    } else {
      const parcial = ['manana', 'tarde'].includes(String(body?.jornada_parcial))
        ? String(body.jornada_parcial)
        : null;
      let dias = await this.contarDias(desde, hasta, cfg.habiles);
      if (parcial) dias = dias ? 0.5 : 0;
      if (!dias) throw new BadRequestException('El rango elegido no tiene días hábiles.');
      payload.jornada_parcial = parcial;
      payload.dias = body?.dias != null && body.dias !== '' ? num(body.dias) : dias;
      payload.dias_corridos = await this.contarDias(desde, hasta, false);
    }

    // Aviso —no bloqueo— si las vacaciones exceden el saldo: RR.HH. decide al
    // aprobar. Se registra en el motivo para que quede en el historial.
    if (tipo === 'vacaciones') {
      const emp = await this.obtenerEmpleado(empleadoId);
      const previas = await this.listarSolicitudes({ empleado_id: empleadoId });
      const vac = this.calcularVacaciones(emp, previas);
      if (num(payload.dias) > vac.saldo) {
        payload.motivo = `${payload.motivo || ''}\n[Excede el saldo: pide ${payload.dias} de ${vac.saldo} días disponibles]`.trim();
      }
    }

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

  // Saldo de días administrativos y horas de permiso usadas en el año, para
  // mostrarlo junto al saldo de vacaciones.
  async saldosDe(empleadoId: number) {
    const emp = await this.obtenerEmpleado(empleadoId);
    const solicitudes = await this.listarSolicitudes({ empleado_id: empleadoId });
    const anio = String(new Date().getFullYear());
    const delAnio = solicitudes.filter(
      (s: any) => s.estado === 'aprobada' && String(s.fecha_desde || '').startsWith(anio),
    );
    const suma = (tipos: string[], campo: 'dias' | 'horas') =>
      Number(
        delAnio
          .filter((s: any) => tipos.includes(String(s.tipo)))
          .reduce((acc: number, s: any) => acc + num(s[campo]), 0)
          .toFixed(2),
      );
    const adminUsados = suma(['dia_administrativo', 'administrativo'], 'dias');
    return {
      vacaciones: this.calcularVacaciones(emp, solicitudes),
      administrativos: {
        anuales: num(emp.dias_administrativos_anuales),
        usados: adminUsados,
        saldo: Number((num(emp.dias_administrativos_anuales) - adminUsados).toFixed(2)),
      },
      permisos: {
        dias: suma(['permiso_dias', 'permiso'], 'dias'),
        horas: suma(['permiso_horas'], 'horas'),
        sin_goce: suma(['sin_goce'], 'dias'),
      },
      licencias_dias: suma(['licencia_medica'], 'dias'),
      anio: Number(anio),
    };
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
  // PREVENCIÓN DE RIESGOS — Decreto Supremo 44/2023
  // ==========================================================================
  // Registro electrónico de la gestión preventiva (art. 72 del D.S. 44):
  // documentos del sistema de gestión, actividades con asistentes e
  // incidentes/accidentes. `resumenSst()` arma el checklist de cumplimiento
  // según el número de trabajadores activos (la exigibilidad de Comité
  // Paritario, Delegado SST y Depto. de Prevención depende de la dotación).

  async listarSstDocumentos() {
    const { data, error } = await this.db
      .from('rrhh_sst_documentos')
      .select('*')
      .order('vigente', { ascending: false })
      .order('created_at', { ascending: false });
    if (error) this.error(error);
    return data || [];
  }

  async guardarSstDocumento(body: any, autor?: string) {
    const payload: Record<string, any> = {
      tipo: texto(body?.tipo, 40) || 'otro',
      titulo: texto(body?.titulo, 200),
      version: texto(body?.version, 40),
      fecha_aprobacion: body?.fecha_aprobacion || null,
      proxima_revision: body?.proxima_revision || null,
      aprobado_por: texto(body?.aprobado_por, 120),
      descripcion: texto(body?.descripcion, 2000),
      bucket: texto(body?.bucket, 60),
      storage_path: texto(body?.storage_path, 400),
      file_name: texto(body?.file_name, 200),
      mime_type: texto(body?.mime_type, 120),
      size_bytes: body?.size_bytes != null ? num(body.size_bytes) : null,
      vigente: body?.vigente !== false,
      updated_at: new Date().toISOString(),
    };
    if (body?.id) {
      const { data, error } = await this.db
        .from('rrhh_sst_documentos')
        .update(payload)
        .eq('id', num(body.id))
        .select()
        .single();
      if (error) this.error(error);
      return data;
    }
    // Un solo documento vigente por tipo: la versión nueva archiva la anterior
    // (se conserva como respaldo histórico, art. 72).
    if (payload.vigente) {
      await this.db
        .from('rrhh_sst_documentos')
        .update({ vigente: false, updated_at: payload.updated_at })
        .eq('tipo', payload.tipo)
        .eq('vigente', true);
    }
    payload.subido_por = texto(autor, 120);
    const { data, error } = await this.db.from('rrhh_sst_documentos').insert(payload).select().single();
    if (error) this.error(error);
    return data;
  }

  async eliminarSstDocumento(id: number) {
    const { data } = await this.db
      .from('rrhh_sst_documentos')
      .select('bucket,storage_path')
      .eq('id', id)
      .maybeSingle();
    const { error } = await this.db.from('rrhh_sst_documentos').delete().eq('id', id);
    if (error) this.error(error);
    if (data?.bucket && data?.storage_path) {
      await this.eliminarArchivo(data.bucket, data.storage_path).catch(() => undefined);
    }
    return { ok: true };
  }

  async listarSstActividades() {
    const { data, error } = await this.db
      .from('rrhh_sst_actividades')
      .select('*, asistentes:rrhh_sst_asistentes(id, empleado_id, resultado, observacion)')
      .order('fecha', { ascending: false })
      .order('id', { ascending: false });
    if (error) this.error(error);
    return data || [];
  }

  async guardarSstActividad(body: any, autor?: string) {
    const payload: Record<string, any> = {
      tipo: texto(body?.tipo, 40) || 'capacitacion',
      titulo: texto(body?.titulo, 200) || 'Actividad preventiva',
      descripcion: texto(body?.descripcion, 4000),
      fecha: body?.fecha || new Date().toISOString().slice(0, 10),
      duracion_horas: body?.duracion_horas != null && body.duracion_horas !== '' ? num(body.duracion_horas) : null,
      relator: texto(body?.relator, 160),
      lugar: texto(body?.lugar, 200),
      bucket: texto(body?.bucket, 60),
      storage_path: texto(body?.storage_path, 400),
      file_name: texto(body?.file_name, 200),
      updated_at: new Date().toISOString(),
    };

    let actividad: any;
    if (body?.id) {
      const { data, error } = await this.db
        .from('rrhh_sst_actividades')
        .update(payload)
        .eq('id', num(body.id))
        .select()
        .single();
      if (error) this.error(error);
      actividad = data;
    } else {
      payload.creado_por = texto(autor, 120);
      const { data, error } = await this.db.from('rrhh_sst_actividades').insert(payload).select().single();
      if (error) this.error(error);
      actividad = data;
    }

    // Reemplaza la lista de asistentes (con su resultado de evaluación, art. 16).
    if (Array.isArray(body?.asistentes)) {
      const { error: delErr } = await this.db
        .from('rrhh_sst_asistentes')
        .delete()
        .eq('actividad_id', actividad.id);
      if (delErr) this.error(delErr);
      const filas = body.asistentes
        .map((a: any) => ({
          actividad_id: actividad.id,
          empleado_id: num(a?.empleado_id),
          resultado: texto(a?.resultado, 20),
          observacion: texto(a?.observacion, 400),
        }))
        .filter((a: any) => a.empleado_id);
      if (filas.length) {
        const { error: insErr } = await this.db.from('rrhh_sst_asistentes').insert(filas);
        if (insErr) this.error(insErr);
      }
    }
    return actividad;
  }

  async eliminarSstActividad(id: number) {
    const { data } = await this.db
      .from('rrhh_sst_actividades')
      .select('bucket,storage_path')
      .eq('id', id)
      .maybeSingle();
    const { error } = await this.db.from('rrhh_sst_actividades').delete().eq('id', id);
    if (error) this.error(error);
    if (data?.bucket && data?.storage_path) {
      await this.eliminarArchivo(data.bucket, data.storage_path).catch(() => undefined);
    }
    return { ok: true };
  }

  async listarSstIncidentes() {
    const { data, error } = await this.db
      .from('rrhh_sst_incidentes')
      .select('*')
      .order('fecha_hora', { ascending: false });
    if (error) this.error(error);
    return data || [];
  }

  async guardarSstIncidente(body: any, autor?: string) {
    const payload: Record<string, any> = {
      tipo: texto(body?.tipo, 40) || 'incidente_peligroso',
      fecha_hora: body?.fecha_hora || new Date().toISOString(),
      lugar: texto(body?.lugar, 200),
      empleado_id: body?.empleado_id ? num(body.empleado_id) : null,
      afectado_nombre: texto(body?.afectado_nombre, 160),
      afectado_sexo: texto(body?.afectado_sexo, 20),
      descripcion: texto(body?.descripcion, 2000),
      relato: texto(body?.relato, 8000),
      causas: texto(body?.causas, 4000),
      medidas: texto(body?.medidas, 4000),
      dias_perdidos: num(body?.dias_perdidos, 0),
      denunciado_oa: Boolean(body?.denunciado_oa),
      fecha_denuncia: body?.fecha_denuncia || null,
      estado: texto(body?.estado, 20) || 'abierto',
      bucket: texto(body?.bucket, 60),
      storage_path: texto(body?.storage_path, 400),
      file_name: texto(body?.file_name, 200),
      updated_at: new Date().toISOString(),
    };
    if (body?.id) {
      const { data, error } = await this.db
        .from('rrhh_sst_incidentes')
        .update(payload)
        .eq('id', num(body.id))
        .select()
        .single();
      if (error) this.error(error);
      return data;
    }
    payload.creado_por = texto(autor, 120);
    const { data, error } = await this.db.from('rrhh_sst_incidentes').insert(payload).select().single();
    if (error) this.error(error);
    return data;
  }

  async eliminarSstIncidente(id: number) {
    const { error } = await this.db.from('rrhh_sst_incidentes').delete().eq('id', id);
    if (error) this.error(error);
    return { ok: true };
  }

  // Checklist de cumplimiento + KPIs. Cada check trae la referencia al D.S. 44
  // para que el panel sirva de evidencia y guía en la certificación.
  async resumenSst() {
    const [empleados, docs, actividades, incidentes] = await Promise.all([
      this.listarEmpleados(),
      this.listarSstDocumentos(),
      this.listarSstActividades(),
      this.listarSstIncidentes(),
    ]);

    const activos = (empleados || []).filter((e: any) => e.estado === 'activo');
    const n = activos.length;
    const hoy = new Date().toISOString().slice(0, 10);
    const hace1Anio = new Date(Date.now() - 365 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    const hace2Anios = new Date(Date.now() - 2 * 365 * 24 * 3600 * 1000).toISOString().slice(0, 10);

    const vigente = (tipo: string) => (docs || []).find((d: any) => d.tipo === tipo && d.vigente);
    const checks: any[] = [];
    const push = (clave: string, titulo: string, referencia: string, estado: string, detalle: string) =>
      checks.push({ clave, titulo, referencia, estado, detalle });

    // ── Documentos del sistema ──────────────────────────────────────────────
    const matriz = vigente('matriz_riesgos');
    if (!matriz) {
      push('matriz', 'Matriz de identificación de peligros y evaluación de riesgos', 'art. 7', 'falta',
        'No hay una matriz IPER vigente. Es exigible a toda entidad empleadora y debe estar disponible en los lugares de trabajo.');
    } else if (matriz.proxima_revision && matriz.proxima_revision < hoy) {
      push('matriz', 'Matriz de identificación de peligros y evaluación de riesgos', 'art. 7', 'alerta',
        `La revisión programada venció el ${matriz.proxima_revision}. La matriz se revisa al menos una vez al año o cuando cambien las condiciones, ocurra un accidente o se diagnostique una enfermedad profesional.`);
    } else {
      push('matriz', 'Matriz de identificación de peligros y evaluación de riesgos', 'art. 7', 'ok',
        `Vigente${matriz.fecha_aprobacion ? ` (aprobada el ${matriz.fecha_aprobacion})` : ''}${matriz.proxima_revision ? `, próxima revisión ${matriz.proxima_revision}` : ''}.`);
    }

    const programa = vigente('programa_preventivo');
    if (!programa) {
      push('programa', 'Programa de trabajo preventivo', 'art. 8', 'falta',
        'No hay programa preventivo vigente. Se elabora a partir de la matriz dentro de 30 días desde su confección o actualización, por escrito y aprobado por el representante legal.');
    } else if (matriz?.fecha_aprobacion && programa.fecha_aprobacion && programa.fecha_aprobacion < matriz.fecha_aprobacion) {
      push('programa', 'Programa de trabajo preventivo', 'art. 8', 'alerta',
        `El programa (${programa.fecha_aprobacion}) es anterior a la última matriz (${matriz.fecha_aprobacion}): debe actualizarse dentro de 30 días desde la actualización de la matriz.`);
    } else {
      push('programa', 'Programa de trabajo preventivo', 'art. 8', 'ok',
        `Vigente${programa.fecha_aprobacion ? ` (aprobado el ${programa.fecha_aprobacion})` : ''}. Recuerda la evaluación anual de su cumplimiento (art. 14).`);
    }

    const politica = vigente('politica_sst');
    push('politica', 'Política de seguridad y salud en el trabajo', 'arts. 22 y 64', politica ? 'ok' : 'falta',
      politica
        ? 'Vigente: compromiso con la protección de la vida y salud, el cumplimiento normativo y la mejora continua.'
        : 'No hay política SST registrada. Es el primer elemento del sistema de gestión, también en el régimen simplificado (≤25 personas).');

    const reglamento = vigente('reglamento_interno');
    if (!reglamento) {
      push('reglamento', 'Reglamento Interno de Higiene y Seguridad', 'arts. 56–61', 'falta',
        'Obligatorio para toda entidad empleadora, sin mínimo de trabajadores. Debe entregarse gratuitamente un ejemplar a cada persona y subirse a los sitios de la DT y la Seremi de Salud.');
    } else if (reglamento.proxima_revision && reglamento.proxima_revision < hoy) {
      push('reglamento', 'Reglamento Interno de Higiene y Seguridad', 'arts. 56–61', 'alerta',
        `La revisión venció el ${reglamento.proxima_revision}: el reglamento se revisa al menos una vez al año (art. 57).`);
    } else {
      push('reglamento', 'Reglamento Interno de Higiene y Seguridad', 'arts. 56–61', 'ok',
        `Vigente${reglamento.fecha_aprobacion ? ` (${reglamento.fecha_aprobacion})` : ''}. Entrega un ejemplar a cada trabajador (puede registrarse como documento firmado en su ficha).`);
    }

    const plan = vigente('plan_emergencia');
    const simulacros = (actividades || []).filter((a: any) => a.tipo === 'simulacro');
    const simulacroReciente = simulacros.find((a: any) => a.fecha >= hace1Anio);
    if (!plan) {
      push('emergencia', 'Plan de emergencias, catástrofes o desastres', 'art. 19', 'falta',
        'No hay plan de emergencia vigente. Debe existir, informarse a las personas trabajadoras y ensayarse al menos una vez al año.');
    } else if (!simulacroReciente) {
      push('emergencia', 'Plan de emergencias, catástrofes o desastres', 'art. 19', 'alerta',
        `Plan vigente, pero sin simulacro registrado en los últimos 12 meses${simulacros[0] ? ` (último: ${simulacros[0].fecha})` : ''}. El plan debe ensayarse al menos una vez al año.`);
    } else {
      push('emergencia', 'Plan de emergencias, catástrofes o desastres', 'art. 19', 'ok',
        `Plan vigente y simulacro realizado el ${simulacroReciente.fecha}.`);
    }

    const mapa = vigente('mapa_riesgos');
    if (!mapa) {
      push('mapa', 'Mapa de riesgos', 'art. 62', 'falta',
        'No hay mapa de riesgos registrado. Debe estar visible en cada lugar de trabajo y actualizarse cada vez que cambie la matriz.');
    } else if (matriz?.fecha_aprobacion && mapa.fecha_aprobacion && mapa.fecha_aprobacion < matriz.fecha_aprobacion) {
      push('mapa', 'Mapa de riesgos', 'art. 62', 'alerta',
        `El mapa (${mapa.fecha_aprobacion}) es anterior a la última matriz (${matriz.fecha_aprobacion}): hay que actualizarlo cuando la matriz cambia.`);
    } else {
      push('mapa', 'Mapa de riesgos', 'art. 62', 'ok', 'Vigente y alineado con la matriz.');
    }

    // ── Capacitación y ODI por trabajador ───────────────────────────────────
    const asistenciasPor = new Map<number, { capacitacion: string | null; odi: boolean; epp: string | null }>();
    for (const e of activos) asistenciasPor.set(Number(e.id), { capacitacion: null, odi: false, epp: null });
    for (const a of actividades || []) {
      for (const asis of a.asistentes || []) {
        const reg = asistenciasPor.get(Number(asis.empleado_id));
        if (!reg) continue;
        if (a.tipo === 'capacitacion' && (!reg.capacitacion || a.fecha > reg.capacitacion)) reg.capacitacion = a.fecha;
        if (a.tipo === 'odi') reg.odi = true;
        if (a.tipo === 'entrega_epp' && (!reg.epp || a.fecha > reg.epp)) reg.epp = a.fecha;
      }
    }
    const nombreDe = (e: any) => `${e.nombre} ${e.apellidos || ''}`.trim();
    const sinCapacitacion = activos.filter((e: any) => {
      const r = asistenciasPor.get(Number(e.id));
      return !r?.capacitacion || r.capacitacion < hace2Anios;
    });
    push(
      'capacitacion',
      'Capacitación en prevención de riesgos (curso ≥8 h, cada ≤2 años)',
      'art. 16',
      n === 0 ? 'info' : sinCapacitacion.length === 0 ? 'ok' : sinCapacitacion.length === n ? 'falta' : 'alerta',
      n === 0
        ? 'Sin trabajadores activos registrados.'
        : sinCapacitacion.length === 0
        ? `Los ${n} trabajadores activos tienen capacitación vigente.`
        : `${sinCapacitacion.length} de ${n} trabajadores sin capacitación vigente: ${sinCapacitacion.slice(0, 8).map(nombreDe).join(', ')}${sinCapacitacion.length > 8 ? '…' : ''}.`,
    );

    const sinOdi = activos.filter((e: any) => !asistenciasPor.get(Number(e.id))?.odi);
    push(
      'odi',
      'Información de los riesgos laborales (ODI) previo al inicio de labores',
      'art. 15',
      n === 0 ? 'info' : sinOdi.length === 0 ? 'ok' : sinOdi.length === n ? 'falta' : 'alerta',
      n === 0
        ? 'Sin trabajadores activos registrados.'
        : sinOdi.length === 0
        ? `Los ${n} trabajadores activos tienen su ODI registrada.`
        : `${sinOdi.length} de ${n} trabajadores sin ODI registrada: ${sinOdi.slice(0, 8).map(nombreDe).join(', ')}${sinOdi.length > 8 ? '…' : ''}.`,
    );

    const conEpp = activos.filter((e: any) => asistenciasPor.get(Number(e.id))?.epp).length;
    push('epp', 'Entrega y capacitación en elementos de protección personal', 'art. 13', 'info',
      n === 0
        ? 'Sin trabajadores activos registrados.'
        : `${conEpp} de ${n} trabajadores con entrega de EPP registrada (aplica a los cargos que lo requieren; capacitación mínima de 1 h con refuerzo anual).`);

    // ── Estructura preventiva según dotación ────────────────────────────────
    if (n > 100) {
      push('estructura', 'Departamento de Prevención de Riesgos', 'art. 50', 'alerta',
        `Con ${n} trabajadores corresponde contar con un Departamento de Prevención dirigido por un experto. Registra aquí su constitución y registros semanales.`);
    }
    if (n > 25) {
      const comite = vigente('acta_comite');
      push('comite', 'Comité Paritario de Higiene y Seguridad', 'arts. 23–49', comite ? 'ok' : 'falta',
        comite
          ? 'Acta de constitución registrada. Recuerda las reuniones ordinarias mensuales y el registro del acta en el sitio de la DT (art. 36).'
          : `Con ${n} trabajadores (>25) debe funcionar un Comité Paritario. Falta registrar su acta de constitución.`);
    } else if (n >= 10) {
      const delegado = vigente('acta_delegado');
      push('delegado', 'Delegado de Seguridad y Salud en el Trabajo', 'art. 66', delegado ? 'ok' : 'falta',
        delegado
          ? 'Acta de elección registrada (mandato de hasta 2 años).'
          : `Con ${n} trabajadores (entre 10 y 25, sin Comité Paritario) debe elegirse un Delegado SST en asamblea, levantando acta de la elección.`);
    } else {
      push('estructura', 'Estructura preventiva', 'arts. 64–66', 'info',
        `Con ${n} trabajadores activos no se exige Comité Paritario ni Delegado SST. Aplica el régimen simplificado del art. 64, con la asistencia técnica del organismo administrador (mutual).`);
    }

    // ── Incidentes y accidentes ─────────────────────────────────────────────
    const abiertos = (incidentes || []).filter((i: any) => i.estado === 'abierto');
    push('investigacion', 'Investigación de incidentes y accidentes', 'art. 71', abiertos.length ? 'alerta' : 'ok',
      abiertos.length
        ? `${abiertos.length} evento(s) sin investigación cerrada. Todo accidente, incidente peligroso o enfermedad profesional debe investigarse (causas y medidas correctivas).`
        : 'Sin eventos pendientes de investigación.');

    const denunciables = (incidentes || []).filter(
      (i: any) => i.tipo !== 'incidente_peligroso' && !i.denunciado_oa,
    );
    if (denunciables.length) {
      push('diat', 'Denuncia al organismo administrador (DIAT/DIEP)', 'art. 4 Nº8', 'alerta',
        `${denunciables.length} accidente(s) o enfermedad(es) sin DIAT/DIEP registrada. Los accidentes del trabajo y enfermedades profesionales se denuncian al organismo administrador de la ley 16.744.`);
    }

    // ── KPIs ────────────────────────────────────────────────────────────────
    const anio = hoy.slice(0, 4);
    const delAnio = (incidentes || []).filter((i: any) => String(i.fecha_hora || '').slice(0, 4) === anio);
    const accidentesAnio = delAnio.filter((i: any) => i.tipo === 'accidente_trabajo').length;
    const diasPerdidosAnio = delAnio.reduce((s: number, i: any) => s + num(i.dias_perdidos), 0);
    // Tasa anual de accidentabilidad (art. 75): accidentados por cada 100
    // personas trabajadoras en el año calendario.
    const tasa = n > 0 ? Math.round((accidentesAnio / n) * 1000) / 10 : null;

    return {
      trabajadores_activos: n,
      kpis: {
        accidentes_anio: accidentesAnio,
        incidentes_anio: delAnio.length,
        dias_perdidos_anio: diasPerdidosAnio,
        tasa_accidentabilidad: tasa,
        capacitaciones_anio: (actividades || []).filter(
          (a: any) => a.tipo === 'capacitacion' && String(a.fecha || '').slice(0, 4) === anio,
        ).length,
        checks_ok: checks.filter((c) => c.estado === 'ok').length,
        checks_total: checks.filter((c) => c.estado !== 'info').length,
      },
      checks,
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
