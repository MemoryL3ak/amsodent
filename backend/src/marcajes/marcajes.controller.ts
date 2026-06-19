import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { MarcajesService } from './marcajes.service';
import type { CrearMarcajeDto, TipoMarcaje } from './marcajes.service';
import { AuthGuard } from '../auth/auth.guard';
import { AdminGuard } from '../auth/admin.guard';
import { SupabaseService } from '../supabase/supabase.service';

@Controller('marcajes')
export class MarcajesController {
  constructor(
    private marcajes: MarcajesService,
    private supabase: SupabaseService,
  ) {}

  // ============================================================
  // Usuarios autenticados — marcaje propio
  // ============================================================

  @UseGuards(AuthGuard)
  @Get('me/ultimo')
  async ultimoMio(@Req() req: any) {
    const email = (req?.user?.email || '').toLowerCase();
    return await this.marcajes.ultimoDelDia(email);
  }

  @UseGuards(AuthGuard)
  @Get('me')
  async listarMios(
    @Req() req: any,
    @Query('desde') desde?: string,
    @Query('hasta') hasta?: string,
  ) {
    const email = (req?.user?.email || '').toLowerCase();
    return await this.marcajes.listarMios(email, desde, hasta);
  }

  @UseGuards(AuthGuard)
  @Post()
  async crear(@Req() req: any, @Body() body: CrearMarcajeDto) {
    const email = (req?.user?.email || '').toLowerCase();

    // Buscar el nombre del perfil para guardarlo de forma denormalizada.
    let nombre: string | null = null;
    try {
      const { data } = await this.supabase
        .getClient()
        .from('profiles')
        .select('nombre')
        .ilike('email', email)
        .maybeSingle();
      nombre = data?.nombre || null;
    } catch (_) {
      // Sin nombre — no es bloqueante
    }

    const userAgent = req?.headers?.['user-agent'] || null;
    const ipAddress =
      req?.headers?.['x-forwarded-for']?.toString().split(',')[0]?.trim() ||
      req?.ip ||
      null;

    return await this.marcajes.crear(email, nombre, {
      ...body,
      user_agent: userAgent,
      ip_address: ipAddress,
    });
  }

  // ============================================================
  // Admin — monitoreo y configuración de oficinas
  // ============================================================

  @UseGuards(AdminGuard)
  @Get()
  async listarTodos(
    @Query('desde') desde?: string,
    @Query('hasta') hasta?: string,
    @Query('email') email?: string,
    @Query('tipo') tipo?: TipoMarcaje,
    @Query('fuera_de_radio') fuera?: string,
  ) {
    const fueraBool =
      fuera === 'true' ? true : fuera === 'false' ? false : undefined;
    return await this.marcajes.listarTodos({
      desde,
      hasta,
      email,
      tipo,
      fuera_de_radio: fueraBool,
    });
  }

  // ============================================================
  // Oficinas — admin gestiona, autenticados consultan
  // ============================================================

  @UseGuards(AuthGuard)
  @Get('oficinas')
  async listarOficinas() {
    return await this.marcajes.listarOficinas();
  }

  @UseGuards(AdminGuard)
  @Post('oficinas')
  async crearOficina(@Body() body: any) {
    return await this.marcajes.crearOficina(body);
  }

  @UseGuards(AdminGuard)
  @Put('oficinas/:id')
  async actualizarOficina(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: any,
  ) {
    return await this.marcajes.actualizarOficina(id, body);
  }

  @UseGuards(AdminGuard)
  @Delete('oficinas/:id')
  async eliminarOficina(@Param('id', ParseIntPipe) id: number) {
    return await this.marcajes.eliminarOficina(id);
  }

  // Trabajadores asignados a una oficina.
  @UseGuards(AdminGuard)
  @Get('oficinas/:id/trabajadores')
  async trabajadoresDeOficina(@Param('id', ParseIntPipe) id: number) {
    return await this.marcajes.trabajadoresDeOficina(id);
  }

  @UseGuards(AdminGuard)
  @Put('oficinas/:id/trabajadores')
  async setTrabajadoresOficina(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { emails?: string[] },
  ) {
    return await this.marcajes.setTrabajadoresOficina(id, Array.isArray(body?.emails) ? body.emails : []);
  }

  // Asignación inversa: oficinas de un trabajador (desde el panel de Usuarios).
  @UseGuards(AdminGuard)
  @Get('oficinas-trabajador')
  async oficinasDeTrabajador(@Query('email') email: string) {
    return { ids: await this.marcajes.oficinasDeTrabajador(email) };
  }

  @UseGuards(AdminGuard)
  @Put('oficinas-trabajador')
  async setOficinasTrabajador(@Body() body: { email?: string; oficina_ids?: number[] }) {
    return await this.marcajes.setOficinasTrabajador(
      body?.email || '',
      Array.isArray(body?.oficina_ids) ? body.oficina_ids : [],
    );
  }
}
