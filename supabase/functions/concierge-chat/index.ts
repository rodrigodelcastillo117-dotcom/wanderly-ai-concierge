// supabase/functions/concierge-chat/index.ts
// Concierge IA ultra-lujo con TOOL CALLING real: vuelos, hoteles, atracciones,
// lugares cercanos. Aprende del usuario en cada turno (behavioral_insights + dna_signal).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!;
const FN_URL = `${SUPABASE_URL}/functions/v1`;
const AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

const SYSTEM = `Eres "IATOS AI Concierge", asistente de viaje ULTRA-LUJO 24/7 para clientes PRO (todos los usuarios son PRO). Tono cálido, refinado, breve, en español de México.

REGLAS DE ORO:
1. Cuando el usuario pida vuelos, hoteles, restaurantes, atracciones o lugares cercanos, **SIEMPRE** llama a la tool correspondiente para obtener datos reales. Nunca inventes precios, ratings ni horarios.
2. Después de obtener resultados, conviértelos en "cards" estructuradas. El campo "text" es solo tu voz humana corta (1-3 frases), nunca repitas datos de las cards ahí.
3. Si el usuario menciona equipaje → ofrece logistics card (Luggage Forward, AirPortr, LugLess).
4. Si menciona vuelo o First Class → considera jet card con empty-leg.
5. Si detectas urgencia → alert card.
6. Usa el contexto del viaje activo y la bóveda del usuario para hiper-personalizar.
7. Si llamas a una tool, espera el resultado antes de responder al usuario.

FORMATO DE RESPUESTA FINAL (cuando ya no necesites más tools, responde JSON válido):
{
  "text": "voz humana breve",
  "cards": [
    { "type": "flight", "title": "Aerolínea VUELO123", "subtitle": "MEX→CDG · 12h", "price_usd": 1234, "cta_label": "Reservar", "cta_action": "URL_REAL", "meta": "Salida 14:00" },
    { "type": "hotel", "title": "Four Seasons George V", "subtitle": "París · 5★", "price_usd": 1800, "rating": 9.4, "image_url": "URL", "cta_label": "Ver y reservar", "cta_action": "URL_BOOKING" },
    { "type": "restaurant", "title": "Pujol", "subtitle": "CDMX · Mexicana de autor", "rating": 4.8, "cta_label": "Reservar", "cta_action": "URL", "meta": "$$$$ · Reservación esencial" },
    { "type": "attraction", "title": "Louvre", "subtitle": "París", "rating": 4.7, "image_url": "URL", "cta_label": "Comprar entradas", "cta_action": "URL" },
    { "type": "transport", "title": "...", "subtitle": "...", "cta_label": "...", "cta_action": "URL" },
    { "type": "alert", "title": "...", "body": "..." },
    { "type": "luggage", "title": "Equipaje Invisible", "from": "...", "to": "...", "cta_label": "Cotizar" },
    { "type": "jet", "title": "Empty Leg G650", "route": "MEX→TEB", "price_usd": 24000, "fbo": "Atlantic Aviation", "cta_label": "Reservar" }
  ]
}`;

