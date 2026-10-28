// Trayectos cortos por carretera (N-06). Sin dependencias de Deno, para probarlo desde Vitest.
//
// Por qué: para CDMX→Puebla (~130 km) el análisis cotizaba solo vuelos con escala de 4–5 h, que
// eran casi la mitad del total. Si origen y destino están a menos de ~350 km por carretera:
//   - se le pide al modelo proponer autobús / auto como opción ESTIMADA (rango de precio y liga
//     de búsqueda), nunca como precio en vivo;
//   - los vuelos solo se muestran si son razonables (máx. 1 escala y duración total < 3 × el
//     tiempo de manejo); la búsqueda de vuelos no se quita.
// La distancia sale de coordenadas conocidas de cada ciudad (lista curada) × un factor de
// carretera: es una aproximación y siempre se presenta como "aprox.".

import { haversineKm } from "../_shared/geo-distance.ts";
import { type CarCost, carCostLines } from "../_shared/carCost.ts";
export { haversineKm };

export const SHORT_TRIP_MAX_ROAD_KM = 350;
/** Con Routes API disponible se revisa también lo que por línea recta queda hasta 500 km. */
export const SHORT_TRIP_CANDIDATE_KM = 500;
/** Las carreteras son más largas que la línea recta (≈1.3 en el centro de México). */
const ROAD_FACTOR = 1.3;
/** Velocidad media de manejo/autobús en carretera, con entradas y salidas de ciudad. */
const AVG_ROAD_KMH = 75;

type City = { key: string; name: string; lat: number; lng: number; aliases: string[] };

