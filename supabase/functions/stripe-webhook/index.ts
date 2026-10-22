// Webhook de Stripe. Único endpoint público: valida la FIRMA de Stripe antes de tocar nada.
// Fail-closed: sin STRIPE_WEBHOOK_SECRET configurado, rechaza todo.
// Si la base no acepta el cambio responde 500 para que Stripe reintente (ver handler.ts).
import Stripe from "https://esm.sh/stripe@17.7.0?target=deno";
import { adminClient } from "../_shared/entitlements.ts";
import { escapeHtml, layout, sendEmail } from "../_shared/email.ts";
import { isAlreadyGone } from "../_shared/stripe-billing.ts";
import { redactPii } from "../_shared/redact.ts";
import { missingRpcAsSkip } from "../_shared/prive-tenure.ts";
import { deliverAdminAlert } from "./alerts.ts";
import { invoiceForPaymentIntentWith } from "./lookups.ts";
import type { AdminAlert, StripeChargeLike } from "./payments.ts";
import {
  cardFingerprintFrom,
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
    // IATOS Privé: periodos pagados (antigüedad) y su estado ante reembolsos y disputas.
    // D-P2-2: una prueba de 30 días por tarjeta (huella de la tarjeta guardada por Checkout).
    cardFingerprint: (sub) =>
      cardFingerprintFrom(sub, {
        retrievePaymentMethod: (id) => stripe.paymentMethods.retrieve(id) as unknown as Promise<{ card?: { fingerprint?: string | null } | null }>,
        retrieveCustomerDefaultPaymentMethod: async (customerId) => {
          const c = await stripe.customers.retrieve(customerId) as unknown as {
            deleted?: boolean;
            invoice_settings?: { default_payment_method?: string | { id: string } | null } | null;
          };
          const pm = c.deleted ? null : c.invoice_settings?.default_payment_method ?? null;
          return typeof pm === "string" ? pm : pm?.id ?? null;
        },
      }),
    claimTrialFingerprint: (args) => adminClient().rpc("claim_trial_fingerprint", args),
    endTrialNow: async (id) => {
      await stripe.subscriptions.update(id, { trial_end: "now", proration_behavior: "none" });
    },
    recordPaidPeriod: async (args) =>
      missingRpcAsSkip(await adminClient().rpc("prive_record_paid_period", args), "prive_record_paid_period", console.warn),
    markPaidPeriod: async (args) =>
      missingRpcAsSkip(await adminClient().rpc("prive_mark_paid_period", args), "prive_mark_paid_period", console.warn),
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
    // AUD-05: registro + antigüedad en una transacción (llave = event_id). Si la migración
    // 20261024051500 aún no está aplicada, se usa la ruta anterior (marcar y luego registrar).
    commitPaymentEvent: async (row, tenureEvent, amountRefunded) => {
      const db = adminClient();
      const r = await db.rpc("stripe_commit_payment_event", { _row: row, _tenure_event: tenureEvent, _amount_refunded: amountRefunded });
      if (!r.error || !/stripe_commit_payment_event|PGRST202|does not exist|Could not find the function/i.test(`${r.error.code ?? ""} ${r.error.message}`)) return r;
      console.warn("stripe-webhook: stripe_commit_payment_event no existe todavía (migración 20261024051500 pendiente)");
      let tenure: unknown = null;
      if (tenureEvent && row.invoice_id) {
        const m = missingRpcAsSkip(await db.rpc("prive_mark_paid_period", { _invoice_id: row.invoice_id, _event: tenureEvent, _amount_refunded: amountRefunded }), "prive_mark_paid_period", console.warn);
        if (m.error) return m;
        tenure = m.data;
      }
      const { error } = await db.from("stripe_payment_events").upsert(row, { onConflict: "event_id", ignoreDuplicates: true });
      return { data: { logged: !error, duplicate: false, tenure }, error };
    },
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

// Factura de un PaymentIntent (lookups.ts; D-P3-4: un HTTP no-OK lanza y el webhook responde 500).
function invoiceForPaymentIntent(stripe: Stripe, pi: string): Promise<string | null> {
  return invoiceForPaymentIntentWith(pi, {
    retrievePaymentIntent: (id) => stripe.paymentIntents.retrieve(id) as unknown as Promise<{ invoice?: string | { id: string } | null }>,
    fetchInvoicePayments: (qs) =>
      fetch(`https://api.stripe.com/v1/invoice_payments?${qs}`, { headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}` } }),
  });
}

// Aviso a administradores: campana (notify_admins, una vez por evento) y correo si hay Resend y
// destinatario (HEALTH_ALERT_EMAIL o los correos de admins). La decisión está en alerts.ts
// (D-P3-3: sin administradores no cuenta como enviado). Nunca lanza.
function alertAdmins(alert: AdminAlert): Promise<string> {
  const db = adminClient();
  return deliverAdminAlert(alert, {
    notifyAdmins: (a) => db.rpc("notify_admins", { _dedup_key: a.key, _title: a.title, _body: a.body }),
    emailConfigured: Boolean(Deno.env.get("RESEND_API_KEY")),
    fixedRecipients: (Deno.env.get("HEALTH_ALERT_EMAIL") ?? "").split(",").map((x) => x.trim()).filter(Boolean),
    adminEmails: async () => {
      const out: string[] = [];
      const { data: admins } = await db.from("admins").select("user_id");
      for (const a of admins ?? []) {
        const { data } = await db.auth.admin.getUserById((a as { user_id: string }).user_id);
        if (data?.user?.email) out.push(data.user.email);
      }
      return out;
    },
    sendEmail: async (to, a) =>
      (await sendEmail({ to, subject: `[IATOS] ${a.title}`, html: layout(escapeHtml(a.title), `<p>${escapeHtml(a.body)}</p>`) })).ok,
    logError: (msg, detail) => console.error(msg, redactPii(String(detail ?? ""))),
  });
}
