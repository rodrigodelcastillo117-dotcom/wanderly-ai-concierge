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
import { supabase } from "@/integrations/supabase/client";

export type VideoResult = { url: string | null; poster: string | null };

const EMPTY: VideoResult = { url: null, poster: null };
export const MAX_PER_MINUTE = 12;
const MAX_CONCURRENT = 3;
const WINDOW_MS = 60_000;
const COOLDOWN_MS = 5 * 60_000;

const cache = new Map<string, VideoResult>();
const inflight = new Map<string, Promise<VideoResult>>();
let startedAt: number[] = [];
let active = 0;
let blockedUntil = 0;
const queue: Array<() => void> = [];
let timer: ReturnType<typeof setTimeout> | null = null;

const keyOf = (q: string) => q.trim().toLowerCase().replace(/\s+/g, " ");

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
}

export function cachedVideo(query: string): VideoResult | undefined {
  return cache.get(keyOf(query));
}

function pump() {
  timer = null;
  const now = Date.now();
  startedAt = startedAt.filter((t) => now - t < WINDOW_MS);
  while (queue.length && active < MAX_CONCURRENT && startedAt.length < MAX_PER_MINUTE) {
    startedAt.push(Date.now());
    active += 1;
    queue.shift()!();
  }
  if (queue.length && !timer && startedAt.length >= MAX_PER_MINUTE) {
    timer = setTimeout(pump, Math.max(50, WINDOW_MS - (now - startedAt[0])));
  }
}

/** Espera un turno dentro del presupuesto por minuto; devuelve la función para liberarlo. */
function slot(): Promise<() => void> {
  return new Promise((resolve) => {
    queue.push(() => resolve(() => { active -= 1; pump(); }));
    pump();
  });
}

async function request(query: string): Promise<VideoResult> {
  const release = await slot();
  try {
    if (Date.now() < blockedUntil) return EMPTY;
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
      const retry = Number(res.headers.get("Retry-After"));
      blockedUntil = Date.now() + (Number.isFinite(retry) && retry > 0 ? retry * 1000 : COOLDOWN_MS);
      return EMPTY;
    }
    if (!res.ok) return EMPTY;
    const json = (await res.json()) as Partial<VideoResult>;
    return { url: json.url ?? null, poster: json.poster ?? null };
  } catch {
    return EMPTY;
  } finally {
    release();
  }
}

/** Una sola llamada por consulta en la sesión; nunca rechaza (sin video → imagen de respaldo). */
export function getDestinationVideo(query: string): Promise<VideoResult> {
  const key = keyOf(query);
  if (!key) return Promise.resolve(EMPTY);
  const hit = cache.get(key);
  if (hit) return Promise.resolve(hit);
  // En pausa por 429: no se llama ni se guarda; se intentará en un montaje posterior.
  if (Date.now() < blockedUntil && !inflight.has(key)) return Promise.resolve(EMPTY);
  let p = inflight.get(key);
  if (!p) {
    p = request(query).then((r) => {
      inflight.delete(key);
      // Lo pedido durante una pausa por 429 no se guarda como "sin video".
      if (r !== EMPTY || Date.now() >= blockedUntil) cache.set(key, r);
      return r;
    });
    inflight.set(key, p);
  }
  return p;
}
