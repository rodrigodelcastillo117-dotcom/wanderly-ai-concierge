// Google Places API (New): máscaras de campos ↔ SKU, normalización en español, "abierto ahora" en
// la zona del lugar, errores, peticiones juntadas, place_id en caché (único dato que se puede
// guardar) y restaurantes reales. Sin llamadas reales: fetch simulado + fixtures con el formato
// documentado (src/test/fixtures/googlemax).
import { describe, it, expect, vi } from "vitest";
import fixture from "./fixtures/googlemax/places_text_search_restaurants.json";
import errors from "./fixtures/googlemax/google_errors.json";
import {
  classifyGoogleError, coalesce, createGoogleTransport, GATEWAY_BASE, googleListPriceUsd, timeZoneAt,
} from "../../supabase/functions/_shared/google-maps";
import {
  fieldMask, findPlaceId, hoursToday, isOpenAt, localClock, normalizePlace, placeCard, placeDetails, priceLevelEs,
  rankByQuality, restaurantFromPlace, searchNearby, searchText, skuFor, textSearchBody,
} from "../../supabase/functions/_shared/google-places";
import { enforceRestaurants, restaurantQuery, suggestRestaurants } from "../../supabase/functions/_shared/google-restaurants";
import { memoryCacheStore } from "../../supabase/functions/_shared/serpCache";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const AT = "2026-10-24T05:50:00.000Z"; // viernes 23 de octubre, 23:50 en Ciudad de México

function gateway(responder: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const f = vi.fn(async (url: string, init: RequestInit) => responder(url, init));
  const t = createGoogleTransport({ mapsKey: "AIzaSECRETOdePruebas000000000", lovableKey: "LOVABLE_SECRETO", fetch: f as unknown as typeof fetch })!;
  return { t, f };
}

describe("máscaras de campos y SKU (lo que cobra Google)", () => {
  it("cada preset pide solo sus campos y declara su SKU", () => {
    expect(fieldMask("text", "ids")).toBe("places.id");
    expect(skuFor("text", "ids")).toBe("Text Search Essentials (IDs Only)");
    expect(skuFor("text", "basic")).toBe("Text Search Pro");
    expect(skuFor("text", "rich")).toBe("Text Search Enterprise");
    expect(skuFor("text", "atmosphere")).toBe("Text Search Enterprise + Atmosphere");
    expect(skuFor("nearby", "rich")).toBe("Nearby Search Enterprise");
    expect(skuFor("details", "atmosphere")).toBe("Place Details Enterprise + Atmosphere");
    const basic = fieldMask("text", "basic");
    // Pro no debe pedir campos Enterprise (rating, priceLevel, horario…) ni Atmosphere.
    expect(basic).not.toMatch(/rating|priceLevel|OpeningHours|websiteUri|reservable|editorialSummary/);
    const rich = fieldMask("text", "rich");
    expect(rich).toMatch(/places\.rating/);
    expect(rich).not.toMatch(/reservable|editorialSummary|servesDinner|reviews/);
    const atm = fieldMask("details", "atmosphere");
    expect(atm.split(",")).toEqual(expect.arrayContaining(["reservable", "servesDinner", "editorialSummary", "timeZone", "utcOffsetMinutes"]));
    // Nunca se pide "*" (cobraría el SKU más caro).
    for (const p of ["ids", "basic", "rich", "atmosphere"] as const) expect(fieldMask("text", p)).not.toContain("*");
  });

  it("precio de lista por SKU (pricing oficial consultado 2026-10-22)", () => {
    expect(googleListPriceUsd("Text Search Enterprise + Atmosphere")).toBe(0.04);
    expect(googleListPriceUsd("Compute Routes Essentials")).toBe(0.005);
    expect(googleListPriceUsd("Text Search Essentials (IDs Only)")).toBe(0);
    expect(googleListPriceUsd("desconocido")).toBe(0);
  });

  it("cuerpo de Text Search: consulta limpia, tamaño acotado y sesgo de ubicación", () => {
    const b = textSearchBody({ query: "  restaurantes   en   CDMX ", maxResults: 99, near: { lat: 19.4, lng: -99.1, radius: 999999 }, includedType: "restaurant", minRating: 4.26 });
    expect(b).toMatchObject({ textQuery: "restaurantes en CDMX", pageSize: 20, includedType: "restaurant", minRating: 4.5, languageCode: "es" });
    expect((b.locationBias as any).circle.radius).toBe(50000);
  });
});

