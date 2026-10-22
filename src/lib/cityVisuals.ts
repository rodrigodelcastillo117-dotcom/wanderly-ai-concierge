/**
 * Visual de cada ciudad de Members Only (tarjetas de "Ciudades destacadas").
 *
 * Consultas revisadas una por una contra Pexels (oct 2026): de día, reconocibles y sin repetir.
 *
 * Por qué (oct 2026): la consulta era "<ciudad> city skyline night aerial landmark cinematic" con el
 * nombre en español. Pexels no entiende "Milán", "Londres" o "Tokio" y, con tantas palabras
 * genéricas, devolvía el mismo clip aéreo para varias ciudades (París = Mykonos, Milán = Londres;
 * Tokio salía con un clip de Montreal) y, por "night", tomas casi negras. Ahora:
 *  - cada ciudad tiene una consulta en inglés con su lugar emblemático y de día;
 *  - una segunda consulta de respaldo por si la primera no trae nada o repite;
 *  - un registro en la sesión garantiza que ningún clip se repite entre ciudades (la primera que
 *    lo reclama se lo queda; la otra pasa a su respaldo o a su foto fija).
 */

export const normText = (s: string | null | undefined) =>
  String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

type Visual = { en: string; q: string; alt: string; aliases?: string[] };

// Claves = nombre normalizado (sin acentos). q = consulta principal; alt = respaldo.
const V: Record<string, Visual> = {
  "paris": { en: "Paris", q: "Eiffel Tower Paris day", alt: "Paris Seine river Louvre", aliases: ["paris francia"] },
  "londres": { en: "London", q: "London Big Ben Westminster day", alt: "London Tower Bridge Thames", aliases: ["london"] },
  "nueva york": { en: "New York", q: "New York Manhattan skyline day", alt: "Manhattan skyline Central Park day", aliases: ["new york", "nyc", "new york city"] },
  "las vegas": { en: "Las Vegas", q: "Las Vegas Strip Bellagio fountains", alt: "Las Vegas desert road sign" },
  "ciudad de mexico": { en: "Mexico City", q: "Mexico City Angel of Independence Reforma", alt: "Mexico City Palacio de Bellas Artes", aliases: ["cdmx", "mexico city", "df"] },
  "dubai": { en: "Dubai", q: "Dubai Palm Jumeirah", alt: "Dubai Burj Khalifa day" },
  "tokio": { en: "Tokyo", q: "Tokyo Senso-ji temple", alt: "Tokyo skyline Tokyo Tower day", aliases: ["tokyo"] },
  "berlin": { en: "Berlin", q: "Berlin Brandenburg Gate", alt: "Berlin TV tower Spree" },
  "ibiza": { en: "Ibiza", q: "Ibiza old town Dalt Vila sea", alt: "Ibiza beach turquoise water" },
  "miami": { en: "Miami", q: "Miami Beach South Beach palm trees", alt: "Miami Ocean Drive art deco" },
  "madrid": { en: "Madrid", q: "Madrid Cibeles", alt: "Madrid Plaza Mayor" },
  "roma": { en: "Rome", q: "Rome Colosseum day", alt: "Rome Trevi Fountain", aliases: ["rome"] },
  "milan": { en: "Milan", q: "Milan Duomo cathedral day", alt: "Milan Galleria Vittorio Emanuele", aliases: ["milano"] },
  "atenas": { en: "Athens", q: "Athens Acropolis Parthenon", alt: "Athens Plaka streets", aliases: ["athens"] },
  "bangkok": { en: "Bangkok", q: "Bangkok Wat Arun temple river", alt: "Bangkok Grand Palace" },
  "saint tropez": { en: "Saint-Tropez", q: "Saint Tropez harbor yachts", alt: "French Riviera coast boats", aliases: ["st tropez"] },
  "mykonos": { en: "Mykonos", q: "Mykonos windmills white houses", alt: "Mykonos Little Venice sea" },
  "tulum": { en: "Tulum", q: "Tulum ruins Caribbean beach", alt: "Tulum cenote jungle" },
  "amsterdam": { en: "Amsterdam", q: "Amsterdam canals bikes day", alt: "Amsterdam canal houses boat" },
  "barcelona": { en: "Barcelona", q: "Barcelona Sagrada Familia", alt: "Barcelona Park Guell" },
  "lisboa": { en: "Lisbon", q: "Lisbon yellow tram Alfama", alt: "Lisbon Belem tower", aliases: ["lisbon"] },
  "los angeles": { en: "Los Angeles", q: "Hollywood sign Los Angeles", alt: "Santa Monica pier", aliases: ["la"] },
  "marrakech": { en: "Marrakech", q: "Marrakech Koutoubia mosque", alt: "Marrakech Majorelle garden", aliases: ["marrakesh"] },
  "san miguel de allende": { en: "San Miguel de Allende", q: "San Miguel de Allende parroquia church", alt: "colonial Mexico town colorful street" },
  "singapur": { en: "Singapore", q: "Singapore Marina Bay Sands day", alt: "Singapore Gardens by the Bay", aliases: ["singapore"] },
  "lima": { en: "Lima", q: "Lima Miraflores cliffs Pacific", alt: "Lima Plaza de Armas" },
  "rio de janeiro": { en: "Rio de Janeiro", q: "Rio de Janeiro Christ the Redeemer", alt: "Copacabana beach Rio", aliases: ["rio"] },
  "sao paulo": { en: "Sao Paulo", q: "Sao Paulo Avenida Paulista", alt: "Sao Paulo skyline day" },
  "buenos aires": { en: "Buenos Aires", q: "Buenos Aires Obelisco", alt: "Buenos Aires La Boca Caminito" },
  "monaco": { en: "Monaco", q: "Monaco Monte Carlo harbor yachts", alt: "Monte Carlo casino", aliases: ["montecarlo", "monte carlo"] },
  "bali": { en: "Bali", q: "Bali rice terraces", alt: "Bali temple ocean" },
  "cartagena": { en: "Cartagena", q: "Cartagena Colombia colorful streets", alt: "Cartagena old city walls" },
  "chicago": { en: "Chicago", q: "Chicago Cloud Gate Bean", alt: "Chicago river architecture" },
  "los cabos": { en: "Los Cabos", q: "Cabo San Lucas Arch El Arco", alt: "Los Cabos beach resort" },
  "oaxaca": { en: "Oaxaca", q: "Oaxaca Santo Domingo church", alt: "Oaxaca colorful street" },
  "puerto vallarta": { en: "Puerto Vallarta", q: "Puerto Vallarta Malecon beach", alt: "Puerto Vallarta bay" },
  "san francisco": { en: "San Francisco", q: "Golden Gate Bridge San Francisco", alt: "San Francisco cable car" },
  "toronto": { en: "Toronto", q: "Toronto CN Tower day", alt: "Toronto waterfront" },
  "vancouver": { en: "Vancouver", q: "Vancouver Stanley Park mountains", alt: "Vancouver harbour seaplane" },
  "aspen": { en: "Aspen", q: "Aspen Colorado ski mountain", alt: "snowy mountain ski resort" },
  "ciudad del cabo": { en: "Cape Town", q: "Cape Town Table Mountain", alt: "Cape Town Camps Bay beach", aliases: ["cape town"] },
  "guadalajara": { en: "Guadalajara", q: "Guadalajara cathedral Jalisco", alt: "Guadalajara Hospicio Cabanas" },
  "hamptons": { en: "Hamptons", q: "Hamptons beach house dunes", alt: "Long Island beach summer" },
  "hong kong": { en: "Hong Kong", q: "Hong Kong Peak tram skyline daytime", alt: "Hong Kong star ferry" },
  "jackson hole": { en: "Jackson Hole", q: "Grand Teton Jackson Hole", alt: "Wyoming mountains ranch" },
  "montreal": { en: "Montreal", q: "Old Montreal Notre Dame basilica", alt: "Montreal Mount Royal" },
  "osaka": { en: "Osaka", q: "Osaka castle park cherry blossom", alt: "Osaka Dotonbori canal" },
  "phuket": { en: "Phuket", q: "Phuket longtail boat beach", alt: "Phuket Phi Phi islands" },
  "san jose del cabo": { en: "San Jose del Cabo", q: "San Jose del Cabo mission church", alt: "Baja California desert coast" },
  "sidney": { en: "Sydney", q: "Sydney Opera House day", alt: "Sydney Harbour Bridge", aliases: ["sydney"] },
  "st moritz": { en: "St. Moritz", q: "St Moritz lake Engadin", alt: "Swiss Alps ski village", aliases: ["saint moritz"] },
  "yakarta": { en: "Jakarta", q: "Jakarta Monas monument", alt: "Jakarta skyline day", aliases: ["jakarta"] },
  "bogota": { en: "Bogota", q: "Bogota Monserrate", alt: "Bogota La Candelaria" },
  "boston": { en: "Boston", q: "Boston Back Bay brownstones", alt: "Boston harbor sailboats" },
  "cancun": { en: "Cancun", q: "Cancun turquoise beach", alt: "Cancun hotel zone" },
  "cannes": { en: "Cannes", q: "Cannes Croisette beach", alt: "Cannes harbor yachts" },
  "capri": { en: "Capri", q: "Capri Faraglioni rocks", alt: "Capri boat blue sea" },
  "costa amalfitana": { en: "Amalfi Coast", q: "Positano Amalfi Coast", alt: "Amalfi coast road sea", aliases: ["amalfi", "positano"] },
  "courchevel": { en: "Courchevel", q: "Courchevel ski slopes", alt: "French Alps chalet snow" },
  "florencia": { en: "Florence", q: "Florence Duomo Ponte Vecchio", alt: "Florence Tuscany rooftops", aliases: ["florence", "firenze"] },
  "formentera": { en: "Formentera", q: "Formentera turquoise beach", alt: "Balearic islands clear water" },
  "ginebra": { en: "Geneva", q: "Geneva Jet d Eau lake", alt: "Lake Geneva boats", aliases: ["geneva"] },
  "gstaad": { en: "Gstaad", q: "Gstaad Swiss chalet village", alt: "Swiss Alps green valley" },
  "malibu": { en: "Malibu", q: "Malibu beach cliffs", alt: "Pacific Coast Highway Malibu" },
  "marbella": { en: "Marbella", q: "Marbella Puerto Banus yachts", alt: "Costa del Sol beach" },
  "medellin": { en: "Medellin", q: "Medellin cable car", alt: "Medellin city mountains" },
  "megeve": { en: "Megeve", q: "Megeve village snow", alt: "Mont Blanc ski" },
  "melbourne": { en: "Melbourne", q: "Melbourne Flinders Street", alt: "Melbourne laneway" },
  "miami beach": { en: "Miami Beach", q: "Miami Beach lifeguard tower", alt: "Miami Beach aerial ocean" },
  "monterrey": { en: "Monterrey", q: "Monterrey Cerro de la Silla", alt: "Monterrey Paseo Santa Lucia" },
  "palm beach": { en: "Palm Beach", q: "Palm Beach Worth Avenue palms", alt: "Florida palm beach ocean" },
  "punta mita": { en: "Punta Mita", q: "Punta Mita beach Nayarit", alt: "Riviera Nayarit coast" },
  "queenstown": { en: "Queenstown", q: "Queenstown Lake Wakatipu", alt: "New Zealand mountains lake" },
  "riviera maya": { en: "Riviera Maya", q: "Riviera Maya beach cenote", alt: "Playa del Carmen beach" },
  "vail": { en: "Vail", q: "Vail Colorado gondola summer", alt: "Rocky mountains ski" },
  "venecia": { en: "Venice", q: "Venice gondola Grand Canal", alt: "Venice Rialto bridge", aliases: ["venice", "venezia"] },
  "viena": { en: "Vienna", q: "Vienna Schonbrunn palace", alt: "Vienna Stephansdom", aliases: ["vienna", "wien"] },
  "whistler": { en: "Whistler", q: "Whistler mountain ski", alt: "British Columbia mountains" },
  "zurich": { en: "Zurich", q: "Zurich lake old town", alt: "Zurich Limmat river" },
};

