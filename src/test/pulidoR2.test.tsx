// Ronda 2 de la auditoría de cuenta y técnica en producción (29-oct-2026), sección 3 (P2). Cada prueba
// nombra el número del defecto y falla con el código anterior a esta rama (claude/fix-pulido-r2).
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/integrations/supabase/client", () => {
  const api: any = { select: () => api, eq: () => api, maybeSingle: async () => ({ data: null, error: null }) };
  return {
    supabase: {
      from: () => api, rpc: async () => ({ data: null, error: null }),
      functions: { invoke: vi.fn(async () => ({ data: null, error: null })) },
      auth: { signInWithOAuth: vi.fn(async () => ({ error: null })), resetPasswordForEmail: async () => ({ error: null }) },
    },
  };
});
const auth = vi.hoisted(() => ({ value: { user: null as any, signIn: vi.fn(async () => ({ error: { message: "Invalid login credentials" } })), signUp: vi.fn(async () => ({ error: null as any })), signOut: vi.fn() } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => auth.value }));
vi.mock("@/lib/referral", () => ({ claimPendingReferral: async () => {} }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
vi.mock("@/lib/analytics", () => ({ track: () => {}, initAnalytics: vi.fn(), optOutAnalytics: vi.fn() }));

import Auth from "@/pages/Auth";
import { CookieBanner, bottomBarOffset } from "@/components/CookieBanner";
import { Ayuda, Terminos } from "@/pages/Legal";
import { DNA_LABELS } from "@/lib/social";
import { INITIAL_ROUTE_CHUNKS } from "@/lib/routeChunks";
import { INITIAL_ROUTE_PAGES } from "../../vite.routePreload";
import * as SERVER from "../../supabase/functions/_shared/booking/allowlist";
import * as CLIENT from "@/lib/bookingAllowlist";
import { PSL_ICANN, PSL_PRIVATE } from "../../supabase/functions/_shared/booking/psl_data";
import { buildClientAllowlistSource, CLIENT_ALLOWLIST_DATA_PATH } from "../../scripts/booking/clientAllowlistGen";
import { clientAllowlist, CLIENT_ALLOWLIST, SERVER_ALLOWLIST } from "../../vite.clientAllowlist";
import { googleLoginEnabled } from "@/lib/googleLogin";
import { travelpayoutsDriveEnabled } from "@/lib/consent";
import { supabase } from "@/integrations/supabase/client";
import { fetchPlacePhotoUrl, resolvePlacePhotoUrl, cachedPlacePhoto, __resetPlacePhotoCache } from "@/lib/placePhoto";
import { photoCacheControl, PHOTO_CACHE_SECONDS } from "../../supabase/functions/_shared/placePhotoCache";
import { iatoMarkHtml, shell, para, SERIF } from "../../supabase/functions/_shared/email-kit";
import { userConfirmedEmail } from "../../supabase/functions/_shared/ai-reservations/templates";

const src = (p: string) => readFileSync(p, "utf8");

beforeEach(() => {
  localStorage.clear();
  toast.error.mockClear();
  auth.value.signUp.mockClear();
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("P2-1 · el aviso de cookies no tapa 'Empezar gratis' ni la barra inferior", () => {
  it("se coloca encima de la barra inferior fija (el relleno del body no mueve elementos fijos)", () => {
    vi.stubGlobal("innerHeight", 844);
    const nav = document.createElement("nav");
    nav.setAttribute("data-bottom-nav", "");
    document.body.appendChild(nav);
    vi.spyOn(nav, "getBoundingClientRect").mockReturnValue({ top: 766, bottom: 844, height: 78, width: 390, left: 0, right: 390, x: 0, y: 766, toJSON: () => ({}) } as DOMRect);
    expect(bottomBarOffset()).toBe(78);
    render(<MemoryRouter><CookieBanner /></MemoryRouter>);
    const box = screen.getByTestId("cookie-banner");
    expect(box.style.bottom).toBe("78px");
    // Sin barra (landing, escritorio): pegado abajo y respetando la zona segura del iPhone.
    nav.remove();
    expect(bottomBarOffset()).toBe(0);
  });

  it("una barra oculta (lg:hidden en escritorio) no cuenta", () => {
    const nav = document.createElement("nav");
    nav.setAttribute("data-bottom-nav", "");
    document.body.appendChild(nav);
    vi.spyOn(nav, "getBoundingClientRect").mockReturnValue({ top: 0, bottom: 0, height: 0, width: 0, left: 0, right: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect);
    expect(bottomBarOffset()).toBe(0);
    nav.remove();
  });

  it("en el celular usa un texto corto y la barra del panel está marcada para medirla", () => {
    render(<MemoryRouter><CookieBanner /></MemoryRouter>);
    const short = screen.getByTestId("cookie-text-short").textContent ?? "";
    expect(short.length).toBeLessThan(170);
    expect(short).toMatch(/PostHog/);
    expect(src("src/components/DashboardLayout.tsx")).toMatch(/<nav aria-label="Navegación principal" [^>]*data-bottom-nav=""/);
  });

  it("P2-4 · el enlace del aviso es descriptivo y subrayado (no 'Más información')", () => {
    render(<MemoryRouter><CookieBanner /></MemoryRouter>);
    const link = screen.getByRole("link", { name: "Política de Cookies" });
    expect(link).toHaveAttribute("href", "/cookies");
    expect(link.className).toMatch(/\bunderline\b/);
    expect(screen.queryByText("Más información")).toBeNull();
  });
});

describe("P2-2 · /auth y registro: un solo mensaje por error", () => {
  it("contraseña incorrecta: el mensaje sale en línea y NO también como aviso", async () => {
    render(<MemoryRouter initialEntries={["/auth"]}><Auth /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText(/correo/i), { target: { value: "ana@example.test" } });
    fireEvent.change(screen.getByLabelText(/contraseña/i), { target: { value: "malamala1" } });
    fireEvent.click(screen.getByRole("button", { name: "Iniciar sesión" }));
    expect(await screen.findByTestId("auth-login-error")).toHaveTextContent("Correo o contraseña incorrectos");
    expect(toast.error).not.toHaveBeenCalled();
    expect(screen.getAllByText(/Correo o contraseña incorrectos/)).toHaveLength(1);
  });

  it("registro sin casilla: un solo mensaje (en línea), sin aviso emergente", async () => {
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
    render(<MemoryRouter initialEntries={["/auth?mode=signup"]}><Auth /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText("Nombre completo"), { target: { value: "Ana" } });
    fireEvent.change(screen.getByLabelText(/correo/i), { target: { value: "ana@example.test" } });
    fireEvent.change(screen.getByLabelText(/^contraseña/i), { target: { value: "unaclave-larga-2026" } });
    fireEvent.click(screen.getByRole("button", { name: "Crear cuenta" }));
    expect(await screen.findByText(/marca la casilla de Términos/)).toBeInTheDocument();
    expect(toast.error).not.toHaveBeenCalled();
    expect(auth.value.signUp).not.toHaveBeenCalled();
  });

  it("registro: contraseña corta y error del servidor también salen una sola vez, en línea", async () => {
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
    render(<MemoryRouter initialEntries={["/auth?mode=signup"]}><Auth /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText("Nombre completo"), { target: { value: "Ana" } });
    fireEvent.change(screen.getByLabelText(/correo/i), { target: { value: "ana@example.test" } });
    fireEvent.change(screen.getByLabelText(/^contraseña/i), { target: { value: "corta" } });
    fireEvent.click(screen.getByRole("button", { name: "Crear cuenta" }));
    expect(await screen.findByTestId("auth-signup-error")).toHaveTextContent("al menos 8 caracteres");
    expect(toast.error).not.toHaveBeenCalled();

    auth.value.signUp.mockResolvedValueOnce({ error: "User already registered" });
    fireEvent.change(screen.getByLabelText(/^contraseña/i), { target: { value: "unaclave-larga-2026" } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Crear cuenta" }));
    await waitFor(() => expect(auth.value.signUp).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByTestId("auth-signup-error")).not.toHaveTextContent("al menos 8 caracteres"));
    expect(toast.error).not.toHaveBeenCalled();
  });
});

/** Cada "Iato" visible está dentro de la marca con serifa (data-iato-mark), nunca suelto en la sans. */
function bareIato(root: HTMLElement): string[] {
  const out: string[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!/\bIato\b/.test(n.textContent ?? "")) continue;
    if (!(n.parentElement?.closest("[data-iato-mark]"))) out.push((n.textContent ?? "").trim().slice(0, 60));
  }
  return out;
}

describe("P2-3 · \"Iato\" ya no se lee \"lato\"", () => {
  it("/ayuda y Términos: todos los \"Iato\" van con la serifa de marca", () => {
    const { container, unmount } = render(<MemoryRouter initialEntries={["/ayuda"]}><Ayuda /></MemoryRouter>);
    expect(container.querySelectorAll("[data-iato-mark]").length).toBeGreaterThanOrEqual(3);
    expect(bareIato(container)).toEqual([]);
    expect(container.textContent).toMatch(/Le dices a Iato, tu concierge/);
    unmount();
    const t = render(<MemoryRouter><Terminos /></MemoryRouter>);
    expect(bareIato(t.container)).toEqual([]);
  });

  it("P2-7 · Equipaje en español y con la marca; landing y pantallas de alto tráfico con la marca", () => {
    const packing = src("src/pages/TripPacking.tsx");
    expect(packing).not.toMatch(/Iato Packing/i);
    expect(packing).toMatch(/Equipaje con Iato/);
    expect(packing).toMatch(/Generar lista con <IatoName \/>/);
    expect(src("src/pages/Landing.tsx")).toMatch(/\{withIatoMark\(f\)\}/);
    for (const f of ["src/pages/Onboarding.tsx", "src/components/plan/PlanTripDialog.tsx", "src/components/reservas/AskIatoTable.tsx", "src/pages/Favoritos.tsx", "src/pages/Benefits.tsx"]) {
      expect(src(f), f).toMatch(/<IatoName \/>/);
    }
  });

  it("correos: \"Iato\" del pie y de los párrafos sans va en la serifa; el texto plano no cambia", () => {
    expect(iatoMarkHtml('Pediste a Iato. <a href="https://x.test/Iato">ver</a>')).toBe(
      `Pediste a <span style="font-family:${SERIF};font-size:1.15em;">Iato</span>. <a href="https://x.test/Iato">ver</a>`);
    expect(iatoMarkHtml("Iatos e Iatomar no se tocan")).toBe("Iatos e Iatomar no se tocan");
    const html = shell({ title: "t", preheader: "p", body: [para("Hola, soy Iato.")], reason: "Recibes este correo porque pediste a Iato que escribiera a un restaurante." });
    expect(html).toContain(`pediste a <span style="font-family:${SERIF};font-size:1.15em;">Iato</span> que escribiera`);
    expect(html).toContain(`soy <span style="font-family:${SERIF};font-size:1.15em;">Iato</span>.`);
    // Un correo real (reserva confirmada): el pie lleva la marca y el texto plano sigue igual.
    const m = userConfirmedEmail({ ref_code: "R-ABC234", venue_name: "Casa Oaxaca", requested_local: "2026-11-03T20:30", party_size: 2, customer_name: "Ana López",
      venue_address: "Constitución 104", venue_city: "Oaxaca", venue_place_id: "ChIJ_x", requested_for: "2026-11-04T02:30:00Z", confirmation_code: "MX-4821",
      quote: "Confirmado", receivedAt: "2 nov", icsUrl: null, appUrl: "https://app.test" } as any);
    expect(m.html).toMatch(/pediste a <span style="font-family:[^"]+;font-size:1\.15em;">Iato<\/span> que escribiera/);
    expect(m.text).toMatch(/pediste a Iato que escribiera/);
  });
});

describe("P2-4 · /ayuda: LCP móvil, enlaces distinguibles y \"Mi perfil\" con enlace", () => {
  it("el chunk de Ayuda y legales se pide desde el HTML y al arrancar (sin cascada index → Legal)", () => {
    for (const p of ["/ayuda", "/terminos", "/privacidad", "/cookies", "/reembolsos"]) {
      expect(INITIAL_ROUTE_CHUNKS.find(([re]) => re.test(p))?.[1].name, p).toBe("loadLegal");
      expect(INITIAL_ROUTE_PAGES.some(([re, page]) => new RegExp(re).test(p) && page === "src/pages/Legal.tsx"), p).toBe(true);
    }
    expect(INITIAL_ROUTE_CHUNKS.find(([re]) => re.test("/ayuda/extra"))).toBeUndefined();
  });

  it("\"Mi perfil\" enlaza al perfil y los enlaces del texto van subrayados; el logo reserva su tamaño", () => {
    const { container } = render(<MemoryRouter initialEntries={["/ayuda"]}><Ayuda /></MemoryRouter>);
    expect(screen.getByRole("link", { name: "Mi perfil" })).toHaveAttribute("href", "/dashboard/perfil");
    expect(container.querySelector("article")!.className).toMatch(/\[&_a\]:underline/);
    const logo = screen.getByRole("img", { name: "IATOS AI" });
    expect(logo).toHaveAttribute("width", "320");
    expect(logo).toHaveAttribute("height", "91");
  });
});

describe("P2-5 · el paquete público no lleva la lista blanca del servidor", () => {
  const CLIENT_USERS = ["src/lib/booking.ts", "src/lib/realFares.ts", "src/lib/ferryLive.ts", "src/lib/viatorTours.ts", "src/lib/tripPdfModel.ts"];
  const walk = (d: string, out: string[] = []): string[] => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p, out);
      else if (/\.(ts|tsx)$/.test(f) && !/psl_data|bookingAllowlist\.data/.test(f)) out.push(p);
    }
    return out;
  };

  it("ningún archivo de la app importa allowlist.ts del servidor; los 5 que la usaban leen la versión del navegador", () => {
    const app = walk("src").filter((f) => !f.startsWith(join("src", "test")));
    const offenders = app.filter((f) => /_shared\/booking\/allowlist(\.ts)?["']/.test(src(f)));
    expect(offenders).toEqual([]);
    for (const f of CLIENT_USERS) expect(src(f), f).toMatch(/from "@\/lib\/bookingAllowlist"/);
  });

  it("la lista del navegador está al día con la del servidor y no lleva notas internas", () => {
    expect(src(CLIENT_ALLOWLIST_DATA_PATH)).toBe(buildClientAllowlistSource(SERVER.PROVIDERS, PSL_ICANN, PSL_PRIVATE));
    const strip = ({ why: _w, ...r }: SERVER.ProviderInfo) => ({ ...r, paths: r.paths?.toString() });
    expect(CLIENT.PROVIDERS.map((p) => ({ ...p, paths: p.paths?.toString() }))).toEqual(SERVER.PROVIDERS.map(strip));
    const data = src(CLIENT_ALLOWLIST_DATA_PATH) + src("src/lib/bookingAllowlist.ts");
    expect(data).not.toMatch(/why|EV-|SerpApi|Travelpayouts \(marker|Partner API/);
    expect(src("src/lib/bookingAllowlist.ts")).not.toMatch(/psl_data|booking\/psl(\.ts)?"/);
    expect(src(CLIENT_ALLOWLIST_DATA_PATH).length).toBeLessThan(40_000);
  });

  it("en el build del navegador, los módulos compartidos que importan allowlist.ts reciben la versión del navegador", async () => {
    const root = "/repo";
    const plugin = clientAllowlist(root);
    const ctx = { resolve: async (source: string, importer?: string) => ({ id: join(importer ? importer.replace(/\/[^/]+$/, "") : root, source) }) };
    const resolved = await plugin.resolveId.call(ctx, "./allowlist.ts", `${root}/supabase/functions/_shared/booking/resolver.ts`);
    expect(resolved).toBe(join(root, CLIENT_ALLOWLIST));
    expect(await plugin.resolveId.call(ctx, "./booking/allowlist.ts", `${root}/supabase/functions/_shared/ticketmaster.ts`)).toBe(join(root, CLIENT_ALLOWLIST));
    // Otros archivos que se llamen igual no se tocan; tampoco lo que no es la lista del servidor.
    expect(await plugin.resolveId.call(ctx, "./allowlist.ts", `${root}/src/otra/cosa.ts`)).toBeNull();
    expect(await plugin.resolveId.call(ctx, "./links.ts", `${root}/supabase/functions/_shared/booking/resolver.ts`)).toBeNull();
    expect(SERVER_ALLOWLIST).toBe("supabase/functions/_shared/booking/allowlist.ts");
    expect(src("vite.config.ts")).toMatch(/plugins: \[clientAllowlist\(\),/);
  });

  /** Veredicto comparable (sin el objeto del proveedor completo: el del servidor trae `why`). */
  const key = (v: any) => JSON.stringify([v.ok, v.url, v.host, v.trust, v.provider?.provider, v.provider?.domain, v.provider?.label, v.reason]);
  const FNS = ["checkAllowlisted", "checkUntrusted", "checkTrustedSource"] as const;

  it("mismo veredicto que el servidor en todas las URLs de las pruebas y funciones, y en imitaciones de cada proveedor", () => {
    const urls = new Set<string>();
    for (const f of [...walk("src/test"), ...walk("supabase/functions")]) {
      for (const m of src(f).matchAll(/https?:\/\/[^\s"'`<>)\]\\]+/g)) urls.add(m[0]);
    }
    for (const p of SERVER.PROVIDERS) {
      const d = p.domain, l = d.split(".")[0];
      for (const u of [`https://${d}/`, `https://www.${d}/x?y=1`, `https://${l}-reservas.mx/`, `https://secure-${l}.com/`, `https://${l}.evil.io/`,
        `https://${d}.evil.io/`, `https://${l.replace(/o/g, "0").replace(/i/g, "1")}.com/`, `https://${l}s.net/`, `https://hotel-${l}.com/`,
        `https://${l}.com.mx/`, `https://${l}-pagos.wixsite.com/`, `https://tp.media/click?u=${encodeURIComponent(`https://${d}/`)}`, `http://${d}/`]) urls.add(u);
    }
    expect(urls.size).toBeGreaterThan(1500);
    const diffs: string[] = [];
    for (const u of urls) {
      for (const fn of FNS) if (key(SERVER[fn](u)) !== key(CLIENT[fn](u))) diffs.push(`${fn} ${u}`);
      if (SERVER.processorLabel(u) !== CLIENT.processorLabel(u)) diffs.push(`processorLabel ${u}`);
      if (SERVER.isRedirector(u) !== CLIENT.isRedirector(u)) diffs.push(`isRedirector ${u}`);
      if (SERVER.unwrapAffiliate(u) !== CLIENT.unwrapAffiliate(u)) diffs.push(`unwrapAffiliate ${u}`);
      let host = ""; try { host = new URL(u).hostname; } catch { /* no es URL */ }
      if (host && SERVER.looksLikeBrandImpersonation(host) !== CLIENT.looksLikeBrandImpersonation(host)) diffs.push(`looksLike ${host}`);
    }
    expect(diffs).toEqual([]);
 }, 60_000);

  it("con sufijos públicos poco comunes: la lista estricta decide igual y el navegador nunca rechaza lo que el servidor acepta", () => {
    const rules = `${PSL_ICANN},${PSL_PRIVATE}`.split(",").filter((r) => r && !/^[!*]/.test(r)).filter((_r, i) => i % 10 === 0);
    const strictDiffs: string[] = [];
    const lessPermissive: string[] = [];
    const morePermissive: string[] = [];
    for (const r of rules) {
      for (const u of [`https://${r}/`, `https://hotel.${r}/`, `https://booking-pagos.${r}/`, `https://a.b.${r}/x`]) {
        for (const fn of ["checkAllowlisted", "checkUntrusted"] as const) {
          const a = SERVER[fn](u), b = CLIENT[fn](u);
          if (a.ok !== b.ok || a.url !== b.url || a.provider?.provider !== b.provider?.provider) strictDiffs.push(`${fn} ${u}`);
        }
        const a = SERVER.checkTrustedSource(u), b = CLIENT.checkTrustedSource(u);
        if (a.ok && !b.ok) lessPermissive.push(u);
        // Solo hosts que SON un sufijo público poco común ("airline.aero"): el servidor los rechaza al salir (booking-go).
        if (!a.ok && b.ok) morePermissive.push(`${u} ${a.reason}`);
      }
    }
    expect(rules.length).toBeGreaterThan(1000);
    expect(strictDiffs).toEqual([]);
    expect(lessPermissive).toEqual([]);
    expect(morePermissive.filter((d) => !/ host_no_publico$/.test(d))).toEqual([]);
  }, 60_000);

  it("googleLogin.ts y consent.ts leen solo su variable VITE_* (no import.meta.env completo)", () => {
    const app = walk("src").filter((f) => !f.startsWith(join("src", "test")));
    const whole = app.filter((f) => /import\.meta\.env(?!\??\.)/.test(src(f).replace(/^\s*(\/\/|\/?\*).*$/gm, "").replace(/\/\/.*$/gm, "")));
    expect(whole).toEqual([]);
    expect(src("src/lib/googleLogin.ts")).toMatch(/import\.meta\.env\.VITE_GOOGLE_LOGIN_ENABLED/);
    expect(src("src/lib/consent.ts")).toMatch(/import\.meta\.env\.VITE_TRAVELPAYOUTS_DRIVE_ENABLED/);
    vi.stubEnv("VITE_GOOGLE_LOGIN_ENABLED", "true");
    vi.stubEnv("VITE_TRAVELPAYOUTS_DRIVE_ENABLED", "TRUE");
    expect(googleLoginEnabled()).toBe(true);
    expect(travelpayoutsDriveEnabled()).toBe(true);
    vi.stubEnv("VITE_GOOGLE_LOGIN_ENABLED", "no");
    expect(googleLoginEnabled()).toBe(false);
    expect(googleLoginEnabled({})).toBe(true); // encendido por omisión desde que Google usa credenciales administradas
    expect(travelpayoutsDriveEnabled({ VITE_TRAVELPAYOUTS_DRIVE_ENABLED: "true" })).toBe(true);
  });
});

describe("P2-6 · Beneficios sin \"(JSON)\" · P2-8 · /onboarding/deep en español", () => {
  it("el botón de descarga no muestra el formato técnico", () => {
    const b = src("src/pages/Benefits.tsx");
    expect(b).not.toMatch(/\(JSON\)/);
    expect(b).toMatch(/Descargar una copia de mis documentos y tarjetas/);
  });
  it("\"Slow Travel\" ahora es \"Viaje pausado\" (también en la etiqueta que ven tus amigos)", () => {
    const d = src("src/pages/OnboardingDeep.tsx");
    expect(d).not.toMatch(/Slow Travel/i);
    expect(d).toMatch(/\{ id: "slow", label: "Viaje pausado"/);
    expect(DNA_LABELS.ritmo.slow.label).toBe("Viaje pausado");
  });
});

describe("P2-11 · place-photo cuesta menos sin guardar fotos de Google", () => {
  const invoke = supabase.functions.invoke as unknown as ReturnType<typeof vi.fn>;
  const REF = "places/ChIJabc123/photos/Foto_9";
  const URL800 = "https://lh3.googleusercontent.com/place-photos/abc=s800";
  beforeEach(() => { invoke.mockReset(); __resetPlacePhotoCache(); sessionStorage.clear(); });

  it("la función responde con caché privada de un día (como las fotos de Google) y no cachea errores", () => {
    expect(PHOTO_CACHE_SECONDS).toBe(86_400);
    expect(photoCacheControl("url", true)).toBe("private, max-age=86400");
    expect(photoCacheControl("resolve", true)).toBe("private, max-age=86400");
    expect(photoCacheControl("url", false)).toBe("private, max-age=3600");
    expect(photoCacheControl("binary")).toBe("public, max-age=86400");
    expect(photoCacheControl("error")).toBe("no-store");
    const fn = src("supabase/functions/place-photo/index.ts");
    expect(fn).toMatch(/photoCacheControl\("url", !!photoUri\)/);
    expect(fn).toMatch(/photoCacheControl\("resolve", !!out\.url\)/);
    expect(fn).not.toMatch(/max-age=3600"/);
    // Nada de la foto se guarda en el servidor (ni bytes ni URL).
    expect(fn).not.toMatch(/\.from\(|storage|dbCacheStore\(\)\.put|upload/);
  });

  it("la misma foto a otro ancho no se vuelve a pedir; dos tarjetas a la vez comparten la petición", async () => {
    let resolveCall: (v: unknown) => void = () => {};
    invoke.mockImplementation(() => new Promise((r) => { resolveCall = r; }));
    const big = fetchPlacePhotoUrl(REF, 800);
    const thumb = fetchPlacePhotoUrl(REF, 240); // en camino: espera la de 800
    await new Promise((r) => setTimeout(r, 0));
    resolveCall({ data: { url: URL800 }, error: null });
    expect(await big).toBe(URL800);
    expect(await thumb).toBe(URL800);
    expect(invoke).toHaveBeenCalledTimes(1);
    // Ya sabida: a cualquier ancho menor, sin llamar.
    expect(cachedPlacePhoto(REF, 240)).toBe(URL800);
    expect(await fetchPlacePhotoUrl(REF, 400)).toBe(URL800);
    expect(invoke).toHaveBeenCalledTimes(1);
    // Va por GET (el navegador puede reutilizar la respuesta con su Cache-Control).
    expect(invoke.mock.calls[0][1]).toEqual({ method: "GET" });
  });

  it("un ancho mayor que el sabido sí se pide; un nombre de foto inválido no se vuelve a pedir a ningún ancho", async () => {
    invoke.mockResolvedValue({ data: { url: URL800 }, error: null });
    await fetchPlacePhotoUrl(REF, 240);
    await fetchPlacePhotoUrl(REF, 800);
    expect(invoke).toHaveBeenCalledTimes(2);
    invoke.mockReset();
    invoke.mockResolvedValue({ data: null, error: Object.assign(new Error("404"), { context: { status: 404 } }) });
    const BAD = "places/ChIJabc123/photos/Vieja";
    expect(await fetchPlacePhotoUrl(BAD, 240)).toBeNull();
    expect(await fetchPlacePhotoUrl(BAD, 800)).toBeNull();
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("la foto que encontró 'resolve' queda guardada también por su nombre", async () => {
    invoke.mockResolvedValue({ data: { url: URL800, ref: REF, place_name: "Pujol" }, error: null });
    expect(await resolvePlacePhotoUrl({ name: "Pujol", city: "Ciudad de México" }, 800)).toBe(URL800);
    expect(await fetchPlacePhotoUrl(REF, 800)).toBe(URL800);
    expect(await resolvePlacePhotoUrl({ name: "Pujol", city: "Ciudad de México" }, 240)).toBe(URL800);
    expect(invoke).toHaveBeenCalledTimes(1);
    const [fn, opts] = invoke.mock.calls[0];
    expect(opts).toEqual({ method: "GET" });
    expect(Object.fromEntries(new URL(`https://x.test/${fn}`).searchParams)).toMatchObject({ mode: "resolve", name: "Pujol" });
  });
});

void act;
