// Generación/edición de la imagen del avatar y verificación del parecido. Sin Deno ni red directa:
// recibe `fetch` y `chat` por parámetro para probarlo con dobles en Vitest (nunca se llama a la IA
// real en las pruebas).
//
// - Imagen: gateway de Lovable (chat completions con modalities ["image","text"]). Se prueba una
//   lista de modelos en orden (AVATAR_IMAGE_MODELS): si uno no existe o falla, el siguiente.
// - Juez de parecido: modelo de visión por _shared/ai.ts (Gemini directo si hay llave; si no, Lovable).
// - Costos: estimación por imagen (precio público por imagen de salida) para ai_usage_log.
import { extractImageUrl, likenessPrompt, parseLikeness, type Likeness } from "./avatar-prompts.ts";
import type { UsageEntry } from "./usage.ts";

export const LOVABLE_CHAT_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

/** Orden por defecto: el modelo de mejor identidad primero, y respaldos más baratos. */
export const DEFAULT_IMAGE_MODELS = [
  "google/gemini-3-pro-image-preview",
  "google/gemini-3.1-flash-image-preview",
  "google/gemini-2.5-flash-image",
];

export const LIKENESS_MODEL = "google/gemini-flash-latest";

/** USD por imagen generada (precio público de salida; 1K-2K px). Estimación: la factura manda. */
export function imageCostUsd(model: string): number {
  const m = model.toLowerCase();
  if (m.includes("3-pro-image") || m.includes("pro-image")) return 0.134;
  if (m.includes("3.1-flash-image") || m.includes("3-1-flash-image")) return 0.067;
  if (m.includes("flash-lite-image")) return 0.039;
  if (m.includes("2.5-flash-image")) return 0.039;
  return 0.134; // desconocido: se asume el caro para no subestimar
}

/** Lista de modelos desde la variable de entorno (separados por coma) o la de por defecto. */
export function imageModels(env?: string | null): string[] {
  const list = String(env ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return list.length ? list : DEFAULT_IMAGE_MODELS;
}

export type ImageDeps = {
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  lovableKey: string;
  models: string[];
  /** Llamada de texto/visión (aiFetchDetailed en producción). */
  chat: (init: RequestInit) => Promise<{ res: Response; provider: string; model: string }>;
  timeoutMs?: number;
  /** Tope del juez de parecido. Antes no tenía: un día lento de Gemini dejó al usuario 2.5 min esperando. */
  likenessTimeoutMs?: number;
};

export type ImageResult =
  | { ok: true; url: string; model: string; usage: UsageEntry }
  | { ok: false; code: "sin_creditos" | "saturado" | "sin_imagen" | "error"; detail: string; usage: UsageEntry[] };

/** Errores que ameritan probar el siguiente modelo (modelo inexistente, petición rechazada, caída). */
const tryNext = (status: number) => status === 400 || status === 404 || status === 422 || status >= 500;

/**
 * Genera (o edita, si `images` trae la imagen base) una imagen. `images` son data URLs o https;
 * van ANTES del texto para que el modelo las tome como referencia principal.
 */
export async function generateImage(
  deps: ImageDeps,
  req: { prompt: string; images: string[]; fn: string; userId: string | null },
): Promise<ImageResult> {
  const content = [
    ...req.images.map((url) => ({ type: "image_url", image_url: { url } })),
    { type: "text", text: req.prompt },
  ];
  const failures: UsageEntry[] = [];
  let lastDetail = "";
  for (const model of deps.models) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), deps.timeoutMs ?? 90_000);
    let res: Response;
    try {
      res = await deps.fetch(LOVABLE_CHAT_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${deps.lovableKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model, messages: [{ role: "user", content }], modalities: ["image", "text"] }),
        signal: ctrl.signal,
      });
    } catch (e) {
      clearTimeout(timer);
      lastDetail = `${model}: ${(e as Error).message}`;
      continue;
    }
    clearTimeout(timer);
    if (res.status === 402) return { ok: false, code: "sin_creditos", detail: "gateway 402", usage: failures };
    if (res.status === 429) return { ok: false, code: "saturado", detail: "gateway 429", usage: failures };
    if (!res.ok) {
      lastDetail = `${model}: ${res.status} ${(await res.text().catch(() => "")).slice(0, 200)}`;
      if (tryNext(res.status)) continue;
      return { ok: false, code: "error", detail: lastDetail, usage: failures };
    }
    const data = await res.json().catch(() => null);
    const url = extractImageUrl(data);
    if (!url) {
      // Respondió sin imagen (política o texto): se cobra la entrada, se prueba el siguiente.
      failures.push({ user_id: req.userId, function: req.fn, provider: "lovable", model, cost_estimate_usd: 0.002 });
      lastDetail = `${model}: sin imagen`;
      continue;
    }
    return {
      ok: true,
      url,
      model,
      usage: { user_id: req.userId, function: req.fn, provider: "lovable", model, cost_estimate_usd: imageCostUsd(model) },
    };
  }
  return { ok: false, code: "sin_imagen", detail: lastDetail || "sin modelos", usage: failures };
}

/**
 * Juez de parecido: compara la referencia (selfie o avatar base) con la imagen nueva.
 * null si el juez no respondió algo válido (en ese caso no se reintenta a ciegas).
 */
export async function checkLikeness(
  deps: Pick<ImageDeps, "chat" | "lovableKey" | "likenessTimeoutMs">,
  req: { reference: string; candidate: string; mode: "selfie" | "identidad"; fn: string; userId: string | null; full?: string | null },
): Promise<{ likeness: Likeness | null; usage: UsageEntry | null }> {
  try {
    // Si el juez tarda, se entrega la versión sin calificar (sin reintento) en vez de dejar esperando.
    const { res, provider, model } = await deps.chat({
      method: "POST",
      signal: AbortSignal.timeout(deps.likenessTimeoutMs ?? 20_000),
      headers: { Authorization: `Bearer ${deps.lovableKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: LIKENESS_MODEL,
        messages: [{
          role: "user",
          content: [
            { type: "image_url", image_url: { url: req.reference } },
            { type: "image_url", image_url: { url: req.candidate } },
            // Avatar de cuerpo completo: candidate es el recorte de la cara y full la figura (para la mano).
            ...(req.full ? [{ type: "image_url", image_url: { url: req.full } }] : []),
            { type: "text", text: likenessPrompt(req.mode, { mano: !!req.full }) },
          ],
        }],
        response_format: { type: "json_object" },
      }),
    });
    if (!res.ok) return { likeness: null, usage: null };
    const data = await res.json().catch(() => null);
    const u = (data as any)?.usage;
    const usage: UsageEntry = {
      user_id: req.userId, function: req.fn, provider, model,
      input_tokens: Number(u?.prompt_tokens) || 2600, output_tokens: Number(u?.completion_tokens) || 80,
    };
    return { likeness: parseLikeness((data as any)?.choices?.[0]?.message?.content), usage };
  } catch {
    return { likeness: null, usage: null };
  }
}
