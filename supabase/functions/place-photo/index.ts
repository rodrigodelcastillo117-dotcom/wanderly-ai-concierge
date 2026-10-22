// Places API (New) - Photo proxy. Devuelve binario o JSON {url}.
//
// Cómo se usa desde la app (Cercanos): POST con la sesión del usuario y {ref, maxWidth, mode:"url"};
// responde {url} con la dirección pública de la foto en googleusercontent (sin llave) y la app la
// pone en <img>. Antes la app ponía ESTA función directo en <img src>, pero un <img> no manda el
// header Authorization: la puerta de Supabase respondía 401 (JSON), Chrome lo bloqueaba (ORB) y la
// tarjeta quedaba como un bloque oscuro vacío.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { getAuthUser, unauthorizedResponse } from "../_shared/verify-auth.ts";
import { enforceRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";
import { isPhotoRef } from "../_shared/placePhotoRef.ts";
import { googleTransportFor } from "../_shared/google-runtime.ts";
import { dbCacheStore } from "../_shared/serpRuntime.ts";
import { resolvePlacePhoto } from "../_shared/place-photo-resolve.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const __user = await getAuthUser(req);
  if (!__user) return unauthorizedResponse(corsHeaders);

  const __rl = await enforceRateLimit(req, "place-photo", __user.id, { perMinute: 60, perHour: 600, ipPerMinute: 150 });
  if (!__rl.allowed) return rateLimitResponse(__rl, corsHeaders);


  try {
    const key = Deno.env.get("GOOGLE_MAPS_API_KEY");
    const lovableKey = Deno.env.get("LOVABLE_API_KEY");
    if (!key || !lovableKey) {
      return new Response(JSON.stringify({ error: "GOOGLE_MAPS_API_KEY no configurada" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Parámetros por query (GET) o por cuerpo JSON (POST, lo que manda supabase.functions.invoke).
    const url = new URL(req.url);
    let body: Record<string, unknown> = {};
    if (req.method === "POST") {
      try { body = (await req.json()) ?? {}; } catch { body = {}; }
    }
    const param = (k: string): string | null => {
      const v = body[k] ?? url.searchParams.get(k);
      return v == null ? null : String(v);
    };
    const ref = param("ref") ?? "";
    const maxWidth = Math.min(Math.max(parseInt(param("maxWidth") ?? "800", 10) || 800, 1), 4800);
    const maxHeight = param("maxHeight")
      ? Math.min(Math.max(parseInt(param("maxHeight")!, 10) || 800, 1), 4800)
      : null;
    const mode = param("mode") ?? "binary"; // "binary" | "url" | "resolve"

    // Lugar sin foto guardada (hotel del análisis, venue de Members, card del concierge): se busca su
    // ficha en Google y se devuelve {url} solo si el lugar encontrado se llama igual. Sin coincidencia
    // → {url:null} y la app usa una foto ilustrativa marcada como tal.
    if (mode === "resolve") {
      const t = googleTransportFor("place-photo", __user.id);
      if (!t) {
        return new Response(JSON.stringify({ url: null, reason: "no_disponible" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const out = await resolvePlacePhoto(t, {
        name: param("name"), city: param("city"), placeId: param("placeId"), maxWidth,
      }, dbCacheStore());
      return new Response(JSON.stringify(out), {
        headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "private, max-age=3600" },
      });
    }

    // Solo nombres de foto de Places ("places/<id>/photos/<id>"): `ref` va dentro de la URL del
    // conector con nuestra llave, así que nada de "../", "?" ni otros endpoints.
    if (!isPhotoRef(ref)) {
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
      return new Response(JSON.stringify({ url: typeof data?.photoUri === "string" ? data.photoUri : null }), {
        headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "private, max-age=3600" },
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
