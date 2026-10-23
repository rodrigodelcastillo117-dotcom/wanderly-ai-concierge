// IATOS Wrapped: métricas con datos de ejemplo (y sin datos), omisión de tarjetas vacías, fotos fuera
// de lo que se comparte salvo «Incluir mis fotos», aviso de diciembre/enero y carga con RLS + RPC.
import { describe, expect, it, vi } from "vitest";
import {
  buildCardSpec, buildWrappedCards, cardHasPhotos, computeWrapped, geocodeQueries, geoKey, rangeLabel, routeLayout,
  stepIndex, tripStops, tripsInYear, type WrappedInput, type WrappedTrip,
} from "@/lib/wrapped";
import { defaultWrappedYear, wrappedEntry, wrappedPromo, yearsWithTrips } from "@/lib/wrappedPromo";
import { loadWrapped, clearWrappedGeoCache, type WrappedClient } from "@/lib/wrappedApi";
import { wrapLines } from "@/lib/wrappedShare";
import { parseWrappedYear } from "@/pages/Wrapped";
import { FX_FALLBACK_TABLE } from "@/lib/fx";

const TODAY = "2026-10-22";
const trip = (o: Partial<WrappedTrip> & { id: string }): WrappedTrip => ({ destino: null, ciudad_origen: "Ciudad de México", ...o });

const LISBOA = trip({ id: "t1", destino: "Lisboa", pais_destino: "Portugal", fecha_salida: "2026-03-10", fecha_regreso: "2026-03-15" });
const ITALIA = trip({ id: "t2", destino: "Roma → Florencia", itinerario_json: { multi: true, destinations: ["Roma", "Florencia"] }, fecha_salida: "2026-07-01", fecha_regreso: "2026-07-14" });
// Se encima un día con Italia: el 14 de julio no cuenta dos veces.
const TOSCANA = trip({ id: "t3", destino: "Siena, Italia", fecha_salida: "2026-07-14", fecha_regreso: "2026-07-16" });
const KIOTO_PASADO = trip({ id: "t4", destino: "Kioto", pais_destino: "Japón", fecha_salida: "2025-05-01", fecha_regreso: "2025-05-12" });
const FUTURO = trip({ id: "t5", destino: "Tokio", fecha_salida: "2026-12-20", fecha_regreso: "2026-12-30" });
const SIN_FECHA = trip({ id: "t6", destino: "París" });

const COORDS = {
  [geoKey("Ciudad de México")]: { lat: 19.4326, lng: -99.1332 },
  [geoKey("Lisboa, Portugal")]: { lat: 38.7223, lng: -9.1393 },
  [geoKey("Roma, Italia")]: { lat: 41.9028, lng: 12.4964 },
  [geoKey("Florencia, Italia")]: { lat: 43.7696, lng: 11.2558 },
};

const full = (o: Partial<WrappedInput> = {}): WrappedInput => ({
  year: 2026, today: TODAY, firstName: "Rodrigo del Castillo", avatarUrl: "https://cdn.example/avatar.png", homeCity: "Ciudad de México",
  trips: [LISBOA, ITALIA, TOSCANA, KIOTO_PASADO, FUTURO, SIN_FECHA],
  moments: [
    { id: "m1", trip_id: "t1", caption: "Atardecer en Alfama", destino: "Lisboa", created_at: "2026-03-12T19:00:00Z", tags: ["cultura"], photoUrl: "https://signed/m1" },
    { id: "m2", trip_id: "t2", caption: "La mejor pasta de mi vida", destino: "Roma", created_at: "2026-07-03T13:00:00Z", tags: ["gastronomía", "cultura"], photoUrl: "https://signed/m2" },
    { id: "m3", trip_id: "t4", caption: "Kioto 2025", destino: "Kioto", created_at: "2025-05-02T10:00:00Z", tags: [], photoUrl: "https://signed/m3" },
    { id: "m4", trip_id: null, caption: null, destino: null, created_at: "2026-08-01T10:00:00Z", tags: [], photoUrl: null },
  ],
  journal: [{ id: "j1", trip_id: "t2", text: "Caminamos todo Trastevere", created_at: "2026-07-02T20:00:00Z", photoUrl: "https://signed/j1" }],
  expenses: [
    { amount: 1200, currency: "MXN", category: "Restaurantes", expense_date: "2026-03-11" },
    { amount: 8000, currency: "MXN", category: "hotel", expense_date: "2026-07-02" },
    { amount: 999, currency: "MXN", category: "Vuelos", expense_date: "2025-05-01" },
  ],
  visits: [{ category: "museum", visited_at: "2026-07-05T10:00:00Z" }, { category: "restaurant", visited_at: "2026-07-06T10:00:00Z" }],
  visitedPlaces: [{ visited_at: "2026-07-05T10:00:00Z" }, { visited_at: "2025-01-01T10:00:00Z" }],
  badges: [{ nombre: "Primer viaje", icono: "✈️", unlocked_at: "2026-03-16T00:00:00Z" }, { nombre: "Viejo", icono: null, unlocked_at: "2025-03-16T00:00:00Z" }],
  companions: [{ name: "Carlos Ruiz", shared_trips: 2 }, { name: "lia.viaja", shared_trips: 1 }],
  coords: COORDS,
  ...o,
});