// Coordenadas del centro de cada ciudad. Solo ciudades de México con conexiones terrestres
// frecuentes; si una ciudad no está, no se asume nada (se cotiza como antes).
const CITIES: City[] = [
  { key: "cdmx", name: "Ciudad de México", lat: 19.4326, lng: -99.1332, aliases: ["ciudad de mexico", "cdmx", "mexico city", "mexico df", "distrito federal"] },
  { key: "puebla", name: "Puebla", lat: 19.0414, lng: -98.2063, aliases: ["puebla", "puebla de zaragoza"] },
  { key: "cholula", name: "Cholula", lat: 19.0633, lng: -98.3036, aliases: ["cholula", "san pedro cholula", "san andres cholula"] },
  { key: "atlixco", name: "Atlixco", lat: 18.9085, lng: -98.4366, aliases: ["atlixco"] },
  { key: "tlaxcala", name: "Tlaxcala", lat: 19.3182, lng: -98.2375, aliases: ["tlaxcala"] },
  { key: "cuernavaca", name: "Cuernavaca", lat: 18.9242, lng: -99.2216, aliases: ["cuernavaca"] },
  { key: "tepoztlan", name: "Tepoztlán", lat: 18.9853, lng: -99.0997, aliases: ["tepoztlan"] },
  { key: "taxco", name: "Taxco", lat: 18.556, lng: -99.605, aliases: ["taxco"] },
  { key: "toluca", name: "Toluca", lat: 19.2826, lng: -99.6557, aliases: ["toluca"] },
  { key: "valle_bravo", name: "Valle de Bravo", lat: 19.195, lng: -100.131, aliases: ["valle de bravo"] },
  { key: "pachuca", name: "Pachuca", lat: 20.1011, lng: -98.7591, aliases: ["pachuca"] },
  { key: "queretaro", name: "Querétaro", lat: 20.5888, lng: -100.3899, aliases: ["queretaro", "santiago de queretaro"] },
  { key: "sma", name: "San Miguel de Allende", lat: 20.9144, lng: -100.7452, aliases: ["san miguel de allende"] },
  { key: "guanajuato", name: "Guanajuato", lat: 21.019, lng: -101.2574, aliases: ["guanajuato"] },
  { key: "leon", name: "León", lat: 21.125, lng: -101.686, aliases: ["leon guanajuato", "leon gto", "leon"] },
  { key: "morelia", name: "Morelia", lat: 19.706, lng: -101.195, aliases: ["morelia"] },
  { key: "aguascalientes", name: "Aguascalientes", lat: 21.8853, lng: -102.2916, aliases: ["aguascalientes"] },
  { key: "slp", name: "San Luis Potosí", lat: 22.1565, lng: -100.9855, aliases: ["san luis potosi"] },
  { key: "guadalajara", name: "Guadalajara", lat: 20.6597, lng: -103.3496, aliases: ["guadalajara"] },
  { key: "veracruz", name: "Veracruz", lat: 19.1738, lng: -96.1342, aliases: ["veracruz", "puerto de veracruz"] },
  { key: "xalapa", name: "Xalapa", lat: 19.5438, lng: -96.9102, aliases: ["xalapa", "jalapa"] },
  { key: "oaxaca", name: "Oaxaca", lat: 17.0732, lng: -96.7266, aliases: ["oaxaca de juarez", "oaxaca"] },
  { key: "acapulco", name: "Acapulco", lat: 16.8531, lng: -99.8237, aliases: ["acapulco"] },
  { key: "monterrey", name: "Monterrey", lat: 25.6866, lng: -100.3161, aliases: ["monterrey"] },
  { key: "saltillo", name: "Saltillo", lat: 25.4232, lng: -101.0053, aliases: ["saltillo"] },
  { key: "merida", name: "Mérida", lat: 20.9674, lng: -89.5926, aliases: ["merida"] },
  { key: "valladolid", name: "Valladolid", lat: 20.6896, lng: -88.2011, aliases: ["valladolid yucatan", "valladolid"] },
  { key: "cancun", name: "Cancún", lat: 21.1619, lng: -86.8515, aliases: ["cancun"] },
  { key: "playa", name: "Playa del Carmen", lat: 20.6296, lng: -87.0739, aliases: ["playa del carmen"] },
  { key: "tulum", name: "Tulum", lat: 20.2114, lng: -87.4654, aliases: ["tulum"] },
  { key: "bacalar", name: "Bacalar", lat: 18.677, lng: -88.395, aliases: ["bacalar"] },
  { key: "campeche", name: "Campeche", lat: 19.8301, lng: -90.5349, aliases: ["campeche"] },
  { key: "tijuana", name: "Tijuana", lat: 32.5149, lng: -117.0382, aliases: ["tijuana"] },
  { key: "ensenada", name: "Ensenada", lat: 31.8667, lng: -116.5964, aliases: ["ensenada", "valle de guadalupe"] },
  { key: "cabo", name: "Los Cabos", lat: 22.8905, lng: -109.9167, aliases: ["los cabos", "cabo san lucas", "san jose del cabo"] },
  { key: "lapaz", name: "La Paz", lat: 24.1426, lng: -110.3128, aliases: ["la paz baja california", "la paz bcs", "la paz"] },
  { key: "vallarta", name: "Puerto Vallarta", lat: 20.6534, lng: -105.2253, aliases: ["puerto vallarta", "vallarta"] },
  { key: "mazatlan", name: "Mazatlán", lat: 23.2494, lng: -106.4111, aliases: ["mazatlan"] },
  { key: "sancris", name: "San Cristóbal de las Casas", lat: 16.737, lng: -92.6376, aliases: ["san cristobal de las casas", "san cristobal"] },
  { key: "tuxtla", name: "Tuxtla Gutiérrez", lat: 16.7516, lng: -93.1161, aliases: ["tuxtla gutierrez", "tuxtla"] },
  { key: "huatulco", name: "Huatulco", lat: 15.77, lng: -96.13, aliases: ["huatulco"] },
  { key: "pescondido", name: "Puerto Escondido", lat: 15.872, lng: -97.0767, aliases: ["puerto escondido"] },
];

const norm = (s: unknown) =>
  String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Ciudad conocida mencionada en el texto (el alias más largo gana: "leon guanajuato" > "leon"). */
export function findCity(text: unknown): City | null {
  const t = ` ${norm(text)} `;
  if (!t.trim()) return null;
  let best: { city: City; len: number } | null = null;
  for (const city of CITIES) {
    for (const alias of city.aliases) {
      if (t.includes(` ${alias} `) && (!best || alias.length > best.len)) best = { city, len: alias.length };
    }
  }
  return best?.city ?? null;
}

