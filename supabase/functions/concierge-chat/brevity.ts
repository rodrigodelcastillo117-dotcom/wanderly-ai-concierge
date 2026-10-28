// Respuestas cortas de Iato (reporte del dueño, 23-oct-2026: "es demasiado texto para lo que pedí").
// Lógica pura, probada con Vitest.
//
// Regla de oro (auditoría 10, 28-oct-2026, P0): lo que el usuario ya vio mientras se escribía la
// respuesta NUNCA se borra al final. Antes compactReply recortaba DESPUÉS del streaming y dejaba
// "…dirigidos a sus ciudadanos:" o "- **Lo que falta:**" colgando, sin la fuente ni el "Siguiente paso".
// Ahora:
//   * La brevedad la pide el prompt (2–4 líneas; prompt.ts) y el tope de tokens del modelo.
//   * Los consejos del vuelo que no pidió se filtran EN VIVO, oración por oración (LiveAdviceFilter),
//     antes de mostrarse: lo que se ve es exactamente lo que queda.
//   * compactReply solo corre cuando la respuesta NO se mostró en vivo (formato JSON o respaldo), por
//     bloques y oraciones completas, sin frases que presentan una lista sin su lista y sin quitar la
//     fuente ni el siguiente paso.
// Los guardarraíles de honestidad (guard.ts) corren después y sí pueden corregir lo mostrado.

export const REPLY_LIMITS = {
  normal: { lines: 6, chars: 520 },
  exigente: { lines: 10, chars: 1100 },
} as const;

const norm = (v: string) => v.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Oración que da consejos del vuelo (no del lugar que pidió). */
const FLIGHT_ADVICE = /\b(check ?-?in|documenta(r|cion|te)|pase de abordar|abordaje|abordar|(llega|llegar|llegues|sal|salir|salgas|ir|vete)( [a-z0-9]+){0,3} al aeropuerto|tu vuelo|el vuelo|tus vuelos|vuelo [a-z]{2}\s?\d{2,4})\b/;
/** El usuario habló del vuelo: entonces sí puede ir el consejo. */
const ASKED_FLIGHT = /\b(vuelo|vuelos|aeropuerto|check ?-?in|abordar|abordaje|documentar|maleta|equipaje|terminal)\b/;

