// Event Radar (SerpApi google_events) y trenes/autobuses gratis con el operador oficial (23-oct-2026).
// Fixtures armados según la documentación pública de SerpApi (https://serpapi.com/google-events-api):
// events_results[].{title, date.start_date, date.when, address[], venue.name, ticket_info[], thumbnail}.
// Sin llamadas reales: fetch, caché, bolsa y freno son simulados.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => {
  const done = Promise.resolve({ data: null, error: null });
  const from = () => ({ insert: () => ({ then: done.then.bind(done), select: () => ({ single: async () => ({ data: null, error: null }) }) }), update: () => ({ eq: () => done }) });
  return { supabase: { from, functions: { invoke: (...a: any[]) => invoke(...a) } } };
});
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" } }) }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

import { eventsQuery, eventsRequested, mapGoogleEvents, parseEventDate, parseEventTime, runEventSearch } from "../../supabase/functions/concierge-chat/events";
import { applyToolPolicy, detectIntents } from "../../supabase/functions/concierge-chat/planner";
import { runAgentTurn, type ModelCaller } from "../../supabase/functions/concierge-chat/agent";
import { CircuitBreaker, type ProviderStep } from "../../supabase/functions/concierge-chat/router";
import { eventCards, prepareToolResultForModel, validateCards, collectEvidence } from "../../supabase/functions/concierge-chat/cards";
import { finalizeTurn } from "../../supabase/functions/concierge-chat/finalize";
import { TOOL_DEFS } from "../../supabase/functions/concierge-chat/toolDefs";
import { CACHE_TTL_SECONDS, memoryCacheStore } from "../../supabase/functions/_shared/serpCache";
import { OPERATORS, RAIL_BY_COUNTRY, routeOperators } from "../../supabase/functions/_shared/booking/railOperators";
import { mapsDirectionsUrl, transitScheduleUrl } from "@/lib/takeMeThere";
import { legStep } from "@/lib/buyFlow";
import { RichCard } from "@/components/concierge/ConciergeCards";
import { GroundBuyButtons } from "@/components/booking/FlightBuyButtons";

// ─── Fixture con la forma documentada de google_events ───
const SERP_EVENTS = {
  search_metadata: { status: "Success" },
  events_results: [
    {
      title: "Rosalía · Motomami World Tour",
      date: { start_date: "Dec 7", when: "Mon, Dec 7, 8 – 11 PM" },
      address: ["WiZink Center, Av. Felipe II", "Madrid, España"],
      link: "https://www.google.com/search?q=rosalia",
      event_location_map: { image: "https://www.google.com/maps/vt/data=x", link: "https://www.google.com/maps/place/x", serpapi_link: "https://serpapi.com/x" },
      venue: { name: "WiZink Center", rating: 4.4, link: "https://www.google.com/search?q=wizink" },
      ticket_info: [
        { source: "Ticketmaster.es", link: "https://www.ticketmaster.es/event/rosalia-123", link_type: "tickets" },
        { source: "WiZink Center", link: "https://www.wizinkcenter.es/evento/rosalia", link_type: "more info" },
      ],
      thumbnail: "https://serpapi.com/searches/abc/images/rosalia.jpeg",
      event_token: "tok1",
    },
    {
      title: "La Traviata",
      date: { start_date: "Dec 9", when: "Wed, Dec 9, 7:30 PM" },
      address: ["Teatro Real, Plaza de Isabel II", "Madrid"],
      venue: { name: "Teatro Real" },
      ticket_info: [{ source: "Teatro Real", link: "https://www.teatroreal.es/es/espectaculo/traviata", link_type: "tickets" }],
      thumbnail: "https://serpapi.com/searches/abc/images/traviata.jpeg",
    },
    { title: "Fuera del rango", date: { start_date: "Jan 20", when: "Wed, Jan 20, 9 PM" }, address: ["Madrid"], ticket_info: [] },
  ],
};

const RANGE = { from: "2026-12-05", to: "2026-12-12" };