// Exportada para reutilizarla en el planificador de Privé (_shared/privePlanner.ts).
export type ShortTrip = {
  origin: string;
  destination: string;
  /** Aproximados (línea recta × factor de carretera) salvo que `source` sea "google_routes". */
  approxRoadKm: number;
  approxDriveHours: number;
  /** "google_routes" = distancia y tiempo de manejo reales de Google Maps (Routes API). */
  source?: "google_routes" | "aproximado";
  consultedAt?: string | null;
};

type DriveRoute = { ok: boolean; duration_seconds?: number; distance_meters?: number | null; consultado_at?: string | null } | null | undefined;

/**
 * Con la ruta real de Google (Routes API, manejo sin tráfico) se decide con la distancia por
 * carretera de verdad; sin ruta se usa la aproximación de siempre (solo si cabe en 350 km).
 */
export function refineShortTrip(candidate: ShortTrip | null, route: DriveRoute, maxRoadKm = SHORT_TRIP_MAX_ROAD_KM): ShortTrip | null {
  if (!candidate) return null;
  const sec = route?.ok ? Number(route.duration_seconds) : NaN;
  const meters = route?.ok ? Number(route.distance_meters) : NaN;
  if (Number.isFinite(sec) && sec > 0 && Number.isFinite(meters) && meters > 0) {
    const km = Math.round(meters / 1000);
    if (km > maxRoadKm) return null;
    return {
      ...candidate,
      approxRoadKm: km,
      approxDriveHours: Math.round((sec / 3600) * 10) / 10,
      source: "google_routes",
      consultedAt: route?.consultado_at ?? null,
    };
  }
  return candidate.approxRoadKm <= maxRoadKm ? { ...candidate, source: "aproximado", consultedAt: null } : null;
}

/** null si alguna ciudad no es conocida, si son la misma o si están a más de maxRoadKm. */
export function detectShortTrip(origin: unknown, destination: unknown, maxRoadKm = SHORT_TRIP_MAX_ROAD_KM): ShortTrip | null {
  const o = findCity(origin);
  const d = findCity(destination);
  if (!o || !d || o.key === d.key) return null;
  const approxRoadKm = Math.round(haversineKm(o, d) * ROAD_FACTOR);
  if (approxRoadKm > maxRoadKm) return null;
  const approxDriveHours = Math.round((approxRoadKm / AVG_ROAD_KMH) * 10) / 10;
  return { origin: o.name, destination: d.name, approxRoadKm, approxDriveHours };
}

/** "4h 15m", "4 h 15 min", "2h", "95 min", 255 → minutos; null si no se entiende. */
export function parseDurationMinutes(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) && v > 0 ? Math.round(v) : null;
  const s = norm(v);
  if (!s) return null;
  const h = /(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hora|horas)\b/.exec(s);
  const m = /(\d+)\s*(?:m|min|mins|minutos?)\b/.exec(s);
  if (!h && !m) return null;
  const total = (h ? Number(h[1]) * 60 : 0) + (m ? Number(m[1]) : 0);
  return total > 0 ? Math.round(total) : null;
}

/** "Directo" → 0, "1 escala" → 1, 2 → 2; null si no se entiende. */
export function parseStops(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) && v >= 0 ? v : null;
  const s = norm(v);
  if (!s) return null;
  if (/\b(directo|sin escalas|nonstop|non stop)\b/.test(s)) return 0;
  const n = /(\d+)\s*(escala|parada|stop)/.exec(s);
  if (n) return Number(n[1]);
  if (/\buna escala\b/.test(s)) return 1;
  return null;
}

// Tiempo puerta a puerta (supuestos documentados, se muestran como aproximados): un vuelo
// doméstico suma ~60 min para llegar al aeropuerto, ~90 min de documentación y seguridad, y
// ~45 min para salir y llegar al centro. El autobús suma ~45 min de terminal y va ~15 % más
// lento que el auto. Se revisó contra un caso real (CDMX→Puebla, 22-oct-2026): Google Flights
// solo dio vuelos con escala de 4h15–5h27; con la regla anterior (< 3 × manejo = 5.7 h) los tres
// pasaban, aunque puerta a puerta son ~7.5 h contra ~2.5 h en autobús.
export const FLIGHT_OVERHEAD_MIN = 60 + 90 + 45;
const BUS_SLOWDOWN = 1.15;
const BUS_OVERHEAD_MIN = 45;
/** Un directo se muestra si puerta a puerta no tarda más de 25 % sobre la mejor opción terrestre. */
const DIRECT_MAX_RATIO = 1.25;
/** Con preferencia por comodidad, un directo se tolera hasta 50 % más lento. */
const DIRECT_MAX_RATIO_COMFORT = 1.5;
/** Uno con escala solo con ventaja comprobable: al menos 20 % más rápido puerta a puerta. */
const STOPS_MAX_RATIO = 0.8;

