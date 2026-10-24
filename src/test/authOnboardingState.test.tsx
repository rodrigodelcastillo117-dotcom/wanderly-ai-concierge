// Pulido UX: quien terminó el onboarding (user_onboarding_state) pero no el perfil profundo
// (ai_user_preferences / travel_profiles) iba de /auth a /onboarding, rebotaba a /dashboard y
// perdía la ruta que había pedido. Ahora /auth usa la misma señal que ProtectedRoute.
import React from "react";
import { render, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import { describe, it, expect, vi, beforeEach } from "vitest";

const rows = vi.hoisted(() => ({ current: {} as Record<string, Record<string, unknown> | null> }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      const qb: any = { select: () => qb, eq: () => qb, maybeSingle: async () => ({ data: rows.current[table] ?? null, error: null }) };
      return qb;
    },
    auth: {},
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" }, signIn: vi.fn(), signUp: vi.fn() }) }));
vi.mock("@/lib/referral", () => ({ claimPendingReferral: async () => {} }));
vi.mock("framer-motion", () => {
  const strip = (p: any) => { const { initial, animate, exit, transition, ...r } = p; return r; };
  const motion = new Proxy({}, { get: (_t, tag: string) => (p: any) => React.createElement(tag, strip(p)) });
  return { motion, AnimatePresence: ({ children }: any) => <>{children}</> };
});

import Auth from "@/pages/Auth";

let loc = "";
const Spy = () => { const l = useLocation(); loc = l.pathname + l.search; return null; };
const renderAuth = (from?: string) => render(
  <MemoryRouter initialEntries={[{ pathname: "/auth", state: from ? { from } : undefined }]}>
    <Spy />
    <Routes>
      <Route path="/auth" element={<Auth />} />
      <Route path="*" element={<p>DESTINO</p>} />
    </Routes>
  </MemoryRouter>,
);

describe("Auth decide el onboarding con la misma señal que ProtectedRoute", () => {
  beforeEach(() => { loc = ""; });

  it("onboarding terminado sin perfil profundo: va directo a la ruta pedida (sin pasar por /onboarding)", async () => {
    rows.current = { ai_user_preferences: { completado: false }, travel_profiles: null, user_onboarding_state: { completed_onboarding: true } };
    renderAuth("/prive/invitacion");
    await waitFor(() => expect(loc).toBe("/prive/invitacion"));
  });

  it("onboarding terminado y sin ruta pedida: va al inicio", async () => {
    rows.current = { ai_user_preferences: null, travel_profiles: null, user_onboarding_state: { completed_onboarding: true } };
    renderAuth();
    await waitFor(() => expect(loc).toBe("/dashboard"));
  });

  it("sin onboarding ni perfil: sigue yendo a /onboarding", async () => {
    rows.current = { ai_user_preferences: null, travel_profiles: null, user_onboarding_state: { completed_onboarding: false } };
    renderAuth("/dashboard/viajes");
    await waitFor(() => expect(loc).toBe("/onboarding"));
  });
});
