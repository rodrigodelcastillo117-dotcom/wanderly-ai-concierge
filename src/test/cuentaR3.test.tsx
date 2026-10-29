// Ronda 3 de CUENTA Y TÉCNICA (29-oct-2026): Ayuda con sesión iniciada (P1-1) y los P2 de código
// (buzón sin datos técnicos, «Reintentar» visible, buzón fuera del layout principal, contadores del
// Perfil, nombres coherentes, bundle de /dashboard/ruta y Ayuda que menciona el buzón). Cada prueba
// falla con el código de a1abb6a.
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

(globalThis as any).ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };

const invoke = vi.fn();
const qb: any = { select: () => qb, eq: () => qb, maybeSingle: async () => ({ data: null, error: null }) };
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: async () => ({ data: null, error: null }), functions: { invoke: (...a: unknown[]) => invoke(...a) }, from: () => qb },
}));
const auth = vi.hoisted(() => ({ value: { user: { id: "u1", email: "alvaro@correo.mx" } as any, signOut: async () => {} } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => auth.value }));
vi.mock("@/hooks/useSubscription", () => ({ useSubscription: () => ({ loading: false, isPro: false }) }));
vi.mock("@/components/NotificationBell", () => ({ NotificationBell: () => null }));
const vault = vi.hoisted(() => ({ items: [] as { section: string }[] }));
vi.mock("@/lib/boveda/api", () => ({ listVault: async () => ({ items: vault.items }) }));

import { DashboardLayout, mobileMoreNav } from "@/components/DashboardLayout";
import { Ayuda } from "@/pages/Legal";
import { contextLines, opinionContext, sendOpinion } from "@/lib/opinion";
import { OpinionDialog } from "@/components/opinion/OpinionDialog";
import { StandaloneOpinion } from "@/components/opinion/OpinionEntry";
import { openOpinion } from "@/lib/opinionBus";
import BenefitsVault from "@/components/BenefitsVault";
import { titleForPath } from "@/lib/routeTitles";
import { screenName } from "../../supabase/functions/_shared/opinion";
import { VENDOR_GROUPS, vendorChunk } from "../../vite.chunks";

const src = (p: string) => readFileSync(p, "utf8");
const nm = (p: string) => `/app/node_modules/${p}/index.js`;

beforeEach(() => { invoke.mockReset(); auth.value = { user: { id: "u1", email: "alvaro@correo.mx" }, signOut: async () => {} }; });

// ───────────────────────────── P1-1 · Ayuda con la sesión iniciada ─────────────────────────────
describe("P1-1 · Ayuda accesible con sesión iniciada", () => {
  it("«Más» tiene «Ayuda» y lleva a /ayuda", () => {
    expect(mobileMoreNav.find((n) => n.to === "/ayuda")?.label).toBe("Ayuda");
    render(<MemoryRouter initialEntries={["/dashboard/viajes"]}><DashboardLayout><div>PAGINA</div></DashboardLayout></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: "Más" }));
    const sheet = within(screen.getByRole("dialog"));
    expect(sheet.getByRole("link", { name: "Ayuda" })).toHaveAttribute("href", "/ayuda");
  });

  it("el menú lateral de escritorio también tiene «Ayuda»", () => {
    render(<MemoryRouter initialEntries={["/dashboard"]}><DashboardLayout><div>PAGINA</div></DashboardLayout></MemoryRouter>);
    const help = screen.getByTestId("sidebar-help");
    expect(help).toHaveTextContent("Ayuda");
    expect(help).toHaveAttribute("href", "/ayuda");
  });

  it("/ayuda con sesión: botón «Volver a la app» (a la pantalla de donde vino o a Inicio)", () => {
    render(<MemoryRouter initialEntries={["/ayuda"]}><Ayuda /></MemoryRouter>);
    expect(screen.getByRole("link", { name: "Volver a la app" })).toHaveAttribute("href", "/dashboard");
    expect(screen.queryByRole("link", { name: "Volver al inicio" })).toBeNull();
  });

  it("/ayuda abierta desde un viaje regresa a ese viaje", () => {
    render(<MemoryRouter initialEntries={[{ pathname: "/ayuda", state: { from: "/dashboard/viajes/abc" } }]}><Ayuda /></MemoryRouter>);
    expect(screen.getByRole("link", { name: "Volver a la app" })).toHaveAttribute("href", "/dashboard/viajes/abc");
  });

  it("/ayuda sin sesión sigue igual («Volver al inicio»)", () => {
    auth.value = { user: null, signOut: async () => {} };
    render(<MemoryRouter initialEntries={["/ayuda"]}><Ayuda /></MemoryRouter>);
    expect(screen.getByRole("link", { name: "Volver al inicio" })).toHaveAttribute("href", "/");
    expect(screen.queryByRole("link", { name: "Volver a la app" })).toBeNull();
  });
});

