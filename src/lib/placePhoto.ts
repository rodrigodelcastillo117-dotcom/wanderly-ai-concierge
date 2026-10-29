/**
 * Foto real de un lugar de Google Places para mostrar en <img>.
 *
 * La función place-photo exige la sesión del usuario (cuesta dinero en Google), y un <img src>
 * no puede mandar el header Authorization: por eso antes TODAS las fotos de Cercanos fallaban
 * (401 → bloqueado por el navegador → bloque oscuro vacío). Ahora se pide la URL pública de la
 * foto con la sesión (functions.invoke, modo "url") y esa URL —de googleusercontent, sin llave— es
 * la que va en el <img>.
 *
 * Presupuesto de Google: cada foto se pide una sola vez por sesión del navegador (memoria +
 * sessionStorage) y también se recuerda cuando NO hay foto, para no reintentar en cada clic.
 *
 * Costo (ronda 2 de la auditoría técnica, P2-11; docs/ops/LEEME.md "Costo de place-photo"):
 *  * La misma foto a otro ancho (miniatura 240 y tarjeta 800) ya no cuesta otra llamada: si ya se tiene
 *    la URL a un ancho mayor, se usa esa; si ya está en camino, se espera esa misma petición.
 *  * La foto que encontró "resolve" queda guardada también por su nombre (ref).
 *  * Se pide con GET (la función responde con Cache-Control de 1 día, como las propias fotos de Google):
 *    otra pestaña o una recarga del mismo navegador reutiliza la respuesta sin llamar a la función.
 *    No se guardan bytes de fotos de Google: solo la URL pública, en la sesión y en la caché HTTP.
 */
import { supabase } from "@/integrations/supabase/client";
import { createBudget, invokeRetryAfter, invokeStatus } from "@/lib/imageBudget";

/** place-photo permite 60/min por usuario: el cliente se queda en 40 y pausa tras un 429. */
export const placePhotoBudget = createBudget({ perMinute: 40, concurrency: 4, cooldownMs: 60_000 });

const KEY = "iatos_place_photo_v1:";
const memory = new Map<string, string | null>();
const inflight = new Map<string, Promise<string | null>>();

/** Anchos que pide la app (SmartImage: 240 y 800; PlacePhoto: 240 y 800) y otros comunes. */
const WIDTHS = [240, 320, 400, 480, 640, 800, 1024, 1200, 1600];

function cacheKey(ref: string, maxWidth: number) {
  return `${KEY}${maxWidth}:${ref}`;
}

function readKnown(k: string): string | null | undefined {
  if (memory.has(k)) return memory.get(k)!;
  const s = readSession(k);
  if (s !== undefined) memory.set(k, s);
  return s;
}

/**
 * Lo que ya se sabe de una foto a un ancho: la URL a ese ancho o a uno MAYOR (una foto de 800 sirve para
 * una miniatura de 240), o null si ya se supo que el nombre de la foto no sirve (a cualquier ancho).
 */
function knownAt(key: (w: number) => string, maxWidth: number): string | null | undefined {
  const exact = readKnown(key(maxWidth));
  if (exact !== undefined) return exact;
  let found: string | null | undefined;
  for (const w of WIDTHS) {
    if (w === maxWidth) continue;
    const v = readKnown(key(w));
    if (v === null) return null;
    if (v && w > maxWidth && found === undefined) found = v;
  }
  return found;
}
const knownPhoto = (ref: string, maxWidth: number) => knownAt((w) => cacheKey(ref, w), maxWidth);

/** Petición en camino para la misma foto a este ancho o a uno mayor. */
function inflightAt(key: (w: number) => string, maxWidth: number): Promise<string | null> | undefined {
  const exact = inflight.get(key(maxWidth));
  if (exact) return exact;
  for (const w of WIDTHS) if (w > maxWidth && inflight.has(key(w))) return inflight.get(key(w));
  return undefined;
}
const inflightPhoto = (ref: string, maxWidth: number) => inflightAt((w) => cacheKey(ref, w), maxWidth);

function remember(k: string, v: string | null) {
  memory.set(k, v);
  writeSession(k, v);
}

function readSession(k: string): string | null | undefined {
  try {
    const v = sessionStorage.getItem(k);
    if (v == null) return undefined;
    return v === "" ? null : v;
  } catch { return undefined; }
}

function writeSession(k: string, v: string | null) {
  try { sessionStorage.setItem(k, v ?? ""); } catch { /* sin almacenamiento */ }
}

/** Solo URLs https de Google: cualquier otra cosa se descarta (no se pone en <img>). */
export function isSafePhotoUrl(u: unknown): u is string {
  if (typeof u !== "string") return false;
  try {
    const url = new URL(u);
    return url.protocol === "https:" && /(^|\.)googleusercontent\.com$|(^|\.)ggpht\.com$|(^|\.)googleapis\.com$/.test(url.hostname);
  } catch { return false; }
}

