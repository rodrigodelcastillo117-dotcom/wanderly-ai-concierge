// Fixture de The Privé Key para pruebas y capturas: filas REALES de la curaduría (data/prive/import),
// con la forma de prive_exp_json (lo que devuelve prive_search). Solo lo que la base publicaría
// (sin PENDIENTE). No agrega precios ni horarios: si la curaduría no los tiene, quedan sin fuente.
// Uso: node scripts/prive/gen_key_fixture.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { allDestinations } from "./destinations.mjs";

const rows = JSON.parse(readFileSync(new URL("../../data/prive/import/curaduria_2026-10.json", import.meta.url), "utf8"));
const dests = new Map(allDestinations().map((d) => [d.slug, d]));
const cities = {};
for (const slug of ["cdmx", "mc", "paris"]) {
  const d = dests.get(slug);
  const country = dests.get(String(d.iso ?? "").toLowerCase()) ?? d;
  const city = { slug, name: d.name_es, timezone: d.tz ?? country.tz, currency: d.currency ?? country.currency };
  const items = rows.filter((e) => e.destination_slug === slug && ["VERIFICADO", "CURADO", "ESTIMADO"].includes(e.data_state)).map((e, i) => {
    const o = {
      id: `00000000-0000-4000-8000-${String(1000 + Object.keys(cities).length * 100 + i).padStart(12, "0")}`,
      slug: e.slug, name: e.name, universe: e.universe, subcategory: e.subcategory, destination: city,
      neighborhood: e.neighborhood_slug ? dests.get(e.neighborhood_slug)?.name_es ?? null : null,
      state: e.data_state, verified_at: e.verified_at, why: e.why_fact_es, address: e.address, lat: e.lat, lng: e.lng,
      website: e.website, booking_url: e.booking_url, booking_method: e.booking_method, age_policy: e.age_policy ?? "todas",
      dress_code: e.dress_code_es, price_level: e.price_level, price_note: e.price_note_es,
      availability: { state: "no_consultada" }, restrictions: e.restrictions_es, accolades: e.accolades?.length ? e.accolades : undefined,
      image: { source: "pexels", query: e.image_query, illustrative: true }, tags: e.tags?.length ? e.tags : undefined,
      reasons: [], score: 0,
    };
    if (e.price_source_url && (e.price_min != null || e.price_max != null)) o.price = { min: e.price_min, max: e.price_max, currency: e.price_currency, basis: e.price_basis, source: e.price_source_url };
    if (e.opening_hours_source) o.opening_hours = { hours: e.opening_hours, source: e.opening_hours_source };
    return JSON.parse(JSON.stringify(o));
  });
  cities[slug] = { city, items };
}
writeFileSync(new URL("../../src/test/fixtures/priveKeyCatalog.json", import.meta.url),
  JSON.stringify({ _nota: "Filas reales de data/prive/import/curaduria_2026-10.json con la forma de prive_exp_json. Generado por scripts/prive/gen_key_fixture.mjs.", cities }, null, 1));
console.log(Object.fromEntries(Object.entries(cities).map(([k, v]) => [k, v.items.length])));
