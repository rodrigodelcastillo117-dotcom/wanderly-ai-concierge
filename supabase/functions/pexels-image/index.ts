import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });


  // --- Auth gate: require valid Supabase JWT to prevent API quota abuse ---
  try {
    const __authHeader = req.headers.get("Authorization") ?? req.headers.get("authorization");
    if (!__authHeader) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const __serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const __token = __authHeader.replace(/^Bearer\s+/i, "");
    if (!__serviceKey || __token !== __serviceKey) {
      const __apikey = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const __ures = await fetch(`${Deno.env.get("SUPABASE_URL")}/auth/v1/user`, {
      headers: { Authorization: __authHeader, apikey: __apikey },
    });
    if (!__ures.ok) {
        return new Response(JSON.stringify({ error: "unauthorized" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }
  } catch (_e) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  // --- end auth gate ---
  try {
    const url = new URL(req.url);
    const query = (url.searchParams.get('query') ?? '').trim().slice(0, 100);
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

    const res = await fetch(
      `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=1&orientation=landscape`,
      { headers: { Authorization: apiKey } },
    );
    const data = await res.json();
    const photo = data?.photos?.[0];
    const image =
      photo?.src?.landscape ?? photo?.src?.large ?? photo?.src?.medium ?? null;

    return new Response(JSON.stringify({ image, photographer: photo?.photographer ?? null }), {
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
