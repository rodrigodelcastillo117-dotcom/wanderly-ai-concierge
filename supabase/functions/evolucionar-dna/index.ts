// supabase/functions/evolucionar-dna/index.ts
// ⭐ Travel DNA evolutivo — el corazón de IATOS.
// Lee TODAS las señales acumuladas del usuario (viajes, visitas, dna_signal,
// favoritos, eventos de comportamiento) y reescribe un perfil_ia EVOLUCIONADO.
// Esto es lo que el business plan promete: "AI que evoluciona con cada viaje".
//
// Cuándo llamarla (desde el frontend):
//   - Al terminar un viaje (status pasa a 'listo' y el usuario lo revisa)
//   - Al registrar varias visitas
//   - Manualmente desde Perfil ("Recalcular mi Travel DNA")
//   - O en un cron, si Lovable lo permite.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY =
  Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!;
const MASTER_PROMPT_IATOS = (Deno.env.get("MASTER_PROMPT_IATOS") ?? "").trim();


const SYSTEM = `Eres el motor de Travel DNA de IATOS AI. Tu trabajo es OBSERVAR el
comportamiento real de un viajero (no solo lo que dijo en el onboarding) y
producir un perfil EVOLUCIONADO que capture cómo viaja DE VERDAD.

Te doy: (a) el perfil declarado en onboarding, (b) señales reales de comportamiento
(viajes que ha creado, lugares que visitó por categoría, favoritos guardados).

Detecta DIVERGENCIAS entre lo declarado y lo real. Ej: dijo "presupuesto medio"
pero todos sus viajes son a destinos premium → ajusta. Dijo que le gusta el arte
pero solo visita restaurantes → ajusta.

Devuelve EXCLUSIVAMENTE JSON válido (sin markdown):
{
  "resumen": "2-3 frases de cómo viaja realmente, integrando lo declarado + lo observado",
  "rasgos": ["..."],
  "motivaciones": ["..."],
  "evitar": ["..."],
  "destinos_sugeridos": ["3-5 destinos calibrados a su comportamiento real"],
  "estilo_dominante": "frase corta",
  "tono_recomendaciones": "casual | sofisticado | técnico | cálido",
  "divergencias_detectadas": ["qué cambió respecto al onboarding y por qué"],
  "confianza": 0.0,
  "senales_clave": { "clave": "valor" }
}
"confianza" es 0.0-1.0: qué tan seguro estás del perfil según cuántos datos reales hay.
Pocos datos = baja confianza, apóyate más en lo declarado.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey) {
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
    const { data: u, error: uErr } = await supabase.auth.getUser();
    if (uErr || !u?.user) {
      return new Response(JSON.stringify({ error: "Sesión inválida" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const uid = u.user.id;

    // ---- Recolecta TODAS las señales del usuario ----
    const [
      { data: travelProfile },
      { data: prefs },
      { data: trips },
      { data: visits },
      { data: favoritos },
      { data: insights },
      { data: profile },
    ] = await Promise.all([
      supabase.from("travel_profiles").select("*").eq("user_id", uid).maybeSingle(),
      supabase.from("ai_user_preferences").select("*").eq("user_id", uid).maybeSingle(),
      supabase.from("trips").select("destino, pais_destino, total_estimado, num_viajeros, match_score, status").eq("user_id", uid).order("created_at", { ascending: false }).limit(20),
      supabase.from("user_visits").select("place_name, category, rating").eq("user_id", uid).order("visited_at", { ascending: false }).limit(50),
      supabase.from("recomendaciones").select("tipo, titulo").eq("user_id", uid).eq("guardado", true).limit(30),
      supabase.from("behavioral_insights").select("action, target_type, target_label").eq("user_id", uid).order("created_at", { ascending: false }).limit(50),
      supabase.from("profiles").select("full_name, ciudad_origen").eq("id", uid).maybeSingle(),
    ]);


    // Resumen de viajes
    const tripsResumen = (trips ?? []).map((t: any) =>
      `${t.destino}${t.pais_destino ? ` (${t.pais_destino})` : ""} — $${Math.round(Number(t.total_estimado) || 0).toLocaleString("es-MX")} MXN, ${t.num_viajeros} viajero(s)`
    ).join("\n") || "Sin viajes aún.";

    // Categorías de visitas agregadas
    const catCount: Record<string, number> = {};
    for (const v of visits ?? []) {
      const c = (v as any).category ?? "otro";
      catCount[c] = (catCount[c] ?? 0) + 1;
    }
    const visitsResumen = Object.entries(catCount)
      .sort((a, b) => b[1] - a[1])
      .map(([c, n]) => `${c}: ${n}`).join(", ") || "Sin visitas registradas.";

    const favResumen = (favoritos ?? []).map((f: any) => `${f.tipo}: ${f.titulo}`).join("; ") || "Sin favoritos.";
    const insightsResumen = (insights ?? []).map((i: any) => `${i.action} → ${i.target_label ?? i.target_type ?? ""}`).join("; ") || "Sin eventos.";

    const declarado = {
      estilo_viaje: travelProfile?.estilo_viaje,
      presupuesto: travelProfile?.presupuesto_rango ?? prefs?.nivel_presupuesto,
      ritmo: travelProfile?.ritmo_viaje ?? prefs?.ritmo_viaje,
      comida: travelProfile?.preferencias_comida ?? prefs?.estilo_comida,
      intereses: travelProfile?.intereses,
      proposito: prefs?.proposito_viaje,
      descripcion: travelProfile?.descripcion_personal ?? prefs?.mejor_viaje_descripcion,
      perfil_onboarding: travelProfile?.perfil_ia ?? prefs?.perfil_ia,
    };

    const userPrompt = `PERFIL DECLARADO (onboarding):
${JSON.stringify(declarado, null, 2)}

SEÑALES REALES DE COMPORTAMIENTO:
- Viajes creados (${trips?.length ?? 0}):
${tripsResumen}
- Lugares visitados por categoría: ${visitsResumen}
- Favoritos guardados: ${favResumen}
- Eventos de comportamiento: ${insightsResumen}

Genera el Travel DNA evolucionado. Detecta divergencias entre lo declarado y lo real.`;

    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-pro",
        messages: [
          { role: "system", content: systemFinal },
          { role: "user", content: userPrompt },
        ],
        response_format: { type: "json_object" },
      }),
    });

    if (!resp.ok) {
      const txt = await resp.text();
      return new Response(JSON.stringify({ error: "ai_error", detail: txt }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await resp.json();
    const content = data?.choices?.[0]?.message?.content ?? "{}";
    let dna: any = {};
    try { dna = JSON.parse(content); }
    catch { const m = content.match(/\{[\s\S]*\}/); dna = m ? JSON.parse(m[0]) : { resumen: content }; }

    // Persiste el DNA evolucionado + sube la versión
    const nuevaVersion = (prefs?.dna_version ?? 1) + 1;
    await supabase.from("ai_user_preferences").upsert({
      user_id: uid,
      perfil_ia: dna,
      dna_version: nuevaVersion,
      dna_updated_at: new Date().toISOString(),
    }, { onConflict: "user_id" });

    // También refleja en travel_profiles para que el resto de la app lo lea
    await supabase.from("travel_profiles").upsert({
      user_id: uid,
      perfil_ia: dna,
    }, { onConflict: "user_id" });

    return new Response(JSON.stringify({ dna, version: nuevaVersion }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("evolucionar-dna error:", e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
