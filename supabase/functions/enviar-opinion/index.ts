// enviar-opinion — "¿Algo no se entiende? Cuéntanos". Recibe la opinión de un usuario con sesión, la
// guarda en la Mesa de operaciones (concierge_requests type 'opinion', migración 20261029060000_opiniones)
// y avisa al equipo (FIXER_EMAIL, varios separados por coma) con Resend. La lógica vive en core.ts.
import { createClient } from "npm:@supabase/supabase-js@2.45.0";
import { getAuthUser, unauthorizedResponse } from "../_shared/verify-auth.ts";
import { sendEmail } from "../_shared/email.ts";
import { enforceRateLimit } from "../_shared/rate-limit.ts";
import { sendOwnerAlert } from "../_shared/ops-desk.ts";
import { teamEmails } from "../_shared/teamEmails.ts";
import { rpcIdemStore } from "../_shared/idempotency.ts";
import { redactPii } from "../_shared/redact.ts";
import { OPINION_LIMITS, submitOpinion } from "./core.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json", ...extra } });

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const user = await getAuthUser(req);
  if (!user) return unauthorizedResponse(corsHeaders);

  try {
    const body = await req.json().catch(() => null);
    const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const asUser = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const out = await submitOpinion({
      userId: user.id,
      userEmail: user.email ?? null,
      rateLimit: () => enforceRateLimit(req, "enviar-opinion", user.id, OPINION_LIMITS),
      tripVisible: async (id) => {
        const { data } = await asUser.from("trips").select("id").eq("id", id).maybeSingle();
        return !!data;
      },
      insert: (row) => admin.from("concierge_requests").insert(row).select("id, status").single(),
      alert: (id, replyTo) => sendOwnerAlert({
        rpc: (fn, args) => admin.rpc(fn, args),
        send: (m) => sendEmail(m),
        siteUrl: Deno.env.get("SITE_URL") ?? null,
        ownerEmail: teamEmails(),
        ownerFrom: "IATOS Opiniones <hola@traveliatos.life>",
        warn: (...a) => console.warn(...a),
      }, id, { replyTo }),
      idem: rpcIdemStore(admin),
      warn: (...a) => console.warn(...a.map((x) => redactPii(String(x)))),
    }, body);
    const retry: Record<string, string> = typeof out.body.retry_after === "number" ? { "Retry-After": String(out.body.retry_after) } : {};
    return json(out.body, out.status, retry);
  } catch (e) {
    console.error("enviar-opinion error", redactPii((e as Error)?.message ?? e));
    return json({ ok: false, code: "INTERNAL_ERROR", message: "No pudimos guardar tu opinión. Inténtalo de nuevo en un momento." }, 500);
  }
});
