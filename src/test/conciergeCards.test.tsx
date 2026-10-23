import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const invoke = vi.fn();
const inserts: { table: string; row: any }[] = [];
const updates: { table: string; row: any }[] = [];

vi.mock("@/integrations/supabase/client", () => {
  const from = (table: string) => {
    const done = Promise.resolve({ data: null, error: null });
    return {
      insert: (row: any) => {
        inserts.push({ table, row });
        const r: any = { then: done.then.bind(done) };
        r.select = () => ({ single: async () => ({ data: { id: "esc-1" }, error: null }) });
        return r;
      },
      update: (row: any) => {
        updates.push({ table, row });
        return { eq: () => done };
      },
    };
  };
  return { supabase: { from, functions: { invoke: (...a: any[]) => invoke(...a) } } };
});
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "u1", email: "ana@example.test", user_metadata: { full_name: "Ana" } } }),
}));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

import { RichCard, CARD_TYPES, type ConciergeCard } from "@/components/concierge/ConciergeCards";
import { FixerButton } from "@/components/FixerButton";

// Consulta de hace 5 min (relativa al reloj: "en vivo" solo vale ≤ 15 min).
const live = { estado_dato: "CONSULTADO_EN_VIVO" as const, fuente: "serpapi", consultado_at: new Date(Date.now() - 5 * 60_000).toISOString() };

const SAMPLE: Record<string, ConciergeCard> = {
  flight: { type: "flight", title: "Aeroméxico", subtitle: "MEX→MAD", price: 937, price_usd: 937, currency: "USD", cta_label: "Comprar", cta_action: "https://www.aviasales.com/search/x", ...live },
  hotel: { type: "hotel", title: "Le Bristol", subtitle: "París · 5★", price: 1620, price_usd: 1620, currency: "USD", cta_action: "https://www.booking.com/x", ...live },
  attraction: { type: "attraction", title: "Louvre", subtitle: "París", cta_action: "https://www.tripadvisor.com/x" },
  restaurant: { type: "restaurant", title: "Pujol", subtitle: "CDMX", cta_action: "https://pujol.com.mx" },
  place: { type: "place", title: "The Centurion Lounge", subtitle: "Terminal 1, AICM", meta: "Abierto 05:00–23:00", fuente: "google_maps",
    links: [{ kind: "directions", label: "Cómo llegar", url: "https://www.google.com/maps/dir/?api=1&destination=19.43,-99.08" }] },
  source: { type: "source", title: "The Centurion Lounge Mexico City", subtitle: "americanexpress.com", body: "Terminal 1", cta_action: "https://www.americanexpress.com/x" },
  transport: { type: "transport", title: "Chofer ejecutivo", subtitle: "CDG → Hotel", cta_label: "Buscar Blacklane", cta_action: "https://www.google.com/search?q=Blacklane" },
  alert: { type: "alert", title: "Falta seguro", body: "No veo seguro de viaje" },
  luggage: { type: "luggage", title: "Equipaje Invisible", from: "Hotel", to: "CDG", estado_dato: "SOLICITUD_HUMANA" },
  jet: { type: "jet", title: "Aviación privada", route: "MEX→TEB", estado_dato: "SOLICITUD_HUMANA" },
};

beforeEach(() => { invoke.mockReset(); inserts.length = 0; updates.length = 0; });

