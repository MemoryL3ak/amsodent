#!/usr/bin/env node
/**
 * Convierte un CSV (separado por ;) → UPDATE bulk SQL que actualiza
 * el campo `costo` en public.productos por SKU.
 *
 * Uso:
 *   node scripts/csv-a-sql-costo.mjs "C:/ruta/al/archivo.csv"
 *
 * Layout del CSV (0-indexed):
 *   col 0 = SKU
 *   col 5 = COSTO  (formato chileno "$1.730", también acepta "1.730" o 1730)
 *
 * Reglas:
 *   - Solo actualiza productos existentes (no inserta nuevos).
 *   - No toca productos en estado 'Transitorio'.
 *   - Filas con costo vacío/0 se ignoran (no se sobrescribe con 0).
 *
 * Salida: scripts/output/actualizar-costo.sql
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const csvPath = process.argv[2];
if (!csvPath) {
  console.error("Falta argumento: ruta al CSV.");
  console.error('   Ejemplo: node scripts/csv-a-sql-costo.mjs "C:/Users/.../costos.csv"');
  process.exit(1);
}

// ── Lectura del CSV ──────────────────────────────────────────────────────────
let raw = readFileSync(csvPath, "utf8");
// Strip BOM si existe (los CSV de Excel suelen tenerlo)
if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);

const lineas = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
if (lineas.length < 2) {
  console.error("El CSV no tiene filas de datos.");
  process.exit(1);
}

// Parser CSV simple: respeta comillas dobles y separador ;
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

// Parser de precios (mismo criterio que el script de listas)
function parsePrecio(rawVal) {
  if (rawVal == null || rawVal === "") return null;
  if (typeof rawVal === "number") return Number.isFinite(rawVal) ? rawVal : null;
  let s = String(rawVal).trim();
  if (!s) return null;
  s = s.replace(/[\s$]/g, "");

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
  return `'${String(v).replace(/'/g, "''")}'`;
}

const idxSku = 0;
const idxCosto = 5;

const datos = [];
const errores = [];

for (let i = 1; i < lineas.length; i++) {
  const cols = parseLinea(lineas[i]);
  const sku = String(cols[idxSku] ?? "").trim();
  if (!sku) continue;

  const costo = parsePrecio(cols[idxCosto]);
  if (costo == null || costo <= 0) {
    errores.push({ linea: i + 1, sku, motivo: "Costo vacío o inválido" });
    continue;
  }

  datos.push({ sku, costo });
}

if (datos.length === 0) {
  console.error("No se pudo parsear ninguna fila válida.");
  process.exit(1);
}

const valuesSql = datos
  .map((r) => `  (${escSql(r.sku)}, ${r.costo})`)
  .join(",\n");

const sql = `-- Update masivo del campo costo por SKU
-- Generado: ${new Date().toISOString()}
-- Filas:    ${datos.length}
-- Origen:   ${csvPath.replace(/\\/g, "/")}
-- Layout:   col 0 = sku, col 5 = costo
-- Reglas:
--   * Solo actualiza productos existentes (no inserta nuevos).
--   * No toca productos en estado 'Transitorio'.
--   * Filas con costo vacío/0 se ignoraron al generar este SQL.

begin;

with v(sku, costo) as (
  values
${valuesSql}
)
update public.productos as p
set costo = v.costo
from v
where p.sku = v.sku
  and lower(coalesce(p.estado, '')) <> 'transitorio';

-- Diagnóstico: SKUs del CSV que NO existen en la tabla productos
-- (descomenta para revisar)
-- select v.sku
-- from (values
${datos.map((r) => `--   (${escSql(r.sku)})`).join(",\n")}
-- ) as v(sku)
-- left join public.productos p on p.sku = v.sku
-- where p.id is null;

-- Diagnóstico: SKUs del CSV en estado Transitorio (no se actualizaron)
-- select p.sku, p.estado from public.productos p
-- where p.sku in (${datos.map((r) => escSql(r.sku)).join(",")})
--   and lower(coalesce(p.estado,'')) = 'transitorio';

commit;
`;

const outDir = resolve(__dirname, "output");
mkdirSync(outDir, { recursive: true });
const outPath = resolve(outDir, "actualizar-costo.sql");
writeFileSync(outPath, sql, "utf8");

console.log(`SQL generado: ${outPath}`);
console.log(`Filas válidas:   ${datos.length}`);
console.log(`Filas con error: ${errores.length}`);
if (errores.length > 0 && errores.length <= 20) {
  console.log("\nErrores:");
  errores.forEach((e) =>
    console.log(`   linea ${e.linea}: ${e.motivo}${e.sku ? ` (SKU ${e.sku})` : ""}`),
  );
} else if (errores.length > 20) {
  console.log(`   (mostrando primeros 20 de ${errores.length})`);
  errores.slice(0, 20).forEach((e) =>
    console.log(`   linea ${e.linea}: ${e.motivo}${e.sku ? ` (SKU ${e.sku})` : ""}`),
  );
}
