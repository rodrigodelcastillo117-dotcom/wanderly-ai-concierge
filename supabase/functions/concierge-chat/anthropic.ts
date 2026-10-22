// Cliente de la Messages API de Claude con streaming (SSE) para Iato. HTTP directo (mismo patrón que
// _shared/claude.ts): las funciones Deno y las pruebas de Vitest comparten el código sin dependencias.
// Lógica pura salvo streamAnthropic, que recibe el fetch por parámetro (se prueba con respuestas simuladas).
//
// Reglas del API vigente que se respetan aquí (skill claude-api, cURL / streaming / tool use):
//   * anthropic-version 2026-10-21: sin temperature/top_p/top_k.
//   * Sin tool_choice forzado ("any"/"tool" → 400 en los modelos vigentes): solo "auto" o "none".
//   * Pensamiento adaptativo (por defecto); la profundidad se controla con output_config.effort.
//   * Los bloques thinking/redacted_thinking se devuelven SIN CAMBIOS en la vuelta de herramientas
//     (incluida su firma: signature_delta). Nunca se reescribe el historial (pensamiento preservado).
//   * Herramientas con eager_input_streaming: la entrada llega sin validar → se parsea estricto y se
//     valida contra el esquema antes de ejecutar (toolDefs.validateToolInput).
//   * Caché de prompt: marcador en el último bloque estable del sistema (herramientas + reglas) y
//     caché automática del resto de la conversación (sirve en la 2.ª llamada de un turno con herramientas).
//   * stop_reason "refusal" se revisa antes de leer el contenido.

export const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
export const ANTHROPIC_VERSION = "2026-10-21";
/** Respaldo del servidor si el modelo declina por política (solo Claude Sonnet 5.5 / Opus en el API de Claude). */
export const FALLBACK_BETA = "server-side-fallback-2026-07-01";

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export type ContentBlock =
  | { type: "text"; text: string; [k: string]: unknown }
  | { type: "tool_use"; id: string; name: string; input: unknown; [k: string]: unknown }
  | { type: "thinking"; thinking: string; signature?: string; [k: string]: unknown }
  | { type: "redacted_thinking"; data: string; [k: string]: unknown }
  | { type: string; [k: string]: unknown };

export interface ToolResultBlock { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean }
export type UserContent = string | Array<{ type: "text"; text: string } | ToolResultBlock>;
export type AMessage = { role: "user"; content: UserContent } | { role: "assistant"; content: string | ContentBlock[] };

export interface AnthropicRequestInput {
  model: string;
  effort: Effort;
  stableSystem: string;
  dynamicSystem: string;
  tools: unknown[];
  messages: AMessage[];
  toolChoice: "auto" | "none";
  maxTokens: number;
  /** fallbacks:"default" (beta) — solo para modelos que lo aceptan. */
  serverFallback?: boolean;
}

/** Modelos que aceptan fallbacks:"default" en el API de Claude (Haiku 5.5 no tiene respaldo del servidor). */
export const supportsServerFallback = (model: string) => /^claude-(sonnet-5-5|opus-5|opus-5-5|fable-5-1)$/.test(model);

export function buildAnthropicRequest(i: AnthropicRequestInput): { body: Record<string, unknown>; headers: Record<string, string> } {
  const body: Record<string, unknown> = {
    model: i.model,
    max_tokens: i.maxTokens,
    stream: true,
    // Bloque estable con marcador de caché (cachea herramientas + reglas); el dinámico va después.
    system: [
      { type: "text", text: i.stableSystem, cache_control: { type: "ephemeral" } },
      ...(i.dynamicSystem.trim() ? [{ type: "text", text: i.dynamicSystem }] : []),
    ],
    tools: i.tools,
    tool_choice: { type: i.toolChoice },
    messages: i.messages,
    output_config: { effort: i.effort },
    // Caché automática del final de la conversación: la llamada que sigue a las herramientas la reutiliza.
    cache_control: { type: "ephemeral" },
  };
  const headers: Record<string, string> = { "content-type": "application/json", "anthropic-version": ANTHROPIC_VERSION };
  if (i.serverFallback && supportsServerFallback(i.model)) {
    body.fallbacks = "default";
    headers["anthropic-beta"] = FALLBACK_BETA;
  }
  return { body, headers };
}

// ═══ SSE ═══

export interface SseEvent { event: string; data: string }

