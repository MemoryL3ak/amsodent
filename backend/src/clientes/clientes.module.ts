import { Module } from '@nestjs/common';
import { ClientesController } from './clientes.controller';
import { ClientesService } from './clientes.service';
import { BsaleModule } from '../bsale/bsale.module';

@Module({
  // BsaleModule: al guardar los giros de la ficha se actualiza el giro del
  // cliente en Bsale (2026-10-23).
  imports: [BsaleModule],
  controllers: [ClientesController],
  providers: [ClientesService],
})
export class ClientesModule {}
