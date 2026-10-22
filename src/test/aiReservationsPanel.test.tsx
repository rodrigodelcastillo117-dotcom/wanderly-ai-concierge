// Panel de Reservas IA en "Mis reservas": confirmar el envío con la frase exacta, elegir alterno,
// y que nada se muestre cuando la función está apagada.
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: (...a: unknown[]) => invoke(...a) } } }));
vi.mock("@/components/FixerButton", () => ({ FixerButton: () => <button>Fixer</button> }));

import { AiReservationsPanel } from "@/components/reservas/AiReservationsPanel";
import { notificationTarget } from "@/lib/notificationTarget";

const base = {
  id: "00000000-0000-0000-0000-000000000001", ref_code: "R-ABC234", venue_name: "Casa Oaxaca", venue_email: "reservas@casaoaxaca.com.mx",
  venue_address: null, venue_city: "Oaxaca", venue_place_id: null, requested_local: "2026-11-03T20:30", requested_for: "2026-11-04T02:30:00Z",
  party_size: 4, customer_name: "Ana López", reason: null, user_options: null, alternatives: null, confirmation: null, confirmation_code: null,
  venue_reply_excerpt: null, created_at: "2026-11-01T00:00:00Z", confirm_prompt: "Confirmar: escribiremos a Casa Oaxaca en tu nombre",
};

beforeEach(() => invoke.mockReset());

it("apagado y sin reservas → no muestra nada", async () => {
  invoke.mockResolvedValue({ data: { ok: true, enabled: false, reservations: [] }, error: null });
  const { container } = render(<AiReservationsPanel />);
  await waitFor(() => expect(invoke).toHaveBeenCalled());
  expect(container.innerHTML).toBe("");
});

it("el usuario confirma con la frase exacta y elige qué compartir", async () => {
  invoke.mockResolvedValueOnce({ data: { ok: true, enabled: true, reservations: [{ ...base, status: "awaiting_user_ok", label: "Falta tu confirmación · aún no escribimos al restaurante", is_confirmed: false }] }, error: null });
  render(<AiReservationsPanel />);
  const btn = await screen.findByRole("button", { name: "Confirmar: escribiremos a Casa Oaxaca en tu nombre" });
  expect(screen.getByText(/Aún no le hemos escrito/)).toBeInTheDocument();
  invoke.mockResolvedValue({ data: { ok: true, reservations: [] }, error: null });
  fireEvent.click(screen.getByRole("checkbox", { name: /Mandarme una copia/ }));
  fireEvent.click(btn);
  await waitFor(() => expect(invoke).toHaveBeenCalledWith("ai-reservations", {
    body: { action: "confirm_send", id: base.id, confirm: true, confirm_text: base.confirm_prompt, consent: { share_contact: false, cc_me: true } },
  }));
});

it("alterno propuesto → botón para aceptarlo; nada dice 'confirmada' antes de tiempo", async () => {
  invoke.mockResolvedValueOnce({ data: { ok: true, enabled: true, reservations: [{ ...base, status: "needs_user", reason: "alternative_offered",
    alternatives: [{ local: "2026-11-03T21:15" }], venue_reply_excerpt: "Tenemos lugar a las 21:15", label: "El restaurante propone otro horario · elige si te sirve", is_confirmed: false }] }, error: null });
  render(<AiReservationsPanel />);
  const accept = await screen.findByRole("button", { name: /Aceptar .*21:15/ });
  expect(screen.queryByText(/^Confirmada/)).toBeNull();
  invoke.mockResolvedValue({ data: { ok: true, reservations: [] }, error: null });
  fireEvent.click(accept);
  await waitFor(() => expect(invoke).toHaveBeenCalledWith("ai-reservations", { body: { action: "choose_alternative", id: base.id, index: 0 } }));
});

it("confirmada por escrito → cita del restaurante y calendario", async () => {
  invoke.mockResolvedValueOnce({ data: { ok: true, enabled: true, reservations: [{ ...base, status: "confirmed", label: "Confirmada por escrito por el restaurante", is_confirmed: true,
    confirmation: { quote: "Con gusto confirmamos su reserva" }, confirmation_code: "MX-4821" }] }, error: null });
  render(<AiReservationsPanel />);
  expect(await screen.findByText(/Con gusto confirmamos su reserva/)).toBeInTheDocument();
  expect(screen.getByText("MX-4821")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Agregar al calendario/ })).toBeInTheDocument();
});

it("los avisos de Reservas IA abren Mis reservas", () => {
  expect(notificationTarget({ type: "ai_reservation", related_id: "x" })).toBe("/dashboard/reservas#reservas-ia");
});
