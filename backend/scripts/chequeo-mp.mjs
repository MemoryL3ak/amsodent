#!/usr/bin/env node
/* Chequeo de invariantes del circuito de Mercado Público.
 *
 *   node backend/scripts/chequeo-mp.mjs
 *
 * Verifica, contra la API real y la exploración guardada, las propiedades que
 * han fallado alguna vez y no pueden volver a fallar en silencio:
 *
 *   1. La API v1 entrega el listado COMPLETO de licitaciones activas.
 *   2. La exploración guardada es fresca (los crons de 14:00/23:00 corren).
 *   3. Sus contadores por fuente cuadran EXACTO con las filas guardadas.
 *   4. No hay códigos duplicados.
 *   5. Todo resultado dice con qué palabra calzó, y ese calce es verificable
 *      en su texto (mismas reglas de raíces que usa el backend).
 *   6. (Aviso) Las palabras de los matches existen en el catálogo activo.
 *   7. (Aviso) Cuántas licitaciones del snapshot siguen activas ahora — la
 *      deriva es normal (procesos abren y cierran), pero conviene verla.
 *
 * Sale con código 1 si falla alguna invariante dura (1-5), 0 si no.
 * Consume 1 consulta de la API v1 (cacheada del lado de ellos) y ninguna de
 * la v2 de Compra Ágil.
 *
 * OJO: las reglas de match replican las del backend (licitaciones.service.ts,
 * palabrasSignificativas/calzaTermino). Si se cambian allá, cambiarlas acá.
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(
  readFileSync(new URL("../.env", import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);
const ticket = (env.MP_API_TICKET || env.MERCADO_PUBLICO_TICKET || "").trim();
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const STOP = new Set(["de","del","la","las","el","los","lo","y","o","u","a","e","en","con","para","por","al","un","una","unos","unas"]);
const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const sig = (kw) => norm(kw).split(/\s+/).filter((w) => w.length >= 3 && !STOP.has(w))
  .map((w) => (w.endsWith("es") && w.length > 4 && !/[aeiou]es$/.test(w) ? w.slice(0, -2) : w.endsWith("s") && w.length > 3 ? w.slice(0, -1) : w));
const calza = (kw, texto) => { const s = sig(kw); if (!s.length) return true; const t = norm(texto); return s.every((w) => t.includes(w)); };

let fallas = 0;
let avisos = 0;
const FALLA = (msg) => { fallas++; console.log(`✗ FALLA  ${msg}`); };
const AVISO = (msg) => { avisos++; console.log(`! aviso  ${msg}`); };
const OK = (msg) => console.log(`✓ ok     ${msg}`);

// ── 1. v1 completa ────────────────────────────────────────────────────────
const res = await fetch(
  `https://api.mercadopublico.cl/servicios/v1/publico/licitaciones.json?estado=activas&ticket=${encodeURIComponent(ticket)}`,
);
const v1 = await res.json().catch(() => null);
if (!Array.isArray(v1?.Listado)) {
  FALLA(`API v1 no respondió listado (HTTP ${res.status}): ${String(v1?.Mensaje || "").slice(0, 120)}`);
} else if (v1.Cantidad !== v1.Listado.length) {
  FALLA(`API v1 declara ${v1.Cantidad} activas pero entregó ${v1.Listado.length}: listado truncado.`);
} else {
  OK(`API v1 entrega el listado completo (${v1.Listado.length} activas).`);
}

// ── 2-5. Exploración guardada ─────────────────────────────────────────────
const { data: exp, error: errExp } = await sb
  .from("mp_exploracion").select("resultado, actualizado_at, motivo").eq("id", 1).maybeSingle();
if (errExp || !exp) {
  FALLA(`No se pudo leer mp_exploracion: ${errExp?.message || "sin fila guardada"}`);
} else {
  const edadHoras = (Date.now() - Date.parse(exp.actualizado_at)) / 3600000;
  if (edadHoras > 26) FALLA(`La exploración guardada tiene ${edadHoras.toFixed(1)} h (motivo: ${exp.motivo}); con crons a las 14:00 y 23:00 nunca debería pasar de ~19 h.`);
  else OK(`Exploración guardada fresca: hace ${edadHoras.toFixed(1)} h (${exp.motivo}).`);

  const items = exp.resultado?.items || [];
  const agil = items.filter((x) => x.tipo_familia === "compra_agil");
  const lics = items.filter((x) => x.tipo_familia !== "compra_agil");

  const cf = exp.resultado?.conteo_fuente || {};
  if (cf.compra_agil !== agil.length || cf.licitaciones !== lics.length) {
    FALLA(`conteo_fuente dice ${cf.compra_agil}·${cf.licitaciones} pero las filas son ${agil.length}·${lics.length}.`);
  } else {
    OK(`Contadores cuadran con las filas: ${agil.length} de Compra Ágil · ${lics.length} licitaciones.`);
  }

  const codigos = items.map((x) => x.codigo).filter(Boolean);
  const dups = codigos.filter((c, i) => codigos.indexOf(c) !== i);
  if (dups.length) FALLA(`Códigos duplicados en la exploración: ${[...new Set(dups)].slice(0, 5).join(", ")}${dups.length > 5 ? "…" : ""}`);
  else OK("Sin códigos duplicados.");

  const sinMatch = items.filter((x) => !Array.isArray(x.match_keywords) || !x.match_keywords.length);
  if (sinMatch.length) FALLA(`${sinMatch.length} resultados sin match_keywords (¿de dónde salieron?): ${sinMatch.slice(0, 3).map((x) => x.codigo).join(", ")}`);
  else OK("Todo resultado declara con qué palabra(s) calzó.");

  const noVerifican = items.filter((x) => {
    const texto = x.tipo_familia === "compra_agil"
      ? `${x.nombre} ${x.convocatoria || ""}`
      : `${x.nombre} ${x.codigo}`;
    return !(x.match_keywords || []).some((kw) => calza(kw, texto));
  });
  if (noVerifican.length) {
    FALLA(`${noVerifican.length} resultados cuyo texto NO contiene sus palabras de match: ${noVerifican.slice(0, 3).map((x) => `${x.codigo} (${(x.match_keywords || []).join("/")})`).join(", ")}`);
  } else {
    OK("El calce de cada resultado es verificable en su nombre/descripción.");
  }

  // ── 6. matches vs catálogo (aviso) ──────────────────────────────────────
  const { data: kws } = await sb.from("mp_keywords").select("texto").eq("activa", true);
  const catalogo = new Set((kws || []).map((k) => norm(k.texto)));
  const fuera = [...new Set(items.flatMap((x) => x.match_keywords || []))].filter((kw) => !catalogo.has(norm(kw)));
  if (fuera.length) AVISO(`Palabras en matches que no están en el catálogo activo (¿variantes filtradas o keyword borrada?): ${fuera.slice(0, 8).join(", ")}${fuera.length > 8 ? ` +${fuera.length - 8}` : ""}`);
  else OK("Todas las palabras de los matches existen en el catálogo activo.");

  // ── 7. deriva licitaciones (aviso) ──────────────────────────────────────
  if (Array.isArray(v1?.Listado)) {
    const activos = new Set(v1.Listado.map((l) => l?.CodigoExterno));
    const cerradas = lics.filter((x) => !activos.has(x.codigo)).length;
    if (cerradas) AVISO(`${cerradas} de las ${lics.length} licitaciones del snapshot ya no están activas (deriva normal; el próximo cron las saca).`);
    else OK("Todas las licitaciones del snapshot siguen activas.");
  }
}

console.log(`\n${fallas ? `✗ ${fallas} invariante(s) DURA(S) rota(s)` : "✓ Invariantes duras en orden"}${avisos ? ` · ${avisos} aviso(s)` : ""}`);
process.exit(fallas ? 1 : 0);
