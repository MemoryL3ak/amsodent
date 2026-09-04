import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { google } from 'googleapis';

export interface CrearEventoMeet {
  titulo: string;
  descripcion?: string;
  fecha: string;            // YYYY-MM-DD
  horaInicio?: string | null; // HH:mm
  horaFin?: string | null;    // HH:mm
  invitados?: string[];     // correos de participantes
  zona?: string;            // tz IANA, por defecto America/Santiago
}

// Crea eventos en Google Calendar (con enlace de Google Meet) reutilizando las
// credenciales OAuth de la cuenta conectada en "Mi Correo". El refresh_token se
// obtiene de la tabla correo_cuentas; el scope calendar.events se concede al
// (re)conectar la cuenta de Google.
@Injectable()
export class CalendarApiService {
  private logger = new Logger('CalendarApi');

  configurado(): boolean {
    return Boolean(
      (process.env.GOOGLE_CLIENT_ID || '').trim() &&
        (process.env.GOOGLE_CLIENT_SECRET || '').trim() &&
        (process.env.GOOGLE_OAUTH_REDIRECT_URI || '').trim(),
    );
  }

  private oauth2Client() {
    const id = (process.env.GOOGLE_CLIENT_ID || '').trim();
    const secret = (process.env.GOOGLE_CLIENT_SECRET || '').trim();
    const redirect = (process.env.GOOGLE_OAUTH_REDIRECT_URI || '').trim();
    if (!id || !secret || !redirect) {
      throw new BadRequestException('La conexión con Google no está configurada en el servidor.');
    }
    return new google.auth.OAuth2(id, secret, redirect);
  }

  private sumarHora(hhmm: string): string {
    const [h, m] = hhmm.split(':').map((x) => Number(x));
    const total = ((h || 0) + 1) * 60 + (m || 0);
    const hh = Math.floor((total / 60) % 24);
    const mm = total % 60;
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  }

  async crearEventoMeet(
    refreshToken: string,
    datos: CrearEventoMeet,
  ): Promise<{ meetUrl: string | null; eventId: string | null; htmlLink: string | null }> {
    if (!refreshToken) throw new BadRequestException('La cuenta de Google no está conectada.');
    const cliente = this.oauth2Client();
    cliente.setCredentials({ refresh_token: refreshToken });
    const calendar = google.calendar({ version: 'v3', auth: cliente });

    const tz = datos.zona || 'America/Santiago';
    // Para garantizar el enlace de Meet usamos un evento con horario (no de día
    // completo). Si no se indicó hora, usamos 09:00–10:00.
    const hi = (datos.horaInicio || '').slice(0, 5) || '09:00';
    const hf = (datos.horaFin || '').slice(0, 5) || this.sumarHora(hi);

    const invitados = Array.from(
      new Set((datos.invitados || []).map((e) => String(e || '').trim().toLowerCase()).filter(Boolean)),
    );

    let res;
    try {
      res = await calendar.events.insert({
        calendarId: 'primary',
        conferenceDataVersion: 1,
        sendUpdates: 'all',
        requestBody: {
          summary: datos.titulo,
          description: datos.descripcion || undefined,
          start: { dateTime: `${datos.fecha}T${hi}:00`, timeZone: tz },
          end: { dateTime: `${datos.fecha}T${hf}:00`, timeZone: tz },
          attendees: invitados.map((email) => ({ email })),
          conferenceData: {
            createRequest: {
              requestId: randomUUID(),
              conferenceSolutionKey: { type: 'hangoutsMeet' },
            },
          },
          // Marca privada: identifica los eventos creados por el sistema para
          // que la importación Calendar→bitácora no los vuelva a traer (loop).
          extendedProperties: { private: { amsodent: 'actividad' } },
        },
      });
    } catch (err: any) {
      // Surface the real Google reason so el aviso al usuario sea accionable.
      const apiErr = err?.response?.data?.error;
      const detalle =
        (typeof apiErr === 'object' ? apiErr?.message : apiErr) || err?.message || '';
      const reason = apiErr?.errors?.[0]?.reason || '';
      const txt = `${reason} ${detalle}`.toLowerCase();
      this.logger.error(
        `Error creando evento Meet: status=${err?.response?.status || err?.code || '?'} reason=${reason} msg=${detalle}`,
      );
      if (txt.includes('accessnotconfigured') || txt.includes('has not been used') || txt.includes('disabled')) {
        throw new BadRequestException(
          'La Google Calendar API no está habilitada en el proyecto de Google Cloud. Habilítala en console.cloud.google.com.',
        );
      }
      // Refresh token expirado o revocado: la cuenta debe reconectarse.
      if (txt.includes('invalid_grant') || txt.includes('token has been expired') || txt.includes('token has been revoked')) {
        throw new BadRequestException(
          'La conexión con Google expiró o fue revocada. Reconéctala en «Mi Correo» (Continuar con Google) y acepta el permiso de Calendar.',
        );
      }
      if (
        txt.includes('insufficient') ||
        txt.includes('insufficientpermissions') ||
        txt.includes('scope') ||
        err?.response?.status === 403
      ) {
        throw new BadRequestException(
          'Tu cuenta de Google no autorizó el calendario. Reconéctala en «Mi Correo» (Continuar con Google) y acepta el permiso de Calendar.',
        );
      }
      throw new BadRequestException(`No se pudo crear el evento de Google Meet: ${detalle || 'error desconocido'}`);
    }

    const data = res.data || {};
    const meetUrl =
      data.hangoutLink ||
      data.conferenceData?.entryPoints?.find((p) => p.entryPointType === 'video')?.uri ||
      null;
    this.logger.log(`Evento Meet creado (${data.id || 'sin id'}) → ${meetUrl || 'sin enlace'}`);
    return { meetUrl, eventId: data.id || null, htmlLink: data.htmlLink || null };
  }

