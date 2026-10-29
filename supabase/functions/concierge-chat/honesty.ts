// Guardarraíles de honestidad que corren EN VIVO, oración por oración, antes de que el usuario vea el
// texto (auditoría 10, ronda 2). Así lo que se ve mientras Iato escribe es exactamente lo que queda al
// final (regla P0) y una frase falsa nunca llega a la pantalla. Lógica pura, sin Deno (Vitest).
//
//   N1  "Japón no está entre tus viajes guardados" con dos viajes a Tokio (país Japón) → se quita.
//   N3  "el enlace de Booking que te dejo en la card" sin búsqueda de hoteles ni tarjeta de Booking → se quita.
//   N4  "la solicitud del 13 de noviembre sigue como solicitud enviada" cuando está en awaiting_user_ok
//       (borrador, nunca se escribió) → se reemplaza por el estado real.
//   N10 "adaptador" en la lista de empaque de un viaje nacional → se quita de la lista.
//
// Cada oración se evalúa completa; si no hay nada que corregir sale tal cual (mismos espacios y saltos).

import { cityAirports } from "../_shared/airports.ts";
import { datesInText } from "../_shared/activeTrip.ts";

const norm = (v: unknown) => String(v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

// ═══ Reservas IA: estado exacto (N4) ═══

export interface AiResRow {
  id?: string; venue_name?: string | null; requested_local?: string | null; party_size?: number | null;
  status?: string | null; reason?: string | null; sent_at?: string | null; trip_id?: string | null;
}

/** Estados en los que el correo SÍ salió hacia el restaurante. */
const SENT_STATES = new Set(["sent", "venue_replied", "confirmed", "declined", "expired"]);
export const aiResWasSent = (r: AiResRow) => SENT_STATES.has(String(r.status ?? "")) || (r.status === "needs_user" && !!r.sent_at);

/** El estado tal cual, en palabras del usuario (lo lee el modelo y el guardarraíl). */
export function aiReservationExactLabel(r: AiResRow): string {
  switch (String(r.status ?? "")) {
    case "draft": return "borrador: aún no se envió al restaurante";
    case "awaiting_user_ok": return "borrador listo: aún no se envió (falta que el usuario pulse «Enviar al restaurante»)";
    case "sent": return "enviada al restaurante; sin respuesta todavía (no es reserva)";
    case "venue_replied": return "el restaurante respondió; no es reserva hasta que confirme por escrito";
    case "needs_user": return r.sent_at ? "enviada; el restaurante pide algo al usuario" : "no se envió: falta un dato o no hay correo verificado del restaurante";
    case "confirmed": return "confirmada por escrito por el restaurante";
    case "declined": return "el restaurante dijo que no hay lugar";
    case "expired": return "venció sin respuesta del restaurante";
    case "cancelled": return "cancelada (no se envió o se canceló)";
    case "failed": return "no se pudo enviar";
    default: return "estado sin confirmar: no digas que se envió";
  }
}

const MES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const fechaLarga = (local: string | null | undefined) => {
  const m = String(local ?? "").match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/);
  if (!m) return null;
  const d = `${Number(m[3])} de ${MES[Number(m[2]) - 1]}`;
  return m[4] ? `${d} a las ${m[4]}:${m[5]}` : d;
};

/** Bloque para el contexto del modelo: cada solicitud de Reservas IA con su estado exacto. */
export function aiReservationsForPrompt(rows: AiResRow[] | null | undefined, max = 8) {
  return (Array.isArray(rows) ? rows : []).slice(0, max).map((r) => ({
    restaurante: String(r.venue_name ?? "").slice(0, 80),
    fecha_hora: r.requested_local ?? undefined,
    personas: r.party_size ?? undefined,
    estado: r.status ?? undefined,
    estado_exacto: aiReservationExactLabel(r),
    se_envio: aiResWasSent(r),
  }));
}

