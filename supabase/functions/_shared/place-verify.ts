// Validación de lugares antes de mostrarlos (auditoría de lugares reales, fase 1, 23-oct-2026).
// Sin dependencias de Deno: se prueba con Vitest (src/test/placeVerify.test.ts).
//
// Regla: un restaurante o tour que escribió la IA solo se presenta como real si Google Places lo
// encuentra con ese nombre. Encontrado → place_id y nombre oficial de Google (y la ficha de Maps por
// place_id, gratis). No encontrado → el restaurante no se muestra y el tour queda "Sin verificar". Sin
// tiempo o sin respuesta de Google → "Sin verificar" (nunca "verificado" por omisión).
//
// Costo: una búsqueda Text Search con el preset "verify" (id, displayName, googleMapsUri,
// businessStatus) = SKU Text Search Pro (USD 32 / 1,000; 5,000 gratis al mes). Text Search IDs Only
// es gratis pero no trae el nombre: siempre devuelve "el más parecido", aunque el nombre sea inventado,
// así que no valida nada. No se pide websiteUri (Enterprise): el enlace es la ficha por place_id.
// Caché: 30 días en serp_cache, guardando solo place_id (lo único que los términos de Google permiten
// guardar) o "no encontrado". En un acierto de caché el nombre es el que ya se validó contra Google.
import { type CacheStore, cacheGet, cacheKey, freshnessOf } from "./serpCache.ts";
import { type GooglePlace, searchText } from "./google-places.ts";
import type { GoogleTransport } from "./google-maps.ts";

export type VerifyResult =
  | { status: "found"; place_id: string; name: string; maps_url: string; cached: boolean; place?: GooglePlace }
  | { status: "not_found"; cached: boolean }
  | { status: "unchecked"; reason: "timeout" | "error" | "budget" | "sin_google" };

export const VERIFY_TTL_FOUND = 30 * 86400;
export const VERIFY_TTL_NOT_FOUND = 7 * 86400;
export const VERIFY_SKU = "Text Search Pro";

