// Correos que recibe la persona (cotización, bienvenida, invitación a un viaje, alertas de precio y
// de vuelo, cuenta eliminada), todos sobre el sistema premium de _shared/email-kit.ts.
// Funciones puras: reciben datos ya leídos de la base y devuelven asunto, preencabezado, HTML y
// texto plano. Probadas en src/test/emailSystem.test.ts; muestras en docs/iatos/evidencia/emails/.
//
// Reglas de honestidad (no negociables):
//   * Una estimación nunca se presenta como precio en vivo. Cada renglón lleva su procedencia; si
//     el dato no trae procedencia, se muestra como ESTIMADO.
//   * "Total cotizado" solo si TODOS los renglones que suman son en vivo o confirmados; si no,
//     "Total estimado".
//   * No se inventa nada que no venga en los datos: sin horarios, sin fotos, sin estrellas ni
//     aeropuertos si no llegaron.
//   * Ningún enlace lleva correo, nombre ni otro dato personal: solo rutas con el id del viaje.
import {
  beforeAfter, button, callout, chip, type Email, eyebrow, gap, GLYPH, goldRule, headline, hero, type HeroImage,
  ledger, type LedgerLine, links, masthead, normalizeSite, panel, para, photoCredit, type Provenance, provenanceText,
  richCard, shell, signature, steps, textFooter, joinText, totalBlock, tripPass, EK, LNUM, SANS, SERIF, monogram,
} from "./email-kit.ts";
import {
  escapeHtml, firstNameOf, formatAmount, formatDateMx, formatDateRange, formatDateTime, formatMoney, formatTime,
  nightsBetween, oneLine, plural, relativeFrom, safeUrl, sourceLabel,
} from "./email-format.ts";

export type { Email, HeroImage };

/** Respuesta de pexels-image / caché "pexels_photo". */
export type PexelsResult = { image?: string | null; photographer?: string | null; photographer_url?: string | null; page_url?: string | null; alt?: string | null };

/**
 * Portada a partir de una foto de Pexels, con el crédito que pide su guía:
 * "Foto ilustrativa · Pexels · <fotógrafo>" enlazado a la página de la foto. Solo URLs https.
 */
export function pexelsHero(r: PexelsResult | null | undefined, place: string): HeroImage | null {
  const url = safeUrl(r?.image);
  if (!url || !url.startsWith("https://")) return null;
  const who = oneLine(r?.photographer, 60);
  return {
    url,
    alt: oneLine(r?.alt, 160) || `Foto ilustrativa de ${oneLine(place, 60)}`,
    credit: `Foto ilustrativa · Pexels${who ? ` · ${who}` : ""}`,
    creditUrl: safeUrl(r?.page_url) ?? safeUrl(r?.photographer_url) ?? "https://www.pexels.com",
  };
}

const tripUrl = (site: string, tripId: string) => `${site}/dashboard/viajes/${encodeURIComponent(tripId)}`;
const shortId = (id: string | null | undefined) => (id ? String(id).replace(/[^a-zA-Z0-9]/g, "").slice(0, 8).toUpperCase() : null);
const timeOnly = (at: string) => formatTime(at);

// ───────────────────────────── cotización ────────────────────────────────────────────────────────

export type QuoteLineInput = {
  category: string;
  label?: string | null;
  amount: number;
  /** Estado del snapshot (_shared/quotes.ts): COTIZADO, ESTIMADO, PENDIENTE, PAGADO, OPCIONAL, EXCLUIDO. */
  state?: string | null;
  source?: string | null;
  consultedAt?: string | null;
  qty?: number | null;
  qtyBasis?: string | null;
};

export type QuoteFlight = {
  airline: string;
  tier?: string | null;
  duration?: string | null;
  stops?: string | number | null;
  pricePerPerson?: number | null;
  source?: string | null;
  live?: boolean;
  consultedAt?: string | null;
  approximateDates?: boolean;
  mode?: string | null;
  /** Solo si salieron de la lista en vivo (mismo precio y aerolínea). */
  departure?: { code?: string | null; time?: string | null } | null;
  arrival?: { code?: string | null; time?: string | null } | null;
};

export type QuoteHotel = {
  name: string;
  type?: string | null;
  area?: string | null;
  rating?: number | null;
  stars?: number | null;
  pricePerNight?: number | null;
  source?: string | null;
  live?: boolean;
  consultedAt?: string | null;
  photoUrl?: string | null;
};

export type QuoteEmailInput = {
  firstName?: string | null;
  tripId: string;
  quoteId?: string | null;
  destination: string;
  country?: string | null;
  origin?: string | null;
  originCode?: string | null;
  destinationCode?: string | null;
  dateFrom?: string | null;
  dateTo?: string | null;
  travelers?: number | null;
  adults?: number | null;
  children?: number | null;
  rooms?: number | null;
  nights?: number | null;
  currency?: string | null;
  lines: QuoteLineInput[];
  quotedAt?: string | null;
  validUntil?: string | null;
  fxIsFallback?: boolean;
  flight?: QuoteFlight | null;
  hotel?: QuoteHotel | null;
  hero?: HeroImage | null;
  siteUrl?: string | null;
  supportEmail?: string | null;
  now?: Date;
};

const LIVE_SOURCES = new Set(["serpapi", "travelpayouts", "aviasales", "google_flights", "google_hotels"]);
const IN_TOTAL: Provenance["kind"][] = ["live", "estimate", "pending", "confirmed"];

