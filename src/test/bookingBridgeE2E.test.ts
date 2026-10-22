// Fase 11: los 20 recorridos del dueño, de punta a punta con el handler real de booking-bridge, el de
// booking-go y un almacén en memoria que imita las reglas SQL (las reglas reales se prueban en
// supabase/tests/bridge/bridge.sql). Proveedores simulados: nunca se compra ni se reserva nada.
import { describe, expect, it } from "vitest";
import { type BridgeDeps, handleBridge, type TripRow } from "../../supabase/functions/booking-bridge/handler";
import { resolveGo } from "../../supabase/functions/booking-go/go";
import { signRedirect } from "../../supabase/functions/_shared/booking/redirectToken";
import { canTransition } from "../../supabase/functions/_shared/booking/states";
import { venueFromPriveRow } from "../../supabase/functions/_shared/booking/offers";
import { parseAviasalesSearch } from "../../supabase/functions/_shared/booking/links";
import type { RecheckResult } from "../../supabase/functions/_shared/booking/recheck";

const USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const TRIP_ID = "11111111-1111-4111-8111-111111111111";
const SECRET = "service-key-de-prueba";
const NOW = Date.parse("2026-10-22T12:00:00Z");

const TRIP: TripRow = {
  id: TRIP_ID, user_id: USER, destino: "Madrid", pais_destino: "España", ciudad_origen: "Ciudad de México",
  fecha_salida: "2026-12-05", fecha_regreso: "2026-12-12", num_viajeros: 2, created_at: "2026-10-22T10:00:00Z",
  vuelos_json: [{ aerolinea: "Iberia", tier: "equilibrio", duracion: "10h 40m", escalas: "Directo", precio_por_persona: 21000, fuente_precio: "travelpayouts",
    booking_link: "https://www.aviasales.com/search/MEX0111MAD08112?marker=533299" }],
  hospedaje_json: [{ nombre: "Hotel Urban", barrio: "Centro", precio_por_noche: 4200, fuente_precio: "serpapi" }],
  tours_json: [{ nombre: "Tour del Museo del Prado", precio_por_persona: 900, fuente: "tripadvisor" }],
  restaurantes_json: [{ nombre: "Botín", cocina: "Castellana", cta_action: "https://www.google.com/maps/search/?api=1&query=Botin" },
    { nombre: "Quintonil", cocina: "Mexicana" }],
};

type Intent = Record<string, any>;

/** Almacén en memoria con las mismas reglas que las funciones SQL booking_intent_*. */
function makeStore() {
  const intents: Intent[] = [];
  const requests: Array<Record<string, unknown>> = [];
  const json = (i: Intent) => ({ ...i, confirmed: i.state === "CONFIRMED" });
  const rpc = async (fn: string, a: any) => {
    if (fn === "booking_intent_start") {
      const p = a._p;
      const byKey = intents.find((i) => i.user_id === a._user && i.idempotency_key === p.idempotency_key);
      if (byKey) return { data: { ok: true, replay: true, intent: json(byKey) }, error: null };
      const live = intents.find((i) => i.user_id === a._user && i.offer_id === p.offer_id && !["FAILED", "CANCELLED", "EXPIRED"].includes(i.state));
      if (live) return { data: { ok: true, existing: true, already_confirmed: live.state === "CONFIRMED", intent: json(live) }, error: null };
      if (p.target_url && !String(p.target_url).startsWith("https://")) return { data: null, error: { message: "check" } };
      const row = { id: crypto.randomUUID(), user_id: a._user, verification: "none", redirect_count: 0, user_report: null, ...p };
      intents.push(row);
      return { data: { ok: true, intent: json(row) }, error: null };
    }
    if (fn === "booking_intent_transition") {
      const i = intents.find((x) => x.id === a._id && (a._user == null || x.user_id === a._user));
      if (!i) return { data: { ok: false, code: "NOT_FOUND" }, error: null };
      const to = a._to ?? i.state;
      if (to === "CONFIRMED" || ["provider_verified", "team_verified"].includes(a._patch?.verification)) return { data: { ok: false, code: "CONFIRMATION_REQUIRES_EVIDENCE" }, error: null };
      if (to !== i.state && !canTransition(i.state, to)) return { data: { ok: false, code: "ILLEGAL_TRANSITION" }, error: null };
      Object.assign(i, { state: to }, a._patch ?? {});
      return { data: { ok: true, intent: json(i) }, error: null };
    }
    if (fn === "booking_intent_mark_redirected") {
      const i = intents.find((x) => x.id === a._id && x.user_id === a._user);
      if (!i) return { data: { ok: false, code: "NOT_FOUND" }, error: null };
      if (!["READY_TO_BOOK", "REDIRECTED_TO_PROVIDER", "PENDING_CONFIRMATION", "CONFIRMED"].includes(i.state)) return { data: { ok: false, code: "NOT_READY" }, error: null };
      if (i.state === "READY_TO_BOOK") i.state = "REDIRECTED_TO_PROVIDER";
      i.redirect_count++;
      return { data: { ok: true, target_url: i.target_url, trip_id: i.trip_id, state: i.state }, error: null };
    }
    return { data: null, error: { message: `rpc ${fn} no simulada` } };
  };
  return { intents, requests, rpc };
}

