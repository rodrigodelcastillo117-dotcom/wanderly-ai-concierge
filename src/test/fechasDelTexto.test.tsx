// Fechas desde lo escrito (pedido del dueño, 12-nov-2026): «cuando pones el mes o mes y fecha, que ya te mande en el
// calendario a el mes o mes y fecha. si dice 10 días, buscas los mejores precios de el mes, y que el viaje dure los
// 10 días». Datos simulados, sin red ni gasto.
import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { dayOfText } from "@/lib/planDefaults";
import { addDays, fechasBaratas, nextMonth, ventanasBaratas } from "../../supabase/functions/_shared/ventanaBarata";

const calls: Array<{ fn: string; body: any }> = [];
const cheap = { ventanas: [] as any[] };
const invoke = vi.fn(async (fn: string, o: any) => {
  calls.push({ fn, body: o?.body });
  if (fn === "fechas-baratas") return { data: { ok: cheap.ventanas.length > 0, ventanas: cheap.ventanas }, error: null };
  if (fn === "pexels-image") return { data: null, error: null };
  return { data: null, error: null };
});
vi.mock("@/integrations/supabase/client", () => {
  const from = (table: string) => {
    const api: any = {
      select: () => api, eq: () => api, in: () => api, order: () => api, limit: () => api, update: () => api, insert: () => api,
      maybeSingle: async () => ({ data: table === "profiles" ? { ciudad_origen: "Ciudad de México" } : null, error: null }),
      single: async () => ({ data: null, error: null }),
      then: (res: any, rej: any) => Promise.resolve({ data: [], error: null, count: 0 }).then(res, rej),
    };
    return api;
  };
  return { supabase: { from, functions: { invoke: (f: string, o: any) => invoke(f, o) }, auth: { getSession: async () => ({ data: { session: null } }) }, rpc: async () => ({ data: null, error: null }) } };
});
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1", email: "carlo@example.com" }, loading: false }) }));
vi.mock("@/components/DashboardLayout", () => ({ DashboardLayout: ({ children }: any) => <>{children}</> }));
vi.mock("@/components/DestinationVideo", () => ({ DestinationVideo: () => null }));
vi.mock("@/components/RouteGlobe3D", () => ({ RouteGlobe3D: () => null }));
vi.mock("@/components/AnalysisProgress", () => ({ AnalysisProgress: () => <p>ANALIZANDO</p> }));
vi.mock("@/components/TripBuildPreview", () => ({ TripBuildPreview: () => null }));
vi.mock("@/components/OriginPicker", () => ({ OriginPicker: ({ value }: any) => <span data-testid="origen">{value}</span> }));
vi.mock("@/components/VoiceInput", () => ({ VoiceInput: () => null }));
vi.mock("@/lib/analytics", () => ({ track: () => {} }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }) }));
vi.mock("framer-motion", () => {
  const strip = (p: any) => { const { initial, animate, exit, transition, layout, whileHover, whileTap, ...r } = p; return r; };
  const cache: Record<string, any> = {};
  const motion = new Proxy({}, { get: (_t, tag: string) => (cache[tag] ??= (p: any) => React.createElement(tag, strip(p))) });
  return { motion, AnimatePresence: ({ children }: any) => <>{children}</>, useReducedMotion: () => true };
});

import PlanTrip from "@/pages/PlanTrip";

const renderPlan = (text: string) => render(
  <MemoryRouter initialEntries={[`/dashboard/planear?q=${encodeURIComponent(text)}`]}>
    <Routes>
      <Route path="/dashboard/planear" element={<PlanTrip />} />
      <Route path="/dashboard/ruta" element={<p>RUTA</p>} />
      <Route path="/dashboard/viajes/:id" element={<p>VIAJE</p>} />
    </Routes>
  </MemoryRouter>,
);

beforeEach(() => { calls.length = 0; cheap.ventanas = []; (globalThis as any).ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} }; });

describe("el día escrito se lee (sin inventar)", () => {
  const hoy = new Date(2026, 10, 13); // 13-nov-2026
  it("«el 15 de diciembre», «diciembre 15», «del 12 al 20 de enero», con y sin año", () => {
    expect(dayOfText("Cancún el 15 de diciembre", hoy)).toEqual({ salida: "2026-12-15", regreso: null });
    expect(dayOfText("Cancún diciembre 15", hoy)).toEqual({ salida: "2026-12-15", regreso: null });
    expect(dayOfText("Madrid del 12 al 20 de enero", hoy)).toEqual({ salida: "2027-01-12", regreso: "2027-01-20" });
    expect(dayOfText("Roma 3 de mayo de 2028", hoy)).toEqual({ salida: "2028-05-03", regreso: null });
    expect(dayOfText("Cancún el 2 de noviembre", hoy)).toEqual({ salida: "2027-11-02", regreso: null }); // ya pasó este año
  });
  it("sin día no hay fecha: solo el mes, «10 días», o un día que no existe", () => {
    expect(dayOfText("Cancún 10 días en diciembre", hoy)).toBeNull();
    expect(dayOfText("Cancún diciembre 10 días", hoy)).toBeNull();
    expect(dayOfText("París el 31 de febrero", hoy)).toBeNull();
    expect(dayOfText("Tokio en abril", hoy)).toBeNull();
  });
});

