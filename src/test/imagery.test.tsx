// Grupo imagery: "todos los lugares con foto real del lugar; si es italiano, comida italiana; si es
// de Aeroméxico, Aeroméxico". Reglas de origen (Google real > ilustrativa marcada > respaldo de marca),
// logos de aerolínea, carga perezosa, caché y presupuesto de llamadas.
import React from "react";
import { render, screen, act, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke } } }));

import { airlineCode, airlineLogoUrl, airlineLogoFor, airlineName } from "@/lib/airlines";
import { AirlineLogo } from "@/components/media/AirlineLogo";
import { SmartImage } from "@/components/media/SmartImage";
import { __resetStockPhotos, getStockPhoto, cachedStockPhoto, PEXELS_PER_MINUTE, pexelsBudget } from "@/lib/stockPhoto";
import { __resetPlacePhotoCache, resolvePlacePhotoUrl } from "@/lib/placePhoto";
import { createBudget } from "@/lib/imageBudget";
import { activityQuery, cuisineQuery, hotelQuery, isSpecificVenueTitle, venueQuery } from "@/lib/categoryImagery";
import { resolvePlacePhoto, samePlaceForPhoto } from "../../supabase/functions/_shared/place-photo-resolve";
import type { GoogleTransport } from "../../supabase/functions/_shared/google-maps";
import { enrichCardLinks, collectEvidence, type ConciergeCard } from "../../supabase/functions/concierge-chat/cards";

const PEXELS = "https://images.pexels.com/photos/1/pasta.jpeg";
const GOOGLE = "https://lh3.googleusercontent.com/place-photos/abc=s800";
const REF = "places/ChIJnywNMVv_0YURVuuTE-_GX4Q/photos/Aa-ngMZVC9dB0BPXgphKuyC";
const flush = () => act(async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); await new Promise((r) => setTimeout(r, 0)); });
const fnName = (c: unknown[]) => String(c[0]).split("?")[0];

/** Por defecto: Pexels da foto, place-photo da foto real. */
function routeInvoke(over: Partial<Record<string, (body: unknown) => unknown>> = {}) {
  invoke.mockImplementation(async (name: string, opts: { body?: unknown }) => {
    const fn = name.split("?")[0];
    if (over[fn]) return over[fn]!(opts?.body);
    if (fn === "pexels-image") return { data: { image: PEXELS, photographer: "Ana" }, error: null };
    if (fn === "place-photo") return { data: { url: GOOGLE }, error: null };
    return { data: null, error: null };
  });
}

beforeEach(() => {
  invoke.mockReset();
  __resetStockPhotos();
  __resetPlacePhotoCache();
  sessionStorage.clear();
});

