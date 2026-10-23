// "Llévame" (Take Me There): URL oficial de Google Maps y botón en las cards de lugar.
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: () => ({ insert: () => Promise.resolve({ data: null, error: null }) }), functions: { invoke: vi.fn() } },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" } }) }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

import { canTakeMeThere, isMobileDevice, takeMeThereUrl } from "@/lib/takeMeThere";
import { RichCard, type ConciergeCard } from "@/components/concierge/ConciergeCards";
import { TakeMeThereButton } from "@/components/concierge/TakeMeThereButton";

const PID = "ChIJPruebaInterlomas0002";

describe("takeMeThereUrl", () => {
  it("con place_id: nombre codificado + destination_place_id, modo y sin origen", () => {
    const url = takeMeThereUrl({ name: "Bistró Ejemplo & Café #1", placeId: PID }, { mode: "walking" })!;
    expect(url).toBe(`https://www.google.com/maps/dir/?api=1&destination=Bistr%C3%B3%20Ejemplo%20%26%20Caf%C3%A9%20%231&destination_place_id=${PID}&travelmode=walking`);
    const u = new URL(url);
    expect(u.searchParams.get("destination")).toBe("Bistró Ejemplo & Café #1");
    expect(u.searchParams.get("destination_place_id")).toBe(PID);
    expect(u.searchParams.has("origin")).toBe(false);
    expect(u.searchParams.has("dir_action")).toBe(false);
  });

  it("con coordenadas y sin place_id: destination=lat,lng", () => {
    const u = new URL(takeMeThereUrl({ name: "Lugar", lat: 19.3975, lng: -99.2731 })!);
    expect(u.searchParams.get("destination")).toBe("19.3975,-99.2731");
    expect(u.searchParams.has("destination_place_id")).toBe(false);
    expect(u.searchParams.get("travelmode")).toBe("driving");
  });

  it("los 4 modos oficiales; cualquier otro cae a driving", () => {
    for (const m of ["driving", "walking", "transit", "bicycling"]) {
      expect(new URL(takeMeThereUrl({ name: "X", placeId: PID }, { mode: m })!).searchParams.get("travelmode")).toBe(m);
    }
    expect(new URL(takeMeThereUrl({ name: "X", placeId: PID }, { mode: "flying" })!).searchParams.get("travelmode")).toBe("driving");
  });

  it("dir_action=navigate solo en móvil", () => {
    expect(takeMeThereUrl({ name: "X", placeId: PID }, { mobile: true })).toMatch(/&dir_action=navigate$/);
    expect(takeMeThereUrl({ name: "X", placeId: PID }, { mobile: false })).not.toMatch(/dir_action/);
  });

  it("origin solo con una dirección explícita del usuario", () => {
    const u = new URL(takeMeThereUrl({ name: "X", placeId: PID }, { origin: "Av. Reforma 222, CDMX" })!);
    expect(u.searchParams.get("origin")).toBe("Av. Reforma 222, CDMX");
    expect(takeMeThereUrl({ name: "X", placeId: PID }, { origin: "  " })).not.toMatch(/origin=/);
  });

  it("sin place_id válido ni coordenadas: no hay enlace", () => {
    expect(takeMeThereUrl({ name: "X" })).toBeNull();
    expect(takeMeThereUrl({ name: "X", placeId: "123e4567-e89b-12d3-a456-426614174000" })).toBeNull(); // UUID de Members
    expect(takeMeThereUrl({ name: "X", lat: 0, lng: 0 })).toBeNull();
    expect(canTakeMeThere({ placeId: PID })).toBe(true);
  });

  it("móvil por el navegador (sin permisos)", () => {
    expect(isMobileDevice({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)" })).toBe(true);
    expect(isMobileDevice({ userAgent: "Mozilla/5.0 (Linux; Android 14)" })).toBe(true);
    expect(isMobileDevice({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", maxTouchPoints: 0 })).toBe(false);
    expect(isMobileDevice({ userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" })).toBe(false);
  });
});

describe("botón Llévame", () => {
  it("se dibuja en la card de restaurante con place_id y abre Google Maps", () => {
    const card: ConciergeCard = { type: "restaurant", title: "Bistró Ejemplo", subtitle: "Interlomas", place_id: PID, lat: 19.3975, lng: -99.2731 };
    render(<RichCard card={card} />);
    const a = screen.getByTestId("take-me-there") as HTMLAnchorElement;
    expect(a.textContent).toMatch(/Llévame/);
    expect(a.getAttribute("target")).toBe("_blank");
    const u = new URL(a.href);
    expect(`${u.origin}${u.pathname}`).toBe("https://www.google.com/maps/dir/");
    expect(u.searchParams.get("destination_place_id")).toBe(PID);
    expect(u.searchParams.has("origin")).toBe(false);
  });

  it("en la card de lugar con solo coordenadas también; sin place_id ni coordenadas, no", () => {
    const { unmount } = render(<RichCard card={{ type: "place", title: "Mirador", lat: 19.4, lng: -99.2 }} />);
    expect(new URL((screen.getByTestId("take-me-there") as HTMLAnchorElement).href).searchParams.get("destination")).toBe("19.4,-99.2");
    unmount();
    render(<RichCard card={{ type: "restaurant", title: "Sin datos", subtitle: "CDMX" }} />);
    expect(screen.queryByTestId("take-me-there")).toBeNull();
  });

  it("componente suelto: sin destino válido no se dibuja", () => {
    const { container } = render(<TakeMeThereButton target={{ name: "X" }} />);
    expect(container.innerHTML).toBe("");
  });
});
