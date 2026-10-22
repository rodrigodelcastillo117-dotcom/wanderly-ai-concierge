/**
 * Monedas que puede registrar un viajero de IATOS (Gastos y gastos compartidos).
 *
 * Solo es el catálogo (código ISO 4217 + nombre en español). Las tasas salen SIEMPRE de
 * src/lib/fx.ts (en vivo, último guardado o tabla de respaldo, con fuente y fecha): aquí no hay
 * ninguna tasa. Si una moneda no tiene tasa, el monto se muestra en su propia moneda y se avisa
 * "sin tipo de cambio disponible"; nunca se toma 1:1.
 */

export type CurrencyInfo = { code: string; name: string };

/** Las más usadas por los viajeros de IATOS, en este orden (salen primero en el selector). */
export const POPULAR_CURRENCIES = ["MXN", "USD", "EUR", "GBP", "CAD", "JPY"] as const;

/** Catálogo completo, A-Z por nombre dentro del selector. */
export const CURRENCIES: CurrencyInfo[] = [
  { code: "MXN", name: "Peso mexicano" },
  { code: "USD", name: "Dólar estadounidense" },
  { code: "EUR", name: "Euro" },
  { code: "GBP", name: "Libra esterlina" },
  { code: "CAD", name: "Dólar canadiense" },
  { code: "JPY", name: "Yen japonés" },
  { code: "CHF", name: "Franco suizo" },
  { code: "AUD", name: "Dólar australiano" },
  { code: "NZD", name: "Dólar neozelandés" },
  { code: "BRL", name: "Real brasileño" },
  { code: "ARS", name: "Peso argentino" },
  { code: "COP", name: "Peso colombiano" },
  { code: "CLP", name: "Peso chileno" },
  { code: "PEN", name: "Sol peruano" },
  { code: "UYU", name: "Peso uruguayo" },
  { code: "BOB", name: "Boliviano" },
  { code: "PYG", name: "Guaraní paraguayo" },
  { code: "DOP", name: "Peso dominicano" },
  { code: "CRC", name: "Colón costarricense" },
  { code: "GTQ", name: "Quetzal guatemalteco" },
  { code: "CNY", name: "Yuan chino" },
  { code: "HKD", name: "Dólar de Hong Kong" },
  { code: "KRW", name: "Won surcoreano" },
  { code: "SGD", name: "Dólar de Singapur" },
  { code: "THB", name: "Baht tailandés" },
  { code: "MYR", name: "Ringgit malayo" },
  { code: "IDR", name: "Rupia indonesia" },
  { code: "PHP", name: "Peso filipino" },
  { code: "VND", name: "Dong vietnamita" },
  { code: "INR", name: "Rupia india" },
  { code: "AED", name: "Dírham de Emiratos Árabes" },
  { code: "SAR", name: "Riyal saudí" },
  { code: "QAR", name: "Riyal catarí" },
  { code: "ILS", name: "Nuevo séquel israelí" },
  { code: "TRY", name: "Lira turca" },
  { code: "EGP", name: "Libra egipcia" },
  { code: "MAD", name: "Dírham marroquí" },
  { code: "ZAR", name: "Rand sudafricano" },
  { code: "DKK", name: "Corona danesa" },
  { code: "SEK", name: "Corona sueca" },
  { code: "NOK", name: "Corona noruega" },
  { code: "ISK", name: "Corona islandesa" },
  { code: "CZK", name: "Corona checa" },
  { code: "PLN", name: "Esloti polaco" },
  { code: "HUF", name: "Forinto húngaro" },
];

const BY_CODE = new Map(CURRENCIES.map((c) => [c.code, c]));

export function currencyName(code: string): string | null {
  return BY_CODE.get(String(code || "").toUpperCase())?.name ?? null;
}