const norm = (v: unknown) =>
  String(v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// Palabras que no distinguen un lugar de otro ("Restaurante", "La", "del"…).
const GENERIC = new Set([
  "restaurante", "restaurant", "ristorante", "trattoria", "osteria", "bar", "cafe", "the", "and", "les", "los", "las", "del", "der",
  "die", "das", "des", "una", "uno", "por", "con", "tour", "visita", "guiada", "experiencia",
]);
const tokens = (v: unknown) => norm(v).split(" ").filter((t) => t.length >= 3 && !GENERIC.has(t));

/**
 * ¿El nombre que dio Google es el que escribió la IA? Igual, o todas las palabras distintivas del más
 * corto están en el más largo y cubren al menos la mitad de las del largo ("Botín" ↔ "Restaurante
 * Sobrino de Botín"; "Museo del Prado" ↔ "Museo Nacional del Prado"). Un nombre inventado casi nunca
 * comparte sus palabras distintivas con el lugar que Google devuelve.
 */
export function namesMatch(a: unknown, b: unknown, city?: string | null): boolean {
  const x = norm(a), y = norm(b);
  if (!x || !y) return false;
  if (x === y) return true;
  // El nombre de la ciudad no distingue un lugar ("Mezquita-Catedral de Córdoba" ↔ "Mezquita-Catedral").
  const skip = new Set(tokens(city));
  const ta = tokens(a).filter((t) => !skip.has(t)), tb = tokens(b).filter((t) => !skip.has(t));
  if (!ta.length || !tb.length) return false;
  const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  const longSet = new Set(long);
  const hits = new Set(short.filter((t) => longSet.has(t)));
  return hits.size === new Set(short).size && hits.size / longSet.size >= 0.5;
}

/** Ficha de Google Maps por place_id (URL documentada de Maps; gratis, sin llave). */
export function mapsPlaceUrl(name: string, placeId: string): string {
  const u = new URL("https://www.google.com/maps/search/");
  u.searchParams.set("api", "1");
  u.searchParams.set("query", name);
  u.searchParams.set("query_place_id", placeId);
  return u.toString();
}

export type ResolveInput = { name: string; city?: string | null; includedType?: string };

/** Busca un lugar por nombre y ciudad y confirma que Google lo conoce con ese nombre. */
export async function resolvePlace(
  t: GoogleTransport | null, input: ResolveInput, store?: CacheStore | null,
  opts: { timeoutMs?: number; language?: string; now?: () => number } = {},
): Promise<VerifyResult> {
  const name = String(input.name ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
  if (!name) return { status: "not_found", cached: false };
  const city = String(input.city ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
  const q = city && !norm(name).includes(norm(city)) ? `${name}, ${city}` : name;
  const key = await cacheKey("gplaces_verify", { q: norm(q), type: input.includedType ?? "" });
  const row = await cacheGet(store, key);
  if (row && freshnessOf(row, (opts.now ?? Date.now)()).fresh) {
    const id = (row.response as { place_id?: unknown } | null)?.place_id;
    if (typeof id === "string" && id) return { status: "found", place_id: id, name, maps_url: mapsPlaceUrl(name, id), cached: true };
    if (id === null) return { status: "not_found", cached: true };
  }
  if (!t) return { status: "unchecked", reason: "sin_google" };
  const r = await searchText(t, {
    query: q, language: opts.language ?? "es", preset: "verify", maxResults: 5, includedType: input.includedType,
    dropClosed: true, timeoutMs: opts.timeoutMs ?? 4000,
  });
  if (!r.ok) {
    const kind = (r as { error?: { kind?: string; message?: string } }).error;
    return { status: "unchecked", reason: kind?.message === "timeout" ? "timeout" : "error" };
  }
  const hit = r.places.find((p) => p.place_id && namesMatch(p.name, name, city));
  const put = async (resp: unknown, ttl: number) => {
    if (!store) return;
    try { await store.put(key, "gplaces_verify", resp, ttl); } catch { /* sin caché sigue funcionando */ }
  };
  if (!hit) {
    await put({ place_id: null }, VERIFY_TTL_NOT_FOUND);
    return { status: "not_found", cached: false };
  }
  await put({ place_id: hit.place_id }, VERIFY_TTL_FOUND);
  const official = hit.name ?? name;
  return { status: "found", place_id: hit.place_id, name: official, maps_url: mapsPlaceUrl(official, hit.place_id), cached: false, place: hit };
}

/**
 * Corre `fn` sobre cada elemento con un tope de concurrencia, un tiempo máximo por elemento y un
 * plazo total. Lo que no alcanza el plazo o se pasa del tiempo queda "unchecked" (Sin verificar).
 */
export async function verifyAll<T>(
  items: T[], fn: (item: T) => Promise<VerifyResult>,
  opts: { concurrency?: number; timeoutMs?: number; deadline?: number; now?: () => number } = {},
): Promise<VerifyResult[]> {
  const now = opts.now ?? Date.now;
  const out: VerifyResult[] = items.map(() => ({ status: "unchecked", reason: "budget" }));
  const per = Math.max(200, opts.timeoutMs ?? 4000);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      const left = opts.deadline !== undefined ? opts.deadline - now() : per;
      if (left < 200) continue; // sin tiempo: se queda "unchecked/budget"
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<VerifyResult>((res) => { timer = setTimeout(() => res({ status: "unchecked", reason: "timeout" }), Math.min(per, left)); });
      try {
        out[i] = await Promise.race([fn(items[i]).catch((): VerifyResult => ({ status: "unchecked", reason: "error" })), timeout]);
      } finally {
        clearTimeout(timer);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(opts.concurrency ?? 4, items.length)) }, worker));
  return out;
}

// ─── Aplicación a restaurantes y tours del viaje ───

const SOURCE_PLACES = new Set(["tripadvisor", "google_places", "google_maps"]);

/** ¿Este tour ya está respaldado por la lista del proveedor de este request (o por place_id)? */
export const tourBacked = (t: any) => !!t && (typeof t.place_id === "string" && !!t.place_id || SOURCE_PLACES.has(String(t.fuente ?? "")));

