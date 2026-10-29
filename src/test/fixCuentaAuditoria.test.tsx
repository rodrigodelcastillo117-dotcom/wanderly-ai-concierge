// Auditoría de cuenta, acceso, planes y administración en producción (28-oct-2026) y los puntos de la
// auditoría técnica que se sumaron (404, admin, títulos, sitemap). Cada prueba nombra el número del
// defecto y falla con el código anterior a esta rama.
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { render, screen, fireEvent, waitFor, renderHook } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const sb = vi.hoisted(() => ({
  signInWithOAuth: vi.fn(async () => ({ data: {}, error: null })),
  rpc: vi.fn(async () => ({ data: { is_pro: true }, error: null })),
  adminRow: null as null | { user_id: string },
  sub: { status: "comped", comped_until: null } as Record<string, unknown> | null,
}));
vi.mock("@/integrations/supabase/client", () => {
  const from = (table: string) => {
    const api: any = {
      select: () => api, eq: () => api,
      maybeSingle: async () => ({ data: table === "admins" ? sb.adminRow : table === "subscriptions" ? sb.sub : null, error: null }),
    };
    return api;
  };
  return {
    supabase: {
      from, rpc: (...a: unknown[]) => (sb.rpc as any)(...a),
      functions: { invoke: vi.fn(async () => ({ data: null, error: null })) },
      auth: { signInWithOAuth: (...a: unknown[]) => (sb.signInWithOAuth as any)(...a), resetPasswordForEmail: async () => ({ error: null }) },
    },
  };
});
const auth = vi.hoisted(() => ({ value: { user: null as any, signIn: vi.fn(async () => ({ error: { message: "Invalid login credentials" } })), signUp: vi.fn(async () => ({ error: null })), signOut: vi.fn() } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => auth.value }));
const lov = vi.hoisted(() => ({ signInWithOAuth: vi.fn(async () => ({ redirected: true })) }));
vi.mock("@/integrations/lovable/index", () => ({ lovable: { auth: { signInWithOAuth: (...a: unknown[]) => (lov.signInWithOAuth as any)(...a) } } }));
vi.mock("@/lib/referral", () => ({ claimPendingReferral: async () => {} }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
vi.mock("@/lib/analytics", () => ({ track: () => {}, initAnalytics: vi.fn(), optOutAnalytics: vi.fn() }));
vi.mock("framer-motion", () => {
  const cache: Record<string, any> = {};
  const strip = (p: any) => { const { initial, animate, exit, transition, whileHover, whileTap, layout, ...r } = p; return r; };
  const motion = new Proxy({}, { get: (_t, tag: string) => (cache[tag] ??= (p: any) => React.createElement(tag, strip(p))) });
  return { motion, AnimatePresence: ({ children }: any) => <>{children}</> };
});
vi.mock("@/components/DashboardLayout", () => ({ DashboardLayout: ({ children }: any) => <>{children}</> }));
const card = vi.hoisted(() => ({ value: null as any }));
vi.mock("@/lib/memberCard", async (orig) => ({ ...(await orig<any>()), useMemberCard: () => ({ card: card.value, loading: false }) }));

import Auth from "@/pages/Auth";
import NotFound from "@/pages/NotFound";
import Pro from "@/pages/Pro";
import { Ayuda } from "@/pages/Legal";
import { AdminGate } from "@/components/AdminGate";
import { CookieBanner } from "@/components/CookieBanner";
import { applyConsent, travelpayoutsDriveEnabled } from "@/lib/consent";
import { clearGoogleNext, GOOGLE_NEXT_KEY, googleLoginEnabled, peekGoogleNext } from "@/lib/googleLogin";
import { signinErrorMessage } from "@/lib/signupErrors";
import { titleForPath } from "@/lib/routeTitles";
import { dnaUpdatedLabel, PROFILE_SETTINGS_PATH } from "@/lib/profileSettings";
import { displayTripName, groupOwnTrips, type FriendTrip } from "@/lib/friendActivity";
import { withIatoMark } from "@/lib/iatoMark";
import { useSubscription } from "@/hooks/useSubscription";
import { MemberCardDetail } from "@/components/membercard/MemberCardButton";
import { userConfirmedEmail, userUpdateEmail } from "../../supabase/functions/_shared/ai-reservations/templates";
import { welcomeEmail, welcomeFirstName } from "../../supabase/functions/_shared/email-templates";
import { sendEmail, sharedSenderAllowed } from "../../supabase/functions/_shared/email";

const src = (p: string) => readFileSync(p, "utf8");

beforeEach(() => {
  auth.value.user = null;
  toast.error.mockClear();
  sb.signInWithOAuth.mockClear();
  sb.rpc.mockClear();
  sb.adminRow = null;
  card.value = null;
  localStorage.clear();
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("#2 · Continuar con Google (credenciales administradas de Lovable)", () => {
  it("encendido por omisión; se apaga solo con VITE_GOOGLE_LOGIN_ENABLED=false", () => {
    expect(googleLoginEnabled({})).toBe(true);
    expect(googleLoginEnabled("false")).toBe(false);
    vi.stubEnv("VITE_GOOGLE_LOGIN_ENABLED", "false");
    render(<MemoryRouter initialEntries={["/auth"]}><Auth /></MemoryRouter>);
    expect(screen.queryByTestId("auth-google")).toBeNull();
  });
  it("usa el ayudante de Lovable (no supabase directo), regresa a /auth y guarda la ruta pedida", async () => {
    lov.signInWithOAuth.mockClear();
    sessionStorage.clear();
    render(<MemoryRouter initialEntries={["/auth?next=%2Fdashboard%2Fviajes"]}><Auth /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: "Continuar con Google" }));
    await waitFor(() => expect(lov.signInWithOAuth).toHaveBeenCalledTimes(1));
    const [provider, opts] = lov.signInWithOAuth.mock.calls[0] as any[];
    expect(provider).toBe("google");
    expect(opts.redirect_uri).toBe(`${window.location.origin}/auth`);
    expect(sb.signInWithOAuth).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(GOOGLE_NEXT_KEY)).toBe("/dashboard/viajes");
  });
  it("si Google falla, muestra un error entendible y no se queda cargando", async () => {
    lov.signInWithOAuth.mockImplementationOnce(async () => ({ error: new Error("popup closed") }) as any);
    render(<MemoryRouter initialEntries={["/auth"]}><Auth /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: "Continuar con Google" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/No pudimos abrir el inicio de sesión con Google/)));
  });
  it("de regreso de Google sin ?next, /auth toma la ruta guardada; las rutas externas se ignoran", () => {
    sessionStorage.setItem(GOOGLE_NEXT_KEY, "/dashboard/gastos");
    expect(peekGoogleNext()).toBe("/dashboard/gastos");
    sessionStorage.setItem(GOOGLE_NEXT_KEY, "//evil.example");
    expect(peekGoogleNext()).toBeNull();
    clearGoogleNext();
    expect(sessionStorage.getItem(GOOGLE_NEXT_KEY)).toBeNull();
  });
});

