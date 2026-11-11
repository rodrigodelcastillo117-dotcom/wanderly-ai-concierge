// Frases que NO son lugares: cuándo («este viernes 13», «de último momento», «regreso el domingo 15») y cómo
// («algo bonito sin gastar tanto», «me voy»). Recorrido 11-nov-2026 (viaje de último momento a Oaxaca): la app
// preguntaba «¿Qué ciudad es voy?», «¿… último momento: este viernes?» y «¿… regreso el domingo 15 Algo bonito
// sin gastar tanto?» (6 pendientes). Lo usan el lector local del cliente (multiCityText.stripNonPlaces) y el
// servidor (tripSpec: menciones de la IA y del cliente). Sin Deno: se prueba con Vitest.

const WEEKDAY = "(?:lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)";
const MONTH = "(?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)";

/** Partes de la frase que dicen CUÁNDO o CÓMO, nunca DÓNDE. Se sustituyen por un separador. */
export const TIMING_AND_VIBE: RegExp[] = [
  // «de último momento», «último minuto», «a última hora»
  /(?<![a-záéíóúñ])(?:(?:de|a|en)\s+)?[uú]ltim[oa]\s+(?:momento|minuto|hora)(?![a-záéíóúñ])/gi,
  /(?<![a-záéíóúñ])(?:lo\s+antes\s+posible|cuanto\s+antes|lo\s+m[aá]s\s+pronto\s+posible|ya\s+mismo|de\s+inmediato)(?![a-záéíóúñ])/gi,
  // «este viernes 13», «el próximo sábado», «regreso el domingo 15» (no «Santo Domingo»)
  new RegExp(`(?<![a-záéíóúñ])(?:(?:regres[oa]|regresamos|regresando|vuelvo|volvemos|volviendo|salgo|salimos|saliendo|llego|llegamos)\\s+)?(?:(?:este|esta|el|la|los|pr[oó]ximo|siguiente|de\\s+este)\\s+)*(?<!santo\\s)(?<!santo\\s(?:el|este)\\s)${WEEKDAY}(?:\\s+\\d{1,2})?(?:\\s+de\\s+${MONTH})?(?![a-záéíóúñ])`, "gi"),
  /(?<![a-záéíóúñ])(?:(?:este|esta)\s+)?(?:hoy|ma[nñ]ana|pasado\s+ma[nñ]ana|esta\s+semana|la\s+(?:pr[oó]xima|siguiente)\s+semana|este\s+fin(?:de)?(?:\s+de\s+semana)?|este\s+finde|el\s+finde)(?![a-záéíóúñ])/gi,
  // «regreso el 15», «regresamos el 20 de noviembre»
  new RegExp(`(?<![a-záéíóúñ])(?:regres[oa]|regresamos|regresando|vuelvo|volvemos|volviendo)(?:\\s+(?:el|la|los))?(?:\\s+\\d{1,2}(?:\\s+de\\s+${MONTH})?)?(?=\\s*(?:[,;.\\n]|$))`, "gi"),
  // «a finales de junio», «principios de mayo», «mediados de año» (el mes se lee aparte)
  /(?<![a-záéíóúñ])(?:(?:a|para|en|hacia)\s+)?(?:finales|principios|mediados|inicios)\s+de(?![a-záéíóúñ])/gi,
  /(?<![a-záéíóúñ])(?:temprano|en\s+la\s+(?:ma[nñ]ana|tarde|noche)|por\s+la\s+(?:ma[nñ]ana|tarde|noche))(?![a-záéíóúñ])/gi,
  // «este puente», «fin de semana largo»
  /(?<![a-záéíóúñ])(?:(?:este|el|un|para\s+el|en\s+el)\s+)?puente(?:\s+largo)?(?![a-záéíóúñ])/gi,
  /(?<![a-záéíóúñ])(?:un\s+|este\s+|el\s+)?fin\s+de\s+semana(?:\s+largo)?(?![a-záéíóúñ])/gi,
  // «lo más barato posible», «lo mejor posible»
  /(?<![a-záéíóúñ])lo\s+(?:m[aá]s\s+)?[a-záéíóúñ]+\s+posible(?![a-záéíóúñ])/gi,
  // Lo que quiere vivir, no dónde: «para ver los cerezos», «ver la aurora boreal» (el lugar que sigue con «en» se queda)
  /(?<![a-záéíóúñ])(?:para\s+)?ver\s+(?:el|la|los|las)\s+[a-záéíóúñ]+(?:\s+(?!en\b|de\b)[a-záéíóúñ]+)?(?![a-záéíóúñ])/gi,
  /(?<![a-záéíóúñ])(?:me|nos|le|les)\s+(?:encanta|encantan|gusta|gustan|fascina|fascinan|interesa|interesan)\s+[^,;.\n]*/gi,
  /(?<![a-záéíóúñ])(?:es\s+)?(?:(?:mi|nuestra|la)\s+)?primera\s+vez(?![a-záéíóúñ])/gi,
  // «a las 10:30», «7:15 pm»
  /(?<![a-záéíóúñ\d])(?:a\s+las?\s+)?\d{1,2}:\d{2}(?:\s*(?:am|pm|hrs?|h))?(?![a-záéíóúñ\d])/gi,
  // «algo cerca de CDMX», «un lugar cerca de Monterrey»: la ciudad es referencia, no parada (se resuelve con la IA).
  /(?<![a-záéíóúñ])(?:algo|un\s+lugar|alg[uú]n\s+lugar|un\s+sitio|un\s+destino|un\s+pueblo|una\s+playa|playas?)\s+(?:cerca|cerquita|no\s+lejos)\s+de\s+[^,;.\n]+/gi,
  // Barrido de frases 11-nov-2026: quién y cómo, no dónde.
  /(?<![a-záéíóúñ])(?:ellos|ellas|el|ella)?\s*(?:caminan?|caminamos|camina)\s+(?:poco|muy\s+poco|despacio|con\s+bast[oó]n)(?![a-záéíóúñ])/gi,
  /(?<![a-záéíóúñ])(?:frente\s+(?:al\s+mar|a\s+la\s+playa)|con\s+vista\s+al\s+mar|vista\s+al\s+mar|pie\s+de\s+playa)(?![a-záéíóúñ])/gi,
  /(?<![a-záéíóúñ])(?:sol\s+y\s+playa|playa\s+y\s+sol|fiesta|antros?|vida\s+nocturna|ruta\s+del\s+vino|ruta\s+de\s+(?:los\s+)?vinos|enoturismo|safari|pueblos?\s+m[aá]gicos?)(?![a-záéíóúñ])/gi,
  // «playa» suelta (no «Playa del Carmen»): el gusto, no un lugar.
  /(?<![a-záéíóúñ])(?:la\s+)?playas?(?=\s*(?:[,;.\n]|$)|\s+(?:y|en|este|esta|para|con)\b)/gi,
  /(?<![a-záéíóúñ])(?:para\s+)?ver\s+(?:las?\s+|los?\s+)?(?:ballenas|tortugas|delfines|luci[eé]rnagas|auroras?(?:\s+boreales?)?|cerezos|mariposas(?:\s+monarcas?)?|monarcas|atardeceres|estrellas|volcanes|flamencos)(?![a-záéíóúñ])/gi,
  // «en tren» NO se quita: es cómo se llega (el planeador lo usa para el tramo; pruebas N-08/N-09).
  /(?<![a-záéíóúñ])en\s+(?:camper|campervan|motorhome|autocaravana|moto|bici|bicicleta)(?![a-záéíóúñ])/gi,
  /(?<![a-záéíóúñ])(?:graduaci[oó]n|boda|despedida(?:\s+de\s+solter[oa]s?)?|reuni[oó]n\s+familiar)(?![a-záéíóúñ])/gi,
  // Reparto entre ciudades: «3 noches en cada una», «2 días por ciudad» (recorrido Roma y Florencia, 11-nov-2026)
  /(?<![a-záéíóúñ])(?:(?:en|por|para)\s+)?cada\s+(?:una|uno|ciudad|lugar|destino|parada|sitio)(?![a-záéíóúñ])/gi,
  /(?<![a-záéíóúñ])(?:por|en)\s+(?:ciudad|destino|parada)(?![a-záéíóúñ])/gi,
  // Gusto y presupuesto: «algo bonito», «sin gastar tanto», «barato»
  /(?<![a-záéíóúñ])(?:algo\s+)?(?:bonit[oa]|tranquil[oa]|rom[aá]ntic[oa]|especial|diferente|relajad[oa]|divertid[oa]|barat[oa]|econ[oó]mic[oa]|sencill[oa])(?![a-záéíóúñ])/gi,
  /(?<![a-záéíóúñ])(?:sin\s+gastar(?:\s+(?:tanto|mucho|demasiado|de\s+m[aá]s))?|gastando\s+poco|con\s+poco\s+(?:dinero|presupuesto)|bajo\s+presupuesto|presupuesto\s+(?:bajo|ajustado|limitado))(?![a-záéíóúñ])/gi,
];

