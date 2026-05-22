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
Cuando tengas los datos, tu mensaje final debe ser ÚNICAMENTE un objeto JSON válido (sin texto antes ni después, sin bloques de código):
{
  "resumen": "respuesta breve y clara en español, con las cifras clave. Puedes usar **negrita** y listas con guiones (-). No uses encabezados con #.",
  "grafico": {
    "tipo": "barra" | "linea" | "torta" | "ninguno",
    "titulo": "título corto del gráfico",
    "campoX": "nombre exacto de la columna para las etiquetas / eje X",
    "camposY": ["nombre(s) exacto(s) de columna(s) numérica(s) a graficar"]
  }
}
Genera un gráfico SIEMPRE que los datos tengan una categoría y un valor numérico. Usa "barra" para comparar categorías, "linea" para evolución en el tiempo, "torta" para proporciones de un total y "ninguno" solo cuando sea imposible graficar (un único número, texto puro). campoX y camposY deben coincidir EXACTAMENTE con las columnas que devuelve tu consulta SELECT.`;

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
    return (process.env.DAMARIA_MODEL || 'claude-sonnet-4-6').trim();
  }

  async consultar(pregunta: string): Promise<RespuestaDamarIA> {
    if (!this.configurada()) {
      throw new BadRequestException(
        'DamarIA no está configurada: falta la API key de Anthropic en el servidor.',
      );
    }

    const messages: any[] = [{ role: 'user', content: pregunta }];
    let ultimoSql = '';
    let ultimasFilas: any[] = [];

    for (let iter = 0; iter < 6; iter++) {
      const resp = await this.llamarClaude({
        model: this.model,
        max_tokens: 2500,
        system: SYSTEM_PROMPT,
        tools: [HERRAMIENTA_SQL],
        messages,
      });

      messages.push({ role: 'assistant', content: resp.content });

      if (resp.stop_reason === 'tool_use') {
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
        continue;
      }

      // Respuesta final (sin más herramientas)
      const texto = (resp.content || [])
        .filter((b: any) => b.type === 'text')
        .map((b: any) => b.text)
        .join('\n')
        .trim();
      const { resumen, grafico } = this.parsearRespuestaFinal(texto);
      return { resumen, grafico, sql: ultimoSql, datos: ultimasFilas };
    }

    throw new BadRequestException(
      'DamarIA no pudo completar la consulta (demasiados pasos).',
    );
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

  private parsearRespuestaFinal(texto: string): {
    resumen: string;
    grafico: GraficoDamarIA | null;
  } {
    let crudo = (texto || '').trim();
    const fence = crudo.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) crudo = fence[1].trim();
    const i = crudo.indexOf('{');
    const j = crudo.lastIndexOf('}');
    if (i >= 0 && j > i) {
      try {
        const obj = JSON.parse(crudo.slice(i, j + 1));
        const g = obj?.grafico;
        const grafico: GraficoDamarIA | null =
          g && g.tipo && g.tipo !== 'ninguno'
            ? {
                tipo: String(g.tipo),
                titulo: String(g.titulo || ''),
                campoX: String(g.campoX || ''),
                camposY: Array.isArray(g.camposY) ? g.camposY.map(String) : [],
              }
            : null;
        return { resumen: String(obj?.resumen || texto), grafico };
      } catch {
        /* cae al texto plano */
      }
    }
    return { resumen: texto, grafico: null };
  }
}
