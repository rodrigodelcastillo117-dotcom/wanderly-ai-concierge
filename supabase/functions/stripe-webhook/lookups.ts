// Búsquedas en Stripe que el webhook necesita y que el SDK fijado (acacia) no cubre. Sin Deno ni SDK
// (se prueba con Vitest: src/test/stripeInvoiceLookup.test.ts).

export type InvoicePaymentsResponse = { ok: boolean; status: number; json(): Promise<unknown> };

/**
 * Factura de un PaymentIntent: en 2024-12-18.acacia viene en payment_intent.invoice; en versiones
 * nuevas (basil en adelante) hay que buscarla en /v1/invoice_payments.
 * D-P3-4: si Stripe responde con un HTTP no-OK se LANZA (el webhook responde 500 y Stripe reintenta).
 * Antes se devolvía null, que significa "el cargo no tiene factura": un reembolso total quedaba como
 * reembolso_total_sin_suscripcion con 200, sin revocar y registrado como hecho.
 * null solo cuando Stripe responde 200 y de verdad no hay factura.
 */
export async function invoiceForPaymentIntentWith(
  paymentIntentId: string,
  deps: {
    retrievePaymentIntent(id: string): Promise<{ invoice?: string | { id: string } | null }>;
    fetchInvoicePayments(query: string): Promise<InvoicePaymentsResponse>;
  },
): Promise<string | null> {
  const intent = await deps.retrievePaymentIntent(paymentIntentId);
  const direct = typeof intent.invoice === "string" ? intent.invoice : intent.invoice?.id ?? null;
  if (direct) return direct;
  const qs = new URLSearchParams({ "payment[type]": "payment_intent", "payment[payment_intent]": paymentIntentId, limit: "1" });
  const res = await deps.fetchInvoicePayments(qs.toString());
  if (!res.ok) throw new Error(`invoice_payments respondió HTTP ${res.status}: no se pudo ubicar la factura del cargo`);
  const j = (await res.json()) as { data?: Array<{ invoice?: string | { id: string } | null }> } | null;
  const inv = j?.data?.[0]?.invoice;
  return typeof inv === "string" ? inv : inv?.id ?? null;
}
