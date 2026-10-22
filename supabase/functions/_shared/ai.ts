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

export async function aiFetch(init: RequestInit): Promise<Response> {
  const geminiKey = Deno.env.get("GEMINI_API_KEY") ?? "";
  const body = parseBody(init);
  const model = typeof body?.model === "string" ? body.model : "";
  // La generación de imágenes usa un formato que el endpoint compatible no soporta.
  const wantsImage = Array.isArray(body?.modalities) && (body!.modalities as unknown[]).includes("image");

  if (geminiKey && body && model.startsWith("google/") && !wantsImage) {
    const attempts: ChatBody[] = [{ ...body, model: model.slice("google/".length) }];
    // Modelo retirado, pro sin cuota o preview no disponible → el Flash vigente.
    if (attempts[0].model !== GEMINI_FALLBACK_MODEL) attempts.push({ ...attempts[0], model: GEMINI_FALLBACK_MODEL });
    // Algunas formas de tool_choice ("forzar esta función") no las acepta el endpoint compatible.
    if (body.tool_choice && typeof body.tool_choice === "object") {
      attempts.push({ ...attempts[attempts.length - 1], tool_choice: "required" });
    }

    for (const attempt of attempts) {
      try {
        const res = await callGemini(geminiKey, attempt, init.signal);
        if (res.ok) return res;
        const detail = await res.text().catch(() => "");
        console.warn(`gemini ${attempt.model} → ${res.status}: ${detail.slice(0, 300)}`);
        if (!retryable(res.status)) break;
      } catch (e) {
        if ((e as Error).name === "AbortError") throw e;
        console.warn("gemini request failed:", (e as Error).message);
      }
    }
  }

  return fetch(LOVABLE_URL, init);
}
