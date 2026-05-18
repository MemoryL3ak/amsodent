import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SupabaseModule } from './supabase/supabase.module';
import { AuthModule } from './auth/auth.module';
import { ClientesModule } from './clientes/clientes.module';
import { ProductosModule } from './productos/productos.module';
import { CampanasModule } from './campanas/campanas.module';
import { LicitacionesModule } from './licitaciones/licitaciones.module';
import { MetasModule } from './metas/metas.module';
import { UsuariosModule } from './usuarios/usuarios.module';
import { SorteoModule } from './sorteo/sorteo.module';
import { FeriadosModule } from './feriados/feriados.module';
import { MailingsModule } from './mailings/mailings.module';
import { PortalModule } from './portal/portal.module';
import { NotificacionesModule } from './notificaciones/notificaciones.module';
import { BitacoraModule } from './bitacora/bitacora.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    SupabaseModule,
    AuthModule,
    ClientesModule,
    ProductosModule,
    CampanasModule,
    LicitacionesModule,
    MetasModule,
    UsuariosModule,
    SorteoModule,
    FeriadosModule,
    MailingsModule,
    PortalModule,
    NotificacionesModule,
    BitacoraModule,
  ],
})
export class AppModule {}
