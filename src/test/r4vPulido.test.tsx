// R4 viajes P2-2 a P2-7 y costo de place-photo (re-auditoría 29-oct-2026).
import React from "react";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@/integrations/supabase/client", () => {
  const api: any = {
    select: () => api, eq: () => api, order: () => api, limit: () => api, in: () => api, not: () => api, gte: () => api, lte: () => api,
    maybeSingle: async () => ({ data: null, error: null }), single: async () => ({ data: null, error: null }),
    then: (res: any, rej: any) => Promise.resolve({ data: [], error: null }).then(res, rej),
  };
  return { supabase: { from: () => api, functions: { invoke }, auth: { getSession: async () => ({ data: { session: null } }) } } };
});
vi.mock("@/lib/trackBooking", () => ({ logBookingClick: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { destinationCoverUrl, isGooglePhotoUrl } from "../../supabase/functions/_shared/tripCover";
import { TripCommandCenter } from "@/components/TripCommandCenter";
import { TripNextStep } from "@/components/TripNextStep";
import { RealTripTotal } from "@/components/RealTripTotal";
import { TripPurchasePlan } from "@/components/booking/TripPurchasePlan";
import { SmartImage, PLACE_PHOTO_FETCH_WIDTH } from "@/components/media/SmartImage";
import { __resetPlacePhotoCache } from "@/lib/placePhoto";
import { __resetStockPhotos } from "@/lib/stockPhoto";
import { BAR_CTA, barCta, nextTripAction } from "@/lib/tripCommand";
import { itineraryBuyLink } from "@/lib/tripSectionHelp";
import { tripChipLabels, tripDateLabel } from "@/lib/tripList";
import { quoteValidity } from "@/lib/quote";
import { splitRealText } from "@/lib/totalSplit";
import { GENERIC_NO_LIVE } from "@/lib/flightLiveQuote";
import { MUSEOS_AVISO, museumsMapsUrl } from "@/components/trip/TripExperiencias";

const PEXELS = "https://images.pexels.com/photos/1/valle.jpeg?w=1200&h=800";
const GOOGLE_PLACE = "https://lh3.googleusercontent.com/place-photos/pastel=s4800-w800";
const flush = () => act(async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); await new Promise((r) => setTimeout(r, 0)); });

beforeEach(() => {
  invoke.mockReset();
  invoke.mockImplementation(async (name: string) => {
    const fn = String(name).split("?")[0];
    if (fn === "pexels-image") return { data: { image: PEXELS, photographer: "Ana" }, error: null };
    if (fn === "place-photo") return { data: { url: GOOGLE_PLACE }, error: null };
    return { data: null, error: null };
  });
  __resetPlacePhotoCache();
  __resetStockPhotos();
  sessionStorage.clear();
});

describe("P2-2 · la portada es el destino, no la foto de Google de un lugar", () => {
  it("una foto de Google (o del proxy place-photo) no sirve de portada; una foto del destino sí", () => {
    expect(destinationCoverUrl("https://lh3.googleusercontent.com/p/AF1Qip=w1600-h900-k-no")).toBeNull();
    expect(destinationCoverUrl("https://abc.supabase.co/functions/v1/place-photo?ref=places/x/photos/y")).toBeNull();
    expect(destinationCoverUrl("https://maps.googleapis.com/maps/api/place/photo?photoreference=x")).toBeNull();
    expect(isGooglePhotoUrl("https://images.pexels.com/photos/1/a.jpeg")).toBe(false);
    expect(destinationCoverUrl("https://images.pexels.com/photos/1/a.jpeg")).toBe("https://images.pexels.com/photos/1/a.jpeg");
    expect(destinationCoverUrl("http://images.pexels.com/x.jpg")).toBeNull();
  });

  it("Inicio («Próximo viaje»): con portada de Google guardada se ve la foto del destino (Pexels, ilustrativa)", async () => {
    render(<MemoryRouter><TripCommandCenter trip={{ id: "vb", destino: "Valle de Bravo", pais_destino: "México", fecha_salida: "2026-10-30", fecha_regreso: "2026-11-01", cover_image_url: GOOGLE_PLACE }} today="2026-10-29" /></MemoryRouter>);
    await flush();
    await waitFor(() => expect(document.querySelectorAll("img").length).toBeGreaterThan(0));
    const srcs = Array.from(document.querySelectorAll("img")).map((i) => i.getAttribute("src") ?? "");
    expect(srcs.some((s) => s.includes("googleusercontent"))).toBe(false);
    expect(srcs.some((s) => s.startsWith("https://images.pexels.com/"))).toBe(true);
  });

  it("analizar-viaje ya no guarda una foto de Google como portada", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("supabase/functions/analizar-viaje/index.ts", "utf8");
    expect(src).toMatch(/const u = destinationCoverUrl\(p\?\.photos\?\.\[0\]\);/);
    expect(src).not.toMatch(/=w1600-h900-k-no/);
  });
});

