// Webhook de Stripe. Único endpoint público: valida la FIRMA de Stripe antes de tocar nada.
// Fail-closed: sin STRIPE_WEBHOOK_SECRET configurado, rechaza todo.
// Si la base no acepta el cambio responde 500 para que Stripe reintente (ver handler.ts).
import Stripe from "https://esm.sh/stripe@17.7.0?target=deno";
import { adminClient } from "../_shared/entitlements.ts";
import { escapeHtml, layout, sendEmail } from "../_shared/email.ts";
import { isAlreadyGone } from "../_shared/stripe-billing.ts";
import { redactPii } from "../_shared/redact.ts";
import type { AdminAlert, StripeChargeLike } from "./payments.ts";
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
    // Reembolsos y disputas (payments.ts): estado vivo de Stripe, revocación sin dar PRO, aviso a
    // administradores, idempotencia por event_id y trazabilidad sin datos personales.
    retrieveCharge: (id) => stripe.charges.retrieve(id) as unknown as Promise<StripeChargeLike>,
    invoiceForPaymentIntent: (pi) => invoiceForPaymentIntent(stripe, pi),
    cancelSubscriptionNow: async (id) => {
      try {
        await stripe.subscriptions.cancel(id);
      } catch (e) {
        const err = e as { statusCode?: number; code?: string; message?: string };
        if (!isAlreadyGone({ ok: false, httpStatus: err.statusCode ?? 0, code: err.code, message: err.message })) throw e;
      }
    },
    revokePaidAccess: (args) => adminClient().rpc("revoke_paid_access", args),
    accessSnapshot: (userId) => adminClient().rpc("access_snapshot", { _user_id: userId }),
    findPaymentEvent: (eventId) =>
      adminClient().from("stripe_payment_events").select("action").eq("event_id", eventId).maybeSingle(),
    logPaymentEvent: (row) =>
      adminClient().from("stripe_payment_events").upsert(row, { onConflict: "event_id", ignoreDuplicates: true }),
    isDeletedCustomer: async (customerId) => {
      const { data, error } = await adminClient().rpc("is_deleted_stripe_customer", { _customer_id: customerId });
      // Si la migración aún no está aplicada no hay cuentas registradas como borradas.
      if (error && /is_deleted_stripe_customer|PGRST202|does not exist/i.test(`${error.code ?? ""} ${error.message}`)) return false;
      if (error) throw new Error(error.message);
      return data === true;
    },
    alertAdmins,
  });

  return new Response(JSON.stringify(outcome.body), {
    status: outcome.status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});

// Factura de un PaymentIntent: en 2024-12-18.acacia viene en payment_intent.invoice; en versiones
// nuevas (basil en adelante) hay que buscarla en /v1/invoice_payments.
async function invoiceForPaymentIntent(stripe: Stripe, pi: string): Promise<string | null> {
  const intent = await stripe.paymentIntents.retrieve(pi) as unknown as { invoice?: string | { id: string } | null };
  const direct = typeof intent.invoice === "string" ? intent.invoice : intent.invoice?.id ?? null;
  if (direct) return direct;
  const qs = new URLSearchParams({ "payment[type]": "payment_intent", "payment[payment_intent]": pi, limit: "1" });
  const res = await fetch(`https://api.stripe.com/v1/invoice_payments?${qs}`, { headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}` } });
  if (!res.ok) return null;
  const j = await res.json() as { data?: Array<{ invoice?: string | { id: string } | null }> };
  const inv = j.data?.[0]?.invoice;
  return typeof inv === "string" ? inv : inv?.id ?? null;
}

// Aviso a administradores: campana (notify_admins, una vez por evento) y correo si hay Resend y
// destinatario (HEALTH_ALERT_EMAIL o los correos de admins). Nunca lanza: un aviso fallido no
// debe hacer que Stripe reintente el evento.
async function alertAdmins(alert: AdminAlert): Promise<string> {
  let status = "sin_aviso";
  try {
    const db = adminClient();
    const { data: n, error } = await db.rpc("notify_admins", { _dedup_key: alert.key, _title: alert.title, _body: alert.body });
    if (error) throw new Error(error.message);
    status = Number(n) > 0 ? "campana" : "campana_ya_enviada";
    if (Number(n) > 0 && Deno.env.get("RESEND_API_KEY")) {
      const to: string[] = [];
      const fixed = (Deno.env.get("HEALTH_ALERT_EMAIL") ?? "").split(",").map((x) => x.trim()).filter(Boolean);
      if (fixed.length) to.push(...fixed);
      else {
        const { data: admins } = await db.from("admins").select("user_id");
        for (const a of admins ?? []) {
          const { data } = await db.auth.admin.getUserById((a as { user_id: string }).user_id);
          if (data?.user?.email) to.push(data.user.email);
        }
      }
      let sent = 0;
      for (const address of to) {
        const r = await sendEmail({ to: address, subject: `[IATOS] ${alert.title}`, html: layout(escapeHtml(alert.title), `<p>${escapeHtml(alert.body)}</p>`) });
        if (r.ok) sent++;
      }
      status = to.length ? (sent === to.length ? "campana_y_correo" : "campana_correo_parcial") : status;
    }
  } catch (e) {
    console.error("webhook: aviso a administradores falló", redactPii((e as Error).message));
    status = "fallido";
  }
  return status;
}
