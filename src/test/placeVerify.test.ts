// Lugares reales, fase 1 (motor general): validación de restaurantes y tours antes de mostrarlos,
// ningún enlace escrito por la IA, Members Only sin lo inventado y presupuesto de tiempo.
// Sin llamadas reales: Places API (New) simulada con el formato documentado y los viajes reales de
// src/test/fixtures (España multidestino y Tokio).
import { describe, it, expect, vi } from "vitest";
import espana from "./fixtures/espanaMultidestinoLogistics.json";
import tokio from "./fixtures/demo23octTokio.json";
import placesFixture from "./fixtures/googlemax/places_text_search_restaurants.json";
import { createGoogleTransport } from "../../supabase/functions/_shared/google-maps";
import { fieldMask, normalizePlace, skuFor } from "../../supabase/functions/_shared/google-places";
import { enforceRestaurants, verifyRestaurants } from "../../supabase/functions/_shared/google-restaurants";
import {
  makeResolver, mapsPlaceUrl, namesMatch, resolvePlace, verifyAll, verifyTours, VERIFY_SKU,
} from "../../supabase/functions/_shared/place-verify";
import { memoryCacheStore } from "../../supabase/functions/_shared/serpCache";
import { offerFromTripRestaurant } from "../../supabase/functions/_shared/booking/offers";
import { labelExperiences } from "../../supabase/functions/logistics-plan/provenance";
import { collectEvidence, validateCards } from "../../supabase/functions/concierge-chat/cards";
import { multiDestTripRows } from "@/lib/multiDestTrip";
import { fetchMembersVenues, isSourcedVenue } from "@/lib/membersVenues";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

/** Places "en Google": lo que devuelve Text Search para cada consulta (por la primera parte del nombre). */
const KNOWN: Record<string, { id: string; name: string; status?: string }> = {
  "casa lucio": { id: "ChIJcasaLucio000000000001", name: "Casa Lucio" },
  "sobrino de botin": { id: "ChIJbotin00000000000000001", name: "Restaurante Sobrino de Botín" },
  "mercado de san miguel": { id: "ChIJmercadoSanMiguel00001", name: "Mercado de San Miguel" },
  "la gabinoteca": { id: "ChIJgabinoteca00000000001", name: "La Gabinoteca" },
  "visita guiada a la mezquita catedral y juderia": { id: "ChIJmezquita0000000000001", name: "Mezquita-Catedral de Córdoba" },
};
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function fakePlaces(opts: { delayMs?: number } = {}) {
  const calls: Array<{ query: string; mask: string }> = [];
  const f = vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body ?? "{}"));
    const headers = init.headers as Record<string, string>;
    calls.push({ query: body.textQuery, mask: headers["X-Goog-FieldMask"] ?? headers["x-goog-fieldmask"] ?? "" });
    if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
    const key = norm(String(body.textQuery).split(",")[0]);
    const hit = KNOWN[key];
    // Un nombre inventado: Google devuelve "el más parecido" (otro lugar), nunca vacío.
    const places = hit
      ? [{ id: hit.id, displayName: { text: hit.name }, googleMapsUri: `https://maps.google.com/?cid=${hit.id}`, businessStatus: hit.status ?? "OPERATIONAL" }]
      : [{ id: "ChIJotroLugar000000000001", displayName: { text: "Taberna La Bola" }, googleMapsUri: "https://maps.google.com/?cid=9", businessStatus: "OPERATIONAL" }];
    return json({ places });
  });
  const t = createGoogleTransport({ mapsKey: "AIzaSECRETOdePruebas000000000", fetch: f as unknown as typeof fetch })!;
  return { t, f, calls };
}

const madrid = (espana as any).logistics.per_destination.find((pd: any) => pd.city === "Madrid");
const cordoba = (espana as any).logistics.per_destination.find((pd: any) => pd.city === "Córdoba");

