// [A2] Arnés de bookingBridgeE2E.test.ts (handler y booking-go reales, almacén en memoria) con los casos
// adversariales de la segunda auditoría (grupo bridge). Ronda r2: se quitaron los 28 recorridos copiados tal
// cual de bookingBridgeE2E.test.ts (siguen allí) y se conservan A2-01…A2-06 como pruebas de regresión.
// Fase 11: los 20 recorridos del dueño, de punta a punta con el handler real de booking-bridge, el de
// booking-go y un almacén en memoria que imita las reglas SQL (las reglas reales se prueban en
// supabase/tests/bridge/bridge.sql). Proveedores simulados: nunca se compra ni se reserva nada.
import { MAX_TOKEN_USES } from "../../supabase/functions/_shared/booking/redirectToken";
import { describe, expect, it } from "vitest";
import { type BridgeDeps, handleBridge, type TripRow } from "../../supabase/functions/booking-bridge/handler";
import { resolveGo } from "../../supabase/functions/booking-go/go";
import { signRedirect, targetHash } from "../../supabase/functions/_shared/booking/redirectToken";
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
    // Igual que booking-bridge/index.ts: el token lleva la huella del destino y su nivel (AUD-04).
    goUrl: async (intentId, target) => {
      const t = await signRedirect(SECRET, { i: intentId, u: USER, o: "https://traveliatos.life", h: await targetHash(target.url),
        t: target.tier === "trusted_source" ? "s" : "a", n: target.uses ?? 0 }, o.now ?? NOW);
      return `https://example.supabase.co/functions/v1/booking-go?t=${encodeURIComponent(t!)}`;
    },
    intentTarget: async (id) => {
      const i = store.intents.find((x) => x.id === id && x.user_id === USER);
      return i ? { target_url: i.target_url ?? null, action_trust: i.offer?.action?.trust ?? null } : null;
    },
  };
  const go = (url: string, user = USER) => resolveGo(url, {
    secret: SECRET, now: () => (o.now ?? NOW) + 1000,
    // Como booking-go/index.ts: lee el destino guardado (y cuántas veces se abrió) antes de marcar la salida.
    peekTarget: async (i, u) => {
      const x = store.intents.find((r) => r.id === i && r.user_id === (u === USER ? user : u));
      return x ? { ok: true, target_url: x.target_url, trip_id: x.trip_id ?? null, redirect_count: x.redirect_count } : { ok: false, code: "NOT_FOUND" };
    },
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


// ───────────── Segunda auditoría (a2, grupo bridge): casos adversariales nuevos ─────────────
describe("A2 · colaborador que edita restaurantes_json (fuente google_places)", () => {
  const evil = "https://evil.io/pago";
  const tripWith = (website: string): TripRow => ({ ...TRIP, restaurantes_json: [{ nombre: "Sobrino de Botín", fuente: "google_places",
    place_id: "ChIJx5Rc1n0oQg0R5B1hVIKdWUU", website, telefono: "+34 913 66 42 17", consultado_at: "2026-10-22T10:00:00Z" }] });

  it("A2-01 un redirect opaco de Google (aclk) puesto por un colaborador NO se firma ni se presenta como 'Sitio oficial'", async () => {
    const aclk = "https://www.google.com/aclk?sa=l&ai=x&adurl=" + encodeURIComponent(evil);
    const t = setup({ trip: tripWith(aclk) });
    const o = (await t.call("resolve", { source: tripItem("restaurantes_json", 0) })).body.offer as any;
    const site = o.actions.find((a: any) => a.kind === "official_website");
    console.log("A2-01 resolve:", JSON.stringify(site && { url: site.url, label: site.label, trust: site.trust, verified_at: site.verified_at, disc: site.disclosures }));
    const s = await t.call("start_booking", { source: tripItem("restaurantes_json", 0), action_kind: "official_website", idempotency_key: key(), consent: true });
    console.log("A2-01 start_booking:", JSON.stringify({ go_url: s.body.go_url ?? null, direct_url: s.body.direct_url ?? null }));
    if (s.body.go_url) console.log("A2-01 booking-go:", JSON.stringify(await t.go(String(s.body.go_url))));
    // Lo seguro: ni firmado por IATOS ni etiquetado como oficial.
    expect(s.body.go_url ?? null).toBeNull();
    expect(site?.label ?? "").not.toMatch(/oficial/i);
    // r2: el resolver ni siquiera ofrece el redirect opaco de un dato editable del viaje.
    expect(site).toBeUndefined();
  });

  it("A2-01 (r2) un sitio del viaje que SÍ está en la lista estricta se ofrece, pero como 'sin verificar' (el colaborador lo puede editar)", async () => {
    const t = setup({ trip: tripWith("https://www.opentable.com/r/sobrino-de-botin-madrid") });
    const o = (await t.call("resolve", { source: tripItem("restaurantes_json", 0) })).body.offer as any;
    const site = o.actions.find((a: any) => a.kind === "official_website");
    expect(site?.label).toMatch(/sin verificar/);
    expect(site?.verified_at ?? null).toBeNull();
  });

  it("A2-01 (r2) booking-bridge no firma un aclk guardado con fuente google_places aunque llegue por una intención ya creada", async () => {
    const t = setup({ trip: tripWith("https://www.opentable.com/r/sobrino-de-botin-madrid") });
    const s = await t.call("start_booking", { source: tripItem("restaurantes_json", 0), action_kind: "official_website", idempotency_key: key(), consent: true });
    const i = t.store.intents[0];
    // Una intención anterior a la corrección (o escrita por otra vía) con un redirect opaco del viaje.
    i.target_url = "https://www.google.com/aclk?sa=l&ai=x&adurl=" + encodeURIComponent(evil);
    i.offer = { ...(i.offer ?? {}), action: { ...(i.offer?.action ?? {}), trust: "google_places" } };
    i.state = "PRICE_RECHECK_REQUIRED";
    const r = await t.call("confirm_price_ack", { intent_id: (s.body.intent as any).id });
    expect(r.body.go_url ?? null).toBeNull();
  });

  it("A2-02 /travel/clk de Google puesto por un colaborador tampoco se firma", async () => {
    const clk = "https://www.google.com/travel/clk/f?pcurl=" + encodeURIComponent(evil);
    const t = setup({ trip: tripWith(clk) });
    const s = await t.call("start_booking", { source: tripItem("restaurantes_json", 0), action_kind: "official_website", idempotency_key: key(), consent: true });
    console.log("A2-02 start_booking:", JSON.stringify({ go_url: s.body.go_url ?? null, direct_url: s.body.direct_url ?? null }));
    expect(s.body.go_url ?? null).toBeNull();
  });

  it("A2-03 punto final en un dominio de proveedor (www.google.com./url?q=) no entra como 'fuente confiable'", async () => {
    const u = "https://www.google.com./url?q=" + encodeURIComponent(evil);
    const t = setup({ trip: tripWith(u) });
    const o = (await t.call("resolve", { source: tripItem("restaurantes_json", 0) })).body.offer as any;
    const site = o.actions.find((a: any) => a.kind === "official_website");
    console.log("A2-03 resolve:", JSON.stringify(site && { url: site.url, label: site.label, disc: site.disclosures[0] }));
    expect(site).toBeUndefined();
  });
});

describe("A2 · token de booking-go", () => {
  it("A2-04 / A2-T1 el token tiene un máximo de usos; volver a abrir sigue funcionando y un token nuevo vuelve a servir", async () => {
    const t = setup();
    const k = key();
    const s = await t.call("start_booking", { source: tripItem("hospedaje_json", 0), action_kind: "equivalent_search", idempotency_key: k, consent: true });
    const url = String(s.body.go_url);
    const reasons: string[] = [];
    for (let i = 0; i < MAX_TOKEN_USES + 2; i++) reasons.push((await t.go(url)).reason);
    console.log("A2-04", reasons.join(" "), "redirect_count=", t.store.intents[0].redirect_count);
    // Abrir y volver a abrir (hasta el máximo) lleva al proveedor; después, el mismo enlace regresa a IATOS.
    expect(reasons.slice(0, MAX_TOKEN_USES)).toEqual(Array(MAX_TOKEN_USES).fill("ok"));
    expect(reasons.slice(MAX_TOKEN_USES)).toEqual(["enlace_usado", "enlace_usado"]);
    expect(t.store.intents[0].redirect_count).toBe(MAX_TOKEN_USES);
    // "Volver a abrir" desde la app (la misma selección) pide un token nuevo y vuelve a servir.
    const again = await t.call("start_booking", { source: tripItem("hospedaje_json", 0), action_kind: "equivalent_search", idempotency_key: k, consent: true });
    expect(again.body.go_url).toBeTruthy();
    expect((await t.go(String(again.body.go_url))).reason).toBe("ok");
  });

  it("A2-05 token de otro usuario: booking-go no encuentra la intención (filtro por user_id)", async () => {
    const t = setup();
    const s = await t.call("start_booking", { source: tripItem("hospedaje_json", 0), action_kind: "equivalent_search", idempotency_key: key(), consent: true });
    const tok = new URL(String(s.body.go_url)).searchParams.get("t")!;
    const [body, sig] = tok.split(".");
    const claims = JSON.parse(Buffer.from(body.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString());
    const forged = Buffer.from(JSON.stringify({ ...claims, u: OTHER })).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const r = await t.go(`https://example.supabase.co/functions/v1/booking-go?t=${forged}.${sig}`);
    expect(r.reason).toBe("enlace_invalido");
    // Firma bien formada pero con un solo bit distinto en cada posición: siempre inválida.
    for (let i = 0; i < sig.length; i += 7) {
      const c = sig[i] === "A" ? "B" : "A";
      const r2 = await t.go(`https://example.supabase.co/functions/v1/booking-go?t=${body}.${sig.slice(0, i)}${c}${sig.slice(i + 1)}`);
      expect(r2.reason, String(i)).toBe("enlace_invalido");
    }
  });
});

describe("A2 · catálogo curado con un dominio de proveedor con punto final", () => {
  it("A2-06 booking_url 'https://www.google.com./url?q=…' del catálogo NO debe salir firmado (t=s) por booking-go", async () => {
    const V = venueFromPriveRow({ id: "e7", slug: "cdmx-x", name: "Quintonil", website: "https://quintonil.com",
      booking_url: "https://www.google.com./url?q=" + encodeURIComponent("https://evil.io/pago"), booking_method: "web", verified_at: "2026-10-22" }, "Ciudad de México", "MX");
    const t = setup({ venues: { Quintonil: V } });
    const s = await t.call("start_booking", { source: tripItem("restaurantes_json", 1, "Quintonil"), action_kind: "official_booking_page", idempotency_key: key(), consent: true });
    const r = s.body.go_url ? await t.go(String(s.body.go_url)) : null;
    console.log("A2-06", JSON.stringify({ code: s.body.code ?? null, go_url: !!s.body.go_url, go: r }));
    expect(r?.reason ?? "sin_salida").not.toBe("ok");
  });
});
