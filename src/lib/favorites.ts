// Favoritos: etiqueta legible y a dónde lleva cada tarjeta (auditoría 10/10, P1-9).
// Antes se mostraba el tipo técnico ("DESTINATION_AI") y las tarjetas no abrían nada.

const LABELS: Record<string, string> = {
  destination_ai: "Destino", destination: "Destino", destino: "Destino",
  restaurante: "Restaurante", restaurant: "Restaurante", hotel: "Hotel", experiencia: "Experiencia", activity: "Experiencia",
  lugar: "Lugar", place: "Lugar",
};

/** "Destino", "Restaurante"… (nunca el tipo técnico). Un tipo desconocido no se muestra. */
export function favoriteKindLabel(tipo: string | null | undefined): string | null {
  return LABELS[String(tipo ?? "").trim().toLowerCase()] ?? null;
}

type Fav = { titulo: string | null; tipo: string | null; descripcion?: string | null; metadata?: Record<string, unknown> | null };
export type FavoriteHref = { url: string; internal: boolean; label: string };

/** Destino → planear un viaje ahí; lugar con ficha de Google → Google Maps; si no hay con qué, null. */
export function favoriteHref(f: Fav): FavoriteHref | null {
  const titulo = String(f.titulo ?? "").trim();
  if (!titulo) return null;
  const kind = favoriteKindLabel(f.tipo);
  if (kind === "Destino" || kind === null && !f.metadata?.place_id) {
    return { url: `/dashboard/planear?destino=${encodeURIComponent(titulo)}`, internal: true, label: `Planear un viaje a ${titulo}` };
  }
  const placeId = typeof f.metadata?.place_id === "string" ? f.metadata.place_id : null;
  const query = [titulo, f.descripcion].filter(Boolean).join(", ");
  const url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}${placeId ? `&query_place_id=${encodeURIComponent(placeId)}` : ""}`;
  return { url, internal: false, label: `Ver ${titulo} en Google Maps` };
}
