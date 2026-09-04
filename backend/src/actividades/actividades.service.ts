import { Injectable, BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { SupabaseService } from '../supabase/supabase.service';
import { CalendarApiService } from './calendar-api.service';

type Usuario = { id?: string; email?: string };

// Columnas opcionales que pueden no estar migradas todavía: si el insert/update
// falla mencionándolas, se quitan del payload y se reintenta.
const COLUMNAS_OPCIONALES = ['adjuntos', 'motivo', 'licitacion_id', 'grupo_id', 'participantes', 'meet_url', 'evento_google_id'];

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
  constructor(
    private supabase: SupabaseService,
    private calendar: CalendarApiService,
  ) {}

  // Cuenta de Google conectada del usuario (módulo Mi Correo): token + scopes.
  private async cuentaGoogle(userId?: string): Promise<{ refreshToken: string; scopes: string } | null> {
    if (!userId) return null;
    try {
      const { data } = await this.supabase
        .getClient()
        .from('correo_cuentas')
        .select('refresh_token, scopes')
        .eq('user_id', userId)
        .maybeSingle();
      if (!data?.refresh_token) return null;
      return { refreshToken: String(data.refresh_token), scopes: String(data.scopes || '') };
    } catch {
      return null;
    }
  }

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

  // Roles que ven las actividades de TODOS los usuarios (vista global) y pueden
  // filtrar por usuario: admin y jefe de ventas.
  private puedeVerTodas(rol: string): boolean {
    return this.esAdmin(rol) || rol === 'jefe_ventas';
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

    // Visibilidad: admin y jefe de ventas ven todo (y filtran por usuario); el
    // resto solo ve sus propias actividades.
    if (this.puedeVerTodas(rol)) {
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

  // Inserta filas tolerando columnas opcionales aún no migradas.
  private async insertarFilas(filas: any[]) {
    const intentar = (rows: any[]) =>
      this.supabase.getClient().from('actividades_cliente').insert(rows).select();
    let { data, error } = await intentar(filas);
    if (error) {
      const msg = [error.message, (error as any).details, (error as any).hint]
        .filter(Boolean).join(' ').toLowerCase();
      const aQuitar = COLUMNAS_OPCIONALES.filter((c) => msg.includes(c));
      if (aQuitar.length) {
        const limpias = filas.map((f) => {
          const g = { ...f };
          aQuitar.forEach((c) => delete g[c]);
          return g;
        });
        ({ data, error } = await intentar(limpias));
      }
    }
    if (error) throw new BadRequestException(error.message);
    return data || [];
  }

  // Actualiza tolerando columnas opcionales. `aplicarFiltro` añade el .eq()/.neq().
  private async actualizarConTolerancia(
    patch: Record<string, any>,
    aplicarFiltro: (q: any) => any,
  ) {
    const intentar = (p: Record<string, any>) =>
      aplicarFiltro(this.supabase.getClient().from('actividades_cliente').update(p)).select();
    let { data, error } = await intentar(patch);
    if (error) {
      const msg = [error.message, (error as any).details, (error as any).hint]
        .filter(Boolean).join(' ').toLowerCase();
      const aQuitar = COLUMNAS_OPCIONALES.filter((c) => msg.includes(c));
      if (aQuitar.length) {
        const limpio = { ...patch };
        aQuitar.forEach((c) => delete limpio[c]);
        ({ data, error } = await intentar(limpio));
      }
    }
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
    const tipo = (body.tipo || 'gestion').trim();
    // Campos compartidos de la actividad (sin user_*).
    const base: Record<string, any> = {
      cliente_id: body.cliente_id != null ? body.cliente_id : null,
      cliente_nombre: (body.cliente_nombre || '').trim() || null,
      titulo: String(body.titulo).trim(),
      tipo,
      motivo: (body.motivo || '').trim() || null,
      licitacion_id: body.licitacion_id != null ? body.licitacion_id : null,
      comentario: (body.comentario || '').trim() || null,
      fecha: body.fecha,
      hora_inicio: body.todo_el_dia ? null : body.hora_inicio || null,
      hora_fin: body.todo_el_dia ? null : body.hora_fin || null,
      todo_el_dia: Boolean(body.todo_el_dia),
      estado: (body.estado || 'pendiente').trim(),
      adjuntos: Array.isArray(body.adjuntos) ? body.adjuntos : [],
    };

    // Actividades automáticas (correos de cobranza, gestiones desde otros
    // módulos) llegan sin cliente_id: se intenta amarrarlas al cliente por el
    // RUT de la cotización o por el nombre, para que aparezcan en la ficha
    // 360° del cliente y en el filtro por cliente de la bitácora. Best-effort:
    // si no calza nada, la actividad se guarda igual (pedido 2026-09-04).
    if (base.cliente_id == null && (base.licitacion_id != null || base.cliente_nombre)) {
      try {
        const client = this.supabase.getClient();
        const normRut = (v: any) => String(v || '').toLowerCase().replace(/[.\-\s]/g, '');
        let rut = '';
        let nombreCli = String(base.cliente_nombre || '').trim();
        if (base.licitacion_id != null) {
          const { data: lic } = await client
            .from('licitaciones')
            .select('rut_entidad, nombre_entidad')
            .eq('id', base.licitacion_id)
            .maybeSingle();
          rut = normRut(lic?.rut_entidad);
          if (!nombreCli) nombreCli = String(lic?.nombre_entidad || '').trim();
        }
        let clienteId: string | null = null;
        if (rut) {
          const { data: porRut } = await client.from('clientes').select('id, rut').not('rut', 'is', null).limit(5000);
          clienteId = (porRut || []).find((c: any) => normRut(c.rut) === rut)?.id || null;
        }
        if (!clienteId && nombreCli) {
          const { data: porNombre } = await client
            .from('clientes')
            .select('id')
            .ilike('nombre', nombreCli)
            .limit(2);
          if ((porNombre || []).length === 1) clienteId = porNombre![0].id;
        }
        if (clienteId) {
          base.cliente_id = clienteId;
          if (!base.cliente_nombre && nombreCli) base.cliente_nombre = nombreCli;
        }
      } catch { /* best-effort: sin cliente resuelto se guarda igual */ }
    }

    // Reunión con participantes → se replica la actividad para cada uno.
    const participantes = Array.isArray(body.participantes)
      ? body.participantes.filter((p: any) => p && p.email)
      : [];

    // Google Meet: crea un evento en el calendario de la cuenta conectada.
    let meetError: string | null = null;
    if (tipo === 'reunion' && body.crear_meet) {
      const cuenta = await this.cuentaGoogle(user.id);
      if (!cuenta) {
        meetError = 'No se generó el Meet: conecta tu cuenta de Google en «Mi Correo».';
      } else if (cuenta.scopes && !cuenta.scopes.toLowerCase().includes('calendar')) {
        // El token guardado no incluye el permiso de calendario → reconectar.
        meetError = 'No se generó el Meet: reconecta tu cuenta de Google en «Mi Correo» y acepta el permiso de Calendar.';
      } else {
        try {
          const ev = await this.calendar.crearEventoMeet(cuenta.refreshToken, {
            titulo: base.titulo,
            descripcion: base.comentario || undefined,
            fecha: base.fecha,
            horaInicio: body.hora_inicio || null,
            horaFin: body.hora_fin || null,
            invitados: participantes.map((p: any) => p.email),
          });
          base.meet_url = ev.meetUrl;
          base.evento_google_id = ev.eventId;
        } catch (e: any) {
          // Mensaje específico que arma CalendarApiService (API deshabilitada,
          // permisos insuficientes, etc.).
          meetError = `No se generó el Meet: ${e?.message || 'error desconocido'}`;
        }
      }
    }

    // Espejo en Google Calendar (pedido 2026-09-04): TODA actividad con fecha
    // se refleja como evento simple en el calendario de la cuenta conectada
    // (las reuniones con Meet ya crearon el suyo arriba). Best-effort: si la
    // cuenta no está conectada o Google falla, la actividad se guarda igual.
    if (!base.evento_google_id && base.fecha) {
      try {
        const cuenta = await this.cuentaGoogle(user.id);
        if (cuenta && (!cuenta.scopes || cuenta.scopes.toLowerCase().includes('calendar'))) {
          const ev = await this.calendar.crearEventoSimple(cuenta.refreshToken, {
            titulo: base.titulo,
            descripcion: [base.comentario, `Actividad Amsodent · ${tipo}`].filter(Boolean).join('\n'),
            fecha: base.fecha,
            horaInicio: base.hora_inicio,
            horaFin: base.hora_fin,
            todoElDia: Boolean(base.todo_el_dia),
            invitados: participantes.map((p: any) => p.email),
          });
          base.evento_google_id = ev.eventId;
        }
      } catch (e: any) {
        // El espejo nunca bloquea la bitácora.
      }
    }

    if (tipo === 'reunion' && participantes.length) {
      const grupo_id = randomUUID();
      const todos = [{ email, nombre: nombre || email }, ...participantes];
      // Solo el creador y los participantes INTERNOS tienen fila en la bitácora.
      // Los externos quedan como asistentes (jsonb) y reciben la invitación al
      // Meet, pero no se les crea una actividad (no tienen cuenta).
      const sujetos = [
        { email, nombre: nombre || email },
        ...participantes.filter((p: any) => !p.externo),
      ];
      const vistos = new Set<string>();
      const filas: any[] = [];
      for (const p of sujetos) {
        const e = String(p.email || '').toLowerCase();
        if (!e || vistos.has(e)) continue;
        vistos.add(e);
        filas.push({
          ...base,
          grupo_id,
          participantes: todos,
          user_email: e,
          user_nombre: p.nombre || e,
        });
      }
      const data = await this.insertarFilas(filas);
      const propia = data.find((r: any) => String(r.user_email || '').toLowerCase() === email) || data[0];
      return { ...propia, _meet_error: meetError, _meet_generado: Boolean(base.meet_url) };
    }

    const fila = { ...base, user_email: email, user_nombre: nombre || email };
    const data = await this.insertarFilas([fila]);
    return { ...data[0], _meet_error: meetError, _meet_generado: Boolean(base.meet_url) };
  }

  private async verificarPropiedad(user: Usuario, id: number) {
    const { data, error } = await this.supabase
      .getClient()
      .from('actividades_cliente')
      .select('*')
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
    const fila = await this.verificarPropiedad(user, id);

    // Patch de la fila objetivo (incluye estado).
    const patch: Record<string, any> = { updated_at: new Date().toISOString() };
    // Campos compartidos (se propagan al grupo de la reunión).
    const compartidos: Record<string, any> = {};
    const setCompartido = (k: string, v: any) => { patch[k] = v; compartidos[k] = v; };

    if (body.cliente_id !== undefined) setCompartido('cliente_id', body.cliente_id != null ? body.cliente_id : null);
    if (body.cliente_nombre !== undefined) setCompartido('cliente_nombre', (body.cliente_nombre || '').trim() || null);
    if (body.titulo !== undefined) setCompartido('titulo', String(body.titulo).trim());
    if (body.tipo !== undefined) setCompartido('tipo', (body.tipo || 'gestion').trim());
    if (body.motivo !== undefined) setCompartido('motivo', (body.motivo || '').trim() || null);
    if (body.licitacion_id !== undefined) setCompartido('licitacion_id', body.licitacion_id != null ? body.licitacion_id : null);
    if (body.comentario !== undefined) setCompartido('comentario', (body.comentario || '').trim() || null);
    if (body.fecha !== undefined) setCompartido('fecha', body.fecha);
    if (body.todo_el_dia !== undefined) setCompartido('todo_el_dia', Boolean(body.todo_el_dia));
    if (body.hora_inicio !== undefined) setCompartido('hora_inicio', body.todo_el_dia ? null : body.hora_inicio || null);
    if (body.hora_fin !== undefined) setCompartido('hora_fin', body.todo_el_dia ? null : body.hora_fin || null);
    if (body.adjuntos !== undefined) setCompartido('adjuntos', Array.isArray(body.adjuntos) ? body.adjuntos : []);
    // estado: solo en la fila propia (cada participante lleva el suyo).
    if (body.estado !== undefined) patch.estado = (body.estado || 'pendiente').trim();
    // participantes se reconcilia aparte (crea/borra filas), no como campo simple.

    // Generar enlace de Meet al editar una reunión que aún no lo tiene (p. ej.
    // porque la creación del Meet falló por token de Google expirado). Se crea
    // el evento y se propaga meet_url/evento_google_id a todo el grupo.
    let meetError: string | null = null;
    let meetGenerado = false;
    const tipoActual = (body.tipo ?? fila.tipo ?? '').toString().trim();
    if (body.crear_meet && tipoActual === 'reunion' && !fila.meet_url) {
      const cuenta = await this.cuentaGoogle(user.id);
      if (!cuenta) {
        meetError = 'No se generó el Meet: conecta tu cuenta de Google en «Mi Correo».';
      } else if (cuenta.scopes && !cuenta.scopes.toLowerCase().includes('calendar')) {
        meetError = 'No se generó el Meet: reconecta tu cuenta de Google en «Mi Correo» y acepta el permiso de Calendar.';
      } else {
        try {
          const invitadosBody = Array.isArray(body.participantes)
            ? body.participantes.map((p: any) => p?.email).filter(Boolean)
            : Array.isArray(fila.participantes)
            ? fila.participantes.map((p: any) => p?.email).filter(Boolean)
            : [];
          const ev = await this.calendar.crearEventoMeet(cuenta.refreshToken, {
            titulo: (body.titulo ?? fila.titulo) || 'Reunión',
            descripcion: (body.comentario ?? fila.comentario) || undefined,
            fecha: body.fecha ?? fila.fecha,
            horaInicio: (body.hora_inicio ?? fila.hora_inicio) || null,
            horaFin: (body.hora_fin ?? fila.hora_fin) || null,
            invitados: invitadosBody,
          });
          setCompartido('meet_url', ev.meetUrl);
          setCompartido('evento_google_id', ev.eventId);
          meetGenerado = Boolean(ev.meetUrl);
        } catch (e: any) {
          meetError = `No se generó el Meet: ${e?.message || 'error desconocido'}`;
        }
      }
    }

    const data = await this.actualizarConTolerancia(patch, (q) => q.eq('id', id));

    // Espejo en Calendar: si la actividad tiene evento asociado y cambió algo
    // visible (título, fecha, horario o comentario), se actualiza el evento.
    // Best-effort con la cuenta del usuario que edita.
    const cambioVisible = ['titulo', 'fecha', 'hora_inicio', 'hora_fin', 'todo_el_dia', 'comentario']
      .some((k) => compartidos[k] !== undefined);
    if (fila.evento_google_id && cambioVisible) {
      try {
        const cuenta = await this.cuentaGoogle(user.id);
        if (cuenta) {
          const nuevo = { ...fila, ...compartidos };
          await this.calendar.actualizarEvento(cuenta.refreshToken, fila.evento_google_id, {
            titulo: nuevo.titulo,
            descripcion: [nuevo.comentario, `Actividad Amsodent · ${nuevo.tipo || ''}`].filter(Boolean).join('\n'),
            fecha: nuevo.fecha,
            horaInicio: nuevo.hora_inicio,
            horaFin: nuevo.hora_fin,
            todoElDia: Boolean(nuevo.todo_el_dia),
          });
        }
      } catch { /* el espejo nunca bloquea la edición */ }
    }

    // Reunión grupal: propagar los campos compartidos al resto del grupo.
    if (fila.grupo_id && Object.keys(compartidos).length > 0) {
      const patchGrupo = { ...compartidos, updated_at: new Date().toISOString() };
      await this.actualizarConTolerancia(patchGrupo, (q) => q.eq('grupo_id', fila.grupo_id).neq('id', id));
    }

    // Reconciliar participantes de la reunión: crear filas para los nuevos
    // (copiando los datos compartidos y el enlace de Meet) y borrar las de
    // quienes se quitaron, para que la URL del Meet le aparezca a todos.
    if (body.participantes !== undefined) {
      await this.reconciliarParticipantes(user, id, fila.grupo_id || null, body);
    }
    return { ...data[0], _meet_error: meetError, _meet_generado: meetGenerado };
  }

  // Sincroniza las filas de una reunión grupal con la lista de participantes
  // enviada desde la plataforma. La fila editada (id) es la del usuario actual.
  private async reconciliarParticipantes(
    user: Usuario,
    id: number,
    grupoIdActual: string | null,
    body: any,
  ) {
    const client = this.supabase.getClient();
    const selfEmail = (user?.email || '').toLowerCase();
    const { nombre: selfNombre } = await this.datosPerfil(user);

    // Lista objetivo = usuario actual + participantes enviados (sin duplicar).
    const objetivo = new Map<string, string>();
    objetivo.set(selfEmail, selfNombre || selfEmail);
    const recibidos = Array.isArray(body.participantes) ? body.participantes : [];
    // Correos externos: van al jsonb de asistentes y a la invitación del Meet,
    // pero NO se les crea fila de bitácora (no tienen cuenta).
    const externosSet = new Set<string>(
      recibidos
        .filter((p: any) => p?.externo)
        .map((p: any) => String(p?.email || '').toLowerCase()),
    );
    for (const p of recibidos) {
      const e = String(p?.email || '').toLowerCase();
      if (e) objetivo.set(e, p?.nombre || e);
    }

    // Si no queda nadie más que el propio usuario y la actividad no es grupal,
    // no hay nada que reconciliar (sigue siendo una actividad individual).
    if (objetivo.size <= 1 && !grupoIdActual) return;

    // Traer las filas actuales (grupo completo o la fila individual).
    const sel = grupoIdActual
      ? client.from('actividades_cliente').select('*').eq('grupo_id', grupoIdActual)
      : client.from('actividades_cliente').select('*').eq('id', id);
    const { data: filasActuales, error: errSel } = await sel;
    if (errSel || !Array.isArray(filasActuales) || filasActuales.length === 0) return;

    // Plantilla con los campos compartidos (incluye meet_url/evento_google_id).
    const plantilla: any = filasActuales.find((f: any) => Number(f.id) === Number(id)) || filasActuales[0];
    const grupoId = grupoIdActual || randomUUID();
    const participantesJson = Array.from(objetivo.entries()).map(([email, nombre]) => ({ email, nombre }));

    const existentes = new Map<string, any>();
    for (const f of filasActuales) existentes.set(String(f.user_email || '').toLowerCase(), f);

    // 1) Crear filas para los participantes nuevos (copiando datos + Meet).
    const nuevas: any[] = [];
    for (const [email, nombre] of objetivo.entries()) {
      if (existentes.has(email) || externosSet.has(email)) continue;
      nuevas.push({
        cliente_id: plantilla.cliente_id ?? null,
        cliente_nombre: plantilla.cliente_nombre ?? null,
        titulo: plantilla.titulo,
        tipo: plantilla.tipo,
        motivo: plantilla.motivo ?? null,
        licitacion_id: plantilla.licitacion_id ?? null,
        comentario: plantilla.comentario ?? null,
        fecha: plantilla.fecha,
        hora_inicio: plantilla.hora_inicio ?? null,
        hora_fin: plantilla.hora_fin ?? null,
        todo_el_dia: Boolean(plantilla.todo_el_dia),
        estado: 'pendiente',
        adjuntos: Array.isArray(plantilla.adjuntos) ? plantilla.adjuntos : [],
        grupo_id: grupoId,
        participantes: participantesJson,
        meet_url: plantilla.meet_url ?? null,
        evento_google_id: plantilla.evento_google_id ?? null,
        user_email: email,
        user_nombre: nombre,
      });
    }
    if (nuevas.length) await this.insertarFilas(nuevas);

    // 2) Borrar filas de quienes ya no son participantes.
    const aBorrar = [...existentes.entries()]
      .filter(([email]) => !objetivo.has(email))
      .map(([, f]) => Number(f.id));
    if (aBorrar.length) {
      await client.from('actividades_cliente').delete().in('id', aBorrar);
    }

    // 3) Actualizar grupo_id + lista de participantes en todas las filas vigentes.
    await this.actualizarConTolerancia(
      { grupo_id: grupoId, participantes: participantesJson },
      (q) => q.eq('grupo_id', grupoId),
    );
    // La fila editada puede no tener grupo_id aún (era individual): asígnalo.
    if (!grupoIdActual) {
      await this.actualizarConTolerancia(
        { grupo_id: grupoId, participantes: participantesJson },
        (q) => q.eq('id', id),
      );
    }
  }

  async eliminar(user: Usuario, id: number) {
    const fila = await this.verificarPropiedad(user, id);
    const client = this.supabase.getClient();

    // Espejo en Calendar: borrar el evento asociado antes de borrar la
    // actividad (best-effort con la cuenta del usuario que elimina).
    if (fila.evento_google_id) {
      try {
        const cuenta = await this.cuentaGoogle(user.id);
        if (cuenta) await this.calendar.eliminarEvento(cuenta.refreshToken, fila.evento_google_id);
      } catch { /* el espejo nunca bloquea la eliminación */ }
    }

    const query = fila.grupo_id
      ? client.from('actividades_cliente').delete().eq('grupo_id', fila.grupo_id)
      : client.from('actividades_cliente').delete().eq('id', id);
    const { error } = await query;
    if (error) throw new BadRequestException(error.message);
    return { deleted: true };
  }

  /* ── Importación Calendar → bitácora (pedido 2026-09-04) ────────────────
     Por cada cuenta de Google conectada en «Mi Correo» con permiso de
     Calendar, trae los eventos del calendario principal (ventana: 3 días
     hacia atrás, 60 hacia adelante) y crea la actividad correspondiente.
     Reglas para no ensuciar la bitácora:
     - Se saltan los eventos creados por el propio sistema (marca privada
       `amsodent` en el evento) y los cancelados.
     - Solo se importan eventos CON AL MENOS OTRO INVITADO (una reunión con
       alguien); los recordatorios personales sin invitados no entran.
     - Dedupe por (evento_google_id, user_email): re-correr no duplica. */
  async importarDesdeCalendar(): Promise<{ cuentas: number; importadas: number; errores: string[] }> {
    const client = this.supabase.getClient();
    const { data: cuentas, error } = await client
      .from('correo_cuentas')
      .select('user_id, email, refresh_token, scopes');
    if (error) throw new BadRequestException(error.message);

    const hoy = new Date().toISOString().slice(0, 10);
    const timeMin = new Date(Date.now() - 3 * 86400000).toISOString();
    const timeMax = new Date(Date.now() + 60 * 86400000).toISOString();
    let importadas = 0;
    const errores: string[] = [];
    let cuentasOk = 0;

    for (const c of cuentas || []) {
      const email = String(c.email || '').trim().toLowerCase();
      const scopes = String(c.scopes || '').toLowerCase();
      if (!c.refresh_token || !email || (scopes && !scopes.includes('calendar'))) continue;
      cuentasOk++;
      try {
        const eventos = await this.calendar.listarEventos(String(c.refresh_token), timeMin, timeMax);
        const candidatos = (eventos || []).filter((ev: any) => {
          if (!ev?.id || ev.status === 'cancelled') return false;
          if (ev.extendedProperties?.private?.amsodent) return false; // creado por el sistema
          const asistentes: any[] = Array.isArray(ev.attendees) ? ev.attendees : [];
          const otros = asistentes.filter((a) => !a?.self && !a?.resource);
          if (!otros.length) return false; // sin otros invitados: evento personal
          return Boolean(ev.start?.dateTime || ev.start?.date);
        });
        if (!candidatos.length) continue;

        const ids = candidatos.map((ev: any) => String(ev.id));
        const { data: existentes } = await client
          .from('actividades_cliente')
          .select('evento_google_id')
          .eq('user_email', email)
          .in('evento_google_id', ids);
        const yaImportados = new Set((existentes || []).map((r: any) => String(r.evento_google_id)));

        let nombre = email;
        try {
          const { data: perfil } = await client.from('profiles').select('nombre').eq('id', c.user_id).maybeSingle();
          if (perfil?.nombre) nombre = String(perfil.nombre).trim();
        } catch { /* nombre best-effort */ }

        const filas: any[] = [];
        for (const ev of candidatos) {
          if (yaImportados.has(String(ev.id))) continue;
          const inicio = ev.start?.dateTime || ev.start?.date;
          const fecha = String(inicio).slice(0, 10);
          const horaDe = (v: any) => {
            const m = /T(\d{2}:\d{2})/.exec(String(v || ''));
            return m ? m[1] : null;
          };
          const asistentes = (Array.isArray(ev.attendees) ? ev.attendees : [])
            .map((a: any) => ({ email: String(a?.email || '').toLowerCase(), nombre: a?.displayName || a?.email || '' }))
            .filter((a: any) => a.email);
          filas.push({
            titulo: String(ev.summary || '(sin título)').slice(0, 200),
            tipo: 'reunion',
            comentario: ['Importada desde Google Calendar', String(ev.description || '').slice(0, 500)].filter(Boolean).join('\n'),
            fecha,
            hora_inicio: horaDe(ev.start?.dateTime),
            hora_fin: horaDe(ev.end?.dateTime),
            todo_el_dia: !ev.start?.dateTime,
            estado: fecha < hoy ? 'realizada' : 'pendiente',
            adjuntos: [],
            participantes: asistentes,
            meet_url: ev.hangoutLink || null,
            evento_google_id: String(ev.id),
            user_email: email,
            user_nombre: nombre,
          });
        }
        if (filas.length) {
          await this.insertarFilas(filas);
          importadas += filas.length;
        }
      } catch (e: any) {
        errores.push(`${email}: ${String(e?.message || e).slice(0, 120)}`);
      }
    }
    return { cuentas: cuentasOk, importadas, errores };
  }

  // Usuarios con actividades (para el filtro del admin).
  async usuarios(user: Usuario) {
    const { rol } = await this.datosPerfil(user);
    if (!this.puedeVerTodas(rol)) return [];
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
