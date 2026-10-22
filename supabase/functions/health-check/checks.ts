// Chequeos de salud de los servicios externos de IATOS. Sin dependencias de Deno para poder
// probarlos: reciben las llaves y `fetch` como parámetros.

export type CheckResult = {
  name: string;
  ok: boolean;
  /** Funciona, pero hay algo que atender (por ejemplo, Stripe en modo de prueba). */
  warn?: string;
  detail?: string;
  ms: number;
};

export type Keys = {
  geminiKey?: string;
  lovableKey?: string;
  anthropicKey?: string;
  anthropicModel?: string;
  serpKey?: string;
  travelpayoutsToken?: string;
  stripeKey?: string;
};

type Fetch = typeof fetch;

const TIMEOUT_MS = 20000;
/** Búsquedas de SerpApi por debajo de las cuales avisamos: ~4 por análisis de viaje. */
export const SERPAPI_LOW = 200;

async function timed(name: string, fn: () => Promise<Omit<CheckResult, "name" | "ms">>): Promise<CheckResult> {
  const t0 = Date.now();
  try {
    const r = await fn();
    return { name, ...r, ms: Date.now() - t0 };
  } catch (e) {
    return { name, ok: false, detail: (e as Error).message.slice(0, 200), ms: Date.now() - t0 };
  }
}

const withTimeout = (f: Fetch, url: string, init: RequestInit = {}) =>
  f(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });

export function runChecks(k: Keys, f: Fetch = fetch): Promise<CheckResult[]> {
  return Promise.all([
    timed("IA (Gemini)", async () => {
      if (!k.geminiKey) return { ok: false, detail: "Falta GEMINI_API_KEY" };
      const r = await withTimeout(f, "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${k.geminiKey}` },
        body: JSON.stringify({ model: "gemini-2.5-flash", messages: [{ role: "user", content: "Responde solo: OK" }] }),
      });
      return r.ok ? { ok: true } : { ok: false, detail: `HTTP ${r.status}` };
    }),
    timed("IA de respaldo (Lovable)", async () => {
      if (!k.lovableKey) return { ok: false, detail: "Falta LOVABLE_API_KEY" };
      const r = await withTimeout(f, "https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Lovable-API-Key": k.lovableKey },
        body: JSON.stringify({ model: "google/gemini-2.5-flash-lite", messages: [{ role: "user", content: "OK" }] }),
      });
      if (r.status === 402) return { ok: true, warn: "Sin saldo de IA en Lovable: el respaldo no funcionaría si Gemini falla" };
      return r.ok ? { ok: true } : { ok: false, detail: `HTTP ${r.status}` };
    }),
    timed("Análisis de viaje (Claude)", async () => {
      if (!k.anthropicKey) return { ok: false, detail: "Falta ANTHROPIC_API_KEY" };
      const model = k.anthropicModel || "claude-sonnet-5-5";
      const r = await withTimeout(f, "https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": k.anthropicKey, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model, max_tokens: 5, messages: [{ role: "user", content: "OK" }] }),
      });
      if (r.ok) return { ok: true, detail: model };
      if (r.status === 404) return { ok: true, warn: `El modelo ${model} ya no existe: el análisis usa los modelos de respaldo` };
      return { ok: false, detail: `HTTP ${r.status}` };
    }),
    timed("Vuelos, hoteles y lugares (SerpApi)", async () => {
      if (!k.serpKey) return { ok: false, detail: "Falta SERPAPI_PRIVATE_KEY" };
      const r = await withTimeout(f, `https://serpapi.com/account.json?api_key=${encodeURIComponent(k.serpKey)}`);
      if (!r.ok) return { ok: false, detail: `HTTP ${r.status}` };
      const j = await r.json();
      const left = Number(j?.total_searches_left ?? j?.plan_searches_left ?? NaN);
      if (!Number.isFinite(left)) return { ok: true };
      if (left <= 0) return { ok: false, detail: "Se acabaron las búsquedas del plan" };
      const detail = `${left.toLocaleString("es-MX")} búsquedas disponibles`;
      return left < SERPAPI_LOW ? { ok: true, warn: `Quedan pocas búsquedas: ${detail}` } : { ok: true, detail };
    }),
    timed("Precios de vuelos (Travelpayouts)", async () => {
      if (!k.travelpayoutsToken) return { ok: false, detail: "Falta TRAVELPAYOUTS_TOKEN" };
      const u = `https://api.travelpayouts.com/v1/prices/cheap?origin=MEX&destination=CUN&currency=usd&token=${encodeURIComponent(k.travelpayoutsToken)}`;
      const r = await withTimeout(f, u);
      return r.ok ? { ok: true } : { ok: false, detail: `HTTP ${r.status}` };
    }),
    timed("Pagos (Stripe)", async () => {
      if (!k.stripeKey) return { ok: false, detail: "Falta STRIPE_SECRET_KEY" };
      const r = await withTimeout(f, "https://api.stripe.com/v1/balance", {
        headers: { Authorization: `Bearer ${k.stripeKey}` },
      });
      if (!r.ok) return { ok: false, detail: `HTTP ${r.status}` };
      const j = await r.json();
      return j?.livemode === false
        ? { ok: true, warn: "Stripe está en modo de prueba: nadie puede pagar de verdad" }
        : { ok: true };
    }),
  ]);
}

export const allOk = (results: CheckResult[]) => results.every((r) => r.ok);
export const needsAttention = (results: CheckResult[]) => results.some((r) => !r.ok || r.warn);
