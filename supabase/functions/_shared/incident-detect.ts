// Incidentes: detección DETERMINISTA (por reglas) en cualquier mensaje del usuario (Iato, formulario, canales).
// Entiende español e inglés, con faltas de ortografía comunes, sin acentos y con letras repetidas
// ("pesimooo"). Reconoce quejas aunque no digan "queja" ("esto es una porquería") y registra el sentimiento
// y lo que la persona espera (reembolso, disculpa, cambio, información…). La IA solo se usa si hace falta
// (classifyIncident con `ai`): cuando las reglas no alcanzan a decidir.
// Puro: sin Deno. Probado en src/test/incidentes*.test.ts (60+ escenarios).
import {
  type ComplaintSubtype, type Expectation, type IncidentCategory, isComplaintSubtype, isExpectation, isIncidentCategory, isSentiment,
  type Sentiment,
} from "./incident-labels.ts";

export type IncidentDetection = {
  /** true = hay que abrir un caso. */
  detected: boolean;
  categoria: IncidentCategory | null;
  /** 0–1: qué tan seguras están las reglas. */
  confianza: number;
  queja: { subtipo: ComplaintSubtype } | null;
  sentimiento: Sentiment;
  expectativa: Expectation | null;
  idioma: "es" | "en";
  /** Qué reglas se cumplieron (para la bitácora y para depurar). */
  senales: string[];
};

