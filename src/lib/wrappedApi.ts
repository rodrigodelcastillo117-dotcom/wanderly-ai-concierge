// Carga de IATOS Wrapped desde Supabase. Todo sale de consultas que ya respetan RLS (cada tabla solo
// devuelve filas de quien pregunta; también las fotos de Recuerdos del año) más la RPC wrapped_companions (solo nombres de quienes compartieron
// viaje con auth.uid(); migración 20261026310000). Las fotos están en buckets PRIVADOS: se piden enlaces
// firmados de 1 h, igual que Mejores momentos y el diario. El cliente es inyectable para las pruebas.
import { JOURNAL_BUCKET, MOMENTS_BUCKET, signPhotoPaths } from "@/lib/photoUpload";
import { RECUERDOS_BUCKET } from "@/lib/recuerdos/model";
import { fetchFxTable, type FxTable } from "@/lib/fx";
import {
  computeWrapped, geocodeQueries, geoKey, tripsInYear, yearsWithTrips,
  type Coord, type WrappedInput, type WrappedStats, type WrappedTrip,
} from "@/lib/wrapped";

type Res = { data: unknown; error: unknown };
type Query = PromiseLike<Res> & {
  select: (cols: string) => Query; eq: (c: string, v: unknown) => Query; in: (c: string, v: unknown[]) => Query;
  gte: (c: string, v: unknown) => Query; lte: (c: string, v: unknown) => Query; order: (c: string, o?: unknown) => Query;
  limit: (n: number) => Query; maybeSingle: () => PromiseLike<Res>;
};
export type WrappedClient = {
  from: (table: string) => Query;
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<Res>;
  functions: { invoke: (fn: string, opts: { body: unknown }) => PromiseLike<Res> };
  storage: Parameters<typeof signPhotoPaths>[0]["storage"];
};

export type WrappedLoad = { stats: WrappedStats; years: number[] };

const rows = <T>(r: Res | null | undefined): T[] => (r && !r.error && Array.isArray(r.data) ? (r.data as T[]) : []);
const TRIP_COLS = "id, destino, pais_destino, ciudad_origen, fecha_salida, fecha_regreso, itinerario_json, num_viajeros, total_estimado, hospedaje_json";

// Coordenadas en memoria (sesión): volver a abrir el resumen no geocodifica de nuevo.
const geoCache = new Map<string, Coord | null>();

export async function geocodeAll(client: WrappedClient, queries: string[]): Promise<Record<string, Coord>> {
  const out: Record<string, Coord> = {};
  const pending = queries.filter((q) => !geoCache.has(geoKey(q)));
  // De 3 en 3: la función geocode limita a 30 por minuto.
  for (let i = 0; i < pending.length; i += 3) {
    await Promise.all(pending.slice(i, i + 3).map(async (q) => {
      try {
        const { data, error } = await client.functions.invoke("geocode", { body: { address: q, language: "es" } });
        const r = !error && Array.isArray((data as { results?: unknown })?.results) ? (data as { results: Array<{ lat?: unknown; lng?: unknown }> }).results[0] : null;
        geoCache.set(geoKey(q), r && typeof r.lat === "number" && typeof r.lng === "number" ? { lat: r.lat, lng: r.lng } : null);
      } catch {
        // Sin red: ese lugar no suma kilómetros (y no se guarda, para intentarlo la próxima vez).
      }
    }));
  }
  for (const q of queries) { const c = geoCache.get(geoKey(q)); if (c) out[geoKey(q)] = c; }
  return out;
}

export function clearWrappedGeoCache() { geoCache.clear(); }

