// Lectura de señales y caché del perfil de gustos (_shared/tasteProfile.ts). Sin Deno: Vitest la
// prueba con un cliente simulado.
//
// Caché: public.user_taste_profiles (una fila por persona). Los triggers de la migración
// 20261024100000_taste_profile.sql suben `rev` cada vez que cambia una señal (viaje, momento,
// visita, favorito, perfil declarado, gastos). El perfil guardado sirve mientras
// computed_rev = rev, la versión sea la actual y se haya calculado hoy (un viaje pasa a "pasado"
// solo con el paso del tiempo). Así un mensaje a Iato cuesta UNA lectura cuando nada cambió.
//
// Privacidad: TODAS las consultas filtran user_id = la persona, también con la llave de servicio.
import { buildTasteProfile, TASTE_VERSION, type TasteInputs, type TasteProfile } from "./tasteProfile.ts";

// deno-lint-ignore no-explicit-any
export type Db = { from(table: string): any };

export type CacheRow = {
  user_id: string;
  profile: TasteProfile | null;
  rev: number | null;
  computed_rev: number | null;
  version: number | null;
  computed_for: string | null;
} | null;

export const TASTE_TABLE = "user_taste_profiles";
const TRIP_COLS = "id, user_id, destino, pais_destino, fecha_salida, fecha_regreso, num_viajeros, status, hospedaje_json, selections, created_at";