/** Parser incremental de Server-Sent Events: recibe trozos de texto y devuelve eventos completos. */
export class SseParser {
  private buf = "";
  push(chunk: string): SseEvent[] {
    this.buf += chunk;
    const out: SseEvent[] = [];
    let idx: number;
    // Un evento termina con una línea en blanco (\n\n o \r\n\r\n).
    while ((idx = this.findBoundary()) >= 0) {
      const raw = this.buf.slice(0, idx);
      this.buf = this.buf.slice(idx).replace(/^(\r?\n){2}/, "");
      const ev = parseEventBlock(raw);
      if (ev) out.push(ev);
    }
    return out;
  }
  /** Lo que quede al cerrar el stream (un evento sin línea en blanco final). */
  flush(): SseEvent[] {
    const raw = this.buf;
    this.buf = "";
    const ev = raw.trim() ? parseEventBlock(raw) : null;
    return ev ? [ev] : [];
  }
  private findBoundary(): number {
    const a = this.buf.indexOf("\n\n");
    const b = this.buf.indexOf("\r\n\r\n");
    if (a < 0) return b;
    if (b < 0) return a;
    return Math.min(a, b);
  }
}

function parseEventBlock(raw: string): SseEvent | null {
  let event = "message";
  const data: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line || line.startsWith(":")) continue;
    const i = line.indexOf(":");
    const field = i < 0 ? line : line.slice(0, i);
    const value = i < 0 ? "" : line.slice(i + 1).replace(/^ /, "");
    if (field === "event") event = value;
    else if (field === "data") data.push(value);
  }
  if (!data.length && event === "message") return null;
  return { event, data: data.join("\n") };
}

// ═══ Acumulador de un mensaje en streaming ═══

export interface Usage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
}

export interface ParsedToolUse { id: string; name: string; input: unknown; inputError?: string }

export interface AccumulatedMessage {
  model: string | null;
  content: ContentBlock[];
  stopReason: string | null;
  usage: Usage;
  /** Error enviado dentro del stream (overloaded_error, api_error…). */
  streamError: { type: string; message: string } | null;
}

type Pending = { block: Record<string, unknown>; json: string };

export interface AccumulatorHandlers {
  onText?: (delta: string) => void;
  onToolStart?: (name: string, id: string) => void;
  onToolReady?: (tool: ParsedToolUse) => void;
}

/** Aplica los eventos SSE de la Messages API y arma el mensaje final (como finalMessage() del SDK). */
export class MessageAccumulator {
  readonly msg: AccumulatedMessage = {
    model: null, content: [], stopReason: null,
    usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    streamError: null,
  };
  private pending = new Map<number, Pending>();
  private textSoFar = "";
  constructor(private h: AccumulatorHandlers = {}) {}

  get started() { return this.msg.model !== null; }
  get text() { return this.textSoFar; }

  apply(ev: SseEvent): void {
    if (ev.event === "ping") return;
    let d: any;
    try { d = JSON.parse(ev.data); } catch { return; }
    const type = d?.type ?? ev.event;
    switch (type) {
      case "message_start": {
        this.msg.model = typeof d.message?.model === "string" ? d.message.model : "unknown";
        this.mergeUsage(d.message?.usage);
        break;
      }
      case "content_block_start": {
        const block = { ...(d.content_block ?? {}) } as Record<string, unknown>;
        if (block.type === "text") block.text = String(block.text ?? "");
        if (block.type === "thinking") { block.thinking = String(block.thinking ?? ""); block.signature = String(block.signature ?? ""); }
        if (block.type === "tool_use") this.h.onToolStart?.(String(block.name ?? ""), String(block.id ?? ""));
        this.pending.set(Number(d.index), { block, json: "" });
        if (block.type === "text" && block.text) this.emitText(String(block.text));
        break;
      }
      case "content_block_delta": {
        const p = this.pending.get(Number(d.index));
        if (!p) break;
        const delta = d.delta ?? {};
        if (delta.type === "text_delta") {
          p.block.text = String(p.block.text ?? "") + String(delta.text ?? "");
          this.emitText(String(delta.text ?? ""));
        } else if (delta.type === "input_json_delta") {
          p.json += String(delta.partial_json ?? "");
        } else if (delta.type === "thinking_delta") {
          p.block.thinking = String(p.block.thinking ?? "") + String(delta.thinking ?? "");
        } else if (delta.type === "signature_delta") {
          // La firma se conserva tal cual: sin ella el bloque no es válido al devolverlo.
          p.block.signature = String(p.block.signature ?? "") + String(delta.signature ?? "");
        }
        break;
      }
      case "content_block_stop": {
        const idx = Number(d.index);
        const p = this.pending.get(idx);
        if (!p) break;
        this.pending.delete(idx);
        if (p.block.type === "tool_use") {
          const parsed = parseToolJson(p.json, p.block.input) as { ok: boolean; value?: unknown; error?: string };
          p.block.input = parsed.ok ? parsed.value : {};
          const tool: ParsedToolUse = { id: String(p.block.id ?? ""), name: String(p.block.name ?? ""), input: p.block.input };
          if (!parsed.ok) tool.inputError = parsed.error;
          (p.block as Record<string, unknown>)._inputError = parsed.ok ? undefined : parsed.error;
          this.h.onToolReady?.(tool);
        }
        this.msg.content[idx] = p.block as ContentBlock;
        break;
      }
      case "message_delta": {
        if (d.delta?.stop_reason) this.msg.stopReason = String(d.delta.stop_reason);
        this.mergeUsage(d.usage);
        break;
      }
      case "error": {
        this.msg.streamError = { type: String(d.error?.type ?? "error"), message: String(d.error?.message ?? "") };
        break;
      }
      default:
        break;
    }
  }

