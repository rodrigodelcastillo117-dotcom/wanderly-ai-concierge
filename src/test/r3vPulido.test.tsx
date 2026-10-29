// R3 viajes, P2 y parciales: cada punto con su prueba.
import React from "react";
import { readFileSync } from "node:fs";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { vi, it, expect, describe, beforeEach, afterEach } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: null } }) },
    from: () => ({ select: () => ({ eq: () => ({ then: (r: any) => r({ data: [], error: null }) }) }) }),
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" } }) }));

import { tripTourSteps } from "@/lib/tripSectionHelp";
import { TripPageTour } from "@/components/trip/TripPageTour";
import { TripSectionNav } from "@/components/TripSectionNav";
import { nextTripAction } from "@/lib/tripCommand";
import { flightNoLiveInfo } from "@/lib/flightLiveQuote";
import { TripPurchasePlan } from "@/components/booking/TripPurchasePlan";
import { DriverService } from "@/components/booking/DriverService";
import { broughtTripInsert } from "@/lib/broughtTrip";
import { pointForMexican } from "@/lib/travelAdvisory";
import { tripSectionHelp } from "@/lib/tripSectionHelp";
import { draftNote, draftSpec, mergeDraftWithAi } from "@/lib/tripSpecDraft";
import { validateTripSpec } from "../../supabase/functions/_shared/tripSpec";
import { buildTasteProfile, lovedLabels, savedOnlyLabels, stripUnfoundedLove } from "../../supabase/functions/_shared/tasteProfile";
import { converterRateLabel, fxLabel, fxSourceName } from "@/lib/fx";
import { duplicateTripMarks, markedTripName } from "@/lib/tripList";

const src = (p: string) => readFileSync(p, "utf8");

describe("P2-1 · sin foto de Santorini como respaldo del viaje", () => {
  it("TripDetail y Mis viajes usan la foto del destino (Pexels) o el degradado, no hero-santorini", () => {
    for (const f of ["src/pages/TripDetail.tsx", "src/pages/Trips.tsx"]) {
      expect(src(f)).not.toMatch(/hero-santorini/);
      expect(src(f)).not.toMatch(/fallbackImage=\{santorini\}/);
      expect(src(f)).toMatch(/stockQuery=\{[^}]*destinationQuery\(/);
    }
  });
});

describe("P2-2 · guía de primer uso", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => { delete (Element.prototype as any).scrollIntoView; });
  it("el paso 1 dice «Abajo» (la tarjeta de 30 segundos va debajo de la guía)", () => {
    const [s1] = tripTourSteps({ sections: ["resumen", "comprar", "destinos"] } as any);
    expect(s1.text).toMatch(/^Abajo ves tu viaje en 30 segundos/);
    expect(s1.text).not.toMatch(/Arriba/);
  });
  it("cada paso trae la guía a la vista, con margen para la barra fija de abajo", () => {
    const spy = vi.fn();
    (Element.prototype as any).scrollIntoView = spy;
    render(<TripPageTour steps={tripTourSteps({ sections: ["resumen", "comprar", "destinos"] } as any)} />);
    const before = spy.mock.calls.length;
    fireEvent.click(screen.getByTestId("trip-tour-siguiente"));
    fireEvent.click(screen.getByTestId("trip-tour-siguiente"));
    expect(screen.getByTestId("trip-tour-siguiente")).toHaveTextContent("Entendido");
    expect(spy.mock.calls.length).toBeGreaterThanOrEqual(before + 2);
    expect(screen.getByTestId("trip-tour").className).toMatch(/scroll-mb-/);
  });
});

