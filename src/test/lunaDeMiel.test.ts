// Luna de miel en Italia (caso real del dueño, 27-oct-2026): restaurantes con reserva real (campos de
// Google → botones en orden de confianza), filtro por comida, tabla de taquillas OFICIALES de museos,
// "Lo TOP" con criterio visible, itinerario por día y que Iato nunca diga "reservado". Sin red: fixtures
// con el formato documentado de Places (New) y Viator.
import { describe, expect, it } from "vitest";
import restFx from "./fixtures/lunaDeMiel/places_florencia_restaurantes.json";
import museoFx from "./fixtures/lunaDeMiel/places_florencia_museos.json";
import viatorFx from "./fixtures/lunaDeMiel/viator_florencia.json";
import { fieldMask, normalizePlace, skuFor } from "../../supabase/functions/_shared/google-places";
import { createGoogleTransport } from "../../supabase/functions/_shared/google-maps";
import {
  cityFromAddress, filterByMeal, mealFromText, NO_RESERVATIONS_NOTE, restaurantBooking, theforkSearchUrl, TOP_GOOGLE, TOP_GOOGLE_RELAXED, topByRating,
} from "../../supabase/functions/_shared/restaurantBooking";
import { matchOfficialTicket, OFFICIAL_TICKETS, officialTicketsForCity, viatorAlternativeUrl } from "../../supabase/functions/_shared/officialTickets";
import { checkAllowlisted, checkTrustedSource, looksLikeBrandImpersonation } from "../../supabase/functions/_shared/booking/allowlist";
import { placesSearchOutput, placesSearchPreset } from "../../supabase/functions/places-search/shape";
import { runExperiencias, wowQueries } from "../../supabase/functions/_shared/experiencias";
import { mapViatorProducts, type ViatorResult } from "../../supabase/functions/_shared/viator";
import { enforceNoFakeBooking, NOT_BOOKED_LINE } from "../../supabase/functions/concierge-chat/guard";
import { collectEvidence, enrichCardLinks } from "../../supabase/functions/concierge-chat/cards";
import { restaurantBookingLinks } from "../../supabase/functions/concierge-chat/actions";
import { detectIntents, planTurn } from "../../supabase/functions/concierge-chat/planner";
import { SYSTEM } from "../../supabase/functions/concierge-chat/prompt";
import { applyPlanToItinerary, buildItinerary, itemsFromResponse, openAt, stayDays } from "@/lib/experiencias";

const AT = "2026-10-27T18:00:00.000Z";
const places = restFx.places.map((p) => normalizePlace(p, AT));
const byName = (n: string) => places.find((p) => p.name === n)!;
const book = (n: string) => {
  const p = byName(n);
  return restaurantBooking({ name: p.name, city: "Florencia", address: p.address, website: p.website, phone: p.phone, phoneInternational: p.phone_international, reservable: p.reservable });
};

describe("Google Places (New): campos reales para reservar, con su SKU", () => {
  it("el preset atmosphere pide reservable, sitio, teléfonos, serves* (con brunch), nivel de precio y horario; cobra Enterprise + Atmosphere", () => {
    const m = fieldMask("text", "atmosphere").split(",");
    for (const f of ["reservable", "websiteUri", "nationalPhoneNumber", "internationalPhoneNumber", "servesBreakfast", "servesBrunch", "servesLunch", "servesDinner", "priceLevel", "regularOpeningHours"]) {
      expect(m, f).toContain(`places.${f}`);
    }
    expect(skuFor("text", "atmosphere")).toBe("Text Search Enterprise + Atmosphere");
    // "rich" (lo demás) no paga Atmosphere.
    expect(fieldMask("text", "rich")).not.toMatch(/reservable|servesBrunch/);
  });
  it("places-search solo usa atmosphere en búsquedas de comida (cuida el costo)", () => {
    expect(placesSearchPreset({ query: "cena romántica en Florencia" })).toBe("atmosphere");
    expect(placesSearchPreset({ query: "trattoria cerca del Duomo" })).toBe("atmosphere");
    expect(placesSearchPreset({ query: "Galleria degli Uffizi" })).toBe("rich");
    expect(placesSearchPreset({ query: "farmacia", meal: "desayuno" })).toBe("atmosphere");
  });
  it("normaliza brunch, teléfono internacional y periodos de horario", () => {
    const uno = byName("Trattoria Uno");
    expect(uno.phone_international).toBe("+39 055 123 4567");
    expect(uno.serves).toMatchObject({ breakfast: false, brunch: false, lunch: true, dinner: true });
    expect(uno.opening_periods?.length).toBe(7);
    expect(byName("Caffè Due").phone_international).toBeNull();
  });
});