export type TravelerPrefs = {
  /** El usuario pidió volar ("en avión", "vuelo"). */
  wantsFlight: boolean;
  /** Aceptó o pidió explícitamente escalas o conexiones. */
  acceptsStops: boolean;
  comfort: boolean;
  budget: boolean;
};

export function travelerPrefs(notes: unknown): TravelerPrefs {
  const n = norm(notes);
  return {
    wantsFlight: /\b(en avion|volar|vuelo|vuelos|volando)\b/.test(n),
    acceptsStops: /\b(escala|escalas|conexion|conexiones)\b/.test(n) && !/\bsin escalas?\b/.test(n),
    comfort: /\b(comodo|comoda|comodidad|lujo|premium)\b/.test(n),
    budget: /\b(barato|barata|economico|economica|ahorrar|low cost)\b/.test(n),
  };
}

/** Estimaciones puerta a puerta por modo, en minutos (aproximadas). */
export function groundDoorToDoor(t: ShortTrip) {
  const car = Math.round(t.approxDriveHours * 60);
  const bus = Math.round(t.approxDriveHours * 60 * BUS_SLOWDOWN + BUS_OVERHEAD_MIN);
  return { car, bus, best: Math.min(car, bus) };
}

export type FlightVerdict = { show: boolean; doorToDoorMin: number | null; reason: string };

/**
 * ¿Mostrar este vuelo en un trayecto corto? Prioriza directos cuando tienen sentido; uno con escala
 * solo si es claramente más rápido puerta a puerta o si el usuario lo pidió. Sin datos, no se afirma.
 */
export function shortFlightVerdict(stops: number | null, minutes: number | null, t: ShortTrip, prefs: TravelerPrefs): FlightVerdict {
  if (stops === null || minutes === null) return { show: false, doorToDoorMin: null, reason: "sin duración o escalas" };
  const d2d = minutes + FLIGHT_OVERHEAD_MIN;
  const ground = groundDoorToDoor(t).best;
  if (stops === 0) {
    const limit = ground * (prefs.comfort ? DIRECT_MAX_RATIO_COMFORT : DIRECT_MAX_RATIO);
    if (d2d <= limit) return { show: true, doorToDoorMin: d2d, reason: "directo competitivo puerta a puerta" };
    if (prefs.wantsFlight) return { show: true, doorToDoorMin: d2d, reason: "directo: el usuario pidió volar" };
    return { show: false, doorToDoorMin: d2d, reason: "directo más lento que ir por carretera" };
  }
  if (d2d <= ground * STOPS_MAX_RATIO) return { show: true, doorToDoorMin: d2d, reason: "con escala pero más rápido puerta a puerta" };
  if (prefs.acceptsStops) return { show: true, doorToDoorMin: d2d, reason: "con escala: el usuario lo pidió" };
  return { show: false, doorToDoorMin: d2d, reason: "con escala sin ventaja comprobable" };
}

const NO_PREFS: TravelerPrefs = { wantsFlight: false, acceptsStops: false, comfort: false, budget: false };

/** Compatibilidad: decisión sin preferencias del usuario. */
export function isReasonableShortFlight(stops: number | null, minutes: number | null, driveHours: number, prefs: TravelerPrefs = NO_PREFS): boolean {
  if (stops !== null && !Number.isFinite(stops)) stops = null; // Number(undefined) = NaN: sin dato
  const approxRoadKm = Math.round(driveHours * AVG_ROAD_KMH);
  return shortFlightVerdict(stops, minutes, { origin: "", destination: "", approxRoadKm, approxDriveHours: driveHours }, prefs).show;
}

