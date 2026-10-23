import { Global, Module } from '@nestjs/common';
import { MonitorController } from './monitor.controller';
import { MonitorService } from './monitor.service';
import { CredencialesService } from './credenciales.service';

// Global: cualquier servicio (mailings, correos, etc.) puede inyectar
// MonitorService sin importar el módulo.
@Global()
@Module({
  controllers: [MonitorController],
  providers: [MonitorService, CredencialesService],
  exports: [MonitorService, CredencialesService],
})
export class MonitorModule {}
