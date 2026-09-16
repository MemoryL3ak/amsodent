import { BadRequestException, Injectable, Logger } from '@nestjs/common';

/* ── Webpay Plus (Transbank) — pago de los pedidos del portal (2026-09-16) ──
   Se usa la API REST de Transbank directamente (sin SDK): son dos llamadas,
   crear y confirmar, y así no se agrega una dependencia más al backend.

   Configuración por variables de entorno:
     TBK_AMBIENTE       'integracion' (por defecto) | 'produccion'
     TBK_COMMERCE_CODE  código de comercio
     TBK_API_KEY        llave secreta (Tbk-Api-Key-Secret)

   Sin configurar, el ambiente de INTEGRACIÓN usa las credenciales públicas de
   prueba de Transbank, que es justo para lo que existen. En producción, si
   faltan las credenciales, el pago se rechaza con un mensaje claro en vez de
   fingir que funciona. */

// Credenciales públicas de prueba de Transbank (solo integración).
const INTEGRACION = {
  host: 'https://webpay3gint.transbank.cl',
  commerceCode: '597055555532',
  apiKey: '579B532A7440BB0C9079DED94D31EA1615BACEB56610332264630D42D0A36B1C',
};
const PRODUCCION_HOST = 'https://webpay3g.transbank.cl';

type CrearResultado = { url: string; token: string };

@Injectable()
export class WebpayService {
  private readonly logger = new Logger(WebpayService.name);

  private get config() {
    const produccion = String(process.env.TBK_AMBIENTE || 'integracion').toLowerCase() === 'produccion';
    const commerceCode = String(process.env.TBK_COMMERCE_CODE || '').trim();
    const apiKey = String(process.env.TBK_API_KEY || '').trim();
    if (produccion) {
      if (!commerceCode || !apiKey) {
        throw new BadRequestException(
          'Webpay no está configurado para producción: faltan TBK_COMMERCE_CODE y TBK_API_KEY.',
        );
      }
      return { host: PRODUCCION_HOST, commerceCode, apiKey, produccion: true };
    }
    return {
      host: INTEGRACION.host,
      commerceCode: commerceCode || INTEGRACION.commerceCode,
      apiKey: apiKey || INTEGRACION.apiKey,
      produccion: false,
    };
  }

  configurado(): boolean {
    try {
      this.config;
      return true;
    } catch {
      return false;
    }
  }

  enProduccion(): boolean {
    try { return this.config.produccion; } catch { return false; }
  }

  private async pedir(metodo: 'POST' | 'PUT' | 'GET', ruta: string, cuerpo?: any) {
    const { host, commerceCode, apiKey } = this.config;
    const res = await fetch(`${host}${ruta}`, {
      method: metodo,
      headers: {
        'Tbk-Api-Key-Id': commerceCode,
        'Tbk-Api-Key-Secret': apiKey,
        'Content-Type': 'application/json',
      },
      body: cuerpo ? JSON.stringify(cuerpo) : undefined,
      signal: AbortSignal.timeout(20000),
    });
    const texto = await res.text();
    let json: any = null;
    try { json = texto ? JSON.parse(texto) : null; } catch { /* respuesta no-JSON */ }
    if (!res.ok) {
      const detalle = json?.error_message || texto.slice(0, 200) || `HTTP ${res.status}`;
      throw new BadRequestException(`Webpay rechazó la operación: ${detalle}`);
    }
    return json;
  }

  /* Crea la transacción. `buyOrder` y `sessionId` van al máximo de 26 y 61
     caracteres que acepta Transbank. El monto va en pesos enteros. */
  async crear(args: {
    buyOrder: string;
    sessionId: string;
    monto: number;
    returnUrl: string;
  }): Promise<CrearResultado> {
    const monto = Math.round(Number(args.monto) || 0);
    if (monto <= 0) throw new BadRequestException('El monto a pagar debe ser mayor a cero.');
    const json = await this.pedir('POST', '/rswebpaytransaction/api/webpay/v1.2/transactions', {
      buy_order: String(args.buyOrder).slice(0, 26),
      session_id: String(args.sessionId).slice(0, 61),
      amount: monto,
      return_url: args.returnUrl,
    });
    if (!json?.token || !json?.url) {
      throw new BadRequestException('Webpay no devolvió el token de la transacción.');
    }
    return { url: String(json.url), token: String(json.token) };
  }

  /* Confirma la transacción. Solo se considera pagada si `response_code` es 0
     y el estado es AUTHORIZED: cualquier otra cosa es un pago que NO ocurrió. */
  async confirmar(token: string) {
    const t = String(token || '').trim();
    if (!t) throw new BadRequestException('Falta el token de la transacción.');
    const json = await this.pedir('PUT', `/rswebpaytransaction/api/webpay/v1.2/transactions/${encodeURIComponent(t)}`);
    const aprobada = Number(json?.response_code) === 0 && String(json?.status) === 'AUTHORIZED';
    return {
      aprobada,
      monto: Number(json?.amount) || 0,
      buyOrder: String(json?.buy_order || ''),
      autorizacion: String(json?.authorization_code || ''),
      tarjeta: String(json?.card_detail?.card_number || ''),
      estado: String(json?.status || ''),
      crudo: json,
    };
  }

  async estado(token: string) {
    const t = String(token || '').trim();
    if (!t) throw new BadRequestException('Falta el token de la transacción.');
    return await this.pedir('GET', `/rswebpaytransaction/api/webpay/v1.2/transactions/${encodeURIComponent(t)}`);
  }
}
