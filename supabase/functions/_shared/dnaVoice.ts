// Voz del Travel DNA: IATOS le habla a la persona de TÚ, cálido y en español de México.
//
// evolucionar-dna antes escribía "Declaró 'equilibrado' pero sus viajes…" (tercera persona, como
// un reporte sobre alguien). El prompt ya pide segunda persona y marca el resultado con
// voz = "segunda_persona"; esto convierte los textos ya guardados (sin esa marca) y sirve de red
// de seguridad si el modelo se equivoca. Lógica pura: la usan el frontend y la función.

export const DNA_VOICE = "segunda_persona";

/** ¿El texto habla de la persona en tercera persona? (marcas fuertes, no solo "su"). */
export function isThirdPerson(text: unknown): boolean {
  const s = String(text ?? "");
  return /(^|[^\p{L}])(el|la|este|esta) (usuari[oa]|viajer[oa]|client[ea])(?![\p{L}])/iu.test(s)
    || /^\s*(declar[óo]|dijo|indic[óo]|mencion[óo]|afirm[óo]|señal[óo]|expres[óo]|manifest[óo]|seleccion[óo]|eligi[óo]|marc[óo])(?![\p{L}])/iu.test(s)
    || /(^|[^\p{L}])(sus viajes|su presupuesto|su ritmo|su perfil|su estilo|sus destinos|su comportamiento|sus gustos|sus visitas|le gusta|le encanta|le interesa)(?![\p{L}])/iu.test(s);
}

/** Posición donde el sujeto implícito es la persona: inicio, tras coma o tras "que/y/pero/aunque…". */
const USER_SUBJECT = "(?<=(?:^\\s*|[,;:]\\s*|(?:^|[^\\p{L}])(?:tú|que|y|e|pero|aunque|también|tambien|no|siempre|casi siempre|realmente|normalmente|usualmente|ya|solo|sólo|más bien)\\s+))";

const SUBJECT_VERBS: ReadonlyArray<readonly [string, string]> = [
  ["prefiere", "prefieres"], ["viaja", "viajas"], ["busca", "buscas"], ["elige", "eliges"], ["visita", "visitas"],
  ["gasta", "gastas"], ["muestra", "muestras"], ["prioriza", "priorizas"], ["opta", "optas"], ["tiende", "tiendes"],
  ["disfruta", "disfrutas"], ["valora", "valoras"], ["invierte", "inviertes"], ["frecuenta", "frecuentas"],
  ["privilegia", "privilegias"], ["evita", "evitas"], ["combina", "combinas"], ["reserva", "reservas"], ["ha", "has"],
  ["suele", "sueles"], ["parece", "pareces"], ["necesita", "necesitas"], ["quiere", "quieres"], ["puede", "puedes"],
  ["se inclina", "te inclinas"], ["se mueve", "te mueves"], ["se hospeda", "te hospedas"], ["se aloja", "te alojas"],
  ["eligió", "elegiste"], ["visitó", "visitaste"], ["viajó", "viajaste"], ["gastó", "gastaste"], ["reservó", "reservaste"],
  ["prefirió", "preferiste"], ["buscó", "buscaste"], ["mostró", "mostraste"], ["optó", "optaste"], ["invirtió", "invertiste"],
];