describe("1. parseo de google_events", () => {
  it("título, fecha y hora en español, recinto, dirección, boletos (solo link_type tickets) y miniatura; sin precio", () => {
    const ev = mapGoogleEvents(SERP_EVENTS, RANGE, "2026-10-23");
    expect(ev).toHaveLength(2);
    expect(ev[0]).toEqual({
      title: "Rosalía · Motomami World Tour", fecha: "2026-12-07", hora: "20:00", cuando: "lun 7 dic · 20:00",
      recinto: "WiZink Center", direccion: "WiZink Center, Av. Felipe II, Madrid, España",
      boletos: [{ fuente: "Ticketmaster.es", link: "https://www.ticketmaster.es/event/rosalia-123" }],
      miniatura: "https://serpapi.com/searches/abc/images/rosalia.jpeg",
    });
    expect(ev[1]).toMatchObject({ fecha: "2026-12-09", hora: "19:30", recinto: "Teatro Real" });
    expect(JSON.stringify(ev)).not.toMatch(/price|precio|\$/i);
  });
  it("fechas: año inferido, español e inglés; horas AM/PM y 24 h", () => {
    expect(parseEventDate("Dec 7", "2026-10-23")).toBe("2026-12-07");
    expect(parseEventDate("Jan 20", "2026-12-05")).toBe("2027-01-20");
    expect(parseEventDate("7 dic", "2026-10-23")).toBe("2026-12-07");
    expect(parseEventDate("sin fecha", "2026-10-23")).toBeNull();
    expect(parseEventTime("Sat, Dec 7, 8 – 11 PM")).toBe("20:00");
    expect(parseEventTime("Fri, 9:30 AM")).toBe("09:30");
    expect(parseEventTime("vie, 21:15")).toBe("21:15");
  });
  it("la consulta lleva la ciudad (como pide la documentación) y el mes si el rango cae en uno", () => {
    expect(eventsQuery({ city: "Madrid", query: "conciertos", ...RANGE })).toBe("conciertos en Madrid diciembre 2026");
    expect(eventsQuery({ city: "CDMX" })).toBe("eventos en CDMX");
  });
});

function serpFetch(body: unknown = SERP_EVENTS, status = 200) {
  return vi.fn(async (_url: string) => new Response(JSON.stringify(body), { status }));
}