describe("normalización en español y horario en la zona del lugar", () => {
  const [pujol, contramar, cerrado, taqueria] = fixture.places;

  it("nivel de precio traducido y rango de precio por persona", () => {
    expect(priceLevelEs("PRICE_LEVEL_MODERATE")).toEqual({ label: "Precio moderado", symbol: "$$" });
    expect(priceLevelEs("PRICE_LEVEL_VERY_EXPENSIVE")?.label).toBe("Muy caro");
    expect(priceLevelEs(undefined)).toBeNull();
    const p = normalizePlace(pujol, AT);
    expect(p).toMatchObject({
      place_id: "ChIJpujol0000000000000001", name: "Pujol", rating: 4.6, user_rating_count: 5321,
      price_level_label: "Muy caro", price_symbol: "$$$$", primary_type_label: "Restaurante mexicano",
      website: "https://pujol.com.mx/", phone: "+52 55 5545 4111", reservable: true, time_zone: "America/Mexico_City",
      fuente: "google_places", estado_dato: "CONSULTADO_EN_VIVO", consultado_at: AT, atribucion: "Google Maps",
    });
    expect(p.price_range).toEqual({ min: 2000, max: 4000, currency: "MXN", text: "MXN 2,000–4,000" });
    expect(p.serves.dinner).toBe(true);
    expect(p.photos[0]).toEqual({ ref: "places/ChIJpujol0000000000000001/photos/AUc7tXfoto1", width: 4032, height: 3024, attributions: [{ name: "Ana López", uri: "https://maps.google.com/maps/contrib/123" }] });
    expect(p.photo_ref).toBe("places/ChIJpujol0000000000000001/photos/AUc7tXfoto1");
  });

  it("abierto ahora calculado en la hora local del lugar, incluso cruzando medianoche", () => {
    const periods = pujol.regularOpeningHours.periods;
    const at = (iso: string) => isOpenAt(periods, localClock(Date.parse(iso), "America/Mexico_City", null));
    expect(at("2026-10-24T05:50:00Z")).toBe(true); // viernes 23:50
    expect(at("2026-10-24T06:15:00Z")).toBe(true); // sábado 00:15 (sigue el turno del viernes)
    expect(at("2026-10-25T06:15:00Z")).toBe(true); // domingo 00:15 (turno del sábado, cruza la semana)
    expect(at("2026-10-25T21:00:00Z")).toBe(false); // domingo 15:00: cerrado
    expect(at("2026-10-26T18:00:00Z")).toBe(false); // lunes 12:00: aún no abre
    expect(at("2026-10-26T20:00:00Z")).toBe(true); // lunes 14:00
    // La misma hora UTC en Madrid es otra hora local: la zona sí importa.
    expect(localClock(Date.parse("2026-10-24T05:50:00Z"), "Europe/Madrid", null)).toEqual({ day: 6, minutes: 7 * 60 + 50 });
    expect(isOpenAt([], localClock(0, "UTC", null))).toBeNull();
    // Sin zona IANA se usa el desfase UTC del lugar.
    expect(localClock(Date.parse("2026-10-24T05:50:00Z"), null, -360)).toEqual({ day: 5, minutes: 23 * 60 + 50 });
  });

  it("24 horas, openNow de Google cuando viene y horario de hoy", () => {
    const p = normalizePlace(pujol, AT);
    expect(p.open_now).toBe(true);
    expect(p.open_now_source).toBe("calculado");
    expect(p.hours_today).toBe("viernes: 13:00–0:30");
    expect(hoursToday(pujol.regularOpeningHours.weekdayDescriptions, { day: 0 })).toBe("domingo: Cerrado");
    const c = normalizePlace(contramar, AT);
    expect(c).toMatchObject({ open_now: false, open_now_source: "google" });
    expect(normalizePlace(taqueria, AT).open_now).toBe(true);
    expect(normalizePlace(cerrado, AT).closed).toBe(true);
  });
});

