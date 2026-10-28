// Pendientes del resumen "Tu viaje, como lo entendimos" que la IA manda como preguntas libres (tipo "otro").
// Caso E2E 28-oct-2026 (Valle de Bravo, "Viaje de 4 días a Valle de Bravo en coche desde CDMX"):
//  - "¿Cuántos viajeros son?" con opciones 1–4 / "Más de 4" no tenía dónde contestarse;
//  - "¿Cuántas noches?" mostraba solo "3 noches" aunque venían "4 noches" y "Otro número";
//  - "¿Regresas en coche?" se preguntaba aunque el texto ya decía "en coche";
//  - "el vuelo de regreso sale de Valle de Bravo" en un viaje en coche.
// Aquí se reconoce de qué trata cada pregunta, se contesta (viajeros, noches, cómo regresas) y se dan por
// contestadas las que el texto o el propio resumen ya responden. Nada se inventa: solo se usa lo que la
// persona escribió o eligió.
import {
  LEG_MODE_LABEL, resolveQuestion, setTripBasics, updateStop,
  type LegMode, type Question, type TripSpec,
} from "../../supabase/functions/_shared/tripSpec.ts";

export type AnswerKind = "viajeros" | "noches" | "regreso_modo" | "otro";

const norm = (s: string) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/** ¿De qué trata una pregunta "otro" de la IA? */
export function answerKindOf(q: Pick<Question, "tipo" | "pregunta" | "texto">): AnswerKind {
  if (q.tipo !== "otro") return "otro";
  const t = norm(`${q.pregunta} ${q.texto}`);
  if (/cuant[oa]s\s+(viajeros|personas|adultos|van|viajan)|personas\s+viajan|numero de (viajeros|personas)/.test(t)) return "viajeros";
  if (/cuantas\s+noches|noches\s+(te\s+)?(quedas|quedarias|pasaras)/.test(t)) return "noches";
  if (/regres/.test(t) && /(coche|auto|carro|vuelo|avion|tren|autobus|camion|medio|forma|como)/.test(t)) return "regreso_modo";
  return "otro";
}

/** Números de las opciones ("1", "4 noches") y la opción abierta ("Otro número", "Más de 4"), si viene. */
export function numericOptions(q: Pick<Question, "opciones">, fallback: number[] = []): { numbers: number[]; other: string | null } {
  const numbers: number[] = [];
  let other: string | null = null;
  for (const o of q.opciones ?? []) {
    const n = /^\s*(\d{1,3})\b(?!\s*(?:o|a)\s*m[aá]s)/i.exec(o);
    if (n && !/m[aá]s de/i.test(o)) numbers.push(Number(n[1]));
    else if (/otro|m[aá]s de|otra/i.test(o)) other = o;
  }
  return { numbers: numbers.length ? numbers : fallback, other: other ?? (numbers.length ? null : "Otro número") };
}

/** Modo que nombra una opción u oración ("Coche", "en auto", "Vuelo"…). null si no nombra uno. */
export function modeFromText(text: string): LegMode | null {
  const t = norm(text);
  if (/\b(coche|auto|carro|manejando|en mi (coche|auto|carro)|road ?trip)\b/.test(t)) return "coche";
  if (/\b(vuelo|avion|volando)\b/.test(t)) return "vuelo";
  if (/\btren\b/.test(t)) return "tren";
  if (/\bferry\b/.test(t)) return "ferry";
  return null;
}

/** Modo de transporte que el texto original dice para TODO el viaje ("… en coche desde CDMX"): uno solo. */
export function tripModeFromText(text: string): LegMode | null {
  const t = norm(text);
  const found = new Set<LegMode>();
  if (/\ben (coche|auto|carro)\b|\bmanejando\b|\ben mi (coche|auto|carro)\b|\broad ?trip\b/.test(t)) found.add("coche");
  if (/\ben (avion|vuelo)\b|\bvolando\b/.test(t)) found.add("vuelo");
  if (/\ben tren\b/.test(t)) found.add("tren");
  if (/\ben (autobus|camion)\b/.test(t)) found.add("por_definir");
  return found.size === 1 ? [...found][0] : null;
}

/** Cómo regresas: lo del resumen; si no se sabe, "por definir". */
export const returnModeOf = (spec: TripSpec): LegMode => spec.regreso?.modo ?? "por_definir";

/**
 * Renglón del regreso: "el vuelo de regreso sale de Madrid", "regresas en coche desde Valle de Bravo"…
 * (antes siempre decía "el vuelo de regreso", también en un viaje en coche).
 */
