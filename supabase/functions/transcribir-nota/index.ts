// transcribir-nota — nota de voz del diario → texto en español. El audio llega en el cuerpo, se
// transcribe con el proveedor de IA ya configurado (_shared/ai.ts: Gemini directo o el gateway de
// Lovable) y NO se guarda. Reglas en ./transcribe.ts.
//
// POST { audio_base64, mime, seconds } con la sesión de la persona → { text }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { enforceRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";
import { aiFetchDetailed } from "../_shared/ai.ts";
import { logUsage } from "../_shared/serpRuntime.ts";
import { checkInput, cleanTranscript, TRANSCRIBE_MODEL, transcribeBody } from "./transcribe.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "No autorizado" }, 401);
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authHeader } } });
  const { data: u } = await supabase.auth.getUser();
  if (!u?.user) return json({ error: "Sesión inválida" }, 401);
  const uid = u.user.id;

  const rl = await enforceRateLimit(req, "transcribir-nota", uid, { perMinute: 6, perHour: 40, ipPerMinute: 15 });
  if (!rl.allowed) return rateLimitResponse(rl, corsHeaders);

  const checked = checkInput(await req.json().catch(() => null));
  if (!checked.ok) return json({ error: checked.error }, checked.status);

  if (!Deno.env.get("LOVABLE_API_KEY") && !Deno.env.get("GEMINI_API_KEY")) {
    return json({ error: "La transcripción no está disponible por ahora. Escribe tu entrada." }, 503);
  }

  try {
    const { res, provider, model } = await aiFetchDetailed({
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${Deno.env.get("LOVABLE_API_KEY") ?? ""}` },
      body: JSON.stringify(transcribeBody(checked.data, checked.format)),
      signal: AbortSignal.timeout(45_000),
    });
    if (!res.ok) {
      console.warn("transcribir-nota ai", res.status, (await res.text().catch(() => "")).slice(0, 300));
      return json({ error: "No pudimos pasar tu nota a texto. Intenta de nuevo o escríbela." }, 502);
    }
    const data = await res.json();
    await logUsage({
      user_id: uid, function: "transcribir-nota", provider, model: model || TRANSCRIBE_MODEL,
      input_tokens: Number(data?.usage?.prompt_tokens) || 0, output_tokens: Number(data?.usage?.completion_tokens) || 0,
    });
    return json({ text: cleanTranscript(data?.choices?.[0]?.message?.content) });
  } catch (e) {
    console.warn("transcribir-nota:", (e as Error)?.message);
    return json({ error: "No pudimos pasar tu nota a texto. Intenta de nuevo o escríbela." }, 502);
  }
});
