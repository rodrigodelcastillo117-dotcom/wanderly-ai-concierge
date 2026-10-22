// AUD-03 · Reglas deterministas sobre el TEXTO que escribió el restaurante. El clasificador es un LLM
// y puede equivocarse o ser manipulado por el correo; aquí se comprueba, sin modelo, que lo que
// afirma está escrito y que nada lo contradice:
//   * fechas, horas, personas y nombre que aparecen en la respuesta (es/en/fr),
//   * palabras de duda, negación, condición, pendiente, pregunta o pago,
//   * una frase EXPLÍCITA de confirmación ("confirmamos", "confirmed", "nous confirmons"…),
//   * la ligadura con nuestra solicitud exacta: la respuesta cita nuestra solicitud sin cambios.
// Sin Deno ni red. Probado en src/test/aiReservationsConfirmRules.test.ts.
import { type AiReservationRow, splitQuotedReply, type VenueLanguage } from "./core.ts";
import { refMarker, requestFingerprint } from "./templates.ts";

// r2-v1 (A2-RES-02/03): vetos de negación y cancelación, números en letra hasta 20, horas en palabras,
// números sin explicar con la cita del hilo, fechas dd/mm ambiguas. La base (ai_res_rules_versions)
// solo acepta confirmaciones decididas con esta versión o posterior.
export const RULES_VERSION = "r2-v1";