describe("4. caché (6 h por ciudad, fecha y consulta), cuota y freno de gasto", () => {
  const now = () => Date.parse("2026-10-23T15:00:00Z");
  it("TTL de google_events = 6 h", () => expect(CACHE_TTL_SECONDS.google_events).toBe(6 * 3600));
  it("la segunda búsqueda igual sale de la caché: una sola llamada, una sola búsqueda de la bolsa, un solo costo", async () => {
    const store = memoryCacheStore(now);
    const fetchImpl = serpFetch();
    const gate = vi.fn(async () => ({ allow: true as const }));
    const onLive = vi.fn();
    const deps = { fetchImpl: fetchImpl as unknown as typeof fetch, serpKey: "k", store, gate, onLive, now };
    const args = { city: "Madrid", date_from: RANGE.from, date_to: RANGE.to, query: "conciertos" };
    const a = await runEventSearch(args, deps);
    const b = await runEventSearch(args, deps);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(gate).toHaveBeenCalledTimes(1);
    expect(onLive).toHaveBeenCalledTimes(1);
    expect(onLive).toHaveBeenCalledWith(true);
    expect(a).toMatchObject({ ok: true, source: "google_events" });
    expect(b).toMatchObject({ ok: true, from_cache: true });
    expect((b.results as unknown[]).length).toBe(2);
    const url = new URL(String(fetchImpl.mock.calls[0][0]));
    expect(url.searchParams.get("engine")).toBe("google_events");
    expect(url.searchParams.get("q")).toBe("conciertos en Madrid diciembre 2026");
    // Otra ciudad u otra fecha es otra llave.
    await runEventSearch({ ...args, city: "Barcelona" }, deps);
    await runEventSearch({ ...args, date_from: "2026-12-06" }, deps);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect([...store.rows.values()].every((r) => r.engine === "google_events" && r.ttl_seconds === 6 * 3600)).toBe(true);
  });
  it("plan sin búsquedas: no llama a SerpApi y lo dice", async () => {
    const fetchImpl = serpFetch();
    const r = await runEventSearch({ city: "Madrid" }, { fetchImpl: fetchImpl as unknown as typeof fetch, serpKey: "k", store: memoryCacheStore(now), gate: async () => ({ allow: false, soft: false }), now });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(r).toMatchObject({ code: "FREE_LIMIT_REACHED" });
    expect(prepareToolResultForModel("search_events", r)).toMatchObject({ disponible: false, estado: "limite_del_plan" });
  });
  it("freno de la cuenta en pausa: no gasta; cuota agotada en SerpApi: activa el freno y devuelve la bolsa", async () => {
    const fetchImpl = serpFetch();
    const paused = { paused: async () => "budget" as const, tripQuota: vi.fn(async () => {}) };
    expect(await runEventSearch({ city: "Madrid" }, { fetchImpl: fetchImpl as unknown as typeof fetch, serpKey: "k", store: memoryCacheStore(now), brake: paused, now })).toEqual({ error: "busquedas_en_pausa" });
    expect(fetchImpl).not.toHaveBeenCalled();
    const quota = serpFetch({ error: "Your account has run out of searches." }, 429);
    const brake = { paused: async () => null, tripQuota: vi.fn(async () => {}) };
    const refund = vi.fn(async () => {});
    const r = await runEventSearch({ city: "Madrid" }, { fetchImpl: quota as unknown as typeof fetch, serpKey: "k", store: memoryCacheStore(now), brake, gate: async () => ({ allow: true, refund }), now });
    expect(r).toEqual({ error: "http_429" });
    expect(brake.tripQuota).toHaveBeenCalledTimes(1);
    expect(refund).toHaveBeenCalledTimes(1);
  });
  it("sin resultados: lo dice tal cual (sin_resultados), sin inventar", async () => {
    const r = await runEventSearch({ city: "Pueblito" }, { fetchImpl: serpFetch({ error: "Google hasn't returned any results for this query." }) as unknown as typeof fetch, serpKey: "k", store: memoryCacheStore(now), now });
    expect(r).toMatchObject({ ok: true, results: [] });
    expect(prepareToolResultForModel("search_events", r)).toMatchObject({ disponible: false, estado: "sin_resultados" });
    expect(await runEventSearch({ city: "Madrid" }, { fetchImpl: serpFetch() as unknown as typeof fetch, now })).toEqual({ error: "no_configurado" });
  });
});

describe("3. Iato no busca eventos si no se los piden", () => {
  it("la herramienta existe y su descripción lo limita", () => {
    const def = TOOL_DEFS.find((t) => t.name === "search_events")!;
    expect(def.input_schema.required).toEqual(["city"]);
    expect(def.description).toMatch(/SOLO cuando el usuario pida eventos/);
  });
  it("detección: eventos, conciertos, teatro, deportes o qué hacer con fecha concreta", () => {
    for (const m of ["¿Qué conciertos hay en Madrid?", "obras de teatro en CDMX", "partido del Real Madrid", "¿qué hacer el sábado en Roma?", "qué hacer del 5 al 8 de diciembre"]) {
      expect(eventsRequested(m)).toBe(true);
    }
    for (const m of ["restaurantes cerca de mi hotel", "¿dónde está la sala Centurion?", "¿qué hacer en Roma?", "vuelos a París"]) {
      expect(eventsRequested(m)).toBe(false);
    }
    expect(detectIntents("conciertos en Madrid este fin de semana")).toContain("events");
    expect(detectIntents("cenar cerca de mi hotel")).not.toContain("events");
  });
  it("política: search_events sin petición se bloquea", () => {
    expect(applyToolPolicy("search_events", { city: "Madrid" }, "restaurantes en Madrid")).toMatchObject({ blocked: "eventos_no_pedidos" });
    expect(applyToolPolicy("search_events", { city: "Madrid" }, "conciertos en Madrid").blocked).toBeUndefined();
  });

  const steps: ProviderStep[] = [{ provider: "anthropic", model: "claude-sonnet-5-5", effort: "low", key: "anthropic:claude-sonnet-5-5" }];
  const usage = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
  function turn(userMessage: string) {
    let call = 0;
    const callModel: ModelCaller = async () => {
      call += 1;
      if (call === 1) {
        return { provider: "anthropic", model: "m", content: [], text: "", stopReason: "tool_use", usage,
          toolUses: [{ id: "t1", name: "search_events", input: { city: "Madrid", date_from: RANGE.from, date_to: RANGE.to } }] };
      }
      return { provider: "anthropic", model: "m", content: [], text: "Listo.", stopReason: "end_turn", usage, toolUses: [] };
    };
    const execTool = vi.fn(async () => ({ ok: true, source: "google_events", results: mapGoogleEvents(SERP_EVENTS, RANGE), consulted_at: "2026-10-23T15:00:00Z" }));
    const now = () => 0;
    return {
      execTool,
      run: () => runAgentTurn({
        chain: steps, callModel, breaker: new CircuitBreaker(now), cooldownMs: 1000, stableSystem: "s", dynamicSystem: "d",
        messages: [{ role: "user", content: userMessage }], tools: TOOL_DEFS, maxIterations: 3, maxTokens: 500, userMessage,
        execTool, prepare: (n, raw) => prepareToolResultForModel(n, raw), toolTimeoutMs: () => 5000,
        emit: { status: () => {}, delta: () => {}, reset: () => {} }, now, deadlineMs: 30_000,
      }),
    };
  }
  it("si el modelo la pide sin que el usuario pidiera eventos, no se ejecuta (ni se cobra)", async () => {
    const t = turn("recomiéndame un restaurante en Madrid");
    const r = await t.run();
    expect(t.execTool).not.toHaveBeenCalled();
    expect(r.toolRuns).toHaveLength(0);
  });
  it("si los pidió, se ejecuta una vez", async () => {
    const t = turn("¿qué conciertos hay en Madrid del 5 al 12 de diciembre?");
    const r = await t.run();
    expect(t.execTool).toHaveBeenCalledTimes(1);
    expect(r.toolRuns.map((x) => x.name)).toEqual(["search_events"]);
  });
});

