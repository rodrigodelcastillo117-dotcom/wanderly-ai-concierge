// Pendiente E2E 28-oct-2026: el login tardaba (11.7 s escritorio / 5.4 s celular en la prueba en
// producción). Se revisa que la carga inicial ya no repita consultas a profiles, que /auth no repita
// la del onboarding, que lo secundario espere a lo crítico, y que la protección de rutas siga igual.
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Supabase simulado: registra cada consulta (tabla + columnas) ──
const log = vi.hoisted(() => ({ calls: [] as { table: string; cols: string }[], rpc: [] as string[] }));
const db = vi.hoisted(() => ({ onboarding: { completed_onboarding: true } as Record<string, unknown> | null }));
vi.mock("@/integrations/supabase/client", () => {
  const from = (table: string) => {
    let cols = "";
    const api: any = {
      select: (c: string, opts?: any) => { cols = c + (opts?.head ? " (head)" : ""); log.calls.push({ table, cols }); return api; },
      eq: () => api, gte: () => api, order: () => api, limit: () => api, is: () => api, in: () => api,
      maybeSingle: async () => {
        if (table === "profiles") return cols.includes("active_trip_id") ? { data: { active_trip_id: null }, error: null } : { data: { full_name: "Sofía Ramírez", avatar_url: "https://cdn.example.test/s.png" }, error: null };
        if (table === "user_onboarding_state") return { data: db.onboarding ? { user_id: "u1", ...db.onboarding } : null, error: null };
        return { data: null, error: null };
      },
      update: () => api, upsert: async () => ({ error: null }),
      then: (res: any, rej: any) => Promise.resolve({ data: [], error: null, count: 0 }).then(res, rej),
    };
    return api;
  };
  return {
    supabase: {
      from,
      rpc: async (fn: string) => { log.rpc.push(fn); return { data: null, error: null }; },
      functions: { invoke: vi.fn(async () => ({ data: null, error: null })) },
      auth: { getSession: async () => ({ data: { session: { user: { id: "u1" } } } }) },
      channel: () => ({ on: () => ({ subscribe: () => ({}) }) }),
      removeChannel: () => {},
    },
  };
});
const auth = vi.hoisted(() => ({ value: { user: { id: "u1" } as any, loading: false, restoring: false, retryRestore: () => {}, signIn: async () => ({}), signUp: async () => ({}), signOut: async () => {} } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => auth.value }));
vi.mock("@/hooks/useSubscription", () => ({ useSubscription: () => ({ loading: false, isPro: false }), notifyAccessChanged: () => {} }));
vi.mock("@/components/DestinationVideo", () => ({ DestinationVideo: () => null }));
vi.mock("@/components/VoiceInput", () => ({ VoiceInput: () => null }));
vi.mock("@/components/TripFileUpload", () => ({ TripFileUpload: () => null }));
vi.mock("@/hooks/useAIRecommendations", () => ({ useAIRecommendations: () => ({ recos: [], loading: false }) }));
vi.mock("@/lib/fx", async () => {
  const actual: any = await vi.importActual("@/lib/fx");
  return { ...actual, fetchFxTable: async () => actual.FX_FALLBACK_TABLE };
});
vi.mock("@/lib/weatherNow", async () => {
  const actual: any = await vi.importActual("@/lib/weatherNow");
  return { ...actual, fetchWeatherNow: async () => null };
});
vi.mock("@/lib/referral", () => ({ claimPendingReferral: async () => {} }));
vi.mock("framer-motion", () => {
  const strip = (p: any) => { const { initial, animate, exit, transition, whileHover, whileTap, layout, ...r } = p; return r; };
  const motion = new Proxy({}, { get: (_t, tag: string) => (p: any) => React.createElement(tag, strip(p)) });
  return { motion, AnimatePresence: ({ children }: any) => <>{children}</> };
});

import DashboardHome from "@/pages/DashboardHome";
import Auth from "@/pages/Auth";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { OnboardingProvider } from "@/hooks/useOnboardingStatus";
import { __resetActiveTripColumn } from "@/lib/profileActiveTrip";
import { invalidateProfileBasics, loadProfileBasics, warmProfileBasics } from "@/lib/profileBasics";
import { afterCritical, beginCritical, __resetIdleGate } from "@/lib/idleGate";

let loc = "";
const Where = () => { const l = useLocation(); loc = l.pathname; return null; };

beforeEach(() => {
  log.calls.length = 0;
  log.rpc.length = 0;
  db.onboarding = { completed_onboarding: true };
  auth.value = { ...auth.value, user: { id: "u1" }, loading: false, restoring: false };
  __resetActiveTripColumn();
  invalidateProfileBasics();
  __resetIdleGate();
  localStorage.clear();
  loc = "";
});

const profileCalls = () => log.calls.filter((c) => c.table === "profiles").map((c) => c.cols);

describe("carga inicial del inicio: sin consultas repetidas a profiles", () => {
  it("inicio + menú + avatar comparten UNA consulta de nombre/avatar; active_trip_id va aparte una vez", async () => {
    render(
      <MemoryRouter initialEntries={["/dashboard"]}>
        <DashboardHome />
      </MemoryRouter>,
    );
    expect((await screen.findAllByText("Sofía")).length).toBeGreaterThan(0);
    await waitFor(() => expect(profileCalls()).toContain("active_trip_id"));
    const calls = profileCalls();
    // Antes: full_name (inicio) + full_name (menú) + avatar_url (avatar) + active_trip_id = 4.
    expect(calls.filter((c) => c === "full_name, avatar_url")).toHaveLength(1);
    expect(calls.filter((c) => c === "active_trip_id")).toHaveLength(1);
    expect(calls).toHaveLength(2);
    expect(new Set(calls).size).toBe(calls.length);
    // El avatar ya vino en profiles: no se pide perfil_ia.
    expect(log.calls.some((c) => c.table === "ai_user_preferences")).toBe(false);
  });

  it("lo que /auth calentó al iniciar sesión se reutiliza (cero consultas nuevas al llegar al inicio)", async () => {
    warmProfileBasics("u1");
    await loadProfileBasics("u1");
    const before = profileCalls().length;
    expect(await loadProfileBasics("u1")).toEqual({ full_name: "Sofía Ramírez", avatar_url: "https://cdn.example.test/s.png" });
    expect(profileCalls().length).toBe(before);
  });
});