describe("P2-3 · barra fija a 390 px: el total completo y el botón corto", () => {
  it("todas las acciones tienen un texto corto (≤ 14 caracteres) en la barra", () => {
    for (const t of Object.values(BAR_CTA)) expect(t.length).toBeLessThanOrEqual(14);
  });

  it("Valle de Bravo: «Ir a Comprar» en vez de «Elegir cómo llegar y hotel»; el total sin truncar", () => {
    const trip = { id: "vb", destino: "Valle de Bravo", ciudad_origen: "Ciudad de México", fecha_salida: "2026-10-30", fecha_regreso: "2026-11-01", total_estimado: 16953, created_at: "2026-10-28T06:00:00Z",
      vuelos_json: [{ modo: "auto", tier: "equilibrio" }] };
    const now = new Date("2026-10-29T09:00:00Z");
    const a = nextTripAction(trip as any, { today: "2026-10-29", now, missing: ["cómo llegar", "hotel"] });
    expect(a.cta).toBe("Elegir cómo llegar y hotel");
    expect(barCta(a)).toBe("Ir a Comprar");
    render(<MemoryRouter><TripNextStep trip={trip as any} quote={null} isOwner variant="bar" totalLabel="Total $16,953 MXN" totalNote="Estimado · falta elegir" missing={["cómo llegar", "hotel"]} now={now} /></MemoryRouter>);
    const total = screen.getByTestId("trip-next-bar-total");
    expect(total).toHaveTextContent("Total $16,953 MXN");
    expect(total.className).not.toMatch(/\btruncate\b/);
    expect(total.className).toMatch(/whitespace-nowrap/);
    const btn = screen.getByTestId("trip-next-bar-cta");
    expect(btn).toHaveTextContent(/^Ir a Comprar$/);
    // El texto largo sigue siendo el nombre accesible del botón.
    expect(btn).toHaveAccessibleName("Elegir cómo llegar y hotel");
  });
});

describe("P2-4 · viaje traído (Oaxaca): el itinerario no pide elegir lo que ya tiene", () => {
  it("«ya los tienes» en vez de «elígelos en Comprar»", () => {
    expect(itineraryBuyLink({ brought: true })).toBe("Vuelo y hotel ya los tienes · restaurantes y experiencias en Comprar →");
    expect(itineraryBuyLink({ brought: true })).not.toMatch(/elígelos/);
    expect(itineraryBuyLink({ documento: true })).not.toMatch(/elígelos/);
    expect(itineraryBuyLink({})).toBe("Vuelo, hoteles y reservas: elígelos en Comprar →");
    expect(itineraryBuyLink({ byLand: true })).toBe("Cómo llegar, hotel y reservas: elígelos en Comprar →");
  });
});

