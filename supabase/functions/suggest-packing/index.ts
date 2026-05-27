// suggest-packing — sugerencias inteligentes y personalizadas de packing
// basadas en destino, fechas, clima esperado, vuelos, crucero, hospedaje y actividades.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY no configurada");
    const { trip } = await req.json();
    if (!trip) {
      return new Response(JSON.stringify({ error: "trip requerido" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const ciudades = Array.isArray(trip.ciudades) ? trip.ciudades.join(", ") : "";
    const tieneCrucero = Array.isArray(trip.cruceros_json) && trip.cruceros_json.length > 0;
    const vuelos = Array.isArray(trip.vuelos_json) ? trip.vuelos_json.length : 0;
    const actividades = JSON.stringify(trip.tours_json ?? trip.itinerario_json ?? []).slice(0, 1500);

    const prompt = `Eres un asistente de viaje de lujo. Genera una LISTA DE EMPAQUE perfecta, específica y personalizada para este viaje. Devuelve JSON estricto con esta forma:

{
  "items": [
    { "text": "string corto y claro", "category": "Documentos|Ropa|Calzado|Higiene|Salud|Electrónicos|Playa|Frío|Outdoor|Ciudad|Crucero|Tropical|Personalizado" }
  ]
}

Reglas:
- 35 a 55 items en total, agrupados por categoría.
- Considera el clima esperado según fechas y ciudades.
- Cantidades concretas (ej. "Camisetas (5)", "Calcetines (8 pares)").
- Si hay crucero: incluye outfit smart casual para cena, traje de baño, pastillas para mareo, adaptadores.
- Si hay vuelos internacionales: pasaporte, copia digital, tarjeta sin cargos, almohada cervical, audífonos.
- Si hay ciudades europeas: zapatos cómodos para empedrado, paraguas plegable, candado TSA.
- Si hay playa/islas: protector solar reef-safe, after-sun, sandalias, sombrero.
- NUNCA inventes objetos absurdos. Sé práctico y premium.

DATOS DEL VIAJE:
- Destino: ${trip.destino ?? ""} (${trip.pais_destino ?? ""})
- Ciudades: ${ciudades}
- Fechas: ${trip.fecha_salida ?? ""} a ${trip.fecha_regreso ?? ""}
- Viajeros: ${trip.viajeros ?? 1}
- Vuelos: ${vuelos}
- Crucero: ${tieneCrucero ? "SÍ" : "NO"}
- Actividades/itinerario: ${actividades}`;

    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 60000);
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      signal: ctrl.signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${LOVABLE_API_KEY}` },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
      }),
    }).finally(() => clearTimeout(tid));

    if (!res.ok) {
      const t = await res.text();
      return new Response(JSON.stringify({ error: `gateway ${res.status}`, raw: t }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content ?? "{}";
    let parsed: any;
    try { parsed = JSON.parse(content); } catch {
      const m = content.match(/\{[\s\S]*\}/); parsed = m ? JSON.parse(m[0]) : {};
    }
    return new Response(JSON.stringify({ ok: true, items: parsed.items ?? [] }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
