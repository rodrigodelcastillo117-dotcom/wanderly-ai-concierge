import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { getAuthUser, unauthorizedResponse } from "../_shared/verify-auth.ts";
import { enforceRateLimit } from "../_shared/rate-limit.ts";
import { videoRateLimited } from "./rateLimited.ts";
import { cacheGet, cacheKey, cachePut, freshnessOf } from "../_shared/serpCache.ts";
import { dbCacheStore, logUsage } from "../_shared/serpRuntime.ts";

// Pexels permite 20,000 solicitudes al mes y esta función llegó a ~87 por usuario al día. Dos capas:
// la memoria de esta instancia (6 h) y la caché compartida en la base (public.serp_cache, 7 días),
// que sobrevive a reinicios y se comparte entre instancias y usuarios.
const cache = new Map<string, { url: string; poster: string; ts: number }>();
const TTL = 1000 * 60 * 60 * 6; // 6h

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const __user = await getAuthUser(req);
  if (!__user) return unauthorizedResponse(corsHeaders);

  const __rl = await enforceRateLimit(req, "buscar-video", __user.id, { perMinute: 15, perHour: 150, ipPerMinute: 50 });
  // Un video de portada es decorativo: al pasar el límite se responde 200 "sin video" con cuándo volver a
  // pedir (la tarjeta usa su imagen de respaldo). Un 429 dejaba un error rojo en la consola en cada
  // pantalla (auditoría técnica 10/10, P1-1). El cliente respeta retry_after (src/lib/videoSearch.ts).
  if (!__rl.allowed) return videoRateLimited(__rl.retryAfter, corsHeaders);


  try {
    const url = new URL(req.url);
    const query = (url.searchParams.get('q') ?? '').trim().slice(0, 80);
    if (!query) {
      return new Response(JSON.stringify({ error: 'missing q' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const key = query.toLowerCase();
    const hit = cache.get(key);
    if (hit && Date.now() - hit.ts < TTL) {
      return new Response(JSON.stringify({ url: hit.url, poster: hit.poster, cached: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const store = dbCacheStore();
    const sharedKey = await cacheKey('pexels_video', { q: key });
    const shared = await cacheGet(store, sharedKey);
    if (shared && freshnessOf(shared).fresh) {
      const v = shared.response as { url: string | null; poster: string | null };
      if (v?.url) cache.set(key, { url: v.url, poster: v.poster ?? '', ts: Date.now() });
      return new Response(JSON.stringify({ url: v?.url ?? null, poster: v?.poster ?? null, cached: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const apiKey = Deno.env.get('PEXELS_API_KEY');
    if (!apiKey) throw new Error('PEXELS_API_KEY not configured');

    const r = await fetch(
      `https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&per_page=5&orientation=landscape`,
      { headers: { Authorization: apiKey } },
    );
    if (!r.ok) throw new Error(`Pexels ${r.status}`);
    const data = await r.json();
    await logUsage({ user_id: __user.id, function: 'buscar-video', provider: 'pexels', searches: 0 });

    const video = data.videos?.[0];
    if (!video) {
      // "Sin video" también se guarda: evita repetir la misma consulta durante 7 días.
      await cachePut(store, sharedKey, 'pexels_video', { url: null, poster: null });
      return new Response(JSON.stringify({ url: null, poster: null }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // pick a reasonably sized hd/sd mp4 file
    const files = (video.video_files ?? []) as Array<{ link: string; quality: string; width: number; file_type: string }>;
    const pick =
      files.find((f) => f.file_type === 'video/mp4' && f.quality === 'hd' && f.width <= 1280) ??
      files.find((f) => f.file_type === 'video/mp4' && f.quality === 'sd') ??
      files.find((f) => f.file_type === 'video/mp4') ??
      files[0];

    const result = { url: pick?.link ?? null, poster: video.image ?? null };
    if (result.url) cache.set(key, { ...result, ts: Date.now() } as any);
    await cachePut(store, sharedKey, 'pexels_video', result);

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown';
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
