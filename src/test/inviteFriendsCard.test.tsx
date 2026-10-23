// Promoción "Invita 5 amigos y gana 1 mes de PRO": la tarjeta de invitar muestra lo que decide el
// servidor (referral_progress): progreso, quién cuenta y qué pasó con el premio.
import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  rpc: vi.fn(),
  count: vi.fn(async () => ({ count: 2, error: null })),
  user: { id: "aaaaaaaa-0000-4000-8000-00000000000a" },
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/integrations/supabase/client", () => {
  const from = (table: string) => {
    if (table === "profiles") {
      const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: { invite_code: "B6E3201E" }, error: null }) };
      return q;
    }
    const q = { select: () => q, eq: () => h.count() };
    return q;
  };
  return { supabase: { rpc: (...a: unknown[]) => h.rpc(...a), from } };
});
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: h.user, loading: false }) }));
vi.mock("sonner", () => ({ toast: h.toast }));

import { InviteFriendsCard } from "@/components/InviteFriendsCard";
import { referralView, type ReferralProgress } from "@/lib/referralPromo";

type Join = ReferralProgress["joined"][number];
const person = (name: string | null, status: Join["status"], day = 1): Join => ({ name, status, joined_at: `2026-10-${String(day).padStart(2, "0")}` });
const progress = (o: Partial<ReferralProgress> = {}): ReferralProgress => ({
  goal: 5, days_per_reward: 30, counting: 0, rewards: 0, pending_rewards: 0, last_reward: null,
  comped_until: null, stripe_apply_enabled: false, joined: [], ...o,
});
const counting = (n: number) => Array.from({ length: n }, (_, i) => person(`Amigo${i + 1} P.`, "cuenta", i + 1));
const compReward = { status: "applied" as const, route: "comp" as const, days: 30, created_at: "2026-10-20T12:00:00Z", applied_at: "2026-10-20T12:00:00Z", comped_until: "2026-11-19T12:00:00Z" };

const renderCard = () => render(<MemoryRouter><InviteFriendsCard /></MemoryRouter>);