describe("resolvePlace: búsqueda que valida el nombre (Text Search Pro, caché 30 días)", () => {
  it("pide solo id, nombre, ficha y estado (SKU Pro); IDs Only no sirve para validar", () => {
    expect(fieldMask("text", "verify")).toBe("places.id,places.displayName,places.googleMapsUri,places.businessStatus");
    expect(skuFor("text", "verify")).toBe(VERIFY_SKU);
    expect(fieldMask("text", "verify")).not.toMatch(/websiteUri|rating|priceLevel/);
  });

  it("nombre real: place_id y nombre oficial de Google; la segunda vez sale de la caché", async () => {
    const { t, f } = fakePlaces();
    const store = memoryCacheStore();
    const r = await resolvePlace(t, { name: "Sobrino de Botín", city: "Madrid", includedType: "restaurant" }, store);
    expect(r).toMatchObject({ status: "found", place_id: "ChIJbotin00000000000000001", name: "Restaurante Sobrino de Botín", cached: false });
    expect((r as any).maps_url).toBe(mapsPlaceUrl("Restaurante Sobrino de Botín", "ChIJbotin00000000000000001"));
    const again = await resolvePlace(t, { name: "Sobrino de Botín", city: "Madrid", includedType: "restaurant" }, store);
    expect(again).toMatchObject({ status: "found", place_id: "ChIJbotin00000000000000001", cached: true });
    expect(f).toHaveBeenCalledTimes(1);
    // Solo se guarda el place_id (términos de Google), por 30 días.
    const row = [...store.rows.values()][0];
    expect(row.response).toEqual({ place_id: "ChIJbotin00000000000000001" });
    expect(row.ttl_seconds).toBe(30 * 86400);
  });

  it("nombre inventado: Google devuelve otro lugar y no cuenta como encontrado", async () => {
    const { t } = fakePlaces();
    const store = memoryCacheStore();
    expect(await resolvePlace(t, { name: "La Trattoria Inventada del Sol", city: "Madrid" }, store)).toMatchObject({ status: "not_found" });
    expect([...store.rows.values()][0].response).toEqual({ place_id: null });
  });

  it("namesMatch: variantes reales sí, nombres distintos no", () => {
    expect(namesMatch("Botín", "Restaurante Sobrino de Botín")).toBe(true);
    expect(namesMatch("Museo del Prado", "Museo Nacional del Prado")).toBe(true);
    expect(namesMatch("Casa Pepe", "Casa Lucio")).toBe(false);
    expect(namesMatch("Tour de tapas por La Latina", "Taberna La Bola")).toBe(false);
  });

  it("sin Google ni caché: sin verificar (nunca encontrado por omisión)", async () => {
    expect(await resolvePlace(null, { name: "Casa Lucio", city: "Madrid" })).toEqual({ status: "unchecked", reason: "sin_google" });
  });
});

describe("restaurantes: un nombre inventado no se muestra; uno real conserva su place_id", () => {
  it("multidestino España (Madrid): sin lista, cada restaurante se busca; el inventado se quita", async () => {
    const { t } = fakePlaces();
    const resolve = makeResolver(t, memoryCacheStore(), { deadline: Date.now() + 5000 });
    const model = [...madrid.restaurantes, { nombre: "La Trattoria Inventada del Sol", cocina: "Italiana", rango_precio: "$$" }];
    const out = await verifyRestaurants(model, [], "Madrid", resolve, 5);
    const names = out.restaurantes.map((r) => r.nombre);
    expect(names).not.toContain("La Trattoria Inventada del Sol");
    expect(out.quitados).toBe(1);
    const botin = out.restaurantes.find((r) => r.place_id === "ChIJbotin00000000000000001");
    expect(botin).toMatchObject({ nombre: "Restaurante Sobrino de Botín", fuente: "google_places", verificado: true });
    // Ni el "$$" del modelo ni un enlace de la IA.
    expect(botin.rango_precio).toBe("Precio no publicado");
    expect(out.restaurantes.every((r) => !("cta_action" in r) || r.cta_action === r.website || r.cta_action === r.maps_url)).toBe(true);
  });

  it("con la lista de Google: el de la lista lleva sus datos; el que no está se busca por nombre", async () => {
    const { t, f } = fakePlaces();
    const places = (placesFixture as any).places.map((p: any) => normalizePlace(p, "2026-10-24T05:50:00.000Z"));
    const resolve = makeResolver(t, null, { deadline: Date.now() + 5000 });
    const first = places[0];
    const out = await verifyRestaurants([{ nombre: first.name, por_que: "Del modelo" }, { nombre: "Restaurante Fantasma Inventado" }], places, "Ciudad de México", resolve, 2);
    expect(out.restaurantes[0]).toMatchObject({ nombre: first.name, place_id: first.place_id, verificado: true, por_que: "Del modelo" });
    expect(out.restaurantes.map((r) => r.nombre)).not.toContain("Restaurante Fantasma Inventado");
    expect(f).toHaveBeenCalledTimes(1); // solo el que no estaba en la lista
  });

  it("Tokio (análisis de un destino): los restaurantes de Google conservan place_id sin gastar búsquedas", async () => {
    const { t, f } = fakePlaces();
    const rests = (tokio as any).restaurantes_json.filter((r: any) => r.place_id);
    expect(rests.length).toBeGreaterThan(0);
    const places = rests.map((r: any) => normalizePlace({ id: r.place_id, displayName: { text: r.nombre }, googleMapsUri: r.maps_url, websiteUri: r.website }, "2026-10-23T00:00:00Z"));
    const out = await verifyRestaurants(rests.map((r: any) => ({ nombre: r.nombre })), places, "Tokio", makeResolver(t, null, { deadline: Date.now() + 5000 }), rests.length);
    expect(out.restaurantes.map((r) => r.place_id)).toEqual(rests.map((r: any) => r.place_id));
    expect(f).not.toHaveBeenCalled();
  });
});

