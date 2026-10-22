#!/usr/bin/env node
// Genera src/lib/priveDestinationIndex.ts desde destinations.mjs (la lista del dueño): nombre en
// inglés, país, alias para la búsqueda "¿A dónde?" y las consultas de foto de Pexels de cada destino.
// Uso: node scripts/prive/gen_destination_index.mjs
//
// Por qué existe: prive_home solo devuelve slug + nombre en español. Sin nombre en inglés la foto se
// pedía con "Ciudad de México" o no se pedía (la lista de destinos era solo texto) y la portada del
// destino usaba "<name_en> skyline", que para islas, valles o barrios no trae nada útil. Aquí cada
// destino trae una cadena de consultas: la curada (si la hay) → "<ciudad> <país>" → "<ciudad>".
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { allDestinations, priveNorm } from "./destinations.mjs";

const here = dirname(fileURLToPath(import.meta.url));

// Consultas curadas para portadas: el lugar más reconocible de cada destino (siempre en inglés, como
// pide images_pexels.md). Solo se agregan donde "<ciudad> <país>" suele traer algo genérico.
const PHOTO = {
  "monaco-monte-carlo": "Monte Carlo Monaco harbour",
  mc: "Monaco harbour yachts",
  paris: "Paris Eiffel Tower",
  londres: "London Westminster",
  milan: "Milan Cathedral Duomo",
  roma: "Rome Colosseum",
  florencia: "Florence Duomo skyline",
  venecia: "Venice Grand Canal",
  capri: "Capri Faraglioni",
  "costa-amalfitana": "Positano Amalfi Coast",
  "lago-de-como": "Lake Como Bellagio",
  "saint-tropez": "Saint-Tropez harbour",
  cannes: "Cannes Croisette beach",
  niza: "Nice France Promenade des Anglais",
  courchevel: "Courchevel ski resort snow",
  megeve: "Megeve village snow",
  gstaad: "Gstaad Switzerland chalet",
  "st-moritz": "St. Moritz lake mountains",
  zurich: "Zurich old town river",
  ginebra: "Geneva Jet d'Eau lake",
  madrid: "Madrid Gran Via",
  barcelona: "Barcelona Sagrada Familia",
  marbella: "Marbella Spain beach",
  ibiza: "Ibiza coast sea",
  formentera: "Formentera beach turquoise",
  mallorca: "Mallorca coast cove",
  mykonos: "Mykonos windmills",
  santorini: "Santorini Oia",
  atenas: "Athens Acropolis",
  viena: "Vienna Austria architecture",
  berlin: "Berlin Brandenburg Gate",
  amsterdam: "Amsterdam canals",
  lisboa: "Lisbon tram Alfama",
  porto: "Porto Ribeira Douro",
  "nueva-york": "New York City skyline",
  miami: "Miami skyline",
  "miami-beach": "Miami Beach Ocean Drive",
  "los-angeles": "Los Angeles skyline palm trees",
  "beverly-hills": "Beverly Hills palm trees",
  malibu: "Malibu beach",
  "las-vegas": "Las Vegas Strip night",
  aspen: "Aspen Colorado mountains",
  vail: "Vail Colorado ski",
  "jackson-hole": "Grand Teton Jackson Hole",
  "napa-valley": "Napa Valley vineyard",
  "san-francisco": "San Francisco Golden Gate Bridge",
  chicago: "Chicago skyline",
  boston: "Boston skyline",
  "palm-beach": "Palm Beach Florida",
  hamptons: "Hamptons beach house",
  toronto: "Toronto skyline",
  vancouver: "Vancouver skyline mountains",
  whistler: "Whistler mountains",
  montreal: "Montreal old port",
  cdmx: "Mexico City Palacio de Bellas Artes",
  "cdmx-polanco": "Mexico City Polanco",
  "cdmx-roma-condesa": "Mexico City Condesa street",
  "valle-de-bravo": "Valle de Bravo lake",
  "san-miguel-de-allende": "San Miguel de Allende church",
  guadalajara: "Guadalajara cathedral Mexico",
  "puerto-vallarta": "Puerto Vallarta beach",
  "riviera-nayarit": "Nayarit Mexico beach",
  "punta-mita": "Punta Mita beach",
  "los-cabos": "Cabo San Lucas arch",
  "san-jose-del-cabo": "San Jose del Cabo",
  "todos-santos": "Todos Santos Baja California",
  cancun: "Cancun beach turquoise",
  "riviera-maya": "Riviera Maya beach",
  tulum: "Tulum ruins beach",
  merida: "Merida Yucatan",
  oaxaca: "Oaxaca Mexico",
  "valle-de-guadalupe": "Valle de Guadalupe vineyard",
  puebla: "Puebla Mexico colorful",
  queretaro: "Queretaro Mexico aqueduct",
  monterrey: "Monterrey Mexico mountains",
  dubai: "Dubai skyline",
  "abu-dabi": "Abu Dhabi Sheikh Zayed Mosque",
  doha: "Doha skyline",
  riad: "Riyadh skyline",
  om: "Oman desert mountains",
  mascate: "Muscat Oman",
  tokio: "Tokyo skyline night",
  kioto: "Kyoto temple",
  osaka: "Osaka Dotonbori",
  sg: "Singapore Marina Bay",
  hk: "Hong Kong skyline",
  seul: "Seoul skyline",
  bangkok: "Bangkok temple",
  phuket: "Phuket beach",
  bali: "Bali rice terraces",
  yakarta: "Jakarta skyline",
  sidney: "Sydney Opera House",
  melbourne: "Melbourne skyline",
  queenstown: "Queenstown New Zealand lake",
  cartagena: "Cartagena Colombia old town",
  bogota: "Bogota Colombia",
  medellin: "Medellin Colombia",
  "buenos-aires": "Buenos Aires Obelisco",
  mendoza: "Mendoza vineyard Andes",
  "punta-del-este": "Punta del Este beach",
  "rio-de-janeiro": "Rio de Janeiro Sugarloaf",
  "sao-paulo": "Sao Paulo skyline",
  lima: "Lima Peru coast",
  cusco: "Cusco Peru",
  marrakech: "Marrakech riad",
  "ciudad-del-cabo": "Cape Town Table Mountain",
  sc: "Seychelles beach",
  mu: "Mauritius beach",
  mv: "Maldives overwater villa",
  "bora-bora": "Bora Bora lagoon",
};

