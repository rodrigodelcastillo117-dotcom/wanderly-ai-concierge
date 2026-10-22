// IATOS-083: después de iniciar sesión se perdía la ruta pedida (/auth ignoraba state.from).
import React from "react";
import { render, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import { describe, it, expect, vi } from "vitest";
import { safeRedirectPath } from "@/lib/safeRedirect";

const qb: any = { select: () => qb, eq: () => qb, maybeSingle: async () => ({ data: { completado: true }, error: null }) };
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: () => qb, auth: {} } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" }, signIn: vi.fn(), signUp: vi.fn() }) }));
vi.mock("@/lib/referral", () => ({ claimPendingReferral: async () => {} }));
vi.mock("framer-motion", () => {
  const strip = (p: any) => { const { initial, animate, exit, transition, ...r } = p; return r; };
  const motion = new Proxy({}, { get: (_t, tag: string) => (p: any) => React.createElement(tag, strip(p)) });
  return { motion, AnimatePresence: ({ children }: any) => <>{children}</> };
});

import Auth from "@/pages/Auth";

let loc = "";
const Spy = () => { const l = useLocation(); loc = l.pathname + l.search + l.hash; return null; };

function renderAuthWithFrom(from: unknown) {
  render(
    <MemoryRouter initialEntries={[{ pathname: "/auth", state: { from } }]}>
      <Spy />
      <Routes>
        <Route path="/auth" element={<Auth />} />
        <Route path="*" element={<p>DESTINO</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("Auth regresa a la ruta pedida", () => {
  it("con state.from interno, vuelve ahí (con query)", async () => {
    renderAuthWithFrom({ pathname: "/dashboard/viajes", search: "?tab=proximos", hash: "" });
    await waitFor(() => expect(loc).toBe("/dashboard/viajes?tab=proximos"));
  });

  it("sin state.from, va al dashboard como antes", async () => {
    renderAuthWithFrom(undefined);
    await waitFor(() => expect(loc).toBe("/dashboard"));
  });

  it("una URL externa en state.from se ignora", async () => {
    renderAuthWithFrom("//evil.example/phish");
    await waitFor(() => expect(loc).toBe("/dashboard"));
  });
});

describe("safeRedirectPath", () => {
  it("solo acepta rutas internas", () => {
    expect(safeRedirectPath({ pathname: "/dashboard/viajes/abc", search: "?a=1", hash: "#x" })).toBe("/dashboard/viajes/abc?a=1#x");
    expect(safeRedirectPath("/dashboard/planear?q=Puebla")).toBe("/dashboard/planear?q=Puebla");
    for (const bad of ["//evil.com", "https://evil.com", "/\\evil.com", "javascript:alert(1)", "evil.com", " //evil.com", "/\tevil", "", null, 42, { pathname: "https://evil.com" }]) {
      expect(safeRedirectPath(bad)).toBeNull();
    }
  });

  it("no regresa a /auth ni a /reset-password (evita bucles)", () => {
    expect(safeRedirectPath("/auth")).toBeNull();
    expect(safeRedirectPath("/auth?mode=signup")).toBeNull();
    expect(safeRedirectPath("/reset-password")).toBeNull();
    expect(safeRedirectPath("/authors")).toBe("/authors");
  });
});
