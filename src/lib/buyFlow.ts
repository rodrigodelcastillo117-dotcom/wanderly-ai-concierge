// "Comprar" como flujo de elegir y comprar (punto 11 del caso Roma → Florencia → Venecia): por cada
// paso (vuelo, un hotel por ciudad, auto) las opciones que se pueden elegir y la que está elegida, con
// su botón de compra precargado (el elemento de buildPurchasePlan). Reúsa las selecciones de la página
// (selVuelo / selHospedaje / selHoteles / selTours): elegir aquí cambia el total como antes.
import { buildPurchasePlan, realFlightOptions, type PurchaseItem, type TripOfferActionsLike } from "@/lib/purchasePlan";
import { cityHotelChoices, hasCityHotels } from "@/lib/cityHotels";
import { hotelPriceRooms } from "@/lib/quote";
import { sameCity, tripDestinations, type CityStay } from "../../supabase/functions/_shared/booking/tripRoute.ts";
import { legCarRentalDates, legOptionsFor, type LegOption } from "@/lib/multiDestTrip";
import { checkAllowlisted } from "@/lib/booking";
import { describePrefill } from "@/lib/purchasePlan";
import { trainlineLink } from "@/lib/affiliateLinks";
import { cityAirports, distanceKm, mainAirport } from "../../supabase/functions/_shared/airports.ts";
import { googleFlightsSearchUrl } from "../../supabase/functions/_shared/booking/links.ts";
import { busActions, multimodalAction, noLinkText, operatorAction, PRICE_AT_OPERATOR, routeOperators } from "../../supabase/functions/_shared/booking/railOperators.ts";
import { transitScheduleUrl } from "@/lib/takeMeThere";

export type BuySel = { selVuelo: number; selHospedaje: number; selTours: Set<number> | number[]; selHoteles?: Record<string, number> | null;
  /** Modo elegido por traslado ("traslado:roma>florencia" → "tren"). */
  selLegs?: Record<string, string> | null };

export type FlightStep = { kind: "vuelo"; n: number; title: string; item: PurchaseItem | null; options: number[]; chosen: number; skipped: boolean };
export type HotelStep = { kind: "hospedaje"; n: number; title: string; city: string | null; stay: CityStay | null; item: PurchaseItem | null;
  options: number[]; chosen: number; skipped: boolean; nights: number;
  /** true si la persona lo eligió; false si `chosen` es solo el hotel de la cotización (por defecto). */
  userChosen: boolean };
export type CarStep = { kind: "auto"; n: number; title: string; item: PurchaseItem | null };
/** Multi-destino: cómo ir de una ciudad a la siguiente (París → Roma), con su fecha y opciones estimadas. */
export type LegStep = { kind: "traslado"; n: number; title: string; from: string; to: string; date: string | null; options: LegOption[];
  /** Avión, tren o coche/chofer, con su botón; `chosen` es el modo elegido. */
  choices: LegChoice[]; chosen: string | null; item: PurchaseItem };
export type BuyStep = FlightStep | HotelStep | CarStep | LegStep;

export type BuyFlow = {
  steps: BuyStep[];
  /** Todos los elementos de "Comprar mi viaje" (incluye actividades elegidas y restaurantes). */
  items: PurchaseItem[];
  /** Recomendaciones para reservar por ciudad (restaurantes y experiencias). */
  extras: Array<{ city: string; restaurants: number[]; tours: number[] }>;
};

/** Palabras normales para el nivel de una opción (sin "tier"). */
export const TIER_WORD: Record<string, string> = { ahorro: "Económico", equilibrio: "Equilibrado", premium: "Premium" };

export function hotelTotal(h: any, nights: number, travelers: number): number | null {
  const n = Number(h?.precio_por_noche) || 0;
  return n > 0 && nights > 0 ? Math.round(n * nights * hotelPriceRooms(h, travelers)) : null;
}

