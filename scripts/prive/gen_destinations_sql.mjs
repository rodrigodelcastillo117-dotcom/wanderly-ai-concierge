#!/usr/bin/env node
// Genera supabase/migrations/20261023100010_prive_destinations_seed.sql desde destinations.mjs y
// destinations.coords.json. Uso: node scripts/prive/gen_destinations_sql.mjs
// La migración generada se versiona; volver a generarla solo cambia lo que cambió en los datos.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { aliasMap, allDestinations, priveNorm } from "./destinations.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const coords = JSON.parse(readFileSync(join(here, "destinations.coords.json"), "utf8"));
const q = (v) => (v == null ? "NULL" : `'${String(v).replace(/'/g, "''")}'`);
const rows = allDestinations();
const bySlug = new Map(rows.map((r) => [r.slug, r]));
const depth = (r) => (r.parent ? 1 + depth(bySlug.get(r.parent)) : 0);
rows.sort((a, b) => depth(a) - depth(b) || a.sort_order - b.sort_order || a.slug.localeCompare(b.slug));

const lines = [];
lines.push(`-- IATOS Privé (grupo catalog) · 2/9 · Siembra del catálogo de destinos. GENERADO por
-- scripts/prive/gen_destinations_sql.mjs desde scripts/prive/destinations.mjs (lista EXACTA del dueño,
-- 2026-10-22) y destinations.coords.json (Wikidata P625, consultado el 2026-10-22). No editar a mano.
--
-- Todos los destinos nacen SIN COBERTURA VERIFICADA: la cobertura se calcula con el contenido
-- verificado (prive_destination_coverage), no se escribe aquí. Coordenadas sin fuente verificable = NULL
-- (Riviera Nayarit: Wikidata no la tiene; Roma-Condesa: barrio compuesto; Interlomas: el dato de
-- Wikidata no coincide con la ubicación real). Idempotente: ON CONFLICT (slug) actualiza.
`);
for (const r of rows) {
  const c = coords[r.slug] ?? {};
  const lat = c.lat ?? null;
  const lng = c.lng ?? null;
  const parent = r.parent ? `(SELECT id FROM public.prive_destinations WHERE slug = ${q(r.parent)})` : "NULL";
  const note = lat == null ? (r.coord_note ?? c.note ?? (r.wiki ? "Sin coordenada verificable" : "Área: agrupa destinos, sin coordenada propia")) : null;
  lines.push(`INSERT INTO public.prive_destinations (slug, kind, parent_id, name_es, name_en, iso_country, admin_area, lat, lng, coord_source, coord_note, wikidata_qid, timezone, currency, region_group, is_destination, sort_order)
VALUES (${q(r.slug)}, ${q(r.kind)}, ${parent}, ${q(r.name_es)}, ${q(r.name_en)}, ${q(r.iso)}, ${q(r.admin_area)}, ${lat ?? "NULL"}, ${lng ?? "NULL"}, ${q(lat == null ? null : c.source)}, ${q(note)}, ${q(c.qid ?? null)}, ${q(r.tz)}, ${q(r.currency)}, ${q(r.dest ? r.group : r.group ?? null)}, ${r.dest ? "true" : "false"}, ${r.sort_order})
ON CONFLICT (slug) DO UPDATE SET kind = EXCLUDED.kind, parent_id = EXCLUDED.parent_id, name_es = EXCLUDED.name_es, name_en = EXCLUDED.name_en,
  iso_country = EXCLUDED.iso_country, admin_area = EXCLUDED.admin_area, lat = EXCLUDED.lat, lng = EXCLUDED.lng, coord_source = EXCLUDED.coord_source,
  coord_note = EXCLUDED.coord_note, wikidata_qid = EXCLUDED.wikidata_qid, timezone = EXCLUDED.timezone, currency = EXCLUDED.currency,
  region_group = EXCLUDED.region_group, is_destination = EXCLUDED.is_destination, sort_order = EXCLUDED.sort_order;`);
}
lines.push("\n-- Sobrenombres: cada uno apunta a un solo destino (alias_norm es la llave primaria).");
const aliases = [...aliasMap().entries()].sort((a, b) => a[0].localeCompare(b[0]));
for (const [alias, slug] of aliases) {
  if (alias !== priveNorm(alias)) throw new Error(`alias no normalizado: ${alias}`);
  lines.push(`INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT ${q(alias)}, id FROM public.prive_destinations WHERE slug = ${q(slug)}
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;`);
}
lines.push("\n-- Áreas metropolitanas (agrupan sin duplicar).");
for (const r of rows.filter((x) => x.kind === "area")) {
  for (const m of r.members ?? []) {
    lines.push(`INSERT INTO public.prive_destination_members (area_id, destination_id)
SELECT a.id, d.id FROM public.prive_destinations a, public.prive_destinations d WHERE a.slug = ${q(r.slug)} AND d.slug = ${q(m)}
ON CONFLICT DO NOTHING;`);
  }
}
const out = join(here, "../../supabase/migrations/20261023100010_prive_destinations_seed.sql");
writeFileSync(out, lines.join("\n") + "\n");
console.log(`ok: ${rows.length} destinos, ${aliases.length} alias → ${out}`);
