// Claridad de la página del viaje (feedback de Álvaro, usuario real, 28-oct-2026):
//  1-2. "Está un poco confusa, no tan intuitiva" · "me tomó entender qué estaba pasando en cada sección"
//       → cada pestaña dice en una línea para qué sirve y qué hacer; "Destinos" se llama "Itinerario";
//         recorrido de primer uso (3 pasos, descartable, no vuelve a salir); "88% match" → "88% afín a ti";
//         una sola acción dorada en Resumen (la alerta de precio pasa a secundaria).
//  3.   "Demasiado texto en los itinerarios: arriba 2-3 bullet points con un summary rápido"
//       → "Tu viaje en 30 segundos" (destino y fechas, lo destacado, total con su etiqueta) y una línea de
//         resumen por día arriba del detalle, que queda plegado con "Ver detalle".
//  5.   "Los itinerarios se me hicieron buenos" → el texto de mañana, tarde y noche no cambia.
import React from "react";
import { readFileSync } from "node:fs";
import { render, screen, within, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { vi, it, expect, beforeEach, describe } from "vitest";
import { OAXACA_TRIP } from "./fixtures/alvaroOaxaca";
import { daySummaryLine, firstClause, tripGlance, tripHighlights, tripPlaceNames } from "@/lib/tripGlance";
import { markTripTourSeen, purchaseStepHint, TRIP_SECTION_LABEL, TRIP_TOUR_KEY, tripSectionHelp, tripTourSeen, tripTourSteps } from "@/lib/tripSectionHelp";
import type { TripSection } from "@/components/TripSectionNav";

const db = { trip: null as any, bookings: [] as any[] };
vi.mock("@/integrations/supabase/client", () => {
  const from = (table: string) => {
    let kind = "select";
    const api: any = {
      select: () => api, eq: () => api, not: () => api, order: () => api, limit: () => api, in: () => api,
      update: () => { kind = "update"; return api; }, insert: () => api,
      maybeSingle: async () => ({ data: table === "trips" ? db.trip : null, error: null }),
      single: async () => ({ data: null, error: null }),
      then: (res: any, rej: any) => {
        if (kind === "update") return Promise.resolve({ data: [db.trip], error: null }).then(res, rej);
        return Promise.resolve({ data: table === "bookings" ? db.bookings : [], error: null }).then(res, rej);
      },
    };
    return api;
  };
  return { supabase: { from, functions: { invoke: vi.fn(async () => ({ data: null, error: null })) }, auth: { getSession: async () => ({ data: { session: null } }) } } };
});
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" }, loading: false }) }));
vi.mock("@/components/DashboardLayout", () => ({ DashboardLayout: ({ children }: any) => <>{children}</> }));
vi.mock("@/components/DestinationVideo", () => ({ DestinationVideo: () => null }));
vi.mock("@/components/CityCollapsible", () => ({ CityCollapsible: ({ children }: any) => <div>{children}</div>, useCityImage: () => null }));
vi.mock("@/components/EditWithAIDialog", () => ({ EditWithAIDialog: () => null }));
vi.mock("@/components/LiveTripQuote", () => ({ LiveTripQuote: () => null }));
vi.mock("@/components/InviteFriendDialog", () => ({ InviteFriendDialog: () => null }));
vi.mock("@/components/TripDocuments", () => ({ TripDocuments: () => null }));
vi.mock("@/lib/tripPdf", () => ({ generateTripPDF: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

import TripDetail from "@/pages/TripDetail";
import { PriceWatchCard } from "@/components/PriceWatchCard";

const trip = () => JSON.parse(JSON.stringify(OAXACA_TRIP));
const cotizado = (over: Partial<any> = {}) => ({
  kind: "cotizado" as const,
  total: { amount: 24180, title: "Total estimado", estimated: true, travelers: 2, missing: ["vuelo", "hotel"], porCotizar: [], state: "estimado" as const, ...over },
});
const JERGA = /\b(match\w*|tier|snapshot|score|matchean)\b/i;

describe("Tu viaje en 30 segundos (tripGlance)", () => {
  it("3 puntos: a dónde y cuándo, lo destacado del plan y el total con su misma etiqueta y lo que falta", () => {
    const b = tripGlance(trip(), cotizado());
    expect(b.map((x) => x.key)).toEqual(["viaje", "destacado", "costo"]);
    expect(b[0].text).toBe("Oaxaca de Juárez, México · 30 oct – 1 nov 2026 · 2 noches · 2 viajeros");
    // Experiencias del plan que el itinerario menciona, en su orden (las comparsas no se nombran igual en el día).
    expect(b[1].text).toBe("Lo más destacado: Zona Arqueológica de Monte Albán, Templo de Santo Domingo de Guzmán y Mercado 20 de Noviembre.");
    expect(b[2].text).toBe("Total estimado: $24,180 MXN para 2 personas (aproximado). Falta elegir vuelo y hotel en Comprar.");
  });

  it("nunca inventa precio: sin cifra en la página no hay cifra en el resumen", () => {
    expect(tripGlance(trip(), cotizado({ amount: 0 }))[2].text).toBe("Costo: este viaje aún no tiene una cotización guardada.");
    expect(tripGlance(trip(), { kind: "sin_cotizacion" })[2].text).not.toMatch(/\$/);
    expect(tripGlance(trip(), { kind: "recotizar" })[2].text).toMatch(/vuelve a cotizar/);
    expect(tripGlance(trip(), { kind: "recotizar" })[2].text).not.toMatch(/\$/);
    expect(tripGlance(trip(), { kind: "traido" })[2].text).toBe("Vuelos y hotel ya los tienes: aquí solo suma lo que agregues.");
    expect(tripGlance(trip(), { kind: "documento" })[2].text).not.toMatch(/\$/);
  });

  it("selección completa, ya comprado y por cotizar dicen exactamente lo que dice la tarjeta del total", () => {
    expect(tripGlance(trip(), cotizado({ title: "Total de tu selección", estimated: false, missing: [], state: "seleccion" }))[2].text)
      .toBe("Total de tu selección: $24,180 MXN para 2 personas. Ya elegiste lo principal: revisa y compra en Comprar.");
    expect(tripGlance(trip(), cotizado({ state: "comprado", paid: 7600, pending: 16580, missing: [] }))[2].text)
      .toBe("Total estimado: $24,180 MXN para 2 personas (aproximado). Ya compraste $7,600 MXN; falta $16,580 MXN.");
    expect(tripGlance(trip(), cotizado({ missing: [], porCotizar: ["el vuelo"] }))[2].text).toMatch(/Falta cotizar el vuelo\.$/);
    expect(tripGlance(trip(), cotizado({ travelers: 1 }))[2].text).toMatch(/para 1 persona \(aproximado\)/);
  });

  it("varias ciudades: la ruta en el primer punto; sin experiencias, lo destacado son los títulos de los días", () => {
    const t = { ...trip(), tours_json: [], itinerario_json: { multi: true, destinations: ["Roma", "Florencia", "Venecia"], days: [
      { dia: 1, titulo: "Llegada", "mañana": "Vuelo.", tarde: "", noche: "" },
      { dia: 2, titulo: "Coliseo y Foro Romano", "mañana": "Coliseo.", tarde: "Foro.", noche: "Trastévere." },
      { dia: 3, titulo: "Galería Uffizi", "mañana": "Uffizi.", tarde: "", noche: "" },
      { dia: 4, titulo: "Día libre", pendiente: true },
    ] } };
    const b = tripGlance(t, cotizado());
    expect(b[0].text.startsWith("Roma → Florencia → Venecia · ")).toBe(true);
    expect(b[1].text).toBe("Lo más destacado: Coliseo y Foro Romano y Galería Uffizi.");
    expect(tripHighlights({ ...t, itinerario_json: [] })).toEqual([]);
    // Sin nada destacado: solo 2 puntos (nunca uno inventado).
    expect(tripGlance({ ...t, itinerario_json: [] }, cotizado()).map((x) => x.key)).toEqual(["viaje", "costo"]);
  });
});

describe("Una línea por día (daySummaryLine)", () => {
  const names = tripPlaceNames(OAXACA_TRIP);
  it("por cada parte del día, el lugar del plan que menciona; si no menciona ninguno, su primera frase corta", () => {
    const [d1, d2, d3] = OAXACA_TRIP.itinerario_json;
    expect(daySummaryLine(d1, names)).toBe("Mercado 20 de Noviembre · Templo de Santo Domingo de Guzmán · Casa Oaxaca");
    expect(daySummaryLine(d2, names)).toBe("Zona Arqueológica de Monte Albán · Regreso al centro · Comparsas y velación en el panteón de Santa Cruz…");
    expect(daySummaryLine(d3, names)).toBe("Desayuno tranquilo en el centro y compras de… · Traslado al aeropuerto y vuelo de regreso a la…");
  });
  it("las horas y decimales no cortan la frase; un día pendiente o vacío no tiene resumen", () => {
    expect(firstClause("Sal a las 7:30 rumbo al mercado, con calma.")).toBe("Sal a las 7:30 rumbo al mercado");
    expect(firstClause("Caminata de 1.5 h por el bosque. Luego comida.")).toBe("Caminata de 1.5 h por el bosque");
    expect(daySummaryLine({ dia: 4, pendiente: true, titulo: "Día libre" }, names)).toBe("");
    expect(daySummaryLine({ dia: 5, titulo: "x", "mañana": "", tarde: " ", noche: null }, names)).toBe("");
  });
});

describe("Orientación por pestaña y recorrido", () => {
  const ALL: TripSection[] = ["resumen", "comprar", "ruta", "destinos", "experiencias", "documentos"];
  it("cada pestaña tiene una línea corta, en español y sin jerga; 'destinos' se llama 'Itinerario'", () => {
    expect(TRIP_SECTION_LABEL.destinos).toBe("Itinerario");
    for (const ctx of [{}, { brought: true }, { documento: true }, { byLand: true, multi: true }]) {
      for (const id of ALL) {
        const t = tripSectionHelp(id, ctx);
        expect(t.length).toBeGreaterThan(20);
        expect(t.length).toBeLessThanOrEqual(110);
        expect(t).not.toMatch(JERGA);
      }
    }
    expect(tripSectionHelp("comprar", { byLand: true })).toMatch(/cómo llegar/);
    expect(tripSectionHelp("comprar", { documento: true })).toMatch(/ya está pagado/);
    expect(purchaseStepHint("vuelo")).toBe("Opciones para tus fechas: toca una para elegirla.");
  });

  it("recorrido: 3 pasos como máximo; se recuerda y no falla sin almacenamiento", () => {
    expect(tripTourSteps({ sections: ALL }).length).toBe(3);
    expect(tripTourSteps({ sections: ["resumen", "documentos"] }).map((s) => s.section)).toEqual(["resumen"]);
    expect(tripTourSteps({ sections: ALL, documento: true }).map((s) => s.section)).toEqual(["resumen", "destinos"]);
    const mem = new Map<string, string>();
    const st = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v); } };
    expect(tripTourSeen(st)).toBe(false);
    markTripTourSeen(st);
    expect(tripTourSeen(st)).toBe(true);
    const broken = { getItem: () => { throw new Error("bloqueado"); }, setItem: () => { throw new Error("bloqueado"); } };
    expect(tripTourSeen(broken)).toBe(true); // sin almacenamiento no se insiste
    expect(() => markTripTourSeen(broken)).not.toThrow();
  });
});

const renderTrip = () => render(
  <MemoryRouter initialEntries={[`/dashboard/viajes/${OAXACA_TRIP.id}`]}>
    <Routes><Route path="/dashboard/viajes/:id" element={<TripDetail />} /></Routes>
  </MemoryRouter>,
);

beforeEach(() => {
  db.trip = { ...trip(), quote_basis: null, quote_needs_update: false };
  db.bookings = [];
  try { localStorage.clear(); } catch { /* noop */ }
  // La pestaña se recuerda en el #hash; cada prueba empieza en Resumen.
  window.history.replaceState(null, "", "/");
});

describe("TripDetail con el viaje a Oaxaca (simulado)", () => {
  it("arriba de Resumen: la línea de ayuda y 'Tu viaje en 30 segundos' con el MISMO total de la tarjeta", async () => {
    renderTrip();
    const panel = (await screen.findByTestId("trip-glance")).closest("[data-trip-panel]") as HTMLElement;
    expect(panel.getAttribute("data-trip-panel")).toBe("resumen");
    // Orden: ayuda → 30 segundos → total.
    const order = Array.from(panel.querySelectorAll("[data-testid='trip-seccion-ayuda'],[data-testid='trip-glance'],[data-testid='trip-total-card']")).map((e) => e.getAttribute("data-testid"));
    expect(order).toEqual(["trip-seccion-ayuda", "trip-glance", "trip-total-card"]);
    const amount = within(panel).getByTestId("trip-total-amount").textContent!;
    expect(amount).toBe("$24,180 MXN");
    expect(screen.getByTestId("trip-glance-costo")).toHaveTextContent(`Total estimado: ${amount} para 2 personas (aproximado). Falta elegir vuelo y hotel en Comprar.`);
    expect(screen.getByTestId("trip-glance-viaje")).toHaveTextContent("Oaxaca de Juárez, México · 30 oct – 1 nov 2026 · 2 noches");
    // Las herramientas tienen título y para qué sirven.
    expect(screen.getByTestId("trip-herramientas-titulo")).toHaveTextContent("Herramientas del viaje");
  });

  it("sin jerga: '88% afín a ti' (no 'match'); la pestaña dice 'Itinerario'", async () => {
    renderTrip();
    await screen.findByTestId("trip-glance");
    expect(screen.getByText(/88% afín a ti/)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/match con tu perfil/);
    expect(screen.getByTestId("tab-destinos")).toHaveTextContent("Itinerario");
  });

  it("cada pestaña empieza con su línea de ayuda", async () => {
    renderTrip();
    await screen.findByTestId("trip-glance");
    for (const id of ["resumen", "comprar", "destinos", "experiencias", "documentos"] as TripSection[]) {
      const panel = document.querySelector(`[data-trip-panel="${id}"]`) as HTMLElement;
      const first = panel.querySelector("[data-testid='trip-seccion-ayuda']");
      expect(first, id).not.toBeNull();
      expect(first!.textContent).toBe(tripSectionHelp(id, { brought: false, documento: false, byLand: false, multi: false }));
    }
  });

  it("Itinerario: cada día con su línea de resumen y 'Ver detalle'; el texto completo no cambia", async () => {
    renderTrip();
    await screen.findByTestId("trip-glance");
    fireEvent.click(screen.getByTestId("tab-destinos"));
    const days = screen.getAllByTestId("itinerario-dia");
    expect(days).toHaveLength(3);
    expect(within(days[0]).getByTestId("itinerario-dia-resumen")).toHaveTextContent("Mercado 20 de Noviembre · Templo de Santo Domingo de Guzmán · Casa Oaxaca");
    expect(within(days[0]).getByText("Ver detalle")).toBeInTheDocument();
    // Plegado por defecto, con el texto original íntegro dentro.
    expect(days[0]).not.toHaveAttribute("open");
    expect(days[0].textContent).toContain(OAXACA_TRIP.itinerario_json[0]["mañana"]);
    expect(days[0].textContent).toContain(OAXACA_TRIP.itinerario_json[0].tarde);
    expect(days[0].textContent).toContain(OAXACA_TRIP.itinerario_json[0].noche);
  });

  it("Comprar: el paso del vuelo dice qué hacer con sus opciones", async () => {
    renderTrip();
    await screen.findByTestId("trip-glance");
    fireEvent.click(screen.getByTestId("tab-comprar"));
    const vuelo = await screen.findByTestId("comprar-vuelo");
    expect(within(vuelo).getByTestId("comprar-paso-ayuda")).toHaveTextContent("Opciones para tus fechas: toca una para elegirla.");
    const hotel = screen.getByTestId("comprar-hospedaje");
    expect(within(hotel).getByTestId("comprar-paso-ayuda")).toHaveTextContent("Hoteles para tus noches: toca uno para elegirlo.");
  });

  it("primer uso: recorrido de 3 pasos que ilumina la pestaña, se puede saltar y no vuelve a salir", async () => {
    renderTrip();
    const tour = await screen.findByTestId("trip-tour");
    expect(tour).toHaveTextContent("1 de 3");
    expect(screen.getByTestId("tab-resumen")).toHaveAttribute("data-highlight", "1");
    fireEvent.click(within(tour).getByTestId("trip-tour-siguiente"));
    expect(tour).toHaveTextContent("2 de 3");
    expect(screen.getByTestId("tab-comprar")).toHaveAttribute("data-highlight", "1");
    // Avanzar no cambia de sección.
    expect(screen.getByTestId("tab-resumen")).toHaveAttribute("aria-selected", "true");
    fireEvent.click(within(tour).getByTestId("trip-tour-siguiente"));
    expect(screen.getByTestId("tab-destinos")).toHaveAttribute("data-highlight", "1");
    fireEvent.click(within(tour).getByText("Entendido"));
    await waitFor(() => expect(screen.queryByTestId("trip-tour")).toBeNull());
    expect(localStorage.getItem(TRIP_TOUR_KEY)).toBe("done");
    expect(document.querySelector("[data-highlight='1']")).toBeNull();
    cleanup();
    renderTrip();
    await screen.findByTestId("trip-glance");
    expect(screen.queryByTestId("trip-tour")).toBeNull();
  });

  it("'Saltar' y la X cierran el recorrido para siempre", async () => {
    renderTrip();
    fireEvent.click(within(await screen.findByTestId("trip-tour")).getByTestId("trip-tour-saltar"));
    await waitFor(() => expect(screen.queryByTestId("trip-tour")).toBeNull());
    expect(localStorage.getItem(TRIP_TOUR_KEY)).toBe("done");
    localStorage.clear();
    cleanup();
    renderTrip();
    fireEvent.click(within(await screen.findByTestId("trip-tour")).getByLabelText("Cerrar recorrido"));
    await waitFor(() => expect(screen.queryByTestId("trip-tour")).toBeNull());
    expect(localStorage.getItem(TRIP_TOUR_KEY)).toBe("done");
  });
});

describe("Una acción principal por pantalla y sin jerga en Inicio y Descubrir", () => {
  it("la alerta de precio es secundaria (sin el dorado del botón principal)", async () => {
    const future = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
    render(<PriceWatchCard tripId="t1" departureDate={future} />);
    const btn = await screen.findByRole("button", { name: "Activar alerta" });
    expect(btn.className).not.toMatch(/bg-gradient-gold/);
  });

  it("Inicio y Descubrir no dicen 'match' ni 'matchean'", () => {
    for (const f of ["src/pages/DashboardHome.tsx", "src/pages/Discover.tsx", "src/pages/TripDetail.tsx"]) {
      const src = readFileSync(f, "utf8");
      expect(src, f).not.toMatch(/matchean|% MATCH|% match|match con tu perfil/);
    }
  });
});