describe("botones de reserva en orden de confianza", () => {
  it("sitio → TheFork → Llamar → WhatsApp, con enlaces permitidos por la lista blanca", () => {
    const b = book("Trattoria Uno");
    expect(b.actions.map((a) => a.kind)).toEqual(["website", "thefork", "call", "whatsapp"]);
    expect(b.actions[0].label).toBe("Reservar en su sitio");
    const fork = new URL(b.actions[1].url);
    expect(fork.hostname).toBe("www.thefork.it");
    expect(fork.pathname).toBe("/search");
    expect(fork.searchParams.get("cityName")).toBe("Firenze");
    expect(fork.searchParams.get("searchText")).toBe("Trattoria Uno");
    expect(checkAllowlisted(b.actions[1].url).ok).toBe(true);
    expect(b.actions[2].url).toBe("tel:+390551234567");
    expect(b.actions[3].url).toBe("https://wa.me/390551234567");
    expect(checkAllowlisted(b.actions[3].url).ok).toBe(true);
    expect(b.note).toMatch(/Acepta reservaciones/);
  });
  it("sin número no hay Llamar ni WhatsApp; con número nacional solo Llamar", () => {
    const tre = book("Osteria Tre");
    expect(tre.actions.map((a) => a.kind)).toEqual(["website", "thefork"]);
    const due = book("Caffè Due");
    expect(due.actions.some((a) => a.kind === "whatsapp")).toBe(false);
    expect(due.actions.some((a) => a.kind === "call")).toBe(true);
  });
  it("reservable = false: «No toma reservaciones (llega directo)» y sin TheFork", () => {
    const due = book("Caffè Due");
    expect(due.note).toBe(NO_RESERVATIONS_NOTE);
    expect(due.actions.some((a) => a.kind === "thefork")).toBe(false);
  });
  it("fuera de los mercados de TheFork: OpenTable; sin ciudad: la de la dirección", () => {
    const mx = restaurantBooking({ name: "Contramar", city: "Ciudad de México", website: "https://contramar.com.mx" });
    expect(mx.actions.map((a) => a.kind)).toEqual(["website", "opentable"]);
    expect(cityFromAddress("Via dei Neri, 2, 50122 Firenze FI, Italia")).toBe("Firenze");
    const noCity = restaurantBooking({ name: "Trattoria Uno", address: "Via dei Neri, 2, 50122 Firenze FI, Italia" });
    expect(new URL(noCity.actions.find((a) => a.kind === "thefork")!.url).searchParams.get("cityName")).toBe("Firenze");
    expect(theforkSearchUrl("X", "", "IT")).toBeNull();
  });
  it("Iato: restaurantBookingLinks usa el mismo orden (y conserva OpenTable con fecha fuera de Europa)", () => {
    const it = restaurantBookingLinks({ name: "Trattoria Uno", city: "Florencia", website: "https://www.trattoriauno.example.it/", phone: "055 123 4567", phoneIntl: "+39 055 123 4567", reservable: true });
    expect(it.map((l) => l.label)).toEqual(["Reservar en su sitio", "Reservar en TheFork", "Llamar", "WhatsApp", "Buscar en Google Maps"]);
  });
});

describe("filtro por comida (serves* reales de Google)", () => {
  it("solo entran los que Google marca que sirven esa comida; sin dato no entra", () => {
    expect(filterByMeal(places, "desayuno").map((p) => p.name)).toEqual(["Caffè Due"]);
    expect(filterByMeal(places, "brunch").map((p) => p.name)).toEqual(["Caffè Due"]);
    expect(filterByMeal(places, "cena").map((p) => p.name)).toEqual(["Trattoria Uno", "Osteria Tre", "Pizzeria Quattro"]);
    expect(filterByMeal(places, "comida").map((p) => p.name)).toEqual(["Trattoria Uno", "Caffè Due", "Pizzeria Quattro"]);
    expect(mealFromText("cena romántica en Florencia el 14")).toBe("cena");
    expect(mealFromText("¿dónde desayunamos?")).toBe("desayuno");
  });
  it("places-search filtra con meal y dice cuántos quedaron", () => {
    const out = placesSearchOutput(places, { query: "desayuno en Florencia", meal: "desayuno", city: "Florencia" }, "atmosphere");
    expect(out.results.map((r) => r.name)).toEqual(["Caffè Due"]);
    expect(out.filtro_comida).toMatchObject({ comida: "desayuno", total_sin_filtro: 4, quedan: 1 });
    expect((out.results[0] as any).reserva.note).toBe(NO_RESERVATIONS_NOTE);
  });
});

