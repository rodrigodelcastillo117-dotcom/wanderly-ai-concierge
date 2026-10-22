// Rendimiento (cierre 2026-10): carga de la app en móvil / red lenta. Fija lo que se midió con
// Playwright + Fast 3G + CPU 4× (docs/iatos/cierre/RENDIMIENTO.md) para que no se pierda:
//   - paquete inicial sin Radix completo, sin React Query, sin Tooltip/Toaster de Radix;
//   - íconos en un solo chunk; Radix por pantalla;
//   - tipografías propias con precarga (sin @import a Google Fonts);
//   - la pantalla inicial (y la imagen principal del inicio) se piden desde el HTML;
//   - fotos al ancho de la caja; hero del inicio sin 1920 px en el teléfono;
//   - sin saltos de diseño en el inicio mientras cargan los datos;
//   - el onboarding terminado no bloquea la pantalla con una consulta en cada apertura;
//   - el service worker guarda el arranque al instalarse.
import React from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import { sizedPhotoUrl } from "@/lib/imageSizing";
import { INITIAL_ROUTE_PAGES, routePreloadMap, routePreloadScript, type BundleLike } from "../../vite.routePreload";
import { vendorChunk } from "../../vite.chunks";

const root = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const nm = (p: string) => `/app/node_modules/${p}/dist/esm/index.js`;

describe("paquete inicial", () => {
  it("App.tsx no trae React Query, TooltipProvider ni el Toaster de Radix de forma estática", () => {
    const app = read("src/App.tsx");
    expect(app).not.toMatch(/from "@tanstack\/react-query"/);
    expect(app).not.toMatch(/TooltipProvider/);
    expect(app).not.toMatch(/from "@\/components\/ui\/toaster"/);
    expect(app).toMatch(/<LazyToaster \/>/);
    expect(read("src/components/ui/toaster-lazy.tsx")).toMatch(/import\("@\/components\/ui\/toaster"\)/);
    // El estado de los avisos no importa Radix (solo tipos).
    expect(read("src/hooks/use-toast.ts")).toMatch(/^import type \{[^}]+\} from "@\/components\/ui\/toast";/m);
  });

  it("Radix: solo el Slot va al chunk compartido; el resto lo reparte Rollup por pantalla. Íconos en un chunk", () => {
    expect(vendorChunk(nm("@radix-ui/react-slot"))).toBe("vendor-radix");
    expect(vendorChunk(nm("@radix-ui/react-compose-refs"))).toBe("vendor-radix");
    for (const p of ["@radix-ui/react-dialog", "@radix-ui/react-tooltip", "@radix-ui/react-toast", "@radix-ui/react-slider", "@floating-ui/dom", "react-remove-scroll"]) {
      expect(vendorChunk(nm(p)), p).toBeUndefined();
    }
    expect(vendorChunk("/app/node_modules/lucide-react/dist/esm/icons/plane.js")).toBe("vendor-icons");
  });

  it("Tooltip funciona sin un TooltipProvider global", async () => {
    const { Tooltip, TooltipTrigger, TooltipContent } = await import("@/components/ui/tooltip");
    render(<Tooltip><TooltipTrigger>i</TooltipTrigger><TooltipContent>ayuda</TooltipContent></Tooltip>);
    expect(screen.getByText("i")).toBeInTheDocument();
  });
});

describe("Toaster de Radix perezoso", () => {
  it("no se monta hasta el primer toast(); el aviso que llegó mientras se descargaba se muestra", async () => {
    const { LazyToaster } = await import("@/components/ui/toaster-lazy");
    const { toast } = await import("@/hooks/use-toast");
    const { container } = render(<LazyToaster />);
    expect(container.innerHTML).toBe("");
    act(() => { toast({ title: "Guardado", description: "Listo" }); });
    expect(await screen.findByText("Guardado")).toBeInTheDocument();
  });
});

describe("tipografías", () => {
  it("sin @import a Google Fonts: @font-face propias con swap, archivos presentes y precargados", () => {
    const css = read("src/index.css");
    expect(css).not.toMatch(/fonts\.googleapis\.com/);
    const faces = [...css.matchAll(/@font-face\s*\{([^}]+)\}/g)].map((m) => m[1]);
    expect(faces.length).toBe(4);
    for (const f of faces) {
      expect(f).toMatch(/font-display:\s*swap/);
      const url = /url\('([^']+)'\)/.exec(f)![1];
      expect(existsSync(join(root, "public", url)), url).toBe(true);
    }
    const html = read("index.html");
    expect(html).toMatch(/<link rel="preload" href="\/fonts\/manrope-latin-v20\.woff2" as="font" type="font\/woff2" crossorigin \/>/);
    expect(html).toMatch(/<link rel="preload" href="\/fonts\/fraunces-latin-v38\.woff2" as="font" type="font\/woff2" crossorigin \/>/);
  });
});