describe("las salidas más baratas del mes para N noches (tarifas reales de referencia)", () => {
  const q = { origen: "MEX", destino: "CUN", mes: "2026-12", noches: 9 };
  const row = (o: string, d: string, dep: string, price: number, ret?: string) => ({
    origin: o, destination: d, origin_airport: o, destination_airport: d, price, airline: "VB", transfers: 0, duration_to: 130,
    departure_at: `${dep}T07:00:00-06:00`, ...(ret ? { return_at: `${ret}T20:00:00-06:00`, duration_back: 130 } : {}),
  });
  it("suma ida + regreso de un solo sentido con exactamente N noches; prefiere el redondo si es más barato", () => {
    const v = ventanasBaratas({
      redondo: [row("MEX", "CUN", "2026-12-05", 150, "2026-12-14"), row("MEX", "CUN", "2026-12-06", 90, "2026-12-20")], // el 2.º dura 14 noches: fuera
      ida: [row("MEX", "CUN", "2026-12-05", 80), row("MEX", "CUN", "2026-12-10", 40), row("MEX", "CUN", "2026-12-10", 60), row("MEX", "CUN", "2026-11-20", 10)],
      regreso: [row("CUN", "MEX", "2026-12-14", 50), row("CUN", "MEX", "2026-12-19", 45), row("CUN", "MEX", "2026-12-30", 1)],
    }, q, 20, "2026-11-13");
    expect(v.map((x) => [x.salida, x.regreso, x.precio_mxn_pp, x.tipo])).toEqual([
      ["2026-12-10", "2026-12-19", 1700, "dos_sencillos"], // (40 + 45) × 20
      ["2026-12-05", "2026-12-14", 2600, "dos_sencillos"], // 80 + 50 = 130 < redondo 150
    ]);
  });
  it("sin tarifas no inventa ventanas; ignora tarifas de otra ruta", () => {
    expect(ventanasBaratas({ redondo: [], ida: [], regreso: [] }, q, 20, "2026-11-13")).toEqual([]);
    expect(ventanasBaratas({ redondo: [], ida: [row("MEX", "MAD", "2026-12-05", 10)], regreso: [row("MAD", "MEX", "2026-12-14", 10)] }, q, 20, "2026-11-13")).toEqual([]);
  });
  it("pide 5 consultas al calendario de Aviasales (sin SerpApi) y el regreso puede caer en el mes siguiente", async () => {
    expect(nextMonth("2026-12")).toBe("2027-01");
    expect(addDays("2026-12-28", 9)).toBe("2027-01-06");
    const urls: string[] = [];
    const fetchImpl = (async (u: string) => {
      urls.push(String(u));
      const p = new URL(String(u)).searchParams;
      const data = p.get("one_way") === "true" && p.get("origin") === "MEX" ? [row("MEX", "CUN", "2026-12-28", 70)]
        : p.get("one_way") === "true" && p.get("departure_at") === "2027-01" ? [row("CUN", "MEX", "2027-01-06", 60)] : [];
      return new Response(JSON.stringify({ success: true, data }), { status: 200 });
    }) as unknown as typeof fetch;
    const r = await fechasBaratas(q, { token: "t", usdMxn: 20, hoyISO: "2026-11-13", fetchImpl });
    expect(urls).toHaveLength(5);
    expect(urls.every((u) => u.startsWith("https://api.travelpayouts.com/aviasales/v3/prices_for_dates?"))).toBe(true);
    expect(r).toMatchObject({ ok: true, ventanas: [{ salida: "2026-12-28", regreso: "2027-01-06", precio_mxn_pp: 2600 }] });
    expect((await fechasBaratas(q, { token: "", usdMxn: 20, hoyISO: "2026-11-13", fetchImpl })).motivo).toBe("sin_token");
    expect((await fechasBaratas({ ...q, mes: "2026-10" }, { token: "t", usdMxn: 20, hoyISO: "2026-11-13", fetchImpl })).motivo).toBe("mes_pasado");
  });
});

