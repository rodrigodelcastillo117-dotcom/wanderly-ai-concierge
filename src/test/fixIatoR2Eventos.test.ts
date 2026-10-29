// Auditoría 10, ronda 2 (#5): "¿Qué eventos o conciertos hay en CDMX este fin de semana?" (Día de
// Muertos) → Ticketmaster guardó {"results": []} y el paso quedó "Buscando eventos · no respondió" a
// los 20 s. Sin llave local de Ticketmaster: el servidor de la Discovery API v2 se simula según la
// documentación oficial (developer.ticketmaster.com/products-and-docs/apis/discovery-api/v2/, leída el
// 29-oct-2026): `keyword` busca texto del evento; `classificationName` es un arreglo (segmento, género
// o subgénero; varios separados por coma); `startDateTime`/`endDateTime` comparan la hora UTC de inicio.
import { describe, expect, it } from "vitest";
import { searchTicketmaster, tmParams, tmQueryTerms } from "../../supabase/functions/_shared/ticketmaster";
import { memoryCacheStore } from "../../supabase/functions/_shared/serpCache";
import { makeAccountBrake } from "../../supabase/functions/_shared/serpBrake";
import { runEventSearch } from "../../supabase/functions/concierge-chat/events";
import { prepareToolResultForModel } from "../../supabase/functions/concierge-chat/cards";
import { toolOutcome } from "../../supabase/functions/concierge-chat/planner";

const NOW = Date.parse("2026-10-29T02:18:00Z"); // la hora de la prueba en producción
const KEY = "TMKEY_falsa_de_pruebas";

/** Eventos de CDMX del fin de semana de Día de Muertos (formato de la Discovery API v2). */
const mk = (id: string, name: string, date: string, time: string, segment: string, genre: string, venue: string) => ({
  id, name, url: `https://www.ticketmaster.com.mx/evento/${id}`, locale: "es-mx",
  dates: { start: { localDate: date, localTime: time }, status: { code: "onsale" } },
  classifications: [{ primary: true, segment: { name: segment }, genre: { name: genre } }],
  _embedded: { venues: [{ name: venue, address: { line1: "Centro" }, city: { name: "Ciudad de México" }, location: { latitude: "19.43", longitude: "-99.13" } }] },
});
const CDMX_EVENTS = [
  mk("e1", "Café Tacvba", "2026-10-31", "21:00:00", "Music", "Rock", "Palacio de los Deportes"),
  mk("e2", "La Catrina: el musical", "2026-10-31", "18:00:00", "Arts & Theatre", "Theatre", "Teatro Metropólitan"),
  mk("e3", "Pumas vs América", "2026-11-01", "12:00:00", "Sports", "Soccer", "Estadio Olímpico Universitario"),
  mk("e4", "Natalia Lafourcade", "2026-11-01", "20:30:00", "Music", "Pop", "Auditorio Nacional"),
  mk("e5", "Cirque du Soleil", "2026-11-01", "17:00:00", "Family", "Circus & Specialty Acts", "Carpa Santa Fe"),
];

