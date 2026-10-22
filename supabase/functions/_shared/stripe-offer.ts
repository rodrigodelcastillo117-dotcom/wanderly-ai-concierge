// Oferta comercial de IATOS PRO tal como la ve Stripe (AUD-08, auditoría de cierre). Sin Deno ni
// SDK: la usan stripe-checkout (no abre el pago si el precio no coincide) y
// health-check?action=stripe_config (revisa la configuración del panel de Stripe con la llave del
// servidor, solo lectura). Probado en src/test/stripeCheckoutOffer.test.ts y stripeConfigProbe.test.ts.
// La landing, /dashboard/pro, los términos y los correos dicen "$99 MXN al mes, IVA incluido"
// (src/lib/planCopy.ts; una prueba verifica que coincida). Si el precio configurado en Stripe no es
// ese (otra moneda, otro monto, IVA por fuera, otra periodicidad), el checkout NO se abre: cobrar
// distinto a lo anunciado viola la LFPC (art. 7 Bis, precio total) y la confianza del cliente.
export const EXPECTED_PRICE = {
  currency: "mxn",
  unit_amount: 9900,
  tax_behavior: "inclusive",
  interval: "month",
  interval_count: 1,
} as const;

export type StripePriceLike = {
  id?: string;
  active?: boolean | null;
  currency?: string | null;
  unit_amount?: number | null;
  tax_behavior?: string | null;
  type?: string | null;
  recurring?: { interval?: string | null; interval_count?: number | null; usage_type?: string | null } | null;
} | null;

/** Diferencias entre el precio de Stripe y la oferta publicada ([] = coincide). Sin datos personales. */
export function priceProblems(price: StripePriceLike): string[] {
  if (!price) return ["price: no existe"];
  const p: string[] = [];
  if (price.active === false) p.push("active: el precio está archivado");
  if ((price.currency ?? "").toLowerCase() !== EXPECTED_PRICE.currency) p.push(`currency: ${price.currency} (se espera mxn)`);
  if (price.unit_amount !== EXPECTED_PRICE.unit_amount) p.push(`unit_amount: ${price.unit_amount} (se espera ${EXPECTED_PRICE.unit_amount})`);
  if (price.tax_behavior !== EXPECTED_PRICE.tax_behavior) p.push(`tax_behavior: ${price.tax_behavior} (se espera inclusive: IVA incluido)`);
  if (!price.recurring || (price.type && price.type !== "recurring")) p.push("recurring: no es una suscripción");
  else {
    if (price.recurring.interval !== EXPECTED_PRICE.interval || (price.recurring.interval_count ?? 1) !== EXPECTED_PRICE.interval_count) {
      p.push(`interval: ${price.recurring.interval_count ?? 1} ${price.recurring.interval} (se espera 1 month)`);
    }
    if (price.recurring.usage_type && price.recurring.usage_type !== "licensed") p.push(`usage_type: ${price.recurring.usage_type}`);
  }
  return p;
}


/** Versión de API con la que el código y las pruebas leen los eventos (stripe-webhook/index.ts). */
export const STRIPE_API_VERSION = "2024-12-18.acacia";

/** Eventos que stripe-webhook necesita recibir. Sin cualquiera de ellos hay efectos que no ocurren. */
export const REQUIRED_WEBHOOK_EVENTS = [
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.paid",
  "invoice.payment_failed",
  "charge.refunded",
  "charge.dispute.created",
  "charge.dispute.closed",
] as const;
/** Útiles pero no indispensables (el estado se relee de Stripe con los obligatorios). */
export const OPTIONAL_WEBHOOK_EVENTS = ["customer.subscription.paused", "customer.subscription.resumed", "invoice.payment_succeeded"] as const;

export type WebhookEndpointLike = { id?: string; url?: string | null; status?: string | null; api_version?: string | null; enabled_events?: string[] | null; livemode?: boolean | null };

/** Revisa el endpoint de Stripe que apunta a /functions/v1/stripe-webhook. */
export function webhookProblems(endpoints: WebhookEndpointLike[], urlSuffix = "/functions/v1/stripe-webhook"): { problems: string[]; warnings: string[]; endpointId: string | null } {
  const mine = endpoints.filter((e) => (e.url ?? "").replace(/\/+$/, "").endsWith(urlSuffix));
  if (!mine.length) return { problems: [`no hay endpoint que apunte a …${urlSuffix}`], warnings: [], endpointId: null };
  const problems: string[] = [];
  const warnings: string[] = [];
  if (mine.length > 1) warnings.push(`${mine.length} endpoints apuntan a stripe-webhook (cada evento llegaría varias veces; es inocuo pero confuso)`);
  const e = mine.find((x) => x.status === "enabled") ?? mine[0];
  if (e.status !== "enabled") problems.push(`el endpoint está ${e.status ?? "sin estado"}`);
  const events = new Set(e.enabled_events ?? []);
  if (!events.has("*")) {
    const missing = REQUIRED_WEBHOOK_EVENTS.filter((x) => !events.has(x));
    if (missing.length) problems.push(`faltan eventos: ${missing.join(", ")}`);
    const optional = OPTIONAL_WEBHOOK_EVENTS.filter((x) => !events.has(x));
    if (optional.length) warnings.push(`eventos opcionales no activados: ${optional.join(", ")}`);
  }
  if (!e.api_version) warnings.push(`el endpoint usa la versión de API por omisión de la cuenta; fíjala en ${STRIPE_API_VERSION}`);
  else if (e.api_version !== STRIPE_API_VERSION) problems.push(`versión de API ${e.api_version} (el código espera ${STRIPE_API_VERSION})`);
  return { problems, warnings, endpointId: e.id ?? null };
}