export const AI_RES_STATE_RULE =
  "<reservas_ia_usuario> es el estado EXACTO de cada solicitud de mesa por correo (Reservas IA). Usa su estado_exacto tal cual y distingue " +
  "cada solicitud por restaurante, fecha y hora: nunca digas que una solicitud 'se envió' o está 'enviada' si su se_envio es false " +
  "(borrador o awaiting_user_ok = aún no se envió).";

// ═══ Contexto del filtro ═══

export interface HonestyTrip { destino?: string | null; pais_destino?: string | null; ciudad_origen?: string | null }

export interface HonestyCtx {
  /** TODOS los viajes del usuario (no solo los que se le pasan detallados al modelo). */
  trips: HonestyTrip[];
  userMessage: string;
  todayISO: string;
  /** Herramientas que trajeron datos en este turno (se consulta en cada oración: crece durante el turno). */
  toolsWithData: () => Set<string>;
  /** Tipos de card que el planeador ya agregó (transporte, alerta…). */
  planCardTypes?: string[];
  aiReservations?: AiResRow[];
  /** El viaje en contexto es nacional (mismo país de origen y destino): sin adaptador de corriente. */
  domesticTrip?: boolean;
  /**
   * Cuándo se cotizó el precio del hotel guardado en el viaje, ya en la hora del usuario ("27 oct 2026,
   * 23:37 (hora CDMX)"). N-P2-1: Iato decía "Google Hotels en vivo, consultado hoy 28 oct".
   */
  hotelQuoteStamp?: string | null;
  /**
   * Lo que tienen los viajes cargados completos (context.ts tripContentFacts). N4-P1-4 de ronda 4 (N4-P1-1):
   * Iato dijo "no tiene itinerario" de un viaje con itinerario de días.
   */
  /** Se mostró la tarjeta "Ayuda inmediata": el aviso de llamar a emergencias no se repite en el texto (N4-P2-5). */
  emergencyCard?: boolean;
  tripFacts?: Array<{ id?: string; destino?: string | null; itinerario_dias: number; vuelos: number; hoteles: number }>;
}

// ═══ N1: "no está entre tus viajes" cuando sí está ═══

const NO_TRIP_CLAIM = /\b(no (esta|estan|aparece|aparecen|figura|veo|tengo|encuentro|encontre|hay|tienes)\b.{0,50}\b(entre |en )?(tus|sus) viajes|no tienes (ningun |un |algun |otro )?viaje|no hay (ningun |un |algun )?viaje (guardado|registrado|a |en |para )|sin (un )?viaje (guardado|registrado) (a|en|para)|no (lo|la) (veo|tengo) (guardad|registrad)\w* (en|entre) (tus|sus) viajes)/;

/** Nombres con los que se puede referir a cada viaje: destino(s), país y país de la ciudad. */
export function tripPlaceNames(trips: HonestyTrip[]): string[] {
  const out = new Set<string>();
  for (const t of trips) {
    for (const part of String(t.destino ?? "").split(/→|->|,|;|\/|\by\b/)) {
      const p = norm(part);
      if (p.length >= 3) out.add(p);
      const c = cityAirports(part.trim());
      if (c) { out.add(norm(c.name)); out.add(norm(c.country)); }
    }
    const pais = norm(t.pais_destino);
    if (pais.length >= 3) out.add(pais);
  }
  return [...out];
}

const mentions = (text: string, names: string[]) => {
  const t = ` ${norm(text).replace(/[^a-z0-9 ]+/g, " ")} `;
  return names.filter((n) => t.includes(` ${n.replace(/[^a-z0-9 ]+/g, " ").trim()} `));
};

export function falseNoTripClaim(sentence: string, ctx: Pick<HonestyCtx, "trips" | "userMessage">): boolean {
  if (!NO_TRIP_CLAIM.test(norm(sentence))) return false;
  const names = tripPlaceNames(ctx.trips);
  if (!names.length) return false;
  if (mentions(sentence, names).length) return true;
  // "Ese destino no está entre tus viajes" sin nombrarlo: se juzga por lo que preguntó el usuario.
  return mentions(ctx.userMessage, names).length > 0 && !/\b[A-ZÁÉÍÓÚÑ][a-záéíóúñ]{3,}/.test(sentence.replace(/^\W*\w+/, ""));
}

