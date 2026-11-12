/* ── Precios → Google Sheet: lógica pura (2026-11-12) ────────────────────────
   Sin red ni base de datos, para poder probarla contra una copia del libro.

   El libro «Lista de Precios» tiene una pestaña por categoría. En cada una el
   encabezado ocupa 2 filas y los datos parten en la fila 3:
     A SKU · C producto · D categoría · E marca · F formato · H costo ·
     I/J/K lista 1 (bruto / neto / margen) · L/M/N lista 2 · O/P/Q lista 3.
   Solo se digitan H, I, L y O: el neto (=bruto/1,19) y el margen son fórmulas.
   La plataforma guarda los precios NETOS, así que al libro va el bruto
   (neto × 1,19, redondeado). `Consolidado_auto` es una copia sin fórmulas
   (encabezado de 1 fila, datos desde la fila 2) con las mismas columnas A…Q:
   ahí se escriben los valores ya calculados.

   Lista 3: en la plataforma casi nunca se guarda, se calcula (lista 2 × 1,08).
   En el libro la columna O está vacía salvo en un puñado de filas; para no
   llenar miles de celdas, la lista 3 solo se escribe cuando el producto tiene
   una lista 3 propia guardada o cuando la fila del libro ya trae una. */

export const IVA = 1.19;
export const FACTOR_LISTA_3 = 1.08;
export const BITACORA = 'Cambios de precio';
export const CONSOLIDADO = 'Consolidado_auto';
export const ENCABEZADO_BITACORA = ['Fecha', 'SKU', 'Producto', 'Precio', 'Antes (neto)', 'Ahora (neto)', 'Ahora (bruto)', 'Quién', 'Origen', 'Dónde quedó'];
/* Pestañas del libro que no son de categoría. */
const FUERA = new Set(['consolidado auto', 'consolidado', 'tabla dinamica 2', 'categorias', 'no encontrado', 'cambios de precio']);

export const CAMPOS = ['costo', 'lista1', 'lista2', 'lista3'] as const;
export type Campo = (typeof CAMPOS)[number];
export const NOMBRE_CAMPO: Record<Campo, string> = { costo: 'Costo', lista1: 'Lista 1', lista2: 'Lista 2', lista3: 'Lista 3' };
/* Columna (base 0) donde se digita cada precio. */
const COLUMNA: Record<Campo, number> = { costo: 7, lista1: 8, lista2: 11, lista3: 14 };
const LETRA = (c: number) => String.fromCharCode(65 + c);

export type ProductoPrecio = {
  id: number;
  sku: string | null;
  nombre: string | null;
  categoria: string | null;
  marca?: string | null;
  formato?: string | null;
  estado?: string | null;
  costo: number | null;
  lista1: number | null;
  lista2: number | null;
  lista3: number | null;
};

export type PestanaLeida = {
  titulo: string;
  sheetId: number;
  /* Filas de la grilla (para saber si hay que agrandarla antes de agregar). */
  filasGrilla: number;
  tipo: 'categoria' | 'consolidado';
  /* Valores desde la fila 1, columnas A…Q, sin formato. */
  valores: any[][];
};

export type Escritura = {
  rango: string;
  valor: number | string;
  pestana: string;
  fila: number;
  sku: string;
  producto_id: number;
  campo: Campo;
  /* Lo que había en la celda y lo que queda, en neto (para la bitácora y la simulación). */
  antes_neto: number | null;
  ahora_neto: number | null;
};

/* `modelo`: última fila con datos de la pestaña; de ahí se copian el formato y las fórmulas.
   `valores`: columnas A…O; J, K, M y N van vacías porque son fórmulas (no se escriben). */
export type FilaNueva = { pestana: string; fila: number; modelo: number; producto: ProductoPrecio; valores: (number | string)[] };
/* `reintentable`: el problema es del libro (un encabezado movido), no del producto: se vuelve a intentar. */
export type Omitido = { producto_id: number; sku: string | null; nombre: string | null; motivo: string; reintentable?: boolean };

export type Plan = {
  escrituras: Escritura[];
  /* Valores (sin fórmulas) para las mismas filas en Consolidado_auto. */
  consolidado: { rango: string; valores: (number | string)[][] }[];
  nuevas: FilaNueva[];
  nuevasConsolidado: { fila: number; valores: (number | string)[] }[];
  omitidos: Omitido[];
  /* Pestañas cuyo encabezado no es el esperado: no se tocan. */
  pestanasConProblema: { pestana: string; motivo: string }[];
  /* Dónde quedó cada producto (para el mensaje de la bitácora y de la pantalla). */
  destino: Map<number, string>;
  sinCambios: number;
};

