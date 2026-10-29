// Ola "9.5 en TODO" (29-oct-2026) — chat de Iato, lado de la app. Las cards son REALES de producción
// (fixtures/ola95Chat.json: "¿Dónde ceno rico hoy cerca de aquí?" y "Me robaron la cartera…").
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";

vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: () => ({ insert: async () => ({ data: null, error: null }) }), functions: { invoke: vi.fn() } } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" } }) }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

import { RichCard } from "@/components/concierge/ConciergeCards";
import { buildChips, welcomeText } from "@/lib/conciergeChips";
import { TripContextSelector } from "@/components/concierge/TripContextSelector";
import { emergencyCallButtons } from "@/lib/emergencyCalls";

const FX = JSON.parse(readFileSync(join(__dirname, "fixtures", "ola95Chat.json"), "utf8"));
const ROOT = join(__dirname, "..", "..");
const visibleControls = (el: HTMLElement) => within(el).queryAllByRole("link").length + within(el).queryAllByRole("button").length;

describe("Cards con menos botones: los principales a la vista, el resto en 'Más opciones' (antes 8–9 por restaurante)", () => {
  it("restaurante real (Terraza Umbral): Reservar en su sitio y Llévame; lo demás detrás de 'Más opciones', sin perder ninguno", () => {
    const card = FX.b_cena_1.cards[0];
    expect(card.links).toHaveLength(5);
    render(<RichCard card={card} />);
    const primary = screen.getByTestId("card-primary");
    expect(within(primary).getByRole("link", { name: "Reservar en su sitio" })).toHaveAttribute("href", "https://www.hotelumbral.com/");
    expect(within(primary).getByTestId("take-me-there")).toBeInTheDocument();
    expect(within(primary).queryByRole("link", { name: "Llamar" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Pídeselo al equipo" })).toBeNull();
    // Principales + el botón "Más opciones": 3 controles.
    expect(visibleControls(primary)).toBe(3);
    const more = screen.getByRole("button", { name: "Más opciones" });
    expect(more).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(more);
    const extra = screen.getByTestId("card-more");
    for (const name of ["Buscar en OpenTable", "Llamar", "Ver en Google Maps", "Cómo llegar"]) expect(within(extra).getByRole("link", { name })).toBeInTheDocument();
    expect(within(extra).getByRole("button", { name: "Pídeselo al equipo" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Menos opciones" })).toHaveAttribute("aria-expanded", "true");
  });
  it("restaurante sin reserva en línea (Café La Pagoda): Llévame y Llamar al frente", () => {
    const card = { ...FX.b_cena_1.cards[1], links: [{ kind: "call", label: "Llamar", url: "tel:+525555108331" }, { kind: "maps", label: "Ver en Google Maps", url: "https://maps.google.com/?cid=1" }] };
    render(<RichCard card={card} />);
    const primary = screen.getByTestId("card-primary");
    expect(within(primary).getByRole("link", { name: "Llamar" })).toHaveAttribute("href", "tel:+525555108331");
    expect(within(primary).queryByRole("link", { name: "Ver en Google Maps" })).toBeNull();
  });
  it("'No toma reservaciones (llega directo)' una sola vez (card real de Café La Pagoda)", () => {
    const card = FX.b_cena_1.cards[1];
    expect(card.meta).toMatch(/No toma reservaciones \(llega directo\)/);
    expect(card.booking_note).toBe("No toma reservaciones (llega directo)");
    const { container } = render(<RichCard card={card} />);
    expect(container.textContent!.match(/No toma reservaciones/g)).toHaveLength(1);
  });
  it("lugar de emergencia real (Hospital de Jesús): Llévame y Llamar a la vista; Uber, sitio, Maps y cómo llegar en 'Más opciones'", () => {
    const card = FX.f_robo_1.cards.find((c: any) => c.type === "place");
    render(<RichCard card={card} />);
    const primary = screen.getByTestId("card-primary");
    expect(within(primary).getByRole("link", { name: "Llamar" })).toHaveAttribute("href", "tel:+525555426501");
    expect(within(primary).getByTestId("take-me-there")).toBeInTheDocument();
    expect(within(primary).queryByRole("link", { name: "Pedir Uber" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Más opciones" }));
    const extra = screen.getByTestId("card-more");
    for (const name of ["Cómo llegar", "Pedir Uber", "Sitio oficial", "Ver en Google Maps"]) expect(within(extra).getByRole("link", { name })).toBeInTheDocument();
  });
});

describe("Atajos y saludo", () => {
  const VB = { id: "vb", destino: "Valle de Bravo", fecha_salida: "2026-10-30", fecha_regreso: "2026-11-01", vuelos_json: [{ modo: "autobus" }], hospedaje_json: [] };
  it("con el viaje a días de salir: plan del día, clima y gastos, cada uno con su pregunta", () => {
    const chips = buildChips(VB, "2026-10-29");
    const by = Object.fromEntries(chips.map((c) => [c.id, c]));
    expect(by.day_plan).toMatchObject({ label: "Plan del viernes", intent: "day_plan", text: "Ármame el plan del viernes 30 en Valle de Bravo." });
    expect(by.weather).toMatchObject({ label: "¿Qué clima hará?", text: "¿Qué clima hará en mi viaje a Valle de Bravo?" });
    expect(by.expenses).toMatchObject({ label: "¿Cuánto llevo gastado?", intent: "expense_query" });
    // En curso: "Mi plan de hoy".
    expect(buildChips(VB, "2026-10-31").find((c) => c.id === "day_plan")?.label).toBe("Mi plan de hoy");
    // Lejano (más de 9 días): sin plan ni clima.
    const far = buildChips({ ...VB, fecha_salida: "2027-01-15", fecha_regreso: "2027-01-18" }, "2026-10-29").map((c) => c.id);
    expect(far).not.toContain("day_plan");
    expect(far).not.toContain("weather");
    // Sin viaje, como antes.
    expect(buildChips(null, "2026-10-29").map((c) => c.id)).toEqual(["dining", "transport", "emergency", "luggage"]);
  });
  it("el saludo es corto y no ofrece 'revisar tu vuelo' (el viaje es por autobús)", () => {
    const t = welcomeText(VB as any);
    expect(t).not.toMatch(/vuelo/);
    expect(t.length).toBeLessThan(160);
    expect(t).toMatch(/Nada se reserva ni se guarda sin que lo confirmes\./);
  });
  it("los atajos van en dos columnas", () => {
    expect(readFileSync(join(ROOT, "src/pages/Concierge.tsx"), "utf8")).toMatch(/<ul className="grid grid-cols-2 gap-1" aria-label=\{title\}>/);
  });
});

describe("Encabezado más bajo en el celular (antes 4 renglones, ~190 px de 844)", () => {
  const TRIPS = [{ id: "vb", destino: "Valle de Bravo", fecha_salida: "2026-10-30", fecha_regreso: "2026-11-01" }];
  it("viaje y quién lo eligió en el mismo renglón, sin salto (se recorta con el texto completo en title)", () => {
    render(<TripContextSelector trips={TRIPS} todayLocal="2026-10-29" pinnedId="vb" resolved={{ trip: TRIPS[0], reason: "pinned", candidates: [TRIPS[0]] } as any} onChange={() => {}} />);
    expect(screen.getByTestId("trip-context").className).toMatch(/flex-nowrap/);
    expect(screen.getByTestId("trip-context").className).not.toMatch(/flex-wrap/);
    const hint = screen.getByTestId("trip-phase");
    expect(hint).toHaveTextContent("lo fijaste tú");
    expect(hint).toHaveAttribute("title", "lo fijaste tú");
    expect(hint.className).toMatch(/truncate/);
    expect(hint.className).not.toMatch(/basis-full/);
  });
  it("la ubicación va en letra chica al final en el celular y el paso 'think' se quita del globo con el texto", () => {
    const src = readFileSync(join(ROOT, "src/pages/Concierge.tsx"), "utf8");
    expect(src).toMatch(/<LocationLine geoState=\{geoState\} weather=\{weather\} className="mt-0\.5 sm:mt-0 text-\[10px\] sm:text-\[11px\] sm:order-first/);
    expect(src).toMatch(/const steps = hasText \? allSteps\.filter\(\(st\) => st\.id !== THINK_STEP_ID\) : allSteps;/);
  });
});

describe("Emergencia local: un botón por número, con su nombre (antes 🚑 911 · 🚓 911 · 🚒 911)", () => {
  it("México: un solo 'Llamar al 911' para ambulancia, policía y bomberos", () => {
    expect(emergencyCallButtons({ police: "911", medical: "911", fire: "911" })).toEqual([{ number: "911", label: "Ambulancia, policía y bomberos" }]);
  });
  it("España y Japón: cada número con su nombre; el general al final", () => {
    expect(emergencyCallButtons({ police: "091", medical: "061", fire: "080", general: "112" })).toEqual([
      { number: "061", label: "Ambulancia" }, { number: "091", label: "Policía" }, { number: "080", label: "Bomberos" }, { number: "112", label: "Emergencias (general)" },
    ]);
    expect(emergencyCallButtons({ police: "110", medical: "119", fire: "119" })).toEqual([{ number: "119", label: "Ambulancia y bomberos" }, { number: "110", label: "Policía" }]);
    expect(emergencyCallButtons({ police: "112", medical: "112", fire: "112", general: "112" })).toHaveLength(1);
  });
  it("la hoja usa esos botones", () => {
    const src = readFileSync(join(ROOT, "src/components/ConciergeActions.tsx"), "utf8");
    expect(src).toMatch(/emergencyCallButtons\(emergency\)\.map/);
    expect(src).not.toMatch(/🚑/);
  });
});