const ALIAS: Record<string, string> = {};
for (const [k, v] of Object.entries(V)) {
  ALIAS[k] = k;
  ALIAS[normText(v.en)] = k;
  for (const a of v.aliases ?? []) ALIAS[normText(a)] = k;
}

const visualOf = (city: string): Visual | null => {
  const k = ALIAS[normText(city)];
  return k ? V[k] : null;
};

/**
 * Consultas de video para una ciudad, en orden: la de su lugar emblemático y la de respaldo. Una
 * ciudad sin entrada usa su nombre con "landmark day" (de día, nunca "night").
 */
export function cityVideoQueries(city: string): string[] {
  const v = visualOf(city);
  if (v) return [v.q, v.alt];
  const name = city.trim();
  return [`${name} landmark day`, `${name} city travel`];
}

/** Nombre canónico de una ciudad dentro de `names` ("Paris", "paris" o "PARÍS" → "París"). */
export function resolveCityName(input: string | null | undefined, names: string[]): string | null {
  const t = normText(input);
  if (!t) return null;
  const direct = names.find((n) => normText(n) === t);
  if (direct) return direct;
  const key = ALIAS[t];
  if (key) {
    const hit = names.find((n) => ALIAS[normText(n)] === key);
    if (hit) return hit;
  }
  // "París, Francia" / "Roma (Italia)": se prueba con la primera parte.
  const first = normText(String(input).split(/[,(]/)[0]);
  if (first && first !== t) return resolveCityName(first, names);
  return null;
}

/** Ciudades con las preferidas (ciudad actual, próximo viaje) al principio y sin repetir. */
export function orderCities(names: string[], preferred: Array<string | null | undefined>): string[] {
  const first: string[] = [];
  for (const p of preferred) {
    const hit = resolveCityName(p, names);
    if (hit && !first.includes(hit)) first.push(hit);
  }
  return [...first, ...names.filter((n) => !first.includes(n))];
}

/** Ciudades cuyo nombre (o alias: "Paris", "CDMX") contiene el texto, sin importar acentos. */
export function matchCities(names: string[], query: string): string[] {
  const q = normText(query);
  if (!q) return names;
  return names.filter((n) => {
    const nn = normText(n);
    if (nn.includes(q)) return true;
    const key = ALIAS[nn];
    if (!key) return false;
    const v = V[key];
    return [v.en, ...(v.aliases ?? [])].some((a) => normText(a).includes(q));
  });
}

// ── Un clip por ciudad ──────────────────────────────────────────────────────────────────────
/** Identidad de un clip de Pexels: el número de video (las URLs de calidad distinta lo comparten). */
export function videoKey(url: string | null | undefined, poster?: string | null): string | null {
  for (const u of [url, poster]) {
    const m = /\/(?:video-files|videos)\/(\d+)\//.exec(String(u ?? ""));
    if (m) return `pexels:${m[1]}`;
  }
  const u = String(url ?? poster ?? "").split("?")[0];
  return u || null;
}

const owners = new Map<string, string>();

/**
 * Reclama un clip para una ciudad. true si es suyo (o ya lo era); false si otra ciudad ya lo
 * tiene: entonces esa tarjeta usa su consulta de respaldo o su foto fija, nunca el mismo video.
 */
export function claimVideo(city: string, key: string | null): boolean {
  if (!key) return false;
  const c = normText(city);
  const owner = owners.get(key);
  if (owner && owner !== c) return false;
  owners.set(key, c);
  return true;
}

/** Solo para pruebas. */
export function __resetVideoClaims() {
  owners.clear();
}