describe("P2-3 · pestañas: se ve que hay más (Documentos) a 390 px", () => {
  const SECTIONS = [["resumen", "Resumen"], ["comprar", "Comprar"], ["destinos", "Itinerario"], ["experiencias", "Experiencias"], ["documentos", "Documentos"]].map(([id, label]) => ({ id, label })) as any;
  afterEach(() => { delete (HTMLElement.prototype as any).scrollWidth; delete (HTMLElement.prototype as any).clientWidth; });
  it("con la fila más ancha que la pantalla aparece «Ver más secciones» y recorre la fila", () => {
    Object.defineProperty(HTMLElement.prototype, "scrollWidth", { configurable: true, get() { return this.getAttribute?.("role") === "tablist" ? 520 : 0; } });
    Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get() { return this.getAttribute?.("role") === "tablist" ? 390 : 0; } });
    render(<TripSectionNav sections={SECTIONS} active="resumen" onChange={() => {}} />);
    const more = screen.getByRole("button", { name: "Ver más secciones" });
    const row = screen.getAllByRole("tablist")[0] as HTMLElement;
    fireEvent.click(more);
    expect(row.scrollLeft).toBeGreaterThan(0);
  });
  it("si todo cabe, no hay flecha", () => {
    render(<TripSectionNav sections={SECTIONS} active="resumen" onChange={() => {}} />);
    expect(screen.queryByRole("button", { name: "Ver más secciones" })).toBeNull();
  });
});

