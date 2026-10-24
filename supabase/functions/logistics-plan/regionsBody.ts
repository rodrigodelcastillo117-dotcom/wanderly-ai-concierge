// logistics-plan: aplica _shared/regions.ts al cuerpo de la petición (sin Deno, probado en Vitest).
// Cambia en su lugar destinations, nights_per_city (si venía una por destino) y prefs.leg_modes
// (modo "mixto") para que todo lo que sigue use la lista con las bases reales.
import { expandLegModes, expandRegions, type RegionExpansion } from "../_shared/regions.ts";

type RegionBody = {
  destinations: string[];
  nights_per_city?: number[];
  region_bases?: Record<string, unknown>;
  prefs?: { leg_modes?: unknown; [k: string]: unknown };
};

export function applyRegionsToBody(body: RegionBody): RegionExpansion[] {
  const r = expandRegions(body.destinations, body.nights_per_city, body.region_bases ?? null);
  if (!r.expansions.length) return [];
  body.destinations = r.destinations;
  if (Array.isArray(r.nightsPerCity)) body.nights_per_city = r.nightsPerCity;
  if (body.prefs && Array.isArray(body.prefs.leg_modes)) {
    body.prefs = { ...body.prefs, leg_modes: expandLegModes(body.prefs.leg_modes, r.sourceIndex) };
  }
  return r.expansions;
}
