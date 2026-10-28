// Viaje activo único (diseño C-2 de la auditoría B). Lógica pura, sin Deno ni Supabase, para que la
// usen igual el concierge (Deno), el cliente (Vite, vía src/lib/activeTrip.ts) y las pruebas (Vitest).
//
// Antes cada pantalla elegía "su" viaje por su cuenta y el concierge desempataba por fecha de
// creación: con París y Tokio en el calendario, "¿a qué hora sale mi vuelo?" contestaba sobre el
// último viaje creado. Ahora el orden es fijo y, si sigue habiendo empate, se PREGUNTA.

export type TripLike = {
  id: string;
  destino?: string | null;
  pais_destino?: string | null;
  fecha_salida?: string | null;
  fecha_regreso?: string | null;
  hospedaje_json?: unknown;
  vuelos_json?: unknown;
  itinerario_json?: unknown;
  [key: string]: unknown;
};

export type ActiveTripReason =
  | "mentioned" // el mensaje nombra destino, país o vuelo de un único viaje
  | "explicit" // el usuario lo eligió en el selector del chat (trip_id del cliente)
  | "pinned" // profiles.active_trip_id
  | "in_progress" // un único viaje en curso hoy (fecha local)
  | "single_upcoming" // un único viaje vigente
  | "ambiguous" // 2+ candidatos: hay que preguntar
  | "none"; // sin viajes vigentes

export interface ActiveTripResult<T extends TripLike> {
  trip: T | null;
  reason: ActiveTripReason;
  /** Viajes entre los que hay que elegir (solo relevante con reason "ambiguous"). */
  candidates: T[];
}

export interface ResolveOptions {
  explicitId?: string | null;
  pinnedId?: string | null;
  /** YYYY-MM-DD en la zona del usuario. */
  todayLocal: string;
  mentionedText?: string | null;
}

export const normalizeText = (value: unknown) => String(value ?? "")
  .toLowerCase()
  .normalize("NFD")
  .replace(/[̀-ͯ]/g, "")
  .replace(/[^a-z0-9]+/g, " ")
  .trim();

// Países y sus ciudades más visitadas. Si un viaje toca cualquier término de un grupo, mencionar
// cualquier otro término del grupo lo identifica ("¿qué llevo para Japón?" → viaje a Tokio).
// México no está a propósito: es el país de origen de casi todos y "salgo de México" no debe
// apuntar a un viaje a Cancún. Tampoco van palabras comunes en español ("usa", "nice").
const COUNTRY_GROUPS: string[][] = [
  ["japon", "japan", "tokio", "tokyo", "kioto", "kyoto", "osaka", "nara", "hiroshima", "sapporo"],
  ["francia", "france", "paris", "niza", "lyon", "marsella", "burdeos", "provenza"],
  ["espana", "spain", "madrid", "barcelona", "sevilla", "valencia", "malaga", "ibiza", "mallorca", "bilbao", "granada"],
  ["italia", "italy", "roma", "rome", "milan", "florencia", "venecia", "napoles", "amalfi", "toscana"],
  ["reino unido", "inglaterra", "united kingdom", "england", "londres", "london", "edimburgo", "escocia"],
  ["estados unidos", "eeuu", "ee uu", "united states", "nueva york", "new york", "miami", "los angeles", "las vegas", "san francisco", "orlando", "chicago"],
  ["canada", "toronto", "vancouver", "montreal"],
  ["alemania", "germany", "berlin", "munich", "frankfurt"],
  ["portugal", "lisboa", "lisbon", "oporto", "porto"],
  ["grecia", "greece", "atenas", "athens", "santorini", "mykonos"],
  ["argentina", "buenos aires", "mendoza", "bariloche"],
  ["peru", "lima", "cusco", "cuzco", "machu picchu"],
  ["colombia", "bogota", "medellin", "cartagena"],
  ["brasil", "brazil", "rio de janeiro", "sao paulo"],
  ["china", "pekin", "beijing", "shanghai"],
  ["corea del sur", "corea", "korea", "seul", "seoul"],
  ["tailandia", "thailand", "bangkok", "phuket"],
  ["emiratos", "emiratos arabes unidos", "dubai", "abu dhabi"],
  ["turquia", "turkey", "estambul", "istanbul", "capadocia"],
  ["paises bajos", "holanda", "netherlands", "amsterdam"],
  ["suiza", "switzerland", "zurich", "ginebra", "geneva"],
  ["australia", "sidney", "sydney", "melbourne"],
  ["egipto", "egypt", "el cairo", "cairo"],
  ["marruecos", "morocco", "marrakech"],
];

