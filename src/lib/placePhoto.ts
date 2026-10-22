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
 */
import { supabase } from "@/integrations/supabase/client";
import { createBudget, invokeRetryAfter, invokeStatus } from "@/lib/imageBudget";

/** place-photo permite 60/min por usuario: el cliente se queda en 40 y pausa tras un 429. */
export const placePhotoBudget = createBudget({ perMinute: 40, concurrency: 4, cooldownMs: 60_000 });

const KEY = "iatos_place_photo_v1:";
const memory = new Map<string, string | null>();
const inflight = new Map<string, Promise<string | null>>();

function cacheKey(ref: string, maxWidth: number) {
  return `${KEY}${maxWidth}:${ref}`;
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
  if (memory.has(k)) return memory.get(k)!;
  const s = readSession(k);
  if (s !== undefined) { memory.set(k, s); return s; }
  const running = inflight.get(k);
  if (running) return running;
  const p = placePhotoBudget.run(async () => {
    try {
      // Los parámetros van en la URL y en el cuerpo: la versión de place-photo ya publicada solo
      // lee la URL, así que esto funciona desde que se publica el frontend, sin esperar la función.
      const qs = new URLSearchParams({ ref, maxWidth: String(maxWidth), mode: "url" });
      const { data, error } = await supabase.functions.invoke(`place-photo?${qs.toString()}`, { body: { ref, maxWidth, mode: "url" } });
      if (error) {
        const status = invokeStatus(error);
        if (status === 429) placePhotoBudget.block(invokeRetryAfter(error));
        // 400/404: el nombre de la foto ya no sirve (Google los cambia): no se vuelve a pedir en la sesión.
        if (status === 400 || status === 404) { memory.set(k, null); writeSession(k, null); }
        // otro error temporal (red, servidor): no se recuerda, se reintenta luego
        return null;
      }
      const url = isSafePhotoUrl(data?.url) ? data.url : null;
      memory.set(k, url);
      writeSession(k, url);
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
  if (memory.has(k)) return memory.get(k)!;
  const s = readSession(k);
  if (s !== undefined) { memory.set(k, s); return s; }
  const running = inflight.get(k);
  if (running) return running;
  const p = placePhotoBudget.run(async () => {
    // Pudo enterarse mientras esperaba turno (las primeras salen en paralelo).
    if (isResolveUnsupported()) return null;
    try {
      const body: Record<string, unknown> = { mode: "resolve", maxWidth };
      if (q.placeId) body.placeId = q.placeId;
      if (name) body.name = name.slice(0, 120);
      if (q.city) body.city = String(q.city).slice(0, 80);
      const { data, error } = await supabase.functions.invoke("place-photo", { body });
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
      memory.set(k, url);
      writeSession(k, url);
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
  const k = lookupKey(q, maxWidth);
  if (memory.has(k)) return memory.get(k)!;
  return readSession(k);
}

/** Lo que ya se sabe sin llamar (para pintar sin parpadeo al volver a una pantalla). */
export function cachedPlacePhoto(ref: string | null | undefined, maxWidth: number): string | null | undefined {
  if (!ref) return undefined;
  const k = cacheKey(ref, maxWidth);
  if (memory.has(k)) return memory.get(k)!;
  return readSession(k);
}

/** Solo pruebas. */
export function __resetPlacePhotoCache() {
  memory.clear();
  inflight.clear();
  placePhotoBudget.reset();
  resolveUnsupported = false;
}
