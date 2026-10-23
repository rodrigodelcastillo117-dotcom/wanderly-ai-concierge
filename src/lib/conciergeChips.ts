// Botones rápidos del Concierge armados con el viaje activo (Concierge 2.0). Antes cada botón mandaba
// un texto fijo ("Dame opciones reales (Luggage Forward, AirPortr, LugLess) con precio y link directo")
// que prometía cosas sin proveedor y no usaba el viaje. Ahora cada botón manda una petición concreta
// (con el vuelo o el hotel del viaje) y su intención, que el servidor usa para consultar lo necesario
// antes de llamar al modelo.

import { pickFlight, pickHotel, tripFlights, tripHotels } from "../../supabase/functions/concierge-chat/planner";
import { tripLabel } from "@/lib/activeTrip";

export type ChipIcon = "dining" | "transport" | "emergency" | "flight" | "luggage" | "trip";

export interface Chip {
  id: string;
  label: string;
  icon: ChipIcon;
  /** Texto que se manda como mensaje del usuario. */
  text?: string;
  /** Intención para el servidor (planner.CHIP_INTENTS). */
  intent?: string;
  /** Abre una pantalla de la app en lugar de mandar un mensaje. */
  opens?: "emergency";
}

export interface ChipTrip {
  id: string;
  destino?: string | null;
  fecha_salida?: string | null;
  fecha_regreso?: string | null;
  vuelos_json?: unknown;
  hospedaje_json?: unknown;
}

const addDays = (d: string, k: number) => new Date(Date.parse(`${d}T00:00:00Z`) + k * 86400000).toISOString().slice(0, 10);

/**
 * `away`: el usuario está fuera de los destinos del viaje (location.ts), p. ej. en su ciudad el día que
 * sale. Entonces "Cena cerca" y "Pedir transporte" son cerca de donde está, no del hotel del viaje.
 */
export function buildChips(trip: ChipTrip | null, todayISO: string, opts: { away?: boolean } = {}): Chip[] {
  const flights = trip ? tripFlights(trip) : [];
  const flight = pickFlight(flights, "", todayISO);
  const soon = flight?.date && (flight.date === todayISO || flight.date === addDays(todayISO, 1)) ? flight : null;
  const hotel = trip && !opts.away ? pickHotel(tripHotels(trip), todayISO) : null;
  const chips: Chip[] = [];

  chips.push(soon
    ? { id: "flight", icon: "flight", label: `¿${soon.code} va a tiempo?`, intent: "flight_status",
      text: `¿Mi vuelo ${soon.code} de ${soon.date === todayISO ? "hoy" : "mañana"} va a tiempo? Dame estado, terminal, puerta y a qué hora salir al aeropuerto.` }
    : { id: "flight", icon: "flight", label: "¿Mi vuelo va a tiempo?", intent: "flight_status",
      text: flight?.code ? `¿Mi vuelo ${flight.code} va a tiempo? Dame estado, terminal y puerta.` : "¿Mi vuelo va a tiempo? Dame estado, terminal y puerta." });

  chips.push(hotel
    ? { id: "dining", icon: "dining", label: "Cena cerca", intent: "dining_near_hotel", text: `¿Dónde ceno hoy cerca de mi hotel ${hotel.name}? Dame 3 opciones abiertas con cómo llegar.` }
    : { id: "dining", icon: "dining", label: "Cena cerca", intent: "dining_near_hotel", text: "¿Dónde ceno hoy cerca de donde estoy? Dame 3 opciones abiertas con cómo llegar." });

  chips.push({
    id: "transport", icon: "transport", label: "Pedir transporte", intent: "transport",
    text: hotel ? `Necesito transporte ahora a mi hotel ${hotel.name}: dame la forma más rápida.` : "Necesito transporte ahora: ¿cuál es la forma más rápida de moverme desde donde estoy?",
  });
  chips.push({ id: "emergency", icon: "emergency", label: "Emergencia local", opens: "emergency" });
  chips.push({
    id: "luggage", icon: "luggage", label: "Equipaje Invisible", intent: "luggage",
    text: "Quiero enviar mi equipaje sin cargarlo (Equipaje Invisible). Pide una cotización a un humano con los datos de mi viaje.",
  });
  if (trip?.destino) {
    chips.push({ id: "trip", icon: "trip", label: `Mi viaje a ${String(trip.destino).split(/→|,/)[0].trim()}`, intent: "trip_overview",
      text: `Ayúdame con mi viaje a ${trip.destino}: qué tengo, qué me falta y cuál es el siguiente paso.` });
  }
  return chips;
}

/** Saludo honesto con el viaje activo (antes: "listo para anticiparme a cualquier capricho"). */
export function welcomeText(trip: ChipTrip | null): string {
  const base = "Puedo revisar tu vuelo, buscar dónde comer o cómo llegar, agregar cosas a tu itinerario, registrar gastos o pedirle algo al Fixer. Nada se reserva ni se guarda sin que lo confirmes.";
  if (!trip?.destino) return `Hola, soy Iato. ${base}`;
  return `Hola, soy Iato. Tengo a la mano tu viaje a ${tripLabel(trip as any)}. ${base}`;
}