describe("viajes del año", () => {
  it("solo los que salieron ese año y ya empezaron; sin fecha no cuentan", () => {
    expect(tripsInYear(full().trips, 2026, TODAY).map((t) => t.id)).toEqual(["t1", "t2", "t3"]);
    expect(tripsInYear(full().trips, 2025, TODAY).map((t) => t.id)).toEqual(["t4"]);
    expect(yearsWithTrips(full().trips, TODAY)).toEqual([2026, 2025]);
  });

  it("paradas: ruta multidestino, «→», país solo y «Ciudad, País»", () => {
    expect(tripStops(ITALIA).map((s) => [s.label, s.country?.code, s.isCity])).toEqual([["Roma", "IT", true], ["Florencia", "IT", true]]);
    expect(tripStops(trip({ id: "x", destino: "París → Roma" })).map((s) => s.label)).toEqual(["París", "Roma"]);
    expect(tripStops(trip({ id: "x", destino: "Japón" }))[0]).toMatchObject({ label: "Japón", isCity: false, country: { code: "JP" } });
    expect(tripStops(TOSCANA)[0]).toMatchObject({ label: "Siena", isCity: true, country: { code: "IT" }, query: "Siena, Italia" });
  });

  it("consultas de geocodificación sin repetir (origen + destinos)", () => {
    expect(geocodeQueries([LISBOA, ITALIA], null)).toEqual(["Ciudad de México", "Lisboa, Portugal", "Roma, Italia", "Florencia, Italia"]);
  });
});