describe("tours y experiencias: lo no encontrado queda «Sin verificar»", () => {
  it("España (Córdoba): experiencias 'estimado' se buscan; encontrada → place_id; no encontrada → Sin verificar", async () => {
    const { t } = fakePlaces();
    const labeled = labelExperiences(cordoba.experiencias, null);
    const out = await verifyTours(labeled, "Córdoba", makeResolver(t, null, { deadline: Date.now() + 5000 }));
    const [mezquita, ...rest] = out.tours;
    expect(mezquita).toMatchObject({ place_id: "ChIJmezquita0000000000001", nombre: "Mezquita-Catedral de Córdoba", verificado: true, fuente: "google_places" });
    expect(rest.every((x) => x.verificado === false && x.rating === null && !x.place_id)).toBe(true);
    expect(out.sin_verificar).toBe(3);
  });

  it("labelExperiences conserva place_id y ficha del proveedor (antes se perdían en el multidestino)", () => {
    const [e] = labelExperiences([{ nombre: "Palacio Real de Madrid", fuente: "google_places", rating: 3 }],
      [{ name: "Palacio Real de Madrid", place_id: "ChIJpalacio", web_url: "https://maps.google.com/?cid=1", rating: 4.7 }], "google_places");
    expect(e).toMatchObject({ place_id: "ChIJpalacio", maps_url: "https://maps.google.com/?cid=1", rating: 4.7 });
  });

  it("Tokio: tours con place_id no se vuelven a buscar", async () => {
    const { t, f } = fakePlaces();
    const out = await verifyTours((tokio as any).tours_json, "Tokio", makeResolver(t, null, { deadline: Date.now() + 5000 }));
    expect(out.tours.filter((x) => x.place_id).every((x) => x.verificado === true)).toBe(true);
    expect(f.mock.calls.length).toBe((tokio as any).tours_json.filter((x: any) => !x.place_id && !["tripadvisor", "google_places", "google_maps"].includes(x.fuente)).length);
  });
});

describe("presupuesto de tiempo (logistics-plan tiene tope de 130 s)", () => {
  it("si Google tarda, todo queda «Sin verificar» y se respeta el plazo", async () => {
    const { t } = fakePlaces({ delayMs: 2000 });
    const t0 = Date.now();
    const resolve = makeResolver(t, null, { deadline: t0 + 400, concurrency: 2, timeoutMs: 300 });
    const tours = await verifyTours(cordoba.experiencias.map((e: any) => ({ ...e, fuente: "estimado" })), "Córdoba", resolve);
    const rests = await verifyRestaurants(madrid.restaurantes, [], "Madrid", resolve, 5);
    expect(Date.now() - t0).toBeLessThan(1500);
    expect(tours.tours.every((x) => x.verificado === false)).toBe(true);
    // Restaurantes sin comprobar: se muestran como "Sin verificar", sin enlace ni precio inventado; nunca como verificados.
    expect(rests.restaurantes.every((r) => r.verificado === false && !r.place_id && !r.cta_action)).toBe(true);
  });

  it("verifyAll: lo que no alcanza el plazo queda 'budget' sin llamar", async () => {
    const fn = vi.fn(async () => ({ status: "not_found" as const, cached: false }));
    const out = await verifyAll([1, 2, 3], fn, { deadline: Date.now() - 1 });
    expect(out.every((r) => r.status === "unchecked")).toBe(true);
    expect(fn).not.toHaveBeenCalled();
  });
});