async function rows(q: PromiseLike<{ data: unknown; error: unknown }>): Promise<any[]> {
  try {
    const { data, error } = await q;
    return !error && Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

async function one(q: PromiseLike<{ data: unknown; error: unknown }>): Promise<any | null> {
  try {
    const { data, error } = await q;
    return !error && data && typeof data === "object" ? data : null;
  } catch {
    return null;
  }
}

/** Viajes propios con su origen (trips.source lo agrega la importación de documentos; si aún no existe la columna, sin él). */
async function ownTrips(db: Db, userId: string): Promise<any[]> {
  const q = (cols: string) => db.from("trips").select(cols).eq("user_id", userId).order("fecha_salida", { ascending: false }).limit(80);
  try {
    const withSource = await q(`${TRIP_COLS}, source`);
    if (!withSource.error && Array.isArray(withSource.data)) return withSource.data;
  } catch { /* columna aún no existe */ }
  return rows(q(TRIP_COLS));
}

export type Prefetched = { travelProfile?: any; aiPrefs?: any };

/** Todas las señales de UNA persona, en paralelo. Cada consulta que falle cuenta como vacía. */
export async function fetchTasteInputs(db: Db, userId: string, todayISO: string, pre: Prefetched = {}): Promise<TasteInputs> {
  const [trips, moments, visitedPlaces, userVisits, savedRecos, travelProfile, aiPrefs, expenses] = await Promise.all([
    ownTrips(db, userId),
    rows(db.from("travel_moments").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(60)),
    rows(db.from("visited_places").select("user_id, name, cuisine, price_level, primary_type, status, notes, visited_at")
      .eq("user_id", userId).order("visited_at", { ascending: false }).limit(150)),
    rows(db.from("user_visits").select("user_id, place_name, category, trip_id, visited_at")
      .eq("user_id", userId).order("visited_at", { ascending: false }).limit(100)),
    rows(db.from("recomendaciones").select("user_id, tipo, titulo, descripcion, created_at")
      .eq("user_id", userId).eq("guardado", true).order("created_at", { ascending: false }).limit(30)),
    pre.travelProfile !== undefined ? Promise.resolve(pre.travelProfile) : one(db.from("travel_profiles").select("*").eq("user_id", userId).maybeSingle()),
    pre.aiPrefs !== undefined ? Promise.resolve(pre.aiPrefs) : one(db.from("ai_user_preferences").select("*").eq("user_id", userId).maybeSingle()),
    rows(db.from("expenses").select("user_id, trip_id, amount, currency, category").eq("user_id", userId).limit(500)),
  ]);
  return { userId, todayISO, trips, moments, visitedPlaces, userVisits, savedRecos, travelProfile, aiPrefs, expenses };
}

export async function readTasteCache(db: Db, userId: string): Promise<{ row: CacheRow; error: boolean }> {
  try {
    const { data, error } = await db.from(TASTE_TABLE)
      .select("user_id, profile, rev, computed_rev, version, computed_for").eq("user_id", userId).maybeSingle();
    if (error) return { row: null, error: true };
    return { row: (data as CacheRow) ?? null, error: false };
  } catch {
    return { row: null, error: true };
  }
}

export function isFresh(row: CacheRow, todayISO: string): boolean {
  return !!row?.profile && row.version === TASTE_VERSION && row.computed_for === todayISO
    && (row.computed_rev ?? -1) === (row.rev ?? 0);
}

// Respaldo por instancia SOLO si la tabla de caché no existe todavía (migración sin aplicar).
const memo = new Map<string, { at: number; profile: TasteProfile }>();
const MEMO_TTL_MS = 60_000;

export type TasteResult = { profile: TasteProfile | null; source: "cache" | "computed" | "stale" | "memo" | "none"; pending?: Promise<TasteProfile | null> };

/**
 * Perfil de gustos con caché. `db` lee las señales (cliente con la sesión de la persona cuando se
 * puede: RLS + filtro explícito); `cache` escribe la fila de caché (llave de servicio: la tabla no
 * es escribible por clientes). Con `timeoutMs`, si recalcular tarda más se usa el perfil anterior y
 * el cálculo termina en segundo plano (`pending`).
 */
export async function getTasteProfile(args: {
  db: Db; cache?: Db | null; userId: string; todayISO: string; prefetched?: Prefetched; timeoutMs?: number;
  cached?: { row: CacheRow; error: boolean };
}): Promise<TasteResult> {
  const { db, userId, todayISO } = args;
  const readDb = args.cache ?? db;
  const cached = args.cached ?? await readTasteCache(readDb, userId);
  if (isFresh(cached.row, todayISO)) return { profile: cached.row!.profile, source: "cache" };
  if (cached.error) {
    const m = memo.get(userId);
    if (m && Date.now() - m.at < MEMO_TTL_MS && m.profile.computed_for === todayISO) return { profile: m.profile, source: "memo" };
  }
  const rev = cached.row?.rev ?? 0;
  const compute = (async () => {
    try {
      const inputs = await fetchTasteInputs(db, userId, todayISO, args.prefetched);
      const profile = buildTasteProfile(inputs);
      if (cached.error) memo.set(userId, { at: Date.now(), profile });
      else if (args.cache) await writeTasteCache(args.cache, userId, profile, rev);
      return profile;
    } catch (e) {
      console.warn("taste_profile compute failed", (e as Error)?.message);
      return null;
    }
  })();
  if (!args.timeoutMs) {
    const profile = await compute;
    return { profile, source: profile ? "computed" : "none" };
  }
  const timeout = new Promise<"timeout">((r) => setTimeout(() => r("timeout"), args.timeoutMs));
  const first = await Promise.race([compute, timeout]);
  if (first !== "timeout") return { profile: first, source: first ? "computed" : "none" };
  const stale = cached.row?.profile && cached.row.version === TASTE_VERSION ? cached.row.profile : null;
  return { profile: stale, source: stale ? "stale" : "none", pending: compute };
}

/** Guarda el perfil con el `rev` que se leyó ANTES de calcular: si algo cambió mientras, sigue viejo. */
export async function writeTasteCache(cache: Db, userId: string, profile: TasteProfile, rev: number): Promise<void> {
  try {
    const { error } = await cache.from(TASTE_TABLE).upsert({
      user_id: userId, profile, computed_rev: rev, version: TASTE_VERSION, computed_for: profile.computed_for,
      hash: profile.hash, computed_at: new Date().toISOString(),
    }, { onConflict: "user_id" });
    if (error) console.warn("taste_profile cache write:", (error as { message?: string })?.message);
  } catch (e) {
    console.warn("taste_profile cache write failed", (e as Error)?.message);
  }
}

/** Recalcula ya (después de subir un momento) y guarda; devuelve el perfil nuevo. */
export async function refreshTasteProfile(db: Db, cache: Db, userId: string, todayISO: string): Promise<TasteProfile | null> {
  const { row } = await readTasteCache(cache, userId);
  const inputs = await fetchTasteInputs(db, userId, todayISO);
  const profile = buildTasteProfile(inputs);
  await writeTasteCache(cache, userId, profile, row?.rev ?? 0);
  return profile;
}

/** Solo para pruebas. */
export function __resetTasteMemo() {
  memo.clear();
}