export type PortalConfigLike = {
  id?: string;
  is_default?: boolean | null;
  active?: boolean | null;
  business_profile?: { privacy_policy_url?: string | null; terms_of_service_url?: string | null } | null;
  features?: {
    subscription_cancel?: { enabled?: boolean | null; mode?: string | null; proration_behavior?: string | null } | null;
    subscription_update?: { enabled?: boolean | null; products?: Array<{ prices?: string[] | null }> | null } | null;
    payment_method_update?: { enabled?: boolean | null } | null;
    invoice_history?: { enabled?: boolean | null } | null;
  } | null;
} | null;

/**
 * El portal debe cumplir lo que dicen los términos: cancelar en cualquier momento, con acceso hasta
 * el fin del periodo pagado (Legal.tsx); cambiar la tarjeta; y no ofrecer otros planes o precios.
 */
export function portalProblems(cfg: PortalConfigLike, priceId: string | null): { problems: string[]; warnings: string[] } {
  if (!cfg) return { problems: ["no hay configuración por omisión del portal de clientes"], warnings: [] };
  const problems: string[] = [];
  const warnings: string[] = [];
  const f = cfg.features ?? {};
  if (!f.subscription_cancel?.enabled) problems.push("el portal no deja cancelar (los términos dicen que se puede cancelar en cualquier momento)");
  else if (f.subscription_cancel.mode !== "at_period_end") {
    problems.push(`cancelación "${f.subscription_cancel.mode}": los términos prometen conservar el acceso hasta el fin del periodo pagado (at_period_end)`);
  }
  if (!f.payment_method_update?.enabled) problems.push("el portal no deja cambiar la tarjeta (el aviso de pago pendiente manda ahí)");
  if (f.subscription_update?.enabled) {
    const prices = (f.subscription_update.products ?? []).flatMap((p) => p.prices ?? []);
    if (prices.some((p) => p !== priceId)) problems.push("el portal ofrece cambiar a otros precios/planes: no existen en IATOS y cualquier suscripción activa da PRO");
    else warnings.push("cambio de plan habilitado sin otros precios: conviene apagarlo");
  }
  if (!f.invoice_history?.enabled) warnings.push("historial de facturas apagado en el portal");
  if (!cfg.business_profile?.privacy_policy_url || !cfg.business_profile?.terms_of_service_url) {
    warnings.push("el portal no enlaza aviso de privacidad y/o términos (https://traveliatos.life/privacidad y /terminos)");
  }
  return { problems, warnings };
}

export type TaxSettingsLike = { status?: string | null; defaults?: { tax_behavior?: string | null } | null } | null;
export type TaxRegistrationLike = { country?: string | null; status?: string | null };

/** automatic_tax del checkout exige Stripe Tax activo; para desglosar IVA hace falta el registro en MX. */
export function taxProblems(settings: TaxSettingsLike, registrations: TaxRegistrationLike[]): { problems: string[]; warnings: string[] } {
  const problems: string[] = [];
  const warnings: string[] = [];
  if (!settings || settings.status !== "active") problems.push(`Stripe Tax no está activo (${settings?.status ?? "sin configurar"}): el checkout usa automatic_tax y fallaría`);
  if (!registrations.some((r) => (r.country ?? "").toUpperCase() === "MX" && r.status === "active")) {
    warnings.push("sin registro de impuestos activo en México: Stripe no desglosará el IVA en la factura (el total sigue siendo $99 con precio inclusive)");
  }
  return { problems, warnings };
}

export type StripeProductLike = { id?: string; name?: string | null; description?: string | null; active?: boolean | null; marketing_features?: Array<{ name?: string | null }> | null } | null;

/** Frases que la oferta no puede prometer (PROFECO, publicidad veraz; IATOS_PLAN_COMERCIAL.md riesgo 3). */
export const FORBIDDEN_CLAIMS = /sin\s+l[ií]mites?|ilimitad[oa]s?|unlimited|24\s*\/\s*7|\bvip\b/i;

/** El nombre y la descripción del producto aparecen en el checkout, el portal, las facturas y los recibos. */
export function productProblems(product: StripeProductLike): string[] {
  if (!product) return ["product: no existe"];
  const p: string[] = [];
  if (product.active === false) p.push("product: archivado");
  const texts = [product.name, product.description, ...(product.marketing_features ?? []).map((m) => m.name)].filter(Boolean) as string[];
  for (const t of texts) {
    const m = t.match(FORBIDDEN_CLAIMS);
    if (m) p.push(`product: el texto "${m[0]}" promete algo que el plan no garantiza (quítalo en Stripe → Productos)`);
  }
  return p;
}
