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

export type Intent =
  | "human" | "emergency" | "flight_disruption" | "missed_connection" | "flight_status" | "flight_compare"
  | "hotel_change" | "dining_near_hotel" | "dining" | "transport" | "prive_night" | "trip_overview"
  | "place_fact" | "expense" | "packing" | "price_alert" | "create_trip" | "itinerary_add" | "luggage" | "members_followup" | "plan";

export const CHIP_INTENTS: readonly Intent[] = [
  "dining_near_hotel", "transport", "emergency", "flight_status", "luggage", "members_followup", "trip_overview",
];

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
  ["packing", /\b(empacar|maleta|que llevo|packing|que (debo|tengo que) llevar)\b/],
  ["price_alert", /\b(alerta|avisame|vigila)\b.{0,30}\b(precio|baje|tarifa)\b/],
  ["create_trip", /\b(quiero|planear|planeo|nuevo|crear|crea|armar|organizar)\b.{0,25}\bviaje a\b/],
  ["itinerary_add", /\b(agrega|anade|pon|mete|apunta)\b.{0,40}\b(itinerario|agenda|plan del dia|calendario)\b/],
  ["luggage", /\b(equipaje invisible|enviar (mi )?(equipaje|maleta)|luggage forward|airportr|lugless)\b/],
];

/** Intenciones del mensaje. Un botón rápido manda la suya y manda sobre el texto. */
export function detectIntents(message: string, chipIntent?: unknown): Intent[] {
  const m = normText(message);
  const out = new Set<Intent>();
  if (typeof chipIntent === "string" && (CHIP_INTENTS as readonly string[]).includes(chipIntent)) out.add(chipIntent as Intent);
  for (const [intent, re] of RULES) if (re.test(m)) out.add(intent);
  // "cenar cerca de mi hotel" ya es dining_near_hotel.
  if (out.has("dining_near_hotel")) out.delete("dining");
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
}

