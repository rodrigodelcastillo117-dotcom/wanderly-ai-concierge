// Genera supabase/functions/_shared/priveKeyPlaces.ts desde destinations.mjs (fuente única de destinos).
// The Privé Key lo usa para reconocer el lugar en el deseo escrito ("aniversario en CDMX",
// "sorpréndeme en Tokio", "estoy en Montecarlo") sin IA. La base sigue resolviendo el destino real
// (prive_resolve_destination); esto solo detecta QUÉ parte del texto es un lugar.
// Uso: node scripts/prive/gen_key_places.mjs
import { writeFileSync } from "node:fs";
import { allDestinations, priveNorm } from "./destinations.mjs";

const all = allDestinations();
const rows = [];
for (const d of all) {
  if (d.kind === "area") continue;
  const terms = new Set([priveNorm(d.name_es), priveNorm(d.name_en), ...d.aliases.map(priveNorm), priveNorm(d.slug.replace(/-/g, " "))]);
  for (const t of terms) if (t && t.length >= 3) rows.push([t, d.slug]);
}
const places = all.filter((d) => d.kind !== "area").map((d) => {
  const country = d.kind === "country" ? d : all.find((c) => c.slug === d.iso?.toLowerCase()) ?? null;
  return [d.slug, d.name_es, d.name_en, d.kind, d.parent ?? null, !!d.dest, d.currency ?? country?.currency ?? null];
});
const out = `// GENERADO por scripts/prive/gen_key_places.mjs desde scripts/prive/destinations.mjs. No editar a mano.
// [término normalizado, slug] y [slug, nombre_es, nombre_en, tipo, padre, es_destino, moneda].
export const KEY_TERMS: [string, string][] = ${JSON.stringify(rows)};
export const KEY_PLACES: [string, string, string, string, string | null, boolean, string | null][] = ${JSON.stringify(places)};
`;
writeFileSync(new URL("../../supabase/functions/_shared/priveKeyPlaces.ts", import.meta.url), out);
console.log(`términos: ${rows.length}, lugares: ${places.length}`);
