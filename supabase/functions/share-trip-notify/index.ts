// Avisa en la campana a amigos aceptados que alguien les compartió un viaje.
// F-19: el texto lo arma el servidor con una plantilla fija (template.ts); el cliente solo manda
// datos acotados (destinos, fechas, ruta interna). Límite de frecuencia y respuestas con códigos.
import { createClient } from "npm:@supabase/supabase-js@2.45.0";
import { enforceRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";
import { safeOrigin } from "../_shared/origin.ts";
import { redactPii } from "../_shared/redact.ts";
import { buildShareNotification, parseShareBody } from "./template.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const supaUser = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await supaUser.auth.getUser();
    if (userErr || !userData?.user) {
      return json(401, { code: "UNAUTHENTICATED", error: "invalid_user" });
    }
    const senderId = userData.user.id;

    // Cada llamada escribe en la campana de hasta 20 personas: límite contra spam.
    const rl = await enforceRateLimit(req, "share-trip-notify", senderId, { perMinute: 5, perHour: 30, ipPerMinute: 15 });
    if (!rl.allowed) return rateLimitResponse(rl, corsHeaders);

    const input = parseShareBody(await req.json().catch(() => null));
    if (!input) return json(400, { code: "INVALID_REQUEST", error: "missing_fields" });

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    // Solo amigos aceptados del remitente (mis_amigos con SU sesión; ya no se pueden falsificar).
    const { data: misAmigos } = await supaUser.from("mis_amigos").select("amigo_id");
    const allowed = new Set((misAmigos ?? []).map((r: { amigo_id: string }) => r.amigo_id));
    const validIds = input.friendIds.filter((id) => allowed.has(id));
    if (!validIds.length) return json(403, { code: "FORBIDDEN", error: "no_valid_friends" });

    // Nombre del remitente para el título (su propio perfil).
    const { data: senderProfile } = await admin
      .from("profiles").select("full_name, username").eq("id", senderId).maybeSingle();
    const senderName = (senderProfile as { full_name?: string | null; username?: string | null } | null)?.full_name
      || (senderProfile as { username?: string | null } | null)?.username
      || "Un amigo";

    const { title, body } = buildShareNotification(senderName, input, safeOrigin(req.headers.get("origin")));
    const rows = validIds.map((uid) => ({ user_id: uid, type: "social", title, body, read: false }));
    const { error } = await admin.from("notifications").insert(rows);
    if (error) throw error;

    return json(200, { ok: true, sent: rows.length });
  } catch (e) {
    console.error("share-trip-notify error", redactPii((e as Error)?.message ?? e));
    return json(500, { code: "INTERNAL_ERROR", error: "internal_error" });
  }
});
