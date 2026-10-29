// Búsqueda de videos de destino (función buscar-video → Pexels), compartida por todas las tarjetas.
//
// Por qué (N-04): Inicio y Members Only lanzaban docenas de GET /functions/v1/buscar-video por
// carga (una por tarjeta, sin deduplicar entre componentes, aun fuera de pantalla) y el servidor
// respondía 429 (límite de 15 por minuto por usuario). Ahora:
//   - una sola llamada por consulta en toda la sesión (caché + mapa de llamadas en curso);
//   - como mucho MAX_PER_MINUTE llamadas por minuto, por debajo del límite del servidor; el resto
//     espera en fila (mientras tanto se ve la imagen de respaldo);
//   - tras un 429 no se reintenta: se pausa todo hasta que pase el Retry-After (o COOLDOWN_MS);
//   - un error deja la imagen de respaldo y no se vuelve a pedir esa consulta en la sesión.
//
// Auditoría técnica 10/10 (P1-1, 28-oct-2026): el contador por minuto y la pausa tras un 429 vivían solo
// en memoria y se reiniciaban en cada recarga o pestaña nueva, así que cada recarga volvía a chocar con
// el límite del servidor (15/min y 150/h por usuario). Ahora:
//   - resultados, contador (por minuto y por hora) y pausa se guardan en sessionStorage: sobreviven a las
//     recargas de la pestaña sin dejar nada permanente en el dispositivo (si el navegador no deja guardar,
//     todo sigue en memoria como antes);
//   - un resultado se reutiliza 24 h (sin video: 6 h) sin volver a pedirlo;
//   - el servidor ya no responde 429 (200 con rate_limited + retry_after): no queda error rojo en consola,
//     y no se vuelve a pedir nada hasta que pase retry_after.
import { supabase } from "@/integrations/supabase/client";

export type VideoResult = { url: string | null; poster: string | null };

const EMPTY: VideoResult = { url: null, poster: null };
export const MAX_PER_MINUTE = 12;
/** Por hora, por debajo de los 150 del servidor (otras pestañas y pantallas comparten el contador). */
export const MAX_PER_HOUR = 100;
const MAX_CONCURRENT = 3;
const WINDOW_MS = 60_000;
const HOUR_MS = 3_600_000;
const COOLDOWN_MS = 5 * 60_000;
const HIT_TTL_MS = 24 * HOUR_MS;
const MISS_TTL_MS = 6 * HOUR_MS;
const STORE_KEY = "iatos.videos.v1";
const MAX_STORED = 300;

type Start = { t: number; tab: string };
type Stored = { results: Record<string, { url: string | null; poster: string | null; at: number }>; starts: Start[]; blockedUntil: number };
/** Esta carga de la página: sus llamadas se cuentan en memoria; las de cargas anteriores, desde el almacenamiento. */
let TAB_ID = Math.random().toString(36).slice(2);

function readStore(): Stored {
  try {
    const raw = typeof sessionStorage !== "undefined" ? sessionStorage.getItem(STORE_KEY) : null;
    const j = raw ? JSON.parse(raw) : null;
    return {
      results: j && typeof j.results === "object" && j.results ? j.results : {},
      starts: Array.isArray(j?.starts) ? j.starts.filter((x: Start) => x && typeof x.t === "number" && typeof x.tab === "string") : [],
      blockedUntil: typeof j?.blockedUntil === "number" ? j.blockedUntil : 0,
    };
  } catch {
    return { results: {}, starts: [], blockedUntil: 0 };
  }
}
function writeStore(update: (s: Stored) => void) {
  try {
    if (typeof sessionStorage === "undefined") return;
    const s = readStore();
    update(s);
    const now = Date.now();
    s.starts = s.starts.filter((x) => now - x.t < HOUR_MS).slice(-MAX_PER_HOUR * 2);
    const keys = Object.keys(s.results);
    if (keys.length > MAX_STORED) {
      keys.sort((a, b) => s.results[a].at - s.results[b].at).slice(0, keys.length - MAX_STORED).forEach((k) => delete s.results[k]);
    }
    sessionStorage.setItem(STORE_KEY, JSON.stringify(s));
  } catch { /* sin almacenamiento: queda en memoria */ }
}

const cache = new Map<string, VideoResult>();
const inflight = new Map<string, Promise<VideoResult>>();
let startedAt: number[] = [];
let active = 0;
let blockedUntil = 0;
const queue: Array<() => void> = [];
let timer: ReturnType<typeof setTimeout> | null = null;

const keyOf = (q: string) => q.trim().toLowerCase().replace(/\s+/g, " ");

/** Solo para pruebas: como una recarga de la página (se pierde la memoria, queda lo guardado). */
export function __resetVideoMemory() {
  TAB_ID = Math.random().toString(36).slice(2); // una recarga es otra "pestaña"
  cache.clear();
  inflight.clear();
  startedAt = [];
  active = 0;
  blockedUntil = 0;
  queue.length = 0;
  if (timer) clearTimeout(timer);
  timer = null;
}

