// supabase/functions/generate-avatar/index.ts
// 🎭 Generates an evolved cinematic Travel Avatar via Lovable AI image gen.
// Reads last trip + dominant DNA, builds a culture-aware prompt, calls
// google/gemini-2.5-flash-image, uploads to storage, persists URL in perfil_ia.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

type CultureProfile = {
  key: string; match: RegExp; label: string; vibe: string; outfit: string;
  accessory: string; background: string; lighting: string;
};

const CULTURES: CultureProfile[] = [
  { key: "france", match: /(francia|france|par[ií]s|paris)/i, label: "Parisian Elegance", vibe: "elegant Parisian luxury, haute couture", outfit: "tailored beige trench coat over cashmere knit, silk scarf", accessory: "holding a golden croissant", background: "cinematic Paris boulevard at golden hour, blurred Eiffel Tower silhouette, warm café lights bokeh", lighting: "warm amber café lighting, soft glow" },
  { key: "italy", match: /(italia|italy|roma|rome|milan|amalfi|venecia|venice|florence|florencia)/i, label: "Italian Riviera", vibe: "Italian summer dolce vita, Mediterranean luxury", outfit: "crisp linen shirt, designer sunglasses, sun-kissed glow", accessory: "espresso cup", background: "cinematic Amalfi coast cliffs, lemon trees, terracotta rooftops, deep blue sea at sunset", lighting: "warm Tuscan sunset" },
  { key: "japan", match: /(japon|japan|tokio|tokyo|kyoto|osaka)/i, label: "Neo-Tokyo", vibe: "futuristic minimal Tokyo, neon cyberpunk meets zen", outfit: "sleek black technical jacket, minimalist silhouette", accessory: "steaming ramen bowl reflection", background: "cinematic Shibuya neon streets, holographic signs, pink and cyan neon, light rain reflections", lighting: "neon magenta and cyan rim light" },
  { key: "mexico", match: /(mexico|méxico|cdmx|oaxaca|tulum|cancun|playa del carmen|guadalajara|merida)/i, label: "Mexican Soul", vibe: "vibrant Mexican cultural luxury, mezcal lounge energy", outfit: "embroidered linen shirt, woven artisan textures", accessory: "copita of mezcal", background: "cinematic Tulum jungle cenote with golden hour rays, bohemian luxury", lighting: "warm tropical sunset" },
  { key: "iceland", match: /(islandia|iceland|reykjavik)/i, label: "Arctic Explorer", vibe: "cinematic arctic adventure luxury", outfit: "premium technical parka with fur-lined hood", accessory: "thermal flask", background: "cinematic Iceland glacier landscape under aurora borealis, deep teal and purple sky", lighting: "cold blue moonlight with green aurora glow" },
  { key: "bali", match: /(bali|indonesia|ubud|seminyak)/i, label: "Bali Wellness", vibe: "tropical wellness luxury, spiritual sanctuary", outfit: "flowing linen kaftan, mala beads, serene expression", accessory: "tropical coconut and frangipani flowers", background: "cinematic Bali rice terraces at sunrise, mist over jungle, infinity pool reflection", lighting: "soft golden sunrise" },
  { key: "newyork", match: /(new york|nueva york|nyc|manhattan|brooklyn)/i, label: "Manhattan Nights", vibe: "Manhattan rooftop luxury sophisticated nightlife", outfit: "tailored black coat, silver accents", accessory: "crystal coupe with champagne", background: "cinematic NYC skyline from luxury rooftop, Empire State glow, blue hour", lighting: "cool blue city lights with warm rim" },
  { key: "spain", match: /(espa[nñ]a|spain|barcelona|madrid|sevilla|ibiza)/i, label: "Spanish Soul", vibe: "Mediterranean Spanish elegance", outfit: "warm linen and leather summer luxury", accessory: "glass of rioja", background: "cinematic Barcelona rooftop at sunset, Gaudí silhouettes, warm terracotta", lighting: "warm Mediterranean golden hour" },
  { key: "default", match: /.*/, label: "Global Traveler", vibe: "cinematic luxury wanderer, timeless premium identity", outfit: "tailored cashmere coat", accessory: "vintage leather journal", background: "cinematic luxury hotel suite with floor-to-ceiling windows, city skyline at blue hour", lighting: "soft golden interior with cool exterior contrast" },
];

