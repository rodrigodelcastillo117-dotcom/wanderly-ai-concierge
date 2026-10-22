// prive-access — todo el acceso a IATOS Privé desde la app (contrato §3): estado, aceptar la
// invitación, contraseña Privé, desbloqueo/bloqueo, restablecimiento, sesiones y progreso.
// verify_jwt por defecto (true) y además getUser con el JWT de quien llama. La lógica vive en
// actions.ts (probada); aquí solo se conectan Supabase, HIBP y el correo.
// Nunca se registran contraseñas, tokens, ni correos.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { getAuthUser, unauthorizedResponse } from "../_shared/verify-auth.ts";
import { adminClient } from "../_shared/entitlements.ts";
import { clientIp, enforceRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";
import { sendEmail } from "../_shared/email.ts";
import { hibpCheck, ipHash, jwtSessionId } from "../_shared/prive-core.ts";
import { priveNoticeEmail, priveResetEmail } from "../_shared/prive-email.ts";
import { type ClaimedInvitation, sendDueInvitations } from "../_shared/prive-invite-sender.ts";
import { redactSecrets } from "../_shared/redact.ts";
import { handlePriveAction, type PriveAccessDeps } from "./actions.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" } });

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!;
const SITE_URL = Deno.env.get("SITE_URL") ?? "https://traveliatos.life";
const SUPPORT_EMAIL = Deno.env.get("SUPPORT_EMAIL") ?? undefined;
const IP_SALT = Deno.env.get("PRIVE_IP_SALT") ?? "";
let warnedNoSalt = false;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, code: "INVALID", detail: "method" }, 400);

  const user = await getAuthUser(req);
  if (!user) return unauthorizedResponse(corsHeaders);

  // Límite general por cuenta e IP (los bloqueos por contraseña viven en SQL, antes de bcrypt).
  const rl = await enforceRateLimit(req, "prive-access", user.id, { perMinute: 30, perHour: 300, ipPerMinute: 60 });
  if (!rl.allowed) return rateLimitResponse(rl, corsHeaders);

  const raw = await req.text();
  if (raw.length > 8192) return json({ ok: false, code: "INVALID", detail: "size" }, 400);
  let body: unknown;
  try {
    body = JSON.parse(raw || "{}");
  } catch {
    return json({ ok: false, code: "INVALID", detail: "json" }, 400);
  }

  if (!IP_SALT && !warnedNoSalt) {
    // Sin la sal no se inventa una: se omite el límite por IP (el de la cuenta sigue).
    console.warn("prive-access: PRIVE_IP_SALT no configurado; se omite el límite por ip_hash");
    warnedNoSalt = true;
  }
  const authorization = req.headers.get("Authorization") ?? req.headers.get("authorization") ?? "";
  const ctx = {
    user: { id: user.id, email: user.email ?? null },
    ipHash: await ipHash(clientIp(req), IP_SALT),
    authSessionId: jwtSessionId(authorization),
  };

  const admin = adminClient();
  const asUser = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const firstName = async (uid: string) => {
    const { data } = await admin.rpc("prive_first_name", { _user: uid });
    return typeof data === "string" ? data : null;
  };
  const emailReady = () => Boolean(Deno.env.get("LOVABLE_API_KEY") && Deno.env.get("RESEND_API_KEY"));

  const deps: PriveAccessDeps = {
    rpc: (fn, args) => admin.rpc(fn, args),
    userRpc: (fn, args) => asUser.rpc(fn, args),
    hibp: (pw) => hibpCheck(pw, (url, init) => fetch(url, init)),
    sendNotice: async (kind, u, extra) => {
      try {
        if (!u.email || !emailReady()) return false;
        const mail = priveNoticeEmail({ kind, firstName: await firstName(u.id), siteUrl: SITE_URL, supportEmail: SUPPORT_EMAIL, resetToken: extra?.resetToken });
        const r = await sendEmail({ to: u.email, subject: mail.subject, html: mail.html, text: mail.text });
        return r.ok;
      } catch (e) {
        console.warn("prive-access: aviso no enviado", kind, redactSecrets((e as Error).message));
        return false;
      }
    },
    sendResetEmail: async (u, token) => {
      try {
        if (!u.email || !emailReady()) return false;
        const mail = priveResetEmail({ firstName: await firstName(u.id), token, siteUrl: SITE_URL, supportEmail: SUPPORT_EMAIL });
        return (await sendEmail({ to: u.email, subject: mail.subject, html: mail.html, text: mail.text })).ok;
      } catch {
        return false;
      }
    },
    sendInvitationNow: async (uid) => {
      if (!emailReady()) return "not_configured";
      try {
        const s = await sendDueInvitations({
          claim: (limit, only) => admin.rpc("prive_claim_invitation_emails", { _limit: limit, _only_user: only }) as unknown as PromiseLike<{ data: ClaimedInvitation[] | null; error: { message: string } | null }>,
          mark: (id, ok, providerId, error) => admin.rpc("prive_mark_invitation_email", { _invitation_id: id, _ok: ok, _provider_id: providerId, _error: error }),
          send: (m) => sendEmail(m),
          siteUrl: SITE_URL,
          supportEmail: SUPPORT_EMAIL,
          warn: (...a) => console.warn(...a),
        }, 1, uid);
        return s.sent > 0 ? "sent" : s.claimed > 0 ? "failed" : "none";
      } catch {
        return "failed";
      }
    },
    log: (...a) => console.warn(...a.map((x) => (typeof x === "string" ? redactSecrets(x) ?? "" : x))),
  };

  const out = await handlePriveAction(body, ctx, deps);
  return json(out.body, out.status);
});
