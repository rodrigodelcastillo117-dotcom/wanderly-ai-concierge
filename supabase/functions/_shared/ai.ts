// Cliente de IA (chat completions estilo OpenAI) con proveedor principal y respaldo.
//
// - Si existe GEMINI_API_KEY, las peticiones a modelos "google/*" van directo a la API de
//   Google Gemini (endpoint compatible con OpenAI): mismos modelos que el gateway de Lovable,
//   con cuenta y facturación propias del proyecto.
// - Si Gemini falla (cuota, modelo no disponible, error del servidor) o no hay llave, se usa
//   el gateway de Lovable con la petición original.
//
// Uso: reemplaza `fetch(LOVABLE_GATEWAY_URL, init)` por `aiFetch(init)`. La respuesta tiene
// la misma forma (incluido streaming SSE), así que el resto del código no cambia.

// Tipado mínimo para que las pruebas de Vitest (fuera de Deno) también compilen.
declare const Deno: { env: { get(key: string): string | undefined } };

const LOVABLE_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
// Alias que Google mantiene apuntando a su modelo Flash vigente: los nombres fijos (2.5-flash,
// 2.5-flash-lite) se retiran y devuelven 404.
const GEMINI_FALLBACK_MODEL = "gemini-flash-latest";
// El gateway de Lovable usa sus propios nombres: no está verificado que acepte el alias
// "gemini-flash-latest", así que al caer a Lovable se traduce a un nombre que sí publica.
const LOVABLE_MODEL_ALIASES: Record<string, string> = {
  "google/gemini-flash-latest": "google/gemini-2.5-flash",
  "google/gemini-flash-lite-latest": "google/gemini-2.5-flash-lite",
};

/** Nombre que acepta el gateway de Lovable para un modelo (traduce los alias; los demás igual). */
export function lovableModelName(model: string): string {
  return LOVABLE_MODEL_ALIASES[model] ?? model;
}

/** Petición para el gateway de Lovable: igual a la original salvo el nombre del modelo si es un alias. */
function lovableInit(init: RequestInit, body: ChatBody | null): RequestInit {
  const model = typeof body?.model === "string" ? body.model : "";
  const mapped = LOVABLE_MODEL_ALIASES[model];
  if (!body || (!mapped && !("reasoning_effort" in body))) return init;
  // reasoning_effort es del endpoint de Gemini; no está verificado que el gateway lo acepte.
  const { reasoning_effort: _re, ...rest } = body;
  return { ...init, body: JSON.stringify({ ...rest, model: mapped ?? model }) };
}

type ChatBody = Record<string, unknown> & { model?: string; modalities?: unknown; tool_choice?: unknown };

function parseBody(init: RequestInit): ChatBody | null {
  if (typeof init.body !== "string") return null;
  try {
    return JSON.parse(init.body) as ChatBody;
  } catch {
    return null;
  }
}

function callGemini(key: string, body: ChatBody, signal?: AbortSignal | null): Promise<Response> {
  return fetch(GEMINI_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
    signal: signal ?? undefined,
  });
}

/** Decide si un error de Gemini amerita reintentar con otra variante de la petición. */
const retryable = (status: number) => status === 400 || status === 404 || status === 429 || status >= 500;

/** Respuesta + quién respondió de verdad (para registrar el costo en ai_usage_log). */
export type AiFetchResult = { res: Response; provider: "gemini" | "lovable"; model: string };

export async function aiFetchDetailed(init: RequestInit): Promise<AiFetchResult> {
  const geminiKey = Deno.env.get("GEMINI_API_KEY") ?? "";
  const body = parseBody(init);
  const model = typeof body?.model === "string" ? body.model : "";
  // La generación de imágenes usa un formato que el endpoint compatible no soporta.
  const wantsImage = Array.isArray(body?.modalities) && (body!.modalities as unknown[]).includes("image");

  if (geminiKey && body && model.startsWith("google/") && !wantsImage) {
    const attempts: ChatBody[] = [{ ...body, model: model.slice("google/".length) }];
    // Un modelo que no acepta reasoning_effort (400) se reintenta sin él antes de cambiar de modelo.
    const withoutEffort = (b: ChatBody): ChatBody => { const { reasoning_effort: _re, ...rest } = b; return rest; };
    if ("reasoning_effort" in attempts[0]) attempts.push(withoutEffort(attempts[0]));
    // Modelo retirado, pro sin cuota o preview no disponible → el Flash vigente.
    if (attempts[0].model !== GEMINI_FALLBACK_MODEL) attempts.push({ ...attempts[attempts.length - 1], model: GEMINI_FALLBACK_MODEL });
    // Algunas formas de tool_choice ("forzar esta función") no las acepta el endpoint compatible.
    if (body.tool_choice && typeof body.tool_choice === "object") {
      attempts.push({ ...attempts[attempts.length - 1], tool_choice: "required" });
    }

    for (const attempt of attempts) {
      try {
        const res = await callGemini(geminiKey, attempt, init.signal);
        if (res.ok) return { res, provider: "gemini", model: String(attempt.model) };
        const detail = await res.text().catch(() => "");
        console.warn(`gemini ${attempt.model} → ${res.status}: ${detail.slice(0, 300)}`);
        if (!retryable(res.status)) break;
      } catch (e) {
        if ((e as Error).name === "AbortError") throw e;
        console.warn("gemini request failed:", (e as Error).message);
      }
    }
  }

  const lovable = lovableInit(init, body);
  const lovableModel = parseBody(lovable)?.model;
  return { res: await fetch(LOVABLE_URL, lovable), provider: "lovable", model: typeof lovableModel === "string" ? lovableModel : model };
}

export async function aiFetch(init: RequestInit): Promise<Response> {
  return (await aiFetchDetailed(init)).res;
}
