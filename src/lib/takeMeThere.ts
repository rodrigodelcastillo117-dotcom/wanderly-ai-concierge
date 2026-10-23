// "Llévame" (Take Me There): abre Google Maps con la URL oficial de rutas (Maps URLs, api=1).
// https://developers.google.com/maps/documentation/urls/get-started#directions-action
//
// Reglas:
//   * Solo con place_id de Google o coordenadas del lugar (de la herramienta, nunca inventadas).
//   * Sin origin: Google Maps pone el origen desde el dispositivo. Nunca un viaje futuro como origen.
//     origin= solo si el usuario dio una dirección explícita.
//   * dir_action=navigate solo en móvil (en escritorio Maps muestra la ruta, no navega).
//   * Sin GPS propio ni permisos nuevos.
import { isGooglePlaceId } from "../../supabase/functions/concierge-chat/cards.ts";

export const TRAVEL_MODES = ["driving", "walking", "transit", "bicycling"] as const;
export type TravelMode = (typeof TRAVEL_MODES)[number];

export interface TakeMeThereTarget {
  name?: string | null;
  address?: string | null;
  placeId?: string | null;
  lat?: number | null;
  lng?: number | null;
}

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const validCoords = (lat: unknown, lng: unknown): boolean =>
  finite(lat) && finite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);

/** ¿Hay con qué armar "Llévame"? (place_id de Google o coordenadas válidas). */
export function canTakeMeThere(t: TakeMeThereTarget | null | undefined): boolean {
  return !!t && (isGooglePlaceId(t.placeId) || validCoords(t.lat, t.lng));
}

/**
 * URL oficial de Google Maps para ir al lugar. null si no hay place_id ni coordenadas.
 * `origin` solo cuando el usuario escribió una dirección de salida explícita.
 */
export function takeMeThereUrl(
  t: TakeMeThereTarget,
  opts: { mode?: TravelMode | string | null; mobile?: boolean; origin?: string | null } = {},
): string | null {
  if (!canTakeMeThere(t)) return null;
  const placeId = isGooglePlaceId(t.placeId) ? t.placeId : null;
  const coords = validCoords(t.lat, t.lng) ? `${t.lat},${t.lng}` : null;
  const name = String(t.name ?? "").trim().slice(0, 200);
  const address = String(t.address ?? "").trim().slice(0, 200);
  // Con place_id, destination es el nombre (Google lo pide junto al id); sin él, las coordenadas.
  const destination = placeId ? (name || address || coords || "") : (coords ?? "");
  if (!destination) return null;
  const mode: TravelMode = (TRAVEL_MODES as readonly string[]).includes(String(opts.mode)) ? (opts.mode as TravelMode) : "driving";
  const enc = encodeURIComponent;
  let url = "https://www.google.com/maps/dir/?api=1";
  const origin = String(opts.origin ?? "").trim().slice(0, 200);
  if (origin) url += `&origin=${enc(origin)}`;
  url += `&destination=${enc(destination)}`;
  if (placeId) url += `&destination_place_id=${enc(placeId)}`;
  url += `&travelmode=${mode}`;
  if (opts.mobile) url += "&dir_action=navigate";
  return url;
}

/**
 * Ruta de Google Maps por TEXTO (dirección, nombre del lugar o ciudad), misma URL oficial (Maps URLs,
 * api=1: origin/destination aceptan "address, place name or lat/lng"). Para tramos entre ciudades
 * ("Ver horarios en Google Maps" en modo transit: horarios y operadores reales, gratis) y para el
 * recinto de un evento, que Google Events da como dirección. Sin origin, Maps usa el dispositivo.
 */
export function mapsDirectionsUrl(p: { destination: string | null | undefined; origin?: string | null; mode?: TravelMode | string | null; mobile?: boolean }): string | null {
  const destination = String(p.destination ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
  if (!destination) return null;
  const mode: TravelMode = (TRAVEL_MODES as readonly string[]).includes(String(p.mode)) ? (p.mode as TravelMode) : "driving";
  const origin = String(p.origin ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
  const enc = encodeURIComponent;
  let url = "https://www.google.com/maps/dir/?api=1";
  if (origin) url += `&origin=${enc(origin)}`;
  url += `&destination=${enc(destination)}&travelmode=${mode}`;
  if (p.mobile) url += "&dir_action=navigate";
  return url;
}

/** "Ver horarios en Google Maps" de un tramo en tren o autobús: modo transit, sin fecha (Maps no la recibe). */
export const transitScheduleUrl = (origin: string | null | undefined, destination: string | null | undefined) =>
  String(origin ?? "").trim() ? mapsDirectionsUrl({ origin, destination, mode: "transit" }) : null;

/** Móvil (teléfono o tableta) por el navegador; sin permisos ni sensores. */
export function isMobileDevice(nav: { userAgent?: string; maxTouchPoints?: number } | undefined = typeof navigator !== "undefined" ? navigator : undefined): boolean {
  if (!nav) return false;
  const ua = String(nav.userAgent ?? "");
  if (/Android|iPhone|iPad|iPod|Mobile|IEMobile|Opera Mini/i.test(ua)) return true;
  // iPadOS se presenta como Mac con pantalla táctil.
  return /Macintosh/.test(ua) && (nav.maxTouchPoints ?? 0) > 1;
}
