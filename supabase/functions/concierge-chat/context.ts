// Contexto del viaje para el concierge: datos relevantes a la petición, faltantes (gaps) y el
// guardarraíl de transfers aeropuerto → hotel. Lógica pura (sin Deno), probada en Vitest.
import {
  deriveTripBookingState, isConfirmedBooking, itemBookingState, type ItemKind,
} from "../_shared/bookingState.ts";

export const normText = (value: unknown) => String(value ?? "")
  .toLowerCase()
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .trim();

export const asArray = (value: unknown): any[] => Array.isArray(value) ? value : [];

export const compactItem = (item: any) => Object.fromEntries(
  Object.entries(item ?? {}).filter(([, value]) => value !== null && value !== undefined && value !== ""),
);

export function extractTripCities(trip: any): string[] {
  const cities = new Set<string>();
  const push = (v: unknown) => { const s = String(v ?? "").trim(); if (s) cities.add(s); };
  String(trip?.destino ?? "").split(/→|,|;/).forEach(push);
  asArray(trip?.hospedaje_json).forEach((h) => push(h?.ciudad));
  asArray(trip?.vuelos_json).forEach((f) => { push(f?.to); push(f?.ciudad); push(f?.from); });
  asArray(trip?.itinerario_json?.destinations).forEach(push);
  return [...cities];
}


// ═══ Reservado vs. cotizado ═══
// trips.status vale "listo" tanto para una cotización como para un viaje pagado. Iato recibe el
// estado DERIVADO de bookings, por elemento, para no llamar "tu vuelo" a una opción cotizada.
export const BOOKING_STATE_RULE =
  "estado_reserva por elemento: 'reservado' = hay una reserva confirmada (puedes decir 'tu vuelo', 'tu hotel'); " +
  "'cotizado' = opción que cotizó IATOS y NO está reservada (di 'la opción de vuelo cotizada' o 'el hotel sugerido', nunca 'tu vuelo' ni 'tu reserva'); " +
  "'segun_tu_archivo' = viene del archivo del usuario, sin verificar (di 'según tu archivo'). Un clic a un socio no es una reserva.";

const tagItems = (kind: ItemKind, items: unknown, confirmed: any[]) => {
  const list = asArray(items);
  if (!list.length) return items ?? null;
  return list.map((it) => ({ ...it, estado_reserva: itemBookingState(kind, it, list, confirmed) }));
};

/** Campos de reservas para <viaje_en_contexto>: elementos etiquetados y solo reservas confirmadas. */
export function tripBookingContext(trip: any, bookings: any[]) {
  const all = asArray(bookings);
  const confirmed = all.filter(isConfirmedBooking);
  const summary = deriveTripBookingState(trip, all);
  return {
    estado_reservas: { estado: summary.estado, por_tipo: summary.por_tipo, regla: BOOKING_STATE_RULE },
    vuelos: tagItems("vuelo", trip?.vuelos_json, confirmed),
    hospedaje: tagItems("hospedaje", trip?.hospedaje_json, confirmed),
    tours: tagItems("tour", trip?.tours_json, confirmed),
    cruceros: tagItems("crucero", trip?.cruceros_json, confirmed),
    reservas_confirmadas_bookings: confirmed,
    clics_a_socios_sin_confirmar: summary.clics_sin_confirmar,
  };
}

/** Estado corto para la lista de viajes vigentes ("Reservado", "Cotizado · sin reservar"…). */
export function tripListBookingState(trip: any, bookings: any[]) {
  return deriveTripBookingState(trip, asArray(bookings).filter((b) => b?.trip_id === trip?.id)).label;
}

