import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
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
import { GoogleAuthModule } from './google-auth/google-auth.module';
import { ComunicacionesModule } from './comunicaciones/comunicaciones.module';
import { BitacoraModule } from './bitacora/bitacora.module';
import { PlantillasModule } from './plantillas/plantillas.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
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
    GoogleAuthModule,
    ComunicacionesModule,
    BitacoraModule,
    PlantillasModule,
  ],
})
export class AppModule {}
