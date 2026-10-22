// tag-moment — al subir una foto a "Mejores momentos": etiquetas de visión (una vez, con tope de
// costo) y recálculo inmediato del perfil de gustos, para que Iato la tome en cuenta en la
// siguiente sugerencia. Reglas en ./tagging.ts.
//
// POST { moment_id } con la sesión de la persona →
//   { ok, status: "done"|"skipped"|"failed"|"cached", tags?, profile_updated }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { adminClient } from "../_shared/entitlements.ts";
import { enforceRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";
import { aiFetchDetailed } from "../_shared/ai.ts";
import { logUsage } from "../_shared/serpRuntime.ts";
import { refreshTasteProfile } from "../_shared/tasteProfileStore.ts";
import { tasteToday } from "../_shared/tasteProfile.ts";
import {
  capCheck, DEFAULT_GLOBAL_DAILY_CAP, DEFAULT_USER_DAILY_CAP, intEnv, MAX_IMAGE_BYTES, mimeFor, momentSource, ownsPath,
  parseVisionTags, toBase64, visionBody, VISION_MODEL,
} from "./tagging.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

async function readImage(admin: any, bucket: string, path: string): Promise<Uint8Array | null> {
  // Primero la versión reducida (transformación de imágenes de Storage); si no está disponible, el original.
  for (const opts of [{ transform: { width: 768, height: 768, resize: "contain", quality: 70 } }, undefined]) {
    try {
      const { data, error } = await admin.storage.from(bucket).download(path, opts as any);
      if (error || !data) continue;
      const bytes = new Uint8Array(await data.arrayBuffer());
      if (bytes.byteLength > 0 && bytes.byteLength <= MAX_IMAGE_BYTES) return bytes;
    } catch { /* siguiente opción */ }
  }
  return null;
}

async function countToday(admin: any, userId: string | null): Promise<number> {
  const since = `${tasteToday()}T06:00:00Z`; // medianoche de la Ciudad de México (aprox., sin horario de verano)
  let q = admin.from("travel_moments").select("id", { count: "exact", head: true }).gte("ai_tagged_at", since);
  if (userId) q = q.eq("user_id", userId);
  const { count, error } = await q;
  return error ? Number.MAX_SAFE_INTEGER : (count ?? 0); // si no se puede contar, no se gasta
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "No autorizado" }, 401);
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authHeader } } });
  const { data: u } = await supabase.auth.getUser();
  if (!u?.user) return json({ error: "Sesión inválida" }, 401);
  const uid = u.user.id;

  const body = await req.json().catch(() => ({}));
  const momentId = typeof body?.moment_id === "string" && UUID.test(body.moment_id) ? body.moment_id : null;
  if (!momentId) return json({ error: "moment_id requerido" }, 400);

  const rl = await enforceRateLimit(req, "tag-moment", uid, { perMinute: 12, perHour: 80, ipPerMinute: 30 });
  if (!rl.allowed) return rateLimitResponse(rl, corsHeaders);

  // RLS: solo sus propios momentos.
  const { data: moment } = await supabase.from("travel_moments")
    .select("id, user_id, image_url, image_path, ai_tags, ai_tag_status").eq("id", momentId).eq("user_id", uid).maybeSingle();
  if (!moment) return json({ error: "No encontramos ese momento" }, 404);

  const admin = adminClient();
  const finish = async (status: string, extra: Record<string, unknown> = {}) => {
    const profile = await refreshTasteProfile(supabase, admin, uid, tasteToday()).catch(() => null);
    return json({ ok: true, status, ...extra, profile_updated: !!profile });
  };

  if (moment.ai_tag_status === "done" && moment.ai_tags) return finish("cached", { tags: (moment.ai_tags as any)?.tags ?? [] });

  const setStatus = (status: string, ai_tags: unknown = null) =>
    admin.from("travel_moments").update({ ai_tag_status: status, ai_tags, ai_tagged_at: status === "done" ? new Date().toISOString() : null })
      .eq("id", momentId).eq("user_id", uid);

  const apiKey = Deno.env.get("LOVABLE_API_KEY") || Deno.env.get("GEMINI_API_KEY");
  const { bucket, path } = momentSource(moment);
  if (!apiKey || !ownsPath(path, uid)) {
    await setStatus("skipped");
    return finish("skipped", { reason: apiKey ? "foreign_path" : "no_key" });
  }

  const cap = capCheck(
    { user: await countToday(admin, uid), global: await countToday(admin, null) },
    { user: intEnv(Deno.env.get("MOMENT_TAG_USER_DAILY_CAP"), DEFAULT_USER_DAILY_CAP), global: intEnv(Deno.env.get("MOMENT_TAG_GLOBAL_DAILY_CAP"), DEFAULT_GLOBAL_DAILY_CAP) },
  );
  if (!cap.allowed) {
    await setStatus("skipped");
    return finish("skipped", { reason: cap.reason });
  }

  const bytes = await readImage(admin, bucket, path!);
  if (!bytes) {
    await setStatus("skipped");
    return finish("skipped", { reason: "image_unavailable" });
  }

  try {
    const { res, provider, model } = await aiFetchDetailed({
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${Deno.env.get("LOVABLE_API_KEY") ?? ""}` },
      body: JSON.stringify(visionBody(`data:${mimeFor(path!)};base64,${toBase64(bytes)}`)),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`vision ${res.status}`);
    const data = await res.json();
    const tags = parseVisionTags(data?.choices?.[0]?.message?.content, model || VISION_MODEL);
    await logUsage({
      user_id: uid, function: "tag-moment", provider, model,
      input_tokens: Number(data?.usage?.prompt_tokens) || 0, output_tokens: Number(data?.usage?.completion_tokens) || 0,
    });
    if (!tags) throw new Error("respuesta sin JSON");
    await setStatus("done", tags);
    return finish("done", { tags: tags.tags });
  } catch (e) {
    console.warn("tag-moment:", (e as Error)?.message);
    await setStatus("failed");
    return finish("failed");
  }
});
