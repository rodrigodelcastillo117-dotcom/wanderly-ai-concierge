// Mejora 9.5 (resto de la app): Mis viajes, Favoritos, Comparar, Convertidor, Trenes/Ferries y la landing.
import React from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen, fireEvent, within, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { vi, it, expect, beforeEach, describe } from "vitest";

const h = vi.hoisted(() => ({ tables: {} as Record<string, any[]>, pending: false, invoke: vi.fn(async () => ({ data: null, error: null })) }));
function qb(table: string) {
  const api: any = {
    select: () => api, eq: () => api, in: () => api, order: () => api, limit: () => api,
    maybeSingle: async () => ({ data: null, error: null }),
    then: (res: any, rej: any) => (h.pending ? new Promise(() => {}) : Promise.resolve({ data: h.tables[table] ?? [], error: null }).then(res, rej)),
  };
  return api;
}
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: (t: string) => qb(t), functions: { invoke: h.invoke } } }));
const authUser = vi.hoisted(() => ({ id: "u1" }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: authUser, loading: false }) }));
vi.mock("@/components/DashboardLayout", () => ({ DashboardLayout: ({ children }: any) => <>{children}</> }));
vi.mock("@/components/DestinationVideo", () => ({ DestinationVideo: () => null }));
vi.mock("@/lib/fx", async (orig) => { const m: any = await orig(); return { ...m, fetchFxTable: async () => m.FX_FALLBACK_TABLE }; });
const toastSpy = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastSpy }));
vi.mock("framer-motion", () => {
  const cache: Record<string, any> = {};
  const strip = (p: any) => { const { initial, animate, exit, transition, whileHover, whileTap, layout, ...r } = p; return r; };
  const motion = new Proxy({}, { get: (_t, tag: string) => (cache[tag] ??= (p: any) => React.createElement(tag, strip(p))) });
  return { motion, AnimatePresence: ({ children }: any) => <>{children}</> };
});

import Trips from "@/pages/Trips";
import Favoritos from "@/pages/Favoritos";
import Compare, { COMPARE_EXAMPLES } from "@/pages/Compare";
import Currency from "@/pages/Currency";
import { formatConverterAmount } from "@/lib/fx";
import { Tooltip } from "@/components/Tooltip";
import { TravelDNAStats as RealStats } from "@/components/lux/TravelDNAStats";
const NUEVA = { dominant: null, tripCount: 0, visitCount: 0, perfil: null, fuente: "ninguna", stats: [], viajesHechos: 0, viajesPlaneados: 0, lugares: 0 };

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const visible = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

beforeEach(() => {
  h.tables = {}; h.pending = false; h.invoke.mockClear();
  toastSpy.success.mockClear(); toastSpy.error.mockClear();
});

describe("Mis viajes", () => {
  it("el encabezado crece con su contenido (antes el título quedaba cortado arriba en el celular)", async () => {
    render(<MemoryRouter><Trips /></MemoryRouter>);
    const header = screen.getByTestId("trips-header");
    expect(header.className).toMatch(/min-h-\[180px\]/);
    expect(header.innerHTML).not.toMatch(/h-\[180px\] md:h-\[260px\]/);
    expect(within(header).getByText("Tu colección")).toBeInTheDocument();
  });

  it("sin viajes, «Ya tengo vuelos y hotel» y «Sube un viaje» salen una sola vez (en la tarjeta vacía)", async () => {
    render(<MemoryRouter><Trips /></MemoryRouter>);
    expect(await screen.findByText(/Aún no has guardado ningún viaje/)).toBeInTheDocument();
    expect(screen.getAllByText("Ya tengo vuelos y hotel")).toHaveLength(1);
    expect(screen.getAllByText("Sube un viaje que ya hiciste")).toHaveLength(1);
  });

  it("con viajes, los dos accesos siguen en el encabezado", async () => {
    h.tables.trips = [{ id: "t1", user_id: "u1", destino: "Roma", created_at: "2026-01-02", total_estimado: 1 }];
    render(<MemoryRouter><Trips /></MemoryRouter>);
    await screen.findByText("Roma");
    const header = screen.getByTestId("trips-header");
    expect(within(header).getByText("Ya tengo vuelos y hotel")).toBeInTheDocument();
    expect(within(header).getByText("Sube un viaje que ya hiciste")).toBeInTheDocument();
  });
});

describe("Favoritos", () => {
  it("mientras carga no dice «Aún no has guardado nada»", () => {
    h.pending = true;
    render(<MemoryRouter><Favoritos /></MemoryRouter>);
    expect(screen.getByTestId("favoritos-cargando")).toBeInTheDocument();
    expect(screen.queryByText(/Aún no has guardado nada/)).toBeNull();
  });

  it("vacío: ofrece ir a ver destinos (antes solo decía que tocaras un corazón)", async () => {
    render(<MemoryRouter><Favoritos /></MemoryRouter>);
    const empty = await screen.findByTestId("favoritos-vacio");
    expect(within(empty).getByRole("link", { name: /Ver destinos para ti/ })).toHaveAttribute("href", "/dashboard/descubre");
  });
});

