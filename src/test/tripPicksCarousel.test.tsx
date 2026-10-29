// Carrusel de restaurantes/experiencias (foto real de Google o "Foto ilustrativa", reservar, agregar al
// total, vacío sin inventar, flechas) y el botón "Convertir en ruta de varias ciudades".
import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => [] as Array<{ fn: string; body: any }>);
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: {
      invoke: vi.fn(async (fn: string, opts: any) => {
        const name = fn.split("?")[0];
        // place-photo va por GET con los parámetros en la URL (ronda 2, P2-11); el resto, en el cuerpo.
        const body = opts?.body ?? (fn.includes("?") ? Object.fromEntries(new URLSearchParams(fn.split("?")[1])) : undefined);
        calls.push({ fn: name, body });
        if (name === "place-photo" && body?.ref) return { data: { url: "https://lh3.googleusercontent.com/places/foto-real=s800" }, error: null };
        if (name === "place-photo") return { data: { url: null }, error: null }; // resolve: Google no encontró el mismo lugar
        if (name === "pexels-image") return { data: { image: "https://images.pexels.com/photos/1/comida.jpeg", photographer: "Ana" }, error: null };
        return { data: null, error: null };
      }),
    },
    from: () => ({ insert: async () => ({ error: null }) }),
  },
}));
vi.mock("@/lib/trackBooking", () => ({ logBookingClick: vi.fn() }));

import { TripPicksCarousel } from "@/components/booking/TripPicksCarousel";
import { ConvertToRouteBanner, convertToRouteHref } from "@/components/route/ConvertToRouteBanner";
import { __resetPlacePhotoCache } from "@/lib/placePhoto";

const trip = { id: "t1", destino: "París", fecha_salida: "2026-11-06" };
const rest = [
  { nombre: "Bouillon Chartier", cocina: "Francesa", rango_precio: "EUR 15–19", rating: 4.2, num_reviews: 40000, place_id: "ChIJ1", photo_ref: "places/ChIJ1/photos/AAA", fuente: "google_places", ciudad: "París" },
  { nombre: "Bistrot Paul Bert", cocina: "Bistro", rango_precio: "$$", ciudad: "París" },
];

beforeEach(() => { calls.length = 0; sessionStorage.clear(); __resetPlacePhotoCache(); });

