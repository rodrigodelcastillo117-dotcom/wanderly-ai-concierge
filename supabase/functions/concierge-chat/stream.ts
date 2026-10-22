// Protocolo de streaming entre concierge-chat y la pantalla del Concierge (SSE). Lógica pura: la usan
// el servidor (para escribir) y src/lib/conciergeStream.ts (para leer), y se prueba con Vitest.
//
// Antes la app esperaba el JSON completo (2 llamadas al modelo + herramientas) sin ver nada. Ahora:
//   meta    → viaje en contexto y modo (llega de inmediato)
//   status  → pasos en vivo: "Consultando tu vuelo AF179…" (running → done/empty/error)
//   delta   → texto de la respuesta mientras el modelo lo escribe
//   reset   → el texto mostrado era un preámbulo antes de usar herramientas: se descarta
//   final   → respuesta validada (texto con etiquetas de honestidad, cards y acciones)
//   error   → código estable + mensaje en español (errors.ts)

export const DATA_SENTINEL = "<<<IATO_DATA>>>";

export type StepState = "running" | "done" | "empty" | "error";

export type ConciergeStreamEvent =
  | { type: "meta"; data: Record<string, unknown> }
  | { type: "status"; data: { id: string; text: string; state: StepState } }
  | { type: "delta"; data: { text: string } }
  | { type: "reset"; data: Record<string, never> }
  | { type: "final"; data: Record<string, unknown> }
  | { type: "error"; data: { code: string; message: string; status?: number } };

export function encodeEvent(ev: ConciergeStreamEvent): string {
  return `event: ${ev.type}\ndata: ${JSON.stringify(ev.data)}\n\n`;
}

/** Lector incremental del lado de la app. */
export class ConciergeStreamParser {
  private buf = "";
  push(chunk: string): ConciergeStreamEvent[] {
    this.buf += chunk.replace(/\r\n/g, "\n");
    const out: ConciergeStreamEvent[] = [];
    let i: number;
    while ((i = this.buf.indexOf("\n\n")) >= 0) {
      const raw = this.buf.slice(0, i);
      this.buf = this.buf.slice(i + 2);
      const ev = parseBlock(raw);
      if (ev) out.push(ev);
    }
    return out;
  }
  flush(): ConciergeStreamEvent[] {
    const raw = this.buf;
    this.buf = "";
    const ev = raw.trim() ? parseBlock(raw) : null;
    return ev ? [ev] : [];
  }
}

const KNOWN = new Set(["meta", "status", "delta", "reset", "final", "error"]);

function parseBlock(raw: string): ConciergeStreamEvent | null {
  let type = "";
  const data: string[] = [];
  for (const line of raw.split("\n")) {
    if (line.startsWith("event:")) type = line.slice(6).trim();
    else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
  }
  if (!KNOWN.has(type)) return null;
  try {
    const parsed = data.length ? JSON.parse(data.join("\n")) : {};
    if (!parsed || typeof parsed !== "object") return null;
    return { type, data: parsed } as ConciergeStreamEvent;
  } catch {
    return null;
  }
}

/**
 * Filtro del texto en streaming: deja pasar lo que el usuario debe ver y retiene el bloque de datos
 * (después de DATA_SENTINEL) y cualquier prefijo que todavía podría ser el inicio del centinela.
 * Si la respuesta empieza con "{" (formato JSON viejo o del respaldo), no se muestra nada en vivo: se
 * valida completa al final.
 */
export class AnswerStreamFilter {
  private raw = "";
  private emitted = 0;
  private stopped = false;
  private jsonMode: boolean | null = null;

  push(delta: string): string {
    this.raw += delta;
    if (this.stopped) return "";
    if (this.jsonMode === null) {
      const lead = this.raw.trimStart();
      if (!lead) return "";
      this.jsonMode = lead.startsWith("{") || lead.startsWith("```");
    }
    if (this.jsonMode) return "";
    const idx = this.raw.indexOf(DATA_SENTINEL);
    let safeEnd: number;
    if (idx >= 0) {
      safeEnd = idx;
      this.stopped = true;
    } else {
      // Retener el sufijo que coincide con el inicio del centinela ("<<<IA…").
      safeEnd = this.raw.length;
      for (let k = Math.min(DATA_SENTINEL.length - 1, this.raw.length); k > 0; k--) {
        if (DATA_SENTINEL.startsWith(this.raw.slice(-k))) { safeEnd = this.raw.length - k; break; }
      }
    }
    if (safeEnd <= this.emitted) return "";
    const out = this.raw.slice(this.emitted, safeEnd);
    this.emitted = safeEnd;
    return out;
  }

  /** Al terminar sin centinela: lo retenido que resultó no serlo. */
  flush(): string {
    if (this.stopped || this.jsonMode) return "";
    const out = this.raw.slice(this.emitted);
    this.emitted = this.raw.length;
    return out;
  }

  get fullText() { return this.raw; }
  get visibleSoFar() { return this.raw.slice(0, this.emitted); }
}

/** Separa el texto visible del bloque de datos {cards, actions}. Acepta también el formato JSON viejo. */
export function splitAnswer(raw: string): { text: string; data: Record<string, unknown> | null; format: "sentinel" | "json" | "text" } {
  const s = String(raw ?? "");
  const idx = s.indexOf(DATA_SENTINEL);
  if (idx >= 0) {
    const text = s.slice(0, idx).trim();
    const tail = s.slice(idx + DATA_SENTINEL.length).trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
    return { text, data: looseObject(tail), format: "sentinel" };
  }
  const trimmed = s.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("```")) {
    const obj = looseObject(trimmed.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim());
    if (obj && typeof obj.text === "string") {
      const { text, ...rest } = obj;
      return { text: String(text), data: rest, format: "json" };
    }
  }
  return { text: trimmed, data: null, format: "text" };
}

function looseObject(s: string): Record<string, unknown> | null {
  const tryParse = (x: string) => {
    try {
      const v = JSON.parse(x);
      return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  };
  const direct = tryParse(s);
  if (direct) return direct;
  const m = s.match(/\{[\s\S]*\}/);
  return m ? tryParse(m[0]) : null;
}
