// Pestaña Experiencias: al abrirla NO se gasta nada (ni Google, ni Viator, ni Ticketmaster); los museos
// salen de la tabla oficial local. Solo "Buscar lo TOP de {ciudad}" llama a experiencias-top. Cada lugar
// lleva su botón real y el estado lo marca la persona ("Ya reservé" con confirmación opcional). Sin red.
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const sb = vi.hoisted(() => ({ invokes: [] as string[], updates: [] as any[] }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: async (fn: string) => { sb.invokes.push(fn); return { data: null, error: null }; } },
    from: () => ({ update: (row: any) => ({ eq: async () => { sb.updates.push(row); return { error: null }; } }), insert: async () => ({ error: null }) }),
    auth: { getSession: async () => ({ data: { session: null } }) },
  },
}));
vi.mock("@/components/media/SmartImage", () => ({ SmartImage: ({ alt }: { alt: string }) => <span data-testid="foto">{alt}</span> }));
vi.mock("@/lib/trackBooking", () => ({ logBookingClick: async () => {} }));

import { TripExperiencias } from "@/components/trip/TripExperiencias";
import restFx from "./fixtures/lunaDeMiel/places_florencia_restaurantes.json";
import viatorFx from "./fixtures/lunaDeMiel/viator_florencia.json";
import { normalizePlace } from "../../supabase/functions/_shared/google-places";
import { restaurantView } from "../../supabase/functions/_shared/experiencias";
import { mapViatorProducts } from "../../supabase/functions/_shared/viator";
import { officialTicketsForCity, ticketSummary } from "../../supabase/functions/_shared/officialTickets";

const AT = "2026-10-27T18:00:00.000Z";
const trip = { id: "t-1", destino: "Florencia", fecha_salida: "2026-11-16", fecha_regreso: "2026-11-18", hospedaje_json: [], itinerario_json: [] };
const cities = [{ label: "Florencia", key: "Florencia", checkin: "2026-11-16", checkout: "2026-11-18" }];

function response() {
  const places = restFx.places.map((p) => normalizePlace(p, AT));
  const tours = mapViatorProducts(viatorFx.products, 12).slice(0, 2);
  return {
    ok: true, ciudad: "Florencia", consultado_at: AT, avisos: [],
    ancla: { tipo: "centro_aprox", nombre: null, lat: 43.77, lng: 11.25, nota: "Sin ubicación de hotel: distancias en línea recta desde el centro aproximado de los lugares encontrados." },
    restaurantes: { ok: true, items: places.slice(0, 3).map((p) => restaurantView(p, "Florencia", { lat: 43.77, lng: 11.25 })), aviso: "Criterio: 4.5★ o más con 500 reseñas o más en Google.", consulta: "mejores restaurantes en Florencia", consultado_at: AT },
    museos: { ok: true, items: officialTicketsForCity("Florencia").map((t) => ({ ...ticketSummary(t), lugar: null, distancia_km: null })), aviso: "Museos de nuestra tabla de taquillas oficiales (verificada el 27-oct-2026)." },
    tours: { ok: true, results: tours, consultado_at: AT, aviso: "Criterio: 4.6★ o más con 300 reseñas o más en Viator." },
    wow: { ok: true, results: [], consultado_at: AT, aviso: "", consultas: ["cata de vino Toscana", "clase de cocina"] },
    eventos: { ok: true, results: [], fuente: "Ticketmaster" },
  };
}

function marksFake() {
  const calls: any[] = [];
  return { calls, marks: { marks: new Map(), rows: [], mark: async (item: any, extra: any) => { calls.push({ item, extra }); return { ok: true }; }, unmark: async () => ({ ok: true }) } };
}

