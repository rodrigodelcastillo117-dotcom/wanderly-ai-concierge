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
    maxResultCount: 15,
    locationRestriction: { circle: { center: { latitude: b.lat, longitude: b.lng }, radius: b.radius ?? (PRIMARY_ONLY.has(String(b.kind)) ? 3000 : 1500) } },
    rankPreference: nearbyRankPreference(b.kind),
    languageCode: "es",
  };
}
