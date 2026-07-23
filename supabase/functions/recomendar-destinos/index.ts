// supabase/functions/recomendar-destinos/index.ts
// Genera destinos personalizados según el ADN de viaje del usuario.
// Usa: travel_profiles + ai_user_preferences + profiles + viajes pasados.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { getAuthUser, unauthorizedResponse } from "../_shared/verify-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const SYSTEM = `Eres el curador senior de IATOS AI, una plataforma de viajes premium. Tu trabajo es recomendar 8 destinos del mundo HIPER-PERSONALIZADOS al perfil de un viajero específico.

REGLA DE ORO: cada usuario debe recibir destinos DISTINTOS basados en SU perfil. Un amante de la gastronomía nórdica NO debe ver los mismos destinos que un mochilero adrenalínico. Un viajero familiar NO debe ver los mismos que un solo-traveler luxury. Tus recomendaciones DEBEN reflejar de forma evidente las preferencias específicas.

NUNCA recomiendes destinos genéricos "obvios" si no encajan (Bali, Santorini, Tulum, Kioto, Marrakech, Bora Bora) — sólo úsalos si CLARAMENTE matchean. Prioriza opciones únicas: Faroe Islands, Salta, Oaxaca, Hokkaido, Madeira, Kotor, Bhután, Lofoten, Mendoza, Hoi An, Ronda, Yakushima, Tasmania, Comporta, Tbilisi, Yunnan, Albania, Namibia, Uzbekistán, etc. Mezcla algunos icónicos con joyas escondidas si encajan con el perfil.

EVITA destinos que el usuario ya visitó (los recibes en "ya_visitados"). Si recomendaste antes a este usuario (los recibes en "recientes"), varía al menos 5 destinos.

Devuelve SIEMPRE un JSON estricto con esta forma exacta:
{
  "destinations": [
    {
      "name": string,           // ciudad o región icónica (ej. "Hokkaido", "Salta", "Comporta")
      "country": string,        // país en español
      "score": number,          // 70-99, % match real con el perfil
      "reason": string,         // 1 frase MUY específica que cite preferencias del perfil ("ideal por tu pasión por X y Y")
      "best_months": string,    // ej. "May–Sep"
      "trip_type": string,      // "escapada romántica" | "aventura" | "gastronómico" | "wellness" | "cultural" | "playa" | "ski" | "roadtrip" | "city break"
      "image_query": string     // query corto en inglés para video stock (ej. "hokkaido japan snow cinematic aerial")
    }
  ]
}