describe("P2-5 · Ahorro: dos viajes iguales que salen el mismo día se distinguen", () => {
  it("Roma → Florencia → Venecia 10–20 y 10–19 may: chips con el rango de fechas", () => {
    const trips = [
      { id: "a", destino: "Roma → Florencia → Venecia", fecha_salida: "2027-05-10", fecha_regreso: "2027-05-20", created_at: "2026-10-28T10:00:00Z" },
      { id: "b", destino: "Roma → Florencia → Venecia", fecha_salida: "2027-05-10", fecha_regreso: "2027-05-19", created_at: "2026-10-28T12:00:00Z" },
      { id: "c", destino: "Madrid", fecha_salida: "2027-03-10", fecha_regreso: "2027-03-17", created_at: "2026-10-28T12:00:00Z" },
    ];
    const l = tripChipLabels(trips as any);
    expect(l.get("a")).toBe("Roma → Florencia → Venecia · 10–20 may 2027");
    expect(l.get("b")).toBe("Roma → Florencia → Venecia · 10–19 may 2027");
    expect(l.get("a")).not.toBe(l.get("b"));
    // Un viaje sin gemelo conserva el chip corto.
    expect(l.get("c")).toBe("Madrid · 10 mar 2027");
  });
  it("a 390 px las tarjetas de Ahorro no se salen de la pantalla (la columna no crece con los chips largos)", async () => {
    const { readFileSync } = await import("node:fs");
    expect(readFileSync("src/components/TripSavingsCalculator.tsx", "utf8")).toMatch(/aria-label="Ahorro para tu viaje" className="grid grid-cols-\[minmax\(0,1fr\)\] lg:grid-cols-\[minmax\(0,1\.1fr\)_minmax\(0,1fr\)\]/);
  });
  it("rangos entre meses y años", () => {
    expect(tripDateLabel("2027-05-28", "2027-06-02")).toBe("28 may – 2 jun 2027");
    expect(tripDateLabel("2026-12-29", "2027-01-05")).toBe("29 dic 2026 – 5 ene 2027");
    expect(tripDateLabel(null)).toBe("sin fecha");
  });
});

describe("P2-6 · Experiencias: sin jerga y con un estado vacío útil", () => {
  it("el aviso y el estado vacío no dicen «tabla de taquillas»; el vacío lleva a Google Maps", () => {
    expect(MUSEOS_AVISO).not.toMatch(/tabla/);
    expect(museumsMapsUrl("Budapest")).toBe("https://www.google.com/maps/search/?api=1&query=museos%20en%20Budapest");
  });
});

describe("P2-7 · Resumen: un solo aviso de precio viejo y sin «en vivo» para precios de hace 27 h", () => {
  const now = new Date("2026-10-29T09:00:00Z");
  const created = "2026-10-28T06:00:00Z"; // hace 27 h

  it("quoteValidity da la antigüedad cuando venció", () => {
    const v = quoteValidity({ created_at: created }, null, now);
    expect(v.expired).toBe(true);
    expect(v.age).toBe("hace 27 h");
    expect(quoteValidity({ created_at: "2026-10-29T08:00:00Z" }, null, now).age).toBeNull();
    expect(splitRealText({ real: 6592, estimado: 10361 }, (n) => `$${n}`, v.age)).toBe("De eso, $6592 con precio consultado hace 27 h y $10361 estimado.");
    expect(splitRealText({ real: 6592, estimado: 10361 }, (n) => `$${n}`, null)).toMatch(/con precio en vivo/);
  });

  it("la tarjeta del total dice «consultado hace 27 h» una vez y «Qué sigue» no lo repite", () => {
    const trip = { id: "vb", destino: "Valle de Bravo", fecha_salida: "2026-11-20", fecha_regreso: "2026-11-22", total_estimado: 16953, created_at: created, num_viajeros: 2 };
    const v = quoteValidity(trip, null, now);
    render(<MemoryRouter>
      <RealTripTotal trip={trip} noches={2} viajeros={2} validityLabel={v.label} validityExpired={v.expired} priceAge={v.age}
        split={{ total: 16953, real: 6592, estimado: 10361, realParts: [], estParts: [] }} />
      <TripNextStep trip={trip as any} quote={null} isOwner now={now} hideStaleNotice />
    </MemoryRouter>);
    const text = document.body.textContent ?? "";
    expect(screen.getByTestId("trip-total-real")).toHaveTextContent("con precio consultado hace 27 h");
    expect(text).not.toMatch(/con precio en vivo/);
    expect(text.match(/hace 27 h/g)).toHaveLength(1);
    expect(text).not.toMatch(/Precios de hace 27 h: revísalos/);
  });

  it("Budapest sin precio de vuelo: una sola frase", () => {
    expect(GENERIC_NO_LIVE.split(/[.!?](\s|$)/).filter((x) => x && x.trim()).length).toBe(1);
    const trip = { id: "bud", destino: "Budapest", ciudad_origen: "Ciudad de México", fecha_salida: "2026-12-29", fecha_regreso: "2027-01-05", num_viajeros: 2,
      vuelos_json: [], hospedaje_json: [], tours_json: [], restaurantes_json: [], itinerario_json: [] };
    render(<MemoryRouter><TripPurchasePlan trip={trip} selVuelo={-1} selHospedaje={-1} selTours={new Set()} bookings={[]} userId="u1" /></MemoryRouter>);
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/Aún no tenemos precio real para esta ruta/);
    expect(text.match(/Google Flights\./g) ?? []).toHaveLength(1);
    expect(screen.getByTestId("vuelo-motivo")).toHaveTextContent(GENERIC_NO_LIVE);
  });
});

