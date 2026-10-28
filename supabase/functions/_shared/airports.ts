// Ciudades → aeropuertos (IATA), área metropolitana, país y región. Sin Deno: lo usan el cliente
// (enlaces de compra) y las funciones (validar tarifas). Reúne y amplía la tabla rápida que ya tenían
// flights-search y serpapi-quote ("roma" → FCO…).
//
// Para qué sirve cada dato:
//  - `airports`: el primero es el aeropuerto principal; es el que se manda a Google Flights. Un código
//    de ciudad (ROM, BUH, PAR) en la búsqueda tfs deja el campo vacío: así abrió Google Flights "sin
//    destino" con la tarifa MEX→BUH del caso Roma → Florencia → Venecia (22-oct-2026).
//  - `metro`: código de ciudad de Travelpayouts/IATA. Una tarifa a otro aeropuerto de la misma área
//    (CIA para Roma, BGY para Milán) es válida; a otra ciudad (BUH = Bucarest) no.
//  - `lat`/`lng`: para descartar duraciones absurdas para la distancia de la ruta.
//  - `region`: para descartar aerolíneas regionales en rutas intercontinentales (Volaris a Europa).

export type Region = "NA" | "SA" | "EU" | "ME" | "AF" | "AS" | "OC";

export type CityAirports = {
  /** Nombre para mostrar (español). */
  name: string;
  metro: string;
  airports: string[];
  country: string;
  iso2: string;
  region: Region;
  lat: number;
  lng: number;
  /** Otros nombres (inglés, local, sin acentos). */
  aliases?: string[];
};

const C = (name: string, metro: string, airports: string[], country: string, iso2: string, region: Region, lat: number, lng: number, aliases: string[] = []): CityAirports =>
  ({ name, metro, airports, country, iso2, region, lat, lng, aliases });