/** Ligas de búsqueda: Omio (afiliado Travelpayouts, autobuses) y la ruta en Google Maps (auto). */
export function groundSearchLinks(origin: string, destination: string, _date?: string | null) {
  // Autobús: rutas en transporte público de Google Maps (formato documentado, EV-MAPS-URLS). Antes era
  // https://www.omio.com/search?fromCity=…, que responde 410 "This page doesn't exist" (también
  // /buses/mexico-city/puebla): el botón llevaba a un error (A-OMIO.jpg). Google Maps no recibe la fecha
  // por enlace; el boleto se compra con la línea de autobús.
  const bus = `https://www.google.com/maps/dir/?${new URLSearchParams({ api: "1", origin, destination, travelmode: "transit" }).toString()}`;
  const car = `https://www.google.com/maps/dir/?${new URLSearchParams({ api: "1", origin, destination, travelmode: "driving" }).toString()}`;
  return { bus, car };
}

/** Texto para el prompt del modelo cuando el trayecto es corto. */
export function shortTripPromptBlock(t: ShortTrip, prefs: TravelerPrefs = NO_PREFS): string {
  const g = groundDoorToDoor(t);
  const h = (m: number) => `${Math.round((m / 60) * 10) / 10} h`;
  const order = prefs.budget
    ? "ahorro = autobús, equilibrio = autobús de lujo o auto, premium = vuelo directo si conviene o traslado privado"
    : prefs.comfort
      ? "ahorro = autobús de lujo, equilibrio = auto o traslado privado, premium = vuelo directo si conviene"
      : "ahorro = autobús, equilibrio = autobús de lujo o auto, premium = vuelo directo si conviene o auto/traslado privado";
  const real = t.source === "google_routes";
  return `TRAYECTO CORTO POR CARRETERA (${t.origin} → ${t.destination}, ${real ? `${t.approxRoadKm} km y ~${h(g.car)} de manejo según Google Maps, sin tráfico` : `aprox. ${t.approxRoadKm} km; cifras aproximadas`})
- Compara por TIEMPO PUERTA A PUERTA, precio, comodidad y lo que pidió el viajero. Referencias aproximadas: auto ~${h(g.car)}, autobús ~${h(g.bus)} (incluye terminal); un vuelo suma ~${h(FLIGHT_OVERHEAD_MIN)} de aeropuertos al tiempo de vuelo.
- Prioriza vuelos DIRECTOS cuando tengan sentido. Las listas de vuelos ya vienen filtradas por el servidor: usa solo los que aparecen; si no queda ninguno, no propongas vuelos.
- Las opciones terrestres (modo="autobus" o modo="auto") son ESTIMACIONES: fuente_precio="estimado". Autobús: precio por persona. Auto: es el costo del COCHE (casetas + gasolina), NO por persona; en el texto nunca lo describas "por persona". No inventes horarios ni digas que es precio en vivo; en notas indica que el precio real se confirma en el buscador.
- En notas de cada opción escribe su tiempo puerta a puerta aproximado.
- Sugerencia de tiers según lo que pidió el viajero: ${order}.
- El servidor reemplaza las opciones terrestres por datos reales: "en tu coche" con las casetas de Google Maps y la gasolina estimada con su fórmula, y el autobús con el enlace de la línea (precio en su sitio). No inventes precios de autobús, auto ni chofer.
- DESTINO NACIONAL CERCANO: comida, tours, transporte_local y extras son de una escapada corta (un fin de semana en un pueblo o ciudad cercana), no de un viaje largo. Si van en coche, transporte_local es casi 0 (estacionamiento o un taxi local). Las entradas a lugares naturales o históricos suelen ser baratas o libres: si no tienes el precio real, no lo inventes.`;
}

/**
 * Opciones terrestres con datos reales (caso CDMX → Tepoztlán, 27-oct-2026): reemplaza lo que la IA
 * escribió para autobús, auto o chofer (precios inventados: ADO $1,000, auto $1,800, chofer $3,400) por
 *  - "En tu coche": casetas reales de Google Maps (ida × 2) + gasolina estimada con su fórmula. El costo es
 *    del coche; precio_por_persona = costo / viajeros solo para que el total y el correo cuadren.
 *  - "Autobús": sin precio (horarios y precio en ADO u otra línea, enlace precargado si existe).
 * Los vuelos que ya pasaron applyShortTripRules se conservan (máximo uno, como "premium").
 */
