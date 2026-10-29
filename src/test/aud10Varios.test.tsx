// Auditoría 10/10 (herramientas y técnica, 28-oct-2026), defectos sueltos:
//  P1-11 Recuerdos «Hazme mi video» → Wrapped decía "Todavía no hay viajes con fechas en 2026" (falso).
//  P2-10 escanear ticket: la respuesta del modelo llegaba cortada (max_tokens 1500) y salía 422.
//  P2-11 clima: viento sin unidad; el radar pedía cuadros de NASA que aún no existían (404).
//  P2-13 el panel de notificaciones dejaba ver lo de atrás.
//  P2-16 Seguros con afirmaciones sin fuente; Ferries con la fecha en ISO.
//  P2-17 diálogo de compartir sin descripción accesible.
//  Técnica: texto de Explorar ("Explorar destinos" vs botón "Buscar precios"); perfil de amigo inexistente
//  decía "privado"; cruiseLinks metía la lista blanca completa del servidor en el paquete público.
import React from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  rpc: vi.fn(),
  user: { id: "aaaaaaaa-0000-4000-8000-00000000000a" },
  wrapped: null as any,
}));
vi.mock("@/integrations/supabase/client", () => {
  const qb = (rows: unknown) => {
    const api: any = {
      select: () => api, eq: () => api, in: () => api, order: () => api, or: () => api, limit: () => api, neq: () => api, not: () => api,
      maybeSingle: async () => ({ data: null, error: null }),
      then: (res: any, rej: any) => Promise.resolve({ data: rows, error: null }).then(res, rej),
    };
    return api;
  };
  return { supabase: { rpc: h.rpc, from: () => qb([]), functions: { invoke: vi.fn(async () => ({ data: null, error: null })) } } };
});
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: h.user, loading: false }) }));
vi.mock("@/components/DashboardLayout", () => ({ DashboardLayout: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock("@/components/media/SmartImage", () => ({ SmartImage: () => null }));
vi.mock("@/components/Tooltip", () => ({ FeatureTooltip: () => null }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("@/lib/wrappedApi", async () => {
  const actual: any = await vi.importActual("@/lib/wrappedApi");
  return { ...actual, loadWrapped: vi.fn(async () => h.wrapped) };
});

import { upcomingInYear } from "@/lib/wrappedApi";
import { computeWrapped } from "@/lib/wrapped";
import Wrapped from "@/pages/Wrapped";
import FriendProfile from "@/pages/FriendProfile";
import { InviteFriendDialog } from "@/components/InviteFriendDialog";
import { latestFromDomains, fetchLatestFrame, domainsUrl } from "@/lib/weatherRadar";
import { RECEIPT_MAX_TOKENS, receiptBody, receiptContent, receiptTruncated, parseReceipt } from "../../supabase/functions/scan-receipt/receipt";
import { EXPLORE_SIN_CACHE } from "../../supabase/functions/flights-search/explore";
import { cruiseLinks } from "@/lib/cruiseLinks";
import { checkAllowlisted } from "../../supabase/functions/_shared/booking/allowlist";
import { localISODate } from "@/lib/localDate";

const root = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

describe("P1-11 Wrapped sin callejón", () => {
  it("cuenta los viajes del año que aún no empiezan", () => {
    const trips = [{ fecha_salida: "2026-10-30" }, { fecha_salida: "2026-11-20" }, { fecha_salida: "2026-12-12" }, { fecha_salida: "2027-02-10" }, { fecha_salida: "2026-03-01" }];
    expect(upcomingInYear(trips, 2026, "2026-10-28")).toEqual({ count: 3, first: "2026-10-30" });
  });

  it("explica que los viajes aún no empiezan y ofrece volver a Recuerdos", async () => {
    const year = Number(localISODate().slice(0, 4));
    h.wrapped = { stats: computeWrapped({ year, today: localISODate(), trips: [] } as any), years: [], upcoming: { count: 3, first: `${year}-12-30` } };
    render(<MemoryRouter initialEntries={[`/wrapped/${year}?video=1`]}><Routes><Route path="/wrapped/:year" element={<Wrapped />} /></Routes></MemoryRouter>);
    const text = (await screen.findByTestId("wrapped-vacio")).textContent ?? "";
    expect(text).toMatch(new RegExp(`Tus 3 viajes de ${year} todavía no empiezan \\(el primero sale el 30 de diciembre\\)`));
    expect(text).not.toMatch(/Todavía no hay viajes con fechas/);
    expect(screen.getByTestId("wrapped-video-espera")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Volver a Recuerdos" })).toHaveAttribute("href", "/dashboard/recuerdos");
  });
});

describe("P2-10 escanear ticket", () => {
  it("da espacio a la respuesta y lee el contenido en partes o cortado", () => {
    expect(RECEIPT_MAX_TOKENS).toBeGreaterThanOrEqual(4096);
    expect(receiptBody("data:image/png;base64,AAAA").max_tokens).toBe(RECEIPT_MAX_TOKENS);
    const choice = { finish_reason: "stop", message: { content: [{ type: "text", text: '{"legible":true,"total":50,"moneda":"USD","fecha":null}' }] } };
    const r = parseReceipt(receiptContent(choice), "2026-10-28");
    expect(r.ok && r.receipt.total).toBe(50);
    expect(r.ok && r.receipt.currency).toBe("USD");
    expect(receiptTruncated({ finish_reason: "length" })).toBe(true);
  });
  it("una respuesta inválida es un problema de la lectura (502), no de la foto (422)", () => {
    const src = read("supabase/functions/scan-receipt/index.ts");
    expect(src).toMatch(/parseReceipt\(receiptContent\(choice\)/);
    expect(src).toMatch(/No pudimos terminar de leer el ticket\. Intenta de nuevo o captúralo a mano\." \}, 502\)/);
  });
});

describe("P2-11 clima", () => {
  it("el viento de cada día lleva su unidad", () => {
    expect(read("src/pages/TripWeather.tsx")).toMatch(/\{d\.wind\} km\/h/);
  });
  it("el radar usa el último cuadro publicado (sin pedir cuadros futuros)", async () => {
    expect(latestFromDomains("<Domains><DimensionDomain><Domain>2026-10-27/2026-10-28T16:30:00Z/PT30M</Domain></DimensionDomain></Domains>")).toBe("2026-10-28T16:30:00Z");
    expect(latestFromDomains("<Domain>2026-10-20/2026-10-21T10:00:00Z/PT30M,2026-10-22/2026-10-28T09:30:00Z/PT30M</Domain>")).toBe("2026-10-28T09:30:00Z");
    expect(latestFromDomains("sin dominio")).toBeNull();
    const fake = vi.fn(async () => new Response("<Domain>2026-10-27/2026-10-28T16:30:00Z/PT30M</Domain>", { status: 200 }));
    expect(await fetchLatestFrame(fake as any, new Date("2026-10-28T22:45:00Z"))).toBe("2026-10-28T16:30:00Z");
    expect(String((fake.mock.calls[0] as unknown[])[0])).toBe(domainsUrl(new Date("2026-10-28T22:45:00Z")));
    expect(domainsUrl(new Date("2026-10-28T22:45:00Z"))).toMatch(/\/1\.0\.0\/IMERG_Precipitation_Rate_30min\/default\/GoogleMapsCompatible_Level6\/all\/2026-10-26T22:45:00Z--2026-10-28T23:45:00Z\.xml$/);
    expect(read("src/components/weather/WeatherRadar.tsx")).toMatch(/fetchLatestFrame\(\)/);
  });
});

describe("P2-13 / P2-16 / P2-17 detalles de pantalla", () => {
  it("el panel de notificaciones es negro sólido", () => {
    const src = read("src/components/NotificationBell.tsx");
    expect(src).toMatch(/bg-black shadow/);
    expect(src).not.toMatch(/bg-black\/90 backdrop-blur-2xl/);
  });
  it("Seguros no afirma nada sin fuente; Ferries muestra la fecha legible", () => {
    // Solo lo que se ve (sin comentarios del código).
    const ins = read("src/pages/Insurance.tsx").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
    for (const claim of ["Lonely Planet", "COVID incluido", "10M USD", "favorito de mochileros", "Sin franquicia", "200+ actividades", "€30,000"]) {
      expect(ins).not.toContain(claim);
    }
    expect(read("src/pages/Ferries.tsx")).toMatch(/fecha \(\$\{date \? formatLocalDate\(date/);
  });
  it("el diálogo de compartir tiene descripción accesible", () => {
    h.rpc.mockResolvedValue({ data: [], error: null });
    render(<MemoryRouter><InviteFriendDialog tripId="t1" isOwner /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: "Compartir viaje" }));
    const dialog = screen.getByRole("dialog");
    const id = dialog.getAttribute("aria-describedby");
    expect(id && document.getElementById(id)?.textContent).toMatch(/podrán ver y editar todo el viaje/);
  });
});

describe("técnica: textos, perfil inexistente y paquete público", () => {
  it("Explorar pide pulsar el botón que existe", () => {
    expect(EXPLORE_SIN_CACHE("Ciudad de México")).toBe('Aún no hay precios guardados desde Ciudad de México. Pulsa "Buscar precios" para consultarlos.');
  });

  it("un perfil que no existe dice que no existe (no 'privado')", async () => {
    h.rpc.mockImplementation(async (fn: string) => fn === "amigo_existe" ? { data: false, error: null } : { data: { ok: false, error: "privado" }, error: null });
    const ID = "cccccccc-0000-4000-8000-00000000000c";
    render(<MemoryRouter initialEntries={[`/dashboard/social/amigo/${ID}`]}><Routes><Route path="/dashboard/social/amigo/:id" element={<FriendProfile />} /></Routes></MemoryRouter>);
    expect(await screen.findByText("Este perfil no existe")).toBeInTheDocument();
    expect(h.rpc).toHaveBeenCalledWith("amigo_existe", { p_id: ID });
  });

  it("cruiseLinks no carga la lista blanca del servidor y sus enlaces la siguen pasando", () => {
    const src = read("src/lib/cruiseLinks.ts");
    expect(src).not.toMatch(/from "[^"]*booking\/allowlist/);
    const links = cruiseLinks({ naviera: "MSC", puerto_salida: "Barcelona", puerto_llegada: "Roma", fecha_salida: "2027-05-10" } as any);
    expect(links.length).toBeGreaterThan(0);
    for (const l of links) expect(checkAllowlisted(l.url).ok, l.url).toBe(true);
    expect(cruiseLinks({ naviera: "Desconocida", puerto_salida: "", puerto_llegada: "Cozumel" } as any).map((l) => l.label)).toEqual(["Cruise Critic", "Vacations To Go"]);
  });
});
