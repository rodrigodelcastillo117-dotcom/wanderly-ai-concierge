/**
 * Lectura sin conexión de THE PRIVATE EDITION (piloto, especificación §9.B).
 *
 * · Se guarda en Cache Storage ("iatos-edition-v1"): el JSON de la edición (solo lo publicado y con licencia)
 *   y las imágenes con licencia que permiten uso offline, descargadas de verdad (CORS) y verificadas.
 *   Si una imagen o el JSON no se guardan, la copia NO se declara descargada (se borra lo parcial).
 * · También se guarda el "app shell" que está corriendo (index.html y los bundles /assets/ ya cargados), para
 *   que la app abra en modo avión aunque el Service Worker acabe de instalarse.
 * · Cada copia vive bajo el identificador (hash) del usuario: otra cuenta en el mismo dispositivo no la ve, y
 *   al cerrar sesión se borra todo (AuthContext + Service Worker + onAuthStateChange).
 * · Sin conexión NO se reserva, ni paga, ni se consulta disponibilidad: la pantalla offline no llama a la red.
 * · Al volver la red, reconcilePack() quita lo retirado y actualiza lo corregido.
 */
import type { EditionArticle, IssuePayload, Lang } from "@/lib/priveEdition";
import { imageAllowed } from "@/lib/priveEdition";

export const EDITION_CACHE = "iatos-edition-v1";
const SHELL_CACHE = "iatos-shell-v1";
const BASE = "/__edition__/";

export interface OfflinePack {
  id: string;
  kind: "issue" | "flight";
  title: string;
  issue: string;
  lang: Lang;
  generated_at: string;
  saved_at: string;
  bytes: number;
  image_count: number;
  article_count: number;
  payload: IssuePayload;    // solo los artículos de la copia
  versions: Record<string, number>;
}
export type OfflineIndexEntry = Omit<OfflinePack, "payload">;

export const offlineSupported = () => typeof caches !== "undefined" && typeof fetch !== "undefined";

