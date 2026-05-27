// Helpers de frontend para llamar a las edge functions de Google Maps.
// IMPORTANTE: GOOGLE_MAPS_API_KEY vive SOLO en backend.
// El frontend usa GOOGLE_MAPS_BROWSER_KEY únicamente para el mapa interactivo.
import { supabase } from "@/integrations/supabase/client";

export type PlaceResult = {
  id: string;
  name: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  rating: number | null;
  ratings_count: number;
  price_level: string | null;
  primary_type: string | null;
  types: string[];
  maps_url: string | null;
  website: string | null;
  open_now: boolean | null;
  business_status: string | null;
  photo_ref: string | null;
  source: string;
};

export async function searchPlaces(params: {
  query: string;
  lat?: number;
  lng?: number;
  radius?: number;
  language?: string;
  region?: string;
  maxResults?: number;
  openNow?: boolean;
  minRating?: number;
  priceLevels?: string[];
}): Promise<PlaceResult[]> {
  const { data, error } = await supabase.functions.invoke("places-search", { body: params });
  if (error) throw error;
  return data?.results ?? [];
}

export async function getPlaceDetails(placeId: string, language = "es") {
  const { data, error } = await supabase.functions.invoke("place-details", {
    body: { placeId, language },
  });
  if (error) throw error;
  return data?.result ?? null;
}

/**
 * URL pública (proxy) para una foto de Places. No expone la API key.
 * `ref` viene como `places/XXX/photos/YYY` (campo `photo_ref`).
 */
export function placePhotoUrl(ref: string, maxWidth = 800): string {
  const base = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/place-photo`;
  const params = new URLSearchParams({ ref, maxWidth: String(maxWidth) });
  return `${base}?${params.toString()}`;
}

export async function geocodeAddress(address: string, opts: { language?: string; region?: string } = {}) {
  const { data, error } = await supabase.functions.invoke("geocode", {
    body: { address, ...opts },
  });
  if (error) throw error;
  return data?.results ?? [];
}

export async function reverseGeocode(lat: number, lng: number, language = "es") {
  const { data, error } = await supabase.functions.invoke("geocode", {
    body: { latlng: `${lat},${lng}`, language },
  });
  if (error) throw error;
  return data?.results ?? [];
}
