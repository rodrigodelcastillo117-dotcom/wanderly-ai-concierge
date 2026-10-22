// Road trip dentro del plan de varios destinos (grupo roadtrip). Sin Deno.serve: se prueba con Vitest
// inyectando la consulta a Google Routes.
//
// Por tramo en coche: Google Routes (computeRoutes, SKU Essentials, sin tráfico) da distancia y
// tiempo reales (CONSULTADO); si no responde, la estimación por línea recta (ESTIMADO). Con eso se
// arman combustible, viñetas, avisos por país y la renta (recogida/devolución) en
// _shared/roadtrip/plan.ts. El modelo recibe las cifras para que el itinerario no invente km.
import { buildRoadTripPlan, type LegMode, type LiveLeg, placeQuery, resolveLegModes, type RoadTripPlan } from "../_shared/roadtrip/plan.ts";

export const MAX_ROUTE_CALLS = 12;

export type RouteFn = (origin: string, destination: string) => Promise<LiveLeg>;

/**
 * Modos por tramo: lo que pidió el usuario (transport_mode / leg_modes) o, si no dijo nada y el
 * destino es de roadtrip (regex existente de logistics-plan), coche en todos los tramos. Sin elección
 * ni roadtrip: [] (el modelo decide como antes y no hay plan de coche).
 */
export function legModesFor(destinations: string[], prefs: { transport_mode?: unknown; leg_modes?: unknown } | undefined, roadtripDetected: boolean): LegMode[] {
  const mode = prefs?.transport_mode;
  if (mode === "avion" || mode === "tren" || mode === "coche" || mode === "mixto") {
    return resolveLegModes(destinations.length, mode, prefs?.leg_modes, "tren");
  }
  return roadtripDetected ? resolveLegModes(destinations.length, "coche") : [];
}

export async function planRoadTrip(a: {
  destinations: string[];
  legModes: LegMode[];
  legDates: Array<string | null>;
  route: RouteFn | null;
  now?: string;
}): Promise<RoadTripPlan | null> {
  if (!a.legModes.includes("coche")) return null;
  let calls = 0;
  const live: LiveLeg[] = await Promise.all(a.legModes.map(async (m, i) => {
    if (m !== "coche" || !a.route || calls >= MAX_ROUTE_CALLS) return null;
    calls++;
    try {
      return await a.route(placeQuery(a.destinations[i]), placeQuery(a.destinations[i + 1]));
    } catch {
      return null;
    }
  }));
  return buildRoadTripPlan({ stops: a.destinations, legModes: a.legModes, legDates: a.legDates, live, apiCalls: calls, now: a.now });
}

const MODE_LABEL: Record<LegMode, string> = { avion: "avión", tren: "tren", coche: "coche" };

/** Bloque para el prompt: modo elegido por tramo y, en coche, la distancia y el tiempo reales. */
export function roadTripPromptBlock(destinations: string[], legModes: LegMode[], plan: RoadTripPlan | null): string {
  if (!legModes.length) return "";
  const lines = legModes.map((m, i) => {
    const leg = plan?.legs.find((l) => l.index === i);
    const extra = m === "coche" && leg?.distance_km
      ? ` — ${leg.distance_km} km, ~${Math.round(((leg.duration_min ?? 0) / 60) * 10) / 10} h de manejo (${leg.estado === "CONSULTADO" ? "Google Maps, sin tráfico" : "estimado"})${leg.suggested_stops.length ? `; paradas de camino: ${leg.suggested_stops.map((s) => s.name).join(", ")}` : ""}`
      : "";
    return `- ${destinations[i]} → ${destinations[i + 1]}: ${MODE_LABEL[m]}${extra}`;
  });
  return `\n\nMODO DE TRANSPORTE ELEGIDO POR EL VIAJERO (OBLIGATORIO, respeta cada tramo):
${lines.join("\n")}
- En internal_transport usa EXACTAMENTE ese modo por tramo (mode="coche", "tren" o "vuelo_interno"). En los tramos en coche copia la distancia y el tiempo de arriba; NO inventes km ni horas.
- NO pongas precios de gasolina, casetas, viñetas ni estacionamiento: el sistema los calcula aparte con fuentes oficiales.`;
}
