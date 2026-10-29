// R2 viajes P2-8: «Ver todos» (Descubre) mostraba otra lista que Inicio (Edimburgo, Palermo… contra
// Liubliana, Cracovia…) y afirmaba «Porque te encantó Budapest», un viaje creado por accidente y nunca hecho.
import React from "react";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect, vi } from "vitest";
import { buildTasteProfile, lovedLabels, stripUnfoundedLove, type TasteInputs } from "../../supabase/functions/_shared/tasteProfile.ts";

const RECOS = [
  { name: "Edimburgo", country: "Reino Unido", score: 80, reason: "", image_query: "x" },
  { name: "Liubliana", country: "Eslovenia", score: 96, reason: "", image_query: "x" },
  { name: "Palermo", country: "Italia", score: 85, reason: "", image_query: "x" },
  { name: "Cracovia", country: "Polonia", score: 94, reason: "", image_query: "x" },
  { name: "Oporto", country: "Portugal", score: 92, reason: "", image_query: "x" },
];
vi.mock("@/hooks/useAIRecommendations", () => ({ useAIRecommendations: () => ({ recos: RECOS, loading: false, error: null, refresh: () => {} }) }));
vi.mock("@/hooks/useSavedDestinations", () => ({ useSavedDestinations: () => ({ saved: new Set(), pending: new Set(), toggle: () => {} }) }));
vi.mock("@/components/DashboardLayout", () => ({ DashboardLayout: ({ children }: any) => <>{children}</> }));
vi.mock("@/components/DestinationVideo", () => ({ DestinationVideo: () => null }));
vi.mock("@/components/roadtrip/RoadTripIdeas", () => ({ RoadTripIdeas: () => null }));
vi.mock("framer-motion", () => {
  const strip = (p: any) => { const { initial, animate, exit, transition, whileHover, whileTap, layout, ...r } = p; return r; };
  const cache: Record<string, any> = {};
  return { motion: new Proxy({}, { get: (_t, tag: string) => (cache[tag] ??= (p: any) => React.createElement(tag, strip(p))) }) };
});

import Discover from "@/pages/Discover";
import { sortRecosByMatch } from "@/lib/homeRecos";

const ME = "11111111-1111-1111-1111-111111111111";
const base = (extra: Partial<TasteInputs>): TasteInputs => ({ userId: ME, todayISO: "2026-10-29", ...extra });
const trip = (id: string, destino: string, salida: string, regreso: string) => ({ id, user_id: ME, destino, fecha_salida: salida, fecha_regreso: regreso, num_viajeros: 2, status: "listo" });

describe("Descubre = Inicio", () => {
  it("mismo orden: las 4 de Inicio son las primeras de Descubre", () => {
    render(<MemoryRouter><Discover /></MemoryRouter>);
    const shown = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(shown.slice(0, 4)).toEqual(sortRecosByMatch(RECOS).slice(0, 4).map((r) => r.name));
    expect(shown.slice(0, 4)).toEqual(["Liubliana", "Cracovia", "Oporto", "Palermo"]);
  });
});

describe("«Porque te encantó» solo con evidencia", () => {
  it("un viaje solo cotizado (Budapest, ya pasó, sin fotos ni gastos) no se cita como gusto", () => {
    const p = buildTasteProfile(base({ trips: [trip("b", "Budapest", "2026-09-01", "2026-09-05")], moments: [{ user_id: ME, destino: "Mykonos", created_at: "2026-07-10T10:00:00Z" }] as any }));
    expect(p.encanta.map((x) => x.label)).toContain("Budapest"); // sigue pesando poco
    expect(lovedLabels(p)).toEqual(["Mykonos"]);
  });

  it("la razón de la IA pierde el «Porque te encantó Budapest» y conserva lo demás", () => {
    expect(stripUnfoundedLove("Porque te encantó Budapest: termas y arquitectura parecidas.", ["Mykonos"])).toBe("Termas y arquitectura parecidas.");
    expect(stripUnfoundedLove("Porque te encantó Mykonos: más islas.", ["Mykonos"])).toBe("Porque te encantó Mykonos: más islas.");
    expect(stripUnfoundedLove("Ideal por tu ritmo relajado.", [])).toBe("Ideal por tu ritmo relajado.");
  });
});
