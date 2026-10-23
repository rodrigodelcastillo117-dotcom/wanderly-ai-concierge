#!/usr/bin/env node
// Genera src/lib/priveExploreGeo.ts: coordenadas y clima histórico mensual de cada destino de IATOS Privé,
// para el mapa "¿Cuándo ir?" de Explorar. Uso (con red): node scripts/prive/gen_explore_geo.mjs
//
// FUENTES Y TÉRMINOS (consultados el 23-oct-2026):
//  - Coordenadas: destinations.coords.json (Wikidata P625, ya verificado; sin coordenada → no va al mapa).
//  - Clima: NASA POWER Daily API v2 (https://power.larc.nasa.gov/api/temporal/daily/point), datos diarios del
//    1-ene-2001 al 31-dic-2025 (reanálisis MERRA-2, celda de ~0.5°×0.625°) promediados aquí por mes del año.
//    Parámetros: T2M_MAX y T2M_MIN (máxima y mínima del día, °C), PRECTOTCORR (lluvia, mm/día → mm/mes) y FRSNO
//    (fracción del suelo cubierta de nieve, 0–1). No se usa la "climatología" precalculada de POWER: su
//    T2M_MAX_AVG promedia los extremos de cada mes (París en enero daba 12 °C de máxima), no la máxima de cada día.
//    Términos: datos de una misión de la NASA sin licencia propia = CC0, uso comercial permitido; la NASA pide
//    citarla como fuente y no sugerir respaldo (https://www.earthdata.nasa.gov/engage/open-data-services-software-policies/data-use-guidance).
//    POWER pide citar servicio, versión y fecha de consulta (https://power.larc.nasa.gov/docs/referencing/).
//  - Descartada: Open-Meteo (API gratis "solo para uso no comercial": https://open-meteo.com/en/terms).
// El archivo se genera una vez y se versiona: la app no llama a ninguna API de clima en vivo.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { allDestinations } from "./destinations.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const coords = JSON.parse(readFileSync(join(here, "destinations.coords.json"), "utf8"));
const DAYS = [31, 28.25, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const PARAMS = "T2M_MAX,T2M_MIN,PRECTOTCORR,FRSNO";
const START = "20010101";
const END = "20251231";

async function climate(lat, lng) {
  const url = `https://power.larc.nasa.gov/api/temporal/daily/point?parameters=${PARAMS}&community=AG&latitude=${lat}&longitude=${lng}&start=${START}&end=${END}&format=JSON`;
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) {
        const j = await r.json();
        const p = j?.properties?.parameter;
        if (p?.T2M_MAX) return { p, version: j?.header?.api?.version ?? "?" };
      }
    } catch { /* reintento */ }
    await new Promise((res) => setTimeout(res, 1500 * (i + 1)));
  }
  return null;
}

const ok = (v) => typeof v === "number" && v > -900;
const dests = allDestinations().filter((d) => d.dest && d.kind !== "neighborhood");
const rows = [];
const missing = [];
let version = "?";
/** Promedio por mes del año (0–11) de una serie diaria {AAAAMMDD: valor}; -999 es "sin dato". */
function byMonth(series) {
  const sum = Array(12).fill(0), n = Array(12).fill(0);
  for (const [day, v] of Object.entries(series ?? {})) {
    if (!ok(v)) continue;
    const m = Number(day.slice(4, 6)) - 1;
    sum[m] += v; n[m] += 1;
  }
  return sum.map((s, i) => (n[i] >= 300 ? s / n[i] : null)); // ≥ 300 días (de ~775) para dar un promedio
}
for (const d of dests) {
  const c = coords[d.slug];
  if (!c || c.lat == null || c.lng == null) { missing.push(`${d.slug} (${c?.note ?? "sin coordenada"})`); continue; }
  const r = await climate(c.lat, c.lng);
  if (!r) { missing.push(`${d.slug} (NASA POWER no respondió)`); continue; }
  version = r.version;
  const hi = byMonth(r.p.T2M_MAX), lo = byMonth(r.p.T2M_MIN), pr = byMonth(r.p.PRECTOTCORR), sn = byMonth(r.p.FRSNO);
  const m = DAYS.map((days, i) => [
    hi[i] == null ? null : Math.round(hi[i]), lo[i] == null ? null : Math.round(lo[i]),
    pr[i] == null ? null : Math.round(pr[i] * days), sn[i] == null ? null : Math.round(sn[i] * 100) / 100]);
  rows.push({ slug: d.slug, lat: c.lat, lng: c.lng, m });
  process.stdout.write(".");
}
process.stdout.write("\n");

const body = rows.map((r) => `  ${JSON.stringify(r.slug)}: {"lat":${r.lat},"lng":${r.lng},"m":${JSON.stringify(r.m)}},`).join("\n");
const out = `// GENERADO por scripts/prive/gen_explore_geo.mjs el ${new Date().toISOString().slice(0, 10)}. No editar a mano.
// Coordenadas: Wikidata P625 (scripts/prive/destinations.coords.json).
// Clima: NASA POWER Daily API ${version} · datos diarios 2001–2025 promediados por mes · consultado el ${new Date().toISOString().slice(0, 10)}.
//   m[mes] = [máxima diaria promedio °C, mínima diaria promedio °C, lluvia mm/mes, fracción con nieve 0–1].
//   Datos CC0 de la NASA (se cita la fuente; no implica respaldo). Celda del reanálisis ~0.5°: es el clima de
//   la zona, no de un punto exacto.
// Sin coordenada verificable (no van al mapa): ${missing.join("; ") || "ninguno"}.
export type PriveClimateMonth = [number | null, number | null, number | null, number | null];
export type PriveGeo = { lat: number; lng: number; m: PriveClimateMonth[] };

export const PRIVE_CLIMATE_SOURCE = {
  name: "NASA POWER",
  version: ${JSON.stringify(version)},
  period: "2001–2025",
  checked: ${JSON.stringify(new Date().toISOString().slice(0, 10))},
  url: "https://power.larc.nasa.gov/",
  terms: "https://www.earthdata.nasa.gov/engage/open-data-services-software-policies/data-use-guidance",
} as const;

export const PRIVE_GEO: Record<string, PriveGeo> = {
${body}
};
`;
writeFileSync(join(here, "..", "..", "src", "lib", "priveExploreGeo.ts"), out);
console.log(`${rows.length} destinos con clima; sin coordenada: ${missing.length}`);
