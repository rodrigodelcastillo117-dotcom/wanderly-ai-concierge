// Periodo PAGADO de una factura de Stripe (para la antigüedad de IATOS Privé). Puro: lo usan
// stripe-webhook (invoice.paid) y prive-tenure-backfill. Probado en src/test/priveTenure.test.ts.
//
// Reglas (docs/iatos/IATOS_PRIVE_MEMBERSHIP_POLICY.md):
//   * Solo facturas con amount_paid > 0. Una prueba gratis o un cupón del 100 % generan facturas de
//     $0: nunca cuentan.
//   * El periodo es el de los renglones de la SUSCRIPCIÓN con monto > 0 (desde el inicio más
//     temprano hasta el fin más tardío). No se usa invoice.period_start/end: en Stripe ese es el
//     periodo ANTERIOR (cobro por adelantado de la suscripción, por atrasado del uso).
//   * Los renglones de prorrateo negativos (crédito por el plan anterior) se ignoran; los positivos
//     cuentan y la base une periodos encimados sin contarlos dos veces.

type IdLike = string | { id: string } | null | undefined;
const idOf = (v: IdLike): string | null => (typeof v === "string" ? v : v?.id ?? null);

export type StripeInvoiceLineLike = {
  amount?: number | null;
  type?: string | null;
  proration?: boolean | null;
  subscription?: IdLike;
  period?: { start?: number | null; end?: number | null } | null;
  parent?: { type?: string | null; subscription_item_details?: { subscription?: string | null } | null } | null;
};

export type StripePaidInvoiceLike = {
  id: string;
  status?: string | null;
  amount_paid?: number | null;
  currency?: string | null;
  customer?: IdLike;
  subscription?: IdLike;
  parent?: { subscription_details?: { subscription?: IdLike } | null } | null;
  lines?: { data?: StripeInvoiceLineLike[] | null; has_more?: boolean | null } | null;
  metadata?: Record<string, string> | null;
};

export type PaidPeriod = {
  invoiceId: string;
  subscriptionId: string | null;
  customerId: string | null;
  start: string;
  end: string;
  amountPaid: number;
  currency: string | null;
};

export type PaidPeriodResult = { ok: true; period: PaidPeriod } | { ok: false; reason: "zero_amount" | "no_period" | "not_paid" };

const isSubscriptionLine = (l: StripeInvoiceLineLike) =>
  l.type === "subscription" || !!idOf(l.subscription) || l.parent?.type === "subscription_item_details" ||
  !!l.parent?.subscription_item_details?.subscription;

export function paidPeriodFromInvoice(inv: StripePaidInvoiceLike): PaidPeriodResult {
  if (inv.status && inv.status !== "paid") return { ok: false, reason: "not_paid" };
  const amount = typeof inv.amount_paid === "number" ? inv.amount_paid : 0;
  if (!(amount > 0)) return { ok: false, reason: "zero_amount" };
  const lines = (inv.lines?.data ?? []).filter((l) =>
    isSubscriptionLine(l) && (l.amount ?? 0) > 0 && typeof l.period?.start === "number" && typeof l.period?.end === "number" &&
    (l.period.end as number) > (l.period.start as number)
  );
  if (!lines.length) return { ok: false, reason: "no_period" };
  const start = Math.min(...lines.map((l) => l.period!.start as number));
  const end = Math.max(...lines.map((l) => l.period!.end as number));
  const subscriptionId = idOf(inv.subscription) ?? idOf(inv.parent?.subscription_details?.subscription) ??
    lines.map((l) => idOf(l.subscription) ?? l.parent?.subscription_item_details?.subscription ?? null).find(Boolean) ?? null;
  return {
    ok: true,
    period: {
      invoiceId: inv.id,
      subscriptionId,
      customerId: idOf(inv.customer),
      start: new Date(start * 1000).toISOString(),
      end: new Date(end * 1000).toISOString(),
      amountPaid: amount,
      currency: inv.currency ? inv.currency.toUpperCase() : null,
    },
  };
}

