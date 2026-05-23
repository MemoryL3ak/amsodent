import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

// DamarIA: asistente de análisis de datos. Recibe una pregunta en lenguaje
// natural, le pide a Claude (Anthropic) que genere consultas SQL de solo
// lectura, las ejecuta de forma segura y devuelve un resumen + datos + un
// gráfico sugerido.

const fetchGlobal: any = (globalThis as any).fetch;

const SYSTEM_PROMPT = `Eres DamarIA, la asistente de análisis de datos de AMSODENT, una empresa chilena de insumos dentales. Respondes preguntas de negocio consultando una base de datos PostgreSQL (Supabase).

ESTILO
- Sé concisa, profesional y directa. Sin preámbulos largos ni rodeos.
- Responde en español (tuteo o impersonal, sin voseo argentino).
- Si te saludan o preguntan algo que no requiere datos, responde brevemente sin consultar la base.

CÓMO CONSULTAS
- Usa la herramienta "consultar_base_datos" para ejecutar consultas SQL.
- Solo lectura (SELECT / WITH). Jamás INSERT, UPDATE, DELETE u otras escrituras.
- Siempre incluye un LIMIT (máximo 1000 filas).
- Dialecto PostgreSQL.
- El esquema de abajo es CONFIABLE: úsalo directamente. NO consultes information_schema salvo que una consulta falle porque una columna no existe.
- Resuelve con UNA sola consulta siempre que sea posible (sé eficiente, evita pasos innecesarios).

ESQUEMA
- licitaciones: cotizaciones/licitaciones. id, id_licitacion, nombre, nombre_entidad, estado (Borrador / Pendiente Aprobación / Adjudicada / Perdida / Cancelada...), tipo_compra, tipo_cliente, monto, total_sin_iva, total_con_iva, fecha_adjudicada, comuna, region, creado_por (email del vendedor), vendedor_nombre, estado_entrega, created_at.
- items_licitacion: ítems de cada cotización: licitacion_id, producto, sku, cantidad, valor_unitario, total, categoria.
- licitacion_documentos: documentos: id, licitacion_id, tipo (orden_compra / guia_despacho / factura...), numero, monto, created_at.
- productos: id, sku, nombre, categoria, marca, formato, costo, lista1, lista2, lista3, estado.
- clientes: id, rut, nombre, region, comuna, tipo_cliente.
- profiles: usuarios del sistema: id, email, nombre, rol.

RESPUESTA FINAL
Cuando tengas los datos, responde EXCLUSIVAMENTE con dos bloques marcados, sin texto extra antes ni después:

##RESUMEN##
respuesta breve y clara en español, con las cifras clave. Puedes usar **negrita** y listas con guiones (-). No uses encabezados con #. Máximo 5-6 líneas.

##GRAFICO##
{"tipo":"barra|linea|torta|ninguno","titulo":"título corto","campoX":"columna del eje X","camposY":["columnas numéricas"]}

Genera un gráfico SIEMPRE que los datos tengan una categoría y un valor numérico. Usa "barra" para comparar categorías, "linea" para evolución en el tiempo, "torta" para proporciones de un total y "ninguno" solo cuando sea imposible graficar. campoX y camposY deben coincidir EXACTAMENTE con las columnas que devuelve tu consulta SELECT.`;

const HERRAMIENTA_SQL = {
  name: 'consultar_base_datos',
  description:
    'Ejecuta una consulta SQL de solo lectura (SELECT o WITH) sobre la base de datos PostgreSQL y devuelve las filas resultantes en JSON.',
  input_schema: {
    type: 'object',
    properties: {
      sql: {
        type: 'string',
        description: 'La consulta SQL SELECT a ejecutar (dialecto PostgreSQL).',
      },
    },
    required: ['sql'],
  },
};

export type GraficoDamarIA = {
  tipo: string;
  titulo: string;
  campoX: string;
  camposY: string[];
};

export type RespuestaDamarIA = {
  resumen: string;
  grafico: GraficoDamarIA | null;
  sql: string;
  datos: any[];
};

@Injectable()
export class IaService {
  private readonly logger = new Logger(IaService.name);

  constructor(private supabase: SupabaseService) {}

  configurada(): boolean {
    return Boolean((process.env.ANTHROPIC_API_KEY || '').trim());
  }

  private get model(): string {
    // Haiku 4.5 por default: mucho más rápido que Sonnet para el flujo
    // text-to-SQL + resumen breve, que es lo que hace DamarIA. Si se quiere
    // calidad mayor se puede sobreescribir con DAMARIA_MODEL en el .env del
    // backend (por ejemplo claude-sonnet-4-6 o claude-opus-4-7).
    return (process.env.DAMARIA_MODEL || 'claude-haiku-4-5-20251001').trim();
  }

