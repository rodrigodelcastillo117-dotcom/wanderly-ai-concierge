// Foto y video de un viaje (tarjetas de Mis viajes e Inicio, encabezado del viaje). Caso Carlo
// (29-oct-2026): en los viajes de varias ciudades ("Tokio → Kioto → Osaka") la consulta a Pexels llevaba
// la ruta completa y no regresaba foto. Se usa la PRIMERA ciudad del viaje; si el destino es un país
// ("España") o la frase que escribió la persona, su ciudad principal (mainCityOf). Nunca un lugar
// inventado: si no se reconoce, el nombre tal cual.
import { destinationQuery, firstPlaceOf } from "@/lib/categoryImagery";
import { mainCityOf } from "@/lib/tripCoverage";
import { looksLikeRawPrompt, shortTripName, type NamedTrip } from "@/lib/tripName";
import { tripDestinations } from "../../supabase/functions/_shared/booking/tripRoute.ts";

export type ImageTrip = NamedTrip & { cover_image_url?: string | null };

/** Ciudad que representa el viaje en su foto: la primera parada (o la ciudad principal del país). */
export function tripPhotoPlace(trip: ImageTrip | null | undefined): string {
  if (!trip) return "";
  let first = tripDestinations(trip as any)[0] ?? "";
  if (!first || looksLikeRawPrompt(first)) {
    const named = shortTripName(trip);
    // "Sin destino" / "Tu viaje" son textos de la lista, no lugares.
    first = named === "Sin destino" || named === "Tu viaje" ? "" : named;
  }
  first = firstPlaceOf(first);
  return first ? mainCityOf(first) ?? first : "";
}

/** Consulta de foto de Pexels del viaje: "Tokio Japón travel". */
export function tripPhotoQuery(trip: ImageTrip | null | undefined): string | null {
  const place = tripPhotoPlace(trip);
  return place ? destinationQuery(place, trip?.pais_destino ?? null) : null;
}

/** Consulta del video del destino (encabezados): la misma ciudad, no la ruta completa. */
export function tripVideoQuery(trip: ImageTrip | null | undefined, style = "travel"): string | null {
  const place = tripPhotoPlace(trip);
  return place ? [place, trip?.pais_destino ?? "", style].map((x) => String(x).trim()).filter(Boolean).join(" ") : null;
}

/** Portada guardada del viaje (como antes de la ronda 4): cualquier https, también la foto de Google. */
export function savedCoverUrl(url: unknown): string | null {
  if (typeof url !== "string") return null;
  const t = url.trim();
  return /^https:\/\//i.test(t) ? t : null;
}