// ───────────────────────────── P2-9 · Ayuda menciona el buzón ─────────────────────────────
describe("P2-9 · Contacto en Ayuda menciona el buzón", () => {
  it("dice dónde está «¿Algo no se entiende? Cuéntanos» y, con sesión, lo abre ahí mismo", async () => {
    render(<MemoryRouter initialEntries={["/ayuda#contacto"]}><Ayuda /></MemoryRouter>);
    const contacto = screen.getByRole("heading", { name: "Contacto" }).closest("section")!;
    expect(contacto).toHaveTextContent("¿Algo no se entiende? Cuéntanos");
    expect(contacto).toHaveTextContent(/menú «Más»/);
    await act(async () => { fireEvent.click(within(contacto).getByRole("button", { name: "¿Algo no se entiende? Cuéntanos" })); });
    expect(await screen.findByTestId("opinion-dialog")).toBeInTheDocument();
  });

  it("sin sesión lo menciona, sin botón (hay que iniciar sesión para mandarlo)", () => {
    auth.value = { user: null, signOut: async () => {} };
    render(<MemoryRouter initialEntries={["/ayuda"]}><Ayuda /></MemoryRouter>);
    const contacto = screen.getByRole("heading", { name: "Contacto" }).closest("section")!;
    expect(contacto).toHaveTextContent("¿Algo no se entiende? Cuéntanos");
    expect(within(contacto).queryByRole("button")).toBeNull();
  });
});

// ───────────────────────────── P2-1 · buzón sin datos técnicos ─────────────────────────────
describe("P2-1 · el buzón no muestra datos técnicos", () => {
  it("«Pantalla: Inicio · Celular»: sin versión ni ruta cruda (se envían, pero no se muestran)", async () => {
    const ctx = { ...opinionContext("/dashboard"), dispositivo: "celular" as const, version: "index-CIk9IQHW" };
    const lines = contextLines(ctx);
    expect(lines).toEqual(["Pantalla: Inicio · Celular"]);
    expect(lines.join(" ")).not.toMatch(/Versión|index-|\/dashboard/);
    invoke.mockResolvedValueOnce({ data: { ok: true, folio: "0B200000", team_notified: true }, error: null });
    await sendOpinion({ tipo: "idea", texto: "Una idea", calificacion: null, contactar: true }, ctx, "k".repeat(20));
    expect(invoke).toHaveBeenCalledWith("enviar-opinion", { body: expect.objectContaining({ ruta: "/dashboard", version: "index-CIk9IQHW", dispositivo: "celular" }) });
  });

  it("dentro de un viaje: «Viaje: el que tienes abierto», sin el id", () => {
    const trip = "0b100000-0000-0000-0000-00000000000a";
    const lines = contextLines({ ...opinionContext(`/dashboard/viajes/${trip}/packing`), dispositivo: "escritorio" });
    expect(lines).toEqual(["Pantalla: Equipaje del viaje · Escritorio", "Viaje: el que tienes abierto"]);
  });

  it("las pantallas sin layout se nombran como su título", () => {
    expect(screenName("/onboarding/deep")).toBe("Preferencias de viaje");
    expect(screenName("/onboarding")).toBe("Primeros pasos");
  });

  it("pantalla sin nombre: no enseña la ruta", () => {
    const lines = contextLines({ ...opinionContext("/prive/drops"), dispositivo: "celular" });
    expect(lines).toEqual(["Pantalla: la que tienes abierta · Celular"]);
  });

  it("en el diálogo se ve «Pantalla: Mis viajes · …» y ningún «Versión de la app»", () => {
    render(<MemoryRouter><OpinionDialog open onOpenChange={() => {}} pathname="/dashboard/viajes" /></MemoryRouter>);
    const box = screen.getByTestId("opinion-context");
    expect(box).toHaveTextContent(/Pantalla: Mis viajes · (Celular|Escritorio)/);
    expect(box).not.toHaveTextContent("/dashboard");
    expect(box).not.toHaveTextContent("Versión");
  });
});

