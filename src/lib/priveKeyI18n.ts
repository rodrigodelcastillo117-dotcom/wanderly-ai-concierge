/**
 * Idioma de THE PRIVÉ KEY (es / en). Misma regla que el resto de Privé (nota del dueño): español por omisión,
 * inglés si el idioma principal de la persona es inglés. Los nombres de marca (THE PRIVÉ KEY, THE SIGNATURE,
 * YOUR WORLD IS READY…) se quedan en inglés con su subtítulo en el idioma de la persona.
 * Cuando el shell (prive-ux) publique su PriveLangProvider, `useKeyLang` puede leerlo; mientras, se detecta igual.
 */
import { useMemo } from "react";

export type KeyLang = "es" | "en";

export function langFromTag(tag: string | null | undefined): KeyLang | null {
  const t = String(tag ?? "").trim().toLowerCase();
  if (!t) return null;
  const base = t.split(/[-_]/)[0];
  if (base === "es") return "es";
  if (base === "en") return "en";
  return null;
}

export function detectKeyLang(languages?: readonly (string | null | undefined)[]): KeyLang {
  const list = languages ?? (typeof navigator !== "undefined" ? (navigator.languages?.length ? navigator.languages : [navigator.language]) : []);
  for (const l of list) {
    const r = langFromTag(l);
    if (r) return r;
  }
  return "es";
}

const es = {
  locale: "es-MX",
  brand: "THE PRIVÉ KEY",
  brandSub: "Haz que sea extraordinario",
  tagline: "Make it Extraordinary",
  intro: "Escribe lo que quieres vivir. Iato te pregunta solo lo que falta y te propone hasta tres caminos con lo verificado de IATOS Privé.",
  placeholder: "Una noche inolvidable con mi pareja en CDMX…",
  examples: [
    "Tengo $10,000 MXN para celebrar un aniversario en CDMX",
    "Estoy en Mónaco y quiero vivir una experiencia extraordinaria",
    "Quiero pasar 48 horas increíbles en París",
    "Organiza algo especial para mis padres",
    "Sorpréndeme en Tokio",
  ],
  modes: { key: "Una noche", h48: "The Perfect 48 Hours", surprise: "Surprise Me" },
  modesSub: { key: "Noche completa", h48: "48 horas perfectas", surprise: "Sorpréndeme" },
  submit: "Abrir con The Key",
  thinking: "Iato está revisando el catálogo verificado…",
  questionsTitle: "Solo me falta esto",
  questionsHint: "Elige o escribe; no te pregunto nada que ya sepa.",
  continue: "Ver propuestas",
  other: "Otro…",
  placeLabel: "Lugar",
  dateLabel: "Fecha",
  partyLabel: "Personas",
  budgetLabel: "Presupuesto total",
  currency: "Moneda",
  forTrip: (label: string) => `Para tu viaje: ${label}`,
  tripPick: "Tienes varios viajes próximos. No elijo por ti: dime cuál al guardar.",
  stepsTitle: "La secuencia",
  confirmable: "Lo que puedes pedir o reservar",
  pending: "Lo que falta confirmar",
  requirements: "A tener en cuenta",
  cost: "Costo según fuentes",
  transferEst: "Traslado estimado",
  save: "Guardar plan",
  saved: "Plan guardado",
  addTrip: "Agregar al viaje",
  addedTrip: "En tu viaje · sin reservar",
  askIato: "Pregúntale a Iato",
  request: "Pedírselo al equipo IATOS",
  howToBook: "Cómo reservar",
  open: "Ver ficha",
  love: "Me encanta",
  another: "Otra sorpresa",
  newWish: "Nuevo deseo",
  myPlans: "Mis planes",
  myPlansSub: "Seguimiento de lo que guardaste",
  noPlans: "Aún no guardas planes. Cuando guardes uno, aquí verás en qué va cada paso.",
  followUp: {
    propuesta: "Propuesta · nada pedido",
    en_viaje_sin_reservar: "En tu viaje · aún sin reservar",
    solicitado: "Solicitud enviada · aún no es una reserva",
    pendiente_confirmacion: "Pendiente de confirmación del proveedor",
    confirmado_por_proveedor: "Confirmado por el proveedor",
    rechazado: "El proveedor no pudo atenderla",
    cancelado: "Cancelada",
    caducado: "Venció sin respuesta",
  } as Record<string, string>,
  archive: "Quitar",
  limit: "Llegaste al límite de planes nuevos por hoy. Tus planes guardados siguen aquí.",
  error: "No pude armar el plan ahora. Intenta de nuevo en un momento.",
  costNote: (ms: number, cache: string) => `Armado en ${(ms / 1000).toFixed(1)} s · sin IA generativa${cache === "hit" ? " · desde caché" : ""}`,
  photoIllustrative: "Foto ilustrativa",
  tripChooser: "¿En qué viaje lo agrego?",
  noTrips: "Aún no tienes viajes. Crea uno en Planear viaje y vuelve.",
  saveToTrip: "Agregar a este viaje",
  cancel: "Cancelar",
  locked: "Abre IATOS Privé para usar The Key.",
};