// Orden importa: primero frases, luego verbos, al final posesivos.
const RULES: Array<[RegExp, string]> = [
  // Lo declarado en el onboarding
  [/^\s*(?:el|la) (?:usuari[oa]|viajer[oa]) declar[óo]\s+(?:que\s+)?/i, "En tu perfil dijiste que "],
  [/^\s*declar[óo]\s+(["'“«‘])/iu, "En tu perfil elegiste $1"],
  [/^\s*declar[óo] que\s+/i, "Dices que "],
  [/^\s*declar[óo]\s+/i, "En tu perfil elegiste "],
  [/^\s*(?:dijo|indic[óo]|mencion[óo]|afirm[óo]|señal[óo]|expres[óo]|manifest[óo]) que\s+/i, "Dices que "],
  [/^\s*(?:seleccion[óo]|eligi[óo]|marc[óo])\s+/i, "En tu perfil elegiste "],
  [/(^|[^\p{L}])(?:el|la|este|esta) (?:usuari[oa]|viajer[oa]|client[ea]) (?:declar[óo]|dijo|indic[óo]|mencion[óo])(?![\p{L}])/giu, "$1dijiste"],
  [/(^|[^\p{L}])(?:el|la|este|esta) (?:usuari[oa]|viajer[oa]|client[ea])(?![\p{L}])/giu, "$1tú"],
  [/(^|[^\p{L}])declar[óo](?![\p{L}])/giu, "$1dijiste"],
  [/(^|[^\p{L}])dijo(?![\p{L}])/giu, "$1dijiste"],
  [/(^|[^\p{L}])indic[óo](?![\p{L}])/giu, "$1indicaste"],
  [/(^|[^\p{L}])mencion[óo](?![\p{L}])/giu, "$1mencionaste"],
  // Pronombres
  [/(^|[^\p{L}])le (gusta|gustan|encanta|encantan|interesa|interesan|atrae|atraen|importa|importan)(?![\p{L}])/giu, "$1te $2"],
  // Verbos: solo cuando la persona es el sujeto ("que prefiere", "pero viaja", al inicio). "Tu
  // comportamiento muestra…" o "Mykonos puede…" no se tocan.
  ...SUBJECT_VERBS.map(([a, b]) => [new RegExp(`${USER_SUBJECT}${a}(?![\\p{L}])`, "giu"), b] as [RegExp, string]),
  // Posesivos (en estos textos "su/sus" es la persona)
  [/(^|[^\p{L}])sus(?![\p{L}])/giu, "$1tus"],
  [/(^|[^\p{L}])su(?![\p{L}])/giu, "$1tu"],
  [/(^|[^\p{L}])de (?:él|ella)(?![\p{L}])/giu, "$1tuyo"],
];

const capFirst = (s: string) => s.replace(/^(\s*["'“«‘]?)(\p{Ll})/u, (_m, p, c) => p + c.toUpperCase());

/** Convierte un texto en tercera persona a segunda ("Declaró…, pero sus viajes…" → "En tu perfil elegiste…, pero tus viajes…"). */
export function toSecondPerson(text: unknown): string {
  let s = String(text ?? "").trim();
  if (!s || !isThirdPerson(s)) return s;
  for (const [re, rep] of RULES) s = s.replace(re, rep);
  // "pero" sin coma antes de una oración contrastiva se lee mejor con coma.
  s = s.replace(/(\S)\s+pero\s+/g, (m, c) => (c === "," ? m : `${c}, pero `));
  return capFirst(s.replace(/\s{2,}/g, " "));
}

type DnaLike = { voz?: unknown; resumen?: unknown; divergencias_detectadas?: unknown; [k: string]: unknown };

/** DNA listo para mostrar: textos guardados antes de la voz en segunda persona se convierten. */
export function dnaForDisplay<T extends DnaLike | null | undefined>(dna: T): T {
  if (!dna || typeof dna !== "object") return dna;
  const legacy = dna.voz !== DNA_VOICE;
  const fix = (v: unknown) => (typeof v === "string" && (legacy || isThirdPerson(v)) ? toSecondPerson(v) : v);
  return {
    ...dna,
    resumen: fix(dna.resumen),
    divergencias_detectadas: Array.isArray(dna.divergencias_detectadas) ? dna.divergencias_detectadas.map(fix) : dna.divergencias_detectadas,
  } as T;
}

/** Red de seguridad al GUARDAR (evolucionar-dna): si el modelo escribió en tercera persona, se pasa a "tú". */
export function enforceSecondPerson<T extends DnaLike | null | undefined>(dna: T): T {
  if (!dna || typeof dna !== "object") return dna;
  const fix = (v: unknown) => (typeof v === "string" && isThirdPerson(v) ? toSecondPerson(v) : v);
  return {
    ...dna,
    resumen: fix(dna.resumen),
    divergencias_detectadas: Array.isArray(dna.divergencias_detectadas) ? dna.divergencias_detectadas.map(fix) : dna.divergencias_detectadas,
    voz: DNA_VOICE,
  } as T;
}