export interface PlanInput {
  message: string;
  intents: Intent[];
  trip: any | null;
  todayISO: string;
  coords: { lat: number; lng: number } | null;
  hasPriveSession: boolean;
  exigente: boolean;
}

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

  if (has("human")) {
    plan.direct = { text: "Por supuesto. Te conecto con tu Fixer: toca **Contactar Fixer** arriba y cuéntale qué necesitas. Es atención humana sujeta a disponibilidad." };
    return plan;
  }

  // Vuelo hoy/mañana del viaje: siempre se ofrece, aunque la pregunta sea otra.
  const flightSoon = flight && flight.date && (flight.date === i.todayISO || flight.date === addDays(i.todayISO, 1)) ? flight : null;
  if (flightSoon) {
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
  const flightIntent = has("flight_status") || has("flight_disruption") || has("missed_connection");
  if (flightSoon && flightSoon.date === i.todayISO && !flightIntent && !has("emergency")) {
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
    plan.notes.push("Prioridad: 1) estado real del vuelo, 2) alternativas con horario y precio, 3) derechos del pasajero con fuente, 4) el Fixer para negociar con la aerolínea.");
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
      if (tripId) plan.suggestedActions.push({ type: "create_price_alert", params: { trip_id: tripId } });
    } else {
      plan.notes.push("Para comparar vuelos faltan origen, destino o fecha en el viaje: pregunta solo lo que falte.");
    }
  }

  if (has("dining_near_hotel") || (has("dining") && (hotel || i.coords))) {
    if (hotel) {
      plan.notes.push(`Hotel del usuario: ${hotel.name}${hotel.address ? `, ${hotel.address}` : ""}${hotel.city ? `, ${hotel.city}` : ""}${hotel.fromPdf ? " (según su archivo)" : ""}.`);
      plan.prefetch.push({
        name: "search_places",
        args: { query: `restaurantes cerca de ${hotel.name}${hotel.city ? `, ${hotel.city}` : ""}`, ...(hotel.lat !== undefined && hotel.lng !== undefined ? { lat: hotel.lat, lng: hotel.lng } : {}) },
        reason: "restaurantes cerca del hotel",
      });
    } else if (i.coords) {
      plan.prefetch.push({ name: "search_nearby", args: { lat: i.coords.lat, lng: i.coords.lng, kind: "restaurant" }, reason: "restaurantes cerca" });
    } else {
      plan.notes.push("No hay hotel reservado ni ubicación del usuario: pregunta en qué hotel o zona está, en una línea.");
    }
    if (i.exigente && city) {
      plan.prefetch.push({ name: "search_attractions", args: { query: `mejores restaurantes en ${city}`, category: "restaurants" }, reason: "ranking de la ciudad" });
    }
    if (tripId) plan.suggestedActions.push({ type: "add_itinerary_item", params: { trip_id: tripId, fecha: i.todayISO, hora: "20:30", titulo: "Cena" } });
  }

  if (has("place_fact")) {
    const q = cleanFactQuery(i.message) || i.message.slice(0, 160);
    plan.prefetch.push({ name: "web_search", args: { query: q }, reason: "dato práctico" });
    plan.prefetch.push({ name: "search_places", args: { query: q, details: true }, reason: "ficha del lugar" });
    plan.toolHints.push("web_search", "search_places");
  }

  if (has("emergency")) {
    plan.cards.push({
      type: "alert", title: "Ayuda inmediata",
      body: "Si hay riesgo para tu vida, llama al número de emergencias local ahora. En la pantalla 'Emergencia local' tienes los números y el hospital más cercano.",
    });
    if (i.coords) plan.prefetch.push({ name: "search_nearby", args: { lat: i.coords.lat, lng: i.coords.lng, kind: "hospital" }, reason: "hospital más cercano" });
    plan.suggestedActions.unshift({ type: "open_emergency", params: {} });
    plan.suggestedActions.push({ type: "fixer_request", params: { tipo: "other", titulo: "Ayuda urgente", detalle: i.message.slice(0, 400), ...(tripId ? { trip_id: tripId } : {}) } });
  }

  if (has("transport")) {
    const dest = hotel;
    if (dest) {
      plan.notes.push(`Destino natural: su hotel ${dest.name}${dest.address ? `, ${dest.address}` : ""}.`);
      plan.cards.push(transportCard(dest));
    }
    plan.suggestedActions.push({ type: "fixer_request", params: { tipo: "transport", titulo: `Traslado privado${dest ? ` a ${dest.name}` : ""}`, detalle: i.message.slice(0, 300), ...(tripId ? { trip_id: tripId } : {}) } });
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
    plan.notes.push("El usuario ya envió una solicitud de mesa desde Members Only (no es reserva). Confírmale que quedó en manos del equipo, dale el enlace del lugar si existe y una alternativa por si no hay mesa.");
  }

  if (has("trip_overview") && tripId) {
    plan.notes.push("Panorama del viaje: di en 2–4 viñetas qué está reservado, qué falta (de <faltantes_viaje>) y el siguiente paso concreto; ofrece 1–3 acciones.");
    if (iso(trip?.fecha_salida) && String(trip.fecha_salida) > i.todayISO) plan.suggestedActions.push({ type: "create_price_alert", params: { trip_id: tripId } });
    const next = flights.find((f) => f.date && f.date >= i.todayISO);
    if (next) plan.suggestedActions.push({ type: "track_flight", params: { vuelo: next.code, fecha: next.date, trip_id: tripId } });
  }

  if (has("create_trip") && !trip) {
    plan.notes.push("No hay un viaje para ese destino: ofrece crearlo con la acción create_trip (destino y fechas si las dio).");
  }

  if (i.exigente) {
    // Modo exigente: siempre queda lista la mano humana para cerrar lo elegido (Iato no reserva).
    if (has("flight_compare")) plan.suggestedActions.push({ type: "fixer_request", params: { tipo: "other", titulo: "Que el Fixer gestione el vuelo elegido", detalle: i.message.slice(0, 300), ...(tripId ? { trip_id: tripId } : {}) } });
    if (has("dining_near_hotel") || has("dining")) plan.suggestedActions.push({ type: "fixer_request", params: { tipo: "reservation", titulo: "Reservar mesa en la opción elegida", fecha: i.todayISO, hora: "20:30", ...(tripId ? { trip_id: tripId } : {}) } });
    plan.notes.push("MODO EXIGENTE: compara a fondo y presenta 'La mejor / La alternativa / El plan B' con el porqué, la fuente y la contra de cada una; anticipa las 2 siguientes necesidades.");
  }

  plan.prefetch = dedupeSpecs(plan.prefetch).slice(0, i.exigente ? 5 : 3);
  plan.suggestedActions = plan.suggestedActions.slice(0, 3);
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
export function applyToolPolicy(name: string, args: Record<string, unknown>, userMessage: string): { name: string; args: Record<string, unknown>; rerouted?: string } {
  if (name !== "search_attractions") return { name, args };
  const m = normText(userMessage);
  const q = normText(args.query);
  const fact = RULES.find(([k]) => k === "place_fact")![1].test(m) || /\b(lounge|sala|terminal|aeropuerto|puerta|horario|telefono)\b/.test(q);
  if (fact && !DINING_OR_RANKING.test(m)) {
    return { name: "web_search", args: { query: String(args.query ?? userMessage).slice(0, 200) }, rerouted: "search_attractions→web_search" };
  }
  return { name, args };
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
    case "search_attractions": return `Buscando reseñas y rankings: ${clip(args.query)}…`;
    case "search_members_venues": return `Revisando Members Only en ${clip(args.city, 30)}…`;
    case "search_prive": return "Revisando el catálogo Privé…";
    default: return "Consultando…";
  }
}

/** Resultado del paso para el usuario: hecho, sin resultados o sin respuesta del servicio. */
export function toolOutcome(prepared: Record<string, unknown>): { state: "done" | "empty" | "error"; suffix: string } {
  if (prepared.disponible !== false) return { state: "done", suffix: "listo" };
  const estado = String(prepared.estado ?? "");
  if (estado === "sin_resultados") return { state: "empty", suffix: "sin resultados" };
  if (estado === "limite_del_plan") return { state: "error", suffix: "límite del plan" };
  if (estado === "sin_acceso") return { state: "error", suffix: "requiere PRO" };
  return { state: "error", suffix: "no respondió" };
}