export function returnLegText(spec: TripSpec): string | null {
  if (!spec.paradas.length) return null;
  const from = [...spec.paradas].reverse().find((s) => s.rol === "estancia")?.ciudad ?? "—";
  switch (returnModeOf(spec)) {
    case "vuelo": return `el vuelo de regreso sale de ${from}`;
    case "coche": return `regresas en coche desde ${from}`;
    case "tren": return `el tren de regreso sale de ${from}`;
    case "ferry": return `el ferry de regreso sale de ${from}`;
    case "crucero": return `el crucero de regreso sale de ${from}`;
    default: return `regresas desde ${from} (cómo: por definir)`;
  }
}

/** Contesta una pregunta del resumen con lo que eligió la persona. */
export function answerQuestion(spec: TripSpec, qid: string, answer: string | number | LegMode): TripSpec {
  const q = spec.preguntas.find((x) => x.id === qid);
  if (!q) return spec;
  const kind = answerKindOf(q);
  if (kind === "viajeros") {
    const n = Math.round(Number(answer));
    if (!(n >= 1 && n <= 20)) return spec;
    return resolveQuestion(setTripBasics(spec, { viajeros: n }), qid, "preferencia");
  }
  if (kind === "noches") {
    const n = Math.round(Number(answer));
    if (!(n >= 1 && n <= 60)) return spec;
    const stays = spec.paradas.filter((s) => s.rol === "estancia");
    const target = (q.parada && spec.paradas.find((s) => s.id === q.parada)) || (stays.length === 1 ? stays[0] : null);
    const next = target ? updateStop(spec, target.id, { noches: n }) : { ...spec, noches_total: n };
    return resolveQuestion(next, qid, "preferencia");
  }
  if (kind === "regreso_modo") {
    const mode: LegMode = (Object.keys(LEG_MODE_LABEL) as LegMode[]).includes(answer as LegMode) ? (answer as LegMode) : modeFromText(String(answer)) ?? "por_definir";
    return resolveQuestion({ ...spec, regreso: { ...spec.regreso, modo: mode } }, qid, "regreso");
  }
  // Pregunta libre: la respuesta va a las notas del viaje (se toma en cuenta al armarlo).
  const text = String(answer).trim();
  const pref = text ? `${q.pregunta.replace(/\s+/g, " ").trim()} ${text}`.slice(0, 120) : null;
  const preferencias = pref && !spec.preferencias.includes(pref) ? [...spec.preferencias, pref] : spec.preferencias;
  return resolveQuestion({ ...spec, preferencias }, qid, "preferencia");
}

/** Cambiar "cómo regresas" desde el resumen también contesta la pregunta de la IA sobre el regreso. */
export function setReturnMode(spec: TripSpec, mode: LegMode): TripSpec {
  let next: TripSpec = { ...spec, regreso: { ...spec.regreso, modo: mode } };
  for (const q of next.preguntas) if (!q.resuelta && answerKindOf(q) === "regreso_modo") next = resolveQuestion(next, q.id, "regreso");
  return next;
}

/**
 * Da por contestadas las preguntas que ya responde el resumen o el texto: viajeros puestos, noches de la
 * parada puestas, y "¿regresas en coche?" cuando el texto dice "en coche" (y el regreso sin definir queda en coche).
 * Devuelve el MISMO objeto si no cambia nada.
 */
export function autoResolveQuestions(spec: TripSpec): TripSpec {
  let next = spec;
  const textMode = tripModeFromText(spec.consulta_original ?? "");
  // "… en coche desde CDMX": el regreso sin definir queda en coche (se ve y se cambia en el resumen).
  if (textMode && textMode !== "por_definir" && spec.paradas.length && next.regreso.modo === "por_definir") {
    next = { ...next, regreso: { ...next.regreso, modo: textMode } };
  }
  for (const q of spec.preguntas) {
    if (q.resuelta) continue;
    const kind = answerKindOf(q);
    if (kind === "viajeros" && next.viajeros) next = resolveQuestion(next, q.id, "preferencia");
    if (kind === "noches") {
      const stop = q.parada ? next.paradas.find((s) => s.id === q.parada) : null;
      if (stop?.noches) next = resolveQuestion(next, q.id, "preferencia");
    }
    if (kind === "regreso_modo" && textMode && textMode !== "por_definir" && (next.regreso.modo === "por_definir" || next.regreso.modo === textMode)) {
      next = resolveQuestion({ ...next, regreso: { ...next.regreso, modo: textMode } }, q.id, "regreso");
    }
  }
  return next;
}
