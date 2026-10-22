// Cercanos: ninguna foto se veía (el <img> apuntaba a place-photo, que exige sesión, y un <img> no
// manda Authorization → 401 → bloqueado → bloque oscuro vacío) y el precio salía en inglés
// ("moderate"), igual que el tipo ("RESTAURANT").
import React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { priceLevelLabel, placeTypeLabel, bestPlaceTypeLabel, placeFamily } from "@/lib/placeLabels";
import { isPhotoRef } from "../../supabase/functions/_shared/placePhotoRef";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@/integrations/supabase/client", () => {
  const from = () => {
    const api: any = {
      select: () => api, eq: () => api, in: () => api, is: () => api, order: () => api, limit: () => api,
      maybeSingle: async () => ({ data: { id: "u1", food_dna: { top_cuisines: [{ key: "mexicana", count: 2 }] } }, error: null }),
      then: (res: any, rej: any) => Promise.resolve({ data: [], error: null }).then(res, rej),
    };
    return api;
  };
  return { supabase: { from, functions: { invoke }, auth: { getSession: async () => ({ data: { session: null } }) } } };
});
const authUser = vi.hoisted(() => ({ id: "u1", email: "u1@example.test", user_metadata: {} }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: authUser, loading: false }) }));
vi.mock("@/components/DashboardLayout", () => ({ DashboardLayout: ({ children }: any) => <>{children}</> }));
vi.mock("@/components/RoutesPanel", () => ({ RoutesPanel: () => null }));
vi.mock("@/lib/insights", () => ({ logInsight: vi.fn(async () => {}) }));
vi.mock("@/hooks/useActiveTrip", () => ({
  useActiveTrip: () => ({ trip: null, trips: [], resolved: { reason: "none" }, pinnedId: null, pin: async () => {} }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));

import { fetchPlacePhotoUrl, isSafePhotoUrl, __resetPlacePhotoCache } from "@/lib/placePhoto";
import Cercanos from "@/pages/Cercanos";

const REF = "places/ChIJnywNMVv_0YURVuuTE-_GX4Q/photos/Aa-ngMZVC9dB0BPXgphKuyC";
const PHOTO = "https://lh3.googleusercontent.com/place-photos/abc=s800";

describe("textos en español para Google Places", () => {
  it("nivel de precio: símbolos + etiqueta, nunca la palabra en inglés", () => {
    expect(priceLevelLabel("PRICE_LEVEL_MODERATE")).toBe("$$ · Moderado");
    expect(priceLevelLabel("PRICE_LEVEL_INEXPENSIVE")).toBe("$ · Económico");
    expect(priceLevelLabel("PRICE_LEVEL_EXPENSIVE")).toBe("$$$ · Caro");
    expect(priceLevelLabel("PRICE_LEVEL_VERY_EXPENSIVE")).toBe("$$$$ · Muy caro");
    expect(priceLevelLabel("PRICE_LEVEL_FREE")).toBe("Gratis");
    expect(priceLevelLabel("moderate")).toBe("$$ · Moderado");
    expect(priceLevelLabel(2)).toBe("$$ · Moderado");
    expect(priceLevelLabel("PRICE_LEVEL_UNSPECIFIED")).toBeNull();
    expect(priceLevelLabel(null)).toBeNull();
  });

  it("tipo de lugar: 'restaurant' → 'Restaurante', cocinas y tipos de Google en español", () => {
    expect(placeTypeLabel("restaurant")).toBe("Restaurante");
    expect(placeTypeLabel("RESTAURANT")).toBe("Restaurante");
    expect(placeTypeLabel("mexican_restaurant")).toBe("Restaurante mexicano");
    expect(placeTypeLabel("taco_restaurant")).toBe("Restaurante de tacos");
    expect(placeTypeLabel("klingon_restaurant")).toBe("Restaurante");
    expect(placeTypeLabel("shopping_mall")).toBe("Centro comercial");
    expect(placeTypeLabel("tourist_attraction")).toBe("Atracción turística");
    expect(placeTypeLabel("point_of_interest")).toBeNull();
    expect(bestPlaceTypeLabel("point_of_interest", ["establishment", "cafe"])).toBe("Café");
    expect(bestPlaceTypeLabel(null, ["establishment"])).toBe("Lugar");
    expect(placeFamily("bar_and_grill", [])).toBe("food");
    expect(placeFamily("cafe", [])).toBe("cafe");
    expect(placeFamily("museum", [])).toBe("sight");
  });
});

describe("foto del lugar", () => {
  beforeEach(() => { invoke.mockReset(); __resetPlacePhotoCache(); sessionStorage.clear(); });

  it("place-photo solo acepta nombres de foto de Places (nada de rutas ni otros endpoints)", () => {
    expect(isPhotoRef(REF)).toBe(true);
    expect(isPhotoRef("places/X/photos/Y/../../places:searchText")).toBe(false);
    expect(isPhotoRef("places:searchNearby")).toBe(false);
    expect(isPhotoRef("places/X/photos/Y?key=1")).toBe(false);
    expect(isPhotoRef("")).toBe(false);
  });

  it("pide la URL con la sesión (invoke, modo url) y la recuerda: una sola llamada por foto", async () => {
    invoke.mockResolvedValue({ data: { url: PHOTO }, error: null });
    expect(await fetchPlacePhotoUrl(REF, 800)).toBe(PHOTO);
    expect(await fetchPlacePhotoUrl(REF, 800)).toBe(PHOTO);
    expect(invoke).toHaveBeenCalledTimes(1);
    const [fn, opts] = invoke.mock.calls[0];
    // Query (lo que lee la función ya publicada) + cuerpo (la versión nueva acepta ambos).
    const u = new URL(`https://x.test/${fn}`);
    expect(u.pathname).toBe("/place-photo");
    expect(Object.fromEntries(u.searchParams)).toEqual({ ref: REF, maxWidth: "800", mode: "url" });
    expect(opts).toEqual({ body: { ref: REF, maxWidth: 800, mode: "url" } });
    // También sobrevive a recargar el módulo dentro de la misma sesión del navegador.
    __resetPlacePhotoCache();
    expect(await fetchPlacePhotoUrl(REF, 800)).toBe(PHOTO);
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("un error temporal no se recuerda; una URL que no es de Google se descarta", async () => {
    invoke.mockResolvedValueOnce({ data: null, error: new Error("429") });
    expect(await fetchPlacePhotoUrl(REF)).toBeNull();
    invoke.mockResolvedValueOnce({ data: { url: PHOTO }, error: null });
    expect(await fetchPlacePhotoUrl(REF)).toBe(PHOTO);
    expect(isSafePhotoUrl("https://evil.example.com/x.jpg")).toBe(false);
    expect(isSafePhotoUrl("javascript:alert(1)")).toBe(false);
    expect(isSafePhotoUrl(PHOTO)).toBe(true);
  });
});

const NEARBY = [
  { placeId: "p1", name: "Ling Ling by Hakkasan", address: "Reforma 509", lat: 19.42, lng: -99.17, rating: 4.9, ratings_count: 43001,
    price_level: "PRICE_LEVEL_VERY_EXPENSIVE", types: ["restaurant"], primary_type: "restaurant", maps_url: null, open_now: false, photo_ref: REF },
  { placeId: "p2", name: "LagoAlgo", address: "Chapultepec", lat: 19.41, lng: -99.18, rating: 4.4, ratings_count: 9000,
    price_level: "PRICE_LEVEL_MODERATE", types: ["mexican_restaurant", "restaurant"], primary_type: "mexican_restaurant", maps_url: null, open_now: true, photo_ref: null },
];

describe("pantalla Cercanos", () => {
  beforeEach(() => {
    invoke.mockReset();
    __resetPlacePhotoCache();
    sessionStorage.clear();
    invoke.mockImplementation(async (fn: string) => {
      if (fn === "nearby-places") return { data: { results: NEARBY }, error: null };
      if (fn.startsWith("place-photo?")) return { data: { url: PHOTO }, error: null };
      return { data: null, error: null };
    });
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: { getCurrentPosition: (ok: any) => ok({ coords: { latitude: 19.4326, longitude: -99.1915 } }) },
    });
  });

  it("lista en español, una sola búsqueda en Google y la ficha con foto real", async () => {
    render(<MemoryRouter><Cercanos /></MemoryRouter>);
    const cards = await screen.findAllByTestId("nearby-card");
    expect(cards).toHaveLength(2);
    const text = document.body.textContent ?? "";
    expect(text).toContain("$$$$ · Muy caro");
    expect(text).toContain("$$ · Moderado");
    expect(text).toContain("Restaurante mexicano");
    expect(text).not.toMatch(/very_expensive|moderate|RESTAURANT\b/);
    // Llegan food_dna y visitados después de la búsqueda: NO se vuelve a llamar a Google.
    await waitFor(() => expect(screen.getByText("· Para ti")).toBeTruthy());
    expect(invoke.mock.calls.filter(([fn]) => fn === "nearby-places")).toHaveLength(1);

    fireEvent.click(screen.getByText("Ling Ling by Hakkasan"));
    const img = await screen.findByAltText("Foto de Ling Ling by Hakkasan") as HTMLImageElement;
    expect(img.src).toBe(PHOTO); // URL pública de Google, no la función (que exige sesión)
    expect(img.src).not.toMatch(/functions\/v1\/place-photo/);
  });

  it("sin foto: ilustración de la categoría con su leyenda, nunca un bloque vacío ni una foto ajena", async () => {
    render(<MemoryRouter><Cercanos /></MemoryRouter>);
    fireEvent.click(await screen.findByText("LagoAlgo"));
    expect(await screen.findByTestId("place-illustration")).toBeTruthy();
    expect(screen.getByText("Sin foto de este lugar")).toBeTruthy();
    expect(screen.queryByRole("img", { name: /Foto de LagoAlgo/ })).toBeNull();
    // La única foto pedida es la miniatura del otro lugar (el que sí tiene foto); LagoAlgo no gasta nada.
    const photoCalls = invoke.mock.calls.filter(([fn]) => String(fn).startsWith("place-photo"));
    expect(photoCalls.length).toBeLessThanOrEqual(1);
    photoCalls.forEach(([fn]) => expect(String(fn)).toContain("maxWidth=240"));
  });

  it("si la foto no carga (URL vencida), cae a la ilustración", async () => {
    render(<MemoryRouter><Cercanos /></MemoryRouter>);
    fireEvent.click(await screen.findByText("Ling Ling by Hakkasan"));
    const img = await screen.findByAltText("Foto de Ling Ling by Hakkasan");
    fireEvent.error(img);
    expect(await screen.findByText("Sin foto de este lugar")).toBeTruthy();
  });
});

describe("miniaturas en la lista de Cercanos", () => {
  beforeEach(() => { invoke.mockReset(); __resetPlacePhotoCache(); sessionStorage.clear(); });

  it("la miniatura no pide la foto hasta que la tarjeta entra en pantalla, y luego la muestra", async () => {
    const observers: Array<(e: Array<{ isIntersecting: boolean }>) => void> = [];
    const orig = (globalThis as any).IntersectionObserver;
    (globalThis as any).IntersectionObserver = class {
      cb: any;
      constructor(cb: any) { this.cb = cb; observers.push(cb); }
      observe() {} disconnect() {} unobserve() {}
    };
    try {
      invoke.mockResolvedValue({ data: { url: PHOTO }, error: null });
      const { PlacePhoto } = await import("@/components/PlacePhoto");
      render(<PlacePhoto compact photoRef={REF} name="Contramar" family="food" className="w-20 h-20" />);
      expect(screen.getByTestId("place-thumb")).toBeTruthy();
      await new Promise((r) => setTimeout(r, 20));
      expect(invoke).not.toHaveBeenCalled();
      observers.forEach((cb) => cb([{ isIntersecting: true }]));
      const img = await screen.findByTestId("place-thumb-img");
      expect(img.getAttribute("src")).toBe(PHOTO);
      expect(img.getAttribute("alt")).toBe("");
      expect(invoke).toHaveBeenCalledTimes(1);
      expect(String(invoke.mock.calls[0][0])).toContain("maxWidth=240");
    } finally {
      (globalThis as any).IntersectionObserver = orig;
    }
  });
});
