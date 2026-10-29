// Planeador determinista del turno de Iato (Concierge 2.0). Lógica pura, probada con Vitest.
//
// Qué resuelve:
//   * Intención del mensaje (o del botón rápido que lo mandó): vuelo hoy, vuelo cancelado, cenar cerca
//     del hotel, dato práctico de un lugar, emergencia, Privé…
//   * Herramientas que ya se sabe que hacen falta (prefetch): se ejecutan EN PARALELO antes de la
//     primera llamada al modelo. Una pregunta como "¿mi vuelo va a tiempo?" pasa de 2 llamadas al
//     modelo (pedir herramienta → responder) a 1, y el usuario ve el paso en vivo desde el primer segundo.
//   * Notas proactivas a partir del viaje en contexto (a qué hora salir al aeropuerto, el hotel donde
//     está, qué falta) y acciones sugeridas que siempre se ofrecen en los casos clave (Fixer en una
//     cancelación, seguir el vuelo, agregar la cena al itinerario).
//   * Política de herramientas: TripAdvisor nunca responde datos prácticos (la Centurion de la T1 iba a
//     TripAdvisor); esas llamadas se redirigen a web_search.

import { normText } from "./context.ts";
import { detectRoadTrip } from "../_shared/roadtrip/plan.ts";
import { roadTripTurn } from "./roadtrip.ts";
import type { TripPosition } from "./location.ts";
import { eventsRequested } from "./events.ts";
import { toursRequested } from "../_shared/viator.ts";
import { mealFromText } from "../_shared/restaurantBooking.ts";
import { officialTicketsForCity } from "../_shared/officialTickets.ts";
import { weatherRequested } from "../_shared/weather.ts";
import { tripIsByLand } from "./actions.ts";
import { requestedDestination } from "./turnPlace.ts";
import { cityAirports } from "../_shared/airports.ts";
import { timeRequested } from "../_shared/worldClock.ts";
import { requestedWhen, whenLabel } from "./requestedWhen.ts";
export { tripIsByLand };

export type Intent =
  | "human" | "emergency" | "flight_disruption" | "missed_connection" | "flight_status" | "flight_compare"
  | "hotel_change" | "dining_near_hotel" | "dining" | "transport" | "prive_night" | "trip_overview"
  | "place_fact" | "expense" | "packing" | "price_alert" | "create_trip" | "itinerary_add" | "luggage" | "members_followup" | "plan"
  // roadtrip: "quiero hacer un road trip por la Toscana en 7 días".
  | "road_trip"
  // Event Radar: conciertos, teatro, deportes o qué hacer en fechas concretas (events.ts).
  | "events"
  // Tours y actividades reales de Viator (search_tours), solo si los pide.
  | "tours"
  // Luna de miel / "lo TOP" de una ciudad: desayunos, cenas, museos con taquilla oficial y experiencias.
  | "honeymoon_plan"
  // Clima real (get_weather): la misma fuente que la pantalla Clima.
  | "weather"
  // "Resérvame mesa en X": con Reservas IA disponible, Iato propone pedirla por correo (ai_reservation_request).
  | "book_table"
  // "¿Qué hora es en Tokio?": reloj de IATOS (get_local_time), auditoría 10 ronda 3, N-P1-6.
  | "time"
  // Ola 9.5 (29-oct-2026): "¿cuánto llevo gastado?" (Iato decía "no tengo registro de gastos" con 6 gastos
  // registrados) y "ármame el plan del sábado" (sin datos consultados: 7 s en blanco y clima sin fuente).
  | "expense_query" | "day_plan";

export const CHIP_INTENTS: readonly Intent[] = [
  "dining_near_hotel", "transport", "emergency", "flight_status", "luggage", "members_followup", "trip_overview",
  "weather", "expense_query", "day_plan",
];

/** "¿Cuánto llevo gastado?", "mis gastos del viaje", "¿cuánto hemos gastado?" (consultar, no registrar). */
export const EXPENSE_QUERY = /\b(cuanto|que tanto)\b.{0,30}\b(gastad[oa]s?|gaste|gastamos|hemos gastado|he gastado|llevo|llevamos)\b.{0,30}\b(gast\w*|viaje)?|\b(mis|nuestros|los) gastos\b|\bresumen de (mis |los )?gastos\b|\ben que (he )?gast(e|ado)\b/;
/** "Ármame el plan del sábado", "¿qué hago mañana?", "mi itinerario de hoy", "plan para el 31". */
export const DAY_PLAN = /\b(plan|planea\w*|agenda|itinerario|programa)\b.{0,25}\b(hoy|manana|pasado manana|lunes|martes|miercoles|jueves|viernes|sabado|domingo|dia \d{1,2}|el \d{1,2})\b|\bque (hago|hacemos|tengo|tenemos)\b.{0,15}\b(hoy|manana|el (lunes|martes|miercoles|jueves|viernes|sabado|domingo))\b|\barma(me)? (el|mi) dia\b/;

const RULES: Array<[Intent, RegExp]> = [
  ["human", /\b(hablar|habla|quiero|necesito|pasame|comunicame|conectame)\b.{0,25}\b(humano|persona real|fixer|agente)\b/],
  ["emergency", /\b(urgente|urgencia|emergencia|auxilio|me robaron|robo|asalt\w*|accidente|me siento mal|perdi mi pasaporte|pasaporte (robado|perdido)|sos)\b/],
  ["flight_disruption", /\b(vuelo|avion)\b.{0,35}\b(cancel\w*|retras\w*|demor\w*|overbook\w*|sobreventa)|\b(cancelaron|se cancelo|retrasaron)\b.{0,20}\b(vuelo|avion)?/],
  ["missed_connection", /\b(perdi|perdimos|voy a perder|no alcanzo|no alcance)\b.{0,25}\b(conexion|escala|vuelo|avion)\b/],
  ["flight_status", /\b(a tiempo|estatus|status|estado|puerta|terminal|sale a tiempo|despega)\b.{0,30}\bvuelo\b|\bvuelo\b.{0,30}\b(a tiempo|estatus|status|estado|puerta|terminal|sale|despega)\b|\bmi vuelo de (hoy|manana)\b/],
  ["flight_compare", /\b(que|cual|cuales) vuelos?\b|\bvuelos?\b.{0,20}\b(me conviene|conviene|barat\w*|mejor\w*)\b|\bcompar\w*\b.{0,20}\bvuelos?\b|\bbusca(me)? vuelos?\b/],
  ["hotel_change", /\b(cambie|me cambie|cambiamos|cambio|nuevo)\b.{0,6}\b(de )?hotel\b|\bya no (estoy|me quedo|nos quedamos) en\b|\bme (mude|movi)\b.{0,10}\bhotel\b/],
  ["dining_near_hotel", /\b(cenar|comer|cena|desayun\w*|restaurante\w*|donde como)\b.{0,40}\b(cerca|hotel)\b|\bcerca de mi hotel\b/],
  ["dining", /\b(cenar|comer|restaurante\w*|cena|desayuno|brunch|almuerzo|comida)\b/],
  ["transport", /\b(taxi|uber|transporte|transfer|traslado|como llego|llevame|pedir (un )?(auto|carro|coche))\b/],
  ["prive_night", /\bprive\b/],
  ["trip_overview", /\b(ayudame|ayuda|organiza|planea|arma|revisa)\b.{0,30}\b(viaje|itinerario)\b/],
  ["place_fact", /\b(donde (esta|queda|se encuentra|estan)|en que (terminal|puerta|piso|nivel)|horario\w*|a que hora (abre|cierra)|telefono|lounge|centurion|priority pass|sala (de )?(espera|premier|centurion|vip))\b/],
  ["expense", /\b(gaste|pague|anota|registra|apunta)\b.{0,40}(\$|\d|peso|dolar|euro|usd|mxn|eur)/],
  ["expense_query", EXPENSE_QUERY],
  ["day_plan", DAY_PLAN],
  ["packing", /\b(empacar|maleta|que llevo|packing|que (debo|tengo que) llevar)\b/],
  ["price_alert", /\b(alerta|avisame|vigila)\b.{0,30}\b(precio|baje|tarifa)\b/],
  ["create_trip", /\b(quiero|planear|planeo|nuevo|crear|crea|armar|organizar)\b.{0,25}\bviaje a\b/],
  ["itinerary_add", /\b(agrega|anade|pon|mete|apunta)\b.{0,40}\b(itinerario|agenda|plan del dia|calendario)\b/],
  ["book_table", /\b(reserva\w*|aparta\w*|consigue\w*|pide\w*|pedir|quiero|necesito)\b.{0,25}\bmesa\b|\bmesa para \d|\breserv\w*\b.{0,50}\b(para \d|\d+ personas|personas|a las \d)/],
  ["luggage", /\b(equipaje invisible|enviar (mi )?(equipaje|maleta)|luggage forward|airportr|lugless)\b/],
];

