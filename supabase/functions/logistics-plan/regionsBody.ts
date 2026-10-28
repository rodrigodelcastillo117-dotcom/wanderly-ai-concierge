// logistics-plan: aplica _shared/regions.ts al cuerpo de la petición (sin Deno, probado en Vitest).
// Cambia en su lugar destinations, nights_per_city (si venía una por destino) y prefs.leg_modes
// (modo "mixto") para que todo lo que sigue use la lista con las bases reales.
// Primero la tabla curada; lo que no conoce (país, región fuera de la tabla, carretera) pasa por
// `resolve` (_shared/placeResolve.ts: Google Geocoding + Wikidata). Sin resolver o si falla, intacto.
import { expandLegModes, expandRegions, placeLookup, type RegionExpansion } from "../_shared/regions.ts";
import { needsResolve, type PlaceCandidate, type PlaceResolution } from "../_shared/placeResolve.ts";

type RegionBody = {
  destinations: string[];
  nights_per_city?: number[];
  region_bases?: Record<string, unknown>;
  prefs?: { leg_modes?: unknown; [k: string]: unknown };
  /** Tramos por mar (seaLegs.ts) por índice de tramo: se remapean a la lista expandida. */
  sea_legs?: unknown;
};

/** Índice del tramo que sale del destino original i, en la lista expandida (sale de la última base de i). */
export function remapLegIndex(oldIndex: number, sourceIndex: number[]): number {
  let at = -1;
  sourceIndex.forEach((src, k) => { if (src === oldIndex) at = k; });
  return at;
}

export type PlaceResolver = (destinations: string[]) => Promise<PlaceResolution[]>;

export type RegionsApplied = {
  expansions: RegionExpansion[];
  /** Hay una carretera en la ruta (con o sin paradas): el viaje es en coche. */
  roadtrip: boolean;
  /** Destinos ambiguos o sin resultado: quedan como los escribió la persona, con sus candidatos reales. */
  clarifications: Array<{ input: string; candidates: PlaceCandidate[]; message?: string }>;
};

export async function applyRegionsToBody(body: RegionBody, resolve?: PlaceResolver | null): Promise<RegionsApplied> {
  const pending = [...new Set((Array.isArray(body.destinations) ? body.destinations : []).map((d) => String(d ?? "")).filter(needsResolve))];
  let places: PlaceResolution[] = [];
  if (resolve && pending.length) {
    try {
      places = await resolve(pending);
    } catch (e) {
      console.warn("placeResolve:", e instanceof Error ? e.message : e);
      places = [];
    }
  }
  const roadtrip = places.some((p) => p.status === "ok" && p.kind === "route");
  const clarifications = places.filter((p) => p.status === "needs_clarification")
    .map((p) => ({ input: p.input, candidates: p.candidates ?? [], ...(p.message ? { message: p.message } : {}) }));
  const r = expandRegions(body.destinations, body.nights_per_city, body.region_bases ?? null, placeLookup(places));
  if (!r.expansions.length) return { expansions: [], roadtrip, clarifications };
  body.destinations = r.destinations;
  if (Array.isArray(r.nightsPerCity)) body.nights_per_city = r.nightsPerCity;
  if (body.prefs && Array.isArray(body.prefs.leg_modes)) {
    body.prefs = { ...body.prefs, leg_modes: expandLegModes(body.prefs.leg_modes, r.sourceIndex) };
  }
  if (Array.isArray(body.sea_legs)) {
    body.sea_legs = (body.sea_legs as Array<Record<string, unknown>>).map((l) => ({ ...l, index: remapLegIndex(Number(l?.index), r.sourceIndex) }));
  }
  return { expansions: r.expansions, roadtrip, clarifications };
}