describe("/auth tras iniciar sesión", () => {
  const renderAuth = () => render(
    <MemoryRouter initialEntries={["/auth"]}>
      <OnboardingProvider>
        <Where />
        <Routes>
          <Route path="/auth" element={<Auth />} />
          <Route path="*" element={<p>DESTINO</p>} />
        </Routes>
      </OnboardingProvider>
    </MemoryRouter>,
  );

  it("onboarding terminado: va al inicio usando la consulta del proveedor (sin repetir user_onboarding_state ni las tablas viejas)", async () => {
    renderAuth();
    await waitFor(() => expect(loc).toBe("/dashboard"));
    const onb = log.calls.filter((c) => c.table === "user_onboarding_state");
    expect(onb).toHaveLength(1);
    expect(log.calls.some((c) => c.table === "ai_user_preferences" || c.table === "travel_profiles")).toBe(false);
  });

  it("onboarding sin terminar: revisa las tablas viejas y, sin perfil, va a /onboarding", async () => {
    db.onboarding = { completed_onboarding: false };
    renderAuth();
    await waitFor(() => expect(loc).toBe("/onboarding"));
    expect(log.calls.filter((c) => c.table === "user_onboarding_state")).toHaveLength(1);
    expect(log.calls.some((c) => c.table === "ai_user_preferences")).toBe(true);
  });
});

describe("la ruta protegida sigue funcionando", () => {
  const renderGuard = (path = "/dashboard") => render(
    <MemoryRouter initialEntries={[path]}>
      <OnboardingProvider>
        <Where />
        <Routes>
          <Route path="/auth" element={<p>LOGIN</p>} />
          <Route path="/onboarding" element={<ProtectedRoute><p>ONBOARDING</p></ProtectedRoute>} />
          <Route path="/dashboard" element={<ProtectedRoute><p>INICIO</p></ProtectedRoute>} />
        </Routes>
      </OnboardingProvider>
    </MemoryRouter>,
  );

  it("sin sesión → /auth", async () => {
    auth.value = { ...auth.value, user: null };
    renderGuard();
    expect(await screen.findByText("LOGIN")).toBeInTheDocument();
    expect(screen.queryByText("INICIO")).toBeNull();
  });

  it("recuperando la sesión: no manda a /auth, avisa y deja reintentar", () => {
    auth.value = { ...auth.value, user: null, loading: true, restoring: true };
    renderGuard();
    expect(screen.getByText("Recuperando tu sesión…")).toBeInTheDocument();
    expect(screen.queryByText("LOGIN")).toBeNull();
  });

  it("con sesión y onboarding terminado → la pantalla", async () => {
    renderGuard();
    expect(await screen.findByText("INICIO")).toBeInTheDocument();
  });

  it("con sesión y onboarding sin terminar → /onboarding", async () => {
    db.onboarding = { completed_onboarding: false };
    renderGuard();
    expect(await screen.findByText("ONBOARDING")).toBeInTheDocument();
    expect(loc).toBe("/onboarding");
  });
});

describe("lo secundario espera a lo crítico (idleGate)", () => {
  // Entorno de navegador simulado: idle y temporizadores manuales.
  const mkEnv = () => {
    const idle: (() => void)[] = [];
    const timers: { cb: () => void; ms: number }[] = [];
    return {
      idle, timers,
      env: {
        immediate: false,
        idle: (cb: () => void) => { idle.push(cb); return () => { const i = idle.indexOf(cb); if (i >= 0) idle.splice(i, 1); }; },
        timer: (cb: () => void, ms: number) => { const t = { cb, ms }; timers.push(t); return () => { const i = timers.indexOf(t); if (i >= 0) timers.splice(i, 1); }; },
      },
    };
  };

  it("con viaje y nombre en curso, las notificaciones/gastos esperan; al terminar, corren", () => {
    const { idle, env } = mkEnv();
    const ran: string[] = [];
    afterCritical(() => ran.push("secundario"), {}, env);
    const end = beginCritical(); // el inicio registra su consulta crítica en el mismo montaje
    idle.shift()!();
    expect(ran).toEqual([]);
    end();
    expect(ran).toEqual(["secundario"]);
  });

  it("sin nada crítico, corre en cuanto el navegador está libre; con tope si lo crítico se tarda", () => {
    const a = mkEnv();
    const ran: string[] = [];
    afterCritical(() => ran.push("libre"), {}, a.env);
    a.idle.shift()!();
    expect(ran).toEqual(["libre"]);

    const b = mkEnv();
    beginCritical();
    afterCritical(() => ran.push("tope"), { maxWaitMs: 2500 }, b.env);
    b.idle.shift()!();
    expect(b.timers.map((t) => t.ms)).toEqual([2500]);
    b.timers.shift()!.cb();
    expect(ran).toEqual(["libre", "tope"]);
  });

  it("al desmontar se cancela (no corre después)", () => {
    const { idle, env } = mkEnv();
    const ran: string[] = [];
    const cancel = afterCritical(() => ran.push("x"), {}, env);
    cancel();
    expect(idle).toHaveLength(0);
    expect(ran).toEqual([]);
  });
});