type KeyText = typeof es;

const en: KeyText = {
  locale: "en-US",
  brand: "THE PRIVÉ KEY",
  brandSub: "Make it extraordinary",
  tagline: "Make it Extraordinary",
  intro: "Write what you'd like to live. Iato only asks what's missing and proposes up to three paths from IATOS Privé's verified catalogue.",
  placeholder: "An unforgettable night with my partner in Mexico City…",
  examples: [
    "I have $10,000 MXN to celebrate an anniversary in Mexico City",
    "I'm in Monaco and want an extraordinary experience",
    "I want 48 incredible hours in Paris",
    "Plan something special for my parents",
    "Surprise me in Tokyo",
  ],
  modes: { key: "One night", h48: "The Perfect 48 Hours", surprise: "Surprise Me" },
  modesSub: { key: "A complete night", h48: "48 perfect hours", surprise: "Surprise me" },
  submit: "Open with The Key",
  thinking: "Iato is checking the verified catalogue…",
  questionsTitle: "I only need this",
  questionsHint: "Pick or type; I won't ask anything I already know.",
  continue: "See proposals",
  other: "Other…",
  placeLabel: "Place",
  dateLabel: "Date",
  partyLabel: "People",
  budgetLabel: "Total budget",
  currency: "Currency",
  forTrip: (label: string) => `For your trip: ${label}`,
  tripPick: "You have several upcoming trips. I won't pick for you: tell me which one when saving.",
  stepsTitle: "The sequence",
  confirmable: "What you can request or book",
  pending: "What still needs confirming",
  requirements: "Keep in mind",
  cost: "Cost per source",
  transferEst: "Estimated transfer",
  save: "Save plan",
  saved: "Plan saved",
  addTrip: "Add to trip",
  addedTrip: "In your trip · not booked",
  askIato: "Ask Iato",
  request: "Ask the IATOS team",
  howToBook: "How to book",
  open: "View details",
  love: "Love it",
  another: "Another surprise",
  newWish: "New wish",
  myPlans: "My plans",
  myPlansSub: "Follow-up on what you saved",
  noPlans: "No saved plans yet. When you save one, you'll see how each step is going here.",
  followUp: {
    propuesta: "Proposal · nothing requested",
    en_viaje_sin_reservar: "In your trip · not booked yet",
    solicitado: "Request sent · not a booking yet",
    pendiente_confirmacion: "Pending provider confirmation",
    confirmado_por_proveedor: "Confirmed by the provider",
    rechazado: "The provider couldn't take it",
    cancelado: "Cancelled",
    caducado: "Expired without a reply",
  },
  archive: "Remove",
  limit: "You've reached today's limit for new plans. Your saved plans are still here.",
  error: "I couldn't build the plan right now. Please try again shortly.",
  costNote: (ms: number, cache: string) => `Built in ${(ms / 1000).toFixed(1)} s · no generative AI${cache === "hit" ? " · from cache" : ""}`,
  photoIllustrative: "Illustrative photo",
  tripChooser: "Which trip should I add it to?",
  noTrips: "You don't have trips yet. Create one in Plan a trip and come back.",
  saveToTrip: "Add to this trip",
  cancel: "Cancel",
  locked: "Open IATOS Privé to use The Key.",
};

export const KEY_TEXT: Record<KeyLang, KeyText> = { es, en };
export type { KeyText };

export function useKeyLang(): KeyLang {
  return useMemo(() => detectKeyLang(), []);
}
export function useKeyText(): KeyText {
  return KEY_TEXT[useKeyLang()];
}