describe("#10 · error de inicio de sesión entendible", () => {
  it("'Correo o contraseña incorrectos' en vez de 'Credenciales inválidas'", async () => {
    render(<MemoryRouter initialEntries={["/auth"]}><Auth /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText(/correo/i), { target: { value: "ana@example.test" } });
    fireEvent.change(screen.getByLabelText(/contraseña/i), { target: { value: "malamala1" } });
    fireEvent.click(screen.getByRole("button", { name: "Iniciar sesión" }));
    expect(await screen.findByTestId("auth-login-error")).toHaveTextContent("Correo o contraseña incorrectos");
    expect(toast.error).not.toHaveBeenCalledWith("Credenciales inválidas");
    expect(signinErrorMessage("Email not confirmed").message).toMatch(/confirmas tu correo/);
  });
});

describe("#12 · registro: el botón dice por qué falta aceptar los Términos", () => {
  it("el botón no queda deshabilitado en silencio y aparece el aviso", async () => {
    // La casilla (Radix) mide su tamaño con ResizeObserver, que jsdom no trae.
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
    render(<MemoryRouter initialEntries={["/auth?mode=signup"]}><Auth /></MemoryRouter>);
    const btn = screen.getByRole("button", { name: "Crear cuenta" });
    expect(btn).not.toBeDisabled();
    fireEvent.change(screen.getByLabelText("Nombre completo"), { target: { value: "Ana" } });
    fireEvent.change(screen.getByLabelText(/correo/i), { target: { value: "ana@example.test" } });
    fireEvent.change(screen.getByLabelText(/^contraseña/i), { target: { value: "unaclave-larga-2026" } });
    fireEvent.click(btn);
    expect(await screen.findByText(/marca la casilla de Términos/)).toBeInTheDocument();
    expect(auth.value.signUp).not.toHaveBeenCalled();
  });
});

