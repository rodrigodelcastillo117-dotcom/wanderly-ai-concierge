// Places API (New) - Photo proxy. Devuelve binario o JSON {url}.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { getAuthUser, unauthorizedResponse } from "../_shared/verify-auth.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const __user = await getAuthUser(req);
  if (!__user) return unauthorizedResponse(corsHeaders);


  try {
    const key = Deno.env.get("GOOGLE_MAPS_API_KEY");
    const lovableKey = Deno.env.get("LOVABLE_API_KEY");
    if (!key || !lovableKey) {
      return new Response(JSON.stringify({ error: "GOOGLE_MAPS_API_KEY no configurada" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const url = new URL(req.url);
    const ref = url.searchParams.get("ref") ?? "";
    const maxWidth = Math.min(Math.max(parseInt(url.searchParams.get("maxWidth") ?? "800", 10), 1), 4800);
    const maxHeight = url.searchParams.get("maxHeight")
      ? Math.min(Math.max(parseInt(url.searchParams.get("maxHeight")!, 10), 1), 4800)
      : null;
    const mode = url.searchParams.get("mode") ?? "binary"; // "binary" | "url"

    if (!ref) {
      return new Response(JSON.stringify({ error: "ref requerido (ej: places/XXX/photos/YYY)" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const params = new URLSearchParams({ maxWidthPx: String(maxWidth) });
    if (maxHeight) params.set("maxHeightPx", String(maxHeight));
    if (mode === "url") params.set("skipHttpRedirect", "true");

    const gUrl = `https://connector-gateway.lovable.dev/google_maps/places/v1/${ref}/media?${params.toString()}`;

    if (mode === "url") {
      const res = await fetch(gUrl, { headers: { "Authorization": `Bearer ${lovableKey}`, "X-Connection-Api-Key": key } });
      const data = await res.json();
      if (!res.ok) {
        return new Response(JSON.stringify({ error: data?.error?.message ?? "Photo error", raw: data }), {
          status: res.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ url: data.photoUri }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // binary stream
    const res = await fetch(gUrl, { headers: { "Authorization": `Bearer ${lovableKey}`, "X-Connection-Api-Key": key }, redirect: "follow" });
    if (!res.ok) {
      const txt = await res.text();
      return new Response(JSON.stringify({ error: "Photo fetch error", raw: txt }), {
        status: res.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const buf = await res.arrayBuffer();
    return new Response(buf, {
      headers: {
        ...corsHeaders,
        "Content-Type": res.headers.get("Content-Type") ?? "image/jpeg",
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message ?? "Error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
