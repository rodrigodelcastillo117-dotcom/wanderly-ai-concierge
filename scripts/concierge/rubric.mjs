// Rúbrica de calidad de Iato (Concierge 2.0). JavaScript plano para que la usen igual la evaluación local
// con modelo simulado (src/test/concierge2Evals.test.ts) y la evaluación en vivo después del despliegue
// (scripts/concierge/eval_live.mjs). Determinista: no usa otro modelo como juez.
//
// "Asombroso" = como un concierge humano experto: específico (nombres, horas, precios con fuente),
// corto, proactivo, con 1–3 acciones confirmables y honesto (nunca "reservé", datos sin fuente marcados).

const GENERIC = /\b(con gusto te ayudo|claro que s[ií],? (te|puedo)|hay muchas opciones|depende de (tus|lo que)|no dudes en|estoy aqu[ií] para ayudarte|¿en qu[eé] (m[aá]s )?te puedo ayudar|¿algo m[aá]s\?)/i;
const FAKE_BOOKING = /(\breservé(?![a-záéíóúñ])|\bhice (la|tu) reserva|\bqued[oó] reservad[ao]\b|\breserva(ci[oó]n)? confirmada\b|\btu mesa (est[aá]|qued[oó]) (confirmada|lista|reservada)\b)/i;
const UNVERIFIED_LABEL = /sin verificar|informaci[oó]n general/i;

/** Señales de especificidad: horas, montos, códigos de vuelo, nombres propios del contexto. */
export function specificity(text, mustMention = []) {
  const t = String(text ?? "");
  const hits = [];
  if (/\b\d{1,2}:\d{2}\b/.test(t)) hits.push("hora");
  if (/(\$|USD|MXN|EUR|€)\s?\d|\d[\d,.]*\s?(USD|MXN|EUR)\b/.test(t)) hits.push("precio");
  if (/\b([A-Z]{2}|[A-Z]\d|\d[A-Z])\s?\d{2,4}\b/.test(t)) hits.push("vuelo");
  const missing = mustMention.filter((m) => !t.toLowerCase().includes(String(m).toLowerCase()));
  return { hits, missing };
}

/**
 * Califica una respuesta (texto + cards + acciones) para un escenario. Devuelve {pass, fails[]}.
 * expect: {
 *   mustMention: string[]   — nombres/datos del viaje o de las herramientas que deben aparecer
 *   minActions, maxActions   — acciones confirmables (default 1..3)
 *   actionTypes: string[]    — al menos una de estas acciones
 *   maxLines                 — tope de líneas (default 6; exigente 12)
 *   requireUnverifiedLabel   — debe marcar "sin verificar"
 *   minOptions               — opciones distintas (cards de recomendación) mínimas
 *   forbid: RegExp[]         — frases que no pueden aparecer
 * }
 */
export function gradeReply(reply, expect = {}) {
  const fails = [];
  const text = String(reply?.text ?? "");
  const cards = Array.isArray(reply?.cards) ? reply.cards : [];
  const actions = Array.isArray(reply?.actions) ? reply.actions : [];
  const lines = text.split(/\n+/).filter((l) => l.trim()).length;

  if (!text.trim()) fails.push("sin_texto");
  if (GENERIC.test(text)) fails.push("frase_generica");
  if (FAKE_BOOKING.test(text) && !/a[uú]n no est[aá] reservad/i.test(text)) fails.push("reserva_falsa");
  const maxLines = expect.maxLines ?? 6;
  if (lines > maxLines) fails.push(`demasiado_largo:${lines}>${maxLines}`);
  const { missing } = specificity(text + " " + cards.map((c) => `${c.title ?? ""} ${c.subtitle ?? ""}`).join(" "), expect.mustMention ?? []);
  if (missing.length) fails.push(`no_menciona:${missing.join("|")}`);
  const minA = expect.minActions ?? 1;
  const maxA = expect.maxActions ?? 3;
  if (actions.length < minA) fails.push(`pocas_acciones:${actions.length}<${minA}`);
  if (actions.length > maxA) fails.push(`demasiadas_acciones:${actions.length}>${maxA}`);
  if (expect.actionTypes?.length && !actions.some((a) => expect.actionTypes.includes(a.type))) fails.push(`falta_accion:${expect.actionTypes.join("|")}`);
  if (expect.requireUnverifiedLabel && !UNVERIFIED_LABEL.test(text)) fails.push("dato_sin_etiqueta");
  if (expect.minOptions) {
    const opts = cards.filter((c) => ["flight", "hotel", "restaurant", "attraction", "place"].includes(c.type)).length;
    if (opts < expect.minOptions) fails.push(`pocas_opciones:${opts}<${expect.minOptions}`);
  }
  for (const re of expect.forbid ?? []) if (re.test(text)) fails.push(`prohibido:${re}`);
  return { pass: fails.length === 0, fails };
}

/**
 * Modo exigente debe ser MATERIALMENTE mejor que el normal en el mismo escenario: más opciones,
 * ranking con contras ("la mejor / la alternativa / el plan B"), fuentes y acciones.
 */
export function compareExigente(normal, exigente) {
  const fails = [];
  const optCount = (r) => (r?.cards ?? []).filter((c) => ["flight", "hotel", "restaurant", "attraction", "place"].includes(c.type)).length;
  const t = String(exigente?.text ?? "");
  if (optCount(exigente) < Math.max(3, optCount(normal) + 1)) fails.push(`opciones:${optCount(exigente)} vs ${optCount(normal)}`);
  if (!/la mejor/i.test(t) || !/alternativa/i.test(t) || !/plan b/i.test(t)) fails.push("sin_ranking_a_b_c");
  if (!/\b(pero|contra|a cambio|desventaja|aunque)\b/i.test(t)) fails.push("sin_contras");
  if (!/\b(seg[uú]n|fuente|google|tripadvisor|members only|consultado)\b/i.test(t)) fails.push("sin_fuentes");
  if (!/\bdespu[eé]s\b|\bluego\b|\bsiguiente\b/i.test(t)) fails.push("sin_anticipacion");
  if ((exigente?.actions ?? []).length < 2) fails.push("menos_de_2_acciones");
  return { pass: fails.length === 0, fails };
}
