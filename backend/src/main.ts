// Redeploy 2026-09-04: activar aviso de adjudicación MP + integración Bsale.
import * as path from 'path';
import * as dotenv from 'dotenv';

// Cargar el .env de /backend de forma explícita, antes de importar AppModule.
// Defensivo: independiza la carga de credenciales (ANTHROPIC_API_KEY, etc.)
// del cwd con el que se haya invocado el proceso.
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

import { NestFactory } from '@nestjs/core';
import * as dns from 'dns';
import * as net from 'net';
import compression from 'compression';
import { json, urlencoded } from 'express';
import { AppModule } from './app.module';
import { MonitorService } from './monitor/monitor.service';
import { MonitorInterceptor } from './monitor/monitor.interceptor';
import { MonitorExceptionsFilter } from './monitor/monitor-exceptions.filter';

// Blindaje del proceso: un rechazo/excepción no capturado NO debe tumbar el
// backend. Sin esto, los reintentos asíncronos de googleapis (gaxios) al fallar
// un refresh token de Gmail (`invalid_grant`) generan un unhandledRejection que
// mata el proceso → Railway reinicia → 502 en TODOS los endpoints (crash-loop).
// Tras el bootstrap apunta al MonitorService: los errores de proceso (fuera
// de requests: crons, promesas sueltas) también quedan en monitor_logs.
let monitorGlobal: MonitorService | null = null;

process.on('unhandledRejection', (reason: any) => {
  console.error('[unhandledRejection]', reason);
  monitorGlobal?.registrar({
    nivel: 'error',
    tipo: 'sistema',
    mensaje: `unhandledRejection: ${reason?.message || reason}`,
    stack: reason?.stack,
  });
});
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err);
  monitorGlobal?.registrar({
    nivel: 'error',
    tipo: 'sistema',
    mensaje: `uncaughtException: ${err?.message || err}`,
    stack: err?.stack,
  });
});

// Railway (y la mayoría de cloud providers chicos) sólo tienen IPv4 saliente.
// Por default Node resuelve hostnames con IPv6 primero, lo que hace fallar
// llamadas a Gmail SMTP (smtp.gmail.com), Boostr (api.boostr.cl), etc. con
// ENETUNREACH. Forzamos IPv4 a nivel global.
dns.setDefaultResultOrder('ipv4first');

// Node >= 20 además activa "Happy Eyeballs" (autoSelectFamily): al conectar
// prueba direcciones alternando IPv4/IPv6 aunque el orden DNS sea ipv4first,
// por lo que en Railway igual aparecían ENETUNREACH hacia IPv6 de Gmail
// (connect ENETUNREACH 2607:f8b0:...:587). Se desactiva globalmente.
if (typeof (net as any).setDefaultAutoSelectFamily === 'function') {
  (net as any).setDefaultAutoSelectFamily(false);
}

async function bootstrap() {
  // Desactivamos el body parser default (límite 100kb) para registrar el
  // nuestro con un límite mayor — la firma de recepción del despacho viaja
  // como PNG en base64 dentro de un JSON.
  const app = await NestFactory.create(AppModule, { bodyParser: false });

  // Detrás de Railway (proxy) necesitamos confiar en X-Forwarded-For
  // para que req.ip y el rate limit del sorteo detecten la IP real del cliente.
  app.getHttpAdapter().getInstance().set('trust proxy', 1);

  // Whitelist por env: CORS_ORIGIN="https://amsodent.vercel.app,https://otro.com"
  // FAIL-CLOSED (contención auditoría 2026-09-04): sin CORS_ORIGIN definido se
  // bloquea todo origen cruzado — antes el fallback reflejaba cualquier origen
  // CON credenciales, dejando el backend expuesto a CSRF si la variable
  // faltaba en un despliegue. Las peticiones sin Origin (curl, apps móviles,
  // health checks) no pasan por CORS y siguen funcionando.
  const corsOrigin = process.env.CORS_ORIGIN;
  if (!corsOrigin) {
    console.warn('[CORS] CORS_ORIGIN no está definido: se bloquea todo origen cruzado (fail-closed).');
  }
  app.enableCors({
    origin: corsOrigin
      ? corsOrigin.split(',').map((o) => o.trim()).filter(Boolean)
      : false,
    credentials: true,
  });

  // Compresión gzip: las respuestas grandes (listas de cotizaciones, ítems,
  // etc. de varios MB) viajan ~10x más livianas → carga mucho más rápida.
  app.use(compression());

  app.use(json({ limit: '8mb' }));
  app.use(urlencoded({ extended: true, limit: '8mb' }));

  app.setGlobalPrefix('api');

  // Monitoreo del sistema: toda request y toda excepción quedan registradas
  // en monitor_logs (panel /monitoreo-sistema del frontend).
  const monitor = app.get(MonitorService);
  monitorGlobal = monitor;
  app.useGlobalInterceptors(new MonitorInterceptor(monitor));
  app.useGlobalFilters(new MonitorExceptionsFilter(monitor));

  const port = Number(process.env.PORT) || 3001;
  await app.listen(port, '0.0.0.0');
  console.log(`Backend corriendo en puerto ${port} (prefijo /api)`);
}
bootstrap();
