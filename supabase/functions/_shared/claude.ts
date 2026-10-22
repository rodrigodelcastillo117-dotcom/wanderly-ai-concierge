// Llamada a Claude (Messages API) compartida por analizar-viaje, buscar-promociones y
// nightlife-discover. Antes cada función tenía su copia y dos de ellas seguían con un modelo
// retirado (404) y `temperature` (400 en todos los modelos desde el 21 oct 2026): estaban muertas.
//
// Reglas del modelo vigente que se respetan aquí:
// - Sin temperature/top_p/top_k.
// - Sin tool_choice forzado ("tool"/"any" → 400): se usa "auto" y se pide la herramienta en el prompt.
// - thinking "between_tools" (sin razonamiento extendido) solo acepta effort ≤ high y ningún otro campo.
// - Si el modelo declina por política, el servidor reintenta en otro modelo ("fallbacks").

// Tipado mínimo para que Vitest (fuera de Deno) también lo compile.
declare const Deno: { env: { get(key: string): string | undefined } };

export const CURRENT_CLAUDE_MODEL = "claude-sonnet-5-5";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

/** Modelos a intentar en orden: el de ANTHROPIC_MODEL (si existe) y el vigente, sin repetir. */
export function claudeModels(envModel = (Deno.env.get("ANTHROPIC_MODEL") ?? "").trim()): string[] {
  return [envModel, CURRENT_CLAUDE_MODEL].filter((m, i, arr) => m && arr.indexOf(m) === i);
}

/** Quita lo que el modelo vigente rechaza aunque una función vieja lo mande. */
export function sanitizeClaudePayload(payload: Record<string, unknown>): Record<string, unknown> {
  const { temperature: _t, top_p: _p, top_k: _k, ...rest } = payload;
  const tc = rest.tool_choice as { type?: string } | undefined;
  if (tc && (tc.type === "tool" || tc.type === "any")) rest.tool_choice = { type: "auto" };
  return rest;
}

/**
 * POST /v1/messages con los mismos headers y opciones que analizar-viaje. Si un modelo no existe
 * (404/400 por modelo) prueba el siguiente. Devuelve la última respuesta de error si ninguno sirve.
 */
export async function callClaudeWithFallback(
  payload: Record<string, unknown>,
  opts: { apiKey?: string; models?: string[]; signal?: AbortSignal } = {},
): Promise<Response> {
  const apiKey = opts.apiKey ?? Deno.env.get("ANTHROPIC_API_KEY") ?? "";
  const models = opts.models ?? claudeModels();
  const body = sanitizeClaudePayload(payload);
  let lastErrorText = "";
  let lastStatus = 0;

  for (const model of models) {
    const current = model === CURRENT_CLAUDE_MODEL;
    const res = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
        // Si el modelo declina por política, el servidor reintenta en otro modelo.
        ...(current ? { "anthropic-beta": "server-side-fallback-2026-07-01" } : {}),
      },
      body: JSON.stringify({
        ...body,
        model,
        // Sin razonamiento extendido para no alargar la espera. Solo al modelo vigente (otros
        // rechazan estos campos).
        ...(current ? { thinking: { type: "between_tools" }, output_config: { effort: "medium" }, fallbacks: "default" } : {}),
      }),
      signal: opts.signal,
    });

    if (res.ok) {
      console.log("Claude model usado:", model);
      return res;
    }

    const text = await res.text();
    lastStatus = res.status;
    lastErrorText = text;
    console.warn("Claude model falló:", model, res.status, text.slice(0, 500));

    const shouldTryNext =
      (res.status === 404 && /model|not_found|not found/i.test(text)) ||
      (res.status === 400 && /model/i.test(text));
    if (!shouldTryNext) break;
  }

  return new Response(lastErrorText, { status: lastStatus || 502 });
}

type ClaudeMessage = { content?: Array<{ type?: string; name?: string; input?: unknown; text?: string }>; stop_reason?: string };

/** Entrada de la herramienta pedida, o null si el modelo no la llamó (o declinó). */
export function toolInput(data: ClaudeMessage, toolName: string): unknown | null {
  if (data?.stop_reason === "refusal") return null;
  const block = (data?.content ?? []).find((b) => b?.type === "tool_use" && b?.name === toolName);
  return block?.input ?? null;
}

/** Texto concatenado de la respuesta (bloques "text"), o "" si declinó. */
export function responseText(data: ClaudeMessage): string {
  if (data?.stop_reason === "refusal") return "";
  return (data?.content ?? []).filter((b) => b?.type === "text").map((b) => b.text ?? "").join("");
}

/** JSON dentro de un texto (con o sin ```json). null si no se puede leer. */
export function parseJsonLoose(raw: string): any | null {
  const text = String(raw ?? "").replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();
  try {
    return JSON.parse(text);
  } catch {
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try { return JSON.parse(m[0]); } catch { return null; }
  }
}