/** minúsculas, sin acentos, letras repetidas 3+ → 1, espacios simples, faltas comunes corregidas. */
export function normalizeText(raw: string): string {
  let t = String(raw ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  t = t.replace(/([a-z])\1{2,}/g, "$1").replace(/[’`´]/g, "'").replace(/\s+/g, " ").trim();
  // Faltas frecuentes (teclado de celular, ortografía).
  t = t
    .replace(/\bcansel/g, "cancel").replace(/\bkansel/g, "cancel").replace(/\bkancel/g, "cancel").replace(/\bcanzel/g, "cancel")
    .replace(/\b(vuleo|vuelvo de|bulo|buelo)\b/g, "vuelo").replace(/\bchofe?l\b/g, "chofer").replace(/\bchofe\b/g, "chofer")
    .replace(/\bekipaje\b/g, "equipaje").replace(/\bekipage\b/g, "equipaje")
    .replace(/\bq\b/g, "que").replace(/\bxq\b/g, "porque").replace(/\bpq\b/g, "porque")
    .replace(/\bayudaa?\b/g, "ayuda").replace(/\bpasaport\b/g, "pasaporte").replace(/\bpasporte\b/g, "pasaporte")
    .replace(/\bhospita\b/g, "hospital").replace(/\bnadien\b/g, "nadie")
    .replace(/\bresev/g, "reserv").replace(/\breserbac/g, "reservac").replace(/\breserba/g, "reserva")
    .replace(/\bcobrarom\b/g, "cobraron").replace(/\bcobrron\b/g, "cobraron").replace(/\brrobaron\b/g, "robaron")
    .replace(/\bperdi'/g, "perdi");
  return t;
}

const any = (t: string, re: RegExp) => re.test(t);

// ─── piezas ───
const FLIGHT = /\b(vuelo|vuelos|vuelito|avion|aerolinea|flight|flights|flt|airline|plane)\b/;
const CANCELLED = /(cancelaron|se (me |nos )?cancelo|fue cancelad|esta cancelad|cancelad[oa]s?\b|cancelacion|cancelled|canceled|cancellation|got cancel|was cancel)/;
const DELAYED = /(retras|atrasad|atraso|demorad|demora\b|demoras\b|delay|late\b|no ha salido|sigue sin salir|llevamos .* esperando|lleva .* horas)/;
const MISSED = /((perdi|perdimos|voy a perder|vamos a perder|se me fue|se nos fue|missed|miss|will miss|gonna miss|going to miss)\b.{0,25}(conexion|escala|vuelo|connection|connecting|flight|layover)|conexion perdida|connection missed|no alcance (el|mi) vuelo|no alcanzamos (el|mi) vuelo)/;
const OVERBOOK = /(overbook|over book|sobrevend|sobreventa|denied boarding|no (me|nos) dejaron (abordar|subir)|bumped (me|us|off)|got bumped|vuelo lleno y no)/;
const TRANSFER = /\b(chofer|chofer|driver|traslado|transfer|pickup|pick up|recoger|recogerme|recogernos|shuttle|transporte|taxi|uber|conductor|camioneta|van|car service|cab)\b/;
const NO_SHOW = /(no (ha |han )?(llega|llegado|llego|aparece|aparecido|aparecio|esta|vino|viene|contesta)|nadie (me |nos )?(recog|esta|vino|llego|espera|esperando)|no show|didn'?t show|never (came|showed)|not here|isn'?t here|hasn'?t (arrived|shown|come)|no one (is |was )?(here|there|waiting)|nobody (is |was |came|showed)|plantad|no llega|still waiting for (my|the|our) (driver|transfer|pickup|ride))/;
const HOTEL = /\b(hotel|habitacion|habitaciones|cuarto|recepcion|check ?in|hostal|airbnb|room|front desk|resort|hospedaje|alojamiento)\b/;
const HOTEL_ISSUE = /(no (tienen|encuentran|aparece|existe|hay)|sin (mi )?reserv|no tengo (la |mi |una )?reserv|dicen? que no (tengo|hay|existe)|sobrevend|overbook|sucio|sucia|cucaracha|chinche|ruido|no funciona|no sirve|cambiaron|otra habitacion|no (me|nos) dejan|can'?t find|no record|no reservation|dirty|broken|bed ?bugs|no hot water|sin agua caliente|sin agua|aire acondicionado|mold|moho|no room|no tengo donde dormir|no tenemos donde dormir|nowhere to sleep|cobrar(me|nos)? (de nuevo|otra vez|doble)|quieren? cobrar|want to charge)/;
const BAG = /\b(maleta|maletas|equipaje|valija|valijas|luggage|baggage|bag|bags|suitcase|suitcases|mochila)\b/;
const BAG_ISSUE = /(perd|no (llego|aparece|salio|esta)|extravi|lost|missing|didn'?t (arr?ive|come)|never arr?ived|delayed|danad|rot[ao]|abierta|broken|damaged|destroyed|desapareci)/;
const DOC = /\b(pasaporte|pasaportes|passport|passports|visa|ine|identificacion|cedula|licencia|documentos?|id card|green card|residencia|boarding pass|pase de abordar)\b/;
const DOC_ISSUE = /(perd|rob|olvid|extravi|lost|stolen|stole|venc|expir|no (lo|la|los|las) encuentro|can'?t find|missing|me lo quitaron|se me cayo)/;
const THEFT = /(me (robaron|asaltaron|quitaron|arrebataron|bolsearon|carterearon|vaciaron)|nos (robaron|asaltaron)|robaron|asaltaron|un asalto|me asaltaron|carterista|pickpocket|robbed|mugged|got robbed|stolen|stole my|theft|bolsa arrebatada|me abrieron el carro|broke into (my|our) car)/;
const THEFT_METAPHOR = /(esto es un robo|es un robo|que robo|son unos ladrones|son unos rateros|ladrones|rateros|highway robbery|daylight robbery)/;
const HEALTH = /(hospital|medic[oa]|doctor|enferm|me siento (muy )?mal|nos sentimos mal|intoxic|fiebre|vomit|diarrea|herid|accidente|ambulancia|sangr|desmay|infarto|alergi|picadura|fractur|me cai\b|se cayo|dolor (muy )?(fuerte|de pecho|intenso)|sick\b|\bill\b|injur|emergency room|allergic|chest pain|broke (my|his|her) (leg|arm|ankle)|food poisoning|fainted|bleeding|ambulance|urgencias|clinica|no puede respirar|can'?t breathe|insulina|convuls|seizure|stroke)/;
const SECURITY = /(peligro|insegur|amenaz|me (siguen|persiguen)|nos (siguen|persiguen)|disparo|balacera|balazos|tiroteo|terremoto|sismo|temblor fuerte|huracan|tsunami|inundacion|evacua|protesta|disturbio|bloqueo carretero|secuestr|extorsion|unsafe|danger|threat|being followed|someone is following|shooting|gunshots|earthquake|hurricane|riot|kidnap|toque de queda|curfew|arma|pistola|cuchillo|gun\b|knife)/;
const RES = /\b(reserva|reservas|reservacion|reservaciones|booking|bookings|reservation|reservations|confirmacion|confirmation|tour|tours|restaurante|excursion|actividad|boletos|tickets|entradas|renta de auto|rental car|car rental|auto rentado)\b/;
const RES_ISSUE = /(no (aparece|existe|esta|tienen|encuentran|llego|me llego)|cancelaron|cancelad|not found|doesn'?t exist|no record|can'?t find|they don'?t have|nunca (llego|confirmaron|me confirmaron)|no me llego (la )?confirmacion|no show|no hay (registro|ninguna)|no tienen (mi|nuestra|ninguna)|has no record|isn'?t in the system|no esta en el sistema)/;
const CHARGE = /(cobr(aron|o|aste|ado|ar)\b|cargo\b|cargos\b|cargaron|charged|charge\b|charges\b|overcharg|double.?charg|billing|factur|pague|pagamos|paid)/;
const CHARGE_ISSUE = /(doble|dos veces|de mas|twice|double|extra\b|no reconoc|indebid|sin autoriz|wrong|incorrect|over|mal cobrado|no autoric|duplicad|repetid)/;
const REFUND = /(reembols|devuelvan|devolucion|regresen (mi|el) dinero|mi dinero|refund|money back|reintegro|chargeback|contracargo)/;

// ─── quejas ───
const COMPLAINT_STRONG = /(queja|quejarme|reclamo|reclamacion|inaceptable|pesim|porqueria|basura|mierda|una verguenza|que verguenza|vergonzoso|estafa|fraude|ladrones|rateros|esto es un robo|es un robo|nunca mas|exijo|harto|harta|hartos|furios|indignad|decepcion|terrible|horrible|fatal\b|lo peor|mal servicio|pesimo servicio|mala atencion|no sirven? para nada|no sirve de nada|que asco|asqueros|complain|complaint|unacceptable|ridiculous|disappointed|disgusted|worst|awful|scam|ripoff|rip.?off|useless|garbage|trash\b|sucks|pathetic|outraged|furious|want my money back|never again|un desastre|desastre|no puede ser posible|son unos incompetentes|incompetente|incompetent|joke\b|una burla|burla|me enga[nn]aron|enganaron|lied to me|me mintieron|mintieron)/;
// Pedir ayuda sin decir qué pasó: igual se abre caso ("otro"), nunca se ignora.
const DISTRESS_ONLY = /(auxilio|socorro|ayuda urgente|necesito ayuda urgente|es una emergencia|tengo una emergencia|estoy en problemas|estamos en problemas|help me please|please help|i need help now|emergency|i'?m in trouble|we'?re in trouble)/;
// Molestia corta sin más contexto ("no me gustó", "estoy molesto"): queja leve. No cuenta la cortesía ("¿te molesto?").
const SHORT_UPSET = /(no me gusto|no me gusta nada|estoy (muy )?(molest|enojad|frustrad|decepcionad)|me (molesta|enoja|frustra|decepciona)|not happy|unhappy|upset|annoyed|disappointed)/;
const POLITE_BOTHER = /(te molesto|le molesto|no es molestia|perdon la molestia|sorry to bother)/;
const COMPLAINT_MILD = /(no (estuvo|fue|era) (a la altura|lo que (prometieron|dijeron|esperaba))|esperaba (mas|otra cosa)|not (as|what) (expected|promised)|expected (more|better)|\bmal\b|\bmalo\b|\bmala\b|no me gusto|no me gusta|molest|enojad|enoja|frustrad|no es justo|no puede ser|otra vez|de nuevo nada|again\b|not happy|unhappy|upset|annoyed|bad (service|experience|recommendation)|not ok\b|no esta bien|que onda con|cerrado|closed|nada que ver|no era (lo que|como)|not what|misleading)/;

const SUB_COBRO = /(cobr|cargo|cargaron|charged|charge|dinero|money|tarjeta|card\b|reembols|refund|precio|price|factur|pague|pagamos|paid|suscripcion|subscription|membresia)/;
const SUB_APP = /(\bapp\b|aplicacion|pantalla|boton|no carga|se traba|se cierra|se congela|bug|error|crash|login|no puedo entrar|no abre|lenta|la pagina|website|sitio web|no funciona la)/;
const SUB_TRATO = /(grosero|grosera|groseros|maltrato|me trataron|nos trataron|rude|me gritaron|yelled|disrespect|prepotente|discrimin|mal trato|me hablaron feo|ignoraron)/;
const SUB_IATOS = /(\biato\b|\biatos\b|tu recomendacion|me recomendaste|nos recomendaste|recomendaron|recomendacion|recommend|ustedes|su servicio|tu servicio|el concierge|you guys|your service|tu plan|el plan que)/;
const SUB_CALIDAD = /(sucio|sucia|frio|fria|calidad|quality|dirty|cold\b|feo|fea|comida|asqueros|gross|viejo|vieja|old\b|ruidoso|noisy|smell|olor|apestaba)/;
const PROVIDER = /(hotel|habitacion|cuarto|aerolinea|airline|chofer|driver|restaurante|restaurant|tour|guia|operador|agencia|proveedor|arrendadora|rental|aeropuerto|airport|staff|personal|recepcionista|mesero|waiter)/;

// ─── sentimiento y expectativa ───
const VERY_ANGRY = /(porqueria|mierda|basura|estafa|fraude|ladrones|rateros|nunca mas|furios|indignad|harto|harta|scam|garbage|trash\b|sucks|furious|outraged|never again|wtf|ridicul|pathetic|una burla|me enganaron|una verguenza|que verguenza|abogado|demanda|profeco|denunciar|lawyer|\bsue\b)/;
const DISTRESS = /(ayuda|auxilio|urgente|desesper|no se que hacer|estoy sol[oa]|tengo miedo|panico|varad|help\b|urgent|stuck|stranded|scared|afraid|emergency|emergencia|socorro|que hago)/;
const EXP_REFUND = /(reembols|devuelvan|devolucion|mi dinero|regresen (mi|el) dinero|refund|money back|reintegro|contracargo|chargeback)/;
const EXP_COMP = /(compens|indemniz|compensation|voucher|cortesia|resarc)/;
const EXP_APOLOGY = /(disculpa|una disculpa|que se disculpen|pidan perdon|apology|apologize|apologise)/;
const EXP_CHANGE = /(cambi(ar|en|o|ame|enme)|otro hotel|otra habitacion|reubic|rebook|reacomod|otro vuelo|siguiente vuelo|move me|change\b|nueva reserva|another (room|hotel|flight)|alternativ|re.?route|nuevo vuelo)/;
const EXP_INFO = /(por que|porque paso|que paso|explic|quiero saber|informacion|why\b|what happened|explain|status|estatus|cuando (llega|sale|me)|que hago|que debo hacer|what (do|should) i do)/;

// ─── no es un incidente: pedir algo, preguntar el estado ───
const ACTION_REQUEST = /^(?:hola[, ]*)?(?:quiero|quisiera|me gustaria|puedes|podrias|ayudame a|como (puedo )?|necesito) (cancelar|cambiar|reservar|buscar|comprar|agregar|planear)\b|^(?:busca|buscame|reserva|recomiendame|recomiendas|i want to|can you|could you|help me) /;
const STATUS_QUESTION = /(esta (a tiempo|retrasad|cancelad)|is (my|the) flight (on time|delayed|cancel)|sabes si (mi|el) vuelo|va a salir a tiempo|como va mi vuelo|estatus de mi vuelo|status of my flight)/;
const FIRST_PERSON_PAIN = /(me |nos |estoy |estamos |llevo |llevamos |perdi|i'?m |we'?re |i am |we are |my |our |i |mi |mis )/;

const EN_WORDS = /\b(the|my|is|was|i|not|and|to|of|it|we|our|they|didn|don|this|that|at|for|with|have|has|been|flight|hotel|please|help)\b/g;
const ES_WORDS = /\b(el|la|los|las|que|de|mi|mis|se|me|es|en|y|un|una|por|con|para|esta|estoy|nos|no|hotel|vuelo|ayuda)\b/g;

export function detectLanguage(norm: string): "es" | "en" {
  const en = (norm.match(EN_WORDS) ?? []).length;
  const es = (norm.match(ES_WORDS) ?? []).length;
  return en > es ? "en" : "es";
}

function shouting(raw: string): boolean {
  const letters = raw.replace(/[^A-Za-zÁÉÍÓÚÑáéíóúñ]/g, "");
  if (letters.length < 12) return false;
  const upper = letters.replace(/[^A-ZÁÉÍÓÚÑ]/g, "").length;
  return upper / letters.length >= 0.6;
}

function category(t: string, s: string[]): IncidentCategory | null {
  const hit = (name: string, cond: boolean) => { if (cond) s.push(name); return cond; };
  // Primero lo que pone en riesgo a la persona.
  if (hit("salud", any(t, HEALTH) && !any(t, /\b(seguro de gastos medicos|seguro medico)\b.*\b(cotiza|precio|cuanto)/))) return "salud";
  const theftMetaphor = any(t, THEFT_METAPHOR);
  const docs = any(t, DOC) && any(t, DOC_ISSUE);
  if (hit("documentos", docs)) return "documentos";
  if (hit("robo", any(t, THEFT) && !theftMetaphor && !any(t, BAG) || (any(t, THEFT) && any(t, BAG) && !theftMetaphor && /(robaron|stolen|stole|robbed)/.test(t)))) return "robo";
  if (hit("seguridad", any(t, SECURITY))) return "seguridad";
  // Viaje.
  if (hit("overbooking", any(t, OVERBOOK) && !any(t, HOTEL))) return "overbooking";
  if (hit("conexion_perdida", any(t, MISSED))) return "conexion_perdida";
  if (hit("vuelo_cancelado", any(t, FLIGHT) && any(t, CANCELLED))) return "vuelo_cancelado";
  if (hit("vuelo_retrasado", any(t, FLIGHT) && any(t, DELAYED))) return "vuelo_retrasado";
  if (hit("traslado_no_llego", (any(t, TRANSFER) && any(t, NO_SHOW)) || /nadie (me |nos )?(fue a )?recog/.test(t) || /no (one|body) (picked|came to pick) (me|us)/.test(t))) return "traslado_no_llego";
  if (hit("equipaje", any(t, BAG) && any(t, BAG_ISSUE))) return "equipaje";
  if (hit("hotel_problema", any(t, HOTEL) && (any(t, HOTEL_ISSUE) || (any(t, OVERBOOK))))) return "hotel_problema";
  if (hit("reserva_problema", any(t, RES) && any(t, RES_ISSUE))) return "reserva_problema";
  if (hit("cobro_reembolso", (any(t, CHARGE) && any(t, CHARGE_ISSUE)) || any(t, REFUND))) return "cobro_reembolso";
  return null;
}

function complaintSubtype(t: string): ComplaintSubtype {
  if (any(t, SUB_COBRO)) return "cobro";
  if (any(t, SUB_APP)) return "app";
  if (any(t, SUB_TRATO)) return "trato";
  if (any(t, SUB_IATOS)) return "servicio_iatos";
  if (any(t, SUB_CALIDAD)) return "calidad";
  if (any(t, PROVIDER)) return "proveedor";
  return "servicio_iatos";
}

/**
 * Detecta si un mensaje es un problema que hay que atender (incidente o queja). Determinista.
 * `forceCategory`: lo que eligió la persona en el formulario (la detección completa el resto).
 */
export function detectIncident(raw: string, opts: { forceCategory?: IncidentCategory | null } = {}): IncidentDetection {
  const t = normalizeText(raw);
  const s: string[] = [];
  const idioma = detectLanguage(t);
  if (!t) {
    return { detected: false, categoria: null, confianza: 0, queja: null, sentimiento: "neutral", expectativa: null, idioma, senales: [] };
  }
  let cat = opts.forceCategory ?? category(t, s);
  const strong = any(t, COMPLAINT_STRONG) || shouting(raw);
  const mild = any(t, COMPLAINT_MILD);
  const politeOnly = any(t, POLITE_BOTHER) && !strong;
  const complaint = !politeOnly && (strong || (mild && (cat !== null || any(t, SUB_IATOS) || any(t, PROVIDER) || any(t, SUB_APP)))
    || (any(t, SHORT_UPSET) && t.length <= 80));
  if (strong) s.push("queja_fuerte");
  else if (complaint) s.push("queja_leve");

  // "¿Mi vuelo está a tiempo?" o "quiero cancelar mi reserva": se atiende en el chat, no es un caso.
  const actionOnly = !opts.forceCategory && any(t, ACTION_REQUEST) && !complaint && !any(t, DISTRESS) && cat !== "salud" && cat !== "seguridad" && cat !== "robo";
  const statusOnly = !opts.forceCategory && any(t, STATUS_QUESTION) && (/\?/.test(raw) || /^(sabes|is |como va|status)/.test(t)) && !complaint && !any(t, DISTRESS)
    && !/(llevo|llevamos|perdi|varad|stuck|stranded|me dejaron|horas esperando)/.test(t);
  if (actionOnly || statusOnly) {
    s.push(actionOnly ? "pide_una_accion" : "pregunta_de_estado");
    cat = null;
  }

  // Una queja sin problema operativo (o sobre un cobro) es una QUEJA, con su subtipo.
  let queja: IncidentDetection["queja"] = null;
  if (complaint && !actionOnly && !statusOnly) {
    queja = { subtipo: complaintSubtype(t) };
    if (cat === null || cat === "cobro_reembolso") cat = "queja";
  }
  if (cat === "queja" && !queja) queja = { subtipo: complaintSubtype(t) };
  if (!cat && !actionOnly && !statusOnly && any(t, DISTRESS_ONLY)) { cat = "otro"; s.push("pide_ayuda"); }

  const sentimiento: Sentiment = any(t, VERY_ANGRY) || shouting(raw) ? "muy_molesto"
    : any(t, DISTRESS) || cat === "salud" || cat === "seguridad" ? "angustiado"
    : complaint ? "molesto"
    : cat ? "preocupado" : "neutral";

  const expectativa: Expectation | null = any(t, EXP_REFUND) ? "reembolso"
    : any(t, EXP_COMP) ? "compensacion"
    : any(t, EXP_APOLOGY) && complaint ? "disculpa"
    : any(t, EXP_CHANGE) ? "cambio"
    : any(t, EXP_INFO) ? "informacion"
    : cat ? (cat === "queja" ? (queja?.subtipo === "cobro" ? "reembolso" : "disculpa") : "solucion") : null;

  let confianza = 0;
  if (cat && cat !== "queja") confianza = s.some((x) => x === cat || x === "pide_ayuda") || opts.forceCategory ? 0.85 : 0.6;
  else if (cat === "queja") confianza = strong ? 0.8 : 0.6;
  if (any(t, FIRST_PERSON_PAIN) && confianza > 0) confianza = Math.min(1, confianza + 0.05);

  return {
    detected: !!cat && confianza >= 0.5,
    categoria: cat,
    confianza: Math.round(confianza * 100) / 100,
    queja,
    sentimiento,
    expectativa,
    idioma,
    senales: s,
  };
}

// ───────────────────────────── IA solo si hace falta ─────────────────────────────

/** Clasificador con IA (inyectado). Recibe el texto y devuelve JSON (texto) con la misma forma. */
export type AiIncidentClassifier = (text: string) => Promise<string>;

export const AI_CLASSIFIER_SYSTEM = [
  "Eres el clasificador de incidentes de IATOS (concierge de viajes). Lee el mensaje de un viajero y responde SOLO un JSON:",
  '{"detected": boolean, "categoria": one of [vuelo_cancelado, vuelo_retrasado, conexion_perdida, overbooking, traslado_no_llego, hotel_problema,',
  " equipaje, documentos, robo, salud, seguridad, reserva_problema, cobro_reembolso, queja, otro] | null,",
  ' "queja": {"subtipo": one of [servicio_iatos, proveedor, cobro, trato, calidad, app]} | null,',
  ' "sentimiento": one of [neutral, preocupado, molesto, muy_molesto, angustiado],',
  ' "expectativa": one of [reembolso, disculpa, cambio, informacion, solucion, compensacion] | null}.',
  "detected=true si la persona tiene un problema que alguien debe atender o se queja (aunque no diga 'queja').",
  "Preguntas normales (buscar, reservar, '¿mi vuelo está a tiempo?') no son incidentes. No inventes datos.",
].join("\n");

function parseAi(raw: string): Partial<IncidentDetection> | null {
  const m = String(raw ?? "").match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const j = JSON.parse(m[0]) as Record<string, unknown>;
    const cat = isIncidentCategory(j.categoria) ? j.categoria : null;
    const sub = j.queja && typeof j.queja === "object" ? (j.queja as Record<string, unknown>).subtipo : null;
    return {
      detected: j.detected === true && !!cat,
      categoria: cat,
      queja: isComplaintSubtype(sub) ? { subtipo: sub } : cat === "queja" ? { subtipo: "servicio_iatos" } : null,
      sentimiento: isSentiment(j.sentimiento) ? j.sentimiento : undefined,
      expectativa: isExpectation(j.expectativa) ? j.expectativa : null,
    };
  } catch {
    return null;
  }
}

/**
 * Reglas primero; la IA solo cuando las reglas no alcanzan (nada detectado pero hay señales de molestia o
 * angustia, o confianza baja). Si la IA falla o tarda, se queda lo de las reglas: nunca bloquea un caso.
 */
export async function classifyIncident(raw: string, opts: { ai?: AiIncidentClassifier | null; timeoutMs?: number } = {}): Promise<IncidentDetection & { via: "reglas" | "ia" }> {
  const rules = detectIncident(raw);
  const t = normalizeText(raw);
  const doubtful = (!rules.detected && (any(t, COMPLAINT_MILD) || any(t, DISTRESS) || /\?|!|…|\.\.\./.test(raw))) || (rules.detected && rules.confianza < 0.6);
  if (!opts.ai || !doubtful) return { ...rules, via: "reglas" };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const out = await Promise.race([
      opts.ai(raw),
      new Promise<string>((_, rej) => { timer = setTimeout(() => rej(new Error("timeout")), opts.timeoutMs ?? 6000); }),
    ]).finally(() => { if (timer) clearTimeout(timer); });
    const ai = parseAi(out);
    if (!ai) return { ...rules, via: "reglas" };
    if (!ai.detected) return rules.detected ? { ...rules, via: "reglas" } : { ...rules, via: "ia" };
    return {
      ...rules,
      detected: true,
      categoria: ai.categoria ?? rules.categoria,
      queja: ai.queja ?? rules.queja,
      sentimiento: ai.sentimiento ?? rules.sentimiento,
      expectativa: ai.expectativa ?? rules.expectativa,
      confianza: Math.max(rules.confianza, 0.6),
      senales: [...rules.senales, "ia"],
      via: "ia",
    };
  } catch {
    return { ...rules, via: "reglas" };
  }
}