/** Pregunta de costumbres o reglas (propinas, etiqueta, si es normal…), no de lugares. */
const CUSTOM_QUESTION = /\b(propinas?|se acostumbra|costumbres?|etiqueta|es (normal|comun|obligatori\w*|seguro|caro|barato)|cuanto se deja|cuanto se paga|como se pide|se puede pagar)\b/;
/** Sí pide lugares. */
const RECOMMEND = /\b(recomienda\w*|recomiendame|donde (como|ceno|desayuno|hay)|busca\w*|opciones|mejores|cerca|lugares?|sugiere\w*|sugiereme)\b/;

/** "Plan de luna de miel en Florencia", "lo TOP de Roma: desayunos, cenas, museos y experiencias". */
export function honeymoonRequested(message: unknown): boolean {
  const m = normText(message);
  return /\b(luna de miel|honeymoon)\b/.test(m)
    || /\b(plan|lo top|top|lo mejor|imperdibles?)\b.{0,60}\b(desayunos?|cenas?|comidas?|restaurantes?)\b.{0,60}\b(museos?|experiencias?|tours?)\b/.test(m);
}

/**
 * "cena romántica", "cena especial", "aniversario": la palabra del usuario va a Text Search tal cual
 * (Google decide qué mostrar; IATOS no etiqueta lugares como románticos).
 */
export function specialDiningPhrase(message: unknown): string | null {
  const m = normText(message);
  const meal = mealFromText(message);
  const noun = meal === "desayuno" ? "desayuno" : meal === "brunch" ? "brunch" : meal === "comida" ? "comida" : "cena";
  if (/\bromantic\w*\b/.test(m)) return `${noun} romántica`.replace("desayuno romántica", "desayuno romántico").replace("brunch romántica", "brunch romántico");
  if (/\bluna de miel\b/.test(m)) return `${noun} para luna de miel`;
  if (/\baniversario\b/.test(m)) return `${noun} de aniversario`;
  if (/\b(cena|comida) especial\b/.test(m)) return `${noun} especial`;
  return null;
}

/** Intenciones del mensaje. Un botón rápido manda la suya y manda sobre el texto. */
export function detectIntents(message: string, chipIntent?: unknown): Intent[] {
  const m = normText(message);
  const out = new Set<Intent>();
  if (typeof chipIntent === "string" && (CHIP_INTENTS as readonly string[]).includes(chipIntent)) out.add(chipIntent as Intent);
  for (const [intent, re] of RULES) if (re.test(m)) out.add(intent);
  // roadtrip: road trip / "en coche" / región curada con palabra de ruta.
  const rt = detectRoadTrip(message);
  if (rt.isRoadTrip || (rt.route && /\b(ruta|recorrido|recorrer|vuelta)\b/.test(m))) out.add("road_trip");
  if (eventsRequested(message)) out.add("events");
  if (toursRequested(message)) out.add("tours");
  if (honeymoonRequested(message)) out.add("honeymoon_plan");
  if (weatherRequested(message)) out.add("weather");
  if (timeRequested(message)) out.add("time");
  // "cenar cerca de mi hotel" ya es dining_near_hotel.
  if (out.has("dining_near_hotel")) out.delete("dining");
  // Auditoría 10 #16: "registra un gasto de 150 pesos en comida" no es buscar restaurantes, y "¿cuánta
  // propina se deja en restaurantes en Japón?" es una costumbre, no una búsqueda de lugares.
  if (out.has("expense") || out.has("packing") || out.has("itinerary_add")) { out.delete("dining"); out.delete("dining_near_hotel"); }
  // "Registra 120 pesos… ¿cuánto llevo?": registrar manda (la acción ya trae el gasto); consultar es aparte.
  if (out.has("expense")) out.delete("expense_query");
  if (out.has("expense_query")) { out.delete("dining"); out.delete("dining_near_hotel"); }
  // Un plan de luna de miel / "lo TOP" ya arma días completos con búsquedas.
  if (out.has("honeymoon_plan")) out.delete("day_plan");
  if (CUSTOM_QUESTION.test(m) && !RECOMMEND.test(m)) { out.delete("dining"); out.delete("dining_near_hotel"); }
  // Privé con plan / noche → planeación.
  if (out.has("prive_night") && /\b(noche|plan|arma|hazme|espectacular)\b/.test(m)) out.add("plan");
  // Una cancelación también pide el estado real del vuelo.
  if (out.has("flight_disruption") || out.has("missed_connection")) out.delete("flight_status");
  return [...out];
}

// ═══ Datos del viaje ═══

export interface TripFlight {
  code: string; airline?: string; date?: string; from?: string; to?: string; departs?: string; arrives?: string;
  fromPdf?: boolean; state?: string;
}

export interface TripHotel { name: string; city?: string; address?: string; checkIn?: string; checkOut?: string; lat?: number; lng?: number; state?: string; fromPdf?: boolean }

const FLIGHT_CODE = /\b([A-Z]{2}|[A-Z]\d|\d[A-Z])\s?(\d{1,4})\b/;

export function flightCodeIn(text: string): string | null {
  const m = String(text ?? "").toUpperCase().match(FLIGHT_CODE);
  if (!m) return null;
  // Evita confundir "T1" o "A1" de terminales/puertas sueltas: pide al menos 2 dígitos.
  if (m[2].length < 2) return null;
  return `${m[1]}${m[2]}`;
}

const iso = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : undefined);
const s = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() && Number.isFinite(Number(v)) ? Number(v) : undefined);

export function tripFlights(trip: any): TripFlight[] {
  const list = Array.isArray(trip?.vuelos) ? trip.vuelos : Array.isArray(trip?.vuelos_json) ? trip.vuelos_json : [];
  return list.map((v: any) => {
    const code = (s(v?.numero_vuelo) ?? s(v?.numero) ?? "").toUpperCase().replace(/\s+/g, "");
    return {
      code, airline: s(v?.aerolinea), date: iso(v?.fecha) ?? iso(v?.fecha_salida), from: s(v?.from) ?? s(v?.aeropuerto_origen) ?? s(v?.origen),
      to: s(v?.to) ?? s(v?.aeropuerto_destino) ?? s(v?.ciudad), departs: s(v?.hora_salida), arrives: s(v?.hora_llegada),
      fromPdf: v?.desde_pdf === true, state: s(v?.estado_reserva),
    } as TripFlight;
  }).filter((f: TripFlight) => /^[A-Z0-9]{2}\d{1,4}$/.test(f.code));
}

const addDays = (d: string, k: number) => new Date(Date.parse(`${d}T00:00:00Z`) + k * 86400000).toISOString().slice(0, 10);

/** El vuelo del que habla el usuario: el que nombra, o el de hoy, mañana o el siguiente. */
export function pickFlight(flights: TripFlight[], message: string, todayISO: string): TripFlight | null {
  const code = flightCodeIn(message);
  if (code) return flights.find((f) => f.code === code) ?? { code };
  const today = flights.find((f) => f.date === todayISO);
  if (today) return today;
  const tomorrow = flights.find((f) => f.date === addDays(todayISO, 1));
  if (tomorrow) return tomorrow;
  const upcoming = flights.filter((f) => f.date && f.date >= todayISO).sort((a, b) => String(a.date).localeCompare(String(b.date)));
  return upcoming[0] ?? null;
}

export function tripHotels(trip: any): TripHotel[] {
  const list = Array.isArray(trip?.hospedaje) ? trip.hospedaje : Array.isArray(trip?.hospedaje_json) ? trip.hospedaje_json : [];
  return list.map((h: any) => ({
    name: s(h?.nombre) ?? s(h?.name) ?? "", city: s(h?.ciudad), address: s(h?.direccion) ?? s(h?.address),
    checkIn: iso(h?.check_in) ?? iso(h?.checkin), checkOut: iso(h?.check_out) ?? iso(h?.checkout),
    lat: n(h?.lat) ?? n(h?.latitud), lng: n(h?.lng) ?? n(h?.longitud), state: s(h?.estado_reserva), fromPdf: h?.desde_pdf === true,
  })).filter((h: TripHotel) => h.name);
}

