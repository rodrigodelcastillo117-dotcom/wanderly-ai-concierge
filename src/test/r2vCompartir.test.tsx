// R2 viajes P2-2: «Tus amigos invitados podrán ver y editar todo el viaje contigo.» salía dos veces en
// Compartir viaje (regresión del merge: la descripción accesible y un párrafo con el mismo texto).
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { vi, it, expect } from "vitest";

vi.mock("@/integrations/supabase/client", () => {
  const q: any = { select: () => q, eq: () => q, in: () => q, or: () => q, order: () => q, then: (r: any) => Promise.resolve({ data: [], error: null }).then(r) };
  return { supabase: { from: () => q, rpc: async () => ({ data: [], error: null }) } };
});
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" } }) }));
vi.mock("@/lib/friendProfiles", () => ({ fetchFriendProfiles: async () => [] }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { InviteFriendDialog } from "@/components/InviteFriendDialog";

it("la frase de invitados sale una sola vez", async () => {
  render(<MemoryRouter><InviteFriendDialog tripId="t1" isOwner /></MemoryRouter>);
  fireEvent.click(screen.getByRole("button", { name: "Compartir viaje" }));
  await screen.findByTestId("compartir-sin-enlace");
  expect(screen.getAllByText("Tus amigos invitados podrán ver y editar todo el viaje contigo.")).toHaveLength(1);
  expect(screen.getByRole("dialog")).toHaveAccessibleDescription(/podrán ver y editar todo el viaje contigo/);
});