/** Procedencia de un renglón. Sin estado o con fuente no reconocida → ESTIMADO (nunca en vivo). */
export function lineProvenance(l: QuoteLineInput): Provenance {
  const state = String(l.state ?? "").toUpperCase();
  if (state === "EXCLUIDO") return { kind: "excluded" };
  if (state === "OPCIONAL") return { kind: "optional" };
  if (!(Number(l.amount) > 0)) return { kind: "unavailable" };
  if (state === "PAGADO") return { kind: "confirmed" };
  if (state === "PENDIENTE") return { kind: "pending" };
  if (state === "COTIZADO" && LIVE_SOURCES.has(String(l.source ?? "").toLowerCase()) && l.consultedAt) {
    return { kind: "live", source: sourceLabel(l.source, l.category), at: l.consultedAt };
  }
  return { kind: "estimate", source: sourceLabel(l.source, l.category) };
}

const CATEGORY_LABEL: Record<string, string> = {
  vuelos: "Vuelos", hospedaje: "Hospedaje", comida: "Comida", tours: "Experiencias",
  transporte_local: "Transporte local", extras: "Extras",
};
const CATEGORY_ORDER = ["vuelos", "hospedaje", "tours", "comida", "transporte_local", "extras"];

function lineDetail(l: QuoteLineInput, p: Provenance, ctx: { travelers: number; nights: number; rooms: number }): string | null {
  const parts: string[] = [];
  const basis = l.qtyBasis ?? (l.category === "hospedaje" ? "per_room_night" : l.category === "vuelos" || l.category === "tours" ? "per_person" : null);
  if (basis === "per_person") parts.push(`para ${plural(ctx.travelers, "persona", "personas")}`);
  else if (basis === "per_room_night" && ctx.nights > 0) parts.push(`${plural(ctx.nights, "noche", "noches")} × ${plural(ctx.rooms, "habitación", "habitaciones")}`);
  else if (basis === "per_trip") parts.push("todo el viaje");
  if (p.kind === "unavailable") parts.push("sin precio confiable: no suma al total");
  if (p.kind === "excluded") parts.push("lo dejaste fuera de la cotización");
  if (p.kind === "optional") parts.push("alternativa: no suma al total");
  return parts.length ? parts.join(" · ") : null;
}

function travellersText(i: { travelers?: number | null; adults?: number | null; children?: number | null }): string {
  const adults = Number(i.adults), children = Number(i.children);
  if (adults > 0) {
    return children > 0 ? `${plural(adults, "adulto", "adultos")} · ${plural(children, "niño", "niños")}` : plural(adults, "adulto", "adultos");
  }
  const t = Math.max(1, Math.round(Number(i.travelers) || 1));
  return plural(t, "viajero", "viajeros");
}

const TIER: Record<string, string> = { ahorro: "Ahorro", equilibrio: "Equilibrio", premium: "Premium" };

function stopsText(stops: unknown): string | null {
  if (stops === null || stops === undefined || stops === "") return null;
  const s = String(stops).trim();
  if (/^0$|directo|sin escalas|nonstop/i.test(s)) return "Directo";
  const n = Number(s);
  if (Number.isFinite(n) && n > 0) return plural(n, "escala", "escalas");
  return oneLine(s, 40);
}

function flightProvenance(f: QuoteFlight): Provenance {
  if (f.live && f.consultedAt && !f.approximateDates && LIVE_SOURCES.has(String(f.source ?? "").toLowerCase())) {
    return { kind: "live", source: sourceLabel(f.source, "vuelos"), at: f.consultedAt };
  }
  return { kind: "estimate", source: f.approximateDates ? "tarifa del mes" : sourceLabel(f.source, "vuelos") };
}

function hotelProvenance(h: QuoteHotel): Provenance {
  if (h.live && h.consultedAt && LIVE_SOURCES.has(String(h.source ?? "").toLowerCase())) {
    return { kind: "live", source: sourceLabel(h.source, "hospedaje"), at: h.consultedAt };
  }
  return { kind: "estimate", source: sourceLabel(h.source, "hospedaje") };
}

/** Hora de un "2027-03-20 10:35" (Google Flights da hora local del aeropuerto) → "10:35 h". */
function localClock(v: unknown): string | null {
  const m = /(\d{1,2}):(\d{2})/.exec(String(v ?? ""));
  return m ? `${m[1].padStart(2, "0")}:${m[2]} h` : null;
}

/** Días de diferencia entre la fecha de salida y la de llegada ("+1"), si ambas traen fecha. */
function dayShift(dep: unknown, arr: unknown): string {
  const a = /^(\d{4}-\d{2}-\d{2})/.exec(String(dep ?? ""))?.[1], b = /^(\d{4}-\d{2}-\d{2})/.exec(String(arr ?? ""))?.[1];
  if (!a || !b) return "";
  const d = Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
  return d > 0 ? ` +${d}` : "";
}