// ═══ N3: tarjetas o enlaces prometidos que no existen ═══

const CARD_WORD = /\b(card|cards|tarjeta|tarjetas|enlace|enlaces|link|links|liga|boton|botones)\b/;
const PROMISE = /\b(te dejo|te deje|te comparto|abajo|aqui abajo|en la (card|tarjeta)|en las (cards|tarjetas)|en el (enlace|link|boton)|toca|usa el|desde el|ahi tienes|encontraras)\b/;
const CREDIT_CARD = /\b(credito|debito|amex|american express|visa|mastercard|platinum|gold|black|centurion|banco|bancaria)\b/;
const PROVIDERS: Array<[RegExp, string[]]> = [
  [/\b(booking|expedia|hoteles\.com|hotels\.com|agoda|trivago|airbnb)\b/, ["search_hotels"]],
  [/\b(viator|getyourguide)\b/, ["search_tours"]],
  [/\bticketmaster\b/, ["search_events"]],
  [/\b(opentable|thefork|the fork|resy)\b/, ["search_places", "search_nearby", "search_attractions"]],
  [/\b(skyscanner|kayak|google flights|aviasales)\b/, ["search_flights"]],
];

export function phantomCardPromise(sentence: string, ctx: Pick<HonestyCtx, "toolsWithData" | "planCardTypes">): boolean {
  const s = norm(sentence);
  if (!CARD_WORD.test(s) || !PROMISE.test(s)) return false;
  if (/\btarjeta/.test(s) && CREDIT_CARD.test(s) && !/\b(card|enlace|link|boton)\b/.test(s)) return false;
  const used = ctx.toolsWithData();
  for (const [re, tools] of PROVIDERS) {
    if (re.test(s) && !tools.some((t) => used.has(t))) return true;
  }
  // "…en la card" sin proveedor: sin ninguna búsqueda ni card del planeador, no hay card que mostrar.
  if (/\b(en la|en las|de la|abajo en la) (card|cards|tarjeta|tarjetas)\b/.test(s) && !used.size && !(ctx.planCardTypes ?? []).length) return true;
  return false;
}

// ═══ N4: "enviada" cuando no se envió ═══

const SENT_CLAIM = /\b(enviad[ao]s?|ya (se )?(envio|envie|mando|mande|mandamos|enviamos|escribimos)|se envio|le escribimos|ya le escribi\w*|mandamos|enviamos)\b/;
const NOT_SENT = /\b(no se ha enviado|aun no se envi\w*|todavia no se envi\w*|no se envi\w*|sin enviar|nada se envia|no le escrib\w*|antes de enviar|cuando (la|lo) envies|se enviara|enviaremos|vamos a enviar|se envia (cuando|hasta|solo)|no esta enviad\w*|borrador)\b/;

export function fixFakeSent(sentence: string, ctx: Pick<HonestyCtx, "aiReservations" | "todayISO">): string | null {
  const rows = ctx.aiReservations ?? [];
  if (!rows.length) return null;
  const s = norm(sentence);
  if (!SENT_CLAIM.test(s) || NOT_SENT.test(s)) return null;
  let hit = rows.filter((r) => { const v = norm(r.venue_name); return v.length >= 3 && s.includes(v); });
  if (!hit.length) return null;
  const dates = datesInText(sentence, ctx.todayISO);
  if (dates.length) {
    const byDate = hit.filter((r) => dates.includes(String(r.requested_local ?? "").slice(0, 10)));
    if (byDate.length) hit = byDate;
  }
  if (hit.some(aiResWasSent)) return null;
  return hit.slice(0, 2).map((r) => {
    const f = fechaLarga(r.requested_local);
    return `La solicitud de ${String(r.venue_name ?? "ese restaurante").slice(0, 80)}${f ? ` para el ${f}` : ""} está en ${aiReservationExactLabel(r)}.`;
  }).join(" ");
}