  /** Bloques en orden (por índice), sin huecos ni campos internos. */
  finalContent(): ContentBlock[] {
    return this.msg.content.filter(Boolean).map((b) => {
      const { _inputError: _e, ...rest } = b as Record<string, unknown>;
      return rest as ContentBlock;
    });
  }

  toolUses(): ParsedToolUse[] {
    return this.msg.content.filter((b) => b && b.type === "tool_use").map((b) => {
      const t = b as Record<string, unknown>;
      const out: ParsedToolUse = { id: String(t.id), name: String(t.name), input: t.input };
      if (typeof t._inputError === "string") out.inputError = t._inputError;
      return out;
    });
  }

  private emitText(s: string) {
    if (!s) return;
    this.textSoFar += s;
    this.h.onText?.(s);
  }

  private mergeUsage(u: any) {
    if (!u || typeof u !== "object") return;
    const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);
    const keys: (keyof Usage)[] = ["input_tokens", "output_tokens", "cache_read_input_tokens", "cache_creation_input_tokens"];
    for (const k of keys) {
      const v = n(u[k]);
      if (v !== null) this.msg.usage[k] = Math.max(this.msg.usage[k], v);
    }
  }
}

/** JSON estricto de la entrada de una herramienta (con eager streaming puede venir cortado o inválido). */
export function parseToolJson(raw: string, initial: unknown): { ok: true; value: unknown } | { ok: false; error: string } {
  const s = raw.trim();
  if (!s) {
    // Sin deltas: la entrada vino completa en content_block_start (o vacía).
    return { ok: true, value: initial && typeof initial === "object" ? initial : {} };
  }
  try {
    const v = JSON.parse(s);
    if (!v || typeof v !== "object" || Array.isArray(v)) return { ok: false, error: "la entrada no es un objeto" };
    return { ok: true, value: v };
  } catch {
    return { ok: false, error: "JSON inválido" };
  }
}

/**
 * Contenido del asistente para devolverlo en la siguiente llamada. Si hubo un respaldo del servidor a
 * mitad de la respuesta (bloque "fallback"), lo anterior al último bloque fallback solo se conserva si es
 * texto (regla del API para eco de turnos con fallback).
 */
export function assistantContentForEcho(content: ContentBlock[]): ContentBlock[] {
  const lastFb = content.map((b) => b.type).lastIndexOf("fallback");
  if (lastFb < 0) return content;
  return [
    ...content.slice(0, lastFb).filter((b) => b.type === "text"),
    ...content.slice(lastFb + 1),
  ];
}

export const textOf = (content: ContentBlock[]) =>
  content.filter((b) => b.type === "text").map((b) => String((b as { text?: unknown }).text ?? "")).join("");

// ═══ Errores ═══

export type ProviderErrorKind = "overloaded" | "server" | "timeout" | "network" | "auth" | "bad_request" | "not_found" | "refusal";

export class ProviderError extends Error {
  constructor(public kind: ProviderErrorKind, public status: number, public detail = "", public partialText = "") {
    super(`${kind} ${status}`);
  }
}

export function errorKindForStatus(status: number): ProviderErrorKind {
  if (status === 429 || status === 529 || status === 503) return "overloaded";
  if (status === 401 || status === 403) return "auth";
  if (status === 404) return "not_found";
  if (status >= 500) return "server";
  return "bad_request";
}

export function errorKindForStreamError(type: string): ProviderErrorKind {
  if (/overloaded|rate_limit/.test(type)) return "overloaded";
  if (/authentication|permission/.test(type)) return "auth";
  if (/not_found/.test(type)) return "not_found";
  if (/invalid_request/.test(type)) return "bad_request";
  return "server";
}

// ═══ Llamada en streaming ═══

export interface StreamOptions {
  fetchImpl: typeof fetch;
  apiKey: string;
  /** Tiempo máximo hasta recibir los encabezados de respuesta. */
  firstByteTimeoutMs: number;
  /** Tiempo máximo sin recibir ningún evento (el API manda ping). */
  idleTimeoutMs: number;
  /** Tope total de la llamada. */
  totalTimeoutMs: number;
  signal?: AbortSignal;
}