const splitSentences = (line: string) => line.split(/(?<=[.!?…])\s+(?=[¿¡"“(*A-ZÁÉÍÓÚÑ0-9])/);

/** Quita oraciones sobre el vuelo de la respuesta (solo si el usuario no habló del vuelo). */
export function dropUnaskedFlightAdvice(text: string, userMessage: string): string {
  if (ASKED_FLIGHT.test(norm(userMessage))) return text;
  const out: string[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) { out.push(line); continue; }
    const kept = splitSentences(line).filter((s) => !FLIGHT_ADVICE.test(norm(s)));
    const joined = kept.join(" ").trimEnd();
    // Una viñeta que solo hablaba del vuelo se va completa.
    if (joined.trim() && !/^\s*([-*•]|\d+[.)])\s*$/.test(joined)) out.push(joined);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Filtro EN VIVO de los consejos del vuelo que el usuario no pidió (check-in, a qué hora salir al
 * aeropuerto) cuando pidió otra cosa (una cena). Va oración por oración: una oración se muestra en
 * cuanto termina, o no se muestra nunca. Sin nada que filtrar deja pasar el texto tal cual (sin
 * retraso). `shown` es exactamente lo que el usuario vio.
 */
export class LiveAdviceFilter {
  private buf = "";
  private prefix = "";
  private atLineStart = true;
  private lineOut = false;
  private lineHadText = false;
  shown = "";
  dropped = 0;
  readonly active: boolean;

  constructor(opts: { avoidFlight: boolean; userMessage: string }) {
    this.active = opts.avoidFlight && !ASKED_FLIGHT.test(norm(opts.userMessage ?? ""));
  }

  push(delta: string): string {
    if (!this.active) { this.shown += delta; return delta; }
    this.buf += delta;
    return this.drain(false);
  }

  flush(): string {
    return this.active ? this.drain(true) : "";
  }

  private emit(t: string): string {
    this.shown += t;
    return t;
  }

  private sentence(seg: string): string {
    let rest = seg;
    if (this.atLineStart) {
      const m = rest.match(/^\s*([-*•]|\d+[.)])\s+/);
      if (m) { this.prefix = m[0]; rest = rest.slice(m[0].length); }
      this.atLineStart = false;
    }
    if (!rest.trim()) return "";
    this.lineHadText = true;
    if (FLIGHT_ADVICE.test(norm(rest))) { this.dropped += 1; return ""; }
    const lead = this.lineOut ? "" : this.prefix;
    this.lineOut = true;
    return this.emit(lead + rest);
  }

  private endLine(): string {
    let out = "";
    if (this.lineOut) out = this.emit("\n");
    // Línea en blanco (separa párrafos): una sola y nunca al principio. Una línea que solo traía
    // consejos del vuelo no deja hueco.
    else if (!this.lineHadText && !this.prefix && this.shown.endsWith("\n") && !this.shown.endsWith("\n\n")) out = this.emit("\n");
    this.atLineStart = true;
    this.lineOut = false;
    this.lineHadText = false;
    this.prefix = "";
    return out;
  }

  private drain(final: boolean): string {
    let out = "";
    for (;;) {
      const nl = this.buf.indexOf("\n");
      const m = /[.!?…](?:\*\*|["”')])?[ \t]+/.exec(this.buf);
      if (nl >= 0 && (!m || nl <= m.index)) {
        out += this.sentence(this.buf.slice(0, nl));
        this.buf = this.buf.slice(nl + 1);
        out += this.endLine();
        continue;
      }
      if (m) {
        const end = m.index + m[0].length;
        out += this.sentence(this.buf.slice(0, end));
        this.buf = this.buf.slice(end);
        continue;
      }
      if (final && this.buf) {
        out += this.sentence(this.buf);
        this.buf = "";
      }
      return out;
    }
  }
}

/** Línea que no se pierde al recortar: la fuente y la fecha de consulta, el siguiente paso. */
const PROTECTED = /^\W*(fuente|fuentes|consultad[oa]|siguiente paso|despu[eé]s)\b|\bfuente:|\bconsultad[oa] (hoy|el)\b/i;
/** Encabezado o frase que presenta algo ("Lo que falta:", "…dirigidos a sus ciudadanos:"). */
const INTRO = /:\s*(\*\*)?\s*$/;
const LIST_ITEM = /^\s*([-*•]|\d+[.)])\s+/;

/**
 * Recorta al tope del modo SOLO cuando la respuesta no se mostró en vivo (formato JSON o respaldo): lo
 * que el usuario ya leyó nunca se borra (P0 de la auditoría 10, 28-oct-2026: "…dirigidos a sus
 * ciudadanos:" y "- **Lo que falta:**" sin nada después). Reglas:
 *   * por bloques completos (párrafo, viñeta) y, si el primero es enorme, por oraciones completas;
 *   * una frase que presenta una lista (termina en ":") se queda con su lista completa o se va con ella;
 *   * la fuente y la fecha de consulta y el "Siguiente paso" no se recortan nunca.
 */
export function compactReply(text: string, opts: { exigente?: boolean } = {}): { text: string; trimmed: boolean } {
  const lim = opts.exigente ? REPLY_LIMITS.exigente : REPLY_LIMITS.normal;
  const src = String(text ?? "").trim();
  const lines = src.split("\n");
  const nonEmpty = lines.filter((l) => l.trim());
  if (nonEmpty.length <= lim.lines && src.length <= lim.chars) return { text: src, trimmed: false };

  const out: string[] = [];
  let count = 0;
  let chars = 0;
  let cutAt = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) {
      if (out.length && out[out.length - 1].trim()) out.push("");
      continue;
    }
    if (count >= lim.lines || chars + line.length > lim.chars) {
      if (count === 0) {
        // Primera línea más larga que el tope: oraciones completas hasta el tope (al menos una).
        let acc = "";
        for (const s of splitSentences(line)) {
          if (acc && acc.length + 1 + s.length > lim.chars) break;
          acc = acc ? `${acc} ${s}` : s;
        }
        out.push(acc);
        count = 1;
        chars = acc.length;
      }
      cutAt = i;
      break;
    }
    out.push(line);
    count += 1;
    chars += line.length;
  }
  if (cutAt < 0) return { text: src, trimmed: false };

  // Una frase que presenta una lista no se queda colgando: o va con su lista completa (si la lista
  // cabe en el doble del tope) o se quita junto con ella.
  const lastIdx = () => { for (let k = out.length - 1; k >= 0; k--) if (out[k].trim()) return k; return -1; };
  let li = lastIdx();
  if (li >= 0 && INTRO.test(out[li])) {
    const list: string[] = [];
    let j = cutAt;
    while (j < lines.length && (LIST_ITEM.test(lines[j]) || (!lines[j].trim() && list.length === 0))) {
      if (lines[j].trim()) list.push(lines[j]);
      j++;
    }
    const total = chars + list.reduce((a, l) => a + l.length, 0);
    if (list.length && total <= lim.chars * 2) {
      out.push(...list);
      cutAt = j;
    } else {
      // Se quita la frase que presenta (o la línea entera si solo era el encabezado).
      const sentences = splitSentences(out[li]);
      if (sentences.length > 1) out[li] = sentences.slice(0, -1).join(" ");
      else out.splice(li, 1);
    }
  }
  // Sin encabezados colgando al final (después de quitar la frase pueden quedar otros).
  while ((li = lastIdx()) >= 0 && INTRO.test(out[li]) && splitSentences(out[li]).length === 1) out.splice(li, 1);
  // La fuente y el siguiente paso que quedaron después del corte se conservan, en su orden.
  const kept = lines.slice(cutAt).filter((l) => l.trim() && PROTECTED.test(l.trim()) && !out.includes(l));
  const result = [...out, ...(kept.length ? ["", ...kept] : [])].join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return { text: result || src, trimmed: true };
}

/** Líneas no vacías (la misma cuenta que usa la rúbrica, scripts/concierge/rubric.mjs). */
export const countLines = (text: string) => String(text ?? "").split(/\n+/).filter((l) => l.trim()).length;