describe("criterio TOP visible (números del proveedor)", () => {
  it("Google 4.5★ con 500 reseñas; si quedan menos de 3, 4.3★ con 200 y se dice", () => {
    const get = (p: (typeof places)[number]) => ({ rating: p.rating, reviews: p.user_rating_count });
    const t = topByRating(places, get, { strict: TOP_GOOGLE, relaxed: TOP_GOOGLE_RELAXED, source: "Google" });
    expect(t.relajado).toBe(false);
    expect(t.items.map((p) => p.name)).toEqual(["Trattoria Uno", "Caffè Due", "Osteria Tre"]);
    expect(t.aviso).toMatch(/4\.5★ o más con 500 reseñas/);
    const two = topByRating(places.slice(0, 2).concat(places[3]).map((p, i) => (i === 1 ? { ...p, user_rating_count: 300 } : p)), get, { strict: TOP_GOOGLE, relaxed: TOP_GOOGLE_RELAXED, source: "Google" });
    expect(two.relajado).toBe(true);
    expect(two.aviso).toMatch(/bajamos a 4\.3★ o más con 200 reseñas/);
  });
});

describe("taquillas oficiales de museos", () => {
  it("tiene los mínimos pedidos y cada URL es https, permitida por la lista blanca y con su alternativa de Viator", () => {
    const ids = OFFICIAL_TICKETS.map((t) => t.id);
    for (const id of ["musei-vaticani", "colosseo", "galleria-borghese", "cupola-san-pietro", "uffizi", "galleria-accademia", "duomo-firenze", "palazzo-pitti",
      "palazzo-ducale", "basilica-san-marco", "torre-pisa", "louvre", "sagrada-familia", "alhambra", "museo-prado"]) expect(ids, id).toContain(id);
    for (const t of OFFICIAL_TICKETS) {
      expect(t.taquilla_url.startsWith("https://"), t.id).toBe(true);
      expect(checkAllowlisted(t.taquilla_url).ok, t.taquilla_url).toBe(true);
      expect(checkAllowlisted(t.sitio_oficial).ok, t.sitio_oficial).toBe(true);
      expect(checkAllowlisted(viatorAlternativeUrl(t)).ok, t.id).toBe(true);
      // Una nota solo con su fuente oficial; "reserva obligatoria" solo si la fuente lo dice.
      if (t.nota) expect(t.nota_fuente, t.id).toMatch(/^https:\/\//);
      if (t.reserva_obligatoria) expect(t.nota ?? "", t.id).toMatch(/obligatoria/i);
      expect(t.verificacion.fecha).toBe("2026-10-27");
    }
    expect(OFFICIAL_TICKETS.find((t) => t.id === "galleria-borghese")!.reserva_obligatoria).toBe(true);
  });
  it("reconoce el museo por su nombre en Google, en italiano, inglés o español, y por ciudad", () => {
    expect(matchOfficialTicket("Galleria degli Uffizi")?.id).toBe("uffizi");
    expect(matchOfficialTicket("Cattedrale di Santa Maria del Fiore", "Florencia")?.id).toBe("duomo-firenze");
    expect(matchOfficialTicket("boletos para el Coliseo")?.id).toBe("colosseo");
    expect(matchOfficialTicket("Musei Vaticani", "Rome")?.id).toBe("musei-vaticani");
    expect(matchOfficialTicket("Galleria degli Uffizi", "Roma")).toBeNull();
    expect(matchOfficialTicket("Trattoria del Duomo")).toBeNull();
    expect(officialTicketsForCity("Firenze").map((t) => t.id)).toEqual(["uffizi", "galleria-accademia", "duomo-firenze", "palazzo-pitti"]);
  });
  it("las taquillas no vuelven sospechosos a restaurantes reales con nombres de monumentos", () => {
    for (const h of ["trattoriadelduomo.it", "hotelcolosseo.it", "ristoranteuffizi.it", "cafelouvre.fr"]) expect(looksLikeBrandImpersonation(h), h).toBe(false);
    expect(checkTrustedSource("https://www.trattoriadelduomo.it/").ok).toBe(true);
  });
});

// ─── "Lo TOP de {ciudad}" (experiencias-top) con fixtures ───

function fakeGoogle(log: string[]) {
  const f = async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body ?? "{}"));
    log.push(`${body.textQuery}|${(init.headers as Record<string, string>)["X-Goog-FieldMask"].includes("reservable") ? "atm" : "rich"}`);
    const src = /museos/.test(body.textQuery) ? museoFx : /Hotel/.test(body.textQuery) ? { places: [{ id: "ChIJhotel0000000000000001", displayName: { text: "Hotel" }, location: { latitude: 43.7700, longitude: 11.2500 } }] } : restFx;
    return new Response(JSON.stringify({ places: src.places }), { status: 200 });
  };
  return createGoogleTransport({ mapsKey: "AIzaFALSA000000000000000000", lovableKey: "LOVABLE_FALSA", fetch: f as unknown as typeof fetch })!;
}
const viatorOk = (q: string): ViatorResult => ({ ok: true, fuente: "Viator", source: "viator", results: mapViatorProducts(viatorFx.products, 12), consultado_at: AT, from_cache: false, moneda: "MXN", destino: { id: "519", nombre: "Florencia" }, ...(q ? {} : {}) });

