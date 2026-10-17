// Delete only the authenticated caller; privileged credentials stay server-side.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { getAuthUser, unauthorizedResponse } from "../_shared/verify-auth.ts";
import { enforceRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";
import { confirmedDeletion } from "./validation.ts";

const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
});

Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return respond({ error: "method_not_allowed" }, 405);
  const user = await getAuthUser(req);
  if (!user) return unauthorizedResponse(corsHeaders);
  let body: unknown;
  try { body = await req.json(); } catch { return respond({ error: "invalid_json" }, 400); }
  if (!confirmedDeletion(body)) return respond({ error: "confirmation_required" }, 400);
  const verdict = await enforceRateLimit(req, "delete-account", user.id, { perMinute: 3, perHour: 10 });
  if (!verdict.allowed) return rateLimitResponse(verdict, corsHeaders);
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return respond({ error: "deletion_unavailable" }, 503);
  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  let stage = "subscription";
  try {
    const { data: subscription, error: subscriptionError } = await admin.from("subscriptions")
      .select("stripe_subscription_id,status").eq("user_id", user.id).maybeSingle();
    if (subscriptionError) throw subscriptionError;
    if (subscription?.stripe_subscription_id && subscription.status !== "canceled") {
      const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
      if (!stripeKey) return respond({ error: "billing_cancellation_unavailable" }, 503);
      const cancellation = await fetch(`https://api.stripe.com/v1/subscriptions/${encodeURIComponent(subscription.stripe_subscription_id)}`, {
        method: "DELETE", headers: { Authorization: `Bearer ${stripeKey}` },
      });
      if (!cancellation.ok) throw new Error("billing_cancellation_failed");
    }
    stage = "storage";
    // Requery after each batch: RPC responses are capped by the API row limit.
    for (;;) {
      const { data: files, error } = await admin.rpc("account_deletion_files", { p_user_id: user.id });
      if (error) throw error;
      if (!files?.length) break;
      const grouped = new Map<string, string[]>();
      for (const file of files) grouped.set(file.bucket_id, [...(grouped.get(file.bucket_id) ?? []), file.name]);
      for (const [bucket, paths] of grouped) {
        for (let i = 0; i < paths.length; i += 100) {
          const { error: removeError } = await admin.storage.from(bucket).remove(paths.slice(i, i + 100));
          if (removeError) throw removeError;
        }
      }
    }
    stage = "data";
    const { error: purgeError } = await admin.rpc("purge_account_data", { p_user_id: user.id });
    if (purgeError) throw purgeError;
    stage = "identity";
    const { error: authError } = await admin.auth.admin.deleteUser(user.id);
    if (authError) throw authError;
    return respond({ ok: true });
  } catch {
    // Do not log PII, tokens, storage paths or payloads.
    console.error("delete-account failed at stage:", stage);
    return respond({ error: "deletion_failed", stage }, 500);
  }
});