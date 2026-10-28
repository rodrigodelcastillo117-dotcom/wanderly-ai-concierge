// Road trips (grupo roadtrip): reservar el auto con recogida y devolución precargadas por el camino
// seguro del Booking Bridge (booking-bridge → booking-go), sin URL del cliente.
import { describe, expect, it } from "vitest";
import { isOneWay, kayakCarsUrl, offerFromCarRental } from "../../supabase/functions/_shared/booking/carRental";
import { checkAllowlisted, checkUntrusted } from "../../supabase/functions/_shared/booking/allowlist";
import { type BridgeDeps, handleBridge } from "../../supabase/functions/booking-bridge/handler";
import { resolveGo } from "../../supabase/functions/booking-go/go";
import { signRedirect, targetHash } from "../../supabase/functions/_shared/booking/redirectToken";

const USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SECRET = "service-key-de-prueba";
const NOW = Date.parse("2026-10-22T12:00:00Z");

describe("enlace de Kayak Cars", () => {
  it("lleva recogida, devolución y fechas (también en ciudades distintas)", () => {
    expect(kayakCarsUrl({ pickup_city: "Florencia", dropoff_city: "Roma", pickup_date: "2026-11-10", dropoff_date: "2026-11-17" }))
      .toBe("https://www.kayak.com.mx/cars/Florence/Rome/2026-11-10/2026-11-17");
    expect(kayakCarsUrl({ pickup_city: "Inverness", dropoff_city: "Inverness", pickup_date: "2026-11-10", dropoff_date: "2026-11-17" }))
      .toBe("https://www.kayak.com.mx/cars/Inverness/2026-11-10/2026-11-17");
    expect(kayakCarsUrl({ pickup_city: "Múnich", pickup_date: "2026-11-10", dropoff_date: "2026-11-12" }))
      .toBe("https://www.kayak.com.mx/cars/Munich/2026-11-10/2026-11-12");
  });
  it("sin fechas válidas o con devolución antes de recoger no hay enlace", () => {
    expect(kayakCarsUrl({ pickup_city: "Roma", pickup_date: "2026-13-01", dropoff_date: "2026-11-12" })).toBeNull();
    expect(kayakCarsUrl({ pickup_city: "Roma", pickup_date: "2026-11-12", dropoff_date: "2026-11-10" })).toBeNull();
  });
  it("no deja inyectar rutas ni parámetros en la ciudad", () => {
    const u = kayakCarsUrl({ pickup_city: "Roma/../../evil?x=1#", pickup_date: "2026-11-10", dropoff_date: "2026-11-12" })!;
    expect(new URL(u).hostname).toBe("www.kayak.com.mx");
    expect(u).not.toMatch(/\.\.\/|\?|#/);
  });
  it("pasa la lista blanca estricta (kayak.com ya permitido)", () => {
    const u = kayakCarsUrl({ pickup_city: "Florencia", dropoff_city: "Roma", pickup_date: "2026-11-10", dropoff_date: "2026-11-17" })!;
    expect(checkAllowlisted(u).ok).toBe(true);
    expect(checkUntrusted(u).ok).toBe(true);
  });
  it("detecta la devolución en otra ciudad", () => {
    expect(isOneWay({ pickup_city: "Florencia", dropoff_city: "Firenze", pickup_date: "2026-11-10", dropoff_date: "2026-11-12" })).toBe(false);
    expect(isOneWay({ pickup_city: "Florencia", dropoff_city: "Roma", pickup_date: "2026-11-10", dropoff_date: "2026-11-12" })).toBe(true);
  });
});

describe("oferta del bridge", () => {
  it("es una búsqueda (no tarifa) con aviso del cargo por devolución en otro lugar", () => {
    const o = offerFromCarRental({ pickup_city: "Florencia", dropoff_city: "Roma", pickup_date: "2026-11-10", dropoff_date: "2026-11-17" }, { now: NOW });
    expect(o.product_type).toBe("transport");
    expect(o.price).toBeNull();
    expect(o.booking_mode).toBe("PROVIDER_SEARCH");
    const a = o.actions.find((x) => x.kind === "equivalent_search")!;
    expect(a.label).toBe("Buscar auto de renta");
    expect(a.url).toBe("https://www.kayak.com.mx/cars/Florence/Rome/2026-11-10/2026-11-17");
    expect(a.preserves.dates).toBe(true);
    expect(a.disclosures.join(" ")).toMatch(/cargo extra/);
    expect(o.booking_conditions.join(" ")).toMatch(/monto lo da la arrendadora/);
    expect(o.actions.some((x) => x.kind === "exact_offer")).toBe(false);
  });
});

function deps(intents: any[]): BridgeDeps {
  const rpc = async (fn: string, a: any) => {
    if (fn === "booking_intent_start") {
      const row = { id: crypto.randomUUID(), user_id: a._user, ...a._p };
      intents.push(row);
      return { data: { ok: true, intent: row }, error: null };
    }
    if (fn === "booking_intent_mark_redirected") {
      const i = intents.find((x) => x.id === a._id && x.user_id === a._user);
      if (i) i.state = "REDIRECTED_TO_PROVIDER";
      return { data: i ? { ok: true, target_url: i.target_url, trip_id: i.trip_id } : { ok: false }, error: null };
    }
    return { data: null, error: { message: "no simulada" } };
  };
  return {
    userId: USER, userLabel: "ana@example.test", now: () => NOW,
    loadTrip: async () => null, venueLookup: async () => null, rpc, userRpc: rpc,
    listIntents: async () => intents, createAssistRequest: async () => null, notifyTeam: async () => true, tripDocumentOk: async () => false,
    recheckFlight: async () => ({ ok: false, code: "X", message: "x" }) as any, recheckHotel: async () => ({ ok: false, code: "X", message: "x" }) as any,
    goUrl: async (intentId, target) => {
      const t = await signRedirect(SECRET, { i: intentId, u: USER, o: "https://traveliatos.life", h: await targetHash(target.url), t: target.tier === "trusted_source" ? "s" : "a" }, NOW);
      return `https://example.supabase.co/functions/v1/booking-go?t=${encodeURIComponent(t!)}`;
    },
    intentTarget: async (id) => {
      const i = intents.find((x) => x.id === id);
      return i ? { target_url: i.target_url, action_trust: i.offer?.action?.trust ?? null } : null;
    },
  };
}

describe("booking-bridge con la fuente car_rental", () => {
  const source = { type: "car_rental", pickup_city: "Florencia", dropoff_city: "Roma", pickup_date: "2026-11-10", dropoff_date: "2026-11-17" };

  it("resolve arma la oferta en el servidor con los mismos datos", async () => {
    const r = await handleBridge("resolve", { source }, deps([]));
    expect(r.status).toBe(200);
    expect((r.body.offer as any).actions.find((a: any) => a.kind === "equivalent_search").url).toBe("https://www.kayak.com.mx/cars/Florence/Rome/2026-11-10/2026-11-17");
  });

  it("start_booking guarda la intención y firma la salida por booking-go a Kayak", async () => {
    const intents: any[] = [];
    const r = await handleBridge("start_booking", { source, action_kind: "equivalent_search", idempotency_key: "idem-car-0001", consent: true }, deps(intents));
    expect(r.status).toBe(200);
    expect(intents[0]).toMatchObject({ product_type: "transport", provider: "kayak_cars", target_url: "https://www.kayak.com.mx/cars/Florence/Rome/2026-11-10/2026-11-17", channel: "web" });
    const go = String(r.body.go_url);
    const out = await resolveGo(go, { secret: SECRET, now: () => NOW + 1000, markRedirected: async (i, u) => (await deps(intents).rpc("booking_intent_mark_redirected", { _id: i, _user: u })).data });
    expect(out.location).toBe("https://www.kayak.com.mx/cars/Florence/Rome/2026-11-10/2026-11-17");
  });

  it("una URL que mande el cliente se ignora: el destino lo arma el servidor", async () => {
    const intents: any[] = [];
    await handleBridge("start_booking", { source: { ...source, url: "https://evil.example/cars" }, action_kind: "equivalent_search", idempotency_key: "idem-car-0002", consent: true }, deps(intents));
    expect(intents[0].target_url).toMatch(/^https:\/\/www\.kayak\.com\.mx\/cars\//);
  });

  it("fechas inválidas: BAD_INPUT", async () => {
    const r = await handleBridge("resolve", { source: { ...source, pickup_date: "mañana" } }, deps([]));
    expect(r.status).toBe(400);
  });
});
