import { NestFactory } from '@nestjs/core';
import * as dns from 'dns';
import { AppModule } from './app.module';

// Railway (y la mayoría de cloud providers chicos) sólo tienen IPv4 saliente.
// Por default Node resuelve hostnames con IPv6 primero, lo que hace fallar
// llamadas a Gmail SMTP (smtp.gmail.com), Boostr (api.boostr.cl), etc. con
// ENETUNREACH. Forzamos IPv4 a nivel global.
dns.setDefaultResultOrder('ipv4first');

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

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

  app.setGlobalPrefix('api');

  const port = Number(process.env.PORT) || 3001;
  await app.listen(port, '0.0.0.0');
  console.log(`Backend corriendo en puerto ${port} (prefijo /api)`);
}
bootstrap();