describe("métricas con datos reales de ejemplo", () => {
  const s = computeWrapped(full());

  it("viajes y días fuera (sin contar dos veces el día encimado)", () => {
    expect(s.trips.map((t) => t.label)).toEqual(["Lisboa", "Roma · Florencia", "Siena"]);
    // 6 (10–15 mar) + 14 (1–14 jul) + 2 (15–16 jul; el 14 ya contaba) = 22
    expect(s.daysAway).toBe(22);
    expect(s.firstName).toBe("Rodrigo");
  });

  it("países y ciudades (sin la ciudad de origen)", () => {
    expect(s.countries.map((c) => c.name)).toEqual(["Portugal", "Italia"]);
    expect(s.countries[0].flag).toBe("🇵🇹");
    expect(s.cities).toEqual(["Lisboa", "Roma", "Florencia", "Siena"]);
    expect(s.visitedPlaces).toBe(1);
  });

  it("kilómetros con haversine: ida, entre destinos y vuelta; Siena sin coordenadas no suma", () => {
    expect(s.km).not.toBeNull();
    // CDMX–Lisboa ≈ 8,670 km ×2; CDMX–Roma ≈ 10,240; Roma–Florencia ≈ 230; Florencia–CDMX ≈ 10,090
    expect(s.km!.total).toBeGreaterThan(37000);
    expect(s.km!.total).toBeLessThan(39000);
    expect(s.km!.tripsWithRoute).toBe(2);
    expect(s.km!.tripsTotal).toBe(3);
    expect(s.km!.points).toHaveLength(4);
    const spec = buildCardSpec("km", s, { includePhotos: false });
    expect(spec.footnote).toContain("Incluye 2 de 3 viajes");
    expect(spec.body).toMatch(/% de una vuelta al mundo/);
  });

  it("viaje más largo y mes más viajero", () => {
    expect(s.longest).toMatchObject({ label: "Roma · Florencia", days: 14 });
    expect(rangeLabel(s.longest!.start, s.longest!.end)).toBe("1 – 14 de julio");
    expect(s.topMonth).toEqual({ month: 6, days: 16 });
    expect(s.months[2]).toBe(6);
  });

  it("fotos: solo tus momentos y tu diario de ese año; el favorito es el momento con más etiquetas", () => {
    expect(s.photos.map((p) => p.url)).toEqual(["https://signed/m1", "https://signed/m2", "https://signed/j1"]);
    expect(s.favorite).toMatchObject({ text: "La mejor pasta de mi vida", place: "Roma", when: "julio 2026", photoUrl: "https://signed/m2" });
  });

  it("gastos del año en su moneda, compañeros, logros del año y tipo de viajero", () => {
    expect(s.spend).toMatchObject({ total: 9200, currency: "MXN", count: 2, topCategory: "Hospedaje", note: null });
    expect(buildCardSpec("spend", s, { includePhotos: false }).big).toBe("$9,200 MXN");
    expect(s.companions[0]).toEqual({ name: "Carlos Ruiz", shared_trips: 2 });
    expect(s.badges).toEqual([{ nombre: "Primer viaje", icono: "✈️" }]);
    expect(s.dna?.label).toBeTruthy();
  });

  it("todas las tarjetas, en orden", () => {
    expect(buildWrappedCards(s)).toEqual(["cover", "trips", "places", "km", "longest", "month", "photos", "moment", "companions", "spend", "badges", "dna", "outro"]);
  });

  it("varias monedas: se convierte a MXN y se dice con qué tipo de cambio; sin tasa no se suma", () => {
    const m = computeWrapped(full({
      expenses: [
        { amount: 100, currency: "USD", category: "Vuelos", expense_date: "2026-03-10" },
        { amount: 1000, currency: "MXN", category: "Restaurantes", expense_date: "2026-03-11" },
        { amount: 50, currency: "XYZ", category: "Otros", expense_date: "2026-03-12" },
      ],
      fx: FX_FALLBACK_TABLE,
    }));
    expect(m.spend).toMatchObject({ total: 3050, currency: "MXN", count: 3 });
    expect(m.spend!.note).toContain("Convertido a MXN");
    expect(m.spend!.note).toContain("Sin convertir: XYZ.");
  });
});

describe("sin datos: las tarjetas se omiten (nunca cifras de relleno)", () => {
  it("sin viajes en el año: ninguna tarjeta", () => {
    const s = computeWrapped(full({ year: 2024 }));
    expect(s.trips).toEqual([]);
    expect(buildWrappedCards(s)).toEqual([]);
  });

  it("solo un viaje sin fotos, coordenadas, gastos ni compañeros", () => {
    const s = computeWrapped({ year: 2026, today: TODAY, trips: [trip({ id: "u", destino: "Mérida, Yucatán", fecha_salida: "2026-02-01", fecha_regreso: "2026-02-03" })] });
    expect(s.km).toBeNull();
    expect(s.longest).toBeNull();
    expect(s.topMonth).toBeNull();
    expect(s.spend).toBeNull();
    expect(s.favorite).toBeNull();
    expect(s.firstName).toBeNull();
    const cards = buildWrappedCards(s);
    expect(cards).not.toContain("km");
    expect(cards).not.toContain("photos");
    expect(cards).not.toContain("companions");
    expect(cards).not.toContain("spend");
    expect(cards).not.toContain("month");
    expect(cards[0]).toBe("cover");
    expect(cards.at(-1)).toBe("outro");
    expect(buildCardSpec("cover", s, { includePhotos: true }).body).toBe("Esto fue lo que viviste.");
  });

  it("un destino que no se reconoce no inventa país", () => {
    const s = computeWrapped({ year: 2026, today: TODAY, trips: [trip({ id: "u", destino: "Pueblo Desconocido", ciudad_origen: null, fecha_salida: "2026-02-01" })] });
    expect(s.countries).toEqual([]);
    expect(s.cities).toEqual(["Pueblo Desconocido"]);
    expect(s.daysAway).toBe(1);
  });

  it("gastos en cero o de otro año no hacen tarjeta", () => {
    const s = computeWrapped(full({ expenses: [{ amount: 0, currency: "MXN", category: "Otros", expense_date: "2026-03-01" }, { amount: 50, currency: "MXN", category: "Otros", expense_date: "2025-03-01" }] }));
    expect(s.spend).toBeNull();
    expect(buildWrappedCards(s)).not.toContain("spend");
  });
});

