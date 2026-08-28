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
import { CorreosModule } from './correos/correos.module';
import { PortalModule } from './portal/portal.module';
import { NotificacionesModule } from './notificaciones/notificaciones.module';
import { BitacoraModule } from './bitacora/bitacora.module';
import { IaModule } from './ia/ia.module';
import { DespachosModule } from './despachos/despachos.module';
import { ChatModule } from './chat/chat.module';
import { MarcajesModule } from './marcajes/marcajes.module';
import { StockClientesModule } from './stock-clientes/stock-clientes.module';
import { RecordatoriosModule } from './recordatorios/recordatorios.module';
import { ChoferesModule } from './choferes/choferes.module';
import { ActividadesModule } from './actividades/actividades.module';
import { OrdenesCompraModule } from './ordenes-compra/ordenes-compra.module';
import { ComisionesModule } from './comisiones/comisiones.module';
import { ProveedoresModule } from './proveedores/proveedores.module';
import { FletesModule } from './fletes/fletes.module';
import { EventosModule } from './eventos/eventos.module';
import { MercadopublicoModule } from './mercadopublico/mercadopublico.module';
import { MonitorModule } from './monitor/monitor.module';
import { RrhhModule } from './rrhh/rrhh.module';
import { InventarioModule } from './inventario/inventario.module';

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
    CorreosModule,
    PortalModule,
    NotificacionesModule,
    BitacoraModule,
    IaModule,
    DespachosModule,
    ChatModule,
    MarcajesModule,
    StockClientesModule,
    RecordatoriosModule,
    ChoferesModule,
    ActividadesModule,
    OrdenesCompraModule,
    ComisionesModule,
    ProveedoresModule,
    FletesModule,
    EventosModule,
    MercadopublicoModule,
    MonitorModule,
    RrhhModule,
    InventarioModule,
  ],
})
export class AppModule {}
