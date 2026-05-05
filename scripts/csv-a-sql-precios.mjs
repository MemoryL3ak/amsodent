#!/usr/bin/env node
/**
 * Convierte un CSV de productos → un único UPDATE bulk SQL para Supabase.
 *
 * Uso:
 *   node scripts/csv-a-sql-precios.mjs "C:/ruta/al/Lista de Precios.csv"
 *
 * Layout fijo del CSV (por posición de columna):
 *   A=sku  C=nombre  D=categoria  E=marca  F=formato
 *   H=costo  J=lista1  K=margen  M=lista2
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

// Lee el archivo como buffer y detecta encoding (UTF-8 vs Latin-1).
// Muchos CSV exportados desde Excel en Windows vienen en latin1 (cp1252).
const buf = readFileSync(csvPath);
let raw = buf.toString("utf8");
// Si detectamos el carácter de reemplazo o secuencias típicas de doble-codificación,
// re-decodificamos como latin1.
if (raw.includes("�") || /Ã[©³¡±¨º»]/.test(raw)) {
  raw = buf.toString("latin1");
}
raw = raw.replace(/^﻿/, "");

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

// Mapeo fijo de columnas (0-indexed)
const idxSku = 0;       // A
const idxNombre = 2;    // C
const idxCategoria = 3; // D
const idxMarca = 4;     // E
const idxFormato = 5;   // F
const idxCosto = 7;     // H
const idxLista1 = 9;    // J
const idxMargen = 10;   // K
const idxLista2 = 12;   // M

console.log(
  `   Mapeo fijo: A=sku, C=nombre, D=categoria, E=marca, F=formato, H=costo, J=lista1, K=margen, M=lista2`
);

// Parsea precios CL: "$3.277" / "3277" / "3,277.00" → 3277
function parsePrecio(raw) {
  if (raw == null) return null;
  let s = String(raw).trim();
  if (!s) return null;
  s = s.replace(/[\s$]/g, "");
  if (s.includes(".") && s.includes(",")) {
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (s.includes(".")) {
    const lastDot = s.lastIndexOf(".");
    const decimals = s.length - lastDot - 1;
    if (decimals === 3) {
      s = s.replace(/\./g, "");
    }
  } else if (s.includes(",")) {
    s = s.replace(",", ".");
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// Parsea margen: "30%" / "30,5%" / "0,30" → número (porcentaje, p.ej. 30 o 30.5)
function parseMargen(raw) {
  if (raw == null) return null;
  let s = String(raw).trim();
  if (!s) return null;
  s = s.replace(/[\s%]/g, "");
  if (s.includes(".") && s.includes(",")) {
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (s.includes(",")) {
    s = s.replace(",", ".");
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function escSql(v) {
  if (v == null) return "null";
  return `'${String(v).replace(/'/g, "''")}'`;
}

function num(v) {
  return v == null ? "null" : v;
}

const rows = [];
const errores = [];

for (let i = 1; i < lines.length; i++) {
  const cols = parseCsvLine(lines[i]);
  const sku = (cols[idxSku] ?? "").trim();
  if (!sku) {
    errores.push({ linea: i + 1, motivo: "SKU vacío", raw: lines[i].slice(0, 80) });
    continue;
  }

  const nombre = (cols[idxNombre] ?? "").trim() || null;
  const categoria = (cols[idxCategoria] ?? "").trim() || null;
  const marca = (cols[idxMarca] ?? "").trim() || null;
  const formato = (cols[idxFormato] ?? "").trim() || null;
  const costo = parsePrecio(cols[idxCosto]);
  const lista1 = parsePrecio(cols[idxLista1]);
  const lista2 = parsePrecio(cols[idxLista2]);
  const margen = parseMargen(cols[idxMargen]);

  rows.push({ sku, nombre, categoria, marca, formato, costo, lista1, margen, lista2 });
}

if (rows.length === 0) {
  console.error("❌ No se pudo parsear ninguna fila válida.");
  process.exit(1);
}

// Genera SQL bulk (upsert: actualiza existentes, inserta nuevos)
const valuesSql = rows
  .map(
    (r) =>
      `  (${escSql(r.sku)}, ${escSql(r.nombre)}, ${escSql(r.categoria)}, ${escSql(r.marca)}, ${escSql(r.formato)}, ${num(r.costo)}, ${num(r.lista1)}, ${num(r.lista2)})`
  )
  .join(",\n");

const sql = `-- Upsert masivo de productos (nombre, categoria, marca, formato, costo, lista1, lista2)
-- Generado: ${new Date().toISOString()}
-- Filas: ${rows.length}
-- Origen: ${csvPath.replace(/\\/g, "/")}
-- Comportamiento:
--   * SKU existente y estado <> 'Transitorio' -> UPDATE
--   * SKU existente y estado = 'Transitorio'  -> NO se toca
--   * SKU NO existente                        -> INSERT con estado = 'Activo'

begin;

insert into public.productos as p
  (sku, nombre, categoria, marca, formato, costo, lista1, lista2, estado)
select
  v.sku,
  v.nombre,
  v.categoria,
  v.marca,
  v.formato,
  coalesce(v.costo, 0),
  coalesce(v.lista1, 0),
  coalesce(v.lista2, 0),
  'Activo'
from (values
${valuesSql}
) as v(sku, nombre, categoria, marca, formato, costo, lista1, lista2)
on conflict (sku) do update
set
  nombre    = coalesce(excluded.nombre,    p.nombre),
  categoria = coalesce(excluded.categoria, p.categoria),
  marca     = coalesce(excluded.marca,     p.marca),
  formato   = coalesce(excluded.formato,   p.formato),
  costo     = coalesce(excluded.costo,     p.costo),
  lista1    = coalesce(excluded.lista1,    p.lista1),
  lista2    = coalesce(excluded.lista2,    p.lista2)
where lower(coalesce(p.estado, '')) <> 'transitorio';

-- Diagnóstico: SKUs del CSV que estaban en estado Transitorio (no se actualizan ni insertan)
-- (descomenta para revisar)
-- select p.sku, p.estado
-- from public.productos p
-- where p.sku in (${rows.map((r) => `'${String(r.sku).replace(/'/g, "''")}'`).join(",")})
--   and lower(coalesce(p.estado,'')) = 'transitorio';

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
