// En la entrada de Privé se ve la tarjeta de TU rango (la misma del menú), no una negra para todos.
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const state = vi.hoisted(() => ({ card: null as any }));
vi.mock("@/lib/memberCard", async (orig) => ({ ...(await orig<any>()), useMemberCard: () => ({ card: state.card, loading: false }) }));

import { MemberCard } from "@/components/prive/MemberCard";

const props = { firstName: "Santiago", activatedAt: "2026-10-22T10:00:00Z", memberCode: "IP-DNMT-GP48" } as const;

describe("tarjeta en la entrada de Privé", () => {
  it("miembro activo con Special Edition → se ve su Special Edition", () => {
    state.card = { tier: "platinum_2", edition: "special", name: "Santiago", number: "IP-DNMT-GP48", since: props.activatedAt, tenure_days: 1, prive_days: 1, granted: true };
    render(<MemberCard {...props} status="active" />);
    const box = screen.getByTestId("prive-member-card");
    expect(box).toHaveAttribute("data-tier", "platinum_2");
    expect(screen.getByTestId("prive-tier-card")).toHaveAttribute("data-edition", "special");
  });

  it("sin respuesta del servidor → la tarjeta Privé de siempre (no se inventa un rango)", () => {
    state.card = null;
    render(<MemberCard {...props} status="active" />);
    expect(screen.queryByTestId("prive-tier-card")).toBeNull();
    expect(screen.getByText("Santiago")).toBeInTheDocument();
  });

  it("membresía en pausa → la tarjeta Privé con su estado", () => {
    state.card = { tier: "gold", edition: null, name: "Santiago", number: null, since: null, tenure_days: null, prive_days: null, granted: false };
    render(<MemberCard {...props} status="paused_pro" />);
    expect(screen.queryByTestId("prive-tier-card")).toBeNull();
  });
});