describe("2. card Evento y etiquetas", () => {
  const prepared = prepareToolResultForModel("search_events", { ok: true, source: "google_events", results: mapGoogleEvents(SERP_EVENTS, RANGE), consulted_at: "2026-10-23T15:04:00Z" });
  const runs = [{ name: "search_events", args: { city: "Madrid" }, result: prepared }];

  it("las arma IATOS con el resultado (fuente, consulta, boletos); una card de evento del modelo se descarta", () => {
    const cards = eventCards(runs);
    expect(cards).toHaveLength(2);
    expect(cards[0]).toMatchObject({
      type: "event", title: "Rosalía · Motomami World Tour", subtitle: "lun 7 dic · 20:00", meta: "WiZink Center",
      address: "WiZink Center, Av. Felipe II, Madrid, España", fuente: "google_events", consultado_at: "2026-10-23T15:04:00Z",
      event_date: "2026-12-07", event_time: "20:00",
      links: [{ kind: "tickets", label: "Boletos en Ticketmaster.es", url: "https://www.ticketmaster.es/event/rosalia-123" }],
    });
    expect(cards[0].price).toBeUndefined();
    const fromModel = validateCards([{ type: "event", title: "Concierto inventado", price: 80 }], collectEvidence(runs));
    expect(fromModel.cards).toHaveLength(0);
    expect(fromModel.dropped).toEqual([{ type: "event", reason: "evento_solo_de_la_busqueda" }]);
  });

  it("finalize: cards de eventos + 'Agregar al itinerario' (acción existente) si cae en el viaje", () => {
    const trip = { id: "11111111-1111-4111-8111-111111111111", destino: "Madrid", fecha_salida: "2026-12-05", fecha_regreso: "2026-12-12" };
    const out = finalizeTurn({
      raw: "Encontré estos eventos.", toolRuns: runs, plan: { cards: [], suggestedActions: [] },
      actionCtx: { todayISO: "2026-10-23", trips: [trip], activeTripId: trip.id }, makeId: () => "a1",
      tripScope: { trip, position: "unknown" as any, user: null }, userMessage: "conciertos en Madrid en mi viaje",
    });
    expect(out.cards.filter((c) => c.type === "event").map((c) => c.title)).toEqual(["Rosalía · Motomami World Tour", "La Traviata"]);
    const add = out.actions.find((a) => a.type === "add_itinerary_item")!;
    expect(add.params).toMatchObject({ trip_id: trip.id, fecha: "2026-12-07", hora: "20:00", titulo: "Rosalía · Motomami World Tour" });
  });

  it("RichCard: fecha y hora, recinto, dirección, 'Google Events · consultado HH:MM', 'Boletos en …' y 'Llévame'; nunca 'comprado' ni precio", () => {
    const card = eventCards(runs)[0];
    const { container } = render(<RichCard card={card} />);
    expect(container.querySelector('[data-card-type="event"]')).not.toBeNull();
    expect(screen.getByTestId("event-when")).toHaveTextContent("lun 7 dic · 20:00");
    expect(screen.getByText("WiZink Center")).toBeInTheDocument();
    const hhmm = new Date("2026-10-23T15:04:00Z").toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit", hour12: false });
    expect(screen.getByTestId("event-source")).toHaveTextContent(`Fuente: Google Events · consultado ${hhmm}`);
    const tickets = screen.getByRole("link", { name: /Boletos en Ticketmaster\.es/ });
    expect(tickets).toHaveAttribute("href", "https://www.ticketmaster.es/event/rosalia-123");
    expect(tickets).toHaveAttribute("target", "_blank");
    const go = screen.getByTestId("take-me-there");
    expect(go.getAttribute("href")).toBe(`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent("WiZink Center, WiZink Center, Av. Felipe II, Madrid, España")}&travelmode=driving`);
    expect(container.textContent).not.toMatch(/comprad|reservad|\$\s?\d|USD|MXN|EUR/i);
  });
});

