// AUD-08 · health-check?action=stripe_config: revisa con la llave del servidor (solo lectura) lo que
// antes solo se podía mirar en el panel de Stripe. Fetch simulado; ninguna llamada real.
import { describe, expect, it, vi } from "vitest";
import { probeStripeConfig } from "../../supabase/functions/health-check/stripeProbe";
import { REQUIRED_WEBHOOK_EVENTS, portalProblems, taxProblems, webhookProblems } from "../../supabase/functions/_shared/stripe-offer";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const price = { id: "price_pro", active: true, livemode: true, currency: "mxn", unit_amount: 9900, tax_behavior: "inclusive", type: "recurring", recurring: { interval: "month", interval_count: 1, usage_type: "licensed" } };
const endpoint = { id: "we_1", url: "https://x.supabase.co/functions/v1/stripe-webhook", status: "enabled", api_version: "2024-12-18.acacia",
  enabled_events: [...REQUIRED_WEBHOOK_EVENTS, "customer.subscription.paused", "customer.subscription.resumed", "invoice.payment_succeeded"] };
const portal = { id: "bpc_1", is_default: true, business_profile: { privacy_policy_url: "https://traveliatos.life/privacidad", terms_of_service_url: "https://traveliatos.life/terminos" },
  features: { subscription_cancel: { enabled: true, mode: "at_period_end" }, subscription_update: { enabled: false }, payment_method_update: { enabled: true }, invoice_history: { enabled: true } } };

function stripeFetch(over: Record<string, () => Response> = {}) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    expect((init?.headers as Record<string, string>)["Stripe-Version"]).toBe("2024-12-18.acacia");
    expect((init as RequestInit & { method?: string })?.method ?? "GET").toBe("GET"); // solo lectura
    for (const [part, make] of Object.entries(over)) if (url.includes(part)) return make();
    if (url.includes("/prices/")) return json(price);
    if (url.includes("webhook_endpoints")) return json({ data: [endpoint] });
    if (url.includes("billing_portal")) return json({ data: [portal] });
    if (url.includes("tax/settings")) return json({ status: "active" });
    if (url.includes("tax/registrations")) return json({ data: [{ country: "MX", status: "active" }] });
    return json({}, 404);
  }) as unknown as typeof fetch;
}

describe("health-check?action=stripe_config", () => {
  it("configuración correcta en live: todo OK, sin la llave en la respuesta", async () => {
    const f = stripeFetch();
    const r = await probeStripeConfig({ stripeKey: "sk_live_SECRETO", priceId: "price_pro" }, f);
    expect(r.ok).toBe(true);
    expect(r.mode).toBe("live");
    expect(r.checks.every((c) => c.problems.length === 0)).toBe(true);
    expect(JSON.stringify(r)).not.toContain("SECRETO");
    expect((f as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(5);
  });

  it("modo prueba: aviso explícito de que no certifica live", async () => {
    const r = await probeStripeConfig({ stripeKey: "sk_test_x", priceId: "price_pro" }, stripeFetch({ "/prices/": () => json({ ...price, livemode: false }) }));
    expect(r.mode).toBe("test");
    expect(r.checks[0].warnings[0]).toMatch(/no certifica el modo live/);
  });

  it("detecta el precio en USD / IVA por fuera, eventos faltantes, portal que corta el acceso y Stripe Tax apagado", async () => {
    const r = await probeStripeConfig({ stripeKey: "sk_live_x", priceId: "price_pro" }, stripeFetch({
      "/prices/": () => json({ ...price, currency: "usd", tax_behavior: "exclusive" }),
      webhook_endpoints: () => json({ data: [{ ...endpoint, enabled_events: ["checkout.session.completed", "invoice.paid"] }] }),
      billing_portal: () => json({ data: [{ ...portal, features: { ...portal.features, subscription_cancel: { enabled: true, mode: "immediately" } } }] }),
      "tax/settings": () => json({ status: "pending" }),
    }));
    expect(r.ok).toBe(false);
    const by = (n: string) => r.checks.find((c) => c.name.startsWith(n))!;
    expect(by("Precio").problems.join(" ")).toMatch(/currency.*tax_behavior/s);
    expect(by("Webhook").problems[0]).toMatch(/charge\.refunded/);
    expect(by("Portal").problems[0]).toMatch(/at_period_end/);
    expect(by("Impuestos").problems[0]).toMatch(/Stripe Tax no está activo/);
  });

  it("sin llave o sin precio: falla clara; un error HTTP no rompe el resto", async () => {
    expect((await probeStripeConfig({}, stripeFetch())).checks[0].problems).toEqual(["Falta STRIPE_SECRET_KEY"]);
    const r = await probeStripeConfig({ stripeKey: "sk_live_x" }, stripeFetch({ webhook_endpoints: () => json({ error: { code: "api_key_expired" } }, 401) }));
    expect(r.checks.find((c) => c.name.startsWith("Precio"))!.problems).toEqual(["Falta STRIPE_PRICE_ID"]);
    expect(r.checks.find((c) => c.name.startsWith("Webhook"))!.problems[0]).toMatch(/HTTP 401 \(api_key_expired\)/);
    expect(r.checks.find((c) => c.name.startsWith("Portal"))!.ok).toBe(true);
  });
});

describe("reglas puras de la configuración", () => {
  it("webhook: sin endpoint, deshabilitado, versión distinta, '*' acepta todo", () => {
    expect(webhookProblems([]).problems[0]).toMatch(/no hay endpoint/);
    expect(webhookProblems([{ ...endpoint, status: "disabled" }]).problems[0]).toMatch(/disabled/);
    expect(webhookProblems([{ ...endpoint, api_version: "2025-03-31.basil" }]).problems[0]).toMatch(/2025-03-31\.basil/);
    expect(webhookProblems([{ ...endpoint, api_version: null }]).warnings[0]).toMatch(/versión de API por omisión/);
    expect(webhookProblems([{ ...endpoint, enabled_events: ["*"] }]).problems).toEqual([]);
  });
  it("portal: otros precios en cambio de plan es problema (cualquier suscripción activa da PRO)", () => {
    const p = portalProblems({ ...portal, features: { ...portal.features, subscription_update: { enabled: true, products: [{ prices: ["price_pro", "price_otro"] }] } } }, "price_pro");
    expect(p.problems[0]).toMatch(/otros precios/);
    expect(portalProblems(null, "price_pro").problems[0]).toMatch(/no hay configuración/);
  });
  it("impuestos: sin registro en MX es aviso, no bloqueo", () => {
    const t = taxProblems({ status: "active" }, []);
    expect(t.problems).toEqual([]);
    expect(t.warnings[0]).toMatch(/México/);
  });
});