export function realGroundOptions(vuelos: any[], t: ShortTrip, cost: CarCost, links: { bus: string; car: string; ado?: string | null }, viajeros: number): any[] {
  const T = Math.max(1, Math.round(Number(viajeros) || 1));
  const flights = (Array.isArray(vuelos) ? vuelos : []).filter((v) => v && typeof v === "object" && !groundMode(v)).slice(0, 1).map((v) => ({ ...v, tier: "premium" }));
  const lines = carCostLines(cost);
  const g = groundDoorToDoor(t);
  const hours = (m: number) => `${Math.round((m / 60) * 10) / 10} h`;
  const car: any = {
    tier: "equilibrio", modo: "auto", aerolinea: "En tu coche",
    duracion: t.source === "google_routes" ? `${t.approxDriveHours} h de manejo según Google Maps (sin tráfico)` : `Unas ${t.approxDriveHours} h por carretera (aprox.)`,
    escalas: "Terrestre", km: t.approxRoadKm,
    precio_por_persona: cost.total_mxn ? cost.total_mxn / T : 0, precio_min: null, precio_max: null,
    fuente_precio: "estimado", estado_dato: "ESTIMADO",
    booking_link: links.car, costo_auto: cost,
    notas: `${lines.casetas}. ${lines.gasolina}. Costo del coche, no por persona; no incluye estacionamiento.`,
  };
  const bus: any = {
    tier: "ahorro", modo: "autobus", aerolinea: links.ado ? "Autobús ADO" : "Autobús",
    duracion: `Unas ${hours(g.bus)} puerta a puerta (aprox., incluye terminal)`, escalas: "Terrestre",
    precio_por_persona: 0, precio_min: null, precio_max: null, fuente_precio: "estimado", estado_dato: "ESTIMADO",
    booking_link: links.ado ?? links.bus, horarios_link: links.bus,
    notas: links.ado ? "Horarios y precio en el sitio de ADO: IATOS no lo cotiza." : "Horarios y precio con la línea de autobús: IATOS no lo cotiza.",
  };
  return [bus, car, ...flights];
}

/** Techos de cordura por persona y día para una escapada nacional corta (MXN). No son precios: solo acotan lo que la IA estimó. */
export const SHORT_TRIP_CAPS_PP_DIA = { comida: 900, tours: 600, transporte_local: 150, transporte_local_en_coche: 100, extras: 250 } as const;

/**
 * Acota los renglones ESTIMADOS (comida, experiencias, transporte local y extras) de un trayecto corto
 * nacional: días = noches + 1 (de viernes a domingo son 3 días). No toca vuelos ni hospedaje.
 */
export function capShortTripEstimates(desglose: Record<string, number> | null | undefined, o: { noches: number; viajeros: number; enCoche: boolean }): { desglose: Record<string, number>; acotados: string[] } {
  const d: Record<string, number> = {};
  for (const [k, v] of Object.entries(desglose ?? {})) d[k] = Number(v) || 0;
  const dias = Math.max(1, Math.round(Number(o.noches) || 0) + 1);
  const T = Math.max(1, Math.round(Number(o.viajeros) || 1));
  const caps: Record<string, number> = {
    comida: SHORT_TRIP_CAPS_PP_DIA.comida, tours: SHORT_TRIP_CAPS_PP_DIA.tours, extras: SHORT_TRIP_CAPS_PP_DIA.extras,
    transporte_local: o.enCoche ? SHORT_TRIP_CAPS_PP_DIA.transporte_local_en_coche : SHORT_TRIP_CAPS_PP_DIA.transporte_local,
  };
  const acotados: string[] = [];
  for (const [k, pp] of Object.entries(caps)) {
    const techo = pp * dias * T;
    if ((d[k] ?? 0) > techo) { d[k] = techo; acotados.push(k); }
  }
  return { desglose: d, acotados };
}

const GROUND_WORDS = /\b(autobus|bus|camion|auto propio|auto rentado|renta de auto|coche|carro|manejando|carretera|ado|estrella roja|primera plus|etn)\b/;

