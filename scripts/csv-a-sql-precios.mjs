#!/usr/bin/env node
/**
 * Convierte un CSV de precios → un único UPDATE bulk SQL para Supabase.
 *
 * Uso:
 *   node scripts/csv-a-sql-precios.mjs "C:/ruta/al/Lista de Precios.csv"
 *
 * Requisitos del CSV: encabezados sku,nombre,categoria,marca,formato,costo,lista1,lista2
 * Solo se actualizan lista1 y lista2 — el resto de columnas se ignoran.
 *
 * Salida: scripts/output/actualizar-precios.sql
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const csvPath = process.argv[2];
if (!csvPath) {
  console.error("❌ Falta argumento: ruta al CSV.");
  console.error('   Ejemplo: node scripts/csv-a-sql-precios.mjs "C:/Users/.../Lista de Precios.csv"');
  process.exit(1);
}

const raw = readFileSync(csvPath, "utf8").replace(/^﻿/, "");
const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);

if (lines.length < 2) {
  console.error("❌ El CSV no tiene filas de datos.");
  process.exit(1);
}

// CSV parser mínimo (soporta valores con comillas)
function parseCsvLine(line) {
  const result = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (c === "," && !inQuotes) {
      result.push(cur);
      cur = "";
    } else {
      cur += c;
    }
  }
  result.push(cur);
  return result;
}

const header = parseCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
const idxSku = header.indexOf("sku");
const idxLista1 = header.indexOf("lista1");
const idxLista2 = header.indexOf("lista2");

if (idxSku === -1 || idxLista1 === -1 || idxLista2 === -1) {
  console.error(`❌ Faltan columnas requeridas. Encabezados: ${header.join(", ")}`);
  console.error("   Se requieren: sku, lista1, lista2");
  process.exit(1);
}

// Parsea precios CL: "$3.277" / "3277" / "3,277.00" → 3277
function parsePrecio(raw) {
  if (raw == null) return null;
  let s = String(raw).trim();
  if (!s) return null;
  s = s.replace(/[\s$]/g, "");
  // Si tiene "." y "," asumimos formato CL: $1.234,56 → 1234.56
  if (s.includes(".") && s.includes(",")) {
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (s.includes(".")) {
    // Formato CL típico: "$3.277" donde "." es separador de miles
    // Heurística: si después del último "." hay 3 dígitos, son miles
    const lastDot = s.lastIndexOf(".");
    const decimals = s.length - lastDot - 1;
    if (decimals === 3) {
      s = s.replace(/\./g, "");
    }
    // si decimals !== 3, asumimos que el "." es separador decimal y se deja
  } else if (s.includes(",")) {
    s = s.replace(",", ".");
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function escSku(sku) {
  return String(sku).replace(/'/g, "''");
}

const rows = [];
const errores = [];

for (let i = 1; i < lines.length; i++) {
  const cols = parseCsvLine(lines[i]);
  const sku = (cols[idxSku] ?? "").trim();
  const l1 = parsePrecio(cols[idxLista1]);
  const l2 = parsePrecio(cols[idxLista2]);

  if (!sku) {
    errores.push({ linea: i + 1, motivo: "SKU vacío", raw: lines[i].slice(0, 80) });
    continue;
  }
  if (l1 == null && l2 == null) {
    errores.push({ linea: i + 1, motivo: "lista1 y lista2 vacíos/inválidos", sku });
    continue;
  }

  rows.push({ sku, l1, l2 });
}

if (rows.length === 0) {
  console.error("❌ No se pudo parsear ninguna fila válida.");
  process.exit(1);
}

// Genera SQL bulk
const valuesSql = rows
  .map(
    (r) =>
      `  ('${escSku(r.sku)}', ${r.l1 == null ? "null" : r.l1}, ${r.l2 == null ? "null" : r.l2})`
  )
  .join(",\n");

const sql = `-- Actualización masiva de precios (lista1 y lista2)
-- Generado: ${new Date().toISOString()}
-- Filas: ${rows.length}
-- Origen: ${csvPath.replace(/\\/g, "/")}

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
where p.sku = v.sku;

-- Diagnóstico: SKUs del CSV que NO existen en la tabla productos
-- (descomenta para revisar después de hacer commit/rollback)
-- select v.sku
-- from (values ${rows.map((r) => `('${escSku(r.sku)}')`).join(",")}) as v(sku)
-- left join public.productos p on p.sku = v.sku
-- where p.id is null;

commit;
`;

const outDir = resolve(__dirname, "output");
mkdirSync(outDir, { recursive: true });
const outPath = resolve(outDir, "actualizar-precios.sql");
writeFileSync(outPath, sql, "utf8");

console.log(`✅ SQL generado: ${outPath}`);
console.log(`   Filas válidas:   ${rows.length}`);
console.log(`   Filas con error: ${errores.length}`);
if (errores.length > 0 && errores.length <= 20) {
  console.log("\nErrores:");
  errores.forEach((e) => console.log(`   línea ${e.linea}: ${e.motivo}${e.sku ? ` (SKU ${e.sku})` : ""}`));
} else if (errores.length > 20) {
  console.log(`   (mostrando primeros 20 de ${errores.length})`);
  errores.slice(0, 20).forEach((e) => console.log(`   línea ${e.linea}: ${e.motivo}${e.sku ? ` (SKU ${e.sku})` : ""}`));
}
