// Road trip dentro del plan de varios destinos (grupo roadtrip). Sin Deno.serve: se prueba con Vitest
// inyectando la consulta a Google Routes.
//
// Por tramo en coche: Google Routes (computeRoutes sin tráfico, con extraComputations TOLLS) da
// distancia, tiempo y casetas reales (CONSULTADO); si no responde, la estimación por línea recta
// (ESTIMADO, sin casetas). Con eso se
// arman combustible, viñetas, avisos por país y la renta (recogida/devolución) en
// _shared/roadtrip/plan.ts. El modelo recibe las cifras para que el itinerario no invente km.
import { buildRoadTripPlan, type LegMode, type LiveLeg, placeQuery, resolveLegModes, type RoadTripPlan } from "../_shared/roadtrip/plan.ts";
import { driveWithTolls, type RateFn, TOLLS_SKU } from "../_shared/google-tolls.ts";
import { GOOGLE_SKU_PRICING, type GoogleTransport, googleListPriceUsd } from "../_shared/google-maps.ts";
import type { CacheStore } from "../_shared/serpCache.ts";
import { getRateToMxnInfo } from "../_shared/fx.ts";

export const MAX_ROUTE_CALLS = 12;

export type RouteFn = (origin: string, destination: string) => Promise<LiveLeg>;

/** Costo de lista de cada tramo con casetas (SKU prudente de google-tolls.ts). */
export const TOLLS_API_SKU = { sku: TOLLS_SKU, usdPerCall: googleListPriceUsd(TOLLS_SKU), freePerMonth: GOOGLE_SKU_PRICING[TOLLS_SKU]?.free ?? 0 };

/**
 * Tramo en coche con distancia, tiempo y casetas reales de Google en una sola llamada, con la caché
 * de 24 h (serp_cache) por origen, destino y pase. Solo corre al generar el viaje.
 */
export function tollRouteFn(google: GoogleTransport, store: CacheStore | null, o: { pase?: string | null; rate?: RateFn } = {}): RouteFn {
  return async (origin, destination) => {
    const r = await driveWithTolls(google, { origin: { address: origin }, destination: { address: destination }, pase: o.pase ?? null }, { store, rate: o.rate ?? getRateToMxnInfo });
    if (!r.ok) return null;
    const ok = r as Extract<typeof r, { ok: true }>;
    return { ok: true, distance_meters: ok.distance_meters, duration_seconds: ok.duration_seconds, consultado_at: ok.consultado_at, tolls: ok.tolls };
  };
}

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
  /** SKU de las llamadas (con casetas: TOLLS_SKU de _shared/google-tolls.ts). */
  apiSku?: { sku: string; usdPerCall: number; freePerMonth: number };
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
  // Un tramo servido de la caché de 24 h (casetas) no se cobró.
  const billed = calls - live.filter((l) => l?.tolls?.from_cache).length;
  return buildRoadTripPlan({ stops: a.destinations, legModes: a.legModes, legDates: a.legDates, live, apiCalls: billed, apiSku: a.apiSku, now: a.now });
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