// ───────────────────────────── P2-2 · «Reintentar» visible a 390 px ─────────────────────────────
describe("P2-2 · el aviso y «Reintentar» quedan a la vista", () => {
  it("el error y el botón van en la barra fija al pie del diálogo", async () => {
    const spy = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    render(<MemoryRouter><OpinionDialog open onOpenChange={() => {}} pathname="/dashboard" /></MemoryRouter>);
    const dlg = screen.getByTestId("opinion-dialog");
    fireEvent.click(within(dlg).getByRole("radio", { name: "Algo no funciona" }));
    fireEvent.change(within(dlg).getByLabelText("Cuéntanos con tus palabras"), { target: { value: "No carga el mapa" } });
    fireEvent.click(within(dlg).getByRole("button", { name: "Enviar" }));
    const bar = await within(dlg).findByTestId("opinion-actions");
    expect(bar.className).toMatch(/\bsticky\b/);
    expect(bar.className).toMatch(/\bbottom-0\b/);
    expect(within(bar).getByTestId("opinion-error")).toHaveTextContent("Estás sin conexión");
    expect(within(bar).getByRole("button", { name: "Reintentar" })).toBeInTheDocument();
    spy.mockRestore();
  });
});

// ───────────────────────────── P2-3 · buzón fuera del layout principal ─────────────────────────────
describe("P2-3 · buzón en Equipaje, Mapa, Viaje en vivo, Wrapped y preferencias", () => {
  it.each([
    "src/pages/TripPacking.tsx", "src/pages/TripMap.tsx", "src/pages/LiveTrip.tsx", "src/pages/Wrapped.tsx", "src/pages/OnboardingDeep.tsx",
  ])("%s pone el enlace y el diálogo", (f) => {
    const s = src(f);
    expect(s).toMatch(/import \{[^}]*StandaloneOpinion[^}]*\} from "@\/components\/opinion\/OpinionEntry"/);
    expect(s).toMatch(/<StandaloneOpinion\b/);
  });

  it("Privé no se toca", () => {
    for (const f of ["src/pages/prive/PriveRoot.tsx", "src/pages/prive/PriveHub.tsx"]) expect(src(f)).not.toMatch(/Opinion/);
  });

  it("el enlace abre el diálogo; con dos anfitriones se abre uno solo", async () => {
    render(<MemoryRouter initialEntries={["/dashboard/viajes/0b100000-0000-0000-0000-00000000000a/packing"]}><StandaloneOpinion /><StandaloneOpinion /></MemoryRouter>);
    await act(async () => { fireEvent.click(screen.getAllByTestId("opinion-footer-link")[0]); });
    expect(await screen.findAllByTestId("opinion-dialog")).toHaveLength(1);
    expect(screen.getByTestId("opinion-context")).toHaveTextContent("Pantalla: Equipaje del viaje");
  });

  it("Wrapped: también en las historias (tarjeta final)", () => {
    expect(src("src/components/wrapped/WrappedStories.tsx")).toMatch(/onOpinion/);
    expect(src("src/pages/Wrapped.tsx")).toMatch(/onOpinion=\{openOpinion\}/);
    expect(typeof openOpinion).toBe("function");
  });
});