/** Hash corto (no reversible a la vista) del id de usuario para separar las copias por cuenta. */
export async function userKey(uid: string): Promise<string> {
  try {
    const data = new TextEncoder().encode(`iatos-edition:${uid}`);
    const d = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(d)).slice(0, 12).map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    let h = 0;
    for (const ch of uid) h = (h * 31 + ch.charCodeAt(0)) | 0;
    return `f${(h >>> 0).toString(16)}`;
  }
}
const indexUrl = (uk: string) => `${BASE}${uk}/index.json`;
const packUrl = (uk: string, id: string) => `${BASE}${uk}/pack-${encodeURIComponent(id)}.json`;
const json = (v: unknown) => new Response(JSON.stringify(v), { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

async function readIndex(cache: Cache, uk: string): Promise<OfflineIndexEntry[]> {
  const r = await cache.match(indexUrl(uk));
  if (!r) return [];
  try { const v = await r.json(); return Array.isArray(v) ? v : []; } catch { return []; }
}

/** Imágenes de la copia: solo las que tienen licencia y permiten uso offline. */
export function offlineImageUrls(payload: IssuePayload, articles: EditionArticle[]): string[] {
  const keys = new Set<string>();
  for (const a of articles) for (const k of a.image_keys ?? []) keys.add(k);
  const urls: string[] = [];
  for (const k of keys) { const img = payload.images?.[k]; if (imageAllowed(img, "offline")) urls.push(img.url); }
  return urls;
}

/** Recorta la edición a la selección y quita las imágenes que no se pueden llevar offline (sin huecos). */
export function packPayload(payload: IssuePayload, articles: EditionArticle[]): IssuePayload {
  const images: NonNullable<IssuePayload["images"]> = {};
  for (const a of articles) for (const k of a.image_keys ?? []) {
    const img = payload.images?.[k];
    if (imageAllowed(img, "offline")) images[k] = img;
  }
  const strip = (a: EditionArticle): EditionArticle => ({
    ...a,
    hero_image: a.hero_image && images[a.hero_image] ? a.hero_image : undefined,
    body: (a.body ?? []).filter((b) => b.t !== "img" || !!images[b.image]),
    image_keys: (a.image_keys ?? []).filter((k) => !!images[k]),
  });
  const cover = payload.issue?.cover_image;
  const issue = payload.issue ? { ...payload.issue, cover_image: cover && imageAllowed(payload.images?.[cover], "offline") ? cover : undefined } : undefined;
  if (issue?.cover_image && payload.images?.[issue.cover_image]) images[issue.cover_image] = payload.images[issue.cover_image];
  return { ...payload, issue, articles: articles.map(strip), images };
}

/** Guarda los recursos de la app que ya están cargados para que abra sin red (mismo origen, /assets/ y "/"). */
export async function warmAppShell(): Promise<number> {
  if (!offlineSupported() || typeof document === "undefined") return 0;
  const urls = new Set<string>(["/"]);
  const add = (u: string | null | undefined) => {
    if (!u) return;
    try { const x = new URL(u, location.href); if (x.origin === location.origin && x.pathname.startsWith("/assets/")) urls.add(x.pathname); } catch { /* noop */ }
  };
  document.querySelectorAll<HTMLScriptElement>("script[src]").forEach((s) => add(s.src));
  document.querySelectorAll<HTMLLinkElement>("link[rel=modulepreload], link[rel=stylesheet]").forEach((l) => add(l.href));
  try { for (const e of performance.getEntriesByType("resource")) add((e as PerformanceResourceTiming).name); } catch { /* noop */ }
  const cache = await caches.open(SHELL_CACHE);
  let n = 0;
  for (const u of urls) {
    try {
      if (u !== "/" && await cache.match(u)) { n++; continue; }
      const r = await fetch(u, { credentials: "same-origin", cache: u === "/" ? "no-cache" : "default" });
      if (r.ok) { await cache.put(u, r); n++; }
    } catch { /* sin red para este recurso: el SW lo intentará después */ }
  }
  return n;
}

export interface StorageInfo { usage: number; quota: number; persisted: boolean }
export async function storageInfo(): Promise<StorageInfo | null> {
  try {
    const est = await navigator.storage?.estimate?.();
    if (!est) return null;
    const persisted = (await navigator.storage?.persisted?.()) ?? false;
    return { usage: est.usage ?? 0, quota: est.quota ?? 0, persisted };
  } catch { return null; }
}

export interface SaveResult { ok: boolean; bytes: number; images: number; articles: number; reason?: "unsupported" | "quota" | "image" | "network" | "write" }

/**
 * Descarga y guarda una copia. Atómica para el miembro: si algo falla, se borra lo parcial y ok=false.
 * fetchImpl se inyecta en las pruebas.
 */
export async function saveOfflinePack(
  uid: string,
  input: { id: string; kind: "issue" | "flight"; title: string; lang: Lang; payload: IssuePayload; articles: EditionArticle[] },
  fetchImpl: typeof fetch = fetch,
): Promise<SaveResult> {
  if (!offlineSupported()) return { ok: false, bytes: 0, images: 0, articles: 0, reason: "unsupported" };
  const uk = await userKey(uid);
  const cache = await caches.open(EDITION_CACHE);
  const payload = packPayload(input.payload, input.articles);
  const urls = offlineImageUrls(payload, payload.articles ?? []);
  // Espacio: estimación conservadora (JSON + ~600 KB por imagen) contra la cuota libre.
  const info = await storageInfo();
  const need = 200_000 + urls.length * 600_000;
  if (info && info.quota > 0 && info.quota - info.usage < need) return { ok: false, bytes: 0, images: 0, articles: 0, reason: "quota" };
  try { await navigator.storage?.persist?.(); } catch { /* opcional */ }

  const stored: string[] = [];
  let bytes = 0;
  for (const url of urls) {
    let res: Response | null = null;
    for (let attempt = 0; attempt < 2 && !res; attempt++) {
      try {
        const r = await fetchImpl(url, { mode: "cors", credentials: "omit" });
        if (r.ok && /^image\//.test(r.headers.get("content-type") ?? "image/jpeg")) res = r;
      } catch { /* reintento */ }
    }
    if (!res) {
      for (const u of stored) await cache.delete(u);
      return { ok: false, bytes: 0, images: 0, articles: 0, reason: navigator.onLine === false ? "network" : "image" };
    }
    const buf = await res.arrayBuffer();
    bytes += buf.byteLength;
    await cache.put(url, new Response(buf, { headers: { "Content-Type": res.headers.get("content-type") ?? "image/jpeg" } }));
    stored.push(url);
  }
  const now = new Date().toISOString();
  const versions: Record<string, number> = {};
  for (const a of payload.articles ?? []) versions[a.slug] = a.version;
  const pack: OfflinePack = {
    id: input.id, kind: input.kind, title: input.title, issue: payload.issue?.slug ?? "", lang: input.lang,
    generated_at: payload.generated_at ?? now, saved_at: now, bytes: 0, image_count: stored.length,
    article_count: payload.articles?.length ?? 0, payload, versions,
  };
  const body = JSON.stringify(pack);
  pack.bytes = bytes + body.length;
  try {
    await cache.put(packUrl(uk, input.id), json(pack));
    const idx = (await readIndex(cache, uk)).filter((e) => e.id !== input.id);
    const { payload: _p, ...entry } = pack;
    idx.unshift(entry);
    await cache.put(indexUrl(uk), json(idx));
  } catch {
    for (const u of stored) await cache.delete(u);
    await cache.delete(packUrl(uk, input.id));
    return { ok: false, bytes: 0, images: 0, articles: 0, reason: "write" };
  }
  return { ok: true, bytes: pack.bytes, images: stored.length, articles: pack.article_count };
}

export async function listOfflinePacks(uid: string): Promise<OfflineIndexEntry[]> {
  if (!offlineSupported() || !uid) return [];
  const cache = await caches.open(EDITION_CACHE);
  return readIndex(cache, await userKey(uid));
}

export async function readOfflinePack(uid: string, id: string): Promise<OfflinePack | null> {
  if (!offlineSupported() || !uid) return null;
  const cache = await caches.open(EDITION_CACHE);
  const r = await cache.match(packUrl(await userKey(uid), id));
  if (!r) return null;
  try { return (await r.json()) as OfflinePack; } catch { return null; }
}

/** Reemplaza la copia (p. ej. tras reconciliar al volver la red). Las imágenes quitadas se borran. */
export async function replaceOfflinePayload(uid: string, id: string, payload: IssuePayload): Promise<void> {
  const pack = await readOfflinePack(uid, id);
  if (!pack) return;
  const cache = await caches.open(EDITION_CACHE);
  const keep = new Set(offlineImageUrls(payload, payload.articles ?? []));
  for (const old of offlineImageUrls(pack.payload, pack.payload.articles ?? [])) if (!keep.has(old)) await cache.delete(old);
  const versions: Record<string, number> = {};
  for (const a of payload.articles ?? []) versions[a.slug] = a.version;
  const next: OfflinePack = { ...pack, payload, versions, article_count: payload.articles?.length ?? 0, generated_at: payload.generated_at ?? pack.generated_at };
  const uk = await userKey(uid);
  await cache.put(packUrl(uk, id), json(next));
  const idx = (await readIndex(cache, uk)).map((e) => (e.id === id ? { ...e, article_count: next.article_count, generated_at: next.generated_at } : e));
  await cache.put(indexUrl(uk), json(idx));
}

export async function deleteOfflinePack(uid: string, id: string): Promise<void> {
  if (!offlineSupported()) return;
  const pack = await readOfflinePack(uid, id);
  const cache = await caches.open(EDITION_CACHE);
  const uk = await userKey(uid);
  const others = await readIndex(cache, uk);
  const stillUsed = new Set<string>();
  for (const e of others) if (e.id !== id) {
    const p = await readOfflinePack(uid, e.id);
    if (p) for (const u of offlineImageUrls(p.payload, p.payload.articles ?? [])) stillUsed.add(u);
  }
  if (pack) for (const u of offlineImageUrls(pack.payload, pack.payload.articles ?? [])) if (!stillUsed.has(u)) await cache.delete(u);
  await cache.delete(packUrl(uk, id));
  await cache.put(indexUrl(uk), json(others.filter((e) => e.id !== id)));
}

/** Imagen guardada → URL local (blob:) para leer sin red. Sin copia → null (la pantalla no muestra hueco). */
export async function cachedImageUrl(url: string): Promise<string | null> {
  if (!offlineSupported()) return null;
  try {
    const r = await caches.match(url, { cacheName: EDITION_CACHE });
    if (!r) return null;
    return URL.createObjectURL(await r.blob());
  } catch { return null; }
}

/** Borra TODAS las copias de la edición de este dispositivo (cierre de sesión). */
export async function clearAllOfflineEditions(): Promise<void> {
  try { if (typeof caches !== "undefined") await caches.delete(EDITION_CACHE); } catch { /* noop */ }
}

/** Usuario de la sesión guardada en este navegador, sin red (para abrir copias en modo avión). */
export function storedUserId(storage: Storage | undefined = typeof localStorage !== "undefined" ? localStorage : undefined): string | null {
  if (!storage) return null;
  try {
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (!k || !/^sb-.+-auth-token$/.test(k)) continue;
      const v = JSON.parse(storage.getItem(k) ?? "null");
      const id = v?.user?.id ?? v?.currentSession?.user?.id;
      if (typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id)) return id;
    }
  } catch { /* noop */ }
  return null;
}