describe("5. Google Maps en modo transit (horarios reales, gratis)", () => {
  it("URL oficial de Maps con origin, destination y travelmode=transit", () => {
    expect(transitScheduleUrl("Madrid", "Sevilla")).toBe("https://www.google.com/maps/dir/?api=1&origin=Madrid&destination=Sevilla&travelmode=transit");
    expect(transitScheduleUrl("Tokio", "Kioto")).toMatch(/travelmode=transit$/);
    expect(transitScheduleUrl("", "Sevilla")).toBeNull();
    expect(mapsDirectionsUrl({ destination: "" })).toBeNull();
  });
});

describe("6. catálogo de operadores oficiales por país", () => {
  it("España → Renfe (y iryo, OUIGO); Japón → JR SmartEX con JR Pass solo informativo", () => {
    expect(routeOperators({ from: "Madrid", to: "Sevilla" }).map((o) => o.id)).toEqual(["renfe", "iryo", "ouigo_es"]);
    const jp = routeOperators({ from: "Tokio", to: "Osaka" });
    expect(jp[0].id).toBe("smartex");
    expect(jp.find((o) => o.id === "jrpass")?.informativo).toBe(true);
    expect(routeOperators({ from: "Kioto", to: "Hiroshima", country: "Japón" })[0].id).toBe("smartex");
  });
  it("Francia, Italia, Alemania, Reino Unido, Eurostar, Suiza, Países Bajos y Portugal", () => {
    expect(routeOperators({ from: "París", to: "Lyon", country: "Francia" })[0].id).toBe("sncf");
    expect(routeOperators({ from: "Roma", to: "Florencia" }).map((o) => o.id)).toEqual(["trenitalia", "italo"]);
    expect(routeOperators({ from: "Berlín", to: "Múnich" })[0].id).toBe("db");
    expect(routeOperators({ from: "Londres", to: "Edimburgo" }).map((o) => o.id)).toEqual(["nationalrail", "lner"]);
    expect(routeOperators({ from: "Londres", to: "París" })[0].id).toBe("eurostar");
    expect(routeOperators({ from: "Zúrich", to: "Ginebra", country: "Suiza" })[0].id).toBe("sbb");
    expect(routeOperators({ from: "Ámsterdam", to: "Utrecht", country: "Países Bajos" })[0].id).toBe("ns");
    expect(routeOperators({ from: "Lisboa", to: "Oporto" })[0].id).toBe("cp");
  });
  it("el operador que nombra el plan va primero; sin catálogo (India) no se inventa uno", () => {
    expect(routeOperators({ from: "Madrid", to: "Barcelona", provider: "iryo" })[0].id).toBe("iryo");
    expect(routeOperators({ from: "Roma", to: "Venecia", provider: "Frecciarossa" })[0].id).toBe("trenitalia");
    expect(routeOperators({ from: "Delhi", to: "Agra", provider: "Gatimaan Express" })).toEqual([]);
    expect(routeOperators({ from: "Madrid", to: "Granada", provider: "ALSA", kind: "bus" })[0].id).toBe("alsa");
    expect(routeOperators({ from: "CDMX", to: "Puebla", provider: "ADO Platino", kind: "bus" })[0].id).toBe("ado");
    expect(routeOperators({ from: "CDMX", to: "Puebla", provider: "Estrella Roja", kind: "bus" })).toEqual([]);
  });
  it("todo enlace es https a la portada oficial (sin parámetros inventados) y con fuente", () => {
    for (const o of Object.values(OPERATORS)) {
      const u = new URL(o.url);
      expect(u.protocol).toBe("https:");
      expect(u.search).toBe("");
      expect(o.prefill).toBe("nada");
      expect(o.fuente).toBe(u.hostname.replace(/^www\./, ""));
    }
    for (const ids of Object.values(RAIL_BY_COUNTRY)) for (const id of ids) expect(OPERATORS[id]).toBeDefined();
  });
});

