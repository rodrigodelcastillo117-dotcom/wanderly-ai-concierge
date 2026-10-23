// "Cada vez que fuerzo el cierre de la app me saca": la app del celular abre en "/" (la bienvenida
// con "Iniciar sesión") aunque la sesión siga abierta, y un tropiezo de red al abrir cerraba sesión.
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

const authState = vi.hoisted(() => ({ user: { id: "u1" } as { id: string } | null }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: authState.user }) }));
const qb: any = { select: () => qb, eq: () => qb, maybeSingle: async () => ({ data: null, error: null }) };
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: () => qb, rpc: async () => ({ data: null, error: null }) } }));

import Landing from "@/pages/Landing";
import { sessionTrulyExpired } from "@/lib/authRestore";

function renderAt(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/dashboard" element={<p>Tu Inicio</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("la sesión no se pierde al reabrir la app", () => {
  it("con la sesión abierta, abrir la app en / lleva directo a tu Inicio", () => {
    authState.user = { id: "u1" };
    renderAt("/");
    expect(screen.getByText("Tu Inicio")).toBeInTheDocument();
  });

  it("sin sesión se ve la bienvenida", () => {
    authState.user = null;
    renderAt("/");
    expect(screen.queryByText("Tu Inicio")).toBeNull();
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
  });

  it("la app instalada abre en /dashboard", () => {
    const m = JSON.parse(readFileSync("public/manifest.webmanifest", "utf8"));
    expect(m.start_url).toBe("/dashboard");
  });

  it("sessionTrulyExpired: red caída o renovación exitosa → NO está vencida; refresh token inválido → sí", async () => {
    const net = Object.assign(new Error("Load failed"), { name: "AuthRetryableFetchError", status: 0 });
    expect(await sessionTrulyExpired({ refreshSession: async () => ({ data: { session: null }, error: net }) })).toBe(false);
    expect(await sessionTrulyExpired({ refreshSession: async () => { throw new Error("offline"); } })).toBe(false);
    expect(await sessionTrulyExpired({ refreshSession: async () => ({ data: { session: { access_token: "t" } }, error: null }) })).toBe(false);
    const bad = Object.assign(new Error("Invalid Refresh Token: Refresh Token Not Found"), { name: "AuthApiError", status: 400 });
    expect(await sessionTrulyExpired({ refreshSession: async () => ({ data: { session: null }, error: bad }) })).toBe(true);
  });
});
