import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

let lastRun: Record<string, unknown> | null = null;
vi.mock("@/integrations/supabase/client", () => {
  const q: Record<string, unknown> = {};
  q.select = () => q; q.order = () => q; q.limit = () => q;
  q.maybeSingle = () => Promise.resolve({ data: lastRun, error: null });
  return { supabase: { from: () => q } };
});

import { ServiceHealthCard } from "@/components/ServiceHealthCard";

const results = [{ name: "Pagos (Stripe)", ok: true, warn: "Stripe está en modo de prueba" }];

describe("ServiceHealthCard (C-12)", () => {
  beforeEach(() => { lastRun = null; });

  it("warns when the latest check is older than 26 h", async () => {
    lastRun = { ran_at: new Date(Date.now() - 30 * 3_600_000).toISOString(), ok: true, results, email_status: "skipped_unchanged" };
    render(<ServiceHealthCard />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/más de 26 horas/);
    expect(screen.getByText(/lo pendiente es lo mismo que ya se avisó/)).toBeInTheDocument();
  });

  it("does not warn for a fresh check and shows a failed alert email", async () => {
    lastRun = { ran_at: new Date(Date.now() - 2 * 3_600_000).toISOString(), ok: true, results, email_status: "failed", email_error: "resend_403" };
    render(<ServiceHealthCard />);
    expect(await screen.findByText("Pagos (Stripe)")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText(/No se pudo mandar el correo de alerta/)).toHaveTextContent("resend_403");
  });
});