describe("llamadas: transporte, errores y peticiones juntadas", () => {
  it("Text Search por el conector: máscara en el encabezado, llave fuera de la URL, cerrados fuera", async () => {
    const { t, f } = gateway(() => json(fixture));
    const r = await searchText(t, { query: "restaurantes en CDMX", preset: "atmosphere", includedType: "restaurant" }, { now: () => Date.parse(AT) });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.sku).toBe("Text Search Enterprise + Atmosphere");
    expect(r.places.map((p) => p.name)).toEqual(["Pujol", "Contramar", "Taquería 24 horas"]);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${GATEWAY_BASE}/places/v1/places:searchText`);
    expect(url).not.toMatch(/AIza|key=/);
    const h = init.headers as Record<string, string>;
    expect(h["X-Goog-FieldMask"]).toContain("places.reservable");
    expect(h["X-Connection-Api-Key"]).toBe("AIzaSECRETOdePruebas000000000");
    expect(JSON.parse(String(init.body))).toMatchObject({ textQuery: "restaurantes en CDMX", includedType: "restaurant" });
  });

  it("modo directo: X-Goog-Api-Key para APIs nuevas; sin llave no hay transporte", async () => {
    const f = vi.fn(async () => json({ places: [] }));
    const t = createGoogleTransport({ mapsKey: "AIzaDIRECTO00000000000000000", fetch: f as unknown as typeof fetch })!;
    expect(t.mode).toBe("direct");
    await searchNearby(t, { lat: 19.4, lng: -99.1, includedTypes: ["bar"], preset: "basic" });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://places.googleapis.com/v1/places:searchNearby");
    expect((init.headers as Record<string, string>)["X-Goog-Api-Key"]).toBe("AIzaDIRECTO00000000000000000");
    expect(createGoogleTransport({ mapsKey: "" })).toBeNull();
  });

  it("clasifica errores: API deshabilitada, cuota, llave inválida, y las APIs anteriores", () => {
    expect(classifyGoogleError(403, errors.disabled).kind).toBe("disabled");
    expect(classifyGoogleError(429, errors.quota).kind).toBe("quota");
    expect(classifyGoogleError(400, errors.invalid_key).kind).toBe("denied");
    expect(classifyGoogleError(200, errors.legacy_disabled).kind).toBe("disabled");
    expect(classifyGoogleError(200, errors.legacy_over_limit).kind).toBe("quota");
    expect(classifyGoogleError(500, { error: { message: "boom key=AIzaSyFILTRADA00000000000000" } }).message).not.toMatch(/AIza/);
  });

  it("un error de Google se devuelve tal cual (nunca se inventa una lista)", async () => {
    const { t } = gateway(() => json(errors.disabled, 403));
    const r = await searchText(t, { query: "museos en Roma" });
    expect(r).toMatchObject({ ok: false, error: { kind: "disabled" } });
  });

  it("dos búsquedas idénticas al mismo tiempo pagan una sola llamada", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const { t, f } = gateway(async () => { await gate; return json(fixture); });
    const a = searchText(t, { query: "tacos en CDMX" });
    const b = searchText(t, { query: "tacos en CDMX" });
    release();
    const [ra, rb] = await Promise.all([a, b]);
    expect(f).toHaveBeenCalledTimes(1);
    expect(ra).toBe(rb);
    // Ya terminó: no queda guardada (no es una caché de contenido).
    await searchText(t, { query: "tacos en CDMX" });
    expect(f).toHaveBeenCalledTimes(2);
    const m = new Map<string, Promise<unknown>>();
    await coalesce("x", async () => 1, m);
    expect(m.size).toBe(0);
  });

  it("Place Details valida el id y usa GET con la máscara sin prefijo", async () => {
    const { t, f } = gateway(() => json(fixture.places[0]));
    const bad = await placeDetails(t, "../../etc");
    expect(bad).toMatchObject({ ok: false, error: { kind: "invalid_request" } });
    const r = await placeDetails(t, "places/ChIJpujol0000000000000001", { preset: "rich" });
    expect(r.ok && r.place.name).toBe("Pujol");
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${GATEWAY_BASE}/places/v1/places/ChIJpujol0000000000000001?languageCode=es`);
    expect(init.method).toBe("GET");
    expect((init.headers as Record<string, string>)["X-Goog-FieldMask"]).not.toContain("places.");
  });

  it("findPlaceId: Text Search IDs Only (gratis) y en caché solo el place_id, 30 días", async () => {
    const { t, f } = gateway(() => json({ places: [{ id: "ChIJsoloElId0000000001" }] }));
    const store = memoryCacheStore();
    expect(await findPlaceId(t, "Pujol, Ciudad de México", store)).toBe("ChIJsoloElId0000000001");
    expect(await findPlaceId(t, "Pujol,  Ciudad de México", store)).toBe("ChIJsoloElId0000000001");
    expect(f).toHaveBeenCalledTimes(1);
    expect((f.mock.calls[0][1] as RequestInit & { headers: Record<string, string> }).headers["X-Goog-FieldMask"]).toBe("places.id");
    const [row] = [...store.rows.values()];
    expect(row).toMatchObject({ engine: "gplaces_id", ttl_seconds: 30 * 86400, response: { place_id: "ChIJsoloElId0000000001" } });
    expect(Object.keys(row.response as object)).toEqual(["place_id"]);
  });

  it("Time Zone API: zona IANA y desfase", async () => {
    const { t, f } = gateway(() => json({ status: "OK", timeZoneId: "Europe/Madrid", rawOffset: 3600, dstOffset: 3600, timeZoneName: "CEST" }));
    const r = await timeZoneAt(t, 40.4, -3.7, Date.parse("2026-07-01T00:00:00Z"));
    expect(r).toMatchObject({ ok: true, time_zone: "Europe/Madrid", utc_offset_minutes: 120 });
    expect(String(f.mock.calls[0][0])).toBe(`${GATEWAY_BASE}/maps/api/timezone/json?location=40.4%2C-3.7&timestamp=1782864000`);
    const { t: t2 } = gateway(() => json(errors.legacy_disabled));
    expect(await timeZoneAt(t2, 1, 1)).toMatchObject({ ok: false, error: { kind: "disabled" } });
  });
});

