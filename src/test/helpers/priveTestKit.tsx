// Utilidades de prueba de IATOS Privé: simulación de framer-motion (sin animaciones, con
// useReducedMotion controlable), servidor Privé simulado y estados de prueba.
import React from "react";
import { vi } from "vitest";
import type { PriveStatus } from "@/lib/priveApi";

// ── framer-motion sin animación ────────────────────────────────────────────────────────────
export const motionState = { reduce: false };

const MOTION_PROPS = new Set([
  "initial", "animate", "exit", "transition", "variants", "whileHover", "whileTap", "whileInView", "layout", "viewport", "onAnimationComplete",
]);
const strip = (props: Record<string, unknown>) => {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(props)) if (!MOTION_PROPS.has(k)) out[k] = v;
  return out;
};
const cache = new Map<string, unknown>();
const motionProxy = new Proxy(
  {},
  {
    get: (_t, tag: string) => {
      if (!cache.has(tag)) {
        const C = React.forwardRef<HTMLElement, Record<string, unknown>>((props, ref) =>
          React.createElement(tag, { ...strip(props), ref }),
        );
        C.displayName = `motion.${tag}`;
        cache.set(tag, C);
      }
      return cache.get(tag);
    },
  },
);

export const framerMotionMock = {
  motion: motionProxy,
  AnimatePresence: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
  useReducedMotion: () => motionState.reduce,
};

// ── Estados del servidor ───────────────────────────────────────────────────────────────────
export const baseStatus = (over: Partial<PriveStatus> = {}): PriveStatus => ({
  is_pro: true,
  tenure_days: 0,
  required_days: 90,
  eligible: false,
  basis: null,
  membership_status: "none",
  has_password: false,
  password_status: null,
  locked_until: null,
  activated_at: null,
  member_code: null,
  first_name: "Valentina",
  welcome_version_seen: 0,
  onboarding: {},
  invitation_pending: false,
  members_requires_prive: false,
  ...over,
});

export const activeStatus = (over: Partial<PriveStatus> = {}): PriveStatus =>
  baseStatus({
    eligible: true,
    basis: "tenure",
    tenure_days: 124,
    membership_status: "active",
    has_password: true,
    password_status: "active",
    // Relativa a hoy: miembro activo desde hace 60 días (fuera de "Your World is Ready", que dura 30).
    // Con una fecha fija, la prueba cambiaba de resultado el mismo día a las 18:30 UTC.
    activated_at: new Date(Date.now() - 60 * 86_400_000).toISOString(),
    member_code: "IP-7KQM-X4TD",
    welcome_version_seen: 1,
    onboarding: { version: 1, step: 5, completed_at: "2026-10-22T18:40:00Z" },
    ...over,
  });

// ── Servidor Privé simulado (lo usa vi.mock("@/lib/priveApi")) ─────────────────────────────
export type AccessHandler = (action: string, body: Record<string, unknown>) => unknown;

export function createMockApi() {
  const state: { status: PriveStatus; statusOk: boolean; handler: AccessHandler } = {
    status: baseStatus(),
    statusOk: true,
    handler: () => ({ ok: true, data: {} }),
  };
  const api = {
    status: vi.fn(async () => (state.statusOk ? { ok: true, data: state.status } : { ok: false, code: "SERVICE_UNAVAILABLE" })),
    access: vi.fn(async (action: string, body: Record<string, unknown> = {}) => state.handler(action, body)),
    content: vi.fn(async (_fn: string, ps: string | null) => (ps ? { ok: true, data: [] } : { ok: false, code: "PRIVE_NO_SESSION" })),
    illustrativePhoto: vi.fn(async () => null),
  };
  return { state, api };
}

export const SESSION_TOKEN = "pv_test_session_token_abcdefghijklmnop";
export const futureIso = () => new Date(Date.now() + 6 * 3600e3).toISOString();

/** Instancia única compartida entre vi.mock("@/lib/priveApi") y la prueba. */
export const priveMock = createMockApi();
