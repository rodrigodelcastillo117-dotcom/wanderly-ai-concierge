// supabase/functions/generate-avatar/index.ts
// Travel Avatar que SÍ se parece a la persona.
//
//   {action:"crear", selfies:[dataUrl…1-3]}  → 2 variantes verificadas contra la selfie (juez de
//                                              parecido + 1 reintento con correcciones). Se guardan en
//                                              el bucket PRIVADO avatar-private y se devuelven con enlaces
//                                              firmados de 15 min. La selfie NO se guarda en ningún lado.
//   {action:"crear", builder:{…}}             → "diséñalo tú" (sin foto, sin juez).
//   {action:"elegir", variant_id}             → la variante elegida queda como imagen base (privada) y
//                                              su copia pública como avatar (profiles.avatar_url, única
//                                              fuente). Las otras variantes se borran. En segundo plano
//                                              se dibujan los recuerdos de viajes ya ganados.
// Compatibilidad: {selfie} = crear con una foto. Sin foto ni rasgos → 400 (antes se inventaba a una
// persona nueva con solo texto: la causa principal de "no me parezco nada").
// Costo acotado: 8 imágenes por persona cada 24 h (AVATAR_DAILY_IMAGES) + rate limit por minuto/hora.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { enforceRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";
import { createVariants } from "../_shared/avatar-flow.ts";
import { toDataUrl, validSelfie, type BuilderTraits } from "../_shared/avatar-prompts.ts";
import {
  admin, coreDeps, imageBytes, PRIVATE_BUCKET, publishAvatar, rebuildWithHistory, runInBackground,
} from "../_shared/avatar-runtime.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!;
const SIGNED_TTL_S = 15 * 60;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MESSAGES: Record<string, string> = {
  limite_diario: "Ya creaste varias versiones hoy. Vuelve mañana para generar más.",
  sin_creditos: "El servicio de imágenes no está disponible en este momento. Intenta más tarde.",
  saturado: "El servicio de imágenes está saturado. Intenta en unos minutos.",
  sin_imagen: "No pudimos crear tu avatar con esa foto. Prueba con otra, de frente y con buena luz.",
  error: "No pudimos crear tu avatar. Intenta de nuevo.",
  selfie_requerida: "Sube una selfie (o diseña tu avatar por rasgos) para crearlo.",
  selfie_invalida: "La foto no es válida. Usa JPG, PNG o WebP de menos de 4 MB.",
};