describe("tarjeta de invitar: Invita 5 amigos y gana 1 mes de PRO", () => {
  beforeEach(() => { h.rpc.mockReset(); h.count.mockClear(); });

  it("0 referidos: título, 0 de 5, enlace, términos y el texto de siempre", async () => {
    h.rpc.mockResolvedValue({ data: progress(), error: null });
    renderCard();
    expect(await screen.findByText("Invita 5 amigos y gana 1 mes de PRO")).toBeInTheDocument();
    expect(h.rpc).toHaveBeenCalledWith("referral_progress");
    expect(screen.getByTestId("invite-progress-label")).toHaveTextContent("0 de 5");
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");
    expect(screen.getByText("Nadie se ha unido todavía con tu enlace.")).toBeInTheDocument();
    expect(screen.getByText(/\/\?ref=B6E3201E$/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Términos de la promoción" })).toHaveAttribute("href", "/terminos#promo-referidos");
    expect(screen.queryByText("¡Ganaste 1 mes de PRO!")).toBeNull();
  });

  it("3 referidos válidos y los demás estados: 3 de 5 y cada quien con su estado, solo nombre e inicial", async () => {
    h.rpc.mockResolvedValue({
      data: progress({
        counting: 3,
        joined: [...counting(3), person("Bea R.", "falta_correo", 4), person("Carla N.", "falta_viaje", 5), person(null, "no_cuenta", 6)],
      }),
      error: null,
    });
    renderCard();
    expect(await screen.findByTestId("invite-progress-label")).toHaveTextContent("3 de 5");
    const list = screen.getByRole("list", { name: "Quienes se unieron con tu enlace" });
    const rows = within(list).getAllByRole("listitem");
    expect(rows).toHaveLength(6);
    expect(within(list).getAllByText("Ya cuenta")).toHaveLength(3);
    expect(within(rows[3]).getByText("Bea R.")).toBeInTheDocument();
    expect(within(rows[3]).getByText("Falta que confirme su correo")).toBeInTheDocument();
    expect(within(rows[4]).getByText("Falta que cree su primer viaje")).toBeInTheDocument();
    expect(within(rows[5]).getByText("Sin nombre")).toBeInTheDocument();
    expect(within(rows[5]).getByText("No cuenta para la promoción")).toBeInTheDocument();
    expect(screen.queryByText("Nadie se ha unido todavía con tu enlace.")).toBeNull();
    expect(screen.queryByText("¡Ganaste 1 mes de PRO!")).toBeNull();
  });

  it("5 referidos: barra llena, celebración y hasta cuándo dura el PRO", async () => {
    h.rpc.mockResolvedValue({ data: progress({ counting: 0, rewards: 1, last_reward: compReward, comped_until: compReward.comped_until, joined: counting(5) }), error: null });
    renderCard();
    expect(await screen.findByText("¡Ganaste 1 mes de PRO!")).toBeInTheDocument();
    expect(screen.getByTestId("invite-progress-label")).toHaveTextContent("5 de 5");
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "5");
    expect(screen.getByRole("status")).toHaveTextContent("Tienes IATOS PRO de cortesía hasta el 19 de noviembre de 2026.");
  });

  it("7 referidos: 2 de 5 hacia el siguiente mes, sin celebración, con lo ya ganado", async () => {
    h.rpc.mockResolvedValue({ data: progress({ counting: 2, rewards: 1, last_reward: compReward, comped_until: compReward.comped_until, joined: counting(7) }), error: null });
    renderCard();
    expect(await screen.findByTestId("invite-progress-label")).toHaveTextContent("2 de 5");
    expect(screen.queryByText("¡Ganaste 1 mes de PRO!")).toBeNull();
    expect(screen.getByText(/Ya ganaste 1 mes de PRO\. Tienes IATOS PRO de cortesía hasta el 19 de noviembre de 2026\./)).toBeInTheDocument();
    expect(screen.getAllByText("Ya cuenta")).toHaveLength(7);
  });

  it("quien paga en Stripe con el flag APAGADO: el mes queda guardado", async () => {
    h.rpc.mockResolvedValue({
      data: progress({ rewards: 1, last_reward: { ...compReward, status: "pending", route: "stripe", applied_at: null, comped_until: null }, joined: counting(5) }),
      error: null,
    });
    renderCard();
    expect(await screen.findByText("Tu mes gratis está guardado; te avisaremos cuando se aplique.")).toBeInTheDocument();
    expect(screen.queryByText(/próximo cobro/)).toBeNull();
  });

  it("quien paga en Stripe con el flag PRENDIDO: se aplicará en su próximo cobro", async () => {
    h.rpc.mockResolvedValue({
      data: progress({ rewards: 1, stripe_apply_enabled: true, last_reward: { ...compReward, status: "pending", route: "stripe", applied_at: null, comped_until: null }, joined: counting(5) }),
      error: null,
    });
    renderCard();
    expect(await screen.findByText("Tu mes gratis se aplicará en tu próximo cobro.")).toBeInTheDocument();
  });

  it("Privé o cortesía sin vencimiento: guardado (no se pierde)", () => {
    for (const route of ["prive", "cortesia_indefinida"] as const) {
      const v = referralView(progress({ rewards: 1, last_reward: { ...compReward, status: "pending", route, applied_at: null, comped_until: null } }));
      expect(v.celebrate).toBe(true);
      expect(v.statusLine).toBe("Tu mes gratis está guardado; te avisaremos cuando se aplique.");
    }
    expect(referralView(progress({ counting: 2, rewards: 2, last_reward: compReward })).earnedLine).toBe("Ya ganaste 2 meses de PRO.");
  });

  it("Compartir usa Web Share con el mensaje prellenado", async () => {
    h.rpc.mockResolvedValue({ data: progress(), error: null });
    const share = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "share", { value: share, configurable: true });
    renderCard();
    fireEvent.click(await screen.findByRole("button", { name: /Compartir/ }));
    await waitFor(() => expect(share).toHaveBeenCalledOnce());
    const arg = (share.mock.calls[0] as unknown as [ShareData])[0];
    expect(arg.text).toBe("Te invito a IATOS, tu concierge de viajes con IA:");
    expect(arg.url).toMatch(/\/\?ref=B6E3201E$/);
    Reflect.deleteProperty(navigator, "share");
  });

  it("sin respuesta del servidor: la tarjeta sigue con el conteo de siempre y sin progreso inventado", async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: "Could not find the function public.referral_progress" } });
    renderCard();
    expect(await screen.findByText("2 personas se unieron con tu enlace.")).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).toBeNull();
  });
});

describe("panel de admin: premios de referidos", () => {
  it("muestra cuántos premios se han dado y si Stripe está apagado; nada si la respuesta no es válida", async () => {
    const { AdminReferralRewardsCard } = await import("@/components/AdminReferralRewardsCard");
    h.rpc.mockReset();
    h.rpc.mockResolvedValue({ data: { total: 3, applied: 2, pending: 1, last_30d: 3, people: 2, days_given: 60, stripe_apply_enabled: false }, error: null });
    const { unmount } = render(<AdminReferralRewardsCard />);
    expect(await screen.findByText("Promoción de referidos: 3 premios de 1 mes de PRO")).toBeInTheDocument();
    expect(h.rpc).toHaveBeenCalledWith("admin_referral_rewards");
    expect(screen.getByText(/2 aplicados \(60 días de cortesía\) · 1 guardados/)).toBeInTheDocument();
    expect(screen.getByText(/apagado \(pendiente de autorización\)/)).toBeInTheDocument();
    unmount();
    h.rpc.mockResolvedValue({ data: null, error: { message: "not_authorized" } });
    render(<AdminReferralRewardsCard />);
    await waitFor(() => expect(h.rpc).toHaveBeenCalledTimes(2));
    expect(screen.queryByTestId("admin-referral-rewards")).toBeNull();
  });
});
