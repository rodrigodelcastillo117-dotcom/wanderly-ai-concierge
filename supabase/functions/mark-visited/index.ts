// Marca un Place como visitado: trae detalles, deduce cuisine, guarda en visited_places
// y dispara update-food-dna.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const CUISINE_BY_TYPE: Record<string, string> = {
  italian_restaurant: "italiana",
  pizza_restaurant: "italiana",
  japanese_restaurant: "japonesa",
  sushi_restaurant: "japonesa",
  ramen_restaurant: "japonesa",
  chinese_restaurant: "china",
  korean_restaurant: "coreana",
  thai_restaurant: "tailandesa",
  vietnamese_restaurant: "vietnamita",
  indian_restaurant: "india",
  mexican_restaurant: "mexicana",
  spanish_restaurant: "española",
  french_restaurant: "francesa",
  mediterranean_restaurant: "mediterránea",
  greek_restaurant: "griega",
  turkish_restaurant: "turca",
  lebanese_restaurant: "libanesa",
  middle_eastern_restaurant: "mediooriental",
  american_restaurant: "americana",
  hamburger_restaurant: "hamburguesas",
  steak_house: "carnes",
  barbecue_restaurant: "parrilla",
  seafood_restaurant: "mariscos",
  vegetarian_restaurant: "vegetariana",
  vegan_restaurant: "vegana",
  brazilian_restaurant: "brasileña",
  argentinian_restaurant: "argentina",
  peruvian_restaurant: "peruana",
  bakery: "panadería",
  cafe: "café",
  bar: "bar",
  ice_cream_shop: "postres",
  dessert_shop: "postres",
};

const NAME_HINTS: Array<[RegExp, string]> = [
  [/sushi|ramen|izakaya|sake|teppan/i, "japonesa"],
  [/taquer[íi]a|taco|cantina|antojer/i, "mexicana"],
  [/trattori|osteri|pizzer|pasta/i, "italiana"],
  [/marisquer[ií]a|ostion|cevicher/i, "mariscos"],
  [/parrill|asad|grill|steak|carnes/i, "carnes"],
  [/vegan|plant\s?based/i, "vegana"],
  [/vegetarian/i, "vegetariana"],
  [/burger|hamburgues/i, "hamburguesas"],
  [/falafel|kebab|shawarma/i, "mediooriental"],
  [/dim\s?sum|chino|wok/i, "china"],
  [/curry|tandoori|masala/i, "india"],
  [/pad\s?thai|tom\s?yum/i, "tailandesa"],
  [/cafeter|café|coffee/i, "café"],
  [/panader|bakery/i, "panadería"],
];

function detectCuisine(types: string[], primary: string | null, name: string | null): string | null {
  for (const t of [primary, ...types].filter(Boolean) as string[]) {
    if (CUISINE_BY_TYPE[t]) return CUISINE_BY_TYPE[t];
  }
  if (name) {
    for (const [re, c] of NAME_HINTS) if (re.test(name)) return c;
  }
  if (types.includes("restaurant")) return "internacional";
  return null;
}

const DETAILS_MASK = [
  "id",
  "displayName",
  "formattedAddress",
  "location",
  "rating",
  "userRatingCount",
  "priceLevel",
  "types",
  "primaryType",
  "googleMapsUri",
  "photos",
].join(",");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const key = Deno.env.get("GOOGLE_MAPS_API_KEY");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
    if (!key) {
      return new Response(JSON.stringify({ error: "GOOGLE_MAPS_API_KEY no configurada" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const authHeader = req.headers.get("Authorization") ?? "";
    const supabase = createClient(SUPABASE_URL, ANON, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: "No autenticado" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const user_id = userData.user.id;

    const body = await req.json().catch(() => ({}));
    const placeId: string = body.placeId;
    const tripId: string | null = body.tripId ?? null;
    const notes: string | null = body.notes ?? null;
    if (!placeId) {
      return new Response(JSON.stringify({ error: "placeId requerido" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 1) Place Details
    const dRes = await fetch(
      `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}?languageCode=es`,
      { headers: { "X-Goog-Api-Key": key, "X-Goog-FieldMask": DETAILS_MASK } },
    );
    const p = await dRes.json();
    if (!dRes.ok) {
      return new Response(JSON.stringify({ error: p?.error?.message ?? "Place details error" }), {
        status: dRes.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const name = p.displayName?.text ?? null;
    const types: string[] = p.types ?? [];
    const primary_type: string | null = p.primaryType ?? null;
    const cuisine = detectCuisine(types, primary_type, name);

    const row = {
      user_id,
      place_id: p.id,
      name,
      address: p.formattedAddress ?? null,
      lat: p.location?.latitude ?? null,
      lng: p.location?.longitude ?? null,
      types,
      primary_type,
      cuisine,
      price_level: p.priceLevel ?? null,
      rating: p.rating ?? null,
      ratings_count: p.userRatingCount ?? 0,
      photo_ref: p.photos?.[0]?.name ?? null,
      maps_url: p.googleMapsUri ?? null,
      status: "visited",
      visited_at: new Date().toISOString(),
      notes,
      raw: p,
    };

    // 2) Upsert (si estaba en wishlist se mueve a visited)
    const { error: upErr } = await supabase
      .from("visited_places")
      .upsert(row, { onConflict: "user_id,place_id" });
    if (upErr) {
      return new Response(JSON.stringify({ error: upErr.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 3) También registra en user_visits (DNA legacy) para compatibilidad
    if (tripId) {
      await supabase.from("user_visits").insert({
        user_id, trip_id: tripId, place_id: p.id, place_name: name,
        category: cuisine ?? primary_type ?? "lugar",
        lat: row.lat, lng: row.lng,
      });
    }

    // 4) Recalcular Food DNA (best-effort, no bloquea)
    try {
      await fetch(`${SUPABASE_URL}/functions/v1/update-food-dna`, {
        method: "POST",
        headers: { "Authorization": authHeader, "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
    } catch (_) { /* ignore */ }

    return new Response(JSON.stringify({ ok: true, place: row }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message ?? "Error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