export function tripQuoteEmail(i: QuoteEmailInput): Email {
  const now = i.now ?? new Date();
  const site = normalizeSite(i.siteUrl);
  const currency = /^[A-Z]{3}$/.test(String(i.currency ?? "")) ? String(i.currency) : "MXN";
  const destination = oneLine(i.destination, 80) || "tu destino";
  const name = firstNameOf(i.firstName);
  const travelers = Math.max(1, Math.round(Number(i.travelers) || Number(i.adults) + Number(i.children || 0) || 1));
  const nights = Number(i.nights) > 0 ? Math.round(Number(i.nights)) : nightsBetween(i.dateFrom, i.dateTo);
  const rooms = Math.max(1, Math.round(Number(i.rooms) || 1));
  const dates = formatDateRange(i.dateFrom, i.dateTo);
  const folio = shortId(i.quoteId);
  const ctx = { travelers, nights, rooms };

  // Renglones en orden fijo; los desconocidos al final. Cada uno con su procedencia.
  const sorted = [...(i.lines ?? [])].filter((l) => l && typeof l.category === "string")
    .sort((a, b) => {
      const ia = CATEGORY_ORDER.indexOf(a.category), ib = CATEGORY_ORDER.indexOf(b.category);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
  const lines = sorted.map((l) => ({ l, p: lineProvenance(l) }));
  const counted = lines.filter(({ p }) => IN_TOTAL.includes(p.kind));
  const total = counted.reduce((s, { l }) => s + Math.max(0, Math.round(Number(l.amount) || 0)), 0);
  const allLive = counted.length > 0 && counted.every(({ p }) => p.kind === "live" || p.kind === "confirmed");
  const totalLabel = allLive ? "Total cotizado" : "Total estimado";
  const has = (k: Provenance["kind"]) => lines.some(({ p }) => p.kind === k);
  const liveCount = lines.filter(({ p }) => p.kind === "live").length;

  const ledgerLines: LedgerLine[] = lines.map(({ l, p }) => ({
    glyph: GLYPH[l.category] ?? GLYPH.extras,
    label: oneLine(l.label || CATEGORY_LABEL[l.category] || l.category.replace(/_/g, " "), 60),
    detail: lineDetail(l, p, ctx),
    amount: Number(l.amount) > 0 ? formatMoney(Math.round(Number(l.amount)), currency) : null,
    provenance: p,
    muted: !IN_TOTAL.includes(p.kind),
  }));

  // Una oración por cada tipo de cifra que no es en vivo.
  const notes: string[] = [];
  if (has("estimate")) notes.push("«Estimado» es un cálculo de IATOS con precios de referencia del destino: no es una tarifa consultada en vivo y puede cambiar al reservar.");
  if (has("pending")) notes.push("«Por confirmar» es un precio que se consultó en vivo pero ya venció; lo volvemos a consultar cuando abres tu cotización.");
  if (has("unavailable")) notes.push("«No disponible» significa que no conseguimos un precio confiable; no se suma al total.");
  if (i.fxIsFallback) notes.push("Las tarifas en dólares se convirtieron con un tipo de cambio de respaldo; por eso se marcan como estimadas.");

  const quotedAt = i.quotedAt ?? now.toISOString();
  const rel = relativeFrom(quotedAt, now);
  const validUntil = formatDateTime(i.validUntil);
  const freshness = `Cotizado ${rel ? `${rel} · ` : ""}${formatDateTime(quotedAt) ?? ""}`.trim();
  const validity = validUntil ? `Válido hasta el ${validUntil} · hora del centro de México` : "Hora del centro de México";

  const subline = [dates, nights ? plural(nights, "noche", "noches") : null, travellersText(i)].filter(Boolean).join("  ·  ");
  const perPerson = travelers > 1 && total > 0 ? `≈ ${formatMoney(Math.round(total / travelers), currency)} por persona` : null;
  const totalSub = [travellersText(i), nights ? plural(nights, "noche", "noches") : null, perPerson].filter(Boolean).join(" · ");

  const cells = [
    { label: "Salida", value: formatDateMx(i.dateFrom) ?? "Por definir" },
    { label: "Regreso", value: formatDateMx(i.dateTo) ?? "Por definir" },
    { label: "Viajeros", value: travellersText(i) },
    { label: "Noches", value: nights ? String(nights) : "Por definir" },
    { label: "Habitaciones", value: String(rooms) },
    { label: "Moneda", value: currency },
  ];

  // Tarjetas ricas: solo con lo que trae la cotización.
  const cards: string[] = [];
  if (i.flight?.airline) {
    const f = i.flight;
    const ground = f.mode === "autobus" || f.mode === "auto";
    const pp = Number(f.pricePerPerson) > 0 ? formatMoney(Math.round(Number(f.pricePerPerson)), currency) : null;
    cards.push(richCard({
      glyph: ground ? GLYPH.transporte_local : GLYPH.vuelos,
      eyebrow: `${ground ? "Traslado sugerido" : "Vuelo sugerido"}${f.tier && TIER[f.tier] ? ` · ${TIER[f.tier]}` : ""}`,
      title: oneLine(f.airline, 60),
      facts: [stopsText(f.stops), f.duration ? oneLine(f.duration, 30) : null].filter((x): x is string => !!x),
      times: f.departure || f.arrival ? {
        from: { code: f.departure?.code ?? null, time: localClock(f.departure?.time) },
        to: { code: f.arrival?.code ?? null, time: localClock(f.arrival?.time) ? `${localClock(f.arrival?.time)}${dayShift(f.departure?.time, f.arrival?.time)}` : null },
      } : null,
      price: pp ? { amount: pp, basis: "por persona" } : null,
      provenance: flightProvenance(f),
      note: f.approximateDates ? "Tarifa del mismo mes, no de tu fecha exacta: se confirma al reservar." : (f.departure?.time ? "Horarios en hora local de cada aeropuerto; +1 = llega al día siguiente." : null),
    }, timeOnly));
  }
  if (i.hotel?.name) {
    const h = i.hotel;
    const stars = Number(h.stars) >= 1 && Number(h.stars) <= 5 ? "★".repeat(Math.round(Number(h.stars))) : null;
    const rating = Number(h.rating) > 0 && Number(h.rating) <= 5 ? `${Number(h.rating).toFixed(1)} / 5` : null;
    const pn = Number(h.pricePerNight) > 0 ? formatMoney(Math.round(Number(h.pricePerNight)), currency) : null;
    cards.push(richCard({
      glyph: GLYPH.hospedaje,
      eyebrow: "Hospedaje sugerido",
      title: oneLine(h.name, 80),
      facts: [stars, h.type ? oneLine(h.type, 40) : null, h.area ? oneLine(h.area, 50) : null, rating].filter((x): x is string => !!x),
      price: pn ? { amount: pn, basis: nights ? `por noche · ${plural(nights, "noche", "noches")} × ${plural(rooms, "hab.", "hab.")}` : "por noche" } : null,
      provenance: hotelProvenance(h),
      photo: h.photoUrl && safeUrl(h.photoUrl) ? { url: h.photoUrl, alt: `Foto de ${oneLine(h.name, 80)}` } : null,
    }, timeOnly));
  }

  const url = tripUrl(site, i.tripId);
  const intro = liveCount > 0
    ? `Consultamos ${liveCount === 1 ? "una tarifa" : "tarifas"} en vivo y estimamos el resto. Cada cifra dice de dónde sale.`
    : "Esta cotización es una estimación con precios de referencia; cada cifra dice de dónde sale.";

  const body = [
    masthead(folio ? `Cotización · ${folio}` : "Tu cotización"),
    gap(28),
    hero({ image: i.hero, eyebrow: "Tu viaje a", title: destination, subtitle: subline || null }),
    photoCredit(i.hero),
    gap(48),
    name ? para(`${escapeHtml(name)},`, { serif: true, color: EK.gold, size: 17 }) + gap(10) : "",
    headline("Tu viaje está cotizado."),
    gap(14),
    para(escapeHtml(intro)),
    gap(40),
    eyebrow("I · El viaje"),
    gap(16),
    tripPass({
      origin: i.origin ? { city: oneLine(i.origin, 40), code: i.originCode ?? i.flight?.departure?.code ?? null } : null,
      destination: { city: destination, code: i.destinationCode ?? i.flight?.arrival?.code ?? null },
      cells,
    }),
    cards.length ? gap(44) + eyebrow("II · Lo elegido para ti") + gap(16) + cards.join(gap(16)) : "",
    gap(52),
    eyebrow(cards.length ? "III · El desglose" : "II · El desglose"),
    gap(8),
    ledger(ledgerLines, timeOnly),
    gap(40),
    totalBlock({
      label: totalLabel,
      amount: formatAmount(total, currency),
      currency,
      sub: totalSub,
      foot: `${freshness}\n${validity}`,
    }),
    notes.length ? gap(30) + callout(notes.map(escapeHtml).join("<br><br>")) : "",
    gap(40),
    button(url, "Ver mi cotización"),
    gap(18),
    para("Nada está reservado todavía. Los precios en vivo se sostienen 24 horas; al abrir tu cotización los volvemos a consultar.", { align: "center", size: 12, color: EK.muted }),
    gap(56),
    signature(),
  ];

  const reason = "Recibes este correo porque pediste esta cotización en IATOS.";
  const subject = `Tu viaje a ${destination} está cotizado`;
  const preheader = `${totalLabel}: ${formatMoney(total, currency)}${dates ? ` · ${dates}` : ""} · ${travellersText(i)}`;
  const html = shell({ title: subject, preheader, body, reason, siteUrl: site, supportEmail: i.supportEmail });

  const text = joinText([
    "IATOS",
    "",
    name ? `${name},` : null,
    `Tu viaje a ${destination} está cotizado.`,
    intro,
    "",
    `Ruta: ${i.origin ? oneLine(i.origin, 40) : "Origen por definir"} → ${destination}`,
    `Fechas: ${dates ?? "por definir"}${nights ? ` (${plural(nights, "noche", "noches")})` : ""}`,
    `Viajeros: ${travellersText(i)} · ${plural(rooms, "habitación", "habitaciones")}`,
    "",
    i.flight?.airline ? `Vuelo sugerido: ${oneLine(i.flight.airline, 60)}${stopsText(i.flight.stops) ? ` · ${stopsText(i.flight.stops)}` : ""}${i.flight.duration ? ` · ${oneLine(i.flight.duration, 30)}` : ""}${Number(i.flight.pricePerPerson) > 0 ? ` · ${formatMoney(Math.round(Number(i.flight.pricePerPerson)), currency)} por persona` : ""} [${provenanceText(flightProvenance(i.flight), timeOnly)}]` : null,
    i.hotel?.name ? `Hospedaje sugerido: ${oneLine(i.hotel.name, 80)}${Number(i.hotel.pricePerNight) > 0 ? ` · ${formatMoney(Math.round(Number(i.hotel.pricePerNight)), currency)} por noche` : ""} [${provenanceText(hotelProvenance(i.hotel), timeOnly)}]` : null,
    i.flight?.airline || i.hotel?.name ? "" : null,
    "DESGLOSE",
    ...ledgerLines.map((l) => `- ${l.label}: ${l.amount ?? "—"} [${provenanceText(l.provenance, timeOnly)}]${l.detail ? ` (${l.detail})` : ""}`),
    "",
    `${totalLabel.toUpperCase()}: ${formatMoney(total, currency)}`,
    totalSub,
    freshness,
    validity,
    "",
    ...notes,
    notes.length ? "" : null,
    `Ver mi cotización: ${url}`,
    "Nada está reservado todavía. Los precios en vivo se sostienen 24 horas; al abrir tu cotización los volvemos a consultar.",
    "",
    "Tu concierge, Iato",
    i.hero?.credit ? `(${i.hero.credit})` : null,
    "",
    ...textFooter({ reason, siteUrl: site, supportEmail: i.supportEmail }),
  ]);
  return { subject, preheader, html, text };
}

// ───────────────────────────── bienvenida ────────────────────────────────────────────────────────

export function welcomeEmail(o: { firstName?: string | null; hero?: HeroImage | null; siteUrl?: string | null; supportEmail?: string | null } = {}): Email {
  const site = normalizeSite(o.siteUrl);
  const name = firstNameOf(o.firstName);
  const subject = name ? `${name}, tu concierge de viajes ya está listo` : "Tu concierge de viajes ya está listo";
  const preheader = "Tres pasos para tu primer viaje con IATOS.";
  const stepList = [
    { title: "Cotiza tu primer viaje", text: "Dime a dónde y cuándo. Consulto vuelos y hoteles en vivo, estimo el resto y te digo de dónde sale cada cifra.", href: `${site}/dashboard/planear`, cta: "Planear un viaje" },
    { title: "Cuéntame cómo viajas", text: "Tu ritmo, presupuesto, comida y tipo de hotel. Con eso afino cada recomendación para ti.", href: `${site}/onboarding/deep`, cta: "Completar mi perfil" },
    { title: "Guarda tus tarjetas y programas", text: "En Documentos y tarjetas registro tus tarjetas y programas de lealtad para aprovechar salas, puntos y beneficios.", href: `${site}/dashboard/perfil`, cta: "Abrir Documentos y tarjetas" },
  ];
  const body = [
    masthead("Bienvenida"),
    gap(28),
    hero({ image: o.hero, eyebrow: "Bienvenido a IATOS", title: "El mundo, a tu medida.", subtitle: "Tu concierge de viajes con inteligencia artificial", height: 380 }),
    photoCredit(o.hero),
    gap(52),
    name ? para(`${escapeHtml(name)},`, { serif: true, color: EK.gold, size: 17 }) + gap(10) : "",
    headline("Soy Iato, tu concierge."),
    gap(14),
    para("Planeo viajes completos —vuelos, hoteles, restaurantes y experiencias— y te muestro siempre qué es un precio consultado en vivo y qué es una estimación. Empecemos por aquí:"),
    gap(36),
    eyebrow("Tres primeros pasos"),
    gap(18),
    steps(stepList),
    gap(34),
    button(`${site}/dashboard`, "Entrar a IATOS"),
    gap(44),
    callout(`<span style="font-family:${SERIF};font-size:18px;line-height:27px;font-style:italic;color:${EK.ivory};">Mi promesa: nunca te mostraré una estimación como si fuera un precio en vivo.</span>`),
    gap(56),
    signature(),
  ];
  const reason = "Recibes este correo porque acabas de crear tu cuenta en IATOS.";
  const html = shell({ title: subject, preheader, body, reason, siteUrl: site, supportEmail: o.supportEmail });
  const text = joinText([
    "IATOS",
    "",
    name ? `${name},` : null,
    "Soy Iato, tu concierge.",
    "Planeo viajes completos —vuelos, hoteles, restaurantes y experiencias— y te muestro siempre qué es un precio consultado en vivo y qué es una estimación.",
    "",
    "TRES PRIMEROS PASOS",
    ...stepList.flatMap((s, n) => [`${n + 1}. ${s.title}: ${s.text}`, `   ${s.cta}: ${s.href}`]),
    "",
    `Entrar a IATOS: ${site}/dashboard`,
    "",
    "Mi promesa: nunca te mostraré una estimación como si fuera un precio en vivo.",
    "",
    "Tu concierge, Iato",
    o.hero?.credit ? `(${o.hero.credit})` : null,
    "",
    ...textFooter({ reason, siteUrl: site, supportEmail: o.supportEmail }),
  ]);
  return { subject, preheader, html, text };
}

// ───────────────────────────── invitación a un viaje ─────────────────────────────────────────────

export function tripInviteEmail(o: {
  guestName?: string | null;
  hostName?: string | null;
  destination: string;
  origin?: string | null;
  dateFrom?: string | null;
  dateTo?: string | null;
  travelers?: number | null;
  tripId: string;
  hero?: HeroImage | null;
  siteUrl?: string | null;
  supportEmail?: string | null;
}): Email {
  const site = normalizeSite(o.siteUrl);
  const destination = oneLine(o.destination, 80) || "un nuevo destino";
  const guest = firstNameOf(o.guestName);
  const host = oneLine(o.hostName, 60) || null;
  const hostShort = firstNameOf(host) ?? "Un amigo";
  const dates = formatDateRange(o.dateFrom, o.dateTo);
  const nights = nightsBetween(o.dateFrom, o.dateTo);
  const url = tripUrl(site, o.tripId);
  const subject = `${hostShort} te invitó a su viaje a ${destination}`;
  const preheader = dates ? `${destination} · ${dates}. Planéenlo juntos en IATOS.` : `Planeen juntos el viaje a ${destination} en IATOS.`;
  const cells = [
    { label: "Salida", value: formatDateMx(o.dateFrom) ?? "Por definir" },
    { label: "Regreso", value: formatDateMx(o.dateTo) ?? "Por definir" },
    ...(nights ? [{ label: "Noches", value: String(nights) }] : []),
    ...(Number(o.travelers) > 0 ? [{ label: "Viajeros", value: plural(Math.round(Number(o.travelers)), "viajero", "viajeros") }] : []),
  ];
  const body = [
    masthead("Invitación"),
    gap(28),
    hero({ image: o.hero, eyebrow: `Una invitación de ${hostShort}`, title: destination, subtitle: dates }),
    photoCredit(o.hero),
    gap(48),
    guest ? para(`${escapeHtml(guest)},`, { serif: true, color: EK.gold, size: 17 }) + gap(10) : "",
    headline(`${escapeHtml(host ?? "Un amigo")} quiere planear este viaje contigo.`, { size: 30 }),
    gap(14),
    para("Desde IATOS pueden ver el itinerario y la cotización, sumar ideas, dividir gastos y llevar el diario del viaje, juntos."),
    gap(34),
    tripPass({ origin: o.origin ? { city: oneLine(o.origin, 40) } : null, destination: { city: destination }, cells }),
    gap(40),
    button(url, "Ver el viaje"),
    gap(16),
    para("Entra con la cuenta de IATOS que tiene este correo para verlo.", { align: "center", size: 12, color: EK.muted }),
    gap(56),
    signature(),
  ];
  const reason = `Recibes este correo porque ${host ?? "un amigo"}, con quien estás conectado en IATOS, te agregó a su viaje.`;
  const html = shell({ title: subject, preheader, body, reason, siteUrl: site, supportEmail: o.supportEmail });
  const text = joinText([
    "IATOS",
    "",
    guest ? `${guest},` : null,
    `${host ?? "Un amigo"} quiere planear su viaje a ${destination} contigo.`,
    dates ? `Fechas: ${dates}${nights ? ` (${plural(nights, "noche", "noches")})` : ""}` : null,
    "",
    "Desde IATOS pueden ver el itinerario y la cotización, sumar ideas, dividir gastos y llevar el diario del viaje, juntos.",
    "",
    `Ver el viaje: ${url}`,
    "",
    "Tu concierge, Iato",
    o.hero?.credit ? `(${o.hero.credit})` : null,
    "",
    ...textFooter({ reason, siteUrl: site, supportEmail: o.supportEmail }),
  ]);
  return { subject, preheader, html, text };
}

// ───────────────────────────── alerta de precio ──────────────────────────────────────────────────

export type PriceDropInput = {
  firstName?: string | null;
  tripId: string;
  destination: string;
  originCity?: string | null;
  originCode?: string | null;
  destinationCode?: string | null;
  dateFrom?: string | null;
  dateTo?: string | null;
  adults?: number | null;
  currency?: string | null;
  /** Por persona, ambos con el tipo de cambio de hoy. */
  before: number;
  now: number;
  source: string;
  checkedAt: string;
  bookingUrl?: string | null;
  hero?: HeroImage | null;
  siteUrl?: string | null;
  supportEmail?: string | null;
  sentAt?: Date;
};

export function priceDropEmail(i: PriceDropInput): Email {
  const site = normalizeSite(i.siteUrl);
  const currency = /^[A-Z]{3}$/.test(String(i.currency ?? "")) ? String(i.currency) : "MXN";
  const destination = oneLine(i.destination, 80) || "tu destino";
  const adults = Math.max(1, Math.round(Number(i.adults) || 1));
  const drop = Math.max(0, Math.round(i.before - i.now));
  const name = firstNameOf(i.firstName);
  const dates = formatDateRange(i.dateFrom, i.dateTo);
  const prov: Provenance = { kind: "live", source: sourceLabel(i.source, "vuelos"), at: i.checkedAt };
  const url = tripUrl(site, i.tripId);
  const booking = safeUrl(i.bookingUrl);
  const nowTxt = formatMoney(i.now, currency)!;
  const subject = `Bajó tu vuelo a ${destination}: ahora ${nowTxt} por persona`;
  const preheader = `Antes ${formatMoney(i.before, currency)} · ahorras ${formatMoney(drop * adults, currency)}${adults > 1 ? ` para ${adults} viajeros` : ""}.`;
  const delta = adults > 1
    ? `Ahorras ${formatMoney(drop, currency)} por persona · ${formatMoney(drop * adults, currency)} en total`
    : `Ahorras ${formatMoney(drop, currency)}`;
  const body = [
    masthead("Alerta de precio"),
    gap(28),
    hero({ image: i.hero, eyebrow: "Bajó tu vuelo a", title: destination, subtitle: dates, height: 300 }),
    photoCredit(i.hero),
    gap(46),
    name ? para(`${escapeHtml(name)},`, { serif: true, color: EK.gold, size: 17 }) + gap(10) : "",
    headline(`Tu vuelo bajó ${escapeHtml(formatMoney(drop, currency)!)} por persona.`, { size: 30 }),
    gap(14),
    para(`Lo vigilamos por ti y la tarifa más baja de tu ruta cambió. Este es el precio por persona, viaje redondo, ${escapeHtml(formatDateTime(i.checkedAt) ?? "hoy")} (hora del centro de México).`),
    gap(32),
    beforeAfter({ before: formatMoney(i.before, currency)!, after: nowTxt, delta }),
    gap(18),
    tripPass({
      origin: i.originCode ? { city: oneLine(i.originCity, 40), code: i.originCode } : null,
      destination: { city: destination, code: i.destinationCode ?? null },
      cells: [
        { label: "Salida", value: formatDateMx(i.dateFrom) ?? "Por definir" },
        { label: "Regreso", value: formatDateMx(i.dateTo) ?? "Solo ida" },
        { label: "Viajeros", value: plural(adults, "adulto", "adultos") },
        { label: "Fuente", value: prov.kind === "live" ? prov.source : "" },
      ],
    }),
    gap(22),
    row1(chip(prov, timeOnly)),
    gap(26),
    callout(escapeHtml("Para comparar solo la baja de la tarifa, el precio de antes se convirtió con el tipo de cambio de hoy. Las tarifas cambian rápido y este precio no está apartado.")),
    gap(38),
    button(url, "Ver mi viaje"),
    booking ? gap(16) + links([{ href: booking, label: `Ver la tarifa en ${prov.kind === "live" ? prov.source : "el buscador"}` }]) : "",
    gap(56),
    signature(),
  ];
  const reason = "Recibes este aviso porque activaste la vigilancia de precio de este viaje.";
  const footerLinks = [{ href: url, label: "Dejar de vigilar este precio (desde tu viaje)" }];
  const html = shell({ title: subject, preheader, body, reason, siteUrl: site, supportEmail: i.supportEmail, footerLinks });
  const text = joinText([
    "IATOS · ALERTA DE PRECIO",
    "",
    name ? `${name},` : null,
    `Tu vuelo a ${destination} bajó ${formatMoney(drop, currency)} por persona.`,
    `Antes: ${formatMoney(i.before, currency)} → Ahora: ${nowTxt} (por persona, viaje redondo)`,
    delta,
    `Ruta: ${i.originCode ?? "?"} → ${i.destinationCode ?? destination}${dates ? ` · ${dates}` : ""} · ${plural(adults, "adulto", "adultos")}`,
    `[${provenanceText(prov, timeOnly)}]`,
    "",
    "Para comparar solo la baja de la tarifa, el precio de antes se convirtió con el tipo de cambio de hoy. Las tarifas cambian rápido y este precio no está apartado.",
    "",
    `Ver mi viaje: ${url}`,
    booking ? `Ver la tarifa: ${booking}` : null,
    "",
    "Tu concierge, Iato",
    "",
    ...textFooter({ reason, siteUrl: site, supportEmail: i.supportEmail, footerLinks }),
  ]);
  return { subject, preheader, html, text };
}

const row1 = (inner: string) => `<tr><td class="ek-pad" align="center" style="padding:0 56px;">${inner}</td></tr>`;

// ───────────────────────────── alerta de vuelo ───────────────────────────────────────────────────

export type FlightChange = { label: string; before: string | null; after: string };

/** "Puerta: A12 → B7" → { label: "Puerta", before: "A12", after: "B7" }. Lo demás va como texto. */
export function parseFlightChange(s: string): FlightChange {
  const t = oneLine(s, 160);
  const m = /^([^:]{2,40}):\s*(.+?)\s*→\s*(.+)$/.exec(t);
  if (m) return { label: m[1], before: m[2], after: m[3] };
  const a = /^Puerta asignada:\s*(.+)$/.exec(t);
  if (a) return { label: "Puerta asignada", before: null, after: a[1] };
  return { label: "Aviso", before: null, after: t };
}

/** Titular en lenguaje natural para el primer cambio. */
function flightHeadline(c: FlightChange): string {
  const l = c.label.toLowerCase();
  if (l === "puerta") return `Tu puerta cambió a la ${c.after}.`;
  if (l === "puerta asignada") return `Ya tienes puerta: ${c.after}.`;
  if (l === "terminal") return `Tu vuelo ahora sale de la terminal ${c.after}.`;
  if (l.startsWith("hora estimada")) return `Nueva hora estimada de salida: ${c.after}.`;
  if (l === "estado") return `Tu vuelo ahora está ${c.after}.`;
  return c.label === "Aviso" ? `${c.after}.`.replace(/\.\.$/, ".") : `${c.label}: ${c.after}.`;
}

export type FlightUpdateInput = {
  firstName?: string | null;
  flight: string;
  flightDate?: string | null;
  route?: string | null;
  changes: string[];
  status?: string | null;
  checkedAt: string;
  url: string;
  siteUrl?: string | null;
  supportEmail?: string | null;
};

export function flightUpdateEmail(i: FlightUpdateInput): Email {
  const site = normalizeSite(i.siteUrl);
  const flight = oneLine(i.flight, 12).toUpperCase() || "Tu vuelo";
  const name = firstNameOf(i.firstName);
  const changes = (i.changes ?? []).slice(0, 6).map(parseFlightChange);
  const first = changes[0];
  const cancelled = /cancelad/i.test(`${i.status ?? ""} ${i.changes.join(" ")}`);
  const head = cancelled ? `Tu vuelo ${flight} fue cancelado.` : first ? flightHeadline(first) : `Hay cambios en tu vuelo ${flight}.`;
  const date = formatDateMx(i.flightDate);
  const prov: Provenance = { kind: "live", source: "Google · estado del vuelo", at: i.checkedAt };
  const url = safeUrl(i.url.startsWith("/") ? `${site}${i.url}` : i.url) ?? `${site}/dashboard`;
  const subject = cancelled ? `Vuelo ${flight} cancelado` : `Vuelo ${flight}: ${first ? (first.label === "Aviso" ? first.after : `${first.label.toLowerCase()} ${first.after}`) : "hay cambios"}`;
  const preheader = changes.map((c) => (c.before ? `${c.label}: ${c.before} → ${c.after}` : `${c.label === "Aviso" ? "" : `${c.label}: `}${c.after}`)).join(" · ");

  const changeRows = changes.map((c, n) => `<tr><td style="padding:${n ? 16 : 0}px 0 16px;${n < changes.length - 1 ? `border-bottom:1px solid ${EK.line};` : ""}">
    <div style="font-family:${SANS};font-size:10px;line-height:14px;letter-spacing:0.26em;text-transform:uppercase;color:${EK.muted};">${escapeHtml(c.label === "Aviso" ? "Cambio" : c.label)}</div>
    <div style="padding-top:6px;font-family:${SERIF};font-size:24px;line-height:30px;color:${EK.ivory};${LNUM}">${c.before ? `<span style="color:${EK.muted};text-decoration:line-through;">${escapeHtml(c.before)}</span><span style="color:${EK.goldDeep};font-family:${SANS};font-size:16px;">&nbsp;&nbsp;&#8594;&nbsp;&nbsp;</span>` : ""}${escapeHtml(c.after)}</div>
  </td></tr>`).join("");

  const body = [
    masthead("Tu vuelo"),
    gap(28),
    hero({ image: null, eyebrow: [date, i.route ? oneLine(i.route, 40) : null].filter(Boolean).join(" · ") || "Tu vuelo", title: flight, subtitle: cancelled ? "Cancelado" : "Actualización en vivo", height: 260 }),
    gap(46),
    name ? para(`${escapeHtml(name)},`, { serif: true, color: EK.gold, size: 17 }) + gap(10) : "",
    headline(escapeHtml(head), { size: 30 }),
    gap(14),
    para("Seguimos tu vuelo por ti. Esto es lo que cambió desde el último aviso:"),
    gap(28),
    panel(changeRows),
    gap(20),
    row1(chip(prov, timeOnly)),
    gap(26),
    callout(escapeHtml("Los datos vienen del estado público del vuelo y pueden tardar unos minutos en actualizarse. Ante cualquier diferencia, manda lo que diga la aerolínea y las pantallas del aeropuerto.")),
    gap(38),
    button(url, "Ver mi vuelo"),
    gap(56),
    signature(),
  ];
  const reason = "Recibes este aviso porque estás siguiendo este vuelo en IATOS.";
  const footerLinks = [{ href: url, label: "Dejar de seguir este vuelo" }];
  const html = shell({ title: subject, preheader, body, reason, siteUrl: site, supportEmail: i.supportEmail, footerLinks });
  const text = joinText([
    `IATOS · VUELO ${flight}`,
    [date, i.route].filter(Boolean).join(" · ") || null,
    "",
    name ? `${name},` : null,
    head,
    "",
    ...changes.map((c) => `- ${c.label === "Aviso" ? "Cambio" : c.label}: ${c.before ? `${c.before} → ` : ""}${c.after}`),
    "",
    `[${provenanceText(prov, timeOnly)}]`,
    "Los datos vienen del estado público del vuelo y pueden tardar unos minutos en actualizarse. Ante cualquier diferencia, manda lo que diga la aerolínea y las pantallas del aeropuerto.",
    "",
    `Ver mi vuelo: ${url}`,
    "",
    "Tu concierge, Iato",
    "",
    ...textFooter({ reason, siteUrl: site, supportEmail: i.supportEmail, footerLinks }),
  ]);
  return { subject, preheader, html, text };
}

// ───────────────────────────── cuenta eliminada ──────────────────────────────────────────────────

export function accountDeletedEmail(o: { firstName?: string | null; at?: Date; pending?: boolean; siteUrl?: string | null; supportEmail?: string | null } = {}): Email {
  const site = normalizeSite(o.siteUrl);
  const name = firstNameOf(o.firstName);
  const when = formatDateTime((o.at ?? new Date()).toISOString());
  const subject = "Tu cuenta de IATOS fue eliminada";
  const preheader = "Borramos tu cuenta, tus viajes y tus datos personales.";
  const items = [
    "Tu cuenta y tu acceso.",
    "Tus viajes, cotizaciones, diarios, fotos y gastos.",
    "Tu perfil viajero, tus documentos y tarjetas y tus preferencias.",
    "Tu suscripción: ya no se te cobrará nada.",
  ];
  const body = [
    masthead("Tu cuenta"),
    gap(56),
    `<tr><td align="center">${monogram("I", 72)}</td></tr>`,
    gap(36),
    name ? para(`${escapeHtml(name)},`, { serif: true, color: EK.gold, size: 17, align: "center" }) + gap(10) : "",
    headline("Tu cuenta fue eliminada.", { align: "center" }),
    gap(16),
    goldRule(48, "center"),
    gap(24),
    para(`Hicimos lo que pediste el ${escapeHtml(when ?? "día de hoy")} (hora del centro de México). Esto es lo que borramos:`, { align: "center" }),
    gap(24),
    panel(items.map((t, n) => `<tr><td style="padding:${n ? 10 : 0}px 0 0;font-family:${SANS};font-size:14px;line-height:22px;font-weight:300;color:${EK.body};"><span style="color:${EK.gold};">${GLYPH.check}</span>&nbsp;&nbsp;${escapeHtml(t)}</td></tr>`).join("")),
    gap(24),
    o.pending ? para("Algunos registros con proveedores externos (pagos y analítica) terminan de borrarse en las próximas horas; no necesitas hacer nada.", { align: "center", size: 13, color: EK.muted }) + gap(16) : "",
    para("Si no fuiste tú, responde a este correo de inmediato.", { align: "center", size: 13, color: EK.muted }),
    gap(52),
    `<tr><td class="ek-pad" align="center" style="padding:0 56px;font-family:${SERIF};font-size:21px;line-height:28px;font-style:italic;color:${EK.gold};">Gracias por viajar con nosotros.</td></tr>`,
  ];
  const reason = "Recibes este correo porque se pidió eliminar la cuenta de IATOS de esta dirección. Es el último correo que te enviamos.";
  const html = shell({ title: subject, preheader, body, reason, siteUrl: site, supportEmail: o.supportEmail });
  const text = joinText([
    "IATOS",
    "",
    name ? `${name},` : null,
    "Tu cuenta fue eliminada.",
    `Hicimos lo que pediste el ${when ?? "día de hoy"} (hora del centro de México). Esto es lo que borramos:`,
    ...items.map((t) => `- ${t}`),
    "",
    o.pending ? "Algunos registros con proveedores externos (pagos y analítica) terminan de borrarse en las próximas horas; no necesitas hacer nada." : null,
    "Si no fuiste tú, responde a este correo de inmediato.",
    "",
    "Gracias por viajar con nosotros.",
    "",
    ...textFooter({ reason, siteUrl: site, supportEmail: o.supportEmail }),
  ]);
  return { subject, preheader, html, text };
}