// ═══ N10: adaptador de corriente en un viaje nacional ═══

/** ¿Origen y destino en el mismo país? (solo si ambos se conocen). */
export function isDomesticTrip(trip: HonestyTrip | null | undefined, originCity?: string | null): boolean {
  if (!trip) return false;
  const origin = cityAirports(String(trip.ciudad_origen ?? originCity ?? "").split(/,|\(/)[0].trim());
  const destCity = cityAirports(String(trip.destino ?? "").split(/→|->|,|;/)[0].trim());
  const dest = norm(trip.pais_destino) || (destCity ? norm(destCity.country) : "");
  return !!origin && !!dest && norm(origin.country) === dest;
}

const ADAPTER = /adaptador(es)?( (de corriente|de enchufe|de viaje|universal|electrico))?/i;
export function dropAdapter(sentence: string): string | null {
  if (!ADAPTER.test(sentence)) return null;
  let out = sentence;
  const viaY = /\s+y\s+adaptador/i.test(out);
  out = out.replace(new RegExp(`(,\\s*|\\s+y\\s+)${ADAPTER.source}`, "i"), "");
  if (ADAPTER.test(out)) out = out.replace(new RegExp(`${ADAPTER.source}\\s*(,|\\s+y)\\s*`, "i"), "");
  if (ADAPTER.test(out)) return "";
  // "Cargador, power bank y adaptador" → "Cargador y power bank".
  if (viaY) out = out.replace(/([^,\n]+),\s*([^,\n]+?)(\*\*|\s+para\b|\s+por\b|\s*$)/, "$1 y $2$3");
  out = out.replace(/^(\s*(?:[-*•]|\d+[.)])\s+(?:\*\*)?)([a-záéíóúñ])/, (_m, p: string, c: string) => p + c.toUpperCase());
  return /\w/.test(out.replace(/^\s*([-*•]|\d+[.)])\s*/, "")) ? out : "";
}

// ═══ N-P2-1: precio del hotel guardado presentado como "en vivo, consultado hoy" ═══

const HOTEL_WORD = /\b(hotel\w*|hospedaje|alojamiento|por noche|la noche)\b/;
const PRICE_WORD = /(\$|\bmxn\b|\busd\b|\beur\b|\bprecio|\btarifa)/;
const LIVE_CLAIM = /\b(en vivo|consultad[oa] hoy|precio de hoy|tiempo real)\b/;

export function fixStaleHotelPrice(sentence: string, ctx: Pick<HonestyCtx, "toolsWithData" | "hotelQuoteStamp">): string | null {
  const s = norm(sentence);
  if (!HOTEL_WORD.test(s) || !PRICE_WORD.test(s) || !LIVE_CLAIM.test(s)) return null;
  // Si este turno sí buscó hoteles, "en vivo" puede ser cierto.
  if (ctx.toolsWithData().has("search_hotels")) return null;
  let out = sentence
    .replace(/\s+en tiempo real\b/gi, "")
    .replace(/\s+en vivo\b/gi, " (cotización guardada)")
    .replace(/\bprecio de hoy\b/gi, "precio guardado");
  const stamp = ctx.hotelQuoteStamp ? `consultado el ${ctx.hotelQuoteStamp}` : "de una cotización guardada";
  out = out.replace(/\bconsultad[oa]\s+hoy(?:,?\s+(?:mi[eé]rcoles|lunes|martes|jueves|viernes|s[aá]bado|domingo))?(?:\s+\d{1,2}(?:\s+de)?\s+[a-záéíóú]{3,10}\.?(?:\s+(?:de\s+)?\d{4})?)?(?:,?\s+a las \d{1,2}:\d{2}(?:\s*\([^)]*\))?)?/i, stamp);
  return out === sentence ? null : out;
}

// ═══ N-P2-2: "ajusto los horarios" sin una acción que lo haga ═══
// Iato no tiene una acción para mover lo que ya está en el itinerario: prometerlo es falso. Se cambia por
// un consejo honesto ("revisa que no choquen").