  // Configuración de system + tools con prompt caching activado. Anthropic
  // cachea el bloque marcado con cache_control durante 5 minutos: las
  // llamadas subsiguientes (incluida la segunda llamada dentro de un mismo
  // tool-use loop) reutilizan el prompt cacheado y bajan latencia.
  private get systemConCache() {
    return [
      {
        type: 'text',
        text: SYSTEM_PROMPT,
        cache_control: { type: 'ephemeral' },
      },
    ];
  }
  private get toolsConCache() {
    return [{ ...HERRAMIENTA_SQL, cache_control: { type: 'ephemeral' } }];
  }

  // Versión no-streaming (usada por endpoints que no quieran SSE). Internamente
  // delega en consultarStream juntando todos los eventos.
  async consultar(pregunta: string): Promise<RespuestaDamarIA> {
    let resumen = '';
    let grafico: GraficoDamarIA | null = null;
    let sql = '';
    let datos: any[] = [];
    let error: string | null = null;

    await this.consultarStream(pregunta, (evt) => {
      if (evt.tipo === 'resumen-delta') resumen += evt.texto;
      else if (evt.tipo === 'done') {
        if (typeof evt.resumen === 'string') resumen = evt.resumen;
        grafico = evt.grafico ?? null;
        sql = evt.sql || '';
        datos = evt.datos || [];
      } else if (evt.tipo === 'error') {
        error = evt.mensaje || 'Error desconocido';
      }
    });

    if (error) throw new BadRequestException(error);
    return { resumen, grafico, sql, datos };
  }

  // Variante streaming. Emite eventos a medida que avanza:
  //   { tipo: 'estado',         texto: '...' }
  //   { tipo: 'resumen-delta',  texto: '...' }
  //   { tipo: 'done',           resumen, grafico, sql, datos }
  //   { tipo: 'error',          mensaje }
  async consultarStream(
    pregunta: string,
    emit: (evento: any) => void,
  ): Promise<void> {
    if (!this.configurada()) {
      emit({
        tipo: 'error',
        mensaje:
          'DamarIA no está configurada: falta la API key de Anthropic en el servidor.',
      });
      return;
    }

    const messages: any[] = [{ role: 'user', content: pregunta }];
    let ultimoSql = '';
    let ultimasFilas: any[] = [];
    const t0 = Date.now();
    this.logger.log(
      `consultarStream · modelo=${this.model} · pregunta="${pregunta.slice(0, 60)}..."`,
    );

    let textoEmitido = '';

    for (let iter = 0; iter < 4; iter++) {
      let resp: any;
      try {
        resp = await this.llamarClaudeStream(
          {
            model: this.model,
            max_tokens: 1500,
            system: this.systemConCache,
            tools: this.toolsConCache,
            messages,
            stream: true,
          },
          (_delta, textoCompleto) => {
            // Emite incrementalmente solo el bloque ##RESUMEN##.
            const resumenActual = this.extraerResumen(textoCompleto);
            if (resumenActual.length > textoEmitido.length) {
              const nuevo = resumenActual.slice(textoEmitido.length);
              textoEmitido = resumenActual;
              emit({ tipo: 'resumen-delta', texto: nuevo });
            }
          },
        );
      } catch (e: any) {
        emit({ tipo: 'error', mensaje: e?.message || 'Error al llamar a la IA.' });
        return;
      }

      messages.push({ role: 'assistant', content: resp.content });

      if (resp.stop_reason === 'tool_use') {
        emit({ tipo: 'estado', texto: 'Consultando la base de datos…' });
        const resultados: any[] = [];
        for (const bloque of resp.content || []) {
          if (bloque.type !== 'tool_use') continue;
          const sql = String(bloque.input?.sql || '').trim();
          ultimoSql = sql;
          try {
            ultimasFilas = await this.ejecutarSQL(sql);
            resultados.push({
              type: 'tool_result',
              tool_use_id: bloque.id,
              content: JSON.stringify(ultimasFilas.slice(0, 200)),
            });
          } catch (e: any) {
            resultados.push({
              type: 'tool_result',
              tool_use_id: bloque.id,
              is_error: true,
              content: `Error al ejecutar la consulta: ${e?.message || e}`,
            });
          }
        }
        messages.push({ role: 'user', content: resultados });
        emit({ tipo: 'estado', texto: 'Redactando respuesta…' });
        continue;
      }

      // Respuesta final.
      const texto = (resp.content || [])
        .filter((b: any) => b.type === 'text')
        .map((b: any) => b.text)
        .join('\n')
        .trim();
      const { resumen, grafico } = this.parsearRespuestaFinal(texto);
      this.logger.log(
        `consultarStream listo · ${Date.now() - t0}ms · iter=${iter + 1} · filas=${ultimasFilas.length}`,
      );
      emit({
        tipo: 'done',
        resumen,
        grafico,
        sql: ultimoSql,
        datos: ultimasFilas,
      });
      return;
    }

    emit({
      tipo: 'error',
      mensaje: 'DamarIA no pudo completar la consulta (demasiados pasos).',
    });
  }