  /* ── Sincronización bitácora ↔ Calendar (pedido 2026-09-04) ────────────── */

  // Evento SIMPLE (sin Meet) que espeja cualquier actividad de la bitácora en
  // el calendario del usuario. Best-effort: los que llaman capturan el error.
  async crearEventoSimple(
    refreshToken: string,
    datos: CrearEventoMeet & { todoElDia?: boolean },
  ): Promise<{ eventId: string | null; htmlLink: string | null }> {
    if (!refreshToken) throw new BadRequestException('La cuenta de Google no está conectada.');
    const cliente = this.oauth2Client();
    cliente.setCredentials({ refresh_token: refreshToken });
    const calendar = google.calendar({ version: 'v3', auth: cliente });
    const tz = datos.zona || 'America/Santiago';
    let start: any;
    let end: any;
    if (datos.todoElDia || !datos.horaInicio) {
      // Todo el día: en Calendar `end.date` es EXCLUSIVO → día siguiente.
      const fin = new Date(`${datos.fecha}T00:00:00Z`);
      fin.setUTCDate(fin.getUTCDate() + 1);
      start = { date: datos.fecha };
      end = { date: fin.toISOString().slice(0, 10) };
    } else {
      const hi = datos.horaInicio.slice(0, 5);
      const hf = (datos.horaFin || '').slice(0, 5) || this.sumarHora(hi);
      start = { dateTime: `${datos.fecha}T${hi}:00`, timeZone: tz };
      end = { dateTime: `${datos.fecha}T${hf}:00`, timeZone: tz };
    }
    const invitados = Array.from(
      new Set((datos.invitados || []).map((e) => String(e || '').trim().toLowerCase()).filter(Boolean)),
    );
    const res = await calendar.events.insert({
      calendarId: 'primary',
      sendUpdates: invitados.length ? 'all' : 'none',
      requestBody: {
        summary: datos.titulo,
        description: datos.descripcion || undefined,
        start,
        end,
        attendees: invitados.map((email) => ({ email })),
        extendedProperties: { private: { amsodent: 'actividad' } },
      },
    });
    return { eventId: res.data?.id || null, htmlLink: res.data?.htmlLink || null };
  }

  // Actualiza el evento espejo cuando se edita la actividad (best-effort).
  async actualizarEvento(
    refreshToken: string,
    eventId: string,
    datos: CrearEventoMeet & { todoElDia?: boolean },
  ): Promise<void> {
    if (!refreshToken || !eventId) return;
    const cliente = this.oauth2Client();
    cliente.setCredentials({ refresh_token: refreshToken });
    const calendar = google.calendar({ version: 'v3', auth: cliente });
    const tz = datos.zona || 'America/Santiago';
    let start: any;
    let end: any;
    if (datos.todoElDia || !datos.horaInicio) {
      const fin = new Date(`${datos.fecha}T00:00:00Z`);
      fin.setUTCDate(fin.getUTCDate() + 1);
      start = { date: datos.fecha };
      end = { date: fin.toISOString().slice(0, 10) };
    } else {
      const hi = datos.horaInicio.slice(0, 5);
      const hf = (datos.horaFin || '').slice(0, 5) || this.sumarHora(hi);
      start = { dateTime: `${datos.fecha}T${hi}:00`, timeZone: tz };
      end = { dateTime: `${datos.fecha}T${hf}:00`, timeZone: tz };
    }
    await calendar.events.patch({
      calendarId: 'primary',
      eventId,
      sendUpdates: 'none',
      requestBody: {
        summary: datos.titulo,
        description: datos.descripcion || undefined,
        start,
        end,
      },
    });
  }

  // Borra el evento espejo al eliminar la actividad (best-effort; un evento ya
  // borrado en Google no es error).
  async eliminarEvento(refreshToken: string, eventId: string): Promise<void> {
    if (!refreshToken || !eventId) return;
    const cliente = this.oauth2Client();
    cliente.setCredentials({ refresh_token: refreshToken });
    const calendar = google.calendar({ version: 'v3', auth: cliente });
    try {
      await calendar.events.delete({ calendarId: 'primary', eventId, sendUpdates: 'none' });
    } catch (e: any) {
      const status = e?.response?.status || e?.code;
      if (status !== 404 && status !== 410) throw e;
    }
  }

  // Lista los eventos del calendario principal en una ventana, para la
  // importación Calendar → bitácora (instancias individuales, no recurrencias).
  async listarEventos(refreshToken: string, timeMinISO: string, timeMaxISO: string): Promise<any[]> {
    if (!refreshToken) return [];
    const cliente = this.oauth2Client();
    cliente.setCredentials({ refresh_token: refreshToken });
    const calendar = google.calendar({ version: 'v3', auth: cliente });
    const res = await calendar.events.list({
      calendarId: 'primary',
      timeMin: timeMinISO,
      timeMax: timeMaxISO,
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: 250,
    });
    return res.data?.items || [];
  }
}
