import * as path from 'path';
import * as dotenv from 'dotenv';

// Cargar el .env de /backend de forma explícita, antes de importar AppModule.
// Defensivo: independiza la carga de credenciales (ANTHROPIC_API_KEY, etc.)
// del cwd con el que se haya invocado el proceso.
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

import { NestFactory } from '@nestjs/core';
import * as dns from 'dns';
import { json, urlencoded } from 'express';
import { AppModule } from './app.module';

// Blindaje del proceso: un rechazo/excepción no capturado NO debe tumbar el
// backend. Sin esto, los reintentos asíncronos de googleapis (gaxios) al fallar
// un refresh token de Gmail (`invalid_grant`) generan un unhandledRejection que
// mata el proceso → Railway reinicia → 502 en TODOS los endpoints (crash-loop).
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err);
});

// Railway (y la mayoría de cloud providers chicos) sólo tienen IPv4 saliente.
// Por default Node resuelve hostnames con IPv6 primero, lo que hace fallar
// llamadas a Gmail SMTP (smtp.gmail.com), Boostr (api.boostr.cl), etc. con
// ENETUNREACH. Forzamos IPv4 a nivel global.
dns.setDefaultResultOrder('ipv4first');

async function bootstrap() {
  // Desactivamos el body parser default (límite 100kb) para registrar el
  // nuestro con un límite mayor — la firma de recepción del despacho viaja
  // como PNG en base64 dentro de un JSON.
  const app = await NestFactory.create(AppModule, { bodyParser: false });

  // Detrás de Railway (proxy) necesitamos confiar en X-Forwarded-For
  // para que req.ip y el rate limit del sorteo detecten la IP real del cliente.
  app.getHttpAdapter().getInstance().set('trust proxy', 1);

  // Whitelist por env: CORS_ORIGIN="https://amsodent.vercel.app,https://otro.com"
  // Si no se define, en dev permite cualquier origen.
  const corsOrigin = process.env.CORS_ORIGIN;
  app.enableCors({
    origin: corsOrigin
      ? corsOrigin.split(',').map((o) => o.trim()).filter(Boolean)
      : true,
    credentials: true,
  });

  app.use(json({ limit: '8mb' }));
  app.use(urlencoded({ extended: true, limit: '8mb' }));

  app.setGlobalPrefix('api');

  const port = Number(process.env.PORT) || 3001;
  await app.listen(port, '0.0.0.0');
  console.log(`Backend corriendo en puerto ${port} (prefijo /api)`);
}
bootstrap();