describe("Costo · place-photo: solo lo visible y sin duplicados", () => {
  const photoCalls = () => invoke.mock.calls.filter((c) => String(c[0]).startsWith("place-photo"));

  it("la miniatura y la tarjeta del mismo lugar son UNA llamada (siempre al mismo ancho); la miniatura se achica en la URL", async () => {
    const ref = "places/ChIJ1/photos/AAA";
    render(<>
      <SmartImage alt="mini" size="thumb" photoRef={ref} lookup={{ placeId: "ChIJ1" }} />
      <SmartImage alt="tarjeta" size="card" photoRef={ref} lookup={{ placeId: "ChIJ1" }} />
    </>);
    await flush();
    await waitFor(() => expect(screen.getByAltText("mini")).toBeInTheDocument());
    expect(photoCalls()).toHaveLength(1);
    // Luego, en otra pestaña, el mismo lugar con solo su id (hotel o carrusel de Comprar): sin otra llamada.
    render(<SmartImage alt="solo-id" size="card" lookup={{ placeId: "ChIJ1" }} />);
    await flush();
    expect(screen.getByAltText("solo-id").getAttribute("src")).toContain("place-photos/pastel=w800");
    expect(photoCalls()).toHaveLength(1);
    expect(String(photoCalls()[0][0])).toContain(`maxWidth=${PLACE_PHOTO_FETCH_WIDTH}`);
    expect(screen.getByAltText("mini").getAttribute("src")).toContain("=w240-k-no");
    // Se renderiza otra vez la pestaña: ya no se llama.
    render(<SmartImage alt="otra-vez" size="thumb" photoRef={ref} />);
    await flush();
    expect(photoCalls()).toHaveLength(1);
  });

  it("lo que está fuera de pantalla (pestaña oculta o carrusel) no se pide hasta que se ve", async () => {
    const observers: Array<{ cb: IntersectionObserverCallback; el?: Element }> = [];
    vi.stubGlobal("IntersectionObserver", class {
      cb: IntersectionObserverCallback;
      constructor(cb: IntersectionObserverCallback) { this.cb = cb; observers.push({ cb }); }
      observe(el: Element) { observers.find((o) => o.cb === this.cb)!.el = el; }
      disconnect() {}
      unobserve() {}
      takeRecords() { return []; }
    });
    try {
      render(<div hidden>{Array.from({ length: 20 }, (_, i) => <SmartImage key={i} alt={`r${i}`} size="thumb" photoRef={`places/P${i}/photos/X`} />)}</div>);
      await flush();
      expect(photoCalls()).toHaveLength(0);
      await act(async () => { observers.slice(0, 3).forEach((o) => o.cb([{ isIntersecting: true, target: o.el! } as IntersectionObserverEntry], {} as IntersectionObserver)); });
      await flush();
      expect(photoCalls()).toHaveLength(3);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

void within;
