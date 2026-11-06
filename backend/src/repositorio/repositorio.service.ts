import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

/* ============================================================================
   Repositorio de documentos (2026-11-05)
   ----------------------------------------------------------------------------
   Pedido de Ariel: "Módulo Repositorio de documentos. Patente, Estatuto
   empresa, carta garantía (vigencia de documentos)".

   Un lugar para los documentos de la empresa que se piden una y otra vez
   (patente comercial, estatutos, cartas de garantía, certificados…), cada uno
   con su archivo y su VIGENCIA: fecha de emisión y fecha de vencimiento. El
   estado se calcula con la fecha de hoy en Chile:
       vigente · por vencer (a 30 días o menos) · vencido · sin vencimiento
   y un cron diario avisa en la campana cuando un documento está por vencer o
   venció (repositorio.cron.ts).

   Quién hace qué:
   · Ver la lista y descargar: cualquier usuario con sesión. Se necesita al
     bajar las fichas técnicas de una cotización: la ventana ofrece sumar al
     ZIP documentos del repositorio (pedido de Ariel).
   · Subir, editar, reemplazar el archivo y eliminar: solo administradores
     (2026-11-06; ya no existe el permiso «repositorio» por perfil).

   Los archivos van al bucket PRIVADO `repositorio` de Supabase Storage; se
   entregan con una URL firmada de corta duración. Tabla y bucket: migración
   20261105_repositorio_documentos.
============================================================================ */

const BUCKET = 'repositorio';
const MIGRACION = 'Falta aplicar la migración 20261105_repositorio_documentos.sql en Supabase.';
export const MAX_BYTES = 20 * 1024 * 1024;
const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;
export const DIAS_POR_VENCER = 30;

export const CATEGORIAS: { clave: string; nombre: string }[] = [
  { clave: 'patente', nombre: 'Patente comercial' },
  { clave: 'estatuto', nombre: 'Estatuto de la empresa' },
  { clave: 'carta_garantia', nombre: 'Carta de garantía' },
  { clave: 'certificado', nombre: 'Certificado' },
  { clave: 'legal', nombre: 'Documento legal' },
  { clave: 'otro', nombre: 'Otro' },
];
const CLAVES = CATEGORIAS.map((c) => c.clave);

// Lo que se acepta subir: documentos e imágenes (nada ejecutable).
const MIMES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
];
const EXTENSIONES = ['pdf', 'png', 'jpg', 'jpeg', 'webp', 'doc', 'docx', 'xls', 'xlsx'];

export type Vigencia = 'vigente' | 'por_vencer' | 'vencido' | 'sin_vencimiento';

export function hoyEnChile(ahora = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(ahora);
}

/* Días entre dos fechas YYYY-MM-DD (b − a). */
export function diasEntre(a: string, b: string): number {
  const t = (s: string) => Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)));
  return Math.round((t(b) - t(a)) / 86400000);
}

/* Estado de vigencia de un documento a la fecha `hoy`. */
export function vigenciaDe(fechaVencimiento: any, hoy: string): { estado: Vigencia; dias: number | null } {
  const vence = String(fechaVencimiento || '').slice(0, 10);
  if (!RE_FECHA.test(vence)) return { estado: 'sin_vencimiento', dias: null };
  const dias = diasEntre(hoy, vence);
  if (dias < 0) return { estado: 'vencido', dias };
  if (dias <= DIAS_POR_VENCER) return { estado: 'por_vencer', dias };
  return { estado: 'vigente', dias };
}

