// Botones rápidos del Concierge armados con el viaje activo (Concierge 2.0). Antes cada botón mandaba
// un texto fijo ("Dame opciones reales (Luggage Forward, AirPortr, LugLess) con precio y link directo")
// que prometía cosas sin proveedor y no usaba el viaje. Ahora cada botón manda una petición concreta
// (con el vuelo o el hotel del viaje) y su intención, que el servidor usa para consultar lo necesario
// antes de llamar al modelo.

import { pickFlight, pickHotel, tripFlights, tripHotels } from "../../supabase/functions/concierge-chat/planner";
import { tripLabel } from "@/lib/activeTrip";
import { isAirLeg } from "../../supabase/functions/concierge-chat/context";

export type ChipIcon = "dining" | "transport" | "emergency" | "flight" | "luggage" | "trip" | "plan" | "weather" | "expenses";

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

  // Ronda 4 (N4-P2-7): "¿Mi vuelo va a tiempo?" solo si el viaje tiene un trayecto en avión (salía también en un
  // viaje por autobús y sin viaje, y gastaba una búsqueda para nada).
  const hasAirLeg = !!trip && Array.isArray(trip.vuelos_json) && (trip.vuelos_json as unknown[]).some((v) => v && typeof v === "object" && isAirLeg(v));
  if (hasAirLeg) chips.push(soon
    ? { id: "flight", icon: "flight", label: `¿${soon.code} va a tiempo?`, intent: "flight_status",
      text: `¿Mi vuelo ${soon.code} de ${soon.date === todayISO ? "hoy" : "mañana"} va a tiempo? Dame estado, terminal, puerta y a qué hora salir al aeropuerto.` }
    : { id: "flight", icon: "flight", label: "¿Mi vuelo va a tiempo?", intent: "flight_status",
      text: flight?.code ? `¿Mi vuelo ${flight.code} va a tiempo? Dame estado, terminal y puerta.` : "¿Mi vuelo va a tiempo? Dame estado, terminal y puerta." });

  // Ola 9.5 (29-oct-2026): los atajos de lo que más se pregunta con un viaje cerca: el plan del día, el
  // clima (MET Norway, hasta 9 días) y cuánto llevas gastado. Cada uno manda una pregunta concreta.
  const dest = trip?.destino ? String(trip.destino).split(/→|,/)[0].trim() : "";
  const start = String(trip?.fecha_salida ?? "").slice(0, 10);
  const end = String(trip?.fecha_regreso ?? trip?.fecha_salida ?? "").slice(0, 10);
  const inTrip = !!dest && !!start && start <= todayISO && todayISO <= end;
  const soonTrip = !!dest && !!start && start > todayISO && start <= addDays(todayISO, 9);
  if (inTrip) {
    chips.push({ id: "day_plan", icon: "plan", label: "Mi plan de hoy", intent: "day_plan", text: `¿Qué tengo hoy en mi itinerario de ${dest}? Dame el plan del día en corto.` });
  } else if (soonTrip) {
    chips.push({ id: "day_plan", icon: "plan", label: `Plan del ${dayName(start)}`, intent: "day_plan", text: `Ármame el plan del ${dayName(start)} ${Number(start.slice(8, 10))} en ${dest}.` });
  }
  if (inTrip || soonTrip) {
    chips.push({ id: "weather", icon: "weather", label: "¿Qué clima hará?", intent: "weather", text: `¿Qué clima hará en mi viaje a ${dest}?` });
  }
  if (dest && (inTrip || soonTrip || (end && end < todayISO && end >= addDays(todayISO, -30)))) {
    chips.push({ id: "expenses", icon: "expenses", label: "¿Cuánto llevo gastado?", intent: "expense_query", text: `¿Cuánto llevo gastado en mi viaje a ${dest}?` });
  }

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

const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const dayName = (iso: string) => DIAS[new Date(`${iso}T12:00:00Z`).getUTCDay()] ?? "día";

/**
 * Saludo honesto con el viaje activo (antes: "listo para anticiparme a cualquier capricho"). Ola 9.5: más
 * corto (eran 4 renglones en el celular) y sin "revisar tu vuelo" en un viaje por tierra.
 */
export function welcomeText(trip: ChipTrip | null): string {
  const base = "Nada se reserva ni se guarda sin que lo confirmes.";
  if (!trip?.destino) return `Hola, soy Iato. Pregúntame dónde comer, cómo llegar, el clima o lo que necesites de tu próximo viaje. ${base}`;
  return `Hola, soy Iato. Tengo a la mano tu viaje a ${tripLabel(trip as any)}: pregúntame lo que necesites. ${base}`;
}