/** "JPY · Yen japonés" (o solo el código si no está en el catálogo, p. ej. filas viejas). */
export function currencyLabel(code: string): string {
  const c = String(code || "").toUpperCase();
  const n = currencyName(c);
  return n ? `${c} · ${n}` : c;
}

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();

/**
 * Moneda local del destino de un viaje ("Tokio, Japón" → JPY). Se busca primero en
 * pais_destino y luego en el texto del destino. null si no se reconoce: entonces no se sugiere
 * nada (mejor no sugerir que sugerir mal).
 */
const DESTINATION_CURRENCY: [RegExp, string][] = [
  [/\b(mexico|cdmx|baja california|bcs|cancun|tulum|oaxaca|guadalajara|monterrey|merida|los cabos|puerto vallarta|playa del carmen|san miguel de allende|puebla)\b/, "MXN"],
  [/\b(estados unidos|eeuu|ee\.?uu\.?|usa|united states|nueva york|new york|miami|los angeles|las vegas|san francisco|chicago|orlando|houston|hawai|hawaii|puerto rico)\b/, "USD"],
  [/\b(canada|toronto|vancouver|montreal|quebec|banff)\b/, "CAD"],
  [/\b(reino unido|inglaterra|escocia|gales|londres|london|edimburgo|edinburgh|manchester|liverpool|united kingdom|uk)\b/, "GBP"],
  [/\b(espana|madrid|barcelona|sevilla|valencia|francia|paris|niza|lyon|italia|roma|milan|florencia|venecia|napoles|alemania|berlin|munich|frankfurt|portugal|lisboa|oporto|paises bajos|holanda|amsterdam|belgica|bruselas|austria|viena|grecia|atenas|santorini|mykonos|irlanda|dublin|finlandia|helsinki|croacia|dubrovnik|split|eslovenia|eslovaquia|estonia|letonia|lituania|luxemburgo|malta|chipre|monaco|montecarlo)\b/, "EUR"],
  [/\b(suiza|zurich|ginebra|lucerna|zermatt|interlaken)\b/, "CHF"],
  [/\b(japon|tokio|tokyo|kioto|kyoto|osaka|hokkaido|nara)\b/, "JPY"],
  [/\b(china|pekin|beijing|shanghai|shangai|canton|guangzhou|shenzhen)\b/, "CNY"],
  [/\b(hong kong)\b/, "HKD"],
  [/\b(corea|seul|seoul|busan)\b/, "KRW"],
  [/\b(singapur|singapore)\b/, "SGD"],
  [/\b(tailandia|bangkok|phuket|chiang mai|krabi)\b/, "THB"],
  [/\b(malasia|kuala lumpur)\b/, "MYR"],
  [/\b(indonesia|bali|yakarta|jakarta)\b/, "IDR"],
  [/\b(filipinas|manila|palawan|cebu)\b/, "PHP"],
  [/\b(vietnam|hanoi|ho chi minh|saigon|ha long)\b/, "VND"],
  [/\b(india|nueva delhi|delhi|bombay|mumbai|jaipur|agra|goa)\b/, "INR"],
  [/\b(emiratos|dubai|abu dhabi)\b/, "AED"],
  [/\b(arabia saudita|arabia saudi|riad|riyadh|yeda|jeddah)\b/, "SAR"],
  [/\b(qatar|catar|doha)\b/, "QAR"],
  [/\b(israel|tel aviv|jerusalen)\b/, "ILS"],
  [/\b(turquia|estambul|istanbul|capadocia|antalya)\b/, "TRY"],
  [/\b(egipto|el cairo|cairo|luxor|giza)\b/, "EGP"],
  [/\b(marruecos|marrakech|marrakesh|fez|casablanca|tanger)\b/, "MAD"],
  [/\b(sudafrica|ciudad del cabo|cape town|johannesburgo)\b/, "ZAR"],
  [/\b(australia|sidney|sydney|melbourne|brisbane|perth)\b/, "AUD"],
  [/\b(nueva zelanda|new zealand|auckland|queenstown|wellington)\b/, "NZD"],
  [/\b(brasil|rio de janeiro|sao paulo|florianopolis|salvador de bahia)\b/, "BRL"],
  [/\b(argentina|buenos aires|bariloche|mendoza|ushuaia|el calafate)\b/, "ARS"],
  [/\b(colombia|bogota|medellin|cartagena|cali)\b/, "COP"],
  [/\b(chile|santiago de chile|valparaiso|atacama|torres del paine)\b/, "CLP"],
  [/\b(peru|lima|cusco|cuzco|machu picchu|arequipa)\b/, "PEN"],
  [/\b(uruguay|montevideo|punta del este)\b/, "UYU"],
  [/\b(bolivia|la paz|uyuni|santa cruz de la sierra)\b/, "BOB"],
  [/\b(paraguay|asuncion)\b/, "PYG"],
  [/\b(republica dominicana|punta cana|santo domingo)\b/, "DOP"],
  [/\b(costa rica|san jose de costa rica|guanacaste)\b/, "CRC"],
  [/\b(guatemala|antigua guatemala)\b/, "GTQ"],
  [/\b(dinamarca|copenhague)\b/, "DKK"],
  [/\b(suecia|estocolmo)\b/, "SEK"],
  [/\b(noruega|oslo|bergen|tromso)\b/, "NOK"],
  [/\b(islandia|reikiavik|reykjavik)\b/, "ISK"],
  [/\b(republica checa|chequia|praga)\b/, "CZK"],
  [/\b(polonia|varsovia|cracovia)\b/, "PLN"],
  [/\b(hungria|budapest)\b/, "HUF"],
];