// ───────────────────────────── P2-4 · contadores del Perfil ─────────────────────────────
describe("P2-4 · «Documentos y tarjetas» del Perfil sin textos cortados", () => {
  it("2 columnas en el celular y etiquetas completas (sin truncate)", async () => {
    vault.items = [{ section: "documento" }, { section: "membresia" }];
    const { container } = render(<MemoryRouter><BenefitsVault /></MemoryRouter>);
    const grid = container.querySelector("[data-testid='vault-counts']")!;
    expect(grid.className).toMatch(/grid-cols-2/);
    expect(grid.className).toMatch(/sm:grid-cols-4/);
    for (const label of grid.querySelectorAll("p:last-child")) expect(label.className).not.toMatch(/truncate/);
    expect(grid).toHaveTextContent("Documentos");
    expect(grid).toHaveTextContent("Membresías");
  });
});

// ───────────────────────────── P2-6 · nombres coherentes ─────────────────────────────
describe("P2-6 · la misma sección se llama igual en Inicio, menú y pestaña", () => {
  const home = src("src/pages/DashboardHome.tsx");
  const layout = src("src/components/DashboardLayout.tsx");
  it("Cerca de ti", () => {
    expect(home).toMatch(/label: "Cerca de ti"/);
    expect(home).not.toMatch(/sub: "De mí"/);
    expect(layout).not.toMatch(/label: "Cercanos"/);
    expect(mobileMoreNav.find((n) => n.to === "/dashboard/cercanos")?.label).toBe("Cerca de ti");
    expect(titleForPath("/dashboard/cercanos")).toBe("Cerca de ti · IATOS");
    expect(screenName("/dashboard/cercanos")).toBe("Cerca de ti");
    expect(src("src/pages/Cercanos.tsx")).toMatch(/>Cerca de ti<\/h1>/);
  });
  it("Convertidor de moneda", () => {
    expect(home).toMatch(/label: "Convertidor de moneda"/);
    expect(home).not.toMatch(/"Conversor"/);
    expect(src("src/pages/Currency.tsx")).not.toMatch(/>Conversor</);
    expect(titleForPath("/dashboard/convertidor")).toBe("Convertidor de moneda · IATOS");
  });
  it("Actividades (no «Tours»)", () => {
    expect(home).toMatch(/label: "Actividades"/);
    expect(home).not.toMatch(/label: "Tours"/);
    expect(titleForPath("/dashboard/actividades")).toBe("Actividades · IATOS");
    expect(screenName("/dashboard/actividades")).toBe("Actividades");
  });
});

// ───────────────────────────── P2-8 · bundle de /dashboard/ruta ─────────────────────────────
describe("P2-8 · el globo no arrastra vendor-posthog y el PDF baja menos", () => {
  it("preact (lo usan el globo y PostHog) va en su propio chunk, antes que PostHog y Sentry", () => {
    expect(vendorChunk(nm("preact"))).toBe("vendor-preact");
    const rank = (n: string) => VENDOR_GROUPS.findIndex(([g]) => g === n);
    expect(rank("vendor-preact")).toBeGreaterThanOrEqual(0);
    expect(rank("vendor-preact")).toBeLessThan(rank("vendor-posthog"));
    expect(rank("vendor-preact")).toBeLessThan(rank("vendor-sentry"));
    expect(vendorChunk(nm("posthog-js"))).toBe("vendor-posthog");
  });
  it("jsPDF se queda en vendor-pdf; html2canvas, canvg y DOMPurify (opcionales de jsPDF) se bajan aparte, solo si jsPDF los pide", () => {
    for (const p of ["jspdf", "jspdf-autotable", "fflate", "fast-png"]) expect(vendorChunk(nm(p)), p).toBe("vendor-pdf");
    for (const p of ["html2canvas", "css-line-break", "dompurify"]) expect(vendorChunk(nm(p)), p).toBe("vendor-pdf-html");
    for (const p of ["canvg", "core-js", "svg-pathdata", "stackblur-canvas"]) expect(vendorChunk(nm(p)), p).toBe("vendor-pdf-svg");
  });
});