describe("ningún enlace escrito por la IA se guarda ni se muestra", () => {
  it("sin lista de Google, el cta_action del modelo se quita", () => {
    const out = enforceRestaurants([{ nombre: "Septime", cta_action: "https://septime-charlesbarriere.fr" }], [], "París");
    expect(out.restaurantes[0].cta_action).toBeUndefined();
  });

  it("Comprar: el cta_action guardado en un viaje viejo no llega a ningún botón", () => {
    const o = offerFromTripRestaurant({ nombre: "Lorenzo's", cta_action: "https://www.ritzcarlton.com/en/hotels/cunrz/dining/lorenzos" }, { trip: { id: "t1", destino: "Cancún" } as any });
    expect(o.actions.some((a) => String(a.url ?? "").includes("ritzcarlton"))).toBe(false);
    expect(o.actions.map((a) => a.label)).toEqual(expect.arrayContaining(["Buscar en OpenTable", "Buscar en Google Maps"]));
  });

  it("multidestino: sin dato no hay '$$' y pasan place_id y ficha de Google", () => {
    const logistics = JSON.parse(JSON.stringify((espana as any).logistics));
    logistics.per_destination[0].restaurantes = [
      { nombre: "Casa Lucio", cocina: "Madrileña" },
      { nombre: "Restaurante Sobrino de Botín", cocina: "Asador", place_id: "ChIJbotin", maps_url: "https://maps.google.com/?cid=2", fuente: "google_places", verificado: true, cta_action: "https://inventado.example" },
    ];
    const rows = multiDestTripRows(logistics, logistics.per_destination.map((p: any) => p.city), "Ciudad de México");
    const [lucio, botin] = rows.restaurantes_json;
    expect(lucio.rango_precio).toBeUndefined();
    expect(botin).toMatchObject({ place_id: "ChIJbotin", maps_url: "https://maps.google.com/?cid=2", verificado: true });
    expect(botin.cta_action).toBeUndefined();
  });
});

describe("Concierge: tarjeta de restaurante solo si el nombre salió de una búsqueda", () => {
  const run = { name: "search_places", args: {}, result: { ok: true, results: [{ name: "Pujol", place_id: "ChIJpujol0000000000000001", maps_url: "https://maps.google.com/?cid=111" }] } };
  it("inventado fuera; real dentro", () => {
    const ev = collectEvidence([run as any]);
    const out = validateCards([{ type: "restaurant", title: "Pujol" }, { type: "restaurant", title: "Almoraduz Secreto" }], ev);
    expect(out.cards.map((c) => c.title)).toEqual(["Pujol"]);
    expect(out.dropped).toEqual([{ type: "restaurant", reason: "lugar_sin_respaldo" }]);
  });
});

describe("Members Only sin lo inventado (nightlife_premium sin fuente)", () => {
  it("solo se muestra lo curado o con fuente", async () => {
    const rows = [
      { id: "1", nombre: "Hanky Panky", fuente: "curaduria", source_url: "https://www.hankypanky.mx/" },
      { id: "2", nombre: "Robot Restaurant (sucesor)", fuente: "members", source_url: null, website: "Referenciado en guías premium" },
      { id: "3", nombre: "Zero Bond", fuente: "members", source_url: null, website: "https://zerobond.com" },
    ];
    const client = { rpc: async () => ({ data: rows, error: null }) };
    const { venues } = await fetchMembersVenues(client, "CDMX");
    expect(venues.map((v) => v.nombre)).toEqual(["Hanky Panky"]);
    expect(isSourcedVenue({ fuente: "members", source_url: "https://fuente.example/x" })).toBe(true);
  });
});

describe("Comprar: «Sin verificar» en la tarjeta", () => {
  it("tour sin place_id ni lista del proveedor, o marcado por el servidor; restaurante sin Google", async () => {
    const { unverifiedPlace } = await import("@/components/booking/TripPicksCarousel");
    expect(unverifiedPlace("experiencia", { nombre: "Tour", fuente: "estimado" })).toBe(true);
    expect(unverifiedPlace("experiencia", { nombre: "Sensō-ji", fuente: "google_places", place_id: "ChIJx" })).toBe(false);
    expect(unverifiedPlace("experiencia", { nombre: "Coliseo", fuente: "tripadvisor" })).toBe(false);
    expect(unverifiedPlace("restaurante", { nombre: "Casa Lucio", rango_precio: "$$" })).toBe(true);
    expect(unverifiedPlace("restaurante", { nombre: "Pujol", fuente: "google_places", place_id: "ChIJp" })).toBe(false);
    expect(unverifiedPlace("restaurante", { nombre: "X", fuente: "google_places", verificado: false })).toBe(true);
  });
});
