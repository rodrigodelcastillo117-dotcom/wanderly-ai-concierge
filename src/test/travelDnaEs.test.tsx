// Travel DNA en español y con datos reales (antes: inglés y 0 % en casi todas las barras).
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: vi.fn(), functions: { invoke: vi.fn() }, rpc: vi.fn() } }));

import { computeTravelDna, DNA_ARCHETYPES, DNA_LABELS, dnaBasisText } from "@/lib/travelDna";
import { TravelDNAStats } from "@/components/lux/TravelDNAStats";
import { CULTURE_PROFILES, PERSONALITY_LABELS } from "@/lib/cultureProfiles";

const today = "2026-10-22";

describe("Travel DNA", () => {
  it("todas las etiquetas en español (ninguna de las de la captura en inglés)", () => {
    const all = [...Object.values(DNA_LABELS).map((l) => l.label), ...Object.values(DNA_ARCHETYPES).flatMap((a) => [a.label, a.tag]), ...CULTURE_PROFILES.map((c) => c.label)];
    for (const english of ["Adventure Energy", "Cultural Seeker", "Luxury Balance", "Comfort Traveler", "Nightlife Lover", "Hidden Gem Hunter", "Food Explorer", "Global Traveler", "Gastronomic Soul"]) {
      expect(all).not.toContain(english);
    }
    expect(DNA_LABELS.adventure.label).toBe("Energía aventurera");
    expect(DNA_LABELS.hidden.label).toBe("Cazador de joyas ocultas");
    expect(PERSONALITY_LABELS.food).toEqual({ label: "Explorador gastronómico", tag: "Alma gastronómica" });
    expect(CULTURE_PROFILES.find((c) => c.key === "default")?.label).toBe("Viajero global");
  });

  it("sin viajes ni lugares ni preferencias: 'ninguna' (no 0 % por todos lados)", () => {
    const r = computeTravelDna({ today, trips: [], visits: [] });
    expect(r.fuente).toBe("ninguna");
    expect(r.stats.every((s) => s.value === null)).toBe(true);
    expect(dnaBasisText(r)).toBe("Aún no hay datos.");
  });

  it("viajes hechos (incluidos los importados) mueven las barras; lo planeado pesa menos", () => {
    const r = computeTravelDna({
      today,
      trips: [
        { destino: "Cancún", fecha_salida: "2026-03-01", fecha_regreso: "2026-03-06" },
        { destino: "Tulum", fecha_salida: "2026-06-01", fecha_regreso: "2026-06-04" },
        { destino: "París", fecha_salida: "2026-12-01", fecha_regreso: "2026-12-09" },
      ],
      visits: [],
    });
    expect(r.dominant).toBe("relax");
    expect(r.viajesHechos).toBe(2);
    expect(r.stats.find((s) => s.key === "adventure")?.value).toBeNull(); // sin datos, no 0 %
    expect(dnaBasisText(r)).toBe("Basado en 2 viajes hechos, 1 planeado.");
  });

  it("lujo por gasto real por persona por noche y destino fuera del catálogo = joya oculta", () => {
    const r = computeTravelDna({
      today,
      trips: [
        { destino: "Bacalar", fecha_salida: "2026-01-01", fecha_regreso: "2026-01-03", num_viajeros: 2, total_estimado: 60000 },
        { destino: "Real de Catorce", fecha_salida: "2026-02-01", fecha_regreso: "2026-02-03" },
      ],
      visits: [],
    });
    expect(r.stats.find((s) => s.key === "luxury")?.value).toBeGreaterThan(0);
    expect(r.stats.find((s) => s.key === "hidden")?.value).toBe(50);
  });

  it("la tarjeta dice 'Aún no hay datos' con un camino para llenarlo", () => {
    render(<MemoryRouter><TravelDNAStats dna={computeTravelDna({ today, trips: [], visits: [] })} /></MemoryRouter>);
    expect(screen.getByText("Aún no hay datos")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Sube un viaje que ya hiciste/ })).toHaveAttribute("href", "/dashboard/viajes/importar");
  });

  it("barras sin datos dicen 'Sin datos aún' en vez de 0 %", () => {
    const dna = computeTravelDna({ today, trips: [{ destino: "Oaxaca", fecha_salida: "2026-01-01", fecha_regreso: "2026-01-04" }], visits: [] });
    render(<MemoryRouter><TravelDNAStats dna={dna} /></MemoryRouter>);
    expect(screen.getByText("Buscador cultural")).toBeInTheDocument();
    expect(screen.getAllByText("Sin datos aún").length).toBeGreaterThan(0);
    expect(screen.queryByText("0%")).toBeNull();
  });
});
