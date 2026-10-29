// Ronda 4 de la auditoría de cuenta y técnica en producción (29-oct-2026), sección 3 (P2). Cada prueba
// nombra el número del defecto y falla con el código anterior a esta rama (claude/fix-cuenta-r4).
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { render, screen, fireEvent, within, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/integrations/supabase/client", () => {
  const api: any = {
    select: () => api, eq: () => api, order: () => api, limit: () => api, in: () => api,
    maybeSingle: async () => ({ data: null, error: null }), single: async () => ({ data: null, error: null }),
    then: (r: any) => Promise.resolve({ data: [], error: null }).then(r),
  };
  return {
    supabase: {
      from: () => api, rpc: async () => ({ data: null, error: null }),
      functions: { invoke: vi.fn(async () => ({ data: null, error: null })) },
      auth: { signInWithOAuth: vi.fn(async () => ({ error: null })), resetPasswordForEmail: async () => ({ error: null }) },
      channel: () => ({ on: function () { return this; }, subscribe: function () { return this; } }), removeChannel: () => {},
    },
  };
});
const auth = vi.hoisted(() => ({ value: { user: null as any, signIn: vi.fn(), signUp: vi.fn(async () => ({ error: null })), signOut: vi.fn() } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => auth.value }));
vi.mock("@/lib/referral", () => ({ claimPendingReferral: async () => {} }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/analytics", () => ({ track: () => {}, initAnalytics: vi.fn(), optOutAnalytics: vi.fn() }));
vi.mock("@/hooks/useSubscription", () => ({ useSubscription: () => ({ loading: false, isPro: true, isComped: true }) }));
vi.mock("@/components/NotificationBell", () => ({ NotificationBell: () => null }));

import Auth from "@/pages/Auth";
import { Ayuda } from "@/pages/Legal";
import { DashboardLayout, hasMoreBelow, mobileMoreNav } from "@/components/DashboardLayout";
import { titleForPath } from "@/lib/routeTitles";
import { screenName } from "../../supabase/functions/_shared/opinion";
import { WrappedPromoCard } from "@/components/wrapped/WrappedPromo";
import { profileCountsText, resolveVisitCount } from "@/lib/travelDna";
import {
  CACHE_TTL_SECONDS, PEXELS_EMPTY_TTL_SECONDS, cachePut, memoryCacheStore, responseTtlSeconds,
} from "../../supabase/functions/_shared/serpCache";

const src = (p: string) => readFileSync(p, "utf8");
// La casilla de Términos (Radix) mide su tamaño con ResizeObserver; jsdom no lo trae.
if (!(globalThis as any).ResizeObserver) {
  (globalThis as any).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
}

describe("P2-1 · Registro: el aviso de cookies no tapa «Crear cuenta» a 390 px", () => {
  it("en el celular el encabezado, la presentación y la forma usan espaciado compacto (y el de siempre desde sm)", () => {
    auth.value.user = null;
    render(<MemoryRouter initialEntries={["/auth?mode=signup"]}><Auth /></MemoryRouter>);
    expect(screen.getByRole("button", { name: "Crear cuenta" })).toBeInTheDocument();
    const header = screen.getByTestId("auth-header");
    expect(header.className).toMatch(/(^| )py-3( |$)/);
    expect(header.className).toContain("sm:py-6");
    const form = screen.getByTestId("auth-form");
    expect(form.className).toMatch(/(^| )p-5( |$)/);
    expect(form.className).toContain("sm:p-8");
    expect(form.className).toMatch(/(^| )space-y-4( |$)/);
    const h1 = screen.getByRole("heading", { level: 1, name: "Crea tu cuenta" });
    expect(h1.className).toMatch(/(^| )text-3xl( |$)/);
    expect(h1.parentElement!.className).toMatch(/(^| )mb-5( |$)/);
  });
});

describe("P2-2 · Ayuda no promete el buzón «al pie de cada pantalla» (Privé no lo tiene)", () => {
  it("dice dónde está de verdad: «Más», el menú lateral y el pie de las pantallas principales", () => {
    auth.value.user = null;
    const { container } = render(<MemoryRouter initialEntries={["/ayuda"]}><Ayuda /></MemoryRouter>);
    expect(container.textContent).not.toMatch(/al pie de cada pantalla/);
    expect(container.textContent).toMatch(/al pie de las pantallas principales/);
  });

  it("pie de /ayuda: el «·» no queda suelto en el celular (solo se ve desde sm)", () => {
    auth.value.user = null;
    const { container } = render(<MemoryRouter initialEntries={["/ayuda"]}><Ayuda /></MemoryRouter>);
    const footer = container.querySelector("main footer")!;
    const dots = Array.from(footer.querySelectorAll("span")).filter((s) => s.textContent?.trim() === "·");
    expect(dots.length).toBe(1);
    expect(dots[0].className).toMatch(/(^| )hidden( |$)/);
    expect(dots[0].className).toContain("sm:inline");
    expect(dots[0]).toHaveAttribute("aria-hidden", "true");
  });
});

describe("P2-3 · Menú lateral a 1366×768 y 1280×720", () => {
  const renderLayout = () => {
    auth.value.user = { id: "u1", email: "sofia@example.test" };
    return render(<MemoryRouter initialEntries={["/dashboard"]}><DashboardLayout><div>PAGINA</div></DashboardLayout></MemoryRouter>);
  };

  it("hasMoreBelow: avisa solo si queda contenido debajo de lo visible", () => {
    expect(hasMoreBelow({ scrollHeight: 600, clientHeight: 400, scrollTop: 0 })).toBe(true);
    expect(hasMoreBelow({ scrollHeight: 600, clientHeight: 400, scrollTop: 200 })).toBe(false);
    expect(hasMoreBelow({ scrollHeight: 400, clientHeight: 400, scrollTop: 0 })).toBe(false);
    expect(hasMoreBelow(null)).toBe(false);
  });

  it("si las secciones no caben se ve «Más secciones» y se quita al llegar al final; no se quita ningún enlace", () => {
    renderLayout();
    const nav = screen.getByTestId("sidebar-nav");
    expect(within(nav).getAllByRole("link").map((a) => a.textContent)).toEqual([
      "Inicio", "Mis viajes", "Cerca de ti", "Favoritos", "Recuerdos", "Social", "Gastos", "Mis reservas", "Documentos y tarjetas", "Concierge",
    ]);
    expect(screen.queryByTestId("sidebar-more-hint")).toBeNull(); // jsdom: todo cabe (0 de alto)
    let top = 0;
    Object.defineProperty(nav, "scrollHeight", { configurable: true, get: () => 520 });
    Object.defineProperty(nav, "clientHeight", { configurable: true, get: () => 380 });
    Object.defineProperty(nav, "scrollTop", { configurable: true, get: () => top });
    act(() => { fireEvent.scroll(nav); });
    expect(screen.getByTestId("sidebar-more-hint")).toHaveTextContent("Más secciones");
    top = 140;
    act(() => { fireEvent.scroll(nav); });
    expect(screen.queryByTestId("sidebar-more-hint")).toBeNull();
  });

  it("en pantallas bajas el espaciado se compacta (enlaces, logo, tarjeta) para que quepan todas las secciones", () => {
    renderLayout();
    const nav = screen.getByTestId("sidebar-nav");
    for (const a of within(nav).getAllByRole("link")) {
      expect(a.className).toContain("[@media(min-height:741px)_and_(max-height:820px)]:py-1.5");
      expect(a.className).toContain("[@media(max-height:740px)]:py-1");
    }
    expect(nav.className).toContain("min-h-0");
    const card = screen.getByTestId("sidebar-member-card");
    expect(card.className).toContain("shrink-0");
    expect(screen.getByRole("link", { name: "IATOS" }).className).toContain("[@media(max-height:820px)]:pt-4");
  });
});

describe("P2-5 · Un solo nombre por sección", () => {
  it("Gastos: «Más», lateral, título de la pestaña y buzón dicen «Gastos»", () => {
    expect(mobileMoreNav.find((n) => n.to === "/dashboard/gastos")?.label).toBe("Gastos");
    expect(titleForPath("/dashboard/gastos")).toBe("Gastos · IATOS");
    expect(screenName("/dashboard/gastos")).toBe("Gastos");
    expect(src("src/pages/Gastos.tsx")).toMatch(/<h1[^>]*>Gastos<\/h1>/);
    expect(src("src/components/DashboardLayout.tsx")).not.toMatch(/Gastos y ahorro/);
  });

  it("Ferries: Inicio, pestaña y buzón dicen «Ferries» (no «Ferris»)", () => {
    expect(titleForPath("/dashboard/ferries")).toBe("Ferries · IATOS");
    expect(screenName("/dashboard/ferries")).toBe("Ferries");
    expect(src("src/pages/DashboardHome.tsx")).toMatch(/label: "Ferries"/);
  });

  it("Solo para miembros: el buzón usa el mismo nombre que la pestaña del Concierge", () => {
    expect(screenName("/dashboard/members")).toBe("Solo para miembros");
  });
});

describe("P2-6 · Perfil: texto en 2 líneas en vez de cortado a 390 px", () => {
  it("WrappedPromo: el subtítulo usa 2 líneas (line-clamp-2), no truncate", () => {
    render(<MemoryRouter><WrappedPromoCard promo={{ featured: false, title: "Tu 2026 en viajes, hasta hoy", subtitle: "Tu resumen del año: viajes, lugares y momentos", href: "/wrapped" } as any} /></MemoryRouter>);
    const sub = screen.getByTestId("wrapped-promo-subtitle");
    expect(sub).toHaveTextContent("Tu resumen del año: viajes, lugares y momentos");
    expect(sub.className).toContain("line-clamp-2");
    expect(sub.className).not.toMatch(/(^| )truncate( |$)/);
  });

  it("Amigos: «Tu actividad» y «Tus viajes» usan 2 líneas en vez de truncate", () => {
    const s = src("src/components/social/FriendsPrivacySection.tsx");
    expect(s).toMatch(/className="text-sm line-clamp-2 break-words" data-testid="own-activity-headline">\{activityHeadline\(i\)\}/);
    expect(s).toMatch(/className="text-sm line-clamp-2 break-words" title=\{t\.destino\} data-testid="own-trip-name">\{t\.nombre\}/);
    expect(s).not.toMatch(/text-sm truncate">\{activityHeadline/);
    expect(s).not.toMatch(/text-sm truncate" title=\{t\.destino\}/);
    // Los tipos de lugar bajan de renglón en vez de salirse de la tarjeta ("Lugar" se cortaba a 390 px).
    expect(s).toMatch(/className="flex flex-wrap gap-1" role="group" aria-label="Tipo de lugar"/);
  });
});

describe("P2-7 · Perfil: conteos claros y respaldo de lugares", () => {
  it("separa viajes hechos y planeados y dice «lugares visitados»", () => {
    expect(profileCountsText({ viajesHechos: 0, viajesPlaneados: 24, visitCount: 0 })).toBe("0 viajes hechos · 24 planeados · 0 lugares visitados");
    expect(profileCountsText({ viajesHechos: 1, viajesPlaneados: 1, visitCount: 1 })).toBe("1 viaje hecho · 1 planeado · 1 lugar visitado");
    // Sin el desglose (datos viejos): lo que no es hecho es planeado.
    expect(profileCountsText({ tripCount: 3, visitCount: 5 })).toBe("0 viajes hechos · 3 planeados · 5 lugares visitados");
    expect(src("src/pages/Profile.tsx")).toMatch(/\$\{profileCountsText\(dna\)\} · tu perfil evoluciona/);
    expect(src("src/pages/Profile.tsx")).not.toMatch(/\$\{dna\.tripCount\} viajes · \$\{dna\.visitCount\} lugares/);
  });

  it("visit_count = 0 (valor por defecto) no tapa el conteo real de lugares visitados", () => {
    expect(resolveVisitCount(0, 4)).toBe(4);
    expect(resolveVisitCount(null, 4)).toBe(4);
    expect(resolveVisitCount(undefined, 2)).toBe(2);
    expect(resolveVisitCount(7, 4)).toBe(7);
    expect(resolveVisitCount("3", 0)).toBe(3);
    expect(resolveVisitCount(0, 0)).toBe(0);
    expect(src("src/components/lux/TravelDNAStats.tsx")).not.toMatch(/visit_count \?\? core\.lugares/);
  });
});

describe("P2-4 · pexels-image: «sin foto» se guarda 1 h, no 7 días", () => {
  it("responseTtlSeconds: foto vacía de Pexels → 1 h; con foto → 7 días; otros motores sin cambio", () => {
    expect(PEXELS_EMPTY_TTL_SECONDS).toBe(3600);
    expect(responseTtlSeconds("pexels_photo", { image: null, photographer: null })).toBe(3600);
    expect(responseTtlSeconds("pexels_photo", { image: "https://images.pexels.com/x.jpg" })).toBe(7 * 86400);
    expect(responseTtlSeconds("google_maps", { image: null })).toBe(CACHE_TTL_SECONDS.google_maps);
    expect(responseTtlSeconds("pexels_video", { url: null })).toBe(CACHE_TTL_SECONDS.pexels_video);
  });

  it("cachePut guarda la respuesta vacía con el TTL corto", async () => {
    const store = memoryCacheStore();
    await cachePut(store, "k1", "pexels_photo", { image: null });
    await cachePut(store, "k2", "pexels_photo", { image: "https://images.pexels.com/x.jpg" });
    expect(store.rows.get("k1")?.ttl_seconds).toBe(3600);
    expect(store.rows.get("k2")?.ttl_seconds).toBe(7 * 86400);
  });

  it("la función responde «sin foto» con caché de navegador corta y la migración limpia lo guardado", () => {
    const fn = src("supabase/functions/pexels-image/index.ts");
    expect(fn).toMatch(/'Cache-Control': image \? 'public, max-age=86400' : `public, max-age=\$\{PEXELS_EMPTY_TTL_SECONDS\}`/);
    const mig = src("supabase/migrations/20261029070000_pexels_sin_foto.sql");
    expect(mig).toMatch(/DELETE FROM public\.serp_cache/);
    expect(mig).toMatch(/engine LIKE 'pexels%'/);
    expect(mig).toMatch(/jsonb_typeof\(response -> 'image'\) = 'null'/);
    expect(mig).not.toMatch(/\b(UPDATE|INSERT|DROP|TRUNCATE|ALTER)\b/);
    expect(src("supabase/tests/run_all.sh")).toMatch(/ opiniones pexels_sin_foto\)/);
  });
});