export function buildRequestIntelligence(trip: any, userMsg: string, bookings: any[]) {
  if (!trip) return null;
  const msg = normText(userMsg);
  const vuelos = asArray(trip.vuelos_json);
  const hospedajes = asArray(trip.hospedaje_json);
  const transfers = asArray(trip.itinerario_json?.transfers);
  const pendientes = asArray(trip.itinerario_json?.pendientes);
  const cities = extractTripCities(trip);
  const city = cities.find((c) => c.length > 2 && msg.includes(normText(c))) ?? cities[0] ?? trip.destino;
  const cityNorm = normText(city);
  const relevantFlights = vuelos
    .filter((f) => normText([f?.to, f?.ciudad, f?.from, f?.numero_vuelo, f?.aerolinea].join(" ")).includes(cityNorm))
    .map(compactItem)
    .slice(0, 4);
  const relevantHotels = hospedajes
    .filter((h) => normText([h?.ciudad, h?.nombre, h?.direccion, h?.barrio].join(" ")).includes(cityNorm))
    .map(compactItem)
    .slice(0, 4);
  const relevantTransfers = transfers
    .filter((t) => normText([t?.from, t?.to, t?.proveedor, t?.fecha, t?.hora].join(" ")).includes(cityNorm))
    .map(compactItem)
    .slice(0, 4);
  const relevantPending = pendientes
    .filter((p) => normText(p).includes(cityNorm) || /transfer|transporte|taxi|aeropuerto|airport|hotel|uber/.test(normText(p)))
    .slice(0, 8);
  const relevantBookings = bookings
    .filter((b) => normText([b?.city, b?.title, b?.subtitle, b?.category, b?.provider].join(" ")).includes(cityNorm))
    .map(compactItem)
    .slice(0, 6);
  const transferIntent = /transfer|transporte|traslado|taxi|chofer|driver|uber|blacklane|aeropuerto/.test(msg)
    && /hotel|aeropuerto|airport|barajas|terminal|llegad/.test(msg);
  return {
    tipo_peticion_detectada: transferIntent ? "transfer_aeropuerto_hotel" : "general_viaje",
    ciudad_detectada: city,
    vuelos_relevantes: relevantFlights,
    hospedaje_relevante: relevantHotels,
    transfers_confirmados_o_itinerario: relevantTransfers,
    pendientes_relacionados: relevantPending,
    bookings_relacionados: relevantBookings,
    instruccion_operativa: "Usa estos datos primero. No pidas hotel, fechas, vuelo ni destino si aparecen aquí; solo pregunta preferencias no guardadas.",
  };
}

// ═══ CAPA 4 — DETECCIÓN PROACTIVA DE GAPS ═══
// Detección determinista (no depende del criterio del modelo) de lo que le falta al viaje.
export const VISA_REQUIRED_HINTS = [
  "estados unidos", "eeuu", "usa", "united states", "canada", "canadá", "reino unido", "united kingdom",
  "australia", "nueva zelanda", "japon", "japón", "china", "india", "rusia", "emiratos", "vietnam",
];

export function daysUntil(dateISO: string | null | undefined, todayISO: string): number | null {
  if (!dateISO) return null;
  const d = Date.parse(`${dateISO}T00:00:00Z`);
  const t = Date.parse(`${todayISO}T00:00:00Z`);
  if (!Number.isFinite(d) || !Number.isFinite(t)) return null;
  return Math.round((d - t) / 86400000);
}

