import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { vi, it, expect } from "vitest";

// E-24: "¿Olvidaste tu contraseña?" mandaba un correo por cada toque.
const reset = vi.hoisted(() => ({ calls: 0, release: (() => {}) as () => void }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      resetPasswordForEmail: () => { reset.calls++; return new Promise((res) => { reset.release = () => res({ error: null }); }); },
    },
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: null, signIn: vi.fn(), signUp: vi.fn() }) }));
vi.mock("@/lib/referral", () => ({ claimPendingReferral: async () => {} }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("framer-motion", () => {
  const cache: Record<string, any> = {};
  const strip = (p: any) => { const { initial, animate, exit, transition, whileHover, whileTap, layout, ...r } = p; return r; };
  const motion = new Proxy({}, { get: (_t, tag: string) => (cache[tag] ??= (p: any) => React.createElement(tag, strip(p))) });
  return { motion, AnimatePresence: ({ children }: any) => <>{children}</> };
});

import Auth from "@/pages/Auth";

it("tocar 3 veces '¿Olvidaste tu contraseña?' envía UN correo y el botón queda desactivado", async () => {
  render(<MemoryRouter initialEntries={["/auth"]}><Auth /></MemoryRouter>);
  fireEvent.change(screen.getByLabelText(/correo/i), { target: { value: "ana@example.test" } });
  const btn = screen.getByRole("button", { name: "¿Olvidaste tu contraseña?" });
  fireEvent.click(btn);
  fireEvent.click(btn);
  fireEvent.click(btn);
  expect(reset.calls).toBe(1);
  expect(screen.getByRole("button", { name: "Enviando correo…" })).toBeDisabled();
  await act(async () => { reset.release(); });
  const sent = screen.getByRole("button", { name: /Correo enviado/ });
  expect(sent).toBeDisabled();
  fireEvent.click(sent);
  expect(reset.calls).toBe(1);
});
