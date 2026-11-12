import { google } from 'googleapis';
import { BITACORA, CONSOLIDADO, ENCABEZADO_BITACORA, PestanaLeida, Plan, esPestanaDeCategoria, rangoA1 } from './precios-sheet.logica';

/* ── Precios → Google Sheet: acceso al libro (2026-11-12) ────────────────────
   Cliente delgado sobre la API de Google Sheets, detrás de una interfaz para
   poder reemplazarlo por uno en memoria en las pruebas (en el backend local no
   hay cuenta de servicio: GOOGLE_SERVICE_ACCOUNT_JSON solo está en Railway).

   Se entra con la cuenta de servicio SIN suplantar a nadie: el libro tiene que
   estar compartido como «Editor» con el correo de esa cuenta (client_email) y
   la API de Google Sheets activa en su proyecto de Google Cloud. */

/* «Lista de Precios - Jeremías». PRECIOS_SHEET_ID permite apuntar a una copia de prueba. */
export const SHEET_ID_PRECIOS = '1UwOdoOvJ8ZgWudPwvKFgaq3zvsn3RVPULI6KHyVnmoQ';
export const idDelSheet = () => String(process.env.PRECIOS_SHEET_ID || '').trim() || SHEET_ID_PRECIOS;
export const urlDelSheet = () => `https://docs.google.com/spreadsheets/d/${idDelSheet()}/edit`;

export type PestanaMeta = { titulo: string; sheetId: number; filas: number; columnas: number };

export interface ClienteSheet {
  metadatos(): Promise<{ titulo: string; pestanas: PestanaMeta[] }>;
  /* Valores sin formato de cada rango, en el mismo orden. */
  leer(rangos: string[]): Promise<any[][][]>;
  escribir(datos: { rango: string; valores: any[][] }[]): Promise<void>;
  /* Agrega filas al final de la tabla del rango (la bitácora). */
  agregar(rango: string, filas: any[][]): Promise<void>;
  /* Cambios de estructura: pestaña nueva, más filas, copiar formato y fórmulas. */
  lote(requests: any[]): Promise<void>;
}

export function credencialesDeServicio(): { email: string; clave: string } | null {
  const raw = String(process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '').trim();
  if (!raw) return null;
  try {
    const sa = JSON.parse(raw);
    if (!sa?.client_email || !sa?.private_key) return null;
    return { email: String(sa.client_email), clave: String(sa.private_key) };
  } catch {
    return null;
  }
}

const trozos = <T>(lista: T[], n: number): T[][] => {
  const partes: T[][] = [];
  for (let i = 0; i < lista.length; i += n) partes.push(lista.slice(i, i + n));
  return partes;
};

export class ClienteGoogleSheet implements ClienteSheet {
  private api: any = null;

  constructor(private readonly spreadsheetId: string = idDelSheet()) {}

