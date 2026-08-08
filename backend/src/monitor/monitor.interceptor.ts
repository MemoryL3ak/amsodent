import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Observable, tap } from 'rxjs';
import { MonitorService } from './monitor.service';

// Registra TODA request HTTP que llega al controlador: método, ruta, status,
// latencia, usuario y un trace ID único (devuelto en el header X-Request-Id,
// para correlacionar "me salió un error" con su fila exacta del monitoreo).
// Los errores los registra el MonitorExceptionsFilter (que además ve los
// lanzados por guards, que nunca pasan por aquí).
@Injectable()
export class MonitorInterceptor implements NestInterceptor {
  constructor(private monitor: MonitorService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    if (context.getType() !== 'http') return next.handle();

    const req = context.switchToHttp().getRequest();
    const res = context.switchToHttp().getResponse();
    const inicio = Date.now();
    // El filtro de excepciones los usa para duración y correlación.
    req._monitorInicio = inicio;
    const traceId = randomUUID();
    req._traceId = traceId;
    try {
      res.setHeader('X-Request-Id', traceId);
    } catch {
      /* headers ya enviados */
    }

    const ruta: string = req.originalUrl || req.url || '';
    // Evitar ruido/recursión: no registramos el propio panel de monitoreo
    // ni preflights CORS.
    if (req.method === 'OPTIONS' || ruta.startsWith('/api/monitor')) {
      return next.handle();
    }

    return next.handle().pipe(
      tap(() => {
        this.monitor.registrar({
          nivel: 'info',
          tipo: 'http',
          metodo: req.method,
          ruta: ruta.split('?')[0],
          status: res?.statusCode ?? 200,
          duracion_ms: Date.now() - inicio,
          trace_id: traceId,
          usuario_id: req.user?.id,
          usuario_email: req.user?.email,
          ip: req.ip,
          user_agent: req.headers?.['user-agent'],
        });
      }),
    );
  }
}