export interface StreamResult extends AccumulatedMessage {
  toolUses: ParsedToolUse[];
  text: string;
  latency: { headersMs: number; firstTextMs: number | null; totalMs: number };
}

/** POST /v1/messages con stream:true. Lanza ProviderError con el tipo de falla (para el circuit breaker). */
export async function streamAnthropic(input: AnthropicRequestInput, opts: StreamOptions, handlers: AccumulatorHandlers = {}): Promise<StreamResult> {
  const { body, headers } = buildAnthropicRequest(input);
  const t0 = Date.now();
  let firstText: number | null = null;
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  opts.signal?.addEventListener("abort", onAbort);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut: "first" | "idle" | "total" | null = null;
  const arm = (ms: number, which: "first" | "idle") => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timedOut = which; ctrl.abort(); }, ms);
  };
  const total = setTimeout(() => { timedOut = "total"; ctrl.abort(); }, opts.totalTimeoutMs);
  const acc = new MessageAccumulator({
    ...handlers,
    onText: (d) => { if (firstText === null) firstText = Date.now() - t0; handlers.onText?.(d); },
  });
  try {
    arm(opts.firstByteTimeoutMs, "first");
    let res: Response;
    try {
      res = await opts.fetchImpl(ANTHROPIC_URL, {
        method: "POST",
        headers: { ...headers, "x-api-key": opts.apiKey },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
    } catch (e) {
      if (timedOut) throw new ProviderError("timeout", 0, `timeout_${timedOut}`);
      throw new ProviderError("network", 0, (e as Error)?.message ?? "fetch failed");
    }
    const headersMs = Date.now() - t0;
    if (!res.ok || !res.body) {
      const detail = await res.text().catch(() => "");
      throw new ProviderError(errorKindForStatus(res.status), res.status, detail.slice(0, 500));
    }
    arm(opts.idleTimeoutMs, "idle");
    const parser = new SseParser();
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        arm(opts.idleTimeoutMs, "idle");
        for (const ev of parser.push(decoder.decode(value, { stream: true }))) acc.apply(ev);
        if (acc.msg.streamError) break;
      }
      for (const ev of parser.flush()) acc.apply(ev);
    } catch (e) {
      if (timedOut) throw new ProviderError("timeout", 200, `timeout_${timedOut}`, acc.text);
      throw new ProviderError("network", 200, (e as Error)?.message ?? "stream failed", acc.text);
    }
    if (acc.msg.streamError) {
      throw new ProviderError(errorKindForStreamError(acc.msg.streamError.type), 200, acc.msg.streamError.message.slice(0, 300), acc.text);
    }
    if (!acc.msg.stopReason) throw new ProviderError("network", 200, "stream incompleto", acc.text);
    const content = acc.finalContent();
    return {
      ...acc.msg,
      content,
      toolUses: acc.toolUses(),
      text: textOf(content),
      latency: { headersMs, firstTextMs: firstText, totalMs: Date.now() - t0 },
    };
  } finally {
    if (timer) clearTimeout(timer);
    clearTimeout(total);
    opts.signal?.removeEventListener("abort", onAbort);
  }
}

/** Llamada sin streaming (resumen de memoria en segundo plano). Devuelve el texto o null. */
export async function completeAnthropic(
  input: { model: string; system: string; user: string; maxTokens: number; effort?: Effort },
  opts: { fetchImpl: typeof fetch; apiKey: string; timeoutMs: number },
): Promise<{ text: string; usage: Usage; model: string } | null> {
  try {
    const res = await opts.fetchImpl(ANTHROPIC_URL, {
      method: "POST",
      headers: { "content-type": "application/json", "anthropic-version": ANTHROPIC_VERSION, "x-api-key": opts.apiKey },
      body: JSON.stringify({
        model: input.model, max_tokens: input.maxTokens, system: input.system,
        output_config: { effort: input.effort ?? "low" },
        messages: [{ role: "user", content: input.user }],
      }),
      signal: AbortSignal.timeout(opts.timeoutMs),
    });
    if (!res.ok) return null;
    const j = await res.json();
    if (j?.stop_reason === "refusal") return null;
    const text = textOf(Array.isArray(j?.content) ? j.content : []).trim();
    const u = j?.usage ?? {};
    return {
      text,
      model: typeof j?.model === "string" ? j.model : input.model,
      usage: {
        input_tokens: Number(u.input_tokens) || 0, output_tokens: Number(u.output_tokens) || 0,
        cache_read_input_tokens: Number(u.cache_read_input_tokens) || 0, cache_creation_input_tokens: Number(u.cache_creation_input_tokens) || 0,
      },
    };
  } catch {
    return null;
  }
}