type Opts = {
  trip?: TripRow;
  venues?: Record<string, ReturnType<typeof venueFromPriveRow>>;
  recheck?: RecheckResult;
  userRpc?: BridgeDeps["userRpc"];
  now?: number;
};

function setup(o: Opts = {}) {
  const store = makeStore();
  const mails: string[] = [];
  const deps: BridgeDeps = {
    userId: USER, userLabel: "ana@example.test", now: () => o.now ?? NOW,
    loadTrip: async (id) => (id === TRIP_ID ? (o.trip ?? TRIP) : null),
    venueLookup: async ({ name, slug }) => (slug ? o.venues?.[slug] : o.venues?.[String(name)]) ?? null,
    rpc: store.rpc,
    userRpc: o.userRpc ?? (async () => ({ data: null, error: { message: "sin sesión" } })),
    listIntents: async (f) => store.intents.filter((i) => i.user_id === USER && (!f.id || i.id === f.id) && (!f.trip_id || i.trip_id === f.trip_id)),
    createAssistRequest: async (row) => { const id = crypto.randomUUID(); store.requests.push({ id, ...row }); return id; },
    notifyTeam: async (subject) => { mails.push(subject); return true; },
    tripDocumentOk: async (docId) => docId === "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    recheckFlight: async () => o.recheck ?? { ok: false, code: "RECHECK_UNAVAILABLE", message: "x" },
    recheckHotel: async () => o.recheck ?? { ok: false, code: "RECHECK_UNAVAILABLE", message: "x" },
    goUrl: async (intentId) => {
      const t = await signRedirect(SECRET, { i: intentId, u: USER, o: "https://traveliatos.life" }, o.now ?? NOW);
      return `https://example.supabase.co/functions/v1/booking-go?t=${encodeURIComponent(t!)}`;
    },
  };
  const go = (url: string, user = USER) => resolveGo(url, {
    secret: SECRET, now: () => (o.now ?? NOW) + 1000,
    markRedirected: async (i, u) => (await store.rpc("booking_intent_mark_redirected", { _id: i, _user: u === USER ? user : u })).data,
  });
  const call = (action: string, body: any) => handleBridge(action, body, deps);
  return { store, mails, deps, call, go };
}

const tripItem = (col: string, index: number, name?: string) => ({ type: "trip_item", trip_id: TRIP_ID, col, index, name });
let n = 0;
const key = () => `idem-${Date.now()}-${n++}`;

const SERP_FLIGHT = {
  result: { airline: "Aeroméxico", price_usd: 1850, stops: 2, duration: "19h 5m", booking_token: "WyJDalJJ",
    departure: { id: "MEX", time: "2026-12-05 07:00" }, arrival: { id: "MAD", time: "2026-12-06 08:05" }, airline_buy_url: "https://aeromexico.com" },
  meta: { dep_iata: "MEX", arr_iata: "MAD", depart: "2026-12-05", return_date: "2026-12-12", travelers: 2, consulted_at: "2026-10-22T11:30:00Z", source: "serpapi",
    google_flights_url: "https://www.google.com/travel/flights?tfs=CBwQAhoeEgoyMDI2LTEyLTA1" },
};