/** Servidor simulado: filtra como dice la documentación (keyword = texto del evento). */
function discoveryFetch(log: URL[] = []) {
  return (async (u: string) => {
    const url = new URL(u);
    log.push(url);
    let list = CDMX_EVENTS;
    const kw = url.searchParams.get("keyword");
    if (kw) list = list.filter((e) => e.name.toLowerCase().includes(kw.toLowerCase()));
    const cls = url.searchParams.get("classificationName");
    if (cls) {
      const names = cls.split(",").map((x) => x.trim().toLowerCase());
      list = list.filter((e) => names.includes(e.classifications[0].segment.name.toLowerCase()) || names.includes(e.classifications[0].genre.name.toLowerCase()));
    }
    const body = { _embedded: list.length ? { events: list } : undefined, page: { size: 20, totalElements: list.length, totalPages: 1, number: 0 } };
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
}

describe("#5 · la consulta a Ticketmaster", () => {
  it("'eventos o conciertos' pide de todo: ni keyword (texto del evento) ni categoría", () => {
    const p = tmParams({ city: "Ciudad de México", from: "2026-10-31", to: "2026-11-01", category: "eventos o conciertos", keyword: "eventos o conciertos" }, NOW)!;
    expect(p.keyword).toBeUndefined();
    expect(p.classificationName).toBeUndefined();
    expect(p).toMatchObject({ countryCode: "MX", unit: "km", startDateTime: "2026-10-31T00:00:00Z", endDateTime: "2026-11-02T23:59:59Z", locale: "es-mx,es,en,*" });
  });
  it("categorías a classificationName (arreglo con comas) y solo lo específico a keyword", () => {
    expect(tmQueryTerms("conciertos y teatro")).toEqual({ classifications: ["music", "arts & theatre"], keyword: null, broad: false });
    expect(tmQueryTerms("conciertos de Coldplay")).toMatchObject({ classifications: ["music"], keyword: "Coldplay" });
    expect(tmQueryTerms("Día de Muertos")).toMatchObject({ classifications: [], keyword: "Día de Muertos" });
    expect(tmQueryTerms("jazz")).toMatchObject({ classifications: ["Jazz"], keyword: null });
    expect(tmParams({ city: "CDMX", from: "2026-10-31", category: "conciertos, teatro", keyword: "conciertos, teatro" }, NOW)!.classificationName).toBe("music,arts & theatre");
  });
  it("al este de Greenwich se pide desde un día antes (el primer día local empieza el día anterior en UTC)", () => {
    expect(tmParams({ city: "Tokio", from: "2026-11-21", to: "2026-11-22" }, NOW)!.startDateTime).toBe("2026-11-20T00:00:00Z");
    expect(tmParams({ city: "Ciudad de México", from: "2026-11-21" }, NOW)!.startDateTime).toBe("2026-11-21T00:00:00Z");
  });
  it("la búsqueda real con el servidor simulado ya trae los eventos del fin de semana (antes: [])", async () => {
    const log: URL[] = [];
    const r = await searchTicketmaster({ city: "Ciudad de México", from: "2026-10-31", to: "2026-11-01", category: "eventos o conciertos", keyword: "eventos o conciertos" },
      { fetchImpl: discoveryFetch(log), apiKey: KEY, now: () => NOW });
    expect(r.ok).toBe(true);
    expect((r as any).results.map((e: any) => e.title)).toEqual(["Café Tacvba", "La Catrina: el musical", "Pumas vs America".replace("America", "América"), "Natalia Lafourcade", "Cirque du Soleil"]);
    expect(log[0].searchParams.get("apikey")).toBe(KEY);
  });
  it("sin nada con lo específico, se amplía gratis a todo lo de la ciudad y se dice que es ampliada", async () => {
    const tm = (q: any) => searchTicketmaster(q, { fetchImpl: discoveryFetch(), apiKey: KEY, now: () => NOW, store: memoryCacheStore(() => NOW) });
    const r = await runEventSearch({ city: "Ciudad de México", date_from: "2026-10-31", date_to: "2026-11-01", query: "conciertos de Coldplay" },
      { fetchImpl: (async () => { throw new Error("no debe gastar SerpApi"); }) as any, serpKey: "k", ticketmaster: tm, now: () => Date.now() });
    expect(r).toMatchObject({ ok: true, source: "ticketmaster", ampliada: true });
    expect((r.results as unknown[]).length).toBeGreaterThanOrEqual(3);
    expect(String(r.aviso)).toMatch(/no tiene eventos de «conciertos de Coldplay»/);
    expect(prepareToolResultForModel("search_events", r)).toMatchObject({ disponible: true, aviso: expect.stringMatching(/otros eventos en la ciudad/) });
  });
});

describe("#5 · presupuesto de tiempo: siempre regresa antes del tope y con el porqué", () => {
  it("Ticketmaster que nunca responde: a tiempo y con motivo (no un 'no respondió' mudo)", async () => {
    const t0 = Date.now();
    const r = await runEventSearch({ city: "Ciudad de México", date_from: "2026-10-31" }, {
      fetchImpl: (async () => new Promise(() => {})) as any, serpKey: "k", timeoutMs: 1500,
      ticketmaster: () => new Promise(() => {}),
    });
    expect(Date.now() - t0).toBeLessThan(1500);
    expect(r).toMatchObject({ error: "eventos_no_disponibles" });
    expect(String(r.motivo)).toMatch(/Ticketmaster tardó demasiado/);
    expect(String(r.motivo)).toMatch(/Google Events\) no alcanzó a responder a tiempo/);
    const p = prepareToolResultForModel("search_events", r);
    expect(String(p.motivo)).toMatch(/Ticketmaster tardó demasiado/);
  });
  it("Ticketmaster sin eventos y Google Events lento: regresa antes del tope como 'sin resultados' explicado", async () => {
    const t0 = Date.now();
    const r = await runEventSearch({ city: "Ciudad de México", date_from: "2026-10-31" }, {
      fetchImpl: (async () => new Promise(() => {})) as any, serpKey: "k", timeoutMs: 3500,
      ticketmaster: async () => ({ ok: true as const, source: "ticketmaster" as const, results: [], consulted_at: "2026-10-29T02:18:00Z" }),
    });
    expect(Date.now() - t0).toBeLessThan(3500);
    expect(r).toMatchObject({ ok: true, results: [], respaldo: "sin_tiempo" });
    const p = prepareToolResultForModel("search_events", r);
    expect(p).toMatchObject({ disponible: false, estado: "sin_resultados" });
    expect(String(p.motivo)).toMatch(/Ticketmaster no tiene eventos publicados.*no alcanzó a responder a tiempo/);
    expect(toolOutcome(p)).toEqual({ state: "empty", suffix: "sin resultados" });
  });
  it("tope diario de SerpApi (25): el respaldo no se intenta y se dice el límite de hoy", async () => {
    const brake = makeAccountBrake({ store: null, dailyBudget: 25, used: async () => 25 });
    const r = await runEventSearch({ city: "Ciudad de México", date_from: "2026-10-31" }, {
      fetchImpl: (async () => { throw new Error("no debe llamar a SerpApi"); }) as any, serpKey: "k", brake, timeoutMs: 14_500,
      ticketmaster: async () => ({ ok: true as const, source: "ticketmaster" as const, results: [], consulted_at: "2026-10-29T02:18:00Z" }),
    });
    expect(r).toMatchObject({ respaldo_en_pausa: "budget" });
    expect(prepareToolResultForModel("search_events", r)).toMatchObject({ estado: "limite_diario" });
  });
});