describe("precarga de la pantalla inicial desde el HTML", () => {
  const bundle: BundleLike = {
    "assets/index.js": { type: "chunk", fileName: "assets/index.js", imports: ["assets/vendor-core.js"], isEntry: true, facadeModuleId: "/app/src/main.tsx" },
    "assets/vendor-core.js": { type: "chunk", fileName: "assets/vendor-core.js", imports: [] },
    "assets/DashboardHome.js": { type: "chunk", fileName: "assets/DashboardHome.js", imports: ["assets/DashboardLayout.js", "assets/vendor-core.js"], facadeModuleId: "/app/src/pages/DashboardHome.tsx" },
    "assets/DashboardLayout.js": { type: "chunk", fileName: "assets/DashboardLayout.js", imports: ["assets/sheet.js"] },
    "assets/sheet.js": { type: "chunk", fileName: "assets/sheet.js", imports: ["assets/vendor-core.js"] },
    "assets/TripDetail.js": { type: "chunk", fileName: "assets/TripDetail.js", imports: ["assets/sheet.js"], facadeModuleId: "/app/src/pages/TripDetail.tsx" },
    "assets/hero-960.jpg": { type: "asset", fileName: "assets/hero-santorini-960-abc.jpg", name: "hero-santorini-960.jpg" },
    "assets/hero.jpg": { type: "asset", fileName: "assets/hero-santorini-def.jpg", name: "hero-santorini.jpg" },
  };

  it("cada ruta lleva su chunk y sus imports estáticos, sin repetir el paquete inicial", () => {
    const map = routePreloadMap(bundle);
    const dash = map.find(([re]) => re === "^/dashboard/?$")!;
    expect(dash[1]).toEqual(["/assets/DashboardHome.js", expect.any(String), expect.any(String)]);
    expect(new Set(dash[1])).toEqual(new Set(["/assets/DashboardHome.js", "/assets/DashboardLayout.js", "/assets/sheet.js"]));
    expect(dash[2]).toEqual({ srcset: "/assets/hero-santorini-960-abc.jpg 960w, /assets/hero-santorini-def.jpg 1920w", sizes: "(min-width: 768px) 100vw, 320px" });
    expect(map.find(([re]) => re.includes("viajes/[^/]+"))![1]).toEqual(["/assets/TripDetail.js", "/assets/sheet.js"]);
  });

  const runScript = (path: string) => {
    const links: Record<string, string>[] = [];
    const document = {
      head: { appendChild: (l: any) => links.push({ rel: l.rel, href: l.href, attrs: JSON.stringify(l.attrs ?? {}) }) },
      createElement: () => ({ attrs: {} as Record<string, string>, setAttribute(k: string, v: string) { this.attrs[k] = v; } }),
    };
    vm.runInNewContext(routePreloadScript(routePreloadMap(bundle)), { document, location: { pathname: path }, RegExp, JSON });
    return links;
  };

  it("el script en línea solo precarga la ruta con la que se abrió la app", () => {
    const dash = runScript("/dashboard");
    expect(dash.filter((l) => l.rel === "modulepreload").map((l) => l.href)).toContain("/assets/DashboardHome.js");
    expect(dash.find((l) => l.rel === "preload")?.attrs).toMatch(/hero-santorini-960-abc\.jpg 960w/);
    expect(runScript("/dashboard/viajes/123").map((l) => l.href)).toEqual(["/assets/TripDetail.js", "/assets/sheet.js"]);
    expect(runScript("/")).toEqual([]);
    expect(runScript("/dashboard/gastos")).toEqual([]);
  });

  it("la tabla del build coincide con la de App.tsx (import() en tiempo de ejecución)", () => {
    const app = read("src/App.tsx");
    for (const [re, page] of INITIAL_ROUTE_PAGES) {
      const name = page.replace(/^src\/pages\/|\.tsx$/g, "");
      expect(app, page).toContain(`const load${name} = () => import("./pages/${name}");`);
      const escaped = re.replace(/\//g, "\\/");
      expect(app, re).toContain(`[/${escaped}/, load${name}]`);
    }
    expect(read("src/main.tsx")).toMatch(/preloadInitialRoute\(window\.location\.pathname\)/);
  });

  it("la imagen precargada usa los mismos sizes que el hero del inicio", () => {
    const home = read("src/pages/DashboardHome.tsx");
    const sizes = /const HERO_SIZES = "([^"]+)"/.exec(home)![1];
    expect(INITIAL_ROUTE_PAGES[0][2]!.sizes).toBe(sizes);
    expect(home).toMatch(/sizes=\{HERO_SIZES\}/);
  });
});