describe("experiencias-top (runExperiencias)", () => {
  it("restaurantes TOP con botones, museos con taquilla y horario de Google, Viator TOP 4.6★/300, sin eventos sin fechas", async () => {
    const log: string[] = [];
    const vq: Array<Record<string, unknown>> = [];
    const out: any = await runExperiencias({ city: "Florencia" }, {
      transport: fakeGoogle(log), viator: async (a) => { vq.push(a); return viatorOk(String(a.query ?? "")); }, ticketmaster: null, now: () => Date.parse(AT),
    });
    expect(out.ok).toBe(true);
    expect(log).toEqual(expect.arrayContaining(["mejores restaurantes en Florencia|atm", "museos y monumentos en Florencia|rich"]));
    expect(out.restaurantes.items.map((r: any) => r.nombre)).toEqual(["Trattoria Uno", "Caffè Due", "Osteria Tre"]);
    expect(out.restaurantes.items[0].reserva.actions[1].kind).toBe("thefork");
    // Sin hotel: distancias al centro aproximado (y se dice).
    expect(out.ancla.tipo).toBe("centro_aprox");
    expect(out.ancla.nota).toMatch(/centro aproximado/);
    const uffizi = out.museos.items.find((m: any) => m.id === "uffizi");
    expect(uffizi.lugar.periodos.length).toBe(6);
    expect(uffizi.taquilla_oficial).toBe("https://tickets.uffizi.it/");
    expect(out.museos.items.find((m: any) => m.id === "galleria-accademia").lugar).toBeNull();
    expect(out.tours.results.map((t: any) => t.codigo)).toEqual(["FLR-COCINA", "FLR-VINO"]);
    expect(out.tours.aviso).toMatch(/4\.6★ o más con 300 reseñas o más en Viator\. Solo 2 cumplen/);
    expect(out.wow.consultas).toEqual(wowQueries("Florencia"));
    expect(vq.map((a) => a.query ?? null)).toEqual([null, "cata de vino Toscana", "clase de cocina"]);
    expect(out.eventos.ok).toBe(false);
  });
  it("con hotel por nombre: lo ubica en Google y mide desde ahí; la consulta «cena romántica» va tal cual", async () => {
    const log: string[] = [];
    const out: any = await runExperiencias({ city: "Florencia", hotel: { nombre: "Hotel Prueba" }, query: "cena romántica", blocks: ["restaurantes"] }, {
      transport: fakeGoogle(log), viator: async () => viatorOk(""), now: () => Date.parse(AT),
    });
    expect(log[0]).toMatch(/^Hotel Prueba, Florencia\|rich/);
    expect(log).toContain("cena romántica en Florencia|atm");
    expect(out.ancla.tipo).toBe("hotel");
    expect(out.restaurantes.consulta).toBe("cena romántica en Florencia");
    expect(out.restaurantes.items[0].distancia_km).toBeGreaterThan(0);
    expect(out.museos).toBeUndefined();
  });
});