describe("Fase 11 · los 20 recorridos E2E (simulados, sin compras reales)", () => {
  it("1 · cotización de vuelo → botón honesto → salida al proveedor correcto con fechas y viajeros", async () => {
    const t = setup();
    const list = await t.call("list_offers_for_trip", { trip_id: TRIP_ID });
    const fl = (list.body.offers as any).vuelos_json[0];
    expect(fl.actions.map((a: any) => a.label)).not.toContain("Comprar esta oferta");
    expect(fl.actions[0].label).toBe("Buscar este vuelo");
    const r = await t.call("start_booking", { source: tripItem("vuelos_json", 0, "Iberia"), action_kind: "equivalent_search", idempotency_key: key(), consent: true });
    expect(r.body).toMatchObject({ ok: true, processor: "Aviasales", intent: { state: "READY_TO_BOOK" } });
    expect((r.body.disclosures as string[])).toContain("El precio puede cambiar al continuar en el proveedor.");
    const g = await t.go(String(r.body.go_url));
    expect(parseAviasalesSearch(g.location)).toEqual({ origin: "MEX", destination: "MAD", depart: "0512", ret: "1212", adults: 2 });
    expect(t.store.intents[0].state).toBe("REDIRECTED_TO_PROVIDER");
  });

  it("2 · vuelo con dos escalas: se conservan escalas y se ofrece búsqueda + comprobar precio", async () => {
    const t = setup();
    const r = await t.call("resolve", { source: { type: "flight_result", ...SERP_FLIGHT } });
    const offer = r.body.offer as any;
    expect(offer.subtitle).toBe("19h 5m · 2 escalas");
    expect(offer.actions.map((a: any) => a.kind)).toEqual(["recheck_price", "equivalent_search", "equivalent_search", "official_website", "save_for_later"]);
    expect(offer.actions.find((a: any) => a.kind === "official_website").label).toBe("Sitio de Aeroméxico");
  });

  it("3 · cambio de fechas: el enlace viejo se descarta y la búsqueda usa las fechas nuevas del viaje", async () => {
    const t = setup();
    const r = await t.call("resolve", { source: tripItem("vuelos_json", 0) });
    const o = r.body.offer as any;
    expect(o.rejected[0].reason).toBe("fechas_o_viajeros_distintos_al_viaje");
    expect(o.actions[0].url).toContain("MEX0512MAD12122");
  });

  it("4 · oferta caducada: pide comprobar el precio o aceptar que el proveedor mostrará el final", async () => {
    const t = setup({ now: Date.parse("2026-10-22T20:00:00Z") });
    const r = await t.call("start_booking", { source: { type: "flight_result", ...SERP_FLIGHT }, action_kind: "equivalent_search", idempotency_key: key(), consent: true });
    expect(r.body).toMatchObject({ needs_price_ack: true, go_url: null, intent: { state: "PRICE_RECHECK_REQUIRED" } });
    const ack = await t.call("confirm_price_ack", { intent_id: (r.body.intent as any).id });
    expect(ack.body).toMatchObject({ ok: true, intent: { state: "READY_TO_BOOK" } });
    expect(String(ack.body.go_url)).toContain("booking-go?t=");
  });

  it("5 · precio diferente en el proveedor: se informa y se actualiza la foto de la intención", async () => {
    const recheck: RecheckResult = { ok: true, checked_at: "2026-10-22T12:00:00Z", availability: "available_at_check", price: 1990, currency: "USD", options: [],
      price_change: { changed: true, direction: "up", old: 1850, new: 1990, delta: 140, pct: 7.6 }, room_match: "not_selected", cached: false };
    const t = setup({ recheck });
    const s = await t.call("start_booking", { source: { type: "flight_result", ...SERP_FLIGHT }, action_kind: "equivalent_search", idempotency_key: key(), consent: true });
    const r = await t.call("recheck_price", { source: { type: "flight_result", ...SERP_FLIGHT }, intent_id: (s.body.intent as any).id });
    expect(r.body.recheck).toMatchObject({ price_change: { direction: "up", delta: 140 } });
    expect(t.store.intents[0]).toMatchObject({ price: 1990, price_checked_at: "2026-10-22T12:00:00Z", state: "READY_TO_BOOK" });
  });

  const HOTEL = { result: { name: "Hotel Urban", total_usd: 1400, property_token: "ChoQ5YiT", link: "https://www.hotelurban.com" },
    meta: { city: "Madrid", checkin: "2026-12-05", checkout: "2026-12-07", adults: 2, consulted_at: "2026-10-22T11:00:00Z", source: "serpapi" } };

  it("6 · hotel con disponibilidad al comprobar: tarifas con fechas y huéspedes", async () => {
    const t = setup({ recheck: { ok: true, checked_at: "2026-10-22T12:00:00Z", availability: "available_at_check", price: 1400, currency: "USD",
      options: [{ seller: "Booking.com", price: 1400, currency: "USD", url: "https://www.google.com/aclk?sa=l&ai=x" }],
      price_change: { changed: false, direction: "same", old: 1400, new: 1400, delta: 0, pct: 0 }, room_match: "not_selected", cached: false } });
    const r = await t.call("recheck_price", { source: { type: "hotel_result", ...HOTEL } });
    expect(r.body.recheck).toMatchObject({ availability: "available_at_check" });
    const o = (await t.call("resolve", { source: { type: "hotel_result", ...HOTEL } })).body.offer as any;
    expect(o.actions.find((a: any) => a.kind === "equivalent_search").label).toBe("Ver tarifas del hotel");
  });

  it("7 · hotel agotado: la intención queda FAILED (no se manda a reservar)", async () => {
    const t = setup({ recheck: { ok: true, checked_at: "2026-10-22T12:00:00Z", availability: "sold_out", price: null, currency: "USD", options: [],
      price_change: { changed: false, direction: "unknown", old: 1400, new: null, delta: null, pct: null }, room_match: "not_selected", cached: false } });
    const s = await t.call("start_booking", { source: { type: "hotel_result", ...HOTEL }, action_kind: "equivalent_search", idempotency_key: key(), consent: true });
    await t.call("recheck_price", { source: { type: "hotel_result", ...HOTEL }, intent_id: (s.body.intent as any).id });
    expect(t.store.intents[0].state).toBe("FAILED");
  });

  it("8 · habitación incorrecta: no se ofrece el enlace de esa habitación", async () => {
    const t = setup({ recheck: { ok: true, checked_at: "2026-10-22T12:00:00Z", availability: "available_at_check", price: 1400, currency: "USD",
      options: [{ seller: "Booking.com", price: 1400, currency: "USD", url: "https://www.google.com/aclk?sa=l&ai=x", room: null }],
      price_change: { changed: false, direction: "same", old: 1400, new: 1400, delta: 0, pct: 0 }, room_match: "mismatch", cached: false } });
    const r = await t.call("recheck_price", { source: { type: "hotel_result", ...HOTEL }, room: "Suite Junior" });
    expect((r.body.recheck as any).room_match).toBe("mismatch");
    expect((r.body.recheck as any).options.every((x: any) => !x.room)).toBe(true);
  });

  const QUINTONIL = venueFromPriveRow({ id: "e1", slug: "cdmx-quintonil", name: "Quintonil", website: "https://quintonil.com",
    booking_url: "https://www.exploretock.com/quintonil", booking_method: "tock", verified_at: "2026-10-22" }, "Ciudad de México", "MX");

  it("9 · restaurante con sistema de reservas (Tock): 'Abrir reservas' y salida a su página pública", async () => {
    const t = setup({ venues: { Quintonil: QUINTONIL } });
    const s = await t.call("start_booking", { source: tripItem("restaurantes_json", 1, "Quintonil"), action_kind: "official_booking_page", idempotency_key: key(), consent: true });
    expect(s.body).toMatchObject({ processor: "Tock", intent: { state: "READY_TO_BOOK" } });
    expect((await t.go(String(s.body.go_url))).location).toBe("https://www.exploretock.com/quintonil");
  });

  it("10 · restaurante sin sistema: búsqueda de mesa + solicitud asistida al equipo (REQUESTED, no reserva)", async () => {
    const t = setup();
    const o = (await t.call("resolve", { source: tripItem("restaurantes_json", 0) })).body.offer as any;
    expect(o.actions.map((a: any) => a.label)).toEqual(["Buscar mesa", "Ver en Google Maps", "Solicitar asistencia", "Guardar en el viaje"]);
    const s = await t.call("start_booking", { source: tripItem("restaurantes_json", 0), action_kind: "assisted_request", idempotency_key: key(), consent: true,
      draft: { date: "2026-12-06", time: "21:00", party_size: 2 } });
    expect(s.body).toMatchObject({ ok: true, intent: { state: "REQUESTED", status_text: "Solicitud enviada · aún no es una reserva" } });
    expect(t.store.requests).toHaveLength(1);
    expect(t.mails[0]).toMatch(/Solicitud de asistencia/);
  });

  it("11 · tour con compra externa: 'Buscar en GetYourGuide' (búsqueda), nunca 'Reservar'", async () => {
    const t = setup();
    const o = (await t.call("resolve", { source: tripItem("tours_json", 0) })).body.offer as any;
    expect(o.actions[0]).toMatchObject({ label: "Buscar en GetYourGuide", mode: "PROVIDER_SEARCH" });
    const s = await t.call("start_booking", { source: tripItem("tours_json", 0), action_kind: "equivalent_search", idempotency_key: key(), consent: true });
    expect((await t.go(String(s.body.go_url))).location).toMatch(/^https:\/\/www\.getyourguide\.com\/s\/\?q=Tour%20del%20Museo%20del%20Prado%20Madrid/);
  });

  it("12 · experiencia Privé con solicitud: usa prive_request_create y queda REQUESTED", async () => {
    let args: any = null;
    const t = setup({ venues: { "cdmx-quintonil": QUINTONIL }, userRpc: async (fn, a) => { args = { fn, ...a }; return { data: { ok: true, id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" }, error: null }; } });
    const s = await t.call("start_booking", { source: { type: "venue", name: "Quintonil", prive_slug: "cdmx-quintonil", product_type: "experience" },
      action_kind: "prive_request", idempotency_key: key(), consent: true, draft: { date: "2026-12-06", time: "20:00", party_size: 2 } });
    expect(args).toMatchObject({ fn: "prive_request_create", _experience_id: "e1", _party_size: 2 });
    expect(s.body).toMatchObject({ intent: { state: "REQUESTED", concierge_request_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" } });
  });

  it("13 · usuario que abandona la compra: 'No la completé' vuelve a READY_TO_BOOK", async () => {
    const t = setup();
    const s = await t.call("start_booking", { source: tripItem("vuelos_json", 0), action_kind: "equivalent_search", idempotency_key: key(), consent: true });
    await t.go(String(s.body.go_url));
    const r = await t.call("mark_returned", { intent_id: (s.body.intent as any).id, outcome: "not_completed" });
    expect(r.body).toMatchObject({ intent: { state: "READY_TO_BOOK" } });
  });

  it("14 · usuario que vuelve a IATOS: el estado dice que aún no sabemos si compró", async () => {
    const t = setup();
    const s = await t.call("start_booking", { source: tripItem("hospedaje_json", 0), action_kind: "equivalent_search", idempotency_key: key(), consent: true });
    await t.go(String(s.body.go_url));
    const st = await t.call("status", { trip_id: TRIP_ID });
    expect((st.body.intents as any[])[0].status_text).toBe("Abriste Booking.com · aún no sabemos si completaste la compra");
  });

  it("15 · usuario que aporta comprobante: declarada por él, sin verificar; tarjetas rechazadas", async () => {
    const t = setup();
    const s = await t.call("start_booking", { source: tripItem("hospedaje_json", 0), action_kind: "equivalent_search", idempotency_key: key(), consent: true });
    await t.go(String(s.body.go_url));
    const id = (s.body.intent as any).id;
    expect((await t.call("attach_user_proof", { intent_id: id, confirmation_code: "4111 1111 1111 1111", consent: true })).body.code).toBe("CARD_DATA_REJECTED");
    expect((await t.call("attach_user_proof", { intent_id: id, confirmation_code: "BK-123" })).body.code).toBe("CONSENT_REQUIRED");
    expect((await t.call("attach_user_proof", { intent_id: id, trip_document_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", consent: true })).body.code).toBe("BAD_DOCUMENT");
    const r = await t.call("attach_user_proof", { intent_id: id, confirmation_code: "BK-123", trip_document_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", consent: true });
    expect(r.body).toMatchObject({ intent: { state: "PENDING_CONFIRMATION", verification: "user_declared",
      status_text: "Reserva declarada por ti · sin verificar con Booking.com", user_report: { confirmation_code: "BK-123" } } });
    expect((r.body.intent as any).confirmed).toBe(false);
  });

  it("16 · integración sin API: no se puede comprobar el precio de una tarifa de caché", async () => {
    const t = setup();
    const r = await t.call("recheck_price", { source: { type: "flight_result", result: { ...SERP_FLIGHT.result, booking_token: null }, meta: { ...SERP_FLIGHT.meta, source: "travelpayouts" } } });
    expect(r.body.code).toBe("NOT_RECHECKABLE");
    const tr = await t.call("recheck_price", { source: tripItem("vuelos_json", 0) });
    expect(tr.body.code).toBe("NOT_RECHECKABLE");
  });

  it("17 · proveedor caído: se dice, no se inventa precio, la intención no cambia", async () => {
    const t = setup({ recheck: { ok: false, code: "PROVIDER_DOWN", message: "La fuente del precio no respondió." } });
    const s = await t.call("start_booking", { source: { type: "flight_result", ...SERP_FLIGHT }, action_kind: "equivalent_search", idempotency_key: key(), consent: true });
    const r = await t.call("recheck_price", { source: { type: "flight_result", ...SERP_FLIGHT }, intent_id: (s.body.intent as any).id });
    expect(r.body.recheck).toMatchObject({ ok: false, code: "PROVIDER_DOWN" });
    expect(t.store.intents[0]).toMatchObject({ state: "READY_TO_BOOK", price: 1850 });
  });

  it("18 · link roto: el enlace marcado roto no se ofrece; queda una alternativa honesta", async () => {
    const broken = venueFromPriveRow({ id: "e3", slug: "x", name: "Quintonil", website: "https://quintonil.com", booking_url: "https://www.exploretock.com/quintonil",
      booking_url_status: "broken" }, "Ciudad de México", "MX");
    const t = setup({ venues: { Quintonil: broken } });
    const o = (await t.call("resolve", { source: tripItem("restaurantes_json", 1) })).body.offer as any;
    expect(o.actions.find((a: any) => a.kind === "official_booking_page")).toBeUndefined();
    expect(o.actions[0]).toMatchObject({ kind: "equivalent_search", label: "Buscar mesa" });
    const s = await t.call("start_booking", { source: tripItem("restaurantes_json", 1), action_kind: "official_booking_page", idempotency_key: key(), consent: true });
    expect(s.body.code).toBe("ACTION_UNAVAILABLE");
  });

  it("19 · URL manipulada: ni el cliente ni un token alterado pueden mandar a otro dominio", async () => {
    const t = setup();
    const evil = await t.call("resolve", { source: { type: "flight_result", result: SERP_FLIGHT.result,
      meta: { ...SERP_FLIGHT.meta, google_flights_url: "https://evil.example/travel/flights" } } });
    expect(JSON.stringify(evil.body.offer)).not.toContain("evil.example");
    const s = await t.call("start_booking", { source: tripItem("vuelos_json", 0), action_kind: "equivalent_search", idempotency_key: key(), consent: true });
    const tampered = String(s.body.go_url).replace(/.$/, (c) => (c === "A" ? "B" : "A"));
    expect((await t.go(tampered)).location).toBe("https://traveliatos.life/dashboard/reservas?salida=enlace_invalido");
    expect((await t.go("https://example.supabase.co/functions/v1/booking-go?u=https://evil.example")).location).toContain("traveliatos.life");
    // Otro usuario con el enlace firmado de este: no le sirve.
    const other = await resolveGo(String(s.body.go_url), { secret: SECRET, now: () => NOW,
      markRedirected: async (i) => (await t.store.rpc("booking_intent_mark_redirected", { _id: i, _user: OTHER })).data });
    expect(other.location).toContain("traveliatos.life");
    // Si la opción del viaje cambió entre que se pintó y se tocó, no se reserva otra.
    expect((await t.call("start_booking", { source: tripItem("vuelos_json", 0, "Volaris"), action_kind: "equivalent_search", idempotency_key: key(), consent: true })).body.code).toBe("ITEM_CHANGED");
    // Destino guardado que ya no pasa las reglas (p. ej. dominio que imita una marca): se bloquea.
    t.store.intents[0].target_url = "https://booking.com.evil.io/x";
    expect((await t.go(String(s.body.go_url))).location).toContain("salida=destino_bloqueado");
  });

  it("20 · compras repetidas y estados duplicados: una sola intención viva y reabrir no duplica", async () => {
    const t = setup();
    const a = await t.call("start_booking", { source: tripItem("vuelos_json", 0), action_kind: "equivalent_search", idempotency_key: key(), consent: true });
    const b = await t.call("start_booking", { source: tripItem("vuelos_json", 0), action_kind: "equivalent_search", idempotency_key: key(), consent: true });
    expect((b.body.intent as any).id).toBe((a.body.intent as any).id);
    expect(b.body.existing).toBe(true);
    await t.go(String(a.body.go_url));
    await t.go(String(a.body.go_url));
    expect(t.store.intents).toHaveLength(1);
    expect(t.store.intents[0]).toMatchObject({ state: "REDIRECTED_TO_PROVIDER", redirect_count: 2 });
    expect((await t.call("start_booking", { source: tripItem("vuelos_json", 0), action_kind: "equivalent_search", idempotency_key: key() })).body.code).toBe("CONSENT_REQUIRED");
  });
});

describe("restaurante con datos de Google Places (googlemax) en el viaje", () => {
  const PLACES_TRIP: TripRow = { ...TRIP, restaurantes_json: [{ nombre: "Sobrino de Botín", fuente: "google_places", place_id: "ChIJx5Rc1n0oQg0R5B1hVIKdWUU",
    website: "https://botin.es/", telefono: "+34 913 66 42 17", maps_url: "https://maps.google.com/?cid=1", consultado_at: "2026-10-22T10:00:00Z" }] };
  it("sitio y teléfono oficiales, ficha exacta de Maps; WhatsApp no (no verificado)", async () => {
    const t = setup({ trip: PLACES_TRIP });
    const o = (await t.call("resolve", { source: tripItem("restaurantes_json", 0) })).body.offer as any;
    expect(o.actions.map((a: any) => a.kind)).toEqual(["equivalent_search", "official_website", "phone", "maps_listing", "assisted_request", "save_for_later"]);
    expect(o.actions.find((a: any) => a.kind === "phone")).toMatchObject({ url: "tel:+34913664217", label: "Llamar al restaurante" });
    expect(o.actions.find((a: any) => a.kind === "maps_listing").url).toContain("query_place_id=ChIJx5Rc1n0oQg0R5B1hVIKdWUU");
  });
  it("un sitio que viene del viaje (editable) no se firma en booking-go: se abre directo", async () => {
    const t = setup({ trip: { ...PLACES_TRIP, restaurantes_json: [{ ...PLACES_TRIP.restaurantes_json![0], website: "https://phishing-ejemplo.example/" }] } });
    const s = await t.call("start_booking", { source: tripItem("restaurantes_json", 0), action_kind: "official_website", idempotency_key: key(), consent: true });
    expect(s.body).toMatchObject({ ok: true, go_url: null, direct_url: "https://phishing-ejemplo.example/" });
    expect(t.store.intents[0].target_url).toBeNull();
  });
});

describe("canales de un toque desde el servidor", () => {
  it("WhatsApp verificado del sitio oficial: mensaje en el idioma del lugar; REQUESTED al tocar", async () => {
    const venue = venueFromPriveRow({ id: "e9", slug: "roma-x", name: "Da Enzo", website: "https://daenzo.it",
      site_scan: { findings: { whatsapp: ["393331234567"], emails: ["info@daenzo.it"], phones: ["+39 06 581 2260"] } } }, "Roma", "IT");
    const t = setup({ venues: { "roma-x": venue } });
    const r = await t.call("resolve", { source: { type: "venue", name: "Da Enzo", prive_slug: "roma-x" }, draft: { date: "2026-12-06", time: "20:30", party_size: 2 } });
    const wa = (r.body.offer as any).actions.find((a: any) => a.kind === "whatsapp");
    expect(wa.channel.verified_by).toBe("Sitio oficial del lugar");
    expect(decodeURIComponent(wa.url.split("text=")[1])).toMatch(/Buongiorno[\s\S]*20:30[\s\S]*2 persone/);
    const s = await t.call("start_booking", { source: { type: "venue", name: "Da Enzo", prive_slug: "roma-x" }, action_kind: "whatsapp", idempotency_key: key(), consent: true });
    expect(s.body).toMatchObject({ intent: { state: "REQUESTED", channel: "whatsapp" }, go_url: null });
    const phone = (r.body.offer as any).actions.find((a: any) => a.kind === "phone");
    expect(phone.url).toMatch(/^tel:\+3906/);
    expect(phone.channel.call_script[0]).toMatch(/Buongiorno/);
  });
  it("cancelar: una confirmada se cancela con el proveedor, no en IATOS", async () => {
    const t = setup();
    const s = await t.call("start_booking", { source: tripItem("vuelos_json", 0), action_kind: "equivalent_search", idempotency_key: key(), consent: true });
    t.store.intents[0].state = "CONFIRMED";
    expect((await t.call("cancel", { intent_id: (s.body.intent as any).id })).body.code).toBe("CANCEL_WITH_PROVIDER");
  });
});