describe("fotos al ancho de la caja", () => {
  it("Google: achica el sufijo =w/=s; deja igual lo que ya es chico o no trae tamaño", () => {
    expect(sizedPhotoUrl("https://lh3.googleusercontent.com/grass-cs/AABk=w1600-h900-k-no", 800)).toBe("https://lh3.googleusercontent.com/grass-cs/AABk=w800-k-no");
    expect(sizedPhotoUrl("https://lh3.googleusercontent.com/place-photos/abc=s4800-w1200", 240)).toBe("https://lh3.googleusercontent.com/place-photos/abc=w240-k-no");
    expect(sizedPhotoUrl("https://lh3.googleusercontent.com/place-photos/abc=s800", 800)).toBe("https://lh3.googleusercontent.com/place-photos/abc=s800");
    expect(sizedPhotoUrl("https://lh3.googleusercontent.com/place-photos/abc", 800)).toBe("https://lh3.googleusercontent.com/place-photos/abc");
  });
  it("Pexels y Unsplash: w (y h proporcional); otros dominios intactos", () => {
    expect(sizedPhotoUrl("https://images.pexels.com/photos/1/p.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200", 800))
      .toBe("https://images.pexels.com/photos/1/p.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=418&w=800");
    expect(sizedPhotoUrl("https://images.unsplash.com/photo-1?w=600&q=70", 320)).toBe("https://images.unsplash.com/photo-1?w=320&q=70");
    expect(sizedPhotoUrl("https://images.pexels.com/photos/1/pasta.jpeg", 240)).toBe("https://images.pexels.com/photos/1/pasta.jpeg");
    expect(sizedPhotoUrl("https://example.com/a.jpg?w=2000", 100)).toBe("https://example.com/a.jpg?w=2000");
    expect(sizedPhotoUrl("http://lh3.googleusercontent.com/x=w1600", 100)).toBe("http://lh3.googleusercontent.com/x=w1600");
  });

  it("SmartImage pide la portada del viaje a 800 px y, si ese tamaño fallara, reintenta con la original", async () => {
    const { SmartImage } = await import("@/components/media/SmartImage");
    const url = "https://lh3.googleusercontent.com/grass-cs/AABk=w1600-h900-k-no";
    render(<SmartImage alt="Portada" imageUrl={url} size="hero" eager />);
    const img = await screen.findByAltText("Portada");
    expect(img).toHaveAttribute("src", "https://lh3.googleusercontent.com/grass-cs/AABk=w800-k-no");
    act(() => { img.dispatchEvent(new Event("error")); });
    await waitFor(() => expect(screen.getByAltText("Portada")).toHaveAttribute("src", url));
  });
});

describe("inicio sin saltos de diseño", () => {
  it("el hero ocupa su lugar mientras cargan los viajes y el esqueleto mide como el centro de mando", () => {
    const home = read("src/pages/DashboardHome.tsx");
    expect(home).toMatch(/\{\(hasTrips \|\| active\.loading\) && \(/);
    expect(home).toMatch(/aria-label="Cargando tu viaje" className="[^"]*min-h-\[460px\]/);
    // Imágenes de abajo del pliegue con prioridad baja; el hero con prioridad alta y sin lazy.
    expect(home).toMatch(/fallbackImage=\{tulum640\} lowPriority/);
    expect(home).toMatch(/fallbackSrcSet=\{fallbackSrcSet\(HERO_REELS\[reelIdx\]\.fallback\)\}[\s\S]{0,80}priority/);
  });
});

// ═══ Onboarding recordado ═══
const onbRow: any = {};
let onbError: { message: string } | null = null;
const qb: any = { select: () => qb, eq: () => qb, upsert: async () => ({ error: null }), maybeSingle: async () => {
  await new Promise((r) => setTimeout(r, 30)); // la consulta tarda (red lenta)
  return onbError ? { data: null, error: onbError } : { data: { ...onbRow }, error: null };
} };
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: () => qb, functions: { invoke: async () => ({ data: null, error: null }) } } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u-rend" }, loading: false }) }));
vi.mock("@/lib/analytics", () => ({ track: () => {} }));

