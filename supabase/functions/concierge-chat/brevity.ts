// Respuestas cortas de Iato (reporte del dueño, 23-oct-2026: "es demasiado texto para lo que pedí").
// Lógica pura, probada con Vitest. Corre en finalize.ts ANTES de los guardarraíles de honestidad, así
// que lo que se recorta nunca se lleva una etiqueta ("sin verificar", "Aún no está reservado"): esas se
// aplican sobre el texto ya recortado.
//
// El prompt ya pide 2 a 4 líneas; esto es la red por si el modelo se extiende:
//   * Quita los consejos del vuelo (check-in, a qué hora salir) cuando el usuario pidió otra cosa.
//   * Recorta por líneas completas (y, si una sola línea es enorme, por oraciones completas) al tope del
//     modo. El detalle vive en las cards; si quiere más, lo pide.

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

/** Recorta al tope del modo por líneas completas; una línea gigante se recorta por oraciones. */
export function compactReply(text: string, opts: { exigente?: boolean } = {}): { text: string; trimmed: boolean } {
  const lim = opts.exigente ? REPLY_LIMITS.exigente : REPLY_LIMITS.normal;
  const src = String(text ?? "").trim();
  const lines = src.split("\n");
  const out: string[] = [];
  let count = 0;
  let chars = 0;
  let trimmed = false;
  for (const line of lines) {
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
      }
      trimmed = true;
      break;
    }
    out.push(line);
    count += 1;
    chars += line.length;
  }
  const result = out.join("\n").trim();
  // Un encabezado o una línea que termina en ":" sin nada después no se deja colgando.
  const clean = trimmed ? result.replace(/\n[^\n]*:\s*$/, "").trim() || result : result;
  return { text: clean, trimmed: trimmed || clean !== result };
}

/** Líneas no vacías (la misma cuenta que usa la rúbrica, scripts/concierge/rubric.mjs). */
export const countLines = (text: string) => String(text ?? "").split(/\n+/).filter((l) => l.trim()).length;
