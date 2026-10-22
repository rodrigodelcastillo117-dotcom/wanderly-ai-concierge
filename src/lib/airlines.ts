/**
 * Aerolínea → código IATA → logo. El logo sale del CDN de logos de aerolíneas de Travelpayouts
 * (socio de IATOS; lo da justo para esto): https://pics.avs.io/{w}/{h}/{IATA}.png. No cuesta ni
 * gasta llamadas a funciones. Nunca se toman logos del sitio de cada aerolínea.
 *
 * Acepta nombres ("Aeroméxico", "Viva Aerobus", "aeromexico connect"), códigos ("AM") y números de
 * vuelo ("AM 401", "Y4-1234", "VB1023").
 */

/** IATA → nombres y alias (sin acentos, en minúsculas). El primero es el nombre para mostrar. */
const AIRLINES: Record<string, string[]> = {
  AM: ["Aeroméxico", "aeromexico", "aeromexico connect", "aero mexico"],
  Y4: ["Volaris", "volaris"],
  VB: ["Viva Aerobus", "viva aerobus", "vivaaerobus", "viva"],
  "4O": ["Interjet", "interjet"],
  QA: ["Magnicharters", "magnicharters"],
  "6W": ["Aerus", "aerus"],
  AA: ["American Airlines", "american airlines", "american"],
  UA: ["United", "united airlines", "united"],
  DL: ["Delta", "delta air lines", "delta airlines", "delta"],
  AS: ["Alaska Airlines", "alaska airlines", "alaska"],
  WN: ["Southwest", "southwest airlines", "southwest"],
  B6: ["JetBlue", "jetblue", "jet blue"],
  NK: ["Spirit", "spirit airlines", "spirit"],
  F9: ["Frontier", "frontier airlines", "frontier"],
  AC: ["Air Canada", "air canada"],
  WS: ["WestJet", "westjet"],
  IB: ["Iberia", "iberia", "iberia express"],
  UX: ["Air Europa", "air europa"],
  VY: ["Vueling", "vueling"],
  AF: ["Air France", "air france"],
  KL: ["KLM", "klm", "klm royal dutch airlines"],
  LH: ["Lufthansa", "lufthansa"],
  LX: ["SWISS", "swiss", "swiss international air lines"],
  OS: ["Austrian", "austrian airlines", "austrian"],
  SN: ["Brussels Airlines", "brussels airlines"],
  BA: ["British Airways", "british airways"],
  VS: ["Virgin Atlantic", "virgin atlantic"],
  EI: ["Aer Lingus", "aer lingus"],
  AZ: ["ITA Airways", "ita airways", "alitalia"],
  TP: ["TAP Air Portugal", "tap air portugal", "tap portugal", "tap"],
  SK: ["SAS", "sas", "scandinavian airlines"],
  AY: ["Finnair", "finnair"],
  LO: ["LOT", "lot polish airlines", "lot"],
  A3: ["Aegean", "aegean airlines", "aegean"],
  U2: ["easyJet", "easyjet"],
  FR: ["Ryanair", "ryanair"],
  W6: ["Wizz Air", "wizz air", "wizzair"],
  TK: ["Turkish Airlines", "turkish airlines", "turkish"],
  EK: ["Emirates", "emirates"],
  QR: ["Qatar Airways", "qatar airways", "qatar"],
  EY: ["Etihad", "etihad airways", "etihad"],
  SV: ["Saudia", "saudia"],
  NH: ["ANA", "ana", "all nippon airways"],
  JL: ["JAL", "jal", "japan airlines"],
  KE: ["Korean Air", "korean air"],
  OZ: ["Asiana", "asiana airlines", "asiana"],
  CX: ["Cathay Pacific", "cathay pacific", "cathay"],
  SQ: ["Singapore Airlines", "singapore airlines"],
  TG: ["Thai Airways", "thai airways", "thai"],
  CA: ["Air China", "air china"],
  MU: ["China Eastern", "china eastern"],
  CZ: ["China Southern", "china southern"],
  QF: ["Qantas", "qantas"],
  NZ: ["Air New Zealand", "air new zealand"],
  CM: ["Copa Airlines", "copa airlines", "copa"],
  AV: ["Avianca", "avianca"],
  LA: ["LATAM", "latam airlines", "latam"],
  AR: ["Aerolíneas Argentinas", "aerolineas argentinas"],
  H2: ["SKY Airline", "sky airline"],
  JA: ["JetSMART", "jetsmart"],
  G3: ["GOL", "gol linhas aereas", "gol"],
  AD: ["Azul", "azul linhas aereas", "azul"],
  "2K": ["Avianca Ecuador", "avianca ecuador"],
  AT: ["Royal Air Maroc", "royal air maroc"],
  ET: ["Ethiopian Airlines", "ethiopian airlines", "ethiopian"],
  MS: ["EgyptAir", "egyptair"],
  AI: ["Air India", "air india"],
  HA: ["Hawaiian Airlines", "hawaiian airlines", "hawaiian"],
  WK: ["Edelweiss", "edelweiss air", "edelweiss"],
  DE: ["Condor", "condor"],
  EW: ["Eurowings", "eurowings"],
  "4Y": ["Discover Airlines", "discover airlines"],
};

