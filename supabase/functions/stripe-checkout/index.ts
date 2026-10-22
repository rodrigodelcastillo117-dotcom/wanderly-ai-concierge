// Crea una Checkout Session de Stripe para IATOS PRO. Prueba de Stripe de 30 días solo la primera
// vez; durante la prueba sin tarjeta (DEC-02) no se cobra hasta que termine. Reglas en logic.ts.
import Stripe from "https://esm.sh/stripe@17.7.0?target=deno";
import { getAuthUser, unauthorizedResponse } from "../_shared/verify-auth.ts";
import { adminClient } from "../_shared/entitlements.ts";
import { checkoutSessionParams, expireOpenSessions, planCheckout, priceProblems, type StripePriceLike } from "./logic.ts";
import { safeOrigin } from "../_shared/origin.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
const STRIPE_PRICE_ID = Deno.env.get("STRIPE_PRICE_ID") ?? "";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const user = await getAuthUser(req);
  if (!user) return unauthorizedResponse(corsHeaders);

  if (!STRIPE_SECRET_KEY || !STRIPE_PRICE_ID) {
    return new Response(
      JSON.stringify({
        error: "stripe_not_configured",
        message: "Faltan los secrets STRIPE_SECRET_KEY y/o STRIPE_PRICE_ID.",
      }),
      { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  try {
    const body = await req.json().catch(() => ({}));
    // Solo regresamos a dominios propios (antes se usaba cualquier origin del cuerpo).
    const origin = safeOrigin(body?.origin ?? req.headers.get("origin"));

    const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2024-12-18.acacia" });
    const db = adminClient();

    const { data: existing, error: readErr } = await db
      .from("subscriptions")
      .select("stripe_customer_id, stripe_subscription_id, status, trial_end, current_period_end")
      .eq("user_id", user.id)
      .maybeSingle();
    if (readErr) throw new Error(`lectura de suscripción: ${readErr.message}`);

    // No abrir un segundo checkout a quien ya tiene PRO (activo, en prueba, con pago pendiente o de
    // cortesía): duplicaba cobros y el webhook de la suscripción vieja le quitaba PRO a la nueva.
    // Tampoco regalar otra prueba de 30 días a quien ya tuvo una (logic.ts).
    const plan = await planCheckout(existing, async (customer) => {
      const list = await stripe.subscriptions.list({ customer, status: "all", limit: 20 });
      return list.data.map((s: Stripe.Subscription) => ({ id: s.id, status: s.status, trial_start: s.trial_start, trial_end: s.trial_end }));
    });
    if (plan.kind === "blocked") {
      return new Response(
        JSON.stringify({ error: "already_subscribed", reason: plan.block.reason, message: plan.block.message, portal: plan.block.portal }),
        { status: plan.block.status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // AUD-08: el precio de Stripe debe ser la oferta publicada ($99 MXN al mes, IVA incluido). Se revisa
    // ANTES de crear nada en Stripe; si no coincide, no se abre el pago (falla cerrado).
    const problems = priceProblems(await stripe.prices.retrieve(STRIPE_PRICE_ID).catch(() => null) as unknown as StripePriceLike);
    if (problems.length) {
      console.error("stripe-checkout: el precio configurado no coincide con la oferta publicada:", STRIPE_PRICE_ID, problems.join("; "));
      return new Response(JSON.stringify({
        error: "price_mismatch",
        message: "No pudimos abrir el pago en este momento. Intenta de nuevo más tarde; no se hizo ningún cargo.",
      }), { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    let customerId = existing?.stripe_customer_id ?? null;
    if (!customerId) {
      // La llave de idempotencia evita dos customers si el usuario da doble clic (24 h en Stripe).
      const customer = await stripe.customers.create(
        { email: user.email, metadata: { supabase_user_id: user.id } },
        { idempotencyKey: `iatos-customer-${user.id}` },
      );
      customerId = customer.id;
      const { error: upErr } = await db.from("subscriptions").upsert(
        { user_id: user.id, stripe_customer_id: customerId, status: existing?.status ?? "incomplete", plan: "pro", currency: "MXN" },
        { onConflict: "user_id" },
      );
      if (upErr) throw new Error(`guardar customer: ${upErr.message}`);
    }

    // Dos pestañas = dos checkouts = dos suscripciones cobradas: se cierran las sesiones abiertas.
    const ex = await expireOpenSessions(
      customerId,
      async (customer) => (await stripe.checkout.sessions.list({ customer, status: "open", limit: 10 })).data,
      (id) => stripe.checkout.sessions.expire(id),
    );
    if (ex.failed) console.warn("stripe-checkout: no se pudieron expirar sesiones abiertas", ex);

    const session = await stripe.checkout.sessions.create(checkoutSessionParams({
      customerId, userId: user.id, priceId: STRIPE_PRICE_ID, origin,
      trialDays: plan.trialDays, trialEndUnix: plan.trialEndUnix ?? null,
    }));

    return new Response(JSON.stringify({ url: session.url, trial_days: plan.trialDays ?? 0 }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("stripe-checkout error:", (e as Error).message);
    return new Response(JSON.stringify({
      error: "checkout_failed",
      message: "No pudimos abrir el pago en este momento. Intenta de nuevo en unos minutos.",
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