export const CITIES: CityAirports[] = [
  // México
  C("Ciudad de México", "MEX", ["MEX", "NLU"], "México", "MX", "NA", 19.436, -99.072, ["mexico city", "cdmx", "mexico df", "mexico d f", "df", "ciudad de mexico cdmx"]),
  C("Guadalajara", "GDL", ["GDL"], "México", "MX", "NA", 20.522, -103.311),
  C("Monterrey", "MTY", ["MTY"], "México", "MX", "NA", 25.778, -100.107),
  C("Cancún", "CUN", ["CUN"], "México", "MX", "NA", 21.036, -86.877, ["cancun"]),
  C("Tijuana", "TIJ", ["TIJ"], "México", "MX", "NA", 32.541, -116.97),
  C("Puerto Vallarta", "PVR", ["PVR"], "México", "MX", "NA", 20.68, -105.254),
  C("Los Cabos", "SJD", ["SJD"], "México", "MX", "NA", 23.152, -109.721, ["cabo san lucas", "san jose del cabo"]),
  C("Oaxaca", "OAX", ["OAX"], "México", "MX", "NA", 17.0, -96.727),
  C("Mérida", "MID", ["MID"], "México", "MX", "NA", 20.937, -89.658, ["merida"]),
  C("Querétaro", "QRO", ["QRO"], "México", "MX", "NA", 20.617, -100.186, ["queretaro"]),
  // Norteamérica y Caribe
  C("Nueva York", "NYC", ["JFK", "EWR", "LGA"], "Estados Unidos", "US", "NA", 40.641, -73.778, ["new york", "nyc", "nueva york city"]),
  C("Los Ángeles", "LAX", ["LAX"], "Estados Unidos", "US", "NA", 33.942, -118.408, ["los angeles", "la"]),
  C("Miami", "MIA", ["MIA", "FLL"], "Estados Unidos", "US", "NA", 25.795, -80.287),
  C("Chicago", "CHI", ["ORD", "MDW"], "Estados Unidos", "US", "NA", 41.974, -87.907),
  C("Houston", "HOU", ["IAH", "HOU"], "Estados Unidos", "US", "NA", 29.99, -95.337),
  C("Dallas", "DFW", ["DFW", "DAL"], "Estados Unidos", "US", "NA", 32.899, -97.04),
  C("Toronto", "YTO", ["YYZ"], "Canadá", "CA", "NA", 43.677, -79.625),
  C("Bogotá", "BOG", ["BOG"], "Colombia", "CO", "SA", 4.702, -74.147, ["bogota"]),
  C("Lima", "LIM", ["LIM"], "Perú", "PE", "SA", -12.022, -77.114),
  C("Buenos Aires", "BUE", ["EZE", "AEP"], "Argentina", "AR", "SA", -34.822, -58.536),
  // Europa
  C("Madrid", "MAD", ["MAD"], "España", "ES", "EU", 40.472, -3.561),
  C("Barcelona", "BCN", ["BCN"], "España", "ES", "EU", 41.297, 2.078),
  C("Sevilla", "SVQ", ["SVQ"], "España", "ES", "EU", 37.418, -5.893, ["seville"]),
  C("París", "PAR", ["CDG", "ORY"], "Francia", "FR", "EU", 49.01, 2.548, ["paris"]),
  C("Niza", "NCE", ["NCE"], "Francia", "FR", "EU", 43.658, 7.216, ["nice"]),
  C("Londres", "LON", ["LHR", "LGW", "STN", "LTN", "LCY"], "Reino Unido", "GB", "EU", 51.47, -0.454, ["london"]),
  C("Roma", "ROM", ["FCO", "CIA"], "Italia", "IT", "EU", 41.8, 12.239, ["rome"]),
  C("Milán", "MIL", ["MXP", "LIN", "BGY"], "Italia", "IT", "EU", 45.63, 8.723, ["milan", "milano"]),
  C("Bérgamo", "BGY", ["BGY"], "Italia", "IT", "EU", 45.669, 9.704, ["bergamo"]),
  C("Venecia", "VCE", ["VCE", "TSF"], "Italia", "IT", "EU", 45.505, 12.352, ["venice", "venezia"]),
  C("Florencia", "FLR", ["FLR"], "Italia", "IT", "EU", 43.81, 11.205, ["florence", "firenze"]),
  C("Pisa", "PSA", ["PSA"], "Italia", "IT", "EU", 43.684, 10.393),
  C("Nápoles", "NAP", ["NAP"], "Italia", "IT", "EU", 40.886, 14.291, ["napoles", "naples", "napoli"]),
  C("Bolonia", "BLQ", ["BLQ"], "Italia", "IT", "EU", 44.535, 11.289, ["bologna"]),
  C("Atenas", "ATH", ["ATH"], "Grecia", "GR", "EU", 37.936, 23.947, ["athens"]),
  C("Santorini", "JTR", ["JTR"], "Grecia", "GR", "EU", 36.399, 25.479),
  C("Mykonos", "JMK", ["JMK"], "Grecia", "GR", "EU", 37.435, 25.348, ["miconos"]),
  C("Estambul", "IST", ["IST", "SAW"], "Turquía", "TR", "EU", 41.262, 28.742, ["istanbul"]),
  C("Lisboa", "LIS", ["LIS"], "Portugal", "PT", "EU", 38.774, -9.134, ["lisbon"]),
  C("Oporto", "OPO", ["OPO"], "Portugal", "PT", "EU", 41.248, -8.681, ["porto"]),
  C("Ámsterdam", "AMS", ["AMS"], "Países Bajos", "NL", "EU", 52.31, 4.768, ["amsterdam"]),
  C("Berlín", "BER", ["BER"], "Alemania", "DE", "EU", 52.366, 13.503, ["berlin"]),
  C("Múnich", "MUC", ["MUC"], "Alemania", "DE", "EU", 48.354, 11.786, ["munich", "munchen"]),
  C("Fráncfort", "FRA", ["FRA"], "Alemania", "DE", "EU", 50.038, 8.562, ["frankfurt", "francfort"]),
  C("Viena", "VIE", ["VIE"], "Austria", "AT", "EU", 48.11, 16.57, ["vienna", "wien"]),
  C("Praga", "PRG", ["PRG"], "Chequia", "CZ", "EU", 50.101, 14.26, ["prague", "praha"]),
  C("Budapest", "BUD", ["BUD"], "Hungría", "HU", "EU", 47.439, 19.262),
  C("Zúrich", "ZRH", ["ZRH"], "Suiza", "CH", "EU", 47.458, 8.555, ["zurich"]),
  C("Ginebra", "GVA", ["GVA"], "Suiza", "CH", "EU", 46.238, 6.109, ["geneva", "geneve"]),
  C("Dublín", "DUB", ["DUB"], "Irlanda", "IE", "EU", 53.421, -6.27, ["dublin"]),
  C("Edimburgo", "EDI", ["EDI"], "Reino Unido", "GB", "EU", 55.95, -3.373, ["edinburgh"]),
  C("Copenhague", "CPH", ["CPH"], "Dinamarca", "DK", "EU", 55.618, 12.656, ["copenhagen"]),
  C("Bucarest", "BUH", ["OTP", "BBU"], "Rumania", "RO", "EU", 44.571, 26.085, ["bucharest", "bucuresti"]),
  // Medio Oriente, Asia, Oceanía
  C("Dubái", "DXB", ["DXB", "DWC"], "Emiratos Árabes Unidos", "AE", "ME", 25.253, 55.364, ["dubai"]),
  C("Doha", "DOH", ["DOH"], "Catar", "QA", "ME", 25.273, 51.608),
  // Arabia Saudita y Sudáfrica (caso Diego, 28-oct-2026: Arabia, crucero, Cape Town): coordenadas del aeropuerto.
  C("Riad", "RUH", ["RUH"], "Arabia Saudita", "SA", "ME", 24.958, 46.699, ["riyadh", "riyad"]),
  C("Yeda", "JED", ["JED"], "Arabia Saudita", "SA", "ME", 21.68, 39.157, ["jeddah", "jedda", "jidda", "yida"]),
  C("AlUla", "ULH", ["ULH"], "Arabia Saudita", "SA", "ME", 26.483, 38.117, ["al ula", "alula", "al-ula"]),
  C("Ciudad del Cabo", "CPT", ["CPT"], "Sudáfrica", "ZA", "AF", -33.965, 18.602, ["cape town", "capetown"]),
  C("Tokio", "TYO", ["HND", "NRT"], "Japón", "JP", "AS", 35.552, 139.78, ["tokyo"]),
  C("Bali", "DPS", ["DPS"], "Indonesia", "ID", "AS", -8.748, 115.167),
  C("Bangkok", "BKK", ["BKK", "DMK"], "Tailandia", "TH", "AS", 13.69, 100.75),
  C("Singapur", "SIN", ["SIN"], "Singapur", "SG", "AS", 1.364, 103.991, ["singapore"]),
  C("Hong Kong", "HKG", ["HKG"], "Hong Kong", "HK", "AS", 22.308, 113.918),
  C("Sídney", "SYD", ["SYD"], "Australia", "AU", "OC", -33.946, 151.177, ["sydney", "sidney"]),
  // Rutas por país (destino "India", "Japón", "Perú"…): ciudades de entrada/salida y tramos internos.
  C("Delhi", "DEL", ["DEL"], "India", "IN", "AS", 28.556, 77.1, ["nueva delhi", "new delhi", "delhi"]),
  C("Mumbai", "BOM", ["BOM"], "India", "IN", "AS", 19.089, 72.868, ["bombay"]),
  C("Jaipur", "JAI", ["JAI"], "India", "IN", "AS", 26.824, 75.812),
  C("Agra", "AGR", ["AGR"], "India", "IN", "AS", 27.156, 77.961),
  C("Udaipur", "UDR", ["UDR"], "India", "IN", "AS", 24.618, 73.896),
  C("Osaka", "OSA", ["KIX", "ITM"], "Japón", "JP", "AS", 34.434, 135.244),
  C("Cusco", "CUZ", ["CUZ"], "Perú", "PE", "SA", -13.536, -71.939, ["cuzco"]),
  C("Marrakech", "RAK", ["RAK"], "Marruecos", "MA", "AF", 31.607, -8.036, ["marrakesh"]),
  C("El Cairo", "CAI", ["CAI"], "Egipto", "EG", "AF", 30.122, 31.406, ["cairo", "el cairo"]),
  C("Luxor", "LXR", ["LXR"], "Egipto", "EG", "AF", 25.671, 32.707),
  C("Phuket", "HKT", ["HKT"], "Tailandia", "TH", "AS", 8.113, 98.317),
  C("Chiang Mai", "CNX", ["CNX"], "Tailandia", "TH", "AS", 18.767, 98.963),
];

