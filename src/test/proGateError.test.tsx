import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { vi } from "vitest";

const state: any = { loading: false, isPro: false, access: null, error: "timeout", refresh: vi.fn() };
vi.mock("@/hooks/useSubscription", () => ({ useSubscription: () => state }));
import { ProGate } from "@/components/ProGate";

describe("ProGate", () => {
  it("does not show the paywall when the plan could not be read", () => {
    render(<MemoryRouter><ProGate><p>CONTENIDO</p></ProGate></MemoryRouter>);
    expect(screen.getByRole("alert")).toHaveTextContent("No pudimos verificar tu plan");
    expect(screen.queryByText(/IATOS PRO/)).toBeNull();
  });

  it("shows the content to PRO users", () => {
    state.error = null; state.isPro = true;
    render(<MemoryRouter><ProGate><p>CONTENIDO</p></ProGate></MemoryRouter>);
    expect(screen.getByText("CONTENIDO")).toBeInTheDocument();
  });
});
