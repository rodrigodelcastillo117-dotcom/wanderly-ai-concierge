// TripAdvisor Content API - búsqueda real de atracciones, hoteles y restaurantes
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { getAuthUser, unauthorizedResponse } from "../_shared/verify-auth.ts";
import { enforceRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";

const KEY = Deno.env.get("TRIPADVISOR_API_KEY");
const BASE = "https://api.content.tripadvisor.com/api/v1";

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
    if (!KEY) {
      return new Response(JSON.stringify({ error: "TRIPADVISOR_API_KEY no configurada" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const body = (await req.json()) as Body;
    if (!body?.query) {
      return new Response(JSON.stringify({ error: "query requerido" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const lang = body.language ?? "es_MX";
    const params = new URLSearchParams({
      key: KEY,
      searchQuery: body.query,
      language: lang,
    });
    if (body.category) params.set("category", body.category);

    const search = await getJSON(`${BASE}/location/search?${params.toString()}`);
    if (!search.ok) {
      return new Response(JSON.stringify({ error: "TripAdvisor error", detail: search.data }),
        { status: search.status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
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

    return new Response(JSON.stringify({ ok: true, results: enriched }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
