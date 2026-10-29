// Incidentes: severidad DETERMINISTA y guía inmediata honesta. Puro (sin Deno), probado con Vitest.
//
// incidentSeverityFor(categoria, contexto): reglas fijas, explicables (devuelve los motivos). Nada de IA.
// incidentGuide(categoria, …): lo que la persona puede hacer AHORA MISMO, lo que hará el equipo (sin
// prometer lo que no depende de nosotros) y el siguiente paso con su hora.
import {
  categoryLabel, type ComplaintSubtype, type Expectation, type IncidentCategory, type IncidentSeverity, localClock, localHour, type Sentiment,
  severityRank, severityUp,
} from "./incident-labels.ts";
import { normalizeText } from "./incident-detect.ts";

export type SeverityContext = {
  /** Lo que escribió la persona (o la descripción del monitor). */
  texto?: string | null;
  /** Hora local del viajero (0–23). Si no se da, se calcula con zonaHoraria. */
  horaLocal?: number | null;
  zonaHoraria?: string | null;
  /** Horas que faltan para su vuelo (documentos, reservas). */
  horasParaVuelo?: number | null;
  /** Viaja con menores, personas mayores o con discapacidad. */
  vulnerable?: boolean | null;
  sentimiento?: Sentiment | null;
  quejaSubtipo?: ComplaintSubtype | null;
  expectativa?: Expectation | null;
  /** Minutos de retraso (monitor de vuelos). */
  retrasoMin?: number | null;
  /** Se reabrió porque el usuario dijo que no quedó resuelto. */
  reabierto?: boolean | null;
  now?: Date;
};

const BASE: Record<IncidentCategory, IncidentSeverity> = {
  salud: "critica", seguridad: "critica",
  robo: "alta", documentos: "alta", vuelo_cancelado: "alta", conexion_perdida: "alta", overbooking: "alta", traslado_no_llego: "alta",
  hotel_problema: "media", equipaje: "media", reserva_problema: "media", cobro_reembolso: "media", vuelo_retrasado: "media",
  queja: "media", otro: "media",
};

