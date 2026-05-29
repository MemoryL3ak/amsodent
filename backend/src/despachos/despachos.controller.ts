import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Param,
  Req,
  UseGuards,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { DespachosService } from './despachos.service';
import { AuthGuard } from '../auth/auth.guard';

function emailDe(req: any): string {
  return String(req?.user?.email || '').trim().toLowerCase();
}

@Controller('despachos')
@UseGuards(AuthGuard)
export class DespachosController {
  constructor(private despachos: DespachosService) {}

  @Get()
  listar() {
    return this.despachos.listar();
  }

  @Get(':id')
  obtener(@Param('id') id: string) {
    return this.despachos.obtener(id);
  }

  @Put(':id/estado')
  cambiarEstado(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: { estado?: string; nota?: string },
  ) {
    return this.despachos.cambiarEstado(
      id,
      body?.estado || '',
      body?.nota || '',
      emailDe(req),
    );
  }

  @Post(':id/archivos')
  @UseInterceptors(FileInterceptor('file'))
  subirArchivo(
    @Req() req: any,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.despachos.subirArchivo(id, file, emailDe(req));
  }

  @Post(':id/firma')
  guardarFirma(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: { firma?: string; receptor_nombre?: string; receptor_rut?: string },
  ) {
    return this.despachos.guardarFirma(id, body, emailDe(req));
  }
}