const SELF_ADJUST = /(,?\s*(?:as[ií] que|por eso|entonces|y)\s+)?\b(ajusto|ajustar[eé]|reacomodo|reacomodar[eé]|reorganizo|reorganizar[eé]|muevo|mover[eé]|recorro|actualizo|actualizar[eé])\b[^.!?\n]*?\b(horarios?|horas|itinerario|agenda)\b[^.!?\n]*/i;
const OFFER = /\b(si quieres|si te parece|puedo|podemos|quieres que|te ayudo a)\b/;

export function fixSelfAdjustPromise(sentence: string): string | null {
  const m = sentence.match(SELF_ADJUST);
  if (!m || OFFER.test(norm(sentence.slice(0, m.index! + m[0].length)))) return null;
  const tail = "revisa que los horarios no choquen; yo no muevo lo que ya tienes en el itinerario";
  const before = sentence.slice(0, m.index!).replace(/[\s,]+$/, "");
  const end = sentence.slice(m.index! + m[0].length);
  if (!before.trim() || /^\W*$/.test(before)) return `Revisa que los horarios no choquen con lo que ya tienes; yo no muevo lo que ya está en tu itinerario${end.trim() ? end : "."}`;
  return `${before}: ${tail}${end.trim() ? end : "."}`;
}

// ═══ N4-P1-1 (ronda 4): "no tiene itinerario" de un viaje que sí tiene ═══
// Se corrige solo la frase falsa y solo si TODOS los viajes con ese destino están cargados completos y la
// contradicen. El viaje se busca en la oración y, si no lo nombra ("…y no tiene itinerario"), en lo último
// que se nombró antes.

const MISSING_ITIN = /\b(?:(y|pero|e)\s+)?(?:(?:aun|todavia|tampoco)\s+)?(no tiene|no cuenta con|carece de|le falta|falta|sin)\s+(?:(?:un|el|ningun|su)\s+)?itinerario(?:\s+(?:armado|de dias|definido|todavia|aun))?/i;
const MISSING_ITEM = /\b(?:(y|pero|e)\s+)?(?:(?:aun|todavia|tampoco)\s+)?(no tiene|no cuenta con|carece de)\s+(?:(?:un|el|ningun|su|ninguna)\s+)?(hotel|hospedaje|alojamiento|vuelos?|opcion(?:es)? de vuelo)(?!\s+(?:reservad|confirmad|pagad|comprad|elegid))/i;