/** ¿El payload del evento trae lo necesario o hay que leer la factura completa de Stripe? */
export function invoiceNeedsRetrieve(inv: StripePaidInvoiceLike): boolean {
  return typeof inv.amount_paid !== "number" || !inv.lines?.data?.length || inv.lines?.has_more === true;
}

/** Argumentos de public.prive_record_paid_period. */
export function recordArgs(p: PaidPeriod, userId: string | null, source: "webhook" | "backfill") {
  return {
    _user: userId,
    _invoice_id: p.invoiceId,
    _subscription_id: p.subscriptionId,
    _customer_id: p.customerId,
    _period_start: p.start,
    _period_end: p.end,
    _amount_paid: p.amountPaid,
    _currency: p.currency,
    _source: source,
  };
}

export type RecordPaidPeriodArgs = ReturnType<typeof recordArgs>;

/** Evento de antigüedad para prive_mark_paid_period según la decisión de payments.ts. */
export type TenureEvent = "refund_full" | "refund_partial" | "dispute_opened" | "dispute_lost" | "dispute_won";

export function tenureEventFor(eventType: string, opts: { fullRefund?: boolean; disputeStatus?: string | null }): TenureEvent | null {
  if (eventType === "charge.refunded") return opts.fullRefund ? "refund_full" : "refund_partial";
  if (eventType === "charge.dispute.created") return "dispute_opened";
  if (eventType === "charge.dispute.closed") {
    if (opts.disputeStatus === "lost") return "dispute_lost";
    // warning_closed = consulta que nunca se volvió contracargo: el periodo vuelve a contar.
    if (opts.disputeStatus === "won" || opts.disputeStatus === "warning_closed") return "dispute_won";
  }
  return null;
}

type RpcOutcome = { data: unknown; error: { message: string; code?: string } | null };

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * D-P3-5: ¿el error dice EXACTAMENTE que la función llamada (`fn`) no existe? Solo dos formas:
 *   - PostgREST, la función no está en su caché: code PGRST202, "Could not find the function public.fn(…)".
 *   - Postgres, la función de nivel superior no existe: code 42883, "function public.fn(…) does not exist".
 * Antes bastaba con que el mensaje contuviera el nombre de la función o "does not exist": los RAISE
 * propios de la función (que empiezan con su nombre) o una tabla interna inexistente se tomaban como
 * "migración pendiente" y el webhook respondía 200 sin aplicar nada.
 */
export function isMissingFunctionError(error: { message?: string | null; code?: string | null } | null | undefined, fn: string): boolean {
  if (!error) return false;
  const msg = String(error.message ?? "");
  const name = `(?:public\\.)?${escapeRe(fn)}`;
  // PostgREST: "Could not find the function public.fn(_a, _b) in the schema cache" (o "… without parameters").
  if (error.code === "PGRST202") return new RegExp(`^Could not find the function ${name}(?=\\(|\\s|$)`, "i").test(msg);
  if (error.code === "42883") return new RegExp(`^function ${name}\\([^)]*\\) does not exist$`, "i").test(msg);
  return false;
}

/**
 * Si la función se publicó antes que la migración de Privé, la RPC no existe: no es motivo para que
 * Stripe reintente para siempre (el acceso PRO ya quedó escrito). Se registra y se sigue; el
 * respaldo (prive-tenure-backfill) recupera esas facturas después. Cualquier otro error sigue siendo
 * error (D-P3-5).
 */
export function missingRpcAsSkip(r: RpcOutcome, fn: string, warn: (...a: unknown[]) => void = () => {}): RpcOutcome {
  if (isMissingFunctionError(r.error, fn)) {
    warn(`stripe-webhook: ${fn} no existe todavía (migración de Privé pendiente)`);
    return { data: { recorded: false, applied: false, reason: "migration_pending" }, error: null };
  }
  return r;
}