/** Solo para pruebas. */
export function __resetVideoSearch() {
  cache.clear();
  inflight.clear();
  startedAt = [];
  active = 0;
  blockedUntil = 0;
  queue.length = 0;
  if (timer) clearTimeout(timer);
  timer = null;
  try { if (typeof sessionStorage !== "undefined") sessionStorage.removeItem(STORE_KEY); } catch { /* nada */ }
}

/** Pausa vigente (de esta pestaña o de otra/recarga anterior). */
function pausedUntil(): number {
  return Math.max(blockedUntil, readStore().blockedUntil);
}
function pauseFor(ms: number) {
  blockedUntil = Date.now() + ms;
  writeStore((s) => { s.blockedUntil = Math.max(s.blockedUntil, blockedUntil); });
}

function storedResult(key: string): VideoResult | undefined {
  const r = readStore().results[key];
  if (!r) return undefined;
  const ttl = r.url ? HIT_TTL_MS : MISS_TTL_MS;
  return Date.now() - r.at < ttl ? { url: r.url, poster: r.poster } : undefined;
}

export function cachedVideo(query: string): VideoResult | undefined {
  const key = keyOf(query);
  const hit = cache.get(key) ?? storedResult(key);
  if (hit) cache.set(key, hit);
  return hit;
}

/** Llamadas recientes de todas las pestañas (persistidas) + las de esta. */
function recentStarts(now: number): { minute: number; hour: number; oldestMinute: number | null } {
  const others = readStore().starts.filter((x) => x.tab !== TAB_ID).map((x) => x.t);
  const all = [...startedAt, ...others].filter((t) => now - t < HOUR_MS);
  const minute = all.filter((t) => now - t < WINDOW_MS).sort((a, b) => a - b);
  return { minute: minute.length, hour: all.length, oldestMinute: minute[0] ?? null };
}

function pump() {
  timer = null;
  const now = Date.now();
  startedAt = startedAt.filter((t) => now - t < HOUR_MS);
  let r = recentStarts(now);
  while (queue.length && active < MAX_CONCURRENT && r.minute < MAX_PER_MINUTE && r.hour < MAX_PER_HOUR) {
    const t = Date.now();
    startedAt.push(t);
    writeStore((s) => { s.starts.push({ t, tab: TAB_ID }); });
    active += 1;
    queue.shift()!();
    r = recentStarts(Date.now());
  }
  if (queue.length && !timer && (r.minute >= MAX_PER_MINUTE || r.hour >= MAX_PER_HOUR)) {
    const wait = r.minute >= MAX_PER_MINUTE && r.oldestMinute != null ? WINDOW_MS - (now - r.oldestMinute) : WINDOW_MS;
    timer = setTimeout(pump, Math.max(50, wait));
  }
}

/** Espera un turno dentro del presupuesto por minuto; devuelve la función para liberarlo. */
function slot(): Promise<() => void> {
  return new Promise((resolve) => {
    queue.push(() => resolve(() => { active -= 1; pump(); }));
    pump();
  });
}

const retryMs = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n * 1000 : COOLDOWN_MS;
};

async function request(query: string): Promise<VideoResult> {
  const release = await slot();
  try {
    if (Date.now() < pausedUntil()) return EMPTY;
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return EMPTY;
    const base = import.meta.env.VITE_SUPABASE_URL || `https://${import.meta.env.VITE_SUPABASE_PROJECT_ID}.supabase.co`;
    const res = await fetch(`${base}/functions/v1/buscar-video?q=${encodeURIComponent(query)}`, {
      headers: {
        apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${session.access_token}`,
      },
    });
    if (res.status === 429) {
      pauseFor(retryMs(res.headers.get("Retry-After")));
      return EMPTY;
    }
    if (!res.ok) return EMPTY;
    const json = (await res.json()) as Partial<VideoResult> & { rate_limited?: boolean; retry_after?: number };
    if (json.rate_limited) {
      pauseFor(retryMs(json.retry_after ?? res.headers.get("Retry-After")));
      return EMPTY;
    }
    return { url: json.url ?? null, poster: json.poster ?? null };
  } catch {
    return EMPTY;
  } finally {
    release();
  }
}

/** Una sola llamada por consulta (también entre recargas); nunca rechaza (sin video → imagen de respaldo). */
export function getDestinationVideo(query: string): Promise<VideoResult> {
  const key = keyOf(query);
  if (!key) return Promise.resolve(EMPTY);
  const hit = cachedVideo(query);
  if (hit) return Promise.resolve(hit);
  // En pausa por límite: no se llama ni se guarda; se intentará en un montaje posterior.
  if (Date.now() < pausedUntil() && !inflight.has(key)) return Promise.resolve(EMPTY);
  let p = inflight.get(key);
  if (!p) {
    p = request(query).then((r) => {
      inflight.delete(key);
      // Lo pedido durante una pausa por límite no se guarda como "sin video".
      if (r !== EMPTY || Date.now() >= pausedUntil()) {
        cache.set(key, r);
        writeStore((s) => { s.results[key] = { ...r, at: Date.now() }; });
      }
      return r;
    });
    inflight.set(key, p);
  }
  return p;
}
