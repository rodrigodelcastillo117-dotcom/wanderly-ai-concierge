// Diagnóstico de la configuración de Stripe para vender IATOS PRO (AUD-08, auditoría de cierre).
// Lo corre health-check con ?action=stripe_config (misma protección: secreto de cron o llave de
// servicio). SOLO LECTURA: seis GET a la API de Stripe con la llave del servidor; no crea, cambia
// ni cobra nada, no guarda nada y no manda correo. Nunca devuelve la llave.
//
//   curl -X POST "$SUPABASE_URL/functions/v1/health-check?action=stripe_config" -H "x-cron-secret: $CRON_SECRET"
//
// Convierte en una revisión automática lo que antes había que mirar a mano en el panel: precio
// ($99 MXN/mes, IVA incluido), eventos y versión del webhook, portal de clientes y Stripe Tax.
// Sin dependencias de Deno: se prueba con Vitest y fetch simulado (src/test/stripeConfigProbe.test.ts).
import {
  priceProblems,
  portalProblems,
  productProblems,
  STRIPE_API_VERSION,
  taxProblems,
  webhookProblems,
  type PortalConfigLike,
  type StripePriceLike,
  type StripeProductLike,
  type TaxRegistrationLike,
  type TaxSettingsLike,
  type WebhookEndpointLike,
} from "../_shared/stripe-offer.ts";
import { redactSecrets } from "../_shared/redact.ts";

export type StripeCheck = { name: string; ok: boolean; problems: string[]; warnings: string[] };
export type StripeConfigReport = { ok: boolean; mode: "live" | "test" | "unknown"; checks: StripeCheck[] };

type Fetch = typeof fetch;

export async function probeStripeConfig(k: { stripeKey?: string; priceId?: string }, f: Fetch = fetch): Promise<StripeConfigReport> {
  if (!k.stripeKey) return { ok: false, mode: "unknown", checks: [{ name: "Llave", ok: false, problems: ["Falta STRIPE_SECRET_KEY"], warnings: [] }] };
  const mode = k.stripeKey.startsWith("sk_live_") || k.stripeKey.startsWith("rk_live_") ? "live"
    : k.stripeKey.startsWith("sk_test_") || k.stripeKey.startsWith("rk_test_") ? "test" : "unknown";
  const get = async (path: string): Promise<{ ok: boolean; status: number; body: any }> => {
    const r = await f(`https://api.stripe.com/v1/${path}`, {
      headers: { Authorization: `Bearer ${k.stripeKey}`, "Stripe-Version": STRIPE_API_VERSION },
      signal: AbortSignal.timeout(20000),
    });
    const body = await r.json().catch(() => null);
    return { ok: r.ok, status: r.status, body };
  };
  const safe = async (name: string, fn: () => Promise<Omit<StripeCheck, "name" | "ok">>): Promise<StripeCheck> => {
    try {
      const r = await fn();
      return { name, ok: r.problems.length === 0, ...r };
    } catch (e) {
      return { name, ok: false, problems: [redactSecrets((e as Error)?.message) ?? "error sin detalle"], warnings: [] };
    }
  };
  const httpErr = (r: { status: number; body: any }) => `HTTP ${r.status}${r.body?.error?.code ? ` (${r.body.error.code})` : ""}`;

  const checks = await Promise.all([
    safe("Precio de PRO ($99 MXN al mes, IVA incluido)", async () => {
      if (!k.priceId) return { problems: ["Falta STRIPE_PRICE_ID"], warnings: [] };
      const r = await get(`prices/${encodeURIComponent(k.priceId)}`);
      if (!r.ok) return { problems: [`no se pudo leer el precio: ${httpErr(r)}`], warnings: [] };
      const warnings: string[] = [];
      if (mode !== "unknown" && typeof r.body?.livemode === "boolean" && r.body.livemode !== (mode === "live")) {
        warnings.push("el precio y la llave son de modos distintos");
      }
      const problems = priceProblems(r.body as StripePriceLike);
      // Nombre y descripción del producto (salen en el checkout, el portal y los recibos).
      const productId = typeof r.body?.product === "string" ? r.body.product : r.body?.product?.id;
      if (productId) {
        const pr = await get(`products/${encodeURIComponent(productId)}`);
        if (pr.ok) problems.push(...productProblems(pr.body as StripeProductLike));
        else warnings.push(`no se pudo leer el producto: ${httpErr(pr)}`);
      }
      return { problems, warnings };
    }),
    safe("Webhook (eventos y versión de API)", async () => {
      const r = await get("webhook_endpoints?limit=100");
      if (!r.ok) return { problems: [`no se pudieron leer los webhooks: ${httpErr(r)}`], warnings: [] };
      const w = webhookProblems((r.body?.data ?? []) as WebhookEndpointLike[]);
      return { problems: w.problems, warnings: w.warnings };
    }),
    safe("Portal de clientes (cancelar, tarjeta, sin otros planes)", async () => {
      const r = await get("billing_portal/configurations?is_default=true&limit=1");
      if (!r.ok) return { problems: [`no se pudo leer el portal: ${httpErr(r)}`], warnings: [] };
      return portalProblems(((r.body?.data ?? [])[0] ?? null) as PortalConfigLike, k.priceId ?? null);
    }),
    safe("Impuestos (Stripe Tax e IVA en México)", async () => {
      const [s, regs] = await Promise.all([get("tax/settings"), get("tax/registrations?status=active&limit=100")]);
      if (!s.ok) return { problems: [`no se pudo leer Stripe Tax: ${httpErr(s)}`], warnings: [] };
      return taxProblems(s.body as TaxSettingsLike, (regs.ok ? regs.body?.data ?? [] : []) as TaxRegistrationLike[]);
    }),
  ]);
  const modeCheck: StripeCheck = mode === "live"
    ? { name: "Modo", ok: true, problems: [], warnings: [] }
    : { name: "Modo", ok: true, problems: [], warnings: ["Stripe en modo de PRUEBA: nadie puede pagar de verdad (una revisión en prueba no certifica el modo live)"] };
  const all = [modeCheck, ...checks];
  return { ok: all.every((c) => c.ok), mode, checks: all };
}
