import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { getAuthUser, unauthorizedResponse } from "../_shared/verify-auth.ts";
import { enforceRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";
import { cacheGet, cacheKey, cachePut, freshnessOf } from "../_shared/serpCache.ts";
import { dbCacheStore, logUsage } from "../_shared/serpRuntime.ts";

// Pexels permite 20,000 solicitudes al mes: la foto de cada destino se guarda 7 días en la caché
// compartida (public.serp_cache), así todos los usuarios que ven "Roma" usan una sola consulta.

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const __user = await getAuthUser(req);
  if (!__user) return unauthorizedResponse(corsHeaders);

  const __rl = await enforceRateLimit(req, "pexels-image", __user.id, { perMinute: 30, perHour: 300, ipPerMinute: 80 });
  if (!__rl.allowed) return rateLimitResponse(__rl, corsHeaders);


  try {
    const url = new URL(req.url);
    let query = (url.searchParams.get('query') ?? '').trim();
    if (!query && (req.method === 'POST' || req.method === 'PUT')) {
      try {
        const body = await req.json();
        query = String(body?.query ?? '').trim();
      } catch { /* ignore */ }
    }
    query = query.slice(0, 100);
    if (!query) {
      return new Response(JSON.stringify({ error: 'query required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const apiKey = Deno.env.get('PEXELS_API_KEY');
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'PEXELS_API_KEY not configured' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const store = dbCacheStore();
    const key = await cacheKey('pexels_photo', { query: query.toLowerCase() });
    const hit = await cacheGet(store, key);
    if (hit && freshnessOf(hit).fresh) {
      return new Response(JSON.stringify({ ...(hit.response as Record<string, unknown>), cached: true }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=86400' },
      });
    }

    const res = await fetch(
      `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=1&orientation=landscape`,
      { headers: { Authorization: apiKey } },
    );
    const data = await res.json();
    const photo = data?.photos?.[0];
    const image =
      photo?.src?.landscape ?? photo?.src?.large ?? photo?.src?.medium ?? null;
    const result = { image, photographer: photo?.photographer ?? null };
    // Solo se guarda una respuesta válida de Pexels (también "sin foto": evita repetir la consulta).
    if (res.ok) {
      await cachePut(store, key, 'pexels_photo', result);
      await logUsage({ user_id: __user.id, function: 'pexels-image', provider: 'pexels', searches: 0 });
    }

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=86400',
      },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
