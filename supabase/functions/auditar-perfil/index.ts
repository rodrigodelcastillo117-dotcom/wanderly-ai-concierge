// supabase/functions/auditar-perfil/index.ts
// FIXED v2: audita la descripción libre, devuelve estructura completa
// (incluye destinos_sugeridos + estilo_dominante) Y persiste el perfil
// en travel_profiles.perfil_ia + ai_user_preferences.perfil_ia.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!;
const MASTER_PROMPT_IATOS = (Deno.env.get("MASTER_PROMPT_IATOS") ?? "").trim();


Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { descripcion, contexto } = await req.json();
    if (!descripcion || descripcion.trim().length < 5) {
      return new Response(JSON.stringify({ error: "descripcion requerida" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const apiKey = Deno.env.get("LOVABLE_API_KEY")!;
    const system = `Eres un analista de perfil de viajero premium. A partir de la descripción libre del usuario y el contexto que ya tenemos sobre él, devuelve EXCLUSIVAMENTE un JSON válido (sin markdown, sin texto extra) con esta estructura EXACTA:
{
  "resumen": "1-2 frases describiéndolo como viajero",
  "rasgos": ["rasgo1", "rasgo2"],
  "motivaciones": ["motivación1"],
  "evitar": ["cosas que no le gustan"],
  "destinos_sugeridos": ["Ciudad/País 1", "Ciudad/País 2", "Ciudad/País 3"],
  "estilo_dominante": "una palabra o frase corta, ej: 'explorador gastronómico de lujo'",
  "tono_recomendaciones": "casual | sofisticado | técnico | cálido",
  "senales_clave": { "clave": "valor" }
}`;
    const userMsg = `Descripción del usuario:\n${descripcion}\n\nContexto previo:\n${JSON.stringify(contexto ?? {}, null, 2)}`;
    const systemFinal = [MASTER_PROMPT_IATOS, system].filter(Boolean).join("\n\n---\n\n");

    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemFinal },
          { role: "user", content: userMsg },
        ],

        response_format: { type: "json_object" },
      }),
    });

    if (!resp.ok) {
      const txt = await resp.text();
      return new Response(JSON.stringify({ error: "ai_error", detail: txt }), {
        status: resp.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await resp.json();
    const content = data?.choices?.[0]?.message?.content ?? "{}";
    let perfil: any = {};
    try {
      perfil = JSON.parse(content);
    } catch {
      const m = content.match(/\{[\s\S]*\}/);
      perfil = m ? JSON.parse(m[0]) : { resumen: content };
    }

    // PERSISTENCIA: guarda el perfil en la base (si hay sesión válida).
    // Si no hay auth, simplemente devuelve el perfil sin guardar (no rompe).
    const authHeader = req.headers.get("Authorization");
    if (authHeader) {
      try {
        const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
          global: { headers: { Authorization: authHeader } },
        });
        const { data: u } = await supabase.auth.getUser();
        if (u?.user) {
          const uid = u.user.id;
          // travel_profiles.perfil_ia
          await supabase.from("travel_profiles").upsert({ user_id: uid, perfil_ia: perfil }, { onConflict: "user_id" });
          // ai_user_preferences.perfil_ia (espejo, para que logistics-plan lo use)
          await supabase
            .from("ai_user_preferences")
            .upsert({ user_id: uid, perfil_ia: perfil }, { onConflict: "user_id" });
        }
      } catch (e) {
        console.warn("auditar-perfil: no se pudo persistir:", e);
        // no rompemos: devolvemos el perfil igual
      }
    }

    return new Response(JSON.stringify({ perfil }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