describe("#3 · Travelpayouts Drive sin errores rojos", () => {
  it("por omisión 'Aceptar' NO carga el script (solo con VITE_TRAVELPAYOUTS_DRIVE_ENABLED=true)", () => {
    document.head.querySelector('script[data-iatos="travelpayouts"]')?.remove();
    expect(travelpayoutsDriveEnabled({})).toBe(false);
    applyConsent("accepted");
    expect(document.head.querySelector('script[data-iatos="travelpayouts"]')).toBeNull();
    vi.stubEnv("VITE_TRAVELPAYOUTS_DRIVE_ENABLED", "true");
    applyConsent("accepted");
    const s = document.head.querySelector('script[data-iatos="travelpayouts"]') as HTMLScriptElement;
    expect(s).not.toBeNull();
    // Si el script no carga, se quita (sin reintentos en la visita).
    s.onerror?.(new Event("error") as any);
    expect(document.head.querySelector('script[data-iatos="travelpayouts"]')).toBeNull();
  });
});

describe("#6 · el aviso de cookies no tapa la página", () => {
  it("mientras está visible reserva su alto abajo y lo libera al elegir", () => {
    const orig = HTMLElement.prototype.getBoundingClientRect;
    HTMLElement.prototype.getBoundingClientRect = function () { return { height: 132, width: 390, top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect; };
    render(<MemoryRouter><CookieBanner /></MemoryRouter>);
    expect(document.body.style.paddingBottom).toBe("132px");
    fireEvent.click(screen.getByRole("button", { name: "Solo esenciales" }));
    expect(document.body.style.paddingBottom).toBe("");
    HTMLElement.prototype.getBoundingClientRect = orig;
  });
});

describe("#7 · landing con el plan gratuito, #9 · ayuda y 404", () => {
  it("la landing muestra qué incluye el plan gratis y enlaza Ayuda en el pie", () => {
    const l = src("src/pages/Landing.tsx");
    expect(l).toMatch(/FREE_FEATURES\.map/);
    expect(l).toMatch(/Plan gratuito/);
    expect(l).toMatch(/to="\/ayuda"/);
    expect(l).not.toMatch(/encuesta visual de 2 minutos/);
  });
  it("/ayuda responde cómo funciona, real vs estimado, planes y contacto; /faq y /precios llevan ahí", () => {
    render(<MemoryRouter initialEntries={["/ayuda"]}><Ayuda /></MemoryRouter>);
    for (const h of ["¿Cómo funciona IATOS?", "¿Qué es real y qué es estimado?", "¿Qué incluye cada plan?", "Contacto"]) {
      expect(screen.getByRole("heading", { name: h })).toBeInTheDocument();
    }
    // "Iato" va en su propio <span> con la serifa de marca (ronda 2, P2-3): se lee el texto del documento.
    expect(document.body.textContent).toMatch(/3 mensajes con Iato al mes/);
    const app = src("src/App.tsx");
    expect(app).toMatch(/path="\/ayuda"/);
    expect(app).toMatch(/path="\/faq" element={<Navigate to="\/ayuda"/);
    expect(app).toMatch(/path="\/precios" element={<Navigate to="\/ayuda#planes"/);
  });
  it("la 404 usa el fondo negro de la app y no escribe console.error", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    render(<MemoryRouter initialEntries={["/no-existe"]}><NotFound /></MemoryRouter>);
    const main = screen.getByTestId("not-found");
    expect(main).toHaveClass("bg-background");
    expect(main).not.toHaveClass("bg-muted");
    expect(err).not.toHaveBeenCalled();
    err.mockRestore();
  });
  it("sitemap.xml existe y robots.txt lo anuncia", () => {
    expect(src("public/sitemap.xml")).toMatch(/<loc>https:\/\/traveliatos\.life\/ayuda<\/loc>/);
    expect(src("public/robots.txt")).toMatch(/Sitemap: https:\/\/traveliatos\.life\/sitemap\.xml/);
  });
});

describe("#8 · título de la pestaña por ruta", () => {
  it("cada pantalla tiene el suyo; Privé, Wrapped y Recuerdos ponen el propio", () => {
    expect(titleForPath("/auth")).toBe("Inicia sesión · IATOS");
    expect(titleForPath("/dashboard/pro")).toBe("Plan IATOS PRO · IATOS");
    expect(titleForPath("/dashboard/viajes/123")).toBe("Tu viaje · IATOS");
    expect(titleForPath("/dashboard/viajes/123/clima")).toBe("Clima del viaje · IATOS");
    expect(titleForPath("/ruta-inventada")).toBe("Página no encontrada · IATOS");
    expect(titleForPath("/prive/key")).toBeNull();
    expect(titleForPath("/prive/edicion/sin-conexion")).toBe("Lectura sin conexión · IATOS Privé");
    expect(titleForPath("/wrapped/2026")).toBeNull();
    expect(new Set(["/", "/auth", "/terminos", "/dashboard", "/dashboard/perfil"].map(titleForPath)).size).toBe(5);
    expect(src("src/App.tsx")).toMatch(/<RouteTitle \/>/);
  });
});

describe("#13–15 · textos legales", () => {
  const legal = src("src/pages/Legal.tsx");
  it("sin ruta técnica ni camino en inglés para cancelar", () => {
    expect(legal).not.toMatch(/portal de facturación en \/dashboard\/pro/);
    expect(legal).not.toMatch(/Dashboard → IATOS PRO/);
    expect(legal).toMatch(/Más → Plan IATOS PRO/);
  });
  it("privacidad nombra a Perplexity y a la pasarela de IA de Lovable", () => {
    expect(legal).toMatch(/Perplexity/);
    expect(legal).toMatch(/pasarela de IA de Lovable/);
  });
});

describe("#16 · perfil: 'hoy', enlace real y sin errores técnicos", () => {
  it("nunca 'hace 0 días'", () => {
    expect(dnaUpdatedLabel(0)).toBe("Actualizado hoy");
    expect(dnaUpdatedLabel(1)).toBe("Actualizado ayer");
    expect(dnaUpdatedLabel(5)).toBe("Actualizado hace 5 días");
    const p = src("src/pages/Profile.tsx");
    expect(p).not.toMatch(/presiona aquí/);
    expect(p).not.toMatch(/e\?\.message \?\? "No se pudo evolucionar"/);
    expect(p).toMatch(/readFunctionError\(e, "No pudimos recalcular tu perfil de viajero/);
  });
});

describe("#17 · 'Tus viajes' sin texto crudo ni repetidos", () => {
  const t = (over: Partial<FriendTrip>): FriendTrip => ({ id: null, clave: Math.random().toString(), destino: "Madrid", paises: ["España"], portada: null, fase: "proximo", juntos: false, oculto: false, mesSalida: null, mesRegreso: null, fechaSalida: "2027-03-10", fechaRegreso: "2027-03-17", ...over });
  it("una petición en frase se muestra con su país", () => {
    expect(displayTripName(t({ destino: "Quiero conocer España 15 días, no sé qué ciudades. Del 4 al 19 de mayo de 2027," }))).toBe("España");
    expect(displayTripName(t({ destino: "Roma → Florencia → Venecia", paises: ["Italia"] }))).toBe("Roma → Florencia → Venecia");
  });
  it("cuatro 'Madrid' iguales salen una vez con el conteo", () => {
    const g = groupOwnTrips([t({}), t({}), t({}), t({}), t({ destino: "Roma", paises: ["Italia"] })]);
    expect(g.map((x) => [x.nombre, x.repetidos])).toEqual([["Madrid", 4], ["Roma", 1]]);
  });
});

describe("#18 · el engrane lleva a Ajustes dentro del Perfil", () => {
  it("navega a /dashboard/perfil#ajustes y la sección existe", () => {
    expect(PROFILE_SETTINGS_PATH).toBe("/dashboard/perfil#ajustes");
    const layout = src("src/components/DashboardLayout.tsx");
    expect(layout.match(/onClick=\{\(\) => navigate\(PROFILE_SETTINGS_PATH\)\}\s*aria-label="Ajustes"/g)?.length).toBe(2);
    expect(src("src/pages/Profile.tsx")).toMatch(/id=\{PROFILE_SETTINGS_ID\}/);
  });
});

describe("#19 · 'Iato' no se lee 'lato'", () => {
  it("el nombre se pinta con la serifa de marca", () => {
    const { container } = render(<p>{withIatoMark("100 mensajes con Iato al mes")}</p>);
    expect(container.querySelector("[data-iato-mark]")).toHaveClass("font-display");
    expect(container.textContent).toBe("100 mensajes con Iato al mes");
  });
});

describe("#20 · admin para quien no es admin: sin 403 en la consola y con salida", () => {
  it("no monta la pantalla (ni llama sus RPC) y ofrece Ir al inicio", async () => {
    auth.value.user = { id: "u1" };
    const page = vi.fn(() => <p>METRICAS</p>);
    const Page = () => page();
    render(<MemoryRouter><AdminGate><Page /></AdminGate></MemoryRouter>);
    expect(await screen.findByTestId("admin-denied")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ir al inicio" })).toHaveAttribute("href", "/dashboard");
    expect(page).not.toHaveBeenCalled();
    expect(sb.rpc).not.toHaveBeenCalled();
  });
  it("un admin sí la ve", async () => {
    auth.value.user = { id: "u1" };
    sb.adminRow = { user_id: "u1" };
    render(<MemoryRouter><AdminGate><p>METRICAS</p></AdminGate></MemoryRouter>);
    expect(await screen.findByText("METRICAS")).toBeInTheDocument();
  });
});

describe("#21 · onboarding sin anglicismos ni conteos que no cuadran", () => {
  it("textos en español", () => {
    const o = src("src/pages/Onboarding.tsx");
    for (const bad of [/aha moment/, /al home/, /tu seed/, /FHR/, /\belite\b/, /status reconocido/, /4 preguntas opcionales/]) expect(o).not.toMatch(bad);
  });
});

describe("#22–24 · correos de reservas", () => {
  const row = { ref_code: "R-ABC234", venue_name: "Casa Oaxaca", requested_local: "2026-11-03T20:30", party_size: 1, customer_name: "Ana López",
    venue_address: "Constitución 104", venue_city: "Oaxaca", venue_place_id: "ChIJ_x", requested_for: "2026-11-04T02:30:00Z", confirmation_code: "MX-4821" };
  it("nunca 'Fixer'; se llama 'nuestro equipo humano'", () => {
    for (const k of ["declined", "expired"] as const) {
      const m = userUpdateEmail(k, { ...row, appUrl: "https://app.test" });
      expect(m.html + m.text).not.toMatch(/Fixer/);
      expect(m.text).toMatch(/nuestro equipo humano/);
    }
  });
  it("con 1 persona dice '1 persona' (texto, HTML y Google Calendar)", () => {
    const m = userConfirmedEmail({ ...row, quote: "Confirmado", receivedAt: "2 nov", icsUrl: null, appUrl: "https://app.test" });
    expect(m.text).toMatch(/· 1 persona ·/);
    expect(m.text).not.toMatch(/1 personas/);
    expect(decodeURIComponent(m.text)).not.toMatch(/1 personas/);
  });
  it("usan la maqueta de IATOS (email-kit) con meta viewport", () => {
    const m = userConfirmedEmail({ ...row, party_size: 2, quote: "Confirmado", receivedAt: "2 nov", icsUrl: null, appUrl: "https://app.test" });
    expect(m.html).toMatch(/<meta name="viewport" content="width=device-width, initial-scale=1">/);
    expect(m.html).toMatch(/class="ek-container"/);
    expect(m.html).not.toMatch(/IATOS AI · Reservas/);
  });
});

describe("#25 · bienvenida: enlace correcto, saludo por nombre, firma en español", () => {
  it("Documentos y tarjetas abre /dashboard/beneficios", () => {
    const m = welcomeEmail({ firstName: "Sofía", siteUrl: "https://traveliatos.life" });
    expect(m.html).toMatch(/https:\/\/traveliatos\.life\/dashboard\/beneficios/);
    expect(m.html).not.toMatch(/IATOS · The World, Beyond Ordinary/);
    expect(m.html).toMatch(/El mundo, más allá de lo ordinario/);
  });
  it("el servidor toma el nombre del perfil o del registro (la app mandaba body {})", () => {
    expect(welcomeFirstName({ profileName: "Sofía Demo", metaName: "Otra", bodyName: null })).toBe("Sofía");
    expect(welcomeFirstName({ profileName: null, metaName: "carlos ruiz", bodyName: null })).toBe("Carlos");
    expect(welcomeFirstName({ bodyName: "Ana" })).toBe("Ana");
    expect(src("supabase/functions/email-bienvenida/index.ts")).toMatch(/welcomeFirstName\(\{ \.\.\.\(await accountNames\(user\.id\)\), bodyName \}\)/);
    expect(src("src/hooks/useOnboardingStatus.ts")).not.toMatch(/invoke\("email-bienvenida", \{ body: \{\} \}\)/);
  });
});

describe("#26 · sin remitente compartido en silencio (no llega a usuarios reales)", () => {
  it("dominio sin verificar → falla con domain_not_verified y no reenvía desde onboarding@resend.dev", async () => {
    const env: Record<string, string> = { LOVABLE_API_KEY: "k", RESEND_API_KEY: "r" };
    vi.stubGlobal("Deno", { env: { get: (k: string) => env[k] } });
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ message: "The traveliatos.life domain is not verified" }), { status: 403 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await sendEmail({ to: "ana@example.test", subject: "x", html: "<p>x</p>" });
    expect(r).toEqual({ ok: false, error: "domain_not_verified" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sharedSenderAllowed(() => "true")).toBe(true);
    expect(sharedSenderAllowed(() => undefined)).toBe(false);
  });
});

describe("#27–28 · textos y código muerto", () => {
  it("'correos' en vez de 'emails' y sin ProGate sin usar", () => {
    expect(src("src/components/DeleteAccountSection.tsx")).not.toMatch(/emails ya enviados/);
    expect(existsSync("src/components/ProGate.tsx")).toBe(false);
  });
});

describe("#4 · /dashboard/pro: una sola consulta aunque el menú y la página la pidan a la vez", () => {
  it("dos useSubscription simultáneos comparten get_access_state", async () => {
    auth.value.user = { id: "u-dedupe" };
    const { result: a } = renderHook(() => useSubscription());
    const { result: b } = renderHook(() => useSubscription());
    await waitFor(() => expect(a.current.loading).toBe(false));
    await waitFor(() => expect(b.current.loading).toBe(false));
    expect(sb.rpc.mock.calls.filter((c: any[]) => c[0] === "get_access_state")).toHaveLength(1);
  });
});

describe("#5 + P1-8 · PRO de cortesía: sin textos de contratación y 'fundador' solo si lo es", () => {
  beforeEach(() => { auth.value.user = { id: "u1" }; sb.sub = { status: "comped", comped_until: null }; });
  it("cortesía sin ser fundador: no dice 'miembro fundador' ni muestra $99 ni la nota de contratación", async () => {
    card.value = { tier: "gold", since: null, number: null, tenure_days: 7, prive_days: null, granted: false, name: null };
    render(<MemoryRouter><Pro /></MemoryRouter>);
    expect(await screen.findByText(/IATOS PRO de cortesía, sin fecha de término/)).toBeInTheDocument();
    expect(screen.queryByText(/miembro fundador/)).toBeNull();
    expect(screen.queryByTestId("pro-price")).toBeNull();
    expect(screen.queryByTestId("pro-checkout-note")).toBeNull();
    expect(screen.queryByText(/Cancela cuando quieras/)).toBeNull();
    expect(screen.queryByText(/Al continuar aceptas/)).toBeNull();
  });
  it("fundador (tarjeta negra del servidor): sí lo dice", async () => {
    card.value = { tier: "founder_black", since: null, number: null, tenure_days: 7, prive_days: null, granted: false, name: null };
    render(<MemoryRouter><Pro /></MemoryRouter>);
    expect(await screen.findByText(/como miembro fundador/)).toBeInTheDocument();
  });
});

describe("P2 Privé · tarjeta: antigüedad vs días pagados", () => {
  it("la tarjeta Dorada explica que la antigüedad no es lo que cuenta para Privé", () => {
    render(<MemoryRouter><MemberCardDetail card={{ tier: "gold", since: "2026-10-21T18:00:00Z", number: "IA-J3LX-6AJT", tenure_days: 7, prive_days: null, granted: false, name: "Sofía" }} /></MemoryRouter>);
    expect(screen.getByTestId("member-card-tenure-note")).toHaveTextContent(/creaste tu cuenta/);
    expect(screen.getByTestId("member-card-prive-rule")).toHaveTextContent(/90 días de IATOS PRO pagado/);
  });
});

