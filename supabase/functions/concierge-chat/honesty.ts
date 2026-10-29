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

// ═══ Una oración ═══

/** null = se queda igual; "" = se quita; otro texto = la reemplaza. */
export function reviseSentence(sentence: string, ctx: HonestyCtx): string | null {
  if (!sentence.trim()) return null;
  if (falseNoTripClaim(sentence, ctx)) return "";
  if (phantomCardPromise(sentence, ctx)) return "";
  const sent = fixFakeSent(sentence, ctx);
  if (sent) return sent;
  if (ctx.domesticTrip) {
    const a = dropAdapter(sentence);
    if (a !== null) return a;
  }
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
    const r = core.trim() ? reviseSentence(core, this.ctx!) : null;
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