describe("RichCard (B-02)", () => {
  it.each(CARD_TYPES.map((t) => [t]))("dibuja la card %s (antes flight/hotel/attraction desaparecían)", (type) => {
    const { container } = render(<RichCard card={SAMPLE[type]} />);
    expect(container.querySelector(`[data-card-type="${type}"]`)).not.toBeNull();
    expect(screen.getAllByText(SAMPLE[type].title).length).toBeGreaterThan(0);
  });

  it("vuelo: precio con moneda, insignia de origen y enlace en pestaña nueva con rel=noopener", () => {
    render(<RichCard card={SAMPLE.flight} />);
    expect(screen.getByText(/937/)).toBeInTheDocument();
    expect(screen.getByText("USD")).toBeInTheDocument();
    expect(screen.getByText(/Google Flights · consultado en vivo/)).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /Comprar/ });
    expect(link).toHaveAttribute("href", "https://www.aviasales.com/search/x");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("rel")).toMatch(/noopener/);
  });

  it("nunca muestra un precio sin etiqueta de fuente", () => {
    const { container } = render(<RichCard card={{ type: "hotel", title: "Ritz", price_usd: 999, currency: "USD" }} />);
    expect(container.textContent).not.toMatch(/999/);
  });

  it("precio no verificado: se dice y no se muestra cifra", () => {
    const { container } = render(<RichCard card={{ type: "flight", title: "Iberia", estado_dato: "NO_VERIFICADO", price_note: "precio no verificado" }} />);
    expect(screen.getAllByText(/Precio no verificado/).length).toBeGreaterThan(0);
    expect(container.textContent).not.toMatch(/\$/);
  });

  it("no hay enlace con javascript:", () => {
    render(<RichCard card={{ type: "attraction", title: "X", cta_action: "javascript:alert(1)" }} />);
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("B-17 transporte abre su propio enlace, no Welcome Pickups", () => {
    const open = vi.spyOn(window, "open").mockReturnValue({} as Window);
    render(<RichCard card={SAMPLE.transport} />);
    fireEvent.click(screen.getByRole("button", { name: /Buscar Blacklane/ }));
    // ActionButton abre sin "noopener" en features (con él window.open siempre devuelve null y el
    // respaldo navegaba también esta pestaña) y corta `opener` a mano.
    expect(open).toHaveBeenCalledWith("https://www.google.com/search?q=Blacklane", "_blank");
    open.mockRestore();
  });
});

describe("Jet y equipaje (B-04)", () => {
  it("es una solicitud de cotización y solo dice 'recibida' cuando el servidor da folio", async () => {
    invoke.mockResolvedValueOnce({ data: { ok: true, request: { id: "abcdef12-0000" }, human_notified: true }, error: null });
    render(<RichCard card={SAMPLE.jet} tripId="paris" />);
    expect(screen.queryByText(/\$|USD/)).toBeNull();
    expect(screen.getByText(/un humano te responde con disponibilidad y precio/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Solicitar cotización" }));
    expect(await screen.findByRole("button", { name: "✓ Solicitud recibida" })).toBeDisabled();
    expect(screen.getByText(/Folio ABCDEF12/)).toBeInTheDocument();
    // God Mode F1: el estado real con etiqueta honesta.
    expect(screen.getByText("Solicitud enviada · aún no es una reserva")).toBeInTheDocument();
    expect(invoke).toHaveBeenCalledWith("concierge-action", { body: expect.objectContaining({ type: "jet", trip_id: "paris" }) });
  });

  it("sin confirmación del servidor no dice 'recibida'", async () => {
    invoke.mockResolvedValueOnce({ data: { ok: true }, error: null });
    render(<RichCard card={SAMPLE.luggage} />);
    fireEvent.click(screen.getByRole("button", { name: "Solicitar cotización" }));
    expect(await screen.findByRole("button", { name: "Reintentar" })).toBeInTheDocument();
    expect(screen.queryByText(/Solicitud recibida/)).toBeNull();
  });
});

describe("FixerButton (B-12)", () => {
  it("guarda 'pendiente' y después el resultado real del envío", async () => {
    invoke.mockResolvedValueOnce({ data: { ok: true }, error: null });
    render(<FixerButton trip={{ id: "paris", destino: "París" }} />);
    fireEvent.click(screen.getByRole("button", { name: /Fixer/ }));
    fireEvent.click(await screen.findByText("Crítico"));
    fireEvent.click(screen.getByRole("button", { name: /Enviar al Fixer/ }));
    await waitFor(() => expect(updates.some((u) => u.table === "fixer_escalations")).toBe(true));
    const ins = inserts.find((i) => i.table === "fixer_escalations")!;
    expect(ins.row).toMatchObject({ status: "pendiente", trip_id: "paris", urgencia: "critica" });
    expect(updates.find((u) => u.table === "fixer_escalations")!.row).toEqual({ status: "email_enviado" });
  });

  it("si el correo falla, queda 'email_fallido'", async () => {
    invoke.mockResolvedValueOnce({ data: null, error: new Error("resend down") });
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    render(<FixerButton trip={null} />);
    fireEvent.click(screen.getByRole("button", { name: /Fixer/ }));
    fireEvent.click(await screen.findByText("Importante"));
    fireEvent.click(screen.getByRole("button", { name: /Enviar al Fixer/ }));
    await waitFor(() => expect(updates.length).toBeGreaterThan(0));
    expect(updates[0].row).toEqual({ status: "email_fallido" });
    open.mockRestore();
  });
});
