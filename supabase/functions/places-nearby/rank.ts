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
