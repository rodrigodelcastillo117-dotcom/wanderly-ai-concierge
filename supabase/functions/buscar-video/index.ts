import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

const cache = new Map<string, { url: string; poster: string; ts: number }>();
const TTL = 1000 * 60 * 60 * 6; // 6h

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

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

    const apiKey = Deno.env.get('PEXELS_API_KEY');
    if (!apiKey) throw new Error('PEXELS_API_KEY not configured');

    const r = await fetch(
      `https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&per_page=5&orientation=landscape`,
      { headers: { Authorization: apiKey } },
    );
    if (!r.ok) throw new Error(`Pexels ${r.status}`);
    const data = await r.json();

    const video = data.videos?.[0];
    if (!video) {
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
