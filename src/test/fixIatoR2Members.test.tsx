// Auditoría 10, ronda 2 (N9): Solo para miembros a 390 px. La tarjeta única no ocupaba el ancho ("Soho
// House Mexico…" cortado y "Reservar con Concierge" en 2 líneas), Parker & Lenox se quedaba sin foto y
// buscar "jazz" decía "SIN CIUDADES CON ESE NOMBRE" sin aclarar que solo buscaba en la ciudad elegida.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const V = (id: string, nombre: string, categoria: string, por_que: string) => ({
  id, ciudad: "ciudad de mexico", ciudad_display: "Ciudad de México", categoria, emoji: null, nombre, por_que, descripcion: null, dress_code: null,
  precio_estimado: "$$", reserva_requerida: false, tags: [], address: "Colima 92", website: "https://example.mx/", fuente: "curaduria",
  effective_state: "VERIFICADO", effective_label: "NINGUNA", source_url: "https://example.mx/", verified_at: "2026-10-22T12:00:00+00:00",
  neighborhood: "Roma", season_state: null, age_policy: "18+",
});
const VENUES = [
  V("c1", "Soho House Mexico City", "members_club", "Primera casa de Soho House en Latinoamérica, con alberca en la azotea."),
  V("j1", "Parker & Lenox", "jazz_lounge", "Bar de jazz en vivo (Parker) de martes a sábado y restaurante (Lenox)."),
  V("j2", "Jazzatlán Capital", "jazz_lounge", "Club de jazz con músicos locales."),
];
const rpc = vi.fn(async (fn: string) => {
  if (fn === "members_access_state") return { data: { access: true, via: "plan", password_gate: false }, error: null };
  if (fn === "members_venues") return { data: VENUES, error: null };
  if (fn === "members_cities") return { data: [{ ciudad: "cdmx", ciudad_display: "Ciudad de México", pais: "México", venues: 3 }], error: null };
  return { data: null, error: null };
});
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (fn: string) => rpc(fn), functions: { invoke: vi.fn() }, from: () => ({}), auth: { getSession: async () => ({ data: { session: null } }) } },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" } }) }));
vi.mock("@/hooks/useSubscription", () => ({ useSubscription: () => ({ loading: false, isPro: true }) }));
vi.mock("@/components/CityVideoCard", () => ({ CityVideoCard: ({ city }: { city: string }) => <span data-testid="city-card">{city}</span> }));
vi.mock("@/components/media/VenueImage", () => ({ VenueImage: ({ className }: { className?: string }) => <span data-testid="venue-img" className={className} /> }));
const photo = vi.hoisted(() => ({ resolve: vi.fn(), stock: vi.fn() }));
vi.mock("@/lib/placePhoto", () => ({
  cachedPlacePhoto: () => undefined, cachedResolvedPhoto: () => undefined, fetchPlacePhotoUrl: async () => null,
  resolvePlacePhotoUrl: (...a: unknown[]) => photo.resolve(...a),
}));
vi.mock("@/lib/stockPhoto", () => ({ cachedStockPhoto: () => undefined, getStockPhoto: (...a: unknown[]) => photo.stock(...a) }));
vi.mock("@/hooks/useInView", () => ({ useInView: () => true }));

import { MembersOnlyPanel } from "@/components/MembersOnlyPanel";
import { IMAGE_STEP_TIMEOUT_MS, SmartImage } from "@/components/media/SmartImage";

beforeEach(() => { photo.resolve.mockReset(); photo.stock.mockReset(); });

describe("N9 · Solo para miembros a 390 px", () => {
  it("una categoría con un solo lugar: la tarjeta ocupa todo el ancho; nombre y descripción en 2 líneas; botón en 1 línea", async () => {
    render(<MemoryRouter><MembersOnlyPanel preferredCities={["Ciudad de México"]} /></MemoryRouter>);
    const card = (await screen.findByText("Soho House Mexico City")).closest("article")!;
    expect(card.className).not.toMatch(/w-\[86%\]/);
    expect(within(card).getByText("Soho House Mexico City").className).toMatch(/line-clamp-2/);
    expect(within(card).getByRole("button", { name: "Reservar con Concierge" }).className).toMatch(/whitespace-nowrap/);
    // Con 2 lugares (jazz) sigue el carrusel.
    const parker = screen.getByText("Parker & Lenox").closest("article")!;
    expect(parker.className).toMatch(/w-\[86%\]/);
  });
  it("el nombre de la ciudad en su tarjeta usa 2 líneas (no 'Ciudad de M…')", async () => {
    const { CityVideoCard } = await vi.importActual<typeof import("@/components/CityVideoCard")>("@/components/CityVideoCard");
    render(<CityVideoCard city="Ciudad de México" subtitle="3 lugares" active={false} onClick={() => {}} className="w-[38%] h-24" />);
    const name = screen.getByText("Ciudad de México");
    expect(name.className).toMatch(/line-clamp-2/);
    expect(name.className).not.toMatch(/\btruncate\b/);
  });
  it("buscar 'jazz' dice claro que busca solo en la ciudad elegida", async () => {
    render(<MemoryRouter><MembersOnlyPanel preferredCities={["Ciudad de México"]} /></MemoryRouter>);
    await screen.findByText("Soho House Mexico City");
    fireEvent.change(screen.getByLabelText("Buscar ciudad o lugar"), { target: { value: "jazz" } });
    expect(screen.queryByText(/Sin ciudades con ese nombre/i)).toBeNull();
    expect(screen.getByText(/Ninguna ciudad se llama «jazz» · buscando lugares en Ciudad de México/)).toBeInTheDocument();
    expect(screen.getByTestId("members-search-scope")).toHaveTextContent("Resultados de «jazz» solo en Ciudad de México");
  });
  it("una foto que nunca llega no deja el esqueleto para siempre: pasa a la ilustrativa marcada", async () => {
    vi.useFakeTimers();
    try {
      photo.resolve.mockImplementation(() => new Promise(() => {})); // el lugar nunca responde (como Parker & Lenox)
      photo.stock.mockResolvedValue({ image: "https://images.pexels.com/photos/1/jazz.jpeg", photographer: "Ana" });
      render(<SmartImage alt="Foto de Parker & Lenox" lookup={{ name: "Parker & Lenox", city: "Ciudad de México" }} stockQuery="jazz bar" size="thumb" className="h-24 w-24" />);
      expect(screen.getByTestId("smart-image").dataset.kind).toBe("pending");
      await act(async () => { await vi.advanceTimersByTimeAsync(IMAGE_STEP_TIMEOUT_MS + 50); });
      expect(screen.getByTestId("smart-image").dataset.kind).toBe("stock");
    } finally {
      vi.useRealTimers();
    }
  });
});
