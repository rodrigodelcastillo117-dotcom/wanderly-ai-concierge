// Chequeos de salud de los servicios externos de IATOS. Sin dependencias de Deno para poder
// probarlos: reciben las llaves y `fetch` como parámetros.
import { redactSecrets } from "../_shared/redact.ts";

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
  /** Búsquedas de SerpApi por día (promedio de 7 días, de ai_usage_log). null = sin datos. */
  serpPerDay?: number | null;
};

type Fetch = typeof fetch;

const TIMEOUT_MS = 20000;
/** Respaldo sin historial de uso: búsquedas de SerpApi por debajo de las cuales avisamos. */
export const SERPAPI_LOW = 200;
/** Con historial: avisamos si al ritmo de los últimos 7 días quedan menos de estos días. */
export const SERPAPI_DAYS_LOW = 7;

/**
 * ¿Quedan pocas búsquedas? Con el ritmo real (ai_usage_log) se calcula para cuántos días alcanzan;
 * sin historial se usa el umbral fijo. Pura para poder probarla.
 */
export function serpLowWarning(left: number, perDay: number | null | undefined): { warn: boolean; detail: string } {
  const base = `${left.toLocaleString("es-MX")} búsquedas disponibles`;
  if (typeof perDay === "number" && Number.isFinite(perDay) && perDay > 0) {
    const days = left / perDay;
    const ritmo = `~${Math.round(perDay).toLocaleString("es-MX")} al día (promedio de 7 días)`;
    const alcance = days < 1 ? "se acaban hoy" : `alcanzan para ~${Math.floor(days)} ${Math.floor(days) === 1 ? "día" : "días"}`;
    return { warn: days < SERPAPI_DAYS_LOW, detail: `${base} · ${ritmo} · ${alcance}` };
  }
  return { warn: left < SERPAPI_LOW, detail: base };
}

async function timed(name: string, fn: () => Promise<Omit<CheckResult, "name" | "ms">>): Promise<CheckResult> {
  const t0 = Date.now();
  try {
    const r = await fn();
    return { name, ...r, detail: redactSecrets(r.detail), warn: redactSecrets(r.warn, 300), ms: Date.now() - t0 };
  } catch (e) {
    // Los errores de red de Deno traen la URL, y SerpApi/Travelpayouts llevan la llave en la URL:
    // nunca se guarda ni se manda por correo el texto crudo.
    return { name, ok: false, detail: redactSecrets((e as Error)?.message) ?? "error sin detalle", ms: Date.now() - t0 };
  }
}

/** Primeras líneas del error del proveedor, para saber qué pasó sin entrar a los logs. */
const errText = async (r: Response) => (await r.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 200);

const withTimeout = (f: Fetch, url: string, init: RequestInit = {}) =>
  f(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });

export function runChecks(k: Keys, f: Fetch = fetch): Promise<CheckResult[]> {
  return Promise.all([
    timed("IA (Gemini)", async () => {
      if (!k.geminiKey) return { ok: false, detail: "Falta GEMINI_API_KEY" };
      const r = await withTimeout(f, "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${k.geminiKey}` },
        body: JSON.stringify({ model: "gemini-flash-latest", messages: [{ role: "user", content: "Responde solo: OK" }] }),
      });
      return r.ok ? { ok: true } : { ok: false, detail: `HTTP ${r.status}: ${await errText(r)}` };
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
      const { warn, detail } = serpLowWarning(left, k.serpPerDay);
      return warn ? { ok: true, warn: `Quedan pocas búsquedas: ${detail}` } : { ok: true, detail };
    }),
    timed("Precios de vuelos (Travelpayouts)", async () => {
      if (!k.travelpayoutsToken) return { ok: false, detail: "Falta TRAVELPAYOUTS_TOKEN" };
      // El token va en el encabezado, no en la URL, para que un error de red no lo exponga.
      const u = "https://api.travelpayouts.com/v1/prices/cheap?origin=MEX&destination=CUN&currency=usd";
      const r = await withTimeout(f, u, { headers: { "X-Access-Token": k.travelpayoutsToken } });
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
