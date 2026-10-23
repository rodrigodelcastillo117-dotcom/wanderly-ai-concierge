// Integración de la Ola 3 (claude/ola3-integ): el total del viaje es UNA cifra en todos lados.
// total-clima cambió RealTripTotal / tripTotalSummary, multiciudad agregó el resumen final de Comprar
// (traslados, la misma ciudad dos veces) y correo-seleccion manda "el total de la página". Con el caso
// real Roma → Florencia → Venecia (casoRomaFlorenciaVenecia) se comprueba que la página, la barra móvil,
// el resumen "Listo · Revisa y compra", el PDF y el correo (cliente y servidor) dan la misma cifra; y
// con la ruta por la India (Delhi dos veces) que el correo acepta las dos estancias con el total de la página.
import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CASO_TRIP } from "./fixtures/casoRomaFlorenciaVenecia";

const db = vi.hoisted(() => ({ trip: null as any, bookings: [] as any[], invokes: [] as Array<{ fn: string; body: any }> }));
const pdf = vi.hoisted(() => ({ calls: [] as any[] }));
vi.mock("@/integrations/supabase/client", () => {
  const from = (table: string) => {
    let kind = "select";
    const api: any = {
      select: () => api, eq: () => api, not: () => api, order: () => api, limit: () => api, in: () => api, gte: () => api,
      update: () => { kind = "update"; return api; }, insert: () => api, upsert: () => api, delete: () => api,
      maybeSingle: async () => ({ data: table === "trips" ? db.trip : null, error: null }),
      single: async () => ({ data: null, error: null }),
      then: (res: any, rej: any) => {
        if (kind === "update") return Promise.resolve({ data: [db.trip], error: null }).then(res, rej);
        return Promise.resolve({ data: table === "bookings" ? db.bookings : [], error: null }).then(res, rej);
      },
    };
    return api;
  };
  const invoke = vi.fn(async (fn: string, opts: any) => {
    db.invokes.push({ fn, body: opts?.body });
    if (fn === "enviar-seleccion") return { data: { ok: true, sent: 1 }, error: null };
    return { data: null, error: null };
  });
  return { supabase: { from, functions: { invoke }, rpc: async () => ({ data: null, error: null }), auth: { getSession: async () => ({ data: { session: null } }) } } };
});
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" }, loading: false }) }));
vi.mock("@/components/DashboardLayout", () => ({ DashboardLayout: ({ children }: any) => <>{children}</> }));
vi.mock("@/components/DestinationVideo", () => ({ DestinationVideo: () => null }));
vi.mock("@/components/CityCollapsible", () => ({ CityCollapsible: ({ children }: any) => <div>{children}</div>, useCityImage: () => null }));
vi.mock("@/components/EditWithAIDialog", () => ({ EditWithAIDialog: () => null }));
vi.mock("@/components/LiveTripQuote", () => ({ LiveTripQuote: () => null }));
vi.mock("@/components/InviteFriendDialog", () => ({ InviteFriendDialog: () => null }));
vi.mock("@/components/PriceWatchCard", () => ({ PriceWatchCard: () => null }));
vi.mock("@/components/TripDocuments", () => ({ TripDocuments: () => null }));
vi.mock("@/lib/tripPdf", () => ({ generateTripPDF: vi.fn(async (_trip: any, opts: any) => { pdf.calls.push(opts); }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));
(globalThis as any).ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };

import TripDetail from "@/pages/TripDetail";
import { buildTripPdfModel } from "@/lib/tripPdfModel";
import { buildSelectionRequest } from "@/lib/selectionEmail";
import { buildBuyFlow } from "@/lib/buyFlow";
import { computeTripDesglose } from "@/lib/quote";
import { selectionEmail, validateSelectionRequest } from "../../supabase/functions/_shared/selection-email";

const money = (n: number) => `$${Math.round(n).toLocaleString("es-MX")} MXN`;
const amountOf = (text: string | null | undefined) => Number(String(text ?? "").match(/\$([\d,]+)/)?.[1].replace(/,/g, ""));
// Hoteles consultados en vivo el 22-oct 15:00 UTC (ver tripTotalStates): Hotel Eden, Milu y Ca' Bonfadini.
const ALL_HOTELS = { Roma: 1, Florencia: 4, Venecia: 7 };

const renderTrip = () => render(
  <MemoryRouter initialEntries={[`/dashboard/viajes/${CASO_TRIP.id}`]}>
    <Routes><Route path="/dashboard/viajes/:id" element={<TripDetail />} /></Routes>
  </MemoryRouter>,
);

beforeEach(() => {
  db.trip = { ...JSON.parse(JSON.stringify(CASO_TRIP)), user_id: "u1", quote_basis: null, quote_needs_update: false, selections: null };
  db.bookings = [];
  db.invokes.length = 0;
  pdf.calls.length = 0;
  localStorage.clear();
});

describe("Ola 3 · Roma → Florencia → Venecia: la misma cifra en la página, la barra, Comprar, el PDF y el correo", () => {
  it("con vuelo (Iberia), un hotel por ciudad y el Coliseo elegidos", async () => {
    db.trip.selections = { v: 1, vuelo: { i: 5, key: null }, hospedaje: { i: -1, key: null }, noches_hospedaje: null,
      tours: [{ i: 0, key: null }], hoteles: Object.entries(ALL_HOTELS).map(([ciudad, i]) => ({ ciudad, i, key: null })) };
    renderTrip();
    const card = await screen.findByTestId("trip-total-card");
    expect(card).toHaveAttribute("data-state", "seleccion");
    const pageText = within(card).getByTestId("trip-total-amount").textContent!;
    const page = amountOf(pageText);

    // La cifra es la suma del desglose con esa selección (vuelo × 2, hoteles por sus noches, Coliseo × 2,
    // comida, transporte local y extras de la cotización) — no la cotización guardada ($561,468).
    const sel = { selVuelo: 5, selHospedaje: -1, selTours: new Set([0]), selHoteles: ALL_HOTELS };
    const desglose = computeTripDesglose(db.trip, { ...sel, nochesHospedaje: null as any }, 2);
    const expected = Object.values(desglose).reduce((s, v) => s + Number(v || 0), 0);
    expect(page).toBe(Math.round(expected));
    expect(page).not.toBe(561468);
    expect(desglose.vuelos).toBe(19699 * 2);
    expect(desglose.tours).toBe(1200 * 2);

    // 1 · Barra móvil.
    expect(screen.getByTestId("trip-next-bar")).toHaveTextContent(`Total ${money(page)}`);
    // 2 · Resumen final de Comprar ("Listo · Revisa y compra"), con el botón del correo en su hueco.
    const listo = screen.getByTestId("comprar-listo");
    expect(within(listo).getByTestId("comprar-listo-total")).toHaveTextContent(money(page));
    const boton = within(listo).getByTestId("enviar-seleccion-boton");
    expect(boton).toHaveTextContent("Enviarme mi selección por correo");
    expect(boton).toHaveAttribute("data-ready", "1");

    // 3 · Correo: lo que manda la página y lo que valida y escribe el servidor.
    fireEvent.click(boton);
    await waitFor(() => expect(db.invokes.some((x) => x.fn === "enviar-seleccion")).toBe(true));
    const body = db.invokes.find((x) => x.fn === "enviar-seleccion")!.body;
    expect(body.total).toBe(page);
    const v = validateSelectionRequest(body, { trip: db.trip, now: new Date("2026-10-22T16:00:00Z") });
    expect(v.ok).toBe(true);
    const input = (v as any).input;
    expect(input.total).toBe(page);
    expect(input.hotels.map((h: any) => h.city)).toEqual(["Roma", "Florencia", "Venecia"]);
    const mail = selectionEmail(input);
    expect(mail.text).toContain(money(page));
    expect(mail.html).toContain(page.toLocaleString("es-MX"));

    // 4 · PDF: el menú "Compartir PDF" → "PDF para compartir" recibe el total de la página y lo imprime.
    fireEvent.click(screen.getByRole("button", { name: "Compartir PDF" }));
    fireEvent.click(await screen.findByText("PDF para compartir"));
    await waitFor(() => expect(pdf.calls).toHaveLength(1));
    expect(pdf.calls[0].totals.total).toBe(expected);
    const model = buildTripPdfModel(db.trip, { ...pdf.calls[0], now: new Date("2026-10-22T16:00:00Z") });
    expect(Math.round(model.totals.total)).toBe(page);
  });

  it("sin elegir nada: la página, la barra, Comprar y el PDF dicen la cifra de la cotización; el correo no se manda", async () => {
    renderTrip();
    const card = await screen.findByTestId("trip-total-card");
    const page = amountOf(within(card).getByTestId("trip-total-amount").textContent);
    expect(page).toBe(561468);
    expect(screen.getByTestId("trip-next-bar")).toHaveTextContent(`Total ${money(page)}`);
    expect(screen.getByTestId("comprar-listo-total")).toHaveTextContent(money(page));
    expect(screen.getByTestId("enviar-seleccion-boton")).toHaveAttribute("data-ready", "0");
    expect(screen.getByTestId("enviar-seleccion-boton")).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Compartir PDF" }));
    fireEvent.click(await screen.findByText("PDF para compartir"));
    await waitFor(() => expect(pdf.calls).toHaveLength(1));
    expect(Math.round(pdf.calls[0].totals.total)).toBe(page);
  });
});

// Ruta por la India de claude/multiciudad-carrusel: Delhi al llegar (4 noches) y al final (2 noches).
const hotel = (ciudad: string, nombre: string, precio: number) => ({ ciudad, nombre, precio_por_noche: precio, tier: "equilibrio", fuente_precio: "serpapi" });
const INDIA: any = {
  id: "t-india-ruta", user_id: "u1", destino: "Delhi → Agra → Jaipur → Ranthambore → Delhi", ciudad_origen: "Ciudad de México",
  fecha_salida: "2026-11-21", fecha_regreso: "2026-12-05", num_viajeros: 2, created_at: "2026-10-23T10:00:00Z",
  desglose_presupuesto: { comida: 10000, transporte_local: 2000 },
  vuelos_json: [{ tier: "equilibrio", mode: "vuelo", aerolinea: "Aerolínea por confirmar", fuente_precio: "estimado", from: "Ciudad de México", to: "Delhi", precio_por_persona: 38000 }],
  hospedaje_json: [hotel("Delhi", "The Imperial", 6000), hotel("Jaipur", "Samode Haveli", 5200), hotel("Ranthambore", "Nahargarh", 7000)],
  tours_json: [], restaurantes_json: [],
  itinerario_json: { multi: true, destinations: ["Delhi", "Agra", "Jaipur", "Ranthambore", "Delhi"], logistics: { fx_usd_mxn: 18,
    internal_transport: [{ from: "Delhi", to: "Agra", mode: "tren", provider: "Gatimaan Express", duration: "1h 40m", price_per_person_usd: 20 }],
    per_destination: [
      { city: "Delhi", checkin: "2026-11-21", checkout: "2026-11-25" }, { city: "Agra", checkin: "2026-11-25", checkout: "2026-11-27" },
      { city: "Jaipur", checkin: "2026-11-27", checkout: "2026-12-01" }, { city: "Ranthambore", checkin: "2026-12-01", checkout: "2026-12-03" },
      { city: "Delhi", checkin: "2026-12-03", checkout: "2026-12-05" }] } },
};

describe("Ola 3 · la misma ciudad dos veces (multiciudad) en el correo (correo-seleccion)", () => {
  const sel = { selVuelo: 0, selHospedaje: -1, selTours: new Set<number>(), selHoteles: { Delhi: 0, Jaipur: 1, Ranthambore: 2 } };

  it("Delhi al llegar y al final: dos hoteles con sus noches, sus claves de Comprar y el total de la página", () => {
    const desglose = computeTripDesglose(INDIA, { ...sel, nochesHospedaje: null as any }, 2);
    const total = Object.values(desglose).reduce((s, v) => s + Number(v || 0), 0);
    // 4 + 2 noches en Delhi, 4 en Jaipur y 2 en Ranthambore (una habitación para 2).
    expect(desglose.hospedaje).toBe(6000 * 4 + 5200 * 4 + 7000 * 2 + 6000 * 2);
    const r = buildSelectionRequest(INDIA, sel, { travelers: 2, nights: 14, desglose, total });
    expect(r.ready).toBe(true);
    const hotels = r.payload!.items.filter((i) => i.kind === "hospedaje");
    expect(hotels.map((h) => [h.index, h.nights, h.price])).toEqual([[0, 4, 24000], [1, 4, 20800], [2, 2, 14000], [0, 2, 12000]]);
    // Cada estancia de Delhi con su elemento de "Comprar" (y su "Ya lo compré"), no la primera repetida.
    const comprar = buildBuyFlow(INDIA, sel).items.filter((i) => i.kind === "hospedaje" && i.index === 0).map((i) => i.key);
    expect(comprar).toHaveLength(2);
    expect(hotels.filter((h) => h.index === 0).map((h) => h.key)).toEqual(comprar);

    const v = validateSelectionRequest({ ...r.payload, trip_id: INDIA.id, to: "me" }, { trip: INDIA });
    expect(v.ok).toBe(true);
    const input = (v as any).input;
    expect(input.total).toBe(Math.round(total));
    expect(input.hotels.map((h: any) => [h.city, h.nights])).toEqual([["Delhi", 4], ["Jaipur", 4], ["Ranthambore", 2], ["Delhi", 2]]);
    expect(selectionEmail(input).text).toContain(money(total));
  });

  it("el servidor sigue rechazando un tercer hotel en Delhi (solo hay dos estancias) y precios alterados", () => {
    const desglose = computeTripDesglose(INDIA, { ...sel, nochesHospedaje: null as any }, 2);
    const total = Object.values(desglose).reduce((s, v) => s + Number(v || 0), 0);
    const r = buildSelectionRequest(INDIA, sel, { travelers: 2, nights: 14, desglose, total });
    const extra = { ...r.payload!.items.find((i) => i.kind === "hospedaje" && i.index === 0)!, price: 12000 };
    const tres = validateSelectionRequest({ ...r.payload, items: [...r.payload!.items, extra], total: total + 12000, trip_id: INDIA.id }, { trip: INDIA });
    expect(tres).toMatchObject({ ok: false, code: "elemento_repetido" });
    const caro = r.payload!.items.map((i) => (i.kind === "hospedaje" && i.index === 0 && i.nights === 2 ? { ...i, price: 1 } : i));
    expect(validateSelectionRequest({ ...r.payload, items: caro, trip_id: INDIA.id }, { trip: INDIA })).toMatchObject({ ok: false, code: "precio_no_coincide" });
  });

  it("elegir avión o tren entre ciudades (traslados) no cambia el total ni lo que manda el correo", () => {
    const desglose = computeTripDesglose(INDIA, { ...sel, nochesHospedaje: null as any }, 2);
    const total = Object.values(desglose).reduce((s, v) => s + Number(v || 0), 0);
    const a = buildSelectionRequest(INDIA, sel, { travelers: 2, nights: 14, desglose, total });
    const b = buildSelectionRequest(INDIA, { ...sel, selLegs: { "traslado:delhi>agra": "vuelo" } } as any, { travelers: 2, nights: 14, desglose, total });
    expect(b.payload).toEqual(a.payload);
  });
});
