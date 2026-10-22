import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// supabase simulado: getSession e insert tardan (promesas pendientes) para comprobar que la
// ventana se abre ANTES de que se resuelvan.
let resolveSession: (v: unknown) => void = () => {};
const insert = vi.fn().mockResolvedValue({ error: null });
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getSession: vi.fn(() => new Promise((r) => { resolveSession = r; })) },
    from: vi.fn(() => ({ insert })),
  },
}));

import { logBookingClick, openExternalUrl, trackBookingClick } from "@/lib/trackBooking";

const input = { category: "flight" as const, provider: "Aviasales", title: "MEX → MAD", bookingUrl: "https://www.aviasales.com/search/MEX1011MAD15112?marker=533299" };

describe("trackBookingClick", () => {
  let open: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    insert.mockClear();
    open = vi.spyOn(window, "open");
  });
  afterEach(() => open.mockRestore());

  it("abre la ventana de forma síncrona, antes de cualquier await", async () => {
    const win = { opener: {} } as unknown as Window;
    open.mockReturnValue(win);
    trackBookingClick(input);
    // Todavía no se resolvió la sesión ni se insertó nada, y la ventana ya se abrió.
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith(input.bookingUrl, "_blank");
    expect(win.opener).toBeNull();
    expect(insert).not.toHaveBeenCalled();
    // Después se registra el clic en segundo plano.
    resolveSession({ data: { session: { user: { id: "u1" } } } });
    await vi.waitFor(() => expect(insert).toHaveBeenCalledTimes(1));
    expect(insert.mock.calls[0][0]).toMatchObject({ user_id: "u1", category: "flight", status: "pending", booking_url: input.bookingUrl });
  });

  it("sin sesión abre igual y no registra", async () => {
    open.mockReturnValue({ opener: null } as unknown as Window);
    const p = logBookingClick(input);
    resolveSession({ data: { session: null } });
    await p;
    expect(insert).not.toHaveBeenCalled();
  });

  it("si el navegador bloquea la pestaña, navega en la misma (el link no se pierde)", () => {
    open.mockReturnValue(null);
    const original = window.location;
    const loc = { href: "http://localhost/" } as Location;
    Object.defineProperty(window, "location", { configurable: true, value: loc });
    try {
      openExternalUrl("https://tp.media/click?marker=533299.hotels&u=x");
      expect(loc.href).toBe("https://tp.media/click?marker=533299.hotels&u=x");
    } finally {
      Object.defineProperty(window, "location", { configurable: true, value: original });
    }
  });
});
