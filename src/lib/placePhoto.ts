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
  const p = (async () => {
    try {
      // Los parámetros van en la URL y en el cuerpo: la versión de place-photo ya publicada solo
      // lee la URL, así que esto funciona desde que se publica el frontend, sin esperar la función.
      const qs = new URLSearchParams({ ref, maxWidth: String(maxWidth), mode: "url" });
      const { data, error } = await supabase.functions.invoke(`place-photo?${qs.toString()}`, { body: { ref, maxWidth, mode: "url" } });
      if (error) return null; // error temporal (red, límite por minuto): no se recuerda, se reintenta luego
      const url = isSafePhotoUrl(data?.url) ? data.url : null;
      memory.set(k, url);
      writeSession(k, url);
      return url;
    } catch {
      return null;
    } finally {
      inflight.delete(k);
    }
  })();
  inflight.set(k, p);
  return p;
}

/** Solo pruebas. */
export function __resetPlacePhotoCache() {
  memory.clear();
  inflight.clear();
}
