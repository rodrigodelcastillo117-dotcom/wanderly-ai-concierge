// Lugares reales con calificación y reseñas: Tripadvisor Terra (plan Discover, la Content API vieja
// se retiró el 31-ago-2026) y, si no está disponible (sin llave, rechazo 401/402/403/429, tope de
// gasto, sin resultados en la allowlist o llamada que no viene de una pantalla), Google Places API
// (New) con la llave del servidor; SerpApi (Google Maps) queda como último recurso porque su bolsa
// es escasa y la comparten vuelos y hoteles. Mismo formato de respuesta; `source` dice de dónde vino
// ("tripadvisor" | "google_places" | "google_maps").
//
// Gasto (cada entidad de Terra cuesta después de las 1,000 gratis de por vida):
//   - Solo con { uso: "pantalla" } (una persona tocó un botón): análisis, logística y concierge van
//     directo a Google (los términos de Tripadvisor además prohíben usar su contenido con IA).
//   - Una búsqueda = hasta TRIPADVISOR_SEARCH_SIZE entidades (5); ya trae calificación, reseñas,
//     enlace y coordenadas: no se enriquece nada. Fotos solo con { action: "fotos", location_id }
//     del lugar que la persona abre (1 entidad).
//   - Tope global TRIPADVISOR_DAILY_ENTITIES (200) en 24 h y TRIPADVISOR_USER_DAILY_CALLS (20) por
//     persona, con check_rate_limit (falla cerrada). Cada llamada cobrable va a ai_usage_log.
//   - Sin caché del contenido: la política de Terra solo permite guardar el Location ID.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { getAuthUser, unauthorizedResponse } from "../_shared/verify-auth.ts";
import { enforceRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";
import { adminClient } from "../_shared/entitlements.ts";
import { dbCacheStore, logUsage, serpFetchFor } from "../_shared/serpRuntime.ts";
import { cacheKey, freshnessOf } from "../_shared/serpCache.ts";
import { googleTransportFor } from "../_shared/google-runtime.ts";
import { callError } from "../_shared/google-maps.ts";
import { CATEGORY_SEARCH, placeCard, rankByQuality, searchText } from "../_shared/google-places.ts";
import { type HitFn, terraConfig } from "../_shared/tripadvisor-terra.ts";
import { handleSearch, type Out, type SearchBody } from "./core.ts";

const KEY = Deno.env.get("TRIPADVISOR_API_KEY");
const SERP_KEY = Deno.env.get("SERPAPI_PRIVATE_KEY");
const CONFIG = terraConfig((k) => Deno.env.get(k));

const GOOGLE_QUERY: Record<string, string> = {
  attractions: "qué hacer en",
  restaurants: "restaurantes en",
  hotels: "hoteles en",
};

async function googleMapsSearch(body: SearchBody, doFetch: typeof fetch = fetch) {
  const prefix = body.category ? GOOGLE_QUERY[body.category] ?? "" : "";
  const params = new URLSearchParams({
    engine: "google_maps",
    type: "search",
    q: `${prefix} ${body.query}`.trim(),
    hl: "es",
    api_key: SERP_KEY!,
  });
  const r = await getJSON(`https://serpapi.com/search.json?${params.toString()}`, doFetch);
  if (!r.ok) return null;
  const places = (r.data?.local_results ?? []) as any[];
  return places
    .filter((p) => p?.title)
    .sort((a, b) => (Number(b.reviews ?? 0) - Number(a.reviews ?? 0)))
    .slice(0, 10)
    .map((p) => ({
      id: p.place_id ?? p.data_id ?? p.title,
      name: p.title,
      address: p.address ?? "",
      rating: p.rating ?? null,
      num_reviews: p.reviews ?? null,
      price_level: p.price ?? null,
      ranking: null,
      web_url: p.place_id
        ? `https://www.google.com/maps/place/?q=place_id:${p.place_id}`
        : `https://www.google.com/maps/search/${encodeURIComponent(`${p.title} ${body.query}`)}`,
      phone: p.phone ?? null,
      website: p.website ?? null,
      latitude: p.gps_coordinates?.latitude ?? null,
      longitude: p.gps_coordinates?.longitude ?? null,
      description: p.description ?? null,
      photos: p.thumbnail ? [p.thumbnail] : [],
      category: p.type ?? body.category ?? null,
    }));
}

async function getJSON(url: string, doFetch: typeof fetch = fetch) {
  const r = await doFetch(url, { headers: { accept: "application/json", referer: "https://traveliatos.life" } });
  const t = await r.text();
  try { return { ok: r.ok, status: r.status, data: JSON.parse(t) }; }
  catch { return { ok: false, status: r.status, data: { raw: t } }; }
}

/** check_rate_limit (atómica, solo service_role). null = no se pudo verificar. */
const hit: HitFn = async (subject, bucket, rule) => {
  try {
    const { data, error } = await adminClient().rpc("check_rate_limit", {
      _subject: subject, _bucket: bucket, _limit: rule.limit, _window_seconds: rule.windowSeconds,
    });
    if (error) { console.error("check_rate_limit error:", error.message); return null; }
    const allowed = (data as { allowed?: unknown } | null)?.allowed;
    return typeof allowed === "boolean" ? allowed : null;
  } catch (e) {
    console.error("check_rate_limit exception:", (e as Error).message);
    return null;
  }
};

// Bandera de pausa propia en serp_cache (no es contenido de Tripadvisor): tras un 401/402/403/429
// nadie vuelve a llamar a Terra durante unos minutos.
const PAUSE_ENGINE = "tripadvisor_terra_pausa";
const pauseKey = () => cacheKey(PAUSE_ENGINE, { flag: "pausa" });
const store = dbCacheStore();
const paused = async () => {
  try {
    const row = await store.get(await pauseKey());
    return !!row && freshnessOf(row).fresh;
  } catch { return false; }
};
const pause = async (seconds: number, status: number | null) => {
  try { await store.put(await pauseKey(), PAUSE_ENGINE, { http: status, desde: new Date().toISOString() }, seconds); }
  catch (e) { console.warn("tripadvisor-search: no se pudo guardar la pausa", (e as Error)?.message); }
};

const respond = (o: Out) =>
  new Response(JSON.stringify(o.body), { status: o.status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const __user = await getAuthUser(req);
  if (!__user) return unauthorizedResponse(corsHeaders);

  const __rl = await enforceRateLimit(req, "tripadvisor-search", __user.id, { perMinute: 15, perHour: 150, ipPerMinute: 50 });
  if (!__rl.allowed) return rateLimitResponse(__rl, corsHeaders);

  try {
    const body = ((await req.json().catch(() => null)) ?? {}) as SearchBody;

    const googleFallback = async (reason: string, status: number, detail: unknown): Promise<Out> => {
      // 1) Google Places (New): datos de Google con la llave del servidor (Text Search Enterprise,
      //    1,000 gratis al mes); no gasta la bolsa de SerpApi.
      const transport = body.category === "geos" ? null : googleTransportFor("tripadvisor-search", __user.id);
      if (transport) {
        const cat = CATEGORY_SEARCH[body.category ?? "attractions"] ?? CATEGORY_SEARCH.attractions;
        const r = await searchText(transport, {
          query: `${cat.prefix} ${body.query}`,
          includedType: cat.includedType,
          language: "es",
          maxResults: 15,
          preset: "rich",
        });
        if (r.ok && r.places.length > 0) {
          const results = rankByQuality(r.places).slice(0, 10).map((p) => placeCard(p, body.category ?? null));
          return { status: 200, body: { ok: true, source: "google_places", consulted_at: r.consultado_at, atribucion: "Google Maps", tripadvisor_motivo: reason, results } };
        }
        if (!r.ok) console.warn("tripadvisor-search: Google Places", callError(r).kind, callError(r).message);
      }
      // 2) Último recurso: Google Maps vía SerpApi con la caché compartida (7 días; datos de Google).
      if (SERP_KEY) {
        const places = await googleMapsSearch(body, serpFetchFor("tripadvisor-search", __user.id).fetch);
        if (places && places.length > 0) {
          return { status: 200, body: { ok: true, source: "google_maps", tripadvisor_motivo: reason, results: places } };
        }
      }
      return { status, body: { error: reason, detail } };
    };

    return respond(await handleSearch(body, {
      fetchImpl: fetch,
      apiKey: KEY,
      userId: __user.id,
      config: CONFIG,
      hit,
      logUsage: (row) => logUsage(row),
      paused,
      pause,
      fallback: googleFallback,
    }));
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
