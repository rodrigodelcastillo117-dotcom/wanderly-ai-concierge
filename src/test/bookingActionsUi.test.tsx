// UI del Booking Bridge (Fase 7): botones inequívocos, aviso antes de salir, consentimiento, enlace
// real apto para móvil (sin window.open) y solicitud por canal oficial con mensaje editable.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const bridgeMock = vi.fn();
vi.mock("@/lib/bookingBridgeApi", () => ({
  bridge: (...a: unknown[]) => bridgeMock(...a),
  newIdempotencyKey: () => "bk-test-key-123",
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: null } }) }, from: () => ({ insert: async () => ({ error: null }) }) },
}));

import { BookingActions } from "@/components/booking/BookingActions";
import { offerFromTripFlight, offerFromVenue } from "@/lib/booking";

const TRIP = { id: "11111111-1111-4111-8111-111111111111", destino: "Madrid", ciudad_origen: "Ciudad de México", fecha_salida: "2026-12-05",
  fecha_regreso: "2026-12-12", num_viajeros: 2 };
const flight = offerFromTripFlight({ aerolinea: "Iberia", fuente_precio: "travelpayouts", precio_por_persona: 21000,
  booking_link: "https://www.aviasales.com/search/MEX0512MAD12122?marker=533299" }, { trip: TRIP });
const src = { type: "trip_item" as const, trip_id: TRIP.id, col: "vuelos_json" as const, index: 0, name: "Iberia" };

beforeEach(() => bridgeMock.mockReset());

describe("BookingActions", () => {
  it("una búsqueda dice 'Buscar este vuelo' (nunca 'Comprar') y abre el aviso antes de salir", () => {
    const open = vi.spyOn(window, "open");
    render(<BookingActions offer={flight} source={src} tripId={TRIP.id} />);
    expect(screen.queryByText(/Comprar esta oferta/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Buscar este vuelo · Aviasales/ }));
    expect(screen.getByText("El precio puede cambiar al continuar en el proveedor.")).toBeInTheDocument();
    expect(screen.getByText(/La compra la procesa Aviasales/)).toBeInTheDocument();
    const a = screen.getByRole("link", { name: /Continuar en Aviasales/ });
    // Enlace real en una pestaña nueva, sin window.open (Safari iOS no lo bloquea).
    expect(a).toHaveAttribute("target", "_blank");
    expect(a.getAttribute("rel")).toContain("noopener");
    expect(a.getAttribute("href")).toBe("https://www.aviasales.com/search/MEX0512MAD12122?marker=533299");
    fireEvent.click(a);
    expect(open).not.toHaveBeenCalled();
    expect(bridgeMock).not.toHaveBeenCalled(); // sin consentimiento no se guarda nada
  });

  it("con consentimiento guarda la intención y usa la salida firmada", async () => {
    bridgeMock.mockResolvedValue({ ok: true, intent: { id: "i1", state: "READY_TO_BOOK" }, go_url: "https://x.supabase.co/functions/v1/booking-go?t=abc" });
    render(<BookingActions offer={flight} source={src} tripId={TRIP.id} />);
    fireEvent.click(screen.getByRole("button", { name: /Buscar este vuelo · Aviasales/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Guardar en mi viaje" }));
    await waitFor(() => expect(screen.getByRole("link", { name: /Continuar en Aviasales/ }).getAttribute("href")).toContain("booking-go?t=abc"));
    expect(bridgeMock).toHaveBeenCalledWith("start_booking", expect.objectContaining({ action_kind: "equivalent_search", consent: true, source: src }));
  });

  it("restaurante con WhatsApp verificado: mensaje editable y enlace wa.me con el texto", async () => {
    const venue = { name: "Casa X", city: "Tulum", country: "MX", booking_url: "https://wa.me/529841234567", source: "prive_catalog" as const };
    const offer = offerFromVenue(venue, "restaurant", { draft: { venue: "Casa X", product_type: "restaurant", lang: "es" } });
    render(<BookingActions offer={offer} source={{ type: "venue", name: "Casa X" }} />);
    fireEvent.click(screen.getByRole("button", { name: /Escribir por WhatsApp/ }));
    const box = screen.getByRole("textbox", { name: /Mensaje/ }) as HTMLTextAreaElement;
    expect(box.value).toContain("Casa X");
    fireEvent.change(box, { target: { value: "Hola 🙂\nmesa para 2 a las 9" } });
    const wa = screen.getByRole("link", { name: /Escribir por WhatsApp/ });
    expect(wa.getAttribute("href")).toBe(`https://wa.me/529841234567?text=${encodeURIComponent("Hola 🙂\nmesa para 2 a las 9")}`);
    expect(screen.getByText(/WhatsApp verificado/)).toBeInTheDocument();
  });

  it("sin acciones fiables lo dice en lugar de mostrar un botón que no sirve", () => {
    const empty = { ...flight, actions: [] };
    render(<BookingActions offer={empty} source={src} />);
    expect(screen.getByText(/No encontramos una forma fiable de reservar/)).toBeInTheDocument();
  });
});
