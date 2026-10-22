// Crea una Checkout Session de Stripe para IATOS PRO. Prueba de Stripe de 30 días solo la primera
// vez; durante la prueba sin tarjeta (DEC-02) no se cobra hasta que termine. Reglas en logic.ts.
import Stripe from "https://esm.sh/stripe@17.7.0?target=deno";
import { getAuthUser, unauthorizedResponse } from "../_shared/verify-auth.ts";
import { adminClient } from "../_shared/entitlements.ts";
import type { StripePriceLike } from "./logic.ts";
import { runCheckout } from "./flow.ts";
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

    // Toda la decisión vive en flow.ts (probada en src/test/stripeCheckoutFlow.test.ts).
    const out = await runCheckout({ userId: user.id, email: user.email ?? null, priceId: STRIPE_PRICE_ID, origin }, {
      readSubscription: async (userId) => {
        const { data, error } = await db
          .from("subscriptions")
          .select("stripe_customer_id, stripe_subscription_id, status, trial_end, current_period_end")
          .eq("user_id", userId)
          .maybeSingle();
        if (error) throw new Error(`lectura de suscripción: ${error.message}`);
        return data;
      },
      listSubscriptions: async (customer) => {
        const list = await stripe.subscriptions.list({ customer, status: "all", limit: 20 });
        return list.data.map((s: Stripe.Subscription) => ({ id: s.id, status: s.status, trial_start: s.trial_start, trial_end: s.trial_end }));
      },
      retrievePrice: async (id) => await stripe.prices.retrieve(id) as unknown as StripePriceLike,
      // La llave de idempotencia evita dos customers si el usuario da doble clic (24 h en Stripe).
      createCustomer: async (email, userId) =>
        (await stripe.customers.create(
          { email: email ?? undefined, metadata: { supabase_user_id: userId } },
          { idempotencyKey: `iatos-customer-${userId}` },
        )).id,
      saveCustomer: async (row) => {
        const { error } = await db.from("subscriptions").upsert(row, { onConflict: "user_id" });
        if (error) throw new Error(`guardar customer: ${error.message}`);
      },
      listOpenSessions: async (customer) => (await stripe.checkout.sessions.list({ customer, status: "open", limit: 10 })).data,
      expireSession: (id) => stripe.checkout.sessions.expire(id),
      createSession: async (params) => {
        const session = await stripe.checkout.sessions.create(params as unknown as Stripe.Checkout.SessionCreateParams);
        return { url: session.url };
      },
      log: (...a) => console.error(...a),
    });

    return new Response(JSON.stringify(out.body), {
      status: out.status,
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
