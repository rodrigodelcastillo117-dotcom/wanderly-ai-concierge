// aprender-diario — al guardar una entrada del diario: la IA extrae gustos y disgustos concretos
// (con categoría, sentimiento, lugar, ciudad y la frase literal que los respalda), se guardan en
// journal_learnings ligados a QUIEN escribió la entrada y se recalcula su perfil de gustos, que
// alimenta el Travel DNA y los planes futuros. Reglas en ./learn.ts.
//
// El cliente la llama sin esperar (no bloquea "Agregar").
// POST { entry_id } con la sesión de la persona →
//   { ok, status: "done"|"empty"|"skipped"|"failed"|"cached"|"running", learnings: [...] }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { adminClient } from "../_shared/entitlements.ts";
import { enforceRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";
import { aiFetchDetailed } from "../_shared/ai.ts";
import { logUsage } from "../_shared/serpRuntime.ts";
import { refreshTasteProfile } from "../_shared/tasteProfileStore.ts";
import { tasteToday } from "../_shared/tasteProfile.ts";
import { LEARN_MODEL, learnBody, parseLearnings, shouldAnalyze, tripCities } from "./learn.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LEARN_COLS = "id, categoria, sentimiento, texto, lugar, ciudad, cita, entry_id, trip_id, created_at, edited_at";

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

  const body = await req.json().catch(() => ({}));
  const entryId = typeof body?.entry_id === "string" && UUID.test(body.entry_id) ? body.entry_id : null;
  if (!entryId) return json({ error: "entry_id requerido" }, 400);

  const rl = await enforceRateLimit(req, "aprender-diario", uid, { perMinute: 8, perHour: 40, ipPerMinute: 20 });
  if (!rl.allowed) return rateLimitResponse(rl, corsHeaders);

  // RLS + filtro explícito: solo entradas que ESTA persona escribió (en un viaje compartido, lo que
  // escribe un colaborador alimenta su perfil, no el del dueño).
  const { data: entry } = await supabase.from("trip_journal_entries")
    .select("id, trip_id, author_id, text, ai_learn_status").eq("id", entryId).eq("author_id", uid).maybeSingle();
  if (!entry) return json({ error: "No encontramos esa entrada" }, 404);

  const admin = adminClient();
  const current = async () => {
    const { data } = await admin.from("journal_learnings").select(LEARN_COLS).eq("entry_id", entryId).eq("user_id", uid)
      .order("created_at", { ascending: true });
    return data ?? [];
  };
  if (entry.ai_learn_status === "done" || entry.ai_learn_status === "empty") {
    return json({ ok: true, status: "cached", learnings: await current() });
  }

  // Un solo proceso por entrada (doble clic, reintento): se aparta con un UPDATE condicional. Uno
  // que se quedó "running" más de 2 minutos (la función murió) se puede volver a tomar.
  const stale = new Date(Date.now() - 120_000).toISOString();
  const { data: claimed } = await admin.from("trip_journal_entries")
    .update({ ai_learn_status: "running", ai_learned_at: new Date().toISOString() })
    .eq("id", entryId).eq("author_id", uid)
    .or(`ai_learn_status.is.null,ai_learn_status.in.(pending,failed,skipped),and(ai_learn_status.eq.running,ai_learned_at.lt."${stale}")`)
    .select("id");
  if (!claimed?.length) return json({ ok: true, status: "running", learnings: await current() });

  const setStatus = (status: string) =>
    admin.from("trip_journal_entries").update({ ai_learn_status: status, ai_learned_at: new Date().toISOString() })
      .eq("id", entryId).eq("author_id", uid);
  const replaceLearnings = async (rows: Record<string, unknown>[]) => {
    const del = await admin.from("journal_learnings").delete().eq("entry_id", entryId).eq("user_id", uid);
    if (del.error) throw new Error(`delete ${del.error.message}`);
    if (!rows.length) return;
    const ins = await admin.from("journal_learnings").insert(rows);
    if (ins.error) throw new Error(`insert ${ins.error.message}`);
  };
  const finish = async (status: string) => {
    await setStatus(status);
    await refreshTasteProfile(supabase, admin, uid, tasteToday()).catch(() => null);
    return json({ ok: true, status, learnings: await current() });
  };

  const text = String(entry.text ?? "");
  if (!shouldAnalyze(text)) {
    await replaceLearnings([]).catch(() => null);
    return finish("empty");
  }

  const apiKey = Deno.env.get("LOVABLE_API_KEY") || Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) {
    await setStatus("skipped");
    return json({ ok: true, status: "skipped", reason: "no_key", learnings: [] });
  }

  const { data: trip } = await supabase.from("trips").select("destino").eq("id", entry.trip_id).maybeSingle();
  const ctx = { cities: tripCities(trip?.destino) };

  try {
    const { res, provider, model } = await aiFetchDetailed({
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${Deno.env.get("LOVABLE_API_KEY") ?? ""}` },
      body: JSON.stringify(learnBody(text, ctx)),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`ai ${res.status}`);
    const data = await res.json();
    await logUsage({
      user_id: uid, function: "aprender-diario", provider, model: model || LEARN_MODEL,
      input_tokens: Number(data?.usage?.prompt_tokens) || 0, output_tokens: Number(data?.usage?.completion_tokens) || 0,
    });
    const learnings = parseLearnings(data?.choices?.[0]?.message?.content, text, ctx);
    await replaceLearnings(learnings.map((l) => ({ ...l, user_id: uid, entry_id: entryId, trip_id: entry.trip_id })));
    return finish(learnings.length ? "done" : "empty");
  } catch (e) {
    console.warn("aprender-diario:", (e as Error)?.message);
    await setStatus("failed");
    return json({ ok: false, status: "failed", learnings: [] });
  }
});
