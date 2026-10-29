// Orden de Google Places searchNearby según lo que se busca (sin dependencias de Deno: se prueba con Vitest).
// Emergencias (hospital, policía, farmacia, cajero, gasolinera, embajada): lo más CERCANO primero.
// Restaurantes y hoteles: lo más POPULAR dentro del radio. Caso E2E 28-oct-2026: con "DISTANCE",
// "restaurantes para cenar cerca de mí" en el Centro de CDMX devolvió fichas sin calificación ni
// reseñas fijadas en el punto exacto del centro de la ciudad, en lugar de los lugares conocidos a 300 m.
export type NearbyRank = "POPULARITY" | "DISTANCE";

const BY_POPULARITY = new Set(["restaurant", "lodging"]);

export function nearbyRankPreference(kind: string): NearbyRank {
  return BY_POPULARITY.has(String(kind)) ? "POPULARITY" : "DISTANCE";
}

// Emergencias: solo lugares cuyo tipo PRINCIPAL es el que se busca. Con `includedTypes` Google mete
// cualquier lugar que tenga "hospital" entre sus tipos secundarios (auditoría 10 #12: "Viagland",
// "Jorge", "Metrored Quito" antes que el Hospital de Jesús). Restaurantes y hoteles siguen igual.
const PRIMARY_ONLY = new Set(["hospital", "police", "pharmacy", "embassy", "atm", "gas_station"]);

export function nearbyTypeFilter(kind: string, type: string): { includedTypes: string[] } | { includedPrimaryTypes: string[] } {
  return PRIMARY_ONLY.has(String(kind)) ? { includedPrimaryTypes: [type] } : { includedTypes: [type] };
}

/** Cuerpo de places:searchNearby (Places API New). */
export function nearbySearchBody(b: { lat: number; lng: number; kind: string; radius?: number }, type: string) {
  return {
    ...nearbyTypeFilter(b.kind, type),
    // Emergencias: más candidatos, porque después se descartan los mal clasificados (rankEmergencyPlaces).
    maxResultCount: PRIMARY_ONLY.has(String(b.kind)) ? 20 : 15,
    locationRestriction: { circle: { center: { latitude: b.lat, longitude: b.lng }, radius: b.radius ?? (PRIMARY_ONLY.has(String(b.kind)) ? 3000 : 1500) } },
    rankPreference: nearbyRankPreference(b.kind),
    languageCode: "es",
  };
}

// ═══ Emergencias: lugares reales primero (auditoría 10 #12, ronda 2) ═══
// Aun con includedPrimaryTypes, Google devolvió en el Centro de CDMX "Viagland", "Jorge", "Metrored
// Quito" y "CENTRO HOLISTICO RIGAR" antes del Hospital de Jesús (4.0, 382 reseñas), y para policía una
// "Unidad de Policia Embajada" con tipo de oficina. Orden ahora:
//   1. nombre de hospital/policía + tipo principal correcto + reseñas mínimas;
//   2. nombre que lo dice (o tipo correcto con algunas reseñas);
//   3. tipo principal correcto y popular (muchas reseñas) aunque el nombre no lo diga ("Médica Sur").
// Fuera: nombres de personas o negocios sin relación (spa, holístico, agencia de viajes…) sin reseñas.
// Dentro de cada grupo, el más cercano primero.

export const EMERGENCY_MIN_REVIEWS = 20;