export function computeTripGaps(trip: any, bookings: any[], todayISO: string) {
  if (!trip) return [] as { id: string; severidad: string; titulo: string; detalle: string; sugerencia: string }[];
  const gaps: { id: string; severidad: string; titulo: string; detalle: string; sugerencia: string }[] = [];
  const vuelos = asArray(trip.vuelos_json);
  const hospedaje = asArray(trip.hospedaje_json);
  const bks = Array.isArray(bookings) ? bookings : [];
  const catText = normText(bks.map((b) => `${b?.category ?? ""} ${b?.title ?? ""} ${b?.subtitle ?? ""}`).join(" "));
  const dias = daysUntil(trip.fecha_salida, todayISO);
  const destinoNorm = normText(`${trip.destino ?? ""} ${trip.pais_destino ?? ""}`);
  const inTrip = trip.fecha_salida <= todayISO && (trip.fecha_regreso ?? "") >= todayISO;

  // 1. Vuelo de regreso
  const tieneRegreso = vuelos.length > 1
    || vuelos.some((v: any) => /regreso|return|vuelta|inbound/.test(normText(JSON.stringify(v ?? {}))))
    || /vuelo|flight/.test(catText);
  if (trip.fecha_regreso && vuelos.length > 0 && !tieneRegreso) {
    gaps.push({
      id: "vuelo_regreso",
      severidad: "alta",
      titulo: "Falta el vuelo de regreso",
      detalle: `El viaje termina el ${trip.fecha_regreso} pero solo veo vuelo de ida en el itinerario.`,
      sugerencia: "Ofrece buscar el vuelo de regreso con la tool search_flights usando la fecha de regreso del viaje.",
    });
  }

  // 2. Hospedaje
  if (vuelos.length > 0 && hospedaje.length === 0 && !/hotel|alojamiento|hospedaje|stay/.test(catText)) {
    gaps.push({
      id: "hospedaje",
      severidad: "alta",
      titulo: "Sin hospedaje reservado",
      detalle: `No hay hotel registrado para ${trip.destino ?? "el destino"}.`,
      sugerencia: "Ofrece buscar hoteles con search_hotels usando las fechas exactas del viaje.",
    });
  }

  // 3. Seguro de viaje
  if (!/seguro|insurance|assist/.test(catText)) {
    gaps.push({
      id: "seguro",
      severidad: dias !== null && dias <= 14 ? "alta" : "media",
      titulo: "Sin seguro de viaje",
      detalle: "No detecto seguro de viaje contratado para este viaje.",
      sugerencia: "Recomienda contratar seguro y dirígelo a la sección Seguros de IATOS (/dashboard/insurance).",
    });
  }

  // 4. Visa / documentación
  if (VISA_REQUIRED_HINTS.some((h) => destinoNorm.includes(h))) {
    gaps.push({
      id: "visa",
      severidad: dias !== null && dias <= 45 ? "alta" : "media",
      titulo: "Verificar visa / autorización de viaje",
      detalle: `${trip.pais_destino ?? trip.destino} suele requerir visa o autorización electrónica (ESTA/eTA/ETIAS) para pasaporte mexicano.`,
      sugerencia: "Pregunta si ya tiene visa vigente y explica el trámite y tiempos si no.",
    });
  }

  // 5. Transfer aeropuerto → hotel
  if (vuelos.length > 0 && hospedaje.length > 0 && !/transfer|traslado|transporte|pickup/.test(catText)
      && !asArray(trip.itinerario_json?.transfers).length) {
    gaps.push({
      id: "transfer",
      severidad: "media",
      titulo: "Sin transfer aeropuerto → hotel",
      detalle: "Hay vuelo y hotel pero ningún traslado registrado.",
      sugerencia: "Ofrece transfer privado con Welcome Pickups usando vuelo, fecha y dirección del hotel ya conocidos.",
    });
  }

  // 6. eSIM / conectividad
  if (!/esim|sim|roaming|datos/.test(catText) && dias !== null && dias <= 21) {
    gaps.push({
      id: "esim",
      severidad: "baja",
      titulo: "Sin plan de datos internacional",
      detalle: "El viaje es pronto y no veo eSIM ni plan de roaming.",
      sugerencia: "Sugiere una eSIM (sección /dashboard/esim) para llegar conectado.",
    });
  }

  // 7. Check-in de vuelo inminente
  if (dias !== null && dias >= 0 && dias <= 2 && vuelos.length > 0) {
    gaps.push({
      id: "checkin",
      severidad: "alta",
      titulo: "Check-in de vuelo",
      detalle: `Sales en ${dias === 0 ? "hoy" : `${dias} día(s)`}. El check-in en línea suele abrir 24-48h antes.`,
      sugerencia: "Recuérdale hacer check-in y confirmar terminal y hora de llegada al aeropuerto.",
    });
  }

  // 8. Sin actividades planeadas durante el viaje
  if (inTrip && asArray(trip.tours_json).length === 0 && asArray(trip.restaurantes_json).length === 0) {
    gaps.push({
      id: "actividades",
      severidad: "baja",
      titulo: "Sin actividades ni restaurantes",
      detalle: "Estás en destino sin plan de tours ni reservas gastronómicas.",
      sugerencia: "Propón 2-3 experiencias y un restaurante alineados a su perfil, usando tools reales.",
    });
  }

  return gaps;
}

export function asksForKnownTripData(text: string) {
  return /necesito|dime|dame|proporciona|cu[aá]l es|nombre de tu hotel|fecha|hotel en|a qu[eé] hora|te gustar[ií]a que te busque|quieres que busque|puedo ayudarte a encontrar/.test(normText(text));
}

export function shouldForceTransferAnswer(intel: any, parsed: any) {
  if (intel?.tipo_peticion_detectada !== "transfer_aeropuerto_hotel") return false;
  const cards = Array.isArray(parsed?.cards) ? parsed.cards : [];
  return cards.length === 0 || asksForKnownTripData(parsed?.text ?? "");
}

export function transferKnownDataLine(intel: any) {
  if (intel?.tipo_peticion_detectada !== "transfer_aeropuerto_hotel") return "";
  const flight = intel.vuelos_relevantes?.[0];
  const hotel = intel.hospedaje_relevante?.[0];
  const flightLine = flight
    ? `${flight.aerolinea ?? "vuelo"} ${flight.numero_vuelo ?? ""}`.trim() + `${flight.fecha ? ` (${flight.fecha})` : ""}`
    : "tu vuelo de llegada";
  const hotelLine = hotel
    ? `${hotel.nombre ?? "tu hotel"}${hotel.direccion ? `, ${hotel.direccion}` : ""}`
    : `tu hotel en ${intel.ciudad_detectada}`;
  return `Ya leí tu viaje: para ${intel.ciudad_detectada} tengo ${flightLine} y hospedaje en ${hotelLine}.`;
}

