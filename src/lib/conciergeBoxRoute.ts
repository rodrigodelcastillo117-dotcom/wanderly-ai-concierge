// Caja "CONCIERGE IATO" de Inicio: ¿lo escrito es una pregunta para Iato o un viaje nuevo por armar?
// Caso E2E 28-oct-2026 (hermano del dueño, celular): "¿qué clima hará en mi viaje a Madrid?" abría el
// planificador ("Tu viaje, como lo entendimos…") y preguntaba fechas de un viaje que ya existía.
// Regla: solo lo que CLARAMENTE pide armar un viaje va al planificador ("quiero ir a…", "arma un viaje a…",
// "Oaxaca 4 días en diciembre"); preguntas (¿…?, clima, restaurantes, qué hago…) y todo lo dudoso van al
// chat de Iato, que contesta y, si hace falta, también puede armar el viaje.

export type ConciergeBoxRoute = "chat" | "plan";

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();

// Verbos que piden ARMAR un viaje (imperativo, deseo o petición).
const BUILD = [
  /\b(arma|armame|armar|armes|armas|planea|planeame|planear|planees|planeas|organiza|organizame|organizar|disena|disename|crea|creame|cotiza|cotizame|cotizar)\b[^.?!]{0,40}\b(viaje|escapada|ruta|itinerario|vacaciones|luna de miel|road ?trip)\b/,
  /\b(quiero|quisiera|queremos|me gustaria|nos gustaria|pienso|pensamos|planeo|planeamos|vamos a)\s+(ir|viajar|volar|conocer|visitar|irme|irnos|escaparme|escaparnos)\b/,
  /\b(quiero|quisiera|queremos|busco|buscamos|necesito)\s+(un|una)\s+(viaje|escapada|ruta|road ?trip|luna de miel|vacaciones)\b/,
  /^(viaje|escapada|ruta|road ?trip|luna de miel|vacaciones)\s+(a|de|por|en)\b/,
  /\b(llevame|llevanos)\s+a\b/,
];

// Temas que son preguntas sobre un viaje (aunque no lleven signos): van a Iato.
const ASK = /\b(clima|tiempo hara|temperatura|llueve|lluvia|restaurante|restaurantes|comer|cenar|desayunar|que hago|que hacer|que ver|que visitar|recomiendas|recomiendame|recomendacion|como llego|como llegar|cuanto cuesta|cuanto sale|horario|abre|cierra|vuelo|maleta|equipaje|visa|pasaporte|moneda|propina|seguro|enchufe|vacuna)\b/;

// Duración o fechas explícitas junto a un destino ("Oaxaca 4 días", "Roma del 3 al 9 de mayo").
const DURATION = /\b\d{1,2}\s*(dias|noches|semanas?)\b|\b(fin de semana|puente)\b|\bdel \d{1,2} al \d{1,2}\b/;

/** ¿La frase de la caja de Inicio va al chat de Iato o al planificador? */
export function routeConciergeBox(text: string): ConciergeBoxRoute {
  const t = norm(text);
  if (!t) return "chat";
  const question = /[¿?]/.test(text) || /^(que|como|cuando|donde|cual|cuales|cuanto|cuanta|cuantos|cuantas|quien|por que|hay|me recomiendas|recomiendame|puedes|podrias|sabes|tengo|necesito saber)\b/.test(t);
  const build = BUILD.some((re) => re.test(t));
  // "¿Me armas un viaje a Roma?" sí es armar un viaje; "¿qué clima hará en mi viaje a Madrid?" no.
  if (build && !ASK.test(t)) return "plan";
  if (question || ASK.test(t)) return "chat";
  // Sin verbo ni pregunta: solo "destino + duración/fechas" se toma como viaje nuevo.
  if (DURATION.test(t) && !/\bmi viaje\b/.test(t)) return "plan";
  return "chat";
}

/** Ruta a la que lleva la caja de Inicio (el chat recibe el mensaje para enviarlo solo). */
export function conciergeBoxHref(text: string): string {
  const q = text.trim().slice(0, 1000);
  return routeConciergeBox(q) === "plan"
    ? `/dashboard/planear?q=${encodeURIComponent(q)}`
    : `/dashboard/concierge?enviar=${encodeURIComponent(q)}`;
}
