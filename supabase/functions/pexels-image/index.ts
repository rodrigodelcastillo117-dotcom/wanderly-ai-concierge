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

    // La caché compartida va ANTES del límite estricto: una foto ya guardada no gasta cuota de Pexels,
    // y contarla en los 30/min hacía que una pantalla con muchas ciudades conocidas (bienvenida,
    // lista de destinos) se quedara sin fotos por 429. Los aciertos tienen su propio límite, amplio.
    const store = dbCacheStore();
    const key = await cacheKey('pexels_photo', { query: query.toLowerCase() });
    const hit = await cacheGet(store, key);
    if (hit && freshnessOf(hit).fresh) {
      const rlHit = await enforceRateLimit(req, "pexels-image-hit", __user.id, { perMinute: 120, perHour: 1200, ipPerMinute: 240 });
      if (!rlHit.allowed) return rateLimitResponse(rlHit, corsHeaders);
      return new Response(JSON.stringify({ ...(hit.response as Record<string, unknown>), cached: true }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=86400' },
      });
    }

    const __rl = await enforceRateLimit(req, "pexels-image", __user.id, { perMinute: 30, perHour: 300, ipPerMinute: 80 });
    if (!__rl.allowed) return rateLimitResponse(__rl, corsHeaders);

    const res = await fetch(
      `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=1&orientation=landscape`,
      { headers: { Authorization: apiKey } },
    );
    // Pexels mismo puede fallar (cuota de 200/h o 20,000/mes de la llave, 5xx). Antes eso salía como
    // 200 con image:null, igual que "no hay foto": el navegador lo recordaba toda la sesión y la tarjeta
    // se quedaba vacía. Ahora: si hay copia vencida se sirve;
    // si no, 503 + Retry-After, que el cliente trata como temporal y vuelve a pedir más tarde.
    if (!res.ok) {
      const retry = Number(res.headers.get('Retry-After')) || 60;
      try { await res.body?.cancel(); } catch { /* sin cuerpo */ }
      if (hit?.response && (hit.response as { image?: unknown }).image) {
        return new Response(JSON.stringify({ ...(hit.response as Record<string, unknown>), cached: true, stale: true }), {
          status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=600' },
        });
      }
      return new Response(JSON.stringify({ image: null, upstream_error: true, upstream_status: res.status }), {
        status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Retry-After': String(Math.min(3600, Math.max(1, retry))) },
      });
    }
    const data = await res.json().catch(() => null);
    const photo = data?.photos?.[0];
    const image =
      photo?.src?.landscape ?? photo?.src?.large ?? photo?.src?.medium ?? null;
    // Crédito completo (guía de la API de Pexels): página de la foto y perfil del fotógrafo. Privé lo
    // muestra como "Foto ilustrativa · Pexels · <fotógrafo>". Los campos son nuevos y opcionales: lo
    // que ya estaba en caché sin ellos sigue sirviendo (el cliente enlaza a pexels.com).
    const safe = (u: unknown) => (typeof u === 'string' && u.startsWith('https://') ? u : null);
    const result = {
      image,
      photographer: photo?.photographer ?? null,
      photographer_url: safe(photo?.photographer_url),
      page_url: safe(photo?.url),
      alt: typeof photo?.alt === 'string' ? photo.alt.slice(0, 200) : null,
    };
    // Solo se guarda una respuesta válida de Pexels (también "sin foto": evita repetir la consulta).
    if (data && Array.isArray(data.photos)) {
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