/** Quita de la frase lo que dice cuándo o cómo, dejando un separador. */
export function stripTimingAndVibe(text: string): string {
  return TIMING_AND_VIBE.reduce((t, re) => t.replace(re, " , "), String(text ?? ""));
}

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const FILLER = new Set(("a al en de del por y e o la el los las lo desde hasta hacia para con sin mi mis tu un una nos me te se " +
  "voy vamos vas va iremos ire irme irnos viaje viajar viajo viajamos quiero queremos quisiera este esta estos estas " +
  "pareja novia novio esposa esposo familia amigos tanto mucho poco algo muy mas que fin semana finde " +
  "salgo salimos salida regreso regresamos vuelta cada volver regresar necesito necesitamos escapar escaparme escaparnos " +
  "llevame llevanos lleva llevar llevarlos llevarlas viajo largo primera vez posible cruzar recorrer ellos ellas").split(/\s+/));

/** ¿El texto completo dice solo cuándo/cómo (nada que pueda ser un lugar)? «voy», «este viernes 13 de noviembre». */
export function isNotPlace(text: string): boolean {
  const t = String(text ?? "").trim();
  if (!t) return false;
  // «algo de playa» puede ser el destino que falta decidir: no se calla, se pregunta (viajeComplejo, texto ambiguo).
  if (/\bplayas?\b/.test(norm(t))) return false;
  const rest = norm(stripTimingAndVibe(t))
    .replace(new RegExp(norm(`\\b${MONTH}\\b`), "g"), " ")
    .replace(/[\d:.,;!?¡¿"'()\-–]+/g, " ")
    .split(/\s+/)
    .filter((w) => w && !FILLER.has(w));
  return rest.length === 0;
}

/**
 * ¿«San Pedro» es la ZONA del hotel en la frase («hotel en San Pedro», «hospedaje cerca de Polanco»)? Entonces es una
 * preferencia de hospedaje, no una parada (recorrido viaje de trabajo a Monterrey, 11-nov-2026: «Mencionaste
 * «San Pedro»: ¿dónde va en tu viaje?»). También si la IA la escribe completa («San Pedro Garza García»).
 */
export function isLodgingArea(text: string, consulta: string): boolean {
  const t = norm(String(text ?? "")).replace(/[^a-z0-9 ]+/g, " ").replace(/^(?:(?:en|el|la|los|las|de|del)\s+)+/, "").replace(/\s+/g, " ").trim();
  if (!t) return false;
  const c = norm(String(consulta ?? ""));
  const re = /\b(?:hotel(?:es)?|hospedaje|alojamiento|hostal(?:es)?|airbnb|cuartos?|habitacion(?:es)?|quedarme|quedarnos|dormir)\s+(?:en|por|cerca\s+de|junto\s+a|en\s+la\s+zona\s+de|por\s+la\s+zona\s+de|en\s+la\s+colonia)\s+(?:(?:la|el|los|las)\s+)?([^,;.\n]+)/g;
  for (const m of c.matchAll(re)) {
    const area = m[1].replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
    if (!area) continue;
    // «San Pedro» ⊂ «San Pedro Garza García» (o al revés), palabra por palabra desde el inicio.
    if (t === area || t.startsWith(`${area} `) || area.startsWith(`${t} `)) return true;
  }
  return false;
}