const destNames = (destino: unknown) => String(destino ?? "").split(/→|->|,|;|\//).map((p) => norm(p)).filter((p) => p.length >= 3);

function lastMentionedDest(text: string, facts: NonNullable<HonestyCtx["tripFacts"]>): string | null {
  const t = ` ${norm(text).replace(/[^a-z0-9 ]+/g, " ")} `;
  let best: { name: string; at: number } | null = null;
  for (const f of facts) for (const n of destNames(f.destino)) {
    const at = t.lastIndexOf(` ${n.replace(/[^a-z0-9 ]+/g, " ").trim()} `);
    if (at >= 0 && (!best || at > best.at)) best = { name: n, at };
  }
  return best?.name ?? null;
}

export function fixFalseMissing(sentence: string, ctx: Pick<HonestyCtx, "tripFacts" | "trips">, prior = ""): string | null {
  const facts = ctx.tripFacts ?? [];
  if (!facts.length) return null;
  const s = norm(sentence);
  const itin = MISSING_ITIN.exec(s);
  const item = itin ? null : MISSING_ITEM.exec(s);
  if (!itin && !item) return null;
  const dest = lastMentionedDest(sentence, facts) ?? lastMentionedDest(prior.slice(-600), facts);
  if (!dest) return null;
  const matching = facts.filter((f) => destNames(f.destino).includes(dest));
  // Un viaje con ese destino que no está cargado completo: no se sabe; se deja la frase.
  const knownIds = new Set(facts.map((f) => f.id).filter(Boolean));
  const unknown = (ctx.trips ?? []).some((t: any) => t?.id && !knownIds.has(t.id) && destNames(t.destino).includes(dest));
  if (!matching.length || unknown) return null;
  // La frase se busca en el texto original (mismas mayúsculas y acentos) con el mismo patrón sin acentos.
  const find = (re: RegExp) => {
    const plain = sentence.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const m = re.exec(plain);
    return m && plain.length === sentence.length ? { index: m.index, len: m[0].length, conj: m[1] } : null;
  };
  if (itin) {
    if (!matching.every((f) => f.itinerario_dias > 0)) return null;
    const m = find(MISSING_ITIN);
    if (!m) return null;
    const days = new Set(matching.map((f) => f.itinerario_dias));
    const n = days.size === 1 ? [...days][0] : null;
    const what = n ? `itinerario de ${n} ${n === 1 ? "día" : "días"}` : "itinerario";
    const verb = itin[2] === "sin" ? `con ${what}` : `ya tiene ${what}`;
    const rep = `${m.conj ? `${m.conj} ` : ""}${verb}`;
    return sentence.slice(0, m.index) + rep + sentence.slice(m.index + m.len);
  }
  const kind = item![3];
  const hotel = /hotel|hospedaje|alojamiento/.test(kind);
  if (!matching.every((f) => (hotel ? f.hoteles : f.vuelos) > 0)) return null;
  const m = find(MISSING_ITEM);
  if (!m) return null;
  const rep = `${m.conj ? `${m.conj} ` : ""}ya tiene ${hotel ? "una opción de hotel guardada" : "una opción de vuelo guardada"}`;
  return sentence.slice(0, m.index) + rep + sentence.slice(m.index + m.len);
}

// ═══ N4-P2-5: el aviso de emergencia una sola vez ═══
const CALL_EMERGENCY = /\b(llama\w*|marca\w*|comunicate)\b[^.!?\n]{0,40}\b(911|112|066|065|numero (local )?de emergencias|emergencias)\b/;
export function repeatedEmergencyWarning(sentence: string): boolean {
  return CALL_EMERGENCY.test(norm(sentence).replace(/\*/g, ""));
}

// ═══ N4-P2-6: "…y es lo más importante pendiente" que choca con el "Siguiente paso" ═══
const SUPERLATIVE_GAP = /,?\s+y\s+(?:es|seria|sería)\s+lo\s+m[aá]s\s+(?:importante|urgente)(?:\s+(?:pendiente|que falta|por hacer))?(?=\s*[:;,.]|\s*$)/i;
export function dropSuperlativeGap(sentence: string): string | null {
  return SUPERLATIVE_GAP.test(sentence) ? sentence.replace(SUPERLATIVE_GAP, "") : null;
}

// ═══ Ola 9.5 (29-oct-2026): menos relleno, nada de clima sin fuente, todo en español ═══

/**
 * Frases de trámite que la TARJETA de la acción ya dice ("La atiende una persona del equipo IATOS; verás su
 * respuesta en la app y por correo", "Primero verás a quién y qué le escribiremos; nada se envía sin tu
 * confirmación"). En el texto eran relleno repetido: el chofer, la mesa y el robo las decían dos veces.
 * Se quitan solo si la oración es eso (corta) y el usuario no preguntó justo por eso.
 */
const PROCESS_BOILERPLATE = [
  /\b(te respond\w+|veras (su|la|tu) respuesta|la (solicitud|veras)\b.{0,40}\bmis solicitudes)\b.{0,80}\bcorreo\b/,
  /\b(en la app|concierge\s*[›>]\s*mis solicitudes)\b.{0,30}\by por correo\b/,
  /\bprimero veras a quien y que\b/,
  /^nada se envia sin tu confirmacion\.?$/,
];
const ASKED_PROCESS = /\b(donde (veo|reviso|aparece)|mis solicitudes|como me (avisan|entero)|por correo|respuesta|como funciona)\b/;
export function processBoilerplate(sentence: string, ctx: Pick<HonestyCtx, "userMessage">): boolean {
  const t = norm(sentence).replace(/\*/g, "");
  if (t.length > 170 || ASKED_PROCESS.test(norm(ctx.userMessage))) return false;
  return PROCESS_BOILERPLATE.some((re) => re.test(t));
}

/** Pronóstico sin get_weather en este turno (ronda 9.5: "El pronóstico marca chubascos para el sábado" sin fuente). */
const FORECAST_CLAIM = /\b(pronostico|se esperan? (lluvia|chubasc\w*|tormenta\w*|sol|calor|frio)|va a llover|llovera|chubascos?|tormentas? electric\w*)\b/;
const ASKED_WEATHER = /\b(llov\w*|lluvia|clima|pronostic\w*|temperatura|calor|frio|tormenta)\b/;
const SAYS_NO_DATA = /\b(no (puedo|tengo|respondio|hay|pude)|sin (datos|pronostico))\b/;
export function unsourcedForecast(sentence: string, ctx: Pick<HonestyCtx, "toolsWithData" | "userMessage">): boolean {
  if (ctx.toolsWithData().has("get_weather") || ASKED_WEATHER.test(norm(ctx.userMessage))) return false;
  const t = norm(sentence);
  return FORECAST_CLAIM.test(t) && !SAYS_NO_DATA.test(t);
}

/** "rating 4.7" → "calificación 4.7": la UI es en español. */
export function spanishRating(sentence: string): string | null {
  return /\bratings?\b/i.test(sentence) ? sentence.replace(/\bratings?\b/gi, (w) => (w[0] === "R" ? "Calificación" : "calificación")) : null;
}

// ═══ Una oración ═══

/** null = se queda igual; "" = se quita; otro texto = la reemplaza. */
export function reviseSentence(sentence: string, ctx: HonestyCtx, prior = ""): string | null {
  if (!sentence.trim()) return null;
  if (ctx.emergencyCard && repeatedEmergencyWarning(sentence)) return "";
  const missing = fixFalseMissing(sentence, ctx, prior);
  if (missing) return missing;
  const superlative = dropSuperlativeGap(sentence);
  if (superlative) return superlative;
  if (processBoilerplate(sentence, ctx)) return "";
  if (unsourcedForecast(sentence, ctx)) return "";
  if (falseNoTripClaim(sentence, ctx)) return "";
  if (phantomCardPromise(sentence, ctx)) return "";
  const sent = fixFakeSent(sentence, ctx);
  if (sent) return sent;
  const hotel = fixStaleHotelPrice(sentence, ctx);
  if (hotel) return hotel;
  const adjust = fixSelfAdjustPromise(sentence);
  if (adjust) return adjust;
  if (ctx.domesticTrip) {
    const a = dropAdapter(sentence);
    if (a !== null) return a;
  }
  const rating = spanishRating(sentence);
  if (rating) return rating;
  return null;
}

// ═══ Filtro en vivo ═══

const LIST_PREFIX = /^(\s*(?:[-*•]|\d+[.)])\s+)/;
const SENTENCE_END = /[.!?…](?:\*\*|["”')])?[ \t]+/;

/**
 * Recibe el texto que llega del modelo y lo deja pasar oración por oración, ya revisada. `shown` es
 * exactamente lo que se mandó a la pantalla. Sin correcciones, el texto sale idéntico.
 */
export class LiveHonestyFilter {
  private buf = "";
  private atLineStart = true;
  private pendingPrefix = "";
  private lineOut = false;
  shown = "";
  revised = 0;
  constructor(private ctx: HonestyCtx | null) {}

  push(delta: string): string {
    if (!delta) return "";
    if (!this.ctx) { this.shown += delta; return delta; }
    this.buf += delta;
    return this.drain(false);
  }

  flush(): string {
    if (!this.ctx) return "";
    return this.drain(true);
  }

  private emit(t: string): string { this.shown += t; return t; }

  private segment(seg: string, endsLine: boolean): string {
    // seg incluye sus espacios finales (y el salto de línea si endsLine).
    const body = endsLine ? seg.replace(/\n$/, "") : seg;
    const trail = body.match(/\s*$/)![0];
    let core = body.slice(0, body.length - trail.length);
    let prefix = "";
    if (this.atLineStart) {
      const m = core.match(LIST_PREFIX);
      if (m) { prefix = m[1]; core = core.slice(prefix.length); }
    }
    const wasStart = this.atLineStart;
    this.atLineStart = endsLine;
    const r = core.trim() ? reviseSentence(core, this.ctx!, this.shown) : null;
    let out = "";
    if (r === null) {
      out = (this.pendingPrefix || prefix) + core + trail;
      this.pendingPrefix = "";
      if (core.trim() || prefix) this.lineOut = true;
    } else if (r === "") {
      this.revised += 1;
      // Se quita la oración; si era la primera de una viñeta, la viñeta pasa a la siguiente oración.
      if (wasStart && prefix && !endsLine) this.pendingPrefix = prefix;
    } else {
      this.revised += 1;
      out = (this.pendingPrefix || prefix) + r + (trail || (endsLine ? "" : " "));
      this.pendingPrefix = "";
      this.lineOut = true;
    }
    if (endsLine) {
      // Una línea que quedó vacía no deja hueco (salvo la línea en blanco que separa párrafos).
      if (this.lineOut || (!core.trim() && !prefix)) {
        if (!(this.shown.endsWith("\n\n") && !this.lineOut)) out += "\n";
      }
      this.lineOut = false;
      this.pendingPrefix = "";
    }
    return out ? this.emit(out) : "";
  }

  private drain(final: boolean): string {
    let out = "";
    for (;;) {
      const nl = this.buf.indexOf("\n");
      const m = SENTENCE_END.exec(this.buf);
      if (nl >= 0 && (!m || nl <= m.index)) {
        out += this.segment(this.buf.slice(0, nl + 1), true);
        this.buf = this.buf.slice(nl + 1);
        continue;
      }
      if (m) {
        const end = m.index + m[0].length;
        out += this.segment(this.buf.slice(0, end), false);
        this.buf = this.buf.slice(end);
        continue;
      }
      if (final && this.buf) {
        out += this.segment(this.buf, false);
        this.buf = "";
      }
      return out;
    }
  }
}

/** Lo mismo sobre un texto completo (respuesta en JSON, o para revisar el texto final). */
export function applyHonesty(text: string, ctx: HonestyCtx | null): { text: string; revised: number } {
  const f = new LiveHonestyFilter(ctx);
  const out = f.push(text) + f.flush();
  return { text: out, revised: f.revised };
}

// ═══ N-P2-3: la misma mesa contada dos veces ═══
// <estado_reservas_usuario> (vista canónica) trae también las mesas de Reservas IA (fila de ai_reservations
// o su espejo), que ya van con su estado exacto en <reservas_ia_usuario>: Iato decía "además hay una
// solicitud de Contramar del 28 oct" que era la misma. Se quitan de la vista las que ya están en Reservas IA.

export interface CanonRowLike { source_table?: string | null; source_id?: string | null; title?: string | null; kind?: string | null }

const MIRROR_KINDS = new Set(["restaurant", "reservation", "ai_reservation", "restaurante", "mesa", ""]);

export function withoutAiReservationMirrors<T extends CanonRowLike>(rows: T[], aiRows: AiResRow[] | null | undefined): T[] {
  const ai = Array.isArray(aiRows) ? aiRows : [];
  if (!ai.length) return rows;
  const ids = new Set(ai.map((r) => String(r.id ?? "")).filter(Boolean));
  const venues = new Set(ai.map((r) => norm(r.venue_name)).filter((v) => v.length >= 3));
  return (Array.isArray(rows) ? rows : []).filter((r) => {
    if (r.source_table === "ai_reservations") return !ids.has(String(r.source_id ?? "")) && !venues.has(norm(r.title));
    const t = norm(r.title).replace(/^(mesa|reserva|reservacion|solicitud)( de mesa)? (en|para) /, "");
    return !(MIRROR_KINDS.has(norm(r.kind)) && venues.has(t));
  });
}