describe("compartir: las fotos no van salvo «Incluir mis fotos»", () => {
  const s = computeWrapped(full());
  it("collage: sin fotos solo marcos privados; con el interruptor, las URLs", () => {
    const off = buildCardSpec("photos", s, { includePhotos: false });
    expect(off.photos).toBeUndefined();
    expect(off.privatePhotos).toBe(3);
    expect(JSON.stringify(off)).not.toContain("https://signed");
    const on = buildCardSpec("photos", s, { includePhotos: true });
    expect(on.photos?.map((p) => p.url)).toEqual(["https://signed/m1", "https://signed/m2", "https://signed/j1"]);
  });
  it("portada sin avatar y momento sin foto por defecto", () => {
    expect(buildCardSpec("cover", s, { includePhotos: false }).avatar).toBeNull();
    expect(buildCardSpec("moment", s, { includePhotos: false }).photo).toBeNull();
    expect(buildCardSpec("cover", s, { includePhotos: true }).avatar).toBe("https://cdn.example/avatar.png");
    for (const k of buildWrappedCards(s)) expect(JSON.stringify(buildCardSpec(k, s, { includePhotos: false }))).not.toMatch(/https:\/\/(signed|cdn\.example)/);
  });
  it("de otras personas solo va el nombre", () => {
    const spec = buildCardSpec("companions", s, { includePhotos: true });
    expect(spec).toMatchObject({ title: "Carlos Ruiz", big: "2", bigUnit: "viajes juntos" });
    expect(spec.list).toEqual([{ text: "lia.viaja", meta: "1 viaje" }]);
  });
  it("solo las tarjetas con fotos ofrecen el interruptor", () => {
    expect(cardHasPhotos("photos", s)).toBe(true);
    expect(cardHasPhotos("km", s)).toBe(false);
  });
});

describe("navegación y utilidades", () => {
  it("stepIndex no se sale de las tarjetas", () => {
    expect(stepIndex(0, 5, -1)).toBe(0);
    expect(stepIndex(0, 5, 1)).toBe(1);
    expect(stepIndex(4, 5, 1)).toBe(4);
    expect(stepIndex(0, 0, 1)).toBe(0);
  });
  it("ruta normalizada en [0..1]", () => {
    const r = routeLayout([{ lat: 0, lng: 0, label: "A" }, { lat: 10, lng: 20, label: "B" }], [[0, 1]]);
    expect(r.labels).toEqual(["A", "B"]);
    expect(r.grid.xs.length).toBeGreaterThan(0);
    for (const [x, y] of r.points) { expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThanOrEqual(1); expect(y).toBeGreaterThanOrEqual(0); expect(y).toBeLessThanOrEqual(1); }
  });
  it("wrapLines corta con «…» sin pasarse del ancho", () => {
    const ctx = { measureText: (t: string) => ({ width: t.length * 10 }) } as unknown as CanvasRenderingContext2D;
    const lines = wrapLines(ctx, "uno dos tres cuatro cinco seis siete ocho", 100, 2);
    expect(lines).toHaveLength(2);
    expect(lines[1].endsWith("…")).toBe(true);
    for (const l of lines) expect(l.length * 10).toBeLessThanOrEqual(100);
  });
  it("año de la URL", () => {
    expect(parseWrappedYear(undefined, TODAY)).toBeNull();
    expect(parseWrappedYear("2025", TODAY)).toBe(2025);
    expect(parseWrappedYear("2027", TODAY)).toBe("invalid");
    expect(parseWrappedYear("abc", TODAY)).toBe("invalid");
    expect(parseWrappedYear("1999", TODAY)).toBe("invalid");
  });
});

