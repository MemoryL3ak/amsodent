import { BadGatewayException, BadRequestException, ConflictException, HttpException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { BsaleFacturacionService } from '../bsale/bsale-facturacion.service';
import { BsaleLibreService } from '../bsale/bsale-libre.service';
import { cuerpoVentaDirecta, formaDePago, PEDIDO_RE, validarPedido } from './tienda-web.logica';

/* Pedidos de la tienda web amsodentmedical.cl → boleta o factura en Bsale
   (2026-11-26). La tienda llama SOLO con pedidos pagados (Webpay aprobado o
   transferencia marcada como recibida). Cada pedido se emite como una venta
   directa: queda la cotización particular adjudicada, el documento pagado y,
   si hay RUT y dirección, la guía «Operación constituye venta» que rebaja el
   stock en Bsale. Una fila por pedido en pedidos_tienda_web: nunca dos
   documentos para el mismo pedido. */

const EN_CURSO_MS = 10 * 60 * 1000;
const REINTENTABLES = ['recibido', 'error', 'simulada'];

const hoyEnChile = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

@Injectable()
export class TiendaWebService {
  private readonly logger = new Logger(TiendaWebService.name);

  constructor(
    private supabase: SupabaseService,
    private facturacion: BsaleFacturacionService,
    private libre: BsaleLibreService,
  ) {}

  // Usuario con que queda registrada la venta (bitácora, cotización y vendedor en Bsale).
  private get usuario() {
    return { id: '', email: (process.env.TIENDA_WEB_USUARIO_EMAIL || 'tienda-web').trim().toLowerCase() };
  }

  // Estado de un pedido (la tienda lo consulta para conciliar).
  async estado(pedidoRaw: string) {
    const pedido = String(pedidoRaw || '').trim().toUpperCase();
    if (!PEDIDO_RE.test(pedido)) throw new BadRequestException('El número de pedido no es válido.');
    const { data, error } = await this.supabase.getClient().from('pedidos_tienda_web').select('*').eq('pedido', pedido).maybeSingle();
    if (error) throw new BadRequestException('Falta aplicar la migración 20261126_pedidos_tienda_web.sql.');
    if (!data) throw new NotFoundException(`El pedido ${pedido} no ha llegado al sistema.`);
    return this.respuesta(data);
  }

  async recibir(body: any) {
    const v = validarPedido(body);
    if (!v.ok) throw new BadRequestException({ estado: 'rechazado', problemas: v.errores.map((mensaje) => ({ codigo: 'entrada', mensaje })) });
    const p = v.pedido;
    const db = this.supabase.getClient();

    // 1. La fila del pedido (si ya existe no se toca).
    const ins = await db.from('pedidos_tienda_web').upsert([{ pedido: p.pedido, tipo: p.tipo, total_tienda: p.total_tienda }], { onConflict: 'pedido', ignoreDuplicates: true });
    if (ins.error) throw new BadRequestException('Falta aplicar la migración 20261126_pedidos_tienda_web.sql.');
    const { data: fila } = await db.from('pedidos_tienda_web').select('*').eq('pedido', p.pedido).single();
    const f: any = fila;

    // 2. Ya emitido: misma respuesta, sin volver a Bsale.
    if (f.estado === 'emitida') return this.respuesta(f);
    if (f.estado === 'incierta') {
      throw new ConflictException({ ...this.respuesta(f), mensaje: 'El intento anterior quedó sin confirmar: revisa en Bsale si el documento salió antes de volver a intentar.' });
    }
    if (f.estado === 'emitiendo') {
      if (Date.now() - new Date(f.updated_at).getTime() < EN_CURSO_MS) throw new ConflictException({ ...this.respuesta(f), mensaje: 'Este pedido ya se está emitiendo.' });
      /* Quedó «emitiendo» más de 10 minutos: el proceso se cortó a mitad y no se
         sabe si Bsale alcanzó a emitir. Igual que un intento incierto: no se
         reintenta solo, alguien lo revisa en Bsale. */
      const { data: inc } = await db
        .from('pedidos_tienda_web')
        .update({ estado: 'incierta', error: 'El intento anterior se cortó a mitad: revisa en Bsale si el documento salió.', updated_at: new Date().toISOString() })
        .eq('pedido', p.pedido)
        .eq('updated_at', f.updated_at)
        .select('*');
      throw new ConflictException({ ...this.respuesta((inc || [])[0] || f), mensaje: 'El intento anterior quedó sin confirmar: revisa en Bsale si el documento salió antes de volver a intentar.' });
    }
    if (!REINTENTABLES.includes(f.estado)) throw new ConflictException({ ...this.respuesta(f), mensaje: `Estado inesperado: ${f.estado}.` });

    // 3. Tomar el pedido: compara-y-cambia sobre updated_at (dos llamadas a la vez → solo una gana).
    const ahora = new Date().toISOString();
    const { data: tomado } = await db
      .from('pedidos_tienda_web')
      .update({ estado: 'emitiendo', intentos: Number(f.intentos || 0) + 1, entrada: body, tipo: p.tipo, total_tienda: p.total_tienda, error: null, problemas: null, updated_at: ahora })
      .eq('pedido', p.pedido)
      .eq('updated_at', f.updated_at)
      .select('id');
    if (!tomado || !tomado.length) throw new ConflictException({ estado: 'emitiendo', pedido: p.pedido, mensaje: 'Este pedido ya se está emitiendo.' });

    const terminar = async (cambios: Record<string, any>) => {
      const { data } = await db.from('pedidos_tienda_web').update({ ...cambios, updated_at: new Date().toISOString() }).eq('pedido', p.pedido).select('*').single();
      return data;
    };

    const salesId = `AMS-WEB-${p.pedido}`;

    /* ¿Bsale ya emitió este pedido? (bsale_emisiones guarda cada intento por
       salesId). Si un intento anterior emitió y falló DESPUÉS (registro, correo),
       la fila del pedido pudo quedar en «error»: se adopta ese documento y nunca
       se emite otro. Si quedó «incierta» o a medio enviar, no se sigue. */
    const adoptar = async (): Promise<any | null> => {
      const { data: em } = await db.from('bsale_emisiones').select('estado, numero, bsale_id, url_pdf, total, licitacion_id, documento_id, updated_at').eq('sales_id', salesId).maybeSingle();
      const e: any = em;
      if (!e) return null;
      if (e.estado === 'emitida') {
        const fin = await terminar({
          estado: 'emitida', sales_id: salesId, bsale_id: e.bsale_id || null, numero: e.numero || null, url_pdf: e.url_pdf || null,
          total_documento: e.total != null ? Number(e.total) : null, cotizacion_id: e.licitacion_id || null, documento_id: e.documento_id || null,
          avisos: ['El documento ya estaba emitido en Bsale (intento anterior): se tomó ese, no se emitió otro.'], error: null, problemas: null,
          emitido_at: e.updated_at || new Date().toISOString(),
        });
        this.logger.warn(`Pedido web ${p.pedido}: adoptado el documento ${e.numero} ya emitido en Bsale`);
        return fin;
      }
      if (e.estado === 'incierta' || e.estado === 'enviando') {
        const fin = await terminar({ estado: 'incierta', error: 'Un intento anterior quedó sin confirmar en Bsale: revisa en Bsale si el documento salió.' });
        throw new ConflictException(this.respuesta(fin));
      }
      return null; // «error»: Bsale lo rechazó, se puede volver a intentar
    };

    // 4. ¿Ya emitido por un intento anterior? Entonces se adopta.
    const previo = await adoptar();
    if (previo) return this.respuesta(previo);

    // 5. Forma de pago de Bsale para el medio de la tienda. Si Bsale no responde, el
    //    pedido queda en «error» (reintentable: todavía no se envió nada).
    let formas: { id: number; nombre: string }[];
    try {
      formas = (await this.facturacion.listas()).formas;
    } catch (e: any) {
      const mensaje = `Bsale no respondió al leer las formas de pago: ${String(e?.message || e).slice(0, 200)}`;
      const fin = await terminar({ estado: 'error', error: mensaje, problemas: [{ codigo: 'bsale_no_disponible', mensaje }] });
      throw new ServiceUnavailableException(this.respuesta(fin));
    }
    const idFijado = p.medio_pago === 'webpay' ? process.env.TIENDA_WEB_FORMA_PAGO_WEBPAY : process.env.TIENDA_WEB_FORMA_PAGO_TRANSFERENCIA;
    const forma = formaDePago(formas, p.medio_pago, idFijado);
    if (!forma) {
      const problemas = [{ codigo: 'forma_pago', mensaje: `No hay en Bsale una forma de pago para «${p.medio_pago}». Fija su id en TIENDA_WEB_FORMA_PAGO_${p.medio_pago.toUpperCase()}.` }];
      const fin = await terminar({ estado: 'error', problemas, error: problemas[0].mensaje });
      throw new BadRequestException(this.respuesta(fin));
    }

    // 6. Emitir como venta directa, con clave y salesId fijos para este pedido.
    const cuerpo = cuerpoVentaDirecta(p, forma.id, hoyEnChile());
    try {
      const r: any = await this.libre.emitir(this.usuario, cuerpo, {
        sistema: true, clave: salesId, salesId,
        observacionCotizacion: `Pedido web ${p.pedido} de amsodentmedical.cl (${p.medio_pago === 'webpay' ? 'Webpay' : 'transferencia'}, ref. ${p.referencia_pago}).`,
      });
      if (r?.bloqueada) {
        const fin = await terminar({ estado: 'error', problemas: r.problemas, avisos: r.avisos, error: (r.problemas || []).map((x: any) => x.mensaje).join(' ') });
        throw new BadRequestException(this.respuesta(fin));
      }
      if (r?.simulacion) {
        const fin = await terminar({ estado: 'simulada', solicitud: r.solicitud, avisos: r.avisos, total_documento: r.totales?.total ?? null, sales_id: salesId });
        return this.respuesta(fin);
      }
      const avisos: string[] = [...(r?.avisos || [])];
      const totalDoc = Number(r?.total) || null;
      if (totalDoc != null && Math.abs(totalDoc - p.total_tienda) > Math.max(2, p.lineas.length)) {
        avisos.push(`El total del documento ($${totalDoc.toLocaleString('es-CL')}) no calza con lo cobrado en la tienda ($${p.total_tienda.toLocaleString('es-CL')}).`);
      }
      if (r?.guia && r.guia.emitida === false) avisos.push(`La guía de despacho no se emitió: ${r.guia.error || 'sin detalle'}. El stock en Bsale no se rebajó; emítela desde la cotización.`);
      const fin = await terminar({
        estado: 'emitida', sales_id: salesId, bsale_id: r?.bsale_id || null, numero: r?.numero || null, url_pdf: r?.url_pdf || null,
        total_documento: totalDoc, cotizacion_id: r?.cotizacion?.id || null, documento_id: r?.documento_id || null,
        guia_numero: r?.guia?.numero || null, avisos, emitido_at: new Date().toISOString(),
      });
      this.logger.log(`Pedido web ${p.pedido}: ${p.tipo} ${r?.numero} emitida (cotización ${r?.cotizacion?.id || '—'})`);
      return this.respuesta(fin);
    } catch (e: any) {
      if (e instanceof HttpException && (e.getResponse() as any)?.pedido === p.pedido) throw e; // ya registrado arriba
      // Pudo fallar DESPUÉS de que Bsale emitiera (registro, correo): si quedó emitida, se adopta.
      const adoptado = await adoptar().catch((x) => (x instanceof HttpException ? Promise.reject(x) : null));
      if (adoptado) return this.respuesta(adoptado);
      const mensaje = String((e?.getResponse?.() as any)?.message || e?.message || e).slice(0, 1000);
      // Bsale no respondió (o el intento anterior quedó así): no se reintenta solo.
      const incierta = e instanceof BadGatewayException || /sin confirmar/i.test(mensaje);
      const fin = await terminar({ estado: incierta ? 'incierta' : 'error', error: mensaje, problemas: [{ codigo: incierta ? 'incierta' : 'bsale', mensaje }] });
      this.logger.warn(`Pedido web ${p.pedido}: ${incierta ? 'incierta' : 'error'}: ${mensaje}`);
      if (incierta) throw new BadGatewayException(this.respuesta(fin));
      throw new BadRequestException(this.respuesta(fin));
    }
  }

  private respuesta(f: any) {
    return {
      pedido: f?.pedido, estado: f?.estado, tipo: f?.tipo || null, numero: f?.numero || null, url_pdf: f?.url_pdf || null,
      bsale_id: f?.bsale_id || null, cotizacion_id: f?.cotizacion_id || null, guia_numero: f?.guia_numero || null,
      total_documento: f?.total_documento != null ? Number(f.total_documento) : null, intentos: f?.intentos || 0,
      problemas: f?.problemas || [], avisos: f?.avisos || [], error: f?.error || null, emitido_at: f?.emitido_at || null,
    };
  }
}
