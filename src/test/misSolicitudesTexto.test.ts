// Dueño, 11-nov-2026 (captura de «Mis solicitudes»): «veo errores… hasta de gramática». Título con lo que escribió entre
// comillas y con mayúscula, «Enviada el 9 jun a las 18:38» (no «Pedida 9 jun, 18:38 h») y sin repetir que la atiende una persona.
import { describe, expect, it, vi } from "vitest";
import { displayRequestTitle } from "../../supabase/functions/_shared/ops-labels";

vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: vi.fn(), auth: { getSession: vi.fn(async () => ({ data: { session: null } })) } } }));

describe("Mis solicitudes: textos claros", () => {
  it("título: lo que escribió va entre comillas y con mayúscula", () => {
    expect(displayRequestTitle("Pregunta general: mi vuelo como estga")).toBe("Pregunta general: «Mi vuelo como estga»");
    expect(displayRequestTitle("Pregunta general: hola")).toBe("Pregunta general: «Hola»");
    expect(displayRequestTitle("Urgente: perdí mi pasaporte")).toBe("Urgente: «Perdí mi pasaporte»");
    expect(displayRequestTitle("Reserva en Contramar")).toBe("Reserva en Contramar");
    expect(displayRequestTitle("Pregunta general:")).toBe("Pregunta general:");
  });
  it("fecha: «Enviada el 9 jun a las 18:38» o «Enviada hace 3 h»", async () => {
    const { sentText } = await import("@/lib/opsDesk");
    const now = new Date("2026-11-11T20:00:00Z");
    expect(sentText("2026-06-10T00:38:00Z", now)).toMatch(/^Enviada el 9 jun a las 18:38$/);
    expect(sentText("2026-11-11T17:00:00Z", now)).toBe("Enviada hace 3 h");
  });
  it("si la primera lectura falla (sesión recién iniciada), reintenta sola", async () => {
    vi.useFakeTimers();
    const { supabase } = await import("@/integrations/supabase/client");
    const rpc = supabase.rpc as unknown as ReturnType<typeof vi.fn>;
    rpc.mockResolvedValueOnce({ data: null, error: { message: "JWT expired" } }).mockResolvedValueOnce({ data: [{ id: "x" }], error: null });
    const { myTeamRequests } = await import("@/lib/opsDesk");
    const p = myTeamRequests();
    await vi.runAllTimersAsync();
    const r = await p;
    vi.useRealTimers();
    expect(r.ok).toBe(true);
    expect(rpc).toHaveBeenCalledTimes(2);
  });
});
