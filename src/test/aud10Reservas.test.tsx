// Auditoría 10/10 (herramientas, 28-oct-2026) · Mis reservas y Favoritos:
//  P1-8  el viaje a Lisboa empieza el 10/3/2027 y la tarjeta decía 9/3/2027 (fecha guardada a medianoche UTC).
//  P2-12 visitas duplicadas («Cabo da Roca» ×2) y «Iato escribirá a <correo de prueba>» sin aclarar que es
//        el correo de prueba del piloto.
//  P1-9  Favoritos: «DESTINATION_AI», «84% match», «el AI aprende» y tarjetas que no abrían nada.
import React from "react";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { formatBookingDate } from "@/lib/localDate";
import { dedupeVisits } from "@/lib/bookingKinds";
import { isPilotTestEmail, recipientNote } from "@/lib/aiReservations";
import { favoriteHref, favoriteKindLabel } from "@/lib/favorites";

const db = vi.hoisted(() => ({ tables: {} as Record<string, any[]> }));
vi.mock("@/integrations/supabase/client", () => {
  const from = (table: string) => {
    const api: any = {
      select: () => api, eq: () => api, order: () => api, limit: () => api, update: () => api,
      then: (res: any, rej: any) => Promise.resolve({ data: db.tables[table] ?? [], error: null }).then(res, rej),
    };
    return api;
  };
  return { supabase: { from, functions: { invoke: vi.fn(async () => ({ data: null, error: null })) } } };
});
const authUser = vi.hoisted(() => ({ id: "u1" }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: authUser, loading: false }) }));
vi.mock("@/components/DashboardLayout", () => ({ DashboardLayout: ({ children }: any) => <>{children}</> }));
vi.mock("@/components/reservas/AiReservationsPanel", () => ({ AiReservationsPanel: () => null }));
vi.mock("@/components/concierge/MyTeamRequests", () => ({ MyTeamRequests: () => null }));
vi.mock("@/components/media/SmartImage", () => ({ SmartImage: () => null }));
vi.mock("@/lib/bookingExit", () => ({ useBookingExitNotice: () => {} }));
vi.mock("@/lib/insights", () => ({ logInsight: vi.fn(async () => {}) }));

import Reservas from "@/pages/Reservas";
import Favoritos from "@/pages/Favoritos";

describe("P1-8 fechas sin zona en Mis reservas", () => {
  it("una fecha guardada a medianoche UTC se muestra el mismo día", () => {
    expect(formatBookingDate("2027-03-10T00:00:00+00:00")).toBe(new Date(2027, 2, 10, 12).toLocaleDateString("es-MX"));
    expect(formatBookingDate("2027-02-10T00:00:00Z")).toBe(new Date(2027, 1, 10, 12).toLocaleDateString("es-MX"));
    expect(formatBookingDate("2027-02-10")).toBe(new Date(2027, 1, 10, 12).toLocaleDateString("es-MX"));
    // Un instante con hora real sigue pasando a la hora local.
    expect(formatBookingDate("2027-02-10T18:30:00Z")).toBe(new Date("2027-02-10T18:30:00Z").toLocaleDateString("es-MX"));
  });
});

describe("P2-12 visitas y correo del piloto", () => {
  it("agrupa la misma visita y cuenta las veces", () => {
    const row = (id: string, created_at: string) => ({ id, category: "activity", provider: "GetYourGuide", title: "Cabo da Roca", city: "Lisboa", start_at: "2027-03-10T00:00:00+00:00", booking_url: "https://www.getyourguide.com/x", created_at });
    const out = dedupeVisits([row("b", "2026-10-28T20:00:00Z"), row("a", "2026-10-27T20:00:00Z"), { ...row("c", "2026-10-26T20:00:00Z"), title: "Sintra" }]);
    expect(out.map((r) => [r.id, r.times])).toEqual([["b", 2], ["c", 1]]);
  });

  it("aclara cuando el destinatario es el correo de prueba del piloto", () => {
    const pilot = { venue_email_source: { url: "piloto://correo-de-prueba-del-dueno", quote: "Correo de prueba del piloto: no es del restaurante." } };
    expect(isPilotTestEmail(pilot)).toBe(true);
    expect(recipientNote(pilot)).toMatch(/Correo de prueba del piloto, no es el del restaurante/);
    expect(recipientNote({ venue_email_source: { url: "https://contramar.com.mx/contacto" } })).toBeNull();
  });

  it("la pantalla muestra la fecha correcta y una sola visita", async () => {
    db.tables = { bookings: [
      { id: "v2", category: "activity", provider: "GetYourGuide", title: "Cabo da Roca", city: "Lisboa", start_at: "2027-03-10T00:00:00+00:00", booking_url: "https://www.getyourguide.com/x", status: "pending", created_at: "2026-10-28T20:00:00Z" },
      { id: "v1", category: "activity", provider: "GetYourGuide", title: "Cabo da Roca", city: "Lisboa", start_at: "2027-03-10T00:00:00+00:00", booking_url: "https://www.getyourguide.com/x", status: "pending", created_at: "2026-10-28T19:00:00Z" },
    ] };
    render(<MemoryRouter><Reservas /></MemoryRouter>);
    const section = (await screen.findByRole("heading", { name: /Búsquedas\/visitas a socios/ })).closest("section")!;
    expect(within(section).getAllByText("Cabo da Roca")).toHaveLength(1);
    expect(within(section).getByTestId("reserva-fecha").textContent).toBe(new Date(2027, 2, 10, 12).toLocaleDateString("es-MX"));
    expect(section.textContent).toMatch(/Abierto 2 veces/);
  });
});

describe("P1-9 Favoritos", () => {
  it("etiquetas legibles y a dónde lleva cada tarjeta", () => {
    expect(favoriteKindLabel("destination_ai")).toBe("Destino");
    expect(favoriteKindLabel("restaurante")).toBe("Restaurante");
    expect(favoriteKindLabel("algo_tecnico")).toBeNull();
    expect(favoriteHref({ titulo: "Lisboa", tipo: "destination_ai" })).toEqual({ url: "/dashboard/planear?destino=Lisboa", internal: true, label: "Planear un viaje a Lisboa" });
    const place = favoriteHref({ titulo: "Contramar", tipo: "restaurante", descripcion: "Ciudad de México", metadata: { place_id: "ChIJabc" } })!;
    expect(place.internal).toBe(false);
    expect(place.url).toBe("https://www.google.com/maps/search/?api=1&query=Contramar%2C%20Ciudad%20de%20M%C3%A9xico&query_place_id=ChIJabc");
  });

  beforeEach(() => {
    db.tables = { recomendaciones: [{ id: "r1", titulo: "Lisboa", descripcion: "Portugal", tipo: "destination_ai", imagen_url: null, match_score: 84 }] };
  });

  it("la pantalla no muestra el tipo técnico ni inglés, y la tarjeta abre el destino", async () => {
    render(<MemoryRouter><Favoritos /></MemoryRouter>);
    const link = await screen.findByTestId("favorito-abrir");
    expect(link).toHaveAttribute("href", "/dashboard/planear?destino=Lisboa");
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/destination_ai|DESTINATION_AI|match|el AI/i);
    expect(text).toMatch(/Destino/);
    expect(text).toMatch(/84% afín a ti/);
  });
});