describe("pestaña Experiencias", () => {
  it("al abrir no llama a nada (los museos salen de la tabla oficial) y busca solo al pulsar", async () => {
    sb.invokes.length = 0;
    const invoke = vi.fn(async () => ({ data: response(), error: null }));
    const m = marksFake();
    render(<TripExperiencias trip={trip} cities={cities} multi={false} marks={m.marks as any} userId="u-1" invoke={invoke} />);
    expect(invoke).not.toHaveBeenCalled();
    expect(sb.invokes).toEqual([]);
    expect(screen.getByTestId("exp-sin-gasto")).toBeInTheDocument();
    // Museos de la tabla con su taquilla oficial, sin ninguna llamada.
    const museos = screen.getAllByTestId("exp-museo");
    expect(museos.map((x) => within(x).getByRole("heading").textContent)).toEqual(["Galería Uffizi", "Galería de la Academia (el David)", "Duomo y cúpula de Brunelleschi", "Palacio Pitti"]);
    expect(within(museos[0]).getByTestId("boletos-oficiales-taquilla")).toHaveAttribute("href", "https://tickets.uffizi.it/");
    expect(within(museos[0]).getByTestId("boletos-viator").getAttribute("href")).toMatch(/^https:\/\/www\.viator\.com\/searchResults\/all\?/);

    fireEvent.click(screen.getByTestId("exp-buscar"));
    await waitFor(() => expect(screen.getAllByTestId("exp-restaurante").length).toBe(3));
    expect(invoke).toHaveBeenCalledTimes(1);
    expect((invoke.mock.calls[0] as any)[0]).toBe("experiencias-top");
    expect((invoke.mock.calls[0] as any)[1].body).toMatchObject({ city: "Florencia", date_from: "2026-11-16", date_to: "2026-11-18" });
    expect(sb.invokes).toEqual([]);
  });

  it("restaurantes con sus botones, filtro por comida, «Ya reservé» con confirmación e itinerario", async () => {
    const invoke = vi.fn(async () => ({ data: response(), error: null }));
    const m = marksFake();
    render(<TripExperiencias trip={trip} cities={cities} multi={false} marks={m.marks as any} userId="u-1" invoke={invoke} />);
    fireEvent.click(screen.getByTestId("exp-buscar"));
    await waitFor(() => expect(screen.getAllByTestId("exp-restaurante").length).toBe(3));
    const uno = screen.getAllByTestId("exp-restaurante")[0];
    expect(within(uno).getByTestId("reserva-website")).toHaveTextContent("Reservar en su sitio");
    expect(within(uno).getByTestId("reserva-thefork").getAttribute("href")).toMatch(/^https:\/\/www\.thefork\.it\/search\?cityName=Firenze/);
    expect(within(uno).getByTestId("reserva-call")).toHaveAttribute("href", "tel:+390551234567");
    // +39 055… es un fijo: sin WhatsApp (defecto 14).
    expect(within(uno).queryByTestId("reserva-whatsapp")).toBeNull();
    const due = screen.getAllByTestId("exp-restaurante")[1];
    expect(within(due).getByTestId("reserva-nota")).toHaveTextContent("No toma reservaciones (llega directo)");
    expect(within(due).queryByTestId("reserva-whatsapp")).toBeNull();
    // Desayuno: solo el que Google marca que sirve desayuno.
    fireEvent.click(screen.getByTestId("exp-comida-desayuno"));
    expect(screen.getAllByTestId("exp-restaurante").map((x) => within(x).getByRole("heading").textContent)).toEqual(["Caffè Due"]);
    fireEvent.click(screen.getByText("Todos"));
    // "Ya reservé" lo marca la persona, con número de confirmación opcional.
    const card = screen.getAllByTestId("exp-restaurante")[0];
    fireEvent.click(within(card).getByTestId("ya-reserve"));
    fireEvent.change(within(card).getByPlaceholderText("Número de confirmación (opcional)"), { target: { value: "TF-123" } });
    fireEvent.click(within(card).getByText("Guardar"));
    await waitFor(() => expect(m.calls.length).toBe(1));
    expect(m.calls[0].extra).toMatchObject({ confirmacion: "TF-123", ciudad: "Florencia" });
    expect(m.calls[0].item).toMatchObject({ category: "restaurant", title: "Trattoria Uno" });
    // Itinerario: TOP sugeridos por día; nada se dice "reservado".
    fireEvent.click(screen.getByTestId("exp-armar"));
    expect(screen.getAllByTestId("exp-dia").length).toBe(2);
    const txt = screen.getByTestId("exp-itinerario").textContent ?? "";
    expect(txt).toMatch(/ningún lugar está reservado/);
    expect(txt.replace("ningún lugar está reservado", "")).not.toMatch(/reservad/i);
    expect(txt).toMatch(/km del centro aprox\./);
    fireEvent.click(screen.getByTestId("exp-guardar"));
    await waitFor(() => expect(sb.updates.length).toBe(1));
    const days = sb.updates[0].itinerario_json;
    expect(days.flatMap((d: any) => d.agregados ?? []).every((a: any) => a.fuente === "experiencias")).toBe(true);
  });
});