describe("7. nunca un precio inventado en trenes y autobuses", () => {
  const trip = { id: "t1", num_viajeros: 2, destino: "Madrid → Sevilla", pais_destino: "España" };
  it("Comprar: tren Madrid → Sevilla con 'Comprar en Renfe', Trainline de alternativa y horarios en Maps; sin precio", () => {
    const leg = legStep(trip, "Madrid", "Sevilla", "2026-12-07", 2, "tren");
    const tren = leg.choices.find((c) => c.mode === "tren")!;
    expect(tren).toMatchObject({ site: "Renfe", buttonLabel: "Comprar en Renfe", url: "https://www.renfe.com/es/es", pricePp: null });
    expect(tren.completa).toBe("Renfe no recibe la ruta por enlace: escribe Madrid → Sevilla y el 7 dic. Precio en el sitio del operador.");
    expect(tren.links?.map((l) => l.label)).toEqual(["Comprar en iryo", "Comprar en OUIGO España", "Buscar tren en Trainline", "Ver horarios en Google Maps"]);
    expect(tren.links?.find((l) => l.kind === "horarios")?.url).toBe(transitScheduleUrl("Madrid", "Sevilla"));
    expect(leg.item.price).toBeNull();
    expect(leg.item.priceNote).toBe("Por cotizar: precio en el sitio del operador.");
  });
  it("Destinos: tramo en tren con operador, Trainline y horarios; autobús ALSA con su sitio y horarios; ningún $", () => {
    const { container, unmount } = render(<MemoryRouter><GroundBuyButtons option={{ mode: "Tren de Alta Velocidad (AVE)", from: "Madrid", to: "Sevilla", provider: "Renfe AVE" }} trip={trip} /></MemoryRouter>);
    const ops = screen.getAllByTestId("ground-operator").map((a) => a.textContent?.trim());
    expect(ops[0]).toMatch(/^Comprar en Renfe/);
    expect(screen.getByText(/Buscar tren en Trainline/)).toBeInTheDocument();
    expect(screen.getByTestId("ground-schedule")).toHaveAttribute("href", transitScheduleUrl("Madrid", "Sevilla"));
    expect(container.textContent).toMatch(/Precio en el sitio del operador/);
    expect(container.textContent).not.toMatch(/\$\s?\d|MXN|USD|EUR|comprad/i);
    unmount();
    const bus = render(<MemoryRouter><GroundBuyButtons option={{ mode: "autobús", from: "Granada", to: "Málaga", provider: "ALSA" }} trip={trip} /></MemoryRouter>);
    expect(screen.getByText(/Precio y compra con el operador \(ALSA\)/)).toBeInTheDocument();
    expect(screen.getByTestId("ground-operator")).toHaveAttribute("href", "https://www.alsa.es/");
    expect(screen.getByTestId("ground-schedule").getAttribute("href")).toMatch(/travelmode=transit/);
    expect(bus.container.textContent).not.toMatch(/\$\s?\d|MXN|USD|EUR/);
  });
});

beforeEach(() => invoke.mockReset());
