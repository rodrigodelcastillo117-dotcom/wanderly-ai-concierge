// Lugares reales con calificación y reseñas: TripAdvisor Content API y, si no está disponible
// (sin llave o llave rechazada), Google Maps vía SerpApi. Mismo formato de respuesta; `source`
// dice de dónde vino ("tripadvisor" | "google_maps").
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { getAuthUser, unauthorizedResponse } from "../_shared/verify-auth.ts";
import { enforceRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";

const KEY = Deno.env.get("TRIPADVISOR_API_KEY");
const SERP_KEY = Deno.env.get("SERPAPI_PRIVATE_KEY");
const BASE = "https://api.content.tripadvisor.com/api/v1";

const GOOGLE_QUERY: Record<string, string> = {
  attractions: "qué hacer en",
  restaurants: "restaurantes en",
  hotels: "hoteles en",
};

async function googleMapsSearch(body: Body) {
  const prefix = body.category ? GOOGLE_QUERY[body.category] ?? "" : "";
  const params = new URLSearchParams({
    engine: "google_maps",
    type: "search",
    q: `${prefix} ${body.query}`.trim(),
    hl: "es",
    api_key: SERP_KEY!,
  });
  const r = await getJSON(`https://serpapi.com/search.json?${params.toString()}`);
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

type Body = {
  query: string;
  category?: "hotels" | "attractions" | "restaurants" | "geos";
  language?: string;
  withDetails?: boolean;
};

async function getJSON(url: string) {
  const r = await fetch(url, { headers: { accept: "application/json", referer: "https://iatos-ai.lovable.app" } });
  const t = await r.text();
  try { return { ok: r.ok, status: r.status, data: JSON.parse(t) }; }
  catch { return { ok: false, status: r.status, data: { raw: t } }; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const __user = await getAuthUser(req);
  if (!__user) return unauthorizedResponse(corsHeaders);

  const __rl = await enforceRateLimit(req, "tripadvisor-search", __user.id, { perMinute: 15, perHour: 150, ipPerMinute: 50 });
  if (!__rl.allowed) return rateLimitResponse(__rl, corsHeaders);

  try {
    const body = (await req.json()) as Body;
    if (!body?.query) {
      return new Response(JSON.stringify({ error: "query requerido" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const googleFallback = async (reason: string, status: number, detail: unknown) => {
      if (SERP_KEY) {
        const places = await googleMapsSearch(body);
        if (places && places.length > 0) {
          return new Response(JSON.stringify({ ok: true, source: "google_maps", results: places }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
      }
      return new Response(JSON.stringify({ error: reason, detail }),
        { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    };

    if (!KEY) return googleFallback("TRIPADVISOR_API_KEY no configurada", 500, null);

    const lang = body.language ?? "es_MX";
    const params = new URLSearchParams({
      key: KEY,
      searchQuery: body.query,
      language: lang,
    });
    if (body.category) params.set("category", body.category);

    const search = await getJSON(`${BASE}/location/search?${params.toString()}`);
    if (!search.ok) {
      console.warn("tripadvisor-search: TripAdvisor", search.status, JSON.stringify(search.data).slice(0, 200));
      return googleFallback("TripAdvisor error", search.status, search.data);
    }

    const results = (search.data?.data ?? []).slice(0, 10);

    // Enrich top results with details + photos (limit to 5 to keep latency low)
    const enriched = await Promise.all(results.slice(0, 5).map(async (loc: any) => {
      const [details, photos] = await Promise.all([
        getJSON(`${BASE}/location/${loc.location_id}/details?key=${KEY}&language=${lang}`),
        getJSON(`${BASE}/location/${loc.location_id}/photos?key=${KEY}&language=${lang}&limit=3`),
      ]);
      return {
        id: loc.location_id,
        name: loc.name,
        address: loc.address_obj?.address_string ?? "",
        rating: details.data?.rating ?? null,
        num_reviews: details.data?.num_reviews ?? null,
        price_level: details.data?.price_level ?? null,
        ranking: details.data?.ranking_data?.ranking_string ?? null,
        web_url: details.data?.web_url ?? null,
        phone: details.data?.phone ?? null,
        website: details.data?.website ?? null,
        latitude: details.data?.latitude ?? null,
        longitude: details.data?.longitude ?? null,
        description: details.data?.description ?? null,
        photos: (photos.data?.data ?? []).map((p: any) => p.images?.large?.url).filter(Boolean),
        category: details.data?.category?.name ?? body.category ?? null,
      };
    }));

    return new Response(JSON.stringify({ ok: true, source: "tripadvisor", results: enriched }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
