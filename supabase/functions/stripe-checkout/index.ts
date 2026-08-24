// Crea una Checkout Session de Stripe para IATOS PRO ($99 MXN/mes, trial 30 días con tarjeta).
import Stripe from "https://esm.sh/stripe@17.7.0?target=deno";
import { getAuthUser, unauthorizedResponse } from "../_shared/verify-auth.ts";
import { adminClient } from "../_shared/entitlements.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
const STRIPE_PRICE_ID = Deno.env.get("STRIPE_PRICE_ID") ?? "";
const TRIAL_DAYS = 30;

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
    const origin = (body?.origin as string) ?? req.headers.get("origin") ?? "https://traveliatos.life";

    const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2024-12-18.acacia" });
    const db = adminClient();

    // Reutiliza el customer si ya existe
    const { data: existing } = await db
      .from("subscriptions")
      .select("stripe_customer_id, status")
      .eq("user_id", user.id)
      .maybeSingle();

    let customerId = existing?.stripe_customer_id ?? null;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: { supabase_user_id: user.id },
      });
      customerId = customer.id;
      await db.from("subscriptions").upsert(
        { user_id: user.id, stripe_customer_id: customerId, status: existing?.status ?? "incomplete", plan: "pro", currency: "MXN" },
        { onConflict: "user_id" },
      );
    }

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      client_reference_id: user.id,
      line_items: [{ price: STRIPE_PRICE_ID, quantity: 1 }],
      subscription_data: {
        trial_period_days: TRIAL_DAYS,
        metadata: { supabase_user_id: user.id },
      },
      automatic_tax: { enabled: true },
      customer_update: { address: "auto" },
      allow_promotion_codes: true,
      success_url: `${origin}/dashboard/pro?checkout=success`,
      cancel_url: `${origin}/dashboard/pro?checkout=cancel`,
      metadata: { supabase_user_id: user.id },
    });

    return new Response(JSON.stringify({ url: session.url }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("stripe-checkout error:", (e as Error).message);
    return new Response(JSON.stringify({ error: "checkout_failed", message: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