export const normSku = (v: any) => String(v ?? '').replace(/\s+/g, '').toUpperCase();
export const claveTexto = (v: any) =>
  String(v ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

export const esPestanaDeCategoria = (titulo: string) => !FUERA.has(claveTexto(titulo));

/* Número de una celda del libro: acepta el número tal cual o un texto «$ 3.900». */
export function numeroDeCelda(v: any): number | null {
  if (v === '' || v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v).replace(/[$\s]/g, '');
  if (!s) return null;
  const limpio = /,\d{1,2}$/.test(s) ? s.replace(/\./g, '').replace(',', '.') : s.replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.');
  const n = Number(limpio);
  return Number.isFinite(n) ? n : null;
}

const positivo = (v: any): number | null => {
  const n = v === null || v === undefined || v === '' ? NaN : Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

export const brutoDeNeto = (neto: number) => Math.round(neto * IVA);
export const netoDeBruto = (bruto: number) => Math.round(bruto / IVA);

/* Lista 3 que usa la plataforma: la guardada o, si no hay, lista 2 × 1,08. */
export function lista3Efectiva(p: { lista2: any; lista3: any }): number | null {
  const propia = positivo(p.lista3);
  if (propia) return propia;
  const base = positivo(p.lista2);
  return base ? Math.round(base * FACTOR_LISTA_3) : null;
}

export function rangoA1(pestana: string, celda: string) {
  return `'${pestana.replace(/'/g, "''")}'!${celda}`;
}

/* ¿El encabezado es el que esperamos? Si alguien movió columnas, no se escribe. */
export function problemaDeEncabezado(p: PestanaLeida): string | null {
  const f1 = (p.valores[0] || []).map(claveTexto);
  const f2 = (p.valores[1] || []).map(claveTexto);
  const brutos = p.tipo === 'consolidado' ? f1 : f2;
  if (!String(f1[7] || '').includes('costo')) return 'la columna H ya no dice «COSTO»';
  for (const c of [8, 11, 14]) {
    if (!String(brutos[c] || '').includes('bruto')) return `la columna ${LETRA(c)} ya no dice «PRECIO VTA BRUTO»`;
  }
  if (p.tipo === 'categoria' && !String(f1[0] || '').includes('sku')) return 'la columna A ya no dice «SKU»';
  return null;
}

type Ubicacion = { pestana: PestanaLeida; fila: number; celdas: any[] };

/* Índice SKU → filas donde aparece (un SKU puede estar repetido entre pestañas). */
export function indexar(pestanas: PestanaLeida[]) {
  const porSku = new Map<string, Ubicacion[]>();
  const consolidado = new Map<string, Ubicacion[]>();
  const ultima = new Map<string, number>();
  const problemas: { pestana: string; motivo: string }[] = [];
  const porCategoria = new Map<string, PestanaLeida>();
  /* SKU que están en una pestaña con el encabezado cambiado: ni se escriben ni se agregan en otra. */
  const bloqueados = new Map<string, string>();
  for (const p of pestanas) {
    const motivo = problemaDeEncabezado(p);
    if (motivo) {
      problemas.push({ pestana: p.titulo, motivo });
      if (p.tipo === 'categoria') {
        for (const celdas of p.valores) {
          const sku = normSku(celdas?.[0]);
          if (sku) bloqueados.set(sku, p.titulo);
        }
      }
      continue;
    }
    const desde = p.tipo === 'consolidado' ? 1 : 2;
    const destino = p.tipo === 'consolidado' ? consolidado : porSku;
    if (p.tipo === 'categoria') porCategoria.set(claveTexto(p.titulo), p);
    let ultimaConDatos = desde; // fila (base 1) de la última con algo digitado
    for (let i = desde; i < p.valores.length; i++) {
      const celdas = p.valores[i] || [];
      // Columnas que se digitan (A…I, L y O): las fórmulas de relleno no cuentan.
      const digitado = [0, 1, 2, 3, 4, 5, 6, 7, 8, 11, 14].some((c) => celdas[c] !== undefined && celdas[c] !== null && String(celdas[c]).trim() !== '' && !(c >= 7 && Number(celdas[c]) === 0));
      if (digitado) ultimaConDatos = i + 1;
      const sku = normSku(celdas[0]);
      if (!sku) continue;
      const lista = destino.get(sku) || [];
      lista.push({ pestana: p, fila: i + 1, celdas });
      destino.set(sku, lista);
    }
    ultima.set(p.titulo, ultimaConDatos);
  }
  return { porSku, consolidado, ultima, problemas, porCategoria, bloqueados };
}

const igualCosto = (celda: number | null, valor: number) => celda != null && Math.abs(celda - valor) <= 1;
/* Un bruto del libro «es» el neto de la plataforma si al dividirlo por 1,19 da ese neto (± $1). */
const igualLista = (celda: number | null, neto: number) => celda != null && (Math.abs(celda / IVA - neto) <= 1 || celda === brutoDeNeto(neto));
const dosDecimales = (n: number) => Math.round(n * 100) / 100;
const margen = (costo: number | null, neto: number | null) => (costo != null && neto ? Math.round((1 - costo / neto) * 10000) / 10000 : '');

/* Bloque H…Q de Consolidado_auto a partir de lo que queda en la pestaña. */
function bloqueConsolidado(costo: number | null, b1: number | null, b2: number | null, b3: number | null): (number | string)[] {
  const trio = (b: number | null) => (b ? [b, netoDeBruto(b), margen(costo, b / IVA)] : [0, 0, '']);
  return [costo ?? '', ...trio(b1), ...trio(b2), ...trio(b3)];
}

export type Pedido = { producto: ProductoPrecio; campos: Campo[] };

/* Arma lo que hay que escribir.
   · `borrarVacios`: un precio que la plataforma dejó en 0 vacía la celda (cambio
     hecho a propósito). En la nivelación va en false: un precio que la
     plataforma no tiene nunca borra el del libro.
   · `agregarFaltantes`: los SKU que no están en ninguna pestaña se agregan al
     final de la pestaña de su categoría.
   · `seguirLista3` (por defecto sí): al escribir la lista 2, la lista 3 de la
     fila la sigue cuando la plataforma la calcula. En la nivelación va en
     false: ahí la lista 3 solo se toca si la persona la eligió. */
export function planificar(pedidos: Pedido[], pestanas: PestanaLeida[], opciones: { borrarVacios: boolean; agregarFaltantes: boolean; seguirLista3?: boolean }): Plan {
  const idx = indexar(pestanas);
  const plan: Plan = { escrituras: [], consolidado: [], nuevas: [], nuevasConsolidado: [], omitidos: [], pestanasConProblema: idx.problemas, destino: new Map(), sinCambios: 0 };
  const siguiente = new Map<string, number>();
  const proxima = (titulo: string) => {
    const fila = (siguiente.get(titulo) ?? idx.ultima.get(titulo) ?? 2) + 1;
    siguiente.set(titulo, fila);
    return fila;
  };
  const hayConsolidado = pestanas.some((p) => p.tipo === 'consolidado') && !idx.problemas.some((x) => x.pestana === CONSOLIDADO);
  const vistos = new Set<string>();

  for (const { producto: p, campos } of pedidos) {
    const sku = normSku(p.sku);
    const omitir = (motivo: string) => plan.omitidos.push({ producto_id: p.id, sku: p.sku, nombre: p.nombre, motivo });
    if (!sku) {
      omitir('No tiene SKU: los transitorios no van al Sheet.');
      continue;
    }
    if (vistos.has(sku)) {
      omitir('Hay otro producto con el mismo SKU: se envió el primero.');
      continue;
    }
    vistos.add(sku);
    const costo = positivo(p.costo);
    const netos: Record<Campo, number | null> = { costo: costo == null ? null : dosDecimales(costo), lista1: positivo(p.lista1), lista2: positivo(p.lista2), lista3: lista3Efectiva(p) };
    const ubicaciones = idx.porSku.get(sku) || [];

    if (!ubicaciones.length) {
      const trabada = idx.bloqueados.get(sku);
      if (trabada) {
        plan.omitidos.push({ producto_id: p.id, sku: p.sku, nombre: p.nombre, motivo: `Está en la pestaña «${trabada}», que cambió de estructura: no se escribe hasta que se corrija.`, reintentable: true });
        continue;
      }
      if (!opciones.agregarFaltantes) {
        omitir('Su SKU no está en el Sheet.');
        continue;
      }
      if (String(p.estado || '').trim().toLowerCase() === 'inactivo') {
        omitir('Está inactivo y no figura en el Sheet: no se agrega.');
        continue;
      }
      const pestana = idx.porCategoria.get(claveTexto(p.categoria));
      if (!pestana) {
        omitir(p.categoria ? `Su SKU no está en el Sheet y la categoría «${p.categoria}» no tiene pestaña.` : 'Su SKU no está en el Sheet y el producto no tiene categoría.');
        continue;
      }
      const b = (n: number | null) => (n ? brutoDeNeto(n) : '');
      const b3 = positivo(p.lista3) ? b(netos.lista3) : '';
      const fila = proxima(pestana.titulo);
      // A…O: lo que se digita. Neto y margen (J, K, M, N, P, Q) se copian como fórmula de la fila anterior.
      const valores: (number | string)[] = [sku, '', p.nombre || '', p.categoria || '', p.marca || '', p.formato || '', '', netos.costo ?? '', b(netos.lista1), '', '', b(netos.lista2), '', '', b3];
      plan.nuevas.push({ pestana: pestana.titulo, fila, modelo: idx.ultima.get(pestana.titulo) ?? 3, producto: p, valores });
      plan.destino.set(p.id, `Agregado al final de «${pestana.titulo}» (fila ${fila})`);
      if (hayConsolidado && !idx.consolidado.has(sku)) {
        const bloque = bloqueConsolidado(netos.costo, b(netos.lista1) || null, b(netos.lista2) || null, b3 || null);
        plan.nuevasConsolidado.push({ fila: proxima(CONSOLIDADO), valores: [sku, '', p.nombre || '', p.categoria || '', p.marca || '', p.formato || '', '', ...bloque] });
      }
      continue;
    }

    let escribio = false;
    let quedaPrimera: Record<Campo, number | null> | null = null;
    for (const u of ubicaciones) {
      const actual = { costo: numeroDeCelda(u.celdas[7]), lista1: numeroDeCelda(u.celdas[8]), lista2: numeroDeCelda(u.celdas[11]), lista3: numeroDeCelda(u.celdas[14]) };
      const queda = { ...actual };
      const pedir = new Set<Campo>(campos);
      // La lista 3 sigue a la lista 2 cuando la fila ya la tiene digitada.
      if (opciones.seguirLista3 !== false && pedir.has('lista2') && !positivo(p.lista3) && actual.lista3) pedir.add('lista3');
      for (const campo of CAMPOS) {
        if (!pedir.has(campo)) continue;
        const neto = netos[campo];
        const celda = actual[campo];
        if (campo === 'lista3' && !positivo(p.lista3) && !celda) continue; // calculada y la fila no la usa
        let valor: number | string;
        if (neto == null) {
          if (!opciones.borrarVacios || !celda) continue;
          valor = '';
        } else if (campo === 'costo') {
          if (igualCosto(celda, neto)) continue;
          valor = neto;
        } else {
          if (igualLista(celda, neto)) continue;
          valor = brutoDeNeto(neto);
        }
        plan.escrituras.push({
          rango: rangoA1(u.pestana.titulo, `${LETRA(COLUMNA[campo])}${u.fila}`),
          valor,
          pestana: u.pestana.titulo,
          fila: u.fila,
          sku,
          producto_id: p.id,
          campo,
          antes_neto: celda == null ? null : campo === 'costo' ? celda : netoDeBruto(celda),
          ahora_neto: neto,
        });
        queda[campo] = valor === '' ? null : Number(valor);
        escribio = true;
      }
      if (!quedaPrimera) quedaPrimera = queda;
    }
    // La copia sin fórmulas se deja como queda la primera fila del SKU.
    if (escribio && hayConsolidado && quedaPrimera) {
      for (const c of idx.consolidado.get(sku) || []) {
        plan.consolidado.push({ rango: rangoA1(CONSOLIDADO, `H${c.fila}:Q${c.fila}`), valores: [bloqueConsolidado(quedaPrimera.costo, quedaPrimera.lista1, quedaPrimera.lista2, quedaPrimera.lista3)] });
      }
    }
    plan.destino.set(p.id, ubicaciones.map((u) => `«${u.pestana.titulo}» fila ${u.fila}`).join(' y '));
    if (!escribio) plan.sinCambios++;
  }
  return plan;
}

/* Resumen del plan para la pantalla (y para la huella que amarra «Simular» con «Enviar»). */
export function resumenDePlan(plan: Plan) {
  const porCampo: Record<string, number> = {};
  const porPestana: Record<string, number> = {};
  const productos = new Set<number>();
  for (const e of plan.escrituras) {
    porCampo[e.campo] = (porCampo[e.campo] || 0) + 1;
    porPestana[e.pestana] = (porPestana[e.pestana] || 0) + 1;
    productos.add(e.producto_id);
  }
  return {
    celdas: plan.escrituras.length,
    productos: productos.size,
    por_campo: porCampo,
    por_pestana: porPestana,
    agregados: plan.nuevas.length,
    omitidos: plan.omitidos.length,
    sin_cambios: plan.sinCambios,
    pestanas_con_problema: plan.pestanasConProblema,
  };
}