/** URL pública de la foto, o null si no hay (o falló). Nunca lanza. */
export async function fetchPlacePhotoUrl(ref: string | null | undefined, maxWidth = 800): Promise<string | null> {
  if (!ref) return null;
  const k = cacheKey(ref, maxWidth);
  const known = knownPhoto(ref, maxWidth);
  if (known !== undefined) return known;
  const running = inflightPhoto(ref, maxWidth);
  if (running) return running;
  const p = placePhotoBudget.run(async () => {
    try {
      // GET con los parámetros en la URL (la versión ya publicada de place-photo los lee de ahí): el
      // navegador puede reutilizar la respuesta con su Cache-Control en otra pestaña o tras recargar.
      const qs = new URLSearchParams({ ref, maxWidth: String(maxWidth), mode: "url" });
      const { data, error } = await supabase.functions.invoke(`place-photo?${qs.toString()}`, { method: "GET" });
      if (error) {
        const status = invokeStatus(error);
        if (status === 429) placePhotoBudget.block(invokeRetryAfter(error));
        // 400/404: el nombre de la foto ya no sirve (Google los cambia): no se vuelve a pedir en la sesión.
        if (status === 400 || status === 404) remember(k, null);
        // otro error temporal (red, servidor): no se recuerda, se reintenta luego
        return null;
      }
      const url = isSafePhotoUrl(data?.url) ? data.url : null;
      remember(k, url);
      return url;
    } catch {
      return null;
    }
  }, null).finally(() => inflight.delete(k));
  inflight.set(k, p);
  return p;
}

export type PlaceLookup = { name?: string | null; city?: string | null; placeId?: string | null };

const lookupKey = (q: PlaceLookup, maxWidth: number) => {
  const n = (v: unknown) => String(v ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  return `${KEY}resolve:${maxWidth}:${q.placeId ? `id:${n(q.placeId)}` : `${n(q.name)}|${n(q.city)}`}`;
};

/**
 * Foto real de un lugar que no trae foto de Google (hotel del análisis, venue de Members, card del
 * concierge): place-photo en modo "resolve" busca su ficha y solo devuelve foto si el lugar que
 * encontró se llama igual. null = no hay foto real (la tarjeta usa una ilustrativa marcada).
 * Una sola llamada por lugar en la sesión del navegador (también cuando no hubo foto).
 */
const UNSUPPORTED = `${KEY}resolve_unsupported`;
let resolveUnsupported = false;
const isResolveUnsupported = () => {
  if (resolveUnsupported) return true;
  try { resolveUnsupported = sessionStorage.getItem(UNSUPPORTED) === "1"; } catch { /* sin almacenamiento */ }
  return resolveUnsupported;
};

export async function resolvePlacePhotoUrl(q: PlaceLookup, maxWidth = 800): Promise<string | null> {
  const name = String(q.name ?? "").trim();
  if (!q.placeId && name.length < 3) return null;
  // La versión publicada de place-photo aún no conoce "resolve" (respondió 400): no se insiste.
  if (isResolveUnsupported()) return null;
  const k = lookupKey(q, maxWidth);
  const known = knownAt((w) => lookupKey(q, w), maxWidth);
  if (known !== undefined) return known;
  const running = inflightAt((w) => lookupKey(q, w), maxWidth);
  if (running) return running;
  const p = placePhotoBudget.run(async () => {
    // Pudo enterarse mientras esperaba turno (las primeras salen en paralelo).
    if (isResolveUnsupported()) return null;
    try {
      // GET (como el modo "url"): la respuesta trae Cache-Control y el navegador la reutiliza.
      const qs = new URLSearchParams({ mode: "resolve", maxWidth: String(maxWidth) });
      if (q.placeId) qs.set("placeId", String(q.placeId));
      if (name) qs.set("name", name.slice(0, 120));
      if (q.city) qs.set("city", String(q.city).slice(0, 80));
      const { data, error } = await supabase.functions.invoke(`place-photo?${qs.toString()}`, { method: "GET" });
      if (error) {
        const status = invokeStatus(error);
        if (status === 429) { placePhotoBudget.block(invokeRetryAfter(error)); return null; }
        // 400 = la versión publicada de place-photo aún no conoce "resolve" (la nueva nunca responde
        // 400 en ese modo): se deja de pedir en esta sesión y la tarjeta usa la ilustrativa.
        if (status !== 400) return null;
        resolveUnsupported = true;
        try { sessionStorage.setItem(UNSUPPORTED, "1"); } catch { /* sin almacenamiento */ }
      }
      const url = isSafePhotoUrl(data?.url) ? data.url : null;
      remember(k, url);
      // La misma foto queda guardada por su nombre: otra tarjeta con ese ref no vuelve a pagarla.
      if (url && typeof data?.ref === "string" && data.ref) remember(cacheKey(data.ref, maxWidth), url);
      return url;
    } catch {
      return null;
    }
  }, null).finally(() => inflight.delete(k));
  inflight.set(k, p);
  return p;
}

/** Igual que cachedPlacePhoto, para resolvePlacePhotoUrl. */
export function cachedResolvedPhoto(q: PlaceLookup, maxWidth: number): string | null | undefined {
  if (!q.placeId && String(q.name ?? "").trim().length < 3) return null;
  return knownAt((w) => lookupKey(q, w), maxWidth);
}

/** Lo que ya se sabe sin llamar (para pintar sin parpadeo al volver a una pantalla). */
export function cachedPlacePhoto(ref: string | null | undefined, maxWidth: number): string | null | undefined {
  if (!ref) return undefined;
  return knownPhoto(ref, maxWidth);
}

/** Solo pruebas. */
export function __resetPlacePhotoCache() {
  memory.clear();
  inflight.clear();
  placePhotoBudget.reset();
  resolveUnsupported = false;
}