describe("Comparar", () => {
  it("dice qué compara y los ejemplos solo llenan los campos (no gastan IA)", () => {
    render(<MemoryRouter><Compare /></MemoryRouter>);
    expect(screen.getByTestId("comparar-que-es")).toHaveTextContent(/costo diario.*mejor época.*visa.*seguridad/);
    const [a, b] = COMPARE_EXAMPLES[0];
    fireEvent.click(within(screen.getByTestId("comparar-ejemplos")).getByRole("button", { name: `${a} vs ${b}` }));
    expect(screen.getByLabelText("Destino 1")).toHaveValue(a);
    expect(screen.getByLabelText("Destino 2")).toHaveValue(b);
    expect(h.invoke).not.toHaveBeenCalled();
    expect(screen.queryByTestId("comparar-ejemplos")).toBeNull();
  });
});

describe("Convertidor de moneda", () => {
  it("cifras con separador de miles y decimales útiles en montos chicos", () => {
    expect(formatConverterAmount(1865.3456)).toBe("1,865.35");
    expect(formatConverterAmount(0.006612)).toBe("0.0066");
    expect(formatConverterAmount(0)).toBe("0.00");
    expect(formatConverterAmount(Number.NaN)).toBe("—");
  });

  it("no se llama «en vivo» (el tipo de cambio es del día), no avisa al abrir y muestra el nombre de la moneda", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(JSON.stringify({
      result: "success", time_last_update_utc: "Wed, 28 Oct 2026 00:02:31 +0000", rates: { USD: 1, MXN: 18.653456, EUR: 0.92 },
    }), { status: 200 }));
    render(<MemoryRouter><Currency /></MemoryRouter>);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Convertidor de moneda");
    expect(screen.queryByText(/Moneda en vivo/)).toBeNull();
    expect(await screen.findByText("1,865.35")).toBeInTheDocument();
    expect(screen.getAllByText("MXN · Peso mexicano").length).toBeGreaterThan(0);
    expect(screen.getAllByRole("option", { name: "KRW · Won surcoreano", hidden: true })).toHaveLength(2);
    expect(toastSpy.success).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Actualizar/ })); });
    await vi.waitFor(() => expect(toastSpy.success).toHaveBeenCalledWith("Tipo de cambio actualizado"));
    fetchSpy.mockRestore();
  });
});

describe("Textos sin afirmaciones sin fuente", () => {
  it("Trenes y Ferries no dicen «El #1» ni «Buenos precios»; las cifras van atribuidas", () => {
    const trenes = visible(read("src/pages/Trenes.tsx"));
    const ferries = visible(read("src/pages/Ferries.tsx"));
    for (const src of [trenes, ferries]) {
      expect(src).not.toMatch(/El #1/);
      expect(src).not.toMatch(/Buenos precios/);
    }
    expect(trenes).toMatch(/según Trainline/);
    expect(ferries).toMatch(/según Ferryhopper/);
    expect(ferries).toMatch(/según Direct Ferries/);
    // Los ejemplos de los campos se leían como datos ya llenos ("París", "Mykonos").
    expect(trenes).toMatch(/placeholder="Ej\. París"/);
    expect(ferries).toMatch(/placeholder="Ej\. Mykonos"/);
  });

  it("los avisos de primera vez no tapan la barra inferior del celular", async () => {
    render(<Tooltip id="t" icon="i" text="Hola" delayMs={0} onDismiss={() => {}} />);
    const box = (await screen.findByText("Hola")).closest(".fixed") as HTMLElement;
    expect(box.className).toMatch(/bottom-24/);
    expect(box.className).toMatch(/lg:bottom-4/);
  });

  it("landing: la cursiva dorada de «Todo el mundo.» no pierde la última letra al partir la línea", () => {
    expect(read("src/pages/Landing.tsx")).toMatch(/gold-text italic pr-\[0\.08em\] \[box-decoration-break:clone\]/);
  });
});

describe("TravelDNAStats sin datos", () => {
  it("puede ocultar su enlace de importar (en Perfil la tarjeta está justo abajo)", () => {
    const { unmount } = render(<MemoryRouter><RealStats dna={NUEVA as any} showImportLink={false} /></MemoryRouter>);
    expect(screen.getByTestId("dna-sin-datos")).toHaveTextContent("Aún no hay datos");
    expect(screen.queryByRole("link", { name: /Sube un viaje/ })).toBeNull();
    unmount();
    render(<MemoryRouter><RealStats dna={NUEVA as any} /></MemoryRouter>);
    expect(screen.getByRole("link", { name: /Sube un viaje/ })).toHaveAttribute("href", "/dashboard/viajes/importar");
  });
});