const norm = (v: unknown) =>
  String(v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// Alias más largos primero: "american airlines" antes que "american"; "viva aerobus" antes que "viva".
const ALIASES: Array<[string, string]> = Object.entries(AIRLINES)
  .flatMap(([code, names]) => names.slice(1).map((a) => [norm(a), code] as [string, string]))
  .sort((a, b) => b[0].length - a[0].length);

const isCode = (c: string) => /^[A-Z0-9]{2}$/.test(c) && /[A-Z]/.test(c);

/**
 * Código IATA de una aerolínea a partir de su nombre, su código o un número de vuelo. null si no se
 * reconoce (entonces no se muestra logo: nunca uno adivinado).
 */
export function airlineCode(input: unknown): string | null {
  const raw = String(input ?? "").trim();
  if (!raw) return null;
  // Número de vuelo: "AM 401", "AM401", "Y4-1234", "vb 1023".
  const flight = raw.toUpperCase().match(/^([A-Z0-9]{2})\s*-?\s*(\d{1,4})[A-Z]?$/);
  if (flight && isCode(flight[1]) && AIRLINES[flight[1]]) return flight[1];
  // Código solo: "AM".
  if (/^[A-Za-z0-9]{2}$/.test(raw) && AIRLINES[raw.toUpperCase()]) return raw.toUpperCase();
  const n = ` ${norm(raw)} `;
  for (const [alias, code] of ALIASES) {
    if (n.includes(` ${alias} `)) return code;
  }
  // "Vuelo AM 401 a Madrid": un número de vuelo dentro del texto.
  // Sin pasar a mayúsculas: "12 de 2024" no es un vuelo de Condor (DE).
  const inText = raw.match(/\b([A-Z0-9]{2})\s?(\d{2,4})\b/);
  if (inText && isCode(inText[1]) && AIRLINES[inText[1]]) return inText[1];
  return null;
}

/** Nombre para mostrar de un código ("AM" → "Aeroméxico"). */
export function airlineName(code: string | null | undefined): string | null {
  return code && AIRLINES[code.toUpperCase()] ? AIRLINES[code.toUpperCase()][0] : null;
}

/**
 * Logo del CDN de Travelpayouts. Por defecto cuadrado (200×200); con alto distinto da el logotipo
 * horizontal (p. ej. 240×80), que se lee mejor en una ficha. `retina` pide la versión @2x.
 */
export function airlineLogoUrl(code: string, width = 200, height = width, retina = false): string | null {
  const c = String(code ?? "").toUpperCase();
  if (!isCode(c)) return null;
  const clamp = (n: number) => Math.min(Math.max(Math.round(n), 16), 600);
  return `https://pics.avs.io/${clamp(width)}/${clamp(height)}/${c}${retina ? "@2x" : ""}.png`;
}

/** Logo de lo que venga (nombre, código o número de vuelo); null si no se reconoce. */
export function airlineLogoFor(input: unknown, width = 200, height = width, retina = false): string | null {
  const code = airlineCode(input);
  return code ? airlineLogoUrl(code, width, height, retina) : null;
}