describe("P2-4 · Budapest «Por recotizar»: lo que sigue es volver a cotizar", () => {
  const BUDAPEST = {
    id: "b", destino: "Budapest", fecha_salida: "2099-05-01", fecha_regreso: "2099-05-06", total_estimado: 7, created_at: new Date().toISOString(),
    vuelos_json: [{ aerolinea: "Lufthansa", precio_por_persona: 3 }], hospedaje_json: [{ nombre: "Hotel", precio_noche: 2 }],
    tours_json: [{ nombre: "Tour", precio_por_persona: 2 }], desglose_presupuesto: { vuelos: 3, hospedaje: 2, tours: 2 },
  };
  it("no «Elige y reserva · Elegir vuelo y hotel»", () => {
    const a = nextTripAction(BUDAPEST as any, { today: "2026-10-29" });
    expect(a).toMatchObject({ title: "Vuelve a cotizar", cta: "Volver a cotizar", to: "/dashboard/viajes/b/editar" });
  });
  it("y no se ofrece vigilar el precio de un total que no sirve", () => {
    expect(src("src/pages/TripDetail.tsx")).toMatch(/!arrivalByLand\(trip\) && !requote && \(\s*<PriceWatchCard/);
  });
});

describe("P2-5 · vuelo sin precio en viajes viejos: no habla de «los vuelos de arriba»", () => {
  it("el aviso genérico no apunta a vuelos que no se muestran", () => {
    const info = flightNoLiveInfo({ destino: "Budapest", ciudad_origen: "Ciudad de México", fecha_salida: "2027-05-01", fecha_regreso: "2027-05-06", vuelos_json: [] });
    expect(info.texto).not.toMatch(/arriba/);
    expect(info.texto).toMatch(/sin precio en vivo de vuelos/);
  });
});

describe("P2-6 · viaje traído (Oaxaca): sin «0 de 0 reservados» ni «Ya marcaste todo»", () => {
  it("dice que vuelo y hotel ya los tiene", () => {
    const trip = { ...broughtTripInsert({ userId: "u1", personas: 2, origin: "Ciudad de México", today: "2026-10-28", flights: [{ numero: "VB1234", fecha: "2026-10-30" }],
      cities: [{ ciudad: "Oaxaca de Juárez", llegada: "2026-10-30", salida: "2026-11-01" }] }, [null]), id: "oax" };
    render(<MemoryRouter><TripPurchasePlan trip={trip} selVuelo={-2} selHospedaje={-2} selTours={new Set()} bookings={[]} userId="u1" /></MemoryRouter>);
    expect(screen.queryByTestId("trip-comprar-progreso")).toBeNull();
    const falta = screen.getByTestId("trip-comprar-falta");
    expect(falta.textContent).not.toMatch(/Ya marcaste todo/);
    expect(falta).toHaveTextContent("Vuelo y hotel ya los tienes");
  });
});

describe("P2-7 · chofer: una línea por acción", () => {
  it("la solicitud al equipo y Welcome Pickups van separadas", () => {
    render(<MemoryRouter><DriverService driver={{ city: "Madrid", recommended: false, reason: null, request: {} } as any} tripId="t" /></MemoryRouter>);
    expect(screen.getByTestId("chofer-nota-equipo")).toHaveTextContent(/lo atiende una persona de IATOS; no es una reserva/);
    expect(screen.getByTestId("chofer-nota-welcome")).toHaveTextContent(/^Welcome Pickups:/);
    expect(screen.getByTestId("chofer-nota-equipo").textContent).not.toMatch(/Welcome/);
  });
});

describe("P2-9 · avisos: sin las reglas de pasaporte británico o estadounidense", () => {
  it("se quitan; seguridad y salud se quedan", () => {
    expect(pointForMexican("Para pasaporte británico, la fecha de expedición debe ser de menos de 10 años antes de tu llegada a España.")).toBe(false);
    expect(pointForMexican("Los ciudadanos estadounidenses necesitan registrarse en ETIAS.")).toBe(false);
    expect(pointForMexican("Las manifestaciones son comunes en España. Reconsidera viajar a Ceuta por disturbios.")).toBe(true);
    expect(src("src/components/trip/BeforeYouTravelCard.tsx")).toMatch(/filter\(\(p\) => pointForMexican\(p\.texto\)\)/);
  });
});

describe("P2-10 · Experiencias: una sola introducción", () => {
  it("la línea de ayuda lo dice y el componente no repite otra", () => {
    expect(tripSectionHelp("experiencias", {} as any)).toMatch(/Lo mejor de cada ciudad/);
    expect(src("src/components/trip/TripExperiencias.tsx")).not.toMatch(/Lo TOP de cada ciudad, con datos reales/);
  });
});

describe("P2-11 · revisión de Planear", () => {
  const TEXT = "beijin del 11 al 16 de noviembre 2 personas desde CDMX";
  const ctx = { origen: "Ciudad de México", today: new Date("2026-10-28T12:00:00Z") } as any;
  it("una errata corregida no es «agregó Beijing»", () => {
    const draft = draftSpec(TEXT, ctx);
    const v = validateTripSpec(JSON.stringify({
      intencion: "viaje_futuro", origen: "Ciudad de México",
      paradas: [{ id: "p1", ciudad: "Beijing", pais: "China", rol: "estancia", noches: 5, llegada_por: "vuelo", sugerida: false, texto: "beijin" }],
      regreso: { a: "Ciudad de México", via: null, modo: "vuelo" }, fecha_salida: "2026-11-11", fecha_regreso: "2026-11-16", fechas_expresas: true, viajeros: 2,
      preferencias: [], reservas: [], sugerencias: [], menciones: [{ texto: "beijin", tipo: "ciudad", estado: "parada", ref: "p1" }, { texto: "Ciudad de México", tipo: "origen", estado: "origen", ref: null }], preguntas: [],
    }), TEXT, { origen: "Ciudad de México" });
    expect(v.ok).toBe(true);
    const m = mergeDraftWithAi(draft, draft, (v as any).spec, ctx);
    expect(m.agrego).toEqual([]);
    expect(m.corrigio).toEqual([{ de: "beijin", a: "Beijing" }]);
    expect(m.nota).toBe("Iato completó tu viaje: corrigió «beijin» por Beijing.");
  });
  it("sin cambios ya no dice «coincide con tu resumen»", () => {
    expect(draftNote([], [])).toBe("Iato revisó tu viaje: no falta nada.");
  });
  it("«Iato» con la serifa y las fechas pedidas una sola vez", () => {
    const f = src("src/components/plan/TripSpecReview.tsx");
    expect(f).toMatch(/withIatoMark\(nota\)/);
    expect(f).toMatch(/\{!fechasPendientes && \(/);
  });
});

describe("P2-8 · Descubre: un favorito no es «te encantó»", () => {
  const ME = "11111111-1111-1111-1111-111111111111";
  it("«Porque guardaste Budapest»", () => {
    const p = buildTasteProfile({ userId: ME, todayISO: "2026-10-29", savedRecos: [{ user_id: ME, titulo: "Budapest", tipo: "destination_ai", guardado: true, created_at: "2026-10-28T22:18:00Z" }] } as any);
    expect(lovedLabels(p)).not.toContain("Budapest");
    expect(savedOnlyLabels(p)).toContain("Budapest");
    expect(stripUnfoundedLove("Porque te encantó Budapest: termas y arquitectura.", lovedLabels(p), savedOnlyLabels(p))).toBe("Porque guardaste Budapest: termas y arquitectura.");
  });
  it("con una foto en Mejores momentos sí es «te encantó»", () => {
    const p = buildTasteProfile({ userId: ME, todayISO: "2026-10-29", moments: [{ user_id: ME, destino: "Mykonos", created_at: "2026-07-10T10:00:00Z" }] } as any);
    expect(stripUnfoundedLove("Porque te encantó Mykonos: más islas.", lovedLabels(p), savedOnlyLabels(p))).toBe("Porque te encantó Mykonos: más islas.");
  });
});

describe("P2-14 / P2-15 · viajes iguales se distinguen", () => {
  it("Ahorro usa (2), (3) como Mis viajes", () => {
    const trips = ["2026-10-20T10:00:00Z", "2026-10-25T10:00:00Z"].map((c, i) => ({ id: `m${i}`, destino: "Madrid", fecha_salida: "2027-03-10", fecha_regreso: "2027-03-17", created_at: c }));
    const d = duplicateTripMarks(trips as any);
    expect(markedTripName("Madrid", d.n.get("m1"))).toBe("Madrid (2)");
    expect(src("src/components/TripSavingsCalculator.tsx")).toMatch(/markedTripName\(shortTripName\(t\), dups\.n\.get\(t\.id\)\)/);
  });
  it("«Creado el» con la hora", () => {
    expect(src("src/pages/Trips.tsx")).toMatch(/Creado el \{formatInstantDateTime\(t\.created_at\)\}/);
  });
});

describe("P2-13 · Gastos › Resumen no supone en qué se gastó", () => {
  it("sin «(vuelos, hotel, reservas)»", () => {
    expect(src("src/components/SmartSpendPanel.tsx")).not.toMatch(/\(vuelos, hotel, reservas\)/);
  });
});

describe("P2-16 · el «+» explica que lleva al mismo plan", () => {
  it("la ventana lo dice (sin quitar ninguna opción)", () => {
    const f = src("src/components/plan/PlanTripDialog.tsx");
    expect(f).toMatch(/Dos formas, el mismo plan que en Inicio/);
    expect(f).toMatch(/Ya tengo vuelos y hotel/);
    expect(f).toMatch(/Explorar con <IatoName \/>/);
  });
});

describe("P2-17 · el tipo de cambio con un nombre amigable", () => {
  it("«ExchangeRate-API», no «open.er-api.com»", () => {
    const live = { rates: { USD: 1, MXN: 18 }, source: "open.er-api.com", asOf: "2026-10-22T00:02:31Z", isFallback: false, kind: "live" } as any;
    expect(fxLabel(live)).toBe("Tipo de cambio de ExchangeRate-API (actualizado 22 oct 2026)");
    expect(fxLabel({ ...live, kind: "cached" })).not.toMatch(/er-api/);
    expect(converterRateLabel("open.er-api.com", null, true)).not.toMatch(/er-api/);
    expect(fxSourceName("open.er-api.com")).toBe("ExchangeRate-API");
  });
});
