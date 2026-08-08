import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { MonitorService, sanitizarContexto } from './monitor.service';

// Filtro global catch-all: registra toda excepción (incluidas las lanzadas
// por guards, que no pasan por el interceptor) y responde con el MISMO shape
// que Nest usa por defecto. En 5xx agrega `requestId` a la respuesta y guarda
// el contexto (query/body sanitizados) para poder reproducir el error.
@Catch()
export class MonitorExceptionsFilter implements ExceptionFilter {
  constructor(private monitor: MonitorService) {}

  catch(exception: any, host: ArgumentsHost) {
    if (host.getType() !== 'http') throw exception;

    const ctx = host.switchToHttp();
    const res = ctx.getResponse();
    const req = ctx.getRequest();

    const esHttp = exception instanceof HttpException;
    const status = esHttp
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;
    const traceId: string | undefined = req._traceId;

    const ruta: string = (req.originalUrl || req.url || '').split('?')[0];
    if (!ruta.startsWith('/api/monitor')) {
      const metadata: Record<string, any> = {};
      const query = sanitizarContexto(req.query, 500);
      if (query) metadata.query = query;
      // El body solo en errores de servidor: en 4xx (validaciones) es ruido.
      if (status >= 500) {
        const body = sanitizarContexto(req.body, 1_500);
        if (body) metadata.body = body;
      }

      // 4xx = warn (errores esperables: validación, auth); 5xx = error real.
      this.monitor.registrar({
        nivel: status >= 500 ? 'error' : 'warn',
        tipo: 'excepcion',
        metodo: req.method,
        ruta,
        status,
        duracion_ms: req._monitorInicio ? Date.now() - req._monitorInicio : undefined,
        mensaje: exception?.message || 'Error desconocido',
        stack: status >= 500 ? exception?.stack : undefined,
        trace_id: traceId,
        usuario_id: req.user?.id,
        usuario_email: req.user?.email,
        ip: req.ip,
        user_agent: req.headers?.['user-agent'],
        metadata: Object.keys(metadata).length ? metadata : undefined,
      });
    }

    if (status >= 500) {
      console.error('[MonitorExceptionsFilter]', traceId || '', exception);
    }

    // Réplica del comportamiento default de Nest; en 5xx sumamos requestId
    // para que el usuario pueda reportar el código exacto del error.
    let body: any = esHttp
      ? exception.getResponse()
      : { statusCode: status, message: 'Internal server error' };
    if (typeof body === 'string') body = { statusCode: status, message: body };
    if (status >= 500 && traceId && body && typeof body === 'object' && !Array.isArray(body)) {
      body = { ...body, requestId: traceId };
    }
    res.status(status).json(body);
  }
}