describe("aviso de diciembre y enero", () => {
  const trips = [{ fecha_salida: "2026-03-10" }, { fecha_salida: "2025-06-01" }];
  it("diciembre: destacado del año en curso", () => {
    expect(wrappedPromo("2026-12-05", trips)).toMatchObject({ year: 2026, featured: true, title: "Tu año en viajes 2026 ya está listo", href: "/wrapped/2026" });
  });
  it("enero: destacado del año que terminó", () => {
    expect(wrappedPromo("2027-01-10", trips)).toMatchObject({ year: 2026, featured: true, title: "Tu año en viajes 2026 ya está listo" });
  });
  it("el resto del año: acceso discreto; sin viajes ese año, nada", () => {
    expect(wrappedPromo("2026-10-22", trips)).toMatchObject({ year: 2026, featured: false });
    expect(wrappedPromo("2026-10-22", [{ fecha_salida: "2026-11-01" }])).toBeNull();
    expect(wrappedEntry("2026-10-22")?.featured).toBe(false);
  });
  it("año por defecto de /wrapped", () => {
    expect(defaultWrappedYear("2027-01-10", [2026])).toBe(2026);
    expect(defaultWrappedYear("2026-10-22", [2026, 2025])).toBe(2026);
  });
});

describe("carga: solo consultas propias (RLS) + RPC de compañeros, fotos firmadas", () => {
  it("pide filas del usuario, firma fotos privadas y geocodifica una vez", async () => {
    clearWrappedGeoCache();
    const calls: Array<{ table: string; ops: Array<[string, unknown[]]> }> = [];
    const data: Record<string, unknown> = {
      profiles: { full_name: "Rodrigo del Castillo", ciudad_origen: "Ciudad de México", avatar_url: "https://cdn.example/a.png" },
      trips: [LISBOA],
      trip_collaborators: [],
      travel_moments: [{ id: "m1", trip_id: "t1", caption: "Alfama", destino: "Lisboa", created_at: "2026-03-12T10:00:00Z", tags: [], image_path: "u1/m1.jpg", image_url: null }],
      trip_journal_entries: [],
      expenses: [], user_visits: [], visited_places: [], user_badges: [],
    };
    const from = (table: string) => {
      const rec = { table, ops: [] as Array<[string, unknown[]]> };
      calls.push(rec);
      const q: Record<string, unknown> = {};
      for (const op of ["select", "eq", "in", "gte", "lte", "order", "limit"]) q[op] = (...a: unknown[]) => { rec.ops.push([op, a]); return q; };
      q.maybeSingle = async () => ({ data: data[table], error: null });
      q.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve({ data: data[table] ?? [], error: null }).then(res, rej);
      return q;
    };
    const rpc = vi.fn(async () => ({ data: [{ name: "Carlos Ruiz", shared_trips: 1 }], error: null }));
    const invoke = vi.fn(async (_fn: string, { body }: { body: { address: string } }) => ({ data: { results: [COORDS[geoKey(body.address)] ?? { lat: 38.72, lng: -9.14 }] }, error: null }));
    const createSignedUrls = vi.fn(async (paths: string[]) => ({ data: paths.map((p) => ({ path: p, signedUrl: `https://signed/${p}` })), error: null }));
    const client = { from, rpc, functions: { invoke }, storage: { from: (bucket: string) => ({ createSignedUrls: (p: string[], ttl: number) => { expect(bucket).toBe("travel-moments-private"); expect(ttl).toBe(3600); return createSignedUrls(p); } }) } } as unknown as WrappedClient;

    const { stats, years } = await loadWrapped(client, "u1", 2026, TODAY);
    expect(years).toEqual([2026]);
    expect(rpc).toHaveBeenCalledWith("wrapped_companions", { p_year: 2026 });
    expect(stats.photos.map((p) => p.url)).toEqual(["https://signed/u1/m1.jpg"]);
    expect(stats.companions).toEqual([{ name: "Carlos Ruiz", shared_trips: 1 }]);
    expect(stats.km?.total).toBeGreaterThan(17000);
    // Cada tabla personal se filtra por el usuario en sesión.
    const filt = (t: string) => calls.filter((c) => c.table === t).flatMap((c) => c.ops.filter(([op]) => op === "eq").map(([, a]) => a));
    expect(filt("travel_moments")).toContainEqual(["user_id", "u1"]);
    expect(filt("trip_journal_entries")).toContainEqual(["author_id", "u1"]);
    expect(filt("expenses")).toContainEqual(["user_id", "u1"]);
    expect(filt("trip_collaborators")).toContainEqual(["status", "accepted"]);
    // Segunda carga: las coordenadas ya están en memoria.
    const before = invoke.mock.calls.length;
    await loadWrapped(client, "u1", 2026, TODAY);
    expect(invoke.mock.calls.length).toBe(before);
  });
});
