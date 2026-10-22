// Hallazgos de la verificación en producción R10 (grupo biz): cuotas, Stripe e Iato.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { mentionsUntrackedPlace, needsSpecificTrip, resolveActiveTrip, type TripLike } from "../../supabase/functions/_shared/activeTrip";
import { tripResolutionLine } from "../../supabase/functions/concierge-chat/prompt";
import { proStatusLabel } from "@/lib/proStatus";

const rpcMock = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...a: unknown[]) => rpcMock(...a),
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
    functions: { invoke: vi.fn() },
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "user-1" }, loading: false }) }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));

import { useSubscription, notifyAccessChanged } from "@/hooks/useSubscription";

const HOY = "2026-10-22";
const trips: TripLike[] = [
  { id: "puebla", destino: "Puebla", pais_destino: "México", fecha_salida: "2026-12-12", fecha_regreso: "2026-12-14" },
  { id: "madrid", destino: "Madrid", pais_destino: "España", fecha_salida: "2027-02-10", fecha_regreso: "2027-02-17" },
  { id: "cancun", destino: "Cancún", pais_destino: "México", fecha_salida: "2027-03-20", fecha_regreso: "2027-03-25" },
];

describe("R10 · 'mi viaje a Japón' sin viaje a Japón no lista viajes ajenos", () => {
  it("antes: ambiguo + needsSpecificTrip → se preguntaba '¿a cuál?' con Puebla/Madrid/Cancún", () => {
    const msg = "Iato, ayúdame con mi viaje a Japón";
    expect(resolveActiveTrip(trips, { todayLocal: HOY, mentionedText: msg }).reason).toBe("ambiguous");
    expect(needsSpecificTrip(msg)).toBe(true);
    // ahora el servidor lo detecta y deja que responda el modelo
    expect(mentionsUntrackedPlace(msg, trips)).toBe(true);
  });
  it("destinos que sí están en los viajes, o sin destino, siguen preguntando cuál", () => {
    expect(mentionsUntrackedPlace("¿A qué hora sale mi vuelo?", trips)).toBe(false);
    expect(mentionsUntrackedPlace("Quiero cenar cerca de mi hotel", trips)).toBe(false);
    expect(mentionsUntrackedPlace("¿qué llevo para mi viaje a la playa?", trips)).toBe(false);
    expect(mentionsUntrackedPlace("mi viaje a España", trips)).toBe(false); // Madrid es España
    expect(mentionsUntrackedPlace("mi vuelo a Cancún", trips)).toBe(false);
  });
  it("detecta ciudades fuera de COUNTRY_GROUPS por el patrón 'viaje a X'", () => {
    expect(mentionsUntrackedPlace("ayúdame con mi viaje a Oaxaca", trips)).toBe(true);
    expect(mentionsUntrackedPlace("mi hotel en Tulum", trips)).toBe(true);
  });
  it("con un viaje a Tokio, 'Japón' sí es conocido", () => {
    const conTokio = [...trips, { id: "tokio", destino: "Tokio", pais_destino: "Japón", fecha_salida: "2027-04-15", fecha_regreso: "2027-04-29" }];
    expect(mentionsUntrackedPlace("mi viaje a Japón", conTokio)).toBe(false);
  });
  it("la instrucción de viaje ambiguo dice no listar otros viajes y responder Privé sin preguntar", () => {
    const line = tripResolutionLine("ambiguous", false);
    expect(line).toMatch(/no tiene un viaje guardado a ese destino/);
    expect(line).toMatch(/Privé/);
  });
});

describe("R10 · /dashboard/pro con prueba y cancelación programada", () => {
  const sub = { status: "trialing", stripe_customer_id: "cus_x", trial_end: "2026-11-21T07:09:40Z", current_period_end: "2026-11-21T07:09:40Z" };
  it("antes decía solo 'En periodo de prueba · 30 días restantes'; ahora avisa que no se cobrará", () => {
    const label = proStatusLabel({ isComped: false, isTrialing: true, trialDaysLeft: 30, cancelAtPeriodEnd: true, subscription: sub });
    expect(label).toMatch(/cancelación programada/);
    expect(label).toMatch(/no se te cobrará/);
    expect(label).toMatch(/21 de noviembre de 2026/);
  });
  it("los demás estados no cambian", () => {
    expect(proStatusLabel({ isComped: false, isTrialing: true, trialDaysLeft: 30, cancelAtPeriodEnd: false, subscription: sub })).toBe("En periodo de prueba · 30 días restantes");
    expect(proStatusLabel({ isComped: true, isTrialing: false, trialDaysLeft: null, cancelAtPeriodEnd: false, subscription: null })).toBe("PRO de cortesía · acceso permanente");
    expect(proStatusLabel({ isComped: false, isTrialing: false, trialDaysLeft: null, cancelAtPeriodEnd: true, subscription: { ...sub, status: "active" } })).toMatch(/^Activa hasta el .*\(cancelación programada\)$/);
    expect(proStatusLabel({ isComped: false, isTrialing: false, trialDaysLeft: null, cancelAtPeriodEnd: false, subscription: null })).toBe("Versión gratuita");
  });
});

describe("R10 · el contador del Concierge se actualiza tras cada mensaje", () => {
  beforeEach(() => rpcMock.mockReset());
  it("notifyAccessChanged vuelve a leer get_access_state sin pasar por 'cargando'", async () => {
    rpcMock.mockResolvedValueOnce({ data: { is_pro: false, concierge_used: 0, concierge_limit: 3, concierge_remaining: 3 }, error: null });
    const { result } = renderHook(() => useSubscription());
    await waitFor(() => expect(result.current.access?.concierge_remaining).toBe(3));
    rpcMock.mockResolvedValueOnce({ data: { is_pro: false, concierge_used: 1, concierge_limit: 3, concierge_remaining: 2 }, error: null });
    act(() => notifyAccessChanged());
    expect(result.current.loading).toBe(false);
    await waitFor(() => expect(result.current.access?.concierge_remaining).toBe(2));
    expect(rpcMock).toHaveBeenCalledTimes(2);
  });
});