function json(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
const fail = (code: string, status: number) => json({ ok: false, code, error: MESSAGES[code] ?? MESSAGES.error }, status);

function cleanBuilder(b: unknown): BuilderTraits | null {
  if (!b || typeof b !== "object") return null;
  const out: BuilderTraits = {};
  for (const k of ["gender", "skin", "hair_style", "hair_color", "outfit_style", "accessory", "vibe"] as const) {
    const v = (b as Record<string, unknown>)[k];
    if (typeof v === "string" && v.trim()) out[k] = v.trim().slice(0, 140);
  }
  return Object.keys(out).length ? out : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    if (!Deno.env.get("LOVABLE_API_KEY")) return fail("sin_creditos", 503);
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "No autorizado" }, 401);
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: u } = await userClient.auth.getUser();
    if (!u?.user) return json({ error: "Sesión inválida" }, 401);
    const uid = u.user.id;

    const rl = await enforceRateLimit(req, "generate-avatar", uid, { perMinute: 4, perHour: 20, ipPerMinute: 10 });
    if (!rl.allowed) return rateLimitResponse(rl, corsHeaders);

    const body = await req.json().catch(() => ({}));
    const db = admin();

    if (body?.action === "elegir") {
      const id = String(body?.variant_id ?? "");
      if (!UUID.test(id)) return json({ ok: false, error: "Variante inválida" }, 400);
      const { data: v } = await db.from("avatar_variants").select("*").eq("id", id).eq("user_id", uid).maybeSingle();
      if (!v || v.status !== "pendiente" || Date.parse(v.created_at) < Date.now() - 24 * 3600_000) {
        return json({ ok: false, error: "Esa versión ya no está disponible. Crea tu avatar de nuevo." }, 410);
      }
      const { data: file, error: dlErr } = await db.storage.from(PRIVATE_BUCKET).download(v.storage_path);
      if (dlErr || !file) return json({ ok: false, error: MESSAGES.error }, 500);
      const mime = file.type && /^image\//.test(file.type) ? file.type : "image/png";
      const dataUrl = toDataUrl(new Uint8Array(await file.arrayBuffer()), mime);

      const { data: prevAp } = await db.from("avatar_profiles").select("base_path").eq("user_id", uid).maybeSingle();
      const url = await publishAvatar(db, uid, dataUrl, {
        visibleKeys: [], model: v.model ?? null, score: v.likeness_score ?? null, basePath: v.storage_path,
      });
      await db.from("avatar_variants").update({ status: "elegida" }).eq("id", id);
      await db.from("avatar_souvenirs").update({ visible: false }).eq("user_id", uid).eq("visible", true);

      // Lo que ya no se usa se borra: las otras variantes y la imagen base anterior.
      const { data: others } = await db.from("avatar_variants").select("id, storage_path")
        .eq("user_id", uid).neq("id", id).in("status", ["pendiente", "elegida"]);
      const toRemove = (others ?? []).map((o: { storage_path: string }) => o.storage_path);
      if (prevAp?.base_path && prevAp.base_path !== v.storage_path) toRemove.push(prevAp.base_path);
      if (toRemove.length) await db.storage.from(PRIVATE_BUCKET).remove([...new Set(toRemove)]);
      if (others?.length) await db.from("avatar_variants").update({ status: "descartada" }).in("id", others.map((o: { id: string }) => o.id));

      // Recuerdos ya ganados (o viajes pasados) se dibujan en segundo plano sobre la nueva base.
      const { count } = await db.from("trips").select("id", { count: "exact", head: true }).eq("user_id", uid)
        .lt("fecha_salida", new Date().toISOString().slice(0, 10));
      const reaplicando = (count ?? 0) > 0;
      if (reaplicando) runInBackground(rebuildWithHistory(db, uid));
      return json({ ok: true, url, reaplicando });
    }

    // ── crear ──
    const rawSelfies: unknown[] = Array.isArray(body?.selfies) ? body.selfies : body?.selfie ? [body.selfie] : [];
    const builder = cleanBuilder(body?.builder);
    if (!rawSelfies.length && !builder) return fail("selfie_requerida", 400);
    if (rawSelfies.length > 3 || rawSelfies.some((s) => !validSelfie(s))) return fail("selfie_invalida", 400);
    const selfies = rawSelfies as string[];

    const res = await createVariants(coreDeps(db, uid, "crear", "generate-avatar"), {
      selfies: selfies.length ? selfies : null,
      builder,
      variants: 2,
    });
    if (!res.ok) return fail(res.code, res.code === "limite_diario" ? 429 : 502);

    const out: Array<{ id: string; url: string; score: number | null }> = [];
    for (const v of res.variants) {
      const img = await imageBytes(v.url);
      if (!img) continue;
      const path = `${uid}/variantes/${crypto.randomUUID()}.${img.ext}`;
      const up = await db.storage.from(PRIVATE_BUCKET).upload(path, img.bytes, { contentType: img.mime, upsert: false });
      if (up.error) { console.error("variant upload:", up.error.message); continue; }
      const { data: row, error } = await db.from("avatar_variants").insert({
        user_id: uid, storage_path: path, model: v.model, likeness_score: v.score, diferencias: v.diferencias,
        origen: selfies.length ? "selfie" : "rasgos",
      }).select("id").single();
      if (error || !row) continue;
      const { data: signed } = await db.storage.from(PRIVATE_BUCKET).createSignedUrl(path, SIGNED_TTL_S);
      if (signed?.signedUrl) out.push({ id: row.id, url: signed.signedUrl, score: v.score });
    }
    if (!out.length) return fail("error", 500);
    return json({ ok: true, variants: out, verificado: selfies.length > 0 });
  } catch (e) {
    console.error("generate-avatar error:", e);
    return fail("error", 500);
  }
});