describe("TripPicksCarousel", () => {
  it("foto real de Google con su crédito; sin foto real, ilustrativa marcada; vacío sin inventar", async () => {
    render(<TripPicksCarousel kind="restaurante" city="París" list={rest} indices={[0, 1]} taste={null} trip={trip}
      actionFor={(i) => (i === 0 ? { url: "https://www.opentable.com/r/chartier", site: "OpenTable" } : null)} isChosen={() => false} onChoose={() => {}} />);
    const list = screen.getByRole("list", { name: "Restaurantes en París" });
    const cards = within(list).getAllByTestId("pick-card");
    const econ = cards.find((c) => c.getAttribute("data-slot") === "economico")!;
    await waitFor(() => expect(econ.querySelector("img")?.getAttribute("src")).toMatch(/googleusercontent\.com/));
    expect(within(econ).getByTestId("google-caption")).toHaveTextContent("Foto: Google");
    expect(within(econ).getByTestId("pick-price")).toHaveTextContent("EUR 15–19 por persona");
    expect(within(econ).getByLabelText(/Calificación 4.2/)).toBeInTheDocument();
    expect(within(econ).getByTestId("pick-reservar")).toHaveAttribute("href", "https://www.opentable.com/r/chartier");

    const medio = cards.find((c) => c.getAttribute("data-slot") === "medio")!;
    await waitFor(() => expect(within(medio).getByTestId("illustrative-caption")).toHaveTextContent("Foto ilustrativa"));
    expect(medio.querySelector("img")?.getAttribute("src")).toMatch(/images\.pexels\.com/);
    expect(within(medio).getByTestId("pick-price")).toHaveTextContent("$$ · Medio");
    expect(within(medio).getByText(/Sin enlace fiable para reservar/)).toBeInTheDocument();
    // Probó la foto real por nombre y ciudad (resolve) antes de la ilustrativa.
    expect(calls.some((c) => c.fn === "place-photo" && c.body?.mode === "resolve" && c.body?.name === "Bistrot Paul Bert" && c.body?.city === "París")).toBe(true);

    // Sin opción cara: no se rellena ni ocupa una tarjeta vacía (pedido del dueño, 27-oct-2026); se dice en una línea.
    expect(within(list).queryAllByTestId("pick-card-vacia")).toHaveLength(0);
    expect(cards.some((c) => c.getAttribute("data-slot") === "caro")).toBe(false);
    expect(screen.getByTestId("picks-restaurante-sin-nivel")).toHaveTextContent("No encontramos opciones verificadas de nivel alto aquí.");
    // 1 foto de Google por ref + 1 resolve + 1 Pexels: ninguna llamada extra por tarjeta.
    expect(calls.filter((c) => c.fn === "place-photo").length).toBeLessThanOrEqual(3);
  });

  it("experiencias: 'Agregar al total' llama a elegir y se ve 'En tu total'", () => {
    const tours = [{ nombre: "Museo del Louvre", precio_por_persona: 480, duracion: "3 h", ciudad: "París" }];
    const chosen = new Set<number>();
    const onChoose = vi.fn((i: number) => chosen.add(i));
    const { rerender } = render(<TripPicksCarousel kind="experiencia" city="París" list={tours} indices={[0]} taste={null} trip={trip}
      actionFor={() => ({ url: "https://www.getyourguide.com/s/?q=Louvre", site: "GetYourGuide" })} isChosen={(i) => chosen.has(i)} onChoose={onChoose} />);
    const card = screen.getAllByTestId("pick-card").find((c) => c.getAttribute("data-slot") === "economico")!;
    expect(within(card).getByTestId("pick-price")).toHaveTextContent(/\$480 MXN por persona\s*·\s*estimado/);
    fireEvent.click(within(card).getByRole("button", { name: "Agregar al total" }));
    expect(onChoose).toHaveBeenCalledWith(0);
    rerender(<TripPicksCarousel kind="experiencia" city="París" list={tours} indices={[0]} taste={null} trip={trip}
      actionFor={() => null} isChosen={(i) => chosen.has(i)} onChoose={onChoose} />);
    expect(screen.getAllByTestId("pick-elegir")[0]).toHaveAttribute("aria-pressed", "true");
    expect(screen.getAllByTestId("pick-elegir")[0]).toHaveTextContent("En tu total");
  });

  it("flechas en computadora: avanzan una tarjeta", () => {
    render(<TripPicksCarousel kind="restaurante" city="París" list={rest} indices={[0, 1]} taste={null} trip={trip}
      actionFor={() => null} isChosen={() => false} />);
    const track = screen.getByRole("list", { name: "Restaurantes en París" });
    const scrollBy = vi.fn();
    Object.assign(track, { scrollBy });
    Object.defineProperty(track, "scrollWidth", { value: 1200, configurable: true });
    Object.defineProperty(track, "clientWidth", { value: 600, configurable: true });
    fireEvent.scroll(track);
    const next = screen.getByTestId("picks-restaurante-next");
    expect(next).not.toBeDisabled();
    expect(screen.getByTestId("picks-restaurante-prev")).toBeDisabled();
    fireEvent.click(next);
    expect(scrollBy).toHaveBeenCalledWith(expect.objectContaining({ left: expect.any(Number) }));
    expect(scrollBy.mock.calls[0][0].left).toBeGreaterThan(0);
  });
});

describe("Convertir en ruta de varias ciudades (viajes ya guardados)", () => {
  const legacy = { id: "t-viejo", destino: "paris roma y atenas 10 dias", ciudad_origen: "Ciudad de México", fecha_salida: "2026-11-06",
    fecha_regreso: "2026-11-15", num_viajeros: 1, itinerario_json: [{ dia: 1, titulo: "París" }] };

  it("ofrece el botón con la ruta precargada (ciudades, fechas, 1 viajero, 3·3·3 noches)", () => {
    render(<MemoryRouter><ConvertToRouteBanner trip={legacy} /></MemoryRouter>);
    expect(screen.getByTestId("convertir-ruta")).toHaveTextContent("Tu destino tiene 3 ciudades: París → Roma → Atenas.");
    const a = screen.getByRole("link", { name: "Convertir en ruta de varias ciudades" });
    const url = new URL(a.getAttribute("href")!, "https://x.test");
    expect(url.pathname).toBe("/dashboard/ruta");
    expect(Object.fromEntries(url.searchParams)).toEqual({ origin: "Ciudad de México", destinos: "París|Roma|Atenas", fecha_salida: "2026-11-06",
      fecha_regreso: "2026-11-15", viajeros: "1", noches: "3|3|3", desde_viaje: "t-viejo" });
  });

  it("no aparece en un viaje que ya es multi-destino ni en uno de un solo destino (no inventa)", () => {
    expect(convertToRouteHref({ ...legacy, itinerario_json: { multi: true, destinations: ["París", "Roma", "Atenas"] } })).toBeNull();
    expect(convertToRouteHref({ ...legacy, destino: "Nueva York" })).toBeNull();
    expect(convertToRouteHref({ ...legacy, destino: "Francia, Italia y Grecia" })).toBeNull();
    const { container } = render(<MemoryRouter><ConvertToRouteBanner trip={{ ...legacy, destino: "San Miguel de Allende" }} /></MemoryRouter>);
    expect(container).toBeEmptyDOMElement();
  });
});