const LIFE_THREAT = /(inconscien|no respira|sangr(a|ando) mucho|mucha sangre|infarto|convuls|ambulancia|secuestr|arma|pistola|cuchillo|agred|violac|amenaza de muerte|unconscious|not breathing|bleeding a lot|heart attack|seizure|\bgun\b|knife|assault|kidnap|me golpearon|golpearon|beaten|stroke|derrame|no puede respirar|can'?t breathe|anafila|overdose|sobredosis|suicid)/;
const VIOLENT = /(asalt|arma|pistola|cuchillo|golpe|mugged|gun\b|knife|a mano armada|armed|violen)/;
const NO_BED = /(no tengo donde dormir|no tenemos donde dormir|sin habitacion|no tienen (mi|nuestra) reserv|no hay habitacion|overbook|sobrevend|no record|no room|nowhere to sleep|me (sacaron|corrieron)|en la calle)/;
const STRANDED = /(varad|stranded|stuck|toda la noche|all night|sin hotel|no hay mas vuelos|no more flights|ultimo vuelo|last flight)/;
const CRITICAL_ITEMS = /(medicin|medicament|insulina|medication|bebe|baby|silla de ruedas|wheelchair|oxigeno|oxygen|epipen)/;
const NOW_WORDS = /(hoy|llegue|llegamos|estoy en el|estamos en el|ahorita|ahora mismo|ya estoy (aqui|aca|en)|estoy en la (puerta|entrada|recepcion)|en este momento|today|right now|i'?m here|we'?re here|tonight|esta noche|en una hora|in an hour)/;
const LEGAL = /(profeco|abogado|demanda|denunciar|redes sociales|tiktok|twitter|lawyer|\bsue\b|chargeback|contracargo|condusef|medios)/;
const VULNERABLE_WORDS = /(mi hij[oa]|mis hij[oa]s|ninos|nina|nino|bebe|embarazad|mi mama|mi papa|abuel|silla de ruedas|discapacidad|kids|children|my (son|daughter|baby|mom|dad)|pregnant|elderly|wheelchair|disabled)/;

/** Severidad por reglas: base de la categoría + modificadores explicables. */
export function incidentSeverityFor(categoria: IncidentCategory, ctx: SeverityContext = {}): { severidad: IncidentSeverity; motivos: string[] } {
  const t = normalizeText(ctx.texto ?? "");
  const motivos: string[] = [`base: ${categoryLabel(categoria)}`];
  let sev: IncidentSeverity = BASE[categoria] ?? "media";
  const hour = typeof ctx.horaLocal === "number" ? ctx.horaLocal : localHour(ctx.zonaHoraria ?? null, ctx.now ?? new Date());
  // De noche por la hora local o porque la persona lo dice ("ya es de noche", "de madrugada").
  const night = (hour !== null && (hour >= 22 || hour < 6)) || /(es de noche|ya es noche|de madrugada|at night|middle of the night|late at night)/.test(t);
  const raise = (to: IncidentSeverity, why: string) => {
    if (severityRank(to) > severityRank(sev)) { sev = to; motivos.push(why); }
  };

  if (LIFE_THREAT.test(t)) raise("critica", "riesgo para la persona");
  switch (categoria) {
    case "robo":
    case "documentos":
      if (VIOLENT.test(t)) raise("critica", "con violencia");
      if (categoria === "documentos" && typeof ctx.horasParaVuelo === "number" && ctx.horasParaVuelo <= 24) raise("critica", "vuela en menos de 24 h");
      break;
    case "vuelo_cancelado":
    case "conexion_perdida":
    case "overbooking":
    case "traslado_no_llego":
      if (night) raise("critica", "de noche (hora local)");
      if (STRANDED.test(t)) raise("critica", "varado");
      break;
    case "vuelo_retrasado":
      if ((ctx.retrasoMin ?? 0) >= 180 || /(\b[3-9]|\b1[0-9]) ?(horas|hrs|hours|h\b)/.test(t)) raise("alta", "retraso de 3 h o más");
      if (/(conexion|escala|connection|connecting|layover)/.test(t)) raise("alta", "pone en riesgo una conexión");
      break;
    case "hotel_problema":
      if (NO_BED.test(t)) raise(night ? "critica" : "alta", night ? "sin habitación y de noche" : "sin habitación");
      break;
    case "equipaje":
      if (CRITICAL_ITEMS.test(t)) raise("alta", "lleva medicinas o algo indispensable");
      break;
    case "reserva_problema":
      if (NOW_WORDS.test(t)) raise("alta", "es para hoy / ya está en el lugar");
      break;
    case "cobro_reembolso":
      if (ctx.expectativa === "informacion" && !/(doble|dos veces|twice|double|no reconoc|fraude|fraud)/.test(t)) {
        sev = "baja"; motivos.push("solo pide información");
      }
      break;
    case "queja":
      if (ctx.sentimiento === "muy_molesto") raise("alta", "persona muy molesta");
      if (ctx.quejaSubtipo === "cobro" || ctx.quejaSubtipo === "trato") raise("alta", `queja de ${ctx.quejaSubtipo}`);
      if (LEGAL.test(t)) raise("alta", "menciona Profeco, abogado o redes");
      if (CRITICAL_ITEMS.test(t)) raise("alta", "afecta medicinas, silla de ruedas o algo indispensable");
      break;
    case "otro":
      if (ctx.sentimiento === "angustiado") raise("alta", "persona angustiada");
      break;
  }
  if ((ctx.vulnerable || VULNERABLE_WORDS.test(t)) && ["vuelo_cancelado", "conexion_perdida", "overbooking", "traslado_no_llego", "hotel_problema", "robo", "documentos", "equipaje"].includes(categoria)) {
    const up = severityUp(sev);
    if (up !== sev) { sev = up; motivos.push("viaja con menores o personas vulnerables"); }
  }
  if (ctx.reabierto) {
    const up = severityUp(sev);
    if (up !== sev) { sev = up; motivos.push("reabierto: no quedó resuelto"); }
  }
  return { severidad: sev, motivos };
}

// ───────────────────────────── guía inmediata ─────────────────────────────

export const EMERGENCY_LINE = "Si hay peligro o es una emergencia médica, llama ya al número de emergencias del país: 911 en México, Estados Unidos y Canadá; 112 en la Unión Europea y en muchos otros países.";

const NOW: Record<IncidentCategory, string[]> = {
  vuelo_cancelado: [
    "Ve al mostrador de la aerolínea o abre su app ya: el cambio a otro vuelo se pide ahí y quien lo pide primero elige primero.",
    "Pide por escrito el motivo de la cancelación y tus opciones: otro vuelo, reembolso y, si te toca esperar, hotel y comidas.",
    "Guarda pases de abordar y los recibos de lo que gastes; sirven para reclamar después.",
  ],
  conexion_perdida: [
    "Ve directo al mostrador de transferencias o de la aerolínea del vuelo que perdiste: si es el mismo boleto, ellos te reubican.",
    "Pide por escrito el nuevo vuelo y, si te toca esperar horas o la noche, pregunta por hotel y comidas.",
    "Guarda tus pases de abordar y recibos.",
  ],
  overbooking: [
    "No aceptes el primer vale sin preguntar: pide por escrito el siguiente vuelo con lugar confirmado y qué compensación te ofrecen.",
    "Pide el motivo por escrito (sobreventa) y guarda tu pase de abordar.",
  ],
  vuelo_retrasado: [
    "Revisa en la app de la aerolínea la hora estimada y la puerta; pueden cambiar.",
    "Si el retraso pone en riesgo tu conexión, avísale al mostrador antes de abordar para que te protejan en otro vuelo.",
    "Guarda los recibos de comida si el retraso es largo.",
  ],
  traslado_no_llego: [
    "Revisa en tu confirmación el punto exacto de encuentro (terminal, puerta, letrero con tu nombre) y el teléfono del proveedor, y llámale.",
    "Quédate dentro de la terminal o en un lugar iluminado y concurrido.",
    "Si pasan más de 20 minutos o es de noche, toma un taxi de los módulos oficiales del aeropuerto, no uno que te ofrezcan en la salida, y guarda el recibo.",
  ],
  hotel_problema: [
    "Pide en recepción que te muestren por escrito qué tienen registrado y el nombre de quien te atiende.",
    "Ten a la mano tu confirmación (número y correo) y enséñala.",
    "Si no te dan habitación, pide que te reubiquen en un hotel equivalente cercano por cuenta de ellos y guarda todo por escrito.",
  ],
  equipaje: [
    "Antes de salir del área de equipaje, levanta el reporte en el mostrador de la aerolínea y pide el número de reporte.",
    "Toma fotos de la maleta dañada o de la etiqueta y del pase de abordar.",
    "Guarda los recibos de lo indispensable que compres mientras aparece.",
  ],
  documentos: [
    "Si te lo robaron, levanta la denuncia en la policía local y pide copia: la embajada o el consulado te la pedirán.",
    "Contacta al consulado de tu país más cercano para un documento de emergencia; lleva una identificación o una copia si la tienes.",
    "Si vuelas pronto, avísale a la aerolínea de inmediato.",
  ],
  robo: [
    "Ponte a salvo primero; no persigas a nadie.",
    "Bloquea ya tus tarjetas desde la app del banco y cambia las contraseñas si te quitaron el celular.",
    "Levanta la denuncia en la policía local y pide copia: la necesitarás para el seguro y para reponer documentos.",
  ],
  salud: [
    "Si es grave, llama ya al número de emergencias del país o pide a alguien del hotel que lo haga.",
    "Si no es grave, busca la clínica u hospital más cercano; ten a la mano tu póliza de seguro de viaje si tienes.",
    "Lleva tus medicinas y una identificación.",
  ],
  seguridad: [
    "Ponte a salvo: entra a un lugar concurrido y cerrado (hotel, tienda, estación de policía).",
    "Sigue las indicaciones de las autoridades locales.",
    "Avisa a alguien de confianza dónde estás.",
  ],
  reserva_problema: [
    "Enséñale al lugar tu confirmación (número, correo o captura) y pide el nombre de quien te atiende.",
    "Si no la encuentran, pide que busquen con tu nombre, correo y fecha, y que te digan qué opción tienen ahora.",
  ],
  cobro_reembolso: [
    "Toma captura del cargo (monto, fecha y comercio) en la app de tu banco.",
    "Si no reconoces el cargo, repórtalo ya en tu banco.",
  ],
  queja: [
    "Gracias por decírnoslo; lo que escribiste lo lee completo una persona del equipo IATOS.",
    "Si tienes capturas, recibos o nombres, agrégalos a tu caso: ayudan a resolverlo más rápido.",
  ],
  otro: [
    "Cuéntanos con el mayor detalle posible qué pasó, dónde estás y qué necesitas.",
  ],
};

const TEAM: Record<IncidentCategory, string> = {
  vuelo_cancelado: "El equipo IATOS busca contigo otros vuelos y te dice exactamente qué pedirle a la aerolínea. Si el boleto no se compró con IATOS, el cambio lo hace la aerolínea; nosotros te ayudamos a pedirlo y a reclamar.",
  conexion_perdida: "El equipo IATOS revisa contigo las opciones de vuelo y qué pedir en el mostrador. El cambio lo hace la aerolínea; te ayudamos a pedirlo bien.",
  overbooking: "El equipo IATOS te ayuda a revisar las opciones y la compensación que te corresponde según la aerolínea y el país.",
  vuelo_retrasado: "El equipo IATOS vigila tu vuelo y, si se complica tu conexión, te ayuda con alternativas.",
  traslado_no_llego: "El equipo IATOS contacta al proveedor del traslado y, si no responde, te dice la opción más segura para llegar.",
  hotel_problema: "El equipo IATOS contacta al hotel por escrito para aclararlo y, si hace falta, te ayuda a encontrar otra opción.",
  equipaje: "El equipo IATOS te ayuda a darle seguimiento al reporte con la aerolínea.",
  documentos: "El equipo IATOS te dice a qué consulado acudir y qué llevar, y te ayuda con tus vuelos si hace falta. El documento lo emite el consulado, no IATOS.",
  robo: "El equipo IATOS te acompaña con los siguientes pasos (denuncia, tarjetas, documentos y seguro).",
  salud: "El equipo IATOS te ayuda a ubicar atención médica y con tu viaje. No somos servicio médico: en una emergencia, llama al número de emergencias.",
  seguridad: "El equipo IATOS revisa la situación donde estás y te ayuda a moverte a un lugar seguro y con tu viaje. En peligro inmediato, llama al número de emergencias.",
  reserva_problema: "El equipo IATOS contacta al lugar por escrito para encontrar la reserva o una alternativa. Si la reserva no se hizo con IATOS, la confirma el lugar; nosotros te ayudamos a aclararlo.",
  cobro_reembolso: "El equipo IATOS revisa el cobro. Si lo hizo IATOS, lo corregimos; si fue otro comercio, te ayudamos a pedir la aclaración y el reembolso.",
  queja: "Una persona del equipo IATOS lee tu queja completa y te responde. Te diremos qué podemos hacer y qué no.",
  otro: "Una persona del equipo IATOS revisa tu caso y te responde.",
};

const QUEJA_TEAM: Partial<Record<Expectation, string>> = {
  reembolso: "Si el cargo lo hizo IATOS, revisamos el reembolso; si fue otro comercio, te ayudamos a pedirlo.",
  disculpa: "Te debemos una respuesta clara de qué pasó.",
  cambio: "Vemos contigo el cambio que necesitas.",
  informacion: "Te explicamos qué pasó con los datos que tengamos.",
  compensacion: "Revisamos si aplica alguna compensación y te lo decimos sin rodeos.",
};

export type IncidentGuide = {
  categoria: IncidentCategory;
  /** Lo que puede hacer AHORA MISMO (2–4 pasos). */
  ahora: string[];
  /** Línea de emergencia (solo cuando aplica). */
  emergencia: string | null;
  /** Lo que hará el equipo, sin prometer lo que no depende de IATOS. */
  equipo: string;
};

export function incidentGuide(categoria: IncidentCategory, opts: { expectativa?: Expectation | null; severidad?: IncidentSeverity | null } = {}): IncidentGuide {
  const urgent = categoria === "salud" || categoria === "seguridad" || categoria === "robo" || opts.severidad === "critica";
  let equipo = TEAM[categoria] ?? TEAM.otro;
  if (categoria === "queja" && opts.expectativa && QUEJA_TEAM[opts.expectativa]) equipo += " " + QUEJA_TEAM[opts.expectativa];
  return { categoria, ahora: [...(NOW[categoria] ?? NOW.otro)], emergencia: urgent ? EMERGENCY_LINE : null, equipo };
}

/** "a más tardar a las 03:22 (tu hora)" si hay zona; si no, hora de CDMX. */
export function promiseText(dueAt: string | Date | null | undefined, tz?: string | null): string | null {
  if (!dueAt) return null;
  const d = new Date(dueAt);
  if (!Number.isFinite(d.getTime())) return null;
  const own = localClock(tz ?? null, d);
  if (own) return `a más tardar a las ${own} (tu hora)`;
  const cdmx = localClock("America/Mexico_City", d);
  return cdmx ? `a más tardar a las ${cdmx} (hora de CDMX)` : null;
}

/** La guía sin folio ni hora (lo que queda en la bitácora como primera respuesta). */
export function guideText(g: IncidentGuide): string {
  return [g.emergencia, "Ahora mismo:", ...g.ahora.map((x) => `• ${x}`), "", g.equipo].filter((x) => x !== null).join("\n").trim();
}

/**
 * Lo que se le contesta a la persona al abrir el caso: qué hacer ya, qué hará el equipo, folio y la hora
 * en que le escribimos con el siguiente paso. Honesto: dice que el aviso al equipo ya salió solo si salió.
 */
export function incidentReplyText(g: IncidentGuide, o: {
  folio: string; dueAt?: string | Date | null; tz?: string | null; teamNotified?: boolean; severidad?: IncidentSeverity; byOperator?: boolean;
}): string {
  const promise = promiseText(o.dueAt ?? null, o.tz ?? null);
  const who = o.byOperator
    ? " y ya lo está atendiendo el operador de IATOS; si hace falta, pasa a una persona del equipo"
    : o.teamNotified === false ? " y ya está en la mesa del equipo (el aviso se está reintentando)" : " y el equipo ya fue avisado";
  const lines = [
    g.emergencia,
    "Ahora mismo:",
    ...g.ahora.map((x) => `• ${x}`),
    "",
    g.equipo,
    `Tu caso tiene el folio ${o.folio}${who}${o.severidad === "critica" && !o.byOperator ? " como urgente" : ""}.`,
    promise ? `Te escribimos ${promise} con el siguiente paso, aquí y por correo.` : "Te escribimos aquí y por correo con el siguiente paso.",
  ];
  return lines.filter((x) => x !== null && x !== undefined).join("\n").trim();
}