/** Normaliza un nombre de ciudad: sin acentos, minúsculas, sin "(vía …)", sin país tras la coma. */
export function normCity(s: unknown): string {
  return String(s ?? "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")
    .split(",")[0]
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const BY_NAME = new Map<string, CityAirports>();
const BY_CODE = new Map<string, CityAirports>();
for (const c of CITIES) {
  for (const n of [c.name, ...(c.aliases ?? [])]) BY_NAME.set(normCity(n), c);
  if (!BY_CODE.has(c.metro)) BY_CODE.set(c.metro, c);
}
// Los aeropuertos van después: un código que es aeropuerto de una ciudad y "ciudad" de otra (BGY)
// se queda con su propia ciudad.
for (const c of CITIES) for (const a of c.airports) if (!BY_CODE.has(a)) BY_CODE.set(a, c);

/**
 * Ciudad conocida a partir de un nombre ("Ciudad de México ", "Roma", "Venice, Italy") o un código
 * IATA (aeropuerto o ciudad). null si no se reconoce: quien llama no debe inventar un código.
 */
export function cityAirports(input: unknown): CityAirports | null {
  const raw = String(input ?? "").trim();
  if (!raw) return null;
  if (/^[A-Za-z]{3}$/.test(raw) && BY_CODE.has(raw.toUpperCase())) return BY_CODE.get(raw.toUpperCase())!;
  return BY_NAME.get(normCity(raw)) ?? null;
}

/** Aeropuerto principal (para Google Flights / Kayak) de una ciudad o código. null si no se sabe. */
export function mainAirport(input: unknown): string | null {
  const raw = String(input ?? "").trim();
  if (/^[A-Za-z]{3}$/.test(raw)) {
    const code = raw.toUpperCase();
    const c = BY_CODE.get(code);
    // Un aeropuerto conocido se respeta tal cual; un código de ciudad se cambia por su aeropuerto.
    if (c) return c.airports.includes(code) ? code : c.airports[0];
    return null;
  }
  return cityAirports(raw)?.airports[0] ?? null;
}

/**
 * ¿El código (aeropuerto o ciudad) pertenece al área de la ciudad pedida? Roma acepta FCO, CIA y
 * ROM; Bucarest (BUH/OTP) no es Roma. Con una ciudad desconocida devuelve null (no se puede saber).
 */
export function codeServesCity(code: unknown, city: unknown): boolean | null {
  const want = cityAirports(city);
  const c = String(code ?? "").trim().toUpperCase();
  if (!want || !/^[A-Z]{3}$/.test(c)) return null;
  return c === want.metro || want.airports.includes(c);
}

const rad = (d: number) => (d * Math.PI) / 180;
const kmBetween = (x: { lat: number; lng: number }, y: { lat: number; lng: number }) => {
  const dLat = rad(y.lat - x.lat);
  const dLng = rad(y.lng - x.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(x.lat)) * Math.cos(rad(y.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * 6371 * Math.asin(Math.sqrt(h)));
};
/** Distancia de gran círculo en km entre dos ciudades/códigos conocidos (null si falta alguno). */
export function distanceKm(a: unknown, b: unknown): number | null {
  const x = cityAirports(a);
  const y = cityAirports(b);
  if (!x || !y) return null;
  return kmBetween(x, y);
}

// ───── Lugares sin aeropuerto propio ─────
// Bases de viaje frecuentes (regiones de _shared/regions.ts y escapadas clásicas) que no tienen
// aeropuerto comercial. Solo coordenadas (centro del lugar): el vuelo va al aeropuerto de la tabla
// de arriba más cercano en línea recta. No entran en cityAirports/mainAirport (no se inventa un código).
type Town = { name: string; iso2: string; lat: number; lng: number; aliases?: string[] };
const T = (name: string, iso2: string, lat: number, lng: number, aliases: string[] = []): Town => ({ name, iso2, lat, lng, aliases });
export const TOWNS: Town[] = [
  // Toscana
  T("Siena", "IT", 43.318, 11.331), T("San Gimignano", "IT", 43.468, 11.043), T("Lucca", "IT", 43.843, 10.505),
  T("Arezzo", "IT", 43.463, 11.88), T("Montepulciano", "IT", 43.098, 11.787), T("Pistoia", "IT", 43.933, 10.917),
  T("Prato", "IT", 43.88, 11.097), T("Livorno", "IT", 43.548, 10.311), T("Grosseto", "IT", 42.763, 11.112),
  T("Massa-Carrara", "IT", 44.035, 10.139, ["massa", "carrara", "massa carrara"]), T("La Spezia", "IT", 44.102, 9.824),
  // Costa Amalfitana, Capri y Lago de Como
  T("Positano", "IT", 40.628, 14.485), T("Amalfi", "IT", 40.634, 14.603), T("Ravello", "IT", 40.649, 14.612),
  T("Sorrento", "IT", 40.626, 14.376), T("Capri", "IT", 40.551, 14.243),
  T("Como", "IT", 45.808, 9.085), T("Bellagio", "IT", 45.987, 9.262), T("Varenna", "IT", 46.01, 9.284),
  // Riviera Francesa, España, Portugal, Francia, Reino Unido
  T("Cannes", "FR", 43.552, 7.017), T("Mónaco", "MC", 43.738, 7.424, ["monaco", "monte carlo", "montecarlo"]),
  T("Toledo", "ES", 39.857, -4.024), T("Segovia", "ES", 40.943, -4.118),
  T("Sintra", "PT", 38.8, -9.381), T("Cascais", "PT", 38.697, -9.421),
  T("Versalles", "FR", 48.805, 2.12, ["versailles"]), T("Oxford", "GB", 51.752, -1.258),
  // Japón y México
  T("Kioto", "JP", 35.011, 135.768, ["kyoto"]), T("Nara", "JP", 34.685, 135.805), T("Hakone", "JP", 35.232, 139.107),
  T("Playa del Carmen", "MX", 20.629, -87.073), T("San Miguel de Allende", "MX", 20.914, -100.744),
  // Escapadas por carretera desde CDMX, sin aeropuerto comercial (caso Tepoztlán, 27-oct-2026).
  T("Tepoztlán", "MX", 18.985, -99.1, ["tepoztlan"]), T("Valle de Bravo", "MX", 19.195, -100.131), T("Taxco", "MX", 18.556, -99.605),
  T("Malinalco", "MX", 18.948, -99.495), T("Tequisquiapan", "MX", 20.522, -99.892),
];
const TOWN_BY_NAME = new Map<string, Town>();
for (const t of TOWNS) for (const n of [t.name, ...(t.aliases ?? [])]) TOWN_BY_NAME.set(normCity(n), t);

/** Coordenadas de una ciudad con aeropuerto o de un lugar sin aeropuerto (TOWNS); null si no se conoce. */
export function placeCoords(input: unknown): { lat: number; lng: number } | null {
  const c = cityAirports(input);
  if (c) return { lat: c.lat, lng: c.lng };
  const t = TOWN_BY_NAME.get(normCity(input));
  return t ? { lat: t.lat, lng: t.lng } : null;
}

/** Distancia en línea recta (km) entre dos lugares conocidos, tengan o no aeropuerto (null si falta alguno). */
export function placeDistanceKm(a: unknown, b: unknown): number | null {
  const x = placeCoords(a);
  const y = placeCoords(b);
  return x && y ? kmBetween(x, y) : null;
}

/** Aeropuerto con que se vuela a un lugar: el suyo, o el de la tabla más cercano si no tiene. */
export type AirportPick = {
  /** IATA del aeropuerto (principal de su ciudad). */
  airport: string;
  /** Ciudad del aeropuerto ("Florencia"). */
  city: string;
  /** Lugar pedido, con su nombre de la tabla ("Siena"). */
  place: string;
  /** Distancia en línea recta del lugar al aeropuerto (0 si el lugar tiene aeropuerto). */
  km: number;
  /** true si el lugar tiene aeropuerto propio. */
  exact: boolean;
};

/** Hasta aquí se acepta "el aeropuerto más cercano"; más lejos no se adivina (queda sin aeropuerto). */
export const NEAREST_AIRPORT_MAX_KM = 250;

/**
 * Aeropuerto para volar a una ciudad o lugar. Con aeropuerto propio, ese (exact). Sin él (Siena), el
 * aeropuerto de la tabla más cercano en línea recta (Florencia FLR, 55 km), dentro de
 * NEAREST_AIRPORT_MAX_KM. null si el lugar no se conoce: quien llama no debe inventar un código.
 */
export function nearestAirport(input: unknown, maxKm = NEAREST_AIRPORT_MAX_KM): AirportPick | null {
  const own = mainAirport(input);
  if (own) {
    const c = cityAirports(input) ?? BY_CODE.get(own) ?? null;
    return { airport: own, city: c?.name ?? own, place: c?.name ?? String(input ?? "").trim(), km: 0, exact: true };
  }
  const town = TOWN_BY_NAME.get(normCity(input));
  if (!town) return null;
  let best: { c: CityAirports; km: number } | null = null;
  for (const c of CITIES) {
    const km = kmBetween(town, c);
    if (!best || km < best.km) best = { c, km };
  }
  if (!best || best.km > maxKm) return null;
  return { airport: best.c.airports[0], city: best.c.name, place: town.name, km: best.km, exact: false };
}

/**
 * Duración máxima creíble de un trayecto de ida (horas) para esa distancia: el doble del vuelo
 * directo (≈800 km/h) más 10 h de conexiones. MEX→Roma (≈10,300 km): ≈36 h. Sin distancia, 36 h.
 */
export function maxPlausibleHours(from: unknown, to: unknown): number {
  const km = distanceKm(from, to);
  if (km == null) return 36;
  return Math.max(12, Math.round((km / 800) * 2 + 10));
}

/** "Cancún", "Madrid"… para un código conocido; el código tal cual si no se conoce. */
export function airportCityName(code: string): string {
  const c = BY_CODE.get(String(code ?? "").toUpperCase());
  return c ? c.name : String(code ?? "").toUpperCase();
}

/**
 * Aerolíneas regionales (low cost o de corto alcance) y las regiones que operan. En una ruta entre
 * regiones distintas (México → Europa) no pueden ser la aerolínea del viaje: Volaris (Y4) no vuela
 * a Europa. Las de red (AM, IB, AF, LH…) no están aquí: pueden volar cualquier ruta.
 */
const REGIONAL_AIRLINES: Record<string, Region[]> = {
  Y4: ["NA"], // Volaris
  VB: ["NA"], // Viva Aerobus
  F9: ["NA"], NK: ["NA"], G4: ["NA"], WN: ["NA"], B6: ["NA"], // Frontier, Spirit, Allegiant, Southwest, JetBlue
  FR: ["EU"], U2: ["EU"], W6: ["EU"], VY: ["EU"], V7: ["EU"], HV: ["EU"], LS: ["EU"], // Ryanair, easyJet, Wizz, Vueling, Volotea, Transavia, Jet2
  PC: ["EU", "ME"], // Pegasus
  JA: ["SA"], H2: ["SA"], // JetSMART, Sky
  AK: ["AS"], FD: ["AS"], TR: ["AS"], // AirAsia, Thai AirAsia, Scoot
};

/**
 * ¿Tiene sentido que esa aerolínea sea la del vuelo de la ruta? false para una regional fuera de su
 * región (o en una ruta intercontinental); true si es de red o no se sabe lo contrario.
 */
export function airlineFitsRoute(airlineCode: string | null | undefined, from: unknown, to: unknown): boolean {
  const code = String(airlineCode ?? "").toUpperCase();
  const regions = REGIONAL_AIRLINES[code];
  if (!regions) return true;
  const a = cityAirports(from);
  const b = cityAirports(to);
  if (!a || !b) return true;
  return regions.includes(a.region) && regions.includes(b.region);
}

/** País (en español) de la ciudad; null si no se conoce. */
export function countryOfCity(city: unknown): string | null {
  return cityAirports(city)?.country ?? null;
}