const isoOk = (d: unknown): d is string => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d);
const normKey = (v: unknown) => String(v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Botón extra de un tramo: otro operador oficial, Trainline como alternativa u horarios en Google Maps. */
export type LegLink = { kind: "operador" | "alternativa" | "horarios" | "info"; label: string; url: string; site: string };

/** Una forma de ir de una ciudad a la siguiente, con su botón de compra o búsqueda. */
export type LegChoice = {
  mode: "vuelo" | "tren" | "coche" | "bus" | "ferry" | string;
  label: string;
  provider: string | null;
  duration: string | null;
  /** MXN por persona; solo si el plan lo estimó (nunca inventado). */
  pricePp: number | null;
  /** Viene del plan del viaje (logistics-plan) o es solo una búsqueda "por cotizar". */
  fromPlan: boolean;
  url: string | null;
  site: string | null;
  buttonLabel: string | null;
  completa: string | null;
  lleva: string[];
  /** Ruta interna cuando no hay sitio externo fiable (buscador de trenes, renta de auto). */
  fallbackHref: string | null;
  row: LegOption["row"] | null;
  /** Tren/autobús: otros operadores oficiales, Trainline y "Ver horarios en Google Maps" (transit). */
  links?: LegLink[];
};

const MODE_LABEL: Record<string, string> = { vuelo: "Avión", tren: "Tren", coche: "Coche", bus: "Autobús", ferry: "Ferry", taxi: "Taxi", traslado: "Traslado", otro: "Transporte" };
// Donde lo normal es contratar coche con chofer (no manejar uno mismo).
const DRIVER_COUNTRIES = new Set(["IN", "EG", "MA", "TH", "ID"]);

/**
 * Paso "París → Roma": se elige cómo ir (avión, tren o coche/chofer) entre las opciones del plan y las
 * búsquedas precargadas. Precio solo el que estimó el plan; lo demás dice "por cotizar". El botón de
 * compra es el de la opción elegida (`chosenMode`), o la primera del plan.
 */
export function legStep(trip: any, from: string, to: string, date: string | null, n: number, chosenMode?: string | null): LegStep {
  const plan = legOptionsFor(trip, from, to);
  const travelers = Math.max(1, Math.round(Number(trip?.num_viajeros) || 1));
  const km = distanceKm(from, to);
  const a = cityAirports(from);
  const b = cityAirports(to);
  const europe = a?.region === "EU" && b?.region === "EU";
  const driver = DRIVER_COUNTRIES.has(a?.iso2 ?? "") || DRIVER_COUNTRIES.has(b?.iso2 ?? "");
  const date8 = isoOk(date) ? date : null;
  const choices: LegChoice[] = [];
  const planOf = (mode: string) => plan.find((o) => o.mode === mode) ?? null;
  const base = (mode: string, extra: Partial<LegChoice>): LegChoice => {
    const p = planOf(mode);
    return { mode, label: mode === "coche" && driver ? "Coche con chofer" : MODE_LABEL[mode] ?? mode, provider: p?.provider ?? null, duration: p?.duration ?? null,
      pricePp: p?.pricePp ?? null, fromPlan: !!p, url: null, site: null, buttonLabel: null, completa: null, lleva: [], fallbackHref: null, row: p?.row ?? null, ...extra };
  };
  // Avión: Google Flights solo ida con la fecha y los pasajeros (si ambos aeropuertos se conocen).
  const o = mainAirport(from);
  const d = mainAirport(to);
  const gf = o && d && date8 ? googleFlightsSearchUrl({ origin: o, destination: d, depart: date8, adults: travelers }) : null;
  const gfOk = gf ? checkAllowlisted(gf) : null;
  if ((gfOk && gfOk.ok) || planOf("vuelo")) {
    const url = gfOk && gfOk.ok ? gfOk.url : null;
    const pre = describePrefill(url, "Google Flights", trip);
    choices.push(base("vuelo", { url, site: url ? "Google Flights" : null, buttonLabel: url ? "Buscar vuelo en Google Flights" : null, lleva: pre.lleva, completa: pre.completa,
      fallbackHref: url ? null : `/dashboard/vuelos?origin=${encodeURIComponent(from)}&destination=${encodeURIComponent(to)}${date8 ? `&depart=${date8}` : ""}&travelers=${travelers}` }));
  }
  // Tren: el operador oficial del país con la búsqueda PRECARGADA si su formato se comprobó (Renfe, DB;
  // groundLinks.ts) o su portada; fuera de Europa, 12Go en Asia; si no, Trainline o nuestro buscador.
  if (planOf("tren") || km == null || km < 1200) {
    const tl = europe ? trainlineLink(from, to, date8 ?? "") : null;
    const q = { from, to, date: date8, adults: travelers };
    const day = date8 ? fmtDayShort(date8) : null;
    const ops = routeOperators({ from, to, provider: planOf("tren")?.provider, country: trip?.pais_destino });
    const acts = ops.map((o) => operatorAction(o, q, day));
    const mainIdx = ops.findIndex((x) => !x.informativo);
    const main = mainIdx >= 0 ? acts[mainIdx] : multimodalAction(q);
    const sched = transitScheduleUrl(from, to);
    const links: LegLink[] = [
      ...acts.filter((a) => a !== main).map((a): LegLink => ({ kind: ops[acts.indexOf(a)]?.informativo ? "info" : "operador", label: a.label, url: a.url, site: a.site })),
      ...(main && tl ? [{ kind: "alternativa" as const, label: "Buscar tren en Trainline", url: tl, site: "Trainline" }] : []),
      ...(sched ? [{ kind: "horarios" as const, label: "Ver horarios en Google Maps", url: sched, site: "Google Maps" }] : []),
    ];
    if (main) {
      choices.push(base("tren", { url: main.url, site: main.site, buttonLabel: main.label, completa: main.hint, links,
        lleva: main.link ? [main.link.lleva] : [] }));
    } else {
      const url = tl;
      choices.push(base("tren", { url, site: url ? "Trainline" : null, buttonLabel: url ? "Buscar tren en Trainline" : "Buscar tren",
        completa: url ? `Trainline no recibe la ruta por enlace: escribe ${from} → ${to}${day ? ` y el ${day}` : ""}.` : `Tren por cotizar: búscalo con ${from} → ${to}${day ? ` y el ${day}` : ""}.`,
        fallbackHref: url ? null : `/dashboard/trenes?origin=${encodeURIComponent(from)}&dest=${encodeURIComponent(to)}${date8 ? `&date=${date8}` : ""}`, links }));
    }
  }
  // Coche (o coche con chofer): la ruta en Google Maps y la renta de auto.
  if (planOf("coche") || km == null || km < 900) {
    const maps = checkAllowlisted(`https://www.google.com/maps/dir/?${new URLSearchParams({ api: "1", origin: from, destination: to, travelmode: "driving" })}`);
    const url = maps.ok ? maps.url : null;
    choices.push(base("coche", { url, site: url ? "Google Maps" : null, buttonLabel: url ? "Ver ruta en Google Maps" : null,
      completa: driver ? "Coche con chofer: reserva con tu hotel o una agencia local; Google Maps solo da la ruta y el tiempo." : "Google Maps no recibe la fecha: la renta de auto se reserva aparte.",
      fallbackHref: carHref(trip, from, to, date8) }));
  }
  // Autobús: ADO/FlixBus/12Go precargados (o la portada del operador que nombra el plan). Ferry: salidas y
  // precio en vivo de Ferryhopper en la pantalla Ferris. Taxi o traslado: se dice que IATOS no lo cotiza.
  for (const p of plan) {
    if (choices.some((c) => c.mode === p.mode)) continue;
    if (p.mode === "ferry") {
      const qs = new URLSearchParams({ origin: from, dest: to, ...(date8 ? { date: date8 } : {}), pax: String(travelers), ...(trip?.id ? { trip: String(trip.id) } : {}) });
      choices.push(base("ferry", { buttonLabel: "Ver salidas y precio en vivo", fallbackHref: `/dashboard/ferries?${qs.toString()}`,
        completa: "Salidas y precio en vivo de Ferryhopper con tu ruta y fecha; el precio se confirma al comprar." }));
      continue;
    }
    const acts = p.mode === "bus" ? busActions({ from, to, date: date8, adults: travelers, provider: p.provider }) : [];
    const main = acts[0] ?? null;
    const sched = p.mode === "bus" ? transitScheduleUrl(from, to) : null;
    const links: LegLink[] = [
      ...acts.slice(1).map((a): LegLink => ({ kind: "operador", label: a.label, url: a.url, site: a.site })),
      ...(sched ? [{ kind: "horarios" as const, label: "Ver horarios en Google Maps", url: sched, site: "Google Maps" }] : []),
    ];
    choices.push(base(p.mode, { completa: main ? main.hint : noLinkText(p.mode, p.provider),
      ...(main ? { url: main.url, site: main.site, buttonLabel: main.label, lleva: main.link ? [main.link.lleva] : [] } : {}),
      ...(links.length ? { links } : {}) }));
  }
  // Primero lo que trae el plan (en su orden), luego las búsquedas.
  choices.sort((x, y) => Number(y.fromPlan) - Number(x.fromPlan) || (x.fromPlan ? plan.findIndex((p) => p.mode === x.mode) - plan.findIndex((p) => p.mode === y.mode) : 0));
  // Sin elección: lo realista (Europa, India): tierra en tramos cortos; si no, lo primero del plan.
  // Sin distancia conocida (Ranthambore no tiene aeropuerto) cuenta como tramo corto.
  // En tramos cortos se prefiere tierra (tren y luego coche del plan) sobre un vuelo.
  const short = km == null || km < 800;
  const groundPick = short ? choices.find((c) => c.mode === "tren" && c.fromPlan) ?? choices.find((c) => c.mode === "coche" && c.fromPlan) : null;
  // Por defecto, el tramo que suma el total (logistics.internal_transport), con su mismo precio: Comprar
  // y el total no pueden decir cosas distintas (antes marcaba "Vuelo directo" a $1,782 y el total sumaba el AVE).
  const quoted = plan.find((p) => p.quoted) ?? null;
  const quotedPick = quoted ? choices.find((c) => c.mode === quoted.mode) ?? null : null;
  const chosen = choices.find((c) => c.mode === chosenMode) ?? quotedPick ?? groundPick ?? choices[0] ?? null;
  const fx = Number(trip?.itinerario_json?.logistics?.fx_usd_mxn) || 0;
  const chosenPlan = chosen ? planOf(chosen.mode) : null;
  // Mismo redondeo que logistics-plan (usdToMxn(precio × viajeros)) para que el peso cuadre con el total.
  const legPrice = chosenPlan?.quoted && chosenPlan.priceUsdPp && fx > 0 ? Math.round(chosenPlan.priceUsdPp * travelers * fx)
    : chosen?.pricePp ? chosen.pricePp * travelers : null;
  const item: PurchaseItem = {
    key: `traslado:${normKey(from)}>${normKey(to)}`, kind: "vuelo", category: chosen?.mode === "tren" ? "train" : chosen?.mode === "coche" ? "car" : "flight",
    title: `${from} → ${to}`, subtitle: [date8 ? fmtDayShort(date8) : null, `${travelers} ${travelers === 1 ? "viajero" : "viajeros"}`, chosen?.label ?? null].filter(Boolean).join(" · "),
    price: legPrice, currency: "MXN",
    priceNote: chosen?.pricePp ? `Estimado: $${chosen.pricePp.toLocaleString("es-MX")} MXN por persona. Confirma el precio en el sitio.`
      : chosen?.mode === "tren" || chosen?.mode === "bus" ? `Por cotizar: ${PRICE_AT_OPERATOR.toLowerCase()}.` : "Por cotizar: IATOS no tiene precio real de este traslado.",
    source: { fuente: chosen?.fromPlan ? "estimado" : null, estado: chosen?.fromPlan ? "ESTIMADO" : null, consultadoAt: null }, estimate: true,
    site: chosen?.site ?? null, url: chosen?.url ?? null, action: null, lleva: chosen?.lleva ?? [], completa: chosen?.completa ?? null,
    buttonLabel: chosen?.buttonLabel ?? null, optional: false, fallbackHref: chosen?.fallbackHref ?? null, col: null, index: -1, offer: null, city: to,
  };
  return { kind: "traslado", n, title: `${from} → ${to}`, from, to, date, options: plan, choices, chosen: chosen?.mode ?? null, item };
}

/** Renta de auto de un tramo: recoge en `from` y devuelve en `to` el día del tramo (no al final del viaje). */
function carHref(trip: any, from: string, to: string, legDate?: string | null): string {
  const d = legCarRentalDates(trip, from, to, legDate);
  const qs = new URLSearchParams({ city: from, dropoff: to, ...(d.pickup ? { pickup: d.pickup } : {}), ...(d.dropoff ? { return: d.dropoff } : {}), ...(trip?.id ? { trip: String(trip.id) } : {}) });
  return `/dashboard/autos?${qs.toString()}`;
}

const MES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const fmtDayShort = (iso: string) => `${Number(iso.slice(8, 10))} ${MES[Number(iso.slice(5, 7)) - 1]}`;

export function buildBuyFlow(trip: any, sel: BuySel, server: TripOfferActionsLike = {}, opts: { quoteCreatedAt?: string | null } = {}): BuyFlow {
  // Restaurantes: todos (se agrupan por ciudad en "Reservas opcionales").
  const items = buildPurchasePlan(trip, sel, server, { quoteCreatedAt: opts.quoteCreatedAt, maxRestaurants: 99 });
  const steps: BuyStep[] = [];
  let n = 1;
  const flightItem = items.find((i) => i.kind === "vuelo") ?? null;
  // Multi-destino: un solo boleto de ida a la primera ciudad y regreso desde la última (open-jaw).
  steps.push({ kind: "vuelo", n: n++, title: tripDestinations(trip).length > 1 ? "Vuelo de ida y regreso" : "Vuelo", item: flightItem, options: realFlightOptions(trip), chosen: flightItem?.index ?? -1, skipped: sel.selVuelo === -2 });

  if (hasCityHotels(trip)) {
    const choices = cityHotelChoices(trip, sel);
    const hotelItems = items.filter((i) => i.kind === "hospedaje");
    choices.forEach((c, k) => {
      // En orden: buildPurchasePlan agrega un hotel por estancia (Delhi puede aparecer dos veces).
      const item = (c.index >= 0 && c.hotel ? hotelItems.shift() : null) ?? null;
      steps.push({ kind: "hospedaje", n: n++, title: `Hotel en ${c.stay.city}`, city: c.stay.city, stay: c.stay, item,
        options: c.options.slice(0, 3).concat(c.index >= 0 && !c.options.slice(0, 3).includes(c.index) ? [c.index] : []),
        chosen: c.index, skipped: c.index === -2, nights: c.stay.nights, userChosen: c.chosen && c.index >= 0 });
      // Entre ciudades (París → Roma), el día que se sale de esta ciudad.
      const next = choices[k + 1];
      if (next) {
        const key = `traslado:${normKey(c.stay.city)}>${normKey(next.stay.city)}`;
        steps.push(legStep(trip, c.stay.city, next.stay.city, next.stay.checkin, n++, sel.selLegs?.[key] ?? null));
      }
    });
  } else {
    const hoteles: any[] = Array.isArray(trip?.hospedaje_json) ? trip.hospedaje_json : [];
    if (hoteles.length) {
      const item = items.find((i) => i.kind === "hospedaje") ?? null;
      const sorted = hoteles.map((h, i) => [h, i] as const).sort((a, b) => (Number(a[0]?.precio_por_noche) || 0) - (Number(b[0]?.precio_por_noche) || 0)).map(([, i]) => i);
      const chosen = item?.index ?? -1;
      const options = sorted.slice(0, 3).concat(chosen >= 0 && !sorted.slice(0, 3).includes(chosen) ? [chosen] : []);
      const nights = Number((item?.offer?.details as any)?.nights) || 0;
      steps.push({ kind: "hospedaje", n: n++, title: "Hotel", city: trip?.destino ?? null, stay: null, item, options, chosen, skipped: sel.selHospedaje === -2, nights,
        userChosen: sel.selHospedaje >= 0 && chosen === sel.selHospedaje });
    }
  }
  const car = items.find((i) => i.kind === "auto") ?? null;
  if (car) steps.push({ kind: "auto", n: n++, title: "Auto (opcional)", item: car });

  const cities = tripDestinations(trip);
  const list = (arr: any[]) => (Array.isArray(arr) ? arr : []);
  const byCity = (arr: any[], city: string, multi: boolean) => list(arr).map((x, i) => [x, i] as const)
    .filter(([x]) => !multi || sameCity(x?.ciudad, city)).map(([, i]) => i);
  const multi = cities.length > 1;
  const extras = (multi ? cities : [cities[0] ?? trip?.destino ?? ""]).map((city) => ({
    city, restaurants: byCity(trip?.restaurantes_json, city, multi), tours: byCity(trip?.tours_json, city, multi),
  })).filter((e) => e.restaurants.length || e.tours.length);
  return { steps, items, extras };
}