export function groundMode(v: any): "autobus" | "auto" | null {
  const m = norm(v?.modo);
  if (m === "autobus" || m === "bus") return "autobus";
  if (m === "auto" || m === "carro" || m === "coche") return "auto";
  const text = norm(`${v?.aerolinea ?? ""} ${v?.escalas ?? ""}`);
  if (!GROUND_WORDS.test(text)) return null;
  return /\b(auto|coche|carro|manejando)\b/.test(text) ? "auto" : "autobus";
}

const pos = (v: unknown) => (Number(v) > 0 ? Math.round(Number(v)) : null);

/**
 * Aplica las reglas de trayecto corto a las opciones de "vuelos" ya normalizadas y con fuente:
 * - terrestres: siempre "estimado", con la liga de búsqueda del servidor (no la del modelo);
 * - vuelos: solo los que convienen puerta a puerta o que el usuario pidió (shortFlightVerdict);
 * - si no queda ninguna opción terrestre, agrega una sin precio (solo la liga), para no inventar.
 */
export function applyShortTripRules(vuelos: any[], t: ShortTrip, links: { bus: string; car: string }, prefs: TravelerPrefs = NO_PREFS): any[] {
  const out: any[] = [];
  for (const v of Array.isArray(vuelos) ? vuelos : []) {
    if (!v || typeof v !== "object") continue;
    const mode = groundMode(v);
    if (mode) {
      let min = pos(v.precio_min);
      let max = pos(v.precio_max);
      if (min && max && min > max) [min, max] = [max, min];
      let precio = pos(v.precio_por_persona) ?? 0;
      if (min && max) precio = precio >= min && precio <= max ? precio : Math.round((min + max) / 2);
      const g: any = {
        ...v,
        modo: mode,
        precio_por_persona: precio,
        precio_min: min && max ? min : null,
        precio_max: min && max ? max : null,
        fuente_precio: "estimado",
        estado_dato: "ESTIMADO",
        booking_link: mode === "auto" ? links.car : links.bus,
        notas: [v.notas, "Precio estimado; confírmalo en el buscador."].filter(Boolean).join(" "),
      };
      delete g.consultado_at;
      delete g.approximate_dates;
      delete g.cta_action;
      out.push(g);
      continue;
    }
    const verdict = shortFlightVerdict(parseStops(v.escalas), parseDurationMinutes(v.duracion), t, prefs);
    if (verdict.show) out.push({ ...v, modo: "avion", puerta_a_puerta_min: verdict.doorToDoorMin });
  }
  if (!out.some((v) => v.modo === "autobus" || v.modo === "auto")) {
    const used = new Set(out.map((v) => v.tier));
    const tier = ["ahorro", "equilibrio", "premium"].find((x) => !used.has(x)) ?? "ahorro";
    out.unshift({
      tier,
      modo: "autobus",
      aerolinea: "Autobús o auto",
      duracion: t.source === "google_routes"
        ? `${t.approxDriveHours} h de manejo según Google Maps (sin tráfico)`
        : `Unas ${t.approxDriveHours} h por carretera (aprox.)`,
      escalas: "Terrestre",
      precio_por_persona: 0,
      precio_min: null,
      precio_max: null,
      fuente_precio: "estimado",
      estado_dato: "ESTIMADO",
      booking_link: links.bus,
      notas: "Trayecto corto: conviene ir por carretera. No tenemos precio en vivo; consulta horarios y precios en el buscador.",
    });
  }
  const order = ["ahorro", "equilibrio", "premium"];
  return out.sort((a, b) => order.indexOf(a.tier) - order.indexOf(b.tier));
}

/**
 * Renglón de transporte del desglose en un trayecto corto: opción "equilibrio" con precio (o la
 * primera con precio) × viajeros. 0 si ninguna trae precio: no se inventa un costo.
 */
export function shortTripTransportTotal(vuelos: any[], viajeros: number): number {
  const priced = (Array.isArray(vuelos) ? vuelos : []).filter((v) => Number(v?.precio_por_persona) > 0);
  const ref = priced.find((v) => v.tier === "equilibrio") ?? priced[0];
  return ref ? Math.round(Number(ref.precio_por_persona) * Math.max(1, Math.round(Number(viajeros) || 1))) : 0;
}
