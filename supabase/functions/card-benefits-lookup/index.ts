// card-benefits-lookup — dado el nombre de un banco/tarjeta (libre, en cualquier formato:
// "amex", "AMEX", "American Express Platinum", "Visa Santander Aeroméxico"), devuelve
// las tarjetas que coinciden con sus beneficios reales (salas VIP, seguros, millas, etc.).

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

const SYSTEM = `Eres un experto en tarjetas de crédito y débito de viaje a nivel mundial (American Express, Visa, Mastercard, Santander, BBVA, Banorte, Citibanamex, HSBC, Scotiabank, Chase, Capital One, Bank of America, Wells Fargo, Barclays, etc.).

Te darán una búsqueda libre (puede venir mal escrita o en minúsculas: "amex", "santander", "platinum chase"). Devuelve hasta 6 tarjetas REALES que coincidan, con sus beneficios actuales de viaje.

Formato JSON estricto:
{
  "cards": [
    {
      "bank": string,                       // "American Express"
      "card_name": string,                  // "The Platinum Card®"
      "card_tier": string,                  // "Platino" / "Black" / "Infinite" / "Oro" / "Clásica"
      "network": string,                    // "Amex" / "Visa" / "Mastercard"
      "region": string,                     // "México" / "USA" / "Global"
      "annual_fee_mxn": number|null,
      "perks_enabled": string[],            // ["Acceso a salas VIP", "Seguro de viaje", "Concierge", "Maleta extra gratis", ...]
      "lounge_access": string[],            // ["Centurion Lounge", "Priority Pass", "Salones Premier"]
      "insurance": string[],                // ["Seguro médico de viaje USD 1M", "Protección de compras", "Rentas de auto"]
      "miles_program": string|null,         // "Membership Rewards"
      "extras": string[]                    // ["Global Entry/TSA credit", "Hotel status Hilton Gold", "Uber credit"]
    }
  ]
}

Solo JSON, sin markdown. Si la búsqueda es muy vaga ("visa"), devuelve las tarjetas más populares de esa red. Beneficios precisos y reales, no inventados.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

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
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY no configurada");
    const { query } = await req.json();
    if (!query || typeof query !== "string") {
      return new Response(JSON.stringify({ error: "query requerido" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 30000);

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      signal: ctrl.signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${LOVABLE_API_KEY}` },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: `Búsqueda del usuario: "${query}". Devuelve hasta 6 tarjetas reales que coincidan con sus beneficios actuales para viaje.` },
        ],
        response_format: { type: "json_object" },
      }),
    }).finally(() => clearTimeout(tid));

    if (!res.ok) {
      const text = await res.text();
      return new Response(JSON.stringify({ error: `AI ${res.status}`, raw: text }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content ?? "{}";
    let parsed: any;
    try { parsed = JSON.parse(content); }
    catch { const m = content.match(/\{[\s\S]*\}/); parsed = m ? JSON.parse(m[0]) : {}; }
    return new Response(JSON.stringify({ ok: true, cards: parsed.cards ?? [] }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