// ─── Itinerario día por día ───

describe("itinerario por día (cercanía y horario real)", () => {
  const data: any = {
    restaurantes: { items: places.slice(0, 3).map((p, i) => ({ place_id: p.place_id, nombre: p.name, lat: p.lat, lng: p.lng, distancia_km: [0.4, 0.2, 0.9][i], rating: p.rating, resenas: p.user_rating_count, sirve: { desayuno: p.serves.breakfast, brunch: p.serves.brunch, comida: p.serves.lunch, cena: p.serves.dinner }, periodos: p.opening_periods })) },
    museos: { items: [{ id: "uffizi", nombre: "Galería Uffizi", taquilla_oficial: "https://tickets.uffizi.it/", distancia_km: 0.3, lugar: { lat: 43.76, lng: 11.25, periodos: normalizePlace(museoFx.places[0], AT).opening_periods } }] },
    tours: { results: [{ codigo: "FLR-COCINA", title: "Clase de cocina toscana", url: "https://www.viator.com/tours/x", rating: 4.9, resenas: 4200 }] },
    wow: { results: [] }, eventos: { results: [] },
  };
  const items = itemsFromResponse(data, "Florencia");
  it("un museo que cierra ese día (lunes) no se pone ahí y se dice; los restaurantes van según serves*", () => {
    // 2026-11-16 es lunes (Uffizi cerrado); 2026-11-17 martes.
    const plan = buildItinerary([...items.restaurante, ...items.museo, ...items.tour], stayDays("2026-11-16", "2026-11-18"));
    const lunes = plan.days[0];
    expect(lunes.slots.find((s) => s.slot === "manana")!.item?.title).toBe("Clase de cocina toscana");
    expect(plan.avisos.join(" ")).toMatch(/Galería Uffizi cierra el lunes 16 nov/);
    expect(plan.days[1].slots.find((s) => s.slot === "manana")!.item?.title).toBe("Galería Uffizi");
    expect(lunes.slots.find((s) => s.slot === "desayuno")!.item?.title).toBe("Caffè Due");
    // Comida: el más cercano que sirve comida (Caffè Due ya se usó en el desayuno).
    expect(lunes.slots.find((s) => s.slot === "comida")!.item?.title).toBe("Trattoria Uno");
    expect(lunes.slots.find((s) => s.slot === "cena")!.item?.title).toBe("Osteria Tre");
    expect(openAt(items.museo[0].periods, 1, "10:30")).toBe(false);
    expect(openAt(items.museo[0].periods, 2, "10:30")).toBe(true);
  });
  it("se guarda como agregados del día (fuente experiencias), reemplaza los anteriores de esa ciudad y no toca los de Iato", () => {
    const plan = buildItinerary(items.restaurante, stayDays("2026-11-17", "2026-11-18"));
    const prev = { multi: true, destinations: ["Roma", "Florencia"], days: [{ dia: 4, fecha: "2026-11-17", ciudad: "Florencia", titulo: "Florencia", agregados: [
      { titulo: "Cena con Iato", agregado_por: "iato" }, { titulo: "Viejo", fuente: "experiencias", ciudad: "Florencia" }] }] };
    const next: any = applyPlanToItinerary(prev, { fecha_salida: "2026-11-14" }, "Florencia", plan, true);
    const ag = next.days[0].agregados;
    expect(ag.some((a: any) => a.titulo === "Viejo")).toBe(false);
    expect(ag.some((a: any) => a.titulo === "Cena con Iato")).toBe(true);
    expect(ag.filter((a: any) => a.fuente === "experiencias").map((a: any) => a.titulo)).toEqual(["Desayuno: Caffè Due", "Comida: Trattoria Uno", "Cena: Osteria Tre"]);
    expect(ag.every((a: any) => a.fuente !== "experiencias" || /No es una reserva/.test(a.nota))).toBe(true);
  });
  it("sin fechas en el viaje: días sin fecha y no se guarda nada por día", () => {
    const plan = buildItinerary(items.restaurante, stayDays(null, null, 1));
    expect(plan.days[0].fecha).toBeNull();
    const next: any = applyPlanToItinerary([], {}, "Florencia", plan, false);
    expect(next).toEqual([]);
  });
});

// ─── Iato: nunca "reservado" y cards reales con estos botones ───

