// Auditoría 10/10 (P1-6, 28-oct-2026) · Modo viaje en vivo: decía "Aún no empieza · Tu viaje comienza el
// 30 de octubre" y arriba "Día 1 de 3" con una sección "HOY · Tu día está libre", aunque el día 1 tenía plan
// de mañana, tarde y noche en itinerario_json.
import React from "react";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { daySlots, liveDay } from "@/lib/liveDay";
import { localISODatePlus } from "@/lib/localDate";

const TRIP = "77777777-7777-4777-8777-777777777777";
const db = vi.hoisted(() => ({ trip: null as any }));
vi.mock("@/integrations/supabase/client", () => {
  const api: any = {
    select: () => api, order: () => api, limit: () => api, eq: () => api, in: () => api, update: () => api,
    maybeSingle: async () => ({ data: db.trip, error: null }),
    single: async () => ({ data: db.trip, error: null }),
    then: (res: any, rej: any) => Promise.resolve({ data: db.trip ? [db.trip] : [], error: null }).then(res, rej),
  };
  return { supabase: { from: () => api, rpc: async () => ({ data: null, error: null }), functions: { invoke: vi.fn(async () => ({ data: null })) } } };
});
const authUser = vi.hoisted(() => ({ id: "u1", email: "u1@example.test", user_metadata: {} }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: authUser, loading: false }) }));
vi.mock("@/components/DestinationVideo", () => ({ DestinationVideo: () => null }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

import LiveTrip from "@/pages/LiveTrip";

const ITIN = [
  { dia: 1, titulo: "Llegada y lago", "mañana": "Llegada a Valle de Bravo", tarde: "Paseo en lancha por la presa", noche: "Cena en el malecón" },
  { dia: 2, titulo: "Bosque", "mañana": "Caminata al Velo de Novia", tarde: "Mercado", noche: "Fogata" },
  { dia: 3, titulo: "Regreso", "mañana": "Desayuno", tarde: "Regreso a CDMX", noche: "" },
];

describe("liveDay (lógica)", () => {
  it("antes de empezar: sin 'Día N', con cuenta regresiva y el primer día como adelanto", () => {
    const d = liveDay({ fecha_salida: "2026-10-30", fecha_regreso: "2026-11-01", itinerario_json: ITIN }, "2026-10-28");
    expect(d).toMatchObject({ phase: "antes", dayNumber: null, daysUntil: 2, totalDays: 3, shownIndex: 0, hasPlan: true });
    expect(d.slots.map((s) => s.label)).toEqual(["Mañana", "Tarde", "Noche"]);
  });
  it("en curso: el día que toca; terminado: sin plan de 'hoy'", () => {
    expect(liveDay({ fecha_salida: "2026-10-30", fecha_regreso: "2026-11-01", itinerario_json: { days: ITIN } }, "2026-10-31")).toMatchObject({ phase: "en_curso", dayNumber: 2, title: "Bosque" });
    expect(liveDay({ fecha_salida: "2026-10-30", fecha_regreso: "2026-11-01", itinerario_json: ITIN }, "2026-11-05")).toMatchObject({ phase: "terminado", dayNumber: null, shownIndex: null });
  });
  it("lee mañana/tarde/noche, actividades y lo agregado con Iato", () => {
    expect(daySlots({ actividades: [{ hora: "10:00", actividad: "Museo" }, "Comida"] })).toEqual([
      { label: "", text: "Museo", hora: "10:00" }, { label: "", text: "Comida" },
    ]);
    expect(daySlots({ manana: "Templo", agregados: [{ titulo: "Cena", lugar: "Contramar", hora: "20:00" }] }).map((s) => s.text)).toEqual(["Templo", "Cena — Contramar"]);
  });
});

describe("LiveTrip (pantalla) antes de empezar", () => {
  beforeEach(() => {
    db.trip = { id: TRIP, user_id: "u1", destino: "Valle de Bravo", pais_destino: "México", fecha_salida: localISODatePlus(2), fecha_regreso: localISODatePlus(4), itinerario_json: ITIN };
  });

  it("no dice 'Día 1 de 3' ni 'Hoy' y muestra el plan real del primer día", async () => {
    render(<MemoryRouter initialEntries={[`/dashboard/viajes/${TRIP}/live`]}><Routes><Route path="/dashboard/viajes/:id/live" element={<LiveTrip />} /></Routes></MemoryRouter>);
    expect((await screen.findByTestId("live-day")).textContent).toMatch(/Empieza en 2 días · 3 días/);
    expect(document.body.textContent).not.toMatch(/Día 1 de 3/);
    const today = screen.getByTestId("live-today");
    expect(today.textContent).toMatch(/Tu primer día/);
    expect(today.textContent).not.toMatch(/^Hoy/);
    expect(today.textContent).toMatch(/Paseo en lancha por la presa/);
    expect(document.body.textContent).not.toMatch(/Tu día está libre/);
  });
});