export function ensureTransferUsesKnownData(intel: any, parsed: any) {
  if (intel?.tipo_peticion_detectada !== "transfer_aeropuerto_hotel") return parsed;
  const fallback = shouldForceTransferAnswer(intel, parsed) ? buildTransferFallback(intel) : null;
  if (fallback) return fallback;
  const knownLine = transferKnownDataLine(intel);
  const text = String(parsed?.text ?? "");
  const hotelName = normText(intel.hospedaje_relevante?.[0]?.nombre);
  const flightNo = normText(intel.vuelos_relevantes?.[0]?.numero_vuelo);
  const alreadyUsesTrip = (!hotelName || normText(text).includes(hotelName)) && (!flightNo || normText(text).includes(flightNo));
  return alreadyUsesTrip ? parsed : { ...parsed, text: `${knownLine} ${text}`.trim() };
}

export function buildTransferFallback(intel: any) {
  if (!intel || intel.tipo_peticion_detectada !== "transfer_aeropuerto_hotel") return null;
  const flight = intel.vuelos_relevantes?.[0];
  const hotel = intel.hospedaje_relevante?.[0];
  if (!flight && !hotel) return null;
  const pendingText = intel.pendientes_relacionados?.join(" | ") ?? "";
  const airport = flight?.aeropuerto_destino || flight?.to || flight?.terminal_destino || flight?.ciudad || `aeropuerto de llegada en ${intel.ciudad_detectada}`;
  const flightLine = flight
    ? `${flight.aerolinea ?? "vuelo"} ${flight.numero_vuelo ?? ""}`.trim() + `${flight.fecha ? ` · ${flight.fecha}` : ""}${flight.hora_llegada ? ` · llegada ${flight.hora_llegada}` : ""}`
    : `llegada a ${intel.ciudad_detectada}`;
  const hotelLine = hotel
    ? `${hotel.nombre ?? "tu hotel"}${hotel.direccion ? `, ${hotel.direccion}` : ""}${hotel.check_in ? ` · check-in ${hotel.check_in}` : ""}`
    : `hotel en ${intel.ciudad_detectada}`;
  const query = encodeURIComponent(`${airport} ${hotel?.nombre ?? "hotel"} ${hotel?.direccion ?? ""} transfer privado`);
  const wpParams = new URLSearchParams({
    aff_track_id: "3dc38e66900549469a7f18b5e-733063",
    utm_source: "travelpayouts",
    utm_medium: "iatos_concierge",
    utm_campaign: `transfer_${String(intel.ciudad_detectada ?? "general").toLowerCase().replace(/\s+/g, "_")}`,
  });
  if (airport) wpParams.set("pickup_location", airport);
  if (hotel?.nombre) wpParams.set("dropoff_location", `${hotel.nombre}${hotel.direccion ? ", " + hotel.direccion : ""}`);
  if (flight?.fecha) wpParams.set("pickup_date", flight.fecha);
  if (flight?.hora_llegada) wpParams.set("pickup_time", flight.hora_llegada);
  if (flight?.numero_vuelo) wpParams.set("flight_number", flight.numero_vuelo);
  const wpUrl = `https://www.welcomepickups.com/?${wpParams.toString()}`;
  return {
    text: `Ya tengo los datos del viaje: llegas a ${intel.ciudad_detectada} en ${flightLine} y tu hospedaje es ${hotelLine}. Además, en tu itinerario aparece pendiente el traslado aeropuerto → hotel; te dejo opciones premium para activarlo sin pedirte datos repetidos.`,
    cards: [
      { type: "transport", title: "Transfer privado premium", subtitle: `${airport} → ${hotel?.nombre ?? "hotel"}`, cta_label: "Reservar transfer", cta_action: wpUrl, meta: pendingText || "Pendiente detectado en tu itinerario" },
      { type: "transport", title: "Chofer ejecutivo", subtitle: `${airport} → ${hotel?.direccion ?? hotel?.nombre ?? intel.ciudad_detectada}`, cta_label: "Buscar Blacklane", cta_action: `https://www.google.com/search?q=${query}+Blacklane`, meta: flightLine },
      { type: "transport", title: "Taxi oficial / VTC", subtitle: `${airport} → ${hotel?.nombre ?? "hotel"}`, cta_label: "Abrir Maps", cta_action: `https://www.google.com/maps/search/?api=1&query=${query}`, meta: "Ruta con origen y destino del viaje" },
    ],
  };
}
