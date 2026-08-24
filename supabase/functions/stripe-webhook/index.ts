// Webhook de Stripe. Único endpoint público: valida la FIRMA de Stripe antes de tocar nada.
// Fail-closed: sin STRIPE_WEBHOOK_SECRET configurado, rechaza todo.
import Stripe from "https://esm.sh/stripe@17.7.0?target=deno";
import { adminClient } from "../_shared/entitlements.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, stripe-signature",
};

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
const STRIPE_WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET") ?? "";

function tsToIso(v: number | null | undefined): string | null {
  return typeof v === "number" && v > 0 ? new Date(v * 1000).toISOString() : null;
}

async function upsertFromSubscription(sub: Stripe.Subscription, fallbackUserId?: string | null) {
  const userId =
    (sub.metadata?.supabase_user_id as string | undefined) ?? fallbackUserId ?? null;
  const db = adminClient();

  const row = {
    status: sub.status,
    stripe_subscription_id: sub.id,
    stripe_customer_id: typeof sub.customer === "string" ? sub.customer : sub.customer?.id ?? null,
    trial_end: tsToIso(sub.trial_end),
    current_period_end: tsToIso((sub as unknown as { current_period_end?: number }).current_period_end),
    cancel_at_period_end: Boolean(sub.cancel_at_period_end),
    price_id: sub.items?.data?.[0]?.price?.id ?? null,
    currency: (sub.currency ?? "mxn").toUpperCase(),
    plan: "pro",
    updated_at: new Date().toISOString(),
  };

  if (userId) {
    await db.from("subscriptions").upsert({ user_id: userId, ...row }, { onConflict: "user_id" });
  } else if (row.stripe_customer_id) {
    await db.from("subscriptions").update(row).eq("stripe_customer_id", row.stripe_customer_id);
  } else {
    console.warn("webhook: subscription sin user_id ni customer", sub.id);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  if (!STRIPE_SECRET_KEY || !STRIPE_WEBHOOK_SECRET) {
    console.error("webhook: secrets de Stripe no configurados");
    return new Response(JSON.stringify({ error: "not_configured" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return new Response(JSON.stringify({ error: "missing_signature" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2024-12-18.acacia" });
  const payload = await req.text();

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(payload, signature, STRIPE_WEBHOOK_SECRET);
  } catch (e) {
    console.error("webhook: firma inválida:", (e as Error).message);
    return new Response(JSON.stringify({ error: "invalid_signature" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const userId = (session.client_reference_id as string | null) ??
          (session.metadata?.supabase_user_id as string | undefined) ?? null;
        const subId = typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
        if (subId) {
          const sub = await stripe.subscriptions.retrieve(subId);
          await upsertFromSubscription(sub, userId);
        }
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        if (event.type === "customer.subscription.deleted") {
          sub.status = "canceled";
        }
        await upsertFromSubscription(sub);
        break;
      }
      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        const customerId = typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id;
        if (customerId) {
          await adminClient()
            .from("subscriptions")
            .update({ status: "past_due", updated_at: new Date().toISOString() })
            .eq("stripe_customer_id", customerId);
        }
        break;
      }
      default:
        break;
    }
  } catch (e) {
    console.error("webhook handler error:", (e as Error).message);
    return new Response(JSON.stringify({ error: "handler_failed" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