describe("restaurantes reales (suggest-restaurants y analizar-viaje)", () => {
  const places = fixture.places.map((p) => normalizePlace(p, AT)).filter((p) => !p.closed);

  it("ordena por calidad ponderada por reseñas (4.9 con 3 reseñas no gana)", () => {
    const all = fixture.places.map((p) => normalizePlace(p, AT));
    expect(rankByQuality(all).map((p) => p.name).slice(0, 2)).toEqual(["Pujol", "Contramar"]);
  });

  it("restaurante de Google con fuente, fecha y datos reales (sin inventar precio)", () => {
    const r = restaurantFromPlace(places[0], "Ciudad de México");
    expect(r).toMatchObject({
      nombre: "Pujol", ciudad: "Ciudad de México", cocina: "Restaurante mexicano", rango_precio: "MXN 2,000–4,000",
      rating: 4.6, num_reviews: 5321, reservable: true, fuente: "google_places", estado_dato: "CONSULTADO_EN_VIVO",
      consultado_at: AT, cta_action: "https://pujol.com.mx/", maps_url: "https://maps.google.com/?cid=111",
    });
    expect(String(r.tip)).toMatch(/^Acepta reservaciones/);
    const sinPrecio = restaurantFromPlace({ ...places[0], price_range: null, price_symbol: null }, "CDMX");
    expect(sinPrecio.rango_precio).toBe("Precio no publicado");
    expect(restaurantQuery("Roma", "vegetariana")).toBe("restaurantes vegetariana en Roma");
  });

  it("con lista de Google: quita los inventados, conserva el 'por qué' y completa con reales", () => {
    const model = [
      { nombre: "PUJOL", cocina: "x", rango_precio: "$", por_que: "El mejor menú degustación." },
      { nombre: "La Trattoria Inventada", cocina: "italiana", rango_precio: "$$", por_que: "..." },
    ];
    const { restaurantes, quitados } = enforceRestaurants(model, places, "CDMX", 3);
    expect(quitados).toBe(1);
    expect(restaurantes.map((r) => r.nombre)).toEqual(["Pujol", "Contramar", "Taquería 24 horas"]);
    expect(restaurantes[0]).toMatchObject({ por_que: "El mejor menú degustación.", rango_precio: "MXN 2,000–4,000", fuente: "google_places" });
    expect(restaurantes.every((r) => r.fuente === "google_places")).toBe(true);
  });

  it("sin lista de Google: se conservan como sugerencia sin verificar, sin calificaciones del modelo", () => {
    const { restaurantes } = enforceRestaurants([{ nombre: "X Y", rating: 5, fuente: "perplexity", consultado_at: "hoy" }], [], "CDMX");
    expect(restaurantes[0]).toMatchObject({ fuente: "perplexity", estado_dato: "ESTIMADO", verificado: false });
    expect(restaurantes[0].rating).toBeUndefined();
    expect(restaurantes[0].consultado_at).toBeUndefined();
  });

  it("suggestRestaurants: una búsqueda por ciudad; si Google falla dice 'no disponible' (nunca IA)", async () => {
    const { t, f } = gateway((url, init) => {
      const q = JSON.parse(String(init.body)).textQuery as string;
      return q.includes("Roma") ? json(errors.quota, 429) : json(fixture);
    });
    const out = await suggestRestaurants(t, { cities: ["Ciudad de México", "Roma", "", null] });
    expect(f).toHaveBeenCalledTimes(2);
    expect(out.ok).toBe(true);
    expect(out.restaurantes).toHaveLength(3);
    expect(out.fallas).toEqual([{ ciudad: "Roma", motivo: expect.stringMatching(/límite de consultas/) }]);
    const { t: down } = gateway(() => json(errors.disabled, 403));
    const none = await suggestRestaurants(down, { cities: ["Roma"] });
    expect(none).toMatchObject({ ok: false, disponible: false, restaurantes: [] });
    expect(none.motivo).toMatch(/no está disponible/);
  });

  it("placeCard: misma forma que tripadvisor-search, foto por place-photo (photo_ref)", () => {
    const c = placeCard(places[0], "attractions");
    expect(c).toMatchObject({ id: places[0].place_id, name: "Pujol", num_reviews: 5321, web_url: "https://maps.google.com/?cid=111", photos: [], fuente: "google_places" });
    expect(c.photo_ref).toMatch(/^places\/.+\/photos\//);
  });
});