const asArray = (value: unknown): any[] => (Array.isArray(value) ? value : []);

/** Destinos de un viaje (no incluye el origen: "salgo de CDMX" no identifica ningún viaje). */
export function tripTerms(trip: TripLike): string[] {
  const terms = new Set<string>();
  const push = (v: unknown) => {
    const s = normalizeText(v);
    if (s.length > 2) terms.add(s);
  };
  String(trip.destino ?? "").split(/→|->|,|;|\/|\by\b/).forEach(push);
  push(trip.pais_destino);
  asArray(trip.hospedaje_json).forEach((h) => push(h?.ciudad));
  asArray(trip.vuelos_json).forEach((f) => { push(f?.to); push(f?.ciudad); });
  const itin = trip.itinerario_json as any;
  asArray(itin?.destinations).forEach((d) => push(typeof d === "string" ? d : d?.ciudad ?? d?.city ?? d?.nombre));
  for (const group of COUNTRY_GROUPS) {
    if (group.some((g) => terms.has(g) || [...terms].some((t) => containsWord(t, g)))) group.forEach((g) => terms.add(g));
  }
  return [...terms];
}

function flightNumbers(trip: TripLike): string[] {
  return asArray(trip.vuelos_json)
    .map((f) => normalizeText(f?.numero_vuelo ?? f?.numero ?? "").replace(/\s+/g, ""))
    .filter((n) => n.length >= 4 && /\d/.test(n));
}

function containsWord(haystack: string, needle: string): boolean {
  if (!needle) return false;
  return ` ${haystack} `.includes(` ${needle} `);
}

/** Viajes que el texto menciona por destino, país o número de vuelo. */
export function tripsMentioned<T extends TripLike>(trips: T[], text: string | null | undefined): T[] {
  const msg = normalizeText(text);
  if (!msg) return [];
  const compact = msg.replace(/\s+/g, "");
  return trips.filter((t) =>
    tripTerms(t).some((term) => containsWord(msg, term)) || flightNumbers(t).some((n) => compact.includes(n)));
}

const endOf = (t: TripLike) => (t.fecha_regreso || t.fecha_salida || null) as string | null;

/** Terminó si su último día ya pasó en la fecha local del usuario. Sin fechas: vigente. */
export const isTripEnded = (t: TripLike, today: string) => {
  const end = endOf(t);
  return !!end && String(end).slice(0, 10) < today;
};

export const isTripInProgress = (t: TripLike, today: string) => {
  const start = t.fecha_salida ? String(t.fecha_salida).slice(0, 10) : null;
  return !!start && start <= today && !isTripEnded(t, today);
};

const bySalida = <T extends TripLike>(a: T, b: T) =>
  String(a.fecha_salida ?? "9999").localeCompare(String(b.fecha_salida ?? "9999"));

const MONTHS: Record<string, number> = {
  enero: 1, ene: 1, febrero: 2, feb: 2, marzo: 3, mar: 3, abril: 4, abr: 4, mayo: 5, may: 5, junio: 6, jun: 6,
  julio: 7, jul: 7, agosto: 8, ago: 8, septiembre: 9, setiembre: 9, sep: 9, sept: 9, octubre: 10, oct: 10,
  noviembre: 11, nov: 11, diciembre: 12, dic: 12,
};

/**
 * Fechas que el mensaje nombra ("del 30 de octubre", "20 nov", "2026-11-20", "30/10") como YYYY-MM-DD.
 * Sin año: el de hoy, o el siguiente si ya pasó hace más de 30 días.
 */