const rows = allDestinations();
const bySlug = new Map(rows.map((r) => [r.slug, r]));
const countryOf = (r) => {
  let cur = r;
  while (cur && cur.kind !== "country") cur = bySlug.get(cur.parent);
  return cur;
};

// Zona metropolitana a la que pertenece (Interlomas → Área metropolitana de Ciudad de México).
const areaOf = (slug) => {
  const a = rows.find((x) => x.kind === "area" && (x.members ?? []).includes(slug));
  return a ? { es: a.name_es, en: a.name_en } : null;
};
const out = [];
for (const r of rows) {
  if (!r.dest) continue; // solo lo que puede aparecer en prive_home
  const country = countryOf(r);
  const isCountry = r.kind === "country";
  const en = r.name_en.replace(/ · featured destinations$/, "");
  const queries = [PHOTO[r.slug], isCountry ? en : `${en} ${country.name_en}`, en]
    .filter(Boolean).map((q) => q.slice(0, 100));
  const aliases = [...new Set([r.name_es, r.name_en, r.slug.replace(/-/g, " "), ...(r.aliases ?? [])].map(priveNorm).filter(Boolean))];
  const plain = (n) => n.replace(/ · (destinos destacados|featured destinations)$/, "");
  out.push({ slug: r.slug, es: plain(r.name_es), en, group: r.group ?? null, kind: r.kind, parent: r.parent && bySlug.get(r.parent)?.dest ? r.parent : null, area: areaOf(r.slug), country_es: plain(country.name_es), country_en: plain(country.name_en), aliases, q: [...new Set(queries)] });
}
out.sort((a, b) => a.slug.localeCompare(b.slug));

const body = out.map((d) => `  ${JSON.stringify(d.slug)}: ${JSON.stringify({ es: d.es, en: d.en, group: d.group, kind: d.kind, parent: d.parent, area: d.area, country_es: d.country_es, country_en: d.country_en, aliases: d.aliases, q: d.q })},`).join("\n");
const ts = `// GENERADO por scripts/prive/gen_destination_index.mjs desde scripts/prive/destinations.mjs. No editar a mano.
// Nombre en inglés, país, alias normalizados (priveNorm) para la búsqueda y consultas de foto de Pexels
// (en orden: curada → "<ciudad> <país>" → "<ciudad>") de cada destino de IATOS Privé.
export type PriveDestinationMeta = { es: string; en: string; group: string | null; kind: string; parent: string | null; area: { es: string; en: string } | null; country_es: string; country_en: string; aliases: string[]; q: string[] };

export const PRIVE_DESTINATION_INDEX: Record<string, PriveDestinationMeta> = {
${body}
};
`;
writeFileSync(join(here, "../../src/lib/priveDestinationIndex.ts"), ts);
console.log(`priveDestinationIndex.ts: ${out.length} destinos`);