/** Marca "Sin verificar" (tour/experiencia o restaurante que no se pudo comprobar). */
export function markUnverified<T extends Record<string, any>>(x: T): T {
  const out: Record<string, any> = { ...x, verificado: false, estado_dato: "ESTIMADO", nota_verificacion: "Sin verificar en Google Maps" };
  if (!SOURCE_PLACES.has(String(out.fuente ?? ""))) out.fuente = out.fuente === "perplexity" ? "perplexity" : "estimado";
  // Sin respaldo: ni calificación ni enlace escritos por la IA.
  out.rating = null;
  out.num_reviews = null;
  delete out.cta_action;
  delete out.booking_link;
  delete out.website;
  delete out.url;
  return out as T;
}

/** Aplica el resultado de resolvePlace a un tour/experiencia. */
export function applyTourVerification<T extends Record<string, any>>(x: T, r: VerifyResult, nameKey: "nombre" | "name" = "nombre"): T {
  if (r.status !== "found") return markUnverified(x);
  const out: Record<string, any> = { ...x, [nameKey]: r.name, place_id: r.place_id, maps_url: r.maps_url, fuente: "google_places", verificado: true };
  delete out.nota_verificacion;
  delete out.cta_action;
  delete out.booking_link;
  return out as T;
}

/**
 * Tours de un viaje: los que no vienen de la lista del proveedor se buscan en Google; si no aparecen,
 * "Sin verificar". Los respaldados quedan `verificado: true`.
 */
export async function verifyTours(
  tours: unknown, city: string, resolve: (items: ResolveInput[]) => Promise<VerifyResult[]>, nameKey: "nombre" | "name" = "nombre",
): Promise<{ tours: any[]; resueltos: number; sin_verificar: number }> {
  const list: any[] = Array.isArray(tours) ? tours.filter((t) => t && typeof t === "object") : [];
  const pending = list.map((t, i) => ({ t, i })).filter(({ t }) => !tourBacked(t));
  const results = pending.length ? await resolve(pending.map(({ t }) => ({ name: String(t[nameKey] ?? t.nombre ?? t.name ?? ""), city: t.ciudad ?? city }))) : [];
  const out = list.map((t) => (tourBacked(t) ? { ...t, verificado: true } : t));
  let resueltos = 0, sin = 0;
  pending.forEach(({ i }, k) => {
    const r = results[k] ?? { status: "unchecked", reason: "budget" };
    if (r.status === "found") resueltos++; else sin++;
    out[i] = applyTourVerification(out[i], r, nameKey);
  });
  return { tours: out, resueltos, sin_verificar: sin };
}

/**
 * Resolvedor con presupuesto de tiempo: concurrencia limitada (compartida por todas las llamadas que
 * se le hagan, p. ej. todas las ciudades de un multidestino), tiempo máximo por búsqueda y plazo total.
 */
export function makeResolver(
  t: GoogleTransport | null, store: CacheStore | null,
  opts: { deadline: number; concurrency?: number; timeoutMs?: number; now?: () => number },
): (items: ResolveInput[]) => Promise<VerifyResult[]> {
  const timeoutMs = opts.timeoutMs ?? 3500;
  const max = Math.max(1, opts.concurrency ?? 4);
  let active = 0;
  const waiting: Array<() => void> = [];
  const acquire = () => new Promise<void>((res) => { if (active < max) { active++; res(); } else waiting.push(() => { active++; res(); }); });
  const release = () => { active--; waiting.shift()?.(); };
  const one = async (x: ResolveInput): Promise<VerifyResult> => {
    await acquire();
    try { return await resolvePlace(t, x, store, { timeoutMs, now: opts.now }); } finally { release(); }
  };
  // El tope real lo pone el semáforo; verifyAll solo aplica plazo y tiempo por elemento.
  return (items) => verifyAll(items, one, { concurrency: items.length || 1, timeoutMs: timeoutMs * 2 + 300, deadline: opts.deadline, now: opts.now });
}
