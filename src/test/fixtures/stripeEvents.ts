// Eventos de Stripe con la forma documentada para la versión de API del endpoint
// (2024-12-18.acacia, la que fija supabase/functions/stripe-webhook/index.ts). Ids y montos
// inventados para pruebas; sin datos personales. En acacia el Charge todavía trae `invoice` y la
// Subscription `current_period_end`; en basil (2025-03-31+) el cargo ya no trae `invoice` (se
// busca por payment_intent), caso que también cubre la prueba "sin invoice en el cargo".
export const API_VERSION = "2024-12-18.acacia";
export const T0 = 1_792_000_000; // segundos

const envelope = (id: string, type: string, created: number, object: unknown) => ({
  id, object: "event", api_version: API_VERSION, created, livemode: false, pending_webhooks: 1,
  request: { id: null, idempotency_key: null }, type, data: { object },
});

export const subscription = (o: Record<string, unknown> = {}) => ({
  id: "sub_1QTest", object: "subscription", status: "active", customer: "cus_RTest", currency: "mxn",
  cancel_at_period_end: false, current_period_start: T0 - 86400, current_period_end: T0 + 29 * 86400,
  latest_invoice: "in_1QLatest", metadata: { supabase_user_id: "u-pago" }, trial_end: null,
  items: { object: "list", data: [{ id: "si_1", object: "subscription_item", current_period_end: T0 + 29 * 86400, price: { id: "price_pro_mxn", object: "price", currency: "mxn", unit_amount: 9900 } }] },
  ...o,
});

export const invoice = (o: Record<string, unknown> = {}) => ({
  id: "in_1QLatest", object: "invoice", status: "paid", customer: "cus_RTest", subscription: "sub_1QTest",
  billing_reason: "subscription_cycle", charge: "ch_3QTest", payment_intent: "pi_3QTest", amount_paid: 9900, currency: "mxn",
  ...o,
});

export const charge = (o: Record<string, unknown> = {}) => ({
  id: "ch_3QTest", object: "charge", amount: 9900, amount_captured: 9900, amount_refunded: 9900, captured: true,
  currency: "mxn", customer: "cus_RTest", invoice: "in_1QLatest", payment_intent: "pi_3QTest", paid: true,
  refunded: true, status: "succeeded", disputed: false,
  refunds: { object: "list", data: [{ id: "re_3QTest", object: "refund", amount: 9900, charge: "ch_3QTest", currency: "mxn", status: "succeeded" }], has_more: false },
  ...o,
});

export const dispute = (o: Record<string, unknown> = {}) => ({
  id: "dp_1QTest", object: "dispute", amount: 9900, balance_transactions: [], charge: "ch_3QTest", currency: "mxn",
  created: T0, evidence_details: { due_by: T0 + 7 * 86400, has_evidence: false, past_due: false, submission_count: 0 },
  is_charge_refundable: false, livemode: false, metadata: {}, payment_intent: "pi_3QTest", reason: "fraudulent",
  status: "needs_response", ...o,
});

export const chargeRefunded = (o: Record<string, unknown> = {}, id = "evt_refund_1", created = T0 + 100) =>
  envelope(id, "charge.refunded", created, charge(o));
export const disputeCreated = (o: Record<string, unknown> = {}, id = "evt_dispute_open", created = T0 + 200) =>
  envelope(id, "charge.dispute.created", created, dispute(o));
export const disputeClosed = (status: "won" | "lost" | "warning_closed", id = `evt_dispute_${status}`, created = T0 + 300) =>
  envelope(id, "charge.dispute.closed", created, dispute({ status }));
export const invoicePaid = (id = "evt_invoice_paid", created = T0) => envelope(id, "invoice.paid", created, invoice());
export const subscriptionUpdated = (id = "evt_sub_updated", created = T0 + 400) =>
  envelope(id, "customer.subscription.updated", created, subscription());