const TOOLS = [
  {
    type: "function",
    function: {
      name: "search_flights",
      description: "Busca vuelos reales en Google Flights con precios y deep-link de compra.",
      parameters: {
        type: "object",
        properties: {
          origin: { type: "string", description: "Ciudad o IATA de origen, ej. CDMX o MEX" },
          destination: { type: "string", description: "Ciudad o IATA de destino" },
          departure_date: { type: "string", description: "YYYY-MM-DD" },
          return_date: { type: "string", description: "YYYY-MM-DD (opcional)" },
          adults: { type: "integer", default: 1 },
        },
        required: ["origin", "destination", "departure_date"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_hotels",
      description: "Busca hoteles reales con precios, rating y link de Booking.",
      parameters: {
        type: "object",
        properties: {
          city: { type: "string" },
          checkin: { type: "string", description: "YYYY-MM-DD" },
          checkout: { type: "string", description: "YYYY-MM-DD" },
          adults: { type: "integer", default: 2 },
          hotel_class: { type: "string", description: "Ej. '5' para 5★ (opcional)" },
        },
        required: ["city", "checkin", "checkout"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_attractions",
      description: "Busca atracciones, restaurantes u hoteles en TripAdvisor con rating, reviews y fotos.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Ej. 'best michelin in Paris' o 'Louvre'" },
          category: { type: "string", enum: ["hotels", "attractions", "restaurants", "geos"] },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_nearby",
      description: "Busca lugares cercanos por coordenadas (restaurantes, farmacias, hospitales, cajeros, gasolineras, hoteles).",
      parameters: {
        type: "object",
        properties: {
          lat: { type: "number" },
          lng: { type: "number" },
          kind: { type: "string", enum: ["restaurant", "hospital", "police", "pharmacy", "atm", "embassy", "gas_station", "lodging"] },
          keyword: { type: "string", description: "Filtro adicional (ej. 'sushi omakase')" },
        },
        required: ["lat", "lng", "kind"],
      },
    },
  },
];

async function callTool(name: string, args: any, authHeader: string): Promise<any> {
  const map: Record<string, string> = {
    search_flights: "flights-search",
    search_hotels: "hotels-search",
    search_attractions: "tripadvisor-search",
    search_nearby: "places-nearby",
  };
  const fn = map[name];
  if (!fn) return { error: `tool ${name} desconocida` };
  try {
    const r = await fetch(`${FN_URL}/${fn}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: authHeader, apikey: SUPABASE_ANON_KEY },
      body: JSON.stringify(args),
    });
    const j = await r.json().catch(() => ({ error: "json parse" }));
    // recortar para no saturar contexto
    const slim = JSON.stringify(j).slice(0, 6000);
    return JSON.parse(slim.endsWith("}") || slim.endsWith("]") ? slim : slim + '"...truncated"}');
  } catch (e: any) {
    return { error: e?.message ?? "tool fetch error" };
  }
}

async function logInsight(supabase: any, userId: string, userMsg: string, toolsUsed: string[]) {
  try {
    await supabase.from("behavioral_insights").insert({
      user_id: userId,
      action: "concierge_message",
      target_type: toolsUsed.length ? "tool_call" : "chat",
      target_label: toolsUsed.join(",") || userMsg.slice(0, 80),
      metadata: { msg: userMsg.slice(0, 500), tools: toolsUsed },
    });
    // refresh dna_signal: increment categories implied by tools
    if (toolsUsed.length) {
      const { data: prefs } = await supabase
        .from("ai_user_preferences").select("dna_signal").eq("user_id", userId).maybeSingle();
      const sig = (prefs?.dna_signal ?? {}) as any;
      const cats = sig.categories ?? {};
      for (const t of toolsUsed) {
        const cat = t.replace("search_", "");
        cats[cat] = (cats[cat] ?? 0) + 1;
      }
      sig.categories = cats;
      sig.last_concierge_at = new Date().toISOString();
      await supabase.from("ai_user_preferences").upsert(
        { user_id: userId, dna_signal: sig, dna_updated_at: new Date().toISOString() },
        { onConflict: "user_id" },
      );
    }
  } catch (e) {
    console.warn("logInsight failed", e);
  }
}

interface Body {
  messages: { role: "user" | "assistant"; content: string }[];
  god_mode?: boolean;
  context?: { destino?: string; fechas?: string; coords?: { lat: number; lng: number }; place?: string };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: "LOVABLE_API_KEY no configurada" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
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

    const body = (await req.json()) as Body;
    const lastUserMsg = [...(body.messages ?? [])].reverse().find((m) => m.role === "user")?.content ?? "";

    // Carga contexto: viaje activo, bóveda, dna
    const [{ data: trip }, { data: vault }, { data: prefs }] = await Promise.all([
      supabase.from("trips")
        .select("destino, pais_destino, ciudad_origen, fecha_salida, fecha_regreso, num_viajeros, presupuesto_objetivo")
        .eq("user_id", u.user.id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("user_vault_benefits").select("*").eq("user_id", u.user.id).maybeSingle(),
      supabase.from("ai_user_preferences").select("*").eq("user_id", u.user.id).maybeSingle(),
    ]);

    const vaultLines: string[] = [];
    if (vault?.credit_cards?.length) vaultLines.push("Tarjetas: " + vault.credit_cards.map((c: any) => `${c.bank} ${c.card_tier}`).join("; "));
    if (vault?.airline_alliances?.length) vaultLines.push("Aerolíneas: " + vault.airline_alliances.map((a: any) => `${a.airline} ${a.tier_status}`).join("; "));
    if (vault?.hotel_loyalty?.length) vaultLines.push("Hoteles: " + vault.hotel_loyalty.map((h: any) => `${h.chain_name} ${h.status_tier}`).join("; "));

    const dnaLines: string[] = [];
    if (prefs?.estilo_comida?.length) dnaLines.push("Comida: " + prefs.estilo_comida.join(", "));
    if (prefs?.actividades_tarde?.length) dnaLines.push("Intereses: " + prefs.actividades_tarde.join(", "));
    if (prefs?.ritmo_viaje) dnaLines.push("Ritmo: " + prefs.ritmo_viaje);
    if (prefs?.nivel_presupuesto) dnaLines.push("Presupuesto: " + prefs.nivel_presupuesto);
    if (prefs?.hospedaje_preferencias?.length) dnaLines.push("Hospedaje: " + prefs.hospedaje_preferencias.join(", "));
    if (prefs?.restricciones_alimentarias?.length) dnaLines.push("Restricciones: " + prefs.restricciones_alimentarias.join(", "));

    const contextoStr = [
      `Viaje activo: ${trip ? `${trip.destino} (${trip.fecha_salida ?? "?"} a ${trip.fecha_regreso ?? "?"}, ${trip.num_viajeros ?? 1} pax, presupuesto ~$${trip.presupuesto_objetivo ?? "?"} MXN, sale de ${trip.ciudad_origen ?? "?"})` : "ninguno"}.`,
      `Bóveda: ${vaultLines.join(" | ") || "vacía"}.`,
      `DNA de viajero: ${dnaLines.join(" | ") || "todavía aprendiendo"}.`,
      body.context?.coords ? `Ubicación actual aprox: ${body.context.coords.lat.toFixed(4)}, ${body.context.coords.lng.toFixed(4)}.` : "",
      body.god_mode ? "MODO: GOD MODE — caza reservas imposibles, upgrades premium, mesas Michelin sold-out, empty-legs." : "",
    ].filter(Boolean).join("\n");

    // Conversación con tool-calling loop
    const messages: any[] = [
      { role: "system", content: SYSTEM },
      { role: "system", content: contextoStr },
      ...body.messages.slice(-10),
    ];

    const toolsUsed: string[] = [];
    let finalText = "";
    for (let i = 0; i < 4; i++) {
      const res = await fetch(AI_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Lovable-API-Key": LOVABLE_API_KEY },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages,
          tools: TOOLS,
          tool_choice: "auto",
        }),
      });
      if (!res.ok) {
        const t = await res.text();
        if (res.status === 429) return new Response(JSON.stringify({ error: "Demasiadas solicitudes, intenta en un momento." }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        if (res.status === 402) return new Response(JSON.stringify({ error: "Sin créditos de IA. Recarga en Settings → Workspace." }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        return new Response(JSON.stringify({ error: `AI gateway ${res.status}`, detail: t }), { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const data = await res.json();
      const msg = data?.choices?.[0]?.message;
      if (!msg) break;

      if (msg.tool_calls?.length) {
        messages.push(msg);
        for (const tc of msg.tool_calls) {
          const args = (() => { try { return JSON.parse(tc.function.arguments ?? "{}"); } catch { return {}; } })();
          toolsUsed.push(tc.function.name);
          const out = await callTool(tc.function.name, args, authHeader);
          messages.push({
            role: "tool",
            tool_call_id: tc.id,
            content: JSON.stringify(out).slice(0, 8000),
          });
        }
        continue;
      }

      finalText = msg.content ?? "";
      // Forzar JSON: pedir reformat si no es JSON válido
      try { JSON.parse(finalText); } catch {
        const m = finalText.match(/\{[\s\S]*\}/);
        finalText = m ? m[0] : JSON.stringify({ text: finalText, cards: [] });
      }
      break;
    }

    // Log para aprendizaje
    logInsight(supabase, u.user.id, lastUserMsg, toolsUsed).catch(() => {});

    if (!finalText) finalText = JSON.stringify({ text: "Estoy procesando demasiada información, intenta de nuevo.", cards: [] });

    let parsed: any;
    try { parsed = JSON.parse(finalText); }
    catch { parsed = { text: finalText, cards: [] }; }
    parsed._tools_used = toolsUsed;

    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("concierge-chat error", e);
    return new Response(JSON.stringify({ error: e?.message ?? "Error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