describe("Iato no dice «reservado» y arma las cards con los botones reales", () => {
  it("quita «te reservé», «ya tienes mesa» y «¡Listo, reservado!»; deja preguntas y condicionales", () => {
    for (const t of ["Listo, te reservé una mesa en Trattoria Uno para el 14.", "Ya tienes mesa en Osteria Tre a las 20:30.", "¡Listo, reservado! Te espero.", "Te conseguí boletos para los Uffizi."]) {
      const out = enforceNoFakeBooking(t);
      expect(out, t).toContain(NOT_BOOKED_LINE);
      expect(out, t).not.toMatch(/te reserv[eé]|tienes mesa|listo, reservado|te consegu/i);
    }
    expect(enforceNoFakeBooking("¿Ya tienes boletos para el Vaticano?")).toBe("¿Ya tienes boletos para el Vaticano?");
    expect(enforceNoFakeBooking("Si ya tienes tus boletos, llega 15 minutos antes.")).toBe("Si ya tienes tus boletos, llega 15 minutos antes.");
    expect(SYSTEM).toMatch(/te reservé/);
    expect(SYSTEM).toMatch(/No toma reservaciones \(llega directo\)/);
  });
  it("«cena romántica en Florencia el 14» → search_places con esa consulta, cena y la ciudad", () => {
    const msg = "cena romántica en Florencia el 14";
    const plan = planTurn({ message: msg, intents: detectIntents(msg), todayISO: "2026-10-27", trip: null, requested: "Florencia" } as any);
    const sp = plan.prefetch.find((p) => p.name === "search_places")!;
    expect(sp.args).toMatchObject({ query: "cena romántica en Florencia", meal: "cena", city: "Florencia" });
  });
  it("plan de luna de miel: desayunos, cenas, tours y museos con taquilla oficial", () => {
    const msg = "plan de luna de miel en Florencia: desayunos, cenas, museos y experiencias wow";
    const plan = planTurn({ message: msg, intents: detectIntents(msg), todayISO: "2026-10-27", trip: null, requested: "Florencia" } as any);
    expect(detectIntents(msg)).toContain("honeymoon_plan");
    const names = plan.prefetch.map((p) => `${p.name}:${p.args.meal ?? p.args.city ?? ""}`);
    expect(names).toEqual(expect.arrayContaining(["search_places:desayuno", "search_places:cena", "search_tours:Florencia"]));
    expect(plan.notes.join(" ")).toMatch(/Galería Uffizi/);
  });
  it("cards: restaurante con sitio, TheFork, llamar y WhatsApp; sin reservaciones lo dice; museo con boletos oficiales", () => {
    const res = placesSearchOutput(places, { query: "cena romántica en Florencia", city: "Florencia" }, "atmosphere");
    const ev = collectEvidence([{ name: "search_places", args: { query: "cena romántica en Florencia", city: "Florencia" }, result: res as any }]);
    const cards = enrichCardLinks([
      { type: "restaurant", title: "Trattoria Uno" }, { type: "restaurant", title: "Caffè Due" }, { type: "attraction", title: "Galería Uffizi", subtitle: "Florencia" },
    ], ev, { directions: () => "https://www.google.com/maps/dir/?api=1&destination=x", ride: () => "https://m.uber.com/ul/?action=setPickup", booking: (v) => restaurantBookingLinks(v) as any }, { city: "Roma" });
    expect(cards[0].links!.map((l) => l.label).slice(0, 4)).toEqual(["Reservar en su sitio", "Reservar en TheFork", "Llamar", "WhatsApp"]);
    // La ciudad sale de la búsqueda (Florencia), no del viaje en contexto (Roma).
    expect(new URL(cards[0].links![1].url).searchParams.get("cityName")).toBe("Firenze");
    expect(cards[1].booking_note).toBe(NO_RESERVATIONS_NOTE);
    expect(cards[1].links!.some((l) => /TheFork/.test(l.label))).toBe(false);
    expect(cards[2].links!.slice(0, 2).map((l) => l.label)).toEqual(["Boletos oficiales", "Con guía o sin fila en Viator"]);
    expect(cards[2].links![0].url).toBe("https://tickets.uffizi.it/");
  });
});

describe("Viator TOP (fixture)", () => {
  it("mapViatorProducts respeta el tamaño pedido", () => {
    expect(mapViatorProducts(viatorFx.products, 2).length).toBe(2);
    expect(mapViatorProducts(viatorFx.products, 12).length).toBe(4);
  });
});
