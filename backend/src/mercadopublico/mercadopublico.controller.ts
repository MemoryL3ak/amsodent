import { Controller, Get, Post, Body, Query, UseGuards, Param, ParseIntPipe, Req } from '@nestjs/common';
import { MercadopublicoService } from './mercadopublico.service';
import { MercadopublicoCron } from './mercadopublico.cron';
import { MpColaService } from './mp-cola.service';
import { AdminGuard } from '../auth/admin.guard';

// Benchmark de postulaciones vs Mercado Público: SOLO administradores.
@Controller('mercado-publico')
@UseGuards(AdminGuard)
export class MercadopublicoController {
  constructor(
    private mpService: MercadopublicoService,
    private cron: MercadopublicoCron,
    private cola: MpColaService,
  ) {}

  // Configuración disponible (ticket / RUT empresa) para la UI.
  @Get('estado')
  estado() {
    return { ...this.mpService.estado(), automatica: this.cron.estado() };
  }

  // Resultados guardados (mp_resultados + datos de la cotización interna).
  //
  // `desde` (ISO) devuelve SOLO las fichas consultadas después de ese instante.
  // Lo usa la sincronización para refrescar el panel entre tandas: la carga
  // completa pesa 6 MB hoy (24 MB proyectados con el catálogo entero), así que
  // pedirla cada 45 s era inviable y por eso la pantalla se quedaba quieta
  // varios minutos. El delta de una tanda son ~12 fichas, unos 90 KB.
  @Get('resultados')
  resultados(@Query('desde') desde?: string) {
    return this.mpService.resultados(desde);
  }

  // (2026-10-07) Detalle completo de una ficha: lo pide el panel al desplegarla.
  // (2026-10-09) Análisis por producto del período, armado en el servidor (antes viajaban los ítems de todas las fichas).
  @Get('resultados/productos')
  resultadosProductos(@Query('desde') desde?: string, @Query('hasta') hasta?: string) {
    return this.mpService.resultadosProductos(desde, hasta);
  }

  @Get('resultados/:id/detalle')
  detalleResultado(@Param('id', ParseIntPipe) id: number) {
    return this.mpService.detalleResultado(id);
  }

  // Consulta la API oficial para los procesos aún sin resultado final.
  // body opcional: { desde: 'YYYY-MM-DD', hasta: 'YYYY-MM-DD', lote: n }
  // (el frontend sincroniza en tandas chicas y refresca entre cada una)
  /* (2026-10-21) Ya no consulta la API dentro de la request: ENCOLA un trabajo
     por proceso pendiente y responde al tiro con el lote. El robot (en el
     worker) los procesa; la pantalla sigue el avance en 'cola/estado'. */
  @Post('sincronizar')
  sincronizar(@Body() body: any, @Req() req: any) {
    return this.mpService.encolarSincronizacion(body || {}, (req?.user?.email || '').toLowerCase() || null);
  }

  /* ── Cola y robot ──
     'cola/estado': el robot (¿vive?, ¿pausado por cuota o API caída?) y el
     avance de un lote (?lote=…) o del lote activo más reciente si no se indica,
     para que una pantalla recién abierta se enganche a lo que ya corre. */
  @Get('cola/estado')
  async colaEstado(@Query('lote') lote?: string, @Query('tipo') tipo?: string) {
    const [robot, resumen, porTipo] = await Promise.all([
      this.cola.robot(),
      this.cola.resumen(lote || null, tipo || null),
      this.cola.pendientesPorTipo(),
    ]);
    return { robot, lote: resumen, por_tipo: porTipo };
  }

  // Los trabajos de un lote con su resultado (tablas de diagnóstico / verificación).
  @Get('cola/lote/:lote')
  colaLote(@Param('lote') lote: string) {
    return this.cola.trabajosDeLote(String(lote || ''));
  }

  // Cancela lo pendiente de un lote; lo que ya está en curso termina solo.
  @Post('cola/cancelar')
  colaCancelar(@Body() body: { lote?: string }) {
    if (!body?.lote) return { cancelados: 0 };
    return this.cola.cancelarLote(String(body.lote));
  }
}