function detectCulture(destino?: string | null, pais?: string | null): CultureProfile {
  const h = `${destino ?? ""} ${pais ?? ""}`.toLowerCase();
  return CULTURES.find(c => c.key !== "default" && c.match.test(h)) ?? CULTURES[CULTURES.length - 1];
}

const STYLE_HINTS: Record<string, string> = {
  food:      "gastronomic foodie energy, sophisticated taste",
  adventure: "adventurous explorer aura, rugged sophistication",
  cultural:  "intellectual cultural refinement, museum curator energy",
  luxury:    "ultra-premium aspirational luxury, old-money elegance",
  relax:     "wellness serenity, mindful luxury",
  nightlife: "social nightlife energy, confident charisma",
  hidden:    "curated underground explorer, refined taste",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey) return json({ error: "LOVABLE_API_KEY missing" }, 500);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "No autorizado" }, 401);

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: u } = await userClient.auth.getUser();
    if (!u?.user) return json({ error: "Sesión inválida" }, 401);
    const uid = u.user.id;

    const body = await req.json().catch(() => ({}));
    const overrideStyle: string | undefined = body?.style;
    const overrideDestino: string | undefined = body?.destino;
    const gender: string = body?.gender ?? "androgynous";
    const selfieDataUrl: string | undefined = body?.selfie;
    const builder: undefined | {
      gender?: string; skin?: string; hair_style?: string; hair_color?: string;
      outfit_style?: string; accessory?: string; dream_destination?: string;
      vibe?: string;
    } = body?.builder;


    // Pull signals
    const [{ data: prefs }, { data: profile }, { data: trips }] = await Promise.all([
      userClient.from("ai_user_preferences").select("perfil_ia, dna_version").eq("user_id", uid).maybeSingle(),
      userClient.from("profiles").select("full_name, nationality").eq("id", uid).maybeSingle(),
      userClient.from("trips").select("destino, pais_destino, created_at").eq("user_id", uid).order("created_at", { ascending: false }).limit(5),
    ]);

    const lastTrip = trips?.[0];
    const destino = overrideDestino ?? lastTrip?.destino ?? null;
    const pais = lastTrip?.pais_destino ?? null;
    const culture = detectCulture(destino, pais);
    const styleKey = overrideStyle ?? (prefs?.perfil_ia as any)?.estilo_dominante_key ?? "luxury";
    const styleHint = STYLE_HINTS[styleKey] ?? STYLE_HINTS.luxury;

    // Build a "travel journey" memory line so the avatar evolves with the user's trips
    const journey = (trips ?? [])
      .map(t => [t.destino, t.pais_destino].filter(Boolean).join(", "))
      .filter(Boolean);
    const journeyLine = journey.length
      ? `Traveler memory (subtle hints of past journeys in styling, accessories or souvenirs): ${journey.join(" • ")}.`
      : "";

    const FULL_BODY_RULES = `MANDATORY COMPOSITION: FULL BODY shot from head to toe. The ENTIRE body must be visible inside the frame — head, torso, hips, legs AND both feet/shoes fully in frame with comfortable margin above the head and below the shoes. Vertical 3:4 portrait, character standing in a confident natural pose, slight contrapposto, centered. DO NOT crop legs or feet. DO NOT zoom in on the face. Wide enough framing to show the complete outfit and footwear.`;

    const prompt = selfieDataUrl
      ? `Transform the person in this selfie into a stylized cartoon caricature luxury travel avatar — FULL BODY.
CRITICAL: Preserve the person's REAL identity — exact face structure, facial proportions, eye shape and color, eyebrows, smile, nose, jawline, hairstyle, facial hair, skin tone and unique features. The avatar must instantly resemble the real person.
Style: elegant premium cartoon caricature — high-end Disney/Pixar adult character design, luxury lifestyle illustration, modern editorial cartoon, NOT anime, NOT childish, NOT chibi. Sophisticated, aspirational.
Artistic direction: smooth rounded shapes, expressive stylized eyes, clean vector-like shading, painterly digital illustration texture, warm skin tones with soft gradients, premium fashion illustration aesthetic.
Cultural context: ${culture.vibe}. ${styleHint}.
Outfit (full ensemble visible top to bottom including shoes): ${culture.outfit} — modern luxury travel fashion, sophisticated minimalism.
Accessory: ${culture.accessory}.
Setting: ${culture.background}.
Lighting: ${culture.lighting}, cinematic soft luxury glow, elegant color harmony.
${journeyLine}
${FULL_BODY_RULES}
NO text, NO logos, NO watermarks, NO captions.`
      : `Premium cartoon caricature FULL BODY portrait of a single ${gender} luxury traveler standing confidently, looking into camera.
Style: elegant premium cartoon caricature — high-end Disney/Pixar adult character design, luxury lifestyle illustration, NOT anime, NOT childish. Sophisticated, aspirational.
Artistic direction: smooth rounded shapes, expressive stylized eyes, clean vector-like shading, painterly digital illustration texture, premium fashion illustration aesthetic.
Cultural vibe: ${culture.vibe}. ${styleHint}.
Outfit (head-to-toe, including shoes): ${culture.outfit}.
Accessory: ${culture.accessory}.
Setting: ${culture.background}.
Lighting: ${culture.lighting}, elegant color harmony.
${journeyLine}
${FULL_BODY_RULES}
Dark elegant background, gold and soft silver tones, NO text, NO logos, NO watermarks, NO captions.`;

    const userContent: any = selfieDataUrl
      ? [
          { type: "text", text: prompt },
          { type: "image_url", image_url: { url: selfieDataUrl } },
        ]
      : prompt;

    // Call Lovable AI image gen via chat completions (Gemini image model)
    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-image",
        messages: [{ role: "user", content: userContent }],
        modalities: ["image", "text"],
      }),
    });

    if (!aiResp.ok) {
      const txt = await aiResp.text();
      return json({ error: "ai_error", detail: txt }, 502);
    }
    const aiData = await aiResp.json();
    const msg = aiData?.choices?.[0]?.message;
    const imgUrl: string | undefined =
      msg?.images?.[0]?.image_url?.url ??
      msg?.images?.[0]?.url ??
      (typeof msg?.content === "string" ? null : null);

    if (!imgUrl || !imgUrl.startsWith("data:image")) {
      return json({ error: "no_image", raw: aiData }, 502);
    }

    // Decode base64 and upload to storage
    const [meta, b64] = imgUrl.split(",");
    const mime = meta.match(/data:(.*?);base64/)?.[1] ?? "image/png";
    const ext = mime.includes("jpeg") ? "jpg" : "png";
    const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const version = ((prefs?.dna_version ?? 1)) + 1;
    const path = `avatars/${uid}/v${version}-${Date.now()}.${ext}`;
    const { error: upErr } = await admin.storage.from("travel-moments").upload(path, bytes, {
      contentType: mime,
      upsert: true,
    });
    if (upErr) return json({ error: "upload_failed", detail: upErr.message }, 500);

    const { data: pub } = admin.storage.from("travel-moments").getPublicUrl(path);
    const publicUrl = pub.publicUrl;

    const avatar_meta = {
      culture: culture.key,
      culture_label: culture.label,
      style: styleKey,
      destino,
      pais,
      generated_at: new Date().toISOString(),
      version,
    };

    const newPerfil = { ...(prefs?.perfil_ia as any ?? {}), avatar_url: publicUrl, avatar_meta };
    await userClient.from("ai_user_preferences").upsert({
      user_id: uid, perfil_ia: newPerfil, dna_version: version, dna_updated_at: new Date().toISOString(),
    }, { onConflict: "user_id" });
    await userClient.from("travel_profiles").upsert({
      user_id: uid, perfil_ia: newPerfil,
    }, { onConflict: "user_id" });

    return json({ ok: true, url: publicUrl, meta: avatar_meta });
  } catch (e) {
    console.error("generate-avatar error:", e);
    return json({ error: String(e) }, 500);
  }
});

function json(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