  private async llamarClaude(body: any): Promise<any> {
    if (typeof fetchGlobal !== 'function') {
      throw new BadRequestException(
        'El servidor no soporta fetch nativo (se requiere Node 18 o superior).',
      );
    }
    let res: any;
    try {
      res = await fetchGlobal('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': (process.env.ANTHROPIC_API_KEY || '').trim(),
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
      });
    } catch (e: any) {
      throw new BadRequestException(
        `No se pudo contactar la API de IA: ${e?.message || e}`,
      );
    }
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      this.logger.error(`Anthropic API ${res.status}: ${String(txt).slice(0, 400)}`);
      let detalle = '';
      try {
        detalle = JSON.parse(txt)?.error?.message || '';
      } catch {
        /* sin detalle estructurado */
      }
      throw new BadRequestException(
        detalle
          ? `DamarIA no pudo responder: ${detalle}`
          : `La API de IA respondió con error ${res.status}.`,
      );
    }
    return res.json();
  }

  // Llama a Claude con stream: true y entrega el contenido acumulado al
  // terminar, invocando onTextDelta(delta, textoCompletoAcumulado) por cada
  // chunk de texto que llega de la red.
  private async llamarClaudeStream(
    body: any,
    onTextDelta: (delta: string, textoCompleto: string) => void,
  ): Promise<{ content: any[]; stop_reason: string | null }> {
    if (typeof fetchGlobal !== 'function') {
      throw new BadRequestException(
        'El servidor no soporta fetch nativo (se requiere Node 18 o superior).',
      );
    }
    let res: any;
    try {
      res = await fetchGlobal('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': (process.env.ANTHROPIC_API_KEY || '').trim(),
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
          accept: 'text/event-stream',
        },
        body: JSON.stringify({ ...body, stream: true }),
      });
    } catch (e: any) {
      throw new BadRequestException(
        `No se pudo contactar la API de IA: ${e?.message || e}`,
      );
    }
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      this.logger.error(
        `Anthropic API ${res.status}: ${String(txt).slice(0, 400)}`,
      );
      let detalle = '';
      try {
        detalle = JSON.parse(txt)?.error?.message || '';
      } catch {
        /* sin detalle */
      }
      throw new BadRequestException(
        detalle
          ? `DamarIA no pudo responder: ${detalle}`
          : `La API de IA respondió con error ${res.status}.`,
      );
    }

    const reader = res.body?.getReader?.();
    if (!reader) {
      throw new BadRequestException('La API de IA no devolvió un stream.');
    }
    const decoder = new TextDecoder();
    let buffer = '';
    const bloques: any[] = [];
    let stopReason: string | null = null;
    let textoAcumulado = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const eventos = buffer.split('\n\n');
      buffer = eventos.pop() || '';

      for (const ev of eventos) {
        const linea = ev
          .split('\n')
          .find((l) => l.startsWith('data: '));
        if (!linea) continue;
        const json = linea.slice(6).trim();
        if (!json || json === '[DONE]') continue;
        let data: any;
        try {
          data = JSON.parse(json);
        } catch {
          continue;
        }

        switch (data.type) {
          case 'content_block_start': {
            const cb = data.content_block || {};
            const idx = data.index ?? bloques.length;
            if (cb.type === 'text') {
              bloques[idx] = { type: 'text', text: '' };
            } else if (cb.type === 'tool_use') {
              bloques[idx] = {
                type: 'tool_use',
                id: cb.id,
                name: cb.name,
                input: {},
                _json: '',
              };
            } else {
              bloques[idx] = { type: cb.type, ...cb };
            }
            break;
          }
          case 'content_block_delta': {
            const idx = data.index;
            const blk = bloques[idx];
            if (!blk) break;
            if (data.delta?.type === 'text_delta') {
              const t = String(data.delta.text || '');
              blk.text = (blk.text || '') + t;
              textoAcumulado += t;
              onTextDelta(t, textoAcumulado);
            } else if (data.delta?.type === 'input_json_delta') {
              blk._json = (blk._json || '') + String(data.delta.partial_json || '');
            }
            break;
          }
          case 'content_block_stop': {
            const idx = data.index;
            const blk = bloques[idx];
            if (blk?.type === 'tool_use' && blk._json) {
              try {
                blk.input = JSON.parse(blk._json);
              } catch {
                /* json incompleto — se ignora */
              }
              delete blk._json;
            }
            break;
          }
          case 'message_delta': {
            if (data.delta?.stop_reason) stopReason = data.delta.stop_reason;
            break;
          }
          case 'error': {
            throw new BadRequestException(
              data.error?.message || 'Error de la API de IA.',
            );
          }
        }
      }
    }

    return { content: bloques.filter(Boolean), stop_reason: stopReason };
  }

  private async ejecutarSQL(sql: string): Promise<any[]> {
    let limpio = String(sql || '').trim().replace(/;\s*$/, '');
    if (!/^\s*(select|with)\b/i.test(limpio)) {
      throw new Error('DamarIA solo puede ejecutar consultas SELECT.');
    }
    if (limpio.includes(';')) {
      throw new Error('No se permiten múltiples sentencias SQL.');
    }
    if (!/\blimit\b/i.test(limpio)) {
      limpio += ' limit 1000';
    }
    const { data, error } = await this.supabase
      .getClient()
      .rpc('damaria_sql', { consulta: limpio });
    if (error) throw new Error(error.message);
    return Array.isArray(data) ? data : [];
  }

  // Parsea el formato "##RESUMEN##...##GRAFICO##{json}".
  // Fallback: si no encuentra los marcadores, intenta el viejo formato JSON
  // por compatibilidad con respuestas que todavía vengan en JSON puro.
  private parsearRespuestaFinal(texto: string): {
    resumen: string;
    grafico: GraficoDamarIA | null;
  } {
    const crudo = (texto || '').trim();

    const resumen = this.extraerResumen(crudo);
    const idxG = crudo.indexOf('##GRAFICO##');
    let grafico: GraficoDamarIA | null = null;
    if (idxG !== -1) {
      const rawJson = crudo.slice(idxG + '##GRAFICO##'.length).trim();
      const i = rawJson.indexOf('{');
      const j = rawJson.lastIndexOf('}');
      if (i >= 0 && j > i) {
        try {
          const g = JSON.parse(rawJson.slice(i, j + 1));
          if (g && g.tipo && g.tipo !== 'ninguno') {
            grafico = {
              tipo: String(g.tipo),
              titulo: String(g.titulo || ''),
              campoX: String(g.campoX || ''),
              camposY: Array.isArray(g.camposY) ? g.camposY.map(String) : [],
            };
          }
        } catch {
          /* gráfico inválido — se omite */
        }
      }
    }

    // Compatibilidad: si el modelo respondió en JSON puro (sin marcadores),
    // intentamos parsearlo igual.
    if (!resumen && grafico === null) {
      const fence = crudo.match(/```(?:json)?\s*([\s\S]*?)```/i);
      const fuente = fence ? fence[1].trim() : crudo;
      const i = fuente.indexOf('{');
      const j = fuente.lastIndexOf('}');
      if (i >= 0 && j > i) {
        try {
          const obj = JSON.parse(fuente.slice(i, j + 1));
          const g = obj?.grafico;
          const gOk: GraficoDamarIA | null =
            g && g.tipo && g.tipo !== 'ninguno'
              ? {
                  tipo: String(g.tipo),
                  titulo: String(g.titulo || ''),
                  campoX: String(g.campoX || ''),
                  camposY: Array.isArray(g.camposY) ? g.camposY.map(String) : [],
                }
              : null;
          return { resumen: String(obj?.resumen || crudo), grafico: gOk };
        } catch {
          /* fallthrough */
        }
      }
    }

    return { resumen: resumen || crudo, grafico };
  }

  // Extrae el bloque del resumen — usable tanto al final como en streaming
  // (mientras el modelo todavía está generando, devuelve lo que ya escribió).
  private extraerResumen(texto: string): string {
    const t = String(texto || '');
    const start = t.indexOf('##RESUMEN##');
    if (start === -1) return '';
    const after = t.slice(start + '##RESUMEN##'.length);
    const end = after.indexOf('##GRAFICO##');
    return (end === -1 ? after : after.slice(0, end)).trim();
  }
}
