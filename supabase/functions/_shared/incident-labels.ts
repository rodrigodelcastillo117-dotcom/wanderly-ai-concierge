// Incidentes: vocabulario común (categorías, severidades, quejas) para el servidor, los correos y la app.
// Puro: sin Deno ni React. Debe coincidir con la migración 20261029080000_incidentes (incident_categories()).

export const INCIDENT_CATEGORIES = [
  "vuelo_cancelado", "vuelo_retrasado", "conexion_perdida", "overbooking", "traslado_no_llego", "hotel_problema",
  "equipaje", "documentos", "robo", "salud", "seguridad", "reserva_problema", "cobro_reembolso", "queja", "otro",
] as const;
export type IncidentCategory = typeof INCIDENT_CATEGORIES[number];

export const INCIDENT_CATEGORY_LABEL: Record<IncidentCategory, string> = {
  vuelo_cancelado: "Vuelo cancelado",
  vuelo_retrasado: "Vuelo retrasado",
  conexion_perdida: "Conexión perdida",
  overbooking: "Sobreventa del vuelo",
  traslado_no_llego: "El traslado no llegó",
  hotel_problema: "Problema con el hotel",
  equipaje: "Equipaje",
  documentos: "Documentos perdidos o robados",
  robo: "Robo",
  salud: "Salud o emergencia médica",
  seguridad: "Seguridad",
  reserva_problema: "Problema con una reserva",
  cobro_reembolso: "Cobro o reembolso",
  queja: "Queja",
  otro: "Otro problema",
};

export const INCIDENT_SEVERITIES = ["critica", "alta", "media", "baja"] as const;
export type IncidentSeverity = typeof INCIDENT_SEVERITIES[number];
export const INCIDENT_SEVERITY_LABEL: Record<IncidentSeverity, string> = { critica: "Crítica", alta: "Alta", media: "Media", baja: "Baja" };
export const severityRank = (s: string | null | undefined) => ({ critica: 4, alta: 3, media: 2, baja: 1 } as Record<string, number>)[String(s)] ?? 0;
export const severityUp = (s: IncidentSeverity): IncidentSeverity => (s === "baja" ? "media" : s === "media" ? "alta" : "critica");

export const INCIDENT_ORIGINS = ["usuario", "iato", "monitor_vuelos", "proveedor", "equipo", "canal"] as const;
export type IncidentOrigin = typeof INCIDENT_ORIGINS[number];

export const COMPLAINT_SUBTYPES = ["servicio_iatos", "proveedor", "cobro", "trato", "calidad", "app"] as const;
export type ComplaintSubtype = typeof COMPLAINT_SUBTYPES[number];
export const COMPLAINT_SUBTYPE_LABEL: Record<ComplaintSubtype, string> = {
  servicio_iatos: "Servicio de IATOS",
  proveedor: "Proveedor (hotel, aerolínea, chofer…)",
  cobro: "Cobro",
  trato: "Trato",
  calidad: "Calidad",
  app: "La app",
};

export const SENTIMENTS = ["neutral", "preocupado", "molesto", "muy_molesto", "angustiado"] as const;
export type Sentiment = typeof SENTIMENTS[number];
export const SENTIMENT_LABEL: Record<Sentiment, string> = {
  neutral: "Tranquilo", preocupado: "Preocupado", molesto: "Molesto", muy_molesto: "Muy molesto", angustiado: "Angustiado",
};

export const EXPECTATIONS = ["reembolso", "disculpa", "cambio", "informacion", "solucion", "compensacion"] as const;
export type Expectation = typeof EXPECTATIONS[number];
export const EXPECTATION_LABEL: Record<Expectation, string> = {
  reembolso: "Reembolso", disculpa: "Una disculpa", cambio: "Un cambio", informacion: "Información", solucion: "Que se resuelva",
  compensacion: "Compensación",
};

export const isIncidentCategory = (v: unknown): v is IncidentCategory => typeof v === "string" && (INCIDENT_CATEGORIES as readonly string[]).includes(v);
export const isSeverity = (v: unknown): v is IncidentSeverity => typeof v === "string" && (INCIDENT_SEVERITIES as readonly string[]).includes(v);
export const isComplaintSubtype = (v: unknown): v is ComplaintSubtype => typeof v === "string" && (COMPLAINT_SUBTYPES as readonly string[]).includes(v);
export const isSentiment = (v: unknown): v is Sentiment => typeof v === "string" && (SENTIMENTS as readonly string[]).includes(v);
export const isExpectation = (v: unknown): v is Expectation => typeof v === "string" && (EXPECTATIONS as readonly string[]).includes(v);

export const categoryLabel = (c: string | null | undefined) => (isIncidentCategory(c) ? INCIDENT_CATEGORY_LABEL[c] : "Incidente");

/** Lo que el formulario "Tengo un problema" ofrece (en este orden). */
export const FORM_CATEGORIES: IncidentCategory[] = [
  "vuelo_cancelado", "vuelo_retrasado", "conexion_perdida", "traslado_no_llego", "hotel_problema", "equipaje",
  "documentos", "robo", "salud", "seguridad", "reserva_problema", "cobro_reembolso", "queja", "otro",
];

/** Hora local de una zona IANA ("03:12"), o null si la zona no sirve. */
export function localClock(tz: string | null | undefined, at: Date = new Date()): string | null {
  if (!tz) return null;
  try {
    return at.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: tz });
  } catch {
    return null;
  }
}

/** Hora (0–23) en una zona IANA; null si la zona no sirve. */
export function localHour(tz: string | null | undefined, at: Date = new Date()): number | null {
  const c = localClock(tz, at);
  return c ? Number(c.slice(0, 2)) : null;
}

export const isValidTimeZone = (tz: unknown): tz is string => {
  if (typeof tz !== "string" || !/^[A-Za-z_]+(\/[A-Za-z0-9_+-]+){0,2}$/.test(tz)) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};