  private sheets() {
    if (this.api) return this.api;
    const cred = credencialesDeServicio();
    if (!cred) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON no está configurado (o no trae client_email / private_key).');
    const auth = new google.auth.JWT({ email: cred.email, key: cred.clave, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
    this.api = google.sheets({ version: 'v4', auth });
    return this.api;
  }

  async metadatos() {
    const { data } = await this.sheets().spreadsheets.get({
      spreadsheetId: this.spreadsheetId,
      fields: 'properties.title,sheets.properties(sheetId,title,gridProperties(rowCount,columnCount))',
    });
    return {
      titulo: String(data?.properties?.title || ''),
      pestanas: ((data?.sheets || []) as any[]).map((s) => ({
        titulo: String(s?.properties?.title || ''),
        sheetId: Number(s?.properties?.sheetId ?? 0),
        filas: Number(s?.properties?.gridProperties?.rowCount ?? 0),
        columnas: Number(s?.properties?.gridProperties?.columnCount ?? 0),
      })),
    };
  }

  async leer(rangos: string[]) {
    if (!rangos.length) return [];
    const salida: any[][][] = [];
    // De a 10 pestañas: la respuesta completa del libro pesa varios MB.
    for (const parte of trozos(rangos, 10)) {
      const { data } = await this.sheets().spreadsheets.values.batchGet({
        spreadsheetId: this.spreadsheetId,
        ranges: parte,
        valueRenderOption: 'UNFORMATTED_VALUE',
        majorDimension: 'ROWS',
      });
      const recibidos = (data?.valueRanges || []) as any[];
      for (let i = 0; i < parte.length; i++) salida.push((recibidos[i]?.values || []) as any[][]);
    }
    return salida;
  }

  async escribir(datos: { rango: string; valores: any[][] }[]) {
    for (const parte of trozos(datos, 400)) {
      await this.sheets().spreadsheets.values.batchUpdate({
        spreadsheetId: this.spreadsheetId,
        requestBody: { valueInputOption: 'RAW', data: parte.map((d) => ({ range: d.rango, values: d.valores })) },
      });
    }
  }

  async agregar(rango: string, filas: any[][]) {
    for (const parte of trozos(filas, 500)) {
      await this.sheets().spreadsheets.values.append({
        spreadsheetId: this.spreadsheetId,
        range: rango,
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        requestBody: { values: parte },
      });
    }
  }

  async lote(requests: any[]) {
    for (const parte of trozos(requests, 200)) {
      await this.sheets().spreadsheets.batchUpdate({ spreadsheetId: this.spreadsheetId, requestBody: { requests: parte } });
    }
  }
}

/* Mensaje entendible de un error de Google (para la pantalla). */
export function explicarErrorGoogle(e: any, cuenta: string | null): string {
  const codigo = Number(e?.code || e?.response?.status || 0);
  const texto = String(e?.response?.data?.error?.message || e?.errors?.[0]?.message || e?.message || e || '');
  if (/has not been used in project|is disabled|SERVICE_DISABLED/i.test(texto)) {
    return 'La API de Google Sheets no está activada en el proyecto de Google Cloud de la cuenta de servicio. Actívala en console.cloud.google.com → APIs y servicios → Biblioteca → «Google Sheets API» → Habilitar.';
  }
  if (codigo === 403 || /does not have permission|PERMISSION_DENIED/i.test(texto)) {
    return `La cuenta de servicio no tiene permiso sobre el Sheet. Compártelo como «Editor» con ${cuenta || 'el correo de la cuenta de servicio'}.`;
  }
  if (codigo === 404 || /not found/i.test(texto)) return 'No se encontró el Sheet: revisa su identificador (PRECIOS_SHEET_ID) y que esté compartido con la cuenta de servicio.';
  if (/invalid_grant|invalid_client|unauthorized_client|DECODER|PEM/i.test(texto)) return `La llave de la cuenta de servicio no sirve (${texto.slice(0, 140)}).`;
  if (codigo === 429 || /quota|rate limit/i.test(texto)) return 'Google frenó las solicitudes por cuota: se reintenta solo en unos minutos.';
  return texto.slice(0, 300) || 'Error desconocido de Google Sheets.';
}

export type LibroLeido = { titulo: string; pestanas: PestanaLeida[]; hayBitacora: boolean; columnas: Map<string, number> };

/* Lee las pestañas de categoría (A…Q) y Consolidado_auto. Con `soloEncabezado`
   trae nada más las 2 primeras filas (chequeo liviano de acceso y estructura). */
export async function leerLibro(cliente: ClienteSheet, soloEncabezado = false): Promise<LibroLeido> {
  const meta = await cliente.metadatos();
  const utiles = meta.pestanas.filter((p) => p.titulo === CONSOLIDADO || esPestanaDeCategoria(p.titulo));
  const valores = await cliente.leer(utiles.map((p) => rangoA1(p.titulo, soloEncabezado ? 'A1:Q2' : 'A1:Q')));
  const pestanas: PestanaLeida[] = utiles.map((p, i) => ({
    titulo: p.titulo,
    sheetId: p.sheetId,
    filasGrilla: p.filas,
    tipo: p.titulo === CONSOLIDADO ? 'consolidado' : 'categoria',
    valores: valores[i] || [],
  }));
  return {
    titulo: meta.titulo,
    pestanas,
    hayBitacora: meta.pestanas.some((p) => p.titulo === BITACORA),
    columnas: new Map(meta.pestanas.map((p) => [p.titulo, p.columnas])),
  };
}

/* Escribe el plan en el libro. Es repetible: si se corta a medias, el plan
   siguiente solo trae lo que falta (las celdas ya iguales no se reescriben y
   un SKU que alcanzó a quedar agregado ya no se agrega otra vez). */
export async function aplicarPlan(cliente: ClienteSheet, plan: Plan, libro: LibroLeido): Promise<void> {
  const porTitulo = new Map(libro.pestanas.map((p) => [p.titulo, p]));
  const estructura: any[] = [];
  const copias: any[] = [];

  // 1) Filas que faltan en la grilla.
  const maxima = new Map<string, number>();
  for (const n of plan.nuevas) maxima.set(n.pestana, Math.max(maxima.get(n.pestana) || 0, n.fila));
  for (const n of plan.nuevasConsolidado) maxima.set(CONSOLIDADO, Math.max(maxima.get(CONSOLIDADO) || 0, n.fila));
  for (const [titulo, fila] of maxima) {
    const p = porTitulo.get(titulo);
    if (p && fila > p.filasGrilla) estructura.push({ appendDimension: { sheetId: p.sheetId, dimension: 'ROWS', length: fila - p.filasGrilla + 20 } });
  }

  // 2) Formato y fórmulas (neto y margen) copiados de la última fila con datos.
  for (const n of plan.nuevas) {
    const p = porTitulo.get(n.pestana);
    if (!p || n.modelo < 3) continue;
    const ancho = Math.min(24, libro.columnas.get(n.pestana) || 24);
    const tramo = (c1: number, c2: number, fila: number) => ({ sheetId: p.sheetId, startRowIndex: fila - 1, endRowIndex: fila, startColumnIndex: c1, endColumnIndex: Math.min(c2, ancho) });
    copias.push({ copyPaste: { source: tramo(0, 24, n.modelo), destination: tramo(0, 24, n.fila), pasteType: 'PASTE_FORMAT' } });
    for (const [c1, c2] of [[9, 11], [12, 14], [15, 17]]) {
      if (c1 >= ancho) continue;
      copias.push({ copyPaste: { source: tramo(c1, c2, n.modelo), destination: tramo(c1, c2, n.fila), pasteType: 'PASTE_FORMULA' } });
    }
  }
  if (estructura.length) await cliente.lote(estructura);
  if (copias.length) await cliente.lote(copias);

  // 3) Valores.
  const datos: { rango: string; valores: any[][] }[] = [];
  for (const e of plan.escrituras) datos.push({ rango: e.rango, valores: [[e.valor]] });
  for (const c of plan.consolidado) datos.push({ rango: c.rango, valores: c.valores });
  for (const n of plan.nuevas) {
    // J, K, M y N son fórmulas: se escribe A…I, L y O por separado.
    datos.push({ rango: rangoA1(n.pestana, `A${n.fila}:I${n.fila}`), valores: [n.valores.slice(0, 9)] });
    if (n.valores[11] !== '') datos.push({ rango: rangoA1(n.pestana, `L${n.fila}`), valores: [[n.valores[11]]] });
    if (n.valores[14] !== '') datos.push({ rango: rangoA1(n.pestana, `O${n.fila}`), valores: [[n.valores[14]]] });
  }
  for (const n of plan.nuevasConsolidado) datos.push({ rango: rangoA1(CONSOLIDADO, `A${n.fila}:Q${n.fila}`), valores: [n.valores] });
  if (datos.length) await cliente.escribir(datos);
}

/* Bitácora «Cambios de precio»: se crea si no existe y se le agregan filas. */
export async function anotarEnBitacora(cliente: ClienteSheet, hayBitacora: boolean, filas: any[][]): Promise<void> {
  if (!filas.length) return;
  if (!hayBitacora) {
    await cliente.lote([{ addSheet: { properties: { title: BITACORA, gridProperties: { rowCount: 1000, columnCount: ENCABEZADO_BITACORA.length, frozenRowCount: 1 } } } }]);
    await cliente.escribir([{ rango: rangoA1(BITACORA, 'A1:J1'), valores: [ENCABEZADO_BITACORA] }]);
  }
  await cliente.agregar(rangoA1(BITACORA, 'A:J'), filas);
}