const texto = (v: any, max: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/* El nombre del archivo llega de multer en latin1: se pasa a UTF-8 cuando corresponde. */
function nombreArchivo(original: any): string {
  const crudo = String(original || 'documento');
  let nombre = crudo;
  try {
    const utf8 = Buffer.from(crudo, 'latin1').toString('utf8');
    if (!utf8.includes('�')) nombre = utf8;
  } catch { /* se deja como vino */ }
  return nombre.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-').trim().slice(0, 160) || 'documento';
}

@Injectable()
export class RepositorioService {
  private readonly logger = new Logger(RepositorioService.name);

  constructor(private supabase: SupabaseService) {}

  private get db() {
    return this.supabase.getClient();
  }

  private sinTabla(error: any): boolean {
    return /repositorio_documentos|PGRST205|42P01/i.test(`${error?.code} ${error?.message}`) && /(schema cache|does not exist|not find|PGRST205|42P01)/i.test(`${error?.code} ${error?.message}`);
  }

  private fallo(error: any): never {
    if (this.sinTabla(error)) throw new BadRequestException(MIGRACION);
    throw new BadRequestException(String(error?.message || 'No se pudo guardar el documento.'));
  }

  private conVigencia(doc: any, hoy: string) {
    const v = vigenciaDe(doc.fecha_vencimiento, hoy);
    return { ...doc, vigencia: v.estado, dias_restantes: v.dias };
  }

  /* Lista completa (sin los datos internos de Storage), con su vigencia. `listo:false` si falta la migración. */
  async listar() {
    const { data, error } = await this.db
      .from('repositorio_documentos')
      .select('id, nombre, categoria, descripcion, fecha_emision, fecha_vencimiento, file_name, mime_type, size_bytes, subido_por, created_at, updated_at')
      .order('nombre', { ascending: true })
      .range(0, 999);
    if (error) {
      if (this.sinTabla(error)) return { listo: false, mensaje: MIGRACION, categorias: CATEGORIAS, documentos: [] };
      throw new BadRequestException(error.message);
    }
    const hoy = hoyEnChile();
    return { listo: true, categorias: CATEGORIAS, dias_por_vencer: DIAS_POR_VENCER, documentos: (data || []).map((d: any) => this.conVigencia(d, hoy)) };
  }

  private async uno(id: number) {
    const { data, error } = await this.db.from('repositorio_documentos').select('*').eq('id', id).maybeSingle();
    if (error) this.fallo(error);
    if (!data) throw new NotFoundException('Ese documento ya no está en el repositorio.');
    return data as any;
  }

  /* URL firmada (10 minutos) para ver o descargar el archivo. */
  async url(id: number) {
    const doc = await this.uno(id);
    if (!doc.storage_path) throw new BadRequestException('El documento no tiene un archivo cargado.');
    const { data, error } = await this.db.storage.from(doc.bucket || BUCKET).createSignedUrl(String(doc.storage_path), 600, { download: doc.file_name || true });
    if (error || !data?.signedUrl) throw new BadRequestException(`No se pudo abrir el archivo: ${error?.message || 'sin respuesta de Storage'}`);
    return { url: data.signedUrl, file_name: doc.file_name || null, mime_type: doc.mime_type || null };
  }

  private campos(body: any, parcial = false) {
    const nombre = texto(body?.nombre, 160);
    if (!parcial && !nombre) throw new BadRequestException('El documento necesita un nombre.');
    const categoria = String(body?.categoria || '').trim();
    if ((!parcial || categoria) && !CLAVES.includes(categoria)) throw new BadRequestException('Elige el tipo de documento.');
    const fecha = (v: any, etiqueta: string): string | null => {
      const s = String(v ?? '').slice(0, 10);
      if (!s) return null;
      if (!RE_FECHA.test(s)) throw new BadRequestException(`La fecha de ${etiqueta} no es válida.`);
      return s;
    };
    const emision = fecha(body?.fecha_emision, 'emisión');
    const vencimiento = fecha(body?.fecha_vencimiento, 'vencimiento');
    if (emision && vencimiento && vencimiento < emision) throw new BadRequestException('El vencimiento no puede ser anterior a la emisión.');
    return {
      ...(nombre ? { nombre } : {}),
      ...(categoria ? { categoria } : {}),
      descripcion: texto(body?.descripcion, 400) || null,
      fecha_emision: emision,
      fecha_vencimiento: vencimiento,
    };
  }

  private validarArchivo(file: Express.Multer.File | undefined, obligatorio: boolean) {
    if (!file?.buffer?.length) {
      if (obligatorio) throw new BadRequestException('Falta el archivo del documento.');
      return null;
    }
    if (file.size > MAX_BYTES) throw new BadRequestException(`El archivo pesa más de ${Math.round(MAX_BYTES / 1024 / 1024)} MB.`);
    const nombre = nombreArchivo(file.originalname);
    const ext = (nombre.split('.').pop() || '').toLowerCase();
    if (!MIMES.includes(String(file.mimetype || '').toLowerCase()) && !EXTENSIONES.includes(ext)) {
      throw new BadRequestException('Tipo de archivo no permitido: sube un PDF, una imagen o un documento de Word o Excel.');
    }
    return { nombre, ext: EXTENSIONES.includes(ext) ? ext : 'pdf' };
  }

  private async subir(file: Express.Multer.File, categoria: string, ext: string) {
    const ruta = `${categoria}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error } = await this.db.storage.from(BUCKET).upload(ruta, file.buffer, { contentType: file.mimetype || 'application/octet-stream', upsert: false });
    if (error) {
      if (/bucket.*not found/i.test(error.message)) throw new BadRequestException(`Falta el bucket «${BUCKET}» en Supabase Storage: ${MIGRACION}`);
      throw new BadRequestException(`No se pudo subir el archivo: ${error.message}`);
    }
    return ruta;
  }

  private async borrarArchivo(bucket: string | null, ruta: string | null) {
    if (!ruta) return;
    const { error } = await this.db.storage.from(bucket || BUCKET).remove([ruta]);
    if (error) this.logger.warn(`Repositorio: no se pudo borrar ${ruta}: ${error.message}`);
  }

  async crear(body: any, file: Express.Multer.File | undefined, usuario: string | null) {
    const campos = this.campos(body);
    const archivo = this.validarArchivo(file, true)!;
    const ruta = await this.subir(file as Express.Multer.File, campos.categoria as string, archivo.ext);
    const { data, error } = await this.db
      .from('repositorio_documentos')
      .insert({ ...campos, bucket: BUCKET, storage_path: ruta, file_name: archivo.nombre, mime_type: file?.mimetype || null, size_bytes: file?.size || null, subido_por: usuario })
      .select('id')
      .single();
    if (error) {
      await this.borrarArchivo(BUCKET, ruta); // sin fila no debe quedar el archivo suelto
      this.fallo(error);
    }
    return { ok: true, id: (data as any).id };
  }

  /* Edita los datos y, si viene un archivo, lo reemplaza (renovación del documento). */
  async actualizar(id: number, body: any, file: Express.Multer.File | undefined, usuario: string | null) {
    const previo = await this.uno(id);
    const campos = this.campos(body);
    const archivo = this.validarArchivo(file, false);
    const cambios: Record<string, any> = { ...campos, updated_at: new Date().toISOString() };
    let rutaNueva: string | null = null;
    if (archivo && file) {
      rutaNueva = await this.subir(file, (campos.categoria as string) || previo.categoria, archivo.ext);
      Object.assign(cambios, { bucket: BUCKET, storage_path: rutaNueva, file_name: archivo.nombre, mime_type: file.mimetype || null, size_bytes: file.size || null, subido_por: usuario });
    }
    const { error } = await this.db.from('repositorio_documentos').update(cambios).eq('id', id);
    if (error) {
      if (rutaNueva) await this.borrarArchivo(BUCKET, rutaNueva);
      this.fallo(error);
    }
    if (rutaNueva) await this.borrarArchivo(previo.bucket, previo.storage_path);
    return { ok: true, id, archivo_reemplazado: !!rutaNueva };
  }

  async eliminar(id: number) {
    const previo = await this.uno(id);
    const { error } = await this.db.from('repositorio_documentos').delete().eq('id', id);
    if (error) this.fallo(error);
    await this.borrarArchivo(previo.bucket, previo.storage_path);
    return { ok: true };
  }
}
