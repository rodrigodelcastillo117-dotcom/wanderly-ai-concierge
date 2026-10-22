/**
 * Foto ilustrativa de Pexels (función pexels-image) para categorías: "comida italiana", "tour en
 * kayak", la ciudad de un viaje. NUNCA es la foto del lugar: quien la muestra la marca como
 * "Foto ilustrativa" (StockCaption / SmartImage).
 *
 * Presupuesto: una sola llamada por consulta en la sesión del navegador (memoria + sessionStorage,
 * también cuando no hubo foto), llamadas idénticas en curso se juntan, como mucho PEXELS_PER_MINUTE
 * por minuto (el servidor permite 30) y tras un 429 se pausa sin reintentar.
 */
import { supabase } from "@/integrations/supabase/client";
import { createBudget, invokeRetryAfter, invokeStatus } from "@/lib/imageBudget";

export type StockPhoto = { image: string; photographer: string | null; page_url: string | null };

export const PEXELS_PER_MINUTE = 20;
const KEY = "iatos_stock_photo_v1:";
const memory = new Map<string, StockPhoto | null>();
const inflight = new Map<string, Promise<StockPhotoLoad>>();
export const pexelsBudget = createBudget({ perMinute: PEXELS_PER_MINUTE, concurrency: 3, cooldownMs: 60_000 });

export const stockKey = (q: string) => q.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 100);

/** Solo https de Pexels (images.pexels.com): nada más va a un <img> como foto ilustrativa. */
export function isSafeStockUrl(u: unknown): u is string {
  if (typeof u !== "string") return false;
  try {
    const url = new URL(u);
    return url.protocol === "https:" && /(^|\.)pexels\.com$/.test(url.hostname);
  } catch { return false; }
}

function readSession(k: string): StockPhoto | null | undefined {
  try {
    const v = sessionStorage.getItem(KEY + k);
    if (v == null) return undefined;
    if (v === "") return null;
    const o = JSON.parse(v) as StockPhoto;
    return isSafeStockUrl(o?.image) ? o : null;
  } catch { return undefined; }
}

function writeSession(k: string, v: StockPhoto | null) {
  try { sessionStorage.setItem(KEY + k, v ? JSON.stringify(v) : ""); } catch { /* sin almacenamiento */ }
}

/** Lo que ya se sabe de una consulta (sin llamar): foto, null = no hay, undefined = no se ha pedido. */
export function cachedStockPhoto(query: string): StockPhoto | null | undefined {
  const k = stockKey(query);
  if (!k) return null;
  if (memory.has(k)) return memory.get(k)!;
  const s = readSession(k);
  if (s !== undefined) memory.set(k, s);
  return s;
}

/**
 * Resultado con el motivo: `transient` = no hubo respuesta definitiva (429, error de red, la fila en
 * pausa o Pexels caído); no se recuerda y se puede volver a pedir. `photo: null` sin `transient` = la
 * consulta no tiene foto (se recuerda en la sesión). Nunca lanza.
 */
export type StockPhotoLoad = { photo: StockPhoto | null; transient: boolean };

export function loadStockPhoto(query: string): Promise<StockPhotoLoad> {
  const k = stockKey(query);
  if (!k) return Promise.resolve({ photo: null, transient: false });
  const hit = cachedStockPhoto(k);
  if (hit !== undefined) return Promise.resolve({ photo: hit, transient: false });
  const running = inflight.get(k);
  if (running) return running;
  const PAUSED = Symbol("paused");
  const p = pexelsBudget.run<StockPhoto | null | typeof PAUSED>(async () => {
    try {
      const { data, error } = await supabase.functions.invoke("pexels-image", { body: { query: k } });
      if (error) {
        if (invokeStatus(error) === 429) pexelsBudget.block(invokeRetryAfter(error));
        return PAUSED; // error temporal (429, 503 de Pexels, red): no se recuerda
      }
      const d = data as { image?: unknown; photographer?: unknown; page_url?: unknown; upstream_error?: unknown } | null;
      // La función marca cuando Pexels mismo falló (cuota por hora): eso no es "sin foto".
      if (d?.upstream_error) return PAUSED;
      return isSafeStockUrl(d?.image)
        ? { image: d!.image as string, photographer: typeof d?.photographer === "string" ? d.photographer : null, page_url: typeof d?.page_url === "string" ? d.page_url : null }
        : null;
    } catch {
      return PAUSED;
    }
  }, PAUSED).then((r): StockPhotoLoad => {
    inflight.delete(k);
    if (r === PAUSED) return { photo: null, transient: true };
    memory.set(k, r);
    writeSession(k, r);
    return { photo: r, transient: false };
  });
  inflight.set(k, p);
  return p;
}

/** Foto ilustrativa para la consulta, o null. Nunca lanza. */
export function getStockPhoto(query: string): Promise<StockPhoto | null> {
  return loadStockPhoto(query).then((r) => r.photo);
}

/** Solo pruebas. */
export function __resetStockPhotos() {
  memory.clear();
  inflight.clear();
  pexelsBudget.reset();
  try {
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const key = sessionStorage.key(i);
      if (key?.startsWith(KEY)) sessionStorage.removeItem(key);
    }
  } catch { /* sin almacenamiento */ }
}
