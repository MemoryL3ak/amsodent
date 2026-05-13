#!/usr/bin/env node
/**
 * Convierte un CSV (separado por ;) → INSERT bulk SQL que crea productos
 * nuevos en public.productos.
 *
 * Uso:
 *   node scripts/csv-a-sql-nuevos-productos.mjs "C:/ruta/al/archivo.csv"
 *
 * Layout esperado (0-indexed):
 *   col 0  = sku
 *   col 1  = nombre
 *   col 2  = categoria
 *   col 3  = marca           (puede ir vacío)
 *   col 4  = presnetacion    → mapeado a formato (Caja/Unidad/Kit/Bolsa)
 *   col 5  = costo neto      → costo
 *   col 6  = PRECIO VTA BRUTO (1ª)  — ignorado
 *   col 7  = PRECIO VTA NETO  (1ª)  → lista1
 *   col 8  = MARGEN           (1ª)  — ignorado
 *   col 9  = PRECIO VTA BRUTO (2ª)  — ignorado
 *   col 10 = PRECIO VTA NETO  (2ª)  → lista2
 *   col 11 = MARGEN           (2ª)  — ignorado
 *
 * Reglas:
 *   - sku, nombre, categoria, formato, costo, lista1, lista2 son obligatorios.
 *   - lista3 = 0 (se calcula como lista2 × 1.08 en frontend).
 *   - lista4 = 0.
 *   - estado = 'Activo' (todos traen SKU).
 *   - presentacion = igual al formato (no viene desglosado).
 *   - Si el SKU ya existe en BD, el INSERT lo ignora (ON CONFLICT DO NOTHING).
 *
 * Salida: scripts/output/insertar-productos.sql
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const csvPath = process.argv[2];
if (!csvPath) {
  console.error("Falta argumento: ruta al CSV.");
  console.error('   Ejemplo: node scripts/csv-a-sql-nuevos-productos.mjs "C:/.../nuevos.csv"');
  process.exit(1);
}

// ── Lectura del CSV ──────────────────────────────────────────────────────────
let raw = readFileSync(csvPath, "utf8");
if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);

const lineas = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
if (lineas.length < 2) {
  console.error("El CSV no tiene filas de datos.");
  process.exit(1);
}

// Repara "mojibake" típico de Excel: UTF-8 que fue malinterpretado como
// Latin-1 al exportar (ej. "QuirÃºrgico" → "Quirúrgico"). Solo aplica si
// detectamos el patrón "Ã" + caracter posterior.
function fixMojibake(s) {
  if (typeof s !== "string") return s;
  if (!/Ã[\x80-\xBF]|Â[\x80-\xBF]/.test(s)) return s;
  try {
    return Buffer.from(s, "latin1").toString("utf8");
  } catch {
    return s;
  }
}

// CSV parser simple con manejo de comillas dobles escapadas ("") y ;
function parseLinea(linea) {
  const out = [];
  let cur = "";
  let dentroComillas = false;
  for (let i = 0; i < linea.length; i++) {
    const c = linea[i];
    if (c === '"') {
      if (dentroComillas && linea[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        dentroComillas = !dentroComillas;
      }
    } else if (c === ";" && !dentroComillas) {
      out.push(cur);
      cur = "";
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out;
}

function parsePrecio(rawVal) {
  if (rawVal == null || rawVal === "") return null;
  if (typeof rawVal === "number") return Number.isFinite(rawVal) ? rawVal : null;
  let s = String(rawVal).trim();
  if (!s) return null;
  s = s.replace(/[\s$%]/g, "");

  if (s.includes(".") && s.includes(",")) {
    if (s.lastIndexOf(",") > s.lastIndexOf(".")) {
      s = s.replace(/\./g, "").replace(",", ".");
    } else {
      s = s.replace(/,/g, "");
    }
  } else if (s.includes(".")) {
    const lastDot = s.lastIndexOf(".");
    const decimals = s.length - lastDot - 1;
    if (decimals === 3) s = s.replace(/\./g, "");
  } else if (s.includes(",")) {
    const lastComma = s.lastIndexOf(",");
    const decimals = s.length - lastComma - 1;
    if (decimals === 3) s = s.replace(/,/g, "");
    else s = s.replace(",", ".");
  }

  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function escSql(v) {
  if (v == null) return "null";
  return `'${String(v).replace(/'/g, "''")}'`;
}

const idx = {
  sku: 0,
  nombre: 1,
  categoria: 2,
  marca: 3,
  formato: 4,
  costo: 5,
  lista1: 7,  // PRECIO VTA NETO (1ª)
  lista2: 10, // PRECIO VTA NETO (2ª)
};

const datos = [];
const errores = [];

for (let i = 1; i < lineas.length; i++) {
  const cols = parseLinea(lineas[i]).map(fixMojibake);
  const sku = String(cols[idx.sku] ?? "").trim().toUpperCase();
  const nombre = String(cols[idx.nombre] ?? "").trim();
  const categoria = String(cols[idx.categoria] ?? "").trim();
  const marca = String(cols[idx.marca] ?? "").trim();
  const formato = String(cols[idx.formato] ?? "").trim();
  const costo = parsePrecio(cols[idx.costo]);
  const lista1 = parsePrecio(cols[idx.lista1]);
  const lista2 = parsePrecio(cols[idx.lista2]);

  const missing = [];
  if (!sku) missing.push("sku");
  if (!nombre) missing.push("nombre");
  if (!categoria) missing.push("categoria");
  if (!formato) missing.push("formato");
  if (costo == null || costo <= 0) missing.push("costo");
  if (lista1 == null || lista1 <= 0) missing.push("lista1 (NETO 1)");
  if (lista2 == null || lista2 <= 0) missing.push("lista2 (NETO 2)");

  if (missing.length) {
    errores.push({ linea: i + 1, sku: sku || "(sin sku)", motivo: `Falta(n): ${missing.join(", ")}` });
    continue;
  }

  datos.push({ sku, nombre, categoria, marca, formato, costo, lista1, lista2 });
}

if (datos.length === 0) {
  console.error("No se pudo parsear ninguna fila válida.");
  if (errores.length > 0) {
    console.error("\nErrores:");
    errores.forEach((e) =>
      console.error(`   linea ${e.linea} [${e.sku}]: ${e.motivo}`),
    );
  }
  process.exit(1);
}

const valuesSql = datos
  .map((r) => {
    return `  (${escSql(r.sku)}, 'Activo', ${escSql(r.nombre)}, ${escSql(r.marca || null)}, ${escSql(r.categoria)}, ${escSql(r.formato)}, ${escSql(r.formato)}, ${r.costo}, ${r.lista1}, ${r.lista2}, 0, 0)`;
  })
  .join(",\n");

const sql = `-- Insert masivo de productos nuevos
-- Generado: ${new Date().toISOString()}
-- Filas:    ${datos.length}
-- Origen:   ${csvPath.replace(/\\/g, "/")}
-- Mapeo:    sku, nombre, categoria, marca, formato(=presentacion), costo, lista1(NETO), lista2(NETO)
-- Reglas:
--   * estado = 'Activo' (todos traen SKU).
--   * Si el SKU ya existe, ON CONFLICT DO NOTHING.
--   * lista3 y lista4 se setean en 0 (Lista 3 se deriva en frontend = lista2 × 1.08).
--   * presentacion = formato (no venía desglosada en el CSV).

begin;

insert into public.productos
  (sku, estado, nombre, marca, categoria, formato, presentacion, costo, lista1, lista2, lista3, lista4)
values
${valuesSql}
on conflict (sku) do nothing;

commit;
`;

const outDir = resolve(__dirname, "output");
mkdirSync(outDir, { recursive: true });
const outPath = resolve(outDir, "insertar-productos.sql");
writeFileSync(outPath, sql, "utf8");

console.log(`SQL generado: ${outPath}`);
console.log(`Filas válidas:   ${datos.length}`);
console.log(`Filas con error: ${errores.length}`);
if (errores.length > 0 && errores.length <= 20) {
  console.log("\nErrores:");
  errores.forEach((e) =>
    console.log(`   linea ${e.linea} [${e.sku}]: ${e.motivo}`),
  );
} else if (errores.length > 20) {
  console.log(`   (mostrando primeros 20 de ${errores.length})`);
  errores.slice(0, 20).forEach((e) =>
    console.log(`   linea ${e.linea} [${e.sku}]: ${e.motivo}`),
  );
}
