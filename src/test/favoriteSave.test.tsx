import React from "react";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { vi, it, expect } from "vitest";

// E-24: doble toque en el corazón de Descubre creaba dos filas en recomendaciones.
const db = vi.hoisted(() => ({ inserts: 0, release: (() => {}) as () => void }));
vi.mock("@/integrations/supabase/client", () => {
  const from = () => {
    let inserting = false;
    const api: any = {
      select: () => api, eq: () => api, update: () => api,
      maybeSingle: async () => ({ data: null, error: null }),
      insert: () => { inserting = true; db.inserts++; return api; },
      then: (ok: any, ko: any) => inserting
        ? new Promise((res) => { db.release = () => res({ error: null }); }).then(ok, ko)
        : Promise.resolve({ data: [], error: null }).then(ok, ko),
    };
    return api;
  };
  return { supabase: { from } };
});
const user = vi.hoisted(() => ({ id: "u1" }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user }) }));
vi.mock("@/components/DashboardLayout", () => ({ DashboardLayout: ({ children }: any) => <div>{children}</div> }));
vi.mock("@/components/DestinationVideo", () => ({ DestinationVideo: () => null }));
vi.mock("@/lib/insights", () => ({ logInsight: async () => {} }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/hooks/useAIRecommendations", () => ({
  useAIRecommendations: () => ({
    recos: [{ name: "Lisboa", country: "Portugal", score: 91, reason: "", image_query: "lisboa", trip_type: "city", best_months: "mayo" }],
    loading: false, error: null, refresh: () => {},
  }),
}));
vi.mock("framer-motion", () => {
  const strip = (p: any) => { const { initial, animate, exit, transition, whileHover, whileTap, layout, ...r } = p; return r; };
  // Un componente estable por etiqueta (si no, cada render remonta el árbol).
  const cache: Record<string, any> = {};
  const motion = new Proxy({}, { get: (_t, tag: string) => (cache[tag] ??= (p: any) => React.createElement(tag, strip(p))) });
  return { motion, AnimatePresence: ({ children }: any) => <>{children}</> };
});

import Discover from "@/pages/Discover";

it("dos toques seguidos en 'Guardar' crean UNA fila (el corazón se desactiva mientras guarda)", async () => {
  render(<MemoryRouter><Discover /></MemoryRouter>);
  const heart = await screen.findByRole("button", { name: "Guardar Lisboa en favoritos" });
  fireEvent.click(heart);
  await waitFor(() => expect(db.inserts).toBe(1));
  fireEvent.click(heart);
  expect(heart).toBeDisabled();
  await act(async () => { db.release(); });
  expect(db.inserts).toBe(1);
  expect(await screen.findByRole("button", { name: "Quitar Lisboa de favoritos" })).toBeEnabled();
});
