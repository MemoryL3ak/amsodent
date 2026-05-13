#!/usr/bin/env node
/**
 * Convierte un XLSX → UPDATE bulk SQL que actualiza lista1 y lista2 por SKU.
 *
 * Uso:
 *   node scripts/xlsx-a-sql-listas.mjs "C:/ruta/al/archivo.xlsx"
 *
 * Layout fijo (1-indexed por letra de columna en Excel):
 *   A = SKU       (idx 0)
 *   H = Lista 1   (idx 7)
 *   K = Lista 2   (idx 10)
 *
 * Comportamiento:
 *   - SOLO actualiza filas existentes en public.productos (no inserta).
 *   - NO toca productos en estado 'Transitorio'.
 *
 * Salida: scripts/output/actualizar-listas.sql
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import XLSX from "xlsx";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const xlsxPath = process.argv[2];
if (!xlsxPath) {
  console.error("Falta argumento: ruta al XLSX.");
  console.error('   Ejemplo: node scripts/xlsx-a-sql-listas.mjs "C:/Users/.../Libro15.xlsx"');
  process.exit(1);
}

const wb = XLSX.readFile(xlsxPath);
const sheetName = wb.SheetNames[0];
const sheet = wb.Sheets[sheetName];

// Leemos como JSON pero pidiendo el TEXTO FORMATEADO (lo que se ve en Excel),
// no el valor crudo de la fórmula. Así, si una celda tiene formato "$0" y la
// fórmula devuelve 25621.8487, recibimos "$25.622" (ya redondeado por el formato).
const rows = XLSX.utils.sheet_to_json(sheet, {
  header: 1,
  defval: "",
  raw: false,
});

if (rows.length < 2) {
  console.error("El archivo no tiene filas de datos.");
  process.exit(1);
}

// Mapeo fijo (0-indexed)
const idxSku = 0;     // A
const idxLista1 = 7;  // H
const idxLista2 = 10; // K

// Parsea precios. Acepta formatos mixtos:
//   "$2.429"  (chileno: punto = miles)        → 2429
//   "$25,622" (gringo:  coma  = miles)        → 25622
//   "3,277.00" (gringo: coma miles, punto dec) → 3277
//   "3.277,00" (chileno: punto miles, coma dec)→ 3277
//   25622 (number)                             → 25622
function parsePrecio(raw) {
  if (raw == null || raw === "") return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  let s = String(raw).trim();
  if (!s) return null;
  s = s.replace(/[\s$]/g, "");

  if (s.includes(".") && s.includes(",")) {
    // Hay ambos: el último que aparezca es el decimal, el otro es separador de miles.
    if (s.lastIndexOf(",") > s.lastIndexOf(".")) {
      s = s.replace(/\./g, "").replace(",", ".");
    } else {
      s = s.replace(/,/g, "");
    }
  } else if (s.includes(".")) {
    const lastDot = s.lastIndexOf(".");
    const decimals = s.length - lastDot - 1;
    if (decimals === 3) s = s.replace(/\./g, ""); // separador de miles
  } else if (s.includes(",")) {
    const lastComma = s.lastIndexOf(",");
    const decimals = s.length - lastComma - 1;
    if (decimals === 3) s = s.replace(/,/g, ""); // separador de miles
    else s = s.replace(",", "."); // coma decimal
  }

  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function escSql(v) {
  return `'${String(v).replace(/'/g, "''")}'`;
}

const datos = [];
const errores = [];

for (let i = 1; i < rows.length; i++) {
  const cols = rows[i];
  const sku = String(cols[idxSku] ?? "").trim();
  if (!sku) {
    continue; // fila vacía
  }

  const lista1 = parsePrecio(cols[idxLista1]);
  const lista2 = parsePrecio(cols[idxLista2]);

  if (lista1 == null && lista2 == null) {
    errores.push({ linea: i + 1, sku, motivo: "Lista 1 y Lista 2 vacías o inválidas" });
    continue;
  }

  datos.push({ sku, lista1, lista2 });
}

if (datos.length === 0) {
  console.error("No se pudo parsear ninguna fila válida.");
  process.exit(1);
}

const valuesSql = datos
  .map((r) => {
    const l1 = r.lista1 == null ? "null" : r.lista1;
    const l2 = r.lista2 == null ? "null" : r.lista2;
    return `  (${escSql(r.sku)}, ${l1}, ${l2})`;
  })
  .join(",\n");

const sql = `-- Update masivo de lista1 y lista2 por SKU
-- Generado: ${new Date().toISOString()}
-- Filas:    ${datos.length}
-- Origen:   ${xlsxPath.replace(/\\/g, "/")}
-- Layout:   A=sku, H=lista1, K=lista2
-- Reglas:
--   * Solo actualiza productos existentes (no inserta nuevos).
--   * No toca productos en estado 'Transitorio'.
--   * Si la celda viene vacía/inválida en el Excel, ese campo no se modifica.

begin;

with v(sku, lista1, lista2) as (
  values
${valuesSql}
)
update public.productos as p
set
  lista1 = coalesce(v.lista1, p.lista1),
  lista2 = coalesce(v.lista2, p.lista2)
from v
where p.sku = v.sku
  and lower(coalesce(p.estado, '')) <> 'transitorio';

-- Diagnóstico: SKUs del Excel que NO existen en la tabla productos
-- (descomenta para revisar)
-- select v.sku
-- from (values
${datos.map((r) => `--   (${escSql(r.sku)})`).join(",\n")}
-- ) as v(sku)
-- left join public.productos p on p.sku = v.sku
-- where p.id is null;

-- Diagnóstico: SKUs del Excel que estaban en estado Transitorio (no se actualizaron)
-- select p.sku, p.estado from public.productos p
-- where p.sku in (${datos.map((r) => escSql(r.sku)).join(",")})
--   and lower(coalesce(p.estado,'')) = 'transitorio';

commit;
`;

const outDir = resolve(__dirname, "output");
mkdirSync(outDir, { recursive: true });
const outPath = resolve(outDir, "actualizar-listas.sql");
writeFileSync(outPath, sql, "utf8");

console.log(`SQL generado: ${outPath}`);
console.log(`Filas válidas:   ${datos.length}`);
console.log(`Filas con error: ${errores.length}`);
if (errores.length > 0 && errores.length <= 20) {
  console.log("\nErrores:");
  errores.forEach((e) => console.log(`   linea ${e.linea}: ${e.motivo}${e.sku ? ` (SKU ${e.sku})` : ""}`));
} else if (errores.length > 20) {
  console.log(`   (mostrando primeros 20 de ${errores.length})`);
  errores.slice(0, 20).forEach((e) => console.log(`   linea ${e.linea}: ${e.motivo}${e.sku ? ` (SKU ${e.sku})` : ""}`));
}