/**
 * Hotel donde está (o estará) el usuario. Una opción solo cotizada NO es "su hotel": si no hay uno
 * reservado o de su archivo, se devuelve null y Iato pregunta o usa su ubicación.
 */
export function pickHotel(hotels: TripHotel[], todayISO: string): TripHotel | null {
  const own = hotels.filter((h) => h.state !== "cotizado");
  const now = own.find((h) => h.checkIn && h.checkOut && h.checkIn <= todayISO && todayISO < h.checkOut);
  return now ?? own[0] ?? null;
}

// ═══ Plan del turno ═══

export interface ToolSpec { name: string; args: Record<string, unknown>; reason: string }

export interface SuggestedAction { type: string; params: Record<string, unknown> }

export interface TurnPlan {
  intents: Intent[];
  prefetch: ToolSpec[];
  /** Hechos derivados del viaje para el mensaje de contexto (datos, no instrucciones). */
  notes: string[];
  /** Herramientas sugeridas (línea del sistema). */
  toolHints: string[];
  /** Acciones que se ofrecen aunque el modelo no las proponga (máximo 3 en total). */
  suggestedActions: SuggestedAction[];
  /** Cards deterministas (transporte con enlaces, alerta de emergencia). */
  cards: Record<string, unknown>[];
  /** Respuesta inmediata sin modelo (p. ej. "quiero un humano"). */
  direct?: { text: string };
  /**
   * Temas que el usuario no pidió y que no deben colarse en la respuesta (finalize.ts los quita):
   * "vuelo" = consejos de check-in o de a qué hora salir cuando pidió una cena (caso 22-oct-2026).
   */
  avoidTopics?: Array<"vuelo">;
  /**
   * Ola 9.5: paso en vivo cuando el turno no consulta nada antes del modelo ("Revisando tu viaje a
   * Valle de Bravo…"). Antes se veían 4–7 s de "Iato está escribiendo…" sin decir qué pasaba.
   */
  thinking?: string | null;
}

export interface PlanInput {
  message: string;
  intents: Intent[];
  trip: any | null;
  todayISO: string;
  coords: { lat: number; lng: number } | null;
  hasPriveSession: boolean;
  exigente: boolean;
  /** Dónde está el usuario frente a los destinos del viaje (location.ts). Sin dato: "unknown". */
  position?: TripPosition;
  /** Nombre del lugar donde está ("Huixquilucan"), si el navegador lo dio. */
  place?: string | null;
  /** Destino que el mensaje nombra ("restaurantes en Delhi"); no cambia el viaje (turnPlace.ts). */
  requested?: string | null;
  /** Pidió algo "cerca de mí / aquí / cercanos" (turnPlace.ts). */
  nearMe?: boolean;
  /** Reservas IA disponible para este usuario (ai-reservations status → enabled). */
  aiReservationsEnabled?: boolean;
}

/** Nota del turno cuando pide mesa y Reservas IA está disponible para el usuario. */
export const AI_RESERVATION_NOTE = "Reservas IA está disponible para este usuario: si pide mesa en un restaurante concreto, búscalo con search_places (nombre y ciudad) y propón la acción ai_reservation_request {place_id (el id del resultado), nombre (exacto del resultado), fecha YYYY-MM-DD, hora HH:MM, personas, notas?, trip_id?} en lugar de fixer_request. Si falta la fecha, la hora o cuántas personas, pregúntalo en una línea. La tarjeta de la acción ya dice que primero verá a quién y qué le escribiremos y que nada se envía sin su confirmación: no lo repitas. Nunca digas que está reservado ni confirmado: solo lo está cuando el restaurante lo confirma por escrito.";

/**
 * Peticiones concretas que no tienen que ver con el vuelo: en ellas no se agregan consejos del vuelo
 * de hoy (check-in, a qué hora salir) que nadie pidió. Transporte y emergencia no están: ahí el vuelo
 * sí puede importar (ir al aeropuerto, perderlo).
 */
const FOCUSED_NOT_FLIGHT: readonly Intent[] = [
  "dining_near_hotel", "dining", "expense", "packing", "luggage", "members_followup", "prive_night",
  "create_trip", "road_trip", "price_alert", "itinerary_add", "honeymoon_plan", "book_table",
];

const cleanFactQuery = (msg: string) => String(msg ?? "")
  .replace(/[¿?¡!]/g, " ")
  .replace(/\b(d[oó]nde|est[aá]|queda|se encuentra|encuentro|dentro de|me puedes decir|sabes|cu[aá]l es|el horario de|a qu[eé] hora|abre|cierra|el tel[eé]fono de)\b/gi, " ")
  .replace(/\s+/g, " ")
  .trim()
  .slice(0, 160);

