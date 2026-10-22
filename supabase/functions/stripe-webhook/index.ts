// Webhook de Stripe. Único endpoint público: valida la FIRMA de Stripe antes de tocar nada.
// Fail-closed: sin STRIPE_WEBHOOK_SECRET configurado, rechaza todo.
// Si la base no acepta el cambio responde 500 para que Stripe reintente (ver handler.ts).
import Stripe from "https://esm.sh/stripe@17.7.0?target=deno";
import { adminClient } from "../_shared/entitlements.ts";
import {
  handleStripeEvent,
  type StripeEventLike,
  type StripeInvoiceLike,
  type StripeSubscriptionLike,
} from "./handler.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, stripe-signature",
};

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
const STRIPE_WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET") ?? "";

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

  // Toda la lógica vive en handler.ts (probada en src/test/stripeWebhook.test.ts).
  const outcome = await handleStripeEvent(event as unknown as StripeEventLike, {
    retrieveSubscription: (id) => stripe.subscriptions.retrieve(id) as unknown as Promise<StripeSubscriptionLike>,
    retrieveInvoice: (id) => stripe.invoices.retrieve(id) as unknown as Promise<StripeInvoiceLike>,
    applySubscription: (args) => adminClient().rpc("apply_stripe_subscription", args),
    // Reembolsos y disputas (A-14): no renovar tras reembolso total y registro sin datos personales.
    updateSubscription: (id, params) => stripe.subscriptions.update(id, params) as unknown as Promise<StripeSubscriptionLike>,
    markCancelAtPeriodEnd: (id) => adminClient().rpc("mark_subscription_cancel_at_period_end", { _subscription_id: id }),
    logPaymentEvent: (row) =>
      adminClient().from("stripe_payment_events").upsert(row, { onConflict: "event_id", ignoreDuplicates: true }),
  });

  return new Response(JSON.stringify(outcome.body), {
    status: outcome.status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
