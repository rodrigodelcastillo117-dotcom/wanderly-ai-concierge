// Cliente de streaming de Iato (Concierge 2.0). Lee el SSE de concierge-chat con fetch (supabase-js
// invoke espera la respuesta completa y no permite ver el texto mientras llega). Si el servidor todavía
// es el de antes y responde JSON, se entrega como "final" igual: la pantalla funciona con ambos.
//
// Errores HTTP (sesión, límite del plan, ritmo) se lanzan con `context` = Response, el mismo contrato
// que lee src/lib/functionErrors.ts (readFunctionError / diálogo de límite gratuito).

import { ConciergeStreamParser, type ConciergeStreamEvent } from "../../supabase/functions/concierge-chat/stream";

export interface StreamHandlers {
  onMeta?: (data: Record<string, unknown>) => void;
  onStatus?: (data: { id: string; text: string; state: string }) => void;
  onDelta?: (text: string) => void;
  onReset?: () => void;
  onFinal: (data: Record<string, any>) => void;
}

export interface StreamRequest {
  url: string;
  accessToken: string;
  apiKey: string;
  body: Record<string, unknown>;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}

export class ConciergeHttpError extends Error {
  constructor(public context: Response) { super(`concierge ${context.status}`); }
}

/** Envía el mensaje y despacha los eventos. Devuelve "stream" o "json" según respondió el servidor. */
export async function streamConcierge(req: StreamRequest, h: StreamHandlers): Promise<"stream" | "json"> {
  const doFetch = req.fetchImpl ?? fetch;
  const res = await doFetch(req.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      Authorization: `Bearer ${req.accessToken}`,
      apikey: req.apiKey,
      ...(req.headers ?? {}),
    },
    body: JSON.stringify({ ...req.body, stream: true }),
    signal: req.signal,
  });
  if (!res.ok) throw new ConciergeHttpError(res);
  const ct = res.headers.get("content-type") ?? "";
  if (!ct.includes("text/event-stream") || !res.body) {
    h.onFinal(await res.json());
    return "json";
  }
  const parser = new ConciergeStreamParser();
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let gotFinal = false;
  const dispatch = (ev: ConciergeStreamEvent) => {
    switch (ev.type) {
      case "meta": h.onMeta?.(ev.data); break;
      case "status": h.onStatus?.(ev.data); break;
      case "delta": h.onDelta?.(ev.data.text); break;
      case "reset": h.onReset?.(); break;
      case "final": gotFinal = true; h.onFinal(ev.data as Record<string, any>); break;
      case "error": {
        // Mismo contrato que una respuesta HTTP con error: functionErrors decide qué mostrar.
        const status = typeof ev.data.status === "number" ? ev.data.status : 502;
        throw new ConciergeHttpError(new Response(JSON.stringify(ev.data), { status, headers: { "Content-Type": "application/json" } }));
      }
    }
  };
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    for (const ev of parser.push(decoder.decode(value, { stream: true }))) dispatch(ev);
  }
  for (const ev of parser.flush()) dispatch(ev);
  if (!gotFinal) throw new Error("La conexión se cortó antes de terminar la respuesta.");
  return "stream";
}

/**
 * Texto que queda en el chat si la respuesta falló a medias (MEJ-02). Lo que llegó en vivo no pasó por
 * las revisiones de honestidad del servidor (fuentes, "sin verificar", nada de "reservé"): se conserva
 * para no borrar lo útil, pero se marca como incompleto y sin verificar.
 */
export function incompleteReplyText(partial: string, errorMessage: string): string {
  const t = String(partial ?? "").trim();
  if (!t) return `${errorMessage} Puedes intentarlo de nuevo o tocar **Contactar Fixer**.`;
  return `${t}\n\n_Respuesta incompleta: se cortó antes de terminar y sin verificar sus datos. Pídemela de nuevo o toca **Contactar Fixer**._`;
}