describe("aerolíneas: nombre/código/número de vuelo → IATA → logo", () => {
  it("reconoce nombres con y sin acentos, alias y números de vuelo", () => {
    expect(airlineCode("Aeroméxico")).toBe("AM");
    expect(airlineCode("AEROMEXICO CONNECT")).toBe("AM");
    expect(airlineCode("Volaris")).toBe("Y4");
    expect(airlineCode("Viva Aerobus")).toBe("VB");
    expect(airlineCode("Viva")).toBe("VB");
    expect(airlineCode("American Airlines")).toBe("AA");
    expect(airlineCode("United")).toBe("UA");
    expect(airlineCode("Delta Air Lines")).toBe("DL");
    expect(airlineCode("Iberia")).toBe("IB");
    expect(airlineCode("Air France")).toBe("AF");
    expect(airlineCode("KLM")).toBe("KL");
    expect(airlineCode("Lufthansa")).toBe("LH");
    expect(airlineCode("British Airways")).toBe("BA");
    expect(airlineCode("ANA")).toBe("NH");
    expect(airlineCode("Japan Airlines")).toBe("JL");
    expect(airlineCode("Copa Airlines")).toBe("CM");
    expect(airlineCode("Avianca")).toBe("AV");
    expect(airlineCode("LATAM Airlines")).toBe("LA");
    expect(airlineCode("Emirates")).toBe("EK");
    expect(airlineCode("Qatar Airways")).toBe("QR");
    expect(airlineCode("Turkish Airlines")).toBe("TK");
    expect(airlineCode("AM 401")).toBe("AM");
    expect(airlineCode("am401")).toBe("AM");
    expect(airlineCode("Y4-1234")).toBe("Y4");
    expect(airlineCode("VB1023")).toBe("VB");
    expect(airlineCode("Vuelo AM 401 a Madrid")).toBe("AM");
    expect(airlineCode("AM")).toBe("AM");
  });

  it("no inventa: desconocidas, búsquedas y fechas no dan logo", () => {
    expect(airlineCode("Aviasales")).toBeNull();
    expect(airlineCode("Google Flights")).toBeNull();
    expect(airlineCode("MEX → MAD")).toBeNull();
    expect(airlineCode("12 de 2024")).toBeNull();
    expect(airlineCode("")).toBeNull();
    expect(airlineCode(null)).toBeNull();
    expect(airlineLogoFor("Aerolínea Fantasma")).toBeNull();
  });

  it("URL del CDN de Travelpayouts (cuadrada, horizontal y @2x)", () => {
    expect(airlineLogoUrl("AM")).toBe("https://pics.avs.io/200/200/AM.png");
    expect(airlineLogoUrl("am", 240, 80, true)).toBe("https://pics.avs.io/240/80/AM@2x.png");
    expect(airlineLogoFor("Aeroméxico", 200)).toBe("https://pics.avs.io/200/200/AM.png");
    expect(airlineLogoUrl("A")).toBeNull();
    expect(airlineLogoUrl("../x")).toBeNull();
    expect(airlineName("AM")).toBe("Aeroméxico");
  });

  it("el logo va en una ficha blanca con object-contain (no se estira) y sin llamadas a funciones", () => {
    render(<AirlineLogo airline="Aeroméxico" size={34} />);
    const img = screen.getByAltText("Logo de Aeroméxico") as HTMLImageElement;
    expect(img.src).toBe("https://pics.avs.io/240/80/AM@2x.png");
    expect(img.className).toContain("object-contain");
    expect(screen.getByTestId("airline-logo").className).toContain("bg-white");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("si el logo no carga o la aerolínea no se reconoce: avión de la marca, nunca imagen rota", () => {
    const { rerender } = render(<AirlineLogo airline="Volaris" />);
    fireEvent.error(screen.getByRole("img", { name: "Logo de Volaris" }));
    expect(screen.queryByAltText("Logo de Volaris")).toBeNull();
    expect(screen.getByRole("img", { name: "Volaris" })).toBeInTheDocument();
    rerender(<AirlineLogo airline="Aerolínea Fantasma" />);
    expect(screen.getByTestId("airline-logo").querySelector("img")).toBeNull();
  });
});

describe("categorías → foto ilustrativa correcta", () => {
  it("cocina italiana → comida italiana; resto de cocinas y experiencias", () => {
    expect(cuisineQuery("Italiana")).toBe("italian food pasta");
    expect(cuisineQuery("Restaurante italiano")).toBe("italian food pasta");
    expect(cuisineQuery("Japonesa")).toMatch(/sushi/);
    expect(cuisineQuery("Poblana tradicional")).toMatch(/mole/);
    expect(cuisineQuery(null, "Mariscos El Capi")).toMatch(/seafood/);
    expect(cuisineQuery("Restaurante")).toBe("fine dining restaurant dish");
    expect(activityQuery("Tour en kayak por la bahía")).toBe("kayak tour");
    expect(activityQuery("Catedral de Puebla")).toMatch(/cathedral/);
    expect(hotelQuery("Boutique")).toMatch(/boutique/);
    expect(venueQuery("speakeasy")).toMatch(/speakeasy/);
  });

  it("tarjetas seguidas no repiten la misma foto ilustrativa (variantes por posición)", () => {
    expect(cuisineQuery("Poblana tradicional", "Fonda", 0)).not.toBe(cuisineQuery("Poblana de autor", "Mural", 1));
    expect(cuisineQuery("Italiana", "A", 1)).toMatch(/^italian /);
    expect(new Set([0, 1, 2].map((i) => hotelQuery("Boutique", i))).size).toBe(3);
    expect(hotelQuery("Boutique", 3)).toBe(hotelQuery("Boutique", 0));
  });

  it("solo se busca la foto real de una reserva cuando nombra UN lugar", () => {
    expect(isSpecificVenueTitle("hotel", "Hotel Morada")).toBe(true);
    expect(isSpecificVenueTitle("restaurant", "Pujol")).toBe(true);
    expect(isSpecificVenueTitle("hotel", "Hoteles en Roma")).toBe(false);
    expect(isSpecificVenueTitle("restaurant", "Reservar mesa en CDMX")).toBe(false);
    expect(isSpecificVenueTitle("flight", "Aeroméxico")).toBe(false);
    expect(isSpecificVenueTitle("activity", "MEX → MAD")).toBe(false);
  });
});

describe("SmartImage: orden de origen, leyendas y respaldo", () => {
  it("foto de Pexels por categoría SIEMPRE lleva 'Foto ilustrativa'", async () => {
    routeInvoke();
    render(<SmartImage alt="Trattoria" stockQuery={cuisineQuery("Italiana")} />);
    await flush();
    expect(invoke).toHaveBeenCalledWith("pexels-image", { body: { query: "italian food pasta" } });
    expect(screen.getByAltText("Trattoria")).toHaveAttribute("src", PEXELS);
    expect(screen.getByTestId("illustrative-caption")).toHaveTextContent("Foto ilustrativa");
    expect(screen.queryByTestId("google-caption")).toBeNull();
  });

  it("con photo_ref usa la foto real de Google ('Foto: Google') y no pide Pexels", async () => {
    routeInvoke();
    render(<SmartImage alt="Pujol" photoRef={REF} lookup={{ name: "Pujol", city: "CDMX" }} stockQuery="fine dining" />);
    await flush();
    expect(screen.getByAltText("Pujol")).toHaveAttribute("src", GOOGLE);
    expect(screen.getByTestId("google-caption")).toHaveTextContent("Foto: Google");
    expect(screen.queryByTestId("illustrative-caption")).toBeNull();
    expect(invoke.mock.calls.map(fnName)).toEqual(["place-photo"]);
  });

  it("sin foto guardada: busca el lugar (resolve) y, si Google no lo encuentra, ilustrativa marcada", async () => {
    routeInvoke({ "place-photo": () => ({ data: { url: null, reason: "otro_lugar" }, error: null }) });
    render(<SmartImage alt="Tour gastronómico" lookup={{ name: "Tour gastronómico", city: "Puebla" }} stockQuery="street food tour market" />);
    await flush();
    // GET con los parámetros en la URL: el navegador reutiliza la respuesta (Cache-Control; ronda 2, P2-11).
    const [fn, opts] = invoke.mock.calls[0];
    expect(fnName([fn])).toBe("place-photo");
    expect(Object.fromEntries(new URL(`https://x.test/${fn}`).searchParams)).toEqual({ mode: "resolve", maxWidth: "800", name: "Tour gastronómico", city: "Puebla" });
    expect(opts).toEqual({ method: "GET" });
    expect(invoke.mock.calls.map(fnName)).toEqual(["place-photo", "pexels-image"]);
    expect(screen.getByTestId("illustrative-caption")).toBeInTheDocument();
  });

  it("place-photo publicado sin 'resolve' (400) → ilustrativa, y no se vuelve a pedir en la sesión", async () => {
    routeInvoke({ "place-photo": () => ({ data: null, error: Object.assign(new Error("400"), { context: { status: 400 } }) }) });
    const tree = <SmartImage alt="Hotel Morada" lookup={{ name: "Hotel Morada", city: "Puebla" }} stockQuery="luxury hotel suite interior" />;
    const r = render(tree);
    await flush();
    r.unmount();
    render(tree);
    await flush();
    expect(invoke.mock.calls.map(fnName)).toEqual(["place-photo", "pexels-image"]);
    expect(screen.getByTestId("illustrative-caption")).toBeInTheDocument();
    // Otro lugar en la misma sesión: ya no se intenta "resolve" (solo una llamada desperdiciada).
    expect(await resolvePlacePhotoUrl({ name: "Hotel Colonial", city: "Puebla" })).toBeNull();
    expect(invoke.mock.calls.map(fnName)).toEqual(["place-photo", "pexels-image"]);
  });

  it("sin ninguna foto: respaldo de marca con ícono, nunca un <img> roto", async () => {
    routeInvoke({ "pexels-image": () => ({ data: { image: null }, error: null }) });
    render(<SmartImage alt="Nada" stockQuery="nothing at all" />);
    await flush();
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByTestId("smart-image-fallback")).toBeInTheDocument();
    expect(screen.getByTestId("smart-image")).toHaveAttribute("data-kind", "none");
  });

  it("si la foto falla al cargar pasa al siguiente origen y al final al respaldo (sin ícono roto)", async () => {
    routeInvoke();
    render(<SmartImage alt="Lugar" photoRef={REF} stockQuery="cathedral architecture" />);
    await flush();
    fireEvent.error(screen.getByAltText("Lugar"));
    await flush();
    expect(screen.getByAltText("Lugar")).toHaveAttribute("src", PEXELS);
    expect(screen.getByTestId("illustrative-caption")).toBeInTheDocument();
    fireEvent.error(screen.getByAltText("Lugar"));
    await flush();
    expect(screen.queryByAltText("Lugar")).toBeNull();
    expect(screen.getByTestId("smart-image-fallback")).toBeInTheDocument();
  });

  it("una foto de Pexels guardada como imagen se marca ilustrativa (imageKind=stock)", () => {
    render(<SmartImage alt="Roma" imageUrl={PEXELS} imageKind="stock" />);
    expect(screen.getByTestId("illustrative-caption")).toBeInTheDocument();
    expect(invoke).not.toHaveBeenCalled();
  });
});

describe("carga perezosa, caché y presupuesto", () => {
  let observers: Array<{ cb: IntersectionObserverCallback; el?: Element }> = [];
  beforeEach(() => {
    observers = [];
    vi.stubGlobal("IntersectionObserver", class {
      cb: IntersectionObserverCallback;
      constructor(cb: IntersectionObserverCallback) { this.cb = cb; observers.push({ cb }); }
      observe(el: Element) { observers.find((o) => o.cb === this.cb)!.el = el; }
      disconnect() {}
      unobserve() {}
      takeRecords() { return []; }
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("no pide ninguna imagen hasta que la tarjeta entra en pantalla", async () => {
    routeInvoke();
    render(<SmartImage alt="Hotel" lookup={{ name: "Hotel Morada", city: "Puebla" }} stockQuery="luxury hotel suite interior" />);
    await flush();
    expect(invoke).not.toHaveBeenCalled();
    expect(screen.getByTestId("smart-image-skeleton")).toBeInTheDocument();
    await act(async () => { observers.forEach((o) => o.cb([{ isIntersecting: true, target: o.el! } as IntersectionObserverEntry], {} as IntersectionObserver)); });
    await flush();
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(screen.getByAltText("Hotel")).toHaveAttribute("src", GOOGLE);
  });

  it("muchas tarjetas con la misma categoría → una sola llamada; al volver en la sesión → cero", async () => {
    vi.unstubAllGlobals(); // todas visibles
    routeInvoke();
    const tree = () => <>{Array.from({ length: 6 }, (_, i) => <SmartImage key={i} alt={`r${i}`} stockQuery="Italian food  PASTA" />)}</>;
    const r = render(tree());
    await flush();
    expect(invoke).toHaveBeenCalledTimes(1);
    r.unmount();
    // Recarga de la página: memoria nueva, la sesión del navegador sigue.
    vi.resetModules();
    const fresh = await import("@/lib/stockPhoto");
    expect(fresh.cachedStockPhoto("italian food pasta")?.image).toBe(PEXELS);
    expect(await fresh.getStockPhoto("italian food pasta")).toMatchObject({ image: PEXELS });
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("también recuerda 'sin foto' (no reintenta) y resolve por lugar va una vez por sesión", async () => {
    routeInvoke({ "pexels-image": () => ({ data: { image: null }, error: null }) });
    await getStockPhoto("zzz");
    await getStockPhoto("ZZZ ");
    expect(cachedStockPhoto("zzz")).toBeNull();
    routeInvoke();
    await resolvePlacePhotoUrl({ name: "Pujol", city: "CDMX" });
    await resolvePlacePhotoUrl({ name: "pujol", city: "cdmx" });
    expect(invoke.mock.calls.map(fnName)).toEqual(["pexels-image", "place-photo"]);
  });

  it(`como mucho ${PEXELS_PER_MINUTE} llamadas a pexels-image por minuto; el resto espera`, async () => {
    routeInvoke();
    const all = Array.from({ length: PEXELS_PER_MINUTE + 5 }, (_, i) => getStockPhoto(`query ${i}`));
    await flush();
    expect(invoke).toHaveBeenCalledTimes(PEXELS_PER_MINUTE);
    expect(pexelsBudget.started()).toBe(PEXELS_PER_MINUTE);
    void all;
  });

  it("el presupuesto pausa todo tras un 429 (sin llamar) y respeta la concurrencia", async () => {
    const b = createBudget({ perMinute: 100, concurrency: 2 });
    let running = 0, peak = 0;
    const job = () => b.run(async () => { running++; peak = Math.max(peak, running); await new Promise((r) => setTimeout(r, 5)); running--; return 1; }, 0);
    await Promise.all([job(), job(), job(), job(), job()]);
    expect(peak).toBe(2);
    b.block(30);
    const fn = vi.fn(async () => 1);
    expect(await b.run(fn, 0)).toBe(0);
    expect(fn).not.toHaveBeenCalled();
  });
});

describe("place-photo 'resolve' (servidor): solo foto real si Google encontró ESE lugar", () => {
  it("compara palabras significativas del nombre", () => {
    expect(samePlaceForPhoto("Hotel Morada", "Morada Hotel Puebla")).toBe(true);
    expect(samePlaceForPhoto("Fonda de Santa Clara", "Fonda de Santa Clara Centro")).toBe(true);
    expect(samePlaceForPhoto("Tour gastronómico por el centro", "Restaurante El Mural de los Poblanos")).toBe(false);
    expect(samePlaceForPhoto("Catedral de Puebla", "Catedral Basílica de Puebla")).toBe(true);
    expect(samePlaceForPhoto("Callejón de los Sapos", "Museo Amparo")).toBe(false);
  });

  function fakeTransport(place: { name: string; photo?: boolean }) {
    const calls: string[] = [];
    const t: GoogleTransport = {
      mode: "direct",
      url: (_api, path, q) => `https://g${path}${q ? `?${q}` : ""}`,
      headers: (_a, extra = {}) => ({ ...extra }),
      fetch: (async (u: string) => {
        calls.push(String(u).replace(/^https:\/\/g/, "").split("?")[0]);
        if (String(u).includes(":searchText")) return new Response(JSON.stringify({ places: [{ id: "ChIJabcdefghijklmnop" }] }));
        if (String(u).includes("/media")) return new Response(JSON.stringify({ photoUri: GOOGLE }));
        return new Response(JSON.stringify({ id: "ChIJabcdefghijklmnop", displayName: { text: place.name }, photos: place.photo === false ? [] : [{ name: REF }] }));
      }) as typeof fetch,
    };
    return { t, calls };
  }

  it("mismo lugar → URL de googleusercontent", async () => {
    const { t, calls } = fakeTransport({ name: "Hotel Morada Puebla" });
    const out = await resolvePlacePhoto(t, { name: "Hotel Morada", city: "Puebla", maxWidth: 800 }, null);
    expect(out.url).toBe(GOOGLE);
    expect(calls).toEqual(["/v1/places:searchText", "/v1/places/ChIJabcdefghijklmnop", `/v1/${REF}/media`]);
  });

  it("otro lugar → null (la app usa una ilustrativa) y no paga la foto", async () => {
    const { t, calls } = fakeTransport({ name: "Restaurante El Mural de los Poblanos" });
    const out = await resolvePlacePhoto(t, { name: "Tour gastronómico por el centro", city: "Puebla" }, null);
    expect(out).toMatchObject({ url: null, reason: "otro_lugar" });
    expect(calls.some((c) => c.includes("/media"))).toBe(false);
  });

  it("con place_id no busca por nombre", async () => {
    const { t, calls } = fakeTransport({ name: "Lo que sea" });
    const out = await resolvePlacePhoto(t, { placeId: "ChIJabcdefghijklmnop" }, null);
    expect(out.url).toBe(GOOGLE);
    expect(calls[0]).toBe("/v1/places/ChIJabcdefghijklmnop");
  });
});

describe("cards del concierge: la foto real sale de la herramienta, no del modelo", () => {
  it("photo_ref y place_id de la evidencia; un UUID de Members no pasa como place_id", () => {
    const ev = collectEvidence([
      { name: "search_places", result: { places: [{ name: "Pujol", id: "ChIJ0000000000000001", photo_ref: REF, lat: 19.4, lng: -99.1 }] } },
      { name: "search_members_venues", result: { venues: [{ name: "Hanky Panky", id: "3f2a9c1e-1111-2222-3333-444455556666" }] } },
    ]);
    const builders = { directions: () => "https://maps.example/d", ride: () => "https://uber.example/r", booking: () => [] };
    const cards: ConciergeCard[] = [
      { type: "restaurant", title: "Pujol", photo_ref: "places/x/photos/inventada" },
      { type: "place", title: "Hanky Panky" },
    ];
    const [a, b] = enrichCardLinks(cards, ev, builders);
    expect(a.photo_ref).toBe(REF);
    expect(a.place_id).toBe("ChIJ0000000000000001");
    expect(b.place_id).toBeUndefined();
  });
});
