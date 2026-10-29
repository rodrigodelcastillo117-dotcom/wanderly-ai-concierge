// Hora al pie de cada globo del chat de Iato.
// Auditoría 10, ronda 4, N4-P2-2: el pie de la respuesta de Tokio decía "en Tokio · 02:54" y se leía como
// hora de Tokio, pero era la hora de CDMX en que se consultó. En las respuestas de Iato el pie dice ahora
// "consultado 02:54 (hora CDMX)": cuándo se consultó y en qué zona.
import { tzLabel, validTz } from "../../supabase/functions/_shared/localTime.ts";

/** "02:54" hoy; "27 oct, 02:54" otro día. */
export function bubbleClock(ts: number, now: Date = new Date(), tz?: string | null): string {
  if (!ts || !Number.isFinite(ts)) return "";
  const zone = tz && validTz(tz) ? { timeZone: tz } : {};
  const d = new Date(ts);
  const hm = d.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit", hour12: false, ...zone });
  const day = (x: Date) => x.toLocaleDateString("es-MX", { ...zone, year: "numeric", month: "2-digit", day: "2-digit" });
  if (day(d) === day(now)) return hm;
  return `${d.toLocaleDateString("es-MX", { day: "numeric", month: "short", ...zone }).replace(".", "")}, ${hm}`;
}

/** Zona en palabras: "hora CDMX", "hora de Madrid", "hora UTC". */
const zoneWords = (tz: string) => (/^(etc\/)?(utc|gmt)$/i.test(tz) ? "hora UTC" : tzLabel(tz));

/** Partes del pie: en las respuestas de Iato "consultado " + hora + " (hora CDMX)"; en las del usuario, la hora sola. */
export function bubbleFooterParts(ts: number, opts: { assistant: boolean; tz?: string | null; now?: Date }): { prefix: string; clock: string; suffix: string } {
  const clock = bubbleClock(ts, opts.now, opts.tz);
  if (!clock || !opts.assistant) return { prefix: "", clock, suffix: "" };
  return { prefix: "consultado ", clock, suffix: opts.tz && validTz(opts.tz) ? ` (${zoneWords(opts.tz)})` : "" };
}

/** Pie del globo como texto: "consultado 02:54 (hora CDMX)" o "02:54". */
export function bubbleFooterTime(ts: number, opts: { assistant: boolean; tz?: string | null; now?: Date }): string {
  const p = bubbleFooterParts(ts, opts);
  return p.clock ? `${p.prefix}${p.clock}${p.suffix}` : "";
}
