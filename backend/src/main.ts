import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

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