/** Minúsculas, sin acentos, comillas rectas y espacios simples (para comparar texto escrito a mano). */
export const fold = (s: unknown) => String(s ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
  .replace(/[‘’´`]/g, "'").replace(/[“”«»]/g, '"').replace(/\s+/g, " ").trim();

const mask = (s: string, start: number, len: number) => s.slice(0, start) + " ".repeat(len) + s.slice(start + len);
const pad2 = (n: number) => String(n).padStart(2, "0");

// ───────────────────────────── Números ─────────────────────────────
// A2-RES-03: hasta 20 en es/en/fr y pt (antes solo hasta 12, sin pt).
const NUM_WORDS: Record<string, number> = {
  uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12,
  trece: 13, catorce: 14, quince: 15, dieciseis: 16, diecisiete: 17, dieciocho: 18, diecinueve: 19, veinte: 20,
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
  un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, sept: 7, huit: 8, neuf: 9, dix: 10, onze: 11, douze: 12,
  treize: 13, quatorze: 14, quinze: 15, seize: 16, "dix-sept": 17, "dix-huit": 18, "dix-neuf": 19, vingt: 20,
  um: 1, uma: 1, dois: 2, duas: 2, quatro: 4, sete: 7, oito: 8, nove: 9, dez: 10, doze: 12, treze: 13, catorze: 14,
  dezesseis: 16, dezasseis: 16, dezessete: 17, dezassete: 17, dezoito: 18, dezenove: 19, dezanove: 19, vinte: 20,
};
const NUM = `(\\d{1,2}|${Object.keys(NUM_WORDS).sort((a, b) => b.length - a.length).join("|")})`;
const NUM_WORD_ALT = Object.keys(NUM_WORDS).sort((a, b) => b.length - a.length).join("|");
const toNum = (x: string) => (/^\d+$/.test(x) ? Number(x) : NUM_WORDS[x]);
const NOT_TIME = "(?![:.h]\\d)";
const PARTY_NOUN = "(?:personas?|comensales|invitados|adultos|pax|people|persons?|guests?|diners|adults|personnes?|couverts?|convives|pessoas?|convidados|adultos)";
const PARTY_RES = [
  new RegExp(`\\b${NUM}${NOT_TIME}\\s+${PARTY_NOUN}\\b`, "g"),
  new RegExp(`\\b(?:mesa|table|reserva|reservacion|reservation|booking)\\s+(?:para|for|pour)\\s+${NUM}${NOT_TIME}\\b`, "g"),
  new RegExp(`\\b(?:party|group|grupo|groupe)\\s+(?:of|de)\\s+${NUM}${NOT_TIME}\\b`, "g"),
  new RegExp(`\\b(?:recibir(?:los|las|les)?|acomodar(?:los|las)?|sentar(?:los|las)?|seat|host|accommodate|accueillir|recevoir)\\s+(?:a\\s+)?${NUM}${NOT_TIME}\\b`, "g"),
  new RegExp(`\\b(?:no|not|pas)\\s+(?:a\\s+|para\\s+|for\\s+|pour\\s+)?${NUM}${NOT_TIME}\\b`, "g"),
];

// ───────────────────────────── Horas ─────────────────────────────
const PM_PARTS = /(noche|tarde|soir|apres-midi|evening|afternoon)/;
const TIME_RES: RegExp[] = [
  // 20:30 · 20.30 · 20h30 · 8:30 pm · 8.30 p.m. · 8:30 de la noche
  /(?<![\d:.$€£])([01]?\d|2[0-3])\s?[:h.]\s?([0-5]\d)(?!\d)(?!\s?[./]\s?\d)\s*(a\.?\s?m\.?(?![a-z])|p\.?\s?m\.?(?![a-z])|de la (?:noche|tarde|manana)|du soir|du matin|de l'apres-midi|in the (?:evening|morning|afternoon))?/g,
  // 8pm · 9 p.m.
  /(?<![\d:.$€£])(1[0-2]|0?[1-9])\s?(a\.?\s?m\.?|p\.?\s?m\.?)(?![a-z])/g,
  // 20h (francés, sin minutos)
  /(?<![\d:.$€£])([01]?\d|2[0-3])\s?h(?![a-z0-9])/g,
  // a las 8 de la noche
  /\ba las (1[0-2]|0?[1-9])\s+(de la (?:noche|tarde|manana))/g,
];
// A2-RES-03: horas sin am/pm ("a las 9", "para las nueve", "at 9", "à neuf heures", "às nove"). Sin
// sufijo la hora es ambigua (9 → 09:00 o 21:00): cuenta como mención (contradice si ninguna coincide),
// pero nunca como hora "escrita" exacta.
const HOUR_WORD = `(\\d{1,2}|${["una", "uno", "um", "uma", "one", "une", ...Object.keys(NUM_WORDS)].filter((w, i, a) => a.indexOf(w) === i).sort((a, b) => b.length - a.length).join("|")})`;
const HOUR_MIN = "(?:\\s+(?:y|e|et|and)\\s+(media|meia|demie|half|cuarto|quart|quarter))?";
const HOUR_SUFFIX = "(?:\\s+(?:horas|hrs?|heures?|o'?clock|h))?(?:\\s+(de la (?:noche|tarde|manana)|du soir|du matin|de l'apres-midi|da (?:noite|tarde|manha)|in the (?:evening|morning|afternoon)))?";
const NOT_PARTY = `(?!\\s+${"(?:personas?|comensales|invitados|adultos|pax|people|persons?|guests?|diners|adults|personnes?|couverts?|convives|pessoas?|convidados)"}\\b)`;
const LOOSE_TIME_RES: RegExp[] = [
  new RegExp(`\\b(?:a|para|desde|hacia|sobre|antes de|despues de|a partir de)\\s+las?\\s+${HOUR_WORD}(?![\\d:h]|\\.\\d)${NOT_PARTY}${HOUR_MIN}${HOUR_SUFFIX}(?![a-z])`, "g"),
  new RegExp(`\\b(?:at|around|from|until|by)\\s+${HOUR_WORD}(?![\\d:h]|\\.\\d)${NOT_PARTY}${HOUR_MIN}${HOUR_SUFFIX}(?![a-z])`, "g"),
  new RegExp(`\\b(?:a|vers|pour|des)\\s+${HOUR_WORD}\\s+heures?(?:\\s+(et demie|et quart))?(?:\\s+(du soir|du matin|de l'apres-midi))?(?![a-z])`, "g"),
  new RegExp(`\\b(?:as|pelas|para as|a partir das)\\s+${HOUR_WORD}(?![\\d:h]|\\.\\d)${NOT_PARTY}${HOUR_MIN}${HOUR_SUFFIX}(?![a-z])`, "g"),
];
const MIN_WORDS: Record<string, number> = { media: 30, meia: 30, demie: 30, half: 30, cuarto: 15, quart: 15, quarter: 15, "et demie": 30, "et quart": 15 };
function looseHours(word: string, minWord: string | undefined, suffix: string | undefined): string[] {
  const h = /^\d+$/.test(word) ? Number(word) : NUM_WORDS[word] ?? (["una", "uno", "um", "uma", "one", "une"].includes(word) ? 1 : NaN);
  if (!Number.isFinite(h) || h > 23) return [];
  const m = minWord ? MIN_WORDS[minWord] ?? 0 : 0;
  if (suffix) { const t = toHHMM(h, m, suffix); return t ? [t] : []; }
  if (h === 0 || h > 12) return [`${pad2(h)}:${pad2(m)}`];
  return [...new Set([`${pad2(h === 12 ? 0 : h)}:${pad2(m)}`, `${pad2(h === 12 ? 12 : h + 12)}:${pad2(m)}`])];
}

function toHHMM(h: number, m: number, suffix: string | undefined): string | null {
  const sx = (suffix ?? "").replace(/[\s.]/g, "");
  if (sx === "pm" || PM_PARTS.test(sx) || /(noite)/.test(sx)) { if (h < 12) h += 12; } else if ((sx === "am" || /(manana|matin|morning|manha)/.test(sx)) && h === 12) h = 0;
  return h <= 23 && m <= 59 ? `${pad2(h)}:${pad2(m)}` : null;
}

// ───────────────────────────── Fechas ─────────────────────────────
const MONTHS: Record<string, number> = {
  enero: 1, ene: 1, january: 1, jan: 1, janvier: 1, janv: 1, febrero: 2, feb: 2, february: 2, fevrier: 2, fevr: 2, fev: 2,
  marzo: 3, mar: 3, march: 3, mars: 3, abril: 4, abr: 4, april: 4, apr: 4, avril: 4, avr: 4, mayo: 5, may: 5, mai: 5,
  junio: 6, jun: 6, june: 6, juin: 6, julio: 7, jul: 7, july: 7, juillet: 7, juil: 7, agosto: 8, ago: 8, august: 8, aug: 8, aout: 8,
  septiembre: 9, setiembre: 9, sep: 9, sept: 9, september: 9, septembre: 9, octubre: 10, oct: 10, october: 10, octobre: 10,
  noviembre: 11, nov: 11, november: 11, novembre: 11, diciembre: 12, dic: 12, december: 12, dec: 12, decembre: 12,
};
const MONTH_ALT = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join("|");
// Mes antes del día ("November 3rd"): sin abreviaturas que también son días ("mar", "mai"…) ni "may" (verbo).
const MONTH_FIRST_ALT = Object.keys(MONTHS).filter((m) => m.length > 3 || ["jan", "feb", "apr", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].includes(m))
  .filter((m) => m !== "mars" && m !== "mai").sort((a, b) => b.length - a.length).join("|");
const WEEKDAYS: Record<string, number> = {
  domingo: 0, sunday: 0, dimanche: 0, lunes: 1, monday: 1, lundi: 1, martes: 2, tuesday: 2, mardi: 2,
  miercoles: 3, wednesday: 3, mercredi: 3, jueves: 4, thursday: 4, jeudi: 4, viernes: 5, friday: 5, vendredi: 5,
  sabado: 6, saturday: 6, samedi: 6,
};
const DAYPARTS = /\b(de la manana|por la manana|en la manana|esta manana|in the morning|this morning|du matin|ce matin)\b/g;
const RELATIVE: Array<[RegExp, number]> = [
  [/\b(pasado manana|apres-demain|apres demain|day after tomorrow)\b/g, 2],
  [/\b(manana|tomorrow|demain)\b/g, 1],
  [/\b(hoy|today|tonight|esta noche|aujourd'hui|ce soir|this evening)\b/g, 0],
];

type DateMention = { text: string; candidates: string[] }; // candidates: YYYY-MM-DD o MM-DD

function validMD(m: number, d: number) { return m >= 1 && m <= 12 && d >= 1 && d <= 31; }
function md(m: number, d: number, y?: number) { return validMD(m, d) ? (y ? `${y}-${pad2(m)}-${pad2(d)}` : `${pad2(m)}-${pad2(d)}`) : null; }

/** Fecha local (YYYY-MM-DD) de un instante en la zona del lugar. */
export function localDateIn(iso: string, tz: string): string | null {
  const t = new Date(iso);
  if (!Number.isFinite(t.getTime())) return null;
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(t);
  } catch {
    return null;
  }
}
const addDays = (ymd: string, n: number) => {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
const weekdayOf = (ymd: string) => { const [y, m, d] = ymd.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); };

// ───────────────────────────── Léxico ─────────────────────────────
export const CONFIRM_RE = new RegExp([
  // es
  "\\bconfirmad[oa]s?\\b", "\\bconfirmamos\\b", "\\b(?:queda|quedan|quedo|esta|estan) (?:confirmad|reservad|apartad)\\w*",
  "\\b(?:le|les|te) (?:hemos )?(?:reservado|apartado)\\b", "\\bhemos (?:reservado|apartado|registrado|agendado)\\b",
  // en
  "\\bconfirmed\\b", "\\bwe confirm\\b", "\\bconfirming\\b", "\\b(?:have|has) (?:been )?booked\\b", "\\bis booked\\b",
  "\\b(?:we|i)(?: have|'ve)? booked\\b", "\\bbooked (?:you|your|a table)\\b", "\\bwe(?: have|'ve) reserved\\b",
  "\\byour (?:table|reservation|booking) is (?:confirmed|booked|reserved|set)\\b",
  // fr
  "\\bconfirmee?s?\\b", "\\bnous confirmons\\b", "\\bje confirme\\b", "\\b(?:est|sont) (?:confirmee?s?|reservee?s?)\\b",
  "\\bnous avons (?:bien )?reserve\\b",
].join("|"));

export const PAYMENT_RE = /\b(tarjeta|deposito|anticipo|prepago|garantia|garantizar|pago|cargo|card|deposit|prepay(?:ment)?|payment|guarantee|pre-?authori[sz]ation|preautorizacion|carte (?:bancaire|de credit|de paiement)|acompte|prepaiement|paiement|empreinte bancaire|garantie|garantir)\b/;
export const PENDING_RE = /\b(pendiente|por confirmar|confirmacion final|confirmacion definitiva|le confirmaremos|les confirmaremos|confirmaremos|en espera|pending|to be confirmed|tbc|final confirmation|will confirm|we'll confirm|en attente|a confirmer|confirmation finale|confirmation definitive|nous vous confirmerons|vous confirmerons)\b/;
// A2-RES-02 · Negación de la propia confirmación ("no está confirmada", "aún no hemos reservado",
// "not confirmed yet", "we have not confirmed", "n'est pas confirmée", "não está confirmada"): una
// palabra de negación seguida, en la misma frase y a menos de cinco palabras, de una raíz de
// confirmar/reservar/apartar. Gana aunque el modelo diga "confirmed" (misma regla en SQL:
// public.ai_res_reply_vetoes).
const NEGATOR = "(?:no|nao|not|never|nunca|jamas|jamais|pas|non|sin|sem|without|ne|cannot|unable|n'[a-z]+|[a-z]+n't)";
const CONFIRM_STEM = "(?:confirm|reserv|apart|agend|registr|book|held|hold)";
export const NEGATED_CONFIRM_RE = new RegExp(`(?<![a-z0-9'])${NEGATOR}(?:[^\\S\\n]+[^\\s.,;:!?¿¡]+){0,4}?[^\\S\\n]+${CONFIRM_STEM}`);
// A2-RES-02 · Cancelación ("su reserva fue cancelada", "has been cancelled", "annulée", "cancelamento").
// Las frases de política ("política de cancelación", "free cancellation", "en caso de cancelación") no cuentan.
const CANCEL_POLICY_RE = /\b(?:(?:politica|politique|policy|condiciones|conditions|terminos|terms|reglas|regles|en caso de|in case of|en cas d'|em caso de)\s+(?:de\s+|d'|of\s+)?(?:cancelacion|cancellation|annulation|cancelamento)|(?:cancelacion|cancellation|annulation|cancelamento)\s+(?:policy|politica|politique|fee|fees|cargo|frais|taxa|terms|gratuita|gratis|gratuite|gratuito|sin costo|sans frais|free)|free cancellation)\b/g;
export const CANCELLED_RE = /\b(?:cancelad[oa]s?|cancelamos|cancelou|cancel+ed|cancel+ing|cancelacion|cancellation|annulee?s?|annulons|annule|annulation|anulad[oa]s?|anulamos|anulacion|cancelamento|desmarcad[oa]s?)\b/;
export const cancelMentioned = (folded: string) => CANCELLED_RE.test(folded.replace(CANCEL_POLICY_RE, " "));

const HEDGES: Array<[string, RegExp]> = [
  ["question", /[?¿]/],
  ["but", /\b(pero|sin embargo|but|however|mais|cependant|toutefois)\b/],
  ["unfortunately", /\b(lamentablemente|desafortunadamente|por desgracia|unfortunately|sadly|malheureusement|desolee?s?)\b/],
  ["negation", /\bno (?:tenemos|hay|podemos|es posible|esta disponible|estan disponibles|contamos|queda|quedan|a |para )|\b(?:not available|unavailable|no availability|fully booked|cannot|can't|can not|unable|not possible|not at|not for|n'est pas|ne sont pas|pas disponible|indisponible|ne pouvons pas|ne peut pas|impossible|complet|pas a|pas pour|no disponible|completos?|llenos?|agotad[oa]s?|sin disponibilidad)\b/],
  ["pending", PENDING_RE],
  ["request", /\b(necesitamos|necesitariamos|requerimos|favor de|le pedimos|les pedimos|por favor (?:confirm|envi|mand|indiqu|respond)\w*|podrian? (?:enviar|mandar|confirmar|indicar)|we need|we require|please (?:send|provide|confirm|let us know)|could you|kindly|nous avons besoin|merci de (?:nous )?(?:envoyer|confirmer|indiquer)|pourriez-vous|veuillez)\b/],
  ["condition", /\b(sujet[oa] a|subject to|sous reserve|siempre y cuando|as long as|a condition que|condicionad[oa]|lista de espera|wait ?list|liste d'attente)\b/],
  ["negated_confirmation", NEGATED_CONFIRM_RE],
];

const NAME_LEAD = /\b(?:a nombre de|bajo el nombre de|under the name(?: of)?|in the name of|au nom de)\s+((?:[a-z'-]+\s?){1,4})/g;
const NAME_STOP = new Set(["el", "la", "los", "las", "para", "a", "de", "for", "on", "at", "le", "pour", "con", "y", "and", "et", "su", "your", "votre", "por", "en", "is", "es", "est"]);
const HONORIFICS = new Set(["sr", "sra", "srta", "senor", "senora", "mr", "mrs", "ms", "mme", "m", "mlle", "don", "dona"]);
const nameTokens = (s: string) => fold(s).replace(/[^a-z' -]/g, " ").split(/\s+/).filter((t) => t.length >= 2 && !NAME_STOP.has(t) && !HONORIFICS.has(t));
/** Dos nombres coinciden si las palabras del más corto están todas en el más largo ("Ana" ⊂ "Ana López"). */
export function nameMatches(a: string, b: string): boolean {
  const x = nameTokens(a), y = nameTokens(b);
  if (!x.length || !y.length) return false;
  const [short, long] = x.length <= y.length ? [x, new Set(y)] : [y, new Set(x)];
  return short.every((t) => long.has(t));
}

// ───────────────────────────── Análisis ─────────────────────────────
export type ReplyAnalysis = {
  /** El texto normalizado (fold). */
  text: string;
  times: string[];
  /** A2-RES-03: horas escritas sin am/pm o en palabras ("a las nueve" → 09:00 o 21:00). */
  looseTimes: string[][];
  /** A2-RES-03: números (1–23) o números en letra (2–20) que no se explican como hora, fecha ni personas. */
  looseNumbers: string[];
  parties: number[];
  dates: DateMention[];
  relative: Array<{ text: string; date: string | null }>;
  weekdays: number[];
  names: string[];
  hedges: string[];
  pending: boolean;
  payment: boolean;
  explicitConfirmation: boolean;
};

export function analyzeReply(text: string, opts: { receivedAt?: string | null; timezone?: string | null } = {}): ReplyAnalysis {
  let f = fold(text);
  const times: string[] = [];
  for (const re of TIME_RES) {
    for (const m of [...f.matchAll(re)]) {
      const hhmm = re === TIME_RES[0] ? toHHMM(Number(m[1]), Number(m[2]), m[3])
        : re === TIME_RES[1] ? toHHMM(Number(m[1]), 0, m[2])
        : re === TIME_RES[2] ? toHHMM(Number(m[1]), 0, undefined)
        : toHHMM(Number(m[1]), 0, m[2]);
      if (hhmm) times.push(hhmm);
      f = mask(f, m.index!, m[0].length);
    }
  }
  const looseTimes: string[][] = [];
  for (const re of LOOSE_TIME_RES) {
    for (const m of [...f.matchAll(re)]) {
      const c = looseHours(m[1], m[2], m[3]);
      // Con "de la noche", "du soir"… la hora queda exacta: cuenta como escrita.
      if (c.length === 1 && m[3]) times.push(c[0]);
      else if (c.length) looseTimes.push(c);
      f = mask(f, m.index!, m[0].length);
    }
  }
  const dates: DateMention[] = [];
  const push = (t: string, c: Array<string | null>) => { const cand = c.filter((x): x is string => !!x); if (cand.length) dates.push({ text: t, candidates: cand }); };
  const DATE_RES: Array<[RegExp, (m: RegExpMatchArray) => Array<string | null>]> = [
    [/(?<!\d)(\d{4})-(\d{2})-(\d{2})(?!\d)/g, (m) => [md(+m[2], +m[3], +m[1])]],
    [/(?<![\d.])(\d{1,2})\.(\d{1,2})\.(\d{4})(?!\d)/g, (m) => [md(+m[2], +m[1], +m[3])]],
    [/(?<![\d/.])(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?(?![\d/])/g, (m) => {
      const y = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : undefined;
      return [md(+m[2], +m[1], y), md(+m[1], +m[2], y)]; // dd/mm o mm/dd
    }],
    [new RegExp(`(?<![\\d:./])(\\d{1,2})(?:er|eme|st|nd|rd|th|o)?\\s*(?:de\\s+|of\\s+)?(${MONTH_ALT})\\b\\.?(?:\\s*(?:de\\s+|,\\s*)?(\\d{4}))?`, "g"),
      (m) => [md(MONTHS[m[2]], +m[1], m[3] ? +m[3] : undefined)]],
    [new RegExp(`\\b(${MONTH_FIRST_ALT})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?![\\d:])(?:,?\\s*(\\d{4}))?`, "g"),
      (m) => [md(MONTHS[m[1]], +m[2], m[3] ? +m[3] : undefined)]],
  ];
  for (const [re, conv] of DATE_RES) {
    for (const m of [...f.matchAll(re)]) {
      push(m[0], conv(m));
      f = mask(f, m.index!, m[0].length);
    }
  }
  f = f.replace(DAYPARTS, (x) => " ".repeat(x.length));
  const today = opts.receivedAt && opts.timezone ? localDateIn(opts.receivedAt, opts.timezone) : null;
  const relative: ReplyAnalysis["relative"] = [];
  for (const [re, n] of RELATIVE) {
    for (const m of [...f.matchAll(re)]) {
      relative.push({ text: m[0], date: today ? addDays(today, n) : null });
      f = mask(f, m.index!, m[0].length);
    }
  }
  const weekdays = [...f.matchAll(new RegExp(`\\b(${Object.keys(WEEKDAYS).join("|")})\\b`, "g"))].map((m) => WEEKDAYS[m[1]]);
  const parties: number[] = [];
  for (const re of PARTY_RES) {
    for (const m of [...f.matchAll(re)]) {
      const n = toNum(m[1]);
      if (n) parties.push(n);
    }
  }
  for (const re of PARTY_RES) for (const m of [...f.matchAll(re)]) f = mask(f, m.index!, m[0].length);
  // Lo que queda: números sueltos que podrían ser personas u horas y que nadie explicó.
  const looseNumbers = [
    ...[...f.matchAll(/(?<![\w.,:/#-])(\d{1,2})(?![\w,:/%-]|\.\d|\s*%)/g)].map((m) => m[1]).filter((x) => Number(x) >= 1 && Number(x) <= 23),
    ...[...f.matchAll(new RegExp(`(?<![a-z-])(${NUM_WORD_ALT})(?![a-z-])`, "g"))].map((m) => m[1]).filter((w) => NUM_WORDS[w] >= 2 && w !== "once"),
  ];
  const full = fold(text);
  const names = [...full.matchAll(NAME_LEAD)].map((m) => {
    const words: string[] = [];
    for (const w of m[1].trim().split(/\s+/)) { if (NAME_STOP.has(w)) break; words.push(w); }
    return words.join(" ");
  }).filter(Boolean);
  const hedges = HEDGES.filter(([, re]) => re.test(full)).map(([id]) => id);
  if (cancelMentioned(full)) hedges.push("cancellation");
  return {
    text: full, times, looseTimes, looseNumbers, parties, dates, relative, weekdays, names, hedges,
    pending: PENDING_RE.test(full), payment: PAYMENT_RE.test(full), explicitConfirmation: CONFIRM_RE.test(full),
  };
}

/** ¿Alguna mención de fecha (absoluta o relativa resuelta) es exactamente este día? */
export function dateStated(a: ReplyAnalysis, ymd: string): boolean {
  const mmdd = ymd.slice(5);
  // A2-RES-09: "3/11" puede ser 3-nov o 11-mar; una fecha con dos lecturas válidas y distintas no
  // cuenta como escrita (tampoco contradice si una de las dos coincide).
  return a.dates.some((d) => new Set(d.candidates.map((c) => c.slice(-5))).size === 1 && (d.candidates.includes(ymd) || d.candidates.includes(mmdd)))
    || a.relative.some((r) => r.date === ymd);
}

/**
 * Contradicciones del texto contra un horario: horas, personas, fechas, días de la semana o nombre
 * distintos, o un "mañana" que no se puede resolver. allowedTimes/allowedDates: lo que sí puede
 * aparecer (p. ej. la hora original rechazada cuando el restaurante ofrece otra).
 */
export function contradictions(a: ReplyAnalysis, slot: { dates: string[]; times: string[]; party: number; name?: string | null }): string[] {
  const out: string[] = [];
  if (a.parties.some((p) => p !== slot.party)) out.push("party_size_mismatch");
  if (a.times.some((t) => !slot.times.includes(t))) out.push("time_mismatch");
  if (a.looseTimes.some((c) => !c.some((t) => slot.times.includes(t)))) out.push("time_mismatch");
  if (a.dates.some((d) => !slot.dates.some((s) => d.candidates.includes(s) || d.candidates.includes(s.slice(5))))) out.push("date_mismatch");
  if (a.relative.some((r) => r.date === null)) out.push("relative_date_unresolved");
  else if (a.relative.some((r) => !slot.dates.includes(r.date!))) out.push("date_mismatch");
  if (a.weekdays.some((w) => !slot.dates.some((s) => weekdayOf(s) === w))) out.push("weekday_mismatch");
  if (slot.name && a.names.some((n) => !nameMatches(n, slot.name!))) out.push("name_mismatch");
  return [...new Set(out)];
}

// ───────────────────────────── Ligadura con nuestra solicitud ─────────────────────────────
type LinkRow = Pick<AiReservationRow, "requested_local" | "party_size" | "customer_name" | "ref_code"> & { venue_language?: VenueLanguage | null };

/**
 * ¿La respuesta cita NUESTRA solicitud exacta sin cambios? Exige, en la parte citada del correo, el
 * folio "— IATOS · Ref R-XXXXXX —" de esta reserva y las tres líneas de la solicitud (fecha y hora,
 * personas, nombre) con los valores actuales, en alguno de nuestros idiomas. Si el restaurante cambió
 * algo de lo citado, o citó otra solicitud, no hay ligadura.
 */
export function quotedRequestLinked(fullText: string | null | undefined, row: LinkRow): boolean {
  if (!fullText || !row.ref_code) return false;
  const { quoted } = splitQuotedReply(fullText);
  const q = fold(quoted.split("\n").map((l) => l.replace(/^\s*(?:>\s?)+/, "").replace(/^\s*[•*·-]\s+/, "")).join("\n"));
  if (!q.includes(fold(refMarker(row.ref_code)))) return false;
  const langs = [...new Set([row.venue_language, "es", "en", "fr"].filter(Boolean))] as VenueLanguage[];
  return langs.some((lang) => requestFingerprint(row, lang).every((line) => q.includes(fold(line))));
}

// ───────────────────────────── Número de confirmación ─────────────────────────────
// Una palabra de "código" y, como mucho, cuatro palabras entre ella y el código ("número de confirmación es").
const CODE_LEAD = /\b(confirmacion|confirmation|reserva|reservacion|reservation|booking|codigo|code|folio|numero|number|no|n°|nº|ref|localizador|locator)\b(?:\W+\w+){0,4}\W*$/;
/**
 * El código solo se guarda si el restaurante lo escribió: aparece completo (no como pedazo de otra
 * palabra), cerca de una palabra como "confirmación"/"code"/"folio", tiene al menos un dígito y no
 * es nuestro folio, la hora, la fecha ni el número de personas.
 */
export function validConfirmationCode(code: string | null | undefined, replyText: string, row: Pick<AiReservationRow, "requested_local" | "party_size"> & { ref_code?: string }): string | null {
  const c = String(code ?? "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9#/.-]{2,39}$/.test(c) || !/\d/.test(c)) return null;
  const lc = c.toLowerCase();
  const [d, t] = row.requested_local.split("T");
  if ([row.ref_code, row.ref_code?.replace(/^R-/, ""), d, t, String(row.party_size)].some((x) => x && x.toLowerCase() === lc)) return null;
  if (/^\d{1,2}[:.h]\d{2}$/.test(c) || /^\d{4}-\d{2}-\d{2}$/.test(c)) return null;
  const text = String(replyText ?? "");
  const re = new RegExp(`(?<![A-Za-z0-9])${c.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}(?![A-Za-z0-9])`, "i");
  const m = re.exec(text);
  if (!m) return null;
  const before = fold(text.slice(Math.max(0, m.index - 60), m.index));
  return CODE_LEAD.test(before) ? c : null;
}

// ───────────────────────────── Motivo legible (para el usuario) ─────────────────────────────
const FIELD_ES: Record<string, string> = { date: "la fecha", time: "la hora", party_size: "para cuántas personas", name: "a nombre de quién" };
/**
 * Por qué una respuesta NO se tomó como confirmación, en una frase para el usuario (es-MX). Solo
 * describe lo que comprobaron las reglas; nunca afirma que haya lugar.
 */
export function ambiguousReasonEs(why: string | null | undefined): string | null {
  const w = String(why ?? "");
  if (w.startsWith("conditions_not_confirmed:")) {
    const fields = w.split(":")[1].split(",").map((f) => FIELD_ES[f]).filter(Boolean);
    return fields.length ? `El restaurante no confirmó ${fields.join(", ")}.` : null;
  }
  const map: Record<string, string> = {
    no_explicit_confirmation: "La respuesta no dice explícitamente que la reserva quedó hecha (por ejemplo, solo habla de disponibilidad).",
    no_verbatim_quote: "No encontramos en el correo una frase que confirme la reserva.",
    party_size_mismatch: "El correo menciona otro número de personas.",
    time_mismatch: "El correo menciona otra hora.",
    date_mismatch: "El correo menciona otra fecha.",
    weekday_mismatch: "El correo menciona otro día de la semana.",
    name_mismatch: "El correo menciona otro nombre.",
    relative_date_unresolved: "El correo usa una fecha relativa (\u201cmañana\u201d, \u201choy\u201d) que no pudimos ubicar.",
    hedge_question: "El restaurante hace una pregunta antes de confirmar.",
    hedge_but: "El restaurante pone una condición o un \u201cpero\u201d.",
    hedge_unfortunately: "El restaurante dice que algo no se puede.",
    hedge_negation: "El restaurante dice que algo no está disponible.",
    hedge_pending: "El restaurante dice que la confirmación sigue pendiente.",
    hedge_request: "El restaurante pide algo antes de confirmar.",
    hedge_condition: "El restaurante pone condiciones (lista de espera, \u201csujeto a\u201d…).",
    hedge_negated_confirmation: "El restaurante dice que la reserva NO está confirmada o que no la apartó.",
    hedge_cancellation: "El correo habla de una cancelación.",
    unexplained_numbers: "El correo menciona números (personas u horas) que no pudimos comprobar contra tu solicitud.",
    html_only: "La respuesta llegó solo en formato HTML; no la tomamos como confirmación automática.",
    model_not_held: "La respuesta no dice que la mesa quedó apartada.",
    evidence_incomplete: "Al correo le faltan datos del proveedor para usarlo como comprobante.",
    classification_unavailable: "No pudimos leer la respuesta automáticamente.",
  };
  if (map[w]) return map[w];
  if (/^stated_\w+_unsupported$/.test(w)) return "Lo que entendimos del correo no coincide con lo que dice textualmente.";
  return null;
}
