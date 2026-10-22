// Foto real de un lugar que llegó SIN foto de Google (hotel del análisis, venue de Members Only,
// card del concierge): place_id (por nombre o el que ya trae) → ficha con foto → URL pública.
// Sin dependencias de Deno (se prueba con Vitest). La usa place-photo en modo "resolve".
//
// Costo (precios en google-maps.ts): Text Search IDs Only (gratis; el place_id se guarda 30 días en
// la caché compartida) + Place Details Pro (displayName y fotos) + Place Details Photos. El cliente
// solo lo pide cuando la tarjeta está en pantalla y lo recuerda en la sesión del navegador.
//
// Honestidad: si se buscó por nombre, el lugar que devuelve Google tiene que llamarse igual (mismas
// palabras significativas). "Tour gastronómico por el centro" puede traer cualquier restaurante:
// entonces NO hay foto real y la app muestra una foto ilustrativa marcada como tal.
import { type GoogleTransport, googleJson } from "./google-maps.ts";
import { findPlaceId, placeDetails } from "./google-places.ts";
import type { CacheStore } from "./serpCache.ts";

const STOP = new Set([
  "hotel", "hoteles", "hostal", "restaurante", "restaurant", "the", "and", "los", "las", "del", "de", "la", "el", "en", "por",
  "and", "bar", "cafe", "tour", "tours", "boutique", "resort", "suites", "spa", "casa", "city", "centro", "historico",
]);

const norm = (v: unknown) =>
  String(v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const tokens = (v: unknown) => norm(v).split(" ").filter((w) => w.length >= 3 && !STOP.has(w));

/**
 * ¿El lugar de Google es el que se buscó? Todas las palabras significativas del nombre buscado (o
 * del de Google, si es más corto) están en el otro. "Hotel Morada" ≈ "Morada Hotel Puebla";
 * "Tour gastronómico" ≠ "Restaurante El Mural de los Poblanos".
 */
export function samePlaceForPhoto(wanted: unknown, got: unknown): boolean {
  const a = tokens(wanted), b = tokens(got);
  if (!a.length || !b.length) return norm(wanted) !== "" && norm(wanted) === norm(got);
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  const set = new Set(long);
  return short.every((w) => set.has(w));
}

export type ResolveInput = { name?: string | null; city?: string | null; placeId?: string | null; maxWidth?: number };
export type ResolveOutput = { url: string | null; ref: string | null; place_name: string | null; reason?: string };

const isPlaceId = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9_-]{10,300}$/.test(v.replace(/^places\//, ""));

/** URL pública (googleusercontent) de la primera foto del lugar. Nunca lanza. */
export async function resolvePlacePhoto(t: GoogleTransport, input: ResolveInput, store?: CacheStore | null): Promise<ResolveOutput> {
  const name = String(input.name ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
  const city = String(input.city ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
  const maxWidth = Math.min(Math.max(Math.round(Number(input.maxWidth) || 800), 64), 1600);
  const none = (reason: string): ResolveOutput => ({ url: null, ref: null, place_name: null, reason });

  let id = isPlaceId(input.placeId) ? input.placeId.replace(/^places\//, "") : null;
  const byName = !id;
  if (!id) {
    if (name.length < 3) return none("sin_nombre");
    id = await findPlaceId(t, city ? `${name}, ${city}` : name, store);
    if (!id) return none("sin_lugar");
  }
  const d = await placeDetails(t, id, { preset: "basic" });
  if (!d.ok) return none("sin_ficha");
  const place = (d as { place: { name: string | null; photo_ref: string | null } }).place;
  if (byName && !samePlaceForPhoto(name, place.name)) return none("otro_lugar");
  const ref = place.photo_ref;
  if (!ref) return { url: null, ref: null, place_name: place.name, reason: "sin_foto" };
  const q = new URLSearchParams({ maxWidthPx: String(maxWidth), skipHttpRedirect: "true" });
  const m = await googleJson<{ photoUri?: string }>(t, "places", "Place Details Photos", `/v1/${ref}/media`, { method: "GET", query: q });
  const uri = m.ok ? (m as { data: { photoUri?: string } }).data?.photoUri : null;
  const url = typeof uri === "string" && /^https:\/\/[^/]*(googleusercontent\.com|ggpht\.com)\//.test(uri) ? uri : null;
  return { url, ref, place_name: place.name, ...(url ? {} : { reason: "sin_foto" }) };
}