export function destinationCurrency(trip: { destino?: string | null; pais_destino?: string | null } | null | undefined): string | null {
  if (!trip) return null;
  for (const text of [trip.pais_destino, trip.destino]) {
    if (!text) continue;
    const t = norm(text);
    for (const [re, code] of DESTINATION_CURRENCY) if (re.test(t)) return code;
  }
  return null;
}

/**
 * Orden del selector: sugerida (destino del viaje) → las que ya usaste (más usadas primero) →
 * las populares → el resto A-Z. Sin duplicados. `used` = monedas de los gastos ya registrados.
 */
export function orderedCurrencies(opts: { suggested?: string | null; used?: string[] } = {}): {
  suggested: CurrencyInfo | null;
  frequent: CurrencyInfo[];
  rest: CurrencyInfo[];
} {
  const sug = opts.suggested ? BY_CODE.get(opts.suggested.toUpperCase()) ?? null : null;
  const counts = new Map<string, number>();
  for (const c of opts.used ?? []) {
    const k = String(c || "").toUpperCase();
    if (BY_CODE.has(k)) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const usedSorted = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
  const frequentCodes: string[] = [];
  for (const k of [...usedSorted, ...POPULAR_CURRENCIES]) {
    if (k !== sug?.code && !frequentCodes.includes(k)) frequentCodes.push(k);
  }
  const taken = new Set([...(sug ? [sug.code] : []), ...frequentCodes]);
  const rest = CURRENCIES.filter((c) => !taken.has(c.code)).sort((a, b) => a.name.localeCompare(b.name, "es"));
  return { suggested: sug, frequent: frequentCodes.map((k) => BY_CODE.get(k)!), rest };
}

/** Búsqueda por código, nombre o país ("yen", "jpy", "japon"). Sin acentos ni mayúsculas. */
export function matchesCurrency(c: CurrencyInfo, query: string): boolean {
  const q = norm(query);
  if (!q) return true;
  if (norm(c.code).includes(q) || norm(c.name).includes(q)) return true;
  // Por país o ciudad: "japon" encuentra JPY.
  return q.length >= 3 && DESTINATION_CURRENCY.some(([re, code]) => code === c.code && re.source.includes(q));
}