export function datesInText(text: string | null | undefined, todayISO: string): string[] {
  const msg = normalizeText(text);
  const out = new Set<string>();
  const y0 = Number(String(todayISO).slice(0, 4)) || new Date().getUTCFullYear();
  const add = (y: number | null, m: number, d: number) => {
    if (!m || !d || m > 12 || d > 31) return;
    let year = y ?? y0;
    const iso = (yy: number) => `${yy}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    if (y == null && Date.parse(`${iso(year)}T00:00:00Z`) < Date.parse(`${todayISO}T00:00:00Z`) - 30 * 86400000) year += 1;
    const v = iso(year);
    if (Number.isFinite(Date.parse(`${v}T00:00:00Z`))) out.add(v);
  };
  for (const m of msg.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) add(Number(m[1]), Number(m[2]), Number(m[3]));
  for (const m of msg.matchAll(/\b(\d{1,2})\s+(?:de\s+)?([a-z]{3,10})\b(?:\s+(?:de\s+)?(\d{4}))?/g)) {
    const mon = MONTHS[m[2]];
    if (mon) add(m[3] ? Number(m[3]) : null, mon, Number(m[1]));
  }
  for (const m of msg.matchAll(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?\b/g)) add(m[3] ? Number(m[3]) : null, Number(m[2]), Number(m[1]));
  return [...out];
}

/** Viajes cuyas fechas incluyen alguna de las fechas que nombra el mensaje. */
function tripsOnDates<T extends TripLike>(trips: T[], text: string | null | undefined, today: string): T[] {
  const dates = datesInText(text, today);
  if (!dates.length) return [];
  return trips.filter((t) => {
    const a = t.fecha_salida ? String(t.fecha_salida).slice(0, 10) : null;
    const b = (t.fecha_regreso ? String(t.fecha_regreso).slice(0, 10) : null) ?? a;
    return !!a && !!b && dates.some((d) => a <= d && d <= b);
  });
}

export function resolveActiveTrip<T extends TripLike>(trips: T[], opts: ResolveOptions): ActiveTripResult<T> {
  const all = Array.isArray(trips) ? trips.filter((t) => t && t.id) : [];
  const today = opts.todayLocal;
  const live = all.filter((t) => !isTripEnded(t, today)).sort(bySalida);

  // 1) Mención explícita en el mensaje. Primero entre los vigentes; si ninguno coincide, se acepta
  //    un viaje pasado mencionado ("¿cuánto gasté en Roma?").
  let mentioned = tripsMentioned(live, opts.mentionedText);
  if (!mentioned.length) mentioned = tripsMentioned(all, opts.mentionedText);
  if (mentioned.length === 1) return { trip: mentioned[0], reason: "mentioned", candidates: mentioned };
  // Varios viajes al mismo destino y el mensaje da la fecha ("mi viaje a Valle de Bravo del 30 de
  // octubre"): la fecha decide, sin preguntar "¿a cuál?" (auditoría 10 #7).
  if (mentioned.length > 1) {
    const byDate = tripsOnDates(mentioned, opts.mentionedText, today);
    if (byDate.length === 1) return { trip: byDate[0], reason: "mentioned", candidates: byDate };
  }

  const pool = mentioned.length > 1 ? mentioned.sort(bySalida) : live;

  // 2) Elegido en el selector del chat. Si el mensaje menciona varios viajes, solo cuenta si es uno de ellos.
  if (opts.explicitId) {
    const t = (mentioned.length > 1 ? pool : all).find((x) => x.id === opts.explicitId);
    if (t) return { trip: t, reason: "explicit", candidates: [t] };
  }
  // 3) Viaje fijado en el perfil, si sigue vigente.
  if (opts.pinnedId) {
    const t = pool.find((x) => x.id === opts.pinnedId);
    if (t) return { trip: t, reason: "pinned", candidates: [t] };
  }
  // 4) Un único viaje en curso.
  const inProgress = pool.filter((t) => isTripInProgress(t, today));
  if (inProgress.length === 1) return { trip: inProgress[0], reason: "in_progress", candidates: inProgress };
  if (inProgress.length > 1) return { trip: null, reason: "ambiguous", candidates: inProgress };
  // 5) Un único viaje vigente.
  if (pool.length === 1) return { trip: pool[0], reason: "single_upcoming", candidates: pool };
  if (pool.length === 0) return { trip: null, reason: "none", candidates: [] };
  // 6) Empate: nunca se desempata por fecha de creación; sí por la fecha que el mensaje nombra.
  const byDate = tripsOnDates(pool, opts.mentionedText, today);
  if (byDate.length === 1) return { trip: byDate[0], reason: "mentioned", candidates: byDate };
  return { trip: null, reason: "ambiguous", candidates: pool };
}

// Palabras que pueden seguir a "viaje a/para/en" sin ser un lugar ("mi viaje a la playa" sí es
// genérico: no se trata como destino desconocido).
const NOT_A_PLACE = new Set([
  "mi", "mis", "el", "la", "los", "las", "un", "una", "que", "donde", "otro", "otra", "este", "esta", "ese", "esa",
  "playa", "montana", "ciudad", "pueblo", "extranjero", "europa", "asia", "africa", "sudamerica", "caribe",
]);

/**
 * El mensaje nombra un destino que no está en ninguno de los viajes ("ayúdame con mi viaje a
 * Japón" sin viaje a Japón). En ese caso NO se pregunta "¿a cuál te refieres?" listando viajes
 * que no tienen nada que ver: Iato debe decir que no hay un viaje guardado a ese destino y
 * ofrecer planearlo (hallazgo de producción R10, escenario "viaje a Japón").
 */
export function mentionsUntrackedPlace(text: string | null | undefined, trips: TripLike[]): boolean {
  const msg = normalizeText(text);
  if (!msg) return false;
  const known = new Set<string>();
  for (const t of Array.isArray(trips) ? trips : []) tripTerms(t).forEach((term) => known.add(term));
  const isKnown = (place: string) => [...known].some((k) => containsWord(place, k) || containsWord(k, place));
  // 1) País o ciudad conocida (COUNTRY_GROUPS) que no corresponde a ningún viaje.
  for (const group of COUNTRY_GROUPS) {
    for (const g of group) if (containsWord(msg, g) && !isKnown(g)) return true;
  }
  // 2) "viaje/vuelo/hotel a|para|en|hacia <Lugar>" con un lugar que no está en los viajes.
  const m = msg.match(/\b(?:viaje|viajes|vuelo|vuelos|hotel|escapada|vacaciones)\s+(?:a|para|en|hacia|rumbo a)\s+([a-z0-9]+(?:\s+[a-z0-9]+)?)/);
  if (m) {
    const words = m[1].split(" ");
    const first = words[0];
    if (first.length >= 3 && !NOT_A_PLACE.has(first) && !/^\d+$/.test(first)) {
      return !isKnown(first) && !isKnown(m[1]);
    }
  }
  return false;
}

/** ¿La pregunta depende de un viaje concreto? ("mi vuelo", "mi hotel", "qué llevo"). */
export function needsSpecificTrip(text: string | null | undefined): boolean {
  const msg = normalizeText(text);
  return /\b(mi|mis)\s+(vuelo|vuelos|viaje|hotel|hoteles|hospedaje|reserva|reservas|reservacion|itinerario|maleta|equipaje|traslado|transfer|check ?in|crucero|salida|llegada)\b/.test(msg)
    || /\bque\s+(llevo|empaco|meto|necesito llevar)\b/.test(msg);
}

const shortDate = (iso?: string | null) => {
  if (!iso) return "?";
  const d = new Date(`${String(iso).slice(0, 10)}T12:00:00Z`);
  if (!Number.isFinite(d.getTime())) return "?";
  return d.toLocaleDateString("es-MX", { day: "numeric", month: "short", timeZone: "UTC" }).replace(".", "");
};

// Sin fechas no se muestra "(? al ?)" (texto que parecía un error en el selector del Concierge):
// se dice "sin fechas", o solo la fecha que sí existe.
const dateRange = (t: TripLike) => {
  const a = t.fecha_salida ? shortDate(t.fecha_salida) : "?";
  const b = t.fecha_regreso ? shortDate(t.fecha_regreso) : "?";
  if (a === "?" && b === "?") return "sin fechas";
  if (b === "?") return `desde el ${a}`;
  if (a === "?") return `hasta el ${b}`;
  return `${a} al ${b}`;
};

export const tripLabel = (t: TripLike) => `${t.destino ?? "Sin destino"} (${dateRange(t)})`;

/** Pregunta determinista cuando hay empate: lista destinos y fechas y termina en "?". */
export function buildTripQuestion(candidates: TripLike[]): string {
  const labels = candidates.slice(0, 4).map(tripLabel);
  const list = labels.length <= 1
    ? labels.join("")
    : `${labels.slice(0, -1).join(", ")} y ${labels[labels.length - 1]}`;
  return `Tienes ${candidates.length} viajes próximos: ${list}. Para no confundirme, ¿a cuál te refieres?`;
}
