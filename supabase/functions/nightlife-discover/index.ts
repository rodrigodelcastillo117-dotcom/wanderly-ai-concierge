// supabase/functions/nightlife-discover/index.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const PERPLEXITY_API_KEY = Deno.env.get("PERPLEXITY_API_KEY");
const MASTER_PROMPT_IATOS = (Deno.env.get("MASTER_PROMPT_IATOS") ?? "").trim();
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!;

const MIN_VENUES = 6;
const CATEGORIAS = ["cabaret","burlesque","members_club","speakeasy","rooftop","casino_vip","jazz_lounge","evento_vip"];

const SYSTEM_PROMPT = `Eres un curador de vida nocturna PREMIUM para viajeros HNW. Estructuras venues app-store-friendly.

CATEGORÍAS PERMITIDAS (estricto):
- cabaret (Crazy Horse, Moulin Rouge, Lido)
- burlesque (The Box, Slipper Room — artístico sofisticado)
- members_club (Annabel's, Soho House, Loulou's, Silencio, Berghain)
- speakeasy (bares ocultos de coctelería de autor)
- rooftop (rooftop bars premium)
- casino_vip (high-roller rooms en casinos top)
- jazz_lounge (clubs de jazz, lounges con música en vivo)
- evento_vip (eventos recurrentes exclusivos: F1 paddock, Art Basel parties)

PROHIBIDO (nunca incluir):
- Strip clubs, gentlemen's clubs, adult clubs.
- Masajes, servicios de acompañamiento, servicios sexuales.
- Cualquier venue cuyo propósito principal sea contenido sexual explícito.

Devuelve JSON válido sin markdown:
{
  "venues": [
    { "categoria":"...", "nombre":"...", "descripcion":"...", "por_que":"...",
      "direccion":"...", "dress_code":"...", "precio_estimado":"$$$|$$$$|Por invitación",
      "reserva_requerida":true, "rating":4.5, "tags":["..."], "contacto":"web o tel" }
  ]
}`;

interface Body { ciudad: string; pais?: string; }

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "No autorizado" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: u } = await supabase.auth.getUser();
    if (!u?.user) {
      return new Response(JSON.stringify({ error: "Sesión inválida" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verificar gate 18+
    const { data: access } = await supabase
      .from("nightlife_access").select("confirmed_adult").eq("user_id", u.user.id).maybeSingle();
    if (!access?.confirmed_adult) {
      return new Response(JSON.stringify({
        error: "gate_required",
        mensaje: "Debes aceptar el disclaimer de contenido para adultos (18+) antes de acceder.",
      }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const body = (await req.json()) as Body;
    if (!body.ciudad) {
      return new Response(JSON.stringify({ error: "ciudad requerida" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 1. ¿Ya hay suficientes en DB?
    const { data: existentes } = await supabase
      .from("nightlife_premium")
      .select("*")
      .ilike("ciudad", body.ciudad)
      .eq("active", true)
      .order("rating", { ascending: false });

    if ((existentes?.length ?? 0) >= MIN_VENUES) {
      return new Response(JSON.stringify({ ciudad: body.ciudad, venues: existentes, fuente: "cache" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2. Descubrir con Perplexity
    if (!PERPLEXITY_API_KEY || !ANTHROPIC_API_KEY) {
      return new Response(JSON.stringify({ ciudad: body.ciudad, venues: existentes ?? [], fuente: "cache_parcial",
        mensaje: "Curaduría parcial (faltan claves de IA)." }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const ppxQuery = `Investiga los venues de vida nocturna PREMIUM más reconocidos en ${body.ciudad}${body.pais ? `, ${body.pais}` : ""} en estas categorías SOLAMENTE: cabarets de clase mundial (Crazy Horse, Moulin Rouge), burlesque sofisticado (The Box, Slipper Room), members-only clubs (Annabel's, Soho House, Loulou's), speakeasies y bares de coctelería de autor, rooftop bars premium, casinos VIP / high-roller rooms, jazz lounges, eventos VIP recurrentes.

NO incluyas strip clubs, gentlemen's clubs, ni venues de servicios sexuales.

Para cada uno: nombre exacto, dirección, dress code, precio estimado, si requiere reserva, web/contacto, rating, descripción premium.`;

    const ppxRes = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${PERPLEXITY_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "sonar-pro",
        messages: [
          { role: "system", content: "Eres un curador de nightlife premium. Datos reales, en español." },
          { role: "user", content: ppxQuery },
        ],
        temperature: 0.2,
        max_tokens: 3500,
      }),
    });
    if (!ppxRes.ok) {
      return new Response(JSON.stringify({ error: "perplexity_error", venues: existentes ?? [] }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const ppxData = await ppxRes.json();
    const investigacion = ppxData?.choices?.[0]?.message?.content ?? "";

    // 3. Claude estructura el JSON (con master prompt + system específico)
    const systemFinal = [MASTER_PROMPT_IATOS, SYSTEM_PROMPT].filter(Boolean).join("\n\n---\n\n");

    const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 4000,
        temperature: 0,
        system: systemFinal,
        messages: [{
          role: "user",
          content: `Ciudad: ${body.ciudad}${body.pais ? `, ${body.pais}` : ""}\n\nINVESTIGACIÓN:\n${investigacion}\n\nEstructura los venues premium en JSON. Excluye estrictamente strip clubs, adult clubs, o servicios sexuales.`,
        }],
      }),
    });
    if (!claudeRes.ok) {
      return new Response(JSON.stringify({ error: "claude_error", venues: existentes ?? [] }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const claudeData = await claudeRes.json();
    const textBlock = (claudeData.content ?? []).find((b: any) => b.type === "text");
    const raw = textBlock?.text ?? "{}";
    let parsed: any = { venues: [] };
    try { parsed = JSON.parse(raw); }
    catch { const m = raw.match(/\{[\s\S]*\}/); if (m) parsed = JSON.parse(m[0]); }

    // 4. Filtrar categorías permitidas + insertar
    const venuesValidos = (parsed.venues ?? [])
      .filter((v: any) => v?.nombre && CATEGORIAS.includes(v?.categoria))
      .map((v: any) => ({
        ciudad: body.ciudad,
        pais: body.pais ?? null,
        categoria: v.categoria,
        nombre: v.nombre,
        descripcion: v.descripcion ?? null,
        por_que: v.por_que ?? null,
        address: v.direccion ?? null,
        dress_code: v.dress_code ?? null,
        precio_estimado: v.precio_estimado ?? null,
        reserva_requerida: v.reserva_requerida ?? true,
        website: v.contacto ?? null,
        rating: typeof v.rating === "number" ? v.rating : null,
        tags: Array.isArray(v.tags) ? v.tags : [],
      }));

    if (venuesValidos.length > 0) {
      await supabase.from("nightlife_premium").insert(venuesValidos);
    }

    const { data: finales } = await supabase
      .from("nightlife_premium")
      .select("*")
      .ilike("ciudad", body.ciudad)
      .eq("active", true)
      .order("rating", { ascending: false });

    return new Response(JSON.stringify({
      ciudad: body.ciudad,
      venues: finales ?? [],
      nuevos: venuesValidos.length,
      fuente: "ai+cache",
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (e: any) {
    console.error("nightlife-discover error:", e);
    return new Response(JSON.stringify({ error: e?.message ?? "Error desconocido" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