Ordena por score descendente. Las 8 ciudades deben ser DISTINTAS entre sí (no 4 playas). No incluyas texto fuera del JSON.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const __user = await getAuthUser(req);
  if (!__user) return unauthorizedResponse(corsHeaders);

  try {
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY no configurada");

    const auth = req.headers.get("Authorization") ?? "";
    const token = auth.replace("Bearer ", "");
    if (!token) {
      return new Response(JSON.stringify({ error: "no auth" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: userData } = await supabase.auth.getUser(token);
    const user = userData?.user;
    if (!user) {
      return new Response(JSON.stringify({ error: "invalid auth" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const forceRefresh: boolean = !!body?.refresh;

    // Cache: si ya hay recomendaciones <24h y NO se pide refresh, devolverlas tal cual.
    if (!forceRefresh) {
      const { data: cached } = await supabase
        .from("recomendaciones")
        .select("*")
        .eq("user_id", user.id)
        .eq("tipo", "destination_ai")
        .order("created_at", { ascending: false })
        .limit(8);
      if (cached && cached.length >= 6) {
        const ageMs = Date.now() - new Date(cached[0].created_at).getTime();
        if (ageMs < 24 * 60 * 60 * 1000) {
          return new Response(
            JSON.stringify({
              destinations: cached.map((c: any) => ({
                name: c.titulo,
                country: c.descripcion ?? "",
                score: c.match_score ?? 85,
                reason: c.metadata?.reason ?? "",
                best_months: c.metadata?.best_months ?? "",
                trip_type: c.metadata?.trip_type ?? "",
                image_query: c.metadata?.image_query ?? `${c.titulo} cinematic travel aerial`,
              })),
              cached: true,
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
      }
    }

    // Cargar contexto completo del usuario
    const [{ data: tp }, { data: ai }, { data: prof }, { data: trips }] = await Promise.all([
      supabase.from("travel_profiles").select("*").eq("user_id", user.id).maybeSingle(),
      supabase.from("ai_user_preferences").select("*").eq("user_id", user.id).maybeSingle(),
      supabase.from("profiles").select("ciudad_origen, pais_origen, full_name, currency_preference").eq("id", user.id).maybeSingle(),
      supabase.from("trips").select("destino, pais_destino").eq("user_id", user.id).order("created_at", { ascending: false }).limit(10),
    ]);

    const yaVisitados = Array.from(new Set([
      ...(tp?.destinos_visitados ?? []),
      ...((trips ?? []).map((t: any) => t.destino).filter(Boolean)),
    ])).slice(0, 30);

    const recientes = ((trips ?? []).map((t: any) => t.destino).filter(Boolean)).slice(0, 5);

    const perfil = {
      origen: prof?.ciudad_origen ?? null,
      pais_origen: prof?.pais_origen ?? null,
      // Travel profile (onboarding)
      estilo_viaje: tp?.estilo_viaje ?? [],
      intereses: tp?.intereses ?? [],
      ritmo: tp?.ritmo_viaje ?? ai?.ritmo_viaje ?? null,
      presupuesto: tp?.presupuesto_rango ?? ai?.nivel_presupuesto ?? null,
      comida_preferencias: tp?.preferencias_comida ?? ai?.estilo_comida ?? [],
      alergias: tp?.alergias_restricciones ?? ai?.restricciones_alimentarias ?? [],
      acompanantes: tp?.acompanantes_tipico ?? ai?.companeros_viaje ?? null,
      duracion_ideal: tp?.duracion_viaje_ideal ?? null,
      hospedaje: tp?.tipo_alojamiento_preferido ?? ai?.hospedaje_preferencias ?? [],
      llegada: tp?.llegada_estilo ?? [],
      idiomas: tp?.idiomas_hablados ?? [],
      destinos_pendientes: tp?.destinos_pendientes ?? [],
      ya_visitados: yaVisitados,
      mejor_viaje: ai?.mejor_viaje_descripcion ?? null,
      proposito: ai?.proposito_viaje ?? null,
      nivel_planificacion: ai?.nivel_planificacion ?? null,
      deal_breakers: ai?.deal_breakers ?? [],
      descripcion_personal: tp?.descripcion_personal ?? null,
      // Comportamiento
      categorias_visitadas: ai?.dna_signal?.categories ?? {},
      recientes,
      moneda: prof?.currency_preference ?? "MXN",
      movilidad_especial: !!tp?.movilidad_especial,
    };

    const userPrompt = `Perfil completo del viajero (úsalo TODO para personalizar):

${JSON.stringify(perfil, null, 2)}

Recomienda 8 destinos del mundo que CLARAMENTE encajen con este perfil específico. Cada "reason" debe citar de forma explícita 1-2 elementos concretos del perfil (por ejemplo: "tu interés en ${perfil.intereses?.[0] ?? "X"}" o "tu ritmo ${perfil.ritmo ?? "relajado"}"). Si el perfil está casi vacío, basa las recomendaciones en el origen (${perfil.origen ?? "desconocido"}) y prioriza variedad geográfica/temática. NO repitas destinos ya visitados.`;

    const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Lovable-API-Key": LOVABLE_API_KEY,
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: userPrompt },
        ],
        response_format: { type: "json_object" },
      }),
    });

    if (!aiRes.ok) {
      const txt = await aiRes.text();
      console.error("AI gateway", aiRes.status, txt);
      if (aiRes.status === 402) {
        return new Response(JSON.stringify({ error: "Sin créditos de IA. Agrega créditos en Settings → Usage." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (aiRes.status === 429) {
        return new Response(JSON.stringify({ error: "Demasiadas peticiones. Intenta en unos segundos." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw new Error(`AI gateway ${aiRes.status}`);
    }

    const aiJson = await aiRes.json();
    const content = aiJson?.choices?.[0]?.message?.content ?? "{}";
    let parsed: any;
    try {
      parsed = JSON.parse(content);
    } catch {
      const m = content.match(/\{[\s\S]*\}/);
      parsed = m ? JSON.parse(m[0]) : {};
    }

    const destinations: any[] = Array.isArray(parsed?.destinations) ? parsed.destinations.slice(0, 8) : [];
    if (destinations.length === 0) {
      throw new Error("La IA no devolvió destinos");
    }

    // Limpiar recomendaciones previas (no guardadas como favoritos) y guardar nuevas
    await supabase
      .from("recomendaciones")
      .delete()
      .eq("user_id", user.id)
      .eq("tipo", "destination_ai")
      .eq("guardado", false);

    const rows = destinations.map((d) => ({
      user_id: user.id,
      tipo: "destination_ai",
      titulo: d.name,
      descripcion: d.country,
      match_score: Math.max(70, Math.min(99, Math.round(Number(d.score) || 85))),
      imagen_url: null,
      metadata: {
        reason: d.reason ?? "",
        best_months: d.best_months ?? "",
        trip_type: d.trip_type ?? "",
        image_query: d.image_query ?? `${d.name} ${d.country} cinematic travel aerial`,
      },
      guardado: false,
    }));

    await supabase.from("recomendaciones").insert(rows);

    return new Response(
      JSON.stringify({ destinations, cached: false }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