export async function loadWrapped(
  client: WrappedClient,
  userId: string,
  year: number,
  today: string,
  deps: { fx?: () => Promise<FxTable> } = {},
): Promise<WrappedLoad> {
  const [profileR, ownR, collabR] = await Promise.all([
    client.from("profiles").select("full_name, ciudad_origen, avatar_url").eq("id", userId).maybeSingle(),
    client.from("trips").select(TRIP_COLS).eq("user_id", userId).order("fecha_salida", { ascending: true }).limit(500),
    client.from("trip_collaborators").select("trip_id").eq("user_id", userId).eq("status", "accepted"),
  ]);
  if (ownR?.error) throw new Error("No pudimos cargar tus viajes.");
  const own = rows<WrappedTrip>(ownR);
  const sharedIds = rows<{ trip_id: string }>(collabR).map((c) => c.trip_id).filter((id) => !own.some((t) => t.id === id));
  const shared = sharedIds.length ? rows<WrappedTrip>(await client.from("trips").select(TRIP_COLS).in("id", sharedIds)) : [];
  const allTrips = [...own, ...shared];
  const profile = (profileR && !profileR.error ? profileR.data : null) as { full_name?: string | null; ciudad_origen?: string | null; avatar_url?: string | null } | null;
  const years = yearsWithTrips(allTrips, today);
  const yearTrips = tripsInYear(allTrips, year, today);
  const avatarUrl = typeof profile?.avatar_url === "string" && /^https?:\/\//.test(profile.avatar_url) ? profile.avatar_url : null;
  const base: WrappedInput = { year, today, firstName: profile?.full_name ?? null, avatarUrl, homeCity: profile?.ciudad_origen ?? null, trips: allTrips };
  if (!yearTrips.length) return { stats: computeWrapped(base), years };

  const ids = yearTrips.map((t) => t.id);
  const from = `${year}-01-01`, to = `${year}-12-31`;
  const [momR, jouR, expR, visR, plcR, ubR, compR, recR] = await Promise.all([
    client.from("travel_moments").select("id, trip_id, caption, destino, created_at, tags, image_path, image_url").eq("user_id", userId).order("created_at", { ascending: true }).limit(400),
    client.from("trip_journal_entries").select("id, trip_id, text, created_at, photo_path").eq("author_id", userId).in("trip_id", ids).limit(400),
    client.from("expenses").select("amount, currency, category, expense_date").eq("user_id", userId).gte("expense_date", from).lte("expense_date", to).limit(2000),
    client.from("user_visits").select("category, visited_at").eq("user_id", userId).gte("visited_at", from).lte("visited_at", `${to}T23:59:59.999Z`).limit(2000),
    client.from("visited_places").select("visited_at").eq("user_id", userId).eq("status", "visited").gte("visited_at", from).lte("visited_at", `${to}T23:59:59.999Z`).limit(2000),
    client.from("user_badges").select("badge_id, unlocked_at").eq("user_id", userId),
    client.rpc("wrapped_companions", { p_year: year }),
    // Recuerdos (fotos subidas por la persona) tomados ese año; las favoritas primero.
    client.from("recuerdos").select("id, trip_id, taken_on, favorite, storage_path").eq("user_id", userId).eq("media_type", "foto")
      .gte("taken_on", from).lte("taken_on", to).order("favorite", { ascending: false }).limit(400),
  ]);

  type M = { id: string; trip_id: string | null; caption: string | null; destino: string | null; created_at: string; tags: string[] | null; image_path: string | null; image_url: string | null };
  type J = { id: string; trip_id: string; text: string | null; created_at: string; photo_path: string | null };
  const moments = rows<M>(momR);
  const journal = rows<J>(jouR);
  type R = { id: string; trip_id: string | null; taken_on: string; favorite: boolean | null; storage_path: string };
  const recuerdos = rows<R>(recR);
  const [momSigned, jouSigned, recSigned] = await Promise.all([
    signPhotoPaths(client as never, MOMENTS_BUCKET, moments.map((m) => m.image_path)),
    signPhotoPaths(client as never, JOURNAL_BUCKET, journal.map((j) => j.photo_path)),
    signPhotoPaths(client as never, RECUERDOS_BUCKET, recuerdos.map((r) => r.storage_path)),
  ]);

  const ub = rows<{ badge_id: string; unlocked_at: string | null }>(ubR).filter((b) => String(b.unlocked_at ?? "").startsWith(String(year)));
  const badgeRows = ub.length ? rows<{ id: string; nombre: string; icono: string | null }>(await client.from("badges").select("id, nombre, icono").in("id", ub.map((b) => b.badge_id))) : [];
  const badges = ub.map((b) => ({ ...badgeRows.find((r) => r.id === b.badge_id), unlocked_at: b.unlocked_at }))
    .filter((b): b is { id: string; nombre: string; icono: string | null; unlocked_at: string | null } => typeof (b as { nombre?: unknown }).nombre === "string");

  const expenses = rows<{ amount: number; currency: string | null; category: string | null; expense_date: string }>(expR);
  const multiCurrency = new Set(expenses.map((e) => String(e.currency || "MXN").toUpperCase())).size > 1;
  const [coords, fx] = await Promise.all([
    geocodeAll(client, geocodeQueries(yearTrips, profile?.ciudad_origen ?? null)),
    multiCurrency ? (deps.fx ?? fetchFxTable)().catch(() => null) : Promise.resolve(null),
  ]);

  const stats = computeWrapped({
    ...base,
    moments: moments.map((m) => ({ ...m, photoUrl: (m.image_path && momSigned.get(m.image_path)) || (m.image_path ? null : m.image_url) || null })),
    journal: journal.map((j) => ({ ...j, photoUrl: (j.photo_path && jouSigned.get(j.photo_path)) || null })),
    recuerdos: recuerdos.map((r) => ({ id: r.id, trip_id: r.trip_id, taken_on: r.taken_on, favorite: !!r.favorite, photoUrl: recSigned.get(r.storage_path) ?? null })),
    expenses,
    visits: rows(visR),
    visitedPlaces: rows(plcR),
    badges,
    companions: rows<{ name: string; shared_trips: number }>(compR).map((c) => ({ name: String(c.name ?? ""), shared_trips: Number(c.shared_trips) || 0 })),
    coords,
    fx,
  });
  return { stats, years };
}