describe("Planear: el calendario se abre en el mes escrito y ofrece los días más baratos", () => {
  it("«Tokio, Kioto y Osaka 10 días en abril desde CDMX»: abril en el calendario, 3 salidas baratas de 10 días, un toque las pone", async () => {
    cheap.ventanas = [
      { salida: "2027-04-07", regreso: "2027-04-16", noches: 9, precio_mxn_pp: 18500, tipo: "dos_sencillos" },
      { salida: "2027-04-14", regreso: "2027-04-23", noches: 9, precio_mxn_pp: 19900, tipo: "redondo" },
    ];
    renderPlan("Tokio, Kioto y Osaka 10 días en abril desde CDMX");
    const paso = await screen.findByTestId("plan-preguntas", {}, { timeout: 8000 });
    const cal = within(paso).getByTestId("plan-calendario");
    expect(cal.textContent).toMatch(/abril \d{4}/i);
    await waitFor(() => expect(within(paso).getAllByTestId("plan-fecha-barata")).toHaveLength(2));
    const body = calls.find((c) => c.fn === "fechas-baratas")!.body;
    expect(body).toMatchObject({ origen: "Ciudad de México", destino: "Tokio", noches: 9 });
    expect(body.mes).toMatch(/^\d{4}-04$/);
    expect(within(paso).getByText(/Lo más barato en abril de \d{4} para 10 días:/)).toBeInTheDocument();
    expect(within(paso).getAllByTestId("plan-fecha-barata")[0]).toHaveTextContent("7 abr → 16 abr");
    expect(within(paso).getAllByTestId("plan-fecha-barata")[0]).toHaveTextContent("vuelo desde $18,500");
    expect(screen.getByTestId("plan-continuar")).toBeDisabled(); // nada se elige solo
    expect(screen.getByTestId("plan-continuar")).toHaveTextContent("Elige el día de salida"); // dice qué falta (Carlo)
    fireEvent.click(within(paso).getAllByTestId("plan-fecha-barata")[0]);
    expect((within(paso).getByLabelText("Salida") as HTMLInputElement).value).toBe("2027-04-07");
    expect((within(paso).getByLabelText("Regreso") as HTMLInputElement).value).toBe("2027-04-16");
    expect(screen.getByTestId("plan-continuar")).toBeEnabled();
  });

  it("sin precios del mes: solo el calendario en ese mes (sin botones ni precios inventados); tocar un día pone salida y regreso", async () => {
    renderPlan("Tokio, Kioto y Osaka 10 días en abril desde CDMX");
    const paso = await screen.findByTestId("plan-preguntas", {}, { timeout: 8000 });
    await waitFor(() => expect(calls.some((c) => c.fn === "fechas-baratas")).toBe(true));
    await waitFor(() => expect(within(paso).queryByTestId("plan-fechas-baratas")).toBeNull());
    const cal = within(paso).getByTestId("plan-calendario");
    expect(cal.textContent).toMatch(/abril \d{4}/i);
    fireEvent.click(within(cal).getByRole("gridcell", { name: "10" }).querySelector("button") ?? within(cal).getByText("10"));
    const salida = (within(paso).getByLabelText("Salida") as HTMLInputElement).value;
    expect(salida).toMatch(/^\d{4}-04-10$/);
    expect((within(paso).getByLabelText("Regreso") as HTMLInputElement).value).toBe(`${salida.slice(0, 4)}-04-19`);
  });

  it("«Tokio y Kioto desde CDMX el 15 de diciembre»: el calendario abre en diciembre con el 15 marcado; el regreso se pregunta", async () => {
    renderPlan("Tokio y Kioto desde CDMX el 15 de diciembre");
    const paso = await screen.findByTestId("plan-preguntas", {}, { timeout: 8000 });
    await waitFor(() => expect((within(paso).getByLabelText("Salida") as HTMLInputElement).value).toMatch(/^\d{4}-12-15$/));
    expect((within(paso).getByLabelText("Regreso") as HTMLInputElement).value).toBe("");
    expect(screen.getByTestId("plan-continuar")).toHaveTextContent("Elige el día de regreso");
    expect(within(paso).getByTestId("plan-calendario").textContent).toMatch(/diciembre \d{4}/i);
    expect(calls.filter((c) => c.fn === "fechas-baratas" && /-12$/.test(String(c.body?.mes)))).toEqual([]); // sin «N días» no hay ventana que buscar
    // Segundo toque (posterior) = regreso.
    fireEvent.click(within(within(paso).getByTestId("plan-calendario")).getByText("22"));
    expect((within(paso).getByLabelText("Regreso") as HTMLInputElement).value).toMatch(/^\d{4}-12-22$/);
  });
});