describe("onboarding terminado: la guardia no espera la consulta en cada apertura", () => {
  beforeEach(() => {
    localStorage.clear();
    onbError = null;
    Object.assign(onbRow, { user_id: "u-rend", completed_onboarding: true, current_step: 5, selected_cards: [], selected_loyalty_airlines: [], selected_loyalty_hotels: [], travel_dna_seed: null, completed_at: null });
  });
  afterEach(() => localStorage.clear());

  const mount = async () => {
    const { ProtectedRoute } = await import("@/components/ProtectedRoute");
    const { OnboardingProvider } = await import("@/hooks/useOnboardingStatus");
    const { Routes, Route } = await import("react-router-dom");
    return render(
      <MemoryRouter initialEntries={["/dashboard"]}>
        <OnboardingProvider>
          <Routes>
            <Route path="/dashboard" element={<ProtectedRoute><p>INICIO</p></ProtectedRoute>} />
            <Route path="/onboarding" element={<p>ONBOARDING</p>} />
          </Routes>
        </OnboardingProvider>
      </MemoryRouter>,
    );
  };

  it("primera vez: espera la consulta y luego recuerda que ya terminó", async () => {
    await mount();
    expect(screen.queryByText("INICIO")).toBeNull();
    expect(await screen.findByText("INICIO")).toBeInTheDocument();
    expect(localStorage.getItem("iatos_onb_done_v1:u-rend")).toBe("1");
  });

  it("siguientes aperturas: la pantalla aparece sin esperar la consulta (que se hace igual)", async () => {
    localStorage.setItem("iatos_onb_done_v1:u-rend", "1");
    await mount();
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(screen.getByText("INICIO")).toBeInTheDocument();
  });

  it("si el servidor dice que no está terminado, la guardia redirige y se olvida lo recordado", async () => {
    localStorage.setItem("iatos_onb_done_v1:u-rend", "1");
    onbRow.completed_onboarding = false;
    await mount();
    expect(await screen.findByText("ONBOARDING")).toBeInTheDocument();
    expect(localStorage.getItem("iatos_onb_done_v1:u-rend")).toBeNull();
  });

  it("sin red: quien ya terminó no es mandado de vuelta al onboarding", async () => {
    localStorage.setItem("iatos_onb_done_v1:u-rend", "1");
    onbError = { message: "Failed to fetch" };
    await mount();
    await act(async () => { await new Promise((r) => setTimeout(r, 60)); });
    expect(screen.getByText("INICIO")).toBeInTheDocument();
    expect(screen.queryByText("ONBOARDING")).toBeNull();
  });
});

// ═══ Service worker: arranque guardado al instalar ═══
describe("service worker", () => {
  it("al instalar guarda el JS de entrada, los modulepreload, el CSS y las tipografías que pide index.html", async () => {
    const code = read("public/sw.js");
    const store = new Map<string, Response>();
    const keyOf = (k: any) => (typeof k === "string" ? new URL(k, "https://app.test").href : k.url);
    const html = `<html><head><link rel="preload" href="/fonts/manrope-latin-v20.woff2" as="font"><script type="module" crossorigin src="/assets/index-AB.js"></script><link rel="modulepreload" crossorigin href="/assets/vendor-core-CD.js"><link rel="stylesheet" crossorigin href="/assets/index-EF.css"><script>var m=[["^/dashboard",["/assets/DashboardHome-X.js"]]]</script></head></html>`;
    const cache = {
      add: async (u: any) => { const k = keyOf(u); store.set(k, new Response(k.endsWith("/") ? html : "x")); },
      put: async () => {}, delete: async () => true, keys: async () => [], match: async (k: any) => store.get(keyOf(k)),
    };
    const caches = { open: async () => cache, keys: async () => [], delete: async () => true, match: async () => undefined };
    const handlers: Record<string, (e: any) => void> = {};
    const self: any = { location: { origin: "https://app.test" }, addEventListener: (t: string, h: any) => { handlers[t] = h; }, skipWaiting: async () => {}, clients: { claim: async () => {} } };
    // Request del SW: las rutas relativas se resuelven contra el origen de la app.
    class SwRequest { url: string; cache?: string; constructor(u: string, o?: { cache?: string }) { this.url = new URL(u, "https://app.test").href; this.cache = o?.cache; } }
    vm.runInNewContext(code, { self, caches, fetch: async () => new Response(""), URL, Response, Request: SwRequest, Promise, console, encodeURIComponent, Set });
    const waits: Promise<unknown>[] = [];
    handlers.install({ waitUntil: (p: Promise<unknown>) => waits.push(p) });
    await Promise.all(waits);
    const keys = [...store.keys()].map((k) => new URL(k).pathname);
    expect(keys).toEqual(expect.arrayContaining(["/", "/assets/index-AB.js", "/assets/vendor-core-CD.js", "/assets/index-EF.css", "/fonts/manrope-latin-v20.woff2"]));
    // Lo que el script de precarga menciona dentro de un string NO es parte del arranque.
    expect(keys).not.toContain("/assets/DashboardHome-X.js");
  });
});