const RELEVANT_NAME: Record<string, RegExp> = {
  hospital: /\b(hospital\w*|h[oô]pital|ospedale|krankenhaus|sanatorio|cl[ií]nica|policl[ií]nica|cruz roja|imss|issste|pemex|centro m[eé]dico|m[eé]dica|medical center|urgencias|emergencias|emergency|maternidad|pediatr\w*|materno)\b/i,
  police: /\b(polic[ií]a\w*|policia\w*|police|polizia|polizei|ministerio p[uú]blico|fiscal[ií]a|comisar[ií]a|commissariat|gendarmer[ií]a|carabineros|guardia civil|guardia nacional|mossos|ertzaintza|seguridad (ciudadana|p[uú]blica)|precinct|sspc|coordinaci[oó]n territorial|agencia del ministerio)\b/i,
  embassy: /\b(embajada|consulado|embassy|consulate|ambassade|botschaft|ambasciata)\b/i,
};
const UNRELATED_NAME: Record<string, RegExp> = {
  hospital: /\b(hol[ií]stic\w*|spa|dental|dentist\w*|odontol\w*|veterin\w*|[oó]ptica|laboratorio|est[eé]tica|masaje\w*|nutri\w*|psic\w*|yoga|viaje\w*|travel|tours?|agencia|farmacia|botica|consultorio|homeopat\w*|acupuntura|quiropr\w*|fisioterapia|terapia\w*)\b/i,
  police: /\b(escolar|privada|alarmas|vigilancia|abogad\w*|tienda|seguros|escuela|academia|caja|museo)\b/i,
  embassy: /\b(visas? (express|r[aá]pid\w*)|tr[aá]mites|gestor\w*|agencia)\b/i,
};
const STRONG_TYPES: Record<string, string[]> = {
  hospital: ["hospital", "general_hospital"],
  police: ["police"],
  embassy: ["embassy"],
};

export interface EmergencyPlace {
  name: string; lat?: number | null; lng?: number | null; rating?: number | null; ratings_count?: number | null;
  primary_type?: string | null; distance_m?: number | null; [k: string]: unknown;
}

const R = 6371000;
export function metersBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** 1 = el mejor; null = se descarta. */
export function emergencyTier(kind: string, p: EmergencyPlace): 1 | 2 | 3 | null {
  const name = String(p.name ?? "").trim();
  if (!name) return null;
  const relevant = RELEVANT_NAME[kind]?.test(name) ?? false;
  if (UNRELATED_NAME[kind]?.test(name)) return null; // "Hospital veterinario", "Caja de previsión de la policía"
  const strong = !p.primary_type || (STRONG_TYPES[kind] ?? []).includes(String(p.primary_type));
  const reviews = Number(p.ratings_count) || 0;
  if (relevant && strong && reviews >= EMERGENCY_MIN_REVIEWS) return 1;
  if (relevant && (strong || reviews >= 5)) return 2;
  if (strong && !!p.primary_type && reviews >= EMERGENCY_MIN_REVIEWS * 5) return 3;
  return null;
}

/** ¿Este tipo de búsqueda usa el filtro de relevancia? (farmacias, cajeros y gasolineras: el más cercano). */
export const usesEmergencyRanking = (kind: string) => kind in STRONG_TYPES;

/**
 * Lugares de emergencia ordenados por relevancia y luego distancia, sin los que no son lo que se busca.
 * Si nada pasa el filtro, quedan los de tipo principal correcto con más reseñas (nunca una lista vacía
 * cuando Google sí trajo lugares de ese tipo).
 */
export function rankEmergencyPlaces<T extends EmergencyPlace>(kind: string, places: T[], origin?: { lat: number; lng: number } | null): T[] {
  const withDist = places.map((p) => {
    const ok = origin && typeof p.lat === "number" && typeof p.lng === "number" && Number.isFinite(p.lat) && Number.isFinite(p.lng);
    return ok ? { ...p, distance_m: Math.round(metersBetween(origin!, { lat: p.lat as number, lng: p.lng as number })) } : p;
  });
  if (!usesEmergencyRanking(kind)) return withDist;
  const dist = (p: EmergencyPlace) => (typeof p.distance_m === "number" ? p.distance_m : Number.MAX_SAFE_INTEGER);
  const ranked = withDist
    .map((p) => ({ p, t: emergencyTier(kind, p) }))
    .filter((x): x is { p: T; t: 1 | 2 | 3 } => x.t !== null)
    .sort((a, b) => a.t - b.t || dist(a.p) - dist(b.p))
    .map((x) => x.p);
  if (ranked.length) return ranked;
  return withDist
    .filter((p) => (STRONG_TYPES[kind] ?? []).includes(String(p.primary_type)) && !UNRELATED_NAME[kind]?.test(String(p.name)))
    .sort((a, b) => (Number(b.ratings_count) || 0) - (Number(a.ratings_count) || 0))
    .slice(0, 5);
}