/** Hora "HH:MM" menos `h` horas (para "a qué hora salir"). null si no se puede leer. */
export function hoursBefore(time: string | undefined, h: number): string | null {
  const m = String(time ?? "").match(/(\d{1,2}):(\d{2})/);
  if (!m) return null;
  let mins = Number(m[1]) * 60 + Number(m[2]) - h * 60;
  mins = ((mins % 1440) + 1440) % 1440;
  return `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
}

const MX_AIRPORTS = /\b(mex|cdmx|ciudad de mexico|nlu|aifa|cun|cancun|gdl|guadalajara|mty|monterrey|tij|tijuana|sjd|los cabos|pvr|puerto vallarta|mid|merida|oax|oaxaca)\b/;

/** ¿Vuelo internacional? (si no se sabe, se asume internacional: es el margen más seguro). */
export function isInternational(f: TripFlight): boolean {
  const a = normText(f.from), b = normText(f.to);
  if (!a || !b) return true;
  return !(MX_AIRPORTS.test(a) && MX_AIRPORTS.test(b));
}

export function planTurn(i: PlanInput): TurnPlan {
  const plan: TurnPlan = { intents: i.intents, prefetch: [], notes: [], toolHints: [], suggestedActions: [], cards: [] };
  const has = (x: Intent) => i.intents.includes(x);
  const trip = i.trip;
  const tripId = typeof trip?.id === "string" ? trip.id : null;
  const flights = trip ? tripFlights(trip) : [];
  const hotel = trip ? pickHotel(tripHotels(trip), i.todayISO) : null;
  const flight = pickFlight(flights, i.message, i.todayISO);
  const city = (hotel?.city ?? String(trip?.destino ?? "").split(/→|,|;/)[0]).trim() || null;
  // Fuera de los destinos del viaje (p. ej. en su ciudad el día de salida): "cerca" es local.
  const away = i.position === "away";
  const place = typeof i.place === "string" && i.place.trim() ? i.place.trim().slice(0, 80) : null;
  // Un viaje que no ha empezado nunca es "aquí": su hotel no es punto de partida de "cerca".
  const futureTrip = !!trip?.fecha_salida && String(trip.fecha_salida).slice(0, 10) > i.todayISO;
  const requested = typeof i.requested === "string" && i.requested.trim() ? i.requested.trim().slice(0, 60) : null;

  // Fecha y hora que el mensaje pide (nunca se inventan: sin fecha escrita no hay fecha).
  const when = requestedWhen(i.message, i.todayISO);

  if (has("book_table") && i.aiReservationsEnabled === true) plan.notes.push(AI_RESERVATION_NOTE);

  if (has("human")) {
    plan.direct = { text: "Por supuesto. Te conecto con una persona del equipo IATOS: toca **Hablar con una persona** arriba y cuéntale qué necesitas. Es atención humana sujeta a disponibilidad." };
    return plan;
  }

  // Vuelo hoy/mañana del viaje: se ofrece aunque la pregunta sea otra, salvo que pida algo concreto que
  // no tiene que ver con el vuelo (una cena): ahí no se cuelan consejos que no pidió.
  const flightIntent = has("flight_status") || has("flight_disruption") || has("missed_connection");
  const focusedElsewhere = !flightIntent && i.intents.some((x) => FOCUSED_NOT_FLIGHT.includes(x));
  const flightSoon = flight && flight.date && (flight.date === i.todayISO || flight.date === addDays(i.todayISO, 1)) ? flight : null;
  if (focusedElsewhere) {
    // Aunque el viaje no traiga número de vuelo, el modelo puede inferir "sales hoy" de las fechas.
    plan.avoidTopics = ["vuelo"];
    if (flightSoon || trip) plan.notes.push("No agregues consejos del vuelo (check-in, a qué hora salir al aeropuerto, estado) en esta respuesta: no los pidió.");
  } else if (flightSoon) {
    const when = flightSoon.date === i.todayISO ? "hoy" : "mañana";
    const margin = isInternational(flightSoon) ? 3 : 2;
    const arrive = hoursBefore(flightSoon.departs, margin);
    plan.notes.push(
      `Vuelo ${flightSoon.code} ${when}${flightSoon.departs ? `, sale ${flightSoon.departs}` : ""}${flightSoon.from ? ` de ${flightSoon.from}` : ""}${flightSoon.to ? ` a ${flightSoon.to}` : ""}` +
      `${flightSoon.fromPdf ? " (según su archivo, sin verificar)" : ""}.` +
      (arrive ? ` Regla general (no dato en vivo): llegar al aeropuerto ${margin} h antes en ${margin === 3 ? "internacional" : "nacional"}, o sea ~${arrive}, más el traslado.` : ""),
    );
  }

  // Proactivo: si el vuelo del viaje sale HOY, su estado real se consulta aunque la pregunta sea otra
  // (caché de 10 min compartida), y Iato lo menciona en una línea.
  if (flightSoon && flightSoon.date === i.todayISO && !flightIntent && !has("emergency") && !focusedElsewhere) {
    plan.prefetch.push({ name: "check_flight_status", args: { flight: flightSoon.code, date: flightSoon.date }, reason: "vuelo de hoy (proactivo)" });
    plan.notes.push(`Menciona en una línea el estado real del vuelo ${flightSoon.code} de hoy (viene en <datos_consultados>).`);
  }

  if (flightIntent) {
    if (flight?.code) {
      plan.prefetch.push({ name: "check_flight_status", args: { flight: flight.code, ...(flight.date ? { date: flight.date } : {}) }, reason: "estado del vuelo" });
      plan.suggestedActions.push({ type: "track_flight", params: { vuelo: flight.code, fecha: flight.date ?? i.todayISO, ...(tripId ? { trip_id: tripId } : {}) } });
    } else {
      plan.notes.push("No hay un número de vuelo en el viaje en contexto: pídeselo al usuario (ej. AM 002) en una línea.");
    }
  }

  if (has("flight_disruption") || has("missed_connection")) {
    const origin = has("missed_connection") ? (flight?.to ?? null) : (flight?.from ?? trip?.ciudad_origen ?? null);
    const dest = has("missed_connection") ? (trip?.destino ?? flight?.to ?? null) : (flight?.to ?? trip?.destino ?? null);
    if (origin && dest && origin !== dest) {
      const date = flight?.date && flight.date > i.todayISO ? flight.date : i.todayISO;
      plan.prefetch.push({ name: "search_flights", args: { origin, destination: dest, departure_date: date, adults: Number(trip?.num_viajeros) || 1 }, reason: "alternativas" });
    }
    plan.prefetch.push({
      name: "web_search",
      args: { query: `derechos del pasajero vuelo ${has("missed_connection") ? "conexión perdida" : "cancelado"} ${flight?.airline ?? ""}`.replace(/\s+/g, " ").trim() },
      reason: "derechos del pasajero",
    });
    plan.suggestedActions.unshift({
      type: "fixer_request",
      params: {
        tipo: "rebooking",
        titulo: has("missed_connection") ? `Conexión perdida${flight?.code ? ` · ${flight.code}` : ""}` : `Vuelo cancelado${flight?.code ? ` · ${flight.code}` : ""}`,
        detalle: i.message.slice(0, 400),
        ...(tripId ? { trip_id: tripId } : {}),
      },
    });
    plan.notes.push("Prioridad: 1) estado real del vuelo, 2) alternativas con horario y precio, 3) derechos del pasajero con fuente, 4) una persona del equipo IATOS para negociar con la aerolínea.");
  }

  if (has("flight_compare")) {
    const origin = trip?.ciudad_origen ?? null;
    const dest = trip?.destino ?? null;
    const dep = iso(trip?.fecha_salida);
    if (origin && dest && dep && dep >= i.todayISO) {
      plan.prefetch.push({
        name: "search_flights",
        args: { origin, destination: String(dest).split(/→|,|;/)[0].trim(), departure_date: dep, ...(iso(trip?.fecha_regreso) ? { return_date: iso(trip?.fecha_regreso) } : {}), adults: Number(trip?.num_viajeros) || 1 },
        reason: "comparar vuelos",
      });
      if (tripId && !tripIsByLand(trip)) plan.suggestedActions.push({ type: "create_price_alert", params: { trip_id: tripId } });
    } else {
      plan.notes.push("Para comparar vuelos faltan origen, destino o fecha en el viaje: pregunta solo lo que falte.");
    }
  }

  const wantsHotel = /\bhotel\b/.test(normText(i.message));
  if ((has("dining_near_hotel") || has("dining")) && requested && !wantsHotel) {
    // "Restaurantes en Delhi": se busca en el lugar pedido, sin cambiar el viaje seleccionado.
    const sameTrip = !!trip && normText(String(trip.destino ?? "")).includes(normText(requested));
    plan.notes.push(`El usuario pidió lugares en ${requested}: responde sobre ${requested}${trip && !sameTrip ? "; no es el viaje en contexto: no lo cambies ni propongas agregarlo a ese viaje" : ""}.`);
    // "Cena romántica en Florencia el 14": la consulta del usuario (romántica, especial) y la comida
    // (servesDinner real) van a Text Search; la ciudad arma TheFork y la taquilla oficial.
    const special = specialDiningPhrase(i.message);
    const meal = mealFromText(i.message);
    plan.prefetch.push({
      name: "search_places",
      args: { query: `${special ?? "restaurantes"} en ${requested}`, city: requested, ...(meal ? { meal } : {}) },
      reason: "restaurantes en el destino pedido",
    });
    if (special) plan.notes.push(`La búsqueda fue «${special} en ${requested}» en Google Maps: di que son los que Google muestra para esa búsqueda, sin llamar romántico a un lugar por tu cuenta. Los botones de reserva los pone IATOS; nada está reservado.`);
    if (i.exigente) plan.prefetch.push({ name: "search_attractions", args: { query: `mejores restaurantes en ${requested}`, category: "restaurants" }, reason: "ranking de la ciudad" });
  } else if (has("dining_near_hotel") || (has("dining") && (hotel || i.coords || (away && place) || i.nearMe))) {
    // Pidió "cerca" y está fuera de los destinos del viaje (o el viaje es futuro): cerca de donde
    // está, no del hotel del viaje (salvo que nombre el hotel).
    const local = (away || futureTrip) && !wantsHotel;
    if (local) {
      plan.notes.push(`El usuario está en ${place ?? "su ubicación actual"}, fuera de los destinos de su viaje: recomienda lugares cerca de donde está, en corto, y no los ligues al viaje ni propongas agregarlos al itinerario (puede guardarlos en favoritos con save_place).`);
    }
    if (hotel && !local) {
      plan.notes.push(`Hotel del usuario: ${hotel.name}${hotel.address ? `, ${hotel.address}` : ""}${hotel.city ? `, ${hotel.city}` : ""}${hotel.fromPdf ? " (según su archivo)" : ""}.`);
      plan.prefetch.push({
        name: "search_places",
        args: { query: `restaurantes cerca de ${hotel.name}${hotel.city ? `, ${hotel.city}` : ""}`, ...(hotel.lat !== undefined && hotel.lng !== undefined ? { lat: hotel.lat, lng: hotel.lng } : {}) },
        reason: "restaurantes cerca del hotel",
      });
    } else if (i.coords) {
      plan.prefetch.push({ name: "search_nearby", args: { lat: i.coords.lat, lng: i.coords.lng, kind: "restaurant" }, reason: "restaurantes cerca" });
    } else if (local && place) {
      plan.prefetch.push({ name: "search_places", args: { query: `restaurantes en ${place}` }, reason: "restaurantes cerca" });
    } else if (local) {
      plan.notes.push("No hay ubicación actual del usuario: pregunta en una línea en qué zona está o que active la ubicación. No uses el destino ni el hotel de su viaje: no está ahí.");
    } else {
      plan.notes.push("No hay hotel reservado ni ubicación del usuario: pregunta en qué hotel o zona está, en una línea.");
    }
    const rankCity = local ? place : city;
    if (i.exigente && rankCity) {
      plan.prefetch.push({ name: "search_attractions", args: { query: `mejores restaurantes en ${rankCity}`, category: "restaurants" }, reason: "ranking de la ciudad" });
    }
    // "Agregar a tu viaje" solo si la cena es en el viaje (finalize.ts vuelve a revisar con el lugar).
    // La fecha y la hora son las que pidió (N-P1-3); sin fecha escrita, la de hoy ("cenar cerca de mi hotel").
    if (tripId && !local && !away) {
      const meal = mealFromText(i.message);
      plan.suggestedActions.push({ type: "add_itinerary_item", params: {
        trip_id: tripId, fecha: when.fecha ?? i.todayISO, hora: when.hora ?? "20:30",
        titulo: meal === "comida" ? "Comida" : meal === "desayuno" ? "Desayuno" : meal === "brunch" ? "Brunch" : "Cena",
      } });
    }
  }

  // Clima: la herramienta real con la ciudad pedida o la del viaje y, si es el viaje, sus fechas.
  if (has("weather")) {
    const wcity = requested ?? city;
    if (wcity) {
      const sameTrip = !!trip && (!requested || normText(String(trip.destino ?? "")).includes(normText(requested)));
      const from = sameTrip ? iso(trip?.fecha_salida) : null, to = sameTrip ? iso(trip?.fecha_regreso) : null;
      plan.prefetch.push({ name: "get_weather", args: { city: wcity, ...(from ? { date_from: from } : {}), ...(to ? { date_to: to } : {}) }, reason: "clima" });
      plan.notes.push("Clima: usa SOLO lo que trae get_weather (MET Norway / NASA POWER) con su fuente y hora de consulta. Si las fechas están fuera del pronóstico, dilo y da el clima típico como típico. Nunca des cifras de memoria.");
    } else {
      plan.notes.push("Para el clima falta la ciudad: pregúntala en una línea.");
    }
    plan.toolHints.push("get_weather");
  }

  // Hora actual (N-P1-6): el reloj de IATOS, nunca "no tengo reloj".
  if (has("time")) {
    const tcity = requested;
    if (tcity) {
      plan.prefetch.push({ name: "get_local_time", args: { city: tcity }, reason: "hora local" });
      plan.notes.push(`Hora: di la hora actual de ${tcity} tal cual viene en get_local_time (campo texto) y la diferencia con el usuario. Nunca digas que no tienes reloj.`);
    } else {
      plan.notes.push("Hora: si pregunta su hora, usa la HORA ACTUAL DEL USUARIO del sistema; si es de otra ciudad, get_local_time. Nunca digas que no tienes reloj.");
    }
    plan.toolHints.push("get_local_time");
  }

  if (has("place_fact")) {
    const q = cleanFactQuery(i.message) || i.message.slice(0, 160);
    plan.prefetch.push({ name: "web_search", args: { query: q }, reason: "dato práctico" });
    plan.prefetch.push({ name: "search_places", args: { query: q, details: true }, reason: "ficha del lugar" });
    plan.toolHints.push("web_search", "search_places");
  }

  if (has("honeymoon_plan")) {
    const hcity = requested ?? city;
    if (hcity) {
      const from = iso(trip?.fecha_salida), to = iso(trip?.fecha_regreso);
      const special = specialDiningPhrase(i.message) ?? "cena romántica";
      const already = (q: string) => plan.prefetch.some((p) => p.name === "search_places" && String(p.args.query ?? "").startsWith(q));
      if (!already("desayuno")) plan.prefetch.push({ name: "search_places", args: { query: `desayuno en ${hcity}`, meal: "desayuno", city: hcity }, reason: "desayunos" });
      if (!plan.prefetch.some((p) => p.name === "search_places" && p.args.meal === "cena")) {
        plan.prefetch.push({ name: "search_places", args: { query: `${special} en ${hcity}`, meal: "cena", city: hcity }, reason: "cenas" });
      }
      plan.prefetch.push({ name: "search_tours", args: { city: hcity, ...(from ? { date_from: from } : {}), ...(to ? { date_to: to } : {}) }, reason: "experiencias" });
      if (from) plan.toolHints.push("search_events");
      plan.toolHints.push("search_tours", "search_places");
      const museos = officialTicketsForCity(hcity);
      if (museos.length) {
        plan.notes.push(`Museos con taquilla OFICIAL en ${hcity} (tabla de IATOS, verificada 27-oct-2026): ${museos.map((m) => `${m.nombre}${m.nota ? ` — ${m.nota}` : ""}`).join("; ")}. Escribe una card "attraction" por museo con ese nombre exacto: IATOS agrega "Boletos oficiales" y "Con guía o sin fila en Viator". No agregues plazos ni "se agota" que la nota no diga.`);
      }
      plan.notes.push(`Plan de ${hcity}: por día, desayuno, mañana (museo), comida, tarde (experiencia) y cena, solo con lugares de los resultados. Ninguno está reservado: los botones abren el sitio del proveedor. En el viaje, pestaña Experiencias, puede buscar lo TOP, armar su itinerario y marcar "Ya reservé".`);
    } else {
      plan.notes.push("Para el plan falta la ciudad: pregunta en una línea qué ciudad.");
    }
  }

  if (has("day_plan")) {
    const day = requestedWhen(i.message, i.todayISO).fecha ?? (/\bhoy\b/.test(normText(i.message)) ? i.todayISO : null);
    const dcity = requested ?? city;
    const inForecast = !!day && day >= i.todayISO && day <= addDays(i.todayISO, 9);
    if (dcity && day && inForecast && !plan.prefetch.some((p) => p.name === "get_weather")) {
      plan.prefetch.push({ name: "get_weather", args: { city: dcity, date_from: day, date_to: day }, reason: "clima del día" });
      plan.toolHints.push("get_weather");
    }
    plan.notes.push(dayPlanNote(day, tripId));
  }

  if (has("expense_query")) {
    plan.prefetch.push({ name: "get_trip_expenses", args: tripId ? { trip_id: tripId } : {}, reason: "gastos registrados" });
    plan.notes.push(EXPENSE_QUERY_NOTE);
  }

  if (has("events")) {
    plan.toolHints.push("search_events");
    plan.notes.push("Pidió eventos: usa search_events con la ciudad y el rango de fechas (las del viaje si habla de su viaje). Solo eventos que devuelva la herramienta; si no hay, dilo. Los boletos se compran en el sitio de boletos: nunca digas que están comprados.");
  }

  if (has("tours")) {
    plan.toolHints.push("search_tours");
    plan.notes.push("Pidió tours o actividades: usa search_tours con la ciudad (y las fechas del viaje si habla de su viaje). Solo tours que devuelva Viator; el precio es \"desde\" en su moneda. \"Ver en Viator\" abre la ficha en viator.com: nunca digas que está reservado.");
  }

  if (has("emergency")) {
    // Ola 9.5 (robo de cartera en la calle): se buscaba el hospital y la respuesta abría con "Busco el
    // hospital más cercano… Si estás herida, el Hospital de Jesús". Un robo o una pérdida sin heridas pide
    // la policía o el Ministerio Público más cercano y los pasos (tarjetas, denuncia, documentos).
    const theft = isTheftOrLoss(i.message);
    plan.cards.push({
      type: "alert", title: "Ayuda inmediata",
      body: theft
        ? "Si estás en peligro, llama al número de emergencias local ahora (911 en México). En la pantalla 'Emergencia local' tienes los números y la policía más cercana."
        : "Si hay riesgo para tu vida, llama al número de emergencias local ahora. En la pantalla 'Emergencia local' tienes los números y el hospital más cercano.",
    });
    if (i.coords) plan.prefetch.push(theft
      ? { name: "search_nearby", args: { lat: i.coords.lat, lng: i.coords.lng, kind: "police" }, reason: "policía más cercana" }
      : { name: "search_nearby", args: { lat: i.coords.lat, lng: i.coords.lng, kind: "hospital" }, reason: "hospital más cercano" });
    if (theft) plan.notes.push(THEFT_NOTE);
    plan.notes.push(theft
      ? "La tarjeta 'Ayuda inmediata' ya le dice que llame al número de emergencias local: NO lo repitas en el texto; da los pasos y la policía más cercana (cómo llegar, su teléfono)."
      : "La tarjeta 'Ayuda inmediata' ya le dice que llame al número de emergencias local: NO lo repitas en el texto; da el dato útil (el hospital, cómo llegar, su teléfono).");
    plan.suggestedActions.unshift({ type: "open_emergency", params: {} });
    plan.suggestedActions.push({ type: "fixer_request", params: { tipo: "other", titulo: "Ayuda urgente", detalle: i.message.slice(0, 400), ...(tripId ? { trip_id: tripId } : {}) } });
  }

  if (has("transport")) {
    // Fuera de los destinos del viaje, "transporte ahora" no es al hotel del viaje (salvo que lo nombre).
    const dest = away && !/\bhotel\b/.test(normText(i.message)) ? null : hotel;
    if (dest) {
      plan.notes.push(`Destino natural: su hotel ${dest.name}${dest.address ? `, ${dest.address}` : ""}.`);
      plan.cards.push(transportCard(dest));
    }
    plan.suggestedActions.push({ type: "fixer_request", params: { tipo: "transport", titulo: `Traslado privado${dest ? ` a ${dest.name}` : ""}`, detalle: i.message.slice(0, 300), ...(tripId ? { trip_id: tripId } : {}) } });
  }

  if (has("road_trip")) {
    const rt = roadTripTurn(i.message);
    if (rt) {
      plan.notes.push(...rt.notes);
      plan.cards.push(...rt.cards);
    }
  }

  if (has("prive_night")) {
    if (i.hasPriveSession && city) {
      plan.prefetch.push({
        name: "search_prive",
        args: { cities: [city], intents: [i.message.slice(0, 200)], plan: { request: i.message.slice(0, 300), date_from: i.todayISO, nights: 1, ...(hotel?.lat !== undefined ? { hotel: { name: hotel.name, lat: hotel.lat, lng: hotel.lng } } : {}) } },
        reason: "catálogo Privé",
      });
    } else if (!i.hasPriveSession) {
      plan.notes.push("IATOS Privé está bloqueado en esta sesión: explica que se desbloquea en la sección Privé de la app; no menciones lugares Privé.");
    } else {
      plan.notes.push("Para el plan Privé falta la ciudad: pregúntala.");
    }
  }

  if (has("hotel_change")) {
    plan.notes.push("El usuario cambió de hotel: si no dijo cuál, pregunta nombre (y fechas si cambian) en una línea; con el nombre, propone la acción update_trip_hotel y ofrece cena o transporte cerca del nuevo hotel.");
  }

  if (has("luggage")) {
    plan.notes.push("Equipaje Invisible: no hay proveedor conectado (sin precios ni disponibilidad). Ofrece la card 'luggage' como solicitud de cotización a un humano, con origen y destino del viaje si se conocen.");
    plan.suggestedActions.push({ type: "fixer_request", params: { tipo: "luggage", titulo: "Equipaje Invisible · cotización", detalle: i.message.slice(0, 300), ...(tripId ? { trip_id: tripId } : {}) } });
  }

  if (has("members_followup")) {
    plan.notes.push("El usuario ya envió una solicitud de mesa desde Solo para miembros (no es reserva). Confírmale que quedó en manos del equipo, dale el enlace del lugar si existe y una alternativa por si no hay mesa.");
  }

  if (has("trip_overview") && tripId) {
    plan.notes.push("Panorama del viaje: di en 2–4 viñetas qué está reservado, qué falta (de <faltantes_viaje>) y el siguiente paso concreto; ofrece 1–3 acciones.");
    if (iso(trip?.fecha_salida) && String(trip.fecha_salida) > i.todayISO && !tripIsByLand(trip)) plan.suggestedActions.push({ type: "create_price_alert", params: { trip_id: tripId } });
    const next = flights.find((f) => f.date && f.date >= i.todayISO);
    if (next) plan.suggestedActions.push({ type: "track_flight", params: { vuelo: next.code, fecha: next.date, trip_id: tripId } });
  }

  if (has("create_trip") && !trip) {
    plan.notes.push("No hay un viaje para ese destino: ofrece crearlo con la acción create_trip (destino y fechas si las dio).");
  }

  if (i.exigente) {
    // Modo exigente: siempre queda lista la mano humana para cerrar lo elegido (Iato no reserva).
    if (has("flight_compare")) plan.suggestedActions.push({ type: "fixer_request", params: { tipo: "other", titulo: "Que nuestro equipo gestione el vuelo elegido", detalle: i.message.slice(0, 300), ...(tripId ? { trip_id: tripId } : {}) } });
    if ((has("dining_near_hotel") || has("dining")) && !(has("book_table") && i.aiReservationsEnabled === true)) {
      // N-P1-3: la mesa va con la fecha y la hora que pidió y un título concreto (comida o cena, lugar y
      // día). Sin fecha escrita no se inventa: Iato la pide y no deja un botón con la fecha de hoy.
      // "Quiero cenar" sin fecha, ya en el destino y con el viaje en curso, es hoy (no se inventa: es ahora).
      const inProgressHere = !!trip && !away && !!iso(trip?.fecha_salida) && String(trip.fecha_salida).slice(0, 10) <= i.todayISO
        && (!iso(trip?.fecha_regreso) || i.todayISO <= String(trip.fecha_regreso).slice(0, 10));
      const fecha = when.fecha ?? (inProgressHere && !BROADER_ASK.test(normText(i.message)) ? i.todayISO : null);
      if (fecha) {
        const meal = mealFromText(i.message);
        const what = meal === "comida" ? "Mesa para comer" : meal === "desayuno" ? "Mesa para desayunar" : meal === "brunch" ? "Mesa para el brunch" : "Mesa para cenar";
        const where = requested ?? (away ? place : city);
        plan.suggestedActions.push({ type: "fixer_request", params: {
          tipo: "reservation",
          titulo: `${what}${where ? ` en ${where}` : ""} · ${fecha === i.todayISO && !when.fecha ? "hoy" : whenLabel(fecha)}${when.hora ? ` ${when.hora}` : ""}`,
          fecha, ...(when.hora ? { hora: when.hora } : {}),
          detalle: i.message.slice(0, 300),
          ...(tripId && !away ? { trip_id: tripId } : {}),
        } });
        if (!when.hora) plan.notes.push("Para pedir la mesa falta la hora: pregúntala en una línea.");
      } else {
        plan.notes.push("Si va a pedir mesa, pregunta en una línea para qué fecha y hora (no la des por hecha).");
      }
    }
    plan.notes.push("MODO EXIGENTE: compara a fondo y presenta 'La mejor / La alternativa / El plan B' con el porqué, la fuente y la contra de cada una (una línea por opción); anticipa la siguiente necesidad relacionada en una línea.");
  }

  plan.prefetch = dedupeSpecs(plan.prefetch).slice(0, i.exigente ? 5 : 3);
  plan.suggestedActions = plan.suggestedActions.slice(0, 3);
  // Paso en vivo cuando no hay nada que consultar antes del modelo (ola 9.5).
  if (!plan.prefetch.length) plan.thinking = thinkingText(plan.intents, trip, i.message);
  return plan;
}

function dedupeSpecs(list: ToolSpec[]): ToolSpec[] {
  const seen = new Set<string>();
  return list.filter((t) => {
    const k = `${t.name}:${JSON.stringify(t.args)}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Card de transporte con enlaces reales (Uber y Google Maps) hacia un hotel. Sin precio. */
export function transportCard(h: TripHotel): Record<string, unknown> {
  const dest = { lat: h.lat, lng: h.lng, name: h.name, address: [h.address, h.city].filter(Boolean).join(", ") };
  return {
    type: "transport", title: `Ir a ${h.name}`, subtitle: dest.address || undefined,
    links: [
      { kind: "ride", label: "Pedir Uber", url: uberLink(dest) },
      { kind: "directions", label: "Cómo llegar", url: directionsLink(dest) },
    ],
  };
}

export interface LinkTarget { lat?: number; lng?: number; name?: string; address?: string; placeId?: string }

/** Google Maps: ruta desde la ubicación del usuario hasta el lugar. */
export function directionsLink(t: LinkTarget, mode: "driving" | "walking" | "transit" = "driving"): string {
  const u = new URL("https://www.google.com/maps/dir/");
  u.searchParams.set("api", "1");
  u.searchParams.set("destination", t.lat !== undefined && t.lng !== undefined ? `${t.lat},${t.lng}` : [t.name, t.address].filter(Boolean).join(", "));
  if (t.placeId) u.searchParams.set("destination_place_id", t.placeId);
  u.searchParams.set("travelmode", mode);
  return u.toString();
}

/** Uber (enlace universal): recoge en la ubicación actual y deja en el lugar. */
export function uberLink(t: LinkTarget): string {
  const u = new URL("https://m.uber.com/ul/");
  u.searchParams.set("action", "setPickup");
  u.searchParams.set("pickup", "my_location");
  if (t.lat !== undefined && t.lng !== undefined) {
    u.searchParams.set("dropoff[latitude]", String(t.lat));
    u.searchParams.set("dropoff[longitude]", String(t.lng));
  }
  if (t.name) u.searchParams.set("dropoff[nickname]", t.name);
  if (t.address) u.searchParams.set("dropoff[formatted_address]", t.address);
  return u.toString();
}

// ═══ Política de herramientas ═══

const DINING_OR_RANKING = /\b(restaurante|restaurant|comer|cenar|cena|bar|cafe|atraccion|museo|tour|que ver|que hacer|mejores|ranking|resen|hotel)\w*/;

/**
 * TripAdvisor solo para rankings de restaurantes/atracciones. Si el mensaje del usuario es un dato
 * práctico (ubicación, horario, sala de aeropuerto…) y no pide recomendaciones, la llamada se manda a
 * web_search con la misma consulta.
 */
export function applyToolPolicy(name: string, args: Record<string, unknown>, userMessage: string): { name: string; args: Record<string, unknown>; rerouted?: string; blocked?: string } {
  // Event Radar: cada búsqueda de eventos cuesta; solo si el usuario pidió eventos o qué hacer en fechas concretas.
  // Plan de luna de miel / "lo TOP" con fechas: también pide eventos de esas fechas.
  if (name === "search_events") return eventsRequested(userMessage) || (honeymoonRequested(userMessage) && !!args.date_from) ? { name, args } : { name, args, blocked: "eventos_no_pedidos" };
  // Tours de Viator: solo si el usuario pidió tours o actividades (gasta de la bolsa de búsquedas en vivo).
  if (name === "search_tours") return toursRequested(userMessage) || honeymoonRequested(userMessage) ? { name, args } : { name, args, blocked: "tours_no_pedidos" };
  // Auditoría 10 #16: "¿qué debo saber antes de ir a Tailandia?" consultaba el clima de Valle de Bravo
  // (el viaje en contexto). Si el mensaje nombra un lugar, el clima es de ese lugar o no se consulta.
  if (name === "get_weather") {
    const named = requestedDestination(userMessage);
    if (named && !weatherCityMatches(String(args.city ?? ""), named)) {
      return { name, args, blocked: "clima_de_otro_lugar" };
    }
    return { name, args };
  }
  if (name !== "search_attractions") return { name, args };
  const m = normText(userMessage);
  const q = normText(args.query);
  const fact = RULES.find(([k]) => k === "place_fact")![1].test(m) || /\b(lounge|sala|terminal|aeropuerto|puerta|horario|telefono)\b/.test(q);
  if (fact && !DINING_OR_RANKING.test(m)) {
    return { name: "web_search", args: { query: String(args.query ?? userMessage).slice(0, 200) }, rerouted: "search_attractions→web_search" };
  }
  return { name, args };
}

/** ¿La ciudad del clima es (o está en) el lugar que nombró el usuario? */
export function weatherCityMatches(city: string, named: string): boolean {
  const c = normText(city), n = normText(named);
  if (!c || !n) return false;
  if (c.includes(n) || n.includes(c)) return true;
  const country = normText(cityAirports(city)?.country ?? "");
  return !!country && (country === n || country.includes(n) || n.includes(country));
}

// ═══ Pasos en vivo ═══

const KIND_LABEL: Record<string, string> = {
  restaurant: "restaurantes", hospital: "hospitales", police: "policía", pharmacy: "farmacias", atm: "cajeros",
  embassy: "embajadas", gas_station: "gasolineras", lodging: "hoteles",
};

const clip = (v: unknown, max = 60) => {
  const t = String(v ?? "").replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

export function toolStatusText(name: string, args: Record<string, unknown>): string {
  switch (name) {
    case "check_flight_status": return `Consultando tu vuelo ${clip(args.flight, 12)}…`;
    case "search_flights": return `Buscando vuelos ${clip(args.origin, 20)} → ${clip(args.destination, 20)}…`;
    case "search_hotels": return `Buscando hoteles en ${clip(args.city, 30)}…`;
    case "search_places": return `Buscando en Google Maps: ${clip(args.query)}…`;
    case "search_nearby": return `Buscando ${KIND_LABEL[String(args.kind)] ?? "lugares"} cerca…`;
    case "web_search": return `Buscando en Google: ${clip(args.query)}…`;
    // La búsqueda de Iato va directo a Google Maps (tripadvisor-search sin uso de pantalla), N10.
    // Ranking de restaurantes (Modo exigente): no es una búsqueda de "atracciones" (N-P2-2).
    case "search_attractions": return args.category === "restaurants" || /\brestaurant/i.test(String(args.query ?? ""))
      ? `Buscando en Google Maps: ${clip(args.query)}…`
      : `Buscando atracciones en Google Maps: ${clip(args.query)}…`;
    case "search_events": return `Buscando eventos en ${clip(args.city, 30)}…`;
    case "search_tours": return `Buscando tours en Viator: ${clip(args.city, 30)}…`;
    case "search_members_venues": return `Revisando Solo para miembros en ${clip(args.city, 30)}…`;
    case "get_local_time": return `Consultando la hora en ${clip(args.city ?? args.timezone, 30)}…`;
    case "search_prive": return "Revisando el catálogo Privé…";
    case "get_weather": return `Consultando el clima de ${clip(args.city, 30)} (MET Norway)…`;
    case "get_travel_advisory": return `Revisando avisos oficiales de ${clip(args.pais ?? args.destino, 30)}…`;
    case "get_trip_expenses": return "Revisando tus gastos registrados…";
    case "report_incident": return "Abriendo tu caso con el equipo IATOS…";
    default: return "Consultando…";
  }
}

/** Resultado del paso para el usuario: hecho, sin resultados o sin respuesta del servicio. */
export function toolOutcome(prepared: Record<string, unknown>): { state: "done" | "empty" | "error"; suffix: string } {
  if (prepared.disponible !== false) return { state: "done", suffix: "listo" };
  const estado = String(prepared.estado ?? "");
  if (estado === "sin_resultados") return { state: "empty", suffix: "sin resultados" };
  if (estado === "limite_del_plan") return { state: "error", suffix: "límite del plan" };
  if (estado === "limite_diario") return { state: "error", suffix: "límite de búsquedas en vivo de hoy" };
  if (estado === "sin_acceso") return { state: "error", suffix: "requiere PRO" };
  return { state: "error", suffix: "no respondió" };
}

// ═══ Frase de inicio mientras corren las herramientas (Rendimiento, cierre 2026-10) ═══
//
// En vivo el primer texto tardaba 5–11 s: las herramientas previstas (vuelos en SerpApi ~5–8 s)
// van antes del modelo y el modelo no puede decir nada útil sin sus datos. Si siguen corriendo después
// de un momento, turn.ts muestra UNA frase que solo dice qué está haciendo Iato, armada con lo que el
// usuario ya dio (su vuelo, su hotel, su pregunta): nunca un resultado, un precio, un estado ni una
// disponibilidad. Después el modelo continúa en el mismo párrafo sin repetirla.

const LEAD_CLIP = (v: unknown, max = 40) => clip(v, max).replace(/…$/, "");

/**
 * La pregunta pide más que lo que dice la frase (un plan, qué hacer, museos…): "Busco restaurantes en
 * Valle de Bravo en Google Maps." sobra (auditoría 10 #16, ronda 2: Modo exigente con un plan de tarde).
 */
const BROADER_ASK = /\b(que hacer|que ver|que visitar|plan|planes|planea\w*|itinerario|actividades|recorrido|paseo|museos?|dia de lluvia|tarde|dia completo|fin de semana)\b/;

export function leadSentence(plan: Pick<TurnPlan, "intents" | "prefetch">, opts: { exigente?: boolean; message?: string } = {}): string | null {
  const specs = plan.prefetch;
  if (!specs.length) return null;
  const has = (i: Intent) => plan.intents.includes(i);
  const spec = (n: string) => specs.find((s) => s.name === n);
  const status = spec("check_flight_status");
  const flights = spec("search_flights");
  const nearby = spec("search_nearby");
  const places = spec("search_places");
  const code = status ? LEAD_CLIP(status.args.flight, 12) : "";
  const broader = BROADER_ASK.test(normText(opts.message ?? ""));
  if (has("emergency")) {
    // N4-P2-5 (ronda 4): el aviso "llama al número de emergencias" va UNA vez, en la tarjeta "Ayuda
    // inmediata"; antes salía también aquí y en el texto del modelo (tres veces en un globo).
    return nearby?.args.kind === "hospital" ? "Busco el hospital más cercano a tu ubicación."
      : nearby?.args.kind === "police" ? "Busco la policía más cercana a tu ubicación." : "Reviso cómo ayudarte.";
  }
  if (has("flight_disruption") || has("missed_connection")) {
    const what = has("missed_connection") ? "tu conexión" : code ? `tu vuelo ${code}` : "tu vuelo";
    return `Reviso en tiempo real ${what}${flights ? ", busco alternativas" : ""} y tus derechos como pasajero.`;
  }
  // Modo exigente: la respuesta es un plan comparado con encabezado propio; una frase de una sola
  // búsqueda ("Busco restaurantes…") no describe lo que viene.
  if (opts.exigente) return null;
  if (has("flight_compare") && flights) {
    return `Comparo los vuelos ${LEAD_CLIP(flights.args.origin, 24)} → ${LEAD_CLIP(flights.args.destination, 24)} para tus fechas.`;
  }
  if (has("place_fact")) return "Busco ese dato en Google y en Google Maps para darte la ubicación exacta.";
  // Clima: sin frase de relleno (auditoría 10 #16, ronda 3): el paso "Consultando el clima…" ya lo dice
  // y la respuesta abre con el dato y su fuente.
  if (places && (has("dining_near_hotel") || has("dining"))) {
    if (broader) return null;
    if (places.reason === "restaurantes en el destino pedido") return `Busco ${LEAD_CLIP(places.args.query, 60)} en Google Maps.`;
    return places.reason === "restaurantes cerca del hotel" ? "Busco restaurantes cerca de tu hotel en Google Maps." : "Busco restaurantes cerca de ti en Google Maps.";
  }
  if (nearby) return `Busco ${KIND_LABEL[String(nearby.args.kind)] ?? "lugares"} cerca de ti.`;
  if (spec("search_prive")) return "Reviso el catálogo Privé verificado.";
  if (status) return has("flight_status") ? `Reviso en tiempo real tu vuelo ${code}.` : `De paso reviso en tiempo real tu vuelo ${code} de hoy.`;
  if (spec("search_events")) return `Busco eventos en ${LEAD_CLIP(spec("search_events")!.args.city, 30)} para esas fechas.`;
  if (spec("get_travel_advisory")) return "Reviso los avisos oficiales de viaje.";
  // Sin una frase que diga algo concreto, mejor ninguna ("Consulto los datos en vivo…" no aporta).
  return null;
}

/** Une la frase de inicio con la respuesta del modelo: mismo párrafo, o párrafo nuevo si la respuesta
 *  empieza con una lista, un encabezado o una tabla. */
export function joinLead(lead: string, text: string): string {
  const t = String(text ?? "").replace(/^\s+/, "");
  if (!t) return lead;
  return `${lead}${leadSeparator(t)}${t}`;
}

export function leadSeparator(nextText: string): string {
  return /^([-*•#>|]|\d+[.)]\s)/.test(nextText.replace(/^\s+/, "")) ? "\n\n" : " ";
}


// ═══ Ola 9.5 (29-oct-2026): robo o pérdida, plan del día, gastos y paso en vivo ═══

const THEFT = /\b(me robaron|nos robaron|robo|robaron|asalt\w*|carterista\w*|perdi (mi|la|el|mis)|extravi\w*|pasaporte (robado|perdido))\b/;
const INJURY = /\b(herid[oa]s?|me siento mal|sangr\w*|golpe\w*|dolor|accidente|me lastim\w*|desmay\w*|hospital|medico|ambulancia)\b/;

/** Robo o pérdida SIN heridas ni síntomas: policía y pasos, no hospital. */
export function isTheftOrLoss(message: string): boolean {
  const m = normText(message);
  return THEFT.test(m) && !INJURY.test(m);
}

export const THEFT_NOTE = "Robo o pérdida sin heridas: NO hables de hospitales. Responde en 4 viñetas cortas, en este orden: 1) ponte a salvo; 2) bloquea tus tarjetas (si <perfil_usuario>.boveda trae sus tarjetas, nómbralas: 'desde la app o el teléfono al reverso'); 3) denuncia ante el Ministerio Público o la policía más cercana (usa el resultado de search_nearby con su fuente); 4) documentos (pasaporte: SRE en México o el consulado en el extranjero; INE: módulo del INE), como información general. Termina con una línea: si quiere, una persona del equipo IATOS lo acompaña (la acción ya va en la tarjeta).";

export const EXPENSE_QUERY_NOTE = "Pregunta por sus gastos: usa SOLO get_trip_expenses de <datos_consultados> (sus gastos registrados en IATOS). Di el total por moneda (no sumes monedas distintas ni conviertas sin una tasa), cuántos gastos son y la categoría principal, en 2–3 líneas, con la fuente 'según tus gastos registrados en IATOS'. Si no hay gastos, dilo y ofrece registrar uno (add_expense). Nunca digas que no tienes acceso a sus gastos si la herramienta trajo datos. No los confundas con el costo estimado del viaje (eso es cotización, no gasto). Para verlos o editarlos está la pantalla Gastos.";

/** Nota del plan de un día concreto (itinerario guardado + clima consultado). */
export function dayPlanNote(day: string | null, tripId: string | null): string {
  const label = day ? whenLabel(day) : null;
  return [
    `Plan del día${label ? ` (${label})` : ""}: arma el día con lo que ya trae su itinerario para esa fecha en <viaje_en_contexto>; si ese día no tiene actividades, dilo en una línea y ofrece buscar opciones.`,
    "Formato para celular: una viñeta por momento ('Mañana:', '11:00:', 'Comida:', 'Tarde:', 'Noche:'), máximo 6 viñetas de una línea; no inventes horas que el itinerario no trae y no repitas 'agregado en tu itinerario' en cada viñeta.",
    "Clima: solo si get_weather trajo ese día, en UNA línea al final con su fuente y hora de consulta; si no se consultó, no hables del clima ni del pronóstico.",
    tripId && day ? `Ofrece la acción export_calendar {trip_id: "${tripId}", fecha: "${day}"} para llevar el día a su calendario.` : "",
  ].filter(Boolean).join(" ");
}

/** Texto del paso en vivo para un turno sin consultas previas (nunca afirma un resultado). */
export function thinkingText(intents: Intent[], trip: { destino?: unknown } | null, message = ""): string {
  const has = (x: Intent) => intents.includes(x);
  const dest = String(trip?.destino ?? "").split(/→|->|,|;/)[0]?.trim();
  if (has("day_plan") && dest) return `Revisando tu itinerario de ${clip(dest, 30)}…`;
  const aboutTrip = /\b(mi viaje|viaje a|itinerario|me falta|nos falta|reservad\w*|hotel)\b/.test(normText(message));
  if ((has("trip_overview") || has("packing") || has("plan") || aboutTrip) && dest) return `Revisando tu viaje a ${clip(dest, 30)}…`;
  if (has("expense")) return "Preparando el gasto para que lo confirmes…";
  if (has("book_table")) return "Revisando tus solicitudes y reservas…";
  if (has("itinerary_add")) return "Preparando el cambio para que lo confirmes…";
  return "Preparando tu respuesta…";
}
